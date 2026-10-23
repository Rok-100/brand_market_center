import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { FlowRuntime } from '../flow-runtime.mjs';
import { FlowAutomation } from '../flow-automation.mjs';
import { FlowBlueprints } from '../flow-blueprints.mjs';
import { WorkflowStore } from '../workflow-store.mjs';
import { versionedDocumentStore } from '../document_store_mysql.mjs';

// Real store/CAS code over an isolated memory transport. No server or sender.
const now = Date.parse('2026-10-10T04:00:00Z');
const owner = { number: 'OWNER', name: '主责', center: 'A', role: 'specialist', active: true };
const manager = { number: 'MANAGER', name: '主管', center: 'A', role: 'manager', active: true };
const blank = () => ({ schemaVersion: 3, tasks: [], flowEvents: [], flowNotifications: [], flowDedupe: { preserved: { hash: 'original' } } });
function fixture(initial = blank(), { asyncOnly = false, latency = 0 } = {}) {
  let saved = structuredClone(initial), version = 1, reads = 0, writes = 0, syncCalls = 0;
  const f = { beforeRead: null, beforeWrite: null, people: [owner, manager],
    state: () => structuredClone(saved),
    externalEdit(fn) { fn(saved); version++; },
    stats: () => ({ reads, writes, syncCalls }),
  };
  const rpc = (method, args) => {
    if (method === 'readFile' || method === 'readTextIfChanged') {
      reads++; f.beforeRead?.(reads);
      return method === 'readTextIfChanged' && args[1] === version ? { unchanged: true }
        : { exists: true, version, data: JSON.stringify(saved) };
    }
    assert.equal(method, 'writeFile'); writes++; f.beforeWrite?.(writes);
    if (args[1] !== version) throw Error('CAS conflict');
    saved = JSON.parse(args[2]); return { version: ++version };
  };
  const store = Object.create(WorkflowStore.prototype);
  store.documents = versionedDocumentStore({
    call(method, args) { syncCalls++; assert.equal(asyncOnly, false, 'async background must never call sync RPC'); return rpc(method, args); },
    async callAsync(method, args) { if (latency) await delay(latency); return rpc(method, args); },
  }, 'local-fixture');
  f.store = store;
  f.runtime = new FlowRuntime(store, { people: () => f.people, clock: () => now, env: {} });
  return f;
}
function comparable(value) {
  const data = structuredClone(value); delete data.updatedAt;
  const ids = new Map();
  return JSON.parse(JSON.stringify(data).replace(/\b(?:flowevt|notice|task)_[a-f0-9]{32}\b/g, id => {
    if (!ids.has(id)) ids.set(id, `generated_${ids.size}`);
    return ids.get(id);
  }));
}
function overdueState() {
  const state = blank();
  state.tasks.push({ id: 'existing_task', version: 2, workflow: '02', center: 'A', status: 'in_progress',
    assignee: owner, title: '已有任务', runtime: { state: 'running', manager, participants: ['OWNER', 'MANAGER'],
      nodes: [{ id: 'node', title: '已有节点', owner: { number: 'DEPARTED', name: '旧主责' }, state: 'ready', attempt: 1,
        dueAt: new Date(now - 2*86400000).toISOString(), dependencies: [], evidence: [] }] } });
  return state;
}
function automationFixture(options = {}) {
  const state = blank();
  state.flowAutomationWatches = [{ jobId: 'job', enabled: true, owner, manager, slaHours: 4,
    configuredBy: manager, createdAt: new Date(now-86400000).toISOString(), initialRunId: 'run' }];
  const f = fixture(state, options);
  f.view = { sources: [{ id: 'cloud', state: 'connected' }, { id: 'remix', state: 'connected' }], renders: [],
    jobs: [{ id: 'job', owner: owner.number, product: '水润面膜', name: '既有批次', pushEnabled: false,
      runs: [{ id: 'run', target: 1, state: 'running', date: '2026-10-10', startedAt: new Date(now).toISOString(), stages: [] }] }] };
  f.automation = new FlowAutomation(f.runtime, { view: () => structuredClone(f.view) }, { env: {} });
  return f;
}
function complete(f) {
  const run = f.view.jobs[0].runs[0]; run.state = 'completed';
  run.stages = ['source_selection','source_slicing','clip_calibration','clip_review','remix_generation'].map(key => ({key,state:'completed'}));
  f.view.renders = [{ automation: { jobId: 'job', runId: 'run' }, variants: [{ filePresent: true, sha256: 'verified-hash', duration: 30,
    review: 'approved', assessment: 'passed', autoApproved: true, sourceClipsApproved: true,
    visualReview: { status: 'passed', sha256: 'verified-hash', version: 'v1', confidence: 0.99, issues: [] },
    returnVerified: true, cloudReview: { status: 'approved' }, receipts: [] }] }];
}
function attachBlueprint(f, { sourceBranch = false } = {}) {
  f.runtime.blueprints = new FlowBlueprints(f.runtime);
  const definition = f.runtime.blueprints.default({ enabled: true, canManage: true, user: manager,
    modules: ['material-workbench','cloud-manager'] });
  definition.moduleOrder = ['02','03']; definition.publishedBy = manager;
  definition.defaultRoute = !sourceBranch;
  if (sourceBranch) definition.branches = [{ id: 'deadline', enabled: true, after: '02', event: 'source', when: 'node_overdue', next: '03' }];
  f.externalEdit(state => {
    if (state.flowAutomationWatches) state.flowAutomationWatches[0].blueprint = definition;
    else { state.tasks[0].runtime.blueprint = definition; state.tasks[0].acceptance = '核验原业务交付'; }
  });
}

