// Use the latest hourly :15 slot, including the preceding day before 00:15.
export function anchorRecordingSlot(now = new Date()) {
  const time = new Date(now).getTime();
  if (!Number.isFinite(time)) throw new Error('Invalid recording refresh time');
  const slot = Math.floor((time - 15 * 60000) / 3600000) * 3600000 + 15 * 60000;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(slot));
  const get = key => parts.find(part => part.type === key).value;
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}

// Only recording fields change; rankings, reviews and profile timestamps stay intact.
export function mergeAnchorRecordings(snapshot, evidence, slot) {
  if (!snapshot || !evidence?.sources?.learning?.available || evidence.sources.learning.truncated) {
    throw new Error('主播录屏来源未完整读取，保留上次记录并稍后重试。');
  }
  const names = new Set([...Object.keys(snapshot.evidenceByAnchor || {}), ...Object.keys(evidence.evidenceByAnchor || {})]);
  return {
    ...snapshot,
    evidenceByAnchor: Object.fromEntries([...names].map(name => [name, {
      ...(snapshot.evidenceByAnchor?.[name] || {evaluations: []}),
      recordings: evidence.evidenceByAnchor?.[name]?.recordings || [],
    }])),
    evidenceSources: {...snapshot.evidenceSources, learning: evidence.sources.learning},
    evidenceWindows: {...snapshot.evidenceWindows, recordings: evidence.windows.recordings},
    anchorRecordingSlot: slot,
    anchorRecordingUpdatedAt: evidence.fetchedAt,
  };
}
