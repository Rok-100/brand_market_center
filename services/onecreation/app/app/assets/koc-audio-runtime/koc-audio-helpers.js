"use strict";

function normalizeKocAudioClips(clipInput) {
  const source = Array.isArray(clipInput)
    ? clipInput
    : [{ index: 1, duration: Number(clipInput || 14) }];
  return source.map((clip, index) => ({
    index: Math.max(1, Number(clip?.index || index + 1)),
    duration: Math.max(1, Number(clip?.duration || 14))
  }));
}

function planKocReferenceAudioVariants(clips, sourceDuration) {
  const normalizedClips = normalizeKocAudioClips(clips);
  const availableDuration = Math.max(0, Number(sourceDuration || 0));
  if (availableDuration > 0 && availableDuration <= 1.8) {
    throw new Error("参考音频有效时长必须超过1.8秒；请更换带有更长有效音轨的原片，或手动选择“不使用参考音频”");
  }
  let cursor = 0;
  return normalizedClips.map((clip) => {
    const maximumForClip = Math.max(0.7, Math.min(14.8, clip.duration - 0.3));
    if (maximumForClip <= 1.8) {
      throw new Error(`第${clip.index}分镜无法容纳超过1.8秒的参考音频；请延长分镜，或手动选择“不使用参考音频”`);
    }
    const encodedDuration = Math.max(1.9, Math.min(
      maximumForClip - 0.08,
      availableDuration > 0 ? availableDuration : maximumForClip - 0.08
    ));
    const latestStart = Math.max(0, availableDuration - encodedDuration);
    const start = availableDuration > encodedDuration
      ? Math.min(cursor, latestStart)
      : 0;
    cursor = availableDuration > 0
      ? Math.min(availableDuration, start + encodedDuration)
      : cursor + encodedDuration;
    return {
      clipIndex: clip.index,
      clipDuration: clip.duration,
      start: Number(start.toFixed(3)),
      duration: Number(encodedDuration.toFixed(3)),
      maximumDuration: Number(maximumForClip.toFixed(3))
    };
  });
}

function isKocCompliancePending(value) {
  const text = String(value?.message || value || "");
  return /10026|检测提交较频繁|素材(?:合规)?(?:检测|审核|复核)(?:中|未完成|排队|等待)|合规复核(?:中|未完成|排队|等待)|(?:status|state|reviewStatus|auditStatus)["'\s:=]+(?:pending|processing|reviewing|queued)/i.test(text);
}

function inspectKocRemoteMediaPayload(value) {
  let payload = value;
  if (typeof value === "string") {
    try {
      payload = JSON.parse(value);
    } catch {
      payload = null;
    }
  }
  const text = typeof value === "string" ? value : JSON.stringify(payload || {});
  const normalized = String(text || "").trim();
  const failed = /(?:status|state|reviewStatus|auditStatus)["'\s:=]+(?:failed|rejected|error)|审核(?:失败|拒绝)|素材(?:无效|不可用)|音频(?:格式|编码|上传).*(?:失败|不支持)/i.test(normalized);
  const pending = !failed && (
    /10026|检测提交较频繁|素材(?:合规)?(?:检测|审核|复核)(?:中|未完成|排队|等待)|合规复核(?:中|未完成|排队|等待)/i.test(normalized)
    || /(?:status|state|reviewStatus|auditStatus)["'\s:=]+(?:pending|processing|reviewing|queued|uploading|transcoding)/i.test(normalized)
  );
  const hasRemoteUrl = /(?:https?:\/\/|asset:\/\/)[^"'\s\\]+/i.test(normalized);
  const hasRemoteAssetId = /"(?:assetId|mediaId|resourceId)"\s*:\s*"[^"\s]+"/i.test(normalized);
  const hasMediaMetadata = /"(?:fileName|mimeType|contentType|duration|sampleRate|channels)"\s*:\s*(?:"[^"]+"|[1-9]\d*(?:\.\d+)?)/i.test(normalized);
  const statusReady = /(?:status|state|reviewStatus|auditStatus)["'\s:=]+(?:ready|success|succeeded|completed|approved|available)/i.test(normalized);
  return {
    ready: !failed && !pending && (hasRemoteUrl || hasRemoteAssetId || statusReady),
    pending,
    failed,
    hasRemoteUrl,
    hasRemoteAssetId,
    hasMediaMetadata,
    statusReady,
    detail: normalized
  };
}

function kocReferenceAudioAssetForTask(job, task) {
  const variants = Array.isArray(job?.kocAssets?.referenceAudioVariants)
    ? job.kocAssets.referenceAudioVariants
    : [];
  const clipIndex = Number(task?.referenceAudioClipIndex || task?.index || 0);
  return variants.find((asset) => Number(asset?.clipIndex) === clipIndex) || null;
}

function kocReferenceAudioRemoteForTask(job, task) {
  const clipIndex = Number(task?.referenceAudioClipIndex || task?.index || 0);
  const remotes = job?.kocRemoteUploads?.referenceAudios;
  if (Array.isArray(remotes)) {
    return remotes.find((asset) => Number(asset?.clipIndex) === clipIndex) || null;
  }
  if (remotes && typeof remotes === "object") return remotes[String(clipIndex)] || null;
  return null;
}

function persistKocReferenceAudioRemote(job, asset, remote) {
  if (!job || typeof job !== "object") throw new TypeError("KOC任务不存在");
  if (!job.kocRemoteUploads || typeof job.kocRemoteUploads !== "object") {
    job.kocRemoteUploads = { productAssets: [] };
  }
  if (!job.kocRemoteUploads.referenceAudios || typeof job.kocRemoteUploads.referenceAudios !== "object") {
    job.kocRemoteUploads.referenceAudios = {};
  }
  const clipIndex = Math.max(1, Number(asset?.clipIndex || remote?.clipIndex || 1));
  const normalized = {
    ...(remote && typeof remote === "object" ? remote : {}),
    clipIndex,
    duration: Number(asset?.duration || remote?.duration || 0)
  };
  job.kocRemoteUploads.referenceAudios[String(clipIndex)] = normalized;
  job.kocRemoteUploads.referenceAudio = job.kocRemoteUploads.referenceAudios["1"] || null;
  return normalized;
}

function kocReferenceAudioPendingHint(clipIndex) {
  const prefix = Number(clipIndex) > 0 ? `第${Number(clipIndex)}分镜` : "参考";
  return `${prefix}音频已提交LibTV合规审核，系统会复用同一素材节点续查，不会重复上传。`;
}

module.exports = {
  inspectKocRemoteMediaPayload,
  isKocCompliancePending,
  kocReferenceAudioAssetForTask,
  kocReferenceAudioPendingHint,
  kocReferenceAudioRemoteForTask,
  persistKocReferenceAudioRemote,
  planKocReferenceAudioVariants
};
