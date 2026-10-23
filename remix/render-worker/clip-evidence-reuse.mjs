const validSha=value=>typeof value==='string'&&/^[a-f0-9]{64}$/u.test(value);
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)
  &&[Object.prototype,null].includes(Object.getPrototypeOf(value));
const close=(a,b)=>Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=1e-6;
function canonical(value){
  if(value===null||typeof value==='string'||typeof value==='boolean')return value;
  if(typeof value==='number'&&Number.isFinite(value))return value;
  if(Array.isArray(value))return value.map(canonical);
  if(plain(value))return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])]));
  throw Error('non_json_evidence');
}
const same=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
const deny=reason=>({reusable:false,reason});
const rangeValid=record=>Number.isFinite(record?.startSeconds)&&record.startSeconds>=0
  &&Number.isFinite(record.endSeconds)&&record.endSeconds>record.startSeconds
  &&Number.isFinite(record.durationSeconds)&&record.durationSeconds>0
  &&close(record.durationSeconds,record.endSeconds-record.startSeconds);
const snapshot=(clip,segment)=>JSON.stringify(canonical({
  clip:Object.fromEntries(['id','sourceId','storedName','contentSha256','startSeconds','endSeconds','durationSeconds','boundaryEvidence']
    .map(key=>[key,clip?.[key]??null])),
  segment:Object.fromEntries(['id','startSeconds','endSeconds','durationSeconds','boundaryEvidence']
    .map(key=>[key,segment?.[key]??null])),
}));

/** Decide whether existing clip BYTES can be reused for an already-verified ASR
 * segment. This helper grants no source, segment or commercial approval and
 * performs no writes. The caller validates the segment's real source/ASR proof,
 * rejects blocked clips BEFORE calling, and enforces current permissions/CAS.
 *
 * hashClip(clip) must hash the actual existing file, not echo metadata. A false
 * result means a non-keyed candidate needs a fresh cut, retaining the old row.
 * An importIdempotencyKey collision is handled by the caller: conflicting
 * evidence must block, never silently create another clip under the same key.
 */
export async function assessAsrClipReuse({clip,segment,hashClip}={}){
  if(!plain(clip))return deny('clip_missing');
  if(!plain(segment)||!plain(segment.boundaryEvidence)||!Object.keys(segment.boundaryEvidence).length)
    return deny('segment_boundary_missing');
  if(!validSha(clip.contentSha256))return deny('clip_hash_missing');
  if(!plain(clip.boundaryEvidence)||!Object.keys(clip.boundaryEvidence).length)return deny('clip_boundary_missing');
  if(typeof segment.boundaryEvidence.sourceId!=='string'||!segment.boundaryEvidence.sourceId
    ||clip.sourceId!==segment.boundaryEvidence.sourceId)return deny('clip_source_mismatch');
  if(!rangeValid(clip)||!rangeValid(segment)||!['startSeconds','endSeconds','durationSeconds'].every(key=>close(clip[key],segment[key])))
    return deny('clip_range_mismatch');
  let frozen;
  try{
    if(!same(clip.boundaryEvidence,segment.boundaryEvidence))return deny('clip_boundary_mismatch');
    frozen=snapshot(clip,segment);
  }catch{return deny('clip_evidence_invalid');}
  if(typeof hashClip!=='function')return deny('clip_hash_unavailable');
  let actual;
  try{actual=await hashClip(clip);}catch{return deny('clip_file_unavailable');}
  try{if(snapshot(clip,segment)!==frozen)return deny('clip_evidence_changed');}
  catch{return deny('clip_evidence_changed');}
  if(!validSha(actual))return deny('clip_hash_unavailable');
  if(actual!==clip.contentSha256)return deny('clip_file_changed');
  return {reusable:true,reason:null};
}
