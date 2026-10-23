import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspaceSummaryReader, mergeRealtimeSnapshot, normalizePublicRealtime } from '../workspace-summary.mjs';

const now = Date.parse('2026-10-10T03:00:00Z');
const iso = value => new Date(value).toISOString();
function payload({ date = '2026-10-10', at = now, totals = [100, 200], states = ['ready', 'ready'] } = {}) {
  return { generatedAt: iso(at), status: 'ready', channels: ['douyin', 'wechat'].map((key, i) => ({
    key, label: key, state: states[i], todayDate: date, sourceUpdatedAt: iso(at), todayTotalYuan: totals[i], unavailableReason: null,
  })) };
}
function fixture(initial = null) {
  let snapshot = initial, time = now, result = { status: 200, payload: payload() }, calls = 0;
  const reader = createWorkspaceSummaryReader({ readSnapshot: () => snapshot,
    writeSnapshot: next => { snapshot = next; }, fetchSnapshot: async request => { calls++; return typeof result === 'function' ? result(request) : result; },
    keyFor: request => request.key, clock: () => time });
  return { reader, request: { key: 'A' }, get snapshot() { return snapshot; }, get calls() { return calls; },
    result(value) { result = value; }, advance(ms) { time += ms; } };
}

test('stable channels on cold start, and a verified zero remains zero', async () => {
  const f = fixture(); f.result({ status: 200, payload: payload({ totals: [0, 0] }) });
  const initial = f.reader.read(f.request);
  assert.equal(initial.refreshing, true); assert.equal(initial.totalGsvYuan, null);
  assert.deepEqual(initial.channels.map(c => c.todayTotalYuan), [null, null]);
  await f.reader.settled();
  const next = f.reader.read(f.request);
  assert.equal(next.status, 'ready'); assert.equal(next.totalGsvYuan, 0); assert.equal(next.refreshing, false);
  assert.equal(next.lastSuccessAt, iso(now)); assert.equal(f.calls, 1);
});

test('same-day totals require valid money and usable source state, partial spend does not erase GSV', () => {
  const mixed = payload(); mixed.channels[1].todayDate = '2026-10-09';
  assert.equal(normalizePublicRealtime(mixed, { now }).summary.departmentTodayGsvYuan, null);
  for (const value of [null, undefined, '200', NaN, Infinity]) {
    assert.equal(normalizePublicRealtime(payload({ totals: [100, value] }), { now }).summary.departmentTodayGsvYuan, null);
  }
  assert.equal(normalizePublicRealtime(payload({ states: ['pending', 'ready'] }), { now }).summary.departmentTodayGsvYuan, null);
  const partial = normalizePublicRealtime(payload({ states: ['partial', 'ready'] }), { now });
  assert.equal(partial.summary.departmentTodayGsvYuan, 300); assert.equal(partial.status, 'partial');
  const invalid = payload(); invalid.channels[1].todayDate = '2026-02-30';
  assert.equal(normalizePublicRealtime(invalid, { now }).summary.departmentTodayGsvYuan, null);
});

test('fresh snapshot is ready; source age and dates remain stale even after successful fetch', async () => {
  assert.equal(normalizePublicRealtime(payload(), { now }).status, 'ready');
  const f = fixture(); f.result({ status: 200, payload: payload({ at: now - 3600_000, date: '2026-10-09' }) });
  f.reader.read(f.request); await f.reader.settled();
  const stale = f.reader.read(f.request);
  assert.equal(stale.status, 'stale'); assert.equal(stale.refreshing, false);
  assert.equal(stale.generatedAt, iso(now - 3600_000));
  for (let i = 0; i < 19; i++) { f.advance(5000); f.reader.read(f.request); }
  assert.equal(f.calls, 1, 'old source timestamps must not cause polling to repeatedly refetch');
});

test('one in-flight root refresh is shared across authorized public-summary readers', async () => {
  const f = fixture(); let resolve;
  f.result(() => new Promise(done => { resolve = done; }));
  for (let i = 0; i < 10; i++) f.reader.read({ key: String(i) }, true);
  await Promise.resolve(); assert.equal(f.calls, 1);
  resolve({ status: 200, payload: payload() }); await f.reader.settled();
  assert.equal(f.reader.read({ key: 'another' }).totalGsvYuan, 300); assert.equal(f.calls, 1);
});

