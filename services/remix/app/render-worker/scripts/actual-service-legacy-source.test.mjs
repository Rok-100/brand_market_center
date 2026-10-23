// Actual service routes and private semantic-review storage, isolated synthetic
// media/ASR/model/cloud callbacks. NOT real advertising or business acceptance.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createClipRemixService} from '../clip-remix-service.mjs';
import {SourceSemanticReview} from '../source-semantic-review.mjs';
import {ASR_FRAME_RULE,verifyAsrBundle,alignAsrCuesToFrames} from '../asr-frame-boundary.mjs';
import {LEGACY_MODE,hasLegacyClipPointer} from '../legacy-source-evidence.mjs';

const hash=x=>createHash('sha256').update(x).digest('hex');
const canonical=x=>Array.isArray(x)?x.map(canonical):x&&typeof x==='object'
  ?Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])):x;
const digest=x=>hash(JSON.stringify(canonical(x)));
const OWNER={sub:'FI-000001',name:'Isolated legacy owner'};
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(fn,label){for(let i=0;i<400;i++){const result=await fn();if(result)return result;await sleep(20);}throw Error('Timeout: '+label);}

async function fixture(t,{duringReview,duringUpload,duringCut,duringCatalog,mutateInventory,allowSlice=false,cachedCtaRecovery=false}={}){
  const env={WIS_REMIX_SOURCE_REVIEW_ENABLED:'true',WIS_REMIX_VISUAL_REVIEW_ENABLED:'true',WIS_REMIX_VISION_PROVIDER:'fandow',
    JUMP_LLM_URL:'https://example.invalid/legacy-service-fixture',JUMP_LLM_TOKEN:'synthetic-not-a-key',
    JUMP_LLM_APPLICATION:'fixture',JUMP_LLM_PROVIDER:'fixture',JUMP_LLM_VISION_MODEL:'fixture'};
  const prior=Object.fromEntries(Object.keys(env).map(k=>[k,process.env[k]]));Object.assign(process.env,env);
  const dataDir=await fs.mkdtemp(path.join(os.tmpdir(),'wis-actual-legacy-')),root=path.join(dataDir,'clip-remix');
  const libraryPath=path.join(root,'library.json');let service,revoked=false;
  t.mock.method(globalThis,'setInterval',()=>({unref(){}}));
  t.after(async()=>{
    try{if(service){await service.route({method:'POST',headers:{},body:{}},{},new URL('http://localhost/api/remix/automation/jobs/job/pause'),OWNER);
      let quiet=0;await until(()=>{const state=service.runtimeState();quiet=!state.activeAutoJobCount&&!state.pendingOutputRevalidationCount
        &&!state.pendingClipReviewCount&&!state.activeClipReplenishmentJobCount?quiet+1:0;return quiet>=5;},'settled');}
      await fs.rm(dataDir,{recursive:true,force:true,maxRetries:5,retryDelay:50});
    }finally{for(const[k,v]of Object.entries(prior)){if(v===undefined)delete process.env[k];else process.env[k]=v;}}
  });
  for(const dir of ['sources','clips','outputs','visual-reviews'])await fs.mkdir(path.join(root,dir),{recursive:true});
  const sourceBytes=Buffer.from('synthetic historical source with an unselected expired offer');
  const raw={id:'legacy-source',productCategory:'黑晶面膜',skuVersion:null,sha256:hash(sourceBytes),
    durationSeconds:60,minuteToken:'synthetic-authorized-minute'};
  const stamp=n=>`00:00:${String(n).padStart(2,'0')},000`;
  const texts=['打开包装，取出面膜。','看这张面膜，贴合面部。','观察膜布贴合的状态。','打开商品页面了解详情。','限时买一送一到手价九十九元钱。'];
  if(cachedCtaRecovery)texts[3]='你可以去直播间搜WIS黑睛面膜';
  const srtBytes=Buffer.from(texts.map((text,i)=>`${i+1}\n${stamp(i*10)} --> ${stamp(i*10+10)}\n${text}\n`).join('\n'));
  raw.srtSha256=hash(srtBytes);
  const bundle=verifyAsrBundle({source:raw,sourceBytes,srtBytes,receipts:{
    drive:{ok:true,identity:'user',data:{size:sourceBytes.length,file_token:'synthetic-file',version:'1'}},
    minute:{ok:true,identity:'user',data:{minute_token:raw.minuteToken}},detail:{ok:true,identity:'user',data:{minutes:[{minute_token:raw.minuteToken}]}},export:{size_bytes:srtBytes.length}},
    frameMap:{sourceSha256:raw.sha256,starts:Array.from({length:1800},(_,i)=>Number((i/30).toFixed(6))),end:60}});
  const sourceScope={mode:LEGACY_MODE,sourceId:raw.id,sourceSha256:raw.sha256,revisionSha256:hash('synthetic private historical revision')};
  const profileFacts={formalName:'Synthetic common product facts',commonFacts:['保湿']};
  const skuContext={mode:LEGACY_MODE,productCategory:raw.productCategory,skuVersion:null,filingNumber:null,sourceScope,
    historicalApprovalSha256:sourceScope.revisionSha256,bindingSha256:sourceScope.revisionSha256,
    profileSha256:digest(profileFacts),profileFacts,referenceImages:[]};
  const source={id:raw.id,storedName:'source.mp4',originalName:'synthetic historical source',createdById:OWNER.sub,visibility:'team',
    contentSha256:raw.sha256,skuVersion:null,productCategory:raw.productCategory,durationSeconds:60,hasAudio:true,size:sourceBytes.length,
    reviewStatus:'approved',reviewedAt:'2026-09-01T00:00:00Z',analysisRuleVersion:ASR_FRAME_RULE,
    analysisAsrEvidence:{sourceSha256:raw.sha256,skuVersion:null,srtSha256:raw.srtSha256,frameMapSha256:bundle.frameMapSha256,
      minuteToken:raw.minuteToken,sourceScope},speechSegments:alignAsrCuesToFrames(bundle).map((s,i)=>({...s,id:`speech${i}`}))};
  await fs.writeFile(path.join(root,'sources',source.storedName),sourceBytes);
  const counters={sourceReviews:0,outputReviews:0,renders:0,cuts:0,createReturn:0,upload:0,completeReturn:0,privateReads:0,
    sourceAssessCalls:0,asrCalls:0,clipInspections:[],newPendingStates:[]};
  const context={root,counters,revoke:()=>{revoked=true;},read:async()=>{
    for(let i=0;;i++){try{return JSON.parse(await fs.readFile(libraryPath,'utf8'));}
      catch(error){if(error.code!=='ENOENT'||i>=20)throw error;await sleep(10);}}
  }};
  const fakeFetch=async(url,options)=>{
    assert.equal(String(url),env.JUMP_LLM_URL,'No unexpected HTTP');
    const payload=JSON.parse(options.body),request=JSON.parse(payload.requests_data.messages[1].content[0].text);
    let answer;
    if(request.requestKey){counters.sourceReviews++;
      answer={requestKey:request.requestKey,sourceSha256:request.source.sha256,skuVersion:null,
        segments:request.segments.map(row=>({segmentIndex:row.segmentIndex,segmentSha256:digest(row.segment),coverage:row.coverage,
          decision:'pass',confidence:.99,summary:'Synthetic per-segment test only',issues:[],checks:{semanticComplete:true,
            originalTextConsistent:true,sourcePackagingConsistent:true,commercialSupported:true,visualUsable:true}}))};
    }else{counters.outputReviews++;assert.equal(request.outputs,undefined,'Legacy outputs use independent full review');
      if(duringReview)await duringReview(context,request);answer={decision:'pass',confidence:.99,summary:'Synthetic output test only',issues:[]};}
    return {ok:true,status:200,json:async()=>({choices:[{message:{content:JSON.stringify(answer)}}]})};
  };
  t.mock.method(globalThis,'fetch',fakeFetch);
  const runProcess=async(_command,args)=>{
    if(args.includes('blackdetect=d=1:pic_th=0.98'))return {stdout:'',stderr:''};
    assert.ok(args.includes('-frames:v'));await fs.writeFile(args.at(-1),Buffer.from([255,216,1,2,3,255,217]));return {stdout:'',stderr:''};
  };
  const reviewer=new SourceSemanticReview({directory:path.join(root,'source-semantic-reviews'),env,runProcess,fetchImpl:fakeFetch});
  const currentSource=()=>({...source,filePath:path.join(root,'sources',source.storedName)});
  const reviewed=await reviewer.assess({runId:'synthetic-source-review',source:currentSource(),segments:source.speechSegments,skuContext,assertCurrent:async()=>true});
  assert.equal(reviewed.results.filter(r=>r.status==='passed').length,4,'Expired unused segment remains pending, four others pass: '+JSON.stringify(reviewed));
  source.speechSegments=source.speechSegments.map(s=>({...s,semanticReviewProof:reviewed.results.find(r=>r.segmentIndex===s.index)?.proof||null}));
  if(cachedCtaRecovery)for(const segment of source.speechSegments)segment.requiresReview=!segment.semanticReviewProof;
  source.legacySourceEvidence={mode:LEGACY_MODE,sourceScope,bindingSha256:skuContext.bindingSha256,profileSha256:skuContext.profileSha256};
  const clips=['hook','hook','solution','cta'].map((role,index)=>{
    const segment=source.speechSegments[index],clip={id:`clip${index}`,sourceId:source.id,storedName:`clip${index}.mp4`,
      name:`synthetic clip ${index}`,createdByIds:[OWNER.sub],visibility:'team',productCategory:source.productCategory,skuVersion:null,
      startSeconds:segment.startSeconds,endSeconds:segment.endSeconds,durationSeconds:segment.durationSeconds,role,
      text:segment.label,transcript:segment.label,reviewStatus:'approved',reviewedAt:'2026-10-03T00:00:00Z',tags:[],
      contentSha256:hash(`clip${index}`),boundaryEvidence:segment.boundaryEvidence,
      automaticAssessment:{boundaryIntegrity:{segmentId:segment.id}},semanticReviewProof:segment.semanticReviewProof};
    clip.legacySourceEvidence={...source.legacySourceEvidence,clipSha256:clip.contentSha256,startSeconds:clip.startSeconds,endSeconds:clip.endSeconds};
    assert.equal(hasLegacyClipPointer(clip,source),true);return clip;
  });
  for(const clip of clips)await fs.writeFile(path.join(root,'clips',clip.storedName),clip.id);
  if(cachedCtaRecovery)clips[3].role='proof';
  if(mutateInventory)mutateInventory({source,clips});
  const run={id:'run',status:'awaiting_review',dateKey:'2026-10-03',targetCount:2,targetDurationSeconds:30,renderIds:[],
    slotSelections:{hook:['clip0','clip1'],solution:['clip2'],cta:['clip3']},generatedCount:0,failedCount:0,attemptedCount:0,startCursor:0};
  if(cachedCtaRecovery)Object.assign(run,{status:'queued',onDemandSourcePreparation:{mode:'bounded-on-demand-v1',limit:1,sourceIds:[source.id]},
    versionPreparationAttempts:{[source.id]:{key:skuContext.bindingSha256,complete:true,attempts:1}},selectedSourceIds:[source.id]});
  const job={id:'job',name:'synthetic legacy job',createdById:OWNER.sub,createdByName:OWNER.name,status:'paused',scheduleEnabled:false,
    frameworkId:'framework',productCategory:source.productCategory,dailyTarget:2,targetDurationSeconds:30,sourceSelectionLimit:1,
    includeUsageDisclaimer:true,usageDisclaimerText:'产品使用效果因人而异',autoApproveOutputs:true,autoReturnAfterApproval:false,qianchuanDelivery:{enabled:false},runs:[run]};
  await fs.writeFile(libraryPath,JSON.stringify({version:7,sources:[source],clips,renders:[],autoJobs:[job],folders:[],
    frameworks:[{id:'framework',name:'Synthetic framework',visibility:'team',tags:[],slots:['hook','solution','cta'].map(id=>({id,label:id}))}],
    verifiedAutoRemixIdentities:[{userId:OWNER.sub,userName:OWNER.name,verifiedAt:'2026-01-01T00:00:00Z',lastSeenAt:'2026-01-01T00:00:00Z',source:'oa'}],
    autoRemixGrants:[{userId:OWNER.sub,userName:OWNER.name,verifiedAt:'2026-01-01T00:00:00Z'}]}));
  const sourceVersionResolver=async({source,actualSourceSha256})=>{counters.privateReads++;
      if(revoked||actualSourceSha256!==raw.sha256)return {ready:false,reason:'legacy_unavailable'};
      return {ready:true,mode:LEGACY_MODE,sourceSnapshot:structuredClone(source),skuContext,bindingSha256:skuContext.bindingSha256,registrySha256:hash('synthetic registry')};};
  if(cachedCtaRecovery){sourceVersionResolver.candidateSourceIds=async()=>({sourceIds:[],bindingKeysBySourceId:{}});
    sourceVersionResolver.availableCandidateSourceIds=async()=>{
      if(duringCatalog)await duringCatalog(context);
      return {sourceIds:revoked?[]:[source.id],bindingKeysBySourceId:{[source.id]:skuContext.bindingSha256}};
    };}
  service=createClipRemixService({dataDir,nowIso:()=>new Date().toISOString(),autoRemixAdminUsers:'fixture-admin',sourceVersionResolver,
    sourceSemanticReviewer:cachedCtaRecovery?{verifyStoredProof:args=>reviewer.verifyStoredProof(args),
      assess:async()=>{counters.sourceAssessCalls++;throw Error('Cache-only role recovery must not call a content model');}}:reviewer,
    localAsrRunner:cachedCtaRecovery?{ensureSourceEvidence:async()=>{counters.asrCalls++;throw Error('Cache-only role recovery must not rerun ASR');}}:undefined,
    inspectMedia:async file=>{
      if(cachedCtaRecovery&&file.includes(path.sep+'clips'+path.sep)){
        counters.clipInspections.push(path.basename(file));const clip=(await context.read()).clips.find(row=>row.storedName===path.basename(file));
        if(clip&&!clips.some(original=>original.id===clip.id))counters.newPendingStates.push(clip.reviewStatus);
        return {duration:10,width:1080,height:1920,hasAudio:true,frameRate:30};
      }
      return {duration:30,width:1080,height:1920,hasAudio:true,frameRate:30};
    },makeSegment:async args=>{
      assert.equal(allowSlice,true,'Unexpected slice');counters.cuts++;await fs.writeFile(args.outputPath,'synthetic new cut '+args.startSeconds);
      if(duringCut)await duringCut(context,args);},
    runFfmpeg:async args=>{counters.renders++;await fs.writeFile(args.at(-1),'synthetic output '+path.basename(args.at(-1)));},runProcess,
    readJsonBody:async req=>req.body||{},jsonResponse:(res,status,body)=>Object.assign(res,{status,body}),cutter:{configured:false},
    materialCenter:{configured:true,listAssets:async()=>({items:[],pageSize:100,total:0}),
      createReturn:async body=>{counters.createReturn++;return {id:body.idempotency_key};},
      uploadReturnFile:async()=>{counters.upload++;if(duringUpload)await duringUpload(context);},
      completeReturn:async()=>{counters.completeReturn++;return {status:'completed',assetId:123,assetAvailable:true};},
      getReturn:async()=>({status:'completed',assetId:123,assetAvailable:true})}});
  await service.initialize();
  context.runtimeState=()=>service.runtimeState();
  context.route=async(method,url,body={})=>{const res={};await service.route({method,headers:{},body},res,new URL('http://localhost'+url),OWNER);return res;};
  context.start=async()=>{const res=await context.route('POST','/api/remix/automation/jobs/job/run-now');assert.equal(res.status,200,JSON.stringify(res));
    return until(async()=>{const saved=await context.read();return !service.runtimeState().activeAutoJobCount&&(saved.renders.length||saved.autoJobs[0].runs[0].errorMessage)&&saved;},'run completed');};
  context.returnFirst=async()=>{const saved=await context.read(),render=saved.renders[0];assert.ok(render);
    return context.route('POST',`/api/remix/renders/${render.id}/variants/${render.variants[0].id}/return-to-material-center`);};
  context.cut=(extra={})=>context.route('POST','/api/remix/clips',{sourceId:source.id,productCategory:source.productCategory,
    startSeconds:0,endSeconds:10,role:'hook',name:'Synthetic recut',...extra});
  return context;
}

