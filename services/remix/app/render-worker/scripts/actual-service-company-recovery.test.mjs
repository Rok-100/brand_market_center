// Actual service, byte-pinned stock and real local hashes. All media/Cloud
// responses here are synthetic; never a production/company approval claim.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createClipRemixService} from '../clip-remix-service.mjs';
import {createHistoricalMediaVerifier} from '../historical-media-verifier.mjs';
import {createHistoricalApprovedInventory,HISTORICAL_INVENTORY_JOB as JOB} from '../historical-approved-inventory.mjs';
import {companyClipExcluded,applyCompanyReject,createExistingCompanyPassContext,isCompanyRunExhausted} from '../company-reject-recovery.mjs';
import {bindingState} from '../output-review-binding.mjs';
const reference=await fs.readFile(new URL('../../worker-tests/fixtures/historical-success-reference-20261003.json',import.meta.url));
const baseline=JSON.parse(reference),OWNER={sub:'FD-026222',name:'synthetic owner'},TARGET={advertiserId:'1869672250595328',planId:'1870289794646204'};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){for(let i=0;i<1800;i++){const value=await fn();if(value)return value;await sleep(10);}throw Error('company recovery fixture timeout');}
async function fixture(t,{defaultVerdict='pending',afterFeedback,mutateSeed,afterInspect}={}){
 const env={WIS_REMIX_SOURCE_REVIEW_ENABLED:'true',WIS_REMIX_VISUAL_REVIEW_ENABLED:'true',WIS_REMIX_VISION_PROVIDER:'fandow',JUMP_LLM_URL:'https://example.invalid',JUMP_LLM_TOKEN:'synthetic',JUMP_LLM_APPLICATION:'fixture',JUMP_LLM_PROVIDER:'fixture',JUMP_LLM_VISION_MODEL:'fixture'};
 const prior=Object.fromEntries(Object.keys(env).map(k=>[k,process.env[k]]));Object.assign(process.env,env);
 t.after(()=>{for(const[k,v]of Object.entries(prior)){if(v===undefined)delete process.env[k];else process.env[k]=v;}});
 let schedulerTick=()=>{};
 t.mock.method(globalThis,'setInterval',(callback,ms)=>{if(ms===30_000)schedulerTick=callback;return {unref(){}};});t.mock.method(globalThis,'fetch',async()=>{throw Error('No real network/model allowed');});
 const dataDir=await fs.mkdtemp(path.join(os.tmpdir(),'wis-company-recovery-')),root=path.join(dataDir,'clip-remix'),libraryPath=path.join(root,'library.json');
 for(const dir of ['clips','sources','outputs'])await fs.mkdir(path.join(root,dir),{recursive:true});
 const clips=baseline.clips.map(row=>Object.fromEntries(['id','sourceId','name','role','reviewStatus','reviewedAt','reviewNote','reviewedById','contentSha256','storedName','startSeconds','endSeconds','durationSeconds','productCategory','visibility'].map(k=>[k,row[k]])));
 const sources=[...new Map(baseline.clips.map(row=>[row.sourceId,{id:row.sourceId,storedName:row.sourceStoredName,contentSha256:row.sourceContentSha256,productCategory:row.sourceProductCategory,skuVersion:row.skuVersion,visibility:row.sourceVisibility,materialCenterAssetId:row.sourceAssetId,hasAudio:true,createdById:OWNER.sub}])).values()];
 for(const clip of clips)await fs.writeFile(path.join(root,'clips',clip.storedName),'synthetic clip '+clip.id);
 const job={id:JOB,name:'exact company recovery',createdById:OWNER.sub,createdByName:OWNER.name,status:'paused',scheduleEnabled:false,frameworkId:'f',productCategory:'黑晶面膜',dailyTarget:2,targetDurationSeconds:90,sourceSelectionLimit:3,
  includeUsageDisclaimer:true,usageDisclaimerText:'产品使用效果因人而异',autoApproveOutputs:true,autoReturnAfterApproval:true,qianchuanDelivery:{enabled:true,confirmed:true,deliveryLimitMode:'unlimited',targets:[TARGET]},
  runs:[{id:'original-run',status:'awaiting_sources',targetCount:2,targetDurationSeconds:90,renderIds:[],selectedSourceIds:['preserved'],versionPreparationAttempts:{old:{complete:true,attempts:3}},slotSelections:{},generatedCount:0,failedCount:0,attemptedCount:0,consecutiveReviewFailures:2,startCursor:0}]};
 const seed={version:10,sources,clips,renders:[],folders:[],autoJobs:[job,...Array.from({length:27},(_,i)=>({...structuredClone(job),id:'untouched-'+i,runs:[],nextRunAt:null}))],
  frameworks:[{id:'f',name:'five roles',visibility:'team',slots:['hook','pain','solution','proof','cta'].map(id=>({id,label:id}))}],
  verifiedAutoRemixIdentities:[{userId:OWNER.sub,userName:OWNER.name,verifiedAt:'2026-01-01',lastSeenAt:'2026-01-01',source:'oa'}],autoRemixGrants:[{userId:OWNER.sub,userName:OWNER.name,verifiedAt:'2026-01-01'}]};
 if(mutateSeed)mutateSeed(seed);await fs.writeFile(libraryPath,JSON.stringify(seed));
 const counters={renders:0,asr:0,sourceReview:0,returns:0,uploads:0,pushes:0,retries:0,feedback:0},returns=new Map(),tasks=new Map(),decisions=new Map(),durations=new Map();let service;
 const read=async()=>{
  // Windows replacement can briefly rename library.json to .previous. Read
  // only the current file after that bounded swap; never use stale recovery
  // bytes or hide permanent absence, invalid JSON, or other filesystem errors.
  for(let attempt=0;;attempt++){
   try{return JSON.parse(await fs.readFile(libraryPath,'utf8'));}
   catch(error){if(error.code!=='ENOENT'||attempt>=20)throw error;await sleep(10);}
  }
 };const f={root,read,counters,decisions,returns,tasks,defaultVerdict};
 const resultFor=key=>({status:'completed',assetAvailable:true,assetId:returns.get(key).assetId});
 const options={dataDir,autoRemixAdminUsers:'test-admin',nowIso:()=>new Date().toISOString(),historicalApprovedInventory:createHistoricalApprovedInventory(reference),historicalMediaVerifierFactory:createHistoricalMediaVerifier,
  localAsrRunner:{ensureSourceEvidence:async()=>{counters.asr++;throw Error('No ASR');}},sourceSemanticReviewer:{assess:async()=>{counters.sourceReview++;throw Error('No source fee');}},
  inspectMedia:async file=>{if(afterInspect)await afterInspect(f,file);return {duration:durations.get(file)||clips.find(c=>c.storedName===path.basename(file))?.durationSeconds||90,width:1080,height:1920,hasAudio:true,frameRate:30};},
  runProcess:async()=>({stdout:'',stderr:''}),makeSegment:async()=>{throw Error('No new cuts');},
  runFfmpeg:async args=>{counters.renders++;const lines=(await fs.readFile(args[args.indexOf('-i')+1],'utf8')).trim().split('\n');durations.set(args.at(-1),lines.reduce((n,line)=>n+clips.find(c=>line.includes(c.storedName)).durationSeconds,0));await fs.writeFile(args.at(-1),'output '+path.basename(args.at(-1)));},
  readJsonBody:async req=>req.body||{},jsonResponse:(res,status,body)=>Object.assign(res,{status,body}),cutter:{configured:false},
  materialCenter:{configured:true,listAssets:async()=>({items:[],pageSize:100,total:0}),
   verifyQianchuanTarget:async target=>({verified:true,authorized:true,account:{id:target.advertiserId},plan:{id:target.planId,canAttachVideo:true}}),
   createReturn:async body=>{counters.returns++;assert.equal(returns.has(body.idempotency_key),false,'original MP4 must not be reuploaded');returns.set(body.idempotency_key,{...body,assetId:100+returns.size});return {id:body.idempotency_key};},
   uploadReturnFile:async()=>{counters.uploads++;},completeReturn:async key=>resultFor(key),getReturn:async key=>resultFor(key),
   getReturnFeedback:async args=>{counters.feedback++;const row=returns.get(args.idempotencyKey),library=await read(),render=library.renders.find(r=>r.id===row.render_id),variant=render.variants.find(v=>v.id===row.variant_id);
    const decision=decisions.get(row.assetId)||f.defaultVerdict;
    const review={asset_id:row.assetId,return_sha256:row.sha256,actor_number:OWNER.sub,render_id:row.render_id,variant_id:row.variant_id,submission_id:'submission-'+row.assetId,job_id:'company-'+row.assetId,task_id:'task-'+row.assetId,
     status:decision==='pending'?'pending':'success',ready:decision!=='pending',verdict:decision,error_code:'',requested_revision:2,verified_revision:2,result_revision:counters.feedback,last_verified_at:new Date().toISOString(),file_hash:row.sha256,
     duration_ms:variant.actualDurationSeconds*1000,rule_version:'synthetic-v1',snapshot_matches:true,current_verified:decision!=='pending',findings_complete:true,
     findings:decision==='reject'?[{tier:'red',shadow:false,rule_code:'R4',evidence:'synthetic specific finding',time_start_ms:100,time_end_ms:100}]:[]};
    if(afterFeedback)await afterFeedback(f,review);return {assetId:row.assetId,assetAvailable:true,complete:true,items:[],companyReview:review};},
   pushQianchuan:async body=>{counters.pushes++;const task={id:'delivery-'+body.asset_id,status:'success',platformAssetId:'video-'+body.asset_id,bindingVerifiedAt:new Date().toISOString(),advertiserId:TARGET.advertiserId,planId:TARGET.planId};tasks.set(body.idempotency_key,task);return {status:'success',task};},
   getQianchuanDelivery:async key=>({task:tasks.get(key)}),retryQianchuanDelivery:async key=>{counters.retries++;return {task:tasks.get(key)};}}};
 const create=()=>{service=createClipRemixService(options);};create();
 f.route=async(method,url,body={})=>{const res={};await service.route({method,headers:{},body},res,new URL('http://localhost'+url),OWNER);return res;};
 f.idle=async()=>{await until(()=>!service.runtimeState().activeAutoJobCount&&!service.runtimeState().activeClipReplenishmentJobCount);await sleep(100);};
 f.wait=async predicate=>until(async()=>{schedulerTick();const value=await read();return predicate(value)&&value;});
 f.start=async()=>{const r=await f.route('POST',`/api/remix/automation/jobs/${JOB}/run-now`);assert.equal(r.status,200,JSON.stringify(r));};
 f.poll=async mutate=>{await f.idle();const library=await read();for(const r of library.renders)for(const v of r.variants||[])if(v.cloudDeliveryFeedback)v.cloudDeliveryFeedback.nextPollAt='2000-01-01T00:00:00Z';
   if(mutate)await mutate(library);await fs.writeFile(libraryPath,JSON.stringify(library));create();await service.initialize();await sleep(100);};
 await service.initialize();t.after(async()=>{await f.route('POST',`/api/remix/automation/jobs/${JOB}/pause`);await f.idle();await fs.rm(dataDir,{recursive:true,force:true,maxRetries:5,retryDelay:25});});return f;
}
const outputRows=library=>library.renders.filter(r=>r.automation?.jobId===JOB).flatMap(r=>r.variants||[]);

