"use strict";

const state = {
  defaults: null,
  assets: [],
  selectedAssetIds: new Set(),
  firstFrameAvailableAssetIds: [],
  firstFrameAssetIds: new Set(),
  pickerSelectedIds: [],
  temporaryAssets: [],
  assetUploadBusy: false,
  referenceUpload: null,
  job: null,
  polling: null,
  pollingBusy: false,
  generatedJob: null,
  generatedPolling: null,
  generatedPollingBusy: false,
  firstFrameStrategy: "",
  firstFramePromptDirty: false,
  activeFirstFrameCandidateId: "",
  previewedFirstFrameId: "",
  durationUserModified: false,
  shotPlanSaving: false,
  shotPlanReplanning: false,
  shotAnchorBusyUnitId: "",
  shotAnchorBusyFrameId: "",
  shotAnchorBatchBusy: false,
  shotPlanDirty: false,
  shotPlanActiveJobId: "",
  shotPlanActiveUnitId: "",
  shotAnchorActiveCandidateIds: {},
  shotPlanAdjusting: false,
  sourceAnalysisExpanded: false,
  sourceAnalysisActiveJobId: "",
  voiceoverDecisionDirty: false,
  voiceoverDecisionSaving: false,
  voiceoverDecisionJobId: ""
};
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const PROXY_SAFE_UPLOAD_CHUNK_BYTES = 768 * 1024;
const MAX_PRODUCT_SELECTION = 8;
const FIRST_FRAME_BATCH_SIZE = 2;
const FIRST_FRAME_TERMINAL_STATUSES = new Set(["success", "failed", "stale"]);
const REFERENCE_FIRST_FRAME_CANDIDATE_ID = "reference-first-frame";
const REPLACEMENT_ACTIVE_TASK_KEY = "one-click-replacement-current-task-v1";
const REPLACEMENT_DRAFT_KEY = "one-click-replacement-draft-v1";
const REPLACEMENT_RULES_HIDDEN_KEY = "one-click-replacement-rules-hidden-v1";
const replacementEntryParams = new URLSearchParams(location.search);
let replacementTaskPersistenceSuspended = false;
let replacementDraftSyncTimer = null;
let replacementDraftSyncPending = null;
let replacementDraftSyncInFlight = false;
let replacementDraftSyncLast = "";

function setReplacementRulesHidden(hidden, { persist = true } = {}) {
  const workspace = $("#replacementRulesWorkspace");
  const panel = $("#replacementRulesPanel");
  const showButton = $("#showReplacementRulesButton");
  if (!workspace || !panel || !showButton) return;
  workspace.classList.toggle("rules-hidden", hidden);
  panel.hidden = hidden;
  showButton.hidden = !hidden;
  showButton.setAttribute("aria-expanded", String(!hidden));
  if (persist) localStorage.setItem(REPLACEMENT_RULES_HIDDEN_KEY, hidden ? "1" : "0");
}

function prepareNewReplacementTask(event) {
  if (event?.detail?.module !== "replace-product.html") return;
  replacementTaskPersistenceSuspended = true;
  state.shotPlanActiveJobId = "";
  state.shotPlanActiveUnitId = "";
  state.shotAnchorActiveCandidateIds = {};
  state.shotPlanAdjusting = false;
  state.sourceAnalysisExpanded = false;
  state.sourceAnalysisActiveJobId = "";
  state.activeFirstFrameCandidateId = "";
  state.firstFrameStrategy = "";
  state.voiceoverDecisionDirty = false;
  state.voiceoverDecisionSaving = false;
  state.voiceoverDecisionJobId = "";
  clearTimeout(replacementDraftSyncTimer);
  replacementDraftSyncPending = null;
  localStorage.removeItem(REPLACEMENT_ACTIVE_TASK_KEY);
  localStorage.removeItem(REPLACEMENT_DRAFT_KEY);
}

window.addEventListener("module-task-new", prepareNewReplacementTask);

function persistentTemporaryAsset(asset) {
  return {
    id: asset.id,
    name: asset.name,
    path: asset.path || asset.localPath,
    size: asset.size || 0,
    previewUrl: asset.path || asset.localPath ? `./api/image?path=${encodeURIComponent(asset.path || asset.localPath)}` : asset.previewUrl
  };
}

function queueReplacementDraftSync(draftData) {
  if (replacementTaskPersistenceSuspended || state.job?.status !== "draft" || !state.job.id) return;
  const saved = { ...draftData };
  delete saved.savedAt;
  const serialized = JSON.stringify(saved);
  if (serialized === replacementDraftSyncLast) return;
  replacementDraftSyncPending = { jobId: state.job.id, draftData: saved, serialized };
  clearTimeout(replacementDraftSyncTimer);
  replacementDraftSyncTimer = setTimeout(flushReplacementDraftSync, 250);
}