test('actual legacy service: null SKU, current selected-segment proofs and unused expired offer produce independent reviewed outputs and return',async t=>{
  const f=await fixture(t),saved=await f.start();assert.equal(f.counters.renders,2,JSON.stringify(saved.autoJobs[0].runs));
  assert.equal(f.counters.outputReviews,2);assert.ok(saved.renders[0].variants.every(v=>v.reviewStatus==='approved'&&v.skuVersion===null));
  const result=await f.returnFirst();assert.equal(result.status,200,JSON.stringify(result));
  assert.equal(f.counters.completeReturn,1);assert.equal(saved.sources[0].speechSegments[4].semanticReviewProof,null);
});
test('actual legacy service: private history revocation prevents new return without editing public library',async t=>{
  const f=await fixture(t),before=await f.start();f.revoke();const result=await f.returnFirst();
  assert.notEqual(result.status,200);assert.equal(f.counters.createReturn,0);assert.deepEqual((await f.read()).sources,before.sources);
});
test('actual legacy service: private revocation during upload prevents completion',async t=>{
  const f=await fixture(t,{duringUpload:f=>f.revoke()});await f.start();const result=await f.returnFirst();
  assert.notEqual(result.status,200);assert.equal(f.counters.upload,1);assert.equal(f.counters.completeReturn,0);
});
test('actual legacy service: known edition cannot use null-edition evidence',async t=>{
  const f=await fixture(t,{mutateInventory:({source})=>{source.skuVersion='粤G妆网备字2026050125';}});
  await f.start();assert.equal(f.counters.renders,0);assert.equal(f.counters.outputReviews,0);
});
test('actual legacy clip route: same-range old missing evidence stays unchanged, current cut is pending and next request reuses it',async t=>{
  const f=await fixture(t,{allowSlice:true,mutateInventory:({clips})=>{delete clips[0].boundaryEvidence;delete clips[0].contentSha256;}});
  const before=(await f.read()).clips.find(c=>c.id==='clip0'),first=await f.cut();
  assert.equal(first.status,201,JSON.stringify(first));assert.notEqual(first.body.clip.id,'clip0');
  assert.equal(first.body.clip.reviewStatus,'pending');assert.equal(f.counters.cuts,1);
  const second=await f.cut();assert.equal(second.status,201);assert.equal(second.body.clip.id,first.body.clip.id);assert.equal(f.counters.cuts,1);
  assert.deepEqual((await f.read()).clips.find(c=>c.id==='clip0'),before,'Original old approval is never rewritten');
});
test('actual legacy clip route: current exact evidence and bytes reuse the existing clip without recutting',async t=>{
  const f=await fixture(t),result=await f.cut();assert.equal(result.status,201,JSON.stringify(result));
  assert.equal(result.body.clip.id,'clip0');assert.equal(f.counters.cuts,0);
});

