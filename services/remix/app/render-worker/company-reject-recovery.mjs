// A company's current rejection is a negative decision, never a new approval.
// The exclusions live on the original job; source/clip approval rows stay intact.
import {createHash} from 'node:crypto';
import {canReadSource,canReadClip,clipIsBlocked} from './asset-access.mjs';

export const COMPANY_RECOVERY_JOB='a5fdb74d-a2a1-4cf0-affe-d9bbfaf30354';
export const COMPANY_RECOVERY_VERSION=1;
const sha=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const canonical=value=>value===undefined?null:Array.isArray(value)?value.map(canonical):value&&typeof value==='object'
  ?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const digest=value=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const integer=value=>Number.isSafeInteger(value)&&value>=0;
const nonempty=value=>typeof value==='string'&&value.length>0&&value.length<=200;
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const validExclusion=row=>row&&nonempty(row.sourceId)&&sha(row.receiptKey)
  &&(row.kind==='source'||row.kind==='clip_range'&&nonempty(row.clipId)&&finite(row.startSeconds)&&finite(row.endSeconds)
    &&row.startSeconds>=0&&row.endSeconds>row.startSeconds);
const validRecovery=state=>state&&state.version===COMPANY_RECOVERY_VERSION&&Array.isArray(state.receipts)&&Array.isArray(state.exclusions)
  &&state.exclusions.every(validExclusion)&&state.receipts.every(row=>sha(row.key)&&nonempty(row.taskId)&&integer(row.resultRevision));
const reviewKey=review=>digest([review.task_id,review.requested_revision,review.file_hash]);

// Negative, job-local reuse decisions only. No transcript is created/corrected,
// and this comparison is never an approval or an ASR prerequisite. The one
// lexical equivalence below is the actually rejected pore-size sentence, not
// a general synonym/efficacy classifier; negations and all numbers are retained.
export const normalizeCompanyAvoidanceText=value=>String(value||'').normalize('NFKC').toLowerCase()
  .replace(/[\s\p{P}\p{S}]+/gu,'').replace(/毛孔(?:感觉)?都?变小了/gu,'毛孔变小了');
const phraseClauses=value=>String(value||'').split(/[，,。！？!?；;\n]+/u)
  .map(normalizeCompanyAvoidanceText).filter(value=>(value.length>=6||value==='毛孔变小了')&&value.length<=120);
const overlaps=(a,b)=>finite(a?.startSeconds)&&finite(a?.endSeconds)&&finite(b?.startSeconds)&&finite(b?.endSeconds)
  &&a.startSeconds<b.endSeconds&&a.endSeconds>b.startSeconds;
const existingSpeech=source=>(Array.isArray(source?.speechSegments)?source.speechSegments:[]).filter(segment=>
  nonempty(segment.id)&&typeof segment.label==='string'&&['cutter','ocr','faster-whisper','manual'].includes(segment.transcriptSource)
  &&finite(segment.startSeconds)&&finite(segment.endSeconds)&&segment.endSeconds>segment.startSeconds);

function appendCompanyTextAvoidance({library,job,render,variant,review,key}){
  const state=job.companyRejectRecovery;
  if(!validRecovery(state)||review.findings_complete===false)return false;
  const sources=new Map((library.sources||[]).map(source=>[source.id,source]));
  const clips=new Map((library.clips||[]).map(clip=>[clip.id,clip]));
  const identity={id:job.createdById},readable=clip=>{
    const source=sources.get(clip?.sourceId);
    return Boolean(clip&&source&&canReadSource(source,identity)&&canReadClip(clip,source,identity));
  };
  const seeds=[];
  // Localize each finding using the same already-verified output timeline. A
  // missing/ambiguous finding cannot establish cross-source text equivalence.
  for(const finding of review.findings||[]){
    if(finding?.tier!=='red'||finding.shadow!==false||finding.rule_code==='R1'||typeof finding.evidence!=='string')continue;
    const localized=inspectCompanyReview({job:{...job,companyRejectRecovery:undefined},render,variant,
      review:{...review,findings:[finding]}});
    if(!localized.accepted||localized.mappingReason)continue;
    const evidenceText=normalizeCompanyAvoidanceText(finding.evidence);
    for(const exclusion of localized.exclusions){
      const origin=clips.get(exclusion.clipId),source=sources.get(origin?.sourceId);
      if(!readable(origin))continue;
      for(const segment of existingSpeech(source).filter(segment=>overlaps(origin,segment))){
        for(const phrase of phraseClauses(segment.label))if(evidenceText.includes(phrase))seeds.push({phrase,ruleCode:finding.rule_code,
          originSourceId:source.id,originSegmentId:segment.id,originLabelSha256:digest(segment.label),
          originTranscriptSource:segment.transcriptSource,originAnalysisUpdatedAt:source.analysisUpdatedAt||null});
      }
    }
  }
  let changed=false;
  for(const clip of clips.values()){
    if(!readable(clip))continue;
    const source=sources.get(clip.sourceId);
    for(const segment of existingSpeech(source).filter(segment=>overlaps(clip,segment))){
      const clauses=new Set(phraseClauses(segment.label));
      for(const seed of seeds){
        if(!clauses.has(seed.phrase)||state.exclusions.some(row=>row.receiptKey===key&&row.sourceId===clip.sourceId
          &&(row.kind==='source'||row.clipId===clip.id&&row.startSeconds===clip.startSeconds&&row.endSeconds===clip.endSeconds)))continue;
        state.exclusions.push({kind:'clip_range',sourceId:clip.sourceId,clipId:clip.id,startSeconds:clip.startSeconds,endSeconds:clip.endSeconds,
          receiptKey:key,ruleCode:seed.ruleCode,textEvidence:{mode:'company_rejected_phrase_v1',...seed,
            matchedSegmentId:segment.id,matchedStartSeconds:segment.startSeconds,matchedEndSeconds:segment.endSeconds,
            matchedLabelSha256:digest(segment.label),matchedTranscriptSource:segment.transcriptSource,
            matchedAnalysisUpdatedAt:source.analysisUpdatedAt||null}});changed=true;
      }
    }
  }
  return changed;
}

