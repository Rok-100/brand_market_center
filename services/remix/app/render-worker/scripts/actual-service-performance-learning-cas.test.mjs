// Real scheduler/routes/atomic local storage with a probe barrier. Only synthetic
// media and provider doubles; no inference, live metrics, approval or delivery.
import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {createHash} from 'node:crypto';import {createClipRemixService} from '../clip-remix-service.mjs';
const sha=value=>createHash('sha256').update(value).digest('hex'),sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const OWNER={sub:'FI-000001',name:'Synthetic on-demand owner'};
async function until(fn,label){for(let i=0;i<500;i++){const result=await fn();if(result)return result;await sleep(20);}throw Error('Timeout '+label);}
const text=await fs.readFile(new URL('./actual-service-on-demand-source.test.mjs',import.meta.url),'utf8');
const originalBody=text.slice(text.indexOf('async function fixture('),text.indexOf("\ntest('actual normal job:"));
const pending=()=>({status:'pending',sampleSize:0,spendYuan:null,gmvYuan:null,roi:null,clipWeights:{},
 recommendations:['等待千川真实投放与效果回流，不以缺失数据冒充 0。'],updatedAt:'2026-10-03T00:00:00.000Z'});
async function fixture(t,{metrics=false}={}){
 let release,entered=false,revoked=false,metricsEnabled=false,polls=0;
 const getDelivery=async()=>{polls++;return metricsEnabled?{task:{id:'synthetic-delivery-task',status:'success',
  advertiserId:'123',planId:'456',metricsLinkStatus:'verified',metricsDataStatus:'fresh',
  metrics:{stat_cost:10,pay_order_amount:30},metricsFreshThrough:'2026-10-03T00:00:00.000Z'}}:{task:null};};
 const barrier=new Promise(resolve=>release=resolve);
 const probe=async(file,sources)=>{if(!entered){entered=true;await barrier;}return {hasVideo:true,duration:sources.find(s=>s.storedName===path.basename(file))?.durationSeconds};};
 let body=originalBody.replace('[900,25,117,110,90].entries()','[110,125,106,100.45,71].entries()')
  .replace('sourceVersionResolver:resolver,',"sourceVersionResolver:resolver,progressiveSourcePreparationJobIds:['old-idle'],")
  .replace('if(revoked)return','if(isRevoked())return')
  .replace('return {hasVideo:true,duration:sources.find(s=>s.storedName===path.basename(file))?.durationSeconds};','return probe(file,sources);')
  .replace('  await service.initialize();',`  const seed=JSON.parse(await fs.readFile(libraryFile,'utf8'));
   for(const job of seed.autoJobs)job.performanceLearning=pending();
   const job=seed.autoJobs.find(j=>j.id==='old-idle');
   job.runs=[{id:'original-run',status:'awaiting_sources',targetCount:2,targetDurationSeconds:90,renderIds:['original-failures'],
    selectedSourceIds:['source-0'],selectedAssetIds:[],createdClipIds:[],stageReports:[],slotSelections:{},consecutiveReviewFailures:2,
    onDemandSourcePreparation:{mode:'bounded-on-demand-v1',limit:3,sourceIds:['source-0']},
    versionPreparationAttempts:{'source-0':{key:sha('source-0'),complete:true,attemptedAt:'2026-10-03T00:00:00Z',attempts:1}}}];
   seed.sources[0].sourceSemanticReview={recoverable:false,pendingReasons:[],passedCount:0};
   seed.renders=[{id:'original-failures',automation:{jobId:'old-idle',runId:'original-run'},productCategory:'黑晶面膜',
    variants:[1,2].map(i=>({id:String(i),reviewStatus:'changes_requested',clipSequence:[],
     automaticAssessment:{visualReview:{status:'review_required',reason:'content_attention',issues:[{kind:'synthetic'}]}}}))}];
   if(metrics)seed.renders[0].variants[0].qianchuanDelivery={idempotencyKey:'synthetic-existing-task',
    advertiserId:'123',planId:'456',taskId:'synthetic-delivery-task',status:'success',nextPollAt:null};
   await fs.writeFile(libraryFile,JSON.stringify(seed));created.push('old-idle');await service.initialize();`)
  .replace('materialCenter:{configured:true,','materialCenter:{configured:true,getQianchuanDelivery:getDelivery,')
  .replace('return {calls,read,route,create,start,','return {root,libraryFile,calls,read,route,create,start,');
 const build=new Function('test','assert','fs','os','path','createClipRemixService','sha','sleep','OWNER','until','pending','probe','isRevoked','metrics','getDelivery',
  body+';return fixture;')(test,assert,fs,os,path,createClipRemixService,sha,sleep,OWNER,until,pending,probe,()=>revoked,metrics,getDelivery);
 const f=await build(t);t.after(()=>release());
 return {...f,release,revoke:()=>{revoked=true;},enableMetrics:()=>{metricsEnabled=true;},get polls(){return polls;},waitProbe:()=>until(()=>entered,'probe barrier')};
}
async function launch(f){assert.equal((await f.route('POST','/api/remix/automation/jobs/old-idle/run-now')).status,200);await f.waitProbe();}
const jobOf=library=>library.autoJobs.find(j=>j.id==='old-idle');
async function settled(f){return until(async()=>{
 if(f.service.runtimeState().activeAutoJobCount)return false;
 const job=jobOf(await f.read());
 return !f.service.runtimeState().activeAutoJobCount&&job;
},'settled source plan');}

