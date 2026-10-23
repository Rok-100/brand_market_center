import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate as nextTurn} from 'node:timers/promises';
import {ProductionSources} from './flow-production-sources.mjs';

const initial=Date.parse('2026-10-15T12:00:00+08:00');
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
function harness({readGate,writeGate}={}){
  let now=initial,fileReads=0,stateReads=0,writes=0,failure=false;
  const data={schemaVersion:1,checkedAt:new Date(now).toISOString(),people:[],baselines:{creative:[],cloud:[],remix:[]},creative:{records:[],users:[],actionsByRecord:{}},cloud:{records:[]},remix:{records:[]},notificationsEnabled:true};
  const state={tasks:[{id:'task',version:3,runtime:{sourceKey:'creative:idea:record',creative:{checkedAt:new Date(now).toISOString(),signature:'v1'}}}],creativeWatches:[{taskId:'task',checkedAt:new Date(now).toISOString()}]},calls=[];
  const store={read(){throw Error('unexpected synchronous read');},transaction(){throw Error('unexpected synchronous transaction');},async readAsync(){stateReads++;return structuredClone(state);},async transactionAsync(mutate){writes++;await writeGate?.promise;return mutate(state);}};
  const runtime={store,clock:()=>now,iso:()=>new Date(now).toISOString(),people:()=>[]};
  const source=new ProductionSources(runtime,{people:()=>[]},{file:'/source.json',readFileImpl:async()=>{fileReads++;await readGate?.promise;if(failure)throw Error('private transport failure');return JSON.stringify(data);}});
  source.creativeBridge={connection:{},sync:async options=>{calls.push(['creative',options]);}};
  source.business={connections:{cloud:{},remix:{}},syncCooperatively:async(value,options)=>{calls.push(['business',options]);for(const t of state.tasks)t.runtime.creative.checkedAt=runtime.iso();}};
  return {source,runtime,data,state,calls,get fileReads(){return fileReads;},get stateReads(){return stateReads;},get writes(){return writes;},advance(ms){now+=ms;data.checkedAt=runtime.iso();},fail(value){failure=value;}};
}

test('concurrent background ticks share only the pending read and leave the event loop free',async()=>{
  const readGate=deferred(),h=harness({readGate});const first=h.source.sync(),second=h.source.sync();await nextTurn();assert.equal(h.fileReads,1);assert.equal(h.calls.length,0);
  readGate.resolve();await Promise.all([first,second]);assert.deepEqual(h.calls,[['creative',{forceVerify:true}],['business',{forceVerify:true}]]);assert.equal(h.stateReads,1);assert.equal(h.source.verified.size,1);
});

test('each completed tick rereads the source but unchanged short intervals do not rewrite tasks',async()=>{
  const h=harness();await h.source.sync();h.advance(5000);await h.source.sync();assert.equal(h.fileReads,2);assert.equal(h.calls.length,2);assert.equal(h.writes,0);assert.equal(h.runtime.serviceNotificationOwners.size,3);
});

test('heartbeat uses an asynchronous transaction and preserves verified signature/version checks',async()=>{
  const writeGate=deferred(),h=harness({writeGate});await h.source.sync();const before=h.state.tasks[0].runtime.creative.checkedAt;h.advance(20000);
  const pending=h.source.sync();await nextTurn();assert.equal(h.writes,1);h.state.tasks[0].version++;
  writeGate.resolve();await pending;assert.equal(h.state.tasks[0].runtime.creative.checkedAt,before);assert.equal(h.state.creativeWatches[0].checkedAt,before);
});

test('unchanged verified tasks receive heartbeat only after its awaited durable write',async()=>{
  const writeGate=deferred(),h=harness({writeGate});await h.source.sync();h.advance(20000);const pending=h.source.sync();await nextTurn();
  assert.equal(h.source.lastHeartbeatAt,initial);writeGate.resolve();await pending;assert.equal(h.source.lastHeartbeatAt,initial+20000);assert.equal(h.state.tasks[0].runtime.creative.checkedAt,h.runtime.iso());assert.equal(h.state.creativeWatches[0].checkedAt,h.runtime.iso());
});

test('content or notification-owner change triggers full verification before 30 seconds',async()=>{
  const h=harness();await h.source.sync();h.advance(5000);h.data.notificationsEnabled=false;await h.source.sync();assert.equal(h.calls.length,4);assert.equal(h.runtime.serviceNotificationOwners.size,0);
});

test('stale and malformed input fails closed without any business synchronization',async()=>{
  for(const invalid of ['stale','shape']){const h=harness();if(invalid==='stale')h.data.checkedAt=new Date(initial-45000).toISOString();else h.data.people=null;await h.source.sync();assert.equal(h.source.snapshot,null);assert.equal(h.calls.length,0);assert.equal(h.stateReads,0);assert.match(h.source.issue,/未通过/);}
});

test('failed source read releases single flight and recovery retries without stale source reuse',async()=>{
  const h=harness();h.fail(true);await h.source.sync();assert.equal(h.source.snapshot,null);assert.equal(h.source.syncPromise,null);assert.equal(h.source.issue,'来源快照读取失败');h.fail(false);await h.source.sync();assert.ok(h.source.fresh());assert.equal(h.fileReads,2);assert.equal(h.calls.length,2);
});

test('heartbeat failure cannot advance the verification timestamp and next tick recovers fully',async()=>{
  const h=harness();await h.source.sync();h.advance(20000);const write=h.runtime.store.transactionAsync;h.runtime.store.transactionAsync=async()=>{throw Error('storage unavailable');};await h.source.sync();assert.equal(h.source.snapshot,null);assert.equal(h.source.lastHeartbeatAt,initial);h.runtime.store.transactionAsync=write;await h.source.sync();assert.equal(h.calls.length,4);assert.ok(h.source.fresh());
});