export const COMPANY_EXHAUSTION_VERSION='company-rejected-exhausted-v1';
export const COMPANY_TERMINAL_EXHAUSTION_VERSION='company-terminal-exhausted-v1';
export const COMPANY_ABANDONED_DRAFT_EXHAUSTION_VERSION='company-terminal-with-abandoned-drafts-v1';
const ABANDONED_DRAFT_RUN='91267275-95ff-46ca-bda5-f6c2ebc01e40';
// These two owner-scoped, never-returned R6 drafts stay unapproved. Raw JSON
// fingerprints are from the stable 2026-10-04T06:58:44.833Z read-only capture.
const abandonedDraftPins=new Map([
  ['a26f83a0-628c-452a-b4f1-5c92f8a78e1c',{outputSha256:'83c6e0c73e37732d35ecfa9f472df25b332297e80bad7bcb6c65511a5fdda9f1',
    renderFingerprint:'6f00d32fb80a7ba2aa9e798f5bbd9aeec76ac719224f5708cafe3d91f99cf612',
    variantFingerprint:'8f63921069eb0520c6d89b94b3d6cbb919f61bf8a1b0590a87cc7785d392d09c',
    assessmentFingerprint:'10a7b54be054a02a907917ce1e394cfde38068d004792db89000e89aeeb9c188',
    generationBindingFingerprint:'34dead048db02b88e31481c71a02f201033eeb44cc1d1244cc3c81e86dd8edfb',
    reviewBindingFingerprint:'34dead048db02b88e31481c71a02f201033eeb44cc1d1244cc3c81e86dd8edfb'}],
  ['81e93f28-62ed-48a3-8e64-b5928fad7e10',{outputSha256:'a41df96088d85d9a8a646290d50ddf0dc42370aba442f7d859b6a615e94c2286',
    renderFingerprint:'b80e742cf984cefae22f929a10c91cdd48618a7be2810e53694973445acf75c6',
    variantFingerprint:'71d6b9c04196bdecb11176d017e49c43ab5b683e5b6db6d3a9d1b6a4a3d60bb4',
    assessmentFingerprint:'08507e4116d8ea11c7bc4c092c56a261f6b32f4b748e59df697d4018b58f8fb4',
    generationBindingFingerprint:'ff51aa53f5156e96ad5b754d40c79e225443412bd310d3c30d86a45aa4d285ab',
    reviewBindingFingerprint:'ff51aa53f5156e96ad5b754d40c79e225443412bd310d3c30d86a45aa4d285ab'}],
]);
const rawJsonDigest=value=>createHash('sha256').update(JSON.stringify(value??null)).digest('hex');
function abandonedDraftOutput(render,variant){
  const pin=abandonedDraftPins.get(render.id),assessment=variant.automaticAssessment;
  if(!pin||variant.id!=='1'||render.variants.length!==1||render.automation?.runId!==ABANDONED_DRAFT_RUN
    ||render.automation?.jobId!==COMPANY_RECOVERY_JOB||Object.hasOwn(variant,'reviewMode')
    ||variant.reviewStatus!=='changes_requested'||variant.contentSha256!==pin.outputSha256
    ||assessment?.mode!=='rules_and_visual'||assessment.status!=='review_required'||assessment.autoApproved!==false
    ||assessment.visualReview?.status!=='review_required'||assessment.visualReview.reason!=='content_attention'
    ||!Array.isArray(assessment.checks)||assessment.checks.length!==17
    ||assessment.checks.filter(row=>row.passed===false).length!==1
    ||!assessment.checks.every(row=>row.name==='成片内容复核'?row.passed===false:row.passed===true)
    ||['materialCenterReturn','qianchuanDeliveries','qianchuanDelivery','companyReview','cloudDeliveryFeedback'].some(key=>Object.hasOwn(variant,key)))return null;
  const observed={renderFingerprint:rawJsonDigest(render),variantFingerprint:rawJsonDigest(variant),
    assessmentFingerprint:rawJsonDigest(assessment),generationBindingFingerprint:rawJsonDigest(variant.generationBinding),
    reviewBindingFingerprint:rawJsonDigest(variant.reviewBinding)};
  if(Object.entries(observed).some(([key,value])=>value!==pin[key]))return null;
  return {renderId:render.id,variantId:variant.id,outputSha256:variant.contentSha256,outcome:'abandoned_unapproved',...observed,
    originalEvidenceSha256:digest([assessment,variant.generationBinding,variant.reviewBinding,variant.historicalInventoryReview])};
}
function rejectedCompanyOutput(job,render,variant,{requireCurrent=false,allowRecordedRejectAge=false,now=Date.now()}={}){
  const saved=variant.companyReview,receipt=job.companyRejectRecovery.receipts.find(row=>row.key===saved?.receiptKey
    &&row.renderId===render.id&&row.variantId===variant.id&&row.runId===render.automation.runId);
  if(render.createdById!==job.createdById||variant.reviewMode!=='automatic_rules'||variant.reviewStatus!=='changes_requested'
    ||saved?.status!=='rejected'||!receipt||receipt.assetId!==variant.materialCenterReturn?.assetId
    ||receipt.outputSha256!==variant.contentSha256||saved.outputSha256!==variant.contentSha256
    ||saved.taskId!==receipt.taskId||saved.requestedRevision!==receipt.requestedRevision
    ||!inspectCompanyReview({job,render,variant,review:receipt.review}).accepted||receipt.review.verdict!=='reject')return null;
  if(requireCurrent){
    const feedback=variant.cloudDeliveryFeedback,live=feedback?.companyReview,verified=Date.parse(live?.last_verified_at);
    if(feedback?.errorMessage||!live||!Number.isFinite(verified)||verified>now||!allowRecordedRejectAge&&now-verified>600_000
      ||live.verdict!=='reject'||reviewKey(live)!==receipt.key||!inspectCompanyReview({job,render,variant,review:live}).accepted)return null;
    const states=[...(variant.qianchuanDeliveries||[]),...(variant.qianchuanDelivery?[variant.qianchuanDelivery]:[]),...(feedback.items||[])];
    if(states.some(state=>['pending','queued','running','processing','uploading','submitted','unknown','retrying'].includes(state.status)))return null;
  }
  return {renderId:render.id,variantId:variant.id,assetId:receipt.assetId,outputSha256:variant.contentSha256,
    receiptKey:receipt.key,taskId:receipt.taskId,requestedRevision:receipt.requestedRevision,
    originalEvidenceSha256:digest([variant.automaticAssessment,variant.generationBinding,variant.reviewBinding,variant.historicalInventoryReview])};
}
function exhaustedCompanyOutputs(library,job,run,{requireCurrent=false,now=Date.now()}={}){
  if(job?.id!==COMPANY_RECOVERY_JOB||job.createdById!=='FD-026222'||job.archivedAt||run?.targetCount!==2
    ||run.attemptedCount!==8||!validRecovery(job.companyRejectRecovery))return null;
  const renders=(library.renders||[]).filter(render=>render.automation?.jobId===job.id&&render.automation?.runId===run.id);
  const rows=renders.flatMap(render=>(render.variants||[]).map(variant=>({render,variant})));
  if(rows.length!==8||new Set(rows.map(({render,variant})=>render.id+':'+variant.id)).size!==8)return null;
  const outputs=[];
  for(const {render,variant} of rows){
    const output=rejectedCompanyOutput(job,render,variant,{requireCurrent,now});if(!output)return null;outputs.push(output);
  }
  return outputs.sort((a,b)=>(a.renderId+':'+a.variantId).localeCompare(b.renderId+':'+b.variantId));
}

