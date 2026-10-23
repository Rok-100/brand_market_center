import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
test('real server upload/list/open/download/dedup for all five material kinds',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'materials-http-'));
 const listener=createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));const port=listener.address().port;await new Promise(r=>listener.close(r));
 for(const [name,value] of Object.entries({'material-assets.json':{assets:[],folders:[]},'material-cards.json':{cards:[],deletedCards:[]},'material-links.json':{links:[]}}))await writeFile(join(dir,name),JSON.stringify(value));
 const child=spawn(process.execPath,['server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),DATA_DIR:dir,BASE_PATH:'/test/live',HUB_SAME_ORIGIN_EMBED:'false',RECOVERY_READ_ONLY:'0',LIFECYCLE_SCHEDULER_ENABLED:'0',LIFECYCLE_REMINDERS_ENABLED:'false',LIFECYCLE_REMINDER_LEADER:'false',FEISHU_APP_ID:'',FEISHU_APP_SECRET:'',MINIMAX_API_KEY:'',JUMP_LLM_TOKEN:'',COMMUNICATION_AI_CONFIG_PATH:join(dir,'absent.json')},stdio:'ignore'});
 const base='http://127.0.0.1:'+port+'/test/live';
 try{
  let ready=false;for(let n=0;n<60;n++){try{if((await fetch('http://127.0.0.1:'+port+'/healthz')).ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,100))}assert.equal(ready,true);
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');
  for(const kind of ['communication','competitor','prohibited-word','visual','cue-card']){
   const content=kind==='cue-card'?png:Buffer.from('material roundtrip fixture '+kind),name=kind==='cue-card'?'验收手卡.png':'验收资料.txt';
   const payload={kind,name,category:'验收',folder:kind==='visual'?'品牌色平销/验收':'',dataUrl:'data:;base64,'+content.toString('base64')};
   const post=()=>fetch(base+'/api/material-assets',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
   const response=await post(),b=await response.json();assert.equal(response.status,200,JSON.stringify(b));assert.equal(b.asset.kind,kind);assert.match(b.asset.url,/^\/test\/live\/api\/material-assets\/[a-f0-9]{24}$/);
   const file=await fetch('http://127.0.0.1:'+port+b.asset.url);assert.equal(file.status,200);assert.deepEqual(Buffer.from(await file.arrayBuffer()),content);
   const download=await fetch('http://127.0.0.1:'+port+b.asset.url+'?download=1');assert.match(download.headers.get('content-disposition'),/^attachment;/);await download.arrayBuffer();
   assert.equal((await (await post()).json()).deduplicated,true);
   if(kind==='cue-card'){
    const card=await fetch(base+'/api/material-cards',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title:'验收手卡',room:'官旗',category:'验收',cover:b.asset.url,status:'draft'})});assert.equal(card.status,200,await card.text());
   }
  }
  const listing=await (await fetch(base+'/api/material-assets')).json();assert.equal(listing.assets.length,5);
  const target=listing.assets.find(x=>x.kind==='prohibited-word');
  const remove=(id,headers={'X-Requested-With':'XMLHttpRequest'})=>fetch(base+'/api/material-assets/'+id,{method:'DELETE',headers});
  assert.equal((await remove(target.id,{})).status,403);
  assert.equal((await remove(listing.assets.find(x=>x.kind==='communication').id)).status,403);
  assert.equal((await remove('0'.repeat(24))).status,404);
  const deleted=await remove(target.id);assert.equal(deleted.status,200);assert.equal((await deleted.json()).recoverable,true);
  assert.equal((await fetch(base+'/api/material-assets/'+target.id)).status,404);
  assert.equal((await remove(target.id)).status,404);
  const remaining=await (await fetch(base+'/api/material-assets')).json();assert.equal(remaining.assets.length,4);
  const store=JSON.parse(await readFile(join(dir,'material-assets.json'),'utf8'));
  assert.equal(store.deletedAssets.length,1);assert.equal(store.deletedAssets[0].id,target.id);assert.ok(store.deletedAssets[0].deletedBy);
  // Soft deletion must preserve the original file for recovery.
  assert.ok((await readFile(join(dir,'material-uploads',target.id+target.extension))).length);
  const reupload=await fetch(base+'/api/material-assets',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind:'prohibited-word',name:'验收资料.txt',category:'验收',dataUrl:'data:;base64,'+Buffer.from('material roundtrip fixture prohibited-word').toString('base64')})});
  assert.equal(reupload.status,200);assert.equal((await reupload.json()).asset.id,target.id);
  const config=await (await fetch(base+'/api/script-generator/config')).json();assert.equal(config.configured,true);assert.equal(config.model,'deepseek-flash');assert.doesNotMatch(JSON.stringify(config),/apiKey|Authorization/);
  const noSession=await fetch(base+'/api/script-generator/generate',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});assert.equal(noSession.status,401);
 }finally{child.kill('SIGTERM');await new Promise(r=>child.once('exit',r));await rm(dir,{recursive:true,force:true})}
});
