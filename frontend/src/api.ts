import type { AssetContext, TimecodeNotes } from './asset-context-types'
import type { ProductionReport } from './production-types'
import type { AdminGrant, AdqAccountCatalog, AdqAccountMaterialMetrics, AdqAdgroup, AdqHierarchy, AdqStatus, AdqTarget, AdqTask, Asset, ChannelsAccount, ChannelsAuthSession, ChannelsProduct, ChannelsPromotionAuth, ChannelsPromotionAuthSession, ChannelsPromotionOrder, ChannelsPromotionPaymentSession, ChannelsPromotionQuoteInput, ChannelsPromotionQuoteResult, ChannelsStatus, ChannelsTask, ChannelsVideoAnnotationInput, EffectiveClipLibraryStatus, Facets, JianyingDevice, JianyingImportTask, JianyingPairing, MultipartPartUrl, MultipartUploadedPart, MultipartUploadSession, OaAccessGrant, OaAccessGrantResult, OaPermissions, OaUser, OperationLog, PersonalSalesSnapshot, ProductImageCategory, PushPreference, PushScheme, QianchuanAccount, QianchuanPlanMaterialResult, QianchuanProductPlanMap, QianchuanPlanResult, QianchuanStatus, QianchuanTarget, QianchuanTask, ReviewAiRule, ReviewNamingContext, ReviewNamingEvidence, ReviewRoleMember, ReviewSubmission, ReviewWorkflowConfig, Stats, SyncStatus, UploadAnalyticsResult, UploadTicket, UserNotification, VideoRequestAssignee, VideoRequestItem, VideoRequestPage } from './types'

export class ApiError extends Error {
  constructor(message: string, public status: number, public attempts = 1, public taskIds: string[] = []) {
    super(message)
    this.name = 'ApiError'
  }
}

const RETRYABLE_READ_STATUSES = new Set([0, 408, 425, 429, 500, 502, 503, 504])
const READ_REQUEST_ATTEMPTS = 3

const waitForRetry = (attempt: number) => new Promise<void>((resolve) => {
  const delay = 320 * (2 ** attempt) + Math.floor(Math.random() * 160)
  window.setTimeout(resolve, delay)
})

type RequestPolicy = { library?: 'source' | 'remix'; timeoutMs?: number; attempts?: number; redirectOnLogin?: boolean }
const UPLOAD_CONTROL_POLICY: RequestPolicy = { timeoutMs: 30000, attempts: 3, redirectOnLogin: false }

const requestOnce = async <T>(url: string, options?: RequestInit, timeoutMs = 90000, redirectOnLogin = true): Promise<T> => {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs)
  const relayAbort = () => controller.abort()
  if (options?.signal?.aborted) controller.abort()
  else options?.signal?.addEventListener('abort', relayAbort, { once: true })
  try {
    const response = await fetch(url, {
      headers: { 'Content-Type': 'application/json', ...(options?.headers || {}) },
      ...options,
      signal: controller.signal,
    })
    const contentType = response.headers.get('content-type') || ''
    if (response.redirected && new URL(response.url).pathname.startsWith('/_auth/login')) {
      if (!redirectOnLogin) throw new ApiError('登录已失效，请重新登录中枢后继续原文件；已完成的分片保留', 401)
      window.location.assign(response.url)
      throw new ApiError('正在跳转到统一 OA 登录…', 401)
    }
    if (!response.ok) {
      const data = await response.json().catch((error: unknown) => {
        if (controller.signal.aborted) throw error
        return {}
      })
      const validationDetail = Array.isArray(data.detail)
        ? data.detail.map((item: { msg?: string; loc?: unknown[] }) => {
            const field = Array.isArray(item?.loc) ? item.loc.filter(value => value !== 'body').join('.') : ''
            return `${field ? `${field}：` : ''}${item?.msg || '字段格式不正确'}`
          }).join('；')
        : ''
      const fallback: Record<number, string> = {
        401: '登录状态已失效，请重新进入中枢后继续，已填写内容请先保留',
        403: '当前账号没有此项操作权限，请联系权限管理员核对',
        413: '文件超过当前服务接收限制，请联系维护人核对上传网关',
        423: '当前服务暂时只读，已有内容已保留',
        429: '当前操作较多，请稍后继续',
        500: '服务处理失败，已有内容已保留，请先核对任务是否已创建',
        502: '服务暂时连接不上，已有内容已保留',
        503: '服务暂时不可用，已有内容已保留',
        504: '服务等待超时，请先核对任务是否已创建，再继续',
      }
      const message = typeof data.detail === 'string' ? data.detail
        : validationDetail || (typeof data.detail?.message === 'string' ? data.detail.message : '')
        || (typeof data.message === 'string' ? data.message : '') || fallback[response.status] || '请求未完成'
      throw new ApiError(`${message}（HTTP ${response.status}）`, response.status, 1, Array.isArray(data.detail?.task_ids) ? data.detail.task_ids.filter((id: unknown) => typeof id === "string") : [])
    }
    if (!contentType.includes('application/json')) throw new ApiError('登录状态已失效，请重新进入统一 OA 登录', 401)
    // Keep the deadline and caller cancellation active until the body is read.
    return await response.json()
  } catch (error) {
    if (options?.signal?.aborted) throw new DOMException('上传已暂停', 'AbortError')
    if (error instanceof DOMException && error.name === 'AbortError') throw new ApiError(`请求等待超过 ${timeoutMs / 1000} 秒，请重试`, 408)
    if (error instanceof TypeError) throw new ApiError('网络连接中断，请稍后重试', 0)
    throw error
  } finally {
    window.clearTimeout(timeout)
    options?.signal?.removeEventListener('abort', relayAbort)
  }
}

let businessLibrary: 'source' | 'remix' = 'source'
export const setBusinessLibrary = (value: 'source' | 'remix') => { businessLibrary = value }
export const getBusinessLibrary = () => businessLibrary

