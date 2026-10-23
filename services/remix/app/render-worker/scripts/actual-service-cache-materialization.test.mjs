// Real service/scheduler and SourceSemanticReview private receipt fixtures.
// All media, ASR and provider responses are isolated synthetic test evidence,
// never real content approval. Resume MUST NOT invoke ASR or a source model.
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

const JOB='a5fdb74d-a2a1-4cf0-affe-d9bbfaf30354';
const OWNER={sub:'FI-000001',name:'Isolated legacy owner'};
const hash=x=>createHash('sha256').update(x).digest('hex');
const canonical=x=>Array.isArray(x)?x.map(canonical):x&&typeof x==='object'
  ?Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])):x;
const digest=x=>hash(JSON.stringify(canonical(x)));
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(fn,label){for(let i=0;i<700;i++){const value=await fn();if(value)return value;await sleep(20);}throw Error('Timeout: '+label);}
async function privateReceiptSnapshot(root){
  const directory=path.join(root,'source-semantic-reviews'),rows=[];
  async function visit(current){for(const entry of await fs.readdir(current,{withFileTypes:true})){
    const file=path.join(current,entry.name);if(entry.isDirectory())await visit(file);
    else rows.push([path.relative(directory,file),hash(await fs.readFile(file))]);
  }}
  await visit(directory);return rows.sort((a,b)=>a[0].localeCompare(b[0]));
}

// Reuse the existing real-receipt fixture, without importing its test cases or
// replacing any runtime implementation. Exact replacements guard fixture drift.
const fixtureText=await fs.readFile(new URL('./actual-service-legacy-source.test.mjs',import.meta.url),'utf8');
const fixtureStart=fixtureText.indexOf('async function fixture(');
const fixtureEnd=fixtureText.indexOf("\ntest('actual legacy service:",fixtureStart);
assert.ok(fixtureStart>=0&&fixtureEnd>fixtureStart);
let fixtureBody=fixtureText.slice(fixtureStart,fixtureEnd);
function change(from,to){assert.equal(fixtureBody.split(from).length,2,`fixture anchor ${from}`);fixtureBody=fixtureBody.replace(from,to);}
fixtureBody=fixtureBody.replaceAll('/automation/jobs/job/','/automation/jobs/'+JOB+'/');
change("const job={id:'job'","const job={id:JOB");
change('sourceVersionResolver,\n    sourceSemanticReviewer:',
  'sourceVersionResolver,progressiveSourcePreparationJobIds:[JOB],\n    sourceSemanticReviewer:');
change("return {sourceIds:revoked?[]:[source.id],bindingKeysBySourceId:{[source.id]:skuContext.bindingSha256}};",
  "return {registrySha256:hash('synthetic registry'),sourceIds:revoked?[]:[source.id,...(context.extraSourceIds||[])],bindingKeysBySourceId:{[source.id]:context.catalogBindingKey||skuContext.bindingSha256,...Object.fromEntries((context.extraSourceIds||[]).map(id=>[id,hash(id)]))}};");
change("return {ready:true,mode:LEGACY_MODE,sourceSnapshot:structuredClone(source),skuContext,bindingSha256:skuContext.bindingSha256,registrySha256:hash('synthetic registry')};",
  "const resolvedContext=source.id===raw.id?skuContext:{...structuredClone(skuContext),sourceScope:{...skuContext.sourceScope,sourceId:source.id,revisionSha256:hash(source.id)},historicalApprovalSha256:hash(source.id),bindingSha256:hash(source.id)};\n      return {ready:true,mode:LEGACY_MODE,sourceSnapshot:structuredClone(source),skuContext:resolvedContext,bindingSha256:resolvedContext.bindingSha256,registrySha256:hash('synthetic registry')};");
change("if(cachedCtaRecovery&&file.includes(path.sep+'clips'+path.sep)){",
  "if(cachedCtaRecovery&&file.includes(path.sep+'clips'+path.sep)){\n        if(duringInspect)await duringInspect(context,file);");
change('return {duration:30,width:1080,height:1920,hasAudio:true,frameRate:30};',
  "if(duringSourceInspect&&file.includes(path.sep+'sources'+path.sep))await duringSourceInspect(context,file);\n      return {duration:file.includes(path.sep+'sources'+path.sep)?60:30,hasVideo:true,width:1080,height:1920,hasAudio:true,frameRate:30};");
change('  await service.initialize();',
  "  const seed=JSON.parse(await fs.readFile(libraryPath,'utf8'));await setup(seed,context);await fs.writeFile(libraryPath,JSON.stringify(seed));await service.initialize();");

