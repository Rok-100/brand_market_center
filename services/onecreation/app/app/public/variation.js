const form = document.querySelector("#variationForm");
const productSelect = document.querySelector("#variationProductSelect");
const productNameStyle = document.querySelector("#variationProductNameStyle");
const productNameStyleField = document.querySelector("#variationProductNameStyleField");
const productMentionPolicy = document.querySelector("#variationProductMentionPolicy");
const productMentionPolicyField = document.querySelector("#variationProductMentionPolicyField");
const offerSelect = document.querySelector("#variationOfferSelect");
const targetProductName = document.querySelector("#variationTargetProductName");
const truthNote = document.querySelector("#variationTruthNote");
const assetNote = document.querySelector("#variationAssetNote");
const productDropZone = document.querySelector("#variationProductDropZone");
const productInput = document.querySelector("#variationProductInput");
const productNames = document.querySelector("#variationProductNames");
const planApprovedText = document.querySelector("#variationPlanApprovedText");
const sourcePreview = document.querySelector("#variationSourcePreview");
const stableCountInput = document.querySelector("#variationStableCount");
const balancedCountInput = document.querySelector("#variationBalancedCount");
const boldCountInput = document.querySelector("#variationBoldCount");
const tierCountInputs = [stableCountInput, balancedCountInput, boldCountInput];
const countOutput = document.querySelector("#variationCountOutput");
const allocationNote = document.querySelector("#variationAllocationNote");
const formBadge = document.querySelector("#variationFormBadge");
const formMessage = document.querySelector("#variationFormMessage");
const submitButton = document.querySelector("#variationSubmit");
const estimate = document.querySelector("#variationEstimate");
const reviewPanel = document.querySelector("#variationReviewPanel");
const coreGrid = document.querySelector("#variationCoreGrid");
const commerceLock = document.querySelector("#variationCommerceLock");
const shotList = document.querySelector("#variationShotList");
const cardGrid = document.querySelector("#variationCardGrid");
const approveButton = document.querySelector("#variationApproveButton");
const jobMessage = document.querySelector("#variationJobMessage");
const warningBox = document.querySelector("#variationWarningBox");
const progressText = document.querySelector("#variationProgressText");
const progressBar = document.querySelector("#variationProgressBar");
const resultGrid = document.querySelector("#variationResultGrid");
const resultBadge = document.querySelector("#variationResultBadge");
const logBox = document.querySelector("#variationLogBox");
const jobIdLine = document.querySelector("#variationJobId");
const openOutputButton = document.querySelector("#variationOpenOutput");
const recoverAnalysisButton = document.querySelector("#variationRecoverAnalysis");
const retryUploadButton = document.querySelector("#variationRetryUpload");
const canvasLink = document.querySelector("#variationCanvasLink");
const historyList = document.querySelector("#variationHistoryList");
const historyBadge = document.querySelector("#variationHistoryBadge");
const historyRefreshButton = document.querySelector("#variationHistoryRefresh");
const historyToggle = document.querySelector("#variationHistoryToggle");
const historyToggleLabel = document.querySelector("#variationHistoryToggleLabel");
const historyBody = document.querySelector("#variationHistoryBody");
const historyPagination = document.querySelector("#variationHistoryPagination");
const historyPrev = document.querySelector("#variationHistoryPrev");
const historyNext = document.querySelector("#variationHistoryNext");
const historyPageNumbers = document.querySelector("#variationHistoryPageNumbers");
const historyPageStatus = document.querySelector("#variationHistoryPageStatus");
const newTaskButton = document.querySelector("#variationNewTask");
const tierRuleTitle = document.querySelector("#variationTierRuleTitle");
const tierRuleList = document.querySelector("#variationTierRuleList");
const editLock = document.querySelector("#variationEditLock");
const editLockTitle = document.querySelector("#variationEditLockTitle");
const editLockText = document.querySelector("#variationEditLockText");
const editGeneratedButton = document.querySelector("#variationEditGenerated");
const generationHistory = document.querySelector("#variationGenerationHistory");
const generationHistoryBadge = document.querySelector("#variationGenerationHistoryBadge");
const generationHistoryList = document.querySelector("#variationGenerationHistoryList");
const VARIATION_JOB_STORAGE_KEY = "ai-video-variation-current-job";
const LEGACY_VARIATION_JOB_STORAGE_KEY = "ai-video-variation-job-v180";
const VARIATION_REFERENCE_DRAFT_KEY = "ai-video-variation-reference-draft-v233";
const VARIATION_TASK_DRAFTS_KEY = "ai-video-variation-task-drafts-v21142";
let suppressReferenceDraftPersistence = false;

