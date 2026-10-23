// Real service + real private ASR terminal verifier. All media/model bytes are
// synthetic; original process/failure/receipt templates retain the actual zero
// recognition record shape. No recognition process, provider, or ad IO occurs.
import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {createHash} from 'node:crypto';import {createClipRemixService} from '../clip-remix-service.mjs';
import {seedInsufficientAsr} from '../../worker-tests/helpers/local-asr-insufficient-fixture.mjs';
const sha=v=>createHash('sha256').update(v).digest('hex'),sleep=ms=>new Promise(r=>setTimeout(r,ms));
const IDS=Array.from({length:5},(_,i)=>'00000000-0000-4000-8000-00000000000'+i),OWNER={sub:'FI-000001',name:'Synthetic on-demand owner'};
async function until(fn,label){for(let i=0;i<500;i++){const result=await fn();if(result)return result;await sleep(20);}throw Error('Timeout '+label);}
const text=await fs.readFile(new URL('./actual-service-on-demand-source.test.mjs',import.meta.url),'utf8');
let body=text.slice(text.indexOf('async function fixture('),text.indexOf("\ntest('actual normal job:"));
body=body.replace("id='source-'+index","id=IDS[index]");
body=body.replace('  service=createClipRemixService(',`  const terminal=await seedInsufficientAsr(path.join(dataDir,'private-asr'),{sourcePath:path.join(root,'sources',IDS[3]+'.mp4'),sourceId:IDS[3],revisionSha256:sha(IDS[3])});
  await mutatePrivate(terminal);
  calls.terminal=0;
  service=createClipRemixService(`);
body=body.replace('sourceVersionResolver:resolver,',"sourceVersionResolver:resolver,progressiveSourcePreparationJobIds:['old-idle'],");
body=body.replace('localAsrRunner:{ensureSourceEvidence:async input=>{',`localAsrRunner:{verifyTerminalInsufficientRecognition:async input=>{calls.terminal++;const result=await terminal.runner.verifyTerminalInsufficientRecognition(input);await afterVerify(input,result);return result;},ensureSourceEvidence:async input=>{
      if(input.sourceId===IDS[3])return terminal.runner.ensureSourceEvidence(input);`);
body=body.replace('  await service.initialize();',`  const seed=JSON.parse(await fs.readFile(libraryFile,'utf8'));seedOriginal(seed);seedExtra(seed);await fs.writeFile(libraryFile,JSON.stringify(seed));created.push('old-idle');await service.initialize();`);
body=body.replace('return {calls,read,route,create,start,','return {terminal,libraryFile,calls,read,route,create,start,');
function seedOriginal(seed){const job=seed.autoJobs.find(j=>j.id==='old-idle'),ids=[IDS[4],IDS[3],IDS[2]];
 job.runs=[{id:'original-run',status:'awaiting_sources',targetCount:2,targetDurationSeconds:90,renderIds:[],selectedSourceIds:ids,
  selectedAssetIds:[],createdClipIds:[],stageReports:[],slotSelections:{},consecutiveReviewFailures:2,
  onDemandSourcePreparation:{mode:'bounded-on-demand-v1',limit:3,sourceIds:ids},versionPreparationAttempts:Object.fromEntries(ids.map(id=>[id,
   {key:sha(id),complete:id!==IDS[3],attemptedAt:'2026-10-03T00:00:00Z',attempts:1,reason:id===IDS[3]?'SOURCE_ASR_UNAVAILABLE':null}]))}];
 for(const source of seed.sources.filter(s=>ids.includes(s.id)&&s.id!==IDS[3]))source.sourceSemanticReview={recoverable:false,pendingReasons:['content_attention'],passedCount:0};
}
const makeFixture=({mutatePrivate=async()=>{},afterVerify=async()=>{},seedExtra=()=>{}}={})=>new Function('test','assert','fs','os','path','createClipRemixService','sha','sleep','OWNER','until','IDS','seedInsufficientAsr','seedOriginal','mutatePrivate','afterVerify','seedExtra',body+';return fixture;')
 (test,assert,fs,os,path,createClipRemixService,sha,sleep,OWNER,until,IDS,seedInsufficientAsr,seedOriginal,mutatePrivate,afterVerify,seedExtra);

