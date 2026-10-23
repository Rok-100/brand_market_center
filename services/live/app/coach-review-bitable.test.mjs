import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {buildBitableReview,readReviewRecords} from './coach-review-bitable.mjs';
import {coachReviewReminder} from './lifecycle-engine.mjs';
import {publicCoachReview} from './coach-review-store.mjs';
const now=new Date('2026-09-29T08:00:00Z');
const row=(id,name,room,day,title='复盘')=>({record_id:id,fields:{'主播':name,'所属直播间':room,'会议日期':Date.parse(day+'T00:00:00+08:00'),'会议主题':title,TODO:null}});
test('structured table fields determine names and rooms, not title name or coach roster',()=>{
 const a=row('1','潘小慧','官旗','2026-09-28','9.28官旗小慧场域复盘');
 const data=buildBitableReview([a,a,row('2','谷子晴','品牌精选','2026-09-24'),row('3','谷子晴','品牌精选','2026-09-28'),row('4','李安妮','品牌精选','2026-09-24'),row('5','林羽浠','官旗','2026-09-24','场域对齐')],'2026-09-29',now);
 assert.deepEqual(data.summary.rooms['官旗'].anchors.map(({name,count})=>({name,count})),[{name:'潘小慧',count:1}]);
 assert.equal(data.summary.rooms['品牌精选'].anchors.reduce((n,a)=>n+a.count,0),3);
 assert.equal(data.summary.matchedRecords,4);
 const notice=coachReviewReminder('官旗','教练',data.summary);assert.match(notice.text,/多维表格/);assert.doesNotMatch(notice.text,/日历/);
 assert.match(coachReviewReminder('优选','教练',data.summary).text,/暂无/);
 const wire=publicCoachReview(data);assert.equal(wire.source.type,'bitable');assert.ok(!JSON.stringify(wire).includes('record_id'));assert.ok(!JSON.stringify(wire).includes('reviewFingerprint'));
});
test('Shanghai performance-week boundaries and future meetings are respected',()=>{
 const records=['2026-09-22','2026-09-23','2026-09-29','2026-09-30'].map((date,i)=>row(String(i),'主播甲','官旗',date));
 records.push({...row('future','主播甲','官旗','2026-09-29'),fields:{...row('future','主播甲','官旗','2026-09-29').fields,'会议日期':Date.parse('2026-09-29T23:00:00+08:00')}});
 assert.equal(buildBitableReview(records,'2026-09-29',now).summary.matchedRecords,2);
});
test('missing dates and unknown room do not silently become zero',()=>{
 const a=row('1','甲','官旗','2026-09-28');a.fields['会议日期']=null;
 assert.throws(()=>buildBitableReview([a],'2026-09-29',now),/日期/);
 assert.throws(()=>buildBitableReview([row('2','甲','未知','2026-09-28')],'2026-09-29',now),/直播间/);
});
test('all pages use the exact view; duplicate IDs are not double counted',async()=>{
 const a=row('1','甲','官旗','2026-09-28'),b=row('2','乙','官旗','2026-09-28');let calls=0;
 const result=await readReviewRecords(async path=>{const url=new URL(path,'https://example.test');assert.equal(url.searchParams.get('view_id'),'vewWNgslaE');calls++;return calls===1?{items:[a],has_more:true,page_token:'next'}:{items:[a,b],has_more:false};});
 assert.equal(calls,2);assert.equal(result.length,2);
 await assert.rejects(readReviewRecords(async()=>({items:[],has_more:true,page_token:'repeat'})),/游标/);
 await assert.rejects(readReviewRecords(async()=>({items:[]})),/不完整/);
});
test('page labels show table-based counts, verified zero and stale status',async()=>{
 const context={module:{exports:{}},Date};vm.runInNewContext(await readFile(new URL('./public/modules/anchors/assets/coach-review-ui.js',import.meta.url),'utf8'),context);
 const api=context.module.exports,data=buildBitableReview([row('1','甲','官旗','2026-09-28')],'2026-09-29',now);
 assert.match(api.coachReviewLabel(api.normalizeCoachReview(data),'官旗','甲'),/^1 次/);
 assert.match(api.coachReviewLabel(api.normalizeCoachReview(data),'官旗','乙'),/^0 次/);
 assert.match(api.coachReviewLabel(api.normalizeCoachReview({...data,stale:true}),'官旗','甲'),/^上次抓取：1 次/);
});
