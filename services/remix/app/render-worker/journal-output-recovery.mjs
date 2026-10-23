import fs from 'node:fs/promises';
import path from 'node:path';
import {registrationDigest} from './render-registration-journal.mjs';
import {basicVariantPassed} from './basic-automatic-review.mjs';
import {outputBinding} from './output-review-binding.mjs';
import {clipBytesSequence,sourceIntervalSequence,recordOutputSequence,usedJobSequences} from './output-sequence-dedup.mjs';
import {recoverySourceUnavailable} from './reserved-output-recovery.mjs';
import {createReadonlyInputResolver} from './recovery-input-resolver.mjs';

export const JOURNAL_RECOVERY_VERSION='per-output-journal-v1';
const requireFact=(value,message)=>{if(!value)throw new Error(`Journal recovery blocked: ${message}`);};
const safeName=name=>typeof name==='string'&&name.length>0&&!/[\\/]/.test(name)&&name.endsWith('.mp4');
export const journalContext=(job,run)=>registrationDigest({jobId:job.id,owner:job.createdById,product:job.productCategory,framework:job.frameworkId,
  runId:run.id,target:run.targetCount,duration:run.targetDurationSeconds,selections:run.slotSelections,delivery:job.qianchuanDelivery,autoReturn:job.autoReturnAfterApproval});
export const journalRunState=(job,run)=>registrationDigest([journalContext(job,run),job.status,job.archivedAt,job.nextRunAt,run.status,run.resumeRequestedAt,run.automaticReviewHold]);

// Every check is repeated inside the eventual serialized/CAS library update.
// The receipt contains the original review; replay never creates a new PASS.
export function inspectJournalRecovery(library,jobId,runId,records,canRecover=()=>true){
  const job=library.autoJobs.find(row=>row.id===jobId),run=job?.runs?.find(row=>row.id===runId);
  requireFact(job&&run&&job.status==='active'&&!job.archivedAt&&canRecover(library,job)
    &&['queued','preparing','generating','repairing','awaiting_review'].includes(run.status),'owner/run is no longer authorized');
  const state=usedJobSequences(library,jobId),items=new Map();
  for(const record of records){
    const render=record.render;
    requireFact(record.schemaVersion===1&&record.kind==='render-registration-journal'&&record.renderSha256===registrationDigest(render),'receipt integrity');
    if(render.automation?.jobId!==jobId||render.automation?.runId!==runId)continue;
    requireFact(render.createdById===job.createdById&&render.productCategory===job.productCategory&&render.templateId===job.frameworkId&&render.visibility==='team'
      &&render.registrationContext===journalContext(job,run),'original job binding changed');
    for(const variant of render.variants){
      const key=`${render.id}/${variant.id}`,prior=items.get(key);
      requireFact(!prior||registrationDigest(prior.variant)===registrationDigest(variant),'conflicting receipts');
      const reservation=state.reservations.find(row=>row.renderId===render.id&&row.variantId===variant.id&&row.runId===runId);
      requireFact(reservation&&reservation.key===variant.contentSequenceIdentity?.key,'original reservation missing');
      const existingRender=library.renders.find(row=>row.id===render.id),existing=existingRender?.variants.find(row=>row.id===variant.id);
      if(existing){requireFact(reservation.status==='recorded'&&existing.contentSha256===variant.contentSha256&&existing.contentSequenceIdentity?.key===reservation.key,'existing registration differs');
        requireFact(existingRender.recoveryRegistration?.effectsBlocked===true&&run.status==='awaiting_review'&&run.automaticReviewHold?.reason==='RECOVERY_REGISTRATION_ONLY'&&!run.resumeRequestedAt&&job.nextRunAt===null,'existing recovery hold removed');continue;}
      requireFact(reservation.status==='reserved'&&basicVariantPassed(variant),'no original complete basic approval');
      requireFact(safeName(variant.storedName)&&variant.storedName===`${render.id}-${variant.id}.mp4`,'unsafe output path');
      const clips=(variant.clipSequence||[]).map(id=>library.clips.find(row=>row.id===id));
      requireFact(clips.length>0&&clips.every(Boolean)&&new Set(clips.map(row=>row.id)).size===clips.length,'original cuts missing/repeated');
      const allowed=new Set(Object.values(run.slotSelections||{}).flat());
      requireFact(clips.every(clip=>{const source=library.sources.find(row=>row.id===clip.sourceId);return allowed.has(clip.id)&&!recoverySourceUnavailable(clip)&&!recoverySourceUnavailable(source)
        &&clip.reviewStatus==='approved'&&clip.visibility!=='private'&&source.visibility!=='private'&&safeName(clip.storedName)&&[job.productCategory,'通用切片'].includes(clip.productCategory||source.productCategory);}), 'source approval/access changed');
      const current=outputBinding(clips,library.sources,job.productCategory);
      requireFact(current.content===variant.generationBinding?.content&&current.content===variant.reviewBinding?.content&&current.review===variant.reviewBinding?.review,'current content/review binding changed');
      requireFact(variant.basicInputFiles?.length===clips.length&&clips.every(clip=>variant.basicInputFiles.filter(row=>row.clipId===clip.id&&/^[a-f0-9]{64}$/.test(row.sha256||'')).length===1),'input hash evidence missing');
      const sequence=reservation.version==='clip-bytes-duration-v1'
        ?clipBytesSequence(clips.map(clip=>({...clip,contentSha256:variant.basicInputFiles.find(row=>row.clipId===clip.id).sha256})))
        :sourceIntervalSequence(clips,library.sources);
      requireFact(sequence?.key===reservation.key,'original byte sequence changed');
      requireFact(!library.renders.some(row=>row.variants.some(v=>v.contentSha256===variant.contentSha256)),'output registered under another identity');
      requireFact(![...items.entries()].some(([otherKey,item])=>otherKey!==key&&item.variant.contentSha256===variant.contentSha256),'receipt repeats another output');
      items.set(key,{render,variant,clips,reservation});
    }
  }
  return {job,run,library,items:[...items.values()]};
}

