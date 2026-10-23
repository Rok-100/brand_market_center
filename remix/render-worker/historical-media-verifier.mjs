// Actual current bytes for the narrow existing-approved-inventory protocol.
// No model calls, approval writes, source hash backfill or request-owned paths.
import fs from 'node:fs/promises';
import path from 'node:path';
import {HISTORICAL_INVENTORY_MODE,HISTORICAL_INVENTORY_JOB,HISTORICAL_REFERENCE_SHA256,
 validateHistoricalReuseSnapshot} from './historical-approved-inventory.mjs';
const fail=(reason)=>Object.assign(new Error('历史切片本次复用尚未核验：'+reason),{
 code:'SOURCE_EVIDENCE_MISSING',admission:{reason}});
const sameStat=(a,b)=>['dev','ino','size','mtimeMs','ctimeMs'].every(k=>a[k]===b[k]);
const safeName=name=>typeof name==='string'&&name===path.basename(name)&&name!=='.'&&name!=='..'&&!/[\\/\x00-\x1f]/u.test(name);

export function createHistoricalMediaVerifier({inventory,clipsDir,playbackRecovery,hashFile,inspectMedia,
 canReadSource,canReadClip,readLibrary}) {
 if(inventory?.mode!==HISTORICAL_INVENTORY_MODE||inventory.referenceSha256!==HISTORICAL_REFERENCE_SHA256
   ||typeof inventory.assess!=='function'||!path.isAbsolute(clipsDir)||typeof hashFile!=='function'
   ||typeof inspectMedia!=='function'||typeof readLibrary!=='function')throw fail('historical_verifier_configuration');
 return async function verify({clips,library,automationContext,previousEvidence,assertCurrent,existingOutputContext}){
  if(automationContext?.jobId!==HISTORICAL_INVENTORY_JOB||automationContext.createdById!=='FD-026222'
    ||!Array.isArray(clips)||!clips.length||new Set(clips.map(c=>c?.id)).size!==clips.length
    ||typeof assertCurrent!=='function')throw fail('historical_verifier_scope');
  const allowed=async()=>{if(await assertCurrent()!==true)throw fail('automation_stopped');};
  // Freeze selection metadata before any asynchronous media work. Otherwise an
  // in-memory edit during inspection could become its own "before" snapshot.
  const frozenLibrary=structuredClone(library),frozenClips=structuredClone(clips);
  await allowed();
  const identity={id:automationContext.createdById},job=frozenLibrary?.autoJobs?.find(j=>j.id===automationContext.jobId);
  if(!job||job.status!=='active'||job.archivedAt)throw fail('automation_stopped');
  const evidence=[],resolvedInputs=[],mediaById=new Map();
  const sources=new Map((frozenLibrary.sources||[]).map(s=>[s.id,s]));
  for(const clip of frozenClips){
   await allowed();const source=sources.get(clip?.sourceId);
   if(!source||!safeName(clip?.storedName)||!canReadSource(source,identity)||!canReadClip(clip,source,identity))throw fail('current_permission_unavailable');
   let filePath=path.join(clipsDir,clip.storedName),origin='original-clip',recovered;
   try{await fs.lstat(filePath);}catch(error){
    if(error.code!=='ENOENT')throw error;
    if(typeof playbackRecovery?.clip!=='function')throw fail('historical_media_unavailable');
    // Existing recovery checks the linked Cloud object and exact original range.
    recovered=await playbackRecovery.clip({clip,source,identity,purpose:'render'});
    if(typeof recovered?.path!=='string'||!path.isAbsolute(recovered.path))throw fail('historical_recovery_path');
    filePath=recovered.path;origin=recovered.kind||'reconstructed-render-input';
   }
   await allowed();
   const before=await fs.lstat(filePath);
   if(!before.isFile()||before.isSymbolicLink())throw fail('current_clip_media_unverified');
   const sha256=await hashFile(filePath),probe=await inspectMedia(filePath),after=await fs.lstat(filePath);
   if(!sameStat(before,after)||recovered?.sha256&&recovered.sha256!==sha256)throw fail('current_clip_file_changed');
   const media={regularFile:true,symlink:false,sha256,size:after.size,durationSeconds:probe.duration,hasAudio:probe.hasAudio};
   const result=inventory.assess({clip,source,media,job,identity,canReadSource,canReadClip,existingOutputContext});
   if(!result.eligible)throw fail(result.reason);
   evidence.push(result);mediaById.set(clip.id,media);
   resolvedInputs.push({clipId:clip.id,path:filePath,kind:origin,sha256,size:after.size});
  }
  await allowed();
  // Recheck current metadata/ACL, not only the frozen render input objects.
  const latest=await readLibrary(),liveJob=latest.autoJobs?.find(j=>j.id===job.id);
  for(const previous of evidence){
   const clip=latest.clips?.find(c=>c.id===previous.clipId),source=latest.sources?.find(s=>s.id===clip?.sourceId);
   const current=inventory.assess({clip,source,media:mediaById.get(previous.clipId),job:liveJob,identity,canReadSource,canReadClip,existingOutputContext});
   const verified=validateHistoricalReuseSnapshot({previous,current,job:liveJob,identity,existingOutputContext});
   if(!verified.valid)throw fail(verified.reason);
  }
  if(previousEvidence){
   const previous=Array.isArray(previousEvidence)?previousEvidence:previousEvidence.evidence;
   if(!Array.isArray(previous)||previous.length!==evidence.length)throw fail('reuse_snapshot_changed');
   for(let i=0;i<evidence.length;i++){
    const check=validateHistoricalReuseSnapshot({previous:previous[i],current:evidence[i],job:liveJob,identity,existingOutputContext});
    if(!check.valid)throw fail(check.reason);
   }
  }
  await allowed();
  return {mode:HISTORICAL_INVENTORY_MODE,referenceSha256:HISTORICAL_REFERENCE_SHA256,evidence,resolvedInputs,
   // These paths are ephemeral server inputs; only evidence belongs in a receipt.
   approvalGranted:false,modelCalls:0};
 };
}