// R21: obtain all eight attempts through the real scheduler/rules/return path.
// The first PASS is genuinely bound by the synthetic native delivery adapter;
// each subsequent replacement fills only the remaining one-output target gap.
async function mixedRunAtEight(t){
 const f=await fixture(t);await f.start();
 const first=await f.wait(l=>outputRows(l).length===2&&outputRows(l).every(v=>v.cloudDeliveryFeedback));
 const passedAsset=outputRows(first)[0].materialCenterReturn.assetId;
 for(let count=2;count<8;count++){
  await f.idle();const current=await f.read();assert.equal(outputRows(current).length,count);
  for(const v of outputRows(current))f.decisions.set(v.materialCenterReturn.assetId,v.materialCenterReturn.assetId===passedAsset?'pass':'reject');
  await f.poll();
  await f.wait(l=>outputRows(l).length===count+1&&outputRows(l).every(v=>v.cloudDeliveryFeedback)
   &&outputRows(l).find(v=>v.materialCenterReturn?.assetId===passedAsset)?.qianchuanDeliveries?.[0]?.status==='success');
 }
 await f.idle();const before=await f.read();
 assert.equal(before.autoJobs[0].runs.length,1);assert.equal(before.autoJobs[0].runs[0].attemptedCount,8);
 assert.equal(f.counters.pushes,1);assert.equal(f.counters.returns,8);
 return {f,passedAsset,before};
}

test('actual mixed8 terminal keeps one genuinely bound PASS and seven rejects as failed 1/2, then continues same job without reupload',async t=>{
 const {f,passedAsset,before}=await mixedRunAtEight(t);
 for(const v of outputRows(before))f.decisions.set(v.materialCenterReturn.assetId,v.materialCenterReturn.assetId===passedAsset?'pass':'reject');
 const originalEvidence=library=>library.renders.filter(r=>r.automation?.runId==='original-run').map(r=>({id:r.id,variants:r.variants.map(v=>({
  id:v.id,sha:v.contentSha256,assessment:v.automaticAssessment,generationBinding:v.generationBinding,
  reviewBinding:v.reviewBinding,historicalInventoryReview:v.historicalInventoryReview,materialCenterReturn:v.materialCenterReturn}))}));
 const preserved=structuredClone(originalEvidence(before));
 await f.poll();await f.wait(l=>outputRows(l).length===10&&outputRows(l).every(v=>v.cloudDeliveryFeedback));await f.idle();
 const saved=await f.read(),job=saved.autoJobs[0],run=job.runs.find(r=>r.id==='original-run');
 assert.equal(run.status,'failed');assert.equal(run.generatedCount,1);assert.equal(run.failedCount,7);assert.equal(run.attemptedCount,8);
 assert.equal(run.companyExhaustion.version,'company-terminal-exhausted-v1');assert.equal(run.companyExhaustion.attemptLimit,8);
 assert.equal(run.companyExhaustion.outputs.length,8);assert.equal(run.companyRepair.required,false);
 assert.equal(run.companyExhaustion.outputs.filter(row=>row.outcome==='company_pass_bound').length,1);
 assert.equal(run.companyExhaustion.outputs.filter(row=>row.outcome==='company_rejected').length,7);
 const terminalPass=run.companyExhaustion.outputs.find(row=>row.outcome==='company_pass_bound');
 const passed=outputRows(saved).find(v=>v.materialCenterReturn?.assetId===passedAsset),delivery=passed.qianchuanDeliveries[0];
 assert.equal(terminalPass.assetId,passedAsset);assert.equal(terminalPass.delivery.idempotencyKey,delivery.idempotencyKey);
 assert.equal(terminalPass.delivery.taskId,delivery.taskId);assert.equal(terminalPass.delivery.platformAssetId,delivery.platformAssetId);
 assert.equal(delivery.status,'success');assert.equal(delivery.advertiserId,TARGET.advertiserId);assert.equal(delivery.planId,TARGET.planId);
 assert.equal(job.runs.length,2);assert.equal(job.sequenceReservations.length,10);
 assert.equal(f.counters.renders,10);assert.equal(f.counters.returns,10);assert.equal(f.counters.uploads,10);assert.equal(f.counters.pushes,1);
 assert.deepEqual(originalEvidence(saved),preserved);assert.deepEqual(saved.autoJobs.slice(1),before.autoJobs.slice(1));
 const oldDelivery=structuredClone(delivery),marker=structuredClone(run.companyExhaustion);
 await f.poll();await f.idle();const after=await f.read();
 assert.equal(f.counters.renders,10);assert.equal(f.counters.returns,10);assert.equal(f.counters.pushes,1);assert.equal(f.counters.retries,0);
 assert.deepEqual(outputRows(after).find(v=>v.materialCenterReturn?.assetId===passedAsset).qianchuanDeliveries[0],oldDelivery);
 assert.deepEqual(after.autoJobs[0].runs.find(r=>r.id==='original-run').companyExhaustion,marker);
 assert.equal(f.counters.asr+f.counters.sourceReview,0);
});