async function flushReplacementDraftSync() {
  if (replacementDraftSyncInFlight || !replacementDraftSyncPending) return;
  const pending = replacementDraftSyncPending;
  replacementDraftSyncPending = null;
  replacementDraftSyncInFlight = true;
  try {
    await api(`./api/product-workflows/replacement-jobs/${encodeURIComponent(pending.jobId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ draftData: pending.draftData })
    });
    replacementDraftSyncLast = pending.serialized;
    window.dispatchEvent(new Event("module-task-updated"));
  } catch (error) {
    if (state.job?.id === pending.jobId && state.job?.status === "draft") {
      notice($("#replaceTaskNotice"), `草稿自动保存失败：${error.message}`, true);
    }
  } finally {
    replacementDraftSyncInFlight = false;
    if (replacementDraftSyncPending) replacementDraftSyncTimer = setTimeout(flushReplacementDraftSync, 250);
  }
}

function saveReplacementDraft() {
  if (!state.defaults || replacementTaskPersistenceSuspended) return;
  const draft = {
    taskId: state.job?.id || "",
    referenceUpload: state.referenceUpload,
    productId: $("#replaceProductSelect")?.value || "",
    productName: currentProduct()?.name || "",
    selectedAssetIds: [...state.selectedAssetIds],
    firstFrameAvailableAssetIds: [...state.firstFrameAvailableAssetIds],
    firstFrameAssetIds: [...state.firstFrameAssetIds],
    firstFrameStrategy: state.firstFrameStrategy,
    temporaryAssets: state.temporaryAssets.map(persistentTemporaryAsset),
    replacementMode: selectedRadio("replacementMode"),
    generationMode: selectedRadio("generationMode") || "manual",
    voiceoverMode: selectedRadio("voiceoverMode"),
    imageModel: selectedImageModel(),
    videoModelId: $("#replacementVideoModel")?.value || "",
    videoDuration: Number($("#replacementVideoDuration")?.value || 0),
    videoClarity: $("#replacementVideoClarity")?.value || "",
    durationUserModified: state.durationUserModified,
    taskVariables: replacementTaskVariables(),
    lockedScript: $("#lockedScript")?.value ?? state.job?.lockedScript?.lockedScript ?? "",
    savedAt: new Date().toISOString()
  };
  if (state.job?.status === "draft" || draft.referenceUpload?.path || draft.temporaryAssets.length || draft.selectedAssetIds.length || draft.firstFrameAvailableAssetIds.length || draft.firstFrameAssetIds.length || draft.lockedScript.trim() || draft.taskVariables.backgroundDescription) {
    localStorage.setItem(REPLACEMENT_DRAFT_KEY, JSON.stringify(draft));
  }
  queueReplacementDraftSync(draft);
}

function applyReplacementForm(snapshot = {}) {
  state.firstFrameStrategy = ["reference", "generate"].includes(snapshot.firstFrameStrategy) ? snapshot.firstFrameStrategy : "";
  if (snapshot.productId && [...$("#replaceProductSelect").options].some((option) => option.value === snapshot.productId)) $("#replaceProductSelect").value = snapshot.productId;
  syncReplaceProductSelectDisplay();
  for (const [name, value] of [["replacementMode", snapshot.replacementMode], ["voiceoverMode", snapshot.voiceoverMode], ["imageModel", snapshot.imageModel], ["generationMode", snapshot.generationMode || "manual"]]) {
    const input = [...document.querySelectorAll(`input[name="${name}"]`)].find((item) => item.value === value);
    if (input) input.checked = true;
  }
  renderReplacementVideoModels(snapshot.videoModelId || snapshot.selectedVideoModelId || "");
  state.durationUserModified = Boolean(snapshot.durationUserModified || snapshot.videoDuration);
  renderReplacementVideoSettings({
    duration: snapshot.videoDuration || snapshot.duration,
    clarity: snapshot.videoClarity || snapshot.clarity
  });
  const taskVariables = snapshot.taskVariables || {};
  if (typeof taskVariables.originalProductName === "string") $("#originalProductName").value = taskVariables.originalProductName;
  if (typeof taskVariables.backgroundDescription === "string") $("#backgroundDescription").value = taskVariables.backgroundDescription;
  if (typeof snapshot.lockedScript === "string") $("#lockedScript").value = snapshot.lockedScript;
  updateVoiceoverUi();
  renderAnalysisWorkspace(state.job);
}

async function restoreReplacementTask() {
  if (replacementEntryParams.has("new") && !replacementEntryParams.get("task")) return;
  const taskId = new URLSearchParams(location.search).get("task") || localStorage.getItem(REPLACEMENT_ACTIVE_TASK_KEY) || "";
  if (taskId) {
    try {
      const result = await api(`./api/product-workflows/replacement-jobs/${encodeURIComponent(taskId)}`);
      state.job = result.job;
      if (result.job.status === "draft") {
        let localDraft = null;
        try { localDraft = JSON.parse(localStorage.getItem(REPLACEMENT_DRAFT_KEY) || "null"); } catch {}
        if (localDraft?.taskId && localDraft.taskId !== taskId) localDraft = null;
        const snapshot = { ...(result.job.draftData || {}), ...(localDraft || {}) };
        state.referenceUpload = snapshot.referenceUpload || null;
        renderUploadedReferenceAssets();
        applyReplacementForm(snapshot);
        await loadAssets();
        const restoredAssetIds = new Set(state.assets.map((asset) => asset.id));
        state.selectedAssetIds = new Set((snapshot.selectedAssetIds || []).filter((id) => restoredAssetIds.has(id)));
        state.firstFrameAvailableAssetIds = (snapshot.firstFrameAvailableAssetIds || snapshot.selectedAssetIds || []).filter((id) => restoredAssetIds.has(id));
        state.firstFrameAssetIds = new Set((snapshot.firstFrameAssetIds || snapshot.selectedAssetIds || []).filter((id) => state.firstFrameAvailableAssetIds.includes(id)));
        state.temporaryAssets = (snapshot.temporaryAssets || []).map(persistentTemporaryAsset);
        localStorage.setItem(REPLACEMENT_ACTIVE_TASK_KEY, taskId);
        renderAssets();
        if (state.referenceUpload?.path) notice($("#referenceUploadStatus"), `${state.referenceUpload.name || "参考视频"} · 已从草稿恢复`);
        notice($("#replaceTaskNotice"), "已创建独立任务草稿，填写内容会自动保存。", false);
        return;
      }
      state.referenceUpload = { path: result.job.referenceVideoPath, name: result.job.referenceVideoName, size: result.job.referenceVideoSize };
      applyReplacementForm({ ...result.job, lockedScript: result.job.lockedScript?.lockedScript || "" });
      await loadAssets();
      const restoredAssetIds = new Set(state.assets.map((asset) => asset.id));
      state.selectedAssetIds = new Set((result.job.productAssetIds || []).filter((id) => restoredAssetIds.has(id)));
      state.firstFrameAvailableAssetIds = (Array.isArray(result.job.firstFrameAvailableAssetIds)
        ? result.job.firstFrameAvailableAssetIds
        : (result.job.productAssetIds || [])).filter((id) => restoredAssetIds.has(id));
      state.firstFrameAssetIds = new Set((Array.isArray(result.job.firstFrameAssetIds)
        ? result.job.firstFrameAssetIds
        : (result.job.productAssetIds || [])).filter((id) => state.firstFrameAvailableAssetIds.includes(id)));
      state.temporaryAssets = (result.job.temporaryProductAssets || []).map(persistentTemporaryAsset);
      state.firstFramePromptDirty = false;
      localStorage.setItem(REPLACEMENT_ACTIVE_TASK_KEY, taskId);
      notice($("#referenceUploadStatus"), `${result.job.referenceVideoName || "参考视频"} · 已从任务恢复`);
      renderAssets();
      renderJob();
      if (!["failed", "first_frame_failed", "ready_to_generate", "awaiting_first_frame_selection", "generation_started", "review_required", "voiceover_verified"].includes(result.job.status)) startPolling();
      if (result.job.generatedJobId) startGeneratedJobPolling();
      return;
    } catch (error) {
      localStorage.removeItem(REPLACEMENT_ACTIVE_TASK_KEY);
      notice($("#replaceTaskNotice"), `无法恢复任务：${error.message}`, true);
    }
  }
  let draft = null;
  try { draft = JSON.parse(localStorage.getItem(REPLACEMENT_DRAFT_KEY) || "null"); } catch {}
  if (!draft) return;
  state.referenceUpload = draft.referenceUpload || null;
  renderUploadedReferenceAssets();
  applyReplacementForm(draft);
  await loadAssets();
  state.selectedAssetIds = new Set((draft.selectedAssetIds || []).filter((id) => state.assets.some((asset) => asset.id === id)));
  const draftFirstFrameAvailableAssetIds = Array.isArray(draft.firstFrameAvailableAssetIds)
    ? draft.firstFrameAvailableAssetIds
    : (draft.selectedAssetIds || []);
  state.firstFrameAvailableAssetIds = draftFirstFrameAvailableAssetIds.filter((id) => state.assets.some((asset) => asset.id === id));
  const draftFirstFrameAssetIds = Array.isArray(draft.firstFrameAssetIds) ? draft.firstFrameAssetIds : draft.selectedAssetIds;
  state.firstFrameAssetIds = new Set((draftFirstFrameAssetIds || []).filter((id) => state.firstFrameAvailableAssetIds.includes(id)));
  state.temporaryAssets = (draft.temporaryAssets || []).map(persistentTemporaryAsset);
  renderAssets();
  if (state.referenceUpload?.path) notice($("#referenceUploadStatus"), `${state.referenceUpload.name || "参考视频"} · 已恢复上传草稿`);
}

async function api(url, options = {}) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (response.status === 401 && data.loginRequired) location.href = "./login.html";
  if (!response.ok) {
    const error = new Error(data.error || `请求失败（${response.status}）`);
    error.payload = data;
    throw error;
  }
  return data;
}

function notice(element, message, error = false) {
  element.hidden = !message;
  element.textContent = message;
  element.classList.toggle("error", error);
  element.classList.toggle("compliance-error", error && /素材审核未通过|合规审核/.test(String(message || "")));
}

function currentProduct() {
  return state.defaults.products.find((item) => item.id === $("#replaceProductSelect").value) || state.defaults.products[0];
}

function replacementTaskVariables() {
  return {
    originalProductName: $("#originalProductName")?.value.trim() || "参考视频中的原产品",
    newProductName: $("#newProductName")?.value.trim() || currentProduct()?.name || "",
    backgroundDescription: $("#backgroundDescription")?.value.trim() || ""
  };
}

function syncReplaceProductSelectDisplay() {
  const select = $("#replaceProductSelect");
  const display = $("#replaceProductSelectDisplay");
  if (!select || !display) return;
  const label = select.selectedOptions?.[0]?.textContent?.trim() || "请选择目标产品";
  display.textContent = label;
  display.title = label;
  select.title = label;
  if ($("#newProductName")) $("#newProductName").value = currentProduct()?.name || "";
}

function selectedRadio(name) {
  return document.querySelector(`input[name="${name}"]:checked`)?.value || "";
}

function replacementVideoModels() {
  const configured = Array.isArray(state.defaults?.videoModels) ? state.defaults.videoModels : [];
  return configured.length ? configured : [
    { id: "seedance-2-vip", label: "Seedance 2.0 VIP", durationMin: 4, durationMax: 15, defaultDuration: 5, maxProductImages: 9, maxReferenceImages: 9, defaultClarity: "720p", clarityOptions: [{ value: "480p", label: "480P" }, { value: "720p", label: "720P" }, { value: "1080p", label: "1080P" }] },
    { id: "seedance-2-5", label: "Seedance 2.5", durationMin: 4, durationMax: 30, defaultDuration: 5, maxProductImages: 9, maxReferenceImages: 9, defaultClarity: "720p", clarityOptions: [{ value: "480p", label: "480P" }, { value: "720p", label: "720P" }, { value: "1080p", label: "1080P" }] },
    { id: "kling-o3", label: "Kling O3", durationMin: 3, durationMax: 10, defaultDuration: 5, minReferenceVideoDuration: 3, maxReferenceVideoDuration: 10, maxProductImages: 3, maxReferenceImages: 3, defaultClarity: "low", clarityOptions: [{ value: "low", label: "标准" }, { value: "high", label: "高品质" }, { value: "4k", label: "4K" }] }
  ];
}

function selectedReplacementVideoModel() {
  const models = replacementVideoModels();
  const requestedId = $("#replacementVideoModel")?.value || state.job?.videoModelId || state.defaults?.defaultVideoModelId || "seedance-2-vip";
  return models.find((model) => model.id === requestedId)
    || models.find((model) => model.available !== false)
    || models[0];
}

function replacementVideoModelCompatibility(job = state.job) {
  const model = selectedReplacementVideoModel();
  if (!model) return { ok: false, model: null, message: "没有可用的视频生成模型" };
  if (model.available === false) {
    return { ok: false, model, message: `${model.label} 当前不可用：${model.unavailableReason || "当前账号积分不足"}` };
  }
  const productCount = job
    ? (job.productAssetIds?.length || 0) + (job.temporaryProductAssets?.length || 0)
    : selectedProductImageCount();
  const maxProducts = Math.min(MAX_PRODUCT_SELECTION, Math.max(1, Number(model.maxProductImages || MAX_PRODUCT_SELECTION)));
  if (["product", "both"].includes(job?.replacementMode || selectedRadio("replacementMode")) && productCount > maxProducts) {
    return { ok: false, model, message: `${model.label} 在参考视频模式下最多支持${maxProducts}张产品参考图` };
  }
  const referenceDuration = Number(job?.referenceAssets?.duration || state.referenceUpload?.referenceAssets?.duration || 0);
  const referenceDurations = referenceDuration > 0 ? [referenceDuration] : [];
  if (referenceDurations.some((duration) => Number(model.minReferenceVideoDuration || 0) > 0 && duration + 0.05 < Number(model.minReferenceVideoDuration))) {
    return { ok: false, model, message: `${model.label} 当前LibTV参考视频要求至少${model.minReferenceVideoDuration}秒` };
  }
  if (referenceDurations.some((duration) => Number(model.maxReferenceVideoDuration || 0) > 0 && duration > Number(model.maxReferenceVideoDuration) + 0.05)) {
    return { ok: false, model, message: `${model.label} 当前LibTV完整参考视频最长支持${model.maxReferenceVideoDuration}秒；请切换支持该时长的模型` };
  }
  const duration = Number($("#replacementVideoDuration")?.value || model.defaultDuration || model.durationMin);
  if (!Number.isInteger(duration) || duration < Number(model.durationMin) || duration > Number(model.durationMax)) {
    return { ok: false, model, message: `${model.label} 的视频时长仅支持${model.durationMin}-${model.durationMax}秒` };
  }
  const clarity = $("#replacementVideoClarity")?.value || model.defaultClarity;
  if (!model.clarityOptions?.some((item) => item.value === clarity)) {
    return { ok: false, model, message: `${model.label} 不支持当前选择的清晰度` };
  }
  return { ok: true, model, message: model.availabilityMessage || `${model.label} 将同步到 LibTV` };
}

function replacementReferenceDuration() {
  return Number(state.job?.referenceAssets?.duration || state.referenceUpload?.referenceAssets?.duration || 0);
}

function renderReplacementVideoSettings(options = {}) {
  const model = selectedReplacementVideoModel();
  const durationSelect = $("#replacementVideoDuration");
  const claritySelect = $("#replacementVideoClarity");
  if (!model || !durationSelect || !claritySelect) return;
  const minimum = Number(model.durationMin || 4);
  const maximum = Number(model.durationMax || 15);
  const referenceDuration = replacementReferenceDuration();
  const requestedDuration = Number(options.duration || durationSelect.value || 0);
  const synchronizedDuration = referenceDuration > 0 ? Math.round(referenceDuration) : Number(model.defaultDuration || minimum);
  const baseDuration = options.syncReference || !Number.isFinite(requestedDuration) || requestedDuration <= 0
    ? synchronizedDuration
    : requestedDuration;
  const duration = Math.max(minimum, Math.min(maximum, Math.round(baseDuration)));
  durationSelect.innerHTML = Array.from({ length: maximum - minimum + 1 }, (_, index) => minimum + index)
    .map((value) => `<option value="${value}"${value === duration ? " selected" : ""}>${value}秒</option>`)
    .join("");
  const clarityOptions = Array.isArray(model.clarityOptions) ? model.clarityOptions : [];
  const requestedClarity = String(options.clarity || claritySelect.value || "");
  const clarity = clarityOptions.find((item) => item.value === requestedClarity)
    || clarityOptions.find((item) => item.value === model.defaultClarity)
    || clarityOptions[0];
  claritySelect.innerHTML = clarityOptions.map((item) => `<option value="${escapeHtml(item.value)}"${item.value === clarity?.value ? " selected" : ""}>${escapeHtml(item.label)}</option>`).join("");
  const durationHint = $("#replacementVideoDurationHint");
  durationHint.textContent = referenceDuration > 0
    ? `原片${referenceDuration.toFixed(1)}秒，已同步为${duration}秒；可手动修改（${minimum}-${maximum}秒）`
    : `上传后同步原片时长；支持${minimum}-${maximum}秒`;
  $("#replacementVideoClarityHint").textContent = `${model.label} · ${clarityOptions.map((item) => item.label).join(" / ")}`;
}

function updateReplacementVideoModelHint() {
  const compatibility = replacementVideoModelCompatibility();
  const hint = $("#replacementVideoModelHint");
  if (!hint) return compatibility;
  hint.textContent = compatibility.message;
  hint.classList.toggle("error", !compatibility.ok);
  return compatibility;
}

function renderReplacementVideoModels(preferredId = "") {
  const select = $("#replacementVideoModel");
  if (!select || !state.defaults) return;
  const models = replacementVideoModels();
  const requested = models.find((model) => model.id === preferredId)
    || models.find((model) => model.id === state.defaults.defaultVideoModelId)
    || models.find((model) => model.available !== false)
    || models[0];
  select.innerHTML = models.map((model) => `<option value="${escapeHtml(model.id)}"${model.id === requested?.id ? " selected" : ""}${model.available === false ? " disabled" : ""}${model.availabilityMessage ? ` title="${escapeHtml(model.availabilityMessage)}"` : ""}>${escapeHtml(model.label)}${model.available === false ? `（${escapeHtml(model.unavailableReason || "积分不足")}）` : ""}</option>`).join("");
  renderReplacementVideoSettings();
  updateReplacementVideoModelHint();
}

function selectedImageModel() {
  return selectedRadio("imageModel") || state.defaults?.imageModel || "openai/gpt-image-2";
}

function imageModelLabel(model = selectedImageModel()) {
  return state.defaults?.imageModels?.find((item) => item.id === model)?.label
    || (model === "doubao-seedream-5-0-pro-260628" ? "Seedream 5.0 Pro" : "GPT Image 2");
}

function firstFramePromptForJob(job = state.job) {
  const candidates = Array.isArray(job?.firstFrameCandidates) ? job.firstFrameCandidates : [];
  const latestWithPrompt = [...candidates].reverse().find((candidate) => String(candidate.prompt || "").trim());
  const cleanupOnly = ["product", "both"].includes(job?.replacementMode || selectedRadio("replacementMode") || "product")
    && state.firstFrameStrategy === "generate"
    && selectedFirstFrameAssetCount() === 0;
  const defaultPrompt = job?.replacementMode === "background"
    ? state.defaults?.replacementBackgroundFirstFramePrompt
    : cleanupOnly
      ? state.defaults?.referenceFirstFrameCleanupPrompt
    : state.defaults?.replacementFirstFramePrompt;
  if (cleanupOnly) return String(defaultPrompt || "").trim();
  return String(job?.firstFramePrompt || latestWithPrompt?.prompt || defaultPrompt || "").trim();
}

function replacementGenerationFailed(job = state.job, generatedJob = state.generatedJob) {
  const generatedJobId = String(job?.generatedJobId || "");
  return Boolean(generatedJobId)
    && String(generatedJob?.id || "") === generatedJobId
    && ["failed", "interrupted"].includes(String(generatedJob?.status));
}

function voiceoverEditingLocked(job = state.job) {
  return Boolean(job)
    && (Boolean(job.generatedJobId) || job.status === "generation_started")
    && !replacementGenerationFailed(job);
}

function setFirstFramePromptExpanded(expanded) {
  const panel = $("#firstFramePromptPanel");
  const toggle = $("#toggleFirstFramePromptButton");
  if (!panel || !toggle) return;
  panel.hidden = !expanded;
  toggle.setAttribute("aria-expanded", String(expanded));
  toggle.textContent = expanded ? "收起高级设置" : "高级设置";
}

function updateFirstFramePromptActions() {
  const input = $("#replacementFirstFramePrompt");
  const appendButton = $("#appendFirstFrameButton");
  const resetButton = $("#resetFirstFramePromptButton");
  if (!input || !appendButton || !resetButton) return;
  const prompt = input.value.trim();
  const frames = Array.isArray(state.job?.firstFrameCandidates) ? state.job.firstFrameCandidates : [];
  const generating = frames.some((item) => item.status === "generating");
  const videoLocked = (Boolean(state.job?.generatedJobId) || state.job?.status === "generation_started")
    && !replacementGenerationFailed();
  const taskCreated = Boolean(state.job && state.job.status !== "draft");
  const replacementMode = state.job?.replacementMode || selectedRadio("replacementMode") || "product";
  const platformFrames = frames.filter((item) => item.source === "platform_generated");
  const initialBatch = platformFrames.slice(0, FIRST_FRAME_BATCH_SIZE);
  const initialBatchSettled = initialBatch.length >= FIRST_FRAME_BATCH_SIZE
    && initialBatch.every((item) => FIRST_FRAME_TERMINAL_STATUSES.has(String(item.status || "")));
  const generatesFirstFrame = replacementMode !== "voiceover"
    && !(state.firstFrameStrategy === "reference" && ["product", "both"].includes(replacementMode));
  const initialBatchPending = taskCreated
    && generatesFirstFrame
    && !initialBatchSettled
    && !["first_frame_failed", "failed"].includes(String(state.job?.status || ""));
  const canGenerate = Boolean(state.job?.referenceAssets?.firstFramePath)
    && !generating
    && !videoLocked
    && Boolean(prompt);
  appendButton.hidden = !taskCreated || initialBatchPending;
  appendButton.disabled = !canGenerate;
  const createButton = $("#createReplacementButton");
  if (createButton) {
    createButton.hidden = taskCreated && !initialBatchPending;
    if (initialBatchPending) {
      createButton.disabled = true;
      createButton.textContent = initialBatch.length
        ? `正在生成首轮 ${initialBatch.map((item) => item.label || `V${item.version}`).join("、")}…`
        : "正在分析参考视频并准备 V1、V2…";
    }
  }
  const customInput = $("#customFirstFrameInput");
  if (customInput) customInput.disabled = !taskCreated || videoLocked;
  const defaultPrompt = state.job?.replacementMode === "background"
    ? state.defaults?.replacementBackgroundFirstFramePrompt
    : state.defaults?.replacementFirstFramePrompt;
  resetButton.disabled = !defaultPrompt || videoLocked;
  $("#firstFramePromptCount").textContent = `${input.value.length} 字`;
  const modelLabel = imageModelLabel(selectedImageModel());
  const usingReferenceFrame = ["product", "both"].includes(replacementMode) && state.firstFrameStrategy === "reference";
  const summary = replacementMode === "voiceover"
    ? "当前模式无需生成新首帧"
    : usingReferenceFrame
      ? "沿用原片首帧 · 不调用图片生成模型"
    : replacementMode === "background"
      ? `使用平台内置换背景提示词 · ${modelLabel}`
      : selectedFirstFrameAssetCount() === 0
        ? `仅使用原片首帧清理字幕、标签与文字水印 · ${modelLabel}`
        : `使用平台内置换品提示词 · ${modelLabel} · 已选 ${selectedFirstFrameAssetCount()} 张产品素材`;
  const summaryNode = $("#firstFrameGenerationSummary");
  if (summaryNode) summaryNode.textContent = summary;
  if (createButton && !taskCreated) {
    createButton.disabled = false;
    createButton.textContent = replacementMode === "voiceover"
      ? "分析参考视频并创建任务"
      : usingReferenceFrame
        ? "分析参考视频并沿用原片首帧"
        : "分析参考视频并生成新首帧";
  }
}

function syncFirstFramePrompt(job = state.job) {
  const input = $("#replacementFirstFramePrompt");
  if (!input) return;
  if (!state.firstFramePromptDirty && document.activeElement !== input) input.value = firstFramePromptForJob(job);
  updateFirstFramePromptActions();
}

function resetFirstFramePrompt() {
  const input = $("#replacementFirstFramePrompt");
  if (!input) return;
  input.value = String(state.job?.replacementMode === "background"
    ? state.defaults?.replacementBackgroundFirstFramePrompt
    : ["product", "both"].includes(state.job?.replacementMode || selectedRadio("replacementMode")) && selectedFirstFrameAssetCount() === 0
      ? state.defaults?.referenceFirstFrameCleanupPrompt
    : state.defaults?.replacementFirstFramePrompt || "");
  state.firstFramePromptDirty = true;
  updateFirstFramePromptActions();
  notice($("#firstFramePromptNotice"), "已恢复内置图片生成提示词；可继续修改后点击“+ 生成2张新首帧”。");
}

function formatElapsed(totalSeconds = 0) {
  const seconds = Math.max(0, Number(totalSeconds) || 0);
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.floor(seconds % 60);
  return minutes ? `${minutes}分${String(remainder).padStart(2, "0")}秒` : `${remainder}秒`;
}

function candidateProgress(candidate) {
  const stage = candidate.stageLabel || "生成中";
  const elapsed = formatElapsed(candidate.elapsedSeconds);
  const taskState = candidate.taskId ? "任务已创建" : "正在准备任务";
  return `${stage} · 已等待 ${elapsed} · ${taskState}`;
}

const GENERATED_JOB_TERMINAL_STATUSES = new Set(["success", "partial", "failed", "interrupted"]);
const GENERATED_TASK_TERMINAL_STATUSES = new Set(["success", "review_required", "failed", "blocked", "skipped", "interrupted"]);

function generatedTaskProgress(task = {}) {
  const status = String(task.status || "queued");
  if (GENERATED_TASK_TERMINAL_STATUSES.has(status)) return 100;
  if (status === "quality_checking") return 96;
  if (status === "voiceover_checking") return 93;
  if (status === "downloading") return 88;
  if (task.localPath) return 90;
  const providerPercent = Math.max(0, Math.min(100, Number(task.generationProgress || 0)));
  if (providerPercent > 0) return providerPercent >= 100 ? 85 : Math.max(15, Math.round(providerPercent));
  if (task.videoNodeName) return 15;
  if (task.canvasUrl || task.projectId) return 10;
  return status === "running" ? 6 : 2;
}

function generatedTaskStage(task = {}, fallbackIndex = 1) {
  const status = String(task.status || "queued");
  if (task.stageLabel && ["queued", "running", "downloading"].includes(status)) return task.stageLabel;
  const index = Number(task.index || fallbackIndex);
  const providerPercent = Math.max(0, Math.min(100, Number(task.generationProgress || 0)));
  return ({
    queued: `第${index}段正在排队`,
    running: providerPercent > 0 ? `第${index}段平台生成 ${providerPercent}%` : `第${index}段已提交到平台，等待生成进度`,
    downloading: `第${index}段生成完成，正在下载成片`,
    voiceover_checking: `第${index}段正在复核新口播`,
    quality_checking: `第${index}段正在检查画面连续性`,
    review_required: `第${index}段成片已保留，等待人工复核`,
    success: `第${index}段已完成`,
    failed: `第${index}段生成失败`,
    interrupted: `第${index}段生成已中断`
  })[status] || `第${index}段正在处理`;
}

function generatedJobView(generated = {}) {
  const tasks = Array.isArray(generated.tasks) ? generated.tasks : [];
  const total = Number(generated.summary?.total || tasks.length || generated.config?.videoCount || 1);
  const finished = tasks.filter((task) => GENERATED_TASK_TERMINAL_STATUSES.has(String(task.status))).length;
  const success = tasks.filter((task) => task.status === "success").length;
  const playable = tasks.filter((task) => task.localPath || task.url).length;
  const failed = tasks.filter((task) => task.status === "failed").length;
  const reviewRequired = tasks.filter((task) => task.status === "review_required").length;
  const terminal = GENERATED_JOB_TERMINAL_STATUSES.has(String(generated.status));
  const progress = terminal
    ? 100
    : tasks.length
      ? Math.round(tasks.reduce((sum, task) => sum + generatedTaskProgress(task), 0) / tasks.length)
      : 3;
  const activeTaskIndex = tasks.findIndex((task) => !GENERATED_TASK_TERMINAL_STATUSES.has(String(task.status)));
  const activeTask = activeTaskIndex >= 0 ? tasks[activeTaskIndex] : tasks.at(-1);
  const canvasTask = tasks.find((task) => task.canvasUrl);
  const canvasUrl = String(generated.canvasUrl || canvasTask?.canvasUrl || "");
  const canvasName = String(generated.canvasName || canvasTask?.canvasName || "");
  const status = String(generated.status || "queued");
  const title = ({
    queued: "视频任务已排队",
    preparing: "正在准备视频任务",
    running: "视频正在生成",
    success: "视频生成完成",
    partial: "视频已生成，部分结果待处理",
    failed: "视频生成失败",
    interrupted: "视频生成已中断"
  })[status] || "视频任务处理中";
  const stateClass = status === "success" ? "success" : status === "partial" ? "partial" : ["failed", "interrupted"].includes(status) ? "failed" : "running";
  const countText = status === "success"
    ? `${success}/${total} 段已完成`
    : status === "partial"
      ? `${playable}/${total} 段已有成片${reviewRequired ? `，${reviewRequired} 段待复核` : ""}`
      : status === "failed"
        ? `${failed || finished}/${total} 段失败`
        : `${finished}/${total} 段已完成`;
  const stage = terminal
    ? (generated.actionRequired || generated.error || activeTask?.error || (status === "success" ? "全部成片已生成并保存" : generatedTaskStage(activeTask, tasks.length || 1)))
    : activeTask
      ? generatedTaskStage(activeTask, activeTaskIndex + 1)
      : "正在创建画布并准备参考素材";
  return { total, finished, progress, title, stateClass, countText, stage, canvasUrl, canvasName };
}

function renderReplacementOutputs(generated = {}) {
  const host = $("#replacementOutputList");
  if (!host) return;
  const replacementId = String(state.job?.id || "").trim();
  const tasks = Array.isArray(generated.tasks) ? generated.tasks : [];
  const attemptName = (attemptNo) => {
    const names = ["", "一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];
    const value = Math.max(1, Number(attemptNo || 1));
    return `第${names[value] || value}次成片`;
  };
  const segmentOutputs = tasks.flatMap((task, index) => {
    const taskRef = String(task.id || task.index || index + 1);
    const previous = (Array.isArray(task.previousPreviews) ? task.previousPreviews : [])
      .filter((item) => item?.localPath)
      .map((item, historyIndex) => ({
        task: { ...item, index: task.index, displayName: task.displayName },
        index,
        outputRef: String(item.id || `${taskRef}-attempt-${Number(item.attemptNo || historyIndex + 1)}`),
        attemptNo: Number(item.attemptNo || historyIndex + 1),
        historical: true
      }))
      .sort((left, right) => left.attemptNo - right.attemptNo);
    const currentAlreadyArchived = previous.some((item) => String(item.task.localPath) === String(task.localPath || ""));
    const current = task?.localPath && !currentAlreadyArchived
      ? [{ task, index, outputRef: taskRef, attemptNo: Math.max(1, Number(task.regenerationNo || 0) + 1), historical: false }]
      : [];
    return [...previous, ...current];
  });
  const outputs = [
    ...(generated.previewPath && tasks.length > 1 ? [{ task: { localPath: generated.previewPath, status: generated.status, updatedAt: generated.updatedAt, index: 0, displayName: "最新完整成片" }, index: -1, outputRef: "full", full: true }] : []),
    ...segmentOutputs
  ];
  if (!replacementId || !outputs.length) {
    host.hidden = true;
    host.replaceChildren();
    delete host.dataset.manifest;
    return;
  }
  const manifest = outputs.map(({ task, outputRef, attemptNo }) => `${outputRef}:${task.status}:${attemptNo || 0}:${task.localPath || ""}`).join("|");
  if (host.dataset.manifest !== manifest) {
    host.innerHTML = outputs.map(({ task, index, outputRef, full, attemptNo, historical }) => {
      const segmentIndex = Number(task.index || index + 1);
      const baseUrl = `./api/product-workflows/replacement-jobs/${encodeURIComponent(replacementId)}/outputs/${encodeURIComponent(outputRef)}`;
      const version = encodeURIComponent(String(task.updatedAt || generated.updatedAt || task.completedAt || "ready"));
      const model = String(task.activeModel || task.model || generated.config?.videoModelLabel || state.job?.videoModelLabel || "").trim();
      const title = full ? "最新完整成片" : `${tasks.length > 1 ? `第${segmentIndex}段 · ` : ""}${attemptName(attemptNo)}`;
      const resultStatus = historical
        ? (task.reason === "voiceover_quality_rejected" ? "口播质检未通过，已保留" : task.reason === "replacement_quality_rejected" ? "一键换品质检未通过，已保留" : task.reason === "quality_rejected" ? "质检未通过，已保留" : "上一轮成片，已保留")
        : (["success"].includes(String(task.status)) ? "质检通过" : ["review_required"].includes(String(task.status)) ? "等待人工复核" : "当前生成结果");
      const canRetry = !historical && !full && ["failed", "review_required"].includes(String(task.status));
      const canReviewRetry = !historical && !full && String(task.status) === "review_required" && Boolean(task.localPath);
      return `<article class="rp-output-card">
        <video src="${baseUrl}/preview?v=${version}" controls preload="metadata" playsinline aria-label="${escapeHtml(title)}预览"></video>
        <footer>
          <span><b>${escapeHtml(title)}</b><small>${escapeHtml([model, resultStatus].filter(Boolean).join(" · "))}</small></span>
          <div class="rp-output-actions">
            ${canReviewRetry ? `<button type="button" class="rp-output-retry" data-review-retry-video-task="${segmentIndex}">仅重新验收</button>` : ""}
            ${canRetry ? `<button type="button" class="rp-output-retry" data-retry-video-task="${segmentIndex}">重新生成此成片</button>` : ""}
            <a class="rp-output-download" href="${baseUrl}/download" download>${full ? "下载完整成片" : "下载此成片"}</a>
          </div>
        </footer>
      </article>`;
    }).join("");
    host.querySelectorAll("[data-retry-video-task]").forEach((button) => {
      button.addEventListener("click", () => retryGeneratedVideoTask(button));
    });
    host.querySelectorAll("[data-review-retry-video-task]").forEach((button) => {
      button.addEventListener("click", () => retryGeneratedVideoReview(button));
    });
    host.dataset.manifest = manifest;
  }
  host.hidden = false;
}

async function retryGeneratedVideoReview(button) {
  const generatedJobId = String(state.generatedJob?.id || state.job?.generatedJobId || "").trim();
  const taskIndex = Number(button?.dataset?.reviewRetryVideoTask || 0);
  if (!generatedJobId || !taskIndex || button.disabled) return;
  button.disabled = true;
  button.textContent = "正在提交…";
  notice($("#replaceTaskNotice"), `正在重新验收第${taskIndex}段，不会重新生成视频。`);
  try {
    await api(`./api/jobs/${encodeURIComponent(generatedJobId)}/review-retry/${taskIndex}`, { method: "POST" });
    const generated = await api(`./api/jobs/${encodeURIComponent(generatedJobId)}`);
    state.generatedJob = generated;
    renderGeneratedJob(generated);
    startGeneratedJobPolling();
    window.dispatchEvent(new Event("module-task-updated"));
  } catch (error) {
    button.disabled = false;
    button.textContent = "仅重新验收";
    notice($("#replaceTaskNotice"), error.message, "error");
  }
}

async function retryGeneratedVideoTask(button) {
  const generatedJobId = String(state.generatedJob?.id || state.job?.generatedJobId || "").trim();
  const taskIndex = Number(button?.dataset?.retryVideoTask || 0);
  if (!generatedJobId || !taskIndex || button.disabled) return;
  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = "正在提交…";
  notice($("#replaceTaskNotice"), `正在重新生成第${taskIndex}段；原成片会保留在历史版本中。`);
  try {
    await api(`./api/jobs/${encodeURIComponent(generatedJobId)}/retry/${taskIndex}`, { method: "POST" });
    const generated = await api(`./api/jobs/${encodeURIComponent(generatedJobId)}`);
    state.generatedJob = generated;
    renderGeneratedJob(generated);
    startGeneratedJobPolling();
    window.dispatchEvent(new Event("module-task-updated"));
  } catch (error) {
    button.disabled = false;
    button.textContent = originalText;
    notice($("#replaceTaskNotice"), `重新生成失败：${error.message}`, true);
  }
}

function renderGeneratedJob(generated, refreshError = "") {
  if (!generated) return;
  const view = generatedJobView(generated);
  const panel = $("#replacementGenerationStatus");
  panel.hidden = false;
  panel.className = `rp-generation-status ${view.stateClass}`;
  $("#replacementGenerationTitle").textContent = view.title;
  $("#replacementGenerationTask").textContent = `任务 ${generated.id || state.job?.generatedJobId || "准备中"}`;
  $("#replacementGenerationPercent").textContent = `${view.progress}%`;
  $("#replacementProgressFill").style.width = `${view.progress}%`;
  $("#replacementProgressTrack").setAttribute("aria-valuenow", String(view.progress));
  $("#replacementGenerationCount").textContent = view.countText;
  $("#replacementGenerationStage").textContent = refreshError ? `状态刷新暂时中断，正在自动重试：${refreshError}` : view.stage;
  $("#replacementReadyText").textContent = `${view.title} · ${view.countText}`;
  $("#replaceJobStatus").textContent = view.title;
  const canvasLink = $("#replacementCanvasLink");
  const canvasAddress = $("#replacementCanvasAddress");
  if (view.canvasUrl) {
    canvasLink.href = view.canvasUrl;
    canvasLink.title = view.canvasUrl;
    canvasLink.classList.remove("is-disabled");
    canvasLink.setAttribute("aria-disabled", "false");
    canvasLink.innerHTML = "进入 LibTV 画布 <i aria-hidden=\"true\">↗</i>";
    canvasAddress.textContent = view.canvasName ? `${view.canvasName} · ${view.canvasUrl}` : view.canvasUrl;
    canvasAddress.title = view.canvasUrl;
  } else {
    canvasLink.removeAttribute("href");
    canvasLink.removeAttribute("title");
    canvasLink.classList.add("is-disabled");
    canvasLink.setAttribute("aria-disabled", "true");
    canvasLink.textContent = "画布准备中";
    canvasAddress.textContent = "正在等待画布地址…";
    canvasAddress.removeAttribute("title");
  }
  renderReplacementOutputs(generated);
  updateWorkflowStepProgress();
}

function renderDefaults() {
  $("#replaceProductSelect").innerHTML = state.defaults.products.map((product) => `<option value="${product.id}">${product.name}${product.assetStatus === "pending" ? "（待补素材）" : ""}</option>`).join("");
  syncReplaceProductSelectDisplay();
  $("#replaceStorageStatus").textContent = state.defaults.storage.sharedStorageEnabled ? "OSS 共享资产库已连接" : "OSS 未连接，当前使用本机资产";
  const defaultImageModel = state.defaults.imageModel || "openai/gpt-image-2";
  const defaultImageModelInput = document.querySelector(`input[name="imageModel"][value="${defaultImageModel}"]`);
  if (defaultImageModelInput && !state.job) defaultImageModelInput.checked = true;
  renderReplacementVideoModels(state.job?.videoModelId || "");
  updateProductHint();
  syncFirstFramePrompt();
}

function updateProductHint() {
  const product = currentProduct();
  $("#replaceProductHint").textContent = product.assetStatus === "pending"
    ? "该产品正式图片和产品真值尚待补充；在 AI 产品镜上传后，这里会自动共用。"
    : "正在读取 AI 产品镜与工作台共享产品图…";
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;"
  })[character]);
}

function selectedProductImageCount() {
  return state.selectedAssetIds.size + state.temporaryAssets.length;
}

function selectedFirstFrameAssetCount() {
  return state.firstFrameAssetIds.size;
}

function updateWorkflowStepProgress() {
  const job = state.job;
  const mode = job?.replacementMode || selectedRadio("replacementMode") || "product";
  const replacesProduct = ["product", "both"].includes(mode);
  const hasReference = Boolean(state.referenceUpload?.path || job?.referenceVideoPath || job?.referenceAssets?.firstFramePath);
  const hasProductAssets = !replacesProduct || selectedProductImageCount() > 0 || Boolean(job?.productAssetIds?.length || job?.temporaryProductAssets?.length);
  const selectedCandidate = (job?.firstFrameCandidates || []).find((candidate) => candidate.id === job?.selectedFirstFrameId && candidate.status === "success");
  const firstFrameComplete = mode === "voiceover"
    ? Boolean(job && job.status !== "draft")
    : Boolean(selectedCandidate || (state.firstFrameStrategy === "reference" && hasReference));
  const generationComplete = ["voiceover_verified", "review_required"].includes(String(job?.status || ""))
    || ["completed", "succeeded", "success"].includes(String(state.generatedJob?.status || ""));
  const completion = { reference: hasReference, product: hasProductAssets, "first-frame": firstFrameComplete, generation: generationComplete };
  $$('[data-workflow-step]').forEach((step) => {
    const complete = Boolean(completion[step.dataset.workflowStep]);
    step.classList.toggle("is-complete", complete);
    step.dataset.complete = String(complete);
    step.setAttribute("aria-label", `${step.textContent.trim()}，${complete ? "已完成" : "待完成"}`);
  });
}

function replacePickerMaximum() {
  return Math.max(0, MAX_PRODUCT_SELECTION - state.temporaryAssets.length);
}

async function loadAssets() {
  const product = currentProduct();
  const result = await api(`./api/product-workflows/assets?assetType=image&productId=${encodeURIComponent(product.id)}`);
  state.assets = result.items || [];
  state.selectedAssetIds = new Set([...state.selectedAssetIds].filter((id) => state.assets.some((asset) => asset.id === id)));
  state.firstFrameAvailableAssetIds = state.firstFrameAvailableAssetIds.filter((id) => state.assets.some((asset) => asset.id === id));
  state.firstFrameAssetIds = new Set([...state.firstFrameAssetIds].filter((id) => state.firstFrameAvailableAssetIds.includes(id)));
  renderAssets();
  $("#replaceProductHint").textContent = state.assets.length
    ? "选定后将作为视频生成的上游图片资产，Seedance 2.0 多模态全能参考:文本、图像、视频、音频混合输入单次最多12个参考文件(图像<9张、视频<3段、音频<3段)。"
    : "当前 SKU 还没有产品图；打开选择窗口即可从本地上传并自动保存到产品资产。";
}

function renderAssets() {
  const selectedAssets = [...state.selectedAssetIds].map((id) => state.assets.find((asset) => asset.id === id)).filter(Boolean);
  $("#replaceAssetSelectionCount").textContent = `已选 ${selectedProductImageCount()}/${MAX_PRODUCT_SELECTION} 张`;
  const builtInCards = selectedAssets.map((asset) => `
    <article class="pw-asset-card selected" data-preview-library-asset="${escapeHtml(asset.id)}" title="点击查看原图：${escapeHtml(asset.title)}">
      <button class="rp-selected-asset-remove" type="button" data-selected-asset-remove="${escapeHtml(asset.id)}" aria-label="删除${escapeHtml(asset.title)}">×</button>
      <span class="pw-check">✓</span><img src="${escapeHtml(asset.thumbnailUrl || asset.previewUrl)}" alt="${escapeHtml(asset.title)}缩略图" loading="lazy" />
      <div><b>${escapeHtml(asset.title)}</b><small>产品资产</small></div>
    </article>`).join("");
  const temporaryCards = state.temporaryAssets.map((asset) => `
    <article class="pw-asset-card selected rp-legacy-temporary">
      <button class="rp-temporary-remove" type="button" data-temporary-remove="${escapeHtml(asset.id)}" aria-label="移除${escapeHtml(asset.name)}">×</button>
      <span class="pw-check">✓</span><img src="${escapeHtml(asset.previewUrl)}" alt="${escapeHtml(asset.name)}" />
      <div><b>${escapeHtml(asset.name)}</b><small>历史任务临时图</small></div>
    </article>`).join("");
  $("#replaceAssetGrid").innerHTML = `${builtInCards}${temporaryCards}`;
  $("#replaceAssetGrid").hidden = selectedProductImageCount() === 0;
  $$('[data-selected-asset-remove]').forEach((button) => button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    removeSelectedProductAsset(button.dataset.selectedAssetRemove);
  }));
  $$('[data-temporary-remove]').forEach((button) => button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    removeTemporaryProduct(button.dataset.temporaryRemove);
  }));
  [...$("#replaceAssetGrid").querySelectorAll('[data-preview-library-asset]')].forEach((button) => button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    openLibraryAssetPreview(button.dataset.previewLibraryAsset);
  }));
  renderTargetAssets();
  updateWorkflowStepProgress();
}

function removeSelectedProductAsset(assetId) {
  state.selectedAssetIds.delete(assetId);
  state.pickerSelectedIds = state.pickerSelectedIds.filter((id) => id !== assetId);
  state.firstFrameAvailableAssetIds = state.firstFrameAvailableAssetIds.filter((id) => id !== assetId);
  state.firstFrameAssetIds.delete(assetId);
  renderAssets();
  updateFirstFramePromptActions();
  saveReplacementDraft();
}

function renderTargetAssets() {
  const available = state.firstFrameAvailableAssetIds
    .map((id) => state.assets.find((asset) => asset.id === id))
    .filter(Boolean);
  const selectedCount = available.filter((asset) => state.firstFrameAssetIds.has(asset.id)).length;
  const selectionCount = $("#firstFrameAssetSelectionCount");
  selectionCount.textContent = `已选 ${selectedCount}/${available.length} 张`;
  selectionCount.title = `本次已同步 ${available.length} 张产品素材，最多可选 ${MAX_PRODUCT_SELECTION} 张；单击图片切换是否选用`;
  $("#targetProductSlot").className = available.length ? "pw-asset-grid rp-first-frame-asset-grid rp-upstream-media" : "pw-empty rp-upstream-media";
  $("#targetProductSlot").innerHTML = available.length
    ? available.map((asset) => {
      const selected = state.firstFrameAssetIds.has(asset.id);
      return `<article class="rp-first-frame-asset ${selected ? "selected" : ""}" data-first-frame-asset-card="${escapeHtml(asset.id)}">
        <button class="rp-first-frame-asset-toggle" data-first-frame-asset-select="${escapeHtml(asset.id)}" type="button" aria-pressed="${selected}" aria-label="${selected ? "取消选用" : "选用"}${escapeHtml(asset.title)}">
          <span class="pw-check" aria-hidden="true">${selected ? "✓" : ""}</span>
          <img src="${escapeHtml(asset.thumbnailUrl || asset.previewUrl)}" alt="${escapeHtml(asset.title)}缩略图" loading="lazy" />
          <span class="rp-first-frame-asset-question"><b>是否选用？</b><em>${selected ? "是 · 已选定" : "单击图片：是"}</em></span>
        </button>
        <button class="rp-first-frame-asset-delete" data-first-frame-asset-delete="${escapeHtml(asset.id)}" type="button" aria-label="从新首帧图产品素材中删除${escapeHtml(asset.title)}" title="仅从新首帧图产品素材中删除">×</button>
      </article>`;
    }).join("")
    : "<span>可选择产品素材用于换品；不选择时将仅上传原片首帧并清理字幕、标签与文字水印</span>";
  [...$("#targetProductSlot").querySelectorAll('[data-first-frame-asset-select]')].forEach((button) => button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const assetId = button.dataset.firstFrameAssetSelect;
    if (state.firstFrameAssetIds.has(assetId)) state.firstFrameAssetIds.delete(assetId);
    else state.firstFrameAssetIds.add(assetId);
    state.firstFramePromptDirty = false;
    renderTargetAssets();
    syncFirstFramePrompt();
    updateFirstFramePromptActions();
    saveReplacementDraft();
  }));
  [...$("#targetProductSlot").querySelectorAll('[data-first-frame-asset-delete]')].forEach((button) => button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const assetId = button.dataset.firstFrameAssetDelete;
    state.firstFrameAvailableAssetIds = state.firstFrameAvailableAssetIds.filter((id) => id !== assetId);
    state.firstFrameAssetIds.delete(assetId);
    state.firstFramePromptDirty = false;
    renderTargetAssets();
    syncFirstFramePrompt();
    updateFirstFramePromptActions();
    saveReplacementDraft();
  }));
}

function openLibraryAssetPreview(assetId) {
  const asset = state.assets.find((item) => item.id === assetId);
  if (!asset) return;
  $("#replaceAssetPreviewTitle").textContent = asset.title || "产品图片原图";
  $("#replaceAssetPreviewImage").src = asset.originalUrl || asset.previewUrl;
  $("#replaceAssetPreviewImage").alt = asset.title || "产品图片原图";
  $("#replaceAssetPreviewDialog").showModal();
}

function renderReplaceAssetPicker() {
  const selectedOrder = new Map(state.pickerSelectedIds.map((id, index) => [id, index + 1]));
  const maximum = replacePickerMaximum();
  $("#replacePickerEmpty").hidden = state.assets.length > 0;
  $("#replacePickerSelectionCount").textContent = `已选 ${state.pickerSelectedIds.length}/${maximum} 张`;
  $("#replacePickerGrid").innerHTML = state.assets.map((asset) => {
    const order = selectedOrder.get(asset.id) || 0;
    return `<button class="ps-picker-card ${order ? "selected" : ""}" data-replace-picker-asset="${escapeHtml(asset.id)}" type="button" aria-pressed="${order ? "true" : "false"}">
      ${order ? `<i class="ps-picker-order">${order}</i>` : ""}
      <i class="ps-picker-check" aria-hidden="true">${order ? "✓" : ""}</i>
      <span class="ps-thumbnail-media"><img src="${escapeHtml(asset.thumbnailUrl || asset.previewUrl)}" alt="${escapeHtml(asset.title)}缩略图" loading="lazy" /></span>
      <i class="ps-picker-preview-trigger" data-preview-library-asset="${escapeHtml(asset.id)}">预览</i>
      <span><b>${escapeHtml(asset.title)}</b><small>${escapeHtml(asset.productName || currentProduct().name)}</small></span>
    </button>`;
  }).join("");
  const selectedAssets = state.pickerSelectedIds.map((id) => state.assets.find((asset) => asset.id === id)).filter(Boolean);
  $("#replacePickerSelectionList").innerHTML = selectedAssets.map((asset, index) => `<article class="ps-picker-selection-item">
    <button class="ps-picker-selection-image" data-preview-library-asset="${escapeHtml(asset.id)}" type="button" aria-label="查看原始资产：${escapeHtml(asset.title)}"><img src="${escapeHtml(asset.thumbnailUrl || asset.previewUrl)}" alt="${escapeHtml(asset.title)}缩略图" loading="lazy" /></button>
    <b><i>${index + 1}</i><span title="${escapeHtml(asset.title)}">${escapeHtml(asset.title)}</span></b>
    <span>
      <button data-replace-picker-move="up" data-replace-picker-index="${index}" type="button" ${index === 0 ? "disabled" : ""}>上移</button>
      <button data-replace-picker-move="down" data-replace-picker-index="${index}" type="button" ${index === selectedAssets.length - 1 ? "disabled" : ""}>下移</button>
      <button data-replace-picker-remove="${escapeHtml(asset.id)}" type="button">移除</button>
    </span>
  </article>`).join("") || `<div class="ps-picker-selection-empty">请选择进入视频平台的产品参考图</div>`;

  $$('[data-replace-picker-asset]').forEach((button) => button.addEventListener("click", () => {
    const assetId = button.dataset.replacePickerAsset;
    const index = state.pickerSelectedIds.indexOf(assetId);
    if (index >= 0) state.pickerSelectedIds.splice(index, 1);
    else if (state.pickerSelectedIds.length < maximum) state.pickerSelectedIds.push(assetId);
    else return window.alert(`单次最多选择${MAX_PRODUCT_SELECTION}张视频上游产品参考图。`);
    renderReplaceAssetPicker();
  }));
  $$('[data-replace-picker-move]').forEach((button) => button.addEventListener("click", () => {
    const index = Number(button.dataset.replacePickerIndex);
    const nextIndex = button.dataset.replacePickerMove === "up" ? index - 1 : index + 1;
    if (index < 0 || nextIndex < 0 || nextIndex >= state.pickerSelectedIds.length) return;
    [state.pickerSelectedIds[index], state.pickerSelectedIds[nextIndex]] = [state.pickerSelectedIds[nextIndex], state.pickerSelectedIds[index]];
    renderReplaceAssetPicker();
  }));
  $$('[data-replace-picker-remove]').forEach((button) => button.addEventListener("click", () => {
    state.pickerSelectedIds = state.pickerSelectedIds.filter((id) => id !== button.dataset.replacePickerRemove);
    renderReplaceAssetPicker();
  }));
  [...$("#replaceAssetPickerDialog").querySelectorAll('[data-preview-library-asset]')].forEach((button) => button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    openLibraryAssetPreview(button.dataset.previewLibraryAsset);
  }));
}

async function openReplaceAssetPicker() {
  await loadAssets();
  state.pickerSelectedIds = [...state.selectedAssetIds].filter((id) => state.assets.some((asset) => asset.id === id));
  $("#replacePickerStep").textContent = `一键换品 · ${currentProduct().name}`;
  $("#replacePickerTitle").textContent = "选择产品参考图";
  $("#replacePickerDescription").textContent = "选定后固定作为本次任务视频生成的上游资产，并同步到右侧新首帧图产品素材；请选择1-8张。产品外观、包装、颜色和比例以所选图片为最高优先级真值。";
  $("#replacePickerSelectionTitle").textContent = "已选视频上游产品图";
  $("#confirmReplacePickerButton").textContent = "确认并同步到新首帧图产品素材";
  notice($("#replacePickerUploadStatus"), "");
  renderReplaceAssetPicker();
  $("#replaceAssetPickerDialog").showModal();
}

function confirmReplaceAssetPicker() {
  const selectedIds = state.pickerSelectedIds.slice(0, replacePickerMaximum());
  const previousAvailableIds = new Set(state.firstFrameAvailableAssetIds);
  state.selectedAssetIds = new Set(selectedIds);
  state.firstFrameAvailableAssetIds = selectedIds.slice();
  state.firstFrameAssetIds = previousAvailableIds.size
    ? new Set([...state.firstFrameAssetIds].filter((id) => state.firstFrameAvailableAssetIds.includes(id)))
    : new Set(selectedIds);
  $("#replaceAssetPickerDialog").close();
  renderAssets();
  updateFirstFramePromptActions();
  saveReplacementDraft();
}

async function uploadResponseData(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

async function uploadFileInChunks(file, session, kind, onProgress) {
  const uploadId = globalThis.crypto?.randomUUID?.() || `chunk-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const totalChunks = Math.ceil(file.size / PROXY_SAFE_UPLOAD_CHUNK_BYTES);
  let data = {};
  for (let index = 0; index < totalChunks; index += 1) {
    const params = new URLSearchParams({
      kind,
      name: file.name,
      session,
      uploadId,
      index: String(index),
      totalChunks: String(totalChunks),
      totalSize: String(file.size)
    });
    const start = index * PROXY_SAFE_UPLOAD_CHUNK_BYTES;
    const body = file.slice(start, Math.min(file.size, start + PROXY_SAFE_UPLOAD_CHUNK_BYTES));
    const response = await fetch(`./api/upload/chunk?${params}`, { method: "POST", body });
    data = await uploadResponseData(response);
    if (response.status === 401 && data.loginRequired) location.href = "./login.html";
    if (!response.ok) throw new Error(data.error || `文件分片上传失败（${response.status}）`);
    onProgress?.(Math.round(((index + 1) / totalChunks) * 100));
  }
  return data;
}

async function uploadTaskFile(file, session, kind, onProgress) {
  const params = new URLSearchParams({ kind, name: file.name, session });
  const response = await fetch(`./api/upload?${params}`, { method: "POST", body: file });
  if (response.status === 413 && file.size > PROXY_SAFE_UPLOAD_CHUNK_BYTES) {
    return uploadFileInChunks(file, session, kind, onProgress);
  }
  const data = await uploadResponseData(response);
  if (response.status === 401 && data.loginRequired) location.href = "./login.html";
  if (!response.ok) throw new Error(data.error || `文件上传失败（${response.status}）`);
  return data;
}

function referenceVideoEditingLocked(job = state.job) {
  return Boolean(job && job.status !== "draft");
}

async function uploadReference(file) {
  if (!file) return;
  if (referenceVideoEditingLocked()) {
    throw new Error("当前任务的参考视频已经固定；请新建任务后再上传其他参考视频");
  }
  if (file.size > 200 * 1024 * 1024) throw new Error("参考视频不能超过 200MB");
  state.firstFrameStrategy = "";
  state.activeFirstFrameCandidateId = "";
  notice($("#referenceUploadStatus"), `正在上传：${file.name}`);
  const session = `replace-${Date.now()}`;
  state.referenceUpload = await uploadTaskFile(file, session, "replacement-reference", (progress) => {
    notice($("#referenceUploadStatus"), `正在上传：${file.name}（${progress}%）`);
  });
  notice($("#referenceUploadStatus"), `${file.name} 已上传，正在检测时长、音轨并自动提取首帧图…`);
  const prepared = await api("./api/product-workflows/replacement-reference/prepare", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: state.referenceUpload.path })
  });
  state.referenceUpload.referenceAssets = prepared.referenceAssets;
  state.durationUserModified = false;
  renderReplacementVideoSettings({ syncReference: true });
  renderUploadedReferenceAssets();
  saveReplacementDraft();
  notice(
    $("#referenceUploadStatus"),
    prepared.referenceAssets.hasAudio
      ? `${file.name} 已就绪。生成视频前将从原片准备合规MP3参考音频，并通过nodeKey连接到对应视频段。`
      : `${file.name} 已就绪，但未检测到可用音轨；只换产品可继续，换口播任务将被拦截。`
  );
}

