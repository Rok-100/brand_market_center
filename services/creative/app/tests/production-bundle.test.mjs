import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createD1Mysql} from '../dist/server/d1_mysql.mjs';
import {creativeSchema} from '../dist/server/creative_schema.mjs';
const bundle=fs.readFileSync('dist/server/index.js','utf8');

test('effective production bundle contains notification routes and validated native storage',()=>{
 for(const marker of ['notificationChatId','notification-chats','ACT-FINAL-','mysqlEnvironment(nativeEnv)','sameProfile'])assert.ok(bundle.includes(marker),marker);
 assert.deepEqual(creativeSchema.script_notification_payloads,['notification_id','payload']);
 assert.deepEqual(creativeSchema.script_notification_chats,['id','user_id','chat_id','updated_at']);
});
test('compiled production bootstrap keeps read-only and profile optimization behavior',async()=>{
 const identity={employeeNo:'FD-TEST',name:'Test',department:'',center:'',jobTitle:'',email:'',externalUserId:'test',feishuUserId:''};
 const canonical={id:'USR-TEST',employee_no:'FD-TEST',name:'Test',department:'',center:'',job_title:'',email:'',external_user_id:'test',feishu_user_id:'',role:'supervisor',active:1,login_registered:1,last_seen_at:new Date().toISOString()};
 let reads=0;
 const db=createD1Mysql({PINYING_DATA_URL:'http://brand-marketing-fd-026222-data-gateway:8080',PINYING_DATA_TOKEN:'fixture'},async(_url,request)=>{
  reads++;return Response.json(JSON.parse(request.body).queries.map(({sql})=>{
   assert.ok(!/^(INSERT|UPDATE|DELETE)/i.test(sql.trim()),'Unexpected profile/seed write');
   const table=/table_info\((\w+)\)/.exec(sql)?.[1];
   return {results:table?creativeSchema[table].map(name=>({name})):sql.includes('pinying_database_status')?[{read_only:true}]:[canonical]};
  }));
 });
 const scope=vm.createContext({env:{DB:db},Date,Set,Map,Number,String,Error,identityFromRequest:async()=>identity,mapUser:row=>structuredClone(row),isEmployeeNumber:()=>true});
 const schema=bundle.slice(bundle.indexOf('var draftColumns ='),bundle.indexOf('function uid('));
 const current=bundle.slice(bundle.indexOf('async function getCurrentUser(request)'),bundle.indexOf('async function listWorkspaceUsers()'));
 assert.ok(schema.includes('ensureWorkflowSchema'));assert.ok(current.includes('sameProfile'));
 vm.runInContext(schema+'\n'+current,scope);
 await Promise.all([scope.ensureWorkflowSchema(),scope.ensureWorkflowSchema()]);assert.equal(reads,1);
 assert.equal((await scope.getCurrentUser({})).role,'supervisor');canonical.active=0;
 await assert.rejects(scope.getCurrentUser({}),/未启用/);
 scope.identityFromRequest=async()=>{throw Error('Access denied');};await assert.rejects(scope.getCurrentUser({}),/Access denied/);
});
