import { test } from 'node:test';
import assert from 'node:assert/strict';
import { priceRows, cycleStart, moneyText, pointUnits } from './libtv-cost-pricing.mjs';
import { filtersFrom, summarize, createLibtvPointsSource, createMysqlReader } from './libtv-points-source.mjs';
const record=(id,date,points,member='A',model='M')=>({id:String(id),consumedAt:date+' 10:00:00.000',points,team_member:member,model_name:model});
const filter=(p={})=>filtersFrom(new URLSearchParams({startDate:'2026-10-16',endDate:'2026-10-20',...p}));
const source={mode:'mysql'};
const result=(rows,p={})=>summarize(priceRows(rows,'2026-05-28'),filter(p),source);

test('billing boundaries handle 15/16 and year rollover',()=>{
 assert.equal(cycleStart('2026-10-15'),'2026-09-16');assert.equal(cycleStart('2026-10-16'),'2026-10-16');assert.equal(cycleStart('2026-01-01'),'2025-12-16');
});
test('threshold record splits shared quota: 130000 then 5000 costs 143.00',()=>{
 const r=result([record(1,'2026-10-16','130000'),record(2,'2026-10-17','5000','B')],{team_member:'B'});
 assert.equal(r.summary.estimatedAmount,'143.00');assert.equal(r.summary.consumed,5000);
});
test('model filtering preserves global prior usage',()=>{
 const r=result([record(1,'2026-10-16','130000','A','M1'),record(2,'2026-10-17','5000','B','M2')],{model_name:'M2'});
 assert.equal(r.summary.estimatedAmount,'143.00');
});
test('display start does not reset the pricing-cycle history',()=>{
 const r=result([record(1,'2026-10-16','132000'),record(2,'2026-10-20','5000','B')],{startDate:'2026-10-20'});
 assert.equal(r.summary.estimatedAmount,'175.00');
});
test('new 16th resets quota to make 5000 points cost 95.00',()=>{
 const r=result([record(1,'2026-10-15','200000'),record(2,'2026-10-16','5000')]);assert.equal(r.summary.estimatedAmount,'95.00');
});
test('same timestamp is ordered by numeric id, not lexicographic id',()=>{
 const rows=[record(10,'2026-10-16','5000','B'),record(2,'2026-10-16','130000')];assert.equal(result(rows,{team_member:'B'}).summary.estimatedAmount,'143.00');
});
test('zero points and empty days retain zero estimated money',()=>{
 const r=result([record(1,'2026-10-16','0')]);assert.equal(r.summary.estimatedAmount,'0.00');assert.equal(r.summary.transactionCount,1);assert.equal(r.series[4].estimatedAmount,'0.00');
 assert.equal(result([]).summary.estimatedAmount,'0.00');
});
test('exact decimal costs aggregate before rounding',()=>{
 const r=result([record(1,'2026-10-16','0.1'),record(2,'2026-10-16','0.1'),record(3,'2026-10-16','0.1')]);
 assert.equal(r.summary.consumedExact,'0.3000');assert.equal(r.summary.estimatedAmount,'0.01');assert.equal(r.series[0].estimatedAmount,'0.01');
});
test('period total uses unrounded values, independently of daily rounding',()=>{
 const r=result([record(1,'2026-10-16','0.2'),record(2,'2026-10-17','0.2')]);
 assert.equal(r.series[0].estimatedAmount,'0.00');assert.equal(r.series[1].estimatedAmount,'0.00');assert.equal(r.summary.estimatedAmount,'0.01');
});
test('partial first cycle shows unknown money while retaining points',()=>{
 const r=result([record(1,'2026-05-28','5000')],{startDate:'2026-05-28',endDate:'2026-05-28'});
 assert.equal(r.summary.estimatedAmount,null);assert.equal(r.summary.consumed,5000);assert.equal(r.pricing.complete,false);assert.deepEqual(r.pricing.incompleteCycles,['2026-05-16']);
});
test('no match is zero even inside an incomplete cycle',()=>{
 const r=result([record(1,'2026-05-28','5000')],{startDate:'2026-05-28',endDate:'2026-05-28',team_member:'nobody'});assert.equal(r.summary.estimatedAmount,'0.00');
});
test('invalid signed consumption and duplicate rows fail instead of estimating',()=>{
 assert.throws(()=>pointUnits('-1'));assert.throws(()=>pointUnits('0.00001'));const r=record(1,'2026-10-16','1');assert.throws(()=>priceRows([r,r]));
});
test('large decimal values and half-up rounding remain exact',()=>{
 assert.equal(pointUnits('9999999999999999.9999'),99999999999999999999n);assert.equal(moneyText(50000n),'0.01');assert.equal(moneyText(149999n),'0.01');assert.equal(moneyText(150000n),'0.02');
});
test('MySQL reads from cycle start in a read-only transaction',async()=>{
 const calls=[];const conn={query:async s=>{calls.push(s);return [[{firstAt:'2026-05-28',lastAt:'2026-10-18'}]]},beginTransaction:async()=>calls.push('BEGIN'),execute:async(s,p)=>{calls.push(p);return [[]]},rollback:async()=>calls.push('ROLLBACK'),release:()=>calls.push('RELEASE'),destroy:()=>assert.fail('unexpected destroy')};
 const reader=createMysqlReader({env:{ROOT_MYSQL_HOST:'x',ROOT_MYSQL_USER:'x',ROOT_MYSQL_PASSWORD:'x'},loadDriver:async()=>({createPool:()=>({getConnection:async()=>conn,end:async()=>{}})})});
 await reader(filter({startDate:'2026-10-10'}));assert.ok(calls.includes('SET TRANSACTION READ ONLY'));assert.deepEqual(calls[4],['2026-09-16 00:00:00','2026-10-21 00:00:00']);await reader.close();
});
test('source errors never become zero charts and refresh recalculates historical rows',async()=>{
 let calls=0;const load=createLibtvPointsSource({env:{},query:async()=>{calls++;if(calls===1)throw Error('offline');return {historyStart:'2026-05-28',rows:[record(1,'2026-10-16',calls===2?'5000':'6000')]}}});
 await assert.rejects(load(filter()),/offline/);assert.equal((await load(filter())).summary.estimatedAmount,'95.00');assert.equal((await load(filter(),true)).summary.estimatedAmount,'114.00');
});
