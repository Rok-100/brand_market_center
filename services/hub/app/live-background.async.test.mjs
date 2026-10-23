import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate as nextTurn} from 'node:timers/promises';
import {OpeningNotifications} from './opening-notifications.mjs';
import {LiveAutoDispatch} from './live-auto-dispatch.mjs';
import {LiveSessionFlow} from './live-session-flow.mjs';
import {FlowRuntime} from './flow-runtime.mjs';

const baseNow=Date.parse('2026-10-15T16:30:00+08:00'),date='2026-10-16';
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
function storeFixture(){
 let state={schemaVersion:3,tasks:[],flowNotifications:[],flowEvents:[],flowDedupe:{}},version=0;
 const store={reads:0,writes:0,beforeRead:null,beforeMutate:null,beforeCommit:null,
  read(){throw Error('background synchronous read forbidden');},transaction(){throw Error('background synchronous transaction forbidden');},
  async readAsync(){this.reads++;await this.beforeRead?.();return structuredClone(state);},
  async transactionAsync(mutate){this.writes++;await this.beforeMutate?.();const expected=version,draft=structuredClone(state),result=mutate(draft);assert.equal(typeof result?.then,'undefined');await this.beforeCommit?.();if(expected!==version)throw Object.assign(Error('CAS conflict'),{status:503});state=draft;version++;return structuredClone(result);},
 };
 return {store,get state(){return state;}};
}
function fixture(){
 const storage=storeFixture();let now=baseNow,changed=false,identity=true;
 const modules=['workflow-engine','live-room-management'];
 const people=[{number:'DIRECTOR',name:'负责人',role:'director'},{number:'LEAD',name:'房间主管',role:'manager'},{number:'ANCHOR',name:'主播',role:'specialist'},{number:'ASSISTANT',name:'助理',role:'specialist'}].map(p=>({...p,center:'直播中心',active:true,workflowEnabled:true,modules}));
 const participants={people:()=>people.filter(p=>identity&&p.active&&['ANCHOR','ASSISTANT'].includes(p.number)),verified:n=>identity&&people.find(p=>p.number===n&&p.active),canOwn:(n,id)=>!!participants.verified(n)&&/^W04\.S4\./.test(id),recipient:n=>participants.verified(n)?{id:'ou_'+n.toLowerCase(),type:'open_id',name:people.find(p=>p.number===n).name}:null};
 const raw=requested=>({date:requested,updatedAt:new Date(now).toISOString(),issues:[],source:{mode:'official_live',verified:true,spreadsheetToken:'EuYqssm4WhNwAvtyybKcDdk1ned'},sourceStatus:{fixture:{found:true,revision:changed?2:1,sheetId:'fixture'}},rooms:requested===date?[{code:'fixture',name:'测试直播间',anchors:[[changed?'09:00':'08:00','10:00','主播']],assistants:[['07:00','11:00','助理']]}]:[]});
 const runtime=new FlowRuntime(storage.store,{people:()=>people,canNotify:n=>!!people.find(p=>p.number===n&&p.active),clock:()=>now,env:{}});runtime.liveParticipants=participants;
 const live=new LiveSessionFlow(runtime,{readSchedule:async(_req,requested)=>raw(requested),clock:()=>now,leads:{fixture:{number:'LEAD',name:'房间主管'}},enabled:true});
 const actor={enabled:true,canManage:true,department:true,user:people[0],modules};
 const dispatch=new LiveAutoDispatch(live,{enabled:true,actorNumber:'DIRECTOR',clock:()=>now});
 const sent=[];
 const opening=new OpeningNotifications({store:storage.store,readSchedule:async(_req,requested)=>raw(requested),participants:()=>participants,clock:()=>now,enabled:true,enabledRooms:['fixture'],send:async(message,uuid,stillValid)=>{if(!await stillValid())return {state:'attention'};sent.push({message,uuid});return {state:'sent',messageId:'om_'+sent.length};}});
 return {...storage,get state(){return storage.state;},people,participants,runtime,live,actor,dispatch,opening,sent,raw,setNow:value=>now=value,advance:ms=>now+=ms,change:()=>changed=true,revoke:()=>identity=false,restore:()=>identity=true};
}
async function createBody(h){const result=await h.live.preview(h.actor,null,date,{fresh:true});const slot=result.sessions[0];assert.ok(slot);return {date,sessionKey:slot.key,signature:slot.signature};}

test('opening job uses only async storage and retains personal-before-group receipts and restart dedupe',async()=>{
 const h=fixture();await h.opening.tick();assert.deepEqual(h.sent.map(x=>x.message.kind),['direct','direct','group']);
 h.opening.nextAt=0;await h.opening.tick();assert.equal(h.sent.length,3);assert.equal(h.state.openingReceipts.length,3);assert.equal(h.state.tasks.length,0);
});

test('opening final async read rechecks identity, lease and official schedule after yielding',async()=>{
 for(const change of ['identity','lease','disabled','schedule','expired-lease']){
  const h=fixture(),gate=deferred();h.store.beforeRead=()=>gate.promise;const pending=h.opening.tick();await nextTurn();assert.equal(h.store.reads,1);
  if(change==='identity')h.revoke();if(change==='lease')h.state.openingReceipts[0].lease='other';if(change==='disabled')h.opening.enabled=false;if(change==='schedule')h.change();if(change==='expired-lease')h.advance(121000);
  gate.resolve();await pending;assert.equal(h.sent.filter(x=>x.message.recipient.id==='ou_anchor').length,0,change);assert.equal(h.opening.running,false);
 }
});

