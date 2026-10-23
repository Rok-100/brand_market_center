import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { fail, organizationCenter } from './model.mjs';
import { normalizeEmployee, isBrandDepartment } from './access.mjs';

export { normalizeEmployee } from './access.mjs';
export function cookies(req) {return Object.fromEntries(String(req.headers.cookie||'').split(';').map(x=>x.trim().split('=')).filter(x=>x.length===2));}
const loopback=ip=>['127.0.0.1','::1','::ffff:127.0.0.1'].includes(ip);
export function createAuth({preview=false,managerIds=[],isAllowedEmployee=()=>false,clock=Date.now,identityProvider,oaFetch=fetch,csrfSecret}) {
  const managers=new Set(managerIds.map(normalizeEmployee)),cache=new Map();
  if(!csrfSecret || csrfSecret.length<32)throw new Error('CSRF_SECRET must contain at least 32 characters');
  async function resolve(req) {
    if(cookies(req).bmt_signed_out==='1')fail(401,'你已退出本平台，请重新进入公司登录','SIGNED_OUT');
    let identity;
    if(identityProvider) identity=await identityProvider(req);
    else if(preview) {
      if(!loopback(req.socket.remoteAddress))fail(403,'预览仅允许本机访问');
      const role=cookies(req).bmt_preview_role || 'manager';
      identity=role==='learner'?{id:'preview-learner',name:'预览学员',department:'品牌营销部',isAdmin:false}:{id:'preview-manager',name:'预览管理员',department:'品牌营销部',isAdmin:true};
    } else {
      const token=req.headers['x-oa-token'];
      if(typeof token!=='string' || token.length<10 || token.length>16000)fail(401,'公司登录已失效，请重新登录；反馈草稿已保留','AUTH_REQUIRED');
      let expiresAt=Infinity;
      try {const claims=JSON.parse(Buffer.from(token.split('.')[1],'base64url').toString('utf8'));if(Number.isFinite(claims.exp))expiresAt=claims.exp*1000;}catch{}
      if(expiresAt<=clock())fail(401,'公司登录已过期，请重新登录','AUTH_EXPIRED');
      const key=createHash('sha256').update(token).digest('hex'),cached=cache.get(key);
      if(cached&&cached.until>clock())identity=cached.identity;
      else {
        let response;
        try {response=await oaFetch('https://api.fandow.com/auth/userinfo',{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(10000)});}catch{fail(503,'公司身份服务暂不可用，请稍后重试；草稿不会丢失','IDENTITY_UNAVAILABLE');}
        if(response.status===401||response.status===403)fail(401,'公司登录已失效，请重新登录','AUTH_EXPIRED');
        if(!response.ok)fail(503,'公司身份服务暂不可用，请稍后重试','IDENTITY_UNAVAILABLE');
        let info;try{info=await response.json();}catch{fail(503,'公司身份服务返回异常，请稍后重试','IDENTITY_UNAVAILABLE');}
        const u=info?.data;
        if(info.code!==0 || !u)fail(401,'公司身份未通过校验，请重新登录','AUTH_REQUIRED');
        const id=normalizeEmployee(u.number || u.username);
        const name=String(u.realName||u.real_name||'').trim(),department=String(u.deptName||u.departmentName||'').trim();
        if(!id || !name || id.length>100 || name.length>100)fail(401,'公司身份缺少工号或姓名，无法保存个人学习记录','IDENTITY_INCOMPLETE');
        identity={id,name,department,isAdmin:managers.has(id)};
        cache.set(key,{identity,until:Math.min(clock()+30000,expiresAt)});
        if(cache.size>2000){for(const [k,v]of cache)if(v.until<=clock())cache.delete(k);if(cache.size>2000)cache.delete(cache.keys().next().value);}
      }
    }
    if(!identity || !identity.id || !identity.name)fail(401,'身份未通过校验','AUTH_REQUIRED');
    const department=String(identity.department||'').trim();
    const accessBasis=identity.isAdmin?'administrator':isBrandDepartment(department)?'department':isAllowedEmployee(identity.id)?'whitelist':null;
    if(!accessBasis)fail(403,'尚未开通平台访问，请联系部门管理员','ACCESS_NOT_GRANTED');
    return {...identity,department,center:organizationCenter(department),isAdmin:!!identity.isAdmin,accessBasis};
  }
  const tokenFor=(user,hour=Math.floor(clock()/3600000))=>createHmac('sha256',csrfSecret).update(user.id+':'+hour).digest('base64url');
  function checkWrite(req,user,origin) {
    if(req.headers.origin && req.headers.origin!==origin)fail(403,'跨站提交已拒绝，请从本平台重新提交','ORIGIN_REJECTED');
    if(req.headers['sec-fetch-site']==='cross-site')fail(403,'跨站提交已拒绝','ORIGIN_REJECTED');
    const supplied=req.headers['x-csrf-token'];
    if(typeof supplied!=='string')fail(403,'页面校验已失效，请刷新后重试；草稿已保留','CSRF_REQUIRED');
    const valid=[tokenFor(user),tokenFor(user,Math.floor(clock()/3600000)-1)].some(t=>t.length===supplied.length && timingSafeEqual(Buffer.from(t),Buffer.from(supplied)));
    if(!valid)fail(403,'页面校验已失效，请刷新后重试；草稿已保留','CSRF_REQUIRED');
  }
  return {resolve,tokenFor,checkWrite};
}
