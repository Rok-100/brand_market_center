import {legacyEvidenceDigest,hasLegacyVersionConflict} from './legacy-source-evidence.mjs';

export const UPLOAD_PREPARATION_KIND='oa_upload_preparation_v1';
export const UPLOAD_PREPARATION_SCHEMA='wis-upload-preparation-authority-v1';
export const UPLOAD_PREPARATION_PURPOSE='prepare_current_review_only';
export const UPLOAD_PREPARATION_METADATA_SCHEMA='wis-current-upload-metadata-v1';
const PRODUCT='黑晶面膜';
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&[Object.prototype,null].includes(Object.getPrototypeOf(v));
const absent=v=>v===undefined||v===null;
const sha=v=>typeof v==='string'&&/^[a-f0-9]{64}$/u.test(v);
const text=v=>typeof v==='string'&&v.trim()===v&&v.length>0&&v.length<=2048&&!/[\x00-\x1f]/u.test(v);
const date=v=>text(v)&&Number.isFinite(Date.parse(v));
const size=v=>Number.isSafeInteger(v)&&v>0;
const sameId=(a,b)=>(typeof a==='string'||Number.isSafeInteger(a))&&String(a)!==''&&String(a)===String(b);
const blocked=v=>v?.revoked===true||Boolean(v?.revokedAt)||v?.disabled===true||v?.deliveryBlocked===true
  ||['rejected','changes_requested'].includes(v?.reviewStatus);
const requireValue=(v,reason)=>{if(!v)throw Error(reason);};
const own=(v,k)=>Object.hasOwn(v,k);
const RAW_FIELDS=['id','object_key','size','category','library_type','source','uploaded_by_name','modified_at'];
const RAW_OPTIONAL=['deleted_at','purged_at','is_deleted','deletion_status','recycle_status','trash_status',
  'rights_status','permission_status','license_status','status'];
const unavailableText=value=>typeof value==='string'&&/reject|changes_requested|revok|block|unauthorized|expired|deleted|trash|recycle|待授权|版权待确认|不可用|禁用|侵权|删除|回收/iu.test(value);

// Used only by getAsset's opt-in before mapAsset can supply any default values.
// Preserve exact metadata, not media URLs, credentials, or a fabricated approval.
export function currentUploadPreparationMetadata(raw,expectedAssetId){
  requireValue(plain(raw)&&RAW_FIELDS.every(k=>own(raw,k))&&Number.isSafeInteger(raw.id)&&raw.id>0
    &&sameId(raw.id,expectedAssetId)&&text(raw.object_key)&&size(raw.size)&&raw.category===PRODUCT
    &&raw.library_type==='source'&&raw.source==='oa_upload'&&text(raw.uploaded_by_name)&&date(raw.modified_at),
    'upload_current_asset_metadata');
  requireValue(!raw.deleted_at&&!raw.purged_at&&!raw.is_deleted&&!blocked(raw)&&!hasLegacyVersionConflict(raw)
    &&RAW_OPTIONAL.every(k=>!unavailableText(raw[k])),'upload_current_asset_unavailable');
  return {schema:UPLOAD_PREPARATION_METADATA_SCHEMA,
    asset:Object.fromEntries([...RAW_FIELDS,...RAW_OPTIONAL].filter(k=>own(raw,k)).map(k=>[k,structuredClone(raw[k])]))};
}

// A private, typed *preparation permission*. The caller must have read these
// bytes from the deployment-owned registry, never an HTTP body. Neither this
// validator nor a SHA authenticates a fabricated capture. Deployment must retain
// the real authorized GET and original source record; current ACL/media/revocation
// and every selected segment/output review remain separate, mandatory checks.
export function uploadPreparationBindingDigest(binding){
  return legacyEvidenceDigest({admissionKind:UPLOAD_PREPARATION_KIND,id:binding.id,
    sourceId:binding.sourceId,sourceSha256:binding.sourceSha256,
    preparationAuthoritySha256:binding.preparationAuthoritySha256});
}

export function isUploadPreparationBinding(binding){
  return plain(binding)&&binding.admissionKind===UPLOAD_PREPARATION_KIND
    &&sha(binding.preparationAuthoritySha256)&&text(binding.preparationAuthorityFile)
    &&!['historySnapshotFile','historySnapshotSha256','historicalApproval','historicalApprovalSha256','approvedRecords']
      .some(k=>own(binding,k));
}

function pointed(payload,pointer){
  requireValue(typeof pointer==='string'&&pointer.length<=2048&&(pointer===''||pointer.startsWith('/')),'upload_capture_pointer');
  let row=payload;
  for(const token of pointer===''?[]:pointer.slice(1).split('/')){
    requireValue(!/~(?![01])/u.test(token),'upload_capture_pointer');
    const key=token.replaceAll('~1','/').replaceAll('~0','~');
    requireValue(!['__proto__','constructor','prototype'].includes(key)&&row!==null&&typeof row==='object'
      &&own(row,key),'upload_capture_pointer');
    row=row[key];
  }
  requireValue(plain(row),'upload_capture_asset');return row;
}