// This is a terminal accounting predicate, not an approval or a delivery action.
// Only the exact pilot's one genuinely bound output plus seven company rejections
// can use this branch. Existing all-rejected markers retain their original format.
function mixedCompanyOutputs(library,job,run,{requireCurrent,now=Date.now(),allowAbandonedDrafts=false}){
  if(allowAbandonedDrafts&&(run?.id!==ABANDONED_DRAFT_RUN||run.generatedCount!==1||run.failedCount!==7))return null;
  if(job?.id!==COMPANY_RECOVERY_JOB||job.createdById!=='FD-026222'||job.archivedAt||withdrawn(job)
    ||(requireCurrent?job.status!=='active':!['active','paused'].includes(job.status))
    ||run?.targetCount!==2||run.targetDurationSeconds!==90||run.attemptedCount!==8
    ||!validRecovery(job.companyRejectRecovery)||!Array.isArray(job.sequenceReservations)
    ||requireCurrent&&job.sequenceReservations.some(row=>row.status==='reserved')||!Number.isFinite(now)
    ||!Array.isArray(library?.autoJobs)||library.autoJobs.filter(row=>row.id===job.id).length!==1
    ||library.autoJobs.find(row=>row.id===job.id)!==job||!Array.isArray(job.runs)
    ||job.runs.filter(row=>row.id===run.id).length!==1||!job.runs.includes(run))return null;
  const targets=job.qianchuanDelivery?.targets;
  if(job.qianchuanDelivery?.enabled!==true||job.qianchuanDelivery.confirmed!==true||!Array.isArray(targets)||targets.length!==1
    ||targets[0].advertiserId!=='1869672250595328'||targets[0].planId!=='1870289794646204'
    ||targets[0].planType&&targets[0].planType!=='multiplication')return null;
  const renders=(library.renders||[]).filter(render=>render.automation?.jobId===job.id&&render.automation?.runId===run.id);
  const rows=renders.flatMap(render=>(render.variants||[]).map(variant=>({render,variant})));
  if(rows.length!==8||new Set(rows.map(({render,variant})=>render.id+':'+variant.id)).size!==8
    ||new Set(renders.map(render=>render.id)).size!==renders.length||!Array.isArray(run.renderIds)
    ||new Set(run.renderIds).size!==run.renderIds.length||digest([...run.renderIds].sort())!==digest(renders.map(render=>render.id).sort()))return null;
  const outputs=[],files=new Set(),assets=new Set(),tasks=new Set(),sequences=new Set();let generatedCount=0,abandonedCount=0;
  for(const {render,variant} of rows){
    if(allowAbandonedDrafts&&abandonedDraftPins.has(render.id)){
      const output=abandonedDraftOutput(render,variant);
      if(!output||render.createdById!==job.createdById||withdrawn(render)||withdrawn(variant)||files.has(variant.contentSha256)
        ||!Array.isArray(variant.clipSequence)||!variant.clipSequence.length)return null;
      // Stopping delivery of this exact unapproved draft grants no right to use
      // its inputs. Its raw evidence is pinned; no source/clip readmission is
      // performed. The other six outputs retain all existing input checks.
      files.add(variant.contentSha256);outputs.push(output);abandonedCount++;continue;
    }
    const returned=variant.materialCenterReturn,sequence=variant.contentSequenceIdentity;
    if(render.createdById!==job.createdById||withdrawn(render)||withdrawn(variant)||variant.reviewMode!=='automatic_rules'
      ||!sha(variant.contentSha256)||files.has(variant.contentSha256)||returned?.status!=='completed'
      ||!integer(returned.assetId)||returned.assetId<1||assets.has(returned.assetId)
      ||returned.idempotencyKey!==`wis-remix:${render.id}:${variant.id}:${variant.contentSha256.slice(0,16)}`
      ||!nonempty(sequence?.version)||!sha(sequence?.key)||sequences.has(sequence.version+':'+sequence.key)
      ||!Array.isArray(variant.clipSequence)||!variant.clipSequence.length)return null;
    for(const id of variant.clipSequence){
      const clips=(library.clips||[]).filter(row=>row.id===id),clip=clips[0];
      const sources=(library.sources||[]).filter(row=>row.id===clip?.sourceId),source=sources[0];
      if(clips.length!==1||sources.length!==1||withdrawn(clip)||withdrawn(source)||clipIsBlocked(clip)
        ||clip.reviewStatus!=='approved'||source.reviewStatus==='rejected'||!canReadClip(clip,source,{id:job.createdById}))return null;
    }
    const allStates=[...(variant.qianchuanDeliveries||[]),...(variant.qianchuanDelivery?[variant.qianchuanDelivery]:[]),
      ...(variant.cloudDeliveryFeedback?.items||[])];
    if(allStates.some(state=>['pending','queued','running','processing','uploading','submitted','unknown','retrying'].includes(state?.status)))return null;
    let output;
    if(variant.reviewStatus==='changes_requested'){
      // A locked negative receipt is not a new approval. Keep all current
      // identity/status checks, but do not reopen it solely for polling age.
      output=rejectedCompanyOutput(job,render,variant,{requireCurrent:true,allowRecordedRejectAge:true,now});if(!output)return null;
      output={...output,outcome:'company_rejected'};
    }else{
      const saved=variant.companyReview,live=variant.cloudDeliveryFeedback?.companyReview;
      const original=saved?.review,inspection=inspectCompanyReview({job,render,variant,review:live});
      // Polling age alone never erases a recorded terminal fact. A newly pending,
      // missing, revoked, differently bound or failed response still cannot hide.
      if(variant.reviewStatus!=='approved'||saved?.status!=='passed'||variant.cloudDeliveryFeedback?.errorMessage
        ||!inspection.accepted||inspection.pass!==true||!inspectCompanyReview({job,render,variant,review:original}).pass
        ||saved.receiptKey!==reviewKey(live)||saved.receiptKey!==reviewKey(original)||saved.taskId!==live.task_id
        ||saved.requestedRevision!==live.requested_revision||saved.outputSha256!==variant.contentSha256
        ||['actor_number','render_id','variant_id','submission_id','job_id'].some(key=>live[key]!==original[key])
        ||requireCurrent&&!hasCurrentCompanyPass(variant,{now}))return null;
      const states=Array.isArray(variant.qianchuanDeliveries)&&variant.qianchuanDeliveries.length
        ?variant.qianchuanDeliveries:[variant.qianchuanDelivery].filter(Boolean),state=states[0];
      const key=`wis-remix:${render.id}:${variant.id}:${returned.assetId}:${targets[0].advertiserId}:${targets[0].planId}`;
      const boundAt=Date.parse(state?.bindingVerifiedAt);
      if(states.length!==1||state?.status!=='success'||state.idempotencyKey!==key||!nonempty(state.taskId)||!nonempty(state.platformAssetId)
        ||state.advertiserId!==targets[0].advertiserId||state.planId!==targets[0].planId
        ||state.planType&&state.planType!=='multiplication'||!Number.isFinite(boundAt)||boundAt>now)return null;
      const others=(library.renders||[]).flatMap(r=>(r.variants||[]).filter(v=>r.id!==render.id||v.id!==variant.id));
      if(others.some(v=>v.contentSha256===variant.contentSha256||v.materialCenterReturn?.assetId===returned.assetId
        ||v.contentSequenceIdentity?.version===sequence.version&&v.contentSequenceIdentity?.key===sequence.key
        ||[...(v.qianchuanDeliveries||[]),...(v.qianchuanDelivery?[v.qianchuanDelivery]:[])].some(s=>
          s.idempotencyKey===key||s.taskId===state.taskId||s.advertiserId===state.advertiserId&&s.platformAssetId===state.platformAssetId)))return null;
      output={renderId:render.id,variantId:variant.id,assetId:returned.assetId,outputSha256:variant.contentSha256,
        receiptKey:saved.receiptKey,taskId:saved.taskId,requestedRevision:saved.requestedRevision,
        originalEvidenceSha256:digest([variant.automaticAssessment,variant.generationBinding,variant.reviewBinding,variant.historicalInventoryReview]),
        outcome:'company_pass_bound',delivery:{idempotencyKey:key,taskId:state.taskId,platformAssetId:state.platformAssetId,
          advertiserId:state.advertiserId,planId:state.planId}};
      generatedCount++;
    }
    if(tasks.has(output.taskId))return null;
    files.add(variant.contentSha256);assets.add(returned.assetId);tasks.add(output.taskId);sequences.add(sequence.version+':'+sequence.key);outputs.push(output);
  }
  if(generatedCount!==1||allowAbandonedDrafts&&abandonedCount!==2)return null;
  return {outputs:outputs.sort((a,b)=>(a.renderId+':'+a.variantId).localeCompare(b.renderId+':'+b.variantId)),generatedCount,failedCount:7};
}

