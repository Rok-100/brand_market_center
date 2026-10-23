import {visionConnection} from './vision-provider.mjs';

export function automaticEffectsAllowed(job, render, ownerAuthorized) {
  return Boolean(ownerAuthorized && job?.status === 'active' && !job.archivedAt
    && render?.recoveryRegistration?.effectsBlocked !== true
    && job.createdById && render?.createdById === job.createdById
    && render.automation?.jobId === job.id && render.visibility !== 'private');
}

// Only configuration presence is exposed; never emit credential values.
export function reviewReadiness(env = process.env) {
  const enabled = env.WIS_REMIX_VISUAL_REVIEW_ENABLED === 'true';
  const {missing} = visionConnection(env);
  return { ready: enabled && missing.length === 0, enabled, missing,
    code: !enabled ? 'review_not_enabled' : missing.length ? 'review_not_configured' : 'ready' };
}

export function automaticPipelineReadiness(job, { env = process.env, cloudConfigured = false } = {}) {
  const issues = [];
  const deliveryEnabled = job.qianchuanDelivery?.enabled === true;
  if (deliveryEnabled && (job.autoApproveOutputs !== true || job.autoReturnAfterApproval !== true)) {
    issues.push({ code: 'delivery_prerequisite', message: '真实投放必须同时启用自动成片审核和审核后回传。' });
  }
  // Automatic remix now uses local media checks; no paid content model or
  // human review is a prerequisite. Manual content tools keep reviewReadiness.
  if ((deliveryEnabled || job.autoReturnAfterApproval === true) && !cloudConfigured) {
    issues.push({ code: 'cloud_not_configured', message: '云管家接口未配置，不能保证审核后的回传或投放。' });
  }
  return { ready: issues.length === 0, issues };
}

export function assertAutomaticPipelineReady(job, options) {
  const result = automaticPipelineReadiness(job, options);
  if (!result.ready) throw Object.assign(new Error(result.issues.map(issue => issue.message).join(' ')),
    { code: 'automation_preflight_failed', statusCode: 409, issues: result.issues });
  return result;
}

export function assertDeliveryTargetVerified(target, verification) {
  const matches = verification?.account?.id === String(target.advertiserId)
    && verification?.plan?.id === String(target.planId);
  if (verification?.verified !== true || verification?.authorized !== true
    || verification?.plan?.canAttachVideo !== true || !matches) {
    throw Object.assign(new Error('千川账户或计划未通过实时授权与素材绑定能力核验，不能启动真实投放。'),
      { code: 'delivery_target_unverified', statusCode: 409 });
  }
}
