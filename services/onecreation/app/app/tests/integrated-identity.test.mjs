import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
const centralSource = fs.readFileSync(new URL('../central-access.js', import.meta.url), 'utf8');

function extract(name) {
  const match = source.match(new RegExp(`(?:^|\\n)(?:async )?function ${name}\\(`));
  assert.ok(match, `${name} exists`);
  const start = match.index + (match[0][0] === '\n' ? 1 : 0);
  const endMatch = source.slice(start + 1).match(/\n(?:async )?function /);
  assert.ok(endMatch, `${name} has a following function`);
  return source.slice(start, start + 1 + endMatch.index);
}

const binding = {
  idType: 'user_id', active: true, employeeNumber: 'FD-026222', userId: 'official-user-id',
  issuer: 'app_17aq7v0j96v', audience: 'ai-video-workbench', tenantId: '20960514',
  validUntil: new Date(Date.now() + 60_000).toISOString(), sourceReadAt: new Date().toISOString(),
  sourceSha256: 'a'.repeat(64),
};

function connection({ mapped = binding, claims = {}, oa = true, ticket = true } = {}) {
  const user = { number: 'FD-026222', collaborationIdentity: mapped };
  const auth = ticket ? { ok: true, token: 'signed-fixture-ticket', user: {
    lark_user_id: 'official-user-id', iss: binding.issuer, aud: binding.audience,
    tenant_id: binding.tenantId, sub: 'opaque-native-subject', ...claims,
  }} : { ok: false };
  const context = vm.createContext({ authManager: { authenticateRequest: () => auth }, Date });
  for (const name of ['teamServiceLoginError', 'teamServiceConnection']) {
    vm.runInContext(extract(name), context);
  }
  const req = { authSource: oa ? 'central-oa' : 'none', authUser: user,
    centralAccess: oa ? { workbenchUser: user } : null };
  return { req, connect: () => context.teamServiceConnection(req) };
}

test('integrated OA can reach shared directory only with signed ticket and current official binding', () => {
  const valid = connection();
  assert.equal(valid.connect().headers['X-Workbench-Ticket'], 'signed-fixture-ticket');
  assert.equal(valid.req.collaborationIdentityAudit.employeeNumber, 'FD-026222');
  assert.throws(() => connection({ ticket: false }).connect(), { code: 'COLLABORATION_LOGIN_REQUIRED' });
  assert.throws(() => connection({ mapped: null }).connect(), { code: 'COLLABORATION_IDENTITY_UNCONFIRMED' });
  assert.throws(() => connection({ mapped: { ...binding, validUntil: new Date(Date.now() - 1).toISOString() } }).connect(),
    { code: 'COLLABORATION_IDENTITY_UNCONFIRMED' });
  assert.throws(() => connection({ claims: { lark_user_id: 'different-user' } }).connect(),
    { code: 'COLLABORATION_IDENTITY_MISMATCH' });
  assert.throws(() => connection({ oa: false }).connect(), { code: 'COLLABORATION_IDENTITY_UNCONFIRMED' });
});

test('central authorization cache refreshes official binding on every OA request', async () => {
  let current = binding;
  let remoteCalls = 0;
  const context = vm.createContext({
    module: { exports: {} }, process: { env: {} }, Buffer, URL, AbortController, setTimeout, clearTimeout, Date,
    require: (name) => name === './collaboration-identity.js'
      ? { createIdentityStore: () => ({ get: () => current, status: () => ({}) }) }
      : awaitableRequire(name),
  });
  vm.runInContext(centralSource, context);
  const client = context.module.exports.createCentralAccessClient({
    serviceToken: 'x'.repeat(40),
    fetchImpl: async () => {
      remoteCalls += 1;
      return { ok: true, status: 200, json: async () => ({ allowed: true,
        access: { allowed_modules: ['ai-first-creation'] }, user: { number: 'FD-026222' } }) };
    },
  });
  assert.ok((await client.authorizeOaToken('opaque-oa')).workbenchUser.collaborationIdentity);
  current = null;
  assert.equal((await client.authorizeOaToken('opaque-oa')).workbenchUser.collaborationIdentity, null);
  assert.equal(remoteCalls, 1);
});

function awaitableRequire(name) {
  if (name === 'crypto') return { createHash: () => ({ update: () => ({ digest: () => 'fixture-hash' }) }) };
  throw new Error(`unexpected require: ${name}`);
}
