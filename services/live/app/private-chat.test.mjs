import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,createHash} from 'node:crypto';
import {mkdtemp,readFile,rm,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createPrivateChatReader,requiredScopes} from './private-chat-reader.mjs';
import {createPrivateChatAuth} from './private-chat-auth.mjs';
const response=data=>({ok:true,status:200,json:async()=>data});
async function setup(t,options={}){
 const dir=await mkdtemp(join(tmpdir(),'wis-private-chat-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const calls=[];let now=Date.now();
 const config={appId:'cli_test',appSecret:'test_secret',expectedOpenId:'ou_owner',peerOpenId:'ou_peer',ownerLabel:'测试本人',redirectUri:'https://hub.fandow.com/live/api/lifecycle/calendar-auth/callback',storePath:join(dir,'oauth.enc'),encryptionKey:randomBytes(32).toString('base64'),now:()=>now};
 const fetchImpl=async(url,opts={})=>{
   calls.push({url,opts});
   if(url==='https://open.feishu.cn/open-apis/authen/v2/oauth/token')return response({code:0,access_token:'access-secret',refresh_token:'refresh-secret',expires_in:3600,refresh_token_expires_in:86400,scope:options.scope||requiredScopes.join(' ')});
   if(url.endsWith('/user_info'))return response({code:0,data:{open_id:options.openId||'ou_owner'}});
   if(url.includes('/chat_p2p/'))return response({code:0,data:{p2p_chats:options.chats||[{chat_id:'oc_fixed',chatter_id:'ou_peer'}]}});
   if(url.includes('/im/v1/messages?'))return response({code:0,data:{items:options.items||[{message_id:'om_one',chat_id:'oc_fixed',sender:{sender_type:'user',id:'ou_peer'},body:{content:'private message secret'}}]}});
   throw Error('Unexpected API '+url);
 };
 const reader=createPrivateChatReader({...config,fetchImpl});
 const authorize=()=>{const a=reader.begin();return reader.complete({code:'code',state:a.state,cookieState:a.state})};
 return {dir,config,reader,calls,fetchImpl,authorize,advance:ms=>now+=ms};
}
test('OAuth uses exact read scopes and PKCE; stores encrypted credentials only after pair verification',async t=>{
 const x=await setup(t);const a=x.reader.begin(),url=new URL(a.url);
 assert.match(a.state,/^pchat_/);assert.equal(url.searchParams.get('scope'),requiredScopes.join(' '));
 await x.reader.complete({code:'code',state:a.state,cookieState:a.state});
 const body=JSON.parse(x.calls[0].opts.body);assert.equal(url.searchParams.get('code_challenge'),createHash('sha256').update(body.code_verifier).digest('base64url'));
 const disk=await readFile(x.config.storePath,'utf8');assert.ok(!disk.includes('access-secret')&&!disk.includes('private message secret'));
 assert.equal((await x.reader.status()).authorized,true);
 assert.deepEqual(JSON.parse(x.calls.find(c=>c.url.includes('/chat_p2p/')).opts.body),{chatter_ids:['ou_peer']});
 const query=new URL(x.calls.find(c=>c.url.includes('/messages?')).url).searchParams;assert.equal(query.get('container_id'),'oc_fixed');assert.equal(query.get('page_size'),'1');assert.equal(+query.get('end_time')-+query.get('start_time'),7*86400);
 assert.ok(!JSON.stringify(await x.reader.verify()).includes('private message secret'));
 await assert.rejects(x.reader.complete({code:'code',state:a.state,cookieState:a.state}),/已过期/);
});
test('cookie mismatch and expired state never exchange tokens',async t=>{
 const x=await setup(t);let a=x.reader.begin();await assert.rejects(x.reader.complete({code:'code',state:a.state,cookieState:'other'}));
 a=x.reader.begin();x.advance(600001);await assert.rejects(x.reader.complete({code:'code',state:a.state,cookieState:a.state}));assert.equal(x.calls.length,0);
});
test('wrong Feishu identity cannot read the pair or save credentials',async t=>{
 const x=await setup(t,{openId:'ou_other'});await assert.rejects(x.authorize(),/不是指定/);assert.equal(x.calls.length,2);assert.deepEqual(await readdir(x.dir),[]);
});
test('missing p2p scope cannot save credentials',async t=>{
 const x=await setup(t,{scope:'im:message:readonly offline_access'});await assert.rejects(x.authorize(),/权限/);assert.deepEqual(await readdir(x.dir),[]);
});
test('ambiguous P2P lookup is rejected before message access',async t=>{
 const x=await setup(t,{chats:[{chat_id:'oc_a'},{chat_id:'oc_b'}]});await assert.rejects(x.authorize(),/唯一/);assert.ok(!x.calls.some(c=>c.url.includes('/messages?')));
});
test('wrong pair message cannot save credentials',async t=>{
 const x=await setup(t,{items:[{chat_id:'oc_other'}]});await assert.rejects(x.authorize(),/不匹配/);assert.deepEqual(await readdir(x.dir),[]);
});
test('third participant is rejected',async t=>{
 const x=await setup(t,{items:[{chat_id:'oc_fixed',sender:{sender_type:'user',id:'ou_other'}}]});await assert.rejects(x.authorize(),/不匹配/);
});
test('empty recent history still proves readable pair',async t=>{
 const x=await setup(t,{items:[]});await x.authorize();assert.equal((await x.reader.verify()).sampleAvailable,false);
});
test('same-party setting and missing key disable authorization',async t=>{
 const x=await setup(t);for(const patch of [{encryptionKey:''},{peerOpenId:'ou_owner'}]){const r=createPrivateChatReader({...x.config,...patch});assert.equal((await r.status()).configured,false);assert.throws(()=>r.begin())}
});
test('credential ciphertext is bound to the exact participant pair',async t=>{
 const x=await setup(t);await x.authorize();const other=createPrivateChatReader({...x.config,peerOpenId:'ou_different'});await assert.rejects(other.status(),/无法读取/);
});
test('concurrent verifies coalesce refresh and persist rotating credential',async t=>{
 const x=await setup(t);await x.authorize();x.advance(3400000);await Promise.all([x.reader.verify(),x.reader.verify()]);
 assert.equal(x.calls.filter(c=>c.url.endsWith('/oauth/token')).length,2);assert.equal((await x.reader.status()).authorized,true);
});
const actors={'FD-1':{name:'Owner',openId:'ou_owner',peerOpenId:'ou_peer'}};
const auth={ok:true,mode:'central',user:{number:'FD-1',name:'Owner'}};
function handlerSetup({enabled=true,current=auth}={}){
 const log=[];const reader={status:async()=>({configured:true,authorized:false}),begin:()=>({state:'pchat_test',url:'https://accounts.feishu.cn/auth'}),complete:async input=>log.push(input),verify:async()=>({verified:true})};
 const handler=createPrivateChatAuth({actors,readers:{'FD-1':reader},basePath:'/live',publicOrigin:'https://hub.fandow.com',enabled,currentAuth:async()=>current,verifyActor:async()=>{},json:(r,status,data)=>{r.status=status;r.data=data}});
 const req={method:'POST',headers:{origin:'https://hub.fandow.com','x-requested-with':'XMLHttpRequest'}};
 const res=()=>({headers:{},setHeader(k,v){this.headers[k]=v},writeHead(status,headers){this.status=status;Object.assign(this.headers,headers)},end(s){this.html=s}});
 return {handler,req,res,log};
}
test('non-owner and degraded or spoofed OA identities cannot start',async()=>{
 const x=handlerSetup();for(const a of [{...auth,user:{number:'FD-other',name:'Owner'}},{...auth,degraded:true},{...auth,user:{number:'FD-1',name:'Wrong'}},{...auth,mode:'internal'}]){const r=x.res();await x.handler.handleApi(x.req,r,'/api/lifecycle/private-chat-auth/start',a);assert.equal(r.status,403)}
});
test('foreign or missing browser origin blocks start',async()=>{
 const x=handlerSetup();for(const origin of ['https://evil.test',undefined]){const r=x.res();await x.handler.handleApi({...x.req,headers:{...x.req.headers,origin}},r,'/api/lifecycle/private-chat-auth/start',auth);assert.equal(r.status,403)}
});
test('disabled gate blocks start',async()=>{const x=handlerSetup({enabled:false}),r=x.res();await x.handler.handleApi(x.req,r,'/api/lifecycle/private-chat-auth/start',auth);assert.equal(r.status,423)});
test('cross-site callback stays bound to original actor without OA cookies; calendar callback untouched',async()=>{
 const x=handlerSetup({current:{...auth,user:{number:'FD-other',name:'Other'}}}),r=x.res();await x.handler.handleApi(x.req,r,'/api/lifecycle/private-chat-auth/start',auth);
 assert.match(r.headers['Set-Cookie'],/HttpOnly; Secure; SameSite=Lax/);
 assert.equal(await x.handler.handleCallback({method:'GET',headers:{}},x.res(),new URL('https://hub.fandow.com/cb?state=calendar_state')),false);
 const response=x.res();await x.handler.handleCallback({method:'GET',headers:{cookie:'live_private_chat_oauth_state=pchat_test'}},response,new URL('https://hub.fandow.com/cb?state=pchat_test&code=code'));assert.equal(response.status,200);assert.equal(x.log.length,1);assert.equal(x.log[0].cookieState,'pchat_test');
});
test('unknown private callback gets private recovery page; does not fall through',async()=>{
 const x=handlerSetup(),r=x.res();assert.equal(await x.handler.handleCallback({method:'GET',headers:{}},r,new URL('https://hub.fandow.com/cb?state=pchat_expired')),true);assert.equal(r.status,409);assert.match(r.html,/重新发起/);
});
test('non-owner status explains eligibility without leaking stored grants',async()=>{const x=handlerSetup(),r=x.res();await x.handler.handleApi({method:'GET',headers:{}},r,'/api/lifecycle/private-chat-auth/status',{...auth,user:{number:'other'}});assert.equal(r.data.eligible,false);assert.equal(r.data.authorization,undefined)});

test('bounded history reader never accepts an arbitrary chat or participant',async t=>{
 const x=await setup(t);await x.authorize();const endTime=Math.floor(x.config.now()/1000);
 const result=await x.reader.readMessages({startTime:endTime-86400,endTime});assert.equal(result.complete,true);assert.equal(result.items.length,1);
 const last=x.calls.at(-1);assert.equal(new URL(last.url).searchParams.get('container_id'),'oc_fixed');
});
test('oversized history window is rejected before outbound access',async t=>{
 const x=await setup(t);const endTime=Math.floor(x.config.now()/1000);await assert.rejects(x.reader.readMessages({startTime:endTime-121*86400,endTime}));assert.equal(x.calls.length,0);
});
test('history pagination validates every returned participant',async t=>{
 const x=await setup(t);await x.authorize();
 const reader=createPrivateChatReader({...x.config,fetchImpl:async(url,opts)=>url.includes('/messages?')?response({code:0,data:{items:[{chat_id:'oc_fixed',sender:{sender_type:'user',id:'ou_stranger'}}]}}):x.fetchImpl(url,opts)});
 const endTime=Math.floor(x.config.now()/1000);await assert.rejects(reader.readMessages({startTime:endTime-86400,endTime}),/不匹配/);
});
test('repeated cursor fails instead of publishing partial scores',async t=>{
 const x=await setup(t);await x.authorize();
 const reader=createPrivateChatReader({...x.config,fetchImpl:async(url,opts)=>url.includes('/messages?')?response({code:0,data:{items:[],has_more:true,page_token:'same'}}):x.fetchImpl(url,opts)});
 const endTime=Math.floor(x.config.now()/1000);await assert.rejects(reader.readMessages({startTime:endTime-86400,endTime}),/分页/);
});
