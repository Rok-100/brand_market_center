<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { LoaderCircle, QrCode } from 'lucide-vue-next'
import { api } from '../api'
import type { ChannelsAuthSession } from '../types'
import { isAuthorizationTerminal, normalizeAuthorizationSession } from '../utils/channelsAuthorization'

const emit = defineEmits<{ authorized: [accountId: string]; active: [value: boolean] }>()
const session = ref<ChannelsAuthSession | null>(null)
const starting = ref(false)
const interacting = ref(false)
const error = ref('')
const image = ref('')
const imageError = ref(false)
const remaining = ref(0)
const active = computed(() => starting.value || !!session.value && !isAuthorizationTerminal(session.value.status))
let timer = 0
let disposed = false
let generation = 0
let failures = 0
let revision = -1

const paint = (current: ChannelsAuthSession, force = false) => {
  if (!current.qr_ready || (!force && revision === current.capture_revision && !imageError.value)) return
  const url = api.channelsQrUrl(current.id, current.capture_revision) + (force ? `&reload=${Date.now()}` : '')
  const preload = new Image()
  preload.onload = () => {
    if (disposed || session.value?.id !== current.id || isAuthorizationTerminal(session.value.status) || current.capture_revision < session.value.capture_revision) return
    image.value = url; revision = current.capture_revision; imageError.value = false
  }
  preload.onerror = () => { if (!disposed && session.value?.id === current.id) imageError.value = true }
  preload.src = url
}
const poll = async (id: string, run: number) => {
  try {
    const current = normalizeAuthorizationSession(await api.channelsAuthSession(id))
    if (disposed || generation !== run) return
    session.value = current
    failures = 0; error.value = ''
    remaining.value = current.expires_at ? Math.max(0, Math.ceil((Date.parse(current.expires_at) - Date.now()) / 1000)) : 0
    if (isAuthorizationTerminal(current.status)) {
      image.value = ''; emit('active', false)
      if (current.status === 'authorized') emit('authorized', current.account_id)
      return
    }
    paint(current)
  } catch (e) {
    if (disposed || generation !== run) return
    failures += 1
    error.value = e instanceof Error ? e.message : '暂时无法读取授权状态'
    // A read timeout does not end the scan or create another browser session.
  }
  if (!disposed && generation === run) timer = window.setTimeout(() => void poll(id, run), Math.min(6000, 1200 * Math.max(1, failures)))
}
const start = async () => {
  if (active.value) return
  const run = ++generation
  window.clearTimeout(timer)
  starting.value = true; error.value = ''; image.value = ''; imageError.value = false; revision = -1
  emit('active', true)
  try {
    const current = await api.channelsAuthStart()
    if (disposed || run !== generation) { await api.channelsAuthCancel(current.id); return }
    session.value = normalizeAuthorizationSession(current)
    await poll(current.id, run)
  } catch (e) {
    if (!disposed) error.value = e instanceof Error ? e.message : '无法发起视频号授权'
    emit('active', false)
  } finally { starting.value = false }
}
const cancel = async () => {
  const current = session.value
  if (!current || isAuthorizationTerminal(current.status)) return
  try {
    const result = await api.channelsAuthCancel(current.id)
    generation += 1; window.clearTimeout(timer)
    session.value = normalizeAuthorizationSession(result); image.value = ''; error.value = ''; emit('active', false)
    if (result.status === 'authorized') emit('authorized', result.account_id)
  } catch (e) { error.value = e instanceof Error ? e.message : '取消未完成，请重试' }
}
const interact = async (action: 'click' | 'scroll' | 'select', x = 0.5, y = 0.5, delta = 0, choice = '') => {
  const current = session.value
  if (!current || !active.value || interacting.value) return
  const run = generation
  interacting.value = true
  try {
    const result = await api.channelsAuthInteract(current.id, x, y, action, delta, choice)
    if (disposed || generation !== run || isAuthorizationTerminal(session.value?.status || '')) return
    session.value = normalizeAuthorizationSession(result); paint(result)
  } catch (e) { if (!disposed && generation === run) error.value = e instanceof Error ? e.message : '账号选择未完成，请重试' }
  finally { interacting.value = false }
}
const screenshotAction = (event: MouseEvent | WheelEvent) => {
  const element = event.currentTarget as HTMLImageElement
  const rect = element.getBoundingClientRect()
  const scale = Math.min(rect.width / element.naturalWidth, rect.height / element.naturalHeight)
  const width = element.naturalWidth * scale, height = element.naturalHeight * scale
  const x = (event.clientX - rect.left - (rect.width - width) / 2) / width
  const y = (event.clientY - rect.top - (rect.height - height) / 2) / height
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) return
  void interact(event instanceof WheelEvent ? 'scroll' : 'click', x, y, event instanceof WheelEvent ? (event.deltaY >= 0 ? 720 : -720) : 0)
}
onBeforeUnmount(() => {
  disposed = true; generation += 1; window.clearTimeout(timer)
  const current = session.value
  if (current && !isAuthorizationTerminal(current.status)) void api.channelsAuthCancel(current.id).catch(() => {})
})
</script>

