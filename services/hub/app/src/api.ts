import type { AdminGrant, AssistantAttachment, AssistantConversation, AssistantMessage, AssistantResponse, AssistantStatus, BusinessIntelligenceOverview, CreativeIncentiveDirection, CreativeIncentiveMilestone, CreativeIncentiveOverview, DashboardScope, DashboardScopeGrant, HubSession, LibTvCreditAuthStatus, LibTvCreditTrend, LoginGrant, LongTermWorkSchedulerStatus, ModuleAccessGrant, OperationLog, OptimizationResponse, OrganizationDashboardOverview, PermissionPreview, PermissionPreviewSubject, TaskCenterItem, TaskCenterOverview, TaskCenterSourceKind, TaskCenterStatus, WorkspaceHomeSummary } from "./types";

import type {OrganizationEntries} from './OrganizationEntryControl';

export class ApiError extends Error {
  constructor(message: string, public status: number, public payload?: unknown) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...options,
    headers: { ...(options?.body ? { "Content-Type": "application/json" } : {}), ...(options?.headers || {}) },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof payload.detail === "string"
      ? payload.detail
      : typeof payload.detail?.message === "string"
        ? payload.detail.message
      : typeof payload.message === "string"
        ? payload.message
        : typeof payload.error === "string"
          ? payload.error
          : `请求未完成（${response.status}）`;
    throw new ApiError(message, response.status, payload);
  }
  return payload as T;
}

const transientStatuses = new Set([302, 408, 425, 429, 502, 503, 504]);

export function isTransientApiError(error: unknown) {
  return !(error instanceof ApiError) || transientStatuses.has(error.status);
}

function isHubSession(value: unknown): value is HubSession {
  if (!value || typeof value !== "object") return false;
  const session = value as Record<string, unknown>;
  if (!session.user || typeof session.user !== "object") return false;
  if (!session.permissions || typeof session.permissions !== "object") return false;
  if (!session.workspace || typeof session.workspace !== "object") return false;
  if (!session.access || typeof session.access !== "object") return false;
  const access = session.access as Record<string, unknown>;
  return Array.isArray(access.allowed_modules) && Array.isArray(access.modules);
}

function isWorkspaceSummary(value: unknown): value is WorkspaceHomeSummary {
  const record = (item: unknown): item is Record<string, unknown> => !!item && typeof item === "object" && !Array.isArray(item);
  const amount = (item: unknown) => item === null || typeof item === "number" && Number.isFinite(item);
  const date = (item: unknown): item is string => typeof item === "string" && /^\d{4}-\d{2}-\d{2}$/.test(item)
    && Number.isFinite(Date.parse(`${item}T00:00:00Z`)) && new Date(`${item}T00:00:00Z`).toISOString().slice(0, 10) === item;
  const timestamp = (item: unknown) => item === null || typeof item === "string"
    && date(item.slice(0, 10)) && /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(item) && Number.isFinite(Date.parse(item));
  if (!record(value) || typeof value.status !== "string" || !["ready", "partial", "stale", "pending"].includes(value.status)
      || !timestamp(value.generatedAt) || !amount(value.totalGsvYuan) || typeof value.note !== "string"
      || !Array.isArray(value.channels) || value.channels.length !== 2) return false;
  if (value.refreshing !== undefined && typeof value.refreshing !== "boolean") return false;
  for (const key of ["lastAttemptAt", "lastSuccessAt", "nextRetryAt"]) {
    if (value[key] !== undefined && !timestamp(value[key])) return false;
  }
  if (value.lastError !== undefined && value.lastError !== null) {
    if (!record(value.lastError) || typeof value.lastError.message !== "string"
        || value.lastError.status !== undefined && (typeof value.lastError.status !== "number"
          || !Number.isInteger(value.lastError.status) || value.lastError.status < 100 || value.lastError.status > 599)
        || value.lastError.at !== undefined && !timestamp(value.lastError.at)) return false;
  }
  const keys = new Set<string>();
  for (const channel of value.channels) {
    if (!record(channel) || typeof channel.key !== "string" || !["douyin", "wechat"].includes(channel.key)
        || keys.has(channel.key) || typeof channel.label !== "string" || !channel.label.trim()
        || !amount(channel.todayTotalYuan) || typeof channel.state !== "string" || !["ready", "pending", "partial", "stale", "error"].includes(channel.state)) return false;
    keys.add(channel.key);
    if (channel.todayDate !== undefined && channel.todayDate !== null && !date(channel.todayDate)) return false;
    if (channel.todayTotalYuan !== null && !date(channel.todayDate)) return false;
    if (channel.sourceUpdatedAt !== undefined && !timestamp(channel.sourceUpdatedAt)) return false;
    if (channel.stale !== undefined && typeof channel.stale !== "boolean") return false;
    for (const key of ["sourceState", "unavailableReason", "refreshError"]) {
      if (channel[key] !== undefined && channel[key] !== null && typeof channel[key] !== "string") return false;
    }
  }
  if (value.totalGsvYuan !== null && (value.channels.some(channel => channel.todayTotalYuan === null)
      || value.channels[0].todayDate !== value.channels[1].todayDate)) return false;
  return true;
}

