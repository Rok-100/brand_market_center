import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

const script=await readFile(new URL('./public/modules/anchors/anchor-status-warning.js',import.meta.url),'utf8');
test('failed matched rows expose manual model retry; one click posts once and refreshes the server queue',async()=>{
  const elements=new Map(),listeners={},posts=[];let release;
  const row=(id,state,result,session)=>({id,name:id,room:'官旗',state,result,session,recording:{createdAt:'2026-10-07T01:00:00Z'}});
  const session={start:'2026-10-07T00:00:00Z',end:'2026-10-07T02:00:00Z'};
  const rows=[row('failed','needs_review',null,session),row('success','scored',{total:80,reasons:[],compliance:{status:'clear',hits:[]}},session),row('unknown','needs_review',null,null),row('ignored','ignored',null,session)];
  const element=id=>{if(!elements.has(id))elements.set(id,{value:id==='days'?'7':'',checked:false,hidden:false,innerHTML:'',textContent:'',add(){},addEventListener(){},querySelectorAll(){return [];},classList:{toggle(){}}});return elements.get(id);};
  const held=new Promise(resolve=>release=resolve);
  vm.runInNewContext(script,{location:{pathname:'/modules/anchors/anchor-status-warning.html',search:''},document:{getElementById:element,querySelectorAll:()=>[],addEventListener:(name,fn)=>listeners[name]=fn,hidden:false},Date,Intl,URLSearchParams,Option:function(){},setInterval(){},fetch:async(url,options)=>{
    let data={};
    if(options?.method==='POST'){posts.push({url,options});await held;rows[0].state='queued';rows[0].manualRetry={requestedAt:'now'};data={state:'queued'};}
    else if(url.endsWith('/status'))data={canManage:true,currentUser:{name:'当前登录用户',number:'FD-001'},ready:0,notificationsEnabled:true,automation:{enabled:true}};
    else if(url.includes('/summary?'))data={distribution:[1,0,0,0],tasks:[],pending:2};
    else if(url.includes('/evaluations?'))data=rows;
    else if(url.includes('/trends?')||url.endsWith('/models'))data=[];
    return {ok:true,json:async()=>({ok:true,data})};
  }});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(element('currentUserName').textContent,'当前登录用户');assert.equal(element('currentUserAvatar').textContent,'当');
  assert.match(element('rows').innerHTML,/data-retry="failed"/);for(const id of ['success','unknown','ignored'])assert.ok(!element('rows').innerHTML.includes('data-retry="'+id+'"'));
  const button={dataset:{retry:'failed'},disabled:false};const event={target:{closest:()=>button}};
  const pending=listeners.click(event);await listeners.click(event);assert.equal(posts.length,1);assert.equal(button.disabled,true);
  assert.equal(posts[0].url,'/api/lifecycle/status-warning/evaluations/failed/retry');assert.equal(posts[0].options.headers['X-Requested-With'],'XMLHttpRequest');
  release();await pending;assert.match(element('rows').innerHTML,/重试已排队/);assert.ok(!element('rows').innerHTML.includes('data-retry="failed"'));
});
