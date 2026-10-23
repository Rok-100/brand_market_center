import test from 'node:test';
import assert from 'node:assert/strict';
import {createStore} from '../server/store.mjs';
const inventory=new URL('../data/course-inventory.json',import.meta.url);
test('学员岗位、课程选择与管理授权一并保存，撤权立即限制课程且保留选择',()=>{
 const store=createStore(':memory:',inventory);try{
 const admin=store.register({id:'admin',name:'测试管理员',department:'品牌营销部',isAdmin:true});
 const identity={id:'learner',name:'测试学员',department:'品牌营销部',isAdmin:false};
 let learner=store.register(identity);
 const restricted=store.listCourses(admin).find(c=>c.restricted);
 assert.equal(store.course(learner,restricted.id).canLearn,false);
 store.editLearner(admin,learner.id,{jobRole:'content',managementAccess:true,courseIds:[restricted.id]});
 learner=store.register(identity);
 assert.equal(store.course(learner,restricted.id).canLearn,true);
 assert.deepEqual(store.learners().find(u=>u.id===learner.id).courseIds,[restricted.id]);
 assert.equal(learner.jobRole,'content');
 store.editLearner(admin,learner.id,{jobRole:'content',managementAccess:false,courseIds:[restricted.id]});
 learner=store.register(identity);
 assert.equal(store.course(learner,restricted.id).canLearn,false);
 assert.equal(store.course(learner,restricted.id).resources.flatMap(r=>r.links).length,0);
 assert.deepEqual(store.learners().find(u=>u.id===learner.id).courseIds,[restricted.id]);
 assert.throws(()=>store.editLearner(admin,learner.id,{jobRole:'marketing',managementAccess:true,courseIds:['missing']}));
 assert.equal(store.register(identity).managementAccess,false);
 assert.throws(()=>store.editLearner(learner,learner.id,{jobRole:'management',managementAccess:true,courseIds:[]}),{status:403});
 }finally{store.close();}
});