export function inspectMixedCompanyRunExhaustion({library,job,run,ownerAuthorized=false,now,variantRulesPassed}){
  const denied={eligible:false,reason:'mixed_company_terminal_evidence_incomplete'};
  if(ownerAuthorized!==true||typeof variantRulesPassed!=='function'||!['repairing','awaiting_review'].includes(run?.status)
    ||run.companyRepair?.required!==true||run.status==='awaiting_review'&&run.automaticReviewHold?.reason!=='PROGRESSIVE_RUN_ATTEMPT_LIMIT')return denied;
  try{
    const result=mixedCompanyOutputs(library,job,run,{requireCurrent:true,now:Date.parse(now)});if(!result)return denied;
    if(!result.outputs.every(row=>variantRulesPassed(library.renders.find(render=>render.id===row.renderId)
      ?.variants.find(variant=>variant.id===row.variantId))===true))return denied;
    return {eligible:true,...result};
  }catch{return denied;}
}

export function inspectAbandonedDraftRunExhaustion({library,job,run,ownerAuthorized=false,now,variantRulesPassed}){
  const denied={eligible:false,reason:'abandoned_draft_terminal_evidence_incomplete'};
  if(ownerAuthorized!==true||typeof variantRulesPassed!=='function'||!['repairing','awaiting_review'].includes(run?.status)
    ||run.companyRepair?.required!==true||run.status==='awaiting_review'&&run.automaticReviewHold?.reason!=='PROGRESSIVE_RUN_ATTEMPT_LIMIT')return denied;
  try{
    const result=mixedCompanyOutputs(library,job,run,{requireCurrent:true,now:Date.parse(now),allowAbandonedDrafts:true});
    if(!result||!result.outputs.filter(row=>row.outcome!=='abandoned_unapproved').every(row=>variantRulesPassed(
      library.renders.find(render=>render.id===row.renderId)?.variants.find(variant=>variant.id===row.variantId))===true))return denied;
    return {eligible:true,...result};
  }catch{return denied;}
}

export function isCompanyRunExhausted(library,job,run){
  if([COMPANY_TERMINAL_EXHAUSTION_VERSION,COMPANY_ABANDONED_DRAFT_EXHAUSTION_VERSION].includes(run?.companyExhaustion?.version)){
    try{
      const marker=run.companyExhaustion,result=mixedCompanyOutputs(library,job,run,{requireCurrent:false,
        allowAbandonedDrafts:marker.version===COMPANY_ABANDONED_DRAFT_EXHAUSTION_VERSION});
      return Boolean(run.status==='failed'&&marker.reason==='run_attempt_limit'&&marker.attemptLimit===8&&marker.attemptedCount===8
        &&Number.isFinite(Date.parse(marker.closedAt))&&run.companyRepair?.required===false&&result
        &&run.generatedCount===result.generatedCount&&run.failedCount===result.failedCount&&digest(marker.outputs)===digest(result.outputs));
    }catch{return false;}
  }
  const marker=run?.companyExhaustion,outputs=exhaustedCompanyOutputs(library,job,run);
  return Boolean(run?.status==='failed'&&marker?.version===COMPANY_EXHAUSTION_VERSION&&marker.reason==='run_attempt_limit'
    &&marker.attemptLimit===8&&marker.attemptedCount===8&&Number.isFinite(Date.parse(marker.closedAt))
    &&run.companyRepair?.required===false&&outputs&&digest(marker.outputs)===digest(outputs));
}

