<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { Download, RefreshCw, ArrowUpRight } from 'lucide-vue-next'
import { api } from '../api'
import type { ProductionReport } from '../production-types'
const emit = defineEmits<{ openAsset: [id: number] }>()
const props = withDefaults(defineProps<{ userNumber?: string }>(), {userNumber:''})
const dateText = (d: Date) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(d)
const end = ref(dateText(new Date()))
const start = ref(dateText(new Date(Date.now() - 6 * 86400000)))
const channel = ref('all'), dimension = ref('product'), product = ref(''), creator = ref(''), tag = ref(''), q = ref('')
const report = ref<ProductionReport | null>(null), loading = ref(false), exporting = ref(false), error = ref(''), page = ref(1)
const applied = ref<Record<string, string>>({})
const progress = ref('正在读取素材与已核验回流…')
const savedFilters = ref<{ id: string; name: string; filters: Record<string,string> }[]>([])
const savedId = ref(''), savedName = ref('')
const savedKey = () => `wis-production-filters-v1:${props.userNumber}`
function readSaved() {
  if (!props.userNumber) return
  try { const value=JSON.parse(localStorage.getItem(savedKey()) || '[]'); if(Array.isArray(value)) savedFilters.value=value.filter(v=>v && typeof v.name==='string' && typeof v.id==='string' && v.filters && Object.values(v.filters).every(x=>typeof x==='string')).slice(0,6) } catch { savedFilters.value=[] }
}
function saveFilter() {
  if(!props.userNumber || !report.value || !savedName.value.trim()) return
  const value=[{id:crypto.randomUUID(),name:savedName.value.trim().slice(0,40),filters:{...applied.value}},...savedFilters.value].slice(0,6)
  try { localStorage.setItem(savedKey(),JSON.stringify(value)); savedFilters.value=value; savedName.value='' } catch { error.value='当前浏览器无法保存筛选，报告仍可正常使用' }
}
function useSaved() {
  const value=savedFilters.value.find(v=>v.id===savedId.value)?.filters
  if(!value) return
  start.value=value.start_date || start.value; end.value=value.end_date || end.value
  channel.value=value.channel || 'all'; dimension.value=value.dimension || 'product'
  product.value=value.product || ''; creator.value=value.creator || ''; tag.value=value.tag || ''; q.value=value.q || ''
  void load()
}
let sequence = 0
const money = (value: number | null | undefined) => value == null ? '待回流' : `¥${value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const ratio = (value: number | null | undefined) => value == null ? '—' : value.toFixed(2)
const timeText = (value: string | null) => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '暂无回流记录'
const channelCards = computed(() => Object.entries(report.value?.channels || {}).filter(([key]) => report.value?.channel === 'all' || key === report.value?.channel))
const maxOutput = computed(() => Math.max(1, ...report.value?.daily.map(d => d.output) || []))
const maxGroup = computed(() => Math.max(1, ...report.value?.groups.map(d => d.output) || []))
const pages = computed(() => Math.max(1, Math.ceil((report.value?.total || 0) / 20)))
const summary = computed(() => report.value?.summary)
const query = () => ({ start_date: start.value, end_date: end.value, channel: channel.value, dimension: dimension.value, product: product.value.trim(), creator: creator.value.trim(), tag: tag.value.trim(), q: q.value.trim() })
async function load(nextPage = 1, refresh = true) {
  if (loading.value) return
  loading.value = true; error.value = ''; const id = ++sequence
  const filters = refresh ? query() : applied.value
  try {
    const result = await api.productionAnalytics({ ...filters, page: String(nextPage), page_size: '20' }, message => { if (id === sequence) progress.value = message })
    if (id === sequence) { report.value = result; page.value = nextPage; applied.value = filters }
  } catch (e) { if (id === sequence) error.value = e instanceof Error ? e.message : '报告读取失败，请稍后刷新' }
  finally { if (id === sequence) loading.value = false }
}
function preset(days: number) { end.value = dateText(new Date()); start.value = dateText(new Date(Date.now() - (days-1)*86400000)); void load() }
function cell(value: unknown) {
  let text = value == null ? '待回流' : String(value)
  if (/^[\s]*[=+\-@]/.test(text)) text = `'${text}`
  return `"${text.replaceAll('"', '""')}"`
}
async function exportCsv() {
  if (!report.value || exporting.value || loading.value) return
  exporting.value = true; error.value = ''
  try {
    const head = ['素材ID','文件名','产品','上传人（非销售归属）','工号','标签','提需ID','周期内产出','周期内审核提交','周期内审核通过','周期内推送成功','千川消耗元','千川ROI2归因成交元','千川ROI','ADQ消耗元','ADQ归因订单元','ADQ ROI','视频号内容成交元']
    const rows: unknown[][] = [head]
    // Every export uses the applied filters, never unsaved controls. Read each
    // page afresh; if totals change abort rather than export a silently partial file.
    const first = await api.productionAnalytics({ ...applied.value, page: '1', page_size: '100' })
    if (first.total > 10000) throw new Error('导出超过10000条，请缩短日期或增加筛选')
    const items = [...first.items]
    for (let p = 2; p <= Math.ceil(first.total/100); p++) {
      const next = await api.productionAnalytics({ ...applied.value, page: String(p), page_size: '100' })
      if (next.total !== first.total || next.snapshot_id !== first.snapshot_id) throw new Error('统计期间记录发生变化，请刷新后重新导出')
      items.push(...next.items)
    }
    if (new Set(items.map(a => a.id)).size !== first.total) throw new Error('统计期间排序发生变化，请刷新后重新导出')
    for (const a of items) rows.push([a.id,a.filename,a.product,a.creator,a.creator_number,a.tags.join(' / '),a.tasks.map(t=>t.id).join(' / '),a.produced?'是':'否',a.reviewed?'是':'否',a.passed?'是':'否',a.delivered?'是':'否',a.channels.qianchuan?.spend,a.channels.qianchuan?.gmv,a.channels.qianchuan?.roi,a.channels.adq?.spend,a.channels.adq?.gmv,a.channels.adq?.roi,a.channels.channels?.gmv])
    rows.push([],['数据周期',first.range.start_date,first.range.end_date],['筛选',JSON.stringify(applied.value)],['导出读取时间',first.generated_at],...first.coverage.notes.map(n=>['口径',n]))
    const blob = new Blob(['\ufeff'+rows.map(r=>r.map(cell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'})
    const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href=url; link.download=`WIS投产分析_${first.range.start_date}_${first.range.end_date}.csv`; link.click(); URL.revokeObjectURL(url)
  } catch (e) { error.value = e instanceof Error ? e.message : '导出失败' }
  finally { exporting.value = false }
}
onMounted(() => {readSaved(); void load()})
</script>

<template>
  <section class="production-panel" :aria-busy="loading">
    <header class="production-heading">
      <div><span class="eyebrow">PRODUCTION & PERFORMANCE</span><h2>让每份产出都有回响</h2><p>从素材入库到审核、推送和真实数据回流，查看产能与投放结果。</p></div>
      <div class="actions"><button :disabled="loading || exporting || !report" @click="exportCsv"><Download :size="16" />{{ exporting ? '正在导出' : '导出明细' }}</button><button class="primary" :disabled="loading" @click="load()"><RefreshCw :size="16" />{{ loading ? '读取中…' : '刷新报告' }}</button></div>
    </header>
    <form class="filters" @submit.prevent="load()">
      <label>开始日期<input v-model="start" type="date" required /></label><label>结束日期<input v-model="end" type="date" required /></label>
      <label>回流渠道<select v-model="channel"><option value="all">各渠道独立展示</option><option value="qianchuan">千川</option><option value="adq">腾讯 ADQ</option><option value="channels">视频号</option></select></label>
      <label>分析维度<select v-model="dimension"><option value="product">产品</option><option value="creator">上传人</option><option value="tag">标签</option><option value="task">提需任务</option><option value="channel">回流渠道</option><option value="asset">具体素材</option></select></label>
      <label>产品<input v-model="product" placeholder="输入完整产品分类" /></label><label>上传人工号<input v-model="creator" placeholder="例如 FD-026222" /></label><label>标签<input v-model="tag" placeholder="完整标签，精确匹配" /></label><label>素材名称<input v-model="q" placeholder="搜索文件名" /></label>
      <div class="presets"><button type="button" :disabled="loading" @click="preset(7)">近7天</button><button type="button" :disabled="loading" @click="preset(30)">近30天</button><button type="submit" class="primary" :disabled="loading">应用筛选</button></div>
      <div v-if="userNumber" class="saved-filters"><select v-model="savedId" aria-label="本浏览器已保存筛选" :disabled="loading" @change="useSaved"><option value="">本浏览器已保存筛选</option><option v-for="s in savedFilters" :key="s.id" :value="s.id">{{ s.name }}</option></select><input v-model="savedName" maxlength="40" aria-label="筛选名称" placeholder="例如：黑晶面膜投产追踪" /><button type="button" :disabled="!report || loading || !savedName.trim()" @click="saveFilter">保存报告筛选</button></div>
    </form>
    <div v-if="error" class="error" role="alert">{{ error }}<span v-if="report"> 当前保留上次成功读取的报告，请以报告周期和读取时间为准。</span></div>
    <div v-if="loading" class="empty" role="status">{{ progress }}</div>
    <template v-if="report && summary">
      <div class="report-meta"><span>{{ report.range.start_date }} — {{ report.range.end_date }} · 北京时间</span><span>报告生成于 {{ timeText(report.generated_at) }} · 相同筛选最多复用3分钟</span></div>
      <div class="kpi-grid">
        <article><span>周期内新增产出</span><strong>{{ summary.output.toLocaleString() }}<small>条</small></strong><p>一创 / 源素材 {{ summary.source }} · 二创 {{ summary.remix }}</p></article>
        <article><span>审核提交 → 通过</span><strong>{{ summary.reviewed }}<small>→</small>{{ summary.passed }}</strong><p>按素材去重 · 不等于有效素材数</p></article>
        <article><span>周期内推送成功素材</span><strong>{{ summary.delivered }}<small>条</small></strong><p>共 {{ summary.delivery_tasks }} 个推送任务</p></article>
        <article><span>已有核验回流素材</span><strong>{{ summary.returned }}<small>条</small></strong><p>{{ report.coverage.daily_rows }} 条去重日报 · 含历史素材</p></article>
      </div>
      <div class="channel-grid"><article v-for="[key,c] in channelCards" :key="key" class="channel-card"><div class="card-title"><h3>{{ c.name }}</h3><span>{{ c.assets }} 条回流素材</span></div><div class="money-pair"><div><span>{{ c.gmv_label }}</span><strong>{{ money(c.gmv) }}</strong></div><div><span>平台消耗</span><strong>{{ key === 'channels' ? '不适用' : money(c.spend) }}</strong></div></div><div class="channel-footer"><span>{{ key === 'channels' ? '内容成交口径' : `同口径 ROI ${ratio(c.roi)}` }}</span><span>金额覆盖 {{ c.gmv_rows }}/{{ c.rows }} 条日报</span></div><p>{{ c.source }}</p><small>最近回流 {{ timeText(c.latest_at) }}</small></article></div>
      <div class="charts"><article class="chart-card"><h3>每日产出</h3><p>原文件完成入库时间 · 鼠标停留查看日期与数量</p><div v-if="summary.output" class="bar-chart" role="img" aria-label="所选日期的每日新增素材数量"><div v-for="day in report.daily" :key="day.date" class="bar-column" :title="`${day.date}：${day.output}条`"><span :style="{height:`${day.output/maxOutput*150}px`}"></span><small v-if="report.daily.length <= 10">{{ day.date.slice(5) }}</small></div></div><div v-else class="empty">所选周期没有新增产出；下方仍可查看历史素材的回流。</div></article><article class="chart-card"><h3>产出贡献分布</h3><p>按当前分析维度 · 标签、任务有重叠</p><div v-for="g in report.groups.slice(0,6)" :key="g.key" class="rank-row"><span :title="g.label">{{ g.label }}</span><div><i :style="{width:`${g.output/maxGroup*100}%`}"></i></div><b>{{ g.output }}</b></div><div v-if="!report.groups.length" class="empty">所选条件暂无素材记录</div></article></div>
      <article class="table-card"><div class="card-title"><h3>分组分析</h3><span>{{ report.groups.length }} 组</span></div><div class="table-scroll"><table><thead><tr><th>分组</th><th>涉及素材</th><th>新增产出</th><th>提交 / 通过</th><th>推送成功</th><th>有回流</th><th v-for="[key,c] in channelCards" :key="key">{{ c.name }} · 金额 / 消耗（元）</th></tr></thead><tbody><tr v-for="g in report.groups" :key="g.key"><td>{{ g.label }}</td><td>{{ g.assets }}</td><td>{{ g.output }}</td><td>{{ g.reviewed }} / {{ g.passed }}</td><td>{{ g.delivered }}</td><td>{{ g.returned }}</td><td v-for="[key] in channelCards" :key="key">{{ money(g.channels[key]?.gmv) }} / {{ key === 'channels' ? '不适用' : money(g.channels[key]?.spend) }}</td></tr></tbody></table></div></article>
      <article class="table-card"><div class="card-title"><h3>追溯到具体素材</h3><span>{{ report.total }} 条 · 按已回流消耗排序</span></div><div class="table-scroll"><table><thead><tr><th>素材</th><th>产品 / 上传人</th><th>关联提需</th><th>周期内记录</th><th v-for="[key,c] in channelCards" :key="key">{{ c.name }} · 金额 / ROI</th><th>详情</th></tr></thead><tbody><tr v-for="a in report.items" :key="a.id"><td class="filename">{{ a.filename }}<small>#{{ a.id }} · {{ a.tags.join(' / ') || '无标签' }}</small></td><td>{{ a.product }}<small>{{ a.creator }}</small></td><td>{{ a.tasks.map(t=>t.id).join(' / ') || '未关联' }}</td><td><span>{{ a.produced ? '新增产出' : '历史素材' }}</span><small>{{ a.reviewed ? (a.passed ? '审核通过' : '审核已提交') : '无审核提交' }} · {{ a.delivered ? '推送成功' : '无成功推送' }}</small></td><td v-for="[key] in channelCards" :key="key">{{ money(a.channels[key]?.gmv) }}<small>{{ key === 'channels' ? '内容成交' : `ROI ${ratio(a.channels[key]?.roi)}` }}</small></td><td><button :aria-label="`查看素材 ${a.filename}`" @click="emit('openAsset',a.id)"><ArrowUpRight :size="16" />查看</button></td></tr></tbody></table></div><div v-if="!report.items.length" class="empty">没有匹配素材，请调整日期或筛选条件。</div><div class="pagination"><button :disabled="loading || page<=1" @click="load(page-1,false)">上一页</button><span>{{ page }} / {{ pages }}</span><button :disabled="loading || page>=pages" @click="load(page+1,false)">下一页</button></div></article>
      <details class="definitions"><summary>数据口径与覆盖范围</summary><p v-for="note in report.coverage.notes" :key="note">{{ note }}</p><p>归属冲突日报 {{ report.coverage.ambiguous_rows }} 条、标识不完整日报 {{ report.coverage.invalid_rows }} 条均未计入金额。{{ report.coverage.quality_message }}</p></details>
    </template>
  </section>
</template>

<style scoped>
.production-panel .filters label>input,.production-panel .filters label>select{flex:0 0 42px;height:42px;min-height:42px;max-height:42px;min-width:0;font-size:13px}.production-panel .saved-filters>input,.production-panel .saved-filters>select{height:42px;min-width:0}.production-panel .filters{align-items:start}
.saved-filters{grid-column:1/-1;display:grid;grid-template-columns:1fr 1fr auto;gap:8px;font-size:12px}@media(max-width:650px){.saved-filters{grid-template-columns:1fr}}
.production-panel{color:#16435d;max-width:1600px;margin:auto}.production-heading{display:flex;justify-content:space-between;gap:20px;align-items:center;margin-bottom:24px}.eyebrow{font-size:10px;letter-spacing:2px;color:#1589b5;font-weight:700}h2{font-size:28px;margin:8px 0}h3{margin:0;font-size:16px}p{color:#6b8294;font-size:12px;line-height:1.7;margin:7px 0}.actions,.presets{display:flex;gap:8px;align-items:center}button{display:inline-flex;gap:6px;align-items:center;justify-content:center;border:1px solid #cfdee8;border-radius:8px;padding:9px 13px;background:white;color:#1b5877;cursor:pointer;white-space:nowrap;font-size:12px}button.primary{background:#087faf;color:white;border-color:#087faf}button:disabled{opacity:.5;cursor:default}.filters{background:white;border:1px solid #dce8ef;border-radius:14px;padding:18px;display:grid;grid-template-columns:repeat(4,minmax(140px,1fr));gap:14px}.filters label{font-size:12px;display:flex;flex-direction:column;gap:6px}input,select{background:#fbfdff;border:1px solid #cedfe9;padding:9px;border-radius:7px;color:#17405a;width:100%;box-sizing:border-box;font:inherit}.presets{grid-column:1/-1;justify-content:flex-end}.error{padding:14px;margin-top:15px;background:#fff3e6;color:#a25813;border:1px solid #edc691;border-radius:10px;font-size:13px}.report-meta{display:flex;justify-content:space-between;font-size:11px;color:#70899b;margin:20px 2px 12px}.kpi-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:14px}.kpi-grid article,.channel-card,.chart-card,.table-card{background:white;border:1px solid #dce8ef;border-radius:14px;padding:20px;min-width:0}.kpi-grid article:first-child{background:#eff9fc}.kpi-grid span{font-size:12px;color:#6d8797}.kpi-grid strong{display:block;font-size:30px;font-variant-numeric:tabular-nums;margin-top:12px}.kpi-grid strong small{font-size:12px;margin:0 8px;color:#6c91a7}.channel-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin:16px 0}.card-title{display:flex;justify-content:space-between;gap:12px;align-items:center;margin-bottom:14px}.card-title>span{font-size:11px;color:#718999}.money-pair{display:grid;grid-template-columns:1.6fr 1fr;gap:10px}.money-pair span{font-size:10px;color:#7b8fa0;display:block}.money-pair strong{font-size:22px;display:block;margin:8px 0 16px;font-variant-numeric:tabular-nums}.channel-footer{display:flex;justify-content:space-between;gap:6px;font-size:11px;color:#1d88a6;border-top:1px solid #ebf1f5;padding-top:12px}.channel-card>small{font-size:10px;color:#8093a2}.charts{display:grid;grid-template-columns:1.2fr 1fr;gap:14px;margin:16px 0}.bar-chart{display:flex;align-items:flex-end;gap:4px;height:180px;padding-top:10px}.bar-column{flex:1;display:flex;flex-direction:column;align-items:center;min-width:0}.bar-column>span{width:85%;background:#139abe;border-radius:4px 4px 0 0;min-height:1px}.bar-column small{font-size:9px;color:#7893a5;margin-top:8px}.rank-row{display:grid;grid-template-columns:120px 1fr 36px;gap:12px;align-items:center;margin:17px 0;font-size:12px}.rank-row>span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.rank-row>div{height:7px;background:#eff4f7;border-radius:4px}.rank-row i{display:block;height:7px;background:#68b6c9;border-radius:4px}.rank-row b{text-align:right}.table-card{margin:16px 0}.table-scroll{overflow:auto}table{border-collapse:collapse;width:100%;font-size:12px;white-space:nowrap;text-align:left}th{color:#658094;background:#f4f8fb;font-weight:500}td,th{padding:13px 12px;border-bottom:1px solid #e9f0f4}td small{display:block;font-size:10px;color:#8094a3;margin-top:5px}.filename{max-width:240px;white-space:normal;word-break:break-all}.pagination{display:flex;justify-content:flex-end;align-items:center;gap:16px;margin-top:16px;font-size:12px}.empty{padding:38px 12px;text-align:center;font-size:13px;color:#8196a6}.definitions{font-size:12px;background:#f0f6fa;border:1px solid #dae6ed;border-radius:10px;padding:15px 20px}.definitions summary{cursor:pointer;font-weight:600}.definitions p{font-size:11px}button:focus-visible,input:focus-visible,select:focus-visible{outline:2px solid #0c9fc1;outline-offset:2px}@media(max-width:1100px){.channel-grid{grid-template-columns:1fr}.money-pair{grid-template-columns:1fr 1fr}.filters{grid-template-columns:repeat(2,minmax(120px,1fr))}.kpi-grid{grid-template-columns:repeat(2,1fr)}}@media(max-width:650px){.production-heading{align-items:flex-start;flex-direction:column}.charts{grid-template-columns:1fr}.filters{grid-template-columns:1fr}.report-meta{flex-direction:column;gap:6px}.kpi-grid article{padding:14px}.kpi-grid strong{font-size:24px}h2{font-size:23px}}
</style>
