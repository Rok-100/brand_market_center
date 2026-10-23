import test from 'node:test';
import assert from 'node:assert/strict';
import {AnchorStatusStore} from './anchor-status-store.mjs';
import {createAnchorStatusService} from './anchor-status-service.mjs';
import {DIMENSIONS,normalizeScore} from './anchor-status-policy.mjs';

const now=Date.parse('2026-10-07T02:00:00Z');
function fixture(){
  const store=new AnchorStatusStore(':memory:',{clock:()=>now});
  for(let i=0;i<12;i++){
    store.ingest([{name:i<10?'甲':'乙',room:'官旗',recording:{messageId:'message-'+i,createdAt:new Date(now).toISOString(),text:'官旗 甲'},resource:{key:'file-'+i,name:'clip.mov'}}]);
    const job=store.list().find(x=>x.source.recording.messageId==='message-'+i);
    store.claim({id:job.id});
    const result=normalizeScore({status:'scored',quality:{visualUsable:true,audioUsable:true},dimensions:DIMENSIONS.map(name=>({name,score:i===0?1:8,evidence:'可观察的实际证据',improvement:'继续保持'})),highlights:[],improvements:[],compliance:{status:'clear',hits:[]}});
    store.complete(job.id,result,{model:'fixture'});
    store.reportState(job.id,i%2?'verified':'pending',{messageId:i%2?'receipt-'+i:null});
  }
  return store;
}
function reads(store){
  let count=0;const prepare=store.db.prepare.bind(store.db);
  store.db.prepare=(sql)=>{if(/^\s*SELECT\b/iu.test(sql))count++;return prepare(sql);};
  return ()=>count;
}
test('list and long anchor history hydrate delivery and tasks with a bounded number of database reads',()=>{
  const store=fixture();try{
    const service=createAnchorStatusService({store,clock:()=>now});const count=reads(store);
    const list=service.list({date:'2026-10-07'});
    assert.equal(list.length,12);assert.ok(count()<=3,`list performed ${count()} reads for 12 rows`);
    for(const job of list){const index=Number(job.recording.messageId.split('-')[1]);assert.equal(job.delivery.state,index%2?'verified':'pending');assert.equal(Boolean(job.task),index===0);}
    const before=count();const detail=service.detail(list.find(x=>x.name==='甲').id);
    assert.equal(detail.history.length,10);assert.ok(count()-before<=4,`detail performed ${count()-before} reads`);
    assert.deepEqual(detail.report,detail.delivery);
    for(const job of detail.history){assert.equal(job.name,'甲');assert.ok(job.delivery);assert.equal(Boolean(job.task),job.result.severe);}
  }finally{store.close();}
});
test('30-day trend needs one read and preserves dates, room/name filters and empty days',()=>{
  const store=fixture();try{
    const count=reads(store);const trend=store.trends({days:30,room:'官旗',name:'甲'});
    assert.equal(trend.length,30);assert.equal(count(),1);assert.equal(trend.at(-1).date,'2026-10-07');assert.equal(trend.at(-1).count,10);
    assert.equal(trend[0].count,0);assert.equal(trend[0].average,null);
    assert.deepEqual(store.trends({days:7,room:'优选'}).map(x=>x.count),Array(7).fill(0));
  }finally{store.close();}
});
