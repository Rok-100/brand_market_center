<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Clock3, ExternalLink, Play, ShieldAlert, ShieldCheck } from 'lucide-vue-next'
import type { CompanyAuditFinding, CompanyAuditResult } from '../types'
import { companyAuditApprovalBlock, companyAuditBlocksDistribution, companyAuditNeedsOverride, companyAuditStatusLabel, companyAuditVerdictLabel, companyFindingSeconds, safeCompanyFrameUrl } from '../companyAudit'

const props = defineProps<{ audit?: CompanyAuditResult | null; canSeek: boolean; canRetryFeedback?: boolean; humanStatus?: 'pending' | 'approved' | 'rejected'; retryBusy?: boolean }>()
const emit = defineEmits<{ seek: [seconds: number]; retryFeedback: [payload: { revision: number; reason: string }] }>()
const recoveryReason = ref('')
const confirmedRecoveryRevision = ref<number | null>(null)
const canShowFeedbackRecovery = computed(() => props.audit?.enabled === true && props.canRetryFeedback === true && ['approved', 'rejected'].includes(props.humanStatus || '') && Boolean(props.audit))
const recoveryHumanDecision = computed(() => props.humanStatus === 'approved' ? '通过' : '驳回')
const recoveryReady = computed(() => canShowFeedbackRecovery.value && !props.retryBusy && Boolean(recoveryReason.value.trim()) && typeof props.audit?.revision === 'number' && props.audit.revision > 0 && confirmedRecoveryRevision.value === props.audit.revision)
watch([() => props.audit?.task_id, () => props.audit?.revision, () => props.audit?.verdict, () => props.humanStatus, () => props.canRetryFeedback], () => {
  confirmedRecoveryRevision.value = null
})
const confirmRecovery = (event: Event) => {
  confirmedRecoveryRevision.value = (event.target as HTMLInputElement).checked ? props.audit?.revision ?? null : null
}
const retryFeedback = () => {
  if (!recoveryReady.value || typeof props.audit?.revision !== 'number') return
  const payload = { revision: props.audit.revision, reason: recoveryReason.value.trim() }
  confirmedRecoveryRevision.value = null
  emit('retryFeedback', payload)
}
const tone = computed(() => {
  if (!props.audit) return 'legacy'
  if (!props.audit.enabled) return 'legacy'
  if (props.audit.status === 'failed' || props.audit.error_code || ['error', 'conflict'].includes(props.audit.feedback_status)) return 'error'
  if (props.audit.verification_pending || props.audit.ready === false) return 'pending'
  if (props.audit.status !== 'success') return 'pending'
  if (companyAuditNeedsOverride(props.audit)) return 'attention'
  return props.audit.verdict === 'pass' ? 'pass' : 'pending'
})
const time = (value?: string | null) => {
  if (!value) return '尚未记录'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '时间待确认' : new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(date)
}
const tierLabel = (tier: string) => (({ red: '红线', yellow: '黄线', green: '绿线' } as Record<string, string>)[tier] || '规则提示')
const findingTime = (finding: CompanyAuditFinding) => {
  if (finding.time_range) return finding.time_range
  const seconds = companyFindingSeconds(finding)
  return seconds == null ? '时间点未提供' : `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toFixed(3).padStart(6, '0')}`
}
const seek = (finding: CompanyAuditFinding) => {
  const seconds = companyFindingSeconds(finding)
  if (seconds != null) emit('seek', seconds)
}
const feedbackLabel = (value: string) => (({
  queued: '复核意见等待回传', sending: '复核意见回传中', confirmed: '公司已确认复核回传', error: '复核意见回传失败',
  waiting_result: '等待公司结果后回传复核意见', verify_before_send: '回传前核对公司最新结论', ready_to_send: '复核意见待回传',
  verify_after_uncertain: '回传结果不确定，正在向公司核验', awaiting_readback: '意见已回传，等待公司结果读回确认',
  conflict: '公司结论已变化，请重新核对并复核', superseded: '复核意见已由新决定替代，等待最新状态',
} as Record<string, string>)[value] || '回传状态待确认')
</script>

