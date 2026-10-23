import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate as nextTurn} from 'node:timers/promises';
import {LiveFeishuInbox} from './live-feishu-inbox.mjs';

const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
const transient=()=>Object.assign(new Error('temporary storage unavailable'),{status:503});
const event={verified:true,appId:'approved-app',eventId:'same-original-event',messageId:'same-original-message',openId:'approved-person',action:'live_ack',form:{note:'确认收到'}};
const result={status:'acknowledged',card:{elements:[{tag:'div',text:{content:'已确认'}}]}};
function harness({empty=false,handle=async()=>structuredClone(result),updateCard=async()=>{}}={}){
  let now=Date.parse('2026-10-15T10:00:00+08:00'),version=0,reads=0,transactions=0;
  let state={liveFeishuInbox:empty?{}:{job:{id:'job',hash:'original-hash',event:structuredClone(event),state:'ready',attempts:0,nextAt:now,createdAt:new Date(now).toISOString()}},tasks:[{id:'task',runtime:{manager:{number:'approved-manager'}}}],flowNotifications:[{messageId:event.messageId,taskId:'task'}],flowEvents:[]};
  const calls=[],updates=[],store={
    read(){throw Error('synchronous inbox read must not run');},
    transaction(){throw Error('synchronous inbox transaction must not run');},
    async readAsync(){reads++;await store.beforeRead?.();return structuredClone(state);},
    async transactionAsync(mutate){
      const count=++transactions;await store.beforeSnapshot?.(count);const v=version,draft=structuredClone(state),value=mutate(draft);
      await store.beforeCommit?.(count,draft);if(v!==version)throw transient();state=draft;version++;
      await store.afterCommit?.(count);return structuredClone(value);
    },
  };
  const actions={appId:event.appId,runtime:{store,
    log(s,t,n,action,actor,note){const e={id:'event-'+s.flowEvents.length,action,note};s.flowEvents.push(e);return e;},
    notify(s,t,n,kind,recipient,eventId){s.flowNotifications.push({kind,recipient,eventId});}},
    async handle(e){calls.push(structuredClone(e));return handle(e);}};
  const create=()=>new LiveFeishuInbox({actions,clock:()=>now,updateCard:async(...args)=>{updates.push(structuredClone(args));return updateCard(...args);}});
  return {store,actions,create,worker:create(),calls,updates,get state(){return state;},get reads(){return reads;},get transactions(){return transactions;},advance(ms){now+=ms;}};
}

test('empty inbox poll yields the event loop and performs no write or synchronous I/O',async()=>{
  const h=harness({empty:true}),gate=deferred();h.store.beforeRead=()=>gate.promise;
  const pending=h.worker.flush();await nextTurn();assert.equal(h.reads,1);assert.equal(h.worker.running,true);assert.equal(h.transactions,0);
  await h.worker.flush();assert.equal(h.reads,1);gate.resolve();await pending;
  assert.equal(h.worker.running,false);assert.equal(h.transactions,0);assert.equal(h.calls.length,0);
});

test('successful callback uses async state only, preserving original event and message identity',async()=>{
  const h=harness();await h.worker.flush();await h.worker.flush();
  assert.equal(h.state.liveFeishuInbox.job.state,'done');assert.equal(h.state.liveFeishuInbox.job.attempts,1);
  assert.deepEqual(h.calls,[event]);assert.deepEqual(h.updates,[[event.messageId,result.card]]);assert.equal(h.state.flowEvents.length,0);
});

test('same worker remains single flight across asynchronous claims and business work',async()=>{
  const gate=deferred(),h=harness({handle:async()=>{await gate.promise;return result;}});
  const pending=h.worker.flush();await nextTurn();await h.worker.flush();assert.equal(h.calls.length,1);
  gate.resolve();await pending;assert.equal(h.updates.length,1);assert.equal(h.worker.running,false);
});

test('competing async claims permit one business call; failed CAS releases the other worker',async()=>{
  const gate=deferred(),h=harness(),other=h.create();let claims=0;
  h.store.beforeCommit=async(n,draft)=>{if(draft.liveFeishuInbox.job.state==='working'&&!draft.liveFeishuInbox.job.result){claims++;await gate.promise;}};
  const pending=[h.worker.flush(),other.flush()];await nextTurn();assert.equal(claims,2);gate.resolve();
  const settled=await Promise.allSettled(pending);assert.equal(settled.filter(x=>x.status==='rejected').length,1);
  assert.equal(h.calls.length,1);assert.equal(h.updates.length,1);assert.equal(h.worker.running,false);assert.equal(other.running,false);
});

