import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, mkdtemp, writeFile, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {setImmediate as nextTurn} from 'node:timers/promises';
import vm from 'node:vm';
import {OrganizationEntryStore, createOrganizationEntryReader, organizationEntryAllowed} from './organization-entry.mjs';

const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
const entryData=(entries={})=>({schema:1,version:1,entries,audits:[]});
const server=await readFile(new URL('./server.mjs',import.meta.url),'utf8');
const between=(start,end)=>server.slice(server.indexOf(start),server.indexOf(end));
const candidateCode=between('function normalizedPreviewMemberQuery','function workspacePolicyFor')+between('async function currentPreviewCandidates','function leadershipCentersFor');
const sessionCode=between('function transientAuthorityFailure','function dashboardSelectedDate');

function runtime({readAsync,authority,profiles=[]}={}){
  let reads=0,authorityCalls=0;
  const store={allowed(){throw Error('sync permission reads forbidden');},async readAsync(){reads++;return readAsync?readAsync(reads):entryData();}};
  const context={URL,encodeURIComponent,Date,console:{warn(){}},organizationEntryAllowed,
    organizationEntryForRequest:createOrganizationEntryReader(store),organizationEntryStore:store,
    workspacePolicySource:{version:'test'},previewMemberDirectory:[{userNumber:'FD-ONE',realName:'人员一',department:'品牌营销部',center:'视频中心',mappedRole:'manager',allowedModules:['data-dashboard']}],
    workspacePolicyFor(payload){return {role:payload.permissions?.manage_permissions?'director':'manager',center:payload.user.center,can_view_organization_dashboard:true,allowed_modules:payload.access?.allowed_modules||[],policy_source:{version:'unchanged'},module_policy_state:'unchanged'};},
    sparkAccessFor(){return {enabled:false};},
    async callAuthority(request,path){authorityCalls++;return path.startsWith('/admin/')?{status:200,payload:{items:profiles}}:authority?authority(request):{status:200,payload:{user:{number:'FD-ONE',realName:'人员一',department:'品牌营销部'},permissions:{manage_permissions:false},access:{allowed_modules:['data-dashboard'],retained:'keep'},other:'keep'}};},
    sessionCache:new Map(),sessionInflight:new Map(),requestAuthoritySessions:new WeakMap(),sessionCacheEpoch:0,sessionCacheLimit:256,sessionCacheTtlMs:15000,sessionStaleTtlMs:120000,
    sessionCacheKey:r=>r.token,enforceConfirmedAdmission:value=>value,
  };
  vm.createContext(context);vm.runInContext(candidateCode+sessionCode,context);
  return {context,store,get reads(){return reads;},get authorityCalls(){return authorityCalls;}};
}

