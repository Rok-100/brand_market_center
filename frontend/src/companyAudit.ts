import type { CompanyAuditFinding, CompanyAuditResult } from './types'

const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const text = (value: unknown) => typeof value === 'string' ? value : ''
const finiteNumber = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : null

export const normalizeCompanyAudit = (value: unknown): CompanyAuditResult | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = record(value)
  return {
    id: text(raw.id),
    created_at: text(raw.created_at) || null,
    last_verified_at: text(raw.last_verified_at) || null,
    takeover_active: raw.takeover_active === true,
    takeover_dispatch_allowed: raw.takeover_dispatch_allowed === true,
    enabled: raw.enabled === true,
    channel: text(raw.channel),
    status: text(raw.status) || 'unknown',
    verdict: text(raw.verdict) || 'unknown',
    task_id: text(raw.task_id),
    summary: text(raw.summary),
    findings: (Array.isArray(raw.findings) ? raw.findings : []).filter(value => value && typeof value === 'object' && !record(value).shadow).map(value => {
      const finding = record(value)
      return {
        time_start_ms: finiteNumber(finding.time_start_ms),
        time_end_ms: finiteNumber(finding.time_end_ms),
        time_range: text(finding.time_range),
        rule_code: text(finding.rule_code),
        rule_name: text(finding.rule_name),
        rule_remark: text(finding.rule_remark),
        tier: text(finding.tier),
        severity: text(finding.severity),
        evidence: text(finding.evidence),
        confidence: finiteNumber(finding.confidence),
        frame_url: safeCompanyFrameUrl(text(finding.frame_url)),
      }
    }),
    error_message: text(raw.error_message),
    error_code: text(raw.error_code),
    ready: typeof raw.ready === 'boolean' ? raw.ready : undefined,
    verification_pending: raw.verification_pending === true,
    dispatch_allowed: typeof raw.dispatch_allowed === 'boolean' ? raw.dispatch_allowed : undefined,
    gate_reason: text(raw.gate_reason),
    revision: typeof raw.revision === 'number' && Number.isSafeInteger(raw.revision) && raw.revision >= 0 ? raw.revision : null,
    next_attempt_at: text(raw.next_attempt_at) || null,
    last_checked_at: text(raw.last_checked_at) || null,
    product_id: text(raw.product_id),
    product_mapping_missing: raw.product_mapping_missing === true,
    feedback_status: text(raw.feedback_status),
    feedback_verdict: text(raw.feedback_verdict),
    blocking: raw.blocking === true,
  }
}

export const safeCompanyFrameUrl = (value: string): string => {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : ''
  } catch { return '' }
}

export const companyAuditStatusLabel = (status: string) => (({
  queued: '等待送审', submitting: '正在送审', pending: '公司排队中', processing: '公司审核中',
  success: '审核已完成', failed: '公司审核失败', retry_wait: '等待重试', unknown: '状态待确认',
} as Record<string, string>)[status] || '状态待确认')

export const companyAuditVerdictLabel = (audit: CompanyAuditResult) => {
  if (audit.verification_pending) return '结论待服务端核验'
  if (audit.error_code) return '结果核验异常，尚未放行'
  if (audit.ready === false) return '尚无完整结论'
  if (audit.status !== 'success') return '尚无结论'
  return (({ pass: '公司审核通过', reject: '红线 · 不通过', manual_required: '黄线 · 待人工复核' } as Record<string, string>)[audit.verdict] || '结论待确认')
}

export const companyAuditNeedsOverride = (audit?: CompanyAuditResult | null) => Boolean(audit && !audit.takeover_active && audit.enabled && audit.status === 'success' && (
  ['reject', 'manual_required'].includes(audit.verdict) || audit.findings.some(finding => ['red', 'yellow'].includes(finding.tier))
))

export const companyAuditApprovalBlock = (audit?: CompanyAuditResult | null): string => {
  if (!audit || !audit.enabled || audit.takeover_active) return ''
  if (audit.verification_pending || audit.error_code) return '公司审核结论尚未核验完成，暂不能通过；仍可人工驳回。'
  if (audit.ready === false) return '公司审核尚未返回完整结论，暂不能通过；仍可人工驳回。'
  if (audit.status === 'failed') return '公司审核失败，尚不能通过；可填写修改意见后驳回。'
  if (audit.status !== 'success') return '公司审核尚未完成，暂不能通过；仍可人工驳回。'
  if (!['pass', 'reject', 'manual_required'].includes(audit.verdict)) return '公司审核结论待确认，暂不能通过；仍可人工驳回。'
  return ''
}

export const companyAuditBlocksDistribution = (audit?: CompanyAuditResult | null) => Boolean(audit && audit.enabled && (
  audit.takeover_active ? !audit.takeover_dispatch_allowed : audit.blocking || audit.dispatch_allowed === false || companyAuditApprovalBlock(audit) || audit.verdict !== 'pass' ||
  (audit.feedback_status && audit.feedback_status !== 'confirmed') ||
  (companyAuditNeedsOverride(audit) && !(audit.feedback_status === 'confirmed' && audit.feedback_verdict === 'pass'))
))

export const companyAuditNeedsRefresh = (audit?: CompanyAuditResult | null) => Boolean(audit && audit.enabled && (
  ['queued', 'submitting', 'pending', 'processing', 'retry_wait'].includes(audit.status) ||
  ['queued', 'sending', 'waiting_result', 'verify_before_send', 'verify_after_uncertain', 'ready_to_send', 'awaiting_readback'].includes(audit.feedback_status) ||
  audit.verification_pending || Boolean(audit.error_code)
))

export const companyFindingSeconds = (finding: CompanyAuditFinding): number | null => typeof finding.time_start_ms === 'number' && Number.isFinite(finding.time_start_ms) && finding.time_start_ms >= 0 ? finding.time_start_ms / 1000 : null
