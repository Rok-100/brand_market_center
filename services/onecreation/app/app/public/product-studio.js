"use strict";

const state = {
  defaults: null,
  reference: null,
  promptConfirmed: false,
  candidateJob: null,
  selectedCandidates: {},
  pendingCandidateSelection: {},
  lanes: {},
  activeAngleId: "",
  draggedFragment: null,
  assetsByType: { image: [], video: [] },
  activeAssetTab: "image",
  assetUploadQueue: [],
  assetUploadBusy: false,
  visualFingerprints: new Map(),
  visualSimilarityByAssetId: new Map(),
  visualSimilarityRun: 0,
  picker: null,
  polling: null,
  laneRenderPending: false,
  skuProducts: [],
  managingSkuId: "",
  creatingSku: false,
  qwenQuotaExhausted: false,
  videoModelsByDuration: new Map(),
  videoModelAvailabilityRequests: new Map(),
  dailyCanvas: null,
  dailyCanvasError: "",
  activeProductChannel: "standard",
  confirmedProductId: "",
  customCreative: {
    scene: null,
    productAssetId: "",
    productAssetIds: [],
    fragmentAssetIds: [],
    prompt: "",
    duration: 4,
    durationManuallyEdited: false,
    durationAutoFilled: false,
    referenceVideoDuration: 0,
    clarity: "720p",
    jobId: "",
    jobStatus: "",
    status: "",
    error: "",
    refreshWarning: "",
    pollFailureCount: 0,
    pollInFlight: false,
    outputUrl: "",
    downloadUrl: "",
    downloadRecoveryAttempted: false,
    videoModelId: "seedance-2-vip",
    videoGenerationMode: "mixed2video",
    videoGenerationModeLabel: "全能参考",
    model: "",
    canvasUrl: "",
    canvasName: "",
    polling: null
  }
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const PROXY_SAFE_UPLOAD_CHUNK_BYTES = 768 * 1024;
const CUSTOM_CREATIVE_ANGLE = "custom-creative";
const MIN_FRAGMENT_SELECTION = 2;
const MAX_FRAGMENT_SELECTION = 12;
const MAX_PRODUCT_SELECTION = 9;
const MAX_VIDEO_UPLOAD_SELECTION = 12;
const WORKSTATION_STORAGE_KEY = "ai-product-workbench-workstation-v1";
const PRODUCT_TASK_STORAGE_KEY = "ai-product-studio-task-state-v1";
const PRODUCT_ACTIVE_TASK_KEY = "ai-product-studio-current-task-v1";
const PRODUCT_DRAFT_KEY = "ai-product-studio-task-draft-v1";
const PRODUCT_RULES_HIDDEN_KEY = "ai-product-studio-rules-hidden-v1";
const PRODUCT_CHANNEL_KEY = "ai-product-studio-active-channel-v1";
const PRODUCT_CHANNEL_SWITCH_NOTICE_KEY = "ai-product-studio-channel-switch-notice-v1";
const PRODUCT_CHANNELS = Object.freeze(["standard", "semi-auto", "creative-instruction"]);
const PRODUCT_CHANNEL_TASK_LABELS = Object.freeze({
  standard: "三路制作",
  "semi-auto": "备用半自动通道",
  "creative-instruction": "备用创意通道"
});
const PRODUCT_CHANNEL_COPY = Object.freeze({
  standard: Object.freeze({
    title: "一张参考图，生成三条真实产展。",
    description: "先反推并确认空场景提示词，再生成平拍、俯拍、特写三个无产品场景。每个角度选择可选的同一 SKU 白底产品图和真实碎镜头。"
  }),
  "semi-auto": Object.freeze({
    title: "自定义场景图，生成创意产品视频。",
    description: "已有明确后景或产品摆放要求时，直接组合自定义场景图、同一 SKU 产品图与真实碎镜头进行生成。"
  }),
  "creative-instruction": Object.freeze({
    title: "一句话自然指令，生成创意产品视频。",
    description: "选择商业分类和同一 SKU 产品白底图，用一句自然语言描述场景、动作与镜头；场景图可选。"
  })
});
let productTaskPersistenceSuspended = false;
let productDraftSyncTimer = null;
let productDraftSyncPending = null;
let productDraftSyncInFlight = false;
let productDraftSyncLast = "";
let productChannelSwitchInFlight = false;

function normalizedProductChannel(channel) {
  const value = String(channel || "").trim();
  return PRODUCT_CHANNELS.includes(value) ? value : "standard";
}

function currentProductTaskChannel() {
  return normalizedProductChannel(
    state.candidateJob?.taskChannel
    || state.candidateJob?.draftData?.activeProductChannel
    || state.activeProductChannel
  );
}

function productChannelTaskLabel(channel) {
  return PRODUCT_CHANNEL_TASK_LABELS[normalizedProductChannel(channel)] || PRODUCT_CHANNEL_TASK_LABELS.standard;
}

function setActiveProductChannel(channel, { persist = true, focus = false } = {}) {
  let next = normalizedProductChannel(channel);
  let tab = $(`[data-product-channel-tab="${next}"]`);
  if (!tab || tab.hidden) {
    next = "standard";
    tab = $(`[data-product-channel-tab="${next}"]`);
  }
  state.activeProductChannel = next;
  $$('[data-product-channel-tab]').forEach((button) => {
    const selected = button.dataset.productChannelTab === next;
    button.classList.toggle("active", selected);
    button.setAttribute("aria-selected", String(selected));
    button.tabIndex = selected ? 0 : -1;
  });
  $$('[data-product-channel-panel]').forEach((panel) => {
    panel.hidden = panel.dataset.productChannelPanel !== next;
  });
  const copy = PRODUCT_CHANNEL_COPY[next] || PRODUCT_CHANNEL_COPY.standard;
  if ($("#productStudioHeroTitle")) $("#productStudioHeroTitle").textContent = copy.title;
  if ($("#productStudioHeroDescription")) $("#productStudioHeroDescription").textContent = copy.description;
  if (persist) localStorage.setItem(PRODUCT_CHANNEL_KEY, next);
  if (focus) tab?.focus();
}

function setProductChannelAvailability(channel, available) {
  const value = String(channel || "").trim();
  if (!PRODUCT_CHANNELS.includes(value)) return;
  const tab = $(`[data-product-channel-tab="${value}"]`);
  if (!tab) return;
  tab.hidden = !available;
  if (!available && state.activeProductChannel === value) setActiveProductChannel("standard");
}

function setProductChannelTabsBusy(busy) {
  const tabList = $(".ps-channel-tabs");
  if (tabList) tabList.setAttribute("aria-busy", String(Boolean(busy)));
  $$('[data-product-channel-tab]').forEach((button) => { button.disabled = Boolean(busy); });
}

async function activateProductChannel(channel, { focus = false } = {}) {
  const requestedChannel = normalizedProductChannel(channel);
  const previousChannel = state.activeProductChannel;
  const taskChannel = currentProductTaskChannel();
  const shouldCreateTargetTask = Boolean(
    state.candidateJob?.id
    && taskChannel !== requestedChannel
    && currentTaskHasStartedGeneration()
  );

  if (!shouldCreateTargetTask) {
    setActiveProductChannel(requestedChannel, { focus });
    if (state.candidateJob?.status === "draft" && taskChannel !== requestedChannel) {
      state.candidateJob.taskChannel = requestedChannel;
    }
    saveProductTaskState();
    return;
  }
  if (productChannelSwitchInFlight) return;

  productChannelSwitchInFlight = true;
  saveProductTaskState();
  setActiveProductChannel(requestedChannel, { focus });
  setProductChannelTabsBusy(true);
  notice($("#taskStatus"), `正在为“${productChannelTaskLabel(requestedChannel)}”创建独立任务…`);
  try {
    const result = await api("./api/product-workflows/image-candidates/drafts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ forceNew: true, taskChannel: requestedChannel })
    });
    if (!result.job?.id) throw new Error("服务端没有返回新任务编号");
    window.dispatchEvent(new CustomEvent("module-task-new", {
      detail: { module: "product-studio.html", id: result.job.id, reason: "channel-switch" }
    }));
    localStorage.setItem(PRODUCT_CHANNEL_KEY, requestedChannel);
    localStorage.setItem(PRODUCT_ACTIVE_TASK_KEY, result.job.id);
    localStorage.setItem(PRODUCT_CHANNEL_SWITCH_NOTICE_KEY, JSON.stringify({
      taskId: result.job.id,
      channel: requestedChannel,
      createdAt: new Date().toISOString()
    }));
    const url = new URL(window.location.href);
    url.searchParams.set("task", result.job.id);
    window.location.href = `${url.pathname}${url.search}${url.hash}`;
  } catch (error) {
    productChannelSwitchInFlight = false;
    setProductChannelTabsBusy(false);
    setActiveProductChannel(previousChannel);
    notice($("#taskStatus"), `切换通道失败：${error.message}`, true);
  }
}

function bindProductChannelTabs() {
  const tabs = $$('[data-product-channel-tab]');
  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      activateProductChannel(tab.dataset.productChannelTab);
    });
    tab.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const available = tabs.filter((item) => !item.hidden);
      const currentIndex = Math.max(0, available.indexOf(tab));
      const nextIndex = event.key === "Home" ? 0
        : event.key === "End" ? available.length - 1
          : event.key === "ArrowRight" ? (currentIndex + 1) % available.length
            : (currentIndex - 1 + available.length) % available.length;
      activateProductChannel(available[nextIndex]?.dataset.productChannelTab, { focus: true });
    });
  });
}

window.addEventListener("ai-product-channel-availability", (event) => {
  if (!event?.detail?.channel) return;
  setProductChannelAvailability(event.detail.channel, Boolean(event.detail.available));
});

function prepareNewProductTask(event) {
  if (event?.detail?.module !== "product-studio.html") return;
  productTaskPersistenceSuspended = true;
  clearTimeout(productDraftSyncTimer);
  productDraftSyncPending = null;
  localStorage.removeItem(PRODUCT_ACTIVE_TASK_KEY);
  localStorage.removeItem(PRODUCT_DRAFT_KEY);
  localStorage.removeItem(PRODUCT_CHANNEL_SWITCH_NOTICE_KEY);
}

function setProductRulesHidden(hidden, { persist = true } = {}) {
  const workspace = $("#productRulesWorkspace");
  const panel = $("#productRulesPanel");
  const showButton = $("#showProductRulesButton");
  if (!workspace || !panel || !showButton) return;
  const shouldHide = Boolean(hidden);
  workspace.classList.toggle("rules-hidden", shouldHide);
  panel.hidden = shouldHide;
  showButton.hidden = !shouldHide;
  showButton.setAttribute("aria-expanded", String(!shouldHide));
  if (persist) localStorage.setItem(PRODUCT_RULES_HIDDEN_KEY, shouldHide ? "1" : "0");
}

window.addEventListener("module-task-new", prepareNewProductTask);

function forgetDeletedProductTask(event) {
  if (event?.detail?.module !== "product-studio.html") return;
  const deletedId = String(event.detail.id || "");
  if (!deletedId) return;
  const stored = readProductTaskState();
  if (stored.jobs) delete stored.jobs[deletedId];
  localStorage.setItem(PRODUCT_TASK_STORAGE_KEY, JSON.stringify(stored));
  if (state.candidateJob?.id === deletedId || localStorage.getItem(PRODUCT_ACTIVE_TASK_KEY) === deletedId) {
    productTaskPersistenceSuspended = true;
    localStorage.removeItem(PRODUCT_ACTIVE_TASK_KEY);
    localStorage.removeItem(PRODUCT_DRAFT_KEY);
  }
}

window.addEventListener("module-task-deleted", forgetDeletedProductTask);

function readProductTaskState() {
  try { return JSON.parse(localStorage.getItem(PRODUCT_TASK_STORAGE_KEY) || "null") || { jobs: {} }; }
  catch { return { jobs: {} }; }
}

function serializableLane(lane = {}) {
  const { polling, pollInFlight, ...saved } = lane;
  return { ...saved, polling: null, pollInFlight: false };
}

function reconcileProductTaskSnapshot(serverDraft = {}, localDraft = {}, generatedVideos = []) {
  const snapshot = { ...(serverDraft || {}), ...(localDraft || {}) };
  const videoResults = Array.isArray(generatedVideos) ? generatedVideos : [];
  if (!snapshot.activeProductChannel) {
    if (videoResults.some((item) => item?.angle === "creativeInstruction")) snapshot.activeProductChannel = "creative-instruction";
    else if (videoResults.some((item) => item?.angle === "customCreative")) snapshot.activeProductChannel = "semi-auto";
  }
  const serverCustom = serverDraft?.customCreative || {};
  const localCustom = localDraft?.customCreative || {};
  const generatedCustom = videoResults.find((item) => item?.angle === "customCreative");
  const sameServerJob = serverCustom.jobId && (!localCustom.jobId || localCustom.jobId === serverCustom.jobId);
  const serverTerminal = ["success", "partial", "failed"].includes(String(serverCustom.jobStatus || ""));
  snapshot.customCreative = { ...serverCustom, ...localCustom };
  if (sameServerJob && serverTerminal) Object.assign(snapshot.customCreative, serverCustom);
  if (generatedCustom?.jobId) {
    Object.assign(snapshot.customCreative, {
      jobId: generatedCustom.jobId,
      jobStatus: generatedCustom.status || (generatedCustom.hasOutput ? "success" : "running"),
      error: generatedCustom.hasOutput ? "" : (generatedCustom.error || snapshot.customCreative.error || ""),
      outputUrl: generatedCustom.hasOutput ? generatedCustom.previewUrl : (snapshot.customCreative.outputUrl || ""),
      downloadUrl: generatedCustom.hasOutput ? generatedCustom.downloadUrl : (snapshot.customCreative.downloadUrl || ""),
      canvasUrl: generatedCustom.canvasUrl || snapshot.customCreative.canvasUrl || "",
      canvasName: generatedCustom.canvasName || snapshot.customCreative.canvasName || "",
      videoNodeName: generatedCustom.videoNodeName || snapshot.customCreative.videoNodeName || "",
      model: generatedCustom.model || snapshot.customCreative.model || "",
      videoGenerationMode: generatedCustom.videoGenerationMode || snapshot.customCreative.videoGenerationMode || "",
      videoGenerationModeLabel: generatedCustom.videoGenerationModeLabel || snapshot.customCreative.videoGenerationModeLabel || ""
    });
    if (generatedCustom.hasOutput) snapshot.customCreative.status = "创意视频已生成，可直接预览并下载无水印成片。";
  }
  return snapshot;
}

function candidateVideoResultUrl(jobId, mode) {
  if (!state.candidateJob?.id || !jobId) return "";
  return `./api/product-workflows/image-candidates/${encodeURIComponent(state.candidateJob.id)}/outputs/${encodeURIComponent(jobId)}/${mode}`;
}

function applyServerGeneratedVideos(videos = []) {
  for (const result of Array.isArray(videos) ? videos : []) {
    if (!result?.angle || !result.jobId) continue;
    if (["customCreative", "creativeInstruction"].includes(result.angle)) continue;
    const lane = laneState(result.angle);
    lane.jobId = result.jobId;
    lane.jobStatus = result.status || "";
    lane.videoModelId = result.videoModelId || lane.videoModelId;
    lane.videoGenerationMode = result.videoGenerationMode || lane.videoGenerationMode;
    lane.videoGenerationModeLabel = result.videoGenerationModeLabel || lane.videoGenerationModeLabel;
    lane.model = result.model || lane.model;
    lane.duration = Number(result.duration || lane.duration || 4);
    lane.canvasUrl = result.canvasUrl || lane.canvasUrl;
    lane.canvasName = result.canvasName || lane.canvasName;
    lane.videoNodeName = result.videoNodeName || lane.videoNodeName;
    lane.videoPrompt = result.videoPrompt || lane.videoPrompt;
    if (result.hasOutput) {
      lane.outputUrl = result.previewUrl || candidateVideoResultUrl(result.jobId, "preview");
      lane.downloadUrl = result.downloadUrl || candidateVideoResultUrl(result.jobId, "download");
      lane.error = "";
      lane.status = "视频已生成，可播放或下载成片。";
    } else if (["failed", "interrupted", "missing"].includes(result.status)) {
      lane.outputUrl = "";
      lane.downloadUrl = "";
      lane.error = result.error || "视频生成失败";
      lane.status = lane.error;
    }
  }
}

function takeProductChannelSwitchNotice(jobId) {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(PRODUCT_CHANNEL_SWITCH_NOTICE_KEY) || "null"); } catch {}
  if (!saved?.taskId || saved.taskId !== jobId) return null;
  localStorage.removeItem(PRODUCT_CHANNEL_SWITCH_NOTICE_KEY);
  return saved;
}

function notifyAiProductTaskContextChanged() {
  window.dispatchEvent(new CustomEvent("ai-product-task-context-changed", {
    detail: window.AiProductTaskContext?.current?.() || {}
  }));
}

function queueProductDraftSync(draft) {
  if (productTaskPersistenceSuspended || state.candidateJob?.status !== "draft" || !state.candidateJob.id) return;
  const draftData = { ...draft };
  delete draftData.savedAt;
  const serialized = JSON.stringify(draftData);
  if (serialized === productDraftSyncLast) return;
  productDraftSyncPending = { jobId: state.candidateJob.id, draftData, serialized };
  clearTimeout(productDraftSyncTimer);
  productDraftSyncTimer = setTimeout(flushProductDraftSync, 250);
}

