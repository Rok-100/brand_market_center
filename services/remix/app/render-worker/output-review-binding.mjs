import {createHash} from 'node:crypto';
import {compositionFingerprint} from './composition-integrity.mjs';
import {HISTORICAL_OUTPUT_REVIEW_MODE,HISTORICAL_OUTPUT_RULES_POLICY} from './historical-output-rules.mjs';
import {HISTORICAL_INVENTORY_JOB,HISTORICAL_REFERENCE_SHA256,historicalSnapshotDigest} from './historical-approved-inventory.mjs';
import {BASIC_REVIEW_MODE} from './basic-automatic-review.mjs';

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const automaticallyReviewed = variant => !['human', 'legacy', 'manual_pending'].includes(variant.reviewMode)
  && (variant.reviewMode===BASIC_REVIEW_MODE || variant.reviewMode===HISTORICAL_OUTPUT_REVIEW_MODE || Boolean(variant.automaticAssessment?.visualReview));

// Keep generation evidence separate from review evidence: reviewing new metadata
// must never pretend that an old MP4 contains new source bytes or cut points.
export function outputBinding(clips, sources, product) {
  const byId = new Map(sources.map(source => [source.id, source]));
  return {
    version: 1,
    content: digest([product, clips.map(clip => {
      const source = byId.get(clip.sourceId);
      return [clip.id, clip.storedName, clip.contentSha256, clip.sourceId,
        clip.startSeconds, clip.endSeconds, clip.durationSeconds,
        source?.storedName, source?.contentSha256];
    })]),
    review: compositionFingerprint(clips, sources),
  };
}

// An absent original-source hash may be measured later without changing the
// already rendered cuts. Only exact server-recorded generation snapshots can
// identify that metadata-only addition; actual cut bytes are still checked by
// verifyBasicInputFiles before approval/dispatch. Never rebind changed content.
function sourceHashBackfillBinding(render,variant,library,clips){
  const proof=variant.historicalInventoryReview,job=library.autoJobs?.find(row=>row.id===render.automation?.jobId);
  if(![HISTORICAL_OUTPUT_REVIEW_MODE,BASIC_REVIEW_MODE].includes(variant.reviewMode)
    ||render.sourceEvidencePolicy!==HISTORICAL_OUTPUT_RULES_POLICY||render.automation?.jobId!==HISTORICAL_INVENTORY_JOB
    ||job?.createdById!=='FD-026222'||render.createdById!==job.createdById
    ||proof?.version!==HISTORICAL_OUTPUT_RULES_POLICY||proof.jobId!==render.automation.jobId||proof.runId!==render.automation.runId
    ||proof.outputSha256!==variant.contentSha256||proof.input?.referenceSha256!==HISTORICAL_REFERENCE_SHA256
    ||proof.inputSha256!==historicalSnapshotDigest(proof.input)
    ||historicalSnapshotDigest(proof.generationBinding)!==historicalSnapshotDigest(variant.generationBinding))return null;
  const evidence=proof.input.evidence;
  if(!Array.isArray(evidence)||evidence.length!==clips.length)return null;
  const oldClips=[],oldSources=[],sources=new Map(library.sources.map(source=>[source.id,source])),backfills=[];
  for(let index=0;index<clips.length;index++){
    const clip=clips[index],item=evidence[index],oldClip=item?.snapshot?.clip,oldSource=item?.snapshot?.source,source=sources.get(clip.sourceId);
    if(!oldClip||!oldSource||!source||item.clipId!==clip.id||item.sourceId!==source.id||oldClip.id!==clip.id
      ||oldClip.sourceId!==source.id||oldSource.id!==source.id||item.snapshotSha256!==historicalSnapshotDigest(item.snapshot)
      ||!/^[a-f0-9]{64}$/.test(item.currentClipSha256||'')||item.currentClipSha256!==item.snapshot.currentMedia?.sha256)return null;
    oldClips.push(oldClip);oldSources.push(oldSource);
    if(oldSource.contentSha256==null&&/^[a-f0-9]{64}$/.test(source.contentSha256||'')){
      backfills.push({sourceId:source.id,sha256:source.contentSha256});sources.set(source.id,{...source,contentSha256:oldSource.contentSha256});
    }
  }
  if(!backfills.length||outputBinding(oldClips,oldSources,render.productCategory).content!==variant.generationBinding.content)return null;
  const current=outputBinding(clips,[...sources.values()],render.productCategory);
  return current.content===variant.generationBinding.content?{current,sourceHashBackfills:[...new Map(backfills.map(row=>[row.sourceId,row])).values()]}:null;
}

export function bindingState(render, variant, library) {
  const byId = new Map(library.clips.map(clip => [clip.id, clip]));
  const clips = (variant.clipSequence || []).map(id => byId.get(id));
  if (!clips.length || clips.some(clip => !clip)) return {reason: 'source_missing', clips: []};
  let current = outputBinding(clips, library.sources, render.productCategory);
  if(variant.basicSourceHashBackfills!=null&&(!Array.isArray(variant.basicSourceHashBackfills)
    ||variant.basicSourceHashBackfills.some(row=>!/^[a-f0-9]{64}$/.test(row?.sha256||'')
      ||library.sources.find(source=>source.id===row.sourceId)?.contentSha256!==row.sha256)))
    return {reason:'source_content_changed',current,clips};
  if (!variant.generationBinding || !variant.reviewBinding)
    return {reason: 'generation_evidence_missing', current, clips};
  const compatibility=variant.generationBinding.version===1&&variant.generationBinding.content!==current.content
    ?sourceHashBackfillBinding(render,variant,library,clips):null;
  if(compatibility)current=compatibility.current;
  const compatibilityDetails=compatibility?{sourceHashBackfills:compatibility.sourceHashBackfills,
    sourceHashBackfillPending:compatibility.sourceHashBackfills.some(row=>!variant.basicSourceHashBackfills?.some(pin=>pin.sourceId===row.sourceId&&pin.sha256===row.sha256))}:{};
  if (variant.generationBinding.version !== 1 || variant.generationBinding.content !== current.content)
    return {reason: 'source_content_changed', current, clips};
  if ((variant.reviewMode !== BASIC_REVIEW_MODE && variant.reviewBinding.review !== current.review) || variant.reviewBinding.content !== current.content)
    return {reason: 'source_review_changed', current, clips,...compatibilityDetails};
  return {reason: null, current, clips,...compatibilityDetails};
}

