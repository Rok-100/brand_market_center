import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer as httpServer} from 'node:http';
import {createServer as netServer} from 'node:net';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
test('member A uploads, member B sees and downloads every library; cue upload survives reload and restore',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'shared-materials-'));
 for(const [name,value] of Object.entries({'material-assets.json':{assets:[],folders:[]},'material-cards.json':{cards:[],deletedCards:[]},'material-links.json':{links:[]},'communication-drafts.json':{drafts:[]}}))await writeFile(join(dir,name),JSON.stringify(value));
 const authority=httpServer((req,res)=>{const who=req.headers['x-oa-token'];res.setHeader('Content-Type','application/json');if(!['fixture-a','fixture-b'].includes(who)){res.writeHead(401);return res.end('{}')}res.end(JSON.stringify({user:{number:who,realName:who==='fixture-a'?'验收成员甲':'验收成员乙'},permissions:{},access:{allowed_modules:['live-room-management']}}))});
 await new Promise(r=>authority.listen(0,'127.0.0.1',r));const authPort=authority.address().port;
 const listener=netServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));const port=listener.address().port;await new Promise(r=>listener.close(r));
 const child=spawn(process.execPath,['server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),DATA_DIR:dir,BASE_PATH:'/test/live',HUB_SAME_ORIGIN_EMBED:'true',CENTRAL_AUTHORITY_BASE:'http://127.0.0.1:'+authPort+'/api',CENTRAL_AUTHORITY_FALLBACK_BASE:'',RECOVERY_READ_ONLY:'0',LIFECYCLE_SCHEDULER_ENABLED:'0',LIFECYCLE_REMINDERS_ENABLED:'false',LIFECYCLE_REMINDER_LEADER:'false',FEISHU_APP_ID:'',FEISHU_APP_SECRET:'',MINIMAX_API_KEY:'',JUMP_LLM_TOKEN:'',COMMUNICATION_AI_CONFIG_PATH:join(dir,'absent.json')},stdio:'ignore'});
 const base='http://127.0.0.1:'+port+'/test/live';
 async function api(path,who='fixture-b',body,method=body?'POST':'GET'){const r=await fetch(base+path,{method,headers:{'X-OA-Token':who,'Content-Type':'application/json','X-Requested-With':'XMLHttpRequest'},body:body?JSON.stringify(body):undefined});const b=await r.json();assert.equal(r.status,200,JSON.stringify(b));return b;}
 try{
  let ready=false;for(let n=0;n<70;n++){try{if((await fetch('http://127.0.0.1:'+port+'/healthz')).ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,100))}assert.equal(ready,true);
  assert.ok(Array.isArray((await api('/api/material-cards')).deletedCards),'cue list must include deletedCards so actual UI can load');
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');
  let cue;
  for(const kind of ['communication','competitor','prohibited-word','visual','cue-card']){
   const bytes=kind==='cue-card'?png:Buffer.from('shared '+kind),name=kind==='cue-card'?'手卡.png':'资料.txt';
   const saved=await api('/api/material-assets','fixture-a',{kind,name,dataUrl:'data:;base64,'+bytes.toString('base64'),category:'验收',folder:kind==='visual'?'品牌色平销':''});
   const list=await api('/api/material-assets');assert.ok(list.assets.some(x=>x.id===saved.asset.id&&x.createdBy==='验收成员甲'));
   const download=await fetch('http://127.0.0.1:'+port+saved.asset.url+'?download=1',{headers:{'X-OA-Token':'fixture-b'}});assert.equal(download.status,200);assert.deepEqual(Buffer.from(await download.arrayBuffer()),bytes);
   if(kind==='cue-card')cue=(await api('/api/material-cards','fixture-a',{title:'共享手卡',category:'验收',room:'官旗',cover:saved.asset.url})).card;
  }
  assert.ok((await api('/api/material-cards')).cards.some(x=>x.id===cue.id));
  await api('/api/material-cards/'+cue.id,'fixture-a',{expectedVersion:cue.version},'DELETE');
  const archived=(await api('/api/material-cards')).deletedCards.find(x=>x.id===cue.id);assert.ok(archived);
  await api('/api/material-cards/'+cue.id+'/restore','fixture-b',{expectedVersion:archived.version,expectedDeletedAt:archived.deletedAt});
  assert.ok((await api('/api/material-cards')).cards.some(x=>x.id===cue.id));
  for(const kind of ['communication','competitor','prohibited']){await api('/api/material-links','fixture-a',{kind,title:'共享飞书链接',url:'https://jqx28l0j4lx.feishu.cn/docx/test'+kind});assert.ok((await api('/api/material-links')).links.some(x=>x.kind===kind));}
  await api('/api/script-generator/save','fixture-a',{id:'shared-fixture',product:'验收',fullScript:'成员甲的测试稿件'});assert.ok((await api('/api/script-generator/drafts')).drafts.some(x=>x.id==='shared-fixture'));
  assert.equal((await fetch(base+'/api/material-assets')).status,401);
 }finally{child.kill('SIGTERM');await new Promise(r=>child.once('exit',r));await new Promise(r=>authority.close(r));await rm(dir,{recursive:true,force:true})}
});
