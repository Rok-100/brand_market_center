import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {canReadSource} from './asset-access.mjs';
import {hasLegacyVersionConflict} from './legacy-source-evidence.mjs';
import {currentUploadPreparationMetadata,validateCurrentUploadAsset} from './upload-preparation-authority.mjs';

export const PILOT_CATEGORY_REPAIR_SCHEMA='wis-pilot-source-category-repair-v1';
export const PILOT_CATEGORY_REPAIR_JOB_ID='a5fdb74d-a2a1-4cf0-affe-d9bbfaf30354';
export const PILOT_CATEGORY_REPAIR_PURPOSE='same_asset_missing_category_sync_only';
const PRODUCT='黑晶面膜';
export const PILOT_CATEGORY_REPAIR_PINS=Object.freeze([
  {assetId:84980,sourceId:'fc2682c8-86b6-4d73-9f8e-1931220d94ae',storedName:'ad10988e-0898-4ea4-a685-d952396297d5.mp4',size:376038174,
    objectKey:'yxb/uploads/庄锦铭/20260821T104548Z-07b7dc3655-WIS微针-821庄锦铭-林心如.mp4',sha256:'73bea07ad66dacf20f2ff2a9e0a21f286e7b4369e13fe75df54b48fa7bc60923'},
  {assetId:84985,sourceId:'3931aab7-e983-4d8e-ac72-3720d2d78d78',storedName:'d1ad91b1-1543-49af-a72a-cd5f3dc1371a.mp4',size:372987582,
    objectKey:'yxb/uploads/庄锦铭/20260821T104633Z-b4128038ce-WIS微针-821庄锦铭-少吃饭.mp4',sha256:'4fe14271bed35fe93a5004860886bf5a756be802607f07cfbab5017726afc7f3'},
  {assetId:84975,sourceId:'ee12e2fb-0a92-4f75-b330-4800f77c330d',storedName:'b128da14-7d2b-45c7-ba62-11f625ce8a70.mp4',size:321675240,
    objectKey:'yxb/uploads/庄锦铭/20260821T104323Z-22bc854097-WIS微针-821庄锦铭-管管她.mp4',sha256:'80499d63f8a53fd2140aa2d0d7c2f4b1c242fd03de401345252b9f245accfb8d'},
].map(Object.freeze));
const check=(ok,reason)=>{if(!ok)throw Object.assign(new Error(reason),{code:'PILOT_SOURCE_CATEGORY_REPAIR_BLOCKED'});};
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&[Object.prototype,null].includes(Object.getPrototypeOf(v));
const sha=b=>createHash('sha256').update(b).digest('hex');
const hex=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const text=v=>typeof v==='string'&&v.trim()===v&&v.length>0&&v.length<=2048&&!/[\x00-\x1f]/u.test(v);
const date=v=>text(v)&&Number.isFinite(Date.parse(v));
const canonical=v=>JSON.stringify(v,(_key,value)=>plain(value)?Object.fromEntries(Object.keys(value).sort().map(k=>[k,value[k]])):value);
const digest=v=>sha(canonical(v));
const clone=v=>structuredClone(v);
const blocked=v=>v?.revoked===true||Boolean(v?.revokedAt)||v?.disabled===true||v?.deliveryBlocked===true
  ||['rejected','changes_requested'].includes(v?.reviewStatus);
