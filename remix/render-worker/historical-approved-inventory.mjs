// Pure compatibility policy. No filesystem/network/model calls and no writers.
// A historical approval stays a historical approval, not new ASR/visual proof.
// The factory consumes server-owned, byte-pinned readback, never HTTP payload.
import {createHash} from 'node:crypto';
import {recordedSourceCategory} from './source-media-fallback.mjs';
import {companyClipExcludedForExistingOutput} from './company-reject-recovery.mjs';
export const HISTORICAL_INVENTORY_MODE='historical_approved_inventory_v1';
export const HISTORICAL_INVENTORY_JOB='a5fdb74d-a2a1-4cf0-affe-d9bbfaf30354';
export const HISTORICAL_REFERENCE_SHA256='bb88ed3f1a7c9b4b78b6f2a1e1661b44cf1b1f25754fc4d8ed56e79377427590';
export const HISTORICAL_EXPANDED_REFERENCE_SHA256='ed02c888caab764e29f143386402887ae7a2da5335e58e56f9eb866e0d3cbf33';
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const canonical=value=>value===undefined?null:Array.isArray(value)?value.map(canonical):value&&typeof value==='object'
  ?Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])])):value;
export const historicalSnapshotDigest=value=>digest(JSON.stringify(canonical(value)));
const sha=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const stamp=value=>typeof value==='string'&&Number.isFinite(Date.parse(value));
const failure=reason=>({eligible:false,candidate:false,currentMediaVerified:false,reason,mode:HISTORICAL_INVENTORY_MODE,approvalGranted:false});
const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
const denied=value=>Boolean(value&&(value.revoked===true||value.revokedAt||value.disabled===true||value.deliveryBlocked===true
  ||value.deleted===true||value.isDeleted===true||value.deletedAt||['rejected','changes_requested','revoked','disabled','deleted'].includes(value.reviewStatus)
  ||['revoked','disabled','deleted'].includes(value.status)));
const version=value=>value==null||value===''?null:typeof value==='string'&&value.trim()===value&&value.length<=160
  &&!/unknown|未确认|待确认|待核验|^(?:null|none|undefined)$/iu.test(value)?value:false;
const approvedCategory=value=>['黑晶面膜','通用切片'].includes(value);
// Only recorded categories, never file-name inference or a metadata write.
export function historicalCategoryEvidence(clip,source){
  const recorded=recordedSourceCategory(source),sourceCategory=recorded==='通用'?'通用切片':recorded;
  const missing=clip?.productCategory==null;
  const effectiveClipCategory=missing?sourceCategory:clip.productCategory;
  return {valid:approvedCategory(effectiveClipCategory)&&(!recorded||approvedCategory(sourceCategory)),
    recordedSourceCategory:recorded||null,sourceCategoryKnown:Boolean(recorded),effectiveClipCategory:effectiveClipCategory||null,
    basis:missing?'recorded_source_category_fallback':recorded?'recorded_source_and_approved_clip':'historically_approved_clip_only',
    sourceMetadataChanged:false};
}
const isExcluded=(job,clip,excludeClip,existingOutputContext)=>{
  try{return (job?.reviewPolicy!=='automatic_remix_basic_v1'&&companyClipExcludedForExistingOutput(job,clip,existingOutputContext))||typeof excludeClip==='function'&&excludeClip(job,clip)!==false;}
  catch{return true;}
};
const safeName=value=>typeof value==='string'&&value.length>0&&value.length<256&&!/[\\/\x00-\x1f]/u.test(value)&&value!=='.'&&value!=='..';

