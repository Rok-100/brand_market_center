import {R9_ADDITIVE_JOB_ID} from './combine-legacy-source-resolvers.mjs';

// Read-only recovery of already-approved private segment receipts. No ASR,
// provider, approval writer, budget or retry capability exists in this helper.
const roles=new Set(['hook','pain','solution','demo','proof','benefit','cta','custom']);
const unavailable=value=>!value||value.revoked===true||Boolean(value.revokedAt)||value.disabled===true||value.deliveryBlocked===true;
const denied=value=>['rejected','changes_requested'].includes(value?.reviewStatus);
const sameRange=(a,b)=>Math.abs(a.startSeconds-b.startSeconds)<1e-6&&Math.abs(a.endSeconds-b.endSeconds)<1e-6;
const nearRange=(a,b)=>Math.abs(a.startSeconds-b.startSeconds)<0.01&&Math.abs(a.endSeconds-b.endSeconds)<0.01;
const clipSnapshot=clip=>{
  // createClip may append this authorized owner to attribution arrays when
  // reusing a team clip; it may not change any other pending record field.
  const {createdByIds,createdByNames,...rest}=clip||{};return JSON.stringify(rest);
};
export async function inspectCompletedSourceMaterialization({sourceId,readState,readCatalog,isTrustedSegment,
  calibrateSegments,verifySegment,clipBytesReusable,approvedClipCurrent}) {
  let first;
  try{first=await readState();}catch{return {status:'blocked',reason:'state_unavailable',segmentIds:[]};}
  const {source,job,run}=first||{};
  // Do not change the behavior or wake any other owner's task.
  if(job?.id!==R9_ADDITIVE_JOB_ID||run?.onDemandSourcePreparation?.mode!=='bounded-on-demand-v1'
    ||!run.onDemandSourcePreparation.sourceIds?.includes(sourceId)
    ||run.versionPreparationAttempts?.[sourceId]?.complete!==true)return null;
  const blocked=reason=>({status:'blocked',reason,segmentIds:[]});
  const sourceSnapshot=JSON.stringify(source),attemptSnapshot=JSON.stringify(run.versionPreparationAttempts[sourceId]);
  const scope=state=>JSON.stringify({jobId:state.job?.id,owner:state.job?.createdById,category:state.job?.productCategory,
    frameworkId:state.job?.frameworkId,runId:state.run?.id,targetCount:state.run?.targetCount,
    targetDurationSeconds:state.run?.targetDurationSeconds,fixed:state.run?.onDemandSourcePreparation,
    currentBatch:state.job?.progressiveSourcePreparation?.batches?.at(-1)?.sourceIds});
  const frozenScope=scope(first),key=run.versionPreparationAttempts[sourceId].key;
  const isStateCurrent=state=>Boolean(state?.authorized&&state.job?.status==='active'&&!state.job.archivedAt
    &&state.job.productCategory==='黑晶面膜'&&scope(state)===frozenScope&&!['completed','cancelled'].includes(state.run?.status)
    &&(!state.job.progressiveSourcePreparation||state.job.progressiveSourcePreparation.batches?.at(-1)?.sourceIds?.includes(sourceId))
    &&!unavailable(state.source)&&!denied(state.source)&&state.source.id===sourceId
    &&JSON.stringify(state.source)===sourceSnapshot&&JSON.stringify(state.run.versionPreparationAttempts?.[sourceId])===attemptSnapshot);
  const assertCurrent=async()=>{
    if(!isStateCurrent(await readState()))return false;
    const catalog=await readCatalog();
    return Boolean(catalog?.sourceIds?.includes(sourceId)&&(catalog.bindingKeysBySourceId?.[sourceId]||catalog.registrySha256)===key
      &&isStateCurrent(await readState()));
  };
  try{
    if(!key||!(await assertCurrent()))return blocked('current_scope_changed');
    if(run.versionPreparationAttempts[sourceId].reason)return blocked('attempt_not_terminal');
    const review=source.sourceSemanticReview;
    if(!review||review.recoverable!==false||!Array.isArray(review.pendingReasons)
      ||review.pendingReasons.some(reason=>!['content_attention','business_fact_attention'].includes(reason)))return blocked('review_not_terminal');
    const proven=(source.speechSegments||[]).filter(segment=>segment.semanticReviewProof);
    if(!Number.isInteger(review.passedCount)||review.passedCount!==proven.length)return blocked('approved_proof_set_incomplete');
    for(const segment of proven){
      if(!(await assertCurrent())||!isTrustedSegment(segment,source)||!(await verifySegment(source,segment,assertCurrent)))
        return blocked('private_proof_unavailable');
    }
    const calibrated=calibrateSegments(source),plans=[];
    for(const segment of proven){
      const cut=calibrated.find(row=>row.id===segment.id);
      // A complete receipt is not permission to alter its native range.
      if(segment.requiresReview||segment.technicalBoundaryReasons?.length||!cut||cut.automaticCalibration?.status!=='calibrated'
        ||!sameRange(cut,segment)||!roles.has(cut.suggestedRole))return blocked('approved_boundary_not_materializable');
      const overlapping=(first.library.clips||[]).filter(clip=>clip.sourceId===sourceId
        &&clip.startSeconds<segment.endSeconds&&clip.endSeconds>segment.startSeconds);
      // A known negative verdict remains a negative terminal result. Never
      // recut a rejected/revoked range under a fresh ID or another role.
      if(overlapping.some(clip=>denied(clip)||unavailable(clip)))continue;
      const matches=overlapping.filter(clip=>sameRange(clip,segment));
      let settled=false,pending=null;
      for(const clip of matches){
        if(clip.visibility==='private'&&!clip.createdByIds?.includes(job.createdById))return blocked('existing_clip_unreadable');
        if(!roles.has(clip.role)||!(await clipBytesReusable(clip,segment,assertCurrent)))return blocked('existing_clip_changed');
        if(clip.reviewStatus==='approved'){
          if(!(await approvedClipCurrent(clip,source,segment,assertCurrent)))return blocked('existing_approval_invalid');
          settled=true;
        }else if(clip.reviewStatus==='pending'&&!clip.automaticAssessment){pending||=clip;}
        else return blocked('existing_clip_unresolved');
      }
      if(!settled)plans.push({segmentId:segment.id,role:pending?.role||cut.suggestedRole,existingClipId:pending?.id||null});
    }
    if(!(await assertCurrent()))return blocked('current_scope_changed');
    const guardForSegment=segmentId=>{
      const segment=proven.find(row=>row.id===segmentId);
      const plan=plans.find(row=>row.segmentId===segmentId);
      const initial=(first.library.clips||[]).filter(clip=>clip.sourceId===sourceId&&segment&&nearRange(clip,segment));
      const expected=new Map(initial.map(clip=>[clip.id,clipSnapshot(clip)]));let boundId=plan?.existingClipId||null;
      const segmentStateCurrent=state=>{
        if(!segment||!plan||!isStateCurrent(state))return false;
        const clips=(state.library?.clips||[]).filter(clip=>clip.sourceId===sourceId);
        if(clips.some(clip=>clip.startSeconds<segment.endSeconds&&clip.endSeconds>segment.startSeconds&&(denied(clip)||unavailable(clip))))return false;
        // Other independently valid sibling ranges may be materialized. Only
        // this exact/near range and all overlapping negatives are guarded.
        const matching=clips.filter(clip=>nearRange(clip,segment));
        return matching.every(clip=>clip.visibility!=='private'||clip.createdByIds?.includes(job.createdById))
          &&matching.length===expected.size&&[...expected].every(([id,snapshot])=>
          matching.some(clip=>clip.id===id&&clipSnapshot(clip)===snapshot));
      };
      const segmentCurrent=async()=>Boolean(segmentStateCurrent(await readState())&&await assertCurrent()
        &&await verifySegment(source,segment,assertCurrent)&&segmentStateCurrent(await readState()));
      const bindClip=clip=>{
        if(!plan||!segment||clip.sourceId!==sourceId||clip.role!==plan.role||!sameRange(clip,segment)
          ||clip.reviewStatus!=='pending'||clip.automaticAssessment||denied(clip)||unavailable(clip)
          ||(boundId&&clip.id!==boundId))throw Error('materialization_clip_identity_changed');
        if(plan.existingClipId&&clipSnapshot(clip)!==expected.get(plan.existingClipId))throw Error('materialization_pending_clip_changed');
        boundId=clip.id;expected.set(clip.id,clipSnapshot(clip));
      };
      return {isStateCurrent:segmentStateCurrent,assertCurrent:segmentCurrent,bindClip,existingClipId:plan?.existingClipId||null};
    };
    return {status:plans.length?'ready':'settled',reason:null,source:structuredClone(source),plans,
      segmentIds:plans.map(plan=>plan.segmentId),assertCurrent,isStateCurrent,guardForSegment};
  }catch{return blocked('cached_evidence_unavailable');}
}
