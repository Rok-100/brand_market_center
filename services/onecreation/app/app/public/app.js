const form = document.querySelector("#generatorForm");
const accountLine = document.querySelector("#accountLine");
const healthButton = document.querySelector("#healthButton");
const restoreJobButton = document.querySelector("#restoreJobButton");
const updateButton = document.querySelector("#updateButton");
const updatePanel = document.querySelector("#updatePanel");
const updateBadge = document.querySelector("#updateBadge");
const updateMessage = document.querySelector("#updateMessage");
const updateNotes = document.querySelector("#updateNotes");
const applyUpdateButton = document.querySelector("#applyUpdateButton");
const previewButton = document.querySelector("#previewButton");
const productSelect = document.querySelector("#productSelect");
const productImageField = document.querySelector("#productImageField");
const sourceFields = document.querySelector("#sourceFields");
const sceneDropZone = document.querySelector("#sceneDropZone");
const videoDropZone = document.querySelector("#videoDropZone");
const sceneFileInput = document.querySelector("#sceneFileInput");
const videoFileInput = document.querySelector("#videoFileInput");
const sceneUploadStatus = document.querySelector("#sceneUploadStatus");
const videoUploadStatus = document.querySelector("#videoUploadStatus");
const videoCountField = document.querySelector("#videoCountField");
const assetPanelTitle = document.querySelector("#assetPanelTitle");
const imageGrid = document.querySelector("#imageGrid");
const imageCount = document.querySelector("#imageCount");
const startButton = document.querySelector("#startButton");
const formBadge = document.querySelector("#formBadge");
const outputLine = document.querySelector("#outputLine");
const progressText = document.querySelector("#progressText");
const progressBar = document.querySelector("#progressBar");
const taskList = document.querySelector("#taskList");
const resultGrid = document.querySelector("#resultGrid");
const resultBadge = document.querySelector("#resultBadge");
const openOutputButton = document.querySelector("#openOutputButton");
const selectOutputDirButton = document.querySelector("#selectOutputDirButton");
const productHistoryList = document.querySelector("#productHistoryList");
const productHistoryBadge = document.querySelector("#productHistoryBadge");
const productHistoryRefresh = document.querySelector("#productHistoryRefresh");
const productHistoryToggle = document.querySelector("#productHistoryToggle");
const productHistoryToggleLabel = document.querySelector("#productHistoryToggleLabel");
const productHistoryBody = document.querySelector("#productHistoryBody");
const productHistoryPagination = document.querySelector("#productHistoryPagination");
const productHistoryPrev = document.querySelector("#productHistoryPrev");
const productHistoryNext = document.querySelector("#productHistoryNext");
const productHistoryPageNumbers = document.querySelector("#productHistoryPageNumbers");
const productHistoryPageStatus = document.querySelector("#productHistoryPageStatus");
const logBox = document.querySelector("#logBox");
const jobId = document.querySelector("#jobId");
const shotPreviewBadge = document.querySelector("#shotPreviewBadge");
const previewEmotionTitle = document.querySelector("#previewEmotionTitle");
const previewEmotionCopy = document.querySelector("#previewEmotionCopy");
const previewProduct = document.querySelector("#previewProduct");
const previewAction = document.querySelector("#previewAction");
const previewScene = document.querySelector("#previewScene");
const previewTruth = document.querySelector("#previewTruth");
let bootReady = false;

let currentJobId = "";
let currentOutputDir = "";
let productCatalog = [];
let pollTimer = null;
let pollFailures = 0;
let lastPollError = "";
let uploadedScene = null;
let uploadedVideos = [];
let uploadInFlight = 0;
let productHistoryJobs = [];
let productHistoryExpanded = false;
let productHistoryPage = 1;