// Exact projection used by the actual root readback. Missing historical SHA
// remains null; a newly measured hash is NEVER written into this projection.
export function historicalApprovalProjection(clip,source){return {
  id:clip.id,sourceId:clip.sourceId,name:clip.name,role:clip.role,reviewStatus:clip.reviewStatus,reviewedAt:clip.reviewedAt,
  reviewNote:clip.reviewNote,reviewedById:clip.reviewedById||null,contentSha256:clip.contentSha256||null,
  sourceContentSha256:source?.contentSha256||null,storedName:clip.storedName,sourceStoredName:source?.storedName,
  startSeconds:clip.startSeconds,endSeconds:clip.endSeconds,durationSeconds:clip.durationSeconds,
  productCategory:clip.productCategory,sourceProductCategory:source?.productCategory,skuVersion:source?.skuVersion||null,
  visibility:clip.visibility||null,sourceVisibility:source?.visibility||null,text:clip.text||clip.transcript||null,
  sourceAssetId:source?.materialCenterAssetId||null,deliveryBlocked:clip.deliveryBlocked||source?.deliveryBlocked||false,
  legacyPointer:Boolean(clip.legacySourceEvidence),sourceSemanticProof:Boolean(clip.semanticReviewProof),
};}
function approvalComparable(row){
  // Later current source hashes or explicit SKU metadata are not an edit of an
  // old clip approval. They are separately bound into the new reuse snapshot.
  // Existing non-null historic values still require exact matching below.
  // JSON omits undefined fields: compare the fixed recorded projection so an
  // absent category remains equivalent to null, not a fabricated new value.
  return Object.fromEntries(Object.keys(historicalApprovalProjection({},{}))
    .filter(key=>!['sourceContentSha256','skuVersion'].includes(key)).map(key=>[key,row[key]??null]));
}
function sourceScopeSnapshot(source){return canonical(Object.fromEntries([
  'id','storedName','contentSha256','productCategory','materialCenterCategory','materialCenterAssetId','materialCenterObjectKey','createdById','createdByIds',
  'visibility','skuVersion','productVersionEvidence','revoked','revokedAt','disabled','deliveryBlocked','reviewStatus','deleted','isDeleted','deletedAt',
].map(k=>[k,source[k]])));}
function clipCurrentSnapshot(clip){return canonical(Object.fromEntries([
  'id','sourceId','storedName','contentSha256','size','startSeconds','endSeconds','durationSeconds','role','productCategory','visibility','createdById','createdByIds',
  'reviewStatus','reviewedAt','reviewedBy','reviewedById','reviewNote','approvalSource','automaticAssessment','semanticReviewProof',
  'boundaryEvidence','legacySourceEvidence','skuVersion','productVersionEvidence','revoked','revokedAt','disabled','deliveryBlocked','deleted','isDeleted','deletedAt','text','transcript','tags',
].map(k=>[k,clip[k]])));}
function historicalIntegerGridNoteSuperseded(clip){
  const assessment=clip.automaticAssessment;
  if(clip.approvalSource!=='material_center_effective'||clip.reviewStatus!=='approved'
    ||assessment?.status!=='review_required'||assessment.mode!=='rules'||assessment.contentApprovalInherited!==true
    ||!(assessment.boundaryIntegrity?.status==='passed'||assessment.boundaryIntegrity?.status==='review_required'
      &&assessment.boundaryIntegrity.gridRule==='integer-second'&&assessment.boundaryIntegrity.gridPassed===false)
    ||!Array.isArray(assessment.checks)||!assessment.checks.length)return false;
  const failed=assessment.checks.filter(check=>check?.passed!==true);
  // Preserve the old review-required object. Its explicit inherited content
  // approval can coexist with this grid note, even when assessed after approval;
  // no content/ASR/model failure is forgiven.
  return failed.length===1&&failed[0].name==='整数秒切点'&&failed[0].passed===false
    &&Array.isArray(assessment.reasons)&&assessment.reasons.length===1
    &&assessment.reasons[0]===`${failed[0].name}：${failed[0].detail}`;
}
function unresolvedCurrentReview(clip){
  // This does not reinterpret prior failures or pending model requests.
  if(clip.automaticAssessment&&['failed','review_required','unknown','pending','sending'].includes(clip.automaticAssessment.status)
    &&!historicalIntegerGridNoteSuperseded(clip))return true;
  const proof=clip.semanticReviewProof;if(proof&&proof.status!=='passed')return true;
  return false;
}

