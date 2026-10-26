// Exercise the real scheduler with isolated inventory and a local cloud double.
// Failed downloads are deliberate: they must be reported, never fake completion.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createClipRemixService} from '../clip-remix-service.mjs';

const OWNER={sub:'fixture-source-owner',name:'Synthetic owner'};
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(fn){for(let i=0;i<300;i++){const value=await fn();if(value)return value;await sleep(20);}throw Error('Scheduler did not settle');}

async function fixture(t,{stale=false,inventory=false,empty=false,locals=[],cloudConfigured=true,sourceVersionResolver,documentConflict,oldStorageFailure=false,paused=false}={}){
  const dataDir=await fs.mkdtemp(path.join(os.tmpdir(),'basic-source-shortfall-'));
  const root=path.join(dataDir,'clip-remix'),file=path.join(root,'library.json');
  await fs.mkdir(root,{recursive:true});
  const reports=stale?['source_selection','source_slicing','clip_calibration','clip_review'].map(key=>({key,status:'completed',
    totalCount:0,processedCount:0,passedCount:0,summary:'复用现有切片；基础检查后自动入池，异常自动跳过，无需人工复核。',completedAt:new Date().toISOString()})):[];
  const originalRun={id:'original-run',status:stale?'awaiting_review':'queued',targetCount:1,targetDurationSeconds:30,
    stageReports:reports,selectedSourceIds:[],selectedAssetIds:[],createdClipIds:[],renderIds:[],
    ...(stale?{automaticReviewHold:{reason:'source_evidence_missing',kind:'source_evidence'}}:{})};
  if(oldStorageFailure){originalRun.status='failed';originalRun.errorMessage='Document changed during transaction';
    originalRun.stageReports=[{key:'clip_review',status:'failed',processedCount:8,passedCount:8,totalCount:33,summary:originalRun.errorMessage}];}
  const source={id:'original',storedName:'original.mp4',originalName:'synthetic.mp4',durationSeconds:30,hasAudio:true,
    productCategory:'黑晶面膜',visibility:'team',createdById:OWNER.sub,speechSegments:[]};
  const localSources=locals.map((overrides,i)=>({...source,id:'local-'+i,storedName:'local-'+i+'.mp4',originalName:'黑晶面膜-'+i+'.mp4',
    sourceType:'manual_upload',analysisStatus:'ready',speechSegments:[{id:'segment-'+i,index:1,startSeconds:0,endSeconds:10,
      label:'这是本地测试视频的完整口播片段',clipName:'本地测试',requiresReview:true}],...overrides}));
  await fs.mkdir(path.join(root,'sources'),{recursive:true});
  for(const item of localSources)if(!item.missing)await fs.writeFile(path.join(root,'sources',item.storedName),'synthetic local original');
  const clips=inventory?['hook','solution','cta'].map((role,i)=>({id:role,sourceId:source.id,storedName:role+'.mp4',role,
    name:role,productCategory:source.productCategory,visibility:'team',createdById:OWNER.sub,
    reviewStatus:'approved',reviewedAt:'2026-01-01T00:00:00Z',startSeconds:i*10,endSeconds:(i+1)*10,durationSeconds:10})):[];
  await fs.writeFile(file,JSON.stringify({version:7,sources:[source,...localSources],clips,renders:[],folders:[],
    frameworks:[{id:'framework',name:'Synthetic framework',visibility:'team',slots:['hook','solution','cta'].map(id=>({id,label:id}))}],
    clipReplenishmentJobs:[{id:'supplier',signature:'continuous-clip-supply-v1',status:'paused',continuous:true,targets:[]}],
    autoJobs:[{id:'job',name:'Synthetic job',status:paused?'paused':oldStorageFailure?'error':'active',createdById:OWNER.sub,createdByName:OWNER.name,
      productCategory:source.productCategory,frameworkId:'framework',dailyTarget:1,targetDurationSeconds:30,
      autoApproveOutputs:true,autoReturnAfterApproval:false,qianchuanDelivery:{enabled:false},sourceSelectionLimit:3,
      scheduleEnabled:false,nextRunAt:null,runs:[originalRun]}],
    autoRemixGrants:[{userId:OWNER.sub,userName:OWNER.name,verifiedAt:'2026-01-01T00:00:00Z'}]}));
  const calls={list:0,assets:[],processes:0};
  if(documentConflict){
    const capability=Symbol.for('pinying.metadata.document.v1'),prior=globalThis[capability];
    let version=1,conflicts=0;
    globalThis[capability]={handles:target=>target===file,
      read:async()=>({data:await fs.readFile(file,'utf8'),version}),
      commit:async(_target,snapshot,data)=>{
        const wanted=JSON.parse(data),run=wanted.autoJobs[0].runs[0];
        if(run.startedAt&&run.stageReports.find(r=>r.key==='source_selection')?.status==='running'&&
            conflicts<(documentConflict==='exhaust'?3:1)){
          conflicts++;const latest=JSON.parse(await fs.readFile(file,'utf8'));
          latest.concurrentMarker=conflicts;
          if(documentConflict==='pause'){latest.autoJobs[0].status='paused';latest.autoJobs[0].nextRunAt=null;}
          await fs.writeFile(file,JSON.stringify(latest));version++;
          throw Object.assign(Error('Document changed during transaction'),{code:'METADATA_CONFLICT'});
        }
        assert.equal(snapshot.version,version,'service must commit the version from its exact read');
        const temp=file+'.transaction';await fs.writeFile(temp,data);await fs.rename(temp,file);version++;
      }};
    t.after(()=>{if(prior)globalThis[capability]=prior;else delete globalThis[capability];});
  }
  let scheduler;
  t.mock.method(globalThis,'setInterval',fn=>{scheduler=fn;return {unref(){}};});
  t.mock.method(globalThis,'fetch',async()=>{throw Error('Unexpected external HTTP');});
  const assets=Array.from({length:5},(_,i)=>({id:100+i,filename:'黑晶面膜-钩子-'+i+'.mp4',category:'黑晶面膜',
    libraryType:'source',downloadUrl:'https://example.invalid/synthetic',contentType:'video/mp4',tags:[]}));
  const service=createClipRemixService({dataDir,nowIso:()=>new Date().toISOString(),autoRemixAdminUsers:OWNER.sub,
    sourceVersionResolver,
    readJsonBody:async req=>req.body||{},jsonResponse:(res,status,body)=>Object.assign(res,{status,body}),
    cutter:{configured:false},materialCenter:{configured:cloudConfigured,
      listAssets:async request=>{calls.list++;const items=empty||request.effectiveOnly?[]:assets;return {items,pageSize:100,total:items.length};},
      getAsset:async id=>{calls.assets.push(id);throw Error('Synthetic source unavailable');}},
    inspectMedia:async()=>({width:720,height:1280,duration:10,hasAudio:true}),
    runProcess:async()=>{calls.processes++;throw Error('Synthetic renderer unavailable');}});
  const route=async(method,url)=>{const res={};await service.route({method,headers:{},body:{}},res,new URL('http://localhost'+url),OWNER);return res;};
  const read=async()=>JSON.parse(await fs.readFile(file,'utf8'));
  t.after(async()=>{await route('POST','/api/remix/automation/jobs/job/pause');
    await until(()=>!service.runtimeState().activeAutoJobCount);await fs.rm(dataDir,{recursive:true,force:true});});
  await service.initialize();
  const start=async()=>{assert.equal((await route('POST','/api/remix/automation/jobs/job/run-now')).status,200);
    return until(async()=>{scheduler();const l=await read(),job=l.autoJobs[0];return !service.runtimeState().activeAutoJobCount&&job.runs[0].startedAt&&job;});};
  return {calls,start,route,read};
}