test('async runtime preserves assignment, overdue, escalation and deduplication outcomes', async () => {
  const sync = fixture(overdueState()), async = fixture(overdueState(), { asyncOnly: true, latency: 1 });
  sync.runtime.tick(); await async.runtime.tickAsync();
  assert.deepEqual(comparable(async.state()), comparable(sync.state()));
  assert.deepEqual(async.state().flowNotifications.map(n => n.kind), ['assignment_attention','overdue','escalated']);
  const before = comparable(async.state()); await async.runtime.tickAsync();
  assert.deepEqual(comparable(async.state()), before);
  assert.equal(async.stats().syncCalls, 0);
});

test('async automation matches sync start, completion, reopened evidence, and failure dedupe', async () => {
  const sync = automationFixture(), async = automationFixture({ asyncOnly: true, latency: 1 });
  const compare = () => assert.deepEqual(comparable(async.state()), comparable(sync.state()));
  sync.automation.reconcile(); await async.automation.reconcileAsync(); compare();
  assert.equal(async.state().tasks.length, 1);
  const started = comparable(async.state()); await async.automation.reconcileAsync();
  assert.deepEqual(comparable(async.state()), started);
  complete(sync); complete(async);
  sync.automation.reconcile(); await async.automation.reconcileAsync(); compare();
  assert.equal(async.state().tasks[0].runtime.state, 'completed');
  assert.equal(async.state().flowNotifications.filter(n => n.kind === 'completed').length, 2);
  sync.view.renders[0].variants[0].review = 'changes_requested'; async.view.renders[0].variants[0].review = 'changes_requested';
  sync.automation.reconcile(); await async.automation.reconcileAsync(); compare();
  assert.equal(async.state().tasks[0].runtime.state, 'running');
  const sw = sync.state().flowAutomationWatches[0], aw = async.state().flowAutomationWatches[0];
  sync.automation.recordFailure(sw, 'run'); await async.automation.recordFailureAsync(aw, 'run'); compare();
  const failed = comparable(async.state()); await async.automation.recordFailureAsync(aw, 'run');
  assert.deepEqual(comparable(async.state()), failed);
  assert.equal(async.stats().syncCalls, 0);
});

