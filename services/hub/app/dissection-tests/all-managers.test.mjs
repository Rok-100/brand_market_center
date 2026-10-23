import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DissectionService} from '../dissection-service.mjs';
const people=[{number:'M1',name:'主管一',center:'中心一',role:'manager',active:true},{number:'M2',name:'主管二',center:'中心二',role:'manager',active:true},{number:'E1',name:'同事一',center:'中心一',role:'specialist',active:true},{number:'E2',name:'同事二',center:'中心二',role:'specialist',active:true},{number:'X',name:'停用主管',center:'中心一',role:'manager',active:false},{number:'D',name:'总监',center:'中心一',role:'director',active:true}].map(p=>({...p,modules:['workflow-engine'],workflowEnabled:true}));
const identity=number=>({user:{number,realName:number},permissions:{manage_permissions:number==='ADMIN'},workspace:{role:number==='ADMIN'?'maintainer':people.find(p=>p.number===number)?.role,center:people.find(p=>p.number===number)?.center,is_brand_department:number!=='ADMIN',is_system_maintainer:number==='ADMIN'},access:{allowed_modules:['workflow-engine']}});
function fixture(){const root=mkdtempSync(join(tmpdir(),'all-managers-'));writeFileSync(join(root,'token'),'fixture');let analyses=0,sent=[];const vault={value:null,save(v){this.value=v},read(){return this.value}};
 const report={id:'r',window:{dataDate:'2026-09-29'},materials:{status:'ready',items:[{id:'v',platform:'douyin',title:'视频',spend:30000,downloadUrl:'http://fixture/video'}]}};
 const service=new DissectionService({root,people:()=>people,vault,sessionFor:async()=>({status:200,payload:identity('ADMIN')}),env:{DAILY_INTELLIGENCE_URL:'http://fixture',INTELLIGENCE_INTERNAL_TOKEN_FILE:join(root,'token')},notifier:{recipient:n=>({id:n,type:'open_id'}),tenantToken:async()=>'fixture'},fetchImpl:async(url,options)=>String(url).endsWith('/models')?Response.json({code:0,data:{models:[{model_name:'video',is_use_video:1}]}}):String(url).endsWith('/report')?Response.json({report}):(sent.push(JSON.parse(options.body).receive_id),Response.json({code:0,data:{message_id:'msg-'+sent.length}})),analyzeImpl:async()=>{analyses++;return {result:[{time_range:'00:00.000-00:08.000',scene_description:'画面'}],assessment:{score:80,value:'high',summary:'可复刻'},duration:8}}});
 return {service,analyses:()=>analyses,sent:()=>sent,close(){service.close();rmSync(root,{recursive:true,force:true})}};
}
test('highest permission administrator can see and configure module outside business directory',()=>{const f=fixture();try{const access=f.service.access(identity('ADMIN'));assert.equal(access.enabled,true);assert.equal(access.configure,true);assert.equal(f.service.overview(access).access.enabled,true);}finally{f.close()}});
test('highest-permission managers retain their own review and canonical center in the director workspace',async()=>{
 const f=fixture(),s=f.service;
 try{
  await s.configure(s.access(identity('ADMIN')),{enabled:true,model:'video',expectedVersion:1},{'x-oa-token':'fixture'});await s.tick();
  const session={...identity('M1'),permissions:{manage_permissions:true},workspace:{role:'director',center:'部门视角',is_brand_department:true,is_system_maintainer:false}};
  const a=s.access(session);assert.equal(s.access({...session,workspace:{role:'maintainer',center:'系统管理',is_brand_department:false,is_system_maintainer:true}}).review,true);assert.equal(a.review,true);assert.equal(a.configure,true);assert.equal(a.center,'中心一');
  const overview=s.overview(a),own=overview.jobs.find(j=>j.reviewerNumber==='M1'),other=overview.jobs.find(j=>j.reviewerNumber==='M2');
  assert.ok(overview.colleagues.some(p=>p.number==='E1'));assert.ok(!overview.colleagues.some(p=>p.number==='E2'));
  assert.throws(()=>s.action(a,other.id,{action:'approve',expectedVersion:other.version,note:'越权'}),/指定审核主管/);
  s.action(a,own.id,{action:'approve',expectedVersion:own.version,note:'本人通过'});
  const approved=s.overview(a).jobs.find(j=>j.id===own.id);
  s.action(a,approved.id,{action:'assign',expectedVersion:approved.version,assigneeNumber:'E1',note:'本中心制作'});
  assert.equal(s.overview(a).jobs.find(j=>j.id===own.id).status,'assigned');
  assert.equal(s.overview(a).jobs.find(j=>j.id===other.id).status,'pending_review');
 }finally{f.close()}
});
test('administrator privileges do not fabricate supervisor identity for ordinary, absent or inactive accounts',()=>{
 const f=fixture(),s=f.service;
 try{for(const number of ['ADMIN','E1','X']){const a=s.access({user:{number},permissions:{manage_permissions:true},workspace:{role:'maintainer',is_system_maintainer:true}});assert.equal(a.enabled,true);assert.equal(a.configure,true);assert.equal(a.review,false);}}finally{f.close()}
});
test('one video is analyzed once while managers independently review and assign',async()=>{
 const f=fixture(),s=f.service;
 try{
  await s.configure(s.access(identity('ADMIN')),{enabled:true,model:'video',expectedVersion:1},{'x-oa-token':'fixture'});
  await s.tick();assert.equal(f.analyses(),1);
  let a=s.overview(s.access(identity('M1'))),b=s.overview(s.access(identity('M2')));
  assert.equal(a.jobs.length,1);assert.equal(b.jobs.length,1);assert.notEqual(a.jobs[0].id,b.jobs[0].id);
  assert.equal(a.jobs[0].status,'pending_review');assert.equal(b.jobs[0].status,'pending_review');
  assert.deepEqual(a.jobs[0].result,b.jobs[0].result);
  await s.flush();assert.deepEqual(f.sent().sort(),['M1','M2']);
  assert.throws(()=>s.action(s.access(identity('M1')),b.jobs[0].id,{action:'approve',expectedVersion:b.jobs[0].version,note:'越权'}),/处理权限/);
  s.action(s.access(identity('M1')),a.jobs[0].id,{action:'approve',expectedVersion:a.jobs[0].version,note:'复刻'});
  a=s.overview(s.access(identity('M1')));
  s.action(s.access(identity('M1')),a.jobs[0].id,{action:'assign',expectedVersion:a.jobs[0].version,assigneeNumber:'E1',note:'制作'});
  s.action(s.access(identity('M2')),b.jobs[0].id,{action:'reject',expectedVersion:b.jobs[0].version,note:'不适合本中心'});
  assert.equal(s.overview(s.access(identity('M1'))).jobs[0].status,'assigned');
  assert.equal(s.overview(s.access(identity('M2'))).jobs[0].status,'rejected');
  const assigned=s.overview(s.access(identity('E1'))).jobs[0];
  s.action(s.access(identity('E1')),assigned.id,{action:'accept',expectedVersion:assigned.version});
  assert.equal(s.overview(s.access(identity('M1'))).jobs[0].status,'accepted');
  assert.equal(s.overview(s.access(identity('M2'))).jobs[0].status,'rejected');
  await s.tick();assert.equal(f.analyses(),1);
  assert.equal(s.store.read().notices.filter(n=>n.kind==='review').length,2);
 }finally{f.close()}
});

