// Real service routes/private receipts; every byte and response is synthetic.
// No actual media approval, advertising, external HTTP, or model invocation.
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
import {PRACTICAL_REVIEW_JOB_ID as JOB} from '../source-practical-review-policy.mjs';
const hash=x=>createHash('sha256').update(x).digest('hex');
const canonical=x=>Array.isArray(x)?x.map(canonical):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])):x;
const digest=x=>hash(JSON.stringify(canonical(x))),sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const OWNER={sub:'FI-000001',name:'Isolated legacy owner'};
async function until(fn,label){for(let i=0;i<700;i++){const x=await fn();if(x)return x;await sleep(20);}throw Error('Timeout '+label);}
const original=await fs.readFile(new URL('./actual-service-legacy-source.test.mjs',import.meta.url),'utf8');
const start=original.indexOf('async function fixture('),end=original.indexOf("\ntest('actual legacy service:",start);
assert.ok(start>=0&&end>start);
async function fixture(t,{consumer=JOB,practical=true,additionalJobs=[]}={}){
 let serviceOptions;
 const createService=options=>{serviceOptions=options;return createClipRemixService(options);};
 let code=original.slice(start,end);
 const replace=(from,to)=>{assert.equal(code.split(from).length,2,'fixture anchor '+from);code=code.replace(from,to);};
 code=code.replaceAll('/automation/jobs/job/','/automation/jobs/'+consumer+'/');
 replace("const job={id:'job'",`const job={id:${JSON.stringify(consumer)}`);
 replace('env,runProcess,fetchImpl:fakeFetch});',`env,runProcess,fetchImpl:fakeFetch,practicalReviewJobIds:${JSON.stringify(practical?[JOB]:[])}});`);
 replace("reviewer.assess({runId:'synthetic-source-review',",`reviewer.assess({trustedJobId:${JSON.stringify(JOB)},runId:'synthetic-source-review',`);
 if(additionalJobs.length)replace('  await service.initialize();',`  const additionalSeed=JSON.parse(await fs.readFile(libraryPath,'utf8'));for(const id of ${JSON.stringify(additionalJobs)})additionalSeed.autoJobs.push({...structuredClone(additionalSeed.autoJobs[0]),id});await fs.writeFile(libraryPath,JSON.stringify(additionalSeed));\n  await service.initialize();`);
 const factory=new Function('test','assert','fs','os','path','createHash','createClipRemixService','SourceSemanticReview',
  'ASR_FRAME_RULE','verifyAsrBundle','alignAsrCuesToFrames','LEGACY_MODE','hasLegacyClipPointer','hash','canonical','digest','OWNER','sleep','until',
  code+';return fixture;')(test,assert,fs,os,path,createHash,createService,SourceSemanticReview,
   ASR_FRAME_RULE,verifyAsrBundle,alignAsrCuesToFrames,LEGACY_MODE,hasLegacyClipPointer,hash,canonical,digest,OWNER,sleep,until);
 const f=await factory(t);f.consumer=consumer;
 f.readFreshService=()=>{
  // The real writer owns an in-memory library cache. A restart, not an external
  // disk edit pretending to invalidate that cache, establishes this readback.
  const restarted=createClipRemixService(serviceOptions);
  f.route=async(method,url,body={})=>{const response={};await restarted.route({method,headers:{},body},response,new URL('http://localhost'+url),OWNER);return response;};
 };
 return f;
}
test('actual exact job renders and returns with its current practical private proof',async t=>{
 const f=await fixture(t),before=await f.read();assert.equal(before.clips[0].semanticReviewProof.reviewPolicy.jobId,JOB);
 const saved=await f.start();assert.equal(f.counters.renders,2,JSON.stringify(saved.autoJobs[0].runs));
 assert.ok(saved.renders[0].variants.every(v=>v.reviewStatus==='approved'),JSON.stringify(saved.renders));
 const result=await f.returnFirst();assert.equal(result.status,200,JSON.stringify(result));assert.equal(f.counters.completeReturn,1);
});
test('actual different job cannot select already-approved practical clips or generate with their old public badge',async t=>{
 const f=await fixture(t,{consumer:'other-job'}),before=await f.read(),saved=await f.start();
 assert.equal(f.counters.renders,0);assert.equal(f.counters.outputReviews,0);assert.equal(f.counters.createReturn,0);
 assert.deepEqual(saved.clips,before.clips);assert.deepEqual(saved.sources,before.sources);
 const publicState=await f.route('GET','/api/remix/library');assert.equal(publicState.status,200);
});
test('actual manual clip and render routes cannot borrow exact-job practical proof or spoof its HTTP jobId',async t=>{
 const f=await fixture(t),before=await f.read();
 const cut=await f.cut({trustedJobId:JOB,jobId:JOB});assert.notEqual(cut.status,201);assert.equal(f.counters.cuts,0);
 const result=await f.route('POST','/api/remix/renders',{frameworkId:'framework',productCategory:'黑晶面膜',count:1,
  slotSelections:{hook:['clip0'],solution:['clip2'],cta:['clip3']},trustedJobId:JOB,automation:{jobId:JOB,runId:'run'}});
 assert.notEqual(result.status,201);assert.equal(f.counters.renders,0);assert.equal(f.counters.outputReviews,0);
 assert.deepEqual((await f.read()).clips,before.clips);
});
test('actual effect reads the current render job rather than a private proof job or caller payload',async t=>{
 const f=await fixture(t),saved=await f.start();assert.equal(f.counters.renders,2);
 // Represent a different server-owned job using the same approved public
 // source/clip rows; do not rewrite any proof, receipt or generation binding.
 const library=await f.read();library.autoJobs[0].id='other-job';
 for(const render of library.renders)render.automation.jobId='other-job';
 await fs.writeFile(path.join(f.root,'library.json'),JSON.stringify(library));
 f.readFreshService();
 const result=await f.returnFirst();assert.notEqual(result.status,200);assert.equal(f.counters.createReturn,0);
 assert.equal(f.counters.completeReturn,0);assert.deepEqual((await f.read()).sources,saved.sources);
});
test('actual historical untyped proof retains its original shared reuse in a different job',async t=>{
 const f=await fixture(t,{consumer:'other-job',practical:false}),saved=await f.start();
 assert.equal(f.counters.renders,2,JSON.stringify(saved.autoJobs[0].runs));
 assert.ok(saved.renders[0].variants.every(v=>v.reviewStatus==='approved'));
 assert.equal((await f.returnFirst()).status,200);assert.equal(f.counters.completeReturn,1);
});

test('actual library response isolates pilot inventory from two ordinary jobs even when the pilot quota loader is absent',async t=>{
 const f=await fixture(t,{consumer:'ordinary-one',additionalJobs:['ordinary-two',JOB]}),result=await f.route('GET','/api/remix/library');
 assert.equal(result.status,200);const jobs=result.body.automation.jobs;
 assert.equal(jobs.find(job=>job.id==='ordinary-one').readiness.approvedClipCount,0);
 assert.equal(jobs.find(job=>job.id==='ordinary-two').readiness.approvedClipCount,0);
 assert.ok(jobs.find(job=>job.id===JOB).readiness.approvedClipCount>0);
 assert.equal(f.counters.renders,0);assert.equal(f.counters.outputReviews,0);assert.equal(f.counters.createReturn,0);
});
