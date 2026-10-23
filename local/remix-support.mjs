// Local-only dependencies for remix. No OA, cloud-manager UI or external delivery.
import http from 'node:http';
import fs from 'node:fs/promises';
import {createReadStream,createWriteStream} from 'node:fs';
import {pipeline} from 'node:stream/promises';
import {Transform} from 'node:stream';
import {createHash,randomUUID} from 'node:crypto';
import Busboy from './render-worker/node_modules/busboy/lib/index.js';
if(process.env.LOCAL_SIMULATION!=='1')throw Error('Local simulation required');
const root='/data';await fs.mkdir(root+'/files',{recursive:true});
const filename=root+'/integration.json';let state={localSimulation:true,assets:[],returns:{},cutter:{}};
try{state=JSON.parse(await fs.readFile(filename,'utf8'))}catch(e){if(e.code!=='ENOENT')throw e}
if(state.localSimulation!==true)throw Error('Unexpected local data');
let serial=Promise.resolve();const save=()=>{const snapshot=JSON.stringify(state);const next=serial.then(async()=>{await fs.writeFile(filename+'.tmp',snapshot);await fs.rename(filename+'.tmp',filename)});serial=next.catch(()=>{});return next};
const user={number:'FD-999999',id:'FD-999999',userId:'FD-999999',realName:'本地最高权限',name:'本地最高权限',department:'品牌营销部',parentDept:'品牌营销部',center:'AI营销中心',status:'normal'};
const permissions={super_admin:true,operation_admin:true,manage_permissions:true};
const libraryBaseUrl=new URL(process.env.LOCAL_LIBRARY_BASE_URL||'http://bridge:3000');
if(!['http:','https:'].includes(libraryBaseUrl.protocol)||libraryBaseUrl.pathname!=='/'||libraryBaseUrl.search||libraryBaseUrl.hash)throw Error('LOCAL_LIBRARY_BASE_URL 必须是 http/https 服务根地址');
const fileUrl=id=>libraryBaseUrl.origin+'/files/'+id;
const nextAssetId=()=>{state.nextAssetId=Math.max(state.nextAssetId||0,...state.assets.map(a=>a.id))+1;return state.nextAssetId};
const decorate=a=>({...a,preview_url:'/local-input/files/'+a.file,download_url:fileUrl(a.file),storage_url:fileUrl(a.file)});
const json=async req=>{let body='';for await(const b of req){body+=b;if(body.length>12*1024*1024)throw Error('请求过大')}return JSON.parse(body||'{}')};
const writeMedia=async(req,id)=>{let n=0;await pipeline(req,new Transform({transform(b,_e,cb){n+=b.length;cb(n>128*1024*1024?Error('素材超过128MiB'):null,b)}}),createWriteStream(root+'/files/'+id));return n};
const hash=async id=>{const h=createHash('sha256');for await(const c of createReadStream(root+'/files/'+id))h.update(c);return h.digest('hex')};
http.createServer(async(req,res)=>{
 const send=(value,status=200)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value))};
 try{
  const url=new URL(req.url,'http://bridge'),p=url.pathname;
  if(p==='/health')return send({ok:true,localSimulation:true});
  if(p==='/api/workstation/access-authorize'||p==='/api/workstation/access-authorize-identity')return send({allowed:true,user,permissions,access:{master_access:true,access_mode:'all',allowed_modules:['material-workbench']}});
  const fileMatch=p.match(/^\/files\/([a-f0-9-]{36})$/);
  if(fileMatch){const id=fileMatch[1],file=root+'/files/'+id;
   if(req.method==='PUT'){await writeMedia(req,id);return send({ok:true})}
   const stat=await fs.stat(file);let start=0,end=stat.size-1,status=200;const range=req.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
   if(range){start=Number(range[1]);end=range[2]?Math.min(end,Number(range[2])):end;status=206;if(start>end){res.writeHead(416);return res.end()}}
   res.writeHead(status,{'Content-Type':'video/mp4','Content-Length':end-start+1,'Accept-Ranges':'bytes',...(status===206?{'Content-Range':`bytes ${start}-${end}/${stat.size}`}:{})});
   if(req.method==='HEAD')return res.end();return createReadStream(file,{start,end}).pipe(res);
  }
  if(p==='/input'&&req.method==='GET'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});return res.end('<!doctype html><meta charset="utf-8"><title>混剪素材输入</title><style>body{font:16px system-ui;max-width:720px;margin:40px auto}input,button{padding:10px;margin:8px}</style><h1>混剪素材输入</h1><p>素材只保存到本地，随后在工作台素材库导入。</p><form action="/local-input/upload" method="post" enctype="multipart/form-data"><label>产品分类<input name="category" value="黑晶面膜" required></label><input type="file" name="video" accept="video/*" required><button>上传本地素材</button></form><p><a href="/yxb/wis-marketing-hub/modules/material-workbench/">返回二创混剪</a></p>')}
  if(p==='/upload'&&req.method==='POST'){
   const parser=Busboy({headers:req.headers,limits:{files:1,fileSize:128*1024*1024,fields:5}});let task,category='黑晶面膜',name='local.mp4',id=randomUUID(),truncated=false;
   parser.on('field',(key,value)=>{if(key==='category')category=value.slice(0,100)});
   parser.on('file',(_key,stream,info)=>{name=info.filename.slice(0,200);stream.on('limit',()=>truncated=true);task=pipeline(stream,createWriteStream(root+'/files/'+id))});
   await new Promise((resolve,reject)=>{parser.once('close',resolve);parser.once('error',reject);req.pipe(parser)});if(!task)throw Error('请选择视频文件');await task;if(truncated)throw Error('素材超过128MiB');
   const stat=await fs.stat(root+'/files/'+id);if(!stat.size)throw Error('素材为空');
   state.assets.push({id:nextAssetId(),file:id,filename:name,object_key:'local/source/'+id,size:stat.size,category,media_type:'video',asset_library:'source',library_type:'source',asset_scope:'marketing_video',ingest_source:'oa_upload',modified_at:new Date().toISOString(),tags:[],effective:true,source:'oa_upload',uploaded_by_number:user.number,uploaded_by_name:user.realName,sha256:await hash(id)});await save();res.writeHead(303,{Location:'/yxb/wis-marketing-hub/modules/material-workbench/'});return res.end();
  }
  if(p==='/vision'&&req.method==='POST'){
   const input=await json(req),messages=input.requests_data?.messages||input.messages||[];let evidence={};
   for(const m of messages){if(m.role!=='user')continue;for(const part of Array.isArray(m.content)?m.content:[{text:m.content}]){try{const v=JSON.parse(part.text);if(v&&typeof v==='object')evidence={...evidence,...v}}catch{}}}
   const checks={semanticComplete:true,originalTextConsistent:true,sourcePackagingConsistent:true,commercialSupported:true,visualUsable:true};
   const result={...evidence,localSimulation:true,decision:'pass',confidence:1,summary:'【本地模拟】仅用于混剪流程，不是模型审核结论',issues:[],checks,segments:(evidence.segments||[]).map(s=>({...s,decision:'pass',confidence:1,summary:'【本地模拟】',issues:[],checks}))};
   return send({localSimulation:true,choices:[{message:{role:'assistant',content:JSON.stringify(result)}}]});
  }
  if(p.startsWith('/cutter/')){
   const body=req.method==='POST'?await json(req):{},source=String(body.oss_url||url.searchParams.get('oss_url')||'');
   if(p==='/cutter/task')return send({code:0,localSimulation:true,data:{task_id:url.searchParams.get('task_id'),status:'success'}});
   const media=new URL(source);if(media.origin!==libraryBaseUrl.origin||!/^\/files\/[a-f0-9-]{36}$/.test(media.pathname))return send({code:403,message:'仅允许本地视频'},403);
   const id='local-'+createHash('sha256').update(media.pathname).digest('hex').slice(0,24);
   if(p==='/cutter/select')return send({code:0,localSimulation:true,data:{results:state.cutter[id]||[]}});
   const {execFile}=await import('node:child_process'),{promisify}=await import('node:util');const {stdout}=await promisify(execFile)('ffprobe',['-v','error','-show_entries','format=duration','-of','json',root+media.pathname],{timeout:30000});
   const duration=Number(JSON.parse(stdout).format.duration);if(!(duration>0))throw Error('视频时长无效');
   const stamp=s=>new Date(Math.round(s*1000)).toISOString().slice(11,23);const count=Math.max(1,Math.min(3,Math.floor(duration)));
   state.cutter[id]=Array.from({length:count},(_,i)=>({time_range:stamp(i*duration/count)+'-'+stamp((i+1)*duration/count),script_text:'【本地模拟】片段'+(i+1)+'，请按实际素材填写台词',scene_description:'【本地模拟】按真实视频时长分段'}));await save();return send({code:0,localSimulation:true,data:{task_id:id,status:'success'}});
  }
  const api=p.replace(/^\/api\/(?:remix-workstation|workstation)/,'');
  if(api==='/assets'){
   let rows=state.assets;const kind=url.searchParams.get('library_type'),category=url.searchParams.get('category'),q=url.searchParams.get('q');if(kind&&kind!=='all')rows=rows.filter(a=>a.library_type===kind);if(category)rows=rows.filter(a=>a.category===category);if(q)rows=rows.filter(a=>a.filename.includes(q));
   const page=Math.max(1,Number(url.searchParams.get('page')||1)),size=Math.min(100,Number(url.searchParams.get('page_size')||24));return send({items:rows.slice((page-1)*size,page*size).map(decorate),total:rows.length,page,page_size:size,library_type:kind||'source',source:'本地混剪素材输入',categories:[...new Set(state.assets.map(a=>a.category))],folders:[]});
  }
  const assetMatch=api.match(/^\/assets\/(\d+)$/);if(assetMatch){const asset=state.assets.find(a=>a.id===Number(assetMatch[1]));return asset?send(decorate(asset)):send({detail:'素材不存在'},404)}
  if(api==='/returns/presign'){
   const b=await json(req),key=String(b.idempotency_key||'');if(!key||key.length>250)throw Error('回传幂等编号无效');let r=state.returns[key];
   if(r&&((b.sha256&&r.sha256!==b.sha256)||(b.size&&r.expected_size!==b.size)))return send({detail:'同一回传编号内容不同'},409);
   if(!r){r={idempotency_key:key,status:'pending',file:randomUUID(),sha256:b.sha256,expected_size:b.size||b.file_size,filename:b.filename||'remix.mp4',provenance:b.provenance||{},category:b.category||b.product_category||'黑晶面膜',created_at:new Date().toISOString()};state.returns[key]=r;await save()}
   return send({...r,upload_required:r.status!=='completed',upload_url:fileUrl(r.file),headers:{'Content-Type':'video/mp4'},expires_in:3600});
  }
  if(api==='/returns/complete'){
   const b=await json(req),r=state.returns[b.idempotency_key];if(!r)return send({detail:'回传不存在'},404);if(r.status==='completed')return send(r);
   const stat=await fs.stat(root+'/files/'+r.file),sha=await hash(r.file);if((r.expected_size&&stat.size!==r.expected_size)||(r.sha256&&sha!==r.sha256))return send({detail:'回传字节或SHA256不一致'},409);
   if(r.status==='completed')return send(r);
   const a={id:nextAssetId(),file:r.file,filename:r.filename,object_key:'local/remix/'+r.file,size:stat.size,sha256:sha,category:r.category,media_type:'video',asset_library:'remix',library_type:'remix',modified_at:new Date().toISOString(),tags:[]};state.assets.push(a);Object.assign(r,{status:'completed',asset_id:a.id,asset_available:true,asset:decorate(a),sha256:sha,completed_at:new Date().toISOString()});await save();return send(r);
  }
  const ret=api.match(/^\/returns\/(.+?)(\/feedback)?$/);if(ret){const key=decodeURIComponent(ret[1]),r=state.returns[key];if(!r)return send({detail:'回传不存在'},404);return send(ret[2]?{asset_id:r.asset_id,asset_available:r.status==='completed',complete:true,checked_at:new Date().toISOString(),items:[],basic_review:{enabled:false,localSimulation:true}}:r)}
  if(api.startsWith('/qianchuan/'))return send({detail:'本项目只包含二创混剪，未接入投递'},501);
  return send({detail:'未接入此功能'},404);
 }catch(e){if(!res.headersSent)send({detail:e.message},400);else res.end()}
}).listen(3000,'0.0.0.0');
