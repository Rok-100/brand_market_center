import {createHash} from 'node:crypto';
import {BASIC_REVIEW_POLICY, BASIC_REVIEW_MODE, BASIC_OUTPUT_CHECKS, basicVariantPassed} from './basic-automatic-review.mjs';
import {clipBytesSequence, recordOutputSequence} from './output-sequence-dedup.mjs';
import {outputBinding} from './output-review-binding.mjs';

export const RECOVERY_VERSION = 'reserved-outputs-20261007-v1';
export const RECOVERY_TARGETS = Object.freeze([
  {jobId:'fe2be1e0-ab4d-4d42-91cb-6e8f9ff764ed',runId:'82621cb7-fece-45a7-98b4-bfe0e490d01c',renderId:'de290190-34d4-4d89-ad4a-061e8886f00b',variantId:'1'},
  {jobId:'5667412d-93cc-47fd-82ad-3870b4796f08',runId:'e44a2aec-ef52-4605-ad06-419d666a00c8',renderId:'e444ea22-dc9d-41bb-8bec-0f3551565dda',variantId:'1'},
  {jobId:'5667412d-93cc-47fd-82ad-3870b4796f08',runId:'e44a2aec-ef52-4605-ad06-419d666a00c8',renderId:'e444ea22-dc9d-41bb-8bec-0f3551565dda',variantId:'2'},
]);
export const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const targetKey = target => `${target.renderId}/${target.variantId}`;
const fail = (code, message) => Object.assign(new Error(message), {code});
const requireFact = (fact, code, message) => {if (!fact) throw fail(code, message);};
export const recoverySourceUnavailable = row => !row || row.revoked===true || row.revokedAt || row.disabled===true || row.deliveryBlocked===true || row.deleted===true || row.deletedAt;
const presets = {
  'hook-pain-solution-proof-cta':['hook','pain','solution','proof','cta'],
  'benefit-solution-demo-proof-urgency':['benefit','solution','demo','proof','urgency'],
};
function targetContext(job, run) {
  return digest({jobId:job.id,owner:job.createdById,product:job.productCategory,framework:job.frameworkId,
    status:job.status,archivedAt:job.archivedAt||null,runId:run.id,target:run.targetCount,duration:run.targetDurationSeconds,
    selections:run.slotSelections,delivery:job.qianchuanDelivery,autoReturn:job.autoReturnAfterApproval,
    runStatus:run.status,resumeRequestedAt:run.resumeRequestedAt||null,hold:run.automaticReviewHold});
}

