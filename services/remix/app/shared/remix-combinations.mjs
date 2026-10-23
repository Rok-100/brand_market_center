// Shared by the browser preview and worker. Never materialize the cartesian product.
export const SLOT_CANDIDATE_LIMIT = 15;
export const COMBINATION_BATCH_LIMIT = 100;
const choose = (ids, count) => {
  const result = [];
  const visit = (at, selected) => {
    if (selected.length === count) { result.push(selected); return; }
    for (let i = at; i <= ids.length - (count - selected.length); i++)
      visit(i + 1, [...selected, ids[i]]);
  };
  visit(0, []);
  return result;
};
export const clipIdentity = clip => clip?.contentSha256
  ? 'hash:' + clip.contentSha256
  : clip?.sourceId && Number.isFinite(clip.startSeconds) && Number.isFinite(clip.endSeconds)
    ? 'range:' + [clip.sourceId, clip.startSeconds, clip.endSeconds].join(':')
    : 'id:' + clip?.id;
export const hasRepeatedClips = selected => selected.some((clip, i) => selected.slice(0, i).some(other =>
  clip.id === other.id || clipIdentity(clip) === clipIdentity(other) ||
  ((clip.sourceId && clip.sourceId === other.sourceId || clip.sourceContentSha256 && clip.sourceContentSha256 === other.sourceContentSha256) &&
    Math.abs(clip.startSeconds - other.startSeconds) < .001 &&
    Math.abs(clip.endSeconds - other.endSeconds) < .001)));
export function planCombinations(slots, selections, options = {}) {
  const { limit = 100, strategy = 'diverse', unique = true, clips = [], offset = 0 } = options;
  const byId = new Map(clips.map(clip => [clip.id, clip]));
  const pools = slots.map(slot => choose([...new Set(selections[slot.id] || [])].slice(0, 15),
    Math.max(1, Math.min(3, Math.trunc(slot.takeCount || 1)))));
  if (!slots.length || pools.some(pool => !pool.length))
    return { plans: [], exhausted: true, examined: 0 };
  const total = pools.reduce((n, pool) => Math.min(Number.MAX_SAFE_INTEGER, n * pool.length), 1);
  const plans = [];
  const signatures = new Set();
  const maxScan = Math.min(total, 50000);
  let examined = 0;
  for (; examined < maxScan && plans.length < Math.min(100, limit); examined++) {
    let cursor = (examined + offset) % total;
    let previousDigit = 0;
    const groups = {};
    for (let i = 0; i < slots.length; i++) {
      const digit = cursor % pools[i].length;
      cursor = Math.floor(cursor / pools[i].length);
      const index = strategy === 'diverse' ? (digit + previousDigit) % pools[i].length : digit;
      previousDigit = index;
      groups[slots[i].id] = pools[i][index];
    }
    const sequence = slots.flatMap(slot => groups[slot.id]);
    const selected = sequence.map(id => byId.get(id) || { id });
    if (unique && hasRepeatedClips(selected)) continue;
    const signature = JSON.stringify(sequence);
    if (signatures.has(signature)) continue;
    signatures.add(signature);
    plans.push({ groups, clipSequence: sequence,
      slotMapping: Object.fromEntries(slots.map(slot => [slot.id, groups[slot.id][0]])) });
  }
  return { plans, exhausted: examined >= total, examined };
}
