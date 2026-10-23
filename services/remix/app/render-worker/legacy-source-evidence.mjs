import {createHash} from 'node:crypto';
import {ASR_FRAME_RULE, ASR_GROUP_RULE, asrProviderEvidenceMatches} from './asr-frame-boundary.mjs';
import {LOCAL_ASR_PROVIDER, hasLocalAsrProviderEvidence} from './local-asr-evidence.mjs';
import {hasPassedVisualReview} from './output-quality.mjs';

export const LEGACY_SOURCE_SCHEMA = 'wis-legacy-single-source-evidence-v1';
export const LEGACY_MODE = 'legacy_single_source';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const validSha = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const text = value => typeof value === 'string' && value.trim() === value && value.length > 0
  && value.length <= 256 && !/[\x00-\x1f]/u.test(value);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const absent = value => value === undefined || value === null;
const revoked = value => value?.revoked === true || !absent(value?.revokedAt) && value.revokedAt !== ''
  || value?.deliveryBlocked === true || value?.disabled === true;
const date = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const close = (a,b) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a-b) <= 1e-6;
const canonical = value => {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map(canonical);
  if (plain(value)) return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])]));
  throw new TypeError('Legacy evidence must contain finite JSON data only');
};
export const legacyEvidenceDigest = value => sha(JSON.stringify(canonical(value)));
const pick = (value, keys) => Object.fromEntries(keys.map(key=>[key,canonical(value?.[key])]));
const result = (issues, extra={}) => ({ready:issues.length===0,reason:issues[0]?.reason || null,issues,...extra});
const add = (issues,reason,field) => issues.push({reason,field});
const get = (collection,key) => collection instanceof Map ? collection.get(key)
  : plain(collection) && Object.hasOwn(collection,key) ? collection[key] : undefined;

// A legacy branch does not guess an edition. Even an unrecognised non-null
// edition assertion or revoked version binding must return to the exact-version
// path for resolution, rather than being laundered into "legacy".
export function hasLegacyVersionConflict(record) {
  return !absent(record?.skuVersion) || !absent(record?.productVersionEvidence)
    || !absent(record?.versionId) || !absent(record?.filingNumber)
    || !absent(record?.analysisAsrEvidence?.skuVersion)
    || !absent(record?.boundaryEvidence?.skuVersion)
    || !absent(record?.sourceSemanticReview?.sku?.skuVersion)
    || !absent(record?.semanticReviewProof?.sku?.skuVersion);
}

// Public-library pointers are a consistency hint, never authorization. The
// service must still resolve private historical admission and re-read every
// selected segment's CURRENT private review receipt before effects.
export function hasLegacySourcePointer(source) {
  const p=source?.legacySourceEvidence,scope=p?.sourceScope,a=source?.analysisAsrEvidence;
  return Boolean(source?.productCategory==='黑晶面膜' && source.skuVersion===null && !hasLegacyVersionConflict(source)
    && !revoked(source) && !['rejected','changes_requested'].includes(source.reviewStatus)
    && p?.mode===LEGACY_MODE && scope?.mode===LEGACY_MODE && scope.sourceId===source.id
    && validSha(scope.sourceSha256) && scope.sourceSha256===source.contentSha256
    && validSha(scope.revisionSha256) && p.bindingSha256===scope.revisionSha256 && validSha(p.profileSha256)
    && legacyEvidenceDigest(a?.sourceScope??null)===legacyEvidenceDigest(scope) && validAsrEvidence(a,source));
}

