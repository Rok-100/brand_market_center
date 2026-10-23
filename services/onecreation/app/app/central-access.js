"use strict";

const DEFAULT_MODULE = "ai-first-creation";
const DEFAULT_TTL_MS = 15_000;
const DEFAULT_TIMEOUT_MS = 30_000;
const { createIdentityStore } = require("./collaboration-identity.js");

function authorityUser(body = {}) {
  const user = body?.user || {};
  const number = String(user.number || user.userId || user.id || user.username || user.userName || "").trim();
  const larkUserId = String(user.open_id || user.lark_user_id || user.larkUserId || "").trim();
  const name = String(user.realName || user.name || "").trim();
  if (!number && !name && !larkUserId) {
    throw createAccessError("中枢权限中心未返回完整登录身份", 503, "CENTRAL_IDENTITY_MISSING");
  }
  return {
    sub: number || larkUserId || name,
    number,
    lark_user_id: larkUserId,
    name,
    groupName: String(user.groupName || user.parentDept || user.deptName || user.department || "").trim(),
    department: String(user.department || user.deptName || user.parentDept || user.groupName || "").trim(),
    center: String(user.center || "").trim(),
    status: String(user.status || "normal").trim() || "normal",
    roles: [],
    is_super_admin: false,
    scope_label: "中枢统一登录"
  };
}