export function settleCompanyRejectedRuns({library,job,ownerAuthorized=false,now,variantRulesPassed}){
  if(job?.status!=='active'||job.archivedAt||ownerAuthorized!==true||job.id!==COMPANY_RECOVERY_JOB
    ||typeof variantRulesPassed!=='function'||!Number.isFinite(Date.parse(now))||!Array.isArray(job.sequenceReservations)
    ||(job.sequenceReservations||[]).some(row=>row.status==='reserved'))return false;
  let changed=false;
  for(const run of job.runs||[]){
    if(!['repairing','awaiting_review'].includes(run.status)||run.companyRepair?.required!==true
      ||run.status==='awaiting_review'&&run.automaticReviewHold?.reason!=='PROGRESSIVE_RUN_ATTEMPT_LIMIT')continue;
    let outputs=exhaustedCompanyOutputs(library,job,run,{requireCurrent:true,now:Date.parse(now)});
    let mixed=!outputs&&inspectMixedCompanyRunExhaustion({library,job,run,ownerAuthorized,now,variantRulesPassed});
    if(mixed?.eligible)outputs=mixed.outputs;
    const abandoned=!outputs&&inspectAbandonedDraftRunExhaustion({library,job,run,ownerAuthorized,now,variantRulesPassed});
    if(abandoned?.eligible){mixed=abandoned;outputs=abandoned.outputs;}
    if(!outputs)continue;
    // The company verdict never substitutes for the actual original sixteen
    // checks and their bindings. Core injects its existing rules verifier; no
    // callback, an exception, or a non-true result is a closed gate.
    let rulesCurrent=false;
    try{rulesCurrent=outputs.filter(row=>row.outcome!=='abandoned_unapproved').every(row=>variantRulesPassed(library.renders.find(render=>render.id===row.renderId)
      ?.variants.find(variant=>variant.id===row.variantId))===true);}catch{}
    if(!rulesCurrent)continue;
    const clips=(library.renders||[]).filter(render=>render.automation?.jobId===job.id&&render.automation?.runId===run.id)
      .flatMap(render=>(render.variants||[]).filter(variant=>!outputs.some(row=>row.outcome==='abandoned_unapproved'
        &&row.renderId===render.id&&row.variantId===variant.id)))
      .flatMap(variant=>(variant.clipSequence||[]).map(id=>(library.clips||[]).find(clip=>clip.id===id)));
    if(clips.some(clip=>!clip||!canReadClip(clip,(library.sources||[]).find(source=>source.id===clip.sourceId),{id:job.createdById})))continue;
    run.companyExhaustion={version:abandoned?.eligible?COMPANY_ABANDONED_DRAFT_EXHAUSTION_VERSION:mixed?.eligible?COMPANY_TERMINAL_EXHAUSTION_VERSION:COMPANY_EXHAUSTION_VERSION,
      reason:'run_attempt_limit',attemptLimit:8,attemptedCount:8,outputs,closedAt:now};
    run.companyRepair={...run.companyRepair,required:false};run.status='failed';run.completedAt=now;
    run.generatedCount=mixed?.eligible?mixed.generatedCount:0;run.failedCount=mixed?.eligible?mixed.failedCount:8;
    run.errorMessage=abandoned?.eligible?'本批8次尝试结束：1条公司通过且已绑定，5条公司退回，2条固定旧草稿仍未通过内容复核且不再交付；未达本批2条目标，保留失败终态继续原任务，不重置计数。'
      :mixed?.eligible?'本批8次尝试已全部明确结束：1条公司通过且已绑定，7条公司退回；未达本批2条目标，保留失败终态并继续原任务，不重置计数。'
      :'本批8次尝试均被公司明确退回，已保留为失败终态；不重置计数，继续本任务其他批次。';
    delete run.resumeRequestedAt;changed=true;
  }
  return changed;
}

export function companyClipExcluded(job,clip){
  if(job?.id!==COMPANY_RECOVERY_JOB||!Object.hasOwn(job,'companyRejectRecovery'))return false;
  const state=job.companyRejectRecovery;if(!validRecovery(state))return true;
  return state.exclusions.some(row=>row.sourceId===clip?.sourceId&&(row.kind==='source'||row.clipId===clip?.id
    ||finite(clip?.startSeconds)&&finite(clip?.endSeconds)&&clip.startSeconds<row.endSeconds&&clip.endSeconds>row.startSeconds));
}

export function companyRepairPending(job){
  return Boolean(job?.id===COMPANY_RECOVERY_JOB&&(job.runs||[]).some(run=>run.companyRepair?.required===true
    &&['queued','preparing','generating','repairing'].includes(run.status)));
}

export function hasCurrentCompanyPass(variant,{now=Date.now()}={}){
  const saved=variant?.companyReview,feedback=variant?.cloudDeliveryFeedback,live=feedback?.companyReview;
  const original=saved?.review,verified=Date.parse(live?.last_verified_at);
  return Boolean(saved?.status==='passed'&&saved.outputSha256===variant.contentSha256&&!feedback?.errorMessage
    &&original&&live&&live.status==='success'&&live.ready===true&&live.verdict==='pass'&&!live.error_code
    &&live.current_verified===true&&live.snapshot_matches===true&&Number.isFinite(verified)&&verified<=now&&now-verified<=600_000
    &&live.task_id===saved.taskId&&live.requested_revision===saved.requestedRevision&&live.requested_revision===live.verified_revision
    &&live.file_hash===variant.contentSha256&&live.return_sha256===variant.contentSha256&&live.asset_id===variant.materialCenterReturn?.assetId
    &&['actor_number','render_id','variant_id','submission_id','job_id'].every(key=>nonempty(live[key])&&live[key]===original[key]));
}

// This ephemeral capability belongs to one already-returned MP4, not a source
// approval or a planning override. HTTP/plain objects cannot manufacture it.
const existingCompanyPassContexts=new WeakMap();
const withdrawn=value=>Boolean(value&&(value.revoked===true||value.revokedAt||value.disabled===true||value.deliveryBlocked===true
  ||value.deleted===true||value.isDeleted===true||value.deletedAt));
const effectJobScope=job=>({id:job.id,createdById:job.createdById,status:job.status,archivedAt:job.archivedAt,
  productCategory:job.productCategory,targetDurationSeconds:job.targetDurationSeconds,dailyTarget:job.dailyTarget,
  runs:(job.runs||[]).map(run=>({id:run.id})),companyRejectRecovery:job.companyRejectRecovery});