const state = {
  session: `variation-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  currentJobId: new URLSearchParams(location.search).has("new") ? "" : (new URLSearchParams(location.search).get("task") || localStorage.getItem(VARIATION_JOB_STORAGE_KEY) || localStorage.getItem(LEGACY_VARIATION_JOB_STORAGE_KEY) || ""),
  reference: null,
  sourceDuration: 0,
  productAssets: [],
  characterAssets: [],
  backgroundAssets: [],
  products: [],
  currentJob: null,
  historyJobs: [],
  historyExpanded: true,
  historyPage: 1,
  historyPageSize: 5,
  pollTimer: null,
  renderedReviewId: "",
  hydratedJobId: "",
  restoredDraftJobId: "",
  revisionMode: false
};

function rememberCurrentJob(id) {
  state.currentJobId = id || "";
  if (!id) {
    localStorage.removeItem(VARIATION_JOB_STORAGE_KEY);
    localStorage.removeItem(LEGACY_VARIATION_JOB_STORAGE_KEY);
    return;
  }
  localStorage.setItem(VARIATION_JOB_STORAGE_KEY, id);
  localStorage.setItem(LEGACY_VARIATION_JOB_STORAGE_KEY, id);
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: options.body ? { "Content-Type": "application/json", ...(options.headers || {}) } : options.headers
  });
  const type = response.headers.get("content-type") || "";
  const data = type.includes("json") ? await response.json() : await response.text();
  if (!response.ok) throw new Error(data?.error || data?.message || data || `请求失败 ${response.status}`);
  return data;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
}

function setFormMessage(message, type = "") {
  formMessage.textContent = message || "";
  formMessage.className = `form-message ${type}`.trim();
}

function updateProductName() {
  const product = state.products.find((item) => item.id === productSelect.value);
  const noProduct = productSelect.value === "no-product";
  const selectedOffer = offerSelect.value;
  const spokenName = product?.spokenName || product?.shortName || product?.name || productSelect.selectedOptions[0]?.textContent || "";
  productNameStyleField.hidden = noProduct;
  productNameStyle.disabled = noProduct;
  productMentionPolicyField.hidden = noProduct;
  productMentionPolicy.disabled = noProduct;
  if (!noProduct) {
    const aliases = Array.isArray(product?.spokenAliases) ? product.spokenAliases : [];
    const allowedStyles = ["short", ...aliases.map((alias) => `alias-${alias.id}`), "full"];
    const selectedStyle = allowedStyles.includes(productNameStyle.value) ? productNameStyle.value : "short";
    productNameStyle.innerHTML = [
      `<option value="short">简称（默认）：${escapeHtml(spokenName)}</option>`,
      ...aliases.map((alias) => `<option value="alias-${escapeHtml(alias.id)}">${escapeHtml(alias.label || "其他简称")}：${escapeHtml(alias.value)}</option>`),
      `<option value="full">产品全称：${escapeHtml(product?.name || spokenName)}</option>`
    ].join("");
    productNameStyle.value = selectedStyle;
    const alias = aliases.find((item) => `alias-${item.id}` === selectedStyle);
    targetProductName.value = selectedStyle === "full" ? product?.name || spokenName : alias?.value || spokenName;
  } else {
    targetProductName.value = "不出现产品";
  }
  const productDimension = form.querySelector('input[name="dimensions"][value="product"]');
  if (productDimension) {
    productDimension.checked = noProduct || productDimension.checked;
    productDimension.disabled = noProduct;
  }
  productDropZone.hidden = noProduct;
  productInput.disabled = noProduct;
  assetNote.textContent = noProduct
    ? "无产品模式不会上传或调用任何产品图；母版中的产品镜头将由人物反应、动作结果或环境细节承接。"
    : "勾选“换产品”时，默认直接调用“AI-产品镜生成”使用的产品图库；下面仅用于追加或覆盖参考。";
  planApprovedText.textContent = noProduct
    ? "已逐条检查新口播、无产品约束和分秒镜头"
    : "已逐条检查新口播、目标产品、价格规格和分秒镜头";
  if (noProduct) {
    offerSelect.innerHTML = '<option value="no-price" selected>不出现产品，不口播价格</option>';
    offerSelect.disabled = true;
    truthNote.textContent = "已启用无产品模式：禁止产品、包装、品牌、logo、产品口播、价格规格、功效卖点和购买引导。";
    productNames.textContent = "无需上传";
    return;
  }
  offerSelect.disabled = false;
  productNames.textContent = state.productAssets.length
    ? state.productAssets.map((item) => item.name).join("、")
    : "可不上传";
  const offers = product?.commerce?.offers || [];
  offerSelect.innerHTML = offers.length
    ? [
      '<option value="" selected disabled>请选择本批唯一价格规格</option>',
      ...offers.map((offer) => `<option value="${escapeHtml(offer.id)}">${escapeHtml(offer.label)}</option>`),
      '<option value="no-price">本批不口播价格</option>'
    ].join("")
    : '<option value="no-price" selected>本批不口播价格</option>';
  if ([...offerSelect.options].some((option) => option.value === selectedOffer)) {
    offerSelect.value = selectedOffer;
  }
  truthNote.textContent = offers.length
    ? `已锁定规格：${product.commerce.unitSpec || "以商品资料为准"}。请为本批选择一个主推价格，所有成片统一使用，不允许模型自行改价。`
    : "当前产品没有已审核价格，本批将禁止模型口播价格、数量、赠品或优惠。";
}

function readTaskDrafts() {
  try {
    const value = JSON.parse(localStorage.getItem(VARIATION_TASK_DRAFTS_KEY) || "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

function writeTaskDrafts(drafts) {
  localStorage.setItem(VARIATION_TASK_DRAFTS_KEY, JSON.stringify(drafts));
}

function persistReferenceDraft() {
  if (suppressReferenceDraftPersistence) return;
  if (!state.currentJobId) return;
  if (!state.reference?.path && !state.productAssets.length && !state.characterAssets.length && !state.backgroundAssets.length) return;
  const formValues = {};
  for (const element of form.elements) {
    if (!element.name || element.type === "file") continue;
    if (element.type === "checkbox") {
      formValues[element.name] ||= [];
      if (element.checked) formValues[element.name].push(element.value);
    } else if (element.type !== "radio" || element.checked) {
      formValues[element.name] = element.value;
    }
  }
  const drafts = readTaskDrafts();
  drafts[state.currentJobId] = {
    taskId: state.currentJobId,
    reference: state.reference,
    sourceDuration: Number(state.sourceDuration || 0),
    productAssets: state.productAssets,
    characterAssets: state.characterAssets,
    backgroundAssets: state.backgroundAssets,
    formValues,
    savedAt: new Date().toISOString()
  };
  writeTaskDrafts(drafts);
}

function clearReferenceDraft(taskId = state.currentJobId) {
  const drafts = readTaskDrafts();
  if (taskId) delete drafts[taskId];
  writeTaskDrafts(drafts);
  localStorage.removeItem(VARIATION_REFERENCE_DRAFT_KEY);
}

function restoreReferenceDraft() {
  if (new URLSearchParams(location.search).has("new")) return false;
  const name = document.querySelector("#variationReferenceName");
  const draft = state.currentJobId ? readTaskDrafts()[state.currentJobId] : null;
  if (!draft?.reference?.path || !draft?.reference?.name) return false;
  state.reference = draft.reference;
  state.sourceDuration = Math.max(0, Number(draft.sourceDuration || 0));
  state.productAssets = Array.isArray(draft.productAssets) ? draft.productAssets : [];
  state.characterAssets = Array.isArray(draft.characterAssets) ? draft.characterAssets : [];
  state.backgroundAssets = Array.isArray(draft.backgroundAssets) ? draft.backgroundAssets : [];
  if (draft.formValues?.productId && [...productSelect.options].some((option) => option.value === draft.formValues.productId)) {
    productSelect.value = draft.formValues.productId;
    updateProductName();
  }
  for (const element of form.elements) {
    if (!element.name || !(element.name in (draft.formValues || {}))) continue;
    const value = draft.formValues[element.name];
    if (element.type === "checkbox") element.checked = Array.isArray(value) && value.includes(element.value);
    else if (element.type === "radio") element.checked = element.value === value;
    else if (!element.options || [...element.options].some((option) => option.value === value)) element.value = value;
  }
  updateDimensionDetails();
  const restoredAssets = [
    ["#variationProductNames", state.productAssets],
    ["#variationCharacterNames", state.characterAssets],
    ["#variationBackgroundNames", state.backgroundAssets]
  ];
  for (const [selector, assets] of restoredAssets) {
    const label = document.querySelector(selector);
    if (assets.length) {
      label.textContent = `${assets.map((item) => item.name).join("、")} · 已恢复`;
      label.closest(".mini-upload")?.classList.add("ready");
    }
  }
  name.textContent = `${state.reference.name} · 已恢复`;
  sourcePreview.src = `./api/file?path=${encodeURIComponent(state.reference.path)}`;
  sourcePreview.hidden = false;
  sourcePreview.onloadedmetadata = () => {
    if (!state.sourceDuration && Number.isFinite(sourcePreview.duration)) {
      state.sourceDuration = sourcePreview.duration;
      persistReferenceDraft();
      updateEstimate();
    }
  };
  sourcePreview.onerror = () => {
    state.reference = null;
    state.sourceDuration = 0;
    clearReferenceDraft();
    sourcePreview.hidden = true;
    formBadge.textContent = "待上传";
    setFormMessage("已保存的母版文件不存在，请重新上传。", "error");
  };
  formBadge.textContent = "母版已恢复";
  setFormMessage("已恢复未生成的母版视频草稿，可以继续设置并生成。", "success");
  state.restoredDraftJobId = state.currentJobId;
  updateEstimate();
  return true;
}

function selectedDimensions() {
  return [...form.querySelectorAll('input[name="dimensions"]:checked')].map((input) => input.value);
}

function dimensionDetails() {
  return {
    product: String(form.elements.productPresentation?.value || "auto"),
    background: String(form.elements.backgroundStyle?.value || "auto"),
    copy: String(form.elements.copyStyle?.value || "auto"),
    wardrobe: String(form.elements.wardrobeStyle?.value || "auto"),
    protagonist: String(form.elements.protagonistStyle?.value || "auto"),
    format: String(form.elements.formatStyle?.value || "auto")
  };
}

function updateTierRuleExplanation() {
  const copyEnabled = selectedDimensions().includes("copy");
  tierRuleTitle.textContent = copyEnabled ? "三级文案规则" : "三级画面变化规则";
  tierRuleList.innerHTML = copyEnabled
    ? "<li>稳健：沿用母版原口播</li><li>均衡：只改一处钩子、转折或收口</li><li>大胆：可完整创新，但人物视角与成交顺序不变</li>"
    : "<li>稳健：原口播锁定，轻度改变已选画面</li><li>均衡：原口播锁定，中度改变已选画面</li><li>大胆：原口播锁定，大幅改变已选画面</li>";
}

function updateDimensionDetails() {
  const enabled = new Set(selectedDimensions());
  form.querySelectorAll(".dimension-detail").forEach((field) => {
    const active = enabled.has(field.dataset.dimension);
    field.hidden = !active;
    field.querySelector("select").disabled = !active;
  });
  updateTierRuleExplanation();
}

function variationTierCounts() {
  return window.WorkbenchKnowledge.enrich({
    stable: Math.max(0, Number.parseInt(stableCountInput.value, 10) || 0),
    balanced: Math.max(0, Number.parseInt(balancedCountInput.value, 10) || 0),
    bold: Math.max(0, Number.parseInt(boldCountInput.value, 10) || 0)
  });
}

function variationCount() {
  const counts = variationTierCounts();
  return counts.stable + counts.balanced + counts.bold;
}

function updateEstimate() {
  const count = variationCount();
  const valid = count >= 1 && count <= 10;
  const sourceDuration = state.sourceDuration || 12;
  const targetDuration = Math.max(5, Math.round(sourceDuration + 1));
  const segments = Math.max(1, Math.ceil(targetDuration / 15));
  const compose = segments > 1 ? count : 0;
  countOutput.value = `${count}条`;
  countOutput.textContent = `${count}条`;
  allocationNote.textContent = valid
    ? "三档数量可自由组合，合计1–10条；所有版本都会连接母版并逐镜对位。"
    : count < 1 ? "至少选择1条裂变视频。" : "三档合计不能超过10条。";
  allocationNote.classList.toggle("error", !valid);
  estimate.textContent = state.sourceDuration
    ? `母版约${state.sourceDuration.toFixed(1)}秒，裂变目标约${targetDuration}秒（多约${(targetDuration - state.sourceDuration).toFixed(1)}秒），预计拆成${segments}段；${count}条会全量并发，约调用${count * segments}次分段生成、${compose}次合成和${count}次后台质检。每条合成后立即可播放，质检不会自动重做。`
    : `${count}条将全部并发提交LibTV；每条合成后立即可播放，后台质检不会阻塞预览。`;
}

function setupTierCountInputs() {
  tierCountInputs.forEach((input) => {
    input.addEventListener("input", () => {
      input.value = String(Math.max(0, Math.min(10, Number.parseInt(input.value, 10) || 0)));
      const total = variationCount();
      if (total > 10) input.value = String(Math.max(0, Number(input.value) - (total - 10)));
      updateEstimate();
    });
  });
  updateEstimate();
}

const PROXY_SAFE_UPLOAD_CHUNK_BYTES = 768 * 1024;

async function uploadResponseData(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

async function uploadFileInChunks(kind, file, onProgress) {
  const uploadId = globalThis.crypto?.randomUUID?.() || `chunk-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const totalChunks = Math.ceil(file.size / PROXY_SAFE_UPLOAD_CHUNK_BYTES);
  let data = {};
  for (let index = 0; index < totalChunks; index += 1) {
    const query = new URLSearchParams({
      kind,
      name: file.name,
      session: state.session,
      uploadId,
      index: String(index),
      totalChunks: String(totalChunks),
      totalSize: String(file.size)
    });
    const start = index * PROXY_SAFE_UPLOAD_CHUNK_BYTES;
    const body = file.slice(start, Math.min(file.size, start + PROXY_SAFE_UPLOAD_CHUNK_BYTES));
    const response = await fetch(`./api/upload/chunk?${query}`, { method: "POST", body });
    data = await uploadResponseData(response);
    if (!response.ok) throw new Error(data.error || `分片上传失败 ${response.status}`);
    onProgress?.(Math.round(((index + 1) / totalChunks) * 100));
  }
  return data;
}

