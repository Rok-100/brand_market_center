// New MP4 rules assessment over the exact server-authorized historical stock.
// This is neither an old-output exemption nor visual/ASR/content approval.
import {HISTORICAL_INVENTORY_MODE,HISTORICAL_INVENTORY_JOB,HISTORICAL_REFERENCE_SHA256,
  historicalSnapshotDigest,validateHistoricalReuseSnapshot} from './historical-approved-inventory.mjs';
import {recordedSourceCategory} from './source-media-fallback.mjs';
import {createExistingCompanyPassContext} from './company-reject-recovery.mjs';
export const HISTORICAL_OUTPUT_RULES_POLICY='wis-historical-approved-output-rules-v1';
export const HISTORICAL_OUTPUT_REVIEW_MODE='automatic_rules';
export const HISTORICAL_OUTPUT_CHECKS=Object.freeze(['文件可播放','竖版规格','音轨','时长完整','黑屏占比','目标时长','静音占比',
  '框架完整度','警示语配置','剪辑节奏','重复成片','切片不重复','来源切片审核','产品分类一致','内容边界完整','剧情演绎位置']);
const sha=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const same=(a,b)=>historicalSnapshotDigest(a)===historicalSnapshotDigest(b);
const denied=value=>Boolean(value&&(value.revoked===true||value.revokedAt||value.disabled===true||value.deliveryBlocked===true
  ||value.deleted===true||value.isDeleted===true||value.deletedAt||['rejected','changes_requested'].includes(value.reviewStatus)));
const projected=(record,snapshot)=>record&&snapshot?Object.fromEntries(Object.keys(snapshot).map(key=>[key,record[key]])):null;

export function historicalInventoryInputCurrent(input,{clips,sources,job,runId,requireActive=true,existingOutputContext}={}) {
  if(input?.mode!==HISTORICAL_INVENTORY_MODE||input.referenceSha256!==HISTORICAL_REFERENCE_SHA256
    ||job?.id!==HISTORICAL_INVENTORY_JOB||job.createdById!=='FD-026222'||denied(job)||job.archivedAt
    ||requireActive&&job.status!=='active'||job.autoApproveOutputs!==true||job.productCategory!=='黑晶面膜'||job.targetDurationSeconds!==90||job.dailyTarget!==2
    ||!job.runs?.some(run=>run.id===runId&&run.targetDurationSeconds===90)
    ||!Array.isArray(clips)||!clips.length||!Array.isArray(input.evidence)||input.evidence.length!==clips.length
    ||new Set(clips.map(clip=>clip?.id)).size!==clips.length)return false;
  const byId=new Map((sources||[]).map(source=>[source.id,source])),versions=new Set();
  for(let i=0;i<clips.length;i++){
    const clip=clips[i],source=byId.get(clip?.sourceId),item=input.evidence[i];
    if(!clip||!source||denied(clip)||denied(source)||clip.reviewStatus!=='approved'||clip.visibility==='private'||source.visibility==='private'
      ||!['黑晶面膜','通用切片'].includes(clip.productCategory)
      ||recordedSourceCategory(source)&&!['黑晶面膜','通用切片','通用'].includes(recordedSourceCategory(source))
      ||item?.clipId!==clip.id||item.sourceId!==source.id||!sha(item.currentClipSha256)
      ||item.currentClipSha256!==item.snapshot?.currentMedia?.sha256||item.approvalGranted!==false||item.requiresNewOutputReview!==true
      ||!validateHistoricalReuseSnapshot({previous:item,current:item,job,identity:{id:job.createdById},requireActive,existingOutputContext}).valid
      ||!same(projected(clip,item.snapshot.clip),item.snapshot.clip)||!same(projected(source,item.snapshot.source),item.snapshot.source))return false;
    versions.add(item.skuVersion||null);
  }
  return versions.size===1;
}

