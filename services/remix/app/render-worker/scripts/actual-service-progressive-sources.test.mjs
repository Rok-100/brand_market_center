// Actual routes/preparation, isolated synthetic files and unavailable ASR only.
// Seeded preparation records test selection, never create an approved clip.
import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {createHash} from 'node:crypto';import {createClipRemixService} from '../clip-remix-service.mjs';
const sha=value=>createHash('sha256').update(value).digest('hex'),sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const OWNER={sub:'FI-000001',name:'Synthetic on-demand owner'};
async function until(fn,label){for(let i=0;i<500;i++){const result=await fn();if(result)return result;await sleep(20);}throw Error('Timeout '+label);}
const text=await fs.readFile(new URL('./actual-service-on-demand-source.test.mjs',import.meta.url),'utf8');
let body=text.slice(text.indexOf('async function fixture('),text.indexOf("\ntest('actual normal job:"));
assert.equal(body.split('sourceVersionResolver:resolver,').length,2);
body=body.replace('sourceVersionResolver:resolver,',"sourceVersionResolver:resolver,progressiveSourcePreparationJobIds:['old-idle'],");
assert.equal(body.split('  await service.initialize();').length,2);
body=body.replace('  await service.initialize();',"  const seed=JSON.parse(await fs.readFile(libraryFile,'utf8'));await setup(seed);await fs.writeFile(libraryFile,JSON.stringify(seed));created.push('old-idle');await service.initialize();");
function makeFixture(setup){return new Function('test','assert','fs','os','path','createClipRemixService','sha','sleep','OWNER','until','setup',
 body+';return fixture;')(test,assert,fs,os,path,createClipRemixService,sha,sleep,OWNER,until,setup);}