for(const stale of [false,true])test(`basic job ${stale?'resumes old false completion':'starts with missing inventory'}: selects and attempts at most three sources`,async t=>{
  const f=await fixture(t,{stale}),job=await f.start(),run=job.runs[0];
  assert.equal(run.id,'original-run');assert.equal(job.runs.length,1);
  assert.equal(run.selectedAssetIds.length,3);assert.equal(f.calls.assets.length,3);
  const selection=run.stageReports.find(r=>r.key==='source_selection'),slicing=run.stageReports.find(r=>r.key==='source_slicing');
  assert.equal(selection.processedCount,3);assert.equal(slicing.totalCount,3);assert.equal(slicing.failedCount,3);
  assert.equal(slicing.passedCount,0);assert.notEqual(slicing.status,'completed');
  assert.equal(run.status,'awaiting_sources');assert.ok(job.nextRunAt);
});

test('basic job with no eligible sources stays retryable on the same batch',async t=>{
  const f=await fixture(t,{empty:true}),job=await f.start();
  assert.ok(f.calls.list>0);assert.deepEqual(f.calls.assets,[]);
  assert.equal(job.runs[0].id,'original-run');assert.equal(job.runs[0].status,'awaiting_sources');assert.ok(job.nextRunAt);
});

test('basic job with sufficient inventory reuses clips without cloud selection',async t=>{
  const f=await fixture(t,{inventory:true}),job=await f.start();
  assert.equal(f.calls.list,0);assert.deepEqual(f.calls.assets,[]);
  assert.match(job.runs[0].stageReports.find(r=>r.key==='source_selection').summary,/无需补源切片/);
});

test('local uploads work without cloud configuration and reuse existing analysis',async t=>{
  const f=await fixture(t,{locals:[{}],cloudConfigured:false}),job=await f.start(),run=job.runs[0];
  assert.deepEqual(run.selectedLocalSourceIds,['local-0']);assert.deepEqual(run.selectedSourceIds,['local-0']);
  assert.equal(f.calls.list,0);assert.equal(f.calls.processes,0,'ready analysis is not repeated');
  const progress=run.stageReports.find(r=>r.key==='source_slicing');
  assert.equal(progress.totalCount,1);assert.equal(progress.passedCount,1);
  assert.deepEqual(progress.sourcePreparationItems[0].origins,['local']);
  assert.match(run.stageReports.find(r=>r.key==='source_selection').summary,/本地上传 1 条/);
  const again=await f.start();assert.equal(again.runs.length,1);assert.equal(f.calls.processes,0);
  assert.deepEqual(again.runs[0].selectedLocalSourceIds,[],'completed unchanged source is not repeatedly prepared');
});

