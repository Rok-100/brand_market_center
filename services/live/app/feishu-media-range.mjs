// Feishu rejects browser-style open-ended ranges. Resolve the file size using
// one byte, then forward bounded chunks while preserving Content-Range.
export function createFeishuMediaFetcher({fetchImpl=fetch,clock=Date.now}={}){
 const sizes=new Map();
 return async function media(url,token,range){
  const headers={Authorization:`Bearer ${token}`};
  if(range){
   const m=String(range).match(/^bytes=(\d*)-(\d*)$/u);
   if(!m||(!m[1]&&!m[2]))throw Object.assign(new Error('录屏分段请求无效。'),{status:416});
   if(!m[1]||!m[2]){
    let entry=sizes.get(url),total=entry&&entry.expires>clock()?entry.total:0;
    if(!total){
     const probe=await fetchImpl(url,{headers:{...headers,Range:'bytes=0-0'},signal:AbortSignal.timeout(30000)});
     const found=probe.headers.get('content-range')?.match(/^bytes 0-0\/(\d+)$/u);
     total=found?Number(found[1]):0;await probe.body?.cancel();
     if(!probe.ok||!Number.isSafeInteger(total)||total<1)throw Object.assign(new Error('无法读取录屏文件大小，请稍后重试。'),{status:502});
     if(sizes.size>512)sizes.clear();sizes.set(url,{total,expires:clock()+300000});
    }
    const start=m[1]?Number(m[1]):Math.max(0,total-Number(m[2]));
    if(!Number.isSafeInteger(start)||start>=total)throw Object.assign(new Error('录屏请求超出文件范围。'),{status:416});
    const end=m[1]?Math.min(total-1,start+4*1024*1024-1):total-1;
    headers.Range=`bytes=${start}-${end}`;
   }else headers.Range=range;
  }
  return fetchImpl(url,{headers,signal:AbortSignal.timeout(180000)});
 };
}
