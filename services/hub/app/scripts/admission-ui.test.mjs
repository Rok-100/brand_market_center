import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import {setTimeout as delay} from 'node:timers/promises';

const require = createRequire(import.meta.url), ts = require('typescript');
const compile = source => ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022}}).outputText;
const helpers = {};
vm.runInNewContext(compile(readFileSync(new URL('../src/admissionPresentation.ts', import.meta.url), 'utf8')), {exports: helpers});
const {admissionInput, admissionPresentation} = helpers;
const ok = body => ({ok: true, status: 200, json: async () => body});
function apiFixture(fetch) {
  const exports = {};
  vm.runInNewContext(compile(readFileSync(new URL('../src/api.ts', import.meta.url), 'utf8')), {exports, fetch, window: {setTimeout}, Date, Map, Set, Promise});
  return exports.api;
}
const bound = {identifier: 'number:FD-068989', real_name: '', user_number: 'FD-068989', department: '', center: '', active: true,
  identity_status: 'number_bound', admission_status: 'allowed', effective_login_active: true, allowed_modules: ['cloud-manager']};

test('工号、无连字符、小写工号均明确作为 user_number，不再保存成姓名', () => {
  for (const input of ['FD-068989', 'fd068989', ' fd-068989 ']) {
    const value = admissionInput(input); assert.equal(value.userNumber, 'FD-068989'); assert.equal(value.realName, '');
  }
  assert.equal(admissionInput('舒豪').realName, '舒豪');
  assert.equal(admissionInput('舒豪').userNumber, '');
});
test('疑似残缺工号和多人输入会被拦截，不降级为姓名授权', () => {
  for (const input of ['FD-06898x', 'FD-68', 'FD--068989', 'FD-', 'FD-068989,舒豪', '舒豪，吴为', '舒豪\n吴为']) assert.throws(() => admissionInput(input));
});
test('仅 active 不再证明可进入；姓名、冲突、禁止和撤销各自准确显示', () => {
  assert.equal(admissionPresentation({active: true}).label, '已保存 · 待核验');
  assert.equal(admissionPresentation({...bound, identity_status: 'name_pending', admission_status: 'pending', verification_required: true}).label, '姓名待核验');
  assert.equal(admissionPresentation({...bound, identity_status: 'conflict'}).label, '身份需核对');
  assert.equal(admissionPresentation({...bound, identity_status: 'conflict', admission_status: 'blocked'}).label, '身份需核对');
  assert.equal(admissionPresentation({...bound, login_blocked: true}).label, '禁止登录');
  assert.equal(admissionPresentation({...bound, admission_status: 'revoked', active: false}).label, '例外已取消');
  assert.equal(admissionPresentation(bound).label, '工号已授权');
  assert.equal(admissionPresentation({...bound, effective_login_active: false}).tone, 'pending');
});
test('保存传输保留工号字段；成功和不确定失败均废弃旧权限读取，写入不自动重试', async () => {
  let reads = 0, writes = 0, body, fail = false;
  const api = apiFixture(async (path, options) => {
    if (options?.method) {writes++; body = JSON.parse(options.body); return fail ? {ok: false, status: 503, json: async () => ({detail: {message: '权限暂不可读'}})} : ok(bound);}
    return ok({items: [{...bound, read: ++reads}]});
  });
  await api.loginGrants();
  await api.loginGrantCreate('', '', '', 'FD-068989');
  assert.equal(body.user_number, 'FD-068989'); assert.equal(body.real_name, '');
  assert.equal((await api.loginGrants()).items[0].read, 2);
  fail = true; await assert.rejects(api.loginGrantCreate('', '', '', 'FD-068989'), /权限暂不可读/u);
  assert.equal((await api.loginGrants()).items[0].read, 3); assert.equal(writes, 2);
});
test('管理员手动刷新准入状态绕过十五秒缓存', async () => {
  let reads = 0; const api = apiFixture(async () => ok({items: [{read: ++reads}]}));
  await api.loginGrants(); await api.loginGrants(); assert.equal(reads, 1);
  assert.equal((await api.loginGrants('', true)).items[0].read, 2);
});

