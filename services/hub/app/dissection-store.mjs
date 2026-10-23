import {DatabaseSync} from './mysql_sqlite.mjs';
import {mkdirSync,chmodSync} from 'node:fs';
import {dirname} from 'node:path';
import {randomUUID} from 'node:crypto';

export const fail=(message,status=400)=>Object.assign(new Error(message),{status});
export const ensure=(value,message,status=400)=>{if(!value)throw fail(message,status);};
export const clean=(value,max=2000)=>String(value??'').replace(/[\u0000-\u001f\u007f]/gu,' ').trim().slice(0,max);
export class DissectionStore {
  constructor(file){
    mkdirSync(dirname(file),{recursive:true});this.db=new DatabaseSync(file);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS state(id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL);');
    this.db.prepare('INSERT OR IGNORE INTO state VALUES(1,?)').run(JSON.stringify({version:1,config:{enabled:false,reviewerNumber:'',model:''},jobs:[],notices:[],lastSourceCheck:null,lastError:''}));

  }
  read(){return JSON.parse(this.db.prepare('SELECT value FROM state WHERE id=1').get().value);}
  transaction(fn){this.db.exec('BEGIN IMMEDIATE');try{const state=this.read();const value=fn(state);this.db.prepare('UPDATE state SET value=? WHERE id=1').run(JSON.stringify(state));this.db.exec('COMMIT');return value;}catch(error){this.db.exec('ROLLBACK');throw error;}}
  recover(){this.transaction(s=>{for(const job of s.jobs)if(job.status==='analyzing'){job.status='queued';job.error='服务重启，任务已恢复到队列';job.version++;}for(const n of s.notices)if(n.state==='sending'){n.state='pending';n.unknown=true;n.nextAt=Date.now();}});}
  close(){this.db.close();}
}
export function audit(job,actor,action,note=''){
  job.version++;job.updatedAt=new Date().toISOString();
  job.events.push({id:randomUUID(),by:actor?.number||'system',name:actor?.name||'系统',action,note:clean(note),at:job.updatedAt});
}
export function notice(state,job,recipient,kind,revision=job.version){
  const id=`${job.id}:${kind}:${revision}:${recipient}`;
  if(!recipient||state.notices.some(n=>n.id===id))return;
  state.notices.push({id,jobId:job.id,recipient,kind,version:revision,state:'pending',attempts:0,nextAt:0,createdAt:new Date().toISOString()});
}
