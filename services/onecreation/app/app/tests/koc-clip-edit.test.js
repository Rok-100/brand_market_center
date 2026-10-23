const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const load = Module._load;
let server;
try {
  Module._load = function(id, ...args) { if (id === 'mysql2/promise') return { createPool() { throw Error('Offline test'); } }; return load.call(this, id, ...args); };
  server = require('../server.js');
} finally { Module._load = load; }
const { editKocClipList } = require('../assets/koc-audio-runtime/koc-clip-edit.js');
function fixture(status='awaiting_review') {
  const tasks=[1,2,3].map(index=>({index, duration:5, voiceover:`line${index}`, sourceLineIndex:1,sourceSegmentIndex:index,status:status==='success'?'success':'queued',localPath:status==='success'?`${index}.mp4`:''}));
  return {status,tasks,reviewRevision:1,clipPlan:{clips:tasks,lockedScript:'line1line2line3'},finalVideoPath:'old.mp4',previewPath:'old.mp4',finalVideoValidation:{ok:true},finalDelivery:{status:'completed',assetId:99},finalVideoRevision:2};
}
test('deleted clips leave the generation list and locked script; restoring preserves the original order',()=>{
  const job=fixture();
  assert.equal(editKocClipList(job,2,false,server.reconstructKocLockedScript),false);
  assert.deepEqual(job.tasks.map(t=>t.index),[1,3]);
  assert.equal(job.clipPlan.totalDuration,10);
  assert.equal(job.clipPlan.lockedScript,'line1line3');
  assert.equal(server.kocScriptMatchesLocked(job.tasks,job.clipPlan.lockedScript),true);
  assert.equal(job.removedKocTasks[0].task.voiceover,'line2');
  editKocClipList(job,2,true,server.reconstructKocLockedScript);
  assert.deepEqual(job.tasks.map(t=>t.index),[1,2,3]);
  assert.equal(job.clipPlan.lockedScript,'line1line2line3');
});
test('editing completed clips requests recomposition and retains the previous receipt and source files',()=>{
  const job=fixture('success');
  assert.equal(editKocClipList(job,1,false,server.reconstructKocLockedScript),true);
  assert.equal(job.finalVideoPath,'');
  assert.equal(job.finalDelivery.assetId,99);
  assert.equal(job.finalVideoRevision,2);
  assert.equal(job.removedKocTasks[0].task.localPath,'1.mp4');
  assert.equal(job.summary.success,2);
});
test('all clips may be removed and restored without creating a zero-clip output',()=>{
  const job=fixture();
  for (const index of [1,2,3]) assert.equal(editKocClipList(job,index,false,server.reconstructKocLockedScript),false);
  assert.equal(job.tasks.length,0);assert.equal(job.clipPlan.totalDuration,0);assert.equal(job.status,'awaiting_review');
  editKocClipList(job,2,true,server.reconstructKocLockedScript);
  assert.equal(job.tasks[0].index,2);
});
test('active work and nonexistent clip edits are rejected without mutation',()=>{
  for(const status of ['running','finalizing','validating']){
    const job=fixture(status);assert.throws(()=>editKocClipList(job,1,false,server.reconstructKocLockedScript));assert.equal(job.tasks.length,3);
  }
  const job=fixture();assert.throws(()=>editKocClipList(job,99,false,server.reconstructKocLockedScript));assert.equal(job.tasks.length,3);
});
test('restoring an ungenerated clip generates only that clip and reuses completed clips',async()=>{
  const fs=require('node:fs');const vm=require('node:vm');const path=require('node:path');
  const source=fs.readFileSync(path.join(__dirname,'../server.js'),'utf8');
  const start=source.indexOf('\nasync function processKocGeneration(')+1;
  const end=source.indexOf('\nfunction startKocGeneration(',start);
  const prepared=[];
  const job=fixture('success');job.id='fixture';job.outputDir='/fixture';job.config={declineAudioReference:true};job.kocAssets={productAssets:[]};job.checkpoints={};job.tasks[1].status='queued';job.tasks[1].localPath='';
  const context=vm.createContext({path,runLibtv:async()=>({code:0}),kocScriptMatchesLocked:server.kocScriptMatchesLocked,ensureKocRemoteAssets:async()=>{},finalizeKocRuntimePrompts:async()=>{},saveJob:async()=>{},log(){},fsp:{writeFile:async()=>{}},
    prepareKocBatch:async(j,tasks)=>{prepared.push(...tasks.map(t=>t.index));},
    runKocConcurrentBatch:async(j,tasks)=>{for(const task of tasks){task.status='success';task.localPath=`${task.index}.mp4`;}return {success:tasks.length,failed:0,total:tasks.length};},
    startKocFinalization:async j=>{j.status='success';}});
  vm.runInContext(source.slice(start,end),context);
  await context.processKocGeneration(job);
  assert.deepEqual(prepared,[2]);assert.equal(job.status,'success');assert.equal(job.summary.success,3);assert.equal(job.summary.total,3);
  assert.equal(job.tasks[0].localPath,'1.mp4');assert.equal(job.tasks[2].localPath,'3.mp4');
});
