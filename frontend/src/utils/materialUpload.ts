import { createMD5, createSHA256 } from 'hash-wasm'
import { request, ApiError } from '../api'
import { uploadFileMultipart } from './multipartUpload'
import type { MultipartUploadSession, MultipartUploadedPart } from '../types'

type Meta = Parameters<typeof uploadFileMultipart>[1] & { libraryType?: 'source' | 'remix' }
type Callbacks = NonNullable<Parameters<typeof uploadFileMultipart>[2]>
const active = (signal?: AbortSignal) => { if (signal?.aborted) throw new DOMException('上传已暂停', 'AbortError') }
const retryable = (error: unknown): error is ApiError => error instanceof ApiError
  && [0, 408, 425, 429, 500, 502, 503, 504].includes(error.status)
const RETRY_DELAYS = [1000, 2000, 4000, 8000, 10000, 10000]
const wait = (milliseconds: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  active(signal)
  const abort = () => { window.clearTimeout(timer); reject(new DOMException('上传已暂停', 'AbortError')) }
  const timer = window.setTimeout(() => { signal?.removeEventListener('abort', abort); resolve() }, milliseconds)
  signal?.addEventListener('abort', abort, { once: true })
})

const verifySession = (session: MultipartUploadSession, file: File) => {
  if (!session?.session_id || !session.object_key || session.file_size !== file.size
    || !Number.isSafeInteger(session.part_size) || session.part_size <= 0
    || session.total_parts !== Math.ceil(file.size / session.part_size)
    || !Array.isArray(session.uploaded_parts)) throw new ApiError('上传会话信息不完整，请保留原文件后重试', 502)
  return session
}

export const uploadMaterialFileMultipart = async (
  file: File, meta: Meta, callbacks: Callbacks = {}, signal?: AbortSignal,
  options: Parameters<typeof uploadFileMultipart>[4] = {},
): Promise<MultipartUploadSession> => {
  if (meta.assetScope === 'product_image') return uploadFileMultipart(file, meta, callbacks, signal, options)
  const kind = meta.assetScope === 'reference_video' ? 'source' : meta.libraryType || 'source'
  const base = `api/${kind}-library/uploads`
  callbacks.onStage?.('正在校验原文件，核对已有上传')
  const sha = await createSHA256()
  sha.init()
  for (let offset = 0; offset < file.size; offset += 8 * 1024 * 1024) {
    active(signal)
    sha.update(new Uint8Array(await file.slice(offset, offset + 8 * 1024 * 1024).arrayBuffer()))
    callbacks.onProgress?.(Math.min(5, Math.round((offset + 1) / file.size * 5)))
  }
  const digest = sha.digest('hex')
  const payload = {filename:file.name, content_type:file.type || 'video/mp4', size:file.size,
    sha256:digest, category:meta.category, asset_scope:meta.assetScope}
  const lookup = (lookupSignal?: AbortSignal) => request<{session:MultipartUploadSession|null}>(`${base}/lookup`,
    {method:'POST',body:JSON.stringify(payload),signal:lookupSignal}, {timeoutMs:15000,attempts:3,redirectOnLogin:false})
  const cancelCreated = async (created: MultipartUploadSession) => {
    if (created.status !== 'active') { callbacks.onSession?.(created); return }
    try {
      const cancelled = await request<{status:string}>(`${base}/sessions/${encodeURIComponent(created.session_id)}`,
        {method:'DELETE'}, {timeoutMs:15000,attempts:3,redirectOnLogin:false})
      callbacks.onSession?.({...created,status:cancelled.status})
    } catch {
      // Publish the known session so the UI can tell the user cleanup is pending.
      callbacks.onSession?.(created)
    }
  }
  let session: MultipartUploadSession
  try {
    const found = await lookup(signal)
    if (!found || !Object.prototype.hasOwnProperty.call(found, 'session')) throw new ApiError('上传查询结果不完整，请稍后重试', 502)
    active(signal)
    // Let a dispatched create request settle even when paused/cancelled: its
    // returned ID is needed to retain progress or cancel the server session.
    // Do not blindly repeat a create whose result is unknown.
    session = found.session || await request<MultipartUploadSession>(`${base}/sessions`,
      {method:'POST',body:JSON.stringify(payload)}, {timeoutMs:30000,attempts:1,redirectOnLogin:false})
  } catch (error) {
    if (signal?.aborted && signal.reason === 'cancel-upload') {
      const recovered = await lookup().catch(() => null)
      if (recovered?.session) await cancelCreated(recovered.session)
    }
    active(signal)
    throw error
  }
  verifySession(session, file)
  if (signal?.aborted && signal.reason === 'cancel-upload') {
    await cancelCreated(session)
    active(signal)
  }
  callbacks.onSession?.(session)
  active(signal)
  const path = `${base}/sessions/${encodeURIComponent(session.session_id)}`
  if (session.status === 'completed') { callbacks.onProgress?.(100); return session }
  if (session.status !== 'active') throw new ApiError('上传会话已结束，请重新选择原文件', 409)
  const receipts: MultipartUploadedPart[] = [...session.uploaded_parts]
  let completedBytes = receipts.reduce((sum,item)=>sum+item.size,0)
  const started = performance.now()
  let retries = 0
  const recover = async () => {
    const recovered = verifySession(await request<MultipartUploadSession>(path, {signal},
      {timeoutMs:15000,attempts:1,redirectOnLogin:false}), file)
    if (recovered.session_id !== session.session_id || recovered.object_key !== session.object_key
      || recovered.part_size !== session.part_size) throw new ApiError('原上传会话与当前文件不一致', 409)
    session = recovered
    callbacks.onSession?.(session)
    return session
  }
  const recoveredAfterFailure = async () => {
    try { return await recover() }
    catch (error) { active(signal); if (!retryable(error)) throw error; return null }
  }
  for (let number = 1; number <= session.total_parts; number++) {
    active(signal)
    if (receipts.some(item=>item.part_number===number)) continue
    const part = file.slice((number-1)*session.part_size,number*session.part_size)
    const md5 = await createMD5()
    md5.init(); md5.update(new Uint8Array(await part.arrayBuffer()))
    const checksum = md5.digest('hex')
    callbacks.onStage?.(`正在上传分片 ${number}/${session.total_parts}`)
    for (let attempt=0; ; attempt++) {
      try {
        const receipt = await sendPart(`${path}/parts/${number}`,part,checksum,signal,loaded=>{
          const bytes=completedBytes+loaded, seconds=Math.max(.1,(performance.now()-started)/1000)
          const speed=bytes/seconds
          callbacks.onProgress?.(5+Math.round(bytes/file.size*85))
          callbacks.onTransfer?.({loadedBytes:bytes,totalBytes:file.size,speedBps:speed,
            etaSeconds:speed>0?Math.ceil((file.size-bytes)/speed):null,retries})
        })
        if (receipt.part_number !== number || receipt.size !== part.size || !receipt.etag) throw new ApiError('分片回执不完整，正在核对服务器进度', 502)
        receipts.push(receipt)
        completedBytes += receipt.size
        break
      } catch (error) {
        active(signal)
        if (!retryable(error)) throw error
        callbacks.onStage?.(`正在核对第 ${number}/${session.total_parts} 个分片的保存结果`)
        const recovered = await recoveredAfterFailure()
        if (recovered?.status === 'completed') { callbacks.onProgress?.(100); return recovered }
        if (recovered && recovered.status !== 'active') throw new ApiError('上传会话已结束，请重新选择原文件', 409)
        const saved = recovered?.uploaded_parts.find(item => item.part_number === number)
        if (saved?.etag && saved.size === part.size) {
          receipts.push(saved)
          completedBytes += saved.size
          break
        }
        if (attempt >= RETRY_DELAYS.length) throw error
        retries++
        callbacks.onStage?.(`连接暂时中断，${RETRY_DELAYS[attempt] / 1000} 秒后恢复第 ${number}/${session.total_parts} 个分片`)
        await wait(RETRY_DELAYS[attempt] + Math.floor(Math.random() * 200), signal)
      }
    }
  }
  active(signal)
  callbacks.onStage?.('正在合并原文件')
  receipts.sort((a,b)=>a.part_number-b.part_number)
  for (let attempt = 0; ; attempt++) {
    active(signal)
    try {
      session = verifySession(await request<MultipartUploadSession>(`${path}/complete`,
        {method:'POST',body:JSON.stringify({parts:receipts,sha256:digest}),signal},
        {timeoutMs:60000,attempts:1,redirectOnLogin:false}), file)
      if (session.status !== 'completed') throw new ApiError('文件合并结果暂未确认', 503)
      break
    } catch (error) {
      active(signal)
      if (!retryable(error)) throw error
      callbacks.onStage?.('正在核对文件合并结果，请保留当前页面')
      const recovered = await recoveredAfterFailure()
      if (recovered?.status === 'completed') break
      if (recovered && recovered.status !== 'active') throw new ApiError('上传会话已结束，请重新选择原文件', 409)
      if (attempt >= RETRY_DELAYS.length) throw error
      await wait(RETRY_DELAYS[attempt] + Math.floor(Math.random() * 200), signal)
    }
  }
  callbacks.onSession?.(session)
  callbacks.onProgress?.(100)
  return session
}