const missingCategory=source=>plain(source)&&(!Object.hasOwn(source,'productCategory')||source.productCategory===null);
const sameStat=(a,b)=>['dev','ino','size','mtimeMs','ctimeMs'].every(k=>a[k]===b[k]);
async function noLinks(file){
  for(let current=path.resolve(file);;current=path.dirname(current)){
    const st=await fs.lstat(current);check(!st.isSymbolicLink(),'repair_evidence_link');
    if(path.dirname(current)===current)return;
  }
}
async function readSafe(file){
  await noLinks(file);const before=await fs.lstat(file);
  check(before.isFile()&&before.nlink===1&&before.size>0&&before.size<=8*1024*1024,'repair_evidence_file');
  const handle=await fs.open(file,'r');
  try{
    check(sameStat(before,await handle.stat()),'repair_evidence_changed');
    const bytes=await handle.readFile();await noLinks(file);
    check(sameStat(before,await handle.stat())&&sameStat(before,await fs.lstat(file)),'repair_evidence_changed');
    return bytes;
  }finally{await handle.close();}
}
function childFile(root,name){
  check(text(name)&&!path.isAbsolute(name)&&!/[\\:\0]/.test(name)&&!name.split('/').some(p=>p==='..'||p==='.'||p===''),'repair_evidence_path');
  const file=path.resolve(root,name);check(file.startsWith(root+path.sep),'repair_evidence_path');return file;
}
function point(payload,pointer){
  check(typeof pointer==='string'&&(pointer===''||pointer.startsWith('/')),'repair_capture_pointer');
  let row=payload;
  for(const token of pointer===''?[]:pointer.slice(1).split('/')){
    check(!/~(?![01])/u.test(token),'repair_capture_pointer');const key=token.replaceAll('~1','/').replaceAll('~0','~');
    check(!['__proto__','constructor','prototype'].includes(key)&&row&&typeof row==='object'&&Object.hasOwn(row,key),'repair_capture_pointer');row=row[key];
  }
  check(plain(row),'repair_capture_pointer');return row;
}
function checkSource(source,pin,identity){
  check(plain(source)&&source.id===pin.sourceId&&source.storedName===pin.storedName&&source.sourceType==='material_center'
    &&source.materialCenterAssetId===pin.assetId&&source.materialCenterObjectKey===pin.objectKey&&source.size===pin.size,'repair_source_identity');
  check(missingCategory(source),'repair_source_category_not_missing');
  check([undefined,null,'',PRODUCT].includes(source.materialCenterCategory),'repair_source_category_conflict');
  check(!blocked(source)&&!hasLegacyVersionConflict(source)&&source.visibility!=='private'&&canReadSource(source,identity),'repair_source_unavailable');
  check(source.contentSha256==null||source.contentSha256===pin.sha256,'repair_source_hash_conflict');
}
function jobScope(job,executorId){
  check(plain(job)&&job.id===PILOT_CATEGORY_REPAIR_JOB_ID&&job.createdById===executorId&&job.productCategory===PRODUCT
    &&!job.archivedAt&&!blocked(job),'repair_job_authority');
  // Manual reimport is allowed while paused. Never change status, nextRunAt,
  // targets, attempts, source limits, review quota or scheduling state.
  return {id:job.id,createdById:job.createdById,productCategory:job.productCategory,archivedAt:job.archivedAt??null};
}

/** Private grant schema (never accepted from a request body):
 * {schema:PILOT_CATEGORY_REPAIR_SCHEMA,purpose:PILOT_CATEGORY_REPAIR_PURPOSE,
 *  authorizationId,jobId:PILOT_CATEGORY_REPAIR_JOB_ID,executorId,authorizedAt,
 *  contentApproval:false,commercialApproval:false,preparationPermissionGranted:false,
 *  sources:[exactly the three pinned rows, each with all pin fields plus
 *    sourceEvidence:{file,sha256,pointer},
 *    capture:{method:'GET',endpointPath,status:200,capturedAt,payloadFile,payloadSha256,assetPointer},
 *    databaseEvidence:{file,sha256,pointer},databaseReadAt}]}.
 * Evidence files retain original bytes; pointers select the original source /
 * upload DB row. Hashes authenticate consistency, NOT fabricated provenance.
 * Root must review and deploy this grant from genuine authorized evidence.
 */
export async function readPilotSourceCategoryRepairGrant(grantFile){
  check(typeof grantFile==='string'&&path.isAbsolute(grantFile),'repair_grant_path');
  const raw=await readSafe(grantFile),grant=JSON.parse(raw),root=path.dirname(path.resolve(grantFile));
  check(plain(grant)&&grant.schema===PILOT_CATEGORY_REPAIR_SCHEMA&&grant.purpose===PILOT_CATEGORY_REPAIR_PURPOSE
    &&text(grant.authorizationId)&&grant.jobId===PILOT_CATEGORY_REPAIR_JOB_ID&&text(grant.executorId)&&date(grant.authorizedAt)
    &&grant.contentApproval===false&&grant.commercialApproval===false&&grant.preparationPermissionGranted===false
    &&!['approved','reviewStatus','skuVersion','productCode','product_id'].some(k=>Object.hasOwn(grant,k))
    &&Array.isArray(grant.sources)&&grant.sources.length===3,'repair_grant_invalid');
  const rows=new Map(),evidenceHashes=[];
  async function evidence(descriptor){
    check(plain(descriptor)&&hex(descriptor.sha256),'repair_evidence_descriptor');
    const file=childFile(root,descriptor.file),bytes=await readSafe(file);check(sha(bytes)===descriptor.sha256,'repair_evidence_hash');
    evidenceHashes.push({file:descriptor.file,sha256:descriptor.sha256});return point(JSON.parse(bytes),descriptor.pointer);
  }
  for(const row of grant.sources){
    const pin=PILOT_CATEGORY_REPAIR_PINS.find(p=>p.sourceId===row?.sourceId);
    check(pin&&!rows.has(pin.sourceId)&&Object.keys(pin).every(k=>row[k]===pin[k]),'repair_grant_scope');
    const originalSource=await evidence(row.sourceEvidence);checkSource(originalSource,pin,{id:grant.executorId});
    const capture=row.capture;
    check(plain(capture)&&capture.method==='GET'&&capture.status===200&&date(capture.capturedAt)
      &&capture.endpointPath===`/api/workstation/assets/${pin.assetId}`&&Date.parse(capture.capturedAt)<=Date.parse(grant.authorizedAt),'repair_capture_invalid');
    const asset=await evidence({file:capture.payloadFile,sha256:capture.payloadSha256,pointer:capture.assetPointer});
    const safeAsset=currentUploadPreparationMetadata(asset,pin.assetId).asset;
    check(safeAsset.object_key===pin.objectKey&&safeAsset.size===pin.size,'repair_capture_identity');
    const db=await evidence(row.databaseEvidence);
    check(plain(db)&&date(row.databaseReadAt)&&Date.parse(row.databaseReadAt)<=Date.parse(grant.authorizedAt)
      &&db.id===pin.assetId&&db.object_key===pin.objectKey&&db.size===pin.size&&db.category===PRODUCT
      &&db.library_type==='source'&&db.asset_scope==='marketing_video'&&db.source==='oa_upload'&&db.ingest_source==='oa_upload'
      &&text(db.uploaded_by_number)&&db.uploaded_by_name===asset.uploaded_by_name&&date(db.modified_at)
      &&Object.hasOwn(db,'deleted_at')&&db.deleted_at===null&&Object.hasOwn(db,'purged_at')&&db.purged_at===null
      &&!blocked(db)&&!hasLegacyVersionConflict(db)&&![ 'approved','rejected','changes_requested','revoked','blocked','deleted','purged','已批准','已拒绝','已删除'].includes(db.status),'repair_database_upload_invalid');
    rows.set(pin.sourceId,{pin,originalSource,safeAsset});
  }
  return {grant,rows,sha256:sha(raw),evidenceDigest:digest(evidenceHashes)};
}