// Reconstruction is strictly the original reserved *bytes* sequence. It never
// guesses a new combination, expands the source pool, or releases a reservation.
export function inspectRecoveryTarget(library, target, {measuredHashes={},resolvedInputs={}}={}) {
  requireFact(RECOVERY_TARGETS.some(row=>targetKey(row)===targetKey(target)&&row.jobId===target.jobId&&row.runId===target.runId), 'OUT_OF_SCOPE', 'Recovery target is not in the three-file allowlist');
  const job=library.autoJobs.find(row=>row.id===target.jobId),run=job?.runs?.find(row=>row.id===target.runId);
  requireFact(job&&run&&job.status==='active'&&!job.archivedAt&&job.createdById, 'JOB_CHANGED', 'Original job/run is unavailable or paused');
  const records=job.sequenceReservations?.filter(row=>row.renderId===target.renderId&&row.variantId===target.variantId&&row.runId===target.runId)||[];
  requireFact(records.length===1, 'RESERVATION_MISSING', 'Original reservation is missing or ambiguous');
  const reservation=records[0],existingRender=library.renders.find(row=>row.id===target.renderId),existing=existingRender?.variants?.find(row=>row.id===target.variantId);
  if(existing){
    requireFact(reservation.status==='recorded'&&existing.contentSequenceIdentity?.key===reservation.key,'REGISTRATION_CONFLICT','Existing registration does not match reservation');
    requireFact(existingRender.recoveryRegistration?.version===RECOVERY_VERSION&&existingRender.recoveryRegistration?.effectsBlocked===true&&run.status==='awaiting_review'&&run.automaticReviewHold?.reason==='RECOVERY_REGISTRATION_ONLY'&&!run.resumeRequestedAt&&job.nextRunAt===null,'REGISTRATION_CONFLICT','Existing recovery no longer has its explicit effects hold');
    return {target,status:'already_registered',existing,reservation};
  }
  requireFact(run.status==='awaiting_review'&&!run.resumeRequestedAt&&['OUTPUT_SEQUENCE_PENDING','RECOVERY_REGISTRATION_ONLY'].includes(run.automaticReviewHold?.reason),'RUN_CHANGED','Original run is not held; a running or resumed run cannot be replaced');
  requireFact(reservation.status==='reserved'&&reservation.version==='clip-bytes-duration-v1','RESERVATION_CHANGED','Only the original pending byte-sequence reservation is supported');
  const allowed=new Set(Object.values(run.slotSelections||{}).flat());
  const clips=reservation.intervals.map(([sha,start,end])=>{
    requireFact(start===0&&Number.isFinite(end)&&end>0,'SEQUENCE_INVALID','Reserved interval is not a complete original cut');
    const matches=library.clips.filter(clip=>allowed.has(clip.id)&&(clip.contentSha256||measuredHashes[clip.id])?.toLowerCase()===sha.toLowerCase()&&clip.durationSeconds===end);
    requireFact(matches.length===1,'SOURCE_AMBIGUOUS',`Cannot uniquely reconstruct reserved cut ${sha.slice(0,12)} (matches=${matches.length}, duration=${end})`);
    const clip=matches[0],source=library.sources.find(row=>row.id===clip.sourceId);
    requireFact(!recoverySourceUnavailable(source)&&!recoverySourceUnavailable(clip)&&clip.reviewStatus==='approved'&&clip.visibility!=='private'&&source.visibility!=='private','SOURCE_NOT_APPROVED','Original cut no longer has usable approval');
    requireFact([job.productCategory,'通用切片'].includes(clip.productCategory||source.productCategory),'SOURCE_PRODUCT_CHANGED','Cut product no longer matches the original job');
    requireFact(typeof clip.storedName==='string'&&!/[\\/]/.test(clip.storedName)&&clip.storedName.endsWith('.mp4'),'UNSAFE_FILE','Cut file name is invalid');
    return clip;
  });
  requireFact(new Set(clips.map(row=>row.id)).size===clips.length,'REPEATED_CUT','Reserved sequence repeats a cut');
  const inputHashes=Object.fromEntries(clips.map(clip=>[clip.id,clip.contentSha256||measuredHashes[clip.id]]));
  const sequence=clipBytesSequence(clips.map(clip=>({...clip,contentSha256:inputHashes[clip.id]})));
  requireFact(sequence?.key===reservation.key,'SEQUENCE_CHANGED','Reconstructed byte sequence does not match the reservation');
  const slots=library.frameworks?.find(row=>row.id===job.frameworkId)?.slots?.map(slot=>slot.id)||presets[job.frameworkId];
  requireFact(slots?.length,'FRAMEWORK_MISSING','Original framework cannot be reconstructed');
  const slotMapping={};
  for(const slot of slots){const matching=clips.filter(clip=>(run.slotSelections?.[slot]||[]).includes(clip.id));requireFact(matching.length,'FRAMEWORK_INCOMPLETE',`Original slot ${slot} has no matching cut`);slotMapping[slot]=matching[0].id;}
  requireFact((run.slotSelections?.[slots[0]]||[]).includes(clips[0].id),'OPENER_CHANGED','Reserved first cut no longer matches the opener');
  for(const clip of clips)requireFact(!resolvedInputs[clip.id]?.cacheFile||/^[a-f0-9]{64}\.mp4$/.test(resolvedInputs[clip.id].cacheFile),'UNSAFE_FILE','Unsafe cached input locator');
  return {target,status:'pending_local_review',job,run,reservation,clips,slotMapping,inputHashes,resolvedInputs,sequence,
    contextDigest:targetContext(job,run),binding:outputBinding(clips,library.sources,job.productCategory),
    storedName:`${target.renderId}-${target.variantId}.mp4`};
}

