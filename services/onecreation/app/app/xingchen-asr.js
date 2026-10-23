const fs = require("fs");
const fsp = fs.promises;
const path = require("path");

const DEFAULT_XINGCHEN_ASR_MODEL = "XingChenAGI/XingChenASR-Diarize-V3.0";
const DEFAULT_XINGCHEN_ASR_BASE_URL = "https://api.siliconflow.cn/v1";

function timingCharCount(value) {
  return Array.from(String(value || "").replace(/\s/g, "")).length;
}

function finiteNumber(...values) {
  for (const value of values) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function segmentText(segment = {}) {
  return String(segment.text ?? segment.transcript ?? segment.content ?? "").trim();
}

function normalizeXingChenSegments(value) {
  const segments = Array.isArray(value) ? value : [];
  return segments.map((segment, index) => ({
    index: index + 1,
    start: Math.max(0, finiteNumber(segment.start, segment.start_time, segment.begin, segment.begin_time)),
    end: Math.max(0, finiteNumber(segment.end, segment.end_time, segment.stop, segment.stop_time)),
    speaker: String(
      segment.speaker
      ?? segment.speaker_id
      ?? segment.speakerId
      ?? segment.role
      ?? ""
    ).trim(),
    text: segmentText(segment),
    overlap: segment.overlap === true || segment.is_overlap === true || segment.overlapping === true,
    needsReview: segment.needsReview === true || segment.needs_review === true || segment.overlap === true || segment.is_overlap === true || segment.overlapping === true
  })).filter((segment) => segment.text || segment.end > segment.start);
}

function normalizeXingChenResponse(payload = {}, options = {}) {
  const rawSegments = payload.segments
    ?? payload.data?.segments
    ?? payload.result?.segments
    ?? payload.transcription?.segments
    ?? [];
  const segments = normalizeXingChenSegments(rawSegments);
  const text = String(
    payload.text
    ?? payload.data?.text
    ?? payload.result?.text
    ?? payload.transcription?.text
    ?? segments.map((segment) => segment.text).filter(Boolean).join("\n")
    ?? ""
  ).replace(/\r\n?/g, "\n").trim();
  const speakers = [...new Set(segments.map((segment) => segment.speaker).filter(Boolean))];
  return {
    schemaVersion: "xingchen-asr-transcript-v1",
    status: "success",
    provider: "SiliconFlow",
    model: String(options.model || DEFAULT_XINGCHEN_ASR_MODEL),
    text,
    charCount: timingCharCount(text),
    duration: Math.max(0, finiteNumber(payload.duration, payload.data?.duration, payload.result?.duration)),
    segments,
    speakers,
    speakerCount: speakers.length,
    usage: payload.usage && typeof payload.usage === "object" ? payload.usage : null
  };
}

function createXingChenAsrClient(options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const baseUrl = String(options.baseUrl || process.env.SILICONFLOW_ASR_BASE_URL || DEFAULT_XINGCHEN_ASR_BASE_URL).replace(/\/+$/, "");
  const model = String(options.model || process.env.SILICONFLOW_ASR_MODEL || DEFAULT_XINGCHEN_ASR_MODEL).trim();
  const resolveApiKey = typeof options.resolveApiKey === "function"
    ? options.resolveApiKey
    : () => String(options.apiKey || process.env.XingChenASR || "").trim();

  function status() {
    return { configured: Boolean(String(resolveApiKey() || "").trim()), provider: "SiliconFlow", model, baseUrl };
  }

  async function transcribeFile(filePath) {
    if (typeof fetchImpl !== "function") throw new Error("当前 Node.js 运行时不支持 XingChenASR 网络请求");
    const apiKey = String(await resolveApiKey() || "").trim();
    if (!apiKey) throw new Error("服务器尚未配置 XingChenASR 环境变量");
    const resolved = path.resolve(String(filePath || ""));
    const stat = await fsp.stat(resolved).catch(() => null);
    if (!stat?.isFile()) throw new Error("待转写音频不存在");
    if (stat.size > 50 * 1024 * 1024) throw new Error("待转写音频超过 SiliconFlow 50MB 限制");
    const form = new FormData();
    form.append("file", new Blob([await fsp.readFile(resolved)], { type: "audio/wav" }), path.basename(resolved));
    form.append("model", model);
    const response = await fetchImpl(`${baseUrl}/audio/transcriptions`, {
      method: "POST",
      headers: { Authorization: /^Bearer\s+/i.test(apiKey) ? apiKey : `Bearer ${apiKey}` },
      body: form
    });
    const responseText = await response.text();
    let payload = null;
    try { payload = responseText ? JSON.parse(responseText) : {}; } catch { payload = { message: responseText }; }
    if (!response.ok) {
      const message = String(payload?.message || payload?.error?.message || payload?.error || responseText || `HTTP ${response.status}`);
      throw new Error(`XingChenASR 转写失败（HTTP ${response.status}）：${message.slice(0, 500)}`);
    }
    return normalizeXingChenResponse(payload, { model });
  }

  return { status, transcribeFile };
}

module.exports = {
  DEFAULT_XINGCHEN_ASR_BASE_URL,
  DEFAULT_XINGCHEN_ASR_MODEL,
  createXingChenAsrClient,
  normalizeXingChenResponse,
  normalizeXingChenSegments,
  timingCharCount
};
