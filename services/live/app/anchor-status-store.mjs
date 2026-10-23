import {DatabaseSync} from './mysql_sqlite.mjs';
import {mkdirSync,chmodSync} from 'node:fs';
import {dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {fault,digest,businessDate,ROOMS,warningRules,POLICY_VERSION} from './anchor-status-policy.mjs';

const json=value=>JSON.stringify(value);
export class AnchorStatusStore {
  constructor(path,{clock=Date.now}={}) {
    this.clock=clock;if(path!==':memory:')mkdirSync(dirname(path),{recursive:true,mode:0o700});
    this.db=new DatabaseSync(path);this.db.exec(`PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,asset_key TEXT UNIQUE NOT NULL,session_key TEXT UNIQUE,
        name TEXT NOT NULL,room TEXT,business_date TEXT NOT NULL,state TEXT NOT NULL,source TEXT NOT NULL,result TEXT,content_hash TEXT UNIQUE,
        attempts INTEGER NOT NULL DEFAULT 0,next_attempt INTEGER NOT NULL DEFAULT 0,lease_until INTEGER,
        error TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,completed_at TEXT);
      CREATE TABLE IF NOT EXISTS reports(job_id TEXT PRIMARY KEY,state TEXT NOT NULL DEFAULT 'pending',uuid TEXT NOT NULL,message_id TEXT,file_message_id TEXT,error TEXT,updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS review_tasks(id TEXT PRIMARY KEY,job_id TEXT UNIQUE NOT NULL,state TEXT NOT NULL,owner TEXT NOT NULL,note TEXT,created_at TEXT NOT NULL,completed_at TEXT);
      CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY,job_id TEXT,actor TEXT,action TEXT,detail TEXT,at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);`);
    // Persistence is provided by the current production MySQL adapter.
    this.db.prepare("UPDATE jobs SET state='needs_review',error='无法识别主播归属，请人工确认。',updated_at=? WHERE state='queued' AND json_extract(source,'$.unidentified')=1 AND json_extract(source,'$.manualSession') IS NULL").run(this.now());
    this.reconcileUncertainCompliance();
  }
  now(){return new Date(this.clock()).toISOString();}
  transaction(fn){this.db.exec('BEGIN IMMEDIATE');try{const value=fn();this.db.exec('COMMIT');return value;}catch(error){this.db.exec('ROLLBACK');throw error;}}
  close(){this.db.close();}
  meta(key,value){if(value!==undefined)this.db.prepare('INSERT INTO meta VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,json(value));const row=this.db.prepare('SELECT value FROM meta WHERE key=?').get(key);return row?JSON.parse(row.value):null;}
  metaValues(keys){
    if(!keys.length)return {};
    const rows=this.db.prepare('SELECT key,value FROM meta WHERE key IN ('+keys.map(()=>'?').join(',')+')').all(...keys);
    const values=Object.fromEntries(keys.map(key=>[key,null]));for(const row of rows)values[row.key]=JSON.parse(row.value);return values;
  }
  ingest(rows,{slot,coverage}={}) {
    return this.transaction(()=>{
      let added=0;for(const row of rows){
        if(!row.name || !row.recording?.messageId || !row.resource?.key)continue;
        const assetKey=digest(`${row.recording.messageId}|${row.resource.key}`),date=businessDate(row.recording.createdAt);
        if(!/^\d{4}-\d{2}-\d{2}$/.test(date))continue;
        const existing=this.row(this.db.prepare('SELECT * FROM jobs WHERE asset_key=?').get(assetKey));
        if(existing&&!existing.result&&existing.state!=='running'&&!row.unidentified&&row.room){
          const changed=existing.name!==row.name||existing.room!==row.room||existing.source.unidentified;
          const source={...existing.source,...row,recording:{...existing.source.recording,...row.recording}};
          const manualConflict=source.manualSession&&(source.manualSession.name!==row.name||source.manualSession.room!==row.room);
          const identityProblem=existing.source.unidentified||/归属|账号|场次|档案/u.test(existing.error||'');
          const state=manualConflict?'needs_review':existing.state==='needs_review'&&identityProblem?'queued':existing.state;
          if(changed){delete source.identity;this.audit(existing.id,'GROUP_MESSAGE','message_attribution_refreshed',json({from:{name:existing.name,room:existing.room},to:{name:row.name,room:row.room},messageId:row.recording.attribution?.captionMessageId||row.recording.messageId}));}
          this.db.prepare('UPDATE jobs SET name=?,room=?,source=?,state=?,session_key=CASE WHEN ? THEN NULL ELSE session_key END,error=?,next_attempt=CASE WHEN ? THEN 0 ELSE next_attempt END,updated_at=? WHERE id=?')
            .run(row.name,row.room,json(source),state,Boolean(changed)?1:0,manualConflict?'原群消息与人工确认场次冲突，请核验。':state==='queued'?null:existing.error,state==='queued'?1:0,this.now(),existing.id);
        }
        added+=Number(this.db.prepare('INSERT OR IGNORE INTO jobs(id,asset_key,name,room,business_date,state,source,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)').run(randomUUID(),assetKey,row.name,row.room||null,date,'queued',json(row),this.now(),this.now()).changes);
        if(row.unidentified)this.db.prepare("UPDATE jobs SET state='needs_review',error='无法识别主播归属，请人工确认。' WHERE asset_key=? AND state='queued' AND json_extract(source,'$.manualSession') IS NULL").run(assetKey);
      }
      this.meta('coverage',coverage||{});if(slot)this.meta('lastSlot',slot);this.meta('lastScan',this.now());return {added};
    });
  }
  row(row){if(!row)return null;return {...row,source:JSON.parse(row.source),result:row.result?JSON.parse(row.result):null};}
  get(id){return this.row(this.db.prepare('SELECT * FROM jobs WHERE id=?').get(id));}
  reconcileUncertainCompliance(){return this.transaction(()=>{
    let corrected=0;
    for(const record of this.db.prepare("SELECT * FROM jobs WHERE result IS NOT NULL AND json_extract(result,'$.compliance.status')='uncertain' AND json_array_length(json_extract(result,'$.compliance.hits'))>0").all()){
      const row=this.row(record),flags=warningRules(row.result);
      if(row.result.warning===flags.warning&&row.result.severe===flags.severe&&json(row.result.reasons)===json(flags.reasons))continue;
      const prior={warning:row.result.warning,severe:row.result.severe,reasons:row.result.reasons};
      row.result={...row.result,...flags,policyVersion:POLICY_VERSION};
      row.source.policyCorrection={at:this.now(),reason:'合规结论为不确定，候选项不构成已确认违禁；已按确认状态更正预警等级，原评分及证据保留。',previous:prior,externalReportUnchanged:Boolean(this.report(row.id)?.message_id)};
      this.db.prepare('UPDATE jobs SET result=?,source=?,updated_at=? WHERE id=?').run(json(row.result),json(row.source),this.now(),row.id);
      this.audit(row.id,'SYSTEM_POLICY_CORRECTION','unconfirmed_compliance_alert_corrected',json({previous:prior,current:flags}));
      if(!flags.severe){this.db.prepare("UPDATE review_tasks SET state='cancelled',note=?,completed_at=NULL WHERE job_id=? AND state='open'").run('系统更正：合规候选尚未确认，不触发严重预警。自动复盘任务已撤销，候选证据仍待人工核验。',row.id);}
      corrected++;
    }
    return {corrected};
  });}
  employeeNames(){return this.db.prepare("SELECT DISTINCT name FROM jobs WHERE name<>'未识别主播'").all().map(x=>x.name);}
  readyCount(){const now=this.clock();return this.db.prepare("SELECT count(*) AS count FROM jobs WHERE ((state IN ('queued','retry','waiting_setup') AND next_attempt<=?) OR (state='running' AND lease_until<?)) AND json_extract(source,'$.identity.session.start') IS NOT NULL").get(now,now).count;}
  pendingSessions({id}={}){
    return this.db.prepare("SELECT * FROM jobs WHERE result IS NULL AND state IN ('queued','retry','waiting_setup') AND next_attempt<=? AND json_extract(source,'$.identity.session.start') IS NULL"+(id?' AND id=?':'')+" ORDER BY business_date DESC,created_at LIMIT 500").all(this.clock(),...(id?[id]:[])).map(row=>this.row(row));
  }
  recordSessionMatch(id,identity){return this.transaction(()=>{
    const row=this.get(id);if(!row||row.result||!['queued','retry','waiting_setup'].includes(row.state))return false;
    const retryingMatch=row.source.sessionMatch?.state==='unavailable';
    row.source.identity=identity;row.source.sessionMatch={state:'matched',at:this.now()};
    this.db.prepare('UPDATE jobs SET room=?,business_date=?,source=?,state=?,error=?,next_attempt=?,updated_at=? WHERE id=?')
      .run(identity.room,identity.businessDate,json(row.source),retryingMatch?'queued':row.state,retryingMatch?null:row.error,retryingMatch?0:row.next_attempt,this.now(),id);
    return true;
  });}
  failSessionMatch(id,error){const row=this.get(id);if(!row||row.result||!['queued','retry','waiting_setup'].includes(row.state))return;
    const unmatched=error?.code==='identity_review';
    const message=unmatched?String(error.message).slice(0,240):'正式班表暂时不可读，5分钟后自动重试场次匹配。';
    row.source.sessionMatch={state:unmatched?'unmatched':'unavailable',reason:message,at:this.now()};
    this.db.prepare('UPDATE jobs SET state=?,source=?,error=?,next_attempt=?,updated_at=? WHERE id=?').run(unmatched?'needs_review':'retry',json(row.source),message,unmatched?0:this.clock()+5*60000,this.now(),id);
  }
  claim({id,requireSession=false,includeSetup=false}={}) {
    return this.transaction(()=>{
      this.db.prepare("UPDATE jobs SET state=CASE WHEN attempts>=4 THEN 'needs_review' ELSE 'retry' END,lease_until=NULL,error='上次执行中断，等待重试',updated_at=? WHERE state='running' AND lease_until<?").run(this.now(),this.clock());
      const states=includeSetup?"('queued','retry','waiting_setup')":"('queued','retry')";
      const where=`state IN ${states} AND next_attempt<=?`+(requireSession?" AND json_extract(source,'$.identity.session.start') IS NOT NULL":'');
      const row=id?this.db.prepare('SELECT * FROM jobs WHERE '+where+' AND id=?').get(this.clock(),id):this.db.prepare('SELECT * FROM jobs WHERE '+where+" ORDER BY CASE WHEN json_extract(source,'$.manualRetry.requestedAt') IS NOT NULL THEN 0 ELSE 1 END,julianday(json_extract(source,'$.manualRetry.requestedAt')) ASC,CASE state WHEN 'waiting_setup' THEN 1 ELSE 0 END,business_date DESC,created_at LIMIT 1").get(this.clock());
      if(!row)return null;
      this.db.prepare("UPDATE jobs SET state='running',attempts=attempts+1,lease_until=?,updated_at=? WHERE id=?").run(this.clock()+360000,this.now(),row.id);
      return this.get(row.id);
    });
  }
  bindSession(id,identity) {
    return this.transaction(()=>{
      const other=this.db.prepare('SELECT id,state,result FROM jobs WHERE session_key=? AND id<>?').get(identity.sessionKey,id);
      const row=this.get(id);row.source.identity=identity;
      if(other&&(other.result||other.state==='running')){row.source.duplicateOf=other.id;this.db.prepare("UPDATE jobs SET state='duplicate',session_key=NULL,room=?,business_date=?,source=?,error=?,lease_until=NULL,updated_at=? WHERE id=?").run(identity.room,identity.businessDate,json(row.source),'同一主播场次已归集：'+other.id,this.now(),id);return false;}
      if(other){this.db.prepare('UPDATE jobs SET session_key=NULL WHERE id=?').run(other.id);this.audit(id,'SYSTEM','unscored_session_fallback',json({previousJobId:other.id}));}
      this.db.prepare('UPDATE jobs SET session_key=?,room=?,business_date=?,source=?,updated_at=? WHERE id=?').run(identity.sessionKey,identity.room,identity.businessDate,json(row.source),this.now(),id);return true;
    });
  }
  setMedia(id,media){return this.transaction(()=>{const row=this.get(id);row.source.media=media;
    const other=this.db.prepare('SELECT id FROM jobs WHERE content_hash=? AND id<>?').get(media.hash,id);
    if(other){this.db.prepare("UPDATE jobs SET state='duplicate',error=?,source=?,lease_until=NULL,updated_at=? WHERE id=?").run('相同原始录屏已归集：'+other.id,json(row.source),this.now(),id);return false;}
    this.db.prepare('UPDATE jobs SET content_hash=?,source=?,updated_at=? WHERE id=?').run(media.hash,json(row.source),this.now(),id);return true;});}
  complete(id,result,{model}={}) {
    return this.transaction(()=>{
      const row=this.get(id);if(row?.state!=='running')throw fault('评估状态已变化，请刷新。','conflict',409);
      const data={...result,model,evaluatedAt:this.now()};
      this.db.prepare("UPDATE jobs SET state='scored',result=?,error=NULL,lease_until=NULL,updated_at=?,completed_at=? WHERE id=?").run(json(data),this.now(),this.now(),id);
      this.db.prepare('INSERT OR IGNORE INTO reports(job_id,uuid,updated_at) VALUES (?,?,?)').run(id,digest(`anchor-report:${id}`).slice(0,32),this.now());
      if(result.severe)this.db.prepare("INSERT OR IGNORE INTO review_tasks(id,job_id,state,owner,created_at) VALUES (?,?,'open','FD-027097',?)").run(randomUUID(),id,this.now());
      return this.get(id);
    });
  }
  fail(id,error) {
    const row=this.get(id);if(!row||row.state!=='running')return;
    const manual=['needs_review','identity_review','media_quality'].includes(error?.code);
    const waiting=['model_not_configured','media_dependency_missing','model_capability_missing'].includes(error?.code)||[401,403].includes(error?.status);
    const ignored=error?.code==='duration_filtered';
    const state=ignored?'ignored':manual?'needs_review':waiting?'waiting_setup':row.attempts>=4?'needs_review':'retry';
    const message=manual||waiting||ignored?String(error.message).slice(0,240):({download_error:'录屏下载失败，请重试或重新提交原文件。',media_error:'录屏媒体处理失败，请核验文件是否可播放。',model_error:'模型评分接口执行失败，请重试或检查登录。',invalid_result:'模型未返回完整有效评分，需要重试或人工核验。'}[error?.code]||'下载、媒体处理或模型执行失败，将重试；达到重试上限后转人工。');
    this.db.prepare('UPDATE jobs SET state=?,attempts=?,error=?,next_attempt=?,lease_until=NULL,updated_at=? WHERE id=?').run(state,waiting?Math.max(0,row.attempts-1):row.attempts,message,this.clock()+Math.min(60*60000,row.attempts*5*60000),this.now(),id);
  }
  retry(id,actor) {
    return this.transaction(()=>{const row=this.get(id);if(!row||row.result||!['waiting_setup','needs_review','retry'].includes(row.state))throw fault('该记录当前不能重试。','conflict',409);
      row.source.manualRetry={requestedAt:this.now(),actor,previousAttempts:row.attempts,previousError:row.error};
      this.db.prepare("UPDATE jobs SET state='queued',source=?,attempts=0,next_attempt=0,error=NULL,updated_at=? WHERE id=?").run(json(row.source),this.now(),id);this.audit(id,actor,'retry','人工发起模型重试，后台优先处理。');return this.get(id);});
  }
  resolveIdentity(id,input,actor) {
    return this.transaction(()=>{const row=this.get(id);if(!row||row.state!=='needs_review'||row.result)throw fault('此记录不在身份复核队列。','conflict',409);
      const start=Date.parse(input.start),end=Date.parse(input.end);
      if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start||end-start>24*3600000)throw fault('请提供有效且不超过一天的场次时间。');
      if(!ROOMS.includes(input.room))throw fault('请选择有效直播间。');
      if(input.name!==row.name&&!row.source.unidentified)throw fault('身份复核不能更改已归属主播姓名。');
      row.name=input.name;row.source.name=input.name;
      row.source.unidentified=false;
      row.source.manualSession={name:row.name,room:input.room,start:new Date(start).toISOString(),end:new Date(end).toISOString(),source:'human_review'};
      delete row.source.identity;delete row.source.sessionMatch;
      this.db.prepare("UPDATE jobs SET name=?,room=?,source=?,session_key=NULL,state='queued',attempts=0,next_attempt=0,error=NULL,updated_at=? WHERE id=?").run(row.name,input.room,json(row.source),this.now(),id);this.audit(id,actor,'identity_review',json(input));return this.get(id);});
  }
  resolve(id,note,actor){return this.transaction(()=>{const row=this.get(id);if(!row||!(['needs_review','waiting_setup'].includes(row.state)||row.state==='scored'&&row.result?.requiresReview))throw fault('此记录当前无需人工处理。','conflict',409);
    note=String(note||'').trim();if(note.length<2||note.length>1500)throw fault('请填写2–1500字的人工处理说明。');
    row.source.manualReview={actor,note,at:this.now()};if(row.result)row.result={...row.result,requiresReview:false,manualReview:row.source.manualReview};
    this.db.prepare('UPDATE jobs SET state=?,source=?,result=?,updated_at=? WHERE id=?').run(row.result?'scored':'reviewed',json(row.source),row.result?json(row.result):null,this.now(),id);
    this.audit(id,actor,'manual_resolution',note);return this.get(id);});}
  audit(id,actor,action,detail){this.db.prepare('INSERT INTO audit(job_id,actor,action,detail,at) VALUES (?,?,?,?,?)').run(id,actor,action,detail,this.now());}
  task(id,action,note,actor){const row=this.db.prepare('SELECT * FROM review_tasks WHERE id=?').get(id);if(!row)throw fault('复盘任务不存在。','not_found',404);if(!['complete','reopen'].includes(action)||!String(note||'').trim())throw fault('请填写处理说明。');this.transaction(()=>{this.db.prepare('UPDATE review_tasks SET state=?,note=?,completed_at=? WHERE id=?').run(action==='complete'?'completed':'open',String(note).slice(0,1500),action==='complete'?this.now():null,id);this.audit(row.job_id,actor,action,String(note).slice(0,1500));});}
  list({date='',room='',state='',limit=200}={}) {
    const conditions=[],values=[];for(const [column,value]of[['business_date',date],['room',room],['state',state]])if(value){conditions.push(`${column}=?`);values.push(value);}
    const where=conditions.length?'WHERE '+conditions.join(' AND '):'';
    return this.db.prepare(`SELECT * FROM jobs ${where} ORDER BY julianday(json_extract(source,'$.identity.session.start')) DESC,julianday(json_extract(source,'$.recording.createdAt')) DESC,created_at DESC LIMIT ?`).all(...values,Math.min(500,Math.max(1,limit))).map(row=>this.row(row));
  }
  report(id){return this.db.prepare('SELECT * FROM reports WHERE job_id=?').get(id)||null;}
  related(jobs){
    const ids=[...new Set(jobs.map(job=>job.id))],reports=new Map(),tasks=new Map();if(!ids.length)return {reports,tasks};
    const placeholders=ids.map(()=>'?').join(',');
    for(const report of this.db.prepare('SELECT * FROM reports WHERE job_id IN ('+placeholders+')').all(...ids))reports.set(report.job_id,report);
    for(const task of this.db.prepare('SELECT t.*,j.name,j.room,j.business_date FROM review_tasks t JOIN jobs j ON j.id=t.job_id WHERE t.job_id IN ('+placeholders+') ORDER BY t.created_at DESC').all(...ids))tasks.set(task.job_id,task);
    return {reports,tasks};
  }
  pendingReport(){return this.db.prepare("SELECT * FROM reports WHERE state IN ('pending','file_sent','file_link_ready','sent_unverified') ORDER BY updated_at LIMIT 1").get();}
  claimReport(){return this.transaction(()=>{const row=this.db.prepare("SELECT * FROM reports WHERE state IN ('pending','file_sent','file_link_ready','sent_unverified') ORDER BY CASE state WHEN 'sent_unverified' THEN 1 ELSE 0 END,updated_at LIMIT 1").get();
    if(row&&row.state!=='sent_unverified')this.reportState(row.job_id,'sending');return row||null;});}
  reportState(id,state,{messageId=null,error=null}={}){this.db.prepare('UPDATE reports SET state=?,message_id=COALESCE(?,message_id),error=?,updated_at=? WHERE job_id=?').run(state,messageId,error,this.now(),id);}
  recordVideoReceipt(id,messageId){this.db.prepare("UPDATE reports SET state='file_sent',file_message_id=?,updated_at=? WHERE job_id=?").run(messageId,this.now(),id);}
  recordOriginalLink(id,url){return this.transaction(()=>{const row=this.get(id);row.source.originalDelivery={mode:'authenticated_original_link',url,at:this.now()};this.db.prepare('UPDATE jobs SET source=? WHERE id=?').run(json(row.source),id);this.reportState(id,'file_link_ready');});}
  tasks(){return this.db.prepare('SELECT t.*,j.name,j.room,j.business_date FROM review_tasks t JOIN jobs j ON j.id=t.job_id ORDER BY t.created_at DESC').all();}
  history(name,days=7){const start=new Date(this.clock()-days*86400000).toISOString();return this.db.prepare("SELECT * FROM jobs WHERE name=? AND state='scored' AND completed_at>=? ORDER BY completed_at").all(name,start).map(row=>this.row(row));}
  stats({date=businessDate(this.clock()),room=''}={}) {
    const rows=this.db.prepare('SELECT * FROM jobs WHERE business_date=?'+(room?' AND room=?':'')).all(...(room?[date,room]:[date])).map(row=>this.row(row)),scored=rows.filter(x=>x.result),warnings=scored.filter(x=>x.result.warning);
    const average=scored.length?Math.round(scored.reduce((sum,x)=>sum+x.result.total,0)/scored.length*10)/10:null;
    return {evaluated:scored.length,average,warnings:warnings.length,severe:warnings.filter(x=>x.result.severe).length,
      pending:rows.filter(x=>['needs_review','waiting_setup'].includes(x.state)||x.result?.requiresReview).length,queued:rows.filter(x=>['queued','running','retry'].includes(x.state)).length,
      ready:rows.filter(x=>['queued','retry','waiting_setup'].includes(x.state)&&x.source.identity?.session&&x.next_attempt<=this.clock()).length,
      distribution:[scored.filter(x=>x.result.total>=85).length,scored.filter(x=>x.result.total>=75&&x.result.total<85).length,scored.filter(x=>x.result.total>=65&&x.result.total<75).length,scored.filter(x=>x.result.total<65).length]};
  }
  trends({days=7,name='',room=''}={}) {
    days=days===30?30:7;const results=[],now=this.clock(),start=businessDate(now-(days-1)*86400000),end=businessDate(now);
    const byDate=new Map();
    for(const record of this.db.prepare("SELECT * FROM jobs WHERE business_date>=? AND business_date<=? AND state='scored'"+(room?' AND room=?':'')+(name?' AND name=?':'')).all(start,end,...(room?[room]:[]),...(name?[name]:[]))){
      const row=this.row(record);if(!byDate.has(row.business_date))byDate.set(row.business_date,[]);byDate.get(row.business_date).push(row);
    }
    for(let offset=days-1;offset>=0;offset--){const date=businessDate(now-offset*86400000),rows=byDate.get(date)||[];
      const avg=key=>rows.length?Math.round(rows.reduce((s,x)=>s+(key?x.result.dimensions.find(d=>d.name===key).score:x.result.total),0)/rows.length*10)/10:null;
      results.push({date,count:rows.length,average:avg(),dimensions:Object.fromEntries((rows[0]?.result.dimensions||[]).map(d=>[d.name,avg(d.name)]))});}
    return results;
  }
}
