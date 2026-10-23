import {createSyncRpc} from './sync_rpc.mjs';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';

function statements(sql) {
  const values=[];let quote=null,start=0;
  for(let i=0;i<sql.length;i++) {
    const char=sql[i];
    if(quote){if(char===quote){if(sql[i+1]===quote)i++;else quote=null;}else if(char==='\\')i++;}
    else if(char==="'"||char==='"'||char==='`')quote=char;
    else if(char===';'){const text=sql.slice(start,i).trim();if(text)values.push(text);start=i+1;}
  }
  const tail=sql.slice(start).trim();if(tail)values.push(tail);
  return values;
}

export class DatabaseSync {
  constructor(_file,options={}) {
    const filename=process.env.PINYING_SQLITE_CONFIG_FILE||'/run/secrets/pinying-sqlite.json';
    const mapping=JSON.parse(readFileSync(filename,'utf8'));
    const configuration=mapping.files?mapping.files[resolve(_file)]:mapping;
    if(!configuration)throw new Error('Database path has no registered MySQL migration');
    this.rpc=createSyncRpc(filename,'compat',configuration);
    this.transaction=false;this.readonly=options.readOnly===true;
  }
  exec(sql) {
    for(const statement of statements(sql)) {
      if(/^BEGIN(?:\s+IMMEDIATE)?$/iu.test(statement)){if(this.transaction)throw new Error('Transaction already active');this.rpc.call('begin');this.transaction=true;}
      else if(/^COMMIT$/iu.test(statement)){this.rpc.call('commit');this.transaction=false;}
      else if(/^ROLLBACK$/iu.test(statement)){try{this.rpc.call('rollback');}finally{this.transaction=false;}}
      else this.query(statement,[]);
    }
  }
  query(sql,params) {
    if(this.readonly&&!/^\s*(SELECT|WITH|PRAGMA)\b/iu.test(sql))throw new Error('Database is read-only');
    return this.rpc.call('query',[sql,params]);
  }
  batch(queries){
    if(this.readonly&&queries.some(query=>!/^\s*(SELECT|WITH|PRAGMA)\b/iu.test(query.sql)))throw new Error('Database is read-only');
    return this.rpc.call('batch',[queries]);
  }
  prepare(sql) {
    return {
      all:(...params)=>this.query(sql,params).results,
      get:(...params)=>this.query(sql,params).results[0],
      run:(...params)=>{const result=this.query(sql,params);return {changes:result.meta.changes,lastInsertRowid:result.meta.last_row_id};},
    };
  }
  close(){if(this.transaction){try{this.exec('ROLLBACK');}catch{}}this.rpc.close();}
}