test('503 and malformed HTTP 200 retain data and back off even when refresh is clicked', async () => {
  const f = fixture({ ...payload(), hubRetrievedAt: iso(now - 600_000) });
  f.result({ status: 503, payload: { detail: 'private upstream details' } });
  f.reader.read(f.request); await f.reader.settled();
  let next = f.reader.read(f.request, true);
  assert.equal(next.lastError.status, 503); assert.equal(next.totalGsvYuan, 300);
  assert.equal(next.refreshing, false); assert.equal(next.nextRetryAt, iso(now + 30_000)); assert.equal(f.calls, 1);
  assert.doesNotMatch(JSON.stringify(next), /private upstream/);
  f.advance(30_000); f.result({ status: 200, payload: { channels: [] } });
  f.reader.read(f.request); await f.reader.settled(); next = f.reader.read(f.request);
  assert.equal(next.lastError.status, 502); assert.equal(next.totalGsvYuan, 300);
  assert.equal(next.nextRetryAt, iso(now + 90_000)); assert.equal(f.calls, 2);
});

test('root 401/403 cooldown is isolated to its credential; another authorized reader can recover', async () => {
  for (const status of [401, 403]) {
    const f = fixture(); f.result({ status, payload: {} }); f.reader.read(f.request); await f.reader.settled();
    assert.equal(f.reader.read(f.request, true).lastError.status, status);
    f.result({ status: 200, payload: payload() }); f.reader.read({ key: 'B' }); await f.reader.settled();
    assert.equal(f.reader.read({ key: 'B' }).totalGsvYuan, 300); assert.equal(f.calls, 2);
  }
});

test('partial response keeps a missing channel with its true old date and does not merge business dates', () => {
  const prior = payload({ date: '2026-10-09', at: now - 86_400_000 });
  const incoming = payload(); incoming.channels = [incoming.channels[0]];
  const merged = mergeRealtimeSnapshot(prior, incoming, iso(now));
  const result = normalizePublicRealtime(merged, { now });
  assert.equal(result.channels[1].todayTotalYuan, 200); assert.equal(result.channels[1].todayDate, '2026-10-09');
  assert.equal(result.channels[1].stale, true); assert.ok(result.channels[1].refreshError);
  assert.equal(result.summary.departmentTodayGsvYuan, null);
  const remerged = mergeRealtimeSnapshot(prior, merged, iso(now));
  assert.equal(remerged.channels[1].hubRetained, true, 'persistence must preserve retained-source evidence');
});

test('invalid and older source responses cannot overwrite a good snapshot', () => {
  const prior = payload(); assert.equal(mergeRealtimeSnapshot(prior, { channels: [] }), null);
  const duplicate = payload(); duplicate.channels[1].key = 'douyin';
  assert.equal(mergeRealtimeSnapshot(prior, duplicate), null);
  const merged = mergeRealtimeSnapshot(prior, payload({ at: now - 60_000, totals: [1, 2] }), iso(now));
  assert.deepEqual(merged.channels.map(c => c.todayTotalYuan), [100, 200]);
  assert.ok(merged.channels.every(c => c.hubRetained));
  assert.equal(merged.generatedAt, prior.generatedAt);
});

test('permission invalidation rejects a late refresh result without starting a parallel refresh', async () => {
  const f = fixture(); let resolve;
  f.result(() => new Promise(done => { resolve = done; }));
  f.reader.read(f.request); await Promise.resolve(); f.reader.invalidate(); f.reader.read({ key: 'B' });
  assert.equal(f.calls, 1); resolve({ status: 200, payload: payload() }); await f.reader.settled();
  assert.equal(f.snapshot, null);
});

test('network rejection and persistence failure are observable and bounded', async () => {
  const f = fixture(); f.result(() => { throw new Error('network error'); });
  f.reader.read(f.request); await f.reader.settled();
  assert.equal(f.reader.read(f.request).lastError.status, 503); assert.equal(f.calls, 1);
  const reader = createWorkspaceSummaryReader({ readSnapshot: () => null, writeSnapshot: () => false,
    fetchSnapshot: async () => ({ status: 200, payload: payload() }), keyFor: () => 'A', clock: () => now });
  reader.read({}); await reader.settled(); assert.equal(reader.read({}).lastError.status, 503);
});
