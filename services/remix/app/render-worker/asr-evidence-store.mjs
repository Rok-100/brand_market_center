import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {LOCAL_ASR_PROVIDER, LOCAL_ASR_FILES, LOCAL_MODEL_FILES, modelFingerprint} from './local-asr-evidence.mjs';
const hash=x=>createHash('sha256').update(x).digest('hex');
const requireValue=(ok,why)=>{if(!ok)throw Error(why);};
const fileNames=['source.json','transcript.srt','receipts.json','frames.json'];
async function regularBytes(file,maxBytes){
 const before=await fs.lstat(file);requireValue(before.isFile()&&!before.isSymbolicLink()&&before.size<=maxBytes,'invalid_asr_evidence_file');
 const data=await fs.readFile(file),after=await fs.lstat(file);
 requireValue(after.isFile()&&before.dev===after.dev&&before.ino===after.ino&&before.size===after.size&&before.mtimeMs===after.mtimeMs,'asr_evidence_changed_during_read');return data;
}
async function regularHash(file) {
 const before=await fs.lstat(file);requireValue(before.isFile()&&!before.isSymbolicLink(),'invalid_local_model_file');
 const digest=createHash('sha256');for await(const chunk of createReadStream(file))digest.update(chunk);
 const after=await fs.lstat(file);requireValue(after.isFile()&&!after.isSymbolicLink()&&before.dev===after.dev&&
  before.ino===after.ino&&before.size===after.size&&before.mtimeMs===after.mtimeMs,'local_model_changed_during_read');
 return {sha256:digest.digest('hex'),size:after.size};
}
async function localPathIsUnlinked(value) {
 requireValue(typeof value==='string'&&path.isAbsolute(value),'local_model_allowlist_path_invalid');
 let current=path.resolve(value);
 while(true){const info=await fs.lstat(current);requireValue(!info.isSymbolicLink(),'local_model_link_not_allowed');
  const parent=path.dirname(current);if(parent===current)return;current=parent;}
}
async function verifyLocalModels(receipt, {localModelDirectories,localVadModelFiles}) {
 requireValue(Array.isArray(localModelDirectories)&&localModelDirectories.length>0&&localModelDirectories.length<=8&&
  Array.isArray(localVadModelFiles)&&localVadModelFiles.length>0&&localVadModelFiles.length<=8,'local_model_allowlist_missing');
 let verified;
 // Configured server-owned paths only. receipt.model.directory and VAD path are
 // informational and are never followed or treated as filesystem authority.
 for(const directory of localModelDirectories){
  await localPathIsUnlinked(directory);
  const files={};for(const name of LOCAL_MODEL_FILES)files[name]=await regularHash(path.join(directory,name));
  const fingerprintSha256=modelFingerprint(files);
  if(fingerprintSha256===receipt.model?.fingerprintSha256){verified={files,fingerprintSha256};break;}
 }
 requireValue(verified,'local_model_not_allowlisted');
 let vad;
 for(const file of localVadModelFiles){await localPathIsUnlinked(file);const candidate=await regularHash(file);
  if(candidate.sha256===receipt.engine?.vadModel?.sha256){vad=candidate;break;}}
 requireValue(vad,'local_vad_not_allowlisted');
 const producer=await regularHash(fileURLToPath(new URL('./local-asr-producer.py',import.meta.url)));
 return {...verified,vadSha256:vad.sha256,vadSize:vad.size,producerSha256:producer.sha256};
}
// Only the server-owned private evidence directory is read. No HTTP request can
// supply an evidence path, trusted flag, SKU proof or provider receipt.
export function createAsrEvidenceResolver(directory, {localModelDirectories=[],localVadModelFiles=[]}={}){
 return async ({sourceId,productCategory})=>{
  let info;try{info=await fs.lstat(directory);}catch(e){if(e.code==='ENOENT')return null;throw e;}
  requireValue(info.isDirectory()&&!info.isSymbolicLink(),'invalid_asr_evidence_directory');
  const manifestBytes=await regularBytes(path.join(directory,'manifest.json'),1024*1024),manifest=JSON.parse(manifestBytes);
  requireValue(manifest.schema==='wis-authorized-asr-v1'&&Array.isArray(manifest.sources)&&manifest.sources.length<=1000,'invalid_asr_evidence_manifest');
  const ids=new Set();for(const entry of manifest.sources){requireValue(/^[a-f0-9-]{36}$/i.test(entry.sourceId||'')&&!ids.has(entry.sourceId),'invalid_asr_source_identity');ids.add(entry.sourceId);}
  const item=manifest.sources.find(entry=>entry.sourceId===sourceId);if(!item)return null;
  requireValue(item.provider===undefined||item.provider==='feishu_minutes_srt'||item.provider===LOCAL_ASR_PROVIDER,'unsupported_asr_provider');
  const local=item.provider===LOCAL_ASR_PROVIDER, names=local?LOCAL_ASR_FILES:fileNames;
  requireValue(item.productCategory===productCategory,'asr_store_product_mismatch');
  requireValue(/^[a-f0-9]{64}$/.test(item.bundleSha256||''),'invalid_asr_bundle_hash');
  const folder=path.join(directory,item.sourceId,item.bundleSha256);
  for(const p of [path.join(directory,item.sourceId),folder]){const st=await fs.lstat(p);requireValue(st.isDirectory()&&!st.isSymbolicLink(),'invalid_asr_bundle_directory');}
  requireValue(Object.keys(item.files||{}).sort().join('|')===[...names].sort().join('|'),'invalid_asr_bundle_files');
  const limits={'frames.json':8*1024*1024,'audio.wav':128*1024*1024,'transcript.json':16*1024*1024,
   'ffprobe.frames.json':64*1024*1024,'ffprobe.media.json':2*1024*1024,'ffprobe.audio.json':64*1024*1024};
  const bytes={};for(const name of names){requireValue(/^[a-f0-9]{64}$/.test(item.files[name]||''),'invalid_asr_file_sha');bytes[name]=await regularBytes(path.join(folder,name),limits[name]||2*1024*1024);requireValue(hash(bytes[name])===item.files[name],'asr_store_sha_mismatch');}
  requireValue(hash(JSON.stringify(names.map(name=>[name,item.files[name]])))===item.bundleSha256,'asr_store_bundle_mismatch');
  requireValue(hash(await regularBytes(path.join(directory,'manifest.json'),1024*1024))===hash(manifestBytes),'asr_manifest_changed_during_read');
  const source=JSON.parse(bytes['source.json']);requireValue(source.id===sourceId&&source.productCategory===productCategory,'asr_source_record_mismatch');
  if(local){
   requireValue(source.provider===LOCAL_ASR_PROVIDER,'local_asr_provider_mismatch');
   const receipts=JSON.parse(bytes['receipt.json']);
   const modelVerification=await verifyLocalModels(receipts,{localModelDirectories,localVadModelFiles});
   requireValue(hash(await regularBytes(path.join(directory,'manifest.json'),1024*1024))===hash(manifestBytes),'asr_manifest_changed_during_read');
   return {source,srtBytes:bytes['transcript.srt'],receipts,frameMap:JSON.parse(bytes['frames.json']),localFiles:bytes,modelVerification};
  }
  requireValue(source.provider===undefined||source.provider==='feishu_minutes_srt','asr_source_provider_mismatch');
  return {source,srtBytes:bytes['transcript.srt'],receipts:JSON.parse(bytes['receipts.json']),frameMap:JSON.parse(bytes['frames.json'])};
 };
}
