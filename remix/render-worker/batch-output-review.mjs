import {visualTimeline,hasPassedVisualReview} from './output-quality.mjs';
import {LEGACY_MODE,hasLegacySourcePointer,hasLegacyClipPointer} from './legacy-source-evidence.mjs';
import {validateSourceSemanticProof} from './source-semantic-review.mjs';

const validSha = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const validSku = value => typeof value === 'string' && value.trim() === value && value.length > 0
 && value.length <= 160 && !/未确认|待核验|待确认|unknown|^(?:null|none|undefined)$/iu.test(value);
const clipSnapshotKeys = ['id','sourceId','storedName','contentSha256','startSeconds','endSeconds',
 'durationSeconds','productCategory','reviewStatus','reviewedAt','deliveryBlocked','boundaryEvidence',
 'visibility','createdById','createdByIds','role','text','transcript','tags','skuVersion','productVersionEvidence','semanticReviewProof',
 'legacySourceEvidence','automaticAssessment','revoked','revokedAt','disabled','versionId','filingNumber'];
const sourceSnapshotKeys = ['id','storedName','contentSha256','skuVersion','productCategory','visibility',
 'createdById','createdByIds','analysisRuleVersion','analysisAsrEvidence','speechSegments','productVersionEvidence','sourceSemanticReview',
 'legacySourceEvidence','reviewStatus','reviewedAt','deliveryBlocked','revoked','revokedAt','disabled','versionId','filingNumber'];
// Snapshot evidence, not mutable library references. Object property order is
// irrelevant, but array order and the actual approval/content values are not.
const canonical = value => value === undefined ? null : Array.isArray(value) ? value.map(canonical)
 : value && typeof value === 'object'
 ? Object.fromEntries(Object.keys(value).sort().map(key => [key,canonical(value[key])])) : value;
const pickSnapshot = (record, keys) => record
 ? Object.fromEntries(keys.map(key => [key,canonical(record[key])])) : null;
const unavailable = record => record?.revoked===true || Boolean(record?.revokedAt) || record?.disabled===true
 || record?.deliveryBlocked===true || ['rejected','changes_requested'].includes(record?.reviewStatus);
const legacyDeclared = (clip,source) => clip?.legacySourceEvidence?.mode===LEGACY_MODE || source?.legacySourceEvidence?.mode===LEGACY_MODE;
// This checks only current in-memory proof consistency. Actual permission,
// bytes and private receipt provenance still require the core service's
// verifyStoredProof before rendering, review, return, or delivery effects.
function currentLegacyClipReview(clip,source,trustedJobId) {
 if(!hasLegacyClipPointer(clip,source))return false;
 const segment=source.speechSegments?.find(row=>row.id===clip.automaticAssessment?.boundaryIntegrity?.segmentId);
 const proof=clip.semanticReviewProof,pointer=source.legacySourceEvidence;
 return Boolean(segment && proof?.sku?.mode===LEGACY_MODE && proof.sku.skuVersion===null
  && proof.sku.bindingSha256===pointer.bindingSha256 && proof.sku.profileSha256===pointer.profileSha256
  && JSON.stringify(canonical(proof.sku.sourceScope))===JSON.stringify(canonical(pointer.sourceScope))
  && validateSourceSemanticProof({proof,source,segment,skuContext:proof.sku,trustedJobId}));
}
const admissionResult = issues => {
 const priority = ['source_missing','source_approval_required','source_evidence_missing',
  'sku_or_source_binding','source_scope_mismatch','timeline_coverage','source_snapshot_missing'];
 return {ready:issues.length===0,reason:priority.find(reason=>issues.some(issue=>issue.reason===reason)) || issues[0]?.reason || null,issues};
};
const batchAdmissionResult = issues => {
 const result=admissionResult(issues);
 const summaryByReason={
  source_missing:'实际引用的切片或原来源记录不完整，保留当前文件与原审核记录，本条未自动放行。',
  source_approval_required:'实际引用的切片尚未有效批准或已禁用，保留原审核记录，本条未自动放行。',
  source_evidence_missing:'来源缺少已核验的源文件摘要、来源范围、ASR或切点依据，保留当前文件与原审核记录，等待真实证据补齐。',
  sku_or_source_binding:'实际引用的源文件、来源范围、ASR或切点依据未一致绑定，保留当前文件与原审核记录，本条未自动放行。',
  source_scope_mismatch:'实际引用的来源与切片产品范围不一致，通用分类不能替代真实来源依据，本条未自动放行。',
  timeline_coverage:'实际引用的切点或时长未保持完整一致，保留当前文件与原审核记录，本条未自动放行。',
  source_snapshot_missing:'缺少可核对的原始输入快照，保留当前文件与原审核记录，本条未自动放行。',
 };
 return {...result,summary:result.ready?'实际引用的来源证据满足审核准入；成片仍须通过独立质量复核。'
  :summaryByReason[result.reason] || '来源证据未满足自动审核准入，保留当前文件与原审核记录，本条未自动放行。'};
};

