const form = document.querySelector("#kocForm");
const productSelect = document.querySelector("#kocProductSelect");
const healthLine = document.querySelector("#kocHealthLine");
const analysisModeSelect = document.querySelector("#analysisModeSelect");
const manualAnalysisField = document.querySelector("#manualAnalysisField");
const useOriginalVoiceReference = document.querySelector("#useOriginalVoiceReference");
const generationSettingsToggle = document.querySelector("#kocGenerationSettingsToggle");
const generationSettingsPanel = document.querySelector("#kocGenerationSettingsPanel");
const generationSettingsSummary = document.querySelector("#kocGenerationSettingsSummary");
const videoResolutionSelect = document.querySelector("#kocVideoResolution");
const guidePanel = document.querySelector("#kocGuidePanel");
const guideToggleButton = document.querySelector("#toggleKocGuideButton");
const prepareButton = document.querySelector("#prepareKocButton");
const generateButton = document.querySelector("#generateKocButton");
const scriptSelect = document.querySelector("#kocScriptSelect");
const scriptSearch = document.querySelector("#kocScriptSearch");
const scriptLibraryStatus = document.querySelector("#kocScriptLibraryStatus");
const refreshScriptsButton = document.querySelector("#refreshKocScriptsButton");
const formBadge = document.querySelector("#kocFormBadge");
const jobMessage = document.querySelector("#kocJobMessage");
const progressText = document.querySelector("#kocProgressText");
const progressBar = document.querySelector("#kocProgressBar");
const autoSteps = Array.from(document.querySelectorAll("[data-auto-stage]"));
const resumeGate = document.querySelector("#kocResumeGate");
const resumeHint = document.querySelector("#kocResumeHint");
const resumeInterruptedButton = document.querySelector("#resumeInterruptedKocButton");
const filesBox = document.querySelector("#kocFiles");
const reviewGate = document.querySelector("#kocReviewGate");
const taskList = document.querySelector("#kocTaskList");
const removedClips = document.querySelector("#kocRemovedClips");
const removedClipList = document.querySelector("#kocRemovedClipList");
const resultGrid = document.querySelector("#kocResultGrid");
const resultBadge = document.querySelector("#kocResultBadge");
const logBox = document.querySelector("#kocLogBox");
const jobIdLine = document.querySelector("#kocJobId");
const openOutputButton = document.querySelector("#openKocOutputButton");
const canvasLink = document.querySelector("#kocCanvasLink");
const productLibraryGrid = document.querySelector("#productLibraryGrid");
const refreshProductLibraryButton = document.querySelector("#refreshProductLibraryButton");
const candidateGate = document.querySelector("#kocCandidateGate");
const candidateGrid = document.querySelector("#kocCandidateGrid");
const regenerateCandidatesButton = document.querySelector("#regenerateCandidatesButton");
const useManualCharacterButton = document.querySelector("#useManualCharacterButton");
const auditBadge = document.querySelector("#kocAuditBadge");
const auditList = document.querySelector("#kocAuditList");
const reviewDetailsToggle = document.querySelector("#toggleKocReviewDetailsButton");
const reviewDetails = document.querySelector("#kocReviewDetails");
const reviewRevision = document.querySelector("#kocReviewRevision");
const deepDivePreview = document.querySelector("#kocDeepDivePreview");
const storyboardEditor = document.querySelector("#kocStoryboardEditor");
const durationEditor = document.querySelector("#kocDurationEditor");
const durationTotal = document.querySelector("#kocDurationTotal");
const finalDeliveryStatus = document.querySelector("#kocFinalDeliveryStatus");
const retryFinalDeliveryButton = document.querySelector("#retryKocFinalDeliveryButton");
const segmentResults = document.querySelector("#kocSegmentResults");
const segmentResultGrid = document.querySelector("#kocSegmentResultGrid");
const saveReviewPlanButton = document.querySelector("#saveKocReviewPlanButton");
const reviewSaveStatus = document.querySelector("#kocReviewSaveStatus");
const retryAllButton = document.querySelector("#retryAllKocButton");
const clearDraftButton = document.querySelector("#clearKocDraftButton");
const transcriptStatus = document.querySelector("#kocTranscriptStatus");
const transcriptCount = document.querySelector("#kocTranscriptCount");
const voiceoverCount = document.querySelector("#kocVoiceoverCount");
const retryTranscriptButton = document.querySelector("#retryKocTranscriptButton");
const asrRawDetails = document.querySelector("#kocAsrRaw");
const asrRawText = document.querySelector("#kocAsrRawText");
const KOC_DRAFT_KEY = "brand-marketing-koc-draft-v287";
const kocEntryParams = new URLSearchParams(location.search);

const state = {
  session: `koc-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  currentJobId: kocEntryParams.has("new") ? "" : (kocEntryParams.get("task") || localStorage.getItem("product-shot-koc-job") || ""),
  pollTimer: null,
  uploads: {
    reference: null,
    character: null,
    products: []
  },
  productLibrary: [],
  productLibraryLoading: false,
  scripts: [],
  selectedScript: null,
  defaults: null,
  saveTimer: null,
  currentJobStatus: "",
  hydratedJobId: "",
  draftCreationPromise: null,
  draftSyncTimer: null,
  draftSyncPending: null,
  draftSyncInFlight: false,
  draftSyncLast: "",
  reviewEditorKey: "",
  reviewRevision: 0,
  resultRenderKey: "",
  sourceTranscript: null,
  sourceTranscriptStatus: "idle",
  transcriptRequestId: 0
};

function timingCharCount(value) {
  return Array.from(String(value || "").replace(/\s/g, "")).length;
}

function renderTranscriptMeta() {
  const oldText = String(form.elements.referenceTranscript?.value || "");
  const newText = String(form.elements.voiceoverScript?.value || "");
  transcriptCount.textContent = `${timingCharCount(oldText)}字符`;
  voiceoverCount.textContent = `${timingCharCount(newText)}字符`;
  const transcript = state.sourceTranscript;
  if (state.sourceTranscriptStatus === "running") {
    transcriptStatus.textContent = "XingChenASR 正在识别，随后由 DeepSeek 4 Pro 保真校订…";
    retryTranscriptButton.hidden = true;
  } else if (state.sourceTranscriptStatus === "failed") {
    transcriptStatus.textContent = "自动识别失败；可重新识别或人工核对输入";
    retryTranscriptButton.hidden = false;
  } else if (transcript?.text) {
    const refinement = transcript.refinement?.status;
    const refinementLabel = ["failed", "rejected"].includes(refinement)
      ? "DeepSeek 校订未通过，已沿用 ASR 原文"
      : "DeepSeek 4 Pro 保真校订完成";
    const channelLabel = transcript.channelStrategy === "split_stereo" ? " · 左右声道分轨" : "";
    const overlapLabel = Number(transcript.overlapCount || 0) > 0 ? ` · ${transcript.overlapCount}段重叠讲话需人工核对` : "";
    transcriptStatus.textContent = `XingChenASR · ${refinementLabel}${transcript.speakerCount > 1 ? ` · ${transcript.speakerCount}位说话人` : ""}${channelLabel}${overlapLabel}`;
    retryTranscriptButton.hidden = false;
  } else {
    transcriptStatus.textContent = "上传原片后自动识别";
    retryTranscriptButton.hidden = !state.uploads.reference;
  }
  const rawText = String(transcript?.rawText || "").trim();
  asrRawDetails.hidden = !rawText || rawText === String(transcript?.text || "").trim();
  asrRawText.textContent = rawText;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
}

function renderScriptLibrary() {
  const keyword = scriptSearch.value.trim().toLowerCase();
  const visible = state.scripts.filter((item) => `${item.title} ${item.product} ${item.scriptType} ${item.copy}`.toLowerCase().includes(keyword));
  if (state.selectedScript && !visible.some((item) => item.id === state.selectedScript.id)) visible.unshift(state.selectedScript);
  scriptSelect.innerHTML = '<option value="">不选择脚本</option>' + visible.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml([item.title, item.product, item.scriptType].filter(Boolean).join(" · "))}</option>`).join("");
  scriptSelect.value = state.selectedScript?.id || "";
  document.querySelector("#kocSelectedScriptPreview").hidden = !state.selectedScript;
  document.querySelector("#kocSelectedScriptCopy").value = state.selectedScript?.copy || "";
  document.querySelector("#kocSelectedScriptMeta").textContent = state.selectedScript ? `${state.selectedScript.title} · 所选脚本原文` : "所选脚本原文";
}

