import test from 'node:test';
import assert from 'node:assert/strict';
import {createCompanyAi, oaTokenFromRequest, COMPANY_AI_MODEL} from './company-ai.mjs';

const catalog = () => Response.json({code:0,data:{models:[{model_name:COMPANY_AI_MODEL}]}});
const chunk = (delta, finish_reason = null) => 'data: '+JSON.stringify({choices:[{index:0,delta,finish_reason}]})+'\r\n\r\n';
function stream(text) {
  const bytes = new TextEncoder().encode(text); let offset=0;
  return new Response(new ReadableStream({pull(controller){
    if(offset===bytes.length){controller.close();return;}
    controller.enqueue(bytes.slice(offset,offset+3));offset+=Math.min(3,bytes.length-offset);
  }}),{headers:{'Content-Type':'text/event-stream'}});
}

test('OA credentials are per caller; split UTF-8 SSE is assembled without reasoning',async()=>{
  const tokens=[];
  const client=createCompanyAi({fetchImpl:async(url,options)=>{
    assert.equal(options.redirect,'manual');assert.equal(options.headers.sys_name,'brand-market-center');tokens.push(options.headers.Authorization);
    if(url.endsWith('/models'))return catalog();
    const body=JSON.parse(options.body);assert.equal(body.extra_body.thinking.type,'disabled');assert.equal(body.stream,true);assert.equal(body.model,COMPANY_AI_MODEL);
    return stream(': keepalive\r\n\r\n'+chunk({reasoning:'PRIVATE_REASONING'})+chunk({content:'{"text":"中文'})+chunk({content:'稿件"}'},'stop')+'data: [DONE]\r\n\r\n');
  }});
  assert.deepEqual(await client.generate('instruction',{}, {token:'caller-a'}),{text:'中文稿件'});
  assert.deepEqual(await client.generate('instruction',{}, {token:'caller-b'}),{text:'中文稿件'});
  assert.deepEqual(tokens,['Bearer caller-a','Bearer caller-a','Bearer caller-b','Bearer caller-b']);
});
test('missing OA session never calls upstream',async()=>{
  const client=createCompanyAi({fetchImpl:()=>{throw Error('must not call')}});
  await assert.rejects(client.generate('x',{}),{status:401});
  assert.equal(oaTokenFromRequest({cookie:'authorization=Bearer%20oa-user; other=x'}),'oa-user');
  assert.equal(oaTokenFromRequest(new Headers({'x-oa-token':'Bearer direct'})),'direct');
  assert.equal(oaTokenFromRequest({cookie:'authorization=%broken'}),'');
});
for(const [name,body] of [
  ['disconnected stream',chunk({content:'{"ok":true}'},'stop')],
  ['truncated generation',chunk({content:'{"ok":true}'},'length')+'data: [DONE]\n\n'],
  ['upstream error event','data: {"error":{"message":"secret-fixture"}}\n\n'],
  ['bad generated JSON',chunk({content:'broken'},'stop')+'data: [DONE]\n\n'],
])test(name+' cannot become a draft',async()=>{
  const client=createCompanyAi({fetchImpl:async url=>url.endsWith('/models')?catalog():stream(body)});
  await assert.rejects(client.generate('x',{}, {token:'fixture'}),e=>e.status===502&&!e.message.includes('secret-fixture'));
});
test('expired login and unavailable model fail before generation',async()=>{
  for(const status of [401,403]){
    const client=createCompanyAi({fetchImpl:async()=>new Response('secret-fixture',{status})});
    await assert.rejects(client.generate('x',{}, {token:'fixture'}),{status:401});
  }
  let calls=0;const client=createCompanyAi({fetchImpl:async()=>{calls++;return Response.json({code:0,data:{models:[]}})}});
  await assert.rejects(client.generate('x',{}, {token:'fixture'}),{status:503});assert.equal(calls,1);
});