for(const problem of ['pass-unbound','latest-company-unknown'])test('actual mixed8 '+problem+' cannot terminalize or start another run',async t=>{
 const {f,passedAsset,before}=await mixedRunAtEight(t);
 for(const v of outputRows(before))f.decisions.set(v.materialCenterReturn.assetId,v.materialCenterReturn.assetId===passedAsset?(problem==='latest-company-unknown'?'pending':'pass'):'reject');
 await f.poll(library=>{
  const passed=outputRows(library).find(v=>v.materialCenterReturn?.assetId===passedAsset);
  if(problem==='latest-company-unknown'){
   // Model an already observed newer pending response, not an unread remote
   // change whose polling order could legitimately follow terminal accounting.
   passed.cloudDeliveryFeedback.companyReview={...passed.cloudDeliveryFeedback.companyReview,
    status:'pending',ready:false,verdict:'pending',current_verified:false,last_verified_at:new Date().toISOString()};
   return;
  }
  const state=passed.qianchuanDeliveries[0];
  state.status='partial';state.bindingVerifiedAt=null;state.errorMessage='目标计划素材回读暂不可用';
  state.nextRetryAt=new Date(Date.now()+3600000).toISOString();
  f.tasks.set(state.idempotencyKey,{id:state.taskId,status:'partial',platformAssetId:state.platformAssetId,...TARGET,bindingVerifiedAt:null});
 });
 await f.wait(l=>outputRows(l).filter(v=>v.companyReview?.status==='rejected').length===7);await f.idle();
 const saved=await f.read(),run=saved.autoJobs[0].runs.find(r=>r.id==='original-run');
 assert.equal(run.companyExhaustion,undefined);assert.notEqual(run.status,'failed');assert.equal(run.attemptedCount,8);
 assert.equal(saved.autoJobs[0].runs.length,1);assert.equal(saved.autoJobs[0].sequenceReservations.length,8);
 assert.equal(f.counters.renders,8);assert.equal(f.counters.returns,8);assert.equal(f.counters.pushes,1);assert.equal(f.counters.retries,0);
 assert.deepEqual(saved.autoJobs.slice(1),before.autoJobs.slice(1));assert.equal(f.counters.asr+f.counters.sourceReview,0);
});

// R23 keeps the two captured, never-returned drafts byte-identical. They are
// not synthetic approved outputs and never receive a company receipt or file
// recovery. The other six attempts use this fixture's actual service pipeline.
async function abandonedRunAtEight(t){
 const bytes=await fs.readFile(new URL('../../worker-tests/fixtures/r23-exact-abandoned-drafts.json',import.meta.url));
 assert.equal(createHash('sha256').update(bytes).digest('hex'),'963ef19dbaff27a687fc7fd38d146567d12d6d1bff880317322ec3673a28724f');
 const captured=JSON.parse(bytes),draftIds=new Set(captured.renders.map(r=>r.id));
 assert.equal(captured.jobId,JOB);assert.equal(captured.runId,'91267275-95ff-46ca-bda5-f6c2ebc01e40');assert.equal(captured.pairStable,true);
 const metadataBytes=await fs.readFile(new URL('../../worker-tests/fixtures/r23-legacy-input-metadata.json',import.meta.url));
 assert.equal(createHash('sha256').update(metadataBytes).digest('hex'),'d24de799abd04a68e7500bbb44e1795ab12079b86fa7a75ee339a21195e09c59');
 const metadata=JSON.parse(metadataBytes);
 assert.equal(metadata.sourceSnapshotSha256,'82492f166d0aad7584aea05a4e069b40b1f66f031be5f4c073a98ff78939d2e0');
 assert.equal(metadata.clips.length,75);assert.equal(metadata.sources.length,2);
 for(const render of captured.renders)for(const variant of render.variants)assert.equal(bindingState(render,variant,metadata).reason,null);
 const f=await fixture(t,{mutateSeed:library=>{
  library.renders=structuredClone(captured.renders);
  // Real, previously captured metadata only: keep the existing revalidator
  // enabled and prove the original input bindings, without recreating media,
  // changing approvals or granting these unapproved drafts any delivery rights.
  for(const type of ['clips','sources'])for(const row of metadata[type]){
   assert.equal(library[type].some(existing=>existing.id===row.id),false);
   library[type].push(structuredClone(row));
  }
  const run=library.autoJobs[0].runs[0];run.id=captured.runId;run.renderIds=[...draftIds];run.attemptedCount=2;run.failedCount=2;
 }});
 const nativeRows=library=>outputRows(library).filter(v=>v.reviewMode==='automatic_rules');
 await f.start();const first=await f.wait(l=>nativeRows(l).length===2&&nativeRows(l).every(v=>v.cloudDeliveryFeedback));await f.idle();
 const passedAsset=nativeRows(first)[0].materialCenterReturn.assetId;
 for(let count=4;count<8;count++){
  const current=await f.read();assert.equal(outputRows(current).length,count);
  for(const v of nativeRows(current))f.decisions.set(v.materialCenterReturn.assetId,v.materialCenterReturn.assetId===passedAsset?'pass':'reject');
  await f.poll();await f.wait(l=>outputRows(l).length===count+1&&nativeRows(l).every(v=>v.cloudDeliveryFeedback)
   &&nativeRows(l).find(v=>v.materialCenterReturn.assetId===passedAsset)?.qianchuanDeliveries?.[0]?.status==='success');await f.idle();
 }
 const before=await f.read();assert.equal(before.autoJobs[0].runs[0].attemptedCount,8);
 assert.deepEqual(before.renders.filter(r=>draftIds.has(r.id)),captured.renders);
 assert.equal(f.counters.renders,6);assert.equal(f.counters.returns,6);assert.equal(f.counters.pushes,1);
 return {f,captured,draftIds,nativeRows,passedAsset,before};
}

