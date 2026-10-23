import {createHash} from 'node:crypto';

// These identifiers distinguish business versions. They do not approve any
// source, marketing claim, reference image, company product_id, or ad channel.
export const BLACK_MASK_VERSIONS = Object.freeze([
  Object.freeze({versionId:'black-original',skuVersion:'粤G妆网备字2025141398',filingNumber:'粤G妆网备字2025141398',productCategory:'黑晶面膜',documentId:'QcQYdKbK5oOmEgx9ojEcQokbnDb'}),
  Object.freeze({versionId:'black-2',skuVersion:'粤G妆网备字2026050125',filingNumber:'粤G妆网备字2026050125',productCategory:'黑晶面膜',documentId:'MKJTdfof5o0vd4xG4STcnntln5d'}),
]);
export const SOURCE_VERSION_SCHEMA = 'wis-source-version-binding-v1';
export const CLIP_VERSION_SCHEMA = 'wis-clip-version-binding-v1';
export const PRODUCT_VERSION_SOURCE_SNAPSHOT_FIELDS = Object.freeze(['id','storedName','contentSha256','skuVersion','productCategory','productVersionEvidence','sourceSemanticReview','speechSegments','sourceReviewProof']);
export const PRODUCT_VERSION_CLIP_SNAPSHOT_FIELDS = Object.freeze(['id','sourceId','storedName','contentSha256','skuVersion','productCategory','startSeconds','endSeconds','durationSeconds','productVersionEvidence','boundaryEvidence','semanticReviewProof','sourceReviewProof']);

const validSha = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const validText = value => typeof value === 'string' && value.length > 0 && value.length <= 256 && value.trim() === value && !/[\x00-\x1f]/u.test(value);
const plainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const canonical = value => {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map(canonical);
  if (plainObject(value)) return Object.fromEntries(Object.keys(value).sort().map(key => [key,canonical(value[key])]));
  throw new TypeError('Product version evidence must contain finite JSON data only');
};
export const productVersionDigest = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const copy = value => canonical(value);
const outcome = (issues, extra={}) => ({ready:issues.length===0,reason:issues[0]?.reason || null,issues,...extra});
const add = (issues,reason,field) => issues.push({reason,field});
const revoked = value => value?.revoked === true || (value?.revokedAt !== undefined && value.revokedAt !== null && value.revokedAt !== '');

// No fuzzy matching, title inference, trimming, or product-category fallback.
export function resolveExactVersion(value) {
  return typeof value === 'string' ? BLACK_MASK_VERSIONS.find(version => version.skuVersion === value || version.versionId === value) || null : null;
}

export function validateExactVersion(value,{expectedVersion}={}) {
  const version=resolveExactVersion(value), expected=expectedVersion===undefined ? null : resolveExactVersion(expectedVersion), issues=[];
  if (!version) add(issues,'product_version_unknown','skuVersion');
  if (expectedVersion!==undefined && !expected) add(issues,'product_version_unknown','expectedVersion');
  if (version && expected && version.skuVersion!==expected.skuVersion) add(issues,'product_version_mismatch','skuVersion');
  return outcome(issues,{version});
}

