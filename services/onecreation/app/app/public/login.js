const identityPanel = document.querySelector("#identityPanel");
const loginButton = document.querySelector("#loginButton");
const retryButton = document.querySelector("#retryButton");
const loginMessage = document.querySelector("#loginMessage");
const loginProgress = document.querySelector("#loginProgress");
const providerAuthPanel = document.querySelector("#providerAuthPanel");
const providerAuthMessage = document.querySelector("#providerAuthMessage");
const providerFileButton = document.querySelector("#providerFileButton");
const providerFileInput = document.querySelector("#providerFileInput");
const providerProgress = document.querySelector("#providerProgress");
const providerSkipButton = document.querySelector("#providerSkipButton");
const providerPathCopy = document.querySelector("#providerPathCopy");
const providerPickerHint = document.querySelector("#providerPickerHint");
let pollTimer = null;
let providerPickerRequired = false;
const PERSONAL_TASK_ACCOUNT_KEY = "workbench-personal-task-account-v1";
const PERSONAL_TASK_STORAGE_KEYS = [
  "ai-product-studio-current-task-v1",
  "ai-product-studio-task-draft-v1",
  "ai-product-studio-task-state-v1",
  "one-click-replacement-current-task-v1",
  "one-click-replacement-draft-v1"
];
const HANDLE_DATABASE = "fandao-workbench-local-permissions-v1";
const HANDLE_STORE = "file-handles";
const HANDLE_KEY = "fando-openclaw-json";
const FANDO_DIRECTORY = "%APPDATA%\\FanDo\\openclaw";
const MAX_CONFIG_BYTES = 2 * 1024 * 1024;
const manageProviderAuthorization = new URLSearchParams(window.location.search).get("provider") === "1";

function syncPersonalTaskAccount(user = {}) {
  const accountId = String(user.larkUserId || user.id || "").trim();
  if (!accountId) return;
  const previousAccountId = localStorage.getItem(PERSONAL_TASK_ACCOUNT_KEY) || "";
  if (!previousAccountId || previousAccountId !== accountId) {
    PERSONAL_TASK_STORAGE_KEYS.forEach((key) => localStorage.removeItem(key));
  }
  localStorage.setItem(PERSONAL_TASK_ACCOUNT_KEY, accountId);
}

function setMessage(message, isError = false) {
  loginMessage.textContent = message;
  loginMessage.classList.toggle("is-error", isError);
}

function setProviderMessage(message, isError = false) {
  providerAuthMessage.textContent = message;
  providerAuthMessage.classList.toggle("is-error", isError);
}

function openHandleDatabase() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) return reject(new Error("当前浏览器不能保存文件授权"));
    const request = indexedDB.open(HANDLE_DATABASE, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(HANDLE_STORE)) {
        request.result.createObjectStore(HANDLE_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("文件授权记录打开失败"));
  });
}

async function fileHandleRecord(mode, value) {
  const database = await openHandleDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(HANDLE_STORE, mode === "get" ? "readonly" : "readwrite");
      const store = transaction.objectStore(HANDLE_STORE);
      const request = mode === "get" ? store.get(HANDLE_KEY) : store.put(value, HANDLE_KEY);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("文件授权记录保存失败"));
    });
  } finally {
    database.close();
  }
}

function extractFanDoApiKey(config = {}) {
  const providers = config?.models?.providers || {};
  const candidates = [
    providers?.qwen?.apiKey,
    providers?.vllm?.apiKey,
    providers?.deepseek?.apiKey,
    config?.providerSecrets?.qwen?.apiKey,
    config?.providerSecrets?.jenvideo?.apiKey,
    config?.apiKeys?.qwen,
    config?.apiKeys?.jenvideo,
    config?.accessToken,
    config?.access_token
  ];
  return candidates.map((value) => String(value || "").trim()).find((value) => value.length >= 20) || "";
}