for(const problem of ['none','draft-mutated','latest-company-unknown','pass-unbound','owner-revoked','new-draft','paused'])
test('actual exact abandoned drafts terminal: '+problem,async t=>{
 const {f,captured,draftIds,nativeRows,passedAsset,before}=await abandonedRunAtEight(t);
 const retained=library=>library.renders.filter(r=>r.automation?.runId===captured.runId).map(r=>({id:r.id,variants:r.variants.map(v=>({id:v.id,
  sha:v.contentSha256,assessment:v.automaticAssessment,generationBinding:v.generationBinding,reviewBinding:v.reviewBinding,
  historicalInventoryReview:v.historicalInventoryReview,materialCenterReturn:v.materialCenterReturn}))}));
 const originalEvidence=structuredClone(retained(before));
 for(const v of nativeRows(before))f.decisions.set(v.materialCenterReturn.assetId,v.materialCenterReturn.assetId===passedAsset?'pass':'reject');
 await f.poll(library=>{
  const job=library.autoJobs[0],draft=library.renders.find(r=>draftIds.has(r.id));
  const pass=nativeRows(library).find(v=>v.materialCenterReturn.assetId===passedAsset);
  // Record all current synthetic native rejections, exactly as the normal
  // feedback consumer does; this does not alter the captured two old drafts.
  for(const render of library.renders)for(const variant of render.variants||[]){
   if(variant.reviewMode!=='automatic_rules'||variant.materialCenterReturn.assetId===passedAsset)continue;
   const review={...variant.cloudDeliveryFeedback.companyReview,status:'success',ready:true,verdict:'reject',current_verified:true,
    last_verified_at:new Date().toISOString(),findings_complete:true,
    findings:[{tier:'red',shadow:false,rule_code:'R4',evidence:'synthetic definitive native rejection',time_start_ms:100,time_end_ms:100}]};
   variant.cloudDeliveryFeedback.companyReview=review;variant.cloudDeliveryFeedback.nextPollAt=new Date(Date.now()+60000).toISOString();
   assert.equal(applyCompanyReject({library,renderId:render.id,variantId:variant.id,review,
    now:new Date().toISOString(),ownerAuthorized:true}).accepted,true);
  }
  if(problem==='draft-mutated')draft.variants[0].automaticAssessment.score=93;
  if(problem==='new-draft'){
   const oldId=draft.id;draft.id='unapproved-new-draft';
   job.runs.find(r=>r.id===captured.runId).renderIds=job.runs.find(r=>r.id===captured.runId).renderIds.map(id=>id===oldId?draft.id:id);
  }
  if(problem==='latest-company-unknown'){
   const rejected=nativeRows(library).find(v=>v.materialCenterReturn.assetId!==passedAsset);
   rejected.cloudDeliveryFeedback.companyReview={...rejected.cloudDeliveryFeedback.companyReview,
    status:'pending',ready:false,verdict:'pending',current_verified:false};
  }
  if(problem==='pass-unbound'){
   const state=pass.qianchuanDeliveries[0];state.status='partial';state.bindingVerifiedAt=null;
   state.errorMessage='目标计划素材回读暂不可用';state.nextRetryAt=new Date(Date.now()+3600000).toISOString();
   f.tasks.set(state.idempotencyKey,{id:state.taskId,status:'partial',platformAssetId:state.platformAssetId,...TARGET,bindingVerifiedAt:null});
  }
  if(problem==='owner-revoked')library.autoRemixGrants=[];
  if(problem==='paused'){job.status='paused';job.nextRunAt=null;}
 });
 if(problem==='none')await f.wait(l=>outputRows(l).length===10&&nativeRows(l).every(v=>v.cloudDeliveryFeedback));
 await f.idle();const saved=await f.read(),job=saved.autoJobs[0],run=job.runs.find(r=>r.id===captured.runId);
 assert.equal(run.attemptedCount,8);
 const stopped=['owner-revoked','paused'].includes(problem),previousRun=before.autoJobs[0].runs.find(r=>r.id===captured.runId);
 // Pausing/revoking access must also prevent a fresh accounting write. The
 // last local-approved output had not yet entered the saved failure totals.
 assert.equal(run.generatedCount,stopped?previousRun.generatedCount:1);
 assert.equal(run.failedCount,stopped?previousRun.failedCount:7);
 assert.equal(f.counters.pushes,1);assert.equal(f.counters.retries,0);assert.equal(f.counters.asr+f.counters.sourceReview,0);
 assert.deepEqual(saved.autoJobs.slice(1),before.autoJobs.slice(1));
 assert.equal([...f.returns.values()].some(row=>draftIds.has(row.render_id)||row.render_id==='unapproved-new-draft'),false,'neither old draft is returned or uploaded');
 if(problem==='none'){
  assert.equal(run.status,'failed');assert.equal(run.companyRepair.required,false);
  assert.equal(run.companyExhaustion.version,'company-terminal-with-abandoned-drafts-v1');assert.equal(run.companyExhaustion.outputs.length,8);
  assert.equal(run.companyExhaustion.outputs.filter(r=>r.outcome==='abandoned_unapproved').length,2);
  assert.equal(run.companyExhaustion.outputs.filter(r=>r.outcome==='company_rejected').length,5);
  assert.equal(run.companyExhaustion.outputs.filter(r=>r.outcome==='company_pass_bound').length,1);
  assert.equal(job.runs.length,2);assert.equal(f.counters.renders,8);assert.equal(f.counters.returns,8);assert.equal(f.counters.uploads,8);
  assert.deepEqual(saved.renders.filter(r=>draftIds.has(r.id)),captured.renders);assert.deepEqual(retained(saved),originalEvidence);
  const marker=structuredClone(run.companyExhaustion),draftBytes=JSON.stringify(captured.renders);
  for(let tick=0;tick<3;tick++){
   await f.poll();await f.wait(l=>outputRows(l).length===10);await f.idle();const after=await f.read();
   const afterJob=after.autoJobs[0],afterRun=afterJob.runs.find(r=>r.id===captured.runId);
   assert.deepEqual(afterRun.companyExhaustion,marker);assert.equal(isCompanyRunExhausted(after,afterJob,afterRun),true);
   assert.equal(JSON.stringify(after.renders.filter(r=>draftIds.has(r.id))),draftBytes,'normal revalidation cannot mutate the captured abandoned drafts');
   assert.deepEqual(retained(after),originalEvidence);assert.deepEqual(afterJob.sequenceReservations,job.sequenceReservations);
   assert.deepEqual(after.autoJobs.slice(1),before.autoJobs.slice(1));assert.equal(afterJob.runs.length,2);
   assert.equal(f.counters.renders,8);assert.equal(f.counters.returns,8);assert.equal(f.counters.pushes,1);
   assert.equal(f.counters.retries+f.counters.asr+f.counters.sourceReview,0);
  }
 }else{
  assert.equal(run.companyExhaustion,undefined);assert.notEqual(run.status,'failed');assert.equal(job.runs.length,1);
  assert.equal(f.counters.renders,6);assert.equal(f.counters.returns,6);assert.equal(f.counters.uploads,6);
  assert.deepEqual(job.sequenceReservations,before.autoJobs[0].sequenceReservations);
  if(stopped)assert.equal(JSON.stringify(saved.renders.filter(r=>draftIds.has(r.id))),JSON.stringify(captured.renders));
  if(problem==='paused'){assert.equal(job.status,'paused');assert.equal(job.nextRunAt,null);}
 }
});
test('actual service company pending waits without uploading to ads or producing another batch',async t=>{
 const f=await fixture(t);await f.start();await f.wait(l=>outputRows(l).length===2&&outputRows(l).every(v=>v.cloudDeliveryFeedback));await f.idle();
 const before=await f.read();assert.equal(f.counters.renders,2);assert.equal(f.counters.returns,2);assert.equal(f.counters.pushes,0);assert.equal(before.autoJobs[0].nextRunAt,null);
 await f.poll();const after=await f.read();assert.equal(f.counters.renders,2);assert.equal(f.counters.returns,2);assert.equal(after.autoJobs[0].runs.length,1);
 assert.deepEqual(after.autoJobs.slice(1),before.autoJobs.slice(1));assert.equal(f.counters.asr+f.counters.sourceReview,0);
});
test('actual service owner one resume automatically produces company-passed/bound 20, never 21, keeps 27 paused jobs',async t=>{
 const f=await fixture(t,{defaultVerdict:'pass'}),before=await f.read();await f.start();
 const saved=await f.wait(l=>outputRows(l).filter(v=>v.qianchuanDeliveries?.some(s=>s.status==='success'&&s.bindingVerifiedAt)).length===20);await f.idle();
 assert.equal(f.counters.renders,20);assert.equal(f.counters.returns,20);assert.equal(f.counters.pushes,20);assert.equal(saved.autoJobs[0].runs.length,10);
 assert.ok(outputRows(saved).every(v=>v.companyReview?.status==='passed'&&v.reviewMode==='automatic_rules'&&v.automaticAssessment.checks.every(c=>c.passed)));
 assert.equal((await f.read()).autoJobs[0].nextRunAt,null);assert.deepEqual((await f.read()).autoJobs.slice(1),before.autoJobs.slice(1));
 await f.poll();assert.equal(f.counters.renders,20);assert.equal(f.counters.uploads,20);assert.equal(f.counters.asr+f.counters.sourceReview,0);
});
test('actual service exact company reject reopens original run, excludes mapped clip, preserves checks and never uploads rejected MP4 twice',async t=>{
 const f=await fixture(t);await f.start();const first=await f.wait(l=>outputRows(l).length===2&&outputRows(l).every(v=>v.cloudDeliveryFeedback));await f.idle();
 const originals=structuredClone(outputRows(first));for(const v of originals)f.decisions.set(v.materialCenterReturn.assetId,'reject');
 await f.poll();await f.wait(l=>outputRows(l).length===4&&outputRows(l).filter(v=>v.companyReview?.status==='rejected').length===2);await f.idle();const saved=await f.read();
 assert.equal(saved.autoJobs[0].runs.length,1);assert.equal(saved.autoJobs[0].runs[0].id,'original-run');assert.equal(saved.autoJobs[0].runs[0].attemptedCount,4);
 for(const old of originals){const actual=outputRows(saved).find(v=>v.contentSha256===old.contentSha256);assert.equal(actual.reviewStatus,'changes_requested');assert.deepEqual(actual.automaticAssessment,old.automaticAssessment);assert.equal(actual.contentSha256,old.contentSha256);}
 for(const v of outputRows(saved).filter(v=>!v.companyReview))assert.ok(v.clipSequence.every(id=>!companyClipExcluded(saved.autoJobs[0],saved.clips.find(c=>c.id===id))));
 assert.deepEqual(saved.clips,first.clips);assert.deepEqual(saved.sources,first.sources);assert.equal(f.counters.returns,4);assert.equal(f.counters.pushes,0);
 assert.equal(saved.autoJobs[0].sequenceReservations.length,4);assert.equal(f.counters.asr+f.counters.sourceReview,0);
});
test('actual service existing platform video only retries same task binding after verified company pass, never uploads that file again',async t=>{
 const f=await fixture(t);await f.start();const first=await f.wait(l=>outputRows(l).length===2&&outputRows(l).every(v=>v.cloudDeliveryFeedback));await f.idle();
 const shas=outputRows(first).map(v=>v.contentSha256);for(const v of outputRows(first))f.decisions.set(v.materialCenterReturn.assetId,'pass');
 await f.poll(l=>{for(const v of outputRows(l)){
  const key='existing-task-'+v.materialCenterReturn.assetId,platformAssetId='existing-video-'+v.materialCenterReturn.assetId;
  v.qianchuanDeliveries=[{idempotencyKey:key,taskId:key,status:'partial',platformAssetId,...TARGET,errorMessage:'公司素材审核尚未放行',failureStage:'plan_binding',nextRetryAt:null}];
  f.tasks.set(key,{id:key,status:'success',platformAssetId,...TARGET,bindingVerifiedAt:new Date().toISOString()});
 }});
 const saved=await f.wait(l=>outputRows(l).filter(v=>shas.includes(v.contentSha256)).every(v=>v.qianchuanDeliveries?.[0]?.status==='success'));await f.idle();
 assert.equal(f.counters.retries,2);assert.equal(f.counters.pushes,0);assert.ok(outputRows(saved).filter(v=>shas.includes(v.contentSha256)).every(v=>v.qianchuanDeliveries[0].platformAssetId.startsWith('existing-video-')));
 assert.equal(f.counters.returns,f.counters.renders,'no rejected/returned bytes are reuploaded');
});
test('actual restart all prior receipts passed and bound overrides future cadence only for original active job',async t=>{
 const f=await fixture(t);await f.start();await f.wait(l=>outputRows(l).length===2&&outputRows(l).every(v=>v.cloudDeliveryFeedback));await f.idle();
 await f.poll(l=>{for(const r of l.renders)for(const v of r.variants){
  const review={...v.cloudDeliveryFeedback.companyReview,status:'success',ready:true,verdict:'pass',current_verified:true};
  v.cloudDeliveryFeedback.companyReview=review;v.cloudDeliveryFeedback.nextPollAt=new Date(Date.now()+60000).toISOString();
  applyCompanyReject({library:l,renderId:r.id,variantId:v.id,review,now:new Date().toISOString(),ownerAuthorized:true});
  v.qianchuanDeliveries=[{status:'success',platformAssetId:'saved-'+v.materialCenterReturn.assetId,bindingVerifiedAt:new Date().toISOString(),...TARGET}];
 }
 l.autoJobs[0].nextRunAt=new Date(Date.now()+86400000).toISOString();});
 const saved=await f.wait(l=>outputRows(l).length===4);assert.equal(saved.autoJobs[0].runs.length,2);assert.ok(saved.autoJobs.slice(1).every(j=>j.status==='paused'&&j.nextRunAt===null));
});
test('actual service eight current company rejections close the failed original run and continue without resetting 8/run or ledgers',async t=>{
 const f=await fixture(t);await f.start();await f.wait(l=>outputRows(l).length===2&&outputRows(l).every(v=>v.cloudDeliveryFeedback));
 for(let count=2;count<=8;count+=2){await f.idle();const current=await f.read();for(const v of outputRows(current))f.decisions.set(v.materialCenterReturn.assetId,'reject');
  await f.poll();if(count<8)await f.wait(l=>outputRows(l).length===count+2&&outputRows(l).filter(v=>!v.companyReview).every(v=>v.cloudDeliveryFeedback));
 }
 await f.wait(l=>outputRows(l).length===10&&outputRows(l).filter(v=>!v.companyReview).every(v=>v.cloudDeliveryFeedback));await f.idle();
 const saved=await f.read(),original=saved.autoJobs[0].runs.find(run=>run.id==='original-run');
 assert.equal(f.counters.renders,10);assert.equal(f.counters.returns,10);assert.equal(f.counters.pushes,0);assert.equal(saved.autoJobs[0].runs.length,2);
 assert.equal(original.status,'failed');assert.equal(original.attemptedCount,8);assert.equal(original.failedCount,8);assert.equal(original.generatedCount,0);
 assert.equal(original.companyExhaustion.version,'company-rejected-exhausted-v1');assert.equal(original.companyExhaustion.outputs.length,8);
 assert.equal(saved.autoJobs[0].sequenceReservations.length,10);assert.equal(saved.autoJobs[0].nextRunAt,null);
 assert.ok(saved.autoJobs.slice(1).every(job=>job.status==='paused'&&job.nextRunAt===null));
 const retained=library=>library.renders.filter(render=>render.automation.runId==='original-run').map(render=>({id:render.id,
  variants:render.variants.map(v=>({id:v.id,sha:v.contentSha256,assessment:v.automaticAssessment,generationBinding:v.generationBinding,
   reviewBinding:v.reviewBinding,historicalInventoryReview:v.historicalInventoryReview,companyReview:v.companyReview}))}));
 const prior=structuredClone(retained(saved));
 await f.poll();assert.equal(f.counters.renders,10);assert.equal(f.counters.returns,10);
 assert.deepEqual(retained(await f.read()),prior);
 assert.equal(f.counters.asr+f.counters.sourceReview,0);
});