function renderReferenceVideoPreview(filePath, fileName, posterUrl = "") {
  const resolvedPath = String(filePath || "").trim();
  const uploadPrompt = $("#referenceVideoUploadPrompt");
  const fileNameNode = $("#referenceVideoFileName");
  const slot = $("#referenceVideoSlot");
  if (uploadPrompt) uploadPrompt.hidden = Boolean(resolvedPath);
  if (fileNameNode) {
    fileNameNode.textContent = resolvedPath ? (fileName || "参考视频") : "尚未上传参考视频";
    fileNameNode.title = resolvedPath ? (fileName || "参考视频") : "";
  }
  if (!resolvedPath) {
    if (slot?.querySelector("video")) {
      slot.className = "pw-empty rp-upstream-media";
      const empty = document.createElement("span");
      empty.textContent = "上传参考视频后可在此播放核对";
      slot.replaceChildren(empty);
      delete slot.dataset.previewUrl;
    }
    updateWorkflowStepProgress();
    return;
  }
  const previewUrl = `./api/file?path=${encodeURIComponent(resolvedPath)}`;
  const existingVideo = slot?.querySelector("video");
  if (existingVideo && slot.dataset.previewUrl === previewUrl) {
    existingVideo.setAttribute("aria-label", fileName || "参考视频");
    const normalizedPoster = String(posterUrl || "").trim();
    if (normalizedPoster && existingVideo.getAttribute("poster") !== normalizedPoster) existingVideo.setAttribute("poster", normalizedPoster);
    updateWorkflowStepProgress();
    return;
  }
  const video = document.createElement("video");
  video.src = previewUrl;
  video.controls = true;
  video.preload = "metadata";
  video.playsInline = true;
  video.setAttribute("aria-label", fileName || "参考视频");
  if (posterUrl) video.poster = posterUrl;
  slot.className = "rp-upstream-media";
  slot.dataset.previewUrl = previewUrl;
  slot.replaceChildren(video);
  updateWorkflowStepProgress();
}

function renderUploadedReferenceAssets() {
  if ((state.job && state.job.status !== "draft") || !state.referenceUpload?.referenceAssets) return;
  const assets = state.referenceUpload.referenceAssets;
  renderReferenceVideoPreview(state.referenceUpload.path, state.referenceUpload.name, assets.firstFramePreviewUrl);
  if (assets.firstFramePreviewUrl) {
    $("#referenceFrameSlot").className = "rp-upstream-media";
    $("#referenceFrameSlot").innerHTML = `<img src="${escapeHtml(assets.firstFramePreviewUrl)}" alt="参考视频首帧" style="width:100%;aspect-ratio:9/16;object-fit:cover;border-radius:8px" />`;
  }
  renderFirstFrameCandidateWorkspace(state.job);
}

async function uploadReplacementProductAsset(file, params, onProgress) {
  const response = await fetch(`./api/product-workflows/assets/upload?${params}`, { method: "POST", body: file });
  if (response.status === 413 && file.size > PROXY_SAFE_UPLOAD_CHUNK_BYTES) {
    const uploaded = await uploadFileInChunks(file, params.get("session"), "product-asset-image", onProgress);
    return api("./api/product-workflows/assets/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path: uploaded.path,
        assetType: "image",
        name: file.name,
        title: params.get("title"),
        productId: params.get("productId"),
        productName: params.get("productName"),
        category: params.get("category"),
        assetRole: "white_background"
      })
    });
  }
  const data = await uploadResponseData(response);
  if (response.status === 401 && data.loginRequired) location.href = "./login.html";
  if (!response.ok) throw new Error(data.error || `产品图上传失败（${response.status}）`);
  return data;
}