async function loadScriptLibrary() {
  refreshScriptsButton.disabled = true;
  scriptLibraryStatus.textContent = "正在加载品牌案例库…";
  try {
    const moduleMarker = "/modules/ai-first-creation/";
    const moduleIndex = location.pathname.indexOf(moduleMarker);
    const endpoint = moduleIndex >= 0
      ? `${location.pathname.slice(0, moduleIndex)}/modules/creative-hub/api/cases`
      : "./api/koc/scripts";
    const result = await api(endpoint);
    if (!Array.isArray(result.cases)) throw new Error("品牌案例库返回的脚本列表不可用");
    state.scripts = result.cases.filter((item) => item.id && String(item.copy || "").trim()).map((item) => ({
      id: String(item.id), title: String(item.title || "未命名脚本"), copy: String(item.copy),
      product: String(item.product || ""), scriptType: String(item.scriptType || ""), source: "创意来源-品牌案例库"
    }));
    scriptLibraryStatus.textContent = state.scripts.length ? `已加载 ${state.scripts.length} 条品牌案例脚本，可搜索并选择。` : "品牌案例库暂无脚本，可填写口播或直接生成无口播画面。";
  } catch (error) {
    scriptLibraryStatus.textContent = `脚本加载失败：${error.message}；可刷新重试，或填写口播继续制作。`;
  } finally {
    renderScriptLibrary();
    refreshScriptsButton.disabled = false;
  }
}

function collectFormValues() {
  const values = {};
  Array.from(form.elements).forEach((field) => {
    if (!field.name) return;
    values[field.name] = field.type === "checkbox" ? field.checked : field.value;
  });
  return values;
}

function localDraftTaskName() {
  try { return String(JSON.parse(localStorage.getItem(KOC_DRAFT_KEY) || "null")?.taskName || "").trim(); } catch { return ""; }
}

function localDraftSnapshot() {
  return {
    version: 2,
    updatedAt: new Date().toISOString(),
    session: state.session,
    taskId: state.currentJobId,
    taskName: localDraftTaskName(),
    values: collectFormValues(),
    uploads: state.uploads,
    sourceTranscript: state.sourceTranscript,
    selectedScript: state.selectedScript
  };
}

function saveDraft() {
  clearTimeout(state.saveTimer);
  const draft = localDraftSnapshot();
  localStorage.setItem(KOC_DRAFT_KEY, JSON.stringify(draft));
  queueKocDraftSync();
}

function scheduleSaveDraft() {
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(saveDraft, 180);
}

function restoreDraft() {
  let draft = null;
  try {
    draft = JSON.parse(localStorage.getItem(KOC_DRAFT_KEY) || "null");
  } catch {}
  if (!draft || ![1, 2].includes(Number(draft.version))) return false;
  if (state.currentJobId && String(draft.taskId || "") !== state.currentJobId) return false;
  state.session = String(draft.session || state.session);
  state.uploads = {
    reference: draft.uploads?.reference || null,
    character: draft.uploads?.character || null,
    products: Array.isArray(draft.uploads?.products) ? draft.uploads.products.slice(0, 9) : []
  };
  state.sourceTranscript = draft.sourceTranscript && typeof draft.sourceTranscript === "object" ? draft.sourceTranscript : null;
  state.selectedScript = draft.selectedScript || null;
  renderScriptLibrary();
  state.sourceTranscriptStatus = state.sourceTranscript?.text ? "success" : "idle";
  Object.entries(draft.values || {}).forEach(([name, value]) => {
    if (name === "declineAudioReference" && !Object.prototype.hasOwnProperty.call(draft.values || {}, "useOriginalVoiceReference")) {
      useOriginalVoiceReference.checked = value !== true;
      return;
    }
    const field = form.elements[name];
    if (!field) return;
    if (field.type === "checkbox") field.checked = value === true;
    else field.value = String(value ?? "");
  });
  manualAnalysisField.hidden = analysisModeSelect.value !== "manual";
  renderUploads();
  renderTranscriptMeta();
  formBadge.textContent = "已恢复上次填写";
  return true;
}