// This is usable before FFmpeg or any paid visual request. An approved legacy
// clip is not a fabricated SKU/ASR/boundary receipt; report missing evidence as
// missing, not as a change which happened during a later request.
export function diagnoseClipReviewAdmission(clips,sources,{product,skuVersion,trustedJobId}={}) {
 const byId = new Map((sources || []).map(source => [source.id,source]));
 const issues = [], seenSkus = new Set(),legacySources=new Set();
 const add = (clip,reason,field) => issues.push({clipId:clip?.id || null,sourceId:clip?.sourceId || null,reason,field});
 if (!Array.isArray(clips) || !clips.length) return admissionResult([{reason:'source_missing',field:'clips',clipId:null,sourceId:null}]);
 for (const clip of clips) {
  const source = clip && byId.get(clip.sourceId);
  if (!clip || !source) { add(clip,'source_missing',clip?'source':'clip'); continue; }
  if (clip.reviewStatus!=='approved' || unavailable(clip) || unavailable(source)) add(clip,'source_approval_required','reviewStatus');
  if (!validSha(source.contentSha256)) add(clip,'source_evidence_missing','source.contentSha256');
  if(legacyDeclared(clip,source)) {
   legacySources.add(JSON.stringify([source.id,source.contentSha256]));
   if(!hasLegacySourcePointer(source))add(clip,'source_evidence_missing','source.legacySourceEvidence');
   if(!hasLegacyClipPointer(clip,source))add(clip,'source_evidence_missing','clip.legacySourceEvidence');
   else if(!currentLegacyClipReview(clip,source,trustedJobId))add(clip,'source_approval_required','clip.semanticReviewProof');
  } else {
   if (!validSku(source.skuVersion)) add(clip,'source_evidence_missing','source.skuVersion');
   else seenSkus.add(source.skuVersion);
   for (const [field,evidence] of [['source.analysisAsrEvidence',source.analysisAsrEvidence],['clip.boundaryEvidence',clip.boundaryEvidence]]) {
    if (!validSku(evidence?.skuVersion) || !validSha(evidence?.sourceSha256)) add(clip,'source_evidence_missing',field);
    else if (evidence.skuVersion!==source.skuVersion || evidence.sourceSha256!==source.contentSha256)
     add(clip,'sku_or_source_binding',field);
   }
  }
  if (skuVersion!==undefined && source.skuVersion!==skuVersion) add(clip,'sku_or_source_binding','source.skuVersion');
  const expectedProduct = product || source.productCategory;
  if (!expectedProduct || expectedProduct==='通用切片' || source.productCategory!==expectedProduct)
   add(clip,'source_scope_mismatch','source.productCategory');
  if (!clip.productCategory || clip.productCategory!==expectedProduct)
   add(clip,'source_scope_mismatch','clip.productCategory');
  if (![clip.startSeconds,clip.endSeconds,clip.durationSeconds].every(Number.isFinite)
   || clip.startSeconds<0 || clip.durationSeconds<=0 || Math.abs(clip.endSeconds-clip.startSeconds-clip.durationSeconds)>.02)
   add(clip,'timeline_coverage','clip.range');
 }
 if (seenSkus.size>1) issues.push({reason:'sku_or_source_binding',field:'batch.skuVersion',clipId:null,sourceId:null});
 if(legacySources.size>1)issues.push({reason:'sku_or_source_binding',field:'composition.legacySource',clipId:null,sourceId:null});
 if(legacySources.size && seenSkus.size)issues.push({reason:'sku_or_source_binding',field:'composition.mixedSourceModes',clipId:null,sourceId:null});
 return admissionResult(issues);
}

export function diagnoseSourceAdmission({clips,sources,product,skuVersion,trustedJobId}) {
 const result=diagnoseClipReviewAdmission(clips,sources,{product,skuVersion,trustedJobId});
 const summaries={
  source_missing:'所需原视频或切片记录缺失，等待恢复原始来源后复核；未开始无效渲染。',
  source_approval_required:'所需切片未获有效批准或已禁用，保留原审核状态，等待合格库存。',
  source_evidence_missing:'历史来源缺少已核验的源文件哈希、来源范围、ASR或切点依据，正在等待真实证据补齐；未渲染、未自动放行。',
  sku_or_source_binding:'来源、ASR与切点证据未保持一致来源范围，需核对实际原片与已确认版本；未渲染、未自动放行。',
  source_scope_mismatch:'当前组合不是同一已核验产品的完整来源范围；通用归类不代替真实来源依据，等待合格库存。',
  timeline_coverage:'原切点与时长不一致，需按真实音轨和帧时间重新校准；未渲染。',
 };
 return {...result,summary:result.ready?'实际选用切片具备一致来源范围、真实ASR切点和当前内容复核；仍须独立审核新成片。':summaries[result.reason] || '来源证据尚未满足自动审核准入，未开始无效渲染。'};
}

