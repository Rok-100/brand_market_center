import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate as nextTurn} from 'node:timers/promises';
import {LiveFeishuService} from './live-feishu-service.mjs';

const baseNow=Date.parse('2026-10-15T10:00:00+08:00');
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
function task(id='live',overrides={}){
  return {id,workflow:'04',runtime:{state:'running',liveSession:{startAt:'2026-10-15T09:00:00+08:00',endAt:'2026-10-15T11:00:00+08:00'},nodes:[{id:'prepare',state:'ready',attempt:1,owner:{number:'approved'}}],...overrides}};
}
function harness({tasks=[task()],now=baseNow,readGate,transactionGate}={}){
  let state={tasks,flowNotifications:[],flowEvents:[]},clock=now,reads=0,transactions=0,flushes=0,allowed=true;
  const store={
    read(){throw Error('synchronous store read must not run');},
    transaction(){throw Error('synchronous store transaction must not run');},
    async readAsync(){reads++;await readGate?.promise;return structuredClone(state);},
    async transactionAsync(mutate){transactions++;await transactionGate?.promise;const draft=structuredClone(state);const result=mutate(draft);state=draft;return result;},
  };
  const runtime={store,log(s,t,n,action,actor,note){const event={id:'event-'+s.flowEvents.length,taskId:t.id,nodeId:n.id,action,note};s.flowEvents.push(event);return event;},
    notify(s,t,n,kind,recipient,eventId){s.flowNotifications.push({taskId:t.id,nodeId:n.id,attempt:n.attempt,kind,recipient,eventId});}};
  const service=new LiveFeishuService({runtime,notifier:{},env:{},clock:()=>clock});
  Object.assign(service,{enabled:true,transport:{client:{},ready:()=>true},participants:{canOwn:number=>allowed&&number==='approved'},refreshIdentities:async()=>{},inbox:{flush:async()=>{flushes++;}},testCards:null});
  return {service,store,get state(){return state;},get reads(){return reads;},get transactions(){return transactions;},get flushes(){return flushes;},setNow(value){clock=value;},revoke(){allowed=false;}};
}

test('idle morning tick uses asynchronous read and never opens a write transaction',async()=>{
  const h=harness({tasks:[]});await h.service.tick();assert.equal(h.reads,1);assert.equal(h.transactions,0);assert.equal(h.flushes,1);assert.equal(h.service.running,false);
});

test('delayed store read leaves event loop responsive and keeps the tick single flight',async()=>{
  const readGate=deferred(),h=harness({readGate});const pending=h.service.tick();await nextTurn();
  assert.equal(h.reads,1);assert.equal(h.service.running,true);assert.equal(h.flushes,0);
  await h.service.tick();assert.equal(h.reads,1);readGate.resolve();await pending;
  assert.equal(h.state.flowNotifications.length,1);assert.equal(h.flushes,1);
});

test('only eligible live tasks queue once; repeated ticks retain durable deduplication',async()=>{
  const expired=task('expired',{liveSession:{startAt:'2026-10-15T07:00:00+08:00',endAt:'2026-10-15T08:00:00+08:00'}});
  const h=harness({tasks:[task(),task('paused',{state:'paused'}),task('nonlive',{liveSession:null}),task('source-issue',{liveSession:{startAt:'2026-10-15T09:00:00+08:00',endAt:'2026-10-15T11:00:00+08:00',sourceIssue:'changed'}}),task('unapproved',{nodes:[{id:'prepare',state:'ready',attempt:1,owner:{number:'other'}}]}),expired]});
  await h.service.tick();await h.service.tick();assert.equal(h.state.flowNotifications.length,1);
  assert.deepEqual(h.state.flowNotifications[0],{taskId:'live',nodeId:'prepare',attempt:1,kind:'live_today',recipient:'approved',eventId:'event-0',businessDate:'2026-10-15'});
  assert.equal(h.transactions,1);
});

test('fresh transaction state rechecks dedupe, owner eligibility and task state after await',async()=>{
  for(const change of ['duplicate','revoked','paused']){
    const transactionGate=deferred(),h=harness({transactionGate});const pending=h.service.queueMorning();await nextTurn();assert.equal(h.transactions,1);
    if(change==='duplicate')h.state.flowNotifications.push({taskId:'live',nodeId:'prepare',attempt:1,recipient:'approved',kind:'live_today',businessDate:'2026-10-15'});
    if(change==='revoked')h.revoke();
    if(change==='paused')h.state.tasks[0].runtime.state='paused';
    transactionGate.resolve();await pending;assert.equal(h.state.flowEvents.length,0,change);assert.equal(h.state.flowNotifications.length,change==='duplicate'?1:0,change);
  }
});

test('shutdown and elapsed live slot during asynchronous transaction cannot queue a notice',async()=>{
  for(const change of ['closed','expired','next-day']){
    const transactionGate=deferred(),h=harness({transactionGate});const pending=h.service.tick();await nextTurn();
    if(change==='closed')h.service.closed=true;
    if(change==='expired')h.setNow(Date.parse('2026-10-15T11:01:00+08:00'));
    if(change==='next-day')h.setNow(Date.parse('2026-10-16T00:01:00+08:00'));
    transactionGate.resolve();await pending;assert.equal(h.state.flowNotifications.length,0,change);
    if(change==='closed')assert.equal(h.flushes,0);
  }
});

test('storage failure releases tick guard; recovery retries the existing work exactly once',async()=>{
  const h=harness(),original=h.store.readAsync;let fail=true;h.store.readAsync=async()=>{if(fail)throw Error('temporary storage unavailable');return original();};
  await assert.rejects(h.service.tick(),/temporary storage/);assert.equal(h.service.running,false);assert.equal(h.state.flowNotifications.length,0);assert.equal(h.flushes,0);
  fail=false;await h.service.tick();await h.service.tick();assert.equal(h.state.flowNotifications.length,1);
});

test('disabled service and before-08:00 gate do not read or mutate storage',async()=>{
  const disabled=harness();disabled.service.enabled=false;await disabled.service.tick();assert.equal(disabled.reads,0);
  const early=harness({now:Date.parse('2026-10-15T07:59:00+08:00')});await early.service.queueMorning();assert.equal(early.reads,0);assert.equal(early.transactions,0);
});