export function hasLegacyClipPointer(clip,source) {
  if(!hasLegacySourcePointer(source) || hasLegacyVersionConflict(clip) || revoked(clip)
    || clip?.reviewStatus!=='approved' || clip.skuVersion!==null || clip.productCategory!==source.productCategory) return false;
  const p=clip.legacySourceEvidence,s=source.legacySourceEvidence;
  const segment=source.speechSegments?.find(row=>row.id===clip.automaticAssessment?.boundaryIntegrity?.segmentId
    && hasTrustedLegacyAsrBoundary(row,source) && close(row.startSeconds,clip.startSeconds)
    && close(row.endSeconds,clip.endSeconds) && close(row.durationSeconds,clip.durationSeconds)
    && legacyEvidenceDigest(row.boundaryEvidence)===legacyEvidenceDigest(clip.boundaryEvidence));
  return Boolean(p?.mode===LEGACY_MODE && p.bindingSha256===s.bindingSha256 && p.profileSha256===s.profileSha256
    && legacyEvidenceDigest(p.sourceScope??null)===legacyEvidenceDigest(s.sourceScope)
    && validSha(clip.contentSha256) && p.clipSha256===clip.contentSha256
    && p.startSeconds===clip.startSeconds && p.endSeconds===clip.endSeconds && segment?.semanticReviewProof?.status==='passed'
    && validSha(segment.semanticReviewProof.proofSha256)
    && segment.semanticReviewProof.proofSha256===clip.semanticReviewProof?.proofSha256);
}

const SOURCE_KEYS = ['id','storedName','contentSha256','productCategory','skuVersion','durationSeconds',
  'visibility','createdById','createdByIds','reviewStatus','reviewedAt','deliveryBlocked','revoked','revokedAt',
  'disabled','versionId','filingNumber','analysisRuleVersion','analysisAsrEvidence','speechSegments','productVersionEvidence','sourceSemanticReview'];
const CLIP_KEYS = ['id','sourceId','storedName','contentSha256','productCategory','skuVersion','startSeconds',
  'endSeconds','durationSeconds','reviewStatus','reviewedAt','reviewNote','visibility','createdById','createdByIds',
  'deliveryBlocked','revoked','revokedAt','disabled','versionId','filingNumber','role','text','transcript','boundaryEvidence','productVersionEvidence','semanticReviewProof'];
export const legacySourceSnapshot = source => pick(source,SOURCE_KEYS);
export const legacyClipSnapshot = clip => pick(clip,CLIP_KEYS);

// The original ASR wording and context are preserved. No replacement transcript,
// arbitrary interval or edition label is introduced by this compatibility layer.
export function legacySourceContext(source) {
  if (!Array.isArray(source?.speechSegments)) return null;
  return source.speechSegments.map(segment=>pick(segment,['id','index','label','rawStartSeconds','rawEndSeconds',
    'startSeconds','endSeconds','durationSeconds','startFrame','endFrame','nativeFrameAligned',
    'semanticBoundaryTrusted','boundaryRule','boundaryType','technicalBoundaryReasons','boundaryEvidence']));
}

function validAsrEvidence(evidence, source) {
  return Boolean(evidence && evidence.sourceSha256===source?.contentSha256 && absent(evidence.skuVersion)
    && (absent(evidence.sourceId) || evidence.sourceId===source.id)
    && validSha(evidence.srtSha256) && validSha(evidence.frameMapSha256)
    && (evidence.provider===LOCAL_ASR_PROVIDER ? hasLocalAsrProviderEvidence(evidence)
      : absent(evidence.provider) && text(evidence.minuteToken)));
}

function validContext(source) {
  const rows=source?.speechSegments;
  if (!Array.isArray(rows) || rows.length===0 || rows.length>5000) return false;
  const ids=new Set();
  return rows.every((row,index)=>{
    if (!Number.isInteger(row?.index) || row.index<1 || ids.has(row.index)
      || typeof row.label!=='string' || !row.label.trim() || row.label.length>6000
      || !Number.isFinite(row.rawStartSeconds) || !Number.isFinite(row.rawEndSeconds)
      || row.rawStartSeconds<0 || row.rawEndSeconds<=row.rawStartSeconds
      || row.rawEndSeconds>source.durationSeconds+.001
      || index>0 && row.rawStartSeconds<rows[index-1].rawEndSeconds-1e-6) return false;
    ids.add(row.index); return true;
  });
}

