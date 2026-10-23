import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

const script=await readFile(new URL('./public/modules/anchors/anchor-status-warning.js',import.meta.url),'utf8');
test('detail opens immediately, restores video preview and ignores responses after close or a later selection',async()=>{
  const elements=new Map(),listeners={},requests=[];
  const row=id=>({id,name:id,room:'官旗',state:'queued',result:null,session:{start:'2026-10-07T00:00:00Z',end:'2026-10-07T02:00:00Z'},recording:{name:'clip.mov',createdAt:'2026-10-07T01:00:00Z',messageId:id,resourceKey:'file-'+id,thumbnailKey:'image-'+id}});
  const element=id=>{if(!elements.has(id))elements.set(id,{value:id==='days'?'7':'',checked:false,hidden:false,open:false,innerHTML:'',textContent:'',handlers:{},add(){},addEventListener(name,fn){this.handlers[name]=fn;},showModal(){this.open=true;},close(){this.open=false;this.handlers.close?.();},querySelector(){return id==='detail'?null:{append(){}};},querySelectorAll(){return [];},classList:{toggle(){}}});return elements.get(id);};
  vm.runInNewContext(script,{location:{pathname:'/modules/anchors/anchor-status-warning.html',search:''},document:{getElementById:element,querySelectorAll:()=>[],addEventListener:(name,fn)=>listeners[name]=fn,hidden:false},Date,Intl,URLSearchParams,Option:function(){},setInterval(){},fetch:async(url)=>{
    let data={};
    if(/\/evaluations\/[^/?]+$/.test(url))return new Promise(resolve=>requests.push({url,resolve:data=>resolve({ok:true,json:async()=>({ok:true,data})})}));
    if(url.endsWith('/status'))data={canManage:false,ready:0,notificationsEnabled:true,automation:{enabled:true}};
    else if(url.includes('/summary?'))data={distribution:[0,0,0,0],tasks:[]};
    else if(url.includes('/evaluations?'))data=[row('甲'),row('乙')];
    else if(url.includes('/trends?'))data=[];
    return {ok:true,json:async()=>({ok:true,data})};
  }});
  await new Promise(resolve=>setImmediate(resolve));
  const click=id=>listeners.click({target:{closest:()=>({dataset:{detail:id}})}});
  const first=click('甲');assert.equal(element('detail').open,true);assert.match(element('detailBody').innerHTML,/正在读取评分详情/);
  element('detail').close();requests[0].resolve(row('甲'));await first;assert.equal(element('detail').open,false);
  const stale=click('甲'),latest=click('乙');requests[2].resolve(row('乙'));await latest;
  assert.match(element('detailTitle').textContent,/乙/);assert.match(element('detailBody').innerHTML,/preload="metadata"/);assert.match(element('detailBody').innerHTML,/poster="[^"]+type=image"/);
  requests[1].resolve(row('甲'));await stale;assert.match(element('detailTitle').textContent,/乙/);
});

test('anchor total-score chart keeps individual sessions in time order and does not invent missing scores',async()=>{
  const result=total=>({total,visual:45,audio:45,trialPassed:true,dimensions:[{name:'眼神交流',score:9,evidence:'实际证据',improvement:'继续保持'}],highlights:[],improvements:[],reasons:[],compliance:{status:'clear',hits:[]}});
  const history=(id,start,total)=>({id,date:start.slice(0,10),room:'官旗',session:{start},completedAt:'2026-10-07T01:00:00Z',result:result(total)});
  const cases=[
    {history:[history('last','2026-10-06T10:00:00+08:00',100),history('same-day','2026-10-05T10:00:00+08:00',89),history('first','2026-10-05T08:00:00+08:00',0),history('missing','2026-10-04T08:00:00+08:00',null)],expected:[['first','0'],['same-day','89'],['last','100']]},
    {history:[history('single','2026-10-05T08:00:00+08:00',90)],expected:[['single','90']]},
    {history:[],expected:[]}
  ];
  for(const fixture of cases){
    const elements=new Map(),listeners={};
    const element=id=>{if(!elements.has(id))elements.set(id,{value:id==='days'?'7':'',innerHTML:'',textContent:'',open:false,add(){},addEventListener(){},showModal(){this.open=true;},querySelector(){return id==='detail'?null:{append(){}};},querySelectorAll(){return [];},classList:{toggle(){}}});return elements.get(id);};
    const row={id:'selected',name:'甲',room:'官旗',state:'scored',result:result(90),recording:{name:'clip.mov',messageId:'om_clip',resourceKey:'file_clip'},history:fixture.history};
    vm.runInNewContext(script,{location:{pathname:'/modules/anchors/anchor-status-warning.html',search:''},document:{getElementById:element,querySelectorAll:()=>[],addEventListener:(name,fn)=>listeners[name]=fn,hidden:false},Date,Intl,URLSearchParams,Option:function(){},setInterval(){},fetch:async url=>{
      const data=url.endsWith('/evaluations/selected')?row:url.endsWith('/status')?{notificationsEnabled:true}:url.includes('/summary?')?{distribution:[0,0,0,0],tasks:[]}:[];
      return {ok:true,json:async()=>({ok:true,data})};
    }});
    await new Promise(resolve=>setImmediate(resolve));await listeners.click({target:{closest:()=>({dataset:{detail:'selected'}})}});
    const html=element('detailBody').innerHTML,points=[...html.matchAll(/data-history-point="([^"]*)" data-score="([^"]*)"/gu)].map(match=>[match[1],match[2]]);
    assert.deepEqual(points,fixture.expected);
    if(!fixture.expected.length)assert.match(html,/暂无已评分场次/);
    else{assert.match(html,/总分折线图/);assert.match(html,/预警线 65/);}
    if(fixture.expected.length===1)assert.match(html,/当前仅 1 条记录/);
  }
});