test('actual fresh rejection avoids already-stored cross-source sentence before replacement rendering; no recognition or upload retry',async t=>{
 const seeded=new Map();
 const f=await fixture(t,{mutateSeed:library=>{
  for(const [index,clip]of library.clips.filter(clip=>clip.role==='hook').entries()){
   const source=library.sources.find(source=>source.id===clip.sourceId);
   const label=`已存文案分组${index%4}毛孔感觉都变小了`;
   source.speechSegments=[...(source.speechSegments||[]),{id:'existing-text-'+clip.id,startSeconds:clip.startSeconds,endSeconds:clip.endSeconds,
    transcriptSource:'cutter',label}];seeded.set(clip.id,label);
  }
 },afterFeedback:async(currentFixture,review)=>{if(review.verdict==='reject'){
  const library=await currentFixture.read(),render=library.renders.find(r=>r.id===review.render_id),variant=render.variants.find(v=>v.id===review.variant_id);
  review.findings[0].evidence='[synthetic specific finding] '+seeded.get(variant.clipSequence[0]);
 }}});
 await f.start();const first=await f.wait(l=>outputRows(l).length===2&&outputRows(l).every(v=>v.cloudDeliveryFeedback));await f.idle();
 const originals=outputRows(first),used=new Set(originals.flatMap(v=>v.clipSequence));
 assert.ok(originals.every(v=>seeded.has(v.clipSequence[0])),'the actual first two opening clips carry the stored sentence');
 const originalLabels=new Set(originals.map(v=>seeded.get(v.clipSequence[0])));
 const aliases=[...seeded].filter(([id,label])=>!used.has(id)&&originalLabels.has(label)).map(([id])=>id);assert.ok(aliases.length>0);
 for(const v of originals)f.decisions.set(v.materialCenterReturn.assetId,'reject');
 await f.poll();await f.wait(l=>outputRows(l).length===4&&outputRows(l).filter(v=>!v.companyReview).every(v=>v.cloudDeliveryFeedback));await f.idle();
 const saved=await f.read(),newRows=outputRows(saved).filter(v=>!v.companyReview);
 for(const id of aliases){assert.equal(companyClipExcluded(saved.autoJobs[0],saved.clips.find(c=>c.id===id)),true);assert.ok(newRows.every(v=>!v.clipSequence.includes(id)));}
 assert.deepEqual(saved.sources,first.sources);assert.deepEqual(saved.clips,first.clips);
 assert.equal(f.counters.renders,4);assert.equal(f.counters.returns,4);assert.equal(f.counters.asr+f.counters.sourceReview,0);
});