function currentCompanyPassState(library,renderId,variantId,now,requireActive=true){
  const renders=(library?.renders||[]).filter(row=>row.id===renderId);if(renders.length!==1)return null;
  const render=renders[0],variants=(render.variants||[]).filter(row=>row.id===variantId);if(variants.length!==1)return null;
  const variant=variants[0],jobs=(library.autoJobs||[]).filter(row=>row.id===render.automation?.jobId);if(jobs.length!==1)return null;
  const job=jobs[0];
  if((requireActive?job.status!=='active':!['active','paused'].includes(job.status))||[job,render,variant].some(withdrawn)||job.archivedAt||variant.reviewStatus!=='approved'
    ||variant.reviewMode!=='automatic_rules'||!hasCurrentCompanyPass(variant,{now}))return null;
  const result=inspectCompanyReview({job,render,variant,review:variant.cloudDeliveryFeedback?.companyReview});
  if(!result.accepted||result.pass!==true)return null;
  // Capture only negative outputs actually referenced by this passed MP4's
  // input exclusions. Other jobs/renders do not become a planning capability.
  const clips=variant.historicalInventoryReview?.input?.evidence?.map(item=>item?.snapshot?.clip)||[];
  const keys=new Set((job.companyRejectRecovery?.exclusions||[]).filter(row=>clips.some(clip=>clip?.sourceId===row.sourceId
    &&(row.kind==='source'||clip.id===row.clipId||overlaps(clip,row)))).map(row=>row.receiptKey));
  const ids=new Set((job.companyRejectRecovery?.receipts||[]).filter(row=>keys.has(row.key)).map(row=>row.renderId));
  const rejectionRenders=(library.renders||[]).filter(row=>ids.has(row.id));
  return {job,render,variant,rejectionRenders,anchor:digest([effectJobScope(job),render,rejectionRenders])};
}
export function createExistingCompanyPassContext({library,renderId,variantId,now=Date.now(),requireActive=true}){
  const state=currentCompanyPassState(library,renderId,variantId,now,requireActive);if(!state)return null;
  // Unaffected outputs retain the original verification path. In particular,
  // normal sibling feedback must not create a new whole-render CAS dependency.
  if(!state.variant.historicalInventoryReview?.input?.evidence?.some(item=>companyClipExcluded(state.job,item?.snapshot?.clip)))return null;
  const context=Object.freeze({mode:'existing-company-pass-effect-v1'});
  existingCompanyPassContexts.set(context,{...structuredClone(state),renderId,variantId,requireActive});return context;
}
export function existingCompanyPassContextCurrent(context,library,{now=Date.now()}={}){
  const saved=existingCompanyPassContexts.get(context);if(!saved)return false;
  const live=currentCompanyPassState(library,saved.renderId,saved.variantId,now,saved.requireActive);
  return Boolean(live&&live.anchor===saved.anchor);
}
function verifiedSiblingR15Exclusion(data,exclusion){
  if(exclusion.kind!=='clip_range'||exclusion.ruleCode!=='R15'||Object.hasOwn(exclusion,'textEvidence'))return false;
  const receipts=data.job.companyRejectRecovery?.receipts?.filter(row=>row.key===exclusion.receiptKey)||[];
  if(receipts.length!==1)return false;
  const receipt=receipts[0],review=receipt.review;
  const renders=(data.rejectionRenders||[]).filter(row=>row.id===receipt.renderId);if(renders.length!==1)return false;
  const render=renders[0],crossRender=render.id!==data.render.id;
  if(render.createdById!==data.job.createdById||render.automation?.jobId!==data.job.id||withdrawn(render)
    ||!data.job.runs?.some(run=>run.id===render.automation?.runId))return false;
  const siblings=(render.variants||[]).filter(row=>row.id===receipt.variantId&&(crossRender||row.id!==data.variantId));
  if(siblings.length!==1)return false;
  const sibling=siblings[0],saved=sibling.companyReview;
  if(crossRender&&!rejectedCompanyOutput(data.job,render,sibling,{requireCurrent:true,allowRecordedRejectAge:true}))return false;
  if(receipt.renderId!==render.id||receipt.runId!==render.automation?.runId||receipt.outputSha256!==sibling.contentSha256
    ||receipt.assetId!==sibling.materialCenterReturn?.assetId||receipt.key!==reviewKey(review||{})
    ||receipt.taskId!==review?.task_id||receipt.requestedRevision!==review?.requested_revision||receipt.resultRevision!==review?.result_revision
    ||sibling.reviewMode!=='automatic_rules'||sibling.reviewStatus!=='changes_requested'||withdrawn(sibling)
    ||saved?.status!=='rejected'||saved.receiptKey!==receipt.key||saved.outputSha256!==sibling.contentSha256
    ||saved.taskId!==receipt.taskId||saved.requestedRevision!==receipt.requestedRevision||receipt.mappingReason||saved.mappingReason
    ||review?.verdict!=='reject'||review.findings_complete!==true||!Array.isArray(review.findings)||!review.findings.length
    ||review.findings.some(row=>row?.tier!=='red'||row.shadow!==false||!nonempty(row.rule_code)))return false;
  // Never take inspect's existing-receipt shortcut: rederive the exact range
  // from the original, output-bound negative receipt and measured timeline.
  const verified=inspectCompanyReview({job:{...data.job,companyRejectRecovery:undefined},render,variant:sibling,review});
  return Boolean(verified.accepted&&!verified.pass&&!verified.duplicate&&!verified.mappingReason
    &&verified.exclusions.some(row=>digest(row)===digest(exclusion))
    // An unrelated R5 finding does not revoke this exact R15-only range.
    // Derive from the full receipt, not just public exclusions: a shared R1,
    // R5 or other rule must still block even if its public row was omitted.
    &&!verified.exclusions.some(row=>row.sourceId===exclusion.sourceId&&row.ruleCode!=='R15'
      &&(row.kind==='source'||row.clipId===exclusion.clipId||overlaps(row,exclusion))));
}
export function companyClipExcludedForExistingOutput(job,clip,context){
  if(!companyClipExcluded(job,clip))return false;
  const data=existingCompanyPassContexts.get(context);
  if(!data||(data.requireActive?job.status!=='active':!['active','paused'].includes(job.status))||withdrawn(job)||digest(effectJobScope(job))!==digest(effectJobScope(data.job))
    ||!hasCurrentCompanyPass(data.variant))return true;
  const input=data.variant.historicalInventoryReview?.input,evidence=input?.evidence,index=data.variant.clipSequence?.indexOf(clip?.id),item=evidence?.[index];
  if(!Array.isArray(evidence)||evidence.length!==data.variant.clipSequence?.length||index<0||!item
    ||data.variant.historicalInventoryReview.outputSha256!==data.variant.contentSha256
    ||data.variant.historicalInventoryReview.inputSha256!==digest(input)||item.clipId!==clip.id||item.sourceId!==clip.sourceId
    ||item.snapshotSha256!==digest(item.snapshot)||!sha(item.currentClipSha256)||item.currentClipSha256!==item.snapshot?.currentMedia?.sha256
    ||!item.snapshot?.clip||digest(Object.fromEntries(Object.keys(item.snapshot.clip).map(key=>[key,clip[key]])))!==digest(item.snapshot.clip))return true;
  const matches=job.companyRejectRecovery.exclusions.filter(row=>row.sourceId===clip?.sourceId&&(row.kind==='source'||row.clipId===clip?.id
    ||finite(clip?.startSeconds)&&finite(clip?.endSeconds)&&clip.startSeconds<row.endSeconds&&clip.endSeconds>row.startSeconds));
  return !matches.length||matches.some(row=>!verifiedSiblingR15Exclusion(data,row));
}