async function snapshot(directory,record){
  check(typeof directory==='string'&&path.isAbsolute(directory)&&path.dirname(directory)!==directory,'repair_snapshot_directory');
  // Verify the existing ancestor chain before mkdir so a parent symlink cannot
  // redirect creation. This is a private service-configured evidence directory.
  let ancestor=directory;
  while(true){try{await fs.lstat(ancestor);break;}catch(error){if(error.code!=='ENOENT')throw error;ancestor=path.dirname(ancestor);}}
  await noLinks(ancestor);await fs.mkdir(directory,{recursive:true,mode:0o700});await noLinks(directory);
  const bytes=Buffer.from(canonical(record)+'\n'),hash=sha(bytes),file=path.join(directory,hash+'.json');
  const temporary=path.join(directory,'.snapshot-'+randomUUID()+'.tmp');
  const handle=await fs.open(temporary,'wx',0o600);
  try{await handle.writeFile(bytes);await handle.sync();}finally{await handle.close();}
  try{await fs.link(temporary,file);}catch(error){if(error.code!=='EEXIST')throw error;}
  finally{await fs.unlink(temporary);}
  check(sha(await readSafe(file))===hash,'repair_snapshot_conflict');
  return {file:hash+'.json',sha256:hash};
}

/** Integration contract:
 * begin BEFORE ensureLinkedSourceOnDisk; finish immediately AFTER, before any
 * existing materialCenter metadata refresh. No download/model/ASR occurs here.
 * readCurrentAsset must use fresh getAsset(id,{requireUploadPreparationMetadata:true}).
 * readMedia must securely stream the current original and return {sha256,size}.
 * commitCategory must call apply(currentSource,currentJob) inside ONE library
 * transaction. apply is synchronous, performs final raw-row/job CAS and writes
 * ONLY productCategory. Never expose this callback / ticket over HTTP.
 */
