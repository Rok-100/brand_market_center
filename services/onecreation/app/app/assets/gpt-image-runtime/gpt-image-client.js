const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const http = require("http");
const https = require("https");
const crypto = require("crypto");

const DEFAULT_BASE_URL = "https://jenvideo-jump.fandow.com";
const DEFAULT_MODEL = "openai/gpt-image-2";
const SEEDREAM_5_PRO_MODEL = "doubao-seedream-5-0-pro-260628";
const SUPPORTED_IMAGE_MODELS = Object.freeze([
  Object.freeze({ id: DEFAULT_MODEL, label: "GPT Image 2" }),
  Object.freeze({ id: SEEDREAM_5_PRO_MODEL, label: "Seedream 5.0 Pro" })
]);
const TOKEN_CACHE_MS = 6 * 60 * 60 * 1000;
const DEFAULT_GENERATION_TIMEOUT_MS = 15 * 60 * 1000;
const MAX_REQUEST_TIMEOUT_MS = 4 * 60 * 1000;
const POLL_INTERVAL_MS = 3000;
const tokenCache = new Map();

function deadlineAt(options = {}) {
  const explicitDeadline = Number(options.deadlineAt);
  if (Number.isFinite(explicitDeadline) && explicitDeadline > 0) return explicitDeadline;
  const requestedTimeout = Number(options.timeoutMs);
  const timeoutMs = Number.isFinite(requestedTimeout) && requestedTimeout > 0
    ? requestedTimeout
    : DEFAULT_GENERATION_TIMEOUT_MS;
  return Date.now() + timeoutMs;
}

function requestTimeoutFor(deadline, maximum = MAX_REQUEST_TIMEOUT_MS) {
  const remaining = Math.floor(Number(deadline) - Date.now());
  if (remaining <= 0) throw new Error("图片生成全流程等待超过15分钟");
  return Math.max(1, Math.min(maximum, remaining));
}

async function waitForNextPoll(deadline) {
  const remaining = Math.floor(Number(deadline) - Date.now());
  if (remaining <= 0) throw new Error("图片生成全流程等待超过15分钟");
  await new Promise((resolve) => setTimeout(resolve, Math.min(POLL_INTERVAL_MS, remaining)));
}

function normalizeImageModel(value) {
  const model = String(value || DEFAULT_MODEL).trim();
  if (!SUPPORTED_IMAGE_MODELS.some((item) => item.id === model)) {
    throw new Error("不支持的生图模型");
  }
  return model;
}

function imageModelLabel(value) {
  const model = normalizeImageModel(value);
  return SUPPORTED_IMAGE_MODELS.find((item) => item.id === model)?.label || model;
}

function normalizeBaseUrl(value) {
  const base = String(value || DEFAULT_BASE_URL).trim().replace(/\/+$/, "");
  const parsed = new URL(base);
  if (!/^https?:$/.test(parsed.protocol)) throw new Error("GPT Image 2 服务地址必须是 http 或 https");
  return base;
}

function parseJson(text) {
  try {
    return JSON.parse(String(text || ""));
  } catch {
    return null;
  }
}

function requestBuffer(target, options = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(target);
    const transport = parsed.protocol === "https:" ? https : http;
    const request = transport.request(parsed, {
      method: options.method || "GET",
      headers: options.headers || {},
      timeout: options.timeout || 120000
    }, (response) => {
      const chunks = [];
      let bytes = 0;
      response.on("data", (chunk) => {
        bytes += chunk.length;
        if (bytes <= (options.maxBytes || 64 * 1024 * 1024)) chunks.push(chunk);
      });
      response.on("end", () => resolve({
        statusCode: Number(response.statusCode || 0),
        headers: response.headers,
        body: Buffer.concat(chunks)
      }));
    });
    request.on("timeout", () => request.destroy(new Error("GPT Image 2 请求超时")));
    request.on("error", reject);
    if (options.body) request.write(options.body);
    request.end();
  });
}

function localCredentialPaths() {
  const appData = String(process.env.APPDATA || "").trim();
  const userProfile = String(process.env.USERPROFILE || process.env.HOME || "").trim();
  return [
    appData ? { source: "openclaw", filePath: path.join(appData, "FanDo", "openclaw", "openclaw.json") } : null,
    userProfile ? { source: "openclaw", filePath: path.join(userProfile, ".openclaw", "openclaw.json") } : null,
    appData ? { source: "fando-session", filePath: path.join(appData, "FanDo", "auth", "session.json") } : null
  ].filter(Boolean);
}

