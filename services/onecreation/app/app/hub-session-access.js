"use strict";

const { createIdentityStore } = require("./collaboration-identity.js");

function accessError(message, statusCode, code) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function createHubSessionAccess(options = {}) {
  const endpoint = String(options.endpoint || process.env.WIS_HUB_SESSION_URL || "").trim();
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const timeoutMs = Math.max(1000, Number(options.timeoutMs || 15000));
  const identities = options.identities || createIdentityStore();

  async function authorizeRequest(req, moduleKey = "ai-first-creation") {
    if (!endpoint) throw accessError("中枢会话接口尚未配置", 503, "HUB_SESSION_UNAVAILABLE");
    const cookie = String(req?.headers?.cookie || "").trim();
    const oaToken = String(req?.headers?.["x-oa-token"] || "").trim();
    if (!cookie && !oaToken) {
      throw accessError("请先登录中枢平台", 401, "HUB_LOGIN_REQUIRED");
    }
    let response;
    let body;
    try {
      response = await fetchImpl(endpoint, {
        method: "GET",
        headers: {
          Accept: "application/json",
          ...(cookie ? { Cookie: cookie } : {}),
          ...(oaToken ? { "X-OA-Token": oaToken } : {}),
        },
        redirect: "manual",
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (response.status === 401 || response.status === 302 || response.status === 303) {
        throw accessError("中枢登录已失效，请重新登录", 401, "HUB_LOGIN_REQUIRED");
      }
      if (response.status !== 200) {
        throw accessError(response.status === 403 ? "当前账号未开通中枢权限" : "中枢登录校验暂时不可用",
          response.status === 403 ? 403 : 503,
          response.status === 403 ? "HUB_ACCESS_DENIED" : "HUB_SESSION_UNAVAILABLE");
      }
      body = await response.json();
    } catch (error) {
      if (error?.code && error?.statusCode) throw error;
      throw accessError("中枢登录校验暂时不可用", 503, "HUB_SESSION_UNAVAILABLE");
    }
    if (!body || typeof body !== "object") {
      throw accessError("中枢登录校验暂时不可用", 503, "HUB_SESSION_UNAVAILABLE");
    }
    const number = String(body.user?.number || body.user?.userNumber || body.user?.employeeNumber
      || body.user?.employee_no || body.user?.userId || body.user?.id || "").trim();
    if (!number) throw accessError("中枢未返回可核验的工号", 503, "HUB_IDENTITY_MISSING");
    const modules = body.access?.allowed_modules;
    if (!Array.isArray(modules) || !modules.includes(moduleKey)) {
      const label = moduleKey === "material-workbench" ? "创意来源" : "一创创作";
      throw accessError(`当前账号未开通${label}界面权限`, 403, "HUB_MODULE_DENIED");
    }
    const user = body.user;
    const workbenchUser = {
      sub: number,
      number,
      name: String(user.realName || user.real_name || user.name || "").trim(),
      lark_user_id: String(user.lark_user_id || user.open_id || "").trim(),
      groupName: String(user.groupName || user.parentDept || user.deptName || user.department || "").trim(),
      department: String(user.department || user.deptName || user.parentDept || user.groupName || "").trim(),
      center: String(user.center || "").trim(),
      status: String(user.status || "normal").trim() || "normal",
      roles: [],
      is_super_admin: false,
      scope_label: "中枢统一登录",
    };
    workbenchUser.collaborationIdentity = identities.get(number) || null;
    return {
      authority: "wis-marketing-hub",
      module: moduleKey,
      access: { access_mode: body.access?.access_mode || "selected", allowed_modules: modules },
      workbenchUser,
    };
  }

  return { authorizeRequest };
}

module.exports = { createHubSessionAccess };
