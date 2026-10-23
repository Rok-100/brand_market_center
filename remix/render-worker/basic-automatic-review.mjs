// Automatic remix checks media and composition integrity only. Company content
// receipts remain separate history and never become a fabricated content PASS.
export const BASIC_REVIEW_POLICY = 'automatic_remix_basic_v1';
export const BASIC_REVIEW_MODE = 'automatic_basic';
export const BASIC_OUTPUT_CHECKS = Object.freeze(['文件可播放','竖版规格','音轨','时长完整','黑屏占比','目标时长','静音占比','框架完整度','重复成片','切片不重复','产品分类一致']);
const sha = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export function basicAssessmentPassed(assessment, hash) {
  return Boolean(sha(hash) && assessment?.mode === 'basic_rules' && assessment.ruleVersion === BASIC_REVIEW_POLICY
    && assessment.outputSha256 === hash && assessment.status === 'passed' && assessment.autoApproved === true
    && assessment.recommendation==='approve' && assessment.score>=90 && assessment.score<=100
    && !assessment.integrityFailure && Array.isArray(assessment.checks)
    && BASIC_OUTPUT_CHECKS.every(name => assessment.checks.filter(check => check.name === name).length === 1
      && assessment.checks.find(check => check.name === name).passed === true));
}
export const basicVariantPassed = variant => variant?.reviewMode === BASIC_REVIEW_MODE
  && variant.reviewStatus === 'approved' && basicAssessmentPassed(variant.automaticAssessment, variant.contentSha256);
export function basicCloudReviewMatches(render, variant, receipt = variant?.cloudDeliveryFeedback?.basicReview) {
  return Boolean(receipt?.policy === BASIC_REVIEW_POLICY && receipt.status === 'approved'
    && receipt.current_verified === true && receipt.dispatch_allowed === true
    && receipt.return_sha256 === variant.contentSha256 && receipt.render_id === render.id
    && receipt.variant_id === variant.id && receipt.actor_number === render.createdById
    && Number(receipt.asset_id) === Number(variant.materialCenterReturn?.assetId)
    && Number.isSafeInteger(Number(receipt.asset_id)) && Number(receipt.asset_id) > 0);
}
export function basicPlatformDeliveryValid(state) {
  const status = String(state?.platformMaterialStatus || state?.platformAudit?.material_status || '').toUpperCase();
  return Boolean(state?.status === 'success' && state.platformAssetId && state.bindingVerifiedAt
    && status==='DELIVERY_OK' && String(state.platformAudit?.status || '').toUpperCase()==='PASS');
}
export function basicOutputUnavailable(variant) {
  return variant?.platformReview?.status==='needs_localization' || [
    ...(variant?.qianchuanDeliveries||[]),variant?.qianchuanDelivery,...(variant?.cloudDeliveryFeedback?.items||[]),
  ].some(state=>state&&(String(state.platformMaterialStatus||state.platformAudit?.material_status||'').toUpperCase()==='DELETED'
    ||['REJECT','REJECTED'].includes(String(state.platformAudit?.status||'').toUpperCase())
    ||state.lastErrorCategory==='plan_material_removed'||state.last_error_category==='plan_material_removed'));
}
export function basicWorkCount(library,job) {
  const hashes=new Set();
  for(const render of library.renders||[])if(render.automation?.jobId===job.id&&render.createdById===job.createdById)
    for(const variant of render.variants||[])if(!basicOutputUnavailable(variant)&&sha(variant.contentSha256)
      &&(basicVariantPassed(variant)||(variant.reviewMode!==BASIC_REVIEW_MODE&&(variant.qianchuanDeliveries?.length?variant.qianchuanDeliveries:[variant.qianchuanDelivery]).some(state=>state?.status==='success'&&state.platformAssetId&&state.bindingVerifiedAt))))hashes.add(variant.contentSha256);
  return hashes.size;
}
export function basicDeliveryCount(library, job) {
  const hashes = new Set();
  for (const render of library.renders || []) {
    if (render.automation?.jobId !== job.id || render.createdById !== job.createdById) continue;
    for (const variant of render.variants || []) {
      if(basicOutputUnavailable(variant)||(variant.reviewMode===BASIC_REVIEW_MODE&&!basicVariantPassed(variant)))continue;
      const states = variant.qianchuanDeliveries?.length ? variant.qianchuanDeliveries : [variant.qianchuanDelivery];
      const feedback = variant.cloudDeliveryFeedback?.items || [];
      if (states.some(state => {
        if(!state)return false;
        const latest=state.taskId?feedback.find(item=>item.id===state.taskId||item.taskId===state.taskId):null;
        if(!latest)return basicPlatformDeliveryValid(state);
        // Both paths read Cloud's cache, at different times. A lagging feedback
        // must not replace a newer native audit. Missing dates do not establish
        // freshness; existing REJECT/DELETED remains terminal above.
        const directAt=Date.parse(state.platformAudit?.read_at||'');
        const feedbackAt=Date.parse(latest.platformAudit?.read_at||'');
        const useDirect=Number.isFinite(directAt)&&(!Number.isFinite(feedbackAt)||directAt>feedbackAt);
        return basicPlatformDeliveryValid(useDirect?state:{...state,...latest});
      }))
        if (sha(variant.contentSha256)) hashes.add(variant.contentSha256);
    }
  }
  return hashes.size;
}