export const request = async <T>(url: string, options?: RequestInit, policy: RequestPolicy = {}): Promise<T> => {
  if ((policy.library ?? businessLibrary) === 'remix' && /^api\/(reviews|qianchuan|adq|channels)\//.test(url)) url = url.replace('api/', 'api/remix-business/')
  const method = (options?.method || 'GET').toUpperCase()
  const isReadRequest = method === 'GET' || method === 'HEAD'
  const maxAttempts = policy.attempts ?? (isReadRequest ? READ_REQUEST_ATTEMPTS : 1)
  let lastError: unknown
  let attemptsUsed = 0

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    attemptsUsed = attempt + 1
    if (options?.signal?.aborted) throw new DOMException('上传已暂停', 'AbortError')
    try {
      return await requestOnce<T>(url, options, policy.timeoutMs, policy.redirectOnLogin)
    } catch (cause) {
      lastError = cause
      const abortedByCaller = Boolean(options?.signal?.aborted)
      const retryable = cause instanceof ApiError && RETRYABLE_READ_STATUSES.has(cause.status)
      if (!retryable || abortedByCaller || attempt >= maxAttempts - 1) break
      await waitForRetry(attempt)
    }
  }

  if (lastError instanceof ApiError && attemptsUsed > 1 && RETRYABLE_READ_STATUSES.has(lastError.status)) {
    throw new ApiError(`${lastError.message}；已自动重试 ${attemptsUsed - 1} 次`, lastError.status, attemptsUsed)
  }
  throw lastError
}