async function fixture(t,{mode='missing',extraSource=false,seedMutation,duringInspect,duringCut,duringCatalog,duringSourceInspect}={}){
  const setup=async(seed,context)=>{
    const source=seed.sources[0],job=seed.autoJobs[0],run=job.runs[0];
    source.sourceSemanticReview={status:'partial',passedCount:4,totalCount:5,recoverable:false,
      pendingReasons:['business_fact_attention'],reason:null,bindingSha256:source.legacySourceEvidence.bindingSha256};
    run.status='awaiting_sources';run.createdClipIds=[];run.stageReports=[];run.slotSelections={};
    run.versionPreparationAttempts[source.id].attemptedAt='2026-10-03T00:00:00Z';
    run.versionPreparationAttempts[source.id].reason=null;
    // No hook among the original texts: after the cuts are recovered, this
    // fixture stops at genuine framework shortage instead of rendering/model IO.
    if(mode==='missing')seed.clips=[];
    else if(mode==='pending')for(const clip of seed.clips){
      clip.reviewStatus='pending';delete clip.automaticAssessment;delete clip.reviewedAt;
    }
    if(extraSource){
      const next={...structuredClone(source),id:'unprepared-next-source',storedName:'next.mp4',speechSegments:[]};
      delete next.legacySourceEvidence;delete next.sourceSemanticReview;delete next.analysisAsrEvidence;
      seed.sources.push(next);context.extraSourceIds=[next.id];
      await fs.copyFile(path.join(context.root,'sources',source.storedName),path.join(context.root,'sources',next.storedName));
    }
    if(seedMutation)await seedMutation(seed,context);
  };
  const original=new Function('test','assert','fs','os','path','createHash','createClipRemixService','SourceSemanticReview',
    'ASR_FRAME_RULE','verifyAsrBundle','alignAsrCuesToFrames','LEGACY_MODE','hasLegacyClipPointer','hash','canonical','digest',
    'OWNER','sleep','until','JOB','setup','duringInspect','duringSourceInspect',fixtureBody+';return fixture;')(
      test,assert,fs,os,path,createHash,createClipRemixService,SourceSemanticReview,
      ASR_FRAME_RULE,verifyAsrBundle,alignAsrCuesToFrames,LEGACY_MODE,hasLegacyClipPointer,
      hash,canonical,digest,OWNER,sleep,until,JOB,setup,duringInspect,duringSourceInspect);
  const f=await original(t,{allowSlice:true,cachedCtaRecovery:true,duringCut,duringCatalog});
  f.seedSourceReviews=f.counters.sourceReviews;
  f.privateBefore=await privateReceiptSnapshot(f.root);
  f.pause=()=>f.route('POST',`/api/remix/automation/jobs/${JOB}/pause`);
  f.resume=async()=>{
    const response=await f.route('POST',`/api/remix/automation/jobs/${JOB}/run-now`);
    assert.equal(response.status,200,JSON.stringify(response));
    // Read after inactive, then recheck inactivity: do not return a pre-catch
    // snapshot merely because the async task settled while that read awaited.
    let quiet=0;
    return until(async()=>{
      const runtime=f.runtimeState();
      if(runtime.activeAutoJobCount||runtime.pendingClipReviewCount){quiet=0;return false;}
      const saved=await f.read(),job=saved.autoJobs.find(row=>row.id===JOB);
      if(f.runtimeState().activeAutoJobCount||!job?.runs[0]?.errorMessage&&!job?.runs[0]?.automaticReviewHold
        &&job?.status!=='paused'&&job?.runs[0]?.status!=='awaiting_sources'){quiet=0;return false;}
      return ++quiet>=4&&saved;
    },'cached materialization settled');
  };
  return f;
}

function noNewProviders(f){
  assert.equal(f.counters.sourceReviews,f.seedSourceReviews);
  assert.equal(f.counters.sourceAssessCalls,0);assert.equal(f.counters.asrCalls,0);
  assert.equal(f.counters.outputReviews,0);assert.equal(f.counters.renders,0);
  assert.equal(f.counters.createReturn,0);
}

