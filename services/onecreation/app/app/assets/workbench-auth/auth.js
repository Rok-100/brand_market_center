const crypto = require("crypto");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const { URL } = require("url");

const COOKIE_NAME = "fandao_ai_workbench_session";
const MAX_PENDING_STATES = 50;
const PENDING_STATE_TTL_MS = Math.max(
  10 * 60 * 1000,
  Math.min(60 * 60 * 1000, Number(process.env.AI_WORKBENCH_LOGIN_TTL_MS || 30 * 60 * 1000))
);

function base64UrlJson(value) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function parseCookies(req) {
  return String(req.headers.cookie || "")
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((result, item) => {
      const splitAt = item.indexOf("=");
      if (splitAt <= 0) return result;
      const key = item.slice(0, splitAt);
      const value = item.slice(splitAt + 1);
      result[key] = decodeURIComponent(value);
      return result;
    }, {});
}

function timingSafeTextEqual(left, right) {
  const a = Buffer.from(String(left || ""), "utf8");
  const b = Buffer.from(String(right || ""), "utf8");
  if (!a.length || a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function readJsonFile(filePath, fallback = {}) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function resolveAuthDataDir() {
  const localRoot = process.env.LOCALAPPDATA || process.env.APPDATA || __dirname;
  return path.join(localRoot, "Fandao", "AI视频工作台");
}

function resolveDeviceFile() {
  return path.join(resolveAuthDataDir(), "auth-device.json");
}

function resolvePendingStatesFile() {
  return path.join(resolveAuthDataDir(), "auth-pending-states.json");
}

function resolveSessionSecret() {
  const localRoot = process.env.LOCALAPPDATA || process.env.APPDATA || __dirname;
  const secretFile = path.join(localRoot, "Fandao", "AI视频工作台", "auth-session-secret.txt");
  try {
    const existing = fs.readFileSync(secretFile, "utf8").trim();
    if (/^[A-Za-z0-9_-]{32,128}$/.test(existing)) return existing;
  } catch {
    // 首次启动时创建持久会话密钥。
  }
  const secret = crypto.randomBytes(32).toString("base64url");
  fs.mkdirSync(path.dirname(secretFile), { recursive: true });
  fs.writeFileSync(secretFile, secret, { encoding: "utf8", mode: 0o600 });
  return secret;
}

function createAuthManager({ appRoot, appVersion }) {
  const configPath = path.join(appRoot, "auth-config.json");
  const deviceFile = resolveDeviceFile();
  const pendingStatesFile = resolvePendingStatesFile();
  const pendingStateData = readJsonFile(pendingStatesFile, {});
  const pendingStates = new Map(
    (Array.isArray(pendingStateData.states) ? pendingStateData.states : [])
      .filter((record) => record && typeof record.state === "string")
      .map((record) => [record.state, {
        deviceId: String(record.deviceId || ""),
        callbackUrl: String(record.callbackUrl || ""),
        expiresAt: Number(record.expiresAt || 0)
      }])
  );
  const internalToken = String(process.env.AI_WORKBENCH_INTERNAL_TOKEN || resolveSessionSecret());
  process.env.AI_WORKBENCH_INTERNAL_TOKEN = internalToken;

  function loadConfig() {
    const config = readJsonFile(configPath, {});
    return {
      enabled: config.enabled !== false,
      gatewayUrl: String(config.gatewayUrl || "").trim(),
      issuer: String(config.issuer || "").trim(),
      audience: String(config.audience || "ai-video-workbench").trim(),
      keyId: String(config.keyId || "").trim(),
      collaborationApiKey: String(config.collaborationApiKey || "").trim(),
      publicKey: String(config.publicKey || "").trim(),
      publicUrl: String(process.env.AI_WORKBENCH_PUBLIC_URL || config.publicUrl || "").trim(),
      scopeLabel: String(config.scopeLabel || "品牌营销部（含所有中心）").trim()
    };
  }

  async function getDeviceId() {
    const existing = readJsonFile(deviceFile, {});
    if (/^[A-Za-z0-9_-]{16,128}$/.test(String(existing.deviceId || ""))) {
      return existing.deviceId;
    }
    const deviceId = crypto.randomBytes(32).toString("base64url");
    await fsp.mkdir(path.dirname(deviceFile), { recursive: true });
    await fsp.writeFile(deviceFile, JSON.stringify({
      deviceId,
      createdAt: new Date().toISOString()
    }, null, 2), "utf8");
    return deviceId;
  }

  function persistPendingStates() {
    fs.mkdirSync(path.dirname(pendingStatesFile), { recursive: true });
    const tempFile = `${pendingStatesFile}.tmp`;
    const states = Array.from(pendingStates.entries()).map(([state, record]) => ({
      state,
      deviceId: record.deviceId,
      callbackUrl: record.callbackUrl,
      expiresAt: record.expiresAt
    }));
    fs.writeFileSync(tempFile, JSON.stringify({ states }, null, 2), {
      encoding: "utf8",
      mode: 0o600
    });
    fs.renameSync(tempFile, pendingStatesFile);
  }

  function cleanupPendingStates() {
    const now = Date.now();
    let changed = false;
    for (const [state, record] of pendingStates.entries()) {
      if (record.expiresAt <= now) {
        pendingStates.delete(state);
        changed = true;
      }
    }
    while (pendingStates.size > MAX_PENDING_STATES) {
      const oldest = pendingStates.keys().next().value;
      if (!oldest) break;
      pendingStates.delete(oldest);
      changed = true;
    }
    if (changed) persistPendingStates();
  }

  function resolvePublicBaseUrl(config = loadConfig()) {
    if (!config.publicUrl) return "";
    const publicUrl = new URL(config.publicUrl);
    if (!/^https?:$/.test(publicUrl.protocol) || publicUrl.username || publicUrl.password) {
      throw new Error("线上工作台地址配置无效");
    }
    publicUrl.search = "";
    publicUrl.hash = "";
    publicUrl.pathname = publicUrl.pathname.replace(/\/+$/, "");
    return publicUrl.toString().replace(/\/$/, "");
  }

  function resolveCallbackUrl(config = loadConfig()) {
    const publicBaseUrl = resolvePublicBaseUrl(config);
    return publicBaseUrl
      ? `${publicBaseUrl}/api/auth/callback`
      : "http://127.0.0.1:3766/api/auth/callback";
  }

  function getPostLoginRedirect() {
    return resolvePublicBaseUrl() || "/";
  }

  function getPostLoginContinuationRedirect() {
    const publicBaseUrl = resolvePublicBaseUrl();
    return publicBaseUrl
      ? `${publicBaseUrl}/login.html?connected=1`
      : "/login.html?connected=1";
  }

  async function beginLogin() {
    const config = loadConfig();
    if (!config.enabled) throw new Error("飞书登录尚未启用");
    if (!config.gatewayUrl || !config.publicKey || !config.issuer || !config.keyId) {
      throw new Error("飞书登录中心尚未完成发布配置");
    }
    cleanupPendingStates();
    const state = crypto.randomBytes(32).toString("base64url");
    const deviceId = await getDeviceId();
    const callbackUrl = resolveCallbackUrl(config);
    pendingStates.set(state, {
      deviceId,
      callbackUrl,
      expiresAt: Date.now() + PENDING_STATE_TTL_MS
    });
    persistPendingStates();
    const loginUrl = new URL(config.gatewayUrl);
    loginUrl.searchParams.set("state", state);
    loginUrl.searchParams.set("device_id", deviceId);
    loginUrl.searchParams.set("workbench_version", appVersion);
    loginUrl.searchParams.set("callback_url", callbackUrl);
    return {
      loginUrl: loginUrl.toString(),
      state,
      expiresAt: new Date(Date.now() + PENDING_STATE_TTL_MS).toISOString(),
      scopeLabel: config.scopeLabel
    };
  }

  function verifyTicket(ticket, expected = {}) {
    const config = loadConfig();
    if (!config.enabled) throw new Error("飞书登录尚未启用");
    if (!config.publicKey) throw new Error("登录公钥尚未配置");
    const parts = String(ticket || "").split(".");
    if (parts.length !== 3) throw new Error("登录凭证格式无效");
    let header;
    let payload;
    try {
      header = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
      payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    } catch {
      throw new Error("登录凭证内容无效");
    }
    if (header.alg !== "RS256" || header.typ !== "JWT" || header.kid !== config.keyId) {
      throw new Error("登录凭证签名类型无效");
    }
    const verifier = crypto.createVerify("RSA-SHA256");
    verifier.update(`${parts[0]}.${parts[1]}`);
    verifier.end();
    const signatureValid = verifier.verify(
      config.publicKey,
      Buffer.from(parts[2], "base64url")
    );
    if (!signatureValid) throw new Error("登录凭证签名校验失败");
    const now = Math.floor(Date.now() / 1000);
    if (payload.iss !== config.issuer || payload.aud !== config.audience) {
      throw new Error("登录凭证来源无效");
    }
    if (!Number.isFinite(payload.exp) || payload.exp <= now) {
      throw new Error("登录已过期，请重新使用飞书账号登录");
    }
    if (!Number.isFinite(payload.iat) || payload.iat > now + 60) {
      throw new Error("登录凭证时间无效");
    }
    if (!payload.sub || !payload.lark_user_id || !payload.name || !payload.device_id) {
      throw new Error("登录凭证缺少用户信息");
    }
    if (expected.state && payload.state !== expected.state) {
      throw new Error("登录请求校验失败，请重新发起登录");
    }
    if (expected.deviceId && payload.device_id !== expected.deviceId) {
      throw new Error("该登录凭证不属于当前电脑");
    }
    if (expected.callbackUrl && payload.callback_url !== expected.callbackUrl) {
      throw new Error("登录返回地址校验失败，请重新发起登录");
    }
    return payload;
  }

  async function completeLogin(ticket, state) {
    cleanupPendingStates();
    const pending = pendingStates.get(String(state || ""));
    if (!pending || pending.expiresAt <= Date.now()) {
      throw new Error("登录请求已过期，请回到工作台重新登录");
    }
    const deviceId = await getDeviceId();
    if (pending.deviceId !== deviceId) throw new Error("当前设备登录请求不一致");
    const payload = verifyTicket(ticket, {
      state,
      deviceId,
      callbackUrl: pending.callbackUrl
    });
    pendingStates.delete(state);
    persistPendingStates();
    return payload;
  }

  function authenticateRequest(req) {
    const internalHeader = String(req.headers["x-ai-workbench-internal"] || "");
    if (timingSafeTextEqual(internalHeader, internalToken)) {
      return {
        ok: true,
        internal: true,
        user: {
          sub: "internal-service",
          name: "工作台内部服务",
          roles: ["internal_service"],
          is_super_admin: false
        }
      };
    }
    const token = parseCookies(req)[COOKIE_NAME];
    if (!token) return { ok: false, status: 401, error: "请先使用飞书账号登录" };
    try {
      const payload = verifyTicket(token);
      return { ok: true, internal: false, user: payload, token };
    } catch (error) {
      return { ok: false, status: 401, error: error.message };
    }
  }

  function createSessionCookie(ticket, expiresAt) {
    const now = Math.floor(Date.now() / 1000);
    const maxAge = Math.max(0, Number(expiresAt || now) - now);
    return `${COOKIE_NAME}=${encodeURIComponent(ticket)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}`;
  }

  function clearSessionCookie() {
    return `${COOKIE_NAME}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`;
  }

  function publicUser(payload) {
    if (!payload) return null;
    return {
      id: payload.sub,
      larkUserId: payload.lark_user_id,
      name: payload.name,
      roles: Array.isArray(payload.roles) ? payload.roles : [],
      isSuperAdmin: Boolean(payload.is_super_admin),
      scopeLabel: payload.scope_label || loadConfig().scopeLabel,
      expiresAt: new Date(Number(payload.exp || 0) * 1000).toISOString()
    };
  }

  return {
    beginLogin,
    completeLogin,
    authenticateRequest,
    createSessionCookie,
    clearSessionCookie,
    publicUser,
    getDeviceId,
    getPostLoginRedirect,
    getPostLoginContinuationRedirect,
    getConfig: loadConfig,
    internalToken
  };
}

module.exports = {
  COOKIE_NAME,
  createAuthManager
};
