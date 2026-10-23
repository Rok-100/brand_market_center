import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createApp } from '../server/app.mjs';
import { createStore } from '../server/store.mjs';
import { hash } from '../server/model.mjs';
const sourcePath=new URL('../data/course-inventory.json',import.meta.url);
const inventory=JSON.parse(readFileSync(sourcePath,'utf8'));
const regular=inventory.courses.find(c=>!c.restricted),restricted=inventory.courses.find(c=>c.restricted);
const identityProvider=req=>({id:req.headers['x-test-role']==='admin'?'qa-admin':req.headers['x-test-role']==='other'?'qa-other':'qa-learner',name:req.headers['x-test-role']==='admin'?'测试管理员':'测试学员',department:'品牌营销部',isAdmin:req.headers['x-test-role']==='admin'});
async function harness(t,options={}) {
  let time=Date.parse('2026-10-12T01:00:00Z');
  const instance=createApp({dbPath:':memory:',inventoryPath:sourcePath,enrichmentPath:null,csrfSecret:'test-only-secret-with-more-than-32-characters',identityProvider,clock:()=>time,...options});
  const server=instance.app.listen(0,'127.0.0.1');await new Promise(r=>server.on('listening',r));
  t.after(async()=>{await new Promise(r=>server.close(r));instance.close();});
  const base=`http://127.0.0.1:${server.address().port}`;
  async function request(path,{as='learner',method='GET',body,csrf=true,headers={}}={}) {
    const me=csrf&&method!=='GET'?await fetch(base+'/api/me',{headers:{'x-test-role':as}}).then(r=>r.json()):null;
    const response=await fetch(base+'/api/'+path,{method,headers:{'x-test-role':as,'Content-Type':'application/json',...(me?{'X-CSRF-Token':me.csrfToken}:{}),...headers},body:body===undefined?undefined:JSON.stringify(body)});
    return {status:response.status,body:await response.json()};
  }
  return {...instance,request,base,advance:ms=>{time+=ms;}};
}
const feedback=(courseId=regular.id)=>({requestId:randomUUID(),courseId,rating:5,doubts:'测试疑惑',suggestions:'测试改进',application:'合成候选验证，不是真实学员反馈'});