async function uploadReplacementProductAssets(fileList) {
  const requested = [...(fileList || [])];
  if (!requested.length || state.assetUploadBusy) return;
  const invalid = requested.find((file) => !/\.(png|jpe?g)$/i.test(file.name) || file.size > 10 * 1024 * 1024);
  if (invalid) {
    $("#replaceProductUploadInput").value = "";
    return notice($("#replacePickerUploadStatus"), `${invalid.name} 不符合要求；仅支持 PNG / JPG，单张不超过10MB。`, true);
  }
  const product = currentProduct();
  state.assetUploadBusy = true;
  $("#replaceProductUploadInput").disabled = true;
  $("#confirmReplacePickerButton").disabled = true;
  const uploadedIds = [];
  const failures = [];
  for (let index = 0; index < requested.length; index += 1) {
    const file = requested[index];
    notice($("#replacePickerUploadStatus"), `正在上传 ${index + 1}/${requested.length}：${file.name}`);
    try {
      const params = new URLSearchParams({
        assetType: "image",
        name: file.name,
        title: file.name.replace(/\.[^.]+$/, ""),
        productId: product.id,
        productName: product.name,
        category: product.category || "",
        assetRole: "white_background",
        session: `replacement-assets-${Date.now()}-${index + 1}`
      });
      const result = await uploadReplacementProductAsset(file, params, (progress) => {
        notice($("#replacePickerUploadStatus"), `正在上传 ${index + 1}/${requested.length}：${file.name}（${progress}%）`);
      });
      const assetId = result.duplicateMatch?.id || result.asset?.id;
      if (assetId) uploadedIds.push(assetId);
    } catch (error) {
      failures.push(`${file.name}：${error.message}`);
    }
  }
  $("#replaceProductUploadInput").value = "";
  state.assetUploadBusy = false;
  $("#replaceProductUploadInput").disabled = false;
  $("#confirmReplacePickerButton").disabled = false;
  await loadAssets();
  const selectableIds = new Set(state.assets.map((asset) => asset.id));
  const maximum = replacePickerMaximum();
  for (const assetId of uploadedIds) {
    if (!selectableIds.has(assetId) || state.pickerSelectedIds.includes(assetId) || state.pickerSelectedIds.length >= maximum) continue;
    state.pickerSelectedIds.push(assetId);
  }
  renderReplaceAssetPicker();
  const unselected = uploadedIds.filter((id) => !state.pickerSelectedIds.includes(id)).length;
  notice(
    $("#replacePickerUploadStatus"),
    failures.length
      ? `上传完成：${uploadedIds.length} 张已保存，${failures.length} 张失败。${failures[0]}`
      : `${uploadedIds.length} 张已保存到当前 SKU 的产品资产并加入选择${unselected ? `；另有${unselected}张因选择已满仅保存入库` : ""}。`,
    failures.length > 0
  );
}

function removeTemporaryProduct(assetId) {
  const index = state.temporaryAssets.findIndex((asset) => asset.id === assetId);
  if (index < 0) return;
  const [asset] = state.temporaryAssets.splice(index, 1);
  if (asset.previewUrl) URL.revokeObjectURL(asset.previewUrl);
  renderAssets();
  notice($("#temporaryProductStatus"), `${asset.name} 已从本次任务移除，内置资产未受影响。`);
  api("./api/upload/delete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: asset.path })
  }).catch(() => {});
}

function clearTemporaryProducts() {
  for (const asset of state.temporaryAssets) {
    if (asset.previewUrl) URL.revokeObjectURL(asset.previewUrl);
    api("./api/upload/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: asset.path })
    }).catch(() => {});
  }
  state.temporaryAssets = [];
  notice($("#temporaryProductStatus"), "");
}

function timingCharCount(value) {
  return Array.from(String(value || "").replace(/\s/g, "")).length;
}

function renderVoiceoverDiff(draft = {}) {
  const node = $("#voiceoverDiff");
  if (!node) return;
  const replacements = Array.isArray(draft.replacements) ? draft.replacements : [];
  const warnings = [
    ...(Array.isArray(draft.warnings) ? draft.warnings : []),
    ...(Array.isArray(draft.unresolvedMentions) ? draft.unresolvedMentions.map((item) => `未确认：${item}`) : [])
  ];
  node.hidden = !replacements.length && !warnings.length;
  node.innerHTML = [
    ...replacements.map((item) => `<div><del>${escapeHtml(item.source || "旧表述")}</del> → <ins>${escapeHtml(item.target || "待确认")}</ins>${item.reason ? ` · ${escapeHtml(item.reason)}` : ""}</div>`),
    ...warnings.map((item) => `<div>⚠ ${escapeHtml(item)}</div>`)
  ].join("");
}

function updateVoiceoverCounts() {
  const sourceText = $("#sourceTranscript")?.value || "";
  const targetText = $("#lockedScript")?.value || "";
  if ($("#sourceTranscriptCount")) $("#sourceTranscriptCount").textContent = `计时字符 ${timingCharCount(sourceText)}`;
  if ($("#lockedScriptCount")) $("#lockedScriptCount").textContent = `计时字符 ${timingCharCount(targetText)}`;
  const sourceChars = timingCharCount(sourceText);
  const targetChars = timingCharCount(targetText);
  const sourceDuration = Number(state.job?.referenceAssets?.duration || 0);
  const targetDuration = sourceChars > 0 && sourceDuration > 0 ? Math.max(1, Math.round(sourceDuration * targetChars / sourceChars)) : 0;
  if ($("#voiceoverTimingSummary")) {
    $("#voiceoverTimingSummary").textContent = targetDuration
      ? `预计 ${targetDuration} 秒＝原片 ${sourceDuration.toFixed(1)} 秒 × ${targetChars} ÷ ${sourceChars}`
      : "等待有效原片口播";
  }
}

function renderVoiceoverWorkspace(job = state.job) {
  const transcriptField = $("#sourceTranscriptField");
  if (!transcriptField) return;
  transcriptField.hidden = !job || job.status === "draft";
  const transcript = job?.sourceTranscript || {};
  const sourceInput = $("#sourceTranscript");
  if (sourceInput && document.activeElement !== sourceInput) sourceInput.value = String(transcript.text || "");
  const transcriptLabels = {
    pending: "等待识别",
    transcribing: "XingChenASR识别中",
    success: transcript.source === "manual_correction" ? "已人工校正" : "识别完成",
    no_audio: "原片无音轨",
    failed: "识别失败"
  };
  $("#sourceTranscriptStatus").textContent = transcriptLabels[transcript.status] || "等待识别";
  const speakerCount = Math.max(0, Number(transcript.speakerCount || transcript.speakers?.length || 0));
  const channelSummary = transcript.channelStrategy === "split_stereo" ? " · 左右声道已分轨" : "";
  const overlapSummary = Number(transcript.overlapCount || 0) > 0 ? ` · ${transcript.overlapCount}段重叠讲话需人工核对` : "";
  $("#sourceSpeakerSummary").textContent = speakerCount
    ? `识别到 ${speakerCount} 位说话人${channelSummary}${overlapSummary}`
    : (transcript.status === "success" ? `未返回说话人标签${overlapSummary}` : (transcript.error || "尚无说话人信息"));
  const segmentNode = $("#sourceTranscriptSegments");
  const transcriptSegments = Array.isArray(transcript.segments) ? transcript.segments.filter((item) => String(item?.text || "").trim()) : [];
  if (segmentNode) {
    const speakerIds = [...new Set(transcriptSegments.map((item) => String(item?.speaker || "").trim()).filter(Boolean))];
    segmentNode.hidden = transcriptSegments.length === 0;
    segmentNode.innerHTML = transcriptSegments.map((segment, index) => {
      const speakerId = String(segment.speaker || "").trim();
      const speakerIndex = speakerIds.indexOf(speakerId);
      const label = speakerId ? `说话人 ${speakerIndex >= 0 ? speakerIndex + 1 : speakerId}` : "未标注";
      const start = Number(segment.start);
      const end = Number(segment.end);
      const time = Number.isFinite(start) && Number.isFinite(end) ? ` · ${start.toFixed(1)}–${end.toFixed(1)}s` : "";
      const channel = segment.channel === "left" ? " · 左声道" : (segment.channel === "right" ? " · 右声道" : "");
      const review = segment.needsReview === true || segment.overlap === true ? " · 重叠讲话，需人工核对" : "";
      return `<div class="rp-speaker-segment"><strong>${escapeHtml(label)}${escapeHtml(channel)}${escapeHtml(time)}${escapeHtml(review)}</strong><span>${escapeHtml(segment.text)}</span></div>`;
    }).join("");
  }
  const sourceLocked = voiceoverEditingLocked(job) || transcript.status === "transcribing";
  sourceInput.readOnly = sourceLocked;
  $("#retrySourceTranscriptButton").disabled = sourceLocked;
  $("#saveSourceTranscriptButton").disabled = sourceLocked;
  const draft = job?.voiceoverDraft || {};
  const targetInput = $("#lockedScript");
  if (targetInput && !state.voiceoverDecisionDirty && document.activeElement !== targetInput) targetInput.value = String(draft.text || job?.lockedScript?.lockedScript || "");
  renderVoiceoverDiff(draft);
  $("#restoreVoiceoverSuggestionButton").disabled = voiceoverEditingLocked(job) || !String(draft.proposedText || "").trim();
  $("#confirmVoiceoverButton").disabled = voiceoverEditingLocked(job) || !String(targetInput?.value || "").trim() || state.voiceoverDecisionSaving;
  $("#confirmVoiceoverButton").textContent = draft.confirmed === true ? "已确认；修改后需重新确认" : "确认新口播并编译ShotPlan";
  updateVoiceoverCounts();
}

function updateVoiceoverUi() {
  const replacementMode = selectedRadio("replacementMode") || "product";
  const replacesProduct = ["product", "both"].includes(replacementMode);
  const replacesVoiceover = ["voiceover", "both"].includes(replacementMode);
  const backgroundOnly = replacementMode === "background";
  $("#replaceProductField").hidden = !replacesProduct;
  $("#replaceProductAssetField").hidden = !replacesProduct;
  $("#replacementProductVariables").hidden = !replacesProduct;
  $("#temporaryProductStatus").hidden = !replacesProduct || !$("#temporaryProductStatus").textContent;
  $("#backgroundDescriptionField").hidden = !backgroundOnly;
  $("#backgroundDescription").required = backgroundOnly;
  $("#firstFrameProductAssets").hidden = !replacesProduct;
  $("#backgroundFirstFrameHint").hidden = !backgroundOnly;
  $(".rp-first-frame-assets h3").textContent = backgroundOnly ? "新首帧目标背景" : "新首帧图产品素材";
  const jobChanged = Boolean(state.job?.id) && state.voiceoverDecisionJobId !== state.job.id;
  if (jobChanged) {
    state.voiceoverDecisionJobId = state.job.id;
    state.voiceoverDecisionDirty = false;
  }
  if (replacesVoiceover && state.job && state.job.status !== "draft" && !state.voiceoverDecisionDirty && !state.voiceoverDecisionSaving) {
    const persistedMode = state.job.voiceoverMode === "new" ? "new" : "old";
    const persistedInput = [...document.querySelectorAll('input[name="voiceoverMode"]')].find((input) => input.value === persistedMode);
    if (persistedInput) persistedInput.checked = true;
    if (state.job.lockedScript?.lockedScript) $("#lockedScript").value = state.job.lockedScript.lockedScript;
  }
  if (!replacesVoiceover) {
    const oldVoiceoverInput = [...document.querySelectorAll('input[name="voiceoverMode"]')].find((input) => input.value === "old");
    if (oldVoiceoverInput) oldVoiceoverInput.checked = true;
  }
  const isNew = replacesVoiceover && selectedRadio("voiceoverMode") === "new";
  $("#lockedScriptField").hidden = !isNew;
  $("#scriptLockPolicy").hidden = !isNew;
  const textarea = $("#lockedScript");
  const status = $("#lockedScriptStatus");
  const voiceoverInputs = $$('input[name="voiceoverMode"]');
  const productionLocked = voiceoverEditingLocked(state.job);
  const editingDisabled = productionLocked || state.voiceoverDecisionSaving;
  textarea.readOnly = editingDisabled;
  textarea.setAttribute("aria-readonly", editingDisabled ? "true" : "false");
  voiceoverInputs.forEach((input) => { input.disabled = !replacesVoiceover || editingDisabled; });
  const persistedScript = state.job?.lockedScript;
  if (isNew && persistedScript?.immutable === true) {
    const version = Math.max(1, Number(persistedScript.version) || 1);
    const digest = String(persistedScript.sha256 || "");
    status.hidden = false;
    status.textContent = state.voiceoverDecisionSaving
      ? "正在保存口播安排…"
      : state.voiceoverDecisionDirty
        ? "待保存修改"
        : productionLocked
          ? `🔒 已用于视频制作 V${version} · ${digest.slice(0, 12)}`
          : `已保存 V${version} · ${digest.slice(0, 12)} · 生成前可修改`;
    status.title = `SHA-256：${digest}。${productionLocked ? "该版本已经进入视频制作。" : "可在点击“确认ShotPlan并生成”前继续修改。"}`;
  } else if (isNew && (state.voiceoverDecisionDirty || state.voiceoverDecisionSaving)) {
    status.hidden = false;
    status.textContent = state.voiceoverDecisionSaving ? "正在保存口播安排…" : "待保存修改";
    status.title = "点击“确认ShotPlan并生成”时会先保存并逐字锁定当前文案。";
  } else {
    status.hidden = true;
    status.textContent = "";
    status.removeAttribute("title");
  }
  renderVoiceoverWorkspace(state.job);
  updateFirstFramePromptActions();
  if (state.referenceUpload?.referenceAssets?.firstFramePreviewUrl || state.job?.referenceAssets?.firstFramePreviewUrl) {
    renderFirstFrameCandidateWorkspace(state.job);
  }
}

async function persistVoiceoverDecision({ quiet = false } = {}) {
  const job = state.job;
  if (!job || job.status === "draft" || !["voiceover", "both"].includes(job.replacementMode)) return job;
  const voiceoverMode = selectedRadio("voiceoverMode") === "new" ? "new" : "old";
  const voiceoverScript = voiceoverMode === "new" ? $("#lockedScript").value : "";
  if (voiceoverMode === "new" && !voiceoverScript.trim()) throw new Error("请填写新口播文案。");
  const modeUnchanged = job.voiceoverMode === voiceoverMode;
  const scriptUnchanged = voiceoverMode !== "new" || String(job.voiceoverDraft?.text || "") === voiceoverScript;
  if (voiceoverEditingLocked(job)) {
    if (modeUnchanged && scriptUnchanged) return job;
    throw new Error("视频任务已经提交，口播安排已用于制作，不能再修改");
  }
  if (!state.voiceoverDecisionDirty && modeUnchanged && scriptUnchanged) return job;
  state.voiceoverDecisionSaving = true;
  updateVoiceoverUi();
  try {
    let result = { job };
    if (!modeUnchanged) {
      result = await api(`./api/product-workflows/replacement-jobs/${job.id}/voiceover-decision`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ voiceoverMode })
      });
    }
    if (voiceoverMode === "new" && (!scriptUnchanged || !modeUnchanged)) {
      result = await api(`./api/product-workflows/replacement-jobs/${job.id}/voiceover-draft`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: voiceoverScript })
      });
    }
    state.job = result.job;
    state.voiceoverDecisionDirty = false;
    state.voiceoverDecisionJobId = result.job.id;
    if (!quiet) notice($("#replaceTaskNotice"), voiceoverMode === "new" ? "新口播草稿已保存；请确认后再编译ShotPlan。" : "已改为沿用旧口播。");
    return result.job;
  } finally {
    state.voiceoverDecisionSaving = false;
    renderJob();
  }
}

async function retrySourceTranscript() {
  if (!state.job?.id) return;
  const button = $("#retrySourceTranscriptButton");
  button.disabled = true;
  $("#sourceTranscriptStatus").textContent = "XingChenASR识别中";
  try {
    const result = await api(`./api/product-workflows/replacement-jobs/${state.job.id}/source-transcript`, { method: "POST" });
    state.job = result.job;
    state.voiceoverDecisionDirty = false;
    renderJob();
    notice($("#replaceTaskNotice"), "原片口播已重新识别；如为新口播任务，请重新核对并确认文案。");
  } catch (error) {
    notice($("#replaceTaskNotice"), error.message, true);
  } finally {
    button.disabled = false;
  }
}

async function saveSourceTranscriptCorrection() {
  if (!state.job?.id) return;
  try {
    const result = await api(`./api/product-workflows/replacement-jobs/${state.job.id}/source-transcript`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: $("#sourceTranscript").value })
    });
    state.job = result.job;
    state.voiceoverDecisionDirty = false;
    renderJob();
    notice($("#replaceTaskNotice"), "原片口播校正已保存，计时字符和新口播建议已同步更新。");
  } catch (error) {
    notice($("#replaceTaskNotice"), error.message, true);
  }
}