function historicalApprovedClipCandidate({baseline,clip,source,job,identity,canReadSource,canReadClip,excludeClip},{existingOutputContext}={}){
  if(job?.id!==HISTORICAL_INVENTORY_JOB||job.createdById!=='FD-026222'||identity?.id!==job.createdById
    ||job.productCategory!=='黑晶面膜'||job.targetDurationSeconds!==90||job.dailyTarget!==2
    ||!['active','paused'].includes(job.status)||job.archivedAt||denied(job))return failure('job_or_identity_scope');
  if(!baseline||baseline.reviewStatus!=='approved'||!stamp(baseline.reviewedAt)||!clip||!source
    ||baseline.id!==clip.id||baseline.sourceId!==source.id||clip.sourceId!==source.id)return failure('historical_approval_missing');
  if(clip.reviewStatus!=='approved'||denied(clip)||denied(source)||unresolvedCurrentReview(clip))return failure('current_approval_unavailable');
  if(isExcluded(job,clip,excludeClip,existingOutputContext))return failure('company_job_clip_excluded');
  // R17 admits only an explicitly recorded clip category. The captured 36
  // missing-category records stay immutable evidence, not planning/effect
  // candidates; source-category fallback is diagnostic only in this release.
  if(clip.productCategory==null)return failure('recorded_clip_category_missing');
  const categoryEvidence=historicalCategoryEvidence(clip,source);
  if(!categoryEvidence.valid)return failure('product_scope');
  // Shared output cannot borrow another owner's private inventory, even if an
  // administrator may read it. Normal ACL functions are injected from core.
  if(clip.visibility==='private'||source.visibility==='private'||typeof canReadSource!=='function'||typeof canReadClip!=='function'
    ||canReadSource(source,identity)!==true||canReadClip(clip,source,identity)!==true)return failure('current_permission_unavailable');
  const projection=historicalApprovalProjection(clip,source);
  if(historicalSnapshotDigest(approvalComparable(projection))!==historicalSnapshotDigest(approvalComparable(baseline)))return failure('historical_approval_changed');
  if(baseline.sourceContentSha256&&source.contentSha256!==baseline.sourceContentSha256)return failure('historical_source_hash_changed');
  const declaredVersions=[source.skuVersion,clip.skuVersion,source.productVersionEvidence?.skuVersion,clip.productVersionEvidence?.skuVersion,
    source.analysisAsrEvidence?.skuVersion,clip.boundaryEvidence?.skuVersion,clip.semanticReviewProof?.sku?.skuVersion].map(version);
  const knownVersions=new Set(declaredVersions.filter(Boolean));
  if(declaredVersions.includes(false)||knownVersions.size>1||baseline.skuVersion&&!knownVersions.has(baseline.skuVersion)
    ||denied(source.productVersionEvidence)||denied(clip.productVersionEvidence))return failure('explicit_version_conflict');
  if(!safeName(clip.storedName)||!safeName(source.storedName)||![clip.startSeconds,clip.endSeconds,clip.durationSeconds].every(Number.isFinite)
    ||clip.startSeconds<0||clip.endSeconds<=clip.startSeconds||clip.durationSeconds<=0
    ||Math.abs(clip.endSeconds-clip.startSeconds-clip.durationSeconds)>.02)return failure('media_identity_or_range_invalid');
  if(source.contentSha256!=null&&source.contentSha256!==''&&!sha(source.contentSha256))return failure('current_source_hash_invalid');
  const skuVersion=[...knownVersions][0]||null;
  // Preserve R16 snapshot bytes for previously admitted clips; `valid` is a
  // helper verdict, not an extra historical approval field.
  delete categoryEvidence.valid;
  const candidateSnapshot={mode:HISTORICAL_INVENTORY_MODE,jobId:job.id,ownerId:job.createdById,clip:clipCurrentSnapshot(clip),source:sourceScopeSnapshot(source),
    historicalApproval:canonical(baseline),skuVersion,categoryEvidence,approvalBasis:'existing_approved_record',newAsrApproval:false,newVisualApproval:false};
  return {candidate:true,candidateOnly:true,eligible:false,currentMediaVerified:false,reason:null,mode:HISTORICAL_INVENTORY_MODE,
    clipId:clip.id,sourceId:source.id,skuVersion,poolKey:skuVersion?`known:${skuVersion}`:'historical_unversioned',
    versionAssurance:skuVersion?'explicit_metadata':'not_recorded',categoryEvidence,sourceContentSha256:source.contentSha256||null,
    mediaIdentity:{sourceId:source.id,assetId:source.materialCenterAssetId||null,storedName:clip.storedName,startSeconds:clip.startSeconds,endSeconds:clip.endSeconds},
    candidateSnapshot:freeze(candidateSnapshot),candidateSnapshotSha256:historicalSnapshotDigest(candidateSnapshot),approvalGranted:false,
    requiresNewOutputReview:true,requiresCompanyAndPlatformReview:true};
}

