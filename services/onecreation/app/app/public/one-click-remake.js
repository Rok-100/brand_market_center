const requestedTaskId = new URLSearchParams(window.location.search).get("task") || "";

const state = {
  config: null,
  currentJobId: requestedTaskId,
  currentJob: null,
  polling: false,
  detailsOpen: false,
  libraryPage: 1,
  libraryPages: 1,
  libraryLoading: false,
  libraryItems: [],
  libraryPermissions: {},
  historyPage: 1,
  historyPages: 1,
  historyLoading: false,
  historyItems: [],
  historyPermissions: {},
  historyOwnerOptions: [],
  replacementUploads: { background: [], person: [] },
  backgroundSceneChoice: { jobId: "", candidateId: "", prompt: "" },
  uploadJobId: "",
  uploading: false,
  pollEpoch: 0,
  taskSummarySignature: "",
  sourceFormJobId: "",
  workflowStep: "source",
  workflowSignature: "",
  openingNewTask: false,
  videoReview: null,
  upstreamTextDrafts: {}
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function jsonText(value) {
  return escapeHtml(JSON.stringify(value ?? {}, null, 2));
}

function normalizedOwnerName(value) {
  return String(value || "").normalize("NFKC").replace(/\s+/g, " ").trim().toLocaleLowerCase("zh-CN");
}

function uniqueOwnerOptions(items, currentOwnerKey = "") {
  const uniqueNames = new Map();
  for (const item of Array.isArray(items) ? items : []) {
    const key = String(item?.key || "").trim();
    const name = String(item?.name || "").trim();
    const nameKey = normalizedOwnerName(name);
    if (!key || !nameKey) continue;
    const existing = uniqueNames.get(nameKey);
    if (!existing || key === currentOwnerKey) uniqueNames.set(nameKey, { key, name });
  }
  return [...uniqueNames.values()].sort((left, right) => left.name.localeCompare(right.name, "zh-CN"));
}

async function apiJson(url, options = {}) {
  const response = await fetch(url, {
    cache: "no-store",
    ...options,
    headers: options.body ? { "Content-Type": "application/json", ...(options.headers || {}) } : options.headers
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `请求失败：HTTP ${response.status}`);
  return payload;
}

const PROXY_SAFE_UPLOAD_CHUNK_BYTES = 768 * 1024;

async function uploadResponseData(response) {
  try { return await response.json(); } catch { return {}; }
}

async function uploadFileInChunks(kind, file, session, onProgress) {
  const uploadId = globalThis.crypto?.randomUUID?.() || `chunk-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const totalChunks = Math.ceil(file.size / PROXY_SAFE_UPLOAD_CHUNK_BYTES);
  let data = {};
  for (let index = 0; index < totalChunks; index += 1) {
    const query = new URLSearchParams({
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
    const response = await fetch(`./api/upload/chunk?${query}`, { method: "POST", body });
    data = await uploadResponseData(response);
    if (!response.ok) throw new Error(data.error || `分片上传失败：HTTP ${response.status}`);
    onProgress?.(Math.round(((index + 1) / totalChunks) * 100));
  }
  return data;
}

async function uploadReferenceFile(kind, file, session, onProgress) {
  const query = new URLSearchParams({ kind, name: file.name, session });
  const response = await fetch(`./api/upload?${query}`, { method: "POST", body: file });
  if (response.status === 413 && file.size > PROXY_SAFE_UPLOAD_CHUNK_BYTES) {
    return uploadFileInChunks(kind, file, session, onProgress);
  }
  const data = await uploadResponseData(response);
  if (!response.ok) throw new Error(data.error || `上传失败：HTTP ${response.status}`);
  onProgress?.(100);
  return data;
}

let toastTimer = null;
function toast(message) {
  const node = $("#toast");
  node.textContent = message;
  node.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { node.hidden = true; }, 4200);
}

async function copyPromptText(value, button, messages = {}) {
  const prompt = String(value || "");
  if (!prompt.trim()) return toast(messages.empty || "当前没有可复制的提示词");
  try {
    if (navigator.clipboard?.writeText && window.isSecureContext) {
      await navigator.clipboard.writeText(prompt);
    } else {
      const textarea = document.createElement("textarea");
      textarea.value = prompt;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      const copied = document.execCommand("copy");
      textarea.remove();
      if (!copied) throw new Error("浏览器未允许复制");
    }
    const originalLabel = button?.textContent || "复制源提示词";
    if (button) {
      button.textContent = "已复制";
      setTimeout(() => { button.textContent = originalLabel; }, 1600);
    }
    toast(messages.success || "源视频原始提示词已复制");
  } catch (error) {
    toast(`复制失败：${error.message}`);
  }
}

function formatDuration(milliseconds) {
  const ms = Math.max(0, Number(milliseconds || 0));
  if (!ms) return "—";
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes} 分 ${remainder} 秒`;
}

function localTime(value) {
  if (!value) return "";
  try { return new Date(value).toLocaleString("zh-CN", { hour12: false }); } catch { return String(value); }
}

function statusLabel(job) {
  const labels = {
    auditing: "拆解源画布",
    preparing_history_remake: "复用历史模板",
    awaiting_configuration: "选择目标资产",
    preparing_mapping: "建立产品形态映射",
    awaiting_mapping_confirmation: "等待形态映射确认",
    preparing_assets: "编译并生成资产",
    regenerating_image_candidates: "第二轮生图",
    resuming_interrupted_stage: "从中断检查点恢复",
    awaiting_asset_confirmation: "等待资产确认",
    generating_video: "并发生成视频",
    quality_checking: "成片质量检验",
    quality_retrying: "人工质检后生成第 2 轮",
    archiving_result: "正在归档成片",
    awaiting_manual_review: "等待人工质检",
    success: "已完成",
    partial_success: "部分完成",
    failed: "任务失败",
    interrupted: "任务已中断"
  };
  return labels[job.status] || job.stage || "后台任务";
}

function usesSharedHistorySnapshot(job) {
  return Boolean(
    job?.status === "preparing_history_remake"
    || job?.historySnapshot?.sourceCanvasAccessRequired === false
    || job?.source?.accessCheck?.source === "shared_oss_snapshot"
  );
}

function activateTab(name) {
  $$(".mode-tab").forEach((button) => button.classList.toggle("is-active", button.dataset.tab === name));
  $$(".tab-panel").forEach((panel) => { panel.hidden = panel.dataset.panel !== name; });
  document.body.classList.toggle("remake-workspace-active", name === "workspace");
  $("#modeTabs").hidden = name === "workspace";
  if (name === "tasks") window.dispatchEvent(new CustomEvent("module-task-updated"));
  if (name === "history") loadHistory(state.historyPage);
  if (name === "library") searchLibrary(1);
}

const WORKFLOW_STEP_ORDER = ["source", "audit", "assets", "results"];
const ASSET_STAGE_STATUSES = new Set([
  "awaiting_configuration", "preparing_mapping", "awaiting_mapping_confirmation",
  "preparing_assets", "regenerating_image_candidates", "resuming_interrupted_stage", "awaiting_asset_confirmation"
]);
const RESULT_STAGE_STATUSES = new Set([
  "creating_task_canvas", "generating_video", "quality_checking", "quality_retrying", "archiving_result", "awaiting_manual_review"
]);
const JOB_FAILURE_WORKFLOW_STEPS = Object.freeze({
  audit_failed: "audit",
  history_remake_failed: "audit",
  mapping_preparation_failed: "assets",
  asset_preparation_failed: "assets",
  video_generation_failed: "results"
});

function jobFailureWorkflowStep(job) {
  if (job?.status !== "failed" || job?.failure?.scope !== "job") return "";
  const explicitStep = JOB_FAILURE_WORKFLOW_STEPS[job.failure.stage];
  if (explicitStep) return explicitStep;
  const targets = job.targets || [];
  if (targets.some((target) => Boolean(target.confirmedAt) || Boolean(target.result))) return "results";
  return job.audit ? "assets" : "audit";
}

function workflowStepSnapshot(job) {
  if (!job) {
    return {
      activeStep: "source",
      states: { source: "active", audit: "pending", assets: "pending", results: "pending" }
    };
  }

  const targets = job.targets || [];
  const assetsConfirmed = targets.length > 0 && targets.every((target) => Boolean(target.confirmedAt));
  const resultComplete = ["success", "partial_success"].includes(job.status);
  const resultStarted = assetsConfirmed
    || RESULT_STAGE_STATUSES.has(job.status)
    || targets.some((target) => Boolean(target.result) || ["generating_video", "quality_checking", "awaiting_manual_review", "success", "review_required"].includes(target.status));
  const assetsComplete = assetsConfirmed || RESULT_STAGE_STATUSES.has(job.status) || resultComplete;
  let activeStep = "audit";
  if (job.audit || ASSET_STAGE_STATUSES.has(job.status)) activeStep = "assets";
  if (resultStarted || resultComplete) activeStep = "results";
  activeStep = jobFailureWorkflowStep(job) || activeStep;

  const states = {
    source: "completed",
    audit: job.audit ? "completed" : "active",
    assets: job.audit ? (assetsComplete ? "completed" : activeStep === "assets" ? "active" : "pending") : "pending",
    results: resultComplete ? "completed" : RESULT_STAGE_STATUSES.has(job.status) ? "active" : "pending"
  };

  if (["failed", "interrupted"].includes(job.status)) {
    states[activeStep] = "error";
  }
  return { activeStep, states };
}

function syncWorkflowStepCopy(job) {
  const sharedSnapshot = usesSharedHistorySnapshot(job);
  const sourceCopy = $('[data-workflow-step="source"] .workflow-step-copy');
  const auditCopy = $('[data-workflow-step="audit"] .workflow-step-copy');
  if (sourceCopy) {
    sourceCopy.querySelector("strong").textContent = sharedSnapshot ? "选择历史模板" : "提交成功画布";
    sourceCopy.querySelector("small").textContent = sharedSnapshot ? "使用全员共享 OSS 快照" : "填写来源与复刻类型";
  }
  if (auditCopy) {
    auditCopy.querySelector("strong").textContent = sharedSnapshot ? "复用拆解快照" : "源画布拆解";
    auditCopy.querySelector("small").textContent = sharedSnapshot ? "不读取源画布，不重复拆解" : "读取资产、模型与参数";
  }
}

function workflowStateLabel(value) {
  return ({ completed: "已完成", active: "进行中", error: "需处理", pending: "待开始" })[value] || "待开始";
}

function selectWorkflowStep(step) {
  if (!WORKFLOW_STEP_ORDER.includes(step)) return;
  const button = $(`[data-workflow-step="${step}"]`);
  if (button?.disabled) return;
  state.workflowStep = step;
  $$("[data-workflow-step]").forEach((item) => item.classList.toggle("is-selected", item.dataset.workflowStep === step));
  $$("[data-workflow-section]").forEach((section) => { section.hidden = section.dataset.workflowSection !== step; });
}

function syncWorkflowEmptyStates(job) {
  const sharedSnapshot = usesSharedHistorySnapshot(job);
  const auditEmpty = $('[data-workflow-empty="audit"]');
  const assetsEmpty = $('[data-workflow-empty="assets"]');
  const resultsEmpty = $('[data-workflow-empty="results"]');
  if (auditEmpty) {
    auditEmpty.hidden = Boolean($("#auditStageFailure")?.children.length || $("#auditResult")?.children.length);
    auditEmpty.textContent = job
      ? (job.message || (sharedSnapshot ? "正在恢复共享 OSS 拆解快照…" : "正在等待源画布拆解结果…"))
      : "提交成功画布后，可在这里查看拆解结果。";
  }
  if (assetsEmpty) {
    const hasAssetsContent = ["#assetStageFailure", "#targetConfigurator", "#mappingConfirmation", "#candidateConfirmation", "#assetConfirmationSummary"]
      .some((selector) => Boolean($(selector)?.children.length));
    assetsEmpty.hidden = hasAssetsContent;
    assetsEmpty.textContent = job?.audit
      ? (job.message || "正在准备上游资产配置…")
      : sharedSnapshot
        ? "恢复共享拆解快照后，可在这里配置并确认上游资产。"
        : "完成源画布拆解后，可在这里配置并确认上游资产。";
  }
  if (resultsEmpty) {
    resultsEmpty.hidden = Boolean($("#resultGrid")?.children.length);
    resultsEmpty.textContent = RESULT_STAGE_STATUSES.has(job?.status)
      ? (job.message || "视频正在后台生成，完成后将在这里显示结果。")
      : "确认全部上游资产后，将在这里显示生成、质检与下载结果。";
  }
}

function updateWorkflowNavigation(job, { force = false } = {}) {
  syncWorkflowStepCopy(job);
  const snapshot = workflowStepSnapshot(job);
  const confirmedTargets = (job?.targets || []).filter((target) => target.confirmedAt).length;
  const signature = JSON.stringify([job?.id || "new", job?.status || "new", Boolean(job?.audit), confirmedTargets]);
  if (force || signature !== state.workflowSignature) {
    state.workflowSignature = signature;
    state.workflowStep = snapshot.activeStep;
  }

  $$("[data-workflow-step]").forEach((button) => {
    const step = button.dataset.workflowStep;
    const value = snapshot.states[step] || "pending";
    button.classList.remove("is-active", "is-completed", "is-error");
    const stateClass = value === "completed" ? "is-completed" : value === "error" ? "is-error" : value === "active" ? "is-active" : "";
    if (stateClass) button.classList.add(stateClass);
    button.disabled = value === "pending";
    button.querySelector("[data-workflow-state]").textContent = workflowStateLabel(value);
    button.setAttribute("aria-current", step === snapshot.activeStep ? "step" : "false");
  });
  selectWorkflowStep(state.workflowStep);
  syncWorkflowEmptyStates(job);
}

function showWorkspace(job = state.currentJob, options = {}) {
  activateTab("workspace");
  updateWorkflowNavigation(job, options);
}

function showTaskLanding() {
  state.pollEpoch += 1;
  state.polling = false;
  state.currentJobId = "";
  const url = new URL(window.location.href);
  url.searchParams.delete("task");
  window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  activateTab("tasks");
}

function fillChangeTypes() {
  const select = $("#changeType");
  select.innerHTML = state.config.changeTypes.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.label)}</option>`).join("");
  $("#libraryChangeType").innerHTML = '<option value="">全部类型</option>' + state.config.changeTypes
    .map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.label)}</option>`).join("");
  $("#libraryProductId").innerHTML = '<option value="">全部产品</option>' + state.config.products
    .map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`).join("");
}

function imagePromptRuleForJob(job) {
  if (job?.imagePromptCategory?.id) return job.imagePromptCategory;
  return (state.config?.imagePromptCategories || []).find((item) => (
    Array.isArray(item.appliesToChangeTypes) && item.appliesToChangeTypes.includes(job?.changeType?.id)
  )) || null;
}

function imagePromptRuleCard(job, compact = false) {
  const category = imagePromptRuleForJob(job);
  if (!category) return "";
  const mode = category.generationMode === "image_generation" ? "调用生图模型" : "确定性复用，不调用生图模型";
  return `
    <div class="change-type-prompt-rule ${compact ? "is-compact" : ""}" data-image-prompt-rule="${escapeHtml(category.id)}">
      <div><span>本次生图分类</span><b>${escapeHtml(category.label)}</b><em>${escapeHtml(mode)}</em></div>
      <p>${escapeHtml(category.builtInPrompt || "")}</p>
    </div>
  `;
}

function renderTimings(job) {
  const timingRows = usesSharedHistorySnapshot(job)
    ? [
        ["共享快照恢复", job.timings?.snapshotRestoreMs],
        ["形态识别与映射", job.timings?.mappingMs],
        ["提示词编译", job.timings?.promptCompileMs],
        ["候选图生成", job.timings?.imageGenerateMs],
        ["视频生成与下载", job.timings?.videoGenerateMs]
      ]
    : [
        ["画布拆解", job.timings?.auditMs],
        ["拆解归档", job.timings?.archiveMs],
        ["形态识别与映射", job.timings?.mappingMs],
        ["提示词编译", job.timings?.promptCompileMs],
        ["候选图生成", job.timings?.imageGenerateMs],
        ["视频生成与下载", job.timings?.videoGenerateMs]
      ];
  $("#timingGrid").innerHTML = timingRows.map(([label, duration]) => `
    <div class="timing-card"><span>${escapeHtml(label)}</span><b>${formatDuration(duration)}</b></div>
  `).join("");
  $("#eventList").innerHTML = (job.events || []).slice().reverse().map((event) => `
    <div class="event-row"><span>${escapeHtml(new Date(event.at).toLocaleTimeString("zh-CN", { hour12: false }))}</span><b>${escapeHtml(event.stage)}</b><span>${escapeHtml(event.message)}</span></div>
  `).join("") || '<p class="form-hint">后台尚未产生过程记录。</p>';
}

function sourceAssetPreviewCard(asset) {
  const mediaType = ["image", "video", "audio", "text"].includes(asset?.mediaType) ? asset.mediaType : "file";
  const mediaLabel = { image: "图片", video: "视频", audio: "音频", text: "文本", file: "文件" }[mediaType];
  const actionLabel = { image: "点击放大查看", video: "点击放大播放", audio: "点击试听", text: "正文见右侧", file: "暂不支持预览" }[mediaType];
  const url = String(asset?.url || "").trim();
  const label = String(asset?.label || "未命名源资产");
  const disabled = (!url && mediaType !== "text") || ["text", "file"].includes(mediaType);
  let visual = '<span class="source-asset-file-icon" aria-hidden="true">FILE</span>';
  if (mediaType === "image" && url) {
    visual = `<img src="${escapeHtml(url)}" alt="" loading="lazy" referrerpolicy="no-referrer" />`;
  } else if (mediaType === "video" && url) {
    visual = `<video src="${escapeHtml(url)}" muted playsinline preload="metadata" aria-hidden="true"></video><span class="source-asset-play-icon" aria-hidden="true">▶</span>`;
  } else if (mediaType === "audio") {
    visual = '<span class="source-asset-audio-icon" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span>';
  } else if (mediaType === "text") {
    const text = Array.isArray(asset?.content) ? asset.content.join("\n") : "";
    visual = `<span class="source-asset-text-preview">${escapeHtml(text.slice(0, 90) || "空文本节点")}</span>`;
  }
  return `
    <button class="source-asset-preview is-${mediaType}" type="button"
      data-source-asset-preview data-media-type="${escapeHtml(mediaType)}"
      data-media-url="${escapeHtml(url)}" data-media-label="${escapeHtml(label)}"
      aria-label="${escapeHtml(`${actionLabel}：${label}`)}" ${disabled ? "disabled" : ""}>
      <span class="source-asset-visual">${visual}<em>${escapeHtml(mediaLabel)}</em></span>
      <small>${escapeHtml(actionLabel)}</small>
    </button>
  `;
}

function closeSourceAssetPreview() {
  const dialog = $("#sourceAssetPreviewDialog");
  const mediaHost = $("#sourceAssetPreviewBody");
  for (const media of $$("audio, video", mediaHost)) media.pause();
  mediaHost.replaceChildren();
  if (dialog.open) dialog.close();
}

function openSourceAssetPreview(button) {
  const dialog = $("#sourceAssetPreviewDialog");
  const mediaHost = $("#sourceAssetPreviewBody");
  const title = $("#sourceAssetPreviewTitle");
  const hint = $("#sourceAssetPreviewHint");
  const mediaType = button.dataset.mediaType;
  const url = button.dataset.mediaUrl;
  const label = button.dataset.mediaLabel || "源资产";
  if (!url || !["image", "video", "audio"].includes(mediaType)) return;
  const media = document.createElement(mediaType === "image" ? "img" : mediaType);
  media.src = url;
  if (mediaType === "image") media.alt = label;
  else {
    media.controls = true;
    media.autoplay = true;
    media.preload = "auto";
  }
  title.textContent = label;
  hint.textContent = mediaType === "image" ? "源图片原图查看" : mediaType === "video" ? "源参考视频播放" : "源参考音频试听";
  mediaHost.replaceChildren(media);
  dialog.showModal();
}

$("[data-close-source-asset-preview]")?.addEventListener("click", closeSourceAssetPreview);
$("#sourceAssetPreviewDialog")?.addEventListener("click", (event) => {
  if (event.target === event.currentTarget) closeSourceAssetPreview();
});
$("#sourceAssetPreviewDialog")?.addEventListener("close", () => {
  const mediaHost = $("#sourceAssetPreviewBody");
  for (const media of $$("audio, video", mediaHost)) media.pause();
  mediaHost.replaceChildren();
});

function sourceAssetProcessingBadge(asset) {
  if (asset.mediaType === "text" && asset.auditConflict) return '<span class="badge is-danger">文本节点存在冲突</span>';
  if (asset.replacementStrategy === "rewrite_text") return '<span class="badge is-warning">按目标 SKU 改写文本</span>';
  if (asset.replacementStrategy === "reuse_text") return '<span class="badge is-ok">文本节点原样复用</span>';
  if (asset.replacementStrategy === "direct_oss_product_asset") return '<span class="badge is-ok">直连 OSS 产品图</span>';
  if (asset.rebuildRequired) return `<span class="badge is-warning">${asset.productBearing ? "生成换品候选图" : "先生成候选图"}</span>`;
  return `<span class="badge is-ok">${asset.mediaType === "image" ? "源图直接复用" : "原样复用"}</span>`;
}

function productPresenceControl(job, asset) {
  const editable = job.changeType?.changesProduct === true
    && asset.mediaType === "image"
    && ["awaiting_configuration", "awaiting_mapping_confirmation"].includes(job.status);
  if (!editable) return sourceAssetProcessingBadge(asset);
  const decision = asset.productBearing === true ? "replace" : "reuse";
  const needsReview = asset.productPresenceReview?.needsHumanReview === true;
  const humanConfirmed = asset.productPresenceReview?.decisionSource === "human";
  const reuseLabel = job.changeType?.changesBackground || job.changeType?.changesPerson ? "不含原产品" : "直接复用";
  return `
    <div class="product-presence-control" data-product-presence-control data-source-key="${escapeHtml(asset.nodeKey)}">
      ${needsReview ? '<small class="product-presence-check">请人工看一眼</small>' : humanConfirmed ? '<small class="product-presence-confirmed">已人工确认</small>' : ""}
      <div class="product-presence-options" role="group" aria-label="这张图是否需要换品">
        <button type="button" data-product-presence="replace" aria-pressed="${decision === "replace"}" class="${decision === "replace" ? "is-selected" : ""}">需要换品</button>
        <button type="button" data-product-presence="reuse" aria-pressed="${decision === "reuse"}" class="${decision === "reuse" ? "is-selected" : ""}">${reuseLabel}</button>
      </div>
      ${sourceAssetProcessingBadge(asset)}
    </div>
  `;
}

async function updateProductPresence(job, button) {
  const control = button.closest("[data-product-presence-control]");
  const decision = button.dataset.productPresence;
  const current = button.getAttribute("aria-pressed") === "true";
  if (!control || current || !["replace", "reuse"].includes(decision)) return;
  const buttons = $$('[data-product-presence]', control);
  buttons.forEach((item) => { item.disabled = true; });
  try {
    const payload = await apiJson(`./api/one-click-remake/jobs/${encodeURIComponent(job.id)}/audit/product-presence`, {
      method: "PATCH",
      body: JSON.stringify({ nodeKey: control.dataset.sourceKey, decision })
    });
    renderJob(payload.job);
    const reuseKeepsGeneration = Boolean(job.changeType?.changesBackground || job.changeType?.changesPerson);
    toast(
      decision === "replace"
        ? "已改为需要换品，后续将生成候选图。"
        : reuseKeepsGeneration
          ? "已改为不含原产品，仍按本次其他变更生成候选图。"
          : "已改为不含原产品，后续按源图复用。"
    );
  } catch (error) {
    buttons.forEach((item) => { item.disabled = false; });
    toast(error.message);
  }
}

function renderAudit(job) {
  const host = $("#auditResult");
  if (!job.audit) { host.innerHTML = ""; return; }
  const sharedSnapshot = usesSharedHistorySnapshot(job);
  const promptDetailsKey = `one-click-remake-source-prompt-open:${job.id}`;
  const currentPromptDetails = $(".prompt-details", host);
  if (currentPromptDetails) localStorage.setItem(promptDetailsKey, currentPromptDetails.open ? "1" : "0");
  const promptDetailsOpen = localStorage.getItem(promptDetailsKey) === "1";
  const rebuildCount = job.audit.assets.filter((asset) => asset.generationRequired ?? asset.rebuildRequired).length;
  const directCount = job.audit.assets.filter((asset) => asset.replacementStrategy === "direct_oss_product_asset").length;
  host.innerHTML = `
    <section class="audit-card">
      <div class="panel-head"><div><span class="step-no">02</span><h2>${sharedSnapshot ? "共享拆解快照" : "源画布拆解"}</h2></div><span class="badge is-ok">${sharedSnapshot ? "已直接复用" : "TaskID 已命中"}</span></div>
      <div class="audit-summary">
        <div><span>视频类型</span><b>${escapeHtml(job.audit.videoType)}</b></div>
        <div><span>源模型</span><b>${escapeHtml(job.source.model || "未返回")}</b></div>
        <div><span>模式 / 时长</span><b>${escapeHtml(job.source.modeType || "—")} · ${escapeHtml(job.source.settings?.duration || "—")}s</b></div>
        <div><span>需生成 / OSS直连</span><b>${rebuildCount} / ${directCount}</b></div>
      </div>
      <p class="archive-note">任务画布：${escapeHtml(job.canvas?.canvasName || "正在创建")} · 原片产品：${escapeHtml(job.sourceProduct?.name || "待人工确认")} · ${job.sourceProductMatch?.requiresConfirmation ? "请在下方确认" : `匹配置信度 ${Math.round(Number(job.sourceProductMatch?.confidence || 0) * 100)}%`}</p>
      ${sharedSnapshot
        ? '<p class="archive-note">已直接复用共享 OSS 拆解快照 · 未读取或重新拆解源画布</p>'
        : job.sourceArchive ? `<p class="archive-note">${job.sourceArchive.storage?.ossSynced ? "拆解快照已存入平台 OSS" : "拆解快照已保存，OSS 正在等待自动同步"} · 已加入“历史任务做同款”</p>` : ""}
      ${job.audit.warning ? `<p class="form-hint">${escapeHtml(job.audit.warning)}</p>` : ""}
      <div class="asset-audit-table-wrap" tabindex="0" aria-label="源画布拆解资产表，可横向滚动查看">
        <table class="asset-audit-table">
          <thead><tr><th>序号</th><th>源资产预览</th><th>节点内容与识别依据</th><th>处理方式</th></tr></thead>
          <tbody>
            ${job.audit.assets.map((asset) => `
              <tr>
                <td class="asset-audit-order">${String(asset.order).padStart(2, "0")}</td>
                <td class="asset-audit-media">${sourceAssetPreviewCard(asset)}</td>
                <td class="asset-audit-content">
                  <b>${escapeHtml(asset.label)}</b>
                  <p>${escapeHtml(asset.reason)}</p>
                  ${asset.mediaType === "text" ? `<pre class="asset-text-content">${escapeHtml((asset.content || []).join("\n") || "（空文本）")}</pre>` : ""}
                  ${asset.productFacts ? `<small>形态：${escapeHtml(asset.productFacts.layer || "待核实")} · 视角：${escapeHtml(asset.productFacts.view || "unknown")} · 置信度：${Math.round(Number(asset.productFacts.confidence || 0) * 100)}%<br>观察数量：${escapeHtml(asset.productFacts.productCount ?? "未确定")} · 可靠实例框：${productGeometryReviewState(asset).reliableInstanceCount}<br>${escapeHtml(asset.productFacts.evidence || "")}</small>` : ""}
                </td>
                <td>${productPresenceControl(job, asset)}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
      <details class="prompt-details" ${promptDetailsOpen ? "open" : ""}><summary>查看源视频原始提示词</summary><div class="prompt-action-row"><button class="secondary-button compact-button" type="button" data-copy-source-prompt>复制源提示词</button></div><pre>${escapeHtml(job.source.prompt)}</pre></details>
      <details><summary>查看源节点生成参数</summary><pre>${jsonText(job.source.params)}</pre></details>
    </section>
  `;
  $$('[data-source-asset-preview]', host).forEach((button) => button.addEventListener("click", () => openSourceAssetPreview(button)));
  $$('[data-product-presence]', host).forEach((button) => button.addEventListener("click", () => updateProductPresence(job, button)));
  $("[data-copy-source-prompt]", host)?.addEventListener("click", (event) => copyPromptText(job.source.prompt, event.currentTarget));
  $(".prompt-details", host)?.addEventListener("toggle", (event) => {
    localStorage.setItem(promptDetailsKey, event.currentTarget.open ? "1" : "0");
  });
}

let assetStripLayoutFrame = 0;

function layoutProductAssetStrips(scope = document, resetScroll = false) {
  cancelAnimationFrame(assetStripLayoutFrame);
  assetStripLayoutFrame = requestAnimationFrame(() => {
    for (const strip of $$(".asset-strip", scope)) {
      const visibleOptions = $$(".asset-option:not([hidden])", strip);
      strip.style.maxHeight = "";
      strip.classList.toggle("is-scrollable", visibleOptions.length > 6);
      if (visibleOptions.length > 6) {
        const stripTop = strip.getBoundingClientRect().top;
        const secondRowBottom = visibleOptions[5].getBoundingClientRect().bottom;
        strip.style.maxHeight = `${Math.ceil(secondRowBottom - stripTop + 1)}px`;
        strip.tabIndex = 0;
        strip.setAttribute("aria-label", "产品图，可向下滚动查看更多");
      } else {
        strip.removeAttribute("tabindex");
        strip.removeAttribute("aria-label");
      }
      if (resetScroll) strip.scrollTop = 0;
    }
  });
}

function productCard(product, variant, sourceProductId, sourcePrompt, selectedChangeType = {}) {
  const assets = product.assets || [];
  const recommendedStateId = product.recommendedDisplayStateId || product.states?.find((item) => item.selectable)?.id || "";
  const variantPrompt = variant?.variantPrompt || variant?.compiled || sourcePrompt || "";
  return `
    <article class="target-card" data-product-card="${escapeHtml(product.id)}" ${String(product.id) === String(sourceProductId || "") ? "hidden" : ""}>
      <label class="target-check"><input type="checkbox" data-product-select value="${escapeHtml(product.id)}" />${escapeHtml(product.name)}</label>
      <label class="display-state-field"><span>新视频产品展示形态</span><select data-product-state="${escapeHtml(product.id)}">
        ${(product.states || []).map((item) => `<option value="${escapeHtml(item.id)}" ${item.id === recommendedStateId ? "selected" : ""} ${item.selectable ? "" : "disabled"}>${escapeHtml(item.label)}${item.selectable ? "" : `（不可用：${escapeHtml(item.dataGaps.join("、"))}）`}</option>`).join("")}
      </select><small>只允许选择同时具备尺寸资料和 OSS 原图的形态。</small></label>
      <div class="asset-strip">
        ${assets.map((asset) => `
          <label class="asset-option" data-asset-state="${escapeHtml(asset.displayStateId)}" title="${escapeHtml(asset.title)}" ${asset.displayStateId === recommendedStateId ? "" : "hidden"}>
            <input type="checkbox" data-product-asset="${escapeHtml(product.id)}" value="${escapeHtml(asset.id)}" />
            <img src="${escapeHtml(asset.thumbnailUrl)}" alt="${escapeHtml(asset.title)}" loading="lazy" />
            <small>${escapeHtml(asset.angleLabel || asset.title)} · ${escapeHtml(asset.view || "unknown")}${asset.recommended ? " · 平台推荐，需手动勾选" : ""}</small>
          </label>
        `).join("") || '<p class="form-hint">该 SKU 暂无图片资产。</p>'}
      </div>
      <label class="video-prompt-field"><span>${escapeHtml(product.name)} 新视频提示词${selectedChangeType.changesVoiceover ? "（含新口播文案）" : ""}</span><textarea data-product-video-prompt="${escapeHtml(product.id)}" data-variant-source-product="${escapeHtml(variant?.promptDiff?.sourceProductId || sourceProductId || "")}" placeholder="核实镜头、动作、目标产品事实以及说话人、台词和顺序。">${escapeHtml(variantPrompt)}</textarea><small>${selectedChangeType.changesVoiceover ? "当前分类要求更换口播，请在这里直接修改说话人、逐字台词与顺序；" : ""}这是按该 SKU 编译的最终 variant_prompt，可直接修改；确认后除 nodeKey 的确定性映射外，将原样提交到该 SKU 的 LibTV 视频节点。</small></label>
    </article>
  `;
}

function referenceUploadSection(role, label, options = {}) {
  const alternativeGeneration = options.alternativeGeneration === true;
  const directFirstFrame = options.directFirstFrame === true;
  return `
    <section class="reference-upload-card" data-reference-role="${escapeHtml(role)}">
      <div class="reference-upload-head">
        <div><b>${directFirstFrame ? "方式一：上传完整新首帧" : alternativeGeneration ? "方式一：自行上传" : `目标${escapeHtml(label)}参考图`}</b><small>${directFirstFrame ? "限 1 张 · 直接替换源首帧 nodeKey · 不再生图" : alternativeGeneration ? "上传 1–3 张，或从右侧生成结果中选择 1 张" : "必传 1–3 张"} · PNG/JPG/WEBP · 单张不超过 10MB</small></div>
        <label class="secondary-button reference-upload-button">选择图片<input type="file" data-reference-input="${escapeHtml(role)}" accept="image/png,image/jpeg,image/webp" ${directFirstFrame ? "" : "multiple"} hidden /></label>
      </div>
      <div class="reference-upload-list" data-reference-list="${escapeHtml(role)}"><p class="form-hint">尚未上传${escapeHtml(label)}参考图。</p></div>
      <label class="reference-instruction"><span>${directFirstFrame ? "首帧续拍" : escapeHtml(label) + "替换"}补充说明（可选）</span><textarea data-reference-instruction="${escapeHtml(role)}" placeholder="例如：${directFirstFrame ? "从上传首帧自然开始运动，保持原视频镜头节奏" : role === "background" ? "替换为明亮办公室，保留原机位、人物动作与产品位置" : "只替换人物身份，保留原年龄感、动作、表情节奏和手部接触"}"></textarea></label>
    </section>
  `;
}

function backgroundSceneSource(job) {
  const images = (job.audit?.assets || []).filter((asset) => asset.mediaType === "image" && asset.url);
  if (!images.length) return null;
  const ranked = images.map((asset, index) => {
    const descriptor = `${asset.role || ""} ${asset.label || ""}`.toLowerCase();
    return { asset, score: /首帧|0秒|0s|first.?frame|start.?frame/.test(descriptor) ? 1000 - index : 100 - index };
  });
  ranked.sort((left, right) => right.score - left.score);
  return ranked[0].asset;
}

function usesUploadedFirstFrame(job) {
  return job?.changeType?.changesBackground === true
    && job?.changeType?.changesProduct !== true
    && job?.changeType?.changesPerson !== true;
}

function syncBackgroundSceneChoiceUi() {
  const configurator = $("#targetConfigurator");
  const selectedId = state.backgroundSceneChoice.candidateId || "";
  const uploadCard = $('[data-reference-role="background"]', configurator);
  const generatorCard = $("#backgroundSceneGenerator", configurator);
  const hasUploads = Boolean(state.replacementUploads.background.length);
  uploadCard?.classList.toggle("is-selected-method", hasUploads && !selectedId);
  generatorCard?.classList.toggle("is-selected-method", Boolean(selectedId));
  $$('[data-background-scene-candidate]', generatorCard).forEach((input) => {
    input.checked = input.value === selectedId;
  });
  if (state.currentJob?.changeType?.changesBackground && !state.currentJob?.changeType?.changesProduct) {
    const count = $("#prepareAssetsSelectionCount", configurator);
    const hint = $("#prepareAssetsSelectionHint", configurator);
    if (count) count.textContent = selectedId
      ? "已选择 1 张生成背景图"
      : hasUploads ? usesUploadedFirstFrame(state.currentJob) ? "已上传 1 张完整新首帧" : `已上传 ${state.replacementUploads.background.length} 张背景参考图` : "尚未选择目标背景图";
    if (hint) hint.textContent = selectedId || hasUploads
      ? hasUploads && usesUploadedFirstFrame(state.currentJob)
        ? "将直接替换源首帧 nodeKey，不会新增背景参考节点或调用生图"
        : "背景来源已确定，可继续生成上游候选资产"
      : "自行上传或生成后选择一种背景来源即可";
  }
}

function renderBackgroundSceneGenerator(job) {
  const host = $("#backgroundSceneGenerator", $("#targetConfigurator"));
  if (!host) return;
  const generation = job.backgroundSceneGeneration || {};
  const candidates = Array.isArray(generation.candidates) ? generation.candidates : [];
  const rounds = Array.isArray(generation.rounds) ? generation.rounds : [];
  const source = backgroundSceneSource(job);
  const generating = ["queued", "running"].includes(generation.status);
  const maxRounds = Number(state.config?.backgroundSceneGeneration?.maxRounds || 2);
  const completedRounds = Math.max(0, ...rounds.map((item) => Number(item.round || 0)));
  const exhausted = completedRounds >= maxRounds;
  const signature = JSON.stringify({
    status: generation.status || "idle",
    error: generation.error || "",
    completedRounds,
    candidates: candidates.map((candidate) => [candidate.id, candidate.round, candidate.model]),
    selectedId: state.backgroundSceneChoice.candidateId || ""
  });
  if (host.dataset.signature === signature) {
    const prepareButton = $("#prepareAssetsButton", $("#targetConfigurator"));
    if (prepareButton) prepareButton.disabled = generating || state.uploading;
    syncBackgroundSceneChoiceUi();
    return;
  }
  const existingPrompt = $("[data-background-scene-prompt]", host)?.value;
  if (typeof existingPrompt === "string") state.backgroundSceneChoice.prompt = existingPrompt;
  if (!state.backgroundSceneChoice.prompt && generation.prompt) state.backgroundSceneChoice.prompt = generation.prompt;
  host.dataset.signature = signature;
  const actionLabel = exhausted
    ? "已完成两轮生图"
    : generating
      ? `正在生成第 ${Number(generation.activeRound || completedRounds + 1)} 轮的 2 张图片…`
      : completedRounds
        ? "不满意，重新生成 2 张"
        : generation.status === "failed" ? "重新生成 2 张" : "生成 2 张新背景";
  const statusCopy = generating
    ? "正在提取首帧构图、清除人物与产品并生成空场景，完成后会自动回传。"
    : generation.error
      ? `上次生成失败：${generation.error}`
      : candidates.length
        ? `已回传 ${candidates.length} 张候选图；选择 1 张即可，旧候选会在第二轮后继续保留。`
        : "将画布首帧作为机位与透视参考，人物和产品会被彻底移除。";
  host.innerHTML = `
    <div class="reference-upload-head background-generator-head">
      <div><b>方式二：生成新的背景图</b><small>一次 2 张 · 最多 2 轮 · 与自行上传二选一</small></div>
      <span class="badge ${source ? "is-ok" : "is-danger"}">${source ? `已提取：${escapeHtml(source.label || source.role || "画布首帧")}` : "画布无可用首帧"}</span>
    </div>
    <label class="background-scene-prompt"><span>新背景生图提示词</span><textarea data-background-scene-prompt placeholder="例如：明亮通透的现代办公室，浅灰墙面与浅木地板，窗外柔和日光，空间整洁，不出现人物、产品和文字。">${escapeHtml(state.backgroundSceneChoice.prompt || "")}</textarea><small>平台会自动追加去人物、去产品、去 Logo/文字和空场景硬约束。</small></label>
    <button class="secondary-button background-generate-button" type="button" data-generate-background-scenes ${generating || exhausted || !source ? "disabled" : ""}>${escapeHtml(actionLabel)}</button>
    <p class="background-generation-status ${generation.error ? "is-error" : ""}" aria-live="polite">${escapeHtml(statusCopy)}</p>
    <div class="background-scene-candidates">
      ${candidates.map((candidate) => `
        <label class="background-scene-candidate">
          <input type="radio" name="background-scene-${escapeHtml(job.id)}" value="${escapeHtml(candidate.id)}" data-background-scene-candidate ${state.backgroundSceneChoice.candidateId === candidate.id ? "checked" : ""} />
          <img src="${escapeHtml(candidate.previewUrl)}" alt="第 ${Number(candidate.round || 1)} 轮背景候选 ${Number(candidate.candidateIndex || 0) + 1}" loading="lazy" />
          <span><b>第 ${Number(candidate.round || 1)} 轮 · 候选 ${Number(candidate.candidateIndex || 0) + 1}</b><small>${escapeHtml(candidate.model || "生图模型")}</small></span>
        </label>
      `).join("")}
    </div>
  `;
  $("[data-background-scene-prompt]", host)?.addEventListener("input", (event) => {
    state.backgroundSceneChoice.prompt = event.currentTarget.value;
  });
  $("[data-generate-background-scenes]", host)?.addEventListener("click", (event) => generateBackgroundScenes(job, event.currentTarget));
  $$('[data-background-scene-candidate]', host).forEach((input) => input.addEventListener("change", () => {
    state.backgroundSceneChoice.candidateId = input.value;
    syncBackgroundSceneChoiceUi();
  }));
  const prepareButton = $("#prepareAssetsButton", $("#targetConfigurator"));
  if (prepareButton) prepareButton.disabled = generating || state.uploading;
  syncBackgroundSceneChoiceUi();
}

async function generateBackgroundScenes(job, button) {
  const prompt = $("[data-background-scene-prompt]", $("#backgroundSceneGenerator"))?.value.trim() || "";
  if (!prompt) return toast("请先填写新背景生图提示词");
  state.backgroundSceneChoice.prompt = prompt;
  button.disabled = true;
  button.textContent = "已提交 2 张背景图…";
  try {
    const payload = await apiJson(`./api/one-click-remake/jobs/${encodeURIComponent(job.id)}/background-scene-candidates/generate`, {
      method: "POST",
      body: JSON.stringify({ prompt })
    });
    state.currentJob = payload.job;
    renderJob(payload.job);
    toast("已发起 2 张纯背景场景图，生成完成后会自动回传。");
    pollCurrentJob();
  } catch (error) {
    button.disabled = false;
    button.textContent = "生成 2 张新背景";
    toast(error.message);
  }
}

function renderReferenceUploadList(role) {
  const host = $(`[data-reference-list="${role}"]`, $("#targetConfigurator"));
  if (!host) return;
  const items = state.replacementUploads[role] || [];
  host.innerHTML = items.length ? items.map((item, index) => `
    <article class="reference-upload-item">
      <img src="${escapeHtml(item.previewUrl)}" alt="${escapeHtml(item.name)}" />
      <span><b>${escapeHtml(item.name)}</b><small>${item.progress < 100 ? `上传中 ${item.progress}%` : "已上传并绑定当前任务"}</small></span>
      <button type="button" data-remove-reference="${escapeHtml(role)}" data-reference-index="${index}" ${item.progress < 100 ? "disabled" : ""}>移除</button>
    </article>
  `).join("") : `<p class="form-hint">尚未上传${role === "background" ? "背景" : "人物"}参考图。</p>`;
  $$(`[data-remove-reference="${role}"]`, host).forEach((button) => button.addEventListener("click", () => {
    const removed = state.replacementUploads[role].splice(Number(button.dataset.referenceIndex), 1)[0];
    if (removed?.previewUrl?.startsWith("blob:")) URL.revokeObjectURL(removed.previewUrl);
    renderReferenceUploadList(role);
    if (role === "background") syncBackgroundSceneChoiceUi();
  }));
}

async function handleReferenceUpload(job, role, files) {
  const accepted = [...files].filter(Boolean);
  const existing = state.replacementUploads[role] || [];
  const maxFiles = role === "background" && usesUploadedFirstFrame(job) ? 1 : 3;
  if (!accepted.length) return;
  if (existing.length + accepted.length > maxFiles) return toast(maxFiles === 1
    ? "请只上传 1 张完整新首帧；如需更换，请先移除当前图片"
    : `${role === "background" ? "背景" : "人物"}参考图最多上传 3 张`);
  state.uploading = true;
  const prepareButton = $("#prepareAssetsButton");
  if (prepareButton) prepareButton.disabled = true;
  const kind = role === "background" ? "remake-background" : "remake-person";
  const session = `one-click-remake-${job.id}`;
  try {
    for (const file of accepted) {
      const record = { name: file.name, path: "", progress: 0, previewUrl: URL.createObjectURL(file) };
      state.replacementUploads[role].push(record);
      renderReferenceUploadList(role);
      try {
        const uploaded = await uploadReferenceFile(kind, file, session, (progress) => {
          record.progress = progress;
          renderReferenceUploadList(role);
        });
        record.path = uploaded.path;
        record.name = uploaded.name || file.name;
        record.progress = 100;
        if (role === "background") {
          state.backgroundSceneChoice.candidateId = "";
          syncBackgroundSceneChoiceUi();
        }
      } catch (error) {
        state.replacementUploads[role] = state.replacementUploads[role].filter((item) => item !== record);
        URL.revokeObjectURL(record.previewUrl);
        throw error;
      }
      renderReferenceUploadList(role);
    }
  } catch (error) {
    toast(error.message);
  } finally {
    state.uploading = false;
    if (prepareButton) {
      prepareButton.disabled = ["queued", "running"].includes(state.currentJob?.backgroundSceneGeneration?.status);
    }
  }
}

function renderTargetConfigurator(job) {
  const host = $("#targetConfigurator");
  if (job.status !== "awaiting_configuration") { host.innerHTML = ""; host.dataset.jobId = ""; return; }
  if (host.dataset.jobId === job.id) {
    renderBackgroundSceneGenerator(job);
    return;
  }
  if (state.uploadJobId !== job.id) {
    for (const items of Object.values(state.replacementUploads)) {
      for (const item of items) if (item.previewUrl?.startsWith("blob:")) URL.revokeObjectURL(item.previewUrl);
    }
    state.replacementUploads = { background: [], person: [] };
    state.backgroundSceneChoice = {
      jobId: job.id,
      candidateId: "",
      prompt: job.backgroundSceneGeneration?.prompt || ""
    };
    state.uploadJobId = job.id;
  }
  host.dataset.jobId = job.id;
  const sourceProductId = job.sourceProduct?.id || job.sourceProductMatch?.productId || "";
  const sourceProductSelector = job.changeType.changesProduct ? `
    <div class="source-product-confirm-block">
      <label class="source-product-confirm"><span>原片产品（文字线索 + 原视频视觉理解）</span><select id="sourceProductId" required>
        <option value="">请选择原片产品</option>
        ${state.config.products.map((product) => `<option value="${escapeHtml(product.id)}" ${String(product.id) === String(sourceProductId) ? "selected" : ""}>${escapeHtml(product.name)}</option>`).join("")}
      </select><small>识别，可人工纠正。</small></label>
    </div>
  ` : "";
  const productSection = job.changeType.changesProduct
    ? `${sourceProductSelector}<div class="target-list">${state.config.products.map((product) => productCard(product, job.variantPrompts?.[product.id], sourceProductId, job.source.prompt || "", job.changeType)).join("")}</div>`
    : "";
  const videoPromptSection = !job.changeType.changesProduct
    ? `<label class="video-prompt-field global-video-prompt"><span>新视频提示词${job.changeType.changesVoiceover ? "（含新口播文案）" : ""}</span><textarea id="globalVideoPrompt" placeholder="核实镜头、动作以及说话人、台词和顺序。">${escapeHtml(job.source.prompt || "")}</textarea><small>已完整同步源视频原始提示词，可直接修改。${job.changeType.changesVoiceover ? "当前分类要求更换口播，请在这里修改说话人、逐字台词与顺序；" : ""}提交后这段文字会完整保留在新视频生成节点中。</small></label>`
    : "";
  const nonProductTargetLabel = job.changeType.changesBackground ? "目标背景图" : job.changeType.changesPerson ? "目标人物图" : "本次配置";
  const prepareButtonLabel = job.changeType.changesProduct
    ? "分析产品形态并生成映射"
    : usesUploadedFirstFrame(job)
      ? "确认首帧替换并继续"
      : `确认${job.changeType.changesBackground ? "背景" : job.changeType.changesPerson ? "人物" : "配置"}并生成候选资产`;
  host.innerHTML = `
    <section class="config-section">
      <div class="panel-head"><div><span class="step-no">03</span><h2>确认上游资产</h2></div><small>子步骤 1/3 · 配置${escapeHtml(job.changeType.label)}目标</small></div>
      <p class="form-hint">先选择 SKU 的目标展示形态。平台按源 nodeKey、产品层级和视角分别匹配 OSS 原图；独立产品资料节点禁止重新生图，场景/首帧等承载图才生成候选。</p>
      ${imagePromptRuleCard(job)}
      ${productSection}
      <div class="reference-upload-grid">
        ${job.changeType.changesBackground ? `${referenceUploadSection("background", "背景", { alternativeGeneration: true, directFirstFrame: usesUploadedFirstFrame(job) })}<section class="reference-upload-card background-generator-card" id="backgroundSceneGenerator"></section>` : ""}
        ${job.changeType.changesPerson ? referenceUploadSection("person", "人物") : ""}
      </div>
      ${videoPromptSection}
      <div class="prepare-assets-dock">
        <div class="prepare-assets-summary" aria-live="polite">
          <strong id="prepareAssetsSelectionCount">${job.changeType.changesProduct ? "尚未选择目标产品" : `尚未选择${nonProductTargetLabel}`}</strong>
          <small id="prepareAssetsSelectionHint">${job.changeType.changesProduct ? "勾选产品素材图后，可随时生成映射方案" : job.changeType.changesBackground ? "自行上传完整首帧可直接替换源 nodeKey；平台生成背景仍走候选重构" : "上传目标人物参考图后即可继续"}</small>
        </div>
        <button class="primary-button" id="prepareAssetsButton" type="button">${prepareButtonLabel}</button>
      </div>
    </section>
  `;
  renderBackgroundSceneGenerator(job);
  layoutProductAssetStrips(host, true);
  const updatePrepareAssetsSummary = () => {
    if (!job.changeType.changesProduct) {
      syncBackgroundSceneChoiceUi();
      return;
    }
    const selectedCards = $$('[data-product-select]:checked', host).map((checkbox) => checkbox.closest(".target-card")).filter(Boolean);
    const selectedAssetCount = selectedCards.reduce((total, card) => total + $$('[data-product-asset]:checked', card).length, 0);
    const incompleteCount = selectedCards.filter((card) => !$$('[data-product-asset]:checked', card).length).length;
    const count = $("#prepareAssetsSelectionCount", host);
    const hint = $("#prepareAssetsSelectionHint", host);
    if (count) count.textContent = selectedCards.length ? `已选 ${selectedCards.length} 个产品 · ${selectedAssetCount} 张素材` : "尚未选择目标产品";
    if (hint) hint.textContent = incompleteCount
      ? `${incompleteCount} 个已选产品还未选择素材图`
      : selectedAssetCount ? "选择已记录，准备好后可生成映射方案" : "勾选产品素材图后，可随时生成映射方案";
  };
  const syncSourceProductSelection = (selectedSourceId) => {
    $$('[data-product-card]', host).forEach((card) => {
      const isSource = card.dataset.productCard === selectedSourceId;
      card.hidden = isSource;
      if (isSource) {
        const checkbox = $('[data-product-select]', card);
        if (checkbox) checkbox.checked = false;
        card.classList.remove("is-selected");
      }
    });
    layoutProductAssetStrips(host, true);
    updatePrepareAssetsSummary();
  };
  $("#sourceProductId", host)?.addEventListener("change", (event) => syncSourceProductSelection(event.currentTarget.value));
  const syncProductCardSelection = (card) => {
    if (!card) return;
    const productCheckbox = $('[data-product-select]', card);
    const hasSelectedAsset = $$('[data-product-asset]:checked', card).length > 0;
    if (productCheckbox) productCheckbox.checked = hasSelectedAsset;
    card.classList.toggle("is-selected", hasSelectedAsset);
    updatePrepareAssetsSummary();
  };
  $$('[data-product-select]', host).forEach((checkbox) => {
    checkbox.addEventListener("change", () => {
      const card = checkbox.closest(".target-card");
      card.classList.toggle("is-selected", checkbox.checked);
      updatePrepareAssetsSummary();
    });
  });
  $$('[data-product-asset]', host).forEach((checkbox) => {
    checkbox.addEventListener("change", () => syncProductCardSelection(checkbox.closest(".target-card")));
  });
  $$('[data-product-state]', host).forEach((select) => {
    select.addEventListener("change", () => {
      const card = select.closest(".target-card");
      const matching = $$('[data-asset-state]', card).filter((option) => option.dataset.assetState === select.value);
      $$('[data-asset-state]', card).forEach((option) => {
        const visible = option.dataset.assetState === select.value;
        option.hidden = !visible;
        const input = $('input[type="checkbox"]', option);
        if (!visible && input) input.checked = false;
      });
      syncProductCardSelection(card);
      layoutProductAssetStrips(card, true);
    });
  });
  $$('[data-reference-input]', host).forEach((input) => input.addEventListener("change", () => {
    handleReferenceUpload(job, input.dataset.referenceInput, input.files);
    input.value = "";
  }));
  updatePrepareAssetsSummary();
  $("#prepareAssetsButton", host).addEventListener("click", () => prepareAssets(job));
}

async function prepareAssets(job) {
  if (state.uploading) return toast("参考图仍在上传，请稍候");
  const selected = $$('[data-product-select]:checked', $("#targetConfigurator"));
  if (job.changeType.changesProduct && !selected.length) return toast("请至少选择一个目标 SKU");
  const sourceProductId = $("#sourceProductId")?.value || job.sourceProduct?.id || "";
  if (job.changeType.changesProduct && !sourceProductId) return toast("请先确认原片产品 SKU");
  const targets = [];
  for (const checkbox of selected) {
    const productId = checkbox.value;
    const displayStateId = $(`[data-product-state="${CSS.escape(productId)}"]`)?.value || "";
    const assetIds = $$(`[data-product-asset="${CSS.escape(productId)}"]:checked`).map((input) => input.value);
    if (job.changeType.changesProduct && !assetIds.length) return toast("每个目标 SKU 至少选择一张产品资产图");
    const videoPromptDraft = $(`[data-product-video-prompt="${CSS.escape(productId)}"]`)?.value.trim() || "";
    if (!videoPromptDraft) return toast("请填写每个目标 SKU 的新视频提示词");
    const videoPromptSourceProductId = $(`[data-product-video-prompt="${CSS.escape(productId)}"]`)?.dataset.variantSourceProduct || "";
    targets.push({ productId, displayStateId, assetIds, videoPromptDraft, videoPromptSourceProductId });
  }
  const backgroundCandidateId = state.backgroundSceneChoice.jobId === job.id
    ? state.backgroundSceneChoice.candidateId
    : "";
  if (job.changeType.changesBackground && !state.replacementUploads.background.length && !backgroundCandidateId) {
    return toast(usesUploadedFirstFrame(job)
      ? "请上传 1 张完整新首帧，或选择一张平台生成的新背景图"
      : "请选择一张已生成的新背景图，或至少上传一张目标背景参考图");
  }
  if (job.changeType.changesPerson && !state.replacementUploads.person.length) return toast("请至少上传一张目标人物参考图");
  const videoPromptDraft = $("#globalVideoPrompt")?.value.trim() || "";
  if (!job.changeType.changesProduct && !videoPromptDraft) return toast("请填写新视频提示词");
  const replacementAssets = {
    background: backgroundCandidateId
      ? []
      : state.replacementUploads.background.map((item) => ({ path: item.path, name: item.name })),
    person: state.replacementUploads.person.map((item) => ({ path: item.path, name: item.name }))
  };
  const button = $("#prepareAssetsButton");
  button.disabled = true;
  button.textContent = "已进入后台编译队列…";
  try {
    const payload = await apiJson(`./api/one-click-remake/jobs/${encodeURIComponent(job.id)}/prepare`, {
      method: "POST",
      body: JSON.stringify({
        targets,
        sourceProductId,
        videoPromptDraft,
        replacementAssets,
        backgroundCandidateId,
        backgroundInstruction: $('[data-reference-instruction="background"]')?.value.trim() || "",
        personInstruction: $('[data-reference-instruction="person"]')?.value.trim() || ""
      })
    });
    state.currentJob = payload.job;
    renderJob(payload.job);
    pollCurrentJob();
  } catch (error) {
    button.disabled = false;
    button.textContent = job.changeType.changesProduct
      ? "分析产品形态并生成映射"
      : usesUploadedFirstFrame(job)
        ? "确认首帧替换并继续"
        : `确认${job.changeType.changesBackground ? "背景" : job.changeType.changesPerson ? "人物" : "配置"}并生成候选资产`;
    toast(error.message);
  }
}

function mappingRiskClass(level) {
  return level === "high" ? "is-danger" : level === "medium" ? "is-warning" : "is-ok";
}

function syncMappingSourceReuse(row) {
  const reuse = $("[data-reuse-source]", row)?.checked === true;
  row.classList.toggle("is-source-reuse", reuse);
  const mode = $("[data-mapping-mode]", row);
  if (mode) mode.textContent = reuse ? "源图原样复用 · 不调用生图" : row.dataset.defaultModeLabel || "生成场景候选图";
  const assetSelect = $("[data-mapping-asset]", row);
  if (assetSelect) assetSelect.disabled = reuse;
  const action = $("[data-action-resolution]", row);
  if (action) action.disabled = reuse;
  const generatedHint = $("[data-generation-hint]", row);
  if (generatedHint) generatedHint.hidden = reuse;
  const actionWrap = $("[data-action-wrap]", row);
  if (actionWrap) actionWrap.hidden = reuse;
  const reuseNote = $("[data-source-reuse-note]", row);
  if (reuseNote) reuseNote.hidden = !reuse;
}

function bindMappingSourceReuse(host) {
  for (const row of $$('[data-mapping-row]', host)) {
    const checkbox = $("[data-reuse-source]", row);
    if (!checkbox) continue;
    checkbox.addEventListener("change", () => syncMappingSourceReuse(row));
    syncMappingSourceReuse(row);
  }
}

function upstreamAssetRoute(job, target, asset) {
  const assetType = asset.mediaType || "image";
  const textTransform = target?.upstreamTextAssets?.find((item) => item.sourceNodeKey === asset.nodeKey);
  if (assetType === "text") {
    if (textTransform?.status === "conflict" || asset.auditConflict) {
      return { id: "text_conflict", label: "文本 SKU 冲突 · 已阻止提交", tone: "is-danger" };
    }
    if (textTransform?.rewritten) return { id: "text_rewrite", label: "按目标 SKU 改写并重建文本节点", tone: "is-warning" };
    return { id: "text_reuse", label: "文本内容原样重建并保留连线", tone: "is-ok" };
  }
  if (!["image", "video", "audio"].includes(assetType)) {
    return { id: "unsupported", label: "未支持类型 · 已阻止静默丢失", tone: "is-danger" };
  }
  const mapping = target?.mappingPlan?.mappings?.find((item) => item.sourceNodeKey === asset.nodeKey);
  const group = target?.assetGroups?.find((item) => item.sourceNodeKey === asset.nodeKey);
  const carrierRebuild = target?.mappingPlan?.carrierPropAssessments?.some((item) => item.sourceNodeKey === asset.nodeKey && item.decision === "regenerate_with_product");
  if (carrierRebuild) {
    return { id: "rebuild", label: "承载道具与产品联动重构 · 每轮 2 张候选", tone: "is-warning" };
  }
  if (group?.sourceMode === "uploaded_first_frame") {
    return { id: "uploaded_first_frame", label: "用户上传首帧 · 替换源 nodeKey", tone: "is-ok" };
  }
  if (assetType === "image" && target?.firstFrameOverride?.sourceMode === "user_uploaded_first_frame") {
    return { id: "reuse_source", label: "其余源图原样复用 · 不调用生图", tone: "is-ok" };
  }
  if (group?.sourceMode === "oss_direct" || mapping?.processingMode === "oss_direct" || asset.replacementStrategy === "direct_oss_product_asset") {
    return { id: "oss_direct", label: "目标 SKU 原始身份图直连", tone: "is-ok" };
  }
  if (mapping?.processingMode === "reuse_source") {
    return { id: "reuse_source", label: "源图原样复用 · 不调用生图", tone: "is-ok" };
  }
  if (group || mapping?.processingMode === "generate_candidate" || asset.rebuildRequired || carrierRebuild) {
    return { id: "rebuild", label: "重构资产图 · 每轮 2 张候选", tone: "is-warning" };
  }
  return { id: "reuse_source", label: "源图原样复用 · 不调用生图", tone: "is-ok" };
}

function isDirectAssetGroup(group) {
  return ["oss_direct", "uploaded_first_frame"].includes(group?.sourceMode);
}

function upstreamManifest(job, target) {
  const assets = job.audit?.assets || [];
  if (!assets.length) return '<p class="form-hint">尚无上游资产审计清单。</p>';
  const textEditable = ["awaiting_mapping_confirmation", "awaiting_asset_confirmation"].includes(job.status);
  return `
    <section class="upstream-manifest" data-upstream-manifest>
      <div class="upstream-manifest-head"><b>完整上游资产清单</b><span>逐 nodeKey 溯源与路由；图片、视频、音频、文本均不得静默丢失</span></div>
      <div class="upstream-manifest-table-wrap" tabindex="0" aria-label="完整上游资产清单表格">
        <table class="upstream-manifest-table">
          <thead>
            <tr>
              <th scope="col">序号</th>
              <th scope="col">资产信息</th>
              <th scope="col">处理方式</th>
              <th scope="col">约束</th>
            </tr>
          </thead>
          <tbody>
        ${assets.map((asset, index) => {
          const route = upstreamAssetRoute(job, target, asset);
          const group = target?.assetGroups?.find((item) => item.sourceNodeKey === asset.nodeKey);
          const textTransform = target?.upstreamTextAssets?.find((item) => item.sourceNodeKey === asset.nodeKey);
          const showRouteReason = ["rebuild", "text_rewrite", "text_conflict", "unsupported"].includes(route.id) || Boolean(asset.auditConflict);
          return `<tr>
            <td><span class="manifest-order">${String(index + 1).padStart(2, "0")}</span></td>
            <td class="manifest-asset-cell">
              <b>${escapeHtml(asset.label || asset.nodeKey)}</b>
              <div class="manifest-meta">
                <span>类型：${escapeHtml(asset.mediaType || "asset")}</span>
                <span>角色：${escapeHtml(asset.role || "待识别")}</span>
                <code>nodeKey：${escapeHtml(asset.nodeKey || "")}</code>
              </div>
            </td>
            <td class="manifest-route-cell">
              <em class="badge ${route.tone}">${escapeHtml(route.label)}</em>
              ${showRouteReason ? `<p>${route.id === "text_conflict" ? escapeHtml((textTransform?.conflicts || []).map((item) => item.message || item.type).join("；") || asset.reason || "文本节点存在未解决冲突") : route.id === "text_rewrite" ? escapeHtml((textTransform?.replacements || []).map((item) => `${item.from} → ${item.to}`).join("；") || asset.reason) : asset.auditConflict ? "审计字段冲突已纠正或阻断，禁止静默直通" : escapeHtml(asset.reason || "按本次变更白名单路由")}</p>` : ""}
              ${asset.mediaType === "text" && textTransform ? textEditable ? `
                <div class="asset-text-editor" data-upstream-text-node="${escapeHtml(asset.nodeKey || "")}">
                  ${(textTransform.content || []).map((content, contentIndex) => {
                    const draft = state.upstreamTextDrafts?.[job.id]?.[target.id]?.[asset.nodeKey]?.[contentIndex];
                    return `<textarea data-upstream-text-content="${contentIndex}" rows="4" aria-label="${escapeHtml(`${asset.label || asset.nodeKey} 内容 ${contentIndex + 1}`)}">${escapeHtml(draft === undefined ? content : draft)}</textarea>`;
                  }).join("") || '<p class="mapping-blocker">该文本节点没有可确认的内容。</p>'}
                </div>
              ` : `<pre class="asset-text-content">${escapeHtml((textTransform.content || []).join("\n") || "（空文本）")}</pre>` : ""}
            </td>
            <td class="manifest-constraint-cell">
              <span><b>${asset.mediaType === "text" ? "文本策略" : "实例策略"}</b>${route.id === "rebuild" ? "当前源图逐槽位继承" : route.id === "text_rewrite" ? "只替换 SKU 身份，保持其余正文" : route.id === "text_reuse" ? "正文不变，nodeKey 重映射" : "不做数量规划"}</span>
              ${group?.geometryPreparation ? `<span><b>几何探针</b>${escapeHtml(group.geometryPreparation.status || "unknown")}</span>` : ""}
            </td>
          </tr>`;
        }).join("")}
          </tbody>
        </table>
      </div>
    </section>`;
}

function bindUpstreamTextEditors(host, job) {
  for (const editor of $$('[data-upstream-text-node]', host)) {
    const target = editor.closest('[data-text-target-id], [data-mapping-target]');
    const targetId = target?.dataset.textTargetId || target?.dataset.mappingTarget || "";
    if (!targetId) continue;
    for (const textarea of $$('[data-upstream-text-content]', editor)) {
      textarea.addEventListener("input", () => {
        state.upstreamTextDrafts[job.id] ||= {};
        state.upstreamTextDrafts[job.id][targetId] ||= {};
        state.upstreamTextDrafts[job.id][targetId][editor.dataset.upstreamTextNode] ||= {};
        state.upstreamTextDrafts[job.id][targetId][editor.dataset.upstreamTextNode][textarea.dataset.upstreamTextContent] = textarea.value;
      });
    }
  }
}

function collectUpstreamTextAssets(host) {
  const textAssets = {};
  for (const editor of $$('[data-upstream-text-node]', host)) {
    textAssets[editor.dataset.upstreamTextNode] = $$('[data-upstream-text-content]', editor)
      .sort((left, right) => Number(left.dataset.upstreamTextContent) - Number(right.dataset.upstreamTextContent))
      .map((textarea) => textarea.value);
  }
  return textAssets;
}

function mappingSourceReuseControl(job, mapping) {
  if (mapping.processingMode !== "generate_candidate") return "";
  const asset = (job.audit?.assets || []).find((item) => item.nodeKey === mapping.sourceNodeKey);
  if (asset?.auditConflict) {
    return '<p class="mapping-conflict-lock">审计文字已确认存在旧产品像素，平台已纠正字段冲突：该节点必须重构，不能切换为源图复用。</p>';
  }
  return '<label class="mapping-source-reuse"><input type="checkbox" data-reuse-source />人工复核确认此关键帧不含原产品，直接复用源图（不调用生图）</label><p class="form-hint source-reuse-note" data-source-reuse-note hidden>该图只保留人物、服装、身体状态、动作阶段、构图与时序；平台不会选择目标产品图，也不会生成候选关键帧。</p>';
}

function productGeometryReviewState(asset = {}) {
  const facts = asset.productFacts || {};
  const rawCount = Number(facts.productCount);
  const observedCount = Number.isInteger(rawCount) && rawCount > 0 ? rawCount : null;
  const reliableInstanceCount = (Array.isArray(facts.instances) ? facts.instances : []).filter((item) => {
    const box = item?.bbox || item?.box || item?.boundingBox || {};
    const values = Array.isArray(box)
      ? box.slice(0, 4).map(Number)
      : [box.x ?? box.left, box.y ?? box.top, box.width ?? (Number(box.right) - Number(box.x ?? box.left)), box.height ?? (Number(box.bottom) - Number(box.y ?? box.top))].map(Number);
    return values.length === 4 && values.every(Number.isFinite) && values[2] > 0 && values[3] > 0;
  }).length;
  const status = !reliableInstanceCount
    ? "missing_instances"
    : observedCount != null && observedCount !== reliableInstanceCount ? "count_conflict" : "ready";
  return { status, observedCount, reliableInstanceCount, requiresReview: status !== "ready" };
}

function productGeometryReviewControl(job, mapping) {
  if (mapping.processingMode !== "generate_candidate") return "";
  const asset = (job.audit?.assets || []).find((item) => item.nodeKey === mapping.sourceNodeKey);
  if (asset?.productBearing !== true) return "";
  const review = productGeometryReviewState(asset);
  const reviewed = asset.productGeometryReview || {};
  if (!review.requiresReview) {
    return `<div class="product-geometry-review is-ready"><b>OpenCV 数量核验通过</b><span>当前源图按 ${review.reliableInstanceCount} 个可靠实例逐槽位替换${reviewed.reviewedAt ? " · 已人工/单图复核" : ""}</span></div>`;
  }
  const message = review.status === "count_conflict"
    ? `审计观察到 ${review.observedCount} 个产品，但只有 ${review.reliableInstanceCount} 个可靠实例框。`
    : "当前没有可供 OpenCV 使用的可靠产品实例框。";
  return `
    <section class="product-geometry-review is-blocking" data-product-geometry-review-panel data-source-key="${escapeHtml(mapping.sourceNodeKey)}">
      <div><b>OpenCV 数量与槽位需要人工核实</b><span>${escapeHtml(message)}</span></div>
      <p>系统提示只负责约束逐实例替换；数量或实例框冲突时必须先在这里修正，未解决前不会再次提交候选生成。</p>
      <div class="product-geometry-review-actions">
        <button class="secondary-button" type="button" data-product-geometry-review="reanalyze">重新识别数量与槽位</button>
        ${review.reliableInstanceCount > 0 ? `<button class="secondary-button" type="button" data-product-geometry-review="confirm_reliable_instances">人工确认按 ${review.reliableInstanceCount} 个可靠实例执行</button>` : ""}
      </div>
    </section>`;
}

async function updateProductGeometryReview(job, button) {
  const panel = button.closest("[data-product-geometry-review-panel]");
  const action = button.dataset.productGeometryReview;
  if (!panel || !["reanalyze", "confirm_reliable_instances"].includes(action)) return;
  const buttons = $$('[data-product-geometry-review]', panel);
  buttons.forEach((item) => { item.disabled = true; });
  const idleLabel = button.textContent;
  button.textContent = action === "reanalyze" ? "正在重新识别…" : "正在保存人工确认…";
  try {
    const payload = await apiJson(`./api/one-click-remake/jobs/${encodeURIComponent(job.id)}/audit/product-geometry`, {
      method: "PATCH",
      body: JSON.stringify({ nodeKey: panel.dataset.sourceKey, action })
    });
    renderJob(payload.job);
    toast(action === "reanalyze" ? "已重新识别当前源图的产品数量与实例槽位。" : "已按可靠实例数量完成人工确认。");
  } catch (error) {
    buttons.forEach((item) => { item.disabled = false; });
    button.textContent = idleLabel;
    toast(error.message);
  }
}

function carrierPropAutoNotice(plan = {}) {
  const linked = (plan.carrierPropAssessments || []).filter((item) => item.decision === "regenerate_with_product");
  if (!linked.length) return "";
  return `
    <section class="carrier-prop-panel" aria-label="关联道具自动适配">
      <div class="carrier-prop-head"><b>已自动适配关联道具</b><span>无需额外操作</span></div>
      <p>将同步适配：${linked.map((item) => escapeHtml(item.label || "承载道具")).join("、")}。系统会在同一次生图中保持品牌与外观，只调整容纳目标 SKU 所需的尺寸、开口及接触关系。</p>
    </section>`;
}

function renderMappingConfirmation(job) {
  const host = $("#mappingConfirmation");
  if (job.status !== "awaiting_mapping_confirmation") { host.innerHTML = ""; host.dataset.signature = ""; return; }
  const signature = JSON.stringify([job.id, job.updatedAt, (job.audit?.assets || []).map((asset) => [
    asset.nodeKey,
    asset.productBearing,
    asset.productFacts?.productCount,
    asset.productFacts?.instances,
    asset.productGeometryReview
  ])]);
  if (host.dataset.signature === signature) return;
  host.dataset.signature = signature;
  const targetSections = (job.targets || []).map((target) => {
    const plan = target.mappingPlan || {};
    const blocking = plan.blockingIssues || [];
    const gaps = plan.dataGapReport || [];
    const hasCarrierLink = (plan.carrierPropAssessments || []).some((item) => item.decision === "regenerate_with_product");
    return `
      <article class="mapping-target" data-mapping-target="${escapeHtml(target.id)}">
        <div class="mapping-target-head">
          <div><h3>${escapeHtml(target.productName)} · ${escapeHtml(target.displayState?.label || plan.selectedState?.label || "")}</h3><small>${escapeHtml(target.displayState?.shape || "")} · 比例 ${(target.displayState?.fixedLengthWidthHeightRatio || []).join("∶") || "资料不完整"}</small></div>
          <span class="badge ${plan.requiresHighRiskConfirmation ? "is-danger" : hasCarrierLink ? "is-warning" : "is-ok"}">${hasCarrierLink ? "已自动联动道具" : plan.requiresHighRiskConfirmation ? "含高风险映射" : "风险可控"}</span>
        </div>
        ${gaps.length ? `<div class="data-gap-box"><b>资料缺口报告</b>${gaps.map((gap) => `<p class="${gap.severity === "blocking" ? "is-blocking" : ""}">${escapeHtml(gap.severity)} · ${escapeHtml(gap.message)}</p>`).join("")}</div>` : ""}
        <p class="source-slot-policy">数量策略：不做投影面积或固定数量换算；每张含产品源图按自身可见实例与槽位逐一替换。</p>
        ${upstreamManifest(job, target)}
        ${carrierPropAutoNotice(plan)}
        <div class="mapping-list">
          ${(plan.mappings || []).map((mapping) => `
            <section class="mapping-row" data-mapping-row="${escapeHtml(mapping.sourceNodeKey)}" data-default-mode-label="${mapping.processingMode === "oss_direct" ? "直接替换 OSS 原图" : "生成场景候选图"}">
              <div class="mapping-route">
                <span><b>${escapeHtml(mapping.sourceLabel || mapping.sourceNodeKey)}</b><small>${escapeHtml(mapping.sourceFacts?.layerLabel || mapping.sourceFacts?.layer || "待核实")} · ${escapeHtml(mapping.sourceFacts?.view || "unknown")} · 置信度 ${Math.round(Number(mapping.classificationConfidence || 0) * 100)}%</small></span>
                <i>→</i>
                <span><b>${escapeHtml(mapping.targetStateLabel)}</b><small data-mapping-mode>${mapping.processingMode === "oss_direct" ? "直接替换 OSS 原图" : "生成场景候选图"}</small></span>
                <em class="badge ${mappingRiskClass(mapping.risk?.level)}">${escapeHtml(mapping.risk?.label || "待评估")}${mapping.risk?.sizeDeltaPct == null ? "" : ` · ${mapping.risk.sizeDeltaPct}%`}</em>
              </div>
              <p class="mapping-evidence">证据：${escapeHtml(mapping.classificationEvidence || "未返回")}</p>
              ${productGeometryReviewControl(job, mapping)}
              <div class="mapping-conflict-summary"><b>系统检测到 ${(mapping.risk?.reasons || []).length} 项形态 / 动作冲突</b><p>${escapeHtml((mapping.risk?.reasons || []).join("；"))}</p></div>
              ${mappingSourceReuseControl(job, mapping)}
              ${(mapping.targetAssetCandidates || []).length ? `
                <label class="mapping-asset-select"><span>${mapping.processingMode === "oss_direct" ? "该 nodeKey 直接替换的 OSS 原图" : "该 nodeKey 生成时使用的 OSS 产品身份图"}</span><select data-mapping-asset>
                  ${(mapping.targetAssetCandidates || []).map((asset) => `<option value="${escapeHtml(asset.id)}" ${asset.id === mapping.targetAssetId ? "selected" : ""}>${escapeHtml(asset.title || asset.id)} · ${escapeHtml(asset.view || "unknown")}</option>`).join("")}
                </select></label>
              ` : ""}
              ${mapping.processingMode === "generate_candidate" ? `<p class="form-hint" data-generation-hint>生成候选图时会使用上方 OSS 产品身份图，并锁定该形态的长宽高比例。</p>` : ""}
              ${mapping.requiresActionResolution ? `<label class="mapping-action" data-action-wrap><span>系统生成的冲突解决方案（可编辑） <i>${mapping.actionResolutionSource === "model_generated" ? "模型已结合原提示词生成" : "规则草稿"}</i></span><textarea data-action-resolution placeholder="系统会结合源产品识别、目标 SKU、所选 OSS 图和原视频节点提示词自动生成。">${escapeHtml(mapping.actionResolution || "")}</textarea><small>${escapeHtml(mapping.risk?.action?.reason || "目标形态不支持源动作")}</small><em>请按需微调；确认后将以输入框中的最终文字执行。</em></label>` : ""}
            </section>
          `).join("") || '<p class="form-hint">没有承载产品的上游图片节点。</p>'}
        </div>
        ${plan.requiresHighRiskConfirmation ? `<label class="high-risk-confirm"><input type="checkbox" data-high-risk-confirm />我已核实该 SKU 的尺寸、占用区域、视角和动作改写，允许进入候选图生成。</label>` : ""}
        ${blocking.length ? `<p class="mapping-blocker">当前不可继续：${escapeHtml(blocking.join("；"))}<br /><a href="./asset-library.html?productId=${encodeURIComponent(target.productId)}" target="_blank" rel="noopener">前往统一资产库补充该 SKU 资产（次抛盒装请选择“零售外盒”）</a></p>` : ""}
      </article>
    `;
  }).join("");
  const hasBlocking = (job.targets || []).some((target) => target.mappingPlan?.blockingIssues?.length
    || (target.mappingPlan?.mappings || []).some((mapping) => {
      if (mapping.processingMode !== "generate_candidate") return false;
      const asset = (job.audit?.assets || []).find((item) => item.nodeKey === mapping.sourceNodeKey);
      return asset?.productBearing === true && productGeometryReviewState(asset).requiresReview;
    }));
  host.innerHTML = `
    <section class="mapping-section">
      <div class="panel-head"><div><span class="step-no">03</span><h2>确认上游资产</h2></div><small>子步骤 2/3 · 确认产品形态与节点映射</small></div>
      <p class="form-hint">每个源 nodeKey 独立映射；只有语义完全相同的形态、视角和状态才允许复用同一张目标 OSS 图。</p>
      ${targetSections}
      <button class="primary-button" id="confirmMappingsButton" type="button" ${hasBlocking ? "disabled" : ""}>确认映射并生成候选资产</button>
    </section>
  `;
  const button = $("#confirmMappingsButton", host);
  bindMappingSourceReuse(host);
  bindUpstreamTextEditors(host, job);
  $$('[data-product-geometry-review]', host).forEach((reviewButton) => reviewButton.addEventListener("click", () => updateProductGeometryReview(job, reviewButton)));
  if (button && !hasBlocking) button.addEventListener("click", () => confirmMappings(job));
}

async function confirmMappings(job) {
  const targets = {};
  for (const section of $$('[data-mapping-target]', $("#mappingConfirmation"))) {
    const target = job.targets.find((item) => item.id === section.dataset.mappingTarget);
    const highRiskConfirmed = $('[data-high-risk-confirm]', section)?.checked || false;
    const mappings = {};
    const textAssets = collectUpstreamTextAssets(section);
    let requiresHighRisk = false;
    for (const row of $$('[data-mapping-row]', section)) {
      const sourceNodeKey = row.dataset.mappingRow;
      const reuseSource = $("[data-reuse-source]", row)?.checked === true;
      const sourceMapping = target?.mappingPlan?.mappings?.find((item) => item.sourceNodeKey === sourceNodeKey);
      if (!reuseSource && sourceMapping?.risk?.level === "high") requiresHighRisk = true;
      const actionResolution = $('[data-action-resolution]', row)?.value.trim() || "";
      if (!reuseSource && $('[data-action-resolution]', row) && !actionResolution) return toast("存在动作冲突，请填写动作改写方案");
      mappings[sourceNodeKey] = {
        reuseSource,
        targetAssetId: $('[data-mapping-asset]', row)?.value || "",
        actionResolution
      };
    }
    if (requiresHighRisk && !highRiskConfirmed) return toast(`请先确认 ${target.productName} 的高风险形态替换`);
    targets[target.id] = {
      highRiskConfirmed,
      mappings,
      textAssets
    };
  }
  const button = $("#confirmMappingsButton");
  button.disabled = true;
  button.textContent = "已确认，正在编译并生成候选图…";
  try {
    const payload = await apiJson(`./api/one-click-remake/jobs/${encodeURIComponent(job.id)}/mapping/confirm`, {
      method: "POST",
      body: JSON.stringify({ targets })
    });
    state.currentJob = payload.job;
    renderJob(payload.job);
    pollCurrentJob();
  } catch (error) {
    button.disabled = false;
    button.textContent = "确认映射并生成候选资产";
    toast(error.message);
  }
}

function candidateRounds(target, group) {
  const directGroup = isDirectAssetGroup(group);
  const rounds = group.generationRounds?.length
    ? group.generationRounds
    : [{ round: 1, promptSource: "built_in", prompt: group.compiler?.imagePrompt || "", candidateIds: (group.candidates || []).map((item) => item.id) }];
  const selectedId = target.selectedAssets?.[group.sourceNodeKey] || "";
  const generatedRounds = rounds.map((round) => {
    const roundCandidateIds = round.candidateIds || [];
    const candidates = (group.candidates || []).filter((candidate) => candidate.customUpload !== true && (
      roundCandidateIds.length
        ? roundCandidateIds.includes(candidate.id)
        : Number(candidate.round || 1) === Number(round.round || 1)
    ));
    const exactPrompt = round.effectivePrompt || round.prompt || group.compiler?.imagePrompt || "";
    return `<section class="candidate-round" data-candidate-round="${escapeHtml(round.round || 1)}">
      <div class="candidate-round-head">
        <span><b>第 ${escapeHtml(round.round || 1)} 轮</b><small>${candidates.length} 张候选 · ${escapeHtml(round.promptSource || "built_in")}</small></span>
        ${directGroup ? "" : '<button type="button" class="prompt-view-button" data-view-image-prompt>查看生图提示词</button>'}
      </div>
      <pre class="round-prompt" data-round-prompt hidden>${escapeHtml(exactPrompt)}</pre>
      <div class="candidate-grid">
        ${candidates.map((candidate, index) => `<label class="candidate-option">
          <input type="radio" name="candidate-${escapeHtml(target.id)}-${escapeHtml(group.sourceNodeKey)}" value="${escapeHtml(candidate.id)}" ${selectedId ? selectedId === candidate.id ? "checked" : "" : candidate.preselected ? "checked" : ""} />
          <img src="${escapeHtml(candidate.previewUrl)}" alt="${escapeHtml(group.sourceLabel)} 第 ${escapeHtml(round.round || 1)} 轮候选 ${index + 1}" />
          <span><b>${candidate.directReuse ? escapeHtml(candidate.directReuseLabel || "OSS 匹配原图") : `候选 ${index + 1}`}</b><em>${escapeHtml(candidate.model)}</em></span>
        </label>`).join("")}
      </div>
      ${round.correctionPrompt ? `<p class="round-correction"><b>本轮人工纠偏：</b>${escapeHtml(round.correctionPrompt)}</p>` : ""}
    </section>`;
  }).join("");
  const customCandidates = (group.candidates || []).filter((candidate) => candidate.customUpload === true);
  if (!customCandidates.length) return generatedRounds;
  return `${generatedRounds}
    <section class="candidate-round custom-candidate-round" data-custom-candidate-round>
      <div class="candidate-round-head">
        <span><b>用户自定义上传</b><small>${customCandidates.length} 张图片 · 上传后默认选用</small></span>
      </div>
      <div class="candidate-grid">
        ${customCandidates.map((candidate, index) => `<label class="candidate-option is-custom-upload">
          <input type="radio" name="candidate-${escapeHtml(target.id)}-${escapeHtml(group.sourceNodeKey)}" value="${escapeHtml(candidate.id)}" ${selectedId === candidate.id ? "checked" : ""} />
          <img src="${escapeHtml(candidate.previewUrl)}" alt="${escapeHtml(group.sourceLabel)} 用户自定义图片 ${index + 1}" />
          <span><b>${escapeHtml(candidate.originalFileName || `自定义图片 ${index + 1}`)}</b><em>用户自定义上传</em></span>
        </label>`).join("")}
      </div>
    </section>`;
}

function maxImageGenerationRounds() {
  return Math.max(1, Number(state.config?.imageGeneration?.maxRounds || 3));
}

function targetProductAssetCorrectionPanel(target) {
  const editableGroups = (target.assetGroups || []).map((group) => {
    const mapping = (target.mappingPlan?.mappings || []).find((item) => item.sourceNodeKey === group.sourceNodeKey);
    const assets = mapping?.targetAssetCandidates || [];
    return { group, mapping, assets };
  }).filter((item) => item.assets.length);
  if (!editableGroups.length) return "";
  return `
    <section class="target-product-asset-panel" data-product-asset-panel data-target-id="${escapeHtml(target.id)}">
      <div class="target-product-asset-head"><b>人工修正目标 SKU 身份图</b><span>统一入口 · ${editableGroups.length} 个可调整节点</span></div>
      ${editableGroups.length > 1 ? `<label class="target-product-node-select"><span>要修正的上游节点</span><select data-product-asset-node>${editableGroups.map(({ group }) => `<option value="${escapeHtml(group.sourceNodeKey)}">${escapeHtml(group.sourceLabel || group.sourceNodeKey)} · ${group.sourceMode === "oss_direct" ? "OSS 原图直连" : "场景候选生图"}</option>`).join("")}</select></label>` : `<input type="hidden" data-product-asset-node value="${escapeHtml(editableGroups[0].group.sourceNodeKey)}" />`}
      ${editableGroups.map(({ group, mapping, assets }, index) => {
        const selectedId = String(group.mappingTargetAssetId || mapping.targetAssetId || "");
        const selected = assets.find((asset) => String(asset.id) === selectedId) || assets[0];
        const roundCount = group.generationRounds?.length || 1;
        const regenerating = group.regeneration?.status === "queued" || group.regeneration?.status === "running";
        const maxRounds = maxImageGenerationRounds();
        const disabled = group.sourceMode !== "oss_direct" && (roundCount >= maxRounds || regenerating);
        const actionState = regenerating ? "regenerating" : roundCount >= maxRounds ? "exhausted" : "ready";
        return `<div class="target-product-asset-control" data-product-asset-control="${escapeHtml(group.sourceNodeKey)}" data-source-mode="${escapeHtml(group.sourceMode || "generate_candidate")}" data-round-count="${roundCount}" data-action-disabled="${disabled ? "true" : "false"}" data-action-state="${actionState}" ${index ? "hidden" : ""}>
          <div class="node-product-asset-picker">
            <figure><img data-product-asset-preview src="${escapeHtml(selected?.thumbnailUrl || "")}" alt="当前目标 SKU 产品图" /><figcaption>当前节点目标产品图</figcaption></figure>
            <label><span>选择正确的目标 SKU 身份图</span>
              <select data-product-asset-select>
                ${assets.map((asset) => `<option value="${escapeHtml(asset.id)}" data-thumbnail-url="${escapeHtml(asset.thumbnailUrl || "")}" ${String(asset.id) === selectedId ? "selected" : ""}>${escapeHtml(asset.title || asset.fileName || asset.angleLabel || asset.id)}</option>`).join("")}
              </select>
              <small>${group.sourceMode === "oss_direct" ? "确认后本节点直接改用该 OSS 原图，不调用生图。" : "确认后清除本节点旧的 OpenCV 产品布局参考，并使用新产品图生成下一轮候选；其他节点不受影响。"}</small>
            </label>
          </div>
          ${group.sourceMode === "oss_direct" ? "" : `<label class="image-prompt-editor"><span>第 ${Math.min(roundCount + 1, maxRounds)} 轮纠偏补充（选填）</span><textarea data-image-prompt placeholder="只填写已有候选需要修复的问题；留空则按首轮完整提示词重新采样。"></textarea><small>首轮完整提示词不可覆盖，已生成候选全部保留；单个画面最多三轮。${group.regeneration?.error ? `上次失败：${escapeHtml(group.regeneration.error)}` : ""}</small></label>`}
        </div>`;
      }).join("")}
      <div class="candidate-action-row"><button class="secondary-button regenerate-image-button" type="button" data-regenerate-image>应用所选产品图</button></div>
    </section>`;
}

function syncTargetProductAssetPanel(panel) {
  const sourceNodeKey = $('[data-product-asset-node]', panel)?.value || "";
  let activeControl = null;
  for (const control of $$('[data-product-asset-control]', panel)) {
    control.hidden = control.dataset.productAssetControl !== sourceNodeKey;
    if (!control.hidden) activeControl = control;
  }
  const button = $('[data-regenerate-image]', panel);
  if (!button || !activeControl) return;
  const direct = activeControl.dataset.sourceMode === "oss_direct";
  button.disabled = activeControl.dataset.actionDisabled === "true";
  button.textContent = direct
    ? "确认更换本节点产品图"
    : activeControl.dataset.actionState === "regenerating" ? "该节点候选生成中…"
      : activeControl.dataset.actionState === "exhausted" ? "该节点已完成三轮生图" : "更换产品图并重新生成";
}

function renderCandidates(job) {
  const host = $("#candidateConfirmation");
  if (!["awaiting_asset_confirmation", "regenerating_image_candidates"].includes(job.status)) { host.innerHTML = ""; host.dataset.signature = ""; return; }
  const signature = JSON.stringify({
    id: job.id,
    status: job.status,
    groups: (job.targets || []).flatMap((target) => (target.assetGroups || []).map((group) => [group.sourceNodeKey, group.mappingTargetAssetId || "", group.candidates?.length || 0, group.generationRounds?.length || 0, group.regeneration?.status || ""]))
  });
  if (host.dataset.signature === signature) return;
  host.dataset.signature = signature;
  const groups = job.targets.map((target) => `
    <div class="candidate-target" data-text-target-id="${escapeHtml(target.id)}">
      <h3>${escapeHtml(target.productName)}</h3>
      <p class="source-slot-policy">数量与布局只继承各自源图：逐实例、逐槽位替换，不做全局数量规划。</p>
      ${upstreamManifest(job, target)}
      ${targetProductAssetCorrectionPanel(target)}
      ${(target.assetGroups || []).filter((group) => group.sourceMode !== "oss_direct").map((group) => `
        <div class="candidate-group" data-candidate-group data-target-id="${escapeHtml(target.id)}" data-source-key="${escapeHtml(group.sourceNodeKey)}">
          <div class="candidate-comparison">
            <div class="candidate-source-column">
              <p class="candidate-source-head"><b>${escapeHtml(group.sourceLabel)}</b><span><i class="badge ${isDirectAssetGroup(group) ? "is-ok" : "is-warning"}">${group.sourceMode === "uploaded_first_frame" ? "用户上传首帧 · 直替源 nodeKey" : group.sourceMode === "oss_direct" ? "OSS 原图直连 · 核实即可" : "必须人工确认"}</i><i class="badge">${escapeHtml(group.compiler?.category?.label || "产品场景替换")}</i></span></p>
              <figure class="candidate-source"><img src="${escapeHtml(group.sourceUrl)}" alt="${escapeHtml(group.sourceLabel)} 原图" /><figcaption><b>原图</b><span>替换前基准</span></figcaption></figure>
            </div>
            <div class="candidate-rounds">${candidateRounds(target, group)}</div>
          </div>
          ${isDirectAssetGroup(group) ? "" : (() => {
            const regenerating = group.regeneration?.status === "queued" || group.regeneration?.status === "running";
            return `
            <div class="candidate-action-row">
              <label class="secondary-button custom-candidate-upload-button">用户自定义上传<input type="file" data-custom-candidate-input accept="image/png,image/jpeg,image/webp" ${regenerating ? "disabled" : ""} hidden /></label>
            </div>
          `; })()}
        </div>
      `).join("") || '<p class="form-hint">本次无需重建上游图片。请核实已上传的替换参考资产与新视频提示词，再点击下方确认。</p>'}
      <label class="editable-video-prompt"><span>${escapeHtml(target.productName)} 新视频提示词${job.changeType.changesVoiceover ? "（请复核新口播文案）" : ""}</span><textarea data-target-video-prompt="${escapeHtml(target.id)}" placeholder="填写最终提交给视频模型的提示词。">${escapeHtml(target.videoPrompt?.variantPrompt || target.videoPrompt?.compiled || "")}</textarea><small>${job.changeType.changesVoiceover ? "确认新口播逐字出现在提示词中，并核对说话人和台词顺序。" : ""}这里只提交上游资产与新视频提示词；资产几何、OSS ID、形态映射和数量模板不会流入视频节点。</small></label>
    </div>
  `).join("");
  host.innerHTML = `
    <section class="confirmation-section">
      <div class="panel-head"><div><span class="step-no">03</span><h2>确认上游资产</h2></div><small>子步骤 3/3 · 核实候选资产与最终提示词</small></div>
      ${groups}
      <button class="primary-button" id="confirmAssetsButton" type="button">确认资产并开始生成视频</button>
    </section>
  `;
  $("#confirmAssetsButton", host).addEventListener("click", () => confirmAssets(job));
  bindUpstreamTextEditors(host, job);
  $$('[data-regenerate-image]', host).forEach((button) => button.addEventListener("click", () => regenerateImageCandidates(job, button)));
  $$('[data-product-asset-panel]', host).forEach((panel) => {
    $('[data-product-asset-node]', panel)?.addEventListener("change", () => syncTargetProductAssetPanel(panel));
    syncTargetProductAssetPanel(panel);
  });
  $$('[data-product-asset-select]', host).forEach((select) => select.addEventListener("change", () => {
    const preview = $('[data-product-asset-preview]', select.closest(".node-product-asset-picker"));
    if (preview) preview.src = select.selectedOptions?.[0]?.dataset.thumbnailUrl || "";
  }));
  $$('[data-custom-candidate-input]', host).forEach((input) => input.addEventListener("change", () => {
    uploadCustomImageCandidate(job, input);
    input.value = "";
  }));
  $$('[data-view-image-prompt]', host).forEach((button) => button.addEventListener("click", () => {
    const prompt = $("[data-round-prompt]", button.closest("[data-candidate-round]"));
    if (!prompt) return;
    prompt.hidden = !prompt.hidden;
    button.textContent = prompt.hidden ? "查看生图提示词" : "收起生图提示词";
  }));
}

async function regenerateImageCandidates(job, button) {
  const panel = button.closest("[data-product-asset-panel]");
  const sourceNodeKey = $('[data-product-asset-node]', panel)?.value || "";
  const control = $$('[data-product-asset-control]', panel)
    .find((item) => item.dataset.productAssetControl === sourceNodeKey);
  const correctionPrompt = $("[data-image-prompt]", control)?.value.trim() || "";
  const productAssetId = $("[data-product-asset-select]", control)?.value || "";
  const directReplacement = control?.dataset.sourceMode === "oss_direct";
  const nextRound = Math.min(Number(control?.dataset.roundCount || 1) + 1, maxImageGenerationRounds());
  button.disabled = true;
  button.textContent = directReplacement ? "正在更换产品图…" : `已提交第 ${nextRound} 轮…`;
  try {
    const payload = await apiJson(`./api/one-click-remake/jobs/${encodeURIComponent(job.id)}/targets/${encodeURIComponent(panel.dataset.targetId)}/assets/${encodeURIComponent(sourceNodeKey)}/regenerate`, {
      method: "POST",
      body: JSON.stringify({ correctionPrompt, productAssetId })
    });
    state.currentJob = payload.job;
    renderJob(payload.job);
    toast(directReplacement ? "本节点已改用人工选择的目标 SKU 产品图。" : `第 ${nextRound} 轮已改用所选产品图生成，已有结果继续保留。`);
    if (!directReplacement) pollCurrentJob();
  } catch (error) {
    button.disabled = false;
    button.textContent = directReplacement ? "确认更换本节点产品图" : "更换产品图并重新生成";
    toast(error.message);
  }
}

async function uploadCustomImageCandidate(job, input) {
  const group = input.closest("[data-candidate-group]");
  const file = input.files?.[0];
  if (!file) return;
  const button = input.closest(".custom-candidate-upload-button");
  input.disabled = true;
  button?.classList.add("is-uploading");
  if (button) button.firstChild.textContent = "上传中 0%";
  try {
    const uploaded = await uploadReferenceFile("remake-custom-candidate", file, `one-click-remake-${job.id}`, (percent) => {
      if (button) button.firstChild.textContent = `上传中 ${percent}%`;
    });
    const payload = await apiJson(`./api/one-click-remake/jobs/${encodeURIComponent(job.id)}/targets/${encodeURIComponent(group.dataset.targetId)}/assets/${encodeURIComponent(group.dataset.sourceKey)}/custom-candidate`, {
      method: "POST",
      body: JSON.stringify({ path: uploaded.path, name: file.name })
    });
    state.currentJob = payload.job;
    renderJob(payload.job);
    toast("自定义图片已上传并默认选用，仍可切换其他候选图。");
  } catch (error) {
    input.disabled = false;
    button?.classList.remove("is-uploading");
    if (button) button.firstChild.textContent = "用户自定义上传";
    toast(error.message);
  }
}

async function confirmAssets(job) {
  const selections = {};
  for (const group of $$('[data-candidate-group]', $("#candidateConfirmation"))) {
    const selected = $('input[type="radio"]:checked', group);
    if (!selected) return toast("请为每个需要重建的上游图选择一张候选图");
    selections[group.dataset.targetId] ||= {};
    selections[group.dataset.targetId][group.dataset.sourceKey] = selected.value;
  }
  const videoPrompts = {};
  for (const textarea of $$('[data-target-video-prompt]', $("#candidateConfirmation"))) {
    const prompt = textarea.value.trim();
    if (!prompt) return toast("请填写每个目标产品的视频生成提示词");
    videoPrompts[textarea.dataset.targetVideoPrompt] = prompt;
  }
  const textAssets = {};
  for (const target of $$('[data-text-target-id]', $("#candidateConfirmation"))) {
    textAssets[target.dataset.textTargetId] = collectUpstreamTextAssets(target);
  }
  const button = $("#confirmAssetsButton");
  button.disabled = true;
  button.textContent = "视频任务已进入后台…";
  try {
    const payload = await apiJson(`./api/one-click-remake/jobs/${encodeURIComponent(job.id)}/confirm`, {
      method: "POST",
      body: JSON.stringify({ selections, videoPrompts, textAssets })
    });
    state.currentJob = payload.job;
    renderJob(payload.job);
    pollCurrentJob();
  } catch (error) {
    button.disabled = false;
    button.textContent = "确认资产并开始生成视频";
    toast(error.message);
  }
}

function renderAssetConfirmationSummary(job) {
  const host = $("#assetConfirmationSummary");
  const interactiveStatuses = new Set(["awaiting_configuration", "awaiting_mapping_confirmation", "awaiting_asset_confirmation"]);
  if (interactiveStatuses.has(job.status)) { host.innerHTML = ""; return; }
  const stageThreeEvents = new Set([
    "preparing_mapping", "awaiting_mapping_confirmation", "mapping_confirmed", "compiling_prompts",
    "image_generating", "awaiting_asset_confirmation", "assets_confirmed", "recovering_video_node_callback"
  ]);
  const started = (job.targets || []).length > 0 || (job.events || []).some((event) => stageThreeEvents.has(event.stage));
  if (!started) { host.innerHTML = ""; return; }

  const targets = job.targets || [];
  const mappings = targets.flatMap((target) => target.mappingPlan?.mappings || []);
  const sourceReuseMappings = mappings.filter((mapping) => mapping.processingMode === "reuse_source").length;
  const groups = targets.flatMap((target) => target.assetGroups || []);
  const directGroups = groups.filter((group) => group.sourceMode === "oss_direct").length;
  const candidateGroups = groups.length - directGroups;
  const confirmedTargets = targets.filter((target) => target.confirmedAt).length;
  const mappedTargets = targets.filter((target) => target.mappingConfirmedAt || target.mappingPlan?.confirmedAt).length;
  const isTerminal = ["success", "partial_success", "failed"].includes(job.status);
  const fullyConfirmed = targets.length > 0 && confirmedTargets === targets.length;
  const badgeLabel = fullyConfirmed ? "已确认" : isTerminal ? "已执行（中断）" : "处理中";
  const badgeClass = fullyConfirmed ? "is-ok" : "is-warning";
  const targetNames = targets.map((target) => target.productName).filter(Boolean);
  const explanation = fullyConfirmed
    ? "已逐项确认全部上游 nodeKey 的源图复用、目标身份图直连或候选图重构，并锁定与资产指令隔离的最终视频提示词。"
    : mappedTargets
      ? "已完成产品形态与节点映射；资产候选或最终提示词确认未全部完成，流程在后续环节中断。"
      : "已进入上游资产确认流程；页面保留该阶段记录，便于核对失败前实际执行到哪里。";

  host.innerHTML = `
    <section class="stage-three-summary" data-stage-three-summary>
      <div class="panel-head"><div><span class="step-no">03</span><h2>确认上游资产</h2></div><span class="badge ${badgeClass}">${badgeLabel}</span></div>
      <p>${escapeHtml(explanation)}</p>
      <div class="stage-summary-metrics">
        <span><b>${targets.length}</b> 个目标 SKU</span>
        <span><b>${job.audit?.assets?.length || 0}</b> 个上游资产节点</span>
        <span><b>${mappings.length}</b> 条节点映射</span>
        <span><b>${directGroups}</b> 组 OSS 直连</span>
        <span><b>${sourceReuseMappings}</b> 张无产品源图复用</span>
        <span><b>${candidateGroups}</b> 组候选图核实</span>
        <span><b>${confirmedTargets}/${targets.length}</b> 最终确认</span>
      </div>
      ${targetNames.length ? `<small>涉及产品：${escapeHtml(targetNames.join("、"))}</small>` : ""}
      ${targets.map((target) => `<div class="summary-manifest-target"><h3>${escapeHtml(target.productName)}</h3>${upstreamManifest(job, target)}</div>`).join("")}
      ${imagePromptRuleCard(job, true)}
    </section>
  `;
}

function targetResultRounds(target) {
  const rounds = target.videoRounds?.length ? target.videoRounds : [target.result];
  return rounds.filter((round) => round?.previewUrl || round?.downloadUrl || round?.videoUrl);
}

function resultRenderSignature(job, resultTargets, jobFailure) {
  return JSON.stringify({
    jobId: job.id,
    status: job.status,
    failure: jobFailure ? [
      jobFailure.stage,
      jobFailure.stageLabel,
      jobFailure.reason,
      jobFailure.attempt,
      jobFailure.retryable
    ] : null,
    targets: resultTargets.map((target) => ({
      id: target.id,
      productName: target.productName,
      status: target.status,
      generationAttempt: target.generationAttempt,
      failure: target.failure ? [
        target.failure.stage,
        target.failure.stageLabel,
        target.failure.reason,
        target.failure.attempt,
        target.failure.retryable
      ] : null,
      recovery: target.resultRecovery ? [
        target.resultRecovery.status,
        target.resultRecovery.attempts,
        target.resultRecovery.nextAttemptAt,
        target.resultRecovery.lastError
      ] : null,
      rounds: targetResultRounds(target).map((round) => round ? [
        round.round,
        round.previewUrl,
        round.canvasUrl,
        round.downloadUrl,
        round.error,
        round.quality || null,
        round.manualReview || null
      ] : null)
    }))
  });
}

function resultRoundCard(target, round) {
  const roundNumber = Number(round.round || 1);
  const latestRound = Number(target.generationAttempt || roundNumber);
  const manualReview = round.manualReview || {};
  const approved = manualReview.decision === "approve" && manualReview.status === "approved";
  const rejected = manualReview.decision === "reject";
  const reviewable = roundNumber === latestRound && ["awaiting_manual_review", "review_required"].includes(target.status);
  const manualLabel = approved
    ? "已完成"
    : rejected
      ? (roundNumber >= 2 ? "人工质检未通过 · 已达两轮上限" : "人工质检未通过")
      : reviewable ? "待人工质检" : "待确认";
  const aiLabel = round.quality?.status === "unavailable"
    ? "AI 参考不可用"
    : `AI 参考 · ${round.quality?.score || 0}分`;
  return `
    <article class="result-card ${approved ? "is-passed" : "needs-review"}">
      <video src="${escapeHtml(round.previewUrl || round.videoUrl)}" controls preload="metadata"></video>
      <div class="result-round-head"><h3>${escapeHtml(target.productName)} · 第 ${escapeHtml(roundNumber)} 轮</h3><span class="badge ${approved ? "is-ok" : "is-warning"}">${manualLabel}</span></div>
      <p class="quality-reference"><b>${escapeHtml(aiLabel)}</b> · AI 结果仅供人工质检参考，不会自动归档或自动生成下一轮。</p>
      <div class="quality-metrics">
        <span>洁净度 ${round.quality?.dimensions?.cleanliness ?? "—"}</span><span>准确度 ${round.quality?.dimensions?.identityAccuracy ?? "—"}</span><span>适配度 ${round.quality?.dimensions?.sceneFit ?? "—"}</span><span>时序稳定 ${round.quality?.dimensions?.temporalStability ?? "—"}</span><span>提示词符合度 ${round.quality?.dimensions?.promptCompliance ?? "—"}</span>
      </div>
      ${round.quality?.issues?.length ? `<p class="quality-issues">${escapeHtml(round.quality.issues.join("；"))}</p>` : ""}
      ${rejected && manualReview.note ? `<p class="manual-review-note"><b>人工意见：</b>${escapeHtml(manualReview.note)}</p>` : ""}
      <div class="result-links">
        <a class="secondary-button" href="${escapeHtml(round.canvasUrl)}" target="_blank" rel="noopener">打开画布</a>
        <a class="text-button" href="${escapeHtml(round.downloadUrl)}">下载第 ${escapeHtml(roundNumber)} 轮</a>
        ${reviewable ? `<button class="primary-button manual-review-button" type="button" data-manual-review-target="${escapeHtml(target.id)}" data-manual-review-round="${escapeHtml(roundNumber)}">${rejected ? "重新人工质检" : "人工质检此成片"}</button>` : ""}
      </div>
    </article>
  `;
}

function closeVideoReview() {
  const dialog = $("#videoReviewDialog");
  const video = $("#videoReviewPlayer");
  video?.pause();
  if (video) video.removeAttribute("src");
  state.videoReview = null;
  if (dialog?.open) dialog.close();
}

function openVideoReview(targetId, roundNumber) {
  const job = state.currentJob;
  const target = (job?.targets || []).find((item) => item.id === targetId);
  const round = targetResultRounds(target || {}).find((item) => Number(item.round || 1) === Number(roundNumber));
  if (!job || !target || !round) return toast("待人工质检的成片不存在，请刷新任务后重试");
  state.videoReview = { jobId: job.id, targetId: target.id, round: Number(round.round || 1) };
  $("#videoReviewTitle").textContent = `${target.productName} · 第 ${state.videoReview.round} 轮人工质检`;
  $("#videoReviewHint").textContent = state.videoReview.round < 2
    ? "完整播放并检查成片。符合要求可直接归档；不符合时填写修正意见，再生成第 2 轮。"
    : "这是最后一轮。符合要求可直接归档；不符合将保留成片待处理，不会生成第 3 轮。";
  const player = $("#videoReviewPlayer");
  player.src = round.previewUrl || round.videoUrl;
  const dimensions = round.quality?.dimensions || {};
  $("#videoReviewAiReference").innerHTML = `
    <div><b>AI 参考${round.quality?.status === "unavailable" ? "不可用" : ` ${escapeHtml(round.quality?.score || 0)} 分`}</b><span>最终决定以人工质检为准</span></div>
    <div class="quality-metrics"><span>洁净度 ${dimensions.cleanliness ?? "—"}</span><span>准确度 ${dimensions.identityAccuracy ?? "—"}</span><span>适配度 ${dimensions.sceneFit ?? "—"}</span><span>时序稳定 ${dimensions.temporalStability ?? "—"}</span><span>提示词符合度 ${dimensions.promptCompliance ?? "—"}</span></div>
    ${round.quality?.issues?.length ? `<p>${escapeHtml(round.quality.issues.join("；"))}</p>` : ""}
  `;
  $("#videoReviewNote").value = round.manualReview?.note || round.quality?.correctionPrompt || "";
  $("#videoReviewReject").textContent = state.videoReview.round < 2 ? "不符合，生成第 2 轮" : "不符合，保留待处理";
  $("#videoReviewApprove").textContent = "符合要求并归档";
  $("#videoReviewDialog").showModal();
}

async function submitVideoReview(decision, button) {
  const review = state.videoReview;
  if (!review) return;
  const note = $("#videoReviewNote").value.trim();
  button.disabled = true;
  const approveButton = $("#videoReviewApprove");
  const rejectButton = $("#videoReviewReject");
  approveButton.disabled = true;
  rejectButton.disabled = true;
  button.textContent = decision === "approve" ? "正在归档…" : review.round < 2 ? "正在发起第 2 轮…" : "正在保存…";
  try {
    const payload = await apiJson(`./api/one-click-remake/jobs/${encodeURIComponent(review.jobId)}/targets/${encodeURIComponent(review.targetId)}/manual-review`, {
      method: "POST",
      body: JSON.stringify({ decision, round: review.round, note })
    });
    closeVideoReview();
    renderJob(payload.job);
    toast(decision === "approve"
      ? "人工质检已通过，成片已归档，状态已更新为“已完成”。"
      : review.round < 2 ? "已记录人工质检意见，正在生成第 2 轮。" : "已记录第 2 轮不符合要求，成片保留待处理。");
    if (decision === "reject" && review.round < 2) pollCurrentJob();
  } catch (error) {
    approveButton.disabled = false;
    rejectButton.disabled = false;
    approveButton.textContent = "符合要求并归档";
    rejectButton.textContent = review.round < 2 ? "不符合，生成第 2 轮" : "不符合，保留待处理";
    toast(error.message);
  }
}

function resultFailureCard(target) {
  const recoveryActive = ["checking", "waiting"].includes(target.resultRecovery?.status);
  return `
    <article class="result-error">
      <div class="failure-head"><b>${escapeHtml(target.productName)}</b><span>第 ${escapeHtml(target.failure?.attempt || target.generationAttempt || 1)} 次生成失败</span></div>
      <p class="failure-stage">失败环节：${escapeHtml(target.failure?.stageLabel || "视频生成")}</p>
      <pre>${escapeHtml(target.failure?.reason || target.result?.error || "生成失败，日志未返回具体原因")}</pre>
      ${recoveryActive ? `<p class="result-recovery-note">系统正在任务画布中检查原视频节点：已有成片会直接回传，仍在运行会继续等待，确认失败后才在原节点重新生成。</p>` : ""}
      <div class="failure-actions">
        ${target.result?.canvasUrl ? `<a class="secondary-button" href="${escapeHtml(target.result.canvasUrl)}" target="_blank" rel="noopener">查看失败画布</a>` : ""}
        ${recoveryActive
          ? '<span class="form-hint">正在追溯原节点并检查生成状态</span>'
          : target.failure?.retryable !== false && Number(target.generationAttempt || 0) < 2
            ? `<button class="primary-button retry-button" type="button" data-retry-target="${escapeHtml(target.id)}">重新发起生成</button>`
            : '<span class="form-hint">已达到两轮生成上限</span>'}
      </div>
    </article>
  `;
}

function jobFailureRetryCopy(job, failure) {
  if (failure?.stage === "asset_preparation_failed" && job.changeType?.changesProduct === true) {
    return {
      button: "重新配置上游资产",
      hint: "将清空上一轮错误映射与候选准备结果，保留源画布拆解和目标 SKU，返回产品形态与节点映射确认。",
      mode: "reconfigure-assets"
    };
  }
  return ({
    audit_failed: {
      button: "重新拆解并继续",
      hint: "将沿用当前任务的画布和 TaskID，从源画布拆解继续。"
    },
    mapping_preparation_failed: {
      button: "重新分析映射并继续",
      hint: "请先核对上方源资产与问题说明；重新发起后会沿用当前任务和目标 SKU，从产品形态与节点映射继续。"
    },
    asset_preparation_failed: {
      button: "重新准备候选资产并继续",
      hint: "将沿用已经确认的节点映射，从提示词编译与候选资产准备继续，不会重新拆解源画布。"
    }
  })[failure?.stage] || {
    button: "重新发起当前环节",
    hint: "将保留当前任务已经完成的内容，从失败环节继续。"
  };
}

function jobFailureCard(job, failure, { embedded = false } = {}) {
  const retryCopy = jobFailureRetryCopy(job, failure);
  return `
    <article class="result-error job-failure-card ${embedded ? "is-embedded" : ""}" role="alert">
      <div class="failure-head"><b>当前环节未完成</b><span>第 ${escapeHtml(failure?.attempt || 1)} 次</span></div>
      <p class="failure-stage">失败环节：${escapeHtml(failure?.stageLabel || "任务执行")}</p>
      <pre>${escapeHtml(failure?.reason || "任务失败，日志未返回具体原因")}</pre>
      <p class="failure-resume-hint">${escapeHtml(retryCopy.hint)}</p>
      <div class="failure-actions">
        ${failure?.retryable ? `<button class="primary-button retry-button" type="button" data-retry-job-stage data-retry-label="${escapeHtml(retryCopy.button)}" data-retry-mode="${escapeHtml(retryCopy.mode || "retry")}">${escapeHtml(retryCopy.button)}</button>` : '<span class="form-hint">此问题需要人工处理后再继续</span>'}
      </div>
    </article>
  `;
}

function renderWorkflowStageFailure(job) {
  const activeFailureStep = jobFailureWorkflowStep(job);
  const hosts = {
    audit: $("#auditStageFailure"),
    assets: $("#assetStageFailure")
  };
  for (const [step, host] of Object.entries(hosts)) {
    if (!host) continue;
    const failure = activeFailureStep === step ? job.failure : null;
    const signature = failure ? JSON.stringify([job.id, failure.stage, failure.reason, failure.attempt, failure.retryable]) : "";
    if (host.dataset.signature === signature) continue;
    host.dataset.signature = signature;
    host.innerHTML = failure ? jobFailureCard(job, failure, { embedded: true }) : "";
    $('[data-retry-job-stage]', host)?.addEventListener("click", (event) => retryFailedJobStage(job.id, event.currentTarget));
  }
}

function renderResults(job) {
  const host = $("#resultGrid");
  const terminalTargets = (job.targets || []).filter((target) => ["success", "awaiting_manual_review", "review_required", "failed"].includes(target.status));
  const resultTargets = (job.targets || []).filter((target) => terminalTargets.includes(target) || targetResultRounds(target).length > 0);
  const jobFailure = jobFailureWorkflowStep(job) === "results" ? job.failure : null;
  const hasResultState = Boolean(resultTargets.length || jobFailure);
  if (!hasResultState) {
    if (host.dataset.signature) host.innerHTML = "";
    host.dataset.signature = "";
    return;
  }
  const signature = resultRenderSignature(job, resultTargets, jobFailure);
  if (host.dataset.signature === signature) return;
  host.dataset.signature = signature;
  host.innerHTML = `
    <section class="result-section">
      <div class="panel-head"><div><span class="step-no">04</span><h2>同款结果输出</h2></div><span class="badge ${job.status === "success" ? "is-ok" : "is-warning"}">${escapeHtml(statusLabel(job))}</span></div>
      <div class="result-grid">
        ${jobFailure ? jobFailureCard(job, jobFailure) : ""}
        ${resultTargets.map((target) => `${targetResultRounds(target).map((round) => resultRoundCard(target, round)).join("")}${target.status === "failed" ? resultFailureCard(target) : ""}`).join("")}
      </div>
    </section>
  `;
  $$('[data-retry-target]', host).forEach((button) => button.addEventListener("click", () => retryTargetVideo(job.id, button.dataset.retryTarget, button)));
  $$('[data-manual-review-target]', host).forEach((button) => button.addEventListener("click", () => openVideoReview(button.dataset.manualReviewTarget, Number(button.dataset.manualReviewRound))));
  $('[data-retry-job-stage]', host)?.addEventListener("click", (event) => retryFailedJobStage(job.id, event.currentTarget));
}

async function retryFailedJobStage(jobId, button) {
  const idleLabel = button.dataset.retryLabel || button.textContent || "重新发起当前环节";
  const reconfigureAssets = button.dataset.retryMode === "reconfigure-assets";
  button.disabled = true;
  button.textContent = reconfigureAssets ? "正在返回配置…" : "正在重新发起…";
  try {
    const action = reconfigureAssets ? "reconfigure-assets" : "retry";
    const payload = await apiJson(`./api/one-click-remake/jobs/${encodeURIComponent(jobId)}/${action}`, { method: "POST" });
    renderJob(payload.job);
    toast(reconfigureAssets ? "已清空上一轮错误配置，请重新核对并确认上游资产。" : "已按原任务配置重新发起失败环节。");
    if (!reconfigureAssets) pollCurrentJob();
  } catch (error) {
    button.disabled = false;
    button.textContent = idleLabel;
    toast(error.message);
  }
}

async function retryTargetVideo(jobId, targetId, button) {
  button.disabled = true;
  button.textContent = "正在追溯画布…";
  try {
    const payload = await apiJson(`./api/one-click-remake/jobs/${encodeURIComponent(jobId)}/targets/${encodeURIComponent(targetId)}/retry`, {
      method: "POST"
    });
    renderJob(payload.job);
    toast("已开始追溯原视频节点：有成片将直接回传，确认失败后才会重新生成。");
    pollCurrentJob();
  } catch (error) {
    button.disabled = false;
    button.textContent = "重新发起生成";
    toast(error.message);
  }
}

function renderAccessNotice(job) {
  const host = $("#jobAccessNotice");
  const inaccessible = job.errorCode === "LIBTV_CANVAS_INACCESSIBLE";
  host.hidden = !inaccessible;
  if (inaccessible) {
    const account = job.errorDetails?.accountName || job.errorDetails?.accountId || "当前 LibTV 账号";
    host.querySelector("b").textContent = `${account}无法访问该画布`;
  }
  $("#jobPanel").hidden = !inaccessible && !state.detailsOpen;
}

function hydrateSourceForm(job) {
  if (!job?.id || state.sourceFormJobId === job.id) return;
  $("#canvasUrl").value = job.source?.canvasUrl || "";
  $("#taskId").value = job.source?.taskId || "";
  $("#changeType").value = job.changeType?.id || state.config?.changeTypes?.[0]?.id || "";
  state.sourceFormJobId = job.id;
}

function resetSourceForm({ focus = false } = {}) {
  state.sourceFormJobId = "";
  $("#sourceForm").reset();
  $("#canvasUrl").value = "";
  $("#taskId").value = "";
  if (state.config?.changeTypes?.[0]?.id) $("#changeType").value = state.config.changeTypes[0].id;
  if (focus) requestAnimationFrame(() => $("#canvasUrl").focus());
}

function renderJob(job) {
  if (state.videoReview && state.videoReview.jobId !== job.id) closeVideoReview();
  state.currentJob = job;
  state.currentJobId = job.id;
  localStorage.setItem("one-click-remake-current-job", job.id);
  showWorkspace(job);
  const taskSummarySignature = JSON.stringify([job.id, job.taskName, job.status, job.progress, job.updatedAt, (job.targets || []).map((target) => [target.id, target.status, target.generationAttempt])]);
  if (state.taskSummarySignature !== taskSummarySignature) {
    state.taskSummarySignature = taskSummarySignature;
    window.dispatchEvent(new CustomEvent("module-task-updated"));
  }
  $("#jobStageLabel").textContent = statusLabel(job).toUpperCase();
  const jobMessage = job.error || job.message || "后台处理中";
  $("#jobMessage").textContent = jobMessage;
  $("#jobMessage").title = jobMessage;
  $("#workspaceTaskName").textContent = job.taskName || "一键做同款任务";
  const failed = job.status === "failed";
  const workspaceTaskStatus = $("#workspaceTaskStatus");
  workspaceTaskStatus.textContent = statusLabel(job);
  workspaceTaskStatus.classList.toggle("is-failed", failed);
  const workspaceProgress = $("#workspaceProgress");
  workspaceProgress.hidden = false;
  workspaceProgress.classList.toggle("is-failed", failed);
  $("#workspaceJobActions").hidden = false;
  $("#progressBar").style.width = `${Math.max(0, Math.min(100, Number(job.progress || 0)))}%`;
  $("#progressText").textContent = failed ? "已停止·需处理" : `${Math.round(Number(job.progress || 0))}%`;
  $("#jobUpdatedAt").textContent = `更新于 ${localTime(job.updatedAt)}`;
  hydrateSourceForm(job);
  $("#sourceCanvasLink").href = job.source.canvasUrl;
  $("#sourceCanvasLink").hidden = usesSharedHistorySnapshot(job);
  const taskCanvasLink = $("#taskCanvasLink");
  taskCanvasLink.hidden = !job.canvas?.canvasUrl;
  if (job.canvas?.canvasUrl) taskCanvasLink.href = job.canvas.canvasUrl;
  renderAccessNotice(job);
  renderTimings(job);
  renderAudit(job);
  renderWorkflowStageFailure(job);
  renderTargetConfigurator(job);
  renderMappingConfirmation(job);
  renderCandidates(job);
  renderAssetConfirmationSummary(job);
  renderResults(job);
  updateWorkflowNavigation(job);
}

async function pollCurrentJob() {
  if (!state.currentJobId || state.polling) return;
  const requestedJobId = state.currentJobId;
  const requestedEpoch = ++state.pollEpoch;
  state.polling = true;
  try {
    const payload = await apiJson(`./api/one-click-remake/jobs/${encodeURIComponent(requestedJobId)}`);
    if (requestedEpoch !== state.pollEpoch || requestedJobId !== state.currentJobId) return;
    renderJob(payload.job);
  } catch (error) {
    if (!/任务不存在/.test(error.message)) toast(error.message);
  } finally {
    if (requestedEpoch === state.pollEpoch) state.polling = false;
  }
}

function clearCurrentJob(options = {}) {
  state.pollEpoch += 1;
  state.polling = false;
  state.currentJobId = "";
  state.currentJob = null;
  state.backgroundSceneChoice = { jobId: "", candidateId: "", prompt: "" };
  state.taskSummarySignature = "";
  localStorage.removeItem("one-click-remake-current-job");
  resetSourceForm(options);
  $("#jobPanel").hidden = true;
  $("#workspaceTaskName").textContent = "新建一键做同款任务";
  $("#workspaceTaskStatus").textContent = "新任务";
  $("#workspaceTaskStatus").classList.remove("is-failed");
  $("#jobMessage").textContent = "填写画布来源后开始任务";
  $("#jobMessage").removeAttribute("title");
  $("#workspaceProgress").hidden = true;
  $("#workspaceProgress").classList.remove("is-failed");
  $("#workspaceJobActions").hidden = true;
  for (const selector of ["#auditStageFailure", "#auditResult", "#assetStageFailure", "#targetConfigurator", "#mappingConfirmation", "#candidateConfirmation", "#assetConfirmationSummary", "#resultGrid"]) {
    const node = $(selector);
    if (node) {
      node.innerHTML = "";
      node.dataset.jobId = "";
      node.dataset.signature = "";
    }
  }
  state.workflowSignature = "";
  updateWorkflowNavigation(null, { force: true });
}

window.addEventListener("module-task-new", (event) => {
  if (event.detail?.module !== "one-click-remake.html") return;
  state.openingNewTask = true;
  showWorkspace(null, { force: true });
  clearCurrentJob({ focus: true });
  toast("新任务已打开，请填写本次要复刻的 LibTV 画布 URL 和 TaskID。");
});

window.addEventListener("module-task-open", (event) => {
  if (event.detail?.module !== "one-click-remake.html") return;
  const id = String(event.detail?.id || "");
  state.pollEpoch += 1;
  state.polling = false;
  if (!id) {
    const keepWorkspaceOpen = state.openingNewTask;
    state.openingNewTask = false;
    clearCurrentJob({ focus: keepWorkspaceOpen });
    if (keepWorkspaceOpen) showWorkspace(null, { force: true });
    else showTaskLanding();
    return;
  }
  state.openingNewTask = false;
  state.sourceFormJobId = "";
  state.currentJobId = id;
  localStorage.setItem("one-click-remake-current-job", id);
  showWorkspace(null, { force: true });
  pollCurrentJob();
});

async function createSourceJob(event) {
  event.preventDefault();
  const button = $("#auditButton");
  button.disabled = true;
  button.textContent = "正在提交后台拆解…";
  try {
    const payload = await apiJson("./api/one-click-remake/jobs", {
      method: "POST",
      body: JSON.stringify({
        canvasUrl: $("#canvasUrl").value.trim(),
        taskId: $("#taskId").value.trim(),
        changeType: $("#changeType").value
      })
    });
    renderJob(payload.job);
    window.dispatchEvent(new CustomEvent("module-task-updated", {
      detail: { module: "one-click-remake.html", id: payload.job.id }
    }));
    toast(payload.job.status === "preparing_history_remake"
      ? "已找到相同来源，正在直接复用共享 OSS 拆解快照；不会重新拆解源画布。"
      : payload.job.historyRecipeId
        ? "历史模板缺少完整兼容快照，正在执行一次旧数据兼容复审。"
        : "任务已提交。切换页面不会中断后台拆解。");
  } catch (error) {
    toast(error.message);
  } finally {
    button.disabled = false;
    button.textContent = "开始拆解成功经验";
  }
}

async function useHistoryRecipe(recipeId, changeType, button) {
  const originalLabel = button?.textContent || "使用共享快照做同款";
  if (button) {
    button.disabled = true;
    button.textContent = "正在恢复共享快照…";
  }
  try {
    const payload = await apiJson(`./api/one-click-remake/history/${encodeURIComponent(recipeId)}/remake`, {
      method: "POST",
      body: JSON.stringify({ changeType })
    });
    state.pollEpoch += 1;
    state.polling = false;
    state.sourceFormJobId = "";
    const url = new URL(window.location.href);
    url.searchParams.set("task", payload.job.id);
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
    renderJob(payload.job);
    window.dispatchEvent(new CustomEvent("module-task-updated", {
      detail: { module: "one-click-remake.html", id: payload.job.id }
    }));
    toast("已创建做同款任务，正在从 OSS 恢复拆解快照；无需访问原画布。");
    requestAnimationFrame(() => $(".workflow-content")?.scrollIntoView({ behavior: "smooth", block: "start" }));
    pollCurrentJob();
  } catch (error) {
    toast(error.message);
  } finally {
    if (button?.isConnected) {
      button.disabled = false;
      button.textContent = originalLabel;
    }
  }
}

function renderHistory(items) {
  const host = $("#historyGrid");
  state.historyItems = items;
  if (!items.length) {
    host.innerHTML = $("#historyKeyword")?.value.trim()
      ? '<p class="empty-state">没有找到匹配的历史模板，请尝试完整 URL、TaskID 或其他视频名称。</p>'
      : '<p class="empty-state">还没有成功案例。成功拆解第一条画布后，模板会自动出现在这里。</p>';
    return;
  }
  host.innerHTML = items.map((recipe) => {
    const isSourceTemplate = recipe.caseStage === "source_ready";
    const storageLabel = recipe.storage?.ossSynced ? "OSS 快照已归档" : "OSS 等待同步";
    const canManage = state.historyPermissions.historyAdmin === true;
    const canRename = state.historyPermissions.canRenameHistory === true;
    const canChangeOwner = state.historyPermissions.canChangeOwnerHistory === true;
    const canChangeType = recipe.permissions?.canChangeType === true;
    const ownerName = recipe.ownerName || recipe.createdBy || recipe.ownerKey || "未知账号";
    return `
      <article class="case-card">
        <video src="${escapeHtml(recipe.result?.previewUrl || recipe.result?.videoUrl || recipe.coverUrl)}" controls preload="metadata"></video>
        <div class="case-body">
          <span class="badge ${isSourceTemplate ? "is-warning" : "is-ok"}">${isSourceTemplate ? "已成功拆解" : "已生成成片"}</span>
          <h3>${escapeHtml(recipe.title)}</h3>
          <p class="case-classification">制作分类：<strong>${escapeHtml(recipe.changeType?.label || "做同款")}</strong>${canChangeType ? `<button class="case-type-edit" type="button" data-change-recipe-type="${escapeHtml(recipe.id)}">修改分类</button>` : ""}<span> · ${escapeHtml(storageLabel)} · ${escapeHtml(localTime(recipe.createdAt))}</span></p>
          ${canManage ? `<p class="case-owner">归属：<span>${escapeHtml(ownerName)}</span>${canChangeOwner ? `<button class="case-owner-edit" type="button" data-change-recipe-owner="${escapeHtml(recipe.id)}">修改归属</button>` : ""}</p>` : ""}
          <div class="history-tags">${(recipe.tags || []).slice(0, 12).map((tag) => `<span class="badge">${escapeHtml(tag)}</span>`).join("") || '<span class="tag-empty">暂未设置标签</span>'}</div>
          <div class="case-actions ${canManage ? "has-admin-actions" : ""}">
            <button class="primary-button" type="button" data-remake-recipe="${escapeHtml(recipe.id)}" data-change-type="${escapeHtml(recipe.changeType?.id || "product")}">使用共享快照做同款</button>
            ${canRename ? '<button class="secondary-button" type="button" data-rename-recipe="' + escapeHtml(recipe.id) + '">重命名</button>' : ""}
            ${canManage ? `
              <button class="secondary-button" type="button" data-edit-recipe-tags="${escapeHtml(recipe.id)}">管理标签</button>
              <button class="danger-button" type="button" data-delete-recipe="${escapeHtml(recipe.id)}">删除</button>
            ` : ""}
          </div>
        </div>
      </article>
    `;
  }).join("");
  $$('[data-remake-recipe]', host).forEach((button) => button.addEventListener("click", () => useHistoryRecipe(button.dataset.remakeRecipe, button.dataset.changeType, button)));
  $$('[data-change-recipe-type]', host).forEach((button) => button.addEventListener("click", () => editHistoryChangeType(button.dataset.changeRecipeType)));
  $$('[data-rename-recipe]', host).forEach((button) => button.addEventListener("click", () => editHistoryTitle(button.dataset.renameRecipe)));
  $$('[data-change-recipe-owner]', host).forEach((button) => button.addEventListener("click", () => editHistoryOwner(button.dataset.changeRecipeOwner)));
  $$('[data-edit-recipe-tags]', host).forEach((button) => button.addEventListener("click", () => editHistoryTags(button.dataset.editRecipeTags)));
  $$('[data-delete-recipe]', host).forEach((button) => button.addEventListener("click", () => deleteHistoryRecipe(button.dataset.deleteRecipe)));
}

function editHistoryChangeType(recipeId) {
  const recipe = state.historyItems.find((item) => item.id === recipeId);
  if (!recipe || recipe.permissions?.canChangeType !== true) return;
  const changeTypes = Array.isArray(state.config?.changeTypes) ? state.config.changeTypes : [];
  if (!changeTypes.length) return toast("制作分类配置尚未加载，请刷新页面后重试");
  const currentChangeType = String(recipe.changeType?.id || "");
  const dialog = document.createElement("dialog");
  dialog.className = "owner-transfer-dialog";
  dialog.innerHTML = `
    <form method="dialog" class="owner-transfer-form">
      <div class="owner-transfer-heading">
        <span>模板治理</span>
        <h3>修改制作分类</h3>
        <p>保存后，历史卡片、共享 OSS 快照和数据库索引统一使用新分类；已生成的视频文件不会被改写。选择含口播的分类后，请进入新任务修改口播文案并重新生成。</p>
      </div>
      <label>制作分类
        <select name="changeType" required>
          ${changeTypes.map((item) => `<option value="${escapeHtml(item.id)}" ${item.id === currentChangeType ? "selected" : ""}>${escapeHtml(item.label)}</option>`).join("")}
        </select>
      </label>
      <div class="owner-transfer-actions">
        <button class="secondary-button" type="button" data-cancel>取消</button>
        <button class="primary-button" type="submit">确认修改</button>
      </div>
    </form>
  `;
  document.body.appendChild(dialog);
  dialog.addEventListener("close", () => dialog.remove(), { once: true });
  $("[data-cancel]", dialog).addEventListener("click", () => dialog.close());
  $("form", dialog).addEventListener("submit", async (event) => {
    event.preventDefault();
    const nextChangeType = String(new FormData(event.currentTarget).get("changeType") || "");
    if (!nextChangeType || nextChangeType === currentChangeType) return dialog.close();
    const submit = $('button[type="submit"]', dialog);
    submit.disabled = true;
    submit.textContent = "正在同步…";
    try {
      const payload = await apiJson(`./api/one-click-remake/history/${encodeURIComponent(recipeId)}/change-type`, {
        method: "PATCH",
        body: JSON.stringify({ changeType: nextChangeType, expectedChangeType: currentChangeType })
      });
      dialog.close();
      toast(payload.recipe?.storage?.lastError || `制作分类已改为“${payload.recipe?.changeType?.label || "新分类"}”，前端、OSS 快照和数据库索引已同步。`);
      await loadHistory(state.historyPage);
    } catch (error) {
      submit.disabled = false;
      submit.textContent = "确认修改";
      toast(error.message);
    }
  });
  dialog.showModal();
}

async function editHistoryTitle(recipeId) {
  const recipe = state.historyItems.find((item) => item.id === recipeId);
  if (!recipe) return;
  const value = window.prompt("修改模板视频名称", recipe.title || "");
  if (value === null || value.trim() === recipe.title) return;
  if (!value.trim()) return toast("模板视频名称不能为空");
  try {
    const payload = await apiJson(`./api/one-click-remake/history/${encodeURIComponent(recipeId)}/title`, {
      method: "PATCH",
      body: JSON.stringify({ title: value.trim() })
    });
    toast(payload.recipe?.storage?.lastError || "模板视频名称已更新，并重新同步案例快照与检索索引。");
    await loadHistory(state.historyPage);
  } catch (error) {
    toast(error.message);
  }
}

function editHistoryOwner(recipeId) {
  const recipe = state.historyItems.find((item) => item.id === recipeId);
  if (!recipe || state.historyPermissions.canChangeOwnerHistory !== true) return;
  const currentOwnerKey = String(recipe.ownerKey || "");
  const owners = uniqueOwnerOptions([
    ...(Array.isArray(state.historyOwnerOptions) ? state.historyOwnerOptions : []),
    ...(currentOwnerKey && recipe.ownerName ? [{ key: currentOwnerKey, name: recipe.ownerName }] : [])
  ], currentOwnerKey);
  if (!owners.length) return toast("暂无可转移的工作台用户。目标用户需要至少登录过一次工作台。");
  const dialog = document.createElement("dialog");
  dialog.className = "owner-transfer-dialog";
  dialog.innerHTML = `
    <form method="dialog" class="owner-transfer-form">
      <div class="owner-transfer-heading">
        <span>管理员操作</span>
        <h3>修改模板归属</h3>
        <p>修改后，该模板将从原归属人的历史列表移至新归属人；任务本身和原始创建记录保持不变。</p>
      </div>
      <div class="owner-transfer-search">
        <label for="ownerTransferSearch">搜索归属人</label>
        <div>
          <input id="ownerTransferSearch" type="search" autocomplete="off" placeholder="输入姓名" />
          <button class="secondary-button" type="button" data-search-owner>搜索</button>
        </div>
        <p data-owner-search-result>共 ${owners.length} 位可选归属人</p>
      </div>
      <label>新的归属人
        <select name="ownerKey" required>
        </select>
      </label>
      <div class="owner-transfer-actions">
        <button class="secondary-button" type="button" data-cancel-owner-transfer>取消</button>
        <button class="primary-button" type="submit">确认修改</button>
      </div>
    </form>
  `;
  document.body.appendChild(dialog);
  dialog.addEventListener("close", () => dialog.remove(), { once: true });
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
  $("[data-cancel-owner-transfer]", dialog).addEventListener("click", () => dialog.close());
  const ownerSelect = $("select[name='ownerKey']", dialog);
  const searchInput = $("#ownerTransferSearch", dialog);
  const searchButton = $("[data-search-owner]", dialog);
  const searchResult = $("[data-owner-search-result]", dialog);
  const submit = $("button[type='submit']", dialog);
  const renderOwnerOptions = (query = "") => {
    const keyword = normalizedOwnerName(query);
    const previousValue = ownerSelect.value || currentOwnerKey;
    const matches = keyword ? owners.filter((owner) => normalizedOwnerName(owner.name).includes(keyword)) : owners;
    ownerSelect.innerHTML = matches.map((owner) => `<option value="${escapeHtml(owner.key)}">${escapeHtml(owner.name)}</option>`).join("");
    const preferredValue = matches.some((owner) => owner.key === previousValue)
      ? previousValue
      : (matches.some((owner) => owner.key === currentOwnerKey) ? currentOwnerKey : matches[0]?.key || "");
    ownerSelect.value = preferredValue;
    ownerSelect.disabled = matches.length === 0;
    submit.disabled = matches.length === 0;
    searchResult.textContent = matches.length
      ? `找到 ${matches.length} 位可选归属人`
      : `未找到“${String(query || "").trim()}”`;
  };
  searchButton.addEventListener("click", () => renderOwnerOptions(searchInput.value));
  searchInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    renderOwnerOptions(searchInput.value);
  });
  renderOwnerOptions();
  $("form", dialog).addEventListener("submit", async (event) => {
    event.preventDefault();
    const ownerKey = new FormData(event.currentTarget).get("ownerKey");
    if (!ownerKey || ownerKey === currentOwnerKey) return dialog.close();
    submit.disabled = true;
    submit.textContent = "正在修改…";
    try {
      const payload = await apiJson(`./api/one-click-remake/history/${encodeURIComponent(recipeId)}/owner`, {
        method: "PATCH",
        body: JSON.stringify({ ownerKey })
      });
      dialog.close();
      toast(payload.recipe?.storage?.lastError || `归属已修改为“${payload.recipe?.ownerName || "新归属人"}”，案例快照与检索索引已同步更新。`);
      await loadHistory(state.historyPage);
    } catch (error) {
      submit.disabled = false;
      submit.textContent = "确认修改";
      toast(error.message);
    }
  });
  dialog.showModal();
}

