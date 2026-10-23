import test from 'node:test';
import assert from 'node:assert/strict';
import {selectMonthlySheet,lastDailyGmv} from '../app/api/_lib/monthly-gmv.ts';
test('select exact subtable names and never pick an old table or copy',()=>{
 const sheets=[{title:'品牌精选（副本）',sheet_id:'wrong'},{title:'品牌精选',sheet_id:'right'},{title:'官旗数据（2.23后）',sheet_id:'official'},{title:'官方旗舰店数据',sheet_id:'old'}];
 assert.equal(selectMonthlySheet(sheets,'brand-selection').sheet_id,'right');assert.equal(selectMonthlySheet(sheets,'guanqi').sheet_id,'official');
 assert.throws(()=>selectMonthlySheet(sheets,'wangou'));assert.throws(()=>selectMonthlySheet([...sheets,sheets[1]],'brand-selection'));
});
test('last populated row, not max, increment, refund deduction, or sum of snapshots',()=>{
 assert.deepEqual(lastDailyGmv([[null,1000,50],[null,900,60],[null,null]],1,20),{gmv:900,sourceRow:21});
 assert.deepEqual(lastDailyGmv([[null,10],[null,0],[null,' ']],1,10),{gmv:0,sourceRow:11});
});
test('blank or invalid last value is unavailable and does not fall back to older amount',()=>{
 assert.deepEqual(lastDailyGmv([[null,null]],1,1),{gmv:null,sourceRow:null});
 for(const value of ['#REF!','未填写','-50'])assert.deepEqual(lastDailyGmv([[null,20],[null,value]],1,10),{gmv:null,sourceRow:11});
});
test('parse formatted amounts and current-day incomplete blocks',()=>{
 assert.equal(lastDailyGmv([[null,'￥1,234.56'],[null,null]],1,1).gmv,1234.56);
 assert.equal(lastDailyGmv([[null,'2.5万']],1,1).gmv,25000);
 assert.equal(lastDailyGmv([[null,100],[null,210],[null,null],[null,null]],1,1).sourceRow,2);
});