async function clearDraft() {
  clearTimeout(state.saveTimer);
  const paths = [
    state.uploads.reference?.path,
    state.uploads.character?.path,
    ...state.uploads.products.map((item) => item.path)
  ].filter(Boolean);
  localStorage.removeItem(KOC_DRAFT_KEY);
  state.session = `koc-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  state.uploads = { reference: null, character: null, products: [] };
  state.sourceTranscript = null;
  state.selectedScript = null;
  state.sourceTranscriptStatus = "idle";
  form.reset();
  if (state.defaults) {
    productSelect.value = "";
  }
  manualAnalysisField.hidden = true;
  renderScriptLibrary();
  renderUploads();
  renderTranscriptMeta();
  await loadProductLibrary();
  formBadge.textContent = "已清空";
  saveDraft();
  paths.forEach((filePath) => {
    fetch("./api/upload/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: filePath })
    }).catch(() => {});
  });
}

async function ensurePersistentDraft() {
  if (state.currentJobId) return state.currentJobId;
  if (state.draftCreationPromise) return state.draftCreationPromise;
  state.draftCreationPromise = api("./api/koc/jobs/drafts", {
    method: "POST",
    body: JSON.stringify({ draftData: payloadFromForm() })
  }).then((result) => {
    if (!result.job?.id) throw new Error("服务端没有返回KOC草稿任务");
    state.currentJobId = result.job.id;
    state.currentJobStatus = "draft";
    state.hydratedJobId = result.job.id;
    localStorage.setItem("product-shot-koc-job", result.job.id);
    localStorage.setItem(KOC_DRAFT_KEY, JSON.stringify(localDraftSnapshot()));
    const url = new URL(window.location.href);
    url.searchParams.delete("new");
    url.searchParams.set("task", result.job.id);
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
    window.dispatchEvent(new Event("module-task-updated"));
    formBadge.textContent = "草稿已保存";
    return result.job.id;
  }).catch((error) => {
    formBadge.textContent = `草稿保存失败：${error.message}`;
    throw error;
  }).finally(() => {
    state.draftCreationPromise = null;
  });
  return state.draftCreationPromise;
}

function queueKocDraftSync() {
  if (!state.currentJobId) {
    ensurePersistentDraft().then(queueKocDraftSync).catch(() => {});
    return;
  }
  if (state.currentJobStatus !== "draft") return;
  const draftData = payloadFromForm();
  const serialized = JSON.stringify(draftData);
  if (serialized === state.draftSyncLast) return;
  state.draftSyncPending = { jobId: state.currentJobId, draftData, serialized };
  clearTimeout(state.draftSyncTimer);
  state.draftSyncTimer = setTimeout(flushKocDraftSync, 250);
}

async function flushKocDraftSync() {
  if (state.draftSyncInFlight || !state.draftSyncPending) return;
  const pending = state.draftSyncPending;
  state.draftSyncPending = null;
  state.draftSyncInFlight = true;
  try {
    await api(`./api/koc/jobs/${encodeURIComponent(pending.jobId)}`, {
      method: "PATCH",
      body: JSON.stringify({ draftData: pending.draftData })
    });
    state.draftSyncLast = pending.serialized;
    formBadge.textContent = "草稿已自动保存";
    window.dispatchEvent(new Event("module-task-updated"));
  } catch (error) {
    if (state.currentJobId === pending.jobId && state.currentJobStatus === "draft") {
      formBadge.textContent = `草稿自动保存失败：${error.message}`;
    }
  } finally {
    state.draftSyncInFlight = false;
    if (state.draftSyncPending) state.draftSyncTimer = setTimeout(flushKocDraftSync, 250);
  }
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || data.message || `请求失败：${response.status}`);
  return data;
}

async function refreshHealth() {
  const provider = state.defaults?.analysisProvider || {};
  const analysisText = provider.configured
    ? `Qwen 3.7 多模态已接入（${provider.model || "qwen3.7-plus"}）`
    : "Qwen 3.7 多模态待配置";
  healthLine.textContent = `${analysisText} · 正在连接 LibTV`;
  try {
    const result = await api("./api/health");
    healthLine.textContent = `${analysisText} · ${result.message || "LibTV已登录"}`;
    healthLine.className = "health-ok";
  } catch (error) {
    healthLine.textContent = `${analysisText} · ${error.message}；原片拆解不依赖LibTV，确认生成前再登录`;
    healthLine.className = "health-error";
  }
}

function getMediaDuration(file, type) {
  return new Promise((resolve) => {
    const element = document.createElement(type === "audio" ? "audio" : "video");
    const url = URL.createObjectURL(file);
    element.preload = "metadata";
    element.onloadedmetadata = () => {
      const duration = Number(element.duration || 0);
      URL.revokeObjectURL(url);
      resolve(Number.isFinite(duration) ? duration : 0);
    };
    element.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(0);
    };
    element.src = url;
  });
}

async function uploadFile(file, kind) {
  const query = new URLSearchParams({ kind, name: file.name, session: state.session });
  const response = await fetch(`./api/upload?${query}`, { method: "POST", body: file });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `上传失败：${file.name}`);
  return { ...data, originalName: file.name };
}

async function transcribeKocReference(options = {}) {
  const reference = state.uploads.reference;
  if (!reference?.path) return;
  const requestId = ++state.transcriptRequestId;
  state.sourceTranscriptStatus = "running";
  renderTranscriptMeta();
  formBadge.textContent = "正在识别原片口播";
  try {
    const transcript = await api("./api/koc/transcribe-reference", {
      method: "POST",
      body: JSON.stringify({ referenceVideoPath: reference.path, force: options.force === true })
    });
    if (requestId !== state.transcriptRequestId || state.uploads.reference?.path !== reference.path) return;
    const previousAutoText = String(state.sourceTranscript?.text || "").trim();
    const oldField = form.elements.referenceTranscript;
    const newField = form.elements.voiceoverScript;
    if (!String(oldField.value || "").trim() || String(oldField.value || "").trim() === previousAutoText || options.force === true) {
      oldField.value = transcript.text || transcript.rawText || "";
    }
    if (!state.selectedScript && (!String(newField.value || "").trim() || String(newField.value || "").trim() === previousAutoText)) {
      newField.value = transcript.text || transcript.rawText || "";
    }
    state.sourceTranscript = transcript;
    state.sourceTranscriptStatus = "success";
    formBadge.textContent = "旧口播已自动识别，请核对新口播";
    renderTranscriptMeta();
    saveDraft();
  } catch (error) {
    if (requestId !== state.transcriptRequestId) return;
    state.sourceTranscriptStatus = "failed";
    formBadge.textContent = "口播识别失败";
    renderTranscriptMeta();
    transcriptStatus.textContent = error.message;
  }
}

function fileNameFromPath(filePath) {
  return String(filePath || "").split(/[\\/]/).pop() || "产品图";
}

function selectedLibraryAsset(assetId) {
  return state.uploads.products.find((item) => item.libraryAssetId === assetId || item.librarySourcePath === assetId);
}

function renderProductLibrary() {
  if (state.productLibraryLoading) {
    productLibraryGrid.innerHTML = '<p class="product-library-empty">正在加载产品图...</p>';
    return;
  }
  if (!state.productLibrary.length) {
    productLibraryGrid.innerHTML = '<p class="product-library-empty">当前产品还没有标准产品图，可使用下方上传补充。</p>';
    return;
  }
  productLibraryGrid.innerHTML = state.productLibrary.map((asset) => {
    const selected = Boolean(selectedLibraryAsset(asset.id));
    const name = asset.title || asset.fileName || "产品资产";
    const thumbnailUrl = asset.thumbnailUrl || `./api/product-workflows/assets/${encodeURIComponent(asset.id)}/thumbnail`;
    return `<button class="product-library-card${selected ? " selected" : ""}" type="button" data-library-asset-id="${escapeHtml(asset.id)}" aria-pressed="${selected}">
      <img src="${escapeHtml(thumbnailUrl)}" alt="${escapeHtml(name)}" />
      <span>${escapeHtml(name)}</span><b>${selected ? "已选择" : "选择"}</b>
    </button>`;
  }).join("");
  productLibraryGrid.querySelectorAll("[data-library-asset-id]").forEach((button) => {
    button.addEventListener("click", () => toggleProductLibraryAsset(button.dataset.libraryAssetId, button));
  });
}

async function importProductLibraryAsset(assetId) {
  const asset = state.productLibrary.find((item) => item.id === assetId);
  if (!asset) throw new Error("产品资产不存在，请刷新统一资产库");
  const sourceResponse = await fetch(`./api/product-workflows/assets/${encodeURIComponent(assetId)}/original`);
  if (!sourceResponse.ok) throw new Error(`无法读取统一资产库产品图：${asset.title || asset.fileName || assetId}`);
  const blob = await sourceResponse.blob();
  const name = asset.fileName || `${asset.id}.jpg`;
  const query = new URLSearchParams({ kind: "koc-product", name, session: state.session });
  const response = await fetch(`./api/upload?${query}`, { method: "POST", body: blob });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `产品图选取失败：${name}`);
  return { ...data, name, originalName: name, libraryAssetId: asset.id, source: "product-library" };
}

async function toggleProductLibraryAsset(assetId, button) {
  const existing = selectedLibraryAsset(assetId);
  if (existing) {
    state.uploads.products = state.uploads.products.filter((item) => item !== existing);
    fetch("./api/upload/delete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: existing.path }) }).catch(() => {});
    renderUploads();
    renderProductLibrary();
    saveDraft();
    return;
  }
  if (state.uploads.products.length >= 9) return alert("目标产品图最多选择9张");
  button.disabled = true;
  formBadge.textContent = "正在选取产品图";
  try {
    state.uploads.products.push(await importProductLibraryAsset(assetId));
    formBadge.textContent = "产品图已选取";
    renderUploads();
    saveDraft();
  } catch (error) {
    formBadge.textContent = "产品图选取失败";
    alert(error.message);
  } finally {
    button.disabled = false;
    renderProductLibrary();
  }
}

async function loadProductLibrary() {
  if (!productSelect.value) {
    state.productLibrary = [];
    renderProductLibrary();
    productLibraryGrid.innerHTML = '<p class="product-library-empty">未选择产品；需要展示产品时，请先选择 SKU。</p>';
    return;
  }
  state.productLibraryLoading = true;
  renderProductLibrary();
  refreshProductLibraryButton.disabled = true;
  try {
    const result = await api(`./api/product-workflows/assets?assetType=image&productId=${encodeURIComponent(productSelect.value)}`);
    state.productLibrary = Array.isArray(result.items) ? result.items : [];
  } catch (error) {
    state.productLibrary = [];
    productLibraryGrid.innerHTML = `<p class="product-library-empty error">${escapeHtml(error.message)}</p>`;
  } finally {
    state.productLibraryLoading = false;
    refreshProductLibraryButton.disabled = false;
    renderProductLibrary();
  }
}

function renderUploads() {
  const reference = state.uploads.reference;
  document.querySelector("#referenceStatus").textContent = reference ? `${reference.duration.toFixed(1)}秒` : "可选";
  document.querySelector("#referencePreview").innerHTML = reference
    ? `<div class="compact-asset"><video src="./api/file?path=${encodeURIComponent(reference.path)}" muted controls></video><span>${escapeHtml(reference.name)}</span></div>`
    : "";
  const character = state.uploads.character;
  document.querySelector("#characterStatus").textContent = character ? "已上传" : "可选";
  document.querySelector("#characterPreview").innerHTML = character
    ? `<div class="compact-asset"><img src="./api/image?path=${encodeURIComponent(character.path)}" alt="${escapeHtml(character.name)}" /><span>${escapeHtml(character.name)}</span></div>`
    : "";
  document.querySelector("#productAssetStatus").textContent = state.uploads.products.length ? `${state.uploads.products.length}张` : "产品露出时必填";
  document.querySelector("#productAssetPreview").innerHTML = state.uploads.products.filter((item) => item.source !== "product-library").map((item) =>
    `<div class="compact-asset"><img src="./api/image?path=${encodeURIComponent(item.path)}" alt="${escapeHtml(item.name)}" /><span>${escapeHtml(item.name)}${item.source === "product-library" ? " · 产品镜图库" : " · 本地上传"}</span></div>`
  ).join("");
}

function bindDropZone(zoneId, inputId, kind, mode) {
  const zone = document.querySelector(zoneId);
  const input = document.querySelector(inputId);
  const handle = async (fileList) => {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    zone.classList.add("uploading");
    formBadge.textContent = "上传中";
    try {
      if (mode === "products") {
        const selected = files.slice(0, Math.max(0, 9 - state.uploads.products.length));
        for (const file of selected) state.uploads.products.push(await uploadFile(file, kind));
      } else {
        const file = files[0];
        const uploaded = await uploadFile(file, kind);
        if (mode === "reference") {
          uploaded.duration = await getMediaDuration(file, "video");
          const previousAutoText = String(state.sourceTranscript?.text || "").trim();
          if (!String(form.elements.referenceTranscript.value || "").trim() || String(form.elements.referenceTranscript.value || "").trim() === previousAutoText) {
            form.elements.referenceTranscript.value = "";
          }
          if (!String(form.elements.voiceoverScript.value || "").trim() || String(form.elements.voiceoverScript.value || "").trim() === previousAutoText) {
            form.elements.voiceoverScript.value = "";
          }
          state.sourceTranscript = null;
          state.sourceTranscriptStatus = "idle";
        }
        state.uploads[mode] = uploaded;
      }
      formBadge.textContent = "素材已更新";
      renderUploads();
      renderTranscriptMeta();
      saveDraft();
      if (mode === "reference") await transcribeKocReference();
    } catch (error) {
      formBadge.textContent = "上传失败";
      alert(error.message);
    } finally {
      zone.classList.remove("uploading");
      input.value = "";
    }
  };
  ["dragenter", "dragover"].forEach((name) => zone.addEventListener(name, (event) => {
    event.preventDefault();
    zone.classList.add("dragging");
  }));
  ["dragleave", "drop"].forEach((name) => zone.addEventListener(name, (event) => {
    event.preventDefault();
    zone.classList.remove("dragging");
  }));
  zone.addEventListener("drop", (event) => handle(event.dataTransfer?.files));
  input.addEventListener("change", () => handle(input.files));
}

function payloadFromForm() {
  const data = Object.fromEntries(new FormData(form).entries());
  const selectedProduct = productSelect.selectedOptions[0];
  const workstation = window.WorkbenchWorkstation.identity();
  let draft = null;
  try { draft = JSON.parse(localStorage.getItem(KOC_DRAFT_KEY) || "null"); } catch {}
  return window.WorkbenchKnowledge.enrich({
    ...data,
    workstationId: workstation.id,
    workstationLabel: workstation.label,
    productName: productSelect.value ? selectedProduct?.textContent || "" : "",
    selectedScript: state.selectedScript,
    referenceVideoPath: state.uploads.reference?.path || "",
    referenceVideoName: state.uploads.reference?.name || "",
    sourceDuration: state.uploads.reference?.duration || 0,
    referenceTranscriptAudit: state.sourceTranscript,
    selectedCharacterPath: state.uploads.character?.path || "",
    selectedCharacterName: state.uploads.character?.name || "",
    productAssetPaths: state.uploads.products.map((item) => item.path),
    productAssetNames: state.uploads.products.map((item) => item.name),
    declineAudioReference: !state.uploads.reference || !useOriginalVoiceReference.checked,
    useMotionReference: Boolean(state.uploads.reference) && form.elements.useMotionReference.checked,
    draftJobId: state.currentJobStatus === "draft" ? state.currentJobId : "",
    canvasMode: "workbench-task-v2",
    workbenchModule: "ai-koc",
    workbenchTaskName: String(draft?.taskName || "").trim()
  });
}

function statusLabel(status) {
  return ({
    draft: "草稿已保存",
    queued: "排队中",
    preparing: "正在拆解并生成候选图",
    validating: "正在执行资产与提示词检查",
    awaiting_character_selection: "等待选择人物场景图",
    awaiting_review: "等待人工审核",
    running: "正在生成",
    finalizing: "正在拼接并上传云管家",
    success: "全部完成",
    partial: "部分完成",
    failed: "失败",
    interrupted: "已中断"
  })[status] || status || "未知";
}

function renderAutomationStages(job = {}) {
  const status = String(job.status || "draft");
  const candidates = Array.isArray(job.characterCandidates) ? job.characterCandidates : [];
  const candidateReady = candidates.some((item) => item.status === "success");
  const analysisReady = Boolean(job.deepDive || job.checkpoints?.deepDiveReady);
  const stageState = {
    analysis: ["pending", "等待"],
    candidates: ["pending", "等待"],
    planning: ["pending", "等待"],
    generation: ["pending", "等待确认"]
  };
  if (["queued", "preparing"].includes(status)) {
    stageState.analysis = candidateReady ? ["done", "已完成"] : ["active", "处理中"];
    if (candidateReady) stageState.candidates = ["active", "生成中"];
  } else if (status === "awaiting_character_selection") {
    stageState.analysis = ["done", "已完成"];
    stageState.candidates = ["active", "等待人工选择"];
  } else if (status === "validating") {
    stageState.analysis = ["done", "已完成"];
    stageState.candidates = ["done", "已完成"];
    stageState.planning = ["active", "编排与检查中"];
  } else if (status === "awaiting_review") {
    stageState.analysis = ["done", "已完成"];
    stageState.candidates = ["done", "已选定"];
    stageState.planning = ["active", "等待人工复核"];
  } else if (["running", "finalizing"].includes(status)) {
    stageState.analysis = ["done", "已完成"];
    stageState.candidates = ["done", "已选定"];
    stageState.planning = ["done", "已确认"];
    stageState.generation = ["active", status === "finalizing" ? "拼接并上传云管家" : "生成与回传中"];
  } else if (["success", "partial"].includes(status)) {
    stageState.analysis = ["done", "已完成"];
    stageState.candidates = ["done", "已选定"];
    stageState.planning = ["done", "已确认"];
    stageState.generation = [status === "success" ? "done" : "active", status === "success" ? "已完成" : "部分完成"];
  } else if (status === "interrupted") {
    stageState.analysis = analysisReady ? ["done", "已完成"] : ["failed", "已中断"];
    stageState.candidates = candidateReady ? ["done", "已生成"] : analysisReady ? ["failed", "已中断"] : ["pending", "未开始"];
    stageState.planning = job.tasks?.length ? ["done", "已编排"] : ["pending", "未开始"];
    stageState.generation = ["pending", "未开始"];
  } else if (status === "failed") {
    stageState.analysis = analysisReady ? ["done", "已完成"] : ["failed", "处理失败"];
    stageState.candidates = candidateReady ? ["done", "已生成"] : ["failed", "处理失败"];
    stageState.planning = job.tasks?.length ? ["done", "已编排"] : ["failed", "未完成"];
    stageState.generation = job.tasks?.length ? ["failed", "需要处理"] : ["pending", "未开始"];
  }
  autoSteps.forEach((item) => {
    const [className, label] = stageState[item.dataset.autoStage] || ["pending", "等待"];
    item.classList.remove("pending", "active", "done", "failed");
    item.classList.add(className);
    const statusNode = item.querySelector("em");
    if (statusNode) statusNode.textContent = label;
  });
  const analysisStep = autoSteps.find((item) => item.dataset.autoStage === "analysis");
  if (analysisStep) {
    analysisStep.querySelector("b").textContent = job.config?.skipReferenceAnalysis ? "跳过原片分析" : "转写并深度拆解原片";
    analysisStep.querySelector("small").textContent = job.config?.skipReferenceAnalysis ? "按所选脚本或任务要求直接制作" : "口播、镜头、动作、节奏与产品露出";
    if (job.config?.skipReferenceAnalysis) {
      analysisStep.classList.remove("active", "failed");
      analysisStep.classList.add("done");
      analysisStep.querySelector("em").textContent = "已跳过";
    }
  }
  const candidateStep = autoSteps.find((item) => item.dataset.autoStage === "candidates");
  if (candidateStep) candidateStep.querySelector("small").textContent = job.config?.skipReferenceAnalysis ? "按脚本生成三套人物场景方案" : "固定 50% / 60% / 70% 三档";
}

function hydrateFormFromJob(job) {
  if (!job?.id || state.hydratedJobId === job.id) return;
  const config = job.config || {};
  form.reset();
  state.selectedScript = config.selectedScript || null;
  renderScriptLibrary();
  const values = {
    chatFormat: config.chatFormat,
    candidateMode: config.candidateMode,
    productId: config.productId,
    analysisMode: config.analysisMode === "script" ? "ai" : config.analysisMode,
    cameraMode: config.cameraMode,
    manualDeepDive: config.manualDeepDive,
    useOriginalVoiceReference: config.declineAudioReference !== true,
    useMotionReference: config.useMotionReference,
    videoResolution: config.videoResolution || "720p",
    referenceTranscript: config.referenceTranscript,
    productBehavior: config.productBehavior,
    appearanceConstraints: config.appearanceConstraints,
    priceCta: config.priceCta,
    voiceoverScript: config.voiceoverScriptInput ?? config.voiceoverScript,
    originalExposureCount: config.originalExposureCount,
    productExposureClips: Array.isArray(config.productExposureClips) ? config.productExposureClips.join(",") : config.productExposureClips,
    interactionMode: config.interactionMode,
    interactionClips: Array.isArray(config.interactionClips) ? config.interactionClips.join(",") : config.interactionClips,
    interactionGeometry: config.interactionGeometry,
    specialRequest: config.specialRequest
  };
  Object.entries(values).forEach(([name, value]) => {
    const field = form.elements[name];
    if (!field || value === undefined || value === null) return;
    if (field.type === "checkbox") field.checked = value === true;
    else field.value = String(value);
  });
  state.uploads = {
    reference: config.referenceVideoPath ? {
      path: config.referenceVideoPath,
      name: config.referenceVideoName || fileNameFromPath(config.referenceVideoPath),
      duration: Number(config.sourceDuration || 0)
    } : null,
    character: config.selectedCharacterPath ? {
      path: config.selectedCharacterPath,
      name: config.selectedCharacterName || fileNameFromPath(config.selectedCharacterPath)
    } : null,
    products: (Array.isArray(config.productAssetPaths) ? config.productAssetPaths : []).map((filePath, index) => ({
      path: filePath,
      name: config.productAssetNames?.[index] || fileNameFromPath(filePath),
      source: "restored"
    }))
  };
  state.sourceTranscript = config.referenceTranscriptAudit && typeof config.referenceTranscriptAudit === "object"
    ? config.referenceTranscriptAudit
    : (job.sourceTranscript && typeof job.sourceTranscript === "object" ? job.sourceTranscript : null);
  state.sourceTranscriptStatus = state.sourceTranscript?.text ? "success" : "idle";
  state.hydratedJobId = job.id;
  manualAnalysisField.hidden = analysisModeSelect.value !== "manual";
  updateGenerationSettingsSummary();
  renderUploads();
  renderTranscriptMeta();
  renderProductLibrary();
  const snapshot = localDraftSnapshot();
  snapshot.taskId = job.id;
  snapshot.taskName = String(job.taskName || config.workbenchTaskName || "").trim();
  localStorage.setItem(KOC_DRAFT_KEY, JSON.stringify(snapshot));
}

function updateGenerationSettingsSummary() {
  const resolution = String(videoResolutionSelect?.value || "720p").toUpperCase();
  if (generationSettingsSummary) generationSettingsSummary.textContent = `Seedance 2.0 VIP · 全能参考 · ${resolution} · 9:16`;
}

function renderFiles(job) {
  const files = job.files || {};
  const rows = [
    ["原片深度拆解", files.deepDivePath],
    ["资产审计", files.auditPath],
    ["分镜计划JSON", files.clipPlanPath],
    ["KOC视频提示词", files.promptPath]
  ].filter(([, filePath]) => filePath);
  filesBox.innerHTML = rows.length ? `
    <h3>审核文件</h3>
    <div class="file-chip-grid">${rows.map(([label, filePath]) => `<a href="./api/file?path=${encodeURIComponent(filePath)}" target="_blank">${escapeHtml(label)}<span>打开查看</span></a>`).join("")}</div>
    ${job.actionRequired ? `<p class="action-required">${escapeHtml(job.actionRequired)}</p>` : ""}
  ` : "";
}

function renderTasks(job) {
  const tasks = job.tasks || [];
  const busy = ["queued", "preparing", "validating", "running", "finalizing"].includes(job.status);
  taskList.innerHTML = tasks.map((task) => {
    const sourceMapping = Array.isArray(task.sourceShotIndexes) && task.sourceShotIndexes.length
      ? `映射原片镜头 ${task.sourceShotIndexes.join("、")}`
      : "按原片深拆逻辑重排";
    return `
      <article class="task-row ${escapeHtml(task.status)}">
        <div><b>分镜${String(task.index).padStart(2, "0")}</b><span>${task.duration || "-"}秒 · ${task.productVisible ? "出现产品" : "不出现产品"} · ${escapeHtml(task.interactionMode || "")}</span></div>
        <strong>${escapeHtml(statusLabel(task.status))}</strong>
        <p><b>${escapeHtml(task.storyboardFunction || "语义分镜")}</b> · ${escapeHtml(sourceMapping)}</p>
        <p>口播：${escapeHtml(task.voiceover || "")}</p>
        ${task.error ? `<p>${escapeHtml(task.error)}</p>` : ""}
        ${task.status === "failed" ? `<button class="small-action warning-action task-retry-button" type="button" data-retry-koc-task="${task.index}">重新生成本条</button>` : ""}
        <button class="small-action warning-action" type="button" data-delete-koc-clip="${task.index}" ${busy ? "disabled" : ""}>删除分镜</button>
      </article>
    `;
  }).join("");
  taskList.querySelectorAll("[data-retry-koc-task]").forEach((button) => {
    button.addEventListener("click", () => retryKocTasks(`./api/koc/jobs/${state.currentJobId}/tasks/${button.dataset.retryKocTask}/retry`, button));
  });
  retryAllButton.hidden = !tasks.some((task) => task.status === "failed");
  taskList.querySelectorAll("[data-delete-koc-clip]").forEach(button => button.addEventListener("click", () => editKocClip(button.dataset.deleteKocClip, false, button)));
  removedClips.hidden = !(job.removedKocTasks || []).length;
  removedClipList.innerHTML = (job.removedKocTasks || []).map(row => `<div class="koc-removed-clip"><span>分镜${String(row.task.index).padStart(2, "0")} · ${row.task.duration}秒</span><button class="small-action" type="button" data-restore-koc-clip="${row.task.index}" ${busy ? "disabled" : ""}>恢复分镜</button></div>`).join("");
  removedClipList.querySelectorAll("[data-restore-koc-clip]").forEach(button => button.addEventListener("click", () => editKocClip(button.dataset.restoreKocClip, true, button)));
}

async function editKocClip(index, restore, button) {
  button.disabled = true;
  try {
    if (!restore && state.currentJobStatus === "awaiting_review") await saveKocReviewPlan({ silent: true });
    const result = await api(`./api/koc/jobs/${state.currentJobId}/tasks/${index}${restore ? "/restore" : ""}`, { method: restore ? "POST" : "DELETE", ...(restore ? { body: "{}" } : {}) });
    renderJob(result.job);
    if (result.job.status === "finalizing") schedulePoll();
  } catch (error) { alert(error.message); button.disabled = false; }
}

function renderKocReviewEditor(job) {
  const revision = Number(job.reviewRevision || 0);
  state.reviewRevision = revision;
  reviewRevision.textContent = `审核版本 ${revision}`;
  deepDivePreview.textContent = String(job.deepDive || "暂无深度拆解内容");
  const editorKey = `${job.id}:${revision}`;
  if (state.reviewEditorKey === editorKey) return;
  state.reviewEditorKey = editorKey;
  reviewSaveStatus.textContent = "";
  durationEditor.innerHTML = (job.tasks || []).map(task => `<div class="koc-duration-card"><span><b>分镜${String(task.index).padStart(2, "0")}</b><small>口播${timingCharCount(task.voiceover)}字</small></span><select data-duration-clip="${task.index}" aria-label="分镜${task.index}时长">${Array.from({ length: 12 }, (_, i) => i + 4).map(seconds => `<option value="${seconds}" ${Number(task.duration) === seconds ? "selected" : ""}>${seconds}秒</option>`).join("")}</select><button class="small-action warning-action" type="button" data-delete-koc-clip="${task.index}">删除分镜</button></div>`).join("");
  durationEditor.querySelectorAll("[data-delete-koc-clip]").forEach(button => button.addEventListener("click", () => editKocClip(button.dataset.deleteKocClip, false, button)));
  updateKocDurationTotal();
  storyboardEditor.innerHTML = (job.tasks || []).map((task) => `
    <article class="koc-storyboard-edit-card" data-review-clip="${task.index}">
      <header><b>分镜${String(task.index).padStart(2, "0")}</b><span>${Number(task.duration || 0)}秒 · 口播逐字保留</span></header>
      <label><span>分镜功能与画面安排</span><textarea rows="3" data-review-function>${escapeHtml(task.storyboardFunction || "")}</textarea></label>
      <label class="check-line"><input type="checkbox" data-review-product ${task.productVisible ? "checked" : ""} /><span>本分镜露出目标产品，并连接产品资产图</span></label>
      <details>
        <summary>查看锁定口播与最终提示词</summary>
        <label><span>锁定口播（只读）</span><textarea rows="3" readonly>${escapeHtml(task.voiceover || "")}</textarea></label>
        <label><span>最终 LibTV 提示词</span><textarea rows="12" data-review-prompt>${escapeHtml(task.final_libtv_prompt || task.finalLibtvPrompt || "")}</textarea></label>
      </details>
    </article>
  `).join("");
}

function collectKocReviewPlan() {
  return Array.from(storyboardEditor.querySelectorAll("[data-review-clip]")).map((card) => ({
    index: Number(card.dataset.reviewClip),
    duration: Number(durationEditor.querySelector(`[data-duration-clip="${card.dataset.reviewClip}"]`).value),
    storyboardFunction: card.querySelector("[data-review-function]").value,
    productVisible: card.querySelector("[data-review-product]").checked,
    finalLibtvPrompt: card.querySelector("[data-review-prompt]").value
  }));
}

function updateKocDurationTotal() {
  const total = [...durationEditor.querySelectorAll("[data-duration-clip]")].reduce((sum, field) => sum + Number(field.value || 0), 0);
  durationTotal.textContent = `合计${total}秒`;
}

async function saveKocReviewPlan(options = {}) {
  if (!state.currentJobId) throw new Error("当前没有可保存的KOC任务");
  saveReviewPlanButton.disabled = true;
  reviewSaveStatus.textContent = "正在保存并重新检查…";
  try {
    const result = await api(`./api/koc/jobs/${state.currentJobId}/review-plan`, {
      method: "PATCH",
      body: JSON.stringify({ reviewRevision: state.reviewRevision, clips: collectKocReviewPlan() })
    });
    renderJob(result.job);
    reviewSaveStatus.textContent = `第${result.reviewRevision}版分镜已保存，并已重新执行本地检查。`;
    return result.job;
  } catch (error) {
    reviewSaveStatus.textContent = error.message;
    if (!options.silent) alert(error.message);
    throw error;
  } finally {
    saveReviewPlanButton.disabled = false;
  }
}

function renderComplianceAudit(job) {
  const audit = job.complianceAudit || {};
  const items = Array.isArray(audit.items) ? audit.items : [];
  const labels = {
    passed: "已通过",
    warning: "提醒",
    failed: "待处理"
  };
  auditBadge.className = `audit-badge ${escapeHtml(audit.status || "checking")}`;
  auditBadge.textContent = audit.status === "passed"
    ? "自动检查通过"
    : audit.status === "warning"
      ? "检查完成，有提醒"
      : audit.status === "failed"
        ? `${audit.blockingCount || 0}项待处理`
        : "检查中";
  auditList.innerHTML = items.length ? items.map((item) => `
    <div class="audit-item ${escapeHtml(item.status)}">
      <span aria-hidden="true">${item.status === "passed" ? "✓" : item.status === "warning" ? "!" : "×"}</span>
      <div><b>${escapeHtml(item.label)}</b><small>${escapeHtml(item.detail || labels[item.status] || "")}</small></div>
      <em>${escapeHtml(labels[item.status] || "")}</em>
    </div>
  `).join("") : '<p class="audit-empty">系统正在检查素材、口播和提示词。</p>';
  const approveButton = document.querySelector("#approveKocButton");
  approveButton.disabled = !(job.tasks || []).length;
  approveButton.textContent = audit.blockingCount ? "重新检查并确认" : "确认提示词并上传LibTV生成";
}

function renderCandidates(job) {
  const candidates = Array.isArray(job.characterCandidates) ? job.characterCandidates : [];
  const candidateStageRetryable = ["awaiting_character_selection", "failed", "interrupted"].includes(job.status)
    && Boolean(job.deepDive || job.checkpoints?.deepDiveReady)
    && !job.checkpoints?.characterSceneReady;
  candidateGate.hidden = !candidateStageRetryable;
  if (candidateGate.hidden) return;
  regenerateCandidatesButton.textContent = job.status === "interrupted" ? "继续生成候选图" : "重新生成候选图";
  candidateGrid.innerHTML = candidates.length ? candidates.map((candidate) => `
    <article class="candidate-card ${escapeHtml(candidate.status || "")}">
      <div class="candidate-image">
        ${candidate.path
          ? `<img src="./api/image?path=${encodeURIComponent(candidate.path)}" alt="${escapeHtml(candidate.label || "人物场景候选图")}" />`
          : '<span class="candidate-placeholder">生成中</span>'}
      </div>
      <div>
        <b>${escapeHtml(candidate.label || `候选${candidate.index}`)}</b>
        <span>${candidate.status === "success" ? "可选择" : candidate.status === "failed" ? escapeHtml(candidate.error || "生成失败") : "正在生成"}</span>
        ${candidate.imageModelLabel ? `<span>生图模型：${escapeHtml(candidate.imageModelLabel)}${candidate.fallbackActivated ? "（已自动降级）" : ""}</span>` : ""}
      </div>
      <button class="small-action" type="button" data-select-candidate="${escapeHtml(candidate.id)}" ${candidate.status !== "success" ? "disabled" : ""}>选择这张</button>
    </article>
  `).join("") : `<p class="candidate-empty">${escapeHtml(job.candidateError || "当前没有可用候选图，可重新生成或使用人工上传图。")}</p>`;
  candidateGrid.querySelectorAll("[data-select-candidate]").forEach((button) => {
    button.addEventListener("click", () => selectCharacter({ candidateId: button.dataset.selectCandidate }, button));
  });
  useManualCharacterButton.disabled = !state.uploads.character;
}

function renderResults(job) {
  const tasks = job.tasks || [];
  const results = tasks.filter(task => task.localPath);
  const complete = tasks.length > 0 && tasks.every(task => task.status === "success" && task.localPath);
  const finalPath = complete ? job.finalVideoPath || job.previewPath : "";
  const delivery = job.finalDelivery || {};
  const status = ({ merging: "正在按分镜顺序拼接完整视频…", uploading: "完整视频已生成，正在上传WIS云管家的视频素材…", completed: "已上传WIS云管家 → 视频素材 → AI KOC", failed: `云管家回传未完成：${delivery.error || "请重试"}` })[delivery.status];
  finalDeliveryStatus.textContent = status || (finalPath ? "完整成片已生成，可继续上传到WIS云管家。" : results.length ? "分镜生成完成后，将自动拼接并上传完整视频。" : "等待生成完整成片。");
  const busy = ["queued", "preparing", "validating", "running", "finalizing"].includes(job.status);
  retryFinalDeliveryButton.hidden = !complete || busy || delivery.status === "completed";
  retryFinalDeliveryButton.textContent = finalPath ? "上传完整视频到云管家" : "继续拼接并上传";
  segmentResults.hidden = !results.length;
  const renderKey = JSON.stringify({ id: job.id, finalPath, clips: results.map(task => [task.index, task.localPath]) });
  if (state.resultRenderKey !== renderKey) {
    state.resultRenderKey = renderKey;
    resultGrid.innerHTML = finalPath ? `<article class="result-card koc-final-card"><video src="./api/file?path=${encodeURIComponent(finalPath)}" controls preload="metadata"></video><div class="koc-final-info"><b>完整视频</b><p>${tasks.length}个分镜 · 合计${Number(job.finalVideoDuration || job.clipPlan?.totalDuration || 0).toFixed(0)}秒</p><a class="small-action" href="./api/file?path=${encodeURIComponent(finalPath)}" download>下载完整视频</a><a class="small-action" href="../cloud-manager/" target="_blank" rel="noopener">打开WIS云管家</a></div></article>` : "";
    segmentResultGrid.innerHTML = results.map((task) => `
    <article class="result-card">
      <video src="./api/file?path=${encodeURIComponent(task.localPath)}" controls preload="metadata"></video>
      <div><b>${escapeHtml(task.coreElement || `分镜${task.index}`)}</b><span>${escapeHtml(task.model || "Seedance 2.0 VIP")}</span></div>
    </article>
  `).join("");
  }
  resultBadge.textContent = finalPath ? delivery.status === "completed" ? "完整成片已归档" : "完整成片已生成" : statusLabel(job.status);
}

function renderKocCanvasLink(job = {}) {
  const canvasUrl = String(job.canvasUrl || "").trim();
  const canvasName = String(job.canvasName || "").trim();
  const title = canvasLink.querySelector("b");
  const detail = canvasLink.querySelector("small");
  const icon = canvasLink.querySelector("i");
  if (canvasUrl) {
    canvasLink.href = canvasUrl;
    canvasLink.title = canvasUrl;
    canvasLink.classList.remove("pending", "failed");
    canvasLink.setAttribute("aria-disabled", "false");
    title.textContent = "打开 LibTV 视频画布";
    detail.textContent = canvasName || canvasUrl;
    icon.textContent = "↗";
    return;
  }
  canvasLink.removeAttribute("href");
  canvasLink.removeAttribute("title");
  canvasLink.classList.add("pending");
  canvasLink.classList.remove("failed");
  canvasLink.setAttribute("aria-disabled", "true");
  title.textContent = "LibTV 视频画布准备中";
  detail.textContent = "首次提交生成时，系统会按当前账号、本机和 AI-KOC 任务自动创建并复用画布";
  icon.textContent = "•••";
}

function renderJob(job) {
  state.currentJobId = job.id;
  state.currentJobStatus = String(job.status || "");
  localStorage.setItem("product-shot-koc-job", job.id);
  hydrateFormFromJob(job);
  jobIdLine.textContent = job.id;
  jobMessage.textContent = job.error || job.actionRequired || statusLabel(job.status);
  const summary = job.summary || { success: 0, failed: 0, total: 0 };
  const done = Number(summary.success || 0) + Number(summary.failed || 0);
  progressText.textContent = `${done} / ${summary.total || 0}`;
  const candidateSuccess = (job.characterCandidates || []).filter((item) => item.status === "success").length;
  const candidateTotal = (job.characterCandidates || []).length;
  const preparatoryPercent = job.status === "preparing"
    ? Math.min(70, 35 + (candidateTotal ? Math.round(candidateSuccess / candidateTotal * 35) : 0))
    : job.status === "validating" ? 76
    : job.status === "awaiting_character_selection" ? 72
      : job.status === "awaiting_review" ? 80 : 0;
  progressBar.style.width = `${summary.total ? Math.round((done / summary.total) * 100) : preparatoryPercent}%`;
  renderAutomationStages(job);
  const resumeStage = job.status === "interrupted" && !job.checkpoints?.characterSceneReady && !(job.tasks || []).length
    ? (job.checkpoints?.deepDiveReady ? "candidates" : "preparation")
    : "";
  resumeGate.hidden = !resumeStage;
  if (resumeStage) {
    resumeInterruptedButton.textContent = resumeStage === "candidates" ? "继续生成人物候选图" : "继续分析原片";
    resumeHint.textContent = resumeStage === "candidates"
      ? "深度拆解已保留，将从人物候选图阶段继续，不会新建重复任务。"
      : "沿用当前任务ID、填写资料和资产目录，从中断处重新执行原片深拆。";
  }
  formBadge.textContent = statusLabel(job.status);
  prepareButton.disabled = ["queued", "preparing", "validating", "running", "finalizing"].includes(job.status);
  generateButton.disabled = prepareButton.disabled;
  openOutputButton.disabled = !job.outputDir;
  renderKocCanvasLink(job);
  renderFiles(job);
  renderCandidates(job);
  renderTasks(job);
  renderResults(job);
  reviewGate.hidden = job.status !== "awaiting_review";
  if (!reviewGate.hidden) renderKocReviewEditor(job);
  else state.reviewEditorKey = "";
  renderComplianceAudit(job);
  logBox.textContent = (job.logs || []).map((row) => `[${new Date(row.at).toLocaleTimeString()}] ${row.message}`).join("\n");
  logBox.scrollTop = logBox.scrollHeight;
}

function schedulePoll() {
  clearTimeout(state.pollTimer);
  state.pollTimer = setTimeout(pollJob, 2500);
}

async function pollJob() {
  if (!state.currentJobId) return;
  try {
    const job = await api(`./api/koc/jobs/${state.currentJobId}`);
    renderJob(job);
    if (["queued", "preparing", "validating", "running", "finalizing"].includes(job.status)) schedulePoll();
  } catch (error) {
    jobMessage.textContent = error.message;
  }
}

async function startKocJob(event) {
  event.preventDefault();
  const direct = event.submitter === generateButton || !state.uploads.reference;
  if (!direct && state.sourceTranscriptStatus === "running") return alert("原片口播仍在自动识别，请稍候再提交");
  prepareButton.disabled = true;
  generateButton.disabled = true;
  formBadge.textContent = "正在创建";
  try {
    if (state.draftCreationPromise) await state.draftCreationPromise;
    clearTimeout(state.draftSyncTimer);
    state.draftSyncPending = null;
    const result = await api("./api/koc/jobs", { method: "POST", body: JSON.stringify({ ...payloadFromForm(), skipReferenceAnalysis: direct }) });
    state.currentJobId = result.id;
    state.currentJobStatus = "queued";
    const url = new URL(window.location.href);
    url.searchParams.delete("new");
    url.searchParams.set("task", result.id);
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
    window.WorkbenchKnowledge.record("generation_started", result.id, { mode: "koc" });
    localStorage.setItem("product-shot-koc-job", result.id);
    localStorage.setItem(KOC_DRAFT_KEY, JSON.stringify(localDraftSnapshot()));
    await pollJob();
  } catch (error) {
    alert(error.message);
    formBadge.textContent = "创建失败";
    prepareButton.disabled = false;
    generateButton.disabled = false;
  }
}

async function selectCharacter(body, button) {
  if (!state.currentJobId) return;
  button.disabled = true;
  try {
    await api(`./api/koc/jobs/${state.currentJobId}/select-character`, {
      method: "POST",
      body: JSON.stringify(body)
    });
    await pollJob();
  } catch (error) {
    alert(error.message);
    button.disabled = false;
  }
}

async function regenerateCandidates() {
  if (!state.currentJobId) return;
  regenerateCandidatesButton.disabled = true;
  try {
    await api(`./api/koc/jobs/${state.currentJobId}/regenerate-candidates`, { method: "POST", body: "{}" });
    await pollJob();
  } catch (error) {
    alert(error.message);
  } finally {
    regenerateCandidatesButton.disabled = false;
  }
}

async function resumeInterruptedKocJob() {
  if (!state.currentJobId) return;
  resumeInterruptedButton.disabled = true;
  try {
    await api(`./api/koc/jobs/${state.currentJobId}/resume`, { method: "POST", body: "{}" });
    await pollJob();
  } catch (error) {
    alert(error.message);
  } finally {
    resumeInterruptedButton.disabled = false;
  }
}

async function approveKocJob() {
  if (!state.currentJobId) return;
  const button = document.querySelector("#approveKocButton");
  button.disabled = true;
  try {
    const reviewedJob = await saveKocReviewPlan({ silent: true });
    await api(`./api/koc/jobs/${state.currentJobId}/approve`, {
      method: "POST",
      body: JSON.stringify({ finalApproved: true, reviewRevision: Number(reviewedJob.reviewRevision || 0) })
    });
    reviewGate.hidden = true;
    await pollJob();
  } catch (error) {
    alert(error.message);
    button.disabled = false;
  }
}

async function retryKocTasks(endpoint, button) {
  if (!state.currentJobId) return;
  button.disabled = true;
  try {
    await api(endpoint, { method: "POST", body: "{}" });
    await pollJob();
  } catch (error) {
    alert(error.message);
    button.disabled = false;
  }
}

async function restoreRecent() {
  try {
    const jobs = await api("./api/koc/jobs?limit=1");
    if (!jobs.length) return alert("还没有KOC任务记录");
    state.currentJobId = jobs[0].id;
    await pollJob();
  } catch (error) {
    alert(error.message);
  }
}

async function boot() {
  const defaults = await api("./api/koc/defaults");
  state.defaults = defaults;
  productSelect.innerHTML = '<option value="">不选择产品（可选）</option>' + defaults.products.map((product) => `<option value="${escapeHtml(product.id)}">${escapeHtml(product.name)}</option>`).join("");
  productSelect.value = "";
  bindDropZone("#referenceDropZone", "#referenceInput", "koc-reference", "reference");
  bindDropZone("#characterDropZone", "#characterInput", "koc-character", "character");
  bindDropZone("#productDropZone", "#productAssetInput", "koc-product", "products");
  const restoredLocalDraft = kocEntryParams.has("new") ? false : restoreDraft();
  if (kocEntryParams.get("preset") === "desk-shot" && kocEntryParams.has("new")) {
    document.querySelector(".koc-topbar h1").textContent = "KOC 15秒桌拍视频";
    document.querySelector(".page-nav span").textContent = "KOC 15秒桌拍视频";
    form.elements.cameraMode.value = "fixed";
    form.elements.useMotionReference.checked = true;
    form.elements.productBehavior.value = "桌面近景自然拿取、展示与使用，产品露出清楚但不过度摆拍";
    form.elements.specialRequest.value = "目标为约15秒真实桌拍KOC质感；优先保留原片前三秒钩子、桌面空间关系和自然手部动作，不要直播间或棚拍广告感。";
    formBadge.textContent = "已载入15秒桌拍预设";
  }
  updateGenerationSettingsSummary();
  renderUploads();
  renderTranscriptMeta();
  renderKocCanvasLink();
  await Promise.allSettled([loadProductLibrary(), loadScriptLibrary()]);
  await refreshHealth();
  if (state.currentJobId) await pollJob();
  else if (restoredLocalDraft) {
    await ensurePersistentDraft();
    queueKocDraftSync();
  }
}

analysisModeSelect.addEventListener("change", () => {
  manualAnalysisField.hidden = analysisModeSelect.value !== "manual";
  scheduleSaveDraft();
});
useOriginalVoiceReference.addEventListener("change", () => {
  renderUploads();
  scheduleSaveDraft();
});
generationSettingsToggle.addEventListener("click", () => {
  const expanded = generationSettingsToggle.getAttribute("aria-expanded") === "true";
  generationSettingsToggle.setAttribute("aria-expanded", String(!expanded));
  generationSettingsPanel.hidden = expanded;
  generationSettingsToggle.querySelector("i").textContent = expanded ? "展开" : "收起";
});
videoResolutionSelect.addEventListener("change", () => {
  updateGenerationSettingsSummary();
  scheduleSaveDraft();
});
guideToggleButton.addEventListener("click", () => {
  const collapsed = guidePanel.classList.toggle("collapsed");
  guidePanel.closest(".koc-workspace")?.classList.toggle("rules-collapsed", collapsed);
  guideToggleButton.setAttribute("aria-expanded", String(!collapsed));
  guideToggleButton.textContent = collapsed ? "展开" : "隐藏";
});
reviewDetailsToggle.addEventListener("click", () => {
  const expanded = reviewDetailsToggle.getAttribute("aria-expanded") === "true";
  reviewDetailsToggle.setAttribute("aria-expanded", String(!expanded));
  reviewDetails.hidden = expanded;
  reviewDetailsToggle.textContent = expanded ? "查看并修改任务资料" : "收起任务资料";
});
saveReviewPlanButton.addEventListener("click", () => saveKocReviewPlan().catch(() => {}));
durationEditor.addEventListener("change", updateKocDurationTotal);
retryFinalDeliveryButton.addEventListener("click", async () => {
  retryFinalDeliveryButton.disabled = true;
  try {
    await api(`./api/koc/jobs/${state.currentJobId}/finalize`, { method: "POST", body: "{}" });
    await pollJob();
  } catch (error) { alert(error.message); }
  finally { retryFinalDeliveryButton.disabled = false; }
});
productSelect.addEventListener("change", async () => {
  state.uploads.products = [];
  renderUploads();
  await loadProductLibrary();
  formBadge.textContent = "已切换目标产品";
  saveDraft();
});
form.addEventListener("input", scheduleSaveDraft);
scriptSearch.addEventListener("input", renderScriptLibrary);
scriptSelect.addEventListener("change", () => {
  state.selectedScript = state.scripts.find((item) => item.id === scriptSelect.value) || (state.selectedScript?.id === scriptSelect.value ? state.selectedScript : null);
  const autoText = String(state.sourceTranscript?.text || "").trim();
  if (state.selectedScript && autoText && form.elements.voiceoverScript.value.trim() === autoText) form.elements.voiceoverScript.value = "";
  renderScriptLibrary();
  renderTranscriptMeta();
  saveDraft();
});
refreshScriptsButton.addEventListener("click", loadScriptLibrary);
form.elements.referenceTranscript.addEventListener("input", renderTranscriptMeta);
form.elements.voiceoverScript.addEventListener("input", renderTranscriptMeta);
form.addEventListener("change", scheduleSaveDraft);
refreshProductLibraryButton.addEventListener("click", loadProductLibrary);
form.addEventListener("submit", startKocJob);
document.querySelector("#approveKocButton").addEventListener("click", approveKocJob);
document.querySelector("#refreshKocButton").addEventListener("click", refreshHealth);
document.querySelector("#restoreKocButton").addEventListener("click", restoreRecent);
clearDraftButton.addEventListener("click", clearDraft);
retryTranscriptButton.addEventListener("click", () => transcribeKocReference({ force: true }));
window.addEventListener("module-task-local-draft-delete", (event) => {
  if (event.detail?.module !== "koc.html") return;
  event.preventDefault();
  clearDraft().then(() => window.location.reload());
});
retryAllButton.addEventListener("click", () => retryKocTasks(`./api/koc/jobs/${state.currentJobId}/retry-failed`, retryAllButton));
regenerateCandidatesButton.addEventListener("click", regenerateCandidates);
resumeInterruptedButton.addEventListener("click", resumeInterruptedKocJob);
useManualCharacterButton.addEventListener("click", () => {
  if (!state.uploads.character) return alert("请先在上方上传一张人工人物场景图");
  selectCharacter({
    characterPath: state.uploads.character.path,
    characterName: state.uploads.character.name
  }, useManualCharacterButton);
});
openOutputButton.addEventListener("click", async () => {
  if (!state.currentJobId) return;
  try { await api(`./api/koc/jobs/${state.currentJobId}/open-output`, { method: "POST" }); } catch (error) { alert(error.message); }
});
window.addEventListener("pagehide", () => {
  if (!state.currentJobId || state.currentJobStatus !== "draft") return;
  clearTimeout(state.saveTimer);
  clearTimeout(state.draftSyncTimer);
  const draft = localDraftSnapshot();
  localStorage.setItem(KOC_DRAFT_KEY, JSON.stringify(draft));
  fetch(`./api/koc/jobs/${encodeURIComponent(state.currentJobId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ draftData: payloadFromForm() }),
    keepalive: true
  }).catch(() => {});
});

boot().catch((error) => {
  healthLine.textContent = error.message;
  healthLine.className = "health-error";
});
