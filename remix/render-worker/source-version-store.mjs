import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {validateSourceVersionEvidence,toSkuContext,resolveExactVersion} from './product-version-contract.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const requireValue=(ok,reason)=>{if(!ok)throw Error(reason);};
const validSha=value=>typeof value==='string'&&/^[a-f0-9]{64}$/u.test(value);
const validId=value=>typeof value==='string'&&value.length>0&&value.length<=256&&value.trim()===value&&!/[\x00-\x1f/\\]/u.test(value);
const same=(a,b)=>a.dev===b.dev&&a.ino===b.ino&&a.size===b.size&&a.mtimeMs===b.mtimeMs&&a.ctimeMs===b.ctimeMs;
async function unlinked(file){let current=file;while(true){const st=await fs.lstat(current);requireValue(!st.isSymbolicLink(),'version_store_link');const parent=path.dirname(current);if(parent===current)return;current=parent;}}
async function readFile(file,maxBytes){
 await unlinked(file);const before=await fs.lstat(file);
 requireValue(before.isFile()&&before.size>0&&before.size<=maxBytes,'version_store_file');
 const handle=await fs.open(file,'r');
 try{
  // Check the opened inode before reading, not only the pathname afterwards.
  // A path swapped to a symlink between lstat and open must not expose bytes.
  const opened=await handle.stat();requireValue(opened.isFile()&&same(before,opened),'version_store_changed');
  const bytes=await handle.readFile(),after=await handle.stat();await unlinked(file);
  const current=await fs.lstat(file);
  requireValue(bytes.length<=maxBytes&&same(before,after)&&same(before,current)&&!current.isSymbolicLink(),'version_store_changed');
  return bytes;
 }finally{await handle.close();}
}
function inside(root,relative){requireValue(typeof relative==='string'&&relative.length>0&&!path.isAbsolute(relative)
 &&!/[\0\r\n:]/u.test(relative)&&!relative.startsWith('\\')&&!relative.split(/[\\/]/u).includes('..'),'version_store_path');
 const file=path.resolve(root,relative);requireValue(file.startsWith(root+path.sep),'version_store_path');return file;}

async function registry(root){
 let raw;
 try{raw=await readFile(path.join(root,'manifest.json'),8*1024*1024);}
 catch(error){if(error.code==='ENOENT')return null;throw error;}
 const manifest=JSON.parse(raw);
 requireValue(manifest&&manifest.schema==='wis-product-version-registry-v1'&&Array.isArray(manifest.bindings)&&manifest.bindings.length<=10000
  &&manifest.bindings.every(binding=>binding&&typeof binding==='object'&&!Array.isArray(binding)&&validId(binding.sourceId))
  &&Array.isArray(manifest.references)&&manifest.references.length<=32&&Array.isArray(manifest.images)&&manifest.images.length<=2000,'version_store_manifest');
 requireValue(new Set(manifest.bindings.map(x=>x.sourceId)).size===manifest.bindings.length,'version_store_duplicate_source');
 return {raw,manifest,registrySha256:sha(raw)};
}

const candidateBinding=binding=>{
 const version=resolveExactVersion(binding?.skuVersion);
 return Boolean(version&&binding.skuVersion===version.skuVersion&&binding.schema==='wis-source-version-binding-v1'
  &&binding.productCategory===version.productCategory&&binding.status==='verified'&&binding.revoked!==true&&!binding.revokedAt
  &&validId(binding.id)&&validId(binding.verifiedBy)&&typeof binding.verifiedAt==='string'&&Number.isFinite(Date.parse(binding.verifiedAt))
  &&[binding.sourceSha256,binding.profileSha256,binding.referenceSetSha256,binding.reviewReceiptSha256].every(validSha)
  &&Array.isArray(binding.referenceImageIds)&&binding.referenceImageIds.length>0&&binding.referenceImageIds.every(validId)
  &&new Set(binding.referenceImageIds).size===binding.referenceImageIds.length);
};

