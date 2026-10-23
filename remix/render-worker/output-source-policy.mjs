// This is a protocol discriminator, never a source or output approval.
// Historical records retain all original permission/review/file/platform gates.
import {HISTORICAL_OUTPUT_RULES_POLICY,historicalRulesOutputContract} from './historical-output-rules.mjs';
export const SOURCE_EVIDENCE_POLICY = 'wis-private-source-evidence-v1';
const PRIVATE_FIELDS = ['productVersionEvidence','sourceSemanticReview','semanticReviewProof','legacySourceEvidence'];
const own = (value,key) => Boolean(value && Object.hasOwn(value,key));
const unavailable = value => value && (value.revoked===true || Boolean(value.revokedAt)
  || value.disabled===true || value.deliveryBlocked===true
  || ['rejected','changes_requested'].includes(value.reviewStatus));
const denied = reason => Object.assign(new Error(`成片来源协议或审核状态不可用（${reason}），未继续回传或投放。`),
  {code:'SOURCE_EVIDENCE_MISSING',statusCode:409});

export function outputSourcePolicy(render,variant,library) {
  const markers=[render,variant].map(value=>[own(value,'sourceEvidencePolicy'),value?.sourceEvidencePolicy]);
  const marked=markers.some(([present])=>present);
  const managed=Boolean(render?.automation && render.productCategory==='黑晶面膜');
  if(markers.some(([present,value])=>present&&value===HISTORICAL_OUTPUT_RULES_POLICY)){
    if(markers.some(([present,value])=>present&&value!==HISTORICAL_OUTPUT_RULES_POLICY)
      ||!historicalRulesOutputContract(render,variant,library))throw denied('historical_inventory_rules_invalid');
    return {mode:'historical_inventory',clips:variant.clipSequence.map(id=>library.clips.find(clip=>clip.id===id)),markerState:JSON.stringify(markers)};
  }
  if(variant?.reviewMode==='automatic_rules'||own(variant,'historicalInventoryReview'))throw denied('historical_inventory_policy_missing');
  if (marked && (markers.some(([present,value])=>present && value!==SOURCE_EVIDENCE_POLICY) || !managed))
    throw denied('unknown_source_evidence_policy');
  if (!managed) return {mode:'original'};
  const ids=[...new Set([
    ...(Array.isArray(variant?.clipSequence)?variant.clipSequence:[]),
    ...Object.values(variant?.slotMapping || {}),
  ])];
  const clips=ids.map(id=>library.clips.find(clip=>clip.id===id));
  const sources=clips.map(clip=>library.sources.find(source=>source.id===clip?.sourceId));
  const records=[render,variant,...clips,...sources];
  if (records.some(unavailable)) throw denied('source_or_output_revoked');
  // Only output-owned evidence determines its protocol generation. Preparing
  // the live source later cannot retroactively approve OR upgrade old output.
  // Explicit source/clip withdrawal above still applies to every generation.
  // Presence matters even for partial/null output evidence.
  const upgraded=[render,variant].some(record=>PRIVATE_FIELDS.some(key=>own(record,key)));
  if (!marked && !upgraded) return {mode:'original'};
  if (!Array.isArray(variant?.clipSequence) || !variant.clipSequence.length || !clips.length
    || clips.some(clip=>!clip) || sources.some(source=>!source || source.productCategory!=='黑晶面膜'))
    throw denied('source_evidence_missing');
  return {mode:'strict',clips,markerState:JSON.stringify(markers)};
}