test('uncertain card response retries the same card with saved result, without repeating business work',async()=>{
  let fail=true;const h=harness({updateCard:async()=>{if(fail)throw Error('network response lost');}});
  await h.worker.flush();assert.equal(h.state.liveFeishuInbox.job.state,'ready');assert.deepEqual(h.state.liveFeishuInbox.job.result,result);
  fail=false;h.advance(10000);await h.worker.flush();
  assert.equal(h.state.liveFeishuInbox.job.state,'done');assert.equal(h.calls.length,1);assert.equal(h.updates.length,2);
  assert.deepEqual(h.updates[0],h.updates[1]);assert.deepEqual(h.state.liveFeishuInbox.job.event,event);
});

test('failed result persistence retains known business success in retry state',async()=>{
  const h=harness();h.store.beforeCommit=n=>{if(n===2)throw transient();};await h.worker.flush();
  assert.equal(h.state.liveFeishuInbox.job.state,'ready');assert.deepEqual(h.state.liveFeishuInbox.job.result,result);assert.equal(h.updates.length,0);
  h.advance(10000);await h.worker.flush();assert.equal(h.calls.length,1);assert.equal(h.updates.length,1);assert.equal(h.state.liveFeishuInbox.job.state,'done');
});

test('uncertain done commit read-back cannot demote a successfully committed result',async()=>{
  const h=harness();h.store.afterCommit=n=>{if(n===3)throw transient();};await h.worker.flush();
  assert.equal(h.state.liveFeishuInbox.job.state,'done');assert.equal(h.state.liveFeishuInbox.job.leaseUntil,undefined);
  await h.worker.flush();assert.equal(h.calls.length,1);assert.equal(h.updates.length,1);
});

test('permission rejection remains terminal and keeps original manager attention behavior',async()=>{
  const h=harness({handle:async()=>{throw Object.assign(new Error('本人权限已失效'),{status:403});}});
  await h.worker.flush();await h.worker.flush();assert.equal(h.state.liveFeishuInbox.job.state,'attention');assert.equal(h.calls.length,1);assert.equal(h.updates.length,0);
  assert.deepEqual(h.state.flowEvents.map(x=>x.action),['live_card_attention']);
  assert.equal(h.state.flowNotifications.filter(x=>x.kind==='live_card_attention').length,1);assert.equal(h.state.flowNotifications.at(-1).recipient,'approved-manager');
});

test('transient action failure retains event identity and retries without a false success',async()=>{
  let fail=true;const h=harness({handle:async()=>{if(fail)throw transient();return result;}});await h.worker.flush();
  assert.equal(h.state.liveFeishuInbox.job.state,'ready');assert.equal(h.state.liveFeishuInbox.job.result,undefined);assert.equal(h.updates.length,0);
  fail=false;h.advance(10000);await h.worker.flush();assert.deepEqual(h.calls,[event,event]);assert.equal(h.state.liveFeishuInbox.job.state,'done');
});

test('expired previous claimant cannot overwrite a newer worker result or update its card',async()=>{
  const gate=deferred();let calls=0;const h=harness({handle:async()=>{if(++calls===1){await gate.promise;return {...result,status:'old-worker'};}return result;}});
  const pending=h.worker.flush();await nextTurn();h.advance(120001);await h.create().flush();gate.resolve();await pending;
  assert.equal(h.state.liveFeishuInbox.job.state,'done');assert.deepEqual(h.state.liveFeishuInbox.job.result,result);assert.equal(h.updates.length,1);assert.deepEqual(h.calls,[event,event]);
});

test('late card failure cannot return a newer successful claim to ready or attention',async()=>{
  const gate=deferred();let updates=0;const h=harness({updateCard:async()=>{if(++updates===1){await gate.promise;throw Error('old response lost');}}});
  const pending=h.worker.flush();await nextTurn();h.advance(120001);await h.create().flush();gate.resolve();await pending;
  assert.equal(h.state.liveFeishuInbox.job.state,'done');assert.equal(h.calls.length,1);assert.equal(h.updates.length,2);assert.deepEqual(h.updates[0],h.updates[1]);assert.equal(h.state.flowEvents.length,0);
});

test('unavailable retry persistence leaves the leased original event for bounded recovery',async()=>{
  let fail=true;const h=harness({handle:async()=>{if(fail)throw transient();return result;}});h.store.beforeCommit=n=>{if(n===2)throw transient();};
  await assert.rejects(h.worker.flush(),/temporary storage/);assert.equal(h.worker.running,false);assert.equal(h.state.liveFeishuInbox.job.state,'working');
  fail=false;h.advance(120001);await h.worker.flush();assert.equal(h.state.liveFeishuInbox.job.state,'done');assert.deepEqual(h.calls,[event,event]);assert.equal(h.updates.length,1);
});