// trustedReceipt MUST be read from a service-owned store whose historical
// approval, ASR bytes and current content-review receipts have been verified by
// the caller. A browser JSON body or a hash calculated from it is not authority.
// This function is deliberately pure: it proves consistency of those trusted
// inputs, not authorization to read them, a provider signature, or ad clearance.
// No company product_id / product_code / formal SKU catalog is required here.
export function validateLegacySourceEvidence({source,actualSourceSha256,trustedReceipt,expectedProduct='黑晶面膜'}={}) {
  const issues=[];
  if (!text(source?.id)) add(issues,'source_missing','source.id');
  if (!validSha(source?.contentSha256) || !validSha(actualSourceSha256)) add(issues,'source_evidence_missing','source.contentSha256');
  else if (source.contentSha256!==actualSourceSha256) add(issues,'source_binding_changed','source.contentSha256');
  if (expectedProduct!=='黑晶面膜' || source?.productCategory!==expectedProduct) add(issues,'source_scope_mismatch','source.productCategory');
  if (hasLegacyVersionConflict(source) || hasLegacyVersionConflict(trustedReceipt)) add(issues,'legacy_version_conflict','source.skuVersion');
  if (revoked(source) || revoked(trustedReceipt) || ['rejected','changes_requested'].includes(source?.reviewStatus))
    add(issues,'source_approval_revoked','source');
  if (!Number.isFinite(source?.durationSeconds) || source.durationSeconds<=0) add(issues,'source_evidence_missing','source.durationSeconds');
  if (source?.analysisRuleVersion!==ASR_FRAME_RULE || !validAsrEvidence(source?.analysisAsrEvidence,source))
    add(issues,'source_asr_missing','source.analysisAsrEvidence');
  if (!validContext(source)) add(issues,'source_context_missing','source.speechSegments');
  const receipt=trustedReceipt, historical=receipt?.historicalApproval, review=receipt?.contentReview;
  if (receipt?.schema!==LEGACY_SOURCE_SCHEMA || receipt?.mode!==LEGACY_MODE || receipt?.status!=='verified'
    || !text(receipt?.id) || !text(receipt?.verifiedBy) || !date(receipt?.verifiedAt) || !validSha(receipt?.receiptSha256))
    add(issues,'legacy_private_receipt_missing','trustedReceipt');
  if (receipt?.sourceId!==source?.id || receipt?.sourceSha256!==actualSourceSha256
    || !validSha(receipt?.sourceSha256) || receipt?.productCategory!==expectedProduct || receipt?.skuVersion!==null)
    add(issues,'source_binding_changed','trustedReceipt.source');
  if (historical?.status!=='approved' || !['source','clip','render-input'].includes(historical?.kind)
    || !text(historical?.recordId) || !validSha(historical?.receiptSha256) || !date(historical?.reviewedAt)
    || historical?.sourceId!==source?.id || historical?.sourceSha256!==actualSourceSha256 || revoked(historical))
    add(issues,'historical_approval_missing','trustedReceipt.historicalApproval');
  let asrSha=null, contextSha=null;
  try {
    asrSha=legacyEvidenceDigest(source?.analysisAsrEvidence);
    contextSha=legacyEvidenceDigest(legacySourceContext(source));
  } catch { add(issues,'legacy_evidence_invalid','source'); }
  if (!asrSha || receipt?.asrEvidenceSha256!==asrSha || !contextSha || receipt?.sourceContextSha256!==contextSha)
    add(issues,'source_binding_changed','trustedReceipt.asrAndContext');
  // Historical approval admits this source for reuse. This separate, current
  // review covers its unchanged actual speech/images, claim support and single
  // packaging consistency, without inventing which formal edition it is.
  if (review?.status!=='passed' || review?.purpose!=='legacy_source_content_review' || revoked(review)
    || !['receiptSha256','requestSha256','responseSha256','policySha256'].every(key=>validSha(review?.[key]))
    || !date(review?.reviewedAt) || review?.sourceId!==source?.id || review?.sourceSha256!==actualSourceSha256
    || review?.asrEvidenceSha256!==asrSha || review?.sourceContextSha256!==contextSha || review?.skuVersion!==null
    || review?.packagingConsistency!=='single_source_consistent' || review?.commercialClaimsSupported!==true
    || review?.originalContextReviewed!==true || !Array.isArray(review?.issues) || review.issues.length!==0
    || Date.parse(review?.reviewedAt)<Date.parse(historical?.reviewedAt)
    || Date.parse(receipt?.verifiedAt)<Date.parse(review?.reviewedAt))
    add(issues,'legacy_content_review_required','trustedReceipt.contentReview');
  if (issues.length) return result(issues,{kind:'legacy-source-validation',context:null,sourceSnapshot:null,receiptSha256:null});
  const snapshot=legacySourceSnapshot(source), receiptSnapshot=canonical(receipt), receiptSha256=legacyEvidenceDigest(receiptSnapshot);
  return result([],{kind:'legacy-source-validation',context:{mode:LEGACY_MODE,skuVersion:null,productCategory:expectedProduct,
    sourceId:source.id,sourceSha256:actualSourceSha256,receiptId:receipt.id,receiptSha256,
    asrEvidenceSha256:asrSha,sourceContextSha256:contextSha,contentReviewReceiptSha256:review.receiptSha256},
    sourceSnapshot:snapshot,receiptSnapshot,receiptSha256});
}