async function uploadFile(kind, file, onProgress) {
  const query = new URLSearchParams({ kind, name: file.name, session: state.session });
  const response = await fetch(`./api/upload?${query}`, { method: "POST", body: file });
  if (response.status === 413 && file.size > PROXY_SAFE_UPLOAD_CHUNK_BYTES) {
    return uploadFileInChunks(kind, file, onProgress);
  }
  const data = await uploadResponseData(response);
  if (!response.ok) throw new Error(data.error || `上传失败 ${response.status}`);
  return data;
}

function bindDropState(zone, active) {
  zone.classList.toggle("dragging", active);
}

function bindReferenceUpload() {
  const zone = document.querySelector("#variationReferenceDropZone");
  const input = document.querySelector("#variationReferenceInput");
  const name = document.querySelector("#variationReferenceName");
  const handle = async (file) => {
    if (form.classList.contains("variation-form-locked")) return;
    if (!file) return;
    submitButton.disabled = true;
    formBadge.textContent = "上传中";
    setFormMessage(`正在上传 ${file.name}…`);
    try {
      state.reference = await uploadFile("variation-reference", file, (progress) => {
        setFormMessage(`正在上传 ${file.name}… ${progress}%`);
      });
      name.textContent = `${file.name} · ${(file.size / 1024 / 1024).toFixed(1)}MB`;
      sourcePreview.src = URL.createObjectURL(file);
      sourcePreview.hidden = false;
      await new Promise((resolve) => {
        sourcePreview.onloadedmetadata = () => {
          state.sourceDuration = Number.isFinite(sourcePreview.duration) ? sourcePreview.duration : 0;
          resolve();
        };
        sourcePreview.onerror = resolve;
      });
      persistReferenceDraft();
      formBadge.textContent = "母版已上传";
      setFormMessage("母版已锁定，可以选择裂变数量和变化维度。", "success");
      updateEstimate();
    } catch (error) {
      state.reference = null;
      formBadge.textContent = "上传失败";
      setFormMessage(error.message, "error");
    } finally {
      submitButton.disabled = false;
    }
  };
  input.addEventListener("change", () => handle(input.files[0]));
  ["dragenter", "dragover"].forEach((event) => zone.addEventListener(event, (e) => { e.preventDefault(); bindDropState(zone, true); }));
  ["dragleave", "drop"].forEach((event) => zone.addEventListener(event, (e) => { e.preventDefault(); bindDropState(zone, false); }));
  zone.addEventListener("drop", (event) => handle(event.dataTransfer.files[0]));
}

function bindImageUpload({ zoneId, inputId, labelId, kind, stateKey, limit }) {
  const zone = document.querySelector(zoneId);
  const input = document.querySelector(inputId);
  const label = document.querySelector(labelId);
  const handle = async (fileList) => {
    if (form.classList.contains("variation-form-locked")) return;
    const files = [...fileList].slice(0, limit);
    if (!files.length) return;
    zone.classList.add("uploading");
    label.textContent = `上传中 0/${files.length}`;
    try {
      const uploaded = [];
      for (let index = 0; index < files.length; index += 1) {
        uploaded.push(await uploadFile(kind, files[index]));
        label.textContent = `上传中 ${index + 1}/${files.length}`;
      }
      state[stateKey] = uploaded;
      label.textContent = uploaded.map((item) => item.name).join("、");
      zone.classList.add("ready");
      persistReferenceDraft();
    } catch (error) {
      state[stateKey] = [];
      label.textContent = error.message;
      zone.classList.remove("ready");
    } finally {
      zone.classList.remove("uploading");
    }
  };
  input.addEventListener("change", () => handle(input.files));
  ["dragenter", "dragover"].forEach((event) => zone.addEventListener(event, (e) => { e.preventDefault(); bindDropState(zone, true); }));
  ["dragleave", "drop"].forEach((event) => zone.addEventListener(event, (e) => { e.preventDefault(); bindDropState(zone, false); }));
  zone.addEventListener("drop", (event) => handle(event.dataTransfer.files));
}

function setActiveStage(number) {
  document.querySelectorAll(".variation-stage-strip > div").forEach((stage) => {
    const value = Number(stage.dataset.stage);
    stage.classList.toggle("active", value === number);
    stage.classList.toggle("done", value < number);
  });
}

function statusLabel(status) {
  return ({
    queued: "等待处理",
    preparing: "正在分析母版",
    awaiting_review: "等待人工审核",
    editing: "修改中",
    running: "LibTV生成中",
    node_creating: "正在创建生成节点",
    compliance_queued: "等待提交合规审查",
    compliance_pending: "合规审核中·系统自动继续",
    compliance_deferred: "合规审核待继续",
    downloading: "正在下载成片",
    quality_checking: "自动质检中",
    preview_ready: "成片可播放",
    review_required: "待人工复核",
    success: "全部完成",
    partial: "部分完成",
    failed: "处理失败",
    skipped: "已取消",
    interrupted: "任务已中断"
  })[status] || status || "未知状态";
}

function visibleVariationError(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (/10026|检测提交较频繁|合规.*(?:中|未完成|等待|排队|处理中)|完成合规资产录入/i.test(text)) {
    return "素材已自动提交合规审查，系统会按安全频率继续检查；如暂时未完成，可点击“继续合规审查”，无需重新上传。";
  }
  if (text.length <= 360) return text;
  const useful = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^(?:at\s|node:internal|Require stack:|ffmpeg version)/i.test(line));
  return String(useful.at(-1) || text).slice(0, 360);
}

