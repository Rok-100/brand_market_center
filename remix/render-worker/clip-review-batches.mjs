import {createManualOperations} from './manual-operations.mjs';
import {canReadClip, clipIsBlocked} from './asset-access.mjs';

const binding = c => JSON.stringify(['storedName','contentSha256','sourceId','startSeconds','endSeconds','reviewStatus','reviewedAt','reviewNote','deliveryBlocked','productCategory','visibility','createdByIds'].map(k=>c?.[k] ?? null));
const message = e => String(e?.message || '审核未完成').slice(0,250);

// A dedicated lane: review work never waits behind video generation. Media
// integrity is checked outside the library write lock, with bounded concurrency.
export function createClipReviewBatches({directory,readLibrary,updateLibrary,verify,apply,publicClip}) {
  const requests = new Map();
  const queue = createManualOperations({directory,concurrency:1,execute:async(_type,payload,identity,progress)=>{
    const prepared=[],results=[];
    let cursor=0,done=0;
    await progress(`正在核验 0/${payload.ids.length} 条；完成后集中保存`);
    await Promise.all(Array.from({length:Math.min(3,payload.ids.length)},async()=>{
      while(cursor<payload.ids.length){
        const id=payload.ids[cursor++];
        try {
          const lib=await readLibrary();
          const clip=lib.clips.find(c=>c.id===id),source=lib.sources.find(s=>s.id===clip?.sourceId);
          if(!canReadClip(clip,source,identity))throw Error('切片不存在或无权审核');
          // Recover a committed batch after a crash, but never override a later review.
          if(clip.reviewBatchKey===payload.requestKey && clip.reviewStatus===payload.reviewStatus){results.push({id,ok:true});continue;}
          if(binding(clip)!==payload.expected[id])throw Error('切片已被修改，请刷新后重新审核');
          const prior=structuredClone(clip);
          if(payload.reviewStatus==='approved'){
            if(clipIsBlocked(prior))throw Error('已禁用切片不能直接通过');
            await verify(prior,structuredClone(source),identity);
          }
          prepared.push(prior);
        }catch(e){results.push({id,ok:false,message:message(e)});}
        finally {done++;if(done%3===0||done===payload.ids.length)await progress(`已核验 ${done}/${payload.ids.length} 条；正在保存审核结果`);}
      }
    }));
    if(prepared.length)await updateLibrary(lib=>{
      for(const prior of prepared){
        const clip=lib.clips.find(c=>c.id===prior.id),source=lib.sources.find(s=>s.id===clip?.sourceId);
        if(!canReadClip(clip,source,identity)||binding(clip)!==binding(prior)||(payload.reviewStatus==='approved'&&clipIsBlocked(clip))){
          results.push({id:prior.id,ok:false,message:'核验期间切片或权限已变化，请刷新后重试'});continue;
        }
        apply(lib,clip,payload,identity);
        clip.reviewBatchKey=payload.requestKey;
        results.push({id:clip.id,ok:true});
      }
    });
    return {total:payload.ids.length,succeeded:results.filter(r=>r.ok).length,results};
  }});
  const publicJob = async(job,identity)=>{
    if(!job?.result)return job;
    const lib=await readLibrary();
    return {...job,result:{...job.result,results:job.result.results.map(r=>{
      const clip=lib.clips.find(c=>c.id===r.id),source=lib.sources.find(s=>s.id===clip?.sourceId);
      if(!canReadClip(clip,source,identity))return {id:r.id,ok:false,message:'切片不存在或已无访问权限'};
      return {...r,clip:publicClip(clip,identity,lib)};
    })}};
  };
  return {
    initialize:()=>queue.initialize(),
    pending:()=>queue.pendingCount(),
    async list(identity){return Promise.all(queue.list(identity).map(j=>publicJob(j,identity)));},
    async get(id,identity){return publicJob(queue.get(id,identity),identity);},
    async submit(input,identity){
      if(!Array.isArray(input.ids)||input.ids.length<1||input.ids.length>500||input.ids.some(id=>typeof id!=='string'||!id||id.length>160))throw Error('每批请选择 1—500 条切片');
      if(!['approved','changes_requested'].includes(input.reviewStatus))throw Error('审核状态无效');
      if(typeof input.requestKey!=='string'||!/^[a-zA-Z0-9-]{16,80}$/.test(input.requestKey))throw Error('审核请求标识无效');
      const ids=[...new Set(input.ids)].sort();
      const normalized={ids,reviewStatus:input.reviewStatus,reviewNote:String(input.reviewNote||'本人批量审核').slice(0,500),requestKey:input.requestKey};
      const key=identity.id+':'+input.requestKey;
      if(requests.has(key)){const prior=await requests.get(key);return this.submit(input,identity);}
      const existing=queue.findByRequestKey('clip-review',input.requestKey,identity);
      if(existing){if(existing.fingerprint!==JSON.stringify(normalized))throw Error('同一审核请求不能更改选片或结论');return publicJob(existing.job,identity);}
      const operation=(async()=>{
        const lib=await readLibrary(),expected={};
        for(const id of ids){const c=lib.clips.find(c=>c.id===id);expected[id]=canReadClip(c,lib.sources.find(s=>s.id===c?.sourceId),identity)?binding(c):null;}
        return queue.submit('clip-review',{...normalized,expected,requestFingerprint:JSON.stringify(normalized)},identity);
      })();
      requests.set(key,operation);
      try{return await operation;}finally{requests.delete(key);}
    },
  };
}
