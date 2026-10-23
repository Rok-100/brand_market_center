import test from 'node:test';
import assert from 'node:assert/strict';
import {scheduleSessions} from './live-session-flow.mjs';
import {nextDayDirectMessage,currentNextDayGroup} from './live-next-day.mjs';
const now=Date.parse('2026-09-28T06:00:00Z'),date='2026-09-29';
const people=[{name:'谷子晴',number:'g'},{name:'邓淑环',number:'d'},{name:'刘睿',number:'l'},{name:'刘诗雨',number:'a'}].map(x=>({...x,active:true,center:'直播中心',workflowEnabled:false,modules:[]}));
const participants={verified:n=>people.find(p=>p.number===n),canOwn:n=>!!people.find(p=>p.number===n)};
const raw=(name,roomCode='wangou')=>({date,updatedAt:new Date(now).toISOString(),source:{mode:'official_live',verified:true,spreadsheetToken:'EuYqssm4WhNwAvtyybKcDdk1ned'},sourceStatus:{[roomCode]:{found:true,revision:5,sheetId:'PhlV42'}},rooms:[{code:roomCode,name:'王鸥美肤',anchors:[['08:00','10:00',name]],assistants:[['07:00','11:00','刘诗雨']]}]});
test('two verified support labels resolve to exact existing identities',()=>{
 for(const [label,number] of [['谷子晴（支援）','g'],['邓淑环（借调）','d']])assert.equal(scheduleSessions(raw(label),date,people,now,participants)[0].anchor,number);
});
test('arbitrary labels and other rooms do not inherit an alias',()=>{
 assert.throws(()=>scheduleSessions(raw('谷子晴（其他）'),date,people,now,participants));
 assert.throws(()=>scheduleSessions(raw('谷子晴（支援）','guanqi'),date,people,now,participants));
});
test('inactive or missing recipient still blocks notification',()=>{
 assert.throws(()=>scheduleSessions(raw('谷子晴（支援）'),date,people.filter(p=>p.number!=='g'),now,participants));
});
test('reminder uses original assistant shift and actual overlap',()=>{
 const slot=scheduleSessions(raw('谷子晴（支援）'),date,people,now,participants)[0];
 const text=nextDayDirectMessage(slot,'a','assistant','刘诗雨');assert.match(text,/07:00-11:00/);assert.match(text,/08:00-10:00/);assert.match(text,/9月29日/);
});
test('group confirmed message cannot precede 16:00 or bypass missing receipts',()=>{
 assert.equal(currentNextDayGroup({kind:'live_tomorrow_group_confirmed',businessDate:date,related:[]},{tasks:[]},now),false);
 assert.equal(currentNextDayGroup({kind:'live_tomorrow_group_confirmed',businessDate:date,related:[{taskId:'missing'}]},{tasks:[]},now+4*3600000),false);
});
