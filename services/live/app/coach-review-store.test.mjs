import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {createCoachReviewStore} from './coach-review-store.mjs';
import {countCoachReviews,reviewWeekFor} from './lifecycle-engine.mjs';
const require=createRequire(import.meta.url);
// The browser file exposes a CommonJS contract; evaluate without a document.
import vm from 'node:vm';
const context={module:{exports:{}},Date};
vm.runInNewContext(await readFile(new URL('./public/modules/anchors/assets/coach-review-ui.js',import.meta.url),'utf8'),context);
const ui=context.module.exports;
const date='2026-09-29',week=reviewWeekFor(date);
const rotation={status:'ready',week,rooms:{'官旗':['测试甲'],'品牌精选':[],'优选':[],'王鸥美肤':[]}};
function snapshot(count=1){return {date,checkedAt:new Date('2026-09-29T05:00:00Z').toISOString(),rotation,summary:{status:'ready',week,rooms:Object.fromEntries(Object.entries(rotation.rooms).map(([room,names])=>[room,{status:'ready',anchors:names.map(name=>({name,count}))}]))},calendarStatus:Object.fromEntries(Object.keys(rotation.rooms).map(room=>[room,{status:'已读取'}])),source:{spreadsheetToken:'must-not-persist'}};}
async function fixture(t,load){const directory=await mkdtemp(join(tmpdir(),'coach-review-test-'));t.after(()=>rm(directory,{recursive:true,force:true}));return {directory,store:createCoachReviewStore({directory,load,now:()=>Date.parse('2026-09-29T05:00:30Z'),write:process.platform==='win32'?(path,data)=>writeFile(path,JSON.stringify(data)):undefined})};}
test('notification capture persists same counts for page and survives process restart without private source',async t=>{
 let calls=0;const value=snapshot(3);Object.defineProperty(value,'calendarFingerprints',{value:{secret:'private'}});
 const {store,directory}=await fixture(t,async()=>{calls++;return value;});
 assert.equal((await store.refresh(date)).calendarFingerprints.secret,'private');
 const page=await store.get(date);assert.equal(page.summary.rooms['官旗'].anchors[0].count,3);assert.equal(calls,1);
 const disk=await readFile(join(directory,`coach-review-bitable-${week.start}.json`),'utf8');assert.ok(!disk.includes('must-not-persist'));assert.ok(!disk.includes('calendarFingerprints'));
 const restart=createCoachReviewStore({directory,load:()=>{throw Error('offline')},now:()=>Date.parse('2026-09-29T05:00:30Z')});
 assert.equal((await restart.get(date)).summary.rooms['官旗'].anchors[0].count,3);
 assert.match(ui.coachReviewLabel(ui.normalizeCoachReview(page),'官旗','测试甲'),/^3 次/);
});
test('force refresh replaces totals, failed refresh is labeled stale, next week never reuses old totals',async t=>{
 let fail=false,count=1;const {store}=await fixture(t,async()=>{if(fail)throw Error('offline');return snapshot(count);});
 await store.refresh(date);count=2;assert.equal((await store.get(date,{force:true})).summary.rooms['官旗'].anchors[0].count,2);
 fail=true;const old=await store.get(date,{force:true});assert.equal(old.stale,true);assert.match(ui.coachReviewLabel(ui.normalizeCoachReview(old),'官旗','测试甲'),/^上次抓取：2 次/);
 await assert.rejects(store.get('2026-09-30'),/offline/);
});
test('concurrent readers share one capture and unavailable room is never rendered as zero',async t=>{
 let calls=0;const value=snapshot();value.calendarStatus['官旗']={status:'待核验'};value.summary.rooms['官旗']={status:'pending',anchors:[]};
 const {store}=await fixture(t,async()=>{calls++;await new Promise(resolve=>setTimeout(resolve,20));return value;});
 const results=await Promise.all([store.refresh(date),store.refresh(date),store.refresh(date)]);assert.equal(calls,1);
 assert.match(ui.coachReviewLabel(ui.normalizeCoachReview(results[0]),'官旗','测试甲'),/^待核验/);
});
test('calendar count excludes duplicates, cancellation, future, other week and ambiguous names',()=>{
 const event={eventId:'one',summary:'测试甲复盘',date,startAt:'2026-09-29T09:00:00+08:00',status:'confirmed'};
 const events=[event,event,{...event,eventId:'cancel',status:'cancelled'},{...event,eventId:'future',startAt:'2026-09-29T23:00:00+08:00'},{...event,eventId:'old',date:'2026-09-22'},{...event,eventId:'other',summary:'测试甲乙复盘'}];
 const result=countCoachReviews(rotation,{'官旗':events,'品牌精选':[],'优选':[],'王鸥美肤':[]},new Date('2026-09-29T05:00:00Z'));
 assert.equal(result.rooms['官旗'].anchors[0].count,1);
});
test('actual room-prefixed review titles count without weakening personal-name boundaries',()=>{
 const rooms={'官旗':[],'品牌精选':['李安妮','王思佳','谷子晴','林羽浠'],'优选':[],'王鸥美肤':['李凯彤']};
 const make=(summary,index)=>({eventId:String(index),summary,date:'2026-09-28',startAt:'2026-09-28T07:00:00Z',status:'confirmed'});
 const events={'官旗':[],'优选':[],'品牌精选':['品牌精选李安妮复盘','品牌精选王思佳复盘','品牌精选谷子晴复盘','品牌精选林羽浠复盘','品牌精选谷子晴复盘','品牌精选李安妮娜复盘','其他人李安妮复盘','品牌精选李安妮、王思佳复盘'].map(make),'王鸥美肤':['主播李凯彤复盘','王鸥美肤李凯彤复盘'].map(make)};
 const result=countCoachReviews({...rotation,rooms},events,new Date('2026-09-29T06:00:00Z'));
 assert.deepEqual(result.rooms['品牌精选'].anchors.map(a=>a.count),[1,1,2,1]);
 assert.equal(result.rooms['王鸥美肤'].anchors[0].count,2);
});