async function confirmVoiceoverAndCompileShotPlan() {
  if (!state.job?.id) return;
  const button = $("#confirmVoiceoverButton");
  button.disabled = true;
  try {
    await persistVoiceoverDecision({ quiet: true });
    const result = await api(`./api/product-workflows/replacement-jobs/${state.job.id}/voiceover-confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: $("#lockedScript").value })
    });
    state.job = result.job;
    state.voiceoverDecisionDirty = false;
    renderJob();
    notice($("#replaceTaskNotice"), `新口播已确认并按V${state.job.voiceoverDraft?.version || 1}编译ShotPlan。`);
  } catch (error) {
    notice($("#replaceTaskNotice"), error.message, true);
  } finally {
    button.disabled = false;
  }
}

async function createJob(event) {
  event.preventDefault();
  if (state.assetUploadBusy) return notice($("#replaceTaskNotice"), "请等待产品图上传完成。", true);
  if (!state.referenceUpload?.path) return notice($("#replaceTaskNotice"), "请先上传参考视频。", true);
  const replacementMode = selectedRadio("replacementMode");
  const replacesVoiceover = ["voiceover", "both"].includes(replacementMode);
  const backgroundOnly = replacementMode === "background";
  if (["product", "both"].includes(replacementMode) && !["reference", "generate"].includes(state.firstFrameStrategy)) return notice($("#replaceTaskNotice"), "请选择“沿用原片首帧”或“生成新首帧”。", true);
  if (["product", "both"].includes(replacementMode) && !selectedProductImageCount()) return notice($("#replaceTaskNotice"), "换产品任务至少需要 1 张视频上游产品参考图。", true);
  if (backgroundOnly && !$("#backgroundDescription").value.trim()) return notice($("#replaceTaskNotice"), "请填写目标背景描述。", true);
  const voiceoverMode = replacesVoiceover ? selectedRadio("voiceoverMode") : "old";
  const submittedVoiceoverScript = "";
  const imageModel = selectedImageModel();
  const selectedImageModelLabel = imageModelLabel(imageModel);
  const product = currentProduct();
  const draftJobId = state.job?.status === "draft" ? state.job.id : "";
  clearTimeout(replacementDraftSyncTimer);
  replacementDraftSyncPending = null;
  $("#createReplacementButton").disabled = true;
  $("#referenceVideoInput").disabled = true;
  notice($("#replaceTaskNotice"), state.firstFrameStrategy === "reference" && ["product", "both"].includes(replacementMode)
    ? "正在分析唯一参考视频；分析完成后将直接沿用已确认的原片首帧，不调用图片生成模型…"
    : replacementMode === "both"
    ? `正在登记参考视频音轨，同时用 ${selectedImageModelLabel} 准备平台新首帧；合规MP3将在视频生成前准备…`
    : replacementMode === "product"
      ? `正在读取唯一参考视频，并用 ${selectedImageModelLabel} 准备平台新首帧…`
      : backgroundOnly
        ? `正在分析唯一参考视频，并用 ${selectedImageModelLabel} 生成 1 张换背景新首帧…`
        : "正在登记参考视频音轨；合规MP3将在视频生成前准备…");
  try {
    const result = await api("./api/product-workflows/replacement-jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        draftJobId,
        referenceVideoPath: state.referenceUpload.path,
        referenceVideoName: state.referenceUpload.name,
        replacementMode,
        generationMode: selectedRadio("generationMode") || "manual",
        productId: product.id,
        productName: product.name,
        productAssetIds: [...state.selectedAssetIds],
        firstFrameAvailableAssetIds: [...state.firstFrameAvailableAssetIds],
        firstFrameAssetIds: [...state.firstFrameAssetIds],
        firstFrameStrategy: state.firstFrameStrategy,
        temporaryProductAssets: state.temporaryAssets.map((asset) => ({ path: asset.path, name: asset.name })),
        imageModel,
        videoModelId: selectedReplacementVideoModel()?.id || "seedance-2-vip",
        videoDuration: Number($("#replacementVideoDuration").value),
        videoClarity: $("#replacementVideoClarity").value,
        taskVariables: replacementTaskVariables(),
        voiceoverMode,
        voiceoverScript: submittedVoiceoverScript
      })
    });
    state.job = result.job;
    state.firstFramePromptDirty = false;
    updateVoiceoverUi();
    localStorage.setItem(REPLACEMENT_ACTIVE_TASK_KEY, result.job.id);
    saveReplacementDraft();
    window.dispatchEvent(new Event("module-task-updated"));
    startPolling();
  } catch (error) {
    notice($("#replaceTaskNotice"), error.message, true);
    $("#createReplacementButton").disabled = false;
    $("#referenceVideoInput").disabled = false;
    updateVoiceoverUi();
    saveReplacementDraft();
  }
}

function referenceFirstFrameCandidate(job = state.job) {
  const replacementMode = job?.replacementMode || selectedRadio("replacementMode") || "product";
  if (!["product", "both"].includes(replacementMode)) return null;
  const persisted = (job?.firstFrameCandidates || []).find((candidate) => candidate.source === "reference_frame");
  if (persisted) return persisted;
  const assets = job?.referenceAssets?.firstFramePreviewUrl
    ? job.referenceAssets
    : state.referenceUpload?.referenceAssets || job?.referenceAssets || {};
  const previewUrl = String(assets.firstFramePreviewUrl || "").trim();
  if (!previewUrl) return null;
  return {
    id: REFERENCE_FIRST_FRAME_CANDIDATE_ID,
    label: "原片首帧",
    source: "reference_frame",
    status: "success",
    imageModel: "reference-frame",
    imageModelLabel: "原片提取",
    previewUrl,
    thumbnailUrl: previewUrl
  };
}

function firstFrameCandidatesForView(job = state.job) {
  const frames = Array.isArray(job?.firstFrameCandidates) ? job.firstFrameCandidates : [];
  const reference = referenceFirstFrameCandidate(job);
  return reference
    ? [reference, ...frames.filter((candidate) => candidate.source !== "reference_frame")]
    : frames;
}

function firstFrameStrategySelectionHint() {
  const prefix = "原片首帧可直接沿用或改为生成新首帧。";
  if (state.firstFrameStrategy === "reference") return `${prefix}当前选定“原片首帧”，将作为新视频0.0秒起始状态图；ShotPlan关键帧仍独立重构。`;
  if (state.firstFrameStrategy === "generate") return `${prefix}当前选定“生成新首帧”，选用图将作为新视频0.0秒起始状态图，并作为ShotPlan关键帧的连续性参考。`;
  return `${prefix}待选定。`;
}

function firstFrameCandidateMarkup(candidate, job = state.job) {
  const selected = candidate.source === "reference_frame"
    ? state.firstFrameStrategy === "reference"
    : job?.selectedFirstFrameId === candidate.id;
  const generateSelected = state.firstFrameStrategy === "generate";
  const videoLocked = Boolean(job?.generatedJobId) || job?.status === "generation_started";
  const analysisBusy = ["preparing", "analyzing_video"].includes(String(job?.status || ""));
  const candidateBusy = (job?.firstFrameCandidates || []).some((item) => item.status === "generating");
  if (candidate.source === "reference_frame") return `
    <article class="pw-candidate rp-first-frame-candidate rp-reference-first-frame-candidate ${selected ? "selected" : ""}" data-first-frame-card="${escapeHtml(candidate.id)}">
      <button class="rp-candidate-preview" type="button" data-first-frame-preview="${escapeHtml(candidate.id)}" aria-label="查看原片首帧原图">
        <img src="${escapeHtml(candidate.thumbnailUrl || candidate.previewUrl)}" alt="原片首帧缩略图" loading="eager" />
        <span>查看原图</span>
      </button>
      ${selected ? '<p class="rp-initial-state-summary">已作为新视频 0.0 秒起始状态图；不替代 ShotPlan 换品关键帧。</p>' : ""}
      <footer>
        <span class="rp-candidate-actions rp-reference-first-frame-actions">
          <button class="rp-candidate-select" type="button" data-use-reference-first-frame aria-pressed="${selected}"${videoLocked || analysisBusy || candidateBusy ? " disabled" : ""}>沿用原片首帧</button>
          <button class="rp-candidate-select" type="button" data-generate-first-frame aria-pressed="${generateSelected}"${videoLocked || analysisBusy || candidateBusy ? " disabled" : ""}>生成新首帧</button>
        </span>
      </footer>
    </article>`;
  if (candidate.status === "success") return `
    <article class="pw-candidate rp-first-frame-candidate ${selected ? "selected" : ""}" data-first-frame-card="${escapeHtml(candidate.id)}">
      <button class="rp-candidate-preview" type="button" data-first-frame-preview="${escapeHtml(candidate.id)}" aria-label="查看${escapeHtml(candidate.label)}原图">
        <img src="${escapeHtml(candidate.thumbnailUrl || candidate.previewUrl)}" alt="${escapeHtml(candidate.label)}缩略图" loading="lazy" />
        <span>查看原图</span>
      </button>
      ${selected ? '<p class="rp-initial-state-summary">已作为新视频 0.0 秒起始状态图；后续 ShotPlan 关键帧继承产品数量、摆放、方向与空间关系。</p>' : ""}
      <footer>
        <span class="rp-candidate-meta"><b>${escapeHtml(candidate.label)}</b><small>${escapeHtml(candidate.imageModelLabel || job?.imageModelLabel || imageModelLabel(job?.imageModel))}</small></span>
        <span class="rp-candidate-actions">
          <button class="rp-candidate-select" type="button" data-first-frame-select="${escapeHtml(candidate.id)}" aria-pressed="${selected}">${selected ? "已选用" : "选用"}</button>
          <button class="rp-candidate-delete" type="button" data-first-frame-delete="${escapeHtml(candidate.id)}">删除</button>
        </span>
      </footer>
    </article>`;
  if (candidate.status === "failed") return `<article class="pw-candidate rp-first-frame-candidate failed" data-first-frame-card="${escapeHtml(candidate.id)}"><b>${escapeHtml(candidate.label)}失败</b><p>${escapeHtml(candidate.error)}</p></article>`;
  return `<article class="pw-candidate rp-first-frame-candidate generating" data-first-frame-card="${escapeHtml(candidate.id)}"><b>${escapeHtml(candidate.label)}</b><br />${escapeHtml(candidate.imageModelLabel || job?.imageModelLabel || imageModelLabel(job?.imageModel))}<br /><small>${escapeHtml(candidateProgress(candidate))}</small></article>`;
}

function renderFirstFrameCandidateWorkspace(job = state.job) {
  const frames = firstFrameCandidatesForView(job);
  const platformFrames = frames.filter((candidate) => candidate.source !== "custom_upload");
  const customFrames = frames.filter((candidate) => candidate.source === "custom_upload");
  const platformHost = $("#firstFrameCandidates");
  const customHost = $("#customFirstFrameCandidates");
  if (!platformHost || !customHost) return frames;
  platformHost.innerHTML = platformFrames.length
    ? platformFrames.map((candidate) => firstFrameCandidateMarkup(candidate, job)).join("")
    : `<div class="pw-empty"><span>${job?.status === "preparing" ? "正在准备上游资产" : "等待生成"}</span></div>`;
  customHost.innerHTML = customFrames.length
    ? customFrames.map((candidate) => firstFrameCandidateMarkup(candidate, job)).join("")
    : `<div class="pw-empty"><span>上传入口和候选预览已合并在此区域</span></div>`;
  $("#customFirstFrameUpload").hidden = customFrames.length > 0;
  renderFirstFrameCandidateTabs(job, frames);
  wireFirstFrameCandidateDecisions();
  if (frames.some((candidate) => candidate.source === "reference_frame")) {
    $("#firstFrameSelectionHint").textContent = firstFrameStrategySelectionHint();
  }
  updateWorkflowStepProgress();
  return frames;
}

function activateFirstFrameCandidateTab(candidateId, { focus = false } = {}) {
  const cards = $$('[data-first-frame-card]');
  const selectedCard = cards.find((card) => card.dataset.firstFrameCard === candidateId) || cards[0];
  const selectedId = selectedCard?.dataset.firstFrameCard || "";
  state.activeFirstFrameCandidateId = selectedId;
  cards.forEach((card) => { card.hidden = card !== selectedCard; });
  const platformContainer = $("#firstFrameCandidates");
  const customContainer = $("#customFirstFrameCandidates");
  const customActive = selectedCard?.closest("#customFirstFrameCandidates") === customContainer;
  if (platformContainer) platformContainer.hidden = Boolean(selectedCard) && customActive;
  if (customContainer) customContainer.hidden = !customActive;
  $$('[data-first-frame-tab]').forEach((tab) => {
    const active = tab.dataset.firstFrameTab === selectedId;
    tab.setAttribute("aria-selected", String(active));
    tab.tabIndex = active ? 0 : -1;
    if (active && focus) tab.focus();
  });
}

function renderFirstFrameCandidateTabs(job, frames) {
  const tabList = $("#firstFrameTabButtons");
  if (!tabList) return;
  if (!frames.length) {
    tabList.innerHTML = '<span class="rp-first-frame-tab-placeholder">等待生成</span>';
    state.activeFirstFrameCandidateId = "";
    $("#firstFrameCandidates").hidden = false;
    $("#customFirstFrameCandidates").hidden = true;
    return;
  }
  tabList.innerHTML = frames.map((candidate, index) => {
    const label = candidate.source === "reference_frame" ? "原片" : candidate.source === "custom_upload" ? "自定义" : (candidate.label || `V${index + 1}`);
    return `<button class="rp-first-frame-tab" type="button" role="tab" data-first-frame-tab="${escapeHtml(candidate.id)}" title="${escapeHtml(candidate.label || label)}">${escapeHtml(label)}</button>`;
  }).join("");
  const availableIds = new Set(frames.map((candidate) => candidate.id));
  const activeGenerating = frames.find((candidate) => candidate.status === "generating");
  const fallback = activeGenerating?.id || (availableIds.has(job?.selectedFirstFrameId) ? job.selectedFirstFrameId : frames[0].id);
  const nextActive = availableIds.has(state.activeFirstFrameCandidateId) ? state.activeFirstFrameCandidateId : fallback;
  activateFirstFrameCandidateTab(nextActive);
}

function replacementAnalysisStepState(job = state.job) {
  const status = String(job?.status || "");
  const hasAnalysis = Boolean(job?.sourceAnalysis?.status === "completed");
  const hasPlan = Boolean(job?.shotPlan?.units?.length);
  return {
    media: job && status !== "draft" ? "done" : "",
    frames: hasAnalysis ? "done" : status === "analyzing_video" ? "active" : "",
    semantics: hasAnalysis ? "done" : status === "analyzing_video" ? "active" : "",
    plan: hasPlan ? "done" : hasAnalysis ? "active" : ""
  };
}

function setSourceAnalysisExpanded(expanded) {
  state.sourceAnalysisExpanded = Boolean(expanded);
  const content = $("#sourceAnalysisContent");
  const button = $("#toggleSourceAnalysisButton");
  if (content) content.hidden = !state.sourceAnalysisExpanded;
  if (button) {
    button.setAttribute("aria-expanded", String(state.sourceAnalysisExpanded));
    button.textContent = state.sourceAnalysisExpanded ? "收起原片分析" : "查看原片分析";
  }
  $("#sourceAnalysisPanel")?.classList.toggle("is-expanded", state.sourceAnalysisExpanded);
}

function renderAnalysisWorkspace(job = state.job) {
  const analysisJobId = String(job?.id || "");
  if (state.sourceAnalysisActiveJobId !== analysisJobId) {
    state.sourceAnalysisActiveJobId = analysisJobId;
    state.sourceAnalysisExpanded = false;
  }
  const mode = job?.generationMode || selectedRadio("generationMode") || "manual";
  const modeInput = document.querySelector(`input[name="generationMode"][value="${mode}"]`);
  if (modeInput) modeInput.checked = true;
  const smart = mode === "smart";
  $("#sourceAnalysisPanel").hidden = smart;
  $("#shotPlanPanel").hidden = smart;
  setSourceAnalysisExpanded(state.sourceAnalysisExpanded);

  const steps = replacementAnalysisStepState(job);
  $$('[data-analysis-step]').forEach((element) => {
    const stateName = steps[element.dataset.analysisStep] || "";
    element.classList.toggle("done", stateName === "done");
    element.classList.toggle("active", stateName === "active");
    element.textContent = `${stateName === "done" ? "✓" : stateName === "active" ? "●" : "○"} ${element.textContent.replace(/^[✓●○]\s*/, "")}`;
  });

  const analysis = job?.sourceAnalysis;
  $("#sourceAnalysisStatus").textContent = analysis
    ? `${analysis.provider || "Qwen 3.7 Plus"} · ${analysis.inputMode === "video_url" ? "视频直读" : "关键帧降级"}`
    : job?.status === "analyzing_video" ? "正在深度拆解原片" : "等待开始分析";
  if (analysis) {
    const planUnits = (job.shotPlan?.units || []).filter((unit) => unit.included !== false);
    const plan = job.shotPlan || {};
    $("#sourceAnalysisSummary").innerHTML = [
      [Number(analysis.duration || 0).toFixed(1), "原片时长（秒）"],
      [analysis.originalShotCount || analysis.sourceShots?.length || 0, "识别原始镜头"],
      [plan.semanticSegmentCount ?? analysis.semanticSegments?.length ?? 0, "语义动作阶段"],
      [plan.subjectProfileCount ?? analysis.subjectProfiles?.length ?? 0, "人物身份档案"],
      [plan.identityReviewShotCount ?? analysis.identityReviewShotCount ?? 0, "身份待核镜头"],
      [plan.productVisibleShotCount ?? planUnits.filter((unit) => unit.productVisible).length, "产品可见镜头"],
      [`${plan.coveredAnchorCount || 0}/${plan.requiredAnchorCount || 0}`, "换品锚点覆盖"],
      [plan.videoNodeCount ?? plan.generationUnits?.length ?? 0, "最终生成节点"]
    ].map(([value, label]) => `<div class="rp-analysis-metric"><b>${escapeHtml(value)}</b><span>${escapeHtml(label)}</span></div>`).join("");
    const deepDiveFields = [
      ["镜头与机位", analysis.deepDive?.camera], ["身体姿态", analysis.deepDive?.bodyPosture],
      ["眼神与表情", analysis.deepDive?.gazeExpression], ["手部与产品动作", analysis.deepDive?.handActions],
      ["口播节奏", analysis.deepDive?.speakingRhythm], ["产品露出逻辑", analysis.deepDive?.productExposureLogic],
      ["转场与连续性", analysis.deepDive?.transitionLogic], ["可复刻 / 不宜机械照搬", [analysis.deepDive?.replicablePoints, analysis.deepDive?.avoidMechanicalCopy].filter(Boolean).join("；")]
    ].filter(([, value]) => value);
    $("#sourceAnalysisDeepDive").innerHTML = deepDiveFields.length
      ? deepDiveFields.map(([label, value]) => `<div class="rp-deep-dive-item"><b>${escapeHtml(label)}</b><p>${escapeHtml(value)}</p></div>`).join("")
      : `<div class="pw-empty"><span>${escapeHtml(analysis.summary || "分析已完成")}</span></div>`;
  } else {
    $("#sourceAnalysisSummary").innerHTML = `<div class="pw-empty"><span>${job?.status === "analyzing_video" ? "Qwen 3.7 Plus 正在识别镜头切点、动作、产品露出与连续性…" : "点击“分析参考视频并生成新首帧”后，将在这里显示原片时长、镜头数量、动作和产品露出摘要。"}</span></div>`;
    $("#sourceAnalysisDeepDive").innerHTML = "";
  }
  renderShotPlan(job);
}

function shotPlanFramesForUnit(keyframes = [], unit = {}, requiredFrameIds = []) {
  return keyframes.filter((frame) => requiredFrameIds.includes(frame.id) || (frame.sourceShotId
    ? (unit.sourceShotIds || []).includes(frame.sourceShotId)
    : frame.time >= unit.sourceStart - 0.001 && frame.time <= unit.sourceEnd + 0.001));
}

function centerShotPlanTab(activeButton) {
  const tabList = activeButton?.closest(".rp-shot-plan-tabs");
  if (!tabList) return;
  const maximumScrollLeft = Math.max(0, tabList.scrollWidth - tabList.clientWidth);
  if (maximumScrollLeft <= 1) return;
  const hiddenOnLeft = tabList.scrollLeft > 1;
  const hiddenOnRight = tabList.scrollLeft < maximumScrollLeft - 1;
  if (!hiddenOnLeft && !hiddenOnRight) return;
  const tabListRect = tabList.getBoundingClientRect();
  const activeButtonRect = activeButton.getBoundingClientRect();
  const centeredScrollLeft = tabList.scrollLeft
    + activeButtonRect.left
    - tabListRect.left
    - ((tabList.clientWidth - activeButtonRect.width) / 2);
  tabList.scrollTo({
    left: Math.max(0, Math.min(maximumScrollLeft, centeredScrollLeft)),
    behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth"
  });
}

function activateShotPlanTab(unitId, options = {}) {
  const list = $("#shotPlanList");
  if (!list || !unitId) return;
  state.shotPlanActiveUnitId = unitId;
  let activeButton = null;
  list.querySelectorAll("[data-shot-tab]").forEach((button) => {
    const active = button.dataset.shotTab === unitId;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
    button.tabIndex = active ? 0 : -1;
    if (active) activeButton = button;
  });
  list.querySelectorAll("[data-shot-unit]").forEach((panel) => {
    panel.hidden = panel.dataset.shotUnit !== unitId;
  });
  if (options.focus === true && activeButton) {
    activeButton.focus({ preventScroll: true });
    centerShotPlanTab(activeButton);
  }
}

function shotAnchorCandidateStateKey(unitId, frameId) {
  return `${unitId}:${frameId}`;
}

function activateShotAnchorCandidate(unitId, frameId, candidateId, options = {}) {
  const pair = $(`[data-shot-unit="${CSS.escape(unitId)}"] [data-anchor-frame="${CSS.escape(frameId)}"]`);
  if (!pair || !candidateId) return;
  state.shotAnchorActiveCandidateIds[shotAnchorCandidateStateKey(unitId, frameId)] = candidateId;
  let activeButton = null;
  pair.querySelectorAll("[data-anchor-candidate-tab]").forEach((button) => {
    const active = button.dataset.anchorCandidateTab === candidateId;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
    button.tabIndex = active ? 0 : -1;
    if (active) activeButton = button;
  });
  pair.querySelectorAll("[data-anchor-candidate-panel]").forEach((panel) => {
    panel.hidden = panel.dataset.anchorCandidatePanel !== candidateId;
  });
  if (options.focus === true && activeButton) activeButton.focus({ preventScroll: true });
}

function renderShotPlan(job = state.job) {
  const plan = job?.shotPlan;
  const list = $("#shotPlanList");
  const manual = (job?.generationMode || selectedRadio("generationMode") || "manual") === "manual";
  const locked = Boolean(job?.generatedJobId) || job?.status === "generation_started";
  if (!plan?.units?.length) {
    list.innerHTML = `<div class="pw-empty"><span>${job?.status === "analyzing_video" ? "正在生成ShotPlan…" : "分析完成后，将按原始镜头显示动作阶段与必需换品锚点。"}</span></div>`;
    $("#shotPlanStatus").textContent = job?.status === "analyzing_video" ? "正在规划" : "等待原片分析";
    $("#confirmShotPlanButton").disabled = true;
    return;
  }
  if (state.shotPlanActiveJobId !== String(job?.id || "")) {
    state.shotPlanActiveJobId = String(job?.id || "");
    state.shotPlanActiveUnitId = "";
    state.shotAnchorActiveCandidateIds = {};
    state.shotPlanAdjusting = false;
  }
  const keyframes = job.sourceAnalysis?.keyframes || [];
  const anchorCandidates = job.shotAnchorCandidates || [];
  const editable = manual && !locked;
  const adjusting = editable && state.shotPlanAdjusting;
  const policyLabels = { video: "完整原片", keyframes: "时间戳关键帧", none: "无参考" };
  const coverageByShot = new Map((plan.coverageMatrix || []).map((row) => [row.sourceShotId, row]));
  const generationPlanningUnits = Array.isArray(plan.generationPlanning?.units) ? plan.generationPlanning.units : [];
  const generationPlanningBySourceUnitId = new Map(generationPlanningUnits.flatMap((planningUnit) => (
    (planningUnit.sourceUnitIds || []).map((sourceUnitId) => [sourceUnitId, planningUnit])
  )));
  const executionClassification = plan.executionClassification || {};
  const t4Blocked = executionClassification.type === "T4" || executionClassification.decision === "manual_review";
  const t4Reason = t4Blocked
    ? (executionClassification.reasons || []).filter(Boolean).join("；") || "当前原片结构或连续性证据不足"
    : "";
  const planningWarning = (plan.generationPlanning?.warnings || []).map((item) => item.message).filter(Boolean).join("；");
  const splitReason = t4Reason
    || (plan.blockingReasons || []).map((item) => item.message).filter(Boolean).join("；")
    || planningWarning
    || (plan.splitReasonCodes || []).join(" + ");
  const executionLabel = t4Blocked ? "T4已停止自动生成" : plan.videoNodeCount === 1 ? "单节点生成" : plan.videoNodeCount > 1 ? `${plan.videoNodeCount}个生成节点` : "计划被阻塞";
  const activeUnitId = plan.units.some((unit) => unit.id === state.shotPlanActiveUnitId)
    ? state.shotPlanActiveUnitId
    : plan.units[0].id;
  state.shotPlanActiveUnitId = activeUnitId;
  const physicalStateCount = Number(plan.physicalStateAnchorCount || 0);
  const mergedGenerationUnitCount = Number(plan.generationPlanning?.mergedUnits?.length || 0);
  const summaryTitle = mergedGenerationUnitCount ? "连续生成组" : physicalStateCount ? "开箱连续动作" : "ShotPlan关键帧";
  const planSummary = `<section class="rp-shot-plan-summary ${plan.preflightStatus === "blocked" || t4Blocked ? "is-blocked" : ""}">
    <div><strong>${summaryTitle}</strong><span>${mergedGenerationUnitCount ? `${mergedGenerationUnitCount}个语义合并组 · ` : ""}${physicalStateCount || plan.units.length}个关键状态 · 需生成${plan.requiredAnchorCount || 0}张 · ${escapeHtml(executionLabel)}</span></div>
    <button type="button" data-toggle-shot-adjust ${editable ? "" : "disabled"}>${adjusting ? "完成调整" : "调整关键帧"}</button>
    ${splitReason ? `<p>${escapeHtml(splitReason)}</p>` : ""}
  </section>`;
  const tabs = plan.units.map((unit, index) => {
    const requiredFrameIds = unit.requiredKeyframeIds || unit.keyframeIds || [];
    const coverage = coverageByShot.get(unit.sourceShotIds?.[0]);
    const statusLabel = unit.anchorStrategy === "inherit_previous"
      ? (coverage?.covered ? "已共用锚点" : "待共享锚点")
      : coverage?.covered ? "已覆盖" : unit.productVisible ? "待补锚点" : "无需锚点";
    const statusClass = coverage?.covered ? "covered" : unit.productVisible ? "pending" : "optional";
    const panelId = `shotPlanUnitPanel-${index + 1}`;
    const tabId = `shotPlanUnitTab-${index + 1}`;
    const active = unit.id === activeUnitId;
    return `<button class="rp-shot-plan-tab ${active ? "active" : ""}" id="${tabId}" type="button" role="tab" aria-selected="${active}" aria-controls="${panelId}" tabindex="${active ? "0" : "-1"}" data-shot-tab="${escapeHtml(unit.id)}" title="原片镜头 ${String(unit.order).padStart(2, "0")}｜${escapeHtml(unit.title)}">
      <span><b>镜头 ${String(unit.order).padStart(2, "0")}</b><i class="${statusClass}">${statusLabel}</i></span>
      <strong>${escapeHtml(unit.title)}</strong>
      <small>${Number(unit.sourceStart).toFixed(1)}–${Number(unit.sourceEnd).toFixed(1)}秒 · <em class="rp-shot-tab-progress">${requiredFrameIds.length}张待生成</em></small>
    </button>`;
  }).join("");
  const cards = plan.units.map((unit, unitIndex) => {
    const requiredFrameIds = unit.requiredKeyframeIds || unit.keyframeIds || [];
    const inheritsPreviousAnchor = unit.anchorStrategy === "inherit_previous";
    const sharesPreviousKeyframe = unit.mergeWithPrevious === true || inheritsPreviousAnchor;
    const generationPlanningUnit = generationPlanningBySourceUnitId.get(unit.id) || null;
    const displayFrames = shotPlanFramesForUnit(keyframes, unit, requiredFrameIds);
    const unitAnchors = anchorCandidates.filter((candidate) => candidate.shotPlanUnitId === unit.id);
    const selectedAnchorIds = new Set(unit.selectedAnchorCandidateIds || []);
    const anchorSelection = unit.anchorSelection || null;
    const generatingAnchors = unitAnchors.some((candidate) => candidate.status === "generating") || state.shotAnchorBusyUnitId === unit.id;
    const timelineMarkup = (unit.timeline || []).map((item) => `<li><b>${Number(item.sourceStart).toFixed(1)}–${Number(item.sourceEnd).toFixed(1)}秒</b><span>${escapeHtml(item.action || "按镜头功能复刻")}</span>${item.sourceKeyframeId ? `<em>${escapeHtml(item.sourceKeyframeId)} · ${Number(item.sourceKeyframeTime || item.criticalTime || 0).toFixed(1)}秒</em>` : ""}</li>`).join("");
    const pairMarkup = requiredFrameIds.map((frameId, frameIndex) => {
      const frame = keyframes.find((item) => item.id === frameId);
      const frameState = (anchorSelection?.candidates || []).find((item) => item.frameId === frameId) || {};
      const stateLabel = frameState.stateLabel || frame?.label || "关键状态";
      const canonical = frameId === anchorSelection?.canonicalSourceKeyframeId;
      const candidates = unitAnchors.filter((candidate) => candidate.sourceKeyframeId === frameId);
      const frameGenerating = candidates.some((candidate) => candidate.status === "generating")
        || (state.shotAnchorBusyUnitId === unit.id && state.shotAnchorBusyFrameId === frameId);
      const hasSuccessfulCandidate = candidates.some((candidate) => candidate.status === "success");
      const candidateStateKey = shotAnchorCandidateStateKey(unit.id, frameId);
      const preferredCandidateId = state.shotAnchorActiveCandidateIds[candidateStateKey];
      const activeCandidate = candidates.find((candidate) => candidate.id === preferredCandidateId)
        || candidates.find((candidate) => selectedAnchorIds.has(candidate.id))
        || [...candidates].reverse().find((candidate) => candidate.status === "success")
        || candidates[candidates.length - 1];
      if (activeCandidate) state.shotAnchorActiveCandidateIds[candidateStateKey] = activeCandidate.id;
      const candidateTabs = candidates.map((candidate, candidateIndex) => {
        const active = candidate.id === activeCandidate?.id;
        const version = Math.max(1, Number(candidate.version || candidateIndex + 1));
        return `<button id="anchorCandidateTab-${unitIndex + 1}-${frameIndex + 1}-${candidateIndex + 1}" type="button" role="tab" aria-selected="${active}" aria-controls="anchorCandidatePanel-${unitIndex + 1}-${frameIndex + 1}-${candidateIndex + 1}" tabindex="${active ? "0" : "-1"}" class="rp-anchor-candidate-tab ${active ? "active" : ""}" data-anchor-candidate-tab="${escapeHtml(candidate.id)}" data-anchor-unit="${escapeHtml(unit.id)}" data-anchor-frame-id="${escapeHtml(frameId)}">候选 V${version}</button>`;
      }).join("");
      const candidatePanels = candidates.map((candidate, candidateIndex) => {
        const active = candidate.id === activeCandidate?.id;
        const selected = selectedAnchorIds.has(candidate.id);
        const statusCopy = candidate.productValidation === "auto_qa_passed"
          ? "结构契约自动校验通过"
          : selected ? "当前已选用，可切换其他候选对比" : "生成完成，等待查看或选用";
        if (candidate.status === "success") return `<article id="anchorCandidatePanel-${unitIndex + 1}-${frameIndex + 1}-${candidateIndex + 1}" class="rp-shot-anchor-candidate-panel ${selected ? "selected" : ""}" role="tabpanel" aria-labelledby="anchorCandidateTab-${unitIndex + 1}-${frameIndex + 1}-${candidateIndex + 1}" data-anchor-candidate-panel="${escapeHtml(candidate.id)}" ${active ? "" : "hidden"}>
          <div class="rp-anchor-candidate-preview">${selected ? `<i class="rp-anchor-selected-mark" aria-label="已选用">✓</i>` : ""}<img src="${escapeHtml(candidate.thumbnailUrl || candidate.previewUrl)}" alt="${escapeHtml(candidate.label || `新关键帧 ${candidateIndex + 1}`)}" loading="lazy" /></div>
          <div class="rp-anchor-candidate-info"><span><b>${escapeHtml(candidate.label || `新关键帧 ${candidateIndex + 1}`)}</b><small>${escapeHtml(statusCopy)}</small></span><div><button type="button" data-anchor-select="${escapeHtml(candidate.id)}" data-anchor-unit="${escapeHtml(unit.id)}" class="${selected ? "selected" : ""}">${selected ? "✓ 已选用" : "选用此图"}</button><button type="button" data-anchor-delete="${escapeHtml(candidate.id)}" data-anchor-unit="${escapeHtml(unit.id)}">删除</button></div></div>
        </article>`;
        const pendingCopy = candidate.status === "failed"
          ? escapeHtml(candidate.error || "生成失败，可点击上方按钮单独重试")
          : candidate.status === "stale"
            ? escapeHtml(candidate.invalidationReason || "连续性母版已变化，将自动重新生成")
            : `${escapeHtml(candidate.stageLabel || "生成中")} · 已等待${Number(candidate.elapsedSeconds || 0)}秒`;
        return `<article id="anchorCandidatePanel-${unitIndex + 1}-${frameIndex + 1}-${candidateIndex + 1}" class="rp-shot-anchor-candidate-panel ${escapeHtml(candidate.status)}" role="tabpanel" aria-labelledby="anchorCandidateTab-${unitIndex + 1}-${frameIndex + 1}-${candidateIndex + 1}" data-anchor-candidate-panel="${escapeHtml(candidate.id)}" ${active ? "" : "hidden"}><div class="rp-anchor-candidate-info"><span><b>${escapeHtml(candidate.label || `新关键帧 ${candidateIndex + 1}`)}</b><small>${pendingCopy}</small></span></div></article>`;
      }).join("");
      const candidateMarkup = candidates.length
        ? `<nav class="rp-anchor-candidate-tabs" role="tablist" aria-label="${escapeHtml(stateLabel)}的新关键帧候选">${candidateTabs}</nav><div class="rp-anchor-candidate-panels">${candidatePanels}</div>`
        : `<span class="rp-shot-anchor-empty">尚未生成对应的新换品关键帧</span>`;
      return `<article class="rp-anchor-pair" data-anchor-frame="${escapeHtml(frameId)}">
        <div class="rp-anchor-results">
          <header><span><b>${escapeHtml(stateLabel)}</b><small>对应原片 ${Number(frame?.time || 0).toFixed(1)}秒 · ${canonical ? "全开箱基准" : "需生成"}</small></span><button type="button" data-regenerate-keyframe="${escapeHtml(frameId)}" data-anchor-unit="${escapeHtml(unit.id)}" ${!plan.confirmed || state.shotPlanDirty || locked || state.shotAnchorBatchBusy || generatingAnchors || frameGenerating ? "disabled" : ""}>${frameGenerating ? "生成中…" : hasSuccessfulCandidate ? "+ 重新生成新关键帧" : "生成新关键帧"}</button></header>
          <div>${candidateMarkup}</div>
        </div>
      </article>`;
    }).join("") || `<span class="rp-shot-anchor-empty">${inheritsPreviousAnchor ? `本镜头沿用${unit.inheritsAnchorFromUnitId ? "上一镜头" : "前序镜头"}的换品锚点，无需重复生成关键帧。` : unit.productVisible ? "当前产品可见镜头缺少候选关键帧，已阻塞确认" : "本镜头产品不可见，无需换品锚点"}</span>`;
    const coverage = coverageByShot.get(unit.sourceShotIds?.[0]);
    const physicalCandidates = new Map((anchorSelection?.candidates || []).map((item) => [item.frameId, item]));
    const selectedStateFrameIds = new Set(anchorSelection?.selectedStateFrameIds || requiredFrameIds);
    const primaryFrames = displayFrames.filter((frame) => selectedStateFrameIds.has(frame.id) || (!anchorSelection && requiredFrameIds.includes(frame.id)));
    const supportFrames = displayFrames.filter((frame) => !primaryFrames.some((item) => item.id === frame.id));
    const frameOptionMarkup = (frame, frameIndex) => {
      const physicalState = physicalCandidates.get(frame.id) || {};
      const reused = physicalState.revealState === "pre_reveal" && physicalState.productVisible !== true;
      const canonical = frame.id === anchorSelection?.canonicalSourceKeyframeId;
      const checked = requiredFrameIds.includes(frame.id);
      const badge = reused ? "沿用原片" : canonical ? "全开箱基准" : checked ? "需生成" : "候选";
      const stateLabel = physicalState.stateLabel || frame.label || `关键状态${frameIndex + 1}`;
      return `<label class="rp-shot-keyframe-option ${reused ? "is-reused" : ""} ${canonical ? "is-canonical" : ""}" title="${escapeHtml(frame.label)}"><input type="checkbox" data-unit-keyframe="${escapeHtml(unit.id)}" value="${escapeHtml(frame.id)}" ${checked ? "checked" : ""} ${adjusting && !inheritsPreviousAnchor && !reused ? "" : "disabled"} /><i class="rp-keyframe-check" aria-hidden="true">✓</i><strong class="rp-keyframe-index">${badge}</strong><img src="${escapeHtml(frame.previewUrl)}" alt="${escapeHtml(frame.label)}" loading="lazy" /><span><b>${escapeHtml(stateLabel)}</b><small>原片 ${Number(frame.time || 0).toFixed(1)}秒</small></span></label>`;
    };
    const primaryFrameMarkup = primaryFrames.length
      ? primaryFrames.map((frame, index) => frameOptionMarkup(frame, index)).join("")
      : `<span class="rp-shot-anchor-empty">本镜头无需单独生成关键帧</span>`;
    const supportFrameMarkup = supportFrames.length
      ? `<details class="rp-shot-support-frames"><summary>查看其余候选（${supportFrames.length}）</summary><div class="rp-shot-keyframes">${supportFrames.map((frame, index) => frameOptionMarkup(frame, index)).join("")}</div></details>`
      : "";
    const sourceFrameMarkup = displayFrames.length ? `<div class="rp-shot-keyframes">${primaryFrameMarkup}</div>${supportFrameMarkup}` : `<span class="rp-shot-anchor-empty">此镜头没有可用原片关键帧，请重新分析参考视频。</span>`;
    const personTrackMarkup = (unit.personTracks || []).length
      ? (unit.personTracks || []).map((track) => {
          const primary = track.primaryFeatures || {};
          const auxiliary = track.auxiliaryFeatures || {};
          return `<li><b>${escapeHtml(track.personId || "未确认人物")}</b><span>${escapeHtml(track.label || track.role || "人物")}</span><small>主要：${escapeHtml([primary.face, primary.hair, primary.bodyType].filter(Boolean).join(" / ") || "未确认")}；辅助：${escapeHtml([auxiliary.clothing, auxiliary.accessories].filter(Boolean).join(" / ") || "未确认")}；置信度 ${Number(track.identityConfidence || 0).toFixed(2)}</small></li>`;
        }).join("")
      : `<li><b>未检测人物轨迹</b><small>不得依据性别或上一镜头自动推断身份</small></li>`;
    const generationPlanningMarkup = generationPlanningUnit ? `<section class="rp-generation-group-summary ${generationPlanningUnit.kind === "merged_generation_unit" ? "is-merged" : ""}">
      <header><b>${escapeHtml(generationPlanningUnit.label || "独立生成组")}</b><span>${generationPlanningUnit.kind === "merged_generation_unit" ? `镜头 ${(generationPlanningUnit.sourceUnitIds || []).map((sourceUnitId) => String((plan.units.find((item) => item.id === sourceUnitId)?.order || "")).padStart(2, "0")).join(" + ")}` : "当前镜头独立编译"}</span></header>
      <p><b>连续动作：</b>${escapeHtml(generationPlanningUnit.continuousActionSummary || "按原片连续执行")}</p>
      <p><b>人物：</b>${escapeHtml(generationPlanningUnit.personContinuitySummary || "按原片边界保持")}</p>
      <p><b>产品：</b>${escapeHtml(generationPlanningUnit.productStateSummary || "保持原片产品状态")}</p>
      <p><b>关键帧：</b>${escapeHtml(generationPlanningUnit.anchorSummary || "按规划连接")}</p>
      <small>已重算动作、人物、产品、资产和质检</small>
    </section>` : "";
    return `<article class="rp-shot-card ${unit.included === false ? "is-excluded" : ""}" id="shotPlanUnitPanel-${unitIndex + 1}" role="tabpanel" aria-labelledby="shotPlanUnitTab-${unitIndex + 1}" data-shot-unit="${escapeHtml(unit.id)}" ${unit.id === activeUnitId ? "" : "hidden"}>
      <div class="rp-shot-main">
        <header><b>镜头 ${String(unit.order).padStart(2, "0")}｜${escapeHtml(unit.title)}</b><span>${Number(unit.sourceStart).toFixed(1)}–${Number(unit.sourceEnd).toFixed(1)}秒</span><i class="rp-shot-risk">${coverage?.covered ? "已生成" : unit.productVisible ? "待调整" : "沿用原片"}</i></header>
        ${adjusting ? `<section class="rp-shot-merge-controls">
          <label><input type="checkbox" data-unit-merge="${escapeHtml(unit.id)}" ${sharesPreviousKeyframe ? "checked" : ""} ${!editable || unitIndex === 0 ? "disabled" : ""} /><span><b>与上一个镜头共用关键帧</b><small>${unitIndex === 0 ? "首个镜头不可共用" : unit.identityBoundarySplit ? "存在人物身份边界；系统会先核对人物和产品冲突" : "建立连续生成组，并重算动作、人物、产品、资产与质检"}</small></span></label>
        </section>` : ""}
        ${generationPlanningMarkup}
        <div class="rp-shot-state-results-layout">
          <section class="rp-shot-source-selection">
            <header><b>关键状态</b><em class="rp-keyframe-selection-count">${anchorSelection?.stateAnchorCount || requiredFrameIds.length}个状态 · 需生成${requiredFrameIds.length}张</em></header>
            ${unit.identityBoundarySplit ? `<p class="rp-shot-identity-rule">此卡来自人物身份边界拆分；系统不会因共用关键帧删除原片边界，明确不同人物会阻止语义合并。</p>` : ""}
            ${unit.budgetSelectionReason ? `<p class="rp-shot-budget-rule">智能建议：${escapeHtml(unit.budgetSelectionReason)}</p>` : ""}
            ${sourceFrameMarkup}
          </section>
          <section class="rp-shot-anchors"><header><b>生成结果</b><small>候选以 Tab 保留，可逐张查看和选用</small></header><div class="rp-anchor-pairs">${pairMarkup}</div></section>
        </div>
        <details class="rp-shot-details">
          <summary>查看人物身份、动作时间轴与规划依据</summary>
          <div>
            <p><b>人物身份：</b>${unit.identityReviewRequired ? "待人工核对，已禁止自动与相邻镜头合并" : `结构化轨迹已建立，置信度 ${Number(unit.identityConfidence ?? 1).toFixed(2)}`}</p>
            <ul class="rp-shot-person-tracks">${personTrackMarkup}</ul>
            <p><b>关键帧建议：</b>${escapeHtml(policyLabels[unit.recommendedReferencePolicy] || "时间戳关键帧")} · ${escapeHtml(unit.referenceReason || "按动作复杂度自动判断")}</p>
            <p><b>镜头划分依据：</b>${escapeHtml(unit.splitReason || "用于解释原片结构，不创建独立视频节点")}</p>
            ${timelineMarkup ? `<ol class="rp-shot-timeline">${timelineMarkup}</ol>` : ""}
          </div>
        </details>
      </div>
    </article>`;
  }).join("");
  const tabNavigation = plan.units.length > 1
    ? `<nav class="rp-shot-plan-tabs" role="tablist" aria-label="原片镜头">${tabs}</nav>`
    : "";
  list.innerHTML = `${planSummary}${tabNavigation}<div class="rp-shot-plan-panels">${cards}</div>`;
  $("#shotPlanStatus").textContent = t4Blocked ? "T4已阻断" : state.shotPlanDirty ? "待确认调整" : plan.confirmed ? "规划已确认" : "等待确认";
  $("#shotPlanNotice").textContent = t4Blocked ? `已停止自动生成：${t4Reason}` : adjusting ? "选择要生成的关键状态后确认。" : "系统只生成最少必要关键帧，其余候选保留供调整。";
  const confirmButton = $("#confirmShotPlanButton");
  const missingAnchorCount = missingShotAnchorBatches(job).reduce((sum, batch) => sum + batch.sourceKeyframeIds.length, 0);
  confirmButton.hidden = !manual;
  confirmButton.disabled = !editable || state.shotPlanSaving || state.shotAnchorBatchBusy || t4Blocked || Boolean((plan.blockingReasons || []).length);
  confirmButton.textContent = state.shotAnchorBatchBusy
    ? "正在生成关键帧…"
    : state.shotPlanDirty
      ? `确认并生成${plan.requiredAnchorCount || 0}张`
      : plan.confirmed
        ? (missingAnchorCount ? `生成缺失${missingAnchorCount}张` : "关键帧已生成")
        : `确认并生成${plan.requiredAnchorCount || 0}张`;
}

function collectShotPlanUnits() {
  return $$('[data-shot-unit]').map((card) => {
    const id = card.dataset.shotUnit;
    const existingUnit = state.job?.shotPlan?.units?.find((unit) => unit.id === id);
    const mergeWithPrevious = card.querySelector(`[data-unit-merge="${CSS.escape(id)}"]`)?.checked ?? (existingUnit?.mergeWithPrevious === true || existingUnit?.anchorStrategy === "inherit_previous");
    return {
      id,
      included: true,
      targetDuration: Number(existingUnit?.targetDuration || 5),
      referencePolicy: "keyframes",
      mergeWithPrevious,
      anchorStrategy: mergeWithPrevious ? "inherit_previous" : "generate",
      keyframeIds: [...card.querySelectorAll(`[data-unit-keyframe="${CSS.escape(id)}"]:checked`)].map((input) => input.value)
    };
  });
}

async function saveShotPlan(options = {}) {
  if (!state.job?.shotPlan || state.shotPlanSaving) return;
  const units = collectShotPlanUnits();
  let savedAndConfirmed = false;
  state.shotPlanSaving = true;
  renderShotPlan(state.job);
  try {
    const result = await api(`./api/product-workflows/replacement-jobs/${encodeURIComponent(state.job.id)}/shot-plan`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        generationMode: selectedRadio("generationMode") || state.job.generationMode || "manual",
        units,
        confirm: options.confirm === true
      })
    });
    state.job = result.job;
    state.shotPlanDirty = false;
    savedAndConfirmed = Boolean(state.job.shotPlan?.confirmed);
    if (savedAndConfirmed) state.shotPlanAdjusting = false;
    renderJob();
    notice($("#replaceTaskNotice"), state.job.shotPlan?.confirmed ? "锚点规划已确认，正在检查并批量生成缺失的新关键帧。" : "已切换生成模式。", false);
    window.dispatchEvent(new Event("module-task-updated"));
  } catch (error) {
    notice($("#replaceTaskNotice"), error.message, true);
  } finally {
    state.shotPlanSaving = false;
    renderShotPlan(state.job);
  }
  if (savedAndConfirmed && options.generateAnchors === true) await generateMissingShotAnchors();
}

async function replanShotPlanForSelectedModel() {
  if (!state.job?.sourceAnalysis || state.job.status === "draft" || state.shotPlanReplanning) return;
  const videoSubmitted = Boolean(state.job.generatedJobId) || state.job.status === "generation_started";
  if (videoSubmitted && !replacementGenerationFailed()) return;
  const model = selectedReplacementVideoModel();
  if (!model || state.job.shotPlan?.planner?.modelId === model.id) return;
  state.shotPlanReplanning = true;
  $("#startReplacementButton").disabled = true;
  notice($("#replaceTaskNotice"), `正在按 ${model.label} 的时长能力、原片切点和动作风险重新规划ShotPlan…`);
  try {
    const result = await api(`./api/product-workflows/replacement-jobs/${encodeURIComponent(state.job.id)}/shot-plan/replan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ videoModelId: model.id })
    });
    state.job = result.job;
    state.shotPlanDirty = false;
    renderJob();
    notice($("#replaceTaskNotice"), `已按 ${model.label} 重新计算：识别 ${state.job.shotPlan?.sourceShotCount || 0} 个原始镜头，执行 ${state.job.shotPlan?.videoNodeCount || 0} 个视频节点。请核对锚点覆盖与硬限制说明。`);
    window.dispatchEvent(new Event("module-task-updated"));
  } catch (error) {
    notice($("#replaceTaskNotice"), error.message, true);
  } finally {
    state.shotPlanReplanning = false;
    renderJob();
  }
}