function completed(seed){const job=seed.autoJobs.find(j=>j.id==='old-idle'),ids=['source-4','source-3','source-2'];
 job.runs=[{id:'original-run',status:'awaiting_sources',targetCount:2,targetDurationSeconds:90,renderIds:[],selectedSourceIds:ids,
  selectedAssetIds:[],createdClipIds:[],stageReports:[],slotSelections:{},onDemandSourcePreparation:{mode:'bounded-on-demand-v1',limit:3,sourceIds:ids},
  versionPreparationAttempts:Object.fromEntries(ids.map(id=>[id,{key:sha(id),complete:true,attemptedAt:'2026-10-03T00:00:00Z',attempts:1}]))}];
 for(const source of seed.sources.filter(s=>ids.includes(s.id)))source.sourceSemanticReview={recoverable:false,pendingReasons:[],passedCount:0};
 return job;
}
test('actual opted-in original run advances only after terminal first three, preserving old jobs and never repeating their ASR',async t=>{
 const f=await makeFixture(completed)(t),job=await f.start('old-idle');
 assert.equal(job.runs[0].id,'original-run');assert.equal(job.progressiveSourcePreparation.sourceIds.length,4);
 assert.deepEqual(job.runs[0].onDemandSourcePreparation.sourceIds,['source-0']);
 assert.deepEqual(f.calls.asr,['source-0']);assert.equal(f.calls.models,0);assert.equal(f.calls.cloud,0);
 assert.equal(job.sourceDurationFeasibility.records.find(x=>x.sourceId==='source-1').status,'structural_incompatible');
 const again=await f.start('old-idle');assert.equal(again.progressiveSourcePreparation.sourceIds.length,4);
 assert.equal(f.calls.asr.length,1,'Unknown ASR stays in its original batch; the 25-second source never reaches recognition');
 const state=await f.read();assert.equal(state.autoJobs.find(j=>j.id==='old-paused').status,'paused');
 assert.equal(state.clipReplenishmentJobs[0].status,'paused');
});
test('actual unresolved old source keeps first three, and public payload cannot opt another job into progressive selection',async t=>{
 const f=await makeFixture(seed=>{const job=completed(seed);job.runs[0].versionPreparationAttempts['source-3'].complete=false;
  seed.sources.find(s=>s.id==='source-3').sourceSemanticReview={recoverable:true,pendingReasons:['uncertain_not_resent']};})(t);
 const job=await f.start('old-idle');assert.deepEqual(job.runs[0].onDemandSourcePreparation.sourceIds,['source-4','source-3','source-2']);
 assert.ok(f.calls.asr.every(id=>['source-4','source-3','source-2'].includes(id)));assert.equal(job.progressiveSourcePreparation.sourceIds.length,3);
 const id=await f.create();const patch=await f.route('PATCH',`/api/remix/automation/jobs/${id}`,{progressiveSourcePreparation:{sourceLimit:999},progressiveSourcePreparationJobIds:[id]});
 assert.equal(patch.status,200);const other=await f.start(id);assert.equal(other.progressiveSourcePreparation,undefined);
 assert.equal(other.runs[0].onDemandSourcePreparation.sourceIds.length,3);assert.equal(f.calls.models,0);
});
test('actual original target-two run keeps its eight-attempt ceiling, not the eighty total cap or a fresh source window',async t=>{
 const f=await makeFixture(seed=>{completed(seed);seed.renders=[{id:'original-failures',automation:{jobId:'old-idle',runId:'original-run'},
  productCategory:'黑晶面膜',variants:Array.from({length:8},(_,i)=>({id:String(i+1),reviewStatus:'changes_requested',clipSequence:[],
   automaticAssessment:{visualReview:{status:'review_required',reason:'content_attention',issues:[{kind:'synthetic'}]}}}))}];})(t);
 const job=await f.start('old-idle');assert.equal(job.runs[0].automaticReviewHold.reason,'PROGRESSIVE_RUN_ATTEMPT_LIMIT');
 assert.equal(job.runs[0].attemptedCount,8);assert.equal(f.calls.asr.length,0);assert.equal(f.calls.models,0);assert.equal(f.calls.cloud,0);
 assert.equal(job.runs[0].onDemandSourcePreparation.sourceIds.length,3);
});
test('actual pause during the first new source stops later ASR and never wakes old paused jobs',async t=>{
 let f;f=await makeFixture(completed)(t,{beforeAsr:async()=>{await f.route('POST','/api/remix/automation/jobs/old-idle/pause');}});
 const response=await f.route('POST','/api/remix/automation/jobs/old-idle/run-now');assert.equal(response.status,200);
 await until(()=>f.calls.asr.length===1,'first new source entered');
 await until(()=>!f.service.runtimeState().activeAutoJobCount,'paused preparation');
 const state=await f.read(),job=state.autoJobs.find(j=>j.id==='old-idle');assert.equal(job.status,'paused');
 assert.equal(f.calls.asr.length,1);assert.equal(f.calls.models,0);assert.equal(f.calls.cloud,0);
 assert.equal(state.autoJobs.find(j=>j.id==='old-paused').status,'paused');
});
test('actual private revocation stops progressive rotation before any ASR or new source selection',async t=>{
 const f=await makeFixture(completed)(t,{revoked:true}),job=await f.start('old-idle');
 assert.equal(job.runs[0].automaticReviewHold.reason,'PROGRESSIVE_SOURCE_CHANGED');
 assert.equal(job.runs[0].onDemandSourcePreparation.sourceIds.length,3);assert.equal(f.calls.asr.length,0);assert.equal(f.calls.models,0);
});
for(const total of [2,20])test(`actual saved-final-variant recovery completes original run at ${total} approved outputs without sourcing or rendering again`,async t=>{
 // Persisted synthetic human-review rows exercise recovery, not a new approval.
 // autoReturn=false keeps the fixture free of external effects; the real core
 // completion branch is used without replacing service implementation.
 const f=await makeFixture(seed=>{const job=completed(seed);job.runs[0].status='generating';
  const variant=i=>({id:String(i),storedName:`synthetic-already-saved-${i}.mp4`,contentSha256:sha('saved-'+i),
   reviewStatus:'approved',reviewMode:'human',reviewedAt:'2026-10-03T00:00:00Z',reviewNote:'Synthetic persisted approval only',clipSequence:[]});
  seed.renders=[{id:'saved-current',automation:{jobId:'old-idle',runId:'original-run'},productCategory:'黑晶面膜',variants:[variant(1),variant(2)]}];
  if(total>2)seed.renders.push({id:'saved-prior',automation:{jobId:'old-idle',runId:'prior-run'},productCategory:'黑晶面膜',
    variants:Array.from({length:total-2},(_,i)=>variant(i+3))});
 })(t);
 const original=(await f.read()).renders;
 // initialize/scheduler resumes the in-flight run. Sending run-now after that
 // recovery could legitimately request a new run, so do not introduce one.
 await f.tick();
 const saved=await until(async()=>{const state=await f.read(),job=state.autoJobs.find(j=>j.id==='old-idle');
  if(job.runs[0].errorMessage&&job.runs[0].status!=='generating')throw Error(JSON.stringify({status:job.runs[0].status,error:job.runs[0].errorMessage,generated:job.runs[0].generatedCount,calls:f.calls}));
  return !f.service.runtimeState().activeAutoJobCount&&job.runs[0].status==='completed'&&state;},'saved output run completion');
 const job=saved.autoJobs.find(j=>j.id==='old-idle');assert.equal(job.runs.length,1);assert.equal(job.runs[0].id,'original-run');
 assert.equal(job.runs[0].generatedCount,2);assert.equal(job.runs[0].attemptedCount,2);assert.ok(job.runs[0].completedAt);
 assert.equal(job.runs[0].automaticReviewHold,undefined);assert.equal(job.nextRunAt,null);
 assert.deepEqual(saved.renders,original,'Recovery never changes original approval metadata or creates an output');
 assert.deepEqual(f.calls.asr,[]);assert.equal(f.calls.models,0);assert.equal(f.calls.cloud,0);assert.equal(f.calls.available,0);
 assert.deepEqual(f.calls.resolve,[]);assert.equal(job.progressiveSourcePreparation,undefined,'Completion must not create a source ledger');
});
