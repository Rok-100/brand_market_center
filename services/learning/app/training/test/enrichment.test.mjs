import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createStore } from '../server/store.mjs';
import { publicCourse, sourceCourse } from '../server/model.mjs';

const inventory=JSON.parse(readFileSync(new URL('../data/course-inventory.json',import.meta.url),'utf8'));
const source=inventory.courses.find(c=>!c.restricted&&c.fields.recordings.links.length===1);
const url=source.fields.recordings.links[0].url;
const entry={sourceBlock:source.source_block_id,recordings:[{url,title:'已核验录播',durationSeconds:3661}],defaultRecordingUrl:url,durationMinutes:62,durationSeconds:3661,durationBasis:'recording',description:'依据课件补充的介绍',descriptionSource:{url:source.source_url}};
const row=(overrides={},snapshot=source)=>({source_json:JSON.stringify(snapshot),override_json:JSON.stringify(overrides),version:3,updated_at:'2026-10-13T00:00:00Z'});
const learner={id:'enrichment-learner',name:'核验学员',department:'品牌营销部-AI营销中心',isAdmin:false};
const admin={...learner,isAdmin:true};

test('核验数据只叠加到相符来源，逐条回放时长及默认选择可读',()=>{
  const view=publicCourse(row(),learner,entry);
  assert.equal(view.durationMinutes,62);assert.equal(view.durationSeconds,3661);assert.equal(view.defaultRecordingUrl,url);
  assert.equal(view.description,entry.description);
  assert.equal(view.resources.find(r=>r.type==='recordings').links[0].durationSeconds,3661);
  assert.equal(view.resources.find(r=>r.type==='recordings').links[0].title,'已核验录播');
  assert.equal(view.enrichmentStatus,undefined);
  assert.equal(source.duration_minutes,null);
  for(const stale of [{...entry,sourceBlock:'different-block'},{...entry,recordings:[{url:url+'?changed=1',durationSeconds:3661}]}]) {
    const staleView=publicCourse(row(),admin,stale);
    assert.equal(staleView.durationMinutes,null);assert.equal(staleView.description,source.fields.description.text);
    assert.equal(staleView.enrichmentStatus.reason,'source-changed');
  }
  const updatedSource=structuredClone(source);updatedSource.fields.description.text='来源后来补齐的最新简介';
  assert.equal(publicCourse(row({},updatedSource),learner,entry).description,'来源后来补齐的最新简介');
});
test('管理员课程覆盖优先，替换录播不继承旧时长，清空时长不被自动填回',()=>{
  let view=publicCourse(row({durationMinutes:90,description:'管理员定稿'}),learner,entry);
  assert.equal(view.durationMinutes,90);assert.equal(view.durationSeconds,5400);assert.equal(view.description,'管理员定稿');assert.equal(view.descriptionSource,undefined);
  view=publicCourse(row({durationMinutes:null}),learner,entry);assert.equal(view.durationMinutes,null);assert.equal(view.durationSeconds,null);
  const resources=sourceCourse(source).resources.map(group=>group.type==='recordings'?{...group,links:[{title:'替换回放',url:url+'?changed=1'}]}:group);
  view=publicCourse(row({resources}),admin,entry);assert.equal(view.durationMinutes,null);assert.equal(view.defaultRecordingUrl,undefined);assert.equal(view.enrichmentStatus.reason,'source-changed');
  resources.find(group=>group.type==='recordings').links=[{title:'管理员指定的回放名称',url}];
  view=publicCourse(row({resources}),admin,entry);assert.equal(view.resources.find(group=>group.type==='recordings').links[0].title,'管理员指定的回放名称');assert.equal(view.durationSeconds,3661);
});
test('真实管理课程的权限占位可补简介，正式来源人工覆盖和访问限制保持优先',()=>{
  const snapshot=structuredClone(inventory.courses.find(c=>c.id==='bmt-swuf-eef7aada23e1'));
  assert.equal(snapshot.fields.description.text,'管理培训暂不面向岛民开放');
  const verified={sourceBlock:snapshot.source_block_id,sourceRecordingUrls:[],recordings:[],description:'依据已核验逐字稿整理的营销经营课程介绍',descriptionSource:{url:snapshot.source_url}};
  let view=publicCourse(row({},snapshot),learner,verified);
  assert.equal(view.description,verified.description);assert.equal(view.restricted,true);assert.equal(view.canLearn,false);assert.equal(view.descriptionSource,undefined);
  assert.equal(publicCourse(row({},snapshot),admin,verified).canLearn,true);
  view=publicCourse(row({description:'管理员确认的课程介绍'},snapshot),admin,verified);assert.equal(view.description,'管理员确认的课程介绍');
  snapshot.fields.description.text='来源后来补齐的正式课程介绍';
  assert.equal(publicCourse(row({},snapshot),admin,verified).description,'来源后来补齐的正式课程介绍');
  snapshot.fields.description.text='本课说明：管理培训暂不面向岛民开放';
  assert.equal(publicCourse(row({},snapshot),admin,verified).description,'本课说明：管理培训暂不面向岛民开放');
});
test('多批次录播按默认回放计时，只有明确顺序课程可相加',()=>{
  const snapshot=structuredClone(source);snapshot.fields.recordings.links.push({title:'第二批次',url:url+'?batch=2'});
  const recordings=[{url,durationSeconds:1800},{url:url+'?batch=2',durationSeconds:2400}];
  const alternate={...entry,recordings,defaultRecordingUrl:recordings[1].url,durationMinutes:40,durationSeconds:2400,durationBasis:'alternative'};
  let view=publicCourse(row({},snapshot),learner,alternate);assert.equal(view.durationSeconds,2400);assert.equal(view.defaultRecordingUrl,recordings[1].url);
  view=publicCourse(row({},snapshot),learner,{...alternate,durationMinutes:70,durationSeconds:4200});assert.equal(view.durationMinutes,null);
  view=publicCourse(row({},snapshot),learner,{...alternate,durationMinutes:70,durationSeconds:4200,durationBasis:'sequential'});assert.equal(view.durationSeconds,4200);
  view=publicCourse(row({},snapshot),learner,{...alternate,recordings:[{url,durationSeconds:null},recordings[1]]});assert.equal(view.durationSeconds,2400);
});
test('有来源证据的遗漏回放可恢复，来源变化或人工资源覆盖不补回，受限课不泄漏URL',()=>{
  const snapshot=structuredClone(source);snapshot.fields.recordings.links=[];
  const recovered={...entry,sourceRecordingUrls:[],recordings:[],recoveredRecordings:[{url,title:'找回的回放',durationSeconds:3661,evidenceSourceBlock:source.source_block_id}],durationBasis:'recovered-recording'};
  let view=publicCourse(row({},snapshot),learner,recovered);
  assert.equal(view.durationSeconds,3661);assert.equal(view.resources.find(r=>r.type==='recordings').links[0].url,url);assert.equal(view.defaultRecordingUrl,url);
  const replaced=structuredClone(snapshot);replaced.fields.recordings.links=[{title:'新来源',url:url+'?new=1'}];
  view=publicCourse(row({},replaced),learner,recovered);assert.equal(view.durationMinutes,null);assert.equal(view.defaultRecordingUrl,undefined);
  view=publicCourse(row({resources:sourceCourse(snapshot).resources},snapshot),learner,recovered);assert.equal(view.resources.find(r=>r.type==='recordings').links.length,0);assert.equal(view.durationMinutes,null);
  snapshot.restricted=true;view=publicCourse(row({},snapshot),learner,recovered);
  assert.equal(view.canLearn,false);assert.equal(view.defaultRecordingUrl,undefined);assert.ok(view.resources.every(group=>group.links.length===0));
  assert.equal(publicCourse(row({},snapshot),admin,recovered).resources.find(r=>r.type==='recordings').links[0].url,url);
});
test('旧数据库重启读取新核验文件，来源快照覆盖进度反馈不变，无文件正常启动',()=>{
  const directory=mkdtempSync(join(tmpdir(),'bmt-enrichment-')),inventoryPath=join(directory,'course-inventory.json'),dbPath=join(directory,'training.sqlite');
  writeFileSync(inventoryPath,JSON.stringify(inventory));
  let store=createStore(dbPath,inventoryPath);
  const user=store.register(learner),requestId=randomUUID();
  store.submitFeedback(user,{requestId,courseId:source.id,rating:5,doubts:'',suggestions:'',application:''});
  store.editCourse(admin,source.id,{version:1,overrides:{description:'保留已有人工内容'},resolvedFields:[]});
  const before=store.db.prepare('SELECT * FROM courses WHERE id=?').get(source.id);
  assert.equal(store.course(user,source.id).durationMinutes,null);store.close();
  writeFileSync(join(directory,'course-enrichment.json'),JSON.stringify({verifiedAt:'2026-10-13T00:00:00Z',courses:{[source.id]:entry}}));
  store=createStore(dbPath,inventoryPath);
  try {
    const view=store.course(user,source.id);assert.equal(view.durationSeconds,3661);assert.equal(view.description,'保留已有人工内容');
    assert.deepEqual(store.db.prepare('SELECT * FROM courses WHERE id=?').get(source.id),before);
    assert.equal(store.byRequest(user,requestId).progress.status,'completed');assert.equal(store.latestFeedback(user,source.id).rating,5);
  }finally{store.close();}
});
