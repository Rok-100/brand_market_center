// Real service scheduler/render/review/return routes, with explicitly simulated
// media/provider/private-catalog callbacks in an isolated filesystem. These are
// engineering tests, not real source approval, ad authorization or business QA.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createClipRemixService} from '../clip-remix-service.mjs';
import {SOURCE_EVIDENCE_POLICY} from '../output-source-policy.mjs';
import {BLACK_MASK_VERSIONS,SOURCE_VERSION_SCHEMA,CLIP_VERSION_SCHEMA,
  validateProductReferenceContext,validateSourceVersionEvidence} from '../product-version-contract.mjs';

const sha=v=>createHash('sha256').update(v).digest('hex');
const OWNER={sub:'FI-000001',name:'Isolated Owner'},ADMIN={sub:'fixture-admin',name:'Isolated Admin'};
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(fn,message){for(let i=0;i<400;i++){const value=await fn();if(value)return value;await sleep(20);}throw Error('Timeout: '+message);}

async function fixture(t,{autoReturn=false,duringReview,duringUpload,qianchuan=false}={}) {
  const env={WIS_REMIX_VISUAL_REVIEW_ENABLED:'true',WIS_REMIX_VISION_PROVIDER:'fandow',JUMP_LLM_URL:'https://example.invalid/versioned-service-fixture',
    JUMP_LLM_TOKEN:'isolated-fixture-only',JUMP_LLM_APPLICATION:'fixture',JUMP_LLM_PROVIDER:'fixture',JUMP_LLM_VISION_MODEL:'fixture'};
  const prior=Object.fromEntries(Object.keys(env).map(k=>[k,process.env[k]]));Object.assign(process.env,env);
  const dataDir=await fs.mkdtemp(path.join(os.tmpdir(),'wis-actual-version-gate-')),root=path.join(dataDir,'clip-remix'),libraryPath=path.join(root,'library.json');
  let service,revoked=false,schedulerCallback;
  // Invoke the real scheduler callback deterministically, without waiting for
  // its 30-second interval or changing service implementation.
  t.mock.method(globalThis,'setInterval',callback=>{schedulerCallback=callback;return {unref(){}};});
  const counters={renders:0,requests:0,versionReads:0,semanticReads:0,createReturn:0,upload:0,completeReturn:0,push:0,retry:0};
  t.after(async()=>{
    try {
      if(service){await service.route({method:'POST',headers:{},body:{}},{},new URL('http://localhost/api/remix/automation/jobs/original-job/pause'),OWNER);
        let quiet=0;
        await until(()=>{const state=service.runtimeState();quiet=!state.activeAutoJobCount&&!state.pendingOutputRevalidationCount
          &&!state.pendingClipReviewCount&&!state.activeClipReplenishmentJobCount?quiet+1:0;return quiet>=3;},'scheduler settled');}
      await fs.rm(dataDir,{recursive:true,force:true,maxRetries:5,retryDelay:50});
    }finally{for(const[k,v]of Object.entries(prior)){if(v===undefined)delete process.env[k];else process.env[k]=v;}}
  });
  for(const name of ['sources','clips','outputs','visual-reviews'])await fs.mkdir(path.join(root,name),{recursive:true});
  const version=BLACK_MASK_VERSIONS[0],bytes=Buffer.from('isolated source byte fixture');
  const source={id:'source',storedName:'source.mp4',originalName:'isolated source',createdById:OWNER.sub,visibility:'team',
    productCategory:'黑晶面膜',skuVersion:version.skuVersion,durationSeconds:75,hasAudio:true,size:bytes.length,contentSha256:sha(bytes),
    analysisAsrEvidence:{skuVersion:version.skuVersion,sourceSha256:sha(bytes)},
    speechSegments:Array.from({length:5},(_,i)=>({id:`speech${i}`,index:i+1,startSeconds:i*15,endSeconds:(i+1)*15,
      durationSeconds:15,label:'打开包装，取出面膜，观察贴合状态。',semanticReviewProof:{testOnly:true}}))};
  const currentReference={skuVersion:version.skuVersion,documentId:version.documentId,documentRevision:927,snapshotSha256:sha('formal test snapshot'),
    profileFacts:{formalName:'测试正式资料替身，不用于业务',filingNumber:version.skuVersion}};
  const referenceImages=[{id:'ref',skuVersion:version.skuVersion,sha256:sha('reference test image'),filePath:'/fixture/ref.jpg',reviewStatus:'approved'}];
  const reference=validateProductReferenceContext({currentReference,referenceImages,referenceImageIds:['ref']});assert.equal(reference.ready,true);
  const trustedBinding={schema:SOURCE_VERSION_SCHEMA,id:'binding',status:'verified',sourceId:source.id,sourceSha256:source.contentSha256,
    skuVersion:source.skuVersion,productCategory:source.productCategory,profileSha256:reference.context.profileSha256,referenceSetSha256:reference.context.referenceSetSha256,
    referenceImageIds:['ref'],reviewReceiptSha256:sha('fixture binding receipt'),verifiedBy:'fixture reviewer',verifiedAt:'2026-10-03T00:00:00Z'};
  const validate=source=>validateSourceVersionEvidence({source,actualSourceSha256:source.contentSha256,trustedBinding,currentReference,referenceImages});
  const binding=validate(source);assert.equal(binding.ready,true);source.productVersionEvidence=binding.sourceSnapshot.productVersionEvidence;
  const clips=['hook','hook','solution','cta'].map((role,index)=>{
    const clip={id:`clip${index}`,sourceId:source.id,storedName:`clip${index}.mp4`,name:`fixture ${index}`,createdByIds:[OWNER.sub],visibility:'team',productCategory:source.productCategory,
      skuVersion:source.skuVersion,durationSeconds:15,startSeconds:index*15,endSeconds:(index+1)*15,role,reviewStatus:'approved',reviewedAt:'2026-01-01T00:00:00Z',tags:[],
      contentSha256:sha(`clip${index}`),boundaryEvidence:{sourceId:source.id,skuVersion:source.skuVersion,sourceSha256:source.contentSha256},
      automaticAssessment:{boundaryIntegrity:{segmentId:`speech${index}`}},semanticReviewProof:{testOnly:true}};
    clip.productVersionEvidence={schema:CLIP_VERSION_SCHEMA,skuVersion:source.skuVersion,sourceId:source.id,sourceSha256:source.contentSha256,
      bindingSha256:binding.bindingSha256,profileSha256:reference.context.profileSha256,referenceSetSha256:reference.context.referenceSetSha256,
      clipSha256:clip.contentSha256,startSeconds:clip.startSeconds,endSeconds:clip.endSeconds};return clip;
  });
  const run={id:'original-run',status:'awaiting_review',dateKey:'2026-10-03',targetCount:2,targetDurationSeconds:45,renderIds:[],
    slotSelections:{hook:['clip0','clip1'],solution:['clip2'],cta:['clip3']},generatedCount:0,failedCount:0,attemptedCount:0,startCursor:0};
  const job={id:'original-job',name:'isolated versioned job',createdById:OWNER.sub,createdByName:OWNER.name,status:'paused',scheduleEnabled:false,nextRunAt:null,
    frameworkId:'framework',productCategory:source.productCategory,dailyTarget:2,targetDurationSeconds:45,sourceSelectionLimit:1,
    includeUsageDisclaimer:true,usageDisclaimerText:'产品使用效果因人而异',autoApproveOutputs:true,autoReturnAfterApproval:autoReturn||qianchuan,
    qianchuanDelivery:qianchuan?{enabled:true,confirmed:true,deliveryLimitMode:'unlimited',targets:[{advertiserId:'100001',planId:'200001',planType:'multiplication'}]}:{enabled:false},runs:[run]};
  await fs.writeFile(path.join(root,'sources',source.storedName),bytes);
  for(const clip of clips)await fs.writeFile(path.join(root,'clips',clip.storedName),clip.id);
  await fs.writeFile(libraryPath,JSON.stringify({version:7,sources:[source],clips,renders:[],autoJobs:[job],folders:[],
    frameworks:[{id:'framework',name:'isolated framework',visibility:'team',tags:[],slots:['hook','solution','cta'].map(id=>({id,label:id}))}],
    verifiedAutoRemixIdentities:[{userId:OWNER.sub,userName:OWNER.name,verifiedAt:'2026-01-01T00:00:00Z',lastSeenAt:'2026-01-01T00:00:00Z',source:'oa'}],
    autoRemixGrants:[{userId:OWNER.sub,userName:OWNER.name,verifiedAt:'2026-01-01T00:00:00Z'}]}));
  const context={root,counters,revoke:()=>{revoked=true;},schedulerTick:()=>schedulerCallback(),read:async()=>{
    for(let i=0;;i++){try{return JSON.parse(await fs.readFile(libraryPath,'utf8'));}catch(e){if(e.code!=='ENOENT'||i>20)throw e;await sleep(10);}}
  },route:async(method,url,body={})=>{const res={};await service.route({method,headers:{},body},res,new URL('http://localhost'+url),OWNER);return res;}};
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    assert.equal(String(url),env.JUMP_LLM_URL,'Unexpected external HTTP');counters.requests++;
    const request=JSON.parse(JSON.parse(options.body).requests_data.messages[1].content[0].text);
    if(duringReview)await duringReview(context,request);
    const result={decision:'pass',confidence:.99,summary:'Isolated fixture-only output review',issues:[]};
    const answer=request.outputs?{batchKey:request.batchKey,runId:request.runId,product:request.product,skuVersion:request.skuVersion,
      outputs:request.outputs.map(o=>({...o,...result}))}:result;
    return {ok:true,json:async()=>({choices:[{message:{content:JSON.stringify(answer)}}]})};
  });
  service=createClipRemixService({dataDir,nowIso:()=>new Date().toISOString(),autoRemixAdminUsers:ADMIN.sub,
    sourceVersionResolver:async({source})=>{counters.versionReads++;if(revoked)return {ready:false,reason:'source_version_binding_revoked'};
      const result=validate(source);return {...result,skuContext:result.context,registrySha256:sha('fixture registry')};},
    sourceSemanticReviewer:{verifyStoredProof:async({proof,assertCurrent})=>{counters.semanticReads++;return !revoked&&proof?.testOnly===true&&await assertCurrent()===true;},
      assess:async()=>{throw Error('Unexpected source recognition in already-approved isolated inventory');}},
    inspectMedia:async()=>({duration:45,width:1080,height:1920,hasAudio:true,frameRate:30}),makeSegment:async()=>{throw Error('Unexpected source slice');},
    runFfmpeg:async args=>{counters.renders++;await fs.writeFile(args.at(-1),'isolated rendered '+path.basename(args.at(-1)));},
    runProcess:async(_command,args)=>{if(args.includes('blackdetect=d=1:pic_th=0.98'))return {stdout:'',stderr:''};
      assert.ok(args.includes('-frames:v'));await fs.writeFile(args.at(-1),Buffer.from([255,216,1,2,3,255,217]));return {stdout:'',stderr:''};},
    readJsonBody:async req=>req.body||{},jsonResponse:(res,status,body)=>Object.assign(res,{status,body}),cutter:{configured:false},
    materialCenter:{configured:true,listAssets:async()=>({items:[],pageSize:100,total:0}),
      createReturn:async body=>{counters.createReturn++;return {id:body.idempotency_key};},
      uploadReturnFile:async()=>{counters.upload++;if(duringUpload)await duringUpload(context);},
      completeReturn:async()=>{counters.completeReturn++;return {status:'completed',assetId:123,assetAvailable:true};},
      getReturn:async()=>({status:'completed',assetId:123,assetAvailable:true}),
      verifyQianchuanTarget:async()=>({verified:true,authorized:true,account:{id:'100001'},plan:{id:'200001',canAttachVideo:true}}),
      pushQianchuan:async()=>{counters.push++;return {task:{id:'isolated-task-'+counters.push,status:'failed',message:'fixture transient network error'}};},
      retryQianchuanDelivery:async()=>{counters.retry++;return {task:{id:'isolated-task-retry',status:'completed'}};},
      getQianchuanDelivery:async()=>({task:{id:'isolated-task-poll',status:'completed'}})}});
  await service.initialize();
  context.start=async(body={})=>{const res=await context.route('POST','/api/remix/automation/jobs/original-job/run-now',body);assert.equal(res.status,200,JSON.stringify(res));
    await until(async()=>{const saved=await context.read();return !service.runtimeState().activeAutoJobCount&&(saved.renders.length||saved.autoJobs[0].runs[0].errorMessage);},'isolated render completed');return context.read();};
  context.returnFirst=async()=>{const saved=await context.read(),render=saved.renders[0];assert.ok(render,JSON.stringify(saved.autoJobs[0].runs));
    return context.route('POST',`/api/remix/renders/${render.id}/variants/${render.variants[0].id}/return-to-material-center`);};
  return context;
}