export function toLegacyContext(validation) {
  try {
    if (validation?.kind!=='legacy-source-validation' || validation.ready!==true
      || validation.context?.mode!==LEGACY_MODE || validation.context.skuVersion!==null
      || !validSha(validation.receiptSha256) || validation.context.receiptSha256!==validation.receiptSha256) return null;
    const checked=validateLegacySourceEvidence({source:validation.sourceSnapshot,
      actualSourceSha256:validation.context.sourceSha256,trustedReceipt:validation.receiptSnapshot,
      expectedProduct:validation.context.productCategory});
    return checked.ready && checked.receiptSha256===validation.receiptSha256
      && legacyEvidenceDigest(checked.context)===legacyEvidenceDigest(validation.context) ? canonical(checked.context) : null;
  } catch { return null; }
}

function groupMatches(segment) {
  const evidence=segment.boundaryEvidence;
  if (segment.boundaryType!=='asr_sentence_group')
    return segment.boundaryType==='asr_sentence' && !evidence?.groupRule && Array.isArray(evidence?.cueIds)
      && evidence.cueIds.length===1 && evidence.cueIds[0]===segment.index;
  const cues=evidence?.sourceCues;
  return evidence?.groupRule===ASR_GROUP_RULE && Array.isArray(cues) && cues.length>=2 && cues.length<=8
    && Array.isArray(evidence.cueIds) && evidence.cueIds.length===cues.length && evidence.cueIds[0]===segment.index
    && validSha(evidence.cueGroupsSha256) && evidence.sourceCuesSha256===sha(JSON.stringify(cues))
    && cues.every((cue,i)=>Number.isInteger(cue?.cueId) && cue.cueId>0 && cue.cueId===evidence.cueIds[i]
      && Number.isFinite(cue.start) && Number.isFinite(cue.end) && cue.end>cue.start
      && typeof cue.text==='string' && cue.text.length>0
      && (i===0 || cue.cueId===cues[i-1].cueId+1 && cue.start>=cues[i-1].end && cue.start-cues[i-1].end<=1.5))
    && cues[0].start===segment.rawStartSeconds && cues.at(-1).end===segment.rawEndSeconds
    && cues.map(cue=>cue.text).join(' ')===segment.label;
}