export function buildRecoveryVariant(plan, evidence, at) {
  requireFact(evidence?.fullDecode===true&&evidence.sequenceMatches===true&&evidence.audioMatches===true,'MEDIA_REVIEW_FAILED','Complete local audiovisual verification did not pass');
  const values={
    '文件可播放':evidence.fullDecode,
    '竖版规格':evidence.width===1080&&evidence.height===1920,
    '音轨':evidence.hasAudio===true,
    '时长完整':Math.abs(evidence.duration-plan.clips.reduce((sum,row)=>sum+row.durationSeconds,0))<=1.2,
    '黑屏占比':Number.isFinite(evidence.blackSeconds)&&evidence.blackSeconds<=Math.max(2,evidence.duration*.2),
    '目标时长':Math.abs(evidence.duration-plan.run.targetDurationSeconds)<=Math.max(3,plan.run.targetDurationSeconds*.08),
    '静音占比':Number.isFinite(evidence.silenceSeconds)&&evidence.silenceSeconds<=Math.max(3,evidence.duration*.35),
    '框架完整度':true,
    '重复成片':evidence.duplicate===false,
    '切片不重复':true,
    '产品分类一致':true,
  };
  requireFact(BASIC_OUTPUT_CHECKS.every(name=>values[name]===true),'BASIC_REVIEW_FAILED','Local basic checks did not all pass');
  requireFact(/^[a-f0-9]{64}$/.test(evidence.sha256||''),'HASH_MISSING','Output hash is missing');
  const checks=BASIC_OUTPUT_CHECKS.map(name=>({name,passed:values[name],detail:'原文件本地恢复核验'}));
  return {id:plan.target.variantId,storedName:plan.storedName,outputName:`${plan.job.name}-恢复-${plan.target.variantId}.mp4`,
    clipSequence:plan.clips.map(row=>row.id),slotMapping:plan.slotMapping,contentSha256:evidence.sha256,
    contentSequenceIdentity:plan.sequence,generationBinding:plan.binding,reviewBinding:plan.binding,
    actualDurationSeconds:evidence.duration,targetDurationSeconds:plan.run.targetDurationSeconds,
    basicInputFiles:plan.clips.map(row=>({clipId:row.id,sha256:plan.inputHashes[row.id],...(plan.resolvedInputs?.[row.id]?.cacheFile?{cacheFile:plan.resolvedInputs[row.id].cacheFile}: {})})),
    automaticAssessment:{status:'passed',recommendation:'approve',score:100,mode:'basic_rules',ruleVersion:BASIC_REVIEW_POLICY,
      outputSha256:evidence.sha256,autoApproved:true,checks,reasons:[],suggestions:[],assessedAt:at},
    reviewMode:BASIC_REVIEW_MODE,reviewStatus:'approved',reviewNote:'原文件经新的本地基础核验恢复登记；未调用内容模型，未回传或投放。',reviewedAt:at,
    createdAt:plan.reservation.createdAt,recoveryReview:{version:RECOVERY_VERSION,checkedAt:at,evidence}};
}