const ACTIVE_JOB_STORAGE_KEY = "productShotGenerator.activeJobId";
const TERMINAL_STATUSES = ["success", "partial", "failed", "interrupted"];
const PRODUCT_HISTORY_PAGE_SIZE = 5;
const UPLOAD_SESSION_ID = globalThis.crypto?.randomUUID?.() || `upload-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const EMOTION_PREVIEWS = {
  "native-trust": {
    badge: "原生信任",
    title: "像刚好被我拍到",
    copy: "保留一点真实生活痕迹和轻微手持呼吸感，让产品像日常使用中的自然发现。"
  },
  "texture-surprise": {
    badge: "质地惊喜",
    title: "原来它是这种质地",
    copy: "镜头不急着解释，让薄、湿、软、透在一个真实动作里被看见。"
  },
  "bedtime-relief": {
    badge: "睡前松弛",
    title: "今晚终于松口气",
    copy: "用洗完脸后的安静时刻承接情绪，灯光柔和，生活痕迹自然，不刻意摆拍。"
  },
  "unboxing-anticipation": {
    badge: "开箱期待",
    title: "刚拆到手这一刻",
    copy: "把期待留在手指触碰和包装开启之间，5 秒只完成一次清楚、可信的动作。"
  },
  "abundance-satisfaction": {
    badge: "量感满足",
    title: "摆出来就很满足",
    copy: "用真实数量、整齐关系和克制推进带来踏实感，不复制、不凭空增加产品。"
  }
};
const PURPOSE_ACTIONS = {
  "生活种草": "像日常护理时顺手拿起产品，轻轻停在镜头前",
  "包装露出": "用一次缓慢侧移把包装正面和立体结构看清",
  "使用质地": "只完成一次取出、提起、挤出或推开的质地动作",
  "高级感": "从真实材质反光自然转焦到产品正面",
  "量感陈列": "让准确数量和整齐结构稳定进入画面",
  "冰感功效": "用冷色环境与真实凝露感表达清凉，不制造假冰和特效水",
  "真实开箱": "只完成一次打开、取出或揭开的连续动作",
  "送礼属性": "让包装与真实赠礼关系同框，慢慢停在完整产品上"
};

async function api(path, options = {}) {
  let response;
  try {
    response = await fetch(path, {
      headers: { "Content-Type": "application/json" },
      ...options
    });
  } catch {
    throw new Error("本地服务未连接。请保持“AI视频工作台”启动器窗口打开，或重新双击AI视频工作台.exe。");
  }

  let data = {};
  try {
    data = await response.json();
  } catch {
    data = {};
  }
  if (!response.ok) {
    throw new Error(data.error || data.message || `请求失败（${response.status}）`);
  }
  return data;
}

function rememberActiveJob(id) {
  try {
    if (id) localStorage.setItem(ACTIVE_JOB_STORAGE_KEY, id);
  } catch {
    // localStorage may be unavailable in locked-down browsers.
  }
}

function readRememberedJob() {
  try {
    return localStorage.getItem(ACTIVE_JOB_STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

function fillDefaults(defaults) {
  for (const [key, value] of Object.entries(defaults)) {
    const field = form.elements[key];
    if (!field) continue;
    if (field.type === "checkbox") {
      field.checked = Boolean(value);
    } else {
      field.value = value;
    }
  }
}

function hydrateProducts(products, selectedId) {
  productCatalog = Array.isArray(products) ? products : [];
  productSelect.innerHTML = productCatalog
    .map((product) => `<option value="${escapeHtml(product.id)}">${escapeHtml(product.name)}</option>`)
    .join("");
  if (productCatalog.length) {
    productSelect.value = selectedId || productCatalog[0].id;
    applySelectedProduct({ resetScene: false });
  }
}

function selectedProduct() {
  return productCatalog.find((product) => product.id === productSelect.value) || productCatalog[0];
}

function selectedEmotion() {
  return EMOTION_PREVIEWS[form.elements.emotionHook?.value] || EMOTION_PREVIEWS["native-trust"];
}

function renderShotPreview() {
  if (!shotPreviewBadge) return;
  const product = selectedProduct();
  const emotion = selectedEmotion();
  const purpose = form.elements.purpose?.value || "生活种草";
  const scene = String(form.elements.scene?.value || product?.defaultScene || "真实生活场景").trim();
  shotPreviewBadge.textContent = emotion.badge;
  previewEmotionTitle.textContent = emotion.title;
  previewEmotionCopy.textContent = emotion.copy;
  previewProduct.textContent = product?.shortName || product?.name || "正在读取产品";
  previewAction.textContent = PURPOSE_ACTIONS[purpose] || "只完成一个清楚、连续的真实动作";
  previewScene.textContent = scene || "真实生活场景";
  const truth = String(product?.visualIdentity || "").trim();
  previewTruth.textContent = truth
    ? `产品真值锁定：${truth}`
    : "包装、质地和数量会按真实产品资料自动锁定。";
}

function renderStartButton(label = "生成这组产品镜", subline = "5 秒竖屏 · 1–2 个连贯机位") {
  startButton.innerHTML = `<span>${escapeHtml(label)}</span><small>${escapeHtml(subline)}</small>`;
}

function isSceneVideoMode() {
  return form.elements.generationMode.value === "scene-video";
}

function applyGenerationMode(options = {}) {
  const sceneVideo = isSceneVideoMode();
  productImageField.hidden = sceneVideo;
  sourceFields.hidden = !sceneVideo;
  videoCountField.hidden = sceneVideo;
  assetPanelTitle.textContent = sceneVideo ? "上传素材" : "产品图";

  const liteOption = form.elements.modelMode.querySelector('option[value="lite"]');
  if (liteOption) liteOption.disabled = sceneVideo;
  if (sceneVideo && form.elements.modelMode.value === "lite") {
    form.elements.modelMode.value = "auto";
  }
  renderShotPreview();
  if (options.preview !== false) previewAssets();
}

function applySelectedProduct(options = {}) {
  const product = selectedProduct();
  if (!product) return;
  form.elements.productType.value = product.name;
  form.elements.imageDir.value = product.imageDir;
  if (options.resetScene !== false && product.defaultScene) {
    form.elements.scene.value = product.defaultScene;
  }
  if (product.defaultPurpose && options.resetPurpose) {
    form.elements.purpose.value = product.defaultPurpose;
  }
  renderShotPreview();
}

function formData() {
  const data = Object.fromEntries(new FormData(form).entries());
  const workstation = window.WorkbenchWorkstation.identity();
  data.workstationId = workstation.id;
  data.workstationLabel = workstation.label;
  data.videoCount = Number(data.videoCount || 1);
  data.frameCheck = form.elements.frameCheck.checked;
  data.saveLogs = form.elements.saveLogs.checked;
  data.fallbackModels = data.fallbackModels === "true";
  data.sceneImagePath = uploadedScene?.path || "";
  data.sceneImageName = uploadedScene?.name || "";
  data.sourceVideoPath = "";
  data.sourceVideoPaths = uploadedVideos.map((item) => item.path);
  data.sourceVideoNames = uploadedVideos.map((item) => item.name);
  return data;
}

function basename(filePath) {
  return String(filePath).split(/[\\/]/).pop();
}

async function refreshHealth() {
  accountLine.textContent = "正在连接 LibTV";
  try {
    const health = await api("./api/health");
    const user = health.account?.user?.nickname || "已登录";
    const account = health.account?.activeAccount?.accountName || "";
    accountLine.textContent = account ? `${user} · ${account}` : user;
  } catch (error) {
    accountLine.textContent = error.message.includes("本地服务未连接") ? "本地服务未连接" : "LibTV 未登录";
  }
}

function renderUpdateStatus(status, options = {}) {
  if (!updatePanel) return;
  const shouldShow = !options.silent || status.updateAvailable || !status.configured;
  if (!shouldShow) return;

  updatePanel.hidden = false;
  updateBadge.textContent = status.updateAvailable ? "有新版本" : status.configured ? "已最新" : "未配置";
  applyUpdateButton.disabled = !status.updateAvailable;
  const current = status.currentVersion || "-";
  const latest = status.latestVersion || "-";
  updateMessage.textContent = status.message
    ? `${status.message}。当前版本 ${current}，最新版本 ${latest}。`
    : `当前版本 ${current}，最新版本 ${latest}。`;
  updateNotes.innerHTML = (status.notes || [])
    .map((note) => `<li>${escapeHtml(note)}</li>`)
    .join("");
}

async function checkUpdate(options = {}) {
  updateButton.disabled = true;
  if (!options.silent) {
    updatePanel.hidden = false;
    updateBadge.textContent = "检查中";
    updateMessage.textContent = "正在读取更新源。";
    updateNotes.innerHTML = "";
    applyUpdateButton.disabled = true;
  }
  try {
    const status = await api("./api/update/check");
    renderUpdateStatus(status, options);
  } catch (error) {
    if (!options.silent) {
      updatePanel.hidden = false;
      updateBadge.textContent = "检查失败";
      updateMessage.textContent = error.message;
      updateNotes.innerHTML = "";
      applyUpdateButton.disabled = true;
    }
  } finally {
    updateButton.disabled = false;
  }
}

async function applyUpdate() {
  applyUpdateButton.disabled = true;
  updateButton.disabled = true;
  updatePanel.hidden = false;
  updateBadge.textContent = "更新中";
  updateMessage.textContent = "正在安装更新包，请不要关闭AI视频工作台。";
  updateNotes.innerHTML = "";
  try {
    const result = await api("./api/update/apply", { method: "POST" });
    updateBadge.textContent = result.skipped ? "已最新" : "已安装";
    updateMessage.textContent = result.restartRequired
      ? "更新已安装。关闭并重新打开AI视频工作台后生效。"
      : result.message || "当前已是最新版本。";
    applyUpdateButton.disabled = true;
  } catch (error) {
    updateBadge.textContent = "更新失败";
    updateMessage.textContent = error.message;
    applyUpdateButton.disabled = false;
  } finally {
    updateButton.disabled = false;
  }
}

async function previewImages() {
  const data = window.WorkbenchKnowledge.enrich(formData());
  imageGrid.innerHTML = "";
  imageCount.textContent = "读取中";
  try {
    const result = await api("./api/images", {
      method: "POST",
      body: JSON.stringify({ productId: data.productId, imageDir: data.imageDir })
    });
    imageCount.textContent = `${result.files.length} 张`;
    if (!result.files.length) {
      imageGrid.innerHTML = `<div class="task-item"><h3>未找到图片</h3><p>支持 png、jpg、webp。</p></div>`;
      return;
    }
    imageGrid.innerHTML = result.files
      .map((file) => {
        const src = `./api/image?path=${encodeURIComponent(file)}`;
        return `<article class="image-card"><img src="${src}" alt="${basename(file)}" /><p title="${file}">${basename(file)}</p></article>`;
      })
      .join("");
  } catch (error) {
    imageCount.textContent = "读取失败";
    imageGrid.innerHTML = `<div class="task-item"><h3>产品图读取失败</h3><p>${escapeHtml(error.message)}</p></div>`;
  }
}

function humanFileSize(bytes) {
  const value = Number(bytes || 0);
  if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${value} B`;
}

