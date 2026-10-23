import {hasRepeatedClips} from '../shared/remix-combinations.mjs';

// Planning only. Keep old records and their proofs untouched. Callers must
// supply an already-authorized/evidence-qualified pool and retain final gates.
export function uniqueDurationCandidates({
  slots, selections, slotMapping, clips, openingSlotId = '', closingSlotIds = [],
}) {
  const byId = new Map(clips.map(clip => [clip.id, clip]));
  const closing = new Set(closingSlotIds);
  const repeats = (clip, chosen) => chosen.some(other => hasRepeatedClips([other, clip]));
  const compare = (a, b) => Number(b.durationSeconds || 0) - Number(a.durationSeconds || 0)
    || String(b.reviewedAt || b.createdAt || '').localeCompare(String(a.reviewedAt || a.createdAt || ''))
    || String(a.id).localeCompare(String(b.id));
  const pools = new Map(slots.map(slot => {
    const candidates = [...new Set(selections[slot.id] || [])].map(id => byId.get(id)).filter(Boolean).sort(compare);
    // An automatic output owns this opener. Never silently steal another.
    const available = slot.id === openingSlotId
      ? candidates.filter(clip => clip.id === slotMapping[slot.id]) : candidates;
    const ordered = [...available].sort((a, b) => Number(b.id === slotMapping[slot.id]) - Number(a.id === slotMapping[slot.id]) || compare(a, b));
    const unique = [];
    for (const clip of ordered) if (!repeats(clip, unique)) unique.push(clip);
    return [slot.id, unique];
  }));
  if (slots.some(slot => !pools.get(slot.id).length))
    return {complete: false, reason: 'required_role_missing', selections: {}, slotMapping: {}};

  const priority = [...slots].sort((a, b) => Number(closing.has(b.id)) - Number(closing.has(a.id))
    || Number(b.id === openingSlotId) - Number(a.id === openingSlotId)
    || pools.get(a.id).length - pools.get(b.id).length
    || slots.indexOf(a) - slots.indexOf(b));
  const chosen = new Map();
  // Backtrack rather than declaring a missing role after a greedy alias pick.
  // Five ordinary framework slots use tiny domains after identity de-duplication.
  const assign = index => {
    if (index === priority.length) return true;
    const slot = priority[index];
    for (const clip of pools.get(slot.id)) {
      if (repeats(clip, [...chosen.values()])) continue;
      chosen.set(slot.id, clip);
      if (assign(index + 1)) return true;
      chosen.delete(slot.id);
    }
    return false;
  };
  if (!assign(0)) return {complete: false, reason: 'required_role_identity_conflict', selections: {}, slotMapping: {}};

  const result = Object.fromEntries(slots.map(slot => [slot.id, [chosen.get(slot.id).id]]));
  const seen = [...chosen.values()];
  // Prefer a current closing-action alias over its old proof/solution alias.
  // Every mandatory base is reserved before assigning optional additions.
  const extrasOrder = [...slots].sort((a, b) => Number(closing.has(b.id)) - Number(closing.has(a.id))
    || slots.indexOf(a) - slots.indexOf(b));
  for (const slot of extrasOrder) {
    if (slot.id === openingSlotId) continue;
    for (const clip of [...pools.get(slot.id)].sort(compare)) {
      if (repeats(clip, seen)) continue;
      seen.push(clip);
      result[slot.id].push(clip.id);
    }
  }
  return {complete: true, reason: null, selections: result,
    slotMapping: Object.fromEntries(slots.map(slot => [slot.id, chosen.get(slot.id).id]))};
}

// The caller supplies legacySourceId only after its existing source-pointer
// check. This is ordering, not a source-scope or approval decision. Preserve
// the template's group order and fixed opener; never reorder across roles.
export function orderLegacyDurationClipGroups({slots, clipsBySlot, openingSlotId, legacySourceId = ''}) {
  const selected = slots.flatMap(slot => clipsBySlot.get(slot.id) || []);
  if (!legacySourceId || !selected.length || selected.some(clip => clip.sourceId !== legacySourceId))
    return selected;
  return slots.flatMap(slot => {
    const clips = clipsBySlot.get(slot.id) || [];
    return slot.id === openingSlotId ? [...clips] : [...clips].sort((a, b) =>
      a.startSeconds - b.startSeconds || a.endSeconds - b.endSeconds || String(a.id).localeCompare(String(b.id)));
  });
}

