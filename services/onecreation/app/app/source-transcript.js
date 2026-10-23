function cleanTranscriptText(value) {
  return String(value || "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .trim();
}

function compactSpeechText(value) {
  return cleanTranscriptText(value)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function timingCharCount(value) {
  return Array.from(cleanTranscriptText(value).replace(/\s/g, "")).length;
}

function editDistance(left, right) {
  const a = Array.from(String(left || ""));
  const b = Array.from(String(right || ""));
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    previous = current;
  }
  return previous[b.length];
}

function transcriptSimilarity(left, right) {
  const a = compactSpeechText(left);
  const b = compactSpeechText(right);
  if (!a && !b) return 1;
  if (!a || !b) return 0;
  return Math.max(0, 1 - (editDistance(a, b) / Math.max(a.length, b.length)));
}

function analyzePcm16StereoWav(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 44) throw new Error("待分析音频不是有效的 WAV 文件");
  if (buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("待分析音频不是 RIFF/WAVE 格式");
  }
  let format = null;
  let dataOffset = -1;
  let dataSize = 0;
  for (let offset = 12; offset + 8 <= buffer.length;) {
    const chunkId = buffer.toString("ascii", offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const bodyOffset = offset + 8;
    if (chunkId === "fmt " && chunkSize >= 16 && bodyOffset + 16 <= buffer.length) {
      format = {
        audioFormat: buffer.readUInt16LE(bodyOffset),
        channels: buffer.readUInt16LE(bodyOffset + 2),
        sampleRate: buffer.readUInt32LE(bodyOffset + 4),
        blockAlign: buffer.readUInt16LE(bodyOffset + 12),
        bitsPerSample: buffer.readUInt16LE(bodyOffset + 14)
      };
    } else if (chunkId === "data") {
      dataOffset = bodyOffset;
      dataSize = Math.min(chunkSize, Math.max(0, buffer.length - bodyOffset));
      break;
    }
    offset = bodyOffset + chunkSize + (chunkSize % 2);
  }
  if (!format || dataOffset < 0) throw new Error("WAV 文件缺少 fmt 或 data 数据块");
  if (format.audioFormat !== 1 || format.channels < 2 || format.bitsPerSample !== 16) {
    throw new Error("声道分析仅支持双声道 PCM 16-bit WAV");
  }
  const blockAlign = format.blockAlign || (format.channels * 2);
  const frameCount = Math.floor(dataSize / blockAlign);
  if (frameCount < 2) throw new Error("WAV 音频采样不足，无法分析声道");
  const maximumSamples = 2_000_000;
  const stride = Math.max(1, Math.ceil(frameCount / maximumSamples));
  let samples = 0;
  let sumLeft = 0;
  let sumRight = 0;
  let sumLeftSquare = 0;
  let sumRightSquare = 0;
  let sumProduct = 0;
  for (let frame = 0; frame < frameCount; frame += stride) {
    const offset = dataOffset + (frame * blockAlign);
    if (offset + 4 > buffer.length) break;
    const left = buffer.readInt16LE(offset);
    const right = buffer.readInt16LE(offset + 2);
    samples += 1;
    sumLeft += left;
    sumRight += right;
    sumLeftSquare += left * left;
    sumRightSquare += right * right;
    sumProduct += left * right;
  }
  const leftVariance = Math.max(0, (samples * sumLeftSquare) - (sumLeft * sumLeft));
  const rightVariance = Math.max(0, (samples * sumRightSquare) - (sumRight * sumRight));
  const denominator = Math.sqrt(leftVariance * rightVariance);
  const correlation = denominator > 0 ? ((samples * sumProduct) - (sumLeft * sumRight)) / denominator : 1;
  const leftRms = Math.sqrt(sumLeftSquare / samples);
  const rightRms = Math.sqrt(sumRightSquare / samples);
  return {
    channels: format.channels,
    sampleRate: format.sampleRate,
    bitsPerSample: format.bitsPerSample,
    analyzedSamples: samples,
    correlation: Number(correlation.toFixed(6)),
    absoluteCorrelation: Number(Math.abs(correlation).toFixed(6)),
    leftRms: Number(leftRms.toFixed(3)),
    rightRms: Number(rightRms.toFixed(3)),
    rmsRatio: Number((Math.max(leftRms, rightRms) / Math.max(1, Math.min(leftRms, rightRms))).toFixed(3))
  };
}

function assessStereoSplitCandidate(analysis = {}, options = {}) {
  const maximumCorrelation = Number(options.maximumCorrelation ?? 0.45);
  const minimumRms = Number(options.minimumRms ?? 50);
  const maximumRmsRatio = Number(options.maximumRmsRatio ?? 20);
  if (Number(analysis.channels || 0) < 2) return { candidate: false, reason: "音轨不是双声道" };
  if (Number(analysis.leftRms || 0) < minimumRms || Number(analysis.rightRms || 0) < minimumRms) {
    return { candidate: false, reason: "至少一个声道接近静音" };
  }
  if (Number(analysis.rmsRatio || Infinity) > maximumRmsRatio) {
    return { candidate: false, reason: "左右声道能量差异过大" };
  }
  if (Number(analysis.absoluteCorrelation ?? 1) > maximumCorrelation) {
    return { candidate: false, reason: "左右声道高度同源" };
  }
  return { candidate: true, reason: "左右声道低相关且均包含有效声音，进入分轨复核" };
}

function validateFaithfulRefinement(rawText, candidateText) {
  const raw = cleanTranscriptText(rawText);
  const candidate = cleanTranscriptText(candidateText);
  const rawCompact = compactSpeechText(raw);
  const candidateCompact = compactSpeechText(candidate);
  if (!rawCompact) return { accepted: false, reason: "ASR原文为空", punctuationOnly: false, editDistance: 0 };
  if (!candidateCompact) return { accepted: false, reason: "校订结果为空", punctuationOnly: false, editDistance: rawCompact.length };
  if (rawCompact === candidateCompact) {
    return { accepted: true, reason: "仅调整标点、空格或大小写", punctuationOnly: true, editDistance: 0 };
  }
  const distance = editDistance(rawCompact, candidateCompact);
  const growth = candidateCompact.length - rawCompact.length;
  const maximumGrowth = Math.max(2, Math.ceil(rawCompact.length * 0.035));
  const maximumDistance = Math.max(3, Math.ceil(rawCompact.length * 0.055));
  const minimumLength = Math.max(1, rawCompact.length - Math.max(3, Math.ceil(rawCompact.length * 0.035)));
  if (growth > maximumGrowth) {
    return { accepted: false, reason: `校订结果新增${growth}个语义字符，超过防扩写阈值${maximumGrowth}`, punctuationOnly: false, editDistance: distance };
  }
  if (candidateCompact.length < minimumLength) {
    return { accepted: false, reason: "校订结果删减过多", punctuationOnly: false, editDistance: distance };
  }
  if (distance > maximumDistance) {
    return { accepted: false, reason: `语义字符改动${distance}处，超过保真阈值${maximumDistance}`, punctuationOnly: false, editDistance: distance };
  }
  return { accepted: true, reason: "小范围语义纠错通过保真校验", punctuationOnly: false, editDistance: distance };
}

function normalizeAsrSegments(segments) {
  return (Array.isArray(segments) ? segments : []).map((segment, index) => ({
    index: index + 1,
    start: Math.max(0, Number(segment?.start || 0)),
    end: Math.max(0, Number(segment?.end || 0)),
    speaker: String(segment?.speaker || "").trim(),
    text: cleanTranscriptText(segment?.text),
    channel: ["left", "right", "mono"].includes(String(segment?.channel || "").toLowerCase())
      ? String(segment.channel).toLowerCase()
      : "",
    overlap: segment?.overlap === true,
    needsReview: segment?.needsReview === true || segment?.overlap === true
  })).filter((segment) => segment.text || segment.end > segment.start);
}

function markOverlappingSegments(segments, toleranceSeconds = 0.03) {
  const output = normalizeAsrSegments(segments)
    .map((segment) => ({ ...segment }))
    .sort((left, right) => left.start - right.start || left.end - right.end);
  for (let leftIndex = 0; leftIndex < output.length; leftIndex += 1) {
    const left = output[leftIndex];
    if (!(left.end > left.start)) continue;
    for (let rightIndex = leftIndex + 1; rightIndex < output.length; rightIndex += 1) {
      const right = output[rightIndex];
      if (!(right.end > right.start)) continue;
      if (right.start >= left.end - toleranceSeconds) break;
      const differentSource = left.channel && right.channel
        ? left.channel !== right.channel
        : Boolean(left.speaker && right.speaker && left.speaker !== right.speaker);
      if (!differentSource || left.start >= right.end - toleranceSeconds) continue;
      left.overlap = true;
      left.needsReview = true;
      right.overlap = true;
      right.needsReview = true;
    }
  }
  return output.map((segment, index) => ({ ...segment, index: index + 1 }));
}

function mergeIndependentChannelTranscripts(leftResult = {}, rightResult = {}, options = {}) {
  const maximumTextSimilarity = Number(options.maximumTextSimilarity ?? 0.65);
  const leftSegments = normalizeAsrSegments(leftResult.segments).filter((segment) => segment.text);
  const rightSegments = normalizeAsrSegments(rightResult.segments).filter((segment) => segment.text);
  if (!leftSegments.length || !rightSegments.length) {
    return { accepted: false, reason: "至少一个声道没有可用转写分段" };
  }
  if ([...leftSegments, ...rightSegments].some((segment) => !(segment.end > segment.start))) {
    return { accepted: false, reason: "分轨ASR缺少可靠起止时间戳" };
  }
  const similarity = transcriptSimilarity(leftResult.text, rightResult.text);
  if (similarity > maximumTextSimilarity) {
    return { accepted: false, reason: "左右声道转写内容高度相似，按普通立体声处理", textSimilarity: similarity };
  }
  const segments = markOverlappingSegments([
    ...leftSegments.map((segment) => ({ ...segment, speaker: "说话人1", channel: "left" })),
    ...rightSegments.map((segment) => ({ ...segment, speaker: "说话人2", channel: "right" }))
  ].sort((left, right) => left.start - right.start || left.end - right.end));
  const overlapCount = segments.filter((segment) => segment.overlap).length;
  const text = segments.map((segment) => segment.text).filter(Boolean).join("\n");
  return {
    accepted: true,
    reason: "左右声道分别包含独立台词，采用分轨转写",
    schemaVersion: "xingchen-asr-transcript-v1",
    status: "success",
    provider: String(leftResult.provider || rightResult.provider || "SiliconFlow"),
    model: String(leftResult.model || rightResult.model || ""),
    text,
    charCount: timingCharCount(text),
    duration: Math.max(0, Number(leftResult.duration || 0), Number(rightResult.duration || 0), ...segments.map((segment) => segment.end)),
    segments,
    speakers: ["说话人1", "说话人2"],
    speakerCount: 2,
    channelStrategy: "split_stereo",
    textSimilarity: similarity,
    overlapCount,
    usage: { left: leftResult.usage || null, right: rightResult.usage || null }
  };
}

function buildTranscriptRefinementMessages(asrResult = {}, context = {}) {
  const segments = normalizeAsrSegments(asrResult.segments);
  const productTerms = (Array.isArray(context.productTerms) ? context.productTerms : [])
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .slice(0, 30);
  return [
    {
      role: "system",
      content: [
        "你是ASR逐字稿保真校订器，不是文案编辑器。",
        "只允许：补中文标点；修复明显的同音错字、漏字、数字格式、英文大小写和已给出的品牌/产品专名。",
        "严禁扩写、润色、概括、改语气、换句式、增加卖点、补充画面信息或凭常识创造原音频没有说过的内容。",
        "无法仅凭上下文确定的字必须保留ASR原样，并写入uncertain。不得为了让句子更通顺而补完整句话。",
        "overlap或needsReview为true的重叠讲话片段必须逐字保持输入原样，不得改字、补字或猜测；只可将其列入uncertain供人工核对。",
        "correctedSegments必须与输入分段数量、顺序和index完全一致；不得合并、拆分或调换说话人。",
        "只返回严格JSON：correctedText、correctedSegments、corrections、uncertain、faithful。corrections每项包含before、after、type、reason。"
      ].join("\n")
    },
    {
      role: "user",
      content: [
        `工作流：${String(context.workflow || "视频工作台")}`,
        productTerms.length ? `允许核对的专名（只能纠正为列表中已有写法）：${productTerms.join("、")}` : "未提供专名表，不得猜测品牌或产品名。",
        `ASR全文：\n${cleanTranscriptText(asrResult.text)}`,
        `ASR分段JSON：\n${JSON.stringify(segments.map((segment) => ({ index: segment.index, speaker: segment.speaker, channel: segment.channel, start: segment.start, end: segment.end, overlap: segment.overlap, needsReview: segment.needsReview, text: segment.text })))}`
      ].join("\n\n")
    }
  ];
}

function normalizeCorrections(value) {
  return (Array.isArray(value) ? value : []).map((item) => ({
    before: cleanTranscriptText(item?.before).slice(0, 240),
    after: cleanTranscriptText(item?.after).slice(0, 240),
    type: String(item?.type || "").trim().slice(0, 80),
    reason: String(item?.reason || "").trim().slice(0, 300)
  })).filter((item) => item.before || item.after).slice(0, 100);
}

function applyRefinedSegments(rawSegments, correctedSegments) {
  const source = normalizeAsrSegments(rawSegments);
  const output = Array.isArray(correctedSegments) ? correctedSegments : [];
  if (!source.length || output.length !== source.length) return { valid: false, segments: source };
  const segments = source.map((segment, index) => {
    const corrected = output[index] || {};
    if (Number(corrected.index || index + 1) !== index + 1) return null;
    if (segment.needsReview || segment.overlap) return segment;
    const validation = validateFaithfulRefinement(segment.text, corrected.text || corrected.correctedText);
    return validation.accepted ? { ...segment, text: cleanTranscriptText(corrected.text || corrected.correctedText) } : segment;
  });
  if (segments.some((segment) => !segment)) return { valid: false, segments: source };
  return { valid: true, segments };
}

function createSourceTranscriptRefiner(options = {}) {
  const completeJson = options.completeJson;
  const model = String(options.model || "deepseek-v4-pro");

  function status() {
    return { configured: typeof completeJson === "function", model };
  }

  async function refine(asrResult = {}, context = {}) {
    const rawText = cleanTranscriptText(asrResult.text);
    const rawSegments = normalizeAsrSegments(asrResult.segments);
    if (!rawText) throw new Error("XingChenASR没有返回可校订文本");
    if (typeof completeJson !== "function") {
      return {
        text: rawText,
        segments: rawSegments,
        refinement: { status: "skipped", model, reason: "DeepSeek校订客户端未配置", corrections: [], uncertain: [] }
      };
    }
    try {
      const response = await completeJson(buildTranscriptRefinementMessages(asrResult, context), {
        temperature: 0,
        maxTokens: 6000,
        enableThinking: false
      });
      const result = response?.result && typeof response.result === "object" ? response.result : {};
      const candidateText = cleanTranscriptText(result.correctedText);
      const validation = validateFaithfulRefinement(rawText, candidateText);
      if (!validation.accepted || result.faithful === false) {
        return {
          text: rawText,
          segments: rawSegments,
          refinement: {
            status: "rejected",
            model: response?.model || model,
            reason: result.faithful === false ? "模型自报无法保真" : validation.reason,
            validation,
            corrections: normalizeCorrections(result.corrections),
            uncertain: (Array.isArray(result.uncertain) ? result.uncertain : []).map((item) => String(item || "").trim()).filter(Boolean).slice(0, 30)
          }
        };
      }
      const refinedSegments = applyRefinedSegments(rawSegments, result.correctedSegments);
      const lockedSegments = rawSegments.filter((segment) => segment.needsReview || segment.overlap);
      if (lockedSegments.length && !refinedSegments.valid) {
        return {
          text: rawText,
          segments: rawSegments,
          refinement: {
            status: "rejected",
            model: response?.model || model,
            reason: "重叠讲话分段未严格对齐，已锁定ASR原文",
            validation,
            corrections: normalizeCorrections(result.corrections),
            uncertain: lockedSegments.map((segment) => `第${segment.index}段为重叠讲话，需人工核对`).slice(0, 30),
            lockedSegmentIndexes: lockedSegments.map((segment) => segment.index),
            humanReviewRequired: true
          }
        };
      }
      const finalText = lockedSegments.length && refinedSegments.valid
        ? cleanTranscriptText(refinedSegments.segments.map((segment) => segment.text).join("\n"))
        : candidateText;
      const finalValidation = validateFaithfulRefinement(rawText, finalText);
      if (!finalValidation.accepted) {
        return {
          text: rawText,
          segments: rawSegments,
          refinement: {
            status: "rejected",
            model: response?.model || model,
            reason: finalValidation.reason,
            validation: finalValidation,
            corrections: normalizeCorrections(result.corrections),
            uncertain: lockedSegments.map((segment) => `第${segment.index}段为重叠讲话，需人工核对`).slice(0, 30),
            lockedSegmentIndexes: lockedSegments.map((segment) => segment.index),
            humanReviewRequired: lockedSegments.length > 0
          }
        };
      }
      return {
        text: finalText,
        segments: refinedSegments.segments,
        refinement: {
          status: validation.punctuationOnly ? "punctuation_only" : "applied",
          model: response?.model || model,
          reason: validation.reason,
          validation,
          segmentAlignmentPreserved: refinedSegments.valid,
          lockedSegmentIndexes: lockedSegments.map((segment) => segment.index),
          humanReviewRequired: lockedSegments.length > 0,
          corrections: normalizeCorrections(result.corrections),
          uncertain: [
            ...(Array.isArray(result.uncertain) ? result.uncertain : []).map((item) => String(item || "").trim()).filter(Boolean),
            ...lockedSegments.map((segment) => `第${segment.index}段为重叠讲话，需人工核对`)
          ].slice(0, 30)
        }
      };
    } catch (error) {
      return {
        text: rawText,
        segments: rawSegments,
        refinement: { status: "failed", model, reason: String(error?.message || error), corrections: [], uncertain: [] }
      };
    }
  }

  return { status, refine };
}

function assembleSourceTranscript(asrResult = {}, refined = {}) {
  const rawText = cleanTranscriptText(asrResult.text);
  const text = cleanTranscriptText(refined.text || rawText);
  const segments = normalizeAsrSegments(refined.segments?.length ? refined.segments : asrResult.segments);
  const speakers = [...new Set(segments.map((segment) => segment.speaker).filter(Boolean))];
  const overlapCount = segments.filter((segment) => segment.overlap || segment.needsReview).length;
  return {
    schemaVersion: "source-transcript-v3",
    status: "success",
    provider: String(asrResult.provider || "SiliconFlow"),
    model: String(asrResult.model || ""),
    rawText,
    text,
    charCount: timingCharCount(text),
    rawCharCount: timingCharCount(rawText),
    duration: Math.max(0, Number(asrResult.duration || 0)),
    segments,
    speakers,
    speakerCount: speakers.length,
    channelStrategy: String(asrResult.channelStrategy || "mono_diarize"),
    audioTopology: asrResult.audioTopology && typeof asrResult.audioTopology === "object" ? asrResult.audioTopology : null,
    channelDecision: asrResult.channelDecision && typeof asrResult.channelDecision === "object" ? asrResult.channelDecision : null,
    overlapCount,
    humanReviewRequired: overlapCount > 0 || refined.refinement?.humanReviewRequired === true,
    refinement: refined.refinement || { status: "skipped", corrections: [], uncertain: [] },
    usage: asrResult.usage && typeof asrResult.usage === "object" ? asrResult.usage : null
  };
}

module.exports = {
  analyzePcm16StereoWav,
  applyRefinedSegments,
  assessStereoSplitCandidate,
  assembleSourceTranscript,
  buildTranscriptRefinementMessages,
  cleanTranscriptText,
  compactSpeechText,
  createSourceTranscriptRefiner,
  editDistance,
  markOverlappingSegments,
  mergeIndependentChannelTranscripts,
  timingCharCount,
  transcriptSimilarity,
  validateFaithfulRefinement
};