function pageFixture(api) {
  const source = ts.createSourceFile('App.tsx', readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const fn = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'LoginPermissionsPage');
  const states = [], effects = [], notices = []; let index = 0;
  const exports = {};
  vm.runInNewContext(compile(fn.getText(source) + '\nexports.Page = LoginPermissionsPage;'), {
    exports, api, admissionInput, admissionPresentation, Error, TypeError,
    ApiError: class ApiError extends Error {}, isTransientApiError: () => false,
    useState: initial => {const i = index++; if (!(i in states)) states[i] = initial; return [states[i], next => {states[i] = next;}];},
    useMemo: fn => fn(), useEffect: fn => effects.push(fn),
    require: () => ({jsx: (type, props) => ({type, props}), jsxs: (type, props) => ({type, props})}),
    PageIntro: 'PageIntro', ShieldLockRegular: 'ShieldLockRegular', PermissionToolbar: 'PermissionToolbar',
    ArrowClockwiseRegular: 'ArrowClockwiseRegular', Button: 'Button', OrganizationLine: 'OrganizationLine',
    modules: [{id: 'cloud-manager', title: 'WIS云管家'}], window: {confirm: () => true},
  });
  return {render: () => {index = 0; return exports.Page({notify: message => notices.push(message)});}, effects, notices};
}
function walk(node, match) {
  if (node == null || node === false) return [];
  if (Array.isArray(node)) return node.flatMap(item => walk(item, match));
  return [...(match(node) ? [node] : []), ...(typeof node === 'object' ? walk(node.props?.children, match) : [])];
}
const element = (tree, type) => walk(tree, node => node?.type === type)[0];
const texts = tree => walk(tree, node => typeof node === 'string').join(' ');
test('实际准入页面识别工号、保存后强制读回才提示状态，并显示已授权界面', async () => {
  const calls = []; const page = pageFixture({
    loginGrants: async (...args) => {calls.push(['read', ...args]); return {items: calls.some(call => call[0] === 'write') ? [bound] : []};},
    loginGrantCreate: async (...args) => {calls.push(['write', ...args]); return bound;},
  });
  let tree = page.render(); page.effects[0](); await delay(0);
  element(tree, 'PermissionToolbar').props.onName('fd068989'); tree = page.render();
  await element(tree, 'PermissionToolbar').props.onCreate(); tree = page.render();
  const write = calls.find(call => call[0] === 'write'); assert.equal(write[1], ''); assert.equal(write[4], 'FD-068989');
  assert.deepEqual(calls.at(-1), ['read', '', true]);
  assert.match(page.notices.at(-1), /已保存并读回：工号已授权/u);
  assert.match(texts(tree), /工号已授权/u); assert.match(texts(tree), /WIS云管家/u); assert.doesNotMatch(texts(tree), /例外可登录/u);
});
test('保存成功但读回失败时不宣称准入已核验，也不重复写入', async () => {
  let writes = 0; const page = pageFixture({loginGrants: async () => {throw Error('读取失败');}, loginGrantCreate: async () => {writes++; return bound;}});
  let tree = page.render(); element(tree, 'PermissionToolbar').props.onName('FD-068989'); tree = page.render();
  await element(tree, 'PermissionToolbar').props.onCreate();
  assert.equal(writes, 1); assert.match(page.notices.at(-1), /尚未读回/u); assert.doesNotMatch(page.notices.at(-1), /已保存并读回/u);
  assert.match(texts(page.render()), /读取失败/u);
});
test('实际页面遇到保存网络结果不确定时先读回，不自动重放授权', async () => {
  let writes = 0, reads = 0; const page = pageFixture({
    loginGrantCreate: async () => {writes++; throw new TypeError('网络中断');},
    loginGrants: async () => {reads++; return {items: [bound]};},
  });
  let tree = page.render(); element(tree, 'PermissionToolbar').props.onName('FD-068989'); tree = page.render();
  await element(tree, 'PermissionToolbar').props.onCreate();
  assert.equal(writes, 1); assert.equal(reads, 1); assert.equal(page.notices.length, 0);
  assert.match(texts(page.render()), /保存结果尚未确认.*已重新读取列表/u);
});
