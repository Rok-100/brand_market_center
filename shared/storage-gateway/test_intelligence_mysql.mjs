import assert from 'node:assert/strict';
import {IntelligenceStore as SQLiteStore} from '/baseline/daily-intelligence-store.mjs';
import {IntelligenceStore as MysqlStore} from './intelligence_store_mysql.mjs';

const old=new SQLiteStore('/fixture/comparison.sqlite');
const mysql=new MysqlStore('/fixture/comparison.sqlite');
const normalize=value=>JSON.parse(JSON.stringify(value??null));
function compare(method,...args) {
  const expected=old[method](...args),actual=mysql[method](...args);
  assert.deepEqual(normalize(actual),normalize(expected),method);
  return actual;
}
try {
  const now=Date.parse('2026-10-06T02:00:00.000Z');
  const window={date:'2026-10-06',start:'2026-10-05 00:00:00',end:'2026-10-05 23:59:59'};
  compare('setting','test-key',false);
  compare('setting','test-key');
  const report=compare('claim','isolated-test',window,true,now);
  compare('claim','isolated-test',window,true,now+1);
  report.state='partial';report.finishedAt=new Date(now+100).toISOString();report.materials={status:'ready',items:[],error:null};
  compare('finish',report);
  compare('get','isolated-test');
  compare('overview');
  const retried=compare('claim','isolated-test',window,true,now+200,true);
  retried.state='ready';retried.finishedAt=new Date(now+300).toISOString();
  const target={id:'fixture-recipient',type:'user_id',name:'测试'};
  const messages=[{uuid:'fixture-message',text:'fixture only'}];
  compare('finish',retried,{target,messages});
  compare('enqueue',retried,target,messages);
  compare('delivery','isolated-test');
  const message=compare('messageClaim',now+500);
  compare('messageClaim',now+501);
  compare('messageFinish',message,{state:'retry',error:'isolated retry'},now+600);
  compare('messageClaim',now+601);
  const second=compare('messageClaim',now+100000);
  compare('messageFinish',second,{state:'sent',messageId:'fixture-sent-id'},now+100001);
  compare('messageClaim',now+100002);
  compare('overview');
  compare('cancelOtherRecipients',{id:'different-fixture',type:'user_id'});
  const big=compare('claim','large-response',{...window,date:'2026-10-07'},true,now+200000);
  big.state='ready';big.materials={status:'ready',items:[],largeProcessingFixture:'x'.repeat(800000)};
  compare('finish',big);
  compare('get','large-response');
  console.log(JSON.stringify({sameSqliteBehavior:true,leaseExclusion:true,retryAndSentStates:true,deduplication:true,largeResponseResize:true,noMessagesSent:true}));
} finally {old.close();mysql.close();}
