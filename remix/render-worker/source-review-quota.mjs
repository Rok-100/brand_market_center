import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {parseSourceReviewQuotaExtension} from './source-review-quota-extension.mjs';

const schema='wis-source-review-quota-v1';
const sha=value=>createHash('sha256').update(value).digest('hex');
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const valid=value=>typeof value==='string'&&value.length>0&&value.length<=200&&value.trim()===value;
const check=(ok,reason)=>{if(!ok)throw Error(reason);};
const json=value=>JSON.stringify(value);
const fields=['schema','authorizationId','jobId','baseLimit','additionalLimit','totalLimit','legacyRunIds','legacyReservationCount'];

// This is an image-owned authorization, never a request body or environment
// limit. The grant changes source-review spending, not approval requirements.
export function parseSourceReviewQuotaPolicy(value) {
  check(value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===fields.length
    &&fields.every(key=>Object.hasOwn(value,key)),'source_quota_policy_invalid');
  check(value.schema===schema&&typeof value.authorizationId==='string'
    &&/^[a-z0-9][a-z0-9-]{0,99}$/.test(value.authorizationId)&&uuid(value.jobId)
    &&value.baseLimit===64&&value.additionalLimit===200&&value.totalLimit===264
    &&Array.isArray(value.legacyRunIds)&&value.legacyRunIds.length===1&&value.legacyRunIds.every(uuid)
    &&Number.isInteger(value.legacyReservationCount)&&value.legacyReservationCount>=1
    &&value.legacyReservationCount<=64,'source_quota_policy_invalid');
  return Object.freeze(Object.fromEntries(fields.map(key=>[key,key==='legacyRunIds'?Object.freeze([...value[key]]):value[key]])));
}

export async function loadSourceReviewQuotaPolicy({readOnly=false,readFile=fs.readFile}={}) {
  if(readOnly)return null;
  try{return parseSourceReviewQuotaPolicy(JSON.parse(await readFile(new URL('./source-review-quota-policy.json',import.meta.url),'utf8')));}
  catch{return null;}
}

async function regular(file) {
  const info=await fs.lstat(file);check(info.isFile()&&!info.isSymbolicLink()&&info.size<1024*1024,'source_quota_ledger_invalid');
  return fs.readFile(file,'utf8');
}
async function read(file) {return JSON.parse(await regular(file));}
async function exclusive(file,value) {
  // Publish only a completely fsynced record. link() is an exclusive atomic
  // create on both supported platforms; another process never parses half JSON.
  const temporary=path.join(path.dirname(file),`.quota-${randomUUID()}.tmp`),handle=await fs.open(temporary,'wx',0o600);
  try{await handle.writeFile(json(value));await handle.sync();}finally{await handle.close();}
  try{await fs.link(temporary,file);}finally{await fs.unlink(temporary).catch(()=>{});}
}
async function optional(file) {try{return await read(file);}catch(error){if(error.code==='ENOENT')return null;throw Error('source_quota_ledger_invalid');}}
async function safeDirectory(directory) {
  check(typeof directory==='string'&&path.isAbsolute(directory)&&!directory.startsWith('\\\\')&&!directory.includes('\0'),'source_quota_directory_invalid');
  await fs.mkdir(directory,{recursive:true,mode:0o700});
  const info=await fs.lstat(directory);check(info.isDirectory()&&!info.isSymbolicLink(),'source_quota_directory_invalid');
}

async function legacySnapshot(directory,policy) {
  const names=await fs.readdir(directory),snapshot=[];
  for(const runId of policy.legacyRunIds) {
    const prefix=`source-budget-${sha(runId)}-`,entries=[];
    for(const name of names.filter(name=>name.startsWith(prefix))) {
      const matched=name.slice(prefix.length).match(/^(0|[1-9]\d*)\.json$/);
      check(matched&&Number(matched[1])<64,'source_quota_legacy_invalid');
      const bytes=await regular(path.join(directory,name));let record;
      try{record=JSON.parse(bytes);}catch{throw Error('source_quota_legacy_invalid');}
      check(record&&Object.keys(record).length===4&&['key','runId','limit','at'].every(k=>Object.hasOwn(record,k))
        &&hash(record.key)&&record.runId===runId&&Number.isInteger(record.limit)&&record.limit>0&&record.limit<=64
        &&Number(matched[1])<record.limit&&Number.isFinite(Date.parse(record.at)),'source_quota_legacy_invalid');
      entries.push({file:name,index:Number(matched[1]),runId,sha256:sha(bytes),key:record.key,limit:record.limit});
    }
    entries.sort((a,b)=>a.index-b.index);
    check(entries.every((entry,index)=>entry.index===index)&&new Set(entries.map(e=>e.key)).size===entries.length
      &&new Set(entries.map(e=>e.limit)).size<=1,'source_quota_legacy_invalid');
    snapshot.push(...entries);
  }
  check(snapshot.length===policy.legacyReservationCount,'source_quota_legacy_count_changed');
  return snapshot;
}

