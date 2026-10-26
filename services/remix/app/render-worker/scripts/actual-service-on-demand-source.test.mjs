// Real creation/control/scheduler routes; isolated synthetic bytes, private
// discovery and an intentionally unavailable ASR double. No model/ad/production IO.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createClipRemixService} from '../clip-remix-service.mjs';
const sha=value=>createHash('sha256').update(value).digest('hex');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const OWNER={sub:'FI-000001',name:'Synthetic on-demand owner'};
async function until(fn,label){for(let i=0;i<400;i++){const value=await fn();if(value)return value;await sleep(20);}throw Error('Timeout '+label);}

async function fixture(t,{revoked=false,beforeAsr=async()=>{}}={}){
  const env={WIS_REMIX_VISUAL_REVIEW_ENABLED:'true',WIS_REMIX_VISION_PROVIDER:'fandow',
    JUMP_LLM_URL:'https://example.invalid/no-calls',JUMP_LLM_TOKEN:'synthetic-not-a-credential',
    JUMP_LLM_APPLICATION:'fixture',JUMP_LLM_PROVIDER:'fixture',JUMP_LLM_VISION_MODEL:'fixture'};
  const prior=Object.fromEntries(Object.keys(env).map(key=>[key,process.env[key]]));Object.assign(process.env,env);
  const dataDir=await fs.mkdtemp(path.join(os.tmpdir(),'wis-bounded-demand-')),root=path.join(dataDir,'clip-remix');
  const libraryFile=path.join(root,'library.json');await fs.mkdir(path.join(root,'sources'),{recursive:true});
  const sources=[];
  for(const [index,duration]of [900,25,117,110,90].entries()){
    const bytes=Buffer.from('synthetic original '+index),id='source-'+index,storedName=id+'.mp4';
    await fs.writeFile(path.join(root,'sources',storedName),bytes);
    sources.push({id,storedName,originalName:storedName,durationSeconds:duration,size:bytes.length,hasAudio:true,
      contentSha256:sha(bytes),skuVersion:null,productCategory:'黑晶面膜',visibility:'team',createdById:OWNER.sub,
      reviewStatus:'approved',speechSegments:[],materialCenterAssetId:100+index});
  }
  const oldBase={createdById:OWNER.sub,createdByName:OWNER.name,productCategory:'黑晶面膜',frameworkId:'framework',
    dailyTarget:2,targetDurationSeconds:90,sourceSelectionLimit:3,autoApproveOutputs:true,autoReturnAfterApproval:false,
    qianchuanDelivery:{enabled:false},scheduleEnabled:false,nextRunAt:null,runs:[]};
  await fs.writeFile(libraryFile,JSON.stringify({version:7,sources,clips:[],renders:[],folders:[],
    autoJobs:[{...oldBase,id:'old-paused',status:'paused'},{...oldBase,id:'old-idle',status:'active'}],
    clipReplenishmentJobs:[{id:'old-supplier',signature:'continuous-clip-supply-v1',status:'paused',continuous:true,targets:[]}],
    frameworks:[{id:'framework',name:'Synthetic three-role framework',visibility:'team',tags:[],slots:['hook','solution','cta'].map(id=>({id,label:id}))}],
    verifiedAutoRemixIdentities:[{userId:OWNER.sub,userName:OWNER.name,verifiedAt:'2026-01-01T00:00:00Z',lastSeenAt:'2026-01-01T00:00:00Z',source:'oa'}],
    autoRemixGrants:[{userId:OWNER.sub,userName:OWNER.name,verifiedAt:'2026-01-01T00:00:00Z'}]}));
  let scheduler,service;const created=[];
  const calls={available:0,active:0,resolve:[],asr:[],cloud:0,models:0,probes:[]};
  t.mock.method(globalThis,'setInterval',fn=>{scheduler=fn;return {unref(){}};});
  t.mock.method(globalThis,'fetch',async()=>{calls.models++;throw Error('Unexpected provider HTTP');});
  const resolver=async({source,actualSourceSha256})=>{
    calls.resolve.push(source.id);assert.equal(actualSourceSha256,sources.find(s=>s.id===source.id).contentSha256);
    if(revoked)return {ready:false,reason:'source_approval_revoked'};
    const sourceScope={mode:'legacy_single_source',sourceId:source.id,sourceSha256:actualSourceSha256,revisionSha256:sha(source.id)};
    return {ready:true,sourceSnapshot:source,registrySha256:sha('isolated registry'),skuContext:{mode:'legacy_single_source',skuVersion:null,
      sourceScope,bindingSha256:sha(source.id),profileSha256:sha('synthetic facts')}};
  };
  resolver.candidateSourceIds=async()=>{calls.active++;return {registrySha256:sha('registry'),sourceIds:[],bindingKeysBySourceId:{}};};
  resolver.availableCandidateSourceIds=async()=>{calls.available++;return {registrySha256:sha('registry'),sourceIds:sources.map(s=>s.id),
    bindingKeysBySourceId:Object.fromEntries(sources.map(s=>[s.id,sha(s.id)]))};};
  service=createClipRemixService({dataDir,nowIso:()=>new Date().toISOString(),autoRemixAdminUsers:'fixture-admin',sourceVersionResolver:resolver,
    localAsrRunner:{ensureSourceEvidence:async input=>{calls.asr.push(input.sourceId);assert.equal(await input.assertSourceCurrent(),true);
      await beforeAsr(input,calls.asr.length);
      return {status:'pending',reason:'synthetic-transient-unavailable'};}},
    sourceSemanticReviewer:{assess:async()=>{throw Error('ASR did not complete, review must not run');}},
    // Real service now requires a local media probe before legacy preparation.
    // This explicit synthetic probe does not grant ASR/content approval.
    inspectMedia:async file=>{calls.probes.push(path.basename(file));return {hasVideo:true,duration:sources.find(s=>s.storedName===path.basename(file))?.durationSeconds};},runProcess:async()=>{throw Error('Unexpected process');},
    readJsonBody:async req=>req.body||{},jsonResponse:(res,status,body)=>Object.assign(res,{status,body}),cutter:{configured:false},
    materialCenter:{configured:true,listAssets:async()=>{calls.cloud++;return {items:[],pageSize:100,total:0};}}});
  const route=async(method,url,body={})=>{const res={};await service.route({method,headers:{},body},res,new URL('http://localhost'+url),OWNER);return res;};
  const read=async()=>{for(let i=0;;i++){try{return JSON.parse(await fs.readFile(libraryFile,'utf8'));}catch(error){if(error.code!=='ENOENT'||i>20)throw error;await sleep(10);}}};
  t.after(async()=>{
    try{for(const id of created)await route('POST',`/api/remix/automation/jobs/${id}/pause`);
      let quiet=0;await until(()=>{const state=service.runtimeState();quiet=!state.activeAutoJobCount&&!state.activeClipReplenishmentJobCount
        &&!state.pendingClipReviewCount&&!state.pendingOutputRevalidationCount?quiet+1:0;return quiet>=4;},'settled');
      await fs.rm(dataDir,{recursive:true,force:true,maxRetries:5,retryDelay:50});
    }finally{for(const[key,value]of Object.entries(prior)){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
  });
  await service.initialize();
  const create=async()=>{
    const response=await route('POST','/api/remix/automation/jobs',{name:'Synthetic requested batch',frameworkId:'framework',productCategory:'黑晶面膜',
      dailyTarget:2,targetDurationSeconds:90,sourceSelectionLimit:3,scheduleEnabled:false,runImmediately:false,
      autoApproveOutputs:true,autoReturnAfterApproval:false,qianchuanDelivery:{enabled:false}});
    assert.equal(response.status,201,JSON.stringify(response));created.push(response.body.job.id);return response.body.job.id;
  };
  const start=async id=>{const res=await route('POST',`/api/remix/automation/jobs/${id}/run-now`);assert.equal(res.status,200,JSON.stringify(res));
    // setInterval is intercepted above; explicitly drive its periodic ticks so
    // a run-now request arriving during another tick is not lost in the fixture.
    return until(async()=>{scheduler();const library=await read(),job=library.autoJobs.find(j=>j.id===id);
      return !service.runtimeState().activeAutoJobCount&&job.runs[0]?.automaticReviewHold&&job;},'source hold');};
  return {calls,read,route,create,start,tick:async()=>{scheduler();await sleep(80);},service};
}

test('actual normal job: passive registered originals are bounded to three and original run retries never fan out or wake old jobs',async t=>{
  const f=await fixture(t);await f.tick();assert.equal(f.calls.available,0);assert.deepEqual(f.calls.asr,[]);
  const id=await f.create();await f.tick();assert.equal(f.calls.available,0,'runImmediately=false and no schedule stays idle');
  const first=await f.start(id),run=first.runs[0];
  assert.deepEqual(run.onDemandSourcePreparation.sourceIds,['source-4','source-3','source-2']);
  assert.deepEqual(f.calls.asr,['source-2','source-3','source-4']);assert.equal(f.calls.cloud,0);assert.equal(f.calls.models,0);
  const again=await f.start(id);assert.equal(again.runs.length,1);assert.equal(again.runs[0].id,run.id);
  assert.deepEqual(again.runs[0].onDemandSourcePreparation.sourceIds,run.onDemandSourcePreparation.sourceIds);
  assert.equal(f.calls.asr.length,3,'backoff retries do not select fresh passive sources');
  const snapshot=await f.read();assert.equal(snapshot.autoJobs.find(j=>j.id==='old-paused').status,'paused');
  assert.equal(snapshot.autoJobs.find(j=>j.id==='old-idle').nextRunAt,null);
  assert.ok(snapshot.autoJobs.filter(j=>j.id.startsWith('old-')).every(j=>j.runs.length===0));
  const progress=await f.route('GET','/api/remix/library/progress');assert.equal(progress.status,200);
  const paused=await f.route('POST',`/api/remix/automation/jobs/${id}/pause`);assert.equal(paused.status,200);
  const beforePauseCalls=JSON.stringify(f.calls);await f.tick();assert.equal(JSON.stringify(f.calls),beforePauseCalls);
  const pausedJob=(await f.read()).autoJobs.find(j=>j.id===id);assert.equal(pausedJob.status,'paused');
  assert.deepEqual(pausedJob.runs[0].onDemandSourcePreparation.sourceIds,run.onDemandSourcePreparation.sourceIds);
});

test('actual normal job: current private resolver revocation blocks all ASR despite available discovery',async t=>{
  const f=await fixture(t,{revoked:true}),id=await f.create(),job=await f.start(id);
  assert.equal(job.runs[0].onDemandSourcePreparation.sourceIds.length,3);assert.equal(f.calls.resolve.length,3);
  assert.deepEqual(f.calls.asr,[]);assert.equal(f.calls.models,0);assert.equal(f.calls.cloud,0);
  const progress=job.runs[0].stageReports.find(report=>report.key==='source_slicing');
  assert.equal(progress.totalCount,3);assert.equal(progress.passedCount,0);assert.equal(progress.failedCount,3);
  assert.equal(progress.status,'partial');assert.ok(progress.completedAt);
});

test('actual source preparation progress stays running 0/3 while ASR waits, then records each unresolved source without false approval',async t=>{
  const gates=Array.from({length:3},()=>{let release;const promise=new Promise(resolve=>release=resolve);return {promise,release};});
  const f=await fixture(t,{beforeAsr:async(_input,index)=>gates[index-1].promise}),id=await f.create();
  const pending=f.start(id);
  try{
    for(let index=0;index<3;index++){
      await until(()=>f.calls.asr.length===index+1,'next source ASR entered');
      const run=(await f.read()).autoJobs.find(job=>job.id===id).runs[0];
      const progress=run.stageReports.find(report=>report.key==='source_slicing');
      assert.equal(progress.totalCount,3);assert.equal(progress.passedCount,0);assert.equal(progress.processedCount,index);
      assert.equal(progress.reviewRequiredCount,index);assert.equal(progress.failedCount,0);
      assert.equal(progress.status,'running');assert.equal(progress.completedAt,null);
      assert.match(progress.currentItem,new RegExp(f.calls.asr[index]));
      assert.equal(progress.sourcePreparationItems.find(item=>item.sourceId===f.calls.asr[index]).status,'running');
      gates[index].release();
    }
    const job=await pending,progress=job.runs[0].stageReports.find(report=>report.key==='source_slicing');
    assert.equal(progress.totalCount,3);assert.equal(progress.passedCount,0);assert.equal(progress.processedCount,3);
    assert.equal(progress.reviewRequiredCount,3);assert.equal(progress.status,'partial');assert.ok(progress.completedAt);
    assert.equal(progress.currentItem,'');assert.equal(f.calls.models,0);assert.equal(f.calls.cloud,0);
    const again=await f.start(id);assert.equal(again.runs.length,1);assert.equal(f.calls.asr.length,3,'Display writes do not defeat the existing backoff/cache');
  }finally{for(const gate of gates)gate.release();await pending;}
});
