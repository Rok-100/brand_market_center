// Isolated r3 session behavior; no server, credentials or real notifications.
// The final legacy synchronous-path characterization is not a production timer
// latency assertion: the background scheduler uses the async path separately.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { enforceConfirmedAdmission } from '../admission-policy.mjs';
import { FlowRuntime } from '../flow-runtime.mjs';
import { FlowAutomation } from '../flow-automation.mjs';
import { WorkflowStore } from '../workflow-store.mjs';
import { versionedDocumentStore } from '../document_store_mysql.mjs';
import { createOrganizationEntryReader, organizationEntryAllowed } from '../organization-entry.mjs';

const server = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
const start = server.indexOf('async function currentSession(request) {');
const end = server.indexOf('\nfunction dashboardSelectedDate', start);
assert.ok(start >= 0 && end > start);
const compileSession = new Function('deps', `const {sessionCache, sessionInflight, callAuthority, applyWorkspacePolicy,
  organizationEntryForRequest, enforceConfirmedAdmission} = deps;
  let sessionCacheEpoch=0;
  const requestAuthoritySessions = new WeakMap();
  const sessionCacheKey=()=> 'fixture', sessionCacheLimit=500, sessionCacheTtlMs=15000, sessionStaleTtlMs=120000;
  const transientAuthorityFailure = value => [408,425,429,500,502,503,504].includes(value.status);
  ${server.slice(start, end)}; return currentSession;`);
const good = Object.freeze({ status: 200, payload: Object.freeze({ user: Object.freeze({ number: 'FD-026222' }),
  permissions: Object.freeze({manage_permissions:false}), access:Object.freeze({allowed_modules:Object.freeze(['data-dashboard'])}), retained:'authority-field' }) });
const policySnapshot = enabled => ({schema:1,version:1,entries:{'FD-026222':{enabled}},audits:[]});
const projectEntry = (payload, snapshot) => ({...payload,access:{...payload.access},workspace:{can_view_organization_dashboard:organizationEntryAllowed(snapshot,payload.user)}});

test('a warm authority cache still reads current entry policy per request and immediately honors revocation and read failure', async () => {
  let enabled=true,failed=false,reads=0,policies=0;
  const sessionCache = new Map([['fixture', { value: good, expiresAt: Date.now()+10000 }]]);
  const currentSession = compileSession({ sessionCache, sessionInflight: new Map(), enforceConfirmedAdmission,
    callAuthority() { throw Error('warm cache must not call authority'); },
    organizationEntryForRequest:createOrganizationEntryReader({async readAsync(){reads++;if(failed)throw Error('authority storage unavailable');return policySnapshot(enabled);}}),
    applyWorkspacePolicy(payload,snapshot) { policies++;return projectEntry(payload,snapshot); } });
  const display = () => ({method:'GET',url:'/api/session'});
  const first=await currentSession(display());assert.equal(first.payload.workspace.can_view_organization_dashboard,true);
  enabled=false;const second=await currentSession(display());assert.equal(second.payload.workspace.can_view_organization_dashboard,false);
  enabled=true;failed=true;const third=await currentSession(display());assert.equal(third.payload.workspace.can_view_organization_dashboard,false);
  assert.equal(reads,3);assert.equal(policies,3);assert.equal(first.payload.workspace.can_view_organization_dashboard,true);
  assert.equal(sessionCache.get('fixture').value,good);assert.equal(good.payload.workspace,undefined);
  assert.equal(second.payload.retained,'authority-field');assert.deepEqual(second.payload.permissions,good.payload.permissions);assert.deepEqual(second.payload.access,good.payload.access);
  sessionCache.get('fixture').value = { status: 200, payload: { user: { number: 'OD-005620' } } };
  assert.equal((await currentSession(display())).status, 403);assert.equal(reads,3);assert.equal(policies,3);
});

test('cold concurrent sessions share only authority IO, then each request reads and projects its own entry policy', async () => {
  let release, authorityCalls = 0, policyCalls = 0,reads=0;
  const gate = new Promise(resolve => { release = resolve; });
  const sessionCache=new Map(),currentSession = compileSession({ sessionCache, sessionInflight: new Map(), enforceConfirmedAdmission,
    async callAuthority() { authorityCalls++; await gate; return good; },
    organizationEntryForRequest:createOrganizationEntryReader({async readAsync(){return policySnapshot(++reads===1);}}),
    applyWorkspacePolicy(payload,snapshot) { policyCalls++; return projectEntry(payload,snapshot); } });
  const first = currentSession({}), second = currentSession({});
  await delay(0);
  assert.equal(authorityCalls, 1); assert.equal(policyCalls, 0);assert.equal(reads,0);
  release();
  const results=await Promise.all([first, second]);assert.deepEqual(results.map(x=>x.payload.workspace.can_view_organization_dashboard),[true,false]);
  assert.equal(policyCalls, 2);assert.equal(reads,2);assert.equal(sessionCache.get('fixture').value,good);
  assert.notEqual(results[0].payload,results[1].payload);assert.notEqual(results[0].payload.workspace,results[1].payload.workspace);
  results[0].payload.workspace.can_view_organization_dashboard='response-only-change';assert.equal(results[1].payload.workspace.can_view_organization_dashboard,false);
  assert.equal(good.payload.workspace,undefined);assert.equal(good.payload.retained,'authority-field');
});