export const api = {
  me: () => request<{ user: OaUser; permissions: OaPermissions }>('api/auth/me', undefined, { timeoutMs: 15000, attempts: 1 }),
  login: (username: string, password: string, captcha = '') => request<{ user: OaUser; permissions: OaPermissions }>('api/auth/login', { method: 'POST', body: JSON.stringify({ username, password, captcha }) }),
  captcha: (username: string) => request<{ ok: boolean; message: string }>('api/auth/captcha', { method: 'POST', body: JSON.stringify({ username }) }),
  logout: () => request<{ ok: boolean }>('api/auth/logout', { method: 'POST' }),
  stats: () => request<Stats>('api/remix-library/hall/stats'),
  facets: (libraryType = '', assetScope = '') => {
    const params = new URLSearchParams()
    if (libraryType) params.set('library_type', libraryType)
    if (assetScope) params.set('asset_scope', assetScope)
    return request<Facets>(`api/remix-library/hall/facets${params.size ? `?${params}` : ''}`)
  },
  facetBundle: () => request<{ all: Facets; source: Facets; remix: Facets }>('api/remix-library/hall/facets/bundle'),
  productImageCategories: () => request<{ items: ProductImageCategory[]; total: number }>('api/product-images/categories'),
  personalSales: (startDate = '', endDate = '') => {
    const params = new URLSearchParams()
    if (startDate) params.set('start_date', startDate)
    if (endDate) params.set('end_date', endDate)
    return request<PersonalSalesSnapshot>(`api/personal-sales${params.size ? `?${params}` : ''}`)
  },
  assetContext: (id: number) => request<AssetContext>(`api/assets/${id}/context`, undefined, { timeoutMs: 15000, attempts: 1 }),
  assetTimecodeNote: (id: number, payload: { client_request_id: string; expected_revision: number; time_ms: number; expected_etag: string; text: string }) => request<TimecodeNotes>(`api/assets/${id}/timecode-notes`, { method: 'POST', body: JSON.stringify(payload) }),
  productionAnalytics: async (filters: Record<string, string>, onProgress?: (message: string) => void): Promise<ProductionReport> => {
    const url = `api/analytics/production?${new URLSearchParams(filters)}`
    const deadline = Date.now() + 90000
    while (Date.now() < deadline) {
      const result = await request<ProductionReport | { report_state: 'generating'; elapsed_seconds: number; message: string }>(url, undefined, { timeoutMs: 15000, attempts: 1 })
      if (!('report_state' in result)) return result
      onProgress?.(`${result.message}（已等待 ${result.elapsed_seconds} 秒）`)
      await new Promise<void>(resolve => window.setTimeout(resolve, 2000))
    }
    throw new ApiError('报告仍在后台生成，请稍后刷新读取；已有素材未修改', 408)
  },
  uploadAnalytics: (startDate: string, endDate: string) => {
    const params = new URLSearchParams({ start_date: startDate, end_date: endDate })
    return request<UploadAnalyticsResult>(`api/analytics/uploads?${params}`)
  },
  assets: (params: URLSearchParams) => request<{ items: Asset[]; total: number; page: number; page_size: number; source: string; source_updated_at?: string }>(`${params.get('asset_scope') === 'product_image' ? 'api/assets' : 'api/remix-library/hall/assets'}?${params}`),
  asset: async (id: number, library?: Asset['asset_library']) => {
    const asset = await request<Asset>(`${library ? `api/${library}-library/assets` : 'api/assets'}/${id}?include_performance=false`)
    return !library && asset.object_key.startsWith('wis/source/') ? request<Asset>(`api/source-library/assets/${id}`) : asset
  },
  trash: (params: URLSearchParams) => request<{ items: Asset[]; total: number; page: number; page_size: number; source: string; source_updated_at?: string }>(`api/remix-library/hall/trash?${params}`),
  update: (id: number, data: Partial<Pick<Asset, 'filename' | 'category' | 'content_type' | 'status' | 'library_type' | 'asset_subtype' | 'folder_name' | 'tags' | 'reference_url' | 'reference_video_key' | 'reference_video_name' | 'material_description' | 'performance_screenshots'>>, library?: Asset['asset_library']) =>
    request<Asset>(`${library ? `api/${library}-library/assets` : 'api/assets'}/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  favorite: async (id: number, library?: Asset['asset_library']) => {
    if (library === 'remix') {
      await request(`api/remix-business/assets/${id}/favorite`, {method:'POST'})
      return request<Asset>(`api/remix-library/assets/${id}`)
    }
    const asset = await request<Asset>(`api/assets/${id}/favorite`, { method: 'POST' })
    return asset.object_key.startsWith('wis/source/') ? request<Asset>(`api/source-library/assets/${id}`) : {...asset, asset_library: 'source' as const}
  },
  effective: (id: number, effective: boolean) => request<Asset>(`api/assets/${id}/effective`, {
    method: 'PUT', body: JSON.stringify({ effective }),
  }),
  effectiveClipImport: (id: number) => request<{ asset_id: number; status: string; message: string }>(`api/assets/${id}/clip-library/import`, { method: 'POST' }),
  effectiveClipStatus: (id: number) => request<{ status: EffectiveClipLibraryStatus }>(`api/assets/${id}/clip-library/status`),
  delete: (id: number, library?: Asset['asset_library']) => request<Asset>(`${library ? `api/${library}-library/assets` : 'api/assets'}/${id}`, { method: 'DELETE' }),
  batchDelete: (assetIds: number[]) => request<{ ok: boolean; count: number; asset_ids: number[] }>('api/assets/batch-delete', {
    method: 'POST', body: JSON.stringify({ asset_ids: assetIds }),
  }),
  batchTags: (assetIds: number[], tags: string[], mode: 'add' | 'remove' | 'replace' = 'add') => request<{ ok: boolean; count: number; asset_ids: number[]; tags: string[] }>('api/assets/batch-tags', {
    method: 'POST', body: JSON.stringify({ asset_ids: assetIds, tags, mode }),
  }),
  batchFolder: (assetIds: number[], folderName: string) => request<{ ok: boolean; count: number; asset_ids: number[]; folder_name: string }>('api/assets/batch-folder', {
    method: 'POST', body: JSON.stringify({ asset_ids: assetIds, folder_name: folderName }),
  }),
  restore: (id: number, library?: Asset['asset_library']) => request<Asset>(library ? `api/${library}-library/assets/${id}/restore` : `api/trash/${id}/restore`, { method: 'POST' }),
  purge: (id: number) => request<{ ok: boolean; asset_id: number }>(`api/trash/${id}`, { method: 'DELETE' }),
  purgeTrashAll: (confirmText: string) => request<{ ok: boolean; checked: number; purged: number; purged_ids: number[]; failed: Array<{ asset_id: number; filename: string; detail: string }> }>('api/trash/purge-all', {
    method: 'POST', body: JSON.stringify({ confirm_text: confirmText }),
  }),
  refresh: () => request<SyncStatus>('api/sync/oss', { method: 'POST' }),
  refreshStatus: () => request<SyncStatus>('api/sync/oss/status'),
  createUpload: (file: File, assetScope: 'marketing_video' | 'product_image' = 'marketing_video', category = '待分类') => request<UploadTicket>('api/uploads/presign', {
    method: 'POST',
    body: JSON.stringify({ filename: file.name, content_type: file.type || 'application/octet-stream', size: file.size, asset_scope: assetScope, category }),
  }),
  createReferenceUpload: (file: File) => request<UploadTicket>('api/uploads/presign', {
    method: 'POST',
    body: JSON.stringify({ filename: file.name, content_type: file.type || 'application/octet-stream', size: file.size, asset_scope: 'reference_video', category: '参考视频' }),
  }),
  completeUpload: (data: { session_id?: string; object_key: string; filename: string; category: string; content_type: string; asset_scope: 'marketing_video' | 'product_image'; library_type: 'source' | 'remix'; asset_subtype: string; folder_name?: string; tags: string[]; reference_url?: string; reference_video_key?: string; reference_video_name?: string; material_description?: string; performance_screenshots?: { object_key: string; filename: string }[] }, signal?: AbortSignal) =>
    request<Asset>(data.asset_scope === 'marketing_video' ? `api/${data.library_type}-library/assets` : 'api/uploads/complete', { method: 'POST', body: JSON.stringify(data), signal }, UPLOAD_CONTROL_POLICY),
  createMultipartUpload: (data: { filename: string; content_type: string; size: number; sha256: string; asset_scope: 'marketing_video' | 'product_image' | 'reference_video'; category: string }, signal?: AbortSignal) =>
    request<MultipartUploadSession>('api/uploads/multipart/sessions', { method: 'POST', body: JSON.stringify(data), signal }, { redirectOnLogin: false }),
  lookupMultipartUpload: (data: { filename: string; content_type: string; size: number; sha256: string; legacy_sha256: string; asset_scope: 'marketing_video' | 'product_image' | 'reference_video'; category: string }, signal?: AbortSignal) =>
    request<{ session: MultipartUploadSession | null; recovery_required?: boolean }>('api/uploads/multipart/lookup', { method: 'POST', body: JSON.stringify(data), signal }, UPLOAD_CONTROL_POLICY),
  multipartUploadStatus: (sessionId: string, signal?: AbortSignal) => request<MultipartUploadSession>(`api/uploads/multipart/sessions/${encodeURIComponent(sessionId)}`, { signal }, UPLOAD_CONTROL_POLICY),
  multipartPartUrls: (sessionId: string, partNumbers: number[], signal?: AbortSignal) => request<{ items: MultipartPartUrl[]; total: number }>(`api/uploads/multipart/sessions/${encodeURIComponent(sessionId)}/parts`, {
    method: 'POST', body: JSON.stringify({ part_numbers: partNumbers }), signal,
  }, UPLOAD_CONTROL_POLICY),
  completeMultipartUpload: (sessionId: string, parts: MultipartUploadedPart[], sha256: string, signal?: AbortSignal) => request<MultipartUploadSession>(`api/uploads/multipart/sessions/${encodeURIComponent(sessionId)}/complete`, {
    method: 'POST', body: JSON.stringify({ parts, sha256 }), signal,
  }, { timeoutMs: 60000, attempts: 1, redirectOnLogin: false }),
  cancelMultipartUpload: (sessionId: string, objectKey = '') => request<{ ok: boolean; session_id: string; status: string }>(`${objectKey.startsWith('wis/remix/') ? 'api/remix-library/uploads/sessions' : objectKey.startsWith('wis/source/') ? 'api/source-library/uploads/sessions' : 'api/uploads/multipart/sessions'}/${encodeURIComponent(sessionId)}`, { method: 'DELETE' }, UPLOAD_CONTROL_POLICY),
  acquireUploadLease: (sessionId: string, requestId: string, signal?: AbortSignal) => request<{ acquired: boolean; lease_id?: string; retry_after_ms?: number; expires_in?: number; queue_position?: number; queue_total?: number; global_in_use?: number; global_limit?: number; user_in_use?: number; user_limit?: number }>('api/uploads/part-leases/acquire', {
    method: 'POST', body: JSON.stringify({ session_id: sessionId, request_id: requestId }), signal,
  }, { timeoutMs: 10000, attempts: 3, redirectOnLogin: false }),
  renewUploadLease: (leaseId: string) => request<{ ok: boolean; expires_in: number }>('api/uploads/part-leases/renew', { method: 'POST', body: JSON.stringify({ lease_id: leaseId }) }, { timeoutMs: 5000, attempts: 2, redirectOnLogin: false }),
  releaseUploadLease: (leaseId: string) => request<{ ok: boolean }>('api/uploads/part-leases/release', { method: 'POST', body: JSON.stringify({ lease_id: leaseId }) }, { timeoutMs: 5000, attempts: 2, redirectOnLogin: false }),
  reportUploadFailure: (data: { event_id: string; session_id: string; filename: string; file_size: number; stage: string; http_status: number }) => request<{ ok: boolean }>('api/uploads/failures', { method: 'POST', body: JSON.stringify(data) }, { timeoutMs: 5000, attempts: 2, redirectOnLogin: false }),
  jianyingPairingCreate: () => request<JianyingPairing>('api/jianying/pairings', { method: 'POST' }),
  jianyingPairingStatus: (pairingId: string) => request<{ id: string; status: string; device_id: string; expires_at: string; claimed_at?: string | null }>(`api/jianying/pairings/${encodeURIComponent(pairingId)}`),
  jianyingDevices: () => request<{ items: JianyingDevice[]; total: number }>('api/jianying/devices'),
  jianyingDeviceRevoke: (deviceId: string) => request<{ ok: boolean; device_id: string }>(`api/jianying/devices/${encodeURIComponent(deviceId)}`, { method: 'DELETE' }),
  jianyingImport: (assetId: number) => request<JianyingImportTask>(`api/assets/${assetId}/jianying-import`, { method: 'POST' }),
  jianyingImportStatus: (ticketId: string) => request<JianyingImportTask>(`api/jianying/imports/${encodeURIComponent(ticketId)}`),
  accessGrants: (q = '') => request<OaAccessGrantResult>(`api/admin/access-grants?q=${encodeURIComponent(q)}`),
  accessGrantCreate: (realName: string, department = '') => request<OaAccessGrant>('api/admin/access-grants', {
    method: 'POST', body: JSON.stringify({ real_name: realName, department }),
  }),
  accessGrantRevoke: (identifier: string) => request<OaAccessGrant>(`api/admin/access-grants/${encodeURIComponent(identifier)}`, { method: 'DELETE' }),
  adminGrants: (q = '') => request<{ items: AdminGrant[]; total: number }>(`api/admin/admin-grants?q=${encodeURIComponent(q)}`),
  adminGrantCreate: (realName: string, department = '') => request<AdminGrant>('api/admin/admin-grants', {
    method: 'POST', body: JSON.stringify({ real_name: realName, department }),
  }),
  adminGrantRevoke: (identifier: string) => request<AdminGrant>(`api/admin/admin-grants/${encodeURIComponent(identifier)}`, { method: 'DELETE' }),
  operationLogs: (q = '', module = '', result = '', page = 1, pageSize = 20) => {
    const params = new URLSearchParams({ page: String(page), page_size: String(pageSize) })
    if (q.trim()) params.set('q', q.trim())
    if (module) params.set('module', module)
    if (result) params.set('result', result)
    return request<{ items: OperationLog[]; total: number; page: number; page_size: number; total_pages: number; modules: string[] }>(`api/admin/operation-logs?${params}`)
  },
  reviewTakeoverState: (id: string) => request<ReviewSubmission>(`api/reviews/submissions/${encodeURIComponent(id)}/takeover`),
  reviewTakeover: (id: string) => request<ReviewSubmission>(`api/reviews/submissions/${encodeURIComponent(id)}/takeover`, { method: 'POST' }),
  reviewConfig: () => request<ReviewWorkflowConfig>('api/reviews/config'),
  companyAuditControlUpdate: (enabled: boolean) => request<ReviewWorkflowConfig>('api/reviews/company-audit', { method: 'PUT', body: JSON.stringify({ enabled }) }),
  reviewConfigUpdate: (enabled: boolean, namingEnabled: boolean, aiRedlineEnabled: boolean, requiredRoles: string[], timedTakeoverEnabled?: boolean, timedTakeoverMinutes?: number) => request<ReviewWorkflowConfig>('api/reviews/config', {
    method: 'PUT', body: JSON.stringify({ enabled, naming_enabled: namingEnabled, ai_redline_enabled: aiRedlineEnabled, required_roles: requiredRoles, timed_takeover_enabled: timedTakeoverEnabled, timed_takeover_minutes: timedTakeoverMinutes }),
  }),
  reviewRedlineRulesUpdate: (rules: ReviewAiRule[]) => request<ReviewWorkflowConfig>('api/reviews/redline-rules', {
    method: 'PUT', body: JSON.stringify({ rules: rules.map(({ code, category, severity, title, pattern, enabled }) => ({ code, category, severity, title, pattern, enabled })) }),
  }),
  reviewRoleCreate: (data: { role_code: string; user_name: string; user_number?: string; department?: string; center?: string; group_name?: string }) => request<ReviewRoleMember>('api/reviews/roles', {
    method: 'POST', body: JSON.stringify(data),
  }),
  reviewRoleDelete: (id: number) => request<{ ok: boolean; id: number }>(`api/reviews/roles/${id}`, { method: 'DELETE' }),
  reviewPendingCount: () => request<{ count: number; roles: string[]; rejected_count: number; ai_attention_count: number }>('api/reviews/pending-count'),
  reviewSubmissions: (q = '', status = 'all', page = 1, pageSize = 20, reviewer = '', dateFrom = '', dateTo = '', acceptance = false) => {
    const params = new URLSearchParams({ q, reviewer, status, page: String(page), page_size: String(pageSize), date_from: dateFrom, date_to: dateTo, acceptance: String(acceptance) })
    return request<{ acceptance_available?: boolean; acceptance?: boolean; items: ReviewSubmission[]; total: number; summary: Record<string, number>; page: number; page_size: number; total_pages: number; workflow: ReviewWorkflowConfig }>(`api/reviews/submissions?${params}`)
  },
  reviewNamingContext: (assetId: number) => request<ReviewNamingContext>(`api/reviews/assets/${assetId}/naming-context`),
  reviewSubmit: (assetId: number, data: { note?: string; naming_evidence?: ReviewNamingEvidence[]; no_applicable_sources?: boolean; assignment_mode?: 'organization' | 'designated'; designated_reviewer_number?: string; designated_reviewer_name?: string; company_audit_channel?: '' | '抖音' | '视频号' }) => request<ReviewSubmission>(`api/reviews/assets/${assetId}/submit`, {
    method: 'POST', body: JSON.stringify(data),
  }),
  reviewBatchSubmit: (items: Array<{ asset_id: number; note?: string; naming_evidence?: ReviewNamingEvidence[]; no_applicable_sources?: boolean; assignment_mode?: 'organization' | 'designated'; designated_reviewer_number?: string; designated_reviewer_name?: string; company_audit_channel?: '' | '抖音' | '视频号' }>) => request<{ ok: boolean; total: number; succeeded: Array<{ asset_id: number; submission_id: string; asset_name: string; status: string; route_center: string; route_group: string; assignment_mode: 'organization' | 'designated'; designated_reviewer_number: string; designated_reviewer_name: string; current_reviewers: Array<{ user_name: string; user_number: string; center: string; group_name: string }> }>; failed: Array<{ asset_id: number; detail: string }> }>('api/reviews/assets/batch-submit', {
    method: 'POST', body: JSON.stringify({ items }),
  }),
  reviewApprove: (submissionId: string, roleCode: string, note = '', qualityScores: Record<string, number> = {}, companyAuditOverrideReason = '', companyAuditRevision?: number) => request<ReviewSubmission>(`api/reviews/submissions/${encodeURIComponent(submissionId)}/approve`, {
    method: 'POST', body: JSON.stringify({ role_code: roleCode, note, quality_scores: qualityScores, company_audit_override_reason: companyAuditOverrideReason, company_audit_revision: companyAuditRevision }),
  }),
  reviewReject: (submissionId: string, roleCode: string, note: string, qualityScores: Record<string, number> = {}, companyAuditOverrideReason = '', companyAuditRevision?: number) => request<ReviewSubmission>(`api/reviews/submissions/${encodeURIComponent(submissionId)}/reject`, {
    method: 'POST', body: JSON.stringify({ role_code: roleCode, note, quality_scores: qualityScores, company_audit_override_reason: companyAuditOverrideReason, company_audit_revision: companyAuditRevision }),
  }),
  reviewAiRetry: (submissionId: string) => request<ReviewSubmission>(`api/reviews/submissions/${encodeURIComponent(submissionId)}/retry-ai`, { method: 'POST' }),
  reviewCompanyFeedback: (submissionId: string, data: { revision: number; reason: string }) => request<ReviewSubmission>(`api/reviews/submissions/${encodeURIComponent(submissionId)}/company-feedback`, {
    method: 'POST', body: JSON.stringify(data),
  }),
  reviewBatchAct: (decision: 'approve' | 'reject', items: Array<{ submission_id: string; role_code: string; note?: string; quality_scores?: Record<string, number>; company_audit_override_reason?: string; company_audit_revision?: number }>) => request<{ ok: boolean; decision: string; succeeded: Array<{ submission_id: string; asset_name: string; status: string }>; failed: Array<{ submission_id: string; detail: string }> }>('api/reviews/submissions/batch-act', {
    method: 'POST', body: JSON.stringify({ decision, items }),
  }),
  qianchuanStatus: () => request<QianchuanStatus>('api/qianchuan/status'),
  pushSchemes: () => request<{ items: PushScheme[] }>('api/push-schemes/qianchuan'),
  savePushScheme: (data: { name: string; targets: QianchuanTarget[] }) => request<PushScheme>('api/push-schemes/qianchuan', { method: 'POST', body: JSON.stringify(data) }),
  deletePushScheme: (id: string, revision: number) => request<{ deleted: boolean }>(`api/push-schemes/qianchuan/${encodeURIComponent(id)}?revision=${revision}`, { method: 'DELETE' }),
  pushPreferences: (platform: 'qianchuan' | 'adq') => request<{ items: PushPreference[]; total: number }>(`api/push-preferences/${platform}`),
  togglePushPreference: (platform: 'qianchuan' | 'adq', data: { account_id: string; account_name: string; target_id?: string; target_name?: string; target_type?: string }) => request<PushPreference>(`api/push-preferences/${platform}/toggle`, {
    method: 'POST', body: JSON.stringify(data),
  }),
  qianchuanAuthorize: () => request<{ url: string }>('api/qianchuan/oauth/start'),
  qianchuanAccounts: () => request<{ items: QianchuanAccount[]; total: number }>('api/qianchuan/accounts'),
  qianchuanProductPlanMap: () => request<QianchuanProductPlanMap>('api/qianchuan/product-plan-map'),
  qianchuanPlans: (
    advertiserId: string,
    q = '',
    scope: 'all' | 'multiplication' | 'full_domain' | 'standard' = 'all',
    refresh = false,
    cachedOnly = false,
  ) => request<QianchuanPlanResult>(`api/qianchuan/plans?advertiser_id=${encodeURIComponent(advertiserId)}&q=${encodeURIComponent(q)}&scope=${scope}&refresh=${refresh ? 'true' : 'false'}&cached_only=${cachedOnly ? 'true' : 'false'}`),
  qianchuanPlanMaterials: (advertiserId: string, planId: string, startDate = '', endDate = '') => {
    const params = new URLSearchParams({ advertiser_id: advertiserId, plan_id: planId })
    if (startDate) params.set('start_date', startDate)
    if (endDate) params.set('end_date', endDate)
    return request<QianchuanPlanMaterialResult>(`api/qianchuan/plan-materials?${params}`)
  },
  qianchuanPush: (assetIds: number[], targets: QianchuanTarget[], materialOnly = false, deliveryTitle = "", library?: 'source' | 'remix') => request<{ batch_id: string; task_ids: string[]; asset_count: number; target_count: number; new_task_count: number; status: string }>('api/qianchuan/push', {
    method: 'POST', body: JSON.stringify({ asset_ids: assetIds, targets, material_only: materialOnly, delivery_title: deliveryTitle }),
  }, { library }),
  qianchuanTasks: (assetId?: number, q = '', status = 'all', page = 1, pageSize: 5 | 10 | 50 | 100 = 10, startDate = '', endDate = '') => {
    const params = new URLSearchParams()
    if (assetId) params.set('asset_id', String(assetId))
    if (q.trim()) params.set('q', q.trim())
    if (status !== 'all') params.set('status', status)
    params.set('page', String(page))
    params.set('page_size', String(pageSize))
    if (startDate) params.set('push_start_date', startDate)
    if (endDate) params.set('push_end_date', endDate)
    const suffix = params.toString()
    return request<{ items: QianchuanTask[]; total: number; page: number; page_size: number; total_pages: number; viewer_scope: 'personal' | 'all' }>(`api/qianchuan/tasks${suffix ? `?${suffix}` : ''}`)
  },
  qianchuanRetry: (taskId: string) => request<{ status: string; task_id: string }>(`api/qianchuan/tasks/${encodeURIComponent(taskId)}/retry`, { method: 'POST' }),
  qianchuanCancel: (taskId: string) => request<{ status: string; task_id: string; message: string }>(`api/qianchuan/tasks/${encodeURIComponent(taskId)}/cancel`, { method: 'POST' }),
  qianchuanRetryBatch: (batchId: string) => request<{
    status: string
    batch_id: string
    queued_count: number
    queued_task_ids: string[]
    preserved_success_count: number
    skipped_count: number
    skipped: { task_id: string; reason: string }[]
    message: string
  }>(`api/qianchuan/batches/${encodeURIComponent(batchId)}/retry-failed`, { method: 'POST' }),
  qianchuanDeleteTask: (taskId: string) => request<{ ok: boolean; task_id: string; message: string }>(`api/qianchuan/tasks/${encodeURIComponent(taskId)}`, { method: 'DELETE' }),
  qianchuanSyncMetrics: (taskIds: string[] = [], startDate?: string, endDate?: string) => request<{ status: string; task_ids: string[]; message: string; next_available_at?: string | null }>('api/qianchuan/metrics/sync', {
    method: 'POST', body: JSON.stringify({ task_ids: taskIds, start_date: startDate || null, end_date: endDate || null }),
  }),
  adqStatus: () => request<AdqStatus>('api/adq/status'),
  adqUserAuthorizationStart: () => request<{ url: string }>('api/adq/user-authorization/start'),
  adqSharedConfig: () => request<{ configured: boolean; authorized: boolean; source_account_id: string; mdm_id: string; scope: string; asset_type: string; original_only: boolean; max_video_mb: number; business_units: { id: string; name: string }[]; known_account_total: number; account_scope_source: string }>('api/adq/shared-library/config'),
  adqSharedUpload: (assetIds: number[], library?: 'source' | 'remix') => request<{ batch_id: string; task_ids: string[]; reused_task_ids: string[]; asset_count: number; new_task_count: number; status: string; message: string }>('api/adq/shared-library/upload', {
    method: 'POST', body: JSON.stringify({ asset_ids: assetIds }),
  }, { library }),
  adqAccounts: () => request<AdqAccountCatalog>('api/adq/accounts'),
  adqHierarchy: (q = '', refresh = false) => {
    const params = new URLSearchParams()
    if (q.trim()) params.set('q', q.trim())
    if (refresh) params.set('refresh', 'true')
    return request<AdqHierarchy>(`api/adq/hierarchy${params.size ? `?${params}` : ''}`)
  },
  adqAdgroups: (accountId: string, q = '') => request<{ items: AdqAdgroup[]; total: number; source_total: number; attachable_total: number; complete: boolean; message: string }>(`api/adq/adgroups?account_id=${encodeURIComponent(accountId)}&q=${encodeURIComponent(q)}`),
  adqAccountMaterialMetrics: (accountId: string, startDate = '', endDate = '', q = '', page = 1, pageSize = 20) => {
    const params = new URLSearchParams({ account_id: accountId, page: String(page), page_size: String(pageSize) })
    if (startDate) params.set('start_date', startDate)
    if (endDate) params.set('end_date', endDate)
    if (q.trim()) params.set('q', q.trim())
    return request<AdqAccountMaterialMetrics>(`api/adq/account-material-metrics?${params}`)
  },
  adqPush: (assetIds: number[], targets: AdqTarget[], library?: 'source' | 'remix') => request<{ batch_id: string; task_ids: string[]; asset_count: number; target_count: number; new_task_count: number; status: string }>('api/adq/push', {
    method: 'POST', body: JSON.stringify({ asset_ids: assetIds, targets }),
  }, { library }),
  adqTasks: (assetId?: number, q = '', status = 'all', page = 1, pageSize: 5 | 10 = 10, libraryOnly = false, startDate = '', endDate = '') => {
    const params = new URLSearchParams()
    if (assetId) params.set('asset_id', String(assetId))
    if (q.trim()) params.set('q', q.trim())
    if (status !== 'all') params.set('status', status)
    params.set('page', String(page))
    params.set('page_size', String(pageSize))
    if (libraryOnly) params.set('library_only', 'true')
    if (startDate) params.set('push_start_date', startDate)
    if (endDate) params.set('push_end_date', endDate)
    return request<{ items: AdqTask[]; total: number; page: number; page_size: number; total_pages: number; viewer_scope: 'personal' | 'all' }>(`api/adq/tasks?${params}`)
  },
  adqRetry: (taskId: string) => request<{ status: string; task_id: string }>(`api/adq/tasks/${encodeURIComponent(taskId)}/retry`, { method: 'POST' }),
  adqRetryBatch: (batchId: string) => request<{ status: string; batch_id: string; queued_count: number; queued_task_ids: string[]; preserved_success_count: number; skipped_count: number; skipped: { task_id: string; reason: string }[]; message: string }>(`api/adq/batches/${encodeURIComponent(batchId)}/retry-failed`, { method: 'POST' }),
  adqDeleteTask: (taskId: string) => request<{ ok: boolean; task_id: string; message: string }>(`api/adq/tasks/${encodeURIComponent(taskId)}`, { method: 'DELETE' }),
  adqSyncMetrics: (taskIds: string[] = [], startDate?: string, endDate?: string) => request<{ status: string; task_ids: string[]; message: string; next_available_at?: string | null }>('api/adq/metrics/sync', {
    method: 'POST', body: JSON.stringify({ task_ids: taskIds, start_date: startDate || null, end_date: endDate || null }),
  }),
  channelsStatus: () => request<ChannelsStatus>('api/channels/status'),
  channelsAuthStart: () => request<ChannelsAuthSession>('api/channels/auth/start', { method: 'POST' }),
  channelsAuthCancel: (sessionId: string) => request<ChannelsAuthSession>(`api/channels/auth/sessions/${encodeURIComponent(sessionId)}/cancel`, { method: 'POST' }),
  channelsAuthSession: (sessionId: string) => request<ChannelsAuthSession>(`api/channels/auth/sessions/${encodeURIComponent(sessionId)}`),
  channelsAuthInteract: (sessionId: string, x: number, y: number, action: 'click' | 'scroll' | 'select' | 'select_account' | 'scroll_accounts' = 'click', deltaY = 0, choiceId = '') => request<ChannelsAuthSession>(`api/channels/auth/sessions/${encodeURIComponent(sessionId)}/interact`, {
    method: 'POST', body: JSON.stringify({ action, x, y, delta_y: deltaY, choice_id: choiceId }),
  }),
  channelsQrUrl: (sessionId: string, revision = 0) => `api/channels/auth/sessions/${encodeURIComponent(sessionId)}/qr?revision=${Math.max(0, revision)}`,
  channelsAccounts: (includeInactive = false) => request<{ items: ChannelsAccount[]; total: number }>(`api/channels/accounts${includeInactive ? '?include_inactive=true' : ''}`),
  channelsAccountDelete: (accountId: string) => request<{ ok: boolean; account_id: string }>(`api/channels/accounts/${encodeURIComponent(accountId)}`, { method: 'DELETE' }),
  channelsPromotionAuthStatus: (accountId: string) => request<ChannelsPromotionAuth>(`api/channels/accounts/${encodeURIComponent(accountId)}/promotion-auth`),
  channelsPromotionAuthStart: (accountId: string) => request<ChannelsPromotionAuthSession>(`api/channels/accounts/${encodeURIComponent(accountId)}/promotion-auth/start`, { method: 'POST' }),
  channelsPromotionAuthSession: (sessionId: string) => request<ChannelsPromotionAuthSession>(`api/channels/promotion-auth/sessions/${encodeURIComponent(sessionId)}`),
  channelsPromotionCaptureUrl: (sessionId: string, revision = 0) => `api/channels/promotion-auth/sessions/${encodeURIComponent(sessionId)}/capture?revision=${Math.max(0, revision)}`,
  channelsProducts: (accountId: string, q = '', refresh = false) => {
    const params = new URLSearchParams()
    if (q.trim()) params.set('q', q.trim())
    if (refresh) params.set('refresh', 'true')
    return request<{
      state: 'loading' | 'refreshing' | 'ready' | 'error'
      items: ChannelsProduct[]
      total: number
      cached_total: number
      cached: boolean
      stale: boolean
      message: string
      error: string
      stage: string
      attempt: number
      max_attempts: number
      retry_after_ms: number
      account_id: string
      account_name: string
      source: string
      read_at: string
      complete: boolean
      expected_total: number
      page_count: number
    }>(`api/channels/accounts/${encodeURIComponent(accountId)}/products?${params}`)
  },
  channelsPush: (assetIds: number[], accountIds: string[], title = '', description = '', tags: string[] = [], product?: ChannelsProduct | null, covers: { asset_id: number; object_key: string; filename: string }[] = [], titles: { asset_id: number; title: string }[] = [], annotations: ChannelsVideoAnnotationInput[] = [], descriptions: { asset_id: number; description: string }[] = [], library?: 'source' | 'remix') => request<{ batch_id: string; task_ids: string[]; duplicate_task_ids: string[]; asset_count: number; account_count: number; status: string; message: string }>('api/channels/push', {
    method: 'POST', body: JSON.stringify({ asset_ids: assetIds, account_ids: accountIds, title, description, tags, product_id: product?.id || '', product_name: product?.name || '', covers, titles, annotations, descriptions }),
  }, { library }),
  channelsTasks: (q = '', status = 'all', page = 1, pageSize: 5 | 10 = 10, scope: 'mine' | 'all' = 'mine', startDate = '', endDate = '') => {
    const params = new URLSearchParams({ page: String(page), page_size: String(pageSize), scope })
    if (q.trim()) params.set('q', q.trim())
    if (status !== 'all') params.set('status', status)
    if (startDate) params.set('push_start_date', startDate)
    if (endDate) params.set('push_end_date', endDate)
    return request<{ items: ChannelsTask[]; total: number; page: number; page_size: number; total_pages: number; viewer_scope: 'personal' | 'all'; can_view_all: boolean }>(`api/channels/tasks?${params}`)
  },
  channelsSyncMetrics: (taskIds: string[] = []) => request<{ status: string; task_ids: string[]; message: string }>('api/channels/metrics/sync', {
    method: 'POST', body: JSON.stringify({ task_ids: taskIds }),
  }),
  channelsEdit: (taskId: string, data: { title: string; description: string; product_id: string; product_name: string; cover_object_key?: string; cover_filename?: string; retry: boolean }) => request<{ status: string; task_id: string; message: string }>(`api/channels/tasks/${encodeURIComponent(taskId)}`, { method: 'PATCH', body: JSON.stringify(data) }),
  channelsPromotionQuote: (taskId: string, data: ChannelsPromotionQuoteInput) => request<ChannelsPromotionQuoteResult>(`api/channels/tasks/${encodeURIComponent(taskId)}/promotion/quote`, {
    method: 'POST', body: JSON.stringify(data),
  }),
  channelsPromotionCreate: (taskId: string, data: ChannelsPromotionQuoteInput & { order_name: string; confirmed: boolean; idempotency_key: string }) => request<ChannelsPromotionOrder>(`api/channels/tasks/${encodeURIComponent(taskId)}/promotion/orders`, {
    method: 'POST', body: JSON.stringify(data),
  }),
  channelsPromotionOrders: (taskId: string) => request<{ items: ChannelsPromotionOrder[]; total: number }>(`api/channels/tasks/${encodeURIComponent(taskId)}/promotion/orders`),
  channelsPromotionPaymentSessionCreate: (taskId: string, orderId: string, requestToken: string) => request<ChannelsPromotionPaymentSession>(`api/channels/tasks/${encodeURIComponent(taskId)}/promotion/orders/${encodeURIComponent(orderId)}/payment-sessions`, { method: 'POST', body: JSON.stringify({ request_token: requestToken }) }),
  channelsPromotionPaymentSessionGet: (taskId: string, orderId: string, sessionId: string) => request<ChannelsPromotionPaymentSession>(`api/channels/tasks/${encodeURIComponent(taskId)}/promotion/orders/${encodeURIComponent(orderId)}/payment-sessions/${encodeURIComponent(sessionId)}`),
  channelsPromotionPaymentSessionEvent: (taskId: string, orderId: string, sessionId: string, action: 'consumeSuccess' | 'consumeError' | 'consumeClose' | 'consumeStatusChange', message = '') => request<ChannelsPromotionPaymentSession>(`api/channels/tasks/${encodeURIComponent(taskId)}/promotion/orders/${encodeURIComponent(orderId)}/payment-sessions/${encodeURIComponent(sessionId)}/events`, { method: 'POST', body: JSON.stringify({ action, message }) }),
  channelsPromotionSync: (taskId: string, orderId: string) => request<ChannelsPromotionOrder>(`api/channels/tasks/${encodeURIComponent(taskId)}/promotion/orders/${encodeURIComponent(orderId)}/sync`, { method: 'POST' }),
  channelsRetry: (taskId: string) => request<{ status: string; task_id: string }>(`api/channels/tasks/${encodeURIComponent(taskId)}/retry`, { method: 'POST' }),
  channelsCancel: (taskId: string) => request<{ status: string; task_id: string; message: string }>(`api/channels/tasks/${encodeURIComponent(taskId)}/cancel`, { method: 'POST' }),
  channelsDeleteTask: (taskId: string) => request<{ ok: boolean; task_id: string; message: string }>(`api/channels/tasks/${encodeURIComponent(taskId)}`, { method: 'DELETE' }),
  videoRequests: (scope: 'mine' | 'assigned' | 'all' = 'mine', status = 'all', q = '', page = 1, pageSize = 10) => {
    const params = new URLSearchParams({ scope, status, q, page: String(page), page_size: String(pageSize) })
    return request<VideoRequestPage>(`api/video-requests?${params}`)
  },
  videoRequest: (requestId: string) => request<VideoRequestItem>(`api/video-requests/${encodeURIComponent(requestId)}`),
  videoRequestReferencePreviews: (requestId: string) => request<{ status: 'empty' | 'ready' | 'processing' | 'queued' | string; request_id: string }>(`api/video-requests/${encodeURIComponent(requestId)}/reference-previews`, { method: 'POST' }),
  videoRequestCreate: (data: { client_request_id?: string; product: string; description: string; reference_url?: string; reference_video_key?: string; reference_video_name?: string; reference_videos?: { object_key: string; filename: string }[]; reference_images?: { object_key: string; filename: string }[] }) =>
    request<VideoRequestItem>('api/video-requests', { method: 'POST', body: JSON.stringify(data) }),
  videoRequestAssignees: (q = '') => request<{ items: VideoRequestAssignee[]; total: number }>(`api/video-requests/assignees?q=${encodeURIComponent(q)}`),
  videoRequestAssign: (requestId: string, assignee: VideoRequestAssignee) => request<VideoRequestItem>(`api/video-requests/${encodeURIComponent(requestId)}/assign`, {
    method: 'POST', body: JSON.stringify({ assignee_number: assignee.number, assignee_name: assignee.name }),
  }),
  videoRequestStart: (requestId: string) => request<VideoRequestItem>(`api/video-requests/${encodeURIComponent(requestId)}/start`, { method: 'POST' }),
  videoRequestDeliver: (requestId: string, assetIds: number[], note = '') => request<VideoRequestItem>(`api/video-requests/${encodeURIComponent(requestId)}/deliver`, {
    method: 'POST', body: JSON.stringify({ asset_ids: assetIds, note }),
  }),
  videoRequestReturn: (requestId: string, reason: string) => request<VideoRequestItem>(`api/video-requests/${encodeURIComponent(requestId)}/return`, {
    method: 'POST', body: JSON.stringify({ reason }),
  }),
  videoRequestAccept: (requestId: string) => request<VideoRequestItem>(`api/video-requests/${encodeURIComponent(requestId)}/accept`, { method: 'POST' }),
  videoRequestRevision: (requestId: string, feedback: string) => request<VideoRequestItem>(`api/video-requests/${encodeURIComponent(requestId)}/revision`, {
    method: 'POST', body: JSON.stringify({ feedback }),
  }),
  notifications: (limit = 20) => request<{ items: UserNotification[]; unread: number }>(`api/notifications?limit=${limit}`),
  notificationRead: (id: number) => request<{ ok: boolean; id: number }>(`api/notifications/${id}/read`, { method: 'POST' }),
  notificationsReadAll: () => request<{ ok: boolean; count: number }>('api/notifications/read-all', { method: 'POST' }),
}
