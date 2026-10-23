import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {BLACK_MASK_VERSIONS} from './product-version-contract.mjs';
import {R13_ADDITIVE_SOURCE_IDS} from './combine-legacy-source-resolvers.mjs';
import {LEGACY_MODE,hasLegacyVersionConflict,legacyEvidenceDigest} from './legacy-source-evidence.mjs';
import {UPLOAD_PREPARATION_KIND,isUploadPreparationBinding,uploadPreparationBindingDigest,
  validateUploadPreparationAuthority,validateCurrentUploadAsset} from './upload-preparation-authority.mjs';

export const LEGACY_REGISTRY_SCHEMA='wis-legacy-source-registry-v1';
export const LEGACY_HISTORY_SCHEMA='wis-legacy-source-history-v1';
export const LEGACY_COMMON_FACTS_SCHEMA='wis-legacy-common-product-facts-v1';
const PRODUCT='黑晶面膜';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const requireValue=(ok,reason)=>{if(!ok)throw Error(reason);};
const absent=value=>value===undefined||value===null;
const validSha=value=>typeof value==='string'&&/^[a-f0-9]{64}$/u.test(value);
const validId=value=>typeof value==='string'&&value.length>0&&value.length<=256&&value.trim()===value&&!/[\x00-\x1f/\\]/u.test(value);
const date=value=>typeof value==='string'&&Number.isFinite(Date.parse(value));
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const blocked=value=>value?.revoked===true||!absent(value?.revokedAt)&&value.revokedAt!==''
  ||value?.disabled===true||value?.deliveryBlocked===true||['rejected','changes_requested'].includes(value?.reviewStatus);
const same=(a,b)=>a.dev===b.dev&&a.ino===b.ino&&a.size===b.size&&a.mtimeMs===b.mtimeMs&&a.ctimeMs===b.ctimeMs;
async function unlinked(file){let current=file;while(true){const st=await fs.lstat(current);requireValue(!st.isSymbolicLink(),'legacy_store_link');const parent=path.dirname(current);if(parent===current)return;current=parent;}}
async function readFile(file,maxBytes){
  await unlinked(file);const before=await fs.lstat(file);
  requireValue(before.isFile()&&before.size>0&&before.size<=maxBytes,'legacy_store_file');
  const handle=await fs.open(file,'r');
  try{
    const opened=await handle.stat();requireValue(opened.isFile()&&same(before,opened),'legacy_store_changed');
    const bytes=await handle.readFile(),after=await handle.stat();await unlinked(file);
    const current=await fs.lstat(file);
    requireValue(bytes.length<=maxBytes&&same(before,after)&&same(before,current)&&!current.isSymbolicLink(),'legacy_store_changed');
    return bytes;
  }finally{await handle.close();}
}
function inside(root,relative){
  requireValue(typeof relative==='string'&&relative.length>0&&!path.isAbsolute(relative)
    &&!/[\0\r\n:]/u.test(relative)&&!relative.startsWith('\\')&&!relative.split(/[\\/]/u).includes('..'),'legacy_store_path');
  const file=path.resolve(root,relative);requireValue(file.startsWith(root+path.sep),'legacy_store_path');return file;
}
const candidateBinding=b=>plain(b)&&validId(b.id)&&validId(b.sourceId)&&b.status==='available'
  &&validSha(b.sourceSha256)&&!blocked(b)&&!hasLegacyVersionConflict(b)
  &&(b.admissionKind===UPLOAD_PREPARATION_KIND?isUploadPreparationBinding(b)
    :absent(b.admissionKind)&&validSha(b.historySnapshotSha256)
      &&!['preparationAuthorityFile','preparationAuthoritySha256'].some(k=>Object.hasOwn(b,k)));