test('actual versioned service: same-edition inventory renders, reviews and returns through real routes',async t=>{
  const f=await fixture(t),saved=await f.start({sourceEvidencePolicy:null,render:{sourceEvidencePolicy:'legacy'}});assert.equal(f.counters.renders,2);assert.equal(f.counters.requests,1);
  assert.equal(saved.renders[0].sourceEvidencePolicy,SOURCE_EVIDENCE_POLICY,'Actual server rendering persists its own marker, ignoring HTTP payload');
  assert.equal(saved.renders[0].variants.length,2);assert.ok(saved.renders[0].variants.every(v=>v.reviewStatus==='approved'));
  const result=await f.returnFirst();assert.equal(result.status,200,JSON.stringify(result));
  assert.equal(f.counters.createReturn,1);assert.equal(f.counters.upload,1);assert.equal(f.counters.completeReturn,1);
  assert.ok(f.counters.versionReads>0&&f.counters.semanticReads>0);
});

test('actual versioned service: registry revoked without library mutation prevents any new return',async t=>{
  const f=await fixture(t),before=await f.start();f.revoke();
  const result=await f.returnFirst();assert.notEqual(result.status,200);assert.equal(f.counters.createReturn,0);assert.equal(f.counters.upload,0);
  const after=await f.read();assert.deepEqual(after.sources,before.sources);assert.deepEqual(after.clips,before.clips);
  assert.match(result.body.message,/版本|来源|依据/);
});

