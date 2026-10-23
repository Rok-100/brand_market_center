// Real service routes, planner, source-proof verifier, paid-receipt persistence
// and scheduler. All media/model responses are isolated synthetic fixtures; no
// external provider, production approval, upload or advertising is performed.
import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {createHash} from 'node:crypto';
import {createClipRemixService} from '../clip-remix-service.mjs';
import {SourceSemanticReview} from '../source-semantic-review.mjs';
import {ASR_FRAME_RULE,verifyAsrBundle,alignAsrCuesToFrames} from '../asr-frame-boundary.mjs';
import {LEGACY_MODE,hasLegacyClipPointer} from '../legacy-source-evidence.mjs';
const hash=x=>createHash('sha256').update(x).digest('hex');
const canonical=x=>Array.isArray(x)?x.map(canonical):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])):x;
const digest=x=>hash(JSON.stringify(canonical(x))),OWNER={sub:'FI-000001',name:'Isolated legacy owner'};
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(fn,label){for(let i=0;i<1200;i++){const result=await fn();if(result)return result;await sleep(20);}throw Error('Timeout: '+label);}
const JOB='a5fdb74d-a2a1-4cf0-affe-d9bbfaf30354';
const POLICY={schema:'wis-source-review-quota-v1',authorizationId:'isolated-integration-only',jobId:JOB,
  baseLimit:64,additionalLimit:200,totalLimit:264,legacyRunIds:['22222222-2222-2222-2222-222222222222'],legacyReservationCount:54};
const source=await fs.readFile(new URL('./actual-service-legacy-source.test.mjs',import.meta.url),'utf8');
let code=source.slice(source.indexOf('async function fixture('),source.indexOf("\ntest('actual legacy service:"));
function replace(before,after){assert.equal(code.split(before).length,2,`fixture anchor: ${before}`);code=code.replace(before,after);}
replace("const texts=['打开包装，取出面膜。','看这张面膜，贴合面部。','观察膜布贴合的状态。','打开商品页面了解详情。','限时买一送一到手价九十九元钱。'];",
  "const texts=Array.from({length:19},(_,i)=>i===18?'限时买一送一到手价九十九元钱。':i===17?'打开商品页面了解详情。':`打开包装，取出面膜第${i+1}段。`);");
replace('stamp(i*10)} --> ${stamp(i*10+10)','stamp(i*2)} --> ${stamp(i*2+2)');
replace("reviewed.results.filter(r=>r.status==='passed').length,4,","reviewed.results.filter(r=>r.status==='passed').length,18,");
replace("const clips=['hook','hook','solution','cta'].map", "const clips=[...Array(4).fill('hook'),...Array(13).fill('solution'),'cta'].map");
replace("slotSelections:{hook:['clip0','clip1'],solution:['clip2'],cta:['clip3']}",
  "slotSelections:{hook:['clip0','clip1','clip2','clip3'],solution:Array.from({length:13},(_,i)=>'clip'+(i+4)),cta:['clip17']}");
replace("answer={decision:'pass',confidence:.99,summary:'Synthetic output test only',issues:[]};",
  "if(counters.outputReviews>=unknownAt)throw Error('synthetic_unknown_outcome'); answer={reviewKey:request.reviewKey,sha256:request.sha256,contextSha256:request.contextSha256,partIndex:request.partIndex,partCount:request.partCount,coverage:request.coverage,decision:'review_required',confidence:.99,summary:'Synthetic definite subtitle issue',issues:[{kind:'subtitle_typo',at:request.coverage[0].at,description:'Synthetic specific response, not approval'}]};");
replace("sourceVersionResolver,\n    sourceSemanticReviewer:",
  "sourceVersionResolver,sourceReviewQuotaPolicy:grant?POLICY:null,progressiveSourcePreparationJobIds:grant?[JOB]:[],\n    sourceSemanticReviewer:");