async function registry(root){
  let raw;try{raw=await readFile(path.join(root,'manifest.json'),8*1024*1024);}
  catch(error){if(error.code==='ENOENT')return null;throw error;}
  const manifest=JSON.parse(raw);
  requireValue(manifest?.schema===LEGACY_REGISTRY_SCHEMA&&Array.isArray(manifest.bindings)&&manifest.bindings.length<=10000
    &&manifest.bindings.every(b=>plain(b)&&validId(b.sourceId))&&plain(manifest.commonFacts)
    &&validSha(manifest.commonFacts.snapshotSha256),'legacy_store_manifest');
  requireValue(new Set(manifest.bindings.map(b=>b.sourceId)).size===manifest.bindings.length,'legacy_store_duplicate_source');
  return {raw,manifest,registrySha256:sha(raw)};
}
function sourceIssue(source,actualSourceSha256){
  if(source?.productCategory!==PRODUCT)return 'product_not_managed';
  if(!validId(source.id)||!validId(source.storedName))return 'source_identity_missing';
  if(hasLegacyVersionConflict(source))return 'legacy_version_conflict';
  if(blocked(source))return 'source_approval_revoked';
  if(!validSha(actualSourceSha256)||!absent(source.contentSha256)&&!validSha(source.contentSha256))return 'source_evidence_missing';
  if(!absent(source.contentSha256)&&source.contentSha256!==actualSourceSha256)return 'source_binding_changed';
  return null;
}
function checkHistoricalRecord(record,source,kind){
  if(!plain(record)||record.reviewStatus!=='approved'||blocked(record)||hasLegacyVersionConflict(record))return false;
  if(record.productCategory!==PRODUCT||!validId(record.id))return false;
  if(kind==='source')return record.id===source.id&&record.storedName===source.storedName
    &&(absent(record.contentSha256)||record.contentSha256===source.contentSha256);
  return kind==='clip'&&record.sourceId===source.id&&validId(record.storedName)
    &&(absent(record.contentSha256)||validSha(record.contentSha256));
}
function checkedHistory(history,binding,source,actualSourceSha256){
  const old=history?.source;
  requireValue(history?.schema===LEGACY_HISTORY_SCHEMA&&date(history.capturedAt)&&plain(old)
    &&old.id===source.id&&old.storedName===source.storedName&&old.productCategory===PRODUCT
    &&!blocked(old)&&!hasLegacyVersionConflict(old),'legacy_history_identity');
  // An old NULL hash stays NULL in the snapshot. The newly measured hash binds
  // this migration, not a claim that the old approval once covered these bytes.
  requireValue(absent(old.contentSha256)||old.contentSha256===actualSourceSha256,'legacy_history_hash_conflict');
  for(const field of ['materialCenterAssetId'])if(!absent(old[field]))
    requireValue(String(old[field])===String(source[field]),'legacy_history_identity');
  requireValue(Array.isArray(history.approvedRecords)&&history.approvedRecords.length>0&&history.approvedRecords.length<=10000,
    'legacy_history_approval_missing');
  const seen=new Set();
  for(const item of history.approvedRecords){
    requireValue(plain(item)&&checkHistoricalRecord(item.record,{...old,contentSha256:actualSourceSha256},item.kind),'legacy_history_approval_missing');
    const key=item.kind+':'+item.record.id;requireValue(!seen.has(key),'legacy_history_duplicate_record');seen.add(key);
  }
  requireValue(binding.sourceId===source.id&&binding.sourceSha256===actualSourceSha256,'legacy_source_bytes_changed');
  return history;
}
function stringContent(value,result=[]){
  if(typeof value==='string')result.push(value);
  else if(Array.isArray(value))for(const item of value)stringContent(item,result);
  else if(plain(value))for(const item of Object.values(value))stringContent(item,result);
  return result;
}
async function checkedCommonFacts(root,descriptor,readEvidence){
  const bytes=await readEvidence(inside(root,descriptor.snapshotFile),4*1024*1024);
  requireValue(sha(bytes)===descriptor.snapshotSha256,'legacy_common_facts_changed');
  const profile=JSON.parse(bytes),facts=profile?.profileFacts;
  requireValue(profile?.schema===LEGACY_COMMON_FACTS_SCHEMA&&profile.productCategory===PRODUCT
    &&profile.verificationPurpose==='shared_product_facts_only'&&validId(profile.verifiedBy)&&date(profile.verifiedAt)
    &&!blocked(profile)&&plain(facts)&&Object.keys(facts).length>0&&JSON.stringify(facts).length<=32000,
    'legacy_common_facts_invalid');
  // These are the two already-confirmed formal document identities, not a new
  // product-code catalog or an inferred edition assignment to the old source.
  const expectedIds=BLACK_MASK_VERSIONS.map(v=>v.documentId);
  requireValue(Array.isArray(profile.references)&&profile.references.length===expectedIds.length
    &&new Set(profile.references.map(r=>r?.documentId)).size===expectedIds.length
    &&profile.references.every(r=>expectedIds.includes(r?.documentId)&&Number.isSafeInteger(r.documentRevision)
      &&r.documentRevision>0&&validSha(r.snapshotSha256)&&!blocked(r)),'legacy_common_reference_scope');
  const documents=new Map();
  for(const ref of profile.references){
    const raw=await readEvidence(inside(root,ref.snapshotFile),4*1024*1024);
    requireValue(sha(raw)===ref.snapshotSha256,'legacy_reference_bytes_changed');
    const snapshot=JSON.parse(raw),document=snapshot?.data?.document;
    requireValue(document?.document_id===ref.documentId&&document.revision_id===ref.documentRevision,'legacy_reference_revision_changed');
    documents.set(ref.documentId,stringContent(snapshot).join('\n'));
  }
  const keys=Object.keys(facts);
  requireValue(Array.isArray(profile.factEvidence)&&profile.factEvidence.length===keys.length
    &&new Set(profile.factEvidence.map(e=>e?.factKey)).size===keys.length,'legacy_common_fact_evidence');
  for(const entry of profile.factEvidence){
    requireValue(plain(entry)&&keys.includes(entry.factKey)&&Array.isArray(entry.citations)
      &&entry.citations.length===expectedIds.length&&new Set(entry.citations.map(c=>c?.documentId)).size===expectedIds.length
      &&entry.citations.every(c=>documents.has(c?.documentId)&&typeof c.quote==='string'&&c.quote.trim().length>0
        &&c.quote.length<=4000&&documents.get(c.documentId).includes(c.quote)),'legacy_common_fact_evidence');
  }
  // Citation integrity is not a semantic proof of a claim or commercial
  // clearance. The named verifier owns the conservative shared-fact mapping;
  // the existing CURRENT segment reviewer still checks actual selected claims.
  return {profile,profileSha256:sha(bytes)};
}

