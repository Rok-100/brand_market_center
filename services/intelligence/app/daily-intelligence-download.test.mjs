import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {materialDownload,streamDownload} from './daily-intelligence-download.mjs';
import {createIntelligenceHandler} from './daily-intelligence-http.mjs';

test('download uses persisted material and exact source endpoint, refuses arbitrary destinations',()=>{
  const item={id:'123',platform:'douyin',title:'测试素材',downloadUrl:'http://radar.invalid/api/video/download/123'};
  const store={get:id=>id==='report-1'?{materials:{items:[item]}}:null};
  const params=new URLSearchParams({report:'report-1',id:'123',platform:'douyin',url:'http://127.0.0.1/secrets'});
  assert.equal(materialDownload(store,params,'http://radar.invalid').url.href,item.downloadUrl);
  for(const invalid of ['http://127.0.0.1/api/video/download/123','http://radar.invalid/admin','http://radar.invalid/api/video/download/123?url=other']){
    item.downloadUrl=invalid;assert.throws(()=>materialDownload(store,params,'http://radar.invalid'));
  }
  params.set('platform','wechat_channel');assert.throws(()=>materialDownload(store,params,'http://radar.invalid'));
});

test('authenticated download streams bytes as attachment; redirects/login bodies are rejected',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'intelligence-download-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const file=join(dir,'token');writeFileSync(file,'internal-fixture');
  let session={status:401,payload:{detail:'login'}},received,mode='video';
  const handler=createIntelligenceHandler({sessionFor:async()=>session,env:{DAILY_INTELLIGENCE_URL:'http://collector.invalid',INTELLIGENCE_INTERNAL_TOKEN_FILE:file},sendJson:(res,status,data)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(data));},
    fetchImpl:async(url,opts)=>{received={url,opts};if(mode==='html')return new Response('<html>login</html>',{headers:{'content-type':'text/html'}});return new Response(new Uint8Array([0,1,2,3]),{headers:{'content-type':'video/mp4','content-length':'4','content-disposition':'attachment; filename="video.mp4"'}});}});
  const server=createServer((req,res)=>handler(req,res,new URL(req.url,'http://hub')));server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>{server.closeAllConnections();server.close();});
  const url=`http://127.0.0.1:${server.address().port}/api/daily-intelligence/download?report=report-1&id=123&platform=douyin`;
  assert.equal((await fetch(url)).status,401);assert.equal(received,undefined);
  session={status:200,payload:{user:{},workspace:{home:'personal'}}};assert.equal((await fetch(url)).status,403);
  session.payload.workspace.home='department';const r=await fetch(url);
  assert.equal(r.status,200);assert.equal(r.headers.get('content-disposition'),'attachment; filename="video.mp4"');assert.deepEqual([...new Uint8Array(await r.arrayBuffer())],[0,1,2,3]);
  assert.equal(received.url.origin,'http://collector.invalid');assert.equal(received.url.searchParams.get('id'),'123');assert.equal(received.opts.headers['x-intelligence-token'],'internal-fixture');assert.equal(received.opts.redirect,'error');
  mode='html';assert.equal((await fetch(url)).status,503);
});

test('range downloads preserve partial response and use safe Unicode filename',async t=>{
  let headers;
  const server=createServer(async(req,res)=>{await streamDownload(req,res,'http://radar.invalid/api/video/download/123',{filename:'素材.mp4',fetchImpl:async(url,opts)=>{headers=opts.headers;return new Response(new Uint8Array([1,2]),{status:206,headers:{'content-type':'video/mp4','content-range':'bytes 1-2/4','content-length':'2'}});}});});
  server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>{server.closeAllConnections();server.close();});
  const r=await fetch(`http://127.0.0.1:${server.address().port}`,{headers:{range:'bytes=1-2'}});
  assert.equal(r.status,206);assert.equal(r.headers.get('content-range'),'bytes 1-2/4');assert.match(r.headers.get('content-disposition'),/filename\*=UTF-8''/);assert.equal(headers.range,'bytes=1-2');assert.equal((await r.arrayBuffer()).byteLength,2);
});
