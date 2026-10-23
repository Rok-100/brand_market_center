import {createHash} from 'node:crypto';

export function compositionFingerprint(clips, sources) {
  const byId = new Map(sources.map(source => [source.id, source]));
  const snapshot = clips.map(clip => {
    const source = byId.get(clip.sourceId);
    const values = [clip.id, clip.storedName, clip.contentSha256, clip.sourceId,
      clip.startSeconds, clip.endSeconds, clip.durationSeconds, clip.productCategory,
      clip.reviewStatus, clip.reviewedAt, clip.deliveryBlocked, clip.boundaryEvidence,
      source?.contentSha256, source?.skuVersion, source?.productCategory, source?.visibility,
      clip.visibility, clip.role, clip.text, clip.transcript, clip.tags,
      source?.analysisAsrEvidence, source?.speechSegments];
    // Production's original protocol ends after these 23 values. Appending
    // absent evidence as null would invalidate every unchanged historical
    // output, even in other categories. New evidence is additive, never an
    // automatic rewrite of an existing generation/review binding.
    const versionEvidence = [source?.productVersionEvidence, source?.sourceSemanticReview,
      clip.skuVersion, clip.productVersionEvidence, clip.semanticReviewProof];
    // A standalone clip SKU string is metadata, not a new private receipt; an
    // older writer may already have populated it. Bind it only once actual
    // version/review evidence introduces the extended protocol.
    const hasVersionEvidence = [source?.productVersionEvidence, source?.sourceSemanticReview,
      clip.productVersionEvidence, clip.semanticReviewProof].some(value => value !== undefined && value !== null);
    if (hasVersionEvidence) values.push(...versionEvidence);
    // A revoked historical record must not regain validity just because it
    // predates private evidence. Healthy legacy records retain the exact old
    // bytes; evidence-bearing records also bind all current availability flags.
    const unavailable = record => record?.revoked === true || Boolean(record?.revokedAt)
      || record?.deliveryBlocked === true || record?.disabled === true
      || ['rejected', 'changes_requested'].includes(record?.reviewStatus);
    if(hasVersionEvidence || source?.legacySourceEvidence || clip.legacySourceEvidence
      || unavailable(source) || unavailable(clip)) values.push({
      legacySourceEvidence:source?.legacySourceEvidence??null,legacyClipEvidence:clip.legacySourceEvidence??null,
      sourceUnavailable:[source?.revoked??null,source?.revokedAt??null,source?.deliveryBlocked??null,source?.disabled??null,source?.reviewStatus??null],
      clipUnavailable:[clip.revoked??null,clip.revokedAt??null,clip.disabled??null]});
    return values;
  });
  return createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
}

// Only a definite quality rejection is eligible for replacement. Unknown model
// outcomes/charges and missing business evidence never become automatic approval.
export function replacementEligible(variant) {
  if(variant.reviewMode==='automatic_basic')return variant.automaticAssessment?.status==='failed';
  const review = variant.automaticAssessment?.visualReview;
  return review?.status === 'review_required' && review.reason === 'content_attention'
    && Array.isArray(review.issues) && review.issues.length > 0;
}