function renderCore(job) {
  const transcript = job.sourceTranscript || {};
  const overlapLabel = Number(transcript.overlapCount || 0) > 0 ? ` · ${transcript.overlapCount}段重叠讲话需人工核对` : "";
  const channelLabel = transcript.channelStrategy === "split_stereo" ? " · 左右声道分轨" : "";
  const transcriptLabel = transcript.text
    ? `XingChenASR识别${transcript.speakerCount > 1 ? ` · ${transcript.speakerCount}位说话人` : ""}${channelLabel}${overlapLabel}；${["failed", "rejected"].includes(transcript.refinement?.status) ? "DeepSeek校订未通过，已沿用ASR原文" : "DeepSeek 4 Pro已做保真校订"}`
    : "当前未取得独立ASR逐字稿，请重点人工核对";
  const fields = [
    ["archetype", "素材类型"], ["hook", "开头钩子"], ["audience", "目标人群"], ["problem", "核心痛点"],
    ["structure", "成交结构"], ["solution", "解决方案"], ["benefit", "卖点与利益点"], ["cta", "行动引导"],
    ["roles", "人物关系"], ["speakerPerspective", "说话人视角"], ["sceneContext", "人物与场景关系"],
    ["emotionalMechanism", "情绪触发与推进"], ["performanceStyle", "母版声音表演"], ["sourceCopy", "母版原口播"],
    ["surfaceElements", "可替换表层元素"], ["audioStrategy", "声音策略"], ["mustKeep", "必须保留"]
  ];
  coreGrid.innerHTML = fields.map(([key, label]) => `
    <label class="variation-core-field ${key === "structure" || key === "mustKeep" ? "wide" : ""}">
      <span>${label}</span>
      <textarea rows="${key === "structure" || key === "mustKeep" ? 3 : 2}" data-core-key="${key}">${escapeHtml(job.coreLock?.[key] || "")}</textarea>
      ${key === "sourceCopy" ? `<small>${escapeHtml(transcriptLabel)}。ASR逐字稿是文本真值，不会与视频理解结果拼接扩写；仍可直接人工修正。</small><button type="button" class="secondary variation-retranscribe" id="variationRetranscribe">重新识别母版口播</button>` : ""}
    </label>
  `).join("");
  const retranscribeButton = document.querySelector("#variationRetranscribe");
  if (retranscribeButton) retranscribeButton.addEventListener("click", retranscribeSourceCopy);
  const shots = job.coreLock?.shots || [];
  shotList.innerHTML = shots.length ? shots.map((shot) => `
    <article><b>${String(shot.index).padStart(2, "0")}</b><span>${escapeHtml(shot.start)}–${escapeHtml(shot.end)}秒</span><p>${escapeHtml(shot.function)}<small>${escapeHtml(shot.action)}</small></p><em>${shot.productVisible ? "有产品" : "无产品"}</em></article>
  `).join("") : "<p class=\"empty-line\">模型未返回逐镜时间戳，将按视频时长均匀拆段；请重点审核成交结构。</p>";
}

async function retranscribeSourceCopy() {
  if (!state.currentJobId) return;
  const button = document.querySelector("#variationRetranscribe");
  if (button) {
    button.disabled = true;
    button.textContent = "正在重新识别…";
  }
  try {
    await api(`./api/variation/jobs/${state.currentJobId}/retranscribe`, { method: "POST" });
    state.renderedReviewId = "";
    reviewPanel.hidden = true;
    setFormMessage("正在调用 XingChenASR 重新识别，并由 DeepSeek 4 Pro 保真校订；不会生成视频。", "info");
    schedulePoll(300);
  } catch (error) {
    if (button) {
      button.disabled = false;
      button.textContent = "重新识别母版口播";
    }
    alert(error.message);
  }
}

function renderVariationCards(job) {
  const copyLocked = !job.config?.dimensions?.includes("copy");
  cardGrid.innerHTML = (job.tasks || []).map((task) => `
    <article class="variation-task-card ${escapeHtml(task.tier)}" data-variant-id="${escapeHtml(task.id)}">
      <header>
        <label><input type="checkbox" data-role="selected" ${task.selected !== false ? "checked" : ""} /><span>生成本条</span></label>
        <em>${escapeHtml(task.title)}</em>
      </header>
      <div class="variation-task-tags"><span>${escapeHtml(task.templateLabel || "裂变模板")}</span>${(task.dimensionLabels || []).map((label) => `<span>${escapeHtml(label)}</span>`).join("")}</div>
      <div class="variation-copy-policy ${task.script?.reviewRequired ? "needs-review" : ""}">
        <b>${escapeHtml(task.script?.policyLabel || "文案策略")}</b>
        <span>${escapeHtml(task.script?.policy || "")}</span>
        ${task.script?.anchorText ? `<small>与母版商品替换底稿相似度：${Math.round(Number(task.script?.similarityToAnchor || 0) * 100)}%</small>` : ""}
        ${task.script?.draftIssue ? `<em>${escapeHtml(task.script.draftIssue)}</em>` : ""}
      </div>
      <p><b>固定逻辑</b>${escapeHtml(task.preservedLogic)}</p>
      <p><b>新场景/人物</b>${escapeHtml(task.creativeDetails?.scene || "")} · ${escapeHtml(task.creativeDetails?.roles || "")}</p>
      <p><b>细分选择</b>${escapeHtml(task.creativeDetails?.wardrobe || "")} · ${escapeHtml(task.creativeDetails?.format || "")} · ${escapeHtml(task.creativeDetails?.productPresentation || "")}</p>
      <label><span>${copyLocked ? "本条最终口播（未勾选换文案：三档均沿用母版）" : "本条最终口播（稳健沿用原文／均衡小改／大胆创新）"}</span><textarea rows="5" data-role="script" ${copyLocked ? "readonly" : ""} placeholder="${task.script?.silent ? "母版无口播，本条保持无口播" : "请审核完整口播"}">${escapeHtml(task.script?.text || "")}</textarea></label>
      <label><span>人物情绪与声音导演说明</span><textarea rows="4" data-role="performance">${escapeHtml(task.performanceDirection || "")}</textarea></label>
      <details><summary>查看${task.storyboard?.length || 0}个分秒镜头</summary><ol>${(task.storyboard || []).map((shot) => `<li><b>${escapeHtml(shot.start)}–${escapeHtml(shot.end)}秒 ${escapeHtml(shot.function)}</b><br>${escapeHtml(shot.action)}<br><small>说话人：${escapeHtml(shot.speaker || "按母版角色")}｜口播：${escapeHtml(shot.spokenLine || "无口播")}<br>情绪：${escapeHtml(shot.emotion || "沿用母版")}｜声音：${escapeHtml(shot.voiceDirection || "与台词匹配")}</small></li>`).join("")}</ol></details>
      <label><span>变化说明</span><textarea rows="4" data-role="summary">${escapeHtml(task.changeSummary)}</textarea></label>
      <label><span>单条补充要求</span><textarea rows="2" data-role="instruction" placeholder="可不填">${escapeHtml(task.customInstruction || "")}</textarea></label>
      <footer>${task.segments?.length || 1}个生成分段 · 目标约${task.targetDuration || "-"}秒</footer>
    </article>
  `).join("");
}

