// Real service routes in an isolated filesystem, with synthetic bytes and
// simulated cloud callbacks. Not a real approval, upload, or advertising test.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createClipRemixService} from '../clip-remix-service.mjs';
import {SOURCE_EVIDENCE_POLICY} from '../output-source-policy.mjs';

const OWNER={sub:'fixture-owner',name:'Fixture Owner'};
async function fixture(t,{mutate,resolver=true,reviewMode='human',duringCreate,duringUpload}={}) {
  const dataDir=await fs.mkdtemp(path.join(os.tmpdir(),'wis-output-protocol-'));
  const root=path.join(dataDir,'clip-remix'),libraryPath=path.join(root,'library.json');
  t.mock.method(globalThis,'setInterval',()=>({unref(){}}));
  t.after(async()=>{
    let quiet=0;
    for(let i=0;i<200&&quiet<5;i++){
      const state=service.runtimeState();quiet=!state.activeAutoJobCount&&!state.pendingOutputRevalidationCount
        &&!state.pendingClipReviewCount&&!state.activeClipReplenishmentJobCount?quiet+1:0;
      await new Promise(resolve=>setTimeout(resolve,20));
    }
    assert.equal(quiet,5,'isolated background workers settled before removing fixture');
    await fs.rm(dataDir,{recursive:true,force:true,maxRetries:5,retryDelay:50});
  });
  for(const dir of ['sources','clips','outputs'])await fs.mkdir(path.join(root,dir),{recursive:true});
  const bytes=Buffer.from('isolated previously approved output');
  const contentSha256=createHash('sha256').update(bytes).digest('hex');
  await fs.writeFile(path.join(root,'outputs','fixture.mp4'),bytes);
  await fs.writeFile(path.join(root,'clips','clip.mp4'),'isolated clip');
  const source={id:'s',storedName:'source.mp4',productCategory:'黑晶面膜',visibility:'team'};
  const clip={id:'c',sourceId:'s',storedName:'clip.mp4',createdByIds:[OWNER.sub],visibility:'team',productCategory:'黑晶面膜',reviewStatus:'approved',durationSeconds:10};
  const variant={id:'v',storedName:'fixture.mp4',outputName:'fixture.mp4',contentSha256,clipSequence:['c'],slotMapping:{hook:'c'},
    reviewStatus:'approved',reviewMode,reviewNote:'Isolated historical approval',reviewedAt:'2026-01-01T00:00:00Z',
    automaticAssessment:{status:'passed',autoApproved:reviewMode!=='human',checks:[]}};
  const render={id:'r',createdById:OWNER.sub,productCategory:'黑晶面膜',visibility:'team',automation:{jobId:'j',runId:'old-run'},templateId:'f',variants:[variant]};
  const library={version:7,sources:[source],clips:[clip],renders:[render],
    autoJobs:[{id:'j',createdById:OWNER.sub,status:'paused',scheduleEnabled:false,autoApproveOutputs:true,autoReturnAfterApproval:false,runs:[]}],
    frameworks:[{id:'f',name:'Fixture',visibility:'team',slots:[{id:'hook'}]}],folders:[]};
  if(mutate)mutate({library,render,variant,source,clip});
  await fs.writeFile(libraryPath,JSON.stringify(library));
  const counts={resolved:0,created:0,uploaded:0,completed:0};
  const service=createClipRemixService({dataDir,nowIso:()=>new Date().toISOString(),autoRemixAdminUsers:OWNER.sub,
    ...(resolver?{sourceVersionResolver:async()=>{counts.resolved++;return {ready:false,reason:'no_new_private_proof'};}}:{}),
    inspectMedia:async()=>({duration:10,width:1080,height:1920,hasAudio:true}),runProcess:async()=>({stdout:'',stderr:''}),
    readJsonBody:async req=>req.body,jsonResponse:(res,status,body)=>Object.assign(res,{status,body}),cutter:{configured:false},
    materialCenter:{configured:true,listAssets:async()=>({items:[],pageSize:100,total:0}),
      createReturn:async()=>{counts.created++;if(duringCreate)await duringCreate(context);return {};},
      uploadReturnFile:async()=>{counts.uploaded++;if(duringUpload)await duringUpload(context);},
      completeReturn:async()=>{counts.completed++;return {status:'completed',assetId:123,assetAvailable:true};}}});
  const context={counts,root,libraryPath,read:async()=>JSON.parse(await fs.readFile(libraryPath,'utf8')),
    route:async(method,url,body={},actor=OWNER)=>{const res={};await service.route({method,headers:{},body},res,new URL('http://localhost'+url),actor);return res;}};
  context.returnOutput=(body={},actor=OWNER)=>context.route('POST','/api/remix/renders/r/variants/v/return-to-material-center',body,actor);
  await service.initialize();return context;
}

for(const reviewMode of ['human','rule-only'])test(`actual old ${reviewMode} approval returns without fabricated new provenance`,async t=>{
  const f=await fixture(t,{reviewMode}),before=await f.read(),response=await f.returnOutput();
  assert.equal(response.status,200,JSON.stringify(response));assert.deepEqual(f.counts,{resolved:0,created:1,uploaded:1,completed:1});
  const saved=await f.read(),render=saved.renders[0],variant=render.variants[0];
  assert.equal(Object.hasOwn(render,'sourceEvidencePolicy'),false);
  for(const key of ['reviewStatus','reviewMode','reviewNote','reviewedAt','automaticAssessment'])assert.deepEqual(variant[key],before.renders[0].variants[0][key]);
  assert.equal(variant.generationBinding,undefined);assert.equal(variant.reviewBinding,undefined);
  assert.equal(saved.autoJobs[0].status,'paused','Manual return does not resume the automatic job');
});

