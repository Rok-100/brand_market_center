import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {bindingState} from './output-review-binding.mjs';
import {visualTimeline} from './output-quality.mjs';
import {VISUAL_REVIEW_VERSION,parseVisualReview} from './visual-quality.mjs';

const JOB='a5fdb74d-a2a1-4cf0-affe-d9bbfaf30354';
const PARTITION='wis-output-partition-review-20261003-v1';
const sha=value=>createHash('sha256').update(value).digest('hex');
const validSha=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const same=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
const need=(ok,reason)=>{if(!ok)throw Error(reason);};

// Read-only proof of a DEFINITE rejection, never output approval or a new
// review. Only core's private exact-job pilot may use this to continue within
// existing 8/run and 80/job attempt caps. It does not change counters or state.
// hashOutputFile and verifyInputs MUST read current private bytes/source proofs;
// assertCurrent MUST recheck real owner permission, active job and frozen inputs.
export async function verifyDefinitiveContentFailure({directory,allowedJobIds,jobId,render,variant,library,model,
  hashOutputFile,verifyInputs,assertCurrent}={}){
 try{
  need(jobId===JOB&&Array.isArray(allowedJobIds)&&allowedJobIds.includes(JOB),'failure_scope_not_authorized');
  need(typeof directory==='string'&&path.isAbsolute(directory)&&typeof model==='string'&&model.trim()
    &&[hashOutputFile,verifyInputs,assertCurrent].every(fn=>typeof fn==='function'),'failure_dependencies_missing');
  const job=library?.autoJobs?.find(item=>item.id===JOB),run=job?.runs?.find(item=>item.id===render?.automation?.runId);
  need(job?.status==='active'&&!job.archivedAt&&job.createdById&&render?.createdById===job.createdById
    &&render.automation?.jobId===JOB&&run?.renderIds?.includes(render.id)
    &&render.variants?.some(item=>item.id===variant?.id&&same(item,variant)),'failure_job_binding_invalid');
  const assessment=variant?.automaticAssessment,review=assessment?.visualReview;
  need(variant.reviewStatus==='changes_requested'&&!['human','legacy','manual_pending'].includes(variant.reviewMode)
    &&assessment?.status==='review_required'&&assessment.mode==='rules_and_visual'
    &&review?.status==='review_required'&&review.reason==='content_attention'&&Array.isArray(review.issues)&&review.issues.length>0
    &&review.version===VISUAL_REVIEW_VERSION&&review.partitionVersion===PARTITION&&validSha(variant.contentSha256)
    &&review.sha256===variant.contentSha256&&review.model===model,'failure_not_definitive_content');
  const binding=bindingState(render,variant,library);
  need(binding.reason===null&&!variant.sourceRevalidation?.required,'failure_inputs_changed');
  const check=async()=>{
    need(await assertCurrent()===true,'failure_current_authority_changed');
    need(await hashOutputFile()===variant.contentSha256,'failure_output_bytes_changed');
    need(await verifyInputs()===true,'failure_source_evidence_unverified');
    need(await assertCurrent()===true,'failure_current_authority_changed');
  };
  await check();
  const timeline=visualTimeline(binding.clips,library.sources),contextSha256=sha(JSON.stringify(timeline));
  need(timeline.length>12&&timeline.length<=45&&review.contextSha256===contextSha256
    &&review.partCount===Math.ceil(timeline.length/12)&&Array.isArray(review.parts)&&review.parts.length>0
    &&review.parts.length<=review.partCount&&review.completedParts===review.parts.length-1,'failure_partition_incomplete');
  const receipts=[];
  for(let index=0;index<review.parts.length;index++){
    const part=review.parts[index],last=index===review.parts.length-1;
    need(part?.partIndex===index&&validSha(part.receiptKey)&&part.status===(last?'review_required':'passed')
      &&(!last||part.reason==='content_attention'),'failure_partition_incomplete');
    const base={partitionVersion:PARTITION,sha256:variant.contentSha256,product:render.productCategory,model,
      bindingFingerprint:binding.current.review,contextTimeline:timeline,contextSha256,partIndex:index,partCount:review.partCount,
      timeline:timeline.slice(index*12,index*12+12)};
    const key=sha(JSON.stringify([VISUAL_REVIEW_VERSION,base]));
    need(part.receiptKey===key&&(!last||(review.receiptKey===key&&review.reviewKey===key&&review.partIndex===index)),'failure_receipt_binding_invalid');
    const file=path.join(directory,key+'.json'),stat=await fs.lstat(file);
    need(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<=4*1024*1024,'failure_receipt_unreadable');
    const text=await fs.readFile(file,'utf8'),record=JSON.parse(text),request=record.request;
    need(['responded','complete'].includes(record.state),'failure_receipt_unknown');
    need(record.key===key&&record.sha256===variant.contentSha256&&record.model===model
      &&record.specSha256===sha(JSON.stringify(base))&&record.requestSha256===sha(JSON.stringify(request))
      &&same(request,{...base,reviewKey:key,coverage:part.coverage})&&typeof record.responseText==='string'
      &&record.responseSha256===sha(record.responseText),'failure_receipt_binding_invalid');
    need(Array.isArray(part.coverage)&&part.coverage.length===base.timeline.length,'failure_coverage_invalid');
    for(const [offset,point]of part.coverage.entries()){
      const clip=base.timeline[offset];need(point&&Object.keys(point).sort().join(',')==='at,clipId,frameSha256,index'
        &&point.index===index*12+offset&&point.clipId===clip.clipId&&point.at===Number((clip.start+clip.duration/2).toFixed(2))
        &&validSha(point.frameSha256),'failure_coverage_invalid');
    }
    const answer=JSON.parse(record.responseText.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,''));
    need(['reviewKey','sha256','contextSha256','partIndex','partCount'].every(k=>answer[k]===request[k])
      &&same(answer.coverage,request.coverage)&&typeof answer.summary==='string'&&answer.summary.trim(),'failure_response_invalid');
    if(last)need(answer.decision==='review_required'&&Array.isArray(answer.issues)&&answer.issues.length>0
      &&answer.issues.every(issue=>issue&&typeof issue.kind==='string'&&issue.kind.trim()
        &&typeof issue.description==='string'&&issue.description.trim()),'failure_response_not_definitive');
    const parsed=parseVisualReview(record.responseText,part.coverage.map(p=>p.at));
    need(parsed.status===part.status&&parsed.confidence===part.confidence
      &&(last?parsed.reason==='content_attention'&&parsed.issues.length>0&&same(parsed.issues,review.issues)
        &&parsed.confidence===review.confidence&&same(review.coverage,part.coverage):parsed.status==='passed'&&parsed.issues.length===0),
      'failure_response_not_definitive');
    receipts.push({partIndex:index,receiptKey:key,receiptSha256:sha(text),responseSha256:record.responseSha256});
  }
  await check();
  for(const receipt of receipts)need(sha(await fs.readFile(path.join(directory,receipt.receiptKey+'.json'),'utf8'))===receipt.receiptSha256,'failure_receipt_changed');
  return {verified:true,reason:null,jobId,outputSha256:variant.contentSha256,reviewBinding:binding.current.review,
    receiptKey:review.receiptKey,receipts,approvalGranted:false,countersReset:false};
 }catch(error){return {verified:false,reason:/^failure_[a-z_]+$/.test(error?.message||'')?error.message:'failure_receipt_unreadable',approvalGranted:false,countersReset:false};}
}
