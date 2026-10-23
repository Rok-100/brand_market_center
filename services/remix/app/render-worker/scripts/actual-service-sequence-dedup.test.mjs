// Actual service + real private-evidence fixture; media/model callbacks are
// synthetic and isolated. No production, paid request, or business approval.
import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {createHash} from 'node:crypto';
import {createClipRemixService} from '../clip-remix-service.mjs';
import {SourceSemanticReview} from '../source-semantic-review.mjs';
import {ASR_FRAME_RULE,verifyAsrBundle,alignAsrCuesToFrames} from '../asr-frame-boundary.mjs';
import {LEGACY_MODE,hasLegacyClipPointer} from '../legacy-source-evidence.mjs';
const hash=x=>createHash('sha256').update(x).digest('hex');
const canonical=x=>Array.isArray(x)?x.map(canonical):x&&typeof x==='object'
 ?Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])):x;
const digest=x=>hash(JSON.stringify(canonical(x))),OWNER={sub:'FI-000001',name:'Isolated legacy owner'};
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(fn,label){for(let i=0;i<400;i++){const value=await fn();if(value)return value;await sleep(20);}throw Error('Timeout: '+label);}
// Reuse the existing full-service fixture verbatim except two explicitly
// synthetic callback controls. Production service implementation is not patched.
const text=await fs.readFile(new URL('./actual-service-legacy-source.test.mjs',import.meta.url),'utf8');
let fixtureCode=text.slice(text.indexOf('async function fixture('),text.indexOf("\ntest('actual legacy service:"));
const originalAnswer="answer={decision:'pass',confidence:.99,summary:'Synthetic output test only',issues:[]};";
assert.equal(fixtureCode.split(originalAnswer).length,2);
fixtureCode=fixtureCode.replace(originalAnswer,"answer=context.outputAnswer||{decision:'pass',confidence:.99,summary:'Synthetic output test only',issues:[]};");
const originalRender="counters.renders++;await fs.writeFile(args.at(-1)";
assert.equal(fixtureCode.split(originalRender).length,2);
fixtureCode=fixtureCode.replace(originalRender,"counters.renders++;if(context.beforeRender)await context.beforeRender();await fs.writeFile(args.at(-1)");
const fixture=new Function('test','assert','fs','os','path','createClipRemixService','SourceSemanticReview','ASR_FRAME_RULE',
 'verifyAsrBundle','alignAsrCuesToFrames','LEGACY_MODE','hasLegacyClipPointer','hash','canonical','digest','OWNER','sleep','until',
 fixtureCode+';return fixture;')(test,assert,fs,os,path,createClipRemixService,SourceSemanticReview,ASR_FRAME_RULE,
 verifyAsrBundle,alignAsrCuesToFrames,LEGACY_MODE,hasLegacyClipPointer,hash,canonical,digest,OWNER,sleep,until);
const waitSettled=f=>until(async()=>{const saved=await f.read();return !f.runtimeState().activeAutoJobCount&&saved.autoJobs[0].runs[0].sequencePreflight&&saved;},'sequence hold');

test('actual service second run pre-excludes both prior sequences before FFmpeg or paid review, preserving approvals',async t=>{
 const f=await fixture(t),first=await f.start();
 assert.equal(f.counters.renders,2);assert.equal(f.counters.outputReviews,2);
 assert.equal(first.autoJobs[0].sequenceReservations.length,2);
 assert.ok(first.autoJobs[0].sequenceReservations.every(row=>row.status==='recorded'));
 const originalRenders=structuredClone(first.renders);
 const reset=await f.route('PATCH','/api/remix/automation/jobs/job',{sequenceReservations:[],contentSequenceIdentity:null});
 assert.equal(reset.status,200);assert.equal((await f.read()).autoJobs[0].sequenceReservations.length,2,'Request payload cannot clear server-owned history');
 const response=await f.route('POST','/api/remix/automation/jobs/job/run-now',{sequenceReservations:[],contentSequenceIdentity:null});assert.equal(response.status,200);
 const second=await waitSettled(f);
 assert.equal(second.autoJobs[0].runs.length,2);assert.equal(second.autoJobs[0].runs[0].sequencePreflight.reason,'OUTPUT_SEQUENCE_EXHAUSTED');
 assert.equal(second.autoJobs[0].runs[0].automaticReviewHold.kind,'sequence_capacity');
 assert.equal(second.autoJobs[0].nextRunAt,null);assert.equal(second.autoJobs[0].sequenceReservations.length,2);
 assert.equal(f.counters.renders,2);assert.equal(f.counters.outputReviews,2);
 assert.deepEqual(second.renders,originalRenders,'Old approvals are not migrated, replaced or redated');
});
test('actual service definite rejected content stays consumed across runs, not sent for another approval',async t=>{
 const f=await fixture(t);f.outputAnswer={decision:'review_required',confidence:.99,summary:'Synthetic definite quality defect',
  issues:[{kind:'visible_defect',at:1,description:'Synthetic test issue'}]};
 const first=await f.start();assert.ok(first.renders.length);assert.equal(f.counters.outputReviews,2);
 assert.ok(first.renders.flatMap(render=>render.variants).every(v=>v.reviewStatus==='changes_requested'));
 // The normal first run is awaiting sources after both different openers were
 // consumed. Restoring it must still not recreate either failed sequence.
 const original=structuredClone(first.renders),calls=f.counters.outputReviews,renders=f.counters.renders;
 const response=await f.route('POST','/api/remix/automation/jobs/job/run-now');assert.equal(response.status,200);
 await until(()=>!f.runtimeState().activeAutoJobCount,'retry settled');
 assert.equal(f.counters.renders,renders);assert.equal(f.counters.outputReviews,calls);
 const after=(await f.read()).renders;
 // The existing reconciler changes only the explanatory rejection note on a
 // retry. Verify every other field, including verdict, receipt, date and bytes.
 const withoutNote=renders=>renders.map(render=>({...render,variants:render.variants.map(({reviewNote,...variant})=>variant)}));
 assert.deepEqual(withoutNote(after),withoutNote(original));
 assert.ok(after.flatMap(render=>render.variants).every(variant=>variant.reviewStatus==='changes_requested'));
});
test('actual service interruption after durable reservation cannot be escaped by another run or reset to a new render',async t=>{
 const f=await fixture(t);f.beforeRender=()=>{throw Error('Synthetic process interruption after reservation');};
 const first=await f.start();assert.equal(f.counters.renders,1);assert.equal(f.counters.outputReviews,0);
 assert.equal(first.renders.length,0);assert.equal(first.autoJobs[0].sequenceReservations[0].status,'reserved');
 delete f.beforeRender;
 const mode=await f.route('PATCH','/api/remix/automation/jobs/job',{autoApproveOutputs:false,sequenceReservations:[]});
 assert.equal(mode.status,200);assert.equal((await f.read()).autoJobs[0].autoApproveOutputs,false);
 const response=await f.route('POST','/api/remix/automation/jobs/job/run-now');assert.equal(response.status,200);
 const second=await waitSettled(f);
 assert.equal(second.autoJobs[0].runs[0].sequencePreflight.reason,'OUTPUT_SEQUENCE_PENDING');
 assert.equal(second.autoJobs[0].sequenceReservations.length,1);
 assert.equal(second.autoJobs[0].sequenceReservations[0].status,'reserved');
 assert.equal(f.counters.renders,1);assert.equal(f.counters.outputReviews,0);assert.equal(second.renders.length,0);
});
