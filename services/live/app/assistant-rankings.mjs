import {readFile,mkdir,writeFile,rename} from 'node:fs/promises';
import {dirname} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';

export const assistantSources=Object.freeze([
 {id:'flagship',name:'官旗直播间',base:'X50Eb9FgzaD8Alsm13JcYgdynZc',table:'tblXV5IDgwLeh6CM'},
 {id:'premium',name:'品牌精选直播间',base:'GffmbRXJOaf8rIsbqkpcRGMtnSc',table:'tblwDjFjRclh8NWP'},
 {id:'select',name:'优选直播间',base:'WRrqbZkLDa7vSBsqz3qcJTKGnld',table:'tbly9lwGpF6osZEq'},
 {id:'beauty',name:'王鸥美肤直播间',base:'G58kbMChFaqxCisSye8cg0KfnJe',table:'tbleS5wEqMxeCUGj'}
]);
export function chinaClock(now=new Date()){
 const d=new Date(now.getTime()+8*3600000);
 if(!Number.isFinite(d.getTime()))throw Error('无效同步时间');
 return {date:d.toISOString().slice(0,10),month:d.toISOString().slice(0,7),day:d.getUTCDate(),minutes:d.getUTCHours()*60+d.getUTCMinutes()};
}
export function previousMonth(month){
 if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw Error('月份无效');
 const [y,m]=month.split('-').map(Number);return new Date(Date.UTC(y,m-2,1)).toISOString().slice(0,7);
}
const monthNames=['一月','二月','三月','四月','五月','六月','七月','八月','九月','十月','十一月','十二月'];
function fieldText(v){
 if(v==null)return '';
 if(typeof v==='string')return v.trim();
 if(Array.isArray(v)&&v.every(x=>typeof x?.text==='string'))return v.map(x=>x.text).join('').trim();
 throw Error('考核表文本字段格式无效');
}
export function evaluationMonth(fields){
 const raw=fieldText(fields['评价月份']);if(!raw)return null;
 if(/^\d{4}-(0[1-9]|1[0-2])$/.test(raw))return raw;
 const n=monthNames.indexOf(raw)+1;
 const date=fields['日期'];
 if(!n||typeof date!=='number'||!Number.isFinite(date)||date<=0)throw Error('评价月份或填表日期待核验');
 const submitted=chinaClock(new Date(date)).month;const [year,month]=submitted.split('-').map(Number);
 // A December evaluation submitted in January belongs to the preceding year.
 return `${year-(n>month?1:0)}-${String(n).padStart(2,'0')}`;
}
export function buildMonthlyRankings(records,month,now=new Date(),{allowIncomplete=false}={}){
 const groups=new Map();let skipped=0,pending=0,matched=0;
 const ids=new Set();
 for(const record of records){
  if(!record?.record_id||!record.fields)throw Error('考核表记录结构无效');
  if(ids.has(record.record_id))continue;ids.add(record.record_id);
  const f=record.fields,period=evaluationMonth(f);
  if(!period){skipped++;continue;}if(period!==month)continue;matched++;
  const name=fieldText(f['直播助理']);
  const raw=f['汇总得分'];const score=typeof raw==='number'?raw:raw==null||raw===''?null:Number(fieldText(raw));
  if(!name||score==null||!Number.isFinite(score)||score<0||score>100||typeof f['日期']!=='number'||f['日期']>now.getTime()){pending++;continue;}
  const entry=groups.get(name)||{name,total:0,count:0};entry.total+=score;entry.count++;groups.set(name,entry);
 }
 if(pending&&!allowIncomplete)throw Object.assign(Error(`${month} 存在 ${pending} 条未完成或无效评分，保留上次有效排名`),{code:'incomplete_scores'});
 if(!matched||!groups.size)throw Object.assign(Error(`${month} 暂无有效评分记录`),{code:'no_scores'});
 const entries=[...groups.values()].map(({name,total,count})=>({name,score:total/count,evaluations:count})).sort((a,b)=>b.score-a.score||a.name.localeCompare(b.name,'zh-CN'));
 const highest=entries[0].score,lowest=entries.at(-1).score;let rank=0,last;
 for(let i=0;i<entries.length;i++){
  const row=entries[i];if(row.score!==last)rank=i+1;last=row.score;
  Object.assign(row,{rank,champion:entries.length>1&&highest!==lowest&&row.score===highest,warning:entries.length>1&&highest!==lowest&&row.score===lowest});
 }
 return {entries,recordCount:matched-pending,pendingCount:pending,ignoredUnassigned:skipped,fingerprint:createHash('sha256').update(JSON.stringify(entries)).digest('hex')};
}
export async function readAssistantRecords(get,source){
 const root='/bitable/v1/apps/'+source.base;
 const revision=async()=>{
  const data=await get(root+'/tables?page_size=100');const table=data.items?.find(x=>x.table_id===source.table);
  if(!table)throw Error('指定考核数据表不可读');return table.revision;
 };
 const before=await revision();const records=new Map(),cursors=new Set();let cursor='';
 for(let page=0;page<100;page++){
  const q=new URLSearchParams({page_size:'500',field_names:JSON.stringify(['日期','评价月份','直播助理','汇总得分'])});if(cursor)q.set('page_token',cursor);
  const data=await get(root+'/tables/'+source.table+'/records?'+q);
  if(!Array.isArray(data.items)||typeof data.has_more!=='boolean')throw Error('考核数据分页不完整');
  for(const row of data.items){
   if(!row.record_id||!row.fields)throw Error('考核数据结构不完整');
   if(records.has(row.record_id)&&JSON.stringify(records.get(row.record_id).fields)!==JSON.stringify(row.fields))throw Error('读取期间评分发生变化');
   records.set(row.record_id,row);
  }
  if(!data.has_more){const after=await revision();if(before!==after)throw Error('读取期间考核表发生变化，请重试');return [...records.values()];}
  if(!data.page_token||cursors.has(data.page_token))throw Error('考核数据分页游标无效');cursor=data.page_token;cursors.add(cursor);
 }
 throw Error('考核表分页超过上限');
}
export function createAssistantRankings({get,statePath,enabled=false,schedulerEnabled=false,readOnly=false,now=()=>new Date(),sourceMode='feishu',capturedAt=null}){
 let queue=Promise.resolve(),nextRetry=0;
 const serial=fn=>{const task=queue.then(fn);queue=task.catch(()=>{});return task;};
 async function load(){
  try {const state=JSON.parse(await readFile(statePath,'utf8'));if(state.version!==1||!state.months||!state.runs)throw Error('助理排名存储版本无效');return state;}
  catch(e){if(e.code==='ENOENT')return {version:1,months:{},runs:{},attempts:[]};throw e;}
 }
 async function save(state){
  await mkdir(dirname(statePath),{recursive:true});const tmp=statePath+'.'+randomUUID()+'.tmp';await writeFile(tmp,JSON.stringify(state),'utf8');await rename(tmp,statePath);
 }
 function closePast(state,time){
  const target=previousMonth(time.month);let changed=false;
  for(const [month,snapshot] of Object.entries(state.months)){
   if(month<target||(month===target&&time.day>20))for(const room of Object.values(snapshot.rooms))if(room.status==='updating'){
    room.status=room.finalCapture?'final':'archived_unconfirmed';room.closedAt=now().toISOString();changed=true;
   }
  }
  return changed;
 }
 async function view(month){
  const time=chinaClock(now()),state=await load();closePast(state,time);
  const selected=month||previousMonth(time.month);
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(selected))throw Object.assign(Error('月份格式应为 YYYY-MM'),{status:422});
  const available=[...new Set([previousMonth(time.month),...Object.keys(state.months)])].sort().reverse();
  return {month:selected,months:available,rooms:assistantSources.map(source=>({id:source.id,name:source.name,url:'https://jqx28l0j4lx.feishu.cn/base/'+source.base,...state.months[selected]?.rooms[source.id],lastAttempt:state.lastAttempt?.[source.id]||null})),schedule:{timezone:'Asia/Shanghai',hour:16,updateDays:'1—20',targetMonth:previousMonth(time.month),enabled:enabled&&!readOnly,schedulerEnabled:schedulerEnabled&&enabled&&!readOnly},sourceMode,capturedAt,attempts:state.attempts.slice(-12).reverse(),canSync:enabled&&!readOnly&&time.day<=20&&time.minutes>=960};
 }
 async function sync(trigger='manual'){
  return serial(async()=>{
   if(!enabled||readOnly)throw Object.assign(Error('助理评分同步尚未启用'),{status:423});
   const current=now(),time=chinaClock(current),month=previousMonth(time.month),state=await load();
   if(closePast(state,time))await save(state);
   if(time.day>20||time.minutes<960)throw Object.assign(Error('仅在每月1—20日北京时间16:00后同步上月评分'),{status:409});
   const existing=state.runs[time.date];if(trigger==='scheduled'&&existing?.complete)return view(month);
   state.lastAttempt??={};let succeeded=0;
   for(const source of assistantSources){
    if(trigger==='scheduled'&&existing?.rooms?.includes(source.id)){succeeded++;continue;}
    try{
     const records=await readAssistantRecords(get,source);
     const ranking=buildMonthlyRankings(records,month,current);
     // Discard a result that completed after the permitted Beijing date/window.
     const finished=chinaClock(now());if(finished.date!==time.date||finished.day>20)throw Error('同步跨过当日截止时间，未覆盖排名');
     state.months[month]??={rooms:{}};
     const old=state.months[month].rooms[source.id];
     if(old&&old.status!=='updating')throw Error('此月份已经归档，不允许覆盖');
     state.months[month].rooms[source.id]={...ranking,status:'updating',updatedAt:now().toISOString(),finalCapture:time.day===20,syncDate:time.date,sourceMode,capturedAt};
     // Older source rows are imports, not proof of a historical closing-day snapshot.
     const prior=[...new Set(records.map(r=>evaluationMonth(r.fields)).filter(m=>m&&m<month))];
     for(const m of prior)if(!state.months[m]?.rooms[source.id]){
      try{const history=buildMonthlyRankings(records,m,current,{allowIncomplete:true});state.months[m]??={rooms:{}};state.months[m].rooms[source.id]={...history,status:history.pendingCount?'historical_incomplete':'historical_import',updatedAt:now().toISOString(),sourceMode,capturedAt};}catch{/* Incomplete historical periods are not fabricated. */}
     }
     state.lastAttempt[source.id]={ok:true,checkedAt:now().toISOString(),month};succeeded++;
     state.runs[time.date]??={rooms:[]};if(!state.runs[time.date].rooms.includes(source.id))state.runs[time.date].rooms.push(source.id);
    }catch(e){state.lastAttempt[source.id]={ok:false,checkedAt:now().toISOString(),month,error:e.code==='no_scores'||e.code==='incomplete_scores'?e.message:'读取失败或权限不足，保留上次有效排名，请检查来源或重试。'};}
   }
   state.runs[time.date]??={rooms:[]};state.runs[time.date].complete=succeeded===assistantSources.length;
   state.attempts.push({at:now().toISOString(),month,trigger,succeeded,total:assistantSources.length});state.attempts=state.attempts.slice(-120);
   // Keep only recent daily execution receipts; monthly snapshots remain permanent.
   for(const day of Object.keys(state.runs))if(day<time.month+'-01')delete state.runs[day];
   await save(state);return view(month);
  });
 }
 async function tick(){
  if(!enabled||!schedulerEnabled||readOnly)return;
  const time=chinaClock(now());
  if(time.day>20)return serial(async()=>{const state=await load();if(closePast(state,time))await save(state);});
  if(time.minutes<960||now().getTime()<nextRetry)return;
  nextRetry=now().getTime()+5*60000;
  return sync('scheduled');
 }
 return {view,sync,tick};
}
