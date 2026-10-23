import {open,mkdir} from 'node:fs/promises';
import {dirname} from 'node:path';
import {randomBytes,createCipheriv,createDecipheriv} from 'node:crypto';
import {fault} from './anchor-status-policy.mjs';

const META='anchorStatusDelegatedOA',SCOPE='anchor-status-scoring-v1';
const maxLifetime=7*86400000;
export function createDelegatedOAAuthorization({store,keyFile,verify,clock=Date.now}={}){
  let keyLoading;
  async function key(){
    if(!keyLoading)keyLoading=(async()=>{
      await mkdir(dirname(keyFile),{recursive:true,mode:0o700});
      try{const file=await open(keyFile,'wx',0o600);try{await file.writeFile(randomBytes(32));await file.sync();}finally{await file.close();}}catch(e){if(e.code!=='EEXIST')throw e;}
      const file=await open(keyFile,'r');try{const info=await file.stat();if(!info.isFile()||info.size!==32||process.platform!=='win32'&&(info.mode&0o077))throw Error('invalid key');return await file.readFile();}finally{await file.close();}
    })().catch(()=>{keyLoading=null;throw fault('后台授权加密配置不可用，请联系管理员。','delegation_key_unavailable',503);});
    return keyLoading;
  }
  const record=()=>store.meta(META);
  const aad=r=>Buffer.from(JSON.stringify([SCOPE,r.owner,r.expiresAt,r.model]));
  function expiresAt(token){
    let expires=clock()+maxLifetime;
    try{const value=JSON.parse(Buffer.from(token.split('.')[1],'base64url'));if(Number.isFinite(value.exp))expires=Math.min(expires,value.exp*1000);}catch{}
    if(expires<=clock())throw fault('OA授权已经过期，请重新登录。','delegation_expired',401);
    return new Date(expires).toISOString();
  }
  function status(){const r=record();const expired=r?.enabled&&Date.parse(r.expiresAt)<=clock();return {enabled:Boolean(r?.enabled&&!expired),ready:Boolean(r?.enabled&&!expired&&!r.error),state:expired?'expired':r?.state||'not_authorized',owner:r?.owner||null,expiresAt:r?.expiresAt||null,model:r?.model||null,updatedAt:r?.updatedAt||null,error:expired?'后台OA授权已过期，请重新登录并更新后台授权。':r?.error||null};}
  function invalidate(message='后台OA授权已失效，请重新登录并更新后台授权。'){
    const r=record();if(!r)return;
    store.meta(META,{owner:r.owner,model:r.model,expiresAt:r.expiresAt,enabled:false,state:'reauthorization_required',error:message,updatedAt:new Date(clock()).toISOString()});
    store.audit(null,r.owner,'background_authorization_invalidated','OA授权或管理权限已失效，密文已移除，原队列保留。');
  }
  async function check(token,owner){
    const outcome=await verify(token,owner);
    if(outcome!==true)throw fault('后台OA授权或管理权限已失效，请重新登录。','delegation_denied',401);
  }
  return {
    status,invalidate,
    expire(){const r=record();if(r?.enabled&&Date.parse(r.expiresAt)<=clock())invalidate('后台OA授权已过期，请重新登录并更新后台授权。');},
    async enable(token,owner,model){
      if(!token||token.length>8192||/[\r\n\x00-\x1f]/u.test(token)||!owner)throw fault('当前OA授权不可用，请重新登录。','delegation_denied',401);
      await check(token,owner);
      const r={owner,model,expiresAt:expiresAt(token),enabled:true,state:'enabled',error:null,updatedAt:new Date(clock()).toISOString()};
      const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',await key(),iv);cipher.setAAD(aad(r));
      r.ciphertext=Buffer.concat([cipher.update(token,'utf8'),cipher.final()]).toString('base64');r.iv=iv.toString('base64');r.tag=cipher.getAuthTag().toString('base64');
      store.meta(META,r);store.audit(null,owner,'background_scoring_enabled',JSON.stringify({scope:SCOPE,model,expiresAt:r.expiresAt}));return status();
    },
    pause(actor){const r=record();store.meta(META,{owner:r?.owner||actor,model:r?.model||null,expiresAt:r?.expiresAt||null,enabled:false,state:'paused',error:null,updatedAt:new Date(clock()).toISOString()});store.audit(null,actor,'background_scoring_paused','停止启动后续评分；密文已移除，进行中的评分可完成。');return status();},
    async token(){
      const r=record();if(!r?.enabled)return '';
      if(Date.parse(r.expiresAt)<=clock()){invalidate();return '';}
      let token;
      try{const decipher=createDecipheriv('aes-256-gcm',await key(),Buffer.from(r.iv,'base64'));decipher.setAAD(aad(r));decipher.setAuthTag(Buffer.from(r.tag,'base64'));token=Buffer.concat([decipher.update(Buffer.from(r.ciphertext,'base64')),decipher.final()]).toString('utf8');}catch(e){if(e.code==='delegation_key_unavailable')throw e;invalidate('后台授权校验失败，请重新登录并更新后台授权。');return '';}
      try{await check(token,r.owner);}catch(e){
        if(e.status===503)throw fault('权限服务暂不可用，后台评分等待重试，原队列保留。','delegation_check_unavailable',503);
        invalidate();return '';
      }
      return token;
    },
  };
}