export async function verifyJournalFiles(plan,{outputsDir,clipsDir,playbackDir,hashFile,stat=file=>fs.lstat(file,{bigint:true})}){
  const fingerprints=[];
  const resolveInput=createReadonlyInputResolver({clipsDir,playbackDir,library:plan.library});
  const verify=async(file,sha)=>{const before=await stat(file),signature=value=>[value.dev,value.ino,value.size,value.mtimeNs??value.mtimeMs,value.ctimeNs??value.ctimeMs].join(':');
    requireFact(before.isFile()&&!before.isSymbolicLink(),'media is not a regular file');
    requireFact(await hashFile(file)===sha,'media bytes changed');
    requireFact(signature(await stat(file))===signature(before),'media changed during verification');fingerprints.push({file,signature:signature(before)});};
  for(const item of plan.items){await verify(path.join(outputsDir,item.variant.storedName),item.variant.contentSha256);
    for(const clip of item.clips){const expected=item.variant.basicInputFiles.find(row=>row.clipId===clip.id).sha256,cacheFile=item.variant.recoveredInputs?.find(row=>row.clipId===clip.id)?.cacheFile;
      const resolved=await resolveInput(clip,{expectedHashes:[expected],cacheFile});await verify(resolved.file,expected);}}
  return {fingerprints,assertUnchanged:async()=>{for(const row of fingerprints){const value=await stat(row.file);requireFact([value.dev,value.ino,value.size,value.mtimeNs??value.mtimeMs,value.ctimeNs??value.ctimeMs].join(':')===row.signature,'media changed before commit');}}};
}

export function applyJournalRecovery(library,jobId,runId,records,canRecover,at){
  const next=structuredClone(library),plan=inspectJournalRecovery(next,jobId,runId,records,canRecover);
  if(!plan.items.length)return {library:next,changed:0};
  const priorNextRunAt=plan.job.nextRunAt??null;
  for(const item of plan.items){
    let render=next.renders.find(row=>row.id===item.render.id);
    if(!render){render={...structuredClone(item.render),variants:[],recoveryRegistration:{version:JOURNAL_RECOVERY_VERSION,effectsBlocked:true,registeredAt:at,priorNextRunAt}};delete render.registrationContext;next.renders.unshift(render);}
    requireFact(render.automation?.jobId===jobId&&render.automation?.runId===runId&&render.createdById===plan.job.createdById,'existing render identity changed');
    // If one item was committed earlier, quarantine the render before appending.
    render.recoveryRegistration={...(render.recoveryRegistration||{priorNextRunAt}),version:JOURNAL_RECOVERY_VERSION,effectsBlocked:true,registeredAt:at};
    render.variants.push(structuredClone(item.variant));
    recordOutputSequence(next,{jobId,runId,renderId:render.id,variantId:item.variant.id,sequence:item.variant.contentSequenceIdentity,at});
    plan.run.renderIds=[...new Set([...(plan.run.renderIds||[]),render.id])];
  }
  plan.run.generatedCount=next.renders.filter(row=>row.automation?.jobId===jobId&&row.automation?.runId===runId).reduce((sum,row)=>sum+row.variants.length,0);
  plan.run.status='awaiting_review';plan.run.errorMessage='已从原审核凭证自动恢复成片登记；回传、投放和继续生成保持隔离，待确认。';
  plan.run.automaticReviewHold={kind:'recovery_registration',reason:'RECOVERY_REGISTRATION_ONLY',summary:plan.run.errorMessage,createdAt:at,checkedAt:at};
  delete plan.run.resumeRequestedAt;plan.job.nextRunAt=null;
  for(const stage of plan.run.stageReports||[])if(['remix_generation','output_review'].includes(stage.key)){stage.status='blocked';stage.summary=plan.run.errorMessage;stage.lastProgressAt=at;}
  return {library:next,changed:plan.items.length};
}