async function importConfigFile(file) {
  if (!file) throw new Error("没有选择文件");
  if (file.size > MAX_CONFIG_BYTES) throw new Error("配置文件异常：大小不能超过 2MB");
  let config;
  try {
    config = JSON.parse(await file.text());
  } catch {
    throw new Error("所选文件不是有效的 JSON 配置");
  }
  const token = extractFanDoApiKey(config);
  if (!token) throw new Error("没有找到 FanDo 模型 API Key，请确认选择的是 openclaw.json");
  providerProgress.hidden = false;
  providerFileButton.disabled = true;
  setProviderMessage("正在验证这份授权是否属于可用的公司模型账号…");
  try {
    const response = await fetch("./api/provider-credential/import", {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, fileName: file.name || "openclaw.json" })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "FanDo 授权导入失败");
    const probePassed = data.credential?.lastProbe?.ok === true;
    setProviderMessage(probePassed
      ? "最小可用性探针已通过，授权已连接。凭证失效后请重新选择 FanDo 更新后的 openclaw.json。"
      : "授权已连接。以后凭证失效时，请重新选择 FanDo 更新后的 openclaw.json。");
    window.setTimeout(() => window.location.replace("./"), 500);
  } finally {
    providerProgress.hidden = true;
    providerFileButton.disabled = false;
  }
}

async function importFromHandle(handle, requestPermission = false) {
  if (!handle || handle.kind !== "file") {
    const error = new Error("上次选择的文件已不可用，请重新选择");
    error.code = "STALE_PROVIDER_FILE_HANDLE";
    throw error;
  }
  let permission = await handle.queryPermission({ mode: "read" });
  if (permission !== "granted" && requestPermission) {
    permission = await handle.requestPermission({ mode: "read" });
  }
  if (permission !== "granted") throw new Error("需要先点击允许读取上次选择的文件");
  let file;
  try {
    file = await handle.getFile();
  } catch {
    const error = new Error("上次选择的 openclaw.json 已被移动或删除，请重新选择");
    error.code = "STALE_PROVIDER_FILE_HANDLE";
    throw error;
  }
  await importConfigFile(file);
}

function copyFanDoPath(options = {}) {
  if (!navigator.clipboard?.writeText) {
    if (options.announce !== false) {
      setProviderMessage(`请复制页面中的文件夹路径，并粘贴到文件窗口地址栏：${FANDO_DIRECTORY}`);
    }
    return Promise.resolve(false);
  }
  try {
    return navigator.clipboard.writeText(FANDO_DIRECTORY).then(() => {
      providerPathCopy.textContent = "路径已复制";
      providerPickerHint.textContent = "文件夹路径已复制。文件窗口打开后，按 Ctrl+L、Ctrl+V、回车进入文件夹，再选择 openclaw.json 并点击“打开”。";
      if (options.announce !== false) {
        setProviderMessage("FanDo 文件夹路径已复制，请粘贴到文件窗口地址栏；进入文件夹后选择 openclaw.json 并点击“打开”。");
      }
      return true;
    }).catch(() => {
      setProviderMessage(`浏览器未允许自动复制，请手动复制页面中的文件夹路径：${FANDO_DIRECTORY}`, true);
      return false;
    });
  } catch {
    setProviderMessage(`浏览器未允许自动复制，请手动复制页面中的文件夹路径：${FANDO_DIRECTORY}`, true);
    return Promise.resolve(false);
  }
}

