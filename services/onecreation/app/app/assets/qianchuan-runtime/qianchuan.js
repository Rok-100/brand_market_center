// Official Ocean Engine / Qianchuan OpenAPI integration.
// Secrets and tokens are encrypted for the current Windows user and never returned to the browser.
const fs = require("fs");
const fsp = require("fs/promises");
const http = require("http");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");

const DEFAULT_APP_ID = "1871927445201475";
const DEFAULT_CALLBACK_URL = "http://localhost:3000/api/oauth/qianchuan/callback";
const API_BASE = String(process.env.WIS_QIANCHUAN_API_BASE || "https://api.oceanengine.com").replace(/\/+$/, "");
const AUTH_URL = String(
  process.env.WIS_QIANCHUAN_AUTH_URL || "https://qianchuan.jinritemai.com/openapi/qc/audit/oauth.html"
);
const CALLBACK_URL = String(process.env.WIS_QIANCHUAN_CALLBACK_URL || DEFAULT_CALLBACK_URL);
const USER_DATA_ROOT = process.env.WIS_QIANCHUAN_USER_DATA || path.join(
  process.env.LOCALAPPDATA || process.env.APPDATA || process.env.USERPROFILE || __dirname,
  "WIS品牌营销部工作站"
);
const AUTH_PATH = path.join(USER_DATA_ROOT, "qianchuan-auth.json");
const CACHE_PATH = path.join(USER_DATA_ROOT, "qianchuan-read-cache.json");
const KEY_PATH = path.join(USER_DATA_ROOT, "qianchuan-credential.key");
const TOKEN_REFRESH_MARGIN_MS = 10 * 60 * 1000;
const OAUTH_STATE_TTL_MS = 15 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 45 * 1000;
const VIDEO_DOWNLOAD_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_VIDEO_UPLOAD_BYTES = 500 * 1024 * 1024;
let callbackServer = null;