test('verified email recipient works without expanding contact permissions',async()=>{const f=fixture(),s=f.service;try{s.notifier.appId='verified-app';s.notifier.recipient=n=>n==='M2'?null:{id:n,type:'open_id'};writeFileSync(join(s.root,'feishu-bindings.json'),JSON.stringify({appId:'verified-app',recipients:{M2:{name:'主管二',type:'email',id:'manager2@example.test'}}}));assert.equal(s.recipientFor('M2').type,'email');await s.configure(s.access(identity('ADMIN')),{enabled:true,model:'video',expectedVersion:1},{'x-oa-token':'fixture'});await s.tick();await s.flush();assert.deepEqual(f.sent().sort(),['M1','manager2@example.test']);writeFileSync(join(s.root,'feishu-bindings.json'),JSON.stringify({appId:'different-app',recipients:{M2:{name:'主管二',type:'email',id:'manager2@example.test'}}}));assert.equal(s.recipientFor('M2'),null);}finally{f.close()}});

test('queue counts unique videos while preserving separate manager records and polling versions',()=>{
 const f=fixture(),s=f.service;
 try{
  s.ingest({id:'r',materials:{status:'ready',items:['v1','v2','v3'].map(id=>({id,platform:'douyin',spend:30000,downloadUrl:'http://fixture/video'}))}});
  const access=s.access(identity('ADMIN')),a=s.overview(access);
  assert.equal(a.analysisCount,3);assert.equal(a.counts.queued,3);assert.equal(a.reviewTaskCount,6);assert.equal(a.jobs.length,6);
  assert.equal(new Set(a.jobs.map(j=>j.id)).size,6);
  const versions=a.jobs.map(j=>[j.id,j.version]).sort();
  assert.deepEqual(s.overview(access).jobs.map(j=>[j.id,j.version]).sort(),versions);
  const mine=s.overview(s.access(identity('M1')));
  assert.equal(mine.analysisCount,3);assert.equal(mine.reviewTaskCount,3);assert.equal(mine.counts.queued,3);
 }finally{f.close()}
});
