import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createAnchorStatusHttp} from './anchor-status-http.mjs';

test('actual HTTP login, role and same-origin boundaries; caller token only reaches transient work',async t=>{
  let changes=0,workOptions;
  const service={status:()=>({enabled:true}),summary:()=>({evaluated:0}),list:()=>[],trends:()=>[],model:{models:async()=>[]},detail:()=>({id:'a'}),scan:async()=>{changes++;return{added:1};},work:async options=>{workOptions=options;},retry:()=>{changes++;return{};},reviewIdentity:async()=>{changes++;return{};},task:()=>{changes++;}};
  const json=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
  const readJson=async req=>{let data='';for await(const chunk of req)data+=chunk;return JSON.parse(data||'{}');};
  const handler=createAnchorStatusHttp({service,readJson,json,tokenFromRequest:headers=>headers['x-fixture-token']||''});
  const server=createServer((req,res)=>handler(req,res,new URL(req.url,'http://localhost'),{
    ok:Boolean(req.headers['x-fixture-user']),user:{number:req.headers['x-fixture-user']},permissions:{super_admin:req.headers['x-fixture-user']==='ADMIN'},
  }));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const url='http://127.0.0.1:'+server.address().port+'/api/lifecycle/status-warning';
  assert.equal((await fetch(url+'/status')).status,401);
  const normal={'x-fixture-user':'ORDINARY'};assert.equal((await fetch(url+'/evaluations',{headers:normal})).status,200);
  const post=(path,headers={},body={})=>fetch(url+path,{method:'POST',headers:{'x-fixture-user':'ADMIN','Content-Type':'application/json','X-Requested-With':'XMLHttpRequest',Origin:new URL(url).origin,...headers},body:JSON.stringify(body)});
  assert.equal((await post('/scan',normal)).status,403);assert.equal((await post('/scan',{Origin:'https://evil.invalid'})).status,403);
  assert.equal((await post('/scan',{'sec-fetch-site':'cross-site'})).status,403);assert.equal(changes,0);
  assert.equal((await post('/scan')).status,200);assert.equal(changes,1);
  assert.equal((await post('/process')).status,401);
  assert.equal((await post('/process',{'x-fixture-token':'session-in-memory'},{model:'qwen3.5-omni-flash'})).status,202);
  assert.equal(workOptions.token,'session-in-memory');assert.equal(workOptions.selectedModel,'qwen3.5-omni-flash');
  assert.equal((await post('/tasks/a',{'x-fixture-user':'FD-027097'},{action:'complete',note:'完成'})).status,200);
});

test('read-only deployment rejects writes even for administrators',async()=>{
  let status,body;const handler=createAnchorStatusHttp({service:{},readOnly:true,json:(res,s,b)=>{status=s;body=b;}});
  await handler({method:'POST',headers:{}},{},new URL('http://localhost/api/lifecycle/status-warning/scan'),{ok:true,permissions:{super_admin:true}});
  assert.equal(status,423);assert.equal(body.code,'read_only');
});

test('status displays the current authenticated user, independently of the background authorization owner',async()=>{
  let body;const handler=createAnchorStatusHttp({service:{status:()=>({automation:{owner:'OTHER'}})},json:(_res,_status,value)=>{body=value;}});
  for(const user of [{name:'用户甲',number:'FD-001'},{name:'旧名字',realName:'用户乙',number:'FD-002'}]){
    await handler({method:'GET'},{},new URL('https://fixture/api/lifecycle/status-warning/status'),{ok:true,user,permissions:{}});
    assert.deepEqual(body.data.currentUser,{name:user.realName||user.name,number:user.number});assert.equal(body.data.canManage,false);
  }
});

test('list and detail return without waiting for a slow directory refresh',async()=>{
  let refreshes=0,response;
  const service={refreshEmployeeNumbers:()=>{refreshes++;return new Promise(()=>{});},list:()=>[{id:'a',employeeNumber:'FD-001'}],detail:()=>({id:'a',employeeNumber:'FD-001'})};
  const handler=createAnchorStatusHttp({service,json:(_res,status,body)=>{response={status,body};}});
  const read=path=>Promise.race([handler({method:'GET'},{},new URL('http://localhost/api/lifecycle/status-warning'+path),{ok:true}),new Promise((_,reject)=>{const timer=setTimeout(()=>reject(Error('Directory blocked response')),100);timer.unref();})]);
  await read('/evaluations');assert.equal(response.status,200);assert.equal(response.body.data[0].employeeNumber,'FD-001');assert.equal(refreshes,1);
  await read('/evaluations/a');assert.equal(response.body.data.employeeNumber,'FD-001');assert.equal(refreshes,1);
});

test('background authorization is an authorized same-origin write; only the enable operation receives OA',async()=>{
  const calls=[];let status,body;
  const service={configureAutomation:async options=>{calls.push(options);return {enabled:options.action==='enable'};}};
  const handler=createAnchorStatusHttp({service,readJson:async req=>req.input,tokenFromRequest:headers=>headers['x-fixture-token']||'',json:(_r,s,b)=>{status=s;body=b;}});
  const url=new URL('https://fixture/api/lifecycle/status-warning/automation');
  const request={method:'POST',headers:{host:'fixture',origin:'https://fixture','x-requested-with':'XMLHttpRequest','content-type':'application/json','x-fixture-token':'fixture-token'},input:{action:'enable'}};
  await handler(request,{},url,{ok:true,user:{number:'ORDINARY'},permissions:{}});assert.equal(status,403);assert.equal(calls.length,0);
  const admin={ok:true,user:{number:'FD-FIXTURE'},permissions:{operation_admin:true}};
  await handler(request,{},url,admin);assert.equal(status,200);assert.equal(calls[0].token,'fixture-token');assert.equal(calls[0].actor,'FD-FIXTURE');assert.ok(!JSON.stringify(body).includes('fixture-token'));
  request.input={action:'pause'};await handler(request,{},url,admin);assert.equal(calls[1].token,'');assert.equal(body.data.enabled,false);
  request.headers.origin='https://other';await handler(request,{},url,admin);assert.equal(status,403);assert.equal(calls.length,2);
});