/** Read-only deployment-owned migration registry. No HTTP/API writer is exposed.
 *
 * manifest.json: {schema:LEGACY_REGISTRY_SCHEMA,
 *   bindings:[{id,sourceId,sourceSha256,status:'available',historySnapshotFile,historySnapshotSha256,
 *     preparationEnabled?:true|false}],
 *   commonFacts:{snapshotFile,snapshotSha256}}
 * history file: {schema:LEGACY_HISTORY_SCHEMA,capturedAt,source:<unaltered old row>,
 *   approvedRecords:[{kind:'source'|'clip',record:<unaltered approved old row>}]}
 * facts file: {schema:LEGACY_COMMON_FACTS_SCHEMA,productCategory:'黑晶面膜',
 *   verificationPurpose:'shared_product_facts_only',verifiedBy,verifiedAt,profileFacts:{...},
 *   references:[{documentId,documentRevision,snapshotFile,snapshotSha256}],
 *   factEvidence:[{factKey,citations:[{documentId,quote}]}]}
 *
 * All snapshots are immutable; publish a replacement manifest atomically.
 * SHA checks prove consistency of private evidence, not its authenticity when
 * fabricated outside the service. The authorized migration must extract real
 * library rows and real document snapshots. Resolve never approves new clips.
 * Caller supplies a CURRENT measured media hash, enforces live access/pause and
 * revocation checks, and verifies every SELECTED segment's private review proof.
 * Historical admission is passive: only a private binding whose preparationEnabled
 * is exactly true enters candidateSourceIds. This flag is not accepted from public
 * source rows and does not grant approval. It changes registry CAS/discovery keys,
 * not the source binding/ASR scope or the separately versioned common-facts profile.
 */