function missingShotAnchorBatches(job = state.job) {
  const candidates = job?.shotAnchorCandidates || [];
  return (job?.shotPlan?.units || []).filter((unit) => unit.included !== false).map((unit) => {
    const requiredFrameIds = unit.requiredKeyframeIds || unit.keyframeIds || [];
    const canonicalFrameId = unit.anchorSelection?.canonicalSourceKeyframeId || "";
    const missingFrameIds = requiredFrameIds.filter((frameId) => !candidates.some((candidate) => (
      candidate.shotPlanUnitId === unit.id
      && candidate.sourceKeyframeId === frameId
      && candidate.status === "success"
    ))).sort((left, right) => Number(right === canonicalFrameId) - Number(left === canonicalFrameId));
    return { unitId: unit.id, order: unit.order, sourceKeyframeIds: missingFrameIds, canonicalFirst: missingFrameIds.includes(canonicalFrameId) };
  }).filter((batch) => batch.sourceKeyframeIds.length)
    .sort((left, right) => Number(right.canonicalFirst) - Number(left.canonicalFirst) || left.order - right.order);
}

async function generateMissingShotAnchors() {
  if (!state.job?.id || state.shotAnchorBatchBusy || state.shotAnchorBusyUnitId) return;
  const batches = missingShotAnchorBatches();
  if (!batches.length) {
    notice($("#replaceTaskNotice"), "所有已选原片关键帧都已有新图，无需重复生成；可在单张结果旁点击“重新生成此张”。", false);
    return;
  }
  const total = batches.reduce((sum, batch) => sum + batch.sourceKeyframeIds.length, 0);
  let completed = 0;
  state.shotAnchorBatchBusy = true;
  renderShotPlan(state.job);
  try {
    for (const batch of batches) {
      notice($("#replaceTaskNotice"), `正在批量生成新关键帧 ${completed + 1}–${completed + batch.sourceKeyframeIds.length}/${total}（原片镜头 ${String(batch.order).padStart(2, "0")}）…`);
      await generateShotAnchors(batch.unitId, batch.sourceKeyframeIds, { quiet: true });
      completed += batch.sourceKeyframeIds.length;
    }
    const remaining = missingShotAnchorBatches().reduce((sum, batch) => sum + batch.sourceKeyframeIds.length, 0);
    notice($("#replaceTaskNotice"), remaining
      ? `批量生成已完成，仍有 ${remaining} 张失败或缺失；可在对应位置点击“生成此张”重试。`
      : `已根据选定的原片关键帧批量生成 ${total} 张新关键帧，请逐张检查；不合适的图片可单独重新生成。`, Boolean(remaining));
  } finally {
    state.shotAnchorBatchBusy = false;
    state.shotAnchorBusyFrameId = "";
    renderShotPlan(state.job);
  }
}

