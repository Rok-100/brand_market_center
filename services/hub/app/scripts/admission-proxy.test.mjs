import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {authorityTarget, requestAuthority} from '../authority-client.mjs';
import {proxyHubAuth} from '../hub-auth-proxy.mjs';
import {browserSourceAllowed, forwardedBrowserSourceHeaders, permissionWriteSourceAllowed} from '../request-origin.mjs';

const bases = {authorityBase: 'https://legacy.example/api', sessionBase: 'https://auth.example/api'};
test('准入、模块管理和登录三件套与会话使用同一个轻量权限入口', () => {
  for (const [path, method] of [['/central-auth/me', 'GET'], ['/auth/login', 'POST'], ['/auth/captcha', 'POST'], ['/auth/logout', 'POST'],
    ['/admin/access-grants?q=FD-068989', 'GET'], ['/admin/access-grants', 'POST'], ['/admin/access-grants/number%3AFD-068989', 'DELETE'],
    ['/admin/module-access', 'GET'], ['/admin/module-access/number%3AFD-068989', 'PUT'], ['/admin/module-access/batch', 'POST']]) {
    assert.equal(authorityTarget(bases, path, method), bases.sessionBase + path);
  }
});
test('业务接口、其他管理接口和边界相似路径保持原服务；未配置轻量入口兼容原部署', () => {
  for (const path of ['/admin/permission-managers', '/admin/workspace-profiles', '/admin/access-grants-export', '/reviews', '/assets', '/admin/module-accessory']) {
    assert.equal(authorityTarget(bases, path), bases.authorityBase + path);
  }
  assert.equal(authorityTarget({authorityBase: bases.authorityBase}, '/auth/login', 'POST'), bases.authorityBase + '/auth/login');
});
function response() {return {writeHead(status, headers) {this.status = status; this.headers = headers;}, end(body) {this.body = JSON.parse(body || '{}');}};}
const cookie = 'wis_oa_session=fixture; Path=/; Secure; HttpOnly; SameSite=Lax';
test('登录代理使用统一入口、仅接受安全会话cookie，并清除旧会话缓存', async () => {
  const calls = []; let cleared = 0; const res = response();
  await proxyHubAuth({method: 'POST', headers: {host: 'hub.example', origin: 'https://hub.example'}}, res, '/api/hub-auth/login', {
    ...bases, readBody: async () => Buffer.from('{"username":"fixture"}'), clearSessionCache: () => {cleared++;},
    fetchImpl: async (url, options) => {calls.push([url, options]); return new Response('{"user":{}}', {status: 200, headers: {'set-cookie': cookie}});},
  });
  assert.equal(calls[0][0], bases.sessionBase + '/auth/login'); assert.equal(res.status, 200);
  assert.equal(res.headers['Set-Cookie'], cookie); assert.equal(cleared, 1);
  assert.equal(calls[0][1].headers['X-Forwarded-Proto'], 'https');
});
test('验证码和登出也走统一服务；登出仍传入现有cookie并清理浏览器会话', async () => {
  for (const action of ['captcha', 'logout']) {
    let observed; const res = response();
    await proxyHubAuth({method: 'POST', headers: {host: 'hub.example', cookie: 'wis_oa_session=fixture'}}, res, `/api/hub-auth/${action}`, {
      ...bases, readBody: async () => Buffer.from('{}'), clearSessionCache() {},
      fetchImpl: async (url, options) => {observed = {url, options}; return new Response('{"ok":true}', {status: 200});},
    });
    assert.equal(observed.url, bases.sessionBase + '/auth/' + action); assert.equal(res.status, 200);
    if (action === 'logout') {assert.equal(observed.options.headers.Cookie, 'wis_oa_session=fixture'); assert.match(res.headers['Set-Cookie'], /Max-Age=0/u);}
  }
});
test('统一服务失效不会回退旧服务或重试准入写操作', async () => {
  let requests = 0;
  const result = await requestAuthority({...bases, fetchImpl: async url => {requests++; assert.match(url, /^https:\/\/auth\.example/u); throw Error('offline');}},
    {path: '/admin/access-grants', method: 'POST', body: Buffer.from('{}'), headers: {}});
  assert.equal(result.status, 503); assert.equal(requests, 1);
  const res = response(); await proxyHubAuth({method: 'POST', headers: {host: 'hub.example'}}, res, '/api/hub-auth/login', {
    ...bases, readBody: async () => Buffer.from('{}'), clearSessionCache() {throw Error('must not clear');},
    fetchImpl: async () => {requests++; throw Error('offline');},
  });
  assert.equal(res.status, 503); assert.equal(requests, 2);
});
test('登录保持同源限制；工号授权被拒绝时保留准确错误，不伪装成功', async () => {
  const badOrigin = response(); await proxyHubAuth({method: 'POST', headers: {host: 'hub.example', origin: 'https://other.example'}}, badOrigin, '/api/hub-auth/login', {
    ...bases, readBody: async () => {throw Error('must not read');}, clearSessionCache() {}, fetchImpl() {throw Error('must not fetch');},
  }); assert.equal(badOrigin.status, 403);
  const denied = response(); await proxyHubAuth({method: 'POST', headers: {host: 'hub.example'}}, denied, '/api/hub-auth/login', {
    ...bases, readBody: async () => Buffer.from('{}'), clearSessionCache() {throw Error('must not clear');},
    fetchImpl: async () => new Response(JSON.stringify({detail: {code: 'ACCESS_IDENTITY_CONFLICT', message: '工号授权冲突'}}), {status: 403}),
  }); assert.equal(denied.status, 403); assert.equal(denied.body.detail.message, '工号授权冲突');
});
test('生产服务装配给登录代理注入同一sessionBase', () => {
  const server = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
  assert.match(server, /proxyHubAuth\(request, response, url\.pathname, \{authorityBase, sessionBase: authSessionBase, readBody, clearSessionCache\}\)/u);
});