async function editHistoryTags(recipeId) {
  const recipe = state.historyItems.find((item) => item.id === recipeId);
  if (!recipe) return;
  const value = window.prompt("输入标签，使用逗号分隔（最多12个）", (recipe.tags || []).join("，"));
  if (value === null) return;
  try {
    const payload = await apiJson(`./api/one-click-remake/history/${encodeURIComponent(recipeId)}/tags`, {
      method: "PATCH",
      body: JSON.stringify({ tags: value })
    });
    toast(payload.recipe?.storage?.lastError || "标签已更新，并重新同步案例快照与检索索引。");
    await loadHistory(state.historyPage);
  } catch (error) {
    toast(error.message);
  }
}

async function deleteHistoryRecipe(recipeId) {
  const recipe = state.historyItems.find((item) => item.id === recipeId);
  if (!recipe || !window.confirm(`确认删除“${recipe.title}”吗？该案例将从历史任务、数据库索引和OSS快照中移除。`)) return;
  try {
    const payload = await apiJson(`./api/one-click-remake/history/${encodeURIComponent(recipeId)}`, { method: "DELETE" });
    toast(payload.result?.warning || "历史案例已删除。");
    await loadHistory(state.historyPage);
  } catch (error) {
    toast(error.message);
  }
}

function renderLibrary(items) {
  const host = $("#libraryGrid");
  state.libraryItems = items;
  if (!items.length) {
    host.innerHTML = '<p class="empty-state">没有找到符合条件的正式案例。人工质检通过的成片，或源视频、提示词与 OSS 快照完整的成功拆解模板，可加入提示词库。</p>';
    return;
  }
  host.innerHTML = items.map((recipe) => `
    <article class="library-card">
      <div class="library-body">
        <span class="badge is-ok">${escapeHtml(recipe.targetProduct?.name || "正式案例")}</span>
        <h3>${escapeHtml(recipe.title)}</h3>
        <p>${escapeHtml(recipe.audit?.videoType || recipe.changeType?.label || "参考画布复刻")} · ${escapeHtml(recipe.source?.model || "")}</p>
        <p class="library-owner">归属：${escapeHtml(recipe.ownerName || recipe.createdBy || recipe.ownerKey || "未知账号")}</p>
        <div class="library-tags">${(recipe.tags || []).slice(0, 6).map((tag) => `<span class="badge">${escapeHtml(tag)}</span>`).join("")}</div>
        ${(recipe.imagePrompts || []).map((item) => `
          <details><summary>生图：${escapeHtml(item.sourceLabel)}</summary><pre>${escapeHtml(item.compiler?.imagePrompt || "")}\n\n【尺寸方案】\n${jsonText(item.compiler?.scalePlan)}</pre></details>
        `).join("")}
        <details><summary>源视频提示词</summary><pre>${escapeHtml(recipe.videoPrompt?.source || "")}</pre></details>
        <details><summary>同款视频提示词</summary><pre>${escapeHtml(recipe.videoPrompt?.compiled || "")}</pre></details>
        <div class="library-storage">
          <span>${escapeHtml(recipe.storage?.syncState === "synchronized" ? "OSS快照 · 数据库索引" : recipe.storage?.syncState === "database_only" ? "数据库索引 · OSS待同步" : recipe.storage?.syncState === "oss_only" ? "OSS快照 · 索引待同步" : "本机回退缓存")}</span>
          ${recipe.storage?.snapshotUrl ? `<a href="${escapeHtml(recipe.storage.snapshotUrl)}" target="_blank" rel="noopener">查看快照</a>` : ""}
          ${recipe.permissions?.canDeleteFormalCase === true ? `<button class="danger-button library-delete-button" type="button" data-delete-formal-case="${escapeHtml(recipe.id)}">删除正式案例</button>` : ""}
        </div>
      </div>
    </article>
  `).join("");
  $$('[data-delete-formal-case]', host).forEach((button) => button.addEventListener("click", () => deleteFormalCase(button.dataset.deleteFormalCase)));
}