test('actual queued same-run CTA recovery preserves old approved role, verifies cache only and reviews only the new pending cut',async t=>{
  const f=await fixture(t,{allowSlice:true,cachedCtaRecovery:true}),before=await f.read();
  const oldProof=structuredClone(before.clips.find(clip=>clip.id==='clip3')),reviews=f.counters.sourceReviews;
  const saved=await f.start();
  const recovered=saved.clips.find(clip=>clip.role==='cta'&&clip.startSeconds===30&&clip.endSeconds===40);
  assert.ok(recovered,JSON.stringify(saved.autoJobs[0].runs));assert.notEqual(recovered.id,'clip3');
  assert.deepEqual(saved.clips.find(clip=>clip.id==='clip3'),oldProof);
  assert.deepEqual(saved.sources,before.sources,'Role recovery never rewrites source ASR/proof/calibration snapshots');
  assert.ok(f.counters.newPendingStates.includes('pending'),'New role first enters ordinary pending review');
  assert.equal(recovered.reviewStatus,'approved',JSON.stringify(recovered.automaticAssessment));
  assert.equal(f.counters.cuts,1);assert.equal(f.counters.sourceReviews,reviews);
  assert.equal(f.counters.sourceAssessCalls,0);assert.equal(f.counters.asrCalls,0);
  assert.ok(f.counters.clipInspections.every(name=>name===recovered.storedName),'Existing approved pool is not technically re-reviewed');
  assert.equal(saved.autoJobs[0].runs[0].id,'run');assert.equal(saved.autoJobs[0].runs.length,1);
  const repeated=await f.cut({startSeconds:30,endSeconds:40,role:'cta'});
  assert.equal(repeated.status,201,JSON.stringify(repeated));assert.equal(repeated.body.clip.id,recovered.id);assert.equal(f.counters.cuts,1);
});
test('actual queued cached CTA recovery with a missing private receipt never requests replacement ASR or model approval',async t=>{
  const f=await fixture(t,{allowSlice:true,cachedCtaRecovery:true}),before=await f.read();
  const key=before.sources[0].speechSegments[3].semanticReviewProof.requestKey;
  assert.match(key,/^[a-f0-9]{64}$/);
  await fs.unlink(path.join(f.root,'source-semantic-reviews',key+'.json'));
  const saved=await f.start();
  assert.equal(f.counters.cuts,0);assert.equal(f.counters.sourceAssessCalls,0);assert.equal(f.counters.asrCalls,0);
  assert.equal(saved.renders.length,0);assert.deepEqual(saved.clips,before.clips);assert.deepEqual(saved.sources,before.sources);
});
for(const scenario of ['pause','private-revocation','source-byte-change','registration-pause'])test(`actual queued cache-only CTA recovery fails closed during cut: ${scenario}`,async t=>{
  let pausedAtFinalGuard=false;
  const f=await fixture(t,{allowSlice:true,cachedCtaRecovery:true,duringCatalog:async context=>{
    // The async guard already read active state; pause while its final catalog
    // read settles so only the synchronous registration-lock guard catches it.
    if(scenario==='registration-pause'&&context.counters.cuts&&!pausedAtFinalGuard){
      pausedAtFinalGuard=true;await context.route('POST','/api/remix/automation/jobs/job/pause');
    }
  },duringCut:async context=>{
    if(scenario==='pause')await context.route('POST','/api/remix/automation/jobs/job/pause');
    else if(scenario==='private-revocation')context.revoke();
    else if(scenario==='source-byte-change')await fs.writeFile(path.join(context.root,'sources','source.mp4'),'changed bytes during cut');
  }}),before=await f.read();
  const response=await f.route('POST','/api/remix/automation/jobs/job/run-now');assert.equal(response.status,200);
  const saved=await until(async()=>{
    const state=await f.read();return f.counters.cuts===1&&!f.runtimeState().activeAutoJobCount&&
      (scenario.includes('pause')?state.autoJobs[0].status==='paused':state.autoJobs[0].runs[0].errorMessage)&&state;
  },'guard blocked cached cut');
  assert.deepEqual(saved.clips,before.clips,'No current proof or new approval is fabricated after the guard fails');
  assert.equal(saved.renders.length,0);assert.equal(f.counters.sourceAssessCalls,0);assert.equal(f.counters.asrCalls,0);
  assert.equal(f.counters.cuts,1);assert.equal(f.counters.clipInspections.length,0);
  assert.equal((await fs.readdir(path.join(f.root,'clips'))).length,4,'Unregistered new cut is removed');
  if(scenario==='registration-pause'){
    assert.equal(pausedAtFinalGuard,true);
    assert.match(JSON.stringify(saved.autoJobs[0].runs[0].stageReports),/补切登记前本批恢复条件已变化/);
  }
});
test('actual legacy clip route: a rejected old range cannot be bypassed with a fresh cut',async t=>{
  const f=await fixture(t,{allowSlice:true,mutateInventory:({clips})=>{clips[0].reviewStatus='rejected';delete clips[0].boundaryEvidence;}});
  const result=await f.cut();assert.equal(result.status,400);assert.equal(f.counters.cuts,0);assert.equal((await f.read()).clips.length,4);
});
test('actual legacy clip route: changed evidence under the same import key blocks, never creates a second clip',async t=>{
  const f=await fixture(t,{allowSlice:true,mutateInventory:({clips})=>{clips[0].importIdempotencyKey='test-key';delete clips[0].boundaryEvidence;}});
  const result=await f.cut({importIdempotencyKey:'test-key'});assert.equal(result.status,400);
  assert.equal(f.counters.cuts,0);assert.equal((await f.read()).clips.length,4);
});