test('actual completed preparation interrupted before first cut recovers all proven non-CTA and CTA segments without rotating sources',async t=>{
  const f=await fixture(t,{extraSource:true}),before=await f.read(),saved=await f.resume();
  assert.equal(saved.clips.length,4,JSON.stringify(saved.autoJobs[0].runs));
  assert.equal(f.counters.cuts,4);assert.ok(saved.clips.some(clip=>clip.role!=='cta'));
  assert.ok(saved.clips.every(clip=>clip.reviewStatus==='approved'),JSON.stringify(saved.clips.map(c=>c.automaticAssessment)));
  assert.ok(saved.clips.every(clip=>clip.startSeconds<40),'Expired unapproved cue remains uncut');
  assert.deepEqual(saved.sources,before.sources,'Source text, ranges and private proof pointers stay unchanged');
  assert.deepEqual(saved.autoJobs[0].runs[0].versionPreparationAttempts,before.autoJobs[0].runs[0].versionPreparationAttempts);
  assert.deepEqual(saved.autoJobs[0].progressiveSourcePreparation.sourceIds,['legacy-source']);
  assert.deepEqual(saved.autoJobs[0].runs[0].onDemandSourcePreparation.sourceIds,['legacy-source']);
  assert.deepEqual(await privateReceiptSnapshot(f.root),f.privateBefore,'Private receipts and original budget reservations are byte-identical');
  noNewProviders(f);
});

test('actual valid pending clip bytes are reused without recutting and receive ordinary guarded technical review',async t=>{
  const f=await fixture(t,{mode:'pending'}),before=await f.read(),saved=await f.resume();
  assert.equal(f.counters.cuts,0);assert.equal(saved.clips.length,4);
  assert.deepEqual(saved.clips.map(c=>[c.id,c.storedName,c.contentSha256,c.role]),before.clips.map(c=>[c.id,c.storedName,c.contentSha256,c.role]));
  assert.ok(saved.clips.every(c=>c.reviewStatus==='approved'&&c.automaticAssessment?.status==='passed'),JSON.stringify(saved.autoJobs[0].runs));
  assert.ok(f.counters.clipInspections.length>=4);assert.deepEqual(saved.sources,before.sources);noNewProviders(f);
  assert.deepEqual(await privateReceiptSnapshot(f.root),f.privateBefore);
});

test('actual repeated recovery preserves current approved clips without cutting or technically reviewing them again',async t=>{
  const f=await fixture(t),first=await f.resume();assert.equal(first.clips.length,4);
  const cuts=f.counters.cuts,inspections=f.counters.clipInspections.length;
  const second=await f.resume();assert.deepEqual(second.clips,first.clips);assert.deepEqual(second.sources,first.sources);
  assert.equal(f.counters.cuts,cuts);assert.equal(f.counters.clipInspections.length,inspections);noNewProviders(f);
  assert.deepEqual(await privateReceiptSnapshot(f.root),f.privateBefore);
});

test('actual pause after cached cuts are registered resumes the same pending files and finishes technical review without duplicate cuts',async t=>{
  let paused=false;
  const f=await fixture(t,{duringInspect:async context=>{
    if(paused)return;paused=true;await context.route('POST',`/api/remix/automation/jobs/${JOB}/pause`);
  }}),before=await f.read(),interrupted=await f.resume();
  assert.equal(interrupted.clips.length,4);assert.equal(f.counters.cuts,4);
  assert.ok(interrupted.clips.every(c=>c.reviewStatus==='pending'&&!c.automaticAssessment));
  assert.equal(interrupted.autoJobs[0].status,'paused');assert.equal(interrupted.autoJobs[0].nextRunAt,null);
  const resumed=await f.resume();assert.equal(f.counters.cuts,4);
  assert.deepEqual(resumed.clips.map(c=>[c.id,c.storedName,c.contentSha256]),interrupted.clips.map(c=>[c.id,c.storedName,c.contentSha256]));
  assert.ok(resumed.clips.every(c=>c.reviewStatus==='approved'&&c.automaticAssessment?.status==='passed'),JSON.stringify(resumed.autoJobs[0].runs));
  assert.deepEqual(resumed.sources,before.sources);assert.deepEqual(resumed.autoJobs[0].runs[0].versionPreparationAttempts,before.autoJobs[0].runs[0].versionPreparationAttempts);
  assert.equal(resumed.autoJobs[0].runs.length,1);assert.equal(resumed.autoJobs[0].runs[0].id,'run');
  assert.deepEqual(await privateReceiptSnapshot(f.root),f.privateBefore);noNewProviders(f);
});