// Even a genuine existing-output capability cannot authorize future planning.
export const planHistoricalApprovedClip=options=>historicalApprovedClipCandidate(options);
export function assessHistoricalApprovedClip(options){
  const candidate=historicalApprovedClipCandidate(options,{existingOutputContext:options.existingOutputContext});if(!candidate.candidate)return candidate;
  const {clip,source,media}=options;
  if(media?.regularFile!==true||media.symlink!==false||!sha(media.sha256)||!Number.isSafeInteger(media.size)||media.size<=0
    ||typeof media.durationSeconds!=='number'||!Number.isFinite(media.durationSeconds)||Math.abs(media.durationSeconds-clip.durationSeconds)>1.2
    ||media.hasAudio!==true||clip.contentSha256&&clip.contentSha256!==media.sha256
    ||Number.isSafeInteger(clip.size)&&clip.size>0&&clip.size!==media.size)return failure('current_clip_media_unverified');
  const snapshot={...candidate.candidateSnapshot,currentMedia:{sha256:media.sha256,size:media.size,durationSeconds:media.durationSeconds,hasAudio:true}};
  return {eligible:true,candidateOnly:false,currentMediaVerified:true,reason:null,mode:HISTORICAL_INVENTORY_MODE,clipId:clip.id,sourceId:source.id,skuVersion:candidate.skuVersion,
    poolKey:candidate.poolKey,versionAssurance:candidate.versionAssurance,categoryEvidence:candidate.categoryEvidence,
    currentClipSha256:media.sha256,sourceContentSha256:source.contentSha256||null,
    mediaIdentity:{sourceId:source.id,assetId:source.materialCenterAssetId||null,storedName:clip.storedName,
      startSeconds:clip.startSeconds,endSeconds:clip.endSeconds,clipSha256:media.sha256},
    snapshot:freeze(snapshot),snapshotSha256:historicalSnapshotDigest(snapshot),approvalGranted:false,
    requiresNewOutputReview:true,requiresCompanyAndPlatformReview:true};
}