async function claimRun(directory,policy,runId) {
  const file=path.join(directory,`source-quota-run-${sha(runId)}.json`);
  const expected={schema,jobId:policy.jobId,authorizationId:policy.authorizationId,runId};
  try{await exclusive(file,expected);}catch(error){if(error.code!=='EEXIST')throw error;}
  check(json(await read(file))===json(expected),'source_quota_run_conflict');
}

async function lockLedger(folder) {
  const file=path.join(folder,'allocation.lock'),token=randomUUID();
  for(let attempt=0;attempt<1000;attempt++) {
    try{await exclusive(file,{token});return async()=>{
      const current=await read(file);check(current.token===token,'source_quota_lock_changed');await fs.unlink(file);
    };}catch(error){if(error.code!=='EEXIST')throw error;}
    await new Promise(resolve=>setTimeout(resolve,10));
  }
  // No guessed stale-lock timeout or stealing: a crashed allocator is an
  // integrity hold, not permission to open another allowance.
  throw Error('source_quota_allocation_unavailable');
}

async function existingAllocations(folder,policy,totalLimit=policy.totalLimit) {
  const names=await fs.readdir(folder),claims=new Map(),slots=[];
  const validRecord=record=>record?.schema===schema&&record.authorizationId===policy.authorizationId
    &&record.jobId===policy.jobId&&valid(record.runId)&&hash(record.key)&&Number.isFinite(Date.parse(record.at));
  for(const name of names) {
    if(name==='manifest.json'||name==='authorization-extension.json'||name==='allocation.lock'||/^\.quota-[a-f0-9-]+\.tmp$/.test(name))continue;
    const c=name.match(/^claim-([a-f0-9]{64})\.json$/),s=name.match(/^slot-(0|[1-9]\d*)\.json$/);
    check(c||s,'source_quota_ledger_invalid');const record=await read(path.join(folder,name));
    check(validRecord(record),'source_quota_slot_invalid');
    if(c){check(record.key===c[1]&&Object.keys(record).length===6,'source_quota_claim_invalid');claims.set(record.key,record);}
    else {check(record.index===Number(s[1])&&Object.keys(record).length===7,'source_quota_slot_invalid');slots.push(record);}
  }
  slots.sort((a,b)=>a.index-b.index);
  check(slots.length===claims.size&&slots.length<=totalLimit-policy.legacyReservationCount
    &&new Set(slots.map(row=>row.key)).size===slots.length,'source_quota_allocation_incomplete');
  for(let index=0;index<slots.length;index++) {
    const {index:position,...body}=slots[index];check(position===index&&json(body)===json(claims.get(body.key)),'source_quota_allocation_incomplete');
  }
  return {claims,slots};
}

async function extensionState(directory,folder,policy,extension,manifestFile) {
  const file=path.join(folder,'authorization-extension.json');
  const anchorFile=path.join(directory,`source-quota-extension-${sha(policy.jobId)}.json`);
  const current=await optional(file),anchor=await optional(anchorFile);
  // Paired append-only witnesses make a lost extension or interrupted publish
  // an integrity hold. No fallback to the old per-run/current-job allowance.
  check(Boolean(current)===Boolean(anchor),'source_quota_extension_incomplete');
  if(!extension){check(!current,'source_quota_extension_unavailable');return {limit:policy.totalLimit,persist:async()=>{}};}
  extension=parseSourceReviewQuotaExtension(extension,policy);
  const record={schema:'wis-source-review-quota-extension-record-v1',extension,baseManifestSha256:sha(await regular(manifestFile))};
  const witness={schema:'wis-source-review-quota-extension-anchor-v1',jobId:policy.jobId,
    authorizationId:extension.authorizationId,recordSha256:sha(json(record))};
  if(current)check(json(current)===json(record)&&json(anchor)===json(witness),'source_quota_extension_changed');
  return {limit:extension.totalLimit,authorizationId:extension.authorizationId,persist:async()=>{
    if(current)return;
    // Caller holds the existing job allocator lock and has already validated
    // every original claim/slot. A crash between these writes stays closed.
    await exclusive(file,record);await exclusive(anchorFile,witness);
  }};
}

