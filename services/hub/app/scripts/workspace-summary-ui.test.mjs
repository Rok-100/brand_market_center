import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const ts = createRequire(import.meta.url)('typescript');
const compile = path => ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
}).outputText;
const compiled = new Map(['api', 'WorkspacePublicSummary', 'sourceTime', 'businessDate'].map(name => [name,
  compile(`../src/${name}.${name === 'WorkspacePublicSummary' ? 'tsx' : 'ts'}`)]));
const session = { user: { number: 'TEST' }, workspace: { role: 'director', dashboard_scope: 'department', can_view_public_summary: true },
  access: { allowed_modules: ['data-dashboard'], policy_state: 'live' } };
const valid = () => ({ status: 'ready', refreshing: false, generatedAt: '2026-10-10T03:00:00Z', totalGsvYuan: 300000,
  channels: ['douyin', 'wechat'].map((key, i) => ({ key, label: i ? '视频号' : '抖店', todayDate: '2026-10-10',
    todayTotalYuan: (i + 1) * 100000, state: 'ready', sourceUpdatedAt: '2026-10-10T03:00:00Z', stale: false })),
  lastAttemptAt: '2026-10-10T03:00:00Z', lastSuccessAt: '2026-10-10T03:00:00Z', nextRetryAt: null, lastError: null, note: '真实测试夹具' });
const tick = () => new Promise(setImmediate);

// Run the actual API and component modules. Only DOM scheduling, JSX and React
// hooks are supplied by this small harness; no browser, auth or production call.
function harness() {
  let response = { status: 200, payload: valid() }, slots = [], cursor = 0, effects = [], timerId = 0, tree;
  const timers = new Map(), listeners = new Map(), requests = [], modules = new Map();
  const window = { setTimeout(fn, ms) { const id = ++timerId; timers.set(id, { fn, ms }); return id; }, clearTimeout(id) { timers.delete(id); } };
  const document = { hidden: false, addEventListener(name, fn) { listeners.set(name, fn); }, removeEventListener(name, fn) { if (listeners.get(name) === fn) listeners.delete(name); } };
  const react = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = { value: typeof initial === 'function' ? initial() : initial };
      return [slots[i].value, value => { slots[i].value = typeof value === 'function' ? value(slots[i].value) : value; }]; },
    useRef(initial) { const i = cursor++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; },
    useEffect(fn, deps) { const i = cursor++, previous = slots[i];
      if (!previous || deps.some((value, index) => value !== previous.deps[index])) {
        effects.push(() => { previous?.cleanup?.(); slots[i] = { deps, cleanup: fn() }; });
      }
    },
  };
  const fetch = async (path, options) => {
    requests.push({ path, options });
    if (typeof response === 'function') return response(path, options);
    const saved = response;
    return { ok: saved.status >= 200 && saved.status < 300, status: saved.status,
      async json() { if (saved.html) throw new SyntaxError('Unexpected token <'); return saved.payload; } };
  };
  const context = vm.createContext({ window, document, fetch, AbortController, AbortSignal, Error, Date, Intl, URLSearchParams, URL });
  function load(name) {
    if (modules.has(name)) return modules.get(name);
    const exports = {}; modules.set(name, exports);
    const require = path => path === 'react' ? react : path === 'react/jsx-runtime'
      ? { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) }
      : path === '@fluentui/react-icons' ? { ArrowClockwiseRegular: () => null }
        : path.startsWith('./') ? load(path.slice(2)) : (() => { throw new Error('Unexpected import ' + path); })();
    const run = vm.runInContext(`(function(exports, require) {${compiled.get(name)}\n})`, context);
    run(exports, require); return exports;
  }
  const apiModule = load('api'), component = load('WorkspacePublicSummary');
  function render(input = session) { cursor = 0; tree = component.WorkspacePublicSummary({ session: input });
    const pending = effects; effects = []; pending.forEach(run => run()); return tree; }
  function find(node, predicate) {
    if (!node || typeof node !== 'object') return null;
    if (predicate(node)) return node;
    const children = Array.isArray(node) ? node : node.props?.children;
    for (const child of Array.isArray(children) ? children : [children]) { const found = find(child, predicate); if (found) return found; }
    return null;
  }
  return { ...apiModule, requests, timers, document,
    response(value) { response = value; }, render,
    async flush() { await tick(); return render(); },
    text() { return JSON.stringify(render(), (key, value) => typeof value === 'function' ? undefined : value); },
    refresh() { find(render(), node => node.type === 'button' && node.props.className === 'summary-refresh').props.onClick(); },
    unmount() { for (const slot of slots) slot?.cleanup?.(); slots = []; effects = []; },
  };
}

