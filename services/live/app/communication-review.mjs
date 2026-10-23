import {createHash} from 'node:crypto';
import {mkdir,readFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {writeDurableJsonAtomic} from './durable-journal.mjs';

const fail=(message,status=400)=>Object.assign(new Error(message),{status,details:'communication_review_error'});
export function reviewActor(auth){
  const number=String(auth?.user?.number||''),name=String(auth?.user?.realName||auth?.user?.name||'');
  if(!auth?.ok||auth.mode!=='central'||auth.degraded||! /^[A-Z]{2}-\d{3,8}$/u.test(number)||!name)throw fail('请使用有效 OA 登录后操作审核。',401);
  return {number,name};
}
const additionalReviewers=[{number:'FD-223714',name:'叶森莹',openId:'ou_89eb66a94b8dc2cfaabba5364fa139c8',department:'AI效率流程D中心'}];
export function createReviewerDirectory({get,departmentId,additionalPeople=additionalReviewers}){
  let cache,expires=0,loading;
  async function load(fresh=false){
    if(!fresh&&cache&&expires>Date.now())return cache;
    if(loading)return loading;
    loading=(async()=>{
      const rows=[];let token='';const seen=new Set();
      do{
        const params=new URLSearchParams({department_id:departmentId,department_id_type:'open_department_id',user_id_type:'open_id',page_size:'50',...(token?{page_token:token}:{})});
        const data=await get('/contact/v3/users/find_by_department?'+params);
        for(const u of data.items||[]){
          if(u.status?.is_activated!==true||u.status.is_exited!==false||u.status.is_resigned!==false||u.status.is_frozen!==false)continue;
          if(!/^[A-Z]{2}-\d{3,8}$/u.test(u.employee_no||'')||!/^ou_[A-Za-z0-9]+$/u.test(u.open_id||'')||!u.name)continue;
          rows.push({number:u.employee_no,name:u.name,department:'直播中心',openId:u.open_id});
        }
        if(!data.has_more)break;
        token=data.page_token;if(!token||seen.has(token)||seen.size>=50)throw fail('人员目录分页异常，请稍后重试。',503);seen.add(token);
      }while(token);
      // Named cross-department reviewers still require a live, exact identity match.
      for(const person of additionalPeople){
        const {user:u}=await get('/contact/v3/users/'+encodeURIComponent(person.openId)+'?user_id_type=open_id');
        if(u?.name!==person.name||u?.employee_no!==person.number||u?.open_id!==person.openId)continue;
        if(u.status?.is_activated!==true||u.status.is_exited!==false||u.status.is_resigned!==false||u.status.is_frozen!==false)continue;
        rows.push({...person});
      }
      // De-duplicate the same verified identity; never accept conflicting staff numbers.
      cache=[...new Map(rows.map(r=>[r.number+':'+r.openId,r])).values()].filter(r=>rows.every(x=>x.number!==r.number||(x.openId===r.openId&&x.name===r.name)));expires=Date.now()+60000;return cache;
    })();
    try{return await loading}finally{loading=null}
  }
  return {load,async search(query,auth){reviewActor(auth);const q=String(query||'').trim().toLowerCase();if(!q)return [];if(q.length>40)throw fail('姓名查询最多 40 字。');return (await load()).filter(p=>p.name.toLowerCase().includes(q)||p.number.toLowerCase().includes(q)).slice(0,20).map(({openId,...person})=>person)},
    async resolve(number){const person=(await load(true)).find(p=>p.number===number);if(!person)throw fail('审核人不在当前在职直播人员目录，请重新选择。',422);return person}};
}
export function createCommunicationReview({root,directory,resolveRecipient,send,publicUrl,write=writeDurableJsonAtomic,submissionNotifications=true}){
  const queues=new Map();
  async function locked(id,work){const prior=queues.get(id)||Promise.resolve();const job=prior.catch(()=>{}).then(work);queues.set(id,job);try{return await job}finally{if(queues.get(id)===job)queues.delete(id)}}
  const path=id=>{if(!/^review-[a-f0-9]{32}$/u.test(id))throw fail('审核编号无效。');return join(root,id+'.json')};
  async function read(id){try{return JSON.parse(await readFile(path(id),'utf8'))}catch(e){if(e.code==='ENOENT')return null;throw e}}
  const submissionState=r=>r.submissionNotification&&(r.submissionNotification.recipientNumber||r.submitter.number)===r.reviewer.number?r.submissionNotification:{state:'not_sent'};
  const publicRecord=(r,actor,full=false)=>({id:r.id,draftId:r.draftId,product:r.snapshot.product,status:r.status,submitter:r.submitter,reviewer:r.reviewer,submittedAt:r.submittedAt,decidedAt:r.decidedAt,comment:r.comment||'',notification:r.notification,submissionNotification:submissionState(r),canNotifySubmission:r.status==='pending'&&r.submitter.number===actor.number&&['not_sent','failed'].includes(submissionState(r).state),canDecide:r.status==='pending'&&r.reviewer.number===actor.number,...(full?{snapshot:r.snapshot}:{})});
  async function notifySubmission(r){
    let recipient;
    const recipientNumber=r.reviewer.number;
    if(r.submissionNotification&&(r.submissionNotification.recipientNumber||r.submitter.number)!==recipientNumber){
      r.submissionNotificationHistory=[...(r.submissionNotificationHistory||[]),r.submissionNotification];
    }
    try{recipient=await resolveRecipient({ok:true,mode:'central',user:{number:recipientNumber,realName:r.reviewer.name}})}catch{
      r.submissionNotification={recipientNumber,state:'failed',reason:'稿件已提交，审核人的飞书账号暂不可用。'};await write(path(r.id),r);return;
    }
    const uuid=createHash('sha256').update('communication-review-request:'+r.id+':'+recipientNumber).digest('hex').slice(0,32);
    r.submissionNotification={recipientNumber,state:'uncertain',reason:'稿件已提交，审核人通知发送结果待确认。'};await write(path(r.id),r);
    try{
      const receipt=await send(recipient,['【素材中心】你有一份沟通稿待审核',`产品：${r.snapshot.product}`,`提交人：${r.submitter.name}`,`审核人：${r.reviewer.name}`,'请打开稿件，通过或驳回。',`查看稿件：${publicUrl}?review=${r.id}`].join('\n'),uuid);
      if(!receipt?.messageId)throw Error('Missing receipt');
      r.submissionNotification={recipientNumber,state:'sent',sentAt:new Date().toISOString()};
    }catch(error){
      if(/^feishu_\d+$/u.test(error?.details||''))r.submissionNotification={recipientNumber,state:'failed',reason:'飞书未接受本次通知，可重试。',code:error.details};
    }
    await write(path(r.id),r);
  }
  return {
    async list(auth){const actor=reviewActor(auth);let files;try{files=await readdir(root)}catch(e){if(e.code==='ENOENT')return [];throw e}const rows=[];for(const file of files.filter(f=>/^review-[a-f0-9]{32}\.json$/u.test(f))){const r=await read(file.slice(0,-5));if(r&&(r.submitter.number===actor.number||r.reviewer.number===actor.number))rows.push(publicRecord(r,actor))}return rows.sort((a,b)=>b.submittedAt.localeCompare(a.submittedAt))},
    async get(id,auth){const actor=reviewActor(auth),r=await read(id);if(!r)throw fail('审核记录不存在。',404);if(r.submitter.number!==actor.number&&r.reviewer.number!==actor.number)throw fail('仅提交人和指定审核人可查看此审核记录。',403);return publicRecord(r,actor,true)},
    async submit({requestId,reviewerNumber,snapshot},auth){
      const actor=reviewActor(auth);
      if(!/^[A-Za-z0-9_-]{16,80}$/u.test(requestId||''))throw fail('提交编号无效，请刷新后重试。');
      if(!snapshot?.id||!snapshot.product||!String(snapshot.fullScript||'').trim())throw fail('请先生成并保存完整稿件。');
      const id='review-'+createHash('sha256').update(actor.number+':'+requestId).digest('hex').slice(0,32);
      const {updatedAt,updatedBy,...content}=snapshot;
      const fingerprint=createHash('sha256').update(JSON.stringify({reviewerNumber,snapshot:content})).digest('hex');
      return locked('submit',async()=>{
        const prior=await read(id);if(prior){if(prior.fingerprint!==fingerprint)throw fail('提交编号已用于其他内容。',409);return publicRecord(prior,actor,true)}
        const existing=await this.list(auth);if(existing.some(r=>r.draftId===snapshot.id&&r.status==='pending'))throw fail('该稿件已有待审核记录，请先完成审核。',409);
        const person=await directory.resolve(reviewerNumber);
        const record={id,fingerprint,draftId:snapshot.id,snapshot:structuredClone(snapshot),submitter:actor,reviewer:{number:person.number,name:person.name},status:'pending',submittedAt:new Date().toISOString(),notification:{state:'not_due'}};
        await mkdir(root,{recursive:true,mode:0o700});
        await locked(id,async()=>{await write(path(id),record);if(submissionNotifications)await notifySubmission(record)});
        return publicRecord(record,actor,true);
      });
    },
    async notifySubmission(id,auth){
      const actor=reviewActor(auth);return locked(id,async()=>{
        const r=await read(id);if(!r)throw fail('审核记录不存在。',404);
        if(r.submitter.number!==actor.number)throw fail('只有提交人可以补发给指定审核人的通知。',403);
        if(r.status!=='pending'||!['not_sent','failed'].includes(submissionState(r).state))return publicRecord(r,actor,true);
        await notifySubmission(r);return publicRecord(r,actor,true);
      });
    },
    async decide(id,{decision,comment},auth){
      const actor=reviewActor(auth);if(!['approved','rejected'].includes(decision))throw fail('审核结果无效。');
      comment=String(comment||'').trim();if(comment.length>2000)throw fail('审核意见最多 2000 字。');if(decision==='rejected'&&!comment)throw fail('请填写驳回原因。');
      return locked(id,async()=>{
        const r=await read(id);if(!r)throw fail('审核记录不存在。',404);
        if(r.reviewer.number!==actor.number)throw fail('只有指定审核人可以通过或驳回。',403);
        if(r.status!=='pending'){if(r.status===decision&&r.comment===comment)return publicRecord(r,actor,true);throw fail('此记录已审核，请刷新查看结果。',409)}
        r.status=decision;r.comment=comment;r.decidedAt=new Date().toISOString();r.notification={state:'pending'};
        await write(path(id),r);
        let recipient;try{recipient=await resolveRecipient({ok:true,mode:'central',user:{number:r.submitter.number,realName:r.submitter.name}})}catch{r.notification={state:'failed',reason:'审核已保存，提交人的飞书账号暂不可用。'};await write(path(id),r);return publicRecord(r,actor,true)}
        const uuid=createHash('sha256').update('communication-review:'+id).digest('hex').slice(0,32);
        r.notification={state:'uncertain',reason:'审核已保存，通知发送结果待确认。'};await write(path(id),r);
        try{const receipt=await send(recipient,['【素材中心】沟通稿审核'+(decision==='approved'?'通过':'驳回'),`产品：${r.snapshot.product}`,`审核人：${actor.name}`,comment?`审核意见：${comment}`:'',`查看稿件：${publicUrl}?review=${id}`].filter(Boolean).join('\n'),uuid);if(!receipt?.messageId)throw Error('Missing receipt');r.notification={state:'sent',sentAt:new Date().toISOString()};await write(path(id),r)}catch{/* An ambiguous send must not be retried automatically. */}
        return publicRecord(r,actor,true);
      });
    }
  };
}