// Receipts and claims are append-only. An interrupted allocation holds the
// ledger; a complete reserved slot always counts even when dispatch is unknown.
export async function reserveSourceReviewQuota({directory,policy,extension=null,jobId,runId,key,now=Date.now}) {
  check(valid(runId)&&hash(key),'source_quota_request_invalid');
  await safeDirectory(directory);
  const existingRun=await optional(path.join(directory,`source-quota-run-${sha(runId)}.json`));
  if(existingRun)check(existingRun.runId===runId&&existingRun.jobId===jobId&&policy?.jobId===jobId
    &&existingRun.authorizationId===policy.authorizationId,'source_quota_policy_unavailable');
  const folder=valid(jobId)?path.join(directory,`source-quota-${sha(jobId)}`):null;
  if(!policy||jobId!==policy.jobId) {
    // Once this job has entered the private cumulative ledger, losing its
    // policy must never recreate a per-run allowance on restart.
    if(folder) {
      let exists=false;try{await fs.lstat(folder);exists=true;}catch(error){if(error.code!=='ENOENT')throw error;}
      check(!exists,'source_quota_policy_unavailable');
    }
    if(policy?.legacyRunIds?.includes(runId))throw Error('source_quota_job_context_required');
    return null;
  }
  policy=parseSourceReviewQuotaPolicy(policy);
  let folderExisted=false;try{await fs.lstat(folder);folderExisted=true;}catch(error){if(error.code!=='ENOENT')throw error;}
  if(!folderExisted) {
    const names=await fs.readdir(directory);
    for(const name of names.filter(name=>/^source-quota-run-[a-f0-9]{64}\.json$/.test(name)))
      check((await read(path.join(directory,name))).jobId!==jobId,'source_quota_manifest_missing');
  }
  await safeDirectory(folder);
  const baseline=await legacySnapshot(directory,policy),manifestFile=path.join(folder,'manifest.json');
  const expected={schema,policy,baseline};
  let manifest=await optional(manifestFile);
  if(!manifest) {
    const names=await fs.readdir(directory);let remembered=false;
    for(const name of names.filter(name=>/^source-quota-run-[a-f0-9]{64}\.json$/.test(name)))
      if((await read(path.join(directory,name))).jobId===jobId)remembered=true;
    if(remembered) {
      // Another initializer may just have published it. A truly lost manifest
      // cannot be recreated even if someone left an empty directory behind.
      manifest=await optional(manifestFile);check(manifest,'source_quota_manifest_missing');
    }
  }
  if(!manifest) {
    // A nonempty directory with no manifest is damaged, not a new allowance.
    check((await fs.readdir(folder)).every(name=>/^\.quota-[a-f0-9-]+\.tmp$/.test(name)||name==='manifest.json'),'source_quota_manifest_missing');
    try{await exclusive(manifestFile,expected);}catch(error){if(error.code!=='EEXIST')throw error;}
    manifest=await read(manifestFile);
  }
  check(json(manifest)===json(expected),'source_quota_baseline_changed');
  for(const originalRun of policy.legacyRunIds)await claimRun(directory,policy,originalRun);
  await claimRun(directory,policy,runId);
  const release=await lockLedger(folder);
  try {
    check(json(await legacySnapshot(directory,policy))===json(baseline),'source_quota_baseline_changed');
    check(json(await read(manifestFile))===json(expected),'source_quota_baseline_changed');
    const grant=await extensionState(directory,folder,policy,extension,manifestFile);
    const {claims,slots}=await existingAllocations(folder,policy,grant.limit);
    await grant.persist();
    const extensionEvidence=grant.authorizationId?{extensionAuthorizationId:grant.authorizationId}:{};
    if(claims.has(key)||baseline.some(row=>row.key===key))return {reserved:false,reason:'source_quota_request_already_reserved',limit:grant.limit,
      ...extensionEvidence,
      used:baseline.length+slots.length,scope:'job',authorizationId:policy.authorizationId};
    const index=slots.length;
    if(index>=grant.limit-baseline.length)return {reserved:false,reason:'budget_exhausted',limit:grant.limit,
      ...extensionEvidence,used:grant.limit,scope:'job',authorizationId:policy.authorizationId};
    const base={schema,authorizationId:policy.authorizationId,jobId,runId,key,at:new Date(now()).toISOString()};
    await exclusive(path.join(folder,`claim-${key}.json`),base);
    await exclusive(path.join(folder,`slot-${index}.json`),{...base,index});
    return {reserved:true,limit:grant.limit,used:baseline.length+index+1,scope:'job',authorizationId:policy.authorizationId,index,...extensionEvidence};
  }finally{await release();}
}
