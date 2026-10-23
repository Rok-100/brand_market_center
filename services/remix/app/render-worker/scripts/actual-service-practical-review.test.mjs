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
const JOB='a5fdb74d-a2a1-4cf0-affe-d9bbfaf30354',OWNER={sub:'FI-000001',name:'Isolated legacy owner'};
const hash=x=>createHash('sha256').update(x).digest('hex');
const canonical=x=>Array.isArray(x)?x.map(canonical):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])):x;
const digest=x=>hash(JSON.stringify(canonical(x))),sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(fn,label){for(let i=0;i<700;i++){const value=await fn();if(value)return value;await sleep(20);}throw Error('Timeout: '+label);}
async function privateReceiptSnapshot(root){
  const directory=path.join(root,'source-semantic-reviews'),rows=[];
  async function visit(current){for(const e of await fs.readdir(current,{withFileTypes:true})){
    const file=path.join(current,e.name);if(e.isDirectory())await visit(file);else rows.push([path.relative(directory,file),hash(await fs.readFile(file))]);
  }}await visit(directory);return rows.sort((a,b)=>a[0].localeCompare(b[0]));
}
const extension=JSON.parse(await fs.readFile(new URL('../source-review-quota-extension.json',import.meta.url),'utf8'));
const fixtureURL=new URL('./actual-service-legacy-source.test.mjs',import.meta.url);
const existing=await fs.readFile(new URL('./actual-service-cache-materialization.test.mjs',import.meta.url),'utf8');
const start=existing.indexOf('// Reuse the existing real-receipt fixture'),end=existing.indexOf('\nfunction noNewProviders',start);
assert.ok(start>=0&&end>start);
async function fixture(t,{grant=true,practicalProof=false,...options}={}){
  let code=existing.slice(start,end);
  const originalRead="const fixtureText=await fs.readFile(new URL('./actual-service-legacy-source.test.mjs',import.meta.url),'utf8');";
  assert.equal(code.split(originalRead).length,2);
  code=code.replace(originalRead,"let fixtureText=await fs.readFile(fixtureURL,'utf8');\nfixtureText=fixtureText.replace(\"'打开包装，取出面膜。'\",\"'面膜可以帮助淡纹修护。'\");");
  if(practicalProof)code=code.replace("const fixtureStart=",`fixtureText=fixtureText.replace('env,runProcess,fetchImpl:fakeFetch});','env,runProcess,fetchImpl:fakeFetch,practicalReviewJobIds:[JOB]});').replace("reviewer.assess({runId:'synthetic-source-review',","reviewer.assess({trustedJobId:JOB,runId:'synthetic-source-review',");\nconst fixtureStart=`);
  const marker='async function fixture(t,';assert.equal(code.split(marker).length,2);
  code=code.replace(marker,`fixtureBody=fixtureBody.replace('sourceVersionResolver,progressiveSourcePreparationJobIds:[JOB],','sourceVersionResolver,sourceReviewQuotaExtension:${JSON.stringify(grant?extension:null)},progressiveSourcePreparationJobIds:[JOB],');\n${marker}`);
  const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
  const factory=await new AsyncFunction('test','assert','fs','os','path','createHash','createClipRemixService','SourceSemanticReview',
    'ASR_FRAME_RULE','verifyAsrBundle','alignAsrCuesToFrames','LEGACY_MODE','hasLegacyClipPointer','hash','canonical','digest',
    'OWNER','sleep','until','JOB','privateReceiptSnapshot','fixtureURL',code+';return fixture;')(
      test,assert,fs,os,path,createHash,createClipRemixService,SourceSemanticReview,ASR_FRAME_RULE,verifyAsrBundle,
      alignAsrCuesToFrames,LEGACY_MODE,hasLegacyClipPointer,hash,canonical,digest,OWNER,sleep,until,JOB,privateReceiptSnapshot,fixtureURL);
  return factory(t,{mode:'pending',...options});
}
function noProviders(f){assert.equal(f.counters.sourceAssessCalls,0);assert.equal(f.counters.asrCalls,0);assert.equal(f.counters.outputReviews,0);assert.equal(f.counters.renders,0);assert.equal(f.counters.cuts,0);}

for(const grant of [false,true])test(`actual clip technical review only avoids duplicate generic efficacy veto with server pilot grant=${grant}`,async t=>{
  const f=await fixture(t,{grant}),before=await f.read(),saved=await f.resume();
  const clip=saved.clips.find(row=>row.id==='clip0');
  assert.equal(clip.reviewStatus,grant?'approved':'changes_requested',JSON.stringify(clip.automaticAssessment));
  const check=clip.automaticAssessment.checks.find(row=>row.name==='商业表述');assert.equal(check.passed,grant);
  assert.equal(clip.semanticReviewProof.reviewResult.checks.commercialSupported,true);
  assert.deepEqual(saved.sources,before.sources);assert.deepEqual(await privateReceiptSnapshot(f.root),f.privateBefore);noProviders(f);
});

for(const failure of ['pause','private-revocation','source-bytes'])
test(`actual pilot commercial pass cannot survive a changed current gate during technical inspection: ${failure}`,async t=>{
  let changed=false;
  const f=await fixture(t,{duringInspect:async(context)=>{
    if(changed)return;changed=true;
    if(failure==='pause')await context.route('POST',`/api/remix/automation/jobs/${JOB}/pause`);
    if(failure==='private-revocation')context.revoke();
    if(failure==='source-bytes')await fs.writeFile(path.join(context.root,'sources','source.mp4'),'changed synthetic source');
  }}),saved=await f.resume();
  assert.equal(changed,true);assert.ok(saved.clips.every(row=>row.reviewStatus==='pending'&&!row.automaticAssessment));
  if(failure==='pause'){assert.equal(saved.autoJobs[0].status,'paused');assert.equal(saved.autoJobs[0].nextRunAt,null);}
  noProviders(f);
});

test('actual pilot cannot treat a public commercialSupported flag as fresh private proof',async t=>{
  const f=await fixture(t,{seedMutation:seed=>{
    seed.sources[0].speechSegments[0].semanticReviewProof.responseSha256=hash('forged-positive-flag');
  }}),before=await f.read(),saved=await f.resume();
  assert.deepEqual(saved.clips,before.clips);assert.equal(f.counters.clipInspections.length,0);noProviders(f);
});

test('actual cached materialization forwards the exact job for fresh typed policy proof without ASR or model replay',async t=>{
  const f=await fixture(t,{practicalProof:true}),before=await f.read();
  assert.equal(before.sources[0].speechSegments[0].semanticReviewProof.reviewPolicy.jobId,JOB);
  const saved=await f.resume();assert.ok(saved.clips.every(clip=>clip.reviewStatus==='approved'),JSON.stringify(saved.autoJobs[0].runs));
  assert.deepEqual(saved.sources,before.sources);assert.deepEqual(await privateReceiptSnapshot(f.root),f.privateBefore);noProviders(f);
});
