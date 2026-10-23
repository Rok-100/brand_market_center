import {createHash} from 'node:crypto';
import {parseRecordingCaption,scheduleNameKey} from './anchor-recording-caption.mjs';

export const DIMENSIONS = Object.freeze(['眼神交流','表情管理','肢体语言','形象管理','镜头感','吐字清晰度','语速节奏','情绪表达','声音感染力','语言流畅度']);
export const ROOMS = Object.freeze(['官旗','品牌精选','优选','王鸥美肤']);
export const POLICY_VERSION = 'anchor-status-20261006-v2-confirmed-compliance';
export const digest = value => createHash('sha256').update(String(value)).digest('hex');
export const businessDate = value => new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));
export const fault = (message, code='invalid_result', status=400) => Object.assign(new Error(message),{code,status});
const text = (value,max=1000) => String(value||'').trim().slice(0,max);

export function warningRules({total,dimensions,compliance}){
  const reasons=[],extreme=dimensions.filter(item=>item.score<2);
  const confirmedHits=compliance.status==='hit'?compliance.hits:[];
  if(total<65)reasons.push({code:'low_total',text:'总分低于 65 分'});
  if(extreme.length)reasons.push({code:'extreme_dimension',text:extreme.map(item=>`${item.name} ${item.score} 分`).join('、')});
  if(confirmedHits.length)reasons.push({code:'prohibited',text:confirmedHits.map(item=>item.term).join('、')});
  return {warning:reasons.length>0,severe:extreme.length>0||confirmedHits.length>0,reasons};
}

export function normalizeScore(raw) {
  if(raw?.status !== 'scored') throw fault(text(raw?.reason,240)||'素材证据不足，需要人工复核。','needs_review',422);
  if(raw?.quality?.visualUsable!==true || raw?.quality?.audioUsable!==true) throw fault('画面或音频不足以完成十维评分。','needs_review',422);
  const dimensions = DIMENSIONS.map(name=>{
    const item=raw?.dimensions?.find(item=>item.name===name);
    if(!item || typeof item.score!=='number' || !Number.isFinite(item.score) || item.score<0 || item.score>10 || !text(item.evidence)) {
      throw fault('模型未返回完整、有效且有依据的十维评分。','invalid_result',502);
    }
    return {name,score:item.score,evidence:text(item.evidence),improvement:text(item.improvement,500)};
  });
  if(raw.dimensions.length!==DIMENSIONS.length) throw fault('评分维度重复或数量不正确。','invalid_result',502);
  const round=n=>Number(n.toPrecision(15));
  const visual=round(dimensions.slice(0,5).reduce((sum,item)=>sum+item.score,0));
  const audio=round(dimensions.slice(5).reduce((sum,item)=>sum+item.score,0));
  const total=round(visual+audio);
  if(!Array.isArray(raw.compliance?.hits) || !['clear','hit','uncertain'].includes(raw.compliance?.status)) throw fault('合规检测结果不完整。','invalid_result',502);
  const hits=raw.compliance.hits.map(item=>({term:text(item.term,80),context:text(item.context,500),timeSeconds:typeof item.timeSeconds==='number'&&Number.isFinite(item.timeSeconds)&&item.timeSeconds>=0?item.timeSeconds:null}));
  if(hits.some(item=>!item.term || !item.context || !item.context.includes(item.term)) || (raw.compliance.status==='hit'&&!hits.length) || (raw.compliance.status==='clear'&&hits.length)) throw fault('合规命中证据不完整或相互冲突。','invalid_result',502);
  const extreme=dimensions.filter(item=>item.score<2);
  const flags=warningRules({total,dimensions,compliance:{status:raw.compliance.status,hits}});
  return {dimensions,visual,audio,total,grade:total>=90?'A':total>=80?'B':total>=70?'C':total>=60?'D':'E',
    trialPassed:total>=70&&!extreme.length,...flags,
    highlights:(Array.isArray(raw.highlights)?raw.highlights:[]).map(x=>text(x,500)).slice(0,10),
    improvements:(Array.isArray(raw.improvements)?raw.improvements:[]).map(x=>text(x,500)).slice(0,10),
    compliance:{status:raw.compliance.status,hits},requiresReview:raw.compliance.status==='uncertain',
    quality:{visualUsable:true,audioUsable:true,limitations:text(raw.quality.limitations)},policyVersion:POLICY_VERSION};
}

// Use an already attributed recording, but never infer a live session from its upload hour.
export function identifyRecording({recording,sessions=[],manualSession}) {
  const caption=text(recording.text,2000);
  const attribution=parseRecordingCaption(caption)||manualSession;
  const name=attribution?.name,room=attribution?.room;
  if(!name || !ROOMS.includes(room)) throw fault('群消息未明确主播及直播间，请人工确认。','identity_review',422);
  const time=Date.parse(recording.createdAt);
  if(!Number.isFinite(time))throw fault('录屏上传时间无效。','identity_review',422);
  const range=caption.match(/(?:场次|上播|直播|时间)?\s*(\d{1,2}):([0-5]\d)\s*[-—~～至]\s*(\d{1,2}):([0-5]\d)/u);
  const date=caption.match(/(20\d{2}-\d{2}-\d{2})/u)?.[1]||businessDate(time);
  let candidates=sessions.filter(item=>scheduleNameKey(item.name)===scheduleNameKey(name)&&item.room===room&&Number.isFinite(Date.parse(item.start))&&Number.isFinite(Date.parse(item.end)));
  if(range){
    const startHour=+range[1],endHour=+range[3];
    if(startHour>23||endHour>24||endHour===24&&+range[4]!==0)throw fault('场次时间无效。','identity_review',422);
    const start=`${date}T${String(startHour).padStart(2,'0')}:${range[2]}:00+08:00`;
    let end=new Date(`${date}T${String(endHour===24?0:endHour).padStart(2,'0')}:${range[4]}:00+08:00`).getTime();
    if(end<=Date.parse(start))end+=86400000;
    const explicit={name,room,start,end:new Date(end).toISOString(),source:'recording_caption'};
    if(candidates.length){candidates=candidates.filter(item=>Date.parse(item.start)===Date.parse(explicit.start)&&Date.parse(item.end)===end);if(candidates.length!==1)throw fault('录屏场次与正式班表冲突。','identity_review',422);}
    else candidates=[explicit];
  }else if(manualSession){
    candidates=candidates.filter(item=>Date.parse(item.start)===Date.parse(manualSession.start)&&Date.parse(item.end)===Date.parse(manualSession.end));
  }else{
    candidates=candidates.filter(item=>time>=Date.parse(item.start)&&time<=Date.parse(item.end)+30*60000);
  }
  if(candidates.length!==1)throw fault('无法唯一核验录屏场次，请补充场次时间。','identity_review',422);
  const session=candidates[0];
  return {name,room,session:{start:session.start,end:session.end,source:session.source||'official_schedule'},
    sessionKey:digest(`${name}|${room}|${Date.parse(session.start)}|${Date.parse(session.end)}`),businessDate:businessDate(session.start)};
}
