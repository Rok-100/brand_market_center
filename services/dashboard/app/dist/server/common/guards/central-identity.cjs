'use strict';
function fail(status, message) { const error = new Error(message); error.status = status; throw error; }
function text(user, keys) { for (const key of keys) { const v=user[key]; if ((typeof v==='string' && v.trim()) || (typeof v==='number' && Number.isFinite(v))) return String(v).trim(); } return ''; }
async function readCentralIdentity(request, base, fetchImpl=fetch) {
  if (!base) fail(503, '统一身份服务未配置');
  const headers={Accept:'application/json'};
  for (const name of ['cookie','x-oa-token']) {
    const value=request.headers[name];
    if (typeof value==='string' && value) headers[name]=value;
  }
  if (!headers.cookie && !headers['x-oa-token']) fail(401,'请先登录中枢');
  let response;
  try { response=await fetchImpl(`${base.replace(/\/+$/, '')}/central-auth/me`,{headers,redirect:'manual',signal:AbortSignal.timeout(12000)}); }
  catch { fail(503,'统一身份服务暂时不可用'); }
  if (response.status===401 || (response.status>=300 && response.status<400)) fail(401,'中枢登录状态已失效');
  if (response.status===403) fail(403,'当前账号未开通中枢访问权限');
  if (response.status!==200) fail(503,'统一身份服务暂时不可用');
  const payload=await response.json().catch(()=>null);
  if (!payload || !payload.user || !payload.access) fail(503,'统一身份服务响应不完整');
  if (payload.access.login_blocked || payload.access.master_access===false || !Array.isArray(payload.access.allowed_modules) || !payload.access.allowed_modules.includes('data-dashboard')) fail(403,'当前账号未开通经营看板权限');
  const user=payload.user;
  const userId=text(user,['userId','id','number']); const userName=text(user,['realName','name']);
  if (!userId || !userName) fail(401,'中枢用户信息不完整');
  const jobTitle=text(user,['jobTitle']) || null;
  return {userId,userName,roles:[],highestBusinessAccess:payload.access.highest_business_access===true,userType:'central_authority',env:'runtime',jobTitle,userProfile:{...user,name:userName,displayName:userName,jobTitle}};
}
module.exports={readCentralIdentity};