export function createLegacySourceResolver(directory,{readCurrentUploadAsset,allowedSourceIds,requirePassiveBindings=false}={}){
  requireValue(typeof directory==='string'&&path.isAbsolute(directory)&&!directory.startsWith('\\\\')&&!directory.startsWith('//')
    &&!/[\0\r\n]/u.test(directory)&&!directory.split(/[\\/]/u).includes('..'),'legacy_store_root');
  const root=path.resolve(directory);
  const allowlist=allowedSourceIds===undefined?null:new Set(allowedSourceIds);
  if(allowlist)requireValue(Array.isArray(allowedSourceIds)&&allowlist.size>0
    &&(allowlist.size<=7 || requirePassiveBindings&&allowlist.size===10&&R13_ADDITIVE_SOURCE_IDS.every(id=>allowlist.has(id)))
    &&allowlist.size===allowedSourceIds.length&&allowedSourceIds.every(validId),'legacy_addon_scope');
  requireValue(!requirePassiveBindings||allowlist,'legacy_addon_scope');
  const readRegistry=async()=>{
    const value=await registry(root);if(!value)return null;
    if(allowlist)requireValue(value.manifest.bindings.length<=allowlist.size
      &&value.manifest.bindings.every(b=>allowlist.has(b.sourceId)&&(!requirePassiveBindings||b.preparationEnabled===false)),
      'legacy_addon_scope');
    return value;
  };
  const resolve=async({source,actualSourceSha256})=>{
    const input=structuredClone(source),reason=sourceIssue(input,actualSourceSha256);
    if(reason)return {ready:false,reason};
    const current=await readRegistry();if(!current)return {ready:false,reason:'legacy_source_catalog_missing'};
    const {manifest,raw}=current,binding=manifest.bindings.find(b=>b.sourceId===input.id);
    if(!binding)return {ready:false,reason:'legacy_source_unbound'};
    if(!candidateBinding(binding))return {ready:false,reason:'legacy_source_binding_unavailable'};
    if(binding.sourceSha256!==actualSourceSha256)return {ready:false,reason:'source_binding_changed'};
    const consumed=new Map();
    const readEvidence=async(file,maxBytes)=>{const bytes=await readFile(file,maxBytes);consumed.set(file,{maxBytes,sha256:sha(bytes)});return bytes;};
    const upload=binding.admissionKind===UPLOAD_PREPARATION_KIND;
    let history,preparationAuthority;
    if(upload){
      const authorityBytes=await readEvidence(inside(root,binding.preparationAuthorityFile),8*1024*1024);
      requireValue(sha(authorityBytes)===binding.preparationAuthoritySha256,'upload_authority_bytes_changed');
      const authority=JSON.parse(authorityBytes);
      const payloadBytes=await readEvidence(inside(root,authority?.capture?.payloadFile),8*1024*1024);
      requireValue(sha(payloadBytes)===authority.capture.payloadSha256,'upload_capture_bytes_changed');
      preparationAuthority=validateUploadPreparationAuthority({authority,binding,source:input,actualSourceSha256,
        payload:JSON.parse(payloadBytes)});
      requireValue(typeof readCurrentUploadAsset==='function','upload_current_asset_reader_missing');
      validateCurrentUploadAsset(await readCurrentUploadAsset(structuredClone(input)),input);
    }else{
      const historyBytes=await readEvidence(inside(root,binding.historySnapshotFile),8*1024*1024);
      requireValue(sha(historyBytes)===binding.historySnapshotSha256,'legacy_history_bytes_changed');
      history=checkedHistory(JSON.parse(historyBytes),binding,input,actualSourceSha256);
    }
    const {profile,profileSha256}=await checkedCommonFacts(root,manifest.commonFacts,readEvidence);
    // Only source/history identity keys the ASR scope. Updated shared facts
    // invalidate semantic proofs through profileSha256, not an unchanged ASR.
    const bindingSha256=upload?uploadPreparationBindingDigest(binding):legacyEvidenceDigest({id:binding.id,sourceId:binding.sourceId,sourceSha256:binding.sourceSha256,
      historySnapshotSha256:binding.historySnapshotSha256});
    const sourceScope={mode:LEGACY_MODE,sourceId:input.id,sourceSha256:actualSourceSha256,revisionSha256:bindingSha256};
    const skuContext={mode:LEGACY_MODE,productCategory:PRODUCT,skuVersion:null,filingNumber:null,sourceScope,
      bindingSha256,...(upload?{admissionKind:UPLOAD_PREPARATION_KIND,preparationAuthoritySha256:bindingSha256}
        :{historicalApprovalSha256:bindingSha256}),profileSha256,profileFacts:structuredClone(profile.profileFacts),referenceImages:[]};
    for(const [file,{maxBytes,sha256}]of consumed)requireValue(sha(await readFile(file,maxBytes))===sha256,'legacy_evidence_changed');
    requireValue(sha(await readFile(path.join(root,'manifest.json'),8*1024*1024))===sha(raw),'legacy_registry_changed');
    // Do not lock a legitimate new evidence revision to an old library pointer.
    // Core compares its frozen composition/proofs before effects and updates the
    // pointer only after CURRENT review succeeds. No input record is mutated.
    return {ready:true,mode:LEGACY_MODE,sourceSnapshot:{...input,contentSha256:actualSourceSha256,skuVersion:null},skuContext,
      bindingSha256,registrySha256:sha(raw),...(upload?{preparationAuthority}:{historicalApproval:{snapshotSha256:binding.historySnapshotSha256,
        capturedAt:history.capturedAt,records:history.approvedRecords.map(item=>({kind:item.kind,recordId:item.record.id}))}})};
  };
  const enumerate=async(activeOnly)=>{
    const current=await readRegistry();if(!current)return {registrySha256:null,sourceIds:[],bindingKeysBySourceId:{}};
    const candidates=current.manifest.bindings.filter(b=>candidateBinding(b)&&(!activeOnly||b.preparationEnabled===true)).filter(b=>{
      try{inside(root,b.admissionKind===UPLOAD_PREPARATION_KIND?b.preparationAuthorityFile:b.historySnapshotFile);
        inside(root,current.manifest.commonFacts.snapshotFile);return true;}catch{return false;}
    });
    return {registrySha256:current.registrySha256,sourceIds:candidates.map(b=>b.sourceId),
      bindingKeysBySourceId:Object.fromEntries(candidates.map(b=>[b.sourceId,legacyEvidenceDigest({binding:b,commonFacts:current.manifest.commonFacts})]))};
  };
  // Discovery only, not approval: a user-requested bounded run still resolves
  // current bytes/history/facts and reviews selected segments before effects.
  // Background suppliers deliberately retain the opt-in-only interface.
  resolve.candidateSourceIds=()=>enumerate(true);
  resolve.availableCandidateSourceIds=()=>enumerate(false);
  return resolve;
}
