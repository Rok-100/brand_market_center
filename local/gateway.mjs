if (process.env.LOCAL_SIMULATION !== '1') throw new Error('Local simulation only');
import http from 'node:http';
import {profiles,tokenFor} from './local-identities.mjs';
const prefix='/yxb/wis-marketing-hub';
const cloudRelease='20261021-material-catalog-v2';
// Local builds must not reuse an older embedded document at the same URL.
const cloudReleaseBootstrap=`<script>(function(){
  const version=${JSON.stringify(cloudRelease)};
  const update=function(){document.querySelectorAll('iframe[src]').forEach(function(frame){
    const target=new URL(frame.getAttribute('src'),location.href);
    if(target.origin===location.origin && target.pathname.includes('/modules/cloud-manager/') && target.searchParams.get('local_cloud_release')!==version){
      target.searchParams.set('local_cloud_release',version);frame.src=target.href;
    }
  });};
  new MutationObserver(update).observe(document.documentElement,{childList:true,subtree:true});update();
})();</script>`;
const modules={
  'creative-hub':['creative',3000,false], 'ai-first-creation':['onecreation',3766,true],
  'material-workbench':['remix',8787,false], 'cloud-manager':['cloud',3000,false],
  'live-room-management':['course-candidate',3000,false], 'data-dashboard':['dashboard',3000,false],
  'data-center':['data-center',3000,true], 'dispatch-center':['dispatch',3000,false],
};
function proxy(req,res) {
  const role=String(req.headers['x-local-test-role']||'admin');
  if(!profiles[role]){res.writeHead(401,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'Unknown local test role',localSimulation:true}));return;}
  const token=tokenFor(role);
  let path=req.url;
  // The hub still embeds the legacy HTML URL; the current SPA uses its base route.
  const legacyRemix=prefix+'/modules/material-workbench/remix.html';
  if(path===legacyRemix || path.startsWith(legacyRemix+'?')){
    res.writeHead(302,{Location:prefix+'/modules/material-workbench/'+path.slice(legacyRemix.length)});
    res.end();return;
  }
  let hostname='hub',port=3000,forwardedPrefix=prefix;
  if(path.startsWith('/local-objects/')){
    hostname='object-store';port=9000;path=path.slice('/local-objects'.length);
  }
  if(path===prefix){res.writeHead(302,{Location:prefix+'/'});res.end();return;}
  if(path.startsWith(prefix+'/')) path=path.slice(prefix.length);
  // One shared main UI and learning service; module/API routes keep their upstreams.
  const pathname=path.split('?')[0];
  if(pathname==='/' || pathname==='/index.html' ||
      ['/assets/','/ui/','/workflow-panorama/','/learning/'].some(p=>pathname.startsWith(p)) || pathname==='/learning') {
    hostname='learning-main';port=3000;
  }
  if(path.startsWith('/modules/')) {
    const match=path.match(/^\/modules\/([^/?]+)(.*)$/);
    const target=modules[match?.[1]];
    if(!target){res.writeHead(404);res.end('Unknown local module');return;}
    if(!profiles[role].modules.includes(match[1])){
      res.writeHead(403,{'Content-Type':'application/json'});
      res.end(JSON.stringify({detail:'当前本地测试身份未开通该模块',localSimulation:true}));return;
    }
    [hostname,port]=target;
    forwardedPrefix=prefix+'/modules/'+match[1];
    path=target[2]?prefix+path:(match[2]||'/');
    if(match[1]==='data-center' && match[2].startsWith('/_next/')) path=match[2];
    if(match[1]==='material-workbench' && path.startsWith('/worker/')) {
      path=path.slice(7);
      forwardedPrefix+='/worker';
    }
    // Cloud computes its own protected permissions (including review configuration).
    // Keep /api/auth/me on cloud; the identity fixture only supplies OA identity.
  }
  const upstream=http.request({hostname,port,path,method:req.method,
    headers:{...req.headers,'accept-encoding':'identity','x-oa-token':token,
      'x-forwarded-prefix':forwardedPrefix,
      cookie:'wis_oa_session='+token,
      'x-forwarded-proto':req.socket.encrypted?'https':'http'}},response=>{
    const headers={...response.headers,'x-local-simulation':'true',
      'set-cookie':'wis_oa_session='+token+'; Path=/; HttpOnly; SameSite=Lax'};
    if((headers['content-type']||'').includes('text/html') || (headers['content-type']||'').includes('application/json')){
      headers['cache-control']='no-store';delete headers['last-modified'];delete headers.etag;
    }
    if(['cloud','remix'].includes(hostname) && (headers['content-type']||'').includes('application/json') && !headers['content-encoding']){
      const chunks=[];
      response.on('data',chunk=>chunks.push(chunk));
      response.on('end',()=>{
        const publicOrigin='http://'+req.headers.host;
        let json=Buffer.concat(chunks).toString('utf8').replaceAll('http://object-store:9000',publicOrigin+'/local-objects');
        if(hostname==='remix')json=json.replaceAll('已通过 Cutter 识别','【本机模拟】识别服务替身返回');
        delete headers['content-length'];delete headers.etag;
        res.writeHead(response.statusCode,headers);res.end(json);
      });
    }else if((headers['content-type']||'').includes('text/html') && !headers['content-encoding']){
      const chunks=[];
      response.on('data',chunk=>chunks.push(chunk));
      response.on('end',()=>{
        const banner='<aside role="status" style="position:fixed;bottom:0;left:0;right:0;z-index:2147483647;background:#fff2cc;color:#64450b;padding:4px;text-align:center;font:12px sans-serif">本机模拟环境 · 业务数据与第三方接口仅用于测试</aside>';
        let html=Buffer.concat(chunks).toString('utf8').replace(/<body([^>]*)>/i,'<body$1>'+banner);
        if(hostname==='learning-main' && !pathname.startsWith('/learning')) html=html.replace('</head>',cloudReleaseBootstrap+'</head>');
        delete headers['content-length'];delete headers.etag;
        res.writeHead(response.statusCode,headers);res.end(html);
      });
    }else{res.writeHead(response.statusCode,headers);response.pipe(res);}
  });
  upstream.setTimeout(600000,()=>upstream.destroy());
  upstream.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end('Local service unavailable: '+hostname);});
  req.pipe(upstream);
}
http.createServer(proxy).listen(8080,'0.0.0.0');
