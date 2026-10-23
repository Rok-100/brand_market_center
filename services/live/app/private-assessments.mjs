export const ASSESSMENT_RULE='均分大于70分即通过；复考以最新评分为准，保留历史记录';
export function assessmentText(message){
 let body;try{body=JSON.parse(message.body?.content||'{}')}catch{return ''}
 const flatten=v=>typeof v==='string'?v:Array.isArray(v)?v.map(flatten).join('\n'):v&&typeof v==='object'?Object.entries(v).filter(([k])=>['text','title','content','zh_cn','en_us','elements'].includes(k)).map(([,x])=>flatten(x)).join('\n'):'';
 return flatten(body).replace(/<\/?p[^>]*>/gi,'\n').replace(/<[^>]*>/g,'').replace(/\[([^\]]+)\]\(https?:\/\/[^)]+\)/g,'$1').replace(/https?:\/\/\S+/g,'').replace(/\r/g,'').trim();
}
export function parsePrivateAssessments(messages,{senderNames={}}={}){
 const byName=new Map(),seen=new Set(),unresolved=[];
 for(const m of [...messages].sort((a,b)=>Number(a.create_time)-Number(b.create_time)||String(a.message_id).localeCompare(String(b.message_id)))){
  if(m.deleted||!senderNames[m.sender?.id]||!['text','post'].includes(m.msg_type)||!/^om_[\w]+$/.test(m.message_id||'')||seen.has(m.message_id))continue;
  seen.add(m.message_id);
  const text=assessmentText(m);
  if(!/考核|试播分析/.test(text))continue;
  const averages=[...text.matchAll(/(?:平均分|均分)\s*(?:为|是|[:：=])?\s*(\d+(?:\.\d+)?)/g)];
  if(!averages.length)continue;
  const pattern=/(?:^|[\s，,。；;：:\]】])(?:(?:主管|这个是|这是|主播|新人|关于|你好)[，,：:\s]*)*([\p{Script=Han}·]{2,6}?)(?:的)?(?=试播分析|考核|(?:第[一二三四五六七八九十\d]+次)?加练|第[一二三四五六七八九十\d]+次)/gu;
  const names=[...new Set([...text.matchAll(pattern)].map(x=>x[1]))].filter(x=>!['第一次','第二次','第三次','第一次评分结果','第一次评分','第二次评分','平均分','均分','本次','已通过','未通过','已过','未过','卡线过了','分数已过','分数已通过','分数通过','是否正式通过','正式通过','建议通过'].includes(x));
  if(names.length!==1){unresolved.push({messageId:m.message_id,reason:'评分消息中的主播姓名无法唯一识别'});continue}
  const scored=averages.map((match,index)=>{
   const lineStart=text.lastIndexOf('\n',match.index)+1, lineEnd=text.indexOf('\n',match.index);
   const line=text.slice(lineStart,lineEnd<0?text.length:lineEnd);
   const attempts=[...line.matchAll(/第([一二三四五六七八九十\d]+)次/g)];
   const digit=attempts.at(-1)?.[1],rank=digit?(/^\d+$/.test(digit)?Number(digit):'一二三四五六七八九十'.indexOf(digit)+1):0;
   return {average:Number(match[1]),index,rank,old:/之前|上次|原先|首次评分|第一次评分结果/.test(line),line};
  });
  const current=scored.filter(x=>!x.old).sort((a,b)=>b.rank-a.rank||a.index-b.index)[0]||scored[0];
  // Several unlabelled averages cannot be assigned to a current assessment.
  if(scored.length>1&&scored.every(x=>!x.rank&&!x.old)){unresolved.push({messageId:m.message_id,reason:'多个均分缺少复考或历史标记'});continue}
  if(!Number.isFinite(current.average)||current.average<0||current.average>100){unresolved.push({messageId:m.message_id,reason:'均分不在0至100之间'});continue}
  const at=Number(m.create_time);if(!Number.isFinite(at)||at<=0)continue;
  const sourceConclusion=/是否.*通过|请.*确认|待.*确认|建议.*通过/.test(current.line)?'消息请求确认；按均分规则判定'
   :/未通过考核|未过考核|考核未通过/.test(current.line)?'消息注明未通过考核'
   :/已过考核|考核通过|通过考核|考核分数通过|过了考核|分数已过考核|已通过考核/.test(current.line)?'消息注明通过考核'
   :/及格线/.test(current.line)?'消息包含及格线说明':'消息提供评分，按均分规则判定';
  const entry={name:names[0],average:current.average,passed:current.average>70,messageId:m.message_id,at:new Date(at).toISOString(),date:new Date(at+8*3600000).toISOString().slice(0,10),sender:senderNames[m.sender.id],sourceConclusion,source:'designated_private_chat'};
  const history=byName.get(entry.name)||[];history.push(entry);byName.set(entry.name,history);
 }
 return {items:[...byName].map(([name,history])=>({name,...history.at(-1),history})).sort((a,b)=>b.at.localeCompare(a.at)),unresolved,rule:ASSESSMENT_RULE};
}
export function applyPrivateAssessments(candidates,source,{chatComplete=true}={}){
 if(source.status!=='ready')return null;
 const byName=new Map(source.items.map(x=>[x.name,x]));
 const cohortNames=candidates.filter(x=>x.inSubmissionCohort).map(x=>x.name);
 let passedCount=0,failedCount=0,awaitingCount=0;
 const updated=candidates.map(candidate=>{
  const record=byName.get(candidate.name);
  const submission=candidate.submissionEvidence;
  const history=record?.history.filter(x=>!submission?.date || x.date>=submission.date)||[];
  const latest=history.at(-1);
  const eligible=chatComplete&&candidate.inSubmissionCohort&&submission?.sourceId&&cohortNames.filter(x=>x===candidate.name).length===1&&latest;
  if(!eligible){if(candidate.inSubmissionCohort)awaitingCount++;return candidate}
  if(latest.passed)passedCount++;else failedCount++;
  const label=latest.passed?'考核通过':'考核未通过';
  const display=`${candidate.stage==='hired'?'已入职 · ':''}${label}（均分 ${latest.average}）`;
  return {...candidate,assessmentPassed:latest.passed,assessmentAverage:latest.average,assessmentHistory:history,
   assessmentDisplayStatus:display,status:display,assessmentEvidenceStatus:`指定私聊 · ${label} · 最新均分 ${latest.average}`,
   assessmentScoreEvidence:{source:latest.source,messageId:latest.messageId,at:latest.at,sender:latest.sender,sourceConclusion:latest.sourceConclusion},
   timeline:[...(candidate.timeline||[]),...history.map(x=>[x.date,`私聊考核评分 ${x.average} 分 · ${x.passed?'通过':'未通过'} · ${x.sourceConclusion}`])]};
 });
 return {candidates:updated,summary:chatComplete?{passedCount,failedCount,conflictCount:0,awaitingCount}:null,
  status:`指定私聊已读取；按最新均分>70判定，通过 ${passedCount} 人、未通过 ${failedCount} 人、待匹配或待评分 ${awaitingCount} 人。`,
  privateOverview:source};
}
export function createPrivateAssessmentSource({readers,senderNames,clock=Date.now}){
 let cached=null,inFlight=null;
 async function load(){
  if(cached&&clock()-cached.loadedAt<60000)return cached.value;
  if(inFlight)return inFlight;
  inFlight=(async()=>{
   let reader;
   for(const candidate of readers){try{if((await candidate.status()).authorized){reader=candidate;break}}catch{}}
   if(!reader)return {status:'unavailable',reason:'指定私聊尚无有效本人授权',items:[],rule:ASSESSMENT_RULE};
   const endTime=Math.floor(clock()/1000),startTime=endTime-120*86400;
   try{
    const result=await reader.readMessages({startTime,endTime});
    const parsed=parsePrivateAssessments(result.items,{senderNames});
    const value={...parsed,status:'ready',readAt:new Date(clock()).toISOString(),periodStart:new Date(startTime*1000).toISOString(),periodEnd:new Date(endTime*1000).toISOString(),messagesRead:result.items.length};
    cached={loadedAt:clock(),value};return value;
   }catch{return {status:'unavailable',reason:'指定私聊读取不完整或授权失效，未使用旧评分冒充当前结果',items:[],rule:ASSESSMENT_RULE}}
  })().finally(()=>{inFlight=null});return inFlight;
 }
 return {load};
}
