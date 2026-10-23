const statusTitle = document.querySelector("#hubStatusTitle");
const statusText = document.querySelector("#hubStatusText");
const statusBox = document.querySelector("#hubStatus");
const versionLine = document.querySelector("#hubVersion");
const updateTitle = document.querySelector("#hubUpdateTitle");
const updateText = document.querySelector("#hubUpdateText");
const updateNotes = document.querySelector("#hubUpdateNotes");
const personStudioEntry = document.querySelector("#personStudioEntry");
const personStudioTag = document.querySelector("#personStudioTag");
const authUserLine = document.querySelector("#hubAuthUser");
const logoutButton = document.querySelector("#hubLogout");
const providerAuthButton = document.querySelector("#hubProviderAuth");
const providerGuide = document.querySelector("#hubProviderGuide");
const providerGuideStatus = document.querySelector("#hubProviderGuideStatus");
const libtvGuide = document.querySelector("#hubLibtvGuide");
const libtvGuideStatus = document.querySelector("#hubLibtvGuideStatus");
const accessSummary = document.querySelector("#hubAccessSummary");
const PERSONAL_TASK_ACCOUNT_KEY = "workbench-personal-task-account-v1";
const PERSONAL_TASK_STORAGE_KEYS = [
  "ai-product-studio-current-task-v1",
  "ai-product-studio-task-draft-v1",
  "ai-product-studio-task-state-v1",
  "one-click-replacement-current-task-v1",
  "one-click-replacement-draft-v1"
];

// 首页可见性与业务路由解耦：隐藏入口继续保留代码、进度和权限键，后续可按权限重新开放。
const CREATION_ENTRY_VISIBILITY = Object.freeze({
  product: true,
  remake: true,
  koc: true,
  replacement: false,
  variation: false,
  person: false
});

function applyCreationEntryVisibility(visibility = CREATION_ENTRY_VISIBILITY) {
  document.querySelectorAll("[data-creation-entry]").forEach((entry) => {
    const visible = visibility[entry.dataset.mode] === true;
    entry.hidden = !visible;
    entry.setAttribute("aria-hidden", String(!visible));
    entry.dataset.entryState = visible ? "visible" : "reserved";
  });
}

function clearPersonalTaskStorage() {
  PERSONAL_TASK_STORAGE_KEYS.forEach((key) => localStorage.removeItem(key));
}

function syncPersonalTaskAccount(user = {}) {
  const accountId = String(user.larkUserId || user.id || "").trim();
  if (!accountId) return;
  const previousAccountId = localStorage.getItem(PERSONAL_TASK_ACCOUNT_KEY) || "";
  if (!previousAccountId || previousAccountId !== accountId) clearPersonalTaskStorage();
  localStorage.setItem(PERSONAL_TASK_ACCOUNT_KEY, accountId);
}
const libtvLoginButton = document.querySelector("#hubLibtvLogin");
const homeUpdateButton = document.querySelector("#hubUpdateButton");
const libtvLoginDialog = document.querySelector("#libtvLoginDialog");
const libtvLoginForm = document.querySelector("#libtvLoginForm");
const libtvLoginClose = document.querySelector("#libtvLoginClose");
const libtvPhoneStep = document.querySelector("#libtvPhoneStep");
const libtvPhoneInput = document.querySelector("#libtvPhone");
const libtvCodeInput = document.querySelector("#libtvCode");
const libtvCodeStep = document.querySelector("#libtvCodeStep");
const libtvLoginMessage = document.querySelector("#libtvLoginMessage");
const libtvSendCodeButton = document.querySelector("#libtvSendCode");
const libtvVerifyCodeButton = document.querySelector("#libtvVerifyCode");
const libtvLogoutButton = document.querySelector("#libtvLogout");
const libtvAccountStep = document.querySelector("#libtvAccountStep");
const libtvAccountSelect = document.querySelector("#libtvAccountSelect");
const libtvSwitchAccountButton = document.querySelector("#libtvSwitchAccount");
let libtvResendTimer = null;
let providerConnected = null;
let libtvConnected = null;
let libtvHealth = null;

