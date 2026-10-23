import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate as nextTurn} from 'node:timers/promises';
import {FlowRuntime} from './flow-runtime.mjs';
import {FlowCreative} from './flow-creative.mjs';
import {SourceBusinessBridge} from './flow-source-business.mjs';
import {ProductionCreativeBridge} from './flow-source-creative.mjs';

const now=Date.parse('2026-10-15T12:00:00+08:00');
const people=['owner','lead','manager'].map((number,i)=>({number,name:number,center:'fixture',active:true,role:i===2?'manager':'specialist',modules:['creative-hub','material-workbench','cloud-manager']}));
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
function harness({syncAllowed=false,readGate}={}){
  let state={schemaVersion:3,tasks:[],flowNotifications:[],flowEvents:[],flowDedupe:{},creativeWatches:[]},reads=0,writes=0,hook=null,commitThenReject=false;
  function transaction(mutate){hook?.(state);hook=null;const draft=structuredClone(state),result=mutate(draft);assert.equal(typeof result?.then,'undefined','transaction mutation stays synchronous');state=draft;writes++;if(commitThenReject){commitThenReject=false;throw Error('uncertain commit reply');}return structuredClone(result);}
  const store={read(){assert.ok(syncAllowed,'unexpected synchronous read');return structuredClone(state);},sourceTask(key){assert.ok(syncAllowed,'unexpected synchronous source lookup');return structuredClone(state.tasks.find(t=>t.runtime?.sourceKey===key));},transaction(mutate){assert.ok(syncAllowed,'unexpected synchronous transaction');return transaction(mutate);},async readAsync(){reads++;await readGate?.promise;return structuredClone(state);},async transactionAsync(mutate){await nextTurn();return transaction(mutate);}};
  const runtime=new FlowRuntime(store,{people:()=>people,clock:()=>now});
  return {runtime,store,get state(){return state;},get reads(){return reads;},get writes(){return writes;},beforeTransaction(fn){hook=fn;},uncertainCommit(){commitThenReject=true;}};
}
function row(source,id,{state='ready',owner='owner',upstreamRenderId=null}={}){return {id,title:id,owner,version:1,status:state,upstreamRenderId,steps:[{id:source==='remix'?'W02.S1.E1':'W03.S1.E1',title:'fixture node',owner,state}]};}
function snapshot(remix=[],cloud=[],baselines={remix:[],cloud:[]}){return {baselines,remix:{records:remix},cloud:{records:cloud}};}
const facts=s=>({tasks:s.tasks.map(t=>({key:t.runtime.sourceKey,state:t.runtime.state,version:t.version,nodes:t.runtime.nodes.map(n=>({id:n.id,state:n.state,attempt:n.attempt})),source:t.runtime.localBusiness})),events:s.flowEvents.map(e=>e.action),notices:s.flowNotifications.map(n=>({kind:n.kind,recipient:n.recipient}))});

test('business async path matches synchronous business results and repeated source replay is idempotent',async()=>{
  const async=harness(),sync=harness({syncAllowed:true}),a=new SourceBusinessBridge(async.runtime),b=new SourceBusinessBridge(sync.runtime),data=snapshot([row('remix','render')]);
  await a.syncCooperatively(data,{forceVerify:true});b.sync(data);assert.deepEqual(facts(async.state),facts(sync.state));const prior=facts(async.state);await a.syncCooperatively(data,{forceVerify:true});assert.deepEqual(facts(async.state),prior);
});

test('business full sync asynchronously handles completion, verified handoff, and missing sources',async()=>{
  const h=harness(),bridge=new SourceBusinessBridge(h.runtime);
  await bridge.syncCooperatively(snapshot([row('remix','render',{state:'completed'})],[row('cloud','asset',{upstreamRenderId:'render'})]));
  const parent=h.state.tasks.find(t=>t.runtime.sourceKey==='source:remix:render'),child=h.state.tasks.find(t=>t.runtime.sourceKey==='source:cloud:asset');assert.equal(parent.runtime.handoff.taskId,child.id);assert.equal(child.runtime.parentTaskId,parent.id);
  const handoffs=h.state.flowEvents.filter(e=>e.action==='handoff_dispatched').length;await bridge.syncCooperatively(snapshot([row('remix','render',{state:'completed'})],[row('cloud','asset',{upstreamRenderId:'render'})]));assert.equal(h.state.flowEvents.filter(e=>e.action==='handoff_dispatched').length,handoffs);
  await bridge.syncCooperatively(snapshot());assert.match(h.state.tasks[1].runtime.localBusiness.issue,/暂不可读/);assert.equal(h.state.tasks[1].runtime.state,'running');
});

test('baseline rows cannot become new tasks, including removal during an asynchronous transaction',async()=>{
  const h=harness(),bridge=new SourceBusinessBridge(h.runtime),data=snapshot([row('remix','historic')],[],{remix:['historic'],cloud:[]});await bridge.syncCooperatively(data);assert.equal(h.state.tasks.length,0);
  await bridge.syncCooperatively(snapshot([row('remix','historic')]));h.beforeTransaction(s=>{s.tasks=[];});await bridge.syncCooperatively(data,{forceVerify:true});assert.equal(h.state.tasks.length,0);
});