function createAccessError(message, statusCode = 503, code = "CENTRAL_ACCESS_UNAVAILABLE") {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function createCentralAccessClient(options = {}) {
  const endpoint = String(
    options.endpoint
    ?? process.env.WIS_CENTRAL_ACCESS_URL
    ?? "https://app.fandow.top/fd-026222/wis-video-center/api/workstation/access-authorize-identity"
  ).trim();
  const oaEndpoint = String(
    options.oaEndpoint
    ?? process.env.WIS_CENTRAL_OA_ACCESS_URL
    ?? endpoint.replace(/-identity(?=\?|$)/u, "")
  ).trim();
  const serviceToken = String(options.serviceToken ?? process.env.WIS_WORKSTATION_API_TOKEN ?? "").trim();
  const moduleKey = String(options.moduleKey ?? process.env.WIS_CENTRAL_MODULE ?? DEFAULT_MODULE).trim() || DEFAULT_MODULE;
  const moduleLabel = moduleKey === "material-workbench" ? "二创混剪工作台" : "AI一创工作台";
  const ttlMs = Math.max(0, Number(options.ttlMs ?? process.env.WIS_CENTRAL_ACCESS_CACHE_MS ?? DEFAULT_TTL_MS));
  const timeoutMs = Math.max(1_000, Number(
    options.timeoutMs
    ?? process.env.WIS_CENTRAL_ACCESS_TIMEOUT_MS
    ?? DEFAULT_TIMEOUT_MS
  ));
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const cache = new Map();
  const collaborationIdentities = createIdentityStore();

  function status() {
    return {
      configured: Boolean(endpoint && oaEndpoint && serviceToken.length >= 32),
      module: moduleKey,
      cacheSeconds: Math.round(ttlMs / 1000),
      timeoutSeconds: Math.round(timeoutMs / 1000),
      collaborationIdentity: collaborationIdentities.status()
    };
  }

  function validateAuthorityResponse(response, body = {}) {
    if (!response.ok || body?.allowed !== true) {
      const detail = String(body?.detail || body?.error || "").trim();
      const statusCode = response.status === 401 ? 503 : (response.status === 403 ? 403 : Math.max(400, response.status || 503));
      throw createAccessError(
        detail || (statusCode === 403 ? `当前账号未开通 ${moduleLabel}访问权限` : "中枢权限中心校验失败"),
        statusCode,
        statusCode === 403 ? "CENTRAL_MODULE_DENIED" : "CENTRAL_ACCESS_UNAVAILABLE"
      );
    }
    const allowedModules = Array.isArray(body?.access?.allowed_modules) ? body.access.allowed_modules : [];
    if (!allowedModules.includes(moduleKey)) {
      throw createAccessError(`当前账号未开通 ${moduleLabel}访问权限`, 403, "CENTRAL_MODULE_DENIED");
    }
    return { ...body, checkedAt: new Date().toISOString() };
  }

  function identityFor(user = {}) {
    const number = String(user.sub || user.number || user.userId || user.id || "").trim();
    const larkUserId = String(user.lark_user_id || user.larkUserId || user.open_id || "").trim();
    const name = String(user.name || user.realName || "").trim();
    if (!number && !name && !larkUserId) {
      throw createAccessError("登录身份不完整，请重新登录", 401, "CENTRAL_IDENTITY_MISSING");
    }
    return { number, name, lark_user_id: larkUserId };
  }

  async function authorize(user = {}, options = {}) {
    if (!endpoint || serviceToken.length < 32 || typeof fetchImpl !== "function") {
      throw createAccessError("中枢权限中心尚未完成工作台接入配置");
    }
    const identity = identityFor(user);
    const cacheKey = `${identity.number}|${identity.lark_user_id}|${identity.name}|${moduleKey}`;
    const cached = cache.get(cacheKey);
    if (!options.force && cached && cached.expiresAt > Date.now()) return cached.value;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    let body = {};
    try {
      const url = new URL(endpoint);
      url.searchParams.set("module", moduleKey);
      response = await fetchImpl(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-WIS-Workstation-Token": serviceToken
        },
        body: JSON.stringify(identity),
        signal: controller.signal
      });
      body = await response.json().catch(() => ({}));
    } catch (error) {
      const message = error?.name === "AbortError"
        ? "中枢权限中心校验超时，请稍后重试"
        : `中枢权限中心暂时不可用：${error.message || error}`;
      throw createAccessError(message);
    } finally {
      clearTimeout(timer);
    }

    const value = validateAuthorityResponse(response, body);
    cache.set(cacheKey, { value, expiresAt: Date.now() + ttlMs });
    return value;
  }

  async function authorizeOaToken(rawToken = "", options = {}) {
    const oaToken = String(rawToken || "").trim();
    if (!oaEndpoint || serviceToken.length < 32 || typeof fetchImpl !== "function") {
      throw createAccessError("中枢权限中心尚未完成工作台接入配置");
    }
    if (!oaToken) throw createAccessError("OA 登录状态无效，请重新登录", 401, "CENTRAL_IDENTITY_MISSING");
    const tokenHash = require("crypto").createHash("sha256").update(oaToken).digest("hex");
    const cacheKey = `oa:${tokenHash}:${moduleKey}`;
    const cached = cache.get(cacheKey);
    if (!options.force && cached && cached.expiresAt > Date.now()) {
      cached.value.workbenchUser.collaborationIdentity = collaborationIdentities.get(cached.value.workbenchUser.number) || null;
      return cached.value;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    let body = {};
    try {
      const url = new URL(oaEndpoint);
      url.searchParams.set("module", moduleKey);
      response = await fetchImpl(url, {
        method: "GET",
        headers: {
          "X-WIS-Workstation-Token": serviceToken,
          "X-OA-Token": oaToken
        },
        signal: controller.signal
      });
      body = await response.json().catch(() => ({}));
    } catch (error) {
      const message = error?.name === "AbortError"
        ? "中枢权限中心校验超时，请稍后重试"
        : `中枢权限中心暂时不可用：${error.message || error}`;
      throw createAccessError(message);
    } finally {
      clearTimeout(timer);
    }
    const value = validateAuthorityResponse(response, body);
    value.workbenchUser = authorityUser(body);
    // Do not replace open_id/lark_user_id: OA may use a different namespace.
    // Only the independent, release-verified employee mapping is enriched.
    value.workbenchUser.collaborationIdentity = collaborationIdentities.get(value.workbenchUser.number) || null;
    cache.set(cacheKey, { value, expiresAt: Date.now() + ttlMs });
    return value;
  }

  return { authorize, authorizeOaToken, status };
}

module.exports = { createCentralAccessClient };
