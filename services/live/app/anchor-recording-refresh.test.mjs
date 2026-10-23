import test from 'node:test';
import assert from 'node:assert/strict';
import {anchorRecordingSlot, mergeAnchorRecordings} from './anchor-recording-refresh.mjs';

test('Shanghai 08:15 is the hourly boundary, independent of host timezone', () => {
  assert.equal(anchorRecordingSlot('2026-10-06T00:14:59Z'), '2026-10-06T07:15');
  assert.equal(anchorRecordingSlot('2026-10-06T00:15:00Z'), '2026-10-06T08:15');
  assert.equal(anchorRecordingSlot('2026-10-06T01:15:00Z'), '2026-10-06T09:15');
});
test('midnight and late startup select the most recent :15 slot', () => {
  assert.equal(anchorRecordingSlot('2026-10-05T16:05:00Z'), '2026-10-05T23:15');
  assert.equal(anchorRecordingSlot('2026-10-05T16:15:00Z'), '2026-10-06T00:15');
  assert.equal(anchorRecordingSlot('2026-10-06T04:48:00Z'), '2026-10-06T12:15');
  assert.throws(() => anchorRecordingSlot('bad-time'));
});
const snapshot = {
  generatedAt: 'ranking-time', sourceDate: '2026-10-05', rooms: {官旗: [{name: '甲'}]},
  profileSource: {fetchedAt: 'profile-time'}, coverage: {rankingUpdated: true},
  evidenceByAnchor: {甲: {evaluations: [{text: '真实面评'}], recordings: [{messageId: 'old'}]}},
  evidenceSources: {coaching: {available: true}},
};
const evidence = {
  fetchedAt: 'recording-time', sources: {learning: {available: true, truncated: false}},
  windows: {recordings: '近3日'}, evidenceByAnchor: {甲: {recordings: [{messageId: 'new'}]}},
};
test('recording refresh preserves ranking, profile, review and coverage facts', () => {
  const result = mergeAnchorRecordings(snapshot, evidence, '2026-10-06T08:15');
  assert.equal(result.generatedAt, snapshot.generatedAt);
  assert.deepEqual(result.rooms, snapshot.rooms);
  assert.deepEqual(result.profileSource, snapshot.profileSource);
  assert.deepEqual(result.coverage, snapshot.coverage);
  assert.deepEqual(result.evidenceByAnchor.甲.evaluations, snapshot.evidenceByAnchor.甲.evaluations);
  assert.deepEqual(result.evidenceByAnchor.甲.recordings, [{messageId: 'new'}]);
  assert.deepEqual(snapshot.evidenceByAnchor.甲.recordings, [{messageId: 'old'}]);
  assert.equal(result.anchorRecordingSlot, '2026-10-06T08:15');
});
test('failed and truncated reads cannot mark a slot complete or erase old recordings', () => {
  for (const learning of [{available: false}, {available: true, truncated: true}]) {
    assert.throws(() => mergeAnchorRecordings(snapshot, {...evidence, sources: {learning}}, 'slot'));
  }
  assert.throws(() => mergeAnchorRecordings(null, evidence, 'slot'));
  assert.equal(snapshot.anchorRecordingSlot, undefined);
});
test('a successful empty rolling window expires old media, and includes new roster members', () => {
  const result = mergeAnchorRecordings(snapshot, {...evidence, evidenceByAnchor: {乙: {recordings: [{messageId: 'b'}]}}}, 'slot');
  assert.deepEqual(result.evidenceByAnchor.甲.recordings, []);
  assert.deepEqual(result.evidenceByAnchor.乙, {evaluations: [], recordings: [{messageId: 'b'}]});
});