function renderAccessGuide() {
  const providerReady = providerConnected === true;
  const libtvReady = libtvConnected === true;
  providerGuide?.classList.toggle("is-ready", providerReady);
  libtvGuide?.classList.toggle("is-ready", libtvReady);
  if (providerGuideStatus) {
    providerGuideStatus.textContent = providerConnected === null
      ? "正在检查"
      : providerReady ? "已连接" : "待授权";
  }
  if (libtvGuideStatus) {
    libtvGuideStatus.textContent = libtvConnected === null
      ? "正在检查"
      : libtvReady ? "已登录" : "待登录";
  }
  const ready = providerReady && libtvReady;
  accessSummary?.classList.toggle("is-ready", ready);
  if (accessSummary) {
    accessSummary.textContent = ready
      ? "授权准备完成，可以开始一创制作"
      : providerConnected === null || libtvConnected === null
        ? "正在检查两项授权…"
        : `还需完成${[providerReady ? "" : " FanDo 授权", libtvReady ? "" : " LibTV 登录"].filter(Boolean).join(" 和")}`;
  }
}

const FALLBACK_UPDATE_NOTES = [
  "千川推送升级为官方 OAuth 与 API，不再复制登录 Cookie",
  "抖店管理账户自动展开关联广告账户，支持搜索和多选",
  "同一成片可批量上传多个账户，逐账户显示结果并重试失败项",
  "上传素材与关联计划分开操作，始终保留人工审核且不会自动投放",
  "双击程序直接打开网页，Windows 启动器不再显示窗口",
  "四个功能后台同时运行，首页实时显示各自任务进度",
  "明星画面新增10种内置参考音色，可直接试听和使用",
  "在线更新增加安装前自检、失败回滚与完整状态记录"
];

const PROGRESS_STATUS_LABELS = {
  idle: "暂无任务",
  queued: "排队中",
  preparing: "准备中",
  running: "生成中",
  quality_checking: "质检中",
  awaiting_review: "待人工审核",
  success: "已完成",
  partial: "部分完成",
  failed: "处理失败",
  interrupted: "已中断",
  unavailable: "服务未连接"
};

function renderWorkbenchProgress(data) {
  for (const item of data?.modes || []) {
    const progress = document.querySelector(`[data-progress="${item.mode}"]`);
    const card = document.querySelector(`[data-mode="${item.mode}"]`);
    if (!progress || !card) continue;
    const percent = Math.max(0, Math.min(100, Number(item.percent || 0)));
    const active = Number(item.activeCount || 0);
    const label = active > 1
      ? `${active}个任务进行中`
      : active === 1
        ? (PROGRESS_STATUS_LABELS[item.status] || "进行中")
        : (PROGRESS_STATUS_LABELS[item.status] || item.message || "暂无任务");
    progress.querySelector("span").textContent = item.message && active <= 1 ? `${label} · ${item.message}` : label;
    progress.querySelector("strong").textContent = `${percent}%`;
    progress.querySelector("i b").style.width = `${percent}%`;
    progress.classList.toggle("is-active", active > 0);
    progress.classList.toggle("is-attention", item.status === "awaiting_review" || item.status === "failed");
    card.classList.toggle("has-active-job", active > 0);
    if (item.href) card.href = item.href;
  }
}

async function loadWorkbenchProgress() {
  try {
    const response = await fetch("./api/workbench/progress", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "任务进度读取失败");
    renderWorkbenchProgress(data);
  } catch {
    // 短暂刷新或子服务重启期间保留上一帧进度，下一轮自动恢复。
  }
}

function renderUpdateNotes(notes) {
  const rows = Array.isArray(notes) && notes.length ? notes.slice(0, 4) : FALLBACK_UPDATE_NOTES;
  updateNotes.replaceChildren(...rows.map((note) => {
    const item = document.createElement("span");
    const text = String(note || "").trim();
    item.textContent = text.length > 38 ? `${text.slice(0, 38)}…` : text;
    item.title = text;
    return item;
  }));
}

async function loadVersionInfo() {
  try {
    const metaResponse = await fetch("./api/app-meta");
    const meta = await metaResponse.json();
    if (!metaResponse.ok) throw new Error(meta.message || "版本读取失败");
    const currentVersion = meta.version || "未知";
    const promptRuleVersion = meta.promptRules?.version || "";
    versionLine.textContent = promptRuleVersion
      ? `当前版本 v${currentVersion} · 提示词规则 ${promptRuleVersion}`
      : `当前版本 v${currentVersion}`;
    if (personStudioEntry && meta.personStudio?.url) {
      personStudioEntry.href = meta.personStudio.url;
      personStudioEntry.classList.toggle("is-unavailable", !meta.personStudio.available);
      personStudioTag.textContent = "用人物图片或视频生成明星/KOL画面";
      personStudioTag.title = meta.personStudio.available ? "服务已就绪" : "服务暂未就绪";
    }

    const updateResponse = await fetch("./api/update/check");
    const update = await updateResponse.json();
    if (!updateResponse.ok) throw new Error(update.message || "更新状态读取失败");
    if (update.updateAvailable) {
      updateTitle.textContent = `发现新版本 v${update.latestVersion || "最新"}`;
      updateText.textContent = "点击一次即可在线安装，任务和素材不会删除";
      homeUpdateButton.hidden = false;
      homeUpdateButton.disabled = false;
    } else {
      updateTitle.textContent = `v${currentVersion} 已是最新版本`;
      updateText.textContent = update.message || "当前无需更新";
      homeUpdateButton.hidden = true;
    }
    renderUpdateNotes(update.notes);
  } catch (error) {
    versionLine.textContent = "当前版本暂未读取";
    updateTitle.textContent = "更新信息暂不可用";
    updateText.textContent = error.message || "稍后刷新页面重试";
    renderUpdateNotes(FALLBACK_UPDATE_NOTES);
  }
}

