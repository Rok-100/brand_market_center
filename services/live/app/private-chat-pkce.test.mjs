import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createPrivateChatReader,requiredScopes} from './private-chat-reader.mjs';

// Provider-contract regression, not a claim to replay a real user's consent.
// Feishu's authorize endpoint documentation explicitly pairs PKCE with v2:
// https://open.feishu.cn/document/authentication-management/access-token/obtain-oauth-code.md
// This fake provider validates the actual authorize URL against the actual
// token request; v3 exchange for that documented flow reproduces error 20049.
test('documented Feishu PKCE authorize/token pairing does not produce 20049',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'wis-pkce-contract-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 let authorizeURL;let exchanges=0;
 const reader=createPrivateChatReader({appId:'cli_test',appSecret:'test_secret',expectedOpenId:'ou_owner',peerOpenId:'ou_peer',ownerLabel:'test',
  redirectUri:'https://hub.fandow.com/live/callback',storePath:join(dir,'credential.enc'),encryptionKey:randomBytes(32).toString('base64'),
  fetchImpl:async(url,request)=>{
   const response=data=>({ok:true,status:200,json:async()=>data});
   if(url.endsWith('/token')){
    exchanges++;
    const compatible=url==='https://open.feishu.cn/open-apis/authen/v2/oauth/token';
    if(!compatible)return {ok:false,status:400,json:async()=>({code:20049,error:'invalid_grant'})};
    assert.equal(request.headers['Content-Type'],'application/json; charset=utf-8');
    const body=JSON.parse(request.body);
    assert.equal(authorizeURL.origin+authorizeURL.pathname,'https://accounts.feishu.cn/open-apis/authen/v1/authorize');
    assert.equal(authorizeURL.searchParams.get('code_challenge_method'),'S256');
    assert.equal(createHash('sha256').update(body.code_verifier).digest('base64url'),authorizeURL.searchParams.get('code_challenge'));
    assert.equal(body.redirect_uri,authorizeURL.searchParams.get('redirect_uri'));
    assert.equal(body.scope,requiredScopes.join(' '));
    return response({code:0,access_token:'fixture_access',refresh_token:'fixture_refresh',expires_in:7200,refresh_token_expires_in:604800,scope:body.scope});
   }
   if(url.endsWith('/user_info'))return response({code:0,data:{open_id:'ou_owner'}});
   if(url.includes('/chat_p2p/'))return response({code:0,data:{p2p_chats:[{chat_id:'oc_pair'}]}});
   if(url.includes('/messages?'))return response({code:0,data:{items:[]}});
   throw Error('Unexpected provider request');
  }});
 const attempt=reader.begin();authorizeURL=new URL(attempt.url);
 await assert.doesNotReject(reader.complete({code:'fixture_code',state:attempt.state,cookieState:attempt.state}));
 assert.equal(exchanges,1);assert.equal((await reader.status()).authorized,true);
});