function renderReview(job) {
  if (state.renderedReviewId === job.id) return;
  state.renderedReviewId = job.id;
  reviewPanel.hidden = false;
  commerceLock.innerHTML = job.config?.noProduct
    ? "<b>无产品模式已锁定</b>全片禁止产品、包装、品牌、logo、商品口播、价格规格、功效卖点和购买引导"
    : `<b>商品真值已锁定</b>${escapeHtml(job.config?.targetProductName || "")} · ${escapeHtml(job.config?.offer?.label || "本批不口播价格")} · ${escapeHtml(job.config?.offer?.unitSpec || "")}`;
  renderCore(job);
  renderVariationCards(job);
  reviewPanel.scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderResults(job) {
  const tasks = job.tasks || [];
  if (!tasks.length) {
    resultGrid.innerHTML = '<p class="empty-line">完成母版分析后，这里会显示1–10条裂变任务。</p>';
    resultBadge.textContent = "等待任务";
    return;
  }
  const successCount = tasks.filter((task) => task.localPath).length;
  const totalCount = job.summary?.total || tasks.filter((task) => task.selected !== false).length || tasks.length;
  resultBadge.textContent = `${successCount}/${totalCount}条可预览`;
  resultGrid.querySelector(".empty-line")?.remove();
  const currentCards = new Map([...resultGrid.querySelectorAll("[data-variant-id]")].map((card) => [card.dataset.variantId, card]));
  tasks.forEach((task) => {
    const segmentDone = (task.segments || []).filter((segment) => segment.status === "success").length;
    const video = task.localPath ? `<video controls preload="metadata" src="./api/file?path=${encodeURIComponent(task.localPath)}"></video>` : "";
    const qualityRetry = task.status === "review_required"
      && Boolean(task.localPath)
      && (task.quality?.status === "unavailable" || /自动质检/.test(task.error || ""));
    const legacyTextQuality = task.quality?.ai
      && Object.prototype.hasOwnProperty.call(task.quality.ai, "unwantedTextAbsent")
      && !Object.prototype.hasOwnProperty.call(task.quality.ai, "spokenSubtitleAbsent");
    const batchBusy = ["queued", "preparing", "running"].includes(job.status);
    const complianceRetry = task.status === "compliance_deferred"
      || (task.segments || []).some((segment) => ["compliance_pending", "compliance_deferred"].includes(segment.status)
        || (segment.status === "failed" && /10026|检测提交较频繁|合规.*(?:中|未完成|等待|排队|处理中)/i.test(segment.error || "")));
    const regenerateButton = ["failed", "review_required"].includes(task.status)
      ? `<button type="button" data-retry="${escapeHtml(task.id)}" ${batchBusy ? 'disabled title="本批其他视频仍在生成，全部结束后即可重生本条"' : ""}>重新生成本条</button>`
      : "";
    const complianceRetryButton = complianceRetry
      ? `<button type="button" data-compliance-retry="${escapeHtml(task.id)}" ${batchBusy ? 'disabled title="本批其他视频仍在生成，全部结束后即可继续本条合规审查"' : ""}>继续合规审查</button>`
      : "";
    const qualityRetryButton = qualityRetry
      ? `<button type="button" data-quality-retry="${escapeHtml(task.id)}" ${batchBusy ? "disabled" : ""}>仅重新质检</button>`
      : "";
    const retryActions = regenerateButton || complianceRetryButton || qualityRetryButton
      ? `<div class="variation-result-actions">${complianceRetryButton}${regenerateButton}${qualityRetryButton}</div>`
      : "";
    const previousOutputs = (task.previousOutputs || []).filter((item) => item.localPath);
    const previousLinks = previousOutputs.length
      ? `<div class="variation-previous-outputs">${previousOutputs.map((item) => `<a href="./api/file?path=${encodeURIComponent(item.localPath)}" target="_blank" rel="noreferrer">查看第${Number(item.attempt || 1)}版</a>`).join("")}</div>`
      : "";
    const signature = JSON.stringify({
      status: task.status,
      localPath: task.localPath || "",
      error: task.error || "",
      segmentDone,
      attemptNo: task.attemptNo || 0,
      targetDuration: task.targetDuration || 0,
      qualityStatus: task.quality?.status || "",
      qualityIssues: task.quality?.issues || [],
      qualityManualChecks: task.quality?.manualChecks || [],
      legacyTextQuality,
      complianceRetry,
      complianceStates: (task.segments || []).map((segment) => [segment.index, segment.status, segment.compliance?.state || ""]),
      previousOutputs: previousOutputs.map((item) => [item.attempt, item.localPath]),
      title: task.title,
      dimensions: task.dimensionLabels || []
    });
    const existing = currentCards.get(task.id);
    if (existing?.dataset.renderSignature === signature) {
      currentCards.delete(task.id);
      return;
    }
    const wrapper = document.createElement("div");
    wrapper.innerHTML = `
      <article class="variation-result-card ${escapeHtml(task.status)}" data-variant-id="${escapeHtml(task.id)}">
        ${video}
        <div>
          <header><b>${escapeHtml(task.title)}</b><span>${escapeHtml(statusLabel(complianceRetry ? "compliance_deferred" : task.status))}</span></header>
          <p>${escapeHtml(task.dimensionLabels?.join("、") || "")}</p>
          <small>分段 ${segmentDone}/${task.segments?.length || 1} · 目标约${task.targetDuration || "-"}秒${task.attemptNo ? ` · 第${task.attemptNo}次` : ""}</small>
          ${task.quality?.status === "passed" ? '<em class="quality-pass">自动画面质检完成</em>' : ""}
          ${task.quality?.issues?.length ? `<em>${escapeHtml(task.quality.issues.join("；"))}</em>` : ""}
          ${legacyTextQuality ? '<em class="quality-manual">这是旧版“禁止额外文字”质检结果；可点击“仅重新质检”，按新版“禁止口播字幕、允许正确画面文字”规则复查。</em>' : ""}
          ${task.quality?.manualChecks?.length ? `<em class="quality-manual">${escapeHtml(task.quality.manualChecks.join("；"))}</em>` : ""}
          ${task.error ? `<em>${escapeHtml(visibleVariationError(task.error))}</em>` : ""}
          ${previousLinks}
          ${retryActions}
        </div>
      </article>`;
    const nextCard = wrapper.firstElementChild;
    nextCard.dataset.renderSignature = signature;
    nextCard.querySelector("[data-retry]")?.addEventListener("click", (event) => retryVariant(event.currentTarget.dataset.retry));
    nextCard.querySelector("[data-compliance-retry]")?.addEventListener("click", (event) => retryVariantCompliance(event.currentTarget.dataset.complianceRetry));
    nextCard.querySelector("[data-quality-retry]")?.addEventListener("click", (event) => retryVariantQuality(event.currentTarget.dataset.qualityRetry));
    if (existing) existing.replaceWith(nextCard);
    else resultGrid.appendChild(nextCard);
    currentCards.delete(task.id);
  });
  currentCards.forEach((card) => card.remove());
}

function formatHistoryTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "时间未记录";
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
}

function syncHistoryDisclosure() {
  historyBody.hidden = !state.historyExpanded;
  historyToggle.setAttribute("aria-expanded", String(state.historyExpanded));
  historyToggleLabel.textContent = state.historyExpanded ? "收起任务列表" : "展开任务列表";
  historyToggle.classList.toggle("expanded", state.historyExpanded);
}

function setHistoryPage(page) {
  const pageCount = Math.max(1, Math.ceil(state.historyJobs.length / state.historyPageSize));
  state.historyPage = Math.min(pageCount, Math.max(1, Number(page) || 1));
  renderHistory();
}

function renderHistoryPagination(pageCount) {
  historyPagination.hidden = state.historyJobs.length <= state.historyPageSize;
  historyPrev.disabled = state.historyPage <= 1;
  historyNext.disabled = state.historyPage >= pageCount;
  historyPageStatus.textContent = `第 ${state.historyPage} / ${pageCount} 页`;
  const candidates = [...new Set([1, state.historyPage - 1, state.historyPage, state.historyPage + 1, pageCount])]
    .filter((page) => page >= 1 && page <= pageCount)
    .sort((a, b) => a - b);
  historyPageNumbers.innerHTML = candidates.map((page) => `
    <button type="button" data-variation-history-page="${page}" ${page === state.historyPage ? 'aria-current="page"' : ""}>${page}</button>
  `).join("");
}

function renderHistory(rows = state.historyJobs) {
  state.historyJobs = Array.isArray(rows) ? rows : [];
  historyBadge.textContent = `${state.historyJobs.length}个任务`;
  syncHistoryDisclosure();
  if (!state.historyJobs.length) {
    historyList.innerHTML = '<p class="empty-line">还没有历史裂变任务。</p>';
    historyPagination.hidden = true;
    return;
  }
  const pageCount = Math.max(1, Math.ceil(state.historyJobs.length / state.historyPageSize));
  state.historyPage = Math.min(pageCount, Math.max(1, state.historyPage));
  const start = (state.historyPage - 1) * state.historyPageSize;
  const visibleJobs = state.historyJobs.slice(start, start + state.historyPageSize);
  historyList.innerHTML = visibleJobs.map((job) => {
    const total = Number(job.summary?.total || job.videoCount || 0);
    const ready = Number(job.readyCount || job.summary?.ready || job.summary?.success || 0);
    const source = job.referenceVideoName || "母版名称未记录";
    const product = job.targetProductName || "目标产品未记录";
    const offer = job.offerLabel ? ` · ${job.offerLabel}` : "";
    const isCurrent = job.id === state.currentJobId;
    return `
      <article class="variation-history-row ${isCurrent ? "current" : ""}">
        <button class="variation-history-open" type="button" data-history-job="${escapeHtml(job.id)}">
          <span><b>${escapeHtml(product)}${escapeHtml(offer)}</b><small>${escapeHtml(source)}</small></span>
          <span><b>${formatHistoryTime(job.createdAt)}</b><small>${ready}/${total || "-"}条可预览${job.reviewRequiredCount ? ` · ${job.reviewRequiredCount}条待复核` : ""}</small></span>
          <em>${isCurrent ? "当前查看" : statusLabel(job.status)}</em>
        </button>
        <button class="variation-history-delete" type="button" data-delete-history-job="${escapeHtml(job.id)}" title="只删除任务记录，已生成视频仍保留">删除记录</button>
      </article>`;
  }).join("");
  renderHistoryPagination(pageCount);
  historyList.querySelectorAll("[data-history-job]").forEach((button) => {
    button.addEventListener("click", () => openHistoryJob(button.dataset.historyJob));
  });
  historyList.querySelectorAll("[data-delete-history-job]").forEach((button) => {
    button.addEventListener("click", () => deleteHistoryJob(button.dataset.deleteHistoryJob, button));
  });
}

async function refreshHistory() {
  historyRefreshButton.disabled = true;
  try {
    const rows = await api("./api/variation/jobs?limit=50");
    state.historyJobs = rows;
    if (!new URLSearchParams(location.search).has("new") && (!state.currentJobId || !rows.some((job) => job.id === state.currentJobId)) && rows[0]) {
      rememberCurrentJob(rows[0].id);
    }
    renderHistory(rows);
    return rows;
  } catch (error) {
    historyBadge.textContent = "读取失败";
    historyList.innerHTML = `<p class="empty-line">${escapeHtml(error.message)}</p>`;
    return [];
  } finally {
    historyRefreshButton.disabled = false;
  }
}

