// Finite server-opted-in preparation only. This module never grants review,
// changes source records, clears an uncertain request, or invokes a provider.
export const PROGRESSIVE_SOURCE_VERSION='bounded-history-v1';
export const PROGRESSIVE_BATCH_LIMIT=3;
export const PROGRESSIVE_SOURCE_LIMIT=20;
export const PROGRESSIVE_OUTPUT_ATTEMPT_LIMIT=80;
const fail=(code,message)=>Object.assign(new Error(message),{code});
const unavailable=value=>!value||value.revoked===true||Boolean(value.revokedAt)||value.disabled===true||value.deliveryBlocked===true
 ||['rejected','changes_requested'].includes(value.reviewStatus);
const unique=values=>[...new Set(values.filter(value=>typeof value==='string'&&value))];
const terminalReasons=new Set(['content_attention','business_fact_attention']);
const definitiveVariant=v=>v.reviewStatus==='approved'||(v.automaticAssessment?.visualReview?.status==='review_required'
 &&v.automaticAssessment.visualReview.reason==='content_attention'&&v.automaticAssessment.visualReview.issues?.length>0);

export function progressiveOutputUsage(library,job){
 const renders=(library.renders||[]).filter(r=>r.automation?.jobId===job.id),known=new Set();
 let attempts=0,approved=0;
 for(const render of renders)for(const variant of render.variants||[]){attempts++;known.add(render.id+':'+variant.id);
  if(variant.reviewStatus==='approved')approved++;}
 for(const item of job.sequenceReservations||[])if(!known.has(item.renderId+':'+item.variantId))attempts++;
 return {attempts:Math.max(attempts,Number(job.progressiveSourcePreparation?.attemptedFloor)||0),approved,
  unresolved:(job.sequenceReservations||[]).some(row=>row.status==='reserved'),
  unknownReview:renders.some(r=>(r.variants||[]).some(v=>!definitiveVariant(v)))};
}

function validate(state){
 if(state?.version!==PROGRESSIVE_SOURCE_VERSION||state.batchLimit!==3||state.sourceLimit!==20||state.outputAttemptLimit!==80
  ||!Array.isArray(state.catalog)||state.catalog.length>10000||!Array.isArray(state.sourceIds)||state.sourceIds.length>20
  ||unique(state.sourceIds).length!==state.sourceIds.length||!Array.isArray(state.batches)
  ||!state.batches.every(batch=>Array.isArray(batch.sourceIds)&&batch.sourceIds.length<=3&&batch.sourceIds.every(id=>state.sourceIds.includes(id)))
  ||!state.catalog.every(row=>typeof row?.sourceId==='string'&&typeof row.key==='string'&&row.key)
  ||new Set(state.catalog.map(row=>row.sourceId)).size!==state.catalog.length)
  throw fail('PROGRESSIVE_SOURCE_STATE_INVALID','有限历史选源记录不完整，保留任务与已生成素材，未扩大来源。');
}