test('actual eight company rejections cannot close a run whose original technical assessment became review_required',async t=>{
 const f=await fixture(t);await f.start();await f.wait(l=>outputRows(l).length===2&&outputRows(l).every(v=>v.cloudDeliveryFeedback));
 for(let count=2;count<=8;count+=2){await f.idle();const current=await f.read();for(const v of outputRows(current))f.decisions.set(v.materialCenterReturn.assetId,'reject');
  await f.poll(count===8?library=>{const original=outputRows(library).find(v=>v.companyReview?.status==='rejected');
   assert.equal(original.automaticAssessment.checks.length,16);original.automaticAssessment.status='review_required';original.automaticAssessment.autoApproved=false;
  }:undefined);
  if(count<8)await f.wait(l=>outputRows(l).length===count+2&&outputRows(l).filter(v=>!v.companyReview).every(v=>v.cloudDeliveryFeedback));
 }
 await f.wait(l=>l.autoJobs[0].runs.find(run=>run.id==='original-run').automaticReviewHold?.reason==='PROGRESSIVE_RUN_ATTEMPT_LIMIT');await f.idle();
 const saved=await f.read(),run=saved.autoJobs[0].runs.find(run=>run.id==='original-run');
 assert.equal(run.status,'awaiting_review');assert.equal(run.companyExhaustion,undefined);assert.equal(run.attemptedCount,8);
 assert.equal(saved.autoJobs[0].runs.length,1);assert.equal(saved.autoJobs[0].nextRunAt,null);assert.equal(f.counters.renders,8);assert.equal(f.counters.returns,8);
 assert.ok(outputRows(saved).every(v=>v.companyReview?.status==='rejected'));assert.equal(f.counters.pushes,0);assert.equal(f.counters.asr+f.counters.sourceReview,0);
});
for(const problem of ['paused','foreign-sha','stale','pending','owner-revoked','output-bytes'])test('actual company feedback '+problem+' cannot reject/reopen or wake paused jobs',async t=>{
 let armed=false;const f=await fixture(t,{afterFeedback:async(f,review)=>{if(!armed)return;if(problem==='foreign-sha')review.file_hash='b'.repeat(64);if(problem==='stale')review.verified_revision=1;if(problem==='pending'){review.status='pending';review.current_verified=false;}if(problem==='paused')await f.route('POST',`/api/remix/automation/jobs/${JOB}/pause`);}});
 await f.start();const first=await f.wait(l=>outputRows(l).length===2&&outputRows(l).every(v=>v.cloudDeliveryFeedback));await f.idle();for(const v of outputRows(first))f.decisions.set(v.materialCenterReturn.assetId,'reject');armed=true;
 await f.poll(async l=>{if(problem==='owner-revoked')l.autoRemixGrants=[];if(problem==='output-bytes')for(const v of outputRows(l))await fs.appendFile(path.join(f.root,'outputs',v.storedName),'changed');});
 await f.idle();const after=await f.read();assert.equal(after.autoJobs[0].companyRejectRecovery,undefined);assert.equal(f.counters.renders,2);assert.equal(f.counters.returns,2);assert.equal(f.counters.pushes,0);
 assert.ok(outputRows(after).every(v=>v.companyReview===undefined));if(problem==='paused'){assert.equal(after.autoJobs[0].status,'paused');assert.equal(after.autoJobs[0].nextRunAt,null);}
});

