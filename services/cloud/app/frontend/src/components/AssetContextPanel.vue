<script setup lang="ts">
import { ref, watch } from 'vue'
import { api } from '../api'
import type { AssetContext } from '../asset-context-types'
const props = defineProps<{ assetId: number; etag: string; currentTimeMs: number; playable: boolean }>()
const emit = defineEmits<{ seek: [seconds: number] }>()
const state = ref<AssetContext | null>(null), loading = ref(false), error = ref(''), saving = ref(false), text = ref('')
let epoch = 0
let pending: { id: string; text: string; time: number; revision: number; etag: string } | null = null
const clock = (milliseconds: number) => `${Math.floor(milliseconds/60000).toString().padStart(2,'0')}:${Math.floor(milliseconds/1000%60).toString().padStart(2,'0')}`
const status = (value: string) => ({ approved:'已通过',passed:'已通过',pending:'待处理',rejected:'已驳回',success:'成功',published:'已发布',failed:'失败',processing:'处理中',completed:'已完成' }[value] || value)
async function load() {
  const id = ++epoch; loading.value = true; error.value = ''
  try { const value = await api.assetContext(props.assetId); if (id===epoch) state.value=value }
  catch (e) { if(id===epoch) error.value=e instanceof Error ? e.message : '关联记录读取失败' }
  finally { if(id===epoch) loading.value=false }
}
watch(() => props.assetId, () => { state.value=null; text.value=''; pending=null; saving.value=false; void load() }, {immediate:true})
async function save() {
  if (!state.value || saving.value || !text.value.trim()) return
  saving.value=true; error.value=''; const assetId=props.assetId; const token=epoch
  if (!pending || pending.text !== text.value.trim()) pending={id:crypto.randomUUID(),text:text.value.trim(),time:Math.round(props.currentTimeMs),revision:state.value.notes.revision,etag:props.etag}
  try {
    const notes=await api.assetTimecodeNote(assetId,{client_request_id:pending.id,expected_revision:pending.revision,time_ms:pending.time,expected_etag:pending.etag,text:pending.text})
    if(token===epoch && state.value) { state.value.notes=notes; text.value=''; pending=null }
  } catch(e) { if(token===epoch) error.value=e instanceof Error ? e.message : '保存失败，输入已保留' }
  finally { if(token===epoch) saving.value=false }
}
async function refresh() { pending=null; await load() }
</script>
<template>
  <section class="context-card">
    <div class="context-heading"><h3>素材关联与时间点备注</h3><button :disabled="loading || saving" @click="refresh">刷新记录</button></div>
    <p v-if="loading" role="status">正在读取关联记录…</p><p v-if="error" class="context-error" role="alert">{{ error }}</p>
    <template v-if="state">
      <p>{{ state.history_note }}</p>
      <div class="trace-grid"><details><summary>审核版本 · {{ state.reviews.length }}</summary><p v-for="r in state.reviews" :key="r.id">审核 v{{ r.version }} · {{ status(r.status) }}<small>{{ r.filename || '无名称快照' }}</small></p><p v-if="!state.reviews.length">暂无审核记录</p></details><details><summary>提需交付 · {{ state.task_versions.length }}</summary><p v-for="r in state.task_versions" :key="`${r.task_id}-${r.version}`">{{ r.task_id }}<small>交付 v{{ r.version }}</small></p><p v-if="!state.task_versions.length">尚未关联提需交付</p></details><details><summary>推送记录 · {{ state.pushes.length }}</summary><p v-for="r in state.pushes" :key="r.id">{{ r.channel }} · {{ status(r.status) }}<small>{{ r.id }}</small></p><p v-if="!state.pushes.length">暂无推送记录</p></details><details><summary>二创回传 · {{ state.returns.length }}</summary><p v-for="(r,i) in state.returns" :key="i">{{ r.workstation_type || '工作台' }} · {{ status(r.status) }}<small>任务 {{ r.remix_task_id || '未记录' }}</small></p><p v-if="!state.returns.length">暂无工作台回传记录</p></details></div>
      <div class="notes"><div v-for="n in state.notes.items" :key="n.id" class="note"><button :disabled="!playable || !n.etag || n.etag!==etag" @click="emit('seek',n.time_ms/1000)">{{ clock(n.time_ms) }}</button><div>{{ n.text }}<small>{{ n.actor_name }} · {{ n.etag && n.etag===etag ? '当前文件' : '文件版本待核对，不能直接定位' }}</small></div></div><p v-if="!state.notes.items.length">暂无时间点备注</p></div>
      <form v-if="state.can_annotate && playable" @submit.prevent="save"><label>当前播放位置 {{ clock(currentTimeMs) }}<textarea v-model="text" maxlength="500" :disabled="saving" placeholder="记录这一时间点的问题或修改建议；不会通知其他人，也不会修改审核结论" /></label><button :disabled="saving || !text.trim()">{{ saving ? '保存中…' : '保存时间点备注' }}</button></form>
      <p v-else-if="!state.can_annotate">可查看历史记录；添加备注沿用当前素材管理权限。</p>
    </template>
  </section>
</template>
<style scoped>
.context-card{margin:18px 0;padding:18px;border:1px solid #d6e6ee;border-radius:12px;background:#fbfdff;color:#234c65;font-size:12px}.context-heading{display:flex;align-items:center;justify-content:space-between;gap:12px}h3{margin:0;font-size:15px}p{font-size:11px;color:#7890a1;line-height:1.6}button{padding:7px 10px;border:1px solid #cadfe9;border-radius:7px;background:white;color:#13789e;font-size:11px;cursor:pointer}button:disabled{opacity:.5;cursor:default}.trace-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}.trace-grid details{padding:10px;border:1px solid #e2edf3;border-radius:8px;background:white}.trace-grid summary{cursor:pointer}.trace-grid small,.note small{display:block;color:#8395a5;font-size:10px;margin-top:5px;overflow-wrap:anywhere}.notes{margin:12px 0}.note{display:flex;gap:10px;padding:10px 0;border-bottom:1px solid #e6edf1}.note button{align-self:flex-start;font-variant-numeric:tabular-nums}.note>div{white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.6}form label{display:flex;flex-direction:column;gap:7px}textarea{width:100%;box-sizing:border-box;padding:10px;border:1px solid #cee1eb;border-radius:8px;min-height:70px;font:inherit;background:white;color:#244d67}form>button{margin-top:10px}.context-error{color:#ae5a1c;background:#fff2e5;padding:10px;border-radius:7px}@media(max-width:600px){.trace-grid{grid-template-columns:1fr}}
</style>
