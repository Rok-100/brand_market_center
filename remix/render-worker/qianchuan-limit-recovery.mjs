// These are exact workstation-admission errors, not platform capacity errors.
const localLimitMessages = new Map([
  ['已达到该计划今日自动混剪投放数量上限', 'daily_material_limit'],
  ['该计划今日已核验消耗达到配置护栏，自动投放已停止', 'daily_spend_guard'],
  ['该计划已核验消耗达到工作台护栏，已阻止新增混剪推送；原计划未修改', 'daily_spend_guard'],
  ['启用真实投放前必须配置每日消耗护栏', 'spend_guard_required'],
]);
const legacyMessages = new Set([
  '',
  '自动投放被安全门禁或千川接口阻断。',
  '该千川计划今日自动投放额度已满，成片已保留并顺延至下一投放窗口。',
]);
const legacyAdvice = new Set([
  '',
  '系统将按同一任务幂等续跑；已有千川视频 ID 时只续绑计划，不重复上传。',
  '无需人工处理；系统将在次日额度恢复后沿用同一幂等键自动推送。',
  '系统保留已上传视频和同一幂等键，下一轮只重试失败阶段。',
]);

export function workstationAdmissionBlock(error) {
  const reason = localLimitMessages.get(String(error?.message || ''));
  return error?.statusCode === 409 && reason ? {
    source: 'cloud_manager_workstation_admission',
    reason,
    responseStatus: 409,
    externalTaskCreated: false,
  } : null;
}

export function releaseWorkstationLimitBlock(state, nowIso, {deliveryLimitMode='unlimited',dailySpendGuardYuan}={}) {
  const quantityOnly=deliveryLimitMode==='quantity_unlimited';
  if(!['unlimited','quantity_unlimited'].includes(deliveryLimitMode)
    ||quantityOnly&&!(Number.isFinite(dailySpendGuardYuan)&&dailySpendGuardYuan>0))return null;
  if (!state || !['failed', 'deferred'].includes(state.status) || state.taskId ||
      state.uploadTaskId || state.platformAssetId || state.videoId || state.materialId ||
      state.deliveryEntityId || !state.idempotencyKey || state.submissionUncertain === true ||
      !['', 'upload', 'plan_binding', 'capacity', 'admission'].includes(String(state.failureStage || ''))) return null;
  const details = [state.errorMessage, state.deferredReason].filter(Boolean).map(String);
  const reasons = details.map(message => localLimitMessages.get(message));
  // Unknown or mixed errors are not erased, even alongside a remembered limit.
  if (reasons.some(reason => !reason) || new Set(reasons).size > 1 ||
      (!legacyMessages.has(String(state.message || '')) && !localLimitMessages.has(String(state.message || ''))) ||
      !legacyAdvice.has(String(state.errorAdvice || ''))) return null;
  const block = state.admissionBlock;
  const structuredReason = block?.source === 'cloud_manager_workstation_admission' &&
    block.responseStatus === 409 && block.externalTaskCreated === false &&
    ['daily_material_limit', 'daily_spend_guard', 'spend_guard_required'].includes(block.reason)
      ? block.reason : null;
  if (block && !structuredReason) return null;
  const reason = reasons[0] || structuredReason;
  const messageReason = localLimitMessages.get(String(state.message || ''));
  if (!reason || (structuredReason && structuredReason !== reason) ||
      (messageReason && messageReason !== reason)) return null;
  if(quantityOnly&&reason!=='daily_material_limit')return null;
  return {
    ...state,
    status: 'failed',
    message: quantityOnly?'已取消工作台数量上限，消耗护栏保持不变；等待按原幂等键重新核验。':'已取消工作台新增推送限制，等待按原幂等键重新核验后续跑。',
    errorMessage: '',
    errorAdvice: '系统将重新核验权限、审核证据与目标计划；本次未直接重推。',
    failureStage: 'admission_recheck',
    deferredReason: '',
    admissionBlock: null,
    admissionRecoveryHistory: [...(Array.isArray(state.admissionRecoveryHistory) ? state.admissionRecoveryHistory : []), {
      at: nowIso, reason, fromMode: 'limited', toMode: deliveryLimitMode,
      previous: {status: state.status, message: state.message, errorMessage: state.errorMessage,
        errorAdvice: state.errorAdvice, failureStage: state.failureStage,
        deferredReason: state.deferredReason, nextRetryAt: state.nextRetryAt,
        admissionBlock: state.admissionBlock},
    }],
    nextRetryAt: nowIso,
    nextPollAt: null,
    updatedAt: nowIso,
  };
}