// currentReference and referenceImages must come from the service-owned current
// catalog. This pure function does not fetch files or bless user-uploaded data.
// snapshotSha256 is the hash of the actual archived formal reference snapshot;
// it is not a hash of a title or an invented SKU description.
export function validateProductReferenceContext({currentReference,referenceImages,referenceImageIds,expectedVersion}={}) {
  const issues=[], version=resolveExactVersion(currentReference?.skuVersion);
  if (!version || currentReference?.skuVersion!==version.skuVersion) add(issues,'product_version_unknown','currentReference.skuVersion');
  if (expectedVersion!==undefined) issues.push(...validateExactVersion(currentReference?.skuVersion,{expectedVersion}).issues);
  if (version && currentReference?.documentId!==version.documentId) add(issues,'formal_reference_mismatch','currentReference.documentId');
  if (!Number.isSafeInteger(currentReference?.documentRevision) || currentReference.documentRevision<1) add(issues,'formal_reference_missing','currentReference.documentRevision');
  if (!validSha(currentReference?.snapshotSha256)) add(issues,'formal_reference_missing','currentReference.snapshotSha256');
  if (!plainObject(currentReference?.profileFacts) || Object.keys(currentReference.profileFacts).length===0) add(issues,'formal_reference_missing','currentReference.profileFacts');
  if (currentReference?.profileFacts?.filingNumber!==undefined && currentReference.profileFacts.filingNumber!==version?.filingNumber)
    add(issues,'formal_reference_mismatch','currentReference.profileFacts.filingNumber');
  if (revoked(currentReference)) add(issues,'formal_reference_revoked','currentReference');
  try { copy(currentReference?.profileFacts); } catch { add(issues,'formal_reference_invalid','currentReference.profileFacts'); }
  if (!Array.isArray(referenceImages)) add(issues,'reference_image_missing','referenceImages');
  if (!Array.isArray(referenceImageIds) || !referenceImageIds.length || referenceImageIds.some(id=>!validText(id))
    || new Set(referenceImageIds).size!==referenceImageIds.length) add(issues,'reference_image_missing','referenceImageIds');
  const images=[];
  for (const id of Array.isArray(referenceImageIds)?referenceImageIds:[]) {
    if (!validText(id)) continue;
    const matches=(Array.isArray(referenceImages)?referenceImages:[]).filter(image=>image?.id===id);
    if (matches.length!==1) { add(issues,'reference_image_missing',`referenceImages.${id}`); continue; }
    const image=matches[0];
    if (!version || image.skuVersion!==version.skuVersion) add(issues,'reference_image_version_mismatch',`referenceImages.${id}.skuVersion`);
    if (image.reviewStatus!=='approved' || revoked(image)) add(issues,'reference_image_unverified',`referenceImages.${id}.reviewStatus`);
    if (!validSha(image.sha256) || !validText(image.filePath)) add(issues,'reference_image_missing',`referenceImages.${id}.file`);
    images.push({id:image.id,sha256:image.sha256,skuVersion:image.skuVersion,filePath:image.filePath});
  }
  if (issues.length) return outcome(issues,{version,context:null});
  images.sort((left,right)=>left.id<right.id?-1:left.id>right.id?1:0);
  const profile={schema:'wis-formal-product-reference-v1',skuVersion:version.skuVersion,
    documentId:currentReference.documentId,documentRevision:currentReference.documentRevision,
    snapshotSha256:currentReference.snapshotSha256,profileFacts:copy(currentReference.profileFacts)};
  const referenceSet=images.map(({id,sha256,skuVersion})=>({id,sha256,skuVersion}));
  return outcome([],{version,context:{productCategory:version.productCategory,skuVersion:version.skuVersion,filingNumber:version.filingNumber,
    profileSha256:productVersionDigest(profile),referenceSetSha256:productVersionDigest(referenceSet),
    profileFacts:profile.profileFacts,referenceImages:images,formalReference:profile}});
}

const bindingSnapshot = binding => copy({schema:binding.schema,id:binding.id,status:binding.status,
  sourceId:binding.sourceId,sourceSha256:binding.sourceSha256,skuVersion:binding.skuVersion,
  productCategory:binding.productCategory,profileSha256:binding.profileSha256,referenceSetSha256:binding.referenceSetSha256,
  referenceImageIds:[...binding.referenceImageIds].sort(),reviewReceiptSha256:binding.reviewReceiptSha256,
  verifiedBy:binding.verifiedBy,verifiedAt:binding.verifiedAt,revoked:binding.revoked===true,revokedAt:binding.revokedAt || null});

