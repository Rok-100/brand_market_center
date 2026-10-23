const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const {
  PRODUCT_STATE_TYPES,
  buildProductStateCatalog,
  recommendDisplayState,
  buildActionResolutionDraft,
  buildMappingPlan,
  applyMappingConfirmation,
  effectiveProductForState
} = require("./one-click-remake-product-mapping");
const {
  buildGeometryManifest,
  sourceGeometryReview,
  sourceLayoutContract,
  stageGeometryReferences,
  createProductGeometryClient
} = require("./one-click-remake-geometry");
const { normalizeRecipeTags } = require("./one-click-remake-governance.js");

const CHANGE_TYPES = Object.freeze([
  Object.freeze({ id: "product", label: "仅换产品", changesProduct: true, changesVoiceover: false, changesBackground: false, changesPerson: false }),
  Object.freeze({ id: "voiceover", label: "仅换口播", changesProduct: false, changesVoiceover: true, changesBackground: false, changesPerson: false }),
  Object.freeze({ id: "product_voiceover", label: "换产品 + 口播", changesProduct: true, changesVoiceover: true, changesBackground: false, changesPerson: false }),
  Object.freeze({ id: "background", label: "仅换背景", changesProduct: false, changesVoiceover: false, changesBackground: true, changesPerson: false }),
  Object.freeze({ id: "person", label: "换人物", changesProduct: false, changesVoiceover: false, changesBackground: false, changesPerson: true }),
  Object.freeze({ id: "background_product", label: "换背景 + 产品", changesProduct: true, changesVoiceover: false, changesBackground: true, changesPerson: false })
]);

const ACTIVE_STATUSES = new Set(["auditing", "preparing_history_remake", "preparing_mapping", "preparing_assets", "regenerating_image_candidates", "creating_task_canvas", "resuming_interrupted_stage", "generating_video", "quality_checking", "quality_retrying", "archiving_result"]);
const TERMINAL_STATUSES = new Set(["success", "partial_success", "failed"]);
const VIDEO_TARGET_ACTIVE_STATUSES = new Set(["creating_canvas", "uploading_assets", "generating_video", "downloading_result", "quality_checking", "quality_retrying", "retrying_video", "archiving_result"]);
const MAX_IMAGE_GENERATION_ROUNDS = 3;
const MAX_BACKGROUND_SCENE_GENERATION_ROUNDS = 2;
const MAX_VIDEO_GENERATION_ROUNDS = 2;
const COLLECTED_TEMPLATE_MESSAGE = "已找到相同来源，将优先复用共享 OSS 拆解快照，不会重复收录";
const FILE_MEDIA_TYPES = new Set(["image", "video", "audio"]);
const SUPPORTED_UPSTREAM_TYPES = new Set(["image", "video", "audio", "text"]);
const SOURCE_PARAM_OMIT = new Set([
  "prompt", "imageList", "videoList", "audioList", "textList", "mixedList",
  "imageListOrder", "videoListOrder", "audioListOrder", "textListOrder", "mixedListOrder", "settings", "advancedSettings"
]);

function interruptedResumeKind(job = {}, persistedStatus = job.status) {
  const status = safeText(persistedStatus, 80);
  const supportedResumeKinds = new Set(["audit", "history_snapshot", "mapping", "assets", "image_regeneration", "manual_video_retry", "archive"]);
  if (status === "auditing") return "audit";
  if (status === "preparing_history_remake") return "history_snapshot";
  if (status === "preparing_mapping") return "mapping";
  if (status === "preparing_assets") return "assets";
  if (status === "regenerating_image_candidates") return "image_regeneration";
  if (status === "quality_retrying" && (job.targets || []).some((target) => {
    const round = Math.max(1, Number(target?.generationAttempt || 1));
    const current = (target?.videoRounds || []).find((item) => Number(item.round) === round);
    return target?.status === "quality_retrying" && round < MAX_VIDEO_GENERATION_ROUNDS && current?.manualReview?.decision === "reject";
  })) return "manual_video_retry";
  if (status === "archiving_result") return "archive";
  if (status === "creating_task_canvas") return job.historyRecipeId ? "history_snapshot" : "audit";
  if (status === "resuming_interrupted_stage") {
    const rememberedResumeKind = safeText(job.interruption?.resumeKind, 80);
    return supportedResumeKinds.has(rememberedResumeKind) ? rememberedResumeKind : "";
  }
  if (status !== "interrupted") return "";
  const remembered = safeText(job.interruption?.resumeKind || job.interruption?.fromStatus, 80);
  if (remembered && remembered !== "interrupted") {
    const normalized = interruptedResumeKind(job, remembered) || remembered;
    return supportedResumeKinds.has(normalized) ? normalized : "";
  }
  const targets = Array.isArray(job.targets) ? job.targets : [];
  const videoWorkStarted = targets.some((target) => (
    ["generating_video", "quality_checking", "quality_retrying", "recovering_video_node_callback", "success", "review_required"].includes(safeText(target?.status, 80))
    || Number(target?.generationAttempt || 0) > 0
    || (Array.isArray(target?.videoRounds) && target.videoRounds.length > 0)
    || Boolean(target?.result?.videoNodeKey || target?.result?.videoUrl)
  ));
  if (videoWorkStarted) return "";
  if (targets.some((target) => target?.mappingPlan?.mappings || target?.mappingConfirmedAt)) return "assets";
  if (job.audit && Array.isArray(job.preparationRequest?.targets) && job.preparationRequest.targets.length) return "mapping";
  if (!job.audit && job.historyRecipeId) return "history_snapshot";
  return "";
}

const TARGET_FAILURE_STAGE_LABELS = Object.freeze({
  creating_canvas: "准备任务共享画布",
  uploading_assets: "上传上游资产",
  generating_video: "提交视频节点并等待生成",
  downloading_result: "下载成片",
  retrying_video: "重新发起视频生成"
});

const JOB_FAILURE_STAGE_LABELS = Object.freeze({
  audit_failed: "校验并拆解源画布",
  history_remake_failed: "复用历史拆解模板",
  mapping_preparation_failed: "产品形态与OSS资产映射",
  asset_preparation_failed: "提示词编译与上游资产准备",
  video_generation_failed: "视频批量生成"
});

const IMAGE_PROMPT_CATEGORIES = Object.freeze([
  Object.freeze({
    id: "product_scene_replacement",
    label: "产品场景替换",
    generationMode: "image_generation",
    appliesToChangeTypes: ["product"],
    builtInPrompt: "定位并彻底清除源画面中的全部旧产品像素，再依据目标 SKU 身份图和资料卡重建产品；逐个继承当前源图的实例槽位，锁定包装文字、Logo、结构、长宽高比例、间距、遮挡、承托与接触阴影，禁止旧包装残留、混合包装、跨图套用数量、悬浮和穿模。"
  }),
  Object.freeze({
    id: "voiceover_only_source_reuse",
    label: "仅换口播（源图复用）",
    generationMode: "deterministic_reuse",
    appliesToChangeTypes: ["voiceover"],
    builtInPrompt: "本次图像白名单为空：全部上游图片保持源资产不变，不调用生图模型，不得改动产品、人物、背景、动作、机位、构图、光影或任何画面文字；只允许在视频提示词编译阶段逐字替换用户确认的新口播。"
  }),
  Object.freeze({
    id: "product_voiceover_replacement",
    label: "产品与口播同时替换",
    generationMode: "image_generation",
    appliesToChangeTypes: ["product_voiceover"],
    builtInPrompt: "生图阶段只允许替换产品：彻底清除全部旧产品像素，按目标 SKU 身份图、Logo、标签、结构和真实比例逐个继承当前源图的实例槽位、遮挡、承托与接触阴影；人物、背景、动作、机位和构图保持不变。口播只在后续视频提示词阶段按用户确认文本逐字替换，不得把口播变化扩展成额外画面变化。"
  }),
  Object.freeze({
    id: "background_replacement",
    label: "仅换背景",
    generationMode: "image_generation",
    appliesToChangeTypes: ["background"],
    builtInPrompt: "锁定源画面的人物、产品、动作、机位、构图和接触关系，只替换空间、墙地面与环境道具；新背景必须重新匹配真实光向、边缘、反射、遮挡和景深，禁止改动主体身份。"
  }),
  Object.freeze({
    id: "person_replacement",
    label: "仅换人物",
    generationMode: "image_generation",
    appliesToChangeTypes: ["person"],
    builtInPrompt: "锁定源画面的产品、背景、动作阶段、姿态、手部与产品接触、机位和构图，只替换人物身份；禁止旧脸、旧发型残留、混脸、多人融合、年龄或服饰漂移。"
  }),
  Object.freeze({
    id: "background_product_replacement",
    label: "背景与产品同时替换",
    generationMode: "image_generation",
    appliesToChangeTypes: ["background_product"],
    builtInPrompt: "分别完成背景重建与产品重建，锁定人物身份、动作、机位和构图；彻底移除旧背景与旧产品，并让目标产品在新环境中获得正确尺度、光影、边缘、遮挡、承托和接触关系。"
  }),
  Object.freeze({
    id: "direct_oss_product_asset",
    label: "OSS 产品原图直连",
    generationMode: "deterministic_reuse",
    appliesToChangeTypes: ["product", "product_voiceover", "background_product"],
    builtInPrompt: "直接使用已确认的目标 SKU OSS 原始产品资产，不执行生图；禁止重新生成、变形、改文字、改 Logo 或补造产品。"
  }),
  Object.freeze({
    id: "reuse_source_asset",
    label: "源资产复用",
    generationMode: "deterministic_reuse",
    appliesToChangeTypes: CHANGE_TYPES.map((item) => item.id),
    builtInPrompt: "该节点不承载本次白名单内的替换对象，保持源资产不变，不执行生图。"
  })
]);

function imagePromptCategoryById(id) {
  return IMAGE_PROMPT_CATEGORIES.find((item) => item.id === id) || IMAGE_PROMPT_CATEGORIES[0];
}

function imagePromptCategory(changeTypeValue = {}, sourceAsset = {}) {
  if (sourceAsset.replacementStrategy === "direct_oss_product_asset" || sourceAsset.sourceMode === "oss_direct") {
    return imagePromptCategoryById("direct_oss_product_asset");
  }
  if (changeTypeValue.id === "voiceover" || (changeTypeValue.changesVoiceover && !changeTypeValue.changesProduct && !changeTypeValue.changesBackground && !changeTypeValue.changesPerson)) {
    return imagePromptCategoryById("voiceover_only_source_reuse");
  }
  if (sourceAsset.rebuildRequired === false || sourceAsset.replacementStrategy === "reuse_source") {
    return imagePromptCategoryById("reuse_source_asset");
  }
  if (changeTypeValue.changesBackground && changeTypeValue.changesProduct) return imagePromptCategoryById("background_product_replacement");
  if (changeTypeValue.id === "product_voiceover" || (changeTypeValue.changesProduct && changeTypeValue.changesVoiceover)) {
    return imagePromptCategoryById("product_voiceover_replacement");
  }
  if (changeTypeValue.changesBackground) return imagePromptCategoryById("background_replacement");
  if (changeTypeValue.changesPerson) return imagePromptCategoryById("person_replacement");
  return imagePromptCategoryById("product_scene_replacement");
}

function isoNow() {
  return new Date().toISOString();
}

function uid(prefix) {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
}

function safeText(value, limit = 20000) {
  return String(value ?? "").trim().slice(0, limit);
}

function failureReason(value) {
  return safeText(value?.message || value, 5000)
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
}

function cliOutputSnippet(value, limit = 1200) {
  const clean = String(value || "")
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .trim();
  return clean.length > limit ? `…${clean.slice(-limit)}` : clean;
}

function safeName(value, fallback = "asset") {
  const text = String(value || fallback).replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").trim();
  return (text || fallback).slice(0, 96);
}

function shanghaiDateParts(value) {
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date(value || Date.now()));
  const part = (type) => parts.find((item) => item.type === type)?.value || "";
  return { year: part("year"), month: part("month"), day: part("day") };
}

function chineseTaskOrdinal(value) {
  const number = Math.max(1, Math.floor(Number(value) || 1));
  const numerals = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
  if (number < 10) return numerals[number];
  if (number === 10) return "十";
  if (number < 20) return `十${numerals[number % 10]}`;
  if (number < 100) return `${numerals[Math.floor(number / 10)]}十${number % 10 ? numerals[number % 10] : ""}`;
  return String(number);
}

function defaultRemakeTaskName(createdAt, sequence) {
  const date = shanghaiDateParts(createdAt);
  return `${date.month}${date.day}任务${chineseTaskOrdinal(sequence)}`;
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function parseJsonDocuments(text) {
  const source = String(text || "");
  const documents = [];
  let start = -1;
  let stack = [];
  let inString = false;
  let escaped = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (start < 0) {
      if (char === "{" || char === "[") {
        start = index;
        stack = [char];
        inString = false;
        escaped = false;
      }
      continue;
    }
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === "{" || char === "[") stack.push(char);
    if (char === "}" || char === "]") {
      const expected = char === "}" ? "{" : "[";
      if (stack.at(-1) !== expected) {
        start = -1;
        stack = [];
        continue;
      }
      stack.pop();
      if (!stack.length) {
        try {
          documents.push(JSON.parse(source.slice(start, index + 1)));
        } catch {
          // LibTV may emit progress text or NDJSON around the final payload.
        }
        start = -1;
      }
    }
  }
  return documents;
}

function parseCliJson(text) {
  try {
    return JSON.parse(String(text || ""));
  } catch {
    const documents = parseJsonDocuments(text);
    return documents.length ? documents.at(-1) : null;
  }
}

function requiredProductAssetIds(assetIds = []) {
  const requested = [...new Set((Array.isArray(assetIds) ? assetIds : []).map(String).filter(Boolean))];
  if (!requested.length) throw new Error("请为目标 SKU 手动选择至少一张产品资产图");
  return requested;
}

function mergeRemakeProductCatalog(baseProducts = [], managedProducts = [], resolveProduct = (product) => product) {
  const merged = new Map();
  for (const product of baseProducts || []) {
    if (!product?.id) continue;
    merged.set(String(product.id), product);
  }
  for (const product of managedProducts || []) {
    if (!product?.id || product.status === "inactive" || Number(product.imageCount || 0) < 1) continue;
    const id = String(product.id);
    const combined = { ...(merged.get(id) || {}), ...product, id };
    merged.set(id, { ...combined, ...(resolveProduct(combined) || {}) });
  }
  return [...merged.values()];
}

function libtvPayloadContainers(payload = {}) {
  return [
    payload,
    payload?.projectMeta,
    payload?.data,
    payload?.data?.projectMeta,
    payload?.result,
    payload?.result?.projectMeta,
    payload?.result?.data,
    payload?.result?.data?.projectMeta
  ].filter((item, index, items) => item && typeof item === "object" && !Array.isArray(item) && items.indexOf(item) === index);
}

function libtvProjectId(payload = {}) {
  for (const item of libtvPayloadContainers(payload)) {
    const value = safeText(item.uuid || item.projectUuid || item.projectId || item.id, 100);
    if (value) return value;
  }
  return "";
}

function libtvProjectItems(payload = {}) {
  const keys = ["projectMetaList", "projectList", "projects", "items", "list"];
  return libtvPayloadContainers(payload)
    .flatMap((container) => keys.flatMap((key) => Array.isArray(container[key]) ? container[key] : []));
}

function libtvProjectTimestamp(item = {}) {
  const numeric = Number(item.updatedAtMs || item.createdAtMs || item.createAt || 0);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  const parsed = Date.parse(String(item.updatedAt || item.createdAt || item.createAt || ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function exactLibtvProjects(payload = {}, canvasName = "") {
  return libtvProjectItems(payload)
    .filter((item) => String(item?.name || item?.title || "") === String(canvasName || ""))
    .filter((item) => Boolean(libtvProjectId(item)))
    .sort((left, right) => libtvProjectTimestamp(right) - libtvProjectTimestamp(left));
}

function taskCanvasName(job = {}) {
  const canvasIdentity = safeText(job.canvasIdentity?.key, 100);
  if (!canvasIdentity) return safeName(`${job.taskName}_一键做同款`, "一键做同款任务");
  const readableTaskName = safeName(job.taskName, "一键做同款任务").slice(0, 64);
  return safeName(`${readableTaskName}_一键做同款_${canvasIdentity.slice(-8)}`, "一键做同款任务");
}

function parseCanvasUrl(value) {
  let parsed;
  try {
    parsed = new URL(String(value || "").trim());
  } catch {
    throw new Error("请输入合法的 LibTV 画布 URL");
  }
  if (!/^(?:www\.)?liblib\.tv$/i.test(parsed.hostname) || parsed.pathname !== "/canvas") {
    throw new Error("仅支持 https://www.liblib.tv/canvas 画布地址");
  }
  const spaceId = safeText(parsed.searchParams.get("spaceId"), 40);
  const projectId = safeText(parsed.searchParams.get("projectId"), 80);
  if (!/^\d+$/.test(spaceId)) throw new Error("画布 URL 缺少有效的 spaceId");
  if (!/^[a-f0-9-]{20,80}$/i.test(projectId)) throw new Error("画布 URL 缺少有效的 projectId");
  return {
    canvasUrl: `https://www.liblib.tv/canvas?spaceId=${spaceId}&projectId=${projectId}`,
    spaceId,
    projectId
  };
}

function changeType(value) {
  const found = CHANGE_TYPES.find((item) => item.id === String(value || ""));
  if (!found) throw new Error("请选择有效的做同款类型");
  return found;
}

function auditSupportsChangeType(audit = {}, selectedChangeType = {}) {
  const normalizedType = changeType(selectedChangeType.id || selectedChangeType);
  if (!audit || !Array.isArray(audit.assets)) return false;
  return audit.assets.every((asset) => {
    if (asset?.mediaType === "text") {
      return Array.isArray(asset.content) && asset.textTrace && Array.isArray(asset.textTrace.conflicts);
    }
    if (asset?.mediaType !== "image") return true;
    if (normalizedType.changesProduct && typeof asset.productBearing !== "boolean") return false;
    if (normalizedType.changesBackground && typeof asset.backgroundBearing !== "boolean") return false;
    if (normalizedType.changesPerson && typeof asset.personBearing !== "boolean") return false;
    return true;
  });
}

function reclassifyAuditForChangeType(audit = {}, selectedChangeType = {}) {
  const normalizedType = changeType(selectedChangeType.id || selectedChangeType);
  const assets = (Array.isArray(audit?.assets) ? audit.assets : []).map((asset) => {
    const isImage = asset?.mediaType === "image";
    const isText = asset?.mediaType === "text";
    const rebuildRoles = [
      isImage && normalizedType.changesProduct && asset.productBearing === true ? "产品" : "",
      isImage && normalizedType.changesBackground && asset.backgroundBearing === true ? "背景" : "",
      isImage && normalizedType.changesPerson && asset.personBearing === true ? "人物" : "",
      isText && normalizedType.changesProduct && asset.textTrace?.rewriteRequired === true ? "SKU文本" : ""
    ].filter(Boolean);
    const baseAsset = {
      ...asset,
      rebuildRoles,
      rebuildRequired: rebuildRoles.length > 0
    };
    const directProductReference = normalizedType.changesProduct
      && rebuildRoles.length === 1
      && rebuildRoles[0] === "产品"
      && isDirectProductReferenceAsset(baseAsset);
    return {
      ...baseAsset,
      generationRequired: !isText && baseAsset.rebuildRequired && !directProductReference,
      replacementStrategy: isText
        ? asset.textTrace?.rewriteRequired ? "rewrite_text" : "reuse_text"
        : directProductReference
        ? "direct_oss_product_asset"
        : baseAsset.rebuildRequired ? "generate_candidate" : "reuse_source"
    };
  });
  return {
    ...audit,
    videoType: normalizedType.label,
    assets
  };
}

function taskSucceeded(node) {
  const status = node?.data?.taskInfo?.status;
  const loading = node?.data?.taskInfo?.loading === true;
  const urls = Array.isArray(node?.data?.url) ? node.data.url.filter(Boolean) : [];
  return !loading && (Number(status) === 2 || String(status).toLowerCase() === "success") && urls.length > 0;
}

function videoNodeGenerationState(node = {}) {
  const data = node?.data && typeof node.data === "object" ? node.data : {};
  const taskInfo = data?.taskInfo && typeof data.taskInfo === "object"
    ? data.taskInfo
    : node?.taskInfo && typeof node.taskInfo === "object" ? node.taskInfo : {};
  const urls = (Array.isArray(data.url) ? data.url : Array.isArray(node?.url) ? node.url : [node?.url])
    .map((value) => safeText(value, 5000))
    .filter(Boolean);
  const rawStatus = taskInfo.status;
  const numericStatus = Number(rawStatus);
  const statusText = safeText(rawStatus, 80).toLowerCase();
  const taskId = safeText(taskInfo.taskId || taskInfo.task_id, 200);
  const loading = taskInfo.loading === true;
  const progressPercent = Math.max(0, Math.min(100, Number(taskInfo.progressPercent || taskInfo.progress || 0)));
  const reason = safeText(taskInfo.error || taskInfo.reason || taskInfo.message || data.error || data.reason || data.message, 2000);
  const base = {
    nodeKey: safeText(node?.nodeKey || node?.newNodeKey || data?.nodeKey, 160),
    taskId,
    rawStatus: rawStatus ?? null,
    loading,
    progressPercent,
    reason,
    videoUrl: urls[0] || ""
  };
  if (urls.length) return { ...base, state: "ready" };
  if ((Number.isFinite(numericStatus) && numericStatus === 3)
    || ["failed", "failure", "error", "cancelled", "canceled"].includes(statusText)) {
    return { ...base, state: "failed" };
  }
  if (loading
    || (Number.isFinite(numericStatus) && [0, 1].includes(numericStatus))
    || ["queued", "queueing", "pending", "submitted", "running", "processing", "generating"].includes(statusText)
    || (Boolean(taskId) && !(Number.isFinite(numericStatus) && numericStatus === 2) && statusText !== "success")) {
    return { ...base, state: "pending" };
  }
  if ((Number.isFinite(numericStatus) && numericStatus === 2) || statusText === "success") {
    return { ...base, state: "awaiting_result" };
  }
  return { ...base, state: "idle" };
}

function upstreamNodeType(value, fallback = "") {
  const normalized = safeText(value || fallback, 80).toLowerCase().replace(/[\s_]+/g, "-");
  const compact = normalized.replace(/-/g, "");
  if (["image", "img", "picture", "imagenode"].includes(compact)) return "image";
  if (["video", "movie", "videonode"].includes(compact)) return "video";
  if (["audio", "sound", "voice", "audionode"].includes(compact)) return "audio";
  if (["text", "txt", "prompt", "textnode"].includes(compact)) return "text";
  return normalized || "asset";
}

function upstreamTextContent(row = {}) {
  const source = row?.content ?? row?.data?.content ?? row?.text ?? row?.value ?? row?.prompt;
  const values = Array.isArray(source) ? source : source == null ? [] : [source];
  return values
    .map((item) => String(item ?? "").slice(0, 50000))
    .filter((item) => item.trim());
}

function orderedMedia(params = {}) {
  const lists = [
    ["image", params.imageList],
    ["video", params.videoList],
    ["audio", params.audioList],
    ["text", params.textList],
    ["", params.mixedList]
  ];
  const byId = new Map();
  for (const [fallbackType, rows] of lists) {
    for (const row of Array.isArray(rows) ? rows : []) {
      const nodeKey = safeText(typeof row === "string" ? row : row?.nodeId || row?.nodeKey || row?.id, 160);
      if (!nodeKey) continue;
      const existing = byId.get(nodeKey);
      const mediaType = upstreamNodeType(row?.mediaType || row?.nodeType || row?.type || row?.modality, fallbackType);
      const content = mediaType === "text" ? upstreamTextContent(row) : [];
      const conflicts = clone(existing?.sourceConflicts || []);
      if (existing && existing.mediaType !== "asset" && mediaType !== "asset" && existing.mediaType !== mediaType) {
        conflicts.push({
          type: "node_type_mismatch",
          message: `同一 nodeKey 同时出现在 ${existing.mediaType} 与 ${mediaType} 上游清单中`
        });
      }
      if (existing?.content?.length && content.length && JSON.stringify(existing.content) !== JSON.stringify(content)) {
        conflicts.push({
          type: "text_content_mismatch",
          message: "同一文本 nodeKey 在不同上游清单中的内容不一致"
        });
      }
      byId.set(nodeKey, {
        ...existing,
        nodeKey,
        mediaType: existing?.mediaType && existing.mediaType !== "asset" ? existing.mediaType : mediaType,
        label: safeText(row?.label || row?.name || existing?.label || nodeKey, 500),
        url: safeText(row?.url || existing?.url, 5000),
        width: Number(row?.width || existing?.width || 0),
        height: Number(row?.height || existing?.height || 0),
        assetId: safeText(row?.assetId || existing?.assetId, 240),
        content: existing?.content?.length ? existing.content : content,
        sourceConflicts: conflicts
      });
    }
  }
  const order = Array.isArray(params.mixedListOrder) && params.mixedListOrder.length
    ? params.mixedListOrder
    : [
        ...(Array.isArray(params.imageListOrder) ? params.imageListOrder : []),
        ...(Array.isArray(params.videoListOrder) ? params.videoListOrder : []),
        ...(Array.isArray(params.audioListOrder) ? params.audioListOrder : []),
        ...(Array.isArray(params.textListOrder) ? params.textListOrder : [])
      ];
  const result = [];
  for (const keyValue of order) {
    const key = safeText(typeof keyValue === "string" ? keyValue : keyValue?.nodeId || keyValue?.nodeKey || keyValue?.id, 160);
    const item = byId.get(key);
    if (item && !result.some((row) => row.nodeKey === item.nodeKey)) result.push(item);
  }
  for (const item of byId.values()) {
    if (item.mediaType === "text" && !item.content?.length && !(item.sourceConflicts || []).some((conflict) => conflict.type === "missing_text_content")) {
      item.sourceConflicts ||= [];
      item.sourceConflicts.push({
        type: "missing_text_content",
        message: "文本节点已返回 nodeKey，但没有返回 data.content 正文"
      });
    }
    if (!result.some((row) => row.nodeKey === item.nodeKey)) result.push(item);
  }
  for (const nodeKey of promptNodeKeys(params.prompt)) {
    if (result.some((row) => row.nodeKey === nodeKey)) continue;
    result.push({
      nodeKey,
      mediaType: "asset",
      label: nodeKey,
      url: "",
      width: 0,
      height: 0,
      assetId: "",
      content: [],
      sourceConflicts: [{
        type: "missing_upstream_payload",
        message: "提示词引用了该 nodeKey，但生成参数未返回对应上游节点内容"
      }]
    });
  }
  return result;
}

function auditCoversSourceParams(audit = {}, params = {}) {
  if (!Array.isArray(audit?.assets)) return false;
  const audited = new Map(audit.assets.map((asset) => [String(asset?.nodeKey || ""), asset]));
  return orderedMedia(params).every((sourceAsset) => {
    const asset = audited.get(sourceAsset.nodeKey);
    if (!asset) return false;
    const auditedType = safeText(asset.mediaType, 80);
    if (auditedType && upstreamNodeType(auditedType) !== upstreamNodeType(sourceAsset.mediaType)) return false;
    if (sourceAsset.mediaType === "text") {
      return Array.isArray(asset.content) && JSON.stringify(asset.content) === JSON.stringify(sourceAsset.content);
    }
    return true;
  });
}

function promptNodeKeys(prompt) {
  const keys = [];
  const pattern = /\{\{Node\s+["']?([^}"']+?)["']?\}\}/g;
  let match;
  while ((match = pattern.exec(String(prompt || "")))) {
    const nodeKey = safeText(match[1], 160);
    if (nodeKey && !keys.includes(nodeKey)) keys.push(nodeKey);
  }
  return keys;
}

function replaceNodeReferences(prompt, nodeMap) {
  let output = String(prompt || "");
  for (const [sourceKey, targetKey] of Object.entries(nodeMap || {})) {
    output = output
      .split(`{{Node ${sourceKey}}}`).join(`{{Node ${targetKey}}}`)
      .split(`{{Node \"${sourceKey}\"}}`).join(`{{Node ${targetKey}}}`)
      .split(`{{Node '${sourceKey}'}}`).join(`{{Node ${targetKey}}}`);
  }
  return output;
}

function cliValue(value) {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function buildVideoNodeArgs(input = {}) {
  const params = input.params || {};
  const args = [
    "node", "--x", String(input.x ?? 860), "--y", String(input.y ?? 260),
    "create", safeText(input.name, 160) || "一键做同款-成片",
    "-p", safeText(input.projectId, 100), "-t", "video",
    "--prompt", String(input.prompt || "")
  ];
  const mergedSettings = new Map();
  for (const [key, value] of Object.entries(params)) {
    if (SOURCE_PARAM_OMIT.has(key) || value === undefined || value === null || value === "") continue;
    mergedSettings.set(key, value);
  }
  for (const [key, value] of Object.entries(params.settings || {})) {
    if (value === undefined || value === null || value === "") continue;
    mergedSettings.set(key, value);
  }
  for (const [key, value] of Object.entries(params.advancedSettings || {})) {
    if (value === undefined || value === null || value === "") continue;
    mergedSettings.set(key, value);
  }
  for (const [key, value] of mergedSettings) args.push("-s", `${key}=${cliValue(value)}`);
  for (const nodeKey of new Set(input.upstreamNodeKeys || [])) args.push("--left", String(nodeKey));
  args.push("--run");
  return args;
}

async function runPool(items, concurrency, worker) {
  const source = Array.from(items || []);
  const output = new Array(source.length);
  let cursor = 0;
  async function next() {
    while (cursor < source.length) {
      const index = cursor++;
      output[index] = await worker(source[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, source.length || 1)) }, next));
  return output;
}

function durationMs(startedAt) {
  return Math.max(0, Date.now() - Number(startedAt || Date.now()));
}

function normalizedRole(value) {
  return safeText(value, 500).toLowerCase().replace(/[\s_-]+/g, "");
}

function isDirectProductReferenceAsset(asset = {}) {
  if (asset.mediaType !== "image" || asset.productBearing !== true) return false;
  if (asset.backgroundBearing === true || asset.personBearing === true) return false;
  const text = normalizedRole(`${asset.role || ""} ${asset.label || ""}`);
  return /(productasset|productreference|packshot|产品资料图|产品参考图|商品资料图|产品白底图|包装白底图)/i.test(text);
}

function profileFromProduct(product = {}) {
  const value = product && typeof product === "object" ? product : {};
  return value.productProfile || value.replacementContract || value;
}

function productAliases(product = {}) {
  const profile = profileFromProduct(product) || {};
  return [...new Set([
    product.name,
    product.platformName,
    product.shortName,
    profile.formalName,
    profile.platformName,
    profile.shortName,
    ...(Array.isArray(profile.aliases) ? profile.aliases : [])
  ].map((item) => safeText(item, 200)).filter((item) => item.length >= 2))]
    .sort((left, right) => right.length - left.length);
}

function sourceProductMentions(prompt, sourceProduct = {}, targetProduct = {}) {
  const text = String(prompt || "").toLowerCase();
  const targetAliases = new Set(productAliases(targetProduct).map((item) => item.toLowerCase()));
  return productAliases(sourceProduct).filter((alias) => {
    const normalized = alias.toLowerCase();
    return !targetAliases.has(normalized) && text.includes(normalized);
  });
}

function replaceSourceProductAliases(prompt, sourceProduct = {}, targetProduct = {}) {
  const targetName = safeText(targetProduct.name || targetProduct.platformName || profileFromProduct(targetProduct)?.platformName, 200);
  if (!targetName) return String(prompt || "");
  let output = String(prompt || "");
  for (const alias of productAliases(sourceProduct)) {
    if (productAliases(targetProduct).some((item) => item.toLowerCase() === alias.toLowerCase())) continue;
    output = output.replace(new RegExp(alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), targetName);
  }
  return output;
}

function mentionedProducts(text, products = []) {
  const normalized = String(text || "").toLowerCase();
  return (products || []).map((product) => {
    const aliases = productAliases(product).filter((alias) => normalized.includes(alias.toLowerCase()));
    return aliases.length ? {
      id: String(product.id || ""),
      name: safeText(product.name || product.platformName || product.id, 200),
      aliases
    } : null;
  }).filter(Boolean);
}

function analyzeSourceTextAsset(asset = {}, sourceProduct = {}, products = []) {
  const content = Array.isArray(asset.content) ? asset.content.map(String) : [];
  const joined = content.join("\n");
  const sourceMentions = sourceProductMentions(joined, sourceProduct, {});
  const productMentions = mentionedProducts(joined, products);
  const sourceId = String(sourceProduct?.id || "");
  const conflictingProducts = sourceId
    ? productMentions.filter((item) => item.id !== sourceId)
    : productMentions.length > 1 ? productMentions : [];
  const sourceConflicts = clone(asset.sourceConflicts || []);
  const conflicts = [
    ...sourceConflicts,
    ...conflictingProducts.map((item) => ({
      type: "unexpected_sku_reference",
      productId: item.id,
      productName: item.name,
      message: `文本节点除原片 SKU 外还引用了 ${item.name}`
    }))
  ];
  return {
    content,
    sourceMentions,
    productMentions,
    rewriteRequired: sourceMentions.length > 0,
    conflicts,
    status: conflicts.length ? "conflict" : sourceMentions.length ? "rewrite_required" : "reuse"
  };
}

const EXPLICIT_PRODUCT_TEXT_PATTERN = /(?:产品|商品|SKU|包装|外盒|盒装|瓶身|瓶体|瓶盖|瓶口|罐体|罐装|罐盖|泵头|喷头|滴管|喷雾|面膜|眼膜|膜布|贴片|精华|次抛|安瓶|乳液|面霜|乳霜|膏体|料体|开罐|开瓶|开盖|挖取|挤取|按压泵头|按压喷头|喷洒|涂抹|贴敷|敷脸)/i;
const HYPOTHETICAL_TEXT_CONFLICT_PATTERN = /(?:若后续|如果后续|如后续|假如|假设|可能|或许|推测|预计|隐含|一旦.*涉及)/i;
const PRODUCT_TEXT_CONFLICT_PATTERN = /(?:sku|产品|商品|包装|形态|开合|按压|取用|动作|数量)/i;
const TEXT_CONFLICT_POLICY_VERSION = "text-conflict-evidence-v1";

function textHasExplicitProductSemantics(asset = {}, sourceProduct = {}, products = []) {
  const joined = (Array.isArray(asset.content) ? asset.content : []).map(String).join("\n");
  if (!joined.trim()) return false;
  if (sourceProductMentions(joined, sourceProduct, {}).length) return true;
  if (mentionedProducts(joined, products).length) return true;
  return EXPLICIT_PRODUCT_TEXT_PATTERN.test(joined);
}

function shouldCompileTextAssetWithModel(input = {}) {
  if (input.changeType?.changesVoiceover && safeText(input.voiceover, 40000)) return true;
  if (!input.changeType?.changesProduct) return false;
  return textHasExplicitProductSemantics(input.asset, input.sourceProduct, input.products);
}

function normalizedEvidenceText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[“”‘’"'`《》〈〉【】\[\]（）()，。；：、！？!?,.;:\s]/g, "");
}

function evidenceAppearsInSource(evidence, sourceText) {
  const source = normalizedEvidenceText(sourceText);
  const candidates = [String(evidence || ""), ...(String(evidence || "").match(/[“\"']([^”\"']+)[”\"']/g) || [])]
    .map((item) => normalizedEvidenceText(item))
    .filter((item) => item.length >= 4);
  return candidates.some((item) => source.includes(item));
}

function groundModelTextConflicts(input = {}) {
  const asset = input.asset || {};
  const sourceText = (Array.isArray(asset.content) ? asset.content : []).map(String).join("\n");
  const hasProductSemantics = textHasExplicitProductSemantics(asset, input.sourceProduct, input.products);
  const conflicts = [];
  const warnings = [];
  for (const raw of Array.isArray(input.conflicts) ? input.conflicts : []) {
    const conflict = typeof raw === "string"
      ? { type: "model_reported_conflict", message: safeText(raw, 1000), evidence: "" }
      : {
          type: safeText(raw?.type, 100) || "model_reported_conflict",
          message: safeText(raw?.message, 1000) || "文本节点存在未解决冲突",
          evidence: safeText(raw?.evidence, 1200)
        };
    if (!conflict.message) continue;
    const hypothesisText = `${conflict.message}\n${conflict.evidence}`;
    const isHypothetical = HYPOTHETICAL_TEXT_CONFLICT_PATTERN.test(hypothesisText);
    const isProductConflict = PRODUCT_TEXT_CONFLICT_PATTERN.test(`${conflict.type}\n${conflict.message}`);
    const isGrounded = conflict.evidence && evidenceAppearsInSource(conflict.evidence, sourceText);
    if (isHypothetical || !isGrounded || (isProductConflict && !hasProductSemantics)) {
      warnings.push(`模型冲突未作为阻断项：${conflict.message}`);
      continue;
    }
    conflicts.push(conflict);
  }
  return { conflicts, warnings };
}

function compileTextAssetForTarget(asset = {}, sourceProduct = {}, targetProduct = {}, products = []) {
  const sourceContent = Array.isArray(asset.content) ? asset.content.map(String) : [];
  const targetIdentity = targetProductIdentity(targetProduct);
  const content = sourceContent.map((item) => replaceSourceProductAliases(item, sourceProduct, targetIdentity));
  const joined = content.join("\n");
  const staleSourceMentions = sourceProductMentions(joined, sourceProduct, targetIdentity);
  const targetId = String(targetIdentity.id || "");
  const unexpectedProducts = mentionedProducts(joined, products)
    .filter((item) => targetId && item.id !== targetId)
    .filter((item) => String(sourceProduct?.id || "") !== item.id || staleSourceMentions.length > 0);
  const sourceConflicts = clone(asset.textTrace?.conflicts || asset.sourceConflicts || []);
  const conflicts = [
    ...sourceConflicts,
    ...staleSourceMentions.map((alias) => ({
      type: "stale_source_sku_reference",
      alias,
      message: `改写后仍残留原片 SKU 名称“${alias}”`
    })),
    ...unexpectedProducts.map((item) => ({
      type: "unexpected_sku_reference",
      productId: item.id,
      productName: item.name,
      message: `改写结果仍引用非目标 SKU：${item.name}`
    }))
  ];
  const rewritten = JSON.stringify(content) !== JSON.stringify(sourceContent);
  return {
    sourceNodeKey: asset.nodeKey,
    sourceLabel: asset.label,
    sourceContent,
    content,
    status: conflicts.length ? "conflict" : rewritten ? "rewritten" : "reused",
    rewritten,
    replacements: sourceProductMentions(sourceContent.join("\n"), sourceProduct, targetIdentity)
      .map((alias) => ({ from: alias, to: targetIdentity.name })),
    conflicts
  };
}

function compileTargetTextAssets(assets = [], sourceProduct = {}, targetProduct = {}, products = []) {
  return (assets || [])
    .filter((asset) => asset?.mediaType === "text")
    .map((asset) => compileTextAssetForTarget(asset, sourceProduct, targetProduct, products));
}

function textTransformForAsset(target = {}, sourceNodeKey = "") {
  return (target.upstreamTextAssets || []).find((item) => item.sourceNodeKey === sourceNodeKey) || null;
}

function assertNoTextAssetConflicts(target = {}) {
  const conflicts = (target.upstreamTextAssets || []).flatMap((item) =>
    (item.conflicts || []).map((conflict) => `${item.sourceLabel || item.sourceNodeKey}：${conflict.message || conflict.type}`)
  );
  if (conflicts.length) {
    const error = new Error(`上游文本节点存在 SKU 或来源冲突：${conflicts.join("；")}`);
    error.code = "UPSTREAM_TEXT_ASSET_CONFLICT";
    throw error;
  }
}

function buildStaticTextNodeArgs(input = {}) {
  const content = Array.isArray(input.content) ? input.content.map(String) : [];
  if (!content.length) throw new Error(`上游文本节点缺少内容：${safeText(input.name, 160) || "未命名节点"}`);
  return [
    "node", "--x", String(input.x ?? 0), "--y", String(input.y ?? 0),
    "create", safeText(input.name, 160) || "上游文本",
    "-p", safeText(input.projectId, 100), "-t", "text",
    "-u", `content=${JSON.stringify(content)}`
  ];
}

function textAssetCompilerMessages(input = {}) {
  return [
    {
      role: "system",
      content: [
        "你是上游文本节点 SKU 改写器。文本节点与图片、视频、音频一样是正式上游资产，必须逐 nodeKey 溯源并为每个目标 SKU 生成独立版本。",
        "只调整产品身份、包装层级、形态、数量、持法、开合/按压/取用等产品专属动作和用户明确要求的新口播；人物、场景、镜头、节奏、非产品道具及其他剧情事实保持不变。",
        "目标 SKU 事实只允许来自 targetProduct；不得沿用与目标形态冲突的源产品动作，不得编造 targetProduct 未提供的尺寸、功效、数量或使用方式。",
        "检查并报告：旧 SKU 名称或别名残留、其他 SKU 混入、包装层级冲突、产品动作冲突、数量冲突、文本内部自相矛盾。能够按目标资料确定性修复的必须直接修复；证据不足且无法安全修复的写入 conflicts。",
        "conflicts 只能记录源文本中已经明确发生的事实冲突，evidence 必须逐字引用 sourceContent 中的原文片段。不得根据 sourceProduct 或 targetProduct 推测文本隐含了产品、产品动作或后续画面；‘若后续、可能、假设、隐含’等条件性建议只能写入 warnings。",
        "如果 sourceContent 没有明确产品名称、包装/形态词或产品专属操作，必须保持原文并返回 conflicts=[]；普通人物动作、运动动作和非产品道具动作不属于产品冲突。",
        "必须保持原 content 条数和顺序；保留所有 {{Node ...}} 引用，不得新增不存在的 nodeKey。",
        "只返回 JSON：content（string[]）、replacements（from/to/reason 数组）、conflicts（type/message/evidence 数组）、warnings（string[]）。"
      ].join("\n")
    },
    {
      role: "user",
      content: JSON.stringify({
        sourceNodeKey: input.asset?.nodeKey || "",
        sourceLabel: input.asset?.label || "",
        sourceContent: input.asset?.content || [],
        sourceProduct: input.sourceProduct || null,
        targetProduct: input.targetProduct || null,
        changeType: input.changeType || null,
        newVoiceover: input.voiceover || ""
      })
    }
  ];
}

function targetProductIdentity(target = {}) {
  return {
    id: target.productId || target.id || "",
    name: target.productName || target.name || target.platformName || "",
    productProfile: target.productProfile || profileFromProduct(target)
  };
}

function replaceLegacyMappingProductAliases(prompt, target = {}) {
  const sourceProduct = target.sourceProduct || {};
  const targetProduct = targetProductIdentity(target);
  const sourceLabels = new Set((target.mappingPlan?.mappings || [])
    .map((row) => safeText(row.sourceLabel || row.sourceNodeKey, 500))
    .filter(Boolean));
  if (!sourceLabels.size) return String(prompt || "");
  return String(prompt || "").split(/(\r?\n)/).map((line) => {
    if (/^\r?\n$/.test(line)) return line;
    const content = line.trimStart();
    const isMappingLine = [...sourceLabels].some((label) => content.startsWith(`${label}：`));
    return isMappingLine ? replaceSourceProductAliases(line, sourceProduct, targetProduct) : line;
  }).join("");
}

function geometryContract(product = {}) {
  const value = product && typeof product === "object" ? product : {};
  const profile = profileFromProduct(value) || {};
  const geometry = profile.replacementGeometry || {};
  return {
    productId: profile.productId || value.id || "",
    productName: profile.platformName || profile.formalName || value.name || value.platformName || "",
    layer: geometry.layer || profile.quantityStrategy?.displayUnit || "",
    shape: geometry.shape || "",
    dimensionsCm: clone(geometry.dimensionsCm || {}),
    fixedLengthWidthHeightRatio: clone(geometry.fixedLengthWidthHeightRatio || []),
    heightToDiameter: geometry.heightToDiameter || null,
    orientationRule: geometry.orientationRule || "",
    invariants: clone(geometry.invariants || [])
  };
}

function geometryContractText(sourceProduct = {}, targetProduct = {}) {
  const source = geometryContract(sourceProduct);
  const target = geometryContract(targetProduct);
  const targetRatio = target.fixedLengthWidthHeightRatio.length
    ? `固定长×宽×高比例 ${target.fixedLengthWidthHeightRatio.join("∶")}`
    : "严格按资料卡实物尺寸";
  const sourceRatio = source.fixedLengthWidthHeightRatio.length
    ? `旧产品几何为 ${source.fixedLengthWidthHeightRatio.join("∶")}`
    : "先从源图逐个定位旧产品槽位";
  return [
    "【平台产品几何硬锁】",
    `${sourceRatio}；只继承其中心位置、承托面、遮挡层级和整体占用区域，禁止继承旧包装轮廓与单体比例。`,
    `新产品“${target.productName || "目标 SKU"}”为${target.shape || "资料卡定义形态"}，${targetRatio}，真实尺寸 ${JSON.stringify(target.dimensionsCm || {})}。`,
    target.heightToDiameter ? `高度/直径约 ${target.heightToDiameter}，不得拉长、压扁或改变横截面。` : "",
    target.orientationRule,
    ...(target.invariants || []),
    "先定位当前源图中每个可辨识旧产品的中心、边界框、触地/触架面和遮挡关系，再逐槽位用新几何一对一重建。不得依据尺寸或测试个例跨图换算、增加或减少数量。"
  ].filter(Boolean).join("\n");
}

function enforceGeometryCompiler(compiler = {}, input = {}) {
  if (!input.changeType?.changesProduct) return compiler;
  const sourceProduct = input.sourceProduct || {};
  const targetProduct = input.product || {};
  const carrierProps = (input.carrierPropAssessments || []).filter((item) => item.decision === "regenerate_with_product");
  const carrierHardLock = carrierProps.length ? [
    "【平台关联道具联合重构硬锁｜优先级高于前文保留描述】",
    ...carrierProps.map((item) => `${item.label || "承载道具"}已由系统自动判定为目标 SKU 的关联承载道具，必须与产品在同一次生图、同一张结果中完成重构。清除原道具像素后，在原位置保持其类别、品牌标识、主色、材质、外观风格和人物持物动作，只调整能真实容纳目标 SKU 所必需的袋体/箱体宽高、内部容积、开口与提手或接触关系。若前文出现“保留该道具”或“其他道具不变”，对本关联道具仅表示身份和风格不变，不包括原始尺寸。禁止缩小、压扁、弯曲或旋转目标产品迁就道具；除该关联道具外的其他道具继续锁定。`),
    "产品与关联道具必须同时修改成功；不得只替换产品而遗漏关联道具。"
  ].join("\n") : "";
  if (input.carrierOnly === true) {
    return {
      ...compiler,
      imagePrompt: `${safeText(compiler.imagePrompt, 18000)}\n\n${carrierHardLock}`.trim(),
      negativePrompt: [safeText(compiler.negativePrompt, 6000), "凭空新增产品，缩小产品迁就道具，压扁产品，承载道具类型改变，其他背景道具改变"].filter(Boolean).join("，"),
      scalePlan: {
        ...clone(compiler.scalePlan || {}),
        carrierFitReference: {
          target: geometryContract(targetProduct),
          policy: "resize_carrier_interior_only_without_adding_product"
        }
      },
      validationChecklist: [
        ...clone(compiler.validationChecklist || []),
        "承载道具内部容积和开口可容纳目标 SKU",
        "源图无产品像素时没有凭空新增产品",
        "承载道具类别、材质、颜色、位置、外观风格和其余画面保持不变"
      ]
    };
  }
  const hardLock = geometryContractText(sourceProduct, targetProduct);
  const negativeLock = "产品拉伸，产品压扁，长宽高比例漂移，旧罐体轮廓残留，单体尺寸不一，阵列漂移，悬浮，穿模，错误接触阴影";
  return {
    ...compiler,
    imagePrompt: `${safeText(compiler.imagePrompt, 18000)}\n\n${hardLock}\n\n${carrierHardLock}`.trim(),
    negativePrompt: [safeText(compiler.negativePrompt, 6000), negativeLock].filter(Boolean).join("，"),
    scalePlan: {
      ...clone(compiler.scalePlan || {}),
      physicalReplacement: {
        source: geometryContract(sourceProduct),
        target: geometryContract(targetProduct),
        procedure: ["定位当前源图的旧产品槽位", "锁定承托、遮挡和占用区域", "按目标固定比例逐槽位重建单体", "继承当前源图的实例数量与间距"]
      }
    },
    validationChecklist: [
      ...clone(compiler.validationChecklist || []),
      "逐个单体长宽高比例一致且符合目标 SKU 资料卡",
      "旧包装轮廓已完全清除",
      "没有跨图套用数量或根据尺寸推算全局数量",
      ...(carrierProps.length ? [
        "目标产品与关联承载道具已在同一张候选图中完成联合重构",
        "关联道具保持品牌、类别、颜色、材质、位置与持物动作，只调整必要容量和接触关系",
        "没有保留与目标 SKU 不匹配的原道具尺寸，也没有缩小产品迁就道具"
      ] : [])
    ]
  };
}

function productAssetScore(asset = {}, product = {}) {
  const profile = profileFromProduct(product) || {};
  const displayUnit = String(profile.quantityStrategy?.displayUnit || "");
  const text = `${asset.title || ""} ${asset.fileName || ""} ${asset.angleLabel || ""}`.toLowerCase();
  let score = 0;
  if (/正面|front/.test(text)) score += 30;
  if (/白底|透明底|packshot/.test(text)) score += 12;
  if (displayUnit === "retail_outer_box") {
    if (/外盒/.test(text)) score += 80;
    else if (/盒|包装/.test(text)) score += 45;
    if (/开盒|内托|联排|单支/.test(text)) score -= 45;
  } else if (displayUnit === "primary_container") {
    if (/瓶体|瓶装|圆罐|罐正面|罐体/.test(text)) score += 70;
    if (/外盒|盒装/.test(text)) score -= 35;
  }
  const preferred = Array.isArray(profile.assetGuidance) ? profile.assetGuidance[0] : "";
  for (const token of String(preferred || "").split(/[\s与、/]+/).filter((item) => item.length >= 2)) {
    if (text.includes(token.toLowerCase())) score += 20;
  }
  return score;
}

function rankProductAssets(assets = [], product = {}) {
  return assets.map((asset, index) => ({ asset, index, score: productAssetScore(asset, product) }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map((item) => item.asset);
}

function productVisualLayer(asset = {}) {
  const value = normalizedRole(`${asset.title || ""} ${asset.fileName || ""} ${asset.assetRole || ""} ${asset.angleLabel || ""}`);
  if (/(膜布|内容物|展开|材质|contentunit|sheetmask)/i.test(value)) return "content_unit";
  if (/(单片|袋|sachet|pouch)/i.test(value)) return "single_sachet";
  if (/(外盒|包装盒|盒正面|盒背面|retailouterbox)/i.test(value)) return "retail_outer_box";
  if (/(瓶|罐|管|泵头|primarycontainer)/i.test(value)) return "primary_container";
  return "unknown";
}

function selectProductVisualReferences(assets = [], product = {}, limit = 3) {
  const ranked = rankProductAssets(assets, product).filter((asset) => {
    const url = safeText(asset.storageUrl || asset.url || asset.remoteUrl, 5000);
    return asset.assetType === "image" && /^https?:\/\//i.test(url);
  });
  const selected = [];
  const layerPriority = ["content_unit", "single_sachet", "primary_container", "retail_outer_box", "unknown"];
  for (const layer of layerPriority) {
    const asset = ranked.find((item) => productVisualLayer(item) === layer && !selected.includes(item));
    if (!asset) continue;
    selected.push(asset);
    if (selected.length >= limit) break;
  }
  for (const asset of ranked) {
    if (selected.includes(asset)) continue;
    selected.push(asset);
    if (selected.length >= limit) break;
  }
  return selected.map((asset) => ({
    id: safeText(asset.id, 200),
    title: safeText(asset.title || asset.fileName || asset.id, 300),
    layer: productVisualLayer(asset),
    url: safeText(asset.storageUrl || asset.url || asset.remoteUrl, 5000)
  }));
}

function visualProductMatchMessages(input = {}) {
  const content = [];
  for (const frame of (input.sourceFrames || []).slice(0, 8)) {
    const url = safeText(frame.url || frame.dataUrl, 12_000_000);
    if (!url) continue;
    content.push({ type: "image_url", image_url: { url } });
    content.push({ type: "text", text: `原视频代表帧 frameId=${safeText(frame.id, 120)}，时间=${Number(frame.time || 0).toFixed(2)}秒。只识别画面中实际可见的产品，不把人体、服饰或背景当作产品。` });
  }
  for (const product of input.productCatalog || []) {
    for (const asset of (product.references || []).slice(0, 3)) {
      if (!asset.url) continue;
      content.push({ type: "image_url", image_url: { url: asset.url } });
      content.push({ type: "text", text: `SKU真值图 productId=${product.id}，productName=${product.name}，assetId=${asset.id}，assetTitle=${asset.title}，layer=${asset.layer}。` });
    }
  }
  content.push({
    type: "text",
    text: [
      `产品目录资料：${JSON.stringify((input.productCatalog || []).map((product) => ({ id: product.id, name: product.name, aliases: product.aliases, visualIdentity: product.visualIdentity, layers: product.layers })))}`,
      `原提示词线索：${safeText(input.sourcePrompt, 12000)}`,
      "请把原视频代表帧中的产品与候选 SKU 真值图逐层比较，并输出最多 3 个候选。"
    ].join("\n")
  });
  return [
    {
      role: "system",
      content: [
        "你是原视频产品视觉候选识别器。必须直接比较原视频代表帧与候选 SKU 真值图，不能只靠产品名称、文件名或提示词命中。",
        "先识别产品层级：retail_outer_box、single_sachet、primary_container、content_unit、usage_state 或 unknown；只在同层级或物理上可解释的层级之间比较。",
        "重点比较产品自身的轮廓、开孔结构、表面纹理、颜色、材质、包装版式与可见文字。人物身份、身体部位、服装、摆放位置和使用场景不得作为 SKU 身份依据。",
        "例如黑色完整脸型膜布应与 content_unit 展开膜布比较，不能因为它放在腹部而否定膜布身份，也不能把它误当成 single_sachet 包装袋。",
        "confidence 是 0 到 1 的视觉身份相似度；没有品牌文字时可以依据高度特异的形态与纹理给出候选，但必须在 uncertainty 中说明缺少品牌硬证据。",
        "只能返回给定产品目录中的 productId。候选按 confidence 从高到低排列，最多 3 个；证据不足时返回空数组，禁止猜测。",
        "只返回 JSON：candidates、noMatchReason。candidates 每项包含 productId、confidence、matchedLayer、visualEvidence、uncertainty、sourceFrameIds、referenceAssetIds。"
      ].join("\n")
    },
    { role: "user", content }
  ];
}

function normalizeVisualProductCandidates(result = {}, products = []) {
  const catalog = new Map(products.map((product) => [String(product.id), product]));
  const seen = new Set();
  return (Array.isArray(result.candidates) ? result.candidates : [])
    .map((candidate) => {
      const product = catalog.get(String(candidate?.productId || ""));
      if (!product || seen.has(String(product.id))) return null;
      seen.add(String(product.id));
      return {
        productId: String(product.id),
        productName: safeText(product.name || product.platformName || product.id, 300),
        confidence: Math.max(0, Math.min(1, Number(candidate.confidence || 0))),
        matchedLayer: safeText(candidate.matchedLayer, 80) || "unknown",
        visualEvidence: safeText(candidate.visualEvidence, 1200),
        uncertainty: safeText(candidate.uncertainty, 800),
        sourceFrameIds: Array.isArray(candidate.sourceFrameIds) ? candidate.sourceFrameIds.map((item) => safeText(item, 120)).filter(Boolean).slice(0, 8) : [],
        referenceAssetIds: Array.isArray(candidate.referenceAssetIds) ? candidate.referenceAssetIds.map((item) => safeText(item, 200)).filter(Boolean).slice(0, 8) : []
      };
    })
    .filter(Boolean)
    .sort((left, right) => right.confidence - left.confidence)
    .slice(0, 3);
}

function resolveSourceProductRecommendation(textMatch = {}, visualCandidates = [], products = []) {
  const candidates = Array.isArray(visualCandidates) ? visualCandidates : [];
  const visualTop = candidates[0] || null;
  const visualProduct = products.find((product) => String(product.id) === String(visualTop?.productId || "")) || null;
  const textProduct = textMatch.product || null;
  if (textProduct) {
    const sameVisual = visualTop && String(visualTop.productId) === String(textProduct.id);
    const visualConflict = visualTop && !sameVisual && visualTop.confidence >= 0.72;
    return {
      product: textProduct,
      confidence: sameVisual ? Math.max(Number(textMatch.confidence || 0), visualTop.confidence) : Number(textMatch.confidence || 0),
      evidence: sameVisual
        ? `${textMatch.evidence}；视觉一致：${visualTop.visualEvidence || visualTop.productName}`
        : textMatch.evidence || "产品名称匹配",
      method: sameVisual ? "text_visual_consensus" : "text_alias",
      requiresConfirmation: Boolean(textMatch.requiresConfirmation || visualConflict),
      candidates,
      conflict: visualConflict ? { textProductId: String(textProduct.id), visualProductId: visualTop.productId } : null
    };
  }
  if (visualProduct && visualTop.confidence >= 0.55) {
    return {
      product: visualProduct,
      confidence: visualTop.confidence,
      evidence: visualTop.visualEvidence || `视觉候选：${visualTop.productName}`,
      method: "visual_comparison",
      requiresConfirmation: true,
      candidates,
      conflict: null
    };
  }
  return {
    product: null,
    confidence: 0,
    evidence: "",
    method: candidates.length ? "visual_low_confidence" : "unmatched",
    requiresConfirmation: true,
    candidates,
    conflict: null
  };
}

function publicCandidate(candidate) {
  return {
    id: candidate.id,
    sourceNodeKey: candidate.sourceNodeKey,
    sourceLabel: candidate.sourceLabel,
    model: candidate.model,
    taskId: candidate.taskId,
    previewUrl: candidate.previewUrl,
    createdAt: candidate.createdAt,
    directReuse: candidate.directReuse === true,
    directReuseLabel: safeText(candidate.directReuseLabel, 160),
    productAssetId: candidate.productAssetId || "",
    preselected: candidate.preselected === true,
    round: candidate.customUpload === true ? 0 : Math.max(1, Number(candidate.round || 1)),
    promptSource: candidate.promptSource || "built_in",
    customUpload: candidate.customUpload === true,
    originalFileName: candidate.originalFileName || ""
  };
}

function publicBackgroundSceneCandidate(candidate = {}) {
  return {
    id: candidate.id,
    round: Math.max(1, Number(candidate.round || 1)),
    candidateIndex: Math.max(0, Number(candidate.candidateIndex || 0)),
    model: candidate.model || "",
    taskId: candidate.taskId || "",
    previewUrl: candidate.previewUrl || "",
    createdAt: candidate.createdAt || "",
    prompt: candidate.prompt || ""
  };
}

function backgroundSceneSourceAsset(job = {}) {
  const images = (job.audit?.assets || []).filter((asset) => asset?.mediaType === "image" && /^https?:\/\//i.test(String(asset?.url || "")));
  if (!images.length) return null;
  const score = (asset, index) => {
    const role = safeText(asset?.role, 200).toLowerCase().replace(/[\s-]+/g, "_");
    const label = safeText(asset?.label, 500).toLowerCase();
    if (["start_frame", "first_frame", "initial_frame"].includes(role)) return 1000 - index;
    if (/首帧|0秒|0s|first.?frame|start.?frame/.test(`${role} ${label}`)) return 900 - index;
    return 100 - index;
  };
  return images
    .map((asset, index) => ({ asset, score: score(asset, index) }))
    .sort((left, right) => right.score - left.score)[0]?.asset || images[0];
}

function usesUploadedFirstFrame(job = {}) {
  return job.changeType?.changesBackground === true
    && job.changeType?.changesProduct !== true
    && job.changeType?.changesPerson !== true;
}

function isDirectAssetGroup(group = {}) {
  return ["oss_direct", "uploaded_first_frame"].includes(group.sourceMode);
}

function uploadedFirstFrameVideoPrompt(prompt, sourceAsset = {}, instruction = "") {
  const sourceNodeKey = safeText(sourceAsset.nodeKey, 240);
  if (!sourceNodeKey) throw new Error("源画布缺少可替换的首帧 nodeKey");
  const placeholder = `{{Node ${sourceNodeKey}}}`;
  return [
    safeText(prompt, 40000),
    "【用户上传首帧直替规则】",
    `${placeholder} 是用户确认的新视频完整首帧，直接替换源首帧节点“${safeText(sourceAsset.label || sourceNodeKey, 300)}”，不是额外背景参考图。`,
    "视频 0 秒画面必须与该首帧一致，并从这张图自然开始运动；沿用源视频的时长、比例、生成模式、镜头节奏和其余上游素材，不再重构或二次生成首帧。",
    instruction ? `用户补充要求：${safeText(instruction, 4000)}` : ""
  ].filter(Boolean).join("\n");
}

function backgroundSceneGenerationPrompt(input = {}) {
  const userPrompt = safeText(input.prompt, 6000);
  if (!userPrompt) throw new Error("请填写新背景生图提示词");
  const sourceAsset = input.sourceAsset || {};
  const round = Math.max(1, Math.min(MAX_BACKGROUND_SCENE_GENERATION_ROUNDS, Number(input.round || 1)));
  return [
    "【一键做同款·纯背景场景生成】",
    `输入图是画布中的首帧“${safeText(sourceAsset.label || sourceAsset.role || sourceAsset.nodeKey, 300) || "首帧"}”，只用于继承机位、景别、镜头高度、透视、地平线、空间比例与画幅。`,
    "先彻底移除输入图中的所有人物、脸、头发、身体、手、人体倒影和人体阴影；同时彻底移除全部产品、商品包装、品牌、Logo、标签、价格、促销信息、可读文字及其倒影和阴影。",
    `随后生成新的空场景：${userPrompt}`,
    "输出必须是一张没有人物、没有人体局部、没有产品、没有商品包装、没有品牌标识、没有文字的纯背景场景图；被移除区域必须以合理的墙面、地面、家具或环境材质自然补全，不得留下空洞、透明区、模糊遮挡、残影或复制痕迹。",
    "保持原首帧的画幅、机位和透视关系，但不要保留原场景的具体装修、陈设或环境身份；按新场景重新建立一致的光向、景深、反射、材质和空间层次，保证后续可自然合成人物与产品。",
    `当前为第 ${round} 轮，每轮生成两张独立候选；两张都必须完整满足以上洁净背景约束。`
  ].join("\n");
}

function compilerForUserImagePrompt(group = {}, prompt = "", round = 2) {
  const currentRound = Math.max(2, Math.min(MAX_IMAGE_GENERATION_ROUNDS, Number(round || 2)));
  const correctionPrompt = safeText(prompt, 6000);
  const baselinePrompt = safeText(group.compiler?.imagePrompt, 18000);
  if (!baselinePrompt) throw new Error("缺少首轮生图基线提示词");
  const category = group.compiler?.category || IMAGE_PROMPT_CATEGORIES[0];
  const platformSafetyLock = [
    "【平台不可覆盖的身份与结构校验】",
    category.builtInPrompt,
    `第 ${currentRound} 轮人工内容仅作为针对已有候选问题的纠偏补充，不覆盖首轮基线，不得扩大本次变更白名单；如与产品身份、包装文字、Logo、固定几何比例或未授权对象锁定冲突，以平台身份与结构校验为准。`,
    group.compiler?.scalePlan?.physicalReplacement
      ? `目标产品几何：${JSON.stringify(group.compiler.scalePlan.physicalReplacement.target || {})}`
      : ""
  ].filter(Boolean).join("\n");
  const correctionSection = correctionPrompt
    ? `【第 ${currentRound} 轮人工纠偏（只修复以下问题）】\n${correctionPrompt}`
    : `【第 ${currentRound} 轮人工纠偏】\n未填写额外纠偏，按首轮基线重新采样两张候选图。`;
  return {
    ...clone(group.compiler || {}),
    category: clone(category),
    imagePrompt: `${baselinePrompt}\n\n${correctionSection}\n\n${platformSafetyLock}`,
    baselinePrompt,
    correctionPrompt,
    userPrompt: correctionPrompt,
    promptSource: correctionPrompt ? "user_correction" : "baseline_resample",
    validationChecklist: [
      ...clone(group.compiler?.validationChecklist || []),
      `第 ${currentRound} 轮结果逐项核对产品替换洁净度、身份准确度与场景适配度`
    ]
  };
}

function publicJob(job) {
  const clean = clone(job);
  delete clean?.runtime;
  if (clean.backgroundSceneGeneration) {
    clean.backgroundSceneGeneration.candidates = (clean.backgroundSceneGeneration.candidates || []).map(publicBackgroundSceneCandidate);
    clean.backgroundSceneGeneration.pendingCandidates = (clean.backgroundSceneGeneration.pendingCandidates || []).map((pending) => {
      const cleanPending = clone(pending);
      delete cleanPending.localPath;
      delete cleanPending.remoteUrl;
      if (cleanPending.candidate) cleanPending.candidate = publicBackgroundSceneCandidate(cleanPending.candidate);
      return cleanPending;
    });
  }
  if (clean.backgroundFirstFrameOverride) delete clean.backgroundFirstFrameOverride.localPath;
  for (const asset of clean.replacementAssets || []) delete asset.localPath;
  for (const target of clean.targets || []) {
    if (target.firstFrameOverride) delete target.firstFrameOverride.localPath;
    for (const asset of target.replacementAssets || []) delete asset.localPath;
    for (const group of target.assetGroups || []) {
      if (group.firstFrameOverride) delete group.firstFrameOverride.localPath;
      group.candidates = (group.candidates || []).map(publicCandidate);
      group.pendingCandidates = (group.pendingCandidates || []).map((pending) => {
        const cleanPending = clone(pending);
        delete cleanPending.localPath;
        if (cleanPending.candidate) cleanPending.candidate = publicCandidate(cleanPending.candidate);
        return cleanPending;
      });
    }
    if (target.result) delete target.result.localPath;
    for (const round of target.videoRounds || []) delete round.localPath;
  }
  return clean;
}

function normalizeRecipeSearchFilters(filters = {}) {
  return {
    keyword: safeText(filters.keyword, 240),
    productId: safeText(filters.productId, 128),
    changeType: safeText(filters.changeType, 40),
    videoType: safeText(filters.videoType, 80),
    model: safeText(filters.model, 128),
    taskId: safeText(filters.taskId, 128),
    dateFrom: /^\d{4}-\d{2}-\d{2}$/.test(String(filters.dateFrom || "")) ? String(filters.dateFrom) : "",
    dateTo: /^\d{4}-\d{2}-\d{2}$/.test(String(filters.dateTo || "")) ? String(filters.dateTo) : "",
    includeSourceAudits: filters.includeSourceAudits === true || String(filters.includeSourceAudits || "").toLowerCase() === "true",
    page: Math.max(1, Number(filters.page || 1)),
    pageSize: Math.max(1, Math.min(50, Number(filters.pageSize || 12)))
  };
}

function recipeSearchText(recipe = {}) {
  return [
    recipe.title,
    recipe.targetProduct?.id,
    recipe.targetProduct?.name,
    recipe.audit?.videoType,
    recipe.audit?.summary,
    recipe.changeType?.id,
    recipe.changeType?.label,
    recipe.source?.taskId,
    recipe.source?.canvasUrl,
    recipe.source?.spaceId,
    recipe.source?.projectId,
    recipe.source?.videoNodeName,
    recipe.source?.model,
    recipe.videoPrompt?.source,
    recipe.videoPrompt?.compiled,
    JSON.stringify(recipe.videoPrompt?.replacements || []),
    JSON.stringify(recipe.sourceSnapshot || {}),
    JSON.stringify(recipe.targetProduct?.profile || {}),
    JSON.stringify(recipe.productMapping || {}),
    JSON.stringify(recipe.dataGapReport || []),
    JSON.stringify(recipe.replacementInstructions || {}),
    ...(recipe.replacementAssets || []).flatMap((item) => [item.role, item.label, item.logicalNodeKey]),
    ...(recipe.productAssets || []).flatMap((item) => [item.title, item.angleLabel, item.fileName]),
    ...(recipe.imagePrompts || []).flatMap((item) => [
      item.sourceLabel,
      item.compiler?.imagePrompt,
      item.compiler?.negativePrompt,
      JSON.stringify(item.compiler?.scalePlan || {})
    ]),
    ...(recipe.tags || [])
  ].filter(Boolean).join("\n").toLowerCase();
}

function searchLocalRecipes(recipes, filters = {}) {
  const normalized = normalizeRecipeSearchFilters(filters);
  const tokens = normalized.keyword.toLowerCase().split(/\s+/).filter(Boolean);
  let items = Array.from(recipes || []).filter((recipe) => {
    if (!normalized.includeSourceAudits && recipe.caseStage === "source_ready") return false;
    if (normalized.productId && String(recipe.targetProduct?.id || "") !== normalized.productId) return false;
    if (normalized.changeType && String(recipe.changeType?.id || "") !== normalized.changeType) return false;
    if (normalized.videoType && String(recipe.audit?.videoType || "") !== normalized.videoType) return false;
    if (normalized.model && String(recipe.source?.model || "") !== normalized.model) return false;
    if (normalized.taskId && String(recipe.source?.taskId || "") !== normalized.taskId) return false;
    const createdDate = String(recipe.createdAt || "").slice(0, 10);
    if (normalized.dateFrom && createdDate < normalized.dateFrom) return false;
    if (normalized.dateTo && createdDate > normalized.dateTo) return false;
    const haystack = tokens.length ? recipeSearchText(recipe) : "";
    return tokens.every((token) => haystack.includes(token));
  });
  items = items.sort((left, right) => String(right.historyActivityAt || right.createdAt || "").localeCompare(String(left.historyActivityAt || left.createdAt || "")));
  const total = items.length;
  const pages = Math.max(1, Math.ceil(total / normalized.pageSize));
  const page = Math.min(normalized.page, pages);
  return {
    items: items.slice((page - 1) * normalized.pageSize, page * normalized.pageSize).map(clone),
    page,
    pageSize: normalized.pageSize,
    total,
    pages,
    sourceMode: "local-fallback"
  };
}

function collapseHistoryRecipes(recipes = []) {
  const items = Array.from(recipes || []).filter(Boolean).map(clone);
  const sourceById = new Map(items
    .filter((recipe) => recipe.caseStage === "source_ready" && recipe.id)
    .map((recipe) => [String(recipe.id), recipe]));
  const completedBySource = new Map();
  for (const recipe of items) {
    const sourceRecipeId = safeText(recipe.sourceRecipeId, 200);
    if (!sourceRecipeId || recipe.caseStage === "source_ready" || !sourceById.has(sourceRecipeId)) continue;
    if (!completedBySource.has(sourceRecipeId)) completedBySource.set(sourceRecipeId, []);
    completedBySource.get(sourceRecipeId).push(recipe);
  }
  const collapsed = [];
  for (const recipe of items) {
    if (recipe.caseStage === "source_ready") {
      const completed = (completedBySource.get(String(recipe.id)) || [])
        .sort((left, right) => String(right.createdAt || "").localeCompare(String(left.createdAt || "")));
      const latest = completed[0];
      if (!latest) {
        collapsed.push(recipe);
        continue;
      }
      collapsed.push({
        ...recipe,
        caseStage: "completed",
        canonicalCaseStage: "source_ready",
        historyActivityAt: latest.createdAt || recipe.createdAt || "",
        completedAt: latest.createdAt || "",
        completedRecipeId: latest.id,
        completedRecipeIds: completed.map((item) => item.id),
        completionCount: completed.length,
        coverUrl: latest.result?.previewUrl || latest.result?.videoUrl || latest.coverUrl || recipe.coverUrl || "",
        targetProduct: clone(latest.targetProduct || null),
        productMapping: clone(latest.productMapping || null),
        quantityControl: clone(latest.quantityControl || null),
        dataGapReport: clone(latest.dataGapReport || []),
        mappingConfirmedAt: latest.mappingConfirmedAt || "",
        productAssets: clone(latest.productAssets || []),
        replacementAssets: clone(latest.replacementAssets || []),
        firstFrameOverride: clone(latest.firstFrameOverride || null),
        replacementInstructions: clone(latest.replacementInstructions || {}),
        imagePrompts: clone(latest.imagePrompts || []),
        videoPrompt: clone(latest.videoPrompt || {}),
        result: clone(latest.result || {}),
        completedRecipeStorage: clone(latest.storage || {})
      });
      continue;
    }
    const sourceRecipeId = safeText(recipe.sourceRecipeId, 200);
    if (sourceRecipeId && sourceById.has(sourceRecipeId)) continue;
    collapsed.push(recipe);
  }
  return collapsed.sort((left, right) => String(right.historyActivityAt || right.createdAt || "").localeCompare(String(left.historyActivityAt || left.createdAt || "")));
}

function promptCompilerMessages(input = {}) {
  const category = imagePromptCategory(input.changeType, input.sourceAsset);
  const carrierProps = Array.isArray(input.carrierPropAssessments) ? input.carrierPropAssessments : [];
  const carrierLabels = carrierProps.map((item) => item.label || item.kind || "承载道具").join("、");
  const carrierOnly = carrierProps.length > 0 && input.sourceAsset?.productBearing !== true;
  const builtInPrompt = carrierOnly
    ? `源图没有产品像素，只调整${carrierLabels}容纳目标 SKU 所必需的内部容积与开口尺寸；不得向画面植入产品，不执行旧产品清除或产品槽位替换。`
    : category.builtInPrompt;
  const mediaContent = [];
  const inputOrder = [];
  let inputIndex = 1;
  if (input.sourceAsset?.url) {
    mediaContent.push({ type: "image_url", image_url: { url: input.sourceAsset.url } });
    inputOrder.push(`图${inputIndex++}=必须重建的源画面`);
  }
  for (const url of input.productAssetUrls || []) {
    mediaContent.push({ type: "image_url", image_url: { url } });
    inputOrder.push(`图${inputIndex++}=目标产品身份参考`);
  }
  for (const url of input.backgroundAssetUrls || []) {
    mediaContent.push({ type: "image_url", image_url: { url } });
    inputOrder.push(`图${inputIndex++}=目标背景参考`);
  }
  for (const url of input.personAssetUrls || []) {
    mediaContent.push({ type: "image_url", image_url: { url } });
    inputOrder.push(`图${inputIndex++}=目标人物身份参考`);
  }
  mediaContent.push({
    type: "text",
    text: [
      `变更类型：${input.changeType?.label || ""}`,
      `源资产 nodeKey：${input.sourceAsset?.nodeKey || ""}`,
      `源资产标签：${input.sourceAsset?.label || ""}`,
      `源资产尺寸：${input.sourceAsset?.width || 0}x${input.sourceAsset?.height || 0}`,
      input.changeType?.changesProduct ? `目标 SKU：${input.product?.name || input.product?.platformName || ""}` : "本次禁止改变原产品身份、包装、数量和比例。",
      input.changeType?.changesProduct ? `目标产品资料卡：${JSON.stringify(input.product?.productProfile || input.product?.replacementContract || {})}` : "",
      input.changeType?.changesProduct ? carrierOnly
        ? `目标 SKU 容量参照（只用于道具适配，不在无产品源图中新增产品）：${JSON.stringify(geometryContract(input.product))}`
        : geometryContractText(input.sourceProduct, input.product) : "",
      carrierProps.length ? `系统自动判定需与产品联动重建的关联道具：${JSON.stringify(carrierProps)}` : "",
      input.changeType?.changesBackground ? `新背景补充说明：${input.backgroundInstruction || "严格服从目标背景参考图"}` : carrierProps.length
        ? `锁定原背景、空间结构和其他环境道具；仅允许调整${carrierLabels}的必要内部容积与开口尺寸。`
        : "本次禁止改变原背景、空间结构和环境道具。",
      input.changeType?.changesPerson ? `新人物补充说明：${input.personInstruction || "严格服从目标人物身份参考图"}` : "本次禁止改变原人物身份、年龄、性别、发型和服饰。",
      `源视频提示词：${input.sourcePrompt || ""}`,
      `本次生图分类：${category.label}（${category.id}）`,
      `该分类平台内置规则：${builtInPrompt}`,
      `输入顺序：${inputOrder.join("；")}`
    ].filter(Boolean).join("\n")
  });
  return [
    {
      role: "system",
      content: [
        "你是‘一键做同款’参考画布资产提示词编译器。图1始终是必须重建的源画面；只允许修改本次变更白名单内的产品、背景、人物，或平台自动判定需要联动重建的关联承载道具，镜头、构图、动作阶段、景别、姿态、视线、光线逻辑和未授权对象必须保持源图。",
        `本次分类是“${category.label}”（${category.id}）。必须完整落实以下内置规则：${builtInPrompt}`,
        carrierOnly
          ? "目标 SKU 参考图与资料卡只用于判断承载道具需要的真实容积，不得在源图没有产品像素时新增、绘制或露出目标产品。"
          : input.changeType?.changesProduct
            ? "产品身份只来自目标 SKU 参考图与资料卡；先逐个定位旧产品槽位，再按目标 SKU 固定长宽高比例重建；只继承位置、承托、遮挡和整体占用区域，不继承旧产品轮廓、单体比例或数量。必须重算真实物理尺寸、数量、间距、遮挡和接触关系，禁止旧包装残留。"
            : "锁定源图中的原产品，禁止改包装、文字、数量、尺寸或位置。",
        input.changeType?.changesBackground
          ? "背景只来自目标背景参考图与补充说明；重建空间、墙地面和环境道具时保持人物/产品的机位、动作、尺度与接触关系，重新匹配真实光影。"
          : carrierProps.length
            ? `锁定原背景、空间结构、墙地面、光线氛围和除${carrierLabels}以外的全部环境道具；${carrierLabels}与产品在同一次生图中联合重构，保持原类别、品牌、材质、颜色、位置、外观风格和持物动作，只调整容纳目标 SKU 所必需的宽高、内部容积、开口、提手和真实接触关系。源提示词中要求保留这些道具的文字不再锁定其原始尺寸；禁止缩放或压扁目标产品来迁就道具。源图未出现产品时不得凭空加入产品。`
            : "锁定原背景、空间结构、墙地面、环境道具和光线氛围。",
        input.changeType?.changesPerson
          ? "人物身份只来自目标人物参考图；替换人物身份时保持原动作、姿态、手部与产品接触、机位和构图，禁止混脸、多人融合和残留旧脸。"
          : "锁定源图人物身份、年龄、性别、五官、发型、服饰、动作和手部结构。",
        `必须按用户提供的输入顺序逐图引用：${inputOrder.join("；")}。`,
        "禁止乱码文字、变形 logo、悬浮、穿模、错误接触阴影、额外产品、额外人物和未经授权的场景变化。",
        "只返回 JSON：imagePrompt、negativePrompt、scalePlan、layoutLocks、inputOrder、validationChecklist。"
      ].filter(Boolean).join("\n")
    },
    { role: "user", content: mediaContent }
  ];
}

function actionResolutionMessages(input = {}) {
  const content = [];
  const sourceImageUrl = safeText(input.sourceAsset?.url, 12000);
  const targetImageUrl = safeText(input.targetAsset?.storageUrl || input.targetAsset?.thumbnailUrl, 12000);
  if (/^https?:\/\//i.test(sourceImageUrl)) {
    content.push({ type: "image_url", image_url: { url: sourceImageUrl } });
    content.push({ type: "text", text: "上图为当前源节点画面，用于核对实际参与持物的手、接触位置、产品朝向和其他必须保留的道具。" });
  }
  if (/^https?:\/\//i.test(targetImageUrl)) {
    content.push({ type: "image_url", image_url: { url: targetImageUrl } });
    content.push({ type: "text", text: "上图为用户已选择的目标 OSS 产品身份图，用于核对目标包装结构与主展示面。" });
  }
  content.push({
    type: "text",
    text: [
      `源产品：${JSON.stringify(input.sourceProduct || {})}`,
      `源资产识别：${JSON.stringify(input.sourceAsset || {})}`,
      `目标产品：${JSON.stringify(input.targetProduct || {})}`,
      `目标展示形态：${JSON.stringify(input.targetState || {})}`,
      `已选择 OSS 产品图：${JSON.stringify(input.targetAsset || {})}`,
      `检测到的冲突：${JSON.stringify(input.risk || {})}`,
      `规则兜底草稿：${safeText(input.fallbackDraft, 3000)}`,
      `原视频节点提示词（只用于锁定原动作、道具、镜头、对白和节奏）：\n${safeText(input.sourcePrompt, 20000)}`
    ].join("\n\n")
  });
  return [
    {
      role: "system",
      content: [
        "你是一键做同款的产品动作冲突改写器。请根据源产品识别、目标 SKU 资料、用户已选 OSS 身份图、冲突检测结果和原视频节点提示词，写出一段可直接执行的中文动作改写方案。",
        "只允许改变产品相关的持法、接触方式、朝向和产品专属操作；人物身份、未参与持物的手、其他道具、表情、视线、对白、镜头、构图、背景、剧情顺序和节奏必须保持不变。",
        "必须明确新产品由哪只原本参与持物的手以什么方式接触、主展示面如何朝向镜头，并明确删除旧包装结构和不再适用的动作。不得凭空指定左右手；源信息不明确时写‘沿用原画面实际参与持物的手’。",
        "方案必须服从目标形态的真实尺寸、结构、允许动作、禁止动作和不变量；禁止拉伸、压扁、折叠硬质包装、遮挡品牌文字、悬浮、穿模或残留旧产品。",
        "不要解释判断过程，不要写平台内部术语，不要改写整段视频提示词。只返回 JSON：actionResolution、detectedConflicts、preservedElements。"
      ].join("\n")
    },
    { role: "user", content }
  ];
}

function validActionResolutionDraft(value, input = {}) {
  const draft = safeText(value, 3000);
  if (draft.length < 30) return false;
  const profile = profileFromProduct(input.targetProduct || {}) || {};
  const identityTokens = [
    input.targetProduct?.name,
    input.targetProduct?.platformName,
    profile.platformName,
    profile.shortName,
    input.targetAsset?.title
  ].map((item) => safeText(item, 300)).filter((item) => item.length >= 2);
  const namesTarget = !identityTokens.length || identityTokens.some((item) => draft.includes(item));
  return namesTarget && /手|夹|握|托|持|展示|接触|朝向|打开|使用/.test(draft) && /保持|不变|保留|锁定/.test(draft);
}

function videoPromptCompilerMessages(input = {}) {
  const references = (input.replacementReferences || []).map((item) => (
    `${item.role === "background" ? "目标背景" : "目标人物"}参考：{{Node ${item.logicalNodeKey}}}（${item.label || item.logicalNodeKey}）`
  ));
  return [
    {
      role: "system",
      content: [
        "你是 libtv-reference-canvas-replication 工作流的视频提示词最小改写编译器。请输出一段可以直接提交给目标 SKU 视频节点的完整 variant_prompt，不是补充说明，也不是第二轮润色。",
        "源提示词只读保留供用户核对；variant_prompt 必须继承源镜头、构图、动作、节奏、人物、背景、台词顺序和全部 Node 引用，只改写变更白名单内的事实。",
        "仅替换变更白名单内的产品、口播、背景和/或人物；未在白名单中的产品身份、人物、背景、动作和台词必须原样锁定。",
        input.changeType?.changesProduct ? "只把源提示词中的旧产品身份和相关产品描述最小替换为目标 SKU；不得增加资产重构步骤、几何硬锁、数量规划、OSS 资产 ID、形态映射说明或平台内部校验模板。上游图已经完成产品替换，视频提示词只描述原有镜头与动作中的目标产品。" : "本次禁止改变原产品。",
        input.changeType?.changesBackground ? "新背景必须引用提供的目标背景 Node，保持主体运动轨迹、景别与构图。" : "本次禁止改变原背景。",
        input.changeType?.changesPerson ? "新人物必须引用提供的目标人物 Node，保持原动作、姿态、表情节奏和手部接触关系。" : "本次禁止改变原人物身份。",
        "如提供新口播，必须逐字保留全部汉字、字母、数字、重复、说话人和先后顺序，不得润色、删减或增加台词。",
        "保留所有源 {{Node ...}} 引用，并逐字使用用户给出的新增参考 {{Node ...}} 占位符；后台稍后统一映射为新画布 nodeKey。",
        "prompt 必须是完整最终提示词，能够不拼接源提示词而直接送入 LibTV 视频节点。sourceProductMentions 必须列出输出中仍残留的旧产品词，正常应为空数组。",
        "只返回 JSON：prompt、replacements、warnings、sourceProductMentions。"
      ].filter(Boolean).join("\n")
    },
    {
      role: "user",
      content: [
        `变更类型：${input.changeType?.label || ""}`,
        input.changeType?.changesProduct ? `目标产品身份：${input.product?.name || input.product?.platformName || input.product?.id || "目标 SKU"}` : "本次沿用原产品。",
        input.voiceover
          ? `兼容旧任务的新口播（逐字锁定）：${input.voiceover}`
          : input.changeType?.changesVoiceover
            ? "新口播已由用户直接写入下方完整视频提示词底稿；必须服从底稿，不另行润色、删减或增加台词。"
            : "本次不更换口播。",
        input.changeType?.changesBackground ? `新背景说明：${input.backgroundInstruction || "严格服从目标背景参考图"}` : "",
        input.changeType?.changesPerson ? `新人物说明：${input.personInstruction || "严格服从目标人物身份参考图"}` : "",
        references.length ? `新增参考节点（必须写入提示词）：\n${references.join("\n")}` : "",
        `只读源视频原始提示词（据此最小改写为完整 variant_prompt）：\n${input.sourcePrompt || ""}`
      ].filter(Boolean).join("\n\n")
    }
  ];
}

function videoQualityMessages(input = {}) {
  const mediaContent = [];
  if (input.videoUrl) mediaContent.push({ type: "video_url", video_url: { url: input.videoUrl } });
  for (const url of input.productAssetUrls || []) mediaContent.push({ type: "image_url", image_url: { url } });
  mediaContent.push({
    type: "text",
    text: [
      `目标 SKU：${input.productName || ""}`,
      `变更类型：${input.changeType?.label || ""}`,
      `提交提示词：${input.prompt || ""}`,
      "产品数量与布局以已确认的逐节点上游资产为准；视频阶段不得重新规划数量。",
      `当前是第 ${Math.max(1, Number(input.round || 1))} 轮成片。`,
      "请按整段视频检查，不要只看首帧。"
    ].join("\n")
  });
  return [
    {
      role: "system",
      content: [
        "你是一键做同款成片质量验收器。第一个视频是待验收成片，后续图片是目标 SKU 身份真值参考。",
        "必须分别检查：1）产品替换洁净度（无旧产品、旧包装、旧文字、混合身份）；2）产品身份准确度（SKU、Logo、标签、结构、固定几何比例）；3）场景适配度（尺度、光影、边缘、遮挡、承托、接触）；4）时序稳定度（整段不变形、不闪烁、不漂移）；5）提示词与未授权对象锁定。产品实例和布局只核对是否忠实延续已确认的逐节点上游资产，禁止在视频阶段重新计算目标数量。",
        "每项 0-100 分。任一产品相关维度低于 75 分或总分低于 80 分必须判定不及格。correctionPrompt 要写成可直接追加到第二轮视频提示词的具体修复指令，不得改变原剧情、镜头、动作和未授权对象。",
        "只返回 JSON：pass、score、dimensions（cleanliness、identityAccuracy、sceneFit、temporalStability、promptCompliance）、issues、correctionPrompt、summary。"
      ].join("\n")
    },
    { role: "user", content: mediaContent }
  ];
}

function normalizeVideoQuality(value = {}, model = "") {
  const result = value && typeof value === "object" ? value : {};
  const dimensions = {};
  for (const key of ["cleanliness", "identityAccuracy", "sceneFit", "temporalStability", "promptCompliance"]) {
    dimensions[key] = Math.max(0, Math.min(100, Number(result.dimensions?.[key] ?? 0)));
  }
  const score = Math.max(0, Math.min(100, Number(result.score ?? 0)));
  const productFloor = Math.min(dimensions.cleanliness, dimensions.identityAccuracy, dimensions.sceneFit);
  const pass = result.pass === true && score >= 80 && productFloor >= 75;
  return {
    status: "completed",
    pass,
    score,
    dimensions,
    issues: Array.isArray(result.issues) ? result.issues.map((item) => safeText(item, 500)).filter(Boolean).slice(0, 12) : [],
    correctionPrompt: safeText(result.correctionPrompt, 6000),
    summary: safeText(result.summary, 2000),
    model: safeText(model, 160),
    checkedAt: isoNow()
  };
}

function applyEditableVideoPrompts(job, submittedPrompts = {}) {
  const prompts = submittedPrompts && typeof submittedPrompts === "object" ? submittedPrompts : {};
  for (const target of job.targets || []) {
    const hasSubmittedPrompt = Object.prototype.hasOwnProperty.call(prompts, target.id);
    let prompt = safeText(hasSubmittedPrompt ? prompts[target.id] : target.videoPrompt?.compiled, 50000);
    if (!prompt) throw new Error(`${target.productName} 缺少视频生成提示词`);
    prompt = replaceLegacyMappingProductAliases(prompt, target);
    const staleMentions = sourceProductMentions(prompt, target.sourceProduct || {}, {
      id: target.productId,
      name: target.productName,
      productProfile: target.productProfile
    });
    if (staleMentions.length) throw new Error(`${target.productName} 的最终提示词仍残留源产品：${staleMentions.join("、")}`);
    for (const reference of target.replacementAssets || []) {
      const placeholder = `{{Node ${reference.logicalNodeKey}}}`;
      if (!prompt.includes(placeholder)) {
        const label = reference.role === "background" ? "目标背景参考" : "目标人物参考";
        throw new Error(`${target.productName} 的视频生成提示词不能删除${label}节点 ${placeholder}`);
      }
    }
    if (target.firstFrameOverride?.replacesSourceNodeKey) {
      const placeholder = `{{Node ${target.firstFrameOverride.replacesSourceNodeKey}}}`;
      if (!prompt.includes(placeholder)) {
        throw new Error(`${target.productName} 的视频生成提示词不能删除用户上传首帧节点 ${placeholder}`);
      }
    }
    if (target.voiceover) {
      const compactPrompt = prompt.replace(/\s+/g, "");
      const compactVoiceover = String(target.voiceover).replace(/\s+/g, "");
      if (!compactPrompt.includes(compactVoiceover)) {
        throw new Error(`${target.productName} 的视频生成提示词必须逐字保留新口播`);
      }
    }
    prompt = applyCarrierVideoActionInstruction(prompt, target);
    const leakedInstruction = videoPromptAssetInstructionLeaks(prompt)[0];
    if (leakedInstruction) throw new Error(`${target.productName} 的最终视频提示词混入上游资产重构指令：${leakedInstruction}`);
    const baseline = target.videoPrompt?.compiledBaseline || target.videoPrompt?.compiled || "";
    target.videoPrompt ||= {};
    target.videoPrompt.variantPrompt = prompt;
    target.videoPrompt.compiled = prompt;
    target.videoPrompt.userEdited = prompt !== baseline;
    if (hasSubmittedPrompt) target.videoPrompt.userEditedAt = isoNow();
  }
}

function auditMessages(input = {}) {
  const content = [];
  for (const asset of input.assets || []) {
    if (asset.mediaType !== "image" || !asset.url) continue;
    content.push({ type: "image_url", image_url: { url: asset.url } });
    content.push({ type: "text", text: `紧邻图片的 nodeKey=${asset.nodeKey}，标签=${asset.label}` });
  }
  content.push({
    type: "text",
    text: [
      `用户选择的复刻类型：${input.changeType?.label || ""}`,
      `原片产品线索：${JSON.stringify(input.sourceProduct || null)}`,
      `平台产品目录：${JSON.stringify(input.productCatalog || [])}`,
      `视频提示词：${input.prompt || ""}`,
      `生成参数：${JSON.stringify(input.params || {})}`,
      `当前唯一待审计资产：${JSON.stringify((input.assets || []).map((item) => ({ nodeKey: item.nodeKey, type: item.mediaType, label: item.label, width: item.width, height: item.height })))}`
    ].join("\n")
  });
  return [
    {
      role: "system",
      content: [
        "你是参考画布拆解审计器。判断视频属于仅换产品、仅换口播、产品+口播、仅换背景、换人物、背景+产品或其他；逐项判断上游图片是否真实承载旧产品、可替换背景或人物身份。",
        "productBearing 是严格的像素级概念，不是剧情语义或动作关联。只有图片中实际可见并能定位到与原片 SKU 一致的包装、容器、膜布、单片/单支或内容物像素时，才允许标记 productBearing=true。",
        "人物身体、皮肤状态、腹部皱纹、手、衣服、裤子、腰带、沙发、背景和动作本身都不是护肤产品；即使视频提示词描述产品随后会作用于该部位，也必须标记 productBearing=false。不得把红裤子、服装或身体状态称为旧产品。",
        "参考帧、首帧或尾帧仅用于锁定人物、服装、身体状态、动作阶段或构图，且画面中没有原片产品像素时：role 保持 reference_frame/start_frame/end_frame，productBearing=false，productIdentityMatchesSource=false，productPixelEvidence=[]；平台将原样复用，不调用生图。",
        "productBearing=true 时必须同时返回 productIdentityMatchesSource=true，并在 productPixelEvidence 中逐条说明可见产品对象、所在区域及身份依据（如包装文字、Logo、容器结构、膜布纹理）。没有这两项硬证据时必须判 false。",
        "不能只看文件名，必须以画面证据为准。能看见可替换环境才标记 backgroundBearing=true；能看见人物身份才标记 personBearing=true。",
        "如果图片是独立产品白底图、包装正背面或不含场景与人物的产品资料图，role 必须返回 product_asset；它将由平台直接匹配目标 SKU 的 OSS 原始产品图，禁止重新生图。",
        "另行识别产品关联承载道具 carrierProps：包括在动作中实际用于装入、取出、盛放、搬运产品的购物袋、箱子、篮子、托盘、抽屉、收纳盒，也包括与产品同时展示、具有品牌标识或明显承担产品运输、收纳、陈列作用的配套道具；即使产品由另一只手展示，也不能漏掉同画面的品牌购物袋。不得把普通桌椅和背景装饰列入。每项返回 id、kind、label、relation、requiredForProductAction、productRelated、brandLinked、associationType、associationConfidence、relatedProductState、capacityComparedToSourceProduct、capacityScaleToSourceProduct、capacityConfidence、evidence。associationType 使用 active_carrier、brand_companion、product_companion 或 display_support；relation 可使用 contains_product、product_removed_from、product_inserted_into、carries_product、brand_companion、product_companion、display_support、product_transport 或 product_storage。capacityScaleToSourceProduct 表示可用内部空间相对源产品包络的保守估计；只有证据充分时才返回数值，否则为 null，禁止编造厘米尺寸。",
        "对每张 productBearing 图片识别产品层级 productState（retail_outer_box、primary_container、single_unit、content、open_state、usage_state、product_combination）、shape、view（front、back、side、top、unknown）、status（closed、open、usage）和画面动作 actions，并标记 sceneBearing 与 handContact。",
        "只在画面证据足够时返回 productCount（可见产品整数数量）、countConfidence、orientation（vertical/horizontal/mixed）、layoutType（flat/compact_staggered/stacked/unknown）、cameraElevationDeg、cameraYawDeg 和 averageVisibleRatio；无法准确点数时 productCount 必须为 null，禁止猜测。",
        "每项必须返回 confidence（0 到 1）与 evidence，说明判断来自哪些画面证据；不确定时降低置信度，绝不编造尺寸、材质、动作能力或 OSS 资产。",
        "如能可靠定位产品实例，productInstances 返回逐实例 bbox（归一化 x、y、width、height）、contactPoint、occlusionOrder、visibleRatio 与 confidence；无法可靠定位时返回空数组，禁止猜测。",
        "本次请求只审计一张图片，不得参考、猜测或概括其他上游图片。",
        "只返回 JSON：assets。assets 必须只有一项，包含当前图片的 nodeKey、role、productBearing、productIdentityMatchesSource、productPixelEvidence、productInstances、carrierProps、backgroundBearing、personBearing、sceneBearing、handContact、reason、productState、shape、view、status、actions、productCount、countConfidence、orientation、layoutType、cameraElevationDeg、cameraYawDeg、averageVisibleRatio、confidence、evidence；不需要返回 videoType 或 summary。"
      ].join("\n")
    },
    { role: "user", content }
  ];
}

function carrierAssessmentsForNode(target = {}, sourceNodeKey = "") {
  return (target.mappingPlan?.carrierPropAssessments || []).filter((item) => item.sourceNodeKey === sourceNodeKey);
}

function carrierRegenerationRequired(assessments = []) {
  const rows = Array.isArray(assessments) ? assessments : assessments ? [assessments] : [];
  return rows.some((item) => item.decision === "regenerate_with_product");
}

function mappingRequiresAssetPreparation(sourceAsset = {}, mapping = null, carrierAssessments = []) {
  if (sourceAsset.mediaType === "text") return false;
  if (carrierRegenerationRequired(carrierAssessments)) return true;
  return sourceAsset.rebuildRequired === true && mapping?.processingMode !== "reuse_source";
}

function buildUpstreamAssetManifest(job = {}, target = {}) {
  const mappings = target.mappingPlan?.mappings || [];
  const groups = target.assetGroups || [];
  const uploadedFirstFrameNodeKey = target.firstFrameOverride?.sourceMode === "user_uploaded_first_frame"
    ? safeText(target.firstFrameOverride.replacesSourceNodeKey, 240)
    : "";
  const rows = (job.audit?.assets || []).map((asset, index) => {
    const assetType = upstreamNodeType(asset.mediaType, "image");
    const mapping = mappings.find((item) => item.sourceNodeKey === asset.nodeKey) || null;
    const group = groups.find((item) => item.sourceNodeKey === asset.nodeKey) || null;
    const carrierAssessments = carrierAssessmentsForNode(target, asset.nodeKey);
    const carrierRebuild = carrierRegenerationRequired(carrierAssessments);
    const textTransform = textTransformForAsset(target, asset.nodeKey);
    const directFirstFrame = assetType === "image" && asset.nodeKey === uploadedFirstFrameNodeKey;
    const reuseUnderFirstFramePolicy = assetType === "image" && Boolean(uploadedFirstFrameNodeKey) && !directFirstFrame;
    let route = "reuse_source";
    if (!SUPPORTED_UPSTREAM_TYPES.has(assetType)) route = "unsupported";
    else if (assetType === "text") route = textTransform?.status === "conflict"
      ? "text_conflict"
      : textTransform?.rewritten ? "text_rewrite" : "text_reuse";
    else if (directFirstFrame && group?.sourceMode === "uploaded_first_frame") route = "uploaded_first_frame";
    else if (reuseUnderFirstFramePolicy) route = "reuse_source";
    else if (carrierRebuild || group && !isDirectAssetGroup(group)) route = "generated_candidate";
    else if (group?.sourceMode === "oss_direct" || mapping?.processingMode === "oss_direct") route = "oss_direct";
    else if (mapping?.processingMode === "generate_candidate") route = "generated_candidate";
    const errors = [];
    if (!SUPPORTED_UPSTREAM_TYPES.has(assetType)) errors.push(`当前版本不能安全重建 ${assetType || "unknown"} 类型节点，已阻止静默丢失`);
    if (assetType === "text" && !textTransform) errors.push("缺少目标 SKU 文本改写记录");
    for (const conflict of textTransform?.conflicts || []) errors.push(conflict.message || conflict.type || "文本节点存在未解决冲突");
    if (assetType !== "text" && !reuseUnderFirstFramePolicy && ((asset.rebuildRequired && mapping?.processingMode !== "reuse_source") || carrierRebuild) && !group) errors.push("缺少应重构节点的资产组");
    if (asset.auditConflict && route === "reuse_source") errors.push("审计字段冲突节点不得源图直通");
    if (group && !isDirectAssetGroup(group) && (group.generationRounds?.[0]?.candidateIds?.length || group.candidates?.filter((item) => Number(item.round || 1) === 1).length) !== 2) {
      errors.push("首轮必须生成并回传 2 张候选图");
    }
    return {
      order: index + 1,
      sourceNodeKey: asset.nodeKey,
      sourceLabel: asset.label,
      role: asset.role,
      mediaType: assetType,
      rebuildRequired: reuseUnderFirstFramePolicy ? false : asset.rebuildRequired === true || carrierRebuild,
      carrierPropDecision: carrierAssessments.find((item) => item.decision === "regenerate_with_product")?.decision || carrierAssessments[0]?.decision || "",
      auditConflict: clone(asset.auditConflict || null),
      textTransform: clone(textTransform || null),
      route,
      mappingTargetAssetId: mapping?.targetAssetId || "",
      geometryStatus: group?.geometryPreparation?.status || "not_applicable",
      generationRounds: clone(group?.generationRounds || []),
      candidateCount: group?.candidates?.length || 0,
      selectedCandidateId: target.selectedAssets?.[asset.nodeKey] || "",
      errors
    };
  });
  return {
    schemaVersion: "one-click-remake-upstream-manifest-v2",
    policy: "source_node_by_source_node",
    quantityPolicy: "inherit_source_observation",
    rows,
    errors: rows.flatMap((row) => row.errors.map((error) => `${row.sourceLabel || row.sourceNodeKey}：${error}`))
  };
}

function validateUpstreamAssetManifest(job = {}, target = {}) {
  const manifest = buildUpstreamAssetManifest(job, target);
  if (manifest.errors.length) throw new Error(`上游资产预检失败：${manifest.errors.join("；")}`);
  return manifest;
}

function productPixelEvidence(value = {}) {
  const rows = Array.isArray(value.productPixelEvidence)
    ? value.productPixelEvidence
    : Array.isArray(value.visibleProductObjects) ? value.visibleProductObjects : [];
  return rows.map((item) => safeText(typeof item === "string" ? item : item?.evidence || item?.description, 500)).filter(Boolean).slice(0, 12);
}

function normalizeCarrierProps(value = {}) {
  const rows = Array.isArray(value.carrierProps) ? value.carrierProps : [];
  return rows.map((item, index) => {
    const relation = safeText(item?.relation, 80).toLowerCase() || "unknown";
    const requiredForProductAction = item?.requiredForProductAction === true
      || ["contains_product", "product_removed_from", "product_inserted_into", "carries_product"].includes(relation);
    const associationType = safeText(item?.associationType || item?.visualRole, 80).toLowerCase();
    const productRelated = requiredForProductAction
      || item?.productRelated === true
      || item?.brandLinked === true
      || ["brand_companion", "product_companion", "display_support", "product_transport", "product_storage"].includes(relation)
      || ["active_carrier", "brand_companion", "product_companion", "display_support"].includes(associationType);
    const scale = Number(item?.capacityScaleToSourceProduct);
    return {
      id: safeText(item?.id, 120) || `carrier-${index + 1}`,
      kind: safeText(item?.kind || item?.type, 80) || "other",
      label: safeText(item?.label, 200) || "承载道具",
      relation,
      requiredForProductAction,
      productRelated,
      brandLinked: item?.brandLinked === true,
      associationType: associationType || (requiredForProductAction ? "active_carrier" : "product_companion"),
      associationConfidence: Math.max(0, Math.min(1, Number(item?.associationConfidence ?? item?.confidence ?? item?.capacityConfidence ?? 0))),
      relatedProductState: safeText(item?.relatedProductState || item?.productState, 100),
      capacityComparedToSourceProduct: safeText(item?.capacityComparedToSourceProduct, 40).toLowerCase() || "unknown",
      capacityScaleToSourceProduct: Number.isFinite(scale) && scale >= 0.2 && scale <= 10 ? scale : null,
      capacityConfidence: Math.max(0, Math.min(1, Number(item?.capacityConfidence ?? item?.confidence ?? 0))),
      evidence: safeText(item?.evidence, 1200)
    };
  }).filter((item) => item.productRelated).slice(0, 12);
}

function carrierVideoActionInstruction(target = {}) {
  const rows = (target.mappingPlan?.carrierPropAssessments || []).filter((item) => item.decision === "keep_and_rewrite");
  if (!rows.length) return "";
  return [
    "【承载道具动作适配】",
    ...rows.map((item) => `${item.label || "承载道具"}保持源画面的类别、尺寸、位置和外观不变；目标 SKU 不得被塞入、装入或从该道具中取出，相关动作改为目标产品已在人物手中，或由画外自然递入后直接展示。`),
    "除上述装取动作外，人物身份、镜头、构图、对白、节奏和其他道具保持不变。"
  ].join("\n");
}

function applyCarrierVideoActionInstruction(prompt = "", target = {}) {
  const instruction = carrierVideoActionInstruction(target);
  if (!instruction) return String(prompt || "").trim();
  const baseline = String(prompt || "").split("【承载道具动作适配】")[0].trim();
  return `${baseline}\n\n${instruction}`.trim();
}

function videoPromptAssetInstructionLeaks(prompt = "") {
  const text = String(prompt || "");
  return ["【平台产品几何硬锁】", "【平台已确认的产品形态映射", "【替换数量控制模板", "OSS 资产 image-"]
    .filter((marker) => text.includes(marker));
}

function stripVideoPromptAssetInstructions(prompt = "") {
  return String(prompt || "")
    .split(/(?=【[^】]+】)/g)
    .filter((section) => !videoPromptAssetInstructionLeaks(section.trimStart()).length)
    .join("")
    .trim();
}

function sourceProductPixelClaims(value = {}) {
  const text = [
    value.reason,
    value.evidence,
    value.summary,
    ...(Array.isArray(value.productPixelEvidence) ? value.productPixelEvidence : [])
  ].map((item) => safeText(typeof item === "string" ? item : item?.evidence || item?.description, 2000)).filter(Boolean).join("。 ");
  if (!text) return [];
  const productPattern = /(?:旧产品|旧版产品|旧包装|原片产品|源产品|原产品)/;
  const visiblePattern = /(?:像素|可见|看见|出现|存在|包含|含有|手持|拿着|举着|托着|袋内|装着|摆放|陈列|包装|瓶|罐|盒|单支|膜布)/;
  const negativePattern = /(?:不含|没有|未见|无任何|不存在|未出现|不可见|无法定位|并非|不是).{0,14}(?:旧产品|旧版产品|旧包装|原片产品|源产品|原产品)/;
  return text.split(/[。；;\n]+/)
    .map((item) => item.trim())
    .filter((item) => item && productPattern.test(item) && visiblePattern.test(item) && !negativePattern.test(item))
    .slice(0, 12);
}

function resolveProductBearing(input = {}) {
  const evidence = input.evidence || {};
  const textualPixelClaims = sourceProductPixelClaims(evidence);
  const explicitPixelEvidence = productPixelEvidence(evidence);
  const pixelEvidence = [...new Set([...explicitPixelEvidence, ...textualPixelClaims])].slice(0, 12);
  const independentProductReference = input.independentProductReference === true;
  const auditConflict = textualPixelClaims.length > 0
    && !(evidence.productBearing === true && evidence.productIdentityMatchesSource === true && explicitPixelEvidence.length > 0);
  const productIdentityMatchesSource = independentProductReference || evidence.productIdentityMatchesSource === true || textualPixelClaims.length > 0;
  const productBearing = input.isImage === true && (independentProductReference
    || modelConfirmedProductPixels(evidence)
    || textualPixelClaims.length > 0
    || (input.auditUnavailable === true && input.needsProductChange === true));
  return { productBearing, productIdentityMatchesSource, pixelEvidence, textualPixelClaims, auditConflict };
}

function productPresenceReviewSignals(input = {}) {
  const evidence = input.evidence || {};
  const nodeContext = safeText(input.nodeContext, 4000);
  const text = [
    evidence.reason,
    evidence.evidence,
    evidence.summary,
    nodeContext
  ].map((item) => safeText(item, 2000)).filter(Boolean).join("。 ");
  if (!text) return [];
  const signals = [];
  const mentionsProductObject = /(?:产品|商品|包装|瓶|罐|盒|袋装|膜布|面膜|喷雾|精华|次抛)/i.test(text);
  const mentionsProductAction = /(?:拿出|取出|掏出|抽出|举起|展示|手持|拿着|握住|托着|递出|从.{0,12}(?:袋|盒|箱|包).{0,6}(?:拿|取|抽|掏))/i.test(text);
  const deniesVisibility = /(?:不含|没有|未见|不存在|未出现|不可见|无法定位|空手|未持物|遮挡)/i.test(text);
  if (mentionsProductObject && mentionsProductAction) signals.push("文字或动作描述提示画面可能正在拿取、手持或展示产品");
  if (mentionsProductObject && deniesVisibility) signals.push("识别依据同时提到产品物体与不可见结论，需要单图复核");
  if (evidence.handContact === true) signals.push("模型标记了手部接触，但没有确认产品像素");
  if (Number(evidence.confidence) > 0 && Number(evidence.confidence) < 0.75 && mentionsProductObject) signals.push("产品存在性置信度较低");
  return [...new Set(signals)];
}

function productPresenceReviewMessages(input = {}) {
  const asset = input.asset || {};
  const content = [];
  if (asset.url) content.push({ type: "image_url", image_url: { url: asset.url, detail: "high" } });
  content.push({
    type: "text",
    text: [
      `只复核这一张源图：nodeKey=${asset.nodeKey || ""}，标签=${asset.label || ""}，原始尺寸=${asset.width || "未知"}x${asset.height || "未知"}。`,
      "请放大检查画面各区域，尤其是人物双手、手部遮挡边缘、购物袋/盒/箱开口和画面边缘的小物体。",
      `原片产品线索：${JSON.stringify(input.sourceProduct || null)}`,
      `该节点附近的原始提示词：${safeText(input.nodeContext || input.prompt, 6000)}`,
      `触发复核的原因：${(input.signals || []).join("；") || "产品存在性不确定"}`
    ].join("\n")
  });
  for (const reference of (input.referenceUrls || []).slice(0, 3)) {
    content.push({ type: "image_url", image_url: { url: reference, detail: "high" } });
    content.push({ type: "text", text: "紧邻图片是原片产品身份参考，只用于判断源图中的小物体是否属于同一产品。" });
  }
  return [
    {
      role: "system",
      content: [
        "你是单张关键帧产品存在性复核器，只判断画面像素中是否真实出现与原片产品一致的产品对象。",
        "必须认真检查小面积、局部遮挡、被手握住、位于袋口或画面边缘的瓶、罐、盒、膜布和单支产品，不能因为包装文字不清晰就直接判为空手。",
        "人物、服装、皮肤和购物袋本身不是产品；不能仅凭剧情或提示词宣称有产品。",
        "productBearing=true 时必须给出 productIdentityMatchesSource=true、非空 productPixelEvidence，并尽量返回归一化 bbox；证据不足则返回 false，并在 uncertainty 说明。",
        "只返回 JSON：productBearing、productIdentityMatchesSource、productPixelEvidence、productInstances、productState、shape、view、status、actions、productCount、confidence、reason、uncertainty。"
      ].join("\n")
    },
    { role: "user", content }
  ];
}

function nodePromptContext(prompt = "", nodeKey = "") {
  const text = String(prompt || "");
  const key = String(nodeKey || "");
  if (!key) return safeText(text, 2400);
  const index = text.indexOf(key);
  if (index < 0) return safeText(text, 2400);
  return text.slice(Math.max(0, index - 900), Math.min(text.length, index + key.length + 1500));
}

function applyProductPresenceDecision(asset = {}, decision = "reuse", options = {}) {
  const productBearing = decision === "replace";
  const human = options.source === "human";
  const evidence = options.evidence || {};
  const automaticDecision = asset.productPresenceReview?.automaticDecision
    || (asset.productBearing === true ? "replace" : "reuse");
  let rebuildRoles = (asset.rebuildRoles || []).filter((role) => role !== "产品");
  if (productBearing) rebuildRoles = ["产品", ...rebuildRoles];
  rebuildRoles = [...new Set(rebuildRoles.filter(Boolean))];
  const productFacts = productBearing ? {
    ...(asset.productFacts || {}),
    layer: safeText(evidence.productState || evidence.layer || asset.productFacts?.layer, 100),
    shape: safeText(evidence.shape || asset.productFacts?.shape, 240),
    view: safeText(evidence.view || asset.productFacts?.view, 80) || "unknown",
    status: safeText(evidence.status || asset.productFacts?.status, 80) || "closed",
    actions: Array.isArray(evidence.actions) ? evidence.actions.map((item) => safeText(item, 100)).filter(Boolean) : clone(asset.productFacts?.actions || []),
    productCount: Number.isInteger(Number(evidence.productCount)) && Number(evidence.productCount) > 0
      ? Number(evidence.productCount)
      : (asset.productFacts?.productCount || null),
    instances: Array.isArray(evidence.productInstances) ? clone(evidence.productInstances).slice(0, 100) : clone(asset.productFacts?.instances || []),
    confidence: human ? 1 : Math.max(0, Math.min(1, Number(evidence.confidence ?? asset.productFacts?.confidence ?? 0.6))),
    evidence: human
      ? "人工查看源图后确认画面含原产品，需要执行换品。"
      : safeText(evidence.reason || evidence.evidence || asset.productFacts?.evidence, 2000) || "单图二次识别确认画面含原产品"
  } : null;
  const candidate = {
    ...asset,
    productBearing,
    productIdentityMatchesSource: productBearing,
    productPixelEvidence: productBearing
      ? (productPixelEvidence(evidence).length ? productPixelEvidence(evidence) : [human ? "人工确认源图中存在原产品像素" : "单图二次识别确认源图中存在原产品像素"])
      : [],
    auditConflict: human ? null : asset.auditConflict,
    rebuildRoles,
    rebuildRequired: rebuildRoles.length > 0,
    productFacts,
    reason: human
      ? (productBearing
        ? "人工确认该图含原产品；换品任务将生成候选图，避免旧产品残留。"
        : `人工确认该图不含原产品；${rebuildRoles.length ? `仍按${rebuildRoles.join("、")}变更生成候选图。` : "直接复用源图，不调用生图。"}`)
      : (safeText(evidence.reason, 1200) || asset.reason),
    productPresenceReview: {
      ...(asset.productPresenceReview || {}),
      automaticDecision,
      decision: productBearing ? "replace" : "reuse",
      decisionSource: human ? "human" : "secondary_model",
      needsHumanReview: human ? false : Boolean(options.needsHumanReview),
      signals: clone(options.signals || asset.productPresenceReview?.signals || []),
      secondaryModel: safeText(options.model || asset.productPresenceReview?.secondaryModel, 160),
      secondaryReason: safeText(evidence.reason || asset.productPresenceReview?.secondaryReason, 1200),
      humanDecision: human ? (productBearing ? "replace" : "reuse") : safeText(asset.productPresenceReview?.humanDecision, 20),
      reviewedAt: isoNow()
    }
  };
  const directProductReference = productBearing && rebuildRoles.length === 1
    && rebuildRoles[0] === "产品" && isDirectProductReferenceAsset(candidate);
  return {
    ...candidate,
    generationRequired: candidate.rebuildRequired && !directProductReference,
    replacementStrategy: directProductReference
      ? "direct_oss_product_asset"
      : candidate.rebuildRequired ? "generate_candidate" : "reuse_source"
  };
}

function modelConfirmedProductPixels(value = {}) {
  return value.productBearing === true
    && value.productIdentityMatchesSource === true
    && productPixelEvidence(value).length > 0;
}

function normalizedImageExtension(url) {
  try {
    const ext = path.extname(new URL(url).pathname).toLowerCase();
    return [".png", ".jpg", ".jpeg", ".webp"].includes(ext) ? ext : ".png";
  } catch {
    return ".png";
  }
}

function normalizedMediaExtension(url, mediaType) {
  try {
    const ext = path.extname(new URL(url).pathname).toLowerCase();
    if (ext && ext.length <= 8) return ext;
  } catch {}
  return mediaType === "video" ? ".mp4" : mediaType === "audio" ? ".mp3" : ".png";
}

function createOneClickRemakeRuntime(options = {}) {
  const jobsDir = path.resolve(options.jobsDir || path.join(__dirname, "jobs"));
  const outputRoot = path.resolve(options.outputRoot || path.join(__dirname, "outputs", "一键做同款"));
  const libraryPath = path.join(jobsDir, "one-click-remake-prompt-library.json");
  const jobs = new Map();
  const quantityControlEnabled = false;
  let promptLibrary = [];
  const saveQueues = new Map();
  const upstreamUploadQueues = new Map();
  const videoRecoveryFlights = new Map();
  let librarySaveQueue = Promise.resolve();
  let videoRecoveryTimer = null;

  const runLibtv = options.runLibtv;
  const qwen = options.qwenPromptClient;
  const gpt = options.gptImageClient;
  const productGeometry = options.productGeometryClient || createProductGeometryClient({
    baseUrl: options.productGeometryUrl || process.env.ONE_CLICK_REMAKE_GEOMETRY_URL || "",
    timeoutMs: options.productGeometryTimeoutMs || process.env.ONE_CLICK_REMAKE_GEOMETRY_TIMEOUT_MS
  });
  const productWorkflows = options.productWorkflows;
  const getProducts = options.getProducts || (() => []);
  const extractSourceProductFrames = options.extractSourceProductFrames;
  const currentOwner = options.currentOwner || (() => null);
  const runInJobContext = options.runInJobContext || ((_job, handler) => handler());
  const promptLibraryStore = options.promptLibraryStore || null;
  const autoVideoRecovery = options.autoVideoRecovery === true;
  const videoRecoveryIntervalMs = Math.max(5000, Number(options.videoRecoveryIntervalMs || 30000));

  if (typeof runLibtv !== "function") throw new Error("一键做同款缺少 LibTV CLI 运行器");

  function jobPath(id) {
    return path.join(jobsDir, `one-click-remake-job-${safeName(id)}.json`);
  }

  async function atomicJson(filePath, value) {
    await fsp.mkdir(path.dirname(filePath), { recursive: true });
    const temporary = `${filePath}.${process.pid}.${Date.now()}.${crypto.randomBytes(3).toString("hex")}.tmp`;
    await fsp.writeFile(temporary, JSON.stringify(value, null, 2), "utf8");
    await fsp.rename(temporary, filePath);
  }

  function save(job) {
    job.updatedAt = isoNow();
    const previous = saveQueues.get(job.id) || Promise.resolve();
    const next = previous.catch(() => {}).then(() => atomicJson(jobPath(job.id), job));
    saveQueues.set(job.id, next);
    next.finally(() => {
      if (saveQueues.get(job.id) === next) saveQueues.delete(job.id);
    }).catch(() => {});
    return next;
  }

  async function saveLibrary() {
    librarySaveQueue = librarySaveQueue.catch(() => {}).then(() => atomicJson(libraryPath, promptLibrary));
    return librarySaveQueue;
  }

  function replaceRecipe(recipe) {
    const index = promptLibrary.findIndex((item) => item.id === recipe.id);
    if (index >= 0) promptLibrary[index] = recipe;
    else promptLibrary.unshift(recipe);
    promptLibrary = promptLibrary.slice(0, 500);
  }

  function recipeSnapshotPath(recipe) {
    const jobId = safeName(recipe.result?.jobId || "migrated", "migrated");
    return path.join(outputRoot, jobId, "recipe-snapshots", `${safeName(recipe.id, "recipe")}.json`);
  }

  async function syncRecipe(recipe, options = {}) {
    const snapshotPath = recipeSnapshotPath(recipe);
    const snapshot = clone(recipe);
    delete snapshot.storage;
    await atomicJson(snapshotPath, snapshot);
    let updated = recipe;
    if (typeof promptLibraryStore?.save === "function") {
      try {
        const stored = await promptLibraryStore.save(recipe, {
          snapshotPath,
          ownerKey: recipe.ownerKey,
          actor: options.actor || recipe.createdBy || recipe.ownerKey,
          forceSnapshotUpload: options.forceSnapshotUpload === true
        });
        updated = clone(stored?.recipe || { ...recipe, storage: stored?.storage || recipe.storage });
      } catch (error) {
        updated = {
          ...recipe,
          storage: {
            ...(recipe.storage || {}),
            backend: "aliyun-oss+mysql",
            ossSynced: Boolean(recipe.storage?.snapshotUrl),
            databaseSynced: false,
            syncState: recipe.storage?.snapshotUrl ? "oss_only" : "local_fallback",
            lastError: safeText(error?.message || error, 1000)
          }
        };
      }
    } else {
      updated = {
        ...recipe,
        storage: {
          ...(recipe.storage || {}),
          backend: "local-fallback",
          ossSynced: false,
          databaseSynced: false,
          syncState: "local_fallback",
          lastError: "共享提示词库尚未配置"
        }
      };
    }
    replaceRecipe(updated);
    await saveLibrary();
    return updated;
  }

  function pendingRecipeStorage() {
    return {
      backend: "aliyun-oss+mysql",
      snapshotKey: "",
      snapshotUrl: "",
      snapshotSha256: "",
      ossSynced: false,
      databaseSynced: false,
      syncState: "pending",
      lastError: ""
    };
  }

  function sourceAuditRecipe(job) {
    const recipeId = safeText(job.sourceArchive?.recipeId || `source-${job.id}`, 64);
    const archivedRecipe = job.sourceArchive || {};
    const orderedAssets = (job.audit?.assets || []).map((asset) => ({
      order: asset.order,
      nodeKey: asset.nodeKey,
      mediaType: asset.mediaType,
      label: asset.label,
      role: asset.role,
      url: asset.url,
      width: asset.width,
      height: asset.height,
      content: clone(asset.content || []),
      sourceConflicts: clone(asset.sourceConflicts || []),
      textTrace: clone(asset.textTrace || null),
      productBearing: asset.productBearing,
      backgroundBearing: asset.backgroundBearing,
      personBearing: asset.personBearing,
      sceneBearing: asset.sceneBearing,
      handContact: asset.handContact,
      rebuildRequired: asset.rebuildRequired,
      generationRequired: asset.generationRequired,
      replacementStrategy: asset.replacementStrategy,
      rebuildRoles: clone(asset.rebuildRoles || []),
      productFacts: clone(asset.productFacts || null),
      carrierProps: clone(asset.carrierProps || [])
    }));
    return {
      id: recipeId,
      schemaVersion: "one-click-remake-source-recipe-v2",
      caseStage: "source_ready",
      visibility: "shared",
      ownerKey: safeText(archivedRecipe.ownerKey, 100) || job.libtvOwner.key,
      ownerName: safeText(archivedRecipe.ownerName, 200) || safeText(archivedRecipe.createdBy, 200) || job.libtvOwner.name || job.libtvOwner.userId || job.libtvOwner.key,
      createdBy: safeText(archivedRecipe.createdBy, 200) || job.libtvOwner.name || job.libtvOwner.userId || job.libtvOwner.key,
      createdAt: safeText(archivedRecipe.createdAt, 80) || job.createdAt || isoNow(),
      title: safeText(archivedRecipe.title, 200) || `${job.source.videoNodeName || "成功视频节点"} · 已拆解模板`,
      tags: clone(Array.isArray(archivedRecipe.tags) ? archivedRecipe.tags : []),
      ...(archivedRecipe.titleUpdatedAt ? { titleUpdatedAt: archivedRecipe.titleUpdatedAt } : {}),
      ...(archivedRecipe.titleUpdatedBy ? { titleUpdatedBy: archivedRecipe.titleUpdatedBy } : {}),
      coverUrl: job.source.resultUrl || "",
      source: clone(job.source),
      audit: clone(job.audit),
      sourceProduct: clone(job.sourceProduct),
      sourceProductMatch: clone(job.sourceProductMatch),
      changeType: clone(job.changeType),
      sourceSnapshot: {
        prompt: job.source.prompt || "",
        params: clone(job.source.params || {}),
        orderedAssets,
        nodeKeyOrder: orderedAssets.map((asset) => asset.nodeKey),
        promptNodeKeys: promptNodeKeys(job.source.prompt)
      },
      targetProduct: null,
      productAssets: [],
      replacementAssets: [],
      firstFrameOverride: null,
      replacementInstructions: { background: "", person: "" },
      imagePrompts: [],
      videoPrompt: {
        source: job.source.prompt || "",
        compiled: "",
        replacements: []
      },
      result: {
        canvasUrl: "",
        videoUrl: "",
        previewUrl: "",
        jobId: job.id,
        targetId: ""
      },
      storage: pendingRecipeStorage()
    };
  }

  async function archiveSourceAudit(job) {
    const recipe = sourceAuditRecipe(job);
    replaceRecipe(recipe);
    await saveLibrary();
    const stored = await syncRecipe(recipe);
    job.sourceArchive = {
      recipeId: stored.id,
      caseStage: stored.caseStage,
      archivedAt: isoNow(),
      ownerKey: stored.ownerKey || "",
      ownerName: stored.ownerName || stored.createdBy || "",
      createdBy: stored.createdBy || "",
      createdAt: stored.createdAt || "",
      title: stored.title || "",
      tags: clone(stored.tags || []),
      titleUpdatedAt: stored.titleUpdatedAt || "",
      titleUpdatedBy: stored.titleUpdatedBy || "",
      storage: clone(stored.storage || {})
    };
    addEvent(job, "source_archived", stored.storage?.ossSynced
      ? "成功拆解快照已存入平台 OSS，并加入历史任务做同款"
      : "成功拆解快照已加入历史任务，OSS 暂不可用并已进入自动重试队列");
    return stored;
  }

  async function syncPendingRecipes(limit = 20) {
    const pending = promptLibrary
      .filter((recipe) => recipe.storage?.syncState !== "synchronized")
      .slice(0, Math.max(1, Math.min(100, Number(limit || 20))));
    if (!pending.length || typeof promptLibraryStore?.save !== "function") return { attempted: 0 };
    await runPool(pending, 2, async (recipe) => {
      try {
        await syncRecipe(recipe);
      } catch (_) {}
    });
    return { attempted: pending.length };
  }

  function backfillPersistedUpstreamAssets(job = {}) {
    if (!job.audit || !Array.isArray(job.audit.assets) || !job.source?.params) return false;
    const sourceAssets = orderedMedia(job.source.params);
    const existingByKey = new Map(job.audit.assets.map((asset) => [String(asset?.nodeKey || ""), asset]));
    const sourceProduct = productById(job.sourceProduct?.id) || job.sourceProduct || {};
    let changed = false;
    const assets = sourceAssets.map((sourceAsset, index) => {
      const existing = existingByKey.get(sourceAsset.nodeKey);
      if (existing) {
        const merged = {
          ...sourceAsset,
          ...existing,
          order: index + 1,
          mediaType: existing.mediaType || sourceAsset.mediaType,
          content: sourceAsset.mediaType === "text" ? clone(sourceAsset.content || []) : clone(existing.content || []),
          sourceConflicts: clone(sourceAsset.sourceConflicts || existing.sourceConflicts || [])
        };
        if (sourceAsset.mediaType === "text" && (!existing.textTrace || JSON.stringify(existing.content || []) !== JSON.stringify(sourceAsset.content || []))) {
          const textTrace = analyzeSourceTextAsset(merged, sourceProduct, getProducts());
          merged.textTrace = textTrace;
          merged.rebuildRoles = job.changeType?.changesProduct && textTrace.rewriteRequired ? ["SKU文本"] : [];
          merged.rebuildRequired = merged.rebuildRoles.length > 0;
          merged.generationRequired = false;
          merged.replacementStrategy = textTrace.rewriteRequired ? "rewrite_text" : "reuse_text";
          merged.auditConflict = textTrace.conflicts.length ? {
            type: "text_asset_trace_conflict",
            conflicts: clone(textTrace.conflicts),
            resolution: "blocked_until_source_corrected"
          } : null;
          changed = true;
        }
        return merged;
      }
      changed = true;
      if (sourceAsset.mediaType === "text") {
        const textTrace = analyzeSourceTextAsset(sourceAsset, sourceProduct, getProducts());
        const rebuildRoles = job.changeType?.changesProduct && textTrace.rewriteRequired ? ["SKU文本"] : [];
        return {
          ...sourceAsset,
          order: index + 1,
          role: "文本参考",
          productBearing: false,
          productIdentityMatchesSource: false,
          productPixelEvidence: [],
          backgroundBearing: false,
          personBearing: false,
          sceneBearing: false,
          handContact: false,
          carrierProps: [],
          textTrace,
          rebuildRoles,
          rebuildRequired: rebuildRoles.length > 0,
          generationRequired: false,
          replacementStrategy: textTrace.rewriteRequired ? "rewrite_text" : "reuse_text",
          auditConflict: textTrace.conflicts.length ? {
            type: "text_asset_trace_conflict",
            conflicts: clone(textTrace.conflicts),
            resolution: "blocked_until_source_corrected"
          } : null,
          productFacts: null,
          reason: textTrace.conflicts.length
            ? `文本节点已从原始生成参数恢复，但发现冲突：${textTrace.conflicts.map((item) => item.message || item.type).join("；")}`
            : textTrace.rewriteRequired
              ? `文本节点已从原始生成参数恢复；后续按目标 SKU 改写：${textTrace.sourceMentions.join("、")}`
              : "文本节点已从原始生成参数恢复，内容保持不变。"
        };
      }
      return {
        ...sourceAsset,
        order: index + 1,
        role: `${sourceAsset.mediaType || "未知"}参考`,
        productBearing: false,
        rebuildRoles: [],
        rebuildRequired: false,
        generationRequired: false,
        replacementStrategy: "unsupported",
        auditConflict: {
          type: "source_asset_trace_conflict",
          conflicts: clone(sourceAsset.sourceConflicts || []),
          resolution: "blocked_until_source_payload_is_complete"
        },
        reason: (sourceAsset.sourceConflicts || []).map((item) => item.message || item.type).join("；") || "未知上游节点已溯源，当前不能安全重建。"
      };
    });
    const sourceKeys = new Set(sourceAssets.map((asset) => asset.nodeKey));
    const extras = job.audit.assets.filter((asset) => !sourceKeys.has(asset.nodeKey));
    if (!changed) return false;
    job.audit.assets = [...assets, ...extras.map((asset, offset) => ({ ...asset, order: assets.length + offset + 1 }))];
    job.audit.schemaVersion = "one-click-remake-audit-v7";
    job.audit.summary = "已按保存的源节点参数回填全部上游资产；文本执行 SKU 改写与冲突检查";
    job.audit.upstreamBackfilledAt = isoNow();
    for (const target of job.targets || []) {
      const targetProduct = productById(target.productId) || targetProductIdentity(target);
      target.upstreamTextAssets = compileTargetTextAssets(job.audit.assets, sourceProduct, targetProduct, getProducts());
      if (target.upstreamAssetManifest) target.upstreamAssetManifest = buildUpstreamAssetManifest(job, target);
    }
    addEvent(job, "upstream_assets_backfilled", "已从任务保存的源节点参数补齐遗漏的上游资产；未重新拆解源画布或生成候选图", {
      assetCount: job.audit.assets.length,
      textAssetCount: job.audit.assets.filter((asset) => asset.mediaType === "text").length
    });
    return true;
  }

  async function init() {
    await Promise.all([fsp.mkdir(jobsDir, { recursive: true }), fsp.mkdir(outputRoot, { recursive: true })]);
    const interruptedRecoveries = [];
    const backgroundSceneRecoveries = [];
    const upstreamBackfills = [];
    try {
      const parsed = JSON.parse(await fsp.readFile(libraryPath, "utf8"));
      promptLibrary = Array.isArray(parsed) ? parsed : [];
    } catch {
      promptLibrary = [];
    }
    for (const file of await fsp.readdir(jobsDir)) {
      if (!/^one-click-remake-job-.*\.json$/i.test(file)) continue;
      try {
        const job = JSON.parse(await fsp.readFile(path.join(jobsDir, file), "utf8"));
        if (!job?.id) continue;
        const persistedStatus = safeText(job.status, 80);
        const resumeKind = interruptedResumeKind(job, persistedStatus);
        if (resumeKind) {
          job.interruption = {
            ...(job.interruption || {}),
            detectedAt: isoNow(),
            fromStatus: persistedStatus,
            fromStage: safeText(job.stage, 80),
            resumeKind
          };
          job.status = "resuming_interrupted_stage";
          job.stage = "resuming_interrupted_stage";
          job.message = "服务重启已被检测，正在从最近检查点恢复当前阶段";
          interruptedRecoveries.push({ job, resumeKind });
        } else if (ACTIVE_STATUSES.has(job.status)) {
          job.status = "interrupted";
          job.stage = "interrupted";
          job.message = "服务重启中断了后台执行，请重新提交当前阶段";
        }
        jobs.set(job.id, job);
        if (["queued", "running"].includes(job.backgroundSceneGeneration?.status)) {
          backgroundSceneRecoveries.push(job);
        }
        if (backfillPersistedUpstreamAssets(job)) upstreamBackfills.push(job);
      } catch {}
    }
    for (const job of upstreamBackfills) await save(job);
    if (upstreamBackfills.length) {
      const timer = setTimeout(() => {
        runPool(upstreamBackfills.filter((job) => job.sourceArchive), 2, async (job) => {
          try {
            await syncCorrectedSourceAudit(job);
            await save(job);
          } catch (error) {
            addEvent(job, "upstream_snapshot_sync_deferred", `上游资产已在任务内补齐，共享快照同步待稍后重试：${failureReason(error)}`);
            await save(job);
          }
        }).catch(() => {});
      }, 1000);
      timer.unref?.();
    }
    if (promptLibrary.some((recipe) => recipe.storage?.syncState !== "synchronized") && typeof promptLibraryStore?.save === "function") {
      const timer = setTimeout(() => syncPendingRecipes().catch(() => {}), 1000);
      timer.unref?.();
    }
    if (interruptedRecoveries.length) {
      const timer = setTimeout(() => {
        runPool(interruptedRecoveries, 2, ({ job, resumeKind }) => (
          runInJobContext(job, () => resumePersistedInterruptedJob(job, resumeKind))
        )).catch(() => {});
      }, 250);
      timer.unref?.();
    }
    if (backgroundSceneRecoveries.length) {
      const timer = setTimeout(() => {
        runPool(backgroundSceneRecoveries, 2, (job) => (
          runInJobContext(job, () => resumeBackgroundSceneGeneration(job))
        )).catch(() => {});
      }, 250);
      timer.unref?.();
    }
    if (autoVideoRecovery && hasRecoverableVideoResults()) scheduleVideoRecoverySweep(1500);
    return {
      jobs: jobs.size,
      recipes: promptLibrary.length,
      interruptedRecoveries: interruptedRecoveries.length,
      backgroundSceneRecoveries: backgroundSceneRecoveries.length,
      upstreamBackfills: upstreamBackfills.length
    };
  }

  function ownerKey() {
    return safeText(currentOwner()?.key, 100);
  }

  function owned(job) {
    return Boolean(job && ownerKey() && safeText(job.libtvOwner?.key, 100) === ownerKey());
  }

  function requireJob(id) {
    const job = jobs.get(String(id || ""));
    if (!owned(job)) throw new Error("任务不存在");
    return job;
  }

  function addEvent(job, stage, message, details = null) {
    job.events ||= [];
    job.events.push({ at: isoNow(), stage, message, ...(details ? { details } : {}) });
    if (job.events.length > 300) job.events.shift();
    job.stage = stage;
    job.message = message;
  }

  function assetPreparationCheckpointReady(job, target) {
    if (target?.status !== "awaiting_confirmation") return false;
    const groups = Array.isArray(target.assetGroups) ? target.assetGroups : [];
    for (const group of groups) {
      const firstRoundCandidates = (group.candidates || []).filter((candidate) => Number(candidate.round || 1) === 1);
      const requiredCount = isDirectAssetGroup(group) ? 1 : 2;
      if (firstRoundCandidates.length < requiredCount) return false;
      if (firstRoundCandidates.slice(0, requiredCount).some((candidate) => !candidate.localPath || !fs.existsSync(candidate.localPath))) return false;
    }
    return buildUpstreamAssetManifest(job, target).errors.length === 0;
  }

  async function resumePersistedInterruptedJob(job, resumeKind) {
    const fromStatus = safeText(job.interruption?.fromStatus, 80) || "interrupted";
    addEvent(job, "resuming_interrupted_stage", "服务重启后正在从最近检查点恢复，不重复执行已完成的 SKU", {
      fromStatus,
      resumeKind
    });
    await save(job);
    try {
      if (resumeKind === "audit") {
        await inspectAudit(job);
        return;
      }
      if (resumeKind === "history_snapshot") {
        const recipeId = safeText(job.sourceArchive?.recipeId || job.historyRecipeId, 64);
        const recipe = recipeId ? await findRecipe(recipeId, { allowAnyOwner: true }) : null;
        if (!recipe || !reusableSourceSnapshot(recipe, job.changeType)) {
          throw new Error("中断任务对应的共享拆解快照不存在或不完整，无法安全恢复");
        }
        await prepareHistoryRemakeFromSnapshot(job, recipe);
        return;
      }
      if (resumeKind === "mapping") {
        await prepareMapping(job, clone(job.preparationRequest || {}));
        return;
      }
      if (resumeKind === "assets") {
        const hasPreparedTargets = (job.targets || []).some((target) => target?.mappingPlan || target?.assetGroups?.length);
        const request = hasPreparedTargets
          ? { ...clone(job.assetPreparationRequest || {}), usePreparedTargets: true, resumeInterrupted: true }
          : { ...clone(job.preparationRequest || {}), resumeInterrupted: true };
        await prepareAssets(job, request);
        return;
      }
      if (resumeKind === "image_regeneration") {
        for (const target of job.targets || []) {
          for (const group of target.assetGroups || []) {
            if (!["queued", "running"].includes(group.regeneration?.status)) continue;
            group.regeneration = {
              ...group.regeneration,
              status: "failed",
              completedAt: isoNow(),
              error: "服务重启中断了本轮候选图生成；此前已完成的候选图仍保留，可重新发起本轮。"
            };
            target.status = "awaiting_confirmation";
          }
        }
        job.status = "awaiting_asset_confirmation";
        job.progress = 100;
        addEvent(job, "image_regeneration_interrupted", "候选图追加轮次被服务重启中断；已保留原候选，可按需重新发起");
        await save(job);
        return;
      }
      if (resumeKind === "manual_video_retry") {
        const targets = (job.targets || []).filter((target) => target.status === "quality_retrying" && Number(target.generationAttempt || 0) < MAX_VIDEO_GENERATION_ROUNDS);
        await runPool(targets, Math.min(2, Math.max(1, targets.length)), (target) => generateVideoAfterManualRejection(job, target));
        return;
      }
      if (resumeKind === "archive") {
        for (const target of job.targets || []) {
          if (target.status !== "archiving_result") continue;
          const recipe = await addRecipe(job, target);
          target.archive = { status: "completed", recipeId: recipe.id, storage: clone(recipe.storage || {}), archivedAt: isoNow() };
          target.status = "success";
        }
        settleVideoJob(job);
        addEvent(job, job.status, job.message || "人工质检成片归档已恢复");
        await save(job);
        return;
      }
      throw new Error("无法识别中断任务的安全恢复阶段");
    } catch (error) {
      const failureStage = resumeKind === "history_snapshot"
        ? "history_remake_failed"
        : resumeKind === "mapping"
          ? "mapping_preparation_failed"
          : resumeKind === "assets" || resumeKind === "image_regeneration"
            ? "asset_preparation_failed"
            : "audit_failed";
      const retryKind = ({ audit: "audit", mapping: "mapping", assets: "assets" })[resumeKind] || "";
      recordJobFailure(job, failureStage, error, retryKind);
      await save(job);
    }
  }

  function recordTargetFailure(job, target, error) {
    const stage = safeText(target.status || "generating_video", 80);
    const reason = failureReason(error) || "视频生成失败，日志未返回具体原因";
    const failure = {
      at: isoNow(),
      stage,
      stageLabel: TARGET_FAILURE_STAGE_LABELS[stage] || "视频生成",
      reason,
      code: safeText(error?.code, 120),
      retryable: Math.max(1, Number(target.generationAttempt || 1)) < MAX_VIDEO_GENERATION_ROUNDS,
      attempt: Math.max(1, Number(target.generationAttempt || 1)),
      ...(error?.cliDiagnostics ? { diagnostics: clone(error.cliDiagnostics) } : {})
    };
    target.status = "failed";
    target.failure = failure;
    target.result ||= {};
    target.result.error = reason;
    target.result.failedAt = failure.at;
    addEvent(job, "target_video_failed", `${target.productName || "目标视频"}生成失败：${reason}`, {
      targetId: target.id,
      productName: target.productName || "",
      ...failure
    });
    scheduleVideoRecoverySweep(5000);
    return failure;
  }

  function currentVideoRound(target) {
    const round = Math.max(1, Number(target?.generationAttempt || 1));
    return (target?.videoRounds || []).find((item) => Number(item.round) === round) || null;
  }

  function recoverableVideoTarget(job, target, force = false) {
    const attempt = Math.max(0, Number(target?.generationAttempt || 0));
    const projectId = safeText(job?.canvas?.projectId || target?.result?.projectId, 160);
    if (!attempt || !projectId) return false;
    if (target?.resultRecovery?.status === "regeneration_failed") return false;
    if (["terminal_failed", "source_missing"].includes(target?.resultRecovery?.status)
      && !target?.resultRecovery?.requestedAt) return false;
    const failureStage = safeText(target?.failure?.stage, 80);
    const currentRound = currentVideoRound(target);
    const localReady = Boolean(currentRound?.localPath && fs.existsSync(currentRound.localPath));
    const interruptedQuality = job?.status === "interrupted" && ["quality_checking", "quality_retrying"].includes(target?.status) && localReady;
    const failureReasonText = safeText(target?.failure?.reason || target?.result?.error, 3000);
    const failedAfterSubmission = target?.status === "failed"
      && ["generating_video", "downloading_result", "retrying_video"].includes(failureStage)
      && (failureStage === "downloading_result"
        || Boolean(target?.resultRecovery?.status)
        || /progress\s*[=:]\s*\d+%|nodesBatch|写回失败|回传|未授权|连接|网络|timeout|超时|已创建.*节点|(?:没有|未返回).*成片\s*URL/i.test(failureReasonText));
    const submittedNodeMayExist = ["generating_video", "downloading_result", "retrying_video"].includes(target?.status)
      || failedAfterSubmission;
    if (!interruptedQuality && !submittedNodeMayExist) return false;
    if (currentRound?.videoUrl && localReady && !interruptedQuality) return false;
    if (!force && Date.parse(target?.resultRecovery?.nextAttemptAt || "") > Date.now()) return false;
    return true;
  }

  function hasRecoverableVideoResults() {
    return [...jobs.values()].some((job) => (job.targets || []).some((target) => recoverableVideoTarget(job, target, true)));
  }

  function videoRecoveryDelay(attempts) {
    const delays = [15000, 30000, 60000, 300000, 900000, 1800000];
    return delays[Math.min(delays.length - 1, Math.max(0, Number(attempts || 1) - 1))];
  }

  function scheduleVideoRecoverySweep(delayMs = videoRecoveryIntervalMs) {
    if (!autoVideoRecovery || videoRecoveryTimer) return;
    videoRecoveryTimer = setTimeout(async () => {
      videoRecoveryTimer = null;
      await recoverPersistedVideoResults().catch(() => {});
      if (hasRecoverableVideoResults()) scheduleVideoRecoverySweep(videoRecoveryIntervalMs);
    }, Math.max(250, Number(delayMs || videoRecoveryIntervalMs)));
    videoRecoveryTimer.unref?.();
  }

  function recordJobFailure(job, stage, error, retryKind = "") {
    const reason = failureReason(error) || "任务失败，日志未返回具体原因";
    const failure = {
      at: isoNow(),
      scope: "job",
      stage,
      stageLabel: JOB_FAILURE_STAGE_LABELS[stage] || "任务执行",
      reason,
      code: safeText(error?.code, 120),
      ...(error?.details ? { details: clone(error.details) } : {}),
      retryable: Boolean(retryKind),
      retryKind,
      attempt: Math.max(1, Number(job.stageAttempts?.[retryKind] || 1))
    };
    job.status = "failed";
    job.progress = 100;
    job.error = reason;
    job.failure = failure;
    addEvent(job, stage, reason, failure);
    return failure;
  }

  async function executeCli(args, job, fallback) {
    const result = await runLibtv(args, { workflow: "一键做同款" });
    const diagnostics = {
      command: args.slice(0, 4).map((item) => safeText(item, 160)),
      exitCode: Number(result.code),
      stdout: cliOutputSnippet(result.stdout),
      stderr: cliOutputSnippet(result.stderr)
    };
    if (result.code !== 0) {
      const error = new Error(`${fallback}：${failureReason(result.stderr || result.stdout)}`);
      error.code = "LIBTV_CLI_EXECUTION_FAILED";
      error.cliDiagnostics = diagnostics;
      throw error;
    }
    const parsed = parseCliJson(result.stdout);
    if (!parsed) {
      const evidence = [diagnostics.stdout && `stdout=${diagnostics.stdout}`, diagnostics.stderr && `stderr=${diagnostics.stderr}`].filter(Boolean).join("；");
      const error = new Error(`${fallback}：LibTV CLI 进程已正常结束，但回传中没有可解析的 JSON${evidence ? `（${evidence}）` : ""}`);
      error.code = "LIBTV_CLI_INVALID_JSON";
      error.cliDiagnostics = diagnostics;
      throw error;
    }
    return parsed;
  }

  async function verifyCanvasAccess(job, accountInfo = {}) {
    const activeAccount = accountInfo?.activeAccount || accountInfo?.account || {};
    const accountName = safeText(activeAccount.accountName || activeAccount.name, 200);
    const accountId = safeText(activeAccount.accountId || activeAccount.id, 120);
    try {
      const project = await executeCli(["project", job.source.projectId], job, "画布访问检查失败");
      job.source.accessCheck = {
        status: "accessible",
        checkedAt: isoNow(),
        accountId,
        accountName
      };
      return project;
    } catch (error) {
      const reason = safeText(error?.message || error, 1200);
      job.source.accessCheck = {
        status: "inaccessible",
        checkedAt: isoNow(),
        accountId,
        accountName,
        reason
      };
      const inaccessible = new Error("当前 LibTV 账号无法访问该画布。请确认画布链接已向当前账号开放，或更换可访问的画布后重新提交；本任务不会继续拆解或生成。");
      inaccessible.code = "LIBTV_CANVAS_INACCESSIBLE";
      inaccessible.details = { reason, accountId, accountName };
      throw inaccessible;
    }
  }

  async function findVideoNode(job, projectId, taskId) {
    const listed = await executeCli(["node", "list", "-p", projectId], job, "读取画布节点失败");
    const nodes = (Array.isArray(listed?.nodes) ? listed.nodes : [])
      .filter((item) => item?.type === "video" && item?.id);
    if (!nodes.length) throw new Error("该画布没有可用的视频节点");
    const batchSize = 10;
    for (let index = 0; index < nodes.length; index += batchSize) {
      const batch = nodes.slice(index, index + batchSize);
      const details = await runPool(batch, 5, async (node) => {
        try {
          return await executeCli(["node", String(node.id), "-p", projectId], job, `读取视频节点 ${node.name || node.id} 失败`);
        } catch {
          return null;
        }
      });
      const found = details.find((node) => String(node?.data?.taskInfo?.taskId || "") === taskId);
      job.progress = Math.min(52, 8 + Math.round(((index + batch.length) / nodes.length) * 44));
      job.message = `正在按 TaskID 核对视频节点 ${Math.min(index + batch.length, nodes.length)}/${nodes.length}`;
      await save(job);
      if (found) return found;
    }
    throw new Error(`画布中没有找到 TaskID：${taskId}`);
  }

  function sourceProductReferenceUrls(product = null) {
    if (!product?.id || typeof productWorkflows?.listAssets !== "function") return [];
    try {
      return productWorkflows.listAssets({ productId: product.id, assetType: "image" })
        .map((asset) => asset.storageUrl || asset.originalUrl || asset.previewUrl || asset.remoteUrl || "")
        .map(String)
        .filter((url) => /^https?:\/\//i.test(url))
        .slice(0, 3);
    } catch {
      return [];
    }
  }

  async function inspectAudit(job) {
    const startedAt = Date.now();
    try {
      job.stageAttempts ||= {};
      job.stageAttempts.audit = Math.max(0, Number(job.stageAttempts.audit || 0)) + 1;
      job.failure = null;
      job.status = "auditing";
      addEvent(job, "validating_canvas", "正在校验 LibTV 地址、登录状态和画布节点");
      job.progress = 3;
      await save(job);
      const accountInfo = await executeCli(["account", "info"], job, "LibTV 登录校验失败");
      await verifyCanvasAccess(job, accountInfo);
      const sourceNode = await findVideoNode(job, job.source.projectId, job.source.taskId);
      if (!taskSucceeded(sourceNode)) throw new Error("TaskID 对应的视频节点未成功完成或没有成片");
      const params = clone(sourceNode.data?.params || {});
      const assets = orderedMedia(params);
      if (!assets.length && params.modeType !== "text2video") {
        throw new Error("目标视频节点没有可复用的上游资产");
      }
      addEvent(job, "classifying_source", "已定位成功视频节点，正在审计类型与产品承载资产");
      job.progress = 62;
      await save(job);
      const classifiedByKey = new Map();
      const unavailableAuditKeys = new Set();
      const classificationWarnings = [];
      const sourceProductHint = identifySourceProduct(
        params.prompt,
        assets.map((asset) => [asset.label, asset.role, ...(asset.content || [])])
      );
      const auditContext = {
        prompt: params.prompt,
        params,
        changeType: job.changeType,
        sourceProduct: sourceProductHint.product ? {
          id: sourceProductHint.product.id,
          name: sourceProductHint.product.name || sourceProductHint.product.platformName || "",
          aliases: productAliases(sourceProductHint.product),
          productProfile: clone(profileFromProduct(sourceProductHint.product))
        } : null,
        productCatalog: getProducts().map((product) => ({
          id: product.id,
          name: product.name || product.platformName || "",
          aliases: productAliases(product)
        }))
      };
      const imageAssets = assets.filter((asset) => asset.mediaType === "image");
      const classificationResults = await runPool(imageAssets, 3, async (asset) => {
        if (!asset.url) return { nodeKey: asset.nodeKey, error: "图片缺少可审计地址" };
        try {
          const response = await qwen.completeJson(auditMessages({
            ...auditContext,
            assets: [asset]
          }), { temperature: 0, maxTokens: 3200 });
          const returnedAssets = Array.isArray(response.result?.assets) ? response.result.assets : [];
          const evidence = returnedAssets.find((item) => String(item?.nodeKey || "") === asset.nodeKey)
            || returnedAssets[0];
          if (!evidence || typeof evidence !== "object") {
            throw new Error("模型未返回当前图片的资产判断");
          }
          return { nodeKey: asset.nodeKey, evidence: { ...evidence, nodeKey: asset.nodeKey } };
        } catch (error) {
          return { nodeKey: asset.nodeKey, error: error.message };
        }
      });
      for (const result of classificationResults) {
        if (result.error) {
          unavailableAuditKeys.add(result.nodeKey);
          classificationWarnings.push(`${result.nodeKey}：${result.error}`);
        } else {
          classifiedByKey.set(result.nodeKey, result.evidence);
        }
      }
      const classificationWarning = classificationWarnings.length
        ? `部分图片的多模态资产审计暂不可用，失败图片已单独按保守策略列入人工确认：${classificationWarnings.join("；")}`
        : "";
      const needsProductChange = job.changeType.changesProduct === true;
      const needsBackgroundChange = job.changeType.changesBackground === true;
      const needsPersonChange = job.changeType.changesPerson === true;
      const auditedAssets = assets.map((asset, index) => {
        const evidence = classifiedByKey.get(asset.nodeKey) || {};
        const isImage = asset.mediaType === "image";
        const isText = asset.mediaType === "text";
        const textTrace = isText
          ? analyzeSourceTextAsset(asset, sourceProductHint.product || {}, getProducts())
          : null;
        const role = safeText(evidence.role, 200) || (isImage ? "图像参考" : isText ? "文本参考" : `${asset.mediaType}参考`);
        const backgroundBearing = isImage && (typeof evidence.backgroundBearing === "boolean"
          ? evidence.backgroundBearing
          : needsBackgroundChange);
        const personBearing = isImage && (typeof evidence.personBearing === "boolean"
          ? evidence.personBearing
          : needsPersonChange);
        const independentProductReference = needsProductChange && isDirectProductReferenceAsset({
          ...asset,
          role,
          productBearing: true,
          backgroundBearing,
          personBearing
        });
        const auditUnavailable = unavailableAuditKeys.has(asset.nodeKey);
        const resolvedProduct = resolveProductBearing({
          evidence,
          independentProductReference,
          auditUnavailable,
          needsProductChange,
          isImage
        });
        const { productBearing, productIdentityMatchesSource, pixelEvidence, textualPixelClaims, auditConflict } = resolvedProduct;
        const rebuildRoles = [
          needsProductChange && productBearing ? "产品" : "",
          needsBackgroundChange && backgroundBearing ? "背景" : "",
          needsPersonChange && personBearing ? "人物" : "",
          needsProductChange && textTrace?.rewriteRequired ? "SKU文本" : ""
        ].filter(Boolean);
        const textConflict = textTrace?.conflicts?.length ? {
          type: "text_asset_trace_conflict",
          conflicts: clone(textTrace.conflicts),
          resolution: "blocked_until_source_corrected"
        } : null;
        const sourceTraceConflict = !isText && asset.sourceConflicts?.length ? {
          type: "source_asset_trace_conflict",
          conflicts: clone(asset.sourceConflicts),
          resolution: "blocked_until_source_payload_is_complete"
        } : null;
        const baseAsset = {
          ...asset,
          order: index + 1,
          role,
          productBearing,
          productIdentityMatchesSource,
          productPixelEvidence: pixelEvidence,
          auditConflict: textConflict || sourceTraceConflict || (auditConflict ? {
            type: "text_confirms_visible_source_product",
            claims: textualPixelClaims,
            resolution: "force_product_bearing_and_rebuild"
          } : null),
          backgroundBearing,
          personBearing,
          sceneBearing: isImage && (typeof evidence.sceneBearing === "boolean" ? evidence.sceneBearing : backgroundBearing),
          handContact: isImage && evidence.handContact === true,
          carrierProps: isImage ? normalizeCarrierProps(evidence) : [],
          textTrace,
          rebuildRoles,
          rebuildRequired: rebuildRoles.length > 0,
          productPresenceReview: isImage && needsProductChange ? {
            automaticDecision: productBearing ? "replace" : "reuse",
            decision: productBearing ? "replace" : "reuse",
            decisionSource: "primary_model",
            needsHumanReview: false,
            signals: [],
            secondaryModel: "",
            secondaryReason: "",
            humanDecision: "",
            reviewedAt: isoNow()
          } : null,
          productFacts: productBearing ? {
            layer: safeText(evidence.productState || evidence.layer, 100),
            shape: safeText(evidence.shape, 240),
            view: safeText(evidence.view, 80) || "unknown",
            status: safeText(evidence.status, 80) || "closed",
            actions: Array.isArray(evidence.actions) ? evidence.actions.map((item) => safeText(item, 100)).filter(Boolean) : [],
            productCount: Number.isInteger(Number(evidence.productCount)) && Number(evidence.productCount) > 0 ? Number(evidence.productCount) : null,
            instances: Array.isArray(evidence.productInstances) ? clone(evidence.productInstances).slice(0, 100) : [],
            countConfidence: Math.max(0, Math.min(1, Number(evidence.countConfidence ?? 0))),
            orientation: safeText(evidence.orientation, 40) || "unknown",
            layoutType: safeText(evidence.layoutType, 60) || "unknown",
            cameraElevationDeg: Number.isFinite(Number(evidence.cameraElevationDeg)) ? Number(evidence.cameraElevationDeg) : null,
            cameraYawDeg: Number.isFinite(Number(evidence.cameraYawDeg)) ? Number(evidence.cameraYawDeg) : null,
            averageVisibleRatio: Number.isFinite(Number(evidence.averageVisibleRatio)) ? Math.max(0, Math.min(1, Number(evidence.averageVisibleRatio))) : null,
            confidence: Math.max(0, Math.min(1, Number(evidence.confidence ?? 0.45))),
            evidence: safeText(evidence.evidence || evidence.reason, 2000) || "多模态审计未返回明确产品形态证据，需人工核实"
          } : null,
          reason: textConflict
            ? `文本节点已溯源，但发现冲突：${textTrace.conflicts.map((item) => item.message || item.type).join("；")}`
            : sourceTraceConflict
            ? `上游节点已按 nodeKey 溯源，但来源数据存在冲突：${asset.sourceConflicts.map((item) => item.message || item.type).join("；")}`
            : isText && textTrace.rewriteRequired
            ? `文本节点引用原片 SKU（${textTrace.sourceMentions.join("、")}），每个目标 SKU 将生成独立改写内容并在提交前检查残留与跨 SKU 冲突。`
            : isText
            ? "文本节点已溯源；未发现原片 SKU 名称，保持内容不变并继续参与 nodeKey 连线。"
            : auditConflict
            ? `审计文字已明确确认当前源图存在旧产品像素（${textualPixelClaims.join("；")}），与布尔字段冲突；平台按含产品处理并强制进入重构，禁止源图直通。`
            : evidence.productBearing === true && !productBearing
            ? "模型提到了产品相关剧情，但没有提供与原片 SKU 身份一致的可见产品像素证据；该图仅承载人物、服装、身体状态或动作时序，源图原样复用，不调用生图。"
            : safeText(evidence.reason, 1200) || (rebuildRoles.length
            ? `保守判定：画面可能承载待替换的${rebuildRoles.join("、")}`
            : "未发现本次需要重建的画面内容")
        };
        const directProductReference = needsProductChange && rebuildRoles.length === 1
          && rebuildRoles[0] === "产品" && isDirectProductReferenceAsset(baseAsset);
        return {
          ...baseAsset,
          generationRequired: !isText && baseAsset.rebuildRequired && !directProductReference,
          replacementStrategy: isText
            ? textTrace?.rewriteRequired ? "rewrite_text" : "reuse_text"
            : directProductReference
            ? "direct_oss_product_asset"
            : baseAsset.rebuildRequired ? "generate_candidate" : "reuse_source",
          reason: directProductReference
            ? "已识别为独立产品资料节点；换品时从所选 SKU 的 OSS 产品资产中匹配同类图，禁止重新生图。"
            : baseAsset.reason
        };
      });
      const sourceReferenceUrls = sourceProductReferenceUrls(sourceProductHint.product);
      const secondaryCandidates = auditedAssets.map((asset) => {
        if (!needsProductChange || asset.mediaType !== "image" || asset.productBearing || asset.replacementStrategy === "direct_oss_product_asset") return null;
        const evidence = classifiedByKey.get(asset.nodeKey) || {};
        const nodeContext = nodePromptContext(params.prompt, asset.nodeKey);
        const signals = productPresenceReviewSignals({ evidence, nodeContext });
        return signals.length ? { asset, evidence, nodeContext, signals } : null;
      }).filter(Boolean);
      if (secondaryCandidates.length && typeof qwen?.completeJson === "function") {
        await runPool(secondaryCandidates, 2, async ({ asset, nodeContext, signals }) => {
          try {
            const response = await qwen.completeJson(productPresenceReviewMessages({
              asset,
              prompt: params.prompt,
              nodeContext,
              signals,
              sourceProduct: sourceProductHint.product ? {
                id: sourceProductHint.product.id,
                name: sourceProductHint.product.name || sourceProductHint.product.platformName || "",
                aliases: productAliases(sourceProductHint.product)
              } : null,
              referenceUrls: sourceReferenceUrls
            }), { temperature: 0, maxTokens: 1600 });
            const reviewEvidence = response.result || {};
            const reviewed = resolveProductBearing({
              evidence: reviewEvidence,
              independentProductReference: false,
              auditUnavailable: false,
              needsProductChange: true,
              isImage: true
            });
            if (reviewed.productBearing) {
              Object.assign(asset, applyProductPresenceDecision(asset, "replace", {
                source: "secondary_model",
                evidence: reviewEvidence,
                model: response.model || qwen?.status?.()?.model || "qwen3.7-plus",
                needsHumanReview: true,
                signals
              }));
            } else {
              asset.productPresenceReview = {
                ...(asset.productPresenceReview || {}),
                decision: "reuse",
                decisionSource: "secondary_model",
                needsHumanReview: true,
                signals: clone(signals),
                secondaryModel: safeText(response.model || qwen?.status?.()?.model || "qwen3.7-plus", 160),
                secondaryReason: safeText(reviewEvidence.reason || reviewEvidence.uncertainty, 1200),
                reviewedAt: isoNow()
              };
            }
          } catch (error) {
            asset.productPresenceReview = {
              ...(asset.productPresenceReview || {}),
              needsHumanReview: true,
              signals: clone(signals),
              secondaryReason: `单图复核暂不可用：${safeText(error?.message || error, 800)}`,
              reviewedAt: isoNow()
            };
          }
        });
      }
      job.source.videoNodeKey = sourceNode.nodeKey;
      job.source.videoNodeName = sourceNode.name || sourceNode.data?.name || "视频节点";
      job.source.resultUrl = sourceNode.data.url[0];
      job.source.params = params;
      job.source.prompt = safeText(params.prompt, 20000);
      job.source.model = safeText(params.model, 240);
      job.source.modeType = safeText(params.modeType, 120);
      job.source.settings = clone(params.settings || {});
      job.source.advancedSettings = clone(params.advancedSettings || {});
      job.audit = {
        schemaVersion: "one-click-remake-audit-v7",
        videoType: job.changeType.label,
        summary: "已按 nodeKey 对成功视频节点的全部上游资产完成溯源；图片独立审计，文本执行 SKU 改写与冲突检查",
        warning: classificationWarning,
        assets: auditedAssets,
        inspectedAt: isoNow()
      };
      const textSourceMatch = identifySourceProduct(
        job.source.prompt,
        auditedAssets.map((asset) => [asset.label, asset.role, asset.productFacts?.evidence, ...(asset.content || [])]),
        ""
      );
      const visualRecommendation = await recommendSourceProductVisually(job);
      const sourceMatch = resolveSourceProductRecommendation(
        textSourceMatch,
        visualRecommendation.candidates,
        getProducts()
      );
      job.sourceProduct = sourceMatch.product ? {
        id: sourceMatch.product.id,
        name: sourceMatch.product.name || sourceMatch.product.platformName || sourceMatch.product.id,
        productProfile: clone(profileFromProduct(sourceMatch.product))
      } : null;
      job.sourceProductMatch = {
        productId: sourceMatch.product?.id || "",
        productName: sourceMatch.product?.name || sourceMatch.product?.platformName || "",
        confidence: sourceMatch.confidence,
        evidence: sourceMatch.evidence,
        method: sourceMatch.method,
        requiresConfirmation: sourceMatch.requiresConfirmation,
        candidates: clone(sourceMatch.candidates || []),
        conflict: clone(sourceMatch.conflict || null),
        visualModel: visualRecommendation.model,
        visualFrameCount: visualRecommendation.frameCount,
        visualWarning: visualRecommendation.warning
      };
      job.audit.sourceProductVisual = {
        model: visualRecommendation.model,
        frameCount: visualRecommendation.frameCount,
        candidates: clone(sourceMatch.candidates || []),
        warning: visualRecommendation.warning,
        inspectedAt: isoNow()
      };
      job.timings.auditMs = durationMs(startedAt);
      await ensureTaskCanvas(job);
      const archiveStartedAt = Date.now();
      await archiveSourceAudit(job);
      job.timings.archiveMs = durationMs(archiveStartedAt);
      const variantStartedAt = Date.now();
      await compileInitialVariantPrompts(job);
      job.timings.promptCompileMs = durationMs(variantStartedAt);
      job.status = "awaiting_configuration";
      job.progress = 100;
      job.error = "";
      job.errorCode = "";
      addEvent(job, "source_ready", `源画布拆解完成；任务画布已创建${job.sourceProduct ? `，原片产品识别为“${job.sourceProduct.name}”` : "，请先确认原片产品"}`);
      await save(job);
    } catch (error) {
      job.timings.auditMs = durationMs(startedAt);
      job.errorCode = safeText(error.code, 100);
      job.errorDetails = error.details ? clone(error.details) : null;
      recordJobFailure(job, "audit_failed", error, "audit");
      await save(job);
    }
  }

  function newJob(input, source) {
    const owner = currentOwner();
    if (!owner?.key) throw new Error("当前工作台账号未建立 LibTV 凭证空间");
    const selectedType = changeType(input.changeType);
    const taskId = safeText(input.taskId, 100);
    if (!/^\d{12,40}$/.test(taskId)) throw new Error("请输入有效的 LibTV TaskID");
    const createdAt = isoNow();
    const createdDate = shanghaiDateParts(createdAt);
    const dailySequence = [...jobs.values()].filter((item) => {
      if (!owned(item)) return false;
      const date = shanghaiDateParts(item.createdAt);
      return date.year === createdDate.year && date.month === createdDate.month && date.day === createdDate.day;
    }).length + 1;
    const jobId = uid("remake");
    const job = {
      id: jobId,
      workflow: "remake",
      taskName: safeText(input.taskName, 200) || defaultRemakeTaskName(createdAt, dailySequence),
      canvasIdentity: {
        schemaVersion: "one-click-remake-canvas-v1",
        key: jobId
      },
      createdAt,
      updatedAt: createdAt,
      status: "auditing",
      stage: "queued",
      progress: 0,
      message: "任务已进入后台拆解队列",
      error: "",
      errorCode: "",
      errorDetails: null,
      libtvOwner: { key: owner.key, userId: owner.userId || "", name: owner.name || "" },
      changeType: clone(selectedType),
      imagePromptCategory: clone(imagePromptCategory(selectedType)),
      source: { ...source, taskId },
      canvas: null,
      sourceProduct: null,
      sourceProductMatch: null,
      variantPrompts: {},
      audit: null,
      targets: [],
      replacementAssets: [],
      backgroundFirstFrameOverride: null,
      timings: { auditMs: 0, archiveMs: 0, snapshotRestoreMs: 0, mappingMs: 0, promptCompileMs: 0, imageGenerateMs: 0, videoGenerateMs: 0 },
      events: []
    };
    addEvent(job, "queued", "任务已进入后台拆解队列");
    jobs.set(job.id, job);
    return job;
  }

  function bindCollectedSource(job, recipe, historyRecipeId = recipe.id) {
    job.historyRecipeId = historyRecipeId;
    job.sourceArchive = {
      recipeId: recipe.sourceRecipeId || recipe.id,
      caseStage: "source_ready",
      archivedAt: recipe.createdAt || "",
      ownerKey: recipe.ownerKey || "",
      ownerName: recipe.ownerName || recipe.createdBy || "",
      createdBy: recipe.createdBy || "",
      createdAt: recipe.createdAt || "",
      title: recipe.title || "",
      tags: clone(recipe.tags || []),
      titleUpdatedAt: recipe.titleUpdatedAt || "",
      titleUpdatedBy: recipe.titleUpdatedBy || "",
      storage: clone(recipe.storage || {})
    };
    addEvent(job, "source_snapshot_queued", COLLECTED_TEMPLATE_MESSAGE);
    return job;
  }

  function reusableSourceSnapshot(recipe, selectedChangeType) {
    const source = recipe?.source || {};
    const params = source.params || recipe?.sourceSnapshot?.params;
    const prompt = safeText(source.prompt || recipe?.sourceSnapshot?.prompt || params?.prompt, 20000);
    const audit = recipe?.audit;
    return Boolean(
      params
      && prompt
      && audit
      && Array.isArray(audit.assets)
      && auditCoversSourceParams(audit, params)
      && auditSupportsChangeType(audit, selectedChangeType)
    );
  }

  function snapshotSourceProduct(recipe, source, audit) {
    if (recipe?.sourceProduct?.id) return clone(recipe.sourceProduct);
    const inferred = inferSourceProduct(
      source?.prompt,
      (audit?.assets || []).map((asset) => [asset.label, asset.role, asset.productFacts?.evidence, ...(asset.content || [])])
    );
    return inferred ? {
      id: inferred.id,
      name: inferred.name || inferred.platformName || inferred.id,
      productProfile: clone(profileFromProduct(inferred))
    } : null;
  }

  async function prepareHistoryRemakeFromSnapshot(job, recipe) {
    const restoreStartedAt = Date.now();
    const params = clone(recipe.source?.params || recipe.sourceSnapshot?.params || {});
    const prompt = safeText(recipe.source?.prompt || recipe.sourceSnapshot?.prompt || params.prompt, 20000);
    params.prompt = prompt;
    job.status = "preparing_history_remake";
    job.progress = 12;
    job.failure = null;
    job.source = {
      ...job.source,
      ...clone(recipe.source || {}),
      taskId: safeText(recipe.source?.taskId || job.source.taskId, 100),
      params,
      prompt,
      accessCheck: {
        status: "not_required",
        checkedAt: isoNow(),
        source: "shared_oss_snapshot",
        message: "历史做同款直接使用共享 OSS 拆解快照，不读取原 LibTV 画布"
      }
    };
    job.audit = {
      ...clone(reclassifyAuditForChangeType(recipe.audit || {}, job.changeType)),
      videoType: job.changeType.label,
      summary: "已从共享 OSS 拆解快照恢复上游节点结构与资产判断",
      restoredAt: isoNow(),
      restoredFromRecipeId: recipe.id
    };
    job.sourceProduct = snapshotSourceProduct(recipe, job.source, job.audit);
    job.sourceProductMatch = clone(recipe.sourceProductMatch || (job.sourceProduct ? {
      productId: job.sourceProduct.id,
      productName: job.sourceProduct.name,
      confidence: 1,
      evidence: "共享 OSS 拆解快照",
      method: "shared_snapshot",
      requiresConfirmation: false,
      candidates: []
    } : {
      productId: "",
      productName: "",
      confidence: 0,
      evidence: "",
      method: "shared_snapshot",
      requiresConfirmation: true,
      candidates: []
    }));
    job.historySnapshot = {
      recipeId: recipe.id,
      sourceRecipeId: recipe.sourceRecipeId || recipe.id,
      storageBackend: recipe.storage?.backend || "aliyun-oss+mysql",
      snapshotUrl: recipe.storage?.snapshotUrl || "",
      restoredAt: isoNow(),
      sourceCanvasAccessRequired: false
    };
    job.timings.snapshotRestoreMs = durationMs(restoreStartedAt);
    addEvent(job, "source_snapshot_restored", "已恢复共享 OSS 拆解快照；无需访问原 LibTV 画布");
    job.progress = 55;
    await save(job);
    await ensureTaskCanvas(job);
    const variantStartedAt = Date.now();
    await compileInitialVariantPrompts(job);
    job.timings.promptCompileMs = durationMs(variantStartedAt);
    job.status = "awaiting_configuration";
    job.progress = 100;
    job.error = "";
    job.errorCode = "";
    addEvent(job, "source_ready", `共享拆解快照已就绪；当前账号的任务画布已创建${job.sourceProduct ? `，原片产品识别为“${job.sourceProduct.name}”` : "，请先确认原片产品"}`);
    await save(job);
    return job;
  }

  async function createJob(input = {}, options = {}) {
    const source = parseCanvasUrl(input.canvasUrl);
    const collected = await findCollectedSource(source, input.taskId, options);
    const job = newJob(input, source);
    let reusableRecipe = null;
    if (collected) {
      const sourceRecipe = collected.sourceRecipeId
        ? await findRecipe(collected.sourceRecipeId, { allowAnyOwner: options.allOwners === true }) || collected
        : collected;
      bindCollectedSource(job, sourceRecipe);
      reusableRecipe = sourceRecipe;
    }
    const canReuseSnapshot = Boolean(reusableRecipe && reusableSourceSnapshot(reusableRecipe, job.changeType));
    if (canReuseSnapshot) {
      job.status = "preparing_history_remake";
      job.message = "已找到相同来源，正在直接恢复共享 OSS 拆解快照";
    }
    await save(job);
    runInJobContext(job, async () => {
      if (!canReuseSnapshot) {
        await inspectAudit(job);
        return;
      }
      try {
        await prepareHistoryRemakeFromSnapshot(job, reusableRecipe);
      } catch (error) {
        recordJobFailure(job, "history_remake_failed", error);
        await save(job);
      }
    }).catch(() => {});
    return publicJob(job);
  }

  function productById(id) {
    return getProducts().find((item) => String(item.id) === String(id));
  }

  async function compileTargetTextAssetsWithModel(job, sourceProduct, targetProduct, voiceover = "") {
    const sourceAssets = (job.audit?.assets || []).filter((asset) => asset.mediaType === "text");
    const products = getProducts();
    const baseline = new Map(compileTargetTextAssets(sourceAssets, sourceProduct, targetProduct, products)
      .map((item) => [item.sourceNodeKey, item]));
    if (!sourceAssets.length || !qwen?.completeJson || (!job.changeType?.changesProduct && !job.changeType?.changesVoiceover)) {
      return [...baseline.values()].map((item) => ({
        ...item,
        compilerModel: sourceAssets.length ? "deterministic-rules" : "",
        conflictPolicyVersion: TEXT_CONFLICT_POLICY_VERSION
      }));
    }
    return runPool(sourceAssets, 2, async (asset) => {
      const fallback = baseline.get(asset.nodeKey);
      if (fallback.conflicts.length) return {
        ...fallback,
        compilerModel: "deterministic-rules",
        conflictPolicyVersion: TEXT_CONFLICT_POLICY_VERSION
      };
      if (!shouldCompileTextAssetWithModel({
        asset,
        sourceProduct,
        products,
        changeType: job.changeType,
        voiceover
      })) {
        return {
          ...fallback,
          compilerModel: "deterministic-product-evidence-gate",
          conflictPolicyVersion: TEXT_CONFLICT_POLICY_VERSION,
          warnings: ["源文本未包含明确产品身份、包装形态或产品专属操作，已原样复用"]
        };
      }
      try {
        const response = await qwen.completeJson(textAssetCompilerMessages({
          asset,
          sourceProduct,
          targetProduct,
          changeType: job.changeType,
          voiceover
        }), { temperature: 0, maxTokens: 4000 });
        const result = response.result || {};
        const content = (Array.isArray(result.content) ? result.content : typeof result.content === "string" ? [result.content] : [])
          .map((item) => String(item ?? "").slice(0, 50000));
        const requiredReferences = promptNodeKeys((asset.content || []).join("\n"));
        const returnedReferences = promptNodeKeys(content.join("\n"));
        if (content.length !== (asset.content || []).length || requiredReferences.some((nodeKey) => !returnedReferences.includes(nodeKey))) {
          return {
            ...fallback,
            compilerModel: "deterministic-fallback",
            compilerWarning: "模型改写未保持文本条数或 nodeKey 引用，已回退确定性 SKU 名称替换"
          };
        }
        const targetIdentity = targetProductIdentity(targetProduct);
        const staleSourceMentions = sourceProductMentions(content.join("\n"), sourceProduct, targetIdentity);
        const unexpectedProducts = mentionedProducts(content.join("\n"), products)
          .filter((item) => targetIdentity.id && item.id !== String(targetIdentity.id));
        if (staleSourceMentions.length || unexpectedProducts.length) {
          return {
            ...fallback,
            compilerModel: "deterministic-fallback",
            compilerWarning: `模型改写仍存在 SKU 残留或混入，已回退确定性版本：${[
              ...staleSourceMentions,
              ...unexpectedProducts.map((item) => item.name)
            ].join("、")}`
          };
        }
        const grounded = groundModelTextConflicts({
          asset,
          sourceProduct,
          products,
          conflicts: result.conflicts
        });
        const modelConflicts = grounded.conflicts;
        const rewritten = JSON.stringify(content) !== JSON.stringify(asset.content || []);
        return {
          ...fallback,
          content,
          status: modelConflicts.length ? "conflict" : rewritten ? "rewritten" : "reused",
          rewritten,
          replacements: clone(Array.isArray(result.replacements) ? result.replacements : fallback.replacements || []),
          conflicts: modelConflicts,
          warnings: [
            ...clone(Array.isArray(result.warnings) ? result.warnings : []),
            ...grounded.warnings
          ],
          conflictPolicyVersion: TEXT_CONFLICT_POLICY_VERSION,
          compilerModel: response.model || qwen?.status?.()?.model || "qwen3.7-plus"
        };
      } catch (error) {
        return {
          ...fallback,
          compilerModel: "deterministic-fallback",
          conflictPolicyVersion: TEXT_CONFLICT_POLICY_VERSION,
          compilerWarning: `文本节点语义改写暂不可用，已使用确定性 SKU 名称替换：${failureReason(error)}`
        };
      }
    });
  }

  async function ensureTargetTextAssetsReady(job, target) {
    const sourceTextAssets = (job.audit?.assets || []).filter((asset) => asset.mediaType === "text");
    if (!sourceTextAssets.length) return;
    const current = Array.isArray(target.upstreamTextAssets) ? target.upstreamTextAssets : [];
    const isReady = sourceTextAssets.every((asset) => {
      const transform = current.find((item) => String(item.sourceNodeKey) === String(asset.nodeKey));
      return transform
        && transform.compilerModel
        && transform.conflictPolicyVersion === TEXT_CONFLICT_POLICY_VERSION;
    });
    if (!isReady) {
      const sourceProduct = productById(job.sourceProduct?.id) || job.sourceProduct || {};
      const targetProduct = productById(target.productId) || { id: target.productId, name: target.productName };
      target.upstreamTextAssets = await compileTargetTextAssetsWithModel(
        job,
        sourceProduct,
        targetProduct,
        target.voiceover || ""
      );
      target.upstreamAssetManifest = buildUpstreamAssetManifest(job.audit?.assets || [], target);
      addEvent(job, "upstream_text_validated", `${target.productName} 的上游文本已完成目标 SKU 改写与冲突复核`, {
        targetId: target.id,
        textAssetCount: target.upstreamTextAssets.length
      });
      await save(job);
    }
    assertNoTextAssetConflicts(target);
  }

  function confirmTargetTextAssets(job, target, input = {}) {
    const transforms = clone(Array.isArray(target.upstreamTextAssets) ? target.upstreamTextAssets : []);
    const submitted = input.textAssets && typeof input.textAssets === "object" ? input.textAssets : {};
    const knownNodeKeys = new Set(transforms.map((item) => String(item.sourceNodeKey || "")));
    const unknownNodeKey = Object.keys(submitted).find((nodeKey) => !knownNodeKeys.has(String(nodeKey)));
    if (unknownNodeKey) throw new Error(`上游文本节点不存在：${unknownNodeKey}`);
    const sourceProduct = productById(job.sourceProduct?.id) || job.sourceProduct || {};
    const targetProduct = productById(target.productId) || { id: target.productId, name: target.productName };
    const targetIdentity = targetProductIdentity(targetProduct);
    const products = getProducts();
    const confirmedAt = isoNow();
    for (const transform of transforms) {
      const sourceNodeKey = String(transform.sourceNodeKey || "");
      const previousContent = Array.isArray(transform.content) ? transform.content.map(String) : [];
      const hasSubmission = Object.prototype.hasOwnProperty.call(submitted, sourceNodeKey);
      const content = hasSubmission ? submitted[sourceNodeKey] : previousContent;
      if (!Array.isArray(content) || content.length !== previousContent.length || !content.length) {
        throw new Error(`${transform.sourceLabel || sourceNodeKey} 的文本内容条数必须保持为 ${previousContent.length}`);
      }
      const normalizedContent = content.map((item) => String(item ?? ""));
      if (normalizedContent.some((item) => item.length > 50000)) {
        throw new Error(`${transform.sourceLabel || sourceNodeKey} 的单条文本不能超过 50000 字符`);
      }
      if (normalizedContent.every((item) => !item.trim())) {
        throw new Error(`${transform.sourceLabel || sourceNodeKey} 的文本内容不能为空`);
      }
      const sourceContent = Array.isArray(transform.sourceContent) ? transform.sourceContent : previousContent;
      const requiredReferences = promptNodeKeys(sourceContent.join("\n"));
      const confirmedReferences = promptNodeKeys(normalizedContent.join("\n"));
      const missingReferences = requiredReferences.filter((nodeKey) => !confirmedReferences.includes(nodeKey));
      if (missingReferences.length) {
        throw new Error(`${transform.sourceLabel || sourceNodeKey} 不能删除原 nodeKey 引用：${missingReferences.join("、")}`);
      }
      const staleSourceMentions = sourceProductMentions(normalizedContent.join("\n"), sourceProduct, targetIdentity);
      if (staleSourceMentions.length) {
        throw new Error(`${transform.sourceLabel || sourceNodeKey} 的人工修改仍残留原片 SKU：${staleSourceMentions.join("、")}`);
      }
      const unexpectedProducts = mentionedProducts(normalizedContent.join("\n"), products)
        .filter((item) => targetIdentity.id && item.id !== String(targetIdentity.id));
      if (unexpectedProducts.length) {
        throw new Error(`${transform.sourceLabel || sourceNodeKey} 的人工修改混入其他 SKU：${unexpectedProducts.map((item) => item.name).join("、")}`);
      }
      const userEdited = JSON.stringify(normalizedContent) !== JSON.stringify(previousContent);
      const previousConflicts = clone(transform.conflicts || []);
      transform.content = normalizedContent;
      transform.status = JSON.stringify(normalizedContent) === JSON.stringify(sourceContent) ? "reused" : "rewritten";
      transform.rewritten = transform.status === "rewritten";
      transform.conflicts = userEdited ? [] : clone(transform.conflicts || []);
      if (userEdited && previousConflicts.length) transform.resolvedConflicts = previousConflicts;
      transform.confirmedAt = confirmedAt;
      transform.confirmedByUser = true;
      transform.confirmationSource = userEdited ? "user_edited" : "user_confirmed_auto_draft";
      transform.userEdited = userEdited;
      if (userEdited) {
        transform.replacements = sourceProductMentions(sourceContent.join("\n"), sourceProduct, targetIdentity)
          .map((alias) => ({ from: alias, to: targetIdentity.name, reason: "用户确认的目标 SKU 文本" }));
      }
    }
    const result = { transforms, confirmedAt, editedCount: transforms.filter((item) => item.userEdited).length };
    assertNoTextAssetConflicts({ ...target, upstreamTextAssets: transforms });
    return result;
  }

  async function autofillMappingActionResolutions(mappingPlan, context = {}) {
    const mappings = (mappingPlan?.mappings || []).filter((mapping) => mapping.requiresActionResolution);
    if (!mappings.length) return mappingPlan;
    await runPool(mappings, 2, async (mapping) => {
      const sourceAsset = (context.sourceAssets || [])
        .find((asset) => String(asset.nodeKey) === String(mapping.sourceNodeKey)) || {};
      const targetAsset = (mapping.targetAssetCandidates || [])
        .find((asset) => String(asset.id) === String(mapping.targetAssetId)) || null;
      const fallbackDraft = mapping.actionResolution || buildActionResolutionDraft({
        sourceProduct: context.sourceProduct,
        targetProduct: context.targetProduct,
        sourceFacts: mapping.sourceFacts,
        targetState: mappingPlan.selectedState,
        targetAsset,
        action: mapping.risk?.action
      });
      mapping.actionResolution = fallbackDraft;
      mapping.actionResolutionSource = fallbackDraft ? "rule_fallback" : "";
      mapping.actionResolutionModel = "";
      mapping.actionResolutionGeneratedAt = fallbackDraft ? isoNow() : "";
      if (!fallbackDraft || typeof qwen?.completeJson !== "function") return;
      try {
        const response = await qwen.completeJson(actionResolutionMessages({
          sourceProduct: {
            id: context.sourceProduct?.id || "",
            name: context.sourceProduct?.name || context.sourceProduct?.platformName || "",
            productProfile: profileFromProduct(context.sourceProduct || {})
          },
          sourceAsset: {
            nodeKey: mapping.sourceNodeKey,
            label: mapping.sourceLabel,
            role: mapping.sourceRole,
            url: sourceAsset.url || "",
            width: sourceAsset.width || 0,
            height: sourceAsset.height || 0,
            facts: mapping.sourceFacts
          },
          targetProduct: {
            id: context.targetProduct?.id || "",
            name: context.targetProduct?.name || context.targetProduct?.platformName || "",
            productProfile: profileFromProduct(context.targetProduct || {})
          },
          targetState: {
            ...clone(mappingPlan.selectedState || {}),
            assets: undefined
          },
          targetAsset,
          risk: mapping.risk,
          sourcePrompt: context.sourcePrompt,
          fallbackDraft
        }), { temperature: 0, maxTokens: 1600 });
        const generated = safeText(response?.result?.actionResolution, 3000);
        if (!validActionResolutionDraft(generated, { targetProduct: context.targetProduct, targetAsset })) return;
        mapping.actionResolution = generated;
        mapping.actionResolutionSource = "model_generated";
        mapping.actionResolutionModel = response.model || qwen.status?.().model || "";
        mapping.actionResolutionGeneratedAt = isoNow();
      } catch {
        mapping.actionResolutionWarning = "模型细化暂不可用，已使用规则草稿。";
      }
    });
    return mappingPlan;
  }

  function rebuildPreparedMappings(job) {
    const sourceProduct = productById(job.sourceProduct?.id) || job.sourceProduct || {};
    const rebuilt = (job.targets || []).map((target) => {
      const product = productById(target.productId);
      if (!product) throw new Error(`目标 SKU 不存在：${target.productId || "未选择"}`);
      const allAssets = mappingProductAssets(product.id);
      const mappingPlan = buildMappingPlan({
        sourceAssets: job.audit?.assets || [],
        sourceProduct,
        targetProduct: product,
        targetStateId: target.displayStateId,
        targetAssets: allAssets,
        selectedAssetIds: target.assetIds || [],
        sourcePrompt: job.source?.prompt || ""
      });
      return { target, mappingPlan };
    });
    for (const { target, mappingPlan } of rebuilt) {
      target.mappingPlan = mappingPlan;
      target.displayState = clone(mappingPlan.selectedState);
      target.dataGapReport = clone(mappingPlan.dataGapReport || []);
      target.status = "awaiting_mapping_confirmation";
      target.mappingConfirmedAt = "";
    }
  }

  async function syncCorrectedSourceAudit(job) {
    if (!job.sourceArchive) return;
    const recipe = {
      ...sourceAuditRecipe(job),
      storage: clone(job.sourceArchive.storage || pendingRecipeStorage())
    };
    const stored = await syncRecipe(recipe, { forceSnapshotUpload: true });
    job.sourceArchive = {
      ...job.sourceArchive,
      recipeId: stored.id,
      caseStage: stored.caseStage,
      correctedAt: isoNow(),
      storage: clone(stored.storage || {})
    };
  }

  async function updateProductPresence(id, input = {}) {
    const job = requireJob(id);
    if (!["awaiting_configuration", "awaiting_mapping_confirmation"].includes(job.status)) {
      throw new Error("仅可在生成映射或候选图之前修正关键帧是否含原产品");
    }
    if (job.changeType?.changesProduct !== true) throw new Error("当前任务不包含换品，无需修正产品存在性");
    const nodeKey = safeText(input.nodeKey, 240);
    const decision = safeText(input.decision, 20);
    if (!nodeKey || !["replace", "reuse"].includes(decision)) throw new Error("请选择“需要换品”或“直接复用”");
    const asset = (job.audit?.assets || []).find((item) => item.nodeKey === nodeKey);
    if (!asset) throw new Error("待修正的源图片节点不存在");
    if (asset.mediaType !== "image") throw new Error("只有源图片节点需要判断是否含原产品");
    const previousDecision = asset.productBearing === true ? "replace" : "reuse";
    Object.assign(asset, applyProductPresenceDecision(asset, decision, { source: "human" }));
    job.audit.schemaVersion = "one-click-remake-audit-v7";
    job.audit.productPresenceReviewedAt = isoNow();
    if (job.status === "awaiting_mapping_confirmation") rebuildPreparedMappings(job);
    addEvent(job, "product_presence_corrected", `${asset.label || asset.nodeKey} 已人工确认${decision === "replace" ? "含原产品，需要换品" : "不含原产品，按其他变更或源图复用"}`, {
      nodeKey,
      previousDecision,
      decision
    });
    await save(job);
    await syncCorrectedSourceAudit(job);
    await save(job);
    return publicJob(job);
  }

  async function updateProductGeometryReview(id, input = {}) {
    const job = requireJob(id);
    if (job.status !== "awaiting_mapping_confirmation") {
      throw new Error("仅可在产品形态与节点映射确认阶段核实源图数量");
    }
    if (job.changeType?.changesProduct !== true) throw new Error("当前任务不包含换品，无需核实产品实例");
    const nodeKey = safeText(input.nodeKey, 240);
    const action = safeText(input.action, 60);
    if (!nodeKey || !["confirm_reliable_instances", "reanalyze"].includes(action)) {
      throw new Error("请选择人工确认可靠实例或重新识别数量与槽位");
    }
    const asset = (job.audit?.assets || []).find((item) => item.nodeKey === nodeKey);
    if (!asset || asset.mediaType !== "image") throw new Error("待核实的源图片节点不存在");
    if (asset.productBearing !== true || !asset.productFacts) {
      throw new Error("该源图尚未确认含原产品，请先在阶段 02 核实是否需要换品");
    }
    const before = sourceGeometryReview(asset);
    let model = "";
    if (action === "confirm_reliable_instances") {
      if (before.reliableInstanceCount < 1) {
        throw new Error("当前没有可靠产品实例框，不能直接确认；请先重新识别数量与槽位");
      }
      asset.productFacts.productCount = before.reliableInstanceCount;
      asset.productFacts.countConfidence = 1;
      asset.productFacts.evidence = [
        safeText(asset.productFacts.evidence, 1800),
        `人工审核确认按 ${before.reliableInstanceCount} 个可靠实例逐槽位替换。`
      ].filter(Boolean).join("；");
      model = "human-confirmed";
    } else {
      if (typeof qwen?.completeJson !== "function") throw new Error("单图重新识别服务当前不可用");
      const sourceProduct = productById(job.sourceProduct?.id) || job.sourceProduct || null;
      const response = await qwen.completeJson(productPresenceReviewMessages({
        asset,
        prompt: job.source?.prompt || "",
        nodeContext: nodePromptContext(job.source?.prompt || "", nodeKey),
        signals: [
          before.status === "count_conflict"
            ? `审计观察数量 ${before.observedCount} 与可靠实例框 ${before.reliableInstanceCount} 不一致`
            : "当前没有可供 OpenCV 使用的可靠产品实例框",
          "需要重新逐个定位所有可见源产品并返回一致的数量与 bbox"
        ],
        sourceProduct: sourceProduct ? {
          id: sourceProduct.id || "",
          name: sourceProduct.name || sourceProduct.platformName || "",
          aliases: productAliases(sourceProduct)
        } : null,
        referenceUrls: sourceProductReferenceUrls(sourceProduct)
      }), { temperature: 0, maxTokens: 1800 });
      const evidence = response?.result || {};
      if (evidence.productBearing !== true) {
        throw new Error("重新识别没有确认源图中存在原产品；请先在阶段 02 人工核实是否需要换品");
      }
      const reviewed = applyProductPresenceDecision(asset, "replace", {
        source: "secondary_model",
        evidence,
        model: response.model || qwen?.status?.()?.model || "qwen3.7-plus",
        needsHumanReview: true,
        signals: ["OpenCV 数量与可靠实例冲突后重新识别"]
      });
      const reliableInstances = sourceGeometryReview(reviewed).reliableInstanceCount;
      if (reliableInstances < 1) throw new Error("重新识别仍未返回可靠产品实例框，请人工查看源图后再次处理");
      if (!(Number.isInteger(Number(evidence.productCount)) && Number(evidence.productCount) > 0)) {
        reviewed.productFacts.productCount = reliableInstances;
      }
      Object.assign(asset, reviewed);
      model = response.model || qwen?.status?.()?.model || "qwen3.7-plus";
    }
    const after = sourceGeometryReview(asset);
    asset.productGeometryReview = {
      status: after.status,
      observedCount: after.observedCount,
      reliableInstanceCount: after.reliableInstanceCount,
      decisionSource: action === "confirm_reliable_instances" ? "human" : "single_image_model",
      model,
      reviewedAt: isoNow()
    };
    rebuildPreparedMappings(job);
    addEvent(job, "product_geometry_reviewed", after.requiresReview
      ? `${asset.label || nodeKey} 已重新识别，但数量与可靠实例仍需人工核实`
      : `${asset.label || nodeKey} 的产品数量与 ${after.reliableInstanceCount} 个可靠实例已核实一致`, {
      nodeKey,
      action,
      before,
      after
    });
    await save(job);
    await syncCorrectedSourceAudit(job);
    await save(job);
    return publicJob(job);
  }

  function inferSourceProduct(...values) {
    const text = values.flat(Infinity).filter(Boolean).join("\n").toLowerCase();
    let best = null;
    let bestLength = 0;
    for (const product of getProducts()) {
      const profile = profileFromProduct(product) || {};
      const names = [
        product.name, product.platformName, product.shortName,
        profile.formalName, profile.platformName, profile.shortName,
        ...(Array.isArray(profile.aliases) ? profile.aliases : [])
      ].map((item) => safeText(item, 200).toLowerCase()).filter((item) => item.length >= 2);
      const matched = names.filter((name) => text.includes(name)).sort((left, right) => right.length - left.length)[0];
      if (matched && matched.length > bestLength) {
        best = product;
        bestLength = matched.length;
      }
    }
    return best;
  }

  function identifySourceProduct(...values) {
    const text = values.flat(Infinity).filter(Boolean).join("\n").toLowerCase();
    let best = null;
    let evidence = "";
    for (const product of getProducts()) {
      const matched = productAliases(product).find((alias) => text.includes(alias.toLowerCase()));
      if (!matched || matched.length <= evidence.length) continue;
      best = product;
      evidence = matched;
    }
    return best ? {
      product: best,
      confidence: evidence.length >= 4 ? 0.98 : 0.82,
      evidence,
      requiresConfirmation: evidence.length < 4
    } : { product: null, confidence: 0, evidence: "", requiresConfirmation: true };
  }

  async function recommendSourceProductVisually(job) {
    if (job.changeType?.changesProduct !== true || typeof extractSourceProductFrames !== "function" || !qwen?.completeJson) {
      return { candidates: [], warning: "", frameCount: 0, model: "" };
    }
    try {
      job.message = "正在从原视频抽取代表帧并与 SKU 真值图进行视觉比对";
      job.progress = Math.max(Number(job.progress || 0), 76);
      await save(job);
      const sourceFrames = await extractSourceProductFrames({
        jobId: job.id,
        videoUrl: job.source.resultUrl,
        outputDir: path.join(outputRoot, job.id, "source-product-visual")
      });
      const products = getProducts();
      const productCatalog = products.map((product) => {
        const profile = profileFromProduct(product) || {};
        const references = selectProductVisualReferences(
          productWorkflows.listAssets({ productId: product.id, assetType: "image" }),
          product,
          3
        );
        return {
          id: String(product.id),
          name: product.name || product.platformName || String(product.id),
          aliases: productAliases(product),
          visualIdentity: safeText(profile.contentIdentity || profile.visualIdentity || profile.usage, 1600),
          layers: Array.isArray(profile.packageHierarchy) ? profile.packageHierarchy : [],
          references
        };
      }).filter((product) => product.references.length > 0);
      if (!sourceFrames?.length || !productCatalog.length) {
        return { candidates: [], warning: "原视频代表帧或 SKU 真值图不足，已保留文字匹配和人工确认", frameCount: sourceFrames?.length || 0, model: "" };
      }
      const response = await qwen.completeJson(visualProductMatchMessages({
        sourceFrames,
        productCatalog,
        sourcePrompt: job.source.prompt
      }), { temperature: 0, maxTokens: 3500 });
      return {
        candidates: normalizeVisualProductCandidates(response.result || {}, products),
        warning: safeText(response.result?.noMatchReason, 1000),
        frameCount: sourceFrames.length,
        model: response.model || qwen?.status?.()?.model || "qwen3.7-plus"
      };
    } catch (error) {
      return {
        candidates: [],
        warning: `原视频与 SKU 真值图视觉比对暂不可用：${safeText(error?.message || error, 1000)}`,
        frameCount: 0,
        model: qwen?.status?.()?.model || "qwen3.7-plus"
      };
    }
  }

  async function ensureTaskCanvas(job) {
    if (job.canvas?.projectId && job.canvas?.canvasUrl) return job.canvas;
    const canvasName = taskCanvasName(job);
    const targetWorkspaceId = job.historySnapshot?.sourceCanvasAccessRequired === false
      ? "0"
      : safeText(job.source.spaceId, 40);
    const lookup = async () => {
      const listed = await executeCli(
        ["project", "list", "--name", canvasName, "-w", targetWorkspaceId, "-s", "10"],
        job,
        "核对任务共享画布失败"
      );
      const matches = exactLibtvProjects(listed, canvasName);
      return { project: matches[0] || null, matchCount: matches.length };
    };
    const attachCanvas = async (projectId, resolutionSource, matchCount = 0, project = {}) => {
      const resolvedAt = isoNow();
      job.canvas = {
        canvasName,
        projectId,
        workspaceId: targetWorkspaceId,
        canvasUrl: targetWorkspaceId === "0"
          ? `https://www.liblib.tv/canvas?projectId=${projectId}`
          : `https://www.liblib.tv/canvas?spaceId=${targetWorkspaceId}&projectId=${projectId}`,
        createdAt: safeText(project.createdAt || project.createAt, 80) || resolvedAt
      };
      job.canvasResolution = {
        source: resolutionSource,
        matchCount,
        resolvedAt
      };
      const recovered = resolutionSource !== "create_response";
      addEvent(job, "task_canvas_ready", recovered
        ? `已恢复同名任务共享画布：${canvasName}${matchCount > 1 ? `（发现 ${matchCount} 个历史同名画布，采用最近更新项）` : ""}`
        : `任务共享画布已创建：${canvasName}`);
      await save(job);
      return job.canvas;
    };

    addEvent(job, "creating_task_canvas", `正在核对任务“${job.taskName}”的共享 LibTV 画布`);
    await save(job);
    const existing = await lookup();
    if (existing.project) {
      return attachCanvas(libtvProjectId(existing.project), "preexisting_lookup", existing.matchCount, existing.project);
    }

    addEvent(job, "creating_task_canvas", `正在为任务“${job.taskName}”创建共享 LibTV 画布`);
    await save(job);
    const parsed = await executeCli(["project", "create", canvasName, "-w", targetWorkspaceId], job, "创建任务共享画布失败");
    const createdProjectId = libtvProjectId(parsed);
    if (createdProjectId) return attachCanvas(createdProjectId, "create_response");

    const recovered = await lookup();
    if (recovered.project) {
      return attachCanvas(libtvProjectId(recovered.project), "post_create_lookup", recovered.matchCount, recovered.project);
    }
    throw new Error("LibTV 已返回画布创建成功，但创建响应与按名称回查均未提供 projectId；可安全重试，系统会先恢复同名画布，避免重复创建");
  }

  async function compileVariantPrompt(job, product) {
    const sourceProduct = productById(job.sourceProduct?.id) || null;
    const targetName = product.name || product.platformName || product.id;
    const sourcePrompt = safeText(job.source.prompt, 20000);
    const requiredNodeKeys = promptNodeKeys(sourcePrompt);
    let result = null;
    let compilerModel = "deterministic-fallback";
    let compilerError = "";
    if (qwen?.completeJson) {
      try {
        const response = await qwen.completeJson(videoPromptCompilerMessages({
          changeType: job.changeType,
          product,
          sourceProduct,
          sourcePrompt,
          replacementReferences: []
        }), { temperature: 0, maxTokens: 6000 });
        result = response.result || {};
        compilerModel = response.model || qwen?.status?.()?.model || "qwen3.7-plus";
      } catch (error) {
        compilerError = failureReason(error);
      }
    }
    let prompt = safeText(result?.prompt, 40000);
    const missingNodeKeys = requiredNodeKeys.filter((nodeKey) => !promptNodeKeys(prompt).includes(nodeKey));
    const instructionLeaks = videoPromptAssetInstructionLeaks(prompt);
    if (!prompt || missingNodeKeys.length || instructionLeaks.length) {
      prompt = replaceSourceProductAliases(sourcePrompt, sourceProduct || {}, product);
      compilerModel = "deterministic-fallback";
      if (missingNodeKeys.length) compilerError = `编译结果缺少源节点引用：${missingNodeKeys.join("、")}`;
      if (instructionLeaks.length) compilerError = `编译结果混入上游资产指令：${instructionLeaks.join("、")}`;
    }
    prompt = replaceSourceProductAliases(prompt, sourceProduct || {}, product);
    const staleMentions = sourceProductMentions(prompt, sourceProduct || {}, product);
    if (staleMentions.length) throw new Error(`${targetName} 的 variant_prompt 仍残留源产品：${staleMentions.join("、")}`);
    return {
      sourcePrompt,
      variantPrompt: prompt,
      compiled: prompt,
      compilerModel,
      compilerError,
      replacements: clone(result?.replacements || []),
      warnings: [
        ...clone(result?.warnings || []),
        ...(compilerError ? [`已启用确定性最小替换：${compilerError}`] : [])
      ],
      sourceProductMentions: staleMentions,
      promptDiff: {
        sourceProductId: sourceProduct?.id || "",
        sourceProductName: sourceProduct?.name || sourceProduct?.platformName || "",
        targetProductId: product.id,
        targetProductName: targetName,
        replacements: clone(result?.replacements || []),
        sourceLength: sourcePrompt.length,
        variantLength: prompt.length
      },
      compiledAt: isoNow()
    };
  }

  async function compileInitialVariantPrompts(job) {
    if (!job.changeType.changesProduct) return;
    const products = getProducts().filter((product) => String(product.id) !== String(job.sourceProduct?.id || ""));
    job.variantPrompts = {};
    await runPool(products, 2, async (product) => {
      job.variantPrompts[product.id] = await compileVariantPrompt(job, product);
      await save(job);
    });
  }

  async function productAssetInputs(productId, assetIds = []) {
    const product = productById(productId) || { id: productId };
    const all = rankProductAssets(productWorkflows.listAssets({ productId, assetType: "image" }), product);
    const requested = requiredProductAssetIds(assetIds);
    const selected = all.filter((item) => requested.includes(String(item.id)));
    if (selected.length !== requested.length) throw new Error("选择的产品资产图不存在或不属于目标 SKU，请重新勾选");
    const urls = [];
    const records = [];
    for (const item of selected.slice(0, 12)) {
      let asset = item;
      let url = safeText(asset.storageUrl || asset.previewUrl, 5000);
      if (!/^https?:\/\//i.test(url)) {
        asset = await productWorkflows.ensureLocalAsset(asset.id);
        const credential = await gpt.acquireToken();
        url = await gpt.upload(asset.localPath, credential.token);
      }
      urls.push(url);
      records.push({
        id: asset.id,
        title: asset.title || asset.fileName || asset.id,
        fileName: asset.fileName || "",
        angleLabel: asset.angleLabel || "",
        url,
        matchScore: productAssetScore(asset, product)
      });
    }
    return { urls, records };
  }

  async function stageReplacementAssets(job, input = {}) {
    const configured = input.replacementAssets && typeof input.replacementAssets === "object"
      ? input.replacementAssets
      : {};
    const generatedBackgroundCandidateId = safeText(input.backgroundCandidateId, 240);
    const roles = [
      { id: "background", enabled: job.changeType.changesBackground === true, label: "背景" },
      { id: "person", enabled: job.changeType.changesPerson === true, label: "人物" }
    ];
    const staged = [];
    let firstFrameOverride = null;
    for (const role of roles) {
      const items = Array.isArray(configured[role.id]) ? configured[role.id].slice(0, 3) : [];
      if (role.id === "background" && generatedBackgroundCandidateId) {
        if (items.length) throw new Error("目标背景参考图请在自行上传和重新生图中二选一");
        const generated = (job.backgroundSceneGeneration?.candidates || [])
          .find((candidate) => String(candidate.id) === generatedBackgroundCandidateId);
        if (!generated?.localPath || !fs.existsSync(generated.localPath)) {
          throw new Error("选择的新背景候选图不存在，请重新选择或重新生图");
        }
        items.push({
          path: generated.localPath,
          name: `第${Math.max(1, Number(generated.round || 1))}轮背景候选${Math.max(1, Number(generated.candidateIndex || 0) + 1)}`,
          generatedCandidateId: generated.id,
          generatedRound: Math.max(1, Number(generated.round || 1)),
          generationPrompt: generated.prompt || "",
          generationModel: generated.model || ""
        });
      }
      if (role.enabled && !items.length) {
        throw new Error(role.id === "background"
          ? "请选择一张已生成的新背景图，或至少上传一张目标背景参考图"
          : `请至少上传一张目标${role.label}参考图`);
      }
      if (!role.enabled && items.length) throw new Error(`当前复刻类型不允许提交${role.label}参考图`);
      const directUploadedFirstFrame = role.id === "background"
        && role.enabled
        && usesUploadedFirstFrame(job)
        && !generatedBackgroundCandidateId;
      if (directUploadedFirstFrame && items.length !== 1) {
        throw new Error("仅换背景时，自行上传模式只接收 1 张完整新首帧");
      }
      const sourceFirstFrame = directUploadedFirstFrame ? backgroundSceneSourceAsset(job) : null;
      if (directUploadedFirstFrame && !sourceFirstFrame?.nodeKey) {
        throw new Error("源画布没有可替换的首帧图片节点");
      }
      for (let index = 0; index < items.length; index += 1) {
        const item = items[index] || {};
        const sourcePath = path.resolve(String(item.path || ""));
        const ext = path.extname(sourcePath).toLowerCase();
        if (![".png", ".jpg", ".jpeg", ".webp"].includes(ext)) throw new Error(`${role.label}参考图${index + 1}格式不支持`);
        const stat = await fsp.stat(sourcePath).catch(() => null);
        if (!stat?.isFile()) throw new Error(`${role.label}参考图${index + 1}不存在`);
        const fileName = `${String(index + 1).padStart(2, "0")}-${safeName(item.name || path.basename(sourcePath, ext), role.id)}${ext}`;
        const localPath = path.join(outputRoot, job.id, "replacement-assets", role.id, fileName);
        await fsp.mkdir(path.dirname(localPath), { recursive: true });
        await fsp.copyFile(sourcePath, localPath);
        let storageUrl = "";
        let storageKey = "";
        let storageError = "";
        if (options.sharedStorage?.enabled && typeof options.sharedStorage.uploadFile === "function") {
          try {
            const uploaded = await options.sharedStorage.uploadFile(localPath, {
              category: `one-click-remake-${role.id}-references`,
              identity: `${job.id}-${index + 1}`,
              mime: ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg"
            });
            storageUrl = safeText(uploaded?.url, 5000);
            storageKey = safeText(uploaded?.key, 1000);
          } catch (error) {
            storageError = safeText(error?.message || error, 1000);
          }
        }
        let generationUrl = storageUrl;
        if (!generationUrl && !directUploadedFirstFrame) {
          const credential = await gpt.acquireToken();
          generationUrl = await gpt.upload(localPath, credential.token);
        }
        const record = {
          id: uid(`reference-${role.id}`),
          role: role.id,
          label: safeText(item.name, 300) || (directUploadedFirstFrame ? "用户上传完整新首帧" : `${role.label}参考图${index + 1}`),
          logicalNodeKey: directUploadedFirstFrame ? "" : `ref-${role.id}-${index + 1}`,
          localPath,
          url: generationUrl,
          storageUrl,
          storageKey,
          storageBackend: storageUrl ? "aliyun-oss" : directUploadedFirstFrame ? "local-task-asset" : "generation-provider",
          storageError,
          sourceMode: directUploadedFirstFrame
            ? "user_uploaded_first_frame"
            : item.generatedCandidateId ? "generated_background_scene" : "user_upload",
          sourceCandidateId: safeText(item.generatedCandidateId, 240),
          sourceCandidateRound: Math.max(0, Number(item.generatedRound || 0)),
          generationPrompt: safeText(item.generationPrompt, 6000),
          generationModel: safeText(item.generationModel, 160),
          ...(directUploadedFirstFrame ? {
            replacesSourceNodeKey: sourceFirstFrame.nodeKey,
            replacesSourceLabel: sourceFirstFrame.label || sourceFirstFrame.nodeKey
          } : {})
        };
        if (directUploadedFirstFrame) firstFrameOverride = record;
        else staged.push(record);
      }
    }
    job.replacementAssets = staged;
    job.backgroundFirstFrameOverride = firstFrameOverride;
    if (job.changeType.changesBackground) {
      job.backgroundSceneSelection = generatedBackgroundCandidateId
        ? { mode: "generated", candidateId: generatedBackgroundCandidateId, selectedAt: isoNow() }
        : { mode: firstFrameOverride ? "uploaded_first_frame" : "upload", candidateId: "", selectedAt: isoNow() };
    }
    return staged;
  }

  function migrateStagedUserUploadToFirstFrame(job) {
    if (!usesUploadedFirstFrame(job) || job.backgroundFirstFrameOverride) return false;
    const uploadedBackgrounds = (job.replacementAssets || []).filter((item) => item.role === "background" && item.sourceMode === "user_upload");
    if (uploadedBackgrounds.length !== 1) return false;
    const sourceFirstFrame = backgroundSceneSourceAsset(job);
    if (!sourceFirstFrame?.nodeKey) return false;
    const original = uploadedBackgrounds[0];
    job.backgroundFirstFrameOverride = {
      ...clone(original),
      logicalNodeKey: "",
      sourceMode: "user_uploaded_first_frame",
      replacesSourceNodeKey: sourceFirstFrame.nodeKey,
      replacesSourceLabel: sourceFirstFrame.label || sourceFirstFrame.nodeKey
    };
    job.replacementAssets = (job.replacementAssets || []).filter((item) => item.id !== original.id);
    job.backgroundSceneSelection = { mode: "uploaded_first_frame", candidateId: "", selectedAt: isoNow() };
    for (const target of job.targets || []) {
      target.firstFrameOverride = clone(job.backgroundFirstFrameOverride);
      target.replacementAssets = (target.replacementAssets || []).filter((item) => item.id !== original.id);
      target.assetGroups = [];
      target.selectedAssets = {};
      target.status = "compiling";
    }
    addEvent(job, "uploaded_first_frame_migrated", `已将用户上传图片改为直接替换源首帧 nodeKey：${sourceFirstFrame.nodeKey}`);
    return true;
  }

  async function download(url, destination) {
    await fsp.mkdir(path.dirname(destination), { recursive: true });
    if (gpt?.downloadFile) return gpt.downloadFile(url, destination);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`下载资产失败：HTTP ${response.status}`);
    await fsp.writeFile(destination, Buffer.from(await response.arrayBuffer()));
    return destination;
  }

  function backgroundSceneState(job) {
    job.backgroundSceneGeneration ||= {
      status: "idle",
      sourceNodeKey: "",
      sourceLabel: "",
      sourceUrl: "",
      prompt: "",
      activeRound: 0,
      rounds: [],
      candidates: [],
      pendingCandidates: [],
      error: ""
    };
    job.backgroundSceneGeneration.rounds ||= [];
    job.backgroundSceneGeneration.candidates ||= [];
    job.backgroundSceneGeneration.pendingCandidates ||= [];
    return job.backgroundSceneGeneration;
  }

  function backgroundScenePending(state, round, candidateIndex) {
    let pending = state.pendingCandidates.find((item) => (
      Number(item.round || 1) === Number(round || 1)
      && Number(item.candidateIndex || 0) === Number(candidateIndex || 0)
    ));
    if (!pending) {
      pending = {
        candidateId: uid("background-scene"),
        round,
        candidateIndex,
        taskId: "",
        model: "",
        remoteStatus: "preparing",
        remoteUrl: "",
        localPath: "",
        createdAt: isoNow(),
        updatedAt: isoNow(),
        attempts: [],
        candidate: null,
        error: ""
      };
      state.pendingCandidates.push(pending);
    }
    return pending;
  }

  async function persistBackgroundScenePending(job, pending, status, details = {}) {
    pending.remoteStatus = safeText(status, 80).toLowerCase() || pending.remoteStatus || "running";
    pending.updatedAt = isoNow();
    Object.assign(pending, details);
    await save(job);
  }

  async function completeBackgroundSceneCandidate(job, state, pending, generated) {
    const remoteUrl = safeText(generated?.url || pending.remoteUrl, 12000);
    if (!remoteUrl) throw new Error(`第 ${pending.round} 轮背景候选图 ${pending.candidateIndex + 1} 已完成，但没有结果图片地址`);
    const ext = normalizedImageExtension(remoteUrl);
    const localPath = pending.localPath || path.join(
      outputRoot,
      job.id,
      "background-scene-candidates",
      `round-${pending.round}`,
      `${safeName(pending.candidateId, "background-scene")}${ext}`
    );
    pending.taskId = safeText(generated?.taskId || pending.taskId, 300);
    pending.model = safeText(generated?.model || pending.model, 160);
    pending.remoteUrl = remoteUrl;
    pending.localPath = localPath;
    pending.remoteStatus = "downloading";
    pending.updatedAt = isoNow();
    await save(job);
    if (!fs.existsSync(localPath)) await download(remoteUrl, localPath);
    const candidate = {
      id: pending.candidateId,
      round: pending.round,
      candidateIndex: pending.candidateIndex,
      model: pending.model,
      taskId: pending.taskId,
      remoteUrl,
      localPath,
      previewUrl: `./api/one-click-remake/jobs/${encodeURIComponent(job.id)}/background-scene-candidates/${encodeURIComponent(pending.candidateId)}`,
      createdAt: pending.createdAt || isoNow(),
      prompt: state.prompt,
      effectivePrompt: state.effectivePrompt
    };
    pending.remoteStatus = "succeeded";
    pending.updatedAt = isoNow();
    pending.completedAt = pending.updatedAt;
    pending.candidate = clone(candidate);
    pending.error = "";
    const existingIndex = state.candidates.findIndex((item) => item.id === candidate.id);
    if (existingIndex >= 0) state.candidates[existingIndex] = candidate;
    else state.candidates.push(candidate);
    state.candidates.sort((left, right) => (
      Number(left.round || 1) - Number(right.round || 1)
      || Number(left.candidateIndex || 0) - Number(right.candidateIndex || 0)
    ));
    addEvent(job, "background_scene_candidate_received", `第 ${pending.round} 轮背景候选图 ${pending.candidateIndex + 1} 已回传`, {
      candidateId: candidate.id,
      candidateIndex: pending.candidateIndex,
      round: pending.round,
      taskId: pending.taskId,
      model: pending.model
    });
    await save(job);
    return candidate;
  }

  async function generateBackgroundSceneCandidate(job, state, pending) {
    const modelOrder = [...new Set([
      options.primaryImageModel || "openai/gpt-image-2",
      options.fallbackImageModel || "doubao-seedream-5-0-pro-260628"
    ])];
    let generated = null;
    let primaryError = "";
    for (let index = 0; index < modelOrder.length; index += 1) {
      try {
        generated = await gpt.generate({
          model: modelOrder[index],
          prompt: state.effectivePrompt,
          aspectRatio: job.source.settings?.ratio || "9:16",
          resolution: "2K",
          inputUrls: [state.sourceUrl],
          onTaskCreated: async ({ taskId, status, model }) => {
            pending.taskId = safeText(taskId, 300);
            pending.model = safeText(model, 160);
            pending.remoteStatus = safeText(status, 80) || "queued";
            pending.updatedAt = isoNow();
            pending.attempts ||= [];
            pending.attempts.push({
              taskId: pending.taskId,
              model: pending.model,
              status: pending.remoteStatus,
              createdAt: pending.updatedAt
            });
            await save(job);
          },
          onStatus: async ({ status, model }) => persistBackgroundScenePending(job, pending, status, {
            model: safeText(model || pending.model, 160)
          })
        });
        break;
      } catch (error) {
        pending.error = failureReason(error);
        pending.updatedAt = isoNow();
        await save(job);
        if (index === 0 && modelOrder.length > 1) {
          primaryError = error.message;
          addEvent(job, "background_scene_generation_fallback", `背景候选图 ${pending.candidateIndex + 1} 的 GPT Image 2 未返回结果，正在回退 Seedream 5.0 Pro`, {
            round: pending.round,
            candidateIndex: pending.candidateIndex,
            taskId: pending.taskId
          });
          await save(job);
        } else {
          throw new Error(primaryError
            ? `GPT Image 2 失败：${primaryError}；Seedream 5.0 Pro 回退失败：${error.message}`
            : error.message);
        }
      }
    }
    return completeBackgroundSceneCandidate(job, state, pending, generated);
  }

  async function finishBackgroundSceneRound(job, state, round, candidates) {
    if (candidates.length !== 2) throw new Error(`第 ${round} 轮仅生成 ${candidates.length}/2 张背景候选图`);
    state.rounds = state.rounds.filter((item) => Number(item.round) !== round);
    state.rounds.push({
      round,
      prompt: state.prompt,
      effectivePrompt: state.effectivePrompt,
      sourceNodeKey: state.sourceNodeKey,
      candidateIds: candidates.map((candidate) => candidate.id),
      createdAt: isoNow()
    });
    state.rounds.sort((left, right) => Number(left.round) - Number(right.round));
    state.status = "success";
    state.error = "";
    state.completedAt = isoNow();
    addEvent(job, "background_scene_generation_completed", `第 ${round} 轮已生成 2 张纯背景场景图，请选择其中 1 张；不满意可${round < MAX_BACKGROUND_SCENE_GENERATION_ROUNDS ? "再生成一轮" : "改用已上传图片"}`, {
      round,
      candidateIds: candidates.map((candidate) => candidate.id)
    });
    await save(job);
  }

  async function runBackgroundSceneGeneration(job, round) {
    const state = backgroundSceneState(job);
    try {
      state.status = "running";
      state.error = "";
      await save(job);
      const pending = [0, 1].map((candidateIndex) => backgroundScenePending(state, round, candidateIndex));
      await save(job);
      const candidates = await runPool(pending, 2, (item) => generateBackgroundSceneCandidate(job, state, item));
      await finishBackgroundSceneRound(job, state, round, candidates);
    } catch (error) {
      state.status = "failed";
      state.error = failureReason(error);
      state.completedAt = isoNow();
      addEvent(job, "background_scene_generation_failed", `背景场景图生成失败：${state.error}`,
        { round });
      await save(job);
    }
  }

  async function generateBackgroundSceneCandidates(id, input = {}) {
    const job = requireJob(id);
    if (job.status !== "awaiting_configuration") throw new Error("当前任务不在背景参考配置阶段");
    if (job.changeType?.changesBackground !== true) throw new Error("当前做同款类型不包含换背景");
    if (!gpt?.generate) throw new Error("背景生图服务尚未配置");
    const state = backgroundSceneState(job);
    if (["queued", "running"].includes(state.status)) throw new Error("背景场景图正在生成，请稍候");
    const completedRounds = Math.max(0, ...state.rounds.map((item) => Number(item.round || 0)));
    if (completedRounds >= MAX_BACKGROUND_SCENE_GENERATION_ROUNDS) {
      throw new Error("背景场景图最多生成两轮，请从已有候选中选择或自行上传");
    }
    const sourceAsset = backgroundSceneSourceAsset(job);
    if (!sourceAsset) throw new Error("源画布没有可提取的首帧图片节点，无法自动生成新背景；请自行上传背景图");
    const round = completedRounds + 1;
    const prompt = safeText(input.prompt, 6000);
    const effectivePrompt = backgroundSceneGenerationPrompt({ prompt, sourceAsset, round });
    state.status = "queued";
    state.sourceNodeKey = sourceAsset.nodeKey;
    state.sourceLabel = sourceAsset.label || sourceAsset.role || sourceAsset.nodeKey;
    state.sourceUrl = sourceAsset.url;
    state.prompt = prompt;
    state.effectivePrompt = effectivePrompt;
    state.activeRound = round;
    state.error = "";
    state.startedAt = isoNow();
    state.pendingCandidates = state.pendingCandidates.filter((item) => Number(item.round || 1) !== round);
    state.candidates = state.candidates.filter((item) => Number(item.round || 1) !== round);
    addEvent(job, "background_scene_generation_queued", `正在从画布首帧提取构图并生成第 ${round} 轮 2 张纯背景场景图`, {
      sourceNodeKey: sourceAsset.nodeKey,
      round
    });
    await save(job);
    runInJobContext(job, () => runBackgroundSceneGeneration(job, round)).catch(() => {});
    return publicJob(job);
  }

  async function resumeBackgroundSceneGeneration(job) {
    const state = backgroundSceneState(job);
    const round = Math.max(1, Number(state.activeRound || 1));
    try {
      if (typeof gpt?.waitForTask !== "function") throw new Error("当前生图适配器不支持按 TaskID 恢复背景候选图");
      state.status = "running";
      const pending = [0, 1].map((candidateIndex) => backgroundScenePending(state, round, candidateIndex));
      const candidates = await runPool(pending, 2, async (item) => {
        if (item.candidate?.localPath && fs.existsSync(item.candidate.localPath)) {
          const existing = clone(item.candidate);
          if (!state.candidates.some((candidate) => candidate.id === existing.id)) state.candidates.push(existing);
          return existing;
        }
        if (!item.taskId) throw new Error(`第 ${round} 轮背景候选图 ${item.candidateIndex + 1} 没有已保存的 TaskID，禁止自动重复提交`);
        const generated = await gpt.waitForTask(item.taskId, {
          model: item.model,
          onStatus: ({ status, model }) => persistBackgroundScenePending(job, item, status, {
            model: safeText(model || item.model, 160)
          })
        });
        return completeBackgroundSceneCandidate(job, state, item, generated);
      });
      await finishBackgroundSceneRound(job, state, round, candidates);
    } catch (error) {
      state.status = "failed";
      state.error = `服务重启后恢复失败：${failureReason(error)}`;
      state.completedAt = isoNow();
      addEvent(job, "background_scene_generation_failed", state.error, { round, recovered: true });
      await save(job);
    }
  }

  async function directProductAssetGroup(job, target, sourceAsset, productInputs) {
    const mapping = target.mappingPlan?.mappings?.find((item) => item.sourceNodeKey === sourceAsset.nodeKey);
    const matched = mapping?.targetAssetId
      ? (productInputs.records || []).find((item) => String(item.id) === String(mapping.targetAssetId))
      : null;
    if (!matched?.url) throw new Error(`${target.productName} 无法为独立产品资料节点匹配 OSS 产品图`);
    const ext = normalizedImageExtension(matched.url);
    const localPath = path.join(outputRoot, job.id, "oss-product-assets", target.id, `${safeName(sourceAsset.nodeKey)}-${safeName(matched.id)}${ext}`);
    if (!fs.existsSync(localPath)) await download(matched.url, localPath);
    const candidate = {
      id: uid("oss-product-asset"),
      sourceNodeKey: sourceAsset.nodeKey,
      sourceLabel: sourceAsset.label,
      model: "OSS 原始产品资产",
      taskId: "",
      remoteUrl: matched.url,
      localPath,
      previewUrl: `./api/one-click-remake/jobs/${encodeURIComponent(job.id)}/candidates/${encodeURIComponent(target.id)}/${encodeURIComponent(sourceAsset.nodeKey)}/0`,
      createdAt: isoNow(),
      directReuse: true,
      productAssetId: matched.id,
      preselected: true
    };
    target.selectedAssets[sourceAsset.nodeKey] = candidate.id;
    return {
      sourceNodeKey: sourceAsset.nodeKey,
      sourceLabel: sourceAsset.label,
      sourceUrl: sourceAsset.url,
      sourceMode: "oss_direct",
      matchedProductAsset: clone(matched),
      compiler: {
        category: clone(imagePromptCategoryById("direct_oss_product_asset")),
        imagePrompt: "本节点是独立产品资料图，直接使用所选 SKU 的 OSS 原始产品资产，不执行生图。",
        negativePrompt: "禁止重新生成、变形、改文字、改 logo 或补造产品。",
        scalePlan: {
          strategy: "direct_oss_product_asset",
          productAssetId: matched.id,
          target: geometryContract(target.productProfile || {}),
          mapping: clone(mapping || {})
        },
        layoutLocks: ["保留 OSS 原图的像素级产品身份与包装比例"],
        inputOrder: ["目标 SKU OSS 产品资产"],
        validationChecklist: ["资产归属所选 SKU", "未执行任何生图任务"],
        model: "deterministic-routing",
        promptSource: "built_in"
      },
      generationRounds: [{ round: 1, promptSource: "built_in", prompt: "OSS 原图直连，不执行生图", candidateIds: [candidate.id], createdAt: candidate.createdAt }],
      candidates: [candidate]
    };
  }

  function mappingInstruction(target, sourceNodeKey = "") {
    const rows = (target.mappingPlan?.mappings || []).filter((item) => !sourceNodeKey || item.sourceNodeKey === sourceNodeKey);
    const carrierProps = (target.mappingPlan?.carrierPropAssessments || []).filter((item) => !sourceNodeKey || item.sourceNodeKey === sourceNodeKey);
    const carrierRebuild = carrierRegenerationRequired(carrierProps);
    if (!rows.length && !carrierProps.length) return "";
    const instruction = [
      "【平台已确认的产品形态与承载道具策略，优先级高于自由推断】",
      ...rows.map((row) => row.processingMode === "reuse_source"
        ? carrierRebuild
          ? `${row.sourceLabel || row.sourceNodeKey}：人工确认该关键帧不含原片产品像素；不得植入任何产品，只允许按下方用户选择调整承载道具，其余人物、服装、身体状态、构图和时序保持不变。`
          : `${row.sourceLabel || row.sourceNodeKey}：该关键帧不含原片产品像素，仅用于人物、服装、身体状态、动作阶段、构图或时序参考；必须原样复用源图，不得调用生图，不得向该图植入、移除或改造任何产品。`
        : [
          `${row.sourceLabel || row.sourceNodeKey}：${row.sourceFacts?.layerLabel || row.sourceFacts?.layer || "未知源形态"} → ${row.targetStateLabel || target.displayState?.label || "目标形态"}`,
          `源视角=${row.sourceFacts?.view || "unknown"}，目标视角=${row.targetView || "unknown"}，风险=${row.risk?.label || ""}`,
          row.actionResolution ? `动作改写（必须执行）：${row.actionResolution}` : "",
          row.processingMode === "oss_direct" ? "独立资料图必须直接使用本节点已确认的目标 SKU 原始身份图，禁止重新生成。" : "候选场景图必须使用本节点已确认的目标 SKU 身份图重建。"
        ].filter(Boolean).join("；")),
      ...carrierProps.map((item) => item.decision === "regenerate_with_product"
        ? `${item.sourceLabel || item.sourceNodeKey} 的${item.label || "承载道具"}：平台已自动判定与产品在同一次生图、同一张结果中联合重构。清除原道具像素后，在原位置保持道具类别、品牌标识、材质、颜色、外观风格和人物持物动作，只调整能真实容纳目标 SKU 所需的袋体/箱体宽高、内部容积、开口、提手与接触关系；本条覆盖前文对该道具原始尺寸的保留描述，禁止只换产品而遗漏道具，禁止缩小、压扁、弯曲或旋转目标产品来迁就道具。源图没有产品像素时不得凭空加入产品。`
        : item.decision === "keep_and_rewrite"
          ? `${item.sourceLabel || item.sourceNodeKey} 的${item.label || "承载道具"}：保持源图尺寸、位置与外观不变，不得将目标 SKU 塞入、装入或从中取出，相关动作自动改为手持或画外递入。`
          : `${item.sourceLabel || item.sourceNodeKey} 的${item.label || "承载道具"}：系统判断无需尺寸适配，保持源图不变。`),
      "不得恢复源产品形态，不得跨形态补造外盒、瓶、罐、单支或内容物。"
    ].join("\n");
    return replaceSourceProductAliases(instruction, target.sourceProduct || {}, targetProductIdentity(target));
  }

  function candidatePreviewIndex(group, round, candidateIndex) {
    const previousRounds = (group.candidates || []).filter((candidate) => Number(candidate.round || 1) < Number(round || 1)).length;
    return previousRounds + Math.max(0, Number(candidateIndex || 0));
  }

  function ensurePendingCandidate(group, candidateIndex, round = 1) {
    group.pendingCandidates ||= [];
    const normalizedRound = Math.max(1, Number(round || 1));
    const normalizedIndex = Math.max(0, Number(candidateIndex || 0));
    let pending = group.pendingCandidates.find((item) => (
      Number(item.round || 1) === normalizedRound && Number(item.candidateIndex || 0) === normalizedIndex
    ));
    if (!pending) {
      pending = {
        candidateId: uid("candidate"),
        candidateIndex: normalizedIndex,
        round: normalizedRound,
        taskId: "",
        model: "",
        remoteStatus: "preparing",
        remoteUrl: "",
        localPath: "",
        createdAt: isoNow(),
        updatedAt: isoNow(),
        attempts: [],
        candidate: null,
        error: ""
      };
      group.pendingCandidates.push(pending);
    }
    return pending;
  }

  function upsertCandidate(group, candidate) {
    group.candidates ||= [];
    const index = group.candidates.findIndex((item) => item.id === candidate.id || (
      Number(item.round || 1) === Number(candidate.round || 1)
      && Number(item.candidateIndex ?? -1) === Number(candidate.candidateIndex ?? -2)
    ));
    if (index >= 0) group.candidates[index] = candidate;
    else group.candidates.push(candidate);
    group.candidates.sort((left, right) => (
      Number(left.round || 1) - Number(right.round || 1)
      || Number(left.candidateIndex || 0) - Number(right.candidateIndex || 0)
    ));
    return candidate;
  }

  async function persistPendingStatus(job, target, group, pending, status, details = {}) {
    const normalizedStatus = safeText(status, 80).toLowerCase() || pending.remoteStatus || "running";
    const statusChanged = normalizedStatus !== pending.remoteStatus;
    const heartbeatDue = Date.now() - (Date.parse(pending.lastHeartbeatAt || "") || 0) >= 15000;
    pending.remoteStatus = normalizedStatus;
    pending.updatedAt = isoNow();
    pending.lastHeartbeatAt = pending.updatedAt;
    Object.assign(pending, details);
    if (statusChanged && ["running", "succeeded", "success", "completed", "done"].includes(normalizedStatus)) {
      const completed = ["succeeded", "success", "completed", "done"].includes(normalizedStatus);
      addEvent(job, "image_generating", completed
        ? `${target.productName} / ${group.sourceLabel} 第 ${pending.round} 轮候选图 ${pending.candidateIndex + 1} 已生成，正在下载回传`
        : `${target.productName} / ${group.sourceLabel} 第 ${pending.round} 轮候选图 ${pending.candidateIndex + 1} 正在生成`, {
        targetId: target.id,
        sourceNodeKey: group.sourceNodeKey,
        candidateIndex: pending.candidateIndex,
        taskId: pending.taskId,
        status: normalizedStatus,
        model: pending.model,
        round: pending.round
      });
    }
    if (statusChanged || heartbeatDue || details.forceSave === true) await save(job);
  }

  async function completePendingCandidate(job, target, group, pending, generated) {
    const remoteUrl = safeText(generated?.url || pending.remoteUrl, 12000);
    if (!remoteUrl) throw new Error(`${target.productName} / ${group.sourceLabel} 的候选图任务已完成，但没有结果图片地址`);
    const ext = normalizedImageExtension(remoteUrl);
    const localPath = pending.localPath || path.join(
      outputRoot,
      job.id,
      "candidates",
      target.id,
      `${safeName(group.sourceNodeKey)}-r${pending.round}-${pending.candidateIndex + 1}${ext}`
    );
    pending.taskId = safeText(generated?.taskId || pending.taskId, 300);
    pending.model = safeText(generated?.model || pending.model, 160);
    pending.remoteUrl = remoteUrl;
    pending.localPath = localPath;
    pending.remoteStatus = "downloading";
    pending.updatedAt = isoNow();
    await save(job);
    if (!fs.existsSync(localPath)) await download(remoteUrl, localPath);
    const previewIndex = candidatePreviewIndex(group, pending.round, pending.candidateIndex);
    const candidate = {
      id: pending.candidateId || uid("candidate"),
      sourceNodeKey: group.sourceNodeKey,
      sourceLabel: group.sourceLabel,
      model: pending.model,
      taskId: pending.taskId,
      remoteUrl,
      localPath,
      previewUrl: `./api/one-click-remake/jobs/${encodeURIComponent(job.id)}/candidates/${encodeURIComponent(target.id)}/${encodeURIComponent(group.sourceNodeKey)}/${previewIndex}`,
      createdAt: pending.createdAt || isoNow(),
      round: pending.round,
      candidateIndex: pending.candidateIndex,
      promptSource: group.compiler?.promptSource || "built_in"
    };
    pending.remoteStatus = "succeeded";
    pending.updatedAt = isoNow();
    pending.completedAt = pending.updatedAt;
    pending.candidate = clone(candidate);
    pending.error = "";
    upsertCandidate(group, candidate);
    addEvent(job, "image_candidate_received", `${target.productName} / ${group.sourceLabel} 第 ${pending.round} 轮候选图 ${pending.candidateIndex + 1} 已回传平台`, {
      targetId: target.id,
      sourceNodeKey: group.sourceNodeKey,
      candidateIndex: pending.candidateIndex,
      taskId: pending.taskId,
      model: pending.model,
      round: pending.round
    });
    await save(job);
    return candidate;
  }

  function legacyPendingEvents(job, target) {
    const prefix = `${safeText(target.productName, 300)} 第 `;
    return (job.events || []).filter((event) => (
      event.stage === "image_generating"
      && safeText(event.details?.taskId, 300)
      && (safeText(event.details?.targetId, 160) === safeText(target.id, 160)
        || (!event.details?.targetId && safeText(event.message, 500).startsWith(prefix)))
    ));
  }

  function hydrateLegacyPendingCandidates(job, target) {
    const groups = (target.assetGroups || []).filter((group) => !isDirectAssetGroup(group));
    const legacyEvents = legacyPendingEvents(job, target);
    if (!legacyEvents.length || groups.some((group) => (group.pendingCandidates || []).length)) return;
    if (groups.length !== 1) {
      throw new Error(`${target.productName} 的旧任务保存了生图 TaskID，但没有保存节点归属，无法安全自动重提；请人工重试当前环节`);
    }
    const group = groups[0];
    const latestBySlot = new Map();
    for (const event of legacyEvents) {
      const messageIndex = safeText(event.message, 500).match(/候选图\s*(\d+)/)?.[1];
      const candidateIndex = Number.isInteger(Number(event.details?.candidateIndex))
        ? Number(event.details.candidateIndex)
        : Math.max(0, Number(messageIndex || 1) - 1);
      const round = Math.max(1, Number(event.details?.round || 1));
      latestBySlot.set(`${round}:${candidateIndex}`, { event, candidateIndex, round });
    }
    for (const { event, candidateIndex, round } of latestBySlot.values()) {
      const pending = ensurePendingCandidate(group, candidateIndex, round);
      pending.taskId = safeText(event.details?.taskId, 300);
      pending.model = safeText(event.details?.model, 160);
      pending.remoteStatus = safeText(event.details?.status, 80) || "queued";
      pending.createdAt = safeText(event.at, 80) || pending.createdAt;
      pending.updatedAt = pending.createdAt;
      pending.attempts = [{ taskId: pending.taskId, model: pending.model, status: pending.remoteStatus, createdAt: pending.createdAt, recoveredFromLegacyEvent: true }];
    }
  }

  async function resumePendingCandidate(job, target, group, pending) {
    if (pending.candidate?.localPath && fs.existsSync(pending.candidate.localPath)) {
      return upsertCandidate(group, clone(pending.candidate));
    }
    if (!pending.taskId) throw new Error(`${target.productName} / ${group.sourceLabel} 的中断候选图没有保存 TaskID，禁止自动重复生图`);
    if (typeof gpt?.waitForTask !== "function") throw new Error("当前生图适配器不支持按 TaskID 恢复候选图");
    addEvent(job, "image_task_recovering", `正在按原 TaskID 回查 ${target.productName} / ${group.sourceLabel} 候选图 ${pending.candidateIndex + 1}，不会重复生图`, {
      targetId: target.id,
      sourceNodeKey: group.sourceNodeKey,
      candidateIndex: pending.candidateIndex,
      taskId: pending.taskId,
      model: pending.model,
      round: pending.round
    });
    await save(job);
    try {
      const generated = await gpt.waitForTask(pending.taskId, {
        model: pending.model,
        onStatus: ({ status, model }) => persistPendingStatus(job, target, group, pending, status, {
          model: safeText(model || pending.model, 160)
        })
      });
      return await completePendingCandidate(job, target, group, pending, generated);
    } catch (error) {
      pending.remoteStatus = "failed";
      pending.error = failureReason(error);
      pending.updatedAt = isoNow();
      await save(job);
      throw new Error(`${target.productName} / ${group.sourceLabel} 原候选图任务 ${pending.taskId} 回查失败：${pending.error}`);
    }
  }

  async function resumePreparedTargetCandidates(job, target) {
    const groups = (target.assetGroups || []).filter((group) => !isDirectAssetGroup(group));
    if (!groups.length) return false;
    hydrateLegacyPendingCandidates(job, target);
    let resumed = false;
    for (const group of groups) {
      const pendingRows = (group.pendingCandidates || []).filter((pending) => Number(pending.round || 1) === 1);
      if (!pendingRows.length) continue;
      resumed = true;
      await runPool(pendingRows, 2, (pending) => resumePendingCandidate(job, target, group, pending));
      const firstRound = (group.candidates || []).filter((candidate) => Number(candidate.round || 1) === 1);
      if (firstRound.length !== 2) {
        throw new Error(`${target.productName} / ${group.sourceLabel} 仅恢复 ${firstRound.length}/2 张候选图，禁止自动重复生图`);
      }
      const roundRecord = (group.generationRounds || []).find((item) => Number(item.round || 1) === 1);
      if (roundRecord) roundRecord.candidateIds = firstRound.map((candidate) => candidate.id);
      else {
        group.generationRounds ||= [];
        group.generationRounds.push({
          round: 1,
          promptSource: "built_in",
          prompt: group.compiler?.imagePrompt || "",
          effectivePrompt: group.compiler?.imagePrompt || "",
          correctionPrompt: "",
          candidateIds: firstRound.map((candidate) => candidate.id),
          createdAt: isoNow()
        });
      }
    }
    if (resumed) {
      target.upstreamAssetManifest = validateUpstreamAssetManifest(job, target);
      target.status = "awaiting_confirmation";
      await save(job);
    }
    return resumed;
  }

  async function generateCandidate(job, target, group, compiler, referenceUrls, candidateIndex, round = 1) {
    const modelOrder = [options.primaryImageModel || "openai/gpt-image-2", options.fallbackImageModel || "doubao-seedream-5-0-pro-260628"];
    const pending = ensurePendingCandidate(group, candidateIndex, round);
    let generated;
    let primaryError = "";
    for (let index = 0; index < modelOrder.length; index += 1) {
      try {
        generated = await gpt.generate({
          model: modelOrder[index],
          prompt: compiler.imagePrompt,
          aspectRatio: target.aspectRatio || "9:16",
          resolution: "2K",
          inputUrls: [group.sourceUrl, ...(referenceUrls || [])],
          onTaskCreated: async ({ taskId, status, model }) => {
            pending.taskId = safeText(taskId, 300);
            pending.model = safeText(model, 160);
            pending.remoteStatus = safeText(status, 80) || "queued";
            pending.updatedAt = isoNow();
            pending.attempts ||= [];
            pending.attempts.push({ taskId: pending.taskId, model: pending.model, status: pending.remoteStatus, createdAt: pending.updatedAt });
            addEvent(job, "image_generating", `${target.productName} / ${group.sourceLabel} 第 ${round} 轮候选图 ${candidateIndex + 1} 已提交`, {
              targetId: target.id,
              sourceNodeKey: group.sourceNodeKey,
              candidateIndex,
              taskId: pending.taskId,
              status: pending.remoteStatus,
              model: pending.model,
              round
            });
            await save(job);
          },
          onStatus: async ({ status, model }) => persistPendingStatus(job, target, group, pending, status, {
            model: safeText(model || pending.model, 160)
          })
        });
        break;
      } catch (error) {
        pending.error = failureReason(error);
        pending.updatedAt = isoNow();
        await save(job);
        if (index === 0) {
          primaryError = error.message;
          addEvent(job, "image_generation_fallback", `${target.productName} / ${group.sourceLabel} 候选图 ${candidateIndex + 1} 的 GPT Image 2 未返回结果，正在回退 Seedream 5.0 Pro`, {
            targetId: target.id,
            sourceNodeKey: group.sourceNodeKey,
            candidateIndex,
            taskId: pending.taskId,
            round
          });
          await save(job);
        }
        else throw new Error(`GPT Image 2 失败：${primaryError}；Seedream 5.0 Pro 回退失败：${error.message}`);
      }
    }
    return completePendingCandidate(job, target, group, pending, generated);
  }

  function mappingProductAssets(productId) {
    return productWorkflows.listAssets({ productId, assetType: "image" }).map((asset) => ({
      ...asset,
      thumbnailUrl: `./api/product-workflows/assets/${encodeURIComponent(asset.id)}/thumbnail`
    }));
  }

  async function prepareMapping(job, input = {}) {
    const startedAt = Date.now();
    try {
      job.stageAttempts ||= {};
      job.stageAttempts.mapping = Math.max(0, Number(job.stageAttempts.mapping || 0)) + 1;
      job.failure = null;
      const submittedTargets = Array.isArray(input.targets) ? input.targets.slice(0, 6) : [];
      if (!submittedTargets.length) throw new Error("请至少选择一个目标 SKU");
      job.status = "preparing_mapping";
      job.progress = 5;
      job.targets = [];
      addEvent(job, "preparing_mapping", "正在按源 nodeKey、产品形态与视角建立 OSS 资产映射");
      await save(job);
      const replacementAssets = await stageReplacementAssets(job, input);
      const backgroundInstruction = safeText(input.backgroundInstruction, 4000);
      const personInstruction = safeText(input.personInstruction, 4000);
      const submittedSourceProduct = productById(input.sourceProductId);
      const sourceProduct = submittedSourceProduct || productById(job.sourceProduct?.id)
        || inferSourceProduct(job.source.prompt, (job.audit?.assets || []).map((asset) => [asset.label, asset.role, ...(asset.content || [])]));
      if (!sourceProduct) throw new Error("请先确认原片中的产品 SKU，平台将把它从可替换 SKU 中剔除");
      job.sourceProduct = {
        id: sourceProduct.id,
        name: sourceProduct.name || sourceProduct.platformName || sourceProduct.id,
        productProfile: clone(profileFromProduct(sourceProduct))
      };
      job.sourceProductMatch = {
        ...(job.sourceProductMatch || {}),
        productId: sourceProduct.id,
        productName: job.sourceProduct.name,
        confidence: submittedSourceProduct ? 1 : Number(job.sourceProductMatch?.confidence || 0),
        requiresConfirmation: false,
        confirmedAt: submittedSourceProduct ? isoNow() : (job.sourceProductMatch?.confirmedAt || "")
      };
      for (let index = 0; index < submittedTargets.length; index += 1) {
        const request = submittedTargets[index] || {};
        const product = productById(request.productId);
        if (!product) throw new Error(`目标 SKU 不存在：${request.productId || "未选择"}`);
        if (String(product.id) === String(sourceProduct.id)) throw new Error(`${product.name || product.platformName} 是原片产品，不能作为一键做同款的替换 SKU`);
        const targetName = product.name || product.platformName || product.id;
        const voiceover = safeText(request.voiceover || input.voiceover, 12000);
        const existingVariant = job.variantPrompts?.[product.id];
        const variant = existingVariant?.promptDiff?.sourceProductId === sourceProduct.id
          && !videoPromptAssetInstructionLeaks(existingVariant.variantPrompt || existingVariant.compiled).length
          ? existingVariant
          : await compileVariantPrompt(job, product);
        job.variantPrompts[product.id] = variant;
        const promptWasCompiledForSource = safeText(request.videoPromptSourceProductId, 160);
        const hasPromptSourceProduct = Object.prototype.hasOwnProperty.call(request, "videoPromptSourceProductId");
        const videoPromptDraft = safeText(stripVideoPromptAssetInstructions(
          hasPromptSourceProduct && promptWasCompiledForSource !== String(sourceProduct.id)
            ? variant.variantPrompt
            : (request.videoPromptDraft || variant.variantPrompt),
        ), 40000);
        if (!videoPromptDraft) throw new Error(`${targetName} 缺少视频生成提示词`);
        const selectedAssetIds = requiredProductAssetIds(request.assetIds);
        const allAssets = mappingProductAssets(product.id);
        const states = buildProductStateCatalog(product, allAssets);
        const recommended = recommendDisplayState(product, states);
        const displayStateId = safeText(request.displayStateId, 100) || recommended?.id || "";
        const chosenState = states.find((state) => state.id === displayStateId);
        if (!chosenState) throw new Error(`${targetName} 不支持展示形态：${displayStateId || "未选择"}`);
        if (!chosenState.selectable) throw new Error(`${targetName} / ${chosenState.label} 资料不完整，当前不可选：${chosenState.dataGaps.join("；")}`);
        const mappingPlan = buildMappingPlan({
          sourceAssets: job.audit?.assets || [],
          sourceProduct: sourceProduct || {},
          targetProduct: product,
          targetStateId: displayStateId,
          targetAssets: allAssets,
          selectedAssetIds,
          sourcePrompt: job.source.prompt
        });
        await autofillMappingActionResolutions(mappingPlan, {
          sourceProduct,
          targetProduct: product,
          sourceAssets: job.audit?.assets || [],
          sourcePrompt: job.source.prompt
        });
        const effectiveProduct = effectiveProductForState(product, mappingPlan.selectedState);
        const target = {
          id: uid("target"),
          productId: product.id,
          productName: targetName,
          productProfile: clone(profileFromProduct(effectiveProduct)),
          displayStateId,
          displayState: clone(mappingPlan.selectedState),
          voiceover,
          videoPromptDraft,
          assetIds: selectedAssetIds,
          aspectRatio: job.source.settings?.ratio || "9:16",
          backgroundInstruction,
          personInstruction,
          replacementAssets: clone(replacementAssets),
          sourceProduct: sourceProduct ? {
            id: sourceProduct.id,
            name: sourceProduct.name || sourceProduct.platformName || "",
            productProfile: clone(profileFromProduct(sourceProduct))
          } : null,
          upstreamTextAssets: await compileTargetTextAssetsWithModel(job, sourceProduct || {}, product, voiceover),
          mappingPlan,
          quantityPlan: null,
          quantityDecision: {
            enabled: false,
            status: "retired",
            policy: "inherit_source_observation",
            reason: "全局数量规划已下线；每张源图逐实例、逐槽位继承，不跨图换算数量。"
          },
          dataGapReport: clone(mappingPlan.dataGapReport || []),
          status: "awaiting_mapping_confirmation",
          assetGroups: [],
          selectedAssets: {},
          result: null
        };
        job.targets.push(target);
        job.progress = Math.round(15 + ((index + 1) / submittedTargets.length) * 75);
        await save(job);
      }
      job.preparationInput = {
        backgroundInstruction,
        personInstruction
      };
      job.timings.mappingMs = durationMs(startedAt);
      job.status = "awaiting_mapping_confirmation";
      job.progress = 100;
      job.error = "";
      job.failure = null;
      addEvent(job, "awaiting_mapping_confirmation", "产品形态与逐节点 OSS 映射已完成，请确认后再生成候选资产");
      await save(job);
    } catch (error) {
      job.timings.mappingMs = durationMs(startedAt);
      recordJobFailure(job, "mapping_preparation_failed", error, "mapping");
      await save(job);
    }
  }

  async function prepareAssets(job, input = {}) {
    const compileStartedAt = Date.now();
    try {
      job.stageAttempts ||= {};
      job.stageAttempts.assets = Math.max(0, Number(job.stageAttempts.assets || 0)) + 1;
      job.failure = null;
      const usePreparedTargets = input.usePreparedTargets === true;
      const resumeInterrupted = input.resumeInterrupted === true;
      if (usePreparedTargets) migrateStagedUserUploadToFirstFrame(job);
      const directFirstFrameRequested = usesUploadedFirstFrame(job)
        && !safeText(input.backgroundCandidateId, 240)
        && (job.backgroundFirstFrameOverride || (input.replacementAssets?.background || []).length === 1);
      const submittedTargets = usePreparedTargets
        ? job.targets
        : Array.isArray(input.targets) ? input.targets.slice(0, 6) : [];
      const requestedTargets = job.changeType.changesProduct
        ? submittedTargets
        : [submittedTargets[0] || { voiceover: input.voiceover, videoPromptDraft: input.videoPromptDraft }];
      if (job.changeType.changesProduct && !requestedTargets.length) throw new Error("请至少选择一个目标 SKU");
      job.status = "preparing_assets";
      job.progress = 3;
      addEvent(job, directFirstFrameRequested ? "binding_uploaded_first_frame" : "compiling_prompts", directFirstFrameRequested
        ? "正在校验用户上传首帧，并建立源 nodeKey 直替映射"
        : job.changeType.changesProduct
          ? "正在核验各 SKU 的最终 variant_prompt，并编译需要重建的上游图片提示词"
          : "Qwen 3.7 Plus 正在编译本次变更提示词");
      if (!usePreparedTargets) job.targets = [];
      await save(job);
      const replacementAssets = usePreparedTargets ? (job.replacementAssets || []) : await stageReplacementAssets(job, input);
      const firstFrameOverride = usesUploadedFirstFrame(job) ? job.backgroundFirstFrameOverride : null;
      const backgroundAssets = replacementAssets.filter((item) => item.role === "background");
      const personAssets = replacementAssets.filter((item) => item.role === "person");
      const backgroundInstruction = safeText(input.backgroundInstruction || job.preparationInput?.backgroundInstruction, 4000);
      const personInstruction = safeText(input.personInstruction || job.preparationInput?.personInstruction, 4000);
      for (let index = 0; index < requestedTargets.length; index += 1) {
        const request = requestedTargets[index] || {};
        if (resumeInterrupted && usePreparedTargets) {
          if (!assetPreparationCheckpointReady(job, request) && request.assetGroups?.length) {
            await resumePreparedTargetCandidates(job, request);
          }
          if (assetPreparationCheckpointReady(job, request)) {
            request.status = "awaiting_confirmation";
            job.progress = Math.round(45 + ((index + 1) / requestedTargets.length) * 50);
            addEvent(job, "asset_checkpoint_reused", `${request.productName || `目标 ${index + 1}`} 已完成的候选资产检查点保持不变`, {
              targetId: request.id || "",
              productId: request.productId || ""
            });
            await save(job);
            continue;
          }
        }
        const baseProduct = job.changeType.changesProduct ? productById(request.productId) : null;
        if (job.changeType.changesProduct && !baseProduct) throw new Error(`目标 SKU 不存在：${request.productId || "未选择"}`);
        const product = baseProduct && request.mappingPlan?.selectedState
          ? effectiveProductForState(baseProduct, request.mappingPlan.selectedState)
          : baseProduct;
        const targetName = product?.name || product?.platformName || job.changeType.label;
        const voiceover = safeText(request.voiceover || input.voiceover, 12000);
        const videoPromptDraft = safeText(stripVideoPromptAssetInstructions(
          request.videoPromptDraft
          || input.videoPromptDraft
          || job.variantPrompts?.[request.productId]?.variantPrompt
          || job.source.prompt,
        ), 40000);
        if (!videoPromptDraft) throw new Error(`${targetName} 缺少视频生成提示词`);
        const target = usePreparedTargets ? request : {
          id: uid("target"),
          productId: product?.id || "",
          productName: targetName,
          productProfile: clone(product?.productProfile || product?.replacementContract || {}),
          voiceover,
          videoPromptDraft,
          assetIds: Array.isArray(request.assetIds) ? request.assetIds.map(String).filter(Boolean) : [],
          aspectRatio: job.source.settings?.ratio || "9:16",
          backgroundInstruction,
          personInstruction,
          replacementAssets: clone(replacementAssets),
          firstFrameOverride: clone(firstFrameOverride),
          status: "compiling",
          assetGroups: [],
          selectedAssets: {},
          result: null
        };
        if (!usePreparedTargets) job.targets.push(target);
        target.replacementAssets = clone(replacementAssets);
        target.firstFrameOverride = clone(firstFrameOverride);
        target.status = "compiling";
        target.assetGroups = [];
        target.selectedAssets = {};
        let productInputs = { urls: [], records: [] };
        if (job.changeType.changesProduct) {
          const mappingAssetIds = (target.mappingPlan?.mappings || []).map((item) => item.targetAssetId).filter(Boolean);
          const requestedAssetIds = [...new Set([...(target.assetIds || []), ...mappingAssetIds])];
          productInputs = await productAssetInputs(product.id, requestedAssetIds);
          target.productAssets = productInputs.records;
        }
        const sourceProduct = job.changeType.changesProduct
          ? productById(target.sourceProduct?.id) || inferSourceProduct(job.source.prompt, (job.audit?.assets || []).map((asset) => [asset.label, asset.role, ...(asset.content || [])]))
          : null;
        target.sourceProduct = sourceProduct ? {
          id: sourceProduct.id,
          name: sourceProduct.name || sourceProduct.platformName || "",
          productProfile: clone(profileFromProduct(sourceProduct))
        } : null;
        target.upstreamTextAssets = target.upstreamTextAssets?.length
          ? target.upstreamTextAssets
          : await compileTargetTextAssetsWithModel(job, sourceProduct || {}, product || {}, voiceover);
        assertNoTextAssetConflicts(target);
        let adaptedPrompt = videoPromptDraft;
        let nonProductCompilation = null;
        if (firstFrameOverride) {
          const sourceFirstFrame = (job.audit?.assets || []).find((asset) => asset.nodeKey === firstFrameOverride.replacesSourceNodeKey)
            || backgroundSceneSourceAsset(job);
          adaptedPrompt = uploadedFirstFrameVideoPrompt(videoPromptDraft, sourceFirstFrame, backgroundInstruction);
        } else if (!job.changeType.changesProduct && qwen?.completeJson) {
          const compiled = await qwen.completeJson(videoPromptCompilerMessages({
            changeType: job.changeType,
            sourcePrompt: videoPromptDraft,
            voiceover,
            backgroundInstruction,
            personInstruction,
            replacementReferences: replacementAssets
          }), { temperature: 0, maxTokens: 6000 });
          const compiledPrompt = safeText(compiled.result?.prompt, 40000);
          if (!compiledPrompt) throw new Error(`${target.productName} 的视频提示词编译失败`);
          adaptedPrompt = compiledPrompt;
          nonProductCompilation = compiled;
        }
        for (const reference of replacementAssets) {
          const placeholder = `{{Node ${reference.logicalNodeKey}}}`;
          if (!adaptedPrompt.includes(placeholder)) {
            const roleLabel = reference.role === "background" ? "目标背景参考" : "目标人物身份参考";
            adaptedPrompt = `${adaptedPrompt}\n${roleLabel}：${placeholder}`.trim();
          }
        }
        if (job.changeType.changesProduct) {
          adaptedPrompt = replaceSourceProductAliases(adaptedPrompt, sourceProduct || {}, product);
          adaptedPrompt = applyCarrierVideoActionInstruction(adaptedPrompt, target);
          const staleMentions = sourceProductMentions(adaptedPrompt, sourceProduct || {}, product);
          if (staleMentions.length) {
            throw new Error(`${target.productName} 的最终视频提示词仍残留源产品：${staleMentions.join("、")}`);
          }
          const instructionLeaks = videoPromptAssetInstructionLeaks(adaptedPrompt);
          if (instructionLeaks.length) {
            throw new Error(`${target.productName} 的最终视频提示词混入上游资产重构指令：${instructionLeaks.join("、")}`);
          }
        }
        if (voiceover) {
          const compactPrompt = adaptedPrompt.replace(/\s+/g, "");
          const compactVoiceover = voiceover.replace(/\s+/g, "");
          if (!compactPrompt.includes(compactVoiceover)) {
            throw new Error(`${target.productName} 的新口播未被逐字写入编译结果，已阻止提交`);
          }
        }
        target.videoPrompt = {
          source: job.source.prompt,
          draft: videoPromptDraft,
          draftLocked: false,
          draftUserEdited: videoPromptDraft !== job.source.prompt,
          variantPrompt: adaptedPrompt,
          compiledBaseline: adaptedPrompt,
          compiled: adaptedPrompt,
          compilerSuggestion: "",
          compilerModel: firstFrameOverride
            ? "deterministic-uploaded-first-frame"
            : nonProductCompilation?.model || job.variantPrompts?.[target.productId]?.compilerModel || "user-confirmed",
          replacements: clone(nonProductCompilation?.result?.replacements || job.variantPrompts?.[target.productId]?.replacements || []),
          warnings: clone(nonProductCompilation?.result?.warnings || job.variantPrompts?.[target.productId]?.warnings || []),
          promptDiff: clone(job.variantPrompts?.[target.productId]?.promptDiff || null)
        };
        if (firstFrameOverride) {
          const sourceFirstFrame = (job.audit?.assets || []).find((asset) => asset.nodeKey === firstFrameOverride.replacesSourceNodeKey);
          if (!sourceFirstFrame) throw new Error(`源画布首帧节点已不存在：${firstFrameOverride.replacesSourceNodeKey}`);
          target.assetGroups.push(directUploadedFirstFrameGroup(job, target, sourceFirstFrame, firstFrameOverride));
        }
        const rebuildAssets = (job.audit?.assets || []).filter((asset) => {
          if (firstFrameOverride && asset.mediaType === "image") return false;
          const sourceMapping = target.mappingPlan?.mappings?.find((item) => item.sourceNodeKey === asset.nodeKey);
          return mappingRequiresAssetPreparation(asset, sourceMapping, carrierAssessmentsForNode(target, asset.nodeKey));
        });
        for (const sourceAsset of rebuildAssets) {
          const sourceMapping = target.mappingPlan?.mappings?.find((item) => item.sourceNodeKey === sourceAsset.nodeKey);
          const carrierPropAssessments = carrierAssessmentsForNode(target, sourceAsset.nodeKey);
          const carrierRebuild = carrierRegenerationRequired(carrierPropAssessments);
          const carrierOnly = carrierRebuild && sourceAsset.productBearing !== true;
          const effectiveSourceAsset = carrierRebuild ? {
            ...sourceAsset,
            rebuildRequired: true,
            generationRequired: true,
            replacementStrategy: "generate_candidate",
            rebuildRoles: [...new Set([...(sourceAsset.rebuildRoles || []), "承载道具"])]
          } : sourceAsset;
          if (!carrierRebuild && (sourceAsset.replacementStrategy === "direct_oss_product_asset" || isDirectProductReferenceAsset(sourceAsset))) {
            target.assetGroups.push(await directProductAssetGroup(job, target, sourceAsset, productInputs));
            continue;
          }
          const mappedProductRecord = sourceMapping?.targetAssetId
            ? productInputs.records.find((item) => String(item.id) === String(sourceMapping.targetAssetId))
            : productInputs.records.find((item) => (target.assetIds || []).map(String).includes(String(item.id))) || productInputs.records[0] || null;
          const compiled = await qwen.completeJson(promptCompilerMessages({
            changeType: job.changeType,
            sourceAsset: effectiveSourceAsset,
            product,
            sourceProduct,
            carrierPropAssessments: carrierRebuild ? carrierPropAssessments : [],
            productAssetUrls: mappedProductRecord?.url ? [mappedProductRecord.url] : productInputs.urls,
            backgroundAssetUrls: backgroundAssets.map((item) => item.url),
            personAssetUrls: personAssets.map((item) => item.url),
            backgroundInstruction,
            personInstruction,
            sourcePrompt: job.source.prompt
          }), { temperature: 0, maxTokens: 5000 });
          let compiler = enforceGeometryCompiler({
            category: clone(imagePromptCategory(job.changeType, effectiveSourceAsset)),
            imagePrompt: safeText(compiled.result?.imagePrompt, 18000),
            negativePrompt: safeText(compiled.result?.negativePrompt, 6000),
            scalePlan: clone(compiled.result?.scalePlan || {}),
            layoutLocks: clone(compiled.result?.layoutLocks || []),
            inputOrder: clone(compiled.result?.inputOrder || []),
            validationChecklist: clone(compiled.result?.validationChecklist || []),
            model: compiled.model,
            promptSource: "built_in"
          }, { changeType: job.changeType, sourceAsset: effectiveSourceAsset, product, sourceProduct, carrierOnly, carrierPropAssessments });
          const layoutContract = carrierOnly ? "" : sourceLayoutContract(effectiveSourceAsset);
          compiler.imagePrompt = `${compiler.imagePrompt}\n\n${layoutContract}\n\n${mappingInstruction(target, sourceAsset.nodeKey)}`.trim();
          compiler.scalePlan = {
            ...clone(compiler.scalePlan || {}),
            sourceSlotPolicy: carrierOnly ? "carrier_fit_reference_only" : "preserve_source_slots",
            sourceObservedCount: sourceAsset.productFacts?.productCount || null
          };
          if (!compiler.imagePrompt) throw new Error(`${sourceAsset.label} 没有生成可用的生图提示词`);
          const geometryManifest = buildGeometryManifest({
            jobId: job.id,
            targetId: target.id,
            sourceAsset: effectiveSourceAsset,
            target: geometryContract(product),
            productReferenceUrls: mappedProductRecord?.url ? [mappedProductRecord.url] : productInputs.urls
          });
          const geometryReview = sourceGeometryReview(effectiveSourceAsset);
          if (job.changeType.changesProduct && !carrierOnly && geometryReview.requiresReview) {
            const error = new Error(geometryReview.status === "count_conflict"
              ? `${sourceAsset.label || sourceAsset.nodeKey} 的源图观察数量 ${geometryReview.observedCount} 与可靠实例数量 ${geometryReview.reliableInstanceCount} 不一致，请返回映射页人工核实`
              : `${sourceAsset.label || sourceAsset.nodeKey} 没有可靠产品实例框，请返回映射页重新识别数量与槽位`);
            error.code = geometryReview.status === "count_conflict" ? "E_COUNT_CONFLICT" : "E_SOURCE_INSTANCE_MISSING";
            error.details = { sourceNodeKey: sourceAsset.nodeKey, ...geometryReview };
            throw error;
          }
          let geometryPreparation = {
            status: carrierOnly || !job.changeType.changesProduct ? "not_applicable" : "not_configured",
            manifest: geometryManifest,
            artifacts: {},
            providerDegraded: job.changeType.changesProduct && !carrierOnly,
            degradationReason: carrierOnly || !job.changeType.changesProduct ? "" : "OpenCV 几何服务未配置",
            warning: carrierOnly
              ? "源图无产品像素；目标 SKU 仅作为承载道具容量参照，不执行产品槽位几何重建。"
              : !job.changeType.changesProduct
                ? "本次不换产品，不执行目标 SKU 槽位几何重建。"
                : "OpenCV 几何服务未配置；本轮使用逐源图槽位继承提示词与原图参考，不执行全局数量换算。"
          };
          if (job.changeType.changesProduct && !carrierOnly && productGeometry?.prepare) {
            const preparedGeometry = await productGeometry.prepare(geometryManifest);
            geometryPreparation = await stageGeometryReferences({
              ...clone(preparedGeometry || {}),
              manifest: geometryManifest,
              artifacts: clone(preparedGeometry?.artifacts || {}),
              providerDegraded: true,
              degradationReason: "当前生图适配器以布局层参考图传入，不支持显式遮罩角色"
            }, {
              localDirectory: path.join(outputRoot, job.id, "geometry", target.id),
              sourceNodeKey: sourceAsset.nodeKey,
              sourceLabel: sourceAsset.label,
              download,
              acquireToken: typeof gpt?.acquireToken === "function" ? () => gpt.acquireToken() : null,
              upload: typeof gpt?.upload === "function" ? (localPath, token) => gpt.upload(localPath, token) : null
            });
            compiler.imagePrompt = `${compiler.imagePrompt}\n\n【OpenCV 源槽位几何引导】\n参考输入末尾为本节点按源实例槽位生成的目标产品布局层；只用它约束目标产品的位置、比例、接触点和遮挡关系，禁止改变源图中未授权的人物、背景、构图与动作。`.trim();
            compiler.inputOrder = [
              ...clone(compiler.inputOrder || []),
              "参考输入末尾=OpenCV 当前源图槽位布局层"
            ];
            compiler.geometryRevision = preparedGeometry?.revision || preparedGeometry?.geometry?.revision || "prepared-v1";
          }
          target.assetGroups.push({
            sourceNodeKey: sourceAsset.nodeKey,
            sourceLabel: sourceAsset.label,
            sourceUrl: sourceAsset.url,
            mappingTargetAssetId: mappedProductRecord?.id || sourceMapping?.targetAssetId || "",
            carrierPropAssessments: clone(carrierPropAssessments),
            compiler,
            geometryPreparation,
            generationRounds: [],
            candidates: []
          });
        }
        target.status = "generating_candidates";
        job.progress = Math.round(12 + ((index + 0.35) / requestedTargets.length) * 35);
        await save(job);
        const imageStartedAt = Date.now();
        for (const group of target.assetGroups) {
          if (isDirectAssetGroup(group)) continue;
          const generationReferences = imageGenerationReferences(target, group);
          const generatedCandidates = await runPool([0, 1], 2, (candidateIndex) => generateCandidate(
            job, target, group, group.compiler, generationReferences, candidateIndex, 1
          ));
          generatedCandidates.forEach((candidate) => upsertCandidate(group, candidate));
          group.generationRounds.push({
            round: 1,
            promptSource: "built_in",
            prompt: group.compiler.imagePrompt,
            effectivePrompt: group.compiler.imagePrompt,
            correctionPrompt: "",
            candidateIds: group.candidates.map((candidate) => candidate.id),
            createdAt: isoNow()
          });
          await save(job);
        }
        job.timings.imageGenerateMs += durationMs(imageStartedAt);
        target.upstreamAssetManifest = validateUpstreamAssetManifest(job, target);
        target.status = "awaiting_confirmation";
        job.progress = Math.round(45 + ((index + 1) / requestedTargets.length) * 50);
        await save(job);
      }
      job.timings.promptCompileMs = Number(job.timings.promptCompileMs || 0) + Math.max(0, durationMs(compileStartedAt) - job.timings.imageGenerateMs);
      job.status = "awaiting_asset_confirmation";
      job.progress = 100;
      job.error = "";
      job.failure = null;
      if (resumeInterrupted) {
        job.interruption = {
          ...(job.interruption || {}),
          recoveredAt: isoNow(),
          outcome: "awaiting_asset_confirmation"
        };
      }
      const hasGeneratedCandidates = job.targets.some((target) => (target.assetGroups || []).some((group) => !isDirectAssetGroup(group)));
      const hasUploadedFirstFrame = job.targets.some((target) => target.firstFrameOverride?.sourceMode === "user_uploaded_first_frame");
      addEvent(job, "awaiting_asset_confirmation", hasGeneratedCandidates
        ? "候选资产已生成，请逐张核实产品、背景、人物身份以及未授权残留"
        : hasUploadedFirstFrame
          ? "用户上传首帧已绑定源 nodeKey；确认后将直接创建视频节点，不再生图"
          : "本任务无需重建上游图片，请确认替换参考资产后再生成视频");
      await save(job);
    } catch (error) {
      recordJobFailure(job, "asset_preparation_failed", error, "assets");
      await save(job);
    }
  }

  async function startPreparation(id, input = {}) {
    const job = requireJob(id);
    if (job.status !== "awaiting_configuration") throw new Error("当前任务不在替换资产配置阶段");
    if (["queued", "running"].includes(job.backgroundSceneGeneration?.status)) {
      throw new Error("背景场景图仍在生成，请等待两张候选图回传后再继续");
    }
    const worker = job.changeType.changesProduct ? prepareMapping : prepareAssets;
    job.preparationRequest = clone(input);
    job.error = "";
    job.failure = null;
    await save(job);
    runInJobContext(job, () => worker(job, input)).catch(() => {});
    return publicJob(job);
  }

  async function confirmMappings(id, input = {}) {
    const job = requireJob(id);
    if (job.status !== "awaiting_mapping_confirmation") throw new Error("当前任务不在产品形态映射确认阶段");
    const confirmations = input.targets && typeof input.targets === "object" ? input.targets : {};
    const decisions = [];
    for (const target of job.targets) {
      const targetInput = confirmations[target.id] || confirmations[target.productId] || {};
      const textConfirmation = confirmTargetTextAssets(job, target, targetInput);
      for (const mapping of target.mappingPlan?.mappings || []) {
        const requested = targetInput.mappings?.[mapping.sourceNodeKey];
        const sourceAsset = (job.audit?.assets || []).find((asset) => asset.nodeKey === mapping.sourceNodeKey);
        if (requested?.reuseSource === true && (sourceAsset?.auditConflict || sourceProductPixelClaims(sourceAsset || {}).length)) {
          throw new Error(`${mapping.sourceLabel || mapping.sourceNodeKey} 的审计文字已确认存在旧产品像素，禁止改为源图直通；必须先重构并确认候选图`);
        }
        if (requested?.reuseSource !== true && mapping.processingMode === "generate_candidate" && sourceAsset?.productBearing === true) {
          const review = sourceGeometryReview(sourceAsset);
          if (review.requiresReview) {
            const error = new Error(review.status === "count_conflict"
              ? `${mapping.sourceLabel || mapping.sourceNodeKey} 的源图观察数量 ${review.observedCount} 与可靠实例数量 ${review.reliableInstanceCount} 不一致，请先人工核实`
              : `${mapping.sourceLabel || mapping.sourceNodeKey} 没有可靠产品实例框，请先重新识别数量与槽位`);
            error.code = review.status === "count_conflict" ? "E_COUNT_CONFLICT" : "E_SOURCE_INSTANCE_MISSING";
            error.details = { sourceNodeKey: mapping.sourceNodeKey, ...review };
            throw error;
          }
        }
      }
      const mappingPlan = applyMappingConfirmation(target.mappingPlan, targetInput);
      decisions.push({ target, mappingPlan, textConfirmation });
    }
    for (const { target, mappingPlan, textConfirmation } of decisions) {
      target.mappingPlan = mappingPlan;
      target.upstreamTextAssets = textConfirmation.transforms;
      target.upstreamTextConfirmedAt = textConfirmation.confirmedAt;
      target.quantityDecision = {
        enabled: false,
        status: "retired",
        policy: "inherit_source_observation",
        reason: "全局数量规划已下线；每张源图逐实例、逐槽位继承，不跨图换算数量。"
      };
      target.quantityPlan = null;
      target.dataGapReport = clone(target.mappingPlan.dataGapReport || []);
      target.mappingConfirmedAt = target.mappingPlan.confirmedAt;
      target.upstreamAssetManifest = buildUpstreamAssetManifest(job, target);
      target.status = "mapping_confirmed";
    }
    const sourceReuseCount = decisions.flatMap(({ mappingPlan }) => mappingPlan?.mappings || [])
      .filter((mapping) => mapping.processingMode === "reuse_source").length;
    const editedTextAssetCount = decisions.reduce((sum, item) => sum + item.textConfirmation.editedCount, 0);
    addEvent(job, "mapping_confirmed", `用户已确认产品形态、节点级资产路由、上游文本与风险处理方案${editedTextAssetCount ? `；人工修改 ${editedTextAssetCount} 个文本节点` : ""}${sourceReuseCount ? `；${sourceReuseCount} 张无产品关键帧按源图复用，不调用生图` : ""}`, {
      sourceReuseCount,
      editedTextAssetCount
    });
    job.assetPreparationRequest = { usePreparedTargets: true };
    job.error = "";
    job.failure = null;
    await save(job);
    runInJobContext(job, () => prepareAssets(job, { usePreparedTargets: true })).catch(() => {});
    return publicJob(job);
  }

  async function retryFailedStage(id) {
    const job = requireJob(id);
    if (job.status !== "failed" || job.failure?.scope !== "job" || job.failure?.retryable !== true) {
      throw new Error("当前任务没有可重新发起的失败环节");
    }
    const retryKind = job.failure.retryKind;
    job.stageRetryHistory ||= [];
    job.stageRetryHistory.push({ failure: clone(job.failure), archivedAt: isoNow() });
    if (job.stageRetryHistory.length > 10) job.stageRetryHistory.shift();
    job.error = "";
    job.failure = null;
    addEvent(job, "retrying_failed_stage", `正在重新发起：${JOB_FAILURE_STAGE_LABELS[job.stageRetryHistory.at(-1).failure.stage] || "失败环节"}`, {
      retryKind,
      nextAttempt: Math.max(1, Number(job.stageAttempts?.[retryKind] || 0) + 1)
    });
    await save(job);
    let worker;
    if (retryKind === "audit") worker = () => inspectAudit(job);
    else if (retryKind === "mapping") worker = () => prepareMapping(job, clone(job.preparationRequest || {}));
    else if (retryKind === "assets") {
      const request = job.assetPreparationRequest?.usePreparedTargets === true
        ? { usePreparedTargets: true }
        : clone(job.preparationRequest || {});
      worker = () => prepareAssets(job, request);
    } else {
      throw new Error("该失败环节暂不支持重新发起");
    }
    runInJobContext(job, worker).catch(() => {});
    return publicJob(job);
  }

  async function reconfigureUpstreamAssets(id) {
    const job = requireJob(id);
    if (
      job.status !== "failed"
      || job.failure?.scope !== "job"
      || job.failure?.stage !== "asset_preparation_failed"
      || job.failure?.retryable !== true
      || job.changeType?.changesProduct !== true
    ) {
      throw new Error("当前任务不能返回上游资产配置");
    }
    const previousFailure = clone(job.failure);
    rebuildPreparedMappings(job);
    for (const target of job.targets || []) {
      target.assetGroups = [];
      target.selectedAssets = {};
      target.productAssets = [];
      target.upstreamAssetManifest = null;
      target.videoPrompt = null;
      target.confirmedAt = "";
      target.failure = null;
    }
    job.stageRetryHistory ||= [];
    job.stageRetryHistory.push({ failure: previousFailure, archivedAt: isoNow() });
    if (job.stageRetryHistory.length > 10) job.stageRetryHistory.shift();
    job.assetPreparationRequest = null;
    job.status = "awaiting_mapping_confirmation";
    job.progress = 100;
    job.error = "";
    job.failure = null;
    addEvent(job, "upstream_assets_reconfiguration_requested", "已清空上一轮上游资产配置与候选准备结果，请重新配置并确认");
    await save(job);
    return publicJob(job);
  }

  function applySelections(job, selections = {}) {
    for (const target of job.targets) {
      const targetSelections = selections[target.id] || selections[target.productId] || {};
      for (const group of target.assetGroups || []) {
        const selectedId = String(targetSelections[group.sourceNodeKey] || target.selectedAssets?.[group.sourceNodeKey] || "");
        const selected = group.candidates.find((candidate) => candidate.id === selectedId);
        if (!selected) throw new Error(`请为 ${target.productName} / ${group.sourceLabel} 选择一张候选图`);
        target.selectedAssets[group.sourceNodeKey] = selected.id;
      }
      target.upstreamAssetManifest = validateUpstreamAssetManifest(job, target);
      target.confirmedAt = isoNow();
    }
  }

  function selectedCandidate(target, sourceNodeKey) {
    const selectedId = target.selectedAssets?.[sourceNodeKey];
    const group = (target.assetGroups || []).find((item) => item.sourceNodeKey === sourceNodeKey);
    return group?.candidates?.find((candidate) => candidate.id === selectedId) || null;
  }

  function uploadQueue(jobId) {
    let queue = upstreamUploadQueues.get(jobId);
    if (!queue) {
      queue = new Map();
      upstreamUploadQueues.set(jobId, queue);
    }
    return queue;
  }

  async function uploadUpstreamOnce(job, cacheKey, createUpload, missingNodeKeyMessage) {
    const queue = uploadQueue(job.id);
    const existing = queue.get(cacheKey);
    if (existing) return { nodeKey: await existing, reused: true };
    const pending = (async () => {
      const uploaded = await createUpload();
      const nodeKey = safeText(uploaded.nodeKey || uploaded.newNodeKey || uploaded?.data?.nodeKey, 160);
      if (!nodeKey) throw new Error(missingNodeKeyMessage);
      return nodeKey;
    })();
    queue.set(cacheKey, pending);
    try {
      return { nodeKey: await pending, reused: false };
    } catch (error) {
      if (queue.get(cacheKey) === pending) queue.delete(cacheKey);
      throw error;
    }
  }

  async function materializeUpstream(job, target, asset, index) {
    if (!FILE_MEDIA_TYPES.has(asset.mediaType)) throw new Error(`上游 ${asset.mediaType || "unknown"} 节点不能按文件上传：${asset.label || asset.nodeKey}`);
    const selected = selectedCandidate(target, asset.nodeKey);
    if (selected?.localPath && fs.existsSync(selected.localPath)) return selected.localPath;
    if (!asset.url) throw new Error(`上游资产缺少下载地址：${asset.label}`);
    const ext = normalizedMediaExtension(asset.url, asset.mediaType);
    const destination = path.join(outputRoot, job.id, "source-assets", target.id, `${String(index + 1).padStart(2, "0")}-${safeName(asset.label)}${ext}`);
    if (!fs.existsSync(destination)) await download(asset.url, destination);
    return destination;
  }

  function imageGenerationReferences(target, group) {
    const mappedProductRecord = group.mappingTargetAssetId
      ? (target.productAssets || []).find((item) => String(item.id) === String(group.mappingTargetAssetId))
      : null;
    return [
      ...(mappedProductRecord?.url ? [mappedProductRecord.url] : (target.productAssets || []).map((item) => item.url).filter(Boolean)),
      ...(target.replacementAssets || []).map((item) => item.url).filter(Boolean),
      ...(group.geometryPreparation?.providerReferenceUrls || [])
    ];
  }

  async function selectGroupProductAsset(job, target, group, requestedAssetId) {
    const productAssetId = safeText(requestedAssetId, 240);
    if (!productAssetId) return null;
    if (job.changeType?.changesProduct !== true) throw new Error("当前任务不包含换品，不能调整目标产品图");
    const mapping = (target.mappingPlan?.mappings || [])
      .find((item) => String(item.sourceNodeKey) === String(group.sourceNodeKey));
    if (!mapping) throw new Error("当前节点缺少产品资产映射，不能在此处更换产品图");
    const candidate = (mapping.targetAssetCandidates || [])
      .find((item) => String(item.id) === productAssetId);
    if (!candidate) throw new Error("选择的产品图不属于当前 SKU 或不符合当前产品形态");
    const productInputs = await productAssetInputs(target.productId, [productAssetId]);
    const selected = productInputs.records[0];
    if (!selected?.url) throw new Error("所选产品图无法读取，请在产品模板中检查该资产");
    const previousAssetId = safeText(group.mappingTargetAssetId || mapping.targetAssetId, 240);
    const changed = previousAssetId !== productAssetId;
    mapping.targetAssetId = productAssetId;
    group.mappingTargetAssetId = productAssetId;
    group.matchedProductAsset = clone(selected);
    target.assetIds = [...new Set([...(target.assetIds || []).map(String), productAssetId])];
    target.productAssets = [
      ...(target.productAssets || []).filter((item) => String(item.id) !== productAssetId),
      selected
    ];
    if (group.compiler?.scalePlan) {
      group.compiler.scalePlan.productAssetId = productAssetId;
      if (group.compiler.scalePlan.mapping) group.compiler.scalePlan.mapping.targetAssetId = productAssetId;
    }
    if (changed) {
      addEvent(job, "node_product_asset_changed", `${target.productName} / ${group.sourceLabel} 已人工更换目标产品图`, {
        targetId: target.id,
        sourceNodeKey: group.sourceNodeKey,
        previousAssetId,
        productAssetId
      });
    }
    return { record: selected, changed };
  }

  async function refreshGroupGeometryForProductAsset(job, target, group, selectedProductAsset) {
    if (!selectedProductAsset?.url || group.sourceMode === "oss_direct") return;
    const sourceAsset = (job.audit?.assets || [])
      .find((item) => String(item.nodeKey) === String(group.sourceNodeKey));
    if (!sourceAsset) throw new Error("当前节点的源图已不存在，无法更新 OpenCV 几何参考");
    const geometryManifest = buildGeometryManifest({
      jobId: job.id,
      targetId: target.id,
      sourceAsset,
      target: geometryContract(target.productProfile || {}),
      productReferenceUrls: [selectedProductAsset.url]
    });
    group.geometryPreparation = {
      ...clone(group.geometryPreparation || {}),
      manifest: geometryManifest,
      providerReferenceUrls: [],
      artifacts: {}
    };
    if (productGeometry?.prepare) {
      const preparedGeometry = await productGeometry.prepare(geometryManifest);
      group.geometryPreparation = await stageGeometryReferences({
        ...clone(preparedGeometry || {}),
        manifest: geometryManifest,
        artifacts: clone(preparedGeometry?.artifacts || {}),
        providerDegraded: true,
        degradationReason: "当前生图适配器以布局层参考图传入，不支持显式遮罩角色"
      }, {
        localDirectory: path.join(outputRoot, job.id, "geometry", target.id),
        sourceNodeKey: group.sourceNodeKey,
        sourceLabel: group.sourceLabel,
        download,
        acquireToken: typeof gpt?.acquireToken === "function" ? () => gpt.acquireToken() : null,
        upload: typeof gpt?.upload === "function" ? (localPath, token) => gpt.upload(localPath, token) : null
      });
    }
  }

  async function replaceDirectProductAsset(job, target, group, selectedProductAsset) {
    const sourceAsset = (job.audit?.assets || [])
      .find((item) => String(item.nodeKey) === String(group.sourceNodeKey));
    if (!sourceAsset) throw new Error("当前独立产品资料节点的源图已不存在");
    const replacement = await directProductAssetGroup(job, target, sourceAsset, { records: [selectedProductAsset] });
    Object.assign(group, replacement);
    target.upstreamAssetManifest = validateUpstreamAssetManifest(job, target);
    addEvent(job, "direct_product_asset_replaced", `${target.productName} / ${group.sourceLabel} 已改用人工选择的 OSS 原始产品图`, {
      targetId: target.id,
      sourceNodeKey: group.sourceNodeKey,
      productAssetId: selectedProductAsset.id
    });
  }

  async function runImageRegeneration(job, target, group, compiler, round) {
    const startedAt = Date.now();
    try {
      group.regeneration = { status: "running", round, startedAt: isoNow(), error: "" };
      const generated = await runPool([0, 1], 2, (candidateIndex) => generateCandidate(
        job,
        target,
        group,
        compiler,
        imageGenerationReferences(target, group),
        candidateIndex,
        round
      ));
      generated.forEach((candidate) => upsertCandidate(group, candidate));
      group.generationRounds.push({
        round,
        promptSource: compiler.promptSource || "built_in",
        prompt: compiler.imagePrompt,
        effectivePrompt: compiler.imagePrompt,
        baselinePrompt: compiler.baselinePrompt || group.compiler?.imagePrompt || "",
        correctionPrompt: compiler.correctionPrompt || "",
        candidateIds: generated.map((candidate) => candidate.id),
        createdAt: isoNow()
      });
      group.regeneration = { status: "success", round, completedAt: isoNow(), error: "" };
      target.upstreamAssetManifest = validateUpstreamAssetManifest(job, target);
      target.status = "awaiting_confirmation";
      job.status = "awaiting_asset_confirmation";
      job.progress = 100;
      job.timings.imageGenerateMs = Number(job.timings.imageGenerateMs || 0) + durationMs(startedAt);
      addEvent(job, "image_regeneration_completed", `${target.productName} / ${group.sourceLabel} 第 ${round} 轮候选图已生成，首轮结果仍保留`, {
        targetId: target.id,
        sourceNodeKey: group.sourceNodeKey,
        round,
        promptSource: compiler.promptSource || "built_in"
      });
    } catch (error) {
      group.regeneration = { status: "failed", round, completedAt: isoNow(), error: failureReason(error) };
      target.status = "awaiting_confirmation";
      job.status = "awaiting_asset_confirmation";
      job.progress = 100;
      addEvent(job, "image_regeneration_failed", `${target.productName} / ${group.sourceLabel} 第 ${round} 轮生图失败：${failureReason(error)}`, {
        targetId: target.id,
        sourceNodeKey: group.sourceNodeKey,
        round
      });
    }
    await save(job);
  }

  async function regenerateImageCandidates(id, targetId, sourceNodeKey, input = {}) {
    const job = requireJob(id);
    if (job.status !== "awaiting_asset_confirmation") throw new Error("当前任务不在候选资产确认阶段");
    const targetIndex = job.targets.findIndex((item) => item.id === String(targetId || ""));
    const target = job.targets[targetIndex];
    const group = target?.assetGroups?.find((item) => item.sourceNodeKey === String(sourceNodeKey || ""));
    if (!target || !group) throw new Error("待重新生图的资产组不存在");
    if (group.sourceMode === "uploaded_first_frame") throw new Error("用户上传首帧已直接替换源 nodeKey，不执行重新生图");
    let nextRound = 0;
    if (group.sourceMode !== "oss_direct") {
      group.generationRounds ||= [{ round: 1, promptSource: "built_in", prompt: group.compiler?.imagePrompt || "", candidateIds: (group.candidates || []).map((item) => item.id), createdAt: group.candidates?.[0]?.createdAt || job.updatedAt }];
      nextRound = group.generationRounds.length + 1;
      if (nextRound > MAX_IMAGE_GENERATION_ROUNDS) throw new Error("单个上游画面最多生成三轮候选图");
    }
    const targetSnapshot = clone(target);
    const eventCount = (job.events || []).length;
    const stageSnapshot = job.stage;
    const messageSnapshot = job.message;
    let productAssetSelection;
    try {
      productAssetSelection = await selectGroupProductAsset(job, target, group, input.productAssetId);
      const selectedProductAsset = productAssetSelection?.record || null;
      if (group.sourceMode === "oss_direct") {
        if (!selectedProductAsset) throw new Error("请先选择要替换的目标 SKU 产品图");
        await replaceDirectProductAsset(job, target, group, selectedProductAsset);
        await save(job);
        return publicJob(job);
      }
      if (productAssetSelection?.changed) await refreshGroupGeometryForProductAsset(job, target, group, selectedProductAsset);
    } catch (error) {
      job.targets[targetIndex] = targetSnapshot;
      if (Array.isArray(job.events)) job.events.length = eventCount;
      job.stage = stageSnapshot;
      job.message = messageSnapshot;
      throw error;
    }
    const compiler = compilerForUserImagePrompt(group, input.prompt || input.correctionPrompt || "", nextRound);
    group.regeneration = { status: "queued", round: nextRound, startedAt: isoNow(), error: "" };
    target.status = "regenerating_candidates";
    job.status = "regenerating_image_candidates";
    job.progress = 50;
    addEvent(job, "image_regeneration_queued", `${target.productName} / ${group.sourceLabel} 已发起第 ${nextRound} 轮生图，首轮基线保持不变`, {
      targetId: target.id,
      sourceNodeKey: group.sourceNodeKey,
      round: nextRound,
      promptSource: compiler.promptSource,
      productAssetId: group.mappingTargetAssetId || ""
    });
    await save(job);
    runInJobContext(job, () => runImageRegeneration(job, target, group, compiler, nextRound)).catch(() => {});
    return publicJob(job);
  }

  async function uploadCustomImageCandidate(id, targetId, sourceNodeKey, input = {}) {
    const job = requireJob(id);
    if (job.status !== "awaiting_asset_confirmation") throw new Error("当前任务不在候选资产确认阶段");
    const target = job.targets.find((item) => item.id === String(targetId || ""));
    const group = target?.assetGroups?.find((item) => item.sourceNodeKey === String(sourceNodeKey || ""));
    if (!target || !group) throw new Error("待上传图片的资产组不存在");
    if (isDirectAssetGroup(group)) throw new Error("直连节点不接受额外候选图；请返回配置页更换上传首帧");
    const sourcePath = path.resolve(String(input.path || ""));
    const sourceStat = await fsp.stat(sourcePath).catch(() => null);
    if (!sourceStat?.isFile()) throw new Error("自定义候选图不存在");
    const ext = path.extname(sourcePath).toLowerCase();
    if (!new Set([".png", ".jpg", ".jpeg", ".webp"]).has(ext)) throw new Error("自定义候选图仅支持 PNG、JPG、JPEG 或 WEBP");
    const customCount = (group.candidates || []).filter((candidate) => candidate.customUpload === true).length;
    if (customCount >= 10) throw new Error("单个上游画面最多保留 10 张用户自定义图片");
    const candidateIndex = (group.candidates || []).length;
    const destination = path.join(
      outputRoot,
      job.id,
      "candidates",
      target.id,
      `${safeName(group.sourceNodeKey)}-custom-${Date.now()}-${customCount + 1}${ext}`
    );
    await fsp.mkdir(path.dirname(destination), { recursive: true });
    await fsp.copyFile(sourcePath, destination);
    const candidate = {
      id: uid("custom-candidate"),
      sourceNodeKey: group.sourceNodeKey,
      sourceLabel: group.sourceLabel,
      model: "用户自定义上传",
      taskId: "",
      remoteUrl: "",
      localPath: destination,
      previewUrl: `./api/one-click-remake/jobs/${encodeURIComponent(job.id)}/candidates/${encodeURIComponent(target.id)}/${encodeURIComponent(group.sourceNodeKey)}/${candidateIndex}`,
      createdAt: isoNow(),
      round: 0,
      promptSource: "user_upload",
      customUpload: true,
      originalFileName: safeText(input.name || path.basename(sourcePath), 300)
    };
    group.candidates ||= [];
    group.candidates.push(candidate);
    target.selectedAssets ||= {};
    target.selectedAssets[group.sourceNodeKey] = candidate.id;
    target.upstreamAssetManifest = validateUpstreamAssetManifest(job, target);
    addEvent(job, "custom_image_candidate_uploaded", `${target.productName} / ${group.sourceLabel} 已上传用户自定义图片并默认选用`, {
      targetId: target.id,
      sourceNodeKey: group.sourceNodeKey,
      candidateId: candidate.id,
      originalFileName: candidate.originalFileName
    });
    await save(job);
    return publicJob(job);
  }

  function targetVideoNodeName(target, attempt = target.generationAttempt) {
    return `${safeName(target.productName)}_视频_${String(Math.max(1, Number(attempt || 1))).padStart(2, "0")}`;
  }

  async function finalizeTargetVideoResult(job, target, canvas, videoNodeName, detail = {}) {
    const videoNodeKey = safeText(detail.nodeKey || detail.newNodeKey || detail?.data?.nodeKey, 160);
    const videoUrl = safeText(Array.isArray(detail?.data?.url) ? detail.data.url[0] : detail?.url, 5000);
    if (!videoUrl) throw new Error(`${videoNodeName} 已返回节点信息，但没有成片 URL`);
    target.status = "downloading_result";
    await save(job);
    const round = Math.max(1, Number(target.generationAttempt || 1));
    const localPath = path.join(outputRoot, job.id, "results", `${safeName(target.productName)}_${safeName(job.taskName)}_第${round}轮.mp4`);
    await download(videoUrl, localPath);
    target.result = {
      ...(target.result || {}),
      ...canvas,
      videoNodeKey,
      videoNodeName,
      videoUrl,
      localPath,
      previewUrl: `./api/one-click-remake/jobs/${encodeURIComponent(job.id)}/results/${encodeURIComponent(target.id)}?round=${round}`,
      downloadUrl: `./api/one-click-remake/jobs/${encodeURIComponent(job.id)}/results/${encodeURIComponent(target.id)}?round=${round}&download=1`,
      completedAt: isoNow(),
      round
    };
    target.videoRounds ||= [];
    const roundResult = clone(target.result);
    target.videoRounds = target.videoRounds.filter((item) => Number(item.round) !== round);
    target.videoRounds.push(roundResult);
    target.status = "quality_checking";
    return target;
  }

  async function assessTargetVideo(job, target) {
    const round = Math.max(1, Number(target.generationAttempt || 1));
    const roundResult = (target.videoRounds || []).find((item) => Number(item.round) === round) || target.result;
    target.status = "quality_checking";
    addEvent(job, "video_quality_checking", `正在检验 ${target.productName} 第 ${round} 轮成片的替换洁净度、准确度、适配度与时序稳定性`, {
      targetId: target.id,
      round
    });
    await save(job);
    if (!qwen?.completeJson) {
      const unavailable = { status: "unavailable", pass: false, score: 0, dimensions: {}, issues: ["质量模型未配置"], correctionPrompt: "", summary: "质量模型未配置，需人工复核", model: "", checkedAt: isoNow() };
      roundResult.quality = unavailable;
      target.result.quality = unavailable;
      target.status = "review_required";
      return unavailable;
    }
    try {
      const response = await qwen.completeJson(videoQualityMessages({
        videoUrl: roundResult.videoUrl,
        productAssetUrls: (target.productAssets || []).map((item) => item.url).filter(Boolean).slice(0, 6),
        productName: target.productName,
        changeType: job.changeType,
        prompt: target.videoPrompt?.compiled || "",
        round
      }), { temperature: 0, maxTokens: 3000 });
      const quality = normalizeVideoQuality(response.result, response.model);
      roundResult.quality = quality;
      target.result.quality = quality;
      return quality;
    } catch (error) {
      const unavailable = { status: "unavailable", pass: false, score: 0, dimensions: {}, issues: [failureReason(error)], correctionPrompt: "", summary: "自动质量检验不可用，已保留成片等待人工复核", model: "", checkedAt: isoNow() };
      roundResult.quality = unavailable;
      target.result.quality = unavailable;
      target.status = "review_required";
      addEvent(job, "video_quality_unavailable", `${target.productName} 第 ${round} 轮自动质检不可用，成片已保留并转人工复核`, { targetId: target.id, round, reason: failureReason(error) });
      return unavailable;
    }
  }

  async function completeTargetVideoQuality(job, target, targetIndex, options = {}) {
    const quality = await assessTargetVideo(job, target);
    const round = Math.max(1, Number(target.generationAttempt || 1));
    const roundResult = (target.videoRounds || []).find((item) => Number(item.round) === round) || target.result;
    const pendingReview = {
      status: "pending",
      decision: "",
      reviewer: "",
      note: "",
      reviewedAt: ""
    };
    roundResult.manualReview = pendingReview;
    target.result.manualReview = clone(pendingReview);
    target.status = "awaiting_manual_review";
    addEvent(job, "video_manual_review_required", options.allowRegeneration === false
      ? `${target.productName} 第 ${round} 轮成片已找回并回传，恢复过程没有重新生成；请人工质检后决定是否归档`
      : `${target.productName} 第 ${round} 轮成片和 AI 参考质检已就绪，请人工质检后决定归档${round < MAX_VIDEO_GENERATION_ROUNDS ? "或生成第 2 轮" : ""}`, {
      targetId: target.id,
      round,
      score: quality.score,
      aiPass: quality.pass,
      issues: quality.issues,
      recovered: options.allowRegeneration === false
    });
    await save(job);
    return target;
  }

  function settleVideoJob(job) {
    const successCount = (job.targets || []).filter((target) => target.status === "success").length;
    const outputCount = (job.targets || []).filter((target) => (target.videoRounds || []).length > 0).length;
    const manualReviewCount = (job.targets || []).filter((target) => ["awaiting_manual_review", "review_required"].includes(target.status)).length;
    const activeCount = (job.targets || []).filter((target) => VIDEO_TARGET_ACTIVE_STATUSES.has(target.status)).length;
    if (activeCount) {
      job.status = "generating_video";
    } else if (successCount === job.targets.length) {
      job.status = "success";
      job.progress = 100;
      job.message = `已完成 ${successCount}/${job.targets.length} 个 SKU 的人工质检与归档`;
    } else if (manualReviewCount) {
      job.status = "awaiting_manual_review";
      job.progress = 95;
      job.message = `${manualReviewCount} 个成片等待人工质检；确认符合要求后才会归档`;
    } else if (outputCount) {
      job.status = "partial_success";
      job.progress = 100;
      job.message = `已完成 ${successCount}/${job.targets.length} 个 SKU，其余结果需要处理`;
    } else {
      job.status = "failed";
      job.progress = 100;
    }
    job.error = outputCount ? "" : job.error;
    if (outputCount) job.failure = null;
    return { successCount, outputCount, manualReviewCount, activeCount };
  }

  const settleRecoveredVideoJob = settleVideoJob;

  function persistedVideoNodeMissing(error) {
    const reason = failureReason(error);
    return error?.code === "LIBTV_CLI_EXECUTION_FAILED"
      && /not\s*found|no\s+such\s+node|节点(?:不存在|未找到)|未找到.*节点|找不到.*节点/i.test(reason);
  }

  function archiveTargetRetrySnapshot(target) {
    target.retryHistory ||= [];
    target.retryHistory.push({
      failure: clone(target.failure || null),
      result: clone(target.result || null),
      archivedAt: isoNow()
    });
    if (target.retryHistory.length > 10) target.retryHistory.shift();
  }

  async function finishPersistedVideoRegenerationFailure(job, target, error, nodeState = {}) {
    target.status = "retrying_video";
    recordTargetFailure(job, target, error);
    target.resultRecovery = {
      ...(target.resultRecovery || {}),
      status: "regeneration_failed",
      checkedAt: isoNow(),
      nextAttemptAt: "",
      lastError: failureReason(error),
      remoteStatus: nodeState.rawStatus ?? target.resultRecovery?.remoteStatus ?? null,
      remoteProgress: Number(nodeState.progressPercent || target.resultRecovery?.remoteProgress || 0),
      remoteTaskId: nodeState.taskId || target.resultRecovery?.remoteTaskId || ""
    };
    const summary = settleVideoJob(job);
    job.error = summary.outputCount ? "" : (target.result?.error || "重新生成失败");
    addEvent(job, "persisted_video_node_regeneration_failed", `${target.productName} 原视频节点重新生成失败`, {
      targetId: target.id,
      projectId: target.resultRecovery.projectId,
      videoNodeName: target.resultRecovery.videoNodeName,
      attempt: target.generationAttempt,
      reason: failureReason(error),
      remoteStatus: target.resultRecovery.remoteStatus,
      remoteTaskId: target.resultRecovery.remoteTaskId
    });
    await save(job);
    return false;
  }

  async function waitForPersistedVideoRegeneration(job, target, error, nodeState = {}) {
    target.status = "failed";
    target.failure = {
      at: isoNow(),
      stage: "retrying_video",
      stageLabel: TARGET_FAILURE_STAGE_LABELS.retrying_video || "重新发起视频生成",
      reason: failureReason(error),
      code: safeText(error?.code, 120),
      retryable: false,
      attempt: Math.max(1, Number(target.generationAttempt || 1))
    };
    target.result ||= {};
    target.result.error = target.failure.reason;
    target.result.failedAt = target.failure.at;
    const delay = videoRecoveryDelay(Math.max(1, Number(target.resultRecovery?.attempts || 1)));
    target.resultRecovery = {
      ...(target.resultRecovery || {}),
      status: "waiting",
      checkedAt: isoNow(),
      nextAttemptAt: new Date(Date.now() + delay).toISOString(),
      lastError: target.failure.reason,
      remoteStatus: nodeState.rawStatus ?? target.resultRecovery?.remoteStatus ?? null,
      remoteProgress: Number(nodeState.progressPercent || target.resultRecovery?.remoteProgress || 0),
      remoteTaskId: nodeState.taskId || target.resultRecovery?.remoteTaskId || ""
    };
    settleVideoJob(job);
    addEvent(job, "persisted_video_regeneration_waiting", `${target.productName} 已重新发起原节点，正在等待 LibTV 写回成片`, {
      targetId: target.id,
      projectId: target.resultRecovery.projectId,
      videoNodeName: target.resultRecovery.videoNodeName,
      attempt: target.generationAttempt,
      retryAfterMs: delay,
      reason: target.failure.reason
    });
    await save(job);
    scheduleVideoRecoverySweep(5000);
    return false;
  }

  async function regeneratePersistedVideoNode(job, target, canvas, sourceVideoNodeName, detail = {}, options = {}) {
    const sourceMissing = options.sourceMissing === true;
    const previousAttempt = Math.max(1, Number(target.generationAttempt || 1));
    if (previousAttempt >= MAX_VIDEO_GENERATION_ROUNDS) {
      const error = new Error("单个任务每个 SKU 最多生成两轮视频，不能再次生成");
      error.code = "VIDEO_GENERATION_ROUND_LIMIT";
      return finishPersistedVideoRegenerationFailure(job, target, error, videoNodeGenerationState(detail));
    }
    archiveTargetRetrySnapshot(target);
    const nextAttempt = previousAttempt + 1;
    const sourceState = videoNodeGenerationState(detail);
    const sourceNodeKey = sourceState.nodeKey
      || safeText(target.resultRecovery?.nodeKey || target.result?.videoNodeKey, 160);
    target.failure = null;
    target.result ||= {};
    target.result.error = "";
    delete target.result.failedAt;
    if (!sourceMissing) target.generationAttempt = nextAttempt;
    target.status = "retrying_video";
    job.status = "generating_video";
    job.error = "";
    target.resultRecovery = {
      ...(target.resultRecovery || {}),
      status: sourceMissing ? "recreating" : "regenerating",
      projectId: canvas.projectId,
      videoNodeName: sourceVideoNodeName,
      nodeKey: sourceNodeKey,
      sourceAttempt: previousAttempt,
      regenerationAttempt: nextAttempt,
      regenerationAttempts: Math.max(0, Number(target.resultRecovery?.regenerationAttempts || 0)) + 1,
      regenerationStartedAt: isoNow(),
      checkedAt: isoNow(),
      nextAttemptAt: "",
      lastError: ""
    };
    addEvent(job, sourceMissing ? "missing_video_node_recreation_started" : "persisted_video_node_regeneration_started", sourceMissing
      ? `${target.productName} 原视频节点已确认不存在，正在沿用已确认资产与提示词创建第 ${nextAttempt} 轮节点`
      : `${target.productName} 原视频节点已确认生成失败，正在原节点上重新生成`, {
      targetId: target.id,
      projectId: canvas.projectId,
      videoNodeName: sourceVideoNodeName,
      videoNodeKey: sourceNodeKey,
      sourceAttempt: previousAttempt,
      regenerationAttempt: nextAttempt
    });
    await save(job);

    if (sourceMissing) {
      try {
        await generateTargetVideo(job, target, Math.max(0, job.targets.indexOf(target)));
        target.resultRecovery = {
          ...(target.resultRecovery || {}),
          status: "regenerated",
          videoNodeName: target.result?.videoNodeName || targetVideoNodeName(target),
          nodeKey: target.result?.videoNodeKey || "",
          regeneratedAt: isoNow(),
          nextAttemptAt: "",
          lastError: ""
        };
        const summary = settleVideoJob(job);
        addEvent(job, "missing_video_node_recreated", `${target.productName} 原节点不存在，已创建第 ${target.generationAttempt} 轮节点并把成片回传平台`, {
          targetId: target.id,
          projectId: canvas.projectId,
          videoNodeName: target.resultRecovery.videoNodeName,
          videoNodeKey: target.resultRecovery.nodeKey,
          attempt: target.generationAttempt,
          outputCount: summary.outputCount
        });
        await save(job);
        return true;
      } catch (error) {
        if (error?.code === "LIBTV_CLI_INVALID_JSON" || /没有成片\s*URL|未返回.*成片\s*URL|连接|网络|timeout|超时/i.test(failureReason(error))) {
          target.resultRecovery = {
            ...(target.resultRecovery || {}),
            videoNodeName: targetVideoNodeName(target),
            nodeKey: target.result?.videoNodeKey || ""
          };
          return waitForPersistedVideoRegeneration(job, target, error);
        }
        return finishPersistedVideoRegenerationFailure(job, target, error);
      }
    }
    let regeneratedDetail;
    let runError = null;
    try {
      regeneratedDetail = await executeCli([
        "node", sourceNodeKey || sourceVideoNodeName, "-p", canvas.projectId, "--run"
      ], job, `${target.productName} 原视频节点重新生成失败`);
    } catch (error) {
      runError = error;
      try {
        regeneratedDetail = await executeCli([
          "node", sourceNodeKey || sourceVideoNodeName, "-p", canvas.projectId
        ], job, `${target.productName} 重新生成后的节点检查失败`);
      } catch (inspectionError) {
        const pendingError = new Error(`${failureReason(runError)}；重新检查节点时暂不可用：${failureReason(inspectionError)}`);
        pendingError.code = "LIBTV_VIDEO_REGENERATION_PENDING";
        return waitForPersistedVideoRegeneration(job, target, pendingError);
      }
    }
    const regeneratedState = videoNodeGenerationState(regeneratedDetail);
    if (regeneratedState.state === "ready") {
      await finalizeTargetVideoResult(job, target, canvas, sourceVideoNodeName, regeneratedDetail);
      await completeTargetVideoQuality(job, target, Math.max(0, job.targets.indexOf(target)));
      target.resultRecovery = {
        ...(target.resultRecovery || {}),
        status: "regenerated",
        nodeKey: regeneratedState.nodeKey || sourceNodeKey,
        remoteStatus: regeneratedState.rawStatus,
        remoteProgress: regeneratedState.progressPercent,
        remoteTaskId: regeneratedState.taskId,
        regeneratedAt: isoNow(),
        nextAttemptAt: "",
        lastError: ""
      };
      const summary = settleVideoJob(job);
      addEvent(job, "persisted_video_node_regenerated", `${target.productName} 已在原视频节点上完成重新生成，成片已回传平台`, {
        targetId: target.id,
        projectId: canvas.projectId,
        videoNodeName: sourceVideoNodeName,
        videoNodeKey: target.resultRecovery.nodeKey,
        attempt: target.generationAttempt,
        outputCount: summary.outputCount
      });
      await save(job);
      return true;
    }
    if (["pending", "awaiting_result"].includes(regeneratedState.state)) {
      const pendingError = new Error(`${sourceVideoNodeName} 已重新发起，当前进度 ${regeneratedState.progressPercent}% ，暂未返回成片 URL`);
      pendingError.code = "LIBTV_VIDEO_REGENERATION_PENDING";
      return waitForPersistedVideoRegeneration(job, target, pendingError, regeneratedState);
    }
    const terminalError = new Error(regeneratedState.reason || failureReason(runError) || `${sourceVideoNodeName} 重新生成后仍未返回成片`);
    terminalError.code = "LIBTV_VIDEO_REGENERATION_FAILED";
    return finishPersistedVideoRegenerationFailure(job, target, terminalError, regeneratedState);
  }

  async function recoverPersistedVideoTarget(job, target) {
    const attempt = Math.max(1, Number(target.generationAttempt || 1));
    const canvas = job.canvas?.projectId ? job.canvas : target.result;
    const videoNodeName = safeText(target.resultRecovery?.videoNodeName || target.result?.videoNodeName, 300)
      || targetVideoNodeName(target, attempt);
    const previousAttempts = Math.max(0, Number(target.resultRecovery?.attempts || 0));
    target.resultRecovery = {
      ...(target.resultRecovery || {}),
      status: "checking",
      attempts: previousAttempts + 1,
      projectId: canvas.projectId,
      videoNodeName,
      startedAt: target.resultRecovery?.startedAt || isoNow(),
      requestedAt: target.resultRecovery?.requestedAt || "",
      checkedAt: isoNow(),
      nextAttemptAt: "",
      lastError: ""
    };
    addEvent(job, "recovering_persisted_video_result", `正在从任务画布检查 ${target.productName} 第 ${attempt} 轮原视频节点；已有成片直接回传，仍在运行则等待，确认失败后才重新生成`, {
      targetId: target.id,
      projectId: canvas.projectId,
      videoNodeName,
      attempt
    });
    await save(job);
    try {
      const existingRound = currentVideoRound(target);
      const localReady = Boolean(existingRound?.localPath && fs.existsSync(existingRound.localPath));
      if (existingRound?.videoUrl && localReady) {
        target.result = clone(existingRound);
      } else {
        let detail;
        try {
          detail = await executeCli([
            "node", target.resultRecovery?.nodeKey || target.result?.videoNodeKey || videoNodeName, "-p", canvas.projectId
          ], job, `${target.productName} 已提交视频节点的自动回查失败`);
        } catch (error) {
          if (persistedVideoNodeMissing(error)) {
            target.resultRecovery = {
              ...(target.resultRecovery || {}),
              status: "source_missing",
              checkedAt: isoNow(),
              nextAttemptAt: "",
              lastError: failureReason(error)
            };
            addEvent(job, "persisted_video_node_missing", `${target.productName} 原视频节点在任务画布中不存在`, {
              targetId: target.id,
              projectId: canvas.projectId,
              videoNodeName,
              attempt,
              reason: failureReason(error)
            });
            await save(job);
            if (target.resultRecovery?.requestedAt) {
              return regeneratePersistedVideoNode(job, target, canvas, videoNodeName, {}, { sourceMissing: true });
            }
            return false;
          }
          throw error;
        }
        const nodeState = videoNodeGenerationState(detail);
        target.resultRecovery = {
          ...(target.resultRecovery || {}),
          nodeKey: nodeState.nodeKey || target.resultRecovery?.nodeKey || "",
          remoteStatus: nodeState.rawStatus,
          remoteProgress: nodeState.progressPercent,
          remoteTaskId: nodeState.taskId
        };
        if (nodeState.state === "ready") {
          await finalizeTargetVideoResult(job, target, canvas, videoNodeName, detail);
        } else if (["failed", "idle"].includes(nodeState.state) && target.resultRecovery?.requestedAt
          && Math.max(0, Number(target.resultRecovery?.regenerationAttempts || 0)) === 0) {
          return regeneratePersistedVideoNode(job, target, canvas, videoNodeName, detail);
        } else if (["failed", "idle"].includes(nodeState.state)
          && Math.max(0, Number(target.resultRecovery?.regenerationAttempts || 0)) > 0) {
          const terminalError = new Error(nodeState.reason || `${videoNodeName} 重新生成后仍处于失败状态`);
          terminalError.code = "LIBTV_VIDEO_REGENERATION_FAILED";
          return finishPersistedVideoRegenerationFailure(job, target, terminalError, nodeState);
        } else if (["failed", "idle"].includes(nodeState.state)) {
          target.resultRecovery = {
            ...(target.resultRecovery || {}),
            status: "terminal_failed",
            checkedAt: isoNow(),
            nextAttemptAt: "",
            lastError: nodeState.reason || `${videoNodeName} 生成失败`
          };
          await save(job);
          return false;
        } else {
          const pendingError = new Error(`${videoNodeName} 当前${nodeState.progressPercent ? `进度 ${nodeState.progressPercent}%` : "仍在生成或写回"}，暂未返回成片 URL`);
          pendingError.code = "LIBTV_VIDEO_RESULT_PENDING";
          throw pendingError;
        }
      }
      target.failure = null;
      target.result ||= {};
      target.result.error = "";
      delete target.result.failedAt;
      await completeTargetVideoQuality(job, target, Math.max(0, job.targets.indexOf(target)), { allowRegeneration: false });
      target.resultRecovery = {
        ...target.resultRecovery,
        status: "recovered",
        recoveredAt: isoNow(),
        nextAttemptAt: "",
        lastError: ""
      };
      if (target.resultRecovery.requestedAt) {
        addEvent(job, "previous_video_node_recovered", `${target.productName} 已从原视频节点恢复成片，本次没有重新生成`, {
          targetId: target.id,
          projectId: canvas.projectId,
          videoNodeName,
          attempt
        });
      }
      const summary = settleRecoveredVideoJob(job);
      addEvent(job, "persisted_video_result_recovered", `${target.productName} 第 ${attempt} 轮成片已从原视频节点找回并回传平台`, {
        targetId: target.id,
        projectId: canvas.projectId,
        videoNodeName,
        attempt,
        outputCount: summary.outputCount
      });
      await save(job);
      return true;
    } catch (error) {
      const attempts = Math.max(1, Number(target.resultRecovery?.attempts || 1));
      const delay = videoRecoveryDelay(attempts);
      target.resultRecovery = {
        ...target.resultRecovery,
        status: "waiting",
        checkedAt: isoNow(),
        nextAttemptAt: new Date(Date.now() + delay).toISOString(),
        lastError: failureReason(error)
      };
      addEvent(job, "persisted_video_result_waiting", `${target.productName} 原视频节点仍在生成或写回，平台将继续自动检查；不会并发重复生成`, {
        targetId: target.id,
        projectId: canvas.projectId,
        videoNodeName,
        attempt,
        retryAfterMs: delay,
        reason: failureReason(error)
      });
      await save(job);
      return false;
    }
  }

  async function recoverPersistedVideoResults(options = {}) {
    const selectedJobId = safeText(options.jobId, 160);
    const force = options.force === true;
    const candidates = [];
    for (const job of jobs.values()) {
      if (selectedJobId && job.id !== selectedJobId) continue;
      for (const target of job.targets || []) {
        if (recoverableVideoTarget(job, target, force)) candidates.push({ job, target });
      }
    }
    let recovered = 0;
    let waiting = 0;
    await runPool(candidates, 2, async ({ job, target }) => {
      const key = `${job.id}:${target.id}:${Math.max(1, Number(target.generationAttempt || 1))}`;
      const existing = videoRecoveryFlights.get(key);
      if (existing) return existing;
      const flight = runInJobContext(job, () => recoverPersistedVideoTarget(job, target));
      videoRecoveryFlights.set(key, flight);
      try {
        if (await flight) recovered += 1;
        else waiting += 1;
      } finally {
        if (videoRecoveryFlights.get(key) === flight) videoRecoveryFlights.delete(key);
      }
      return null;
    });
    return { attempted: candidates.length, recovered, waiting };
  }

  async function recoverPreviousVideoResult(job, target) {
    const previousFailureStage = safeText(target.retryHistory?.at(-1)?.failure?.stage, 80);
    if (!["generating_video", "downloading_result"].includes(previousFailureStage)) return false;
    const attempt = Math.max(0, Number(target.generationAttempt || 0));
    const canvas = job.canvas?.projectId ? job.canvas : target.result;
    if (!attempt || !canvas?.projectId) return false;
    const videoNodeName = targetVideoNodeName(target, attempt);
    addEvent(job, "recovering_previous_video_node", `正在先回查 ${target.productName} 上一次已提交的节点，避免重复生成`, {
      targetId: target.id,
      projectId: canvas.projectId,
      videoNodeName,
      attempt
    });
    await save(job);
    let detail;
    try {
      detail = await executeCli(["node", videoNodeName, "-p", canvas.projectId], job, "回查上一次视频节点失败");
    } catch (error) {
      const reason = failureReason(error);
      const definitelyMissing = error?.code === "LIBTV_CLI_EXECUTION_FAILED" && /not\s*found|no\s+such\s+node|节点(?:不存在|未找到)|未找到.*节点|找不到.*节点/i.test(reason);
      if (!definitelyMissing) throw error;
      addEvent(job, "previous_video_node_not_ready", `${target.productName} 上一次节点暂不可恢复，将按新一次生成继续`, {
        targetId: target.id,
        projectId: canvas.projectId,
        videoNodeName,
        attempt,
        reason
      });
      return false;
    }
    await finalizeTargetVideoResult(job, target, canvas, videoNodeName, detail);
    await completeTargetVideoQuality(job, target, Math.max(0, job.targets.indexOf(target)));
    addEvent(job, "previous_video_node_recovered", `${target.productName} 已恢复上一次生成结果，本次未新建节点`, {
      targetId: target.id,
      projectId: canvas.projectId,
      videoNodeName,
      attempt
    });
    return true;
  }

  async function generateTargetVideo(job, target, targetIndex = 0) {
    if (Math.max(0, Number(target.generationAttempt || 0)) >= MAX_VIDEO_GENERATION_ROUNDS) throw new Error("单个任务每个 SKU 最多生成两轮视频");
    target.generationAttempt = Math.max(0, Number(target.generationAttempt || 0)) + 1;
    target.failure = null;
    target.status = "creating_canvas";
    await save(job);
    const canvas = await ensureTaskCanvas(job);
    target.result = { ...canvas, videoNodeKey: "", videoUrl: "", localPath: "", error: "" };
    const nodeMap = {};
    const upstreamNodeKeys = [];
    const connectedNodeKeys = new Set();
    const connectUpstream = (nodeKey) => {
      if (connectedNodeKeys.has(nodeKey)) return;
      connectedNodeKeys.add(nodeKey);
      upstreamNodeKeys.push(nodeKey);
    };
    const assets = job.audit?.assets || [];
    const laneX = 80 + (targetIndex % 2) * 1500;
    const laneY = 160 + Math.floor(targetIndex / 2) * 2100;
    for (let index = 0; index < assets.length; index += 1) {
      const asset = assets[index];
      if (!SUPPORTED_UPSTREAM_TYPES.has(asset.mediaType)) {
        throw new Error(`上游节点 ${asset.label || asset.nodeKey} 的类型 ${asset.mediaType || "unknown"} 尚不能安全重建，已阻止静默丢失`);
      }
      const selected = selectedCandidate(target, asset.nodeKey);
      const textTransform = asset.mediaType === "text" ? textTransformForAsset(target, asset.nodeKey) : null;
      if (asset.mediaType === "text" && !textTransform) throw new Error(`上游文本节点缺少目标 SKU 改写记录：${asset.label || asset.nodeKey}`);
      if (textTransform?.conflicts?.length) assertNoTextAssetConflicts(target);
      const sharedAcrossTargets = asset.mediaType === "text" ? textTransform.rewritten !== true : !selected;
      const cacheKey = JSON.stringify([
        canvas.projectId,
        "source",
        sharedAcrossTargets ? "shared" : target.id,
        asset.mediaType,
        asset.nodeKey,
        asset.mediaType === "text"
          ? textTransform.content
          : sharedAcrossTargets ? asset.url : `${selected.id}:${selected.localPath || ""}`
      ]);
      const nodeName = sharedAcrossTargets
        ? `共享上游_${String(index + 1).padStart(2, "0")}_${safeName(asset.label || asset.nodeKey)}`
        : `${safeName(target.productName)}_第${String(target.generationAttempt).padStart(2, "0")}次_${String(index + 1).padStart(2, "0")}_${safeName(asset.label || asset.nodeKey)}`;
      target.status = "uploading_assets";
      await save(job);
      const uploadResult = await uploadUpstreamOnce(job, cacheKey, async () => {
        if (asset.mediaType === "text") {
          return executeCli(buildStaticTextNodeArgs({
            name: nodeName,
            projectId: canvas.projectId,
            content: textTransform.content,
            x: laneX + (index % 3) * 390,
            y: laneY + Math.floor(index / 3) * 690
          }), job, `重建上游文本节点失败：${asset.label}`);
        }
        const localPath = await materializeUpstream(job, target, asset, index);
        return executeCli([
          "upload", nodeName, "-p", canvas.projectId, "-t", asset.mediaType, "-f", localPath,
          "--x", String(laneX + (index % 3) * 390), "--y", String(laneY + Math.floor(index / 3) * 690)
        ], job, `上传上游资产失败：${asset.label}`);
      }, `上游资产上传成功但缺少 nodeKey：${asset.label}`);
      const nodeKey = uploadResult.nodeKey;
      nodeMap[asset.nodeKey] = nodeKey;
      connectUpstream(nodeKey);
      if (uploadResult.reused && sharedAcrossTargets) {
        addEvent(job, "shared_upstream_reused", `${target.productName} 已复用同一画布中的共享上游资产：${asset.label}`, {
          targetId: target.id,
          sourceNodeKey: asset.nodeKey,
          nodeKey
        });
      } else if (asset.mediaType === "text") {
        addEvent(job, "upstream_text_rebuilt", `${target.productName} 已重建文本节点：${asset.label}${textTransform.rewritten ? "（SKU 内容已改写）" : "（内容原样复用）"}`, {
          targetId: target.id,
          sourceNodeKey: asset.nodeKey,
          nodeKey,
          rewritten: textTransform.rewritten === true,
          replacements: clone(textTransform.replacements || [])
        });
      }
      await save(job);
    }
    for (let index = 0; index < (target.replacementAssets || []).length; index += 1) {
      const reference = target.replacementAssets[index];
      if (!reference.localPath || !fs.existsSync(reference.localPath)) {
        throw new Error(`替换参考资产不存在：${reference.label || reference.logicalNodeKey}`);
      }
      const roleLabel = reference.role === "background" ? "背景参考" : "人物参考";
      const cacheKey = JSON.stringify([
        canvas.projectId,
        "replacement",
        reference.role,
        reference.logicalNodeKey,
        path.resolve(reference.localPath)
      ]);
      target.status = "uploading_assets";
      await save(job);
      const uploadResult = await uploadUpstreamOnce(job, cacheKey, () => executeCli([
        "upload", `共享${roleLabel}_${String(index + 1).padStart(2, "0")}`, "-p", canvas.projectId, "-t", "image", "-f", reference.localPath,
        "--x", String(laneX + ((assets.length + index) % 3) * 390), "--y", String(laneY + Math.floor((assets.length + index) / 3) * 690)
      ], job, `上传${roleLabel}失败：${reference.label}`), `${roleLabel}上传成功但缺少 nodeKey：${reference.label}`);
      const nodeKey = uploadResult.nodeKey;
      nodeMap[reference.logicalNodeKey] = nodeKey;
      connectUpstream(nodeKey);
      if (uploadResult.reused) {
        addEvent(job, "shared_upstream_reused", `${target.productName} 已复用同一画布中的共享${roleLabel}：${reference.label}`, {
          targetId: target.id,
          sourceNodeKey: reference.logicalNodeKey,
          nodeKey
        });
      }
      await save(job);
    }
    const basePrompt = replaceNodeReferences(target.videoPrompt.compiled, nodeMap);
    const prompt = target.generationAttempt > 1 && target.videoQualityRetryPrompt
      ? `${basePrompt}\n\n【上一轮人工质检修复指令】\n${target.videoQualityRetryPrompt}\n保持原剧情、镜头、动作、台词与未授权对象不变，只修复上述质量问题。`
      : basePrompt;
    for (const sourceKey of Object.keys(nodeMap)) {
      if (prompt.includes(`{{Node ${sourceKey}}}`)) throw new Error(`提示词仍残留旧 nodeKey：${sourceKey}`);
    }
    const videoNodeName = targetVideoNodeName(target);
    target.status = "generating_video";
    await save(job);
    let created;
    try {
      created = await executeCli(buildVideoNodeArgs({
        name: videoNodeName,
        projectId: canvas.projectId,
        prompt,
        params: job.source.params,
        upstreamNodeKeys,
        x: laneX + 920,
        y: laneY + 260
      }), job, `${target.productName} 视频生成失败`);
    } catch (error) {
      if (error?.code !== "LIBTV_CLI_INVALID_JSON") throw error;
      addEvent(job, "recovering_video_node_callback", `${target.productName} 的 LibTV 进程已结束但 JSON 回传不可解析，正在按画布和节点名恢复结果`, {
        targetId: target.id,
        projectId: canvas.projectId,
        videoNodeName,
        diagnostics: clone(error.cliDiagnostics || {})
      });
      await save(job);
      created = await executeCli([
        "node", videoNodeName, "-p", canvas.projectId
      ], job, `${target.productName} 已创建视频节点，但按节点名恢复结果失败`);
      addEvent(job, "video_node_callback_recovered", `${target.productName} 已从画布恢复视频节点结果，未重复创建节点`, {
        targetId: target.id,
        projectId: canvas.projectId,
        videoNodeName
      });
      await save(job);
    }
    const videoNodeKey = safeText(created.nodeKey || created.newNodeKey || created?.data?.nodeKey, 160);
    const detail = created?.data?.url ? created : await executeCli([
      "node", videoNodeKey || videoNodeName, "-p", canvas.projectId
    ], job, "读取新视频节点失败");
    await finalizeTargetVideoResult(job, target, canvas, videoNodeName, {
      ...detail,
      nodeKey: videoNodeKey || detail.nodeKey || ""
    });
    return completeTargetVideoQuality(job, target, targetIndex);
  }

  async function addRecipe(job, target, options = {}) {
    const curatedAt = safeText(options.curatedAt, 80);
    const curatedBy = safeText(options.curatedBy, 160);
    const recipeOwnerKey = safeText(options.ownerKey, 128) || job.libtvOwner.key;
    const recipeOwnerName = safeText(options.ownerName, 160) || job.libtvOwner.name || job.libtvOwner.userId || recipeOwnerKey;
    const recipe = {
      id: safeText(target.archive?.recipeId, 200) || uid("recipe"),
      schemaVersion: "one-click-remake-recipe-v2",
      caseStage: "completed",
      visibility: "shared",
      sourceRecipeId: job.sourceArchive?.recipeId || "",
      ownerKey: recipeOwnerKey,
      ownerName: recipeOwnerName,
      createdBy: job.libtvOwner.name || job.libtvOwner.userId || job.libtvOwner.key,
      createdAt: isoNow(),
      title: `${job.source.videoNodeName} · ${target.productName}`,
      coverUrl: target.result?.videoUrl || job.source.resultUrl,
      source: clone(job.source),
      audit: clone(job.audit),
      sourceProduct: clone(job.sourceProduct),
      sourceProductMatch: clone(job.sourceProductMatch),
      changeType: clone(job.changeType),
      targetProduct: target.productId
        ? {
            id: target.productId,
            name: target.productName,
            profile: clone(target.productProfile),
            displayStateId: target.displayStateId || "",
            displayState: clone(target.displayState || null)
          }
        : null,
      productMapping: clone(target.mappingPlan || null),
      quantityControl: null,
      dataGapReport: clone(target.dataGapReport || []),
      mappingConfirmedAt: target.mappingConfirmedAt || "",
      productAssets: clone(target.productAssets || []),
      replacementAssets: (target.replacementAssets || []).map((item) => ({
        id: item.id,
        role: item.role,
        label: item.label,
        logicalNodeKey: item.logicalNodeKey,
        url: item.storageUrl || item.url,
        storageUrl: item.storageUrl || "",
        storageKey: item.storageKey || "",
        storageBackend: item.storageBackend || "",
        storageError: item.storageError || ""
      })),
      firstFrameOverride: target.firstFrameOverride ? {
        id: target.firstFrameOverride.id,
        role: "background",
        label: target.firstFrameOverride.label,
        sourceMode: target.firstFrameOverride.sourceMode,
        replacesSourceNodeKey: target.firstFrameOverride.replacesSourceNodeKey,
        replacesSourceLabel: target.firstFrameOverride.replacesSourceLabel,
        url: target.firstFrameOverride.storageUrl || target.firstFrameOverride.url || "",
        storageUrl: target.firstFrameOverride.storageUrl || "",
        storageKey: target.firstFrameOverride.storageKey || "",
        storageBackend: target.firstFrameOverride.storageBackend || "",
        storageError: target.firstFrameOverride.storageError || ""
      } : null,
      replacementInstructions: {
        background: target.backgroundInstruction || "",
        person: target.personInstruction || ""
      },
      imagePrompts: (target.assetGroups || []).map((group) => ({
        sourceNodeKey: group.sourceNodeKey,
        sourceLabel: group.sourceLabel,
        compiler: clone(group.compiler),
        selectedCandidateId: target.selectedAssets?.[group.sourceNodeKey] || ""
      })),
      upstreamTextAssets: clone(target.upstreamTextAssets || []),
      upstreamAssetManifest: clone(target.upstreamAssetManifest || null),
      videoPrompt: clone(target.videoPrompt),
      result: {
        canvasUrl: target.result?.canvasUrl || "",
        videoUrl: target.result?.videoUrl || "",
        previewUrl: target.result?.previewUrl || "",
        round: Number(target.result?.round || target.generationAttempt || 1),
        manualReview: clone(target.result?.manualReview || null),
        jobId: job.id,
        targetId: target.id
      },
      ...(curatedAt || curatedBy ? {
        curation: {
          source: "prompt_library_management",
          curatedAt: curatedAt || isoNow(),
          curatedBy: curatedBy || job.libtvOwner.name || job.libtvOwner.userId || job.libtvOwner.key
        }
      } : {}),
      storage: pendingRecipeStorage()
    };
    replaceRecipe(recipe);
    await saveLibrary();
    return syncRecipe(recipe);
  }

  async function generateVideos(job) {
    const startedAt = Date.now();
    try {
      job.status = "generating_video";
      job.progress = 2;
      await ensureTaskCanvas(job);
      addEvent(job, "creating_video_nodes", `资产已确认，正在任务共享画布中并发创建 ${job.targets.length} 个 SKU 视频节点`);
      await save(job);
      let completed = 0;
      await runPool(job.targets, Math.min(4, job.targets.length), async (target, targetIndex) => {
        try {
          await generateTargetVideo(job, target, targetIndex);
        } catch (error) {
          recordTargetFailure(job, target, error);
        }
        completed += 1;
        job.progress = Math.round((completed / job.targets.length) * 100);
        await save(job);
      });
      job.timings.videoGenerateMs = Number(job.timings.videoGenerateMs || 0) + durationMs(startedAt);
      const summary = settleVideoJob(job);
      job.error = summary.outputCount ? "" : (job.targets.find((target) => target.result?.error)?.result?.error || "所有视频均生成失败");
      addEvent(job, job.status, summary.outputCount ? job.message : job.error);
      await save(job);
    } catch (error) {
      job.timings.videoGenerateMs = Number(job.timings.videoGenerateMs || 0) + durationMs(startedAt);
      recordJobFailure(job, "video_generation_failed", error);
      await save(job);
    }
  }

  async function retryVideoTarget(job, target) {
    const startedAt = Date.now();
    try {
      const recovered = await recoverPreviousVideoResult(job, target);
      if (!recovered) await generateTargetVideo(job, target, Math.max(0, job.targets.indexOf(target)));
      addEvent(job, "target_video_retry_succeeded", `${target.productName}重新生成成功，等待人工质检`, {
        targetId: target.id,
        attempt: target.generationAttempt
      });
    } catch (error) {
      recordTargetFailure(job, target, error);
    }
    job.timings.videoGenerateMs = Number(job.timings.videoGenerateMs || 0) + durationMs(startedAt);
    const summary = settleVideoJob(job);
    job.error = summary.outputCount ? "" : (job.targets.find((item) => item.result?.error)?.result?.error || "所有视频均生成失败");
    addEvent(job, job.status, summary.outputCount ? job.message : job.error);
    await save(job);
  }

  async function generateVideoAfterManualRejection(job, target) {
    const startedAt = Date.now();
    try {
      await generateTargetVideo(job, target, Math.max(0, job.targets.indexOf(target)));
      addEvent(job, "manual_review_second_round_ready", `${target.productName} 第 2 轮成片已生成，等待人工质检`, {
        targetId: target.id,
        round: target.generationAttempt
      });
    } catch (error) {
      recordTargetFailure(job, target, error);
    }
    job.timings.videoGenerateMs = Number(job.timings.videoGenerateMs || 0) + durationMs(startedAt);
    const summary = settleVideoJob(job);
    job.error = summary.outputCount ? "" : (target.result?.error || "第二轮视频生成失败");
    addEvent(job, job.status, summary.outputCount ? job.message : job.error);
    await save(job);
  }

  async function reviewTargetVideo(id, targetId, input = {}) {
    const job = requireJob(id);
    const target = (job.targets || []).find((item) => item.id === String(targetId || ""));
    if (!target) throw new Error("待人工质检的视频目标不存在");
    const decision = safeText(input.decision, 24).toLowerCase();
    if (!["approve", "reject"].includes(decision)) throw new Error("请选择“符合要求并归档”或“不符合要求”");
    const round = Math.max(1, Number(input.round || target.generationAttempt || 1));
    const latestRound = Math.max(1, Number(target.generationAttempt || 1));
    if (round !== latestRound) throw new Error(`当前只能质检最新的第 ${latestRound} 轮成片`);
    const roundResult = (target.videoRounds || []).find((item) => Number(item.round) === round);
    if (!roundResult?.videoUrl || !roundResult?.localPath || !fs.existsSync(roundResult.localPath)) throw new Error("待人工质检的成片尚未完整回传");
    if (target.status === "success" && roundResult.manualReview?.decision === "approve") return publicJob(job);
    if (!["awaiting_manual_review", "review_required"].includes(target.status)) throw new Error("当前成片不在人工质检阶段");
    const reviewer = safeText(input.reviewer, 160) || job.libtvOwner.name || job.libtvOwner.userId || job.libtvOwner.key;
    const note = safeText(input.note, 4000);
    const manualReview = {
      status: decision === "approve" ? "approved" : "rejected",
      decision,
      reviewer,
      note,
      reviewedAt: isoNow()
    };
    roundResult.manualReview = manualReview;
    target.result = clone(roundResult);

    if (decision === "approve") {
      target.archive = {
        status: "archiving",
        recipeId: safeText(target.archive?.recipeId, 200) || `recipe-${safeName(job.id)}-${safeName(target.id)}-r${round}`,
        startedAt: isoNow()
      };
      target.status = "archiving_result";
      job.status = "archiving_result";
      job.progress = 98;
      job.error = "";
      addEvent(job, "video_manual_review_approved", `${target.productName} 第 ${round} 轮人工质检符合要求，正在归档`, {
        targetId: target.id,
        round,
        reviewer,
        note
      });
      await save(job);
      try {
        const recipe = await addRecipe(job, target);
        target.archive = {
          status: "completed",
          recipeId: recipe.id,
          storage: clone(recipe.storage || {}),
          archivedAt: isoNow()
        };
        target.status = "success";
        target.result.manualReview = clone(manualReview);
        addEvent(job, "video_manual_review_archived", `${target.productName} 第 ${round} 轮已通过人工质检并归档`, {
          targetId: target.id,
          round,
          reviewer,
          recipeId: recipe.id
        });
      } catch (error) {
        target.status = "awaiting_manual_review";
        target.archive = { status: "failed", error: failureReason(error), failedAt: isoNow() };
        roundResult.manualReview = { ...manualReview, status: "archive_failed" };
        target.result.manualReview = clone(roundResult.manualReview);
        settleVideoJob(job);
        await save(job);
        throw new Error(`人工质检已确认，但归档失败：${failureReason(error)}`);
      }
      settleVideoJob(job);
      await save(job);
      return publicJob(job);
    }

    addEvent(job, "video_manual_review_rejected", `${target.productName} 第 ${round} 轮人工质检不符合要求`, {
      targetId: target.id,
      round,
      reviewer,
      note
    });
    if (round < MAX_VIDEO_GENERATION_ROUNDS) {
      const qualityIssues = Array.isArray(roundResult.quality?.issues) ? roundResult.quality.issues.join("；") : "";
      target.videoQualityRetryPrompt = note || roundResult.quality?.correctionPrompt || qualityIssues || "修复人工质检发现的成片问题";
      target.status = "quality_retrying";
      job.status = "quality_retrying";
      job.progress = 95;
      job.error = "";
      addEvent(job, "video_quality_retrying", `${target.productName} 第 1 轮经人工判定不符合要求，正在生成第 2 轮`, {
        targetId: target.id,
        round,
        reviewer,
        correctionPrompt: target.videoQualityRetryPrompt
      });
      await save(job);
      runInJobContext(job, () => generateVideoAfterManualRejection(job, target)).catch(() => {});
      return publicJob(job);
    }

    target.status = "review_required";
    settleVideoJob(job);
    job.message = `${target.productName} 第 2 轮人工质检不符合要求，已达到两轮上限；成片保留待处理`;
    addEvent(job, "video_manual_review_limit_reached", job.message, { targetId: target.id, round, reviewer, note });
    await save(job);
    return publicJob(job);
  }

  async function retryTargetVideo(id, targetId) {
    const job = requireJob(id);
    if (ACTIVE_STATUSES.has(job.status)) throw new Error("任务正在后台执行，请等待当前生成结束后再重试");
    const target = job.targets.find((item) => item.id === String(targetId || ""));
    if (!target) throw new Error("待重试的视频目标不存在");
    const failureStage = safeText(target.failure?.stage, 80);
    const canvasProjectId = safeText(job.canvas?.projectId || target.result?.projectId, 160);
    const mayHaveSubmittedVideoNode = Math.max(0, Number(target.generationAttempt || 0)) > 0
      && Boolean(canvasProjectId)
      && ["generating_video", "downloading_result", "retrying_video"].includes(failureStage);
    const manualRecoveryCandidate = recoverableVideoTarget(job, target, true)
      || mayHaveSubmittedVideoNode
      || ["terminal_failed", "source_missing"].includes(target.resultRecovery?.status);
    if (target.status === "failed" && target.failure?.retryable !== false && manualRecoveryCandidate) {
      const attempt = Math.max(1, Number(target.generationAttempt || 1));
      const canvas = job.canvas?.projectId ? job.canvas : target.result;
      target.resultRecovery = {
        ...(target.resultRecovery || {}),
        status: "checking",
        attempts: Math.max(0, Number(target.resultRecovery?.attempts || 0)),
        projectId: canvas?.projectId || "",
        videoNodeName: targetVideoNodeName(target, attempt),
        requestedAt: isoNow(),
        regenerationAttempts: 0,
        regenerationStartedAt: "",
        nextAttemptAt: "",
        lastError: ""
      };
      job.status = "generating_video";
      job.error = "";
      job.message = `正在追溯 ${target.productName} 的原视频节点并检查生成状态`;
      addEvent(job, "manual_video_recovery_requested", `正在追溯 ${target.productName} 第 ${attempt} 轮原视频节点；已有成片直接回传，仍在运行则等待，确认失败后在原节点重新生成`, {
        targetId: target.id,
        projectId: canvas?.projectId || "",
        videoNodeName: target.resultRecovery.videoNodeName,
        attempt
      });
      await save(job);
      runInJobContext(job, async () => {
        await recoverPersistedVideoTarget(job, target);
        if (hasRecoverableVideoResults()) scheduleVideoRecoverySweep(5000);
      }).catch(() => {});
      return publicJob(job);
    }
    if (Math.max(0, Number(target.generationAttempt || 0)) >= MAX_VIDEO_GENERATION_ROUNDS) throw new Error("单个任务每个 SKU 最多生成两轮视频，不能发起第三轮");
    if (target.status !== "failed" || target.failure?.retryable === false) throw new Error("仅支持重新发起生成失败的视频目标");
    archiveTargetRetrySnapshot(target);
    target.status = "retrying_video";
    target.failure = null;
    target.result ||= {};
    target.result.error = "";
    job.status = "generating_video";
    job.error = "";
    job.progress = Math.round((job.targets.filter((item) => ["success", "failed"].includes(item.status)).length / job.targets.length) * 100);
    addEvent(job, "retrying_video", `正在重新发起 ${target.productName} 的视频生成，沿用已确认资产与提示词`, {
      targetId: target.id,
      nextAttempt: Math.max(1, Number(target.generationAttempt || 0) + 1)
    });
    await save(job);
    runInJobContext(job, () => retryVideoTarget(job, target)).catch(() => {});
    return publicJob(job);
  }

  async function confirmAssets(id, input = {}) {
    const job = requireJob(id);
    if (job.status !== "awaiting_asset_confirmation") throw new Error("当前任务不在资产确认阶段");
    const submittedTextAssets = input.textAssets && typeof input.textAssets === "object" ? input.textAssets : {};
    const textConfirmations = [];
    for (const target of job.targets || []) {
      await ensureTargetTextAssetsReady(job, target);
      const targetTextAssets = submittedTextAssets[target.id] || submittedTextAssets[target.productId] || {};
      textConfirmations.push({
        target,
        confirmation: confirmTargetTextAssets(job, target, { textAssets: targetTextAssets })
      });
    }
    applySelections(job, input.selections || {});
    applyEditableVideoPrompts(job, input.videoPrompts || {});
    for (const { target, confirmation } of textConfirmations) {
      target.upstreamTextAssets = confirmation.transforms;
      target.upstreamTextConfirmedAt = confirmation.confirmedAt;
      target.upstreamAssetManifest = validateUpstreamAssetManifest(job, target);
    }
    const editedTextAssetCount = textConfirmations.reduce((sum, item) => sum + item.confirmation.editedCount, 0);
    addEvent(job, "assets_confirmed", `用户已确认上游资产、上游文本与可编辑视频提示词，允许提交视频生成${editedTextAssetCount ? `；最终环节人工修改 ${editedTextAssetCount} 个文本节点` : ""}`, {
      editedTextAssetCount
    });
    await save(job);
    runInJobContext(job, () => generateVideos(job)).catch(() => {});
    return publicJob(job);
  }

  function listJobs() {
    return [...jobs.values()]
      .filter(owned)
      .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)))
      .map(publicJob);
  }

  function getJob(id) {
    return publicJob(requireJob(id));
  }

  async function updateJob(id, input = {}) {
    const job = requireJob(id);
    const taskName = safeText(input.taskName, 200);
    if (!taskName) throw new Error("任务名称不能为空");
    job.taskName = taskName;
    addEvent(job, "task_renamed", `任务名称已修改为“${taskName}”`);
    await save(job);
    return publicJob(job);
  }

  async function deleteJob(id) {
    const job = requireJob(id);
    if (ACTIVE_STATUSES.has(job.status) || ["queued", "running"].includes(job.backgroundSceneGeneration?.status)) {
      throw new Error("任务正在后台执行，完成或中断后才能删除记录");
    }
    const pendingSave = saveQueues.get(job.id);
    if (pendingSave) await pendingSave.catch(() => {});
    jobs.delete(job.id);
    saveQueues.delete(job.id);
    upstreamUploadQueues.delete(job.id);
    await fsp.unlink(jobPath(job.id)).catch((error) => {
      if (error?.code !== "ENOENT") throw error;
    });
    return { id: job.id, deleted: true, generatedFilesRetained: true };
  }

  function listRecipes(filters = {}) {
    const key = ownerKey();
    const includeSourceAudits = filters.includeSourceAudits === true;
    return promptLibrary
      .filter((item) => filters.allOwners === true || item.ownerKey === key)
      .filter((item) => includeSourceAudits || item.caseStage !== "source_ready")
      .map(clone);
  }

  async function searchRecipes(filters = {}) {
    const key = ownerKey();
    const normalized = normalizeRecipeSearchFilters(filters);
    if (typeof promptLibraryStore?.search === "function") {
      try {
        const shared = await promptLibraryStore.search({
          ...normalized,
          ownerKey: key,
          allOwners: filters.allOwners === true
        });
        return {
          items: Array.isArray(shared?.items) ? shared.items.map(clone) : [],
          page: Number(shared?.page || normalized.page),
          pageSize: Number(shared?.pageSize || normalized.pageSize),
          total: Number(shared?.total || 0),
          pages: Math.max(1, Number(shared?.pages || 1)),
          sourceMode: shared?.sourceMode || "database-oss",
          storageReady: true,
          warning: ""
        };
      } catch (error) {
        const fallback = searchLocalRecipes(listRecipes({
          includeSourceAudits: true,
          allOwners: filters.allOwners === true
        }), normalized);
        return {
          ...fallback,
          storageReady: false,
          warning: `共享提示词库暂不可用，当前显示本机缓存：${safeText(error?.message || error, 500)}`
        };
      }
    }
    return {
      ...searchLocalRecipes(listRecipes({
        includeSourceAudits: true,
        allOwners: filters.allOwners === true
      }), normalized),
      storageReady: false,
      warning: "共享提示词库尚未配置，当前显示本机缓存"
    };
  }

  async function searchHistoryRecipes(filters = {}) {
    const normalized = normalizeRecipeSearchFilters({
      ...filters,
      includeSourceAudits: true
    });
    if (typeof promptLibraryStore?.search === "function") {
      try {
        const allRecipes = [];
        let page = 1;
        let pages = 1;
        do {
          const shared = await promptLibraryStore.search({
            ownerKey: ownerKey(),
            allOwners: true,
            includeSourceAudits: true,
            page,
            pageSize: 50
          });
          allRecipes.push(...(Array.isArray(shared?.items) ? shared.items.map(clone) : []));
          pages = Math.max(1, Number(shared?.pages || 1));
          page += 1;
        } while (page <= pages);
        return {
          ...searchLocalRecipes(collapseHistoryRecipes(allRecipes), normalized),
          sourceMode: "database-oss",
          storageReady: true,
          warning: ""
        };
      } catch (error) {
        return {
          ...searchLocalRecipes(collapseHistoryRecipes(listRecipes({
            includeSourceAudits: true,
            allOwners: true
          })), normalized),
          storageReady: false,
          warning: `共享历史案例暂不可用，当前显示本机缓存：${safeText(error?.message || error, 500)}`
        };
      }
    }
    return {
      ...searchLocalRecipes(collapseHistoryRecipes(listRecipes({
        includeSourceAudits: true,
        allOwners: true
      })), normalized),
      storageReady: false,
      warning: "共享历史案例尚未配置，当前显示本机缓存"
    };
  }

  function formalCaseEligibleTarget(target = {}) {
    return Boolean(
      target.result?.videoUrl
      && target.result?.manualReview?.decision === "approve"
      && target.videoPrompt?.compiled
    );
  }

  function formalCaseEligibleSourceRecipe(recipe = {}) {
    const prompt = safeText(recipe.sourceSnapshot?.prompt || recipe.videoPrompt?.source || recipe.source?.prompt, 200000);
    const videoUrl = safeText(recipe.source?.resultUrl || recipe.coverUrl, 4000);
    return Boolean(
      recipe.caseStage === "source_ready"
      && prompt
      && videoUrl
      && recipe.storage?.ossSynced === true
      && recipe.storage?.databaseSynced === true
    );
  }

  function formalCaseCandidate(job, target, existingRecipe = null) {
    return {
      key: `${job.id}:${target.id}`,
      kind: "completed_result",
      jobId: job.id,
      targetId: target.id,
      title: `${job.source?.videoNodeName || job.taskName || "成功视频节点"} · ${target.productName || "正式案例"}`,
      taskName: job.taskName || "",
      productName: target.productName || "",
      ownerKey: existingRecipe?.ownerKey || target.archive?.ownerKey || job.libtvOwner?.key || "",
      ownerName: existingRecipe?.ownerName || existingRecipe?.createdBy || target.archive?.ownerName || job.libtvOwner?.name || job.libtvOwner?.userId || job.libtvOwner?.key || "未知账号",
      completedAt: target.archive?.archivedAt || target.result?.manualReview?.reviewedAt || job.updatedAt || job.createdAt || "",
      videoUrl: target.result?.previewUrl || target.result?.videoUrl || "",
      recipeId: existingRecipe?.id || target.archive?.recipeId || "",
      archived: Boolean(existingRecipe && existingRecipe.caseStage !== "source_ready")
    };
  }

  function sourceFormalCaseCandidate(sourceRecipe, existingRecipe = null) {
    return {
      key: `source:${sourceRecipe.id}`,
      kind: "source_template",
      sourceRecipeId: sourceRecipe.id,
      jobId: "",
      targetId: "",
      title: sourceRecipe.title || sourceRecipe.source?.videoNodeName || "成功拆解模板",
      taskName: sourceRecipe.title || "",
      productName: sourceRecipe.sourceProduct?.name || "",
      ownerKey: sourceRecipe.ownerKey || "",
      ownerName: sourceRecipe.ownerName || sourceRecipe.createdBy || sourceRecipe.ownerKey || "未知账号",
      completedAt: sourceRecipe.createdAt || "",
      videoUrl: sourceRecipe.source?.resultUrl || sourceRecipe.coverUrl || "",
      recipeId: existingRecipe?.id || "",
      archived: Boolean(existingRecipe)
    };
  }

  async function allRecipesForFormalCaseCandidates(options = {}) {
    const local = listRecipes({ includeSourceAudits: true, allOwners: options.allowAnyOwner === true });
    if (typeof promptLibraryStore?.search !== "function") return local;
    try {
      const shared = [];
      let page = 1;
      let pages = 1;
      do {
        const result = await promptLibraryStore.search({
          ownerKey: ownerKey(),
          allOwners: options.allowAnyOwner === true,
          includeSourceAudits: true,
          page,
          pageSize: 50
        });
        shared.push(...(Array.isArray(result?.items) ? result.items.map(clone) : []));
        pages = Math.max(1, Number(result?.pages || 1));
        page += 1;
      } while (page <= pages);
      const byId = new Map([...local, ...shared].filter((recipe) => recipe?.id).map((recipe) => [String(recipe.id), recipe]));
      return [...byId.values()];
    } catch {
      return local;
    }
  }

  async function listFormalCaseCandidates(options = {}) {
    const candidates = [];
    const allRecipes = await allRecipesForFormalCaseCandidates(options);
    const accessibleJobs = [...jobs.values()]
      .sort((left, right) => String(right.updatedAt || right.createdAt || "").localeCompare(String(left.updatedAt || left.createdAt || "")));
    for (const job of accessibleJobs) {
      for (const target of job.targets || []) {
        if (!formalCaseEligibleTarget(target)) continue;
        const formalOwnerKey = safeText(target.archive?.ownerKey, 128) || safeText(job.libtvOwner?.key, 128);
        if (options.allowAnyOwner !== true && formalOwnerKey.toLowerCase() !== ownerKey().toLowerCase()) continue;
        const recipeId = safeText(target.archive?.recipeId, 200);
        const localMatch = allRecipes.find((recipe) => (
          recipe.caseStage !== "source_ready"
          && (recipe.id === recipeId || (
            safeText(recipe.result?.jobId, 200) === job.id
            && safeText(recipe.result?.targetId, 200) === target.id
          ))
        ));
        const existingRecipe = localMatch || (recipeId
          ? await findRecipe(recipeId, { allowAnyOwner: true })
          : null);
        candidates.push(formalCaseCandidate(job, target, existingRecipe));
      }
    }
    for (const sourceRecipe of allRecipes) {
      if (!formalCaseEligibleSourceRecipe(sourceRecipe)) continue;
      if (options.allowAnyOwner !== true && safeText(sourceRecipe.ownerKey, 128).toLowerCase() !== ownerKey().toLowerCase()) continue;
      const existingRecipe = allRecipes.find((recipe) => (
        recipe.caseStage !== "source_ready"
        && safeText(recipe.sourceTemplateId, 200) === String(sourceRecipe.id)
      )) || null;
      candidates.push(sourceFormalCaseCandidate(sourceRecipe, existingRecipe));
    }
    return candidates
      .sort((left, right) => String(right.completedAt || "").localeCompare(String(left.completedAt || "")))
      .slice(0, 200);
  }

  function curatedSourceRecipe(sourceRecipe, options = {}) {
    const curatedAt = safeText(options.curatedAt, 80) || isoNow();
    const curatedBy = safeText(options.curatedBy, 160) || sourceRecipe.ownerName || sourceRecipe.createdBy || sourceRecipe.ownerKey;
    const sourcePrompt = safeText(sourceRecipe.sourceSnapshot?.prompt || sourceRecipe.videoPrompt?.source || sourceRecipe.source?.prompt, 200000);
    const videoUrl = safeText(sourceRecipe.source?.resultUrl || sourceRecipe.coverUrl, 4000);
    const recipeId = `formal-source-${crypto.createHash("sha256").update(String(sourceRecipe.id)).digest("hex").slice(0, 24)}`;
    return {
      ...clone(sourceRecipe),
      id: recipeId,
      schemaVersion: "one-click-remake-source-curated-recipe-v1",
      caseStage: "source_curated",
      sourceTemplateId: sourceRecipe.id,
      createdAt: curatedAt,
      coverUrl: videoUrl,
      targetProduct: clone(sourceRecipe.sourceProduct || null),
      videoPrompt: {
        source: sourcePrompt,
        compiled: sourcePrompt,
        replacements: []
      },
      result: {
        canvasUrl: sourceRecipe.source?.canvasUrl || "",
        videoUrl,
        previewUrl: videoUrl,
        jobId: "",
        targetId: ""
      },
      curation: {
        source: "prompt_library_management",
        sourceRecipeId: sourceRecipe.id,
        sourceCreatedAt: sourceRecipe.createdAt || "",
        curatedAt,
        curatedBy
      },
      storage: pendingRecipeStorage()
    };
  }

  async function addSourceFormalRecipe(sourceRecipeId, options = {}) {
    const sourceRecipe = await findRecipe(sourceRecipeId, { allowAnyOwner: true });
    if (!sourceRecipe) throw new Error("待归档的成功拆解模板不存在");
    const canManage = options.allowAnyOwner === true
      || safeText(sourceRecipe.ownerKey, 128).toLowerCase() === ownerKey().toLowerCase();
    if (!canManage) {
      const error = new Error("仅案例归属人或一键做同款管理员可新增正式案例");
      error.code = "FORMAL_CASE_CREATE_FORBIDDEN";
      error.statusCode = 403;
      throw error;
    }
    if (!formalCaseEligibleSourceRecipe(sourceRecipe)) {
      throw new Error("只有源视频、源提示词与 OSS/数据库快照均完整的成功拆解模板才能加入正式提示词库");
    }
    const recipeId = `formal-source-${crypto.createHash("sha256").update(String(sourceRecipe.id)).digest("hex").slice(0, 24)}`;
    const existingRecipe = await findRecipe(recipeId, { allowAnyOwner: true });
    if (existingRecipe && existingRecipe.caseStage !== "source_ready") {
      return { recipe: clone(existingRecipe), alreadyExists: true };
    }
    const recipe = curatedSourceRecipe(sourceRecipe, {
      curatedAt: isoNow(),
      curatedBy: safeText(options.actor, 160) || sourceRecipe.ownerName || sourceRecipe.createdBy || sourceRecipe.ownerKey
    });
    replaceRecipe(recipe);
    await saveLibrary();
    const stored = await syncRecipe(recipe, { actor: options.actor, forceSnapshotUpload: true });
    return { recipe: clone(stored), alreadyExists: false };
  }

  async function addFormalRecipe(jobId, targetId, options = {}) {
    const job = jobs.get(String(jobId || ""));
    if (!job) throw new Error("待归档任务不存在");
    const target = (job.targets || []).find((item) => item.id === String(targetId || ""));
    if (!target) throw new Error("待归档成片不存在");
    const formalOwnerKey = safeText(target?.archive?.ownerKey, 128) || safeText(job.libtvOwner?.key, 128);
    const canManage = options.allowAnyOwner === true || formalOwnerKey.toLowerCase() === ownerKey().toLowerCase();
    if (!canManage) {
      const error = new Error("仅案例归属人或一键做同款管理员可新增正式案例");
      error.code = "FORMAL_CASE_CREATE_FORBIDDEN";
      error.statusCode = 403;
      throw error;
    }
    if (!formalCaseEligibleTarget(target)) throw new Error("只有已完成人工质检且具备完整提示词的成片才能加入正式提示词库");
    const recipeId = safeText(target.archive?.recipeId, 200);
    const existingRecipe = promptLibrary.find((recipe) => (
      recipe.caseStage !== "source_ready"
      && (recipe.id === recipeId || (
        safeText(recipe.result?.jobId, 200) === job.id
        && safeText(recipe.result?.targetId, 200) === target.id
      ))
    )) || (recipeId ? await findRecipe(recipeId, { allowAnyOwner: true }) : null);
    if (existingRecipe && existingRecipe.caseStage !== "source_ready") {
      return { recipe: clone(existingRecipe), alreadyExists: true };
    }
    const curatedAt = isoNow();
    const curatedBy = safeText(options.actor, 160) || job.libtvOwner.name || job.libtvOwner.userId || job.libtvOwner.key;
    const formalOwnerName = safeText(target.archive?.ownerName, 160) || job.libtvOwner.name || job.libtvOwner.userId || formalOwnerKey;
    const recipe = await addRecipe(job, target, {
      curatedAt,
      curatedBy,
      ownerKey: formalOwnerKey,
      ownerName: formalOwnerName
    });
    target.archive = {
      status: "completed",
      recipeId: recipe.id,
      ownerKey: recipe.ownerKey,
      ownerName: recipe.ownerName,
      storage: clone(recipe.storage || {}),
      archivedAt: curatedAt,
      curatedBy
    };
    addEvent(job, "formal_case_added", `${target.productName || "成片"} 已由${curatedBy}加入正式提示词库`, {
      targetId: target.id,
      recipeId: recipe.id,
      curatedBy
    });
    await save(job);
    return { recipe: clone(recipe), alreadyExists: false };
  }

  function recipeMatchesSource(recipe, source, taskId) {
    if (safeText(recipe?.source?.taskId, 100) !== safeText(taskId, 100)) return false;
    const recipeSpaceId = safeText(recipe?.source?.spaceId, 40);
    const recipeProjectId = safeText(recipe?.source?.projectId, 80);
    if (recipeSpaceId && recipeProjectId) {
      return recipeSpaceId === source.spaceId && recipeProjectId.toLowerCase() === source.projectId.toLowerCase();
    }
    try {
      const parsed = parseCanvasUrl(recipe?.source?.canvasUrl);
      return parsed.spaceId === source.spaceId && parsed.projectId.toLowerCase() === source.projectId.toLowerCase();
    } catch {
      return safeText(recipe?.source?.canvasUrl, 4000) === source.canvasUrl;
    }
  }

  async function findCollectedSource(source, taskId, options = {}) {
    const normalizedTaskId = safeText(taskId, 100);
    if (!/^\d{12,40}$/.test(normalizedTaskId)) return null;
    const result = await searchRecipes({
      taskId: normalizedTaskId,
      includeSourceAudits: true,
      allOwners: options.allOwners === true,
      page: 1,
      pageSize: 50
    });
    const matches = (result.items || []).filter((recipe) => recipeMatchesSource(recipe, source, normalizedTaskId));
    return matches.find((recipe) => recipe.caseStage === "source_ready") || matches[0] || null;
  }

  async function findRecipe(recipeId, options = {}) {
    const allowAnyOwner = options.allowAnyOwner === true;
    let recipe = promptLibrary.find((item) => item.id === String(recipeId) && (allowAnyOwner || item.ownerKey === ownerKey()));
    const storeGetter = allowAnyOwner && typeof promptLibraryStore?.getAny === "function"
      ? promptLibraryStore.getAny
      : promptLibraryStore?.get;
    if (!recipe && typeof storeGetter === "function") {
      try {
        recipe = allowAnyOwner && storeGetter === promptLibraryStore.getAny
          ? await storeGetter(String(recipeId))
          : await storeGetter(String(recipeId), ownerKey());
        if (recipe) replaceRecipe(clone(recipe));
      } catch (_) {}
    }
    return recipe || null;
  }

  async function remakeFromRecipe(recipeId, input = {}, options = {}) {
    const recipe = await findRecipe(recipeId, options);
    if (!recipe) throw new Error("历史同款案例不存在");
    const linkedSourceRecipe = recipe.sourceRecipeId
      ? await findRecipe(recipe.sourceRecipeId, options) || recipe
      : recipe;
    const selectedChangeType = changeType(input.changeType || recipe.changeType.id);
    const sourceRecipe = reusableSourceSnapshot(linkedSourceRecipe, selectedChangeType)
      ? linkedSourceRecipe
      : recipe;
    if (!reusableSourceSnapshot(sourceRecipe, selectedChangeType)) {
      const error = new Error(`历史模板的共享拆解快照缺少“${selectedChangeType.label}”所需的资产判断，已停止本次做同款；平台不会重新读取或拆解源画布，请先从可访问账号重新归档该模板。`);
      error.code = "HISTORY_SNAPSHOT_INCOMPLETE";
      throw error;
    }
    const job = newJob({
      taskId: recipe.source.taskId,
      changeType: selectedChangeType.id,
      taskName: input.taskName || `${recipe.title} · 再做同款`
    }, {
      canvasUrl: recipe.source.canvasUrl,
      spaceId: recipe.source.spaceId,
      projectId: recipe.source.projectId
    });
    bindCollectedSource(job, sourceRecipe, recipe.id);
    job.status = "preparing_history_remake";
    job.message = "已创建做同款任务，正在恢复共享 OSS 拆解快照";
    await save(job);
    runInJobContext(job, async () => {
      try {
        await prepareHistoryRemakeFromSnapshot(job, sourceRecipe);
        if (job.status === "awaiting_configuration" && Array.isArray(input.targets) && input.targets.length) {
          const worker = job.changeType.changesProduct ? prepareMapping : prepareAssets;
          await worker(job, input);
        }
      } catch (error) {
        recordJobFailure(job, "history_remake_failed", error);
        await save(job);
      }
    }).catch(() => {});
    return publicJob(job);
  }

  async function updateRecipeChangeType(recipeId, value, options = {}) {
    const recipe = await findRecipe(recipeId, { allowAnyOwner: true });
    if (!recipe) throw new Error("历史同款案例不存在");
    const currentOwnerKey = ownerKey().toLowerCase();
    const canEdit = options.allowAnyOwner === true || safeText(recipe.ownerKey, 128).toLowerCase() === currentOwnerKey;
    if (!canEdit) {
      const error = new Error("仅模板归属人或一键做同款历史任务管理员可修改分类");
      error.code = "HISTORY_CHANGE_TYPE_FORBIDDEN";
      error.statusCode = 403;
      throw error;
    }
    const selectedChangeType = changeType(value);
    const currentChangeType = safeText(recipe.changeType?.id, 40);
    const expectedChangeType = safeText(options.expectedChangeType, 40);
    if (expectedChangeType && expectedChangeType !== currentChangeType) {
      const error = new Error("该模板分类已被其他人修改，请刷新历史列表后重试");
      error.code = "HISTORY_CHANGE_TYPE_CONFLICT";
      error.statusCode = 409;
      throw error;
    }
    if (selectedChangeType.id === currentChangeType) return clone(recipe);
    const snapshotParams = recipe.source?.params || recipe.sourceSnapshot?.params || {};
    if (!auditCoversSourceParams(recipe.audit, snapshotParams) || !auditSupportsChangeType(recipe.audit, selectedChangeType)) {
      throw new Error(`当前共享拆解快照缺少“${selectedChangeType.label}”所需的资产判断，不能直接修改分类；请重新归档该模板。`);
    }
    const changedAt = isoNow();
    const changedBy = safeText(options.actor, 128) || recipe.createdBy || recipe.ownerKey;
    const updatedAudit = reclassifyAuditForChangeType(recipe.audit, selectedChangeType);
    const auditAssetsByNodeKey = new Map((updatedAudit.assets || []).map((asset) => [String(asset.nodeKey || ""), asset]));
    const updatedOrderedAssets = (recipe.sourceSnapshot?.orderedAssets || []).map((asset) => {
      const audited = auditAssetsByNodeKey.get(String(asset.nodeKey || ""));
      return audited ? {
        ...asset,
        rebuildRoles: clone(audited.rebuildRoles || []),
        rebuildRequired: audited.rebuildRequired === true,
        generationRequired: audited.generationRequired === true,
        replacementStrategy: audited.replacementStrategy || "reuse_source"
      } : asset;
    });
    const updated = {
      ...recipe,
      changeType: clone(selectedChangeType),
      audit: updatedAudit,
      tags: normalizeRecipeTags([
        selectedChangeType.label,
        selectedChangeType.id,
        ...(Array.isArray(recipe.tags) ? recipe.tags : []).filter((tag) => !CHANGE_TYPES.some((item) => item.id === tag || item.label === tag))
      ]),
      ...(recipe.sourceSnapshot ? {
        sourceSnapshot: {
          ...recipe.sourceSnapshot,
          orderedAssets: updatedOrderedAssets
        }
      } : {}),
      changeTypeUpdatedAt: changedAt,
      changeTypeUpdatedBy: changedBy,
      changeTypeHistory: [
        ...(Array.isArray(recipe.changeTypeHistory) ? recipe.changeTypeHistory : []),
        {
          from: currentChangeType,
          fromLabel: recipe.changeType?.label || "",
          to: selectedChangeType.id,
          toLabel: selectedChangeType.label,
          changedAt,
          changedBy
        }
      ].slice(-20)
    };
    return clone(await syncRecipe(updated, {
      actor: options.actor,
      forceSnapshotUpload: true
    }));
  }

  async function updateRecipeTitle(recipeId, title, options = {}) {
    const recipe = await findRecipe(recipeId, options);
    if (!recipe) throw new Error("历史同款案例不存在");
    const normalizedTitle = safeText(title, 200);
    if (!normalizedTitle) throw new Error("模板视频名称不能为空");
    const updated = {
      ...recipe,
      title: normalizedTitle,
      titleUpdatedAt: isoNow(),
      titleUpdatedBy: safeText(options.actor, 128) || recipe.createdBy || recipe.ownerKey
    };
    return clone(await syncRecipe(updated, {
      actor: options.actor,
      forceSnapshotUpload: true
    }));
  }

  async function updateRecipeTags(recipeId, tags, options = {}) {
    const recipe = await findRecipe(recipeId, options);
    if (!recipe) throw new Error("历史同款案例不存在");
    const normalizedTags = normalizeRecipeTags(tags);
    const updated = {
      ...recipe,
      tags: normalizedTags,
      tagsUpdatedAt: isoNow(),
      tagsUpdatedBy: safeText(options.actor, 128) || "管理员"
    };
    return clone(await syncRecipe(updated, {
      actor: options.actor,
      forceSnapshotUpload: true
    }));
  }

  async function updateRecipeOwner(recipeId, targetOwner = {}, options = {}) {
    if (options.allowAnyOwner !== true) throw new Error("仅一键做同款历史任务管理员可修改归属");
    const recipe = await findRecipe(recipeId, { ...options, allowAnyOwner: true });
    if (!recipe) throw new Error("历史同款案例不存在");
    const targetOwnerKey = safeText(targetOwner.key || targetOwner.ownerKey, 128).toLowerCase();
    const targetOwnerName = safeText(targetOwner.name || targetOwner.ownerName, 80);
    if (!targetOwnerKey || !targetOwnerName) throw new Error("请选择有效的归属人");
    const previousOwnerKey = safeText(recipe.ownerKey, 128);
    const previousOwnerName = safeText(recipe.ownerName || recipe.createdBy || recipe.ownerKey, 80);
    if (previousOwnerKey === targetOwnerKey && previousOwnerName === targetOwnerName) return clone(recipe);
    const changedAt = isoNow();
    const changedBy = safeText(options.actor, 128) || "管理员";
    const updated = {
      ...recipe,
      ownerKey: targetOwnerKey,
      ownerName: targetOwnerName,
      ownerUpdatedAt: changedAt,
      ownerUpdatedBy: changedBy,
      ownerTransferHistory: [
        ...(Array.isArray(recipe.ownerTransferHistory) ? recipe.ownerTransferHistory : []),
        {
          fromOwnerKey: previousOwnerKey,
          fromOwnerName: previousOwnerName,
          toOwnerKey: targetOwnerKey,
          toOwnerName: targetOwnerName,
          changedAt,
          changedBy
        }
      ].slice(-20)
    };
    return clone(await syncRecipe(updated, {
      actor: changedBy,
      forceSnapshotUpload: true
    }));
  }

  async function deleteRecipe(recipeId, options = {}) {
    const recipe = await findRecipe(recipeId, options);
    if (!recipe) throw new Error("历史同款案例不存在");
    let storage = { deleted: false, storageDeleted: false, warning: "" };
    if (typeof promptLibraryStore?.delete === "function") {
      storage = await promptLibraryStore.delete(String(recipeId), {
        ownerKey: options.allowAnyOwner === true ? "" : ownerKey(),
        actor: options.actor
      });
    }
    promptLibrary = promptLibrary.filter((item) => item.id !== recipe.id);
    await Promise.all([
      saveLibrary(),
      fsp.rm(recipeSnapshotPath(recipe), { force: true }).catch(() => {})
    ]);
    return {
      id: recipe.id,
      deleted: true,
      storageDeleted: storage.storageDeleted === true,
      warning: safeText(storage.warning, 1000)
    };
  }

  async function deleteFormalRecipe(recipeId, options = {}) {
    const recipe = await findRecipe(recipeId, { allowAnyOwner: true });
    if (!recipe || recipe.caseStage === "source_ready") throw new Error("正式案例不存在");
    const canManage = options.allowAnyOwner === true
      || safeText(recipe.ownerKey, 128).toLowerCase() === ownerKey().toLowerCase();
    if (!canManage) {
      const error = new Error("仅案例归属人或一键做同款管理员可删除正式案例");
      error.code = "FORMAL_CASE_DELETE_FORBIDDEN";
      error.statusCode = 403;
      throw error;
    }
    const deletedAt = isoNow();
    const deletedBy = safeText(options.actor, 160) || currentOwner()?.name || recipe.ownerName || recipe.ownerKey;
    const result = await deleteRecipe(recipe.id, options);
    const job = jobs.get(safeText(recipe.result?.jobId, 200));
    const target = (job?.targets || []).find((item) => item.id === safeText(recipe.result?.targetId, 200));
    if (target) {
      target.archive = {
        status: "removed",
        recipeId: recipe.id,
        ownerKey: recipe.ownerKey,
        ownerName: recipe.ownerName || recipe.createdBy || recipe.ownerKey,
        removedAt: deletedAt,
        removedBy: deletedBy
      };
      addEvent(job, "formal_case_removed", `${target.productName || "成片"} 已由${deletedBy}从正式提示词库移除`, {
        targetId: target.id,
        recipeId: recipe.id,
        deletedBy
      });
      await save(job);
    }
    return { ...result, deletedAt, deletedBy };
  }

  function candidateFile(jobId, targetId, sourceNodeKey, candidateIndex) {
    const job = requireJob(jobId);
    const target = job.targets.find((item) => item.id === targetId);
    const group = target?.assetGroups?.find((item) => item.sourceNodeKey === sourceNodeKey);
    const candidate = group?.candidates?.[Number(candidateIndex)];
    if (!candidate?.localPath || !fs.existsSync(candidate.localPath)) throw new Error("候选图不存在");
    return candidate.localPath;
  }

  function directUploadedFirstFrameGroup(job, target, sourceAsset, override) {
    if (!override?.localPath || !fs.existsSync(override.localPath)) {
      throw new Error("用户上传的新首帧文件不存在，请重新上传");
    }
    const candidate = {
      id: uid("uploaded-first-frame"),
      sourceNodeKey: sourceAsset.nodeKey,
      sourceLabel: sourceAsset.label,
      model: "用户上传完整首帧",
      taskId: "",
      remoteUrl: override.storageUrl || override.url || "",
      localPath: override.localPath,
      previewUrl: `./api/one-click-remake/jobs/${encodeURIComponent(job.id)}/candidates/${encodeURIComponent(target.id)}/${encodeURIComponent(sourceAsset.nodeKey)}/0`,
      createdAt: isoNow(),
      directReuse: true,
      directReuseLabel: "用户上传首帧",
      preselected: true,
      originalFileName: override.label || ""
    };
    target.selectedAssets[sourceAsset.nodeKey] = candidate.id;
    return {
      sourceNodeKey: sourceAsset.nodeKey,
      sourceLabel: sourceAsset.label,
      sourceUrl: sourceAsset.url,
      sourceMode: "uploaded_first_frame",
      firstFrameOverride: clone(override),
      compiler: {
        category: { id: "uploaded_first_frame", label: "用户上传首帧直替" },
        imagePrompt: "用户上传图片直接替换源首帧 nodeKey，不执行提示词编译或生图。",
        negativePrompt: "禁止把该图片作为额外背景参考；禁止二次生成首帧。",
        scalePlan: { strategy: "replace_source_first_frame_node", sourceNodeKey: sourceAsset.nodeKey },
        layoutLocks: ["用户上传图片的完整像素内容"],
        inputOrder: ["用户上传完整新首帧"],
        validationChecklist: ["替换源首帧 nodeKey", "未新增背景参考节点", "未执行图片生成"],
        model: "deterministic-routing",
        promptSource: "user_upload"
      },
      generationRounds: [{
        round: 1,
        promptSource: "user_upload",
        prompt: "用户上传首帧直替，不执行生图",
        candidateIds: [candidate.id],
        createdAt: candidate.createdAt
      }],
      candidates: [candidate]
    };
  }

  function backgroundSceneCandidateFile(jobId, candidateId) {
    const job = requireJob(jobId);
    const candidate = (job.backgroundSceneGeneration?.candidates || [])
      .find((item) => String(item.id) === String(candidateId || ""));
    if (!candidate?.localPath || !fs.existsSync(candidate.localPath)) throw new Error("背景候选图不存在");
    return candidate.localPath;
  }

  function resultFile(jobId, targetId, round = 0) {
    const job = requireJob(jobId);
    const target = job.targets.find((item) => item.id === targetId);
    const selected = Number(round) > 0
      ? (target?.videoRounds || []).find((item) => Number(item.round) === Number(round))
      : target?.result;
    if (!selected?.localPath || !fs.existsSync(selected.localPath)) throw new Error("结果视频不存在");
    return { filePath: selected.localPath, fileName: path.basename(selected.localPath) };
  }

  function getProgressMode() {
    const visible = [...jobs.values()].filter(owned);
    const active = visible.filter((job) => (
      ACTIVE_STATUSES.has(job.status)
      || ["queued", "running"].includes(job.backgroundSceneGeneration?.status)
    ));
    const awaitingReview = visible.filter((job) => job.status === "awaiting_manual_review");
    const tracked = active.length ? active : awaitingReview;
    const percent = tracked.length
      ? Math.round(tracked.reduce((sum, job) => sum + (
          ["queued", "running"].includes(job.backgroundSceneGeneration?.status)
            ? 50
            : Number(job.progress || 0)
        ), 0) / tracked.length)
      : 0;
    const latest = tracked.sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)))[0];
    return {
      mode: "remake",
      label: "一键做同款",
      status: active.length ? "running" : awaitingReview.length ? "awaiting_review" : "idle",
      activeCount: active.length,
      percent,
      message: latest?.message || (visible.some((job) => TERMINAL_STATUSES.has(job.status)) ? "最近任务已完成" : "等待创建任务"),
      href: "./one-click-remake.html"
    };
  }

  function config() {
    const products = getProducts().map((product) => {
      const rankedAssets = rankProductAssets(productWorkflows.listAssets({ productId: product.id, assetType: "image" }), product)
        .map((asset) => ({
          ...asset,
          thumbnailUrl: `./api/product-workflows/assets/${encodeURIComponent(asset.id)}/thumbnail`
        }));
      const states = buildProductStateCatalog(product, rankedAssets);
      const recommendedState = recommendDisplayState(product, states);
      const assetFacts = new Map(states.flatMap((state) => state.assets.map((asset) => [String(asset.id), {
        stateId: state.id,
        view: asset.view,
        status: asset.status,
        confidence: asset.confidence,
        evidence: asset.evidence
      }])));
      let recommendedAssetAssigned = false;
      return {
        id: product.id,
        name: product.name || product.platformName || product.id,
        shortName: product.shortName || "",
        productProfile: clone(product.productProfile || product.replacementContract || null),
        recommendedDisplayStateId: recommendedState?.id || "",
        states: states.map((state) => ({
          id: state.id,
          label: state.label,
          shape: state.shape,
          dimensionsCm: clone(state.dimensionsCm),
          fixedLengthWidthHeightRatio: clone(state.fixedLengthWidthHeightRatio),
          allowedActions: clone(state.allowedActions),
          forbiddenActions: clone(state.forbiddenActions),
          isDefault: state.isDefault,
          selectable: state.selectable,
          dataGaps: clone(state.dataGaps),
          assetIds: state.assets.map((asset) => asset.id)
        })),
        assets: rankedAssets.map((asset) => {
          const facts = assetFacts.get(String(asset.id)) || {};
          const recommended = !recommendedAssetAssigned && facts.stateId === recommendedState?.id;
          if (recommended) recommendedAssetAssigned = true;
          return {
          id: asset.id,
          title: asset.title || asset.fileName || asset.id,
          angleLabel: asset.angleLabel || "",
          thumbnailUrl: asset.thumbnailUrl,
          displayStateId: facts.stateId || "",
          view: facts.view || "unknown",
          status: facts.status || "closed",
          classificationConfidence: facts.confidence ?? 0,
          classificationEvidence: facts.evidence || "",
          recommended,
          matchScore: productAssetScore(asset, product)
        };
        })
      };
    });
    return {
      schemaVersion: "one-click-remake-config-v2",
      changeTypes: CHANGE_TYPES.map(clone),
      imagePromptCategories: IMAGE_PROMPT_CATEGORIES.map(clone),
      products,
      productStateTypes: PRODUCT_STATE_TYPES.map(clone),
      quantityControlTemplate: {
        version: "quantity-control-retired-v2",
        enabled: quantityControlEnabled,
        retired: true,
        policy: "inherit_source_observation",
        explanation: "不再做投影面积或固定数量换算；每个上游图片节点逐实例继承源图数量与槽位。"
      },
      productGeometry: productGeometry?.status?.() || { configured: false, policy: "preserve_source_slots" },
      promptCompiler: qwen?.status?.() || { configured: false, model: "qwen3.7-plus" },
      imageModels: [
        { id: options.primaryImageModel || "openai/gpt-image-2", label: "GPT Image 2", role: "primary" },
        { id: options.fallbackImageModel || "doubao-seedream-5-0-pro-260628", label: "Seedream 5.0 Pro", role: "fallback" }
      ],
      imageGeneration: {
        maxRounds: MAX_IMAGE_GENERATION_ROUNDS,
        candidatesPerRound: 2,
        customCandidateUpload: true
      },
      backgroundSceneGeneration: {
        maxRounds: MAX_BACKGROUND_SCENE_GENERATION_ROUNDS,
        candidatesPerRound: 2,
        source: "source_canvas_first_frame",
        selectionModes: ["generated", "uploaded_first_frame"],
        uploadPolicy: "replace_source_first_frame_node"
      },
      confirmationRequired: true,
      productProfileSource: "平台内置 7 款产品资料入库（当前版本）",
      promptLibrary: {
        snapshotStorage: "阿里云 OSS",
        indexStorage: "平台素材中心数据库",
        localFallback: true,
        searchableFields: ["keyword", "canvasUrl", "productId", "changeType", "videoType", "model", "taskId", "dateFrom", "dateTo"]
      }
    };
  }

  return {
    init,
    config,
    createJob,
    listJobs,
    getJob,
    updateJob,
    deleteJob,
    updateProductPresence,
    updateProductGeometryReview,
    startPreparation,
    confirmMappings,
    generateBackgroundSceneCandidates,
    regenerateImageCandidates,
    uploadCustomImageCandidate,
    confirmAssets,
    retryFailedStage,
    reconfigureUpstreamAssets,
    retryTargetVideo,
    reviewTargetVideo,
    listRecipes,
    searchRecipes,
    searchHistoryRecipes,
    listFormalCaseCandidates,
    addFormalRecipe,
    addSourceFormalRecipe,
    findCollectedSource,
    remakeFromRecipe,
    updateRecipeChangeType,
    updateRecipeTitle,
    updateRecipeTags,
    updateRecipeOwner,
    deleteRecipe,
    deleteFormalRecipe,
    candidateFile,
    backgroundSceneCandidateFile,
    resultFile,
    getProgressMode,
    syncPendingRecipes,
    recoverPersistedVideoResults,
    flush: async () => Promise.all([...saveQueues.values(), librarySaveQueue])
  };
}

module.exports = {
  CHANGE_TYPES,
  IMAGE_PROMPT_CATEGORIES,
  imagePromptCategory,
  backgroundSceneSourceAsset,
  backgroundSceneGenerationPrompt,
  enforceGeometryCompiler,
  parseCliJson,
  requiredProductAssetIds,
  mergeRemakeProductCatalog,
  parseCanvasUrl,
  changeType,
  auditSupportsChangeType,
  reclassifyAuditForChangeType,
  orderedMedia,
  auditCoversSourceParams,
  analyzeSourceTextAsset,
  textHasExplicitProductSemantics,
  shouldCompileTextAssetWithModel,
  groundModelTextConflicts,
  compileTextAssetForTarget,
  buildStaticTextNodeArgs,
  textAssetCompilerMessages,
  replaceNodeReferences,
  buildVideoNodeArgs,
  normalizeRecipeSearchFilters,
  searchLocalRecipes,
  collapseHistoryRecipes,
  productVisualLayer,
  selectProductVisualReferences,
  visualProductMatchMessages,
  normalizeVisualProductCandidates,
  resolveSourceProductRecommendation,
  promptCompilerMessages,
  actionResolutionMessages,
  validActionResolutionDraft,
  compilerForUserImagePrompt,
  videoPromptCompilerMessages,
  videoQualityMessages,
  normalizeVideoQuality,
  auditMessages,
  normalizeCarrierProps,
  carrierVideoActionInstruction,
  applyCarrierVideoActionInstruction,
  productPixelEvidence,
  sourceProductPixelClaims,
  resolveProductBearing,
  productPresenceReviewSignals,
  productPresenceReviewMessages,
  nodePromptContext,
  applyProductPresenceDecision,
  modelConfirmedProductPixels,
  videoPromptAssetInstructionLeaks,
  stripVideoPromptAssetInstructions,
  mappingRequiresAssetPreparation,
  carrierRegenerationRequired,
  buildUpstreamAssetManifest,
  validateUpstreamAssetManifest,
  libtvProjectId,
  exactLibtvProjects,
  taskCanvasName,
  defaultRemakeTaskName,
  COLLECTED_TEMPLATE_MESSAGE,
  interruptedResumeKind,
  createOneClickRemakeRuntime
};