export function inspectCompanyReview({job,render,variant,review}){
  const invalid=reason=>({accepted:false,reason});
  if(job?.id!==COMPANY_RECOVERY_JOB||job.createdById!=='FD-026222'||job.archivedAt
    ||render?.automation?.jobId!==job.id||render.createdById!==job.createdById
    ||!job.runs?.some(run=>run.id===render.automation.runId)||!variant)return invalid('scope_mismatch');
  if(!review||review.status!=='success'||review.ready!==true||!['pass','reject'].includes(review.verdict)||review.error_code
    ||review.snapshot_matches!==true||review.current_verified!==true
    ||!integer(review.requested_revision)||review.requested_revision!==review.verified_revision||!integer(review.result_revision)
    ||!nonempty(review.task_id)||!nonempty(review.job_id)||!nonempty(review.submission_id))return invalid('not_current_terminal_reject');
  if(review.actor_number!==job.createdById||review.render_id!==render.id||review.variant_id!==variant.id
    ||review.asset_id!==variant.materialCenterReturn?.assetId||variant.materialCenterReturn?.status!=='completed'
    ||!sha(variant.contentSha256)||review.return_sha256!==variant.contentSha256||review.file_hash!==variant.contentSha256)
    return invalid('output_binding_mismatch');
  const key=reviewKey(review),state=job.companyRejectRecovery;
  if(state!==undefined&&!validRecovery(state))return invalid('recovery_state_invalid');
  const prior=variant.companyReview;
  if(prior?.requestedRevision>review.requested_revision)return invalid('stale_requested_revision');
  if(review.verdict==='pass')return {accepted:true,key,pass:true,review:structuredClone(review)};
  // Remote result_revision is a polling counter, not a fresh authorization to
  // reopen the same rejected output. Keep the first actual rejection immutable.
  if(state?.receipts.some(row=>row.key===key))return {accepted:true,duplicate:true,key};
  const evidence=variant.historicalInventoryReview?.input?.evidence;
  let mappingReason=null;
  if(!Array.isArray(evidence)||!evidence.length||evidence.length!==variant.clipSequence?.length
    ||variant.historicalInventoryReview.outputSha256!==variant.contentSha256
    ||variant.historicalInventoryReview.inputSha256!==digest(variant.historicalInventoryReview.input))return invalid('historical_composition_evidence_invalid');
  const timeline=[];let cursor=0;
  if(!mappingReason)for(let index=0;index<evidence.length;index++){
    const item=evidence[index],clip=item.snapshot?.clip,source=item.snapshot?.source,media=item.snapshot?.currentMedia;
    if(item.clipId!==variant.clipSequence[index]||clip?.id!==item.clipId||source?.id!==item.sourceId||clip?.sourceId!==source?.id
      ||item.snapshotSha256!==digest(item.snapshot)||!sha(item.currentClipSha256)||media?.sha256!==item.currentClipSha256
      ||!finite(media.durationSeconds)||media.durationSeconds<=0||!finite(clip.startSeconds)||!finite(clip.endSeconds)
      ||clip.startSeconds<0||clip.endSeconds<=clip.startSeconds)return invalid('historical_composition_evidence_invalid');
    timeline.push({clipId:clip.id,sourceId:source.id,start:cursor,end:cursor+media.durationSeconds,
      startSeconds:clip.startSeconds,endSeconds:clip.endSeconds});cursor+=media.durationSeconds;
  }
  if(!finite(review.duration_ms)||review.duration_ms<=0)mappingReason='historical_timeline_unavailable';
  const findings=Array.isArray(review.findings)?review.findings:[];
  if(review.findings_complete===false)mappingReason||='reject_findings_incomplete';
  const actionable=findings.filter(row=>row?.tier==='red'&&row.shadow===false);
  if(!actionable.length||findings.length>250)mappingReason||='reject_findings_unavailable';
  const exclusions=[];
  // Real probed input durations are the concat timeline, not ASR cue lengths.
  // Cover final mux duration drift conservatively. If any finding cannot be
  // located, avoid only this verified composition's clips, never guess a
  // particular offending source or resend the rejected output.
  const drift=Math.abs(review.duration_ms/1000-cursor);
  const boundaryUncertainty=drift+2/30; // codec frame-boundary uncertainty, not output PTS confirmation
  if(!mappingReason&&drift>1)mappingReason='concat_timeline_drift';
  if(!mappingReason)for(const finding of actionable){
    const start=finding.time_start_ms,end=finding.time_end_ms;
    if(!finite(start)||!finite(end)||start<0||end<start||end>review.duration_ms
      ||!nonempty(finding.rule_code)){mappingReason='finding_time_unavailable';break;}
    const matches=timeline.filter(row=>row.start<=end/1000+boundaryUncertainty&&row.end>=start/1000-boundaryUncertainty);
    if(!matches.length){mappingReason='finding_time_unmapped';break;}
    for(const row of matches)exclusions.push({kind:finding.rule_code==='R1'?'source':'clip_range',sourceId:row.sourceId,
      ...(finding.rule_code==='R1'?{}:{clipId:row.clipId,startSeconds:row.startSeconds,endSeconds:row.endSeconds}),
      receiptKey:key,ruleCode:finding.rule_code});
  }
  if(mappingReason){
    // A verified rejected composition can be avoided conservatively. This
    // does NOT assert that every included clip/source independently violated a
    // rule; never export these job-local choices as global review decisions.
    exclusions.length=0;
    for(const item of evidence||[]){
      const clip=item?.snapshot?.clip;
      if(nonempty(clip?.id)&&clip.id===item.clipId&&nonempty(clip.sourceId)&&finite(clip.startSeconds)&&finite(clip.endSeconds)
        &&clip.endSeconds>clip.startSeconds&&variant.clipSequence.includes(clip.id))
        exclusions.push({kind:'clip_range',clipId:clip.id,sourceId:clip.sourceId,startSeconds:clip.startSeconds,endSeconds:clip.endSeconds,
          receiptKey:key,ruleCode:'whole_output_rejected_unlocalized'});
    }
    if(exclusions.length!==variant.clipSequence?.length)return invalid('rejected_composition_identity_missing');
  }
  return {accepted:true,duplicate:false,key,mappingReason,exclusions:[...new Map(exclusions.map(row=>[digest(row),row])).values()],review:structuredClone(review)};
}

export const inspectCompanyReject=options=>{
  const result=inspectCompanyReview(options);return result.pass?{accepted:false,reason:'not_reject'}:result;
};

