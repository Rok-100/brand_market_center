import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

const source=await readFile(new URL('./public/modules/anchors/anchor-status-warning.js',import.meta.url),'utf8');
for(const [pathname,expected] of [
  ['/yxb/wis-marketing-hub/modules/live-room-management/modules/anchors/anchor-status-warning.html','/yxb/wis-marketing-hub/modules/live-room-management'],
  ['/fd-027340/live-center-workbench/modules/anchors/anchor-status-warning.html','/fd-027340/live-center-workbench'],
  ['/modules/anchors/anchor-status-warning.html',''],
])test('actual page requests use the enclosing live service: '+pathname,async()=>{
  const elements=new Map(),calls=[];
  const element=id=>{if(!elements.has(id))elements.set(id,{value:'',hidden:false,textContent:'',innerHTML:'',checked:false,add(){},addEventListener(){},classList:{toggle(){}}});return elements.get(id);};
  vm.runInNewContext(source,{location:{pathname,search:''},document:{getElementById:element,querySelectorAll:()=>[],addEventListener(){},hidden:false},Intl,Date,URLSearchParams,Option:function(){},
    setInterval(){},fetch:async url=>{calls.push(url);return{ok:false,json:async()=>({ok:false,error:'isolated fixture'})};}});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(calls.length,4);assert.ok(calls.every(url=>url.startsWith(expected+'/api/lifecycle/status-warning/')));
  assert.equal(calls[0],expected+'/api/lifecycle/status-warning/status');
});

for(const scenario of [{manage:true,hidden:false},{manage:false,hidden:false},{manage:true,hidden:true}])test('page only refreshes progress and never triggers the next model score: '+JSON.stringify(scenario),async()=>{
  const elements=new Map(),calls=[];let interval;
  const element=id=>{if(!elements.has(id))elements.set(id,{value:id==='days'?'7':'',hidden:false,textContent:'',innerHTML:'',checked:false,add(){},addEventListener(){},classList:{toggle(){}}});return elements.get(id);};
  vm.runInNewContext(source,{location:{pathname:'/modules/anchors/anchor-status-warning.html',search:''},document:{getElementById:element,querySelectorAll:()=>[],addEventListener(){},hidden:scenario.hidden},Intl,Date,URLSearchParams,Option:function(){},setInterval:fn=>{interval=fn;},
    fetch:async(url,options)=>{calls.push({url,options});let data={};if(url.endsWith('/status'))data={canManage:scenario.manage,ready:1,processing:false,notificationsEnabled:true};else if(url.includes('/summary?'))data={evaluated:0,average:null,warnings:0,pending:0,severe:0,queued:1,ready:1,distribution:[0,0,0,0],tasks:[]};else if(url.includes('/evaluations?')||url.includes('/trends?'))data=[];else if(url.endsWith('/models'))data=[{name:'qwen3.5-omni-flash',video:true}];return{ok:true,json:async()=>({ok:true,data})};}});
  await new Promise(resolve=>setImmediate(resolve));
  const sent=()=>calls.filter(x=>x.url.endsWith('/process'));assert.equal(sent().length,0);assert.equal(element('automatic').checked,false);await interval();assert.equal(sent().length,0);assert.equal(calls.filter(x=>x.url.endsWith('/automation')).length,0);
});


async function filterPage(){
  const elements=new Map();const calls=[];
  const element=id=>{if(!elements.has(id))elements.set(id,{value:id==='days'?'7':'',hidden:false,textContent:'',innerHTML:'',checked:false,listeners:{},add(){},addEventListener(type,fn){this.listeners[type]=fn;},classList:{toggle(){}},querySelectorAll(){return [];}});return elements.get(id);};
  const items=[
    {id:'normal',name:'正常主播',room:'优选',state:'scored',session:{start:'2026-10-06T01:00:00Z',end:'2026-10-06T03:00:00Z'},recording:{createdAt:'2026-10-06T01:08:00Z'},result:{total:89,reasons:[],compliance:{status:'clear',hits:[]}}},
    {id:'execution',name:'执行失败主播',room:'优选',state:'needs_review',session:{start:'2026-10-06T01:00:00Z',end:'2026-10-06T03:00:00Z'},sessionMatch:{state:'matched'},attempts:4,error:'下载、媒体处理或模型执行失败，将重试；达到重试上限后转人工。',recording:{createdAt:'2026-10-06T01:08:00Z'}},
    {id:'identity',name:'归属待核验主播',state:'needs_review',sessionMatch:{state:'unmatched'},error:'无法唯一核验场次',recording:{createdAt:'2026-10-06T01:08:00Z'}},
  ];
  vm.runInNewContext(source,{location:{pathname:'/modules/anchors/anchor-status-warning.html',search:''},document:{getElementById:element,querySelectorAll:()=>[],addEventListener(){},hidden:false},Intl,Date,URLSearchParams,Option:function(){},setInterval(){},fetch:async url=>{calls.push(url);let data={};if(url.endsWith('/status'))data={canManage:false,ready:0,processing:false,notificationsEnabled:true};else if(url.includes('/summary?'))data={evaluated:1,average:89,warnings:0,pending:2,severe:0,queued:0,distribution:[1,0,0,0],tasks:[]};else if(url.includes('/evaluations?'))data=items;else if(url.includes('/trends?'))data=[];return {ok:true,json:async()=>({ok:true,data})};}});
  await new Promise(resolve=>setImmediate(resolve));
  const card=index=>{const markup=element('abnormal').innerHTML.match(/<button\b[^>]*>/g)[index];const dataset=Object.fromEntries([...markup.matchAll(/data-([\w-]+)="([^"]*)"/g)].map(m=>[m[1],m[2]]));element('abnormal').listeners.click({target:{closest:()=>({dataset})}});};
  return {element,card,calls};
}

test('pending card toggles off and restores all rows without changing date or room',async()=>{
  const {element,card}=await filterPage();element('room').value='优选';const date=element('date').value;
  card(1);assert.ok(!element('rows').innerHTML.includes('data-detail="normal"'));
  card(1);assert.ok(element('rows').innerHTML.includes('data-detail="normal"'),'a second click must restore all rows');assert.equal(element('level').value,'');assert.equal(element('room').value,'优选');assert.equal(element('date').value,date);
});

test('pending categories select their own records and dropdown all clears the quick filter',async()=>{
  const {element,card}=await filterPage();card(1);
  assert.ok(element('rows').innerHTML.includes('data-detail="identity"'));assert.ok(!element('rows').innerHTML.includes('data-detail="execution"'));
  card(2);assert.ok(element('rows').innerHTML.includes('data-detail="execution"'));assert.ok(!element('rows').innerHTML.includes('data-detail="identity"'));
  element('level').value='';element('level').listeners.change();assert.ok(element('rows').innerHTML.includes('data-detail="normal"'));assert.ok(element('rows').innerHTML.includes('data-detail="identity"'));
});


test('explicit restore all clears both status and pending filters and reloads the original date and room',async()=>{
  const {element,card,calls}=await filterPage();element('room').value='优选';const date=element('date').value;card(2);element('state').value='needs_review';
  await element('clearFilters').listeners.click();assert.equal(element('state').value,'');assert.equal(element('level').value,'');assert.equal(element('clearFilters').hidden,true);assert.ok(element('rows').innerHTML.includes('data-detail="normal"'));
  const last=calls.filter(x=>x.includes('/evaluations?')).at(-1);const query=new URLSearchParams(last.split('?')[1]);assert.equal(query.get('room'),'优选');assert.equal(query.get('date'),date);assert.equal(query.get('state'),'');
});