export function batchOutputInput({outputId,filePath,assessment,clips,sources,sourcePath,trustedJobId}){
 const byId=new Map(sources.map(s=>[s.id,s]));
 const singleTimeline=visualTimeline(clips,sources),sourceFiles=[];
 const timeline=singleTimeline.map((item,i)=>{
  const clip=clips[i],source=byId.get(clip.sourceId);
  // Only an exact SKU binding already verified with this source's ASR receipt
  // can enter automatic pair review. A product title is not a SKU approval.
  const skuVersion=source?.skuVersion&&source.analysisAsrEvidence?.skuVersion===source.skuVersion&&source.analysisAsrEvidence?.sourceSha256===source.contentSha256?source.skuVersion:null;
  const legacy=legacyDeclared(clip,source),scope=legacy?canonical(source?.legacySourceEvidence?.sourceScope):null;
  const legacyFields=legacy?{sourceMode:LEGACY_MODE,sourceScope:scope}:{};
  if(source&&!sourceFiles.some(s=>s.sourceId===source.id))sourceFiles.push({sourceId:source.id,sha256:source.contentSha256,skuVersion,product:source.productCategory,filePath:sourcePath(source),...legacyFields});
  const boundaryMatches=legacy?currentLegacyClipReview(clip,source,trustedJobId)
   :clip.boundaryEvidence?.skuVersion===skuVersion&&clip.boundaryEvidence?.sourceSha256===source?.contentSha256;
  return {...item,clipCategory:clip.productCategory,sourceProductCategory:source?.productCategory,sourceId:clip.sourceId,sourceSha256:source?.contentSha256,skuVersion,sourceStartSeconds:clip.startSeconds,sourceEndSeconds:clip.endSeconds,
   clipApproved:clip.reviewStatus==='approved'&&!unavailable(clip)&&!unavailable(source)&&boundaryMatches,...legacyFields};
 });
 const inputSnapshot = {version:1,items:clips.map(clip=>({clip:pickSnapshot(clip,clipSnapshotKeys),source:pickSnapshot(byId.get(clip.sourceId),sourceSnapshotKeys)}))};
 const legacy=timeline.some(item=>item.sourceMode===LEGACY_MODE);
 return {outputId,filePath,sha256:assessment.sha256,technicalPassed:assessment.assessment.checks.filter(c=>c.name!=='成片内容复核').every(c=>c.passed),timeline,singleTimeline,sourceFiles,inputSnapshot,
  ...(legacy?{sourceMode:LEGACY_MODE,pairReviewEligible:false}:{} )};
}

export function applyBatchOutputReview(variant,review){
 const previous=variant.automaticAssessment;
 const safeReview=review?.sha256===variant.contentSha256?review:{status:'review_required',reason:'batch_output_missing',summary:'该成片缺少完整绑定的独立复核回执。'};
 const checks=previous.checks.filter(c=>c.name!=='成片内容复核');
 checks.push({name:'成片内容复核',passed:hasPassedVisualReview({visualReview:safeReview},variant.contentSha256),detail:safeReview.summary});
 const status=!checks.slice(0,4).every(c=>c.passed)?'failed':checks.every(c=>c.passed)?'passed':'review_required';
 const failed=checks.filter(c=>!c.passed),passed=status==='passed';
 variant.automaticAssessment={...previous,status,mode:'rules_and_visual',visualReview:safeReview,checks,score:Math.round(checks.filter(c=>c.passed).length/checks.length*100),reasons:failed.map(c=>`${c.name}：${c.detail}`),suggestions:failed.map(c=>`修复“${c.name}”后重新审核。`),recommendation:passed?'approve':status==='failed'?'reject':'manual_review',autoApproved:passed,assessedAt:new Date().toISOString()};
 variant.reviewStatus=passed?'approved':'changes_requested';
 variant.reviewNote=passed?`自动成片审核通过（${variant.automaticAssessment.score}分）：技术检查与本片全部抽帧复核通过；保留同原批及一致来源范围的独立回执。`:`自动成片待复核：${safeReview.summary}`;
 variant.reviewedAt=new Date().toISOString();
 return variant;
}