async function chooseProviderFile() {
  try {
    const savedHandle = providerPickerRequired ? null : await fileHandleRecord("get").catch(() => null);
    if (savedHandle) {
      providerPickerHint.textContent = "已找到上次授权的 openclaw.json，正在请求读取并自动上传…";
      setProviderMessage("请允许工作台读取上次选择的 openclaw.json；允许后会自动上传 API Key 并完成可用性探测。");
      await importFromHandle(savedHandle, true);
      return;
    }

    providerPickerHint.textContent = "首次连接需要选择一次文件。正在复制 FanDo 路径并打开文件窗口…";
    copyFanDoPath({ announce: true });
    providerFileInput.click();
  } catch (error) {
    if (error?.name === "AbortError") return;
    if (error?.code === "STALE_PROVIDER_FILE_HANDLE") {
      providerPickerRequired = true;
      providerFileButton.textContent = "重新选择 openclaw.json";
      providerPickerHint.textContent = "上次选择的文件已不可用。再次点击按钮即可重新选择。";
    }
    setProviderMessage(error.message || "读取 FanDo 配置失败", true);
  }
}

async function prepareProviderPanel(status = {}) {
  clearInterval(pollTimer);
  identityPanel.hidden = true;
  providerAuthPanel.hidden = false;
  if (status.state === "invalid" || status.state === "expired") {
    setProviderMessage("原有 FanDo 授权已失效。请先在 FanDo 客户端重新登录，再允许工作台读取更新后的文件。", true);
  } else if (status.valid) {
    setProviderMessage("当前本人授权可用。你可以重新选择 openclaw.json 来更新授权，或直接返回工作台。");
  }
  try {
    const handle = await fileHandleRecord("get");
    if (handle) {
      providerFileButton.textContent = `自动读取并连接 ${handle.name || "openclaw.json"}`;
      providerPickerHint.textContent = "已记住上次选择的文件。点击后只需允许读取，工作台会自动上传 API Key 并完成可用性探测。";
    } else {
      providerFileButton.textContent = "复制文件夹路径并选择 openclaw.json";
    }
  } catch {
    providerFileButton.textContent = "复制文件夹路径并选择 openclaw.json";
  }
}

async function readAuthStatus() {
  const response = await fetch("./api/auth/status", { credentials: "same-origin", cache: "no-store" });
  const data = await response.json();
  if (response.ok && data.authenticated) {
    syncPersonalTaskAccount(data.user);
    const credentialResponse = await fetch("./api/provider-credential/status", {
      credentials: "same-origin",
      cache: "no-store"
    });
    const credential = await credentialResponse.json().catch(() => ({}));
    if (credentialResponse.ok && credential.valid && !manageProviderAuthorization) {
      window.location.replace("./");
      return true;
    }
    await prepareProviderPanel(credential);
    return true;
  }
  identityPanel.hidden = false;
  providerAuthPanel.hidden = true;
  return false;
}

function beginPolling() {
  clearInterval(pollTimer);
  pollTimer = setInterval(() => {
    readAuthStatus().catch(() => {});
  }, 1500);
}

async function startLogin() {
  loginButton.disabled = true;
  retryButton.hidden = true;
  loginProgress.hidden = false;
  setMessage("正在创建安全登录请求…");
  try {
    const response = await fetch("./api/auth/start", {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store"
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "登录中心暂不可用");
    setMessage("正在前往飞书完成身份确认，成功后会自动返回工作台。");
    beginPolling();
    window.location.assign(data.loginUrl);
  } catch (error) {
    clearInterval(pollTimer);
    loginProgress.hidden = true;
    retryButton.hidden = false;
    setMessage(error.message || "登录发起失败，请重试", true);
  } finally {
    loginButton.disabled = false;
  }
}

loginButton.addEventListener("click", startLogin);
retryButton.addEventListener("click", startLogin);
providerFileButton.addEventListener("click", chooseProviderFile);
providerSkipButton.addEventListener("click", () => window.location.replace("./"));
providerPathCopy.addEventListener("click", () => copyFanDoPath({ announce: true }));
providerFileInput.addEventListener("change", async () => {
  try {
    await importConfigFile(providerFileInput.files?.[0]);
  } catch (error) {
    setProviderMessage(error.message || "读取 FanDo 配置失败", true);
  } finally {
    providerFileInput.value = "";
  }
});

readAuthStatus().catch(() => {
  setMessage("登录状态检查失败，请点击按钮重试。", true);
});
