// Cached, read-only eligibility for a missing CTA role. This module has no ASR,
// model, approval or persistence API: callers retain the ordinary pending cut
// and technical-review path. Only this run's already-completed fixed sources.
export async function recoverCompletedSourceCta({sourceId, readState, readCatalog,
  isTrustedSegment, isActionSegment, verifySegment, approvedClipReusable}) {
  try {
    const first=await readState(), {source,run,job}=first || {};
    const allowed=state=>Boolean(state?.authorized&&state.job?.status==='active'&&!state.job.archivedAt&&
      state.job.productCategory==='黑晶面膜'&&state.run?.id===run?.id&&state.job.id===job?.id&&
      state.run.onDemandSourcePreparation?.mode==='bounded-on-demand-v1'&&
      state.run.onDemandSourcePreparation.sourceIds?.includes(sourceId)&&
      state.run.versionPreparationAttempts?.[sourceId]?.complete===true&&
      state.source?.id===sourceId&&!state.source.revoked&&!state.source.revokedAt&&!state.source.disabled&&
      !state.source.deliveryBlocked&&!['rejected','changes_requested'].includes(state.source.reviewStatus));
    if(!allowed(first))return null;
    const key=run.versionPreparationAttempts[sourceId].key;
    if(!key)return null;
    const sourceSnapshot=JSON.stringify(source);
    const isStateCurrent=state=>allowed(state)&&JSON.stringify(state.source)===sourceSnapshot&&
      state.run.versionPreparationAttempts[sourceId]?.key===key;
    const assertCurrent=async()=>{
      if(!isStateCurrent(await readState()))return false;
      const catalog=await readCatalog();
      return catalog?.sourceIds?.includes(sourceId)&&
        (catalog.bindingKeysBySourceId?.[sourceId]||catalog.registrySha256)===key;
    };
    if(!(await assertCurrent()))return null;
    // A missing proof is not a request to run a model. Other pending segments
    // remain pending and are not manufactured into candidates.
    const candidates=(source.speechSegments||[]).filter(segment=>segment.semanticReviewProof&&
      isActionSegment(segment)&&isTrustedSegment(segment,source)&&!segment.technicalBoundaryReasons?.length);
    const segments=[];
    for(const segment of candidates){
      if(!(await assertCurrent())||!(await verifySegment(source,segment,assertCurrent)))return null;
      const clips=(first.library.clips||[]).filter(clip=>clip.sourceId===sourceId&&clip.role==='cta'&&
        Math.abs(clip.startSeconds-segment.startSeconds)<1e-6&&Math.abs(clip.endSeconds-segment.endSeconds)<1e-6);
      let alreadyApproved=false;
      for(const clip of clips){
        if(clip.reviewStatus==='approved'&&!clip.revoked&&!clip.revokedAt&&!clip.disabled&&!clip.deliveryBlocked&&
          JSON.stringify(clip.semanticReviewProof)===JSON.stringify(segment.semanticReviewProof)&&
          await approvedClipReusable(clip,source,segment,assertCurrent)){alreadyApproved=true;break;}
      }
      if(!alreadyApproved)segments.push(segment);
    }
    if(!segments.length||!(await assertCurrent()))return null;
    return {source:structuredClone(source),segmentIds:segments.map(segment=>segment.id),assertCurrent,isStateCurrent};
  }catch{return null;}
}