async function deleteHistoryJob(id, button) {
  if (!id) return;
  button.disabled = true;
  button.textContent = "删除中…";
  try {
    const result = await api(`./api/variation/jobs/${encodeURIComponent(id)}`, { method: "DELETE" });
    const deletingCurrent = state.currentJobId === id;
    const rows = await refreshHistory();
    if (deletingCurrent) {
      rememberCurrentJob(rows[0]?.id || "");
      state.currentJob = null;
      state.renderedReviewId = "";
      reviewPanel.hidden = true;
      resultGrid.innerHTML = '<p class="empty-line">请选择一条任务查看，或创建新的裂变任务。</p>';
      jobMessage.textContent = rows[0] ? "已切换到最新任务" : "尚未创建任务";
      if (rows[0]) await pollJob();
    }
    setFormMessage(result.message || "任务记录已删除；成片仍保留在输出文件夹。");
  } catch (error) {
    button.disabled = false;
    button.textContent = "删除记录";
    setFormMessage(error.message, "error");
  }
}

async function openHistoryJob(id) {
  if (!id) return;
  clearTimeout(state.pollTimer);
  rememberCurrentJob(id);
  state.revisionMode = false;
  state.hydratedJobId = "";
  state.restoredDraftJobId = "";
  state.renderedReviewId = "";
  reviewPanel.hidden = true;
  resultGrid.innerHTML = '<p class="empty-line">正在读取历史任务…</p>';
  renderHistory();
  await pollJob();
  document.querySelector("#variationJobPanel")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function variationAssetRows(paths = [], names = [], staged = []) {
  const stagedRows = Array.isArray(staged) ? staged : [];
  const sourcePaths = Array.isArray(paths) && paths.length ? paths : stagedRows.map((item) => item.path);
  const sourceNames = Array.isArray(names) && names.length ? names : stagedRows.map((item) => item.name);
  return sourcePaths.filter(Boolean).map((assetPath, index) => ({
    path: assetPath,
    name: sourceNames[index] || stagedRows[index]?.name || assetPath.split(/[\\/]/).at(-1) || `素材${index + 1}`
  }));
}

function setNamedValue(name, value) {
  const elements = [...form.elements].filter((element) => element.name === name);
  for (const element of elements) {
    if (element.type === "checkbox" || element.type === "radio") element.checked = Array.isArray(value) ? value.includes(element.value) : element.value === value;
    else if (!element.options || [...element.options].some((option) => option.value === String(value ?? ""))) element.value = String(value ?? "");
  }
}

function hydrateFormFromJob(job) {
  if (!job?.id || state.hydratedJobId === job.id) return;
  if (job.status === "draft" && state.restoredDraftJobId === job.id) {
    state.hydratedJobId = job.id;
    return;
  }
  const config = job.config || {};
  if (job.status === "draft" && !config.referenceVideoPath) {
    state.hydratedJobId = job.id;
    formBadge.textContent = "新任务";
    return;
  }
  suppressReferenceDraftPersistence = true;
  state.reference = config.referenceVideoPath ? { path: config.referenceVideoPath, name: config.referenceVideoName || "母版视频" } : null;
  state.sourceDuration = Math.max(0, Number(config.sourceDuration || 0));
  state.productAssets = variationAssetRows(config.productAssetPaths, config.productAssetNames, job.variationAssets?.productAssets);
  state.characterAssets = variationAssetRows(config.characterAssetPaths, config.characterAssetNames, job.variationAssets?.characterAssets);
  state.backgroundAssets = variationAssetRows(config.backgroundAssetPaths, config.backgroundAssetNames, job.variationAssets?.backgroundAssets);
  if ([...productSelect.options].some((option) => option.value === String(config.productId || ""))) productSelect.value = String(config.productId);
  updateProductName();
  setNamedValue("productNameStyle", config.productNameStyle || "short");
  updateProductName();
  setNamedValue("productMentionPolicy", config.productMentionPolicy || "follow-source");
  setNamedValue("offerId", config.offerId || config.offer?.id || "no-price");
  setNamedValue("stableCount", Number(config.tierCounts?.stable ?? 2));
  setNamedValue("balancedCount", Number(config.tierCounts?.balanced ?? 2));
  setNamedValue("boldCount", Number(config.tierCounts?.bold ?? 1));
  setNamedValue("dimensions", Array.isArray(config.dimensions) ? config.dimensions : []);
  setNamedValue("productPresentation", config.dimensionDetails?.product?.value || config.dimensionDetails?.product || "auto");
  setNamedValue("backgroundStyle", config.dimensionDetails?.background?.value || config.dimensionDetails?.background || "auto");
  setNamedValue("copyStyle", config.dimensionDetails?.copy?.value || config.dimensionDetails?.copy || "auto");
  setNamedValue("wardrobeStyle", config.dimensionDetails?.wardrobe?.value || config.dimensionDetails?.wardrobe || "auto");
  setNamedValue("protagonistStyle", config.dimensionDetails?.protagonist?.value || config.dimensionDetails?.protagonist || "auto");
  setNamedValue("formatStyle", config.dimensionDetails?.format?.value || config.dimensionDetails?.format || "auto");
  setNamedValue("mustKeep", config.mustKeep || "");
  setNamedValue("variationRequest", config.variationRequest || "");
  setNamedValue("analysisMode", config.analysisMode || "ai");
  setNamedValue("manualDeepDive", config.manualDeepDive || "");
  const referenceName = document.querySelector("#variationReferenceName");
  if (state.reference) {
    referenceName.textContent = `${state.reference.name} · 当前任务`;
    sourcePreview.src = `./api/file?path=${encodeURIComponent(state.reference.path)}`;
    sourcePreview.hidden = false;
  } else {
    referenceName.textContent = "点击选择或拖入视频";
    sourcePreview.removeAttribute("src");
    sourcePreview.hidden = true;
  }
  for (const [selector, assets, empty] of [
    ["#variationProductNames", state.productAssets, "可不上传"],
    ["#variationCharacterNames", state.characterAssets, "可不上传"],
    ["#variationBackgroundNames", state.backgroundAssets, "可不上传"]
  ]) {
    const label = document.querySelector(selector);
    label.textContent = assets.length ? assets.map((item) => item.name).join("、") : empty;
    label.closest(".mini-upload")?.classList.toggle("ready", assets.length > 0);
  }
  updateDimensionDetails();
  updateProductName();
  updateEstimate();
  formBadge.textContent = job.status === "draft" ? "新任务" : "已载入当前任务";
  state.hydratedJobId = job.id;
  suppressReferenceDraftPersistence = false;
}

function hasGeneratedOutput(job) {
  return (job?.tasks || []).some((task) => Boolean(task.localPath)) || (job?.generationHistory || []).some((generation) => (generation.outputs || []).some((output) => output.localPath));
}

function syncFormLock(job) {
  const generated = hasGeneratedOutput(job);
  const locked = Boolean(job?.id && job.status !== "draft" && !state.revisionMode);
  form.classList.toggle("variation-form-locked", locked);
  form.querySelectorAll("fieldset input, fieldset select, fieldset textarea").forEach((element) => { element.disabled = locked; });
  submitButton.hidden = locked;
  submitButton.disabled = locked;
  editLock.hidden = !locked;
  const generating = ["queued", "preparing", "running", "node_creating", "compliance_queued", "compliance_pending", "downloading", "quality_checking"].includes(job?.status);
  editGeneratedButton.hidden = !(locked && generated && !generating && job.status !== "editing");
  editGeneratedButton.disabled = generating;
  if (!locked) {
    updateProductName();
    formBadge.textContent = state.revisionMode ? "修改中" : (job?.status === "draft" ? "新任务" : formBadge.textContent);
    submitButton.hidden = false;
    submitButton.disabled = false;
    submitButton.textContent = state.revisionMode ? "保存修改并生成新方案" : "分析母版并生成裂变方案";
    editLock.hidden = !state.revisionMode;
    if (state.revisionMode) {
      editLockTitle.textContent = "正在修改当前任务";
      editLockText.textContent = "提交后会进入二次生成；历史成片将继续保留。";
    }
    return;
  }
  editLockTitle.textContent = generated ? "本任务已有生成记录，内容已锁定" : "任务内容已锁定";
  editLockText.textContent = generated
    ? "历史成片不会被覆盖；如需调整，请先确认风险后进入二次生成。"
    : "母版分析、人工审核或视频生成期间，不能修改参考视频、裂变方向和图片资产。";
}

function renderGenerationHistory(job) {
  const generations = Array.isArray(job?.generationHistory) ? job.generationHistory : [];
  const rows = generations.filter((item) => Array.isArray(item.outputs) && item.outputs.some((output) => output.localPath));
  generationHistory.hidden = !rows.length;
  generationHistoryBadge.textContent = rows.length ? `${rows.length}轮历史生成` : "";
  generationHistoryList.innerHTML = rows.map((item) => `
    <article class="variation-generation-history-row">
      <header><b>第${Number(item.generationNo || 1)}轮成片</b><span>${escapeHtml(formatHistoryTime(item.archivedAt || item.completedAt || item.createdAt))}</span></header>
      <div>${item.outputs.filter((output) => output.localPath).map((output) => `
        <section>
          <video controls preload="metadata" src="./api/file?path=${encodeURIComponent(output.localPath)}"></video>
          <div><b>${escapeHtml(output.title || `裂变${output.index || ""}`)}</b><a href="./api/file?path=${encodeURIComponent(output.localPath)}" download>下载历史成片</a></div>
        </section>`).join("")}</div>
    </article>`).join("");
}

function renderLogs(job) {
  jobIdLine.textContent = job.id;
  const logs = job.logs || [];
  logBox.textContent = logs.map((row) => {
    const time = new Date(row.at).toLocaleTimeString("zh-CN", { hour12: false });
    return `[${time}] ${row.message}`;
  }).join("\n") || "暂无日志";
  logBox.scrollTop = logBox.scrollHeight;
}

function renderJob(job) {
  state.currentJob = job;
  if (job.status === "editing") state.revisionMode = true;
  hydrateFormFromJob(job);
  syncFormLock(job);
  const tasks = job.tasks || [];
  const completed = tasks.filter((task) => ["success", "review_required", "compliance_deferred", "failed", "skipped"].includes(task.status)).length;
  const total = job.summary?.total || tasks.filter((task) => task.selected !== false).length || Number(job.config?.videoCount || 0);
  const latest = job.logs?.at(-1)?.message;
  jobMessage.textContent = job.actionRequired || latest || statusLabel(job.status);
  const warnings = Array.isArray(job.approvalWarnings) ? job.approvalWarnings : [];
  warningBox.hidden = !warnings.length;
  warningBox.textContent = warnings.length ? `生成前提醒（不阻断任务）：\n${warnings.map((warning) => `• ${warning}`).join("\n")}` : "";
  progressText.textContent = `${Math.min(completed, total)} / ${total}`;
  progressBar.style.width = `${total ? Math.min(100, (completed / total) * 100) : 0}%`;
  openOutputButton.disabled = !job.outputDir;
  const canRecover = job.status === "failed" && /结构化JSON|分析JSON|分析结果/.test(`${job.error || ""} ${job.actionRequired || ""}`);
  recoverAnalysisButton.hidden = !canRecover;
  retryUploadButton.hidden = !(job.status === "failed" && /母版视频.*(?:审核超时|上传暂未完成)/.test(`${job.error || ""} ${job.actionRequired || ""}`));
  if (job.canvasUrl) {
    canvasLink.href = job.canvasUrl;
    canvasLink.hidden = false;
  } else {
    canvasLink.hidden = true;
  }
  if (["queued", "preparing"].includes(job.status)) setActiveStage(2);
  if (job.status === "awaiting_review") {
    setActiveStage(4);
    renderReview(job);
  }
  if (["editing", "running", "compliance_deferred", "success", "partial", "failed"].includes(job.status) && tasks.length) setActiveStage(5);
  renderResults(job);
  renderGenerationHistory(job);
  renderLogs(job);
  renderHistory();
}

function schedulePoll(delay = 1800) {
  clearTimeout(state.pollTimer);
  state.pollTimer = setTimeout(pollJob, delay);
}

async function pollJob() {
  if (!state.currentJobId) return;
  try {
    const job = await api(`./api/variation/jobs/${state.currentJobId}`);
    renderJob(job);
    if (["queued", "preparing", "running"].includes(job.status)) schedulePoll();
    else refreshHistory();
  } catch (error) {
    jobMessage.textContent = error.message;
  }
}

function payloadFromForm() {
  const data = new FormData(form);
  const workstation = window.WorkbenchWorkstation.identity();
  const product = state.products.find((item) => item.id === data.get("productId"));
  const noProduct = String(data.get("productId") || productSelect.value) === "no-product";
  const tierCounts = variationTierCounts();
  const count = variationCount();
  return window.WorkbenchKnowledge.enrich({
    draftJobId: state.currentJobId,
    reviseJobId: state.revisionMode ? state.currentJobId : "",
    revisionAcknowledged: state.revisionMode,
    workstationId: workstation.id,
    workstationLabel: workstation.label,
    referenceVideoPath: state.reference?.path || "",
    referenceVideoName: state.reference?.name || "",
    sourceDuration: state.sourceDuration,
    productId: String(data.get("productId") || ""),
    noProduct,
    offerId: noProduct ? "no-price" : String(data.get("offerId") || ""),
    productNameStyle: String(data.get("productNameStyle") || "short"),
    productMentionPolicy: noProduct ? "optional" : String(data.get("productMentionPolicy") || "follow-source"),
    targetProductName: noProduct ? "不出现产品" : targetProductName.value,
    videoCount: count,
    tierCounts,
    concurrentVideos: count,
    dimensions: selectedDimensions(),
    dimensionDetails: dimensionDetails(),
    mustKeep: String(data.get("mustKeep") || ""),
    variationRequest: String(data.get("variationRequest") || ""),
    analysisMode: String(data.get("analysisMode") || "ai"),
    manualDeepDive: String(data.get("manualDeepDive") || ""),
    productAssetPaths: noProduct ? [] : state.productAssets.map((item) => item.path),
    productAssetNames: noProduct ? [] : state.productAssets.map((item) => item.name),
    characterAssetPaths: state.characterAssets.map((item) => item.path),
    characterAssetNames: state.characterAssets.map((item) => item.name),
    backgroundAssetPaths: state.backgroundAssets.map((item) => item.path),
    backgroundAssetNames: state.backgroundAssets.map((item) => item.name)
  });
}

function reviewPayload() {
  const coreLock = {};
  coreGrid.querySelectorAll("[data-core-key]").forEach((input) => { coreLock[input.dataset.coreKey] = input.value.trim(); });
  const variants = [...cardGrid.querySelectorAll("[data-variant-id]")].map((card) => ({
    id: card.dataset.variantId,
    selected: card.querySelector('[data-role="selected"]').checked,
    changeSummary: card.querySelector('[data-role="summary"]').value.trim(),
    scriptText: card.querySelector('[data-role="script"]').value.trim(),
    performanceDirection: card.querySelector('[data-role="performance"]').value.trim(),
    customInstruction: card.querySelector('[data-role="instruction"]').value.trim()
  }));
  return {
    coreApproved: document.querySelector("#variationCoreApproved").checked,
    assetsApproved: document.querySelector("#variationAssetsApproved").checked,
    planApproved: document.querySelector("#variationPlanApproved").checked,
    coreLock,
    variants
  };
}

async function approveGeneration() {
  if (!state.currentJobId) return;
  const payload = reviewPayload();
  if (!payload.coreApproved || !payload.assetsApproved || !payload.planApproved) {
    alert("请完成三项人工确认后再生成。");
    return;
  }
  if (!payload.variants.some((item) => item.selected)) {
    alert("至少选择一条裂变任务。");
    return;
  }
  approveButton.disabled = true;
  approveButton.textContent = "正在提交LibTV…";
  try {
    const result = await api(`./api/variation/jobs/${state.currentJobId}/approve`, { method: "POST", body: JSON.stringify(payload) });
    reviewPanel.hidden = true;
    setActiveStage(5);
    if (result.warnings?.length) {
      setFormMessage(`任务已继续生成；有${result.warnings.length}项内容提醒，请在任务进度中查看。`, "warning");
    }
    schedulePoll(300);
  } catch (error) {
    alert(error.message);
  } finally {
    approveButton.disabled = false;
    approveButton.textContent = "确认并调用LibTV生成";
  }
}

async function retryVariant(variantId) {
  if (!confirm("只重新生成这条失败裂变，其他成功成片不会重复生成。确认继续？")) return;
  try {
    await api(`./api/variation/jobs/${state.currentJobId}/retry/${variantId}`, { method: "POST" });
    schedulePoll(300);
  } catch (error) {
    alert(error.message);
  }
}

async function retryVariantCompliance(variantId) {
  try {
    await api(`./api/variation/jobs/${state.currentJobId}/compliance-retry/${variantId}`, { method: "POST" });
    schedulePoll(300);
  } catch (error) {
    alert(error.message);
  }
}

async function retryVariantQuality(variantId) {
  try {
    await api(`./api/variation/jobs/${state.currentJobId}/quality-retry/${variantId}`, { method: "POST" });
    schedulePoll(300);
  } catch (error) {
    alert(error.message);
  }
}

async function retryMotherUpload() {
  if (!state.currentJobId) return;
  retryUploadButton.disabled = true;
  retryUploadButton.textContent = "正在重试上传…";
  try {
    await api(`./api/variation/jobs/${state.currentJobId}/retry-upload`, { method: "POST" });
    schedulePoll(300);
  } catch (error) {
    jobMessage.textContent = error.message;
  } finally {
    retryUploadButton.disabled = false;
    retryUploadButton.textContent = "重试上传母版并继续";
  }
}

async function checkHealth() {
  const box = document.querySelector("#variationHealth");
  const title = document.querySelector("#variationHealthTitle");
  const text = document.querySelector("#variationHealthText");
  try {
    const response = await fetch("./api/health");
    const data = await response.json();
    box.classList.toggle("offline", !response.ok);
    title.textContent = response.ok ? "LibTV已连接" : "LibTV需要登录";
    text.textContent = response.ok ? "可以分析和生成" : data.message || "请从启动器完成登录";
  } catch (error) {
    box.classList.add("offline");
    title.textContent = "本地服务未连接";
    text.textContent = error.message;
  }
}

async function initialize() {
  setupTierCountInputs();
  form.querySelectorAll('input[name="dimensions"]').forEach((input) => {
    input.addEventListener("change", updateDimensionDetails);
  });
  updateDimensionDetails();
  bindReferenceUpload();
  bindImageUpload({ zoneId: "#variationProductDropZone", inputId: "#variationProductInput", labelId: "#variationProductNames", kind: "variation-product", stateKey: "productAssets", limit: 6 });
  bindImageUpload({ zoneId: "#variationCharacterDropZone", inputId: "#variationCharacterInput", labelId: "#variationCharacterNames", kind: "variation-character", stateKey: "characterAssets", limit: 2 });
  bindImageUpload({ zoneId: "#variationBackgroundDropZone", inputId: "#variationBackgroundInput", labelId: "#variationBackgroundNames", kind: "variation-background", stateKey: "backgroundAssets", limit: 2 });
  checkHealth();
  const defaults = await api("./api/variation/defaults");
  state.products = defaults.products || [];
  const noProductOption = defaults.noProductOption || { id: "no-product", name: "不出现产品" };
  productSelect.innerHTML = [
    ...state.products.map((product) => `<option value="${escapeHtml(product.id)}">${escapeHtml(product.name)}</option>`),
    `<option value="${escapeHtml(noProductOption.id)}">${escapeHtml(noProductOption.name)}</option>`
  ].join("");
  productSelect.value = defaults.productId;
  productSelect.addEventListener("change", updateProductName);
  productNameStyle.addEventListener("change", updateProductName);
  updateProductName();
  stableCountInput.value = String(defaults.tierCounts?.stable ?? 2);
  balancedCountInput.value = String(defaults.tierCounts?.balanced ?? 2);
  boldCountInput.value = String(defaults.tierCounts?.bold ?? 1);
  updateEstimate();
  restoreReferenceDraft();
  if (new URLSearchParams(location.search).get("preset") === "competitor") {
    document.querySelector(".variation-topbar h1").textContent = "竞对视频复刻裂变";
    form.elements.mustKeep.value = "保留母版的前三秒钩子、成交信息顺序、关键动作因果和产品露出时机";
    form.elements.variationRequest.value = "基于竞对或有效母版做差异化复刻；只迁移可复用结构，不照搬人物身份、品牌文字、价格规格或未经确认的商品事实。";
    formBadge.textContent = "已载入竞对复刻预设";
  }
  form.addEventListener("input", persistReferenceDraft);
  form.addEventListener("change", persistReferenceDraft);
  window.addEventListener("beforeunload", persistReferenceDraft);
  await refreshHistory();
  if (state.currentJobId) pollJob();
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!state.reference) {
    setFormMessage("请先上传1条母版视频。", "error");
    return;
  }
  if (!selectedDimensions().length) {
    setFormMessage("至少选择一个允许变化的维度。", "error");
    return;
  }
  if (variationCount() < 1 || variationCount() > 10) {
    setFormMessage("请设置稳健、均衡、大胆数量，三档合计需为1–10条。", "error");
    return;
  }
  if (!offerSelect.value) {
    setFormMessage("请选择本批唯一价格规格；如果不需要价格，请选择“本批不口播价格”。", "error");
    offerSelect.focus();
    return;
  }
  submitButton.disabled = true;
  submitButton.textContent = "正在创建分析任务…";
  setFormMessage("正在锁定素材并提交母版分析，请不要关闭工作台。");
  state.renderedReviewId = "";
  reviewPanel.hidden = true;
  try {
    const result = await api("./api/variation/jobs", { method: "POST", body: JSON.stringify(payloadFromForm()) });
    window.WorkbenchKnowledge.record("generation_started", result.id, { mode: "variation" });
    rememberCurrentJob(result.id);
    clearReferenceDraft();
    state.revisionMode = false;
    formBadge.textContent = "分析中";
    setActiveStage(2);
    await refreshHistory();
    await pollJob();
  } catch (error) {
    setFormMessage(error.message, "error");
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = "分析母版并生成裂变方案";
  }
});

