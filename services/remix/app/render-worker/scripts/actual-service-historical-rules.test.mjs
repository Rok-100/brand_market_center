// Real service/actual-file verifier and byte-pinned historical metadata.
// Files, ffmpeg/probe and Cloud callbacks are synthetic, NOT business acceptance.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createClipRemixService} from '../clip-remix-service.mjs';
import {createHistoricalMediaVerifier} from '../historical-media-verifier.mjs';
import {createHistoricalApprovedInventory,HISTORICAL_INVENTORY_JOB as JOB,HISTORICAL_SEQUENCE_VERSION} from '../historical-approved-inventory.mjs';
import {HISTORICAL_OUTPUT_RULES_POLICY,HISTORICAL_OUTPUT_CHECKS,historicalRulesVariantPassed} from '../historical-output-rules.mjs';
const reference=await fs.readFile(new URL('../../worker-tests/fixtures/historical-success-reference-20261003.json',import.meta.url));
const baseline=JSON.parse(reference),OWNER={sub:'FD-026222',name:'isolated original owner'};
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(fn){for(let i=0;i<600;i++){const result=await fn();if(result)return result;await sleep(10);}throw Error('historical fixture timeout');}
async function fixture(t,{enabled=true,jobId=JOB,afterRender,badOutput=false,mutateSeed}={}){
 const env={WIS_REMIX_SOURCE_REVIEW_ENABLED:'true',WIS_REMIX_VISUAL_REVIEW_ENABLED:'true',WIS_REMIX_VISION_PROVIDER:'fandow',
  JUMP_LLM_URL:'https://example.invalid/no-calls',JUMP_LLM_TOKEN:'synthetic-test',JUMP_LLM_APPLICATION:'fixture',JUMP_LLM_PROVIDER:'fixture',JUMP_LLM_VISION_MODEL:'fixture'};
 const prior=Object.fromEntries(Object.keys(env).map(k=>[k,process.env[k]]));Object.assign(process.env,env);
 t.after(()=>{for(const[k,v]of Object.entries(prior)){if(v===undefined)delete process.env[k];else process.env[k]=v;}});
 const dataDir=await fs.mkdtemp(path.join(os.tmpdir(),'wis-historical-rules-')),root=path.join(dataDir,'clip-remix'),libraryPath=path.join(root,'library.json');
 t.mock.method(globalThis,'setInterval',()=>({unref(){}}));
 t.mock.method(globalThis,'fetch',async()=>{throw Error('No model/network request authorized by this fixture');});
 for(const dir of ['clips','sources','outputs'])await fs.mkdir(path.join(root,dir),{recursive:true});
 const clips=baseline.clips.map(row=>Object.fromEntries(['id','sourceId','name','role','reviewStatus','reviewedAt','reviewNote','reviewedById',
  'contentSha256','storedName','startSeconds','endSeconds','durationSeconds','productCategory','visibility'].map(key=>[key,row[key]])));
 const sources=[...new Map(baseline.clips.map(row=>[row.sourceId,{id:row.sourceId,storedName:row.sourceStoredName,
  contentSha256:row.sourceContentSha256,productCategory:row.sourceProductCategory,skuVersion:row.skuVersion,
  visibility:row.sourceVisibility,materialCenterAssetId:row.sourceAssetId,hasAudio:true,createdById:OWNER.sub}])).values()];
 for(const clip of clips){const row=baseline.clips.find(c=>c.id===clip.id);if(row.text)clip.text=row.text;
  await fs.writeFile(path.join(root,'clips',clip.storedName),'synthetic historical bytes '+clip.id);}
 const run={id:'original-run',status:'awaiting_sources',dateKey:'2026-10-04',targetCount:2,targetDurationSeconds:90,renderIds:[],
  selectedSourceIds:['retained-previous-source'],versionPreparationAttempts:{old:{attempts:3,complete:true}},
  slotSelections:{},generatedCount:0,failedCount:2,attemptedCount:2,startCursor:0,consecutiveReviewFailures:2};
 const job={id:jobId,name:'isolated historical stock',createdById:OWNER.sub,createdByName:OWNER.name,status:'paused',scheduleEnabled:false,
  frameworkId:'historical-framework',productCategory:'黑晶面膜',dailyTarget:2,targetDurationSeconds:90,sourceSelectionLimit:3,
  includeUsageDisclaimer:true,usageDisclaimerText:'产品使用效果因人而异',autoApproveOutputs:true,autoReturnAfterApproval:false,
  qianchuanDelivery:{enabled:false},runs:[run]};
 const seed={version:7,sources,clips,renders:[],autoJobs:[job],folders:[],frameworks:[{id:job.frameworkId,name:'five actual roles',visibility:'team',
  slots:['hook','pain','solution','proof','cta'].map(id=>({id,label:id}))}],
  verifiedAutoRemixIdentities:[{userId:OWNER.sub,userName:OWNER.name,verifiedAt:'2026-01-01T00:00:00Z',lastSeenAt:'2026-01-01T00:00:00Z',source:'oa'}],
  autoRemixGrants:[{userId:OWNER.sub,userName:OWNER.name,verifiedAt:'2026-01-01T00:00:00Z'}]};
 if(mutateSeed)mutateSeed(seed);await fs.writeFile(libraryPath,JSON.stringify(seed));
 const counters={renders:0,asr:0,sourceReview:0,cuts:0,returnStart:0,returnComplete:0,returnedBody:null};
 const durations=new Map();let service;
 const read=async()=>JSON.parse(await fs.readFile(libraryPath,'utf8'));
 const context={root,read,counters,clips,jobId};
 const options={dataDir,autoRemixAdminUsers:'test-admin',nowIso:()=>new Date().toISOString(),
  historicalApprovedInventory:enabled?createHistoricalApprovedInventory(reference):null,
  historicalMediaVerifierFactory:enabled?createHistoricalMediaVerifier:null,
  localAsrRunner:{ensureSourceEvidence:async()=>{counters.asr++;throw Error('No new ASR');}},
  sourceSemanticReviewer:{assess:async()=>{counters.sourceReview++;throw Error('No new source review');}},
  inspectMedia:async file=>({duration:durations.get(file)||clips.find(c=>c.storedName===path.basename(file))?.durationSeconds||90,
    width:badOutput&&file.includes(path.sep+'outputs'+path.sep)?720:1080,height:1920,hasAudio:true,frameRate:30}),
  runProcess:async(_command,args)=>{assert.ok(args.includes('blackdetect=d=1:pic_th=0.98'));return {stdout:'',stderr:''};},
  makeSegment:async()=>{counters.cuts++;throw Error('Existing local fixture clips must not be recut');},
  runFfmpeg:async args=>{counters.renders++;const lines=(await fs.readFile(args[args.indexOf('-i')+1],'utf8')).trim().split('\n');
    const duration=lines.reduce((n,line)=>n+clips.find(c=>line.includes(c.storedName)).durationSeconds,0);
    durations.set(args.at(-1),duration);await fs.writeFile(args.at(-1),'new synthetic output '+path.basename(args.at(-1)));
    if(afterRender)await afterRender(context,args);},
  readJsonBody:async req=>req.body||{},jsonResponse:(res,status,body)=>Object.assign(res,{status,body}),cutter:{configured:false},
  materialCenter:{configured:true,listAssets:async()=>({items:[],pageSize:100,total:0}),
    createReturn:async body=>{counters.returnStart++;counters.returnedBody=body;return {id:body.idempotency_key};},
    uploadReturnFile:async()=>{},completeReturn:async()=>{counters.returnComplete++;return {status:'completed',assetId:123,assetAvailable:true};},
    getReturn:async()=>({status:'completed',assetId:123,assetAvailable:true})}};
 service=createClipRemixService(options);await service.initialize();
 context.route=async(method,url,body={})=>{const res={};await service.route({method,headers:{},body},res,new URL('http://localhost'+url),OWNER);return res;};
 context.restart=()=>{service=createClipRemixService(options);};
 context.start=async()=>{const priorState=await read();const result=await context.route('POST',`/api/remix/automation/jobs/${jobId}/run-now`);assert.equal(result.status,200,JSON.stringify(result));
  return until(async()=>{if(service.runtimeState().activeAutoJobCount)return false;const saved=await read();
    const run=saved.autoJobs[0].runs[0],oldRun=priorState.autoJobs[0].runs[0];
    return !service.runtimeState().activeAutoJobCount&&(saved.renders.length>priorState.renders.length||run.errorMessage&&(run.id!==oldRun?.id||run.errorMessage!==oldRun?.errorMessage))&&saved;});};
 context.returnFirst=async()=>{const saved=await read(),r=saved.renders[0];assert.ok(r,JSON.stringify(saved.autoJobs));
  return context.route('POST',`/api/remix/renders/${r.id}/variants/${r.variants[0].id}/return-to-material-center`);};
 t.after(async()=>{await context.route('POST',`/api/remix/automation/jobs/${jobId}/pause`);await until(()=>!service.runtimeState().activeAutoJobCount&&!service.runtimeState().activeClipReplenishmentJobCount);
  await fs.rm(dataDir,{recursive:true,force:true,maxRetries:5,retryDelay:25});});
 return context;
}
test('historical real service plans 90 seconds from pinned old metadata, performs 16 real rules and returns trusted payload',async t=>{
 const f=await fixture(t),before=await f.read(),saved=await f.start();
 assert.equal(f.counters.renders,2,JSON.stringify(saved.autoJobs));
 const render=saved.renders[0];assert.equal(render.sourceEvidencePolicy,HISTORICAL_OUTPUT_RULES_POLICY);
 assert.equal(render.automation.jobId,JOB);assert.equal(render.automation.runId,'original-run');
 assert.equal(saved.autoJobs[0].runs[0].status,'completed');assert.equal(saved.autoJobs[0].runs[0].generatedCount,2);
 assert.deepEqual(saved.clips,before.clips);assert.deepEqual(saved.sources,before.sources);
 assert.deepEqual(saved.autoJobs[0].runs[0].versionPreparationAttempts,before.autoJobs[0].runs[0].versionPreparationAttempts);
 for(const v of render.variants){assert.equal(v.reviewStatus,'approved');assert.equal(v.reviewMode,'automatic_rules');
  assert.equal(historicalRulesVariantPassed(v),true);assert.equal(v.automaticAssessment.mode,'rules');
  assert.deepEqual(v.automaticAssessment.checks.map(c=>c.name),HISTORICAL_OUTPUT_CHECKS);assert.ok(v.automaticAssessment.checks.every(c=>c.passed===true));
  assert.equal(v.automaticAssessment.visualReview,undefined);assert.equal(v.contentSequenceIdentity.version,HISTORICAL_SEQUENCE_VERSION);
  assert.equal(v.historicalInventoryReview.input.resolvedInputs,undefined);assert.ok(v.actualDurationSeconds>=82.8&&v.actualDurationSeconds<=97.2);
 }
 assert.equal((await f.returnFirst()).status,200);assert.equal(f.counters.returnComplete,1);
 assert.equal(f.counters.returnedBody.automatic_review_enabled,true);assert.equal(f.counters.returnedBody.automatic_assessment.mode,'rules');
 assert.equal(f.counters.asr+f.counters.sourceReview+f.counters.cuts,0);
});
test('historical real service retains technical failure and blocks Cloud without inventing visual pass',async t=>{
 const f=await fixture(t,{badOutput:true}),saved=await f.start();assert.ok(saved.renders.length,JSON.stringify(saved.autoJobs));
 assert.ok(saved.renders[0].variants.every(v=>v.reviewStatus==='changes_requested'&&!v.automaticAssessment.autoApproved&&!v.automaticAssessment.visualReview));
 assert.notEqual((await f.returnFirst()).status,200);assert.equal(f.counters.returnStart,0);
 assert.equal(saved.autoJobs[0].runs[0].consecutiveReviewFailures,2,'No historical failures reset by technical hold');
});
test('historical real service pause during new render keeps new bytes but never approves or returns',async t=>{
 const f=await fixture(t,{afterRender:f=>f.route('POST',`/api/remix/automation/jobs/${JOB}/pause`)}),saved=await f.start();
 assert.ok(saved.renders.length,JSON.stringify(saved.autoJobs));assert.equal(saved.autoJobs[0].status,'paused');assert.equal(saved.autoJobs[0].nextRunAt,null);
 assert.ok(saved.renders[0].variants.every(v=>!v.automaticAssessment.autoApproved&&v.reviewStatus!=='approved'));
 assert.notEqual((await f.returnFirst()).status,200);assert.equal(f.counters.returnStart,0);
});
test('historical real service input bytes changing during render invalidate new evidence without changing old approval',async t=>{
 const f=await fixture(t,{afterRender:async f=>{for(const clip of f.clips)await fs.appendFile(path.join(f.root,'clips',clip.storedName),'changed');}}),before=await f.read(),saved=await f.start();
 assert.ok(saved.renders.length,JSON.stringify(saved.autoJobs));assert.ok(saved.renders[0].variants.every(v=>v.reviewStatus!=='approved'));
 assert.deepEqual(saved.clips,before.clips);assert.notEqual((await f.returnFirst()).status,200);assert.equal(f.counters.returnStart,0);
});
for(const kind of ['clip-bytes','output-bytes','approval','owner','pause','foreign-job','marker'])test('historical real service effects revalidate '+kind,async t=>{
 const f=await fixture(t),saved=await f.start();assert.equal(f.counters.renders,2,JSON.stringify(saved.autoJobs));
 const render=saved.renders[0],variant=render.variants[0];
 if(kind==='clip-bytes')await fs.appendFile(path.join(f.root,'clips',saved.clips.find(c=>c.id===variant.clipSequence[0]).storedName),'changed');
 else if(kind==='output-bytes')await fs.appendFile(path.join(f.root,'outputs',variant.storedName),'changed');
 else {if(kind==='approval')saved.clips.find(c=>c.id===variant.clipSequence[0]).reviewStatus='rejected';
  if(kind==='owner')saved.autoJobs[0].createdById='other';if(kind==='pause')saved.autoJobs[0].status='paused';
  if(kind==='foreign-job')render.automation.jobId='other';if(kind==='marker')render.sourceEvidencePolicy=null;
  await fs.writeFile(path.join(f.root,'library.json'),JSON.stringify(saved));f.restart();}
 assert.notEqual((await f.returnFirst()).status,200);assert.equal(f.counters.returnStart,0);assert.equal(f.counters.returnComplete,0);
});
test('manual HTTP payload cannot opt into historical automatic rules protocol',async t=>{
 const f=await fixture(t),saved=await f.read(),selections=Object.fromEntries(['hook','pain','solution','proof','cta'].map(role=>[role,saved.clips.filter(c=>c.role===role).slice(0,1).map(c=>c.id)]));
 const result=await f.route('POST','/api/remix/renders',{frameworkId:'historical-framework',slotSelections:selections,productCategory:'黑晶面膜',maxOutputs:1,
  sourceEvidencePolicy:HISTORICAL_OUTPUT_RULES_POLICY,outputReviewPolicy:HISTORICAL_OUTPUT_RULES_POLICY,automation:{jobId:JOB,runId:'original-run'},autoApproveOutputs:true});
 if(result.status===201){const render=(await f.read()).renders[0];assert.notEqual(render.sourceEvidencePolicy,HISTORICAL_OUTPUT_RULES_POLICY);
  assert.ok(render.variants.every(v=>v.reviewMode!=='automatic_rules'&&v.reviewStatus!=='approved'));}
 assert.equal(f.counters.returnStart,0);
});
test('historical real service same-day next batch preserves prior outputs and deduplicates across runs and 63 old sequences',async t=>{
 const f=await fixture(t),first=await f.start();assert.equal(first.autoJobs[0].runs[0].status,'completed');
 const oldOutput=structuredClone(first.renders),oldLedger=structuredClone(first.autoJobs[0].sequenceReservations);
 const second=await f.start();assert.equal(f.counters.renders,4,JSON.stringify(second.autoJobs));
 assert.equal(second.autoJobs[0].runs.length,2);assert.ok(second.autoJobs[0].runs.every(run=>run.status==='completed'&&run.generatedCount===2));
 assert.equal(second.autoJobs[0].dailyTarget,2);assert.equal(second.autoJobs[0].targetDurationSeconds,90);
 assert.deepEqual(second.renders.filter(r=>oldOutput.some(old=>old.id===r.id)),oldOutput);
 for(const record of oldLedger)assert.deepEqual(second.autoJobs[0].sequenceReservations.find(row=>row.key===record.key),record);
 const keys=second.renders.flatMap(r=>r.variants.map(v=>v.contentSequenceIdentity.key));assert.equal(new Set(keys).size,4);
 const originalKeys=new Set(createHistoricalApprovedInventory(reference).historicalOutputSequences().map(item=>item.key));
 assert.ok(keys.every(key=>!originalKeys.has(key)),'63 historical success identities are excluded but do not count as new success');
 assert.equal(second.autoJobs[0].runs[0].onDemandSourcePreparation,undefined);
 assert.equal(f.counters.asr+f.counters.sourceReview+f.counters.cuts,0);
});
test('historical real service never releases an unresolved cross-run reservation or duplicates its render',async t=>{
 const f=await fixture(t),first=await f.start(),job=first.autoJobs[0];
 job.sequenceReservations[0].status='reserved';delete job.sequenceReservations[0].recordedAt;
 await fs.writeFile(path.join(f.root,'library.json'),JSON.stringify(first));f.restart();
 const resumed=await f.start();assert.equal(f.counters.renders,2);
 assert.equal(resumed.autoJobs[0].runs[0].automaticReviewHold.reason,'OUTPUT_SEQUENCE_PENDING');
 assert.deepEqual(resumed.autoJobs[0].sequenceReservations,job.sequenceReservations);
 assert.equal(f.counters.asr+f.counters.sourceReview+f.counters.cuts,0);
});
test('historical real service exact 20 output cap remains even without optional progressive preparation DI',async t=>{
 const f=await fixture(t);let saved;
 for(let batch=1;batch<=10;batch++){
  saved=await f.start();assert.equal(f.counters.renders,batch*2,JSON.stringify(saved.autoJobs));
  assert.equal(saved.autoJobs[0].runs[0].generatedCount,2);assert.equal(saved.autoJobs[0].runs[0].status,'completed');
 }
 assert.equal(new Set(saved.renders.flatMap(r=>r.variants.map(v=>v.contentSequenceIdentity.key))).size,20);
 const before=structuredClone(saved.renders),ledger=structuredClone(saved.autoJobs[0].sequenceReservations);
 const capped=await f.start();assert.equal(f.counters.renders,20);assert.deepEqual(capped.renders,before);
 assert.deepEqual(capped.autoJobs[0].sequenceReservations,ledger);
 assert.equal(capped.autoJobs[0].runs[0].automaticReviewHold.reason,'PROGRESSIVE_TARGET_REACHED');
 assert.equal(f.counters.asr+f.counters.sourceReview+f.counters.cuts,0);
});