async function deleteFormalCase(recipeId) {
  const recipe = state.libraryItems.find((item) => item.id === recipeId);
  if (!recipe || recipe.permissions?.canDeleteFormalCase !== true) return;
  if (!window.confirm(`确认从提示词库删除“${recipe.title}”吗？数据库索引与 OSS 案例快照会移除，原任务和成片仍保留，可由归属人或管理员重新加入。`)) return;
  try {
    const payload = await apiJson(`./api/one-click-remake/prompt-library/${encodeURIComponent(recipeId)}`, { method: "DELETE" });
    toast(payload.result?.warning || "正式案例已从提示词库移除，原任务与成片已保留。");
    await Promise.all([searchLibrary(state.libraryPage), loadHistory(state.historyPage)]);
  } catch (error) {
    toast(error.message);
  }
}

async function openFormalCaseDialog(button) {
  const originalLabel = button.textContent;
  button.disabled = true;
  button.textContent = "正在读取可归档案例…";
  try {
    const payload = await apiJson("./api/one-click-remake/prompt-library/candidates");
    const available = (payload.items || []).filter((item) => item.archived !== true);
    const dialog = document.createElement("dialog");
    dialog.className = "owner-transfer-dialog formal-case-dialog";
    dialog.innerHTML = `
      <form method="dialog" class="owner-transfer-form">
        <div class="owner-transfer-heading">
          <span>正式案例治理</span>
          <h3>新增正式案例</h3>
          <p>可选择人工质检通过的成片，或源视频、源提示词与 OSS 快照完整的成功拆解模板。归属人只能加入自己的案例；管理员可跨归属加入，案例归属不会改变。</p>
        </div>
        ${available.length ? `
          <label>选择可归档案例
            <select name="candidateKey" required>
              ${available.map((item) => `<option value="${escapeHtml(item.key)}">${escapeHtml(item.kind === "source_template" ? "成功拆解模板" : "质检通过成片")} · ${escapeHtml(item.title)} · ${escapeHtml(item.ownerName)} · ${escapeHtml(localTime(item.completedAt))}</option>`).join("")}
            </select>
          </label>
          <p class="formal-case-source-note">共 ${available.length} 条可归档案例；已在库案例不会重复显示。</p>
        ` : '<p class="empty-state">当前没有可加入的案例。人工质检通过的成片，或源视频、源提示词与 OSS/数据库快照完整的成功拆解模板，会显示在这里。</p>'}
        <div class="owner-transfer-actions">
          <button class="secondary-button" type="button" data-cancel-formal-case>${available.length ? "取消" : "关闭"}</button>
          ${available.length ? '<button class="primary-button" type="submit">确认加入</button>' : ""}
        </div>
      </form>
    `;
    document.body.appendChild(dialog);
    dialog.addEventListener("close", () => dialog.remove(), { once: true });
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) dialog.close();
    });
    $("[data-cancel-formal-case]", dialog).addEventListener("click", () => dialog.close());
    if (available.length) {
      $("form", dialog).addEventListener("submit", async (event) => {
        event.preventDefault();
        const candidateKey = String(new FormData(event.currentTarget).get("candidateKey") || "");
        const candidate = available.find((item) => item.key === candidateKey);
        if (!candidate) return toast("请选择有效的可归档案例");
        const submit = $('button[type="submit"]', dialog);
        submit.disabled = true;
        submit.textContent = "正在归档…";
        try {
          const result = await apiJson("./api/one-click-remake/prompt-library", {
            method: "POST",
            body: JSON.stringify(candidate.kind === "source_template"
              ? { sourceRecipeId: candidate.sourceRecipeId }
              : { jobId: candidate.jobId, targetId: candidate.targetId })
          });
          dialog.close();
          toast(result.alreadyExists ? "该正式案例已经在提示词库中。" : "正式案例已加入，并同步 OSS 快照与数据库索引。");
          await Promise.all([searchLibrary(1), loadHistory(state.historyPage)]);
        } catch (error) {
          submit.disabled = false;
          submit.textContent = "确认加入";
          toast(error.message);
        }
      });
    }
    dialog.showModal();
  } catch (error) {
    toast(error.message);
  } finally {
    button.disabled = false;
    button.textContent = originalLabel;
  }
}