test('an expired cache waits for authority and does not conceal either 401 or 403 behind previous success', async () => {
 for(const status of [401,403]){
  let release, settled = false;
  const gate = new Promise(resolve => { release = resolve; });
  const sessionCache=new Map([['fixture', { value: good,expiresAt: Date.now()-1, staleUntil: Date.now()+10000 }]]);
  const currentSession = compileSession({ sessionCache, sessionInflight: new Map(), enforceConfirmedAdmission,
    async callAuthority() { await gate; return { status, payload: {} }; },
    organizationEntryForRequest(){throw Error('denied session must not read entry storage');},
    applyWorkspacePolicy() { throw Error('denied session must not evaluate policy'); } });
  const pending = currentSession({}).then(result => { settled = true; return result; });
  await delay(0); assert.equal(settled, false);
  release(); assert.equal((await pending).status,status);assert.equal(sessionCache.has('fixture'),false);
 }
});

function policyFixture(callAuthority, cache = new Map()) {
  return compileSession({sessionCache: cache, sessionInflight: new Map(), enforceConfirmedAdmission, callAuthority,
    organizationEntryForRequest: createOrganizationEntryReader({async readAsync() {return policySnapshot(true);}}),
    applyWorkspacePolicy: projectEntry});
}
test('external revoke is honored by module launch and business authorization despite a warm display cache', async () => {
  for (const request of [{method:'GET',url:'/api/launch/cloud-manager'}, {method:'HEAD',url:'/api/launch/cloud-manager'},
    {method:'GET',url:'/api/organization-dashboard'}, {method:'POST',url:'/api/flows/run'}, {method:'POST',url:'/api/session'}]) {
    let reads = 0;
    const cache = new Map([['fixture', {value:good, expiresAt:Date.now()+15000, staleUntil:Date.now()+120000}]]);
    const currentSession = policyFixture(async () => {reads++; return {status:403,payload:{detail:'revoked elsewhere'}};}, cache);
    assert.equal((await currentSession({method:'GET',url:'/api/session?display=1'})).status, 200); assert.equal(reads,0);
    assert.equal((await currentSession(request)).status,403); assert.equal(reads,1); assert.equal(cache.has('fixture'),false);
    assert.equal((await currentSession({method:'GET',url:'/api/session'})).status,403); assert.equal(reads,2);
  }
});
test('business requests never reuse old permission after an upstream outage, including a shared display refresh', async () => {
  let release, reads = 0;
  const gate = new Promise(resolve => {release=resolve;});
  const cache = new Map([['fixture', {value:good, expiresAt:Date.now()-1, staleUntil:Date.now()+120000}]]);
  const currentSession = policyFixture(async () => {reads++; await gate; return {status:503,payload:{detail:'policy unavailable'}};}, cache);
  const display = currentSession({method:'GET',url:'/api/session'});
  const protectedRequest = currentSession({method:'GET',url:'/api/launch/cloud-manager'});
  await delay(0); assert.equal(reads,1); release();
  assert.equal((await display).status,200); assert.equal((await protectedRequest).status,503);
  assert.equal((await currentSession({method:'GET',url:'/api/launch/cloud-manager'})).status,503); assert.equal(reads,2);
});
test('same HTTP request shares its current check; a subsequent business request rechecks current module scope', async () => {
  let reads=0, allowed=true;
  const currentSession = policyFixture(async () => {reads++; return {...good,payload:{...good.payload,access:{allowed_modules:allowed?['cloud-manager']:[]}}};});
  const request = {method:'GET',url:'/api/launch/cloud-manager'};
  assert.deepEqual((await currentSession(request)).payload.access.allowed_modules,['cloud-manager']);
  assert.deepEqual((await currentSession(request)).payload.access.allowed_modules,['cloud-manager']); assert.equal(reads,1);
  allowed=false;
  assert.deepEqual((await currentSession({method:'GET',url:'/api/launch/cloud-manager'})).payload.access.allowed_modules,[]); assert.equal(reads,2);
});

test('r7 idle automation and runtime ticks still perform three blocking document RPCs', async t => {
  const calls = [], state = JSON.stringify({schemaVersion: 3, tasks: [], flowAutomationWatches: []});
  const store = Object.create(WorkflowStore.prototype);
  store.documents = versionedDocumentStore({
    call(method) {
      calls.push(method);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 30);
      return method === 'readFile' ? { exists: true, version: 1, data: state } : { unchanged: true };
    },
    callAsync() { throw Error('diagnostic expects r7 synchronous idle path'); },
  }, 'local-fixture');
  const runtime = new FlowRuntime(store, { people: () => [{ number: 'SELF', active: true }], env: {} });
  const automation = new FlowAutomation(runtime, {});
  let timerRan = false;
  const timer = delay(0).then(() => { timerRan = true; });
  const began = performance.now();
  automation.reconcile(); runtime.tick();
  const elapsed = performance.now()-began;
  assert.deepEqual(calls, ['readFile', 'readTextIfChanged', 'readTextIfChanged']);
  assert.equal(timerRan, false);
  assert.ok(elapsed >= 70, 'three fixture waits block the caller, despite there being no tasks');
  await timer;
  t.diagnostic(`Three 30 ms fixture RPC waits blocked the event loop for ${elapsed.toFixed(1)} ms; this is simulated latency, not a production measurement.`);
});
