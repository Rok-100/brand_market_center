import {createHash} from 'node:crypto';
import {outputBinding} from './output-review-binding.mjs';
import {HISTORICAL_SEQUENCE_VERSION,HISTORICAL_INVENTORY_JOB,historicalSnapshotDigest} from './historical-approved-inventory.mjs';
import {HISTORICAL_OUTPUT_RULES_POLICY} from './historical-output-rules.mjs';

export const OUTPUT_SEQUENCE_VERSION='source-interval-v1';
export const CLIP_BYTES_SEQUENCE_VERSION='clip-bytes-duration-v1';
export const OUTPUT_SEQUENCE_SEARCH_LIMIT=256;
const sha=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const sha256=value=>typeof value==='string'&&/^[a-f0-9]{64}$/i.test(value);
const fail=(code,message,details={})=>Object.assign(new Error(message),{code,sequencePreflight:details});
const validateIntervals=intervals=>Array.isArray(intervals)&&intervals.length>0&&intervals.every(row=>
  Array.isArray(row)&&row.length===3&&sha256(row[0])&&Number.isFinite(row[1])&&Number.isFinite(row[2])&&row[1]>=0&&row[2]>row[1]);
function canonicalIntervals(intervals){
  if(!validateIntervals(intervals))return null;
  const result=[];
  for(const [sha,start,end] of intervals){const previous=result.at(-1),hash=sha.toLowerCase();
    // Exactly adjacent playback only: no sort, tolerance, overlap or gap loss.
    if(previous&&previous[0]===hash&&previous[2]===start)previous[2]=end;
    else result.push([hash,start,end]);}
  return result;
}
function historicalIntervals(intervals){
  if(!Array.isArray(intervals)||!intervals.length||!intervals.every(row=>Array.isArray(row)&&row.length===4
    &&typeof row[0]==='string'&&row[0].length>0&&row[0].length<=160&&Number.isSafeInteger(row[1])&&row[1]>0
    &&Number.isFinite(row[2])&&Number.isFinite(row[3])&&row[2]>=0&&row[3]>row[2]))return null;
  const result=[];
  for(const [id,asset,start,end] of intervals){const previous=result.at(-1);
    if(previous&&previous[0]===id&&previous[1]===asset&&previous[3]===start)previous[3]=end;
    else result.push([id,asset,start,end]);}
  return result;
}
const validSequence=(sequence,jobId)=>sequence?.version===HISTORICAL_SEQUENCE_VERSION
  ?jobId===HISTORICAL_INVENTORY_JOB&&Boolean(historicalIntervals(sequence.intervals))
    &&JSON.stringify(sequence.intervals)===JSON.stringify(historicalIntervals(sequence.intervals))
    &&sequence.key===historicalSnapshotDigest({version:HISTORICAL_SEQUENCE_VERSION,intervals:sequence.intervals})
  :[OUTPUT_SEQUENCE_VERSION,CLIP_BYTES_SEQUENCE_VERSION].includes(sequence?.version)&&validateIntervals(sequence.intervals)
  &&JSON.stringify(sequence.intervals)===JSON.stringify(canonicalIntervals(sequence.intervals))
  &&sequence.key===sha([sequence.version,sequence.intervals]);

// Identity only, never approval: ordered source bytes and exact interval values.
// Clip IDs, role aliases, file names, review metadata and output encodings cannot
// manufacture a different composition. No rounding can collapse real cut points.
export function sourceIntervalSequence(clips,sources){
  if(!Array.isArray(clips)||!clips.length)return null;
  const byId=new Map((sources||[]).map(source=>[source.id,source]));
  const intervals=canonicalIntervals(clips.map(clip=>{const source=byId.get(clip?.sourceId);
    return [source?.contentSha256?.toLowerCase(),clip?.startSeconds,clip?.endSeconds];}));
  if(!intervals)return null;
  return {version:OUTPUT_SEQUENCE_VERSION,key:sha([OUTPUT_SEQUENCE_VERSION,intervals]),intervals};
}

// A measured cut is independently playable even when its unused whole original
// is no longer cached. This namespace is explicitly clip bytes, never a fake
// source-file hash; equal cut bytes cannot acquire a new identity by renaming.
export function clipBytesSequence(clips){
  if(!Array.isArray(clips)||!clips.length)return null;
  const intervals=canonicalIntervals(clips.map(clip=>[clip?.contentSha256?.toLowerCase(),0,clip?.durationSeconds]));
  return intervals?{version:CLIP_BYTES_SEQUENCE_VERSION,key:sha([CLIP_BYTES_SEQUENCE_VERSION,intervals]),intervals}:null;
}

// Only the original generation binding proves that a historical file used the
// current source bytes/ranges. A new review or an old approved badge cannot.
export function historicalSequence(render,variant,library){
  if(variant?.generationBinding?.version!==1||!sha256(variant.generationBinding.content))return null;
  const byId=new Map((library.clips||[]).map(clip=>[clip.id,clip]));
  const clips=(variant.clipSequence||[]).map(id=>byId.get(id));
  if(!clips.length||clips.some(clip=>!clip))return null;
  if(outputBinding(clips,library.sources||[],render.productCategory).content!==variant.generationBinding.content)return null;
  if(render.sourceEvidencePolicy===HISTORICAL_OUTPUT_RULES_POLICY&&validSequence(variant.contentSequenceIdentity,render.automation?.jobId))
    return variant.contentSequenceIdentity;
  if(variant.reviewMode==='automatic_basic'&&variant.contentSequenceIdentity?.version===CLIP_BYTES_SEQUENCE_VERSION
    &&validSequence(variant.contentSequenceIdentity,render.automation?.jobId))return variant.contentSequenceIdentity;
  return sourceIntervalSequence(clips,library.sources);
}

