const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const authStatus = $("#authStatus");
const authHint = $("#authHint");
const connectKling = $("#connectKling");
const showMultimodalLogin = $("#showMultimodalLogin");
const multimodalLoginForm = $("#multimodalLoginForm");
const multimodalUsername = $("#multimodalUsername");
const multimodalPassword = $("#multimodalPassword");
const multimodalCaptchaField = $("#multimodalCaptchaField");
const multimodalCaptcha = $("#multimodalCaptcha");
const submitMultimodalLogin = $("#submitMultimodalLogin");
const libtvStatus = $("#libtvStatus");
const libtvHint = $("#libtvHint");
const connectLibtv = $("#connectLibtv");
const outputDir = $("#outputDir");
const portraitFile = $("#portraitFile");
const portraitPreview = $("#portraitPreview");
const videoFile = $("#videoFile");
const videoPreview = $("#videoPreview");
const identityAdjustment = $("#identityAdjustment");
const identityBadge = $("#identityBadge");
const identityHint = $("#identityHint");
const generateIdentity = $("#generateIdentity");
const regenerateIdentity = $("#regenerateIdentity");
const identityGrid = $("#identityGrid");
const productSelect = $("#productSelect");
const productNameStyle = $("#productNameStyle");
const productNameStyleField = $("#productNameStyleField");
const productBadge = $("#productBadge");
const productImages = $("#productImages");
const productSummary = $("#productSummary");
const usageRule = $("#usageRule");
const dialogueText = $("#dialogueText");
const candidateCount = $("#candidateCount");
const klingImageModel = $("#klingImageModel");
const klingVideoModel = $("#klingVideoModel");
const libtvImageModel = $("#libtvImageModel");
const libtvVideoModel = $("#libtvVideoModel");
const klingModelFields = $("#klingModelFields");
const libtvModelFields = $("#libtvModelFields");
const klingTeamSpaceConfirmed = $("#klingTeamSpaceConfirmed");
const providerNote = $("#providerNote");
const referenceAudioSelect = null;
const referenceAudioPreview = null;
const referenceAudioHint = $("#referenceAudioHint");
const clothingPrompt = $("#clothingPrompt");
const stylingPrompt = $("#stylingPrompt");
const backgroundPrompt = $("#backgroundPrompt");
const otherPrompt = $("#otherPrompt");
const cleanSourceText = $("#cleanSourceText");
const generationCountBadge = $("#generationCountBadge");
const startGeneration = $("#startGeneration");
const openOutput = $("#openOutput");
const taskGrid = $("#taskGrid");
const resultGrid = $("#resultGrid");
const logBox = $("#logBox");
const jobStatus = $("#jobStatus");
const progressText = $("#progressText");
const progressBar = $("#progressBar");
const preparationGrid = $("#preparationGrid");
const failureBanner = $("#failureBanner");

let sourceMode = "views";
let identityJobId = "";
let identityPoll = null;
let personJobId = "";
let personPoll = null;
let productCatalog = [];
let referenceAudioCatalog = [];
let klingModelCatalog = { imageToImage: [], imageToVideo: [] };
let libtvModelCatalog = { image: [], video: [] };
const PERSON_JOB_STORAGE_KEY = "wis-person-studio-current-job";
const IDENTITY_JOB_STORAGE_KEY = "wis-person-studio-current-identity";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function shortProviderError(value) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  if (/insufficient credits|top up|余额不足|灵感值不足/i.test(text)) {
    return "可灵灵感值不足，请切换 LibTV，或充值后再试。";
  }
  if (/剩余灵感值为0/i.test(text)) {
    return "可灵剩余灵感值为0，请切换 LibTV，或充值后再生成。";
  }
  if (/write 图片X|reference an input image|prompt\(必填\)/i.test(text)) {
    return "可灵未识别人物参考图，请刷新模型并选择支持单张“图片1”参考的可灵图片模型，或切换 LibTV。";
  }
  if (/too many requests|rate.?limit|slow down|请求过多|频控/i.test(text)) {
    return "可灵当前请求过多，请稍后重试；系统已避免重复上传人物图。";
  }
  if (/not logged|login|unauthorized|未登录|登录未完成/i.test(text)) {
    return "平台登录未完成，请先在上方完成连接。";
  }
  return text.length > 180 ? `${text.slice(0, 180)}…` : text;
}

const PERSON_STUDIO_API_ROOT = "/" + "api/";

