import {createHash} from 'node:crypto';
import {chinaDateFor,reviewWeekFor} from './lifecycle-engine.mjs';
export const reviewSource=Object.freeze({type:'bitable',baseToken:'JFcQbbjWHavlpts4g6rcyO9TnYd',tableId:'tblHJlrAWjOcMEnL',viewId:'vewWNgslaE'});
const rooms=['官旗','品牌精选','优选','王鸥美肤'];
const fields=['主播','所属直播间','会议日期','会议主题','纪要链接'];
export function minutesUrl(value){
 const raw=typeof value==='string'?value:Array.isArray(value)?value.map(v=>v?.link||v?.text||'').join(''):value?.link||value?.text||'';
 try{const u=new URL(raw.trim());return u.protocol==='https:'&&!u.username&&!u.password&&(u.hostname==='feishu.cn'||u.hostname.endsWith('.feishu.cn'))?u.href:null;}catch{return null;}
}
function text(value){
 if(value==null)return '';
 if(typeof value==='string')return value.trim();
 if(Array.isArray(value)&&value.every(item=>item&&typeof item.text==='string'))return value.map(item=>item.text).join('').trim();
 throw Error('复盘表文本字段格式待核验');
}
export async function readReviewRecords(get){
 const root='/bitable/v1/apps/'+reviewSource.baseToken+'/tables/'+reviewSource.tableId+'/records';
 const seen=new Set(),records=new Map();let cursor='';
 for(let page=0;page<100;page++){
  const params=new URLSearchParams({view_id:reviewSource.viewId,page_size:'50',field_names:JSON.stringify(fields)});
  if(cursor)params.set('page_token',cursor);
  const data=await get(root+'?'+params);
  if(!Array.isArray(data.items)||typeof data.has_more!=='boolean')throw Error('复盘表分页返回不完整');
  for(const record of data.items){
   if(!record?.record_id||!record.fields||typeof record.fields!=='object')throw Error('复盘表记录结构待核验');
   const previous=records.get(record.record_id);
   if(previous&&JSON.stringify(previous.fields)!==JSON.stringify(record.fields))throw Error('复盘表读取期间记录发生变化');
   records.set(record.record_id,record);
  }
  if(!data.has_more)return [...records.values()];
  if(typeof data.page_token!=='string'||!data.page_token||seen.has(data.page_token))throw Error('复盘表分页游标无效');
  seen.add(data.page_token);cursor=data.page_token;
 }
 throw Error('复盘表分页超过核验上限');
}
export function buildBitableReview(records,date,asOf=new Date()){
 const week=reviewWeekFor(date);if(!week)throw Error('复盘统计日期无效');
 const counts=Object.fromEntries(rooms.map(room=>[room,new Map()]));
 const seen=new Set();let matchedRecords=0;
 for(const record of records){
  if(seen.has(record.record_id))continue;seen.add(record.record_id);
  const f=record.fields,title=text(f['会议主题']);
  if(!title.includes('复盘'))continue;
  const timestamp=f['会议日期'];
  if(typeof timestamp!=='number'||!Number.isFinite(timestamp)||timestamp<=0||!Number.isFinite(new Date(timestamp).getTime()))throw Error('复盘表会议日期缺失或无效');
  const day=chinaDateFor(new Date(timestamp));
  if(day<week.start||day>week.end||timestamp>asOf.getTime())continue;
  const name=text(f['主播']),room=text(f['所属直播间']);
  if(!name||!rooms.includes(room))throw Error('本周复盘记录的主播或所属直播间待核验');
  const entry=counts[room].get(name)||{count:0,reviews:[]};
  entry.count++;entry.reviews.push({date:day,url:minutesUrl(f['纪要链接'])});
  counts[room].set(name,entry);matchedRecords++;
 }
 const summaryRooms=Object.fromEntries(rooms.map(room=>[room,{status:'ready',anchors:[...counts[room]].sort(([a],[b])=>a.localeCompare(b,'zh-CN')).map(([name,entry])=>({name,count:entry.count,reviews:entry.reviews.sort((a,b)=>b.date.localeCompare(a.date))})),zeroReview:[]} ]));
 const result={date,checkedAt:asOf.toISOString(),source:reviewSource,
  rotation:{status:'ready',week,rooms:Object.fromEntries(rooms.map(room=>[room,[...counts[room].keys()]]))},
  summary:{status:'ready',sourceType:'bitable',week,rooms:summaryRooms,matchedRecords},
  calendarStatus:Object.fromEntries(rooms.map(room=>[room,{status:'已读取'}]))};
 Object.defineProperty(result,'reviewFingerprint',{value:createHash('sha256').update(JSON.stringify(records.map(r=>[r.record_id,fields.map(f=>r.fields[f]??null)]).sort((a,b)=>a[0].localeCompare(b[0])))).digest('hex')});
 return result;
}
