import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {mergeAnchorRecordings} from './anchor-recording-refresh.mjs';

const server = await readFile(new URL('./server.js', import.meta.url), 'utf8');
const start = server.indexOf('async function refreshAnchorRecordingEvidence(slot) {');
const end = server.indexOf('async function refreshAnchorLifecycle(targetDate) {', start);
const refreshSource = server.slice(start, end);
function fixture({collect, write} = {}) {
  const state = {running: null};
  let snapshot = {profiles:[{name:'甲'}], evidenceByAnchor:{甲:{evaluations:[],recordings:[{messageId:'old'}]}}};
  let calls = 0;
  const dependencies = {
    anchorStatusService:{status:()=>({lastSlot:snapshot.anchorRecordingSlot}),ingestEvidence:()=>{},scan:async()=>({added:0})},
    lifecycleState:state, readLifecycleSnapshot:async()=>snapshot,
    collectAnchorEvidence:async(names, date, options)=>{
      calls++; assert.deepEqual([...names], ['甲']); assert.equal(options.recordingsOnly,true);
      if (collect) return collect();
      return {sources:{learning:{available:true}},windows:{recordings:'近3日'},fetchedAt:'now',evidenceByAnchor:{甲:{recordings:[{messageId:'new'}]}}};
    }, chinaDateFor:()=> '2026-10-06', verifiedAnchorEvidence:value=>value, mergeAnchorRecordings,
    lifecycleSnapshotPath:()=> 'anchors.json', writeJsonAtomic:async(path,value)=>{
      if(write) await write(); snapshot=value;
    },
  };
  const refresh = new Function('deps', `const {${Object.keys(dependencies).join(',')}} = deps;\n${refreshSource}\nreturn refreshAnchorRecordingEvidence;`)(dependencies);
  return {refresh,state,snapshot:()=>snapshot,calls:()=>calls};
}
test('completed slot in the snapshot prevents rescans, next hour refreshes',async()=>{
  const app=fixture(); await app.refresh('2026-10-06T08:15');
  await app.refresh('2026-10-06T08:15'); assert.equal(app.calls(),1);
  await app.refresh('2026-10-06T09:15'); assert.equal(app.calls(),2);
  assert.equal(app.snapshot().anchorRecordingSlot,'2026-10-06T09:15');
});
test('in-flight lifecycle work prevents concurrent recording snapshot writes',async()=>{
  let release; const paused=new Promise(resolve=>{release=resolve});
  const app=fixture({write:()=>paused});
  const first=app.refresh('slot'); await new Promise(resolve=>setImmediate(resolve));
  assert.ok(app.state.running); await app.refresh('slot'); assert.equal(app.calls(),1);
  release(); await first; assert.equal(app.state.running,null);
});
test('upstream and storage failures retain old recording and make the slot retryable',async()=>{
  for(const overrides of [{collect:async()=>{throw Error('source failed')}},{write:async()=>{throw Error('disk failed')}}]) {
    const app=fixture(overrides); await assert.rejects(app.refresh('slot'));
    assert.equal(app.state.running,null); assert.equal(app.snapshot().anchorRecordingSlot,undefined);
    assert.equal(app.snapshot().evidenceByAnchor.甲.recordings[0].messageId,'old');
    await assert.rejects(app.refresh('slot')); assert.equal(app.calls(),2);
  }
});
