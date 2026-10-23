import { normalizeEmployee } from './training/server/auth.mjs';

// Resolve identity on the server; browser profile and preview parameters are not authority.
export async function hubIdentity(req, upstream, fetcher = fetch) {
  const response = await fetcher(new URL('/api/session', upstream), {
    headers: { cookie: req.headers.cookie || '' },
    redirect: 'manual',
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) {
    throw Object.assign(new Error('中枢登录已失效，请返回中枢重新登录'), {
      status: response.status === 403 ? 403 : 401, code: 'AUTH_REQUIRED',
    });
  }
  const session = await response.json();
  const id = normalizeEmployee(session.user?.number);
  const name = String(session.user?.realName || session.user?.name || '').trim();
  if (session.allowed === false || session.access?.master_access !== true || !id || !name) {
    throw Object.assign(new Error('当前中枢身份未获准访问'), { status: 403, code: 'AUTH_REQUIRED' });
  }
  return {
    id, name,
    department: String(session.user.department || session.workspace?.department || ''),
    isAdmin: session.permissions?.manage_permissions === true,
  };
}