test('actual versioned service: registry revoked during upload prevents completing shared return',async t=>{
  const f=await fixture(t,{duringUpload:context=>context.revoke()});await f.start();const result=await f.returnFirst();
  assert.notEqual(result.status,200);assert.equal(f.counters.createReturn,1);assert.equal(f.counters.upload,1);assert.equal(f.counters.completeReturn,0);
});

test('actual versioned service: registry revoked during output model review never approves or returns',async t=>{
  const f=await fixture(t,{autoReturn:true,duringReview:context=>context.revoke()}),saved=await f.start();
  assert.equal(f.counters.renders,2);assert.equal(f.counters.requests,1);
  assert.ok(saved.renders[0].variants.every(v=>v.reviewStatus!=='approved'),JSON.stringify(saved.renders[0].variants));
  assert.equal(f.counters.createReturn,0);assert.equal(f.counters.completeReturn,0);
});

test('actual versioned service: persisted Qianchuan task retry rechecks private registry, even with unchanged library',async t=>{
  const f=await fixture(t,{qianchuan:true});await f.start();
  await until(()=>f.counters.push===2,'simulated Qianchuan tasks were created');
  const initial=await until(async()=>{const saved=await f.read();return saved.renders[0]?.variants.every(v=>v.qianchuanDeliveries?.[0]?.taskId)&&saved;},'simulated task IDs persisted');
  f.revoke();const versionReads=f.counters.versionReads;
  const future=Date.now()+12*60*60*1000,clock=t.mock.method(Date,'now',()=>future);
  try{
    f.schedulerTick();
    await until(async()=>{const saved=await f.read();return f.counters.versionReads>versionReads&&saved.renders[0].variants.some(v=>v.qianchuanDeliveries[0].retryCount>0);},'retry rejected by current private version gate');
    assert.equal(f.counters.retry,0,'No external retry is sent after registry revocation');
    const after=await f.read();assert.deepEqual(after.sources,initial.sources);assert.deepEqual(after.clips,initial.clips);
  }finally{clock.mock.restore();}
});
