import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
export class IntelligenceStore {
  constructor(file) {
    mkdirSync(dirname(file), {recursive:true}); this.db = new DatabaseSync(file);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, date TEXT NOT NULL, test INTEGER NOT NULL, state TEXT NOT NULL, lease INTEGER, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS messages (uuid TEXT PRIMARY KEY, run_id TEXT NOT NULL, ordinal INTEGER NOT NULL, chat_id TEXT NOT NULL, text TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'ready', attempts INTEGER NOT NULL DEFAULT 0, first_at INTEGER, next_at INTEGER NOT NULL DEFAULT 0, lease INTEGER, message_id TEXT, error TEXT);
    `);
    const columns=this.db.prepare('PRAGMA table_info(messages)').all().map(c=>c.name);
    if(!columns.includes('receive_id_type'))this.db.exec("ALTER TABLE messages ADD COLUMN receive_id_type TEXT NOT NULL DEFAULT 'chat_id'");
    if(!columns.includes('recipient_name'))this.db.exec("ALTER TABLE messages ADD COLUMN recipient_name TEXT NOT NULL DEFAULT ''");
    if(!columns.includes('payload'))this.db.exec('ALTER TABLE messages ADD COLUMN payload TEXT');
  }
  setting(key, value) {
    if(value !== undefined) this.db.prepare('INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, String(value));
    return this.db.prepare('SELECT value FROM settings WHERE key=?').get(key)?.value;
  }
  claim(id, window, test, now, retryIncomplete=false) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const old=this.db.prepare('SELECT * FROM runs WHERE id=?').get(id);
      const retry=old&&test&&retryIncomplete&&['failed','partial'].includes(old.state)&&!this.db.prepare('SELECT 1 FROM messages WHERE run_id=? LIMIT 1').get(id);
      if (old && !retry && (old.state !== 'running' || old.lease > now)) {this.db.exec('COMMIT'); return null;}
      const payload={id,window,test,startedAt:new Date(now).toISOString(),state:'running',materials:{status:'pending',items:[]},competitors:{status:'pending',items:[]}};
      if(retry){const previous=JSON.parse(old.payload);payload.previousAttempts=[...(previous.previousAttempts||[]),{finishedAt:previous.finishedAt,state:previous.state,materialError:previous.materials?.error,competitorError:previous.competitors?.error}].slice(-10);}
      this.db.prepare('INSERT INTO runs VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state,lease=excluded.lease,payload=excluded.payload').run(id,window.date,test?1:0,'running',now+600000,JSON.stringify(payload));
      this.db.exec('COMMIT'); return payload;
    } catch(e) {this.db.exec('ROLLBACK');throw e;}
  }
  finish(report,{target,messages=[]}={}) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('UPDATE runs SET state=?,lease=NULL,payload=? WHERE id=?').run(report.state,JSON.stringify(report),report.id);
      messages.forEach((m,i)=>this.insertMessage(report.id,target,m,i));
      this.db.exec('COMMIT');
    }catch(e){this.db.exec('ROLLBACK');throw e;}
  }
  get(id) {const row=this.db.prepare('SELECT payload FROM runs WHERE id=?').get(id);return row?JSON.parse(row.payload):null;}
  overview() {
    const rows=this.db.prepare('SELECT id,date,test,state,payload FROM runs ORDER BY date DESC, test ASC, rowid DESC LIMIT 31').all();
    const latest=rows[0]?JSON.parse(rows[0].payload):null;
    if(latest) latest.delivery=this.delivery(latest.id);
    return {report:latest,history:rows.map(r=>({id:r.id,date:r.date,test:!!r.test,state:r.state}))};
  }
  delivery(id,target=null) {return this.db.prepare('SELECT ordinal,state,message_id AS messageId,error,receive_id_type AS receiveType,recipient_name AS recipientName FROM messages WHERE run_id=?'+(target?' AND receive_id_type=? AND chat_id=?':'')+' ORDER BY ordinal').all(...(target?[id,target.type,target.id]:[id]));}
  insertMessage(runId,target,m,i) {
    // chat_id is retained as a legacy DB column; receive_id_type determines
    // whether its value identifies a chat or a person. Never infer from a name.
    const t=typeof target==='string'?{id:target,type:'chat_id',name:''}:target;
    const payload=m.payload||{msg_type:'text',content:JSON.stringify({text:m.text})};
    this.db.prepare('INSERT OR IGNORE INTO messages(uuid,run_id,ordinal,chat_id,text,receive_id_type,recipient_name,payload) VALUES(?,?,?,?,?,?,?,?)').run(m.uuid,runId,i+1,t.id,m.text,t.type,t.name||'',JSON.stringify(payload));
  }
  cancelOtherRecipients(target) {
    return this.db.prepare("UPDATE messages SET state='cancelled',error='接收范围已变更，该旧收件人的未送达消息停止投递',lease=NULL WHERE state NOT IN ('sent','cancelled') AND (receive_id_type<>? OR chat_id<>?)").run(target.type,target.id).changes;
  }
  enqueue(report, target, messages) {
    this.db.exec('BEGIN IMMEDIATE');
    try {messages.forEach((m,i)=>this.insertMessage(report.id,target,m,i));this.db.exec('COMMIT');}
    catch(e){this.db.exec('ROLLBACK');throw e;}
  }
  messageClaim(now) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const m=this.db.prepare("SELECT * FROM messages WHERE (state IN ('ready','retry') AND next_at<=?) OR (state='sending' AND lease<=?) ORDER BY rowid LIMIT 1").get(now,now);
      if (!m) {this.db.exec('COMMIT');return null;}
      if(m.first_at!==null && now-m.first_at>=3600000) {
        this.db.prepare("UPDATE messages SET state='attention',error='超过幂等核验窗口，停止自动重发，请核对飞书消息' WHERE uuid=?").run(m.uuid);this.db.exec('COMMIT');return null;
      }
      this.db.prepare("UPDATE messages SET state='sending',attempts=attempts+1,first_at=COALESCE(first_at,?),lease=? WHERE uuid=?").run(now,now+60000,m.uuid);
      this.db.exec('COMMIT'); return {...m,attempts:m.attempts+1};
    }catch(e){this.db.exec('ROLLBACK');throw e;}
  }
  messageFinish(m,{state,messageId=null,error=null},now) {
    this.db.prepare('UPDATE messages SET state=?,message_id=?,error=?,next_at=?,lease=NULL WHERE uuid=?').run(
      state==='retry' && m.attempts>=5?'attention':state,messageId,error,now+Math.min(300000,10000*2**m.attempts),m.uuid);
  }
  close(){this.db.close();}
}