// Mature the already-returned synthetic native receipts, preserving the actual
// service-created MP4 hashes, sixteen checks and measured input snapshots.
function installSiblingR15AndPass(library,{rule='R15',platformVideo=false}={}){
 const render=library.renders.find(r=>r.automation?.jobId===JOB),[sibling,target]=render.variants;
 const shared=sibling.clipSequence.find(id=>target.clipSequence.includes(id));assert.ok(shared,'actual planner has a shared input');
 const index=sibling.clipSequence.indexOf(shared),evidence=sibling.historicalInventoryReview.input.evidence;
 const start=evidence.slice(0,index).reduce((n,item)=>n+item.snapshot.currentMedia.durationSeconds,0),duration=evidence[index].snapshot.currentMedia.durationSeconds;
 const rejection={...sibling.cloudDeliveryFeedback.companyReview,status:'success',ready:true,verdict:'reject',current_verified:true,
  last_verified_at:new Date().toISOString(),findings_complete:true,findings:[{tier:'red',shadow:false,rule_code:rule,evidence:'synthetic contextual R15 finding',
   time_start_ms:(start+duration/2)*1000,time_end_ms:(start+duration/2)*1000}]};
 const pass={...target.cloudDeliveryFeedback.companyReview,status:'success',ready:true,verdict:'pass',current_verified:true,last_verified_at:new Date().toISOString(),findings:[]};
 for(const [variant,review]of [[sibling,rejection],[target,pass]]){
  variant.cloudDeliveryFeedback.companyReview=review;variant.cloudDeliveryFeedback.nextPollAt=new Date(Date.now()+60000).toISOString();
  assert.equal(applyCompanyReject({library,renderId:render.id,variantId:variant.id,review,now:new Date().toISOString(),ownerAuthorized:true}).accepted,true);
 }
 const key=`wis-remix:${render.id}:${target.id}:${target.materialCenterReturn.assetId}:${TARGET.advertiserId}:${TARGET.planId}`;
 target.qianchuanDeliveries=[{...TARGET,idempotencyKey:key,status:platformVideo?'partial':'failed',
  ...(platformVideo?{taskId:key,platformAssetId:'existing-platform-video'}:{}),
  errorMessage:'成片来源协议或审核状态不可用（historical_inventory_rules_invalid），未继续回传或投放。',nextRetryAt:'2000-01-01T00:00:00Z'}];
 return {renderId:render.id,targetId:target.id,siblingId:sibling.id,shared,key,sha:target.contentSha256};
}
for(const platformVideo of [false,true])test('actual existing company PASS ignores only sibling R15 for '+(platformVideo?'same-video binding retry':'original idempotent push'),async t=>{
 const f=await fixture(t);await f.start();await f.wait(l=>outputRows(l).length===2&&outputRows(l).every(v=>v.cloudDeliveryFeedback));await f.idle();
 const before=await f.read(),oldRows=structuredClone(outputRows(before));let ids;
 await f.poll(l=>{ids=installSiblingR15AndPass(l,{platformVideo});if(platformVideo)f.tasks.set(ids.key,{id:ids.key,status:'success',platformAssetId:'existing-platform-video',...TARGET,bindingVerifiedAt:new Date().toISOString()});});
 await f.wait(l=>l.renders.find(r=>r.id===ids.renderId)?.variants.find(v=>v.id===ids.targetId)?.qianchuanDeliveries?.[0]?.status==='success');await f.idle();
 await f.wait(l=>outputRows(l).every(v=>v.materialCenterReturn?.status==='completed'));
 const saved=await f.read(),render=saved.renders.find(r=>r.id===ids.renderId),target=render.variants.find(v=>v.id===ids.targetId),job=saved.autoJobs.find(j=>j.id===JOB),clip=saved.clips.find(c=>c.id===ids.shared);
 assert.equal(target.qianchuanDeliveries[0].idempotencyKey,ids.key);assert.equal(target.contentSha256,ids.sha);
 assert.deepEqual(target.automaticAssessment,oldRows.find(v=>v.id===ids.targetId).automaticAssessment);assert.equal(target.automaticAssessment.checks.length,16);
 assert.equal(render.variants.find(v=>v.id===ids.siblingId).reviewStatus,'changes_requested');assert.equal(companyClipExcluded(job,clip),true);
 const inventory=createHistoricalApprovedInventory(reference),context=createExistingCompanyPassContext({library:saved,renderId:render.id,variantId:target.id});
 assert.equal(inventory.planningAssess({clip,source:saved.sources.find(s=>s.id===clip.sourceId),job,identity:{id:OWNER.sub},canReadSource:()=>true,canReadClip:()=>true,existingOutputContext:context}).candidate,false);
 assert.equal(f.counters.pushes,platformVideo?0:1);assert.equal(f.counters.retries,platformVideo?1:0);
 assert.equal(f.counters.returns,f.counters.renders);assert.equal(f.counters.uploads,f.counters.returns);assert.equal(f.counters.asr+f.counters.sourceReview,0);
 assert.deepEqual(saved.clips,before.clips);assert.deepEqual(saved.sources,before.sources);
});
for(const problem of ['R1','unknown-rule','pause-during-media','bytes-during-media'])test('actual existing company PASS still blocks '+problem,async t=>{
 let armed=false,intercepted=false;const f=await fixture(t,{afterInspect:async(current,file)=>{
  if(!armed||intercepted||!file.includes(path.sep+'clips'+path.sep))return;
  if(problem==='pause-during-media'){intercepted=true;await current.route('POST',`/api/remix/automation/jobs/${JOB}/pause`);}
  if(problem==='bytes-during-media'){intercepted=true;await fs.appendFile(file,'changed during inspection');}
 }});
 await f.start();await f.wait(l=>outputRows(l).length===2&&outputRows(l).every(v=>v.cloudDeliveryFeedback));await f.idle();let ids;
 await f.poll(l=>{ids=installSiblingR15AndPass(l,{rule:problem==='R1'?'R1':problem==='unknown-rule'?'R4':'R15'});armed=true;});
 await f.wait(l=>l.renders.find(r=>r.id===ids.renderId).variants.find(v=>v.id===ids.targetId).qianchuanDeliveries[0].retryCount>=1);await f.idle();
 const saved=await f.read(),target=saved.renders.find(r=>r.id===ids.renderId).variants.find(v=>v.id===ids.targetId);
 assert.equal(target.qianchuanDeliveries[0].status,'failed');assert.equal(f.counters.pushes+f.counters.retries,0);assert.equal(f.counters.returns,2);
 assert.equal(target.reviewStatus,'approved');assert.equal(target.automaticAssessment.checks.length,16);assert.equal(target.automaticAssessment.status,'passed');
 if(problem.endsWith('during-media'))assert.equal(intercepted,true);if(problem==='pause-during-media')assert.equal(saved.autoJobs[0].status,'paused');
 assert.equal(f.counters.asr+f.counters.sourceReview,0);
});

// R22: both renders, their files/checks/input snapshots and the first native
// binding are produced by the real service path. Only company/network replies
// are synthetic. A later rejected composition must not revoke a separately
// passed MP4, but the full source receipt still defines every exception.
for(const problem of ['R15','R1','R5','foreign-receipt-render'])test('actual cross-render existing PASS: '+problem,async t=>{
 const f=await fixture(t);await f.start();
 const first=await f.wait(l=>outputRows(l).length===2&&outputRows(l).every(v=>v.cloudDeliveryFeedback));await f.idle();
 const firstRenderId=first.renders.find(r=>r.automation?.jobId===JOB).id;
 for(const variant of outputRows(first))f.decisions.set(variant.materialCenterReturn.assetId,'pass');
 await f.poll();
 await f.wait(l=>outputRows(l).length===4&&outputRows(l).every(v=>v.cloudDeliveryFeedback)
  &&l.renders.find(r=>r.id===firstRenderId).variants.every(v=>v.qianchuanDeliveries?.[0]?.status==='success'));
 await f.idle();const before=await f.read(),counts={...f.counters};let ids;
 await f.poll(library=>{
  const passedRender=library.renders.find(r=>r.id===firstRenderId);
  const rejectedRender=library.renders.find(r=>r.automation?.jobId===JOB&&r.id!==firstRenderId);
  const pairs=passedRender.variants.flatMap(target=>rejectedRender.variants.map(rejected=>({target,rejected,
   shared:rejected.clipSequence.find(id=>target.clipSequence.includes(id))})));
  const pair=pairs.find(row=>row.shared);assert.ok(pair,'actual distinct render plans share a current historical input');
  const {target,rejected,shared}=pair,index=rejected.clipSequence.indexOf(shared);
  const evidence=rejected.historicalInventoryReview.input.evidence;
  const start=evidence.slice(0,index).reduce((sum,item)=>sum+item.snapshot.currentMedia.durationSeconds,0);
  const at=(start+evidence[index].snapshot.currentMedia.durationSeconds/2)*1000;
  const review={...rejected.cloudDeliveryFeedback.companyReview,status:'success',ready:true,verdict:'reject',current_verified:true,
   last_verified_at:new Date().toISOString(),findings_complete:true,
   findings:[{tier:'red',shadow:false,rule_code:problem==='R1'?'R1':problem==='R5'?'R5':'R15',
    evidence:'synthetic authoritative cross-composition finding',time_start_ms:at,time_end_ms:at}]};
  rejected.cloudDeliveryFeedback.companyReview=review;
  rejected.cloudDeliveryFeedback.nextPollAt=new Date(Date.now()+60000).toISOString();
  assert.equal(applyCompanyReject({library,renderId:rejectedRender.id,variantId:rejected.id,review,
   now:new Date().toISOString(),ownerAuthorized:true}).accepted,true);
  const delivery=target.qianchuanDeliveries[0];assert.ok(delivery.taskId&&delivery.platformAssetId&&delivery.bindingVerifiedAt);
  ids={renderId:passedRender.id,targetId:target.id,rejectedRenderId:rejectedRender.id,rejectedId:rejected.id,shared,
   key:delivery.idempotencyKey,taskId:delivery.taskId,videoId:delivery.platformAssetId,sha:target.contentSha256};
  target.qianchuanDeliveries=[{...delivery,status:'partial',bindingVerifiedAt:null,
   errorMessage:'成片来源协议或审核状态不可用（historical_inventory_rules_invalid），未继续回传或投放。',
   nextRetryAt:'2000-01-01T00:00:00Z',nextPollAt:null}];
  target.qianchuanDelivery=structuredClone(target.qianchuanDeliveries[0]);
  target.cloudDeliveryFeedback.nextPollAt=new Date(Date.now()+60000).toISOString();
  f.tasks.set(ids.key,{id:ids.taskId,status:'success',platformAssetId:ids.videoId,...TARGET,bindingVerifiedAt:new Date().toISOString()});
  if(problem==='foreign-receipt-render')rejectedRender.automation.jobId='untouched-0';
 });
 await f.idle();const saved=await f.read(),render=saved.renders.find(r=>r.id===ids.renderId);
 const target=render.variants.find(v=>v.id===ids.targetId),delivery=target.qianchuanDeliveries[0];
 const previous=before.renders.find(r=>r.id===ids.renderId).variants.find(v=>v.id===ids.targetId);
 assert.equal(f.counters.retries-counts.retries,problem==='R15'?1:0);
 assert.equal(delivery.status==='success',problem==='R15');
 assert.equal(delivery.idempotencyKey,ids.key);assert.equal(delivery.taskId,ids.taskId);assert.equal(delivery.platformAssetId,ids.videoId);
 assert.equal(target.contentSha256,ids.sha);assert.equal(target.reviewStatus,'approved');
 assert.deepEqual(target.automaticAssessment,previous.automaticAssessment);assert.equal(target.automaticAssessment.checks.length,16);
 assert.deepEqual(target.generationBinding,previous.generationBinding);assert.deepEqual(target.reviewBinding,previous.reviewBinding);
 assert.deepEqual(target.historicalInventoryReview,previous.historicalInventoryReview);
 assert.equal(f.counters.pushes,counts.pushes);assert.equal(f.counters.renders,counts.renders);
 assert.equal(f.counters.returns,counts.returns);assert.equal(f.counters.uploads,counts.uploads);
 assert.deepEqual(saved.clips,before.clips);assert.deepEqual(saved.sources,before.sources);
 assert.deepEqual(saved.autoJobs.slice(1),before.autoJobs.slice(1));
 assert.deepEqual(saved.autoJobs[0].sequenceReservations,before.autoJobs[0].sequenceReservations);
 assert.deepEqual(saved.autoJobs[0].runs.map(r=>({id:r.id,attemptedCount:r.attemptedCount})),
  before.autoJobs[0].runs.map(r=>({id:r.id,attemptedCount:r.attemptedCount})));
 const job=saved.autoJobs[0],clip=saved.clips.find(c=>c.id===ids.shared),source=saved.sources.find(s=>s.id===clip.sourceId);
 assert.equal(companyClipExcluded(job,clip),true,'future planning still avoids every company-excluded input');
 assert.equal(createHistoricalApprovedInventory(reference).planningAssess({clip,source,job,identity:{id:OWNER.sub},
  canReadSource:()=>true,canReadClip:()=>true}).candidate,false);
 assert.equal(f.counters.asr+f.counters.sourceReview,0);
});