// trustedBinding is a private, independently verified source-to-version record.
// Neither the fact that both editions sell nor a source.skuVersion assertion
// creates it. Caller must verify its receipt and actual reference bytes, enforce
// authorization, and CAS the resulting snapshot before any business write.
export function validateSourceVersionEvidence({source,actualSourceSha256,trustedBinding,currentReference,referenceImages,expectedVersion}={}) {
  const reference=validateProductReferenceContext({currentReference,referenceImages,referenceImageIds:trustedBinding?.referenceImageIds,expectedVersion});
  const issues=[...reference.issues], context=reference.context;
  if (!validText(source?.id)) add(issues,'source_missing','source.id');
  if (!validSha(source?.contentSha256) || !validSha(actualSourceSha256)) add(issues,'source_evidence_missing','source.contentSha256');
  else if (source.contentSha256!==actualSourceSha256) add(issues,'source_binding_changed','source.contentSha256');
  if (!resolveExactVersion(source?.skuVersion) || source?.skuVersion!==reference.version?.skuVersion) add(issues,'product_version_mismatch','source.skuVersion');
  if (source?.productCategory!=='黑晶面膜') add(issues,'product_version_mismatch','source.productCategory');
  if (!trustedBinding || trustedBinding.schema!==SOURCE_VERSION_SCHEMA || !validText(trustedBinding.id)
    || trustedBinding.status!=='verified' || !validText(trustedBinding.verifiedBy)
    || typeof trustedBinding.verifiedAt!=='string' || !Number.isFinite(Date.parse(trustedBinding.verifiedAt))
    || !validSha(trustedBinding.reviewReceiptSha256)) add(issues,'source_version_binding_missing','trustedBinding');
  if (revoked(trustedBinding)) add(issues,'source_version_binding_revoked','trustedBinding');
  if (trustedBinding?.sourceId!==source?.id || trustedBinding?.sourceSha256!==actualSourceSha256
    || !validSha(trustedBinding?.sourceSha256)) add(issues,'source_binding_changed','trustedBinding.source');
  if (!context || trustedBinding?.skuVersion!==context.skuVersion || trustedBinding?.productCategory!==context.productCategory)
    add(issues,'product_version_mismatch','trustedBinding.skuVersion');
  if (!context || trustedBinding?.profileSha256!==context.profileSha256) add(issues,'formal_reference_changed','trustedBinding.profileSha256');
  if (!context || trustedBinding?.referenceSetSha256!==context.referenceSetSha256) add(issues,'reference_image_changed','trustedBinding.referenceSetSha256');
  if (issues.length) return outcome(issues,{kind:'source-product-version-validation',context:null,sourceSnapshot:null,bindingSha256:null});
  const binding=bindingSnapshot(trustedBinding), bindingSha256=productVersionDigest(binding);
  // An optional persisted pointer cannot override the trusted private record.
  if (source.productVersionEvidence!==undefined && (source.productVersionEvidence?.bindingId!==binding.id
    || source.productVersionEvidence?.bindingSha256!==bindingSha256)) {
    return outcome([{reason:'source_binding_changed',field:'source.productVersionEvidence'}],{kind:'source-product-version-validation',context:null,sourceSnapshot:null,bindingSha256:null});
  }
  return outcome([],{kind:'source-product-version-validation',context:{...context,bindingSha256},bindingSha256,
    sourceSnapshot:copy({...Object.fromEntries(PRODUCT_VERSION_SOURCE_SNAPSHOT_FIELDS.map(key=>[key,source[key]])),
      id:source.id,storedName:source.storedName,contentSha256:actualSourceSha256,
      skuVersion:context.skuVersion,productCategory:context.productCategory,productVersionEvidence:{bindingId:binding.id,bindingSha256}})});
}

export function toSkuContext(validationResult) {
  if (validationResult?.kind!=='source-product-version-validation' || validationResult.ready!==true
    || !validSha(validationResult.context?.bindingSha256)) return null;
  return copy(validationResult.context);
}