async function readJson(filePath, fallback = {}) {
  try {
    return JSON.parse(await fsp.readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

async function writeJson(filePath, value) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.${process.pid}.tmp`;
  await fsp.writeFile(temp, JSON.stringify(value, null, 2), "utf8");
  await fsp.rename(temp, filePath);
}

function powershellDpapi(mode, value) {
  if (process.env.WIS_QIANCHUAN_TEST_PLAINTEXT === "1") return Promise.resolve(value);
  if (process.platform !== "win32") {
    return Promise.reject(new Error("千川API凭证加密仅支持Windows"));
  }
  const script = mode === "protect"
    ? "Add-Type -AssemblyName System.Security;$b=[Convert]::FromBase64String($env:WIS_QC_VALUE);$p=[Security.Cryptography.ProtectedData]::Protect($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser);[Convert]::ToBase64String($p)"
    : "Add-Type -AssemblyName System.Security;$b=[Convert]::FromBase64String($env:WIS_QC_VALUE);$p=[Security.Cryptography.ProtectedData]::Unprotect($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser);[Convert]::ToBase64String($p)";
  return new Promise((resolve, reject) => {
    const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
      windowsHide: true,
      env: { ...process.env, WIS_QC_VALUE: value }
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0 || !stdout.trim()) reject(new Error(stderr.trim() || "Windows凭证加密失败"));
      else resolve(stdout.trim());
    });
  });
}

async function portableEncryptionKey() {
  const configured = String(
    process.env.WIS_QIANCHUAN_CREDENTIAL_KEY || process.env.WIS_QIANCHUAN_SECRET_KEY || ""
  ).trim();
  if (configured) return crypto.createHash("sha256").update(configured, "utf8").digest();
  await fsp.mkdir(USER_DATA_ROOT, { recursive: true });
  try {
    const saved = await fsp.readFile(KEY_PATH);
    if (saved.length === 32) return saved;
  } catch {}
  const created = crypto.randomBytes(32);
  try {
    await fsp.writeFile(KEY_PATH, created, { flag: "wx", mode: 0o600 });
    return created;
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    const saved = await fsp.readFile(KEY_PATH);
    if (saved.length !== 32) throw new Error("千川凭证密钥文件无效，请联系管理员修复");
    return saved;
  }
}

async function protectPortable(value) {
  const key = await portableEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `aesgcm:${iv.toString("base64")}:${tag.toString("base64")}:${encrypted.toString("base64")}`;
}

async function unprotectPortable(value) {
  const [, ivText, tagText, encryptedText] = String(value || "").split(":");
  if (!ivText || !tagText || !encryptedText) throw new Error("千川凭证密文格式无效");
  const decipher = crypto.createDecipheriv("aes-256-gcm", await portableEncryptionKey(), Buffer.from(ivText, "base64"));
  decipher.setAuthTag(Buffer.from(tagText, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedText, "base64")),
    decipher.final()
  ]).toString("utf8");
}

async function protectText(value) {
  if (!value) return "";
  if (process.env.WIS_QIANCHUAN_TEST_PLAINTEXT === "1") return String(value);
  if (process.platform === "win32") {
    const protectedValue = await powershellDpapi("protect", Buffer.from(String(value), "utf8").toString("base64"));
    return `dpapi:${protectedValue}`;
  }
  return protectPortable(value);
}

async function unprotectText(value, label) {
  if (!value) throw new Error(`${label}尚未配置`);
  if (process.env.WIS_QIANCHUAN_TEST_PLAINTEXT === "1") return String(value);
  try {
    if (String(value).startsWith("aesgcm:")) return await unprotectPortable(value);
    const encoded = String(value).startsWith("dpapi:") ? String(value).slice(6) : String(value);
    const raw = await powershellDpapi("unprotect", encoded);
    return Buffer.from(raw, "base64").toString("utf8");
  } catch {
    throw new Error(`${label}无法解密，请由管理员重新配置`);
  }
}

function normalizeAppId(value) {
  const appId = String(value || DEFAULT_APP_ID).trim();
  if (!/^\d{8,24}$/.test(appId)) throw new Error("千川 App ID 格式不正确");
  return appId;
}

function oauthErrorMessage(data, statusCode) {
  return String(
    data?.message || data?.msg || data?.error_description || data?.error ||
    `千川官方接口请求失败（${statusCode || "未知状态"}）`
  );
}

async function requestOfficial(endpoint, {
  method = "GET",
  body,
  token,
  formData,
  timeoutMs = REQUEST_TIMEOUT_MS
} = {}) {
  const target = /^https?:\/\//i.test(endpoint) ? endpoint : `${API_BASE}${endpoint}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = { Accept: "application/json" };
    if (token) headers["Access-Token"] = token;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const response = await fetch(target, {
      method,
      headers,
      body: formData || (body !== undefined ? JSON.stringify(body) : undefined),
      signal: controller.signal
    });
    const text = await response.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      throw new Error(`千川官方接口返回了无法识别的内容（HTTP ${response.status}）`);
    }
    const code = data.code ?? data.status_code;
    if (!response.ok || (code !== undefined && ![0, "0"].includes(code))) {
      throw new Error(oauthErrorMessage(data, response.status));
    }
    return data;
  } catch (error) {
    if (error.name === "AbortError") throw new Error("千川官方接口连接超时，请稍后重试");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function configure(input = {}) {
  const current = await readJson(AUTH_PATH, {});
  const appId = normalizeAppId(input.appId || current.appId || DEFAULT_APP_ID);
  const secret = String(input.secret || "").trim();
  if (!secret && !current.protectedSecret) throw new Error("请填写开放平台 App Secret");
  const appChanged = current.appId && current.appId !== appId;
  const next = {
    version: 2,
    mode: "official_api",
    appId,
    callbackUrl: CALLBACK_URL,
    protectedSecret: secret ? await protectText(secret) : current.protectedSecret,
    configuredAt: current.configuredAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...(appChanged ? {} : {
      protectedAccessToken: current.protectedAccessToken || "",
      protectedRefreshToken: current.protectedRefreshToken || "",
      accessTokenExpiresAt: current.accessTokenExpiresAt || "",
      refreshTokenExpiresAt: current.refreshTokenExpiresAt || "",
      advertiserIds: current.advertiserIds || [],
      authorizedAt: current.authorizedAt || "",
      lastVerifiedAt: current.lastVerifiedAt || "",
      reauthorizationRequired: Boolean(current.reauthorizationRequired)
    })
  };
  await writeJson(AUTH_PATH, next);
  return status();
}

async function persistTokenResponse(tokenData, current = {}, { requireRefreshToken = false } = {}) {
  if (!tokenData.access_token) {
    throw new Error("千川授权成功但未返回访问令牌，请检查应用权限后重试");
  }
  if (requireRefreshToken && !tokenData.refresh_token) {
    throw new Error("千川首次授权未返回刷新令牌，请重新授权");
  }
  const protectedRefreshToken = tokenData.refresh_token
    ? await protectText(tokenData.refresh_token)
    : current.protectedRefreshToken;
  if (!protectedRefreshToken) {
    throw new Error("千川刷新令牌缺失，请重新授权");
  }
  const now = Date.now();
  const advertiserIds = Array.isArray(tokenData.advertiser_ids)
    ? tokenData.advertiser_ids.map(String)
    : (Array.isArray(current.advertiserIds) ? current.advertiserIds.map(String) : []);
  const next = {
    ...current,
    version: 2,
    mode: "official_api",
    protectedAccessToken: await protectText(tokenData.access_token),
    protectedRefreshToken,
    accessTokenExpiresAt: new Date(now + Number(tokenData.expires_in || 86400) * 1000).toISOString(),
    refreshTokenExpiresAt: tokenData.refresh_token_expires_in
      ? new Date(now + Number(tokenData.refresh_token_expires_in) * 1000).toISOString()
      : (current.refreshTokenExpiresAt || ""),
    advertiserIds,
    authorizedAt: current.authorizedAt || new Date().toISOString(),
    lastVerifiedAt: new Date().toISOString(),
    lastError: "",
    reauthorizationRequired: false,
    pendingState: "",
    pendingStateExpiresAt: ""
  };
  await writeJson(AUTH_PATH, next);
  return next;
}

async function exchangeAuthCode(authCode) {
  const current = await readJson(AUTH_PATH, {});
  const appId = normalizeAppId(current.appId);
  const secret = await unprotectText(current.protectedSecret, "App Secret");
  const data = await requestOfficial("/open_api/oauth2/access_token/", {
    method: "POST",
    body: {
      app_id: Number(appId),
      auth_code: String(authCode || ""),
      secret
    }
  });
  return persistTokenResponse(data.data || {}, current, { requireRefreshToken: true });
}

async function refreshAccessToken(current) {
  const secret = await unprotectText(current.protectedSecret, "App Secret");
  const refreshToken = await unprotectText(current.protectedRefreshToken, "千川刷新令牌");
  const data = await requestOfficial("/open_api/oauth2/refresh_token/", {
    method: "POST",
    body: { secret, refresh_token: refreshToken }
  });
  return persistTokenResponse(data.data || {}, current);
}

async function accessToken() {
  let current = await readJson(AUTH_PATH, {});
  if (!current.protectedAccessToken) throw new Error("尚未完成千川官方授权");
  const expiresAt = Date.parse(current.accessTokenExpiresAt || "");
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now() + TOKEN_REFRESH_MARGIN_MS) {
    try {
      current = await refreshAccessToken(current);
    } catch (error) {
      const detail = String(error?.message || error || "");
      const tokenRejected = /auth_code|refresh[_ ]?token|missing data|required field|invalid|expired|过期|无效|失效/i.test(detail);
      if (tokenRejected) {
        await writeJson(AUTH_PATH, {
          ...current,
          lastError: detail,
          reauthorizationRequired: true,
          updatedAt: new Date().toISOString()
        }).catch(() => {});
        throw new Error("千川授权已过期或刷新令牌无效，请点击“授权千川账户”重新完成官方授权");
      }
      throw new Error(`千川令牌自动续期未完成：${detail}`);
    }
  }
  return unprotectText(current.protectedAccessToken, "千川访问令牌");
}

function callbackHtml(ok, message) {
  const title = ok ? "千川授权成功" : "千川授权未完成";
  const color = ok ? "#0f9b8e" : "#c65d47";
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>${title}</title>
  <body style="font-family:system-ui;padding:48px;background:#f4f8f6;color:#17332f">
  <main style="max-width:560px;margin:auto;background:white;padding:32px;border-radius:18px;border:1px solid #d8e7e2">
  <h1 style="color:${color}">${title}</h1><p>${String(message || "").replace(/[<>&]/g, "")}</p>
  <p>可以关闭此页面，返回“品牌营销部工作站”继续选择广告账户和推送素材。</p>
  <script>setTimeout(()=>{location.href=${JSON.stringify(`${String(process.env.WIS_WORKBENCH_PUBLIC_URL || "http://127.0.0.1:3766").replace(/\/+$/, "")}/remix.html#outputs`)}},1200)</script>
  </main></body></html>`;
}

async function handleCallback(req, res) {
  const url = new URL(req.url, CALLBACK_URL);
  const current = await readJson(AUTH_PATH, {});
  const state = url.searchParams.get("state") || "";
  const authCode = url.searchParams.get("auth_code") || url.searchParams.get("code") || "";
  const error = url.searchParams.get("error_description") || url.searchParams.get("error") || "";
  try {
    if (error) throw new Error(error);
    if (!current.pendingState || !state || state !== current.pendingState) {
      throw new Error("授权校验不一致，请从工作站重新发起授权");
    }
    if (Date.parse(current.pendingStateExpiresAt || "") < Date.now()) {
      throw new Error("授权请求已超时，请从工作站重新发起授权");
    }
    if (!authCode) throw new Error("回调中没有授权码，请重新授权");
    await exchangeAuthCode(authCode);
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(callbackHtml(true, "官方授权令牌已安全保存。"));
  } catch (callbackError) {
    await writeJson(AUTH_PATH, {
      ...current,
      lastError: callbackError.message,
      pendingState: "",
      pendingStateExpiresAt: ""
    }).catch(() => {});
    res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
    res.end(callbackHtml(false, callbackError.message));
  }
}

async function ensureCallbackServer() {
  if (callbackServer?.listening) return callbackServer;
  const callback = new URL(CALLBACK_URL);
  if (!["localhost", "127.0.0.1"].includes(callback.hostname)) {
    throw new Error("当前版本仅支持 localhost 千川回调地址");
  }
  const port = Number(callback.port || 80);
  callbackServer = http.createServer((req, res) => {
    const requestUrl = new URL(req.url, CALLBACK_URL);
    if (requestUrl.pathname !== callback.pathname) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not Found");
      return;
    }
    handleCallback(req, res).catch((error) => {
      res.writeHead(500, { "Content-Type": "text/html; charset=utf-8" });
      res.end(callbackHtml(false, error.message));
    });
  });
  await new Promise((resolve, reject) => {
    const onError = (error) => {
      callbackServer = null;
      reject(new Error(error.code === "EADDRINUSE"
        ? `本机端口 ${port} 已被占用，无法接收千川授权回调`
        : `千川授权回调服务启动失败：${error.message}`));
    };
    callbackServer.once("error", onError);
    callbackServer.listen(port, "127.0.0.1", () => {
      callbackServer.off("error", onError);
      resolve();
    });
  });
  return callbackServer;
}

async function startAuthorization() {
  const current = await readJson(AUTH_PATH, {});
  const appId = normalizeAppId(current.appId);
  if (!current.protectedSecret) throw new Error("请先保存千川 App ID 和 App Secret");
  const callback = new URL(CALLBACK_URL);
  if (["localhost", "127.0.0.1"].includes(callback.hostname)) await ensureCallbackServer();
  const stateValue = crypto.randomBytes(24).toString("hex");
  await writeJson(AUTH_PATH, {
    ...current,
    pendingState: stateValue,
    pendingStateExpiresAt: new Date(Date.now() + OAUTH_STATE_TTL_MS).toISOString(),
    lastError: ""
  });
  const url = new URL(AUTH_URL);
  url.searchParams.set("app_id", appId);
  url.searchParams.set("state", stateValue);
  url.searchParams.set("redirect_uri", CALLBACK_URL);
  url.searchParams.set("material_auth", "1");
  return { authorizeUrl: url.toString(), callbackUrl: CALLBACK_URL, expiresInSeconds: OAUTH_STATE_TTL_MS / 1000 };
}

function isShopManagementAccount(item = {}) {
  return [
    item.role,
    item.account_role,
    item.account_type,
    item.advertiser_role
  ].some((value) => String(value || "").toUpperCase() === "PLATFORM_ROLE_SHOP_ACCOUNT");
}

function isEnterpriseManagementAccount(item = {}) {
  return [
    item.role,
    item.account_role,
    item.account_type,
    item.advertiser_role
  ].some((value) => /PLATFORM_ROLE_ENTERPRISE|ENTERPRISE_BP/i.test(String(value || "")));
}

function isCustomerCenterManagementAccount(item = {}) {
  return [
    item.role,
    item.account_role,
    item.account_type,
    item.advertiser_role
  ].some((value) => ["CUSTOMER_ADMIN", "CUSTOMER_OPERATOR"].includes(String(value || "").toUpperCase()));
}

async function listCustomerCenterAdvertisers(token, customerCenterId) {
  const items = [];
  let page = 1;
  let totalPage = 1;
  do {
    const filter = encodeURIComponent(JSON.stringify({ account_type: "QIANCHUAN" }));
    const data = await requestOfficial(
      `/open_api/v3.0/customer_center/account/list/?account_id=${encodeURIComponent(customerCenterId)}` +
      `&filter=${filter}&page=${page}&page_size=100`,
      { token }
    );
    const rows = data?.data?.accounts || data?.data?.list || [];
    for (const item of rows) {
      const accountType = String(item.account_type || item.type || "").toUpperCase();
      const advertiserId = String(item.account_id || item.advertiser_id || item.id || "");
      if (!advertiserId || (accountType && accountType !== "QIANCHUAN")) continue;
      items.push({
        advertiserId,
        advertiserName: String(item.account_name || item.advertiser_name || item.name || `千川账户 ${advertiserId}`),
        accountType: "QIANCHUAN",
        accountTypeLabel: "巨量工作台关联千川账户",
        sourceCustomerCenterId: String(customerCenterId),
        statusLabel: item.is_valid === false ? "授权失效" : "授权有效",
        isValid: item.is_valid !== false
      });
    }
    const pageInfo = data?.data?.page_info || {};
    totalPage = Math.max(1, Number(pageInfo.total_page || Math.ceil(Number(pageInfo.total_number || 0) / 100) || 1));
    page += 1;
  } while (page <= totalPage && page <= 100);
  return items.filter((item) => item.isValid);
}

async function listEnterpriseAdvertisers(token, enterpriseId) {
  const items = [];
  let page = 1;
  let totalPage = 1;
  do {
    const data = await requestOfficial(
      `/open_api/2/ebp/advertiser/list/?enterprise_organization_id=${encodeURIComponent(enterpriseId)}` +
      `&account_source=QIANCHUAN&page=${page}&page_size=100`,
      { token }
    );
    const rows = data?.data?.account_list
      || data?.data?.list
      || data?.data?.advertiser_list
      || data?.data?.accounts
      || [];
    for (const item of rows) {
      const accountType = String(item.account_type || "QIANCHUAN").toUpperCase();
      const advertiserId = String(item.advertiser_id || item.account_id || item.id || "");
      if (!advertiserId || accountType !== "QIANCHUAN") continue;
      items.push({
        advertiserId,
        advertiserName: String(item.advertiser_name || item.account_name || item.name || `千川账户 ${advertiserId}`),
        accountType: "QIANCHUAN",
        accountTypeLabel: "企业工作台关联千川账户",
        sourceEnterpriseId: String(enterpriseId),
        statusLabel: item.is_valid === false ? "授权失效" : "授权有效",
        isValid: item.is_valid !== false
      });
    }
    const pageInfo = data?.data?.page_info || {};
    totalPage = Math.max(1, Number(pageInfo.total_page || Math.ceil(Number(pageInfo.total_number || 0) / 100) || 1));
    page += 1;
  } while (page <= totalPage && page <= 100);
  return items.filter((item) => item.isValid);
}

async function listShopAdvertiserIds(token, shopId) {
  const ids = [];
  let page = 1;
  let totalPage = 1;
  do {
    const data = await requestOfficial(
      `/open_api/v1.0/qianchuan/shop/advertiser/list/?shop_id=${encodeURIComponent(shopId)}&page=${page}&page_size=100`,
      { token }
    );
    const rows = data?.data?.adv_id_list || data?.data?.list || [];
    for (const item of rows) {
      const id = typeof item === "object" ? (item.adv_id || item.advertiser_id || item.id) : item;
      if (id) ids.push(String(id));
    }
    totalPage = Math.max(1, Number(data?.data?.page_info?.total_page || 1));
    page += 1;
  } while (page <= totalPage && page <= 20);
  return ids;
}

async function listAdvertiserDetails(token, advertiserIds) {
  const items = [];
  for (let offset = 0; offset < advertiserIds.length; offset += 50) {
    const batch = advertiserIds.slice(offset, offset + 50);
    const data = await requestOfficial(
      `/open_api/2/advertiser/public_info/?advertiser_ids=${encodeURIComponent(JSON.stringify(batch))}`,
      { token }
    );
    const rows = Array.isArray(data?.data) ? data.data : (data?.data?.list || []);
    for (const item of rows) {
      const advertiserId = String(item.id || item.advertiser_id || "");
      if (!advertiserId) continue;
      items.push({
        advertiserId,
        advertiserName: String(item.name || item.advertiser_name || `千川账户 ${advertiserId}`),
        accountType: "QIANCHUAN_ADVERTISER",
        accountTypeLabel: "抖店关联千川账户",
        company: String(item.company || ""),
        sourceShopId: "",
        statusLabel: "授权有效",
        isValid: true
      });
    }
  }
  return items;
}

async function listAccounts() {
  const token = await accessToken();
  const current = await readJson(AUTH_PATH, {});
  const secret = await unprotectText(current.protectedSecret, "App Secret");
  const data = await requestOfficial(
    `/open_api/oauth2/advertiser/get/?app_id=${encodeURIComponent(normalizeAppId(current.appId))}&secret=${encodeURIComponent(secret)}`,
    { token }
  );
  const rows = data?.data?.list || [];
  const directRows = rows.filter((item) => !isShopManagementAccount(item)
    && !isEnterpriseManagementAccount(item)
    && !isCustomerCenterManagementAccount(item));
  const shopRows = rows.filter(isShopManagementAccount);
  const enterpriseRows = rows.filter(isEnterpriseManagementAccount);
  const customerCenterRows = rows.filter(isCustomerCenterManagementAccount);
  const shopWarnings = [];
  const enterpriseWarnings = [];
  const customerCenterWarnings = [];
  const expanded = [];
  for (const shop of shopRows) {
    const shopId = String(shop.account_id || shop.advertiser_id || shop.id || "");
    if (!shopId) continue;
    try {
      const ids = await listShopAdvertiserIds(token, shopId);
      const details = await listAdvertiserDetails(token, [...new Set(ids)]);
      expanded.push(...details.map((item) => ({ ...item, sourceShopId: shopId })));
    } catch (error) {
      shopWarnings.push(`抖店 ${shop.account_name || shopId} 的关联千川账户读取未完成：${error.message}`);
    }
  }
  for (const enterprise of enterpriseRows) {
    const enterpriseId = String(enterprise.account_id || enterprise.advertiser_id || enterprise.id || "");
    if (!enterpriseId) continue;
    try {
      expanded.push(...await listEnterpriseAdvertisers(token, enterpriseId));
    } catch (error) {
      enterpriseWarnings.push(`企业工作台 ${enterprise.account_name || enterpriseId} 的千川子账户读取未完成：${error.message}`);
    }
  }
  for (const customerCenter of customerCenterRows) {
    const customerCenterId = String(customerCenter.account_id || customerCenter.advertiser_id || customerCenter.id || "");
    if (!customerCenterId) continue;
    try {
      expanded.push(...await listCustomerCenterAdvertisers(token, customerCenterId));
    } catch (error) {
      customerCenterWarnings.push(
        `巨量工作台 ${customerCenter.account_name || customerCenterId} 的千川业务账户读取未完成：${error.message}`
      );
    }
  }
  let accountTypes = new Map();
  const advertiserIds = [...directRows, ...expanded]
    .map((item) => Number(item.account_id || item.advertiser_id || item.advertiserId || 0))
    .filter((item) => Number.isFinite(item) && item > 0);
  if (advertiserIds.length) {
    try {
      const typeData = await requestOfficial(
        `/open_api/v1.0/qianchuan/advertiser/type/get/?advertiser_ids=${encodeURIComponent(JSON.stringify(advertiserIds))}`,
        { token }
      );
      accountTypes = new Map((typeData?.data?.list || []).map((item) => [
        String(item.advertiser_id || ""),
        {
          ecpType: String(item.ecp_type || ""),
          shopBusinessType: String(item.shop_business_type || "")
        }
      ]));
    } catch {
      // Account type is only display enrichment. Do not block account selection when this optional API is unavailable.
    }
  }
  const directItems = directRows.map((item) => {
    const advertiserId = String(item.account_id || item.advertiser_id || "");
    const detail = accountTypes.get(advertiserId) || {};
    return {
      advertiserId,
      advertiserName: String(item.account_name || item.advertiser_name || "未命名账户"),
      accountType: String(item.account_type || ""),
      ecpType: detail.ecpType || "",
      shopBusinessType: detail.shopBusinessType || "",
      accountTypeLabel: detail.ecpType === "SHOP_STAR"
        ? "达人店铺"
        : detail.ecpType === "COMMON_STAR"
          ? "达人账户"
          : detail.ecpType === "AGENT"
            ? "代理账户"
            : detail.ecpType === "SHOP"
              ? "店铺账户"
              : String(item.account_type || "千川账户"),
      statusLabel: item.is_valid === false ? "授权失效" : "授权有效",
      isValid: item.is_valid !== false
    };
  }).filter((item) => item.advertiserId && item.isValid);
  const items = [...new Map([...directItems, ...expanded].map((item) => [item.advertiserId, item])).values()]
    .sort((a, b) => a.advertiserName.localeCompare(b.advertiserName, "zh-CN"));
  await writeJson(AUTH_PATH, {
    ...current,
    advertiserIds: items.map((item) => item.advertiserId),
    lastVerifiedAt: new Date().toISOString(),
    lastError: items.length ? "" : "官方接口没有返回可用广告账户",
    reauthorizationRequired: items.length === 0
  });
  return {
    items,
    total: items.length,
    warnings: [...shopWarnings, ...enterpriseWarnings, ...customerCenterWarnings],
    reauthorizationRequired: items.length === 0,
    authorizationHint: items.length
      ? "这里只显示本次官方OAuth实时返回的有效广告账户；若缺少账户，请重新授权并补充勾选。"
      : "官方接口没有返回可用广告账户，旧缓存已自动排除；请重新授权并勾选需要使用的千川账户。"
  };
}

function qianchuanGoal(value) {
  return ["2", "LIVE_PROM_GOODS"].includes(String(value || "").toUpperCase())
    ? "LIVE_PROM_GOODS"
    : "VIDEO_PROM_GOODS";
}

function goalLabel(value) {
  return value === "LIVE_PROM_GOODS" ? "推直播间" : "推商品";
}

function planStatusLabel(value) {
  const labels = {
    ENABLE: "投放中",
    DISABLE: "已暂停",
    DELETE: "已删除",
    CAMPAIGN_STATUS_ENABLE: "投放中",
    CAMPAIGN_STATUS_DISABLE: "已暂停",
    AD_STATUS_DELIVERY_OK: "投放中",
    AD_STATUS_DISABLE: "已暂停",
    AD_STATUS_DONE: "已结束",
    AD_STATUS_AUDIT: "审核中",
    AD_STATUS_REJECT: "审核拒绝",
    AD_STATUS_BALANCE_EXCEED: "余额不足"
  };
  return labels[String(value || "")] || String(value || "状态未知");
}

function dateOnly(value, fallbackOffsetDays = -1) {
  const raw = String(value || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw) && !Number.isNaN(Date.parse(`${raw}T00:00:00Z`))) {
    return raw;
  }
  return new Date(Date.now() + fallbackOffsetDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function dayBoundaryDateTime(value, boundary = "start", fallbackOffsetDays = -1) {
  const date = dateOnly(value, fallbackOffsetDays);
  return `${date} ${boundary === "end" ? "23:59:59" : "00:00:00"}`;
}

const REPORT_FIELDS = [
  "stat_cost",
  "show_cnt",
  "click_cnt",
  "pay_order_count",
  "pay_order_amount",
  "prepay_and_pay_order_roi"
];

function reportRows(data) {
  return data?.data?.list || data?.data?.rows || data?.data?.data_list || [];
}

function metricNumber(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function reportMetrics(row = {}) {
  const metrics = row.metrics || row.stat_data || row;
  return {
    cost: metricNumber(metrics.stat_cost),
    impressions: metricNumber(metrics.show_cnt),
    clicks: metricNumber(metrics.click_cnt),
    orders: metricNumber(metrics.pay_order_count),
    gmv: metricNumber(metrics.pay_order_amount),
    roi: metricNumber(metrics.prepay_and_pay_order_roi)
  };
}

function summarizeReport(rows = []) {
  const totals = rows.reduce((result, row) => {
    const metrics = reportMetrics(row);
    result.cost += metrics.cost;
    result.impressions += metrics.impressions;
    result.clicks += metrics.clicks;
    result.orders += metrics.orders;
    result.gmv += metrics.gmv;
    return result;
  }, { cost: 0, impressions: 0, clicks: 0, orders: 0, gmv: 0 });
  totals.roi = totals.cost > 0 ? totals.gmv / totals.cost : 0;
  return totals;
}

async function readAdvertiserReport(token, options = {}) {
  const advertiserId = String(options.advertiserId || "");
  const filtering = encodeURIComponent(JSON.stringify({
    marketing_goal: qianchuanGoal(options.goal),
    order_platform: "QIANCHUAN"
  }));
  const fields = encodeURIComponent(JSON.stringify(REPORT_FIELDS));
  const data = await requestOfficial(
    `/open_api/v1.0/qianchuan/report/advertiser/get/?advertiser_id=${encodeURIComponent(advertiserId)}` +
    `&start_date=${encodeURIComponent(dateOnly(options.startDate, -7))}` +
    `&end_date=${encodeURIComponent(dateOnly(options.endDate, -1))}` +
    `&fields=${fields}&filtering=${filtering}&page=1&page_size=100`,
    { token }
  );
  const rows = reportRows(data);
  return { rows, totals: summarizeReport(rows) };
}

async function readMaterialReport(token, options = {}) {
  const advertiserId = String(options.advertiserId || "");
  const filtering = encodeURIComponent(JSON.stringify({
    marketing_goal: qianchuanGoal(options.goal),
    order_platform: "QIANCHUAN"
  }));
  const fields = encodeURIComponent(JSON.stringify(REPORT_FIELDS));
  const data = await requestOfficial(
    `/open_api/v1.0/qianchuan/report/material/get/?advertiser_id=${encodeURIComponent(advertiserId)}` +
    `&start_date=${encodeURIComponent(dateOnly(options.startDate, -7))}` +
    `&end_date=${encodeURIComponent(dateOnly(options.endDate, -1))}` +
    `&fields=${fields}&filtering=${filtering}&page=1&page_size=100`,
    { token }
  );
  return reportRows(data).map((row) => ({
    materialId: String(row.material_id || row.id || row.material?.material_id || ""),
    videoId: String(row.video_id || row.material?.video_id || ""),
    name: String(row.material_name || row.name || ""),
    metrics: reportMetrics(row)
  })).filter((row) => row.materialId || row.videoId);
}

async function listStandardPlans(token, advertiserId, marketingGoal) {
  const filtering = encodeURIComponent(JSON.stringify({ marketing_goal: marketingGoal }));
  const data = await requestOfficial(
    `/open_api/v1.0/qianchuan/ad/get/?advertiser_id=${encodeURIComponent(advertiserId)}&filtering=${filtering}&request_aweme_info=false&page=1&page_size=100`,
    { token }
  );
  return (data?.data?.list || []).map((item) => ({
    planId: String(item.ad_id || item.id || ""),
    planName: String(item.name || "未命名普通计划"),
    planType: "standard",
    planTypeLabel: "普通计划",
    canAttachVideo: false,
    attachHint: "官方接口没有安全的“仅追加素材”能力，工作站不会用整计划更新接口覆盖原设置。",
    marketingGoal: String(item.marketing_goal || marketingGoal),
    marketingGoalLabel: goalLabel(String(item.marketing_goal || marketingGoal)),
    marketingScene: String(item.marketing_scene || ""),
    campaignId: String(item.campaign_id || ""),
    campaignScene: String(item.campaign_scene || ""),
    status: String(item.status || item.opt_status || ""),
    statusLabel: planStatusLabel(item.status || item.opt_status),
    createdAt: String(item.ad_create_time || ""),
    modifiedAt: String(item.ad_modify_time || ""),
    productNames: (item.product_info || []).map((product) => String(product.product_name || product.name || "")).filter(Boolean)
  })).filter((item) => item.planId);
}

async function listUniPlans(token, advertiserId, marketingGoal, startDate, endDate) {
  const fields = encodeURIComponent(JSON.stringify(["stat_cost"]));
  const startTime = dayBoundaryDateTime(startDate, "start", -7);
  const endTime = dayBoundaryDateTime(endDate, "end", -1);
  const rows = [];
  for (let page = 1; page <= 100; page += 1) {
    const data = await requestOfficial(
      `/open_api/v1.0/qianchuan/uni_promotion/list/?advertiser_id=${encodeURIComponent(advertiserId)}` +
      `&start_time=${encodeURIComponent(startTime)}&end_time=${encodeURIComponent(endTime)}` +
      `&marketing_goal=${encodeURIComponent(marketingGoal)}&fields=${fields}&page=${page}&page_size=100`,
      { token }
    );
    const batch = data?.data?.ad_list || [];
    rows.push(...batch);
    const pageInfo = data?.data?.page_info || {};
    const totalPage = Number(pageInfo.total_page || pageInfo.totalPage || 0);
    if ((totalPage > 0 && page >= totalPage) || (totalPage <= 0 && batch.length < 100)) break;
  }
  return rows.map((item) => {
    const ad = item.ad_info || item;
    return {
      planId: String(ad.id || ad.ad_id || ""),
      planName: String(ad.name || "未命名全域计划"),
      planType: "uni_promotion",
      planTypeLabel: ad.adlab_scene === "OVERALL_PROJECT" ? "乘方计划" : "全域推广",
      canAttachVideo: true,
      attachHint: "支持通过官方API仅追加视频素材，不会启动投放或修改预算。",
      marketingGoal: String(ad.marketing_goal || marketingGoal),
      marketingGoalLabel: goalLabel(String(ad.marketing_goal || marketingGoal)),
      marketingScene: String(ad.marketing_services_mode || ""),
      campaignId: "",
      campaignScene: String(ad.adlab_scene || ""),
      status: String(ad.status || ad.opt_status || ""),
      statusLabel: planStatusLabel(ad.status || ad.opt_status),
      budget: Number(ad.budget || 0),
      budgetMode: String(ad.budget_mode || ""),
      roi2Goal: Number(ad.roi2_goal || 0),
      createdAt: String(ad.create_time || ""),
      modifiedAt: String(ad.modify_time || ""),
      productNames: (item.product_info || []).map((product) => String(product.product_name || product.name || "")).filter(Boolean)
    };
  }).filter((item) => item.planId);
}

async function listPlans(options = {}) {
  const advertiserId = String(options.advertiserId || "").trim();
  if (!advertiserId) throw new Error("请先选择已授权的千川广告账户");
  const token = await accessToken();
  const marketingGoal = qianchuanGoal(options.goal || options.marketingGoal);
  const startDate = dateOnly(options.startDate, -7);
  const endDate = dateOnly(options.endDate, -1);
  const results = await Promise.allSettled([
    listUniPlans(token, advertiserId, marketingGoal, startDate, endDate),
    listStandardPlans(token, advertiserId, marketingGoal)
  ]);
  const items = [];
  const warnings = [];
  const rejectedMessages = [];
  if (results[0].status === "fulfilled") items.push(...results[0].value);
  else {
    const message = String(results[0].reason?.message || results[0].reason || "未知错误");
    rejectedMessages.push(message);
    warnings.push(`全域/乘方计划读取未完成：${message}`);
  }
  if (results[1].status === "fulfilled") items.push(...results[1].value);
  else {
    const message = String(results[1].reason?.message || results[1].reason || "未知错误");
    rejectedMessages.push(message);
    warnings.push(`普通计划读取未完成：${message}`);
  }
  const invalidAccountPattern = /doesn['’]?t exist|role is wrong|advertiser[^;]*not exist|账户不存在|账号不存在|角色不正确|角色错误/i;
  const permissionPattern = /does no(?:t)? grant|permission|unauthorized|forbidden|无权限|未授权|权限不足|没有权限/i;
  const accountUnavailable = rejectedMessages.length > 0
    && rejectedMessages.every((message) => invalidAccountPattern.test(message));
  const permissionMissing = rejectedMessages.some((message) => permissionPattern.test(message));
  // Missing plan scopes do not invalidate OAuth. Upload and material-library access can still work.
  const reauthorizationRequired = accountUnavailable;
  if (!items.length && warnings.length === 2 && !reauthorizationRequired && !permissionMissing) {
    throw new Error(warnings.join("；"));
  }
  if (reauthorizationRequired || permissionMissing) {
    const current = await readJson(AUTH_PATH, {});
    await writeJson(AUTH_PATH, {
      ...current,
      advertiserIds: accountUnavailable
        ? (current.advertiserIds || []).map(String).filter((id) => id !== advertiserId)
        : (current.advertiserIds || []).map(String),
      lastError: accountUnavailable
        ? `千川账户 ${advertiserId} 已不在当前授权范围内`
        : "当前应用或账户缺少千川计划读取权限",
      reauthorizationRequired,
      lastVerifiedAt: new Date().toISOString()
    });
  }
  const unique = [...new Map(items.map((item) => [`${item.planType}:${item.planId}`, item])).values()]
    .sort((a, b) => {
      if (a.canAttachVideo !== b.canAttachVideo) return a.canAttachVideo ? -1 : 1;
      return String(b.modifiedAt || b.createdAt || "").localeCompare(String(a.modifiedAt || a.createdAt || ""));
    });
  return {
    advertiserId,
    marketingGoal,
    marketingGoalLabel: goalLabel(marketingGoal),
    items: unique,
    counts: {
      total: unique.length,
      attachable: unique.filter((item) => item.canAttachVideo).length,
      standard: unique.filter((item) => !item.canAttachVideo).length
    },
    warnings,
    accountUnavailable,
    permissionMissing,
    reauthorizationRequired,
    capabilities: {
      uniPlanRead: results[0].status === "fulfilled",
      standardPlanRead: results[1].status === "fulfilled",
      planRead: results.some((result) => result.status === "fulfilled"),
      materialUpload: true,
      planAttach: results[0].status === "fulfilled"
    },
    actionRequired: accountUnavailable
      ? "当前账户已不在本次授权范围或账号角色不匹配，系统已排除旧账户；请重新授权并勾选正确账户。"
      : permissionMissing
        ? "当前应用或账户缺少计划读取权限；请在巨量引擎开放平台补充千川计划读取权限后，重新授权并勾选账户。"
        : ""
  };
}

async function attachVideoToPlan(input = {}) {
  const advertiserId = String(input.advertiserId || "").trim();
  const planId = String(input.planId || "").trim();
  const videoId = String(input.videoId || "").trim();
  const planType = String(input.planType || "").trim();
  if (!advertiserId) throw new Error("请选择千川广告账户");
  if (!planId) throw new Error("请选择要接收素材的千川计划");
  if (!videoId) throw new Error("千川视频素材ID为空，无法关联计划");
  if (planType !== "uni_promotion") {
    throw new Error("当前普通计划不支持安全追加素材；请选择全域推广或乘方计划");
  }
  const token = await accessToken();
  const data = await requestOfficial("/open_api/v1.0/qianchuan/uni_promotion/ad/material/add/", {
    method: "POST",
    token,
    body: {
      advertiser_id: Number(advertiserId),
      ad_id: Number(planId),
      programmatic_creative_media_list: {
        video_material: [{ video_id: videoId }]
      }
    }
  });
  return {
    advertiserId,
    planId,
    planType,
    videoId,
    attachedAt: new Date().toISOString(),
    response: data?.data || {}
  };
}

async function check() {
  const accounts = await listAccounts();
  const current = await readJson(AUTH_PATH, {});
  await writeJson(AUTH_PATH, {
    ...current,
    lastVerifiedAt: new Date().toISOString(),
    lastError: ""
  });
  return { ...(await status()), accountCount: accounts.items.length };
}

async function sync(options = {}) {
  const advertiserId = String(options.advertiserId || "").trim();
  if (!advertiserId) throw new Error("请先选择已授权的千川广告账户");
  const token = await accessToken();
  const data = await requestOfficial(
    `/open_api/v1.0/qianchuan/video/get/?advertiser_id=${encodeURIComponent(advertiserId)}`,
    { token }
  );
  const rows = data?.data?.list || data?.data?.videos || [];
  const materials = rows.map((item) => ({
    materialId: String(item.material_id || item.id || ""),
    videoId: String(item.video_id || ""),
    name: String(item.name || item.filename || item.video_name || "未命名千川素材"),
    videoUrl: String(item.video_url || item.url || "")
  }));
  const accounts = await listAccounts();
  let plans = [];
  let planResult = { warnings: [], capabilities: { materialUpload: true } };
  try {
    planResult = await listPlans({
      advertiserId,
      startDate: options.startDate,
      endDate: options.endDate,
      goal: options.goal
    });
    plans = planResult.items;
  } catch (error) {
    planResult = {
      warnings: [`计划读取未完成：${error.message || error}`],
      capabilities: { materialUpload: true, planRead: false, planAttach: false }
    };
    // Material synchronization remains usable even when the plan-list permission is not enabled yet.
  }
  const reportResults = await Promise.allSettled([
    readAdvertiserReport(token, options),
    readMaterialReport(token, options)
  ]);
  const advertiserReport = reportResults[0].status === "fulfilled" ? reportResults[0].value : null;
  const materialPerformance = reportResults[1].status === "fulfilled" ? reportResults[1].value : [];
  const reportWarnings = reportResults.flatMap((result, index) => result.status === "rejected"
    ? [`${index === 0 ? "账户投放数据" : "素材投放数据"}读取未完成：${result.reason?.message || result.reason}`]
    : []);
  const account = accounts.items.find((item) => item.advertiserId === advertiserId) || {
    advertiserId,
    advertiserName: `千川账户 ${advertiserId}`
  };
  const cache = {
    version: 2,
    mode: "official_api",
    syncedAt: new Date().toISOString(),
    account,
    accounts: accounts.items,
    plans,
    materials,
    performance: advertiserReport,
    materialPerformance,
    warnings: [...(accounts.warnings || []), ...(planResult.warnings || []), ...reportWarnings],
    capabilities: {
      materialLibrary: true,
      materialUpload: true,
      planRead: Boolean(planResult.capabilities?.planRead),
      planAttach: Boolean(planResult.capabilities?.planAttach),
      advertiserReport: reportResults[0].status === "fulfilled",
      materialReport: reportResults[1].status === "fulfilled"
    },
    totals: {
      accounts: accounts.items.length,
      plans: plans.length,
      materials: materials.length,
      cost: advertiserReport?.totals?.cost || 0,
      gmv: advertiserReport?.totals?.gmv || 0,
      orders: advertiserReport?.totals?.orders || 0,
      roi: advertiserReport?.totals?.roi || 0,
      impressions: advertiserReport?.totals?.impressions || 0,
      clicks: advertiserReport?.totals?.clicks || 0
    }
  };
  await writeJson(CACHE_PATH, cache);
  return cache;
}

function isAllowedRemoteVideoUrl(value) {
  try {
    const parsed = new URL(String(value || ""));
    if (parsed.protocol === "https:") return true;
    return parsed.protocol === "http:" && ["127.0.0.1", "localhost", "::1"].includes(parsed.hostname);
  } catch {
    return false;
  }
}

async function downloadRemoteVideo(filePath) {
  if (!isAllowedRemoteVideoUrl(filePath)) {
    throw new Error("远程视频必须使用HTTPS地址");
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), VIDEO_DOWNLOAD_TIMEOUT_MS);
  try {
    const response = await fetch(filePath, {
      redirect: "follow",
      signal: controller.signal,
      headers: { "User-Agent": "WIS-Brand-Marketing-Workbench/Qianchuan" }
    });
    if (!response.ok) throw new Error(`远程视频下载失败（HTTP ${response.status}）`);
    if (!isAllowedRemoteVideoUrl(response.url || filePath)) {
      throw new Error("远程视频跳转到了不安全的地址");
    }
    const declaredSize = Number(response.headers.get("content-length") || 0);
    if (declaredSize > MAX_VIDEO_UPLOAD_BYTES) throw new Error("视频超过500MB，无法上传到千川素材库");
    const chunks = [];
    let size = 0;
    for await (const chunk of response.body || []) {
      const buffer = Buffer.from(chunk);
      size += buffer.length;
      if (size > MAX_VIDEO_UPLOAD_BYTES) {
        controller.abort();
        throw new Error("视频超过500MB，无法上传到千川素材库");
      }
      chunks.push(buffer);
    }
    if (!size) throw new Error("远程视频内容为空");
    let fileName = "WIS视频素材.mp4";
    try {
      fileName = decodeURIComponent(path.basename(new URL(response.url || filePath).pathname)) || fileName;
    } catch {}
    return { buffer: Buffer.concat(chunks, size), fileName };
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("远程视频下载超时，请稍后重试");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function readUploadVideo(filePath) {
  if (/^https?:\/\//i.test(filePath)) return downloadRemoteVideo(filePath);
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) throw new Error("待推送视频文件不存在");
  const stat = await fsp.stat(resolved);
  if (stat.size > MAX_VIDEO_UPLOAD_BYTES) throw new Error("视频超过500MB，无法上传到千川素材库");
  if (!stat.size) throw new Error("待推送视频文件为空");
  return { buffer: await fsp.readFile(resolved), fileName: path.basename(resolved) };
}

async function uploadVideo(input = {}) {
  const advertiserId = String(input.advertiserId || "").trim();
  const filePath = String(input.filePath || "").trim();
  const title = String(input.title || path.basename(filePath || "WIS视频素材")).trim().slice(0, 100);
  if (!advertiserId) throw new Error("请选择千川广告账户");
  if (!filePath) throw new Error("待推送视频地址为空");
  const token = await accessToken();
  const form = new FormData();
  form.append("advertiser_id", advertiserId);
  form.append("filename", title.endsWith(".mp4") ? title : `${title}.mp4`);
  // The official multipart endpoint rejects stringified boolean values for
  // is_aigc. The proven Cloud Manager upload path omits this optional field.
  // Qianchuan's URL mode only accepts its designated Lianshan TOS storage.
  // Company OSS and other HTTPS sources are therefore downloaded by the
  // workbench first and submitted through the proven file-upload path.
  const upload = await readUploadVideo(filePath);
  form.append("upload_type", "UPLOAD_BY_FILE");
  form.append("video_signature", crypto.createHash("md5").update(upload.buffer).digest("hex"));
  form.append("video_file", new Blob([upload.buffer], { type: "video/mp4" }), upload.fileName);
  const data = await requestOfficial("/open_api/2/file/video/ad/", {
    method: "POST",
    token,
    formData: form,
    timeoutMs: 5 * 60 * 1000
  });
  const result = data.data || {};
  if (!result.video_id && !result.material_id) throw new Error("千川上传完成但未返回素材ID，请稍后在素材库核对");
  return {
    advertiserId,
    videoId: String(result.video_id || ""),
    materialId: String(result.material_id || ""),
    videoUrl: String(result.video_url || ""),
    width: Number(result.width || 0),
    height: Number(result.height || 0),
    duration: Number(result.duration || 0),
    size: Number(result.size || 0),
    uploadedAt: new Date().toISOString()
  };
}

async function disconnect() {
  const current = await readJson(AUTH_PATH, {});
  if (!current.appId && !current.protectedSecret) {
    await fsp.rm(AUTH_PATH, { force: true });
    return status();
  }
  await writeJson(AUTH_PATH, {
    version: 2,
    mode: "official_api",
    appId: current.appId || DEFAULT_APP_ID,
    callbackUrl: CALLBACK_URL,
    protectedSecret: current.protectedSecret || "",
    configuredAt: current.configuredAt || "",
    updatedAt: new Date().toISOString()
  });
  return status();
}

async function status() {
  const auth = await readJson(AUTH_PATH, {});
  const cache = await readJson(CACHE_PATH, {});
  const credentialsConfigured = Boolean(auth.appId && auth.protectedSecret);
  const authorized = Boolean(
    auth.protectedAccessToken
    && auth.protectedRefreshToken
    && !auth.reauthorizationRequired
  );
  return {
    mode: "official_api",
    appId: auth.appId || DEFAULT_APP_ID,
    callbackUrl: CALLBACK_URL,
    credentialsConfigured,
    configured: authorized,
    authorized,
    authorizedAt: auth.authorizedAt || "",
    lastVerifiedAt: auth.lastVerifiedAt || "",
    accessTokenExpiresAt: auth.accessTokenExpiresAt || "",
    accountCount: Array.isArray(auth.advertiserIds) ? auth.advertiserIds.length : 0,
    authorizationPending: Boolean(auth.pendingState && Date.parse(auth.pendingStateExpiresAt || "") > Date.now()),
    reauthorizationRequired: Boolean(auth.reauthorizationRequired),
    lastError: auth.lastError || "",
    lastSync: cache.syncedAt ? {
      syncedAt: cache.syncedAt,
      account: cache.account || null,
      totals: cache.totals || {},
      capabilities: cache.capabilities || {},
      warnings: cache.warnings || []
    } : null,
    storage: process.platform === "win32"
      ? "App Secret与令牌由Windows当前用户加密保存"
      : "App Secret与令牌由工作站服务端加密保存"
  };
}

module.exports = {
  API_BASE,
  AUTH_PATH,
  CACHE_PATH,
  CALLBACK_URL,
  DEFAULT_APP_ID,
  AUTH_URL,
  check,
  configure,
  disconnect,
  attachVideoToPlan,
  handleCallback,
  listAccounts,
  listPlans,
  startAuthorization,
  status,
  sync,
  uploadVideo,
  _test: {
    accessToken,
    downloadRemoteVideo,
    ensureCallbackServer,
    exchangeAuthCode,
    protectPortable,
    protectText,
    requestOfficial,
    unprotectPortable,
    unprotectText
  }
};