export function historicalRulesAssessmentPassed(assessment,outputSha256){
  return Boolean(sha(outputSha256)&&assessment?.mode==='rules'&&assessment.ruleVersion===HISTORICAL_OUTPUT_RULES_POLICY
    &&assessment.outputSha256===outputSha256&&!Object.hasOwn(assessment,'visualReview')&&!assessment.integrityFailure
    &&assessment.status==='passed'&&assessment.recommendation==='approve'&&assessment.score===100
    &&assessment.autoApproved===true&&Array.isArray(assessment.checks)&&assessment.checks.length===HISTORICAL_OUTPUT_CHECKS.length
    &&assessment.checks.every((check,index)=>check?.name===HISTORICAL_OUTPUT_CHECKS[index]&&check.passed===true));
}

export function historicalRulesVariantPassed(variant){
  const evidence=variant?.historicalInventoryReview;
  return Boolean(variant?.reviewMode===HISTORICAL_OUTPUT_REVIEW_MODE&&historicalRulesAssessmentPassed(variant.automaticAssessment,variant.contentSha256)
    &&evidence?.version===HISTORICAL_OUTPUT_RULES_POLICY&&evidence.jobId===HISTORICAL_INVENTORY_JOB&&typeof evidence.runId==='string'&&evidence.runId
    &&evidence.outputSha256===variant.contentSha256&&evidence.input?.referenceSha256===HISTORICAL_REFERENCE_SHA256
    &&evidence.inputSha256===historicalSnapshotDigest(evidence.input)&&variant.generationBinding?.version===1&&variant.reviewBinding?.version===1
    &&same(evidence.generationBinding,variant.generationBinding)&&same(evidence.reviewBinding,variant.reviewBinding));
}

export function historicalRulesOutputContract(render,variant,library,{requireActive=true}={}){
  const evidence=variant?.historicalInventoryReview,job=library?.autoJobs?.find(item=>item.id===render?.automation?.jobId);
  if(render?.sourceEvidencePolicy!==HISTORICAL_OUTPUT_RULES_POLICY||render.productCategory!=='黑晶面膜'
    ||render.automation?.jobId!==HISTORICAL_INVENTORY_JOB||render.createdById!==job?.createdById||denied(render)||denied(variant)
    ||variant?.reviewStatus!=='approved'||!historicalRulesVariantPassed(variant)
    ||evidence.jobId!==render.automation.jobId||evidence.runId!==render.automation.runId)return false;
  const clips=(variant.clipSequence||[]).map(id=>library.clips.find(clip=>clip.id===id));
  const existingOutputContext=createExistingCompanyPassContext({library,renderId:render.id,variantId:variant.id,requireActive});
  return historicalInventoryInputCurrent(evidence.input,{clips,sources:library.sources,job,runId:evidence.runId,requireActive,existingOutputContext});
}

export function createHistoricalRulesEvidence({input,jobId,runId,outputSha256,generationBinding,reviewBinding}){
  if(jobId!==HISTORICAL_INVENTORY_JOB||!runId||!sha(outputSha256)||input?.referenceSha256!==HISTORICAL_REFERENCE_SHA256)
    throw Error('HISTORICAL_RULES_EVIDENCE_INVALID');
  return {version:HISTORICAL_OUTPUT_RULES_POLICY,jobId,runId,outputSha256,input:structuredClone(input),inputSha256:historicalSnapshotDigest(input),
    generationBinding:structuredClone(generationBinding),reviewBinding:structuredClone(reviewBinding),
    visualApprovalGranted:false,newSourceApprovalGranted:false,companyAndPlatformApprovalRequired:true};
}

// A late pause/file/snapshot change cannot be represented as a visual receipt.
export function holdHistoricalRulesOutput(variant,{reason,summary}){
  const assessment=variant.automaticAssessment;
  variant.automaticAssessment={...assessment,status:assessment?.status==='failed'?'failed':'review_required',autoApproved:false,
    recommendation:assessment?.status==='failed'?'reject':'manual_review',integrityFailure:{reason,summary},
    reasons:[...(assessment?.reasons||[]),summary],suggestions:[...(assessment?.suggestions||[]),'保留原文件和检查记录，核验变化后重新生成。']};
  variant.reviewStatus='changes_requested';variant.reviewNote=summary;return variant;
}