function libtvAccountOptionLabel(account) {
  const kind = account.isTeam ? "团队版" : "个人版";
  return `${account.accountName || "LibTV账号"} · ${kind}${account.isActive ? "（当前）" : ""}`;
}

function renderLibtvAccountChoices(health) {
  const accounts = Array.isArray(health?.accounts) ? health.accounts : [];
  const active = health?.activeAccount || null;
  libtvAccountSelect.replaceChildren(...accounts.map((account) => {
    const option = document.createElement("option");
    option.value = account.accountId;
    option.textContent = libtvAccountOptionLabel(account);
    option.selected = account.isActive;
    return option;
  }));
  libtvAccountStep.hidden = !accounts.length;
  libtvSwitchAccountButton.disabled = !accounts.length || libtvAccountSelect.value === String(active?.accountId || "");
}

function showConnectedLibtvDialog(message = "") {
  libtvPhoneStep.hidden = true;
  libtvCodeStep.hidden = true;
  libtvSendCodeButton.hidden = true;
  libtvVerifyCodeButton.hidden = true;
  libtvLogoutButton.hidden = false;
  renderLibtvAccountChoices(libtvHealth);
  const activeName = libtvHealth?.activeAccount?.displayName || "当前LibTV账号";
  showLibtvLoginMessage(message || `当前视频会生成到 ${activeName}。请让 LibTV 网页右上角保持同一空间。`);
}

async function loadHealth() {
  try {
    const healthResponse = await fetch("./api/health", { cache: "no-store" });
    const health = await healthResponse.json();
    if (!healthResponse.ok || !health.ok) throw new Error(health.message || "LibTV未登录");
    statusBox.classList.remove("is-warning");
    statusBox.classList.add("is-ready");
    libtvHealth = health;
    const activeName = health.activeAccount?.displayName || "当前账号";
    statusTitle.textContent = `LibTV 已登录 · ${activeName}`;
    statusText.textContent = "视频画布将固定创建在上述空间；LibTV 网页右上角需保持同名团队";
    statusText.hidden = false;
    libtvLoginButton.textContent = "管理LibTV账号";
    libtvLoginButton.disabled = false;
    libtvConnected = true;
    renderAccessGuide();
    return true;
  } catch (error) {
    libtvHealth = null;
    statusBox.classList.remove("is-ready");
    statusBox.classList.add("is-warning");
    statusTitle.textContent = "页面可以使用，LibTV待连接";
    statusText.textContent = "使用手机号和短信验证码完成服务器授权";
    statusText.hidden = false;
    libtvLoginButton.textContent = "登录LibTV";
    libtvLoginButton.disabled = false;
    libtvConnected = false;
    renderAccessGuide();
    return false;
  }
}

function showLibtvLoginMessage(message, isError = false) {
  libtvLoginMessage.textContent = message || "";
  libtvLoginMessage.classList.toggle("is-error", isError);
}

function startLibtvResendCountdown(seconds) {
  clearInterval(libtvResendTimer);
  let remaining = Math.max(0, Number(seconds || 0));
  if (remaining <= 0) {
    libtvSendCodeButton.disabled = false;
    libtvSendCodeButton.textContent = "重新发送验证码";
    return;
  }
  const render = () => {
    if (remaining <= 0) {
      clearInterval(libtvResendTimer);
      libtvResendTimer = null;
      libtvSendCodeButton.disabled = false;
      libtvSendCodeButton.textContent = "重新发送验证码";
      return;
    }
    libtvSendCodeButton.disabled = true;
    libtvSendCodeButton.textContent = `${remaining}秒后可重发`;
    remaining -= 1;
  };
  render();
  libtvResendTimer = setInterval(render, 1000);
}