async function readFanDoProviderToken() {
  const serverToken = String(
    process.env.JENVIDEO_UAC_TOKEN
    || process.env.FANDO_PROVIDER_API_KEY
    || ""
  ).trim();
  if (serverToken) return { token: serverToken, source: "server-provider" };
  const appData = String(process.env.APPDATA || "").trim();
  const configPath = appData ? path.join(appData, "FanDo", "fando-providers.json") : "";
  if (!configPath) return null;
  try {
    const parsed = JSON.parse(await fsp.readFile(configPath, "utf8"));
    const token = String(
      parsed?.providerSecrets?.jenvideo?.apiKey
      || parsed?.apiKeys?.jenvideo
      || ""
    ).trim();
    return token ? { token, source: "fando-provider" } : null;
  } catch {
    return null;
  }
}

function findAccessToken(value, depth = 0) {
  if (!value || typeof value !== "object" || depth > 8) return "";
  for (const [key, nested] of Object.entries(value)) {
    if (["accesstoken", "access_token", "uactoken", "uac_token"].includes(String(key).toLowerCase())) {
      const token = String(nested || "").trim();
      if (token.length >= 20) return token;
    }
  }
  for (const nested of Object.values(value)) {
    const token = findAccessToken(nested, depth + 1);
    if (token) return token;
  }
  return "";
}

async function readLocalUacToken() {
  for (const item of localCredentialPaths()) {
    try {
      const parsed = JSON.parse(await fsp.readFile(item.filePath, "utf8"));
      const token = item.source === "fando-session"
        ? String(parsed.accessToken || parsed.access_token || "").trim()
        : findAccessToken(parsed);
      if (token) return { token, source: item.source };
    } catch {
      // Continue to the next supported local credential.
    }
  }
  throw new Error("未找到可自动换取 GPT Image 2 访问凭证的本机登录状态");
}