test('async entry store preserves validation, missing-file defaults and closed failure semantics',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'entry-async-'));
  try{
    const file=join(dir,'entry.json'),store=new OrganizationEntryStore(file);
    assert.equal((await store.readAsync()).version,0);assert.equal(organizationEntryAllowed(await store.readAsync(),{number:'FD-ONE'}),true);
    const data=entryData({'FD-ONE':{enabled:false},'FD-TWO':{enabled:true}});await writeFile(file,JSON.stringify(data));assert.deepEqual(await store.readAsync(),store.read());
    assert.equal(organizationEntryAllowed(await store.readAsync(),{userNumber:'fd-one'}),false);
    for(const bad of ['broken',JSON.stringify({...data,schema:2}),JSON.stringify({...data,entries:{bad:{enabled:'true'}}})]){
      await writeFile(file,bad);await assert.rejects(store.readAsync(),error=>error.status===503);
      const read=createOrganizationEntryReader(store);assert.equal(organizationEntryAllowed(await read({}),{number:'FD-TWO'}),false);
    }
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('delayed request-level read yields the event loop and shares only within one request',async()=>{
  const gate=deferred();let reads=0;const read=createOrganizationEntryReader({async readAsync(){reads++;await gate.promise;return entryData();}}),request={};
  const pending=Promise.all(Array.from({length:200},()=>read(request)));await nextTurn();assert.equal(reads,1);gate.resolve();await pending;
  await read({});assert.equal(reads,2,'new requests must not share a permission TTL');
});

test('failed request is denied throughout; the next request can recover immediately',async()=>{
  let failed=true;const read=createOrganizationEntryReader({async readAsync(){if(failed)throw Error('unavailable');return entryData();}}),first={};
  assert.equal(organizationEntryAllowed(await read(first),{number:'FD-ONE'}),false);failed=false;
  assert.equal(organizationEntryAllowed(await read(first),{number:'FD-ONE'}),false);
  assert.equal(organizationEntryAllowed(await read({}),{number:'FD-ONE'}),true);
});

test('candidate list checks hundreds of members against one request snapshot and no sync reader',async()=>{
  const profiles=Array.from({length:400},(_,i)=>({user_number:'FD-'+i,real_name:'人员'+i,department:'品牌营销部',center:'视频中心',effective_modules:['data-dashboard'],login_active:true}));
  const h=runtime({profiles,readAsync:async()=>entryData({'FD-8':{enabled:false}})}),request={token:'admin'};
  const items=await h.context.currentPreviewCandidates(request);
  assert.equal(items.length,401);assert.equal(h.reads,1);assert.equal(items.find(x=>x.userNumber==='FD-8').organizationEntryAllowed,false);
  assert.equal(items.find(x=>x.userNumber==='FD-9').organizationEntryAllowed,true);
  await h.context.currentPreviewCandidates(request,'人员');assert.equal(h.reads,1);
});

test('candidate failure remains closed without removing existing highest-access behavior',async()=>{
  const h=runtime({profiles:[{user_number:'FD-ADMIN',real_name:'管理员',highest_business_access:true}],readAsync:async()=>{throw Error('unavailable');}});
  const items=await h.context.currentPreviewCandidates({token:'admin'});assert.equal(items.find(x=>x.userNumber==='FD-ONE').organizationEntryAllowed,false);
  assert.equal(items.find(x=>x.userNumber==='FD-ADMIN').organizationEntryAllowed,true);
});

test('cached authority session reprojects fresh entry grants on every request and preserves other fields',async()=>{
  let enabled=true;const h=runtime({readAsync:async()=>entryData({'FD-ONE':{enabled}})});
  const display=()=>({token:'same',method:'GET',url:'/api/session'});
  const first=await h.context.currentSession(display());assert.equal(first.payload.workspace.can_view_organization_dashboard,true);
  enabled=false;const second=await h.context.currentSession(display());assert.equal(second.payload.workspace.can_view_organization_dashboard,false);
  assert.equal(h.authorityCalls,1);assert.equal(h.reads,2);assert.equal(second.payload.other,'keep');assert.equal(second.payload.access.retained,'keep');
  assert.deepEqual(second.payload.user,first.payload.user);assert.deepEqual(second.payload.permissions,first.payload.permissions);
  assert.equal(first.payload.workspace.can_view_organization_dashboard,true,'a later request must not mutate prior response');
  assert.equal(h.context.sessionCache.get('same').value.payload.workspace,undefined,'entry grants never enter the authority cache');
  enabled=true;const third=await h.context.currentSession(display());assert.equal(third.payload.workspace.can_view_organization_dashboard,true);assert.equal(h.reads,3);
});

test('session and candidate projection in one request share one entry read',async()=>{
  const h=runtime(),request={token:'same'};await h.context.currentSession(request);await h.context.currentPreviewCandidates(request);assert.equal(h.reads,1);
});

test('same-token concurrent authority requests still use independent entry snapshots',async()=>{
  const gate=deferred(),h=runtime({authority:async()=>{await gate.promise;return {status:200,payload:{user:{number:'FD-ONE'},permissions:{},access:{allowed_modules:['data-dashboard']}}};},readAsync:async count=>entryData({'FD-ONE':{enabled:count===1}})});
  const pending=Promise.all([h.context.currentSession({token:'same'}),h.context.currentSession({token:'same'})]);await nextTurn();assert.equal(h.authorityCalls,1);gate.resolve();
  const values=await pending;assert.equal(h.reads,2);assert.deepEqual(values.map(x=>x.payload.workspace.can_view_organization_dashboard),[true,false]);
});

test('authority rejection does not read entry permissions or become a valid session',async()=>{
  const h=runtime({authority:async()=>({status:403,payload:{detail:'denied'}})});assert.equal((await h.context.currentSession({token:'denied'})).status,403);assert.equal(h.reads,0);
});
