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
const logBox = document.querySelector("#logBox");
const jobId = document.querySelector("#jobId");

let currentJobId = "";
let currentOutputDir = "";
let productCatalog = [];
let pollTimer = null;
let pollFailures = 0;
let lastPollError = "";

const ACTIVE_JOB_STORAGE_KEY = "productShotGenerator.activeJobId";
const TERMINAL_STATUSES = ["success", "partial", "failed", "interrupted"];

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
}

function formData() {
  const data = Object.fromEntries(new FormData(form).entries());
  data.videoCount = Number(data.videoCount || 1);
  data.frameCheck = form.elements.frameCheck.checked;
  data.saveLogs = form.elements.saveLogs.checked;
  data.fallbackModels = data.fallbackModels === "true";
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
  const data = formData();
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
  const done = tasks.filter((task) => task.status === "success").length;
  const failed = tasks.filter((task) => task.status === "failed").length;
  const total = job.summary?.total || tasks.length || 0;
  const width = total ? Math.round(((done + failed) / total) * 100) : 0;
  progressText.textContent = `${done} / ${total}`;
  progressBar.style.width = `${width}%`;
  outputLine.textContent = job.outputDir || "准备输出目录";
  currentOutputDir = job.outputDir || "";
  openOutputButton.disabled = !currentOutputDir;
  formBadge.textContent = statusLabel(job.status);
  resultBadge.textContent = done ? `${done} 条成片` : "等待成片";

  taskList.innerHTML = tasks
    .map((task) => {
      const detail = task.error ? escapeHtml(task.error) : `${escapeHtml(task.productPurpose)} · ${escapeHtml(task.coreElement)}`;
      const model = task.model ? `<p>模型：${escapeHtml(task.model)}</p>` : "";
      const canvas = task.canvasUrl ? `<p><a href="${task.canvasUrl}" target="_blank" rel="noreferrer">打开画布</a></p>` : "";
      return `<article class="task-item">
        <span class="status ${task.status || "queued"}">${statusLabel(task.status)}</span>
        <h3>${String(task.index).padStart(2, "0")} · ${escapeHtml(task.coreElement || "待生成")}</h3>
        <p>${detail}</p>
        ${model}
        ${canvas}
      </article>`;
    })
    .join("");
}

function renderResults(job) {
  const tasks = (job.tasks || []).filter((task) => task.localPath);
  resultGrid.innerHTML = tasks
    .map((task) => {
      const src = `./api/file?path=${encodeURIComponent(task.localPath)}`;
      return `<article class="result-card">
        <video src="${src}" controls preload="metadata"></video>
        <div class="result-body">
          <h3>${escapeHtml(task.coreElement)}</h3>
          <a href="${src}" target="_blank">打开本地视频</a>
          <a href="${task.canvasUrl}" target="_blank" rel="noreferrer">LibTV 画布</a>
        </div>
      </article>`;
    })
    .join("");
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
    undefined: "待生成"
  }[String(status)] || "待生成";
}

function isTerminalStatus(status) {
  return TERMINAL_STATUSES.includes(String(status));
}

function clearPollTimer() {
  if (!pollTimer) return;
  clearInterval(pollTimer);
  pollTimer = null;
}

function setStartButtonForJob(job) {
  if (job && !isTerminalStatus(job.status)) {
    startButton.disabled = true;
    startButton.textContent = "生成中";
    return;
  }
  startButton.disabled = false;
  startButton.textContent = "开始生成";
}

function syncFormFromJob(job) {
  if (!job?.config) return;
  fillDefaults(job.config);
  if (job.config.productId && productCatalog.some((product) => product.id === job.config.productId)) {
    productSelect.value = job.config.productId;
  }
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
}

function beginPolling() {
  clearPollTimer();
  pollFailures = 0;
  lastPollError = "";
  pollTimer = setInterval(pollJob, 2400);
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
      startButton.textContent = "重新开始";
      resultBadge.textContent = "服务断开";
      logBox.textContent += "\n已停止自动刷新。重新打开AI视频工作台后再点击开始生成。";
    }
  }
}

async function startJob(event) {
  event.preventDefault();
  const data = formData();
  clearPollTimer();
  startButton.disabled = true;
  startButton.textContent = "生成中";
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
    rememberActiveJob(currentJobId);
    jobId.textContent = result.id;
    await pollJob();
    beginPolling();
  } catch (error) {
    startButton.disabled = false;
    startButton.textContent = "开始生成";
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
  const defaults = await api("./api/defaults");
  fillDefaults(defaults);
  hydrateProducts(defaults.products, defaults.productId);
  await refreshHealth();
  await checkUpdate({ silent: true });
  await previewImages();
  if (await restoreRecentJob({ syncForm: true })) {
    await previewImages();
  }
}

updateButton.addEventListener("click", () => checkUpdate());
applyUpdateButton.addEventListener("click", applyUpdate);
healthButton.addEventListener("click", refreshHealth);
restoreJobButton.addEventListener("click", async () => {
  restoreJobButton.disabled = true;
  try {
    if (await restoreRecentJob({ syncForm: true })) {
      await previewImages();
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
openOutputButton.addEventListener("click", openCurrentOutput);
productSelect.addEventListener("change", async () => {
  applySelectedProduct({ resetScene: true, resetPurpose: true });
  await previewImages();
});
form.addEventListener("submit", startJob);

boot().catch((error) => {
  accountLine.textContent = "启动异常";
  logBox.textContent = error.message;
});