function historyQuery(page) {
  const form = new FormData($("#historySearchForm"));
  const params = new URLSearchParams({ page: String(page || 1), pageSize: "18" });
  for (const [key, value] of form.entries()) {
    const normalized = String(value || "").trim();
    if (normalized) params.set(key, normalized);
  }
  return params;
}

async function loadHistory(page = 1) {
  if (state.historyLoading) return;
  state.historyLoading = true;
  $("#historyResultCount").textContent = "正在检索历史模板…";
  try {
    const payload = await apiJson(`./api/one-click-remake/history?${historyQuery(page)}`);
    state.historyPermissions = payload.permissions || state.config?.permissions || {};
    state.historyOwnerOptions = Array.isArray(payload.ownerOptions) ? payload.ownerOptions : [];
    state.historyPage = Number(payload.page || 1);
    state.historyPages = Math.max(1, Number(payload.pages || 1));
    renderHistory(payload.items || []);
    $("#historyResultCount").textContent = `共 ${Number(payload.total || 0)} 条历史模板`;
    $("#historyPagination").hidden = state.historyPages <= 1;
    $("#historyPageText").textContent = `第 ${state.historyPage} / ${state.historyPages} 页`;
    $("#historyPrev").disabled = state.historyPage <= 1;
    $("#historyNext").disabled = state.historyPage >= state.historyPages;
    if (payload.warning) toast(payload.warning);
  } catch (error) {
    $("#historyResultCount").textContent = "历史模板检索失败";
    toast(error.message);
  } finally {
    state.historyLoading = false;
  }
}