test('slow async storage leaves timers available for idle and mutating background work', async () => {
  for (const f of [fixture(blank(), { asyncOnly: true, latency: 25 }), fixture(overdueState(), { asyncOnly: true, latency: 25 })]) {
    let done = false;
    const work = f.runtime.tickAsync().then(() => { done = true; });
    await delay(0); assert.equal(done, false); await work;
    assert.equal(f.stats().syncCalls, 0);
  }
  const f = automationFixture({ asyncOnly: true, latency: 25 }); let done = false;
  const work = f.automation.reconcileAsync().then(() => { done = true; });
  await delay(0); assert.equal(done, false); await work;
  assert.equal(f.stats().syncCalls, 0);
});

test('real blueprint overdue branches reuse the transaction snapshot without nested synchronous RPC', async () => {
  const sync = fixture(overdueState()), async = fixture(overdueState(), { asyncOnly: true });
  attachBlueprint(sync, { sourceBranch: true }); attachBlueprint(async, { sourceBranch: true });
  sync.runtime.tick(); await async.runtime.tickAsync();
  assert.deepEqual(comparable(async.state()), comparable(sync.state()));
  assert.equal(async.state().tasks.length, 2);
  assert.ok(async.state().tasks[0].runtime.blueprintTriggers['source:node_overdue']);
  assert.equal(async.runtime.transactionSnapshot, undefined); assert.equal(async.stats().syncCalls, 0);
  const before = comparable(async.state()); await async.runtime.tickAsync(); assert.deepEqual(comparable(async.state()), before);
});

test('real blueprint completion handoff stays atomic and async without changing downstream business records', async () => {
  const sync = automationFixture(), async = automationFixture({ asyncOnly: true });
  attachBlueprint(sync); attachBlueprint(async); complete(sync); complete(async);
  sync.automation.reconcile(); await async.automation.reconcileAsync();
  assert.deepEqual(comparable(async.state()), comparable(sync.state()));
  assert.equal(async.state().tasks.length, 2);
  assert.equal(async.state().tasks[0].runtime.handoff.state, 'dispatched');
  assert.equal(async.runtime.transactionSnapshot, undefined); assert.equal(async.stats().syncCalls, 0);
  const before = comparable(async.state()); await async.automation.reconcileAsync(); assert.deepEqual(comparable(async.state()), before);
});

test('runtime CAS conflict commits no partial notices and recovers on the next tick', async () => {
  const f = fixture(overdueState(), { asyncOnly: true });
  f.beforeWrite = count => { if (count === 1) f.externalEdit(state => { state.externalFact = 'preserved'; }); };
  await assert.rejects(f.runtime.tickAsync(), error => error.status === 503);
  assert.equal(f.state().flowNotifications.length, 0);
  await f.runtime.tickAsync(); assert.equal(f.state().externalFact, 'preserved');
  assert.equal(f.state().flowNotifications.length, 3);
  const before = comparable(f.state()); await f.runtime.tickAsync(); assert.deepEqual(comparable(f.state()), before);
});

test('automation CAS conflict records pending evidence and resumes once without duplicate tasks', async () => {
  const f = automationFixture({ asyncOnly: true });
  f.beforeWrite = count => { if (count === 1) f.externalEdit(state => { state.externalFact = 'preserved'; }); };
  await f.automation.reconcileAsync();
  assert.equal(f.state().tasks.length, 0); assert.ok(f.state().flowAutomationWatches[0].reconcileIssue);
  await f.automation.reconcileAsync();
  assert.equal(f.state().tasks.length, 1); assert.equal(f.state().flowAutomationWatches[0].reconcileIssue, undefined);
  assert.equal(f.state().externalFact, 'preserved');
  const before = comparable(f.state()); await f.automation.reconcileAsync(); assert.deepEqual(comparable(f.state()), before);
});