test('local and cloud candidates share the batch limit; duplicate and inaccessible sources are excluded',async t=>{
  const f=await fixture(t,{locals:[{}, {contentSha256:'same'}, {contentSha256:'same'},
    {visibility:'private',createdById:'another-user'}, {productCategory:'美白针'},
    {productCategory:'未分类',originalName:'unknown.mp4'}, {missing:true}]});
  const run=(await f.start()).runs[0];
  assert.equal(run.selectedLocalSourceIds.length,2);assert.equal(run.selectedAssetIds.length,1);
  assert.equal(f.calls.assets.length,1);assert.equal(run.stageReports.find(r=>r.key==='source_slicing').totalCount,3);
});

test('unanalyzed local upload enters analysis; fallback boundaries do not become approved clips',async t=>{
  const f=await fixture(t,{locals:[{analysisStatus:'not_started',speechSegments:[]}],cloudConfigured:false});
  const run=(await f.start()).runs[0],progress=run.stageReports.find(r=>r.key==='source_slicing');
  assert.deepEqual(run.selectedLocalSourceIds,['local-0']);assert.ok(f.calls.processes>0);
  assert.equal(progress.totalCount,1);assert.equal(progress.processedCount,1);
  assert.equal(run.createdClipIds.length,0);
  assert.equal(run.stageReports.find(r=>r.key==='clip_calibration').passedCount,0);
});

test('local uploads cannot bypass existing version evidence requirements',async t=>{
  const resolver=async()=>({ready:false,reason:'source_version_unbound'});
  const f=await fixture(t,{locals:[{}],cloudConfigured:false,sourceVersionResolver:resolver});
  const run=(await f.start()).runs[0],progress=run.stageReports.find(r=>r.key==='source_slicing');
  assert.deepEqual(run.selectedLocalSourceIds,['local-0']);assert.equal(progress.failedCount,1);
  assert.equal(progress.passedCount,0);assert.deepEqual(run.selectedSourceIds,[]);
  const again=(await f.start()).runs[0],receipt=again.stageReports.find(r=>r.key==='source_slicing');
  assert.equal(again.localSourcePreparationAttempts['local-0'].attempts,1,'backoff does not run the same failed source again');
  assert.equal(receipt.status,'blocked');assert.equal(receipt.failedCount,1);
  assert.match(receipt.summary,/保留上次失败回执/);
});

test('actual scheduler rebases a storage conflict and preserves the concurrent update without repeating source effects',async t=>{
  const f=await fixture(t,{documentConflict:'merge'}),job=await f.start();
  assert.equal((await f.read()).concurrentMarker,1);assert.equal(job.status,'active');
  assert.equal(job.runs[0].id,'original-run');assert.equal(job.runs[0].selectedAssetIds.length,3);
  assert.equal(f.calls.assets.length,3,'each source effect executes once');
});

test('actual storage conflict after owner pause cannot publish stale work or re-arm the paused job',async t=>{
  const f=await fixture(t,{documentConflict:'pause'}),job=await f.start();
  assert.equal(job.status,'paused');assert.equal(job.nextRunAt,null);assert.deepEqual(f.calls.assets,[]);
  assert.equal(job.runs.length,1);assert.equal(job.runs[0].id,'original-run');
});

test('actual exhausted storage retries retain original receipts and queue the same batch instead of external error',async t=>{
  const f=await fixture(t,{documentConflict:'exhaust'}),job=await f.start(),run=job.runs[0];
  assert.equal((await f.read()).concurrentMarker,3);assert.equal(job.status,'active');assert.ok(job.nextRunAt);
  assert.equal(run.status,'queued');assert.equal(run.id,'original-run');assert.equal(job.runs.length,1);
  assert.equal(run.storageConflict.code,'METADATA_CONFLICT');assert.match(run.errorMessage,/无需修改外部权限或配置/);
  assert.deepEqual(f.calls.assets,[]);assert.equal(run.createdClipIds.length,0);
});

test('restart recovers an old storage failure in place and preserves completed review counts',async t=>{
  const f=await fixture(t,{oldStorageFailure:true}),job=(await f.read()).autoJobs[0];
  assert.equal(job.status,'active');assert.equal(job.runs.length,1);assert.equal(job.runs[0].id,'original-run');
  const report=job.runs[0].stageReports.find(r=>r.key==='clip_review');
  assert.equal(report.passedCount,8);assert.equal(report.processedCount,8);assert.equal(report.status,'retrying');
});

test('restart never recovers an owner-paused job even when it contains an old storage failure',async t=>{
  const f=await fixture(t,{oldStorageFailure:true,paused:true}),job=(await f.read()).autoJobs[0];
  assert.equal(job.status,'paused');assert.equal(job.nextRunAt,null);assert.equal(job.runs[0].status,'failed');
});