function buildPools({baselines,library,mediaByClipId,job,identity,canReadSource,canReadClip,preferredClipIds=[],excludeClip},planning){
  const sources=new Map((library?.sources||[]).map(s=>[s.id,s])),clips=new Map((library?.clips||[]).map(c=>[c.id,c]));
  if(sources.size!==(library?.sources||[]).length||clips.size!==(library?.clips||[]).length)return {pools:[],rejected:[{reason:'duplicate_library_identity'}]};
  const preferred=new Map(preferredClipIds.map((id,i)=>[id,i])),pools=new Map(),rejected=[],seen=new Set();
  for(const baseline of baselines||[]){
    if(seen.has(baseline.id))return {pools:[],rejected:[{reason:'duplicate_historical_identity'}]};seen.add(baseline.id);
    const clip=clips.get(baseline.id),assess=planning?planHistoricalApprovedClip:assessHistoricalApprovedClip;
    const result=assess({baseline,clip,source:sources.get(clip?.sourceId),media:planning?undefined:mediaByClipId?.get(clip?.id),job,identity,canReadSource,canReadClip,excludeClip});
    if(planning?!result.candidate:!result.eligible){rejected.push({clipId:baseline.id,reason:result.reason});continue;}
    const rowsKey=planning?'candidates':'evidence';
    const pool=pools.get(result.poolKey)||{poolKey:result.poolKey,skuVersion:result.skuVersion,versionAssurance:result.versionAssurance,clips:[],[rowsKey]:[],
      candidateOnly:planning,currentMediaVerified:!planning};
    pool.clips.push(clip);pool[rowsKey].push(result);pools.set(result.poolKey,pool);
  }
  for(const pool of pools.values()){
    const rank=id=>preferred.has(id)?preferred.get(id):Number.MAX_SAFE_INTEGER;
    pool.clips.sort((a,b)=>rank(a.id)-rank(b.id)||a.id.localeCompare(b.id));pool[planning?'candidates':'evidence'].sort((a,b)=>rank(a.clipId)-rank(b.clipId)||a.clipId.localeCompare(b.clipId));
  }
  return {mode:HISTORICAL_INVENTORY_MODE,pools:[...pools.values()].sort((a,b)=>a.poolKey.localeCompare(b.poolKey)),rejected,
    candidateOnly:planning,currentMediaVerified:!planning,approvalGranted:false,newClipsApproved:0,newAsrApproval:false,newVisualApproval:false};
}
export const buildHistoricalApprovedPools=options=>buildPools(options,false);
export const buildHistoricalCandidatePools=options=>buildPools(options,true);

export function validateHistoricalReuseSnapshot({previous,current,job,identity,requireActive=true,existingOutputContext}){
  if(job?.id!==HISTORICAL_INVENTORY_JOB||job.createdById!=='FD-026222'||identity?.id!==job.createdById
    ||job.productCategory!=='黑晶面膜'||job.targetDurationSeconds!==90||job.dailyTarget!==2
    ||requireActive&&job.status!=='active'||job.archivedAt||denied(job))return {valid:false,reason:'job_or_identity_scope'};
  if(isExcluded(job,current?.snapshot?.clip,undefined,existingOutputContext))return {valid:false,reason:'company_job_clip_excluded'};
  if(!previous?.eligible||!current?.eligible||previous.mode!==HISTORICAL_INVENTORY_MODE||current.mode!==HISTORICAL_INVENTORY_MODE
    ||previous.currentMediaVerified!==true||current.currentMediaVerified!==true||previous.candidateOnly!==false||current.candidateOnly!==false
    ||previous.snapshot?.jobId!==job.id||current.snapshot?.jobId!==job.id||previous.snapshot?.ownerId!==identity.id||current.snapshot?.ownerId!==identity.id
    ||!sha(previous.snapshotSha256)||previous.snapshotSha256!==historicalSnapshotDigest(previous.snapshot)
    ||!sha(current.snapshotSha256)||current.snapshotSha256!==historicalSnapshotDigest(current.snapshot))return {valid:false,reason:'reuse_snapshot_invalid'};
  if(previous.clipId!==current.clipId||previous.snapshotSha256!==current.snapshotSha256)return {valid:false,reason:'reuse_snapshot_changed'};
  return {valid:true,reason:null,approvalGranted:false};
}