<template>
  <section class="company-audit-card" :class="tone" aria-label="公司素材审核">
    <header><span><ShieldCheck /><strong>公司素材审核</strong></span><b>{{ audit ? audit.enabled ? companyAuditStatusLabel(audit.status) : '已关闭 · 历史结果' : '无公司审核记录' }}</b></header>
    <p class="company-rule-owner">规则由公司审核系统统一维护，按公司审核结论处理。</p><p v-if="audit?.takeover_active" class="company-audit-notice">已由人工接管审核，以下公司结果继续保留供参考；本次放行以人工审核结论为准。</p>
    <template v-if="audit">
      <p v-if="!audit.enabled" class="company-audit-notice">公司审核已关闭，以下历史记录仅供查看，不参与当前拦截；已提交的任务继续回收结果。</p>
      <strong class="company-verdict">{{ companyAuditVerdictLabel(audit) }}</strong>
      <p v-if="audit.summary">{{ audit.summary }}</p>
      <p v-if="audit.enabled && ['queued', 'submitting', 'pending', 'processing', 'retry_wait'].includes(audit.status)" class="company-audit-notice"><Clock3 />排队和审核可能超过 1 小时，当前尚未通过。系统会持续跟进同一任务，请勿重复提审。</p>
      <p v-if="companyAuditApprovalBlock(audit)" class="company-audit-notice">{{ companyAuditApprovalBlock(audit) }}</p>
      <p v-if="audit.error_message" class="company-audit-error" role="status">{{ audit.error_message }}</p>
      <p v-if="audit.product_mapping_missing" class="company-audit-notice"><ShieldAlert />产品编码尚未映射，明星对本产品的授权核验不完整，请人工核对授权资料。</p>
      <p v-if="!audit.channel" class="company-audit-notice"><ShieldAlert />未指定投放渠道，明星授权的渠道范围尚待人工核验。</p>
      <p v-if="companyAuditNeedsOverride(audit)" class="company-audit-notice">请逐条核对红线或黄线。人工通过须填写明确复核依据，意见将回传公司，回传确认前不可推送。</p>
      <p v-if="audit.feedback_status" class="company-feedback" role="status">{{ feedbackLabel(audit.feedback_status) }}<span v-if="audit.enabled && audit.feedback_status !== 'confirmed'">；确认前不可推送。</span></p>
      <p v-if="companyAuditBlocksDistribution(audit)" class="company-feedback">{{ audit.gate_reason || '公司审核尚未放行' }}；当前不可推送。</p>
      <details v-if="audit.findings.length" class="company-findings">
        <summary>查看 {{ audit.findings.length }} 条公司规则与证据</summary>
        <ol>
          <li v-for="(finding, index) in audit.findings" :key="`${finding.rule_code}-${finding.time_start_ms}-${index}`">
            <header><b :class="['company-tier', ['red', 'yellow', 'green'].includes(finding.tier) ? finding.tier : 'other']">{{ tierLabel(finding.tier) }}</b><strong>{{ finding.rule_code }} {{ finding.rule_name || '未提供规则名称' }}</strong></header>
            <p><b>规则依据</b>{{ finding.rule_remark || '公司未返回判定依据，请人工核对。' }}</p>
            <blockquote><b>命中原句 / 画面证据</b>{{ finding.evidence || '公司未返回证据原文，请人工核对。' }}</blockquote>
            <div class="company-evidence-actions">
              <button v-if="canSeek && companyFindingSeconds(finding) != null" type="button" :aria-label="`定位到 ${findingTime(finding)}`" @click="seek(finding)"><Play />{{ findingTime(finding) }}</button>
              <span v-else>{{ findingTime(finding) }}</span>
              <a v-if="safeCompanyFrameUrl(finding.frame_url)" :href="safeCompanyFrameUrl(finding.frame_url)" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer"><ExternalLink />证据截图</a>
              <span v-else>无可用 HTTPS 截图</span>
            </div>
          </li>
        </ol>
      </details>
      <p v-else-if="audit.status === 'success'" class="company-empty-findings">公司未返回需展示的规则命中；审核结论以上方结果为准。</p>
      <section v-if="canShowFeedbackRecovery" class="company-feedback-recovery" aria-label="重新核对并回传人工结论">
        <strong>重新核对并回传人工结论</strong>
        <p>当前公司结论：<b>{{ companyAuditVerdictLabel(audit) }}</b>；结果版本 {{ audit.revision ?? '尚未读取' }}。请核对上方最新规则与证据。</p>
        <p>原人工结论为“{{ recoveryHumanDecision }}”。本操作维持该结论，在同一任务内重发复核意见，不重新上传素材。</p>
        <label><span>本次复核理由（必填）</span><textarea v-model="recoveryReason" :disabled="retryBusy" rows="3" maxlength="2000" placeholder="结合公司最新结论，说明仍维持原人工决定的依据。" /></label>
        <label class="company-recovery-confirm"><input type="checkbox" :checked="confirmedRecoveryRevision != null && confirmedRecoveryRevision === audit.revision" :disabled="retryBusy || audit.revision == null" @change="confirmRecovery" /><span>已核对本版本公司结论与证据，确认维持人工“{{ recoveryHumanDecision }}”并重发。</span></label>
        <button type="button" :disabled="!recoveryReady" @click="retryFeedback">{{ retryBusy ? '正在核对回传状态…' : `确认维持“${recoveryHumanDecision}”并重发` }}</button>
        <small>回传确认前不可推送。公司结果更新后，需要重新核对并确认。</small>
      </section>
      <details class="company-audit-meta"><summary>审核记录</summary><dl><dt>公司任务号</dt><dd>{{ audit.task_id || '尚未取得' }}</dd><dt>产品编码</dt><dd>{{ audit.product_id || '未提供' }}</dd><dt>投放渠道</dt><dd>{{ audit.channel || '未指定，授权范围待核验' }}</dd><dt>上次查询</dt><dd>{{ time(audit.last_checked_at) }}</dd><template v-if="audit.next_attempt_at"><dt>下次尝试</dt><dd>{{ time(audit.next_attempt_at) }}</dd></template></dl></details>
    </template>
    <p v-else>此历史任务没有公司审核记录，不能视为公司审核通过；保留原人工审核流程。</p>
  </section>