async function generateShotAnchors(unitId, requestedFrameIds = [], options = {}) {
  if (!state.job?.id || state.shotAnchorBusyUnitId) return;
  if (state.shotPlanDirty) return notice($("#replaceTaskNotice"), "锚点规划已经修改，请先重新确认，再生成换品关键帧。", true);
  const card = $(`[data-shot-unit="${CSS.escape(unitId)}"]`);
  const sourceKeyframeIds = requestedFrameIds.length
    ? [...new Set(requestedFrameIds.map(String))]
    : card ? [...card.querySelectorAll(`[data-unit-keyframe="${CSS.escape(unitId)}"]:checked`)].map((input) => input.value) : [];
  if (!sourceKeyframeIds.length) return notice($("#replaceTaskNotice"), "请先为该原片镜头勾选至少一张候选关键帧。", true);
  const previousDependencyInvalidationAt = state.job?.anchorDependencyInvalidation?.changedAt || "";
  state.shotAnchorBusyUnitId = unitId;
  let regenerateInvalidatedDependents = false;
  state.shotAnchorBusyFrameId = sourceKeyframeIds.length === 1 ? sourceKeyframeIds[0] : "";
  renderShotPlan(state.job);
  if (!options.quiet) notice($("#replaceTaskNotice"), sourceKeyframeIds.length === 1
    ? "正在重新生成这一张换品关键帧；原有候选会保留，成功后可人工切换。"
    : `正在为该原片镜头生成${sourceKeyframeIds.length}张换品关键帧；成功结果会默认选用，可再人工切换候选。`);
  try {
    const result = await api(`./api/product-workflows/replacement-jobs/${encodeURIComponent(state.job.id)}/shot-plan/${encodeURIComponent(unitId)}/anchors/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sourceKeyframeIds, imageModel: selectedImageModel() })
    });
    state.job = result.job;
    sourceKeyframeIds.forEach((frameId) => {
      const newestCandidate = [...(result.job?.shotAnchorCandidates || [])].reverse().find((candidate) => (
        candidate.shotPlanUnitId === unitId && candidate.sourceKeyframeId === frameId
      ));
      if (newestCandidate) state.shotAnchorActiveCandidateIds[shotAnchorCandidateStateKey(unitId, frameId)] = newestCandidate.id;
    });
    regenerateInvalidatedDependents = !options.quiet
      && result.job?.anchorDependencyInvalidation?.changedAt !== previousDependencyInvalidationAt
      && Boolean(result.job?.anchorDependencyInvalidation?.invalidatedCandidateIds?.length);
    renderJob();
    if (!options.quiet) notice($("#replaceTaskNotice"), sourceKeyframeIds.length === 1
      ? "该关键帧已重新生成；旧版本仍保留，可在候选中选择最合适的一张。"
      : "换品关键帧已生成并默认选用；请逐项复核原图与新图。", false);
  } catch (error) {
    notice($("#replaceTaskNotice"), error.message, true);
  } finally {
    state.shotAnchorBusyUnitId = "";
    state.shotAnchorBusyFrameId = "";
    renderShotPlan(state.job);
    window.dispatchEvent(new Event("module-task-updated"));
  }
  if (regenerateInvalidatedDependents) {
    notice($("#replaceTaskNotice"), "全开库存母版已更新，正在按新母版自动重构受影响的后续关键帧。", false);
    await generateMissingShotAnchors();
  }
}

async function selectShotAnchor(unitId, candidateId) {
  try {
    const selectedCandidate = (state.job?.shotAnchorCandidates || []).find((candidate) => candidate.id === candidateId);
    const result = await api(`./api/product-workflows/replacement-jobs/${encodeURIComponent(state.job.id)}/shot-plan/${encodeURIComponent(unitId)}/anchors/select`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ candidateId })
    });
    state.job = result.job;
    if (selectedCandidate?.sourceKeyframeId) state.shotAnchorActiveCandidateIds[shotAnchorCandidateStateKey(unitId, selectedCandidate.sourceKeyframeId)] = candidateId;
    renderJob();
  } catch (error) {
    notice($("#replaceTaskNotice"), error.message, true);
  }
}

async function deleteShotAnchor(unitId, candidateId) {
  try {
    const result = await api(`./api/product-workflows/replacement-jobs/${encodeURIComponent(state.job.id)}/shot-plan/${encodeURIComponent(unitId)}/anchors/${encodeURIComponent(candidateId)}`, { method: "DELETE" });
    state.job = result.job;
    renderJob();
  } catch (error) {
    notice($("#replaceTaskNotice"), error.message, true);
  }
}

function renderJob() {
  const job = state.job;
  if (!job) return;
  state.firstFrameStrategy = job.firstFrameStrategy === "reference" ? "reference" : "generate";
  updateVoiceoverUi();
  $("#createReplacementButton").disabled = true;
  $("#referenceVideoInput").disabled = referenceVideoEditingLocked(job);
  $("#replaceProductSelect").disabled = true;
  const firstFrameEditingLocked = (Boolean(job.generatedJobId) || job.status === "generation_started") && !replacementGenerationFailed();
  $("#openReplaceAssetPicker").disabled = firstFrameEditingLocked;
  $("#openReplaceAssetPicker").title = firstFrameEditingLocked
    ? "视频任务已提交，产品参考图已经固定"
    : "可继续添加产品参考图；上一次选定的素材会保留";
  $$('input[name="imageModel"]').forEach((input) => { input.disabled = firstFrameEditingLocked; });
  $("#customFirstFrameInput").disabled = job.status === "draft" || firstFrameEditingLocked;
  $("#createReplacementButton").textContent = "当前任务已创建";
  const labels = {
    preparing: "提取参考资产",
    analyzing_video: "Qwen深度分析原片",
    awaiting_voiceover_confirmation: "等待确认新口播",
    awaiting_shot_plan_confirmation: "等待确认ShotPlan",
    awaiting_first_frame: "等待生成首帧",
    generating_first_frame: "生成新首帧",
    awaiting_first_frame_selection: "等待可用首帧",
    ready_to_generate: "可以生成视频",
    generation_started: "视频生成已开始",
    voiceover_verified: "新口播逐字复核通过",
    review_required: "需要人工复核",
    first_frame_failed: "新首帧生成失败",
    failed: "任务失败"
  };
  const frames = job.firstFrameCandidates || [];
  const requiresNewFrame = ["product", "both", "background"].includes(job.replacementMode);
  const backgroundOnly = job.replacementMode === "background";
  const activeFrame = frames.find((candidate) => candidate.status === "generating");
  const activeShotAnchor = (job.shotAnchorCandidates || []).find((candidate) => candidate.status === "generating");
  $("#replaceJobStatus").textContent = activeFrame ? candidateProgress(activeFrame) : (labels[job.status] || job.status);
  renderAnalysisWorkspace(job);
  const draftReference = job.status === "draft" && state.referenceUpload?.path ? state.referenceUpload : null;
  renderReferenceVideoPreview(
    draftReference?.path || job.referenceVideoPath,
    draftReference?.name || job.referenceVideoName,
    draftReference?.referenceAssets?.firstFramePreviewUrl || job.referenceAssets.firstFramePreviewUrl
  );
  if (job.referenceAssets.firstFramePreviewUrl) {
    $("#referenceFrameSlot").className = "rp-upstream-media";
    $("#referenceFrameSlot").innerHTML = `<img src="${job.referenceAssets.firstFramePreviewUrl}" alt="参考视频首帧" style="width:100%;aspect-ratio:9/16;object-fit:cover;border-radius:8px" />`;
  }
  const viewFrames = renderFirstFrameCandidateWorkspace(job);
  const hasReferenceFirstFrameChoice = ["product", "both"].includes(job.replacementMode)
    && viewFrames.some((candidate) => candidate.source === "reference_frame");
  $("#firstFrameSelectionHint").textContent = hasReferenceFirstFrameChoice
    ? firstFrameStrategySelectionHint()
    : viewFrames.length
      ? "最新生成成功的首帧会默认选用；点击缩略图可放大，也可手动改选或删除候选。"
    : (requiresNewFrame ? "生成成功后将自动选用最新一张首帧。" : "只换口播模式不需要生成新首帧。");
  syncFirstFramePrompt(job);
  const replacesVoiceover = ["voiceover", "both"].includes(job.replacementMode);
  const referenceAudioReady = !replacesVoiceover || Boolean(job.referenceAssets?.hasAudio);
  const effectiveVoiceoverMode = replacesVoiceover && selectedRadio("voiceoverMode") === "new" ? "new" : "old";
  const lockedVoiceoverReady = effectiveVoiceoverMode !== "new" || job.voiceoverDraft?.confirmed === true;
  const executionClassification = job.shotPlan?.executionClassification || {};
  const t4ReadinessMessage = executionClassification.type === "T4" || executionClassification.decision === "manual_review"
    ? `T4已停止自动生成：${(executionClassification.reasons || []).filter(Boolean).join("；") || "当前原片结构或连续性证据不足"}`
    : "";
  const blockingReason = (job.shotPlan?.blockingReasons || [])[0];
  const incompleteCoverage = (job.shotPlan?.coverageMatrix || []).find((row) => row.productVisible && !row.covered);
  const anchorReadinessMessage = t4ReadinessMessage
    || blockingReason?.message
    || (incompleteCoverage ? `${incompleteCoverage.sourceShotId}覆盖不足：${incompleteCoverage.reason || "请生成并选用全部必需换品锚点"}` : "");
  const upstreamReady = (!requiresNewFrame || Boolean(job.selectedFirstFrameId))
    && referenceAudioReady
    && lockedVoiceoverReady
    && Boolean(job.shotPlan?.confirmed)
    && !activeFrame
    && !activeShotAnchor
    && !state.shotAnchorBatchBusy
    && !state.shotPlanDirty
    && !state.voiceoverDecisionSaving
    && !anchorReadinessMessage;
  const previousGenerationFailed = job.status === "generation_started" && replacementGenerationFailed(job);
  const canRecompileCompletedTask = ["review_required", "voiceover_verified"].includes(job.status);
  const derivedPreGenerationReady = [
    "awaiting_voiceover_confirmation",
    "awaiting_shot_plan_confirmation",
    "awaiting_first_frame",
    "awaiting_first_frame_selection",
    "generating_first_frame",
    "first_frame_failed",
    "ready_to_generate"
  ].includes(String(job.status || ""));
  const modelCompatibility = updateReplacementVideoModelHint();
  const ready = upstreamReady && modelCompatibility.ok
    && (derivedPreGenerationReady || previousGenerationFailed || canRecompileCompletedTask);
  $("#startReplacementButton").disabled = !ready;
  $("#startReplacementButton").textContent = (previousGenerationFailed || canRecompileCompletedTask)
    ? "按当前版本重新编译并生成"
    : "确认ShotPlan并生成";
  $("#replacementVideoModel").disabled = job.status === "generation_started" && !previousGenerationFailed;
  $("#replacementVideoDuration").disabled = job.status === "generation_started" && !previousGenerationFailed;
  $("#replacementVideoClarity").disabled = job.status === "generation_started" && !previousGenerationFailed;
  $("#replacementReadyText").textContent = previousGenerationFailed
    ? `上次生成失败；可切换模型后重新生成，原画布和失败记录继续保留`
    : job.status === "generation_started"
      ? `任务已提交到 ${job.videoModelLabel || modelCompatibility.model?.label || "LibTV"}；新口播会在成片生成后自动逐字复核`
    : job.status === "voiceover_verified"
      ? "新口播成片已通过逐字复核"
      : job.status === "review_required"
        ? "成片已保留，但新口播逐字复核未通过，请人工检查"
        : activeFrame
          ? `${candidateProgress(activeFrame)}；超过15分钟会自动停止并开放重试`
        : activeShotAnchor || state.shotAnchorBatchBusy
          ? "正在生成并自动选用ShotPlan关键帧；全部完成后即可确认ShotPlan并生成视频"
          : job.shotPlan && !job.shotPlan.confirmed
            ? "请先检查原片结构并确认锚点规划"
          : effectiveVoiceoverMode === "new" && job.voiceoverDraft?.confirmed !== true
            ? "请核对ASR原片口播和新口播，确认文案后系统才会编译ShotPlan"
        : state.shotPlanDirty
          ? "锚点规划已修改，请重新确认后再生成换品关键帧和视频"
        : anchorReadinessMessage
          ? anchorReadinessMessage
        : !modelCompatibility.ok
          ? modelCompatibility.message
          : !referenceAudioReady
            ? "参考视频没有可用音轨，无法准备口播上游资产"
          : effectiveVoiceoverMode === "new"
            ? ready ? `新首帧、新口播和音色参考已就绪；将使用 ${modelCompatibility.model.label} 和内置提示词生成` : (requiresNewFrame ? "请生成或上传一张可用首帧；成功后会自动选用最新一张" : "正在准备新口播和音色参考")
            : ready
              ? `上游资产已就绪；将使用 ${modelCompatibility.model.label} 和内置${backgroundOnly ? "换背景" : "视频"}提示词生成`
              : "请生成或上传一张可用首帧；成功后会自动选用最新一张";
  if (job.error) notice($("#replaceTaskNotice"), job.error, true);
  updateWorkflowStepProgress();
}

function startPolling() {
  clearInterval(state.polling);
  const poll = async () => {
    if (!state.job || state.pollingBusy) return;
    state.pollingBusy = true;
    try {
      const result = await api(`./api/product-workflows/replacement-jobs/${state.job.id}`);
      state.job = result.job;
      renderJob();
      window.dispatchEvent(new Event("module-task-updated"));
      if (["awaiting_voiceover_confirmation", "awaiting_shot_plan_confirmation", "awaiting_first_frame_selection", "awaiting_voice_audio_generation", "ready_to_generate", "first_frame_failed", "failed"].includes(state.job.status)) {
        clearInterval(state.polling);
        $("#createReplacementButton").disabled = Boolean(state.job);
      }
    } catch (error) {
      clearInterval(state.polling);
      notice($("#replaceTaskNotice"), error.message, true);
    } finally {
      state.pollingBusy = false;
    }
  };
  poll();
  state.polling = setInterval(poll, 2500);
}

function startGeneratedJobPolling() {
  clearInterval(state.generatedPolling);
  const poll = async () => {
    if (!state.job?.generatedJobId || state.generatedPollingBusy) return;
    state.generatedPollingBusy = true;
    try {
      const generated = await api(`./api/jobs/${encodeURIComponent(state.job.generatedJobId)}`);
      state.generatedJob = generated;
      renderGeneratedJob(generated);
      if (generated.status === "failed") {
        notice($("#replacementResult"), generated.error || generated.tasks?.find((task) => task.error)?.error || "视频生成失败，请查看上方阶段说明。", true);
      } else {
        notice($("#replacementResult"), "");
      }
      window.dispatchEvent(new Event("module-task-updated"));
      if (GENERATED_JOB_TERMINAL_STATUSES.has(String(generated.status))) {
        clearInterval(state.generatedPolling);
        state.generatedPolling = null;
        renderJob();
        renderGeneratedJob(generated);
      }
    } catch (error) {
      if (state.generatedJob) renderGeneratedJob(state.generatedJob, error.message);
      else notice($("#replacementResult"), `视频仍在后台运行，状态暂时无法刷新：${error.message}`, true);
    } finally {
      state.generatedPollingBusy = false;
    }
  };
  poll();
  state.generatedPolling = setInterval(poll, 3000);
}

async function appendFirstFrame() {
  const cleanupOnly = ["product", "both"].includes(state.job?.replacementMode) && selectedFirstFrameAssetCount() === 0;
  const prompt = cleanupOnly
    ? String(state.defaults?.referenceFirstFrameCleanupPrompt || "").trim()
    : $("#replacementFirstFramePrompt").value.trim();
  if (!prompt) {
    setFirstFramePromptExpanded(true);
    $("#replacementFirstFramePrompt").focus();
    notice($("#firstFramePromptNotice"), "图片生成提示词不能为空。", true);
    updateFirstFramePromptActions();
    return;
  }
  const previousJob = state.job;
  try {
    $("#appendFirstFrameButton").disabled = true;
    const imageModel = selectedImageModel();
    const nextVersion = Math.max(
      Number(state.job.firstFrameVersionCounter || 0),
      ...(state.job.firstFrameCandidates || []).map((candidate) => Number(candidate.version || 0))
    ) + 1;
    const pendingBatchId = Date.now();
    const optimisticCandidates = Array.from({ length: FIRST_FRAME_BATCH_SIZE }, (_item, index) => ({
      id: `pending-first-frame-${pendingBatchId}-${index + 1}`,
      version: nextVersion + index,
      label: `新首帧 V${nextVersion + index}`,
      status: "generating",
      stage: "preparing_inputs",
      stageLabel: "准备输入素材",
      imageModel,
      imageModelLabel: imageModelLabel(imageModel),
      source: "platform_generated",
      batchSize: FIRST_FRAME_BATCH_SIZE,
      batchIndex: index + 1,
      createdAt: new Date().toISOString()
    }));
    state.job = {
      ...state.job,
      status: "generating_first_frame",
      firstFrameVersionCounter: nextVersion + FIRST_FRAME_BATCH_SIZE - 1,
      firstFrameCandidates: [...(state.job.firstFrameCandidates || []), ...optimisticCandidates]
    };
    state.activeFirstFrameCandidateId = optimisticCandidates[0].id;
    renderJob();
    notice($("#firstFramePromptNotice"), `已创建 ${optimisticCandidates.map((candidate) => candidate.label).join("、")}，正在使用 ${imageModelLabel(imageModel)} 逐张准备输入素材；已有候选图会继续保留。`);
    const result = await api(`./api/product-workflows/replacement-jobs/${state.job.id}/append-first-frame`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt,
        imageModel,
        productAssetIds: [...state.selectedAssetIds],
        firstFrameAvailableAssetIds: [...state.firstFrameAvailableAssetIds],
        firstFrameAssetIds: [...state.firstFrameAssetIds]
      })
    });
    state.job = result.job;
    state.firstFramePromptDirty = false;
    const latestCandidates = state.job.firstFrameCandidates?.slice(-FIRST_FRAME_BATCH_SIZE) || [];
    const latestCandidate = latestCandidates[0];
    state.activeFirstFrameCandidateId = latestCandidate?.id || state.activeFirstFrameCandidateId;
    renderJob();
    notice($("#firstFramePromptNotice"), `已创建 ${latestCandidates.map((candidate) => candidate.label).join("、")}，系统将逐张生成；每张成功后均可独立选用。`);
    startPolling();
  } catch (error) {
    state.job = previousJob;
    renderJob();
    startPolling();
    notice($("#firstFramePromptNotice"), error.message, true);
  } finally {
    updateFirstFramePromptActions();
  }
}

async function uploadCustomFirstFrame(file) {
  if (!file) return;
  if (!state.job || state.job.status === "draft") return notice($("#customFirstFrameNotice"), "请先完成参考视频分析并创建任务。", true);
  if (!/\.(png|jpe?g)$/i.test(file.name) || file.size > 10 * 1024 * 1024) {
    return notice($("#customFirstFrameNotice"), "仅支持 PNG / JPG，单张不超过10MB。", true);
  }
  const input = $("#customFirstFrameInput");
  input.disabled = true;
  try {
    notice($("#customFirstFrameNotice"), `正在上传：${file.name}`);
    const uploaded = await uploadTaskFile(file, `replacement-first-frame-${Date.now()}`, "replacement-first-frame", (progress) => {
      notice($("#customFirstFrameNotice"), `正在上传：${file.name}（${progress}%）`);
    });
    const result = await api(`./api/product-workflows/replacement-jobs/${state.job.id}/custom-first-frame`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: uploaded.path, name: file.name })
    });
    state.job = result.job;
    state.activeFirstFrameCandidateId = state.job.firstFrameCandidates?.at(-1)?.id || state.activeFirstFrameCandidateId;
    renderJob();
    notice($("#customFirstFrameNotice"), `${file.name} 已加入候选并默认选用；后续ShotPlan和视频生成将直接使用此图。`);
  } catch (error) {
    notice($("#customFirstFrameNotice"), error.message, true);
  } finally {
    input.value = "";
    input.disabled = false;
  }
}

async function selectFirstFrame(candidateId) {
  try {
    const result = await api(`./api/product-workflows/replacement-jobs/${state.job.id}/select-first-frame`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ candidateId })
    });
    state.job = result.job;
    renderJob();
    const invalidated = Number(result.job?.initialStateAnchorInvalidation?.invalidatedAnchorCount || 0);
    notice($("#firstFramePromptNotice"), invalidated
      ? `已选用为新视频0.0秒起始状态图；${invalidated}张依赖旧首帧的ShotPlan关键帧已失效，请重新生成。`
      : "已选用为新视频0.0秒起始状态图；后续ShotPlan关键帧将继承其产品数量、摆放、方向和空间关系。");
  } catch (error) {
    notice($("#replacementResult"), error.message, true);
  }
}

async function useReferenceFirstFrame() {
  if (!window.confirm("确认沿用原片首帧作为新视频0.0秒起始状态图？它不会替代ShotPlan换品关键帧，目标产品身份仍以产品参考图为准。")) return;
  state.firstFrameStrategy = "reference";
  state.activeFirstFrameCandidateId = REFERENCE_FIRST_FRAME_CANDIDATE_ID;
  if (!state.job || state.job.status === "draft") {
    renderFirstFrameCandidateWorkspace(state.job);
    updateFirstFramePromptActions();
    saveReplacementDraft();
    return;
  }
  try {
    const result = await api(`./api/product-workflows/replacement-jobs/${encodeURIComponent(state.job.id)}/use-reference-first-frame`, {
      method: "POST"
    });
    state.job = result.job;
    renderJob();
    const invalidated = Number(result.job?.initialStateAnchorInvalidation?.invalidatedAnchorCount || 0);
    notice($("#firstFramePromptNotice"), invalidated
      ? `原片首帧已作为新视频0.0秒起始状态图；${invalidated}张依赖旧首帧的ShotPlan关键帧已失效。`
      : "原片首帧已作为新视频0.0秒起始状态图；ShotPlan关键帧仍独立重构，右侧产品参考图继续提供目标产品真值。");
  } catch (error) {
    notice($("#firstFramePromptNotice"), error.message, true);
  }
}

function generateFirstFrameFromReferenceCard() {
  state.firstFrameStrategy = "generate";
  state.activeFirstFrameCandidateId = REFERENCE_FIRST_FRAME_CANDIDATE_ID;
  renderFirstFrameCandidateWorkspace(state.job);
  updateFirstFramePromptActions();
  saveReplacementDraft();
  if (!state.job || state.job.status === "draft") {
    return;
  }
  appendFirstFrame();
}

function closeFirstFramePreview() {
  state.previewedFirstFrameId = "";
  $("#firstFramePreviewDialog").close();
}

function openFirstFramePreview(candidateId) {
  const candidate = firstFrameCandidatesForView(state.job).find((item) => item.id === candidateId && item.status === "success");
  if (!candidate) return;
  state.previewedFirstFrameId = candidate.id;
  $("#firstFramePreviewTitle").textContent = candidate.label || "候选图片原图";
  $("#firstFramePreviewImage").src = candidate.previewUrl;
  $("#firstFramePreviewImage").alt = `${candidate.label || "候选图片"}原图`;
  const selectButton = $("#selectFirstFramePreviewButton");
  const selected = state.job?.selectedFirstFrameId === candidate.id
    || ((!state.job || state.job.status === "draft") && candidate.source === "reference_frame" && state.firstFrameStrategy === "reference");
  selectButton.textContent = selected ? "已选用此图" : candidate.source === "reference_frame" ? "沿用原片首帧" : "选用此图";
  selectButton.disabled = selected;
  $("#firstFramePreviewDialog").showModal();
}

function wireFirstFrameCandidateDecisions() {
  $$('[data-first-frame-preview]').forEach((button) => button.addEventListener("click", () => {
    openFirstFramePreview(button.dataset.firstFramePreview);
  }));
  $$('[data-first-frame-select]').forEach((button) => button.addEventListener("click", () => {
    selectFirstFrame(button.dataset.firstFrameSelect);
  }));
  $$('[data-use-reference-first-frame]').forEach((button) => button.addEventListener("click", useReferenceFirstFrame));
  $$('[data-generate-first-frame]').forEach((button) => button.addEventListener("click", generateFirstFrameFromReferenceCard));
  $$('[data-first-frame-delete]').forEach((button) => button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const candidateId = button.dataset.firstFrameDelete;
    const candidate = (state.job?.firstFrameCandidates || []).find((item) => item.id === candidateId);
    const selectedNotice = state.job?.selectedFirstFrameId === candidateId ? "\n该图片当前已被选用，删除后系统会自动改用剩余候选中最新的一张。" : "";
    if (!window.confirm(`确定删除“${candidate?.label || "这张候选图片"}”吗？${selectedNotice}\n删除后无法恢复。`)) return;
    button.disabled = true;
    button.textContent = "删除中…";
    deleteFirstFrameCandidate(candidateId);
  }));
}

async function deleteFirstFrameCandidate(candidateId) {
  try {
    const result = await api(`./api/product-workflows/replacement-jobs/${state.job.id}/first-frame-candidates/${encodeURIComponent(candidateId)}`, {
      method: "DELETE"
    });
    state.job = result.job;
    renderJob();
    const selected = (state.job?.firstFrameCandidates || []).find((item) => item.id === state.job?.selectedFirstFrameId);
    notice($("#firstFramePromptNotice"), selected
      ? `候选图片已删除，现已默认选用剩余候选中最新的“${selected.label || "新首帧"}”。`
      : (result.message || "候选图片已删除；当前没有可用的新首帧，请重新生成。"));
  } catch (error) {
    notice($("#firstFramePromptNotice"), error.message, true);
  }
}

async function startReplacement() {
  try {
    await persistVoiceoverDecision({ quiet: true });
    const workstation = window.WorkbenchWorkstation.identity();
    const modelCompatibility = replacementVideoModelCompatibility();
    if (!modelCompatibility.ok) return notice($("#replacementResult"), modelCompatibility.message, true);
    $("#startReplacementButton").disabled = true;
    const result = await api(`./api/product-workflows/replacement-jobs/${state.job.id}/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workstationId: workstation.id,
        workstationLabel: workstation.label,
        videoModelId: modelCompatibility.model.id,
        duration: Number($("#replacementVideoDuration").value),
        clarity: $("#replacementVideoClarity").value
      })
    });
    state.job.status = "generation_started";
    state.job.generatedJobId = result.jobId;
    state.job.videoModelId = result.videoModelId || modelCompatibility.model.id;
    state.job.videoModelLabel = result.videoModelLabel || modelCompatibility.model.label;
    state.job.videoDuration = Number(result.duration || $("#replacementVideoDuration").value);
    state.job.videoClarity = result.clarity || $("#replacementVideoClarity").value;
    state.job.videoClarityLabel = result.clarityLabel || $("#replacementVideoClarity").selectedOptions?.[0]?.textContent || "";
    state.generatedJob = null;
    renderGeneratedJob({ id: result.jobId, status: "queued", config: { videoCount: result.segmentCount } });
    const audioMessage = ["seedance_generated_new_voiceover", "model_generated_new_voiceover"].includes(result.audioPolicy)
      ? "每段都会使用原片音色参考生成锁定的新口播，成片后自动进行 ASR 逐字复核。"
      : result.audioPolicy === "reference_audio_original_voiceover"
        ? "每段都会把从唯一参考视频提取的原音轨连接到 LibTV，并沿用其中的旧口播。"
        : "本任务只使用用户上传的唯一参考视频，不提取或连接额外音频。";
    notice($("#replacementResult"), `已使用 ${state.job.videoModelLabel}（${state.job.videoDuration}秒，${state.job.videoClarityLabel}）创建一键换品视频任务 ${result.jobId}，共 ${result.segmentCount} 个视频节点。${audioMessage}`);
    startGeneratedJobPolling();
    window.dispatchEvent(new Event("module-task-updated"));
  } catch (error) {
    notice($("#replacementResult"), error.message, true);
  } finally {
    renderJob();
  }
}