for(const scenario of ['missing-private-receipt','source-byte-change','private-revocation','pending-clip-byte-change'])
test(`actual cached materialization refuses unavailable current evidence without recutting or re-reviewing: ${scenario}`,async t=>{
  const f=await fixture(t,{mode:scenario==='pending-clip-byte-change'?'pending':'missing',extraSource:true}),before=await f.read();
  if(scenario==='missing-private-receipt')await fs.unlink(path.join(f.root,'source-semantic-reviews',before.sources[0].speechSegments[0].semanticReviewProof.requestKey+'.json'));
  if(scenario==='source-byte-change')await fs.writeFile(path.join(f.root,'sources','source.mp4'),'changed current source');
  if(scenario==='private-revocation')f.revoke();
  if(scenario==='pending-clip-byte-change')await fs.writeFile(path.join(f.root,'clips',before.clips[0].storedName),'changed pending bytes');
  const saved=await f.resume();assert.deepEqual(saved.clips,before.clips);assert.deepEqual(saved.sources,before.sources);
  assert.equal(f.counters.cuts,0);assert.equal(f.counters.clipInspections.length,0);
  assert.deepEqual(saved.autoJobs[0].runs[0].onDemandSourcePreparation.sourceIds,['legacy-source']);noNewProviders(f);
});

for(const scenario of ['pause','private-revocation','source-byte-change','private-receipt-loss','all-private-receipts-lost'])
test(`actual cached cut rechecks current authorization/evidence before registration: ${scenario}`,async t=>{
  let triggered=false;
  const f=await fixture(t,{extraSource:true,duringCut:async context=>{
    if(triggered)return;triggered=true;
    if(scenario==='pause')await context.route('POST',`/api/remix/automation/jobs/${JOB}/pause`);
    if(scenario==='private-revocation')context.revoke();
    if(scenario==='source-byte-change')await fs.writeFile(path.join(context.root,'sources','source.mp4'),'changed during cut');
    if(scenario==='private-receipt-loss'){
      const saved=await context.read();await fs.unlink(path.join(context.root,'source-semantic-reviews',saved.sources[0].speechSegments[0].semanticReviewProof.requestKey+'.json'));
    }
    if(scenario==='all-private-receipts-lost'){
      const saved=await context.read(),keys=new Set(saved.sources[0].speechSegments.map(s=>s.semanticReviewProof?.requestKey).filter(Boolean));
      for(const key of keys)await fs.unlink(path.join(context.root,'source-semantic-reviews',key+'.json'));
    }
  }}),before=await f.read(),saved=await f.resume();
  assert.equal(triggered,true);
  if(scenario==='private-receipt-loss'){
    // The first request covers cues 1..3; cue 4 has a separate real private
    // response. Do not broaden a missing receipt into an invented global veto.
    assert.equal(f.counters.cuts,2);assert.equal(saved.clips.length,1);
    assert.equal(saved.clips[0].startSeconds,30);assert.equal(saved.clips[0].reviewStatus,'approved');
    assert.ok(saved.clips.every(c=>c.semanticReviewProof.requestKey!==before.sources[0].speechSegments[0].semanticReviewProof.requestKey));
    assert.equal((await fs.readdir(path.join(f.root,'clips'))).length,5,'Affected first cut cleaned; independently valid fourth cue retained');
  }else{
    assert.equal(f.counters.cuts,1);assert.deepEqual(saved.clips,before.clips);assert.equal(f.counters.clipInspections.length,0);
    assert.equal((await fs.readdir(path.join(f.root,'clips'))).length,4,'Unregistered unique output removed, original fixture files remain');
  }
  if(scenario==='pause'){assert.equal(saved.autoJobs[0].status,'paused');assert.equal(saved.autoJobs[0].nextRunAt,null);}
  if(scenario.includes('receipt')){
    const repeated=await f.resume();assert.deepEqual(repeated.clips,saved.clips);
    assert.deepEqual(repeated.autoJobs[0].runs[0].onDemandSourcePreparation.sourceIds,['legacy-source']);
    assert.deepEqual(repeated.autoJobs[0].progressiveSourcePreparation.sourceIds,['legacy-source']);
  }
  noNewProviders(f);
});

test('actual pause at cached cut final catalog check is caught before registration and cleans only the unregistered output',async t=>{
  let paused=false;
  const f=await fixture(t,{duringCatalog:async context=>{
    if(!context.counters.cuts||paused)return;paused=true;
    await context.route('POST',`/api/remix/automation/jobs/${JOB}/pause`);
  }}),before=await f.read(),saved=await f.resume();
  assert.equal(paused,true);assert.equal(f.counters.cuts,1);assert.deepEqual(saved.clips,before.clips);
  assert.equal(saved.autoJobs[0].status,'paused');assert.equal(saved.autoJobs[0].nextRunAt,null);
  assert.equal((await fs.readdir(path.join(f.root,'clips'))).length,4);noNewProviders(f);
});