test('group summary rechecks successful personal receipts after asynchronous waiting',async()=>{
 const h=fixture(),gate=deferred();h.store.beforeRead=()=>h.store.reads===3?gate.promise:undefined;const pending=h.opening.tick();await nextTurn();assert.equal(h.sent.length,2);
 h.state.openingReceipts.find(r=>r.kind==='direct').state='attention';gate.resolve();await pending;assert.equal(h.sent.filter(x=>x.message.kind==='group').length,0);
});

test('opening wait crossing midnight cannot claim yesterday plan',async()=>{
 const h=fixture(),gate=deferred();h.store.beforeMutate=()=>gate.promise;const pending=h.opening.tick();await nextTurn();
 h.setNow(Date.parse('2026-10-16T00:01:00+08:00'));gate.resolve();await pending;assert.equal(h.sent.length,0);assert.equal(h.state.openingReceipts.length,0);
});

test('receipt write conflict preserves the original uuid for uncertain send recovery',async()=>{
 const h=fixture();h.opening.maxPerTick=1;let commits=0;
 h.store.beforeCommit=()=>{if(++commits===3)throw Object.assign(Error('fixture write conflict'),{status:503});};
 await h.opening.tick();assert.equal(h.sent.length,1);assert.equal(h.state.openingReceipts[0].state,'sending');
 h.store.beforeCommit=null;h.advance(121000);h.opening.nextAt=0;await h.opening.tick();assert.equal(h.sent.length,2);assert.equal(h.sent[0].uuid,h.sent[1].uuid);assert.equal(h.state.openingReceipts[0].state,'sent');
});

test('auto dispatch and live creation use no synchronous storage and preserve source dedupe',async()=>{
 const h=fixture();await h.dispatch.tick();assert.equal(h.state.tasks.length,1);assert.equal(h.state.liveDispatchStatus.createdTaskIds.length,1);
 const notices=h.state.flowNotifications.length;assert.ok(notices>0);h.dispatch.nextAt=0;await h.dispatch.tick();assert.equal(h.state.tasks.length,1);assert.equal(h.state.flowNotifications.length,notices);
});

test('dispatch permission loss while async read is pending cannot create work',async()=>{
 const h=fixture(),gate=deferred();h.store.beforeRead=()=>gate.promise;const pending=h.dispatch.tick();await nextTurn();assert.ok(h.store.reads>0);assert.equal(h.dispatch.running,true);
 await h.dispatch.tick();h.people[0].active=false;gate.resolve();await pending;assert.equal(h.state.tasks.length,0);assert.equal(h.state.flowNotifications.length,0);assert.equal(h.dispatch.running,false);
});

test('auto dispatch cannot backfill a shift that starts while its transaction is waiting',async()=>{
 const h=fixture(),gate=deferred();h.store.beforeMutate=()=>gate.promise;const pending=h.dispatch.tick();await nextTurn();assert.equal(h.store.writes,1);
 h.setNow(Date.parse('2026-10-16T08:01:00+08:00'));gate.resolve();await pending;assert.equal(h.state.tasks.length,0);assert.ok(h.state.liveDispatchStatus.issues.some(i=>/已经开始/.test(i.message)));
});

test('live create rechecks participant authorization after waiting for the transaction',async()=>{
 const h=fixture(),body=await createBody(h),gate=deferred();h.store.beforeMutate=()=>gate.promise;const pending=h.live.create(h.actor,null,body,'fixture-live-create');await nextTurn();assert.equal(h.store.writes,1);
 h.revoke();gate.resolve();await assert.rejects(pending,/身份/);assert.equal(h.state.tasks.length,0);assert.equal(h.state.flowNotifications.length,0);
 h.restore();h.store.beforeMutate=null;await h.live.create(h.actor,null,body,'fixture-live-create');assert.equal(h.state.tasks.length,1);
});

test('concurrent same-slot creates retain CAS and recover to one task without duplicate notices',async()=>{
 const h=fixture(),body=await createBody(h),gate=deferred();let commits=0;h.store.beforeCommit=()=>{commits++;return gate.promise;};
 const a=h.live.create(h.actor,null,body,'fixture-concurrent-a'),b=h.live.create(h.actor,null,body,'fixture-concurrent-b');await nextTurn();assert.equal(commits,2);gate.resolve();
 const results=await Promise.allSettled([a,b]);assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal(h.state.tasks.length,1);const notices=h.state.flowNotifications.length;
 h.store.beforeCommit=null;await h.live.create(h.actor,null,body,'fixture-concurrent-a');await h.live.create(h.actor,null,body,'fixture-concurrent-b');assert.equal(h.state.tasks.length,1);assert.equal(h.state.flowNotifications.length,notices);
});

test('two fresh confirmed schedule changes flag original task once and do not make replacements',async()=>{
 const h=fixture();await h.dispatch.tick();assert.equal(h.state.tasks.length,1);h.change();h.dispatch.nextAt=0;await h.dispatch.tick();assert.equal(h.state.tasks[0].runtime.liveSession.sourceIssue,undefined);
 h.advance(301000);h.dispatch.nextAt=0;await h.dispatch.tick();assert.ok(h.state.tasks[0].runtime.liveSession.sourceIssue);assert.equal(h.state.tasks.length,1);assert.equal(h.state.flowNotifications.filter(n=>n.kind==='live_source_changed').length,1);
 h.advance(301000);h.dispatch.nextAt=0;await h.dispatch.tick();assert.equal(h.state.flowNotifications.filter(n=>n.kind==='live_source_changed').length,1);
});

test('cancelled deduplicated live task is not silently recreated',async()=>{
 const h=fixture(),body=await createBody(h);await h.live.create(h.actor,null,body,'fixture-cancelled');h.state.tasks[0].runtime.state='cancelled';
 await assert.rejects(h.live.create(h.actor,null,body,'fixture-cancelled'),/终止/);assert.equal(h.state.tasks.length,1);
});
