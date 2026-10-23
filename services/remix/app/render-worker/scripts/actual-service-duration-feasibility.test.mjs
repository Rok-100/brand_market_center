// Actual route/scheduler/storage tests. Local synthetic media probes and an
// unavailable ASR double; no real inference, approval, upload or advertising.
import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {createHash} from 'node:crypto';import {createClipRemixService} from '../clip-remix-service.mjs';
import {combineLegacySourceResolvers,R9_ADDITIVE_SOURCE_IDS} from '../combine-legacy-source-resolvers.mjs';
import {combineSourceEvidenceResolvers} from '../source-evidence-resolver.mjs';
const sha=value=>createHash('sha256').update(value).digest('hex'),sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const OWNER={sub:'FI-000001',name:'Synthetic on-demand owner'};
async function until(fn,label){for(let i=0;i<500;i++){const result=await fn();if(result)return result;await sleep(20);}throw Error('Timeout '+label);}
const text=await fs.readFile(new URL('./actual-service-on-demand-source.test.mjs',import.meta.url),'utf8');
const originalBody=text.slice(text.indexOf('async function fixture('),text.indexOf("\ntest('actual normal job:"));
function fixtureFor({durations=[110,79.2,75.28,72.84,72.44],progressive=true,setup=()=>{},probe}={}){
 let body=originalBody.replace('[900,25,117,110,90].entries()','durations.entries()');
 if(progressive)body=body.replace('sourceVersionResolver:resolver,',"sourceVersionResolver:resolver,progressiveSourcePreparationJobIds:['old-idle'],");
 body=body.replace('return {hasVideo:true,duration:sources.find(s=>s.storedName===path.basename(file))?.durationSeconds};',
  'return probe?await probe(file,sources):{hasVideo:true,duration:sources.find(s=>s.storedName===path.basename(file))?.durationSeconds};');
 body=body.replace('  await service.initialize();',"  const seed=JSON.parse(await fs.readFile(libraryFile,'utf8'));await setup(seed);await fs.writeFile(libraryFile,JSON.stringify(seed));created.push('old-idle');await service.initialize();");
 body=body.replace('return {calls,read,route,create,start,','return {root,libraryFile,calls,read,route,create,start,');
 return new Function('test','assert','fs','os','path','createClipRemixService','sha','sleep','OWNER','until','durations','setup','probe',
  body+';return fixture;')(test,assert,fs,os,path,createClipRemixService,sha,sleep,OWNER,until,durations,setup,probe);
}
function terminalFirst(seed){const job=seed.autoJobs.find(j=>j.id==='old-idle');
 job.runs=[{id:'original-run',status:'awaiting_sources',targetCount:2,targetDurationSeconds:90,renderIds:['original-failures'],
  selectedSourceIds:['source-0'],selectedAssetIds:[],createdClipIds:[],stageReports:[],slotSelections:{},consecutiveReviewFailures:2,
  onDemandSourcePreparation:{mode:'bounded-on-demand-v1',limit:3,sourceIds:['source-0']},
  versionPreparationAttempts:{'source-0':{key:sha('source-0'),complete:true,attemptedAt:'2026-10-03T00:00:00Z',attempts:1}}}];
 seed.sources[0].sourceSemanticReview={recoverable:false,pendingReasons:[],passedCount:0};
 seed.renders=[{id:'original-failures',automation:{jobId:'old-idle',runId:'original-run'},productCategory:'黑晶面膜',
  variants:[1,2].map(i=>({id:String(i),reviewStatus:'changes_requested',clipSequence:[],
   automaticAssessment:{visualReview:{status:'review_required',reason:'content_attention',issues:[{kind:'synthetic'}]}}}))}];
 return job;
}
test('actual all-short catalog holds structurally before ASR, preserving original failures and preparation ledger',async t=>{
 const f=await fixtureFor({setup:terminalFirst})(t),before=await f.read(),job=await f.start('old-idle');
 const run=job.runs[0];assert.equal(run.automaticReviewHold.reason,'PROGRESSIVE_SOURCE_DURATION_EXHAUSTED');
 assert.equal(run.automaticReviewHold.kind,'source_feasibility');assert.equal(job.nextRunAt,null);
 assert.equal(run.id,'original-run');assert.equal(run.consecutiveReviewFailures,2);assert.equal(run.attemptedCount,2);
 assert.deepEqual(run.versionPreparationAttempts,before.autoJobs.find(j=>j.id===job.id).runs[0].versionPreparationAttempts);
 assert.equal(job.progressiveSourcePreparation,undefined,'A failed dry plan must not allocate short sources');
 assert.equal(job.sourceDurationFeasibility.records.length,5);
 assert.equal(job.sourceDurationFeasibility.records.filter(r=>r.status==='structural_incompatible').length,4);
 assert.ok(job.sourceDurationFeasibility.records.every(r=>r.approvalGranted===false&&r.contentRejected===false));
 assert.deepEqual(f.calls.asr,[]);assert.equal(f.calls.models,0);assert.equal(f.calls.cloud,0);
 assert.deepEqual((await f.read()).sources,before.sources);assert.deepEqual((await f.read()).renders,before.renders);
 const probes=f.calls.probes.length,again=await f.start('old-idle');
 assert.equal(again.runs.length,1);assert.equal(f.calls.probes.length,probes,'Same SHA/target reuses real-probe evidence, not a new probe');
 assert.equal(again.progressiveSourcePreparation,undefined);assert.equal(again.runs[0].attemptedCount,2);
 await f.tick();assert.equal(f.calls.probes.length,probes,'Structural hold has no automatic busy retry');
});
test('actual newly registered long sources append only to the same verified catalog and keep original counts',async t=>{
 const f=await fixtureFor({durations:[110,125,106,100.45,71],setup:seed=>{
  const job=terminalFirst(seed);job.progressiveSourcePreparation={version:'bounded-history-v1',batchLimit:3,sourceLimit:20,
   outputAttemptLimit:80,catalog:[{sourceId:'source-0',key:sha('source-0'),sourceSha256:seed.sources[0].contentSha256}],
   sourceIds:['source-0'],batches:[{sourceIds:['source-0'],selectedAt:'original',inherited:true}],attempts:{},attemptedFloor:2,createdAt:'original'};
 }})(t),before=await f.read(),original=before.autoJobs.find(j=>j.id==='old-idle').progressiveSourcePreparation;
 const job=await f.start('old-idle');assert.equal(job.runs[0].id,'original-run');assert.equal(job.runs[0].consecutiveReviewFailures,2);
 assert.equal(job.runs[0].attemptedCount,2);assert.equal(job.progressiveSourcePreparation.attemptedFloor,2);
 assert.deepEqual(job.progressiveSourcePreparation.catalog[0],original.catalog[0]);
 assert.deepEqual(job.progressiveSourcePreparation.batches[0],original.batches[0]);assert.equal(job.progressiveSourcePreparation.createdAt,'original');
 assert.deepEqual(job.progressiveSourcePreparation.sourceIds,['source-0','source-3','source-2','source-1']);
 assert.deepEqual([...f.calls.asr].sort(),['source-1','source-2','source-3']);assert.equal(f.calls.models,0);
 assert.ok(['source-1','source-2','source-3'].every(id=>job.sourceDurationFeasibility.records.some(r=>r.sourceId===id&&r.status==='feasible')));
 const again=await f.start('old-idle');assert.equal(again.progressiveSourcePreparation.sourceIds.length,4);
 assert.equal(f.calls.asr.length,3,'Unknown original ASR outcomes cannot be bypassed by another registration');
 assert.deepEqual((await f.read()).sources,before.sources);
 // The normal reconcile pass may append its existing policy-revalidation
 // annotation to these synthetic old receipts. It cannot alter their failures.
 const saved=(await f.read()).renders;assert.equal(saved.length,before.renders.length);
 assert.deepEqual(saved[0].variants.map(v=>({id:v.id,reviewStatus:v.reviewStatus,visual:v.automaticAssessment.visualReview})),
  before.renders[0].variants.map(v=>({id:v.id,reviewStatus:v.reviewStatus,visual:v.automaticAssessment.visualReview})));
});
for(const scenario of ['unknown','mismatch'])test(`actual ${scenario} probe fails closed, not structural rejection or a model call`,async t=>{
 const f=await fixtureFor({setup:terminalFirst,probe:async(_file,sources)=>scenario==='unknown'?{hasVideo:false,duration:110}:{hasVideo:true,duration:111}})(t);
 const before=await f.read(),job=await f.start('old-idle');
 assert.equal(job.runs[0].automaticReviewHold.reason,scenario==='unknown'?'SOURCE_DURATION_EVIDENCE_UNAVAILABLE':'SOURCE_DURATION_METADATA_MISMATCH');
 assert.equal(job.sourceDurationFeasibility,undefined);assert.equal(job.nextRunAt,null);
 assert.equal(job.progressiveSourcePreparation,undefined);assert.deepEqual(f.calls.asr,[]);assert.equal(f.calls.models,0);
 assert.deepEqual((await f.read()).sources,before.sources);assert.deepEqual((await f.read()).renders,before.renders);
});
test('actual pause while local probe awaits prevents cache/selection/ASR writes and leaves nextRunAt null',async t=>{
 let f;f=await fixtureFor({setup:terminalFirst,probe:async()=>{
  const result=await f.route('POST','/api/remix/automation/jobs/old-idle/pause');assert.equal(result.status,200);
  return {hasVideo:true,duration:110};}})(t);
 assert.equal((await f.route('POST','/api/remix/automation/jobs/old-idle/run-now')).status,200);
 await until(()=>f.calls.probes.length>0&&!f.service.runtimeState().activeAutoJobCount,'paused probe settled');
 const job=(await f.read()).autoJobs.find(j=>j.id==='old-idle');assert.equal(job.status,'paused');assert.equal(job.nextRunAt,null);
 assert.equal(job.sourceDurationFeasibility,undefined);assert.equal(job.progressiveSourcePreparation,undefined);
 assert.deepEqual(f.calls.asr,[]);assert.equal(f.calls.models,0);assert.equal(job.runs[0].consecutiveReviewFailures,2);
});
test('actual metadata/source mutation during probe cannot commit a stale duration plan',async t=>{
 let f;f=await fixtureFor({setup:terminalFirst,probe:async(file)=>{
  // Exact local media mutation, not a manufactured approval or provider call.
  await fs.appendFile(file,'changed while probing');return {hasVideo:true,duration:110};}})(t);
 const job=await f.start('old-idle');assert.equal(job.runs[0].automaticReviewHold.reason,'SOURCE_DURATION_INPUT_CHANGED');
 assert.equal(job.sourceDurationFeasibility,undefined);assert.equal(job.progressiveSourcePreparation,undefined);
 assert.deepEqual(f.calls.asr,[]);assert.equal(f.calls.models,0);
});
test('actual non-progressive legacy preparation rejects a short source before ASR and preserves pending review',async t=>{
 const f=await fixtureFor({progressive:false,durations:[79,78,77,76,75]})(t),id=await f.create(),before=await f.read();
 const job=await f.start(id);assert.equal(job.runs[0].automaticReviewHold.reason,'SOURCE_DURATION_INFEASIBLE');
 assert.equal(job.runs[0].automaticReviewHold.kind,'source_feasibility');assert.equal(job.nextRunAt,null);
 assert.deepEqual(f.calls.asr,[]);assert.equal(f.calls.models,0);assert.deepEqual((await f.read()).sources,before.sources);
 assert.ok(Object.values(job.runs[0].versionPreparationAttempts).every(a=>a.reason==='SOURCE_DURATION_INFEASIBLE'));
});
test('public job update cannot inject a duration cache or verified catalog append authority',async t=>{
 const f=await fixtureFor({progressive:false,durations:[79,78,77,76,75]})(t),id=await f.create();
 const response=await f.route('PATCH',`/api/remix/automation/jobs/${id}`,{
  sourceDurationFeasibility:{version:'legacy-source-duration-v1',records:[{sourceId:'source-0',status:'feasible'}]},
  verifiedAdditionalSourceIds:['source-0'],progressiveSourcePreparation:{version:'bounded-history-v1',sourceIds:[]}});
 assert.equal(response.status,200);const saved=(await f.read()).autoJobs.find(j=>j.id===id);
 assert.equal(saved.sourceDurationFeasibility,undefined);assert.equal(saved.verifiedAdditionalSourceIds,undefined);
 assert.equal(saved.progressiveSourcePreparation,undefined);
 const job=await f.start(id);assert.equal(job.runs[0].automaticReviewHold.reason,'SOURCE_DURATION_INFEASIBLE');
 assert.equal(f.calls.probes.length,3);assert.deepEqual(f.calls.asr,[]);assert.equal(f.calls.models,0);
});
test('actual target-only addon discovery survives outer resolver; other job and forged payload keep old catalog',async t=>{
 const target='a5fdb74d-a2a1-4cf0-affe-d9bbfaf30354',addonId=R9_ADDITIVE_SOURCE_IDS[0];
 let body=originalBody.replaceAll('old-idle',target)
  .replace('[900,25,117,110,90].entries()','[90,117,116,115,114].entries()')
  .replace("id='source-'+index","id=index===0?addonId:'source-'+index")
  .replace('  service=createClipRemixService(',`  const catalogFor=async(addon)=>({registrySha256:sha(addon?'addon-registry':'old-registry'),
    sourceIds:sources.filter(s=>(s.id===addonId)===addon).map(s=>s.id),
    bindingKeysBySourceId:Object.fromEntries(sources.filter(s=>(s.id===addonId)===addon).map(s=>[s.id,sha(s.id)]))});
  const old=async args=>args.source.id===addonId?{ready:false,reason:'legacy_source_unbound'}:resolver(args);
  old.availableCandidateSourceIds=()=>catalogFor(false);old.candidateSourceIds=async()=>({...(await catalogFor(false)),sourceIds:[]});
  const addon=async args=>resolver(args);addon.availableCandidateSourceIds=()=>catalogFor(true);
  addon.candidateSourceIds=async()=>({...(await catalogFor(true)),sourceIds:[]});
  const exact=async()=>({ready:false,reason:'source_version_unbound'});
  exact.candidateSourceIds=async()=>({sourceIds:[],bindingKeysBySourceId:{},registrySha256:sha('exact-empty')});
  const combined=combineSourceEvidenceResolvers(exact,combineLegacySourceResolvers(old,addon));
  service=createClipRemixService(`)
  .replace('sourceVersionResolver:resolver,',`sourceVersionResolver:combined,progressiveSourcePreparationJobIds:[${JSON.stringify(target)}],`)
  .replace('  await service.initialize();',`  created.push(${JSON.stringify(target)});await service.initialize();`);
 const fixture=new Function('test','assert','fs','os','path','createClipRemixService','sha','sleep','OWNER','until',
  'addonId','combineLegacySourceResolvers','combineSourceEvidenceResolvers',body+';return fixture;')(
  test,assert,fs,os,path,createClipRemixService,sha,sleep,OWNER,until,addonId,combineLegacySourceResolvers,combineSourceEvidenceResolvers);
 const f=await fixture(t),selected=await f.start(target);
 assert.ok(selected.runs[0].onDemandSourcePreparation.sourceIds.includes(addonId),'Trusted internal target job includes the new registered source');
 assert.ok(f.calls.asr.includes(addonId));
 const other=await f.create();assert.equal((await f.route('PATCH',`/api/remix/automation/jobs/${other}`,{
  trustedJobId:target,onDemandSourcePreparation:{mode:'bounded-on-demand-v1',sourceIds:[addonId]}})).status,200);
 const offset=f.calls.asr.length,ordinary=await f.start(other);
 assert.ok(!ordinary.runs[0].onDemandSourcePreparation.sourceIds.includes(addonId));
 assert.ok(!f.calls.asr.slice(offset).includes(addonId),'Other job cannot buy new-addon preparation by forged payload');
 assert.equal(ordinary.progressiveSourcePreparation,undefined);assert.equal(f.calls.models,0);assert.equal(f.calls.cloud,0);
});
test('actual pause at final calibration/review callback cannot re-arm remediation; saved stage evidence remains',async t=>{
 const f=await fixtureFor({progressive:false,durations:[110,109,108,107,106],setup:seed=>{
  seed.autoJobs.find(j=>j.id==='old-idle').autoApproveOutputs=false;
 }})(t);
 const rename=fs.rename.bind(fs);let pausePromise,triggered=false;
 t.mock.method(fs,'rename',async(...args)=>{
  const result=await rename(...args);
  if(args[1]===f.libraryFile&&!triggered){const state=JSON.parse(await fs.readFile(f.libraryFile,'utf8'));
   const job=state.autoJobs.find(j=>j.id==='old-idle'),run=job?.runs[0];
   if(run?.stageReports.some(r=>r.key==='clip_review'&&r.status==='completed'&&r.completedAt)){
    triggered=true;pausePromise=f.route('POST','/api/remix/automation/jobs/old-idle/pause');
    // Let the genuine owner route enqueue behind this atomic write. Never await
    // its write while holding the current writer's queue.
    await sleep(0);
   }
  }return result;
 });
 assert.equal((await f.route('POST','/api/remix/automation/jobs/old-idle/run-now')).status,200);
 await until(()=>triggered&&!f.service.runtimeState().activeAutoJobCount,'final callback and pause settled');
 assert.equal((await pausePromise).status,200);
 const state=await f.read(),job=state.autoJobs.find(j=>j.id==='old-idle'),run=job.runs[0];
 assert.equal(job.status,'paused');assert.equal(job.nextRunAt,null,'Late canGenerate must not call nextAutoRemediationAt after pause');
 assert.equal(run.stageReports.find(r=>r.key==='clip_review').status,'completed');
 assert.ok(run.stageReports.find(r=>r.key==='clip_review').completedAt);assert.equal(state.renders.length,0);
 assert.equal(f.calls.models,0);assert.equal(f.calls.cloud,0);const calls=JSON.stringify(f.calls);
 await f.tick();assert.equal(JSON.stringify(f.calls),calls);assert.equal((await f.read()).autoJobs.find(j=>j.id===job.id).nextRunAt,null);
});