test('35条课程逐条保留真实原字段，多回放、缺口与33/2分层准确',async t=>{
  const h=await harness(t);const {status,body}=await h.request('courses');assert.equal(status,200);assert.equal(body.courses.length,35);
  assert.equal(body.courses.filter(c=>c.restricted).length,2);
  for(const s of inventory.courses){const c=body.courses.find(c=>c.id===s.id);assert.equal(c.title,s.fields.title.text);assert.deepEqual(c.lecturers,s.fields.lecturers.lecturers.map(x=>x.name));assert.equal(c.audience,s.fields.audience.text);assert.equal(c.historicalRating,s.historical_rating);assert.equal(c.durationMinutes,null);assert.equal(c.source.url,s.source_url);if(!s.restricted){assert.deepEqual(c.resources.map(r=>r.links),['reading','slides','recordings','other'].map(k=>s.fields[k].links));}}
  assert.ok(body.courses.some(c=>c.resources.find(r=>r.type==='recordings').links.length>1));
  assert.ok(body.courses.some(c=>c.title.includes('直播间通识')&&!c.resources.find(r=>r.type==='recordings').links.length));
});
test('学生端不能访问任何后台路由，不能冒充他人或自授管理权限',async t=>{
  const h=await harness(t);
  for(const path of ['admin/courses','admin/learners','admin/progress','admin/feedback','admin/announcements','admin/requirements','admin/audit','admin/source-export'])assert.equal((await h.request(path)).status,403);
  assert.equal((await h.request('me',{method:'PATCH',body:{center:'测试',jobRole:'management',isAdmin:true}})).status,400);
  const p=feedback();assert.equal((await h.request('feedback',{method:'POST',body:{...p,empId:'qa-admin'}})).status,400);
  const saved=await h.request('feedback',{method:'POST',body:p});assert.equal(saved.status,200);
  assert.equal((await h.request('feedback/'+p.requestId,{as:'other'})).status,404);
  assert.equal((await h.request('my-progress',{as:'other'})).body.records.length,0);
});
test('自选管理者岗位路径不提升管理课权限，管理员可以按人授权',async t=>{
  const h=await harness(t);
  await h.request('me',{method:'PATCH',body:{jobRole:'management'}});
  assert.equal((await h.request('feedback',{method:'POST',body:feedback(restricted.id)})).status,403);
  assert.equal((await h.request('courses/'+restricted.id)).body.course.canLearn,false);
  assert.equal((await h.request('admin/learners/qa-learner',{as:'admin',method:'PATCH',body:{jobRole:'management',managementAccess:true}})).status,200);
  assert.equal((await h.request('feedback',{method:'POST',body:feedback(restricted.id)})).status,200);
  assert.equal((await h.request('admin/courses')).status,403);
});
test('反馈与完成同一事务保存；重复标识不重复保存，复看不撤销完成',async t=>{
  const h=await harness(t),p=feedback();
  const first=await h.request('feedback',{method:'POST',body:p});assert.equal(first.status,200);assert.equal(first.body.progress.status,'completed');
  assert.equal((await h.request('feedback',{method:'POST',body:p})).body.duplicate,true);
  assert.equal((await h.request('feedback',{method:'POST',body:{...p,rating:4}})).status,409);
  await h.request('study-sessions',{method:'POST',body:{courseId:regular.id,sessionId:randomUUID()}});
  assert.equal((await h.request('my-progress')).body.records[0].status,'completed');
  assert.equal(h.store.db.prepare('SELECT count(*) n FROM feedback').get().n,1);
  assert.equal((await h.request('feedback/'+p.requestId)).body.feedback.application,p.application);
});
test('数据库保存失败全部回滚；同一标识恢复后可以成功，不留下假完课',async t=>{
  const h=await harness(t),p=feedback();
  h.store.db.exec("CREATE TRIGGER qa_fail_progress BEFORE INSERT ON progress BEGIN SELECT RAISE(ABORT,'qa disk failure'); END;");
  assert.equal((await h.request('feedback',{method:'POST',body:p})).status,500);
  assert.equal(h.store.db.prepare('SELECT count(*) n FROM feedback').get().n,0);assert.equal((await h.request('feedback/'+p.requestId)).status,404);
  assert.equal((await h.request('my-progress')).body.summary.completed,0);
  h.store.db.exec('DROP TRIGGER qa_fail_progress');assert.equal((await h.request('feedback',{method:'POST',body:p})).status,200);
});
test('服务器计时去重、限额、前台检查，多窗口不能重复累计',async t=>{
  const h=await harness(t),a=randomUUID(),b=randomUUID();
  for(const sessionId of [a,b])await h.request('study-sessions',{method:'POST',body:{courseId:regular.id,sessionId}});
  h.advance(10000);
  const tick={seq:1,visible:true,activityAgeSeconds:1,elapsedSeconds:10};
  assert.equal((await h.request('study-sessions/tick',{method:'POST',body:{...tick,sessionId:a}})).body.creditedSeconds,10);
  assert.equal((await h.request('study-sessions/tick',{method:'POST',body:{...tick,sessionId:b}})).body.creditedSeconds,0);
  assert.equal((await h.request('study-sessions/tick',{method:'POST',body:{...tick,sessionId:a}})).body.duplicate,true);
  h.advance(10000);await h.request('study-sessions/tick',{method:'POST',body:{...tick,seq:2,sessionId:a,visible:false}});
  h.advance(10000);await h.request('study-sessions/tick',{method:'POST',body:{...tick,seq:3,sessionId:a,activityAgeSeconds:100}});
  assert.equal((await h.request('my-progress')).body.summary.activeSeconds,10);
  h.advance(60000);await h.request('study-sessions/tick',{method:'POST',body:{...tick,seq:4,sessionId:a,elapsedSeconds:20}});
  assert.equal((await h.request('my-progress')).body.summary.activeSeconds,10);
  assert.equal((await h.request('study-sessions/tick',{method:'POST',body:{...tick,seq:5,sessionId:a,elapsedSeconds:200}})).status,400);
  assert.equal((await h.request('study-sessions/tick',{as:'other',method:'POST',body:{...tick,sessionId:a}})).status,404);
});
test('榜单支持并列、只显示必要字段，新反馈样本不会因更新重复计算',async t=>{
  const h=await harness(t);assert.equal((await h.request('leaderboard')).body.rows.length,0);
  await h.request('feedback',{method:'POST',body:feedback()});await h.request('feedback',{as:'other',method:'POST',body:feedback()});
  await h.request('feedback',{method:'POST',body:{...feedback(),rating:4}});
  const rows=(await h.request('leaderboard')).body.rows;assert.deepEqual(rows.map(r=>r.rank),[1,1]);assert.deepEqual(new Set(rows.map(r=>r.id)),new Set(['qa-learner','qa-other']));assert.ok(rows.every(r=>r.department==='品牌营销部'&&!r.userId));
  assert.equal((await h.request('admin/feedback',{as:'admin'})).body.feedback.length,2);
});
test('本月排期为空，排期编辑与公告使用版本校验，不会覆盖另一窗口',async t=>{
  const h=await harness(t);assert.deepEqual((await h.request('schedule?month=2026-10')).body.events,[]);
  const id=randomUUID(),event={date:'2026-10-23',time:'14:30',title:'合成培训候选',courseId:regular.id,location:'候选测试',notes:'合成数据',version:0};
  assert.equal((await h.request('admin/schedule/'+id,{as:'admin',method:'PUT',body:event})).status,200);
  assert.equal((await h.request('admin/schedule/'+id,{as:'admin',method:'PUT',body:event})).status,409);
  assert.equal((await h.request('admin/schedule/'+randomUUID(),{as:'admin',method:'PUT',body:{...event,date:'2026-02-30'}})).status,400);
  assert.equal((await h.request('admin/schedule/'+id,{as:'admin',method:'DELETE',body:{version:1}})).status,200);
  const announcement=(await h.request('admin/announcements',{as:'admin'})).body.announcement;
  const a={title:'合成公告',body:'保存验证',galleryUrl:'',version:announcement.version};
  assert.equal((await h.request('admin/announcements',{as:'admin',method:'PUT',body:a})).status,200);
  assert.equal((await h.request('admin/announcements',{as:'admin',method:'PUT',body:a})).status,409);
});
test('必修分母仅来自明确配置与当前授权，未配置时为null',async t=>{
  const h=await harness(t);assert.equal((await h.request('my-progress')).body.summary.required,null);
  await h.request('admin/requirements/'+randomUUID(),{as:'admin',method:'PUT',body:{name:'候选清单',role:'all',courseIds:[regular.id,restricted.id],version:0}});
  assert.equal((await h.request('my-progress')).body.summary.required,1);
  await h.request('feedback',{method:'POST',body:feedback()});const s=(await h.request('my-progress')).body.summary;assert.equal(s.requiredCompleted,1);
});
test('课程人工补充保留；源表冲突明确提示，导入预览过时会拒绝',async t=>{
  const h=await harness(t),id=regular.id;
  const edit={version:1,overrides:{description:'人工核验补充'},resolvedFields:[]};
  assert.equal((await h.request('admin/courses/'+id,{as:'admin',method:'PATCH',body:edit})).status,200);
  const incoming=structuredClone(inventory),changed=incoming.courses.find(c=>c.id===id);changed.source_revision++;changed.fields.description.text='源表新介绍';
  let result=await h.request('admin/import/preview',{as:'admin',method:'POST',body:{inventory:incoming}});assert.equal(result.body.plan.conflicts.length,1);
  assert.equal((await h.request('admin/import/apply',{as:'admin',method:'POST',body:{previewId:result.body.previewId}})).status,200);
  const courses=(await h.request('admin/courses',{as:'admin'})).body.courses,c=courses.find(x=>x.id===id);assert.equal(c.description,'人工核验补充');assert.equal(c.sourceSnapshot.fields.description.text,'源表新介绍');assert.deepEqual(c.conflicts,['description']);
  result=await h.request('admin/import/preview',{as:'admin',method:'POST',body:{inventory:incoming}});
  await h.request('admin/courses/'+id,{as:'admin',method:'PATCH',body:{version:c.version,overrides:{description:'另一窗口补充'},resolvedFields:['description']}});
  assert.equal((await h.request('admin/import/apply',{as:'admin',method:'POST',body:{previewId:result.body.previewId}})).status,409);
});
test('重建标题块不自动合并课程身份，源表受限不能被补充解除',async t=>{
  const h=await harness(t),incoming=structuredClone(inventory),c=incoming.courses.find(c=>c.id===regular.id);
  c.source_block_id='doxcnRecreatedCourseBlock';c.id=`bmt-${c.source_document===inventory.courses[0].source_document?'swuf':'pmg'}-${hash(c.source_document+'/'+c.source_block_id).slice(0,12)}`;
  const preview=await h.request('admin/import/preview',{as:'admin',method:'POST',body:{inventory:incoming}});assert.equal(preview.body.plan.possibleDuplicates.length,1);
  assert.equal((await h.request('admin/import/apply',{as:'admin',method:'POST',body:{previewId:preview.body.previewId}})).status,409);
  await h.request('admin/courses/'+restricted.id,{as:'admin',method:'PATCH',body:{version:1,overrides:{restricted:false},resolvedFields:[]}});
  assert.equal((await h.request('courses/'+restricted.id)).body.course.canLearn,false);
});
test('非法资源地址、跨站提交与缺失CSRF被拒绝',async t=>{
  const h=await harness(t);
  assert.equal((await h.request('feedback',{method:'POST',csrf:false,body:feedback()})).status,403);
  assert.equal((await h.request('feedback',{method:'POST',body:feedback(),headers:{Origin:'https://other.example'}})).status,403);
  assert.equal((await h.request('admin/courses/'+regular.id,{as:'admin',method:'PATCH',body:{version:1,overrides:{resources:[{type:'reading',text:'',links:[{title:'XSS',url:'javascript:alert(1)'}]}]},resolvedFields:[]}})).status,400);
  assert.equal((await h.request('admin/courses/'+regular.id,{as:'admin',method:'PATCH',body:{version:1,overrides:{normalizedDate:'2026-10-01'},resolvedFields:[]}})).status,400);
});
test('文件数据库重启后仍可读完课与反馈',()=>{
  const directory=mkdtempSync(join(tmpdir(),'bmt-persistence-')),path=join(directory,'candidate.sqlite');
  let store=createStore(path,sourcePath);const user=store.register({id:'persistence-qa',name:'持久化测试',department:'品牌营销部',isAdmin:false}),p=feedback();store.submitFeedback(user,p);store.close();
  store=createStore(path,sourcePath);assert.equal(store.byRequest(user,p.requestId).progress.status,'completed');assert.equal(store.latestFeedback(user,regular.id).rating,5);store.close();
});
test('生产认证无token、过期、跨部门和身份服务故障均拒绝，身份由上游确认',async t=>{
  let mode='valid',employeeNumber='FD-026222';const oaFetch=async()=>{if(mode==='down')throw new Error('identity down');return {ok:true,status:200,json:async()=>({code:0,data:{number:employeeNumber,realName:'上游姓名',deptName:mode==='wrong'?'其他部门':'品牌营销部'}})};};
  const h=await harness(t,{identityProvider:undefined,oaFetch,managerIds:['026222']});
  assert.equal((await h.request('me')).status,401);
  const token='opaque-token-for-auth-test';let result=await h.request('me',{headers:{'x-oa-token':token}});assert.equal(result.status,200);assert.equal(result.body.user.name,'上游姓名');assert.equal(result.body.user.isAdmin,true);
  employeeNumber='FD-117110';const namespaceToken=token+'-route-owner';result=await h.request('me',{headers:{'x-oa-token':namespaceToken}});assert.equal(result.status,200);assert.equal(result.body.user.isAdmin,false);assert.equal((await h.request('admin/courses',{headers:{'x-oa-token':namespaceToken}})).status,403);employeeNumber='FD-026222';
  const expired='e.'+Buffer.from(JSON.stringify({exp:1})).toString('base64url')+'.sig';assert.equal((await h.request('me',{headers:{'x-oa-token':expired}})).status,401);
  mode='down';assert.equal((await h.request('me',{headers:{'x-oa-token':token+'2'}})).status,503);
  mode='wrong';const other=await harness(t,{identityProvider:undefined,oaFetch});assert.equal((await other.request('me',{headers:{'x-oa-token':token+'3'}})).status,403);
});
test('公司姓名工号中心保持上游权威，个人与管理员不能改写，岗位偏好不赋权',async t=>{
  const companyIdentity=req=>({id:req.headers['x-test-role']==='admin'?'qa-admin':'026222',name:'公司姓名',department:'品牌营销部-AI营销中心',center:'伪造中心',isAdmin:req.headers['x-test-role']==='admin'});
  const h=await harness(t,{identityProvider:companyIdentity});
  const me=(await h.request('me')).body.user;
  assert.equal(me.id,'026222');assert.equal(me.name,'公司姓名');assert.equal(me.center,'AI营销中心');
  for(const field of ['center','department','name','id']) {
    assert.equal((await h.request('me',{method:'PATCH',body:{jobRole:'management',[field]:'篡改'}})).status,400);
    assert.equal((await h.request('admin/learners/026222',{as:'admin',method:'PATCH',body:{jobRole:'management',managementAccess:false,[field]:'篡改'}})).status,400);
  }
  assert.equal((await h.request('me',{method:'PATCH',body:{jobRole:'management'}})).status,200);
  assert.equal((await h.request('courses/'+restricted.id)).body.course.canLearn,false);
  await h.request('feedback',{method:'POST',body:feedback()});
  h.store.db.prepare("UPDATE users SET center='历史手填值' WHERE id='026222'").run();
  const rows=(await h.request('leaderboard',{as:'admin'})).body.rows;
  assert.equal(rows[0].id,'026222');assert.equal(rows[0].center,'AI营销中心');assert.equal(rows[0].department,'品牌营销部-AI营销中心');
  assert.equal((await h.request('admin/learners',{as:'admin'})).body.learners.find(u=>u.id==='026222').center,'AI营销中心');
  assert.equal((await h.request('me')).body.user.center,'AI营销中心');
});
