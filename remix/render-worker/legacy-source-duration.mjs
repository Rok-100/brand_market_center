import {createHash} from 'node:crypto';

export const LEGACY_DURATION_POLICY='legacy-source-duration-v1';
const sha=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const positive=value=>typeof value==='number'&&Number.isFinite(value)&&value>0;
const fail=(code,message)=>Object.assign(new Error(message),{code});
export const isLegacyDurationError=error=>[
  'SOURCE_DURATION_INFEASIBLE','SOURCE_DURATION_EVIDENCE_UNAVAILABLE',
  'SOURCE_DURATION_METADATA_MISMATCH','SOURCE_DURATION_INPUT_CHANGED',
].includes(error?.code);

export function legacyDurationRequest({source,sourceScope,bindingSha256,targetDurationSeconds}){
  if(!source?.id||sourceScope?.mode!=='legacy_single_source'||sourceScope.sourceId!==source.id
    ||!sha(sourceScope.sourceSha256)||!sha(bindingSha256)||sourceScope.revisionSha256!==bindingSha256
    ||(source.contentSha256!=null&&source.contentSha256!==sourceScope.sourceSha256)
    ||!positive(source.durationSeconds)||!Number.isInteger(targetDurationSeconds)
    ||targetDurationSeconds<30||targetDurationSeconds>180)
    throw fail('SOURCE_DURATION_EVIDENCE_UNAVAILABLE','单原片时长或当前来源依据不完整，未进行识别或付费内容审核。');
  const minimumDurationSeconds=targetDurationSeconds-Math.max(3,targetDurationSeconds*.08);
  const key=createHash('sha256').update(JSON.stringify([LEGACY_DURATION_POLICY,source.id,sourceScope.sourceSha256,targetDurationSeconds])).digest('hex');
  return {version:LEGACY_DURATION_POLICY,key,sourceId:source.id,sourceSha256:sourceScope.sourceSha256,
    bindingSha256,targetDurationSeconds,minimumDurationSeconds,metadataDurationSeconds:source.durationSeconds};
}

export function evaluateLegacyDuration(request,media){
  if(media?.hasVideo!==true||!positive(media.duration))
    throw fail('SOURCE_DURATION_EVIDENCE_UNAVAILABLE','无法真实探测单原片视频时长，未把未知时长当作短片或继续付费审核。');
  if(Math.abs(media.duration-request.metadataDurationSeconds)>.1+1e-9)
    throw fail('SOURCE_DURATION_METADATA_MISMATCH','单原片真实探测时长与库内元数据不一致，保留原记录并停止付费审核。');
  return {...request,probedDurationSeconds:media.duration,
    status:media.duration<request.minimumDurationSeconds?'structural_incompatible':'feasible',
    approvalGranted:false,contentRejected:false};
}

export async function probeLegacySourceDuration({source,sourceScope,bindingSha256,targetDurationSeconds,cached,
  inspectSource,hashSource,assertCurrent}){
  const request=legacyDurationRequest({source,sourceScope,bindingSha256,targetDurationSeconds});
  const current=async()=>{if(typeof assertCurrent!=='function'||!(await assertCurrent()))
    throw fail('SOURCE_DURATION_INPUT_CHANGED','时长核验期间任务已暂停、权限或原片发生变化，未继续处理。');};
  await current();
  const before=await hashSource();await current();
  if(before!==request.sourceSha256)throw fail('SOURCE_DURATION_INPUT_CHANGED','真实原片摘要与当前私有来源不一致，未继续时长核验或付费审核。');
  if(cached&&Object.keys(request).every(key=>cached[key]===request[key])){
    const checked=evaluateLegacyDuration(request,{hasVideo:true,duration:cached.probedDurationSeconds});
    if(checked.status===cached.status&&cached.approvalGranted===false&&cached.contentRejected===false)
      return {...checked,cacheReused:true};
  }
  let media;
  try{media=await inspectSource();}catch{throw fail('SOURCE_DURATION_EVIDENCE_UNAVAILABLE','单原片本地媒体探测失败，未调用识别或付费审核。');}
  await current();
  const after=await hashSource();await current();
  if(after!==before)throw fail('SOURCE_DURATION_INPUT_CHANGED','真实原片在时长探测期间发生变化，未保存时长依据或继续付费审核。');
  return {...evaluateLegacyDuration(request,media),cacheReused:false};
}

export function incompatibleDurationError(evidence){
  return Object.assign(fail('SOURCE_DURATION_INFEASIBLE',
    `单原片真实时长 ${evidence.probedDurationSeconds} 秒，低于 ${evidence.targetDurationSeconds} 秒目标的既有最低值 ${evidence.minimumDurationSeconds} 秒；属于结构不适配，未进行识别或付费内容审核。`),
    {durationFeasibility:evidence});
}
