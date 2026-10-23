import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createAnchorStatusHttp} from './anchor-status-http.mjs';
test('贡献值按姓名合并；普通用户可读取，不可同步',async()=>{
 let response,writes=0;const contribution={snapshot:async()=>({byName:{'甲':{label:'101.0%',tone:'green'}},sheetTitle:'10月'}),sync:async()=>{writes++;return{};},preview:async()=>({plan:[]})};
 const handler=createAnchorStatusHttp({service:{list:()=>[{name:'甲'},{name:'乙'}]},contribution,json:(_r,status,body)=>{response={status,body};},readJson:async()=>({})});
 const url=path=>new URL('http://localhost/api/lifecycle/status-warning'+path);
 await handler({method:'GET'},{},url('/evaluations'),{ok:true});assert.equal(response.body.data[0].contribution.label,'101.0%');assert.equal(response.body.data[1].contribution,null);
 await handler({method:'POST',headers:{}},{},url('/contribution-sync'),{ok:true});assert.equal(response.status,403);assert.equal(writes,0);
 await handler({method:'GET'},{},url('/contribution-preview'),{ok:true});assert.equal(response.status,403);
 await handler({method:'POST',headers:{host:'localhost',origin:'http://localhost','x-requested-with':'XMLHttpRequest','content-type':'application/json'}},{},url('/contribution-sync'),{ok:true,permissions:{super_admin:true}});assert.equal(response.status,200);assert.equal(writes,1);
});
