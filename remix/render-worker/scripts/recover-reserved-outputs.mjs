#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {RECOVERY_VERSION,RECOVERY_TARGETS,inspectRecoveryTarget,buildRecoveryVariant,applyRecoveryReceipt,commitRecoveryRegistration,digest,targetKey} from '../reserved-output-recovery.mjs';
import {reviewOriginalOutput,hashMedia,measureRecoveryCandidates} from '../recovery-local-media.mjs';
import {createReadonlyInputResolver} from '../recovery-input-resolver.mjs';

const args=process.argv.slice(2),option=name=>{const index=args.indexOf(name);return index>=0?args[index+1]:null;};
const apply=args.includes('--apply'),review=args.includes('--review-local'),libraryPath=option('--library')||'/data/clip-remix/library.json';
const outputsDir=option('--outputs')||'/data/clip-remix/outputs',clipsDir=option('--clips')||'/data/clip-remix/clips';
const reportPath=option('--report'),receiptPath=option('--receipt'),configPath=option('--config'),snapshotPath=option('--snapshot');
const emit=value=>process.stdout.write(`${JSON.stringify(value)}\n`);
if(args.includes('--help')){emit({usage:'NODE_OPTIONS= node scripts/recover-reserved-outputs.mjs --config /run/pinying-metadata.json [--review-local --report /safe/review.json | --apply --receipt /safe/review.json --expected-version N --backup /safe/before.json]',default:'plan only, no writes',scope:RECOVERY_TARGETS,delivery:'Recovered records are held; never start/return/dispatch.'});process.exit(0);}
if(process.env.NODE_OPTIONS)throw new Error('Run with NODE_OPTIONS=; metadata preloads must not initialize in the recovery process');
if(Boolean(configPath)===Boolean(snapshotPath))throw new Error('Provide exactly one of --config (authoritative store) or --snapshot (offline read-only)');
if(apply&&(review||!receiptPath||!configPath||!option('--backup')||!option('--expected-version')))throw new Error('--apply requires config, receipt, expected-version and backup; review separately first');
if(apply&&!args.includes('--maintenance-writers-stopped'))throw new Error('--apply requires maintenance isolation of all live library writers and --maintenance-writers-stopped acknowledgment; restart the service from fresh primary state afterwards');
if(review&&!reportPath)throw new Error('--review-local requires a report path for new real review evidence');
let rpc;
if(configPath){const config=JSON.parse(await fs.readFile(configPath,'utf8')),rule=config.rules.find(row=>libraryPath.startsWith(row.root+'/'));
  if(!rule||rule.connection.scope!=='remix_files'||rule.logicalRoot!==rule.root)throw new Error('Only registered remix_files authority is supported');
  const c=rule.connection;if(!['http://brand-marketing-fd-026222-remix-storage-gateway:8080','http://brand-marketing-fd-026222-data-gateway:8080'].includes(c.url))throw new Error('Unexpected storage authority');
  rpc=async(method,params)=>{const response=await fetch(`${c.url}/documents/${c.scope}`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${c.token}`},body:JSON.stringify({id:randomUUID(),method,args:params}),signal:AbortSignal.timeout(45000)});
    const value=await response.json();if(!response.ok)throw Object.assign(new Error(value.error||'Storage request failed'),{status:response.status});return value;};
}
async function readAuthority(){if(snapshotPath)return {data:JSON.parse(await fs.readFile(snapshotPath,'utf8')),version:null};const value=await rpc('readFile',[libraryPath]);if(!value.exists)throw new Error('Authoritative library is missing');return {data:JSON.parse(value.data),version:value.version,raw:value.data};}
const before=await readAuthority();
const resolvedInputs={},resolveInput=createReadonlyInputResolver({clipsDir,playbackDir:option('--playback-cache')||'/playback-cache',library:before.data});
const suppliedReceipt=apply?JSON.parse(await fs.readFile(receiptPath,'utf8')):null;
const measuredHashes=apply?Object.fromEntries((suppliedReceipt.items||[]).flatMap(item=>(item.variant?.basicInputFiles||[]).map(row=>[row.clipId,row.sha256])))
  :review?await measureRecoveryCandidates(before.data,{clipsDir,resolveInput,resolvedInputs,onProgress:progress=>emit({phase:'original-cut-hashes',...progress})}):{};
const plans=RECOVERY_TARGETS.map(target=>{try{return inspectRecoveryTarget(before.data,target,{measuredHashes,resolvedInputs});}catch(error){if(!apply&&!review&&error.code==='SOURCE_AMBIGUOUS')return {target,status:'needs_bounded_local_hash_review',detail:error.message};throw error;}});
emit({mode:apply?'apply':review?'local-review':'dry-run',libraryVersion:before.version,targets:plans.map(plan=>({key:targetKey(plan.target),status:plan.status,clips:plan.clips?.length,expectedSeconds:plan.clips?.reduce((sum,clip)=>sum+clip.durationSeconds,0)}))});
if(review){
  if(plans.some(plan=>plan.status!=='pending_local_review'))throw new Error('Review requires the original three pending files; use an existing receipt to audit an already applied recovery');
  const items=[],existingHashes=new Set(before.data.renders.flatMap(render=>render.variants.map(v=>v.contentSha256)).filter(Boolean));
  for(const plan of plans){const evidence=await reviewOriginalOutput(plan,{outputsDir,clipsDir,resolveInput,existingHashes,ffmpeg:option('--ffmpeg')||'ffmpeg',ffprobe:option('--ffprobe')||'ffprobe',onProgress:message=>emit({key:targetKey(plan.target),message})});
    existingHashes.add(evidence.sha256);const at=new Date().toISOString(),variant=buildRecoveryVariant(plan,evidence,at);items.push({target:plan.target,contextDigest:plan.contextDigest,binding:plan.binding,variant});}
  const receipt={version:RECOVERY_VERSION,libraryVersion:before.version,createdAt:new Date().toISOString(),items};
  // Exercise all pure apply gates before advertising a receipt as ready.
  applyRecoveryReceipt(before.data,receipt,new Date().toISOString());
  await fs.writeFile(reportPath,JSON.stringify(receipt,null,2),{flag:'wx',mode:0o600});emit({status:'reviewed_not_registered',report:reportPath,receiptSha256:digest(receipt),count:items.length});
}else if(apply){
  const receipt=suppliedReceipt;
  if(String(before.version)!==String(option('--expected-version')))throw new Error(`Library version advanced; current version is ${before.version}. Reread and review the concrete proposed registration before applying.`);
  for(const item of receipt.items||[]){if(!RECOVERY_TARGETS.some(t=>targetKey(t)===targetKey(item.target)))throw new Error('Receipt target is outside the allowlist');
    if(await hashMedia(path.join(outputsDir,`${item.target.renderId}-${item.target.variantId}.mp4`))!==item.variant?.contentSha256)throw new Error('Output changed after local review');
    for(const input of item.variant.basicInputFiles||[]){const clip=before.data.clips.find(row=>row.id===input.clipId);if(!clip)throw new Error('Input removed after local review');
      const resolved=await resolveInput(clip,{expectedHashes:[input.sha256],cacheFile:input.cacheFile});if(await hashMedia(resolved.file)!==input.sha256)throw new Error('Input changed after local review');}}
  // Media verification may take minutes. Re-read the authority afterwards and
  // recheck only the exact job/source bindings; unrelated progress must survive.
  const backup=option('--backup');
  const result=await commitRecoveryRegistration({readAuthority,receipt,
    backup:current=>fs.writeFile(backup,JSON.stringify({version:current.version,library:current.data}),{flag:'wx',mode:0o600}),
    writeAuthority:(version,library)=>rpc('writeFile',[libraryPath,version,JSON.stringify(library)])});
  emit({...result,backup:result.changed?backup:null});
}
