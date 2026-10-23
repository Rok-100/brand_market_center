import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {assistantSources,buildMonthlyRankings,evaluationMonth,chinaClock,readAssistantRecords,createAssistantRankings} from './assistant-rankings.mjs';
import {createAssistantRankingsHttp} from './assistant-rankings-http.mjs';
import {capturedAssistantGetter} from './assistant-rankings-fixture.mjs';
const row=(id,name,score,month='2026-09')=>({record_id:id,fields:{'直播助理':name,'汇总得分':score,'评价月份':month,'日期':Date.parse('2026-09-28T10:00:00+08:00')}});
async function harness(options={}){
 const directory=await mkdtemp(join(tmpdir(),'assistant-test-'));let clock=new Date('2026-10-09T15:59:00+08:00'),calls=0,failed=null;
 const records=[row('a','甲',100),row('b','甲',80),row('c','乙',60)];
 const get=async path=>{calls++;const source=assistantSources.find(s=>path.includes(s.base));if(source.id===failed)throw Error('denied');if(path.includes('/tables?'))return {items:[{table_id:source.table,revision:1}]};return {items:records,has_more:false};};
 const statePath=join(directory,'state.json');const service=createAssistantRankings({get,statePath,enabled:true,schedulerEnabled:true,now:()=>clock,...options});
 return {service,statePath,records,setClock:s=>clock=new Date(s),setFailed:s=>failed=s,calls:()=>calls};
}
test('average, month filtering, dedup, zero scores, competition ranking and ties',()=>{
 const data=buildMonthlyRankings([row('a','甲',100),row('b','甲',80),row('c','乙',90),row('d','丙',0),row('d','丙',0),row('e','旧月',100,'2026-08')],'2026-09');
 assert.deepEqual(data.entries.map(r=>r.rank),[1,1,3]);assert.equal(data.entries[0].score,90);assert.equal(data.entries[2].warning,true);assert.equal(data.entries[0].champion,true);
});
test('January submissions of December belong to previous year; blank templates ignored',()=>{
 assert.equal(evaluationMonth({'评价月份':'十二月','日期':Date.parse('2027-01-05T12:00:00+08:00')}),'2026-12');assert.equal(evaluationMonth({'评价月份':null}),null);assert.equal(chinaClock(new Date('2026-10-09T08:00:00Z')).minutes,960);
});
test('incomplete scores and empty source cannot replace valid data',()=>{
 assert.throws(()=>buildMonthlyRankings([row('a','甲',null)],'2026-09'),/未完成/);assert.throws(()=>buildMonthlyRankings([row('a','',95)],'2026-09'),/未完成/);assert.throws(()=>buildMonthlyRankings([],'2026-09'),/暂无有效/);
});
test('pagination loops and changing source revision are rejected',async()=>{
 const s=assistantSources[0];let revisions=0;
 await assert.rejects(readAssistantRecords(async p=>p.includes('/tables?')?{items:[{table_id:s.table,revision:++revisions}]}:{items:[row('a','甲',90)],has_more:false},s),/发生变化/);
 await assert.rejects(readAssistantRecords(async p=>p.includes('/tables?')?{items:[{table_id:s.table,revision:1}]}:{items:[],has_more:true,page_token:'same'},s),/游标/);
});
test('16:00 Beijing daily scheduler does not duplicate successful daily runs',async()=>{
 const h=await harness();await h.service.tick();assert.equal(h.calls(),0);h.setClock('2026-10-09T16:00:00+08:00');await h.service.tick();const n=h.calls();assert.equal((await h.service.view()).rooms[0].entries[0].score,90);h.setClock('2026-10-09T16:10:00+08:00');await h.service.tick();assert.equal(h.calls(),n);
});
test('20th closing snapshot persists through restart and is immutable after 21st',async()=>{
 const h=await harness();h.setClock('2026-10-20T16:00:00+08:00');await h.service.tick();const n=h.calls();h.records[0].fields['汇总得分']=10;h.setClock('2026-10-21T16:00:00+08:00');await h.service.tick();assert.equal(h.calls(),n);assert.equal((await h.service.view()).rooms[0].status,'final');assert.equal((await h.service.view()).rooms[0].entries[0].score,90);
 const again=createAssistantRankings({get:()=>{throw Error('unexpected source read');},statePath:h.statePath,now:()=>new Date('2026-10-22T16:00:00+08:00')});assert.equal((await again.view()).rooms[0].status,'final');
});
test('failure on closing day preserves scores and explicitly marks unconfirmed archive',async()=>{
 const h=await harness();h.setClock('2026-10-19T16:00:00+08:00');await h.service.tick();h.setFailed('flagship');h.setClock('2026-10-20T16:00:00+08:00');await h.service.tick();assert.equal((await h.service.view()).rooms[0].entries[0].score,90);h.setClock('2026-10-21T16:00:00+08:00');await h.service.tick();assert.equal((await h.service.view()).rooms[0].status,'archived_unconfirmed');assert.equal((await h.service.view()).rooms[1].status,'final');
});
test('partial failure retries only failed room',async()=>{
 const h=await harness();h.setFailed('flagship');h.setClock('2026-10-09T16:00:00+08:00');await h.service.tick();assert.equal((await h.service.view()).attempts[0].succeeded,3);const n=h.calls();h.setFailed(null);h.setClock('2026-10-09T16:10:00+08:00');await h.service.tick();assert.equal(h.calls()-n,3);assert.equal((await h.service.view()).attempts[0].succeeded,4);
});
test('month rollover targets previous month; historical imports retain explicit provenance',async()=>{
 const h=await harness();h.records.push(row('old','历史甲',85,'2026-08'));h.setClock('2026-10-09T16:00:00+08:00');await h.service.tick();assert.equal((await h.service.view('2026-08')).rooms[0].status,'historical_import');h.records.splice(0,h.records.length,row('new','新月',75,'2026-10'));h.setClock('2026-11-01T16:00:00+08:00');await h.service.tick();assert.equal((await h.service.view()).month,'2026-10');assert.equal((await h.service.view()).rooms[0].entries[0].name,'新月');assert.equal((await h.service.view('2026-09')).rooms[0].entries[0].score,90);
});
test('readonly mode disables source reads; CSRF guards block mutation',async()=>{
 const h=await harness({readOnly:true});h.setClock('2026-10-09T16:00:00+08:00');await h.service.tick();assert.equal(h.calls(),0);await assert.rejects(h.service.sync(),e=>e.status===423);let result;
 const http=createAssistantRankingsHttp({service:h.service,json:(res,status,body)=>result={status,body}});await http({method:'POST',headers:{}},{},new URL('http://local/api/assistant-rankings/sync'),'/api/assistant-rankings/sync');assert.equal(result.status,403);await http({method:'POST',headers:{'x-requested-with':'XMLHttpRequest',origin:'http://bad',host:'local'}},{},new URL('http://local/api/assistant-rankings/sync'),'/api/assistant-rankings/sync');assert.equal(result.status,403);
});
test('real readonly capture matches flagship dashboard; all four sources normalize',{skip:!process.env.ASSISTANT_TEST_CAPTURE},async()=>{
 const capture=await capturedAssistantGetter(process.env.ASSISTANT_TEST_CAPTURE);const records=await readAssistantRecords(capture.get,assistantSources[0]);assert.deepEqual(buildMonthlyRankings(records,'2026-09').entries.map(r=>r.score),[99.0625,96.5625,94.375,94.0625,93.4375,92.1875,91.25]);for(const source of assistantSources){const rows=await readAssistantRecords(capture.get,source);assert(buildMonthlyRankings(rows,'2026-09').entries.length>0);}
});