export function validateUploadPreparationAuthority({authority,binding,source,actualSourceSha256,payload}){
  requireValue(isUploadPreparationBinding(binding),'upload_binding_invalid');
  requireValue(plain(authority)&&authority.schema===UPLOAD_PREPARATION_SCHEMA
    &&authority.purpose===UPLOAD_PREPARATION_PURPOSE&&date(authority.capturedAt)
    &&!['historicalApproval','historicalApprovalSha256','approvedRecords','status','reviewStatus','approved','autoApproved']
      .some(k=>own(authority,k)),'upload_authority_invalid');
  const old=authority.source,capture=authority.capture;
  requireValue(plain(old)&&plain(source)&&!blocked(old)&&!blocked(source)
    &&!hasLegacyVersionConflict(old)&&!hasLegacyVersionConflict(source)
    &&old.productCategory===PRODUCT&&source.productCategory===PRODUCT
    &&text(old.id)&&old.id===source.id&&text(old.storedName)&&old.storedName===source.storedName
    &&old.sourceType==='material_center'&&source.sourceType==='material_center'
    &&old.reviewStatus!=='approved','upload_source_identity');
  requireValue(sha(actualSourceSha256)&&binding.sourceId===source.id&&binding.sourceSha256===actualSourceSha256
    &&authority.sourceSha256===actualSourceSha256
    &&(absent(old.contentSha256)||old.contentSha256===actualSourceSha256)
    &&(absent(source.contentSha256)||source.contentSha256===actualSourceSha256),'upload_source_bytes_changed');
  requireValue(size(authority.sourceSize)&&authority.sourceSize===old.size&&authority.sourceSize===source.size
    &&sameId(old.materialCenterAssetId,source.materialCenterAssetId)
    &&text(old.materialCenterObjectKey)&&old.materialCenterObjectKey===source.materialCenterObjectKey,'upload_source_identity');
  requireValue(plain(capture)&&capture.method==='GET'&&capture.status===200&&date(capture.capturedAt)
    &&Date.parse(capture.capturedAt)<=Date.parse(authority.capturedAt)
    &&typeof capture.endpointPath==='string'&&/^\/api\/[A-Za-z0-9_./-]+$/u.test(capture.endpointPath)
    &&!capture.endpointPath.includes('..')&&text(capture.payloadFile)&&sha(capture.payloadSha256),'upload_capture_invalid');
  const asset=pointed(payload,capture.assetPointer);
  // Workstation GET is an original snake_case row, not the mapper's defaults.
  // In particular, it does not expose is_deleted. Never invent that field.
  requireValue(sameId(asset.id,source.materialCenterAssetId)&&asset.object_key===source.materialCenterObjectKey
    &&asset.size===authority.sourceSize&&asset.category===PRODUCT&&asset.library_type==='source'
    &&asset.source==='oa_upload'&&date(asset.modified_at)&&text(asset.uploaded_by_name)
    &&capture.endpointPath===`/api/workstation/assets/${asset.id}`&&!hasLegacyVersionConflict(asset),'upload_asset_identity');
  const db=authority.databaseUploadSupport;
  requireValue(plain(db)&&date(authority.databaseReadAt)&&Date.parse(authority.databaseReadAt)<=Date.parse(authority.capturedAt)
    &&sameId(db.id,asset.id)&&db.object_key===asset.object_key&&db.size===asset.size
    &&db.category===PRODUCT&&db.library_type==='source'&&db.asset_scope==='marketing_video'
    &&db.source==='oa_upload'&&db.ingest_source==='oa_upload'&&text(db.uploaded_by_number)
    &&db.uploaded_by_name===asset.uploaded_by_name&&date(db.modified_at),'upload_database_identity');
  requireValue(own(db,'deleted_at')&&db.deleted_at===null&&own(db,'purged_at')&&db.purged_at===null
    &&!blocked(db)&&!hasLegacyVersionConflict(db)
    &&!['approved','rejected','changes_requested','revoked','blocked','deleted','purged','已批准','已拒绝','已删除'].includes(db.status),
    'upload_asset_unavailable');
  return {kind:UPLOAD_PREPARATION_KIND,purpose:UPLOAD_PREPARATION_PURPOSE,capturedAt:authority.capturedAt,
    assetId:asset.id,objectKey:asset.object_key,sourceSize:authority.sourceSize,
    snapshotSha256:binding.preparationAuthoritySha256,payloadSha256:capture.payloadSha256};
}

// This input is supplied only by the server's current authorized getAsset DI.
// A saved capture or a browser-supplied asset cannot satisfy this live check.
export function validateCurrentUploadAsset(asset,source){
  requireValue(plain(asset?.preparationMetadata)&&asset.preparationMetadata.schema===UPLOAD_PREPARATION_METADATA_SCHEMA,
    'upload_current_asset_metadata');
  const raw=currentUploadPreparationMetadata(asset.preparationMetadata.asset,source.materialCenterAssetId).asset;
  requireValue(plain(asset)&&sameId(asset.id,source.materialCenterAssetId)
    &&asset.objectKey===source.materialCenterObjectKey&&raw.object_key===source.materialCenterObjectKey
    &&asset.size===source.size&&raw.size===source.size
    &&asset.category===PRODUCT&&asset.libraryType==='source'&&asset.source==='oa_upload'
    &&asset.isDeleted===false&&!asset.deletionStatus&&!blocked(asset)&&!hasLegacyVersionConflict(asset)
    &&!unavailableText(asset.rightsStatus),
    'upload_current_asset_unavailable');
  return true;
}
