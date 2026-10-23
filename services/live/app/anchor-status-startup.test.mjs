import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';

test('complete production entry boots; central login protects page and new APIs; lifecycle tab is registered',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'anchor-status-boot-'));
  const auth=createServer((req,res)=>{const ok=req.headers.cookie==='fixture-user=yes';res.writeHead(ok?200:401,{'Content-Type':'application/json'});res.end(JSON.stringify(ok?{user:{number:'BOOT-FIXTURE',realName:'隔离验收'},permissions:{super_admin:true},access:{allowed_modules:['live-room-management']}}:{detail:'unauthorized'}));});
  await new Promise(resolve=>auth.listen(0,'127.0.0.1',resolve));
  const reserve=createServer();await new Promise(resolve=>reserve.listen(0,'127.0.0.1',resolve));const port=reserve.address().port;await new Promise(resolve=>reserve.close(resolve));
  const child=spawn(process.execPath,['server.js'],{cwd:fileURLToPath(new URL('./',import.meta.url)),windowsHide:true,stdio:'ignore',env:{...process.env,
    PORT:String(port),BASE_PATH:'/fixture-live',DATA_DIR:directory,CENTRAL_AUTHORITY_BASE:'http://127.0.0.1:'+auth.address().port,CENTRAL_AUTHORITY_FALLBACK_BASE:'',
    HUB_SAME_ORIGIN_EMBED:'true',ANCHOR_STATUS_ENABLED:'true',ANCHOR_STATUS_SCHEDULER_ENABLED:'0',ANCHOR_STATUS_NOTIFICATIONS_ENABLED:'false',LIFECYCLE_SCHEDULER_ENABLED:'0',LIFECYCLE_REMINDERS_ENABLED:'false',LIFECYCLE_REMINDER_LEADER:'false',FEISHU_APP_SECRET:'',JUMP_LLM_TOKEN:'',MINIMAX_API_KEY:''}});
  t.after(async()=>{child.kill();await new Promise(resolve=>child.exitCode===null?child.once('exit',resolve):resolve());await new Promise(resolve=>auth.close(resolve));await rm(directory,{recursive:true,force:true});});
  const base='http://127.0.0.1:'+port;
  let booted=false;for(let i=0;i<40;i++){try{if((await fetch(base+'/healthz')).ok){booted=true;break;}}catch{}await new Promise(resolve=>setTimeout(resolve,100));}
  assert.ok(booted,'new modules must not break actual server startup');
  assert.equal((await fetch(base+'/fixture-live/api/lifecycle/status-warning/status')).status,401);
  const headers={Cookie:'fixture-user=yes'};
  const response=await fetch(base+'/fixture-live/api/lifecycle/status-warning/status',{headers});assert.equal(response.status,200);const result=await response.json();assert.equal(result.data.canManage,true);assert.equal(result.data.notificationsEnabled,false);
  assert.equal((await fetch(base+'/fixture-live/api/lifecycle/status-warning/summary',{headers})).status,200);
  const shell=await(await fetch(base+'/fixture-live/',{headers})).text();assert.match(shell,/data-module="status-warning"/);assert.match(shell,/anchor-status-warning\.html/);
  assert.equal((await fetch(base+'/fixture-live/modules/anchors/anchor-status-warning.html',{headers})).status,200);
});