async function acquireToken(baseUrl, forceRefresh = false, options = {}) {
  const direct = String(
    process.env.KOC_GPT_IMAGE_TOKEN
    || process.env.JENVIDEO_GEN_TOKEN
    || process.env.GEN_TOKEN
    || ""
  ).trim();
  if (direct && options.allowLocalCredentialFallback !== false) {
    return { token: direct, source: "environment" };
  }
  const normalized = normalizeBaseUrl(baseUrl);
  const hasCredentialResolver = typeof options.resolveUacCredential === "function";
  let credential = hasCredentialResolver
    ? await options.resolveUacCredential()
    : null;
  if (!credential?.token && options.allowLocalCredentialFallback === false) {
    throw new Error("请先导入本人 FanDo 模型授权");
  }
  credential = credential?.token
    ? credential
    : (await readFanDoProviderToken() || await readLocalUacToken());
  const credentialCacheKey = String(
    credential.cacheKey
    || crypto.createHash("sha256").update(String(credential.token)).digest("hex").slice(0, 24)
  );
  const cacheKey = `${normalized}|${credentialCacheKey}`;
  const cached = tokenCache.get(cacheKey);
  if (!forceRefresh && cached?.token && cached.expiresAt > Date.now()) {
    return { token: cached.token, source: cached.source };
  }
  const response = await requestBuffer(`${normalized}/v1/agent-token`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${credential.token}`,
      "User-Agent": "WISKocWorkbench/2.8",
      "Content-Length": "0"
    },
    timeout: options.deadlineAt ? requestTimeoutFor(options.deadlineAt, 30000) : 30000
  });
  const payload = parseJson(response.body.toString("utf8")) || {};
  const token = String(payload?.data?.token || payload?.token || "").trim();
  if (response.statusCode < 200 || response.statusCode >= 300 || !token) {
    const error = new Error(payload?.error || payload?.message || `生图服务自动授权失败（HTTP ${response.statusCode}）`);
    error.statusCode = response.statusCode;
    if (
      hasCredentialResolver
      && typeof options.onCredentialError === "function"
      && ([401, 403].includes(response.statusCode) || /token|鉴权|认证|过期|失效/i.test(error.message))
    ) {
      await Promise.resolve().then(() => options.onCredentialError(error)).catch(() => {});
    }
    throw error;
  }
  tokenCache.set(cacheKey, {
    token,
    source: credential.source,
    expiresAt: Date.now() + TOKEN_CACHE_MS
  });
  return { token, source: credential.source };
}

function contentTypeFor(filePath) {
  const ext = path.extname(String(filePath || "")).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  return "image/jpeg";
}

function makeMultipart(parts) {
  const boundary = `----WISKoc${crypto.randomBytes(12).toString("hex")}`;
  const buffers = [];
  for (const part of parts) {
    buffers.push(Buffer.from(`--${boundary}\r\n`));
    if (part.filename) {
      buffers.push(Buffer.from(`Content-Disposition: form-data; name="${part.name}"; filename="${part.filename}"\r\n`));
      buffers.push(Buffer.from(`Content-Type: ${part.contentType || "application/octet-stream"}\r\n\r\n`));
      buffers.push(part.data);
      buffers.push(Buffer.from("\r\n"));
    } else {
      buffers.push(Buffer.from(`Content-Disposition: form-data; name="${part.name}"\r\n\r\n${part.value || ""}\r\n`));
    }
  }
  buffers.push(Buffer.from(`--${boundary}--\r\n`));
  return { boundary, body: Buffer.concat(buffers) };
}

async function apiRequest(baseUrl, endpoint, token, options = {}) {
  const body = options.json === undefined ? options.body : Buffer.from(JSON.stringify(options.json), "utf8");
  const headers = {
    "X-Access-Token": token,
    Accept: "application/json",
    "User-Agent": "WISKocWorkbench/2.8",
    ...(options.json === undefined ? {} : { "Content-Type": "application/json; charset=utf-8" }),
    ...(options.headers || {})
  };
  if (body) headers["Content-Length"] = Buffer.byteLength(body);
  const response = await requestBuffer(`${normalizeBaseUrl(baseUrl)}${endpoint}`, {
    method: options.method || "GET",
    headers,
    body,
    timeout: options.timeout || 240000
  });
  const payload = parseJson(response.body.toString("utf8")) || {};
  if (
    response.statusCode < 200
    || response.statusCode >= 300
    || payload?.error
    || (typeof payload?.code === "number" && payload.code !== 0)
  ) {
    const error = new Error(payload?.error || payload?.message || payload?.detail || `生图服务接口失败（HTTP ${response.statusCode}）`);
    error.statusCode = response.statusCode;
    throw error;
  }
  return payload;
}

function taskData(payload) {
  return payload?.data && typeof payload.data === "object" ? payload.data : payload || {};
}

function taskId(payload) {
  const data = taskData(payload);
  return String(data.task_id || data.taskId || data.id || payload?.task_id || "").trim();
}

function taskStatus(payload) {
  const data = taskData(payload);
  return String(data.status || data.state || payload?.status || "").trim().toLowerCase();
}

function collectImageUrls(value, output = []) {
  if (typeof value === "string" && /^https?:\/\/.+\.(?:png|jpe?g|webp)(?:\?.*)?$/i.test(value.trim())) {
    output.push(value.trim());
  } else if (Array.isArray(value)) {
    value.forEach((item) => collectImageUrls(item, output));
  } else if (value && typeof value === "object") {
    Object.values(value).forEach((item) => collectImageUrls(item, output));
  }
  return [...new Set(output)];
}

function collectTaskImageUrls(value) {
  const output = [];
  const explicitOutputKey = /^(?:oss_image_urls?|image_results?|image_url|imageurl|output_urls?|outputurl|result_urls?|resulturl|download_urls?|downloadurl|generated_image_urls?)$/i;
  const outputContainerKey = /^(?:outputs?|results?|artifacts?|generated_images?)$/i;
  const inputKey = /^(?:inputs?|input(?:_|$).*|images|image_urls|reference(?:_|$).*|source(?:_|$).*)$/i;

  const collectUrls = (nested) => {
    if (typeof nested === "string" && /^https?:\/\//i.test(nested.trim())) {
      output.push(nested.trim());
    } else if (Array.isArray(nested)) {
      nested.forEach(collectUrls);
    } else if (nested && typeof nested === "object") {
      Object.values(nested).forEach(collectUrls);
    }
  };

  const collectExplicitOutputs = (nested) => {
    if (Array.isArray(nested)) {
      nested.forEach(collectExplicitOutputs);
      return;
    }
    if (!nested || typeof nested !== "object") return;
    for (const [key, item] of Object.entries(nested)) {
      if (inputKey.test(key)) continue;
      if (explicitOutputKey.test(key) || outputContainerKey.test(key)) {
        collectUrls(item);
      } else {
        collectExplicitOutputs(item);
      }
    }
  };

  collectExplicitOutputs(value);
  const preferred = [...new Set(output)];
  if (preferred.length) return preferred;

  const fallback = [];
  const collectFallback = (nested, key = "") => {
    if (inputKey.test(key)) return;
    if (typeof nested === "string" && /^https?:\/\/.+\.(?:png|jpe?g|webp)(?:\?.*)?$/i.test(nested.trim())) {
      fallback.push(nested.trim());
    } else if (Array.isArray(nested)) {
      nested.forEach((item) => collectFallback(item, key));
    } else if (nested && typeof nested === "object") {
      Object.entries(nested).forEach(([nestedKey, item]) => collectFallback(item, nestedKey));
    }
  };
  collectFallback(value);
  return [...new Set(fallback)];
}

async function downloadFile(url, destination, options = {}) {
  await fsp.mkdir(path.dirname(destination), { recursive: true });
  const timeout = options.deadlineAt
    ? requestTimeoutFor(options.deadlineAt)
    : MAX_REQUEST_TIMEOUT_MS;
  const response = await fetch(url, { signal: AbortSignal.timeout(timeout) });
  if (!response.ok || !response.body) throw new Error(`候选图下载失败（HTTP ${response.status}）`);
  const temporary = `${destination}.part`;
  const stream = fs.createWriteStream(temporary);
  try {
    for await (const chunk of response.body) stream.write(chunk);
    await new Promise((resolve, reject) => {
      stream.end(resolve);
      stream.on("error", reject);
    });
    await fsp.rename(temporary, destination);
  } catch (error) {
    stream.destroy();
    await fsp.rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
  return destination;
}

function createGptImageClient(options = {}) {
  const baseUrl = normalizeBaseUrl(options.baseUrl || process.env.KOC_GPT_IMAGE_BASE_URL || DEFAULT_BASE_URL);
  const model = normalizeImageModel(options.model || process.env.KOC_GPT_IMAGE_MODEL || DEFAULT_MODEL);

  function acquireCredential(forceRefresh = false, tokenOptions = {}) {
    return acquireToken(baseUrl, forceRefresh, {
      ...tokenOptions,
      resolveUacCredential: options.resolveUacCredential,
      onCredentialError: options.onCredentialError,
      allowLocalCredentialFallback: options.allowLocalCredentialFallback
    });
  }

  async function authorizedRequest(endpoint, credential, requestOptions = {}) {
    try {
      return await apiRequest(baseUrl, endpoint, credential.token, requestOptions);
    } catch (error) {
      if (![401, 403].includes(Number(error?.statusCode))) throw error;
      const refreshed = await acquireCredential(true, {
        ...(requestOptions.timeout ? { deadlineAt: Date.now() + requestOptions.timeout } : {})
      });
      credential.token = refreshed.token;
      credential.source = refreshed.source;
      return apiRequest(baseUrl, endpoint, credential.token, requestOptions);
    }
  }

  async function upload(filePath, token, options = {}) {
    const resolved = path.resolve(filePath);
    const data = await fsp.readFile(resolved);
    const contentType = contentTypeFor(resolved);
    const multipart = makeMultipart([
      { name: "file", filename: path.basename(resolved), contentType, data },
      { name: "content_type", value: contentType }
    ]);
    const credential = { token: String(token || ""), source: "provided" };
    const payload = await authorizedRequest("/v1/image/upload", credential, {
      method: "POST",
      body: multipart.body,
      headers: { "Content-Type": `multipart/form-data; boundary=${multipart.boundary}` },
      ...(options.deadlineAt ? { timeout: requestTimeoutFor(options.deadlineAt) } : {})
    });
    const url = String(payload?.data?.url || payload?.url || "").trim();
    if (!url) throw new Error("参考图上传成功，但接口没有返回图片地址");
    return url;
  }

  async function pollGenerationTask(id, credential, options = {}) {
    const requestedModel = normalizeImageModel(options.model || model);
    const requestedModelLabel = imageModelLabel(requestedModel);
    const generationDeadline = deadlineAt(options);
    while (Date.now() < generationDeadline) {
      const result = await authorizedRequest(`/v1/image/generations/${encodeURIComponent(id)}`, credential, {
        timeout: requestTimeoutFor(generationDeadline)
      });
      const status = taskStatus(result) || "running";
      if (typeof options.onStatus === "function") {
        await options.onStatus({ taskId: id, status, model: requestedModel });
      }
      const urls = collectTaskImageUrls(result);
      if (["succeeded", "success", "completed", "done"].includes(status) && urls[0]) {
        return { taskId: id, url: urls[0], tokenSource: credential.source, model: requestedModel };
      }
      if (["succeeded", "success", "completed", "done"].includes(status)) {
        throw new Error(`${requestedModelLabel} 任务已完成，但接口没有返回结果图片地址`);
      }
      if (["failed", "error", "expired", "cancelled", "canceled"].includes(status)) {
        const data = taskData(result);
        throw new Error(data.error_message || data.error || data.message || `${requestedModelLabel} 任务${status}`);
      }
      await waitForNextPoll(generationDeadline);
    }
    throw new Error(`${requestedModelLabel} 图片生成全流程等待超过15分钟`);
  }

  async function waitForTask(id, options = {}) {
    const normalizedTaskId = String(id || "").trim();
    if (!normalizedTaskId) throw new Error("图片任务编号不能为空");
    const generationDeadline = deadlineAt(options);
    const credential = await acquireCredential(false, { deadlineAt: generationDeadline });
    return pollGenerationTask(normalizedTaskId, credential, {
      ...options,
      deadlineAt: generationDeadline
    });
  }

  async function generate(options = {}) {
    const generationDeadline = deadlineAt(options);
    const credential = await acquireCredential(false, { deadlineAt: generationDeadline });
    const requestedModel = normalizeImageModel(options.model || model);
    const requestedModelLabel = imageModelLabel(requestedModel);
    const inputUrls = Array.isArray(options.inputUrls)
      ? [...new Set(options.inputUrls.map((item) => String(item || "").trim()).filter(Boolean))].slice(0, 10)
      : [];
    const created = await authorizedRequest("/v1/image/generations", credential, {
      method: "POST",
      timeout: requestTimeoutFor(generationDeadline),
      json: {
        model: requestedModel,
        prompt: String(options.prompt || "").slice(0, 20000),
        aspect_ratio: String(options.aspectRatio || "9:16"),
        resolution: String(options.resolution || "2K"),
        input_urls: inputUrls
      }
    });
    const id = taskId(created);
    if (!id) {
      const immediateUrls = collectTaskImageUrls(created);
      if (immediateUrls[0]) return { taskId: "", url: immediateUrls[0], tokenSource: credential.source, model: requestedModel };
      throw new Error(`${requestedModelLabel} 创建成功，但没有返回任务编号`);
    }
    const createdStatus = taskStatus(created) || "queued";
    if (typeof options.onTaskCreated === "function") {
      await options.onTaskCreated({ taskId: id, status: createdStatus, model: requestedModel });
    }
    const immediateUrls = collectTaskImageUrls(created);
    if (["succeeded", "success", "completed", "done"].includes(createdStatus) && immediateUrls[0]) {
      return { taskId: id, url: immediateUrls[0], tokenSource: credential.source, model: requestedModel };
    }
    return pollGenerationTask(id, credential, {
      ...options,
      model: requestedModel,
      deadlineAt: generationDeadline
    });
  }

  return {
    baseUrl,
    model,
    models: SUPPORTED_IMAGE_MODELS.map((item) => ({ ...item })),
    normalizeModel: normalizeImageModel,
    modelLabel: imageModelLabel,
    acquireToken: (tokenOptions = {}) => acquireCredential(false, tokenOptions),
    check: async () => {
      const credential = await acquireCredential();
      await authorizedRequest("/v1/session", credential, { timeout: 30000 });
      return { ok: true, source: credential.source, model, baseUrl };
    },
    upload,
    generate,
    waitForTask,
    downloadFile
  };
}

module.exports = {
  createGptImageClient,
  DEFAULT_BASE_URL,
  DEFAULT_MODEL,
  SEEDREAM_5_PRO_MODEL,
  SUPPORTED_IMAGE_MODELS,
  normalizeImageModel,
  imageModelLabel,
  collectImageUrls,
  collectTaskImageUrls
};
