import {readFile,stat} from 'node:fs/promises';
import {identifyRecording,normalizeScore,fault,businessDate} from './anchor-status-policy.mjs';
import {parseRecordingCaption} from './anchor-recording-caption.mjs';

export const COMPLIANCE_RULES={version:'existing-communication-audit-20261006',source:'直播中心沟通稿 auditGeneratedCommunication',
  groups:['细胞、修复、解决、纯天然','未经核验的美白、淡斑、祛痘、抗老功效宣称','百分之百、100%有效、绝对有效、保证有效、永久保证','扣1、扣已拍等诱导互动','虚假库存、倒计时及马上恢复原价','宽泛退换、物流承诺','未经核验的孕妇绝对适用、专利、检测报告、排名'],
  instruction:'结合口播完整上下文识别实际宣称，说明性否定或引用不能直接当作违规；没有可核验出处的限制性事实标记待复核。'};

export function createAnchorStatusService({store,collect,profiles,readSessions,analyze,model,deliver,verifyDelivery,employeeDirectory,
  enabled=true,notificationsEnabled=false,credentialFile='',delegation=null,clock=Date.now}={}) {
  let scanning=null,processing=null,delivering=null,matching=null,lastError=null;
  let employeeSnapshot=store.meta('employeeDirectory'),employeeLoading=null;
  let employeeCheckedAt=Date.parse(employeeSnapshot?.fetchedAt)||0;
  const serviceIdentity={configured:Boolean(credentialFile),ready:false,checkedAt:null,error:null};
  let pumping=null;
  async function refreshEmployeeNumbers(){
    if(!enabled||!employeeDirectory)return;
    if(employeeLoading)return employeeLoading;
    if(employeeCheckedAt&&clock()-employeeCheckedAt<(employeeSnapshot?10*60000:60000))return;
    employeeCheckedAt=clock();
    employeeLoading=(async()=>{try{
      const next=await employeeDirectory(store.employeeNames());
      if(JSON.stringify(next)!==JSON.stringify(employeeSnapshot)){store.meta('employeeDirectory',next);employeeSnapshot=next;}
    }catch{employeeSnapshot=null;}})();
    try{return await employeeLoading;}finally{employeeLoading=null;}
  }
  async function backgroundToken(){
    if(!credentialFile)return '';
    serviceIdentity.checkedAt=new Date(clock()).toISOString();
    try{
      const info=await stat(credentialFile);
      if(!info.isFile()||info.size>8192||(process.platform!=='win32'&&(info.mode&0o077)))throw Error('invalid file');
      const value=(await readFile(credentialFile,'utf8')).trim();
      if(!value||value.length>8192||/[\r\n\x00-\x1f]/u.test(value))throw Error('invalid credential');
      if(typeof model.verifyCredentials!=='function')throw Error('missing verifier');
      await model.verifyCredentials(value);
      serviceIdentity.ready=true;serviceIdentity.error=null;
      return value;
    }catch{
      serviceIdentity.ready=false;serviceIdentity.error='后台服务身份不可用，请核验授权及服务器凭据配置；待评分记录已保留。';
      throw fault(serviceIdentity.error,'service_identity_unavailable',503);
    }
  }
  function status(){const keys=['lastBackgroundCheck','lastScan','lastSlot','coverage'],values=store.metaValues?store.metaValues(keys):Object.fromEntries(keys.map(key=>[key,store.meta(key)]));const automation=delegation?.status();return {enabled,scanning:Boolean(scanning),matching:Boolean(matching),processing:Boolean(processing),notificationsEnabled,deliveryRunning:Boolean(delivering),
    authentication:credentialFile?'service_credentials':delegation?'delegated_oa':'current_oa_session',serviceIdentity:{...serviceIdentity},automation:automation?{...automation,serverManaged:true}:null,unattendedScoring:Boolean(credentialFile)&&serviceIdentity.ready||Boolean(automation?.ready),...values,ready:store.readyCount(),lastError};}
  async function resolveSession(job){
    let sessions=[];
    if(job.source.manualSession)sessions=[job.source.manualSession];
    else if(readSessions){try{sessions=await readSessions(job.source);}catch(error){if(!/\d{1,2}:[0-5]\d\s*[-—~～至]\s*\d{1,2}:[0-5]\d/u.test(job.source.recording.text))throw error;}}
    return identifyRecording({...job.source,sessions});
  }
  async function matchPending(options={}){
    if(matching)return matching;
    matching=(async()=>{const counts={matched:0,unmatched:0,unavailable:0};
      for(const job of store.pendingSessions(options)){
        try{if(store.recordSessionMatch(job.id,await resolveSession(job)))counts.matched++;}
        catch(error){store.failSessionMatch(job.id,error);counts[error?.code==='identity_review'?'unmatched':'unavailable']++;}
      }
      store.meta('lastSessionMatch',{...counts,at:new Date(clock()).toISOString()});return counts;
    })();
    try{return await matching;}finally{matching=null;}
  }
  async function ingestEvidence(roster,evidence,slot=''){
    if(!evidence.sources?.learning?.available||evidence.sources.learning.truncated)throw fault('学习群录屏未完整读取，保留原队列，下次补扫。','source_incomplete',503);
    const byName=new Map(roster.map(x=>[x.name,x]));const rows=[];
    for(const data of Object.values(evidence.evidenceByAnchor||{}))for(const recording of data.recordings||[]){
      if(recording.source!=='WIS直播学习')continue;
      const caption=parseRecordingCaption(recording.text);
      for(const resource of recording.resources||[])if(resource.type==='video'||/\.(?:mp4|mov|webm|m4v)$/iu.test(resource.name||''))rows.push({name:caption?.name||'未识别主播',room:caption?.room||'',profile:byName.get(caption?.name),recording,resource,unidentified:!caption});
    }
    for(const recording of evidence.unattributedRecordings||[])for(const resource of recording.resources||[])if(resource.type==='video'||/\.(?:mp4|mov|webm|m4v)$/iu.test(resource.name||''))rows.push({name:'未识别主播',recording,resource,unidentified:true});
    const result=store.ingest(rows,{slot,coverage:evidence.sources.learning});lastError=null;return {...result,matching:await matchPending()};
  }
  async function scan(slot=''){
    if(!enabled)throw fault('预警模块未启用。','disabled',423);
    if(scanning)return scanning;
    scanning=(async()=>{
      const roster=profiles?await profiles().catch(()=>[]):[];
      const evidence=await collect(new Set(roster.map(x=>x.name)));
      return ingestEvidence(roster,evidence,slot);
    })();
    try{return await scanning;}catch(error){lastError=String(error.message).slice(0,240);throw error;}finally{scanning=null;}
  }
  async function work({token,selectedModel,id}={}){
    if(processing)return processing;
    processing=(async()=>{
      const credential=token||(credentialFile?await backgroundToken():await delegation?.token());if(!credential)throw fault('请重新登录OA并启用后台评分。','model_not_configured',401);
      if(!token&&delegation&&!credentialFile){
        selectedModel=delegation.status().model;
        try{await model.verifyCredentials(credential,selectedModel);}catch(e){if([401,403].includes(e.status))delegation.invalidate();throw fault('后台模型授权核验未通过，待评分记录保留，请更新OA授权或稍后重试。','background_model_unavailable',e.status||503);}
      }
      await matchPending();
      const job=store.claim({id,requireSession:true,includeSetup:true});if(!job)return {state:'idle'};
      const timeout=AbortSignal.timeout(300000);
      try{
        const identity=await resolveSession(job);
        if(!store.bindSession(job.id,identity))return {id:job.id,state:'duplicate'};
        const media=await analyze(job.source,{signal:timeout});timeout.throwIfAborted();
        if(!store.setMedia(job.id,{hash:media.hash,bytes:media.bytes,durationSeconds:media.durationSeconds,hasAudio:media.hasAudio}))return {id:job.id,state:'duplicate'};
        const scored=await model.score({...identity,media,complianceRules:COMPLIANCE_RULES},{token:credential,model:selectedModel,signal:timeout});
        timeout.throwIfAborted();
        const result=normalizeScore(scored.value);
        if(result.compliance.hits.some(x=>x.timeSeconds!==null&&x.timeSeconds>media.durationSeconds))throw fault('合规命中时间超出录屏范围。','invalid_result',502);
        store.complete(job.id,result,{model:scored.model});lastError=null;
        return {id:job.id,state:'scored',total:result.total};
      }catch(error){
        if(!token&&[401,403].includes(error?.status)){serviceIdentity.ready=false;serviceIdentity.error='后台模型授权已失效，请更新授权；待评分记录已保留。';if(!credentialFile)delegation?.invalidate();}
        store.fail(job.id,error);return {id:job.id,state:store.get(job.id).state};
      }
    })();
    try{return await processing;}finally{processing=null;}
  }
  async function pump(){
    if(pumping)return pumping;
    if(!enabled||!delegation?.status().enabled)return {state:'paused'};
    store.meta('lastBackgroundCheck',new Date(clock()).toISOString());
    pumping=(async()=>{
      let completed=0;
      while(delegation.status().enabled&&store.readyCount()>0){
        try{const result=await work();await sendOne();if(result.state==='idle')break;completed++;}
        catch{lastError='后台评分暂不可用，待评分记录已保留；请检查OA授权或稍后重试。';break;}
      }
      return {completed};
    })();
    try{return await pumping;}finally{pumping=null;}
  }
  async function configureAutomation({action,token,actor,selectedModel}={}){
    if(!delegation)throw fault('后台授权托管尚未配置。','automation_unavailable',503);
    if(action==='pause')return delegation.pause(actor);
    if(action!=='enable')throw fault('不支持的后台评分操作。');
    const selected=await model.verifyCredentials(token,selectedModel||undefined);
    const result=await delegation.enable(token,actor,selected);lastError=null;
    pump().catch(()=>{});return result;
  }
  function reportText(job){
    const result=job.result,history=store.history(job.name,7),task=store.tasks().find(t=>t.job_id===job.id);
    const trend=history.map(x=>`${x.business_date} ${x.result.total}分`).join(' → ');
    const localTime=value=>new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(value));
    return `${result.warning?'【主播状态预警】':'【主播状态初评】'}${job.name} · ${job.room}\n场次（北京时间）：${localTime(job.source.identity.session.start)} — ${localTime(job.source.identity.session.end)}\n总分：${result.total}/100\n`+
      result.dimensions.map(d=>`${d.name} ${d.score}/10：${d.evidence}`).join('\n')+
      `\n亮点：${result.highlights.join('；')||'暂无'}\n改进：${result.improvements.join('；')||'暂无'}\n预警原因：${result.reasons.map(x=>x.text).join('；')||'无'}\n合规结论：${result.compliance.status==='uncertain'?'待人工核验':result.compliance.status==='hit'?'明确命中':'未发现明确命中'}\n`+
      (result.compliance.status==='uncertain'&&result.compliance.hits.length?`待核验候选（未确认违规）：${result.compliance.hits.map(x=>`${x.term}${x.timeSeconds===null?'':`（${x.timeSeconds}秒）`}：${x.context}`).join('；')}\n`:'')+`近7天：${trend||'首次评估'}\n`+
      (task?`复盘任务：${task.id}，负责人倪梦萍\n`:'')+`原录屏：${job.source.recording.appLink||'见随附原始录屏'}\nAI初评，素材或合规待核验：${result.requiresReview?'是':'否'}。`;
  }
  async function sendOne(){
    if(!notificationsEnabled||!deliver)return {state:'disabled'};
    if(delivering)return delivering;
    delivering=(async()=>{
      const receipt=store.claimReport();if(!receipt)return {state:'idle'};
      const job=store.get(receipt.job_id);
      if(receipt.state==='sent_unverified'){
        if(await verifyDelivery(receipt.message_id).catch(()=>false))store.reportState(job.id,'verified',{messageId:receipt.message_id});
        else store.reportState(job.id,'sent_unverified',{messageId:receipt.message_id});
        return {state:store.report(job.id).state};
      }
      // Durably record intent BEFORE any external send. A crash cannot license an automatic retry.
      store.reportState(job.id,'sending');
      try{
        const result=await deliver(job,{uuid:receipt.uuid,text:reportText(job),receipt,
          onVideoSent:messageId=>store.recordVideoReceipt(job.id,messageId),
          onOriginalLink:url=>store.recordOriginalLink(job.id,url),
          beforeText:()=>store.reportState(job.id,'sending')});
        if(!result?.messageId)throw fault('未取得消息回执。','uncertain_delivery',502);
        store.reportState(job.id,'sent_unverified',{messageId:result.messageId});
        if(await verifyDelivery(result.messageId).catch(()=>false))store.reportState(job.id,'verified',{messageId:result.messageId});
      }catch{store.reportState(job.id,'uncertain',{error:'发送结果待核验，已停止自动重发。'});}
      return {state:store.report(job.id).state};
    })();try{return await delivering;}finally{delivering=null;}
  }
  return {status,scan,work,sendOne,reportText,model,ingestEvidence,matchPending,refreshEmployeeNumbers,pump,configureAutomation,
    async tick(slot){if(!enabled)return;delegation?.expire();if(!store.meta('lastSlot')||store.meta('lastSlot')!==slot)await scan(slot);await matchPending();if(delegation)await pump();else if(credentialFile)await work();await sendOne();},
    list(filters){return publicJobs(store.list(filters));},
    detail(id){const row=store.get(id);if(!row)throw fault('评估记录不存在。','not_found',404);const [detail,...history]=publicJobs([row,...store.history(row.name,7)]);return {...detail,report:detail.delivery,history};},
    summary(filters){const date=filters?.date||businessDate(clock());return {...store.stats({...filters,date}),tasks:store.tasks().filter(task=>task.business_date===date&&(!filters?.room||task.room===filters.room)),status:status()};},
    trends(filters){return store.trends(filters);},
    retry:(id,actor)=>{
      const row=store.get(id);
      if(row&&!row.source.identity?.session)throw fault('请先核验主播归属和场次，再重新评分。','identity_review',422);
      if(delegation&&!delegation.status().enabled)throw fault('后台评分已暂停或授权失效，请先启用或更新后台授权。','automation_paused',409);
      const result=publicJob(store.retry(id,actor));
      if(delegation)pump().catch(()=>{});
      return result;
    },
    resolve:(id,note,actor)=>publicJob(store.resolve(id,note,actor)),
    async reviewIdentity(id,input,actor){const row=store.get(id);if(!row)throw fault('评估记录不存在。','not_found',404);const caption=parseRecordingCaption(row.source.recording.text);if(caption&&(input.name!==caption.name||input.room!==caption.room))throw fault('主播及直播间请以原群消息文案为准。');if(!/^[\p{Script=Han}A-Za-z·.\-]{1,40}$/u.test(String(input.name||'')))throw fault('请填写有效主播姓名。');const updated=store.resolveIdentity(id,input,actor);await matchPending();return publicJob(store.get(updated.id));},
    task:(id,input,actor)=>store.task(id,input.action,input.note,actor),
  };
  function publicJobs(jobs){const related=store.related(jobs);return jobs.map(job=>publicJob(job,related));}
  function publicJob(job,related){const employee=employeeSnapshot?.byName?.[job.name];return {id:job.id,name:job.name,employeeNumber:employee?.status==='verified'?employee.employeeNumber:'',employeeNumberStatus:employee?.status||'missing',room:job.room||parseRecordingCaption(job.source.recording.text)?.room||job.source.manualSession?.room||'',date:job.business_date,state:job.state,attempts:job.attempts,error:job.error,
    createdAt:job.created_at,completedAt:job.completed_at,result:job.result,session:job.source.identity?.session,sessionMatch:job.source.sessionMatch||null,
    recording:{name:job.source.resource.name,messageId:job.source.recording.messageId,resourceKey:job.source.resource.key,thumbnailKey:job.source.recording.resources?.find(resource=>resource.type==='image')?.key||'',
      createdAt:job.source.recording.createdAt,text:job.source.recording.text,attribution:job.source.recording.attribution||null,appLink:job.source.recording.appLink||'',url:job.source.resource.url||''},
    media:job.source.media,originalDelivery:job.source.originalDelivery||null,manualReview:job.source.manualReview||null,manualRetry:job.source.manualRetry||null,policyCorrection:job.source.policyCorrection||null,delivery:related?related.reports.get(job.id)||null:store.report(job.id),task:related?related.tasks.get(job.id)||null:store.tasks().find(t=>t.job_id===job.id)||null};}
}