for(const marker of [SOURCE_EVIDENCE_POLICY,null,'','unknown'])test(`actual marker ${JSON.stringify(marker)} cannot bypass missing resolver`,async t=>{
  const f=await fixture(t,{resolver:false,mutate:({render})=>{render.sourceEvidencePolicy=marker;}});
  const result=await f.returnOutput({sourceEvidencePolicy:null});assert.equal(result.status,409,JSON.stringify(result));
  assert.equal(f.counts.created,0);assert.equal(f.counts.completed,0);
});

for(const where of ['render','variant'])test(`actual new ${where} evidence without marker/resolver is fail closed`,async t=>{
  const f=await fixture(t,{resolver:false,mutate:x=>{x[where].legacySourceEvidence=null;}});
  const result=await f.returnOutput();assert.equal(result.status,409,JSON.stringify(result));assert.equal(f.counts.created,0);
});

for(const reviewMode of ['human','rule-only'])test(`old ${reviewMode} output is not upgraded by later live source preparation`,async t=>{
  const f=await fixture(t,{reviewMode,mutate:({source,clip})=>{
    source.analysisAsrEvidence={synthetic:'new ASR'};source.speechSegments=[{semanticReviewProof:{synthetic:'later receipt'}}];
    source.legacySourceEvidence={synthetic:'later source evidence'};clip.legacySourceEvidence={synthetic:'later clip evidence'};
  }});
  const before=await f.read(),response=await f.returnOutput();assert.equal(response.status,200,JSON.stringify(response));
  assert.deepEqual(f.counts,{resolved:0,created:1,uploaded:1,completed:1});
  const saved=await f.read(),old=before.renders[0].variants[0],current=saved.renders[0].variants[0];
  for(const key of Object.keys(old))assert.deepEqual(current[key],old[key]);
  assert.equal(current.generationBinding,undefined);assert.equal(current.reviewBinding,undefined);
  for(const key of ['sourceEvidencePolicy','semanticReviewProof','legacySourceEvidence']){
    assert.equal(Object.hasOwn(current,key),false);assert.equal(Object.hasOwn(saved.renders[0],key),false);
  }
});

for(const where of ['source','clip','render','variant'])
  for(const flags of [{revoked:true},{disabled:true},{reviewStatus:'rejected'}])
    test(`actual historical ${where} revoked state blocks cloud effects: ${JSON.stringify(flags)}`,async t=>{
      const f=await fixture(t,{mutate:x=>Object.assign(x[where],flags)}),result=await f.returnOutput();
      assert.equal(result.status,409,JSON.stringify(result));assert.equal(f.counts.created,0);
    });

for(const failure of ['pending','failed-assessment','private','quarantine','file-changed','missing-hash'])
  test(`old protocol preserves original ${failure} gate`,async t=>{
    const f=await fixture(t,{mutate:({render,variant})=>{
      if(failure==='pending')variant.reviewStatus='pending';
      if(failure==='failed-assessment')variant.automaticAssessment.status='failed';
      if(failure==='private')render.visibility='private';
      if(failure==='quarantine')variant.platformReview={status:'needs_localization'};
      if(failure==='missing-hash')delete variant.contentSha256;
    }});
    if(failure==='file-changed')await fs.writeFile(path.join(f.root,'outputs','fixture.mp4'),'different output bytes');
    const result=await f.returnOutput();assert.notEqual(result.status,200);assert.equal(f.counts.created,0);
  });

test('manual output-review payload cannot erase or replace server marker',async t=>{
  const f=await fixture(t,{resolver:false,mutate:({render})=>{render.sourceEvidencePolicy=SOURCE_EVIDENCE_POLICY;}});
  for(const supplied of [null,'','unknown']){
    const response=await f.route('POST','/api/remix/renders/r/variants/v/review',{
      reviewStatus:'approved',reviewNote:'Synthetic manual review; no private source receipt',sourceEvidencePolicy:supplied,
      render:{sourceEvidencePolicy:supplied},automation:null,
    });
    assert.equal(response.status,200,JSON.stringify(response));
    const saved=await f.read();assert.equal(saved.renders[0].sourceEvidencePolicy,SOURCE_EVIDENCE_POLICY);
    assert.equal(Object.hasOwn(saved.renders[0].variants[0],'sourceEvidencePolicy'),false);
    assert.equal((await f.returnOutput()).status,409);
  }
  assert.equal(f.counts.created,0);
});

for(const phase of ['duringCreate','duringUpload'])test(`old protocol rechecks explicit revocation ${phase}`,async t=>{
  const f=await fixture(t,{[phase]:async context=>{
    const result=await context.route('POST','/api/remix/clips/c/review',{reviewStatus:'changes_requested',reviewNote:'Synthetic withdrawal'});
    assert.equal(result.status,200,JSON.stringify(result));
  }});
  const response=await f.returnOutput();assert.equal(response.status,409,JSON.stringify(response));
  assert.equal(f.counts.created,1);assert.equal(f.counts.uploaded,phase==='duringUpload'?1:0);assert.equal(f.counts.completed,0);
});
