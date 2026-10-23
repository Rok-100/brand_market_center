import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { setTimeout as delay } from 'node:timers/promises';

const require = createRequire(import.meta.url), ts = require('typescript');
const compile = source => ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022,
} }).outputText;
function apiFixture(fetch = () => { throw Error('unexpected fetch'); }) {
  const exports = {}, context = vm.createContext({ exports, fetch, window: { setTimeout },
    setTimeout, clearTimeout, AbortController, DOMException, Date, Map, Set, Promise });
  vm.runInContext(compile(readFileSync(new URL('../src/api.ts', import.meta.url), 'utf8')), context);
  return exports;
}
const { createSessionRequest, ApiError, isTransientApiError } = apiFixture();
const gate = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const flush = () => delay(0);
const response = body => ({ ok: true, status: 200, json: async () => body });
const session = number => ({ user: { number }, permissions: {}, workspace: {}, access: { allowed_modules: [], modules: [] } });

test('concurrent session readers share only the current flight, never a successful permission cache', async () => {
  const waiting = gate(); let calls = 0;
  const request = createSessionRequest(async () => { calls++; await waiting.promise; return session('STAFF'); }, isTransientApiError);
  const first = request.get(), second = request.get();
  await flush(); assert.equal(calls, 1);
  waiting.resolve(); await Promise.all([first, second]);
  await request.get(); assert.equal(calls, 2);
});

test('a timeout retry uses a fresh signal and the complete retry sequence is bounded', async () => {
  const signals = [];
  const request = createSessionRequest(signal => {
    signals.push(signal);
    return new Promise((_, reject) => signal.addEventListener('abort', () => reject(new DOMException('timeout', 'AbortError')), { once: true }));
  }, isTransientApiError, { attemptTimeoutMs: 10, retryDelayMs: 1 });
  await assert.rejects(request.get(), error => error.name === 'AbortError');
  assert.equal(signals.length, 2); assert.notEqual(signals[0], signals[1]);
  assert.ok(signals.every(signal => signal.aborted));
});

for (const status of [401, 403]) test(`${status} is immediate, is not retried, and is not replaced by earlier success`, async () => {
  let calls = 0;
  const request = createSessionRequest(async () => {
    calls++; if (calls === 1) return session('STAFF'); throw new ApiError('denied', status);
  }, isTransientApiError, { retryDelayMs: 1 });
  await request.get();
  await assert.rejects(request.get(), error => error.status === status);
  assert.equal(calls, 2);
});

test('one subscriber cancelling does not cancel a remaining reader; all readers cancelling stop the request', async () => {
  const waiting = gate(); let transportSignal;
  const request = createSessionRequest(async signal => { transportSignal = signal; await waiting.promise; return 'current'; }, isTransientApiError);
  const firstController = new AbortController(), secondController = new AbortController();
  const first = request.get(firstController.signal), second = request.get(secondController.signal);
  await flush(); firstController.abort(); await assert.rejects(first, error => error.name === 'AbortError');
  assert.equal(transportSignal.aborted, false);
  secondController.abort(); await assert.rejects(second, error => error.name === 'AbortError');
  assert.equal(transportSignal.aborted, true);
  waiting.resolve(); await flush();
});

test('reset rejects a late result from an earlier identity and allows a fresh session', async () => {
  const waiting = gate(); let calls = 0;
  const request = createSessionRequest(async () => { if (++calls === 1) { await waiting.promise; return 'OLD'; } return 'NEW'; }, isTransientApiError);
  const old = request.get(); const oldRejected = assert.rejects(old, error => error.name === 'AbortError');
  await flush(); request.reset();
  assert.equal(await request.get(), 'NEW'); waiting.resolve(); await oldRejected;
});

test('logout clears the in-flight session and login does not reuse another identity result', async () => {
  const waiting = gate(); let reads = 0;
  const { api } = apiFixture(async (path) => {
    if (path === 'api/session') { if (++reads === 1) { await waiting.promise; return response(session('OLD')); } return response(session('NEW')); }
    return response({ ok: true });
  });
  const old = api.session(), oldRejected = assert.rejects(old, error => error.name === 'AbortError');
  await flush(); await api.hubLogout(); await api.hubLogin('TEST', 'not-a-real-credential');
  assert.equal((await api.session()).user.number, 'NEW'); waiting.resolve(); await oldRejected;
});