async function init() {
  setReplacementRulesHidden(localStorage.getItem(REPLACEMENT_RULES_HIDDEN_KEY) === "1", { persist: false });
  $("#hideReplacementRulesButton").addEventListener("click", () => setReplacementRulesHidden(true));
  $("#showReplacementRulesButton").addEventListener("click", () => setReplacementRulesHidden(false));
  try {
    state.defaults = await api("./api/product-workflows/defaults");
    renderDefaults();
    await loadAssets();
    await restoreReplacementTask();
    if (replacementEntryParams.has("new") && !state.job) {
      const requestedMode = replacementEntryParams.get("mode");
      if (["product", "background"].includes(requestedMode)) {
        const modeInput = [...document.querySelectorAll('input[name="replacementMode"]')].find((item) => item.value === requestedMode);
        if (modeInput) modeInput.checked = true;
        updateVoiceoverUi();
        notice($("#replaceTaskNotice"), requestedMode === "background"
          ? "已进入“视频背景替换”：只改变背景环境，人物、产品、动作、口播和镜头保持不变。"
          : "已进入“视频产品替换”：沿用原片结构，替换为已确认的目标产品资产。", false);
      }
    }
    renderAnalysisWorkspace(state.job);
  } catch (error) {
    notice($("#replaceTaskNotice"), error.message, true);
  }
  $("#referenceVideoInput").addEventListener("change", async (event) => {
    try {
      await uploadReference(event.target.files[0]);
    } catch (error) {
      notice($("#referenceUploadStatus"), error.message, true);
    } finally {
      event.target.value = "";
    }
  });
  $("#replaceProductSelect").addEventListener("change", async () => {
    syncReplaceProductSelectDisplay();
    state.selectedAssetIds.clear();
    state.firstFrameAvailableAssetIds = [];
    state.firstFrameAssetIds.clear();
    state.pickerSelectedIds = [];
    clearTemporaryProducts();
    updateProductHint();
    await loadAssets();
    saveReplacementDraft();
  });
  $$('input[name="voiceoverMode"]').forEach((input) => input.addEventListener("change", async () => {
    if (selectedRadio("voiceoverMode") === "new" && !$("#lockedScript").value) {
      $("#lockedScript").value = state.job?.voiceoverDraft?.text || state.job?.lockedScript?.lockedScript || "";
    }
    if (state.job && state.job.status !== "draft") state.voiceoverDecisionDirty = true;
    updateVoiceoverUi();
    saveReplacementDraft();
    if (state.job && state.job.status !== "draft" && (selectedRadio("voiceoverMode") === "old" || $("#lockedScript").value.trim())) {
      try {
        await persistVoiceoverDecision();
      } catch (error) {
        notice($("#replaceTaskNotice"), error.message, true);
      }
    }
  }));
  $$('input[name="replacementMode"]').forEach((input) => input.addEventListener("change", () => {
    if (!state.job || state.job.status === "draft") {
      const defaultMode = ["voiceover", "both"].includes(selectedRadio("replacementMode")) ? "new" : "old";
      const target = [...document.querySelectorAll('input[name="voiceoverMode"]')].find((item) => item.value === defaultMode);
      if (target) target.checked = true;
    }
    updateVoiceoverUi();
  }));
  $$('input[name="generationMode"]').forEach((input) => input.addEventListener("change", async () => {
    renderAnalysisWorkspace(state.job);
    saveReplacementDraft();
    if (state.job?.shotPlan && state.job.status !== "draft") await saveShotPlan({ confirm: selectedRadio("generationMode") === "smart" });
  }));
  $("#toggleSourceAnalysisButton").addEventListener("click", () => setSourceAnalysisExpanded(!state.sourceAnalysisExpanded));
  $("#confirmShotPlanButton").addEventListener("click", () => saveShotPlan({ confirm: true, generateAnchors: true }));
  $("#shotPlanList").addEventListener("change", (event) => {
    const card = event.target.closest("[data-shot-unit]");
    if (!card || !event.target.matches("[data-unit-included], [data-unit-duration], [data-unit-policy], [data-unit-keyframe], [data-unit-merge]")) return;
    if (event.target.matches("[data-unit-merge]")) {
      const sharing = event.target.checked;
      const unit = state.job?.shotPlan?.units?.find((item) => item.id === card.dataset.shotUnit);
      const restoredFrameIds = new Set(unit?.recommendedKeyframeIds || unit?.minimumSufficientKeyframeIds || unit?.anchorSelection?.requiredGeneratedFrameIds || []);
      card.querySelectorAll("[data-unit-keyframe]").forEach((input) => {
        input.checked = sharing ? false : restoredFrameIds.has(input.value);
        input.disabled = sharing;
      });
      const count = card.querySelectorAll("[data-unit-keyframe]:checked").length;
      const counter = card.querySelector(".rp-keyframe-selection-count");
      if (counter) counter.textContent = `${unit?.anchorSelection?.stateAnchorCount || count}个状态 · 需生成${count}张`;
      notice($("#replaceTaskNotice"), sharing
        ? "系统将建立连续生成组，并重新计算动作时间轴、人物连续性、产品状态链、资产连接和质检。"
        : "系统将取消连续生成组，并从原始sourceShot恢复独立规划与关键帧需求。");
    }
    if (event.target.matches("[data-unit-keyframe]") && event.target.checked) {
      const assetBudget = state.job?.shotPlan?.assetBudget || {};
      const maximumAnchors = Number(assetBudget.anchorMaximum ?? Math.max(0, Number(assetBudget.maximum || 9) - Number(assetBudget.productTruth || 0)));
      const selectedAnchors = $$("[data-unit-keyframe]:checked").length;
      if (selectedAnchors > maximumAnchors) {
        event.target.checked = false;
        notice($("#replaceTaskNotice"), `当前模型单次最多使用${Number(assetBudget.imageMaximum || assetBudget.maximum || 9)}张图片；已选产品白底图${Number(assetBudget.productTruth || 0)}张，因此换品关键帧最多选择${maximumAnchors}张。请减少产品图或取消其它关键帧。`, true);
        return;
      }
    }
    state.shotPlanDirty = true;
    if (event.target.matches("[data-unit-included]")) card.classList.toggle("is-excluded", !event.target.checked);
    if (event.target.matches("[data-unit-keyframe]")) {
      const count = card.querySelectorAll("[data-unit-keyframe]:checked").length;
      const counter = card.querySelector(".rp-keyframe-selection-count");
      const unit = state.job?.shotPlan?.units?.find((item) => item.id === card.dataset.shotUnit);
      if (counter) counter.textContent = `${unit?.anchorSelection?.stateAnchorCount || count}个状态 · 需生成${count}张`;
      const tabButton = [...$("#shotPlanList").querySelectorAll("[data-shot-tab]")]
        .find((button) => button.dataset.shotTab === card.dataset.shotUnit);
      const tabProgress = tabButton?.querySelector(".rp-shot-tab-progress");
      if (tabProgress) tabProgress.textContent = `${count}张待生成`;
    }
    $("#shotPlanStatus").textContent = "待确认调整";
    $("#shotPlanNotice").textContent = "选择完成后确认并生成。";
    $("#confirmShotPlanButton").textContent = `确认并生成${$$('[data-unit-keyframe]:checked').length}张`;
    $$('[data-generate-shot-anchors]').forEach((button) => { button.disabled = true; });
    $("#startReplacementButton").disabled = true;
  });
  $("#shotPlanList").addEventListener("click", (event) => {
    const adjustButton = event.target.closest("[data-toggle-shot-adjust]");
    if (adjustButton) {
      if (state.shotPlanDirty) return notice($("#replaceTaskNotice"), "请先确认当前调整，再退出编辑。", true);
      state.shotPlanAdjusting = !state.shotPlanAdjusting;
      return renderShotPlan(state.job);
    }
    const tabButton = event.target.closest("[data-shot-tab]");
    if (tabButton) return activateShotPlanTab(tabButton.dataset.shotTab, { focus: true });
    const candidateTab = event.target.closest("[data-anchor-candidate-tab]");
    if (candidateTab) return activateShotAnchorCandidate(candidateTab.dataset.anchorUnit, candidateTab.dataset.anchorFrameId, candidateTab.dataset.anchorCandidateTab, { focus: true });
    const regenerateButton = event.target.closest("[data-regenerate-keyframe]");
    if (regenerateButton) return generateShotAnchors(regenerateButton.dataset.anchorUnit, [regenerateButton.dataset.regenerateKeyframe]);
    const generateButton = event.target.closest("[data-generate-shot-anchors]");
    if (generateButton) return generateShotAnchors(generateButton.dataset.generateShotAnchors);
    const selectButton = event.target.closest("[data-anchor-select]");
    if (selectButton) return selectShotAnchor(selectButton.dataset.anchorUnit, selectButton.dataset.anchorSelect);
    const deleteButton = event.target.closest("[data-anchor-delete]");
    if (deleteButton) return deleteShotAnchor(deleteButton.dataset.anchorUnit, deleteButton.dataset.anchorDelete);
  });
  $("#shotPlanList").addEventListener("keydown", (event) => {
    const candidateTab = event.target.closest("[data-anchor-candidate-tab]");
    if (candidateTab && ["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
      const tabList = candidateTab.closest("[role=tablist]");
      const tabs = [...tabList.querySelectorAll("[data-anchor-candidate-tab]")];
      const currentIndex = tabs.indexOf(candidateTab);
      const nextIndex = event.key === "Home"
        ? 0
        : event.key === "End"
          ? tabs.length - 1
          : (currentIndex + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
      event.preventDefault();
      return activateShotAnchorCandidate(tabs[nextIndex].dataset.anchorUnit, tabs[nextIndex].dataset.anchorFrameId, tabs[nextIndex].dataset.anchorCandidateTab, { focus: true });
    }
    const activeTab = event.target.closest("[data-shot-tab]");
    if (!activeTab || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const tabs = [...$("#shotPlanList").querySelectorAll("[data-shot-tab]")];
    const currentIndex = tabs.indexOf(activeTab);
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? tabs.length - 1
        : (currentIndex + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    event.preventDefault();
    activateShotPlanTab(tabs[nextIndex].dataset.shotTab, { focus: true });
  });
  $("#replacementForm").addEventListener("input", saveReplacementDraft);
  $("#replacementForm").addEventListener("change", saveReplacementDraft);
  $("#lockedScript").addEventListener("input", () => {
    if (state.job && state.job.status !== "draft") state.voiceoverDecisionDirty = true;
    updateVoiceoverCounts();
    if (state.job?.voiceoverDraft?.confirmed === true) {
      $("#confirmVoiceoverButton").textContent = "文案已修改，请重新确认";
    }
  });
  $("#lockedScript").addEventListener("blur", async () => {
    if (!state.voiceoverDecisionDirty || selectedRadio("voiceoverMode") !== "new" || !$("#lockedScript").value.trim()) return;
    try {
      await persistVoiceoverDecision();
    } catch (error) {
      notice($("#replaceTaskNotice"), error.message, true);
    }
  });
  $("#sourceTranscript").addEventListener("input", updateVoiceoverCounts);
  $("#retrySourceTranscriptButton").addEventListener("click", retrySourceTranscript);
  $("#saveSourceTranscriptButton").addEventListener("click", saveSourceTranscriptCorrection);
  $("#confirmVoiceoverButton").addEventListener("click", confirmVoiceoverAndCompileShotPlan);
  $("#restoreVoiceoverSuggestionButton").addEventListener("click", () => {
    const suggestion = String(state.job?.voiceoverDraft?.proposedText || "");
    if (!suggestion) return;
    $("#lockedScript").value = suggestion;
    state.voiceoverDecisionDirty = true;
    updateVoiceoverCounts();
    $("#confirmVoiceoverButton").textContent = "文案已修改，请重新确认";
  });
  $$('input[name="imageModel"]').forEach((input) => input.addEventListener("change", updateFirstFramePromptActions));
  $("#replacementVideoModel").addEventListener("change", async () => {
    renderReplacementVideoSettings({ syncReference: !state.durationUserModified });
    updateReplacementVideoModelHint();
    if (state.job) renderJob();
    saveReplacementDraft();
    await replanShotPlanForSelectedModel();
  });
  $("#replacementForm").addEventListener("submit", createJob);
  $("#replacementFirstFramePrompt").addEventListener("input", () => {
    state.firstFramePromptDirty = true;
    notice($("#firstFramePromptNotice"), "");
    updateFirstFramePromptActions();
  });
  $("#resetFirstFramePromptButton").addEventListener("click", resetFirstFramePrompt);
  $("#appendFirstFrameButton").addEventListener("click", appendFirstFrame);
  $("#toggleFirstFramePromptButton").addEventListener("click", () => {
    setFirstFramePromptExpanded($("#firstFramePromptPanel").hidden);
  });
  $("#firstFrameTabButtons").addEventListener("click", (event) => {
    const tab = event.target.closest("[data-first-frame-tab]");
    if (tab) activateFirstFrameCandidateTab(tab.dataset.firstFrameTab);
  });
  $("#firstFrameTabButtons").addEventListener("keydown", (event) => {
    const activeTab = event.target.closest("[data-first-frame-tab]");
    if (!activeTab || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const tabs = $$('[data-first-frame-tab]');
    const currentIndex = tabs.indexOf(activeTab);
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? tabs.length - 1
        : (currentIndex + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    event.preventDefault();
    activateFirstFrameCandidateTab(tabs[nextIndex].dataset.firstFrameTab, { focus: true });
  });
  $("#customFirstFrameInput").addEventListener("change", (event) => uploadCustomFirstFrame(event.target.files[0]));
  $("#startReplacementButton").addEventListener("click", startReplacement);
  $("#openReplaceAssetPicker").addEventListener("click", () => openReplaceAssetPicker().catch((error) => notice($("#temporaryProductStatus"), error.message, true)));
  $("#replaceProductUploadInput").addEventListener("change", (event) => uploadReplacementProductAssets(event.target.files).catch((error) => notice($("#replacePickerUploadStatus"), error.message, true)));
  $("#closeReplacePickerButton").addEventListener("click", () => $("#replaceAssetPickerDialog").close());
  $("#cancelReplacePickerButton").addEventListener("click", () => $("#replaceAssetPickerDialog").close());
  $("#confirmReplacePickerButton").addEventListener("click", confirmReplaceAssetPicker);
  $("#replaceAssetPickerDialog").addEventListener("click", (event) => {
    const dialog = event.currentTarget;
    const bounds = dialog.getBoundingClientRect();
    const outside = event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom;
    if (outside) dialog.close();
  });
  $("#closeReplaceAssetPreviewButton").addEventListener("click", () => $("#replaceAssetPreviewDialog").close());
  $("#replaceAssetPreviewDialog").addEventListener("close", () => $("#replaceAssetPreviewImage").removeAttribute("src"));
  $("#closeFirstFramePreviewButton").addEventListener("click", closeFirstFramePreview);
  $("#cancelFirstFramePreviewButton").addEventListener("click", closeFirstFramePreview);
  $("#selectFirstFramePreviewButton").addEventListener("click", async () => {
    const candidateId = state.previewedFirstFrameId;
    if (!candidateId) return;
    const candidate = firstFrameCandidatesForView(state.job).find((item) => item.id === candidateId);
    closeFirstFramePreview();
    if (candidate?.source === "reference_frame") await useReferenceFirstFrame();
    else await selectFirstFrame(candidateId);
  });
  $("#replacementVideoDuration").addEventListener("change", () => {
    state.durationUserModified = true;
    updateReplacementVideoModelHint();
    if (state.job) renderJob();
    saveReplacementDraft();
  });
  $("#replacementVideoClarity").addEventListener("change", () => {
    updateReplacementVideoModelHint();
    if (state.job) renderJob();
    saveReplacementDraft();
  });
  $("#firstFramePreviewDialog").addEventListener("close", () => {
    state.previewedFirstFrameId = "";
    $("#firstFramePreviewImage").removeAttribute("src");
  });
  updateVoiceoverUi();
  window.setInterval(saveReplacementDraft, 1500);
  window.addEventListener("beforeunload", saveReplacementDraft);
}

init();