function libraryQuery(page) {
  const form = new FormData($("#librarySearchForm"));
  const params = new URLSearchParams({ page: String(page || 1), pageSize: "12" });
  for (const [key, value] of form.entries()) {
    const normalized = String(value || "").trim();
    if (normalized) params.set(key, normalized);
  }
  return params;
}

async function searchLibrary(page = 1) {
  if (state.libraryLoading) return;
  state.libraryLoading = true;
  $("#libraryResultCount").textContent = "正在检索提示词库…";
  try {
    const payload = await apiJson(`./api/one-click-remake/prompt-library?${libraryQuery(page)}`);
    state.libraryPermissions = payload.permissions || state.config?.permissions || {};
    state.libraryPage = Number(payload.page || 1);
    state.libraryPages = Math.max(1, Number(payload.pages || 1));
    renderLibrary(payload.items || []);
    $("#libraryResultCount").textContent = `共 ${Number(payload.total || 0)} 条正式案例`;
    $("#libraryStorageState").textContent = payload.sourceMode === "database-oss"
      ? "OSS 快照 · 数据库索引"
      : "本机缓存回退";
    $("#libraryStorageState").title = payload.warning || "";
    $("#libraryAddFormalCase").hidden = state.libraryPermissions.canAddFormalCase !== true;
    if (payload.warning) toast(payload.warning);
    $("#libraryPagination").hidden = state.libraryPages <= 1;
    $("#libraryPageText").textContent = `第 ${state.libraryPage} / ${state.libraryPages} 页`;
    $("#libraryPrev").disabled = state.libraryPage <= 1;
    $("#libraryNext").disabled = state.libraryPage >= state.libraryPages;
  } catch (error) {
    $("#libraryResultCount").textContent = "提示词库检索失败";
    toast(error.message);
  } finally {
    state.libraryLoading = false;
  }
}