test('API rejects HTML login responses and malformed successful payloads as ApiError 502', async () => {
  const f = harness();
  const cases = [null, {}, [], { ...valid(), status: 'unknown' }, { ...valid(), status: { toString: 'ready' } },
    { ...valid(), channels: [] }, { ...valid(), channels: [valid().channels[0], valid().channels[0]] },
    { ...valid(), totalGsvYuan: '300000' }, { ...valid(), totalGsvYuan: Infinity },
    { ...valid(), generatedAt: '2026-02-30T03:00:00Z' }, { ...valid(), lastError: { message: {} } }];
  for (const change of [
    { todayTotalYuan: '100000' }, { todayTotalYuan: NaN }, { todayDate: '2026-02-30' },
    { todayDate: '2026-10-09' }, { state: 'unknown' }, { sourceUpdatedAt: {} }, { unavailableReason: {} },
  ]) { const value = valid(); Object.assign(value.channels[0], change); cases.push(value); }
  for (const payload of cases) {
    f.response({ status: 200, payload });
    await assert.rejects(f.api.workspaceSummary(), error => error instanceof f.ApiError && error.status === 502);
  }
  f.response({ status: 200, html: '<html>login</html>' });
  await assert.rejects(f.api.workspaceSummary(), error => error instanceof f.ApiError && error.status === 502);
});

test('API accepts stable pending channels, verified zeros and partial/stale snapshots without inventing data', async () => {
  const f = harness();
  for (const status of ['ready', 'partial', 'stale', 'pending']) {
    const value = valid(); value.status = status;
    if (status === 'pending') { value.generatedAt = null; value.totalGsvYuan = null;
      value.channels.forEach(channel => Object.assign(channel, { todayTotalYuan: null, todayDate: null, sourceUpdatedAt: null, state: 'pending' }));
    } else { value.totalGsvYuan = 0; value.channels.forEach(channel => { channel.todayTotalYuan = 0; }); }
    f.response({ status: 200, payload: value });
    const signal = new AbortController().signal, result = await f.api.workspaceSummary(true, signal);
    assert.equal(result, value); assert.equal(result.totalGsvYuan, status === 'pending' ? null : 0);
    assert.equal(f.requests.at(-1).path, 'api/workspace-home/summary?refresh=1');
    assert.equal(f.requests.at(-1).options.signal, signal); assert.equal(f.requests.at(-1).options.cache, 'no-store');
  }
});

test('real component keeps its last good snapshot after malformed 200 or HTML instead of crashing', async () => {
  const f = harness(); f.render(); await f.flush(); assert.match(f.text(), /¥30\.00万/);
  for (const bad of [{ status: 200, payload: {} }, { status: 200, html: '<html>login</html>' }]) {
    f.response(bad); f.refresh(); await f.flush();
    const text = f.text(); assert.match(text, /¥30\.00万/); assert.match(text, /暂时未连接/); assert.match(text, /保留最近成功数值/);
    assert.ok([...f.timers.values()].some(timer => timer.ms === 30_000));
  }
  f.unmount();
});

test('real component does not show fabricated zero on cold malformed 200', async () => {
  const f = harness(); f.response({ status: 200, payload: {} }); f.render(); await f.flush();
  const text = f.text(); assert.match(text, /暂时未连接/); assert.match(text, /待核验/); assert.doesNotMatch(text, /¥0\.00万/);
  f.unmount();
});

for (const status of [401, 403]) test(`HTTP ${status} clears component and remount cache`, async () => {
  const f = harness(); f.render(); await f.flush(); assert.match(f.text(), /¥30\.00万/);
  f.response({ status, payload: { detail: 'expired' } }); f.refresh(); await f.flush();
  assert.match(f.text(), /登录或数据权限已变化/); assert.doesNotMatch(f.text(), /¥30\.00万/);
  f.unmount();
  f.response(() => new Promise(() => {})); f.render();
  assert.doesNotMatch(f.text(), /¥30\.00万/, 'module-level cached snapshot must also be cleared');
  f.unmount();
});

test('unmount aborts the actual summary request and ignores a late successful response', async () => {
  const f = harness(); let resolve;
  f.response(() => new Promise(done => { resolve = done; })); f.render();
  const signal = f.requests[0].options.signal; assert.equal(signal.aborted, false);
  f.unmount(); assert.equal(signal.aborted, true);
  resolve({ ok: true, status: 200, json: async () => valid() }); await tick();
  f.response(() => new Promise(() => {})); f.render(); assert.doesNotMatch(f.text(), /¥30\.00万/); f.unmount();
});

test('a different API retains its existing response behavior', async () => {
  const f = harness(); f.response({ status: 200, payload: {} });
  assert.deepEqual(await f.api.organizationEntries(), {});
});
