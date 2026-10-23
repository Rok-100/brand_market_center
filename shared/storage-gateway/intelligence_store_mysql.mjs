import {createSyncRpc} from './sync_rpc.mjs';

export class IntelligenceStore {
  constructor(_file) {
    this.rpc=createSyncRpc(process.env.INTELLIGENCE_MYSQL_CONFIG_FILE||'/run/secrets/intelligence-storage.json');
    this.db={
      exec:sql=>this.rpc.call('rawQuery',[sql,[]]),
      prepare:sql=>({
        get:(...params)=>this.rpc.call('rawQuery',[sql,params]).results[0],
        all:(...params)=>this.rpc.call('rawQuery',[sql,params]).results,
        run:(...params)=>{const result=this.rpc.call('rawQuery',[sql,params]);return {changes:result.meta.changes,lastInsertRowid:result.meta.last_row_id};},
      }),
      close:()=>this.close(),
    };
  }
  setting(key,value) {
    return this.rpc.call('setting',value===undefined?[key]:[key,String(value)]);
  }
  claim(...args){return this.rpc.call('claim',args);}
  finish(...args){return this.rpc.call('finish',args);}
  get(...args){return this.rpc.call('get',args);}
  overview(...args){return this.rpc.call('overview',args);}
  delivery(...args){return this.rpc.call('delivery',args);}
  insertMessage(...args){return this.rpc.call('insertMessage',args);}
  cancelOtherRecipients(...args){return this.rpc.call('cancelOtherRecipients',args);}
  enqueue(...args){return this.rpc.call('enqueue',args);}
  messageClaim(...args){return this.rpc.call('messageClaim',args);}
  messageFinish(...args){return this.rpc.call('messageFinish',args);}
  close(){this.rpc.close();}
}