approveButton.addEventListener("click", approveGeneration);
editGeneratedButton.addEventListener("click", async () => {
  if (!state.currentJob || !hasGeneratedOutput(state.currentJob)) return;
  if (!window.confirm("本任务已成功生成视频，如修改则可能影响历史记录")) return;
  editGeneratedButton.disabled = true;
  try {
    const result = await api(`./api/variation/jobs/${state.currentJobId}/edit`, { method: "POST" });
    state.currentJob = result.job;
    state.revisionMode = true;
    state.hydratedJobId = "";
    renderJob(result.job);
    window.dispatchEvent(new CustomEvent("module-task-updated"));
    setFormMessage("已进入修改模式。提交后将作为当前任务的新版本生成，已有成片保留在历史成片中。", "warning");
    form.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    setFormMessage(error.message, "error");
  } finally {
    editGeneratedButton.disabled = false;
  }
});
document.querySelector("#variationSelectAll").addEventListener("click", () => {
  const checks = [...cardGrid.querySelectorAll('[data-role="selected"]')];
  const shouldCheck = checks.some((input) => !input.checked);
  checks.forEach((input) => { input.checked = shouldCheck; });
});
openOutputButton.addEventListener("click", async () => {
  if (!state.currentJobId) return;
  try { await api(`./api/variation/jobs/${state.currentJobId}/open-output`, { method: "POST" }); } catch (error) { alert(error.message); }
});
recoverAnalysisButton.addEventListener("click", async () => {
  if (!state.currentJobId) return;
  recoverAnalysisButton.disabled = true;
  recoverAnalysisButton.textContent = "正在恢复…";
  try {
    await api(`./api/variation/jobs/${state.currentJobId}/recover-analysis`, { method: "POST" });
    state.renderedReviewId = "";
    await pollJob();
  } catch (error) {
    alert(error.message);
  } finally {
    recoverAnalysisButton.disabled = false;
    recoverAnalysisButton.textContent = "恢复已保存分析";
  }
});
retryUploadButton.addEventListener("click", retryMotherUpload);
historyRefreshButton.addEventListener("click", refreshHistory);
window.addEventListener("module-task-new", (event) => {
  if (event.detail?.module !== "variation.html") return;
  suppressReferenceDraftPersistence = true;
  localStorage.removeItem(VARIATION_REFERENCE_DRAFT_KEY);
});
newTaskButton.addEventListener("click", () => {
  clearTimeout(state.pollTimer);
  suppressReferenceDraftPersistence = true;
  rememberCurrentJob("");
  localStorage.removeItem(VARIATION_REFERENCE_DRAFT_KEY);
  const url = new URL(location.href);
  url.search = "?new=1";
  location.href = `${url.pathname}${url.search}`;
});
historyToggle.addEventListener("click", () => {
  state.historyExpanded = !state.historyExpanded;
  syncHistoryDisclosure();
});
historyPrev.addEventListener("click", () => setHistoryPage(state.historyPage - 1));
historyNext.addEventListener("click", () => setHistoryPage(state.historyPage + 1));
historyPageNumbers.addEventListener("click", (event) => {
  const button = event.target.closest("[data-variation-history-page]");
  if (button) setHistoryPage(button.dataset.variationHistoryPage);
});

initialize().catch((error) => setFormMessage(error.message, "error"));