test('async waits recheck watch edits and the current assignment roster before mutating', async () => {
  const a = automationFixture({ asyncOnly: true });
  a.beforeRead = count => { if (count === 3) a.externalEdit(state => { state.flowAutomationWatches[0].enabled = false; }); };
  await a.automation.reconcileAsync();
  assert.equal(a.state().tasks.length, 0); assert.equal(a.state().flowNotifications.length, 0);
  const r = fixture(overdueState(), { asyncOnly: true });
  r.beforeRead = count => { if (count === 2) r.people = []; };
  await r.runtime.checkAssignmentsAsync();
  assert.equal(r.state().flowNotifications.length, 0);
});

test('revoked root evidence during storage read cannot complete the task or dispatch a blueprint child', async () => {
  const f = automationFixture({ asyncOnly: true }); attachBlueprint(f); complete(f);
  f.beforeRead = count => {
    if (count === 3) {
      f.view.renders[0].variants[0].cloudReview.status = 'changes_requested';
      f.view.renders[0].variants[0].returnVerified = false;
    }
  };
  await f.automation.reconcileAsync();
  assert.equal(f.state().tasks.length, 0); assert.equal(f.state().flowNotifications.length, 0);
  assert.equal(f.stats().writes, 0);
  await f.automation.reconcileAsync();
  assert.equal(f.state().tasks.length, 1); assert.equal(f.state().tasks[0].runtime.state, 'running');
  assert.equal(f.state().tasks[0].runtime.handoff, undefined);
  assert.equal(f.state().flowNotifications.filter(n => n.kind === 'completed').length, 0);
});

test('source disconnection during storage read defers all task and notification writes until recovery', async () => {
  for (const channel of ['cloud','remix']) {
    const f = automationFixture({ asyncOnly: true }); attachBlueprint(f); complete(f);
    f.beforeRead = count => { if (count === 3) f.view.sources.find(source => source.id === channel).state = 'unavailable'; };
    await f.automation.reconcileAsync();
    assert.equal(f.state().tasks.length, 0); assert.equal(f.state().flowNotifications.length, 0);
    assert.equal(f.stats().writes, 0);
    await f.automation.reconcileAsync(); assert.equal(f.state().tasks.length, 0);
    f.view.sources.find(source => source.id === channel).state = 'connected';
    await f.automation.reconcileAsync();
    assert.equal(f.state().tasks.length, 2); assert.equal(f.state().tasks[0].runtime.handoff.state, 'dispatched');
    const before = comparable(f.state()); await f.automation.reconcileAsync(); assert.deepEqual(comparable(f.state()), before);
  }
});

test('the actual five-second callback awaits both async phases and prevents overlap, including failure', async () => {
  const source = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
  const start = source.indexOf('let flowTickBusy=false;'), end = source.indexOf('// Keep Feishu source latency', start);
  assert.ok(start >= 0 && end > start);
  let callback, release, fail = false, reconciles = 0, ticks = 0, flushes = 0;
  const jobs = [], gate = new Promise(resolve => { release = resolve; });
  new Function('setInterval','shutdown','flowExecution','productionSources','flowAutomation','flowRuntime','flowNotifier','console', source.slice(start,end))(
    fn => { callback = fn; return { unref() {} }; },
    { draining: false, trackBackground(name, work) { const job = work(); jobs.push(job); return job; } },
    { backgroundEnabled: true }, null,
    { async reconcileAsync() { reconciles++; await gate; if (fail) throw Error('temporary storage failure'); } },
    { async tickAsync() { ticks++; await delay(2); } },
    { async flush() { flushes++; } }, { error() {} });
  callback(); callback(); await delay(0);
  assert.equal(reconciles, 1); assert.equal(ticks, 0); assert.equal(jobs.length, 1);
  callback(); assert.equal(jobs.length, 1);
  release(); await jobs[0]; assert.equal(ticks, 1); assert.equal(flushes, 1);
  fail = true; callback(); await jobs[1]; assert.equal(ticks, 1); assert.equal(flushes, 1);
  fail = false; callback(); await jobs[2]; assert.equal(ticks, 2); assert.equal(flushes, 2);
});