export const HISTORICAL_SEQUENCE_VERSION='wis-historical-source-interval-sequence-v1';
function intervalSequence(rows){
  if(!Array.isArray(rows)||!rows.length)return null;const intervals=[];
  for(const row of rows){
    if(typeof row.sourceId!=='string'||!row.sourceId||!Number.isSafeInteger(row.assetId)||row.assetId<=0
      ||![row.startSeconds,row.endSeconds].every(Number.isFinite)||row.startSeconds<0||row.endSeconds<=row.startSeconds)return null;
    const last=intervals.at(-1);
    // Exact playback adjacency only: no sorting/tolerance or gap/overlap merge.
    if(last&&last[0]===row.sourceId&&last[1]===row.assetId&&last[3]===row.startSeconds)last[3]=row.endSeconds;
    else intervals.push([row.sourceId,row.assetId,row.startSeconds,row.endSeconds]);
  }
  return {version:HISTORICAL_SEQUENCE_VERSION,key:historicalSnapshotDigest({version:HISTORICAL_SEQUENCE_VERSION,intervals}),intervals};
}
// Sequence identity uses real source+asset+range; it never masquerades as a
// source-file SHA. Actual current clip hashes are separately bound to the plan.
// Thus re-encoding an old interval cannot manufacture a novel sequence.
export function historicalInventorySequence(evidence){
  if(!Array.isArray(evidence)||!evidence.length)return null;const pools=new Set(),rows=[],hashes=[];
  for(const item of evidence){
    if(!item?.eligible||item.currentMediaVerified!==true||item.candidateOnly!==false||item.mode!==HISTORICAL_INVENTORY_MODE||item.snapshotSha256!==historicalSnapshotDigest(item.snapshot)||item.skuVersion!==item.snapshot?.skuVersion
      ||item.snapshot?.jobId!==HISTORICAL_INVENTORY_JOB||!sha(item.currentClipSha256)||item.currentClipSha256!==item.snapshot.currentMedia?.sha256)return null;
    const source=item.snapshot.source,clip=item.snapshot.clip,identity=item.mediaIdentity;
    if(!source||!clip||item.clipId!==clip.id||item.sourceId!==source.id||clip.sourceId!==source.id||identity?.sourceId!==source.id||identity.assetId!==source.materialCenterAssetId
      ||identity.startSeconds!==clip.startSeconds||identity.endSeconds!==clip.endSeconds||identity.clipSha256!==item.currentClipSha256)return null;
    pools.add(item.skuVersion||null);rows.push(identity);hashes.push(item.currentClipSha256);
  }
  if(pools.size!==1||new Set(hashes).size!==hashes.length)return null;
  const sequence=intervalSequence(rows);return sequence?{...sequence,currentClipSha256s:hashes,
    snapshotSha256s:evidence.map(e=>e.snapshotSha256),contentApprovalGranted:false}:null;
}

// Planning identity contains no measured-media claim and is never effect proof.
// Core must re-assess recovered bytes and compare the same identity before use.
export function historicalCandidateSequence(candidates){
  if(!Array.isArray(candidates)||!candidates.length)return null;const pools=new Set(),rows=[];
  for(const item of candidates){
    const snapshot=item?.candidateSnapshot,identity=item?.mediaIdentity,source=snapshot?.source,clip=snapshot?.clip;
    if(item?.candidate!==true||item.candidateOnly!==true||item.eligible!==false||item.currentMediaVerified!==false||item.mode!==HISTORICAL_INVENTORY_MODE
      ||!sha(item.candidateSnapshotSha256)||item.candidateSnapshotSha256!==historicalSnapshotDigest(snapshot)
      ||snapshot?.jobId!==HISTORICAL_INVENTORY_JOB||snapshot.ownerId!=='FD-026222'||item.skuVersion!==snapshot.skuVersion
      ||!source||!clip||item.clipId!==clip.id||item.sourceId!==source.id||clip.sourceId!==source.id||identity?.sourceId!==source.id
      ||identity.assetId!==source.materialCenterAssetId||identity.storedName!==clip.storedName
      ||identity.startSeconds!==clip.startSeconds||identity.endSeconds!==clip.endSeconds)return null;
    pools.add(item.skuVersion||null);rows.push(identity);
  }
  if(pools.size!==1)return null;const sequence=intervalSequence(rows);
  return sequence?{...sequence,candidateOnly:true,currentMediaVerified:false,contentApprovalGranted:false}:null;
}