export function assertCurrentAutomaticReview(render, variant, library) {
  if (!render.automation || !automaticallyReviewed(variant)) return;
  const state = bindingState(render, variant, library);
  if(variant.reviewMode===BASIC_REVIEW_MODE&&state.sourceHashBackfillPending)
    throw Object.assign(new Error('来源校验值已补齐，正在按原切片重新基础检查；未新增回传或投放。'),{statusCode:409});
  if (state.reason || variant.sourceRevalidation?.required)
    throw Object.assign(new Error('来源或 SKU 审核依据待重新核验，保留原成片；本次未新增回传或投放。'), {statusCode: 409});
}

export function createOutputRevalidator({readLibrary, updateLibrary, canReview, assess, nowIso}) {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const library = await readLibrary();
      // Only one expensive review per tick; manual pauses and revoked grants win.
      for (const render of library.renders) for (const variant of render.variants) {
        if (!render.automation || !automaticallyReviewed(variant) || !canReview(library, render, variant)) continue;
        const state = bindingState(render, variant, library);
        if (!state.reason) continue;
        const key = digest([variant.contentSha256, state.reason, state.current]);
        if (variant.sourceRevalidation?.key === key && !['processing', 'superseded'].includes(variant.sourceRevalidation.status)) continue;
        const original = structuredClone(variant);
        // A new historical-stock rules output is not silently upgraded to a
        // paid visual re-review. Changed stock requires a new valid generation.
        const eligible = state.reason === 'source_review_changed' && variant.reviewMode!==HISTORICAL_OUTPUT_REVIEW_MODE;
        let reserved = false;
        await updateLibrary(latest => {
          const latestRender = latest.renders.find(r => r.id === render.id);
          const item = latestRender?.variants.find(v => v.id === variant.id);
          if (!item || !automaticallyReviewed(item) || !canReview(latest, latestRender, item)
              || digest([item.contentSha256, bindingState(latestRender, item, latest).reason,
                bindingState(latestRender, item, latest).current]) !== key) return;
          reserved = true;
          item.sourceRevalidation = {required: true, key, status: eligible ? 'processing' : 'blocked', reason: state.reason, at: nowIso()};
          item.automaticAssessment.autoApproved = false;
          item.reviewStatus = 'changes_requested';
          item.reviewNote = eligible ? '来源或 SKU 审核依据已变化，正在按原成片自动重审。'
            : '原成片的生成来源已变化或缺少版本证据，不能按新来源直接放行；原文件与原审核回执保留。';
        });
        if (!reserved || !eligible) continue;
        // Persisted processing state plus the provider's immutable cache recover
        // the same attempt after restart; never invent a new paid run ID.
        let result;
        try { result = await assess(structuredClone(render), original, structuredClone(state), structuredClone(library)); }
        catch { result = {error: '自动重审暂未完成；保留原成片，不自动重复提交未知请求。'}; }
        await updateLibrary(latest => {
          const liveRender = latest.renders.find(r => r.id === render.id);
          const live = liveRender?.variants.find(v => v.id === variant.id);
          if (!live || !automaticallyReviewed(live) || live.sourceRevalidation?.key !== key
              || live.contentSha256 !== original.contentSha256 || live.storedName !== original.storedName) return;
          const fresh = bindingState(liveRender, live, latest);
          if (!canReview(latest, liveRender, live) || fresh.current?.review !== state.current.review
              || fresh.current?.content !== state.current.content) {
            live.sourceRevalidation = {...live.sourceRevalidation, status: 'superseded'};
            return;
          }
          if (result.error || result.sha256 !== original.contentSha256) {
            live.sourceRevalidation = {...live.sourceRevalidation, status: 'blocked'};
            live.reviewNote = result.error || '成片文件版本变化，重审结果未应用。';
            return;
          }
          live.reviewHistory = [...(live.reviewHistory || []), {
            assessment: original.automaticAssessment, reviewBinding: original.reviewBinding,
            reviewStatus: original.reviewStatus, reviewedAt: original.reviewedAt,
          }];
          const passed = result.assessment.status === 'passed';
          live.automaticAssessment = {...result.assessment, autoApproved: passed};
          live.reviewBinding = state.current;
          live.sourceRevalidation = {...live.sourceRevalidation, required: false, status: 'completed', completedAt: nowIso()};
          live.reviewStatus = passed ? 'approved' : 'changes_requested';
          live.reviewedAt = nowIso();
          live.reviewNote = passed ? '来源或 SKU 依据变化后自动重审通过，原生成版本与历史回执保留。'
            : `来源或 SKU 依据变化后仍待复核：${result.assessment.reasons.join(' ')}`;
        });
        return;
      }
    } finally { running = false; }
  };
  return {tick, pending: () => Number(running)};
}