test('来源保护拒绝跨站、伪造XFH、异常Origin和跨站Referer；正常同源与内部认证调用兼容', () => {
  for (const headers of [
    {host:'hub.example', origin:'https://evil.example', 'x-forwarded-host':'evil.example'},
    {host:'hub.example', referer:'https://evil.example/page'},
    {host:'hub.example', 'sec-fetch-site':'cross-site'},
    {host:'hub.example', origin:'null'},
    {host:'hub.example', origin:'https://someone@hub.example'},
    {host:'hub.example', origin:'https://hub.example', referer:'https://evil.example/page'},
  ]) assert.equal(browserSourceAllowed({headers}),false);
  assert.equal(browserSourceAllowed({headers:{host:'hub.example',origin:'https://hub.example',referer:'https://hub.example/page','sec-fetch-site':'same-origin'}}),true);
  assert.equal(browserSourceAllowed({headers:{host:'hub.example'}}),true);
  const headers = forwardedBrowserSourceHeaders({headers:{host:'hub.example','x-forwarded-host':'evil.example',origin:'https://hub.example',referer:'https://hub.example/page','sec-fetch-site':'same-origin'}});
  assert.equal(headers['X-Forwarded-Host'],'hub.example'); assert.equal(headers.Origin,'https://hub.example'); assert.equal(headers['Sec-Fetch-Site'],'same-origin');
});
test('生产Hub权限写入口在处理登录/模块/看板写入之前拦截跨站请求', async () => {
  const server=readFileSync(new URL('../server.mjs',import.meta.url),'utf8');
  const from=server.indexOf('async function handleApi(request, response, url) {');
  const until=server.indexOf('  if (await proxyHubAuth',from);
  assert.ok(until>from);
  const compile=new Function('permissionWriteSourceAllowed','sendJson',server.slice(from,until)+'return false; }; return handleApi;');
  for(const path of ['/api/permissions/login','/api/permissions/modules/batch','/api/permissions/modules/number%3AFD-068989','/api/permissions/organization-entry']) {
    let sent;
    const handler=compile(permissionWriteSourceAllowed,(_res,status,body)=>{sent={status,body};});
    const handled=await handler({method:'POST',headers:{host:'hub.example',origin:'https://evil.example','sec-fetch-site':'cross-site'}},{},new URL('https://hub.example'+path));
    assert.equal(handled,true); assert.equal(sent.status,403); assert.equal(sent.body.code,'AUTH_ORIGIN_DENIED');
  }
});
test('生产authorityHeaders保留浏览器来源证据并以真实Host覆盖伪造XFH', () => {
  const server=readFileSync(new URL('../server.mjs',import.meta.url),'utf8');
  const from=server.indexOf('function authorityHeaders('),until=server.indexOf('\nasync function callAuthority',from);
  const headersFor=new Function('forwardedBrowserSourceHeaders',server.slice(from,until)+';return authorityHeaders;')(forwardedBrowserSourceHeaders);
  const headers=headersFor({headers:{host:'hub.example','x-forwarded-host':'evil.example',origin:'https://hub.example',referer:'https://hub.example/page','sec-fetch-site':'same-origin',cookie:'wis_oa_session=fixture'}},true);
  assert.equal(headers['X-Forwarded-Host'],'hub.example'); assert.equal(headers.Origin,'https://hub.example'); assert.equal(headers.Referer,'https://hub.example/page'); assert.equal(headers['Sec-Fetch-Site'],'same-origin'); assert.equal(headers.Cookie,'wis_oa_session=fixture');
});
test('登录代理补全Referer/Fetch-Site保护并转发可信来源证据', async () => {
  for(const headers of [{host:'hub.example',referer:'https://evil.example/page'},{host:'hub.example','sec-fetch-site':'cross-site'}]) {
    const res=response(); await proxyHubAuth({method:'POST',headers},res,'/api/hub-auth/login',{
      ...bases,readBody:async()=>{throw Error('must not read');},clearSessionCache(){},fetchImpl(){throw Error('must not fetch');}});
    assert.equal(res.status,403);
  }
  let observed;const res=response();await proxyHubAuth({method:'POST',headers:{host:'hub.example','x-forwarded-host':'evil.example',origin:'https://hub.example',referer:'https://hub.example/page','sec-fetch-site':'same-origin'}},res,'/api/hub-auth/captcha',{
    ...bases,readBody:async()=>Buffer.from('{}'),clearSessionCache(){},fetchImpl:async(_url,options)=>{observed=options.headers;return new Response('{"ok":true}',{status:200});}});
  assert.equal(res.status,200);assert.equal(observed['X-Forwarded-Host'],'hub.example');assert.equal(observed.Referer,'https://hub.example/page');assert.equal(observed['Sec-Fetch-Site'],'same-origin');
});