// Caller supplies a fresh authoritative library and verifies all media bytes
// again before a single CAS commit. No notifications or delivery are enqueued.
export function applyRecoveryReceipt(library, receipt, at) {
  requireFact(receipt?.version===RECOVERY_VERSION&&receipt.items?.length===RECOVERY_TARGETS.length,'RECEIPT_INVALID','Three-file recovery receipt is incomplete');
  const next=structuredClone(library),seen=new Set();let changed=0;
  for(const item of receipt.items){const plan=inspectRecoveryTarget(library,item.target,{measuredHashes:Object.fromEntries((item.variant?.basicInputFiles||[]).map(row=>[row.clipId,row.sha256]))});
    if(plan.status!=='already_registered')requireFact(item.contextDigest===plan.contextDigest,'STALE_RECEIPT','Job or original run state changed after local review');}
  for(const item of receipt.items){
    const key=targetKey(item.target);requireFact(!seen.has(key),'RECEIPT_INVALID','Duplicate recovery target');seen.add(key);
    const plan=inspectRecoveryTarget(next,item.target,{measuredHashes:Object.fromEntries((item.variant?.basicInputFiles||[]).map(row=>[row.clipId,row.sha256])),resolvedInputs:Object.fromEntries((item.variant?.basicInputFiles||[]).map(row=>[row.clipId,row]))});
    if(plan.status==='already_registered'){
      requireFact(plan.existing.contentSha256===item.variant?.contentSha256,'REGISTRATION_CONFLICT','Existing output hash differs');continue;
    }
    requireFact(item.binding?.content===plan.binding.content&&item.binding?.review===plan.binding.review,'STALE_RECEIPT','Source metadata changed after local review');
    const rebuilt=buildRecoveryVariant(plan,item.variant?.recoveryReview?.evidence,item.variant?.reviewedAt);
    requireFact(digest(rebuilt)===digest(item.variant)&&basicVariantPassed(item.variant),'RECEIPT_INVALID','Recovery assessment or metadata is inconsistent');
    requireFact(!next.renders.some(render=>render.variants?.some(variant=>variant.contentSha256===item.variant.contentSha256)),'DUPLICATE_OUTPUT','The same file is already registered elsewhere');
    let render=next.renders.find(row=>row.id===item.target.renderId);
    if(!render){render={id:item.target.renderId,requestKey:null,visibility:'team',name:plan.job.name,templateId:plan.job.frameworkId,
      generationMode:'automatic',createdById:plan.job.createdById,createdByName:plan.job.createdByName||'',productCategory:plan.job.productCategory,
      targetDurationSeconds:plan.run.targetDurationSeconds,automation:{jobId:plan.job.id,runId:plan.run.id},createdAt:plan.reservation.createdAt,
      variants:[],recoveryRegistration:{version:RECOVERY_VERSION,effectsBlocked:true,registeredAt:at,priorNextRunAt:plan.job.nextRunAt??null}};next.renders.unshift(render);}
    requireFact(render.automation?.jobId===plan.job.id&&render.automation?.runId===plan.run.id&&render.recoveryRegistration?.effectsBlocked===true,'REGISTRATION_CONFLICT','Render is not an isolated recovery registration');
    render.variants.push(structuredClone(item.variant));
    recordOutputSequence(next,{...item.target,sequence:item.variant.contentSequenceIdentity,at});
    plan.run.renderIds=[...new Set([...(plan.run.renderIds||[]),render.id])];
    plan.run.generatedCount=next.renders.filter(row=>row.automation?.jobId===plan.job.id&&row.automation?.runId===plan.run.id).reduce((sum,row)=>sum+row.variants.length,0);
    plan.run.status='awaiting_review';plan.run.errorMessage='原成片已恢复登记；继续执行、回传和投放保持待确认。';
    plan.run.automaticReviewHold={kind:'recovery_registration',reason:'RECOVERY_REGISTRATION_ONLY',summary:plan.run.errorMessage,createdAt:at,checkedAt:at};
    delete plan.run.resumeRequestedAt;plan.job.nextRunAt=null;
    for(const stage of plan.run.stageReports||[])if(['remix_generation','output_review'].includes(stage.key)){stage.status='blocked';stage.summary=plan.run.errorMessage;stage.lastProgressAt=at;}
    changed++;
  }
  return {library:next,changed};
}

export async function commitRecoveryRegistration({readAuthority,writeAuthority,backup,receipt,now=()=>new Date().toISOString()}) {
  const current=await readAuthority(),result=applyRecoveryReceipt(current.data,receipt,now());
  if(!result.changed)return {status:'already_registered',changed:0,version:current.version,delivery:false};
  await backup(current);
  // Exactly one CAS attempt. Neither a conflict nor an unknown response is
  // retried. A later invocation reads back first and proves idempotency.
  const saved=await writeAuthority(current.version,result.library);
  const after=await readAuthority();
  if(applyRecoveryReceipt(after.data,receipt,now()).changed!==0)throw new Error('Recovery readback is incomplete; do not retry blindly');
  return {status:'registered_held',changed:result.changed,version:saved.version,readbackVersion:after.version,delivery:false};
}
