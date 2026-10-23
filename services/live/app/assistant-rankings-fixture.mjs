import {readFile} from 'node:fs/promises';
import {assistantSources} from './assistant-rankings.mjs';
export async function capturedAssistantGetter(path){
 const capture=JSON.parse(await readFile(path,'utf8'));
 return {capturedAt:capture.checkedAt,get:async endpoint=>{
  const url=new URL(endpoint,'https://open.feishu.cn');
  const source=assistantSources.find(s=>url.pathname.includes('/apps/'+s.base+'/'));
  if(!source)throw Error('仅允许本地助理考核只读样本');
  if(url.pathname.endsWith('/tables'))return {items:[{table_id:source.table,revision:1}],has_more:false};
  const room=capture.rooms.find(r=>r.room===source.id);if(!room?.records)throw Error('样本不可读');
  const start=Number(url.searchParams.get('page_token')||0),size=Number(url.searchParams.get('page_size')||500),end=start+size;
  return {items:room.records.slice(start,end),has_more:end<room.records.length,page_token:String(end)};
 }};
}