// Strict production factory: the 70 IDs come from the actual immutable current
// readback, not a hand-copied list or caller-provided approved badge. No bytes are
// loaded here; core must read its server-owned artifact through trusted DI.
export function createHistoricalApprovedInventory(referenceBytes,{additionalReferenceBytes,excludeClip}={}){
  if(!Buffer.isBuffer(referenceBytes)||digest(referenceBytes)!==HISTORICAL_REFERENCE_SHA256)throw Error('HISTORICAL_REFERENCE_HASH_MISMATCH');
  const parsed=JSON.parse(referenceBytes.toString('utf8'));
  if(parsed.libraryStable!==true||parsed.historicalOutputs!==63||parsed.referencedClips!==70||parsed.assets!==63
    ||!Array.isArray(parsed.clips)||parsed.clips.length!==70||new Set(parsed.clips.map(c=>c.id)).size!==70
    ||parsed.clips.some(c=>c.reviewStatus!=='approved'||!stamp(c.reviewedAt)||c.deliveryBlocked))throw Error('HISTORICAL_REFERENCE_INVALID');
  let additional=[];
  if(additionalReferenceBytes!==undefined){
    if(!Buffer.isBuffer(additionalReferenceBytes)||digest(additionalReferenceBytes)!==HISTORICAL_EXPANDED_REFERENCE_SHA256)
      throw Error('HISTORICAL_EXPANDED_REFERENCE_HASH_MISMATCH');
    const captured=JSON.parse(additionalReferenceBytes.toString('utf8'));
    if(captured.schema!=='wis-historical-approved-inventory-snapshot-v1'||captured.relevantScopeStable!==true
      ||captured.relevantBeforeSha256!==captured.relevantAfterSha256||!sha(captured.relevantBeforeSha256)
      ||captured.approvalGranted!==false||captured.sourceHashBackfilled!==false||captured.skuInferred!==false
      ||captured.job?.id!==HISTORICAL_INVENTORY_JOB||captured.job.createdById!=='FD-026222'
      ||captured.originalReference?.sha256!==HISTORICAL_REFERENCE_SHA256||!Array.isArray(captured.clips)
      ||captured.count!==captured.clips.length||captured.count!==329||new Set(captured.clips.map(c=>c.id)).size!==captured.count
      ||captured.clips.some(c=>c.reviewStatus!=='approved'||!stamp(c.reviewedAt)||c.deliveryBlocked))
      throw Error('HISTORICAL_EXPANDED_REFERENCE_INVALID');
    // Never replace the original 70 approval records with later snapshots.
    additional=captured.clips.filter(c=>!parsed.clips.some(old=>old.id===c.id));
  }
  const baselines=freeze(structuredClone([...parsed.clips,...additional])),preferredClipIds=freeze(baselines.map(c=>c.id));
  return Object.freeze({mode:HISTORICAL_INVENTORY_MODE,referenceSha256:HISTORICAL_REFERENCE_SHA256,
    additionalReferenceSha256:additionalReferenceBytes===undefined?null:HISTORICAL_EXPANDED_REFERENCE_SHA256,preferredClipIds,
    buildPools:options=>buildHistoricalApprovedPools({...options,baselines,preferredClipIds,excludeClip}),
    planPools:options=>buildHistoricalCandidatePools({...options,baselines,preferredClipIds,excludeClip}),
    planningAssess:options=>planHistoricalApprovedClip({...options,excludeClip,baseline:baselines.find(b=>b.id===options.clip?.id)}),
    assess:options=>assessHistoricalApprovedClip({...options,excludeClip,baseline:baselines.find(b=>b.id===options.clip?.id)}),
    // Only the actual captured historical output sequence can enter this path;
    // this is dedupe evidence, not a claim that old bytes were SHA-verified.
    historicalOutputSequences:()=>parsed.rows.map(row=>{
      const clips=row.clipSequence.map(id=>baselines.find(b=>b.id===id));
      if(clips.some(c=>!c))return null;
      const sequence=intervalSequence(clips.map(c=>({sourceId:c.sourceId,assetId:Number(c.sourceAssetId),startSeconds:c.startSeconds,endSeconds:c.endSeconds})));
      return sequence?{renderId:row.renderId,variantId:row.variantId,...sequence}:null;
    }).filter(Boolean),
  });
}