async function requestWithRetry<T>(path: string, options?: RequestInit): Promise<T> {
  const delays = [300, 900, 1_800];
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await request<T>(path, options);
    } catch (error) {
      if (!isTransientApiError(error) || attempt >= delays.length) throw error;
      await new Promise((resolveDelay) => window.setTimeout(resolveDelay, delays[attempt]));
    }
  }
}

// Coalesce only requests that are currently running. Permission results are never
// retained here; a later check always reaches the server again.
export function createSessionRequest<T>(
  load: (signal: AbortSignal) => Promise<T>,
  transient: (error: unknown) => boolean,
  options: { attemptTimeoutMs?: number; retryDelayMs?: number } = {},
) {
  type Flight = { controller: AbortController; promise: Promise<T>; consumers: number };
  let pending: Flight | undefined;
  const aborted = () => new DOMException("Session check cancelled", "AbortError");
  const wait = (ms: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
    if (signal.aborted) { reject(aborted()); return; }
    const onAbort = () => { clearTimeout(timer); reject(aborted()); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", onAbort); resolve(); }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
  const run = async (signal: AbortSignal): Promise<T> => {
    for (let attempt = 0; ; attempt += 1) {
      if (signal.aborted) throw aborted();
      const controller = new AbortController();
      const onAbort = () => controller.abort();
      signal.addEventListener("abort", onAbort, { once: true });
      const timer = setTimeout(() => controller.abort(), options.attemptTimeoutMs ?? 12_000);
      try {
        const value = await load(controller.signal);
        if (signal.aborted) throw aborted();
        if (controller.signal.aborted) throw new DOMException("Session check timed out", "TimeoutError");
        return value;
      } catch (error) {
        if (signal.aborted) throw aborted();
        if (!transient(error) || attempt >= 1) throw error;
      } finally {
        clearTimeout(timer);
        signal.removeEventListener("abort", onAbort);
      }
      await wait(options.retryDelayMs ?? 500, signal);
    }
  };
  return {
    reset() {
      const current = pending;
      pending = undefined;
      current?.controller.abort();
    },
    get(signal?: AbortSignal): Promise<T> {
      if (signal?.aborted) return Promise.reject(aborted());
      if (!pending) {
        const controller = new AbortController();
        const flight: Flight = { controller, consumers: 0, promise: undefined as unknown as Promise<T> };
        flight.promise = Promise.resolve().then(() => run(controller.signal)).finally(() => {
          if (pending === flight) pending = undefined;
        });
        pending = flight;
      }
      const flight = pending;
      flight.consumers += 1;
      return new Promise<T>((resolve, reject) => {
        let settled = false;
        const finish = (callback: () => void) => {
          if (settled) return;
          settled = true;
          signal?.removeEventListener("abort", onAbort);
          flight.consumers -= 1;
          if (flight.consumers === 0 && pending === flight) {
            pending = undefined;
            flight.controller.abort();
          }
          callback();
        };
        const onAbort = () => finish(() => reject(aborted()));
        signal?.addEventListener("abort", onAbort, { once: true });
        flight.promise.then(value => finish(() => resolve(value)), error => finish(() => reject(error)));
      });
    },
  };
}

const sessionRequest = createSessionRequest(async signal => {
  const value = await request<unknown>("api/session", { signal, cache: "no-store" });
  if (!isHubSession(value)) throw new ApiError("登录态响应异常，请刷新或重试。", 502);
  return value;
}, isTransientApiError);

type CacheEntry = { expiresAt: number; value: unknown };
const responseCache = new Map<string, CacheEntry>();
const inflightGets = new Map<string, Promise<unknown>>();
let responseCacheEpoch = 0;

function invalidateCache(...prefixes: string[]) {
  responseCacheEpoch += 1;
  for (const key of responseCache.keys()) {
    if (prefixes.some((prefix) => key.startsWith(prefix))) responseCache.delete(key);
  }
  for (const key of inflightGets.keys()) {
    if (prefixes.some((prefix) => key.startsWith(prefix))) inflightGets.delete(key);
  }
}

async function cachedGet<T>(path: string, ttlMs: number): Promise<T> {
  const now = Date.now();
  const cached = responseCache.get(path);
  if (cached && cached.expiresAt > now) return cached.value as T;
  const pending = inflightGets.get(path);
  if (pending) return pending as Promise<T>;
  const epoch = responseCacheEpoch;
  const promise = request<T>(path)
    .then((value) => {
      if (epoch === responseCacheEpoch) responseCache.set(path, { value, expiresAt: Date.now() + ttlMs });
      return value;
    })
    .finally(() => { if (inflightGets.get(path) === promise) inflightGets.delete(path); });
  inflightGets.set(path, promise);
  return promise;
}

async function mutate<T>(path: string, options: RequestInit, ...invalidatePrefixes: string[]) {
  try { return await request<T>(path, options); }
  finally { invalidateCache(...invalidatePrefixes); }
}

export const api = {
  hubLogin: async (username: string, password: string, captcha = "") => {
    sessionRequest.reset();
    try {
      return await request<{ user: unknown }>("api/hub-auth/login", {
        method: "POST", body: JSON.stringify({ username, password, captcha }),
      });
    } finally { sessionRequest.reset(); invalidateCache("api/"); }
  },
  hubCaptcha: (username: string) => request<{ ok: boolean; message: string }>("api/hub-auth/captcha", {
    method: "POST", body: JSON.stringify({ username }),
  }),
  hubLogout: async () => {
    sessionRequest.reset();
    try {
      return await mutate<{ ok: boolean }>("api/hub-auth/logout", {
        method: "POST", body: JSON.stringify({}),
      }, "api/");
    } finally { sessionRequest.reset(); }
  },
  organizationEntries: () => request<OrganizationEntries>('api/permissions/organization-entry'),
  organizationEntryUpdate: (identifiers: string[], enabled: boolean, version: number) => mutate<OrganizationEntries>(
    'api/permissions/organization-entry', {method: 'PUT', body: JSON.stringify({identifiers, enabled, version})},
    'api/permission-preview', 'api/organization-dashboard',
  ),
  session: (signal?: AbortSignal) => sessionRequest.get(signal),
  workspaceSummary: async (force = false, signal?: AbortSignal) => {
    const value = await request<unknown>(`api/workspace-home/summary${force ? "?refresh=1" : ""}`, { signal, cache: "no-store" });
    if (!isWorkspaceSummary(value)) throw new ApiError("经营摘要响应异常，请稍后重试或重新校验登录。", 502);
    return value;
  },
  taskCenter: () => requestWithRetry<TaskCenterOverview>("api/task-center/overview"),
  loginGrants: (q = "", fresh = false) => fresh
    ? request<{ items: LoginGrant[]; total: number }>(`api/permissions/login?q=${encodeURIComponent(q)}`, {cache: 'no-store'})
    : cachedGet<{ items: LoginGrant[]; total: number }>(`api/permissions/login?q=${encodeURIComponent(q)}`, 15_000),
  loginGrantCreate: (realName: string, department = "", center = "", userNumber = "") => mutate<LoginGrant>("api/permissions/login", {
    method: "POST",
    body: JSON.stringify({ real_name: realName, user_number: userNumber, department, center }),
  }, "api/permissions/", "api/permission-preview"),
  loginGrantRevoke: (identifier: string) => mutate<LoginGrant>(`api/permissions/login/${encodeURIComponent(identifier)}`, { method: "DELETE" }, "api/permissions/", "api/permission-preview"),
  adminGrants: (q = "") => cachedGet<{ items: AdminGrant[]; total: number }>(`api/permissions/admins?q=${encodeURIComponent(q)}`, 15_000),
  adminGrantCreate: (realName: string, department = "", center = "") => mutate<AdminGrant>("api/permissions/admins", {
    method: "POST",
    body: JSON.stringify({ real_name: realName, department, center }),
  }, "api/permissions/admins"),
  adminGrantRevoke: (identifier: string) => mutate<AdminGrant>(`api/permissions/admins/${encodeURIComponent(identifier)}`, { method: "DELETE" }, "api/permissions/admins"),
  permissionManagers: (q = "") => cachedGet<{ items: AdminGrant[]; total: number }>(`api/permissions/managers?q=${encodeURIComponent(q)}`, 15_000),
  permissionManagerCreate: (realName: string, department = "", center = "") => mutate<AdminGrant>("api/permissions/managers", {
    method: "POST",
    body: JSON.stringify({ real_name: realName, department, center }),
  }, "api/permissions/", "api/permission-preview"),
  permissionManagerRevoke: (identifier: string) => mutate<AdminGrant>(`api/permissions/managers/${encodeURIComponent(identifier)}`, { method: "DELETE" }, "api/permissions/", "api/permission-preview"),
  moduleAccess: (q = "") => cachedGet<{
    items: ModuleAccessGrant[];
    total: number;
    modules: Array<{ key: string; label: string; purpose: string }>;
    default_mode: "all";
  }>(`api/permissions/modules?q=${encodeURIComponent(q)}`, 15_000),
  moduleAccessUpdate: (identifier: string, accessMode: "all" | "selected", selected: string[]) => mutate<ModuleAccessGrant>(
    `api/permissions/modules/${encodeURIComponent(identifier)}`,
    { method: "PUT", body: JSON.stringify({ access_mode: accessMode, modules: selected }) },
    "api/permissions/modules", "api/permissions/workspace-profiles", "api/permission-preview",
  ),
  moduleAccessBatchUpdate: (identifiers: string[], accessMode: "all" | "selected", selected: string[]) => mutate<{ items: ModuleAccessGrant[]; updated: number }>(
    "api/permissions/modules/batch",
    { method: "POST", body: JSON.stringify({ identifiers, access_mode: accessMode, modules: selected }) },
    "api/permissions/modules", "api/permissions/workspace-profiles", "api/permission-preview",
  ),
  assistantStatus: async () => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 15_000);
    try { return await request<AssistantStatus>("api/assistant/status", { cache: "no-store", signal: controller.signal }); }
    finally { window.clearTimeout(timer); }
  },
  assistantConversations: (q = "") => cachedGet<{ items: AssistantConversation[]; total: number }>(`api/assistant/conversations?q=${encodeURIComponent(q)}`, 5_000),
  assistantConversationCreate: (title = "新会话") => mutate<AssistantConversation>("api/assistant/conversations", {
    method: "POST",
    body: JSON.stringify({ title }),
  }, "api/assistant/conversations"),
  assistantConversationUpdate: (id: string, title: string) => mutate<AssistantConversation>(`api/assistant/conversations/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ title }),
  }, "api/assistant/conversations"),
  assistantConversationDelete: (id: string) => mutate<{ deleted: boolean; id: string }>(`api/assistant/conversations/${id}`, { method: "DELETE" }, "api/assistant/conversations"),
  assistantMessages: (id: string) => request<{ conversation: AssistantConversation; items: AssistantMessage[] }>(`api/assistant/conversations/${id}/messages`),
  assistantAttachmentUpload: (conversationId: string, filename: string, mimeType: string, dataBase64: string) => request<AssistantAttachment>("api/assistant/attachments", {
    method: "POST",
    body: JSON.stringify({ conversation_id: conversationId, filename, mime_type: mimeType, data_base64: dataBase64 }),
  }),
  assistantAttachmentDelete: (id: string) => request<{ deleted: boolean; id: string }>(`api/assistant/attachments/${id}`, { method: "DELETE" }),
  assistantChat: (payload: { conversation_id: string; content?: string; attachment_ids?: string[]; reuse_last_user_message?: boolean; current_view?: string }) => request<AssistantResponse>(
    "api/assistant/chat",
    { method: "POST", body: JSON.stringify(payload) },
  ),
  assistantInsights: () => cachedGet<OptimizationResponse>("api/assistant/insights", 30_000),
  assistantInsightsRefresh: () => mutate<OptimizationResponse>("api/assistant/insights/refresh", { method: "POST" }, "api/assistant/insights"),
  businessIntelligence: (date: string, days = 7) => cachedGet<BusinessIntelligenceOverview>(
    `api/business-intelligence/overview?date=${encodeURIComponent(date)}&days=${days}`,
    60_000,
  ),
  creativeIncentives: () => cachedGet<CreativeIncentiveOverview>("api/creative-incentives/overview", 15_000),
  creativeIncentiveCreate: (payload: {
    direction_name: string;
    material_id: string;
    material_name?: string;
    creator_name?: string;
    center?: string;
    online_date: string;
    originality_note?: string;
    copy_judgement?: string;
    visual_judgement?: string;
    voice_judgement?: string;
    remix_plan?: string;
    reference_url?: string;
  }) => mutate<CreativeIncentiveDirection>(
    "api/creative-incentives/directions",
    { method: "POST", body: JSON.stringify(payload) },
    "api/creative-incentives/overview",
  ),
  creativeIncentiveConfirm: (id: string, confirmed = true, note = "") => mutate<CreativeIncentiveDirection>(
    `api/creative-incentives/directions/${encodeURIComponent(id)}/originality`,
    { method: "PATCH", body: JSON.stringify({ confirmed, note }) },
    "api/creative-incentives/overview",
  ),
  creativeIncentiveSync: (date: string, force = false) => mutate<CreativeIncentiveOverview>(
    `api/creative-incentives/sync?date=${encodeURIComponent(date)}&force=${force ? "true" : "false"}`,
    { method: "POST" },
    "api/creative-incentives/overview",
  ),
  creativeIncentivePublish: (id: string, mode: "feishu" | "manual") => mutate<CreativeIncentiveMilestone>(
    `api/creative-incentives/milestones/${encodeURIComponent(id)}/publish`,
    { method: "POST", body: JSON.stringify({ mode }) },
    "api/creative-incentives/overview",
  ),
  organizationDashboard: (date: string, days = 7, preview?: PermissionPreview | null, force = false) => {
    const params = new URLSearchParams({ date, days: String(days) });
    if (force) params.set("refresh", "1");
    params.set("preview_scope", preview?.active ? preview.scope : "real");
    if (preview?.active && preview.scope === "center") params.set("preview_center", preview.center);
    if (preview?.active && preview.person) params.set("preview_person", preview.person);
    params.set("preview_version", preview?.updatedAt || "real");
    // The server returns a fast partial shell first and fills slow root-data
    // sources in the background. Do not pin that partial response in the
    // browser cache; repeated reads progressively become richer.
    return request<OrganizationDashboardOverview>(`api/organization-dashboard/overview?${params.toString()}`);
  },
  libtvCredits: (filters: { startDate: string; endDate: string; team_member: string; model_name: string }, preview?: PermissionPreview | null, force = false) => {
    const params = new URLSearchParams({ ...filters, refresh: force ? "1" : "0" });
    params.set("preview_scope", preview?.active ? preview.scope : "real");
    if (preview?.active && preview.scope === "center") params.set("preview_center", preview.center);
    if (preview?.active && preview.person) params.set("preview_person", preview.person);
    params.set("preview_version", preview?.updatedAt || "real");
    return request<LibTvCreditTrend>(`api/organization-dashboard/libtv-credits?${params.toString()}`);
  },
  libtvCreditAuth: () => request<LibTvCreditAuthStatus>("api/organization-dashboard/libtv-credits/auth"),
  libtvCreditLoginSend: (phone: string) => request<LibTvCreditAuthStatus>("api/organization-dashboard/libtv-credits/login/send", {
    method: "POST",
    body: JSON.stringify({ phone }),
  }),
  libtvCreditLoginVerify: (phone: string, code: string) => mutate<LibTvCreditAuthStatus>(
    "api/organization-dashboard/libtv-credits/login/verify",
    { method: "POST", body: JSON.stringify({ phone, code }) },
    "api/organization-dashboard/libtv-credits",
  ),
  libtvCreditLogout: () => mutate<LibTvCreditAuthStatus>(
    "api/organization-dashboard/libtv-credits/logout",
    { method: "POST" },
    "api/organization-dashboard/libtv-credits",
  ),
  longTermWorkScheduler: (requestId?: string) => request<LongTermWorkSchedulerStatus>(
    `api/organization-dashboard/long-term-work/scheduler${requestId ? `?request_id=${encodeURIComponent(requestId)}` : ""}`,
    { signal: AbortSignal.timeout(10_000) },
  ),
  longTermWorkSnapshot: (preview?: PermissionPreview | null) => {
    const params = new URLSearchParams({ preview_scope: preview?.active ? preview.scope : "real", preview_version: preview?.updatedAt || "real" });
    if (preview?.active && preview.scope === "center") params.set("preview_center", preview.center);
    if (preview?.active && preview.person) params.set("preview_person", preview.person);
    return request<NonNullable<OrganizationDashboardOverview["longTermWork"]>>(
      `api/organization-dashboard/long-term-work?${params}`, { signal: AbortSignal.timeout(10_000) },
    );
  },
  longTermWorkSchedulerUpdate: (enabled: boolean, hour: number, minute: number) => mutate<LongTermWorkSchedulerStatus>(
    "api/organization-dashboard/long-term-work/scheduler",
    { method: "PUT", body: JSON.stringify({ enabled, hour, minute }) },
    "api/organization-dashboard/long-term-work/scheduler",
    "api/organization-dashboard/overview",
  ),
  longTermWorkSchedulerRun: (requestId: string) => mutate<LongTermWorkSchedulerStatus>(
    "api/organization-dashboard/long-term-work/scheduler/run",
    { method: "POST", body: JSON.stringify({ requestId }), signal: AbortSignal.timeout(15_000) },
    "api/organization-dashboard/long-term-work/scheduler",
    "api/organization-dashboard/overview",
  ),
  permissionPreview: () => request<PermissionPreview>("api/permission-preview"),
  permissionPreviewCandidates: (q = "") => cachedGet<{ items: PermissionPreviewSubject[]; total: number }>(
    `api/permission-preview/candidates?q=${encodeURIComponent(q)}`,
    60_000,
  ),
  permissionPreviewUpdate: (scope: DashboardScope | "real", center = "", person = "") => mutate<PermissionPreview>(
    "api/permission-preview",
    { method: "PUT", body: JSON.stringify({ scope, center, person }) },
    "api/organization-dashboard/overview",
    "api/operation-logs",
  ),
  dashboardScopeGrants: (q = "") => cachedGet<{ items: DashboardScopeGrant[]; total: number; centers: string[]; catalog: Array<{key: string; label: string}> }>(
    `api/permissions/workspace-profiles?q=${encodeURIComponent(q)}`,
    0,
  ),
  dashboardScopeUpdate: (identifier: string, value: {role: string; center: string; modules: string[]; version: number}) => mutate<DashboardScopeGrant>(
    `api/permissions/workspace-profiles/${encodeURIComponent(identifier)}`,
    { method: "PUT", body: JSON.stringify(value) },
    "api/permissions/workspace-profiles", "api/permissions/modules", "api/session", "api/permission-preview",
  ),
  warmLaunch: (moduleId: string) => fetch(`api/launch/${encodeURIComponent(moduleId)}`, {
    method: "HEAD",
    credentials: "same-origin",
    cache: "no-store",
  }).then(() => undefined).catch(() => undefined),
  operationLogs: (filters: {
    q?: string;
    module?: string;
    result?: "" | "success" | "failed";
    dateFrom?: string;
    dateTo?: string;
    page?: number;
    pageSize?: number;
  } = {}) => {
    const params = new URLSearchParams({
      q: filters.q || "",
      module: filters.module || "",
      result: filters.result || "",
      page: String(filters.page || 1),
      page_size: String(filters.pageSize || 20),
    });
    if (filters.dateFrom) params.set("date_from", filters.dateFrom);
    if (filters.dateTo) params.set("date_to", filters.dateTo);
    return request<{ items: OperationLog[]; total: number; page: number; page_size: number; total_pages: number; modules: string[] }>(`api/operation-logs?${params}`);
  },
};