function appFixture(sessionRequest) {
  const source = ts.createSourceFile('App.tsx', readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const app = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'App');
  const states = [], refs = [], events = new Map(), effects = [], intervals = new Set();
  let stateIndex = 0, refIndex = 0;
  const document = { visibilityState: 'visible', addEventListener: (name, callback) => events.set(name, callback), removeEventListener: name => events.delete(name) };
  const exports = {}, context = vm.createContext({ exports, AbortController, ApiError, isTransientApiError, document,
    api: { session: sessionRequest, hubLogout: async () => ({ ok: true }) },
    require: () => ({ jsx: (type, props) => ({ type, props }) }),
    FluentProvider: 'FluentProvider', hubTheme: {}, AccessError: 'AccessError', HubShell: 'HubShell', LoadingScreen: 'LoadingScreen',
    useState: initial => { const i = stateIndex++; if (!(i in states)) states[i] = initial; return [states[i], value => { states[i] = typeof value === 'function' ? value(states[i]) : value; }]; },
    useRef: initial => { const i = refIndex++; return refs[i] ??= { current: initial }; },
    useEffect: callback => effects.push(callback),
    window: { setInterval: callback => { intervals.add(callback); return callback; }, clearInterval: callback => intervals.delete(callback),
      addEventListener: (name, callback) => events.set(name, callback), removeEventListener: name => events.delete(name) },
  });
  vm.runInContext(compile(app.getText(source)), context);
  exports.default(); const cleanup = effects[0]();
  return { states, document, cleanup, events, intervals, render() { stateIndex = 0; refIndex = 0; return exports.default(); } };
}

test('initial load, focus, visibility and interval do not duplicate the same session check', async () => {
  const waiting = gate(); let calls = 0;
  const app = appFixture(async () => { calls++; await waiting.promise; return session('STAFF'); });
  app.events.get('focus')(); app.events.get('visibilitychange')(); [...app.intervals][0]();
  assert.equal(calls, 1); waiting.resolve(); await flush();
  assert.equal(app.states[0].user.number, 'STAFF'); app.cleanup();
  assert.equal(app.events.size, 0); assert.equal(app.intervals.size, 0);
});

test('permission change during an active check forces one fresh follow-up; a denied result clears the session', async () => {
  const waiting = gate(); let calls = 0;
  const app = appFixture(async () => { if (++calls === 1) { await waiting.promise; return session('STAFF'); } throw new ApiError('revoked', 403); });
  app.events.get('wis-permissions-changed')(); app.events.get('wis-permissions-changed')();
  waiting.resolve(); await flush(); assert.equal(calls, 2); assert.equal(app.states[0], null); assert.equal(app.states[1], 'revoked');
  app.events.get('focus')(); [...app.intervals][0](); assert.equal(calls, 2); app.cleanup();
});

test('initial transient failure stops automatic retries after the API budget; hidden tabs do not poll', async () => {
  let calls = 0; const app = appFixture(async () => { calls++; throw new ApiError('busy', 503); });
  await flush(); app.events.get('focus')(); [...app.intervals][0]();
  assert.equal(calls, 1); assert.equal(app.states[2], true); app.cleanup();
  let successfulCalls = 0; const activeApp = appFixture(async () => { successfulCalls++; return session('STAFF'); });
  await flush(); activeApp.document.visibilityState = 'hidden'; activeApp.events.get('focus')(); [...activeApp.intervals][0]();
  assert.equal(successfulCalls, 1); activeApp.cleanup();
});

test('effect cleanup aborts pending verification and ignores late permission results', async () => {
  const waiting = gate(); let signal;
  const app = appFixture(async currentSignal => { signal = currentSignal; await waiting.promise; return session('OLD'); });
  app.cleanup(); assert.equal(signal.aborted, true); waiting.resolve(); await flush(); assert.equal(app.states[0], null);
});