<template>
  <section class="channels-inline-auth">
    <div class="inline-auth-actions">
      <button type="button" class="secondary-button" :disabled="active" @click="start"><LoaderCircle v-if="active" class="spin" :size="16" /><QrCode v-else :size="16" />{{ active ? '正在扫码授权…' : '扫码授权视频号' }}</button>
      <button v-if="active && !starting" type="button" class="secondary-button" @click="cancel">取消扫码</button>
    </div>
    <p v-if="session" role="status">{{ session.message }}<small v-if="active && session.status === 'waiting_scan' && remaining"> · 本次二维码剩余 {{ remaining }} 秒</small></p>
    <template v-if="active && session">
      <div v-if="session.capture_mode === 'account_list'" class="inline-auth-choices">
        <button v-for="choice in session.account_choices" :key="choice.choice_id" type="button" class="secondary-button" :disabled="interacting" @click="interact('select', 0.5, 0.5, 0, choice.choice_id)">{{ choice.label }}<small>{{ choice.detail }}</small></button>
      </div>
      <img v-else-if="image && session.capture_mode === 'account_choice'" class="inline-auth-screen" :src="image" alt="选择要登录的视频号" @click="screenshotAction" @wheel.prevent="screenshotAction" />
      <img v-else-if="image && session.status === 'waiting_scan'" class="inline-auth-qr" :src="image" alt="视频号登录二维码" />
      <button v-if="session.qr_ready" type="button" class="secondary-button" @click="paint(session, true)">重新加载图片</button>
      <small v-if="imageError">授权图片未加载，请重新加载图片。</small>
      <small>手机确认后，如出现账号列表，请选择本次发布的视频号。已填写的内容会保留。</small>
    </template>
    <p v-if="error" class="upload-error" role="alert">{{ error }}<button v-if="!active" type="button" class="secondary-button" @click="start">重试扫码</button></p>
  </section>
</template>

<style scoped>
.channels-inline-auth{margin:12px 0;padding:12px;border:1px solid #cbdde7;border-radius:10px}
.inline-auth-actions{display:flex;flex-wrap:wrap;gap:8px}.channels-inline-auth p{white-space:pre-wrap;line-height:1.6}.channels-inline-auth small{display:block;line-height:1.6;color:#526a7a}
.inline-auth-qr{display:block;width:280px;max-width:100%;height:auto;margin:12px auto}.inline-auth-screen{display:block;width:100%;max-height:560px;object-fit:contain;cursor:pointer}
.inline-auth-choices{display:grid;gap:8px;max-height:320px;overflow:auto}.inline-auth-choices button{white-space:normal;display:block;text-align:left}
</style>