const PROXY_SAFE_UPLOAD_CHUNK_BYTES = 768 * 1024;

async function uploadResponseData(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

async function uploadAssetInChunks(file, kind) {
  const uploadId = globalThis.crypto?.randomUUID?.() || `chunk-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const totalChunks = Math.ceil(file.size / PROXY_SAFE_UPLOAD_CHUNK_BYTES);
  let result = {};
  for (let index = 0; index < totalChunks; index += 1) {
    const query = new URLSearchParams({
      kind,
      name: file.name,
      session: UPLOAD_SESSION_ID,
      uploadId,
      index: String(index),
      totalChunks: String(totalChunks),
      totalSize: String(file.size)
    });
    const start = index * PROXY_SAFE_UPLOAD_CHUNK_BYTES;
    const body = file.slice(start, Math.min(file.size, start + PROXY_SAFE_UPLOAD_CHUNK_BYTES));
    const response = await fetch(`./api/upload/chunk?${query}`, { method: "POST", body });
    result = await uploadResponseData(response);
    if (!response.ok) throw new Error(result.error || `素材分片上传失败（${response.status}）`);
  }
  return result;
}

async function uploadAsset(file, kind) {
  const query = new URLSearchParams({
    kind,
    name: file.name,
    session: UPLOAD_SESSION_ID
  });
  let response;
  try {
    response = await fetch(`./api/upload?${query}`, { method: "POST", body: file });
  } catch {
    throw new Error("本地服务未连接，素材上传失败");
  }
  if (response.status === 413 && file.size > PROXY_SAFE_UPLOAD_CHUNK_BYTES) {
    return uploadAssetInChunks(file, kind);
  }
  const result = await uploadResponseData(response);
  if (!response.ok) throw new Error(result.error || `素材上传失败（${response.status}）`);
  return result;
}

async function removeTemporaryUpload(filePath) {
  if (!filePath) return;
  try {
    await api("./api/upload/delete", {
      method: "POST",
      body: JSON.stringify({ path: filePath })
    });
  } catch {
    // Removing the item from this batch is enough; stale temporary files are harmless.
  }
}

function renderSourceAssets() {
  sceneUploadStatus.textContent = uploadedScene ? "已上传" : uploadInFlight ? "上传中" : "可选";
  videoUploadStatus.textContent = uploadedVideos.length ? `${uploadedVideos.length} 条` : uploadInFlight ? "上传中" : "可选";
  imageCount.textContent = `${uploadedScene ? 1 : 0} 图 · ${uploadedVideos.length} 视频`;

  const sceneCard = uploadedScene
    ? `<article class="image-card scene-image-card">
        <div class="asset-media">
          <img src="./api/image?path=${encodeURIComponent(uploadedScene.path)}" alt="${escapeHtml(uploadedScene.name)}" />
          <button class="asset-remove" type="button" data-kind="scene" title="移除场景图" aria-label="移除场景图">×</button>
        </div>
        <p title="${escapeHtml(uploadedScene.name)}">场景图 · ${escapeHtml(uploadedScene.name)}</p>
      </article>`
    : "";
  const videoCards = uploadedVideos
    .map((item, index) => `<article class="image-card source-video-card">
      <div class="asset-media">
        <video src="./api/file?path=${encodeURIComponent(item.path)}" controls muted preload="metadata"></video>
        <button class="asset-remove" type="button" data-kind="video" data-index="${index}" title="移除原始视频" aria-label="移除${escapeHtml(item.name)}">×</button>
      </div>
      <p title="${escapeHtml(item.name)}">${String(index + 1).padStart(2, "0")} · ${escapeHtml(item.name)} · ${humanFileSize(item.size)}</p>
    </article>`)
    .join("");
  imageGrid.innerHTML = sceneCard + videoCards;
}

async function uploadSelectedFiles(kind, fileList) {
  const files = Array.from(fileList || []);
  if (!files.length) return;
  const isScene = kind === "scene";
  const allowed = isScene ? /\.(png|jpe?g|webp)$/i : /\.(mp4|mov|m4v|webm)$/i;
  const selected = isScene ? files.slice(0, 1) : files;
  const invalid = selected.find((file) => !allowed.test(file.name));
  if (invalid) {
    logBox.textContent = `${invalid.name} 格式不支持`;
    return;
  }

  uploadInFlight += 1;
  const zone = isScene ? sceneDropZone : videoDropZone;
  zone.classList.add("is-uploading");
  try {
    if (isScene) {
      sceneUploadStatus.textContent = "上传中";
      const previous = uploadedScene;
      uploadedScene = await uploadAsset(selected[0], "scene");
      await removeTemporaryUpload(previous?.path);
    } else {
      for (let i = 0; i < selected.length; i += 1) {
        videoUploadStatus.textContent = `上传中 ${i + 1}/${selected.length}`;
        uploadedVideos.push(await uploadAsset(selected[i], "video"));
        renderSourceAssets();
      }
    }
  } catch (error) {
    logBox.textContent = error.message;
  } finally {
    uploadInFlight = Math.max(0, uploadInFlight - 1);
    zone.classList.remove("is-uploading");
    sceneFileInput.value = "";
    videoFileInput.value = "";
    renderSourceAssets();
  }
}

function bindDropZone(zone, input, kind) {
  for (const eventName of ["dragenter", "dragover"]) {
    zone.addEventListener(eventName, (event) => {
      event.preventDefault();
      zone.classList.add("is-dragging");
    });
  }
  for (const eventName of ["dragleave", "drop"]) {
    zone.addEventListener(eventName, (event) => {
      event.preventDefault();
      zone.classList.remove("is-dragging");
    });
  }
  zone.addEventListener("drop", (event) => uploadSelectedFiles(kind, event.dataTransfer?.files));
  input.addEventListener("change", () => uploadSelectedFiles(kind, input.files));
}

async function removeUploadedAsset(button) {
  const kind = button.dataset.kind;
  if (kind === "scene") {
    const previous = uploadedScene;
    uploadedScene = null;
    renderSourceAssets();
    await removeTemporaryUpload(previous?.path);
    return;
  }
  const index = Number(button.dataset.index);
  if (!Number.isInteger(index) || index < 0 || index >= uploadedVideos.length) return;
  const [removed] = uploadedVideos.splice(index, 1);
  renderSourceAssets();
  await removeTemporaryUpload(removed?.path);
}

function previewAssets() {
  if (isSceneVideoMode()) {
    renderSourceAssets();
    return Promise.resolve();
  }
  return previewImages();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderTasks(job) {
  const tasks = job.tasks || [];
  const done = tasks.filter((task) => task.localPath).length;
  const passed = tasks.filter((task) => task.status === "success").length;
  const failed = tasks.filter((task) => task.status === "failed").length;
  const reviewRequired = tasks.filter((task) => task.status === "review_required").length;
  const total = job.summary?.total || tasks.length || 0;
  const completed = tasks.filter((task) => task.localPath || ["failed", "review_required", "success"].includes(task.status)).length;
  const width = total ? Math.round((completed / total) * 100) : 0;
  progressText.textContent = `${done} / ${total} 可播放`;
  progressBar.style.width = `${width}%`;
  outputLine.textContent = job.outputDir || "准备输出目录";
  currentOutputDir = job.outputDir || "";
  openOutputButton.disabled = !currentOutputDir;
  formBadge.textContent = statusLabel(job.status);
  resultBadge.textContent = done ? `${done} 条成片 · ${passed} 条质检通过` : "等待成片";

  taskList.innerHTML = tasks
    .map((task) => {
      const title = productTaskTitle(task);
      const context = task.sourceVideoName
        ? `参考素材 · ${escapeHtml(task.sourceVideoName)} · 严格结构跟随`
        : `${escapeHtml(task.productPurpose)} · ${escapeHtml(task.sceneName || job.config?.scene || "场景未记录")} · ${escapeHtml(task.actionName || task.coreElement || "动作未记录")}`;
      const detail = task.error
        ? `${context}<br>${escapeHtml(task.error)}`
        : context;
      const model = task.model ? `<p>模型：${escapeHtml(task.model)}</p>` : "";
      const quality = task.quality?.status
        ? `<p>连续性与物理质检：${escapeHtml(task.quality.status === "passed" ? "通过" : task.quality.status === "rejected" ? "未通过" : "待人工复核")}</p>`
        : "";
      const canvas = task.canvasUrl ? `<p><a href="${task.canvasUrl}" target="_blank" rel="noreferrer">打开画布</a></p>` : "";
      return `<article class="task-item">
        <span class="status ${task.status || "queued"}">${statusLabel(task.status)}</span>
        <h3>${String(task.index).padStart(2, "0")} · ${escapeHtml(title)}</h3>
        <p>${detail}</p>
        ${model}
        ${quality}
        ${canvas}
      </article>`;
    })
    .join("");
}

function renderResults(job) {
  const tasks = (job.tasks || []).filter((task) => task.localPath);
  const currentCards = new Map(
    [...resultGrid.querySelectorAll("[data-result-index]")].map((card) => [card.dataset.resultIndex, card])
  );
  tasks.forEach((task) => {
    const key = String(task.index);
    const src = `./api/file?path=${encodeURIComponent(task.localPath)}`;
    const existing = currentCards.get(key);
    if (existing?.dataset.localPath === task.localPath) {
      currentCards.delete(key);
      return;
    }
    const wrapper = document.createElement("div");
    const qualityIssues = Array.isArray(task.quality?.issues) ? task.quality.issues : [];
    const qualityState = task.quality?.status === "passed"
      ? '<p class="result-quality passed">连续性与真实物理质检通过</p>'
      : task.quality?.status
        ? `<p class="result-quality warning">需要人工复核：${escapeHtml(qualityIssues.join("；") || task.error || "自动质检暂不可用")}</p>`
        : "";
    const retryButton = ["failed", "review_required"].includes(task.status)
      ? `<button type="button" class="secondary product-retry" data-task-index="${escapeHtml(key)}">重新生成本条</button>`
      : "";
    wrapper.innerHTML = `<article class="result-card" data-result-index="${escapeHtml(key)}">
         <video src="${src}" controls preload="metadata"></video>
         <div class="result-body">
           <h3>${escapeHtml(productTaskTitle(task))}</h3>
           ${qualityState}
           <a href="${src}" target="_blank">打开本地视频</a>
           <a href="${task.canvasUrl}" target="_blank" rel="noreferrer">LibTV 画布</a>
           ${retryButton}
         </div>
       </article>`;
    const nextCard = wrapper.firstElementChild;
    nextCard.dataset.localPath = task.localPath;
    if (existing) existing.replaceWith(nextCard);
    else resultGrid.appendChild(nextCard);
    currentCards.delete(key);
  });
  currentCards.forEach((card) => card.remove());
}

function renderLogs(job) {
  const logs = job.logs || [];
  logBox.textContent = logs.map((log) => `[${timeOnly(log.at)}] ${log.message}`).join("\n");
  logBox.scrollTop = logBox.scrollHeight;
}

function timeOnly(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("zh-CN", { hour12: false });
}

function statusLabel(status) {
  return {
    queued: "排队中",
    running: "生成中",
    success: "已完成",
    partial: "部分完成",
    failed: "失败",
    interrupted: "已中断",
    quality_checking: "物理质检中",
    review_required: "待人工复核",
    undefined: "待生成"
  }[String(status)] || "待生成";
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

function syncProductHistoryDisclosure() {
  productHistoryBody.hidden = !productHistoryExpanded;
  productHistoryToggle.setAttribute("aria-expanded", String(productHistoryExpanded));
  productHistoryToggleLabel.textContent = productHistoryExpanded ? "收起任务列表" : "展开任务列表";
  productHistoryToggle.classList.toggle("expanded", productHistoryExpanded);
}

function setProductHistoryPage(page) {
  const pageCount = Math.max(1, Math.ceil(productHistoryJobs.length / PRODUCT_HISTORY_PAGE_SIZE));
  productHistoryPage = Math.min(pageCount, Math.max(1, Number(page) || 1));
  renderProductHistory();
}

function renderProductHistoryPagination(pageCount) {
  const showPagination = productHistoryJobs.length > PRODUCT_HISTORY_PAGE_SIZE;
  productHistoryPagination.hidden = !showPagination;
  productHistoryPrev.disabled = productHistoryPage <= 1;
  productHistoryNext.disabled = productHistoryPage >= pageCount;
  productHistoryPageStatus.textContent = `第 ${productHistoryPage} / ${pageCount} 页`;
  productHistoryPageNumbers.innerHTML = Array.from({ length: pageCount }, (_, index) => {
    const page = index + 1;
    const current = page === productHistoryPage;
    return `<button type="button" data-product-history-page="${page}" ${current ? 'aria-current="page"' : ""}>${page}</button>`;
  }).join("");
}

function renderProductHistory(rows = productHistoryJobs) {
  productHistoryJobs = Array.isArray(rows) ? rows : [];
  productHistoryBadge.textContent = `${productHistoryJobs.length}个任务`;
  syncProductHistoryDisclosure();
  if (!productHistoryJobs.length) {
    productHistoryList.innerHTML = '<p class="empty-line">还没有产品镜任务。</p>';
    productHistoryPagination.hidden = true;
    return;
  }
  const pageCount = Math.max(1, Math.ceil(productHistoryJobs.length / PRODUCT_HISTORY_PAGE_SIZE));
  productHistoryPage = Math.min(pageCount, Math.max(1, productHistoryPage));
  const pageStart = (productHistoryPage - 1) * PRODUCT_HISTORY_PAGE_SIZE;
  const visibleJobs = productHistoryJobs.slice(pageStart, pageStart + PRODUCT_HISTORY_PAGE_SIZE);
  productHistoryList.innerHTML = visibleJobs.map((job) => {
    const emotionKey = job.emotionHook || job.config?.emotionHook || "native-trust";
    const emotionLabel = EMOTION_PREVIEWS[emotionKey]?.badge || "原生产品镜";
    const total = Number(job.summary?.total || job.videoCount || 0);
    const ready = Number(job.readyCount || job.summary?.success || 0);
    const isCurrent = job.id === currentJobId;
    return `
      <button class="variation-history-row ${isCurrent ? "current" : ""}" type="button" data-product-history-job="${escapeHtml(job.id)}">
        <span><b>${escapeHtml(job.productType || "产品镜任务")}</b><small>${escapeHtml(emotionLabel)} · ${escapeHtml(job.purpose || "产品镜生成")} · ${escapeHtml(job.scene || "场景未记录")}</small></span>
        <span><b>${formatHistoryTime(job.createdAt)}</b><small>${ready}/${total || "-"}条可播放${job.reviewRequiredCount ? ` · ${job.reviewRequiredCount}条待复核` : ""}</small></span>
        <em>${isCurrent ? "当前查看" : statusLabel(job.status)}</em>
      </button>`;
  }).join("");
  renderProductHistoryPagination(pageCount);
  productHistoryList.querySelectorAll("[data-product-history-job]").forEach((button) => {
    button.addEventListener("click", async () => {
      clearPollTimer();
      try {
        await restoreJob(button.dataset.productHistoryJob, { syncForm: true });
        await previewAssets();
        renderProductHistory();
        document.querySelector(".run-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
      } catch (error) {
        logBox.textContent = error.message;
      }
    });
  });
}

async function refreshProductHistory() {
  productHistoryRefresh.disabled = true;
  try {
    const rows = await api("./api/jobs?limit=50");
    renderProductHistory(rows);
    return rows;
  } catch (error) {
    productHistoryBadge.textContent = "读取失败";
    productHistoryList.innerHTML = `<p class="empty-line">${escapeHtml(error.message)}</p>`;
    return [];
  } finally {
    productHistoryRefresh.disabled = false;
  }
}

async function selectOutputDirectory() {
  selectOutputDirButton.disabled = true;
  selectOutputDirButton.textContent = "请选择…";
  try {
    const result = await api("./api/output-directory/select", {
      method: "POST",
      body: JSON.stringify({ initialPath: form.elements.outputDir.value.trim() })
    });
    if (!result.cancelled && result.path) {
      form.elements.outputDir.value = result.path;
      logBox.textContent = `输出位置已设置为：${result.path}`;
    }
  } catch (error) {
    logBox.textContent = error.message;
  } finally {
    selectOutputDirButton.disabled = false;
    selectOutputDirButton.textContent = "选择位置";
  }
}

async function retryProductTask(button) {
  if (!currentJobId) return;
  const taskIndex = button.dataset.taskIndex;
  button.disabled = true;
  button.textContent = "正在重新生成…";
  try {
    await api(`./api/jobs/${currentJobId}/retry/${taskIndex}`, { method: "POST" });
    beginPolling();
  } catch (error) {
    button.disabled = false;
    button.textContent = "重新生成本条";
    alert(error.message);
  }
}

function isTerminalStatus(status) {
  return TERMINAL_STATUSES.includes(String(status));
}

function productTaskTitle(task = {}) {
  return String(task.displayName || task.sourceVideoName || task.coreElement || "待生成");
}

function jobReadyForNextBatch(job) {
  if (!job) return true;
  if (isTerminalStatus(job.status)) return true;
  const tasks = Array.isArray(job.tasks) ? job.tasks : [];
  const total = Number(job.summary?.total || tasks.length || 0);
  return total > 0 && tasks.length >= total && tasks.every((task) => Boolean(task.localPath));
}

function clearPollTimer() {
  if (!pollTimer) return;
  clearInterval(pollTimer);
  pollTimer = null;
}

function setStartButtonForJob(job) {
  if (!jobReadyForNextBatch(job)) {
    startButton.disabled = true;
    renderStartButton("正在生成", "请保持工作台开启，完成后会自动出现");
    return;
  }
  startButton.disabled = false;
  if (job && !isTerminalStatus(job.status)) {
    renderStartButton("生成下一批", "上一批已全部可播放，后台质检继续运行");
    return;
  }
  renderStartButton();
}

function syncFormFromJob(job) {
  if (!job?.config) return;
  fillDefaults(job.config);
  if (job.config.productId && productCatalog.some((product) => product.id === job.config.productId)) {
    productSelect.value = job.config.productId;
  }
  if (job.config.generationMode === "scene-video") {
    uploadedScene = job.config.sceneImagePath
      ? { path: job.config.sceneImagePath, name: job.config.sceneImageName || basename(job.config.sceneImagePath), size: 0 }
      : null;
    const videoPaths = Array.isArray(job.config.sourceVideoPaths) ? job.config.sourceVideoPaths : [];
    uploadedVideos = videoPaths.map((filePath, index) => ({
      path: filePath,
      name: job.config.sourceVideoNames?.[index] || basename(filePath),
      size: 0
    }));
  } else {
    uploadedScene = null;
    uploadedVideos = [];
  }
  applyGenerationMode({ preview: false });
  renderShotPreview();
}

function renderJob(job, options = {}) {
  currentJobId = job.id || "";
  rememberActiveJob(currentJobId);
  jobId.textContent = currentJobId || "无任务";
  if (options.syncForm) syncFormFromJob(job);
  renderTasks(job);
  renderResults(job);
  renderLogs(job);
  setStartButtonForJob(job);
  renderProductHistory();
}

function beginPolling() {
  clearPollTimer();
  pollFailures = 0;
  lastPollError = "";
  pollTimer = setInterval(pollJob, 1200);
}

async function fetchLatestJobId() {
  const rows = await api("./api/jobs?limit=1");
  return rows?.[0]?.id || "";
}

async function restoreJob(id, options = {}) {
  if (!id) return false;
  const job = await api(`./api/jobs/${id}`);
  renderJob(job, { syncForm: options.syncForm !== false });
  if (!isTerminalStatus(job.status)) beginPolling();
  return true;
}

async function restoreRecentJob(options = {}) {
  const rememberedId = readRememberedJob();
  const latestId = await fetchLatestJobId();
  const candidates = [rememberedId, latestId].filter(Boolean);
  for (const id of [...new Set(candidates)]) {
    try {
      if (await restoreJob(id, options)) return true;
    } catch {
      // Try the next candidate. The visible log stays focused on the active job.
    }
  }
  return false;
}

async function pollJob() {
  if (!currentJobId) return;
  try {
    const job = await api(`./api/jobs/${currentJobId}`);
    pollFailures = 0;
    lastPollError = "";
    renderJob(job, { syncForm: false });
    if (isTerminalStatus(job.status)) {
      clearPollTimer();
      await refreshProductHistory();
    }
  } catch (error) {
    pollFailures += 1;
    const message = error.message === "Job not found" ? "任务记录已失效，请重新开始生成。" : error.message;
    formBadge.textContent = "服务断开";
    if (message !== lastPollError) {
      logBox.textContent += `${logBox.textContent ? "\n" : ""}${message}`;
      lastPollError = message;
    }
    if (pollFailures >= 3) {
      clearPollTimer();
      startButton.disabled = false;
      renderStartButton("重新开始", "服务已断开，检查后可再次提交");
      resultBadge.textContent = "服务断开";
      logBox.textContent += "\n已停止自动刷新。重新打开AI视频工作台后再点击开始生成。";
    }
  }
}

async function startJob(event) {
  event.preventDefault();
  if (!bootReady) {
    formBadge.textContent = "正在恢复";
    logBox.textContent = "正在读取产品资料与上一批任务，请稍候再开始生成。";
    return;
  }
  const data = formData();
  if (isSceneVideoMode() && uploadInFlight > 0) {
    formBadge.textContent = "素材上传中";
    logBox.textContent = "素材还在上传，请上传完成后再开始生成。";
    return;
  }
  if (isSceneVideoMode() && !data.sceneImagePath && !data.sourceVideoPaths.length) {
    formBadge.textContent = "缺少素材";
    logBox.textContent = "请至少拖入一张场景图或一条原始视频。";
    return;
  }
  clearPollTimer();
  startButton.disabled = true;
  renderStartButton("正在提交", "先锁定产品真值，再进入生成");
  formBadge.textContent = "提交中";
  pollFailures = 0;
  lastPollError = "";
  currentOutputDir = "";
  openOutputButton.disabled = true;
  resultGrid.innerHTML = "";
  taskList.innerHTML = "";
  logBox.textContent = "";
  try {
    const result = await api("./api/jobs", {
      method: "POST",
      body: JSON.stringify(data)
    });
    currentJobId = result.id;
    window.WorkbenchKnowledge.record("generation_started", result.id, { mode: "product" });
    rememberActiveJob(currentJobId);
    jobId.textContent = result.id;
    productHistoryPage = 1;
    await refreshProductHistory();
    await pollJob();
    beginPolling();
  } catch (error) {
    startButton.disabled = false;
    renderStartButton();
    formBadge.textContent = "提交失败";
    logBox.textContent = error.message;
  }
}

async function openCurrentOutput() {
  if (!currentJobId || !currentOutputDir) return;
  openOutputButton.disabled = true;
  try {
    await api(`./api/jobs/${currentJobId}/open-output`, { method: "POST" });
  } catch (error) {
    logBox.textContent += `${logBox.textContent ? "\n" : ""}${error.message}`;
  } finally {
    openOutputButton.disabled = false;
  }
}

async function boot() {
  bootReady = false;
  startButton.disabled = true;
  formBadge.textContent = "正在恢复";
  renderStartButton("正在读取", "产品资料和上一批任务加载完成后即可生成");
  const defaults = await api("./api/defaults");
  fillDefaults(defaults);
  hydrateProducts(defaults.products, defaults.productId);
  applyGenerationMode({ preview: false });
  await refreshHealth();
  await checkUpdate({ silent: true });
  await previewAssets();
  await refreshProductHistory();
  const restored = await restoreRecentJob({ syncForm: true });
  if (restored) {
    await previewAssets();
  }
  bootReady = true;
  if (!restored) {
    startButton.disabled = false;
    formBadge.textContent = "待生成";
    renderStartButton();
  }
}

updateButton.addEventListener("click", () => checkUpdate());
applyUpdateButton.addEventListener("click", applyUpdate);
healthButton.addEventListener("click", refreshHealth);
restoreJobButton.addEventListener("click", async () => {
  restoreJobButton.disabled = true;
  try {
    if (await restoreRecentJob({ syncForm: true })) {
      await previewAssets();
    } else {
      logBox.textContent = "还没有可恢复的任务。";
    }
  } catch (error) {
    logBox.textContent = error.message;
  } finally {
    restoreJobButton.disabled = false;
  }
});
previewButton.addEventListener("click", previewImages);
bindDropZone(sceneDropZone, sceneFileInput, "scene");
bindDropZone(videoDropZone, videoFileInput, "video");
imageGrid.addEventListener("click", (event) => {
  const button = event.target.closest(".asset-remove");
  if (button) removeUploadedAsset(button);
});
resultGrid.addEventListener("click", (event) => {
  const button = event.target.closest(".product-retry");
  if (button) retryProductTask(button);
});
openOutputButton.addEventListener("click", openCurrentOutput);
selectOutputDirButton.addEventListener("click", selectOutputDirectory);
productHistoryRefresh.addEventListener("click", refreshProductHistory);
productHistoryToggle.addEventListener("click", () => {
  productHistoryExpanded = !productHistoryExpanded;
  syncProductHistoryDisclosure();
});
productHistoryPrev.addEventListener("click", () => setProductHistoryPage(productHistoryPage - 1));
productHistoryNext.addEventListener("click", () => setProductHistoryPage(productHistoryPage + 1));
productHistoryPageNumbers.addEventListener("click", (event) => {
  const button = event.target.closest("[data-product-history-page]");
  if (button) setProductHistoryPage(button.dataset.productHistoryPage);
});
productSelect.addEventListener("change", async () => {
  applySelectedProduct({ resetScene: true, resetPurpose: true });
  await previewAssets();
});
form.elements.purpose.addEventListener("change", renderShotPreview);
form.elements.scene.addEventListener("input", renderShotPreview);
for (const field of form.querySelectorAll('input[name="emotionHook"]')) {
  field.addEventListener("change", renderShotPreview);
}
for (const field of form.querySelectorAll('input[name="generationMode"]')) {
  field.addEventListener("change", () => applyGenerationMode());
}
form.addEventListener("submit", startJob);

boot().catch((error) => {
  bootReady = false;
  startButton.disabled = true;
  accountLine.textContent = "启动异常";
  formBadge.textContent = "启动异常";
  renderStartButton("暂不能生成", "请刷新页面或检查本地服务");
  logBox.textContent = error.message;
});
