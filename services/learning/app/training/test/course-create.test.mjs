import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app.mjs';
import { createStore } from '../server/store.mjs';

const inventoryPath=new URL('../data/course-inventory.json',import.meta.url);
const payload=()=>({requestId:randomUUID(),title:'本地新增课程验证',category:'creative',lecturers:['讲师甲','讲师乙'],description:'课程介绍与目标',audience:'视频编辑',durationMinutes:60,historicalDate:'2026-10-20',dateBasis:'本地测试日期',enabled:true,restricted:false,resources:['reading','slides','recordings','other'].map(type=>({type,text:type+'资料说明',links:[{title:type+'入口',url:'https://example.feishu.cn/docx/testCourse'}]}))});
async function harness(t){
 const dbPath=join(mkdtempSync(join(tmpdir(),'wis-course-create-')),'test.sqlite');
 const instance=createApp({dbPath,inventoryPath,csrfSecret:'course-create-test-secret-more-than-32-characters',identityProvider:req=>({id:req.headers['x-test-role']==='learner'?'test-learner':'test-admin',name:'测试人员',department:'品牌营销部',isAdmin:req.headers['x-test-role']!=='learner'})});
 const server=instance.app.listen(0,'127.0.0.1');await new Promise(r=>server.on('listening',r));
 let closed=false;const close=async()=>{if(!closed){closed=true;await new Promise(r=>server.close(r));instance.close();}};t.after(close);
 const base='http://127.0.0.1:'+server.address().port;
 async function request(path,{method='GET',body,role='admin',csrf=true}={}){
  const headers={'Content-Type':'application/json','x-test-role':role};
  if(method!=='GET'&&csrf){const me=await fetch(base+'/api/me',{headers}).then(r=>r.json());headers['X-CSRF-Token']=me.csrfToken;}
  const response=await fetch(base+'/api/'+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
  return {status:response.status,body:await response.json()};
 }
 return {request,close,dbPath,store:instance.store};
}
test('新增课程完整保存四组资料，可学习、编辑且重启后保留',async t=>{
 const h=await harness(t),p=payload();
 const result=await h.request('admin/courses',{method:'POST',body:p});assert.equal(result.status,201);
 const c=result.body.course;assert.equal(c.title,p.title);assert.deepEqual(c.lecturers,p.lecturers);assert.equal(c.durationMinutes,60);assert.equal(c.normalizedDate,p.historicalDate);assert.deepEqual(c.resources,p.resources);assert.equal(c.source.document,'manual');
 assert.ok((await h.request('courses',{role:'learner'})).body.courses.some(row=>row.id===c.id));
 assert.equal((await h.request('feedback',{role:'learner',method:'POST',body:{requestId:randomUUID(),courseId:c.id,rating:5,doubts:'',suggestions:'',application:'测试应用'}})).status,200);
 assert.ok(c.sourceSnapshot);assert.deepEqual(c.conflicts,[]);assert.equal(c.overrides.enabled,true);
 assert.equal(Object.hasOwn((await h.request('courses/'+c.id,{role:'learner'})).body.course,'sourceSnapshot'),false);
 const edited=await h.request('admin/courses/'+c.id,{method:'PATCH',body:{version:c.version,overrides:{title:'新增课程编辑后'},resolvedFields:[]}});assert.equal(edited.status,200);
 assert.equal(edited.body.course.overrides.title,'新增课程编辑后');assert.ok(edited.body.course.sourceSnapshot);assert.deepEqual(edited.body.course.conflicts,[]);
 const second=await h.request('admin/courses/'+c.id,{method:'PATCH',body:{version:edited.body.course.version,overrides:{title:'连续保存后的课程'},resolvedFields:[]}});assert.equal(second.status,200);assert.equal(second.body.course.version,c.version+2);
 await h.close();const store=createStore(h.dbPath,inventoryPath);try{assert.equal(store.course({isAdmin:true},c.id).title,'连续保存后的课程');}finally{store.close();}
});
test('重复保存同一表单只创建一次，同一提交标识更改内容拒绝覆盖',async t=>{
 const h=await harness(t),p=payload();const before=h.store.adminCourses({isAdmin:true}).length;
 assert.equal((await h.request('admin/courses',{method:'POST',body:p})).status,201);
 assert.equal((await h.request('admin/courses',{method:'POST',body:p})).body.duplicate,true);
 assert.equal((await h.request('admin/courses',{method:'POST',body:{...p,title:'另一份'}})).status,409);
 assert.equal(h.store.adminCourses({isAdmin:true}).length,before+1);
});
test('学员不能新增课程；缺少页面校验不能写入',async t=>{
 const h=await harness(t);
 assert.equal((await h.request('admin/courses',{method:'POST',role:'learner',body:payload()})).status,403);
 assert.equal((await h.request('admin/courses',{method:'POST',csrf:false,body:payload()})).status,403);
});
test('非法课程信息与链接拒绝保存且不产生半条课程',async t=>{
 const h=await harness(t),p=payload(),before=h.store.adminCourses({isAdmin:true}).length;
 const cases=[{title:''},{category:'unknown'},{durationMinutes:-1},{historicalDate:'2026-02-30'},{dateBasis:''},{resources:[...p.resources.slice(0,3),p.resources[0]]},{resources:p.resources.map(r=>({...r,links:[{title:'不安全链接',url:'javascript:alert(1)'}]}))}];
 for(const change of cases)assert.equal((await h.request('admin/courses',{method:'POST',body:{...p,...change}})).status,400);
 assert.equal(h.store.adminCourses({isAdmin:true}).length,before);
});
test('不显示课程仅在管理列表保留；管理受限课程不给普通学员资料链接',async t=>{
 const h=await harness(t);
 const hidden=(await h.request('admin/courses',{method:'POST',body:{...payload(),enabled:false}})).body.course;
 const restricted=(await h.request('admin/courses',{method:'POST',body:{...payload(),restricted:true}})).body.course;
 const courses=(await h.request('courses',{role:'learner'})).body.courses;
 assert.ok(!courses.some(c=>c.id===hidden.id));
 const c=courses.find(c=>c.id===restricted.id);assert.equal(c.canLearn,false);assert.ok(c.resources.every(r=>r.links.length===0));
});
