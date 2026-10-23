import {createHash,randomUUID} from 'node:crypto';
import {mkdir,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {writeDurableJsonAtomic} from './durable-journal.mjs';

const hash=value=>createHash('sha256').update(value).digest('hex');
const fail=(message,status)=>Object.assign(new Error(message),{status,details:'communication_delivery_error'});
const idPattern=/^communication-[a-f0-9]{32}$/u;
export function createCommunicationDelivery({root,generate,save,resolveRecipient,send,publicUrl,clock=Date.now}) {
  const running=new Map();
  const read=async id=>{
    if(!idPattern.test(id))return null;
    try{return JSON.parse(await readFile(join(root,id+'.json'),'utf8'))}catch(e){if(e.code==='ENOENT')return null;throw e}
  };
  const response=record=>({...record.result,notification:{...record.notification,
    state:['sending','pending'].includes(record.notification.state)?'uncertain':record.notification.state}});
  return {
    async get(id){return (await read(id))?.result||null},
    async run(input,auth,token){
      const number=String(auth?.user?.number||'');
      if(!auth?.ok||auth.mode!=='central'||auth.degraded||!/^FD-\d+$/u.test(number))throw fail('请重新登录 OA 后生成沟通稿。',401);
      const requestId=String(input.requestId||randomUUID());
      if(!/^[A-Za-z0-9_-]{16,80}$/u.test(requestId))throw fail('生成请求编号无效，请刷新后重试。',400);
      const payload={...input};delete payload.requestId;
      const fingerprint=hash(JSON.stringify(payload));
      const id='communication-'+hash(number+':'+requestId).slice(0,32);
      const inflight=running.get(id);
      if(inflight){if(inflight.fingerprint!==fingerprint)throw fail('同一请求编号不能用于不同的生成要求。',409);return inflight.promise}
      const operation=(async()=>{
        const prior=await read(id);
        if(prior){if(prior.fingerprint!==fingerprint)throw fail('同一请求编号不能用于不同的生成要求。',409);return response(prior)}
        // generate() must finish all existing compliance checks before this save/send lane.
        const result={...await generate(payload,token),id};
        await save(result,auth);
        await mkdir(root,{recursive:true,mode:0o700});
        const record={actorNumber:number,fingerprint,result,notification:{state:'pending'}};
        const path=join(root,id+'.json');
        await writeDurableJsonAtomic(path,record);
        let recipient;
        try {recipient=await resolveRecipient(auth)}catch {
          record.notification={state:'failed',reason:'本人飞书账号或通知服务暂不可用，稿件已保存。'};
          await writeDurableJsonAtomic(path,record);return response(record);
        }
        const link=publicUrl+'?draft='+encodeURIComponent(id);
        const text=['【素材中心】沟通稿已生成',`产品：${result.product}`,`篇数：${result.scripts?.length||1} 篇`,
          `生成时间：${new Date(result.generatedAt||clock()).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false})}`,
          '稿件已自动保存，可继续编辑。','查看稿件：'+link].join('\n');
        const uuid=hash('communication-ready:'+id).slice(0,32);
        record.notification={state:'sending',uuid,startedAt:new Date(clock()).toISOString()};
        await writeDurableJsonAtomic(path,record);
        try {
          const receipt=await send(recipient,text,uuid);
          if(!receipt?.messageId)throw Error('Missing receipt');
          record.notification={state:'sent',messageId:receipt.messageId,sentAt:new Date(clock()).toISOString()};
          await writeDurableJsonAtomic(path,record);
        } catch {
          // Never resend an ambiguous POST, including after process restart.
          record.notification={state:'uncertain',reason:'稿件已保存，飞书通知结果待确认。'};
          await writeDurableJsonAtomic(path,record).catch(()=>{});
        }
        return response(record);
      })();
      running.set(id,{fingerprint,promise:operation});
      try{return await operation}finally{running.delete(id)}
    }
  };
}

export function createCommunicationRecipient({appId,recipientMap,readContact,tenantToken}) {
  return async auth=>{
    if(appId!=='cli_aa9c744d6ffa1cc4'||auth?.mode!=='central'||!auth.ok||auth.degraded)throw Error('Unverified sender or session');
    const number=String(auth.user?.number||''),name=String(auth.user?.realName||auth.user?.name||'');
    const openId=recipientMap[number];
    if(!/^ou_[A-Za-z0-9]+$/u.test(openId||'')||!name)throw Error('No verified employee mapping');
    const contact=await readContact(openId),status=contact?.status;
    if(contact?.open_id!==openId||contact.name!==name||status?.is_activated!==true||
      status.is_exited!==false||status.is_frozen!==false||status.is_resigned!==false||
      (contact.employee_no&&contact.employee_no!==number))throw Error('Employee contact mismatch');
    return {openId,token:await tenantToken()};
  };
}
