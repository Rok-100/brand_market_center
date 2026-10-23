import {validateCompositionVersionEvidence} from './product-version-contract.mjs';
import {LEGACY_MODE,hasLegacySourcePointer,hasLegacyClipPointer,legacyEvidenceDigest,
  legacySourceSnapshot,legacyClipSnapshot} from './legacy-source-evidence.mjs';

const denied = reason => Object.assign(new Error(`正式商品版本或逐段审核依据缺失/变化（${reason}），保留原素材；未继续生成、回传或投放。`),
  {code:'SOURCE_EVIDENCE_MISSING',statusCode:409,admission:{reason}});
const sha = value => typeof value==='string' && /^[a-f0-9]{64}$/.test(value);
const scopeKeys = ['mode','revisionSha256','sourceId','sourceSha256'];
const scopeValid = value => value && typeof value==='object' && !Array.isArray(value)
  && [Object.prototype,null].includes(Object.getPrototypeOf(value))
  && Object.keys(value).sort().join('|')===scopeKeys.join('|') && value.mode===LEGACY_MODE
  && typeof value.sourceId==='string' && value.sourceId.length>0 && value.sourceId.length<=256
  && sha(value.sourceSha256) && sha(value.revisionSha256);
const digest = value => {try{return legacyEvidenceDigest(value);}catch{throw denied('legacy_evidence_invalid');}};
const pointerCheck = (check,...args) => {try{return check(...args);}catch{throw denied('legacy_evidence_invalid');}};

function legacyContext(source,validation) {
  const context=validation?.skuContext,scope=context?.sourceScope,pointer=source?.legacySourceEvidence;
  if (validation?.ready!==true || context?.mode!==LEGACY_MODE || context.skuVersion!==null
    || context.productCategory!==source?.productCategory || !scopeValid(scope)
    || scope.sourceId!==source.id || scope.sourceSha256!==source.contentSha256
    || !sha(context.bindingSha256) || context.bindingSha256!==scope.revisionSha256 || !sha(context.profileSha256)
    || validation.bindingSha256!==undefined && validation.bindingSha256!==context.bindingSha256)
    throw denied('legacy_private_context_missing');
  // Library pointers establish consistency only. Authority comes from the
  // private resolver and each selected segment's current verifyStoredProof.
  if (!pointerCheck(hasLegacySourcePointer,source) || pointer.bindingSha256!==context.bindingSha256
    || pointer.profileSha256!==context.profileSha256 || digest(pointer.sourceScope)!==digest(scope))
    throw denied('legacy_source_binding_changed');
  return structuredClone(context);
}

function legacySnapshots(clips,byId,contexts) {
  return clips.map(clip=>({mode:LEGACY_MODE,source:legacySourceSnapshot(byId.get(clip.sourceId)),
    clip:legacyClipSnapshot(clip),context:structuredClone(contexts.get(clip.sourceId)),
    sourcePointer:structuredClone(byId.get(clip.sourceId).legacySourceEvidence),
    clipPointer:structuredClone(clip.legacySourceEvidence),segmentId:clip.automaticAssessment.boundaryIntegrity.segmentId}));
}

function legacyComposition(clips,byId,validations,clipHashes,contexts) {
  if ([...validations.values()].some(value=>value?.skuContext?.mode!==LEGACY_MODE))
    throw denied('legacy_mixed_admission_modes');
  const origins=new Set(clips.map(clip=>clip.sourceId));
  if (origins.size!==1) throw denied('legacy_multiple_sources');
  const ids=new Set();
  for (const clip of clips) {
    if (typeof clip.id!=='string' || !clip.id || clip.id.length>256) throw denied('clip_missing');
    if (ids.has(clip.id)) throw denied('duplicate_clip');
    ids.add(clip.id);
    const source=byId.get(clip.sourceId),context=legacyContext(source,validations.get(source.id));
    if (!pointerCheck(hasLegacyClipPointer,clip,source)) throw denied('legacy_clip_binding_changed');
    if (!sha(clipHashes.get(clip.id)) || clipHashes.get(clip.id)!==clip.contentSha256
      || clipHashes.get(clip.id)!==clip.legacySourceEvidence.clipSha256) throw denied('clip_binding_changed');
    contexts.set(source.id,context);
  }
  const sourceId=[...origins][0],snapshots=legacySnapshots(clips,byId,contexts);
  return {ready:true,reason:null,issues:[],kind:'legacy-composition-validation',mode:LEGACY_MODE,
    skuVersion:null,sourceId,sourceSha256:byId.get(sourceId).contentSha256,
    snapshotSha256:digest(snapshots),snapshots};
}

// No approval is derived from library flags. The callbacks must read the
// deployment-owned registry, review receipts and actual media bytes.
export async function assertVersionedComposition({clips,sources,resolveSource,verifySegment,hashClip,assertCurrent=async()=>true}) {
  if (!Array.isArray(clips) || !clips.length || clips.some(clip=>!clip)) throw denied('clip_missing');
  const byId=new Map(sources.map(source=>[source.id,source]));
  const validations=new Map(),clipHashes=new Map(),legacyContexts=new Map();
  if ((await assertCurrent())!==true) throw denied('task_or_library_changed');
  for (const clip of clips) {
    const source=byId.get(clip.sourceId);
    if (!source || source.productCategory!=='黑晶面膜') throw denied('source_version_binding_missing');
    let validation=validations.get(source.id);
    if (!validation) {
      validation=await resolveSource(source);
      if (!validation?.ready) throw denied('source_version_binding_missing');
      if (validation.skuContext?.mode===LEGACY_MODE) {
        try { validation=structuredClone(validation); } catch { throw denied('legacy_evidence_invalid'); }
      }
      validations.set(source.id,validation);
    }
    const segment=source.speechSegments?.find(item=>item.id===clip.automaticAssessment?.boundaryIntegrity?.segmentId &&
      Math.abs(item.startSeconds-clip.startSeconds)<1e-6 && Math.abs(item.endSeconds-clip.endSeconds)<1e-6);
    if (!segment || (await verifySegment(source,segment,assertCurrent))!==true) throw denied('source_content_review_changed');
    clipHashes.set(clip.id,await hashClip(clip));
  }
  const legacy=[...validations.values()].some(value=>value?.skuContext?.mode===LEGACY_MODE);
  const result=legacy ? legacyComposition(clips,byId,validations,clipHashes,legacyContexts)
    : validateCompositionVersionEvidence({clips,sourceValidations:validations,actualClipSha256ById:clipHashes});
  if (!result.ready) throw denied(result.issues[0]?.reason || 'version_evidence_missing');
  // Recheck after all asynchronous reads, not merely before the first clip.
  if ((await assertCurrent())!==true) throw denied('task_or_library_changed');
  for (const [sourceId,previous] of validations) {
    const current=await resolveSource(byId.get(sourceId));
    if (!current?.ready || current.bindingSha256!==previous.bindingSha256 || current.registrySha256!==previous.registrySha256)
      throw denied('source_binding_changed');
    if (legacy && digest(legacyContext(byId.get(sourceId),current))!==digest(legacyContexts.get(sourceId)))
      throw denied('source_binding_changed');
  }
  if (legacy && digest(legacySnapshots(clips,byId,legacyContexts))!==result.snapshotSha256)
    throw denied('source_binding_changed');
  if ((await assertCurrent())!==true) throw denied('task_or_library_changed');
  return result;
}