async function init() {
  state.config = await apiJson("./api/one-click-remake/config");
  fillChangeTypes();
  $$(".mode-tab").forEach((button) => button.addEventListener("click", () => activateTab(button.dataset.tab)));
  $$("[data-workflow-step]").forEach((button) => button.addEventListener("click", () => selectWorkflowStep(button.dataset.workflowStep)));
  $("#backToTaskList").addEventListener("click", showTaskLanding);
  $("#sourceForm").addEventListener("submit", createSourceJob);
  $("#historySearchForm").addEventListener("submit", (event) => {
    event.preventDefault();
    loadHistory(1);
  });
  $("#historyReset").addEventListener("click", () => {
    $("#historySearchForm").reset();
    loadHistory(1);
  });
  $("#historyPrev").addEventListener("click", () => loadHistory(Math.max(1, state.historyPage - 1)));
  $("#historyNext").addEventListener("click", () => loadHistory(Math.min(state.historyPages, state.historyPage + 1)));
  $("#librarySearchForm").addEventListener("submit", (event) => {
    event.preventDefault();
    searchLibrary(1);
  });
  $("#libraryReset").addEventListener("click", () => {
    $("#librarySearchForm").reset();
    searchLibrary(1);
  });
  $("#libraryAddFormalCase").addEventListener("click", (event) => openFormalCaseDialog(event.currentTarget));
  $("#libraryPrev").addEventListener("click", () => searchLibrary(Math.max(1, state.libraryPage - 1)));
  $("#libraryNext").addEventListener("click", () => searchLibrary(Math.min(state.libraryPages, state.libraryPage + 1)));
  $("#toggleDetails").addEventListener("click", () => {
    state.detailsOpen = !state.detailsOpen;
    $("#processDetails").hidden = !state.detailsOpen;
    $("#jobPanel").hidden = !state.detailsOpen && $("#jobAccessNotice").hidden;
    $("#toggleDetails").textContent = state.detailsOpen ? "收起详情" : "过程与耗时";
  });
  $("[data-close-video-review]").addEventListener("click", closeVideoReview);
  $("#videoReviewDialog").addEventListener("click", (event) => {
    if (event.target === event.currentTarget) closeVideoReview();
  });
  $("#videoReviewDialog").addEventListener("close", () => {
    $("#videoReviewPlayer")?.pause();
    state.videoReview = null;
  });
  $("#videoReviewApprove").addEventListener("click", (event) => submitVideoReview("approve", event.currentTarget));
  $("#videoReviewReject").addEventListener("click", (event) => submitVideoReview("reject", event.currentTarget));
  await Promise.all([loadHistory(), searchLibrary(1)]);
  if (state.currentJobId) {
    showWorkspace(null, { force: true });
    await pollCurrentJob();
  } else {
    activateTab("tasks");
    updateWorkflowNavigation(null, { force: true });
  }
  setInterval(pollCurrentJob, 2000);
}

init().catch((error) => toast(error.message));

window.addEventListener("resize", () => layoutProductAssetStrips($("#targetConfigurator")));
