import { createHmac, timingSafeEqual } from 'node:crypto';

export function signLearningIdentity(user, method, path, secret, now = Date.now()) {
  if (typeof secret !== 'string' || secret.length < 32) throw new Error('学习中心身份密钥未配置');
  const identity = Buffer.from(JSON.stringify({ user, method, path, issuedAt: now })).toString('base64url');
  return { identity, signature: createHmac('sha256', secret).update(identity).digest('base64url') };
}

export function verifyLearningIdentity(request, secret, now = Date.now()) {
  const reject = () => { throw Object.assign(new Error('中枢登录身份已失效，请返回中枢重新登录'), { status: 401, code: 'AUTH_REQUIRED' }); };
  const encoded = request.headers['x-learning-identity'];
  const supplied = request.headers['x-learning-signature'];
  if (typeof secret !== 'string' || secret.length < 32) throw new Error('学习中心身份密钥未配置');
  if (typeof encoded !== 'string' || encoded.length > 8192 || (typeof supplied !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(supplied))) return reject();
  const expected = createHmac('sha256', secret).update(encoded).digest('base64url');
  if (supplied.length !== expected.length || !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) return reject();
  let value;
  try { value = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')); } catch { return reject(); }
  const user = value?.user;
  if (!Number.isFinite(value?.issuedAt) || now - value.issuedAt > 15000 || value.issuedAt - now > 5000 ||
      value.method !== request.method || value.path !== (request.originalUrl || request.url) ||
      !user || typeof user.id !== 'string' || !/^\d{1,100}$/.test(user.id) ||
      typeof user.name !== 'string' || !user.name.trim() || user.name.length > 100 ||
      typeof user.department !== 'string' || user.department.length > 500 || typeof user.isAdmin !== 'boolean') return reject();
  return { id: user.id, name: user.name, department: user.department, isAdmin: user.isAdmin };
}