test('invalid row falls back per row without sync reads; valid rows survive and original task remains',async()=>{
  const h=harness(),bridge=new SourceBusinessBridge(h.runtime);await bridge.syncCooperatively(snapshot([row('remix','bad')]));
  const original=h.state.tasks[0].id;await bridge.syncCooperatively(snapshot([row('remix','bad',{owner:'not-authorized'}),row('remix','good')]),{forceVerify:true});
  assert.equal(h.state.tasks.length,2);assert.equal(h.state.tasks.find(t=>t.id===original).runtime.state,'running');assert.match(h.state.tasks.find(t=>t.id===original).runtime.localBusiness.issue,/有效业务授权/);assert.equal(bridge.connections.remix.state,'attention');
});

test('uncertain business commit is read back before replay, preserving task and notice identity',async()=>{
  const h=harness(),bridge=new SourceBusinessBridge(h.runtime);h.uncertainCommit();await bridge.syncCooperatively(snapshot([row('remix','render')]),{forceVerify:true});assert.equal(h.state.tasks.length,1);assert.equal(h.state.flowNotifications.length,1);assert.equal(h.state.flowEvents.filter(e=>e.action==='business_connected').length,1);
});

test('a slow asynchronous business snapshot does not occupy the event loop',async()=>{
  const readGate=deferred(),h=harness({readGate}),bridge=new SourceBusinessBridge(h.runtime),pending=bridge.syncCooperatively(snapshot());await nextTurn();assert.equal(h.reads,1);assert.equal(h.writes,0);readGate.resolve();await pending;
});

function creativeHarness(options){
  const h=harness(options),users=people.map(p=>({id:p.number,employeeNo:p.number,name:p.name,active:true,center:p.center}));
  let rows=[{id:'idea',title:'fixture idea',creatorId:'owner',teamLeadReviewerId:'lead',supervisorReviewerId:'manager',status:'generated',version:1,updatedAt:new Date(now).toISOString()}],unavailable=false;
  const reader={read:async(req,source,ids=[])=>{if(unavailable)throw Error('private source failure');return {records:ids.length?rows.filter(r=>ids.includes(r.id)):rows,users,actionsByRecord:{},baselineIds:[],nextCursor:null};}};
  const creative=new FlowCreative(h.runtime,{sourceUrl:()=> 'https://hub.fandow.com/fixture',readSource:reader.read}),bridge=new ProductionCreativeBridge(creative,reader);
  return {...h,base:h,creative,bridge,rows,setRows(value){rows=value;},unavailable(value){unavailable=value;}};
}

test('creative async synchronization preserves source replay and records disappearing tasks without deletion',async()=>{
  const h=creativeHarness();await h.bridge.sync({forceVerify:true});const prior=structuredClone(h.base.state);assert.equal(prior.tasks.length,1);await h.bridge.sync({forceVerify:true});assert.deepEqual(h.base.state,prior);
  h.setRows([]);await h.bridge.sync({forceVerify:true});assert.equal(h.base.state.tasks[0].id,prior.tasks[0].id);assert.equal(h.base.state.tasks[0].runtime.state,'running');assert.match(h.base.state.creativeWatches[0].issue,/暂不可读/);assert.equal(h.bridge.connection.state,'attention');
});

test('creative validation failure and source outage keep prior task and notices; recovery clears issue',async()=>{
  const h=creativeHarness();await h.bridge.sync({forceVerify:true});const original=h.base.state.tasks[0].id,notices=h.base.state.flowNotifications.length;
  h.rows[0].creatorId='unknown';await h.bridge.sync({forceVerify:true});assert.match(h.base.state.creativeWatches[0].issue,/唯一工号/);assert.equal(h.base.state.tasks[0].id,original);assert.equal(h.base.state.flowNotifications.length,notices);
  h.rows[0].creatorId='owner';h.unavailable(true);await h.bridge.sync();assert.equal(h.bridge.connection.state,'unavailable');assert.equal(h.bridge.busy,false);h.unavailable(false);await h.bridge.sync({forceVerify:true});assert.equal(h.bridge.connection.state,'connected');assert.equal(h.base.state.creativeWatches[0].issue,undefined);assert.equal(h.base.state.flowNotifications.length,notices);
});

test('creative failure sync and async entry points share the same idempotent mutation',async()=>{
  const async=creativeHarness(),sync=creativeHarness({syncAllowed:true});await async.bridge.sync();await sync.bridge.sync();const error=Object.assign(Error('source unavailable'),{status:503}),watch={source:'idea',recordId:'idea'};
  await async.creative.failAsync(watch,error);sync.creative.fail(watch,error);const a=async.base.state,b=sync.base.state;assert.equal(a.tasks[0].version,b.tasks[0].version);assert.equal(a.tasks[0].runtime.creative.issue,b.tasks[0].runtime.creative.issue);assert.deepEqual(a.flowEvents.map(e=>e.action),b.flowEvents.map(e=>e.action));const before=structuredClone(a);await async.creative.failAsync(watch,error);assert.deepEqual(async.base.state,before);
});

test('creative transaction rechecks personnel revoked while awaiting storage',async()=>{
  const h=creativeHarness();await h.bridge.sync();const original=h.base.state.tasks[0].id;
  h.base.beforeTransaction(()=>{h.runtime.people=()=>people.filter(p=>p.number!=='manager');});await h.bridge.sync({forceVerify:true});
  assert.equal(h.base.state.tasks[0].id,original);assert.equal(h.base.state.tasks.length,1);assert.equal(h.bridge.connection.state,'attention');assert.match(h.base.state.creativeWatches[0].issue,/有效业务范围|授权|人员|负责人/);
});
