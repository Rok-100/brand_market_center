import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { FlowRuntime } from '../flow-runtime.mjs';
import { FlowBlueprints } from '../flow-blueprints.mjs';
import { LiveSessionFlow } from '../live-session-flow.mjs';
import { createFlowHandler } from '../flow-http.mjs';
import { versionedDocumentStore } from '../document_store_mysql.mjs';
import { WorkflowStore } from '../workflow-store.mjs';

const now = Date.parse('2026-10-10T03:00:00Z');
const a = { enabled: true, canManage: true, department: false, modules: ['workflow-engine', 'material-workbench', 'live-room-management'],
  user: { number: 'SELF', name: '本人', center: 'A', role: 'manager' } };
function task(i, { center = 'A', state = 'running', owner = 'SELF', live = false } = {}) {
  return { id: 'task_' + i, title: '任务 ' + i, center, workflow: live ? '04' : '02', assignee: { number: owner, name: owner },
    updatedAt: new Date(now - i * 1000).toISOString(), runtime: { state, participants: [owner], manager: a.user,
      ...(live ? { liveSession: { date: '2026-10-10', startAt: new Date(now).toISOString() } } : {}),
      nodes: [{ id: 'node_' + i, title: '节点 ' + i, state: state === 'completed' ? 'completed' : 'ready', owner: { number: owner, name: owner },
        dueAt: new Date(now + i * 1000).toISOString(), dependencies: [], liveStage: '执行' }] } };
}
function fixture() {
  let reads = 0;
  const state = { schemaVersion: 3, tasks: [...Array.from({ length: 20 }, (_, i) => task(i)), task(30, { center: 'B', owner: 'OTHER' }), task(31, { state: 'completed' })],
    flowEvents: [{ taskId: 'task_0', privateLargeEvidence: 'not needed on home' }],
    flowNotifications: [{ taskId: 'task_0', state: 'attention' }, { taskId: 'task_30', state: 'attention' }],
    flowBlueprintRevisions: [{ active: true, scope: 'center', center: 'A', name: '本中心', version: 1, defaultRoute: true, moduleOrder: ['02', '04'] }] };
  const store = { read() { throw new Error('home must not use synchronous storage'); }, async readAsync() { reads++; await delay(20); return structuredClone(state); } };
  const runtime = new FlowRuntime(store, { clock: () => now }); runtime.blueprints = new FlowBlueprints(runtime);
  return { runtime, store, state, get reads() { return reads; } };
}

test('home projection is bounded, full metrics remain correct, and other-center data is filtered', async () => {
  const f = fixture(), result = await f.runtime.homeOverview(a);
  assert.equal(f.reads, 1); assert.equal(result.tasks.length, 6); assert.equal(result.myReadyCount, 20);
  assert.equal(result.metrics.active, 20); assert.equal(result.metrics.notificationAttention, 1);
  assert.equal(result.totalVisibleTaskCount, 21); assert.equal(result.pagination.total, 20); assert.equal(result.hasMore, true);
  assert.equal(result.blueprint.name, '本中心'); assert.equal(result.executionRoutes.length, 2);
  assert.doesNotMatch(JSON.stringify(result), /task_30|not needed on home|privateLargeEvidence/);
  const second = await f.runtime.homeOverview(a, { page: 2 });
  assert.equal(second.tasks[0].id, 'task_6');
  const ended = await f.runtime.homeOverview(a, { filter: 'ended' }); assert.deepEqual(ended.tasks.map(t => t.id), ['task_31']);
  const search = await f.runtime.homeOverview(a, { query: '任务 19' }); assert.deepEqual(search.tasks.map(t => t.id), ['task_19']);
});

test('specialist only sees participant tasks and no management blueprint', async () => {
  const f = fixture(); f.state.tasks.push(task(40, { owner: 'COLLEAGUE' }));
  const result = await f.runtime.homeOverview({ ...a, canManage: false, user: { ...a.user, role: 'specialist' } });
  assert.equal(result.pagination.filter, 'active'); assert.equal(result.totalVisibleTaskCount, 21);
  assert.equal(result.blueprint, undefined); assert.equal(result.executionRoutes, undefined);
  assert.doesNotMatch(JSON.stringify(result), /COLLEAGUE|task_40/);
});

test('delayed storage leaves the event loop available while home is loading', async () => {
  const f = fixture(); let finished = false;
  const read = f.runtime.homeOverview(a).then(() => { finished = true; });
  await delay(0); assert.equal(finished, false); await read;
});