// Only actual referenced inputs participate. Absence of evidence in BOTH the
// original snapshot and current library is not an asynchronous source change.
export function compareBatchInputSnapshot(inputs,library) {
 const sources=new Map((library?.sources || []).map(s=>[s.id,s])),clips=new Map((library?.clips || []).map(c=>[c.id,c]));
 const changes=[];
 if (!Array.isArray(inputs) || !inputs.length) return {changed:true,changes:[{reason:'source_snapshot_missing',field:'inputs'}]};
 for (const input of inputs) {
  if (input.inputSnapshot?.version!==1 || !input.inputSnapshot.items?.length
   || input.inputSnapshot.items.length!==input.timeline?.length) {
   changes.push({outputId:input.outputId,reason:'source_snapshot_missing',field:'inputSnapshot'}); continue;
  }
  for (const [index,previous] of input.inputSnapshot.items.entries()) {
   const clipId=previous.clip?.id, sourceId=previous.clip?.sourceId;
   if (clipId!==input.timeline[index].clipId || sourceId!==input.timeline[index].sourceId)
    changes.push({outputId:input.outputId,clipId,sourceId,reason:'source_snapshot_missing',field:'inputSnapshot.timeline'});
   for (const [entity,keys,record] of [['clip',clipSnapshotKeys,clips.get(clipId)],['source',sourceSnapshotKeys,sources.get(sourceId)]]) {
    const current=pickSnapshot(record,keys), before=previous[entity];
    if (!current || !before) {
     if (JSON.stringify(current)!==JSON.stringify(before)) changes.push({outputId:input.outputId,clipId,sourceId,reason:'source_binding_changed',field:entity});
     continue;
    }
    for (const key of keys) if (JSON.stringify(current[key])!==JSON.stringify(before[key]))
     changes.push({outputId:input.outputId,clipId,sourceId,reason:'source_binding_changed',field:`${entity}.${key}`});
   }
  }
 }
 return {changed:changes.length>0,changes};
}

export function diagnoseBatchInputAdmission(inputs,library,options={}) {
 const sources=new Map((library?.sources || []).map(s=>[s.id,s])),clips=new Map((library?.clips || []).map(c=>[c.id,c]));
 const issues=[];
 if (!Array.isArray(inputs) || !inputs.length) return batchAdmissionResult([{reason:'source_missing',field:'inputs'}]);
 for (const input of inputs) {
  const timeline=Array.isArray(input.timeline)?input.timeline:[];
  const referenced=timeline.map(item=>clips.get(item.clipId));
  issues.push(...diagnoseClipReviewAdmission(referenced,library?.sources || [],options).issues.map(issue=>({...issue,outputId:input.outputId})));
  for (const item of timeline) {
   const source=sources.get(item.sourceId),clip=clips.get(item.clipId);
   const sourceFile=input.sourceFiles?.find(file=>file.sourceId===item.sourceId);
   const fields=[];
   if (!source || !clip) continue;
   if (clip.sourceId!==item.sourceId || clip.durationSeconds!==item.duration || clip.startSeconds!==item.sourceStartSeconds
    || clip.endSeconds!==item.sourceEndSeconds || clip.role!==item.role) fields.push('timeline.clip');
   // sourceCategory remains the historical model/cache field for the CLIP
   // category. Never compare it to the source category as though they were one.
   if (clip.productCategory!==item.clipCategory || clip.productCategory!==item.sourceCategory) fields.push('timeline.clipCategory');
   if (source.productCategory!==item.sourceProductCategory || source.productCategory!==sourceFile?.product) fields.push('timeline.sourceProductCategory');
   if (source.contentSha256!==item.sourceSha256 || source.skuVersion!==item.skuVersion
    || sourceFile?.sha256!==item.sourceSha256 || sourceFile?.skuVersion!==item.skuVersion || item.clipApproved!==true) fields.push('timeline.evidence');
   if(legacyDeclared(clip,source)) {
    const scope=JSON.stringify(canonical(source.legacySourceEvidence?.sourceScope));
    if(item.sourceMode!==LEGACY_MODE || sourceFile?.sourceMode!==LEGACY_MODE || input.sourceMode!==LEGACY_MODE
      || input.pairReviewEligible!==false || JSON.stringify(canonical(item.sourceScope))!==scope
      || JSON.stringify(canonical(sourceFile?.sourceScope))!==scope)fields.push('timeline.legacySourceScope');
   } else if(item.sourceMode===LEGACY_MODE || sourceFile?.sourceMode===LEGACY_MODE || input.sourceMode===LEGACY_MODE)fields.push('timeline.mixedSourceModes');
   for (const field of fields) issues.push({outputId:input.outputId,clipId:item.clipId,sourceId:item.sourceId,reason:'sku_or_source_binding',field});
  }
 }
 const skuVersions=new Set(inputs.flatMap(input=>(input.sourceFiles || []).map(source=>source.skuVersion)).filter(validSku));
 if (skuVersions.size>1) issues.push({reason:'sku_or_source_binding',field:'batch.skuVersion'});
 return batchAdmissionResult(issues);
}

export function batchInputsStillApproved(inputs,library,options={}){
 return diagnoseBatchInputAdmission(inputs,library,options).ready && !compareBatchInputSnapshot(inputs,library).changed;
}
