import {mkdir,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {writeDurableJsonAtomic} from './durable-journal.mjs';
import {reviewWeekFor} from './lifecycle-engine.mjs';

// Persist aggregates only; never persist calendar titles, IDs or fingerprints.
export function publicCoachReview(snapshot) {
  const {date,checkedAt,rotation,summary,calendarStatus} = snapshot;
  const source=snapshot.source?.type==='bitable' ? snapshot.source : undefined;
  return JSON.parse(JSON.stringify({date,checkedAt,rotation,summary,calendarStatus,source}));
}

export function createCoachReviewStore({directory,load,now=Date.now,write=writeDurableJsonAtomic,readOnly=false}) {
  const running=new Map();
  const pathFor=date=>{
    const week=reviewWeekFor(date);
    if(!week) throw new Error('复盘统计日期无效');
    return join(directory,`coach-review-bitable-${week.start}.json`);
  };
  async function saved(date) {
    try {
      const value=JSON.parse(await readFile(pathFor(date),'utf8'));
      if(value.schemaVersion!==1 || value.data?.summary?.week?.start!==reviewWeekFor(date).start || !Number.isFinite(Date.parse(value.data?.checkedAt))) return null;
      return value.data;
    } catch {return null;}
  }
  async function refresh(date,options={}) {
    const key=pathFor(date);
    if(running.has(key)) return running.get(key);
    const task=(async()=>{
      const snapshot=await load(date,options);
      if(!readOnly) {
        await mkdir(directory,{recursive:true});
        await write(key,{schemaVersion:1,data:publicCoachReview(snapshot)});
      }
      return snapshot;
    })();
    running.set(key,task);
    try {return await task;} finally {running.delete(key);}
  }
  async function get(date,{force=false}={}) {
    const previous=await saved(date);
    const age=previous ? now()-Date.parse(previous.checkedAt) : Infinity;
    if(!force && previous?.date===date && age>=0 && age<60000) return {...previous,stale:false};
    try {return {...publicCoachReview(await refresh(date,{freshRanking:true})),stale:false};}
    catch(error) {
      if(!previous) throw error;
      return {...previous,stale:true,refreshError:'本次抓取失败，显示本绩效周上次抓取结果'};
    }
  }
  return {refresh,get};
}
