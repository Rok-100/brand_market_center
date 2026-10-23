import {createSyncRpc} from './sync_rpc.mjs';
import {readFileSync,statSync} from 'node:fs';

const stamp=s=>[s.dev,s.ino,s.size,s.mtimeNs,s.ctimeNs].join(':');
// Cache only a stable, successfully parsed version. Deleted/unreadable files
// still fail closed; a failed read never falls back to an old snapshot.
export function createJsonReader(){
 const rpc=createSyncRpc('/run/pinying-remix-read.json','documents');let version,value;
 return ()=>{const current=rpc.call('statFile',['/data/clip-remix/library.json']);if(!current.exists)throw Error('Remix library is not available');if(current.version===version)return value;const stored=rpc.call('readFile',['/data/clip-remix/library.json']);value=JSON.parse(stored.data);version=stored.version;return value;};
}

// SQLite data_version is connection-local and changes on commits by OTHER
// connections. Our receipt writes therefore do not invalidate business data.
// Read the version and data in the same transaction to avoid caching a race.
export function createSqliteReader(db){
 let version,value;
 return read=>{
  db.exec('BEGIN');
  try{
   const current=db.prepare('PRAGMA data_version').get().data_version;
   const next=current===version?value:read();
   db.exec('COMMIT');version=current;value=next;return value;
  }catch(e){db.exec('ROLLBACK');throw e;}
 };
}

export function writeReceipts(db,source,rows){
 const sql=source==='cloud'?(`UPDATE user_notifications
  SET external_status=?,external_error=?,external_sent_at=?,external_message_id=?
  WHERE id=? AND (external_message_id IS NULL OR external_message_id='' OR external_message_id=?)
  AND (external_status IS NOT ? OR external_error IS NOT ? OR external_sent_at IS NOT ? OR external_message_id IS NOT ?)`):
  (`INSERT INTO service_notification_receipts VALUES(?,?,?,?,?)
   ON CONFLICT(notification_id) DO UPDATE SET state=excluded.state,message_id=excluded.message_id,error=excluded.error,sent_at=excluded.sent_at
   WHERE state IS NOT excluded.state OR message_id IS NOT excluded.message_id OR error IS NOT excluded.error OR sent_at IS NOT excluded.sent_at`);
 const queries=[];let changes=0;db.exec('BEGIN');
 try{
  for(const {event,receipt:n} of rows){
   if(!n)continue;
   if(source==='cloud'){
    const state=n.state==='ready'?'pending':n.state==='attention'?'failed':n.state;
    const error=n.error||'',sent=n.sentAt?.replace(/Z$/,'')||null,id=n.messageId||'';
    queries.push({sql,params:[state,error,sent,id,Number(event.key),id,state,error,sent,id]});
   }else queries.push({sql,params:[event.key,n.state,n.messageId||'',n.error||'',n.sentAt||null]});
  }
  for(let i=0;i<queries.length;i+=128)for(const result of db.batch(queries.slice(i,i+128)))changes+=Number(result.meta.changes);
  db.exec('COMMIT');return changes;
 }catch(e){db.exec('ROLLBACK');throw e;}
}
