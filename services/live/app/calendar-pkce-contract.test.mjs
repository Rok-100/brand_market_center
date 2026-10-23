import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCalendarUserReader} from './calendar-user-reader.mjs';
const scopes='calendar:calendar:read calendar:calendar.event:read offline_access';
const v2='https://open.feishu.cn/open-apis/authen/v2/oauth/token';
const v3='https://accounts.feishu.cn/oauth/v3/token';
const reply=(data,status=200)=>({ok:status===200,status,json:async()=>data});

// Feishu obtain-oauth-code.md explicitly pairs authorize v1 PKCE with token v2.
test('documented v1 authorize + v2 JSON exchange preserves S256 and v3 refresh',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'calendar-pkce-contract-'));
 let now=1000000,challenge,exchanges=0,refreshes=0;
 try{
  const reader=createCalendarUserReader({appId:'cli_fixture',appSecret:'fixture-secret',calendarId:'calendar_fixture',expectedOpenId:'ou_fixture',redirectUri:'https://example.com/callback',storePath:join(dir,'oauth.enc'),encryptionKey:randomBytes(32).toString('base64'),now:()=>now,
   diagnostic:()=>{},fetchImpl:async(url,options)=>{
    if(url===v2||url===v3){
     const json=options.headers['Content-Type'].startsWith('application/json');
     const body=json?JSON.parse(options.body):Object.fromEntries(new URLSearchParams(options.body));
     if(body.grant_type==='authorization_code'){
      exchanges++;
      if(url!==v2)return reply({code:20049},400);
      assert.equal(json,true);
      assert.equal(body.client_id,'cli_fixture');assert.equal(body.client_secret,'fixture-secret');
      assert.equal(body.redirect_uri,'https://example.com/callback');assert.equal(body.scope,scopes);
      assert.match(body.code_verifier,/^[A-Za-z0-9._~-]{43,128}$/);
      assert.equal(createHash('sha256').update(body.code_verifier).digest('base64url'),challenge);
     }else{
      refreshes++;assert.equal(url,v3);assert.equal(json,false);
      assert.equal(body.grant_type,'refresh_token');assert.equal(body.refresh_token,'fixture-refresh');
      assert.equal(body.code_verifier,undefined);
     }
     return reply({code:0,access_token:'fixture-access',refresh_token:'fixture-refresh',expires_in:7200,refresh_token_expires_in:604800,scope:scopes});
    }
    if(url.endsWith('/user_info'))return reply({code:0,data:{open_id:'ou_fixture'}});
    if(url.endsWith('/calendar_fixture'))return reply({code:0,data:{calendar:{role:'reader'}}});
    return reply({code:0,data:{items:[]}});
   }});
  const attempt=reader.begin(),url=new URL(attempt.url);challenge=url.searchParams.get('code_challenge');
  assert.equal(url.origin+url.pathname,'https://accounts.feishu.cn/open-apis/authen/v1/authorize');
  assert.equal(url.searchParams.get('code_challenge_method'),'S256');
  assert.equal((await reader.complete({code:'fixture-code',state:attempt.state,cookieState:attempt.state})).authorized,true);
  assert.equal(exchanges,1);now+=7000000;
  await reader.get('/calendar/v4/calendars/calendar_fixture/events');assert.equal(refreshes,1);
 }finally{await rm(dir,{recursive:true,force:true})}
});
test('PKCE rejection is terminal: never remove verifier or retry another endpoint',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'calendar-pkce-rejection-'));let calls=0;
 try{
  const reader=createCalendarUserReader({appId:'cli_fixture',appSecret:'fixture-secret',calendarId:'calendar_fixture',expectedOpenId:'ou_fixture',redirectUri:'https://example.com/callback',storePath:join(dir,'oauth.enc'),encryptionKey:randomBytes(32).toString('base64'),diagnostic:()=>{},fetchImpl:async()=>{calls++;return reply({code:20049},400)}});
  const attempt=reader.begin();await assert.rejects(reader.complete({code:'fixture-code',state:attempt.state,cookieState:attempt.state}),{code:'calendar_oauth_exchange_failed'});
  assert.equal(calls,1);assert.equal((await reader.status()).authorized,false);
 }finally{await rm(dir,{recursive:true,force:true})}
});