export function validateClipVersionEvidence({clip,sourceValidation,actualClipSha256,expectedVersion}={}) {
  const issues=[], context=toSkuContext(sourceValidation), source=sourceValidation?.sourceSnapshot;
  if (!context || !source) add(issues,'source_version_binding_missing','sourceValidation');
  if (!validText(clip?.id) || !source || clip?.sourceId!==source.id) add(issues,'source_binding_changed','clip.sourceId');
  if (!validSha(actualClipSha256) || !validSha(clip?.contentSha256)) add(issues,'clip_evidence_missing','clip.contentSha256');
  else if (clip.contentSha256!==actualClipSha256) add(issues,'clip_binding_changed','clip.contentSha256');
  const evidence=clip?.productVersionEvidence;
  if (!evidence || evidence.schema!==CLIP_VERSION_SCHEMA) add(issues,'clip_version_binding_missing','clip.productVersionEvidence');
  if (!context || evidence?.skuVersion!==context.skuVersion || clip?.productCategory!==context.productCategory
    || (clip?.skuVersion!==undefined && clip.skuVersion!==context.skuVersion)) add(issues,'product_version_mismatch','clip.skuVersion');
  if (expectedVersion!==undefined) issues.push(...validateExactVersion(evidence?.skuVersion,{expectedVersion}).issues);
  if (!source || evidence?.sourceId!==source.id || evidence?.sourceSha256!==source.contentSha256
    || !context || evidence?.bindingSha256!==context.bindingSha256) add(issues,'source_binding_changed','clip.productVersionEvidence.source');
  if (!validSha(evidence?.clipSha256) || evidence.clipSha256!==actualClipSha256) add(issues,'clip_binding_changed','clip.productVersionEvidence.clipSha256');
  if (!context || evidence?.profileSha256!==context.profileSha256) add(issues,'formal_reference_changed','clip.productVersionEvidence.profileSha256');
  if (!context || evidence?.referenceSetSha256!==context.referenceSetSha256) add(issues,'reference_image_changed','clip.productVersionEvidence.referenceSetSha256');
  if (![clip?.startSeconds,clip?.endSeconds,clip?.durationSeconds].every(Number.isFinite)
    || clip.startSeconds<0 || clip.endSeconds<=clip.startSeconds || Math.abs(clip.endSeconds-clip.startSeconds-clip.durationSeconds)>.02
    || evidence?.startSeconds!==clip.startSeconds || evidence?.endSeconds!==clip.endSeconds) add(issues,'clip_binding_changed','clip.range');
  if (!source || clip?.boundaryEvidence?.sourceId!==source.id || clip?.boundaryEvidence?.sourceSha256!==source.contentSha256
    || !context || clip?.boundaryEvidence?.skuVersion!==context.skuVersion) add(issues,'product_version_mismatch','clip.boundaryEvidence');
  return outcome(issues,{kind:'clip-product-version-validation',skuVersion:context?.skuVersion || null,
    snapshot:issues.length?null:productVersionSnapshot({source,clip,skuContext:context})});
}

// These snapshots are additions to, not replacements for, ASR, semantic-review,
// permissions, composition, output-review, or delivery-gate snapshots.
export function productVersionSnapshot({source,clip,skuContext}={}) {
  const pick=(value,keys)=>value?Object.fromEntries(keys.map(key=>[key,copy(value[key])])):null;
  return copy({schema:'wis-product-version-snapshot-v1',source:pick(source,PRODUCT_VERSION_SOURCE_SNAPSHOT_FIELDS),
    clip:pick(clip,PRODUCT_VERSION_CLIP_SNAPSHOT_FIELDS),context:skuContext?{
      productCategory:skuContext.productCategory,skuVersion:skuContext.skuVersion,filingNumber:skuContext.filingNumber,
      bindingSha256:skuContext.bindingSha256,profileSha256:skuContext.profileSha256,referenceSetSha256:skuContext.referenceSetSha256,
      profileFacts:skuContext.profileFacts,formalReference:skuContext.formalReference,
      referenceImages:(skuContext.referenceImages || []).map(({id,sha256,skuVersion})=>({id,sha256,skuVersion}))}:null});
}

export function validateCompositionVersionEvidence({clips,sourceValidations,actualClipSha256ById,expectedVersion}={}) {
  const issues=[], versions=new Set(), snapshots=[];
  const get=(collection,key)=>collection instanceof Map?collection.get(key):plainObject(collection)?Object.hasOwn(collection,key)?collection[key]:undefined:undefined;
  if (!Array.isArray(clips) || !clips.length) return outcome([{reason:'clip_evidence_missing',field:'clips'}],{skuVersion:null,snapshotSha256:null});
  const ids=new Set();
  for (const [index,clip] of clips.entries()) {
    if (ids.has(clip?.id)) add(issues,'duplicate_clip',`clips.${index}.id`);
    ids.add(clip?.id);
    const result=validateClipVersionEvidence({clip,sourceValidation:get(sourceValidations,clip?.sourceId),
      actualClipSha256:get(actualClipSha256ById,clip?.id),expectedVersion});
    issues.push(...result.issues.map(issue=>({...issue,clipId:clip?.id || null,index})));
    if (result.ready) { versions.add(result.skuVersion); snapshots.push(result.snapshot); }
  }
  if (versions.size>1) add(issues,'mixed_product_versions','composition.skuVersion');
  return outcome(issues,{skuVersion:issues.length?null:[...versions][0],
    snapshotSha256:issues.length?null:productVersionDigest(snapshots),snapshots:issues.length?[]:snapshots});
}