function resetLibtvLoginDialog() {
  clearInterval(libtvResendTimer);
  libtvResendTimer = null;
  libtvPhoneInput.readOnly = false;
  libtvPhoneStep.hidden = false;
  libtvCodeInput.value = "";
  libtvCodeStep.hidden = true;
  libtvVerifyCodeButton.hidden = true;
  libtvLogoutButton.hidden = true;
  libtvAccountStep.hidden = true;
  libtvAccountSelect.innerHTML = "";
  libtvSwitchAccountButton.disabled = true;
  libtvSendCodeButton.hidden = false;
  libtvSendCodeButton.disabled = false;
  libtvSendCodeButton.textContent = "发送验证码";
  showLibtvLoginMessage("");
}

async function postLibtvLogin(pathname, body) {
  const response = await fetch(pathname, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "LibTV登录未完成");
  return data;
}

async function openLibtvLogin() {
  await loadHealth();
  resetLibtvLoginDialog();
  if (libtvConnected) {
    showConnectedLibtvDialog();
  }
  libtvLoginDialog.showModal();
  if (!libtvConnected) libtvPhoneInput.focus();
}

async function logoutLibtvBinding() {
  libtvLogoutButton.disabled = true;
  libtvLogoutButton.textContent = "正在解除…";
  try {
    await postLibtvLogin("./api/libtv/logout", {});
    await loadHealth();
    resetLibtvLoginDialog();
    showLibtvLoginMessage("当前工作台账号已解除绑定，请使用你自己的手机号重新登录。");
    libtvPhoneInput.focus();
  } catch (error) {
    showLibtvLoginMessage(error.message || "解除LibTV绑定失败", true);
  } finally {
    libtvLogoutButton.disabled = false;
    libtvLogoutButton.textContent = "解除绑定并更换账号";
  }
}

async function sendLibtvCode() {
  const phone = libtvPhoneInput.value.replace(/[\s-]+/g, "");
  if (!/^1[3-9]\d{9}$/.test(phone)) {
    showLibtvLoginMessage("请输入正确的11位中国大陆手机号", true);
    libtvPhoneInput.focus();
    return;
  }
  libtvSendCodeButton.disabled = true;
  libtvSendCodeButton.textContent = "正在发送…";
  showLibtvLoginMessage("正在发送短信验证码…");
  try {
    const data = await postLibtvLogin("./api/libtv/login/phone/send", { phone });
    if (data.status === "connected") {
      await loadHealth();
      showConnectedLibtvDialog();
      return;
    }
    libtvPhoneInput.value = phone;
    libtvPhoneInput.readOnly = true;
    libtvCodeStep.hidden = false;
    libtvVerifyCodeButton.hidden = false;
    showLibtvLoginMessage(data.message || "验证码已发送，请查看短信");
    startLibtvResendCountdown(data.retryAfter || 60);
    libtvCodeInput.focus();
  } catch (error) {
    libtvSendCodeButton.disabled = false;
    libtvSendCodeButton.textContent = "重新发送";
    showLibtvLoginMessage(error.message || "验证码发送失败，请重试", true);
  }
}

async function verifyLibtvCode() {
  const phone = libtvPhoneInput.value.replace(/[\s-]+/g, "");
  const code = libtvCodeInput.value.trim();
  if (!/^\d{6}$/.test(code)) {
    showLibtvLoginMessage("请输入短信中的6位验证码", true);
    libtvCodeInput.focus();
    return;
  }
  libtvVerifyCodeButton.disabled = true;
  libtvVerifyCodeButton.textContent = "正在验证…";
  showLibtvLoginMessage("正在验证并保存服务器凭证…");
  try {
    const connected = await postLibtvLogin("./api/libtv/login/phone/verify", { phone, code });
    showLibtvLoginMessage("登录成功，正在确认视频生成空间…");
    await loadHealth();
    showConnectedLibtvDialog(connected.requiresAccountSelection
      ? "这个手机号加入了多个团队，请选择视频要生成到哪个团队。"
      : "登录成功。请确认下方生成空间与 LibTV 网页右上角一致。");
  } catch (error) {
    libtvVerifyCodeButton.disabled = false;
    libtvVerifyCodeButton.textContent = "完成登录";
    showLibtvLoginMessage(error.message || "验证码验证失败，请重试", true);
  }
}