test('actual scheduler heartbeat during legacy probe preserves full planning CAS and resumes the same run',async t=>{
 const f=await fixture(t);await launch(f);
 try{const before=jobOf(await f.read()).performanceLearning;await f.tick();await f.tick();
  assert.deepEqual(jobOf(await f.read()).performanceLearning,before,'No business change cannot rewrite updatedAt');
 }finally{f.release();}
 const job=await settled(f);assert.equal(job.runs[0].id,'original-run');assert.equal(job.runs[0].consecutiveReviewFailures,2);
 assert.equal(job.runs[0].attemptedCount,2);assert.notEqual(job.runs[0].automaticReviewHold?.reason,'PROGRESSIVE_SOURCE_CHANGED');
 assert.deepEqual([...f.calls.asr].sort(),['source-1','source-2','source-3']);assert.equal(f.calls.models,0);assert.equal(f.calls.cloud,0);
 assert.equal(job.progressiveSourcePreparation.sourceIds.length,4);
});
test('actual pause during probe still prevents stale cache, source selection and model dispatch',async t=>{
 const f=await fixture(t);await launch(f);assert.equal((await f.route('POST','/api/remix/automation/jobs/old-idle/pause')).status,200);
 f.release();const job=await settled(f);assert.equal(job.status,'paused');assert.equal(job.nextRunAt,null);
 assert.equal(job.sourceDurationFeasibility,undefined);assert.equal(job.progressiveSourcePreparation,undefined);
 assert.deepEqual(f.calls.asr,[]);assert.equal(f.calls.models,0);
});
test('actual source SHA mutation during probe is still rejected before any ASR',async t=>{
 const f=await fixture(t);await launch(f);await fs.appendFile(path.join(f.root,'sources',f.calls.probes[0]),'changed-source');
 f.release();const job=await settled(f);assert.equal(job.runs[0].automaticReviewHold.reason,'SOURCE_DURATION_INPUT_CHANGED');
 assert.equal(job.sourceDurationFeasibility,undefined);assert.equal(job.progressiveSourcePreparation,undefined);
 assert.deepEqual(f.calls.asr,[]);assert.equal(f.calls.models,0);
});
test('actual private source revocation during probe is still rejected before any ASR',async t=>{
 const f=await fixture(t);await launch(f);f.revoke();f.release();const job=await settled(f);
 assert.equal(job.runs[0].status,'failed');assert.match(job.runs[0].errorMessage,/source_approval_revoked/);
 assert.equal(job.sourceDurationFeasibility,undefined);
 assert.equal(job.progressiveSourcePreparation,undefined);assert.deepEqual(f.calls.asr,[]);assert.equal(f.calls.models,0);
});
test('actual owner access withdrawal during probe is not a harmless heartbeat',async t=>{
 const f=await fixture(t);await launch(f);const res={};
 await f.service.route({method:'DELETE',headers:{},body:{}},res,new URL('http://localhost/api/remix/automation/access/grants/'+OWNER.sub),
  {sub:'fixture-admin',name:'Synthetic admin'});assert.equal(res.status,200,JSON.stringify(res));
 f.release();const job=await settled(f);assert.equal(job.sourceDurationFeasibility,undefined);
 assert.equal(job.progressiveSourcePreparation,undefined);assert.deepEqual(f.calls.asr,[]);assert.equal(f.calls.models,0);
});
test('actual target change during probe retains full-job CAS rejection',async t=>{
 const f=await fixture(t);await launch(f);assert.equal((await f.route('PATCH','/api/remix/automation/jobs/old-idle',{targetDurationSeconds:60})).status,200);
 f.release();const job=await settled(f);assert.equal(job.targetDurationSeconds,60);assert.equal(job.runs[0].targetDurationSeconds,90);
 assert.equal(job.runs[0].automaticReviewHold?.reason,'PROGRESSIVE_SOURCE_CHANGED');
 assert.equal(job.sourceDurationFeasibility,undefined);assert.equal(job.progressiveSourcePreparation,undefined);
 assert.deepEqual(f.calls.asr,[]);assert.equal(f.calls.models,0);
});
test('actual verified metrics during probe update learning, preserve poll cadence and invalidate the pending plan',async t=>{
 const f=await fixture(t,{metrics:true});await launch(f);const before=jobOf(await f.read()).performanceLearning;
 f.enableMetrics();await f.tick();
 const live=await f.read(),learning=jobOf(live).performanceLearning;
 assert.notEqual(learning.updatedAt,before.updatedAt);assert.equal(learning.status,'learning');assert.equal(learning.sampleSize,1);
 assert.equal(learning.spendYuan,10);assert.equal(learning.gmvYuan,30);assert.equal(learning.roi,3);
 assert.deepEqual(learning.clipWeights,{});assert.match(learning.recommendations[0],/已回流 1 条/);
 const state=live.renders[0].variants[0].qianchuanDelivery;
 assert.ok(new Date(state.nextPollAt).getTime()>Date.now()+5*60*60_000);
 const polls=f.polls;await f.tick();assert.equal(f.polls,polls,'Learning no-op never bypasses delivery nextPollAt');
 assert.deepEqual(jobOf(await f.read()).performanceLearning,learning);
 f.release();const job=await settled(f);assert.equal(job.runs[0].automaticReviewHold.reason,'PROGRESSIVE_SOURCE_CHANGED');
 assert.equal(job.sourceDurationFeasibility,undefined);assert.equal(job.progressiveSourcePreparation,undefined);
 assert.deepEqual(f.calls.asr,[]);assert.equal(f.calls.models,0);
});