async function flushProductDraftSync() {
  if (productDraftSyncInFlight || !productDraftSyncPending) return;
  const pending = productDraftSyncPending;
  productDraftSyncPending = null;
  productDraftSyncInFlight = true;
  try {
    await api(`./api/product-workflows/image-candidates/${encodeURIComponent(pending.jobId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ draftData: pending.draftData })
    });
    productDraftSyncLast = pending.serialized;
    window.dispatchEvent(new Event("module-task-updated"));
  } catch (error) {
    if (state.candidateJob?.id === pending.jobId && state.candidateJob?.status === "draft") {
      notice($("#taskStatus"), `草稿自动保存失败：${error.message}`, true);
    }
  } finally {
    productDraftSyncInFlight = false;
    if (productDraftSyncPending) productDraftSyncTimer = setTimeout(flushProductDraftSync, 250);
  }
}

function saveProductTaskState() {
  if (productTaskPersistenceSuspended) return;
  const stored = readProductTaskState();
  stored.jobs ||= {};
  const draft = {
    reference: state.reference,
    prompt: $("#scenePrompt")?.value || "",
    promptConfirmed: state.promptConfirmed,
    productId: $("#productSelect")?.value || "",
    imageModel: selectedImageModel(),
    activeProductChannel: state.activeProductChannel,
    customCreative: serializableLane(state.customCreative),
    savedAt: new Date().toISOString()
  };
  if (state.reference?.path || state.customCreative.scene?.path || state.customCreative.jobId) localStorage.setItem(PRODUCT_DRAFT_KEY, JSON.stringify(draft));
  if (state.candidateJob?.id) {
    const taskSnapshot = {
      ...draft,
      selectedCandidates: { ...state.selectedCandidates },
      lanes: Object.fromEntries(Object.entries(state.lanes).map(([id, lane]) => [id, serializableLane(lane)])),
      activeAngleId: state.activeAngleId,
      customCreative: serializableLane(state.customCreative)
    };
    stored.jobs[state.candidateJob.id] = taskSnapshot;
    localStorage.setItem(PRODUCT_ACTIVE_TASK_KEY, state.candidateJob.id);
    queueProductDraftSync(taskSnapshot);
  }
  localStorage.setItem(PRODUCT_TASK_STORAGE_KEY, JSON.stringify(stored));
}

function applyProductDraft(draft) {
  if (!draft) return;
  if (draft.activeProductChannel) setActiveProductChannel(draft.activeProductChannel);
  if (draft.productId && [...$("#productSelect").options].some((option) => option.value === draft.productId)) $("#productSelect").value = draft.productId;
  state.confirmedProductId = $("#productSelect")?.value || "";
  const model = [...document.querySelectorAll('input[name="imageModel"]')].find((input) => input.value === draft.imageModel);
  if (model) model.checked = true;
  if (draft.reference?.path) {
    state.reference = { ...draft.reference, previewUrl: draft.reference.previewUrl || `./api/image?path=${encodeURIComponent(draft.reference.path)}` };
    $("#referencePreview").src = state.reference.previewUrl;
    $("#referencePreview").hidden = false;
    $("#referencePlaceholder").hidden = true;
    $("#analyzePromptButton").disabled = false;
  }
  $("#scenePrompt").value = draft.prompt || "";
  state.promptConfirmed = Boolean(draft.promptConfirmed);
  if (draft.customCreative) state.customCreative = { ...state.customCreative, ...serializableLane(draft.customCreative) };
  updatePromptState();
  renderCustomCreative();
}

async function restoreProductTask() {
  const requested = new URLSearchParams(location.search).get("task") || localStorage.getItem(PRODUCT_ACTIVE_TASK_KEY) || "";
  const stored = readProductTaskState();
  if (!requested) {
    let draft = null;
    try { draft = JSON.parse(localStorage.getItem(PRODUCT_DRAFT_KEY) || "null"); } catch {}
    applyProductDraft(draft);
    if (draft?.productId) await Promise.all([loadAssets("image"), loadAssets("video")]);
    if (draft?.reference?.path) notice($("#referenceStatus"), `已恢复草稿：${draft.reference.name || "已上传参考图"}。`);
    if (state.customCreative.jobId && !["success", "partial", "failed"].includes(state.customCreative.jobStatus)) startCustomCreativePolling();
    return;
  }
  try {
    const result = await api(`./api/product-workflows/image-candidates/${encodeURIComponent(requested)}`);
    const snapshot = reconcileProductTaskSnapshot(
      result.job.draftData || {},
      stored.jobs?.[requested] || {},
      result.job.generatedVideos || []
    );
    state.candidateJob = result.job;
    if (result.job.status === "draft") {
      applyProductDraft(snapshot);
      if (snapshot.productId) await Promise.all([loadAssets("image"), loadAssets("video")]);
      state.selectedCandidates = { ...(snapshot.selectedCandidates || {}) };
      state.lanes = Object.fromEntries(Object.entries(snapshot.lanes || {}).map(([id, lane]) => [id, serializableLane(lane)]));
      applyServerGeneratedVideos(result.job.generatedVideos);
      state.activeAngleId = snapshot.activeAngleId || state.defaults.angles[0]?.id || "";
      if (snapshot.customCreative) state.customCreative = { ...state.customCreative, ...serializableLane(snapshot.customCreative) };
      localStorage.setItem(PRODUCT_ACTIVE_TASK_KEY, requested);
      renderLanes();
      renderCustomCreative();
      Object.keys(state.lanes).forEach((angleId) => { if (state.lanes[angleId]?.jobId && !state.lanes[angleId]?.outputUrl) startLaneJobPolling(angleId); });
      if (state.customCreative.jobId && !state.customCreative.outputUrl) startCustomCreativePolling();
      saveProductTaskState();
      const channelSwitchNotice = takeProductChannelSwitchNotice(result.job.id);
      notice(
        $("#taskStatus"),
        channelSwitchNotice
          ? `已为“${productChannelTaskLabel(channelSwitchNotice.channel)}”创建新任务：${result.job.taskName || result.job.id}。`
          : "已创建独立任务草稿，填写内容会自动保存。",
        false
      );
      notifyAiProductTaskContextChanged();
      return;
    }
    applyProductDraft({ ...snapshot, reference: { name: result.job.referenceImageName, path: result.job.referenceImagePath, previewUrl: result.job.referencePreviewUrl }, prompt: result.job.prompt, promptConfirmed: true, imageModel: result.job.imageModel });
    if (snapshot.productId) await Promise.all([loadAssets("image"), loadAssets("video")]);
    state.selectedCandidates = { ...(snapshot.selectedCandidates || {}) };
    for (const angle of state.defaults.angles) {
      if (!state.selectedCandidates[angle.id]) state.selectedCandidates[angle.id] = result.job.candidates.find((item) => item.angle === angle.id && item.status === "success")?.id || "";
    }
    state.lanes = Object.fromEntries(Object.entries(snapshot.lanes || {}).map(([id, lane]) => [id, serializableLane(lane)]));
    applyServerGeneratedVideos(result.job.generatedVideos);
    state.activeAngleId = snapshot.activeAngleId || state.defaults.angles[0]?.id || "";
    if (snapshot.customCreative) state.customCreative = { ...state.customCreative, ...serializableLane(snapshot.customCreative) };
    localStorage.setItem(PRODUCT_ACTIVE_TASK_KEY, requested);
    renderLanes();
    renderCustomCreative();
    if (result.job.candidates.some((item) => item.status === "generating")) startCandidatePolling();
    Object.keys(state.lanes).forEach((angleId) => { if (state.lanes[angleId]?.jobId && !state.lanes[angleId]?.outputUrl) startLaneJobPolling(angleId); });
    if (state.customCreative.jobId && !state.customCreative.outputUrl) startCustomCreativePolling();
    notice($("#taskStatus"), `已恢复任务 ${requested}，后台进度将继续刷新。`);
    notifyAiProductTaskContextChanged();
  } catch (error) {
    localStorage.removeItem(PRODUCT_ACTIVE_TASK_KEY);
    notice($("#taskStatus"), `无法恢复任务：${error.message}`, true);
  }
}

function createWorkstationId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const random = Array.from({ length: 4 }, () => Math.random().toString(16).slice(2, 10)).join("");
  return `${Date.now().toString(16)}-${random}`;
}

function workstationIdentity() {
  let stored = "";
  try {
    stored = localStorage.getItem(WORKSTATION_STORAGE_KEY) || "";
  } catch {}
  let parsed = null;
  try {
    parsed = stored ? JSON.parse(stored) : null;
  } catch {}
  const validId = /^[a-z0-9-]{16,80}$/i.test(String(parsed?.id || ""));
  const id = validId ? String(parsed.id).toLowerCase() : createWorkstationId().toLowerCase();
  const shortId = id.replace(/[^a-z0-9]/gi, "").slice(-8).toUpperCase();
  const identity = { id, label: `电脑-${shortId}` };
  try {
    localStorage.setItem(WORKSTATION_STORAGE_KEY, JSON.stringify(identity));
  } catch {}
  return identity;
}

const WORKSTATION = workstationIdentity();

const VIDEO_GENERATION_MODE_LABELS = Object.freeze({
  text2video: "文生视频",
  mixed2video: "全能参考",
  singleImage2video: "图生视频",
  frames2video: "首尾帧",
  image2video: "图片参考",
  videoEdit2video: "视频编辑"
});
const VIDEO_GENERATION_MODE_FALLBACKS = Object.freeze({
  "seedance-2-vip": Object.freeze(["text2video", "mixed2video", "singleImage2video", "frames2video", "image2video"]),
  "seedance-2-5": Object.freeze(["text2video", "mixed2video", "singleImage2video", "frames2video", "image2video", "videoEdit2video"]),
  "kling-o3": Object.freeze(["text2video", "mixed2video", "singleImage2video", "frames2video", "videoEdit2video"])
});
const VISIBLE_VIDEO_GENERATION_MODES = Object.freeze({
  "seedance-2-vip": Object.freeze(["mixed2video"]),
  "seedance-2-5": Object.freeze(["videoEdit2video", "mixed2video"]),
  "kling-o3": Object.freeze([])
});
const HIDDEN_VIDEO_MODEL_IDS = new Set(["kling-o3"]);
const VIDEO_GENERATION_MODE_DEFAULTS = Object.freeze({
  "seedance-2-vip": "mixed2video",
  "seedance-2-5": "videoEdit2video",
  "kling-o3": "mixed2video"
});

function videoModelCatalog() {
  const configured = Array.isArray(state.defaults?.videoModels) ? state.defaults.videoModels : [];
  const refreshed = [...state.videoModelsByDuration.values()].flat();
  return [...configured, ...refreshed].filter((model, index, models) => (
    model?.id && models.findIndex((candidate) => candidate?.id === model.id) === index
  ));
}

function videoModelDefinition(modelId = "") {
  return videoModelCatalog().find((model) => model.id === modelId)
    || videoModelCatalog()[0]
    || { id: "seedance-2-vip", label: "Seedance 2.0 VIP", durationMin: 4, durationMax: 15, defaultDuration: 5, defaultClarity: "720p", clarityOptions: [{ value: "480p", label: "480P" }, { value: "720p", label: "720P" }, { value: "1080p", label: "1080P" }], defaultVideoGenerationMode: "mixed2video", videoGenerationModes: VIDEO_GENERATION_MODE_FALLBACKS["seedance-2-vip"].map((value) => ({ value, label: VIDEO_GENERATION_MODE_LABELS[value] })) };
}

function videoGenerationModeOptions(modelId = "") {
  const model = videoModelDefinition(modelId);
  const configured = Array.isArray(model.videoGenerationModes) ? model.videoGenerationModes : [];
  const source = configured.length
    ? configured
    : (VIDEO_GENERATION_MODE_FALLBACKS[model.id] || VIDEO_GENERATION_MODE_FALLBACKS["seedance-2-vip"])
      .map((value) => ({ value, label: VIDEO_GENERATION_MODE_LABELS[value] || value }));
  const visibleModes = VISIBLE_VIDEO_GENERATION_MODES[model.id] || [];
  return source.filter((option) => visibleModes.includes(option.value));
}

function defaultVideoGenerationMode(modelId = "") {
  const model = videoModelDefinition(modelId);
  const configuredDefault = String(model.defaultVideoGenerationMode || "").trim();
  const options = videoGenerationModeOptions(model.id);
  return options.some((option) => option.value === configuredDefault)
    ? configuredDefault
    : VIDEO_GENERATION_MODE_DEFAULTS[model.id] || options[0]?.value || "mixed2video";
}

function selectedVideoGenerationMode(modelId = "", value = "") {
  const options = videoGenerationModeOptions(modelId);
  return options.find((option) => option.value === value)
    || options.find((option) => option.value === defaultVideoGenerationMode(modelId))
    || options[0]
    || { value: "mixed2video", label: "全能参考" };
}

function videoGenerationModeSelectOptions(modelId = "", value = "") {
  const selected = selectedVideoGenerationMode(modelId, value);
  return videoGenerationModeOptions(modelId).map((option) => (
    `<option value="${escapeHtml(option.value)}"${option.value === selected.value ? " selected" : ""}>${escapeHtml(option.label)}</option>`
  )).join("");
}

function durationOptions(modelId = "") {
  const model = videoModelDefinition(modelId);
  const minimum = Math.max(1, Number(model.durationMin || 4));
  const maximum = Math.max(minimum, Number(model.durationMax || 15));
  return Array.from({ length: maximum - minimum + 1 }, (_, index) => index + minimum);
}

function normalizedVideoDuration(value = 4, modelId = "") {
  const duration = Math.round(Number(value || 4));
  if (!modelId) return Math.max(3, Math.min(30, Number.isFinite(duration) ? duration : 4));
  const model = videoModelDefinition(modelId);
  const minimum = Math.max(1, Number(model.durationMin || 4));
  const maximum = Math.max(minimum, Number(model.durationMax || 15));
  const fallback = Number(model.defaultDuration || minimum);
  return Math.max(minimum, Math.min(maximum, Number.isFinite(duration) ? duration : fallback));
}

function selectedVideoClarity(modelId = "", clarity = "") {
  const model = videoModelDefinition(modelId);
  const options = Array.isArray(model.clarityOptions) ? model.clarityOptions : [];
  const requested = String(clarity || "").trim().toLowerCase();
  return options.find((option) => String(option.value).toLowerCase() === requested)
    || options.find((option) => option.value === model.defaultClarity)
    || options[0]
    || { value: "720p", label: "720P" };
}

function videoClaritySelectOptions(modelId = "", clarity = "") {
  const selected = selectedVideoClarity(modelId, clarity);
  const options = videoModelDefinition(modelId).clarityOptions || [selected];
  return options.map((option) => `<option value="${escapeHtml(option.value)}"${option.value === selected.value ? " selected" : ""}>${escapeHtml(option.label)}</option>`).join("");
}

function rememberVideoModelAvailability(duration, models) {
  if (!Array.isArray(models) || !models.length) return;
  state.videoModelsByDuration.set(normalizedVideoDuration(duration), models);
}

async function refreshVideoModelAvailability(duration, options = {}) {
  const normalizedDuration = normalizedVideoDuration(duration);
  if (!options.force && state.videoModelsByDuration.has(normalizedDuration)) {
    return state.videoModelsByDuration.get(normalizedDuration);
  }
  if (state.videoModelAvailabilityRequests.has(normalizedDuration)) {
    return state.videoModelAvailabilityRequests.get(normalizedDuration);
  }
  const params = new URLSearchParams({ duration: normalizedDuration });
  if (options.clarity) params.set("clarity", options.clarity);
  const request = api(`./api/product-workflows/video-models?${params}`)
    .then((result) => {
      rememberVideoModelAvailability(normalizedDuration, result.videoModels);
      return result.videoModels || [];
    })
    .finally(() => state.videoModelAvailabilityRequests.delete(normalizedDuration));
  state.videoModelAvailabilityRequests.set(normalizedDuration, request);
  return request;
}

function videoModelOptions(duration = 4) {
  const normalizedDuration = normalizedVideoDuration(duration);
  const configured = state.videoModelsByDuration.get(normalizedDuration)
    || (Array.isArray(state.defaults?.videoModels) ? state.defaults.videoModels : []);
  const options = configured.length ? configured : [
    { id: "seedance-2-vip", label: "Seedance 2.0 VIP", maxProductImages: 9, minReferenceVideoDuration: 0, maxReferenceVideoDuration: 0 },
    { id: "seedance-2-5", label: "Seedance 2.5", maxProductImages: 9, minReferenceVideoDuration: 4, maxReferenceVideoDuration: 30 },
    { id: "kling-o3", label: "Kling O3", maxProductImages: 3, minReferenceVideoDuration: 3, maxReferenceVideoDuration: 10 }
  ];
  return options.filter((model) => !HIDDEN_VIDEO_MODEL_IDS.has(model.id));
}

function selectedVideoModel(modelId = "", duration = 4) {
  const options = videoModelOptions(duration);
  const requested = options.find((model) => model.id === modelId);
  if (requested && requested.available !== false) return requested;
  return options.find((model) => model.available !== false) || requested || options[0];
}

function videoModelSelectOptions(modelId = "", duration = 4) {
  const selected = selectedVideoModel(modelId, duration);
  return videoModelOptions(duration).map((model) => (
    `<option value="${escapeHtml(model.id)}"${model.id === selected.id ? " selected" : ""}${model.available === false ? " disabled" : ""}${model.availabilityMessage ? ` title="${escapeHtml(model.availabilityMessage)}"` : ""}>${escapeHtml(model.label)}${model.available === false ? `（${escapeHtml(model.unavailableReason || "积分不足")}）` : ""}</option>`
  )).join("");
}

function videoModelCompatibility(modelId, productImageCount, referenceVideoDuration = 0, duration = 4, clarity = "") {
  const model = selectedVideoModel(modelId, duration);
  if (model.available === false) {
    return { ok: false, model, message: `${model.label} 当前不可用：${model.unavailableReason || "当前账号积分不足"}` };
  }
  const maxProducts = Math.max(1, Number(model.maxProductImages || MAX_PRODUCT_SELECTION));
  const minimumDuration = Math.max(1, Number(model.durationMin || 4));
  const maximumDuration = Math.max(minimumDuration, Number(model.durationMax || 15));
  if (!Number.isInteger(Number(duration)) || Number(duration) < minimumDuration || Number(duration) > maximumDuration) {
    return { ok: false, model, message: `${model.label} 的时长仅支持${minimumDuration}–${maximumDuration}秒` };
  }
  const selectedClarity = selectedVideoClarity(model.id, clarity);
  const minReferenceDuration = Math.max(0, Number(model.minReferenceVideoDuration || 0));
  const maxReferenceDuration = Math.max(0, Number(model.maxReferenceVideoDuration || 0));
  if (productImageCount > maxProducts) {
    return { ok: false, model, message: `${model.label} 在参考视频模式下最多支持${maxProducts}张产品白底图` };
  }
  if (minReferenceDuration > 0 && referenceVideoDuration > 0 && referenceVideoDuration + 0.05 < minReferenceDuration) {
    return {
      ok: false,
      reason: "reference-duration",
      model,
      message: model.id === "seedance-2-5"
        ? "Seedance 2.5 所选碎镜头参考视频总时长必须在4-30秒，请再次选择"
        : `${model.label} 的拼接参考视频最短需要${minReferenceDuration}秒`
    };
  }
  if (maxReferenceDuration > 0 && referenceVideoDuration > maxReferenceDuration + 0.05) {
    return {
      ok: false,
      reason: "reference-duration",
      model,
      message: model.id === "seedance-2-5"
        ? "Seedance 2.5 所选碎镜头参考视频总时长必须在4-30秒，请再次选择"
        : `${model.label} 的拼接参考视频最长支持${maxReferenceDuration}秒`
    };
  }
  return { ok: true, model, clarity: selectedClarity, message: `${model.label} · ${selectedClarity.label} 将同步到 LibTV` };
}

function formatClipDuration(value) {
  const duration = Number(value || 0);
  if (!(duration > 0)) return "时长待读取";
  const minutes = Math.floor(duration / 60);
  const seconds = (duration % 60).toFixed(1).padStart(4, "0");
  return `${String(minutes).padStart(2, "0")}:${seconds}`;
}

function fragmentDuration(asset) {
  return Number(asset?.duration || asset?.metadata?.duration || 0);
}

function seedance25ReferenceDurationStatus(modelId, fragmentAssets = []) {
  if (String(modelId || "") !== "seedance-2-5") return { applies: false, ok: true, show: false, totalDuration: 0 };
  const assets = Array.isArray(fragmentAssets) ? fragmentAssets : [];
  if (!assets.length) return { applies: true, ok: true, show: false, totalDuration: 0 };
  const durations = assets.map(fragmentDuration);
  const durationKnown = durations.every((duration) => duration > 0);
  const totalDuration = durations.reduce((sum, duration) => sum + duration, 0);
  if (!durationKnown) return { applies: true, ok: false, show: false, totalDuration };
  const ok = totalDuration + 0.05 >= 4 && totalDuration <= 30.05;
  return {
    applies: true,
    ok,
    show: !ok,
    totalDuration,
    message: "Seedance 2.5 所选碎镜头参考视频总时长必须在4-30秒，请再次选择"
  };
}

function roundedReferenceVideoDuration(totalDuration, minimum = 1, maximum = 30) {
  const total = Number(totalDuration || 0);
  if (!(total > 0)) return 0;
  const min = Math.max(1, Math.round(Number(minimum) || 1));
  const max = Math.max(min, Math.round(Number(maximum) || min));
  return Math.max(min, Math.min(max, Math.round(total)));
}

function autoFillReferenceVideoDuration(holder, options = {}) {
  const totalDuration = selectedFragmentAssets(holder).reduce((sum, asset) => sum + fragmentDuration(asset), 0);
  holder.referenceVideoDuration = totalDuration;
  if (!(totalDuration > 0) || (holder.durationManuallyEdited === true && options.force !== true)) return false;
  const model = videoModelDefinition(holder.videoModelId);
  holder.duration = roundedReferenceVideoDuration(totalDuration, model.durationMin, model.durationMax);
  holder.durationAutoFilled = true;
  return true;
}

function referenceVideoDurationHint(holder, totalDuration = 0) {
  if (holder.durationManuallyEdited === true) return "已手动设置；更换碎镜头不会覆盖";
  if (totalDuration > 0) return `参考视频共${totalDuration.toFixed(1)}秒，已四舍五入预填${Number(holder.duration || 0)}秒`;
  return "选择碎镜头后按拼接总时长自动预填";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

async function api(url, options = {}) {
  let response;
  try {
    response = await fetch(url, options);
  } catch (error) {
    const connectionError = new Error("暂时无法连接AI视频工作台服务");
    connectionError.code = "WORKBENCH_OFFLINE";
    connectionError.retryable = true;
    connectionError.cause = error;
    throw connectionError;
  }
  const data = await response.json().catch(() => ({}));
  if (response.status === 401 && data.loginRequired) location.href = "./login.html";
  if (!response.ok) {
    const requestError = new Error(data.error || `请求失败（${response.status}）`);
    requestError.status = response.status;
    requestError.code = String(data.code || "");
    requestError.payload = data;
    requestError.retryable = [502, 503, 504].includes(response.status);
    throw requestError;
  }
  return data;
}

async function uploadResponseData(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

function notice(element, message, error = false) {
  element.hidden = !message;
  element.textContent = message;
  element.classList.toggle("error", error);
}

function isQwenQuotaError(error) {
  return error?.code === "QWEN_QUOTA_EXHAUSTED"
    || /高阶模型额度.*(?:消耗完毕|用完|用尽|耗尽|不足)|额度.*(?:消耗完毕|用完|用尽|耗尽)|quota.*(?:exhausted|exceeded|depleted)/i.test(String(error?.message || ""));
}

function setQwenQuotaNotice(exhausted, message = "") {
  state.qwenQuotaExhausted = Boolean(exhausted);
  const banner = $("#qwenQuotaNotice");
  const provider = state.defaults?.promptProvider || {};
  banner.hidden = !state.qwenQuotaExhausted;
  if (state.qwenQuotaExhausted) {
    $("#qwenQuotaMessage").textContent = message || "图片反推暂不可用；你仍可手动填写提示词并继续使用生图、视频生成和共享资产功能。";
  }
  $("#promptProviderStatus").textContent = state.qwenQuotaExhausted
    ? `${provider.model || "qwen3.7-plus"} · 额度不足`
    : provider.configured
      ? `${provider.model} 已接入`
      : `${provider.model || "qwen3.7-plus"} 待配置`;
  $("#promptProviderStatus").classList.toggle("warning", state.qwenQuotaExhausted || !provider.configured);
}

function selectedProduct() {
  return state.defaults?.products?.find((item) => item.id === $("#productSelect").value) || state.defaults?.products?.[0] || null;
}

function notifyTaskProductChanged() {
  const product = selectedProduct();
  window.dispatchEvent(new CustomEvent("ai-product-sku-changed", {
    detail: {
      productId: product?.id || "",
      productName: product?.name || "",
      productCategory: product?.category || ""
    }
  }));
}

function currentTaskHasGeneratedVideo() {
  if (!state.candidateJob?.id) return false;
  const serverOutputs = Array.isArray(state.candidateJob.generatedVideos) ? state.candidateJob.generatedVideos : [];
  if (serverOutputs.some((item) => item?.hasOutput)) return true;
  if (Object.values(state.lanes).some((lane) => Boolean(lane?.outputUrl))) return true;
  if (state.customCreative.outputUrl) return true;
  const creative = globalThis.AiCreativeInstructionShowcaseContext?.current?.() || {};
  return creative.candidateJobId === state.candidateJob.id && creative.hasOutput === true;
}

function currentTaskHasStartedGeneration() {
  if (!state.candidateJob?.id) return false;
  if (state.candidateJob.status && state.candidateJob.status !== "draft") return true;
  if ((state.candidateJob.generatedVideos || []).length) return true;
  if (Object.values(state.lanes).some((lane) => Boolean(lane?.jobId))) return true;
  if (state.customCreative.jobId) return true;
  const creative = globalThis.AiCreativeInstructionShowcaseContext?.current?.() || {};
  return creative.candidateJobId === state.candidateJob.id && Boolean(creative.id);
}

async function ensureProductTaskForChannel(channel = state.activeProductChannel) {
  const requestedChannel = normalizedProductChannel(channel);
  if (state.candidateJob?.id) {
    const currentChannel = normalizedProductChannel(state.candidateJob.taskChannel || state.candidateJob.draftData?.activeProductChannel || state.activeProductChannel);
    if (currentChannel !== requestedChannel && currentTaskHasStartedGeneration()) {
      throw new Error("当前任务已在其他制作通道开始生成，请先点击“新建任务”再使用当前通道。");
    }
    if (currentChannel !== requestedChannel && state.candidateJob.status === "draft") {
      state.candidateJob.taskChannel = requestedChannel;
      saveProductTaskState();
      await flushProductDraftSync();
    }
    return state.candidateJob.id;
  }
  const result = await api("./api/product-workflows/image-candidates/drafts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ forceNew: true, taskChannel: requestedChannel })
  });
  state.candidateJob = result.job;
  productTaskPersistenceSuspended = false;
  localStorage.setItem(PRODUCT_ACTIVE_TASK_KEY, result.job.id);
  saveProductTaskState();
  notifyAiProductTaskContextChanged();
  window.dispatchEvent(new Event("module-task-updated"));
  return result.job.id;
}

function selectedImageModel() {
  return document.querySelector('input[name="imageModel"]:checked')?.value || state.defaults?.imageModel || "openai/gpt-image-2";
}

function imageModelLabel(model = selectedImageModel()) {
  return state.defaults?.imageModels?.find((item) => item.id === model)?.label
    || (model === "doubao-seedream-5-0-pro-260628" ? "Seedream 5.0 Pro" : "GPT Image 2");
}

function updateImageModelSummary() {
  const modelLabel = state.candidateJob?.imageModelLabel || imageModelLabel();
  if ($("#imageModelSummary")) $("#imageModelSummary").textContent = `${modelLabel} · 9:16 · 1K；先生成平拍母图，再并发生成俯拍与特写`;
}

function assetById(assetId) {
  return [...state.assetsByType.image, ...state.assetsByType.video].find((item) => item.id === assetId) || null;
}

function aiShowcaseVisibleAssets(type) {
  const assets = state.assetsByType[type] || [];
  return type === "image"
    ? assets.filter((asset) => asset.source !== "workspace_product_catalog")
    : assets;
}

function selectedFragmentIds(holder) {
  return Array.isArray(holder?.fragmentAssetIds)
    ? [...new Set(holder.fragmentAssetIds.map((item) => String(item || "").trim()).filter(Boolean))]
    : [];
}

function selectedFragmentAssets(holder) {
  return selectedFragmentIds(holder).map(assetById).filter((asset) => asset?.assetType === "video");
}

function selectedProductIds(holder) {
  const ids = Array.isArray(holder?.productAssetIds) && holder.productAssetIds.length
    ? holder.productAssetIds
    : (holder?.productAssetId ? [holder.productAssetId] : []);
  return [...new Set(ids.map((item) => String(item || "").trim()).filter(Boolean))].slice(0, productSelectionLimit(holder));
}

function selectedProductAssets(holder) {
  return selectedProductIds(holder).map(assetById).filter((asset) => asset?.assetType === "image");
}

function candidatesFor(angleId) {
  return (state.candidateJob?.candidates || [])
    .filter((item) => item.angle === angleId)
    .sort((left, right) => Number(right.version || 0) - Number(left.version || 0)
      || String(right.createdAt || "").localeCompare(String(left.createdAt || "")));
}

function productSelectionLimit(holder) {
  const model = selectedVideoModel(holder?.videoModelId, holder?.duration);
  return Math.min(MAX_PRODUCT_SELECTION, Math.max(1, Number(model.maxProductImages || MAX_PRODUCT_SELECTION)));
}

function selectedCandidate(angleId) {
  return candidatesFor(angleId).find((item) => item.id === state.selectedCandidates[angleId] && item.status === "success") || null;
}

function laneState(angleId) {
  if (!state.lanes[angleId]) state.lanes[angleId] = {
    productAssetId: "",
    productAssetIds: [],
    fragmentAssetIds: [],
    status: "",
    error: "",
    refreshWarning: "",
    pollFailureCount: 0,
    pollInFlight: false,
    jobId: "",
    outputUrl: "",
    downloadUrl: "",
    canvasUrl: "",
    canvasName: "",
    videoNodeName: "",
    videoPrompt: "",
    prompt: "",
    duration: 4,
    durationManuallyEdited: false,
    durationAutoFilled: false,
    referenceVideoDuration: 0,
    clarity: "720p",
    videoModelId: state.defaults?.defaultVideoModelId || "seedance-2-vip",
    videoGenerationMode: "",
    videoGenerationModeLabel: "",
    polling: null
  };
  return state.lanes[angleId];
}

function updatePromptState() {
  const hasPrompt = Boolean($("#scenePrompt").value.trim());
  $("#confirmPromptButton").disabled = !state.reference || !hasPrompt;
  $("#confirmPromptButton").textContent = state.promptConfirmed ? "修改提示词" : "确认提示词";
  $("#scenePrompt").readOnly = state.promptConfirmed;
  $("#promptLockText").textContent = state.promptConfirmed ? "提示词已确认，空场景将自动生成" : "提示词尚未确认";
  updateWorkflowProgress();
}

function updateWorkflowProgress() {
  const steps = $$(".ps-step-rail > div");
  if (!steps.length) return;
  const angles = Array.isArray(state.defaults?.angles) ? state.defaults.angles : [];
  const allScenesReady = Boolean(angles.length) && angles.every((angle) => Boolean(selectedCandidate(angle.id)));
  const laneHasMaterials = angles.some((angle) => {
    const lane = laneState(angle.id);
    return selectedFragmentAssets(lane).length > 0 || selectedProductAssets(lane).length > 0 || Boolean(String(lane.prompt || "").trim());
  });
  const anyVideoJob = angles.some((angle) => Boolean(laneState(angle.id).jobId));
  let currentIndex = 0;
  if (state.reference) currentIndex = 1;
  if (state.promptConfirmed) currentIndex = 2;
  if (allScenesReady || laneHasMaterials) currentIndex = 3;
  if (anyVideoJob) currentIndex = 4;
  steps.forEach((step, index) => {
    const reached = index <= currentIndex;
    step.classList.toggle("reached", reached);
    step.classList.toggle("active", index === currentIndex);
    if (index === currentIndex) step.setAttribute("aria-current", "step");
    else step.removeAttribute("aria-current");
  });
}

function closeProductSelectMenu(focusTrigger = false) {
  const menu = $("#productSelectMenu");
  const trigger = $("#productSelectTrigger");
  if (!menu || !trigger) return;
  menu.hidden = true;
  trigger.setAttribute("aria-expanded", "false");
  if (focusTrigger) trigger.focus();
}

function openProductSelectMenu() {
  const menu = $("#productSelectMenu");
  const trigger = $("#productSelectTrigger");
  if (!menu || !trigger || trigger.disabled) return;
  menu.hidden = false;
  trigger.setAttribute("aria-expanded", "true");
  requestAnimationFrame(() => menu.querySelector('[aria-selected="true"]')?.focus());
}

function renderProductSelectControl() {
  const select = $("#productSelect");
  const trigger = $("#productSelectTrigger");
  const label = $("#productSelectLabel");
  const menu = $("#productSelectMenu");
  if (!select || !trigger || !label || !menu) return;
  const selectedOption = select.options[select.selectedIndex];
  const selectedText = selectedOption?.textContent?.trim() || "请选择产品SKU";
  label.textContent = selectedText;
  trigger.title = selectedText;
  trigger.disabled = select.disabled || !select.options.length;
  menu.innerHTML = [...select.options].map((option) => (
    `<button class="ps-product-select-option" type="button" role="option" data-product-id="${escapeHtml(option.value)}" aria-selected="${option.selected ? "true" : "false"}" title="${escapeHtml(option.textContent)}">${escapeHtml(option.textContent)}</button>`
  )).join("");
  closeProductSelectMenu();
}

function renderDefaults(preferredProductId = $("#productSelect")?.value) {
  rememberVideoModelAvailability(state.defaults.defaultDuration || 4, state.defaults.videoModels);
  $("#productSelect").innerHTML = state.defaults.products.map((product) => (
    `<option value="${escapeHtml(product.id)}">${escapeHtml(product.name)}${product.assetStatus === "pending" ? "（待补素材）" : ""}</option>`
  )).join("");
  if (preferredProductId && state.defaults.products.some((product) => product.id === preferredProductId)) {
    $("#productSelect").value = preferredProductId;
  }
  state.confirmedProductId = $("#productSelect").value || "";
  renderProductSelectControl();
  notifyTaskProductChanged();
  $("#assetRoleSelect").innerHTML = `<option value="white_background">产品白底图</option>${state.defaults.ampouleAssetRoles.map((role) => `<option value="${escapeHtml(role.id)}">${escapeHtml(role.label)}</option>`).join("")}`;
  const storage = state.defaults.storage;
  const storageText = storage.sharedStorageEnabled ? "OSS 已连接" : "OSS 未连接";
  const canvasText = state.dailyCanvas
    ? `视频项目 · ${state.dailyCanvas.workstationLabel}`
    : state.dailyCanvasError
      ? "视频项目 · 等待本机标识"
      : "视频项目 · 正在识别";
  $("#storageStatus").textContent = `${storageText} · ${canvasText}`;
  $("#storageStatus").title = state.dailyCanvas
    ? `${state.dailyCanvas.workspaceName} · 首次提交视频时创建；同一业务任务的多次生成复用同一画布`
    : state.dailyCanvasError || "同一用户、电脑和业务模块复用一个 LibTV 视频项目";
  const provider = state.defaults.promptProvider || {};
  setQwenQuotaNotice(Boolean(provider.quotaExhausted), provider.quotaMessage);
  const defaultImageModel = state.defaults.imageModel || "openai/gpt-image-2";
  const defaultImageModelInput = document.querySelector(`input[name="imageModel"][value="${defaultImageModel}"]`);
  if (defaultImageModelInput && !state.candidateJob) defaultImageModelInput.checked = true;
  updateImageModelSummary();
  updateProductHint();
  renderLanes();
  renderCustomCreative();
}

function updateProductHint() {
  const product = selectedProduct();
  if (!product) {
    $("#productAssetHint").textContent = "请先在SKU管理中新增或启用产品SKU。";
    $("#assetFileInput").disabled = true;
    return;
  }
  $("#assetFileInput").disabled = state.assetUploadBusy;
  $("#productAssetHint").textContent = "单击可选，图片与碎镜头按固定SKU编码关联资产库。";
  $("#assetRoleField").hidden = state.activeAssetTab !== "image" || !/deep-sea|次抛|精华液/i.test(`${product.id} ${product.name}`);
}

async function uploadReference(file) {
  if (!file) return;
  if (!/\.(png|jpe?g)$/i.test(file.name)) throw new Error("参考图仅支持PNG或JPG");
  if (file.size > 10 * 1024 * 1024) throw new Error("参考图不能超过10MB");
  notice($("#referenceStatus"), `正在上传参考图：${file.name}`);
  const params = new URLSearchParams({ name: file.name, session: `ai-showcase-reference-${Date.now()}` });
  const result = await uploadReferenceImageFile(file, params, (progress) => {
    notice($("#referenceStatus"), `正在分片上传参考图：${progress}%`);
  });
  state.reference = result.reference;
  state.promptConfirmed = false;
  state.candidateJob = null;
  state.selectedCandidates = {};
  state.pendingCandidateSelection = {};
  $("#referencePreview").src = result.reference.previewUrl;
  $("#referencePreview").hidden = false;
  $("#referencePlaceholder").hidden = true;
  $("#analyzePromptButton").disabled = false;
  updatePromptState();
  renderLanes();
  saveProductTaskState();
  notice($("#referenceStatus"), "参考图已上传。现在可以调用 qwen3.7-plus 进行8维场景拆解，并生成中文母提示词与一致性蓝图。");
}

async function reversePrompt() {
  if (!state.reference) return;
  $("#analyzePromptButton").disabled = true;
  notice($("#referenceStatus"), "正在按场景定位、构图、光影、色彩、材质、道具、镜头语言和真实感进行拆解…");
  try {
    const result = await api("./api/product-workflows/scene-prompts/reverse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ referenceImagePath: state.reference.path })
    });
    $("#scenePrompt").value = result.prompt;
    state.promptConfirmed = false;
    setQwenQuotaNotice(false);
    updatePromptState();
    notice($("#referenceStatus"), `${result.model} 已完成8维拆解、中文母提示词和一致性蓝图。请检查、修改并确认。`);
  } catch (error) {
    if (isQwenQuotaError(error)) {
      setQwenQuotaNotice(true, error.message);
      notice($("#referenceStatus"), "Qwen 高阶模型额度已用完，暂时无法自动反推。你可以手动填写提示词并继续生成，其他功能不受影响。", true);
    } else {
      notice($("#referenceStatus"), `${error.message}。接口配置完成前，也可以手动填写提示词继续测试页面。`, true);
    }
  } finally {
    $("#analyzePromptButton").disabled = false;
  }
}

async function togglePromptConfirmation() {
  if (state.promptConfirmed) {
    state.promptConfirmed = false;
  } else {
    if (!state.reference) return notice($("#referenceStatus"), "请先上传参考图。", true);
    if (!$("#scenePrompt").value.trim()) return notice($("#referenceStatus"), "请先填写或反推图片提示词。", true);
    state.promptConfirmed = true;
    notice($("#referenceStatus"), "提示词已确认，正在进入三路制作并生成平拍、俯拍、特写三个无产品场景。", false);
    updatePromptState();
    $("#scenesPanel").scrollIntoView({ behavior: "smooth", block: "start" });
    await createCandidateJob();
    return;
  }
  updatePromptState();
}

function candidateCard(candidate, angleId) {
  const modelLabel = candidate.imageModelLabel || state.candidateJob?.imageModelLabel || imageModelLabel();
  if (candidate.status === "generating") return `<article class="ps-scene-card generating"><span>${escapeHtml(candidate.label)}</span><b>${escapeHtml(modelLabel)} 生成中…</b></article>`;
  if (candidate.status === "failed") return `<article class="ps-scene-card failed"><b>${escapeHtml(candidate.label)}失败</b><span>${escapeHtml(candidate.error)}</span></article>`;
  const selected = state.selectedCandidates[angleId] === candidate.id;
  return `<button class="ps-scene-card ${selected ? "selected" : ""}" data-scene-id="${escapeHtml(candidate.id)}" data-scene-angle="${escapeHtml(angleId)}" type="button">
    <img src="${escapeHtml(candidate.previewUrl)}" alt="${escapeHtml(candidate.label)}" />
    <span><b>${escapeHtml(candidate.label)}</b><em>${escapeHtml(modelLabel)} · ${selected ? "当前使用" : "点击选择"}</em></span>
  </button>`;
}

function sceneCandidateTab(candidate, angleId) {
  const selected = state.selectedCandidates[angleId] === candidate.id;
  const statusLabel = candidate.status === "success" ? "已完成" : candidate.status === "failed" ? "失败" : "生成中";
  return `<button class="ps-scene-version-tab ${selected ? "active" : ""} ${escapeHtml(candidate.status || "")}" data-scene-id="${escapeHtml(candidate.id)}" data-scene-angle="${escapeHtml(angleId)}" type="button" ${candidate.status === "success" ? "" : "disabled"} title="${escapeHtml(candidate.label)} · ${statusLabel}">
    <b>${escapeHtml(candidate.label)}</b><span>${statusLabel}</span>
  </button>`;
}

function sceneCandidateStage(candidate, fallbackLabel, modelLabel) {
  if (!candidate) return `<div class="ps-source-placeholder"><b>${escapeHtml(fallbackLabel)}空场景</b><span>${escapeHtml(modelLabel)} · 确认提示词后生成</span></div>`;
  if (candidate.status === "generating") return `<div class="ps-scene-version-state generating"><b>${escapeHtml(candidate.label)}</b><span>${escapeHtml(candidate.imageModelLabel || modelLabel)} 生成中…</span></div>`;
  if (candidate.status === "failed") return `<div class="ps-scene-version-state failed"><b>${escapeHtml(candidate.label)}生成失败</b><span>${escapeHtml(candidate.error || "请点击追加场景重试")}</span></div>`;
  return `<button class="ps-scene-version-image" data-scene-id="${escapeHtml(candidate.id)}" data-scene-angle="${escapeHtml(candidate.angle)}" type="button" title="点击保持使用当前场景">
    <img src="${escapeHtml(candidate.previewUrl)}" alt="${escapeHtml(candidate.label)}" /><span><b>${escapeHtml(candidate.label)}</b><em>${escapeHtml(candidate.imageModelLabel || modelLabel)} · 当前使用</em></span>
  </button>`;
}

function selectedAssetCard(assetOrAssets, kind, angleId, options = {}) {
  const title = kind === "image" ? "产品白底图" : "真实产展碎镜头";
  if (kind === "video") {
    const assets = Array.isArray(assetOrAssets) ? assetOrAssets : (assetOrAssets ? [assetOrAssets] : []);
    if (!assets.length) return `<button class="ps-asset-slot empty" data-pick-asset="${kind}" data-angle="${angleId}" type="button"><b>＋ 选择${title}</b><span>至少选择${MIN_FRAGMENT_SELECTION}条，将自动拼接</span></button>`;
    const previews = assets.map((asset, index) => `<button data-preview-product-asset="${escapeHtml(asset.id)}" type="button" aria-label="预览原视频：${escapeHtml(asset.title)}" title="单击播放：${escapeHtml(asset.title)}"><img src="${escapeHtml(asset.thumbnailUrl)}" alt="${escapeHtml(asset.title)}缩略图" loading="lazy" /><i>${index + 1}</i><span class="ps-fragment-play" aria-hidden="true">▶</span></button>`).join("");
    const durationStatus = options.referenceDurationStatus || { show: false };
    return `<div class="ps-asset-slot ps-multi-asset-slot">
      <div class="ps-fragment-preview-grid">${previews}</div>
      <button class="ps-asset-adjust-button" data-pick-asset="${kind}" data-angle="${angleId}" type="button"><span><b>已选${assets.length}条碎镜头</b><em>调整顺序</em></span><small>将按 1 → ${assets.length} 自动拼接为完整参考视频，并保留素材原声</small></button>
      ${durationStatus.show ? `<div class="ps-reference-duration-alert" role="alert"><i aria-hidden="true">△</i><span>${escapeHtml(durationStatus.message)}</span></div>` : ""}
    </div>`;
  }
  const assets = Array.isArray(assetOrAssets) ? assetOrAssets : (assetOrAssets ? [assetOrAssets] : []);
  const holder = angleId === CUSTOM_CREATIVE_ANGLE ? state.customCreative : laneState(angleId);
  const maximum = productSelectionLimit(holder);
  if (!assets.length) {
    const hint = angleId === CUSTOM_CREATIVE_ANGLE
      ? `可选；不上传则沿用碎镜头中的产品，最多${maximum}张`
      : `可选，不上传则沿用碎镜头中的产品，最多${maximum}张`;
    return `<button class="ps-asset-slot empty ps-product-reference-empty" data-pick-asset="${kind}" data-angle="${angleId}" type="button"><span class="ps-product-reference-caution">请精准选择，建议直接不选</span><b>＋ 选择${title}</b><span>${hint}</span></button>`;
  }
  const previews = assets.map((asset, index) => `<button class="ps-product-preview-thumb" data-preview-product-image="${escapeHtml(asset.id)}" type="button" aria-label="查看大图：${escapeHtml(asset.title)}" title="点击查看大图">
    <img src="${escapeHtml(asset.thumbnailUrl || asset.previewUrl)}" alt="${escapeHtml(asset.title)}缩略图" loading="lazy" />
    <i>${index + 1}</i>
  </button>`).join("");
  return `<div class="ps-asset-slot ps-multi-asset-slot ps-product-multi-asset-slot">
    <span class="ps-product-reference-caution">请精准选择，建议直接不选</span>
    <div class="ps-product-preview-grid" aria-label="已选产品白底图缩略图">${previews}</div>
    <button class="ps-asset-adjust-button" data-pick-asset="${kind}" data-angle="${angleId}" type="button">
      <span><b>已选${assets.length}张产品白底图</b><em>调整选择</em></span>
      <small>点击上方缩略图可在页面查看大图</small>
    </button>
  </div>`;
}

function openProductImagePreview(assetId) {
  const asset = assetById(assetId);
  if (!asset) return;
  const dialog = $("#assetPreviewDialog");
  const image = $("#assetPreviewImage");
  const video = $("#assetPreviewVideo");
  dialog.classList.toggle("is-video-preview", asset.assetType === "video");
  dialog.classList.remove("ps-output-video-dialog");
  dialog.style.removeProperty("--asset-original-aspect-ratio");
  $("#assetPreviewType").textContent = asset.assetType === "video" ? "产品碎镜头原视频" : "产品白底图原图";
  $("#assetPreviewTitle").textContent = asset.title || "产品资产";
  if (asset.assetType === "video") {
    image.hidden = true;
    video.hidden = false;
    video.src = asset.originalUrl || asset.previewUrl;
  } else {
    video.hidden = true;
    image.hidden = false;
    image.src = asset.originalUrl || asset.previewUrl;
    image.alt = asset.title || "产品白底图大图";
  }
  dialog.showModal();
  if (asset.assetType === "video") {
    const playback = video.play();
    if (playback?.catch) playback.catch(() => {});
  }
}

function playbackTime(seconds) {
  const safeSeconds = Number.isFinite(Number(seconds)) && Number(seconds) >= 0 ? Math.floor(Number(seconds)) : 0;
  const minutes = Math.floor(safeSeconds / 60);
  return `${minutes}:${String(safeSeconds % 60).padStart(2, "0")}`;
}

function openOutputVideoPreview(url, title) {
  const source = String(url || "").trim();
  if (!source) return;
  const dialog = $("#assetPreviewDialog");
  const image = $("#assetPreviewImage");
  const video = $("#assetPreviewVideo");
  dialog.classList.add("is-video-preview", "ps-output-video-dialog");
  dialog.style.setProperty("--asset-original-aspect-ratio", "9 / 16");
  $("#assetPreviewType").textContent = "9:16 产展成片";
  $("#assetPreviewTitle").textContent = title || "产展视频";
  image.hidden = true;
  video.hidden = false;
  video.src = source;
  dialog.showModal();
  const playback = video.play();
  if (playback?.catch) playback.catch(() => {});
}

function syncOutputPlayer(player) {
  const video = player?.querySelector("video");
  if (!video) return;
  const toggle = player.querySelector("[data-output-toggle]");
  const mute = player.querySelector("[data-output-mute]");
  const progress = player.querySelector("[data-output-progress]");
  const time = player.querySelector("[data-output-time]");
  if (toggle) {
    toggle.textContent = video.paused ? "▶" : "❚❚";
    toggle.setAttribute("aria-label", video.paused ? "播放视频" : "暂停视频");
  }
  if (mute) {
    mute.textContent = video.muted || video.volume === 0 ? "🔇" : "🔊";
    mute.setAttribute("aria-label", video.muted || video.volume === 0 ? "取消静音" : "静音");
  }
  if (progress) {
    const duration = Number(video.duration || 0);
    progress.value = duration > 0 ? String(Math.round((Number(video.currentTime || 0) / duration) * 1000)) : "0";
  }
  if (time) {
    const durationLabel = Number.isFinite(video.duration) && video.duration > 0 ? playbackTime(video.duration) : "--:--";
    time.textContent = `${playbackTime(video.currentTime)} / ${durationLabel}`;
  }
}

function bindOutputPlayerControls(root = document) {
  root.querySelectorAll("[data-output-player]").forEach((player) => {
    if (player.dataset.controlsBound === "true") return;
    player.dataset.controlsBound = "true";
    const video = player.querySelector("video");
    const toggle = player.querySelector("[data-output-toggle]");
    const mute = player.querySelector("[data-output-mute]");
    const progress = player.querySelector("[data-output-progress]");
    const expand = player.querySelector("[data-output-expand]");
    toggle?.addEventListener("click", () => {
      if (video.paused) {
        const playback = video.play();
        if (playback?.catch) playback.catch(() => {});
      } else {
        video.pause();
      }
    });
    mute?.addEventListener("click", () => { video.muted = !video.muted; syncOutputPlayer(player); });
    progress?.addEventListener("input", () => {
      if (Number.isFinite(video.duration) && video.duration > 0) video.currentTime = (Number(progress.value || 0) / 1000) * video.duration;
    });
    expand?.addEventListener("click", () => openOutputVideoPreview(expand.dataset.outputUrl, expand.dataset.outputTitle));
    ["loadedmetadata", "durationchange", "timeupdate", "play", "pause", "ended", "volumechange"].forEach((eventName) => {
      video.addEventListener(eventName, () => syncOutputPlayer(player));
    });
    syncOutputPlayer(player);
  });
}

function sceneInputCard(scene) {
  if (!scene) return `<div class="ps-asset-slot empty"><b>未选择场景图</b><span>请先生成并选择当前角度</span></div>`;
  return `<div class="ps-asset-slot ps-scene-input"><img src="${escapeHtml(scene.previewUrl)}" alt="${escapeHtml(scene.label)}" /><span><b>${escapeHtml(scene.label)}</b><em>${escapeHtml(scene.imageModelLabel || state.candidateJob?.imageModelLabel || imageModelLabel())}</em></span></div>`;
}

function laneOutputRenderKey(lane, angleLabel) {
  return JSON.stringify({
    angleLabel,
    outputUrl: lane.outputUrl || "",
    downloadUrl: lane.downloadUrl || "",
    error: lane.error || "",
    jobId: lane.jobId || "",
    model: lane.model || lane.videoModelId || ""
  });
}

function outputVideoCard(lane, angleLabel) {
  const model = String(lane.model || selectedVideoModel(lane.videoModelId, lane.duration).label).trim();
  if (lane.outputUrl) return `<div class="ps-preview-stage ready ps-output-card-ready">
    <div class="ps-output-player" data-output-player>
      <div class="ps-output-media"><video src="${escapeHtml(lane.outputUrl)}" playsinline preload="metadata"></video></div>
      <div class="ps-output-controls">
        <button data-output-toggle type="button" aria-label="播放${escapeHtml(angleLabel)}产展视频">▶</button>
        <span data-output-time>0:00 / --:--</span>
        <input data-output-progress type="range" min="0" max="1000" value="0" aria-label="${escapeHtml(angleLabel)}产展视频播放进度" />
        <button data-output-mute type="button" aria-label="静音">🔊</button>
        <button data-output-expand type="button" data-output-url="${escapeHtml(lane.outputUrl)}" data-output-title="${escapeHtml(angleLabel)}产展视频" aria-label="放大播放${escapeHtml(angleLabel)}产展视频">⛶</button>
      </div>
    </div>
    <footer class="ps-output-card-footer"><b>${escapeHtml(angleLabel)}角度产展视频</b>${lane.downloadUrl ? `<a class="ps-watermark-free-download" href="${escapeHtml(lane.downloadUrl)}">下载成片</a>` : ""}</footer>
  </div>`;
  if (lane.error) return `<div class="ps-preview-stage failed"><span class="ps-preview-icon" aria-hidden="true">!</span><b>生成未完成</b><span>${escapeHtml(lane.error)}</span></div>`;
  if (lane.jobId) return `<div class="ps-preview-stage generating"><span class="ps-preview-icon" aria-hidden="true">•••</span><b>视频生成中…</b><span>${escapeHtml(model)} 正在处理</span></div>`;
  return `<div class="ps-preview-stage empty"><span class="ps-preview-icon" aria-hidden="true">▶</span><b>等待生成</b><span>9:16</span></div>`;
}

function normalizeDeviceDailyCanvasUrl(value) {
  const source = String(value || "").trim();
  if (!source) return "";
  try {
    const url = new URL(source, window.location.href);
    if (url.hostname === "www.liblib.tv" && url.pathname.replace(/\/+$/, "") === "/canvas" && url.searchParams.has("projectId")) {
      return url.toString();
    }
  } catch {}
  return source;
}

function laneCanvasLink(lane) {
  const canvasUrl = normalizeDeviceDailyCanvasUrl(lane.canvasUrl || "");
  const canvasName = String(lane.canvasName || "").trim();
  const accountName = String(state.dailyCanvas?.accountDisplayName || "").trim();
  if (!canvasUrl) {
    return lane.jobId
      ? `<div class="ps-canvas-link pending"><span><b>LibTV 视频画布准备中</b><small>取得地址后可查看最终提示词</small></span><i>•••</i></div>`
      : "";
  }
  return `<a class="ps-canvas-link" href="${escapeHtml(canvasUrl)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(canvasUrl)}">
    <span><b>打开 LibTV 视频画布</b><small>${escapeHtml(accountName ? `${canvasName || canvasUrl} · 网页端请切换到${accountName}` : (canvasName || canvasUrl))}</small></span><i aria-hidden="true">↗</i>
  </a>`;
}

function laneVideoPrompt(lane) {
  const prompt = String(lane.videoPrompt || "").trim();
  if (!prompt) {
    return lane.jobId
      ? `<div class="ps-video-node-prompt pending"><span><b>视频节点提示词准备中</b><small>任务提交到 LibTV 后将在这里显示最终提示词</small></span><i>•••</i></div>`
      : "";
  }
  const nodeName = String(lane.videoNodeName || "").trim();
  return `<details class="ps-video-node-prompt">
    <summary><span><b>查看视频节点提示词</b><small>${escapeHtml(nodeName || "与 LibTV 视频节点最终输入完全一致")}</small></span><i aria-hidden="true">展开</i></summary>
    <pre>${escapeHtml(prompt)}</pre>
  </details>`;
}

function customCreativeBusy() {
  const custom = state.customCreative;
  return Boolean(["queued", "preparing", "running"].includes(custom.jobStatus)
    || (custom.jobId && !["success", "partial", "failed"].includes(custom.jobStatus)));
}

function updatePreflightCheck(selector, ready, text) {
  const element = $(selector);
  if (!element) return;
  element.classList.toggle("ready", Boolean(ready));
  element.innerHTML = `<i>${ready ? "✓" : "•"}</i>${escapeHtml(text)}`;
}

function customCreativeOutputCard() {
  const custom = state.customCreative;
  const model = String(custom.model || selectedVideoModel(custom.videoModelId, custom.duration).label).trim();
  if (custom.outputUrl) return `<div class="ps-output-slot ready ps-custom-output-ready">
    <video src="${escapeHtml(custom.outputUrl)}" controls preload="metadata"></video>
    <span><b>自定义创意视频</b><em>${Number(custom.duration || 4)}秒 · ${escapeHtml(model)}</em></span>
    <a class="ps-watermark-free-download" href="${escapeHtml(custom.downloadUrl)}">下载无水印成片</a>
  </div>`;
  if (custom.error) return `<div class="ps-output-slot failed"><b>生成未完成</b><span>${escapeHtml(custom.error)}</span></div>`;
  if (customCreativeBusy()) return `<div class="ps-output-slot generating"><b>创意视频生成中…</b><span>LibTV · ${escapeHtml(model)} 正在处理</span></div>`;
  return `<div class="ps-output-slot empty"><b>创意视频输出</b><span>场景图、碎镜头和提示词准备完成后即可生成</span></div>`;
}

function renderCustomCreative() {
  if (!$("#customCreativePanel")) return;
  const custom = state.customCreative;
  const productAssets = selectedProductAssets(custom);
  const fragmentAssets = selectedFragmentAssets(custom);
  const totalFragmentDuration = fragmentAssets.reduce((sum, asset) => sum + fragmentDuration(asset), 0);
  custom.duration = normalizedVideoDuration(custom.duration, custom.videoModelId);
  custom.clarity = selectedVideoClarity(custom.videoModelId, custom.clarity).value;
  const requestedVideoModelId = custom.videoModelId;
  const modelCompatibility = videoModelCompatibility(custom.videoModelId, productAssets.length, totalFragmentDuration, custom.duration, custom.clarity);
  custom.videoModelId = modelCompatibility.model.id;
  if (custom.videoModelId !== requestedVideoModelId) custom.videoGenerationMode = defaultVideoGenerationMode(custom.videoModelId);
  const videoGenerationMode = selectedVideoGenerationMode(custom.videoModelId, custom.videoGenerationMode);
  custom.videoGenerationMode = videoGenerationMode.value;
  custom.videoGenerationModeLabel = videoGenerationMode.label;
  const referenceDurationStatus = seedance25ReferenceDurationStatus(custom.videoModelId, fragmentAssets);
  const modelSelectionReady = modelCompatibility.ok || modelCompatibility.reason === "reference-duration";
  const clarityOption = selectedVideoClarity(custom.videoModelId, custom.clarity);
  const sceneButton = $("#customSceneButton");
  sceneButton.classList.toggle("empty", !custom.scene);
  sceneButton.disabled = customCreativeBusy();
  sceneButton.innerHTML = custom.scene
    ? `<img src="${escapeHtml(custom.scene.previewUrl)}" alt="${escapeHtml(custom.scene.name || "自定义场景图")}" /><span><b>${escapeHtml(custom.scene.name || "自定义场景图")}</b><em>点击更换</em></span>`
    : "<b>＋ 上传场景图</b><span>PNG / JPG，单张不超过10MB</span>";
  $("#customProductSlot").innerHTML = selectedAssetCard(productAssets, "image", CUSTOM_CREATIVE_ANGLE);
  $("#customFragmentSlot").innerHTML = selectedAssetCard(fragmentAssets, "video", CUSTOM_CREATIVE_ANGLE, { referenceDurationStatus });
  $("#customOutputSlot").innerHTML = customCreativeOutputCard();
  bindOutputPlayerControls($("#customOutputSlot"));
  $("#customCreativeCanvasLink").innerHTML = custom.jobId ? laneCanvasLink(custom) : "";
  $("#customCreativeDuration").innerHTML = durationOptions(custom.videoModelId)
    .map((duration) => `<option value="${duration}"${Number(custom.duration || 4) === duration ? " selected" : ""}>${duration}秒</option>`).join("");
  $("#customCreativeDuration").disabled = customCreativeBusy();
  $("#customCreativeDurationHint").textContent = referenceVideoDurationHint(custom, totalFragmentDuration);
  $("#customCreativeClarity").innerHTML = videoClaritySelectOptions(custom.videoModelId, custom.clarity);
  $("#customCreativeClarity").disabled = customCreativeBusy();
  $("#customCreativeVideoModel").innerHTML = videoModelSelectOptions(custom.videoModelId, custom.duration);
  $("#customCreativeVideoModel").disabled = customCreativeBusy();
  $("#customCreativeVideoMode").innerHTML = videoGenerationModeSelectOptions(custom.videoModelId, custom.videoGenerationMode);
  $("#customCreativeVideoMode").disabled = customCreativeBusy();
  $("#customCreativeVideoModelHint").textContent = modelSelectionReady
    ? `${modelCompatibility.model.label} · ${videoGenerationMode.label} · 参考视频 → 场景图${productAssets.length ? ` → ${productAssets.length}张产品图` : " · 未选产品图时沿用碎镜头产品"}`
    : modelCompatibility.message;
  $("#customCreativeVideoModelHint").classList.toggle("error", !modelSelectionReady);
  const promptField = $("#customCreativePrompt");
  if (document.activeElement !== promptField) promptField.value = custom.prompt || "";
  promptField.disabled = customCreativeBusy();
  const fragmentsReady = fragmentAssets.length >= MIN_FRAGMENT_SELECTION;
  const promptReady = Boolean(String(custom.prompt || "").trim());
  const ready = Boolean(selectedProduct() && custom.scene && fragmentsReady && promptReady && modelCompatibility.ok && referenceDurationStatus.ok);
  $("#customProductSelectionBadge").textContent = productAssets.length ? `使用${productAssets.length}张产品白底图` : "未选白底图 · 沿用碎镜头产品";
  updatePreflightCheck("#customSceneCheck", Boolean(custom.scene), custom.scene ? "自定义场景图已上传" : "自定义场景图待上传");
  updatePreflightCheck("#customProductCheck", true, productAssets.length ? `产品白底图已选择（${productAssets.length}/${productSelectionLimit(custom)}）` : "产品白底图未选（将沿用碎镜头产品）");
  updatePreflightCheck("#customFragmentCheck", fragmentsReady, `真实碎镜头已选择（${fragmentAssets.length}/${MAX_FRAGMENT_SELECTION}，至少${MIN_FRAGMENT_SELECTION}条）`);
  updatePreflightCheck("#customPromptCheck", promptReady, `视频备注提示词${promptReady ? "已填写" : "待填写"}`);
  updatePreflightCheck("#customDurationCheck", true, `时长已设置（${Number(custom.duration || 4)}秒）`);
  updatePreflightCheck("#customClarityCheck", true, `清晰度已设置（${clarityOption.label}）`);
  updatePreflightCheck("#customModelCheck", modelSelectionReady, modelSelectionReady ? `${modelCompatibility.model.label} 已选择` : modelCompatibility.message);
  updatePreflightCheck("#customModeCheck", true, `视频生成模式已选择（${videoGenerationMode.label}）`);
  $("#customCreativeSettingSummary").textContent = `LibTV · ${modelCompatibility.model.label} · ${videoGenerationMode.label} · ${Number(custom.duration || 4)}秒 · ${clarityOption.label}${custom.videoModelId === "seedance-2-5" ? "" : " · 9:16"}`;
  const generateButton = $("#generateCustomCreativeButton");
  generateButton.disabled = !ready || customCreativeBusy();
  generateButton.textContent = customCreativeBusy() ? "生成中…" : custom.outputUrl ? "重新生成创意视频" : "生成创意视频";
  notice($("#customCreativeStatus"), custom.status || custom.error, Boolean(custom.error));
  $$('#customCreativeFlow [data-pick-asset]').forEach((button) => button.addEventListener("click", () => openPicker(CUSTOM_CREATIVE_ANGLE, button.dataset.pickAsset)));
  updateWorkflowProgress();
}

function updateLaneGenerationRegion(element, html) {
  if (element && element.innerHTML !== html) element.innerHTML = html;
}

function refreshLaneGenerationUi(angleId) {
  const layout = $("#laneBoard .ps-production-layout");
  if (!layout || layout.dataset.activeAngle !== angleId) return;
  const angle = state.defaults?.angles?.find((item) => item.id === angleId);
  if (!angle) return;
  const lane = laneState(angleId);
  const scene = selectedCandidate(angleId);
  const productAssets = selectedProductAssets(lane);
  const fragmentAssets = selectedFragmentAssets(lane);
  const prompt = String(lane.prompt || "").trim();
  const duration = Number(lane.duration || 4);
  const totalFragmentDuration = fragmentAssets.reduce((sum, asset) => sum + fragmentDuration(asset), 0);
  const modelCompatibility = videoModelCompatibility(lane.videoModelId, productAssets.length, totalFragmentDuration, duration, lane.clarity);
  const referenceDurationStatus = seedance25ReferenceDurationStatus(lane.videoModelId, fragmentAssets);
  const ready = Boolean(scene && fragmentAssets.length >= MIN_FRAGMENT_SELECTION && prompt && modelCompatibility.ok && referenceDurationStatus.ok);
  const busy = Boolean(lane.jobId && !lane.outputUrl && !lane.error);
  const output = layout.querySelector("[data-lane-output]");
  const outputRenderKey = laneOutputRenderKey(lane, angle.label);
  if (output && output.dataset.laneOutputKey !== outputRenderKey) {
    output.innerHTML = outputVideoCard(lane, angle.label);
    output.dataset.laneOutputKey = outputRenderKey;
    bindOutputPlayerControls(output);
  }
  const generateButton = layout.querySelector("[data-generate-angle]");
  if (generateButton) {
    generateButton.disabled = !ready || busy;
    generateButton.textContent = busy ? "生成中…" : lane.outputUrl ? `重新生成${angle.label}视频` : `✦ 生成${angle.label}视频`;
  }
  const progress = layout.querySelector("[data-lane-generation-progress]");
  updateLaneGenerationRegion(progress, `${laneCanvasLink(lane)}
    ${laneVideoPrompt(lane)}
    ${lane.refreshWarning ? `<div class="ps-lane-refresh-warning">${escapeHtml(lane.refreshWarning)}</div>` : ""}
    ${lane.status ? `<div class="ps-lane-status ${lane.error ? "error" : ""}">${escapeHtml(lane.status)}</div>` : ""}`);
}

function videoPromptEditorHasFocus() {
  return Boolean(document.activeElement?.matches?.('#laneBoard [data-video-prompt-angle]'));
}

function renderLanesAfterCandidatePoll() {
  if (videoPromptEditorHasFocus()) {
    state.laneRenderPending = true;
    return;
  }
  state.laneRenderPending = false;
  renderLanes();
}

function renderLanes() {
  const angles = state.defaults?.angles || [];
  const activeImageModelLabel = state.candidateJob?.imageModelLabel || imageModelLabel();
  updateImageModelSummary();
  if (!angles.length) {
    $("#laneBoard").innerHTML = `<div class="ps-production-empty">暂无可用制作角度</div>`;
    return;
  }
  if (!angles.some((angle) => angle.id === state.activeAngleId)) state.activeAngleId = angles[0].id;

  const angle = angles.find((item) => item.id === state.activeAngleId) || angles[0];
  const lane = laneState(angle.id);
  const candidates = candidatesFor(angle.id);
  const successfulCandidates = candidates.filter((candidate) => candidate.status === "success");
  const productAssets = selectedProductAssets(lane);
  const fragmentAssets = selectedFragmentAssets(lane);
  const scene = selectedCandidate(angle.id);
  lane.duration = normalizedVideoDuration(lane.duration, lane.videoModelId);
  lane.clarity = selectedVideoClarity(lane.videoModelId, lane.clarity).value;
  const duration = Number(lane.duration || 4);
  const anglePrompt = String(lane.prompt || "").trim();
  const fragmentsReady = fragmentAssets.length >= MIN_FRAGMENT_SELECTION;
  const totalFragmentDuration = fragmentAssets.reduce((sum, asset) => sum + fragmentDuration(asset), 0);
  const requestedVideoModelId = lane.videoModelId;
  const modelCompatibility = videoModelCompatibility(lane.videoModelId, productAssets.length, totalFragmentDuration, duration, lane.clarity);
  lane.videoModelId = modelCompatibility.model.id;
  if (lane.videoModelId !== requestedVideoModelId) lane.videoGenerationMode = defaultVideoGenerationMode(lane.videoModelId);
  const videoGenerationMode = selectedVideoGenerationMode(lane.videoModelId, lane.videoGenerationMode);
  lane.videoGenerationMode = videoGenerationMode.value;
  lane.videoGenerationModeLabel = videoGenerationMode.label;
  const referenceDurationStatus = seedance25ReferenceDurationStatus(lane.videoModelId, fragmentAssets);
  const modelSelectionReady = modelCompatibility.ok || modelCompatibility.reason === "reference-duration";
  const clarityOption = selectedVideoClarity(lane.videoModelId, lane.clarity);
  const productLimit = productSelectionLimit(lane);
  const ready = Boolean(scene && fragmentsReady && anglePrompt && modelCompatibility.ok && referenceDurationStatus.ok);
  const busy = Boolean(lane.jobId && !lane.outputUrl && !lane.error);
  const sceneDisplay = scene || candidates[0] || null;
  const sceneTabs = candidates.map((candidate) => sceneCandidateTab(candidate, angle.id)).join("");
  const sceneMedia = sceneCandidateStage(sceneDisplay, angle.label, activeImageModelLabel);
  const fragmentCards = fragmentAssets.map((asset, index) => `<article class="ps-shot-card" draggable="true" data-fragment-index="${index}" data-fragment-angle="${escapeHtml(angle.id)}">
    <header><span class="ps-drag-handle" title="拖动排序">⠿</span><b>镜头 ${String(index + 1).padStart(2, "0")}</b><button data-remove-fragment="${escapeHtml(asset.id)}" type="button" aria-label="移除镜头 ${index + 1}">×</button></header>
    <button class="ps-reference-thumbnail video" data-preview-product-asset="${escapeHtml(asset.id)}" type="button" aria-label="查看原视频：${escapeHtml(asset.title)}"><img src="${escapeHtml(asset.thumbnailUrl || asset.previewUrl)}" alt="${escapeHtml(asset.title)}缩略图" loading="lazy" /><i>▶ 查看原视频</i></button>
    <footer title="${escapeHtml(asset.title || `碎镜头 ${index + 1}`)}">${escapeHtml(asset.title || `碎镜头 ${index + 1}`)}</footer>
  </article>`).join("");
  const timeline = fragmentAssets.length
    ? fragmentAssets.map((asset, index) => `<div class="ps-timeline-item"><i>${index + 1}</i><b>镜头 ${String(index + 1).padStart(2, "0")}</b><span>${formatClipDuration(fragmentDuration(asset))}</span></div>`).join('<span class="ps-timeline-arrow">›</span>')
    : `<div class="ps-timeline-empty">选择碎镜头后显示拼接顺序与总时长</div>`;

  $("#laneBoard").innerHTML = `<div class="ps-angle-tabs" role="tablist" aria-label="三路视频制作角度">
    ${angles.map((item, index) => `<button class="${item.id === angle.id ? "active" : ""}" data-angle-tab="${escapeHtml(item.id)}" type="button" role="tab" aria-selected="${item.id === angle.id}"><small>${String(index + 1).padStart(2, "0")}</small>${escapeHtml(item.label)}</button>`).join("")}
  </div>
  <article class="ps-production-layout ps-production-layout-v2" data-active-angle="${escapeHtml(angle.id)}">
    <div class="ps-production-main">
      <div class="ps-lane-flow-scroll"><div class="ps-combine-row ps-lane-flow" aria-label="输入素材与输出预览">
        <section class="ps-flow-unit ps-lane-scene-unit" aria-label="输入 1 · 场景画面">
          <small>输入 1 · 场景画面</small>
          <div class="ps-lane-scene-slot">
            <div class="ps-lane-scene-frame">
              <div class="ps-scene-version-tabs" role="tablist" aria-label="${escapeHtml(angle.label)}场景版本，最新版本优先">${sceneTabs || "<span>等待生成</span>"}</div>
              <div class="ps-scene-version-stage">${sceneMedia}</div>
            </div>
            <footer><span>${successfulCandidates.length ? `已生成 ${successfulCandidates.length} 张` : "等待生成场景"}</span><button data-add-angle="${escapeHtml(angle.id)}" type="button" ${state.candidateJob ? "" : "disabled"}>＋ 追加场景</button></footer>
          </div>
        </section>
        <i class="ps-flow-symbol" aria-hidden="true">＋</i>
        <section class="ps-flow-unit" aria-label="输入 2 · 产品白底图（可选）">
          <small>输入 2 · 产品白底图（可选）</small>
          ${selectedAssetCard(productAssets, "image", angle.id)}
          <p>可不上传；未选择时沿用碎镜头中的产品，最多${productLimit}张</p>
        </section>
        <i class="ps-flow-symbol" aria-hidden="true">＋</i>
        <section class="ps-flow-unit" aria-label="输入 3 · 真实碎镜头">
          <small>输入 3 · 真实碎镜头（至少${MIN_FRAGMENT_SELECTION}条）</small>
          ${selectedAssetCard(fragmentAssets, "video", angle.id, { referenceDurationStatus })}
        </section>
        <i class="ps-flow-symbol ps-flow-arrow" aria-hidden="true">→</i>
        <section class="ps-flow-unit ps-lane-output-unit" aria-label="输出 · ${escapeHtml(angle.label)}视频">
          <small>输出 · ${escapeHtml(angle.label)}视频</small>
          <div class="ps-output-preview" data-lane-output data-lane-output-key="${escapeHtml(laneOutputRenderKey(lane, angle.label))}">${outputVideoCard(lane, angle.label)}</div>
        </section>
      </div></div>

      <details class="ps-fragment-section ps-fragment-details">
        <summary><span>调整碎镜头顺序与查看拼接时间线</span><em>已选 ${fragmentAssets.length}/${MAX_FRAGMENT_SELECTION} 条 · 总时长 ${totalFragmentDuration > 0 ? formatClipDuration(totalFragmentDuration) : "--:--.-"}</em></summary>
        <div class="ps-shot-strip">${fragmentCards}${fragmentAssets.length < MAX_FRAGMENT_SELECTION ? `<button class="ps-add-shot" data-pick-asset="video" data-angle="${escapeHtml(angle.id)}" type="button"><i>＋</i><b>${fragmentAssets.length ? "添加镜头" : "选择碎镜头"}</b><span>至少 ${MIN_FRAGMENT_SELECTION} 条，最多 ${MAX_FRAGMENT_SELECTION} 条</span></button>` : ""}</div>
        <div class="ps-timeline"><div class="ps-timeline-track">${timeline}</div><strong>总时长 ${totalFragmentDuration > 0 ? formatClipDuration(totalFragmentDuration) : "--:--.-"}</strong></div>
      </details>
      <label class="ps-angle-video-prompt">
        <span><b>${escapeHtml(angle.label)}角度视频提示词</b><small>场景图完整提示词作为背景描述共用；此处只填写当前角度的具体动作要求</small></span>
        <textarea data-video-prompt-angle="${escapeHtml(angle.id)}" rows="2" placeholder="如无具体要求请填写“无”，即可点击生成按钮；也可填写画面、动作、镜头或节奏要求。">${escapeHtml(lane.prompt || "")}</textarea>
      </label>
      <section class="ps-generation-settings ps-lane-generation-settings">
        <div class="ps-lane-settings-heading"><div><small>LibTV · 用户选定模型</small><h3>生成设置</h3></div><span>${productAssets.length ? `使用${productAssets.length}张产品白底图` : "未选白底图 · 沿用碎镜头产品"}</span></div>
        <div class="ps-setting-grid">
          <label><span>时长</span><select class="ps-click-select" data-duration-angle="${escapeHtml(angle.id)}" aria-label="时长，${modelCompatibility.model.durationMin}到${modelCompatibility.model.durationMax}秒" title="点击展开列表选择${modelCompatibility.model.durationMin}–${modelCompatibility.model.durationMax}秒">${durationOptions(lane.videoModelId).map((option) => `<option value="${option}"${duration === option ? " selected" : ""}>${option}秒</option>`).join("")}</select><small>${escapeHtml(referenceVideoDurationHint(lane, totalFragmentDuration))}</small></label>
          <label><span>清晰度</span><select class="ps-click-select" data-clarity-angle="${escapeHtml(angle.id)}" aria-label="清晰度" title="点击展开列表选择清晰度">${videoClaritySelectOptions(lane.videoModelId, lane.clarity)}</select></label>
          <label class="ps-video-model-control"><span>视频生成模型</span><select class="ps-click-select" data-video-model-angle="${escapeHtml(angle.id)}" aria-label="视频生成模型" title="点击展开列表选择视频生成模型">${videoModelSelectOptions(lane.videoModelId, duration)}</select><small class="${modelSelectionReady ? "" : "error"}">${escapeHtml(modelSelectionReady ? `${modelCompatibility.model.label} · ${videoGenerationMode.label} 将同步到 LibTV` : modelCompatibility.message)}</small></label>
          <label class="ps-video-mode-control"><span>视频生成模式</span><select class="ps-click-select" data-video-mode-angle="${escapeHtml(angle.id)}" aria-label="视频生成模式" title="点击展开列表选择视频生成模式">${videoGenerationModeSelectOptions(lane.videoModelId, lane.videoGenerationMode)}</select><small>将同步到 LibTV 视频节点</small></label>
        </div>
        <div class="ps-preflight-checks"><b>生成前检查</b>
          <span class="${scene ? "ready" : ""}"><i>${scene ? "✓" : "•"}</i>场景画面已选择</span>
          <span class="ready"><i>✓</i>${productAssets.length ? `产品白底图已选择（${productAssets.length}/${productLimit}）` : "产品白底图未选（将沿用碎镜头产品）"}</span>
          <span class="${fragmentsReady ? "ready" : ""}"><i>${fragmentsReady ? "✓" : "•"}</i>真实碎镜头已选择（${fragmentAssets.length}/${MAX_FRAGMENT_SELECTION}，至少${MIN_FRAGMENT_SELECTION}条）</span>
          <span class="${anglePrompt ? "ready" : ""}" data-angle-prompt-check="${escapeHtml(angle.id)}"><i>${anglePrompt ? "✓" : "•"}</i>${escapeHtml(angle.label)}角度视频提示词${anglePrompt ? "已填写" : "待填写"}</span>
          <span class="ready"><i>✓</i>时长已设置（${duration}秒）</span>
          <span class="ready"><i>✓</i>清晰度已设置（${escapeHtml(clarityOption.label)}）</span>
          <span class="${modelSelectionReady ? "ready" : ""}"><i>${modelSelectionReady ? "✓" : "•"}</i>${escapeHtml(modelSelectionReady ? `${modelCompatibility.model.label} 已选择` : modelCompatibility.message)}</span>
          <span class="ready"><i>✓</i>视频生成模式已选择（${escapeHtml(videoGenerationMode.label)}）</span>
        </div>
        <button class="ps-generate-button" data-generate-angle="${escapeHtml(angle.id)}" type="button" ${ready && !busy ? "" : "disabled"}>${busy ? "生成中…" : lane.outputUrl ? `重新生成${escapeHtml(angle.label)}视频` : `✦ 生成${escapeHtml(angle.label)}视频`}</button>
        <p>LibTV · ${escapeHtml(modelCompatibility.model.label)} · ${escapeHtml(videoGenerationMode.label)} · ${duration}秒 · ${escapeHtml(clarityOption.label)}${lane.videoModelId === "seedance-2-5" ? "" : " · 9:16"}</p>
        <div data-lane-generation-progress>${laneCanvasLink(lane)}
          ${laneVideoPrompt(lane)}
          ${lane.refreshWarning ? `<div class="ps-lane-refresh-warning">${escapeHtml(lane.refreshWarning)}</div>` : ""}
          ${lane.status ? `<div class="ps-lane-status ${lane.error ? "error" : ""}">${escapeHtml(lane.status)}</div>` : ""}</div>
      </section>
    </div>
  </article>`;

  bindOutputPlayerControls($("#laneBoard"));
  updateWorkflowProgress();

  $$('#laneBoard [data-angle-tab]').forEach((button) => button.addEventListener("click", () => {
    state.activeAngleId = button.dataset.angleTab;
    renderLanes();
  }));
  $$('#laneBoard [data-scene-id]').forEach((button) => button.addEventListener("click", () => {
    const angleId = button.dataset.sceneAngle;
    state.selectedCandidates[angleId] = button.dataset.sceneId;
    resetLaneGeneration(laneState(angleId));
    renderLanes();
  }));
  $$('#laneBoard [data-add-angle]').forEach((button) => button.addEventListener("click", () => appendCandidate(button.dataset.addAngle)));
  $$('#laneBoard [data-pick-asset]').forEach((button) => button.addEventListener("click", () => openPicker(button.dataset.angle, button.dataset.pickAsset)));
  $$('#laneBoard [data-duration-angle]').forEach((select) => select.addEventListener("change", async () => {
    const selectedLane = laneState(select.dataset.durationAngle);
    selectedLane.duration = Number(select.value);
    selectedLane.durationManuallyEdited = true;
    selectedLane.durationAutoFilled = false;
    resetLaneGeneration(selectedLane);
    renderLanes();
    await refreshVideoModelAvailability(selectedLane.duration, { clarity: selectedLane.clarity }).catch(() => []);
    renderLanes();
    saveProductTaskState();
  }));
  $$('#laneBoard [data-clarity-angle]').forEach((select) => select.addEventListener("change", async () => {
    const selectedLane = laneState(select.dataset.clarityAngle);
    selectedLane.clarity = select.value;
    resetLaneGeneration(selectedLane);
    renderLanes();
    await refreshVideoModelAvailability(selectedLane.duration, { force: true, clarity: selectedLane.clarity }).catch(() => []);
    renderLanes();
    saveProductTaskState();
  }));
  $$('#laneBoard [data-video-model-angle]').forEach((select) => select.addEventListener("change", async () => {
    const selectedLane = laneState(select.dataset.videoModelAngle);
    selectedLane.videoModelId = select.value;
    selectedLane.duration = normalizedVideoDuration(selectedLane.duration, selectedLane.videoModelId);
    selectedLane.clarity = selectedVideoClarity(selectedLane.videoModelId, selectedLane.clarity).value;
    autoFillReferenceVideoDuration(selectedLane);
    selectedLane.videoGenerationMode = defaultVideoGenerationMode(selectedLane.videoModelId);
    selectedLane.videoGenerationModeLabel = selectedVideoGenerationMode(selectedLane.videoModelId, selectedLane.videoGenerationMode).label;
    selectedLane.model = selectedVideoModel(select.value, selectedLane.duration).label;
    resetLaneGeneration(selectedLane);
    renderLanes();
    await refreshVideoModelAvailability(selectedLane.duration, { force: true, clarity: selectedLane.clarity }).catch(() => []);
    renderLanes();
    saveProductTaskState();
  }));
  $$('#laneBoard [data-video-mode-angle]').forEach((select) => select.addEventListener("change", () => {
    const selectedLane = laneState(select.dataset.videoModeAngle);
    const nextMode = selectedVideoGenerationMode(selectedLane.videoModelId, select.value);
    selectedLane.videoGenerationMode = nextMode.value;
    selectedLane.videoGenerationModeLabel = nextMode.label;
    resetLaneGeneration(selectedLane);
    renderLanes();
    saveProductTaskState();
  }));
  $$('#laneBoard [data-video-prompt-angle]').forEach((textarea) => textarea.addEventListener("input", () => {
    const selectedLane = laneState(textarea.dataset.videoPromptAngle);
    selectedLane.prompt = textarea.value;
    const promptCheck = $('#laneBoard [data-angle-prompt-check]');
    if (promptCheck) {
      const filled = Boolean(textarea.value.trim());
      promptCheck.classList.toggle("ready", filled);
      promptCheck.innerHTML = `<i>${filled ? "✓" : "•"}</i>${escapeHtml(angle.label)}角度视频提示词${filled ? "已填写" : "待填写"}`;
    }
    const generateButton = $('#laneBoard [data-generate-angle]');
    if (generateButton) {
      const selectedScene = selectedCandidate(textarea.dataset.videoPromptAngle);
      const selectedFragments = selectedFragmentAssets(selectedLane);
      generateButton.disabled = !(selectedScene && selectedFragments.length >= MIN_FRAGMENT_SELECTION && textarea.value.trim());
    }
    saveProductTaskState();
  }));
  $$('#laneBoard [data-video-prompt-angle]').forEach((textarea) => textarea.addEventListener("blur", () => {
    if (!state.laneRenderPending) return;
    requestAnimationFrame(() => {
      if (videoPromptEditorHasFocus()) return;
      state.laneRenderPending = false;
      renderLanes();
    });
  }));
  $$('#laneBoard [data-generate-angle]').forEach((button) => button.addEventListener("click", () => generateLaneVideo(button.dataset.generateAngle)));
  $$('#laneBoard [data-remove-fragment]').forEach((button) => button.addEventListener("click", () => {
    const selectedLane = laneState(angle.id);
    selectedLane.fragmentAssetIds = selectedFragmentIds(selectedLane).filter((id) => id !== button.dataset.removeFragment);
    autoFillReferenceVideoDuration(selectedLane);
    resetLaneGeneration(selectedLane);
    renderLanes();
  }));
  $$('#laneBoard [data-remove-product]').forEach((button) => button.addEventListener("click", () => {
    const selectedLane = laneState(angle.id);
    selectedLane.productAssetIds = selectedProductIds(selectedLane).filter((id) => id !== button.dataset.removeProduct);
    selectedLane.productAssetId = selectedLane.productAssetIds[0] || "";
    resetLaneGeneration(selectedLane);
    renderLanes();
  }));
  $$('#laneBoard [data-fragment-index]').forEach((card) => {
    card.addEventListener("dragstart", () => {
      state.draggedFragment = { angleId: card.dataset.fragmentAngle, index: Number(card.dataset.fragmentIndex) };
      card.classList.add("dragging");
    });
    card.addEventListener("dragover", (event) => event.preventDefault());
    card.addEventListener("drop", (event) => {
      event.preventDefault();
      const dragged = state.draggedFragment;
      const targetIndex = Number(card.dataset.fragmentIndex);
      if (!dragged || dragged.angleId !== angle.id || dragged.index === targetIndex) return;
      const selectedLane = laneState(angle.id);
      const ids = selectedFragmentIds(selectedLane);
      const [moved] = ids.splice(dragged.index, 1);
      ids.splice(targetIndex, 0, moved);
      selectedLane.fragmentAssetIds = ids;
      state.draggedFragment = null;
      resetLaneGeneration(selectedLane);
      renderLanes();
    });
    card.addEventListener("dragend", () => {
      state.draggedFragment = null;
      card.classList.remove("dragging");
    });
  });
}

async function createCandidateJob() {
  if (!state.reference || !state.promptConfirmed) return notice($("#taskStatus"), "请先上传参考图并确认提示词。", true);
  const imageModel = selectedImageModel();
  const modelLabel = imageModelLabel(imageModel);
  const draftJobId = state.candidateJob?.status === "draft" ? state.candidateJob.id : "";
  clearTimeout(productDraftSyncTimer);
  productDraftSyncPending = null;
  $("#confirmPromptButton").disabled = true;
  $("#candidateStatus").textContent = "正在提交生成任务";
  notice($("#taskStatus"), `已提交 ${modelLabel} 任务：先生成1K平拍母图，再以母图为一致性参考并发生成俯拍与特写。旧版本不会被覆盖。`);
  try {
    const result = await api("./api/product-workflows/image-candidates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        draftJobId,
        referenceImagePath: state.reference.path,
        referenceImageName: state.reference.name,
        prompt: $("#scenePrompt").value.trim(),
        promptModel: "qwen3.7-plus",
        taskChannel: "standard",
        imageModel,
        resolution: "1K"
      })
    });
    state.candidateJob = result.job;
    state.selectedCandidates = {};
    state.pendingCandidateSelection = {};
    localStorage.setItem(PRODUCT_ACTIVE_TASK_KEY, result.job.id);
    saveProductTaskState();
    window.dispatchEvent(new Event("module-task-updated"));
    renderLanes();
    startCandidatePolling();
  } catch (error) {
    state.promptConfirmed = false;
    $("#candidateStatus").textContent = "生成任务提交失败";
    notice($("#taskStatus"), error.message, true);
    updatePromptState();
    saveProductTaskState();
  }
}

async function appendCandidate(angle) {
  if (!state.candidateJob) return;
  const imageModel = selectedImageModel();
  const modelLabel = imageModelLabel(imageModel);
  const existingIds = new Set(candidatesFor(angle).map((candidate) => candidate.id));
  try {
    notice($("#taskStatus"), `正在使用 ${modelLabel} 追加场景，本次沿用已确认的 Qwen 图片分析提示词。`);
    const result = await api(`./api/product-workflows/image-candidates/${state.candidateJob.id}/append`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        angle,
        prompt: $("#scenePrompt").value.trim(),
        imageModel,
        anchorCandidateId: angle === "flat" ? "" : (state.selectedCandidates.flat || "")
      })
    });
    state.candidateJob = result.job;
    const appended = candidatesFor(angle).find((candidate) => !existingIds.has(candidate.id));
    if (appended) state.pendingCandidateSelection[angle] = appended.id;
    renderLanes();
    startCandidatePolling();
  } catch (error) {
    notice($("#taskStatus"), error.message, true);
  }
}

function startCandidatePolling() {
  clearInterval(state.polling);
  const poll = async () => {
    try {
      const result = await api(`./api/product-workflows/image-candidates/${state.candidateJob.id}`);
      state.candidateJob = result.job;
      const generating = result.job.candidates.some((item) => item.status === "generating");
      for (const angle of state.defaults.angles) {
        const pendingId = state.pendingCandidateSelection[angle.id];
        const pendingCandidate = pendingId ? candidatesFor(angle.id).find((item) => item.id === pendingId) : null;
        if (pendingCandidate?.status === "success") {
          state.selectedCandidates[angle.id] = pendingCandidate.id;
          delete state.pendingCandidateSelection[angle.id];
        } else if (pendingCandidate?.status === "failed") {
          delete state.pendingCandidateSelection[angle.id];
        }
        if (!state.selectedCandidates[angle.id]) {
          const first = candidatesFor(angle.id).find((item) => item.status === "success");
          if (first) state.selectedCandidates[angle.id] = first.id;
        }
      }
      const stage = result.job.generationStage || "";
      const generatingCandidates = result.job.candidates.filter((item) => item.status === "generating");
      const generatingLabels = generatingCandidates.map((item) => item.angleLabel).filter(Boolean);
      $("#candidateStatus").textContent = generating
        ? (generatingCandidates.length > 1
            ? `${generatingLabels.join("与")}并发生成中`
            : generatingCandidates[0]?.angle === "flat"
              ? "平拍母图生成中"
              : `${generatingLabels[0] || "空场景"}生成中`)
        : result.job.status === "ready"
          ? "3个一致性机位已完成"
          : stage === "sibling_angles" && result.job.candidates.length < 3
            ? "正在准备一致性参考"
            : "部分生成失败";
      renderLanesAfterCandidatePoll();
      saveProductTaskState();
      if (!generating && result.job.candidates.length >= 3) {
        clearInterval(state.polling);
        updatePromptState();
        notice($("#taskStatus"), result.job.status === "ready" ? "3个无产品空场景已生成。现在为每条支路选择白底产品图和真实碎镜头。" : "部分空场景生成失败，可点击对应角度的“追加场景”重试。", result.job.status !== "ready");
      }
    } catch (error) {
      clearInterval(state.polling);
      notice($("#taskStatus"), error.message, true);
    }
  };
  poll();
  state.polling = setInterval(poll, 2500);
}

async function loadAssets(type = state.activeAssetTab) {
  const product = selectedProduct();
  if (!product) {
    state.assetsByType[type] = [];
    renderLibrary();
    renderLanes();
    renderCustomCreative();
    return;
  }
  const data = await api(`./api/product-workflows/assets?assetType=${encodeURIComponent(type)}&productId=${encodeURIComponent(product.id)}`);
  state.assetsByType[type] = data.items || [];
  if (data.sharedMessage) notice($("#uploadStatus"), data.sharedMessage, false);
  renderLibrary();
  renderLanes();
  renderCustomCreative();
}

function assetMedia(asset, controls = false) {
  return `<span class="ps-thumbnail-media${asset.assetType === "video" ? " video" : ""}"><img src="${escapeHtml(asset.thumbnailUrl || asset.previewUrl)}" alt="${escapeHtml(asset.title)}缩略图" loading="lazy" />${asset.assetType === "video" ? "<i>▶</i>" : ""}</span>`;
}

function fingerprintDistance(left, right) {
  if (!left || !right || left.length !== right.length) return Number.POSITIVE_INFINITY;
  let distance = 0;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) distance += 1;
  }
  return distance;
}

async function imageVisualFingerprint(asset) {
  const cacheKey = `${asset.id}:${asset.sha256 || asset.updatedAt || asset.previewUrl}`;
  if (state.visualFingerprints.has(cacheKey)) return state.visualFingerprints.get(cacheKey);
  const response = await fetch(asset.thumbnailUrl || asset.previewUrl, { credentials: "same-origin" });
  if (!response.ok) throw new Error(`缩略图读取失败（${response.status}）`);
  const bitmap = await createImageBitmap(await response.blob());
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 9;
    canvas.height = 8;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.drawImage(bitmap, 0, 0, 9, 8);
    const pixels = context.getImageData(0, 0, 9, 8).data;
    const gray = [];
    for (let index = 0; index < pixels.length; index += 4) {
      gray.push(Math.round((pixels[index] * 299 + pixels[index + 1] * 587 + pixels[index + 2] * 114) / 1000));
    }
    let hash = "";
    for (let row = 0; row < 8; row += 1) {
      for (let column = 0; column < 8; column += 1) {
        hash += gray[row * 9 + column] > gray[row * 9 + column + 1] ? "1" : "0";
      }
    }
    const fingerprint = { hash, ratio: bitmap.width / Math.max(1, bitmap.height) };
    state.visualFingerprints.set(cacheKey, fingerprint);
    return fingerprint;
  } finally {
    bitmap.close?.();
  }
}

function applyVisualSimilarityBadges() {
  $$('[data-library-asset-id]').forEach((card) => {
    card.querySelectorAll(".ps-asset-similarity-badge").forEach((badge) => badge.remove());
    const similar = state.visualSimilarityByAssetId.get(card.dataset.libraryAssetId);
    if (!similar || card.dataset.exactDuplicate === "true") return;
    const badge = document.createElement("span");
    badge.className = "ps-asset-similarity-badge";
    badge.textContent = "画面可能相似";
    badge.title = `与“${similar.title}”画面可能相似，仅提示并保留两张图片，请人工确认`;
    card.append(badge);
  });
}

function updateAssetAuditNotice(assets) {
  const exactCount = assets.filter((asset) => asset.exactDuplicate === true).length;
  const similarCount = [...state.visualSimilarityByAssetId.keys()]
    .filter((assetId) => assets.some((asset) => asset.id === assetId && asset.exactDuplicate !== true)).length;
  const messages = [];
  if (exactCount) messages.push(`检测到 ${exactCount} 条完全重复资产；点击对应卡片右上角“×”并确认后，仅清理重复的 OSS 记录`);
  if (similarCount) messages.push(`${similarCount} 张图片画面可能相似，仅提示，不会自动删除`);
  notice($("#assetAuditStatus"), messages.join("；"), false);
}

async function analyzeVisualSimilarities(assets, runId) {
  const images = assets.filter((asset) => asset.assetType === "image" && asset.previewUrl);
  const fingerprints = [];
  let cursor = 0;
  const worker = async () => {
    while (cursor < images.length) {
      const asset = images[cursor];
      cursor += 1;
      try {
        fingerprints.push({ asset, fingerprint: await imageVisualFingerprint(asset) });
      } catch {
        // A missing or cross-origin thumbnail must not block the asset library.
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, Math.max(1, images.length)) }, () => worker()));
  if (runId !== state.visualSimilarityRun) return;
  const similar = new Map();
  for (let leftIndex = 0; leftIndex < fingerprints.length; leftIndex += 1) {
    const left = fingerprints[leftIndex];
    if (left.asset.exactDuplicate === true) continue;
    for (let rightIndex = leftIndex + 1; rightIndex < fingerprints.length; rightIndex += 1) {
      const right = fingerprints[rightIndex];
      if (right.asset.exactDuplicate === true) continue;
      if (left.asset.sha256 && right.asset.sha256 && left.asset.sha256 === right.asset.sha256) continue;
      if (Math.abs(left.fingerprint.ratio - right.fingerprint.ratio) > 0.08) continue;
      if (fingerprintDistance(left.fingerprint.hash, right.fingerprint.hash) > 5) continue;
      if (!similar.has(left.asset.id)) similar.set(left.asset.id, { id: right.asset.id, title: right.asset.title });
      if (!similar.has(right.asset.id)) similar.set(right.asset.id, { id: left.asset.id, title: left.asset.title });
    }
  }
  state.visualSimilarityByAssetId = similar;
  applyVisualSimilarityBadges();
  updateAssetAuditNotice(assets);
}

function scheduleVisualSimilarityAnalysis(assets) {
  const runId = ++state.visualSimilarityRun;
  state.visualSimilarityByAssetId = new Map();
  if (state.activeAssetTab !== "image") {
    updateAssetAuditNotice(assets);
    return;
  }
  Promise.resolve().then(() => analyzeVisualSimilarities(assets, runId)).catch(() => {});
}

function renderLibrary() {
  const assets = aiShowcaseVisibleAssets(state.activeAssetTab);
  $("#assetCount").textContent = `${assets.length} ${state.activeAssetTab === "video" ? "条" : "张"}${assets.length > 20 ? " · 首屏20项" : ""}`;
  $("#assetEmpty").hidden = assets.length > 0;
  $("#assetGrid").innerHTML = assets.map((asset) => `<article class="ps-library-card${asset.exactDuplicate ? " exact-duplicate" : ""}" data-library-asset-id="${escapeHtml(asset.id)}" data-exact-duplicate="${asset.exactDuplicate === true}">
    ${asset.readOnly ? "" : `<button class="ps-asset-delete" data-delete-asset="${escapeHtml(asset.id)}" type="button" title="删除素材" aria-label="删除素材：${escapeHtml(asset.title)}">×</button>`}
    ${asset.exactDuplicate ? `<span class="ps-asset-duplicate-badge" title="与“${escapeHtml(asset.exactDuplicateTitle || "已有资产")}”文件完全相同；确认后可清理本条 OSS 记录">完全重复</span>` : ""}
    ${assetMedia(asset, true)}
    <div><b>${escapeHtml(asset.title)}</b><small>${escapeHtml(asset.productName || "未关联SKU")} · ${asset.source === "workspace_product_catalog" ? "工作台共用" : (asset.storageStatus === "stored" ? "部门共享" : "工作台资产")}</small></div>
  </article>`).join("");
  $$('[data-delete-asset]').forEach((button) => button.addEventListener("click", () => deleteLibraryAsset(button.dataset.deleteAsset)));
  const isVideo = state.activeAssetTab === "video";
  $("#assetFileInput").accept = isVideo ? "video/mp4,video/quicktime" : "image/png,image/jpeg";
  $("#assetFileInput").multiple = true;
  $("#assetUploadTitle").textContent = isVideo ? "上传真实产展碎镜头" : "上传白底产品图";
  $("#assetUploadHint").textContent = isVideo ? "MP4 / MOV，一次最多12条，单条不超过500MB；将按顺序上传" : "PNG / JPG，单张不超过10MB；同一SKU可保存多张";
  updateAssetAuditNotice(assets);
  scheduleVisualSimilarityAnalysis(assets);
  updateProductHint();
}

function renderAssetUploadQueue() {
  const queue = $("#assetUploadQueue");
  const items = state.assetUploadQueue;
  queue.hidden = items.length === 0;
  if (!items.length) {
    queue.innerHTML = "";
    return;
  }
  const completed = items.filter((item) => item.status === "success" || item.status === "failed").length;
  const success = items.filter((item) => item.status === "success").length;
  const failed = items.filter((item) => item.status === "failed").length;
  const statusLabel = { pending: "等待上传", uploading: "上传中", success: "成功", failed: "失败" };
  const statusIcon = { pending: "·", uploading: "…", success: "✓", failed: "×" };
  queue.innerHTML = `<header><b>上传明细</b><span>${completed}/${items.length} 完成 · ${success} 成功${failed ? ` · ${failed} 失败` : ""}</span></header>
    <div class="ps-upload-queue-list" role="list">${items.map((item) => `<article class="${escapeHtml(item.status)}" role="listitem">
      <i aria-hidden="true">${statusIcon[item.status] || "·"}</i>
      <div><b title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</b><span>${escapeHtml(item.detail || "等待按顺序上传")}</span></div>
      <em>${statusLabel[item.status] || "等待上传"}</em>
    </article>`).join("")}</div>`;
}

function updateAssetUploadQueueItem(index, patch) {
  Object.assign(state.assetUploadQueue[index], patch);
  renderAssetUploadQueue();
}

async function deleteLibraryAsset(assetId) {
  const asset = assetById(assetId);
  if (!asset) return;
  const confirmed = window.confirm(asset.exactDuplicate
    ? `“${asset.title}”与“${asset.exactDuplicateTitle || "已有资产"}”文件完全相同。\n确认后只清理本条重复的 OSS 共享记录，保留另一条标准资产。该操作无法恢复。`
    : `确定删除“${asset.title}”吗？\n删除后将从当前 SKU 资产库和 OSS 中移除，无法恢复。`);
  if (!confirmed) return;
  $$('[data-delete-asset]').forEach((button) => { button.disabled = true; });
  notice($("#uploadStatus"), `正在删除 ${asset.title}…`);
  try {
    await api(`./api/product-workflows/assets/${encodeURIComponent(asset.id)}`, { method: "DELETE" });
    state.assetsByType[asset.assetType] = state.assetsByType[asset.assetType].filter((item) => item.id !== asset.id);
    Object.values(state.lanes).forEach((lane) => {
      if (lane.productAssetId === asset.id) lane.productAssetId = "";
      lane.productAssetIds = selectedProductIds(lane).filter((item) => item !== asset.id);
      lane.productAssetId = lane.productAssetIds[0] || "";
      lane.fragmentAssetIds = selectedFragmentIds(lane).filter((item) => item !== asset.id);
      autoFillReferenceVideoDuration(lane);
    });
    state.customCreative.productAssetIds = selectedProductIds(state.customCreative).filter((item) => item !== asset.id);
    state.customCreative.productAssetId = state.customCreative.productAssetIds[0] || "";
    state.customCreative.fragmentAssetIds = selectedFragmentIds(state.customCreative).filter((item) => item !== asset.id);
    autoFillReferenceVideoDuration(state.customCreative);
    renderLibrary();
    renderLanes();
    renderCustomCreative();
    notice($("#uploadStatus"), `${asset.title} 已从资产库和 OSS 中删除。`);
  } catch (error) {
    $$('[data-delete-asset]').forEach((button) => { button.disabled = false; });
    notice($("#uploadStatus"), error.message, true);
  }
}

function skuSourceLabel(source) {
  return ({ "built-in": "内置SKU", plugin: "产品插件", pending: "待补SKU", custom: "自定义SKU" })[source] || "产品SKU";
}

function managedSku() {
  return state.skuProducts.find((product) => product.id === state.managingSkuId) || null;
}

function focusSkuNameEditor() {
  window.requestAnimationFrame(() => {
    const input = $("#skuNameInput");
    if (!input || input.hidden || $("#skuEditorFields").hidden) return;
    input.focus();
    input.select();
  });
}

function selectManagedSku(productId, focusName = false) {
  state.creatingSku = false;
  state.managingSkuId = productId;
  renderSkuManager();
  if (focusName) focusSkuNameEditor();
}

function renderSkuManager() {
  $("#skuManagerList").innerHTML = state.skuProducts.map((product) => `<button class="ps-sku-list-item${!state.creatingSku && product.id === state.managingSkuId ? " active" : ""}" data-manage-sku="${escapeHtml(product.id)}" type="button" title="单击查看；双击修改SKU名称">
    <b>${escapeHtml(product.name)}</b>
    <span><small>${escapeHtml(skuSourceLabel(product.source))} · ${product.imageCount}张/${product.videoCount}条</small>${product.status === "inactive" ? "<em>已停用</em>" : ""}</span>
  </button>`).join("");
  $$('[data-manage-sku]').forEach((button) => button.addEventListener("click", () => {
    selectManagedSku(button.dataset.manageSku);
  }));
  $$('[data-manage-sku]').forEach((button) => button.addEventListener("dblclick", () => selectManagedSku(button.dataset.manageSku, true)));

  const product = state.creatingSku ? {
    id: `custom-sku-${Date.now().toString(36)}`,
    name: "",
    shortName: "",
    category: "",
    status: "active",
    assetStatus: "pending",
    source: "custom",
    imageCount: 0,
    videoCount: 0
  } : managedSku();
  $("#skuEditorEmpty").hidden = Boolean(product);
  $("#skuEditorFields").hidden = !product;
  if (!product) return;
  $("#skuEditorSource").textContent = skuSourceLabel(product.source);
  $("#skuEditorTitle").textContent = state.creatingSku ? "新增SKU" : product.name;
  $("#skuEditorAssetCount").textContent = `${product.imageCount || 0}张图片 · ${product.videoCount || 0}条碎镜头`;
  $("#skuIdInput").value = product.id;
  $("#skuNameInput").value = product.name || "";
  $("#skuShortNameInput").value = product.shortName || "";
  $("#skuCategoryInput").value = product.category === "pending" ? "" : (product.category || "");
  $("#skuStatusSelect").value = product.status || "active";
  $("#skuAssetStatusSelect").value = product.assetStatus || "ready";
  const assetCount = Number(product.imageCount || 0) + Number(product.videoCount || 0);
  const deletable = product.source === "custom" && assetCount === 0;
  $("#deleteSkuButton").hidden = state.creatingSku;
  $("#deleteSkuButton").disabled = !deletable;
  $("#deleteSkuButton").textContent = product.source !== "custom"
    ? "系统SKU不可删除"
    : assetCount > 0
      ? "含资产SKU不可删除"
      : "删除空的自建SKU";
  $("#deleteSkuButton").title = deletable ? "仅删除没有任何素材的自建SKU" : "请使用停用状态保留SKU及OSS素材";
  $("#restoreSkuNameButton").hidden = state.creatingSku || !product.previousName;
  $("#restoreSkuNameButton").textContent = product.previousName ? `恢复“${product.previousName}”` : "恢复上次名称";
  notice($("#skuManagerStatus"), "");
}

async function loadSkuProducts() {
  const result = await api("./api/product-workflows/products");
  state.skuProducts = result.items || [];
  if (!state.creatingSku && !state.skuProducts.some((product) => product.id === state.managingSkuId)) {
    state.managingSkuId = state.skuProducts[0]?.id || "";
  }
  renderSkuManager();
}

async function refreshProductCatalog(preferredProductId = "") {
  state.defaults = await api("./api/product-workflows/defaults");
  renderDefaults(preferredProductId);
  Object.values(state.lanes).forEach((lane) => clearInterval(lane.polling));
  state.lanes = {};
  await Promise.all([loadAssets("image"), loadAssets("video")]);
  renderLibrary();
}

async function openSkuManager(options = {}) {
  state.creatingSku = false;
  state.managingSkuId = options.productId || selectedProduct()?.id || "";
  await loadSkuProducts();
  $("#skuManagerDialog").showModal();
  if (options.focusName) focusSkuNameEditor();
}

async function saveManagedSku(event) {
  event.preventDefault();
  const payload = {
    id: $("#skuIdInput").value,
    name: $("#skuNameInput").value.trim(),
    shortName: $("#skuShortNameInput").value.trim(),
    category: $("#skuCategoryInput").value.trim(),
    status: $("#skuStatusSelect").value,
    assetStatus: $("#skuAssetStatusSelect").value
  };
  if (!payload.name) return notice($("#skuManagerStatus"), "请输入产品名称。", true);
  const previousProduct = managedSku();
  const renamed = !state.creatingSku && Boolean(previousProduct) && previousProduct.name !== payload.name;
  $("#saveSkuButton").disabled = true;
  try {
    const result = state.creatingSku
      ? await api("./api/product-workflows/products", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })
      : await api(`./api/product-workflows/products/${encodeURIComponent(state.managingSkuId)}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    state.creatingSku = false;
    state.managingSkuId = result.product.id;
    await loadSkuProducts();
    await refreshProductCatalog(result.product.status === "active" ? result.product.id : "");
    const syncText = renamed
      ? `SKU名称已更新；已覆盖同步 ${Number(result.syncedAssets || 0)} 条共享资产索引，OSS文件地址未改变。`
      : "SKU已保存并同步到产品列表。";
    notice($("#skuManagerStatus"), result.warnings?.length ? `${syncText} 另有${result.warnings.length}条共享索引同步失败，可再次保存重试。` : syncText, Boolean(result.warnings?.length));
  } catch (error) {
    notice($("#skuManagerStatus"), error.message, true);
  } finally {
    $("#saveSkuButton").disabled = false;
  }
}

async function deleteManagedSku() {
  const product = managedSku();
  if (!product) return;
  if (product.source !== "custom") return notice($("#skuManagerStatus"), "系统内置、产品插件和待补SKU不能删除；请将使用状态改为“停用”。", true);
  if (Number(product.imageCount || 0) + Number(product.videoCount || 0) > 0) {
    return notice($("#skuManagerStatus"), "为保护OSS资产，含图片或碎镜头的SKU不能删除；请将使用状态改为“停用”。", true);
  }
  const confirmed = window.confirm(`删除空的自建SKU“${product.name}”吗？\n该SKU没有关联图片或碎镜头，不会删除任何OSS文件。`);
  if (!confirmed) return;
  $("#deleteSkuButton").disabled = true;
  try {
    await api(`./api/product-workflows/products/${encodeURIComponent(product.id)}`, { method: "DELETE" });
    state.managingSkuId = "";
    await loadSkuProducts();
    await refreshProductCatalog();
    notice($("#skuManagerStatus"), `${product.name}已删除，没有影响任何OSS文件。`);
  } catch (error) {
    notice($("#skuManagerStatus"), error.message, true);
  } finally {
    $("#deleteSkuButton").disabled = false;
  }
}

function restorePreviousSkuName() {
  const product = managedSku();
  if (!product?.previousName) return;
  const confirmed = window.confirm(`将“${product.name}”恢复为上一次名称“${product.previousName}”吗？\n共享资产索引会同步更新，OSS文件地址保持不变。`);
  if (!confirmed) return;
  $("#skuNameInput").value = product.previousName;
  $("#skuManagerForm").requestSubmit();
}

async function uploadAssetInChunks(file, params, onProgress) {
  const uploadId = globalThis.crypto?.randomUUID?.() || `chunk-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const totalChunks = Math.ceil(file.size / PROXY_SAFE_UPLOAD_CHUNK_BYTES);
  let uploaded = {};
  for (let index = 0; index < totalChunks; index += 1) {
    const chunkParams = new URLSearchParams(params);
    chunkParams.set("kind", params.get("kind") || (params.get("assetType") === "video" ? "product-broll-video" : "product-asset-image"));
    chunkParams.set("uploadId", uploadId);
    chunkParams.set("index", String(index));
    chunkParams.set("totalChunks", String(totalChunks));
    chunkParams.set("totalSize", String(file.size));
    const start = index * PROXY_SAFE_UPLOAD_CHUNK_BYTES;
    const body = file.slice(start, Math.min(file.size, start + PROXY_SAFE_UPLOAD_CHUNK_BYTES));
    const response = await fetch(`./api/upload/chunk?${chunkParams}`, { method: "POST", body });
    uploaded = await uploadResponseData(response);
    if (response.status === 401 && uploaded.loginRequired) location.href = "./login.html";
    if (!response.ok) throw new Error(uploaded.error || `分片上传失败（${response.status}）`);
    onProgress?.(Math.round(((index + 1) / totalChunks) * 100));
  }
  return uploaded;
}

async function uploadReferenceImageFile(file, params, onProgress) {
  const response = await fetch(`./api/product-workflows/reference-images/upload?${params}`, { method: "POST", body: file });
  if (response.status === 413) {
    const chunkParams = new URLSearchParams(params);
    chunkParams.set("kind", "product-scene-reference");
    const uploaded = await uploadAssetInChunks(file, chunkParams, onProgress);
    return {
      ok: true,
      reference: {
        name: file.name,
        path: uploaded.path,
        previewUrl: `./api/image?path=${encodeURIComponent(uploaded.path)}`
      }
    };
  }
  const data = await uploadResponseData(response);
  if (response.status === 401 && data.loginRequired) location.href = "./login.html";
  if (!response.ok) throw new Error(data.error || `参考图上传失败（${response.status}）`);
  return data;
}

async function uploadCustomCreativeSceneFile(file, params, onProgress) {
  const response = await fetch(`./api/product-workflows/custom-scenes/upload?${params}`, { method: "POST", body: file });
  if (response.status === 413) {
    const chunkParams = new URLSearchParams(params);
    chunkParams.set("kind", "product-scene-reference");
    const uploaded = await uploadAssetInChunks(file, chunkParams, onProgress);
    return {
      ok: true,
      scene: {
        name: file.name,
        path: uploaded.path,
        previewUrl: `./api/image?path=${encodeURIComponent(uploaded.path)}`
      }
    };
  }
  const data = await uploadResponseData(response);
  if (response.status === 401 && data.loginRequired) location.href = "./login.html";
  if (!response.ok) throw new Error(data.error || `上传失败（${response.status}）`);
  return data;
}

async function uploadAssetFile(file, params, onProgress) {
  const response = await fetch(`./api/product-workflows/assets/upload?${params}`, { method: "POST", body: file });
  if (response.status === 413 && file.size > PROXY_SAFE_UPLOAD_CHUNK_BYTES) {
    const uploaded = await uploadAssetInChunks(file, params, onProgress);
    return api("./api/product-workflows/assets/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path: uploaded.path,
        assetType: params.get("assetType"),
        name: params.get("name"),
        title: params.get("title"),
        productId: params.get("productId"),
        productName: params.get("productName"),
        category: params.get("category"),
        assetRole: params.get("assetRole")
      })
    });
  }
  const data = await uploadResponseData(response);
  if (response.status === 401 && data.loginRequired) location.href = "./login.html";
  if (!response.ok) throw new Error(data.error || `上传失败（${response.status}）`);
  return data;
}

async function uploadAssetFiles(files, options = {}) {
  if (!files.length || state.assetUploadBusy) return;
  const product = selectedProduct();
  if (!product) throw new Error("请先新增或启用产品SKU");
  const assetType = options.assetType || state.activeAssetTab;
  const role = options.assetRole || (assetType === "video" ? "product_broll" : $("#assetRoleSelect").value || "white_background");
  const statusElement = options.statusElement || $("#uploadStatus");
  const inputElement = options.inputElement || $("#assetFileInput");
  const uploadedAssetIds = [];
  if (assetType === "video" && files.length > MAX_VIDEO_UPLOAD_SELECTION) {
    inputElement.value = "";
    state.assetUploadQueue = [];
    renderAssetUploadQueue();
    notice(statusElement, `一次最多选择 ${MAX_VIDEO_UPLOAD_SELECTION} 条碎镜头，本次选择了 ${files.length} 条，请重新选择。`, true);
    return;
  }

  state.assetUploadQueue = files.map((file) => ({ name: file.name, status: "pending", detail: "等待按顺序上传" }));
  state.assetUploadBusy = true;
  renderAssetUploadQueue();
  updateProductHint();

  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    const limit = assetType === "video" ? 500 * 1024 * 1024 : 10 * 1024 * 1024;
    const expectedType = assetType === "video" ? /\.(mp4|mov)$/i : /\.(png|jpe?g)$/i;
    const typeMessage = assetType === "video" ? "仅支持 MP4 或 MOV" : "仅支持 PNG 或 JPG";
    const sizeMessage = assetType === "video" ? "单条不能超过500MB" : "单张不能超过10MB";
    if (!expectedType.test(file.name)) {
      updateAssetUploadQueueItem(index, { status: "failed", detail: typeMessage });
      continue;
    }
    if (file.size > limit) {
      updateAssetUploadQueueItem(index, { status: "failed", detail: sizeMessage });
      continue;
    }

    updateAssetUploadQueueItem(index, { status: "uploading", detail: `正在上传（${index + 1}/${files.length}）` });
    notice(statusElement, `正在上传 ${index + 1}/${files.length}：${file.name}`);
    try {
      const params = new URLSearchParams({
        assetType,
        name: file.name,
        title: file.name.replace(/\.[^.]+$/, ""),
        productId: product.id,
        productName: product.name,
        category: product.category || "",
        assetRole: role,
        session: `product-showcase-assets-${Date.now()}-${index + 1}`
      });
      const result = await uploadAssetFile(file, params, (progress) => {
        updateAssetUploadQueueItem(index, { detail: `正在上传 ${progress}%（${index + 1}/${files.length}）` });
      });
      const storedAssetId = result.duplicateMatch?.id || result.asset?.id;
      if (storedAssetId) uploadedAssetIds.push(storedAssetId);
      if (result.duplicateAsset) {
        updateAssetUploadQueueItem(index, {
          status: "success",
          detail: `已存在完全相同的资产“${result.duplicateMatch?.title || result.asset?.title || file.name}”，已跳过且未重复写入 OSS`
        });
        continue;
      }
      const shared = result.metadataSync?.status === "shared";
      updateAssetUploadQueueItem(index, {
        status: "success",
        detail: shared ? "已写入 OSS 和部门共享目录" : `已写入 OSS；共享目录同步待重试：${result.metadataSync?.message || "服务暂不可用"}`
      });
    } catch (error) {
      updateAssetUploadQueueItem(index, { status: "failed", detail: error.message || "上传失败" });
    }
  }

  inputElement.value = "";
  state.assetUploadBusy = false;
  updateProductHint();
  try {
    await loadAssets(assetType);
  } catch (error) {
    notice(statusElement, `素材已上传，但刷新资产库失败：${error.message}`, true);
    return uploadedAssetIds;
  }
  if (options.selectInPicker && state.picker?.type === assetType) {
    const selectableIds = new Set(aiShowcaseVisibleAssets(assetType).map((asset) => asset.id));
    const nextIds = [...state.picker.selectedIds];
    const maximum = Number(state.picker.maximum || MAX_PRODUCT_SELECTION);
    for (const assetId of uploadedAssetIds) {
      if (!selectableIds.has(assetId) || nextIds.includes(assetId) || nextIds.length >= maximum) continue;
      nextIds.push(assetId);
    }
    state.picker.selectedIds = nextIds;
    renderAssetPicker();
  }
  const successCount = state.assetUploadQueue.filter((item) => item.status === "success").length;
  const failedCount = state.assetUploadQueue.filter((item) => item.status === "failed").length;
  const unselectedCount = options.selectInPicker
    ? uploadedAssetIds.filter((id) => !state.picker?.selectedIds.includes(id)).length
    : 0;
  notice(
    statusElement,
    failedCount
      ? `上传完成：${successCount} 条成功，${failedCount} 条失败；可在上传明细中查看原因。`
      : `上传完成：${successCount} 条已保存到产品资产${options.selectInPicker ? "并加入本次选择" : ""}${unselectedCount ? `；另有${unselectedCount}张因选择已满仅保存入库` : ""}。`,
    failedCount > 0
  );
  return uploadedAssetIds;
}

function pickerTarget(angleId) {
  return angleId === CUSTOM_CREATIVE_ANGLE ? state.customCreative : laneState(angleId);
}

function resetLaneGeneration(lane) {
  clearInterval(lane.polling);
  lane.jobId = "";
  lane.status = "";
  lane.refreshWarning = "";
  lane.pollFailureCount = 0;
  lane.pollInFlight = false;
  lane.error = "";
  lane.refreshWarning = "";
  lane.pollFailureCount = 0;
  lane.pollInFlight = false;
  lane.outputUrl = "";
  lane.downloadUrl = "";
  lane.canvasUrl = "";
  lane.canvasName = "";
  lane.videoNodeName = "";
  lane.videoPrompt = "";
  lane.polling = null;
}

function renderAssetPicker() {
  if (!state.picker) return;
  const { type, selectedIds, angleId } = state.picker;
  const assets = aiShowcaseVisibleAssets(type);
  $("#pickerUploadRow").hidden = type !== "image";
  $("#pickerProductUploadInput").disabled = state.assetUploadBusy;
  const selectedOrder = new Map((selectedIds || []).map((id, index) => [id, index + 1]));
  $("#pickerEmpty").hidden = assets.length > 0;
  $("#pickerEmpty span").textContent = type === "image"
    ? "可直接使用上方按钮上传本地产品图，上传后会自动保存并加入选择。"
    : "请先关闭窗口，在资产管理中上传当前 SKU 的真实碎镜头。";
  $("#pickerGrid").innerHTML = assets.map((asset) => {
    const order = selectedOrder.get(asset.id) || 0;
    return `<button class="ps-picker-card ${order ? "selected" : ""}" data-picker-asset-id="${escapeHtml(asset.id)}" type="button" aria-pressed="${order ? "true" : "false"}">
      ${order ? `<i class="ps-picker-order">${order}</i>` : ""}
      <i class="ps-picker-check" aria-hidden="true">${order ? "✓" : ""}</i>
      ${assetMedia(asset)}
      <i class="ps-picker-preview-trigger" data-preview-product-asset="${escapeHtml(asset.id)}">预览</i>
      <span><b>${escapeHtml(asset.title)}</b><small>${escapeHtml(asset.productName || "")}</small></span>
    </button>`;
  }).join("");

  const isProductMulti = type === "image";
  const isMulti = type === "video" || isProductMulti;
  const minimum = type === "video" ? MIN_FRAGMENT_SELECTION : Math.max(0, Number(state.picker.minimum || 0));
  const maximum = isProductMulti ? Number(state.picker.maximum || MAX_PRODUCT_SELECTION) : MAX_FRAGMENT_SELECTION;
  $("#pickerSelection").hidden = !isMulti;
  $("#pickerActions").hidden = !isMulti;
  if (isMulti) {
    const selectedAssets = (selectedIds || []).map(assetById).filter(Boolean);
    $("#pickerSelectionTitle").textContent = isProductMulti ? "已选产品白底图" : "参考视频拼接顺序";
    $("#pickerSelectionCount").textContent = isProductMulti
      ? `已选 ${selectedAssets.length}/${maximum} 张`
      : `已选 ${selectedAssets.length}/${MAX_FRAGMENT_SELECTION} 条${minimum ? ` · 至少${minimum}条` : " · 可不选"}`;
    $("#pickerSelectionList").innerHTML = selectedAssets.map((asset, index) => `<article class="ps-picker-selection-item">
      <button class="ps-picker-selection-image" data-preview-product-asset="${escapeHtml(asset.id)}" type="button" aria-label="查看原始资产：${escapeHtml(asset.title)}"><img src="${escapeHtml(asset.thumbnailUrl || asset.previewUrl)}" alt="${escapeHtml(asset.title)}缩略图" loading="lazy" />${type === "video" ? "<i>▶</i>" : ""}</button>
      <b><i>${index + 1}</i><span title="${escapeHtml(asset.title)}">${escapeHtml(asset.title)}</span></b>
      <span>
        <button data-picker-move="up" data-picker-index="${index}" type="button" ${index === 0 ? "disabled" : ""}>上移</button>
        <button data-picker-move="down" data-picker-index="${index}" type="button" ${index === selectedAssets.length - 1 ? "disabled" : ""}>下移</button>
        <button data-picker-remove="${escapeHtml(asset.id)}" type="button">移除</button>
      </span>
    </article>`).join("") || `<div class="ps-picker-selection-empty">${isProductMulti ? minimum ? `请至少选择${minimum}张产品白底图` : "可选择多张产品白底图，也可留空" : minimum ? `请至少选择${minimum}条碎镜头` : "碎镜头可不选，直接确认即可"}</div>`;
    $("#confirmPickerSelectionButton").textContent = isProductMulti ? "确认产品白底图" : "确认碎镜头选择";
    $("#confirmPickerSelectionButton").disabled = selectedAssets.length < minimum;
  }

  $$('[data-picker-asset-id]').forEach((button) => button.addEventListener("click", () => {
    const assetId = button.dataset.pickerAssetId;
    const index = state.picker.selectedIds.indexOf(assetId);
    if (index >= 0) state.picker.selectedIds.splice(index, 1);
    else if (state.picker.selectedIds.length < maximum) state.picker.selectedIds.push(assetId);
    else return window.alert(`单次最多选择${maximum}${isProductMulti ? "张产品白底图" : "条碎镜头"}。`);
    renderAssetPicker();
  }));
  $$('[data-picker-move]').forEach((button) => button.addEventListener("click", () => {
    const index = Number(button.dataset.pickerIndex);
    const nextIndex = button.dataset.pickerMove === "up" ? index - 1 : index + 1;
    if (index < 0 || nextIndex < 0 || nextIndex >= state.picker.selectedIds.length) return;
    [state.picker.selectedIds[index], state.picker.selectedIds[nextIndex]] = [state.picker.selectedIds[nextIndex], state.picker.selectedIds[index]];
    renderAssetPicker();
  }));
  $$('[data-picker-remove]').forEach((button) => button.addEventListener("click", () => {
    state.picker.selectedIds = state.picker.selectedIds.filter((id) => id !== button.dataset.pickerRemove);
    renderAssetPicker();
  }));
}

function confirmPickerSelection() {
  if (!state.picker) return;
  const picker = state.picker;
  const minimum = picker.type === "video" ? MIN_FRAGMENT_SELECTION : Math.max(0, Number(picker.minimum || 0));
  if (state.picker.selectedIds.length < minimum) return;
  if (picker.external) {
    const selectedAssets = picker.selectedIds.map(assetById).filter((asset) => asset?.assetType === "image");
    const onConfirm = picker.onConfirm;
    $("#assetPickerDialog").close();
    if (typeof onConfirm === "function") onConfirm(selectedAssets);
    return;
  }
  const target = pickerTarget(state.picker.angleId);
  if (state.picker.type === "image") {
    target.productAssetIds = [...state.picker.selectedIds].slice(0, Number(state.picker.maximum || productSelectionLimit(target)));
    target.productAssetId = target.productAssetIds[0] || "";
  } else {
    target.fragmentAssetIds = [...state.picker.selectedIds].slice(0, MAX_FRAGMENT_SELECTION);
    autoFillReferenceVideoDuration(target);
  }
  if (state.picker.angleId === CUSTOM_CREATIVE_ANGLE) resetCustomCreativeGeneration();
  else resetLaneGeneration(target);
  $("#assetPickerDialog").close();
}

async function openPicker(angleId, type) {
  await loadAssets(type);
  const target = pickerTarget(angleId);
  const selectableIds = new Set(aiShowcaseVisibleAssets(type).map((asset) => asset.id));
  state.picker = {
    angleId,
    type,
    maximum: type === "image" ? productSelectionLimit(target) : MAX_FRAGMENT_SELECTION,
    selectedIds: type === "video"
      ? selectedFragmentIds(target).filter((id) => Boolean(assetById(id)) && selectableIds.has(id))
      : selectedProductIds(target).filter((id) => Boolean(assetById(id)) && selectableIds.has(id))
  };
  const angle = state.defaults.angles.find((item) => item.id === angleId);
  const stepLabel = angleId === CUSTOM_CREATIVE_ANGLE ? "自定义创意输出" : `${angle?.label || "当前"}支路`;
  $("#pickerStep").textContent = `${stepLabel} · ${selectedProduct()?.name || ""}`;
  $("#pickerTitle").textContent = type === "image" ? "选择产品白底图" : "选择并排序真实产展碎镜头";
  $("#pickerHint").textContent = type === "image"
    ? angleId === CUSTOM_CREATIVE_ANGLE
      ? `可选0-${state.picker.maximum}张；不选择时沿用碎镜头中的产品，选择后产品外观、包装、颜色和比例以白底图为最高优先级真值。`
      : `可选，不上传则沿用碎镜头中的产品，最多${state.picker.maximum}张。选择后，产品外观、包装、颜色和比例以所选白底图为最高优先级真值。`
    : angleId === CUSTOM_CREATIVE_ANGLE
      ? `按点击顺序选择${MIN_FRAGMENT_SELECTION}-${MAX_FRAGMENT_SELECTION}条；系统会统一画幅、保留素材原声并拼接成完整参考视频。`
      : `按点击顺序选择${MIN_FRAGMENT_SELECTION}-${MAX_FRAGMENT_SELECTION}条；可调整顺序，系统会统一画幅、保留原声并拼接成本次任务参考视频。`;
  notice($("#pickerUploadStatus"), "");
  renderAssetPicker();
  $("#assetPickerDialog").showModal();
}

async function selectProductImagesForWorkflow(options = {}) {
  await loadAssets("image");
  const maximum = Math.min(MAX_PRODUCT_SELECTION, Math.max(1, Number(options.maximum || MAX_PRODUCT_SELECTION)));
  const minimum = Math.min(maximum, Math.max(0, Number(options.minimum || 0)));
  const selectableIds = new Set(aiShowcaseVisibleAssets("image").map((asset) => asset.id));
  state.picker = {
    angleId: "external-product-images",
    type: "image",
    external: true,
    minimum,
    maximum,
    selectedIds: [...new Set((Array.isArray(options.selectedIds) ? options.selectedIds : [])
      .map((item) => String(item || "").trim())
      .filter((id) => id && selectableIds.has(id)))].slice(0, maximum),
    onConfirm: options.onConfirm
  };
  $("#pickerStep").textContent = `${String(options.contextLabel || "产品图片选择")} · ${selectedProduct()?.name || ""}`;
  $("#pickerTitle").textContent = "选择产品白底图";
  $("#pickerHint").textContent = minimum
    ? `必选${minimum}-${maximum}张；仅显示页面顶部所选 SKU 的图片。产品外观、包装、文字、颜色和比例以所选白底图为最高优先级真值。`
    : `可选0-${maximum}张；仅显示页面顶部所选 SKU 的图片。`;
  notice($("#pickerUploadStatus"), "");
  renderAssetPicker();
  $("#assetPickerDialog").showModal();
}

async function generateLaneVideo(angleId) {
  const lane = laneState(angleId);
  const candidate = selectedCandidate(angleId);
  const product = selectedProduct();
  const productAssetIds = selectedProductIds(lane);
  const fragmentAssetIds = selectedFragmentIds(lane);
  const prompt = String(lane.prompt || "").trim();
  const fragmentAssets = selectedFragmentAssets(lane);
  const totalFragmentDuration = fragmentAssets.reduce((sum, asset) => sum + fragmentDuration(asset), 0);
  const modelCompatibility = videoModelCompatibility(lane.videoModelId, productAssetIds.length, totalFragmentDuration, lane.duration, lane.clarity);
  const referenceDurationStatus = seedance25ReferenceDurationStatus(lane.videoModelId, fragmentAssets);
  if (!candidate || !product || fragmentAssetIds.length < MIN_FRAGMENT_SELECTION || !prompt || !modelCompatibility.ok || !referenceDurationStatus.ok) {
    lane.error = `请先选择场景图、至少${MIN_FRAGMENT_SELECTION}条真实碎镜头，并填写本角度视频提示词。产品白底图为可选项。`;
    if (!modelCompatibility.ok) lane.error = modelCompatibility.message;
    else if (!referenceDurationStatus.ok) lane.error = referenceDurationStatus.message || "正在读取所选碎镜头时长，请稍后重试";
    return renderLanes();
  }
  lane.status = "视频任务提交中…";
  lane.refreshWarning = "";
  lane.pollFailureCount = 0;
  lane.pollInFlight = false;
  lane.error = "";
  lane.refreshWarning = "";
  lane.pollFailureCount = 0;
  lane.jobId = "";
  lane.outputUrl = "";
  lane.canvasUrl = "";
  lane.canvasName = "";
  lane.videoNodeName = "";
  lane.videoPrompt = "";
  renderLanes();
  try {
    const result = await api("./api/product-workflows/video-jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        candidateJobId: state.candidateJob.id,
        productId: product.id,
        productName: product.name,
        workstationId: WORKSTATION.id,
        workstationLabel: WORKSTATION.label,
        duration: Number(lane.duration || 4),
        clarity: lane.clarity,
        lanes: [{
          angle: angleId,
          candidateId: candidate.id,
          productAssetId: productAssetIds[0] || "",
          productAssetIds,
          fragmentAssetIds,
          videoModelId: modelCompatibility.model.id,
          videoGenerationMode: lane.videoGenerationMode,
          duration: Number(lane.duration || 4),
          clarity: lane.clarity,
          prompt
        }]
      })
    });
    lane.jobId = result.jobs[0]?.id || "";
    lane.videoModelId = result.jobs[0]?.videoModelId || modelCompatibility.model.id;
    lane.videoGenerationMode = result.jobs[0]?.videoGenerationMode || lane.videoGenerationMode;
    lane.videoGenerationModeLabel = result.jobs[0]?.videoGenerationModeLabel || lane.videoGenerationModeLabel;
    lane.duration = Number(result.jobs[0]?.duration || lane.duration || 4);
    lane.clarity = result.jobs[0]?.clarity || lane.clarity;
    lane.model = result.jobs[0]?.model || modelCompatibility.model.label;
    lane.status = `已创建${candidate.angleLabel}${lane.duration || 4}秒视频任务，输出区会自动显示结果。`;
    saveProductTaskState();
    startLaneJobPolling(angleId);
  } catch (error) {
    lane.status = error.message;
    lane.error = error.message;
  }
  renderLanes();
}

function startLaneJobPolling(angleId) {
  const lane = laneState(angleId);
  clearInterval(lane.polling);
  const poll = async () => {
    if (!lane.jobId || lane.pollInFlight) return;
    lane.pollInFlight = true;
    try {
      const job = await api(`./api/jobs/${lane.jobId}`);
      const task = Array.isArray(job.tasks) ? job.tasks[0] : null;
      lane.canvasUrl = normalizeDeviceDailyCanvasUrl(task?.canvasUrl || job.canvasUrl || lane.canvasUrl || "");
      lane.canvasName = String(task?.canvasName || job.canvasName || lane.canvasName || "").trim();
      lane.videoNodeName = String(task?.videoNodeName || lane.videoNodeName || "").trim();
      lane.videoPrompt = String(task?.finalLibtvPrompt || lane.videoPrompt || "").trim();
      lane.model = String(task?.activeModel || task?.model || lane.model || selectedVideoModel(lane.videoModelId, lane.duration).label).trim();
      lane.refreshWarning = "";
      lane.pollFailureCount = 0;
      if (task?.localPath) {
        lane.outputUrl = candidateVideoResultUrl(lane.jobId, "preview");
        lane.downloadUrl = candidateVideoResultUrl(lane.jobId, "download");
      }
      else if (task?.url) lane.outputUrl = task.url;
      if (lane.outputUrl) lane.status = task?.status === "success" ? "视频已生成并通过自动检查。" : "视频已生成，请在右侧输出区播放并人工确认。";
      else lane.status = job.status === "failed" ? (job.error || task?.error || "视频生成失败") : "视频生成中，输出区会自动更新…";
      lane.error = job.status === "failed" ? lane.status : "";
      lane.refreshWarning = "";
      lane.pollFailureCount = 0;
      refreshLaneGenerationUi(angleId);
      saveProductTaskState();
      if (["success", "partial", "failed"].includes(job.status)) {
        clearInterval(lane.polling);
        lane.polling = null;
      }
    } catch (error) {
      if (error.retryable || error.code === "WORKBENCH_OFFLINE") {
        lane.pollFailureCount += 1;
        lane.refreshWarning = `状态刷新暂时中断，正在自动重试（${lane.pollFailureCount}）。成片和画布地址不会丢失。`;
        refreshLaneGenerationUi(angleId);
        return;
      }
      lane.status = error.message;
      lane.error = error.message;
      clearInterval(lane.polling);
      lane.polling = null;
      refreshLaneGenerationUi(angleId);
    } finally {
      lane.pollInFlight = false;
    }
  };
  poll();
  lane.polling = setInterval(poll, 3000);
}

function resetCustomCreativeGeneration() {
  const custom = state.customCreative;
  clearInterval(custom.polling);
  custom.jobId = "";
  custom.jobStatus = "";
  custom.status = "";
  custom.error = "";
  custom.refreshWarning = "";
  custom.pollFailureCount = 0;
  custom.pollInFlight = false;
  custom.outputUrl = "";
  custom.downloadUrl = "";
  custom.downloadRecoveryAttempted = false;
  custom.model = "";
  custom.canvasUrl = "";
  custom.canvasName = "";
  custom.polling = null;
}

async function uploadCustomCreativeScene(file) {
  if (!file) return;
  if (!/\.(png|jpe?g)$/i.test(file.name)) throw new Error("自定义场景图仅支持PNG或JPG");
  if (file.size > 10 * 1024 * 1024) throw new Error("自定义场景图不能超过10MB");
  resetCustomCreativeGeneration();
  state.customCreative.status = `正在上传场景图：${file.name}`;
  renderCustomCreative();
  try {
    const params = new URLSearchParams({ name: file.name, session: `custom-creative-scene-${Date.now()}` });
    const result = await uploadCustomCreativeSceneFile(file, params, (progress) => {
      state.customCreative.status = `正在分片上传场景图：${progress}%`;
      renderCustomCreative();
    });
    state.customCreative.scene = result.scene;
    state.customCreative.status = "场景图已上传。请选择至少2条真实碎镜头；产品白底图可选。";
  } catch (error) {
    state.customCreative.status = "";
    state.customCreative.error = error.message;
  } finally {
    $("#customSceneFileInput").value = "";
    renderCustomCreative();
  }
}

async function generateCustomCreativeVideo() {
  const custom = state.customCreative;
  const product = selectedProduct();
  const productAssetIds = selectedProductIds(custom);
  const productAssets = selectedProductAssets(custom);
  const fragmentAssetIds = selectedFragmentIds(custom);
  const fragmentAssets = selectedFragmentAssets(custom);
  const totalFragmentDuration = fragmentAssets.reduce((sum, asset) => sum + fragmentDuration(asset), 0);
  const modelCompatibility = videoModelCompatibility(custom.videoModelId, productAssets.length, totalFragmentDuration, custom.duration, custom.clarity);
  const referenceDurationStatus = seedance25ReferenceDurationStatus(custom.videoModelId, fragmentAssets);
  const prompt = String(custom.prompt || "").trim();
  if (!product || !custom.scene || fragmentAssetIds.length < MIN_FRAGMENT_SELECTION || !prompt || !modelCompatibility.ok || !referenceDurationStatus.ok) {
    custom.error = `请先准备场景图、至少${MIN_FRAGMENT_SELECTION}条真实碎镜头，并填写视频备注提示词；产品白底图可选0-${MAX_PRODUCT_SELECTION}张。`;
    if (!modelCompatibility.ok) custom.error = modelCompatibility.message;
    else if (!referenceDurationStatus.ok) custom.error = referenceDurationStatus.message || "正在读取所选碎镜头时长，请稍后重试";
    return renderCustomCreative();
  }
  resetCustomCreativeGeneration();
  custom.jobStatus = "queued";
  custom.status = "正在检查 LibTV VIP 账号并提交创意视频任务…";
  renderCustomCreative();
  try {
    await ensureProductTaskForChannel("semi-auto");
    const result = await api("./api/product-workflows/custom-creative-jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        candidateJobId: state.candidateJob?.id || "",
        sceneImagePath: custom.scene.path,
        sceneImageName: custom.scene.name,
        productId: product.id,
        productName: product.name,
        workstationId: WORKSTATION.id,
        workstationLabel: WORKSTATION.label,
        productAssetId: productAssetIds[0],
        productAssetIds,
        fragmentAssetIds,
        videoModelId: modelCompatibility.model.id,
        videoGenerationMode: custom.videoGenerationMode,
        duration: Number(custom.duration || 4),
        clarity: custom.clarity,
        prompt
      })
    });
    custom.jobId = result.id;
    custom.jobStatus = "queued";
    custom.videoModelId = result.videoModelId || modelCompatibility.model.id;
    custom.videoGenerationMode = result.videoGenerationMode || custom.videoGenerationMode;
    custom.videoGenerationModeLabel = result.videoGenerationModeLabel || custom.videoGenerationModeLabel;
    custom.duration = Number(result.duration || custom.duration || 4);
    custom.clarity = result.clarity || custom.clarity;
    custom.model = result.model || modelCompatibility.model.label;
    custom.status = `创意视频任务已创建，LibTV 将使用 ${custom.model}；完成后加载预览和无水印下载。`;
    startCustomCreativePolling();
  } catch (error) {
    custom.jobStatus = "failed";
    custom.status = "";
    custom.error = error.message;
  }
  renderCustomCreative();
}

function startCustomCreativePolling() {
  const custom = state.customCreative;
  clearInterval(custom.polling);
  const poll = async () => {
    if (!custom.jobId || custom.pollInFlight) return;
    custom.pollInFlight = true;
    try {
      const job = await api(`./api/jobs/${custom.jobId}`);
      const task = Array.isArray(job.tasks) ? job.tasks[0] : null;
      custom.jobStatus = job.status || "running";
      custom.model = String(task?.model || task?.activeModel || custom.model || "Seedance 2.0 VIP").trim();
      custom.canvasUrl = normalizeDeviceDailyCanvasUrl(task?.canvasUrl || job.canvasUrl || custom.canvasUrl || "");
      custom.canvasName = String(task?.canvasName || job.canvasName || custom.canvasName || "").trim();
      custom.refreshWarning = "";
      custom.pollFailureCount = 0;
      if (task?.localPath) {
        custom.outputUrl = `./api/file?path=${encodeURIComponent(task.localPath)}`;
        custom.downloadUrl = `./api/product-workflows/custom-creative-jobs/${encodeURIComponent(custom.jobId)}/download`;
      }
      if (custom.outputUrl) {
        custom.status = ["success", "partial"].includes(job.status)
          ? "创意视频已生成，可直接预览并下载无水印成片。"
          : "会员无水印原链已下载，可先预览；平台正在完成自动质量检查。";
        custom.error = "";
      } else if (
        job.status === "failed"
        && !custom.downloadRecoveryAttempted
        && task?.projectId
        && task?.videoNodeName
        && /LibTV无水印原链下载失败[\s\S]*缺少项目|缺少项目[\s\S]*libtv project use/i.test(String(job.error || task?.error || ""))
      ) {
        custom.downloadRecoveryAttempted = true;
        custom.jobStatus = "running";
        custom.error = "";
        custom.status = "远端成片已生成，正在补传项目UUID并重新下载，不会再次生成视频…";
        saveProductTaskState();
        await api(`./api/product-workflows/custom-creative-jobs/${encodeURIComponent(custom.jobId)}/recover-download`, { method: "POST" });
        return;
      } else if (job.status === "failed") {
        custom.error = job.error || task?.error || "创意视频生成失败";
        custom.status = "";
      } else {
        custom.status = task?.stageLabel || `LibTV 正在使用 ${custom.model} 生成创意视频，完成后会自动下载会员无水印原链…`;
      }
      saveProductTaskState();
      if (["success", "partial", "failed"].includes(job.status)) {
        clearInterval(custom.polling);
        custom.polling = null;
      }
    } catch (error) {
      if (error.retryable || error.code === "WORKBENCH_OFFLINE") {
        custom.pollFailureCount += 1;
        custom.refreshWarning = `状态刷新暂时中断，正在自动重试（${custom.pollFailureCount}）。成片和画布地址不会丢失。`;
        custom.status = custom.refreshWarning;
      } else {
        custom.jobStatus = "failed";
        custom.error = error.message;
        custom.status = "";
        clearInterval(custom.polling);
        custom.polling = null;
      }
    } finally {
      custom.pollInFlight = false;
      renderCustomCreative();
    }
  };
  poll();
  custom.polling = setInterval(poll, 3000);
}

async function init() {
  setProductRulesHidden(localStorage.getItem(PRODUCT_RULES_HIDDEN_KEY) === "1", { persist: false });
  bindProductChannelTabs();
  setActiveProductChannel(localStorage.getItem(PRODUCT_CHANNEL_KEY) || "standard", { persist: false });
  document.addEventListener("wheel", (event) => {
    const select = event.target.closest?.("select.ps-click-select");
    if (select) select.blur();
  }, { capture: true, passive: true });

  try {
    state.defaults = await api("./api/product-workflows/defaults");
    $("#taskStatus").classList.remove("ps-service-notice");
    renderDefaults();
    const dailyCanvasReady = api("./api/product-workflows/daily-canvas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workstationId: WORKSTATION.id, workstationLabel: WORKSTATION.label })
    }).then((result) => {
      state.dailyCanvas = result;
      state.dailyCanvasError = "";
      renderDefaults();
    }).catch((error) => {
      state.dailyCanvas = null;
      state.dailyCanvasError = error.message;
      renderDefaults();
    });
    await Promise.all([loadAssets("image"), loadAssets("video"), dailyCanvasReady]);
    renderLibrary();
    await restoreProductTask();
    const restoredDurations = new Set([
      state.customCreative.duration,
      ...Object.values(state.lanes).map((lane) => lane.duration)
    ].map(normalizedVideoDuration));
    await Promise.all([...restoredDurations].map((duration) => refreshVideoModelAvailability(duration).catch(() => [])));
    renderLanes();
    renderCustomCreative();
  } catch (error) {
    const directFileOpen = location.protocol === "file:";
    const recovery = directFileOpen
      ? "当前页面是直接打开的HTML文件，无法读取素材和任务数据。请先启动“AI视频工作台”，再从工作台首页进入AI产品镜生成。"
      : "工作台服务暂未连接，素材与场景数据还没有加载。请确认AI视频工作台仍在运行，然后刷新本页。";
    $("#candidateStatus").textContent = "等待连接工作台";
    $("#taskStatus").classList.add("ps-service-notice");
    notice($("#taskStatus"), recovery, false);
  }

  $("#referenceFileInput").addEventListener("change", (event) => uploadReference(event.target.files[0]).catch((error) => notice($("#referenceStatus"), error.message, true)));
  $("#analyzePromptButton").addEventListener("click", reversePrompt);
  $("#scenePrompt").addEventListener("input", () => { state.promptConfirmed = false; updatePromptState(); saveProductTaskState(); });
  $("#confirmPromptButton").addEventListener("click", togglePromptConfirmation);
  $("#assetFileInput").addEventListener("change", (event) => uploadAssetFiles([...event.target.files]).catch((error) => notice($("#uploadStatus"), error.message, true)));
  $("#pickerProductUploadInput").addEventListener("change", (event) => uploadAssetFiles([...event.target.files], {
    assetType: "image",
    assetRole: "white_background",
    inputElement: event.target,
    statusElement: $("#pickerUploadStatus"),
    selectInPicker: true
  }).catch((error) => notice($("#pickerUploadStatus"), error.message, true)));
  $("#customSceneButton").addEventListener("click", () => $("#customSceneFileInput").click());
  $("#customSceneFileInput").addEventListener("change", (event) => uploadCustomCreativeScene(event.target.files[0]).catch((error) => {
    state.customCreative.status = "";
    state.customCreative.error = error.message;
    renderCustomCreative();
  }));
  $("#customCreativeDuration").addEventListener("change", async (event) => {
    state.customCreative.duration = Number(event.target.value || 4);
    state.customCreative.durationManuallyEdited = true;
    state.customCreative.durationAutoFilled = false;
    renderCustomCreative();
    await refreshVideoModelAvailability(state.customCreative.duration, { clarity: state.customCreative.clarity }).catch(() => []);
    renderCustomCreative();
    saveProductTaskState();
  });
  $("#customCreativeClarity").addEventListener("change", async (event) => {
    state.customCreative.clarity = event.target.value;
    resetCustomCreativeGeneration();
    renderCustomCreative();
    await refreshVideoModelAvailability(state.customCreative.duration, { force: true, clarity: state.customCreative.clarity }).catch(() => []);
    renderCustomCreative();
    saveProductTaskState();
  });
  $("#customCreativeVideoModel").addEventListener("change", async (event) => {
    state.customCreative.videoModelId = event.target.value;
    state.customCreative.duration = normalizedVideoDuration(state.customCreative.duration, state.customCreative.videoModelId);
    state.customCreative.clarity = selectedVideoClarity(state.customCreative.videoModelId, state.customCreative.clarity).value;
    autoFillReferenceVideoDuration(state.customCreative);
    state.customCreative.videoGenerationMode = defaultVideoGenerationMode(state.customCreative.videoModelId);
    state.customCreative.videoGenerationModeLabel = selectedVideoGenerationMode(state.customCreative.videoModelId, state.customCreative.videoGenerationMode).label;
    state.customCreative.model = selectedVideoModel(event.target.value, state.customCreative.duration).label;
    resetCustomCreativeGeneration();
    renderCustomCreative();
    await refreshVideoModelAvailability(state.customCreative.duration, { force: true, clarity: state.customCreative.clarity }).catch(() => []);
    renderCustomCreative();
    saveProductTaskState();
  });
  $("#customCreativeVideoMode").addEventListener("change", (event) => {
    const nextMode = selectedVideoGenerationMode(state.customCreative.videoModelId, event.target.value);
    state.customCreative.videoGenerationMode = nextMode.value;
    state.customCreative.videoGenerationModeLabel = nextMode.label;
    resetCustomCreativeGeneration();
    renderCustomCreative();
    saveProductTaskState();
  });
  $("#customCreativePrompt").addEventListener("input", (event) => {
    state.customCreative.prompt = event.target.value;
    renderCustomCreative();
    saveProductTaskState();
  });
  $("#hideProductRulesButton").addEventListener("click", () => setProductRulesHidden(true));
  $("#showProductRulesButton").addEventListener("click", () => setProductRulesHidden(false));
  $("#generateCustomCreativeButton").addEventListener("click", generateCustomCreativeVideo);
  $("#manageSkuButton").addEventListener("click", () => openSkuManager().catch((error) => notice($("#uploadStatus"), error.message, true)));
  $("#productSelect").addEventListener("dblclick", () => openSkuManager({ productId: $("#productSelect").value, focusName: true }).catch((error) => notice($("#uploadStatus"), error.message, true)));
  $("#productSelectTrigger").addEventListener("click", () => {
    if ($("#productSelectMenu").hidden) openProductSelectMenu();
    else closeProductSelectMenu();
  });
  $("#productSelectTrigger").addEventListener("dblclick", () => openSkuManager({ productId: $("#productSelect").value, focusName: true }).catch((error) => notice($("#uploadStatus"), error.message, true)));
  $("#productSelectTrigger").addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeProductSelectMenu();
      return;
    }
    if (!["ArrowDown", "ArrowUp"].includes(event.key)) return;
    event.preventDefault();
    openProductSelectMenu();
  });
  $("#productSelectControl").addEventListener("focusout", () => {
    requestAnimationFrame(() => {
      if (!$("#productSelectControl").contains(document.activeElement)) closeProductSelectMenu();
    });
  });
  $("#productSelectMenu").addEventListener("click", (event) => {
    const option = event.target.closest("[data-product-id]");
    if (!option) return;
    const select = $("#productSelect");
    if (select.value === option.dataset.productId) {
      closeProductSelectMenu(true);
      return;
    }
    select.value = option.dataset.productId;
    renderProductSelectControl();
    select.dispatchEvent(new Event("change", { bubbles: true }));
    $("#productSelectTrigger").focus();
  });
  $("#productSelectMenu").addEventListener("keydown", (event) => {
    const options = $$("#productSelectMenu [data-product-id]");
    const currentIndex = options.indexOf(document.activeElement);
    if (event.key === "Escape") {
      event.preventDefault();
      closeProductSelectMenu(true);
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const nextIndex = event.key === "Home" ? 0
      : event.key === "End" ? options.length - 1
        : event.key === "ArrowDown" ? Math.min(options.length - 1, currentIndex + 1)
          : Math.max(0, currentIndex - 1);
    options[nextIndex]?.focus();
  });
  document.addEventListener("click", (event) => {
    if (!event.target.closest("#productSelectControl")) closeProductSelectMenu();
  });
  $("#closeSkuManagerButton").addEventListener("click", () => $("#skuManagerDialog").close());
  $("#newSkuButton").addEventListener("click", () => {
    state.creatingSku = true;
    state.managingSkuId = "";
    renderSkuManager();
    $("#skuNameInput").focus();
  });
  $("#skuManagerForm").addEventListener("submit", saveManagedSku);
  $("#restoreSkuNameButton").addEventListener("click", restorePreviousSkuName);
  $("#deleteSkuButton").addEventListener("click", deleteManagedSku);
  $("#productSelect").addEventListener("change", async () => {
    const select = $("#productSelect");
    const previousProductId = state.confirmedProductId;
    const nextProductId = select.value;
    if (
      previousProductId
      && nextProductId !== previousProductId
      && currentTaskHasGeneratedVideo()
      && !window.confirm("当前状态更换 SKU 会让各通道重新校验或清除不属于新 SKU 的产品素材，建议您新建任务")
    ) {
      select.value = previousProductId;
      renderProductSelectControl();
      return;
    }
    state.confirmedProductId = nextProductId;
    renderProductSelectControl();
    notifyTaskProductChanged();
    Object.values(state.lanes).forEach((lane) => clearInterval(lane.polling));
    state.lanes = {};
    resetCustomCreativeGeneration();
    state.customCreative.productAssetId = "";
    state.customCreative.productAssetIds = [];
    state.customCreative.fragmentAssetIds = [];
    state.customCreative.duration = normalizedVideoDuration(4, state.customCreative.videoModelId);
    state.customCreative.durationManuallyEdited = false;
    state.customCreative.durationAutoFilled = false;
    state.customCreative.referenceVideoDuration = 0;
    await Promise.all([loadAssets("image"), loadAssets("video")]);
    renderLibrary();
    renderCustomCreative();
  });
  $$('[data-asset-tab]').forEach((button) => button.addEventListener("click", async () => {
    state.activeAssetTab = button.dataset.assetTab;
    $$('[data-asset-tab]').forEach((item) => item.classList.toggle("active", item === button));
    await loadAssets(state.activeAssetTab);
  }));
  $("#closePickerButton").addEventListener("click", () => $("#assetPickerDialog").close());
  $("#cancelPickerSelectionButton").addEventListener("click", () => $("#assetPickerDialog").close());
  $("#confirmPickerSelectionButton").addEventListener("click", confirmPickerSelection);
  $("#closeAssetPreviewButton").addEventListener("click", () => $("#assetPreviewDialog").close());
  $("#assetPreviewDialog").addEventListener("close", () => {
    $("#assetPreviewDialog").classList.remove("is-video-preview", "ps-output-video-dialog");
    $("#assetPreviewDialog").style.removeProperty("--asset-original-aspect-ratio");
    $("#assetPreviewImage").removeAttribute("src");
    $("#assetPreviewVideo").pause();
    $("#assetPreviewVideo").removeAttribute("src");
    $("#assetPreviewVideo").load();
  });
  $("#assetPreviewDialog").addEventListener("click", (event) => {
    const dialog = event.currentTarget;
    const bounds = dialog.getBoundingClientRect();
    const outside = event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom;
    if (outside) dialog.close();
  });
  document.addEventListener("click", (event) => {
    const previewButton = event.target.closest("[data-preview-product-asset], [data-preview-product-image]");
    if (previewButton) {
      event.preventDefault();
      event.stopPropagation();
      openProductImagePreview(previewButton.dataset.previewProductAsset || previewButton.dataset.previewProductImage);
    }
  });
  $("#assetPickerDialog").addEventListener("close", () => {
    state.picker = null;
    renderLanes();
    renderCustomCreative();
  });
  $$('input[name="imageModel"]').forEach((input) => input.addEventListener("change", () => {
    if (!state.candidateJob) renderLanes();
    saveProductTaskState();
  }));
  window.setInterval(saveProductTaskState, 1500);
  window.addEventListener("beforeunload", saveProductTaskState);
}

window.AiProductAssetPicker = Object.freeze({
  selectProductImages: selectProductImagesForWorkflow,
  previewProductImage: openProductImagePreview
});

window.AiProductTaskContext = Object.freeze({
  ensure(channel) {
    return ensureProductTaskForChannel(channel);
  },
  current() {
    const activeId = String(state.candidateJob?.id || localStorage.getItem(PRODUCT_ACTIVE_TASK_KEY) || "").trim();
    const linked = state.candidateJob?.id === activeId
      ? (state.candidateJob.generatedVideos || []).find((item) => item?.angle === "creativeInstruction" && item?.jobId)
      : null;
    return {
      id: activeId,
      channel: state.activeProductChannel,
      taskName: state.candidateJob?.id === activeId ? String(state.candidateJob.taskName || "") : "",
      createdAt: state.candidateJob?.id === activeId ? String(state.candidateJob.createdAt || "") : "",
      creativeInstructionJob: linked ? Object.freeze({
        id: String(linked.jobId || ""),
        status: String(linked.status || "running"),
        hasOutput: Boolean(linked.hasOutput),
        readyCount: Number(linked.readyCount || 0),
        total: Number(linked.total || 1)
      }) : null
    };
  }
});

init();
