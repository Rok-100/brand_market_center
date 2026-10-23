import {fault} from './anchor-status-policy.mjs';

const escape=value=>String(value??'').replace(/[&<>*~_\[\]`#()]/gu,char=>'&#'+char.charCodeAt(0)+';');
const clip=(value,max=280)=>{const chars=[...String(value??'')];return chars.length>max?chars.slice(0,max).join('')+'…':chars.join('');};
const markdown=(content,extra={})=>({tag:'markdown',content,...extra});
const column=elements=>({tag:'column',width:'weighted',weight:1,vertical_spacing:'8px',elements});
const columns=items=>({tag:'column_set',flex_mode:'none',horizontal_spacing:'12px',columns:items.map(column)});
const time=value=>new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(value));
export function safeCardUrl(value){
  let url;try{url=new URL(value);}catch{}
  if(!url||url.protocol!=='https:'||url.username||url.password||[...url.searchParams.keys()].some(key=>/^(?:token|access_token|oa_token|password|authorization)$/iu.test(key)))throw fault('卡片的受控链接不可用，已停止发送。','card_link_invalid',503);
  return url.href;
}
export function anchorStatusCard(job,{reportUrl,originalUrl}){
  const result=job.result,session=job.source?.identity?.session;
  if(!result||!Number.isFinite(result.total)||!Number.isFinite(result.visual)||!Number.isFinite(result.audio)||!session?.start||!session?.end)throw fault('完整评分或已核验场次缺失，已停止发送。','card_source_invalid',422);
  const report=safeCardUrl(reportUrl),original=safeCardUrl(originalUrl);
  const state=result.severe?'严重预警':result.warning?'状态预警':result.requiresReview?'待人工复核':'正常';
  const color=result.severe?'red':result.warning||result.requiresReview?'orange':'green';
  const metric=(value,label,size)=>[markdown(`**${escape(value)}**`,{text_size:size,text_align:'center'}),markdown(`<font color='grey'>${label}</font>`,{text_size:'notation',text_align:'center'})];
  const findings=[`**${state}**`,
    `预警原因：${escape(clip(result.reasons?.map(x=>x.text).join('；')||'无'))}`,
    `合规结论：${result.compliance?.status==='hit'?'明确命中':result.compliance?.status==='uncertain'?'待人工核验，候选证据尚未确认违规':'未发现明确命中'}`,
    `亮点：${escape(clip(result.highlights?.join('；')||'暂无'))}`,
    `改进：${escape(clip(result.improvements?.join('；')||'暂无'))}`].join('\n');
  const button=(label,url,primary)=>({tag:'button',text:{tag:'plain_text',content:label},type:primary?'primary_filled':'default',width:'fill',behaviors:[{type:'open_url',default_url:url}]});
  return {schema:'2.0',config:{update_multi:true,width_mode:'default',summary:{content:`${job.name} · ${result.total}分 · ${state}`}},
    header:{template:color,title:{tag:'plain_text',content:result.warning?'主播状态预警':'主播状态评分'},subtitle:{tag:'plain_text',content:job.name+' · '+job.room}},
    body:{direction:'vertical',padding:'12px',vertical_spacing:'12px',elements:[
      columns([metric(result.total,'状态总分 / 100','heading-1'),metric(result.visual,'镜头评分 / 50','heading-3'),metric(result.audio,'播感评分 / 50','heading-3')]),
      columns([[markdown(`**主播 / 直播间**\n${escape(job.name)} · ${escape(job.room)}`)],[markdown(`**场次（北京时间）**\n${escape(time(session.start))}\n至 ${escape(time(session.end))}`)]]),
      columns([[markdown(findings)]]),
      columns([[button('评分详情与复盘',report,true)],[button('查看原始录屏',original,false)]]),
      markdown("<font color='grey'>AI 初评；十维证据及历史趋势请查看评分详情，原文件需 OA 登录。</font>",{text_size:'notation'})
    ]}};
}