</template>

<style scoped>
.company-feedback-recovery{display:grid;gap:8px;padding:10px;border:1px solid #ddc994;border-radius:9px;background:#fffaf0}.company-feedback-recovery>label{display:grid;gap:5px}.company-feedback-recovery textarea{box-sizing:border-box;width:100%;resize:vertical;padding:8px;border:1px solid #c7dce8;border-radius:7px;background:#fff;color:#244f67;font:inherit;line-height:1.5}.company-feedback-recovery .company-recovery-confirm{display:flex;align-items:flex-start;gap:6px;cursor:pointer}.company-recovery-confirm input{flex:none;margin:3px 0 0;accent-color:#1479a7}.company-feedback-recovery>button{padding:9px;border:1px solid #167ba8;border-radius:7px;color:#fff!important;background:#167ba8!important;font:inherit;font-weight:700;cursor:pointer}.company-feedback-recovery>button:disabled{opacity:.5;cursor:not-allowed}.company-feedback-recovery small{color:#6d7f88;font-size:10px}.company-feedback-recovery>button:focus-visible{outline:2px solid #197eaa;outline-offset:2px}
.company-audit-card{display:grid;gap:8px;padding:13px;border-top:1px solid #cbdde7;color:#244f67;background:#f2f8fc;font-size:12px;line-height:1.5;overflow-wrap:anywhere}
.company-audit-card>header,.company-audit-card>header>span{display:flex;align-items:center;gap:6px}.company-audit-card>header{justify-content:space-between}.company-audit-card>header svg{width:16px;height:16px;flex:none}.company-audit-card>header b{padding:3px 7px;border-radius:20px;color:#315d79;background:#deedf7;font-size:10px}.company-audit-card p{margin:0}.company-audit-card .company-rule-owner{color:#5f7686;font-size:10px}.company-verdict{font-size:13px}.company-audit-card.pass{background:#effaf6}.pass .company-verdict{color:#0f7052}.company-audit-card.attention{background:#fff9ec}.attention .company-verdict{color:#8f5911}.company-audit-card.error{background:#fff4f4}.error .company-verdict,.company-audit-error{color:#a63846}.company-audit-card.legacy{background:#f7f9fa;color:#677e8a}.company-audit-notice{display:flex;align-items:flex-start;gap:6px}.company-audit-notice svg{flex:none;width:15px;height:15px;margin-top:2px}.company-feedback{padding:7px 8px;border:1px solid #d8e4ec;border-radius:7px;font-weight:700;background:rgba(255,255,255,.7)}
.company-audit-card summary{font-weight:700;cursor:pointer}.company-findings ol{display:grid;gap:9px;margin:9px 0 0;padding:0;list-style:none}.company-findings li{display:grid;gap:8px;padding:10px;border:1px solid #dce7ed;border-radius:8px;background:#fff}.company-findings li>header{display:flex;align-items:flex-start;gap:5px}.company-findings li p,.company-findings blockquote{display:grid;gap:2px;margin:0}.company-findings blockquote{padding:7px 8px;border-left:3px solid #abc3d1;background:#f5f8fa;white-space:pre-wrap}.company-findings li p>b,.company-findings blockquote>b{font-size:10px;color:#617b8b}.company-tier{flex:none;padding:2px 5px;border-radius:4px;font-size:10px}.company-tier.red{color:#a72d3c;background:#ffeaed}.company-tier.yellow{color:#876012;background:#fff0c9}.company-tier.green{color:#146c51;background:#e4f4ed}.company-tier.other{color:#4c6879;background:#edf2f5}.company-evidence-actions{display:flex;align-items:center;flex-wrap:wrap;gap:8px;font-size:10px}.company-evidence-actions button,.company-evidence-actions a{display:inline-flex;align-items:center;gap:4px;padding:5px 7px;border:1px solid #c4dce8;border-radius:6px;color:#116a93!important;background:#f5fbfe!important;font:inherit;font-weight:700;text-decoration:none;cursor:pointer}.company-evidence-actions svg{width:12px;height:12px}.company-evidence-actions>span{color:#6f8491}.company-evidence-actions button:focus-visible,.company-evidence-actions a:focus-visible{outline:2px solid #197eaa;outline-offset:2px}.company-empty-findings{color:#637e8e}.company-audit-meta{font-size:10px;color:#617c8c}.company-audit-meta dl{display:grid;grid-template-columns:auto minmax(0,1fr);gap:3px 7px;margin:7px 0 0}.company-audit-meta dd{margin:0}
</style>