// Explicit resume can re-evaluate a previously saved unlimited configuration.
// This changes local retry eligibility only; real submission still rechecks
// target authorization and uses the original idempotency key. Call with current
// in-lock library objects, after validating the current review evidence.
export function releaseWorkstationLimitBlockOnResume(state, {
  job, render, variant, config, ownerAuthorized, currentReviewVerified,
  platformQuarantined, nowIso,
} = {}) {
  if (ownerAuthorized !== true || job?.status !== 'active' || job.archivedAt ||
      !job.id || !job.createdById || render?.createdById !== job.createdById ||
      render?.automation?.jobId !== job.id || render.visibility === 'private' ||
      job.autoApproveOutputs !== true || job.autoReturnAfterApproval !== true ||
      config?.enabled !== true || config.confirmed !== true ||
      !['unlimited','quantity_unlimited'].includes(config.deliveryLimitMode) || currentReviewVerified !== true ||
      platformQuarantined !== false || variant?.reviewStatus !== 'approved' ||
      variant.automaticAssessment?.autoApproved !== true ||
      variant.sourceRevalidation?.required ||
      !Array.isArray(render.variants) || !render.variants.includes(variant)) return null;

  const states = Array.isArray(variant.qianchuanDeliveries) && variant.qianchuanDeliveries.length
    ? variant.qianchuanDeliveries : [variant.qianchuanDelivery];
  if (!states.includes(state)) return null;
  const advertiserId = String(state?.advertiserId || '');
  const planId = String(state?.planId || '');
  if (!/^\d+$/.test(advertiserId) || !/^\d+$/.test(planId)) return null;
  const target = (Array.isArray(config.targets) ? config.targets : []).find(item =>
    String(item?.advertiserId || '') === advertiserId && String(item?.planId || '') === planId);
  if (!target || (state.planType && state.planType !== target.planType)) return null;
  if (!Number.isFinite(Date.parse(nowIso))) return null;

  const recovered = releaseWorkstationLimitBlock(state, nowIso,config);
  if (!recovered) return null;
  const history = recovered.admissionRecoveryHistory;
  history[history.length - 1] = {...history[history.length - 1],
    trigger: 'explicit_task_resume', advertiserId, planId};
  return recovered;
}

// A quantity-release acknowledgement mentions the retained spend guard. It is
// not itself a spend rejection. Only the persisted, explicitly unsubmitted
// local-count recovery below may bypass the generic message classifier.
export function releasedQuantityLimitRetryEligible(state, {
  job, render, variant, config, ownerAuthorized, currentReviewVerified,
  platformQuarantined, nowIso,
} = {}) {
  if (ownerAuthorized !== true || currentReviewVerified !== true || platformQuarantined !== false ||
      job?.status !== 'active' || job.archivedAt || !job.id || !job.createdById ||
      render?.createdById !== job.createdById || render?.automation?.jobId !== job.id ||
      render.visibility === 'private' || job.autoApproveOutputs !== true || job.autoReturnAfterApproval !== true ||
      config?.enabled !== true || config.confirmed !== true || config.deliveryLimitMode !== 'quantity_unlimited' ||
      config.dailyMaterialLimit !== null || !Number.isFinite(config.dailySpendGuardYuan) || config.dailySpendGuardYuan <= 0 ||
      variant?.reviewStatus !== 'approved' || variant.automaticAssessment?.autoApproved !== true ||
      variant.sourceRevalidation?.required || !render.variants?.includes(variant)) return false;
  const states = variant.qianchuanDeliveries?.length ? variant.qianchuanDeliveries : [variant.qianchuanDelivery];
  if (!states.includes(state) || state?.status !== 'failed' || state.failureStage !== 'admission_recheck' ||
      !state.idempotencyKey || state.submissionUncertain === true || state.externalTaskCreated === true ||
      ['taskId','uploadTaskId','platformAssetId','videoId','materialId','deliveryEntityId'].some(key => Boolean(state[key])) ||
      state.errorMessage || state.deferredReason || state.admissionBlock || state.lastErrorCategory || state.last_error_category ||
      state.message !== '已取消工作台数量上限，消耗护栏保持不变；等待按原幂等键重新核验。' ||
      state.errorAdvice !== '系统将重新核验权限、审核证据与目标计划；本次未直接重推。') return false;
  const now = Date.parse(nowIso), due = Date.parse(state.nextRetryAt || '');
  const history = state.admissionRecoveryHistory?.at(-1), block = history?.previous?.admissionBlock;
  if (!Number.isFinite(now) || !Number.isFinite(due) || due > now || !Number.isFinite(Date.parse(history?.at || '')) ||
      Date.parse(history.at) > due || history.reason !== 'daily_material_limit' || history.fromMode !== 'limited' ||
      history.toMode !== 'quantity_unlimited' || block?.source !== 'cloud_manager_workstation_admission' ||
      block.reason !== 'daily_material_limit' || block.responseStatus !== 409 || block.externalTaskCreated !== false) return false;
  const advertiserId = String(state.advertiserId || ''), planId = String(state.planId || '');
  if (!/^\d+$/.test(advertiserId) || !/^\d+$/.test(planId) ||
      (history.advertiserId && String(history.advertiserId) !== advertiserId) ||
      (history.planId && String(history.planId) !== planId)) return false;
  const target = config.targets?.find(item => String(item.advertiserId) === advertiserId && String(item.planId) === planId);
  if (!target || state.planType && state.planType !== target.planType) return false;
  // Revalidate the original exact local admission failure, including mixed or
  // unknown error rejection. Never clear or manufacture a previous receipt.
  return Boolean(releaseWorkstationLimitBlock({...state, ...history.previous}, history.at, config));
}
