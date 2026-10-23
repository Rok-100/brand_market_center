import test from 'node:test';
import assert from 'node:assert/strict';
import {createCommunicationAi} from './communication-ai.mjs';
test('communication uses company models with caller OA and no fixed provider key', async()=>{
 const client=await createCommunicationAi({fetchImpl:async(url,o)=>{
  assert.equal(o.headers.Authorization,'Bearer caller');assert.equal(o.headers.sys_name,'brand-market-center');
  return url.endsWith('/models')?Response.json({code:0,data:{models:[{model_name:'deepseek-flash'}]}}):Response.json({choices:[{message:{content:'{"stages":{}}'},finish_reason:'stop'}]});
 }});
 assert.equal(client.configured,true);assert.equal(client.model,'deepseek-flash');
 assert.deepEqual(await client.generate('instruction',{},8192,{token:'caller'}),{stages:{}});
 await assert.rejects(client.generate('instruction',{}),{status:401});
});