export function planProgressiveSourceBatch({library,job,run,catalog,eligibleSourceIds,hasUsablePool,at,structurallyIncompatibleSourceIds=[],verifiedAdditionalSourceIds=[],verifiedTechnicalTerminalSourceIds=[],pendingMaterializationSourceIds=[]}){
 if(job.status!=='active'||job.archivedAt)throw fail('AUTOMATION_STOPPED','任务已暂停，未递进选源。');
 const liveKeys=catalog.bindingKeysBySourceId||{},eligible=new Set(eligibleSourceIds);
 const incompatible=new Set(structurallyIncompatibleSourceIds);
 const oldIds=unique((job.runs||[]).flatMap(r=>[...(r.onDemandSourcePreparation?.sourceIds||[]),
  ...Object.keys(r.versionPreparationAttempts||{})]));
 if(oldIds.length>20)throw fail('PROGRESSIVE_SOURCE_STATE_INVALID','此任务原选源已超过本次20来源边界，未自动扩量。');
 let state=job.progressiveSourcePreparation?structuredClone(job.progressiveSourcePreparation):{
  version:PROGRESSIVE_SOURCE_VERSION,batchLimit:3,sourceLimit:20,outputAttemptLimit:80,
  catalog:unique([...oldIds,...eligibleSourceIds]).map(sourceId=>({sourceId,key:liveKeys[sourceId]||catalog.registrySha256,
    sourceSha256:library.sources.find(source=>source.id===sourceId)?.contentSha256||null})),
  sourceIds:oldIds,batches:[],attempts:{},attemptedFloor:0,createdAt:at};
 if(!state.batches.length&&oldIds.length){for(let i=0;i<oldIds.length;i+=3)state.batches.push({sourceIds:oldIds.slice(i,i+3),selectedAt:at,inherited:true});}
 validate(state);
 if(oldIds.some(id=>!state.sourceIds.includes(id)))throw fail('PROGRESSIVE_SOURCE_STATE_INVALID','原批次出现账本外来源，未继续扩大或重置累计计数。');
 const usage=progressiveOutputUsage(library,job);state.attemptedFloor=usage.attempts;
 if(usage.unresolved)throw fail('OUTPUT_SEQUENCE_PENDING','存在结果未确定的渲染预占，未轮换来源或重新生成。');
 if(usage.unknownReview)throw fail('PROGRESSIVE_REVIEW_PENDING','原成片仍有未确定或待处理审核，未换源绕过审核。');
 if(usage.attempts>=80)throw fail('PROGRESSIVE_ATTEMPT_LIMIT','本任务累计已达80次生成尝试上限，失败与中断也计入，未重置计数或继续收费。');
 if(usage.approved>=20)throw fail('PROGRESSIVE_TARGET_REACHED','本任务已有20条审核合格成片，未额外生成；回传与投放仍按原门禁继续。');
 for(const id of state.sourceIds){
  const source=(library.sources||[]).find(s=>s.id===id),registered=state.catalog.find(row=>row.sourceId===id);
  if(unavailable(source)||!eligible.has(id)||!registered||registered.key!==(liveKeys[id]||catalog.registrySha256)
    ||registered.sourceSha256&&registered.sourceSha256!==(source.contentSha256||null))
   throw fail('PROGRESSIVE_SOURCE_CHANGED','已选来源的权限、登记或状态已变化，保留原结果，未换来源或重做识别。');
  const attempts=(job.runs||[]).map(r=>r.versionPreparationAttempts?.[id]).filter(Boolean)
   .sort((a,b)=>(Date.parse(b.attemptedAt)||0)-(Date.parse(a.attemptedAt)||0));
  if(attempts[0])state.attempts[id]=structuredClone(attempts[0]);
 }
 const batch=state.batches.at(-1)?.sourceIds||[];
 if(!Array.isArray(verifiedTechnicalTerminalSourceIds)||verifiedTechnicalTerminalSourceIds.length>3
  ||unique(verifiedTechnicalTerminalSourceIds).length!==verifiedTechnicalTerminalSourceIds.length
  ||verifiedTechnicalTerminalSourceIds.some(id=>!batch.includes(id)))
  throw fail('PROGRESSIVE_SOURCE_STATE_INVALID','技术终态核验不属于当前原批次，未扩大来源。');
 const technicalTerminal=new Set(verifiedTechnicalTerminalSourceIds);
 if(!Array.isArray(pendingMaterializationSourceIds)||pendingMaterializationSourceIds.length>3
  ||unique(pendingMaterializationSourceIds).length!==pendingMaterializationSourceIds.length
  ||pendingMaterializationSourceIds.some(id=>!batch.includes(id)))
  throw fail('PROGRESSIVE_SOURCE_STATE_INVALID','缓存物化核验不属于当前固定原批次，未扩大来源。');
 const result=(action,sourceIds,reason)=>({state,action,sourceIds,reason,attempts:structuredClone(state.attempts)});
 // Current approved pools are reused before source work. The normal per-output
 // byte/current-proof gates still run; this flag is not approval by this helper.
 if(hasUsablePool)return result('reuse',batch,'current_pool_ready');
 if(pendingMaterializationSourceIds.length)return result('pending',batch,'current_batch_materialization_pending');
 const pending=batch.some(id=>{const a=state.attempts[id],source=library.sources.find(s=>s.id===id),review=source?.sourceSemanticReview;
  // This capability is supplied only by the current private runner verifier.
  // Never derive it from persisted complete/reason/technicalDisposition badges.
  // The original failure and source occupation remain in the copied ledger.
  if(technicalTerminal.has(id)&&a?.key===(liveKeys[id]||catalog.registrySha256)
    &&a.reason==='SOURCE_ASR_UNAVAILABLE'&&!review)return false;
  // A fresh private/probed structural exclusion is not content approval. It
  // cannot erase an old unknown/failed dispatch or unresolved provider state.
  if(incompatible.has(id)&&(!a||a.complete||a.reason==='SOURCE_DURATION_INFEASIBLE')
    &&(!a?.reason||a.reason==='SOURCE_DURATION_INFEASIBLE')
    &&(!review||(review.recoverable===false&&Array.isArray(review.pendingReasons)&&review.pendingReasons.every(reason=>terminalReasons.has(reason)))))return false;
  return !a?.complete||a.key!==(liveKeys[id]||catalog.registrySha256)||a.reason||!review
   ||review.recoverable!==false||!Array.isArray(review.pendingReasons)||review.pendingReasons.some(reason=>!terminalReasons.has(reason));});
 if(pending)return result('pending',batch,'current_batch_not_terminal');
 const remaining=20-state.sourceIds.length;
 if(remaining<=0)throw fail('PROGRESSIVE_SOURCE_LIMIT','本任务已准备20个历史来源，真实素材仍不足；已完成结果保留，未无限扫描或扩量。');
 // New registrations do not reset the frozen catalog or source ledger. The
 // server may append at most three IDs after current private/byte/probe checks;
 // this point is unreachable while an old batch/dispatch is unresolved.
 if(!Array.isArray(verifiedAdditionalSourceIds)||verifiedAdditionalSourceIds.length>3
  ||unique(verifiedAdditionalSourceIds).length!==verifiedAdditionalSourceIds.length)
  throw fail('PROGRESSIVE_SOURCE_STATE_INVALID','新增来源核验清单超出本轮有限边界，未扩大目录。');
 for(const sourceId of verifiedAdditionalSourceIds){
  if(state.catalog.some(row=>row.sourceId===sourceId))continue;
  const source=library.sources.find(row=>row.id===sourceId),key=liveKeys[sourceId];
  if(!eligible.has(sourceId)||unavailable(source)||typeof key!=='string'||!key
   ||state.catalog.length>=10000)
   throw fail('PROGRESSIVE_SOURCE_CHANGED','新增来源已撤销或目录已变化，未追加或重置账本。');
  state.catalog.push({sourceId,key,sourceSha256:source.contentSha256||null});
 }
 const next=state.catalog.filter(row=>!state.sourceIds.includes(row.sourceId)&&!incompatible.has(row.sourceId)&&eligible.has(row.sourceId)
  &&row.key===(liveKeys[row.sourceId]||catalog.registrySha256)).slice(0,Math.min(3,remaining)).map(row=>row.sourceId);
 if(!next.length&&incompatible.size)throw fail('PROGRESSIVE_SOURCE_DURATION_EXHAUSTED','当前已登记单原片均已使用或真实时长不适配本任务目标；未对短片继续收费、扩大来源或降低时长要求。');
 if(!next.length)throw fail('PROGRESSIVE_SOURCE_EXHAUSTED','已登记且当前可用的有限历史来源已用完，保留结果与审核原因，未扫描未授权来源。');
 state.sourceIds.push(...next);state.batches.push({sourceIds:next,selectedAt:at,reason:'terminal_shortfall'});
 return result('selected',next,'terminal_shortfall');
}
