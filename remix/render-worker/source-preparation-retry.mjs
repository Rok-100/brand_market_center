const retryReasons=new Set(['not_enabled','not_configured','receipt_unreadable','provider_error_not_resent',
  'uncertain_not_resent','budget_exhausted','integrity_unavailable','task_or_library_changed']);
export const sourcePreparationDelay = attempts => Math.min(1_800_000,300_000*2**Math.min(3,Math.max(0,Number(attempts)||0)));
export const sourceReviewPendingReasons = reviewed => [...new Set([reviewed?.reason,...(reviewed?.results||[])
  .filter(item=>item.status!=='passed').map(item=>item.reason)].filter(Boolean))].sort();
export const sourceReviewCanRecover = reasons => reasons.some(reason=>retryReasons.has(reason));
export const sourcePreparationCanRecover = error => /^SOURCE_(?:VERSION_EVIDENCE_MISSING|ASR_UNAVAILABLE|BOUNDARY_UNAVAILABLE|REVIEW_PENDING)$/.test(error?.code||'');
export function supplyAssetAvailable(target,asset,now=Date.now()) {
  if(target.processedAssetIds.includes(asset.id))return false;
  const deferred=target.deferredSourceAssets?.[asset.id];
  if(deferred)return Number.isFinite(Date.parse(deferred.retryAt)) && Date.parse(deferred.retryAt)<=now;
  return Number(target.attemptsByAssetId?.[asset.id]||0)<3;
}