async function switchLibtvGenerationAccount() {
  const accountId = libtvAccountSelect.value;
  if (!accountId) return;
  libtvSwitchAccountButton.disabled = true;
  libtvSwitchAccountButton.textContent = "正在切换…";
  showLibtvLoginMessage("正在锁定视频生成空间…");
  try {
    const result = await postLibtvLogin("./api/libtv/account/use", { accountId });
    await loadHealth();
    renderLibtvAccountChoices(libtvHealth);
    showLibtvLoginMessage(result.message || "生成空间已切换。请在 LibTV 网页右上角切换到同名团队。");
  } catch (error) {
    showLibtvLoginMessage(error.message || "生成空间切换失败", true);
  } finally {
    libtvSwitchAccountButton.textContent = "切换生成空间";
    libtvSwitchAccountButton.disabled = libtvAccountSelect.value === String(libtvHealth?.activeAccount?.accountId || "");
  }
}

async function applyHomeUpdate() {
  homeUpdateButton.disabled = true;
  homeUpdateButton.textContent = "正在更新…";
  updateText.textContent = "正在下载、校验并安装更新，请不要关闭工作台。";
  try {
    const response = await fetch("./api/update/apply", { method: "POST" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "更新失败");
    homeUpdateButton.textContent = data.automaticRestart
      ? "已安装，正在自动重启"
      : data.restartRequired
        ? "已安装，请重新双击"
        : "更新完成";
    updateTitle.textContent = data.skipped ? "当前已是最新版本" : `v${data.installedVersion || "新版本"} 已安装`;
    updateText.textContent = data.message || "更新已完成";
  } catch (error) {
    homeUpdateButton.disabled = false;
    homeUpdateButton.textContent = "重新更新";
    updateText.textContent = error.message || "在线更新未完成";
  }
}

async function loadAuthUser() {
  const response = await fetch("./api/auth/status", { credentials: "same-origin" });
  const data = await response.json();
  if (!response.ok || !data.authenticated) {
    window.location.replace("./login.html");
    return;
  }
  syncPersonalTaskAccount(data.user);
  const suffix = data.user?.isSuperAdmin ? " · 超级管理员" : "";
  authUserLine.textContent = `${data.user?.name || "飞书用户"}${suffix}`;
}

async function loadProviderAuthorization() {
  try {
    const response = await fetch("./api/provider-credential/status", {
      credentials: "same-origin",
      cache: "no-store"
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "授权状态读取失败");
    providerConnected = data.valid === true;
    providerAuthButton.textContent = data.valid ? "FanDo授权已连接" : "连接FanDo授权";
    providerAuthButton.classList.toggle("is-attention", !data.valid);
    providerAuthButton.title = data.valid
      ? `授权可用${data.workNo ? ` · ${data.workNo}` : ""}，点击可更新`
      : "模型功能需要导入本人 FanDo 授权";
    renderAccessGuide();
  } catch {
    providerConnected = false;
    providerAuthButton.textContent = "检查FanDo授权";
    renderAccessGuide();
  }
}

logoutButton.addEventListener("click", async () => {
  logoutButton.disabled = true;
  const embeddedInHub = window.location.pathname.includes("/modules/ai-first-creation/");
  try {
    await fetch(embeddedInHub ? "../../api/hub-auth/logout" : "./api/auth/logout", {
      method: "POST",
      credentials: "same-origin",
      ...(embeddedInHub ? { headers: { "Content-Type": "application/json" }, body: "{}" } : {})
    });
  } finally {
    clearPersonalTaskStorage();
    localStorage.removeItem(PERSONAL_TASK_ACCOUNT_KEY);
    if (embeddedInHub) window.top.location.replace(new URL("../../", window.location.href).href);
    else window.location.replace("./login.html");
  }
});

providerAuthButton.addEventListener("click", () => {
  window.location.assign("./login.html?provider=1");
});
libtvLoginButton.addEventListener("click", openLibtvLogin);
libtvSendCodeButton.addEventListener("click", sendLibtvCode);
libtvLogoutButton.addEventListener("click", logoutLibtvBinding);
libtvAccountSelect.addEventListener("change", () => {
  libtvSwitchAccountButton.disabled = libtvAccountSelect.value === String(libtvHealth?.activeAccount?.accountId || "");
});
libtvSwitchAccountButton.addEventListener("click", switchLibtvGenerationAccount);
libtvLoginClose.addEventListener("click", () => libtvLoginDialog.close());
libtvLoginDialog.addEventListener("close", () => {
  clearInterval(libtvResendTimer);
  libtvResendTimer = null;
});
libtvLoginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (libtvCodeStep.hidden) {
    await sendLibtvCode();
    return;
  }
  await verifyLibtvCode();
});
homeUpdateButton.addEventListener("click", applyHomeUpdate);

applyCreationEntryVisibility();
renderAccessGuide();
Promise.allSettled([loadAuthUser(), loadProviderAuthorization(), loadVersionInfo(), loadHealth(), loadWorkbenchProgress()]);
setInterval(loadWorkbenchProgress, 2000);
