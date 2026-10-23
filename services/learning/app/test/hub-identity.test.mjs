import test from 'node:test';
import assert from 'node:assert/strict';
import { hubIdentity } from '../hub-identity.mjs';

const session = {
  access: { master_access: true },
  user: { number: 'FD-001234', realName: '测试学员', department: '品牌营销部-AI营销中心' },
  permissions: { manage_permissions: false },
};
const req = { headers: { cookie: 'local-role=learner', 'x-user-id': 'admin' } };
test('使用中枢认证结果并保留工号前导零，不信任浏览器身份字段', async () => {
  const user = await hubIdentity(req, 'http://127.0.0.1:8095', async (url, options) => {
    assert.equal(url.pathname, '/api/session');
    assert.deepEqual(options.headers, { cookie: 'local-role=learner' });
    return Response.json(session);
  });
  assert.equal(user.id, '001234');
  assert.equal(user.isAdmin, false);
});
test('中枢登录或准入失效时拒绝访问', async () => {
  for (const payload of [
    { ...session, allowed: false },
    { ...session, access: { master_access: false } },
    { ...session, user: {} },
  ]) {
    await assert.rejects(hubIdentity(req, 'http://127.0.0.1:8095', async () => Response.json(payload)), { status: 403 });
  }
  await assert.rejects(hubIdentity(req, 'http://127.0.0.1:8095', async () => new Response(null, { status: 401 })), { status: 401 });
});
test('管理员身份由服务端明确权限决定', async () => {
  const user = await hubIdentity(req, 'http://127.0.0.1:8095', async () =>
    Response.json({ ...session, permissions: { manage_permissions: true } }));
  assert.equal(user.isAdmin, true);
});