const sendPart = (url:string, body:Blob, md5:string, signal:AbortSignal|undefined,
  progress:(bytes:number)=>void) => new Promise<MultipartUploadedPart>((resolve,reject)=>{
  active(signal)
  const xhr=new XMLHttpRequest()
  const abort=()=>xhr.abort()
  const finish=()=>signal?.removeEventListener('abort',abort)
  xhr.open('PUT',url);xhr.timeout=90000;xhr.setRequestHeader('X-Upload-Part-Md5',md5)
  xhr.upload.onprogress=event=>progress(event.loaded)
  xhr.onerror=()=>{finish();reject(new ApiError('分片传输中断，原上传进度已保留',0))}
  xhr.ontimeout=()=>{finish();reject(new ApiError('分片传输超时，原上传进度已保留',408))}
  xhr.onabort=()=>{finish();reject(new DOMException('上传已暂停','AbortError'))}
  xhr.onload=()=>{
    finish()
    let data: {detail?:unknown;part_number?:number;size?:number;etag?:string}|null=null
    try { data=JSON.parse(xhr.responseText) } catch { /* Error responses may be HTML from a proxy. */ }
    if(xhr.status<200||xhr.status>=300){
      const fallback:Record<number,string>={401:'登录已失效，请重新登录后恢复上传',403:'没有分片上传权限，请核对账号和存储权限',413:'分片超过网关接收限制',429:'上传服务繁忙，请稍后恢复'}
      reject(new ApiError(typeof data?.detail==='string'?data.detail:fallback[xhr.status]||`分片上传失败（HTTP ${xhr.status}）`,xhr.status));return
    }
    if(!data||!Number.isSafeInteger(data.part_number)||!Number.isSafeInteger(data.size)||typeof data.etag!=='string'||!data.etag){
      reject(new ApiError('分片回执格式不正确，正在核对服务器进度',502));return
    }
    resolve(data as MultipartUploadedPart)
  }
  signal?.addEventListener('abort',abort,{once:true})
  if(signal?.aborted){finish();reject(new DOMException('上传已暂停','AbortError'));return}
  xhr.send(body)
})