export function usedJobSequences(library,jobId){
  const job=library.autoJobs?.find(item=>item.id===jobId);
  const keys=new Set();let historicalCount=0,unprovenHistoryCount=0;
  for(const render of library.renders||[]){
    if(render.automation?.jobId!==jobId)continue;
    for(const variant of render.variants||[]){
      const sequence=historicalSequence(render,variant,library);
      if(sequence){keys.add(sequence.key);historicalCount++;}else unprovenHistoryCount++;
    }
  }
  if(job?.sequenceReservations!==undefined&&!Array.isArray(job.sequenceReservations))
    throw fail('OUTPUT_SEQUENCE_STATE_INVALID','序列预占记录格式异常，保留原任务，未开始新的渲染。');
  const reservations=job?.sequenceReservations||[];
  for(const record of reservations){
    if(!validSequence(record,jobId)||!record.runId||!record.renderId||!record.variantId||
      !['reserved','recorded'].includes(record.status))
      throw fail('OUTPUT_SEQUENCE_STATE_INVALID','序列预占记录校验失败，保留原任务与文件，未释放或覆盖记录。');
    keys.add(record.key);
  }
  return {keys,reservations,historicalCount,unprovenHistoryCount};
}

export function assertNoPendingSequence(library,jobId,runId){
  const state=usedJobSequences(library,jobId);
  const pending=state.reservations.filter(record=>record.status==='reserved');
  if(pending.length)throw fail('OUTPUT_SEQUENCE_PENDING','本批存在尚未确定保存结果的序列预占，原文件与任务已保留；未重复渲染或重新送审。',
    {pendingCount:pending.length,currentRunId:runId,runIds:[...new Set(pending.map(row=>row.runId))],renderIds:[...new Set(pending.map(row=>row.renderId))],sourceExpansion:false});
  return state;
}

// Called inside the existing serialized library-write transaction, after the
// ordinary current source/permission gates. Never releases on failure/restart.
export function reserveOutputSequence(library,{jobId,runId,renderId,variantId,sequence,at}){
  if(!validSequence(sequence,jobId))
    throw fail('SOURCE_EVIDENCE_MISSING','缺少可核验的真实来源序列，未预占或渲染。');
  const job=library.autoJobs?.find(item=>item.id===jobId);
  if(!job||job.status!=='active'||job.archivedAt||!job.runs?.some(run=>run.id===runId))
    throw fail('AUTOMATION_STOPPED','任务已暂停或批次失效，未预占新的序列。');
  const state=usedJobSequences(library,jobId);
  if(state.keys.has(sequence.key))throw fail('OUTPUT_SEQUENCE_CONFLICT','该真实来源序列已生成或已预占，未重复渲染或重新送审。',{sourceExpansion:false});
  const record={...structuredClone(sequence),runId,renderId,variantId,status:'reserved',createdAt:at};
  job.sequenceReservations||=[];job.sequenceReservations.push(record);
  return record;
}

export function recordOutputSequence(library,{jobId,runId,renderId,variantId,sequence,at}){
  usedJobSequences(library,jobId);
  const record=library.autoJobs?.find(job=>job.id===jobId)?.sequenceReservations?.find(item=>item.key===sequence?.key);
  if(!record||record.runId!==runId||record.renderId!==renderId||record.variantId!==variantId||record.status!=='reserved')
    throw fail('OUTPUT_SEQUENCE_STATE_INVALID','保存成片时序列预占不匹配，未覆盖原预占或审核。');
  record.status='recorded';record.recordedAt=at;
}

// A bounded round-robin search retains each opener and the real planner's
// ordering/quality rules. Different offsets are NOT assumed to be new content.
export function findUnseenDurationPlans({openingIds,limit,initialOffset=0,combinationCount,
  mappingAt,planAt,sequenceAt,isFeasible,usedKeys,maxChecks=OUTPUT_SEQUENCE_SEARCH_LIMIT}){
  const opens=[...new Set(openingIds)],chosen=new Set(),seen=new Set(usedKeys||[]),plans=[];
  const checksLimit=Math.min(OUTPUT_SEQUENCE_SEARCH_LIMIT,Math.max(1,Math.trunc(maxChecks)||1));
  const perOpener=Math.max(1,Math.floor(combinationCount)||1);
  let checked=0,feasibleCount=0,duplicateCount=0,invalidIdentityCount=0;
  for(let step=0;step<perOpener&&checked<checksLimit&&plans.length<limit;step++){
    for(let index=0;index<opens.length&&checked<checksLimit&&plans.length<limit;index++){
      const opener=opens[index];if(chosen.has(opener))continue;
      const offset=(initialOffset+index+step)%perOpener,mapping=mappingAt(opener,offset);
      const plan=planAt(mapping);checked++;
      if(!isFeasible(plan))continue;
      feasibleCount++;const sequence=sequenceAt(plan);
      if(!sequence){invalidIdentityCount++;continue;}
      if(seen.has(sequence.key)){duplicateCount++;continue;}
      plans.push({mapping,plan,sequence,offset});seen.add(sequence.key);chosen.add(opener);
    }
  }
  const searchLimited=checked>=checksLimit&&plans.length<limit&&checked<perOpener*opens.length;
  const reason=plans.length?null:invalidIdentityCount?'SOURCE_EVIDENCE_MISSING':!feasibleCount?'SOURCE_DURATION_GAP'
    :searchLimited?'OUTPUT_SEQUENCE_SEARCH_LIMIT':'OUTPUT_SEQUENCE_EXHAUSTED';
  return {plans,reason,checked,feasibleCount,duplicateCount,invalidIdentityCount,searchLimited,sourceExpansion:false};
}