test('real service first readback of old generic zero-segment failure advances bounded batch without approval or ASR repeat',async t=>{
 const f=await makeFixture()(t),failure=await fs.readFile(path.join(f.terminal.directory,'failure.json'));
 const job=await f.start('old-idle'),run=job.runs[0];
 assert.deepEqual(run.onDemandSourcePreparation.sourceIds,[IDS[0]]);assert.equal(job.progressiveSourcePreparation.sourceIds.length,4);
 assert.equal(run.id,'original-run');assert.equal(run.consecutiveReviewFailures,2);assert.equal(run.versionPreparationAttempts[IDS[3]].complete,false);
 assert.equal(run.versionPreparationAttempts[IDS[3]].reason,'SOURCE_ASR_UNAVAILABLE');assert.equal(run.versionPreparationAttempts[IDS[3]].attempts,1);
 assert.ok(f.calls.terminal>=2);assert.deepEqual(f.calls.asr,[IDS[0]]);assert.equal(f.terminal.calls(),0);assert.equal(f.calls.models,0);assert.equal(f.calls.cloud,0);
 assert.deepEqual(await fs.readFile(path.join(f.terminal.directory,'failure.json')),failure);
 const state=await f.read();assert.equal(state.sources.find(s=>s.id===IDS[3]).sourceSemanticReview,undefined);assert.equal(state.clips.length,0);assert.equal(state.renders.length,0);
 assert.equal(state.autoJobs.find(j=>j.id==='old-paused').status,'paused');
});
for(const[name,mutate]of [
 ['uncertain process',f=>f.rewrite('process.json',v=>v.closed=false)],
 ['retained failure uncertain',f=>f.rewrite('failure.json',v=>v.status='uncertain')],
 ['missing private producer receipt',f=>fs.unlink(path.join(f.output,'receipt.json'))],
 ['changed original audio bytes',f=>fs.appendFile(path.join(f.output,'audio.wav'),'changed')],
 ['nonzero words',f=>f.rewrite('producer-output/receipt.json',v=>v.recognition.wordCount=1)],
])test('real service cannot rotate on '+name,async t=>{
 const f=await makeFixture({mutatePrivate:mutate})(t),job=await f.start('old-idle');
 assert.deepEqual(job.runs[0].onDemandSourcePreparation.sourceIds,[IDS[4],IDS[3],IDS[2]]);assert.equal(job.progressiveSourcePreparation.sourceIds.length,3);
 assert.equal(job.runs[0].progressiveSourceStatus.action,'pending');assert.equal(f.terminal.calls(),0);assert.ok(!f.calls.asr.includes(IDS[0]));assert.equal(f.calls.models,0);
 assert.equal((await f.read()).renders.length,0);
});
test('real service revalidates before commit; changed receipt after first private verification does not buy new sources',async t=>{
 let count=0;const f=await makeFixture({afterVerify:async(input,result)=>{if(result.verified&&++count===1){
  const file=path.join(f.terminal.output,'receipt.json');const receipt=JSON.parse(await fs.readFile(file));receipt.reason='changed';await fs.writeFile(file,JSON.stringify(receipt));}}})(t);
 const job=await f.start('old-idle');assert.equal(job.runs[0].automaticReviewHold.reason,'PROGRESSIVE_SOURCE_CHANGED');
 assert.equal(job.progressiveSourcePreparation,undefined);assert.equal(f.calls.asr.length,0);assert.equal(f.calls.models,0);assert.equal(f.terminal.calls(),0);
});
test('real service pause after terminal readback wins, nextRunAt stays null and original ledger unchanged',async t=>{
 let stopped=false;const f=await makeFixture({afterVerify:async()=>{if(!stopped){stopped=true;await f.route('POST','/api/remix/automation/jobs/old-idle/pause');}}})(t);
 assert.equal((await f.route('POST','/api/remix/automation/jobs/old-idle/run-now')).status,200);
 await until(()=>stopped&&!f.service.runtimeState().activeAutoJobCount,'pause settled');
 const job=(await f.read()).autoJobs.find(j=>j.id==='old-idle');assert.equal(job.status,'paused');assert.equal(job.nextRunAt,null);
 assert.equal(job.progressiveSourcePreparation,undefined);assert.deepEqual(job.runs[0].onDemandSourcePreparation.sourceIds,[IDS[4],IDS[3],IDS[2]]);
 assert.equal(f.calls.asr.length,0);assert.equal(f.calls.models,0);assert.equal(f.terminal.calls(),0);
});
test('real service private withdrawal is never reinterpreted as technical failure',async t=>{
 const f=await makeFixture()(t,{revoked:true}),job=await f.start('old-idle');assert.equal(job.runs[0].automaticReviewHold.reason,'PROGRESSIVE_SOURCE_CHANGED');
 assert.equal(job.progressiveSourcePreparation,undefined);assert.equal(f.calls.terminal,0);assert.equal(f.calls.asr.length,0);assert.equal(f.calls.models,0);
});
test('real service public terminal badge cannot replace uncertain private evidence',async t=>{
 const f=await makeFixture({mutatePrivate:f=>f.rewrite('process.json',v=>v.closed=false),seedExtra:seed=>{
  const attempt=seed.autoJobs.find(j=>j.id==='old-idle').runs[0].versionPreparationAttempts[IDS[3]];
  attempt.complete=true;attempt.technicalDisposition={verified:true,status:'technical_unusable',reason:'insufficient_recognition'};
 }})(t),job=await f.start('old-idle');
 assert.equal(job.runs[0].progressiveSourceStatus.action,'pending');assert.equal(job.progressiveSourcePreparation.sourceIds.length,3);
 assert.ok(!f.calls.asr.includes(IDS[0]));assert.equal(f.terminal.calls(),0);assert.equal(f.calls.models,0);
});
test('real preparation classifies retained zero-segment failure as failed technical preparation, never content passed',async t=>{
 const f=await makeFixture({seedExtra:seed=>{seed.autoJobs.find(j=>j.id==='old-idle').runs[0].versionPreparationAttempts[IDS[3]].reason=null;}})(t);
 const oldFailure=await fs.readFile(path.join(f.terminal.directory,'failure.json')),job=await f.start('old-idle'),run=job.runs[0];
 const attempt=run.versionPreparationAttempts[IDS[3]],stage=run.stageReports.find(s=>s.key==='source_slicing');
 assert.equal(attempt.complete,false);assert.equal(attempt.reason,'SOURCE_ASR_UNAVAILABLE');assert.equal(attempt.technicalDisposition.status,'technical_unusable');
 assert.equal(attempt.technicalDisposition.autoApproved,false);assert.equal(stage.passedCount,0);
 assert.equal(stage.sourcePreparationItems.find(s=>s.sourceId===IDS[3]).status,'failed');assert.match(stage.evidence.join(' '),/技术不适配/);
 assert.deepEqual(await fs.readFile(path.join(f.terminal.directory,'failure.json')),oldFailure);assert.equal(f.terminal.calls(),0);assert.equal(f.calls.models,0);
});