// Equivalent native-ASR binding with an explicitly null edition, not a fake
// SKU string temporarily inserted to pass the existing exact-version checker.
export function hasTrustedLegacyAsrBoundary(segment,source) {
  const e=segment?.boundaryEvidence,a=source?.analysisAsrEvidence;
  if (!segment || !source || hasLegacyVersionConflict(source) || hasLegacyVersionConflict(segment)) return false;
  return Boolean(source.analysisRuleVersion===ASR_FRAME_RULE && validAsrEvidence(a,source)
    && segment.boundaryRule===ASR_FRAME_RULE && segment.nativeFrameAligned===true && segment.semanticBoundaryTrusted===true
    && (!segment.technicalBoundaryReasons || Array.isArray(segment.technicalBoundaryReasons) && segment.technicalBoundaryReasons.length===0)
    && e?.sourceId===source.id && e.sourceSha256===source.contentSha256 && e.productCategory===source.productCategory
    && e.skuVersion===null && e.srtSha256===a.srtSha256 && e.frameMapSha256===a.frameMapSha256
    && asrProviderEvidenceMatches(e,a) && groupMatches(segment)
    && (!e.groupRule || e.cueGroupsSha256===a.cueGroupsSha256)
    && typeof segment.label==='string' && e.textSha256===sha(segment.label)
    && close(e.alignedStartSeconds,segment.startSeconds) && close(e.alignedEndSeconds,segment.endSeconds)
    && e.startFrame===segment.startFrame && e.endFrame===segment.endFrame
    && Number.isInteger(segment.startFrame) && Number.isInteger(segment.endFrame) && segment.startFrame>=0
    && segment.endFrame>segment.startFrame && segment.startSeconds>=0 && segment.endSeconds<=source.durationSeconds+.001
    && segment.startSeconds<=segment.rawStartSeconds+1e-8 && segment.endSeconds>=segment.rawEndSeconds-1e-8
    && segment.rawStartSeconds-segment.startSeconds<=.1+1e-8 && segment.endSeconds-segment.rawEndSeconds<=.1+1e-8
    && close(segment.durationSeconds,segment.endSeconds-segment.startSeconds)
    && segment.durationSeconds>=.8 && segment.durationSeconds<=20);
}

export function validateLegacyClipEvidence({clip,sourceValidation,actualClipSha256,expectedProduct='黑晶面膜'}={}) {
  const issues=[],context=toLegacyContext(sourceValidation),source=sourceValidation?.sourceSnapshot;
  if (!context || !source) add(issues,'legacy_private_receipt_missing','sourceValidation');
  if (!text(clip?.id) || !source || clip?.sourceId!==source.id) add(issues,'source_binding_changed','clip.sourceId');
  if (clip?.reviewStatus!=='approved' || revoked(clip)) add(issues,'source_approval_required','clip.reviewStatus');
  if (hasLegacyVersionConflict(clip)) add(issues,'legacy_version_conflict','clip.skuVersion');
  if (clip?.productCategory!==expectedProduct || context?.productCategory!==expectedProduct)
    add(issues,'source_scope_mismatch','clip.productCategory');
  if (!validSha(clip?.contentSha256) || !validSha(actualClipSha256)) add(issues,'clip_evidence_missing','clip.contentSha256');
  else if (clip.contentSha256!==actualClipSha256) add(issues,'clip_binding_changed','clip.contentSha256');
  let native=[];
  try {
    native=(source?.speechSegments || []).filter(segment=>hasTrustedLegacyAsrBoundary(segment,source)
      && close(segment.startSeconds,clip?.startSeconds) && close(segment.endSeconds,clip?.endSeconds)
      && close(segment.durationSeconds,clip?.durationSeconds)
      && legacyEvidenceDigest(segment.boundaryEvidence)===legacyEvidenceDigest(clip?.boundaryEvidence));
  } catch { add(issues,'legacy_evidence_invalid','clip.boundaryEvidence'); }
  if (native.length!==1) add(issues,'clip_boundary_mismatch','clip.boundaryEvidence');
  else if (['text','transcript'].some(key=>typeof clip[key]==='string' && clip[key].trim()
    && clip[key]!==native[0].label)) add(issues,'clip_transcript_changed','clip.transcript');
  if (issues.length) return result(issues,{kind:'legacy-clip-validation',skuVersion:null,snapshot:null});
  return result([],{kind:'legacy-clip-validation',skuVersion:null,
    snapshot:{mode:LEGACY_MODE,source:canonical(source),clip:legacyClipSnapshot(clip),context}});
}