const PLAN_READ_PENDING='目标计划素材回读暂不可用，尚不能确定是否已经加入；已保留原视频，暂不重复添加';
for(const [problem,extraError]of [
 ['exact-readback-transient',''],
 ['permission-denied','；无权限'],
 ['plan-invalid','；目标计划无效'],
 ['plan-unavailable','；目标计划不可用'],
 ['material-unavailable','；素材不可用'],
 ['near-match-not-exempt',''],
 ['source-revoked',''],
 ['source-private',''],
 ['owner-revoked',''],
 ['paused',''],
 ['company-pending',''],
])test('actual same-key existing-video retry classification: '+problem,async t=>{
 const f=await fixture(t,{mutateSeed:library=>{
  library.autoJobs[0].qianchuanDelivery.deliveryLimitMode='limited';
  library.autoJobs[0].qianchuanDelivery.dailyMaterialLimit=20;
  library.autoJobs[0].qianchuanDelivery.dailySpendGuardYuan=100000;
 }});
 await f.start();await f.wait(l=>outputRows(l).length===2&&outputRows(l).every(v=>v.cloudDeliveryFeedback));await f.idle();
 const before=await f.read(),beforeCounters={...f.counters};let ids;
 await f.poll(library=>{
  const render=library.renders.find(r=>r.automation?.jobId===JOB),target=render.variants[1];
  const key=`wis-remix:${render.id}:${target.id}:${target.materialCenterReturn.assetId}:${TARGET.advertiserId}:${TARGET.planId}`;
  ids={renderId:render.id,variantId:target.id,key,sha:target.contentSha256};
  if(problem!=='company-pending'){
   const review={...target.cloudDeliveryFeedback.companyReview,status:'success',ready:true,verdict:'pass',current_verified:true,
    last_verified_at:new Date().toISOString(),findings:[]};
   target.cloudDeliveryFeedback.companyReview=review;
   target.cloudDeliveryFeedback.nextPollAt=new Date(Date.now()+60000).toISOString();
   assert.equal(applyCompanyReject({library,renderId:render.id,variantId:target.id,review,now:new Date().toISOString(),ownerAuthorized:true}).accepted,true);
   f.decisions.set(target.materialCenterReturn.assetId,'pass');
  }
  const message=(problem==='near-match-not-exempt'?PLAN_READ_PENDING.replace('回读暂不可用','回读不可用'):PLAN_READ_PENDING)+extraError;
  const state={...TARGET,idempotencyKey:key,taskId:'existing-delivery-task',platformAssetId:'existing-platform-video',
   status:'partial',message:'素材已进入账户素材库，但该计划未完成绑定：'+message,errorMessage:message,
   errorAdvice:'千川已受理但回读有延迟；等待 1—3 分钟后点击重试，系统会先查计划并避免重复添加。',
   failureStage:'plan_binding',nextRetryAt:null,nextPollAt:null};
  target.qianchuanDeliveries=[state];target.qianchuanDelivery=structuredClone(state);
  f.tasks.set(key,{id:state.taskId,status:'success',platformAssetId:state.platformAssetId,...TARGET,bindingVerifiedAt:new Date().toISOString()});
  const job=library.autoJobs.find(j=>j.id===JOB),source=library.sources.find(s=>s.id===library.clips.find(c=>c.id===target.clipSequence[0]).sourceId);
  if(problem==='source-revoked')source.revoked=true;
  if(problem==='source-private'){source.visibility='private';source.createdById='FD-999999';}
  if(problem==='owner-revoked')library.autoRemixGrants=[];
  if(problem==='paused'){job.status='paused';job.nextRunAt=null;}
 });
 await f.idle();const saved=await f.read(),target=saved.renders.find(r=>r.id===ids.renderId).variants.find(v=>v.id===ids.variantId),state=target.qianchuanDeliveries[0];
 const expected=problem==='exact-readback-transient'?1:0;
 assert.equal(f.counters.retries-beforeCounters.retries,expected,'only the exact temporary plan-read failure can retry');
 assert.equal(f.counters.pushes,beforeCounters.pushes,'never upload/recreate a task instead of retrying existing video');
 assert.equal(f.counters.renders,beforeCounters.renders);assert.equal(f.counters.returns,beforeCounters.returns);assert.equal(f.counters.uploads,beforeCounters.uploads);
 assert.equal(state.idempotencyKey,ids.key);assert.equal(state.taskId,'existing-delivery-task');assert.equal(state.platformAssetId,'existing-platform-video');
 assert.equal(target.contentSha256,ids.sha);assert.equal(state.status==='success',expected===1);
 const expectedAssessment=structuredClone(outputRows(before).find(v=>v.contentSha256===ids.sha).automaticAssessment);
 if(problem==='source-revoked'||problem==='source-private')expectedAssessment.autoApproved=false;
 assert.deepEqual(target.automaticAssessment,expectedAssessment,'source revocation still invalidates automatic approval; all original checks remain intact');
 assert.deepEqual(saved.autoJobs[0].qianchuanDelivery,before.autoJobs[0].qianchuanDelivery);
 assert.deepEqual(saved.autoJobs[0].sequenceReservations,before.autoJobs[0].sequenceReservations);
 assert.equal(saved.autoJobs[0].runs[0].attemptedCount,before.autoJobs[0].runs[0].attemptedCount);
 assert.deepEqual(saved.autoJobs.slice(1),before.autoJobs.slice(1));assert.equal(f.counters.asr+f.counters.sourceReview,0);
});