for(const scenario of ['pause','private-revocation','source-byte-change','clip-byte-change'])
test(`actual pending technical review does not save approval after its final current-evidence gate changes: ${scenario}`,async t=>{
  let triggered=false;
  const f=await fixture(t,{mode:'pending',duringInspect:async(context,file)=>{
    if(triggered)return;triggered=true;
    if(scenario==='pause')await context.route('POST',`/api/remix/automation/jobs/${JOB}/pause`);
    if(scenario==='private-revocation')context.revoke();
    if(scenario==='source-byte-change')await fs.writeFile(path.join(context.root,'sources','source.mp4'),'changed during technical review');
    if(scenario==='clip-byte-change')await fs.writeFile(file,'changed during technical review');
  }}),before=await f.read(),saved=await f.resume();
  assert.equal(triggered,true);assert.equal(f.counters.cuts,0);
  if(scenario==='clip-byte-change'){
    assert.equal(saved.clips.find(c=>c.storedName===f.counters.clipInspections[0]).reviewStatus,'pending');
  }else assert.ok(saved.clips.every(c=>c.reviewStatus==='pending'&&!c.automaticAssessment),JSON.stringify(saved.clips));
  assert.deepEqual(saved.sources,before.sources);
  if(scenario==='pause'){assert.equal(saved.autoJobs[0].status,'paused');assert.equal(saved.autoJobs[0].nextRunAt,null);}
  noNewProviders(f);
});

// R12 P1 regression: these cases exercise genuine route writes while the
// actual scheduler awaits media/catalog callbacks. Public HTTP does not expose
// arbitrary clip ID/role/proof setters; those internal corruption cases belong
// to the helper tests, not a invented mutation route in this fixture.
function addOverlappingDraft(seed){
  const source=seed.sources[0];
  seed.clips.push({id:'other-role-overlap',sourceId:source.id,storedName:'clip0.mp4',
    name:'Unreviewed different-role overlap',role:'benefit',productCategory:source.productCategory,
    createdByIds:[OWNER.sub],visibility:'team',startSeconds:1,endSeconds:9,durationSeconds:8,
    contentSha256:hash('clip0'),reviewStatus:'pending',tags:[]});
}

for(const phase of ['during-cut','final-catalog','pending-technical'])
test(`actual cache materialization honors a newly requested review on an overlapping different-role clip: ${phase}`,async t=>{
  let triggered=false;
  const reject=async context=>{
    if(triggered)return;triggered=true;
    // Deliberately NOT a platform-quarantine keyword: the new materialization
    // guard must honor ordinary changes_requested across roles by itself.
    const response=await context.route('POST','/api/remix/clips/other-role-overlap/review',
      {reviewStatus:'changes_requested',reviewNote:'Need an additional content check'});
    assert.equal(response.status,200,JSON.stringify(response));
  };
  const f=await fixture(t,{mode:phase==='pending-technical'?'pending':'missing',
    seedMutation:addOverlappingDraft,
    duringCut:phase==='during-cut'?reject:undefined,
    duringCatalog:phase==='final-catalog'?async context=>{if(context.counters.cuts)await reject(context);}:undefined,
    duringInspect:phase==='pending-technical'?reject:undefined,
  }),before=await f.read(),saved=await f.resume();
  assert.equal(triggered,true);
  const overlap=saved.clips.find(c=>c.id==='other-role-overlap');
  assert.equal(overlap.reviewStatus,'changes_requested');assert.notEqual(overlap.deliveryBlocked,true);
  const exact=saved.clips.filter(c=>c.startSeconds===0&&c.endSeconds===10);
  if(phase==='pending-technical'){
    assert.equal(f.counters.cuts,0);assert.equal(exact.length,1);
    assert.equal(exact[0].id,'clip0');assert.equal(exact[0].reviewStatus,'pending');assert.equal(exact[0].automaticAssessment,undefined);
  }else{
    assert.equal(exact.length,0,'Rejected overlapping content cannot be rematerialized as another role/ID');
    assert.equal(f.counters.cuts,4,'Only the first now-stale cut is discarded; unrelated proven segments can still recover');
    assert.equal((await fs.readdir(path.join(f.root,'clips'))).length,7,'Only the unregistered stale UUID is cleaned');
  }
  assert.ok(saved.clips.filter(c=>c.startSeconds>=10).every(c=>c.reviewStatus==='approved'));
  assert.deepEqual(saved.sources,before.sources);
  assert.deepEqual(await privateReceiptSnapshot(f.root),f.privateBefore);noNewProviders(f);
});