export function applyCompanyReject({library,renderId,variantId,review,now,ownerAuthorized=false}){
  const render=library.renders?.find(row=>row.id===renderId),variant=render?.variants?.find(row=>row.id===variantId);
  const job=library.autoJobs?.find(row=>row.id===render?.automation?.jobId);
  if(job?.status!=='active'||ownerAuthorized!==true)return {accepted:false,reason:'automation_stopped'};
  const result=inspectCompanyReview({job,render,variant,review});
  if(!result.accepted)return result;
  if(result.duplicate){
    // Deployment does not migrate paused jobs. A fresh, authenticated repeat
    // of the same rejection may add previously missed text aliases only; it
    // never reopens the run, rewrites the receipt, or increments attempts.
    const changed=appendCompanyTextAvoidance({library,job,render,variant,review,key:result.key});
    return {...result,changed,approvalGranted:false,countersReset:false};
  }
  if(result.pass){
    // A later pass cannot erase a recorded rejection or restore a changed local
    // approval. This is only a separate, actually received company receipt.
    if(variant.companyReview?.status==='rejected'||variant.reviewStatus!=='approved')return {accepted:false,reason:'original_rejection_retained'};
    if(variant.companyReview?.receiptKey===result.key&&variant.companyReview?.resultRevision===review.result_revision)
      return {...result,duplicate:true,changed:false};
    variant.companyReview={status:'passed',receiptKey:result.key,taskId:review.task_id,requestedRevision:review.requested_revision,
      resultRevision:review.result_revision,outputSha256:variant.contentSha256,checkedAt:now,review:result.review};
    return {...result,changed:true,approvalGranted:false,countersReset:false};
  }
  const run=job.runs.find(row=>row.id===render.automation.runId);
  const state=job.companyRejectRecovery||{version:COMPANY_RECOVERY_VERSION,receipts:[],exclusions:[]};
  state.receipts.push({key:result.key,taskId:review.task_id,resultRevision:review.result_revision,
    requestedRevision:review.requested_revision,renderId,variantId,runId:run.id,assetId:review.asset_id,outputSha256:variant.contentSha256,at:now,
    mappingReason:result.mappingReason,review:result.review});
  state.exclusions.push(...result.exclusions);job.companyRejectRecovery=state;
  appendCompanyTextAvoidance({library,job,render,variant,review,key:result.key});
  variant.companyReview={status:'rejected',receiptKey:result.key,taskId:review.task_id,requestedRevision:review.requested_revision,resultRevision:review.result_revision,
    outputSha256:variant.contentSha256,mappingReason:result.mappingReason,checkedAt:now};
  // Do not overwrite the actual sixteen technical checks or their receipt.
  variant.reviewStatus='changes_requested';
  variant.reviewNote='公司审核明确拒绝；原成片与技术检查保留，禁止重传原文件。'+(result.mappingReason?'仅本任务保守避让该成片全部所用切片，不认定各原片单独违规。':'原任务将避开命中素材重新组合；定位为实测片长累计区间，非逐帧PTS证明。');
  run.companyRepair={...(run.companyRepair||{}),required:true,receiptKeys:[...new Set([...(run.companyRepair?.receiptKeys||[]),result.key])],requestedAt:now};
  run.completedAt=null;
  run.status='repairing';job.nextRunAt=now;
  job.updatedAt=now;
  return {...result,changed:true,approvalGranted:false,countersReset:false};
}

export function companyJobContinuation(library,job){
  if(job?.id!==COMPANY_RECOVERY_JOB||job.status!=='active'||job.archivedAt)return {action:'wait',reason:'inactive'};
  const renders=(library.renders||[]).filter(row=>row.automation?.jobId===job.id);
  const variants=renders.flatMap(row=>row.variants||[]),outputs=variants.filter(row=>row.reviewMode==='automatic_rules');
  const targets=job.qianchuanDelivery?.targets||[];
  const bound=variant=>variant.reviewStatus==='approved'&&hasCurrentCompanyPass(variant)&&targets.length>0&&targets.every(target=>
      [...(variant.qianchuanDeliveries||[]),...(variant.qianchuanDelivery?[variant.qianchuanDelivery]:[]),...(variant.cloudDeliveryFeedback?.items||[])].some(state=>
        state.status==='success'&&state.platformAssetId&&state.bindingVerifiedAt&&state.advertiserId===target.advertiserId&&state.planId===target.planId));
  const seenFiles=new Set(),seenSequences=new Set(),seenPlatformAssets=new Set();
  let delivered=0;
  for(const variant of outputs.filter(bound)){
    const sequence=variant.contentSequenceIdentity;
    if(!sha(variant.contentSha256)||!nonempty(sequence?.version)||!sha(sequence?.key))continue;
    const states=[...(variant.qianchuanDeliveries||[]),...(variant.qianchuanDelivery?[variant.qianchuanDelivery]:[]),...(variant.cloudDeliveryFeedback?.items||[])];
    const platformKeys=targets.map(target=>{const state=states.find(s=>s.status==='success'&&s.platformAssetId&&s.bindingVerifiedAt&&s.advertiserId===target.advertiserId&&s.planId===target.planId);
      return target.advertiserId+':'+state.platformAssetId;});
    const sequenceKey=sequence.version+':'+sequence.key;
    if(seenFiles.has(variant.contentSha256)||seenSequences.has(sequenceKey)||platformKeys.some(key=>seenPlatformAssets.has(key)))continue;
    seenFiles.add(variant.contentSha256);seenSequences.add(sequenceKey);platformKeys.forEach(key=>seenPlatformAssets.add(key));delivered++;
  }
  if(delivered>=20)return {action:'done',delivered};
  if(outputs.filter(bound).length>delivered)return {action:'wait',reason:'duplicate_or_missing_delivery_identity',delivered};
  if(job.runs?.some(run=>['awaiting_review','awaiting_clip_review','failed','partial'].includes(run.status)&&!run.resumeRequestedAt
    &&!isCompanyRunExhausted(library,job,run)))return {action:'wait',reason:'review_hold',delivered};
  if(outputs.some(variant=>variant.reviewStatus==='approved'&&!bound(variant)))return {action:'wait',reason:'company_or_binding_pending',delivered};
  if(outputs.some(variant=>variant.reviewStatus!=='approved'&&variant.companyReview?.status!=='rejected'))return {action:'wait',reason:'technical_or_unknown_outcome',delivered};
  const known=new Set(renders.flatMap(render=>(render.variants||[]).map(variant=>render.id+':'+variant.id)));
  const attempts=Math.max(variants.length+(job.sequenceReservations||[]).filter(row=>!known.has(row.renderId+':'+row.variantId)).length,
    Number(job.progressiveSourcePreparation?.attemptedFloor)||0);
  if((job.sequenceReservations||[]).some(row=>row.status==='reserved'))return {action:'wait',reason:'sequence_reserved',delivered};
  if(attempts>=80)return {action:'wait',reason:'job_attempt_limit',delivered};
  if(companyRepairPending(job))return {action:'repair',delivered};
  if(job.runs?.some(run=>['queued','preparing','generating','repairing','awaiting_sources'].includes(run.status)))return {action:'existing',delivered};
  return {action:'next',delivered};
}