function personStudioApiPath(path) {
  const value = String(path || "");
  if (!value.startsWith(PERSON_STUDIO_API_ROOT)) return value;
  const marker = "/" + "person-studio";
  const pathname = window.location.pathname || "/";
  const markerIndex = pathname.indexOf(marker);
  if (markerIndex < 0) return value;
  return `${pathname.slice(0, markerIndex + marker.length)}${value}`;
}

async function api(path, options = {}) {
  let response;
  try {
    response = await fetch(personStudioApiPath(path), options);
  } catch {
    throw new Error("本地服务未连接，请重新双击启动程序");
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || data.message || `请求失败（${response.status}）`);
    error.failure = data.failure;
    error.captchaRequired = Boolean(data.captchaRequired);
    error.code = data.code;
    throw error;
  }
  return data;
}

function apiJson(path, method = "GET", body) {
  return api(path, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
}

function connectedKlingAccountLabel(auth) {
  const user = auth?.userInfo || {};
  const name = String(user.realName || "").trim();
  const workNo = String(user.workNo || "").trim();
  const group = String(user.groupName || user.parentDept || "").trim();
  const identity = [name, workNo ? `工号 ${workNo}` : "", group].filter(Boolean).join(" · ");
  return identity ? `多模态服务已连接 · ${identity}` : "多模态服务已连接";
}

function terminal(status) {
  return ["success", "partial", "failed", "interrupted"].includes(String(status));
}

function statusLabel(status) {
  return {
    queued: "排队中",
    running: "生成中",
    success: "已完成",
    partial: "部分完成",
    failed: "失败",
    blocked: "未开始",
    skipped: "已跳过",
    interrupted: "已中断"
  }[status] || "等待";
}

function timeOnly(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleTimeString("zh-CN", { hour12: false });
}

function selectedProvider() {
  return $("input[name=provider]:checked")?.value === "libtv" ? "libtv" : "multimodal";
}

function selectedIdentityModel() {
  return selectedProvider() === "libtv" ? libtvImageModel.value : "openai/gpt-image-2";
}

function selectedVideoModel() {
  return selectedProvider() === "libtv" ? libtvVideoModel.value : "kling";
}

function syncProviderUi() {
  const provider = selectedProvider();
  $$(".provider-card").forEach((card) => card.classList.toggle("selected", card.querySelector("input")?.checked));
  klingModelFields.hidden = provider !== "multimodal";
  libtvModelFields.hidden = provider !== "libtv";
  providerNote.textContent = sourceMode === "video"
    ? provider === "libtv"
      ? "参考视频将完整上传到 LibTV 画布，用于继承人物、动作节奏和原片逻辑。"
      : "参考视频会直接上传多模态服务；无新口播时使用 Kling Omni，包含新口播时自动使用 Seedance 保证声音与口型。"
    : provider === "libtv"
      ? "默认优先使用已连接的 LibTV 团队工作空间；人物三视图、产品图与参考视频都会保留在可查看的画布中。"
      : "人物三视图由 GPT Image 2 生成，人物视频由 Kling Omni 生成；无需安装 CLI，也不再读取个人空间灵感值。";
}

function validateConnectionFields() {
  if (!outputDir.value.trim()) throw new Error("请填写输出文件夹");
  if (selectedProvider() === "libtv" && (!selectedIdentityModel() || !selectedVideoModel())) throw new Error("请先等待 LibTV 模型列表加载完成");
}

function setMode(mode) {
  sourceMode = mode;
  $$(".mode-button").forEach((button) => button.classList.toggle("active", button.dataset.mode === mode));
  $("#viewsMode").hidden = mode !== "views";
  $("#videoMode").hidden = mode !== "video";
  identityBadge.textContent = mode === "views" ? (identityJobId ? "三视图已生成" : "等待人物正面照") : (videoFile.files[0] ? "视频原片已就绪" : "等待视频原片");
  syncProviderUi();
}

function previewLocalFile(input, target, type) {
  const file = input.files?.[0];
  if (!file) return;
  const url = URL.createObjectURL(file);
  target.classList.remove("empty");
  target.innerHTML = type === "video"
    ? `<video src="${url}" controls muted playsinline></video>`
    : `<img src="${url}" alt="人物正面照预览" />`;
}

function resetIdentityCards(message = "等待生成") {
  identityGrid.innerHTML = [
    ["front", "正", "正面基准图"],
    ["left", "左", "左侧 45°"],
    ["right", "右", "右侧 45°"]
  ].map(([angle, mark, label]) => `<article class="view-card" data-angle="${angle}"><div class="view-placeholder">${mark}</div><strong>${label}</strong><span>${message}</span></article>`).join("");
}

function renderIdentity(job) {
  identityJobId = job.id;
  identityBadge.textContent = `第 ${job.version || 1} 版 · ${statusLabel(job.status)}`;
  identityHint.textContent = shortProviderError(job.error || job.logs?.at(-1)?.message) || "三视图生成中";
  identityGrid.innerHTML = (job.tasks || []).map((task) => {
    const source = task.localPath ? personStudioApiPath(`/api/file?path=${encodeURIComponent(task.localPath)}`) : task.resultUrl || "";
    const image = source
      ? `<img src="${escapeHtml(source)}" alt="${escapeHtml(task.label)}" />`
      : `<div class="view-placeholder">${task.angle === "front" ? "正" : task.angle === "left" ? "左" : "右"}</div>`;
    const diagnostic = task.diagnostic
      ? `<details><summary>查看诊断</summary><pre style="max-height:180px;overflow:auto;white-space:pre-wrap;word-break:break-word">${escapeHtml(task.diagnostic)}</pre></details>`
      : "";
    return `<article class="view-card" data-angle="${escapeHtml(task.angle)}">${image}<strong>${escapeHtml(task.label)}</strong><span>${escapeHtml(shortProviderError(task.error) || statusLabel(task.status))}</span>${diagnostic}</article>`;
  }).join("");
  regenerateIdentity.disabled = !terminal(job.status);
  generateIdentity.disabled = !terminal(job.status);
  generateIdentity.textContent = terminal(job.status) ? "重新上传并生成" : "三视图生成中";
  if (terminal(job.status) && identityPoll) {
    clearInterval(identityPoll);
    identityPoll = null;
  }
}

async function pollIdentity() {
  if (!identityJobId) return;
  try {
    renderIdentity(await apiJson(`/api/identity-jobs/${identityJobId}`));
  } catch (error) {
    identityHint.textContent = error.message;
  }
}

async function createIdentity() {
  try {
    validateConnectionFields();
    const file = portraitFile.files?.[0];
    if (!file) throw new Error("请选择人物正面照");
    const data = new FormData();
    data.append("material", file);
    data.append("outputDir", outputDir.value.trim());
    data.append("adjustment", identityAdjustment.value.trim());
    data.append("provider", selectedProvider());
    data.append("identityModel", selectedIdentityModel());
    data.append("klingTeamSpaceConfirmed", klingTeamSpaceConfirmed?.checked ? "true" : "false");
    generateIdentity.disabled = true;
    regenerateIdentity.disabled = true;
    identityBadge.textContent = "正在提交";
    resetIdentityCards("准备生成");
    const endpoint = selectedProvider() === "libtv" ? "/api/legacy-identity-jobs" : "/api/identity-jobs";
    const result = await api(endpoint, { method: "POST", body: data });
    identityJobId = result.id;
    localStorage.setItem(IDENTITY_JOB_STORAGE_KEY, identityJobId);
    await pollIdentity();
    if (identityPoll) clearInterval(identityPoll);
    identityPoll = setInterval(pollIdentity, 2200);
  } catch (error) {
    generateIdentity.disabled = false;
    identityBadge.textContent = "提交失败";
    identityHint.textContent = error.message;
  }
}

async function regenerateViews() {
  try {
    validateConnectionFields();
    if (!identityJobId) throw new Error("请先生成一版三视图");
    regenerateIdentity.disabled = true;
    generateIdentity.disabled = true;
    resetIdentityCards("重新生成中");
    identityBadge.textContent = "重新生成中";
    await apiJson(`/api/identity-jobs/${identityJobId}/regenerate`, "POST", {
      adjustment: identityAdjustment.value.trim(),
      provider: selectedProvider(),
      identityModel: selectedIdentityModel(),
      klingTeamSpaceConfirmed: Boolean(klingTeamSpaceConfirmed?.checked)
    });
    await pollIdentity();
    if (identityPoll) clearInterval(identityPoll);
    identityPoll = setInterval(pollIdentity, 2200);
  } catch (error) {
    regenerateIdentity.disabled = false;
    identityBadge.textContent = "重新生成失败";
    identityHint.textContent = error.message;
  }
}

function selectedProduct() {
  return productCatalog.find((item) => item.id === productSelect.value) || productCatalog[0];
}

function updateProductNameStyle() {
  const product = selectedProduct();
  if (!product) return;
  const noProduct = Boolean(product.noProduct);
  const full = productNameStyle.value === "full";
  const short = product.spokenName || product.shortName || product.name;
  productNameStyleField.hidden = noProduct;
  productNameStyle.disabled = noProduct;
  if (noProduct) return;
  productNameStyle.innerHTML = [
    `<option value="short">简称（默认）：${escapeHtml(short)}</option>`,
    `<option value="full">产品全称：${escapeHtml(product.name || short)}</option>`
  ].join("");
  productNameStyle.value = full ? "full" : "short";
}

async function renderProduct() {
  const product = selectedProduct();
  if (!product) return;
  updateProductNameStyle();
  const noProduct = Boolean(product.noProduct);
  productBadge.textContent = noProduct ? "无产品模式" : "与产品镜共用产品库";
  usageRule.textContent = product.usageRule || "系统将按产品形态匹配正确使用动作。";
  productSummary.textContent = `${product.visualIdentity}。视觉重点：${product.benefitCues}。`;
  productImages.classList.toggle("no-product", noProduct);
  if (noProduct) {
    productImages.innerHTML = "<div class=\"no-product-state\"><strong>本次不出现产品</strong><span>不会上传产品图，也不会生成商品、包装、品牌、价格或购买引导。</span></div>";
    return;
  }
  productImages.innerHTML = "<span class=\"helper\">正在读取产品参考图…</span>";
  try {
    const result = await apiJson("/api/images", "POST", { imageDir: product.imageDir, productId: product.id });
    productImages.innerHTML = (result.files || []).slice(0, 8).map((file) => `<img src="${escapeHtml(personStudioApiPath(`/api/image?path=${encodeURIComponent(file)}`))}" alt="${escapeHtml(product.shortName)}产品参考图" />`).join("");
  } catch (error) {
    productImages.innerHTML = `<span class="helper">${escapeHtml(error.message)}</span>`;
  }
}

function selectedEngine() {
  return selectedVideoModel();
}

function syncModelCards() {
  if (referenceAudioSelect?.value && $("input[name=engine]:checked")?.value === "kling") {
    const seedance = $("input[name=engine][value=seedance]");
    if (seedance) seedance.checked = true;
    referenceAudioHint.textContent = "参考音频仅由 Seedance 接口支持，已自动切换为 Seedance 2.0。";
  }
  $$(".model-card").forEach((card) => card.classList.toggle("selected", card.querySelector("input").checked));
}

function renderReferenceAudio() {
  if (!referenceAudioSelect) {
    referenceAudioHint.textContent = "填写口播时启用平台原生声音；参考视频含新口播时会自动选择支持声音与口型的模型。";
    return;
  }
  const selected = referenceAudioCatalog.find((item) => item.id === referenceAudioSelect.value);
  if (!selected) {
    referenceAudioPreview.hidden = true;
    referenceAudioPreview.removeAttribute("src");
    referenceAudioHint.textContent = "选择后可先试听；生成时会自动使用 Seedance 的参考音频能力，不需要上传文件。";
    return;
  }
  referenceAudioPreview.src = selected.previewUrl;
  referenceAudioPreview.hidden = false;
  referenceAudioHint.textContent = `${selected.name} · ${selected.style} · 约${selected.durationSeconds || "—"}秒。参考声音只用于语气、节奏和音色方向，不照搬原句。`;
  const seedance = $("input[name=engine][value=seedance]");
  if (seedance) {
    seedance.checked = true;
    syncModelCards();
  }
}

function modelOption(model, kind) {
  const inputs = Array.isArray(model.inputs) ? model.inputs.length : 0;
  const suffix = kind === "video" ? ` · ${inputs > 1 ? "多参考图" : "单参考图"}` : "";
  return `<option value="${escapeHtml(model.model)}">${escapeHtml(model.alias || model.model)}${suffix}</option>`;
}

function populateKlingModels(capabilities) {
  klingModelCatalog = capabilities?.models || { imageToImage: [], imageToVideo: [] };
  const imageModels = (klingModelCatalog.imageToImage || []).filter((model) => model.singleImageReference !== false);
  const videoModels = klingModelCatalog.imageToVideo || [];
  klingImageModel.innerHTML = imageModels.map((model) => modelOption(model, "image")).join("");
  klingVideoModel.innerHTML = videoModels.map((model) => modelOption(model, "video")).join("");
  const preferredImage = imageModels.find((model) => /v3_0|v3\.0/i.test(model.model))?.model || imageModels[0]?.model || "";
  const preferredVideo = videoModels.find((model) => /v3_0_omni/i.test(model.model))?.model || videoModels.find((model) => (model.inputs || []).length > 1)?.model || videoModels[0]?.model || "";
  if (preferredImage) klingImageModel.value = preferredImage;
  if (preferredVideo) klingVideoModel.value = preferredVideo;
}

function populateLibtvModels(capabilities) {
  libtvModelCatalog = capabilities?.models || { image: [], video: [] };
  const imageModels = libtvModelCatalog.image || [];
  const videoModels = libtvModelCatalog.video || [];
  const option = (model) => `<option value="${escapeHtml(model.key)}">${escapeHtml(model.name)}${model.description ? ` · ${escapeHtml(model.description)}` : ""}</option>`;
  libtvImageModel.innerHTML = imageModels.map(option).join("");
  libtvVideoModel.innerHTML = videoModels.map(option).join("");
  const preferredImage = imageModels.find((model) => model.key === "nebula-ultra")?.key || imageModels[0]?.key || "";
  const preferredVideo = videoModels.find((model) => model.key === "star-video2")?.key || videoModels[0]?.key || "";
  if (preferredImage) libtvImageModel.value = preferredImage;
  if (preferredVideo) libtvVideoModel.value = preferredVideo;
}

function selectedVideoTotal() {
  return Math.max(1, Number(candidateCount.value || 1)) * 2;
}

function updateGenerationCount() {
  const total = selectedVideoTotal();
  generationCountBadge.textContent = `本次生成 ${total} 条视频`;
  startGeneration.textContent = `开始生成 ${total} 条人物营销视频`;
  if (!personJobId) progressText.textContent = `0 / ${total}`;
}

function syncResultCards(tasks = []) {
  const completedTasks = tasks.filter((task) => task.localPath || task.resultUrl);
  const completedKeys = new Set(completedTasks.map((task) => `${task.kind}-${task.variantIndex}`));
  [...resultGrid.children].forEach((card) => {
    if (!completedKeys.has(card.dataset.resultTask)) card.remove();
  });
  completedTasks.forEach((task) => {
    const key = `${task.kind}-${task.variantIndex}`;
    const existing = [...resultGrid.children].find((card) => card.dataset.resultTask === key);
    if (existing) {
      existing.querySelector("strong").textContent = task.label;
      return;
    }
    const src = task.localPath ? personStudioApiPath(`/api/file?path=${encodeURIComponent(task.localPath)}`) : task.resultUrl;
    const card = document.createElement("article");
    card.className = "result-card";
    card.dataset.resultTask = key;
    card.innerHTML = `<video src="${src}" controls preload="metadata" playsinline></video><div><strong>${escapeHtml(task.label)}</strong><a href="${src}" target="_blank" rel="noopener">打开结果</a></div>`;
    resultGrid.appendChild(card);
  });
}

function renderPersonJob(job) {
  personJobId = job.id;
  const done = Number(job.summary?.success || 0);
  const failed = Number(job.summary?.failed || 0);
  const total = Number(job.summary?.total || 2);
  jobStatus.textContent = statusLabel(job.status);
  progressText.textContent = `${done} / ${total}`;
  progressBar.style.width = `${Math.round(((done + failed) / total) * 100)}%`;
  openOutput.disabled = !job.outputDir;
  const preparation = job.preparation || {};
  preparationGrid.innerHTML = Object.values(preparation).map((step) => {
    const count = step.total ? `${step.done || 0}/${step.total}` : "等待";
    return `<article class="preparation-step ${escapeHtml(step.status || "queued")}"><span>${statusLabel(step.status)}</span><strong>${escapeHtml(step.label)}</strong><small>${escapeHtml(step.error || count)}</small></article>`;
  }).join("");
  if (job.failure) {
    failureBanner.hidden = false;
    failureBanner.innerHTML = `<strong>${escapeHtml(job.failure.title)}</strong><p>${escapeHtml(job.failure.hint)}</p><details><summary>查看完整诊断</summary><pre style="max-height:240px;overflow:auto;white-space:pre-wrap;word-break:break-word">${escapeHtml(job.failure.technical || "")}</pre></details>`;
  } else if (!new URLSearchParams(window.location.search).has("new")) {
    failureBanner.hidden = true;
    failureBanner.innerHTML = "";
  }
  taskGrid.innerHTML = (job.tasks || []).map((task) => {
    const engine = task.engine === "kling-cli"
      ? `可灵 CLI · ${task.model || "已选模型"}`
      : task.engine === "libtv-cli"
        ? `LibTV · ${task.model || "已选模型"}`
        : task.engine === "kling"
          ? "Kling Omni"
          : task.engine === "seedance" ? "Seedance 2.0" : "等待模型";
    const retryable = ["failed", "interrupted", "blocked"].includes(String(task.status));
    const diagnostic = task.diagnostic
      ? `<details><summary>查看完整诊断</summary><pre style="max-height:220px;overflow:auto;white-space:pre-wrap;word-break:break-word">${escapeHtml(task.diagnostic)}</pre></details>`
      : "";
    const retryButton = retryable && ["kling-cli", "multimodal"].includes(job.config?.provider)
      ? `<button type="button" class="retry-person-task" data-kind="${escapeHtml(task.kind)}" data-variant="${Number(task.variantIndex || 0)}">重新生成本条</button>`
      : "";
    return `<article><span class="task-state ${escapeHtml(task.status)}">${statusLabel(task.status)}</span><strong>${escapeHtml(task.label)}</strong><small>${escapeHtml(task.error || `${engine} · ${task.remoteStatus || "等待提交"} · ${task.progress || 0}%`)}</small>${diagnostic}${retryButton}</article>`;
  }).join("");
  syncResultCards(job.tasks || []);
  logBox.textContent = (job.logs || []).map((row) => `[${timeOnly(row.at)}] ${row.message}`).join("\n");
  logBox.scrollTop = logBox.scrollHeight;
  if (terminal(job.status)) {
    startGeneration.disabled = false;
    startGeneration.textContent = `再次生成 ${total} 条人物营销视频`;
    if (personPoll) {
      clearInterval(personPoll);
      personPoll = null;
    }
  }
}

async function retryPersonTask(button) {
  if (!personJobId || !button) return;
  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = "正在重新提交";
  try {
    const kind = encodeURIComponent(button.dataset.kind || "");
    const variantIndex = encodeURIComponent(button.dataset.variant || "");
    await apiJson(`/api/person-jobs/${personJobId}/retry?kind=${kind}&variantIndex=${variantIndex}`, "POST", {});
    await pollPersonJob();
    if (personPoll) clearInterval(personPoll);
    personPoll = setInterval(pollPersonJob, 2400);
  } catch (error) {
    logBox.textContent += `${logBox.textContent ? "\n" : ""}${error.message}`;
    button.disabled = false;
    button.textContent = originalText;
  }
}

async function pollPersonJob() {
  if (!personJobId) return;
  try {
    renderPersonJob(await apiJson(`/api/person-jobs/${personJobId}`));
  } catch (error) {
    logBox.textContent += `${logBox.textContent ? "\n" : ""}${error.message}`;
  }
}

async function startPersonVideos() {
  try {
    validateConnectionFields();
    if (sourceMode === "views" && !identityJobId) throw new Error("请先完成人物三视图生成");
    if (sourceMode === "video" && !videoFile.files?.[0]) throw new Error("请选择人物视频原片");
    startGeneration.disabled = true;
    startGeneration.textContent = "正在检查接口连接";
    jobStatus.textContent = "连接检查中";
    failureBanner.hidden = true;
    const provider = selectedProvider();
    logBox.textContent = `正在校验${provider === "libtv" ? " LibTV" : "公司多模态服务"}连接…`;
    const connectionEndpoint = provider === "libtv" ? "/api/legacy-person-connection-test" : "/api/person-connection-test";
    await apiJson(connectionEndpoint, "POST", { provider });
    logBox.textContent = `${provider === "libtv" ? "LibTV" : "公司多模态服务"}已连接，正在提交人物素材…`;
    const data = new FormData();
    const workstation = window.WorkbenchWorkstation.identity();
    data.append("workstationId", workstation.id);
    data.append("workstationLabel", workstation.label);
    data.append("provider", provider);
    data.append("klingTeamSpaceConfirmed", klingTeamSpaceConfirmed?.checked ? "true" : "false");
    data.append("outputDir", outputDir.value.trim());
    data.append("productId", productSelect.value);
    data.append("productNameStyle", productNameStyle.value || "short");
    data.append("engine", provider === "multimodal" ? "kling" : "");
    data.append("klingModel", "");
    data.append("libtvVideoModel", provider === "libtv" ? selectedEngine() : "");
    data.append("sourceMode", sourceMode);
    data.append("dialogue", dialogueText.value.trim());
    data.append("candidateCount", candidateCount.value);
    data.append("clothingPrompt", clothingPrompt.value.trim());
    data.append("stylingPrompt", stylingPrompt.value.trim());
    data.append("backgroundPrompt", backgroundPrompt.value.trim());
    data.append("otherPrompt", otherPrompt.value.trim());
    data.append("cleanSourceText", cleanSourceText.checked ? "true" : "false");
    if (sourceMode === "views") data.append("identityJobId", identityJobId);
    if (sourceMode === "video") data.append("material", videoFile.files[0]);
    startGeneration.textContent = "正在上传并创建任务";
    jobStatus.textContent = "提交中";
    resultGrid.innerHTML = "";
    logBox.textContent = "正在提交人物、产品和视频任务…";
    const createEndpoint = provider === "libtv" ? "/api/legacy-person-jobs" : "/api/person-jobs";
    const result = await api(createEndpoint, { method: "POST", body: data });
    personJobId = result.id;
    localStorage.setItem(PERSON_JOB_STORAGE_KEY, personJobId);
    $("#step4").scrollIntoView({ behavior: "smooth", block: "start" });
    await pollPersonJob();
    if (personPoll) clearInterval(personPoll);
    personPoll = setInterval(pollPersonJob, 2400);
  } catch (error) {
    startGeneration.disabled = false;
    startGeneration.textContent = `开始生成 ${selectedVideoTotal()} 条人物营销视频`;
    jobStatus.textContent = "提交失败";
    const detail = error.failure;
    logBox.textContent = detail ? `${detail.title}\n${detail.hint}\n技术信息：${detail.technical}` : error.message;
    if (detail) {
      failureBanner.hidden = false;
      failureBanner.innerHTML = `<strong>${escapeHtml(detail.title)}</strong><p>${escapeHtml(detail.hint)}</p><details><summary>查看完整诊断</summary><pre style="max-height:240px;overflow:auto;white-space:pre-wrap;word-break:break-word">${escapeHtml(detail.technical || "")}</pre></details>`;
    }
  }
}

function renderMultimodalStatus(auth) {
  const connected = Boolean(auth?.available);
  authStatus.textContent = connected ? connectedKlingAccountLabel(auth) : "多模态服务未连接";
  authHint.textContent = auth?.message || auth?.hint || "可自动读取 FanDo 登录，也可使用公司工号登录。";
  connectKling.textContent = connected ? "重新检测" : "自动连接";
  authStatus.closest(".auth-card")?.classList.toggle("unavailable", !connected);
}

async function boot() {
  const defaults = await apiJson("/api/defaults");
  productCatalog = defaults.products || [];
  referenceAudioCatalog = defaults.referenceAudios || [];
  outputDir.value = defaults.personDefaults?.outputDir || "";
  productSelect.innerHTML = productCatalog.map((product) => `<option value="${escapeHtml(product.id)}">${escapeHtml(product.name)}</option>`).join("");
  productSelect.value = defaults.productId || productCatalog[0]?.id || "";
  try {
    renderMultimodalStatus(await apiJson("/api/multimodal-auth-status"));
  } catch (error) {
    authStatus.textContent = "多模态服务未连接";
    authHint.textContent = error.message;
    authStatus.closest(".auth-card")?.classList.add("unavailable");
  }
  try {
    const status = await apiJson("/api/libtv-status");
    libtvStatus.textContent = status.available ? "LibTV 已连接" : "LibTV 未连接";
    libtvHint.textContent = status.available
      ? (status.message || "当前工作台账号的专属 LibTV 凭证有效")
      : "当前工作台账号尚未绑定 LibTV，请前往首页用本人手机号登录。";
    connectLibtv.textContent = status.available ? "管理 LibTV 账号" : "前往首页绑定 LibTV";
    libtvStatus.closest(".auth-card")?.classList.toggle("unavailable", !status.available);
    if (status.available) populateLibtvModels(await apiJson("/api/libtv-capabilities"));
  } catch (error) {
    libtvStatus.textContent = "LibTV 状态检测失败";
    libtvHint.textContent = error.message;
    libtvStatus.closest(".auth-card")?.classList.add("unavailable");
  }
  syncProviderUi();
  await renderProduct();
  renderReferenceAudio();

  const savedIdentityJobId = localStorage.getItem(IDENTITY_JOB_STORAGE_KEY) || "";
  if (savedIdentityJobId) {
    try {
      const savedIdentity = await apiJson(`/api/identity-jobs/${savedIdentityJobId}`);
      renderIdentity(savedIdentity);
      if (!terminal(savedIdentity.status)) identityPoll = setInterval(pollIdentity, 2200);
    } catch {
      localStorage.removeItem(IDENTITY_JOB_STORAGE_KEY);
      identityJobId = "";
    }
  }

  const requestedJobId = new URLSearchParams(window.location.search).get("job") || localStorage.getItem(PERSON_JOB_STORAGE_KEY) || "";
  if (requestedJobId) {
    try {
      personJobId = requestedJobId;
      await pollPersonJob();
      if (personJobId && !terminal((await apiJson(`/api/person-jobs/${personJobId}`)).status)) {
        personPoll = setInterval(pollPersonJob, 2400);
      }
    } catch {
      localStorage.removeItem(PERSON_JOB_STORAGE_KEY);
      personJobId = "";
    }
  } else {
    const recent = await apiJson("/api/person-jobs?limit=1").catch(() => []);
    if (recent?.[0]) {
      personJobId = recent[0].id;
      localStorage.setItem(PERSON_JOB_STORAGE_KEY, personJobId);
      renderPersonJob(recent[0]);
      if (!terminal(recent[0].status)) personPoll = setInterval(pollPersonJob, 2400);
    }
  }
}

$$('.step-tab').forEach((button) => button.addEventListener("click", () => {
  $$('.step-tab').forEach((item) => item.classList.toggle("active", item === button));
  $(`#${button.dataset.target}`).scrollIntoView({ behavior: "smooth", block: "start" });
}));
$$('.mode-button').forEach((button) => button.addEventListener("click", () => setMode(button.dataset.mode)));
$$('input[name=provider]').forEach((radio) => radio.addEventListener("change", syncProviderUi));
portraitFile.addEventListener("change", () => {
  previewLocalFile(portraitFile, portraitPreview, "image");
  identityJobId = "";
  regenerateIdentity.disabled = true;
  resetIdentityCards();
  identityBadge.textContent = "正面照已就绪";
});
videoFile.addEventListener("change", () => {
  previewLocalFile(videoFile, videoPreview, "video");
  identityBadge.textContent = "视频原片已就绪";
});
generateIdentity.addEventListener("click", createIdentity);
regenerateIdentity.addEventListener("click", regenerateViews);
productSelect.addEventListener("change", renderProduct);
productNameStyle.addEventListener("change", updateProductNameStyle);
candidateCount.addEventListener("change", updateGenerationCount);
referenceAudioSelect?.addEventListener("change", renderReferenceAudio);
connectKling?.addEventListener("click", async () => {
  connectKling.disabled = true;
  connectKling.textContent = "正在自动连接…";
  try {
    renderMultimodalStatus(await apiJson("/api/multimodal-auto-login", "POST", {}));
  } catch (error) {
    authStatus.textContent = "自动连接未完成";
    authHint.textContent = error.message;
    multimodalLoginForm.hidden = false;
  } finally {
    connectKling.disabled = false;
    if (connectKling.textContent === "正在自动连接…") connectKling.textContent = "自动连接";
  }
});
showMultimodalLogin?.addEventListener("click", () => {
  multimodalLoginForm.hidden = !multimodalLoginForm.hidden;
  if (!multimodalLoginForm.hidden) multimodalUsername.focus();
});
submitMultimodalLogin?.addEventListener("click", async () => {
  submitMultimodalLogin.disabled = true;
  submitMultimodalLogin.textContent = "正在登录…";
  try {
    const auth = await apiJson("/api/multimodal-login", "POST", {
      username: multimodalUsername.value.trim(),
      password: multimodalPassword.value,
      captcha: multimodalCaptcha.value.trim()
    });
    multimodalPassword.value = "";
    multimodalCaptcha.value = "";
    multimodalCaptchaField.hidden = true;
    multimodalLoginForm.hidden = true;
    renderMultimodalStatus(auth);
  } catch (error) {
    authStatus.textContent = "工号登录未完成";
    authHint.textContent = error.message;
    if (error.captchaRequired) multimodalCaptchaField.hidden = false;
  } finally {
    submitMultimodalLogin.disabled = false;
    submitMultimodalLogin.textContent = "登录并连接";
  }
});
connectLibtv?.addEventListener("click", () => {
  window.location.href = "../";
});
startGeneration.addEventListener("click", startPersonVideos);
taskGrid.addEventListener("click", (event) => {
  const button = event.target.closest(".retry-person-task");
  if (button) retryPersonTask(button);
});
openOutput.addEventListener("click", async () => {
  if (!personJobId) return;
  try { await apiJson(`/api/person-jobs/${personJobId}/open-output`, "POST", {}); }
  catch (error) { logBox.textContent += `${logBox.textContent ? "\n" : ""}${error.message}`; }
});

boot().catch((error) => {
  $("#serviceState").innerHTML = `<i></i> ${escapeHtml(error.message)}`;
});

updateGenerationCount();