replace('if(cachedCtaRecovery){sourceVersionResolver.candidateSourceIds','if(true){sourceVersionResolver.candidateSourceIds');
replace('targetCount:2,targetDurationSeconds:30','targetCount:1,targetDurationSeconds:30');
replace('dailyTarget:2,targetDurationSeconds:30','dailyTarget:1,targetDurationSeconds:30');
// Only fixture identities/routes change. The actual service implementation is
// imported intact, not replaced or evaluated from rewritten production source.
code=code.replaceAll("jobs/job/",`jobs/${JOB}/`).replace("id:'job',name:",`id:'${JOB}',name:`);
function makeFixture({grant=true,unknownAt=4}={}){
  return new Function('test','assert','fs','os','path','createClipRemixService','SourceSemanticReview','ASR_FRAME_RULE',
    'verifyAsrBundle','alignAsrCuesToFrames','LEGACY_MODE','hasLegacyClipPointer','hash','canonical','digest','OWNER','sleep','until','POLICY','JOB','grant','unknownAt',
    code+';return fixture;')(test,assert,fs,os,path,createClipRemixService,SourceSemanticReview,ASR_FRAME_RULE,
      verifyAsrBundle,alignAsrCuesToFrames,LEGACY_MODE,hasLegacyClipPointer,hash,canonical,digest,OWNER,sleep,until,POLICY,JOB,grant,unknownAt);
}

test('actual first two rejected outputs then third definite private receipt continue to fourth, where unknown still holds',async t=>{
  const f=await makeFixture()(t),saved=await f.start(),job=saved.autoJobs[0],run=job.runs[0];
  assert.equal(f.counters.renders,4,JSON.stringify(run));assert.equal(f.counters.outputReviews,4);
  assert.equal(run.consecutiveReviewFailures,4);assert.equal(run.boundedReplacementDecisions.length,1);
  assert.equal(run.boundedReplacementDecisions[0].consecutive,3);
  assert.equal(run.boundedReplacementDecisions[0].runAttemptLimit,4,'This isolated target-one run keeps its original x4 cap');
  assert.equal(run.boundedReplacementDecisions[0].jobAttemptLimit,80);
  assert.equal(run.boundedReplacementDecisions[0].approvalGranted,false);assert.equal(run.boundedReplacementDecisions[0].countersReset,false);
  assert.equal(run.automaticReviewHold.kind,'dependency');assert.equal(job.nextRunAt,null);
  const variants=saved.renders.flatMap(r=>r.variants);assert.equal(variants.length,4);
  assert.ok(variants.every(v=>v.reviewStatus==='changes_requested'&&!v.automaticAssessment.autoApproved));
  assert.ok(saved.renders.every(r=>r.sourceEvidencePolicy==='wis-private-source-evidence-v1'));
  assert.ok(variants.every(v=>!Object.hasOwn(v,'sourceEvidencePolicy')),'Actual producer owns render marker only');
  assert.equal(f.counters.createReturn,0);assert.equal(f.counters.upload,0);
  const before=f.counters.outputReviews;await f.route('POST',`/api/remix/automation/jobs/${JOB}/run-now`);
  await until(()=>!f.runtimeState().activeAutoJobCount,'unknown retry settled');assert.equal(f.counters.outputReviews,before);
});

test('actual third unknown response never receives finite-definite exception',async t=>{
  const f=await makeFixture({unknownAt:3})(t),saved=await f.start(),run=saved.autoJobs[0].runs[0];
  assert.equal(f.counters.renders,3,JSON.stringify(run));assert.equal(f.counters.outputReviews,3);
  assert.equal(run.consecutiveReviewFailures,3);assert.equal(run.boundedReplacementDecisions,undefined);
  assert.equal(run.automaticReviewHold.kind,'dependency');assert.equal(f.counters.createReturn,0);
});

test('actual job without private grant keeps existing three-definite-failures hold',async t=>{
  const f=await makeFixture({grant:false,unknownAt:99})(t),saved=await f.start(),run=saved.autoJobs[0].runs[0];
  assert.equal(f.counters.renders,3,JSON.stringify(run));assert.equal(f.counters.outputReviews,3);
  assert.equal(run.consecutiveReviewFailures,3);assert.equal(run.boundedReplacementDecisions,undefined);
  assert.equal(run.automaticReviewHold.kind,'dependency');assert.equal(f.counters.createReturn,0);
});
