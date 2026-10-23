import {validateCourseCreate} from './course-create.mjs';
import express from 'express';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createStore } from './store.mjs';
import { createAuth } from './auth.mjs';
import { CENTERS, CATEGORIES, ROLE_PATHS, fail, strictKeys, text, safeUrl } from './model.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const uuid=value=>{if(typeof value!=='string'||!/^[\w-]{16,100}$/.test(value))fail(400,'提交或会话标识格式错误');return value;};
const role=value=>{if(value!=='' && !ROLE_PATHS.some(r=>r.id===value))fail(400,'岗位路径不存在');return value;};
const version=value=>{if(!Number.isInteger(value)||value<0)fail(400,'缺少当前数据版本，请刷新后提交');return value;};
function realDate(value) {if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||Number.isNaN(Date.parse(value))||new Date(value+'T00:00:00Z').toISOString().slice(0,10)!==value)fail(400,'请填写有效日期');return value;}
function month(value) {if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(value||''))fail(400,'月份格式应为YYYY-MM');return value;}

export function createApp(options={}) {
  const preview=options.preview===true;
  if(preview && process.env.NODE_ENV==='production')throw new Error('Preview mode is forbidden in production');
  const basePath=options.basePath||'/',publicOrigin=options.publicOrigin||null;
  const clock=options.clock||Date.now;
  const store=createStore(options.dbPath||resolve(root,'var/training.sqlite'),options.inventoryPath||resolve(root,'data/course-inventory.json'),clock,options.enrichmentPath);
  store.access.initialize({allowedEmployeeIds:options.allowedEmployeeIds||[],managerIds:options.managerIds||[]});
  const auth=createAuth({...options,preview,clock,isAllowedEmployee:id=>store.access.has(id)});
  const app=express();app.disable('x-powered-by');
  app.set('trust proxy',1);
  app.use((req,res,next)=>{
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; frame-src https://*.feishu.cn https://*.larksuite.com; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'");
    res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');
    next();
  });
  app.get('/health',(_req,res)=>{try{store.db.prepare('SELECT 1').get();res.json({status:'ok',app:'brand-marketing-training',version:'1.0.0',mode:preview?'isolated-preview':'production'});}catch{res.status(503).json({status:'unhealthy'});}});
  app.get('/session/resume',(_req,res)=>{res.clearCookie('bmt_signed_out',{path:basePath});res.redirect(basePath);});
  app.use('/api',express.json({limit:'3mb'}));
  if(preview)app.post('/api/preview/identity',(req,res)=>{
    if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress))fail(403,'仅允许本机预览');
    if(req.headers.origin && req.headers.origin!==`http://${req.headers.host}`)fail(403,'预览身份不接受跨站请求');
    strictKeys(req.body,['role']);if(!['learner','manager'].includes(req.body.role))fail(400,'预览角色不存在');
    res.cookie('bmt_preview_role',req.body.role,{httpOnly:true,sameSite:'strict',path:basePath});res.clearCookie('bmt_signed_out',{path:basePath});res.json({saved:true});
  });
  const buckets=new Map();
  app.use('/api',async(req,res,next)=>{
    res.setHeader('Cache-Control','no-store');
    const key=req.ip,now=clock(),bucket=buckets.get(key)||{since:now,count:0};
    if(now-bucket.since>60000){bucket.since=now;bucket.count=0;}bucket.count++;buckets.set(key,bucket);
    if(buckets.size>2000){for(const [k,b]of buckets)if(now-b.since>60000)buckets.delete(k);}
    if(bucket.count>500)fail(429,'请求过于频繁，请稍后再试','RATE_LIMIT');
    try {
      req.user=store.register(await auth.resolve(req));
      if(!['GET','HEAD','OPTIONS'].includes(req.method))auth.checkWrite(req,req.user,publicOrigin||`${req.protocol}://${req.headers.host}`);
      next();
    }catch(error){next(error);}
  });
  app.get('/api/me',(req,res)=>res.json({user:{id:req.user.id,name:req.user.name,department:req.user.department,center:req.user.center,jobRole:req.user.jobRole,isAdmin:req.user.isAdmin,managementAccess:req.user.managementAccess,accessBasis:req.user.accessBasis},csrfToken:auth.tokenFor(req.user),preview,centers:CENTERS,categories:CATEGORIES,rolePaths:ROLE_PATHS}));
  app.patch('/api/me',(req,res)=>{strictKeys(req.body,['jobRole']);res.json({user:store.updateProfile(req.user,{jobRole:role(req.body.jobRole)})});});
  app.post('/api/logout',(req,res)=>{strictKeys(req.body,[]);res.cookie('bmt_signed_out','1',{httpOnly:true,sameSite:'lax',secure:!preview&&!!publicOrigin?.startsWith('https:'),path:basePath});res.json({signedOut:true});});
  app.get('/api/courses',(req,res)=>res.json({courses:store.listCourses(req.user),categories:CATEGORIES}));
  app.get('/api/courses/:id',(req,res)=>res.json({course:store.course(req.user,req.params.id),feedback:store.latestFeedback(req.user,req.params.id),progress:store.progressRow(req.user,req.params.id)}));
  app.get('/api/announcements',(_req,res)=>res.json({announcement:store.settings()}));
  app.get('/api/my-progress',(req,res)=>res.json(store.personal(req.user)));
  app.get('/api/schedule',(req,res)=>res.json({month:month(req.query.month),events:store.schedules(req.query.month)}));
  app.get('/api/leaderboard',(req,res)=>{if(req.query.sort && !['completed','active'].includes(req.query.sort))fail(400,'排序方式不存在');res.json({rows:store.leaderboard(req.query.sort),metric:req.query.sort==='active'?'站内活跃学习时长':'已完课数'});});
  app.post('/api/study-sessions',(req,res)=>{strictKeys(req.body,['courseId','sessionId']);res.json(store.startStudy(req.user,text(req.body.courseId,100,true),uuid(req.body.sessionId)));});
  app.post('/api/study-sessions/tick',(req,res)=>{
    strictKeys(req.body,['sessionId','seq','visible','activityAgeSeconds','elapsedSeconds']);
    const p=req.body;uuid(p.sessionId);
    if(!Number.isSafeInteger(p.seq)||p.seq<1||typeof p.visible!=='boolean'||!Number.isFinite(p.activityAgeSeconds)||p.activityAgeSeconds<0||!Number.isFinite(p.elapsedSeconds)||p.elapsedSeconds<0||p.elapsedSeconds>25)fail(400,'学习计时数据不正确');
    res.json(store.tickStudy(req.user,p));
  });
  app.post('/api/feedback',(req,res)=>{
    strictKeys(req.body,['requestId','courseId','rating','doubts','suggestions','application']);
    const p=req.body;uuid(p.requestId);text(p.courseId,100,true);
    if(!Number.isInteger(p.rating)||p.rating<1||p.rating>5)fail(400,'请选择1至5分的授课评分');
    res.json(store.submitFeedback(req.user,{requestId:p.requestId,courseId:p.courseId,rating:p.rating,doubts:text(p.doubts,3000),suggestions:text(p.suggestions,3000),application:text(p.application,3000)}));
  });
  app.get('/api/feedback/:requestId',(req,res)=>{const receipt=store.byRequest(req.user,uuid(req.params.requestId));if(!receipt)fail(404,'尚未查到这次提交的保存回执','NOT_SAVED');res.json(receipt);});
  app.use('/api/admin',(req,_res,next)=>{if(!req.user.isAdmin)fail(403,'管理后台需要服务端管理员授权','ADMIN_REQUIRED');next();});
  app.get('/api/admin/access',(req,res)=>res.json(store.access.list(req.user)));
  app.post('/api/admin/access/preview',(req,res)=>{strictKeys(req.body,['entries','restoreRevoked']);res.json(store.access.preview(req.user,req.body.entries,req.body.restoreRevoked??false));});
  app.post('/api/admin/access/apply',(req,res)=>res.json(store.access.apply(req.user,req.body)));
  app.get('/api/admin/access/receipts/:requestId',(req,res)=>res.json(store.access.receipt(req.user,req.params.requestId)));
  app.post('/api/admin/courses',(req,res)=>{const result=store.createCourse(req.user,validateCourseCreate(req.body));res.status(result.duplicate?200:201).json(result);});
  app.get('/api/admin/courses',(req,res)=>res.json({courses:store.adminCourses(req.user)}));
  app.patch('/api/admin/courses/:id',(req,res)=>{
    strictKeys(req.body,['version','overrides','resolvedFields']);
    const p=req.body;version(p.version);strictKeys(p.overrides,['title','category','lecturers','description','audience','durationMinutes','normalizedDate','dateBasis','resources','enabled','restricted']);
    if(!Array.isArray(p.resolvedFields)||p.resolvedFields.some(k=>typeof k!=='string'||!['title','category','lecturers','description','audience','durationMinutes','normalizedDate','dateBasis','resources','enabled','restricted'].includes(k)))fail(400,'冲突字段不正确');
    const o=p.overrides;
    for(const k of ['title','description','audience','dateBasis'])if(Object.hasOwn(o,k))o[k]=text(o[k],k==='title'?400:30000,k==='title');
    if(o.category&&!CATEGORIES.some(c=>c.id===o.category))fail(400,'课程分类不存在');
    if(Object.hasOwn(o,'lecturers')&&(!Array.isArray(o.lecturers)||o.lecturers.length>20||o.lecturers.some(s=>typeof s!=='string'||s.length>100)))fail(400,'讲师列表格式不正确');
    if(Object.hasOwn(o,'durationMinutes')&&o.durationMinutes!==null&&(!Number.isInteger(o.durationMinutes)||o.durationMinutes<1||o.durationMinutes>1440))fail(400,'时长需为已核验分钟数或留空');
    if(o.normalizedDate){realDate(o.normalizedDate);if(!o.dateBasis)fail(400,'确认历史日期需填写核验依据');}
    for(const k of ['enabled','restricted'])if(Object.hasOwn(o,k)&&typeof o[k]!=='boolean')fail(400,'课程状态格式不正确');
    if(o.resources){if(!Array.isArray(o.resources)||o.resources.length>4)fail(400,'资料分组格式不正确');const seen=new Set();for(const r of o.resources){strictKeys(r,['type','text','links']);if(!['reading','slides','recordings','other'].includes(r.type)||seen.has(r.type))fail(400,'资料分类重复或不存在');seen.add(r.type);text(r.text,30000);if(!Array.isArray(r.links)||r.links.length>40)fail(400,'资料链接数量过多');for(const l of r.links){strictKeys(l,['title','url','url_basis','type','token']);text(l.title||'',1000);safeUrl(l.url);}}}
    res.json({course:store.editCourse(req.user,req.params.id,p)});
  });
  app.get('/api/admin/learners',(_req,res)=>res.json({learners:store.learners()}));
  app.patch('/api/admin/learners/:id',(req,res)=>{strictKeys(req.body,['jobRole','managementAccess','courseIds','center']);if(typeof req.body.managementAccess!=='boolean')fail(400,'授权字段不正确');const result=store.editLearner(req.user,req.params.id,{...(Object.hasOwn(req.body,'center')?{center:req.body.center}:{}),jobRole:role(req.body.jobRole),managementAccess:req.body.managementAccess,...(Object.hasOwn(req.body,'courseIds')?{courseIds:req.body.courseIds}:{})});res.json({...result,learner:store.learners().find(user=>user.id===req.params.id)});});
  app.get('/api/admin/progress',(_req,res)=>res.json({records:store.adminProgress()}));
  app.get('/api/admin/feedback',(_req,res)=>res.json({feedback:store.adminFeedback()}));
  app.get('/api/admin/announcements',(_req,res)=>res.json({announcement:store.settings()}));
  app.put('/api/admin/announcements',(req,res)=>{strictKeys(req.body,['title','body','galleryUrl','version']);const result=store.saveSettings(req.user,{title:text(req.body.title,200,true),body:text(req.body.body,5000),galleryUrl:safeUrl(req.body.galleryUrl),version:version(req.body.version)});res.json({...result,announcement:store.settings()});});
  app.put('/api/admin/schedule/:id',(req,res)=>{
    uuid(req.params.id);strictKeys(req.body,['date','time','title','courseId','location','notes','version']);const p=req.body;
    realDate(p.date);if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(p.time))fail(400,'请输入有效开始时间');if(p.courseId)store.course(req.user,p.courseId,true);
    const result=store.saveSchedule(req.user,req.params.id,{date:p.date,time:p.time,title:text(p.title,400,true),courseId:p.courseId||null,location:text(p.location,1000),notes:text(p.notes,3000),version:version(p.version)});res.json({...result,event:store.schedules(p.date.slice(0,7)).find(event=>event.id===req.params.id)});
  });
  app.delete('/api/admin/schedule/:id',(req,res)=>{strictKeys(req.body,['version']);res.json(store.deleteSchedule(req.user,req.params.id,version(req.body.version)));});
  app.get('/api/admin/requirements',(_req,res)=>res.json({requirements:store.requirements()}));
  app.put('/api/admin/requirements/:id',(req,res)=>{uuid(req.params.id);strictKeys(req.body,['name','role','courseIds','version']);const p=req.body;if(p.role!=='all')role(p.role);if(!Array.isArray(p.courseIds)||!p.courseIds.length||p.courseIds.length>200||new Set(p.courseIds).size!==p.courseIds.length)fail(400,'学习清单需包含不重复的课程');for(const id of p.courseIds)store.course(req.user,id,true);const result=store.saveRequirement(req.user,req.params.id,{name:text(p.name,200,true),role:p.role,courseIds:p.courseIds,version:version(p.version)});res.json({...result,requirement:store.requirements().find(item=>item.id===req.params.id)});});
  app.delete('/api/admin/requirements/:id',(req,res)=>{strictKeys(req.body,['version']);res.json(store.deleteRequirement(req.user,req.params.id,version(req.body.version)));});
  app.post('/api/admin/import/preview',(req,res)=>{strictKeys(req.body,['inventory']);res.json(store.previewImport(req.user,req.body.inventory,randomUUID()));});
  app.post('/api/admin/import/apply',(req,res)=>{strictKeys(req.body,['previewId']);res.json(store.applyImport(req.user,uuid(req.body.previewId)));});
  app.get('/api/admin/source-export',(req,res)=>res.json({courses:store.adminCourses(req.user).map(c=>c.sourceSnapshot)}));
  app.get('/api/admin/audit',(_req,res)=>res.json({records:store.audit()}));
  app.use('/api',(_req,res)=>res.status(404).json({error:'接口未找到',code:'NOT_FOUND'}));
  app.use(express.static(resolve(root,'public'),{etag:true,maxAge:0,index:'index.html',setHeaders(res,path){
    const version=typeof res.req.query.v==='string'&&/^[\w.-]+$/.test(res.req.query.v);
    res.setHeader('Cache-Control',path.endsWith('.html')?'no-store':version&&/\.(js|css)$/.test(path)?'private, max-age=86400, immutable':/\.(woff2?|ttf)$/.test(path)?'private, max-age=604800':'no-cache');
  }}));
  app.use((error,_req,res,_next)=>{const status=Number.isInteger(error.status)?error.status:500;res.status(status).json({error:status>=500&&error.code!=='IDENTITY_UNAVAILABLE'?'服务暂不可用，保存结果不确定时请先读取回执':error.message,code:error.code||'SERVER_ERROR',requestId:randomUUID()});});
  return {app,store,close:()=>store.close()};
}
