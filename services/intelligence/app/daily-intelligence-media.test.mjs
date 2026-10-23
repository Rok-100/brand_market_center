import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {prepareMaterialPreviews} from './daily-intelligence-media.mjs';
test('cover previews upload once, cache per app and never send radar credentials to public image hosts',async t=>{
  const db=new DatabaseSync(':memory:');t.after(()=>db.close());const calls=[];
  const report={materials:{status:'ready',items:[{id:'v',platform:'douyin',raw:{cover_url:'https://oss.fandow.com/v.jpg'}}]}};
  const options={db,config:{baseUrl:'http://radar.invalid',apiKey:'secret-fixture'},appId:'app',tenantToken:async()=>'test-bot',fetchImpl:async(url,opts)=>{
    calls.push({url:String(url),headers:opts.headers});
    if(String(url).includes('/images')){assert.equal(opts.body.get('image_type'),'message');return Response.json({code:0,data:{image_key:'img_fixture'}});}
    return new Response(new Uint8Array([1,2,3]),{headers:{'content-type':'image/jpeg'}});
  }};
  const result=await prepareMaterialPreviews(report,options);assert.equal(result.images['douyin:v'],'img_fixture');assert.equal(calls.length,2);assert.deepEqual(calls[0].headers,{});
  assert.equal((await prepareMaterialPreviews(report,options)).results[0].state,'cached');assert.equal(calls.length,2);
});
test('untrusted cover origins and unavailable upload permissions degrade to links without failing report',async t=>{
  const db=new DatabaseSync(':memory:');t.after(()=>db.close());let calls=0;
  const report={materials:{status:'ready',items:[{id:'ssrf',platform:'douyin',raw:{cover_url:'http://127.0.0.1/private'}},{id:'no-scope',platform:'douyin',raw:{cover_url:'https://oss.fandow.com/v.jpg'}}]}};
  const result=await prepareMaterialPreviews(report,{db,config:{baseUrl:'http://radar.invalid',apiKey:'fixture'},appId:'app',tenantToken:async()=>'fake',fetchImpl:async(url)=>{calls++;return String(url).includes('/images')?Response.json({code:99991672},{status:403}):new Response('image',{headers:{'content-type':'image/jpeg'}})}});
  assert.deepEqual(result.images,{});assert.equal(calls,2);assert.equal(result.results[0].state,'link_only');assert.equal(result.results[1].state,'upload_failed');
});