// This registry lives in a deployment-owned private directory, not the upload
// tree. No HTTP payload can create a verified binding or select an evidence path.
export function createSourceVersionResolver(directory){
 requireValue(typeof directory==='string'&&path.isAbsolute(directory)&&!directory.startsWith('\\\\')&&!directory.startsWith('//')
  &&!/[\0\r\n]/u.test(directory)&&!directory.split(/[\\/]/u).includes('..'),'version_store_root');
 const root=path.resolve(directory);
 const resolve=async ({source,actualSourceSha256})=>{
  if(source?.productCategory!=='黑晶面膜')return {ready:false,reason:'product_not_managed'};
  const current=await registry(root);
  if(!current)return {ready:false,reason:'source_version_catalog_missing'};
  const {raw,manifest}=current;
  const binding=manifest.bindings.find(x=>x.sourceId===source.id);
  if(!binding)return {ready:false,reason:'source_version_unbound'};
  const version=resolveExactVersion(binding.skuVersion);
  requireValue(version&&binding.skuVersion===version.skuVersion,'version_store_unknown_sku');
  const references=manifest.references.filter(x=>x.skuVersion===binding.skuVersion);
  requireValue(references.length===1,'version_store_reference');
  const reference=references[0];
  const consumed=new Map();
  const readEvidence=async(file,maxBytes)=>{const bytes=await readFile(file,maxBytes);consumed.set(file,{maxBytes,sha256:sha(bytes)});return bytes;};
  const referenceBytes=await readEvidence(inside(root,reference.snapshotFile),4*1024*1024);
  requireValue(sha(referenceBytes)===reference.snapshotSha256,'version_reference_bytes_changed');
  const document=JSON.parse(referenceBytes).data?.document;
  requireValue(document?.document_id===reference.documentId&&document?.revision_id===reference.documentRevision,'version_reference_revision_changed');
  const receiptBytes=await readEvidence(inside(root,binding.receiptFile),1024*1024);
  requireValue(sha(receiptBytes)===binding.reviewReceiptSha256,'version_binding_receipt_changed');
  const receipt=JSON.parse(receiptBytes);
  requireValue(receipt.schema==='wis-source-version-verification-v1'&&receipt.decision==='verified'&&
   receipt.revoked!==true&&!receipt.revokedAt&&
   ['sourceId','sourceSha256','skuVersion','profileSha256','referenceSetSha256','verifiedBy','verifiedAt'].every(key=>receipt[key]===binding[key])&&
   typeof receipt.basis==='string'&&receipt.basis.trim().length>0,'version_binding_receipt_invalid');
  const images=[];
  for(const id of binding.referenceImageIds||[]){
   const matching=manifest.images.filter(x=>x.id===id);requireValue(matching.length===1,'version_image_missing');
   const image=matching[0],filePath=inside(root,image.filePath),bytes=await readEvidence(filePath,4*1024*1024);
   requireValue(sha(bytes)===image.sha256,'version_image_bytes_changed');images.push({...image,filePath});
  }
  // The initial assignment is sourced solely from the checked private receipt.
  // A different existing version/hash is a conflict, not an automatic migration.
  const candidate={...source,contentSha256:source.contentSha256??actualSourceSha256,skuVersion:source.skuVersion??binding.skuVersion};
  const result=validateSourceVersionEvidence({source:candidate,actualSourceSha256,trustedBinding:binding,currentReference:reference,referenceImages:images});
  // Deployment-owned evidence files are immutable; replacing the manifest is
  // the publication boundary. Also reject drift in previously consumed files
  // during this resolve, before exposing an initially verified context.
  for(const [file,{maxBytes,sha256}] of consumed)requireValue(sha(await readFile(file,maxBytes))===sha256,'version_evidence_changed');
  requireValue(sha(await readFile(path.join(root,'manifest.json'),8*1024*1024))===sha(raw),'version_registry_changed');
  return {...result,skuContext:toSkuContext(result),registrySha256:sha(raw)};
 };
 // Enumeration is only a bounded scheduling hint. No source media, formal
 // reference, image, or verification receipt is read or approved here. Every
 // selected source must still pass resolve() and the complete review pipeline.
 resolve.candidateSourceIds=async()=>{
  const current=await registry(root);
  if(!current)return {registrySha256:null,sourceIds:[],bindingKeysBySourceId:{}};
  const candidates=current.manifest.bindings.filter(candidateBinding).filter(binding=>{
   try{inside(root,binding.receiptFile);return true;}catch{return false;}
  });
  return {registrySha256:current.registrySha256,sourceIds:candidates.map(binding=>binding.sourceId),
   bindingKeysBySourceId:Object.fromEntries(candidates.map(binding=>[binding.sourceId,binding.reviewReceiptSha256]))};
 };
 return resolve;
}
