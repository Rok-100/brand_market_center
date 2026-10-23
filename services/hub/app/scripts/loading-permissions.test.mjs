import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {configurationAccess,readConfigurationGrantsAsync} from '../flow-configuration-access.mjs';
import {createFlowHandler} from '../flow-http.mjs';

const grant={id:'test-grant',number:'TEST',active:true,scope:'department',capabilities:['view','edit','publish']};
const base={user:{number:'TEST'},modules:['workflow-engine'],enabled:false,canManage:false,department:false};
test('async authority grant reads preserve capability and observe revocation on the next request',async()=>{
 let current=[grant],reads=0;
 const read=async()=>{reads++;return JSON.stringify({schema:'wis.flow-configuration-grants.v1',grants:current});};
 let access=configurationAccess(base,await readConfigurationGrantsAsync('test',read));
 assert.equal(access.canConfigure,true);assert.equal(access.configurationOnly,true);assert.equal(access.canManage,false);
 current=[];access=configurationAccess(base,await readConfigurationGrantsAsync('test',read));
 assert.equal(access.canConfigure,false);assert.equal(access.enabled,false);assert.equal(reads,2);
});
test('corrupt, unavailable and wrong-schema grants fail closed',async()=>{
 for(const read of [async()=>'{',async()=>{throw Error('unavailable');},async()=>JSON.stringify({schema:'wrong',grants:[grant]})]){
  assert.deepEqual(await readConfigurationGrantsAsync('test',read),[]);
 }
});
test('slow grants do not block event-loop work and do not bypass module or inactive restrictions',async()=>{
 let complete=false;
 const pending=readConfigurationGrantsAsync('test',async()=>{await delay(30);return JSON.stringify({schema:'wis.flow-configuration-grants.v1',grants:[grant]});}).then(x=>{complete=true;return x;});
 await delay(0);assert.equal(complete,false);
 const grants=await pending;
 assert.equal(configurationAccess({...base,modules:[]},grants).canConfigure,false);
 assert.equal(configurationAccess(base,grants,{inactive:true}).enabled,false);
});
test('flow route awaits its asynchronous permission decision before exposing data',async()=>{
 let release;const decision=new Promise(r=>{release=r;});let sent;
 const handler=createFlowHandler({currentSession:async()=>({status:200,payload:{}}),accessFor:()=>decision,
  previewFor:()=>({active:false}),sendJson:(_r,status,payload)=>{sent={status,payload};}});
 const work=handler({method:'GET',headers:{}},{},new URL('http://test/api/flows/people'));
 await delay(0);assert.equal(sent,undefined);
 release({enabled:false});await work;assert.equal(sent.status,403);
});
