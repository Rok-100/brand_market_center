import http from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {resolve,extname} from 'node:path';
const root='/gateway/hub',prefix='/yxb/wis-marketing-hub',modulePrefix=prefix+'/modules/material-workbench';
const keys=['creative-hub','ai-first-creation','material-workbench','cloud-manager','live-room-management','data-dashboard','workflow-engine','data-center','dispatch-center'];
const session={user:{number:'FD-999999',id:'FD-999999',realName:'本地最高权限',name:'本地最高权限',department:'品牌营销部',parentDept:'品牌营销部',center:'AI营销中心',status:'normal'},permissions:{super_admin:true,operation_admin:true,manage_permissions:true},access:{master_access:true,access_mode:'all',allowed_modules:keys,modules:keys.map(key=>({key,label:key,purpose:key}))},workspace:{role:'maintainer',role_label:'最高权限',home:'modules',dashboard_scope:'department',department:'品牌营销部',center:'AI营销中心',manager:'',is_brand_department:true,is_system_maintainer:true,can_configure_workflow:true,can_view_organization_dashboard:true,can_view_spark_library:true,can_view_public_summary:false,module_policy_state:'local',policy_source:{title:'本地最高权限',url:'',sheetId:'',revision:1}}};
function proxy(req,res,host,path,forwardedPrefix){
 const upstream=http.request({hostname:host,port:host==='remix'?8787:3000,path,method:req.method,headers:{...req.headers,'x-oa-token':'local-development-only','x-forwarded-prefix':forwardedPrefix,'x-forwarded-proto':'http','accept-encoding':'identity'}},response=>{res.writeHead(response.statusCode,response.headers);response.pipe(res)});
 upstream.setTimeout(600000,()=>upstream.destroy());upstream.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end('Local remix service unavailable')});req.pipe(upstream);
}
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.ico':'image/x-icon'};
http.createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://127.0.0.1:8095');let p=url.pathname;
  const send=(value,status=200)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value))};
  if(p==='/'||p==='/local-dev/'||p===prefix){res.writeHead(302,{Location:prefix+'/'});return res.end()}
  if(p==='/health')return send({ok:true,module:'remix-only'});
  if(p.startsWith('/local-input/'))return proxy(req,res,'bridge',p.slice('/local-input'.length)+url.search,'');
  if(p===modulePrefix||p===modulePrefix+'/remix.html'){res.writeHead(302,{Location:modulePrefix+'/'});return res.end()}
  if(p.startsWith(modulePrefix+'/worker/'))return proxy(req,res,'remix',p.slice((modulePrefix+'/worker').length)+url.search,modulePrefix+'/worker');
  if(p.startsWith(modulePrefix+'/'))return proxy(req,res,'remix',p.slice(modulePrefix.length)+url.search,modulePrefix);
  const api=p.startsWith(prefix+'/api/')?p.slice(prefix.length):p;
  if(api==='/api/session'||api==='/api/auth/me')return send(session);
  if(api==='/api/launch/material-workbench'){res.writeHead(302,{Location:modulePrefix+'/'});return res.end()}
  if(api.startsWith('/api/'))return send({detail:'当前只接入二创混剪，其他入口仅保留界面'},501);
  if(p.includes('/modules/'))return send({detail:'此业务模块未接入'},501);
  if(p.startsWith(prefix+'/'))p=p.slice(prefix.length);
  if(p==='/local-shell.js'){res.writeHead(200,{'Content-Type':'text/javascript'});return res.end(await readFile('/gateway/local-shell.js'))}
  if(p==='/')p='/index.html';const file=resolve(root,'.'+p);
  if(!file.startsWith(root+'/'))return send({detail:'Invalid path'},400);
  if(extname(file)==='.html'){
   const html=(await readFile(file,'utf8')).replace('<head>','<head><script src="'+prefix+'/local-shell.js"></script>');res.writeHead(200,{'Content-Type':types['.html'],'Cache-Control':'no-store'});return res.end(html)
  }
  const info=await stat(file);res.writeHead(200,{'Content-Type':types[extname(file)]||'application/octet-stream','Content-Length':info.size});createReadStream(file).pipe(res);
 }catch{res.writeHead(404);res.end('Not found')}
}).listen(8080,'0.0.0.0');