test('live today uses one async snapshot and keeps the previous response fields', async () => {
  const f = fixture(); f.state.tasks = [task(1, { live: true }), task(2, { live: true, center: 'B', owner: 'OTHER' })];
  f.state.liveDispatchStatus = { state: 'ready', checkedAt: new Date(now).toISOString(), issues: [] };
  const live = new LiveSessionFlow(f.runtime, { clock: () => now, enabled: true });
  const result = await live.todayAsync(a);
  assert.equal(f.reads, 1); assert.equal(result.items.length, 1); assert.equal(result.dispatch.state, 'ready');
  assert.equal(result.canManage, true); assert.equal(result.date, '2026-10-10');
  await assert.rejects(live.todayAsync({ ...a, modules: ['workflow-engine'] }), error => error.status === 403);
  assert.equal(f.reads, 1, 'denial must happen before storage');
});

test('home and live HTTP routes preserve session, module, preview and configuration-only gates', async () => {
  const f = fixture(); const live = new LiveSessionFlow(f.runtime, { clock: () => now });
  let session = { status: 200, payload: {} }, access = a, preview = null;
  const handler = createFlowHandler({ runtime: f.runtime, liveSessions: live, currentSession: async () => session,
    accessFor: () => access, previewFor: () => preview, sendJson: (response, status, payload) => Object.assign(response, { status, payload }) });
  const request = async path => { const response = {}; await handler({ method: 'GET', headers: {} }, response, new URL('http://example.test/api/flows/' + path)); return response; };
  assert.equal((await request('home-overview')).status, 200); assert.equal((await request('live/today')).status, 200);
  const reads = f.reads;
  session = { status: 401, payload: { detail: 'expired' } }; assert.equal((await request('home-overview')).status, 401);
  session = { status: 200, payload: {} }; access = { ...a, enabled: false }; assert.equal((await request('home-overview')).status, 403);
  access = a; preview = { active: true }; assert.equal((await request('home-overview')).status, 403);
  preview = null; access = { ...a, configurationOnly: true }; assert.equal((await request('home-overview')).status, 403);
  assert.equal(f.reads, reads);
});

test('concurrent async document reads share transport but return independent snapshots', async () => {
  let calls = 0; const data = { schemaVersion: 3, tasks: [] };
  const documents = versionedDocumentStore({ call() { throw new Error('sync read not allowed'); }, async callAsync() {
    calls++; await delay(20); return { exists: true, version: 1, data: JSON.stringify(data) };
  } }, 'test-document');
  const store = Object.create(WorkflowStore.prototype); store.documents = documents;
  const [first, second] = await Promise.all([store.readAsync(), store.readAsync()]);
  assert.equal(calls, 1); first.tasks.push({ id: 'local-mutation' }); assert.equal(second.tasks.length, 0);
  await store.readAsync(); assert.equal(calls, 2, 'next read still validates the storage version; no stale TTL for writes');
});

test('failed async storage read clears its in-flight slot so the next request can recover', async () => {
  let calls = 0;
  const documents = versionedDocumentStore({ async callAsync() {
    calls++; if (calls === 1) throw new Error('storage unavailable');
    return { exists: true, version: 1, data: JSON.stringify({ schemaVersion: 3, tasks: [] }) };
  } }, 'test-document');
  await assert.rejects(documents.snapshotAsync(), /storage unavailable/);
  assert.equal((await documents.snapshotAsync()).version, 1); assert.equal(calls, 2);
});

test('shared reads preserve compare-and-swap conflicts between concurrent writes', async () => {
  let version = 1, saved = { schemaVersion: 3, tasks: [] };
  const documents = versionedDocumentStore({ async callAsync(method, args) {
    if (method === 'readFile' || method === 'readTextIfChanged') {
      const snapshot = { exists: true, version, data: JSON.stringify(saved) }; await delay(10); return snapshot;
    }
    assert.equal(method, 'writeFile');
    if (args[1] !== version) throw new Error('version conflict');
    saved = JSON.parse(args[2]); version++; return { version };
  } }, 'test-document');
  const store = Object.create(WorkflowStore.prototype); store.documents = documents;
  const results = await Promise.allSettled(['first', 'second'].map(id => store.transactionAsync(state => { state.tasks.push({ id }); return id; })));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.find(result => result.status === 'rejected').reason.status, 503);
  assert.equal(saved.tasks.length, 1); assert.equal(version, 2);
});

test('a late async read cannot roll the document cache back after a local commit', async () => {
  let release;
  const documents = versionedDocumentStore({
    call(method) { assert.equal(method, 'writeFile'); return { version: 2 }; },
    callAsync() { return new Promise(done => { release = done; }); },
  }, 'test-document');
  const reading = documents.snapshotAsync();
  documents.commit(1, { schemaVersion: 3, tasks: [{ id: 'just-written' }] });
  release({ exists: true, version: 1, data: JSON.stringify({ schemaVersion: 3, tasks: [] }) });
  const snapshot = await reading;
  assert.equal(snapshot.version, 2); assert.equal(snapshot.data.tasks[0].id, 'just-written');
});
