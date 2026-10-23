import {fault} from './anchor-status-policy.mjs';

// Preserve the original bytes. Feishu rejects full downloads of some large files.
export async function downloadRecordingResource(url,token,{fetchImpl=fetch,signal,maxBytes=160*1024*1024,chunkBytes=4*1024*1024}={}){
  const request=range=>fetchImpl(url,{headers:{Authorization:'Bearer '+token,...(range?{Range:range}:{})},redirect:'manual',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(180000)]):AbortSignal.timeout(180000)});
  const response=await request();
  if(response.ok){if(response.status!==200){await response.body?.cancel();throw fault('录屏下载返回了不完整文件，请重试。','download_error',502);}return response;}
  let code;try{code=(await response.json()).code;}catch{}
  if(code!==234037)throw fault('录屏下载失败，将重试。','download_error',502);
  const probe=await request('bytes=0-0');
  const match=probe.headers.get('content-range')?.match(/^bytes 0-0\/(\d+)$/u);
  const total=match?Number(match[1]):0;
  await probe.body?.cancel();
  if(probe.status!==206||!Number.isSafeInteger(total)||total<1)throw fault('无法核验录屏文件大小，请重试。','download_error',502);
  if(total>maxBytes)throw fault('录屏超过160MB处理上限，转人工。','media_quality',422);
  let offset=0,cancelled=false;
  const stream=new ReadableStream({
    async pull(controller){
      if(cancelled)return;
      try{
        signal?.throwIfAborted();
        const start=offset,end=Math.min(total-1,start+chunkBytes-1);
        const part=await request(`bytes=${start}-${end}`);
        if(part.status!==206||part.headers.get('content-range')!==`bytes ${start}-${end}/${total}`){await part.body?.cancel();throw fault('录屏分段范围不完整，请重试。','download_error',502);}
        // Bound memory even if an upstream server sends more than the advertised range.
        const reader=part.body.getReader(),chunks=[];let length=0;
        try{while(true){const next=await reader.read();if(next.done)break;length+=next.value.byteLength;if(length>end-start+1)throw fault('录屏分段大小异常，请重试。','download_error',502);chunks.push(next.value);}}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
        if(length!==end-start+1)throw fault('录屏分段被截断，请重试。','download_error',502);
        if(cancelled)return;
        for(const chunk of chunks)controller.enqueue(chunk);
        offset=end+1;if(offset===total)controller.close();
      }catch(error){if(!cancelled)controller.error(error);}
    },
    cancel(){cancelled=true;},
  },{highWaterMark:0});
  return new Response(stream,{status:200,headers:{'content-type':probe.headers.get('content-type')||'application/octet-stream','content-length':String(total)}});
}
