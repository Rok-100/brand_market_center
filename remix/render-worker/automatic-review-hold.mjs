import {diagnoseSourceAdmission} from './batch-output-review.mjs';
import {LEGACY_MODE,hasLegacySourcePointer} from './legacy-source-evidence.mjs';

// Select one evidence-complete scope: an exact SKU pool or one unchanged legacy
// source. Category names and old approved badges cannot manufacture current ASR
// or semantic evidence, and separate null-SKU sources never share one pool.
export function reviewableSourcePools(library, product, trustedJobId) {
  const sources = new Map(library.sources.map(source => [source.id, source]));
  const pools = new Map();
  let missingCount = 0;
  for (const clip of library.clips) {
    const source = sources.get(clip.sourceId);
    if (clip.reviewStatus !== 'approved' || clip.visibility === 'private' || source?.visibility === 'private') continue;
    if (clip.productCategory !== product && source?.productCategory !== product) continue;
    const admission = diagnoseSourceAdmission({clips:[clip],sources:source?[source]:[],product,trustedJobId});
    if (!admission.ready) { missingCount++; continue; }
    const legacy=hasLegacySourcePointer(source);
    const key=legacy?JSON.stringify([LEGACY_MODE,source.id,source.contentSha256]):source.skuVersion;
    const pool=pools.get(key) || (legacy?{skuVersion:null,sourceScope:structuredClone(source.legacySourceEvidence.sourceScope),poolKey:key,clips:[]}
      :{skuVersion:source.skuVersion,clips:[]});
    pool.clips.push(clip);pools.set(key,pool);
  }
  return {pools:[...pools.values()],missingCount};
}

// Rank the remaining work, not the historical size of a SKU pool. Keep the
// original selections intact: rendering still enforces its own per-run opener
// de-duplication, and other roles may legitimately refer to a previously used
// opener. This helper never grants evidence or turns an unready pool ready.
export function rankReviewedPools(candidates, usedOpeningIds = new Set()) {
  const used = usedOpeningIds instanceof Set ? usedOpeningIds
    : new Set(Array.isArray(usedOpeningIds) ? usedOpeningIds : []);
  const capacity = value => Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
  return (Array.isArray(candidates) ? candidates : []).filter(candidate => candidate && typeof candidate === 'object')
    .map((candidate,index) => {
      const openings=candidate.slotSelections?.[candidate.openingSlotId];
      const availableOpeningIds = [...new Set(Array.isArray(openings)?openings:[])]
        .filter(id => typeof id === 'string' && id.trim().length > 0 && !used.has(id));
      const availableOpeningCount = availableOpeningIds.length;
      const remainingOutputCapacity = Math.min(availableOpeningCount,
        capacity(candidate.maxDailyTarget), capacity(candidate.combinationCapacity));
      const canProduce = candidate.canProduce === true && remainingOutputCapacity > 0;
      return {index,result:{...candidate,availableOpeningIds,availableOpeningCount,remainingOutputCapacity,
        canProduce,ready:candidate.ready === true && canProduce}};
    })
    .sort((a,b) => Number(b.result.canProduce)-Number(a.result.canProduce)
      || b.result.remainingOutputCapacity-a.result.remainingOutputCapacity
      || b.result.availableOpeningCount-a.result.availableOpeningCount
      || capacity(b.result.maxDailyTarget)-capacity(a.result.maxDailyTarget)
      || a.index-b.index)
    .map(item => item.result);
}

export function holdAutomaticReview(job, run, {reason,summary,kind='dependency'}, timestamp) {
  // A late model callback may never reverse an explicit user pause.
  if (!job || job.status !== 'active' || job.archivedAt || job.autoApproveOutputs !== true || !run) return false;
  run.status = 'awaiting_review';
  run.completedAt = null;
  run.errorMessage = summary;
  run.automaticReviewHold = {reason,summary,kind,createdAt:timestamp,checkedAt:timestamp};
  delete run.resumeRequestedAt;
  job.nextRunAt = null;
  job.updatedAt = timestamp;
  return true;
}

export function resumeEvidenceHold(job, run, {ownerAuthorized,ready}, timestamp) {
  if (!ownerAuthorized || !ready || job?.status !== 'active' || job.archivedAt ||
      job.autoApproveOutputs !== true || run?.status !== 'awaiting_review' ||
      run.automaticReviewHold?.kind !== 'source_evidence') return false;
  // This marker exists only for system-owned waits; older ambiguous pauses and
  // manual holds remain untouched. Resume the same run, never allocate another.
  run.automaticReviewHold = {...run.automaticReviewHold,resolvedAt:timestamp};
  run.resumeRequestedAt = timestamp;
  job.nextRunAt = timestamp;
  job.updatedAt = timestamp;
  return true;
}
