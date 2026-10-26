import {automaticReviewDecision} from './automatic-review-policy.mjs';
import {commitLibraryChange,libraryRebaseAllowed,isLibraryConflict} from './library-transaction.mjs';
import {verifyDefinitiveContentFailure} from './definitive-content-failure.mjs';
import {visionConnection} from './vision-provider.mjs';
import {SourceSemanticReview,validateSourceSemanticProof} from './source-semantic-review.mjs';
import {PRACTICAL_REVIEW_JOB_ID,practicalSourceFactIssues,sourceReviewScopeAllows,clipSourceReviewScopeAllows} from './source-practical-review-policy.mjs';
import {createPilotSourceCategoryRepair} from './pilot-source-category-repair.mjs';
import {CLIP_VERSION_SCHEMA,BLACK_MASK_VERSIONS} from './product-version-contract.mjs';
import {assertVersionedComposition} from './product-version-admission.mjs';
import {SOURCE_EVIDENCE_POLICY,outputSourcePolicy} from './output-source-policy.mjs';
import {BASIC_REVIEW_POLICY,BASIC_REVIEW_MODE,BASIC_OUTPUT_CHECKS,basicVariantPassed,basicCloudReviewMatches,basicDeliveryCount,basicWorkCount,basicOutputUnavailable} from './basic-automatic-review.mjs';
import {HISTORICAL_INVENTORY_JOB,HISTORICAL_INVENTORY_MODE,HISTORICAL_REFERENCE_SHA256,historicalInventorySequence,historicalCandidateSequence,historicalSnapshotDigest} from './historical-approved-inventory.mjs';
import {HISTORICAL_OUTPUT_RULES_POLICY,HISTORICAL_OUTPUT_REVIEW_MODE,historicalRulesVariantPassed,historicalRulesOutputContract,
  historicalInventoryInputCurrent,createHistoricalRulesEvidence,holdHistoricalRulesOutput} from './historical-output-rules.mjs';
import {sourcePreparationDelay,sourceReviewPendingReasons,sourceReviewCanRecover,sourcePreparationCanRecover,supplyAssetAvailable} from './source-preparation-retry.mjs';
import {createSourcePreparationProgress,sourcePreparationDisplayOutcome} from './source-preparation-progress.mjs';
import {purchaseActionSignal} from './purchase-action-role.mjs';
import {uniqueDurationCandidates,orderLegacyDurationClipGroups} from './duration-candidate-identity.mjs';
import {sourceIntervalSequence,clipBytesSequence,assertNoPendingSequence,reserveOutputSequence,recordOutputSequence,findUnseenDurationPlans} from './output-sequence-dedup.mjs';
import {planProgressiveSourceBatch,progressiveOutputUsage,PROGRESSIVE_OUTPUT_ATTEMPT_LIMIT} from './progressive-source-preparation.mjs';
import {LEGACY_DURATION_POLICY,probeLegacySourceDuration,incompatibleDurationError,isLegacyDurationError} from './legacy-source-duration.mjs';
import {recoverCompletedSourceCta} from './completed-source-cta-recovery.mjs';
import {inspectCompletedSourceMaterialization} from './completed-source-materialization.mjs';
import {R9_ADDITIVE_JOB_ID} from './combine-legacy-source-resolvers.mjs';
import {reviewableSourcePools,rankReviewedPools,holdAutomaticReview,resumeEvidenceHold} from './automatic-review-hold.mjs';
import {verifyReviewFiles} from './review-file-integrity.mjs';
import { frameworkReadable, effectiveClipVisibility, compositionVisibility } from './composition-visibility.mjs';
import {recordServiceEvent,clipGeneratedEvent,renderGeneratedEvent} from './service-notification-events.mjs';
import {ASR_FRAME_RULE, verifyAsrBundle, alignAsrCuesToFrames, hasTrustedAsrFrameBoundary, asrProviderEvidenceMatches, preciseBoundarySeconds} from './asr-frame-boundary.mjs';
import {LEGACY_MODE,hasTrustedLegacyAsrBoundary,hasLegacySourcePointer,hasLegacyClipPointer} from './legacy-source-evidence.mjs';
import {assessAsrClipReuse} from './clip-evidence-reuse.mjs';
import {serveOriginalCloudMedia} from './source-media-fallback.mjs';
import {ensureLinkedSourceOnDisk} from './source-recovery.mjs';
import {createPlaybackRecovery} from './media-playback-recovery.mjs';
import {collectSourceCandidates} from './source-selection.mjs';
import {chooseDurationBase} from './duration-plan.mjs';
import {VisualQuality,VISUAL_REVIEW_VERSION} from './visual-quality.mjs';
import {reviewReadiness,automaticPipelineReadiness,assertAutomaticPipelineReady,assertDeliveryTargetVerified,automaticEffectsAllowed} from './automation-preflight.mjs';
import {batchOutputInput,applyBatchOutputReview,batchInputsStillApproved,diagnoseSourceAdmission,diagnoseBatchInputAdmission,compareBatchInputSnapshot} from './batch-output-review.mjs';
import {verifyManualApprovalFile} from './manual-output-integrity.mjs';
import {hasPassedVisualReview, visualTimeline, needsVisualAttention} from './output-quality.mjs';
import { createReadStream, createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import { planCombinations, hasRepeatedClips } from '../shared/remix-combinations.mjs';
import { compositionFingerprint, replacementEligible } from './composition-integrity.mjs';
import {outputBinding, bindingState, automaticallyReviewed, assertCurrentAutomaticReview, createOutputRevalidator} from './output-review-binding.mjs';
import { createThumbnails } from './media-thumbnails.mjs';
import { writeVideoBundle } from './download-bundle.mjs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { assessRecognizedText, parseOcrTsv, generatedClipNaming, clipNamePresentation } from './recognized-text-quality.mjs';
import {createRenderInputHashes} from './render-input-hashes.mjs';
import {createRegistrationJournal,readRegistrationJournals} from './render-registration-journal.mjs';
import {journalContext,journalRunState,inspectJournalRecovery,verifyJournalFiles,applyJournalRecovery} from './journal-output-recovery.mjs';

import Busboy from 'busboy';
import { createManualOperations } from './manual-operations.mjs';
import { createClipReviewBatches } from './clip-review-batches.mjs';
import {normalizeQianchuanDeliveryLimits, assertQianchuanDeliveryLimits} from './qianchuan-delivery-limits.mjs';
import {workstationAdmissionBlock, releaseWorkstationLimitBlock, releaseWorkstationLimitBlockOnResume, releasedQuantityLimitRetryEligible} from './qianchuan-limit-recovery.mjs';
import { createReadonlyLibrarySnapshot } from './readonly-library-snapshot.mjs';
import { indexedLibrary, readIndexes, sourceSummary, selectRecordPage } from './library-read-model.mjs';
import { refreshReturnFeedback, hasPlatformQuarantine, assertNoPlatformQuarantine } from './return-feedback.mjs';
import {companyClipExcluded,inspectCompanyReview,applyCompanyReject,companyJobContinuation,hasCurrentCompanyPass,
  isCompanyRunExhausted,settleCompanyRejectedRuns,createExistingCompanyPassContext,existingCompanyPassContextCurrent,
  companyClipExcludedForExistingOutput} from './company-reject-recovery.mjs';
import {
  createDeduplicatedLibraryWriter,
  createLibraryReadCache,
  unchangedLibrary,
  persistLibraryUpdate,
} from './library-persistence.mjs';
import {
  normalizeVisibility,
  canReadSource,
  canReadClip,
  clipIsBlocked,
  assertSourceAccess,
} from './asset-access.mjs';

import {
  assessClipBoundaryIntegrity,
  extractSceneBoundaries,
  extractSilenceWindows,
  mergeOcrSamples,
  normalizeSpeechCandidates,
  speechCandidatesFromSilence,
} from './clip-remix-analysis.mjs';
import {
  materialCenterCategoryForProduct,
  workstationProductCategoryForMaterialCenter,
} from './material-center-client.mjs';

const REMIX_CONFIG = {
  width: 1080,
  height: 1920,
  fps: 30,
};

const DEFAULT_USAGE_DISCLAIMER_TEXT = '产品使用效果因人而异';
const USAGE_DISCLAIMER_MAX_LENGTH = 30;
const DIRECT_CLIP_UPLOAD_VIDEO_EXTENSIONS = new Set([
  '.mp4',
  '.mov',
  '.m4v',
  '.webm',
  '.mkv',
  '.avi',
]);

const pipeFileToResponse = (req, res, filePath, options = undefined) =>
  new Promise((resolve, reject) => {
    const stream = createReadStream(filePath, options);
    let settled = false;
    const cleanup = () => {
      req.off('aborted', onClientClose);
      res.off('close', onClientClose);
      res.off('error', onClientClose);
      res.off('finish', onFinish);
      stream.off('error', onStreamError);
    };
    const settle = (callback) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };
    const onClientClose = () => {
      stream.destroy();
      settle(resolve);
    };
    const onFinish = () => settle(resolve);
    const onStreamError = (error) => {
      if (req.destroyed || res.destroyed) {
        settle(resolve);
        return;
      }
      settle(() => reject(error));
    };
    req.once('aborted', onClientClose);
    res.once('close', onClientClose);
    res.once('error', onClientClose);
    res.once('finish', onFinish);
    stream.once('error', onStreamError);
    stream.pipe(res);
  });
const DIRECT_CLIP_UPLOAD_MAX_FOLDER_DEPTH = 12;
// Keep the legal line above native player controls and short-video action chrome.
export const USAGE_DISCLAIMER_BOTTOM_MARGIN = 240;
const AUTO_REMIX_MAX_DAILY_OUTPUTS = 500;
const AUTO_REMIX_RENDER_CHUNK_SIZE = 2;
const AUTO_REMIX_MAX_CONCURRENT_JOBS = Math.trunc(
  Math.min(
    4,
    Math.max(1, Number(process.env.AUTO_REMIX_MAX_CONCURRENT_JOBS) || 1),
  ),
);
const CLIP_REPLENISHMENT_MAX_CONCURRENT_JOBS = Math.trunc(
  Math.min(
    2,
    Math.max(
      1,
      Number(process.env.CLIP_REPLENISHMENT_MAX_CONCURRENT_JOBS) || 1,
    ),
  ),
);
const OCR_FRAME_CONCURRENCY = 2;
// Network download and Cutter polling can overlap for two source assets. The
// process governors still serialize heavy FFmpeg work and cap OCR workers, so
// this improves throughput without letting video decodes grow unbounded.
const AUTO_SOURCE_PROCESSING_CONCURRENCY = Math.trunc(
  Math.min(
    2,
    Math.max(1, Number(process.env.AUTO_SOURCE_PROCESSING_CONCURRENCY) || 2),
  ),
);
const AUTO_CUTTER_TIMEOUT_MS = Math.trunc(
  Math.min(
    6 * 60_000,
    Math.max(30_000, Number(process.env.AUTO_CUTTER_TIMEOUT_MS) || 120_000),
  ),
);
const AUTO_CLIP_REVIEW_CONCURRENCY = 1;
const AUTO_REMIX_DEFAULT_DURATION_SECONDS = 30;
const AUTO_REMIX_MIN_DURATION_SECONDS = 30;
const AUTO_REMIX_MAX_DURATION_SECONDS = 180;
const AUTO_REMIX_SCHEDULER_INTERVAL_MS = Math.max(
  250,
  Number(process.env.AUTO_REMIX_SCHEDULER_INTERVAL_MS) || 30_000,
);
const CLIP_REPLENISHMENT_RETRY_BASE_MS = Math.max(
  50,
  Number(process.env.CLIP_REPLENISHMENT_RETRY_BASE_MS) || 30_000,
);
const CLIP_REPLENISHMENT_RETRY_MAX_MS = Math.max(
  CLIP_REPLENISHMENT_RETRY_BASE_MS,
  Number(process.env.CLIP_REPLENISHMENT_RETRY_MAX_MS) || 5 * 60_000,
);
const CONTINUOUS_CLIP_SUPPLY_SIGNATURE = 'continuous-clip-supply-v1';
const CONTINUOUS_CLIP_SUPPLY_TARGET_PER_PRODUCT = Math.trunc(
  Math.min(
    500,
    Math.max(
      1,
      Number(process.env.CONTINUOUS_CLIP_SUPPLY_TARGET_PER_PRODUCT) || 500,
    ),
  ),
);
const CONTINUOUS_CLIP_SUPPLY_ROLE_TARGET = Math.trunc(
  Math.min(
    50,
    Math.max(1, Number(process.env.CONTINUOUS_CLIP_SUPPLY_ROLE_TARGET) || 7),
  ),
);
const CONTINUOUS_CLIP_SUPPLY_SCAN_INTERVAL_MS = Math.max(
  5_000,
  Number(process.env.CONTINUOUS_CLIP_SUPPLY_SCAN_INTERVAL_MS) || 60_000,
);
const CONTINUOUS_CLIP_SUPPLY_BATCH_SIZE = Math.trunc(
  Math.min(
    5,
    Math.max(1, Number(process.env.CONTINUOUS_CLIP_SUPPLY_BATCH_SIZE) || 2),
  ),
);
const CONTINUOUS_CLIP_SUPPLY_INITIAL_DELAY_MS = Math.max(
  0,
  Number(process.env.CONTINUOUS_CLIP_SUPPLY_INITIAL_DELAY_MS) || 0,
);
const waitForDelay = (delayMs) =>
  new Promise((resolve) => {
    const timer = setTimeout(resolve, Math.max(0, Number(delayMs) || 0));
    timer.unref?.();
  });
const AUTO_RETURN_RETRY_DELAYS_MS = [60_000, 300_000, 900_000, 3_600_000];
const QIANCHUAN_RETRY_DELAYS_MS = [60_000, 300_000, 900_000, 3_600_000];
const QIANCHUAN_DAILY_CAPACITY_PATTERN =
  /(?:今日|每日).*(?:自动混剪)?投放数量上限|已达到.*数量上限/iu;
const QIANCHUAN_POLICY_RECHECK_PATTERN =
  /今日已有成片投放成功但真实消耗尚未回流/iu;
const QIANCHUAN_SHORT_RETRY_PATTERN =
  /频率超限|限频|too much throughput|slow down|code=4028|httpCode=429|原视频已上传.*视频列表暂未返回详情|计划正在更新中/iu;
const QIANCHUAN_SHORT_RETRY_DELAY_MS = 3 * 60_000;
const QIANCHUAN_SAFE_RETRY_POLICY_VERSION = 'serialized-upload-v2';
const AUTO_REMIX_REMEDIATION_DELAY_MS = Math.max(
  250,
  Number(process.env.AUTO_REMIX_REMEDIATION_DELAY_MS) || 60_000,
);
const AUTO_REMIX_MAX_OUTPUT_ATTEMPT_MULTIPLIER = 4;
const AUTO_REMIX_BASE_ROLE_CANDIDATE_LIMIT = 8;
const AUTO_REMIX_ACCESS_AUDIT_LIMIT = 500;
const AUTO_SOURCE_SELECTION_DEFAULT_LIMIT = 3;
const AUTO_SOURCE_SELECTION_MAX_LIMIT = 10;

const normalizedSourceSelectionLimit = (value) =>
  Math.min(AUTO_SOURCE_SELECTION_MAX_LIMIT,
    Math.max(1, Math.trunc(Number(value) || AUTO_SOURCE_SELECTION_DEFAULT_LIMIT)));

export const requiredSourceAssetsForReadiness = (readiness, configuredLimit, durationPlanUnavailable = false) => {
  const missingCandidateCount = readiness.slots.reduce(
    (total, slot) => total + Math.max(0, slot.missingCandidateCount || 0), 0);
  const durationSourceCount = Math.ceil(Math.max(0, Number(readiness.durationShortfallSeconds) || 0) / 30);
  // A complete pool can still contain only overlong or otherwise incompatible
  // whole clips. Keep this explicit failure until a feasible render is saved.
  if (!missingCandidateCount && !durationSourceCount && !durationPlanUnavailable) return 0;
  return Math.min(normalizedSourceSelectionLimit(configuredLimit),
    Math.max(3, Math.ceil(missingCandidateCount / 3), durationSourceCount));
};

export const outputApprovalProvenance = (variant) => {
  if (variant.sourceRevalidation?.required && automaticallyReviewed(variant)) return null;
  if (variant.reviewStatus !== 'approved' || hasPlatformQuarantine(variant) ||
      variant.automaticAssessment?.status === 'failed') return null;
  if (variant.reviewMode === 'human') return 'human';
  if (variant.reviewMode === BASIC_REVIEW_MODE) return basicVariantPassed(variant) ? 'automatic' : null;
  if (variant.reviewMode === 'automatic_rules') return historicalRulesVariantPassed(variant)?'automatic':null;
  if (variant.reviewMode === 'legacy' ||
      (!variant.reviewMode && !variant.automaticAssessment?.visualReview)) return 'legacy';
  return variant.automaticAssessment?.status === 'passed' &&
    hasPassedVisualReview(variant.automaticAssessment, variant.contentSha256) ? 'automatic' : null;
};

export const automaticOutputStats = (renders) => {
  const variants = renders.flatMap(render => render.variants);
  const provenance = variants.map(outputApprovalProvenance);
  const approvedCount = provenance.filter(Boolean).length;
  return {variants, attemptedCount: variants.length, approvedCount,
    rejectedCount: variants.length - approvedCount,
    automaticApprovedCount: provenance.filter(value => value === 'automatic').length,
    humanApprovedCount: provenance.filter(value => value === 'human').length,
    legacyApprovedCount: provenance.filter(value => value === 'legacy').length};
};

export const reconcileOutputApproval = (variant, timestamp, allowAutomaticApproval = true) => {
  const assessment = variant.automaticAssessment;
  if (variant.reviewMode === BASIC_REVIEW_MODE) {
    if (!allowAutomaticApproval || !basicVariantPassed(variant) || hasPlatformQuarantine(variant) || variant.sourceRevalidation?.required) {
      if (assessment) assessment.autoApproved = false;
      variant.reviewStatus = 'changes_requested';
    }
    return;
  }
  if (variant.sourceRevalidation?.required && !['human', 'legacy', 'manual_pending'].includes(variant.reviewMode)) {
    if (assessment) assessment.autoApproved = false;
    variant.reviewStatus = 'changes_requested';
    return;
  }
  if (hasPlatformQuarantine(variant)) {
    variant.reviewStatus = 'changes_requested';
    if (assessment) assessment.autoApproved = false;
    return;
  }
  if(variant.reviewMode==='automatic_rules'){
    if(!allowAutomaticApproval||!historicalRulesVariantPassed(variant)){
      if(assessment)assessment.autoApproved=false;
      variant.reviewStatus='changes_requested';
    }
    return;
  }
  if (!assessment || ['human', 'legacy', 'manual_pending'].includes(variant.reviewMode)) return;
  if (!variant.reviewMode && !assessment.visualReview) {
    // Old versions did not distinguish human review from rule-only approval.
    // Preserve their recorded decision and notes without inventing L4 evidence.
    variant.reviewMode = 'legacy';
    assessment.autoApproved = false;
    return;
  }
  if (assessment.visualReview && assessment.visualReview.version !== VISUAL_REVIEW_VERSION) {
    // A new rule is not a new human review. Keep the original decision, note,
    // timestamp and evidence intact, while withholding current automatic credit.
    assessment.autoApproved = false;
    variant.automaticPolicyRevalidation = {
      required: true, currentVersion: VISUAL_REVIEW_VERSION,
      originalVersion: assessment.visualReview.version || null,
      sha256: variant.contentSha256 || null,
      firstNotedAt: variant.automaticPolicyRevalidation?.firstNotedAt || timestamp,
      message: '原审核记录已保留，当前自动规则需重新核验。',
    };
    return;
  }
  if (variant.automaticPolicyRevalidation && hasPassedVisualReview(assessment,variant.contentSha256))
    variant.automaticPolicyRevalidation = {...variant.automaticPolicyRevalidation,required:false,resolvedAt:timestamp};
  if (!allowAutomaticApproval) {
    assessment.autoApproved = false;
    return;
  }
  if (assessment.status === 'passed' && hasPassedVisualReview(assessment, variant.contentSha256)) {
    variant.reviewStatus = 'approved';
    variant.reviewNote ||= `系统自动成片审核通过（${assessment.score}分）。`;
    assessment.autoApproved = true;
  } else {
    variant.reviewStatus = 'changes_requested';
    variant.reviewNote = `系统自动退回并重剪：${(assessment.suggestions || assessment.reasons || ['未通过完整性规则']).join(' ')}`;
    assessment.autoApproved = false;
  }
  variant.reviewedAt ||= timestamp;
};

const approvalSummary = stats =>
  `通过 ${stats.approvedCount} 条（自动 ${stats.automaticApprovedCount}、人工 ${stats.humanApprovedCount}、历史审核 ${stats.legacyApprovedCount}）`;

const REVIEW_HOLD_STATUSES = new Set(['awaiting_review', 'awaiting_clip_review']);

export const isAutoJobDue = (job, now = Date.now()) => {
  if (!job || job.archivedAt || job.status !== 'active' || !job.nextRunAt ||
      !Number.isFinite(Date.parse(job.nextRunAt)) || Date.parse(job.nextRunAt) > now) return false;
  return !(job.runs || []).some(run => REVIEW_HOLD_STATUSES.has(run.status) && !run.resumeRequestedAt);
};

export const preserveAutoJobOnRestart = (job, timestamp) => {
  if (job.status !== 'active' || job.archivedAt) return;
  const heldRun = (job.runs || []).find(run => REVIEW_HOLD_STATUSES.has(run.status) && !run.resumeRequestedAt);
  if (heldRun) {
    // A restart is not a review decision. Keep the schedule setting, but the
    // held batch requires its owner's explicit resume before any more work.
    job.nextRunAt = null;
    return;
  }
  const interruptedRun = (job.runs || []).find(run => ['preparing', 'generating', 'repairing'].includes(run.status));
  if (interruptedRun) {
    interruptedRun.status = 'queued';
    // Only an already executing batch may restore a missing wakeup. Existing
    // retry dates (including future backoff) are never brought forward.
    job.nextRunAt ||= timestamp;
  }
};

const AUTOMATION_STAGE_DEFINITIONS = [
  ['source_selection', '自动选源'],
  ['source_slicing', '自动切片'],
  ['clip_calibration', '自动校准'],
  ['clip_review', '自动切片审核'],
  ['remix_generation', '自动混剪'],
  ['output_review', '自动成片审核'],
  ['material_center_return', '自动回传云管家'],
  ['qianchuan_delivery', '自动推送千川'],
];
const BLOCKED_SOURCE_PATTERN =
  /待授权|版权待确认|不可用|禁用|回收站|已删除|违规|侵权/u;
const COMMERCIAL_REVIEW_PATTERN =
  /第一|唯一|百分百|永久|根治|治愈|无副作用|医美|药效|祛斑|美白|淡纹|抗老|修复|价格|到手|\d+\s*元/u;
const DRAMA_PERFORMANCE_PATTERN =
  /剧情|情景剧|短剧|小剧场|角色扮演|人物扮演|对白演绎|情节演绎|剧情演绎|演绎/u;
const AUTO_REMIX_RECURSION_PATTERN =
  /自动混剪|自动成片|auto[-_\s]?remix|remix[-_\s]?output/iu;
const AUTO_REMIX_RESLICING_OPT_IN_PATTERN =
  /允许再次拆解|允许重新切片|可再拆解|重新拆解/u;

export const normalizeAutoRemixDuration = (value) => {
  const duration = Math.trunc(Number(value));
  if (
    !Number.isFinite(duration) ||
    duration < AUTO_REMIX_MIN_DURATION_SECONDS ||
    duration > AUTO_REMIX_MAX_DURATION_SECONDS
  ) {
    throw new Error(
      `成片时长需为 ${AUTO_REMIX_MIN_DURATION_SECONDS}–${AUTO_REMIX_MAX_DURATION_SECONDS} 秒。`,
    );
  }
  return duration;
};

export const autoRemixRoleCandidateLimit = (
  targetDurationSeconds,
  frameworkSlotCount,
) =>
  Math.min(
    AUTO_REMIX_MAX_DAILY_OUTPUTS,
    Math.max(
      AUTO_REMIX_BASE_ROLE_CANDIDATE_LIMIT,
      Math.ceil(
        Number(targetDurationSeconds || AUTO_REMIX_DEFAULT_DURATION_SECONDS) /
          Math.max(1, Number(frameworkSlotCount || 1) - 1),
      ) * 2,
    ),
  );

export const autoRemixMaxClipCount = (
  targetDurationSeconds,
  frameworkSlotCount = 1,
) =>
  Math.max(
    1,
    Number(frameworkSlotCount) || 1,
    Math.ceil(
      Number(targetDurationSeconds || AUTO_REMIX_DEFAULT_DURATION_SECONDS) / 2,
    ),
  );

export const sourceSilenceStatsForClip = (clip, source) => {
  const startSeconds = Math.max(0, Number(clip?.startSeconds) || 0);
  const endSeconds = Math.max(startSeconds, Number(clip?.endSeconds) || 0);
  const durationSeconds = Math.max(
    0.01,
    Number(clip?.durationSeconds) || endSeconds - startSeconds,
  );
  const windows = Array.isArray(source?.analysisSilenceWindows)
    ? source.analysisSilenceWindows
    : [];
  const silenceSeconds = windows.reduce((total, window) => {
    const windowStart = Math.max(0, Number(window?.startSeconds) || 0);
    const windowEnd = Math.max(windowStart, Number(window?.endSeconds) || 0);
    return (
      total +
      Math.max(
        0,
        Math.min(endSeconds, windowEnd) - Math.max(startSeconds, windowStart),
      )
    );
  }, 0);
  const allowedSilenceSeconds = Math.max(0.5, durationSeconds * 0.35);
  return {
    durationSeconds: number(durationSeconds),
    silenceSeconds: number(silenceSeconds),
    silenceRatio: number(Math.min(1, silenceSeconds / durationSeconds)),
    allowedSilenceSeconds: number(allowedSilenceSeconds),
    audioAvailable: source?.hasAudio === true,
    passed:
      source?.hasAudio === true && silenceSeconds <= allowedSilenceSeconds,
  };
};

export const autoRemixClipQuality = (clip, source) => {
  const silence = sourceSilenceStatsForClip(clip, source);
  const boundaryPassed = Boolean(
    clip?.approvalSource === 'material_center_effective' ||
    (clip?.automaticAssessment?.status === 'passed' &&
      clip?.automaticAssessment?.boundaryIntegrity?.status === 'passed') ||
    (clip?.reviewStatus === 'approved' &&
      clip?.reviewedAt &&
      !clip?.automaticAssessment?.autoApproved),
  );
  const reasons = [];
  if (!boundaryPassed) reasons.push('内容边界未经可靠审核');
  if (!silence.audioAvailable) reasons.push('来源没有可用音轨');
  if (silence.audioAvailable && !silence.passed) {
    reasons.push(
      `切片连续静音 ${silence.silenceSeconds}/${silence.durationSeconds} 秒`,
    );
  }
  return { eligible: reasons.length === 0, boundaryPassed, silence, reasons };
};

export const selectDurationBalancedItems = ({
  items,
  currentDurationSeconds,
  targetDurationSeconds,
  toleranceSeconds,
  clipWeights = {},
  maxItemCount = Number.POSITIVE_INFINITY,
}) => {
  const durationScale = 10;
  const maximumAdditionalUnits = Math.max(
    0,
    Math.ceil(
      (targetDurationSeconds + toleranceSeconds - currentDurationSeconds) *
        durationScale,
    ),
  );
  const states = new Map([[0, { items: [], weight: 0 }]]);
  for (const item of items) {
    const itemUnits = Math.max(
      1,
      Math.round(Number(item.clip.durationSeconds || 0) * durationScale),
    );
    const itemWeight = Number(clipWeights[item.clip.id] || 1);
    for (const [sumUnits, state] of [...states.entries()]) {
      if (state.items.length >= maxItemCount) continue;
      const nextUnits = sumUnits + itemUnits;
      if (nextUnits > maximumAdditionalUnits) continue;
      const nextWeight = state.weight + itemWeight;
      const existing = states.get(nextUnits);
      if (
        !existing ||
        state.items.length + 1 < existing.items.length ||
        (state.items.length + 1 === existing.items.length &&
          nextWeight > existing.weight)
      ) {
        states.set(nextUnits, {
          items: [...state.items, item],
          weight: nextWeight,
        });
      }
    }
  }
  return (
    [...states.entries()].sort(
      ([leftUnits, left], [rightUnits, right]) =>
        Math.abs(
          targetDurationSeconds -
            (currentDurationSeconds + leftUnits / durationScale),
        ) -
          Math.abs(
            targetDurationSeconds -
              (currentDurationSeconds + rightUnits / durationScale),
          ) ||
        left.items.length - right.items.length ||
        right.weight - left.weight,
    )[0]?.[1]?.items || []
  );
};

const RECOVERABLE_AUTOMATION_ERROR_PATTERN =
  /abort|timeout|timed out|fetch failed|network|socket|econnreset|etimedout|eai_again|temporar|busy|稍后重试|服务繁忙|连接重置|连接超时|读取超时|请求超时|网关超时|响应超时|接口异常|HTTP\s*(?:408|425|429|5\d\d)|请求失败（5\d\d）/iu;
const HARD_EXTERNAL_BLOCKER_PATTERN =
  /未配置|无权限|权限不足|授权不可用|重新授权|invalid token|unauthorized|forbidden|账户.*(?:不存在|无效|不可用)|计划.*(?:不存在|无效|不可用|已结束|已暂停)|护栏|超出.*上限|未确认|禁止|不允许|仅允许|审核未通过|回收站|素材.*不可用/iu;

const automationErrorText = (error) =>
  String(
    error instanceof Error
      ? `${error.name || ''} ${error.message || ''}`
      : error || '',
  ).trim();

export const isRecoverableAutoPipelineError = (error) =>
  (isLibraryConflict(error)||error?.code==='SOURCE_DURATION_GAP'||RECOVERABLE_AUTOMATION_ERROR_PATTERN.test(automationErrorText(error))) &&
  !HARD_EXTERNAL_BLOCKER_PATTERN.test(automationErrorText(error));

const shouldKeepRetryingExternalState = (...values) => {
  // This exact pre-add readback failure is transient, not plan/asset revocation.
  // Leave every other part of the message subject to the existing hard gates.
  const text = values.map((value) => String(value || '')).join(' ')
    .replaceAll('目标计划素材回读暂不可用', '');
  return !HARD_EXTERNAL_BLOCKER_PATTERN.test(text);
};

export const isQianchuanDailyCapacityDeferred = (...values) =>
  QIANCHUAN_DAILY_CAPACITY_PATTERN.test(
    values.map((value) => String(value || '')).join(' '),
  );

export const qianchuanRetryDelayMs = (retryCount, ...values) =>
  QIANCHUAN_SHORT_RETRY_PATTERN.test(
    values.map((value) => String(value || '')).join(' '),
  )
    ? QIANCHUAN_SHORT_RETRY_DELAY_MS
    : QIANCHUAN_RETRY_DELAYS_MS[
        Math.min(
          Math.max(0, Number(retryCount) || 0),
          QIANCHUAN_RETRY_DELAYS_MS.length - 1,
        )
      ];

export const nextQianchuanDeliveryWindowAt = (value = Date.now()) => {
  const timestamp = new Date(value).getTime();
  const chinaOffsetMs = 8 * 60 * 60_000;
  const chinaNow = new Date(timestamp + chinaOffsetMs);
  return new Date(
    Date.UTC(
      chinaNow.getUTCFullYear(),
      chinaNow.getUTCMonth(),
      chinaNow.getUTCDate() + 1,
      0,
      5,
    ) - chinaOffsetMs,
  ).toISOString();
};

export const deferQianchuanDeliveryForCapacity = (state, message = '') => ({
  ...(state || {}),
  status: 'deferred',
  message: '该千川计划今日自动投放额度已满，成片已保留并顺延至下一投放窗口。',
  errorMessage: '',
  errorAdvice: '无需人工处理；系统将在次日额度恢复后沿用同一幂等键自动推送。',
  failureStage: 'capacity',
  deferredReason: safeLabel(message, '今日自动投放额度已满'),
  nextRetryAt: nextQianchuanDeliveryWindowAt(),
  nextPollAt: null,
  updatedAt: new Date().toISOString(),
});

const autoRecoverySummary = (error) => {
  if(isLibraryConflict(error))return '存储更新冲突，已保留原批次和已完成进度，等待自动重试；无需修改外部权限或配置。';
  if(error?.code==='SOURCE_DURATION_GAP')return error.message;
  const text = automationErrorText(error);
  if (/abort|timeout|timed out|超时/iu.test(text)) {
    return '上游响应超时，系统已保留现有成片与回传进度，将自动换源并续跑。';
  }
  return '上游出现临时异常，系统已保留现有进度，将自动重试、换源并续跑。';
};

const mapWithConcurrency = async (items, limit, mapper) => {
  const results = new Array(items.length);
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(Math.max(1, limit), items.length) },
    async () => {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        results[index] = await mapper(items[index], index);
      }
    },
  );
  await Promise.all(workers);
  return results;
};

class RemixAccessError extends Error {
  constructor(message, statusCode = 403) {
    super(message);
    this.statusCode = statusCode;
  }
}

const STORY_TEMPLATE = {
  id: 'hook-pain-solution-proof-cta',
  name: '固定叙事模板：钩子 → 痛点 → 产品方案 → 证明 → 行动',
  description: '适合以用户问题切入、用产品体验承接并在结尾收口的常规成交结构。',
  tags: ['标准成交', '五段式', '问题解决'],
  sourceType: 'preset',
  sourceId: null,
  createdAt: null,
  slots: [
    { id: 'hook', label: '开头钩子', note: '前3秒，吸引继续观看' },
    { id: 'pain', label: '痛点/场景', note: '建立用户问题或需求' },
    { id: 'solution', label: '产品方案', note: '自然承接产品和核心卖点' },
    { id: 'proof', label: '证明/体验', note: '实测、使用感或可信背书' },
    { id: 'cta', label: '行动引导', note: '收口，只能放在结尾' },
  ],
};

const BENEFIT_TEMPLATE = {
  id: 'benefit-solution-demo-proof-urgency',
  name: '利益点前置：福利 → 产品 → 使用 → 证明 → 促单',
  description: '适合大促、价格机制或赠品明确的素材，先给购买理由再补产品证据。',
  tags: ['大促', '利益点', '五段式'],
  sourceType: 'preset',
  sourceId: null,
  createdAt: null,
  slots: [
    { id: 'benefit', label: '利益点/福利', note: '开头直接给出购买理由' },
    { id: 'solution', label: '产品亮相', note: '承接产品和核心卖点' },
    { id: 'demo', label: '使用演示', note: '展示取用、质地或贴敷过程' },
    { id: 'proof', label: '体验证明', note: '效果感知、口碑或可信背书' },
    { id: 'urgency', label: '紧迫促单', note: '活动说明和行动引导' },
  ],
};

const DEFAULT_FRAMEWORKS = [STORY_TEMPLATE, BENEFIT_TEMPLATE];

const emptyLibrary = () => ({
  version: 10,
  frameworks: [],
  deletedFrameworkIds: [],
  folders: [],
  sources: [],
  clips: [],
  renders: [],
  autoJobs: [],
  clipReplenishmentJobs: [],
  autoRemixGrants: [],
  verifiedAutoRemixIdentities: [],
  accessAudit: [],
});

const safeLabel = (value, fallback = '') => {
  const normalized = String(value || '')
    .normalize('NFKC')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return normalized.slice(0, 60) || fallback;
};

const safeTranscript = (value, fallback = '') => {
  const normalized = String(value || '')
    .normalize('NFKC')
    .replace(/[<>\u0000-\u001f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return normalized.slice(0, 500) || fallback;
};

const normalizeUsageDisclaimerText = (value) => {
  const candidate =
    value === undefined || value === null
      ? DEFAULT_USAGE_DISCLAIMER_TEXT
      : value;
  const normalized = safeTranscript(candidate, '').slice(
    0,
    USAGE_DISCLAIMER_MAX_LENGTH,
  );
  if (!normalized) {
    throw new Error('启用全程警示语时，请填写警示语内容。');
  }
  return normalized;
};

const safeExternalDisplayLabel = (value, fallback = '') => {
  const normalized = String(value || '')
    .replace(/[<>\u0000-\u001f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return normalized.slice(0, 255) || fallback;
};

const safeRelativeUploadPath = (value, fallback = '') => {
  const normalized = String(value || '')
    .normalize('NFKC')
    .replace(/[<>:"|?*\u0000-\u001f]/g, '')
    .replace(/\\/g, '/')
    .replace(/\/{2,}/g, '/')
    .replace(/^\/+|\/+$/g, '')
    .trim();
  return normalized.slice(0, 1024) || fallback;
};

const normalizedIdentityValue = (value) =>
  String(value || '')
    .normalize('NFKC')
    .trim()
    .toLocaleLowerCase('zh-CN');

const splitIdentityConfiguration = (value) =>
  String(value || '')
    .split(/[,，;；\n\r]+/u)
    .map(normalizedIdentityValue)
    .filter(Boolean);

const GENERAL_CLIP_CATEGORY = '通用切片';
const PRODUCT_CATEGORY_RULES = [
  { name: '黑晶面膜', pattern: /黑晶/u },
  { name: '燕窝面膜', pattern: /燕窝/u },
  { name: '晶润紧致眼膜', pattern: /晶润|眼膜/u },
  { name: '深海次抛', pattern: /深海|次抛/u },
  { name: 'WIS隐形水润面膜', pattern: /隐形水润|水润面膜|隐形面膜/u },
  { name: '肌活蛋白喷雾', pattern: /肌活蛋白|蛋白喷雾/u },
  { name: '美白针', pattern: /美白针/u },
  { name: '黄金面膜', pattern: /黄金面膜/u },
  { name: '颈膜', pattern: /颈膜/u },
  { name: '其他 WIS 素材', pattern: /其他\s*WIS\s*素材/iu },
  { name: '通用切片', pattern: /(?:^|\s)通用(?:切片|素材)?(?:\s|$)/u },
];
const PRODUCT_CATEGORY_NAMES = new Set(
  PRODUCT_CATEGORY_RULES.map((rule) => rule.name),
);

const inferredProductCategory = (...values) => {
  const directMatches = [
    ...new Set(
      values
        .flatMap((value) => (Array.isArray(value) ? value : [value]))
        .map(workstationProductCategoryForMaterialCenter)
        .filter((category) => PRODUCT_CATEGORY_NAMES.has(category)),
    ),
  ];
  if (directMatches.length === 1) return directMatches[0];
  const text = values
    .flatMap((value) => (Array.isArray(value) ? value : [value]))
    .map((value) => String(value || ''))
    .join(' ');
  const matches = PRODUCT_CATEGORY_RULES.filter((rule) =>
    rule.pattern.test(text),
  ).map((rule) => rule.name);
  return matches.length === 1 ? matches[0] : '';
};

const safeStoredName = (originalName) => {
  const extension = path.extname(String(originalName || '')).toLowerCase();
  return `${randomUUID()}${extension || '.mp4'}`;
};

const number = (value) => Number(Number(value).toFixed(2));

const mediaTimingRecord = (media) => ({
  frameRate: Number(media?.frameRate) || 30,
  nominalFrameRate:
    Number(media?.nominalFrameRate) || Number(media?.frameRate) || 30,
  variableFrameRate: Boolean(media?.variableFrameRate),
  timeBase: String(media?.timeBase || '')
    .replace(/[^\d/]/g, '')
    .slice(0, 24),
  frameCount:
    Number.isFinite(Number(media?.frameCount)) && Number(media.frameCount) > 0
      ? Number(media.frameCount)
      : null,
});

const safeId = (value, fallback = 'custom') => {
  const normalized = String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return normalized || fallback;
};

const filePathForConcat = (filePath) =>
  filePath.replace(/\\/g, '/').replace(/'/g, "'\\''");

const parseCutterTimestamp = (value) => {
  const match = String(value || '').match(
    /^(?:(\d{1,2}):)?(\d{1,2}):(\d{1,2}(?:\.\d+)?)$/,
  );
  if (!match) return Number.NaN;
  return (
    Number(match[1] || 0) * 3600 + Number(match[2]) * 60 + Number(match[3])
  );
};

const overlapSeconds = (left, right) =>
  Math.max(
    0,
    Math.min(left.endSeconds, right.endSeconds) -
      Math.max(left.startSeconds, right.startSeconds),
  );

const accessIdentity = (accessContext) => ({
  id: safeLabel(accessContext?.sub, 'local-user'),
  name: safeLabel(accessContext?.name, '本地工作台'),
});

const escapeDrawTextValue = (value) =>
  String(value || '')
    .replace(/\\/g, '/')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\\'");

export const createClipRemixService = ({
  dataDir,
  readOnly = false,
  maxFileBytes,
  inspectMedia,
  makeSegment,
  runFfmpeg,
  runProcess,
  ffmpegPath,
  readJsonBody,
  nowIso,
  jsonResponse,
  materialCenter,
  cutter,
  // Server-owned resolver only; this is never accepted in an HTTP payload.
  trustedAsrResolver = null,
  sourceVersionResolver = null,
  localAsrRunner = null,
  sourceSemanticReviewer = null,
  sourceReviewQuotaPolicy = null,
  sourceReviewQuotaExtension = null,
  pilotSourceCategoryRepairGrantFile = null,
  progressiveSourcePreparationJobIds = [],
  historicalApprovedInventory = null,
  historicalMediaVerifierFactory = null,
  autoRemixAdminUsers = '',
  allowPrivateUploads = false,
  privateUploadAllowedUsers = null,
  privateUploadAccessMode = 'allowlist',
  tesseractPath = 'tesseract',
  cjkFontFile = '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
}) => {
  const progressiveSourceJobIds=new Set(Array.isArray(progressiveSourcePreparationJobIds)
    ?progressiveSourcePreparationJobIds.filter(id=>typeof id==='string'&&id.trim()===id&&id):[]);
  const privateUploadAllowed = (context) => {
    if (!allowPrivateUploads) return false;
    // Eligibility never substitutes for route authentication or owner filtering.
    // In all-authorized mode a missing identity must not become "local-user".
    if (privateUploadAccessMode === 'all_authorized')
      return Boolean(String(context?.sub || '').trim());
    return privateUploadAllowedUsers === null || String(privateUploadAllowedUsers).split(',').map(v => v.trim()).filter(Boolean).includes(accessIdentity(context).id);
  };
  const root = path.join(dataDir, 'clip-remix');
  const persistRegistration = createRegistrationJournal(path.join(root, 'registration-journal'));
  const sourcesDir = path.join(root, 'sources');
  const clipsDir = path.join(root, 'clips');
  const outputsDir = path.join(root, 'outputs');
  const visualQuality = new VisualQuality({directory:path.join(root,'visual-reviews'),runProcess,ffmpegPath});
  const practicalReviewJobIds=sourceReviewQuotaExtension?.jobId===PRACTICAL_REVIEW_JOB_ID?[PRACTICAL_REVIEW_JOB_ID]:[];
  const sourceReviewer = sourceSemanticReviewer || new SourceSemanticReview({directory:path.join(root,'source-semantic-reviews'),runProcess,ffmpegPath,quotaPolicy:sourceReviewQuotaPolicy,quotaExtension:sourceReviewQuotaExtension,practicalReviewJobIds});
  const sourceVersionManaged = source => typeof sourceVersionResolver === 'function' && source?.productCategory === '黑晶面膜';
  const trustedSourceBoundary = (segment,source) => hasTrustedAsrFrameBoundary(segment,source)
    || (source?.analysisAsrEvidence?.sourceScope?.mode===LEGACY_MODE && hasTrustedLegacyAsrBoundary(segment,source));
  const currentClipEvidencePointer = (clip,source,trustedJobId) => clipSourceReviewScopeAllows(clip,source,trustedJobId) && (hasLegacyClipPointer(clip,source)
    || Boolean(clip.productVersionEvidence && clip.semanticReviewProof &&
      clip.productVersionEvidence.bindingSha256===source?.productVersionEvidence?.bindingSha256));
  const currentSourceContexts = new Map();
  const historicalInventoryEnabled = context => Boolean(!readOnly&&context?.jobId===HISTORICAL_INVENTORY_JOB
    &&context.autoApproveOutputs===true&&historicalApprovedInventory?.mode===HISTORICAL_INVENTORY_MODE
    &&historicalApprovedInventory.referenceSha256===HISTORICAL_REFERENCE_SHA256&&typeof historicalMediaVerifierFactory==='function');
  // Preserve historical company receipts; content rules no longer gate auto jobs.
  const companyRecoveryEnabled = () => false;
  const currentCompanyPass = hasCurrentCompanyPass;
  let pilotSourceCategoryRepair=null;
  const ocrDir = path.join(root, 'ocr');
  const libraryPath = path.join(root, 'library.json');
  const libraryRecoveryPath = `${libraryPath}.previous`;
  let librarySwapInProgress = false;
  const thumbnailFor = createThumbnails({ directory: path.join(root, 'thumbnails'), runFfmpeg });
  const serveThumbnail = async (req, res, key, resolveFile) => {
    const file = await thumbnailFor(key, resolveFile);
    const stat = await fs.stat(file);
    res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': stat.size, 'Cache-Control': 'private, max-age=3600' });
    if (req.method === 'HEAD') res.end(); else await pipeFileToResponse(req, res, file);
  };
  let writeQueue = Promise.resolve();
  let clipQueue = Promise.resolve();
  let renderQueue = Promise.resolve();
  const materialImportPromises = new Map();
  const effectiveImportPromises = new Map();
  const browserPreviewPromises = new Map();
  const sourceAnalysisPromises = new Map();
  const manualOperations = createManualOperations({
    directory: path.join(root, 'manual-operations'),
    afterCompleted: async (type, payload, result) => {
      if (type !== 'upload-clip' || !result?.source?.storedName) return;
      const uploadedPath = path.resolve(payload.upload.storedPath);
      const sourcePath = path.resolve(sourcesDir, result.source.storedName);
      if (
        path.dirname(uploadedPath) === path.resolve(sourcesDir) &&
        uploadedPath !== sourcePath
      ) {
        await fs.rm(uploadedPath, { force: true });
      }
    },
    execute: async (type, payload, identity, progress = async () => {}) => {
      const context = { sub: identity.id, name: identity.name };
      if (type === 'download-bundle') {
        const library = await readLibrary();
        if (!Array.isArray(payload.items) || !payload.items.length || payload.items.length > 100) throw new Error('每次请选择1—100条成片。');
        const entries = [], failures = [];
        for (const item of payload.items) {
          try {
            const render = ownedRender(library, String(item.renderId), context);
            const variant = render.variants.find(v => v.id === String(item.variantId));
            if (!variant || variant.reviewStatus !== 'approved') throw new Error('未通过审核或不存在');
            let file = path.join(outputsDir, variant.storedName);
            if (await missingMedia(file)) file = (await playbackRecovery.output({ render, variant })).path;
            await verifyManualApprovalFile({ filePath: file, expectedSha256: variant.contentSha256, inspectMedia, hashFile });
            entries.push({ path: file, name: variant.outputName, renderId: render.id, variantId: variant.id });
          } catch (error) { failures.push({ id: String(item.renderId) + '/' + String(item.variantId), message: error.message }); }
          await progress(`已核验 ${entries.length + failures.length}/${payload.items.length} 条；可打包 ${entries.length} 条，异常 ${failures.length} 条`);
        }
        if (!entries.length) throw new Error('没有可下载成片：' + failures.map(f => f.message).join('；'));
        const id = randomUUID();
        const directory = path.join(root, 'bundles');
        await fs.mkdir(directory, { recursive: true });
        await progress(`正在打包 ${entries.length} 条已核验成片，请勿重复提交`);
        await writeVideoBundle(path.join(directory, id + '.zip'), entries);
        await fs.writeFile(path.join(directory, id + '.json'), JSON.stringify({ owner: identity.id, items: entries.map(({ renderId, variantId }) => ({ renderId, variantId })), createdAt: nowIso() }));
        return { bundleId: id, url: '/api/remix/bundles/' + id, count: entries.length, failures };
      }
      if (type === 'render') {
        const existing = (await readLibrary()).renders.find(item => item.requestKey === payload.requestKey && payload.requestKey && item.createdById === identity.id);
        return { render: existing || await renderVariants(payload, null, context) };
      }
      if (type === 'upload-clip')
        return createDirectClipUpload(null, context, payload.upload);
      if (type === 'import-private') {
        const source = await importPrivateMaterialCenterSource(payload.assetId, context);
        return { source: publicSourceRecordForUser(source, context) };
      }
      if (type === 'import') {
        const source = await importMaterialCenterSource(
          payload.assetId,
          context,
          { ensurePreview: false, assetLibrary:payload.assetLibrary || "source" },
        );
        return { source: publicSourceRecordForUser(source, context) };
      }
      const library = await readLibrary();
      assertSourceAccess(getSource(library, payload.sourceId), identity);
      if (type === 'analyze')
        return {
          source: publicSourceRecordForUser(
            await analyzeSource(payload.sourceId),
            context,
          ),
        };
      if (type === 'clip')
        return {
          clip: publicClipRecord(await createClip(payload, context), context),
        };
      throw new Error('不支持的后台处理任务。');
    },
  });
  const activeAutoJobIds = new Set();
  const storageConflictRetryAfter = new Map();
  const activeClipReplenishmentJobIds = new Set();
  const activeAutoReturnPromises = new Map();
  const activeQianchuanDeliveryPromises = new Map();
  let autoSchedulerTimer = null;
  let autoSchedulerRunning = false;
  const configuredAutoRemixAdmins = new Set(
    splitIdentityConfiguration(autoRemixAdminUsers),
  );

  const ensureStorage = async () => {
    if (readOnly) {
      await fs.access(libraryPath);
      return;
    }
    await Promise.all([
      fs.mkdir(sourcesDir, { recursive: true }),
      fs.mkdir(clipsDir, { recursive: true }),
      fs.mkdir(outputsDir, { recursive: true }),
      fs.mkdir(ocrDir, { recursive: true }),
    ]);
    try {
      await fs.access(libraryPath);
    } catch {
      for (
        let attempt = 0;
        librarySwapInProgress && attempt < 20;
        attempt += 1
      ) {
        await new Promise((resolve) => setTimeout(resolve, 25));
        try {
          await fs.access(libraryPath);
          return;
        } catch {
          // The Windows fallback briefly moves the current snapshot aside.
        }
      }
      try {
        await fs.access(libraryRecoveryPath);
        await fs.rename(libraryRecoveryPath, libraryPath);
        return;
      } catch {
        // No recoverable previous snapshot exists; initialize a new library.
      }
      await fs.writeFile(
        libraryPath,
        JSON.stringify(emptyLibrary(), null, 2),
        'utf8',
      );
    }
  };

  const normalizedLibrary = (parsed) => ({
    ...emptyLibrary(),
    ...parsed,
    version: emptyLibrary().version,
    sources: Array.isArray(parsed.sources) ? parsed.sources : [],
    frameworks: Array.isArray(parsed.frameworks) ? parsed.frameworks : [],
    deletedFrameworkIds: Array.isArray(parsed.deletedFrameworkIds)
      ? parsed.deletedFrameworkIds
      : [],
    folders: Array.isArray(parsed.folders) ? parsed.folders : [],
    clips: Array.isArray(parsed.clips) ? parsed.clips : [],
    renders: Array.isArray(parsed.renders) ? parsed.renders : [],
    autoJobs: Array.isArray(parsed.autoJobs) ? parsed.autoJobs.map(job=>!readOnly&&job.status==='active'
      ? {...job,autoApproveOutputs:true,reviewPolicy:BASIC_REVIEW_POLICY} : job) : [],
    clipReplenishmentJobs: Array.isArray(parsed.clipReplenishmentJobs)
      ? parsed.clipReplenishmentJobs
      : [],
    autoRemixGrants: Array.isArray(parsed.autoRemixGrants)
      ? parsed.autoRemixGrants
      : [],
    verifiedAutoRemixIdentities: Array.isArray(
      parsed.verifiedAutoRemixIdentities,
    )
      ? parsed.verifiedAutoRemixIdentities
      : [],
    accessAudit: Array.isArray(parsed.accessAudit) ? parsed.accessAudit : [],
  });

  const readReadonlySnapshot = createReadonlyLibrarySnapshot({
    file: libraryPath, normalize: normalizedLibrary,
    onReload: () => invalidateReadModels(),
    refresh: async file => {
      const refreshManaged = globalThis[Symbol.for('pinying.metadata.refresh.v1')];
      if (refreshManaged) await refreshManaged(file);
      // Without a metadata adapter this is an ordinary local atomic file;
      // lstat/read/lstat in the snapshot reader provide its authority.
    },
  });
  const libraryCache = createLibraryReadCache(async () => {
    await ensureStorage();
    let lastError = null;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      try {
        return normalizedLibrary(
          JSON.parse(await fs.readFile(libraryPath, 'utf8')),
        );
      } catch (error) {
        lastError = error;
        if (attempt < 5) {
          await new Promise((resolve) =>
            setTimeout(resolve, 10 * 2 ** attempt),
          );
        }
      }
    }
    throw new Error(
      `切片库状态读取失败，已保留原数据：${lastError instanceof Error ? lastError.message : 'JSON 解析失败'}`,
    );
  });
  const readLibrary = () => readOnly ? readReadonlySnapshot() : libraryCache.read();

  const writeLibraryAtomically = createDeduplicatedLibraryWriter(async (library, serialized) => {
    invalidateReadModels();
    const temporaryPath = `${libraryPath}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporaryPath, serialized, 'utf8');
      try {
        await fs.rename(temporaryPath, libraryPath);
      } catch (error) {
        if (!['EEXIST', 'EPERM'].includes(error?.code)) throw error;
        librarySwapInProgress = true;
        try {
          await fs.rm(libraryRecoveryPath, { force: true });
          await fs.rename(libraryPath, libraryRecoveryPath);
          try {
            await fs.rename(temporaryPath, libraryPath);
          } catch (replacementError) {
            await fs
              .rename(libraryRecoveryPath, libraryPath)
              .catch(() => undefined);
            throw replacementError;
          }
          await fs.rm(libraryRecoveryPath, { force: true });
        } finally {
          librarySwapInProgress = false;
        }
      }
      libraryCache.store(library);
    } finally {
      await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
    }
  });

  const readModelEpoch = randomUUID();
  let readModelRevision = 0;
  const readModelCache = new Map();
  const invalidateReadModels = () => {
    readModelRevision++;
    readModelCache.clear();
  };
  // BEGIN continuous-scan-persistence
  // Scan heartbeats remain visible in memory; only business changes need a
  // durable full-library version. Explicit user operations use updateLibrary.
  const continuousScanBusinessState = (library) => {
    const jobs = new WeakSet();
    const targets = new WeakSet();
    const feedback = new WeakSet();
    for (const render of library.renders || []) {
      for (const variant of render.variants || []) {
        if (variant.cloudDeliveryFeedback && typeof variant.cloudDeliveryFeedback === 'object') {
          feedback.add(variant.cloudDeliveryFeedback);
        }
      }
    }
    for (const job of library.clipReplenishmentJobs || []) {
      if (job.signature !== 'continuous-clip-supply-v1' || !job.continuous ||
          !['active', 'watching'].includes(job.status)) continue;
      jobs.add(job);
      for (const target of job.targets || []) targets.add(target);
    }
    return JSON.stringify(library, function (key, value) {
      // Poll deadlines and last-checked times are in-memory bookkeeping. All
      // receipt contents, native review outcomes and error changes stay durable.
      if (feedback.has(this) && ['checkedAt', 'nextPollAt'].includes(key)) return undefined;
      if (jobs.has(this)) {
        if (['updatedAt', 'lastScanAt', 'nextScanAt', 'currentScanMode'].includes(key)) return undefined;
        if (key === 'status' && ['active', 'watching'].includes(value)) return 'scan-cycle';
      }
      if (targets.has(this)) {
        if (key === 'lastScannedAt') return undefined;
        if (key === 'status' && ['active', 'watching', 'exhausted'].includes(value)) return 'scan-cycle';
      }
      return value;
    });
  };
  // END continuous-scan-persistence

  const updateLibrary = (updater, { scanOnly = false } = {}) => {
    if (readOnly) return Promise.reject(Object.assign(new Error('当前为只读预览，原任务与素材保持不变。'), { statusCode: 423 }));
    const operation = writeQueue.then(async () => {
      const document=globalThis[Symbol.for('pinying.metadata.document.v1')];
      if(document?.handles(libraryPath)){
        const load=async()=>{const snapshot=await document.read(libraryPath);return {snapshot,library:normalizedLibrary(JSON.parse(snapshot.data))};};
        try{
          const initial=await load(),base=initial.library,working=structuredClone(base);
          libraryCache.store(base);
          const before=scanOnly?continuousScanBusinessState(base):null;
          return await persistLibraryUpdate(working,updater,async updated=>{
            if(scanOnly&&before===continuousScanBusinessState(updated)){
              libraryCache.store(updated);invalidateReadModels();return false;
            }
            const committed=await commitLibraryChange({base,wanted:updated,snapshot:initial.snapshot,read:load,
              commit:(snapshot,next)=>document.commit(libraryPath,snapshot,JSON.stringify(next)),canRebase:libraryRebaseAllowed});
            libraryCache.store(committed);invalidateReadModels();return true;
          });
        }catch(error){libraryCache.invalidate();invalidateReadModels();throw error;}
      }
      const library = await readLibrary();
      const libraryVersion = libraryCache.version();
      const scanBefore = scanOnly ? continuousScanBusinessState(library) : null;
      try {
        return await persistLibraryUpdate(
          library,
          updater,
          async (updated) => {
            if (scanOnly && scanBefore === continuousScanBusinessState(updated)) {
              invalidateReadModels();
              return false;
            }
            return writeLibraryAtomically(updated);
          },
        );
      } catch (error) {
        libraryCache.invalidate(libraryVersion);
        invalidateReadModels();
        throw error;
      }
    });
    writeQueue = operation.catch(() => undefined);
    return operation;
  };

  const updateScanLibrary = (updater) => updateLibrary(updater, { scanOnly: true });

  const getSource = (library, id) => library[readIndexes]
    ? library[readIndexes].sources.get(id)
    : library.sources.find((item) => item.id === id);
  const getClip = (library, id) => library[readIndexes]
    ? library[readIndexes].clips.get(id)
    : library.clips.find((item) => item.id === id);
  const allFrameworks = (library) => [
    ...DEFAULT_FRAMEWORKS.filter(
      (framework) => !library.deletedFrameworkIds.includes(framework.id),
    ),
    ...library.frameworks.filter(
      (framework) =>
        !framework.deletedAt &&
        !DEFAULT_FRAMEWORKS.some((preset) => preset.id === framework.id),
    ),
  ];
  const getFramework = (library, id) =>
    allFrameworks(library).find((framework) => framework.id === id);

  const canReadFramework = (library, framework, identity) => frameworkReadable(library, framework, identity, DEFAULT_FRAMEWORKS);

  const renderBelongsToIdentity = (render, identity) => {
    const creatorId = normalizedIdentityValue(render?.createdById);
    return (
      Boolean(creatorId) && creatorId === normalizedIdentityValue(identity?.id)
    );
  };

  const autoJobBelongsToIdentity = (job, identity) => {
    const creatorId = normalizedIdentityValue(job?.createdById);
    return (
      Boolean(creatorId) && creatorId === normalizedIdentityValue(identity?.id)
    );
  };

  const AUTO_REMIX_IN_PROGRESS_RUN_STATUSES = new Set([
    'queued',
    'preparing',
    'generating',
    'repairing',
    'awaiting_sources',
    'awaiting_clip_review',
    'awaiting_review',
  ]);

  const autoJobCleanupEligible = (job) => {
    if (!job || job.archivedAt || activeAutoJobIds.has(job.id)) return false;
    const runs = Array.isArray(job.runs) ? job.runs : [];
    if (
      runs.some((run) => AUTO_REMIX_IN_PROGRESS_RUN_STATUSES.has(run.status))
    ) {
      return false;
    }
    if (runs[0]?.status !== 'completed') return false;
    return (
      job.status === 'paused' ||
      (!autoJobScheduleEnabled(job) && !job.nextRunAt)
    );
  };

  const ownedRender = (library, renderId, accessContext) => {
    const render = library.renders.find((item) => item.id === renderId);
    if (!render) throw new Error('未找到该成片。');
    if (!renderBelongsToIdentity(render, accessIdentity(accessContext))) {
      throw new RemixAccessError('只能查看和操作自己生成的成片。');
    }
    return render;
  };

  const sourceProductCategory = (source) =>
    safeLabel(source?.productCategory, '') ||
      inferredProductCategory(
        source?.materialCenterCategory,
        source?.materialCenterFolderName,
        source?.originalName,
        source?.tags,
      );

  const clipProductCategory = (clip, library) =>
    safeLabel(clip?.productCategory, '') ||
      sourceProductCategory(getSource(library, clip?.sourceId));

  const isAutoRemixAdmin = (accessContext) => {
    if (accessContext?.local) return true;
    const identity = accessIdentity(accessContext);
    return [identity.id, identity.name].some((value) =>
      configuredAutoRemixAdmins.has(normalizedIdentityValue(value)),
    );
  };

  const verifiedAutoRemixIdentityFor = (library, userId) =>
    library.verifiedAutoRemixIdentities.find(
      (identity) =>
        normalizedIdentityValue(identity.userId) ===
        normalizedIdentityValue(userId),
    );

  const verifiedAutoRemixGrant = (library, grant) =>
    Boolean(
      grant?.verifiedAt && verifiedAutoRemixIdentityFor(library, grant.userId),
    );

  const autoRemixGrantFor = (library, identity) =>
    library.autoRemixGrants.find(
      (grant) =>
        verifiedAutoRemixGrant(library, grant) &&
        normalizedIdentityValue(grant.userId) ===
          normalizedIdentityValue(identity.id),
    );

  const autoRemixAccessState = (library, accessContext) => {
    const identity = accessIdentity(accessContext);
    const isAdmin = isAutoRemixAdmin(accessContext);
    return {
      canUse: isAdmin || Boolean(autoRemixGrantFor(library, identity)),
      isAdmin,
      currentUser: identity,
      grants: isAdmin
        ? library.autoRemixGrants.map((grant) => ({
            userId: grant.userId,
            userName: grant.userName,
            grantedAt: grant.grantedAt,
            grantedByName: grant.grantedByName,
            verified: verifiedAutoRemixGrant(library, grant),
            verifiedAt: verifiedAutoRemixGrant(library, grant)
              ? grant.verifiedAt
              : null,
          }))
        : [],
      recentAudit: isAdmin
        ? library.accessAudit.slice(0, 50).map((audit) => ({
            id: audit.id,
            action: audit.action,
            userId: audit.userId,
            userName: audit.userName,
            actorName: audit.actorName,
            createdAt: audit.createdAt,
          }))
        : [],
    };
  };

  const assertAutoRemixAccess = (
    library,
    accessContext,
    { admin = false } = {},
  ) => {
    const state = autoRemixAccessState(library, accessContext);
    if (admin ? !state.isAdmin : !state.canUse) {
      throw new RemixAccessError(
        admin
          ? '仅自动混剪管理员可修改使用权限。'
          : '您尚未开通自动混剪权限，请联系管理员。',
      );
    }
    return state;
  };

  const ownerCanUseAutomation = (library, job) => Boolean(job?.createdById &&
    autoRemixAccessState(library, {sub: job.createdById, name: job.createdByName}).canUse);
  const canPerformAutomaticEffects = (library, job, render) =>
    automaticEffectsAllowed(job, render, ownerCanUseAutomation(library, job));

  const registerVerifiedAutoRemixIdentity = async (accessContext) => {
    // Viewing a migrated snapshot must not rewrite last-seen identity metadata.
    // Existing grants are still evaluated against the authenticated identity.
    if (readOnly) return;
    if (accessContext?.local || accessContext?.service)
      return Promise.resolve();
    const identity = accessIdentity(accessContext);
    const userId = identity.id.trim().toUpperCase();
    if (!/^[A-Z]{2}-\d{6}$/u.test(userId) || !identity.name.trim()) {
      return Promise.resolve();
    }
    const currentLibrary = await readLibrary();
    const current = verifiedAutoRemixIdentityFor(currentLibrary, userId);
    const lastSeenAt = Date.parse(current?.lastSeenAt || '');
    if (
      current?.userName === identity.name &&
      Number.isFinite(lastSeenAt) &&
      Date.now() - lastSeenAt < 12 * 60 * 60 * 1000
    ) {
      return;
    }
    return updateLibrary((library) => {
      const timestamp = nowIso();
      const existing = verifiedAutoRemixIdentityFor(library, userId);
      if (existing) {
        existing.userName = identity.name;
        existing.lastSeenAt = timestamp;
        return;
      }
      library.verifiedAutoRemixIdentities.unshift({
        userId,
        userName: identity.name,
        verifiedAt: timestamp,
        lastSeenAt: timestamp,
        source: 'oa_authenticated_session',
      });
    });
  };

  const pendingIdentityRegistrations = new Map();
  const rememberVerifiedIdentity = accessContext => {
    const key = accessIdentity(accessContext).id;
    if (pendingIdentityRegistrations.has(key)) return;
    const pending = registerVerifiedAutoRemixIdentity(accessContext)
      .catch(() => undefined)
      .finally(() => pendingIdentityRegistrations.delete(key));
    pendingIdentityRegistrations.set(key, pending);
  };
  const readCommittedLibrary = async () => {
    // The snapshot reader first refreshes authoritative metadata, then reuses
    // the unchanged parsed object. Do not decode 54+ MB just to discard it.
    if (!globalThis[Symbol.for('pinying.metadata.refresh.v1')] &&
        process.env.PINYING_METADATA_CONFIG_FILE) await fs.readFile(libraryPath, 'utf8');
    return readReadonlySnapshot();
  };

  const publicFrameworkRecord = (framework) => {
    const { workspaceFingerprint: _workspaceFingerprint, ...publicFramework } =
      framework;
    return {
      ...publicFramework,
      tags:
        Array.isArray(framework.tags) && framework.tags.length
          ? framework.tags
          : framework.slots.slice(0, 4).map((slot) => slot.label),
    };
  };

  const publicFolderRecord = (folder, accessContext) => {
    const identity = accessIdentity(accessContext);
    const { createdById: _createdById, ...publicFolder } = folder;
    return {
      ...publicFolder,
      parentId: folder.parentId || null,
      createdByName: folder.createdByName || '',
      isMine: folder.createdById === identity.id,
    };
  };

  const publicSourceRecord = (source) => {
    const {
      createdById: _createdById,
      createdByName: _createdByName,
      materialCenterPreviewUrl: _materialCenterPreviewUrl,
      browserPreviewStoredName: _browserPreviewStoredName,
      contentSha256: _contentSha256,
      uploadBatchId: _uploadBatchId,
      uploadClientFingerprint: _uploadClientFingerprint,
      uploadRelativePath: _uploadRelativePath,
      sourceSemanticContext: _sourceSemanticContext,
      ...publicSource
    } = source;
    return {
      ...publicSource,
      tags: Array.isArray(source.tags) ? source.tags : [],
      analysisStatus: source.analysisStatus || 'not_started',
      analysisMessage: source.analysisMessage || '',
      speechSegments: Array.isArray(source.speechSegments)
        ? source.speechSegments
        : [],
      productCategory: sourceProductCategory(source),
      previewUrl: `/api/remix/media/source/${source.id}`,
    };
  };

  const publicSourceRecordForUser = (source, accessContext) => ({
    ...publicSourceRecord(source),
    isMine: source.createdById === accessIdentity(accessContext).id,
  });

  const publicClipRecord = (
    clip,
    accessContext,
    folders = [],
    library = null,
  ) => {
    const identity = accessIdentity(accessContext);
    const {
      createdByIds: _createdByIds,
      folderAssignments: _folderAssignments,
      ...publicClip
    } = clip;
    const ownerIds = Array.isArray(clip.createdByIds) ? clip.createdByIds : [];
    const assignedFolderId = clip.folderAssignments?.[identity.id];
    const legacyFolder = folders.find(
      (folder) =>
        folder.id === clip.folderId && folder.createdById === identity.id,
    );
    return {
      ...publicClip,
      ...clipNamePresentation(clip, library ? getSource(library, clip.sourceId) : null),
      sourceContentSha256: library ? getSource(library, clip.sourceId)?.contentSha256 || null : null,
      visibility: library ? effectiveClipVisibility(clip, getSource(library, clip.sourceId)) : normalizeVisibility(clip.visibility),
      folderId: assignedFolderId || legacyFolder?.id || null,
      createdByNames: Array.isArray(clip.createdByNames)
        ? clip.createdByNames
        : [],
      isMine: ownerIds.includes(identity.id),
      productCategory: library
        ? clipProductCategory(clip, library)
        : safeLabel(clip.productCategory, ''),
      previewUrl: `/api/remix/media/clip/${clip.id}`,
    };
  };

  const shanghaiDateKey = (value = new Date()) => {
    const shifted = new Date(value.getTime() + 8 * 60 * 60 * 1000);
    return shifted.toISOString().slice(0, 10);
  };

  const normalizeScheduleTime = (value) => {
    const match = String(value || '').match(/^([01]\d|2[0-3]):([0-5]\d)$/u);
    return match ? `${match[1]}:${match[2]}` : '09:00';
  };

  const nextShanghaiSchedule = (scheduleTime, from = new Date()) => {
    const [hours, minutes] = normalizeScheduleTime(scheduleTime)
      .split(':')
      .map(Number);
    const shifted = new Date(from.getTime() + 8 * 60 * 60 * 1000);
    shifted.setUTCHours(hours, minutes, 0, 0);
    let scheduledAt = new Date(shifted.getTime() - 8 * 60 * 60 * 1000);
    if (scheduledAt.getTime() <= from.getTime()) {
      scheduledAt = new Date(scheduledAt.getTime() + 24 * 60 * 60 * 1000);
    }
    return scheduledAt.toISOString();
  };

  const autoJobScheduleEnabled = (job) => job.scheduleEnabled !== false;
  const nextAutoJobSchedule = (job, from = new Date()) =>
    autoJobScheduleEnabled(job)
      ? nextShanghaiSchedule(job.scheduleTime, from)
      : null;

  const normalizeQianchuanTarget = (value = {}) => ({
    advertiserId: safeLabel(value.advertiserId, ''),
    advertiserName: safeExternalDisplayLabel(value.advertiserName, ''),
    planId: safeLabel(value.planId, ''),
    planName: safeExternalDisplayLabel(value.planName, ''),
    planAlias: safeExternalDisplayLabel(value.planAlias, ''),
    planType: ['multiplication', 'full_domain', 'standard'].includes(
      value.planType,
    )
      ? value.planType
      : 'multiplication',
    verification:
      value.verification && typeof value.verification === 'object'
        ? value.verification
        : null,
  });

  const qianchuanTargetIdentity = (value = {}) =>
    `${safeLabel(value.advertiserId, '')}:${safeLabel(value.planId, '')}`;

  const normalizeQianchuanDelivery = (value = {}) => {
    const suppliedTargets = Array.isArray(value.targets) ? value.targets : [];
    const legacyTarget = normalizeQianchuanTarget(value);
    const rawTargets =
      suppliedTargets.length > 0
        ? suppliedTargets
        : legacyTarget.advertiserId || legacyTarget.planId
          ? [legacyTarget]
          : [];
    const seen = new Set();
    const targets = rawTargets
      .map(normalizeQianchuanTarget)
      .filter((target) => {
        const identity = qianchuanTargetIdentity(target);
        if (identity === ':' || seen.has(identity)) return false;
        seen.add(identity);
        return true;
      })
      .slice(0, 50);
    const primary = targets[0] || normalizeQianchuanTarget();
    return {
      enabled: Boolean(value.enabled),
      confirmed: Boolean(value.confirmed),
      ...primary,
      targets,
      ...normalizeQianchuanDeliveryLimits(value),
    };
  };

  const validateQianchuanDelivery = (config, { active = false } = {}) => {
    if (config.targets.length === 0 && !active) return;
    if (config.targets.length === 0)
      throw new Error('请至少选择一个千川计划。');
    for (const target of config.targets) {
      if (!/^\d+$/u.test(target.advertiserId)) {
        throw new Error('千川账户 ID 格式不正确。');
      }
      if (!/^\d+$/u.test(target.planId)) {
        throw new Error('千川计划 ID 格式不正确。');
      }
    }
    if (!active) return;
    if (!config.confirmed) {
      throw new Error('启用真实千川投放前必须勾选明确确认。');
    }
    assertQianchuanDeliveryLimits(config);
  };

  const qianchuanDeliveryStatesForVariant = (variant) => {
    const states = Array.isArray(variant?.qianchuanDeliveries)
      ? variant.qianchuanDeliveries.filter(Boolean)
      : [];
    if (states.length > 0) return states;
    return variant?.qianchuanDelivery ? [variant.qianchuanDelivery] : [];
  };

  const qianchuanStateForTarget = (variant, target) =>
    qianchuanDeliveryStatesForVariant(variant).find(
      (state) =>
        qianchuanTargetIdentity(state) === qianchuanTargetIdentity(target),
    );

  const setQianchuanStateForTarget = (variant, target, nextState) => {
    const identity = qianchuanTargetIdentity(target);
    const states = qianchuanDeliveryStatesForVariant(variant).filter(
      (state) => qianchuanTargetIdentity(state) !== identity,
    );
    states.push(nextState);
    variant.qianchuanDeliveries = states;
    variant.qianchuanDelivery = states[0];
    return nextState;
  };

  const slotRoleIds = (slot) => {
    const text = `${slot.id} ${slot.label}`.toLowerCase();
    const roleIds = new Set([slot.id]);
    const rules = [
      [/开头|钩子|hook/u, ['hook']],
      [/痛点|场景|pain/u, ['pain']],
      [/产品|方案|solution/u, ['solution']],
      [/证明|体验|proof/u, ['proof']],
      [/行动|下单|收口|cta/u, ['cta']],
      [/利益|福利|benefit/u, ['benefit']],
      [/使用|演示|demo/u, ['demo']],
      [/紧迫|促单|urgency/u, ['urgency', 'cta']],
    ];
    for (const [pattern, matches] of rules) {
      if (pattern.test(text)) matches.forEach((roleId) => roleIds.add(roleId));
    }
    return roleIds;
  };

  const dramaPerformanceText = (...values) =>
    values
      .flatMap((value) => (Array.isArray(value) ? value : [value]))
      .map((value) => String(value || ''))
      .join(' ');

  const isDramaPerformanceText = (...values) =>
    DRAMA_PERFORMANCE_PATTERN.test(dramaPerformanceText(...values));

  const isDramaPerformanceClip = (clip, library) => {
    if (!clip) return false;
    const source = getSource(library, clip.sourceId);
    const overlappingSegments = (source?.speechSegments || []).filter(
      (segment) =>
        segment.endSeconds > clip.startSeconds + 0.05 &&
        segment.startSeconds < clip.endSeconds - 0.05,
    );
    return isDramaPerformanceText(
      clip.name,
      clip.tags,
      source?.originalName,
      source?.tags,
      overlappingSegments.flatMap((segment) => [
        segment.label,
        segment.clipName,
        segment.sceneText,
        segment.sceneDescription,
      ]),
    );
  };

  const sourceDiverseClips = (clips) => {
    const buckets = new Map();
    for (const clip of clips) {
      const bucket = buckets.get(clip.sourceId) || [];
      bucket.push(clip);
      buckets.set(clip.sourceId, bucket);
    }
    const ordered = [];
    while (ordered.length < clips.length) {
      for (const bucket of buckets.values()) {
        const clip = bucket.shift();
        if (clip) ordered.push(clip);
      }
    }
    return ordered;
  };

  const freshAutomationStageReports = () =>
    AUTOMATION_STAGE_DEFINITIONS.map(([key, label]) => ({
      key,
      label,
      status: 'pending',
      totalCount: 0,
      processedCount: 0,
      passedCount: 0,
      reviewRequiredCount: 0,
      failedCount: 0,
      summary: '等待运行',
      evidence: [],
      startedAt: null,
      completedAt: null,
      currentItem: '',
      lastProgressAt: null,
      elapsedSeconds: 0,
    }));

  const normalizedAutomationStageReports = (reports) => {
    const existing = Array.isArray(reports) ? reports : [];
    return freshAutomationStageReports().map((fallback) => {
      const matched =
        existing.find((report) => report?.key === fallback.key) || {};
      const normalized = {
        ...fallback,
        ...matched,
        evidence: Array.isArray(matched.evidence)
          ? matched.evidence.slice(0, 20)
          : [],
      };
      if (normalized.startedAt && !normalized.completedAt) {
        const startedAtMs = Date.parse(normalized.startedAt);
        if (Number.isFinite(startedAtMs)) {
          normalized.elapsedSeconds = Math.max(
            0,
            Math.round((Date.now() - startedAtMs) / 1000),
          );
        }
      }
      return normalized;
    });
  };

  const assetSearchText = (asset) =>
    [
      asset.filename,
      asset.category,
      asset.folderName,
      asset.assetSubtype,
      asset.tags,
      asset.deletionStatus,
      asset.rightsStatus,
    ]
      .flatMap((value) => (Array.isArray(value) ? value : [value]))
      .map((value) => String(value || ''))
      .join(' ');

  const isAutoRemixReturnedAsset = (asset) => {
    const searchable = assetSearchText(asset);
    if (AUTO_REMIX_RESLICING_OPT_IN_PATTERN.test(searchable)) return false;
    return (
      asset.libraryType === 'remix' ||
      AUTO_REMIX_RECURSION_PATTERN.test(searchable)
    );
  };

  const isEligibleSourceAsset = (asset, productCategory) => {
    const extension = path.extname(String(asset.filename || '')).toLowerCase();
    const isVideo =
      /video|视频/u.test(`${asset.contentType} ${asset.assetSubtype}`) ||
      ['.mp4', '.mov', '.m4v', '.webm'].includes(extension);
    const category = inferredProductCategory(
      asset.category,
      asset.folderName,
      asset.filename,
      asset.tags,
    );
    return (
      asset.libraryType === 'source' &&
      isVideo &&
      !asset.isDeleted &&
      !isAutoRemixReturnedAsset(asset) &&
      Boolean(asset.downloadUrl) &&
      !BLOCKED_SOURCE_PATTERN.test(assetSearchText(asset)) &&
      (category === productCategory || category === GENERAL_CLIP_CATEGORY)
    );
  };

  const roleHintsForAsset = (asset) => {
    const text = assetSearchText(asset);
    const rules = [
      [/开头|钩子|前三秒|吸睛|hook/u, 'hook'],
      [/痛点|场景|困扰|干燥|暗沉|熬夜|pain/u, 'pain'],
      [/产品|方案|成分|配方|solution/u, 'solution'],
      [/证明|体验|实测|反馈|口碑|proof/u, 'proof'],
      [/行动|下单|点击|购买|收口|cta/u, 'cta'],
      [/利益|福利|优惠|赠品|benefit/u, 'benefit'],
      [/使用|演示|打开|取出|敷|涂|demo/u, 'demo'],
      [/紧迫|限时|库存|最后|促单|urgency/u, 'urgency'],
    ];
    return new Set(
      rules
        .filter(([pattern]) => pattern.test(text))
        .map(([, roleId]) => roleId),
    );
  };

  const sourceAssetScore = (
    asset,
    importedAssetIds,
    shortageByRole = new Map(),
    productCategory = '',
  ) => {
    const modifiedAt = Date.parse(String(asset.modifiedAt || ''));
    const ageDays = Number.isFinite(modifiedAt)
      ? Math.max(0, (Date.now() - modifiedAt) / 86_400_000)
      : 365;
    const shortageScore = [...roleHintsForAsset(asset)].reduce(
      (total, roleId) => total + (shortageByRole.get(roleId) || 0) * 120,
      0,
    );
    const assetCategory = inferredProductCategory(
      asset.category,
      asset.folderName,
      asset.filename,
      asset.tags,
    );
    return (
      shortageScore +
      (assetCategory === productCategory ? 35 : 0) +
      (importedAssetIds.has(asset.id) ? 0 : 50) +
      (asset.previewUrl ? 10 : 0) +
      Math.max(0, 20 - Math.min(20, ageDays / 7)) +
      Math.min(10, Array.isArray(asset.tags) ? asset.tags.length : 0)
    );
  };

  const suggestedRoleForSegment = (segment, index, total) => {
    const text = `${segment.label || ''} ${segment.sceneText || ''} ${
      segment.sceneDescription || ''
    } ${segment.text || ''}`;
    const purchaseAction=purchaseActionSignal(text);
    const rules = [
      [DRAMA_PERFORMANCE_PATTERN, 'hook'],
      [{test:()=>purchaseAction.intent}, 'cta'],
      [/福利|赠|优惠|到手|价格|活动|大促/u, 'benefit'],
      [/实测|反馈|口碑|证明|用了|使用后|体验/u, 'proof'],
      [/怎么用|使用|打开|取出|敷|涂|演示|质地/u, 'demo'],
      [/产品|面膜|眼膜|次抛|成分|配方|方案/u, 'solution'],
      [/问题|困扰|干燥|紧绷|暗沉|熬夜|缺水|痛点/u, 'pain'],
    ];
    const matched = rules.find(([pattern]) => pattern.test(text));
    if (matched) return { role: matched[1], evidence: '依据识别文案关键词' };
    if (index === 0) return { role: 'hook', evidence: '依据首段位置' };
    if (index === total - 1 && !purchaseAction.suppressPositionalCta) return { role: 'cta', evidence: '依据末段位置' };
    if (index / Math.max(1, total - 1) < 0.34) {
      return { role: 'pain', evidence: '依据前段位置' };
    }
    if (index / Math.max(1, total - 1) > 0.72) {
      return { role: 'proof', evidence: '依据后段位置' };
    }
    return { role: 'solution', evidence: '依据中段位置' };
  };

  const calibrateSourceSegments = (source, trustedJobId) => {
    const segments = (
      Array.isArray(source.speechSegments) ? source.speechSegments : []
    )
      .map((segment) => ({ ...segment }))
      .sort((left, right) => left.startSeconds - right.startSeconds);
    let previousEnd = 0;
    const calibrated = segments.map((segment, index) => {
      const asrSegment = segment.boundaryRule === ASR_FRAME_RULE;
      const nativeBoundary = trustedSourceBoundary(segment, source);
      const boundaryNumber = asrSegment ? preciseBoundarySeconds : number;
      const startSeconds = boundaryNumber(
        Math.max(
          0,
          Math.min(source.durationSeconds - 0.8, segment.startSeconds),
        ),
      );
      const rawEnd = Math.min(source.durationSeconds, segment.endSeconds);
      const endSeconds = boundaryNumber(
        Math.min(
          source.durationSeconds,
          Math.max(startSeconds + 0.8, Math.min(startSeconds + 20, rawEnd)),
        ),
      );
      // An outward sub-frame pad must never be clamped inward into speech.
      const overlapAdjusted = !asrSegment && startSeconds < previousEnd - 0.05;
      const normalizedStart = overlapAdjusted
        ? number(Math.min(endSeconds - 0.8, previousEnd))
        : startSeconds;
      previousEnd = endSeconds;
      const suggestion = suggestedRoleForSegment(
        segment,
        index,
        segments.length,
      );
      const transcript = safeTranscript(segment.label, '');
      const textQuality = assessRecognizedText({text:segment.label, source:segment.transcriptSource, confidence:segment.transcriptConfidence});
      const integerSecondAligned =
        Boolean(segment.integerSecondAligned) &&
        Number.isInteger(Number(segment.startSeconds)) &&
        Number.isInteger(Number(segment.endSeconds));
      const boundaryNeedsReview =
        Boolean(segment.requiresReview) || (asrSegment ? !nativeBoundary : !integerSecondAligned) ||
        (sourceVersionManaged(source) && !validateSourceSemanticProof({proof:segment.semanticReviewProof,source,segment,skuContext:currentSourceContexts.get(source.id),trustedJobId}));
      const reasons = [
        suggestion.evidence,
        textQuality.usable ? '已保留可用识别文字' : '识别文字不可用，自动跳过该候选并继续换源',
        segment.sceneBoundaryAligned
          ? '切点已结合相邻画面转场校准，且不会向内裁掉内容'
          : '未发现足够接近的画面转场，保留语义边界',
        nativeBoundary
          ? '已按真实ASR句界与原视频帧时间对齐，来源与SKU证据可追溯'
          : integerSecondAligned && !asrSegment
          ? `已按原始 ${Number(segment.nativeFrameRate || source.frameRate || 30).toFixed(3)}fps 映射到整数秒与对应帧`
          : '未完成整数秒与原始帧率映射，系统将跳过该候选',
        overlapAdjusted ? '已消除与上一片段的时间重叠' : '切点范围有效',
        ...(Array.isArray(segment.reviewReasons) ? segment.reviewReasons : []),
      ];
      const score = Math.max(
        40,
        Math.min(
          98,
          55 +
            (transcript ? 25 : 0) +
            (overlapAdjusted ? 0 : 10) -
            (boundaryNeedsReview ? 25 : 0),
        ),
      );
      return {
        ...segment,
        index: sourceVersionManaged(source) ? segment.index : index + 1,
        clipName: generatedClipNaming(source, segment).name,
        textQuality,
        startSeconds: normalizedStart,
        endSeconds,
        durationSeconds: boundaryNumber(endSeconds - normalizedStart),
        suggestedRole: suggestion.role,
        automaticCalibration: {
          status:
            !textQuality.usable ? 'text_unavailable' : transcript && !boundaryNeedsReview
              ? 'calibrated'
              : 'review_required',
          score,
          reasons,
          calibratedAt: nowIso(),
        },
      };
    });
    return calibrated.filter((segment) => segment.durationSeconds >= 0.8);
  };

  const buildAutoReadiness = (
    library,
    frameworkId,
    requestedProductCategory = '',
    requestedTargetCount = 1,
    requestedTargetDurationSeconds = AUTO_REMIX_DEFAULT_DURATION_SECONDS,
    trustedJobId,
  ) => {
    if (!library[readIndexes]) library = indexedLibrary(library);
    const candidateFramework = getFramework(library, frameworkId);
    const framework = canReadFramework(library, candidateFramework, null)
      ? candidateFramework
      : null;
    const allApprovedClips = library.clips.filter(
      (clip) =>
        clip.reviewStatus === 'approved' &&
        (trustedJobId || clipSourceReviewScopeAllows(clip,getSource(library,clip.sourceId),trustedJobId)) &&
        !clipIsBlocked(clip) &&
        getSource(library, clip.sourceId)?.visibility !== 'private',
    );
    const productCategory = safeLabel(requestedProductCategory, '');
    const approvedClips = productCategory
      ? allApprovedClips.filter((clip) => {
          const clipCategory = clipProductCategory(clip, library);
          return (
            clipCategory === productCategory ||
            clipCategory === GENERAL_CLIP_CATEGORY
          );
        })
      : [];
    const eligibleApprovedClips = approvedClips.filter(
      (clip) =>
        autoRemixClipQuality(clip, getSource(library, clip.sourceId)).eligible,
    );
    if (!framework) {
      return {
        framework: null,
        slotSelections: {},
        ready: false,
        canProduce: false,
        approvedClipCount: approvedClips.length,
        combinationCapacity: 0,
        maxDailyTarget: 0,
        openingSlotId: '',
        uniqueOpenerCount: 0,
        slots: [],
        productCategory,
        blockingReasons: ['所选框架已失效，请重新选择。'],
      };
    }
    const openingSlotId = framework.slots[0]?.id || '';
    const slotSelections = {};
    const targetDurationSeconds = Math.max(
      AUTO_REMIX_MIN_DURATION_SECONDS,
      Math.min(
        AUTO_REMIX_MAX_DURATION_SECONDS,
        Math.trunc(Number(requestedTargetDurationSeconds)) ||
          AUTO_REMIX_DEFAULT_DURATION_SECONDS,
      ),
    );
    const durationAwareCandidateLimit = autoRemixRoleCandidateLimit(
      targetDurationSeconds,
      framework.slots.length,
    );
    const desiredCandidateCount = Math.min(
      8,
      Math.max(
        1,
        Math.ceil(
          Math.max(1, Number(requestedTargetCount) || 1) **
            (1 / Math.max(1, framework.slots.length)),
        ),
      ),
    );
    const slots = framework.slots.map((slot) => {
      const roleIds = slotRoleIds(slot);
      const isOpeningSlot = slot.id === openingSlotId;
      const sortedCandidates = eligibleApprovedClips
        .filter(
          (clip) =>
            (roleIds.has(clip.role) ||
              (isOpeningSlot && isDramaPerformanceClip(clip, library))) &&
            (isOpeningSlot || !isDramaPerformanceClip(clip, library)),
        )
        .sort(
          (left, right) =>
            Number(right.durationSeconds || 0) -
              Number(left.durationSeconds || 0) ||
            String(right.reviewedAt || right.createdAt).localeCompare(
              String(left.reviewedAt || left.createdAt),
            ),
        );
      const candidates = (
        isOpeningSlot ? sourceDiverseClips(sortedCandidates) : sortedCandidates
      ).slice(
        0,
        isOpeningSlot
          ? AUTO_REMIX_MAX_DAILY_OUTPUTS
          : durationAwareCandidateLimit,
      );
      slotSelections[slot.id] = candidates.map((clip) => clip.id);
      return {
        slotId: slot.id,
        label: slot.label,
        candidateCount: candidates.length,
        takeCount: Math.max(1, Math.min(3, Number(slot.takeCount) || 1)),
        isOpeningSlot,
        desiredCandidateCount: isOpeningSlot
          ? Math.min(
              AUTO_REMIX_MAX_DAILY_OUTPUTS,
              Math.max(1, Math.trunc(Number(requestedTargetCount) || 1)),
            )
          : desiredCandidateCount,
        missingCandidateCount: Math.max(
          0,
          (isOpeningSlot
            ? Math.min(
                AUTO_REMIX_MAX_DAILY_OUTPUTS,
                Math.max(1, Math.trunc(Number(requestedTargetCount) || 1)),
              )
            : desiredCandidateCount) - candidates.length,
        ),
        roleIds: [...roleIds],
      };
    });
    const missingSlots = slots.filter((slot) => slot.candidateCount < slot.takeCount);
    const uniqueOpenerCount =
      slots.find((slot) => slot.isOpeningSlot)?.candidateCount || 0;
    const structuralCombinationCapacity = missingSlots.length
      ? 0
      : slots.reduce(
          (total, slot) =>
            Math.min(
              Number.MAX_SAFE_INTEGER,
              total * Math.max(1, slot.candidateCount),
            ),
          1,
        );
    const combinationCapacity = Math.min(
      structuralCombinationCapacity,
      uniqueOpenerCount,
    );
    const nonOpeningClipIds = new Set(
      framework.slots
        .filter((slot) => slot.id !== openingSlotId)
        .flatMap((slot) => slotSelections[slot.id] || []),
    );
    const maxClipCount = autoRemixMaxClipCount(
      targetDurationSeconds,
      framework.slots.length,
    );
    const nonOpeningDurationSeconds = [...nonOpeningClipIds]
      .map((clipId) => Number(getClip(library, clipId)?.durationSeconds || 0))
      .sort((left, right) => right - left)
      .slice(0, Math.max(0, maxClipCount - 1))
      .reduce((total, duration) => total + duration, 0);
    const requestedOpenerCount = Math.max(
      1,
      Math.min(
        uniqueOpenerCount,
        Math.trunc(Number(requestedTargetCount) || 1),
      ),
    );
    const limitingOpenerDurationSeconds = (slotSelections[openingSlotId] || [])
      .slice(0, requestedOpenerCount)
      .reduce((minimum, clipId) => {
        const duration = Number(getClip(library, clipId)?.durationSeconds || 0);
        return Math.min(minimum, duration);
      }, Number.POSITIVE_INFINITY);
    const maxComposableDurationSeconds = number(
      nonOpeningDurationSeconds +
        (Number.isFinite(limitingOpenerDurationSeconds)
          ? limitingOpenerDurationSeconds
          : 0),
    );
    const durationToleranceSeconds = Math.max(3, targetDurationSeconds * 0.08);
    const durationShortfallSeconds = number(
      Math.max(
        0,
        targetDurationSeconds -
          durationToleranceSeconds -
          maxComposableDurationSeconds,
      ),
    );
    const blockingReasons = [];
    if (!productCategory) {
      blockingReasons.push(
        '请选择本次自动混剪的目标产品；系统只会组合该产品切片与通用切片。',
      );
    } else if (productCategory === GENERAL_CLIP_CATEGORY) {
      blockingReasons.push(
        '通用切片不能作为成片目标产品，请选择本次要生成的具体产品。',
      );
    } else if (!approvedClips.length) {
      blockingReasons.push(
        `“${productCategory}”还没有审核通过的产品切片或通用切片。`,
      );
    } else if (!eligibleApprovedClips.length) {
      blockingReasons.push(
        `“${productCategory}”现有审核通过切片均存在静音、音轨或内容边界问题；系统将自动换源补切。`,
      );
    }
    if (missingSlots.length) {
      blockingReasons.push(
        `以下框架位缺少审核通过的切片：${missingSlots
          .map((slot) => slot.label)
          .join('、')}`,
      );
    }
    const supplyWarnings = [];
    if (
      productCategory &&
      uniqueOpenerCount > 0 &&
      uniqueOpenerCount <
        Math.max(1, Math.trunc(Number(requestedTargetCount) || 1))
    ) {
      supplyWarnings.push(
        `本批要求每条成片使用不同开头，当前只有 ${uniqueOpenerCount} 条可用开头，目标为 ${Math.max(
          1,
          Math.trunc(Number(requestedTargetCount) || 1),
        )} 条。`,
      );
    }
    if (
      productCategory &&
      !missingSlots.length &&
      durationShortfallSeconds > 0
    ) {
      blockingReasons.push(
        `现有框架角色切片最多可拼约 ${maxComposableDurationSeconds} 秒，未达到 ${targetDurationSeconds} 秒目标所需的完整切片范围；仍需补充约 ${durationShortfallSeconds} 秒合格切片。`,
      );
    }
    return {
      framework,
      slotSelections,
      ready: blockingReasons.length === 0 && supplyWarnings.length === 0,
      canProduce: blockingReasons.length === 0 && uniqueOpenerCount > 0,
      supplyWarnings,
      approvedClipCount: eligibleApprovedClips.length,
      libraryApprovedClipCount: approvedClips.length,
      combinationCapacity,
      openingSlotId,
      uniqueOpenerCount,
      targetDurationSeconds,
      maxClipCount,
      maxComposableDurationSeconds,
      durationShortfallSeconds,
      maxDailyTarget: Math.min(
        AUTO_REMIX_MAX_DAILY_OUTPUTS,
        combinationCapacity,
      ),
      slots,
      productCategory,
      blockingReasons: [...blockingReasons, ...supplyWarnings],
    };
  };

  const qianchuanFailureStageLabel = (value) =>
    ({
      upload: '视频上传',
      library_readback: '素材库读回',
      plan_binding: '计划绑定',
      metrics_sync: '数据回流',
    })[String(value || '')] || String(value || '');

  const buildReviewedReadiness = (library, job, duration, usedOpeningIds = new Set()) => {
    if (job?.autoApproveOutputs === true && !historicalInventoryEnabled({jobId:job.id,autoApproveOutputs:true})) {
      const clips = library.clips.filter(clip => canReadClip(clip,getSource(library,clip.sourceId),{id:job.createdById}));
      const result=rankReviewedPools([buildAutoReadiness({...library,clips},job.frameworkId,job.productCategory,job.dailyTarget,duration,job.id)],usedOpeningIds)[0];
      return {...result,evidenceAvailable:Boolean(result?.canProduce),reviewEvidenceMessage:'现有完整切片暂不足，系统等待补源后继续基础审核，无需人工复核。'};
    }
    if(historicalInventoryEnabled({jobId:job.id,autoApproveOutputs:job.autoApproveOutputs})){
      const planned=historicalApprovedInventory.planPools({library,job,identity:{id:job.createdById},canReadSource,canReadClip});
      const candidates=planned.pools.map(pool=>({...buildAutoReadiness({...library,clips:pool.clips},job.frameworkId,
        job.productCategory,job.dailyTarget,duration,job.id),skuVersion:pool.skuVersion,candidateOnly:true,currentMediaVerified:false}));
      const result=rankReviewedPools(candidates,usedOpeningIds)[0]||buildAutoReadiness({...library,clips:[]},job.frameworkId,job.productCategory,job.dailyTarget,duration,job.id);
      return {...result,evidenceAvailable:candidates.some(item=>item.canProduce),inventoryMode:HISTORICAL_INVENTORY_MODE,
        reviewEvidenceMessage:'历史已审核库存暂不能组成当前完整框架；保留原任务与原审核记录，未补做原片识别或新增模型请求。实际选中切片恢复后仍须逐文件核验与新成片技术审核。'};
    }
    const {pools,missingCount} = reviewableSourcePools(library,job.productCategory,job.id);
    const candidates = pools.map(pool => ({...buildAutoReadiness(
      {...library,clips:pool.clips},job.frameworkId,job.productCategory,job.dailyTarget,duration,job.id,
    ),skuVersion:pool.skuVersion,sourceScope:pool.sourceScope}));
    const result = rankReviewedPools(candidates,usedOpeningIds)[0]
      || buildAutoReadiness({...library,clips:[]},job.frameworkId,job.productCategory,job.dailyTarget,duration);
    return {...result,evidenceAvailable:candidates.some(item=>item.canProduce),reviewEvidenceMessage:`等待来源审核依据：现有 ${missingCount} 条相关切片还需核验原文件、真实语音与当前内容；已确认版本分池，未标版别的历史原片按单一来源复用，不要求补填公司产品编码。系统保留原批次，每 5 分钟检查就绪情况，不重复渲染或重复收费。`};
  };

  const derivedClosureStageReports = (reports, variants, job, targetCount) => {
    const normalized = normalizedAutomationStageReports(reports);
    const eligibleVariants = variants.filter(
      (variant) => variant.reviewStatus === 'approved',
    );
    const totalCount = Math.max(
      Number(targetCount) || 0,
      eligibleVariants.length,
    );
    const returnStates = eligibleVariants
      .map((variant) => variant.materialCenterReturn)
      .filter(Boolean);
    const returned = returnStates.filter(
      (state) => state.status === 'completed',
    );
    const returnFailed = returnStates.filter(
      (state) => state.status === 'failed',
    );
    const returnActive = returnStates.filter(
      (state) => !['completed', 'failed'].includes(state.status),
    );
    const returnPending = Math.max(
      0,
      totalCount - returned.length - returnFailed.length - returnActive.length,
    );
    const latestReturnFailure = [...returnFailed].sort((left, right) =>
      String(right.attemptedAt || '').localeCompare(
        String(left.attemptedAt || ''),
      ),
    )[0];
    const returnedAssetIds = returned
      .map((state) => Number(state.assetId || 0))
      .filter((assetId) => assetId > 0);
    const returnReport = normalized.find(
      (report) => report.key === 'material_center_return',
    );
    if (returnReport) {
      Object.assign(returnReport, {
        status:
          totalCount === 0
            ? 'pending'
            : eligibleVariants.length === 0
              ? 'pending'
              : returned.length === totalCount
                ? 'completed'
                : returnFailed.length > 0 || returned.length > 0
                  ? 'partial'
                  : returnActive.length > 0
                    ? 'running'
                    : 'running',
        totalCount,
        processedCount: returned.length + returnFailed.length,
        passedCount: returned.length,
        reviewRequiredCount: returnPending,
        failedCount: returnFailed.length,
        pendingCount: returnPending,
        activeCount: returnActive.length,
        summary:
          totalCount === 0
            ? '等待成片生成并审核。'
            : eligibleVariants.length === 0
              ? '等待系统自动审核出合格成片。'
              : `已成功回传云管家 ${returned.length}/${totalCount} 条；${returnPending} 条等待自动审核通过或回传。`,
        evidence: [
          returnedAssetIds.length
            ? `云管家素材 ID：${returnedAssetIds.join('、')}`
            : '',
          latestReturnFailure?.errorMessage
            ? `最近失败：${latestReturnFailure.errorMessage}`
            : '',
          latestReturnFailure?.nextRetryAt
            ? `下次幂等重试：${latestReturnFailure.nextRetryAt}`
            : '',
        ].filter(Boolean),
        startedAt:
          returnStates
            .map((state) => state.attemptedAt)
            .filter(Boolean)
            .sort()[0] || null,
        completedAt:
          totalCount > 0 && returned.length === totalCount
            ? returned
                .map((state) => state.completedAt)
                .filter(Boolean)
                .sort()
                .at(-1) || null
            : null,
      });
    }

    const qianchuanConfig = normalizeQianchuanDelivery(job?.qianchuanDelivery);
    const qianchuanTargetCount = qianchuanConfig.enabled
      ? qianchuanConfig.targets.length
      : 0;
    const qianchuanTotalCount = totalCount * qianchuanTargetCount;
    const qianchuanStates = eligibleVariants.flatMap(
      qianchuanDeliveryStatesForVariant,
    );
    const qianchuanUploaded = qianchuanStates.filter((state) =>
      Boolean(state.platformAssetId),
    );
    const qianchuanBound = qianchuanStates.filter(
      (state) => state.status === 'success'&&(!companyRecoveryEnabled(job)||Boolean(state.platformAssetId&&state.bindingVerifiedAt)),
    );
    const qianchuanAbnormal = qianchuanStates.filter((state) =>
      ['partial', 'failed'].includes(state.status),
    );
    const qianchuanDeferred = qianchuanStates.filter(
      (state) => state.status === 'deferred',
    );
    const qianchuanTerminal = qianchuanStates.filter((state) =>
      ['success', 'partial', 'failed'].includes(state.status),
    );
    const qianchuanActive = qianchuanStates.filter(
      (state) => !['success', 'partial', 'failed'].includes(state.status),
    );
    const qianchuanPending = Math.max(
      0,
      qianchuanTotalCount - qianchuanTerminal.length,
    );
    const latestQianchuanIssue = [...qianchuanAbnormal].sort((left, right) =>
      String(right.updatedAt || '').localeCompare(String(left.updatedAt || '')),
    )[0];
    const inferredFailureStage =
      latestQianchuanIssue?.failureStage ||
      (latestQianchuanIssue?.platformAssetId &&
      latestQianchuanIssue?.status === 'partial'
        ? 'plan_binding'
        : latestQianchuanIssue
          ? 'upload'
          : '');
    const fallbackAdvice =
      inferredFailureStage === 'plan_binding'
        ? '视频已保留在千川账户素材库；修复计划绑定后应幂等重试，不要重复上传。'
        : '';
    const qianchuanReport = normalized.find(
      (report) => report.key === 'qianchuan_delivery',
    );
    if (qianchuanReport) {
      Object.assign(qianchuanReport, {
        status: !qianchuanConfig.enabled
          ? 'pending'
          : qianchuanTotalCount === 0
            ? 'pending'
            : qianchuanBound.length === qianchuanTotalCount
              ? 'completed'
              : qianchuanAbnormal.length > 0
                ? 'retrying'
                : qianchuanDeferred.length > 0
                  ? 'partial'
                  : qianchuanUploaded.length > 0
                    ? 'partial'
                    : qianchuanActive.length > 0
                      ? 'running'
                      : 'pending',
        totalCount: qianchuanTotalCount,
        processedCount: qianchuanTerminal.length,
        passedCount: qianchuanBound.length,
        reviewRequiredCount: qianchuanPending,
        failedCount: qianchuanAbnormal.length,
        pendingCount: qianchuanPending,
        activeCount: qianchuanActive.length,
        uploadedCount: qianchuanUploaded.length,
        boundCount: qianchuanBound.length,
        summary: !qianchuanConfig.enabled
          ? '本计划未启用真实千川推送。'
          : qianchuanTotalCount === 0
            ? '等待成片审核通过并回传云管家。'
            : `已选择 ${qianchuanTargetCount} 个千川计划；计划目标已上传 ${qianchuanUploaded.length}/${qianchuanTotalCount} 个，已绑定 ${qianchuanBound.length}/${qianchuanTotalCount} 个${
                qianchuanDeferred.length
                  ? `；${qianchuanDeferred.length} 条因今日计划额度已满，已自动顺延至下一投放窗口`
                  : ''
              }。`,
        evidence: [
          qianchuanUploaded.length
            ? `千川视频 ID：${qianchuanUploaded
                .map((state) => state.platformAssetId)
                .filter(Boolean)
                .join('、')}`
            : '',
          latestQianchuanIssue?.taskId
            ? `千川任务 ID：${latestQianchuanIssue.taskId}`
            : '',
          inferredFailureStage
            ? `失败阶段：${qianchuanFailureStageLabel(inferredFailureStage)}`
            : '',
          latestQianchuanIssue?.errorMessage
            ? `失败原因：${latestQianchuanIssue.errorMessage}`
            : '',
          latestQianchuanIssue?.errorAdvice || fallbackAdvice
            ? `处理建议：${latestQianchuanIssue?.errorAdvice || fallbackAdvice}`
            : '',
          latestQianchuanIssue?.nextRetryAt
            ? `下次自动续跑：${latestQianchuanIssue.nextRetryAt}`
            : '',
          qianchuanDeferred[0]?.nextRetryAt
            ? `顺延投放时间：${qianchuanDeferred[0].nextRetryAt}`
            : '',
        ].filter(Boolean),
        currentItem: qianchuanDeferred.length
          ? `${qianchuanDeferred.length} 条等待下一投放窗口，成片与云管家素材均已保留`
          : '',
        startedAt:
          qianchuanStates
            .map((state) => state.attemptedAt)
            .filter(Boolean)
            .sort()[0] || null,
        completedAt:
          qianchuanTotalCount > 0 &&
          qianchuanBound.length === qianchuanTotalCount
            ? qianchuanBound
                .map((state) => state.updatedAt)
                .filter(Boolean)
                .sort()
                .at(-1) || null
            : null,
      });
      if(companyRecoveryEnabled(job)&&qianchuanBound.length<qianchuanTotalCount){
        const rejected=variants.filter(variant=>variant.companyReview?.status==='rejected').length;
        const pending=eligibleVariants.filter(variant=>variant.materialCenterReturn?.status==='completed'&&!currentCompanyPass(variant)).length;
        if(rejected||pending){
          qianchuanReport.status=pending?'pending':'blocked';
          qianchuanReport.summary=`公司审核拒绝 ${rejected} 条、等待公司结果 ${pending} 条；已真实绑定 ${qianchuanBound.length}/${qianchuanTotalCount}。拒绝文件不重复上传，原任务按审核反馈换片。`;
          qianchuanReport.currentItem=pending?'等待当前公司审核结果，不重复渲染或上传':'公司审核拒绝，等待原批次换片';
          qianchuanReport.evidence=[`公司拒绝与本次技术检查分开记录；原文件、原检查及尝试次数保留。`,...qianchuanReport.evidence.filter(item=>!item.startsWith('失败阶段：'))];
        }
      }
    }
    return normalized;
  };

  const publicAutoRun = (run, library, job) => {
    const variants = library.renders
      .filter((render) => run.renderIds.includes(render.id))
      .flatMap((render) => render.variants);
    const reviewedCount = variants.filter(
      (variant) => variant.reviewStatus !== 'pending',
    ).length;
    const approvedCount = variants.filter(
      (variant) => variant.reviewStatus === 'approved',
    ).length;
    return {
      id: run.id,
      dateKey: run.dateKey,
      status:
        ['awaiting_review', 'repairing'].includes(run.status) &&
        approvedCount >= run.targetCount
          ? 'completed'
          : run.status,
      targetCount: run.targetCount,
      targetDurationSeconds:
        Number(run.targetDurationSeconds) ||
        AUTO_REMIX_DEFAULT_DURATION_SECONDS,
      generatedCount: Math.max(run.generatedCount || 0, approvedCount),
      attemptedCount: Math.max(run.attemptedCount || 0, variants.length),
      reviewedCount,
      approvedCount,
      returnedCount: variants.filter(
        (variant) =>
          variant.reviewStatus === 'approved' &&
          variant.materialCenterReturn?.status === 'completed',
      ).length,
      qianchuanUploadedCount: variants
        .filter((variant) => variant.reviewStatus === 'approved')
        .flatMap(qianchuanDeliveryStatesForVariant)
        .filter((state) => Boolean(state.platformAssetId)).length,
      placedCount: variants
        .filter((variant) => variant.reviewStatus === 'approved')
        .flatMap(qianchuanDeliveryStatesForVariant)
        .filter((state) => state.status === 'success').length,
      qianchuanTargetCount: normalizeQianchuanDelivery(job?.qianchuanDelivery)
        .targets.length,
      failedCount: run.failedCount || 0,
      renderIds: [...run.renderIds],
      selectedAssetIds: Array.isArray(run.selectedAssetIds)
        ? [...run.selectedAssetIds]
        : [],
      selectedSourceIds: Array.isArray(run.selectedSourceIds)
        ? [...run.selectedSourceIds]
        : [],
      onDemandSourcePreparation: run.onDemandSourcePreparation
        ? structuredClone(run.onDemandSourcePreparation) : null,
      createdClipIds: Array.isArray(run.createdClipIds)
        ? [...run.createdClipIds]
        : [],
      stageReports: derivedClosureStageReports(
        run.stageReports,
        variants,
        job,
        run.targetCount,
      ),
      startedAt: run.startedAt || null,
      completedAt: run.completedAt || null,
      errorMessage: run.errorMessage || '',
      recoveryCount: Math.max(0, Number(run.recoveryCount) || 0),
      lastRecoveredAt: run.lastRecoveredAt || null,
      lastRecoveryMessage: run.lastRecoveryMessage || '',
    };
  };

  const publicAutoJob = (job, library, historyLimit = 7, readinessCache = new Map()) => {
    // Same catalogue and target parameters: calculate once across sibling jobs.
    // Request-local only, so approval/category/permission changes cannot go stale.
    // All ordinary jobs share the original policy group; only the exact pilot
    // can consume typed practical proofs. Keep this partition even if a future
    // quota loader is disabled: already saved proofs still carry their scope.
    const readinessKey = JSON.stringify([job.id===PRACTICAL_REVIEW_JOB_ID?job.id:'legacy-standard',job.frameworkId, job.productCategory, job.dailyTarget, job.targetDurationSeconds]);
    const readiness = readinessCache.get(readinessKey) || buildAutoReadiness(
      library,
      job.frameworkId,
      job.productCategory,
      job.dailyTarget,
      job.targetDurationSeconds,
      job.id,
    );
    readinessCache.set(readinessKey, readiness);
    const recentRuns = (Array.isArray(job.runs) ? job.runs : [])
      .slice(0, historyLimit)
      .map((run) => publicAutoRun(run, library, job));
    return {
      id: job.id,
      name: job.name,
      frameworkId: job.frameworkId,
      frameworkName: readiness.framework?.name || job.frameworkName,
      productCategory: readiness.productCategory || job.productCategory || '',
      status: job.status,
      dailyTarget: job.dailyTarget,
      scheduleEnabled: autoJobScheduleEnabled(job),
      scheduleTime: job.scheduleTime,
      targetDurationSeconds:
        Number(job.targetDurationSeconds) ||
        AUTO_REMIX_DEFAULT_DURATION_SECONDS,
      timeZone: 'Asia/Shanghai',
      includeUsageDisclaimer: Boolean(job.includeUsageDisclaimer),
      usageDisclaimerText: job.includeUsageDisclaimer
        ? normalizeUsageDisclaimerText(job.usageDisclaimerText)
        : '',
      autoReturnAfterApproval: Boolean(job.autoReturnAfterApproval),
      autoApproveOutputs: Boolean(job.autoApproveOutputs),
      automationPreflight: job.automationPreflight || null,
      qianchuanDelivery: normalizeQianchuanDelivery(job.qianchuanDelivery),
      performanceLearning:
        job.performanceLearning && typeof job.performanceLearning === 'object'
          ? job.performanceLearning
          : {
              status: 'pending',
              sampleSize: 0,
              spendYuan: null,
              gmvYuan: null,
              roi: null,
              recommendations: ['等待千川真实投放与效果回流。'],
              updatedAt: null,
            },
      sourceSelectionLimit: normalizedSourceSelectionLimit(
        job.sourceSelectionLimit,
      ),
      createdAt:
        job.createdAt || recentRuns.at(-1)?.startedAt || job.updatedAt || null,
      updatedAt: job.updatedAt,
      nextRunAt: job.nextRunAt || null,
      lastRunAt: job.lastRunAt || null,
      readiness: {
        ready: readiness.ready,
        approvedClipCount: readiness.approvedClipCount,
        combinationCapacity: readiness.combinationCapacity,
        maxDailyTarget: readiness.maxDailyTarget,
        openingSlotId: readiness.openingSlotId,
        uniqueOpenerCount: readiness.uniqueOpenerCount,
        targetDurationSeconds: readiness.targetDurationSeconds,
        maxComposableDurationSeconds: readiness.maxComposableDurationSeconds,
        durationShortfallSeconds: readiness.durationShortfallSeconds,
        slots: readiness.slots,
        blockingReasons: readiness.blockingReasons,
        productCategory: readiness.productCategory,
      },
      latestRun: recentRuns[0] || null,
      recentRuns: historyLimit > 1 ? recentRuns : [],
      cleanupEligible: autoJobCleanupEligible(job),
    };
  };

  const publicContinuousClipSupply = (library) => {
    const job = library.clipReplenishmentJobs.find(
      (candidate) => candidate.signature === CONTINUOUS_CLIP_SUPPLY_SIGNATURE,
    );
    const generalClips = library.clips.filter(
      (clip) =>
        getSource(library, clip.sourceId)?.visibility !== 'private' &&
        !clipIsBlocked(clip) &&
        clip.reviewStatus === 'approved' &&
        clipProductCategory(clip, library) === GENERAL_CLIP_CATEGORY,
    );
    const frameworkRoles = [
      ...new Set(
        allFrameworks(library)
          .filter((framework) => canReadFramework(library, framework, null))
          .flatMap((framework) =>
            framework.slots.flatMap((slot) => [...slotRoleIds(slot)]),
          ),
      ),
    ];
    const inventory = continuousClipSupplyCategories().map(
      (productCategory) => {
        const productClips = library.clips.filter(
          (clip) =>
            getSource(library, clip.sourceId)?.visibility !== 'private' &&
            !clipIsBlocked(clip) &&
            clip.reviewStatus === 'approved' &&
            clipProductCategory(clip, library) === productCategory,
        );
        const usableClips = [...productClips, ...generalClips];
        const roles = frameworkRoles.map((roleId) => {
          const count = usableClips.filter(
            (clip) => clip.role === roleId,
          ).length;
          return {
            roleId,
            count,
            targetCount: CONTINUOUS_CLIP_SUPPLY_ROLE_TARGET,
            missingCount: Math.max(
              0,
              CONTINUOUS_CLIP_SUPPLY_ROLE_TARGET - count,
            ),
          };
        });
        return {
          productCategory,
          productApprovedCount: productClips.length,
          usableApprovedCount: usableClips.length,
          targetApprovedCount: CONTINUOUS_CLIP_SUPPLY_TARGET_PER_PRODUCT,
          missingApprovedCount: Math.max(
            0,
            CONTINUOUS_CLIP_SUPPLY_TARGET_PER_PRODUCT - productClips.length,
          ),
          shortageRoleCount: roles.filter((role) => role.missingCount > 0)
            .length,
          roles,
        };
      },
    );
    return {
      enabled: Boolean(job?.continuous),
      status:
        job?.status || (materialCenter?.configured ? 'starting' : 'blocked'),
      currentProductCategory: job?.currentProductCategory || '',
      currentAssetId: job?.currentAssetId || null,
      currentScanMode: ['recent', 'history'].includes(job?.currentScanMode)
        ? job.currentScanMode
        : 'idle',
      processedAssetCount: Math.max(0, Number(job?.processedAssetCount) || 0),
      createdClipCount: Math.max(0, Number(job?.createdClipCount) || 0),
      approvedClipCount: Math.max(0, Number(job?.approvedClipCount) || 0),
      rejectedClipCount: Math.max(0, Number(job?.rejectedClipCount) || 0),
      lastScanAt: job?.lastScanAt || null,
      nextScanAt: job?.nextScanAt || null,
      lastSuccessAt: job?.lastSuccessAt || null,
      lastError: job?.lastInfrastructureError || '',
      scanIntervalSeconds: Math.round(
        CONTINUOUS_CLIP_SUPPLY_SCAN_INTERVAL_MS / 1000,
      ),
      targetApprovedPerProduct: CONTINUOUS_CLIP_SUPPLY_TARGET_PER_PRODUCT,
      targetApprovedPerRole: CONTINUOUS_CLIP_SUPPLY_ROLE_TARGET,
      generalApprovedCount: generalClips.length,
      inventory,
      loopPrevention:
        '先处理新增、再扫描历史；素材 ID 与整数秒区间双重去重。“自动混剪”回传成片默认不再拆解，只有明确标记“允许再次拆解”才会进入供应线。',
    };
  };

  const publicLibrary = (library, accessContext, view = 'full') => {
    const identity = accessIdentity(accessContext);
    const cacheKey = JSON.stringify([identity, Boolean(accessContext?.local), view]);
    const cached = readModelCache.get(cacheKey);
    if (cached?.revision === readModelRevision && cached.library === library) return cached.result;
    const originalLibrary = library;
    library = indexedLibrary(library);
    const visibleFrameworks = allFrameworks(library).filter((framework) =>
      canReadFramework(library, framework, identity),
    );
    library = indexedLibrary({
      ...library,
      sources: library.sources.filter((source) =>
        canReadSource(source, identity),
      ),
      clips: library.clips.filter((clip) =>
        canReadClip(clip, getSource(library, clip.sourceId), identity),
      ),
    });
    const autoRemixAccess = autoRemixAccessState(library, accessContext);
    const visibleFolders = library.folders.filter(
      (folder) => folder.createdById === identity.id,
    );
    const readinessCache = new Map();
    const productCategoryCounts = new Map();
    PRODUCT_CATEGORY_RULES.forEach((rule) => {
      productCategoryCounts.set(rule.name, 0);
    });
    for (const source of library.sources) {
      const productCategory = sourceProductCategory(source);
      if (!productCategory || productCategory === GENERAL_CLIP_CATEGORY)
        continue;
      productCategoryCounts.set(
        productCategory,
        productCategoryCounts.get(productCategory) || 0,
      );
    }
    for (const clip of library.clips) {
      if (clip.reviewStatus !== 'approved') continue;
      const productCategory = clipProductCategory(clip, library);
      if (!productCategory || productCategory === GENERAL_CLIP_CATEGORY)
        continue;
      productCategoryCounts.set(
        productCategory,
        (productCategoryCounts.get(productCategory) || 0) + 1,
      );
    }
    const result = {
      revision: `${readModelEpoch}:${readModelRevision}`,
      // Only catalogue changes require a new catalogue download. Pure progress
      // and scheduler heartbeats must not trigger another multi-MB response.
      catalogRevision: createHash('sha256').update(JSON.stringify([
        library.sources.map(source => sourceSummary(publicSourceRecordForUser(source, accessContext))),
        library.clips, visibleFolders, visibleFrameworks,
        library.renders.filter(render => renderBelongsToIdentity(render, identity)),
        autoRemixAccess,
      ])).digest('hex'),
      template: visibleFrameworks[0] || STORY_TEMPLATE,
      frameworks: visibleFrameworks.map(framework => ({...publicFrameworkRecord(framework), visibility: canReadFramework(library, framework, null) ? 'team' : 'private'})),
      folders: visibleFolders.map((folder) =>
        publicFolderRecord(folder, accessContext),
      ),
      sources: view === 'progress' ? [] : library.sources.map((source) => {
        const record = publicSourceRecordForUser(source, accessContext);
        return view === 'compact' ? sourceSummary(record) : record;
      }),
      clips: view === 'progress' ? [] : library.clips.map((clip) =>
        publicClipRecord(clip, accessContext, visibleFolders, library),
      ),
      renders: view === 'progress' ? [] : library.renders
        .filter((render) => renderBelongsToIdentity(render, identity))
        .map((render) => {
          const { createdById: _createdById, ...publicRender } = render;
          return {
            ...publicRender,
            generationMode: render.automation ? 'automatic' : 'manual',
            createdByName: render.createdByName || '',
            isMine: true,
            productCategory: safeLabel(render.productCategory, ''),
            variants: render.variants.map((variant) => ({
              ...variant,
              previewUrl: `/api/remix/media/output/${render.id}/${variant.id}`,
              downloadUrl: `/api/remix/media/output/${render.id}/${variant.id}?download=1`,
            })),
          };
        }),
      automation: {
        startupReadiness: autoRemixAccess.canUse
          ? automaticPipelineReadiness({autoApproveOutputs: true}, {cloudConfigured: materialCenter?.configured})
          : null,
        clipSupply: publicContinuousClipSupply(library),
        jobs: autoRemixAccess.canUse
          ? library.autoJobs
              .filter(
                (job) =>
                  !job.archivedAt && autoJobBelongsToIdentity(job, identity),
              )
              .map((job) => publicAutoJob(job, library, view === 'full' ? 7 : 1, readinessCache))
          : [],
        maxDailyTarget: AUTO_REMIX_MAX_DAILY_OUTPUTS,
        productCategories: [...productCategoryCounts.entries()]
          .map(([name, clipCount]) => ({ name, clipCount }))
          .sort((left, right) => left.name.localeCompare(right.name, 'zh-CN')),
        capabilities: {
          backgroundGeneration: true,
          approvedClipGuard: true,
          humanReviewRequired: false,
          autoReturnAfterApproval: Boolean(materialCenter?.configured),
          automaticSourceSelection: materialCenter?.configured
            ? 'available'
            : 'blocked',
          automaticClipCalibration: 'available',
          automaticClipReview: 'available',
          automaticOutputReview: 'available',
          automaticPlacement: materialCenter?.configured
            ? 'available'
            : 'not_configured',
          performanceFeedback: materialCenter?.configured
            ? 'available'
            : 'not_configured',
          automaticSourceSlicing: 'available',
          strategyOptimization: materialCenter?.configured
            ? 'available'
            : 'not_configured',
        },
      },
      permissions: {
        autoRemix: autoRemixAccess,
      },
    };
    // Bound identity-scoped caches; no shared/CDN caching of private records.
    if (readModelCache.size >= 12) readModelCache.delete(readModelCache.keys().next().value);
    readModelCache.set(cacheKey, { library: originalLibrary, revision: readModelRevision, result });
    return result;
  };

  const parseSourceUpload = (req, context) =>
    new Promise((resolve, reject) => {
      let result = null;
      let storedPath = '';
      let activeStream = null;
      let activeWriter = null;
      let uploadError = null;
      let settled = false;
      const fields = {};
      const tasks = [];
      let busboy;
      const fail = async (error) => {
        if (settled) return;
        settled = true;
        const writerClosed =
          activeWriter && !activeWriter.closed
            ? new Promise((done) => {
                const timeout = setTimeout(done, 1000);
                activeWriter.once('close', () => {
                  clearTimeout(timeout);
                  done();
                });
              })
            : Promise.resolve();
        activeStream?.unpipe(activeWriter || undefined);
        activeStream?.destroy();
        activeWriter?.destroy();
        await writerClosed;
        if (storedPath)
          await fs.rm(storedPath, { force: true }).catch(() => undefined);
        reject(error);
      };
      try {
        busboy = Busboy({
          headers: req.headers,
          defParamCharset: 'utf8',
          limits: {
            files: 1,
            fileSize: maxFileBytes,
            fields: 3,
            fieldSize: 2048,
          },
        });
      } catch {
        reject(new Error('请选择一条视频后再上传。'));
        return;
      }
      busboy.on('field', (name, value) => {
        if (['batchId', 'clientFingerprint', 'visibility'].includes(name)) {
          fields[name] = String(value || '');
        }
      });
      busboy.on('file', (fieldName, stream, info) => {
        if (fieldName !== 'source' || result || storedPath) {
          stream.resume();
          return;
        }
        const extension = path
          .extname(String(info.filename || ''))
          .toLowerCase();
        if (!DIRECT_CLIP_UPLOAD_VIDEO_EXTENSIONS.has(extension)) {
          uploadError = `文件“${safeLabel(info.filename, '未命名文件')}”不是支持的视频格式。`;
          stream.resume();
          return;
        }
        const storedName = safeStoredName(info.filename);
        storedPath = path.join(sourcesDir, storedName);
        const writer = createWriteStream(storedPath, { flags: 'wx' });
        activeStream = stream;
        activeWriter = writer;
        let size = 0;
        stream.on('data', (chunk) => {
          size += chunk.length;
        });
        stream.on('limit', () => {
          uploadError = `文件“${safeLabel(info.filename, '源视频')}”超过单文件大小限制。`;
        });
        const task = new Promise((done, fail) => {
          stream.on('error', fail);
          writer.on('error', fail);
          writer.on('finish', () => {
            result = {
              originalName: safeLabel(info.filename, 'source.mp4'),
              storedName,
              storedPath,
              size,
            };
            done();
          });
        });
        // Observe rejection immediately, not only after the multipart parser
        // finishes: cancellation can destroy a writer before that event exists.
        task.catch((error) => void fail(error));
        tasks.push(task);
        stream.pipe(writer);
      });
      busboy.on('filesLimit', () => {
        uploadError = '一次只能上传一条历史母版视频。';
      });
      busboy.on('error', (error) => void fail(error));
      req.once('aborted', () => void fail(new Error('上传已取消。')));
      busboy.on('finish', async () => {
        if (settled) return;
        try {
          await Promise.all(tasks);
          if (uploadError) throw new Error(uploadError);
          if (!result) throw new Error('未收到视频文件。');
          if (
            !privateUploadAllowed(context) &&
            normalizeVisibility(fields.visibility) === 'private'
          )
            throw new Error('私人上传尚未开放，请使用团队共享素材。');
          settled = true;
          resolve({ ...result, fields });
        } catch (error) {
          await fail(error);
        }
      });
      req.pipe(busboy);
    });

  const parseDirectClipUpload = (req, context) =>
    new Promise((resolve, reject) => {
      let result = null;
      let storedPath = '';
      let activeStream = null;
      let activeWriter = null;
      let uploadError = null;
      let settled = false;
      const fields = {};
      const tasks = [];
      let busboy;
      const fail = async (error) => {
        if (settled) return;
        settled = true;
        const writerClosed =
          activeWriter && !activeWriter.closed
            ? new Promise((done) => {
                const timeout = setTimeout(done, 1000);
                activeWriter.once('close', () => {
                  clearTimeout(timeout);
                  done();
                });
              })
            : Promise.resolve();
        activeStream?.unpipe(activeWriter || undefined);
        activeStream?.destroy();
        activeWriter?.destroy();
        await writerClosed;
        if (storedPath)
          await fs.rm(storedPath, { force: true }).catch(() => undefined);
        reject(error);
      };
      try {
        busboy = Busboy({
          headers: req.headers,
          defParamCharset: 'utf8',
          limits: {
            files: 1,
            fileSize: maxFileBytes,
            fields: 6,
            fieldSize: 2048,
          },
        });
      } catch {
        reject(new Error('请选择视频切片后再上传。'));
        return;
      }
      busboy.on('field', (name, value) => {
        if (
          [
            'batchId',
            'relativePath',
            'targetFolderId',
            'clientFingerprint',
            'productCategory',
            'visibility',
          ].includes(name)
        ) {
          fields[name] = String(value || '');
        }
      });
      busboy.on('file', (fieldName, stream, info) => {
        if (fieldName !== 'source' || result || storedPath) {
          stream.resume();
          return;
        }
        const extension = path
          .extname(String(info.filename || ''))
          .toLowerCase();
        if (!DIRECT_CLIP_UPLOAD_VIDEO_EXTENSIONS.has(extension)) {
          uploadError = `文件“${safeLabel(info.filename, '未命名文件')}”不是支持的视频格式。`;
          stream.resume();
          return;
        }
        const storedName = safeStoredName(info.filename);
        storedPath = path.join(sourcesDir, storedName);
        const writer = createWriteStream(storedPath, { flags: 'wx' });
        activeStream = stream;
        activeWriter = writer;
        let size = 0;
        stream.on('data', (chunk) => {
          size += chunk.length;
        });
        stream.on('limit', () => {
          uploadError = `文件“${safeLabel(info.filename, '视频切片')}”超过单文件大小限制。`;
        });
        const task = new Promise((done, failTask) => {
          stream.on('error', failTask);
          writer.on('error', failTask);
          writer.on('finish', () => {
            result = {
              originalName: safeLabel(info.filename, 'clip.mp4'),
              storedName,
              storedPath,
              size,
            };
            done();
          });
        });
        tasks.push(task);
        stream.pipe(writer);
      });
      busboy.on('filesLimit', () => {
        uploadError = '每次请求只能上传一个视频切片。';
      });
      busboy.on('error', (error) => void fail(error));
      req.once('aborted', () => void fail(new Error('上传已取消。')));
      busboy.on('finish', async () => {
        if (settled) return;
        try {
          await Promise.all(tasks);
          if (uploadError) throw new Error(uploadError);
          if (!result) throw new Error('未收到视频切片。');
          if (
            !privateUploadAllowed(context) &&
            normalizeVisibility(fields.visibility) === 'private'
          )
            throw new Error('私人上传尚未开放，请使用团队共享素材。');
          settled = true;
          resolve({ ...result, fields });
        } catch (error) {
          await fail(error);
        }
      });
      req.pipe(busboy);
    });

  const createSource = async (req, accessContext) => {
    const upload = await parseSourceUpload(req, accessContext);
    try {
      const [media, contentSha256] = await Promise.all([
        inspectMedia(upload.storedPath),
        hashFile(upload.storedPath),
      ]);
      const identity = accessIdentity(accessContext);
      const visibility = normalizeVisibility(upload.fields.visibility);
      const batchId = safeLabel(upload.fields.batchId, randomUUID());
      const clientFingerprint = safeLabel(upload.fields.clientFingerprint, '');
      const result = await updateLibrary((library) => {
        const existing = library.sources.find(
          (source) =>
            (source.contentSha256 === contentSha256 &&
              (visibility === 'team' || source.createdById === identity.id) &&
              normalizeVisibility(source.visibility) === visibility) ||
            (clientFingerprint &&
              normalizeVisibility(source.visibility) === visibility &&
              source.createdById === identity.id &&
              source.uploadBatchId === batchId &&
              source.uploadClientFingerprint === clientFingerprint),
        );
        if (existing) return { source: existing, reused: true };
        const source = {
          id: randomUUID(),
          originalName: upload.originalName,
          storedName: upload.storedName,
          size: upload.size,
          durationSeconds: number(media.duration),
          hasAudio: media.hasAudio,
          ...mediaTimingRecord(media),
          uploadedAt: nowIso(),
          analysisStatus: 'not_started',
          analysisMessage: '',
          speechSegments: [],
          tags: [],
          sourceType: 'manual_upload',
          uploadOrigin: 'material_library',
          uploadBatchId: batchId,
          uploadClientFingerprint: clientFingerprint,
          contentSha256,
          visibility,
          createdById: identity.id,
          createdByName: identity.name,
        };
        library.sources.unshift(source);
        return { source, reused: false };
      });
      if (result.reused) {
        await fs.rm(upload.storedPath, { force: true });
      }
      return result;
    } catch (error) {
      await fs.rm(upload.storedPath, { force: true });
      throw error;
    }
  };

  const hashFile = (filePath) =>
    new Promise((resolve, reject) => {
      const hash = createHash('sha256');
      const stream = createReadStream(filePath);
      stream.on('data', (chunk) => hash.update(chunk));
      stream.on('error', reject);
      stream.on('end', () => resolve(hash.digest('hex')));
    });

  const browserPreviewStoredName = (source) =>
    `${path.parse(source.storedName).name}.browser.mp4`;

  const playbackRecovery=createPlaybackRecovery({directory:process.env.RENDER_PLAYBACK_CACHE_DIR,sourcesDir,
    materialCenter,maxFileBytes,hashFile,inspectMedia,runProcess,ffmpegPath,makeSegment,renderConfig:REMIX_CONFIG});
  const historicalMediaVerifier=historicalApprovedInventory&&typeof historicalMediaVerifierFactory==='function'
    ?historicalMediaVerifierFactory({inventory:historicalApprovedInventory,clipsDir,playbackRecovery,hashFile,inspectMedia,canReadSource,canReadClip,readLibrary}):null;
  const verifyHistoricalInputs=async(clips,library,automationContext,previousEvidence,existingOutputContext)=>{
    const verify=typeof historicalMediaVerifier==='function'?historicalMediaVerifier:historicalMediaVerifier?.verify;
    const assertCurrent=async()=>{
      if(!(await automationContextAllowed(automationContext)))return false;
      const latest=await readLibrary(),job=latest.autoJobs.find(item=>item.id===automationContext.jobId);
      const live=clips.map(clip=>getClip(latest,clip.id));
      return (!existingOutputContext||existingCompanyPassContextCurrent(existingOutputContext,latest))
        &&live.every(clip=>clip&&canReadClip(clip,getSource(latest,clip.sourceId),{id:job.createdById})&&!clipIsBlocked(clip)
          &&(job.reviewPolicy===BASIC_REVIEW_POLICY||!companyClipExcludedForExistingOutput(job,clip,existingOutputContext)))
        &&outputBinding(live,latest.sources,job.productCategory).content===outputBinding(clips,library.sources,job.productCategory).content
        &&outputBinding(live,latest.sources,job.productCategory).review===outputBinding(clips,library.sources,job.productCategory).review;
    };
    if(!historicalInventoryEnabled(automationContext)||typeof verify!=='function'||!(await assertCurrent()))
      throw Object.assign(new Error('历史已审库存的当前权限或实文件核验尚未就绪，未批准新成片。'),{code:'HISTORICAL_INVENTORY_UNAVAILABLE',statusCode:409});
    const result=await verify({clips,library,automationContext,previousEvidence,assertCurrent,existingOutputContext});
    const latest=await readLibrary(),job=latest.autoJobs.find(item=>item.id===automationContext.jobId);
    const input={mode:result.mode,referenceSha256:result.referenceSha256,evidence:result.evidence};
    if(!(await assertCurrent())||!historicalInventoryInputCurrent(input,{clips:clips.map(clip=>getClip(latest,clip.id)),sources:latest.sources,job,runId:automationContext.runId,existingOutputContext})
      ||previousEvidence&&historicalSnapshotDigest(input)!==historicalSnapshotDigest(previousEvidence))
      throw Object.assign(new Error('历史库存、文件或审核快照变化，未复用过期检查。'),{code:'HISTORICAL_INVENTORY_CHANGED',statusCode:409});
    return {...input,resolvedInputs:result.resolvedInputs};
  };
  const missingMedia=async file=>{
    try{await fs.access(file);return false;}catch(error){if(error.code==='ENOENT')return true;throw error;}
  };

  const verifyBasicInputFiles=async(render,variant,library,initial=false)=>{
    const job=library.autoJobs.find(item=>item.id===render.automation?.jobId),state=bindingState(render,variant,library);
    if(!job||!canPerformAutomaticEffects(library,job,render)||!state.current||state.reason==='source_content_changed'||state.reason==='source_missing')throw Error('来源或权限已变化');
    const proofs=[];
    for(const clip of state.clips){
      const source=getSource(library,clip.sourceId);
      const unavailable=record=>!record||record.revoked===true||record.revokedAt||record.disabled===true||record.deliveryBlocked===true||record.deleted===true||record.deletedAt;
      if(!canReadClip(clip,source,{id:job.createdById})||clipIsBlocked(clip)||clip.reviewStatus!=='approved'||unavailable(clip)||unavailable(source))throw Error('来源不可用');
      const old=(variant.basicInputFiles||[]).find(row=>row.clipId===clip.id);
      const historical=variant.historicalInventoryReview?.input?.evidence?.find(row=>row.clipId===clip.id);
      const expected=old?.sha256||historical?.currentClipSha256||clip.contentSha256;
      let file=path.join(clipsDir,clip.storedName);
      if(await missingMedia(file))file=(await playbackRecovery.clip({clip,source,identity:{id:job.createdById},purpose:'render'})).path;
      const stat=await fs.lstat(file),hash=await hashFile(file);
      if(!stat.isFile()||stat.isSymbolicLink()||expected&&expected!==hash||!initial&&!old)throw Error('切片文件版本已变化');
      proofs.push({clipId:clip.id,sha256:hash});
    }
    return proofs;
  };

  const isNativeBrowserPreviewCompatible = (source, media) =>
    path.extname(source.storedName).toLowerCase() === '.mp4' &&
    media.videoCodec === 'h264' &&
    ['yuv420p', 'yuvj420p'].includes(media.pixelFormat) &&
    (!media.hasAudio || media.audioCodec === 'aac');

  const ensureBrowserPreview = async (sourceId) => {
    const currentPromise = browserPreviewPromises.get(sourceId);
    if (currentPromise) return currentPromise;
    const operation = (async () => {
      const library = await readLibrary();
      const source = getSource(library, sourceId);
      if (!source) throw new Error('未找到源视频。');
      const originalPath = path.join(sourcesDir, source.storedName);
      if (source.browserPreviewStoredName) {
        const existingPath = path.join(
          sourcesDir,
          source.browserPreviewStoredName,
        );
        try {
          await fs.access(existingPath);
          return source;
        } catch {
          // Regenerate a missing derived preview below.
        }
      }
      const media = await inspectMedia(originalPath);
      if (isNativeBrowserPreviewCompatible(source, media)) {
        // A read-only preview can use the verified original without persisting
        // derived metadata. Otherwise valid videos fail on the library write.
        if (readOnly) return { ...source, browserPreviewStoredName: source.storedName,
          browserPreviewStatus: 'native', browserPreviewError: '' };
        return updateLibrary((latest) => {
          const current = getSource(latest, sourceId);
          if (!current) throw new Error('源视频在预览检测期间被移除。');
          current.browserPreviewStoredName = current.storedName;
          current.browserPreviewStatus = 'native';
          current.browserPreviewError = '';
          current.videoCodec = media.videoCodec;
          current.pixelFormat = media.pixelFormat;
          current.audioCodec = media.audioCodec;
          Object.assign(current, mediaTimingRecord(media));
          return current;
        });
      }

      if (readOnly) throw Object.assign(new Error('原视频需要兼容转码，迁移预览期间暂未生成。'), { statusCode: 423 });
      const previewStoredName = browserPreviewStoredName(source);
      const previewPath = path.join(sourcesDir, previewStoredName);
      const temporaryPath = path.join(
        sourcesDir,
        `${path.parse(previewStoredName).name}.${randomUUID()}.tmp.mp4`,
      );
      await updateLibrary((latest) => {
        const current = getSource(latest, sourceId);
        if (!current) throw new Error('源视频在预览转码前被移除。');
        current.browserPreviewStatus = 'processing';
        current.browserPreviewError = '';
        return current;
      });
      try {
        await runFfmpeg([
          '-i',
          originalPath,
          '-map',
          '0:v:0',
          '-map',
          '0:a:0?',
          '-vf',
          "scale='min(1080,iw)':-2,format=yuv420p",
          '-c:v',
          'libx264',
          '-preset',
          'veryfast',
          '-crf',
          '22',
          '-profile:v',
          'high',
          '-level',
          '4.1',
          '-c:a',
          'aac',
          '-b:a',
          '160k',
          '-movflags',
          '+faststart',
          '-shortest',
          temporaryPath,
        ]);
        const previewMedia = await inspectMedia(temporaryPath);
        if (
          !isNativeBrowserPreviewCompatible(
            { storedName: previewPath },
            previewMedia,
          )
        ) {
          throw new Error('兼容预览转码完成，但编码仍不满足 H.264/AAC MP4。');
        }
        await fs.rename(temporaryPath, previewPath);
        return updateLibrary((latest) => {
          const current = getSource(latest, sourceId);
          if (!current) throw new Error('源视频在预览转码期间被移除。');
          current.browserPreviewStoredName = previewStoredName;
          current.browserPreviewStatus = 'transcoded';
          current.browserPreviewError = '';
          current.videoCodec = media.videoCodec;
          current.pixelFormat = media.pixelFormat;
          current.audioCodec = media.audioCodec;
          Object.assign(current, mediaTimingRecord(media));
          return current;
        });
      } catch (error) {
        await fs.rm(temporaryPath, { force: true });
        await updateLibrary((latest) => {
          const current = getSource(latest, sourceId);
          if (!current) return null;
          current.browserPreviewStoredName = '';
          current.browserPreviewStatus = 'failed';
          current.browserPreviewError =
            error instanceof Error
              ? safeLabel(error.message, '浏览器兼容预览生成失败。')
              : '浏览器兼容预览生成失败。';
          return current;
        }).catch(() => undefined);
        throw error;
      }
    })();
    browserPreviewPromises.set(sourceId, operation);
    try {
      return await operation;
    } finally {
      browserPreviewPromises.delete(sourceId);
    }
  };

  const importMaterialCenterSource = async (
    assetIdValue,
    accessContext,
    options = {},
  ) => {
    if (!materialCenter?.configured) {
      throw new Error('素材中心双向接口尚未配置。');
    }
    const assetId = Number(assetIdValue);
    if (!Number.isInteger(assetId) || assetId <= 0) {
      throw new Error('素材中心素材 ID 无效。');
    }
    const assetLibrary = options.assetLibrary || options.asset?.assetLibrary || "source";
    const importKey = `${assetLibrary}:${assetId}`;
    const existingPromise = materialImportPromises.get(importKey);
    if (existingPromise) return existingPromise;

    const operation = (async () => {
      const asset =
        Number(options.asset?.id) === assetId
          ? options.asset
          : await materialCenter.getAsset(assetId, {assetLibrary});
      const currentLibrary = await readLibrary();
      const existing = currentLibrary.sources.find(
        (source) =>
          source.materialCenterAssetId === asset.id &&
          source.materialCenterObjectKey === asset.objectKey &&
          source.size === asset.size,
      );
      if (existing) {
        if(pilotSourceCategoryRepairGrantFile&&!pilotSourceCategoryRepair)pilotSourceCategoryRepair=createPilotSourceCategoryRepair({
          grantFile:pilotSourceCategoryRepairGrantFile,evidenceDirectory:path.join(root,'pilot-source-category-repair-evidence'),
          readSource:async id=>getSource(await readLibrary(),id),
          readJob:async id=>(await readLibrary()).autoJobs.find(job=>job.id===id),
          readCurrentAsset:id=>materialCenter.getAsset(id,{requireUploadPreparationMetadata:true}),
          readMedia:async source=>{
            const file=path.join(sourcesDir,source.storedName),before=await fs.lstat(file);
            if(!before.isFile()||before.isSymbolicLink())throw Error('repair_media_not_regular');
            const sha256=await hashFile(file),after=await fs.lstat(file);
            if(!after.isFile()||after.isSymbolicLink()||['dev','ino','size','mtimeMs','ctimeMs'].some(key=>before[key]!==after[key]))
              throw Error('repair_media_changed');
            return {sha256,size:after.size};
          },
          commitCategory:({sourceId,jobId,apply})=>updateLibrary(library=>apply(getSource(library,sourceId),library.autoJobs.find(job=>job.id===jobId))),
          now:nowIso,
        });
        const repairTicket=pilotSourceCategoryRepair?await pilotSourceCategoryRepair.begin({sourceId:existing.id,identity:accessIdentity(accessContext)}):null;
        await ensureLinkedSourceOnDisk({
          source: existing, asset, identity: accessIdentity(accessContext),
          sourcesDir, maxFileBytes,
          downloadAsset: materialCenter.downloadAsset,
          inspectMedia, hashFile,
        });
        if(repairTicket)await pilotSourceCategoryRepair.finish(repairTicket);
        let resolved = repairTicket?getSource(await readLibrary(),existing.id):existing;
        if (
          (!existing.materialCenterPreviewUrl && asset.previewUrl) ||
          existing.materialCenterCategory !== asset.category ||
          existing.materialCenterFolderName !== asset.folderName ||
          existing.materialCenterEffective !== asset.effective ||
          existing.materialCenterEffectiveMarkedAt !== asset.effectiveMarkedAt
        ) {
          resolved = await updateLibrary((library) => {
            const current = getSource(library, existing.id);
            if (!current.materialCenterPreviewUrl && asset.previewUrl) {
              current.materialCenterPreviewUrl = asset.previewUrl;
            }
            current.materialCenterCategory = asset.category;
            current.materialCenterFolderName = asset.folderName;
            current.materialCenterEffective = asset.effective;
            current.materialCenterEffectiveMarkedAt = asset.effectiveMarkedAt;
            return current;
          });
        }
        if (options.ensurePreview === false) return resolved;
        try {
          return await ensureBrowserPreview(resolved.id);
        } catch {
          return getSource(await readLibrary(), resolved.id);
        }
      }

      const storedName = safeStoredName(asset.filename);
      const storedPath = path.join(sourcesDir, storedName);
      try {
        await materialCenter.downloadAsset(asset, storedPath, maxFileBytes);
        const media = await inspectMedia(storedPath);
        const created = await updateLibrary((library) => {
          const duplicate = library.sources.find(
            (source) =>
              source.materialCenterAssetId === asset.id &&
              source.materialCenterObjectKey === asset.objectKey &&
              source.size === asset.size,
          );
          if (duplicate) return duplicate;
          const source = {
            id: randomUUID(),
            originalName: safeLabel(asset.filename, 'source.mp4'),
            storedName,
            size: asset.size,
            durationSeconds: number(media.duration),
            hasAudio: media.hasAudio,
            ...mediaTimingRecord(media),
            uploadedAt: nowIso(),
            analysisStatus: 'not_started',
            analysisMessage: '',
            speechSegments: [],
            tags: Array.isArray(asset.tags) ? asset.tags.slice(0, 8) : [],
            sourceType: 'material_center',
            materialCenterAssetId: asset.id,
            materialCenterObjectKey: asset.objectKey,
            materialCenterCategory: asset.category,
            materialCenterFolderName: asset.folderName,
            materialCenterLibraryType: asset.libraryType,
            materialCenterAssetLibrary: asset.assetLibrary,
            materialCenterImportedAt: nowIso(),
            materialCenterPreviewUrl: asset.previewUrl,
            materialCenterEffective: asset.effective,
            materialCenterEffectiveMarkedAt: asset.effectiveMarkedAt,
            createdById: accessIdentity(accessContext).id,
            createdByName: accessIdentity(accessContext).name,
          };
          library.sources.unshift(source);
          return source;
        });
        if (options.ensurePreview === false) return created;
        try {
          return await ensureBrowserPreview(created.id);
        } catch {
          return getSource(await readLibrary(), created.id);
        }
      } catch (error) {
        await fs.rm(storedPath, { force: true });
        throw error;
      }
    })();
    materialImportPromises.set(importKey, operation);
    try {
      return await operation;
    } finally {
      materialImportPromises.delete(importKey);
    }
  };

  const importPrivateMaterialCenterSource = async (assetId, context) => {
    if (!privateUploadAllowed(context)) throw new Error('私人素材功能尚未对当前账号开放，未改为共享导入。');
    if (!materialCenter.configured || !materialCenter.getPrivateAsset) throw new Error('云管家私人素材接口未接通。');
    if (!/^[a-f0-9-]{36}$/iu.test(String(assetId))) throw new Error('私人素材 ID 无效。');
    const identity = accessIdentity(context);
    const key = `private:${identity.id}:${assetId}`;
    if (materialImportPromises.has(key)) return materialImportPromises.get(key);
    const operation = (async () => {
      // Always verify the current owner at cloud before reusing a local copy.
      const asset = await materialCenter.getPrivateAsset(assetId, identity.id);
      if (asset.id !== assetId || asset.visibility !== 'private' || asset.status !== 'ready' || !asset.content_type?.startsWith('video/'))
        throw new Error('请选择本人已上传完成的私人视频。');
      const matches = source => source.cloudPrivateAssetId === assetId && source.createdById === identity.id && source.visibility === 'private';
      const existing = (await readLibrary()).sources.find(matches);
      if (existing) return existing;
      const storedName = safeStoredName(asset.filename);
      const storedPath = path.join(sourcesDir, storedName);
      try {
        await materialCenter.downloadPrivateAsset(asset, identity.id, storedPath, maxFileBytes);
        const media = await inspectMedia(storedPath);
        if (!(number(media.duration) > 0)) throw new Error('私人视频时长无效。');
        return await updateLibrary(library => {
          const duplicate = library.sources.find(matches);
          if (duplicate) return duplicate;
          const source = {
            id: randomUUID(), originalName: safeLabel(asset.filename, 'private.mp4'), storedName,
            size: asset.size, durationSeconds: number(media.duration), hasAudio: media.hasAudio,
            ...mediaTimingRecord(media), uploadedAt: nowIso(), analysisStatus: 'not_started',
            analysisMessage: '', speechSegments: [], tags: ['云管家私人素材'], visibility: 'private',
            sourceType: 'material_center', cloudPrivateAssetId: assetId,
            materialCenterCategory: asset.category, materialCenterFolderName: asset.folder_name,
            materialCenterImportedAt: nowIso(), createdById: identity.id, createdByName: identity.name,
          };
          library.sources.unshift(source);
          return source;
        });
      } catch (error) {
        await fs.rm(storedPath, { force: true });
        throw error;
      }
    })();
    materialImportPromises.set(key, operation);
    try { return await operation; } finally { materialImportPromises.delete(key); }
  };

  const fallbackSpeechSegments = (source) =>
    speechCandidatesFromSilence([], source.durationSeconds, source.frameRate);

  const cutterSpeechSegments = (
    results,
    durationSeconds,
    silenceWindows = [],
    sceneBoundaries = [],
    frameRate = 30,
  ) => {
    const segments = [];
    for (const result of Array.isArray(results) ? results : []) {
      const [rawStart, rawEnd] = String(result?.time_range || '').split('-');
      const startSeconds = Math.max(0, parseCutterTimestamp(rawStart));
      const endSeconds = Math.min(
        durationSeconds,
        parseCutterTimestamp(rawEnd),
      );
      if (
        !Number.isFinite(startSeconds) ||
        !Number.isFinite(endSeconds) ||
        endSeconds - startSeconds < 0.8
      ) {
        continue;
      }
      const transcript = safeTranscript(
        result?.script_text || result?.scene_text,
        '',
      );
      segments.push({
        startSeconds,
        endSeconds,
        boundaryType: 'cutter',
        transcriptSource: 'cutter',
        label: transcript,
        sceneDescription: safeTranscript(result?.scene_description, ''),
        sceneText: safeTranscript(result?.scene_text, ''),
        cameraAngle: safeLabel(result?.camera_angle, ''),
        shotSize: safeLabel(result?.shot_size, ''),
        cameraMovement: safeLabel(result?.camera_movement, ''),
      });
    }
    return normalizeSpeechCandidates({
      candidates: segments,
      durationSeconds,
      silenceWindows,
      sceneBoundaries,
      frameRate,
    });
  };

  const normalizeOcrText = (value) => {
    const lines = String(value || '')
      .split(/\r?\n/)
      .map((line) =>
        line
          .normalize('NFKC')
          .replace(/[|_~`^]+/g, ' ')
          .replace(/\s+/g, ' ')
          .trim(),
      )
      .filter(
        (line) =>
          line.length >= 2 &&
          !/^wis\+?$/i.test(line) &&
          !line.includes(DEFAULT_USAGE_DISCLAIMER_TEXT),
      );
    return safeTranscript(lines.join(' '), '');
  };

  const ocrSpeechSegments = async (
    source,
    silenceWindows = [],
    sceneBoundaries = [],
  ) => {
    const tempDir = path.join(ocrDir, `${source.id}-${randomUUID()}`);
    const intervalSeconds = Math.max(1.5, source.durationSeconds / 48);
    await fs.mkdir(tempDir, { recursive: true });
    try {
      await runProcess(
        ffmpegPath,
        [
          '-y',
          '-hide_banner',
          '-loglevel',
          'error',
          '-i',
          path.join(sourcesDir, source.storedName),
          '-vf',
          `fps=1/${intervalSeconds},scale=720:-2`,
          '-q:v',
          '3',
          path.join(tempDir, 'frame-%04d.jpg'),
        ],
        { timeoutMs: 180000 },
      );
      const frames = (await fs.readdir(tempDir))
        .filter((name) => /^frame-\d+\.jpg$/i.test(name))
        .sort()
        .slice(0, 48);
      const recognizedSamples = await mapWithConcurrency(
        frames,
        OCR_FRAME_CONCURRENCY,
        async (frame, index) => {
          const result = await runProcess(
            tesseractPath,
            [
              path.join(tempDir, frame),
              'stdout',
              '-l',
              'chi_sim+eng',
              '--psm',
              '11',
              '-c',
              'tessedit_create_tsv=1',
            ],
            { timeoutMs: 30000, resourceClass: 'ocr' },
          );
          const recognized = parseOcrTsv(result.stdout, {frame, atSeconds:index * intervalSeconds});
          const text = normalizeOcrText(recognized.text);
          if (!text) return null;
          return {
            text,
            confidence: recognized.confidence,
            evidence: recognized.evidence,
            startSeconds: Math.min(
              source.durationSeconds,
              index * intervalSeconds,
            ),
            endSeconds: Math.min(
              source.durationSeconds,
              (index + 1) * intervalSeconds,
            ),
          };
        },
      );
      const samples = recognizedSamples.filter(Boolean);
      return normalizeSpeechCandidates({
        candidates: mergeOcrSamples(samples, intervalSeconds),
        durationSeconds: source.durationSeconds,
        silenceWindows,
        sceneBoundaries,
        frameRate: source.frameRate,
      });
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  };

  const materializeSpeechSegments = (sourceId, candidates) =>
    candidates.map((candidate, index) => ({
      id: `${sourceId}-${randomUUID()}`,
      index: index + 1,
      label: candidate.boundaryRule === ASR_FRAME_RULE ? String(candidate.label ?? '') : safeTranscript(
        candidate.label,
        `口播段 ${String(index + 1).padStart(2, '0')}`,
      ),
      startSeconds: (candidate.boundaryRule === ASR_FRAME_RULE ? preciseBoundarySeconds : number)(candidate.startSeconds),
      endSeconds: (candidate.boundaryRule === ASR_FRAME_RULE ? preciseBoundarySeconds : number)(candidate.endSeconds),
      durationSeconds: (candidate.boundaryRule === ASR_FRAME_RULE ? preciseBoundarySeconds : number)(candidate.endSeconds - candidate.startSeconds),
      nativeFrameAligned: Boolean(candidate.nativeFrameAligned),
      semanticBoundaryTrusted: Boolean(candidate.semanticBoundaryTrusted),
      boundaryRule: candidate.boundaryRule || null,
      boundaryEvidence: candidate.boundaryEvidence || null,
      boundaryType: candidate.boundaryType,
      transcriptSource: candidate.transcriptSource || 'silence',
      transcriptConfidence: candidate.transcriptConfidence ?? null,
      ocrEvidence: candidate.ocrEvidence || [],
      textQuality: assessRecognizedText({text:candidate.label, source:candidate.transcriptSource, confidence:candidate.transcriptConfidence}),
      boundaryConfidence: candidate.boundaryConfidence || 'low',
      requiresReview: Boolean(candidate.requiresReview),
      technicalBoundaryReasons: candidate.technicalBoundaryReasons || [],
      reviewReasons: Array.isArray(candidate.reviewReasons)
        ? candidate.reviewReasons
            .map((reason) => safeLabel(reason))
            .filter(Boolean)
        : [],
      sceneBoundaryAligned: Boolean(candidate.sceneBoundaryAligned),
      rawStartSeconds: candidate.rawStartSeconds ?? null,
      rawEndSeconds: candidate.rawEndSeconds ?? null,
      integerSecondAligned: Boolean(candidate.integerSecondAligned),
      nativeFrameRate: Number(candidate.nativeFrameRate) || 30,
      startFrame: Number(candidate.startFrame) || 0,
      endFrame: Number(candidate.endFrame) || 0,
      integerBoundaryTrusted: Boolean(candidate.integerBoundaryTrusted),
      manualEditedAt: null,
      sceneDescription: candidate.sceneDescription || '',
      sceneText: candidate.sceneText || '',
      cameraAngle: candidate.cameraAngle || '',
      shotSize: candidate.shotSize || '',
      cameraMovement: candidate.cameraMovement || '',
    }));

  const preserveManualSegments = (previousSegments, generatedSegments) => {
    const manualSegments = (
      Array.isArray(previousSegments) ? previousSegments : []
    ).filter(
      (segment) =>
        segment.transcriptSource === 'manual' ||
        segment.manualEditedAt ||
        (!segment.transcriptSource &&
          !/^口播段\s*\d+$/u.test(String(segment.label || '').trim())),
    );
    const result = [...generatedSegments];
    const usedIndexes = new Set();
    for (const manual of manualSegments) {
      let bestIndex = -1;
      let bestOverlap = 0;
      for (let index = 0; index < result.length; index += 1) {
        if (usedIndexes.has(index)) continue;
        const overlap = overlapSeconds(manual, result[index]);
        if (overlap > bestOverlap) {
          bestOverlap = overlap;
          bestIndex = index;
        }
      }
      const manualDuration = Math.max(
        0.01,
        manual.endSeconds - manual.startSeconds,
      );
      if (bestIndex >= 0 && bestOverlap / manualDuration >= 0.35) {
        result[bestIndex] = {
          ...manual,
          transcriptSource: 'manual',
          manualEditedAt: manual.manualEditedAt || nowIso(),
        };
        usedIndexes.add(bestIndex);
      } else {
        result.push({
          ...manual,
          transcriptSource: 'manual',
          manualEditedAt: manual.manualEditedAt || nowIso(),
        });
      }
    }
    return result
      .sort((left, right) => left.startSeconds - right.startSeconds)
      .map((segment, index) => ({ ...segment, index: index + 1 }));
  };

  const versionContextFor = async source => {
    const actualSourceSha256 = await hashFile(path.join(sourcesDir,source.storedName));
    const result = await sourceVersionResolver({source:structuredClone(source),actualSourceSha256});
    if (!result?.ready || !result.skuContext) throw Object.assign(new Error(
      `此原片尚无可核验的版本或历史来源依据（${result?.reason || 'source_unavailable'}）；保留素材，不猜版本或产品编码。`),
      {code:'SOURCE_VERSION_EVIDENCE_MISSING'});
    return result;
  };

  const legacyDurationForAutomation = async (source,version,{trustedJobId,runId,assertCurrent=async()=>true}={}) => {
    if(version.skuContext.mode!==LEGACY_MODE||!trustedJobId)return null;
    const library=await readLibrary(),job=library.autoJobs.find(item=>item.id===trustedJobId),run=job?.runs.find(item=>item.id===runId);
    const target=run?.targetDurationSeconds,expectedSource=JSON.stringify(source);
    const current=async()=>{
      if(!(await assertCurrent()))return false;
      const latest=await readLibrary(),live=latest.autoJobs.find(item=>item.id===trustedJobId),liveRun=live?.runs.find(item=>item.id===runId);
      return Boolean(live?.status==='active'&&!live.archivedAt&&ownerCanUseAutomation(latest,live)
        &&liveRun?.targetDurationSeconds===target&&JSON.stringify(getSource(latest,source.id))===expectedSource);
    };
    if(!(await current()))throw Object.assign(new Error('任务已暂停、目标或来源变化，未探测单原片时长。'),{code:'SOURCE_DURATION_INPUT_CHANGED'});
    const state=job.sourceDurationFeasibility;
    if(state&&(state.version!==LEGACY_DURATION_POLICY||!Array.isArray(state.records)||state.records.length>10000))
      throw Object.assign(new Error('原单原片时长记录不完整，未清空记录或继续付费审核。'),{code:'SOURCE_DURATION_EVIDENCE_UNAVAILABLE'});
    const cached=state?.records.find(item=>item.sourceId===source.id&&item.sourceSha256===version.skuContext.sourceScope.sourceSha256&&item.targetDurationSeconds===target);
    const result=await probeLegacySourceDuration({source,sourceScope:version.skuContext.sourceScope,bindingSha256:version.skuContext.bindingSha256,
      targetDurationSeconds:target,cached,inspectSource:()=>inspectMedia(path.join(sourcesDir,source.storedName)),
      hashSource:()=>hashFile(path.join(sourcesDir,source.storedName)),assertCurrent:current});
    const liveVersion=await versionContextFor(source);
    if(liveVersion.registrySha256!==version.registrySha256||liveVersion.skuContext.bindingSha256!==version.skuContext.bindingSha256||!(await current()))
      throw Object.assign(new Error('时长核验期间私有来源依据或任务变化，未登记结构结论。'),{code:'SOURCE_DURATION_INPUT_CHANGED'});
    const {cacheReused,...record}=result;
    await updateLibrary(latest=>{
      const live=latest.autoJobs.find(item=>item.id===trustedJobId),liveRun=live?.runs.find(item=>item.id===runId);
      if(!live||live.status!=='active'||live.archivedAt||!ownerCanUseAutomation(latest,live)||liveRun?.targetDurationSeconds!==target
        ||JSON.stringify(getSource(latest,source.id))!==expectedSource)
        throw Object.assign(new Error('保存时长依据前任务或原片变化，未登记结构结论。'),{code:'SOURCE_DURATION_INPUT_CHANGED'});
      const previous=live.sourceDurationFeasibility;
      if(previous&&(previous.version!==LEGACY_DURATION_POLICY||!Array.isArray(previous.records)||previous.records.length>10000))
        throw Object.assign(new Error('时长记录发生变化，未覆盖。'),{code:'SOURCE_DURATION_EVIDENCE_UNAVAILABLE'});
      const records=previous?.records||[],index=records.findIndex(item=>item.key===record.key);
      if(index>=0&&JSON.stringify(records[index])===JSON.stringify(record))return unchangedLibrary(null);
      if(index<0&&records.length>=10000)throw Object.assign(new Error('时长记录已达有限容量，未清空旧记录。'),{code:'SOURCE_DURATION_EVIDENCE_UNAVAILABLE'});
      live.sourceDurationFeasibility={version:LEGACY_DURATION_POLICY,records:index<0?[...records,record]:records.map((item,i)=>i===index?record:item)};
      live.updatedAt=nowIso();
    });
    return result;
  };

  const verifySourceSegmentProof = async (source,segment,assertActive=async()=>true,trustedJobId) => {
    if(!sourceReviewScopeAllows(segment?.semanticReviewProof,trustedJobId))return false;
    if (!sourceVersionManaged(source)) return true;
    try {
      const version = await versionContextFor(source);
      const snapshot = JSON.stringify(source);
      const assertCurrent = async () => {
        if (!(await assertActive()) || JSON.stringify(getSource(await readLibrary(),source.id))!==snapshot) return false;
        const latestVersion=await versionContextFor(source);
        return latestVersion.skuContext.bindingSha256===version.skuContext.bindingSha256 &&
          latestVersion.registrySha256===version.registrySha256;
      };
      const valid=await sourceReviewer.verifyStoredProof({proof:segment?.semanticReviewProof,
        source:{...source,filePath:path.join(sourcesDir,source.storedName)},segment,
        skuContext:version.skuContext,assertCurrent,trustedJobId});
      if (valid) currentSourceContexts.set(source.id,version.skuContext);
      return valid;
    } catch {return false;}
  };

  const assertCurrentVersionedClips = async (clips,library,assertActive=async()=>true,trustedJobId) => {
    if(clips.some(clip=>!clipSourceReviewScopeAllows(clip,getSource(library,clip?.sourceId),trustedJobId)))
      throw Object.assign(new Error('该来源审核策略仅属于原测试任务，不能跨任务或人工入口复用。'),{code:'SOURCE_REVIEW_SCOPE_MISMATCH',statusCode:409});
    if (typeof sourceVersionResolver!=='function' || !clips.some(clip=>sourceVersionManaged(getSource(library,clip?.sourceId)))) return null;
    const frozen = compositionFingerprint(clips,library.sources);
    return assertVersionedComposition({clips,sources:library.sources,resolveSource:versionContextFor,
      verifySegment:(source,segment,assertCurrent)=>verifySourceSegmentProof(source,segment,assertCurrent,trustedJobId),hashClip:clip=>hashFile(path.join(clipsDir,clip.storedName)),
      assertCurrent:async()=>{
        if (!(await assertActive())) return false;
        const latest=await readLibrary(),current=clips.map(clip=>getClip(latest,clip.id));
        return current.every(Boolean) && compositionFingerprint(current,latest.sources)===frozen;
      }});
  };

  const assertVariantVersionedSources = async (render,variant,library) => {
    // Read current state at every external-effect boundary. This discriminator
    // preserves the production protocol for truly unmarked historical output;
    // it never approves output or bypasses the caller's original gates.
    const currentLibrary=await readLibrary();
    const policyRender=currentLibrary.renders.find(item=>item.id===render.id);
    const policyVariant=policyRender?.variants.find(item=>item.id===variant.id);
    if (!policyVariant || policyVariant.contentSha256!==variant.contentSha256)
      throw Object.assign(new Error('成片记录或文件版本已变化，未继续回传或投放。'),{code:'SOURCE_EVIDENCE_MISSING',statusCode:409});
    if (policyVariant.reviewMode === BASIC_REVIEW_MODE) {
      const job=currentLibrary.autoJobs.find(item=>item.id===policyRender.automation?.jobId);
      const state=bindingState(policyRender,policyVariant,currentLibrary);
      if (![BASIC_REVIEW_POLICY,HISTORICAL_OUTPUT_RULES_POLICY,SOURCE_EVIDENCE_POLICY].includes(policyRender.sourceEvidencePolicy)
        || !basicVariantPassed(policyVariant) || state.reason || !canPerformAutomaticEffects(currentLibrary,job,policyRender)
        || state.clips.some(clip=>!canReadClip(clip,getSource(currentLibrary,clip.sourceId),{id:job.createdById})||clipIsBlocked(clip)))
        throw Object.assign(new Error('当前任务权限、来源文件或基础审核状态已变化，未外发。'),{statusCode:409});
      if (await hashFile(path.join(outputsDir,policyVariant.storedName))!==policyVariant.contentSha256)
        throw Object.assign(new Error('成片文件版本已变化，等待自动重新生成。'),{statusCode:409});
      await verifyBasicInputFiles(policyRender,policyVariant,currentLibrary);
      return {mode:BASIC_REVIEW_POLICY,skuVersion:policyVariant.skuVersion||null};
    }
    const policy=outputSourcePolicy(policyRender,policyVariant,currentLibrary);
    const policyClips=[...new Set([...(policyVariant.clipSequence||[]),...Object.values(policyVariant.slotMapping||{})])].map(id=>getClip(currentLibrary,id));
    if(policyClips.some(clip=>!clipSourceReviewScopeAllows(clip,getSource(currentLibrary,clip?.sourceId),policyRender.automation?.jobId)))
      throw Object.assign(new Error('当前成片不属于来源审核策略授权的测试任务，未回传或投放。'),{code:'SOURCE_REVIEW_SCOPE_MISMATCH',statusCode:409});
    if (policy.mode==='original') return null;
    if(policy.mode==='historical_inventory'){
      assertCurrentAutomaticReview(policyRender,policyVariant,currentLibrary);
      const context={...policyRender.automation,createdById:policyRender.createdById,autoApproveOutputs:true};
      const existingOutputContext=createExistingCompanyPassContext({library:currentLibrary,renderId:policyRender.id,variantId:policyVariant.id});
      const input=await verifyHistoricalInputs(policy.clips,currentLibrary,context,policyVariant.historicalInventoryReview.input,existingOutputContext);
      if(await hashFile(path.join(outputsDir,policyVariant.storedName))!==policyVariant.contentSha256
        ||!(await automationContextAllowed(context)))throw Object.assign(new Error('已审新成片字节或任务权限变化，未外发。'),{statusCode:409});
      const finalLibrary=await readLibrary(),finalRender=finalLibrary.renders.find(item=>item.id===render.id),finalVariant=finalRender?.variants.find(item=>item.id===variant.id);
      const finalJob=finalLibrary.autoJobs.find(item=>item.id===finalRender?.automation?.jobId);
      if(existingOutputContext&&!existingCompanyPassContextCurrent(existingOutputContext,finalLibrary)
        ||!historicalRulesOutputContract(finalRender,finalVariant,finalLibrary)||!canPerformAutomaticEffects(finalLibrary,finalJob,finalRender))
        throw Object.assign(new Error('外发前成片审核或任务权限发生变化，未继续。'),{statusCode:409});
      assertCurrentAutomaticReview(finalRender,finalVariant,finalLibrary);
      return {mode:HISTORICAL_INVENTORY_MODE,input,skuVersion:null};
    }
    if (typeof sourceVersionResolver!=='function')
      throw Object.assign(new Error('成片要求的私有来源审核服务尚未配置，未继续回传或投放。'),{code:'SOURCE_EVIDENCE_MISSING',statusCode:409});
    const assertActive=async()=>{
      const latest=await readLibrary(),currentRender=latest.renders.find(item=>item.id===render.id);
      const currentVariant=currentRender?.variants.find(item=>item.id===variant.id);
      const job=latest.autoJobs.find(item=>item.id===currentRender?.automation?.jobId);
      if(!currentVariant || currentVariant.reviewStatus!=='approved' || hasPlatformQuarantine(currentVariant) ||
        currentVariant.contentSha256!==variant.contentSha256 || !canPerformAutomaticEffects(latest,job,currentRender)) return false;
      try {
        const currentPolicy=outputSourcePolicy(currentRender,currentVariant,latest);
        if (currentPolicy.mode!=='strict' || currentPolicy.markerState!==policy.markerState) return false;
        assertCurrentAutomaticReview(currentRender,currentVariant,latest);return true;
      } catch {return false;}
    };
    return assertCurrentVersionedClips(policy.clips,currentLibrary,assertActive,policyRender.automation?.jobId);
  };

  const onDemandSourceShortfall = (library,job,run) => {
    const stats=automaticOutputStats(automationRendersForRun(library,job.id,run.id));
    const remaining=Math.max(0,Number(run.targetCount)-stats.approvedCount);
    if(!remaining)return false;
    const used=new Set(stats.variants.filter(variant=>variant.reviewStatus==='approved'||replacementEligible(variant))
      .map(variant=>variant.clipSequence?.[0]).filter(Boolean));
    const readiness=job.autoApproveOutputs===true
      ?buildReviewedReadiness(library,job,run.targetDurationSeconds,used)
      :buildAutoReadiness(library,job.frameworkId,job.productCategory,remaining,run.targetDurationSeconds,job.id);
    const openers=(readiness.slotSelections?.[readiness.openingSlotId]||[]).filter(id=>!used.has(id)).length;
    return !readiness.canProduce||openers<remaining||Boolean(run.sourceDurationGap);
  };

  const verifyTechnicalSourceTerminal = async (source,version,assertCurrent) => {
    if(version.skuContext.mode!==LEGACY_MODE||typeof localAsrRunner?.verifyTerminalInsufficientRecognition!=='function')return {verified:false};
    return localAsrRunner.verifyTerminalInsufficientRecognition({sourceId:source.id,productCategory:source.productCategory,
      skuVersion:null,sourceScope:version.skuContext.sourceScope,sourcePath:path.join(sourcesDir,source.storedName),
      sourceSha256:version.sourceSnapshot.contentSha256,assertSourceCurrent:async()=>{
        if(!(await assertCurrent()))return false;
        const currentVersion=await versionContextFor(source);
        return currentVersion.registrySha256===version.registrySha256&&await assertCurrent();
      }});
  };

  const completedMaterializationFor = (jobId,runId,sourceId) => {
    const stateFor=library=>{
      const job=library.autoJobs.find(item=>item.id===jobId),run=job?.runs.find(item=>item.id===runId),source=getSource(library,sourceId);
      return {library,job,run,source,authorized:Boolean(job&&ownerCanUseAutomation(library,job)&&source?.visibility!=='private'
        &&canReadSource(source,accessIdentity({sub:job.createdById,name:job.createdByName})))};
    };
    return inspectCompletedSourceMaterialization({sourceId,readState:async()=>stateFor(await readLibrary()),
      readCatalog:()=>typeof sourceVersionResolver?.availableCandidateSourceIds==='function'
        ?sourceVersionResolver.availableCandidateSourceIds({trustedJobId:jobId}):sourceVersionResolver.candidateSourceIds(),
      isTrustedSegment:trustedSourceBoundary,calibrateSegments:source=>calibrateSourceSegments(source,jobId),
      verifySegment:(source,segment,assertCurrent)=>verifySourceSegmentProof(source,segment,assertCurrent,jobId),
      clipBytesReusable:async(clip,segment,assertCurrent)=>(await assessAsrClipReuse({clip,segment,
        hashClip:item=>hashFile(path.join(clipsDir,item.storedName))})).reusable&&await assertCurrent(),
      approvedClipCurrent:async(clip,source,segment,assertCurrent)=>currentClipEvidencePointer(clip,source,jobId)
        &&JSON.stringify(clip.semanticReviewProof)===JSON.stringify(segment.semanticReviewProof)&&await assertCurrent(),
    }).then(result=>{
      if(!result?.guardForSegment)return result;
      const guard=result.guardForSegment;
      result.guardForSegment=id=>{const value=guard(id);return {...value,materializationOnly:true,
        isActiveInLibrary:library=>value.isStateCurrent(stateFor(library))};};
      result.isActiveInLibrary=library=>result.isStateCurrent(stateFor(library));
      return result;
    });
  };

  const ensureProgressiveSourceBatch = async (jobId,runId) => {
    if(!progressiveSourceJobIds.has(jobId))return;
    const library=await readLibrary(),job=library.autoJobs.find(item=>item.id===jobId),run=job?.runs.find(item=>item.id===runId);
    if(!job||!run||job.status!=='active'||job.archivedAt||!ownerCanUseAutomation(library,job))
      throw Object.assign(new Error('任务已暂停或权限变化，未递进历史来源。'),{code:'AUTOMATION_STOPPED'});
    const stats=automaticOutputStats(automationRendersForRun(library,jobId,runId));
    // A crash can happen after saving the final approved variant and before
    // marking this run complete. No new source work is needed to finish the
    // original run; its normal review/return/delivery gates still apply below.
    if(Number(run.targetCount)>0&&stats.approvedCount>=Number(run.targetCount))return {runAlreadyComplete:true};
    if(job.productCategory!=='黑晶面膜'||typeof sourceVersionResolver?.availableCandidateSourceIds!=='function')
      throw Object.assign(new Error('本任务的有限历史来源服务不可用，未改走云端新来源。'),{code:'PROGRESSIVE_SOURCE_CHANGED'});
    assertNoPendingSequence(library,jobId,runId);
    const catalog=await sourceVersionResolver.availableCandidateSourceIds({trustedJobId:job.id}),ids=new Set(catalog.sourceIds);
    const identity=accessIdentity({sub:job.createdById,name:job.createdByName}),target=Number(run.targetDurationSeconds)||90;
    const eligible=library.sources.filter(source=>ids.has(source.id)&&sourceVersionManaged(source)&&source.visibility!=='private'&&canReadSource(source,identity))
      .sort((a,b)=>{const left=Number(a.durationSeconds)||0,right=Number(b.durationSeconds)||0;
        return Number(right>=target)-Number(left>=target)||(left>=target&&right>=target?left-right:right-left)||String(a.id).localeCompare(String(b.id));});
    if(stats.approvedCount<run.targetCount&&stats.attemptedCount>=run.targetCount*AUTO_REMIX_MAX_OUTPUT_ATTEMPT_MULTIPLIER)
      throw Object.assign(new Error('原批次生成尝试已达原有上限，未通过换来源或重置窗口增加尝试。'),{code:'PROGRESSIVE_RUN_ATTEMPT_LIMIT'});
    const used=new Set(stats.variants.filter(v=>v.reviewStatus==='approved'||replacementEligible(v)).map(v=>v.clipSequence?.[0]).filter(Boolean));
    const ready=buildReviewedReadiness(library,job,target,used),fingerprint=slotSelectionFingerprint(ready.slotSelections);
    const hasUsablePool=ready.canProduce&&(ready.slotSelections?.[ready.openingSlotId]||[]).some(id=>!used.has(id))
      &&!run.sourceDurationGap&&run.sourceSequenceExhausted?.poolFingerprint!==fingerprint;
    const planningFingerprint=state=>{
      const currentJob=structuredClone(state.autoJobs.find(item=>item.id===jobId));
      if(currentJob){delete currentJob.sourceDurationFeasibility;delete currentJob.updatedAt;}
      return JSON.stringify({job:currentJob,sources:eligible.map(source=>getSource(state,source.id)),
        ...(jobId===R9_ADDITIVE_JOB_ID?{clips:state.clips.filter(clip=>eligible.some(source=>source.id===clip.sourceId))}:{}),
        renders:state.renders.filter(render=>render.automation?.jobId===jobId)});
    };
    const frozenPlanning=planningFingerprint(library);
    const assertPlanningCurrent=async()=>{
      const latest=await readLibrary(),live=latest.autoJobs.find(item=>item.id===jobId);
      if(live?.status!=='active'||live.archivedAt||!ownerCanUseAutomation(latest,live))
        throw Object.assign(new Error('任务已暂停或权限变化，未递进历史来源。'),{code:'AUTOMATION_STOPPED'});
      if(planningFingerprint(latest)!==frozenPlanning)
        throw Object.assign(new Error('有限选源期间目标、原批次或素材发生变化，未提交过期计划。'),{code:'PROGRESSIVE_SOURCE_CHANGED'});
      return true;
    };
    await assertPlanningCurrent();
    // A terminal batch may advance only after its CURRENT private resolver and
    // original bytes still agree. This is at most three reads, never inference
    // or eager validation of the whole passive inventory.
    const verifiedTechnicalTerminalSourceIds=[];
    const pendingMaterializationSourceIds=[];
    const settledMaterializationSourceIds=[];
    const terminalCandidates=[];
    if(!hasUsablePool){
      const previousBatch=job.progressiveSourcePreparation?.batches?.at(-1)?.sourceIds
        ||run.onDemandSourcePreparation?.sourceIds||[];
      for(const sourceId of previousBatch.slice(0,3)){
        const source=getSource(library,sourceId);
        if(!source)throw Object.assign(new Error('本批原片缺失，未递进其他来源。'),{code:'PROGRESSIVE_SOURCE_CHANGED'});
        let version;
        try{version=await versionContextFor(source);}catch(error){throw Object.assign(new Error('本批原片或私有来源依据变化，未扩大来源：'+error.message),{code:'PROGRESSIVE_SOURCE_CHANGED'});}
        await assertPlanningCurrent();
        const prior=(job.runs||[]).map(item=>item.versionPreparationAttempts?.[sourceId]).filter(Boolean)
          .sort((a,b)=>(Date.parse(b.attemptedAt)||0)-(Date.parse(a.attemptedAt)||0))[0];
        const materialization=await completedMaterializationFor(jobId,runId,sourceId);
        await assertPlanningCurrent();
        if(materialization&&materialization.status!=='settled')pendingMaterializationSourceIds.push(sourceId);
        if(materialization?.status==='settled')settledMaterializationSourceIds.push(sourceId);
        if(prior?.reason==='SOURCE_ASR_UNAVAILABLE'&&!source.sourceSemanticReview){
          const terminal=await verifyTechnicalSourceTerminal(source,version,assertPlanningCurrent);
          await assertPlanningCurrent();
          if(terminal.verified){verifiedTechnicalTerminalSourceIds.push(sourceId);terminalCandidates.push({source,version,terminal});}
        }
      }
    }
    const structurallyIncompatibleSourceIds=new Set();
    const checkedDurationSources=new Set();
    const verifiedAdditionalSourceIds=[];
    const newCatalogSourceIds=job.progressiveSourcePreparation
      ?eligible.filter(source=>!job.progressiveSourcePreparation.catalog?.some(row=>row.sourceId===source.id)).map(source=>source.id).slice(0,3):[];
    const checkDuration=async sourceId=>{
      if(checkedDurationSources.has(sourceId))return;
      const source=structuredClone(getSource(await readLibrary(),sourceId));
      const version=await versionContextFor(source);
      const duration=await legacyDurationForAutomation(source,version,{trustedJobId:jobId,runId,assertCurrent:assertPlanningCurrent});
      await assertPlanningCurrent();
      if(duration?.status==='structural_incompatible')structurallyIncompatibleSourceIds.add(sourceId);
      checkedDurationSources.add(sourceId);
    };
    if(!hasUsablePool){
      const previousBatch=job.progressiveSourcePreparation?.batches?.at(-1)?.sourceIds||run.onDemandSourcePreparation?.sourceIds||[];
      for(const id of previousBatch)await checkDuration(id);
      // Plan without persisting selection. Structurally impossible sources do
      // not occupy the twenty-source preparation ledger or buy model calls.
      for(let scanned=0;scanned<=eligible.length;scanned++){
        const currentLibrary=await readLibrary(),currentJob=currentLibrary.autoJobs.find(item=>item.id===jobId),currentRun=currentJob?.runs.find(item=>item.id===runId);
        let next;
        try{next=planProgressiveSourceBatch({library:currentLibrary,job:currentJob,run:currentRun,catalog,
          eligibleSourceIds:eligible.map(source=>source.id),hasUsablePool:false,at:nowIso(),structurallyIncompatibleSourceIds:[...structurallyIncompatibleSourceIds],verifiedAdditionalSourceIds,verifiedTechnicalTerminalSourceIds,pendingMaterializationSourceIds});}
        catch(error){
          if(!['PROGRESSIVE_SOURCE_EXHAUSTED','PROGRESSIVE_SOURCE_DURATION_EXHAUSTED'].includes(error.code)
            ||verifiedAdditionalSourceIds.length||!newCatalogSourceIds.length)throw error;
          for(const id of newCatalogSourceIds){await checkDuration(id);verifiedAdditionalSourceIds.push(id);}
          continue;
        }
        if(next.action!=='selected')break;
        const excludedBefore=structurallyIncompatibleSourceIds.size;
        for(const id of next.sourceIds)await checkDuration(id);
        if(structurallyIncompatibleSourceIds.size===excludedBefore)break;
      }
    }
    for(const {source,version,terminal} of terminalCandidates){
      const fresh=await verifyTechnicalSourceTerminal(source,version,assertPlanningCurrent);
      if(!fresh.verified||fresh.operationKey!==terminal.operationKey||fresh.receiptSha256!==terminal.receiptSha256)
        throw Object.assign(new Error('原片技术终态依据已变化，保留原失败，未推进其他来源。'),{code:'PROGRESSIVE_SOURCE_CHANGED'});
    }
    // A public complete flag never closes the private-receipt window between
    // initial planning, duration probes and committing the next source batch.
    for(const sourceId of settledMaterializationSourceIds){
      if((await completedMaterializationFor(jobId,runId,sourceId))?.status!=='settled')
        throw Object.assign(new Error('换源登记前原批次私有回执或物化状态变化，未轮转来源。'),{code:'SOURCE_MATERIALIZATION_PENDING'});
      await assertPlanningCurrent();
    }
    await assertPlanningCurrent();
    const beforeCommit=await readLibrary(),beforeCommitJob=beforeCommit.autoJobs.find(item=>item.id===jobId);
    const snapshot=JSON.stringify({job:beforeCommitJob,sources:eligible.map(source=>getSource(beforeCommit,source.id))});
    await updateLibrary(latest=>{
      const currentJob=latest.autoJobs.find(item=>item.id===jobId),currentRun=currentJob?.runs.find(item=>item.id===runId);
      if(!currentRun||currentJob.status!=='active'||currentJob.archivedAt||!ownerCanUseAutomation(latest,currentJob))
        throw Object.assign(new Error('任务已暂停或权限变化，未登记新的来源。'),{code:'AUTOMATION_STOPPED'});
      if(planningFingerprint(latest)!==frozenPlanning)
        throw Object.assign(new Error('选源登记前原任务或素材变化，未提交过期计划。'),{code:'PROGRESSIVE_SOURCE_CHANGED'});
      if(JSON.stringify({job:currentJob,sources:eligible.map(source=>getSource(latest,source.id))})!==snapshot)
        throw Object.assign(new Error('有限选源期间任务或素材发生变化，保留原批次。'),{code:'PROGRESSIVE_SOURCE_CHANGED'});
      const next=planProgressiveSourceBatch({library:latest,job:currentJob,run:currentRun,catalog,
        eligibleSourceIds:eligible.map(source=>source.id),hasUsablePool,at:nowIso(),structurallyIncompatibleSourceIds:[...structurallyIncompatibleSourceIds],verifiedAdditionalSourceIds,verifiedTechnicalTerminalSourceIds,pendingMaterializationSourceIds});
      currentJob.progressiveSourcePreparation=next.state;
      currentRun.progressiveSourcePreparation=true;
      currentRun.onDemandSourcePreparation={mode:'bounded-on-demand-v1',limit:3,sourceIds:next.sourceIds,
        selectedAt:next.state.batches.at(-1)?.selectedAt||nowIso()};
      currentRun.versionPreparationAttempts={...next.attempts,...currentRun.versionPreparationAttempts};
      currentRun.progressiveSourceStatus={action:next.action,reason:next.reason,totalSources:next.state.sourceIds.length,
        sourceLimit:20,batchLimit:3,attemptedTotal:next.state.attemptedFloor,outputAttemptLimit:80,checkedAt:nowIso()};
      if(next.action==='selected'){
        currentRun.selectedSourceIds=[];currentRun.selectedAssetIds=[];
        const fresh=freshAutomationStageReports();currentRun.stageReports=normalizedAutomationStageReports(currentRun.stageReports)
          .map(report=>['source_selection','source_slicing','clip_calibration','clip_review'].includes(report.key)
            ?fresh.find(item=>item.key===report.key):report);
      }
    });
    return {materializationPending:pendingMaterializationSourceIds.length>0};
  };

  const versionBackfillCandidates = async (library,job,run) => {
    if(job.productCategory!=='黑晶面膜' || typeof sourceVersionResolver?.candidateSourceIds!=='function') return [];
    const plan=run.onDemandSourcePreparation, onDemand=plan?.mode==='bounded-on-demand-v1';
    if(onDemand&&(job.status!=='active'||job.archivedAt||!ownerCanUseAutomation(library,job)||!onDemandSourceShortfall(library,job,run)))return [];
    const catalog=onDemand&&typeof sourceVersionResolver.availableCandidateSourceIds==='function'
      ?await sourceVersionResolver.availableCandidateSourceIds({trustedJobId:job.id}):await sourceVersionResolver.candidateSourceIds();
    const ids=new Set(catalog.sourceIds),identity=accessIdentity({sub:job.createdById,name:job.createdByName});
    let sources=library.sources.filter(source=>ids.has(source.id) && sourceVersionManaged(source) && source.visibility!=='private' && canReadSource(source,identity));
    if(onDemand){
      const fixed=Array.isArray(plan.sourceIds)?new Set(plan.sourceIds):null;
      const target=Number(run.targetDurationSeconds)||Number(job.targetDurationSeconds)||90;
      sources=fixed?sources.filter(source=>fixed.has(source.id)):sources.sort((a,b)=>{
        const left=Number(a.durationSeconds)||0,right=Number(b.durationSeconds)||0;
        // Prefer a whole original long enough for the target, without selecting
        // an unnecessarily huge recording merely because it is the longest.
        return Number(right>=target)-Number(left>=target)||
          (left>=target&&right>=target?left-right:right-left)||String(a.id).localeCompare(String(b.id));
      }).slice(0,normalizedSourceSelectionLimit(plan.limit));
    }
    return sources
      .map(source=>({sourceId:source.id,key:catalog.bindingKeysBySourceId?.[source.id]||catalog.registrySha256,
        previous:run.versionPreparationAttempts?.[source.id]}))
      // Completed fixed sources of this exact recovery job are cache-only,
      // including when their binding changes. Never fall into paid preparation.
      .filter(item=>!(job.id===R9_ADDITIVE_JOB_ID&&onDemand&&Array.isArray(plan.sourceIds)&&item.previous?.complete===true))
      .filter(item=>item.previous?.key!==item.key || (!item.previous.complete &&
        Date.now()-Date.parse(item.previous.attemptedAt)>=sourcePreparationDelay(item.previous.attempts-1)))
      .sort((a,b)=>(Date.parse(a.previous?.attemptedAt)||0)-(Date.parse(b.previous?.attemptedAt)||0))
      .slice(0,normalizedSourceSelectionLimit(onDemand?plan.limit:job.sourceSelectionLimit));
  };

  // The automatic job and the continuous supplier share this exact entrypoint.
  // Cached ASR still proceeds to content review; user pauses and source edits
  // are checked before effects and again before saving any passed segment.
  const prepareSourceForAutomation = async (sourceId,{accessContext,runId,trustedJobId,assertActive=async()=>true,isActiveInLibrary=()=>true}={}) => {
    let source=structuredClone(getSource(await readLibrary(),sourceId));
    if (!sourceVersionManaged(source)) return source;
    const identity=accessIdentity(accessContext);
    let expected=JSON.stringify(source);
    const assertCurrent=async()=>{if(!(await assertActive()))return false;const latest=await readLibrary();return isActiveInLibrary(latest) &&
      canReadSource(getSource(latest,sourceId),identity) && JSON.stringify(getSource(latest,sourceId))===expected;};
    if (!(await assertCurrent())) throw Error('任务已暂停、权限已变化或来源不可读，未继续自动准备。');
    let version=await versionContextFor(source);
    const duration=await legacyDurationForAutomation(source,version,{trustedJobId,runId,assertCurrent});
    if(duration?.status==='structural_incompatible')throw incompatibleDurationError(duration);
    let asrInput=typeof trustedAsrResolver==='function'
      ? await trustedAsrResolver({sourceId,productCategory:source.productCategory}):null;
    const legacy=version.skuContext.mode===LEGACY_MODE;
    if (!asrInput || asrInput.source?.sha256!==version.sourceSnapshot.contentSha256 || asrInput.source?.skuVersion!==version.skuContext.skuVersion
      || (legacy && JSON.stringify(asrInput.source?.sourceScope)!==JSON.stringify(version.skuContext.sourceScope))) {
      if (!localAsrRunner) throw Object.assign(new Error('真实语音识别后台尚未配置，保留原片与当前任务。'),{code:'SOURCE_ASR_UNAVAILABLE'});
      const result=await localAsrRunner.ensureSourceEvidence({sourceId,productCategory:source.productCategory,
        skuVersion:version.skuContext.skuVersion,...(legacy?{sourceScope:version.skuContext.sourceScope}:{skuBindingRevision:version.skuContext.bindingSha256}),
        sourcePath:path.join(sourcesDir,source.storedName),sourceSha256:version.sourceSnapshot.contentSha256,
        assertSourceCurrent:async()=>{
          if (!(await assertCurrent())) return false;
          const latest=await versionContextFor(source);
          return latest.registrySha256===version.registrySha256 && await assertCurrent();
        }});
      if (result?.status!=='completed' || !result.evidence){
        const terminal=result?.status==='failed'?await verifyTechnicalSourceTerminal(source,version,assertCurrent):{verified:false};
        if(terminal.verified)throw Object.assign(new Error('原片识别已明确结束，但没有可用句界（0段/0词）；技术不适配，原失败保留，不批准内容、不重复识别。'),
          {code:'SOURCE_ASR_INSUFFICIENT_RECOGNITION',technicalDisposition:terminal});
        throw Object.assign(new Error(`原片真实语音识别尚未完成（${result?.reason || result?.status || 'unavailable'}），保留原任务，不伪造识别或重复请求。`),{code:'SOURCE_ASR_UNAVAILABLE'});
      }
      asrInput=result.evidence;
    }
    if (!(await assertCurrent())) throw Error('原片核验期间任务或素材已变化，未导入识别。');
    await analyzeSource(sourceId,{verifiedAsrInput:asrInput});
    source=structuredClone(getSource(await readLibrary(),sourceId)); expected=JSON.stringify(source);
    version=await versionContextFor(source);
    const segments=source.speechSegments.filter(segment=>trustedSourceBoundary(segment,source)&&!segment.technicalBoundaryReasons?.length);
    if (!segments.length) throw Object.assign(new Error('原片尚无完整、有效的真实句界，保留原音轨与识别记录。'),{code:'SOURCE_BOUNDARY_UNAVAILABLE'});
    const assertReviewCurrent=async()=>{
      if (!(await assertCurrent())) return false;
      const latest=await versionContextFor(source);
      return latest.registrySha256===version.registrySha256 && await assertCurrent();
    };
    const reviewed=await sourceReviewer.assess({runId:runId||`source-${source.id}-${version.skuContext.bindingSha256}`,trustedJobId,
      source:{...source,filePath:path.join(sourcesDir,source.storedName)},segments,skuContext:version.skuContext,assertCurrent:assertReviewCurrent});
    const passed=new Map();
    for(const result of reviewed.results||[]) {
      const segment=segments.find(item=>item.index===result.segmentIndex);
      if(result.status==='passed' && segment && await sourceReviewer.verifyStoredProof({proof:result.proof,
        source:{...source,filePath:path.join(sourcesDir,source.storedName)},segment,skuContext:version.skuContext,assertCurrent:assertReviewCurrent,trustedJobId}))
        passed.set(segment.index,result.proof);
    }
    if (!(await assertReviewCurrent())) throw Error('来源审核期间任务、商品资料或原片已变化，未保存批准。');
    const saved=await updateLibrary(latest=>{
      const current=getSource(latest,sourceId);
      if (!current || JSON.stringify(current)!==expected || !canReadSource(current,identity) || !isActiveInLibrary(latest))
        throw Error('来源审核保存前素材已变化，保留旧记录。');
      if(version.skuContext.mode===LEGACY_MODE) current.legacySourceEvidence={mode:LEGACY_MODE,
        sourceScope:structuredClone(version.skuContext.sourceScope),bindingSha256:version.skuContext.bindingSha256,
        profileSha256:version.skuContext.profileSha256};
      else {
        current.productVersionEvidence={...version.sourceSnapshot.productVersionEvidence,
          profileSha256:version.skuContext.profileSha256,referenceSetSha256:version.skuContext.referenceSetSha256};
        delete current.legacySourceEvidence;
      }
      current.speechSegments=current.speechSegments.map(segment=>{
        const proof=passed.get(segment.index);
        return {...segment,requiresReview:!proof,semanticReviewProof:proof||null,
          reviewReasons:proof?[]:segment.reviewReasons};
      });
      const pendingReasons=sourceReviewPendingReasons(reviewed);
      const reviewState={version:'20261003-v1',passedCount:passed.size,totalCount:current.speechSegments.length,
        status:passed.size===current.speechSegments.length?'passed':passed.size?'partial':'review_required',
        reason:reviewed.reason||null,pendingReasons,recoverable:sourceReviewCanRecover(pendingReasons),bindingSha256:version.skuContext.bindingSha256};
      const {reviewedAt:previousReviewedAt,...previousReviewState}=current.sourceSemanticReview||{};
      current.sourceSemanticReview={...reviewState,reviewedAt:previousReviewedAt && JSON.stringify(previousReviewState)===JSON.stringify(reviewState)
        ? previousReviewedAt : nowIso()};
      current.analysisMessage=`${version.skuContext.mode===LEGACY_MODE?'历史单原片（不猜版别）':version.skuContext.skuVersion}：原片${passed.size}/${current.speechSegments.length}段通过真实来源复核；其余保留待审，不影响同源合格段。`;
      return structuredClone(current);
    });
    currentSourceContexts.set(sourceId,version.skuContext);
    return saved;
  };

  const analyzeSource = (sourceId, options = {}) => {
    if (sourceAnalysisPromises.has(sourceId))
      return sourceAnalysisPromises.get(sourceId);
    const operation = analyzeSourceOnce(sourceId, options).finally(() =>
      sourceAnalysisPromises.delete(sourceId),
    );
    sourceAnalysisPromises.set(sourceId, operation);
    return operation;
  };

  const analyzeSourceOnce = async (sourceId, options = {}) => {
    const requestedAnalysisStartedAt = Number(options.analysisStartedAt);
    const analysisStartedAt =
      Number.isFinite(requestedAnalysisStartedAt) &&
      requestedAnalysisStartedAt > 0 &&
      requestedAnalysisStartedAt <= Date.now()
        ? requestedAnalysisStartedAt
        : Date.now();
    const sourceLibrary = await readLibrary();
    // Snapshot before any asynchronous read: the library cache is mutable.
    const source = structuredClone(getSource(sourceLibrary, sourceId));
    if (!source) throw new Error('未找到源视频，请刷新后重试。');

      // A resolver returns original authorized receipts + SRT + native PTS.
      // The service itself re-reads the original file and verifies all hashes.
      const asrInput = options.verifiedAsrInput || (typeof trustedAsrResolver === 'function'
        ? await trustedAsrResolver({sourceId: source.id, productCategory: source.productCategory}) : null);
      if (asrInput) {
        const bundle = verifyAsrBundle({...asrInput,
          sourceBytes: await fs.readFile(path.join(sourcesDir, source.storedName))});
        if (bundle.source.id !== source.id || bundle.source.productCategory !== source.productCategory || Math.abs(bundle.source.durationSeconds-source.durationSeconds) > 0.1)
          throw new Error('ASR来源或产品身份不一致，保留原记录并停止导入。');
        const evidence = {sourceSha256:bundle.source.sha256,srtSha256:bundle.srtSha256,frameMapSha256:bundle.frameMapSha256,...(bundle.providerEvidence||{minuteToken:bundle.minuteToken}),skuVersion:bundle.source.skuVersion,cueGroupsSha256:bundle.cueGroupsSha256,
          ...(asrInput.source?.sourceScope?{sourceScope:structuredClone(asrInput.source.sourceScope)}:{})};
        if (source.analysisRuleVersion === ASR_FRAME_RULE && JSON.stringify(source.analysisAsrEvidence) === JSON.stringify(evidence))
          return source;
        // Preserve the complete previous source/approval record before changing
        // the current analysis. Never silently inherit or erase its approvals.
        const historyDirectory = path.join(root, 'asr-history');
        await fs.mkdir(historyDirectory, {recursive:true,mode:0o700});
        const historyBody = JSON.stringify({previousSource:source,newEvidence:evidence});
        const historyName = createHash('sha256').update(historyBody).digest('hex') + '.json';
        try {
          const historyHandle=await fs.open(path.join(historyDirectory,historyName),'wx',0o600);
          try {await historyHandle.writeFile(historyBody);await historyHandle.sync();} finally {await historyHandle.close();}
          const directoryHandle=await fs.open(historyDirectory,'r');
          try {await directoryHandle.sync();}
          catch(error) {if(process.platform!=='win32'||!['EPERM','EINVAL','ENOTSUP'].includes(error.code))throw error;}
          finally {await directoryHandle.close();}
        }
        catch(error) {if(error.code !== 'EEXIST' || await fs.readFile(path.join(historyDirectory,historyName),'utf8') !== historyBody) throw error;}
        const generated = materializeSpeechSegments(source.id, alignAsrCuesToFrames(bundle));
        return updateLibrary(library => {
          const current = getSource(library, source.id);
          if (!current || JSON.stringify(current) !== JSON.stringify(source))
            throw new Error('ASR核验期间源记录已变化，请重新核对。');
          current.contentSha256 = bundle.source.sha256;
          current.skuVersion = bundle.source.skuVersion;
          current.analysisStatus = 'ready'; current.analysisProvider = bundle.provider || 'feishu_minutes_srt';
          current.analysisRuleVersion = ASR_FRAME_RULE;
          current.analysisAsrEvidence = evidence;
          current.previousAsrAnalysisFile = historyName;
          current.analysisTaskId = bundle.providerEvidence?.taskId || bundle.minuteToken;
          current.analysisUpdatedAt = nowIso();
          current.analysisMessage = `已核验真实ASR与原视频帧时间，共${generated.length}段；同SKU、原音轨、画面和业务事实仍须复核。`;
          // Do not carry an old manual approval into new ASR or a new SKU.
          current.speechSegments = generated;
          return current;
        });
      }
    await updateLibrary((library) => {
      const current = getSource(library, sourceId);
      current.analysisStatus = 'processing';
      current.analysisMessage = '正在识别原片文案与切点…';
      return current;
    });
    try {
      let candidates = [];
      let provider = null;
      let analysisTaskId = null;
      let cutterError = null;
      let silenceWindows = [];
      let sceneBoundaries = [];
      const cutterOutcomeTask = options.cutterAnalysisOutcomePromise
        ? Promise.resolve(options.cutterAnalysisOutcomePromise)
        : source.visibility !== 'private' &&
            source.materialCenterPreviewUrl &&
            cutter?.configured
          ? cutter.analyze(source.materialCenterPreviewUrl).then(
              (result) => ({ result, error: null }),
              (error) => ({ result: null, error }),
            )
          : Promise.resolve({ result: null, error: null });
      const silenceTask = source.hasAudio
        ? (async () => {
            try {
              const result = await runProcess(
                ffmpegPath,
                [
                  '-hide_banner',
                  '-i',
                  path.join(sourcesDir, source.storedName),
                  '-vn',
                  '-af',
                  'silencedetect=noise=-35dB:d=0.5',
                  '-f',
                  'null',
                  '-',
                ],
                { timeoutMs: 120000 },
              );
              return extractSilenceWindows(
                result.stderr,
                source.durationSeconds,
              );
            } catch {
              return [];
            }
          })()
        : Promise.resolve([]);
      const sceneTask = (async () => {
        try {
          const result = await runProcess(
            ffmpegPath,
            [
              '-hide_banner',
              '-loglevel',
              'info',
              '-i',
              path.join(sourcesDir, source.storedName),
              '-vf',
              'scale=360:-2:flags=fast_bilinear,select=gt(scene\\,0.32),showinfo',
              '-an',
              '-f',
              'null',
              '-',
            ],
            { timeoutMs: 120000 },
          );
          return extractSceneBoundaries(result.stderr, source.durationSeconds);
        } catch {
          return [];
        }
      })();
      const cutterOutcome = await Promise.all([
        silenceTask,
        sceneTask,
        cutterOutcomeTask,
      ]).then(([silenceResult, sceneResult, remoteResult]) => {
        silenceWindows = silenceResult;
        sceneBoundaries = sceneResult;
        return remoteResult;
      });
      if (cutterOutcome?.result) {
        try {
          const result = cutterOutcome.result;
          candidates = cutterSpeechSegments(
            result.results,
            source.durationSeconds,
            silenceWindows,
            sceneBoundaries,
            source.frameRate,
          );
          analysisTaskId = result.taskId;
          if (candidates.length) provider = 'cutter';
        } catch (error) {
          cutterError = error;
        }
      } else if (cutterOutcome?.error) {
        cutterError = cutterOutcome.error;
      }
      if (!candidates.length) {
        try {
          candidates = await ocrSpeechSegments(
            source,
            silenceWindows,
            sceneBoundaries,
          );
          if (candidates.length) provider = 'ocr';
        } catch {
          candidates = [];
        }
      }
      if (!candidates.length) {
        if (source.hasAudio) {
          candidates = speechCandidatesFromSilence(
            silenceWindows,
            source.durationSeconds,
            source.frameRate,
          );
        } else {
          candidates = fallbackSpeechSegments(source);
        }
        provider = 'silence';
      }
      const generatedSegments = materializeSpeechSegments(sourceId, candidates);
      const reviewRequiredCount = generatedSegments.filter(
        (segment) => segment.requiresReview,
      ).length;
      return updateLibrary((library) => {
        const current = getSource(library, sourceId);
        current.analysisStatus = 'ready';
        current.analysisProvider = provider;
        current.analysisTaskId = analysisTaskId;
        current.analysisUpdatedAt = nowIso();
        current.analysisDurationMs = Math.max(
          0,
          Date.now() - analysisStartedAt,
        );
        current.analysisRuleVersion = 'integer-second-boundary-guard-v3';
        current.analysisSceneBoundaries = sceneBoundaries;
        current.analysisSilenceWindows = silenceWindows;
        const reviewSuffix = reviewRequiredCount
          ? `；其中 ${reviewRequiredCount} 段未贴合可靠句末或停顿，系统会自动跳过并继续换源。`
          : '；切点已贴合句末、有效停顿或视频边界。';
        current.analysisMessage =
          provider === 'cutter'
            ? `已通过 Cutter 识别 ${generatedSegments.length} 段文案；商业表述仅为原片提取，缺少有效素材审核继承时系统会自动跳过${reviewSuffix}`
            : provider === 'ocr'
              ? `已通过本地字幕 OCR 识别 ${generatedSegments.length} 段文案，请逐段校准${reviewSuffix}`
              : cutterError
                ? 'Cutter 与字幕 OCR 未返回有效文案，仅按不少于0.5秒的停顿生成待复核切点；不会进入自动切片。'
                : '未识别到有效字幕，仅按不少于0.5秒的停顿生成待复核切点；不会进入自动切片。';
        current.speechSegments = preserveManualSegments(
          current.speechSegments,
          generatedSegments,
        );
        return current;
      });
    } catch (error) {
      await updateLibrary((library) => {
        const current = getSource(library, sourceId);
        current.analysisStatus = 'failed';
        current.analysisMessage =
          error instanceof Error ? error.message : '口播分析失败。';
        return current;
      });
      throw error;
    }
  };

  const normalizeFrameworkSlots = (rawSlots, preserveIds = false) => {
    const usedIds = new Set();
    return (Array.isArray(rawSlots) ? rawSlots : [])
      .map((slot, index) => {
        const label = safeLabel(slot?.label, `结构段 ${index + 1}`);
        const baseId = preserveIds
          ? safeId(slot?.id, `segment-${index + 1}`)
          : `${safeId(label, 'segment')}-${index + 1}`;
        const id = usedIds.has(baseId) ? `${baseId}-${index + 1}` : baseId;
        usedIds.add(id);
        return {
          id,
          label,
          note: safeLabel(slot?.note, ''),
          takeCount: Math.max(1, Math.min(3, Math.trunc(Number(slot?.takeCount) || 1))),
        };
      })
      .slice(0, 12);
  };

  const normalizeFrameworkTags = (tags) =>
    (Array.isArray(tags) ? tags : String(tags || '').split(/[，,]/))
      .map((tag) => safeLabel(tag))
      .filter(Boolean)
      .slice(0, 8);

  const createFramework = (payload, accessContext) =>
    updateLibrary((library) => {
      const identity = accessIdentity(accessContext);
      const source = payload.sourceId
        ? getSource(library, String(payload.sourceId))
        : null;
      if (payload.sourceId) assertSourceAccess(source, identity);
      const slots = normalizeFrameworkSlots(payload.slots);
      if (slots.length < 2) throw new Error('一个框架至少需要两个结构段。');
      const framework = {
        id: randomUUID(),
        name: safeLabel(payload.name, '自定义混剪框架'),
        description: safeLabel(
          payload.description,
          '按自定义顺序填入片段并生成组合。',
        ),
        tags: normalizeFrameworkTags(payload.tags),
        sourceType: payload.sourceType === 'parsed' ? 'parsed' : 'custom',
        sourceId: payload.sourceId ? String(payload.sourceId) : null,
        visibility:
          source?.visibility === 'private' || payload.visibility === 'private'
            ? 'private'
            : 'team',
        createdById: identity.id,
        createdAt: nowIso(),
        slots,
      };
      library.frameworks.unshift(framework);
      return framework;
    });

  const workspaceFrameworkFromPayload = (baseFramework, payload) => {
    const slots = normalizeFrameworkSlots(payload?.slots, true);
    if (slots.length < 2) {
      throw new Error('自定义框架至少需要两个镜头分组。');
    }
    const normalized = {
      name: safeLabel(payload?.name, `${baseFramework.name}·自定义`),
      description: safeLabel(
        payload?.description,
        '在混剪工作区调整分组后自动保存的手动框架。',
      ),
      tags: normalizeFrameworkTags(payload?.tags),
      slots,
      derivedFromFrameworkId: baseFramework.id,
    };
    return {
      ...baseFramework,
      ...normalized,
      sourceType: 'custom',
      sourceId: null,
      workspaceFingerprint: createHash('sha256')
        .update(JSON.stringify(normalized))
        .digest('hex'),
    };
  };

  const persistWorkspaceFramework = (library, workspaceFramework) => {
    const existing = library.frameworks.find(
      (framework) =>
        !framework.deletedAt &&
        framework.sourceType === 'custom' &&
        framework.visibility === workspaceFramework.visibility &&
        (framework.visibility !== 'private' ||
          framework.createdById === workspaceFramework.createdById) &&
        framework.workspaceFingerprint ===
          workspaceFramework.workspaceFingerprint,
    );
    if (existing) return existing;
    const framework = {
      ...workspaceFramework,
      id: randomUUID(),
      createdAt: nowIso(),
      slots: workspaceFramework.slots.map((slot) => ({ ...slot })),
    };
    library.frameworks.unshift(framework);
    return framework;
  };

  const promoteFramework = (frameworkId, accessContext) =>
    updateLibrary((library) => {
      const framework = getFramework(library, frameworkId);
      if (!canReadFramework(library, framework, accessIdentity(accessContext)))
        throw new Error('框架不存在或无权访问。');
      if (framework.sourceType === 'preset') return framework;
      const existingPreset = library.frameworks.find(
        (item) =>
          !item.deletedAt &&
          item.sourceType === 'preset' &&
          item.promotedFromId === framework.id,
      );
      if (existingPreset) return existingPreset;
      const preset = {
        ...framework,
        id: randomUUID(),
        sourceType: 'preset',
        sourceId: null,
        promotedFromId: framework.id,
        createdAt: nowIso(),
        slots: framework.slots.map((slot) => ({ ...slot })),
      };
      library.frameworks.unshift(preset);
      return preset;
    });

  const deleteFramework = (frameworkId, accessContext) =>
    updateLibrary((library) => {
      if (
        !canReadFramework(
          library,
          getFramework(library, frameworkId),
          accessIdentity(accessContext),
        )
      )
        throw new Error('框架不存在或无权访问。');
      const defaultFramework = DEFAULT_FRAMEWORKS.find(
        (framework) => framework.id === frameworkId,
      );
      if (defaultFramework) {
        if (!library.deletedFrameworkIds.includes(frameworkId)) {
          library.deletedFrameworkIds.push(frameworkId);
        }
        return defaultFramework;
      }
      const framework = library.frameworks.find(
        (item) => item.id === frameworkId,
      );
      if (!framework) throw new Error('未找到该框架。');
      if (!framework.deletedAt) framework.deletedAt = nowIso();
      return framework;
    });

  const recognizeFramework = async (sourceId) => {
    const library = await readLibrary();
    const source = getSource(library, sourceId);
    if (!source) throw new Error('未找到参考视频，请刷新后重试。');
    const segments = Array.isArray(source.speechSegments)
      ? source.speechSegments
      : [];
    if (source.analysisStatus !== 'ready' || segments.length < 2) {
      throw new Error('请先完成候选切点分析，再生成规则框架建议。');
    }

    const slotCount = Math.min(8, segments.length);
    const groupedSegments = Array.from({ length: slotCount }, (_, index) => {
      const startIndex = Math.floor((index * segments.length) / slotCount);
      const endIndex = Math.max(
        startIndex + 1,
        Math.floor(((index + 1) * segments.length) / slotCount),
      );
      return segments.slice(startIndex, endIndex);
    });
    const labels = groupedSegments.map((_, index) => {
      if (index === 0) return '开场钩子';
      if (index === groupedSegments.length - 1) return '行动收口';
      if (index === 1 && groupedSegments.length >= 4) return '痛点/需求';
      if (index === 2 && groupedSegments.length >= 5) return '产品方案';
      if (index === groupedSegments.length - 2) return '体验证明';
      return `内容展开 ${index}`;
    });
    const baseName = safeLabel(
      path.basename(source.originalName, path.extname(source.originalName)),
      '参考视频',
    );

    return {
      mode: 'rules',
      ruleVersion: 'pause-order-duration-v1',
      sourceId: source.id,
      sourceName: source.originalName,
      name: `${baseName}·规则框架`,
      description:
        '按口播停顿、段落顺序及时长生成的规则建议；未进行语义识别，保存前请人工确认。',
      evidence: [
        `检测到 ${segments.length} 个候选口播段`,
        `参考片总时长 ${number(source.durationSeconds)} 秒`,
        `按出现顺序归并为 ${slotCount} 个结构位`,
      ],
      slots: groupedSegments.map((group, index) => {
        const first = group[0];
        const last = group[group.length - 1];
        return {
          id: `recognized-${index + 1}`,
          label: labels[index],
          note: `规则依据：第 ${first.index}-${last.index} 段，${number(first.startSeconds)}-${number(last.endSeconds)} 秒；请人工核对结构含义。`,
          startSeconds: number(first.startSeconds),
          endSeconds: number(last.endSeconds),
        };
      }),
    };
  };

  const createFolder = (payload, accessContext) =>
    updateLibrary((library) => {
      const name = safeLabel(payload.name, '');
      if (!name) throw new Error('请输入文件夹名称。');
      const parentId = payload.parentId ? String(payload.parentId) : null;
      const identity = accessIdentity(accessContext);
      const parentFolder = parentId
        ? library.folders.find((folder) => folder.id === parentId)
        : null;
      if (parentId && !parentFolder) {
        throw new Error('上级文件夹已失效，请刷新后重试。');
      }
      if (parentFolder && parentFolder.createdById !== identity.id) {
        throw new Error('只能在自己的文件夹下新建子文件夹。');
      }
      const existing = library.folders.find(
        (folder) =>
          folder.createdById === identity.id &&
          (folder.parentId || null) === parentId &&
          folder.name.toLocaleLowerCase('zh-CN') ===
            name.toLocaleLowerCase('zh-CN'),
      );
      if (existing) return existing;
      const folder = {
        id: randomUUID(),
        name,
        parentId,
        createdAt: nowIso(),
        createdById: identity.id,
        createdByName: identity.name,
      };
      library.folders.unshift(folder);
      return folder;
    });

  const uploadFolderParts = (relativePath, originalName) => {
    const normalized = String(relativePath || originalName || '')
      .normalize('NFKC')
      .replace(/\\/g, '/')
      .replace(/^\/+|\/+$/g, '');
    const parts = normalized.split('/').filter(Boolean);
    if (parts.some((part) => part === '.' || part === '..')) {
      throw new Error('上传文件夹路径无效。');
    }
    const folders = parts
      .slice(0, -1)
      .map((part) => safeLabel(part, ''))
      .filter(Boolean);
    if (folders.length > DIRECT_CLIP_UPLOAD_MAX_FOLDER_DEPTH) {
      throw new Error(
        `上传文件夹最多支持 ${DIRECT_CLIP_UPLOAD_MAX_FOLDER_DEPTH} 级目录。`,
      );
    }
    return folders;
  };

  const ensureDirectUploadFolder = (
    relativePath,
    originalName,
    targetFolderId,
    accessContext,
  ) =>
    updateLibrary((library) => {
      const identity = accessIdentity(accessContext);
      let parentId = targetFolderId ? String(targetFolderId) : null;
      const pathNames = [];
      if (parentId) {
        const baseFolder = library.folders.find(
          (folder) => folder.id === parentId,
        );
        if (!baseFolder || baseFolder.createdById !== identity.id) {
          throw new RemixAccessError('只能把上传切片放入自己的文件夹。', 403);
        }
        pathNames.push(baseFolder.name);
      }
      for (const name of uploadFolderParts(relativePath, originalName)) {
        let folder = library.folders.find(
          (candidate) =>
            candidate.createdById === identity.id &&
            (candidate.parentId || null) === parentId &&
            candidate.name.toLocaleLowerCase('zh-CN') ===
              name.toLocaleLowerCase('zh-CN'),
        );
        if (!folder) {
          folder = {
            id: randomUUID(),
            name,
            parentId,
            createdAt: nowIso(),
            createdById: identity.id,
            createdByName: identity.name,
          };
          library.folders.unshift(folder);
        }
        parentId = folder.id;
        pathNames.push(folder.name);
      }
      return { folderId: parentId, folderPath: pathNames.join(' / ') };
    });

  const deleteFolder = (folderId, accessContext) =>
    updateLibrary((library) => {
      const identity = accessIdentity(accessContext);
      const folderIndex = library.folders.findIndex(
        (folder) => folder.id === folderId,
      );
      if (folderIndex < 0) throw new Error('未找到该文件夹。');
      if (library.folders[folderIndex].createdById !== identity.id) {
        throw new Error('只能删除自己创建的文件夹。');
      }
      if (library.folders.some((folder) => folder.parentId === folderId)) {
        throw new Error('请先删除或移动该文件夹下的子文件夹。');
      }
      if (
        library.clips.some(
          (clip) =>
            clip.folderId === folderId ||
            Object.values(clip.folderAssignments || {}).includes(folderId),
        )
      ) {
        throw new Error('请先移出该文件夹中的切片。');
      }
      const [folder] = library.folders.splice(folderIndex, 1);
      return folder;
    });

  const updateClipFolder = (clipId, payload, accessContext) =>
    updateLibrary((library) => {
      const clip = getClip(library, clipId);
      if (!clip) throw new Error('未找到该切片。');
      const identity = accessIdentity(accessContext);
      const folderId = payload.folderId ? String(payload.folderId) : null;
      const folder = folderId
        ? library.folders.find((candidate) => candidate.id === folderId)
        : null;
      if (folderId && !folder) {
        throw new Error('所选个人文件夹已失效，请刷新后重试。');
      }
      if (folder && folder.createdById !== identity.id) {
        throw new Error('只能把切片归入自己的文件夹。');
      }
      clip.folderAssignments = {
        ...(clip.folderAssignments || {}),
      };
      if (folderId) clip.folderAssignments[identity.id] = folderId;
      else delete clip.folderAssignments[identity.id];
      return clip;
    });

  const updateSourceMetadata = (sourceId, payload, accessContext) =>
    updateLibrary((library) => {
      const source = getSource(library, sourceId);
      if (!source) throw new Error('未找到该素材。');
      const identity = accessIdentity(accessContext);
      if (source.createdById !== identity.id) {
        throw new Error('只能编辑自己导入或上传的素材。');
      }
      source.originalName = safeLabel(payload.name, source.originalName);
      source.tags = (
        Array.isArray(payload.tags)
          ? payload.tags
          : String(payload.tags || '').split(/[，,]/)
      )
        .map((tag) => safeLabel(tag))
        .filter(Boolean)
        .slice(0, 8);
      source.productCategory = safeLabel(
        payload.productCategory,
        sourceProductCategory(source),
      );
      source.metadataUpdatedAt = nowIso();
      return source;
    });

  const updateClipMetadata = (clipId, payload, accessContext) =>
    updateLibrary((library) => {
      const clip = getClip(library, clipId);
      if (!clip) throw new Error('未找到该切片。');
      const identity = accessIdentity(accessContext);
      const ownerIds = Array.isArray(clip.createdByIds)
        ? clip.createdByIds
        : [];
      if (!ownerIds.includes(identity.id)) {
        throw new Error('只能编辑自己制作的切片。');
      }
      clip.name = safeLabel(payload.name, clip.name);
      clip.nameOrigin = 'manual';
      clip.tags = (
        Array.isArray(payload.tags)
          ? payload.tags
          : String(payload.tags || '').split(/[，,]/)
      )
        .map((tag) => safeLabel(tag))
        .filter(Boolean)
        .slice(0, 8);
      const productCategory = safeLabel(
        payload.productCategory,
        clipProductCategory(clip, library),
      );
      if (!productCategory) {
        throw new Error('请选择“通用切片”或该切片所属的具体产品。');
      }
      clip.productCategory = productCategory;
      clip.metadataUpdatedAt = nowIso();
      return clip;
    });

  const applySpeechSegmentUpdate = (source, segment, payload) => {
    const startSeconds = Number(payload.startSeconds);
    const endSeconds = Number(payload.endSeconds);
    const durationSeconds = endSeconds - startSeconds;
    if (
      !Number.isFinite(startSeconds) ||
      !Number.isFinite(endSeconds) ||
      startSeconds < 0 ||
      endSeconds <= startSeconds ||
      endSeconds > source.durationSeconds + 0.1
    ) {
      throw new Error('切点超出视频范围，请重新调整起止时间。');
    }
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
      throw new Error('切片须有有效的正时长。');
    }
    segment.label = safeTranscript(payload.label, segment.label);
    segment.clipName = safeTranscript(
      payload.clipName,
      segment.clipName || segment.label,
    ).slice(0, 80);
    segment.startSeconds = number(startSeconds);
    segment.endSeconds = number(endSeconds);
    segment.durationSeconds = number(durationSeconds);
    segment.transcriptSource = 'manual';
    segment.boundaryConfidence = 'manual';
    segment.requiresReview = false;
    segment.reviewReasons = [];
    segment.manualEditedAt = nowIso();
  };

  const updateSpeechSegment = (sourceId, segmentId, payload) =>
    updateLibrary((library) => {
      const source = getSource(library, sourceId);
      const segment = source?.speechSegments?.find(
        (candidate) => candidate.id === segmentId,
      );
      if (!source || !segment)
        throw new Error('未找到该口播片段，请刷新后重试。');
      applySpeechSegmentUpdate(source, segment, payload);
      return source;
    });

  const updateSpeechSegments = (sourceId, payload) =>
    updateLibrary((library) => {
      const source = getSource(library, sourceId);
      if (!source) throw new Error('未找到该素材，请刷新后重试。');
      const updates = Array.isArray(payload.segments) ? payload.segments : [];
      if (!updates.length) throw new Error('请至少勾选一个口播片段。');
      if (updates.length > 100)
        throw new Error('单次最多批量保存100个口播片段。');
      const segmentIds = updates.map((item) => String(item?.id || ''));
      if (
        segmentIds.some((segmentId) => !segmentId) ||
        new Set(segmentIds).size !== segmentIds.length
      ) {
        throw new Error('批量保存包含无效或重复的口播片段。');
      }
      const candidates = updates.map((item, index) => {
        const segment = source.speechSegments?.find(
          (candidate) => candidate.id === segmentIds[index],
        );
        if (!segment) throw new Error('部分口播片段已失效，请刷新后重新勾选。');
        return { segment, payload: item };
      });
      for (const candidate of candidates) {
        applySpeechSegmentUpdate(source, candidate.segment, candidate.payload);
      }
      return { source, updatedCount: candidates.length };
    });

  const createClip = (payload, accessContext, recoveryGuard = null, trustedJobId) => {
    const operation = clipQueue.then(async () => {
      if(recoveryGuard && !(await recoveryGuard.assertCurrent()))throw Error('本批任务、权限或来源缓存已变化，未继续补切。');
      const sourceId = String(payload.sourceId || '');
      const startSeconds = Number(payload.startSeconds);
      const endSeconds = Number(payload.endSeconds);
      const sourceLibrary = await readLibrary();
      const source = getSource(sourceLibrary, sourceId);
      if (!source) throw new Error('未找到源视频，请刷新后重试。');
      assertSourceAccess(source, accessIdentity(accessContext));
      if (
        sourceLibrary.clips.some(
          (clip) =>
            clip.sourceId === sourceId &&
            clipIsBlocked(clip) &&
            clip.startSeconds < endSeconds &&
            clip.endSeconds > startSeconds,
        )
      ) {
        throw new Error(
          '切点与已标记卡审或违规的区间重叠，请换用安全区间；原片和问题记录仍保留。',
        );
      }
      if (
        !Number.isFinite(startSeconds) ||
        !Number.isFinite(endSeconds) ||
        startSeconds < 0 ||
        endSeconds <= startSeconds
      ) {
        throw new Error('请填写有效的起止时间。');
      }
      if (endSeconds > source.durationSeconds + 0.1)
        throw new Error('结束时间超出源视频时长。');
      const durationSeconds = endSeconds - startSeconds;
      const requestedAsrGroup = source.speechSegments?.find(segment =>
        segment.boundaryRule === ASR_FRAME_RULE && segment.boundaryType === 'asr_sentence_group' &&
        Math.abs(segment.startSeconds - startSeconds) < 1e-6 &&
        Math.abs(segment.endSeconds - endSeconds) < 1e-6);
      if (requestedAsrGroup && !trustedSourceBoundary(requestedAsrGroup, source))
        throw new Error('该完整语句组的SKU或来源证据尚未核实，请先完成核验；不会退化成普通切片或继承旧批准。');
      const verifiedAsrSegment = source.speechSegments?.find(segment =>
        trustedSourceBoundary(segment, source) &&
        Math.abs(segment.startSeconds - startSeconds) < 1e-6 &&
        Math.abs(segment.endSeconds - endSeconds) < 1e-6);
      if(!sourceReviewScopeAllows(verifiedAsrSegment?.semanticReviewProof,trustedJobId))
        throw Object.assign(new Error('该来源片段仅可供原测试任务使用，未创建跨任务切片。'),{code:'SOURCE_REVIEW_SCOPE_MISMATCH'});
      if (verifiedAsrSegment && await hashFile(path.join(sourcesDir, source.storedName)) !== source.contentSha256)
        throw new Error('原视频文件已变化，不能继承ASR句界核验。');
      const boundaryNumber = preciseBoundarySeconds;
      if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
        throw new Error('切片须有有效的正时长。');
      }
      const productCategory = safeLabel(payload.productCategory, '');
      if (verifiedAsrSegment && productCategory !== source.productCategory)
        throw new Error('ASR句界证据只适用于原产品，不能跨SKU继承。');
      if (!productCategory) {
        throw new Error('请选择“通用切片”或该切片所属的具体产品。');
      }
      const role = safeId(payload.role, 'custom');
      const tags = Array.isArray(payload.tags)
        ? payload.tags
        : String(payload.tags || '').split(/[，,]/);
      const importIdempotencyKey = safeLabel(payload.importIdempotencyKey, '');
      const matchesRequestedClip = (clip) =>
        importIdempotencyKey
          ? clip.importIdempotencyKey === importIdempotencyKey
          : clip.sourceId === sourceId &&
            clip.role === role &&
            clipProductCategory(clip, sourceLibrary) === productCategory &&
            Math.abs(clip.startSeconds - startSeconds) < 0.01 &&
            Math.abs(clip.endSeconds - endSeconds) < 0.01;
      const assertRangeNotBlocked = library => {
        if (library.clips.some(clip=>matchesRequestedClip(clip)&&clipIsBlocked(clip)))
          throw new Error(
            '该区间已被审核驳回，不能重复生成后绕过审核；请调整切点或换片。',
          );
      };
      const matchingClips=sourceLibrary.clips.filter(matchesRequestedClip);
      assertRangeNotBlocked(sourceLibrary);
      let existingClip;
      for(const candidate of matchingClips) {
        if(!verifiedAsrSegment || (await assessAsrClipReuse({clip:candidate,segment:verifiedAsrSegment,
          hashClip:clip=>hashFile(path.join(clipsDir,clip.storedName))})).reusable) {existingClip=candidate;break;}
      }
      if(matchingClips.length && !existingClip && importIdempotencyKey)
        throw new Error('原请求已登记切片，但当前文件或切点依据已变化；保留原记录，未用同一请求重复生成。');
      if(recoveryGuard?.materializationOnly&&matchingClips.length&&!existingClip)
        throw new Error('缓存物化的原切片已变化，保留旧记录，未复制失效切片或批准。');
      if(recoveryGuard?.existingClipId&&existingClip?.id!==recoveryGuard.existingClipId)
        throw new Error('缓存物化的原待审切片身份变化，未用新ID替代。');
      if (existingClip) {
        const expectedExisting=JSON.stringify(existingClip);
        const identity = accessIdentity(accessContext);
        return updateLibrary((library) => {
          if(recoveryGuard && !recoveryGuard.isActiveInLibrary(library))throw Error('本批恢复条件已变化，未复用切片。');
          assertRangeNotBlocked(library);
          const current = getClip(library, existingClip.id);
          if (!current) throw new Error('切片记录已失效，请刷新后重试。');
          if(JSON.stringify(current)!==expectedExisting)throw new Error('复用核验期间切片记录已变化，未覆盖原状态。');
          current.createdByIds = Array.isArray(current.createdByIds)
            ? current.createdByIds
            : [];
          current.createdByNames = Array.isArray(current.createdByNames)
            ? current.createdByNames
            : [];
          if (!current.createdByIds.includes(identity.id)) {
            current.createdByIds.push(identity.id);
          }
          if (!current.createdByNames.includes(identity.name)) {
            current.createdByNames.push(identity.name);
          }
          return current;
        });
      }
      // A historical same-range row without current ASR/file evidence remains
      // untouched. Make a new pending cut, not a false migration of old approval.
      assertRangeNotBlocked(await readLibrary());
      if(recoveryGuard && !(await recoveryGuard.assertCurrent()))throw Error('本批任务、权限或来源缓存已变化，未继续补切。');
      const clipId = randomUUID();
      const storedName = `${clipId}.mp4`;
      await makeSegment({
        inputPath: path.join(sourcesDir, source.storedName),
        outputPath: path.join(clipsDir, storedName),
        startSeconds,
        durationSeconds,
        hasAudio: source.hasAudio,
        fadeInSeconds: 0,
        fadeOutSeconds: 0,
        config: REMIX_CONFIG,
      });
      if (verifiedAsrSegment && await hashFile(path.join(sourcesDir, source.storedName)) !== source.contentSha256) {
        await fs.unlink(path.join(clipsDir, storedName));
        throw new Error('裁切期间原视频文件已变化，已保留原任务并丢弃本次未登记切片。');
      }
      const contentSha256 = await hashFile(path.join(clipsDir, storedName));
      if(recoveryGuard && !(await recoveryGuard.assertCurrent())){
        await fs.unlink(path.join(clipsDir,storedName));
        throw Error('补切期间任务、权限或来源缓存已变化，未登记新切片。');
      }
      let registrationChecksPassed=false;
      try { return await updateLibrary((library) => {
        if(recoveryGuard && !recoveryGuard.isActiveInLibrary(library))throw Error('补切登记前本批恢复条件已变化，未登记新切片。');
        assertRangeNotBlocked(library);
        if (!getSource(library, sourceId))
          throw new Error('源视频已被移除，请刷新后重试。');
        registrationChecksPassed=true;
        const identity = accessIdentity(accessContext);
        const clip = {
          id: clipId,
          sourceId,
          storedName,
          contentSha256,
          name: safeLabel(payload.name, `切片 ${library.clips.length + 1}`),
          nameOrigin: ['recognized', 'neutral_fallback'].includes(payload.nameOrigin) ? payload.nameOrigin : 'manual',
          role,
          tags: tags
            .map((tag) => safeLabel(tag))
            .filter(Boolean)
            .slice(0, 8),
          productCategory,
          importIdempotencyKey: importIdempotencyKey || undefined,
          approvalSource: safeLabel(payload.approvalSource, ''),
          approvalProvenance:
            payload.approvalProvenance &&
            typeof payload.approvalProvenance === 'object'
              ? payload.approvalProvenance
              : undefined,
          startSeconds: boundaryNumber(startSeconds),
          endSeconds: boundaryNumber(endSeconds),
          durationSeconds: boundaryNumber(durationSeconds),
          boundaryEvidence: verifiedAsrSegment?.boundaryEvidence || null,
          reviewStatus: 'pending',
          reviewNote: '',
          createdAt: nowIso(),
          reviewedAt: null,
          folderId: null,
          createdByIds: [identity.id],
          createdByNames: [identity.name],
          visibility: normalizeVisibility(source.visibility),
        };
        library.clips.unshift(clip);
        recordServiceEvent(library,clipGeneratedEvent(clip,source,identity));
        return clip;
      }); } catch(error) {
        // Only a confirmed pre-registration refusal is safe to clean up.
        // Preserve bytes on uncertain persistence failures and never touch an
        // existing clip: storedName belongs to this newly generated UUID.
        if(recoveryGuard&&!registrationChecksPassed){
          try {await fs.unlink(path.join(clipsDir,storedName));}
          catch(cleanupError){if(cleanupError.code!=='ENOENT')error.cleanupError=cleanupError;}
        }
        throw error;
      }
    });
    clipQueue = operation.catch(() => undefined);
    return operation;
  };

  const createDirectClipUpload = async (
    req,
    accessContext,
    preparedUpload = null,
  ) => {
    const upload = preparedUpload || (await parseDirectClipUpload(req, accessContext));
    if (normalizeVisibility(upload.fields.visibility) === 'private' && !privateUploadAllowed(accessContext))
      throw new Error('私人素材功能尚未对当前账号开放。');
    let createdSourceId = null;
    try {
      const productCategory = safeLabel(upload.fields.productCategory, '');
      if (!productCategory) {
        throw new Error('上传切片前请选择“通用切片”或所属的具体产品。');
      }
      const [media, contentSha256] = await Promise.all([
        inspectMedia(upload.storedPath),
        hashFile(upload.storedPath),
      ]);
      const durationSeconds = number(media.duration);
      if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
        throw new Error('直接上传到切片库的视频须有有效的正时长。');
      }
      const identity = accessIdentity(accessContext);
      const visibility = normalizeVisibility(upload.fields.visibility);
      const batchId = safeLabel(upload.fields.batchId, randomUUID());
      const relativePath = safeRelativeUploadPath(
        upload.fields.relativePath,
        upload.originalName,
      );
      const sourceResult = await updateLibrary((library) => {
        const existing = library.sources.find(
          (source) =>
            source.contentSha256 === contentSha256 &&
            (visibility === 'team' || source.createdById === identity.id) &&
            normalizeVisibility(source.visibility) === visibility,
        );
        if (existing) return { source: existing, reused: true };
        const source = {
          id: randomUUID(),
          originalName: upload.originalName,
          storedName: upload.storedName,
          size: upload.size,
          durationSeconds,
          hasAudio: media.hasAudio,
          ...mediaTimingRecord(media),
          uploadedAt: nowIso(),
          analysisStatus: 'not_started',
          analysisMessage: '',
          speechSegments: [],
          tags: ['直接上传'],
          productCategory,
          sourceType: 'manual_upload',
          uploadOrigin: 'clip_library',
          uploadBatchId: batchId,
          uploadRelativePath: relativePath,
          uploadClientFingerprint: safeLabel(
            upload.fields.clientFingerprint,
            '',
          ),
          contentSha256,
          visibility,
          createdById: identity.id,
          createdByName: identity.name,
        };
        library.sources.unshift(source);
        createdSourceId = source.id;
        return { source, reused: false };
      });
      const folder = await ensureDirectUploadFolder(
        relativePath,
        upload.originalName,
        upload.fields.targetFolderId,
        accessContext,
      );
      const clip = await createClip(
        {
          sourceId: sourceResult.source.id,
          startSeconds: 0,
          endSeconds: sourceResult.source.durationSeconds,
          role: 'direct-upload',
          name: safeLabel(
            path.basename(
              upload.originalName,
              path.extname(upload.originalName),
            ),
            '直接上传切片',
          ),
          tags: ['直接上传'],
          productCategory,
        },
        accessContext,
      );
      const assignedClip = folder.folderId
        ? await updateClipFolder(
            clip.id,
            { folderId: folder.folderId },
            accessContext,
          )
        : clip;
      if (
        !preparedUpload &&
        sourceResult.reused &&
        upload.storedPath !==
          path.join(sourcesDir, sourceResult.source.storedName)
      ) {
        await fs.rm(upload.storedPath, { force: true });
      }
      return {
        batchId,
        relativePath,
        folderPath: folder.folderPath,
        contentSha256,
        reused: sourceResult.reused || assignedClip.id !== clip.id,
        source: publicSourceRecordForUser(sourceResult.source, accessContext),
        clip: publicClipRecord(assignedClip, accessContext),
      };
    } catch (error) {
      if (preparedUpload) throw error; // Keep accepted bytes for retry/restart.
      if (createdSourceId) {
        const removed = await updateLibrary((library) => {
          if (library.clips.some((clip) => clip.sourceId === createdSourceId))
            return null;
          const index = library.sources.findIndex(
            (source) => source.id === createdSourceId,
          );
          if (index < 0) return null;
          return library.sources.splice(index, 1)[0];
        });
        if (removed?.storedName) {
          await fs
            .rm(path.join(sourcesDir, removed.storedName), { force: true })
            .catch(() => undefined);
        }
      } else {
        await fs.rm(upload.storedPath, { force: true }).catch(() => undefined);
      }
      throw error;
    }
  };

  const assessClipAutomatically = async (
    clipId,
    transcriptValue = '',
    options = {},
  ) => {
    const library = await readLibrary();
    let clip = structuredClone(getClip(library, clipId));
    const source = clip ? structuredClone(getSource(library, clip.sourceId)) : null;
    if (!clip || !source) throw new Error('自动质检时切片记录已失效。');
    if(!clipSourceReviewScopeAllows(clip,source,options.trustedJobId))
      throw Object.assign(new Error('该来源审核只允许原测试任务使用，未复用或批准本切片。'),{code:'SOURCE_REVIEW_SCOPE_MISMATCH'});
    const cacheRecoveryGuard=options.cacheRecoveryGuard;
    const practicalPilot=practicalReviewJobIds.includes(options.trustedJobId)&&typeof options.trustedRunId==='string'&&options.trustedRunId.length>0;
    const pilotStateCurrent=latest=>{
      const currentJob=latest.autoJobs.find(row=>row.id===options.trustedJobId);
      const currentRun=currentJob?.runs?.find(row=>row.id===options.trustedRunId);
      return Boolean(currentJob?.status==='active'&&!currentJob.archivedAt&&ownerCanUseAutomation(latest,currentJob)
        &&currentRun&&!['completed','cancelled'].includes(currentRun.status)
        &&canReadSource(getSource(latest,source.id),accessIdentity({sub:currentJob.createdById,name:currentJob.createdByName}))
        &&JSON.stringify(getSource(latest,source.id))===JSON.stringify(source)
        &&JSON.stringify(getClip(latest,clipId))===JSON.stringify(clip));
    };
    const assertReviewCurrent=async()=>{
      if(cacheRecoveryGuard&&!(await cacheRecoveryGuard.assertCurrent()))return false;
      return !practicalPilot||pilotStateCurrent(await readLibrary());
    };
    if(cacheRecoveryGuard&&(clip.reviewStatus!=='pending'||clip.automaticAssessment||!(await cacheRecoveryGuard.assertCurrent())))
      throw Error('缓存物化的任务、原回执或切片状态变化，未开始技术审核。');
    let boundaryAssessment = assessClipBoundaryIntegrity({
      clipStartSeconds: clip.startSeconds,
      clipEndSeconds: clip.endSeconds,
      sourceDurationSeconds: source.durationSeconds,
      segments: source.speechSegments,
    });
    let autoAdjusted = false;
    let adjustmentError = '';
    if (options.autoAdjustBoundary && !cacheRecoveryGuard && boundaryAssessment.canAutoAdjust) {
      const adjustedStart = boundaryAssessment.recommendedStartSeconds;
      const adjustedEnd = boundaryAssessment.recommendedEndSeconds;
      const adjustedDuration = adjustedEnd - adjustedStart;
      const temporaryPath = path.join(
        clipsDir,
        `${clip.id}-${randomUUID()}.adjusting.mp4`,
      );
      try {
        await makeSegment({
          inputPath: path.join(sourcesDir, source.storedName),
          outputPath: temporaryPath,
          startSeconds: adjustedStart,
          durationSeconds: adjustedDuration,
          hasAudio: source.hasAudio,
          fadeInSeconds: 0,
          fadeOutSeconds: 0,
          config: REMIX_CONFIG,
        });
        await fs.copyFile(temporaryPath, path.join(clipsDir, clip.storedName));
        const adjustedSha256 = await hashFile(temporaryPath);
        clip = await updateLibrary((latest) => {
          const current = getClip(latest, clipId);
          if (!current) throw new Error('自动校准保存时切片记录已失效。');
          current.contentSha256 = adjustedSha256;
          current.startSeconds = number(adjustedStart);
          current.endSeconds = number(adjustedEnd);
          current.durationSeconds = number(adjustedDuration);
          current.automaticBoundaryAdjustedAt = nowIso();
          return current;
        });
        boundaryAssessment = assessClipBoundaryIntegrity({
          clipStartSeconds: clip.startSeconds,
          clipEndSeconds: clip.endSeconds,
          sourceDurationSeconds: source.durationSeconds,
          segments: source.speechSegments,
        });
        autoAdjusted = boundaryAssessment.status === 'passed';
      } catch (error) {
        adjustmentError =
          error instanceof Error ? error.message : '自动修正切点失败';
      } finally {
        await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
      }
    }
    let media = null;
    let mediaError = null;
    try {
      media = await inspectMedia(path.join(clipsDir, clip.storedName));
    } catch (error) {
      mediaError = error;
    }
    let clipSceneBoundaries = [];
    if (media) {
      try {
        const result = await runProcess(
          ffmpegPath,
          [
            '-hide_banner',
            '-loglevel',
            'info',
            '-i',
            path.join(clipsDir, clip.storedName),
            '-vf',
            'select=gt(scene\\,0.32),showinfo',
            '-an',
            '-f',
            'null',
            '-',
          ],
          { timeoutMs: 60000 },
        );
        clipSceneBoundaries = extractSceneBoundaries(
          result.stderr,
          clip.durationSeconds,
        );
      } catch {
        clipSceneBoundaries = [];
      }
    }
    const edgeSceneBoundaries = clipSceneBoundaries.filter(
      (seconds) => seconds <= 0.45 || clip.durationSeconds - seconds <= 0.45,
    );
    const edgeScenePassed = edgeSceneBoundaries.length === 0;
    const integerSecondPassed =
      Number.isInteger(Number(clip.startSeconds)) &&
      Number.isInteger(Number(clip.endSeconds));
    const asrBoundaryRequired = source.analysisRuleVersion === ASR_FRAME_RULE || Boolean(clip.boundaryEvidence);
    const nativeSegment = source.speechSegments?.find(segment =>
      trustedSourceBoundary(segment, source) &&
      Math.abs(segment.startSeconds - clip.startSeconds) < 1e-6 &&
      Math.abs(segment.endSeconds - clip.endSeconds) < 1e-6 &&
      Math.abs(segment.durationSeconds - clip.durationSeconds) < 1e-6 &&
      JSON.stringify(segment.boundaryEvidence) === JSON.stringify(clip.boundaryEvidence));
    const asrEvidence = source.analysisAsrEvidence;
    const nativeEvidenceMatches = Boolean(nativeSegment && nativeSegment.id === boundaryAssessment.segmentId &&
      source.analysisRuleVersion === ASR_FRAME_RULE && (hasLegacySourcePointer(source) || typeof source.skuVersion === 'string' &&
      source.skuVersion.trim() === source.skuVersion && source.skuVersion.length > 0 && source.skuVersion.length <= 160 &&
      !/未确认|待核验|待确认|unknown|^(?:null|none|undefined)$/iu.test(source.skuVersion)) &&
      asrEvidence?.sourceSha256 === source.contentSha256 && asrEvidence?.skuVersion === source.skuVersion &&
      ['srtSha256', 'frameMapSha256'].every(key =>
        asrEvidence?.[key] && asrEvidence[key] === nativeSegment.boundaryEvidence[key]) &&
      asrProviderEvidenceMatches(asrEvidence,nativeSegment.boundaryEvidence) &&
      (!nativeSegment.boundaryEvidence.groupRule || asrEvidence.cueGroupsSha256 === nativeSegment.boundaryEvidence.cueGroupsSha256) &&
      (!transcriptValue || safeTranscript(transcriptValue, '') === safeTranscript(nativeSegment.label, '')));
    let nativeFramePassed = false;
    if (nativeEvidenceMatches) {
      try {
        nativeFramePassed = await hashFile(path.join(sourcesDir, source.storedName)) === source.contentSha256 &&
          /^[a-f0-9]{64}$/.test(clip.contentSha256 || '') &&
          await hashFile(path.join(clipsDir, clip.storedName)) === clip.contentSha256;
      } catch { /* Missing or changed real files are not a trusted frame boundary. */ }
    }
    // This changes the grid check only. Unreviewed original speech, business
    // facts, audio and the subsequent output visual review keep their gates.
    const boundaryGridPassed = asrBoundaryRequired ? nativeFramePassed : integerSecondPassed;
    const sourceSemanticPassed = !sourceVersionManaged(source) || Boolean(nativeSegment && await verifySourceSegmentProof(source,nativeSegment,
      cacheRecoveryGuard||practicalPilot?assertReviewCurrent:undefined,options.trustedJobId));
    const transcript = safeTranscript(
      transcriptValue || boundaryAssessment.transcript,
      '',
    );
    const textSegment = (source.speechSegments || []).find(segment => segment.id === boundaryAssessment.segmentId);
    const textQuality = assessRecognizedText({text:transcript, source:textSegment?.transcriptSource,
      confidence:textSegment?.transcriptConfidence});
    const preciseFactIssues=practicalPilot?practicalSourceFactIssues({segmentIndex:nativeSegment?.index,startSeconds:clip.startSeconds,rawText:transcript}):[];
    const verifiedCommercial=practicalPilot&&nativeFramePassed&&sourceVersionManaged(source)&&sourceSemanticPassed
      &&nativeSegment?.semanticReviewProof?.reviewResult?.checks?.commercialSupported===true&&await assertReviewCurrent();
    const commercialRulePassed=Boolean(transcript)&&preciseFactIssues.length===0
      &&(!COMMERCIAL_REVIEW_PATTERN.test(transcript)||verifiedCommercial);
    const durationMatches = Boolean(
      media && Math.abs(media.duration - clip.durationSeconds) <= 0.8,
    );
    const requireAudioContent = options.requireAudioContent === true;
    const sourceSilence = sourceSilenceStatsForClip(clip, source);
    const audioContentPassed = !requireAudioContent || sourceSilence.passed;
    const verticalOutput = Boolean(
      media &&
      media.width === REMIX_CONFIG.width &&
      media.height === REMIX_CONFIG.height,
    );
    const checks = [
      {
        name: '文件可播放',
        passed: Boolean(media),
        detail: media
          ? `可读取，时长 ${number(media.duration)} 秒`
          : mediaError instanceof Error
            ? mediaError.message
            : '无法读取切片文件',
      },
      {
        name: '时长一致',
        passed: durationMatches,
        detail: durationMatches ? '实际时长与切点一致' : '实际时长与切点不一致',
      },
      {
        name: '竖版规格',
        passed: verticalOutput,
        detail: media
          ? `${media.width || 0}×${media.height || 0}`
          : '无法读取画面尺寸',
      },
      {
        name: '音轨',
        passed: Boolean(media?.hasAudio || !source.hasAudio),
        detail: media?.hasAudio
          ? '已检测到音轨'
          : source.hasAudio
            ? '源视频有音轨，但切片未检测到音轨'
            : '源视频本身无音轨，系统将按无音轨素材规则处理',
      },
      {
        name: '有效声音内容',
        passed: audioContentPassed,
        detail: !requireAudioContent
          ? '当前流程未要求保留原片声音'
          : !sourceSilence.audioAvailable
            ? '来源没有可用音轨，不能进入自动混剪'
            : sourceSilence.passed
              ? `当前切片连续静音 ${sourceSilence.silenceSeconds} 秒`
              : `当前切片连续静音 ${sourceSilence.silenceSeconds}/${sourceSilence.durationSeconds} 秒，超过自动混剪允许范围`,
      },
      {
        name: asrBoundaryRequired ? '已核验原生帧切点' : '整数秒切点',
        passed: boundaryGridPassed,
        detail: asrBoundaryRequired
          ? nativeFramePassed
            ? `起止为 ${clip.startSeconds}–${clip.endSeconds} 秒，ASR、SKU、原文件及切片摘要一致`
            : '原生帧切点缺少一致的ASR、SKU、边界或真实文件摘要，不退化为整数秒通过'
          : integerSecondPassed
            ? `起止为 ${clip.startSeconds}–${clip.endSeconds} 秒`
            : '起止时间未落在整数秒网格',
      },
      {
        name: '首尾无残留画面',
        passed: edgeScenePassed,
        detail: edgeScenePassed
          ? '首尾0.45秒内未检测到额外转场'
          : `首尾检测到 ${edgeSceneBoundaries.length} 个额外转场`,
      },
      ...boundaryAssessment.checks,
      ...(sourceVersionManaged(source) ? [{name:'正式版本与逐段内容依据',passed:sourceSemanticPassed,
        detail:sourceSemanticPassed?'同版本正式资料、原片及逐段真实审核回执一致':'版本或逐段审核回执缺失/变化，不能沿用历史通过状态'}] : []),
      {
        name: '口播文案',
        passed: textQuality.usable,
        detail: textQuality.usable ? '已保留可用识别文字' : '识别文字为空或基础质量不足，不能作为口播依据',
      },
      {
        name: '商业表述',
        passed: commercialRulePassed,
        detail: preciseFactIssues.length?preciseFactIssues.map(row=>row.description).join(' '):verifiedCommercial
          ? '当前逐段私有审核已核实商业事实；泛词命中不重复否决，具体交易承诺仍保留门禁'
          : COMMERCIAL_REVIEW_PATTERN.test(transcript)
          ? '检测到需核对的功效、价格或绝对化表述'
          : transcript
            ? '未命中规则风险词'
            : '无文案可供规则检查',
      },
      ...(adjustmentError
        ? [
            {
              name: '边界自动修正',
              passed: false,
              detail: adjustmentError,
            },
          ]
        : []),
    ];
    const criticalPassed = checks.slice(0, 4).every((check) => check.passed);
    const boundaryPassed =
      boundaryAssessment.status === 'passed' &&
      boundaryGridPassed &&
      edgeScenePassed &&
      !adjustmentError;
    const contentApprovalInherited = options.inheritContentApproval === true && !sourceVersionManaged(source);
    const rulePassed =
      contentApprovalInherited ||
      commercialRulePassed;
    const status = !criticalPassed || textQuality.status === 'noise'
      ? 'failed'
      : boundaryPassed && rulePassed && audioContentPassed && sourceSemanticPassed
        ? 'passed'
        : 'review_required';
    const assessedAt = nowIso();
    const assessment = {
      status,
      recommendation:
        status === 'failed'
          ? 'reject'
          : status === 'passed'
            ? 'approve'
            : 'manual_review',
      score: Math.round(
        (checks.filter((check) => check.passed).length / checks.length) * 100,
      ),
      mode: 'rules',
      textQuality,
      contentApprovalInherited,
      autoApproved: false,
      autoAdjusted,
      boundaryIntegrity: {
        status: boundaryAssessment.status === 'passed' && !boundaryGridPassed ? 'review_required' : boundaryAssessment.status,
        segmentId: boundaryAssessment.segmentId,
        score: boundaryAssessment.score,
        autoAdjusted,
        gridRule: asrBoundaryRequired ? ASR_FRAME_RULE : 'integer-second',
        gridPassed: boundaryGridPassed,
        nativeFrameAligned: nativeFramePassed,
        sourceSha256: nativeFramePassed ? source.contentSha256 : null,
      },
      checks,
      reasons: checks
        .filter((check) => !check.passed)
        .map((check) => `${check.name}：${check.detail}`),
      assessedAt,
    };
    if(sourceVersionManaged(source) && sourceSemanticPassed && !(await verifySourceSegmentProof(source,nativeSegment,
      cacheRecoveryGuard||practicalPilot?assertReviewCurrent:undefined,options.trustedJobId)))
      throw Error('切片审核保存前正式版本或真实回执已变化，未自动通过。');
    if(practicalPilot&&!(await assertReviewCurrent()))throw Error('试点切片审核保存前任务、权限或依据变化，未写入审核。');
    if(cacheRecoveryGuard&&!(await cacheRecoveryGuard.assertCurrent()))throw Error('缓存物化技术审核保存前任务或原回执变化，未写入审核。');
    if(cacheRecoveryGuard&&await hashFile(path.join(clipsDir,clip.storedName))!==clip.contentSha256)
      throw Error('缓存物化技术审核保存前切片文件变化，未写入审核。');
    return updateLibrary((latest) => {
      const current = getClip(latest, clipId);
      if (!current) throw new Error('自动质检保存时切片记录已失效。');
      if(practicalPilot&&!pilotStateCurrent(latest))throw Error('试点切片审核提交前当前任务或切片变化，未覆盖原记录。');
      if(cacheRecoveryGuard&&(!cacheRecoveryGuard.isActiveInLibrary(latest)||JSON.stringify(current)!==JSON.stringify(clip)))
        throw Error('缓存物化技术审核提交前任务、权限或切片变化，未覆盖原记录。');
      if (clipIsBlocked(current)) return current;
      if (nativeFramePassed && (JSON.stringify(getSource(latest, source.id)) !== JSON.stringify(source) ||
        ['storedName', 'contentSha256', 'sourceId', 'startSeconds', 'endSeconds', 'durationSeconds', 'boundaryEvidence']
          .some(key => JSON.stringify(current[key]) !== JSON.stringify(clip[key]))))
        throw new Error('原生帧质检期间来源或切片证据已变化，未应用本次审核。');
      current.automaticAssessment = assessment;
      if(sourceVersionManaged(source) && sourceSemanticPassed && assessment.status==='passed'){
        const sku=currentSourceContexts.get(source.id);
        current.skuVersion=sku.skuVersion;
        current.semanticReviewProof=nativeSegment.semanticReviewProof;
        if(sku.mode===LEGACY_MODE) current.legacySourceEvidence={mode:LEGACY_MODE,sourceScope:structuredClone(sku.sourceScope),
          bindingSha256:sku.bindingSha256,profileSha256:sku.profileSha256,clipSha256:current.contentSha256,
          startSeconds:current.startSeconds,endSeconds:current.endSeconds};
        else {
          current.productVersionEvidence={schema:CLIP_VERSION_SCHEMA,skuVersion:sku.skuVersion,sourceId:source.id,
            sourceSha256:source.contentSha256,bindingSha256:sku.bindingSha256,profileSha256:sku.profileSha256,
            referenceSetSha256:sku.referenceSetSha256,clipSha256:current.contentSha256,startSeconds:current.startSeconds,endSeconds:current.endSeconds};
          delete current.legacySourceEvidence;
        }
      }
      if (
        options.autoApprove &&
        assessment.status === 'passed' &&
        current.reviewStatus !== 'approved'
      ) {
        current.reviewStatus = 'approved';
        current.reviewNote = autoAdjusted
          ? '系统自动修正切点并审核通过：内容边界完整，未带入相邻内容。'
          : '系统自动审核通过：内容边界完整，未带入相邻内容。';
        current.reviewedAt = assessedAt;
        current.automaticAssessment.autoApproved = true;
      } else if (
        options.autoReject &&
        assessment.status !== 'passed' &&
        current.reviewStatus !== 'approved'
      ) {
        current.reviewStatus = 'changes_requested';
        current.reviewNote = `系统自动退回并换片：${assessment.reasons.join(' ')}`;
        current.reviewedAt = assessedAt;
      }
      return current;
    });
  };

  const effectiveMaterialCenterImportStatus = async (
    assetIdValue,
    accessContext,
  ) => {
    const assetId = Number(assetIdValue);
    if (!Number.isInteger(assetId) || assetId <= 0) {
      throw new Error('素材中心素材 ID 无效。');
    }
    const library = await readLibrary();
    const source = library.sources.find(
      (item) => item.materialCenterAssetId === assetId,
    );
    const clips = library.clips.filter(
      (clip) =>
        Number(clip.approvalProvenance?.materialCenterAssetId) === assetId,
    );
    const approvedCount = clips.filter(
      (clip) => clip.reviewStatus === 'approved',
    ).length;
    const technicalAttentionCount = clips.length - approvedCount;
    return {
      assetId,
      state: !source
        ? 'not_imported'
        : !clips.length
          ? 'source_imported'
          : technicalAttentionCount
            ? 'technical_attention'
            : 'approved',
      source: source ? publicSourceRecordForUser(source, accessContext) : null,
      clips: clips.map((clip) =>
        publicClipRecord(clip, accessContext, library.folders, library),
      ),
      clipCount: clips.length,
      approvedCount,
      technicalAttentionCount,
      contentReviewInherited: clips.length > 0,
      updatedAt:
        clips
          .map((clip) => clip.reviewedAt || clip.createdAt)
          .filter(Boolean)
          .sort()
          .at(-1) ||
        source?.materialCenterImportedAt ||
        null,
    };
  };

  const importEffectiveMaterialCenterClips = async (
    assetIdValue,
    accessContext,
  ) => {
    if (!materialCenter?.configured) {
      throw new Error('素材中心双向接口尚未配置。');
    }
    const assetId = Number(assetIdValue);
    if (!Number.isInteger(assetId) || assetId <= 0) {
      throw new Error('素材中心素材 ID 无效。');
    }
    const importKey = String(assetId);
    const existingPromise = effectiveImportPromises.get(importKey);
    if (existingPromise) return existingPromise;

    const operation = (async () => {
      const asset = await materialCenter.getAsset(assetId);
      if (!asset.effective) {
        throw new Error(
          '只有云管家真实标记的“有效一创素材”才能免二次内容审核入库。',
        );
      }
      if (asset.isDeleted) {
        throw new Error('该有效素材已进入回收或删除状态，不能加入切片库。');
      }
      if (asset.libraryType !== 'source') {
        throw new Error('只有原始有效一创素材可以直接加入切片库。');
      }
      const productCategory = workstationProductCategoryForMaterialCenter(
        asset.category,
      );
      if (
        !productCategory ||
        ['待分类', '其他 WIS 素材'].includes(asset.category)
      ) {
        throw new Error(
          '请先在云管家把素材分类为“通用”或具体产品，再加入切片库。',
        );
      }

      let source = await importMaterialCenterSource(asset.id, accessContext, {
        ensurePreview: false,
      });
      source = await updateLibrary((library) => {
        const current = getSource(library, source.id);
        if (!current) throw new Error('有效素材导入后来源记录已失效。');
        current.productCategory = productCategory;
        current.materialCenterEffective = true;
        current.materialCenterEffectiveMarkedAt = asset.effectiveMarkedAt;
        current.materialCenterEffectiveImportedAt = nowIso();
        return current;
      });

      let candidates;
      if (source.durationSeconds <= 20) {
        const existingFullSegment = (source.speechSegments || []).find(
          (segment) =>
            Math.abs(Number(segment.startSeconds)) < 0.05 &&
            Math.abs(Number(segment.endSeconds) - source.durationSeconds) < 0.1,
        );
        const fullSegment = existingFullSegment || {
          id: `effective-full-${asset.id}`,
          index: 1,
          label: safeLabel(
            path.basename(asset.filename, path.extname(asset.filename)),
            '完整有效素材',
          ),
          clipName: safeLabel(
            path.basename(asset.filename, path.extname(asset.filename)),
            '完整有效素材',
          ),
          startSeconds: 0,
          endSeconds: source.durationSeconds,
          durationSeconds: source.durationSeconds,
          boundaryType: 'source',
          transcriptSource: 'manual',
          boundaryConfidence: 'high',
          requiresReview: false,
          reviewReasons: [],
          sceneBoundaryAligned: true,
        };
        if (!existingFullSegment) {
          source = await updateLibrary((library) => {
            const current = getSource(library, source.id);
            if (!current) throw new Error('有效素材边界登记时来源记录已失效。');
            current.speechSegments = [
              ...(Array.isArray(current.speechSegments)
                ? current.speechSegments
                : []),
              fullSegment,
            ];
            return current;
          });
        }
        candidates = [
          {
            ...fullSegment,
            suggestedRole:
              [...roleHintsForAsset(asset)][0] ||
              suggestedRoleForSegment(fullSegment, 0, 1).role,
          },
        ];
      } else {
        if (
          source.analysisStatus !== 'ready' ||
          !Array.isArray(source.speechSegments) ||
          !source.speechSegments.length
        ) {
          source = await analyzeSource(source.id);
        }
        candidates = calibrateSourceSegments(source);
      }
      if (!candidates.length) {
        throw new Error('未识别到可形成完整内容段的切点，未写入切片库。');
      }

      const results = [];
      for (const [index, segment] of candidates.entries()) {
        const idempotencyKey = [
          'material-center-effective',
          asset.id,
          number(segment.startSeconds).toFixed(2),
          number(segment.endSeconds).toFixed(2),
        ].join(':');
        const clip = await createClip(
          {
            sourceId: source.id,
            startSeconds: segment.startSeconds,
            endSeconds: segment.endSeconds,
            role:
              segment.suggestedRole ||
              suggestedRoleForSegment(segment, index, candidates.length).role,
            ...generatedClipNaming(source, segment),
            tags: [...(asset.tags || []), '云管家有效一创'],
            productCategory,
            importIdempotencyKey: idempotencyKey,
            approvalSource: 'material_center_effective',
            approvalProvenance: {
              materialCenterAssetId: asset.id,
              materialCenterObjectKey: asset.objectKey,
              effectiveMarkedAt: asset.effectiveMarkedAt,
              contentReview: 'inherited',
              technicalReview: 'automatic',
            },
          },
          accessContext,
        );
        const assessed = await assessClipAutomatically(clip.id, segment.label, {
          autoAdjustBoundary: true,
          autoApprove: true,
          inheritContentApproval: true,
          requireAudioContent: true,
        });
        if (assessed.reviewStatus !== 'approved') {
          await updateLibrary((library) => {
            const current = getClip(library, assessed.id);
            if (!current) return null;
            current.reviewStatus = 'changes_requested';
            current.reviewNote =
              '已继承云管家有效一创内容审核；自动技术检查发现画面、音轨或内容边界需处理。';
            current.reviewedAt = nowIso();
            return current;
          });
        }
        results.push(assessed.id);
      }
      return effectiveMaterialCenterImportStatus(asset.id, accessContext);
    })();
    effectiveImportPromises.set(importKey, operation);
    try {
      return await operation;
    } finally {
      effectiveImportPromises.delete(importKey);
    }
  };

  const clipReviewBatches = createClipReviewBatches({
    directory: path.join(root, 'clip-review-batches'), readLibrary, updateLibrary,
    verify: async (clip, source, identity) => {
      let file = path.join(clipsDir, clip.storedName);
      if (await missingMedia(file)) file = (await playbackRecovery.clip({clip,source,identity,purpose:'render'})).path;
      await verifyManualApprovalFile({filePath:file,expectedSha256:clip.contentSha256,inspectMedia,hashFile});
    },
    apply: (library, clip, payload, identity) => applyClipReview(library, clip, payload, identity),
    publicClip: (clip, identity, library) => publicClipRecord(clip, {sub:identity.id,name:identity.name}, library.folders.filter(f=>f.createdById===identity.id), library),
  });
  const updateClipReview = async (clipId, payload, context) => {
    const snapshot = await readLibrary(), prior = getClip(snapshot, clipId);
    if (!canReadClip(prior, getSource(snapshot, prior?.sourceId), accessIdentity(context))) throw new Error('切片不存在或无权审核。');
    if (payload.reviewStatus === 'approved') {
      if (clipIsBlocked(prior)) throw new Error('已禁用的切片不能直接批量通过。');
      let file = path.join(clipsDir, prior.storedName);
      if (await missingMedia(file)) file = (await playbackRecovery.clip({ clip: prior, source: getSource(snapshot, prior.sourceId), identity: accessIdentity(context), purpose: 'render' })).path;
      await verifyManualApprovalFile({ filePath: file, expectedSha256: prior.contentSha256, inspectMedia, hashFile });
    }
    return updateLibrary((library) => {
      const clip = getClip(library, clipId);
      if (!clip) throw new Error('未找到该切片。');
      if (!canReadClip(clip, getSource(library, clip.sourceId), accessIdentity(context))
        || ['storedName', 'contentSha256', 'sourceId', 'startSeconds', 'endSeconds', 'reviewedAt'].some(key => clip[key] !== prior[key])
        || (payload.reviewStatus === 'approved' && clipIsBlocked(clip)))
        throw new Error('核验期间切片或权限发生变化，请刷新后重新审核。');
      if (
        !['pending', 'approved', 'changes_requested'].includes(
          payload.reviewStatus,
        )
      ) {
        throw new Error('审核状态无效。');
      }
      applyClipReview(library, clip, payload, accessIdentity(context));
      delete clip.reviewBatchKey;
      return clip;
    });
  };

  const applyClipReview = (library, clip, payload, identity) => {
      clip.reviewStatus = payload.reviewStatus;
      clip.reviewNote = safeLabel(payload.reviewNote, '');
      clip.reviewedAt = nowIso();
      clip.reviewedBy = identity;
      if (clipIsBlocked(clip)) {
        const blockedIds = new Set();
        for (const related of library.clips) {
          if (
            related.sourceId === clip.sourceId &&
            related.startSeconds < clip.endSeconds &&
            related.endSeconds > clip.startSeconds
          ) {
            related.deliveryBlocked = true;
            related.deliveryBlockReason = clip.reviewNote;
            related.reviewStatus = 'changes_requested';
            blockedIds.add(related.id);
          }
        }
        for (const render of library.renders) {
          for (const variant of render.variants) {
            const ids =
              variant.clipSequence || Object.values(variant.slotMapping || {});
            if (ids.some((id) => blockedIds.has(id))) {
              variant.reviewStatus = 'changes_requested';
              variant.reviewNote = `引用片段存在卡审/违规记录：${clip.reviewNote}；禁止继续回传和推送。`;
            }
          }
        }
      }
      return clip;
  };

  const assessOutputFileAutomatically = async ({
    filePath,
    expectedDuration,
    targetDuration,
    clipSequence,
    activeSlotCount,
    frameworkSlotCount,
    includeUsageDisclaimer,
    usageDisclaimerText,
    existingHashes,
    clips,
    productCategory,
    library,
    automationRunId,
    outputReviewPolicy = null,
    deferVisualReview = false,
    bindingFingerprint,
    reviewAllowed = async () => true,
  }) => {
    let media = null;
    let mediaError = null;
    try {
      media = await inspectMedia(filePath);
    } catch (error) {
      mediaError = error;
    }
    let blackSeconds = 0;
    let silenceSeconds = 0;
    if (media) {
      try {
        const args = [
          '-hide_banner',
          '-i',
          filePath,
          '-vf',
          'blackdetect=d=1:pic_th=0.98',
        ];
        if (media.hasAudio) {
          args.push('-af', 'silencedetect=noise=-45dB:d=2');
        }
        args.push('-f', 'null', '-');
        const detection = await runProcess(ffmpegPath, args, {
          timeoutMs: 180000,
        });
        blackSeconds = [
          ...String(detection.stderr || '').matchAll(
            /black_duration:([\d.]+)/gu,
          ),
        ].reduce((total, match) => total + Number(match[1] || 0), 0);
        silenceSeconds = [
          ...String(detection.stderr || '').matchAll(
            /silence_duration:\s*([\d.]+)/gu,
          ),
        ].reduce((total, match) => total + Number(match[1] || 0), 0);
      } catch {
        blackSeconds = Number.POSITIVE_INFINITY;
        silenceSeconds = Number.POSITIVE_INFINITY;
      }
    }
    const sha256 = media ? await hashFile(filePath) : '';
    const durationMatches = Boolean(
      media && Math.abs(media.duration - expectedDuration) <= 1.2,
    );
    const verticalOutput = Boolean(
      media &&
      media.width === REMIX_CONFIG.width &&
      media.height === REMIX_CONFIG.height,
    );
    const blackPassed = Boolean(
      media && blackSeconds <= Math.max(2, media.duration * 0.2),
    );
    const silencePassed = Boolean(
      media &&
      media.hasAudio &&
      silenceSeconds <= Math.max(3, media.duration * 0.35),
    );
    const structurePassed = activeSlotCount === frameworkSlotCount;
    const duplicatePassed = Boolean(sha256 && !existingHashes.has(sha256));
    const targetTolerance = Math.max(3, Number(targetDuration || 0) * 0.08);
    const targetDurationMatches = Boolean(
      media &&
      (!targetDuration ||
        Math.abs(media.duration - targetDuration) <= targetTolerance),
    );
    const sequenceUnique = !hasRepeatedClips(clips.map(clip => ({ ...clip, sourceContentSha256: getSource(library, clip.sourceId)?.contentSha256 || null })));
    const clipCount = Array.isArray(clipSequence) ? clipSequence.length : 0;
    const maxClipCount = autoRemixMaxClipCount(
      targetDuration || expectedDuration,
      frameworkSlotCount,
    );
    const clipCountPassed = clipCount > 0 && clipCount <= maxClipCount;
    const approvedSourceClips = Boolean(
      Array.isArray(clips) &&
      clips.length &&
      clips.every((clip) => clip?.reviewStatus === 'approved'),
    );
    const categoryIntegrity = Boolean(
      Array.isArray(clips) &&
      clips.length &&
      clips.every((clip) => {
        const category = clipProductCategory(clip, library);
        return (
          category === productCategory || category === GENERAL_CLIP_CATEGORY
        );
      }),
    );
    const boundaryIntegrity = Boolean(
      Array.isArray(clips) &&
      clips.length &&
      clips.every(
        (clip) =>
          clip.automaticAssessment?.boundaryIntegrity?.status === 'passed' ||
          clip.approvalSource === 'material_center_effective' ||
          (clip.reviewStatus === 'approved' && Boolean(clip.reviewedAt)),
      ),
    );
    const dramaPlacement = Boolean(
      Array.isArray(clips) &&
      clips.every(
        (clip, index) => index === 0 || !isDramaPerformanceClip(clip, library),
      ),
    );
    const checks = [
      {
        name: '文件可播放',
        passed: Boolean(media),
        detail: media
          ? `可读取，时长 ${number(media.duration)} 秒`
          : mediaError instanceof Error
            ? mediaError.message
            : '无法读取成片',
      },
      {
        name: '竖版规格',
        passed: verticalOutput,
        detail: media
          ? `${media.width || 0}×${media.height || 0}`
          : '无法读取画面尺寸',
      },
      {
        name: '音轨',
        passed: Boolean(media?.hasAudio),
        detail: media?.hasAudio ? '已检测到音轨' : '未检测到音轨',
      },
      {
        name: '时长完整',
        passed: durationMatches,
        detail: durationMatches ? '成片时长与切片合计一致' : '成片时长异常',
      },
      {
        name: '黑屏占比',
        passed: blackPassed,
        detail: Number.isFinite(blackSeconds)
          ? `检测到 ${number(blackSeconds)} 秒黑屏`
          : '黑屏检测未完成',
      },
      {
        name: '目标时长',
        passed: targetDurationMatches,
        detail: targetDuration
          ? `目标 ${targetDuration} 秒，实际 ${number(media?.duration || 0)} 秒，允许完整切片误差 ${number(targetTolerance)} 秒`
          : '未指定目标时长',
      },
      {
        name: '静音占比',
        passed: silencePassed,
        detail: Number.isFinite(silenceSeconds)
          ? `检测到 ${number(silenceSeconds)} 秒连续静音`
          : '静音检测未完成',
      },
      {
        name: '框架完整度',
        passed: structurePassed,
        detail: `覆盖 ${activeSlotCount}/${frameworkSlotCount} 个框架位`,
      },
      {
        name: '警示语配置',
        passed: includeUsageDisclaimer,
        detail: includeUsageDisclaimer
          ? `已按配置叠加“${usageDisclaimerText}”`
          : '未启用警示语，系统将阻断自动审核通过',
      },
      {
        name: '剪辑节奏',
        passed: clipCountPassed,
        detail: clipCountPassed
          ? `使用 ${clipCount} 条完整切片，未超过 ${maxClipCount} 条质量上限`
          : `使用 ${clipCount} 条切片，超过 ${maxClipCount} 条质量上限，画面过碎`,
      },
      {
        name: '重复成片',
        passed: duplicatePassed,
        detail: duplicatePassed
          ? '未发现相同文件哈希'
          : '发现重复或无法计算哈希',
      },
      {
        name: '切片不重复',
        passed: sequenceUnique,
        detail: sequenceUnique
          ? '同一成片内未重复使用切片'
          : '同一成片内存在重复切片',
      },
      {
        name: '来源切片审核',
        passed: approvedSourceClips,
        detail: approvedSourceClips
          ? '所有来源切片均已审核通过'
          : '存在未经审核通过的来源切片',
      },
      {
        name: '产品分类一致',
        passed: categoryIntegrity,
        detail: categoryIntegrity
          ? `仅使用“${productCategory}”与通用切片`
          : '发现跨产品切片，禁止自动通过',
      },
      {
        name: '内容边界完整',
        passed: boundaryIntegrity,
        detail: boundaryIntegrity
          ? '所有切片均有完整语义边界或继承有效素材审核'
          : '存在可能多画面、少画面或语义未闭合的切片',
      },
      {
        name: '剧情演绎位置',
        passed: dramaPlacement,
        detail: dramaPlacement
          ? '剧情演绎仅出现在开头或本片未使用剧情演绎'
          : '剧情演绎出现在视频中段，禁止自动通过',
      },
    ];
    const basicReview=Boolean(automationRunId&&outputReviewPolicy===BASIC_REVIEW_POLICY);
    if (basicReview) {
      for(let index=checks.length-1;index>=0;index--)if(!BASIC_OUTPUT_CHECKS.includes(checks[index].name))checks.splice(index,1);
    }
    const criticalPassed = checks.slice(0, 4).every((check) => check.passed);
    let visualReview = null;
    if (automationRunId && !basicReview && outputReviewPolicy!==HISTORICAL_OUTPUT_RULES_POLICY) {
      visualReview = !(await reviewAllowed())
        ? {status:'review_required',reason:'automation_stopped',summary:'任务已暂停或权限已撤回；已完成文件保留，未发起新的内容审核请求。'}
        : deferVisualReview
        ? {status:'review_required',reason:'batch_preparing',summary:'等待同原批两条成片全部完成技术核验后，分别进行内容复核。'}
        : checks.every(check => check.passed)
        ? await visualQuality.assess({filePath,sha256,product:productCategory,
            timeline:visualTimeline(clips,library.sources || []),runId:automationRunId,bindingFingerprint,assertCurrent:reviewAllowed})
        : {status:'review_required',reason:'technical_prerequisite',summary:'技术检查未通过，修复后再进行内容复核。'};
      checks.push({name:'成片内容复核',passed:hasPassedVisualReview({visualReview},sha256),detail:visualReview.summary});
    }
    const allPassed = checks.every((check) => check.passed);
    const status = !criticalPassed
      ? 'failed'
      : allPassed
        ? 'passed'
        : basicReview ? 'failed' : 'review_required';
    const failedChecks = checks.filter((check) => !check.passed);
    const suggestions = failedChecks.map((check) => {
      const suggestionByName = {
        文件可播放: '重新转码后再生成，确保输出为 H.264/AAC MP4。',
        竖版规格: '统一转为 1080×1920 竖版后重新审核。',
        音轨: '补齐或修复音轨，避免无声成片。',
        时长完整: '重新拼接完整切片，排查丢帧或提前截断。',
        黑屏占比: '替换黑屏切片或收紧无效画面边界。',
        目标时长: '优先替换为更接近目标时长的完整切片，不截断句子。',
        静音占比: '替换长静音片段或修复原始音轨。',
        框架完整度: '补齐缺失的框架位后重新混剪。',
        警示语配置: `填写并启用全程警示语后重新生成。`,
        剪辑节奏: '减少一秒碎片，优先使用内容完整的较长切片后重新组合。',
        重复成片: '更换开头和至少一个核心切片，避免同批重复。',
        切片不重复: '移除同一成片内重复使用的切片。',
        来源切片审核: '只使用审核通过的切片重新生成。',
        产品分类一致: '移除跨产品切片，仅保留目标产品与通用切片。',
        内容边界完整: '重新校准切片起止点，保证一段内容和画面完整。',
        剧情演绎位置: '将剧情演绎移到首段，或替换为非剧情中段切片。',
      };
      return suggestionByName[check.name] || `修复“${check.name}”后重新审核。`;
    });
    return {
      sha256,
      assessment: {
        status,
        recommendation:
          status === 'failed'
            ? 'reject'
            : status === 'passed'
              ? 'approve'
              : 'manual_review',
        score: Math.round(
          (checks.filter((check) => check.passed).length / checks.length) * 100,
        ),
        mode: basicReview ? 'basic_rules' : automationRunId && outputReviewPolicy!==HISTORICAL_OUTPUT_RULES_POLICY ? 'rules_and_visual' : 'rules',
        ...(basicReview?{ruleVersion:BASIC_REVIEW_POLICY,outputSha256:sha256}:{}),
        ...(outputReviewPolicy===HISTORICAL_OUTPUT_RULES_POLICY?{ruleVersion:HISTORICAL_OUTPUT_RULES_POLICY,outputSha256:sha256}:{}),
        ...(visualReview ? {visualReview} : {}),
        checks,
        reasons: failedChecks.map((check) => `${check.name}：${check.detail}`),
        suggestions,
        assessedAt: nowIso(),
      },
    };
  };

  const targetDurationClipSequence = ({
    activeSlots,
    selections,
    slotMapping,
    library,
    targetDurationSeconds,
    automationMode = false,
    openingSlotId = '',
    clipWeights = {},
  }) => {
    if(automationMode&&targetDurationSeconds){
      const preferredDuration=activeSlots.reduce((n,slot)=>n+Number(getClip(library,slotMapping[slot.id])?.durationSeconds||0),0);
      if(preferredDuration>targetDurationSeconds+Math.max(3,targetDurationSeconds*.08)){
        const balanced=chooseDurationBase({slots:activeSlots.map(slot=>({id:slot.id,clips:(selections[slot.id]||[]).map(id=>getClip(library,id)).filter(c=>c&&(slot.id===openingSlotId||!isDramaPerformanceClip(c,library)))})),target:targetDurationSeconds,openingSlotId,preferred:slotMapping,weights:clipWeights});
        if(balanced)slotMapping=balanced;
      }
    }
    if(automationMode&&targetDurationSeconds){
      const unique=uniqueDurationCandidates({slots:activeSlots,selections,slotMapping,openingSlotId,
        closingSlotIds:activeSlots.filter(slot=>slotRoleIds(slot).has('cta')).map(slot=>slot.id),
        clips:[...new Set(activeSlots.flatMap(slot=>selections[slot.id]||[]))]
          .map(id=>getClip(library,id)).filter(Boolean)
          .map(clip=>({...clip,sourceContentSha256:getSource(library,clip.sourceId)?.contentSha256||null}))});
      if(!unique.complete)return {slotMapping:{},clips:[],clipSequence:[],actualDurationSeconds:0};
      slotMapping=unique.slotMapping;selections=unique.selections;
    }
    const usedClipIds = new Set();
    const clipsBySlot = new Map();
    const normalizedSlotMapping = {};
    let totalDuration = 0;

    for (const slot of activeSlots) {
      const preferredId = slotMapping[slot.id];
      const candidateIds = selections[slot.id] || [];
      const baseId =
        [preferredId, ...candidateIds].find(
          (clipId) => clipId && !usedClipIds.has(clipId),
        ) || preferredId;
      const clip = getClip(library, baseId);
      if (!clip) continue;
      normalizedSlotMapping[slot.id] = clip.id;
      clipsBySlot.set(slot.id, [clip]);
      usedClipIds.add(clip.id);
      totalDuration += clip.durationSeconds;
    }

    const remaining = activeSlots.flatMap((slot, slotIndex) =>
      (selections[slot.id] || [])
        .filter((clipId) => !usedClipIds.has(clipId))
        .map((clipId) => ({
          slot,
          slotIndex,
          clip: getClip(library, clipId),
        }))
        .filter(
          (item) =>
            item.clip &&
            (!automationMode ||
              (item.slot.id !== openingSlotId &&
                !isDramaPerformanceClip(item.clip, library))),
        ),
    );
    const tolerance = Math.max(3, targetDurationSeconds * 0.08);
    const maxClipCount = autoRemixMaxClipCount(
      targetDurationSeconds,
      activeSlots.length,
    );
    if (remaining.length && totalDuration < targetDurationSeconds - tolerance) {
      const selectedItems = selectDurationBalancedItems({
        items: remaining,
        currentDurationSeconds: totalDuration,
        targetDurationSeconds,
        toleranceSeconds: tolerance,
        clipWeights,
        maxItemCount: Math.max(0, maxClipCount - usedClipIds.size),
      });
      for (const selected of selectedItems) {
        if (usedClipIds.has(selected.clip.id)) continue;
        clipsBySlot.get(selected.slot.id).push(selected.clip);
        usedClipIds.add(selected.clip.id);
        totalDuration += selected.clip.durationSeconds;
      }
    }

    const unorderedClips = activeSlots.flatMap((slot) => clipsBySlot.get(slot.id) || []);
    const legacySource=getSource(library,unorderedClips[0]?.sourceId);
    const clips=automationMode&&hasLegacySourcePointer(legacySource)
      ?orderLegacyDurationClipGroups({slots:activeSlots,clipsBySlot,openingSlotId,legacySourceId:legacySource.id})
      :unorderedClips;
    return {
      slotMapping: normalizedSlotMapping,
      clips,
      clipSequence: clips.map((clip) => clip.id),
      actualDurationSeconds: number(
        clips.reduce((total, clip) => total + clip.durationSeconds, 0),
      ),
    };
  };

  const automationContextAllowed = async context => {
    if (!context) return true;
    const latest = await readLibrary();
    const job = latest.autoJobs.find(item => item.id === context.jobId);
    return Boolean(job && job.status === 'active' && !job.archivedAt &&
      ownerCanUseAutomation(latest,job) && job.createdById === context.createdById &&
      job.runs.some(run => run.id === context.runId));
  };

  const renderVariants = (
    payload,
    automationContext = null,
    accessContext = null,
  ) => {
    const operation = renderQueue.then(async () => {
      if (!(await automationContextAllowed(automationContext)))
        throw Object.assign(new Error('任务已暂停或权限已撤回；未开始新的渲染。'),{code:'AUTOMATION_STOPPED'});
      // Freeze the evidence actually used by this render before any media/model
      // await. The shared library cache is mutable while background work runs.
      const library = structuredClone(await readLibrary());
      const hashRenderInput = createRenderInputHashes(hashFile);
      const baseFramework = getFramework(
        library,
        String(payload.frameworkId || STORY_TEMPLATE.id),
      );
      if (
        !canReadFramework(library, baseFramework, accessIdentity(accessContext))
      )
        throw new Error('所选框架不存在或无权访问。');
      const framework = payload.frameworkDraft
        ? workspaceFrameworkFromPayload(baseFramework, payload.frameworkDraft)
        : baseFramework;
      const rawSelections =
        payload.slotSelections && typeof payload.slotSelections === 'object'
          ? payload.slotSelections
          : payload.slots && typeof payload.slots === 'object'
            ? payload.slots
            : {};
      const selections = Object.fromEntries(
        framework.slots.map((slot) => {
          const rawValue = rawSelections[slot.id];
          const clipIds = (
            Array.isArray(rawValue)
              ? rawValue
              : rawValue === undefined || rawValue === null
                ? []
                : [rawValue]
          )
            .map((value) => String(value).trim())
            .filter((value) => Boolean(value))
            .sort(
              (left, right) =>
                Number(automationContext?.clipWeights?.[right] || 1) -
                Number(automationContext?.clipWeights?.[left] || 1),
            )
            .slice(0, automationContext ? AUTO_REMIX_MAX_DAILY_OUTPUTS : 15);
          return [slot.id, clipIds];
        }),
      );
      const activeSlots = framework.slots.filter(
        (slot) => selections[slot.id].length,
      );
      if (!activeSlots.length) {
        throw new Error('请至少选择一个切片后再生成。');
      }
      if (activeSlots.length !== framework.slots.length) {
        throw new Error('框架存在未填充的分组，请补齐切片或明确删除不需要的分组。选片已保留。');
      }
      if (!automationContext && Object.values(rawSelections).some(ids => Array.isArray(ids) && ids.length > 15))
        throw new Error('每个框架组最多可放15个候选切片，未截断您的选择。');
      const selectedIds = activeSlots.flatMap((slot) => selections[slot.id]);
      const selectedClips = selectedIds.map((id) => { const clip = getClip(library, id); return clip ? { ...clip, sourceContentSha256: getSource(library, clip.sourceId)?.contentSha256 || null } : null; });
      if (selectedClips.some((clip) => !clip))
        throw new Error('存在已失效切片，请刷新后重试。');
      if (
        selectedClips.some(
          (clip) =>
            !canReadClip(
              clip,
              getSource(library, clip.sourceId),
              accessIdentity(accessContext),
            ) || clipIsBlocked(clip),
        )
      ) {
        throw new Error('所选切片不可访问或已被审核驳回，请换片。');
      }
      if (selectedClips.some((clip) => clip.reviewStatus !== 'approved')) {
        throw new Error('只有审核通过的切片才能生成成片。');
      }
      if(!automationContext&&selectedClips.some(clip=>!clipSourceReviewScopeAllows(clip,getSource(library,clip.sourceId),automationContext?.jobId)))
        throw Object.assign(new Error('所选切片含仅限原测试任务的来源审核证据，当前任务或人工混剪不能借用。'),{code:'SOURCE_REVIEW_SCOPE_MISMATCH'});
      const productCategory = safeLabel(
        payload.productCategory,
        automationContext?.productCategory || '',
      );
      if (!productCategory || productCategory === GENERAL_CLIP_CATEGORY) {
        throw new Error('请选择本次混剪要生成的具体产品。');
      }
      const selectedProductCategories = selectedClips.map((clip) =>
        clipProductCategory(clip, library),
      );
      if (selectedProductCategories.some((category) => !category)) {
        throw new Error('所选切片缺少产品品类，请先在切片库补充后再生成。');
      }
      if (
        selectedProductCategories.some(
          (category) =>
            category !== productCategory && category !== GENERAL_CLIP_CATEGORY,
        )
      ) {
        throw new Error(
          `本次目标为“${productCategory}”，只能使用该产品切片与通用切片。`,
        );
      }
      const existingOutputHashes = new Set(
        library.renders.flatMap((render) =>
          render.variants
            .map((variant) => String(variant.contentSha256 || ''))
            .filter(Boolean),
        ),
      );
      // Approval mode is not sequence identity: switching to manual review may
      // not release the same job's interrupted or already generated content.
      const sequenceDedupEnabled=Boolean(automationContext)&&productCategory==='黑晶面膜';
      const historicalRules=historicalInventoryEnabled(automationContext);
      const historicalJob=historicalRules?library.autoJobs.find(job=>job.id===automationContext.jobId):null;
      const actualCutHashes=new Map();
      if(sequenceDedupEnabled&&!historicalRules&&selectedClips.some(clip=>!getSource(library,clip.sourceId)?.contentSha256)){
        for(const clip of selectedClips){
          if(!(await automationContextAllowed(automationContext)))throw Object.assign(Error('任务已暂停，未继续选片'),{code:'AUTOMATION_STOPPED'});
          // Planning may use the recorded identity. Only the cuts actually
          // selected below are byte-verified before any durable reservation.
          if (/^[a-f0-9]{64}$/i.test(clip.contentSha256 || '')) {
            actualCutHashes.set(clip.id, clip.contentSha256);
            continue;
          }
          let file=path.join(clipsDir,clip.storedName);
          if(await missingMedia(file))file=(await playbackRecovery.clip({clip,source:getSource(library,clip.sourceId),identity:accessIdentity(accessContext),purpose:'render'})).path;
          const hash=await hashRenderInput(file);
          if(clip.contentSha256&&clip.contentSha256!==hash)throw Error('切片文件版本已变化');
          actualCutHashes.set(clip.id,hash);
        }
      }
      const sequenceFor=clips=>historicalRules?historicalCandidateSequence(clips.map(clip=>historicalApprovedInventory.planningAssess({
        clip,source:getSource(library,clip.sourceId),job:historicalJob,identity:{id:automationContext.createdById},canReadSource,canReadClip
      }))):(sourceIntervalSequence(clips,library.sources)||clipBytesSequence(clips.map(clip=>({...clip,contentSha256:actualCutHashes.get(clip.id)}))));
      const sequenceHistory=sequenceDedupEnabled
        ?assertNoPendingSequence(library,automationContext.jobId,automationContext.runId):null;
      if(historicalRules)for(const sequence of historicalApprovedInventory.historicalOutputSequences())sequenceHistory.keys.add(sequence.key);
      const holdOutput=(variant,result)=>historicalRules?holdHistoricalRulesOutput(variant,result):applyBatchOutputReview(variant,result);
      let sequenceSearch=null;
      if (
        automationContext?.productCategory &&
        automationContext.productCategory !== productCategory
      ) {
        throw new Error('自动任务的产品品类与切片不一致，已停止生成。');
      }
      const rawShotAliases =
        payload.shotAliases && typeof payload.shotAliases === 'object'
          ? payload.shotAliases
          : {};
      const shotAliases = Object.fromEntries(
        activeSlots
          .map((slot) => {
            const slotAliases =
              rawShotAliases[slot.id] &&
              typeof rawShotAliases[slot.id] === 'object'
                ? rawShotAliases[slot.id]
                : {};
            const aliases = Object.fromEntries(
              selections[slot.id]
                .map((clipId) => [clipId, safeLabel(slotAliases[clipId], '')])
                .filter(([, alias]) => Boolean(alias)),
            );
            return [slot.id, aliases];
          })
          .filter(([, aliases]) => Object.keys(aliases).length),
      );
      const combinationCount = activeSlots.reduce(
        (total, slot) => total * selections[slot.id].length,
        1,
      );
      const requestedOutputs = Math.min(100, Math.max(1, Math.trunc(Number(payload.maxOutputs) || 3)));
      const openingSlot = activeSlots[0];
      const existingRunVariants = automationContext
        ? library.renders
            .filter(
              (render) =>
                render.automation?.jobId === automationContext.jobId &&
                render.automation?.runId === automationContext.runId,
            )
            .flatMap((render) => render.variants)
        : [];
      const usedOpenerClipIds = new Set(
        existingRunVariants
          .filter((variant) => variant.reviewStatus === 'approved' || replacementEligible(variant))
          .map(
            (variant) =>
              variant.clipSequence?.[0] ||
              variant.slotMapping?.[openingSlot?.id] ||
              '',
          )
          .filter(Boolean),
      );
      const availableOpeners = automationContext
        ? sourceDiverseClips(
            selections[openingSlot.id]
              .map((clipId) => getClip(library, clipId))
              .filter((clip) => clip && !usedOpenerClipIds.has(clip.id)),
          )
        : [];
      const availableCombinationCount = automationContext
        ? availableOpeners.length
        : combinationCount;
      const maxOutputs = Math.min(
        availableCombinationCount,
        Math.max(1, requestedOutputs),
      );
      if (automationContext && maxOutputs < 1) {
        throw new Error(
          `本批剩余不同开头只有 ${availableOpeners.length} 条，无法继续生成 ${Math.max(
            1,
            requestedOutputs,
          )} 条成片。`,
        );
      }
      const includeUsageDisclaimer = Boolean(payload.includeUsageDisclaimer);
      const usageDisclaimerText = includeUsageDisclaimer
        ? normalizeUsageDisclaimerText(payload.usageDisclaimerText)
        : '';
      const targetDurationSeconds =
        payload.targetDurationSeconds === undefined ||
        payload.targetDurationSeconds === null
          ? null
          : normalizeAutoRemixDuration(payload.targetDurationSeconds);
      const combinationOffset = Math.max(
        0,
        Math.trunc(Number(automationContext?.combinationOffset) || 0),
      );
      const combinations = Array.from({ length: automationContext ? availableOpeners.length : maxOutputs }, (_, index) => {
        let cursor = (combinationOffset + index) % combinationCount;
        const combination = {};
        for (
          let slotIndex = activeSlots.length - 1;
          slotIndex >= 0;
          slotIndex -= 1
        ) {
          const slot = activeSlots[slotIndex];
          const clipIds = selections[slot.id];
          if (automationContext && slot.id === openingSlot.id) {
            combination[slot.id] = availableOpeners[index].id;
          } else {
            combination[slot.id] = clipIds[cursor % clipIds.length];
            cursor = Math.floor(cursor / clipIds.length);
          }
        }
        return combination;
      });
      const manualPlans = new Map();
      const explicitCounts = activeSlots.some(slot => Number(slot.takeCount) > 1);
      if (!automationContext || explicitCounts) {
        const presetSelections = automationContext ? { ...selections, [openingSlot.id]: availableOpeners.map(clip => clip.id) } : selections;
        const planned = planCombinations(activeSlots, presetSelections, {
          limit: automationContext ? 100 : requestedOutputs, strategy: payload.combinationStrategy || 'diverse',
          unique: payload.uniqueClips !== false, clips: selectedClips,
        });
        if (automationContext && targetDurationSeconds) {
          planned.plans = planned.plans.filter(plan => Math.abs(plan.clipSequence.reduce((sum, id) => sum + getClip(library, id).durationSeconds, 0) - targetDurationSeconds) <= Math.max(3, targetDurationSeconds * .08)).slice(0, requestedOutputs);
          if (!planned.plans.length) throw Object.assign(new Error('按每组取用数量暂时不能组成目标时长，已保留原批次，自动补充合适片段。'), { code: 'SOURCE_DURATION_GAP' });
        }
        if (!planned.plans.length) throw new Error('没有完整且不重复的组合，请补充候选或调整每组取用数量；选片已保留。');
        combinations.splice(0, combinations.length, ...planned.plans.map(plan => {
          const clips = plan.clipSequence.map(id => getClip(library, id));
          manualPlans.set(plan.slotMapping, { ...plan, clips,
            actualDurationSeconds: number(clips.reduce((sum, clip) => sum + clip.durationSeconds, 0)) });
          return plan.slotMapping;
        }));
      }
      const durationPlans=new Map();
      if(automationContext&&targetDurationSeconds&&!explicitCounts){
        const feasible=[];
        const makeDurationPlan=mapping=>targetDurationClipSequence({activeSlots,selections,slotMapping:mapping,library,targetDurationSeconds,automationMode:true,openingSlotId:openingSlot.id,clipWeights:automationContext.clipWeights||{}});
        const validDurationPlan=plan=>!hasRepeatedClips(plan.clips.map(clip=>({...clip,sourceContentSha256:getSource(library,clip.sourceId)?.contentSha256||null})))&&Math.abs(plan.actualDurationSeconds-targetDurationSeconds)<=Math.max(3,targetDurationSeconds*.08);
        if(sequenceDedupEnabled){
          sequenceSearch=findUnseenDurationPlans({openingIds:availableOpeners.map(clip=>clip.id),limit:maxOutputs,
            initialOffset:combinationOffset,combinationCount:combinationCount/selections[openingSlot.id].length,
            usedKeys:sequenceHistory.keys,planAt:makeDurationPlan,isFeasible:validDurationPlan,
            sequenceAt:plan=>sequenceFor(plan.clips),
            mappingAt:(opener,offset)=>{
              let cursor=offset;const mapping={};
              for(let slotIndex=activeSlots.length-1;slotIndex>=0;slotIndex--){const slot=activeSlots[slotIndex],ids=selections[slot.id];
                if(slot.id===openingSlot.id)mapping[slot.id]=opener;
                else {mapping[slot.id]=ids[cursor%ids.length];cursor=Math.floor(cursor/ids.length);}}
              return mapping;
            }});
          for(const item of sequenceSearch.plans){durationPlans.set(item.mapping,item.plan);feasible.push(item.mapping);}
          if(!feasible.length&&sequenceSearch.reason!=='SOURCE_DURATION_GAP'){
            const messages={OUTPUT_SEQUENCE_SEARCH_LIMIT:'已完成本轮有上限的真实序列检查，暂未找到未生成的新组合；保留已完成成片与本批，不重复渲染或扩大来源。',
              OUTPUT_SEQUENCE_EXHAUSTED:'当前可用开头与定长组合的真实来源序列已用完；已合格成片保留，未重复渲染、送审或扩大来源。',
              SOURCE_EVIDENCE_MISSING:'候选组合缺少可信的来源哈希或区间，未生成无法预排重的成片。'};
            const {plans:ignored,...details}=sequenceSearch;
            throw Object.assign(new Error(messages[sequenceSearch.reason]),{code:sequenceSearch.reason,sequencePreflight:details,
              ...(sequenceSearch.reason==='SOURCE_EVIDENCE_MISSING'?{admission:{reason:'source_sequence_unverifiable'}}:{})});
          }
        }else for(const mapping of combinations){const plan=makeDurationPlan(mapping);if(validDurationPlan(plan)){durationPlans.set(mapping,plan);feasible.push(mapping);if(feasible.length>=maxOutputs)break;}}
        if(!feasible.length){const error=new Error('现有完整切片无法匹配目标时长，已保留原批次，等待补充合适片段后续跑。');error.code='SOURCE_DURATION_GAP';throw error;}
        combinations.splice(0,combinations.length,...feasible);
      }else if(automationContext&&!explicitCounts)combinations.splice(maxOutputs);
      const renderId = randomUUID();
      const name = automationContext
        ? safeLabel(
            `自动混剪-${productCategory}-${framework.name}-${automationContext.dateKey || shanghaiDateKey()}`,
            `自动混剪-${productCategory}`,
          )
        : safeLabel(payload.name, framework.name);
      const outputNumberOffset = Math.max(
        0,
        Math.trunc(Number(automationContext?.outputNumberOffset) || 0),
      );
      const variants = [];
      let pairReview = false;
      const pairInputs = [];
      const plannedSequences = combinations.map(baseSlotMapping =>
        manualPlans.get(baseSlotMapping) || durationPlans.get(baseSlotMapping) || (targetDurationSeconds
          ? targetDurationClipSequence({
              activeSlots,
              selections,
              slotMapping: baseSlotMapping,
              library,
              targetDurationSeconds,
              automationMode: Boolean(automationContext),
              openingSlotId: openingSlot.id,
              clipWeights: automationContext?.clipWeights || {},
            })
          : {
              slotMapping: baseSlotMapping,
              clips: activeSlots.map((slot) =>
                getClip(library, baseSlotMapping[slot.id]),
              ),
              clipSequence: activeSlots.map((slot) => baseSlotMapping[slot.id]),
              actualDurationSeconds: number(
                activeSlots.reduce(
                  (total, slot) =>
                    total +
                    getClip(library, baseSlotMapping[slot.id]).durationSeconds,
                  0,
                ),
              ),
            }));
      if(sequenceDedupEnabled){
        const seen=new Set(sequenceHistory.keys);
        for(let index=0;index<plannedSequences.length;){
          const sequence=sequenceFor(plannedSequences[index].clips);
          if(!sequence)throw Object.assign(new Error('候选成片来源哈希或区间不可核验，未渲染或送审。'),{code:'SOURCE_EVIDENCE_MISSING',admission:{reason:'source_sequence_unverifiable'}});
          if(seen.has(sequence.key)){plannedSequences.splice(index,1);combinations.splice(index,1);continue;}
          seen.add(sequence.key);index++;
        }
        if(!plannedSequences.length)throw Object.assign(new Error('当前候选真实来源序列均已生成或预占，已保存结果保留；未重复渲染或扩大来源。'),
          {code:'OUTPUT_SEQUENCE_EXHAUSTED',sequencePreflight:{checked:sequenceSearch?.checked||0,sourceExpansion:false}});
      }
      // Pick the review transport before sending anything. A long pair uses
      // separate complete reviews rather than truncating coverage or becoming
      // stuck behind the batch provider's twelve-image ceiling.
      pairReview = false;
      // Automatic tasks use existing approved cuts and current files. Formal SKU,
      // ASR semantic proofs and unused whole originals are not basic prerequisites.
      // verifyBasicInputFiles hashes the actual selected cuts before and after render.
      const originalSourcePaths = new Map();
      for (let index = 0; index < combinations.length; index += 1) {
        if (!(await automationContextAllowed(automationContext))) break;
        const baseSlotMapping = combinations[index];
        const sequence = plannedSequences[index];
        const { slotMapping, clips, clipSequence, actualDurationSeconds } =
          sequence;
        const historicalVerified=historicalRules?await verifyHistoricalInputs(clips,library,automationContext):null;
        const historicalInput=historicalVerified?{mode:historicalVerified.mode,referenceSha256:historicalVerified.referenceSha256,evidence:historicalVerified.evidence}:null;
        const contentSequence=sequenceDedupEnabled?(historicalRules?historicalInventorySequence(historicalInput.evidence):sequenceFor(clips)):null;
        if(historicalRules&&(!contentSequence||contentSequence.key!==sequenceFor(clips)?.key))
          throw Object.assign(new Error('历史选片候选与本次实测文件区间不一致，未渲染。'),{code:'SOURCE_EVIDENCE_MISSING'});
        if (automationContext) {
          if (clipSequence[0] !== baseSlotMapping[openingSlot.id]) {
            throw new Error('自动混剪开头位置校验失败，已停止生成。');
          }
          const misplacedDramaClip = clips.find(
            (clip, clipIndex) =>
              clipIndex > 0 && isDramaPerformanceClip(clip, library),
          );
          if (misplacedDramaClip) {
            throw new Error(
              `剧情演绎切片“${misplacedDramaClip.name}”只能放在视频开头，已停止生成。`,
            );
          }
        }
        const manifestPath = path.join(
          outputsDir,
          `${renderId}-${index + 1}.txt`,
        );
        const storedName = `${renderId}-${index + 1}.mp4`;
        // The preview cache must also support production rendering. Rebuild only
        // the selected missing cuts, using their verified source and original
        // boundaries with the same normalization as newly created clips.
        const resolvedInputs=historicalRules?historicalVerified.resolvedInputs:[];
        for(const clip of historicalRules?[]:clips) {
          if (!(await automationContextAllowed(automationContext))) break;
          const original=path.join(clipsDir,clip.storedName);
          if(await missingMedia(original)) {
            const recovered=await playbackRecovery.clip({clip,source:getSource(library,clip.sourceId),
              identity:accessIdentity(accessContext),purpose:'render'});
            resolvedInputs.push({clipId:clip.id,...recovered});
          } else {
            const expectedHash = clip.contentSha256 || actualCutHashes.get(clip.id);
            if (expectedHash && await hashRenderInput(original) !== expectedHash)
              throw new Error('切片文件版本与原记录不一致，已保留选片，请重新核验该切片：' + clip.name);
            resolvedInputs.push({clipId:clip.id,path:original,kind:'original-clip'});
          }
        }
        if(sequenceDedupEnabled){
          if(!(await automationContextAllowed(automationContext)))break;
          const frozenBinding=outputBinding(clips,library.sources,productCategory);
          await updateLibrary(latest=>{
            const job=latest.autoJobs.find(item=>item.id===automationContext.jobId);
            if(!job||!ownerCanUseAutomation(latest,job)||job.createdById!==automationContext.createdById)
              throw Object.assign(new Error('任务权限已撤回，未预占或渲染。'),{code:'AUTOMATION_STOPPED'});
            const currentClips=clipSequence.map(id=>getClip(latest,id));
            if(historicalRules&&!historicalInventoryInputCurrent(historicalInput,{clips:currentClips,sources:latest.sources,job,runId:automationContext.runId}))
              throw Object.assign(new Error('历史选片当前批准或授权已变化，未预占或渲染。'),{code:'SOURCE_EVIDENCE_MISSING'});
            if(currentClips.some(clip=>!clip)||outputBinding(currentClips,latest.sources,productCategory).content!==frozenBinding.content||
              outputBinding(currentClips,latest.sources,productCategory).review!==frozenBinding.review)
              throw Object.assign(new Error('序列预占前来源或审核依据已变化，保留原任务。'),{code:'SOURCE_EVIDENCE_MISSING',admission:{reason:'source_binding_changed'}});
            if(progressiveSourceJobIds.has(job.id)&&progressiveOutputUsage(latest,job).attempts>=PROGRESSIVE_OUTPUT_ATTEMPT_LIMIT)
              throw Object.assign(new Error('本任务累计生成尝试已达上限，未新增渲染预占。'),{code:'PROGRESSIVE_ATTEMPT_LIMIT'});
            reserveOutputSequence(latest,{jobId:automationContext.jobId,runId:automationContext.runId,renderId,variantId:String(index+1),sequence:contentSequence,at:nowIso()});
            if(job.progressiveSourcePreparation)job.progressiveSourcePreparation.attemptedFloor=progressiveOutputUsage(latest,job).attempts;
          });
        }
        if(automationContext)for(const input of resolvedInputs)input.basicSha256=await hashRenderInput(input.path);
        await fs.writeFile(
          manifestPath,
          resolvedInputs
            .map(
              (input) => `file '${filePathForConcat(input.path)}'`,
            )
            .join('\n') + '\n',
          'utf8',
        );
        try {
          const ffmpegArgs = ['-f', 'concat', '-safe', '0', '-i', manifestPath];
          if (includeUsageDisclaimer) {
            ffmpegArgs.push(
              '-vf',
              `drawtext=fontfile='${escapeDrawTextValue(cjkFontFile)}':text='${escapeDrawTextValue(usageDisclaimerText)}':expansion=none:fontcolor=white@0.92:fontsize=32:box=1:boxcolor=black@0.38:boxborderw=5:x=(w-text_w)/2:y=h-text_h-${USAGE_DISCLAIMER_BOTTOM_MARGIN}`,
            );
          }
          ffmpegArgs.push(
            '-c:v',
            'libx264',
            '-preset',
            'veryfast',
            '-crf',
            '22',
            '-pix_fmt',
            'yuv420p',
            '-c:a',
            'aac',
            '-ar',
            '48000',
            '-b:a',
            '192k',
            '-movflags',
            '+faststart',
            path.join(outputsDir, storedName),
          );
          if (!(await automationContextAllowed(automationContext))) break;
          await runFfmpeg(ffmpegArgs);
        } finally {
          await fs.rm(manifestPath, { force: true });
        }
        const expectedDuration = clips.reduce(
          (total, clip) => total + clip.durationSeconds,
          0,
        );
        const outputAssessment = await assessOutputFileAutomatically({
          filePath: path.join(outputsDir, storedName),
          expectedDuration,
          targetDuration: targetDurationSeconds,
          clipSequence,
          activeSlotCount: activeSlots.length,
          frameworkSlotCount: framework.slots.length,
          includeUsageDisclaimer,
          usageDisclaimerText,
          existingHashes: existingOutputHashes,
          clips,
          productCategory,
          library,
          automationRunId: automationContext?.autoApproveOutputs === true ? automationContext.runId : undefined,
          outputReviewPolicy: automationContext?.autoApproveOutputs===true?BASIC_REVIEW_POLICY:null,
          bindingFingerprint: automationContext?.autoApproveOutputs === true ? outputBinding(clips,library.sources,productCategory).review : undefined,
          deferVisualReview: pairReview,
          reviewAllowed: async () => {
            if (!(await automationContextAllowed(automationContext))) return false;
            if(historicalRules)await verifyHistoricalInputs(clips,library,automationContext,historicalInput);
            else if (automationContext?.autoApproveOutputs === true && !(await automationContextAllowed(automationContext))) return false;
            return true;
          },
        });
        if(pairReview)pairInputs.push(batchOutputInput({outputId:`${renderId}/${index+1}`,filePath:path.join(outputsDir,storedName),assessment:outputAssessment,clips,sources:library.sources||[],sourcePath:source=>originalSourcePaths.get(source.id),trustedJobId:automationContext?.jobId}));
        if (outputAssessment.sha256) {
          existingOutputHashes.add(outputAssessment.sha256);
        }
        const targetDurationDelta = targetDurationSeconds
          ? Math.abs(actualDurationSeconds - targetDurationSeconds)
          : 0;
        const targetDurationPassed =
          !targetDurationSeconds ||
          targetDurationDelta <= Math.max(3, targetDurationSeconds * 0.08);
        const sequenceUnique =
          new Set(clipSequence).size === clipSequence.length;
        const autoApproved = Boolean(
          automationContext?.autoApproveOutputs === true && outputAssessment.assessment.status === 'passed',
        );
        const automaticallyRejected = Boolean(
          automationContext && outputAssessment.assessment.status !== 'passed',
        );
        const automaticReviewNote = autoApproved
          ? `基础审核通过：文件、画面、音轨、时长和组合完整，无需人工复核。`
          : automaticallyRejected
            ? `自动成片审核退回：${outputAssessment.assessment.suggestions.join(' ')}`
            : '';
        variants.push({
          id: String(index + 1),
          storedName,
          outputName: `${name}-${String(
            outputNumberOffset + index + 1,
          ).padStart(automationContext ? 3 : 2, '0')}.mp4`,
          slotMapping,
          clipSequence,
          skuVersion: [...new Set(clips.map(clip=>getSource(library,clip.sourceId)?.skuVersion).filter(Boolean))].length===1
            ? getSource(library,clips[0].sourceId)?.skuVersion : null,
          targetDurationSeconds: targetDurationSeconds || expectedDuration,
          generationBinding: outputBinding(clips, library.sources, productCategory),
          ...(contentSequence?{contentSequenceIdentity:contentSequence}:{}),
          reviewBinding: outputBinding(clips, library.sources, productCategory),
          recoveredInputs: resolvedInputs.filter(input=>input.kind!=='original-clip').map(input=>({clipId:input.clipId,kind:input.kind,cacheFile:path.basename(input.path)})),
          actualDurationSeconds,
          shotAliases,
          usageDisclaimerApplied: includeUsageDisclaimer,
          usageDisclaimerText,
          contentSha256: outputAssessment.sha256,
          ...(automationContext?{basicInputFiles:resolvedInputs.map(input=>({clipId:input.clipId,sha256:input.basicSha256}))}:{}),
          automaticAssessment: {
            ...outputAssessment.assessment,
            autoApproved,
          },
          ...(automationContext && automationContext.autoApproveOutputs !== true ? {reviewMode: 'manual_pending'} : {}),
          ...(historicalRules?{reviewMode:HISTORICAL_OUTPUT_REVIEW_MODE,historicalInventoryReview:createHistoricalRulesEvidence({input:historicalInput,
            jobId:automationContext.jobId,runId:automationContext.runId,outputSha256:outputAssessment.sha256,
            generationBinding:outputBinding(clips,library.sources,productCategory),reviewBinding:outputBinding(clips,library.sources,productCategory)})}:{}),
          ...(automationContext?.autoApproveOutputs===true?{reviewMode:BASIC_REVIEW_MODE}:{}),
          qualityAssessment: {
            score: Math.min(
              99,
              Math.round(
                62 +
                  (activeSlots.length / framework.slots.length) * 23 +
                  Math.min(
                    10,
                    clips.reduce(
                      (total, clip) => total + clip.durationSeconds,
                      0,
                    ) / 4,
                  ) -
                  Math.min(20, targetDurationDelta / 2) -
                  (sequenceUnique ? 0 : 15),
              ),
            ),
            level:
              activeSlots.length === framework.slots.length &&
              targetDurationPassed &&
              sequenceUnique
                ? 'recommended'
                : activeSlots.length >= Math.ceil(framework.slots.length / 2) &&
                    sequenceUnique
                  ? 'good'
                  : 'review',
            mode: 'rules',
            reasons: [
              `覆盖${activeSlots.length}/${framework.slots.length}个框架位`,
              '所有片段均已通过系统完整性审核',
              `成片总时长约${number(
                clips.reduce((total, clip) => total + clip.durationSeconds, 0),
              )}秒，已纳入结构评分`,
              targetDurationSeconds
                ? `目标${targetDurationSeconds}秒；保留完整切片后的实际时长约${actualDurationSeconds}秒`
                : '未指定目标成片时长',
              activeSlots.length === framework.slots.length
                ? '叙事结构完整'
                : '存在留空框架位，系统已阻断该成片进入回传',
            ],
          },
          reviewStatus: autoApproved
            ? 'approved'
            : automaticallyRejected
              ? 'changes_requested'
              : 'pending',
          reviewNote: automaticReviewNote,
          reviewedAt: autoApproved || automaticallyRejected ? nowIso() : null,
          createdAt: nowIso(),
        });
        // Persist each completed basic approval before starting the next output.
        // A crash mid-batch can then recover this exact file, never render it again.
        const completedVariant=variants.at(-1);
        if(sequenceDedupEnabled&&!historicalRules&&basicVariantPassed(completedVariant)){
          for(const input of resolvedInputs)if(await hashFile(input.path)!==input.basicSha256)throw Error('切片文件在审核期间变化，保留原成片等待核验');
          const originalJob=library.autoJobs.find(job=>job.id===automationContext.jobId),originalRun=originalJob?.runs.find(run=>run.id===automationContext.runId);
          if(originalJob&&originalRun)await persistRegistration({id:renderId,requestKey:null,visibility:'team',name,templateId:framework.id,generationMode:'automatic',
            createdById:automationContext.createdById,createdByName:automationContext.createdByName||'',productCategory,targetDurationSeconds,
            ...(productCategory==='黑晶面膜'?{sourceEvidencePolicy:SOURCE_EVIDENCE_POLICY}:{}),
            automation:{jobId:automationContext.jobId,runId:automationContext.runId},shotAliases,usageDisclaimerApplied:includeUsageDisclaimer,usageDisclaimerText,
            createdAt:completedVariant.createdAt,registrationContext:journalContext(originalJob,originalRun),variants:[completedVariant]});
        }
      }
      if(pairReview && pairInputs.length === 2 && await automationContextAllowed(automationContext)){
        for(const plan of plannedSequences) await assertCurrentVersionedClips(plan.clips,library,()=>automationContextAllowed(automationContext),automationContext.jobId);
        const skuVersions=new Set(pairInputs.flatMap(input=>input.sourceFiles.map(source=>source.skuVersion)));
        const skuVersion=skuVersions.size===1?[...skuVersions][0]:null;
        const batch=await visualQuality.assessBatch({runId:automationContext.runId,product:productCategory,skuVersion,outputs:pairInputs});
        for(const variant of variants)applyBatchOutputReview(variant,batch.results.find(result=>result.outputId===`${renderId}/${variant.id}`));
      }
      if (!(await automationContextAllowed(automationContext)))
        for (const variant of variants) holdOutput(variant,{sha256:variant.contentSha256,status:'review_required',reason:'automation_stopped',summary:'任务已暂停或权限已撤回；原成片保留，未继续审核或推送。'});
      if (!variants.length) throw Object.assign(new Error('任务已暂停或权限已撤回；未开始新的渲染。'),{code:'AUTOMATION_STOPPED'});
      // Single-output requests have the same before/after byte integrity gate
      // as batched review. Keep generated files, but never approve changed bytes.
      const changedSourceFiles = new Set();
      for (const [id,file] of originalSourcePaths) {
        try { if (await hashFile(file) !== getSource(library,id).contentSha256) changedSourceFiles.add(id); }
        catch { changedSourceFiles.add(id); }
      }
      for (const variant of variants) if (variant.clipSequence.some(id=>changedSourceFiles.has(getClip(library,id).sourceId)))
        applyBatchOutputReview(variant,{sha256:variant.contentSha256,status:'review_required',reason:'source_integrity',summary:'原来源文件在审核期间变化或不可读，原成片已保留，本条未自动放行。'});
      if (automationContext?.autoApproveOutputs === true) for (const variant of variants) {
        try {
          for(const input of variant.basicInputFiles||[]){
            const clip=getClip(library,input.clipId),file=path.join(clipsDir,clip.storedName);
            if(!(await missingMedia(file))&&await hashFile(file)!==input.sha256)throw Error('clip_file_changed');
          }
          if(historicalRules){
            await verifyHistoricalInputs(variant.clipSequence.map(id=>getClip(library,id)),library,automationContext,variant.historicalInventoryReview.input);
            if(await hashFile(path.join(outputsDir,variant.storedName))!==variant.contentSha256)throw Error('output_file_changed');
          }else if(!(await automationContextAllowed(automationContext)))throw Error('automation_stopped');
        }
        catch {holdOutput(variant,{sha256:variant.contentSha256,status:'review_required',reason:'source_version_changed',summary:'来源批准、当前文件或审核依据在处理期间变化，保留成片和原回执，未自动放行。'});}
      }
      return updateLibrary((latest) => {
        // An unused candidate changing cannot invalidate a different output.
        for (const variant of variants) {
          const currentJob = automationContext && latest.autoJobs.find(item=>item.id===automationContext.jobId);
          if (automationContext && (!currentJob || currentJob.status!=='active' || currentJob.archivedAt || !ownerCanUseAutomation(latest,currentJob))) {
            holdOutput(variant,{sha256:variant.contentSha256,status:'review_required',reason:'automation_stopped',summary:'任务已暂停或权限已撤回；原成片保留，未自动放行。'});
            continue;
          }
          if(historicalRules){
            const currentClips=variant.clipSequence.map(id=>getClip(latest,id));
            const currentBinding=currentClips.every(Boolean)&&outputBinding(currentClips,latest.sources,productCategory);
            if(!historicalInventoryInputCurrent(variant.historicalInventoryReview.input,{clips:currentClips,sources:latest.sources,job:currentJob,runId:automationContext.runId})
              ||!currentBinding||currentBinding.content!==variant.generationBinding.content||currentBinding.review!==variant.reviewBinding.review)
              holdOutput(variant,{reason:'source_binding_changed',summary:'历史切片批准或本次复用快照在保存前发生变化，未自动放行。'});
            continue;
          }
          const frozenClips = variant.clipSequence.map(id => getClip(library, id));
          const input = batchOutputInput({outputId:`${renderId}/${variant.id}`,filePath:path.join(outputsDir,variant.storedName),assessment:{sha256:variant.contentSha256,assessment:variant.automaticAssessment},clips:frozenClips,sources:library.sources,sourcePath:source=>path.join(sourcesDir,source.storedName),trustedJobId:automationContext?.jobId});
          if (compareBatchInputSnapshot([input], latest).changed) {
            applyBatchOutputReview(variant,{sha256:variant.contentSha256,status:'review_required',reason:'source_binding_changed',summary:'本条成片实际使用的切片、来源或审核依据在处理期间发生变化，原成片与回执已保留，等待重新核验。'});
          } else if (automationContext?.autoApproveOutputs === true && variant.reviewMode!==BASIC_REVIEW_MODE) {
            const admission = diagnoseBatchInputAdmission([input], latest, {product:productCategory,trustedJobId:automationContext.jobId});
            if (!admission.ready) applyBatchOutputReview(variant,{sha256:variant.contentSha256,status:'review_required',reason:admission.reason,summary:admission.summary});
          }
        }
        const creatorIdentity = automationContext?.createdById
          ? {
              id: automationContext.createdById,
              name: automationContext.createdByName || '',
            }
          : accessIdentity(accessContext);
        const privateRender = compositionVisibility(library, baseFramework, selectedClips, DEFAULT_FRAMEWORKS) === 'private';
        const savedFramework = payload.frameworkDraft
          ? persistWorkspaceFramework(latest, {
              ...framework,
              visibility: privateRender ? 'private' : 'team',
              createdById: creatorIdentity.id,
            })
          : getFramework(latest, framework.id);
        if (!savedFramework) {
          throw new Error('框架在保存成片前已失效，请重试。');
        }
        const creator = automationContext?.createdById
          ? {
              id: automationContext.createdById,
              name: automationContext.createdByName || '',
            }
          : accessIdentity(accessContext);
        const render = {
          id: renderId,
          requestKey: automationContext ? null : String(payload.requestKey || '').slice(0, 100),
          visibility: privateRender ? 'private' : 'team',
          name,
          templateId: savedFramework.id,
          generationMode: automationContext ? 'automatic' : 'manual',
          createdById: creator.id,
          createdByName: creator.name,
          productCategory,
          targetDurationSeconds: targetDurationSeconds || undefined,
          // New local automatic outputs retain their actual basic-review policy.
          // Existing output approvals and all admission checks remain unchanged.
          ...(process.env.LOCAL_SIMULATION==='1' && automationContext?.autoApproveOutputs===true && productCategory!=='黑晶面膜'
            ? {sourceEvidencePolicy:BASIC_REVIEW_POLICY} : {}),
          // Server-owned protocol marker; never read this from a request body.
          ...(automationContext && productCategory==='黑晶面膜'
            ? {sourceEvidencePolicy:historicalRules?HISTORICAL_OUTPUT_RULES_POLICY:SOURCE_EVIDENCE_POLICY} : {}),
          ...(automationContext?.jobId && automationContext?.runId
            ? {
                automation: {
                  jobId: automationContext.jobId,
                  runId: automationContext.runId,
                },
              }
            : {}),
          shotAliases,
          usageDisclaimerApplied: includeUsageDisclaimer,
          usageDisclaimerText,
          createdAt: nowIso(),
          variants,
        };
        if(sequenceDedupEnabled)for(const variant of variants)recordOutputSequence(latest,{
          jobId:automationContext.jobId,runId:automationContext.runId,renderId,variantId:variant.id,
          sequence:variant.contentSequenceIdentity,at:nowIso()});
        latest.renders.unshift(render);
        recordServiceEvent(latest,renderGeneratedEvent(render));
        return render;
      });
    });
    renderQueue = operation.catch(() => undefined);
    return operation;
  };

  const serveVideo = async (req, res, filePath, downloadName = null) => {
    const stat = await fs.stat(filePath);
    const range = req.headers.range;
    const headers = {
      'Content-Type': 'video/mp4',
      'Accept-Ranges': 'bytes',
      'Content-Disposition': `${downloadName ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(downloadName || path.basename(filePath))}`,
    };
    if (req.method === 'HEAD') {
      res.writeHead(200, { ...headers, 'Content-Length': stat.size });
      res.end();
      return;
    }
    if (!range) {
      res.writeHead(200, { ...headers, 'Content-Length': stat.size });
      await pipeFileToResponse(req, res, filePath);
      return;
    }
    const match = String(range).match(/^bytes=(\d*)-(\d*)$/);
    const suffixLength = !match?.[1] && match?.[2] ? Number(match[2]) : null;
    const start =
      suffixLength !== null
        ? Math.max(0, stat.size - suffixLength)
        : match?.[1]
          ? Number(match[1])
          : Number.NaN;
    const end =
      suffixLength !== null
        ? stat.size - 1
        : match?.[2]
          ? Math.min(Number(match[2]), stat.size - 1)
          : stat.size - 1;
    if (
      !match ||
      (suffixLength !== null && suffixLength <= 0) ||
      !Number.isFinite(start) ||
      start > end ||
      start >= stat.size
    ) {
      res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
      res.end();
      return;
    }
    res.writeHead(206, {
      ...headers,
      'Content-Length': end - start + 1,
      'Content-Range': `bytes ${start}-${end}/${stat.size}`,
    });
    await pipeFileToResponse(req, res, filePath, { start, end });
  };

  const updateRenderReview = async (renderId, variantId, payload, accessContext) => {
    const reviewNote = String(payload.reviewNote || '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim();
    if (reviewNote.length > 1000) throw new Error('复核说明最多 1000 字，请精简后重新提交。');
    const snapshot=ownedRender(await readLibrary(),renderId,accessContext);
    const prior=structuredClone(snapshot.variants.find(item=>item.id===variantId));
    if(!prior)throw new Error('未找到该成片审核项。');
    if(payload.reviewStatus==='approved')assertNoPlatformQuarantine(prior);
    const verifiedSha=payload.reviewStatus==='approved'
      ? await verifyManualApprovalFile({filePath:path.join(outputsDir,prior.storedName),expectedSha256:prior.contentSha256,inspectMedia,hashFile}) : null;
    return updateLibrary((library) => {
      const render = ownedRender(library, renderId, accessContext);
      const variant = render.variants.find((item) => item.id === variantId);
      if (!variant) throw new Error('未找到该成片审核项。');
      if (
        !['pending', 'approved', 'changes_requested'].includes(
          payload.reviewStatus,
        )
      ) {
        throw new Error('审核状态无效。');
      }
      if (payload.reviewStatus === 'approved') {
        assertNoPlatformQuarantine(variant);
        if (variant.automaticAssessment?.status === 'failed')
          throw new Error('此成片未通过技术或内容检查，请修复并重新检查后再审核通过。');
      }
      if (payload.reviewStatus === 'approved' && needsVisualAttention(variant) && !reviewNote)
        throw new Error('此成片存在内容复核疑点，请先检查画面和声音，并填写具体复核说明。');
      if(variant.storedName!==prior.storedName || variant.reviewedAt!==prior.reviewedAt || variant.contentSha256!==prior.contentSha256)
        throw new Error('此成片的审核状态已更新，请刷新原版本后再处理。');
      if(verifiedSha){variant.contentSha256=verifiedSha;variant.fileVerifiedAt=nowIso();}
      variant.reviewMode = 'human';
      variant.reviewedBy = accessIdentity(accessContext);
      if (variant.automaticAssessment) variant.automaticAssessment.autoApproved = false;
      variant.reviewStatus = payload.reviewStatus;
      variant.reviewNote = reviewNote;
      variant.reviewedAt = nowIso();
      return { render, variant };
    });
  };

  const returnVariantToMaterialCenter = async (
    renderId,
    variantId,
    accessContext,
  ) => {
    const library = await readLibrary();
    const render = ownedRender(library, renderId, accessContext);
    if (render.visibility === 'private')
      throw new Error(
        '此成片为私人可见（继承框架或切片范围），不可回传共享素材库；请使用团队框架和团队切片重新生成，可保留本片下载。',
      );
    const variant = render.variants.find((item) => item.id === variantId);
    if (!variant) throw new Error('未找到该成片。');
    assertNoPlatformQuarantine(variant);
    assertCurrentAutomaticReview(render, variant, library);
    const versionAdmission = await assertVariantVersionedSources(render,variant,library);
    if (!materialCenter?.configured) {
      throw new Error('素材中心双向接口尚未配置。');
    }
    if (variant.reviewStatus !== 'approved') {
      throw new Error('成片审核通过后才能回传素材中心。');
    }
    if (variant.automaticAssessment?.status === 'failed')
      throw new Error('此成片检查未通过，已暂停回传；请修复原版本并重新审核。');
    if (
      variant.materialCenterReturn?.status === 'completed' &&
      variant.materialCenterReturn.idempotencyKey
    ) {
      const readback = await materialCenter.getReturn(
        variant.materialCenterReturn.idempotencyKey,
      );
      if (readback.assetAvailable) return readback;
      throw new Error('该成片曾回传，但素材中心记录已进入回收站或不可用。');
    }

    const framework = getFramework(library, render.templateId);
    const clipIds = [
      ...new Set([
        ...(Array.isArray(variant.clipSequence) ? variant.clipSequence : []),
        ...Object.values(variant.slotMapping || {}),
      ]),
    ];
    const clips = clipIds
      .map((clipId) => getClip(library, clipId))
      .filter(Boolean);
    const sources = [
      ...new Map(
        clips
          .map((clip) => getSource(library, clip.sourceId))
          .filter(Boolean)
          .map((source) => [source.id, source]),
      ).values(),
    ];
    const sourceAssetIds = [
      ...new Set(
        sources
          .map((source) => Number(source.materialCenterAssetId || 0))
          .filter((assetId) => Number.isInteger(assetId) && assetId > 0),
      ),
    ];
    const sourceCategories = [
      ...new Set(
        sources
          .map((source) => String(source.materialCenterCategory || '').trim())
          .filter(Boolean),
      ),
    ];
    const outputPath = path.join(outputsDir, variant.storedName);
    const stat = await fs.stat(outputPath);
    const sha256 = await hashFile(outputPath);
    if (!variant.contentSha256)
      throw new Error('此历史成片尚未登记文件版本，请打开原成片重新审核后回传；本次未上传。');
    if (sha256 !== variant.contentSha256)
      throw new Error('成片文件与已审核版本不一致，请重新生成并审核；本次未回传。');
    const idempotencyKey =
      variant.materialCenterReturn?.idempotencyKey ||
      `wis-remix:${render.id}:${variant.id}:${sha256.slice(0, 16)}`;
    const attemptedAt = nowIso();

    try {
      const ticket = await materialCenter.createReturn({
        idempotency_key: idempotencyKey,
        filename: variant.outputName,
        size: stat.size,
        sha256,
        mime_type: 'video/mp4',
        category:
          materialCenterCategoryForProduct(render.productCategory) ||
          (sourceCategories.length === 1 ? sourceCategories[0] : '待分类'),
        content_type: '其他',
        asset_subtype: 'AI混剪成片',
        tags: [
          '二创混剪',
          'WIS混剪工作台',
          render.automation ? '全自动混剪' : 'AI混剪',
          render.automation ? '自动混剪' : '手动混剪',
          ...(render.productCategory ? [render.productCategory] : []),
          ...(versionAdmission?.skuVersion ? [`商品版本:${versionAdmission.skuVersion}`] : []),
          ...(variant.usageDisclaimerApplied ? ['全程警示语'] : []),
        ],
        source_asset_ids: sourceAssetIds,
        source_clip_ids: clipIds,
        framework_id: framework?.id || render.templateId,
        framework_name: framework?.name || render.templateId,
        render_id: render.id,
        variant_id: variant.id,
        maker_id: safeLabel(accessContext?.sub, 'feishu-user'),
        maker_name: safeLabel(accessContext?.name, '飞书工作台用户'),
        review_status: 'approved',
        review_note: variant.reviewNote || '',
        automatic_review_enabled: Boolean(
          render.automation && variant.automaticAssessment?.autoApproved,
        ),
        automatic_assessment: variant.automaticAssessment || {},
        ...(variant.reviewMode===BASIC_REVIEW_MODE ? {
          review_policy:BASIC_REVIEW_POLICY,
          automation_job_id:render.automation.jobId,
          automation_run_id:render.automation.runId,
        } : {}),
      });
      await assertVariantVersionedSources(render,variant,library);
      await materialCenter.uploadReturnFile(ticket, outputPath, stat.size);
      const beforeComplete = await readLibrary();
      const completionRender = beforeComplete.renders.find(item => item.id === renderId);
      const completionVariant = completionRender?.variants.find(item => item.id === variantId);
      if (!completionVariant || completionVariant.reviewStatus !== 'approved') throw new Error('上传期间成片审核状态变化，未完成共享入库。');
      assertCurrentAutomaticReview(completionRender, completionVariant, beforeComplete);
      await assertVariantVersionedSources(completionRender,completionVariant,beforeComplete);
      const completed = await materialCenter.completeReturn(idempotencyKey);
      await updateLibrary((latest) => {
        const latestRender = latest.renders.find(
          (item) => item.id === renderId,
        );
        const latestVariant = latestRender?.variants.find(
          (item) => item.id === variantId,
        );
        if (!latestVariant) throw new Error('回传完成后未找到本地成片记录。');
        latestVariant.materialCenterReturn = {
          status: completed.status,
          idempotencyKey,
          assetId: completed.assetId,
          assetAvailable: completed.assetAvailable,
          filename: completed.filename,
          completedAt: completed.completedAt,
          attemptedAt,
          errorMessage: '',
          retryCount: latestVariant.materialCenterReturn?.retryCount || 0,
          nextRetryAt: null,
        };
        return latestVariant.materialCenterReturn;
      });
      return completed;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : '成片回传素材中心失败。';
      await updateLibrary((latest) => {
        const latestRender = latest.renders.find(
          (item) => item.id === renderId,
        );
        const latestVariant = latestRender?.variants.find(
          (item) => item.id === variantId,
        );
        if (latestVariant) {
          const retryCount =
            (latestVariant.materialCenterReturn?.retryCount || 0) + 1;
          const retryDelay =
            AUTO_RETURN_RETRY_DELAYS_MS[
              Math.min(retryCount - 1, AUTO_RETURN_RETRY_DELAYS_MS.length - 1)
            ];
          latestVariant.materialCenterReturn = {
            status: 'failed',
            idempotencyKey,
            assetId: null,
            assetAvailable: false,
            filename: variant.outputName,
            completedAt: null,
            attemptedAt,
            errorMessage: safeLabel(errorMessage, '回传失败'),
            retryCount,
            nextRetryAt: shouldKeepRetryingExternalState(errorMessage)
              ? new Date(Date.now() + retryDelay).toISOString()
              : null,
          };
        }
      });
      throw error;
    }
  };

  const grantAutoRemixAccess = (payload, accessContext) =>
    updateLibrary((library) => {
      assertAutoRemixAccess(library, accessContext, { admin: true });
      const actor = accessIdentity(accessContext);
      const userId = safeLabel(payload.userId, '').toUpperCase();
      if (!userId) throw new Error('请填写需要授权同事的 OA 工号。');
      if (!/^[A-Z]{2}-\d{6}$/u.test(userId)) {
        throw new RemixAccessError(
          'OA 工号格式无效，请填写真实员工工号。',
          409,
        );
      }
      const verifiedIdentity = verifiedAutoRemixIdentityFor(library, userId);
      if (!verifiedIdentity) {
        throw new RemixAccessError(
          '该工号尚未完成 OA 身份登记，请让同事先登录一次二创混剪工作台。',
          409,
        );
      }
      const userName = verifiedIdentity.userName;
      const timestamp = nowIso();
      const existing = library.autoRemixGrants.find(
        (grant) =>
          normalizedIdentityValue(grant.userId) ===
          normalizedIdentityValue(userId),
      );
      if (existing) {
        existing.userName = userName;
        existing.grantedAt = timestamp;
        existing.grantedById = actor.id;
        existing.grantedByName = actor.name;
        existing.verifiedAt = verifiedIdentity.verifiedAt;
        existing.verificationSource = verifiedIdentity.source;
      } else {
        library.autoRemixGrants.unshift({
          userId,
          userName,
          grantedAt: timestamp,
          grantedById: actor.id,
          grantedByName: actor.name,
          verifiedAt: verifiedIdentity.verifiedAt,
          verificationSource: verifiedIdentity.source,
        });
      }
      library.accessAudit.unshift({
        id: randomUUID(),
        action: 'grant',
        userId,
        userName,
        actorId: actor.id,
        actorName: actor.name,
        createdAt: timestamp,
      });
      library.accessAudit = library.accessAudit.slice(
        0,
        AUTO_REMIX_ACCESS_AUDIT_LIMIT,
      );
      return autoRemixAccessState(library, accessContext);
    });

  const revokeAutoRemixAccess = (userIdValue, accessContext) =>
    updateLibrary((library) => {
      assertAutoRemixAccess(library, accessContext, { admin: true });
      const actor = accessIdentity(accessContext);
      const userId = safeLabel(userIdValue, '');
      const index = library.autoRemixGrants.findIndex(
        (grant) =>
          normalizedIdentityValue(grant.userId) ===
          normalizedIdentityValue(userId),
      );
      if (index < 0) throw new Error('未找到该同事的自动混剪授权。');
      const [removed] = library.autoRemixGrants.splice(index, 1);
      for (const job of library.autoJobs) {
        if (
          normalizedIdentityValue(job.createdById) ===
          normalizedIdentityValue(removed.userId)
        ) {
          job.status = 'paused';
          job.nextRunAt = null;
          job.updatedAt = nowIso();
        }
      }
      library.accessAudit.unshift({
        id: randomUUID(),
        action: 'revoke',
        userId: removed.userId,
        userName: removed.userName,
        actorId: actor.id,
        actorName: actor.name,
        createdAt: nowIso(),
      });
      library.accessAudit = library.accessAudit.slice(
        0,
        AUTO_REMIX_ACCESS_AUDIT_LIMIT,
      );
      return autoRemixAccessState(library, accessContext);
    });

  const readOwnedAutoJob = async (jobId, accessContext) => {
    const library = await readLibrary();
    assertAutoRemixAccess(library, accessContext);
    const identity = accessIdentity(accessContext);
    const job = library.autoJobs.find(
      (item) =>
        item.id === jobId &&
        !item.archivedAt &&
        autoJobBelongsToIdentity(item, identity),
    );
    if (!job) throw new Error('未找到该自动混剪任务。');
    return publicAutoJob(job, library);
  };

  const patchRunStageReport = (run, stageKey, patch) => {
    run.stageReports = normalizedAutomationStageReports(run.stageReports);
    const report = run.stageReports.find((item) => item.key === stageKey);
    if (!report) throw new Error(`自动流水线阶段不存在：${stageKey}`);
    Object.assign(report, patch);
    if (
      patch.status === 'running' ||
      patch.processedCount !== undefined ||
      patch.currentItem !== undefined
    ) {
      report.lastProgressAt = nowIso();
    }
    if (report.startedAt) {
      const startedAtMs = Date.parse(report.startedAt);
      if (Number.isFinite(startedAtMs)) {
        report.elapsedSeconds = Math.max(
          0,
          Math.round(
            ((report.completedAt
              ? Date.parse(report.completedAt)
              : Date.now()) -
              startedAtMs) /
              1000,
          ),
        );
      }
    }
    if (
      report.completedAt ||
      ['completed', 'blocked', 'failed'].includes(report.status)
    ) {
      report.currentItem = '';
    }
    if (Array.isArray(patch.evidence)) {
      report.evidence = patch.evidence.map(String).filter(Boolean).slice(0, 20);
    }
    return report;
  };

  const updateAutoRunStage = (jobId, runId, stageKey, patch) =>
    updateLibrary((library) => {
      const job = library.autoJobs.find((item) => item.id === jobId);
      const run = job?.runs.find((item) => item.id === runId);
      if (!job || !run) throw new Error('自动流水线批次已失效。');
      patchRunStageReport(run, stageKey, patch);
      job.updatedAt = nowIso();
      return run;
    });

  const materialCenterCandidatesForJob = async (
    job,
    library,
    requestedLimit = normalizedSourceSelectionLimit(job.sourceSelectionLimit),
  ) => {
    if (!materialCenter?.configured) return {items: [], issues: []};
    const selectionLimit = Math.max(
      0,
      Math.min(
        normalizedSourceSelectionLimit(job.sourceSelectionLimit),
        Math.trunc(Number(requestedLimit) || 0),
      ),
    );
    if (!selectionLimit) return {items: [], issues: []};
    const importedAssetIds = new Set(
      library.sources
        .map((source) => Number(source.materialCenterAssetId || 0))
        .filter((assetId) => assetId > 0),
    );
    const searchTerms = [
      job.productCategory,
      String(job.productCategory || '')
        .replace(/^WIS/u, '')
        .replace(/隐形|水润|紧致/gu, '')
        .trim(),
    ].filter(Boolean);
    const readiness = buildAutoReadiness(
      library,
      job.frameworkId,
      job.productCategory,
      job.dailyTarget,
      job.targetDurationSeconds,
      job.id,
    );
    const shortageByRole = new Map();
    for (const slot of readiness.slots) {
      for (const roleId of slot.roleIds || []) {
        shortageByRole.set(
          roleId,
          Math.max(
            shortageByRole.get(roleId) || 0,
            slot.missingCandidateCount || 0,
          ),
        );
      }
    }
    const materialCenterCategory = materialCenterCategoryForProduct(
      job.productCategory,
    );
    const selectors = materialCenterCategory
      ? [
          { category: materialCenterCategory },
          {
            category: materialCenterCategoryForProduct(GENERAL_CLIP_CATEGORY),
          },
        ]
      : [...new Set(searchTerms)].map((query) => ({ query }));
    const result = await collectSourceCandidates({
      listAssets: (request) => materialCenter.listAssets(request), selectors, limit: selectionLimit,
      eligible: (asset) => !importedAssetIds.has(asset.id) && isEligibleSourceAsset(asset, job.productCategory),
      compare: (left, right) =>
          sourceAssetScore(
            right,
            importedAssetIds,
            shortageByRole,
            job.productCategory,
          ) -
            sourceAssetScore(
              left,
              importedAssetIds,
              shortageByRole,
              job.productCategory,
            ) ||
          String(right.modifiedAt || '').localeCompare(
            String(left.modifiedAt || ''),
          ),
    });
    return {...result, items: result.items.map(asset => ({...asset, autoRoleHints: [...roleHintsForAsset(asset)]}))};
  };

  const localSourcePreparationKey = source => createHash('sha256').update(JSON.stringify([
    source.storedName,source.contentSha256,source.size,sourceProductCategory(source),
    source.analysisStatus,source.analysisRuleVersion,source.speechSegments,
  ])).digest('hex');

  const localSourceCandidatesForJob = async (library,job,run,limit) => {
    const identity=accessIdentity({sub:job.createdById,name:job.createdByName});
    const candidates=library.sources.filter(source=>source.sourceType==='manual_upload'&&
      source.visibility!=='private'&&canReadSource(source,identity)&&
      [job.productCategory,GENERAL_CLIP_CATEGORY].includes(sourceProductCategory(source))&&
      !BLOCKED_SOURCE_PATTERN.test([source.originalName,...(source.tags||[])].join(' '))&&
      Number(source.durationSeconds)>0)
      .sort((a,b)=>Number(b.analysisStatus==='ready')-Number(a.analysisStatus==='ready')||String(a.id).localeCompare(String(b.id)));
    const selected=[],seen=new Set();
    for(const source of candidates){
      if(selected.length>=limit)break;
      const key=localSourcePreparationKey(source),previous=run.localSourcePreparationAttempts?.[source.id];
      if(previous?.key===key&&(previous.complete||Date.now()-Date.parse(previous.attemptedAt)<sourcePreparationDelay(previous.attempts-1)))continue;
      const contentKey=source.contentSha256||source.storedName;
      if(!contentKey||seen.has(contentKey)||await missingMedia(path.join(sourcesDir,source.storedName)))continue;
      seen.add(contentKey);selected.push(source);
    }
    return selected;
  };

  const importEffectiveMaterialCenterClipsForJob = async (
    job,
    accessContext,
    run,
  ) => {
    if (!materialCenter?.configured) return [];
    const library = await readLibrary();
    const importLimit = requiredSourceAssetsForReadiness(
      buildAutoReadiness(library, job.frameworkId, job.productCategory, job.dailyTarget, job.targetDurationSeconds,job.id),
      job.sourceSelectionLimit,
      Boolean(run?.sourceDurationGap),
    );
    if (!importLimit) return [];
    const categories = [
      materialCenterCategoryForProduct(job.productCategory),
      materialCenterCategoryForProduct(GENERAL_CLIP_CATEGORY),
    ].filter(Boolean);
    const importedAssetIds = new Set(
      library.sources
        .filter(
          (source) =>
            source.materialCenterEffective &&
            source.materialCenterEffectiveImportedAt,
        )
        .map((source) => Number(source.materialCenterAssetId || 0))
        .filter((assetId) => assetId > 0),
    );
    const selection = await collectSourceCandidates({
      listAssets: (request) => materialCenter.listAssets(request),
      selectors: [...new Set(categories)].map(category => ({category})),
      limit: importLimit, effectiveOnly: true,
      eligible: asset => !importedAssetIds.has(Number(asset.id)) && asset.effective && isEligibleSourceAsset(asset, job.productCategory),
    });
    const evidence = selection.issues.map(issue => `有效一创读取待重试：${issue.selector}第${issue.page}页，${issue.message}`);
    let attempted = 0;
    for (const asset of selection.items) {
      if (importedAssetIds.has(Number(asset.id))) continue;
      if (attempted >= importLimit) break;
      attempted += 1;
      try {
        const result = await importEffectiveMaterialCenterClips(
          asset.id,
          accessContext,
        );
        evidence.push(
          `有效一创 ${asset.id}：自动入库并通过 ${result.approvedCount}/${result.clipCount} 条`,
        );
      } catch (error) {
        evidence.push(
          `有效一创 ${asset.id}：${error instanceof Error ? error.message : '自动入库失败'}`,
        );
      }
    }
    return evidence;
  };

  const performBasicPreproduction = async (jobId,runId) => {
    const library=await readLibrary(),job=library.autoJobs.find(item=>item.id===jobId);
    if(!job||job.status!=='active'||!ownerCanUseAutomation(library,job))return;
    const candidates=library.clips.filter(clip=>clip.reviewStatus!=='approved'&&!clipIsBlocked(clip)
      &&canReadClip(clip,getSource(library,clip.sourceId),{id:job.createdById})
      &&[job.productCategory,GENERAL_CLIP_CATEGORY].includes(clipProductCategory(clip,library))).slice(0,100);
    for(const clip of candidates){
      const current=await readLibrary(),liveJob=current.autoJobs.find(item=>item.id===jobId);
      if(!liveJob||liveJob.status!=='active'||!ownerCanUseAutomation(current,liveJob))return;
      try {
        const source=getSource(current,clip.sourceId),file=path.join(clipsDir,clip.storedName);
        if(await missingMedia(file))continue;
        const media=await inspectMedia(file),hash=await hashFile(file);
        const checks=[{name:'文件可播放',passed:media.width>0&&media.height>0},
          {name:'音轨',passed:media.hasAudio===true},
          {name:'时长完整',passed:Number.isFinite(media.duration)&&media.duration>0&&Math.abs(media.duration-clip.durationSeconds)<=0.8},
          {name:'来源区间',passed:clip.startSeconds>=0&&clip.endSeconds>clip.startSeconds&&clip.endSeconds<=Number(source.durationSeconds||Infinity)+0.8},
          {name:'文件版本',passed:!clip.contentSha256||clip.contentSha256===hash}];
        await updateLibrary(latest=>{
          const owner=latest.autoJobs.find(item=>item.id===jobId),item=getClip(latest,clip.id);
          if(!owner||owner.status!=='active'||!ownerCanUseAutomation(latest,owner)||!item||JSON.stringify(item)!==JSON.stringify(clip))return unchangedLibrary(null);
          const passed=checks.every(check=>check.passed);
          if(item.automaticAssessment)item.reviewHistory=[...(item.reviewHistory||[]),{assessment:item.automaticAssessment,reviewStatus:item.reviewStatus,reviewedAt:item.reviewedAt}];
          item.automaticAssessment={mode:'basic_rules',ruleVersion:BASIC_REVIEW_POLICY,status:passed?'passed':'failed',autoApproved:passed,checks,assessedAt:nowIso(),reasons:checks.filter(check=>!check.passed).map(check=>check.name)};
          item.reviewStatus=passed?'approved':'changes_requested';item.reviewedAt=nowIso();
          item.reviewNote=passed?'自动基础检查通过：文件、音轨、时长与来源区间完整。':'基础检查失败，自动跳过并换片。';
          item.contentSha256 ||= hash;
        });
      }catch{/* A broken cut is skipped; other candidates continue without human review. */}
    }
    await updateLibrary(latest=>{
      const owner=latest.autoJobs.find(item=>item.id===jobId),run=owner?.runs.find(item=>item.id===runId);
      if(!owner||!run||owner.status!=='active'||!ownerCanUseAutomation(latest,owner))return unchangedLibrary(null);
      run.automaticSourcePreparationVersion=1;
      const needsSources=onDemandSourceShortfall(latest,owner,run);
      const fresh=freshAutomationStageReports();
      for(const key of ['source_selection','source_slicing','clip_calibration','clip_review']){
        const report=run.stageReports.find(item=>item.key===key);
        // Repair receipts written by the old inventory-only branch, without
        // erasing genuine selection, preparation progress or failed attempts.
        const inventoryOnly=report?.summary==='复用现有切片；基础检查后自动入池，异常自动跳过，无需人工复核。';
        if(needsSources){
          if(inventoryOnly)Object.assign(report,fresh.find(item=>item.key===key));
        }else if(!report?.processedCount&&(!report?.completedAt||inventoryOnly)){
          patchRunStageReport(run,key,{status:'completed',summary:'现有切片已满足本批角色、时长与不同开头要求，复用库存，无需补源切片。',completedAt:nowIso()});
        }
      }
    });
  };

  const performAutoPreproduction = async (jobId, runId) => {
    let library = await readLibrary();
    let job = library.autoJobs.find((item) => item.id === jobId);
    let run = job?.runs.find((item) => item.id === runId);
    if (!job || !run) throw new Error('自动流水线批次已失效。');
    const accessContext = { sub: job.createdById, name: job.createdByName };
    let versionCandidates=await versionBackfillCandidates(library,job,run);
    if(run.onDemandSourcePreparation?.mode==='bounded-on-demand-v1'&&versionCandidates.length&&
      !Array.isArray(run.onDemandSourcePreparation.sourceIds)){
      await updateLibrary(latest=>{
        const currentJob=latest.autoJobs.find(item=>item.id===jobId),currentRun=currentJob?.runs.find(item=>item.id===runId);
        if(!currentRun||currentJob.status!=='active'||currentJob.archivedAt||!ownerCanUseAutomation(latest,currentJob))
          throw Error('自动任务已暂停或权限已变化，未准备来源。');
        if(!Array.isArray(currentRun.onDemandSourcePreparation?.sourceIds))
          currentRun.onDemandSourcePreparation={...currentRun.onDemandSourcePreparation,
            sourceIds:versionCandidates.map(item=>item.sourceId),selectedAt:nowIso()};
      });
      library=await readLibrary();job=library.autoJobs.find(item=>item.id===jobId);run=job.runs.find(item=>item.id===runId);
      versionCandidates=await versionBackfillCandidates(library,job,run);
    }
    const boundedHistoricalSources=run.onDemandSourcePreparation?.mode==='bounded-on-demand-v1'&&
      Array.isArray(run.onDemandSourcePreparation.sourceIds)&&(run.onDemandSourcePreparation.sourceIds.length>0||run.progressiveSourcePreparation===true);
    const existingSelectionReport = normalizedAutomationStageReports(
      run.stageReports,
    ).find((report) => report.key === 'source_selection');
    let selectedAssetIds = Array.isArray(run.selectedAssetIds)
      ? [...run.selectedAssetIds]
      : [];
    // A resumed historical run may retain earlier cloud selections as history;
    // once bounded private preparation is fixed, do not process those as an
    // additional paid source batch, even if its old selection report completed.
    if(boundedHistoricalSources)selectedAssetIds=[];

    if (existingSelectionReport?.status !== 'completed') {
      await updateAutoRunStage(jobId, runId, 'source_selection', {
        status: 'running',
        summary: '正在从本地上传与素材中心筛选源视频',
        evidence: [
          `品类：${job.productCategory}`,
          '当前素材中心 API 未提供投放表现字段，本阶段不生成虚假的历史效果评分。',
        ],
        startedAt: nowIso(),
        completedAt: null,
      });
      if (boundedHistoricalSources) {
        selectedAssetIds=[];
        await updateLibrary(latest=>{
          const currentRun=latest.autoJobs.find(item=>item.id===jobId)?.runs.find(item=>item.id===runId);
          if(!currentRun)throw Error('自动流水线批次已失效。');
          currentRun.selectedAssetIds=[];
          patchRunStageReport(currentRun,'source_selection',{status:'completed',totalCount:run.onDemandSourcePreparation.sourceIds.length,
            processedCount:run.onDemandSourcePreparation.sourceIds.length,passedCount:run.onDemandSourcePreparation.sourceIds.length,
            summary:run.progressiveSourcePreparation===true?'按真实缺口递进有限历史来源；每批最多3条、整个任务最多20条':'按本批真实缺口准备已登记旧原片；固定有限来源，不自动轮转全库',
            evidence:[`本批最多 ${run.onDemandSourcePreparation.limit} 条来源，重试仍使用同一清单。`,
              ...run.onDemandSourcePreparation.sourceIds.map(id=>`已登记候选 ${id}；仍需当前原文件、ASR 与逐段内容审核。`)],completedAt:nowIso()});
        });
      } else {
        let effectiveImportEvidence = [];
        try {
          effectiveImportEvidence =
            await importEffectiveMaterialCenterClipsForJob(job, accessContext, run);
        } catch (error) {
          effectiveImportEvidence = [
            `有效一创自动同步暂未完成：${error instanceof Error ? error.message : '上游请求失败'}；继续执行常规补源`,
          ];
        }
        library = await readLibrary();
        const readinessBeforeSourcing = buildAutoReadiness(
          library,
          job.frameworkId,
          job.productCategory,
          job.dailyTarget,
          job.targetDurationSeconds,
          job.id,
        );
        const neededSourceCount = requiredSourceAssetsForReadiness(
          readinessBeforeSourcing,
          job.sourceSelectionLimit,
          Boolean(run.sourceDurationGap),
        );
        const localCandidates=await localSourceCandidatesForJob(library,job,run,neededSourceCount);
        const selection = await materialCenterCandidatesForJob(
          job,
          library,
          Math.max(0,neededSourceCount-localCandidates.length),
        );
        const candidates = selection.items;
        selectedAssetIds = candidates.map((asset) => asset.id);
        await updateLibrary((latest) => {
          const latestJob = latest.autoJobs.find((item) => item.id === jobId);
          const latestRun = latestJob?.runs.find((item) => item.id === runId);
          if (!latestJob || !latestRun)
            throw new Error('自动流水线批次已失效。');
          latestRun.selectedAssetIds = selectedAssetIds;
          latestRun.selectedLocalSourceIds = localCandidates.map(source=>source.id);
          const selectedCount=candidates.length+localCandidates.length;
          patchRunStageReport(latestRun, 'source_selection', {
            status: 'completed',
            totalCount: selectedCount,
            processedCount: selectedCount,
            passedCount: selectedCount,
            reviewRequiredCount: 0,
            failedCount: 0,
            summary: selectedCount
              ? `已选择本地上传 ${localCandidates.length} 条、素材中心 ${candidates.length} 条源视频，准备拆解补片`
              : neededSourceCount === 0
                ? '现有审核通过切片已满足本批组合，直接使用切片库'
                : Object.values(latestRun.localSourcePreparationAttempts||{}).some(attempt=>attempt.error)
                ? '已找到本地上传来源，但准备条件未满足；具体原因见自动切片回执'
                : '本地上传与素材中心暂无可补切来源；请核对产品品类、文件和已处理记录',
            evidence: [
              `品类：${latestJob.productCategory}`,
              ...effectiveImportEvidence,
              ...selection.issues.map(issue => `源素材读取待重试：${issue.selector}第${issue.page}页，${issue.message}`),
              neededSourceCount === 0
                ? '库存优先：本批不重复拆解源视频。'
                : `缺口补切：预计只需补充 ${neededSourceCount} 条源视频，上限 ${normalizedSourceSelectionLimit(latestJob.sourceSelectionLimit)} 条。`,
              ...buildAutoReadiness(
                latest,
                latestJob.frameworkId,
                latestJob.productCategory,
                latestJob.dailyTarget,
                latestJob.targetDurationSeconds,
                latestJob.id,
              )
                .slots.filter((slot) => slot.missingCandidateCount > 0)
                .map(
                  (slot) =>
                    `优先补齐 ${slot.label}：现有 ${slot.candidateCount} 条，目标 ${slot.desiredCandidateCount} 条`,
                ),
              `去重后选择：${selectedCount} 条；本地上传优先，与云来源共用本批上限。`,
              ...localCandidates.map(source=>`本地上传：${safeLabel(source.originalName)}；${source.analysisStatus==='ready'?'复用已有拆解结果':'自动拆解后切片'}`),
              ...candidates.map(
                (asset) =>
                  `素材 #${asset.id}：${safeLabel(asset.filename)}${
                    asset.autoRoleHints?.length
                      ? `（候选角色：${asset.autoRoleHints.join('、')}）`
                      : '（通用候选，拆解后再判定角色）'
                  }`,
              ),
              '选择依据：先补框架角色缺口，再综合品类匹配、视频类型、可下载、权利风险标签、新鲜度与去重。',
              '素材中心未返回投放表现字段，历史效果保持“待核验”。',
            ],
            completedAt: nowIso(),
          });
          latestJob.updatedAt = nowIso();
          return latestRun;
        });
      }
    }

    const selectedSourceIds = new Set(
      Array.isArray(run.selectedSourceIds) ? run.selectedSourceIds : [],
    );
    versionCandidates=await versionBackfillCandidates(await readLibrary(),job,run);
    for(const item of versionCandidates) selectedSourceIds.add(item.sourceId);
    const recoveredCtaSources=new Map();
    const recoveryState=(latest,sourceId)=>{
      const currentJob=latest.autoJobs.find(item=>item.id===jobId),currentRun=currentJob?.runs.find(item=>item.id===runId);
      const source=getSource(latest,sourceId);
      return {library:latest,source,job:currentJob,run:currentRun,authorized:Boolean(currentJob&&
        ownerCanUseAutomation(latest,currentJob)&&source?.visibility!=='private'&&canReadSource(source,accessIdentity(accessContext)))};
    };
    const fixedRecoveryIds=run.onDemandSourcePreparation?.mode==='bounded-on-demand-v1'
      ?run.onDemandSourcePreparation.sourceIds||[]:[];
    for(const sourceId of fixedRecoveryIds){
      if(versionCandidates.some(item=>item.sourceId===sourceId)||run.versionPreparationAttempts?.[sourceId]?.complete!==true)continue;
      const materialization=await completedMaterializationFor(jobId,runId,sourceId);
      if(materialization){
        if(materialization.status==='blocked')throw Object.assign(new Error('本批已完成审核的片段尚未可靠物化：'+materialization.reason+'；保留原回执，未重新识别、送审或换源。'),{code:'SOURCE_MATERIALIZATION_PENDING'});
        if(materialization.status==='ready'){recoveredCtaSources.set(sourceId,materialization);selectedSourceIds.add(sourceId);}
        continue;
      }
      const recovered=await recoverCompletedSourceCta({sourceId,
        readState:async()=>recoveryState(await readLibrary(),sourceId),
        readCatalog:()=>typeof sourceVersionResolver?.availableCandidateSourceIds==='function'
          ?sourceVersionResolver.availableCandidateSourceIds({trustedJobId:jobId}):sourceVersionResolver.candidateSourceIds(),
        isTrustedSegment:trustedSourceBoundary,
        isActionSegment:segment=>suggestedRoleForSegment(segment,1,3).role==='cta'&&purchaseActionSignal(
          `${segment.label||''} ${segment.sceneText||''} ${segment.sceneDescription||''} ${segment.text||''}`).intent,
        verifySegment:(source,segment,assertCurrent)=>verifySourceSegmentProof(source,segment,assertCurrent,jobId),
        approvedClipReusable:async(clip,source,segment,assertCurrent)=>currentClipEvidencePointer(clip,source,jobId)&&
          (await assessAsrClipReuse({clip,segment,hashClip:item=>hashFile(path.join(clipsDir,item.storedName))})).reusable&&await assertCurrent(),
      });
      if(recovered){recovered.isActiveInLibrary=latest=>recovered.isStateCurrent(recoveryState(latest,sourceId));
        recoveredCtaSources.set(sourceId,recovered);selectedSourceIds.add(sourceId);}
    }
    const preparedVersionSources=new Map();
    const preparedLocalSources=new Map();
    const selectedLocalSourceIds=boundedHistoricalSources?[]:
      ((await readLibrary()).autoJobs.find(item=>item.id===jobId)?.runs.find(item=>item.id===runId)?.selectedLocalSourceIds||[]);
    const slicingEvidence = [];
    const durationPreparationErrors = [];
    const sourceSlicingProgress=createSourcePreparationProgress({assetIds:selectedAssetIds,
      localSourceIds:selectedLocalSourceIds,
      sourceIds:[...versionCandidates.map(item=>item.sourceId),...recoveredCtaSources.keys()],sources:library.sources});
    const sourceSlicingReport=(finished=false)=>{
      const report=sourceSlicingProgress.report({finished,now:nowIso(),evidence:slicingEvidence});
      const failures=Object.entries(run.localSourcePreparationAttempts||{}).filter(([,attempt])=>attempt.error);
      if(!report.totalCount&&failures.length){
        return {...report,status:'blocked',totalCount:failures.length,processedCount:failures.length,failedCount:failures.length,
          summary:`本地来源准备受阻：${failures[0][1].error} 等待重试，保留上次失败回执。`,
          evidence:failures.map(([id,attempt])=>`本地上传 ${id}：${attempt.error}（上次处理 ${attempt.attemptedAt}，本轮未重复执行）`),
          completedAt:nowIso()};
      }
      return report;
    };
    const reportSourceSlicingProgress=(finished=false)=>updateAutoRunStage(jobId,runId,'source_slicing',sourceSlicingReport(finished));
    await updateAutoRunStage(jobId,runId,'source_slicing',{
      ...sourceSlicingReport(),startedAt:nowIso(),
    });
    for(const sourceId of selectedLocalSourceIds){
      sourceSlicingProgress.beginLocalSource(sourceId);await reportSourceSlicingProgress();
      let preparedSource=null,preparationError=null;
      try{
        const current=await readLibrary(),owner=current.autoJobs.find(item=>item.id===jobId),source=getSource(current,sourceId);
        if(owner?.status!=='active'||owner.archivedAt||!ownerCanUseAutomation(current,owner))
          throw Object.assign(Error('自动任务已暂停或权限变化，未处理本地来源。'),{code:'AUTOMATION_STOPPED'});
        if(!source||source.visibility==='private'||!canReadSource(source,accessIdentity(accessContext))||
            ![owner.productCategory,GENERAL_CLIP_CATEGORY].includes(sourceProductCategory(source)))
          throw Error('本地来源的权限或产品品类已变化，未继续切片。');
        preparedSource=sourceVersionManaged(source)
          ?await prepareSourceForAutomation(sourceId,{accessContext,runId,trustedJobId:jobId,
            isActiveInLibrary:latest=>{const active=latest.autoJobs.find(item=>item.id===jobId);return Boolean(active?.status==='active'&&!active.archivedAt&&ownerCanUseAutomation(latest,active));}})
          :source.analysisStatus==='ready'&&source.speechSegments?.length?source:await analyzeSource(sourceId);
        preparedLocalSources.set(sourceId,preparedSource);selectedSourceIds.add(sourceId);
        slicingEvidence.push(`本地上传 ${safeLabel(source.originalName)}：已准备 ${preparedSource.speechSegments?.length||0} 段，继续校准切片。`);
      }catch(error){preparationError=error;slicingEvidence.push(`本地上传 ${sourceId}：${error.message}`);}
      sourceSlicingProgress.settleLocalSource(sourceId,sourcePreparationDisplayOutcome(preparedSource,preparationError,sourceVersionManaged(preparedSource)));
      await updateLibrary(latest=>{
        const owner=latest.autoJobs.find(item=>item.id===jobId),currentRun=owner?.runs.find(item=>item.id===runId),source=getSource(latest,sourceId);
        if(!currentRun||!source)return unchangedLibrary(null);
        const previous=currentRun.localSourcePreparationAttempts?.[sourceId];
        currentRun.localSourcePreparationAttempts||={};
        currentRun.localSourcePreparationAttempts[sourceId]={key:localSourcePreparationKey(source),complete:!preparationError&&preparedSource?.analysisStatus==='ready'&&Boolean(preparedSource.speechSegments?.length),
          attemptedAt:nowIso(),attempts:(previous?.attempts||0)+1,error:preparationError?.message||null};
      });
      await reportSourceSlicingProgress();
      if(preparationError?.code==='AUTOMATION_STOPPED')throw preparationError;
    }
    await mapWithConcurrency(
      selectedAssetIds,
      AUTO_SOURCE_PROCESSING_CONCURRENCY,
      async (assetId) => {
        sourceSlicingProgress.beginAsset(assetId);
        await reportSourceSlicingProgress();
        try {
          const analysisStartedAt = Date.now();
          const asset = await materialCenter.getAsset(assetId);
          const libraryBeforeImport = await readLibrary();
          const reusableSource = libraryBeforeImport.sources.find(
            (candidate) =>
              candidate.materialCenterAssetId === asset.id &&
              candidate.materialCenterObjectKey === asset.objectKey &&
              candidate.size === asset.size,
          );
          const needsAnalysis = !(
            reusableSource?.analysisStatus === 'ready' &&
            reusableSource.speechSegments?.length
          );
          const cutterAnalysisOutcomePromise =
            needsAnalysis && !(typeof sourceVersionResolver==='function'&&job.productCategory==='黑晶面膜') && asset.previewUrl && cutter?.configured
              ? cutter
                  .analyze(asset.previewUrl, {
                    timeoutMs: AUTO_CUTTER_TIMEOUT_MS,
                  })
                  .then(
                    (result) => ({ result, error: null }),
                    (error) => ({ result: null, error }),
                  )
              : null;
          const source = await importMaterialCenterSource(
            assetId,
            accessContext,
            {
              asset,
              ensurePreview: false,
            },
          );
          sourceSlicingProgress.bindAsset(assetId,source);
          await reportSourceSlicingProgress();
          const analyzed = sourceVersionManaged(source)
            ? await prepareSourceForAutomation(source.id,{accessContext,runId,trustedJobId:jobId,
              isActiveInLibrary:latest=>{const current=latest.autoJobs.find(item=>item.id===jobId);return Boolean(current?.status==='active'&&!current.archivedAt&&ownerCanUseAutomation(latest,current)&&current.runs.some(item=>item.id===runId));}})
            : source.analysisStatus === 'ready' && source.speechSegments?.length
              ? source
              : await analyzeSource(source.id, {
                  analysisStartedAt,
                  cutterAnalysisOutcomePromise,
                });
          selectedSourceIds.add(analyzed.id);
          if(sourceVersionManaged(analyzed))preparedVersionSources.set(analyzed.id,analyzed);
          sourceSlicingProgress.settleAsset(assetId,sourcePreparationDisplayOutcome(analyzed,null,sourceVersionManaged(analyzed)));
          const elapsedSeconds = Math.max(
            1,
            Math.round((Date.now() - analysisStartedAt) / 1000),
          );
          slicingEvidence.push(
            `素材 #${assetId}：${analyzed.analysisProvider || '未知'} 识别 ${
              analyzed.speechSegments.length
            } 段（导入与识别 ${elapsedSeconds} 秒）`,
          );
        } catch (error) {
          if(isLegacyDurationError(error))durationPreparationErrors.push(error);
          sourceSlicingProgress.settleAsset(assetId,sourcePreparationDisplayOutcome(null,error));
          slicingEvidence.push(
            `素材 #${assetId} 失败：${
              error instanceof Error ? error.message : '拆解失败'
            }`,
          );
        }
        await reportSourceSlicingProgress();
      },
    );
    await updateLibrary((latest) => {
      const latestJob = latest.autoJobs.find((item) => item.id === jobId);
      const latestRun = latestJob?.runs.find((item) => item.id === runId);
      if (!latestJob || !latestRun) throw new Error('自动流水线批次已失效。');
      latestRun.selectedSourceIds = [...selectedSourceIds];
      // Selection is not completion. Historical ASR/review runs below; keep
      // this stage running until every actual preparation attempt has settled.
      latestJob.updatedAt = nowIso();
      return latestRun;
    });

    library = await readLibrary();
    job = library.autoJobs.find((item) => item.id === jobId);
    run = job?.runs.find((item) => item.id === runId);
    if (!job || !run) throw new Error('自动流水线批次已失效。');
    const selectedSources = [...selectedSourceIds]
      .map((sourceId) => getSource(library, sourceId))
      .filter(Boolean);
    const sources=[];
    for(const source of selectedSources){
      if(preparedLocalSources.has(source.id)){sources.push(preparedLocalSources.get(source.id));continue;}
      if(selectedLocalSourceIds.includes(source.id))continue;
      if(sourceVersionManaged(source)){
        const candidate=versionCandidates.find(item=>item.sourceId===source.id);
        const recovered=recoveredCtaSources.get(source.id);
        if(!candidate&&recovered){
          sourceSlicingProgress.beginSource(source.id);await reportSourceSlicingProgress();
          if(await recovered.assertCurrent()){
            sources.push(recovered.source);sourceSlicingProgress.settleSource(source.id,'passed');
            slicingEvidence.push(`${source.id}：复用当前原片、ASR 与逐段审核缓存，仅补 ${recovered.segmentIds.length} 段${recovered.plans?'已通过但未完成物化/技术审核的片段':'缺失的行动角色'}；未重新调用识别或内容模型。`);
          }else{sourceSlicingProgress.settleSource(source.id,'review_required');recoveredCtaSources.delete(source.id);}
          await reportSourceSlicingProgress();continue;
        }
        // selectedSourceIds is history, not permission to bypass this round's
        // bounded selection/backoff. Existing clips remain in their SKU pool.
        if(!candidate && !preparedVersionSources.has(source.id))continue;
        let preparationError=null;
        if(candidate&&!preparedVersionSources.has(source.id)){
          sourceSlicingProgress.beginSource(source.id);
          await reportSourceSlicingProgress();
        }
        try{sources.push(preparedVersionSources.get(source.id)||await prepareSourceForAutomation(source.id,{accessContext,runId,trustedJobId:jobId,
          isActiveInLibrary:latest=>{const current=latest.autoJobs.find(item=>item.id===jobId);return Boolean(current?.status==='active'&&!current.archivedAt&&ownerCanUseAutomation(latest,current)&&current.runs.some(item=>item.id===runId));}}));}
        catch(error){preparationError=error;if(isLegacyDurationError(error))durationPreparationErrors.push(error);slicingEvidence.push(`${source.id}：${error.message}`);}
        if(candidate){
          sourceSlicingProgress.settleSource(source.id,sourcePreparationDisplayOutcome(
            sources.find(item=>item.id===source.id),preparationError,true));
          await reportSourceSlicingProgress();
        }
        if(candidate) await updateLibrary(latest=>{
          const currentJob=latest.autoJobs.find(item=>item.id===jobId),current=currentJob?.runs.find(item=>item.id===runId);
          if(!current)return unchangedLibrary(null);
          // Only this successful, byte/private-proof-checked preparation may
          // fill a historical NULL SHA in the finite server ledger. HTTP and
          // mere discovery never get this capability; later changes still fail.
          const registered=currentJob.progressiveSourcePreparation?.catalog?.find(item=>item.sourceId===source.id);
          const measured=sources.find(item=>item.id===source.id)?.contentSha256;
          if(registered&&!preparationError&&/^[a-f0-9]{64}$/.test(measured||'')){
            if(registered.sourceSha256&&registered.sourceSha256!==measured)
              throw Object.assign(new Error('已准备原片的真实哈希发生变化，未覆盖有限选源依据。'),{code:'PROGRESSIVE_SOURCE_CHANGED'});
            registered.sourceSha256=measured;
          }
          current.versionPreparationAttempts||={};const previous=current.versionPreparationAttempts[source.id];
          current.versionPreparationAttempts[source.id]={key:candidate.key,complete:!preparationError&&!sources.find(item=>item.id===source.id)?.sourceSemanticReview?.recoverable,
            attemptedAt:nowIso(),attempts:previous?.key===candidate.key?(previous.attempts||0)+1:1,
            reason:preparationError?.technicalDisposition?.verified?'SOURCE_ASR_UNAVAILABLE':preparationError?.code||null,
            ...(preparationError?.technicalDisposition?.verified?{technicalDisposition:{status:'technical_unusable',reason:'insufficient_recognition',
              operationKey:preparationError.technicalDisposition.operationKey,receiptSha256:preparationError.technicalDisposition.receiptSha256,
              requiresReview:true,autoApproved:false}}:{})};
        });
      }else sources.push(source);
    }
    await reportSourceSlicingProgress(true);
    if(!sources.length&&durationPreparationErrors.length)throw durationPreparationErrors[0];
    const sourceCategoryById = new Map(
      sources.map((source) => [
        source.id,
        sourceProductCategory(source) || job.productCategory,
      ]),
    );
    const calibratedSources = [];
    let segmentTotal = 0;
    let calibrationReviewCount = 0;
    for (const source of sources) {
      // Keep the complete ASR context and stable IDs. A queue-size limit must
      // never truncate the source transcript or invalidate its review proofs.
      const allSegments = calibrateSourceSegments(source,jobId);
      const recoverySegments=recoveredCtaSources.get(source.id)?.segmentIds;
      const segments = allSegments.filter(
        (segment) => segment.automaticCalibration?.status === 'calibrated'&&(!recoverySegments||recoverySegments.includes(segment.id)),
      );
      const reviewRequiredSegments = allSegments.filter(
        (segment) => segment.automaticCalibration?.status !== 'calibrated'&&(!recoverySegments||recoverySegments.includes(segment.id)),
      );
      segmentTotal += recoverySegments?segments.length+reviewRequiredSegments.length:allSegments.length;
      calibrationReviewCount += reviewRequiredSegments.length;
      calibratedSources.push({
        sourceId: source.id,
        segments,
        reviewRequiredSegments,
      });
    }
    await updateAutoRunStage(jobId, runId, 'clip_calibration', {
      status: segmentTotal ? 'running' : 'completed',
      totalCount: segmentTotal,
      processedCount: 0,
      passedCount: 0,
      reviewRequiredCount: calibrationReviewCount,
      failedCount: 0,
      summary: segmentTotal
        ? '正在校准切点、名称与结构角色'
        : '没有候选片段需要校准',
      evidence: [],
      startedAt: nowIso(),
      completedAt: segmentTotal ? null : nowIso(),
    });
    const createdClipIds = new Set(
      Array.isArray(run.createdClipIds) ? run.createdClipIds : [],
    );
    const currentBatchClipIds = new Set();
    const materializationClipGuards = new Map();
    const calibrationEvidence = [];
    let calibrationFailedCount = 0;
    let calibratedCount = 0;
    for (const sourceEntry of calibratedSources) {
      const recoveryGuard=recoveredCtaSources.get(sourceEntry.sourceId)||null;
      if(!recoveryGuard) await updateLibrary((latest) => {
        const current = getSource(latest, sourceEntry.sourceId);
        if (!current) throw new Error('校准时源视频记录已失效。');
        // Managed ASR is immutable evidence. Calibration annotations belong to
        // this run's reports, not a rewrite of the source transcript snapshot.
        if (!sourceVersionManaged(current)) current.speechSegments = [
          ...sourceEntry.segments,
          ...sourceEntry.reviewRequiredSegments,
        ]
          .sort((left, right) => left.startSeconds - right.startSeconds)
          .map((segment, index) => ({ ...segment, index: index + 1 }));
        current.automaticCalibrationAt = nowIso();
        return current;
      });
      for (const segment of sourceEntry.reviewRequiredSegments) {
        calibrationEvidence.push(
          `${safeLabel(segment.clipName || segment.label, '未命名候选')}：切点语义证据不足，系统已跳过并继续换片`,
        );
      }
      for (const segment of sourceEntry.segments) {
        try {
          const segmentRecoveryGuard=recoveryGuard?.guardForSegment?.(segment.id)||recoveryGuard;
          const materializationPlan=recoveryGuard?.plans?.find(plan=>plan.segmentId===segment.id);
          const clip = await createClip(
            {
              sourceId: sourceEntry.sourceId,
              startSeconds: segment.startSeconds,
              endSeconds: segment.endSeconds,
              role: materializationPlan?.role||segment.suggestedRole || 'custom',
              ...generatedClipNaming(getSource(await readLibrary(), sourceEntry.sourceId), segment),
              tags: [
                '自动切片',
                segment.boundaryType,
                ...(isDramaPerformanceText(
                  segment.label,
                  segment.clipName,
                  segment.sceneText,
                  segment.sceneDescription,
                )
                  ? ['剧情演绎']
                  : []),
              ],
              productCategory:
                sourceCategoryById.get(sourceEntry.sourceId) ||
                job.productCategory,
            },
            accessContext,
            segmentRecoveryGuard,
            jobId,
          );
          if(segmentRecoveryGuard?.materializationOnly)segmentRecoveryGuard.bindClip(clip);
          createdClipIds.add(clip.id);
          currentBatchClipIds.add(clip.id);
          if(segmentRecoveryGuard?.materializationOnly)materializationClipGuards.set(clip.id,segmentRecoveryGuard);
          calibratedCount += 1;
        } catch (error) {
          calibrationFailedCount += 1;
          calibrationEvidence.push(
            `${safeLabel(segment.clipName || segment.label)}：${
              error instanceof Error ? error.message : '切片生成失败'
            }`,
          );
        }
      }
      calibrationEvidence.push(
        `素材 ${sourceEntry.sourceId}：校准 ${sourceEntry.segments.length} 段`,
      );
      await updateAutoRunStage(jobId, runId, 'clip_calibration', {
        processedCount:
          calibratedCount + calibrationFailedCount + calibrationReviewCount,
        passedCount: calibratedCount,
        reviewRequiredCount: calibrationReviewCount,
        failedCount: calibrationFailedCount,
        evidence: calibrationEvidence,
      });
    }
    await updateLibrary((latest) => {
      const latestJob = latest.autoJobs.find((item) => item.id === jobId);
      const latestRun = latestJob?.runs.find((item) => item.id === runId);
      if (!latestJob || !latestRun) throw new Error('自动流水线批次已失效。');
      latestRun.createdClipIds = [...createdClipIds];
      patchRunStageReport(latestRun, 'clip_calibration', {
        status:
          calibrationFailedCount || calibrationReviewCount
            ? 'partial'
            : 'completed',
        totalCount: segmentTotal,
        processedCount:
          calibratedCount + calibrationFailedCount + calibrationReviewCount,
        passedCount: calibratedCount,
        reviewRequiredCount: 0,
        failedCount: calibrationFailedCount + calibrationReviewCount,
        summary: `本轮已生成或复用 ${currentBatchClipIds.size} 条校准切片；不可靠候选已自动跳过`,
        evidence: calibrationEvidence,
        completedAt: nowIso(),
      });
      latestJob.updatedAt = nowIso();
      return latestRun;
    });

    await updateAutoRunStage(jobId, runId, 'clip_review', {
      status: currentBatchClipIds.size ? 'running' : 'completed',
      totalCount: currentBatchClipIds.size,
      processedCount: 0,
      passedCount: 0,
      reviewRequiredCount: 0,
      failedCount: 0,
      summary: currentBatchClipIds.size
        ? '正在检查内容边界完整性、相邻内容与技术规格'
        : '本批次没有新切片需要质检',
      evidence: [],
      startedAt: nowIso(),
      completedAt: currentBatchClipIds.size ? null : nowIso(),
    });
    let assessmentPassedCount = 0;
    let assessmentReviewCount = 0;
    let assessmentFailedCount = 0;
    const assessmentEvidence = [];
    await mapWithConcurrency(
      [...currentBatchClipIds],
      AUTO_CLIP_REVIEW_CONCURRENCY,
      async (clipId) => {
        await updateAutoRunStage(jobId, runId, 'clip_review', {
          currentItem: `切片 ${clipId}：边界与技术质检中`,
        });
        const latest = await readLibrary();
        const clip = getClip(latest, clipId);
        const source = clip ? getSource(latest, clip.sourceId) : null;
        const segment = source?.speechSegments?.find(
          (candidate) =>
            Math.abs(candidate.startSeconds - clip.startSeconds) < 0.05 &&
            Math.abs(candidate.endSeconds - clip.endSeconds) < 0.05,
        );
        try {
          const assessed = await assessClipAutomatically(
            clipId,
            segment?.label || '',
            {
              autoAdjustBoundary: true,
              autoApprove: true,
              autoReject: true,
              requireAudioContent: true,
              ...(materializationClipGuards.has(clipId)?{cacheRecoveryGuard:materializationClipGuards.get(clipId)}:{}),
              trustedJobId:jobId,trustedRunId:runId,
            },
          );
          if (
            assessed.automaticAssessment.status === 'passed' &&
            assessed.reviewStatus === 'approved'
          ) {
            assessmentPassedCount += 1;
          } else if (assessed.automaticAssessment.status === 'failed') {
            assessmentFailedCount += 1;
          } else {
            assessmentReviewCount += 1;
          }
          assessmentEvidence.push(
            `${safeLabel(assessed.name)}：${
              assessed.automaticAssessment.autoApproved
                ? assessed.automaticAssessment.autoAdjusted
                  ? '自动修正边界后通过'
                  : '自动审核通过'
                : assessed.reviewStatus === 'approved'
                  ? '系统边界复核通过'
                  : assessed.automaticAssessment.recommendation === 'approve'
                    ? '系统审核通过'
                    : assessed.automaticAssessment.recommendation === 'reject'
                      ? '自动退回并换片'
                      : '自动跳过并换片'
            }（${assessed.automaticAssessment.score}分）`,
          );
        } catch (error) {
          assessmentFailedCount += 1;
          assessmentEvidence.push(
            `切片 ${clipId}：${error instanceof Error ? error.message : '质检失败'}`,
          );
        }
        await updateAutoRunStage(jobId, runId, 'clip_review', {
          processedCount:
            assessmentPassedCount +
            assessmentReviewCount +
            assessmentFailedCount,
          passedCount: assessmentPassedCount,
          reviewRequiredCount: assessmentReviewCount,
          failedCount: assessmentFailedCount,
          evidence: assessmentEvidence,
        });
      },
    );
    const clipReviewNeedsAttention =
      assessmentReviewCount + assessmentFailedCount;
    await updateAutoRunStage(jobId, runId, 'clip_review', {
      status: clipReviewNeedsAttention ? 'partial' : 'completed',
      totalCount: currentBatchClipIds.size,
      processedCount:
        assessmentPassedCount + assessmentReviewCount + assessmentFailedCount,
      passedCount: assessmentPassedCount,
      reviewRequiredCount: 0,
      failedCount: assessmentReviewCount + assessmentFailedCount,
      summary: currentBatchClipIds.size
        ? `自动审核通过 ${assessmentPassedCount} 条；${clipReviewNeedsAttention} 条已自动退回或跳过`
        : '本批次没有新切片需要质检',
      evidence: assessmentEvidence,
      completedAt: nowIso(),
    });
    // Calibration annotates the transcript. Keep the completed local snapshot
    // current so those annotations alone cannot schedule the same source again.
    if(selectedLocalSourceIds.length)await updateLibrary(latest=>{
      const currentRun=latest.autoJobs.find(item=>item.id===jobId)?.runs.find(item=>item.id===runId);
      if(!currentRun)return unchangedLibrary(null);
      for(const sourceId of selectedLocalSourceIds){
        const attempt=currentRun.localSourcePreparationAttempts?.[sourceId],source=getSource(latest,sourceId);
        if(attempt?.complete&&source)attempt.key=localSourcePreparationKey(source);
      }
    });
  };

  const verifyQianchuanDeliveryTargets = async (value) => {
    const config = normalizeQianchuanDelivery(value);
    if (config.targets.length === 0) return config;
    if (!materialCenter?.configured) {
      throw new Error('素材中心与千川服务接口未配置，暂不能核验投放目标。');
    }
    const targets = [];
    for (const target of config.targets) {
      const verification = await materialCenter.verifyQianchuanTarget(target);
      if (config.enabled) assertDeliveryTargetVerified(target, verification);
      targets.push({
        ...target,
        advertiserName: verification.account.name || target.advertiserName,
        planName: verification.plan.name || target.planName,
        planType: verification.plan.planType || target.planType,
        verification,
      });
    }
    const primary = targets[0] || normalizeQianchuanTarget();
    return { ...config, ...primary, targets };
  };

  const createAutoJob = async (payload, accessContext) => {
    const identity = accessIdentity(accessContext);
    // Authorize before provider preflight or external account lookups.
    assertAutoRemixAccess(await readLibrary(), accessContext);
    assertAutomaticPipelineReady({...payload,autoApproveOutputs:true},
      {cloudConfigured:materialCenter?.configured});
    let qianchuanDelivery = normalizeQianchuanDelivery(
      payload.qianchuanDelivery,
    );
    validateQianchuanDelivery(qianchuanDelivery, {
      active: qianchuanDelivery.enabled,
    });
    qianchuanDelivery = await verifyQianchuanDeliveryTargets(qianchuanDelivery);
    if (qianchuanDelivery.enabled && !payload.autoReturnAfterApproval) {
      throw new Error('自动投放必须同时启用自动成片审核与审核通过后自动回传。');
    }
    const job = await updateLibrary((library) => {
      assertAutoRemixAccess(library, accessContext);
      const frameworkId = String(payload.frameworkId || STORY_TEMPLATE.id);
      const readiness = buildAutoReadiness(
        library,
        frameworkId,
        payload.productCategory,
        payload.dailyTarget,
        payload.targetDurationSeconds,
      );
      if (!readiness.framework) throw new Error('所选框架已失效。');
      if (!readiness.productCategory) {
        throw new Error('请选择自动选源和混剪使用的产品品类。');
      }
      if (readiness.productCategory === GENERAL_CLIP_CATEGORY) {
        throw new Error('通用切片不能作为自动混剪的目标产品。');
      }
      if (!readiness.ready && !materialCenter?.configured) {
        throw new Error(readiness.blockingReasons.join(' '));
      }
      const dailyTarget = Math.trunc(Number(payload.dailyTarget) || 0);
      const allowedDailyTarget = materialCenter?.configured
        ? AUTO_REMIX_MAX_DAILY_OUTPUTS
        : readiness.maxDailyTarget;
      if (
        dailyTarget < 1 ||
        dailyTarget > allowedDailyTarget ||
        dailyTarget > AUTO_REMIX_MAX_DAILY_OUTPUTS
      ) {
        throw new Error(
          `今日生成数量需为1–${allowedDailyTarget}；切片池就绪后仍会按真实组合上限执行。`,
        );
      }
      if (payload.autoReturnAfterApproval && !materialCenter?.configured) {
        throw new Error('素材中心双向接口未配置，暂不能启用审核后自动回传。');
      }
      const timestamp = nowIso();
      const scheduleTime = normalizeScheduleTime(payload.scheduleTime);
      const scheduleEnabled = Boolean(payload.scheduleEnabled);
      const targetDurationSeconds = normalizeAutoRemixDuration(
        payload.targetDurationSeconds ?? AUTO_REMIX_DEFAULT_DURATION_SECONDS,
      );
      const includeUsageDisclaimer = Boolean(payload.includeUsageDisclaimer);
      const created = {
        id: randomUUID(),
        name: safeLabel(payload.name, `${readiness.framework.name}自动任务`),
        frameworkId,
        frameworkName: readiness.framework.name,
        productCategory: readiness.productCategory,
        status: 'active',
        dailyTarget,
        scheduleEnabled,
        scheduleTime,
        targetDurationSeconds,
        timeZone: 'Asia/Shanghai',
        includeUsageDisclaimer,
        usageDisclaimerText: includeUsageDisclaimer
          ? normalizeUsageDisclaimerText(payload.usageDisclaimerText)
          : '',
        autoApproveOutputs: true,
        reviewPolicy: BASIC_REVIEW_POLICY,
        autoReturnAfterApproval: Boolean(payload.autoReturnAfterApproval),
        qianchuanDelivery,
        performanceLearning: {
          status: 'pending',
          sampleSize: 0,
          spendYuan: null,
          gmvYuan: null,
          roi: null,
          recommendations: ['等待千川真实投放与效果回流。'],
          updatedAt: null,
        },
        sourceSelectionLimit: normalizedSourceSelectionLimit(
          payload.sourceSelectionLimit,
        ),
        createdById: identity.id,
        createdByName: identity.name,
        createdAt: timestamp,
        updatedAt: timestamp,
        nextRunAt: payload.runImmediately
          ? timestamp
          : scheduleEnabled
            ? nextShanghaiSchedule(scheduleTime)
            : null,
        lastRunAt: null,
        combinationCursor: 0,
        runs: [],
      };
      library.autoJobs.unshift(created);
      return created;
    });
    if (payload.runImmediately) requestAutoSchedulerTick();
    return readOwnedAutoJob(job.id, accessContext);
  };

  const updateAutoJob = async (jobId, payload, accessContext) => {
    const identity = accessIdentity(accessContext);
    let verifiedQianchuanDelivery = null;
    if (payload.qianchuanDelivery !== undefined) {
      verifiedQianchuanDelivery = normalizeQianchuanDelivery(
        payload.qianchuanDelivery,
      );
      validateQianchuanDelivery(verifiedQianchuanDelivery, {
        active: verifiedQianchuanDelivery.enabled,
      });
      verifiedQianchuanDelivery = await verifyQianchuanDeliveryTargets(
        verifiedQianchuanDelivery,
      );
    }
    await updateLibrary((library) => {
      assertAutoRemixAccess(library, accessContext);
      const job = library.autoJobs.find(
        (item) =>
          item.id === jobId &&
          !item.archivedAt &&
          autoJobBelongsToIdentity(item, identity),
      );
      if (!job) throw new Error('未找到该自动混剪任务。');
      const frameworkId = payload.frameworkId
        ? String(payload.frameworkId)
        : job.frameworkId;
      const productCategory =
        payload.productCategory !== undefined
          ? safeLabel(payload.productCategory, '')
          : job.productCategory;
      const readiness = buildAutoReadiness(
        library,
        frameworkId,
        productCategory,
        payload.dailyTarget ?? job.dailyTarget,
        payload.targetDurationSeconds ?? job.targetDurationSeconds,
        job.id,
      );
      if (!readiness.framework) throw new Error('所选框架已失效。');
      if (!readiness.productCategory) {
        throw new Error('请选择自动选源和混剪使用的产品品类。');
      }
      if (readiness.productCategory === GENERAL_CLIP_CATEGORY) {
        throw new Error('通用切片不能作为自动混剪的目标产品。');
      }
      if (
        !readiness.ready &&
        !materialCenter?.configured &&
        payload.productCategory === undefined
      ) {
        throw new Error(readiness.blockingReasons.join(' '));
      }
      const dailyTarget =
        payload.dailyTarget !== undefined
          ? Math.trunc(Number(payload.dailyTarget))
          : job.dailyTarget;
      const allowedDailyTarget = materialCenter?.configured
        ? AUTO_REMIX_MAX_DAILY_OUTPUTS
        : readiness.maxDailyTarget;
      if (dailyTarget < 1 || dailyTarget > allowedDailyTarget) {
        throw new Error(`每日生成数量不能超过${allowedDailyTarget}条。`);
      }
      job.name = safeLabel(payload.name, job.name);
      job.frameworkId = frameworkId;
      job.frameworkName = readiness.framework.name;
      job.productCategory = readiness.productCategory;
      job.dailyTarget = dailyTarget;
      if (payload.scheduleEnabled !== undefined) {
        job.scheduleEnabled = Boolean(payload.scheduleEnabled);
      } else if (job.scheduleEnabled === undefined) {
        job.scheduleEnabled = true;
      }
      job.scheduleTime = normalizeScheduleTime(
        payload.scheduleTime || job.scheduleTime,
      );
      job.targetDurationSeconds =
        payload.targetDurationSeconds !== undefined
          ? normalizeAutoRemixDuration(payload.targetDurationSeconds)
          : Number(job.targetDurationSeconds) ||
            AUTO_REMIX_DEFAULT_DURATION_SECONDS;
      if (payload.includeUsageDisclaimer !== undefined) {
        job.includeUsageDisclaimer = Boolean(payload.includeUsageDisclaimer);
      }
      if (
        payload.usageDisclaimerText !== undefined ||
        payload.includeUsageDisclaimer !== undefined
      ) {
        job.usageDisclaimerText = job.includeUsageDisclaimer
          ? normalizeUsageDisclaimerText(
              payload.usageDisclaimerText ?? job.usageDisclaimerText,
            )
          : '';
      }
      if (payload.autoApproveOutputs !== undefined) {
        job.autoApproveOutputs = true;
      }
      if (payload.autoReturnAfterApproval !== undefined) {
        if (payload.autoReturnAfterApproval && !materialCenter?.configured) {
          throw new Error('素材中心双向接口未配置，暂不能启用自动回传。');
        }
        job.autoReturnAfterApproval = Boolean(payload.autoReturnAfterApproval);
      }
      if (verifiedQianchuanDelivery) {
        if (verifiedQianchuanDelivery.enabled && !job.autoReturnAfterApproval) {
          throw new Error(
            '自动投放必须同时启用自动成片审核与审核通过后自动回传。',
          );
        }
        const previousDelivery = normalizeQianchuanDelivery(job.qianchuanDelivery);
        job.qianchuanDelivery = verifiedQianchuanDelivery;
        if (previousDelivery.deliveryLimitMode === 'limited' &&
            ['unlimited','quantity_unlimited'].includes(verifiedQianchuanDelivery.deliveryLimitMode) &&
            verifiedQianchuanDelivery.enabled && verifiedQianchuanDelivery.confirmed &&
            job.autoApproveOutputs === true && job.autoReturnAfterApproval === true) {
          const previousTargets = new Set(previousDelivery.targets.map(qianchuanTargetIdentity));
          const currentTargets = new Set(verifiedQianchuanDelivery.targets
            .map(qianchuanTargetIdentity).filter(target => previousTargets.has(target)));
          for (const render of library.renders) {
            if (!canPerformAutomaticEffects(library, job, render)) continue;
            for (const variant of render.variants) {
              if (variant.reviewStatus !== 'approved' || !variant.automaticAssessment?.autoApproved ||
                  hasPlatformQuarantine(variant) || variant.sourceRevalidation?.required) continue;
              try { assertCurrentAutomaticReview(render, variant, library); } catch { continue; }
              for (const state of qianchuanDeliveryStatesForVariant(variant)) {
                const target = qianchuanTargetIdentity(state);
                if (!currentTargets.has(target) || activeQianchuanDeliveryPromises.has(`${render.id}:${variant.id}:${target}`)) continue;
                const recovered = releaseWorkstationLimitBlock(state, nowIso(),verifiedQianchuanDelivery);
                if (recovered) setQianchuanStateForTarget(variant, state, recovered);
              }
            }
          }
        }
      }
      if (payload.sourceSelectionLimit !== undefined) {
        job.sourceSelectionLimit = normalizedSourceSelectionLimit(
          payload.sourceSelectionLimit,
        );
      }
      if (job.status === 'active' && !activeAutoJobIds.has(job.id)) {
        job.nextRunAt = nextAutoJobSchedule(job);
      }
      job.updatedAt = nowIso();
      return job;
    });
    return readOwnedAutoJob(jobId, accessContext);
  };

  const controlAutoJob = async (jobId, action, accessContext) => {
    const identity = accessIdentity(accessContext);
    await updateLibrary((library) => {
      assertAutoRemixAccess(library, accessContext);
      const job = library.autoJobs.find(
        (item) =>
          item.id === jobId &&
          !item.archivedAt &&
          autoJobBelongsToIdentity(item, identity),
      );
      if (!job) throw new Error('未找到该自动混剪任务。');
      if (!['pause', 'resume', 'run-now'].includes(action)) {
        throw new Error('自动任务操作无效。');
      }
      if (
        action !== 'pause' &&
        (!safeLabel(job.productCategory, '') ||
          job.productCategory === GENERAL_CLIP_CATEGORY)
      ) {
        throw new Error('请先为该自动任务选择具体的目标产品。');
      }
      if (action === 'pause') {
        job.status = 'paused';
        job.nextRunAt = null;
      } else {
        job.autoApproveOutputs = true;
        job.reviewPolicy = BASIC_REVIEW_POLICY;
        assertAutomaticPipelineReady(job,{cloudConfigured:materialCenter?.configured});
        job.status = 'active';
        const resumeDelivery = normalizeQianchuanDelivery(job.qianchuanDelivery);
        if (resumeDelivery.enabled && resumeDelivery.confirmed && ['unlimited','quantity_unlimited'].includes(resumeDelivery.deliveryLimitMode) &&
            job.autoApproveOutputs === true && job.autoReturnAfterApproval === true) {
          for (const render of library.renders) {
            if (!canPerformAutomaticEffects(library,job,render)) continue;
            for (const variant of render.variants) {
              try { assertCurrentAutomaticReview(render,variant,library); } catch { continue; }
              for (const state of qianchuanDeliveryStatesForVariant(variant)) {
                const target = qianchuanTargetIdentity(state);
                if (activeQianchuanDeliveryPromises.has(`${render.id}:${variant.id}:${target}`)) continue;
                const recovered = releaseWorkstationLimitBlockOnResume(state,{job,render,variant,config:resumeDelivery,
                  ownerAuthorized:ownerCanUseAutomation(library,job),currentReviewVerified:true,
                  platformQuarantined:hasPlatformQuarantine(variant),nowIso:nowIso()});
                if (recovered) setQianchuanStateForTarget(variant,state,recovered);
              }
            }
          }
        }
        const resumableRun = (job.runs || []).find(run =>
          AUTO_REMIX_IN_PROGRESS_RUN_STATUSES.has(run.status) ||
          (['partial', 'failed'].includes(run.status) && isRecoverableAutoPipelineError(run.errorMessage)));
        // Explicit owner control may opt an old run into bounded preparation.
        // Merely loading/deploying the service does not migrate or wake it.
        if(resumableRun&&job.productCategory==='黑晶面膜'&&!historicalInventoryEnabled({jobId:job.id,autoApproveOutputs:job.autoApproveOutputs})&&!resumableRun.onDemandSourcePreparation){
          const previousIds=[...new Set([...(resumableRun.selectedSourceIds||[]),
            ...Object.keys(resumableRun.versionPreparationAttempts||{})])];
          const limit=normalizedSourceSelectionLimit(job.sourceSelectionLimit);
          resumableRun.onDemandSourcePreparation={mode:'bounded-on-demand-v1',limit,
            ...(previousIds.length?{sourceIds:previousIds.slice(0,limit),selectedAt:nowIso()}: {})};
        }
        if (resumableRun && REVIEW_HOLD_STATUSES.has(resumableRun.status)) {
          resumableRun.resumeRequestedAt = nowIso();
        }
        job.nextRunAt =
          action === 'run-now' || resumableRun ? nowIso() : nextAutoJobSchedule(job);
      }
      job.updatedAt = nowIso();
      return job;
    });
    if (action === 'run-now') requestAutoSchedulerTick();
    return readOwnedAutoJob(jobId, accessContext);
  };

  const cleanupCompletedAutoJobs = async (payload, accessContext) => {
    const identity = accessIdentity(accessContext);
    const jobIds = [
      ...new Set(
        (Array.isArray(payload?.jobIds) ? payload.jobIds : [])
          .map((jobId) => safeLabel(jobId, ''))
          .filter(Boolean),
      ),
    ];
    if (jobIds.length < 1) throw new Error('请至少选择一个已完成计划。');
    if (jobIds.length > 100) throw new Error('单次最多清理100个已完成计划。');
    await updateLibrary((library) => {
      assertAutoRemixAccess(library, accessContext);
      const jobs = jobIds.map((jobId) =>
        library.autoJobs.find(
          (item) =>
            item.id === jobId &&
            !item.archivedAt &&
            autoJobBelongsToIdentity(item, identity),
        ),
      );
      if (jobs.some((job) => !job)) {
        throw new Error('所选计划不存在、已清理或不属于当前登录人。');
      }
      if (jobs.some((job) => !autoJobCleanupEligible(job))) {
        throw new Error('只能清理已完整完成且不再等待运行的计划。');
      }
      const archivedAt = nowIso();
      for (const job of jobs) {
        job.archivedAt = archivedAt;
        job.archivedById = identity.id;
        job.archivedByName = identity.name;
        job.status = 'paused';
        job.nextRunAt = null;
        job.updatedAt = archivedAt;
      }
    });
    return { cleanedCount: jobIds.length, jobIds };
  };

  const deleteCompletedAutoJob = async (jobId, accessContext) => {
    const identity = accessIdentity(accessContext);
    await updateLibrary((library) => {
      assertAutoRemixAccess(library, accessContext);
      const jobIndex = library.autoJobs.findIndex(
        (item) =>
          item.id === jobId &&
          !item.archivedAt &&
          autoJobBelongsToIdentity(item, identity),
      );
      if (jobIndex < 0) {
        throw new Error('该计划不存在、已删除或不属于当前登录人。');
      }
      const job = library.autoJobs[jobIndex];
      if (!autoJobCleanupEligible(job)) {
        throw new Error('只能删除已完整完成且不再等待运行的计划。');
      }
      library.autoJobs.splice(jobIndex, 1);
    });
    return { deletedJobId: jobId };
  };

  const automationRendersForRun = (library, jobId, runId) =>
    library.renders.filter(
      (render) =>
        render.automation?.jobId === jobId &&
        render.automation?.runId === runId,
    );

  const slotSelectionFingerprint = (slotSelections) =>
    createHash('sha256')
      .update(
        JSON.stringify(
          Object.entries(slotSelections || {})
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([slotId, clipIds]) => [slotId, [...(clipIds || [])]]),
        ),
      )
      .digest('hex');

  const reconcileAutomaticOutputReviews = (jobId, runId) =>
    updateLibrary((library) => {
      const timestamp = nowIso();
      const allowAutomaticApproval = library.autoJobs.find(job => job.id === jobId)?.autoApproveOutputs === true;
      const renders = automationRendersForRun(library, jobId, runId);
      for (const render of renders) {
        for (const variant of render.variants) {
          reconcileOutputApproval(variant, timestamp, allowAutomaticApproval);
        }
      }
      return automaticOutputStats(renders);
    });

  const nextAutoRemediationAt = () =>
    new Date(Date.now() + AUTO_REMIX_REMEDIATION_DELAY_MS).toISOString();

  const prepareAutoRun = async (jobId) =>
    updateLibrary((library) => {
      const job = library.autoJobs.find((item) => item.id === jobId);
      if (!job || job.status !== 'active') return unchangedLibrary(null);
      if(job.id===HISTORICAL_INVENTORY_JOB&&basicWorkCount(library,job)>=20){job.nextRunAt=null;return null;}
      if(companyRecoveryEnabled(job)){
        const continuation=companyJobContinuation(library,job);
        if(['wait','done'].includes(continuation.action)){
          if(job.nextRunAt===null)return unchangedLibrary(null);
          job.nextRunAt=null;return null;
        }
      }
      const now = new Date();
      let run = (companyRecoveryEnabled(job)?job.runs.find(item=>item.companyRepair?.required===true&&item.status==='repairing'):null)||job.runs.find(
        (item) =>
          [
            'queued',
            'preparing',
            'generating',
            'repairing',
            'awaiting_sources',
            'awaiting_clip_review',
            'awaiting_review',
          ].includes(item.status) ||
          (['partial', 'failed'].includes(item.status) && !isCompanyRunExhausted(library,job,item) &&
            Number(item.generatedCount || 0) < Number(item.targetCount || 0) &&
            isRecoverableAutoPipelineError(item.errorMessage)),
      );
      if (run && REVIEW_HOLD_STATUSES.has(run.status) && !run.resumeRequestedAt) return unchangedLibrary(null);
      if (!run) {
        if (
          !job.nextRunAt ||
          new Date(job.nextRunAt).getTime() > now.getTime()
        ) {
          return unchangedLibrary(null);
        }
        const readiness = buildAutoReadiness(
          library,
          job.frameworkId,
          job.productCategory,
          job.dailyTarget,
          job.targetDurationSeconds,
          job.id,
        );
        run = {
          id: randomUUID(),
          dateKey: shanghaiDateKey(now),
          status: 'queued',
          targetCount: job.id===HISTORICAL_INVENTORY_JOB?Math.min(job.dailyTarget,Math.max(0,20-basicWorkCount(library,job))):job.dailyTarget,
          targetDurationSeconds:
            Number(job.targetDurationSeconds) ||
            AUTO_REMIX_DEFAULT_DURATION_SECONDS,
          generatedCount: 0,
          failedCount: 0,
          renderIds: [],
          selectedAssetIds: [],
          selectedSourceIds: [],
          ...(job.productCategory==='黑晶面膜'&&!historicalInventoryEnabled({jobId:job.id,autoApproveOutputs:job.autoApproveOutputs})?{onDemandSourcePreparation:{mode:'bounded-on-demand-v1',
            limit:normalizedSourceSelectionLimit(job.sourceSelectionLimit)}}:{}),
          createdClipIds: [],
          stageReports: freshAutomationStageReports(),
          slotSelections: readiness.slotSelections,
          startCursor: job.combinationCursor || 0,
          startedAt: null,
          completedAt: null,
          errorMessage: '',
          recoveryCount: 0,
          lastRecoveredAt: null,
          lastRecoveryMessage: '',
        };
        job.runs.unshift(run);
        job.runs = job.runs.slice(0, 30);
      }
      const resumeStatus = run.status;
      delete run.resumeRequestedAt;
      const resumeNeedsSources = [
        'awaiting_sources',
        'awaiting_clip_review',
        'partial',
        'failed',
      ].includes(run.status);
      const linkedRenders = automationRendersForRun(library, job.id, run.id);
      const outputStats = automaticOutputStats(linkedRenders);
      run.renderIds = linkedRenders.map((render) => render.id);
      run.generatedCount = outputStats.approvedCount;
      run.attemptedCount = outputStats.attemptedCount;
      run.failedCount = outputStats.rejectedCount;
      run.selectedAssetIds = Array.isArray(run.selectedAssetIds)
        ? run.selectedAssetIds
        : [];
      run.selectedSourceIds = Array.isArray(run.selectedSourceIds)
        ? run.selectedSourceIds
        : [];
      run.createdClipIds = Array.isArray(run.createdClipIds)
        ? run.createdClipIds
        : [];
      run.targetDurationSeconds =
        Number(run.targetDurationSeconds) ||
        Number(job.targetDurationSeconds) ||
        AUTO_REMIX_DEFAULT_DURATION_SECONDS;
      run.stageReports = normalizedAutomationStageReports(run.stageReports);
      if (resumeNeedsSources&&!historicalInventoryEnabled({jobId:job.id,autoApproveOutputs:job.autoApproveOutputs})) {
        const freshReports = freshAutomationStageReports();
        run.stageReports = run.stageReports.map((report) =>
          [
            'source_selection',
            'source_slicing',
            'clip_calibration',
            'clip_review',
          ].includes(report.key)
            ? freshReports.find((item) => item.key === report.key)
            : report,
        );
        run.selectedAssetIds = [];
        run.selectedSourceIds = [];
        run.selectedLocalSourceIds = [];
      }
      run.status = outputStats.rejectedCount ? 'repairing' : 'preparing';
      run.startedAt ||= nowIso();
      run.completedAt = null;
      job.updatedAt = nowIso();
      return { jobId: job.id, runId: run.id, resumeStatus };
    });

  const processAutoJob = async (jobId) => {
    if(Date.now()<(storageConflictRetryAfter.get(jobId)||0))return;
    storageConflictRetryAfter.delete(jobId);
    if (activeAutoJobIds.has(jobId)) return;
    activeAutoJobIds.add(jobId);
    try {
      // Check dependencies before slicing, rendering, or allocating a new run.
      // Only already-active jobs retry; this never resumes a user-paused job.
      const pipelineReady = await updateLibrary(library => {
        const job = library.autoJobs.find(item => item.id === jobId);
        if (!job || job.status !== 'active' || job.archivedAt || !ownerCanUseAutomation(library, job)) return unchangedLibrary(false);
        const preflight = automaticPipelineReadiness(job,{cloudConfigured:materialCenter?.configured});
        if (!preflight.ready) {
          job.automationPreflight = {...preflight,checkedAt:nowIso()};
          job.nextRunAt = new Date(Date.parse(nowIso()) + 300_000).toISOString();
          job.updatedAt = nowIso();
          return false;
        }
        if (!job.automationPreflight) return unchangedLibrary(true);
        delete job.automationPreflight;
        return true;
      });
      if (!pipelineReady) return;
      const prepared = await prepareAutoRun(jobId);
      if (!prepared) return;
      const protocolLibrary=await readLibrary(),protocolJob=protocolLibrary.autoJobs.find(job=>job.id===jobId);
      const historicalRun=historicalInventoryEnabled({jobId,autoApproveOutputs:protocolJob?.autoApproveOutputs});
      if(!historicalRun&&protocolJob.autoApproveOutputs===true)await performBasicPreproduction(jobId,prepared.runId);
      // This exact server-owned migration reuses approved inventory. It does not
      // re-run old source recognition, reset preparation receipts or enlarge quotas.
      const progressivePreparation=historicalRun?null:await ensureProgressiveSourceBatch(jobId,prepared.runId);
      const beforePreparation=await readLibrary();
      const preparingJob=beforePreparation.autoJobs.find(item=>item.id===jobId);
      const preparingRun=preparingJob?.runs.find(item=>item.id===prepared.runId);
      const needsVersionBackfill=!historicalRun&&!progressivePreparation?.runAlreadyComplete && preparingJob && preparingRun &&
        (await versionBackfillCandidates(beforePreparation,preparingJob,preparingRun)).length>0;
      const basicSourceShortfall=protocolJob.autoApproveOutputs===true&&preparingJob&&preparingRun&&
        onDemandSourceShortfall(beforePreparation,preparingJob,preparingRun);
      const fixedSourceBackoff=preparingRun?.onDemandSourcePreparation?.sourceIds?.length>0&&
        !needsVersionBackfill&&!progressivePreparation?.materializationPending&&prepared.resumeStatus==='awaiting_review';
      if (!historicalRun&&!progressivePreparation?.runAlreadyComplete&&
          (protocolJob.autoApproveOutputs===true?basicSourceShortfall&&!fixedSourceBackoff:
            prepared.resumeStatus !== 'awaiting_review' || needsVersionBackfill||progressivePreparation?.materializationPending)) {
        await performAutoPreproduction(jobId, prepared.runId);
      }
      await reconcileAutomaticOutputReviews(jobId, prepared.runId);
      const canGenerate = await updateLibrary((library) => {
        const job = library.autoJobs.find((item) => item.id === jobId);
        const run = job?.runs.find((item) => item.id === prepared.runId);
        if (!job || !run) return false;
        // A source/clip callback may finish after the owner's explicit pause.
        // Keep its saved evidence, but never re-arm the paused job's schedule.
        if(job.status!=='active'||job.archivedAt||!ownerCanUseAutomation(library,job)){
          job.nextRunAt=null;return false;
        }
        let readiness = buildAutoReadiness(
          library,
          job.frameworkId,
          job.productCategory,
          job.dailyTarget,
          run.targetDurationSeconds,
          job.id,
        );
        const linkedRenders = automationRendersForRun(
          library,
          jobId,
          prepared.runId,
        );
        const outputStats = automaticOutputStats(linkedRenders);
        let openingCandidates =
          readiness.slotSelections[readiness.openingSlotId] || [];
        const usedOpeningIds = new Set(
          outputStats.variants
            .filter((variant) => variant.reviewStatus === 'approved' || replacementEligible(variant))
            .map((variant) => variant.clipSequence?.[0] || '')
            .filter(Boolean),
        );
        let availableOpeningCount = openingCandidates.filter(
          (clipId) => !usedOpeningIds.has(clipId),
        ).length;
        const remainingTarget = Math.max(
          0,
          run.targetCount - outputStats.approvedCount,
        );
        if (job.autoApproveOutputs === true && remainingTarget > 0) {
          const qualified = buildReviewedReadiness(library, job, run.targetDurationSeconds, usedOpeningIds);
          if (!qualified.canProduce && !qualified.evidenceAvailable) {
            if(run.onDemandSourcePreparation?.sourceIds?.length)qualified.reviewEvidenceMessage+=
              ` 本批固定 ${run.onDemandSourcePreparation.sourceIds.length} 条候选来源；仅按退避重试同源，不扩展全库，未解决的真实缺口继续保留。`;
            if(run.onDemandSourcePreparation?.sourceIds?.length||run.progressiveSourcePreparation){
              holdAutomaticReview(job,run,{kind:'source_evidence',reason:'source_evidence_missing',summary:qualified.reviewEvidenceMessage},nowIso());
            }else{
              // A normal inventory shortage is retryable source work, not a
              // content-review hold. Re-enter selection on the same run.
              run.status='awaiting_sources';run.completedAt=null;run.errorMessage=qualified.reviewEvidenceMessage;
              job.nextRunAt=nextAutoRemediationAt();job.updatedAt=nowIso();
            }
            for (const key of ['remix_generation','output_review']) patchRunStageReport(run,key,{
              status:'blocked',summary:qualified.reviewEvidenceMessage,
              processedCount:outputStats.attemptedCount,passedCount:outputStats.approvedCount,
              evidence:[`具备完整自动审核依据的切片：${qualified.approvedClipCount} 条`,`原批次与 ${outputStats.approvedCount} 条已合格成片保留；不会重复生成两条后再报错。`],completedAt:nowIso(),
            });
            return false;
          }
          readiness = qualified;
          openingCandidates = readiness.slotSelections[readiness.openingSlotId] || [];
          availableOpeningCount = openingCandidates.filter(clipId=>!usedOpeningIds.has(clipId)).length;
        }
        run.slotSelections = readiness.slotSelections;
        const currentPoolFingerprint = slotSelectionFingerprint(
          readiness.slotSelections,
        );
        if (run.attemptPoolFingerprint !== currentPoolFingerprint) {
          run.attemptPoolFingerprint = currentPoolFingerprint;
          run.attemptWindowStartCount = outputStats.attemptedCount;
        } else if (!Number.isFinite(Number(run.attemptWindowStartCount))) {
          run.attemptWindowStartCount = outputStats.attemptedCount;
        }
        run.generatedCount = outputStats.approvedCount;
        run.attemptedCount = outputStats.attemptedCount;
        run.failedCount = outputStats.rejectedCount;
        if (
          remainingTarget > 0 &&
          (!readiness.canProduce || availableOpeningCount < 1)
        ) {
          if(historicalRun){
            holdAutomaticReview(job,run,{kind:'sequence_capacity',reason:'HISTORICAL_INVENTORY_CAPACITY',summary:'当前历史已审核库存的完整角色、时长或未重复开头不足；保留原批次，不启动原片识别或自动扩源。'},nowIso());
            return false;
          }
          run.status = 'awaiting_sources';
          run.completedAt = null;
          run.errorMessage =
            [
              ...readiness.blockingReasons,
              availableOpeningCount < remainingTarget
                ? `仍需 ${remainingTarget} 条合格成片，但只剩 ${availableOpeningCount} 条未使用开头；系统将继续自动补源。`
                : '',
            ]
              .filter(Boolean)
              .join(' ') ||
            `当前系统审核通过的真实组合上限为 ${readiness.maxDailyTarget} 条，低于本批目标。`;
          patchRunStageReport(run, 'remix_generation', {
            status: 'blocked',
            summary: '合格切片或不同开头不足，系统将自动继续补源后续跑',
            evidence: [
              ...readiness.blockingReasons,
              `待补合格成片：${remainingTarget} 条`,
              `可用未重复开头：${availableOpeningCount} 条`,
            ],
            completedAt: nowIso(),
          });
          patchRunStageReport(run, 'output_review', {
            status: outputStats.attemptedCount ? 'partial' : 'pending',
            totalCount: outputStats.attemptedCount,
            processedCount: outputStats.attemptedCount,
            passedCount: outputStats.approvedCount,
            reviewRequiredCount: 0,
            failedCount: outputStats.rejectedCount,
            summary: outputStats.attemptedCount
              ? `已有 ${outputStats.rejectedCount} 条不合格成片被自动退回；补源后继续重剪。`
              : '等待自动补齐合格切片后生成并审核成片。',
            completedAt: outputStats.attemptedCount ? nowIso() : null,
          });
          job.nextRunAt = nextAutoRemediationAt();
          job.updatedAt = nowIso();
          return false;
        }
        run.status = outputStats.rejectedCount ? 'repairing' : 'generating';
        run.errorMessage = '';
        patchRunStageReport(run, 'remix_generation', {
          status: 'running',
          totalCount: run.targetCount,
          processedCount: outputStats.attemptedCount,
          passedCount: outputStats.approvedCount,
          reviewRequiredCount: 0,
          failedCount: outputStats.rejectedCount,
          summary: outputStats.rejectedCount
            ? '正在替换未通过审核的成片并继续重剪'
            : '正在按系统审核通过的切片池生成成片',
          evidence: [
            `系统审核通过切片：${readiness.approvedClipCount} 条`,
            `真实组合上限：${readiness.combinationCapacity} 条`,
            `可用不同开头：${readiness.uniqueOpenerCount} 条；同批开头不重复`,
            `当前角色切片池最多可拼约 ${readiness.maxComposableDurationSeconds} 秒；目标 ${run.targetDurationSeconds} 秒`,
            '剧情演绎切片仅允许位于成片首段。',
          ],
          startedAt: nowIso(),
          completedAt: null,
        });
        patchRunStageReport(run, 'output_review', {
          status: 'running',
          totalCount: run.targetCount,
          processedCount: outputStats.attemptedCount,
          passedCount: outputStats.approvedCount,
          reviewRequiredCount: 0,
          failedCount: outputStats.rejectedCount,
          summary: '成片生成后立即自动审核，不合格即退回重剪',
          evidence: [],
          startedAt: nowIso(),
          completedAt: null,
        });
        job.updatedAt = nowIso();
        return true;
      });
      if (!canGenerate) return;
      while (true) {
        const library = await readLibrary();
        const job = library.autoJobs.find((item) => item.id === jobId);
        const run = job?.runs.find((item) => item.id === prepared.runId);
        if (!job || !run) return;
        if (job.status !== 'active' || job.archivedAt || !ownerCanUseAutomation(library,job)) {
          await updateLibrary((latest) => {
            const latestJob = latest.autoJobs.find((item) => item.id === jobId);
            const latestRun = latestJob?.runs.find(
              (item) => item.id === prepared.runId,
            );
            if (
              latestRun &&
              ['preparing', 'generating', 'repairing'].includes(
                latestRun.status,
              )
            ) {
              latestRun.status = 'queued';
            }
          });
          return;
        }
        const linkedRenders = automationRendersForRun(library, job.id, run.id);
        const outputStats = automaticOutputStats(linkedRenders);
        if (outputStats.approvedCount >= run.targetCount) {
          await updateLibrary((latest) => {
            const latestJob = latest.autoJobs.find((item) => item.id === jobId);
            const latestRun = latestJob?.runs.find(
              (item) => item.id === prepared.runId,
            );
            if (!latestJob || !latestRun) return;
            const latestRenders = automationRendersForRun(
              latest,
              jobId,
              prepared.runId,
            );
            latestRun.renderIds = latestRenders.map((render) => render.id);
            const latestStats = automaticOutputStats(latestRenders);
            latestRun.generatedCount = latestStats.approvedCount;
            latestRun.attemptedCount = latestStats.attemptedCount;
            latestRun.failedCount = latestStats.rejectedCount;
            patchRunStageReport(latestRun, 'remix_generation', {
              status: 'completed',
              totalCount: latestRun.targetCount,
              processedCount: latestStats.attemptedCount,
              passedCount: latestStats.approvedCount,
              reviewRequiredCount: 0,
              failedCount: latestStats.rejectedCount,
              summary: `已生成成片，审核${approvalSummary(latestStats)}；待处理 ${latestStats.rejectedCount} 条`,
              completedAt: nowIso(),
            });
            patchRunStageReport(latestRun, 'output_review', {
              status: 'completed',
              totalCount: latestStats.attemptedCount,
              processedCount: latestStats.attemptedCount,
              passedCount: latestStats.approvedCount,
              reviewRequiredCount: 0,
              failedCount: latestStats.rejectedCount,
              summary: `成片审核${approvalSummary(latestStats)}；待处理 ${latestStats.rejectedCount} 条`,
              evidence: [
                historicalRun?`既有批准切片复用＋本次真实技术/结构质检通过：${latestStats.automaticApprovedCount} 条`:`自动内容复核通过：${latestStats.automaticApprovedCount} 条`,
                `人工复核通过：${latestStats.humanApprovedCount} 条；历史审核保留：${latestStats.legacyApprovedCount} 条`,
                '人工与历史审核不计为全自动内容复核；回传仍核对原文件版本，未登记摘要的历史成片需重新审核。',
              ],
              completedAt: nowIso(),
            });
            latestRun.status = 'completed';
            if(latestRun.companyRepair)latestRun.companyRepair.required=false;
            latestRun.completedAt = nowIso();
            latestJob.combinationCursor =
              (latestRun.startCursor || 0) + latestStats.attemptedCount;
            latestJob.lastRunAt = latestRun.completedAt;
            latestJob.nextRunAt = latestJob.status==='active'&&!latestJob.archivedAt&&ownerCanUseAutomation(latest,latestJob)
              ?nextAutoJobSchedule(latestJob):null;
            latestJob.updatedAt = nowIso();
          });
          const completedLibrary = await readLibrary();
          for (const render of automationRendersForRun(
            completedLibrary,
            jobId,
            prepared.runId,
          )) {
            for (const variant of render.variants) {
              if (variant.reviewStatus === 'approved') {
                void maybeAutoReturnVariant(render, variant).catch((error) => {
                  console.error('Automatic material return error:', error);
                });
              }
            }
          }
          return;
        }
        const attemptWindowStartCount = Math.max(
          0,
          Number(run.attemptWindowStartCount) || 0,
        );
        let maximumAttempts =
          attemptWindowStartCount +
          Math.max(
            run.targetCount,
            run.targetCount * AUTO_REMIX_MAX_OUTPUT_ATTEMPT_MULTIPLIER,
          );
        if(progressiveSourceJobIds.has(jobId)||historicalRun){
          const total=progressiveOutputUsage(library,job);
          maximumAttempts=Math.min(run.targetCount*AUTO_REMIX_MAX_OUTPUT_ATTEMPT_MULTIPLIER,
            outputStats.attemptedCount+Math.max(0,PROGRESSIVE_OUTPUT_ATTEMPT_LIMIT-total.attempts));
        }
        const openingSlotId = getFramework(library, job.frameworkId)?.slots?.[0]
          ?.id;
        const usedOpeningIds = new Set(
          outputStats.variants
            .filter((variant) => variant.reviewStatus === 'approved' || replacementEligible(variant))
            .map((variant) => variant.clipSequence?.[0] || '')
            .filter(Boolean),
        );
        const availableOpeningCount = openingSlotId
          ? (run.slotSelections?.[openingSlotId] || []).filter(
              (clipId) => !usedOpeningIds.has(clipId),
            ).length
          : 0;
        if (availableOpeningCount === 0) {
          const replacementPool = job.autoApproveOutputs && buildReviewedReadiness(library,job,run.targetDurationSeconds,usedOpeningIds);
          if (replacementPool?.canProduce) {
            await updateLibrary(latest => {
              const currentJob = latest.autoJobs.find(item=>item.id===jobId);
              const currentRun = currentJob?.runs.find(item=>item.id===prepared.runId);
              if (!currentRun || currentJob.status!=='active' || !ownerCanUseAutomation(latest,currentJob)) return;
              currentRun.slotSelections = replacementPool.slotSelections;
              currentRun.attemptPoolFingerprint = slotSelectionFingerprint(replacementPool.slotSelections);
              currentRun.attemptWindowStartCount = outputStats.attemptedCount;
            });
            continue;
          }
          await updateLibrary((latest) => {
            const latestJob = latest.autoJobs.find((item) => item.id === jobId);
            const latestRun = latestJob?.runs.find(
              (item) => item.id === prepared.runId,
            );
            if (!latestJob || !latestRun) return;
            if(historicalRun){
              holdAutomaticReview(latestJob,latestRun,{kind:'sequence_capacity',reason:'HISTORICAL_INVENTORY_CAPACITY',summary:'本批历史库存未重复开头已用完，保留已完成成片；未重新审核原片或扩源。'},nowIso());
              return;
            }
            latestRun.status = 'awaiting_sources';
            latestRun.generatedCount = outputStats.approvedCount;
            latestRun.attemptedCount = outputStats.attemptedCount;
            latestRun.failedCount = outputStats.rejectedCount;
            latestRun.errorMessage = `本批未重复开头已用完，当前合格 ${outputStats.approvedCount}/${latestRun.targetCount} 条；系统将自动补源后继续重剪。`;
            patchRunStageReport(latestRun, 'remix_generation', {
              status: 'blocked',
              processedCount: outputStats.attemptedCount,
              passedCount: outputStats.approvedCount,
              failedCount: outputStats.rejectedCount,
              summary: latestRun.errorMessage,
              completedAt: nowIso(),
            });
            patchRunStageReport(latestRun, 'output_review', {
              status: 'partial',
              totalCount: outputStats.attemptedCount,
              processedCount: outputStats.attemptedCount,
              passedCount: outputStats.approvedCount,
              reviewRequiredCount: 0,
              failedCount: outputStats.rejectedCount,
              summary: '不合格成片已自动退回；等待补充不同开头后继续重剪。',
              completedAt: nowIso(),
            });
            latestJob.nextRunAt = latestJob.status==='active'&&!latestJob.archivedAt&&ownerCanUseAutomation(latest,latestJob)
              ?nextAutoRemediationAt():null;
            latestJob.updatedAt = nowIso();
          });
          return;
        }
        if (outputStats.attemptedCount >= maximumAttempts) {
          if(progressiveSourceJobIds.has(jobId)||historicalRun)throw Object.assign(new Error('已达到原批次或整个任务的生成尝试上限，未重置计数或轮换来源继续生成。'),{code:'PROGRESSIVE_RUN_ATTEMPT_LIMIT'});
          await updateLibrary((latest) => {
            const latestJob = latest.autoJobs.find((item) => item.id === jobId);
            const latestRun = latestJob?.runs.find(
              (item) => item.id === prepared.runId,
            );
            if (!latestJob || !latestRun) return;
            latestRun.status = 'awaiting_sources';
            latestRun.generatedCount = outputStats.approvedCount;
            latestRun.attemptedCount = outputStats.attemptedCount;
            latestRun.failedCount = outputStats.rejectedCount;
            latestRun.errorMessage = `系统已自动尝试 ${outputStats.attemptedCount} 条组合，合格 ${outputStats.approvedCount}/${latestRun.targetCount} 条；将补充新切片后继续。`;
            patchRunStageReport(latestRun, 'remix_generation', {
              status: 'blocked',
              processedCount: outputStats.attemptedCount,
              passedCount: outputStats.approvedCount,
              reviewRequiredCount: 0,
              failedCount: outputStats.rejectedCount,
              summary: latestRun.errorMessage,
              completedAt: nowIso(),
            });
            patchRunStageReport(latestRun, 'output_review', {
              status: 'partial',
              totalCount: outputStats.attemptedCount,
              processedCount: outputStats.attemptedCount,
              passedCount: outputStats.approvedCount,
              reviewRequiredCount: 0,
              failedCount: outputStats.rejectedCount,
              summary: latestRun.errorMessage,
              completedAt: nowIso(),
            });
            latestJob.nextRunAt = latestJob.status==='active'&&!latestJob.archivedAt&&ownerCanUseAutomation(latest,latestJob)
              ?nextAutoRemediationAt():null;
            latestJob.updatedAt = nowIso();
          });
          return;
        }
        const chunkSize = Math.min(
          AUTO_REMIX_RENDER_CHUNK_SIZE,
          run.targetCount - outputStats.approvedCount,
          maximumAttempts - outputStats.attemptedCount,
          availableOpeningCount,
          progressiveSourceJobIds.has(jobId)||historicalRun?Math.max(0,20-(job.reviewPolicy===BASIC_REVIEW_POLICY?basicWorkCount(library,job):progressiveOutputUsage(library,job).approved)):Infinity,
        );
        if(chunkSize<1&&(progressiveSourceJobIds.has(jobId)||historicalRun))throw Object.assign(new Error('本任务已有20条审核合格成片，未额外生成；回传与投放继续沿原门禁。'),{code:'PROGRESSIVE_TARGET_REACHED'});
        await updateAutoRunStage(jobId, prepared.runId, 'remix_generation', {
          currentItem: `正在进行第 ${outputStats.attemptedCount + 1}–${
            outputStats.attemptedCount + chunkSize
          } 次组合，已合格 ${outputStats.approvedCount}/${run.targetCount} 条`,
        });
        const render = await renderVariants(
          {
            name: `${job.name}-${run.dateKey}`,
            frameworkId: job.frameworkId,
            slotSelections: run.slotSelections,
            maxOutputs: chunkSize,
            includeUsageDisclaimer: job.includeUsageDisclaimer,
            usageDisclaimerText: job.usageDisclaimerText,
            targetDurationSeconds: run.targetDurationSeconds,
          },
          {
            jobId: job.id,
            runId: run.id,
            productCategory: job.productCategory,
            createdById: job.createdById,
            createdByName: job.createdByName,
            combinationOffset:
              (run.startCursor || 0) + outputStats.attemptedCount,
            outputNumberOffset: outputStats.attemptedCount,
            dateKey: run.dateKey,
            autoApproveOutputs: job.autoApproveOutputs === true,
            clipWeights: job.performanceLearning?.clipWeights || {},
          },
        );
        await updateLibrary((latest) => {
          const latestJob = latest.autoJobs.find((item) => item.id === jobId);
          const latestRun = latestJob?.runs.find(
            (item) => item.id === prepared.runId,
          );
          if (!latestJob || !latestRun) return;
          if (!latestRun.renderIds.includes(render.id)) {
            latestRun.renderIds.push(render.id);
          }
          const currentRenders = automationRendersForRun(
            latest,
            jobId,
            prepared.runId,
          );
          const currentStats = automaticOutputStats(currentRenders);
          if (render.variants.length) delete latestRun.sourceDurationGap;
          latestRun.generatedCount = currentStats.approvedCount;
          latestRun.attemptedCount = currentStats.attemptedCount;
          latestRun.failedCount = currentStats.rejectedCount;
          patchRunStageReport(latestRun, 'remix_generation', {
            processedCount: currentStats.attemptedCount,
            passedCount: currentStats.approvedCount,
            failedCount: currentStats.rejectedCount,
            summary: `审核${approvalSummary(currentStats)}，目标 ${latestRun.targetCount} 条；已尝试 ${currentStats.attemptedCount} 条组合`,
          });
          patchRunStageReport(latestRun, 'output_review', {
            totalCount: currentStats.attemptedCount,
            processedCount: currentStats.attemptedCount,
            passedCount: currentStats.approvedCount,
            reviewRequiredCount: 0,
            failedCount: currentStats.rejectedCount,
            summary: `审核${approvalSummary(currentStats)}；待处理 ${currentStats.rejectedCount} 条`,
          });
          latestJob.updatedAt = nowIso();
        });
        const contentAttention = render.variants.filter(needsVisualAttention);
        const definitiveFailures=[];
        if(sourceReviewQuotaPolicy?.jobId===jobId&&progressiveSourceJobIds.has(jobId)
          &&Number(run.consecutiveReviewFailures)>=2&&contentAttention.length===render.variants.length
          &&contentAttention.length&&typeof sourceVersionResolver==='function') {
          const currentLibrary=await readLibrary(),currentRender=currentLibrary.renders.find(item=>item.id===render.id);
          for(const variant of currentRender?.variants||[]) {
            const frozen=JSON.stringify(variant),state=bindingState(currentRender,variant,currentLibrary);
            const allowed=async()=>{
              const latest=await readLibrary(),liveJob=latest.autoJobs.find(item=>item.id===jobId);
              const liveRender=latest.renders.find(item=>item.id===render.id),live=liveRender?.variants.find(item=>item.id===variant.id);
              if(!live||JSON.stringify(live)!==frozen||!liveJob||!canPerformAutomaticEffects(latest,liveJob,liveRender)
                ||hasPlatformQuarantine(live))return false;
              const binding=bindingState(liveRender,live,latest);
              const markers=[liveRender,live].filter(value=>Object.hasOwn(value,'sourceEvidencePolicy'));
              const records=[liveRender,live,...binding.clips,...binding.clips.map(clip=>getSource(latest,clip.sourceId))];
              // This is proof of a refusal, not the external-effects admission
              // gate: changes_requested is the required failed-output state.
              // Explicit withdrawals and all current source/clip gates remain.
              if(!markers.length||markers.some(value=>value.sourceEvidencePolicy!==SOURCE_EVIDENCE_POLICY)
                ||records.some(value=>!value||value.revoked===true||value.revokedAt||value.disabled===true||value.deliveryBlocked===true)
                ||binding.clips.some(clip=>clip.reviewStatus!=='approved'||getSource(latest,clip.sourceId)?.productCategory!=='黑晶面膜'
                  ||['rejected','changes_requested'].includes(getSource(latest,clip.sourceId)?.reviewStatus)))return false;
              return binding.reason===null&&binding.current.review===state.current?.review
                &&binding.current.content===state.current?.content;
            };
            const verified=await verifyDefinitiveContentFailure({directory:path.join(root,'visual-reviews'),
              allowedJobIds:[sourceReviewQuotaPolicy.jobId],jobId,render:currentRender,variant,library:currentLibrary,
              model:visionConnection(visualQuality.env).model,hashOutputFile:()=>hashFile(path.join(outputsDir,variant.storedName)),
              assertCurrent:allowed,verifyInputs:async()=>{
                if(!(await allowed()))return false;
                await assertCurrentVersionedClips(state.clips,currentLibrary,allowed,jobId);return true;
              }});
            if(!verified.verified)break;
            definitiveFailures.push({variantId:variant.id,...verified});
          }
        }
        const verifiedContentFailureJobId=definitiveFailures.length===render.variants.length&&definitiveFailures.length?jobId:null;
        const historicalFailed=historicalRun&&render.variants.some(variant=>!historicalRulesVariantPassed(variant));
        const reviewDecision = job.autoApproveOutputs===true
          ? {action:'continue',consecutive:render.variants.some(v=>!basicVariantPassed(v))?Number(run.consecutiveReviewFailures||0)+1:0}
          : historicalFailed
          ?{action:'stop',consecutive:Number(run.consecutiveReviewFailures)||0,reason:'本次成片真实技术检查或历史切片当前文件核验未通过，原文件与失败原因已保留；未改写旧批准或继续消耗模型。'}
          :automaticReviewDecision(job, run, render.variants,{verifiedContentFailureJobId});
        const manualReviewRequired = reviewDecision.action === 'manual';
        if (reviewDecision.action === 'stop') {
          await updateLibrary(latest => {
            const currentJob = latest.autoJobs.find(item => item.id === jobId);
            const currentRun = currentJob?.runs.find(item => item.id === prepared.runId);
            if (!currentJob || !currentRun) return;
            const sourceWait = contentAttention.some(v => ['source_evidence_missing','source_binding_changed','sku_or_source_binding'].includes(v.automaticAssessment?.visualReview?.reason));
            holdAutomaticReview(currentJob,currentRun,{reason:contentAttention[0]?.automaticAssessment?.visualReview?.reason || 'quality_review',summary:reviewDecision.reason,kind:sourceWait?'source_evidence':'dependency'},nowIso());
            currentRun.consecutiveReviewFailures = reviewDecision.consecutive;
            for (const key of ['remix_generation', 'output_review']) {
              patchRunStageReport(currentRun, key, {status:'blocked', reviewRequiredCount:contentAttention.length, summary:reviewDecision.reason, completedAt:nowIso()});
            }
          });
        } else if (manualReviewRequired) {
          await updateLibrary(latest => {
            const currentJob=latest.autoJobs.find(item=>item.id===jobId);
            const currentRun=currentJob?.runs.find(item=>item.id===prepared.runId);
            if (!currentJob || !currentRun) return;
            currentJob.status='paused';currentJob.nextRunAt=null;currentJob.updatedAt=nowIso();
            currentRun.status='awaiting_review';currentRun.completedAt=null;
            currentRun.errorMessage=manualReviewRequired
              ? '本计划未启用自动审核，成片已保存，等待人工审核后恢复原批次。'
              : '内容复核需处理，自动计划已暂停：'+contentAttention.map(v=>v.automaticAssessment.visualReview.summary).join('；').slice(0,800);
            patchRunStageReport(currentRun,'remix_generation',{status:'partial',currentItem:'',summary:'本轮成片已保存，因内容复核需处理暂停。',completedAt:nowIso()});
            patchRunStageReport(currentRun,'output_review',{status:'partial',reviewRequiredCount:manualReviewRequired ? render.variants.length : contentAttention.length,summary:currentRun.errorMessage,completedAt:nowIso()});
          });
        }
        for (const variant of render.variants) {
          if (variant.reviewStatus === 'approved') {
            void maybeAutoReturnVariant(render, variant).catch((error) => {
              console.error('Automatic material return error:', error);
            });
          }
        }
        if (reviewDecision.action !== 'continue') return;
        await updateLibrary(latest => {
          const currentRun = latest.autoJobs.find(item => item.id === jobId)?.runs.find(item => item.id === prepared.runId);
          if (!currentRun) return;
          currentRun.consecutiveReviewFailures = reviewDecision.consecutive;
          if(reviewDecision.boundedReplacement)currentRun.boundedReplacementDecisions=[...(currentRun.boundedReplacementDecisions||[]),
            {renderId:render.id,at:nowIso(),consecutive:reviewDecision.consecutive,failures:definitiveFailures,
              approvalGranted:false,countersReset:false,runAttemptLimit:maximumAttempts,jobAttemptLimit:PROGRESSIVE_OUTPUT_ATTEMPT_LIMIT}];
          patchRunStageReport(currentRun, 'output_review', {
            reviewRequiredCount: outputStats.variants.concat(render.variants).filter(needsVisualAttention).length,
            summary: contentAttention.length ? '待复核成片已保留，继续生成替代组合；仅合格成片自动输出。' : '本轮自动复核完成，继续生成。',
          });
        });
      }
    } catch (error) {
      const recoverable = isRecoverableAutoPipelineError(error);
      const recoverySummary = autoRecoverySummary(error);
      // The recovery receipt can itself lose a CAS race. Keep a process-local
      // cooldown too, so that failure cannot create immediate retry hot loops.
      if(isLibraryConflict(error))storageConflictRetryAfter.set(jobId,Date.now()+AUTO_REMIX_REMEDIATION_DELAY_MS);
      await updateLibrary((library) => {
        const job = library.autoJobs.find((item) => item.id === jobId);
        const run = job?.runs.find((item) =>
          ['preparing', 'generating', 'repairing', 'awaiting_sources'].includes(
            item.status,
          ),
        );
        if (!job || !run) return;
        if (error?.code === 'AUTOMATION_STOPPED' || job.status !== 'active' || !ownerCanUseAutomation(library,job)) {
          run.status = 'queued';
          job.nextRunAt = null;
          return;
        }
        const linkedRenders = automationRendersForRun(library, job.id, run.id);
        run.renderIds = linkedRenders.map((render) => render.id);
        const outputStats = automaticOutputStats(linkedRenders);
        run.generatedCount = outputStats.approvedCount;
        run.attemptedCount = outputStats.attemptedCount;
        run.failedCount = outputStats.rejectedCount;
        if(isLibraryConflict(error)){
          run.status='queued';run.completedAt=null;run.errorMessage=recoverySummary;
          run.storageConflict={code:'METADATA_CONFLICT',attempts:(run.storageConflict?.attempts||0)+1,lastAt:nowIso()};
          for(const report of normalizedAutomationStageReports(run.stageReports)){
            if(report.status==='running'||report.status==='failed')patchRunStageReport(run,report.key,{
              status:'retrying',summary:recoverySummary,completedAt:null,currentItem:'等待存储更新后继续原批次'});
          }
          job.nextRunAt=nextAutoRemediationAt();job.updatedAt=nowIso();return;
        }
        if(isLegacyDurationError(error)){
          holdAutomaticReview(job,run,{kind:'source_feasibility',reason:error.code,summary:error.message},nowIso());
          for(const key of ['source_selection','source_slicing','remix_generation'])patchRunStageReport(run,key,{status:'blocked',summary:error.message,completedAt:nowIso()});
          return;
        }
        if(String(error?.code||'').startsWith('PROGRESSIVE_')){
          run.progressiveSourceStatus={...run.progressiveSourceStatus,reason:error.code,checkedAt:nowIso()};
          holdAutomaticReview(job,run,{kind:error.code==='PROGRESSIVE_SOURCE_DURATION_EXHAUSTED'?'source_feasibility':'source_evidence',reason:error.code,summary:error.message},nowIso());
          for(const key of ['source_selection','remix_generation'])patchRunStageReport(run,key,{status:'blocked',summary:error.message,completedAt:nowIso()});
          return;
        }
        if(progressiveSourceJobIds.has(jobId)&&!historicalInventoryEnabled({jobId,autoApproveOutputs:job.autoApproveOutputs})&&['OUTPUT_SEQUENCE_EXHAUSTED','OUTPUT_SEQUENCE_SEARCH_LIMIT'].includes(error?.code)){
          run.sourceSequenceExhausted={reason:error.code,poolFingerprint:slotSelectionFingerprint(run.slotSelections),at:nowIso()};
          run.sequencePreflight={reason:error.code,...error.sequencePreflight,checkedAt:nowIso(),sourceExpansion:false};
          run.status='awaiting_sources';run.errorMessage=error.message;job.nextRunAt=nextAutoRemediationAt();
          patchRunStageReport(run,'remix_generation',{status:'blocked',summary:error.message,completedAt:nowIso()});return;
        }
        if(['OUTPUT_SEQUENCE_EXHAUSTED','OUTPUT_SEQUENCE_SEARCH_LIMIT','OUTPUT_SEQUENCE_PENDING','OUTPUT_SEQUENCE_CONFLICT','OUTPUT_SEQUENCE_STATE_INVALID'].includes(error?.code)){
          run.sequencePreflight={reason:error.code,...error.sequencePreflight,checkedAt:nowIso(),sourceExpansion:false};
          holdAutomaticReview(job,run,{kind:error.code==='OUTPUT_SEQUENCE_PENDING'?'sequence_reservation':'sequence_capacity',reason:error.code,summary:error.message},nowIso());
          for(const key of ['remix_generation','output_review'])patchRunStageReport(run,key,{status:'blocked',summary:error.message,
            processedCount:outputStats.attemptedCount,passedCount:outputStats.approvedCount,completedAt:nowIso()});
          return;
        }
        if (error?.code === 'SOURCE_EVIDENCE_MISSING') {
          holdAutomaticReview(job,run,{kind:'source_evidence',reason:error.admission?.reason || 'source_evidence_missing',summary:error.message},nowIso());
          for (const key of ['remix_generation','output_review']) patchRunStageReport(run,key,{status:'blocked',summary:error.message,processedCount:outputStats.attemptedCount,passedCount:outputStats.approvedCount,completedAt:nowIso()});
          return;
        }
        if(historicalInventoryEnabled({jobId,autoApproveOutputs:job.autoApproveOutputs})&&recoverable){
          holdAutomaticReview(job,run,{kind:'sequence_capacity',reason:error.code||'HISTORICAL_INVENTORY_CAPACITY',summary:recoverySummary},nowIso());
          return;
        }
        if (recoverable) {
          if (error?.code === 'SOURCE_DURATION_GAP') {
            run.sourceDurationGap = {targetDurationSeconds: run.targetDurationSeconds,
              detectedAt: nowIso(), message: recoverySummary};
          }
          run.status = 'awaiting_sources';
          run.completedAt = null;
          run.errorMessage = recoverySummary;
          run.recoveryCount = Math.max(0, Number(run.recoveryCount) || 0) + 1;
          run.lastRecoveredAt = nowIso();
          run.lastRecoveryMessage = recoverySummary;
          for (const report of normalizedAutomationStageReports(
            run.stageReports,
          )) {
            if (report.status !== 'running') continue;
            patchRunStageReport(run, report.key, {
              status: 'retrying',
              failedCount: report.failedCount || 0,
              summary: recoverySummary,
              evidence: [...report.evidence, recoverySummary],
              currentItem: '等待系统自动换源续跑',
              completedAt: null,
            });
          }
          job.status = 'active';
          job.nextRunAt = nextAutoRemediationAt();
          job.updatedAt = nowIso();
          return;
        }
        run.status = run.generatedCount ? 'partial' : 'failed';
        run.completedAt = nowIso();
        run.errorMessage =
          error instanceof Error ? error.message : '后台自动混剪失败。';
        for (const report of normalizedAutomationStageReports(
          run.stageReports,
        )) {
          if (report.status !== 'running') continue;
          patchRunStageReport(run, report.key, {
            status: 'failed',
            failedCount: Math.max(1, report.failedCount || 0),
            summary: run.errorMessage,
            evidence: [...report.evidence, run.errorMessage],
            completedAt: nowIso(),
          });
        }
        job.combinationCursor =
          (run.startCursor || 0) + outputStats.attemptedCount;
        job.status = 'error';
        job.nextRunAt = null;
        job.updatedAt = nowIso();
      });
    } finally {
      activeAutoJobIds.delete(jobId);
      requestAutoSchedulerTick();
    }
  };

  const maybeAutoDeliverTarget = async (
    render,
    variant,
    returnedAsset,
    requestedTarget,
  ) => {
    if (
      render.visibility === 'private' ||
      hasPlatformQuarantine(variant) ||
      variant.reviewStatus !== 'approved' ||
      !render.automation?.jobId ||
      !variant.automaticAssessment?.autoApproved
    ) {
      return null;
    }
    const targetIdentity = qianchuanTargetIdentity(requestedTarget);
    if (targetIdentity === ':') return null;
    const key = `${render.id}:${variant.id}:${targetIdentity}`;
    const existing = activeQianchuanDeliveryPromises.get(key);
    if (existing) return existing;
    const operation = (async () => {
      const library = await readLibrary();
      const currentRender = library.renders.find((item) => item.id === render.id);
      const currentVariant = currentRender?.variants.find((item) => item.id === variant.id);
      if (!currentVariant || currentRender.visibility === 'private' ||
          currentVariant.reviewStatus !== 'approved' || hasPlatformQuarantine(currentVariant)) return null;
      assertCurrentAutomaticReview(currentRender, currentVariant, library);
      const job = library.autoJobs.find(
        (item) => item.id === render.automation.jobId,
      );
      const config = normalizeQianchuanDelivery(job?.qianchuanDelivery);
      if (!job || !config.enabled) return null;
      if(basicOutputUnavailable(currentVariant))return null;
      if (currentVariant.reviewMode===BASIC_REVIEW_MODE && !basicCloudReviewMatches(currentRender,currentVariant)) return null;
      if(companyRecoveryEnabled(job)&&!currentCompanyPass(currentVariant))return null;
      if (!canPerformAutomaticEffects(library, job, currentRender)) return null;
      const target = config.targets.find(
        (candidate) => qianchuanTargetIdentity(candidate) === targetIdentity,
      );
      if (!target) return null;
      if (!returnedAsset?.assetId || !returnedAsset.assetAvailable) {
        throw new Error('成片尚未成功回传云管家，不能进入千川投放。');
      }
      const existingState = qianchuanStateForTarget(variant, target);
      const idempotencyKey =
        existingState?.idempotencyKey ||
        `wis-remix:${render.id}:${variant.id}:${returnedAsset.assetId}:${target.advertiserId}:${target.planId}`;
      const attemptedAt = nowIso();
      try {
        await assertVariantVersionedSources(currentRender,currentVariant,library);
        const result = await materialCenter.pushQianchuan({
          asset_id: returnedAsset.assetId,
          idempotency_key: idempotencyKey,
          product_category: render.productCategory,
          actor_number: job.createdById,
          actor_name: job.createdByName || 'WIS混剪工作台',
          enabled: true,
          confirmed: config.confirmed,
          delivery_limit_mode: config.deliveryLimitMode,
          daily_material_limit: config.dailyMaterialLimit,
          daily_spend_guard_yuan: config.dailySpendGuardYuan,
          target: {
            advertiser_id: target.advertiserId,
            advertiser_name: target.advertiserName,
            plan_id: target.planId,
            plan_name: target.planName,
            plan_alias: target.planAlias,
            plan_type: target.planType,
          },
        });
        await updateLibrary((latest) => {
          const latestRender = latest.renders.find(
            (item) => item.id === render.id,
          );
          const latestVariant = latestRender?.variants.find(
            (item) => item.id === variant.id,
          );
          if (!latestVariant) return;
          const status = result.task?.status || result.status || 'pending';
          const currentState = qianchuanStateForTarget(latestVariant, target);
          const retryCount = Math.max(0, Number(currentState?.retryCount) || 0);
          setQianchuanStateForTarget(latestVariant, target, {
            idempotencyKey,
            taskId: result.task?.id || '',
            status,
            message: result.task?.message || result.message || '',
            errorMessage: result.task?.errorMessage || '',
            errorAdvice: result.task?.errorAdvice || '',
            failureStage: result.task?.failureStage || '',
            advertiserId: target.advertiserId,
            advertiserName:
              result.task?.advertiserName || target.advertiserName,
            planId: target.planId,
            planName: result.task?.planName || target.planName,
            planAlias: target.planAlias,
            platformAssetId: result.task?.platformAssetId || '',
            bindingVerifiedAt: result.task?.bindingVerifiedAt || null,
            platformAudit: result.task?.platformAudit || null,
            lastErrorCategory: result.task?.lastErrorCategory || '',
            metrics: result.task?.metrics || {},
            metricsLinkStatus: result.task?.metricsLinkStatus || 'pending',
            metricsDataStatus: result.task?.metricsDataStatus || 'pending',
            metricsFreshThrough: result.task?.metricsFreshThrough || null,
            metricsCoverage: result.task?.metricsCoverage || {
              completed: 0,
              expected: 0,
            },
            attemptedAt,
            updatedAt: nowIso(),
            retryCount,
            nextRetryAt: ['partial', 'failed'].includes(status)
              ? new Date(
                  Date.now() +
                    qianchuanRetryDelayMs(
                      retryCount,
                      result.task?.message,
                      result.task?.errorMessage,
                      result.task?.errorAdvice,
                    ),
                ).toISOString()
              : null,
            nextPollAt: ['partial', 'failed'].includes(status)
              ? null
              : new Date(Date.now() + 60_000).toISOString(),
          });
        });
        return result;
      } catch (error) {
        const message =
          error instanceof Error ? error.message : '自动推送千川失败。';
        const deferredForCapacity = isQianchuanDailyCapacityDeferred(message);
        await updateLibrary((latest) => {
          const latestVariant = latest.renders
            .find((item) => item.id === render.id)
            ?.variants.find((item) => item.id === variant.id);
          if (!latestVariant) return;
          const currentState = qianchuanStateForTarget(latestVariant, target);
          const retryCount =
            Math.max(0, Number(currentState?.retryCount) || 0) + 1;
          const nextState = {
            ...(currentState || {}),
            idempotencyKey,
            status: deferredForCapacity ? 'deferred' : 'failed',
            message: '自动投放被安全门禁或千川接口阻断。',
            errorMessage: safeLabel(message, '自动推送千川失败'),
            errorAdvice:
              '系统将按同一任务幂等续跑；已有千川视频 ID 时只续绑计划，不重复上传。',
            failureStage: currentState?.platformAssetId
              ? 'plan_binding'
              : 'upload',
            advertiserId: target.advertiserId,
            advertiserName: target.advertiserName,
            planId: target.planId,
            planName: target.planName,
            planAlias: target.planAlias,
            attemptedAt,
            updatedAt: nowIso(),
            retryCount,
            nextRetryAt: shouldKeepRetryingExternalState(message)
              ? new Date(
                  Date.now() + qianchuanRetryDelayMs(retryCount - 1, message),
                ).toISOString()
              : null,
            nextPollAt: null,
            admissionBlock: workstationAdmissionBlock(error),
          };
          setQianchuanStateForTarget(
            latestVariant,
            target,
            deferredForCapacity
              ? deferQianchuanDeliveryForCapacity(nextState, message)
              : nextState,
          );
        });
        return {
          status: deferredForCapacity ? 'deferred' : 'failed',
          message,
        };
      }
    })();
    activeQianchuanDeliveryPromises.set(key, operation);
    try {
      return await operation;
    } finally {
      if (activeQianchuanDeliveryPromises.get(key) === operation) {
        activeQianchuanDeliveryPromises.delete(key);
      }
    }
  };

  const maybeAutoDeliverVariant = async (render, variant, returnedAsset) => {
    if (
      !render.automation?.jobId ||
      !variant.automaticAssessment?.autoApproved
    ) {
      return null;
    }
    const library = await readLibrary();
    const job = library.autoJobs.find(
      (item) => item.id === render.automation.jobId,
    );
    const config = normalizeQianchuanDelivery(job?.qianchuanDelivery);
    if (!job || !config.enabled) return null;
    const results = [];
    for (const target of config.targets) {
      const state = qianchuanStateForTarget(variant, target);
      if (state?.status === 'success') continue;
      results.push(
        await maybeAutoDeliverTarget(render, variant, returnedAsset, target),
      );
    }
    return results;
  };

  const maybeAutoReturnVariant = async (render, variant) => {
    if (render.visibility === 'private') return null;
    if (variant.reviewStatus !== 'approved' || !render.automation?.jobId) {
      return null;
    }
    const key = `${render.id}:${variant.id}`;
    const existing = activeAutoReturnPromises.get(key);
    if (existing) return existing;
    const operation = (async () => {
      const library = await readLibrary();
      const job = library.autoJobs.find(
        (item) => item.id === render.automation.jobId,
      );
      if (!job?.autoReturnAfterApproval) return null;
      const currentRender = library.renders.find(item => item.id === render.id);
      if (!canPerformAutomaticEffects(library, job, currentRender)) return null;
      try {
        const result = await returnVariantToMaterialCenter(
          render.id,
          variant.id,
          { sub: job.createdById, name: job.createdByName },
        );
        void maybeAutoDeliverVariant(render, variant, result).catch((error) => {
          console.error('Automatic Qianchuan delivery error:', error);
        });
        return { status: 'completed', result };
      } catch (error) {
        return {
          status: 'failed',
          message:
            error instanceof Error ? error.message : '审核后自动回传失败。',
        };
      }
    })();
    activeAutoReturnPromises.set(key, operation);
    try {
      return await operation;
    } finally {
      if (activeAutoReturnPromises.get(key) === operation) {
        activeAutoReturnPromises.delete(key);
      }
    }
  };

  const retryDueAutoReturns = async () => {
    if (!materialCenter?.configured) return;
    const library = await readLibrary();
    const now = Date.now();
    const candidates = library.renders.flatMap((render) =>
      render.variants
        .filter((variant) => {
          if (variant.reviewStatus !== 'approved') return false;
          const job = library.autoJobs.find(
            (item) => item.id === render.automation?.jobId,
          );
          const state = variant.materialCenterReturn;
          return Boolean(
            job?.autoReturnAfterApproval &&
            (!state ||
              (state.status === 'failed' &&
                shouldKeepRetryingExternalState(state.errorMessage) &&
                (!state.nextRetryAt ||
                  new Date(state.nextRetryAt).getTime() <= now))),
          );
        })
        .map((variant) => ({ render, variant })),
    );
    for (const candidate of candidates) {
      void maybeAutoReturnVariant(candidate.render, candidate.variant).catch(
        (error) => {
          console.error('Automatic material return retry error:', error);
        },
      );
    }
    const deliveryLibrary = await readLibrary();
    const deliveryCandidates = deliveryLibrary.renders.flatMap((render) =>
      render.variants
        .filter((variant) => {
          if (variant.reviewStatus !== 'approved') return false;
          const job = deliveryLibrary.autoJobs.find(
            (item) => item.id === render.automation?.jobId,
          );
          const returned = variant.materialCenterReturn;
          const config = normalizeQianchuanDelivery(job?.qianchuanDelivery);
          return Boolean(
            config.enabled &&
            returned?.status === 'completed' &&
            returned.assetId &&
            returned.assetAvailable &&
            config.targets.some(
              (target) => !qianchuanStateForTarget(variant, target),
            ),
          );
        })
        .map((variant) => ({
          render,
          variant,
          returnedAsset: {
            assetId: variant.materialCenterReturn.assetId,
            assetAvailable: variant.materialCenterReturn.assetAvailable,
          },
        })),
    );
    for (const candidate of deliveryCandidates) {
      void maybeAutoDeliverVariant(
        candidate.render,
        candidate.variant,
        candidate.returnedAsset,
      ).catch((error) => {
        console.error('Automatic Qianchuan delivery retry error:', error);
      });
    }
  };

  const refreshPerformanceLearning = async () =>
    updateLibrary((library) => {
      let changed = false;
      for (const job of library.autoJobs) {
        const rows = library.renders
          .filter((render) => render.automation?.jobId === job.id)
          .flatMap((render) =>
            render.variants.flatMap((variant) =>
              qianchuanDeliveryStatesForVariant(variant).map((state) => ({
                render,
                variant,
                state,
              })),
            ),
          )
          .filter(
            ({ state }) =>
              state.metricsLinkStatus === 'verified' &&
              ['fresh', 'partial', 'no_data'].includes(state.metricsDataStatus),
          );
        const metricNumber = (value) => {
          const parsed = Number(value);
          return Number.isFinite(parsed) ? parsed : null;
        };
        let spend = 0;
        let gmv = 0;
        let hasSpend = false;
        let hasGmv = false;
        const roiRows = [];
        for (const row of rows) {
          const metrics = row.state.metrics || {};
          const rowSpend = metricNumber(metrics.stat_cost);
          const rowGmv = metricNumber(metrics.pay_order_amount);
          if (rowSpend !== null) {
            spend += rowSpend;
            hasSpend = true;
          }
          if (rowGmv !== null) {
            gmv += rowGmv;
            hasGmv = true;
          }
          if (rowSpend !== null && rowSpend > 0 && rowGmv !== null) {
            roiRows.push({ ...row, roi: rowGmv / rowSpend });
          }
        }
        const sampleSize = rows.length;
        const ready = roiRows.length >= 3 && spend > 0;
        const aggregateRoi =
          hasSpend && spend > 0 && hasGmv ? gmv / spend : null;
        const clipWeights = {};
        if (ready && aggregateRoi !== null && aggregateRoi > 0) {
          for (const { variant, roi } of roiRows) {
            const relative = Math.max(0.85, Math.min(1.15, roi / aggregateRoi));
            for (const clipId of variant.clipSequence || []) {
              clipWeights[clipId] ||= [];
              clipWeights[clipId].push(relative);
            }
          }
        }
        const normalizedClipWeights = Object.fromEntries(
          Object.entries(clipWeights).map(([clipId, values]) => [
            clipId,
            number(
              values.reduce((total, value) => total + value, 0) / values.length,
            ),
          ]),
        );
        const nextLearning = {
          status: ready ? 'ready' : sampleSize ? 'learning' : 'pending',
          sampleSize,
          spendYuan: hasSpend ? number(spend) : null,
          gmvYuan: hasGmv ? number(gmv) : null,
          roi: aggregateRoi === null ? null : number(aggregateRoi),
          clipWeights: normalizedClipWeights,
          recommendations: ready
            ? [
                '后续选片仅使用真实回流数据做小幅排序优化，单条权重限制在 0.85–1.15。',
                '继续保留产品分类、不同开头、剧情演绎位置和完整切片硬门禁。',
              ]
            : sampleSize
              ? [
                  `已回流 ${sampleSize} 条，至少 3 条有消耗与成交数据后再调整选片排序。`,
                ]
              : ['等待千川真实投放与效果回流，不以缺失数据冒充 0。'],
        };
        // A learning refresh is not a heartbeat. Preserve the existing object
        // when its business result is identical, so unrelated scheduler ticks
        // do not invalidate an in-flight source plan's full-job CAS.
        const previousLearning = job.performanceLearning;
        const { updatedAt: _previousUpdatedAt, ...previousBusiness } =
          previousLearning || {};
        if (previousLearning &&
            JSON.stringify(previousBusiness) === JSON.stringify(nextLearning)) continue;
        job.performanceLearning = { ...nextLearning, updatedAt: nowIso() };
        changed = true;
      }
      if (!changed) return unchangedLibrary(null);
    });

  const nativeAuditTerminal = state => basicOutputUnavailable({qianchuanDelivery:state})
    || (String(state?.platformAudit?.status||'').toUpperCase()==='PASS'
      && String(state?.platformAudit?.material_status||'').toUpperCase()==='DELIVERY_OK');
  const automaticNativeAuditWaiting = (library,render,variant,state) => Boolean(
    render.automation?.jobId && variant.reviewMode===BASIC_REVIEW_MODE
    && canPerformAutomaticEffects(library,library.autoJobs.find(job=>job.id===render.automation.jobId),render)
    && state?.status==='success' && state.platformAssetId && state.bindingVerifiedAt
    && !nativeAuditTerminal(state) && !basicOutputUnavailable(variant));
  const deliveryPollDueAt = (library,render,variant,state) => {
    const due=Date.parse(state.nextPollAt||'')||0;
    // Repair the old six-hour upload-success timer once. New reads (including
    // failures) carry a policy marker so their 60s / 15m backoff is respected.
    if(state.nativeAuditPollVersion!==1&&automaticNativeAuditWaiting(library,render,variant,state))
      return Math.min(due,(Date.parse(state.updatedAt||'')||0)+60_000);
    return due;
  };
  const mayPollDelivery = (library,render,variant) => !render.automation?.jobId || (
    canPerformAutomaticEffects(library,library.autoJobs.find(job=>job.id===render.automation.jobId),render)
    && !basicOutputUnavailable(variant));

  const quantityReleaseRetryAllowed = (library,render,variant,state) => {
    const job=library.autoJobs.find(item=>item.id===render.automation?.jobId);
    if(!job||!canPerformAutomaticEffects(library,job,render)||!basicVariantPassed(variant)
      ||!basicCloudReviewMatches(render,variant)||basicOutputUnavailable(variant))return false;
    try{assertCurrentAutomaticReview(render,variant,library);}catch{return false;}
    return releasedQuantityLimitRetryEligible(state,{job,render,variant,
      config:normalizeQianchuanDelivery(job.qianchuanDelivery),ownerAuthorized:ownerCanUseAutomation(library,job),
      currentReviewVerified:true,platformQuarantined:hasPlatformQuarantine(variant),nowIso:nowIso()});
  };

  const refreshDueQianchuanDeliveries = async () => {
    if (!materialCenter?.configured) return;
    const now = Date.now();
    const retryLibrary = await readLibrary();
    const retryCandidates = retryLibrary.renders.flatMap((render) =>
      render.variants.flatMap((variant) =>
        qianchuanDeliveryStatesForVariant(variant)
          .filter((state) => {
            const companyJob=retryLibrary.autoJobs.find(job=>job.id===render.automation?.jobId);
            if(basicOutputUnavailable(variant))return false;
            const releasedCompanyGate=basicCloudReviewMatches(render,variant)
              &&/(公司.*审核|company[_ -]?audit)/iu.test(String(state?.errorMessage||''));
            const policyRecheckRequired = Boolean(
              !state?.taskId &&
              QIANCHUAN_POLICY_RECHECK_PATTERN.test(
                String(state?.errorMessage || ''),
              ),
            );
            return Boolean(
              state?.idempotencyKey &&
              ['partial', 'failed', 'deferred'].includes(state.status) &&
              (releasedCompanyGate||quantityReleaseRetryAllowed(retryLibrary,render,variant,state)||shouldKeepRetryingExternalState(
                state.message,
                state.errorMessage,
                state.errorAdvice,
              )) &&
              (policyRecheckRequired ||
                !state.nextRetryAt ||
                new Date(state.nextRetryAt).getTime() <= now),
            );
          })
          .map((state) => ({ render, variant, state })),
      ),
    );
    await mapWithConcurrency(
      retryCandidates,
      2,
      async ({ render, variant, state }) => {
        // A retry is another external write: recheck the current owner grant,
        // task state and target, even when a task ID was persisted earlier.
        const currentLibrary = await readLibrary();
        const currentRender = currentLibrary.renders.find(item => item.id === render.id);
        const currentJob = currentLibrary.autoJobs.find(item => item.id === currentRender?.automation?.jobId);
        if (!canPerformAutomaticEffects(currentLibrary, currentJob, currentRender)) return;
        const currentVariant=currentRender?.variants.find(item=>item.id===variant.id);
        if(currentVariant?.reviewMode===BASIC_REVIEW_MODE&&(!basicCloudReviewMatches(currentRender,currentVariant)||basicOutputUnavailable(currentVariant)))return;
        const liveState=currentVariant&&qianchuanStateForTarget(currentVariant,state);
        if(state.failureStage==='admission_recheck'&&state.admissionRecoveryHistory?.at(-1)?.toMode==='quantity_unlimited'
          &&(!liveState||JSON.stringify(liveState)!==JSON.stringify(state)
            ||!quantityReleaseRetryAllowed(currentLibrary,currentRender,currentVariant,liveState)))return;
        const currentConfig = normalizeQianchuanDelivery(currentJob.qianchuanDelivery);
        if(companyRecoveryEnabled(currentJob)&&!currentCompanyPass(currentRender.variants.find(item=>item.id===variant.id)))return;
        if (!currentConfig.enabled || !currentConfig.confirmed || !currentConfig.targets.some(target =>
          qianchuanTargetIdentity(target) === qianchuanTargetIdentity(state))) return;
        const currentRetryCount =
          Math.max(0, Number(state.retryCount) || 0) + 1;
        try {
          if (!state.taskId) {
            await maybeAutoDeliverTarget(
              render,
              variant,
              {
                assetId: variant.materialCenterReturn?.assetId,
                assetAvailable: variant.materialCenterReturn?.assetAvailable,
              },
              state,
            );
            return;
          }
          const currentVariant=currentRender?.variants.find(item=>item.id===variant.id);
          if(!currentVariant || currentVariant.reviewStatus!=='approved' || hasPlatformQuarantine(currentVariant)) return;
          assertCurrentAutomaticReview(currentRender,currentVariant,currentLibrary);
          await assertVariantVersionedSources(currentRender,currentVariant,currentLibrary);
          const result = await materialCenter.retryQianchuanDelivery(
            state.idempotencyKey,
          );
          await updateLibrary((latest) => {
            const latestVariant = latest.renders
              .find((item) => item.id === render.id)
              ?.variants.find((item) => item.id === variant.id);
            if (!latestVariant) return;
            const currentState = qianchuanStateForTarget(latestVariant, state);
            if (!currentState) return;
            const task = result.task;
            setQianchuanStateForTarget(latestVariant, state, {
              ...currentState,
              taskId: task?.id || currentState.taskId,
              status: task?.status || 'pending',
              message:
                task?.message ||
                '已按同一千川任务幂等续跑；已有视频 ID 时只续绑计划。',
              errorMessage: task?.errorMessage || '',
              errorAdvice: task?.errorAdvice || '',
              failureStage: task?.failureStage || '',
              platformAssetId:
                task?.platformAssetId || currentState.platformAssetId,
              bindingVerifiedAt: task?.bindingVerifiedAt || currentState.bindingVerifiedAt || null,
              platformAudit: task?.platformAudit || currentState.platformAudit || null,
              lastErrorCategory: task?.lastErrorCategory || '',
              retryCount: currentRetryCount,
              nextRetryAt: null,
              nextPollAt: new Date(Date.now() + 60_000).toISOString(),
              updatedAt: nowIso(),
            });
          });
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : '自动续跑千川任务失败';
          await updateLibrary((latest) => {
            const latestVariant = latest.renders
              .find((item) => item.id === render.id)
              ?.variants.find((item) => item.id === variant.id);
            if (!latestVariant) return;
            const currentState = qianchuanStateForTarget(latestVariant, state);
            if (!currentState) return;
            currentState.retryCount = currentRetryCount;
            if (isQianchuanDailyCapacityDeferred(errorMessage)) {
              setQianchuanStateForTarget(
                latestVariant,
                state,
                deferQianchuanDeliveryForCapacity(currentState, errorMessage),
              ).retryCount = currentRetryCount;
              return;
            }
            currentState.errorMessage = errorMessage;
            currentState.errorAdvice =
              '系统保留已上传视频和同一幂等键，下一轮只重试失败阶段。';
            currentState.nextRetryAt = shouldKeepRetryingExternalState(
              currentState.message,
              currentState.errorMessage,
              currentState.errorAdvice,
            )
              ? new Date(
                  Date.now() +
                    qianchuanRetryDelayMs(
                      currentRetryCount,
                      currentState.message,
                      currentState.errorMessage,
                      currentState.errorAdvice,
                    ),
                ).toISOString()
              : null;
            currentState.updatedAt = nowIso();
            setQianchuanStateForTarget(latestVariant, state, currentState);
          });
        }
      },
    );

    const library = await readLibrary();
    const dueCandidates = library.renders.flatMap((render) =>
      render.variants.flatMap((variant) =>
        qianchuanDeliveryStatesForVariant(variant)
          .filter((state) =>
            Boolean(
              state?.idempotencyKey &&
              mayPollDelivery(library,render,variant) &&
              !['partial', 'failed', 'deferred'].includes(state.status) &&
              deliveryPollDueAt(library,render,variant,state) <= now,
            ),
          )
          .map((state) => ({ render, variant, state })),
      ),
    ).sort((a,b)=>deliveryPollDueAt(library,a.render,a.variant,a.state)-deliveryPollDueAt(library,b.render,b.variant,b.state));
    const waiting=dueCandidates.filter(({render,variant,state})=>automaticNativeAuditWaiting(library,render,variant,state)).slice(0,3);
    const candidates=[...waiting,...dueCandidates.filter(item=>!waiting.includes(item)).slice(0,6-waiting.length)];
    await mapWithConcurrency(
      candidates,
      3,
      async ({ render, variant, state }) => {
        const beforeRead=await readLibrary(),liveRender=beforeRead.renders.find(item=>item.id===render.id);
        const liveVariant=liveRender?.variants.find(item=>item.id===variant.id);
        if(!liveVariant||!mayPollDelivery(beforeRead,liveRender,liveVariant))return;
        try {
          const result = await materialCenter.getQianchuanDelivery(
            state.idempotencyKey,
          );
          if (!result.task) throw Error('Cloud delivery task not available');
          await updateLibrary((latest) => {
            const latestRender=latest.renders.find(item=>item.id===render.id);
            const latestVariant=latestRender?.variants.find(item=>item.id===variant.id);
            if (!latestVariant||!mayPollDelivery(latest,latestRender,latestVariant)) return unchangedLibrary(null);
            const currentState = qianchuanStateForTarget(latestVariant, state);
            if (!currentState||currentState.idempotencyKey!==state.idempotencyKey) return unchangedLibrary(null);
            const task = result.task;
            const retryCount = Math.max(
              0,
              Number(currentState.retryCount) || 0,
            );
            const nativeFailure=basicOutputUnavailable({qianchuanDelivery:task});
            const terminalFailure = ['partial', 'failed'].includes(task.status)||nativeFailure;
            setQianchuanStateForTarget(latestVariant, state, {
              ...currentState,
              taskId: task.id,
              status: task.status,
              message: task.message,
              errorMessage: task.errorMessage,
              errorAdvice: task.errorAdvice,
              failureStage: task.failureStage,
              platformAssetId: task.platformAssetId,
              bindingVerifiedAt: task.bindingVerifiedAt,
              platformAudit: task.platformAudit || null,
              lastErrorCategory: task.lastErrorCategory || '',
              metrics: task.metrics,
              metricsLinkStatus: task.metricsLinkStatus,
              metricsDataStatus: task.metricsDataStatus,
              metricsFreshThrough: task.metricsFreshThrough,
              metricsCoverage: task.metricsCoverage,
              retryCount,
              nextRetryAt:
                terminalFailure && !nativeFailure &&
                shouldKeepRetryingExternalState(
                  task.message,
                  task.errorMessage,
                  task.errorAdvice,
                )
                  ? new Date(
                      Date.now() +
                        qianchuanRetryDelayMs(
                          retryCount,
                          task.message,
                          task.errorMessage,
                          task.errorAdvice,
                        ),
                    ).toISOString()
                  : null,
              updatedAt: nowIso(),
              nativeAuditPollVersion: 1,
              nextPollAt: terminalFailure
                ? null
                : new Date(
                    Date.now() +
                      (task.status === 'success'&&!automaticNativeAuditWaiting(latest,latestRender,latestVariant,task)
                        ? 6 * 60 * 60_000 : 60_000),
                  ).toISOString(),
            });
          });
        } catch {
          await updateLibrary((latest) => {
            const latestRender=latest.renders.find(item=>item.id===render.id);
            const latestVariant=latestRender?.variants.find(item=>item.id===variant.id);
            if(!latestVariant||!mayPollDelivery(latest,latestRender,latestVariant))return unchangedLibrary(null);
            if (latestVariant) {
              const currentState = qianchuanStateForTarget(
                latestVariant,
                state,
              );
              if (!currentState||currentState.idempotencyKey!==state.idempotencyKey) return unchangedLibrary(null);
              currentState.nativeAuditPollVersion=1;
              currentState.nextPollAt = new Date(
                Date.now() + 15 * 60_000,
              ).toISOString();
              setQianchuanStateForTarget(latestVariant, state, currentState);
            }
          });
        }
      },
    );
    await refreshPerformanceLearning();
  };

  const approvedClipCountForCategory = (library, productCategory) =>
    library.clips.filter(
      (clip) =>
        getSource(library, clip.sourceId)?.visibility !== 'private' &&
        (!sourceVersionManaged(getSource(library,clip.sourceId)) || currentClipEvidencePointer(clip,getSource(library,clip.sourceId))) &&
        !clipIsBlocked(clip) &&
        clip.reviewStatus === 'approved' &&
        clipProductCategory(clip, library) === productCategory,
    ).length;

  const processedMaterialCenterAssetIdsForCategory = (
    library,
    productCategory,
  ) => {
    const slicedSourceIds = new Set(
      library.clips.map((clip) => clip.sourceId).filter(Boolean),
    );
    return library.sources
      .filter(
        (source) =>
          sourceProductCategory(source) === productCategory &&
          slicedSourceIds.has(source.id) &&
          (!sourceVersionManaged(source) || library.clips.some(clip=>clip.sourceId===source.id && currentClipEvidencePointer(clip,source))) &&
          Number(source.materialCenterAssetId || 0) > 0,
      )
      .map((source) => Number(source.materialCenterAssetId));
  };

  const continuousClipSupplyCategories = () =>
    PRODUCT_CATEGORY_RULES.map((rule) => rule.name).filter(
      (productCategory) =>
        ![GENERAL_CLIP_CATEGORY, '其他 WIS 素材'].includes(productCategory),
    );

  const continuousClipSupplyShortageByRole = (library, productCategory) => {
    const roleIds = [
      ...new Set(
        allFrameworks(library)
          .filter((framework) => canReadFramework(library, framework, null))
          .flatMap((framework) =>
            framework.slots.flatMap((slot) => [...slotRoleIds(slot)]),
          ),
      ),
    ];
    const usableClips = library.clips.filter((clip) => {
      if (clip.reviewStatus !== 'approved') return false;
      if (
        getSource(library, clip.sourceId)?.visibility === 'private' ||
        clipIsBlocked(clip)
      )
        return false;
      const category = clipProductCategory(clip, library);
      return category === productCategory || category === GENERAL_CLIP_CATEGORY;
    });
    return new Map(
      roleIds.map((roleId) => [
        roleId,
        Math.max(
          0,
          CONTINUOUS_CLIP_SUPPLY_ROLE_TARGET -
            usableClips.filter((clip) => clip.role === roleId).length,
        ),
      ]),
    );
  };

  const ensureContinuousClipSupplyJob = (library) => {
    const timestamp = nowIso();
    let job = library.clipReplenishmentJobs.find(
      (candidate) => candidate.signature === CONTINUOUS_CLIP_SUPPLY_SIGNATURE,
    );
    if (!job) {
      const targets = continuousClipSupplyCategories().map(
        (productCategory) => {
          const approvedCount = approvedClipCountForCategory(
            library,
            productCategory,
          );
          const alreadyProcessedAssetIds =
            processedMaterialCenterAssetIdsForCategory(
              library,
              productCategory,
            );
          return {
            productCategory,
            targetApprovedCount: CONTINUOUS_CLIP_SUPPLY_TARGET_PER_PRODUCT,
            initialApprovedCount: approvedCount,
            approvedCount,
            inventoryStatus:
              approvedCount >= CONTINUOUS_CLIP_SUPPLY_TARGET_PER_PRODUCT
                ? 'ready'
                : 'low',
            status: 'active',
            processedAssetIds: [...new Set(alreadyProcessedAssetIds)],
            attemptsByAssetId: {},
            approvedClipIds: [],
            rejectedClipIds: [],
            evidence: [
              '供应线已建立：优先处理新增素材，没有新增时继续扫描历史合规源素材。',
              '源素材 ID 与整数秒起止区间双重幂等，已切内容不会重复生成。',
            ],
            lastScannedAt: null,
            completedAt: null,
          };
        },
      );
      job = {
        id: randomUUID(),
        signature: CONTINUOUS_CLIP_SUPPLY_SIGNATURE,
        name: '24小时切片供应线',
        continuous: true,
        status: materialCenter?.configured
          ? CONTINUOUS_CLIP_SUPPLY_INITIAL_DELAY_MS > 0
            ? 'watching'
            : 'active'
          : 'blocked',
        boundaryMode: 'integer-second-boundary-guard-v3',
        targets,
        targetApprovedCount:
          targets.length * CONTINUOUS_CLIP_SUPPLY_TARGET_PER_PRODUCT,
        approvedCount: targets.reduce(
          (total, target) =>
            total + Math.min(target.approvedCount, target.targetApprovedCount),
          0,
        ),
        currentProductCategory: '',
        currentAssetId: null,
        currentScanMode: 'idle',
        processedAssetCount: 0,
        createdClipCount: 0,
        approvedClipCount: 0,
        rejectedClipCount: 0,
        skippedRecursiveAssetCount: 0,
        infrastructureFailureCount: 0,
        consecutiveInfrastructureFailures: 0,
        lastInfrastructureError: '',
        infrastructureRetryAt: null,
        nextScanAt: materialCenter?.configured
          ? new Date(
              Date.now() + CONTINUOUS_CLIP_SUPPLY_INITIAL_DELAY_MS,
            ).toISOString()
          : null,
        lastScanAt: null,
        lastSuccessAt: null,
        startedAt: timestamp,
        updatedAt: timestamp,
        completedAt: null,
      };
      library.clipReplenishmentJobs.unshift(job);
    }
    job.continuous = true;
    job.completedAt = null;
    job.nextScanAt ||= materialCenter?.configured ? timestamp : null;
    const existingCategories = new Set(
      job.targets.map((target) => target.productCategory),
    );
    for (const productCategory of continuousClipSupplyCategories()) {
      if (existingCategories.has(productCategory)) continue;
      const approvedCount = approvedClipCountForCategory(
        library,
        productCategory,
      );
      job.targets.push({
        productCategory,
        targetApprovedCount: CONTINUOUS_CLIP_SUPPLY_TARGET_PER_PRODUCT,
        initialApprovedCount: approvedCount,
        approvedCount,
        inventoryStatus:
          approvedCount >= CONTINUOUS_CLIP_SUPPLY_TARGET_PER_PRODUCT
            ? 'ready'
            : 'low',
        status: 'active',
        processedAssetIds: [],
        attemptsByAssetId: {},
        approvedClipIds: [],
        rejectedClipIds: [],
        evidence: [],
        lastScannedAt: null,
        completedAt: null,
      });
    }
    for (const target of job.targets) {
      target.targetApprovedCount = CONTINUOUS_CLIP_SUPPLY_TARGET_PER_PRODUCT;
      target.status = 'active';
      target.completedAt = null;
      target.processedAssetIds = [
        ...new Set([
          ...(target.processedAssetIds || []).map(Number),
          ...processedMaterialCenterAssetIdsForCategory(
            library,
            target.productCategory,
          ),
        ]),
      ];
    }
    return refreshClipReplenishmentCounts(library, job);
  };

  const materialCenterSourceAssetSnapshot = async (
    category = '',
    maximumPages = 5,
  ) => {
    const assets = [];
    let pageNumber = 1;
    while (pageNumber <= maximumPages) {
      const page = await materialCenter.listAssets({
        category,
        libraryType: 'source',
        page: pageNumber,
        pageSize: 100,
      });
      assets.push(...page.items);
      if (pageNumber * page.pageSize >= page.total) break;
      pageNumber += 1;
    }
    return assets.sort(
      (left, right) =>
        Number(Boolean(right.effective)) - Number(Boolean(left.effective)) ||
        String(right.modifiedAt || '').localeCompare(
          String(left.modifiedAt || ''),
        ),
    );
  };

  const clipReplenishmentAssets = async (productCategory) =>
    (
      await materialCenterSourceAssetSnapshot(
        materialCenterCategoryForProduct(productCategory),
        100,
      )
    ).filter((asset) => isEligibleSourceAsset(asset, productCategory));

  const refreshClipReplenishmentCounts = (library, job) => {
    for (const target of job.targets) {
      target.approvedCount = approvedClipCountForCategory(
        library,
        target.productCategory,
      );
      target.inventoryStatus =
        target.approvedCount >= target.targetApprovedCount ? 'ready' : 'low';
      if (job.continuous) {
        target.completedAt = null;
      } else if (target.approvedCount >= target.targetApprovedCount) {
        target.status = 'completed';
        target.completedAt ||= nowIso();
      } else if (target.status === 'completed') {
        target.status = 'active';
        target.completedAt = null;
      }
    }
    job.approvedCount = job.targets.reduce(
      (total, target) =>
        total + Math.min(target.approvedCount, target.targetApprovedCount),
      0,
    );
    job.targetApprovedCount = job.targets.reduce(
      (total, target) => total + target.targetApprovedCount,
      0,
    );
    job.updatedAt = nowIso();
    return job;
  };

  const createClipReplenishmentJob = (payload, accessContext) =>
    updateLibrary((library) => {
      if (!accessContext?.service) {
        throw new RemixAccessError('仅云管家受信服务可启动批量补库。');
      }
      if (!materialCenter?.configured) {
        throw new Error('素材中心双向接口尚未配置。');
      }
      const requestedTargets = Array.isArray(payload.targets)
        ? payload.targets
        : [];
      if (!requestedTargets.length || requestedTargets.length > 12) {
        throw new Error('请提供1–12个产品品类补库目标。');
      }
      const targets = requestedTargets.map((target) => {
        const productCategory = safeLabel(target?.productCategory, '');
        const targetApprovedCount = Math.trunc(
          Number(target?.targetApprovedCount),
        );
        if (
          !PRODUCT_CATEGORY_NAMES.has(productCategory) ||
          [GENERAL_CLIP_CATEGORY, '其他 WIS 素材'].includes(productCategory)
        ) {
          throw new Error(
            `“${productCategory || '未填写'}”不是可补库的产品品类。`,
          );
        }
        if (targetApprovedCount < 1 || targetApprovedCount > 500) {
          throw new Error('每个产品的审核通过目标须为1–500条。');
        }
        const approvedCount = approvedClipCountForCategory(
          library,
          productCategory,
        );
        return {
          productCategory,
          targetApprovedCount,
          initialApprovedCount: approvedCount,
          approvedCount,
          status: approvedCount >= targetApprovedCount ? 'completed' : 'active',
          processedAssetIds: [],
          attemptsByAssetId: {},
          approvedClipIds: [],
          rejectedClipIds: [],
          evidence: [],
          completedAt: approvedCount >= targetApprovedCount ? nowIso() : null,
        };
      });
      const signature = targets
        .map(
          (target) => `${target.productCategory}:${target.targetApprovedCount}`,
        )
        .sort()
        .join('|');
      const existing = library.clipReplenishmentJobs.find(
        (job) => job.signature === signature && job.status === 'active',
      );
      if (existing) return existing;
      const timestamp = nowIso();
      const job = {
        id: randomUUID(),
        signature,
        name: safeLabel(payload.name, '整数秒切片批量补库'),
        status: targets.every((target) => target.status === 'completed')
          ? 'completed'
          : 'active',
        boundaryMode: 'integer-second-boundary-guard-v3',
        targets,
        targetApprovedCount: targets.reduce(
          (total, target) => total + target.targetApprovedCount,
          0,
        ),
        approvedCount: targets.reduce(
          (total, target) =>
            total + Math.min(target.approvedCount, target.targetApprovedCount),
          0,
        ),
        currentProductCategory: '',
        currentAssetId: null,
        processedAssetCount: 0,
        createdClipCount: 0,
        approvedClipCount: 0,
        rejectedClipCount: 0,
        infrastructureFailureCount: 0,
        consecutiveInfrastructureFailures: 0,
        lastInfrastructureError: '',
        infrastructureRetryAt: null,
        startedAt: timestamp,
        updatedAt: timestamp,
        completedAt: targets.every((target) => target.status === 'completed')
          ? timestamp
          : null,
      };
      library.clipReplenishmentJobs.unshift(job);
      const continuousJob = library.clipReplenishmentJobs.find(
        (candidate) => candidate.signature === CONTINUOUS_CLIP_SUPPLY_SIGNATURE,
      );
      const ordinaryJobs = library.clipReplenishmentJobs.filter(
        (candidate) => candidate.signature !== CONTINUOUS_CLIP_SUPPLY_SIGNATURE,
      );
      library.clipReplenishmentJobs = continuousJob
        ? [continuousJob, ...ordinaryJobs.slice(0, 19)]
        : ordinaryJobs.slice(0, 20);
      return job;
    });

  const wakeContinuousClipSupply = () =>
    updateLibrary((library) => {
      const job = ensureContinuousClipSupplyJob(library);
      if (!materialCenter?.configured) {
        throw new Error('素材中心双向接口尚未配置。');
      }
      job.status = 'active';
      job.nextScanAt = null;
      job.completedAt = null;
      for (const target of job.targets) {
        if (['exhausted', 'watching', 'completed'].includes(target.status)) {
          target.status = 'active';
        }
      }
      job.updatedAt = nowIso();
      return job;
    });

  const processClipReplenishmentJob = async (jobId) => {
    if (activeClipReplenishmentJobIds.has(jobId)) return;
    activeClipReplenishmentJobIds.add(jobId);
    const accessContext = {
      sub: 'SERVICE-WIS-MATERIAL-CENTER',
      name: '云管家切片自动补库',
      service: true,
    };
    let processedThisInvocation = 0;
    let continuousAssetSnapshot = null;
    try {
      while (true) {
        let library = await readLibrary();
        let job = library.clipReplenishmentJobs.find(
          (candidate) => candidate.id === jobId,
        );
        if (!job || job.status !== 'active') return;
        // A newly verified edition binding can make a previously sliced legacy
        // source usable. Reset only its own supply attempt, never a paused job.
        if(typeof sourceVersionResolver?.candidateSourceIds==='function') {
          const catalog=await sourceVersionResolver.candidateSourceIds(),ids=new Set(catalog.sourceIds);
          const candidates=library.sources.filter(source=>ids.has(source.id) && sourceVersionManaged(source) &&
            source.visibility!=='private' && Number(source.materialCenterAssetId)>0);
          await updateScanLibrary(latest=>{
            const current=latest.clipReplenishmentJobs.find(item=>item.id===jobId);
            if(current?.status!=='active')return unchangedLibrary(null);
            let changed=false;
            for(const source of candidates){
              const freshSource=getSource(latest,source.id);
              if(!freshSource || freshSource.visibility==='private' || !sourceVersionManaged(freshSource) ||
                Number(freshSource.materialCenterAssetId)!==Number(source.materialCenterAssetId))continue;
              const target=current.targets.find(item=>item.productCategory===freshSource.productCategory);if(!target)continue;
              const key=catalog.bindingKeysBySourceId?.[source.id]||catalog.registrySha256;
              if(target.versionRequeuedBindingKeys?.[source.id]===key)continue;
              target.versionRequeuedBindingKeys||={};target.versionRequeuedBindingKeys[source.id]=key;
              target.processedAssetIds=target.processedAssetIds.filter(id=>Number(id)!==Number(source.materialCenterAssetId));
              if(target.attemptsByAssetId)delete target.attemptsByAssetId[source.materialCenterAssetId];
              if(target.deferredSourceAssets)delete target.deferredSourceAssets[source.materialCenterAssetId];
              target.status='active';changed=true;
            }
            return changed?current:unchangedLibrary(null);
          });
        }
        await updateScanLibrary((latest) => {
          const current = latest.clipReplenishmentJobs.find(
            (candidate) => candidate.id === jobId,
          );
          if (current) refreshClipReplenishmentCounts(latest, current);
        });
        library = await readLibrary();
        job = library.clipReplenishmentJobs.find(
          (candidate) => candidate.id === jobId,
        );
        const target = job?.targets
          .filter((candidate) =>
            job.continuous
              ? candidate.status !== 'exhausted'
              : candidate.approvedCount < candidate.targetApprovedCount &&
                candidate.status !== 'exhausted',
          )
          .sort(
            (left, right) =>
              Number(right.targetApprovedCount - right.approvedCount) -
                Number(left.targetApprovedCount - left.approvedCount) ||
              String(left.lastScannedAt || '').localeCompare(
                String(right.lastScannedAt || ''),
              ),
          )[0];
        if (!job || !target) {
          await updateScanLibrary((latest) => {
            const current = latest.clipReplenishmentJobs.find(
              (candidate) => candidate.id === jobId,
            );
            if (!current) return;
            refreshClipReplenishmentCounts(latest, current);
            const complete = current.targets.every(
              (candidate) =>
                candidate.approvedCount >= candidate.targetApprovedCount,
            );
            current.status = current.continuous
              ? 'watching'
              : complete
                ? 'completed'
                : 'partial';
            current.currentProductCategory = '';
            current.currentAssetId = null;
            current.currentScanMode = 'idle';
            current.completedAt = current.continuous ? null : nowIso();
            current.lastScanAt = current.continuous
              ? nowIso()
              : current.lastScanAt;
            current.nextScanAt = current.continuous
              ? new Date(
                  Date.now() + CONTINUOUS_CLIP_SUPPLY_SCAN_INTERVAL_MS,
                ).toISOString()
              : null;
          });
          return;
        }

        let assets;
        try {
          if (job.continuous) {
            continuousAssetSnapshot ||=
              await materialCenterSourceAssetSnapshot();
            const shortageByRole = continuousClipSupplyShortageByRole(
              library,
              target.productCategory,
            );
            const processedAssetIds = new Set(target.processedAssetIds);
            const recentAssets = continuousAssetSnapshot
              .filter((asset) => {
                const inferredCategory = inferredProductCategory(
                  asset.category,
                  asset.folderName,
                  asset.filename,
                  asset.tags,
                );
                return (
                  inferredCategory === target.productCategory &&
                  isEligibleSourceAsset(asset, target.productCategory)
                );
              })
              .sort(
                (left, right) =>
                  sourceAssetScore(
                    right,
                    processedAssetIds,
                    shortageByRole,
                    target.productCategory,
                  ) -
                    sourceAssetScore(
                      left,
                      processedAssetIds,
                      shortageByRole,
                      target.productCategory,
                    ) ||
                  String(right.modifiedAt || '').localeCompare(
                    String(left.modifiedAt || ''),
                  ),
              );
            const hasUnprocessedRecentAsset = recentAssets.some(
              (asset) =>
                supplyAssetAvailable(target,asset),
            );
            if (hasUnprocessedRecentAsset) {
              assets = recentAssets;
              job.currentScanMode = 'recent';
            } else {
              assets = (
                await clipReplenishmentAssets(target.productCategory)
              ).sort(
                (left, right) =>
                  sourceAssetScore(
                    right,
                    processedAssetIds,
                    shortageByRole,
                    target.productCategory,
                  ) -
                    sourceAssetScore(
                      left,
                      processedAssetIds,
                      shortageByRole,
                      target.productCategory,
                    ) ||
                  String(right.modifiedAt || '').localeCompare(
                    String(left.modifiedAt || ''),
                  ),
              );
              job.currentScanMode = 'history';
            }
          } else {
            assets = await clipReplenishmentAssets(target.productCategory);
          }
          await updateScanLibrary((latest) => {
            const current = latest.clipReplenishmentJobs.find(
              (candidate) => candidate.id === jobId,
            );
            if (!current) return;
            current.consecutiveInfrastructureFailures = 0;
            current.lastInfrastructureError = '';
            current.infrastructureRetryAt = null;
            current.lastScanAt = nowIso();
            current.currentScanMode = job.currentScanMode || 'idle';
            const currentTarget = current.targets.find(
              (candidate) =>
                candidate.productCategory === target.productCategory,
            );
            if (currentTarget) currentTarget.lastScannedAt = nowIso();
            if (currentTarget && job.continuous) {
              currentTarget.shortageRoleIds = [
                ...continuousClipSupplyShortageByRole(
                  latest,
                  target.productCategory,
                ),
              ]
                .filter(([, missingCount]) => missingCount > 0)
                .map(([roleId]) => roleId);
            }
            current.updatedAt = nowIso();
          });
        } catch (error) {
          const errorMessage = safeLabel(
            error instanceof Error ? error.message : '素材中心临时不可用',
          );
          let retryDelayMs = CLIP_REPLENISHMENT_RETRY_BASE_MS;
          await updateScanLibrary((latest) => {
            const current = latest.clipReplenishmentJobs.find(
              (candidate) => candidate.id === jobId,
            );
            const currentTarget = current?.targets.find(
              (candidate) =>
                candidate.productCategory === target.productCategory,
            );
            if (!current || !currentTarget) return;
            current.infrastructureFailureCount =
              Math.max(0, Number(current.infrastructureFailureCount) || 0) + 1;
            current.consecutiveInfrastructureFailures =
              Math.max(
                0,
                Number(current.consecutiveInfrastructureFailures) || 0,
              ) + 1;
            retryDelayMs = Math.min(
              CLIP_REPLENISHMENT_RETRY_MAX_MS,
              CLIP_REPLENISHMENT_RETRY_BASE_MS *
                2 ** Math.min(4, current.consecutiveInfrastructureFailures - 1),
            );
            current.lastInfrastructureError = errorMessage;
            current.infrastructureRetryAt = new Date(
              Date.now() + retryDelayMs,
            ).toISOString();
            current.currentAssetId = null;
            current.updatedAt = nowIso();
            currentTarget.evidence = [
              ...(currentTarget.evidence || []),
              `素材中心暂时不可用：${errorMessage}；${Math.ceil(retryDelayMs / 1000)} 秒后自动重试，任务进度已保留`,
            ].slice(-30);
          });
          await waitForDelay(retryDelayMs);
          continue;
        }
        const asset = assets.find(
          (candidate) =>
            supplyAssetAvailable(target,candidate),
        );
        if (!asset) {
          await updateScanLibrary((latest) => {
            const currentJob = latest.clipReplenishmentJobs.find(
              (candidate) => candidate.id === jobId,
            );
            const currentTarget = currentJob?.targets.find(
              (candidate) =>
                candidate.productCategory === target.productCategory,
            );
            if (!currentJob || !currentTarget) return;
            currentTarget.status = 'exhausted';
            const scanEvidence = `已检查全部可用源素材；当前审核通过 ${currentTarget.approvedCount}/${currentTarget.targetApprovedCount} 条`;
            if (!(currentTarget.evidence || []).includes(scanEvidence)) {
              currentTarget.evidence = [...(currentTarget.evidence || []), scanEvidence].slice(-30);
            }
            currentJob.currentProductCategory = '';
            currentJob.currentAssetId = null;
            currentJob.currentScanMode = 'idle';
            currentJob.lastScanAt = nowIso();
            currentJob.updatedAt = nowIso();
          });
          continue;
        }

        await updateScanLibrary((latest) => {
          const currentJob = latest.clipReplenishmentJobs.find(
            (candidate) => candidate.id === jobId,
          );
          const currentTarget = currentJob?.targets.find(
            (candidate) => candidate.productCategory === target.productCategory,
          );
          if (!currentJob || !currentTarget) return;
          currentJob.currentProductCategory = target.productCategory;
          currentJob.currentAssetId = asset.id;
          currentJob.currentScanMode = job.currentScanMode || 'recent';
          currentTarget.status = 'active';
          currentTarget.attemptsByAssetId ||= {};
          currentTarget.attemptsByAssetId[asset.id] =
            Number(currentTarget.attemptsByAssetId[asset.id] || 0) + 1;
          currentJob.updatedAt = nowIso();
        });

        let approvedThisAsset = 0;
        let rejectedThisAsset = 0;
        const createdClipIds = [];
        const approvedCreatedClipIds = [];
        const rejectedCreatedClipIds = [];
        try {
          let source = await importMaterialCenterSource(
            asset.id,
            accessContext,
            { ensurePreview: false },
          );
          const media = await inspectMedia(
            path.join(sourcesDir, source.storedName),
          );
          source = await updateScanLibrary((latest) => {
            const current = getSource(latest, source.id);
            if (!current) throw new Error('补库源视频记录已失效。');
            current.productCategory = target.productCategory;
            Object.assign(current, mediaTimingRecord(media));
            return current;
          });
          if (sourceVersionManaged(source)) {
            source=await prepareSourceForAutomation(source.id,{accessContext,runId:`supply-${jobId}-${source.id}`,
              isActiveInLibrary:latest=>latest.clipReplenishmentJobs.some(item=>item.id===jobId&&item.status==='active')});
          } else if (
            source.analysisStatus !== 'ready' ||
            !['integer-second-boundary-guard-v3', ASR_FRAME_RULE].includes(source.analysisRuleVersion) ||
            !Array.isArray(source.speechSegments) ||
            !source.speechSegments.length
          ) {
            source = await analyzeSource(source.id);
          }
          const candidates = calibrateSourceSegments(source)
            .filter(
              (segment) =>
                segment.automaticCalibration?.status === 'calibrated' &&
                (segment.boundaryRule === ASR_FRAME_RULE
                  ? trustedSourceBoundary(segment, source)
                  : segment.integerSecondAligned && Number.isInteger(segment.startSeconds) && Number.isInteger(segment.endSeconds)),
            );
          for (const [index, segment] of candidates.entries()) {
            const latest = await readLibrary();
            if (
              !job.continuous &&
              approvedClipCountForCategory(latest, target.productCategory) >=
                target.targetApprovedCount
            ) {
              break;
            }
            const clip = await createClip(
              {
                sourceId: source.id,
                startSeconds: segment.startSeconds,
                endSeconds: segment.endSeconds,
                role:
                  segment.suggestedRole ||
                  suggestedRoleForSegment(segment, index, candidates.length)
                    .role,
                ...generatedClipNaming(source, segment),
                tags: [
                  job.continuous ? '24小时供应线' : '自动补库',
                  segment.boundaryRule === ASR_FRAME_RULE ? '真实ASR句界切片' : '整数秒切片',
                  segment.boundaryType,
                ],
                productCategory: target.productCategory,
                importIdempotencyKey: [
                  segment.boundaryRule === ASR_FRAME_RULE ? ASR_FRAME_RULE : 'integer-second-replenishment-v3',
                  asset.id,
                  target.productCategory,
                  segment.startSeconds,
                  segment.endSeconds,
                ].join(':'),
                approvalSource: asset.effective
                  ? 'material_center_effective'
                  : job.continuous
                    ? 'continuous_clip_supply'
                    : 'automatic_replenishment',
                approvalProvenance: {
                  materialCenterAssetId: asset.id,
                  materialCenterObjectKey: asset.objectKey,
                  contentReview: asset.effective
                    ? 'inherited'
                    : 'automatic_rules',
                  technicalReview: 'automatic_integer_second',
                },
              },
              accessContext,
            );
            createdClipIds.push(clip.id);
            const assessed = await assessClipAutomatically(
              clip.id,
              segment.label,
              {
                autoAdjustBoundary: false,
                autoApprove: true,
                autoReject: true,
                inheritContentApproval: Boolean(asset.effective),
                requireAudioContent: true,
              },
            );
            if (
              assessed.reviewStatus === 'approved' &&
              assessed.automaticAssessment?.status === 'passed'
            ) {
              approvedThisAsset += 1;
              approvedCreatedClipIds.push(clip.id);
            } else {
              rejectedThisAsset += 1;
              rejectedCreatedClipIds.push(clip.id);
            }
          }
          await updateScanLibrary((latest) => {
            const currentJob = latest.clipReplenishmentJobs.find(
              (candidate) => candidate.id === jobId,
            );
            const currentTarget = currentJob?.targets.find(
              (candidate) =>
                candidate.productCategory === target.productCategory,
            );
            if (!currentJob || !currentTarget) return;
            if(source.sourceSemanticReview?.recoverable){
              currentTarget.deferredSourceAssets||={};currentTarget.deferredSourceAssets[asset.id]={
                reason:'source_review_pending',retryAt:new Date(Date.now()+sourcePreparationDelay(currentTarget.attemptsByAssetId?.[asset.id]-1)).toISOString()};
            } else {
              currentTarget.processedAssetIds.push(asset.id);
              if(currentTarget.deferredSourceAssets)delete currentTarget.deferredSourceAssets[asset.id];
            }
            currentTarget.processedAssetIds = [
              ...new Set(currentTarget.processedAssetIds),
            ];
            currentTarget.approvedClipIds.push(...approvedCreatedClipIds);
            currentTarget.rejectedClipIds.push(...rejectedCreatedClipIds);
            currentTarget.evidence = [
              ...(currentTarget.evidence || []),
              `素材 #${asset.id}：整数秒候选 ${createdClipIds.length} 条，自动审核通过 ${approvedThisAsset} 条，退回 ${rejectedThisAsset} 条`,
            ].slice(-30);
            currentJob.processedAssetCount += 1;
            currentJob.createdClipCount += createdClipIds.length;
            currentJob.approvedClipCount += approvedThisAsset;
            currentJob.rejectedClipCount += rejectedThisAsset;
            currentJob.currentAssetId = null;
            currentJob.lastSuccessAt = nowIso();
            refreshClipReplenishmentCounts(latest, currentJob);
          });
        } catch (error) {
          await updateScanLibrary((latest) => {
            const currentJob = latest.clipReplenishmentJobs.find(
              (candidate) => candidate.id === jobId,
            );
            const currentTarget = currentJob?.targets.find(
              (candidate) =>
                candidate.productCategory === target.productCategory,
            );
            if (!currentJob || !currentTarget) return;
            const attempts = Number(
              currentTarget.attemptsByAssetId?.[asset.id] || 0,
            );
            if (sourcePreparationCanRecover(error)) {
              currentTarget.deferredSourceAssets||={};currentTarget.deferredSourceAssets[asset.id]={
                reason:error.code,retryAt:new Date(Date.now()+sourcePreparationDelay(attempts-1)).toISOString()};
            } else if (attempts >= 3) {
              currentTarget.processedAssetIds.push(asset.id);
              currentTarget.processedAssetIds = [
                ...new Set(currentTarget.processedAssetIds),
              ];
            }
            currentTarget.evidence = [
              ...(currentTarget.evidence || []),
              `素材 #${asset.id} 第 ${attempts}/3 次处理未完成：${safeLabel(error instanceof Error ? error.message : '临时异常')}`,
            ].slice(-30);
            currentJob.currentAssetId = null;
            currentJob.updatedAt = nowIso();
          });
        }
        processedThisInvocation += 1;
        if (
          job.continuous &&
          processedThisInvocation >= CONTINUOUS_CLIP_SUPPLY_BATCH_SIZE
        ) {
          await updateScanLibrary((latest) => {
            const current = latest.clipReplenishmentJobs.find(
              (candidate) => candidate.id === jobId,
            );
            if (!current) return;
            current.status = 'watching';
            current.currentProductCategory = '';
            current.currentAssetId = null;
            current.currentScanMode = 'idle';
            current.nextScanAt = new Date(Date.now() + 5_000).toISOString();
            current.updatedAt = nowIso();
          });
          return;
        }
      }
    } catch (error) {
      const errorMessage = safeLabel(
        error instanceof Error ? error.message : '切片补库任务异常',
      );
      await updateScanLibrary((latest) => {
        const current = latest.clipReplenishmentJobs.find(
          (candidate) => candidate.id === jobId,
        );
        if (!current) return;
        current.lastInfrastructureError = errorMessage;
        current.infrastructureRetryAt = new Date(
          Date.now() + CLIP_REPLENISHMENT_RETRY_BASE_MS,
        ).toISOString();
        if (current.continuous) {
          current.status = 'watching';
          current.nextScanAt = current.infrastructureRetryAt;
        }
        current.currentAssetId = null;
        current.currentScanMode = 'idle';
        current.updatedAt = nowIso();
      }).catch(() => undefined);
      console.error(
        `Clip replenishment job ${jobId} paused its worker:`,
        error,
      );
    } finally {
      activeClipReplenishmentJobIds.delete(jobId);
      requestAutoSchedulerTick();
    }
  };

  const outputRevalidator = createOutputRevalidator({
    readLibrary, updateLibrary, nowIso,
    canReview: (library, render, variant) => {
      const job = library.autoJobs.find(item => item.id === render.automation?.jobId);
      return Boolean(variant.generationBinding && job?.autoApproveOutputs && !hasPlatformQuarantine(variant)
        && canPerformAutomaticEffects(library, job, render));
    },
    assess: async (render, variant, state, library) => {
      const sourceFiles = new Map();
      for (const clip of state.clips) {
        if (sourceFiles.has(clip.sourceId)) continue;
        const source = getSource(library,clip.sourceId);
        let file = path.join(sourcesDir,source.storedName);
        if (await missingMedia(file)) file = (await playbackRecovery.source({source,identity:{id:render.createdById,name:render.createdByName}})).path;
        sourceFiles.set(source.id,file);
      }
      const input = batchOutputInput({outputId: `${render.id}/${variant.id}`,
        filePath: path.join(outputsDir, variant.storedName),
        assessment: {sha256: variant.contentSha256, assessment: variant.automaticAssessment},
        clips: state.clips, sources: library.sources,
        sourcePath: source => sourceFiles.get(source.id),trustedJobId:render.automation?.jobId});
      if (input.timeline.some(item => !item.clipApproved)
          || !batchInputsStillApproved([input], library,{trustedJobId:render.automation?.jobId}))
        return {error: '来源切片、ASR 与 SKU 尚未完成同版本核验；保留原成片，等待有效依据。'};
      const beforeError = await verifyReviewFiles(input,{hashFile});
      if (beforeError) return {error:beforeError};
      const framework = getFramework(library, render.templateId);
      if (!framework) return {error: '原框架已不可用，未按其他框架重新解释旧成片。'};
      const result = await assessOutputFileAutomatically({
        filePath: input.filePath,
        expectedDuration: state.clips.reduce((total, clip) => total + clip.durationSeconds, 0),
        targetDuration: variant.targetDurationSeconds,
        clipSequence: variant.clipSequence,
        activeSlotCount: Object.values(variant.slotMapping || {}).filter(Boolean).length,
        frameworkSlotCount: framework.slots.length,
        includeUsageDisclaimer: variant.usageDisclaimerApplied,
        usageDisclaimerText: variant.usageDisclaimerText,
        existingHashes: new Set(library.renders.flatMap(item => item.variants
          .filter(value => item.id !== render.id || value.id !== variant.id).map(value => value.contentSha256))),
        clips: state.clips, productCategory: render.productCategory, library,
        automationRunId: render.automation.runId, bindingFingerprint: state.current.review,
        reviewAllowed: async () => {
          const allowed=()=>automationContextAllowed({...render.automation,createdById:render.createdById});
          if(!(await allowed())) return false;
          await assertCurrentVersionedClips(state.clips,library,allowed,render.automation?.jobId);
          return true;
        },
      });
      const afterError = await verifyReviewFiles(input,{hashFile});
      await assertCurrentVersionedClips(state.clips,library,()=>automationContextAllowed({...render.automation,createdById:render.createdById}),render.automation?.jobId);
      return afterError ? {error:afterError} : result;
    },
  });

  const evidenceHoldChecks = new Map();
  const occupiesBasicWorkSlot=(render,variant,job)=>basicWorkCount({renders:[{...render,variants:[variant]}]},job)>0;
  const retryMetadataOnlyMigration=(render,variant,library)=>(variant.basicMigrationAttempt?.status==='failed'
    &&variant.basicMigrationAttempt.error==='原片来源文件变化，自动换片'
    &&!variant.basicMigrationAttempt.sourceHashBackfillRechecked
    ||variant.basicMigrationAttempt?.status==='retrying'&&variant.basicMigrationAttempt.sourceHashBackfillRechecked
    ||basicVariantPassed(variant)&&bindingState(render,variant,library).sourceHashBackfillPending)
    &&Boolean(bindingState(render,variant,library).sourceHashBackfills?.length);
  const migrateBasicOutputs = async () => {
    const library=await readLibrary();
    // Reuse existing completed MP4s first. This does not enroll manual renders,
    // wake paused jobs, erase company results or send another model request.
    for(const render of library.renders)for(const variant of render.variants){
      const job=library.autoJobs.find(item=>item.id===render.automation?.jobId);
      const retryBackfill=retryMetadataOnlyMigration(render,variant,library);
      if(!job||!canPerformAutomaticEffects(library,job,render)||hasPlatformQuarantine(variant)
        ||variant.reviewMode===BASIC_REVIEW_MODE&&!retryBackfill||variant.basicMigrationAttempt?.sha256===variant.contentSha256
          &&(variant.basicMigrationAttempt.status==='retrying'?Date.parse(variant.basicMigrationAttempt.nextRetryAt)>Date.now():!retryBackfill))continue;
      if(job.id===HISTORICAL_INVENTORY_JOB&&(basicOutputUnavailable(variant)
        ||basicWorkCount(library,job)>=20&&!occupiesBasicWorkSlot(render,variant,job)))continue;
      const state=bindingState(render,variant,library),frozen=JSON.stringify(variant);
      let result,proofs,errorMessage='';
      try{
        if(!state.current||!state.clips.length||['source_content_changed','source_missing'].includes(state.reason))throw Error('原片来源文件变化，自动换片');
        proofs=await verifyBasicInputFiles(render,variant,library,true);
        const framework=getFramework(library,render.templateId);
        if(!framework)throw Error('原框架不可用');
        result=await assessOutputFileAutomatically({filePath:path.join(outputsDir,variant.storedName),
          expectedDuration:state.clips.reduce((total,clip)=>total+clip.durationSeconds,0),
          targetDuration:variant.targetDurationSeconds||job.targetDurationSeconds,
          clipSequence:variant.clipSequence,activeSlotCount:Object.values(variant.slotMapping||{}).filter(Boolean).length,
          frameworkSlotCount:framework.slots.length,includeUsageDisclaimer:variant.usageDisclaimerApplied,
          usageDisclaimerText:variant.usageDisclaimerText,
          existingHashes:new Set(library.renders.flatMap(row=>row.variants.filter(item=>row.id!==render.id||item.id!==variant.id).map(item=>item.contentSha256))),
          clips:state.clips,productCategory:render.productCategory,library,
          automationRunId:render.automation.runId,outputReviewPolicy:BASIC_REVIEW_POLICY});
        if(result.sha256!==variant.contentSha256)throw Error('原成片文件版本变化');
        await verifyBasicInputFiles(render,{...variant,basicInputFiles:proofs,
          ...(state.sourceHashBackfills?.length?{basicSourceHashBackfills:state.sourceHashBackfills}:{})},await readLibrary());
      }catch(error){errorMessage=error.message||'基础检查暂未完成';}
      await updateLibrary(latest=>{
        const liveRender=latest.renders.find(item=>item.id===render.id),live=liveRender?.variants.find(item=>item.id===variant.id);
        const owner=latest.autoJobs.find(item=>item.id===liveRender?.automation?.jobId);
        if(!live||JSON.stringify(live)!==frozen||!canPerformAutomaticEffects(latest,owner,liveRender))return unchangedLibrary(null);
        if(!errorMessage&&state.sourceHashBackfills?.length&&bindingState(liveRender,{...live,basicSourceHashBackfills:state.sourceHashBackfills},latest).reason==='source_content_changed')return unchangedLibrary(null);
        const terminal=Boolean(errorMessage&&/来源文件变化|文件版本(?:已)?变化|来源不可用|来源或权限已变化|原框架不可用/u.test(errorMessage));
        if(retryBackfill&&live.basicMigrationAttempt?.status==='failed')live.basicMigrationHistory=[...(live.basicMigrationHistory||[]),live.basicMigrationAttempt];
        live.basicMigrationAttempt={sha256:live.contentSha256,at:nowIso(),error:errorMessage,
          ...(state.sourceHashBackfills?.length?{sourceHashBackfillRechecked:true,sourceHashBackfills:state.sourceHashBackfills}:{}),
          status:errorMessage?(terminal?'failed':'retrying'):'completed',
          nextRetryAt:errorMessage&&!terminal?new Date(Date.now()+300_000).toISOString():null};
        if(errorMessage){
          if(terminal){
            live.reviewHistory=[...(live.reviewHistory||[]),{assessment:live.automaticAssessment,reviewMode:live.reviewMode,reviewStatus:live.reviewStatus,reviewedAt:live.reviewedAt}];
            live.reviewMode=BASIC_REVIEW_MODE;live.reviewStatus='changes_requested';
            live.automaticAssessment={...live.automaticAssessment,status:'failed',autoApproved:false,integrityFailure:{reason:'basic_input_invalid',summary:errorMessage}};
            live.reviewNote='基础文件检查失败，自动生成替代组合：'+errorMessage;
          }
          return;
        }
        live.reviewHistory=[...(live.reviewHistory||[]),{assessment:live.automaticAssessment,reviewMode:live.reviewMode,
          reviewBinding:live.reviewBinding,reviewStatus:live.reviewStatus,reviewNote:live.reviewNote,reviewedAt:live.reviewedAt}];
        const passed=result.assessment.status==='passed';
        live.reviewMode=BASIC_REVIEW_MODE;live.automaticAssessment={...result.assessment,autoApproved:passed};
        live.basicInputFiles=proofs;live.reviewBinding=state.current;
        if(state.sourceHashBackfills?.length)live.basicSourceHashBackfills=[...new Map([...(live.basicSourceHashBackfills||[]),...state.sourceHashBackfills].map(row=>[row.sourceId,row])).values()];
        live.reviewStatus=passed?'approved':'changes_requested';live.reviewedAt=nowIso();
        live.reviewNote=passed?'现有成片基础检查通过，自动继续回传与投放，无需人工复核。':'基础检查失败，保留原片并自动生成替代组合。';
        if(live.sourceRevalidation)live.sourceRevalidation={...live.sourceRevalidation,required:false,status:'completed',completedAt:nowIso()};
        if(live.automaticPolicyRevalidation)live.automaticPolicyRevalidation={...live.automaticPolicyRevalidation,required:false,resolvedAt:nowIso()};
        if(live.cloudDeliveryFeedback)live.cloudDeliveryFeedback.nextPollAt=nowIso();
      });
      return; // one local media pass per scheduler tick
    }
  };

  const continueBasicJobs = () => updateLibrary(library=>{
    let changed=false;
    for(const job of library.autoJobs){
      if(job.status!=='active'||job.archivedAt||!ownerCanUseAutomation(library,job)||activeAutoJobIds.has(job.id))continue;
      const renders=library.renders.filter(render=>render.automation?.jobId===job.id&&render.createdById===job.createdById);
      const pendingMigration=renders.some(render=>render.variants.some(variant=>(job.id!==HISTORICAL_INVENTORY_JOB||basicWorkCount(library,job)<20||occupiesBasicWorkSlot(render,variant,job))
        &&(variant.reviewMode!==BASIC_REVIEW_MODE||retryMetadataOnlyMigration(render,variant,library))
        &&!basicOutputUnavailable(variant)&&!hasPlatformQuarantine(variant)&&(retryMetadataOnlyMigration(render,variant,library)||variant.basicMigrationAttempt?.sha256!==variant.contentSha256||variant.basicMigrationAttempt.status==='retrying')));
      if(pendingMigration)continue;
      for(const run of job.runs||[]){
        if(!REVIEW_HOLD_STATUSES.has(run.status)||run.companyExhaustion)continue;
        // Migration may wake old inventory-only holds once. New source work
        // retains its bounded preparation/backoff or explicit dependency hold.
        if(run.automaticSourcePreparationVersion===1)continue;
        if(['PROGRESSIVE_ATTEMPT_LIMIT','PROGRESSIVE_RUN_ATTEMPT_LIMIT','OUTPUT_SEQUENCE_PENDING','RECOVERY_REGISTRATION_ONLY','JOURNAL_RECOVERY_BLOCKED'].includes(run.automaticReviewHold?.reason))continue;
        if(run.automaticReviewHold?.reason==='PROGRESSIVE_TARGET_REACHED'&&basicWorkCount(library,job)>=20)continue;
        if(run.automaticReviewHold)run.automaticReviewHold={...run.automaticReviewHold,resolvedAt:nowIso(),resolution:BASIC_REVIEW_POLICY};
        run.resumeRequestedAt=nowIso();run.status='queued';job.nextRunAt=nowIso();changed=true;
      }
      if(job.id!==HISTORICAL_INVENTORY_JOB)continue;
      const delivered=basicDeliveryCount(library,job);
      if(delivered>=20){if(job.nextRunAt!==null){job.nextRunAt=null;changed=true;}continue;}
      // All work slots are occupied while native audit may still be pending.
      // Keep normal receipt polling, but do not re-arm prepareAutoRun, whose
      // cap/finally would otherwise request another immediate scheduler tick.
      if(basicWorkCount(library,job)>=20){if(job.nextRunAt!==null){job.nextRunAt=null;changed=true;}continue;}
      const awaitingEffects=renders.some(render=>render.variants.some(variant=>basicVariantPassed(variant)&&!basicOutputUnavailable(variant)
        &&!(variant.qianchuanDeliveries||[variant.qianchuanDelivery]).some(state=>state?.status==='success')));
      if(awaitingEffects)continue;
      if(!job.runs.some(run=>['queued','preparing','generating','repairing','awaiting_sources','awaiting_review','awaiting_clip_review'].includes(run.status))
        &&progressiveOutputUsage(library,job).attempts<PROGRESSIVE_OUTPUT_ATTEMPT_LIMIT&&!job.nextRunAt){job.nextRunAt=nowIso();changed=true;}
    }
    if(!changed)return unchangedLibrary(null);
  });

  const companyFeedbackWritable=(library,render)=>{
    if(render?.automation?.jobId!==HISTORICAL_INVENTORY_JOB)return true;
    const job=library.autoJobs.find(item=>item.id===render.automation.jobId);
    return Boolean(job?.status==='active'&&!job.archivedAt&&ownerCanUseAutomation(library,job));
  };
  const consumeCompanyReview=async({render,variant,review})=>{
    const initial=await readLibrary(),currentRender=initial.renders.find(item=>item.id===render.id);
    const current=currentRender?.variants.find(item=>item.id===variant.id);
    const job=initial.autoJobs.find(item=>item.id===currentRender?.automation?.jobId);
    if(!companyRecoveryEnabled(job)||!companyFeedbackWritable(initial,currentRender)||!current
      ||currentRender.sourceEvidencePolicy!==HISTORICAL_OUTPUT_RULES_POLICY||!historicalRulesVariantPassed(current)
      ||!inspectCompanyReview({job,render:currentRender,variant:current,review}).accepted)return;
    const binding=bindingState(currentRender,current,initial);
    if(binding.reason||binding.clips.some(clip=>!canReadClip(clip,getSource(initial,clip.sourceId),{id:job.createdById})))return;
    const fingerprint=(r,v)=>historicalSnapshotDigest([r.id,r.createdById,r.automation,r.productCategory,v.id,v.storedName,v.contentSha256,
      v.generationBinding,v.reviewBinding,v.historicalInventoryReview,v.materialCenterReturn]);
    const expected=fingerprint(currentRender,current),file=path.join(outputsDir,current.storedName);
    if(path.dirname(path.resolve(file))!==path.resolve(outputsDir))return;
    try {const stat=await fs.lstat(file);if(!stat.isFile()||stat.isSymbolicLink()||await hashFile(file)!==current.contentSha256)return;}
    catch{return;}
    await updateLibrary(latest=>{
      const liveRender=latest.renders.find(item=>item.id===render.id),live=liveRender?.variants.find(item=>item.id===variant.id);
      const liveJob=latest.autoJobs.find(item=>item.id===liveRender?.automation?.jobId);
      if(!live||!companyRecoveryEnabled(liveJob)||!companyFeedbackWritable(latest,liveRender)||fingerprint(liveRender,live)!==expected
        ||bindingState(liveRender,live,latest).reason||bindingState(liveRender,live,latest).clips.some(clip=>
          !canReadClip(clip,getSource(latest,clip.sourceId),{id:liveJob.createdById})))return unchangedLibrary(null);
      const result=applyCompanyReject({library:latest,renderId:render.id,variantId:variant.id,review,now:nowIso(),ownerAuthorized:true});
      if(!result.changed)return unchangedLibrary(null);
    });
  };
  const continueCompanyJob=()=>updateLibrary(library=>{
    const job=library.autoJobs.find(item=>item.id===HISTORICAL_INVENTORY_JOB);
    if(!companyRecoveryEnabled(job)||job.status!=='active'||!ownerCanUseAutomation(library,job)||activeAutoJobIds.has(job.id))return unchangedLibrary(null);
    const changed=settleCompanyRejectedRuns({library,job,ownerAuthorized:true,now:nowIso(),variantRulesPassed:historicalRulesVariantPassed});
    const decision=companyJobContinuation(library,job);
    if(['next','repair'].includes(decision.action)){
      if(job.nextRunAt&&Date.parse(job.nextRunAt)<=Date.now())return changed?undefined:unchangedLibrary(null);
      job.nextRunAt=nowIso();requestAutoSchedulerTick();return;
    }
    if(['wait','done'].includes(decision.action)&&job.nextRunAt!==null){job.nextRunAt=null;return;}
    return changed?undefined:unchangedLibrary(null);
  });
  const journalRecoveryChecks=new Map();
  const recoverJournalOutputs=async()=>{
    const snapshot=await readLibrary(),now=Date.now();
    for(const job of snapshot.autoJobs){
      if(job.status!=='active'||job.archivedAt||activeAutoJobIds.has(job.id)||!ownerCanUseAutomation(snapshot,job)||now-(journalRecoveryChecks.get(job.id)||0)<60_000)continue;
      const run=(job.runs||[]).find(row=>['queued','preparing','generating','repairing','awaiting_review'].includes(row.status));
      const pending=job.sequenceReservations?.filter(row=>row.runId===run?.id&&row.status==='reserved')||[];
      if(!run||!pending.length)continue;
      journalRecoveryChecks.set(job.id,now);activeAutoJobIds.add(job.id);
      let records=[],expectedRunState=journalRunState(job,run);
      try{
        for(const renderId of new Set(pending.map(row=>row.renderId)))records.push(...await readRegistrationJournals(path.join(root,'registration-journal'),renderId));
        if(!records.length)continue; // old files require the explicit local-review tool
        const fresh=await readCommittedLibrary(),plan=inspectJournalRecovery(fresh,job.id,run.id,records,ownerCanUseAutomation);
        expectedRunState=journalRunState(plan.job,plan.run);
        const files=await verifyJournalFiles(plan,{outputsDir,clipsDir,playbackDir:process.env.RENDER_PLAYBACK_CACHE_DIR,hashFile});
        await updateLibrary(async latest=>{
          await files.assertUnchanged();
          const current=await readCommittedLibrary(),currentJob=current.autoJobs.find(row=>row.id===job.id),currentRun=currentJob?.runs.find(row=>row.id===run.id);
          if(!currentJob||!currentRun||journalRunState(currentJob,currentRun)!==expectedRunState)return unchangedLibrary(null);
          const result=applyJournalRecovery(current,job.id,run.id,records,ownerCanUseAutomation,nowIso());
          if(!result.changed)return unchangedLibrary(null);
          Object.assign(latest,result.library);
        });
      }catch(error){
        console.error('Registration journal recovery retained original files:',job.id,String(error.message).slice(0,240));
        await updateLibrary(async latest=>{
          const fresh=structuredClone(await readCommittedLibrary()),currentJob=fresh.autoJobs.find(row=>row.id===job.id),currentRun=currentJob?.runs.find(row=>row.id===run.id);
          if(!currentJob||!currentRun||currentJob.status!=='active'||!ownerCanUseAutomation(fresh,currentJob))return unchangedLibrary(null);
          if(journalRunState(currentJob,currentRun)!==expectedRunState)return unchangedLibrary(null);
          const summary='原成片审核凭证已保留，但当前文件、来源或登记校验未通过；未重新渲染、回传或投放。';
          if(currentRun.automaticReviewHold?.reason==='JOURNAL_RECOVERY_BLOCKED')return unchangedLibrary(null);
          currentRun.status='awaiting_review';currentRun.errorMessage=summary;currentRun.automaticReviewHold={kind:'recovery_registration',reason:'JOURNAL_RECOVERY_BLOCKED',summary,createdAt:nowIso(),checkedAt:nowIso()};
          delete currentRun.resumeRequestedAt;currentJob.nextRunAt=null;Object.assign(latest,fresh);
        });
      }finally{activeAutoJobIds.delete(job.id);}
      return; // at most one media replay per tick, never a recovery hot loop
    }
  };
  const autoSchedulerTick = async () => {
    if (process.env.WIS_REMIX_AUTOMATION_ENABLED === "0") return;
    if (autoSchedulerRunning) return;
    autoSchedulerRunning = true;
    try {
      await recoverJournalOutputs();
      await migrateBasicOutputs();
      await continueBasicJobs();
      let library = await readLibrary();
      const now = Date.now();
      const evidenceHolds = library.autoJobs.filter(job => job.status === 'active' && !job.archivedAt &&
        ownerCanUseAutomation(library,job) && (job.runs || []).some(run => run.status === 'awaiting_review' &&
          run.automaticReviewHold?.kind === 'source_evidence' && !run.resumeRequestedAt));
      for (const job of evidenceHolds) {
        const run = job.runs.find(item=>item.status==='awaiting_review' && item.automaticReviewHold?.kind==='source_evidence');
        if (now - (evidenceHoldChecks.get(job.id) || Date.parse(run.automaticReviewHold.checkedAt) || now) < 300_000) continue;
        evidenceHoldChecks.set(job.id,now);
        const backfill=await versionBackfillCandidates(library,job,run);
        if (!buildReviewedReadiness(library,job,run.targetDurationSeconds).canProduce && !backfill.length) continue;
        await updateLibrary(latest => {
          const currentJob = latest.autoJobs.find(item=>item.id===job.id);
          const currentRun = currentJob?.runs.find(item=>item.id===run.id);
          if (!currentJob || !currentRun) return unchangedLibrary(null);
          const ready = buildReviewedReadiness(latest,currentJob,currentRun.targetDurationSeconds).canProduce || backfill.length>0;
          if (!resumeEvidenceHold(currentJob,currentRun,{ready,ownerAuthorized:ownerCanUseAutomation(latest,currentJob)},nowIso()))
            return unchangedLibrary(null);
        });
      }
      if (evidenceHolds.length) library = await readLibrary();
      const continuousSupplyDue = library.clipReplenishmentJobs.some(
        (job) =>
          job.continuous &&
          job.status === 'watching' &&
          job.nextScanAt &&
          new Date(job.nextScanAt).getTime() <= now,
      );
      if (continuousSupplyDue) {
        await updateScanLibrary((latest) => {
          for (const job of latest.clipReplenishmentJobs) {
            if (
              !job.continuous ||
              job.status !== 'watching' ||
              !job.nextScanAt ||
              new Date(job.nextScanAt).getTime() > now
            ) {
              continue;
            }
            job.status = 'active';
            job.nextScanAt = null;
            for (const target of job.targets) {
              if (['exhausted', 'watching'].includes(target.status)) {
                target.status = 'active';
              }
            }
            job.updatedAt = nowIso();
          }
        });
        library = await readLibrary();
      }
      const dueAutoJobs = library.autoJobs
        .filter(job => isAutoJobDue(job, now))
        .sort(
          (left, right) =>
            new Date(left.nextRunAt).getTime() -
            new Date(right.nextRunAt).getTime(),
        );
      for (const job of dueAutoJobs) {
        if (activeAutoJobIds.size >= AUTO_REMIX_MAX_CONCURRENT_JOBS) break;
        if (
          !activeAutoJobIds.has(job.id) &&
          (isAutoRemixAdmin({
            sub: job.createdById,
            name: job.createdByName,
            local: job.createdById === 'local-user',
          }) ||
            Boolean(
              autoRemixGrantFor(library, {
                id: job.createdById,
                name: job.createdByName,
              }),
            ))
        ) {
          void processAutoJob(job.id).catch((error) => {
            console.error('Auto-remix scheduler job error:', error);
          });
        }
      }
      for (const job of library.clipReplenishmentJobs) {
        if (
          activeClipReplenishmentJobIds.size >=
          CLIP_REPLENISHMENT_MAX_CONCURRENT_JOBS
        ) {
          break;
        }
        if (
          job.status === 'active' &&
          !activeClipReplenishmentJobIds.has(job.id)
        ) {
          void processClipReplenishmentJob(job.id).catch((error) => {
            console.error('Clip replenishment scheduler error:', error);
          });
        }
      }
      // Automatic basic migration owns current file revalidation; the legacy
      // visual revalidator would otherwise queue unwanted content reviews.
      await retryDueAutoReturns();
      await refreshDueQianchuanDeliveries();
      await refreshReturnFeedback({ readLibrary, updateLibrary: updateScanLibrary, materialCenter,canSaveFeedback:companyFeedbackWritable,
        priorityFeedback:(library,render,variant)=>{
          const job=library.autoJobs.find(item=>item.id===render.automation?.jobId);
          if(!job||!canPerformAutomaticEffects(library,job,render))return 0;
          return qianchuanDeliveryStatesForVariant(variant).some(state=>automaticNativeAuditWaiting(library,render,variant,state))?2:1;
        },
        onCompanyReview:consumeCompanyReview,pollDelayMs:(_library,render)=>render.automation?.jobId?60_000:15*60_000 });
      await continueBasicJobs();
      await continueCompanyJob();
    } finally {
      autoSchedulerRunning = false;
    }
  };

  const requestAutoSchedulerTick = () => {
    const timer = setTimeout(
      () =>
        void autoSchedulerTick().catch((error) => {
          console.error('Auto-remix scheduler tick error:', error);
        }),
      0,
    );
    timer.unref?.();
  };

  const initialize = async () => {
    if (readOnly) { await readLibrary(); return; }
    await ensureStorage();
    await manualOperations.initialize();
    await clipReviewBatches.initialize();
    await updateLibrary((library) => {
      ensureContinuousClipSupplyJob(library);
      let acceleratedDeliveryIndex = 0;
      for (const job of library.autoJobs) {
        // Recover only the old machine-generated storage failure; never wake
        // user-paused, archived or unauthorized jobs on deployment.
        const storageFailed=job.runs?.find(run=>['failed','partial'].includes(run.status)&&isLibraryConflict(run.errorMessage));
        if(job.status==='error'&&!job.archivedAt&&ownerCanUseAutomation(library,job)&&storageFailed){
          job.status='active';job.nextRunAt=nowIso();storageFailed.status='queued';storageFailed.completedAt=null;
          storageFailed.errorMessage=autoRecoverySummary(storageFailed.errorMessage);
          for(const report of normalizedAutomationStageReports(storageFailed.stageReports))if(report.status==='failed'&&isLibraryConflict(report.summary))
            patchRunStageReport(storageFailed,report.key,{status:'retrying',summary:storageFailed.errorMessage,completedAt:null});
        }
        preserveAutoJobOnRestart(job, nowIso());
        const recoverableRun = job.runs?.find(
          (run) =>
            ['partial', 'failed'].includes(run.status) &&
            Number(run.generatedCount || 0) < Number(run.targetCount || 0) &&
            isRecoverableAutoPipelineError(run.errorMessage),
        );
        if (recoverableRun && job.status === 'active' && job.nextRunAt &&
            !(job.runs || []).some(run => REVIEW_HOLD_STATUSES.has(run.status) && !run.resumeRequestedAt)) {
          const recoverySummary = autoRecoverySummary(
            recoverableRun.errorMessage,
          );
          recoverableRun.status = 'awaiting_sources';
          recoverableRun.completedAt = null;
          recoverableRun.errorMessage = recoverySummary;
          recoverableRun.recoveryCount =
            Math.max(0, Number(recoverableRun.recoveryCount) || 0) + 1;
          recoverableRun.lastRecoveredAt = nowIso();
          recoverableRun.lastRecoveryMessage = recoverySummary;
          for (const report of normalizedAutomationStageReports(
            recoverableRun.stageReports,
          )) {
            if (report.status !== 'failed') continue;
            patchRunStageReport(recoverableRun, report.key, {
              status: 'retrying',
              failedCount: 0,
              summary: recoverySummary,
              evidence: [...report.evidence, recoverySummary],
              currentItem: '等待系统自动换源续跑',
              completedAt: null,
            });
          }
          job.status = 'active';
          job.updatedAt = nowIso();
        }
      }
      for (const render of library.renders) {
        for (const variant of render.variants) {
          for (const state of qianchuanDeliveryStatesForVariant(variant)) {
            if (
              state?.taskId &&
              ['partial', 'failed'].includes(state.status) &&
              state.safeRetryPolicyVersion !==
                QIANCHUAN_SAFE_RETRY_POLICY_VERSION &&
              QIANCHUAN_SHORT_RETRY_PATTERN.test(
                [state.message, state.errorMessage, state.errorAdvice]
                  .map((value) => String(value || ''))
                  .join(' '),
              )
            ) {
              state.nextRetryAt = new Date(
                Date.now() + 60_000 + acceleratedDeliveryIndex * 5_000,
              ).toISOString();
              state.safeRetryPolicyVersion =
                QIANCHUAN_SAFE_RETRY_POLICY_VERSION;
              acceleratedDeliveryIndex += 1;
            }
            if (
              state?.status === 'failed' &&
              isQianchuanDailyCapacityDeferred(
                state.message,
                state.errorMessage,
                state.errorAdvice,
              )
            ) {
              setQianchuanStateForTarget(
                variant,
                state,
                deferQianchuanDeliveryForCapacity(state, state.errorMessage),
              );
            }
          }
        }
      }
    });
    if (!autoSchedulerTimer) {
      autoSchedulerTimer = setInterval(
        () =>
          void autoSchedulerTick().catch((error) => {
            console.error('Auto-remix scheduler tick error:', error);
          }),
        AUTO_REMIX_SCHEDULER_INTERVAL_MS,
      );
      autoSchedulerTimer.unref?.();
    }
    requestAutoSchedulerTick();
  };

  const route = async (req, res, url, accessContext = null) => {
    if (readOnly && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      jsonResponse(res, 423, { message: '当前为只读预览，原任务与素材保持不变。' });
      return true;
    }
    const identity = accessIdentity(accessContext);
    const freshOperations = async (operations) => {
      if (!operations.some((item) => item?.result)) return operations;
      const library = await readLibrary();
      const sources = new Map(library.sources.map((item) => [item.id, item]));
      const clips = new Map(library.clips.map((item) => [item.id, item]));
      const folders = library.folders.filter(
        (item) => item.createdById === identity.id,
      );
      return operations.map((operation) => {
        if (!operation?.result) return operation;
        const {
          source: previousSource,
          clip: previousClip,
          render: previousRender,
          ...result
        } = operation.result;
        if (previousRender?.id) {
          const visible = publicLibrary(library, accessContext).renders.find(item => item.id === previousRender.id);
          if (visible) result.render = visible;
        }
        const source = sources.get(previousSource?.id);
        const clip = clips.get(previousClip?.id);
        // Persisted completion snapshots must not resurrect deleted items or
        // overwrite newer corrections/reviews when a page reconnects.
        if (canReadSource(source, identity))
          result.source = publicSourceRecordForUser(source, accessContext);
        if (canReadClip(clip, sources.get(clip?.sourceId), identity))
          result.clip = publicClipRecord(clip, accessContext, folders, library);
        return { ...operation, result };
      });
    };
    if (url.pathname === '/api/remix/clip-reviews' && ['POST','GET'].includes(req.method)) {
      try {
        if (req.method === 'POST') jsonResponse(res, 202, {operation:await clipReviewBatches.submit(await readJsonBody(req),identity)});
        else jsonResponse(res, 200, {operations:await clipReviewBatches.list(identity)});
      } catch(error) {jsonResponse(res,400,{message:error.message||'批量审核提交失败'});}
      return true;
    }
    const clipReviewBatchMatch = url.pathname.match(/^\/api\/remix\/clip-reviews\/([a-f0-9-]+)$/);
    if(req.method==='GET' && clipReviewBatchMatch){
      const operation=await clipReviewBatches.get(clipReviewBatchMatch[1],identity);
      jsonResponse(res,operation?200:404,operation?{operation}:{message:'审核任务不存在或无权访问'});
      return true;
    }
    const resourceMatch = url.pathname.match(
      /^\/api\/remix\/(?:media\/)?(sources?|clips?)\/([^/]+)/u,
    );
    if (resourceMatch) {
      const library = await readLibrary();
      const id = decodeURIComponent(resourceMatch[2]);
      const sourceRoute = resourceMatch[1].startsWith('source');
      const record = sourceRoute
        ? getSource(library, id)
        : getClip(library, id);
      const allowed = sourceRoute
        ? canReadSource(record, identity)
        : canReadClip(record, getSource(library, record?.sourceId), identity);
      if (!allowed) {
        jsonResponse(res, 404, { message: '素材不存在或无权访问。' });
        return true;
      }
    }
    if (url.pathname === '/api/remix/operations' && req.method === 'GET') {
      jsonResponse(res, 200, {
        operations: await freshOperations(manualOperations.list(identity)),
      });
      return true;
    }
    if (url.pathname === '/api/remix/operations' && req.method === 'POST') {
      try {
        const body = await readJsonBody(req);
        if (!['import', 'import-private', 'analyze', 'clip', 'render', 'download-bundle'].includes(body.type))
          throw new Error('不支持的处理类型。');
        if (body.type === 'import-private' && !privateUploadAllowed(accessContext))
          throw new Error('私人素材功能尚未开放，未改为共享导入。');
        if (!['import', 'import-private', 'render', 'download-bundle'].includes(body.type))
          assertSourceAccess(
            getSource(await readLibrary(), body.payload?.sourceId),
            identity,
          );
        jsonResponse(res, 202, {
          operation: await manualOperations.submit(
            body.type,
            body.payload || {},
            identity,
          ),
        });
      } catch (error) {
        jsonResponse(res, 400, { message: error.message });
      }
      return true;
    }
    const operationMatch = url.pathname.match(
      /^\/api\/remix\/operations\/([a-f0-9-]+)$/u,
    );
    if (operationMatch && req.method === 'GET') {
      const [operation] = await freshOperations([
        manualOperations.get(operationMatch[1], identity),
      ]);
      jsonResponse(
        res,
        operation ? 200 : 404,
        operation ? { operation } : { message: '任务不存在或无权访问。' },
      );
      return true;
    }
    const retryOperationMatch = url.pathname.match(
      /^\/api\/remix\/operations\/([a-f0-9-]+)\/retry$/u,
    );
    if (retryOperationMatch && req.method === 'POST') {
      try {
        jsonResponse(res, 202, {
          operation: await manualOperations.retry(
            retryOperationMatch[1],
            identity,
          ),
        });
      } catch (error) {
        jsonResponse(res, 404, { message: error.message });
      }
      return true;
    }
    if (req.method === 'GET' && url.pathname === '/api/remix/material-center/private-assets') {
      try {
        if (!privateUploadAllowed(accessContext)) throw new Error('私人素材功能尚未对当前账号开放。');
        if (!materialCenter.configured || !materialCenter.listPrivateAssets) throw new Error('云管家私人素材接口未接通。');
        jsonResponse(res, 200, await materialCenter.listPrivateAssets(identity.id, {
          query: url.searchParams.get('q') || '', page: Math.max(1, Math.trunc(Number(url.searchParams.get('page')) || 1)),
        }));
      } catch (error) { jsonResponse(res, 400, { message: error.message }); }
      return true;
    }
    const libraryReadRoute = url.pathname === '/api/remix/library' ||
      url.pathname === '/api/remix/library/progress' ||
      url.pathname === '/api/remix/library/records' ||
      /^\/api\/remix\/library\/sources\/[^/]+$/.test(url.pathname);
    if (req.method === 'GET' && libraryReadRoute) {
      const started = performance.now();
      // The server already verified OA and the signed worker identity. A
      // bookkeeping write must never prevent reading the committed workspace.
      rememberVerifiedIdentity(accessContext);
      const library = await readCommittedLibrary();
      const scopeKey = JSON.stringify([identity, Boolean(accessContext?.local), url.pathname, url.search, readModelEpoch, readModelRevision]);
      const etag = `"${createHash('sha256').update(scopeKey).digest('hex')}"`;
      res.setHeader?.('Cache-Control', 'private, no-cache');
      res.setHeader?.('Vary', 'Origin, Authorization, Cookie');
      res.setHeader?.('ETag', etag);
      if (req.headers?.['if-none-match'] === etag) {
        res.writeHead(304); res.end(); return true;
      }
      let result;
      if (url.pathname.startsWith('/api/remix/library/sources/')) {
        const source = getSource(library, decodeURIComponent(url.pathname.split('/').at(-1)));
        if (!canReadSource(source, identity)) {
          jsonResponse(res, 404, { message: '素材不存在或无权访问。' }); return true;
        }
        result = { source: { ...publicSourceRecordForUser(source, accessContext), detailsLoaded: true }, revision: `${readModelEpoch}:${readModelRevision}` };
      } else if (url.pathname.endsWith('/records')) {
        const kind = url.searchParams.get('kind') || 'sources';
        if (!['sources', 'clips', 'renders'].includes(kind)) {
          jsonResponse(res, 400, { message: '不支持的素材列表类型。' }); return true;
        }
        const compact = publicLibrary(library, accessContext, 'compact');
        result = { ...selectRecordPage(compact[kind], url.searchParams, kind, compact.folders), revision: compact.revision };
      } else if (url.pathname.endsWith('/progress')) {
        const progress = publicLibrary(library, accessContext, 'progress');
        result = { revision: progress.revision, catalogRevision: progress.catalogRevision, automation: progress.automation, permissions: progress.permissions };
      } else {
        result = publicLibrary(library, accessContext, url.searchParams.get('view') === 'compact' ? 'compact' : 'full');
      }
      res.setHeader?.('Server-Timing', `remix-read;dur=${(performance.now() - started).toFixed(2)}`);
      jsonResponse(res, 200, result);
      return true;
    }
    if (
      req.method === 'GET' &&
      url.pathname === '/api/remix/automation/access'
    ) {
      rememberVerifiedIdentity(accessContext);
      const library = await readCommittedLibrary();
      jsonResponse(res, 200, {
        access: autoRemixAccessState(library, accessContext),
      });
      return true;
    }
    if (
      req.method === 'POST' &&
      url.pathname === '/api/remix/automation/access/grants'
    ) {
      try {
        const access = await grantAutoRemixAccess(
          await readJsonBody(req),
          accessContext,
        );
        jsonResponse(res, 201, { access });
      } catch (error) {
        jsonResponse(res, error?.statusCode || 400, {
          message:
            error instanceof Error ? error.message : '自动混剪授权失败。',
        });
      }
      return true;
    }
    if (
      req.method === 'GET' &&
      url.pathname === '/api/remix/automation/qianchuan/accounts'
    ) {
      try {
        const library = await readLibrary();
        assertAutoRemixAccess(library, accessContext);
        jsonResponse(res, 200, await materialCenter.listQianchuanAccounts());
      } catch (error) {
        jsonResponse(res, error?.statusCode || 502, {
          message:
            error instanceof Error ? error.message : '千川账户目录读取失败。',
        });
      }
      return true;
    }
    if (
      req.method === 'GET' &&
      url.pathname === '/api/remix/automation/qianchuan/product-plan-map'
    ) {
      try {
        const library = await readLibrary();
        assertAutoRemixAccess(library, accessContext);
        jsonResponse(
          res,
          200,
          await materialCenter.getQianchuanProductPlanMap(),
        );
      } catch (error) {
        jsonResponse(res, error?.statusCode || 502, {
          message:
            error instanceof Error
              ? error.message
              : '千川产品计划映射读取失败。',
        });
      }
      return true;
    }
    if (
      req.method === 'GET' &&
      url.pathname === '/api/remix/automation/qianchuan/plans'
    ) {
      try {
        const library = await readLibrary();
        assertAutoRemixAccess(library, accessContext);
        jsonResponse(
          res,
          200,
          await materialCenter.listQianchuanPlans({
            advertiserId: url.searchParams.get('advertiser_id') || '',
            query: url.searchParams.get('q') || '',
            scope: url.searchParams.get('scope') || 'all',
            refresh: url.searchParams.get('refresh') === 'true',
            cachedOnly: url.searchParams.get('cached_only') === 'true',
          }),
        );
      } catch (error) {
        jsonResponse(res, error?.statusCode || 502, {
          message:
            error instanceof Error ? error.message : '千川计划目录读取失败。',
        });
      }
      return true;
    }
    const autoRemixGrantMatch = url.pathname.match(
      /^\/api\/remix\/automation\/access\/grants\/([^/]+)$/,
    );
    if (req.method === 'DELETE' && autoRemixGrantMatch) {
      try {
        const access = await revokeAutoRemixAccess(
          decodeURIComponent(autoRemixGrantMatch[1]),
          accessContext,
        );
        jsonResponse(res, 200, { access });
      } catch (error) {
        jsonResponse(res, error?.statusCode || 400, {
          message:
            error instanceof Error ? error.message : '自动混剪取消授权失败。',
        });
      }
      return true;
    }
    if (
      req.method === 'POST' &&
      url.pathname === '/api/remix/automation/jobs'
    ) {
      try {
        const job = await createAutoJob(await readJsonBody(req), accessContext);
        jsonResponse(res, 201, { job });
      } catch (error) {
        jsonResponse(res, error?.statusCode || 400, {
          message:
            error instanceof Error ? error.message : '自动混剪任务创建失败。',
        });
      }
      return true;
    }
    if (
      req.method === 'POST' &&
      url.pathname === '/api/remix/automation/jobs/cleanup'
    ) {
      try {
        const result = await cleanupCompletedAutoJobs(
          await readJsonBody(req),
          accessContext,
        );
        jsonResponse(res, 200, result);
      } catch (error) {
        jsonResponse(res, error?.statusCode || 400, {
          message:
            error instanceof Error ? error.message : '已完成计划清理失败。',
        });
      }
      return true;
    }
    const autoJobMatch = url.pathname.match(
      /^\/api\/remix\/automation\/jobs\/([^/]+)$/,
    );
    if (req.method === 'PATCH' && autoJobMatch) {
      try {
        const job = await updateAutoJob(
          decodeURIComponent(autoJobMatch[1]),
          await readJsonBody(req),
          accessContext,
        );
        jsonResponse(res, 200, { job });
      } catch (error) {
        jsonResponse(res, error?.statusCode || 400, {
          message:
            error instanceof Error ? error.message : '自动混剪任务保存失败。',
        });
      }
      return true;
    }
    if (req.method === 'DELETE' && autoJobMatch) {
      try {
        const result = await deleteCompletedAutoJob(
          decodeURIComponent(autoJobMatch[1]),
          accessContext,
        );
        jsonResponse(res, 200, result);
      } catch (error) {
        jsonResponse(res, error?.statusCode || 400, {
          message:
            error instanceof Error ? error.message : '已完成计划删除失败。',
        });
      }
      return true;
    }
    const autoJobActionMatch = url.pathname.match(
      /^\/api\/remix\/automation\/jobs\/([^/]+)\/(pause|resume|run-now)$/,
    );
    if (req.method === 'POST' && autoJobActionMatch) {
      try {
        const job = await controlAutoJob(
          decodeURIComponent(autoJobActionMatch[1]),
          autoJobActionMatch[2],
          accessContext,
        );
        jsonResponse(res, 200, { job });
      } catch (error) {
        jsonResponse(res, error?.statusCode || 400, {
          message:
            error instanceof Error ? error.message : '自动混剪任务操作失败。',
        });
      }
      return true;
    }
    if (
      url.pathname === '/api/integrations/material-center/clip-supply/run-now'
    ) {
      if (!accessContext?.service) {
        jsonResponse(res, 403, { message: '仅云管家受信服务可访问。' });
        return true;
      }
      if (req.method === 'POST') {
        try {
          const job = await wakeContinuousClipSupply();
          requestAutoSchedulerTick();
          jsonResponse(res, 202, { job });
        } catch (error) {
          jsonResponse(res, error?.statusCode || 400, {
            message:
              error instanceof Error
                ? error.message
                : '24小时切片供应线启动失败。',
          });
        }
        return true;
      }
    }
    if (
      url.pathname === '/api/integrations/material-center/clip-replenishment'
    ) {
      if (!accessContext?.service) {
        jsonResponse(res, 403, { message: '仅云管家受信服务可访问。' });
        return true;
      }
      if (req.method === 'POST') {
        try {
          const job = await createClipReplenishmentJob(
            await readJsonBody(req),
            accessContext,
          );
          if (job.status === 'active') {
            requestAutoSchedulerTick();
          }
          jsonResponse(res, 202, { job });
        } catch (error) {
          jsonResponse(res, error?.statusCode || 400, {
            message:
              error instanceof Error ? error.message : '切片补库启动失败。',
          });
        }
        return true;
      }
      if (req.method === 'GET') {
        const library = await readLibrary();
        const jobId = safeLabel(url.searchParams.get('job_id'), '');
        const job = jobId
          ? library.clipReplenishmentJobs.find(
              (candidate) => candidate.id === jobId,
            )
          : library.clipReplenishmentJobs[0];
        jsonResponse(res, job ? 200 : 404, {
          job: job || null,
          message: job ? '' : '未找到切片补库任务。',
        });
        return true;
      }
    }
    if (
      req.method === 'GET' &&
      url.pathname === '/api/remix/material-center/assets'
    ) {
      try {
        const page = await materialCenter.listAssets({
          query: url.searchParams.get('q') || '',
          libraryType: url.searchParams.get('library_type') || 'source',
          category: url.searchParams.get('category') || '',
          folder: url.searchParams.get('folder_name') || '',
          effectiveOnly: url.searchParams.get('effective_only') === 'true',
          page: Math.max(1, Number(url.searchParams.get('page')) || 1),
          pageSize: Math.min(
            100,
            Math.max(1, Number(url.searchParams.get('page_size')) || 20),
          ),
        });
        jsonResponse(res, 200, page);
      } catch (error) {
        jsonResponse(res, 502, {
          message:
            error instanceof Error ? error.message : '素材中心素材读取失败。',
        });
      }
      return true;
    }
    const effectiveStatusMatch = url.pathname.match(
      /^\/api\/(?:remix|integrations)\/material-center\/effective-clips\/status$/,
    );
    if (req.method === 'GET' && effectiveStatusMatch) {
      try {
        const status = await effectiveMaterialCenterImportStatus(
          url.searchParams.get('asset_id'),
          accessContext,
        );
        jsonResponse(res, 200, { status });
      } catch (error) {
        jsonResponse(res, 400, {
          message:
            error instanceof Error ? error.message : '有效切片状态读取失败。',
        });
      }
      return true;
    }
    if (
      req.method === 'POST' &&
      [
        '/api/remix/material-center/effective-clips/import',
        '/api/integrations/material-center/effective-clips/import',
      ].includes(url.pathname)
    ) {
      try {
        const payload = await readJsonBody(req);
        const operationAccessContext = url.pathname.startsWith(
          '/api/integrations/',
        )
          ? {
              sub: safeLabel(
                payload.actorNumber,
                'SERVICE-WIS-MATERIAL-CENTER',
              ),
              name: safeLabel(payload.actorName, '云管家有效一创同步'),
              service: true,
            }
          : accessContext;
        const status = await importEffectiveMaterialCenterClips(
          payload.assetId,
          operationAccessContext,
        );
        jsonResponse(res, 200, { status });
      } catch (error) {
        jsonResponse(res, error?.statusCode || 400, {
          message:
            error instanceof Error ? error.message : '有效一创切片导入失败。',
        });
      }
      return true;
    }
    if (
      req.method === 'POST' &&
      url.pathname === '/api/remix/material-center/imports'
    ) {
      try {
        const payload = await readJsonBody(req);
        const source = await importMaterialCenterSource(
          payload.assetId,
          accessContext,
          {assetLibrary:payload.assetLibrary || "source"},
        );
        jsonResponse(res, 201, {
          source: publicSourceRecordForUser(source, accessContext),
        });
      } catch (error) {
        jsonResponse(res, 400, {
          message:
            error instanceof Error ? error.message : '素材中心视频导入失败。',
        });
      }
      return true;
    }
    if (req.method === 'POST' && url.pathname === '/api/remix/sources') {
      try {
        const result = await createSource(req, accessContext);
        jsonResponse(res, 201, {
          source: publicSourceRecordForUser(result.source, accessContext),
          reused: result.reused,
        });
      } catch (error) {
        jsonResponse(res, 400, {
          message: error instanceof Error ? error.message : '源视频上传失败。',
        });
      }
      return true;
    }
    const analyzeMatch = url.pathname.match(
      /^\/api\/remix\/sources\/([^/]+)\/analyze$/,
    );
    if (req.method === 'POST' && analyzeMatch) {
      try {
        const source = await analyzeSource(decodeURIComponent(analyzeMatch[1]));
        jsonResponse(res, 200, {
          source: publicSourceRecordForUser(source, accessContext),
        });
      } catch (error) {
        jsonResponse(res, 400, {
          message:
            error instanceof Error ? error.message : '口播候选切点生成失败。',
        });
      }
      return true;
    }
    const frameworkRecognitionMatch = url.pathname.match(
      /^\/api\/remix\/sources\/([^/]+)\/framework-recognition$/,
    );
    if (req.method === 'POST' && frameworkRecognitionMatch) {
      try {
        const recognition = await recognizeFramework(
          decodeURIComponent(frameworkRecognitionMatch[1]),
        );
        jsonResponse(res, 200, { recognition });
      } catch (error) {
        jsonResponse(res, 400, {
          message:
            error instanceof Error ? error.message : '规则框架识别失败。',
        });
      }
      return true;
    }
    const segmentsMatch = url.pathname.match(
      /^\/api\/remix\/sources\/([^/]+)\/segments$/,
    );
    if (req.method === 'PATCH' && segmentsMatch) {
      try {
        const result = await updateSpeechSegments(
          decodeURIComponent(segmentsMatch[1]),
          await readJsonBody(req),
        );
        jsonResponse(res, 200, {
          source: publicSourceRecordForUser(result.source, accessContext),
          updatedCount: result.updatedCount,
        });
      } catch (error) {
        jsonResponse(res, 400, {
          message:
            error instanceof Error ? error.message : '口播片段批量保存失败。',
        });
      }
      return true;
    }
    const segmentMatch = url.pathname.match(
      /^\/api\/remix\/sources\/([^/]+)\/segments\/([^/]+)$/,
    );
    if (req.method === 'PATCH' && segmentMatch) {
      try {
        const source = await updateSpeechSegment(
          decodeURIComponent(segmentMatch[1]),
          decodeURIComponent(segmentMatch[2]),
          await readJsonBody(req),
        );
        jsonResponse(res, 200, {
          source: publicSourceRecordForUser(source, accessContext),
        });
      } catch (error) {
        jsonResponse(res, 400, {
          message:
            error instanceof Error ? error.message : '口播片段保存失败。',
        });
      }
      return true;
    }
    const sourceMetadataMatch = url.pathname.match(
      /^\/api\/remix\/sources\/([^/]+)\/metadata$/,
    );
    if (req.method === 'PATCH' && sourceMetadataMatch) {
      try {
        const source = await updateSourceMetadata(
          decodeURIComponent(sourceMetadataMatch[1]),
          await readJsonBody(req),
          accessContext,
        );
        jsonResponse(res, 200, {
          source: publicSourceRecordForUser(source, accessContext),
        });
      } catch (error) {
        jsonResponse(res, 403, {
          message:
            error instanceof Error ? error.message : '素材信息保存失败。',
        });
      }
      return true;
    }
    if (req.method === 'POST' && url.pathname === '/api/remix/frameworks') {
      try {
        const framework = await createFramework(
          await readJsonBody(req),
          accessContext,
        );
        jsonResponse(res, 201, { framework });
      } catch (error) {
        jsonResponse(res, 400, {
          message: error instanceof Error ? error.message : '框架保存失败。',
        });
      }
      return true;
    }
    const frameworkPromoteMatch = url.pathname.match(
      /^\/api\/remix\/frameworks\/([^/]+)\/promote$/,
    );
    if (req.method === 'POST' && frameworkPromoteMatch) {
      try {
        const framework = await promoteFramework(
          decodeURIComponent(frameworkPromoteMatch[1]),
          accessContext,
        );
        jsonResponse(res, 200, { framework });
      } catch (error) {
        jsonResponse(res, 400, {
          message: error instanceof Error ? error.message : '加入预设失败。',
        });
      }
      return true;
    }
    const frameworkDeleteMatch = url.pathname.match(
      /^\/api\/remix\/frameworks\/([^/]+)$/,
    );
    if (req.method === 'DELETE' && frameworkDeleteMatch) {
      try {
        const framework = await deleteFramework(
          decodeURIComponent(frameworkDeleteMatch[1]),
          accessContext,
        );
        jsonResponse(res, 200, { framework });
      } catch (error) {
        jsonResponse(res, 409, {
          message: error instanceof Error ? error.message : '框架删除失败。',
        });
      }
      return true;
    }
    const renameFolderMatch = url.pathname.match(/^\/api\/remix\/folders\/([^/]+)$/u);
    if (req.method === 'PATCH' && renameFolderMatch) {
      try {
        const payload = await readJsonBody(req);
        const folder = await updateLibrary(library => {
          const item = library.folders.find(f => f.id === decodeURIComponent(renameFolderMatch[1]) && f.createdById === identity.id);
          if (!item) throw new Error('分类不存在或无权修改');
          const name = safeLabel(payload.name, '');
          if (!name) throw new Error('分类名称不能为空');
          if (library.folders.some(f => f.id !== item.id && f.createdById === identity.id && f.parentId === item.parentId && f.name === name)) throw new Error('同级已有该分类名称');
          item.name = name; return item;
        });
        jsonResponse(res, 200, { folder: publicFolderRecord(folder, accessContext) });
      } catch (error) { jsonResponse(res, 400, { message: error.message }); }
      return true;
    }
    if (req.method === 'POST' && url.pathname === '/api/remix/folders') {
      try {
        const folder = await createFolder(
          await readJsonBody(req),
          accessContext,
        );
        jsonResponse(res, 201, {
          folder: publicFolderRecord(folder, accessContext),
        });
      } catch (error) {
        jsonResponse(res, 400, {
          message:
            error instanceof Error ? error.message : '个人文件夹创建失败。',
        });
      }
      return true;
    }
    const folderDeleteMatch = url.pathname.match(
      /^\/api\/remix\/folders\/([^/]+)$/,
    );
    if (req.method === 'DELETE' && folderDeleteMatch) {
      try {
        const folder = await deleteFolder(
          decodeURIComponent(folderDeleteMatch[1]),
          accessContext,
        );
        jsonResponse(res, 200, {
          folder: publicFolderRecord(folder, accessContext),
        });
      } catch (error) {
        jsonResponse(res, 409, {
          message:
            error instanceof Error ? error.message : '个人文件夹删除失败。',
        });
      }
      return true;
    }
    if (req.method === 'POST' && url.pathname === '/api/remix/clips') {
      try {
        const clip = await createClip(await readJsonBody(req), accessContext);
        jsonResponse(res, 201, {
          clip: publicClipRecord(clip, accessContext),
        });
      } catch (error) {
        jsonResponse(res, 400, {
          message: error instanceof Error ? error.message : '切片生成失败。',
        });
      }
      return true;
    }
    if (req.method === 'POST' && url.pathname === '/api/remix/clip-uploads') {
      try {
        if (url.searchParams.get('background') === '1') {
          const upload = await parseDirectClipUpload(req, accessContext);
          const operation = await manualOperations.submit(
            'upload-clip',
            { upload },
            identity,
          );
          jsonResponse(res, 202, { operation });
          return true;
        }
        const result = await createDirectClipUpload(req, accessContext);
        jsonResponse(res, result.reused ? 200 : 201, result);
      } catch (error) {
        jsonResponse(res, error?.statusCode || 400, {
          message:
            error instanceof Error ? error.message : '切片直接上传失败。',
        });
      }
      return true;
    }
    const clipFolderMatch = url.pathname.match(
      /^\/api\/remix\/clips\/([^/]+)\/folder$/,
    );
    if (req.method === 'PATCH' && clipFolderMatch) {
      try {
        const clip = await updateClipFolder(
          decodeURIComponent(clipFolderMatch[1]),
          await readJsonBody(req),
          accessContext,
        );
        jsonResponse(res, 200, {
          clip: publicClipRecord(clip, accessContext),
        });
      } catch (error) {
        jsonResponse(res, 400, {
          message:
            error instanceof Error ? error.message : '切片归类保存失败。',
        });
      }
      return true;
    }
    const clipMetadataMatch = url.pathname.match(
      /^\/api\/remix\/clips\/([^/]+)\/metadata$/,
    );
    if (req.method === 'PATCH' && clipMetadataMatch) {
      try {
        const clip = await updateClipMetadata(
          decodeURIComponent(clipMetadataMatch[1]),
          await readJsonBody(req),
          accessContext,
        );
        jsonResponse(res, 200, {
          clip: publicClipRecord(clip, accessContext),
        });
      } catch (error) {
        jsonResponse(res, 403, {
          message:
            error instanceof Error ? error.message : '切片信息保存失败。',
        });
      }
      return true;
    }
    const reviewMatch = url.pathname.match(
      /^\/api\/remix\/clips\/([^/]+)\/review$/,
    );
    if (req.method === 'POST' && reviewMatch) {
      try {
        const clip = await updateClipReview(
          decodeURIComponent(reviewMatch[1]),
          await readJsonBody(req),
          accessContext,
        );
        jsonResponse(res, 200, {
          clip: publicClipRecord(clip, accessContext),
        });
      } catch (error) {
        jsonResponse(res, 400, {
          message:
            error instanceof Error ? error.message : '审核结果保存失败。',
        });
      }
      return true;
    }
    if (req.method === 'POST' && url.pathname === '/api/remix/renders') {
      try {
        const render = await renderVariants(
          await readJsonBody(req),
          null,
          accessContext,
        );
        const visibleRender = publicLibrary(
          await readLibrary(),
          accessContext,
        ).renders.find((candidate) => candidate.id === render.id);
        jsonResponse(res, 201, { render: visibleRender });
      } catch (error) {
        jsonResponse(res, 400, {
          message: error instanceof Error ? error.message : '成片生成失败。',
        });
      }
      return true;
    }
    const renderReviewMatch = url.pathname.match(
      /^\/api\/remix\/renders\/([^/]+)\/variants\/([^/]+)\/review$/,
    );
    if (req.method === 'POST' && renderReviewMatch) {
      try {
        const result = await updateRenderReview(
          decodeURIComponent(renderReviewMatch[1]),
          decodeURIComponent(renderReviewMatch[2]),
          await readJsonBody(req),
          accessContext,
        );
        const autoReturn = await maybeAutoReturnVariant(
          result.render,
          result.variant,
        );
        const visibleRender = publicLibrary(
          await readLibrary(),
          accessContext,
        ).renders.find((candidate) => candidate.id === result.render.id);
        jsonResponse(res, 200, {
          render: visibleRender,
          variant: visibleRender?.variants.find(
            (candidate) => candidate.id === result.variant.id,
          ),
          autoReturn,
        });
      } catch (error) {
        jsonResponse(res, error?.statusCode || 400, {
          message:
            error instanceof Error ? error.message : '成片审核结果保存失败。',
        });
      }
      return true;
    }
    const materialReturnMatch = url.pathname.match(
      /^\/api\/remix\/renders\/([^/]+)\/variants\/([^/]+)\/return-to-material-center$/,
    );
    if (req.method === 'POST' && materialReturnMatch) {
      try {
        const result = await returnVariantToMaterialCenter(
          decodeURIComponent(materialReturnMatch[1]),
          decodeURIComponent(materialReturnMatch[2]),
          accessContext,
        );
        jsonResponse(res, 200, { result });
      } catch (error) {
        jsonResponse(res, error?.statusCode || 502, {
          message:
            error instanceof Error ? error.message : '成片回传素材中心失败。',
        });
      }
      return true;
    }
    const bundleMatch = url.pathname.match(/^\/api\/remix\/bundles\/([a-f0-9-]+)$/u);
    if (bundleMatch && req.method === 'GET') {
      try {
        const id = bundleMatch[1], directory = path.join(root, 'bundles');
        const record = JSON.parse(await fs.readFile(path.join(directory, id + '.json'), 'utf8'));
        if (record.owner !== identity.id) throw new Error('无权下载');
        const library = await readLibrary();
        for (const item of record.items) {
          const render = ownedRender(library, item.renderId, accessContext);
          const variant = render.variants.find(v => v.id === item.variantId);
          if (!variant || variant.reviewStatus !== 'approved') throw new Error('成片审核状态已变化，请重新打包');
        }
        const file = path.join(directory, id + '.zip'), stat = await fs.stat(file);
        res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Length': stat.size,
          'Content-Disposition': 'attachment; filename="WIS-remix.zip"', 'Cache-Control': 'no-store' });
        await pipeFileToResponse(req, res, file);
      } catch (error) { jsonResponse(res, 403, { message: error.message }); }
      return true;
    }
    const mediaMatch = url.pathname.match(
      /^\/api\/remix\/media\/(source|clip|output)\/([^/]+)(?:\/([^/]+))?$/,
    );
    if ((req.method === 'GET' || req.method === 'HEAD') && mediaMatch) {
      const [, type, id, variantId] = mediaMatch;
      const library = await readLibrary();
      try {
        if (type === 'source') {
          const source = getSource(library, decodeURIComponent(id));
          if (!source) throw new Error('未找到源视频。');
          if (url.searchParams.get('thumbnail') === '1') {
            await serveThumbnail(req, res, ['source', source.id, source.storedName, source.contentSha256], async () => {
              const original = path.join(sourcesDir, source.storedName);
              if (!(await missingMedia(original))) return original;
              if (source.browserPreviewStoredName) {
                const preview = path.join(sourcesDir, source.browserPreviewStoredName);
                if (!(await missingMedia(preview))) return preview;
              }
              // Do not proxy a complete cloud video as an image or start a full transcode for a card.
              throw Object.assign(new Error('原视频尚未缓存，点击播放可读取云端原片。'), { statusCode: 404 });
            });
            return true;
          }
          let missingOriginal=false;
          try { await fs.access(path.join(sourcesDir,source.storedName)); }
          catch(error) { if(error?.code==='ENOENT')missingOriginal=true;else throw error; }
          if(missingOriginal && source.materialCenterAssetId && materialCenter?.configured) {
            await serveOriginalCloudMedia(req,res,{source,identity:accessIdentity(accessContext),materialCenter,maxBytes:maxFileBytes});
            return true;
          }
          const prepared = await ensureBrowserPreview(source.id);
          if (!prepared?.browserPreviewStoredName) {
            throw new Error(
              prepared?.browserPreviewError || '浏览器兼容预览尚未生成。',
            );
          }
          await serveVideo(
            req,
            res,
            path.join(sourcesDir, prepared.browserPreviewStoredName),
          );
          return true;
        }
        if (type === 'clip') {
          const clip = getClip(library, decodeURIComponent(id));
          if (!clip) throw new Error('未找到切片。');
          if (url.searchParams.get('thumbnail') === '1') {
            await serveThumbnail(req, res, ['clip', clip.id, clip.storedName, clip.contentSha256, clip.startSeconds, clip.endSeconds], async () => {
              const original = path.join(clipsDir, clip.storedName);
              return await missingMedia(original) ? (await playbackRecovery.clip({ clip, source: getSource(library, clip.sourceId), identity })).path : original;
            });
            return true;
          }
          let file=path.join(clipsDir,clip.storedName);
          if(await missingMedia(file)) {
            const recovered=await playbackRecovery.clip({clip,source:getSource(library,clip.sourceId),identity:accessIdentity(accessContext)});
            file=recovered.path;res.setHeader('X-WIS-Media-Source',recovered.kind);
          }
          await serveVideo(req, res, file);
          return true;
        }
        const render = ownedRender(
          library,
          decodeURIComponent(id),
          accessContext,
        );
        const variant = render.variants.find(
          (item) => item.id === decodeURIComponent(variantId || ''),
        );
        if (!variant) throw new Error('未找到成片。');
        if (
          url.searchParams.get('download') === '1' &&
          variant.reviewStatus !== 'approved'
        ) {
          jsonResponse(res, 403, { message: '成片审核通过后才能下载。' });
          return true;
        }
        if (url.searchParams.get('thumbnail') === '1') {
          await serveThumbnail(req, res, ['output', render.id, variant.id, variant.contentSha256], async () => {
            const original = path.join(outputsDir, variant.storedName);
            return await missingMedia(original) ? (await playbackRecovery.output({ render, variant })).path : original;
          });
          return true;
        }
        let outputFile=path.join(outputsDir,variant.storedName);
        if(await missingMedia(outputFile)) {
          const recovered=await playbackRecovery.output({render,variant});
          outputFile=recovered.path;res.setHeader('X-WIS-Media-Source',recovered.kind);
        }
        await serveVideo(
          req,
          res,
          outputFile,
          url.searchParams.get('download') === '1' ? variant.outputName : null,
        );
        return true;
      } catch (error) {
        jsonResponse(res, error?.statusCode || 404, {
          message: error instanceof Error ? error.message : '媒体文件不存在。',
        });
        return true;
      }
    }
    return false;
  };

  return {
    initialize,
    route,
    runtimeState: () => ({
      pendingOutputRevalidationCount: outputRevalidator.pending(),
      pendingClipReviewCount: clipReviewBatches.pending(),
      autoJobMaxConcurrency: AUTO_REMIX_MAX_CONCURRENT_JOBS,
      activeAutoJobCount: activeAutoJobIds.size,
      clipReplenishmentMaxConcurrency: CLIP_REPLENISHMENT_MAX_CONCURRENT_JOBS,
      activeClipReplenishmentJobCount: activeClipReplenishmentJobIds.size,
      libraryCached: Boolean(libraryCache),
    }),
  };
};