test('actual pending metadata change during technical inspection is not overwritten by a stale automatic approval or a new alias',async t=>{
  let changedId=null;
  const f=await fixture(t,{mode:'pending',duringInspect:async(context,file)=>{
    if(changedId)return;
    const clip=(await context.read()).clips.find(c=>c.storedName===path.basename(file));assert.ok(clip);
    changedId=clip.id;
    const response=await context.route('PATCH',`/api/remix/clips/${clip.id}/metadata`,
      {name:'Owner changed this pending record',tags:['owner-current'],productCategory:'黑晶面膜'});
    assert.equal(response.status,200,JSON.stringify(response));
  }}),before=await f.read(),saved=await f.resume();
  assert.ok(changedId);assert.equal(f.counters.cuts,0);assert.equal(saved.clips.length,before.clips.length);
  const changed=saved.clips.find(c=>c.id===changedId);
  assert.equal(changed.name,'Owner changed this pending record');assert.deepEqual(changed.tags,['owner-current']);
  assert.equal(changed.reviewStatus,'pending');assert.equal(changed.automaticAssessment,undefined);
  assert.deepEqual(saved.clips.map(c=>[c.id,c.role,c.startSeconds,c.endSeconds,c.contentSha256]),before.clips.map(c=>[c.id,c.role,c.startSeconds,c.endSeconds,c.contentSha256]));
  assert.ok(saved.clips.filter(c=>c.id!==changedId).every(c=>c.reviewStatus==='approved'));
  assert.deepEqual(await privateReceiptSnapshot(f.root),f.privateBefore);noNewProviders(f);
});

test('actual complete fixed source with a changed live private catalog key and no progressive ledger does not enter paid preparation',async t=>{
  const f=await fixture(t,{seedMutation:async(seed,context)=>{
    assert.equal(Object.hasOwn(seed.autoJobs[0],'progressiveSourcePreparation'),false);
    context.catalogBindingKey=hash('new private registration not approved by the old complete attempt');
  }}),before=await f.read(),saved=await f.resume();
  assert.equal(f.counters.cuts,0);assert.equal(f.counters.clipInspections.length,0);
  assert.deepEqual(saved.sources,before.sources);assert.deepEqual(saved.clips,before.clips);
  assert.deepEqual(saved.autoJobs[0].runs[0].versionPreparationAttempts,before.autoJobs[0].runs[0].versionPreparationAttempts);
  assert.deepEqual(saved.autoJobs[0].runs[0].onDemandSourcePreparation.sourceIds,before.autoJobs[0].runs[0].onDemandSourcePreparation.sourceIds);
  assert.equal(saved.autoJobs[0].runs.length,1);
  assert.deepEqual(await privateReceiptSnapshot(f.root),f.privateBefore);noNewProviders(f);
});

test('actual settled source loses a private receipt during the duration probe and cannot commit the next source batch',async t=>{
  let deleted=false;
  const f=await fixture(t,{mode:'approved',extraSource:true,duringSourceInspect:async(context,file)=>{
    if(deleted||path.basename(file)!=='source.mp4')return;
    deleted=true;
    const saved=await context.read(),key=saved.sources[0].speechSegments[0].semanticReviewProof.requestKey;
    await fs.unlink(path.join(context.root,'source-semantic-reviews',key+'.json'));
  }}),before=await f.read(),saved=await f.resume();
  assert.equal(deleted,true,'Private proof loss is after the initial settled check at the genuine duration probe');
  assert.equal(f.counters.cuts,0);assert.equal(f.counters.clipInspections.length,0);
  assert.deepEqual(saved.clips,before.clips);assert.deepEqual(saved.sources,before.sources);
  assert.deepEqual(saved.autoJobs[0].runs[0].onDemandSourcePreparation.sourceIds,['legacy-source']);
  assert.ok(!saved.autoJobs[0].progressiveSourcePreparation?.sourceIds?.includes('unprepared-next-source'));
  assert.match(JSON.stringify(saved.autoJobs[0].runs[0]),/SOURCE_MATERIALIZATION_PENDING|换源登记前原批次私有回执/);
  noNewProviders(f);
});
