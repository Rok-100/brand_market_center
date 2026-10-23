import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createStore} from '../server/store.mjs';
const inventory=new URL('../data/course-inventory.json',import.meta.url);
test('管理员分配中心跨登录和重启保留，兼容旧库，非法中心和越权不写入',()=>{
 const file=join(mkdtempSync(join(tmpdir(),'learning-centers-')),'test.sqlite');let store=createStore(file,inventory);
 const adminIdentity={id:'admin',name:'管理员',department:'AI效率流程部',isAdmin:true};
 const identity={id:'learner',name:'学员',department:'品牌营销部-视频中心',isAdmin:false};
 store.register(identity);store.db.exec('ALTER TABLE users DROP COLUMN center_override');store.close();store=createStore(file,inventory);
 try{const admin=store.register(adminIdentity);const learner=store.register(identity);assert.equal(learner.center,'视频中心');
 const payload={center:'AI营销中心',jobRole:'content',managementAccess:false,courseIds:[]};
 assert.throws(()=>store.editLearner(learner,learner.id,payload),{status:403});
 store.editLearner(admin,learner.id,payload);assert.equal(store.register(identity).center,'AI营销中心');
 store.close();store=createStore(file,inventory);assert.equal(store.register(identity).center,'AI营销中心');assert.equal(store.learners().find(x=>x.id===identity.id).center,'AI营销中心');
 assert.equal(store.register({...identity,department:'品牌营销部-直播中心'}).center,'AI营销中心');
 assert.throws(()=>store.editLearner(admin,learner.id,{...payload,center:'非法中心'}),{status:400});assert.equal(store.register(identity).center,'AI营销中心');
 store.editLearner(admin,learner.id,{...payload,center:'未分中心'});assert.equal(store.register(identity).center,'未分中心');
 store.editLearner(admin,learner.id,{...payload,center:null});assert.equal(store.register(identity).center,'视频中心');
 assert.ok(store.audit().some(r=>JSON.parse(r.detail_json).center==='AI营销中心'));
 }finally{store.close();}
});
