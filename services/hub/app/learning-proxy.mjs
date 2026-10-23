import { request as httpRequest } from 'node:http';
import { signLearningIdentity } from './learning-bridge.mjs';

const hop = ['connection','keep-alive','proxy-authenticate','proxy-authorization','te','trailer','transfer-encoding','upgrade'];
export function createLearningProxy({ baseUrl, secret, currentSession, sendJson }) {
  let base;
  if (baseUrl) {
    base = new URL(baseUrl);
    if (base.protocol !== 'http:' || base.username || base.password || base.pathname !== '/' || base.search || base.hash) throw new Error('学习中心内部地址配置不正确');
  }
  return async (request, response, url) => {
    if (url.pathname !== '/learning' && !url.pathname.startsWith('/learning/')) return false;
    // /learning is a business request, so currentSession performs a fresh check.
    const session = await currentSession(request);
    if (session.status !== 200) { sendJson(response, session.status, session.payload); return true; }
    const value = session.payload;
    const id = String(value?.user?.number || '').trim().replace(/^fd[-_]?/i,'').toLowerCase();
    const name = String(value?.user?.realName || value?.user?.name || '').trim();
    if (value?.allowed === false || value?.access?.master_access !== true || !/^\d{1,100}$/.test(id) || !name) {
      sendJson(response,403,{detail:'当前中枢身份未获准访问学习中心'});return true;
    }
    if (!base || !secret) { sendJson(response,503,{detail:'学习中心服务尚未配置'});return true; }
    if (url.pathname === '/learning') {
      const prefix = String(request.headers['x-forwarded-prefix'] || '').replace(/\/+$/u,'');
      const location = /^\/[\w/-]*$/.test(prefix) ? prefix + '/learning/' : '/learning/';
      response.writeHead(303,{Location:location,'Cache-Control':'no-store'});response.end();return true;
    }
    const target = new URL(base);
    target.pathname = url.pathname.slice('/learning'.length);
    target.search = url.search;
    const signed = signLearningIdentity({id,name,department:String(value.user.department || value.workspace?.department || ''),isAdmin:value.permissions?.manage_permissions===true},request.method,target.pathname+target.search,secret);
    const headers = {...request.headers,host:target.host,'x-learning-identity':signed.identity,'x-learning-signature':signed.signature};
    for (const key of hop) delete headers[key];
    await new Promise(resolve => {
      const upstream = httpRequest(target,{method:request.method,headers},incoming=>{
        const forwarded={...incoming.headers};for(const key of hop)delete forwarded[key];
        response.writeHead(incoming.statusCode,forwarded);incoming.pipe(response);
        incoming.on('error',()=>{response.destroy();resolve();});
        incoming.on('end',resolve);
      });
      upstream.setTimeout(30000,()=>upstream.destroy(new Error('学习中心请求超时')));
      upstream.on('error',()=>{if(!response.headersSent)sendJson(response,503,{detail:'学习中心暂不可用，请稍后重试'});else response.end();resolve();});
      request.on('aborted',()=>{upstream.destroy();resolve();});
      response.on('close',()=>{if(!response.writableFinished)upstream.destroy();resolve();});
      request.pipe(upstream);
    });
    return true;
  };
}