export function createPilotSourceCategoryRepair({grantFile,evidenceDirectory,readSource,readJob,readCurrentAsset,readMedia,commitCategory,now=()=>new Date().toISOString()}){
  for(const fn of [readSource,readJob,readCurrentAsset,readMedia,commitCategory,now])check(typeof fn==='function','repair_dependency_missing');
  const tickets=new WeakMap();
  const freshAsset=async(pin,source)=>{
    const asset=await readCurrentAsset(pin.assetId);validateCurrentUploadAsset(asset,source);
    return currentUploadPreparationMetadata(asset.preparationMetadata.asset,pin.assetId).asset;
  };
  return {
    async begin({sourceId,identity}){
      const pin=PILOT_CATEGORY_REPAIR_PINS.find(row=>row.sourceId===sourceId);if(!pin)return null;
      const source=clone(await readSource(sourceId));if(!missingCategory(source))return null;
      const authority=await readPilotSourceCategoryRepairGrant(grantFile);
      check(text(identity?.id)&&identity.id===authority.grant.executorId,'repair_executor_mismatch');
      checkSource(source,pin,identity);const row=authority.rows.get(sourceId);
      check(digest(source)===digest(row.originalSource),'repair_original_source_changed');
      const job=jobScope(await readJob(PILOT_CATEGORY_REPAIR_JOB_ID),identity.id);
      const asset=await freshAsset(pin,source);
      check(digest(asset)===digest(row.safeAsset),'repair_current_asset_changed');
      check(digest(await readSource(sourceId))===digest(source),'repair_source_cas');
      check(digest(jobScope(await readJob(PILOT_CATEGORY_REPAIR_JOB_ID),identity.id))===digest(job),'repair_job_cas');
      const before=await snapshot(evidenceDirectory,{schema:PILOT_CATEGORY_REPAIR_SCHEMA,purpose:PILOT_CATEGORY_REPAIR_PURPOSE,
        phase:'before_same_asset_restore',grantSha256:authority.sha256,grantEvidenceDigest:authority.evidenceDigest,
        executorId:identity.id,job,source,asset,contentApproval:false,commercialApproval:false,preparationPermissionGranted:false});
      const ticket=Object.freeze({sourceId});tickets.set(ticket,{pin,source,job,asset,before,authority,executorId:identity.id});return ticket;
    },
    async finish(ticket){
      if(ticket===null)return {status:'not_applicable',changed:false};
      check(ticket&&tickets.has(ticket),'repair_ticket_invalid');const state=tickets.get(ticket);tickets.delete(ticket);
      const {pin,source,job,asset,before,authority,executorId}=state;
      const stillCurrent=async()=>{
        const latest=await readSource(pin.sourceId);checkSource(latest,pin,{id:executorId});
        check(digest(latest)===digest(source),'repair_source_cas');
        check(digest(jobScope(await readJob(PILOT_CATEGORY_REPAIR_JOB_ID),executorId))===digest(job),'repair_job_cas');
        const current=await readPilotSourceCategoryRepairGrant(grantFile);
        check(current.sha256===authority.sha256&&current.evidenceDigest===authority.evidenceDigest,'repair_grant_changed');
        check(sha(await readSafe(childFile(path.resolve(evidenceDirectory),before.file)))===before.sha256,'repair_snapshot_changed');
      };
      await stillCurrent();
      const media=await readMedia(clone(source));check(media?.sha256===pin.sha256&&media.size===pin.size,'repair_media_mismatch');
      check(digest(await freshAsset(pin,source))===digest(asset),'repair_current_asset_changed');
      await stillCurrent();
      const checkedAt=now();check(date(checkedAt),'repair_clock_invalid');
      const receipt=await snapshot(evidenceDirectory,{schema:PILOT_CATEGORY_REPAIR_SCHEMA,purpose:PILOT_CATEGORY_REPAIR_PURPOSE,
        phase:'ready_for_category_cas',checkedAt,sourceId:pin.sourceId,assetId:pin.assetId,job,executorId,
        sourceSha256:media.sha256,size:media.size,sourceSnapshot:before,grantSha256:authority.sha256,
        fromCategoryState:Object.hasOwn(source,'productCategory')?'null':'absent',toCategory:PRODUCT,
        contentApproval:false,commercialApproval:false,preparationPermissionGranted:false});
      await stillCurrent();
      const finalMedia=await readMedia(clone(source));
      check(finalMedia?.sha256===pin.sha256&&finalMedia.size===pin.size,'repair_media_mismatch');
      await stillCurrent();let applied=false;
      const committed=await commitCategory({sourceId:pin.sourceId,jobId:PILOT_CATEGORY_REPAIR_JOB_ID,
        apply(currentSource,currentJob){
          check(!applied,'repair_commit_repeated');checkSource(currentSource,pin,{id:executorId});
          check(digest(currentSource)===digest(source),'repair_source_cas');
          check(digest(jobScope(currentJob,executorId))===digest(job),'repair_job_cas');
          currentSource.productCategory=PRODUCT;applied=true;return clone(currentSource);
        }});
      check(applied&&digest(committed)===digest({...source,productCategory:PRODUCT}),'repair_commit_contract');
      const completion=await snapshot(evidenceDirectory,{schema:PILOT_CATEGORY_REPAIR_SCHEMA,purpose:PILOT_CATEGORY_REPAIR_PURPOSE,
        phase:'category_synchronized',receipt,sourceId:pin.sourceId,committedSourceSha256:digest(committed),
        contentApproval:false,commercialApproval:false,preparationPermissionGranted:false});
      return {status:'category_synchronized',changed:true,sourceId:pin.sourceId,productCategory:PRODUCT,receipt:completion,
        contentApproval:false,commercialApproval:false,preparationPermissionGranted:false,modelCalls:0,asrCalls:0};
    },
  };
}