export function validateLegacyCompositionEvidence({clips,sourceValidations,actualClipSha256ById,expectedProduct='黑晶面膜'}={}) {
  const issues=[],snapshots=[],sources=new Set(),ids=new Set();
  if (!Array.isArray(clips) || !clips.length) return result([{reason:'clip_evidence_missing',field:'clips'}],
    {kind:'legacy-composition-validation',mode:LEGACY_MODE,skuVersion:null,sourceId:null,snapshotSha256:null,snapshots:[]});
  for (const [index,clip] of clips.entries()) {
    if (ids.has(clip?.id)) add(issues,'duplicate_clip',`clips.${index}.id`);
    ids.add(clip?.id); sources.add(clip?.sourceId);
    const checked=validateLegacyClipEvidence({clip,sourceValidation:get(sourceValidations,clip?.sourceId),
      actualClipSha256:get(actualClipSha256ById,clip?.id),expectedProduct});
    issues.push(...checked.issues.map(issue=>({...issue,index,clipId:clip?.id || null})));
    if (checked.ready) snapshots.push(checked.snapshot);
  }
  if (sources.size!==1) add(issues,'legacy_multiple_sources','composition.sourceId');
  return result(issues,{kind:'legacy-composition-validation',mode:LEGACY_MODE,skuVersion:null,
    sourceId:issues.length?null:[...sources][0],snapshotSha256:issues.length?null:legacyEvidenceDigest(snapshots),
    snapshots:issues.length?[]:snapshots});
}

// Call only after independent CURRENT output review and private receipt readback.
// A historical source approval or a prior output's passed badge cannot satisfy
// this contract. The existing visual-review result is retained, not replaced.
export function validateLegacyOutputReview({output,actualOutputSha256,compositionValidation,trustedReview}={}) {
  const issues=[],composition=compositionValidation,review=trustedReview;
  if (!text(output?.id) || !validSha(output?.contentSha256) || !validSha(actualOutputSha256)
    || actualOutputSha256!==output.contentSha256) add(issues,'output_binding_changed','output');
  if (composition?.kind!=='legacy-composition-validation' || composition?.ready!==true
    || composition.mode!==LEGACY_MODE || composition.skuVersion!==null || !text(composition.sourceId)
    || !Array.isArray(composition.snapshots) || !composition.snapshots.length
    || !validSha(composition.snapshotSha256) || legacyEvidenceDigest(composition.snapshots)!==composition.snapshotSha256)
    add(issues,'legacy_composition_missing','compositionValidation');
  if (review?.purpose!=='current_output_content_review' || review?.mode!==LEGACY_MODE || review?.skuVersion!==null
    || review?.outputId!==output?.id || review?.outputSha256!==actualOutputSha256
    || review?.compositionSha256!==composition?.snapshotSha256 || review?.sourceId!==composition?.sourceId
    || review?.packagingConsistency!=='single_source_consistent' || review?.commercialClaimsSupported!==true
    || review?.originalContextReviewed!==true || !date(review?.reviewedAt) || revoked(review)
    || !['receiptSha256','requestSha256','responseSha256','policySha256'].every(key=>validSha(review?.[key]))
    || !hasPassedVisualReview({visualReview:review?.visualReview},actualOutputSha256))
    add(issues,'current_output_review_required','trustedReview');
  return result(issues,{mode:LEGACY_MODE,skuVersion:null,review:issues.length?null:canonical(review)});
}
