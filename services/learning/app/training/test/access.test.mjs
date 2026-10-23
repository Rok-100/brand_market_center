import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app.mjs';

const inventoryPath=new URL('../data/course-inventory.json',import.meta.url);
const inventory=JSON.parse(readFileSync(inventoryPath,'utf8'));
const regular=inventory.courses.find(course=>!course.restricted),restricted=inventory.courses.find(course=>course.restricted);
const identities={admin:{number:'FD-026222',realName:'合成管理员',deptName:'品牌营销部-AI营销中心'},otherAdmin:{number:'026223',realName:'另一管理员',deptName:'其他部门'},member:{number:'012345',realName:'部门学员',deptName:'品牌营销部-内容中心'},external:{number:'FD-000321',realName:'公司认证姓名',deptName:'品牌创意部'},emptyDepartment:{number:'000322',realName:'无部门学员',deptName:''}};
async function harness(t,options={}) {
  const calls=new Map();let time=Date.parse('2026-10-13T08:00:00Z'),mode='ok';
  const oaFetch=async(_url,init)=>{
    const key=init.headers.Authorization.replace('Bearer test-token-','');calls.set(key,(calls.get(key)||0)+1);
    if(mode==='down')throw new Error('unavailable');
    const info=identities[key];return {ok:!!info,status:info?200:401,json:async()=>({code:0,data:info})};
  };
  const instance=createApp({dbPath:':memory:',inventoryPath,enrichmentPath:null,csrfSecret:'access-test-secret-with-more-than-32-characters',managerIds:['026222','026223'],oaFetch,clock:()=>time,...options});
  const server=instance.app.listen(0,'127.0.0.1');await new Promise(resolve=>server.on('listening',resolve));
  let closed=false;const close=async()=>{if(closed)return;closed=true;await new Promise(resolve=>server.close(resolve));instance.close();};t.after(close);
  const base=`http://127.0.0.1:${server.address().port}/api/`;
  async function request(path,{as='admin',method='GET',body,csrf=true,headers={}}={}) {
    const tokenHeaders=as?{'X-OA-Token':'test-token-'+as}:{};
    const me=csrf&&method!=='GET'?await fetch(base+'me',{headers:tokenHeaders}).then(response=>response.json()):null;
    const response=await fetch(base+path,{method,headers:{...tokenHeaders,'Content-Type':'application/json',...(me?.csrfToken?{'X-CSRF-Token':me.csrfToken}:{}),...headers},body:body===undefined?undefined:JSON.stringify(body)});
    return {status:response.status,body:await response.json()};
  }
  const apply=entries=>request('admin/access/apply',{method:'POST',body:{requestId:randomUUID(),entries}});
  return {...instance,request,apply,calls,close,advance:ms=>{time+=ms;},setMode:value=>{mode=value;}};
}
const grant=(employeeId='000321',version=0)=>({employeeId,labelName:'名单备注姓名',note:'合成验证',version,action:'grant'});
const revoke=(employeeId='000321',version=1)=>({employeeId,version,action:'revoke'});

test('外部未登录前可加名单但不造学员；OA身份缓存内撤权即拒绝并保持原学习记录',async t=>{
  const h=await harness(t);
  let result=await h.request('me',{as:'external'});assert.equal(result.status,403);assert.equal(result.body.code,'ACCESS_NOT_GRANTED');
  assert.equal(h.store.db.prepare("SELECT count(*) n FROM users WHERE id='000321'").get().n,0);
  result=await h.apply([grant(' FD-000321 ')]);assert.equal(result.status,200);assert.equal(result.body.summary.granted,1);assert.equal(result.body.entries[0].employeeId,'000321');assert.equal(result.body.entries[0].verifiedName,'');
  assert.equal(h.store.db.prepare("SELECT count(*) n FROM users WHERE id='000321'").get().n,0);
  assert.equal(h.store.db.prepare('SELECT count(*) n FROM progress').get().n,0);assert.deepEqual((await h.request('leaderboard')).body.rows,[]);
  result=await h.request('me',{as:'external'});assert.equal(result.status,200);assert.equal(result.body.user.id,'000321');assert.equal(result.body.user.name,'公司认证姓名');assert.equal(result.body.user.department,'品牌创意部');assert.equal(result.body.user.accessBasis,'whitelist');assert.equal(result.body.user.isAdmin,false);assert.equal(result.body.user.managementAccess,false);
  const savedFeedback={requestId:randomUUID(),courseId:regular.id,rating:5,doubts:'',suggestions:'',application:'隔离测试'};
  assert.equal((await h.request('feedback',{as:'external',method:'POST',body:savedFeedback})).status,200);
  assert.equal((await h.request('courses/'+restricted.id,{as:'external'})).body.course.canLearn,false);
  assert.equal((await h.request('admin/access',{as:'external'})).status,403);
  assert.equal((await h.apply([revoke()])).status,200);
  for(const path of ['me','courses','my-progress'])assert.equal((await h.request(path,{as:'external'})).status,403);
  assert.equal((await h.request('feedback',{as:'external',method:'POST',body:{...savedFeedback,requestId:randomUUID()}})).body.code,'ACCESS_NOT_GRANTED');
  assert.equal((await h.request('study-sessions/tick',{as:'external',method:'POST',body:{}})).body.code,'ACCESS_NOT_GRANTED');
  assert.equal(h.calls.get('external'),1);
  assert.equal(h.store.db.prepare('SELECT count(*) n FROM feedback').get().n,1);
  assert.equal((await h.apply([grant('000321',2)])).body.summary.restored,1);
  assert.equal((await h.request('my-progress',{as:'external'})).body.records[0].status,'completed');
  const listed=(await h.request('admin/access')).body.entries[0];assert.equal(listed.verifiedName,'公司认证姓名');assert.equal(listed.labelName,'名单备注姓名');assert.equal(listed.labelMismatch,true);
});

test('空部门保持空，撤销后不会因缓存或伪造本部门身份继续放行',async t=>{
  const h=await harness(t);await h.apply([grant('000322')]);
  let result=await h.request('me',{as:'emptyDepartment'});assert.equal(result.status,200);assert.equal(result.body.user.department,'');assert.equal(result.body.user.center,'');
  assert.equal(h.store.db.prepare("SELECT department FROM users WHERE id='000322'").get().department,'');
  await h.apply([revoke('000322')]);result=await h.request('me',{as:'emptyDepartment'});assert.equal(result.status,403);assert.equal(h.calls.get('emptyDepartment'),1);
});

test('批量预览归一前导零、重复、已授权撤销与错误；预览不开放访问',async t=>{
  const h=await harness(t);await h.apply([grant('000400'),grant('000401')]);await h.apply([revoke('000401')]);
  const entries=[{employeeId:'FD-000321',labelName:'甲'},{employeeId:'000321',labelName:'重复甲'},{employeeId:'000400',labelName:'已授权'},{employeeId:'000401',labelName:'已撤销'},{employeeId:322,labelName:'数字错误'}];
  let result=await h.request('admin/access/preview',{method:'POST',body:{entries,restoreRevoked:false}});assert.equal(result.status,200);assert.equal(result.body.canApply,false);assert.deepEqual(result.body.summary,{new:1,active:1,revoked:1,automatic:0,duplicates:1,errors:1,toApply:1});assert.equal(result.body.entries[3].action,null);
  assert.equal(h.store.db.prepare("SELECT count(*) n FROM platform_access WHERE employee_id='000321'").get().n,0);
  result=await h.request('admin/access/preview',{method:'POST',body:{entries:entries.slice(0,-1),restoreRevoked:true}});assert.equal(result.body.canApply,true);assert.equal(result.body.entries[3].action,'grant');assert.equal(result.body.entries[3].version,2);
  assert.equal((await h.apply([grant(321)])).status,400);assert.equal((await h.apply([grant('000321'),grant('FD-000321')])).status,400);
});

test('同标识批量提交可读回且仅写一次；改内容或读取他人回执受拒绝',async t=>{
  const h=await harness(t),requestId=randomUUID(),entries=[grant('000321'),grant('000322')];
  const first=await h.request('admin/access/apply',{method:'POST',body:{requestId,entries}});assert.equal(first.status,200);assert.equal(first.body.summary.granted,2);
  const again=await h.request('admin/access/apply',{method:'POST',body:{requestId,entries:[...entries].reverse()}});assert.equal(again.body.duplicate,true);assert.equal(again.body.savedAt,first.body.savedAt);
  assert.equal((await h.request('admin/access/receipts/'+requestId)).body.requestId,requestId);
  assert.equal((await h.request('admin/access/receipts/'+requestId,{as:'otherAdmin'})).status,404);
  assert.equal((await h.request('admin/access/apply',{method:'POST',body:{requestId,entries:[{...entries[0],note:'改变内容'}]}})).status,409);
  assert.equal(h.store.db.prepare("SELECT count(*) n FROM audit WHERE action='platform-access.grant'").get().n,2);
  const detail=JSON.parse(h.store.db.prepare("SELECT detail_json FROM audit WHERE object_id='000321'").get().detail_json);assert.equal(detail.before,null);assert.equal(detail.after.status,'active');assert.equal(detail.requestId,requestId);
});

test('并发旧版本或数据库失败整批回滚，不覆盖撤权也不产生回执',async t=>{
  const h=await harness(t);await h.apply([grant()]);await h.apply([revoke()]);
  let result=await h.apply([grant('000321',1),grant('000322')]);assert.equal(result.status,409);assert.equal(result.body.code,'ACCESS_VERSION_CONFLICT');assert.equal(h.store.access.has('000321'),false);assert.equal(h.store.access.has('000322'),false);
  h.store.db.exec("CREATE TRIGGER access_qa_fail BEFORE INSERT ON audit WHEN NEW.object_id='000322' BEGIN SELECT RAISE(ABORT,'isolated audit failure'); END;");
  const requestId=randomUUID(),entries=[grant('000323'),grant('000322')];result=await h.request('admin/access/apply',{method:'POST',body:{requestId,entries}});assert.equal(result.status,500);
  assert.equal(h.store.db.prepare("SELECT count(*) n FROM platform_access WHERE employee_id IN ('000322','000323')").get().n,0);assert.equal((await h.request('admin/access/receipts/'+requestId)).status,404);
  h.store.db.exec('DROP TRIGGER access_qa_fail');assert.equal((await h.request('admin/access/apply',{method:'POST',body:{requestId,entries}})).status,200);
});

test('公司部门与管理员保护、普通学员越权与跨站提交受约束',async t=>{
  const h=await harness(t,{allowedEmployeeIds:['012345','026222']});
  assert.equal((await h.request('me',{as:'member'})).body.user.accessBasis,'department');
  assert.equal((await h.apply([revoke('012345')])).status,200);assert.equal((await h.request('me',{as:'member'})).status,200);
  const result=await h.apply([grant('026222')]);assert.equal(result.body.summary.skipped,1);assert.equal(result.body.entries[0].accessBasis,'administrator');assert.equal(h.store.access.has('026222'),false);
  for(const [path,method,body] of [['admin/access','GET'],['admin/access/preview','POST',{entries:[{employeeId:'000321',labelName:'甲'}]}],['admin/access/apply','POST',{requestId:randomUUID(),entries:[grant()]}],['admin/access/receipts/'+randomUUID(),'GET']])assert.equal((await h.request(path,{as:'member',method,body})).status,403);
  assert.equal((await h.request('admin/access/apply',{method:'POST',body:{requestId:randomUUID(),entries:[{...grant(),isAdmin:true}]}})).status,400);
  assert.equal((await h.request('admin/access/apply',{method:'POST',csrf:false,body:{requestId:randomUUID(),entries:[grant()]}})).status,403);
  assert.equal((await h.request('admin/access/preview',{method:'POST',headers:{Origin:'https://other.example'},body:{entries:[{employeeId:'000321',labelName:'甲'}]}})).status,403);
});

test('静态名单只迁移一次，保留撤销状态，重启不能使用旧环境绕过',async t=>{
  const path=join(mkdtempSync(join(tmpdir(),'bmt-access-')),'training.sqlite');
  let h=await harness(t,{dbPath:path,allowedEmployeeIds:['FD-000321','000321']});assert.equal(h.store.access.has('000321'),true);
  assert.equal(h.store.db.prepare("SELECT count(*) n FROM users WHERE id='000321'").get().n,0);
  assert.equal((await h.request('me',{as:'external'})).status,200);await h.apply([revoke()]);await h.close();
  h=await harness(t,{dbPath:path,allowedEmployeeIds:['000321','000322']});assert.equal(h.store.access.has('000321'),false);assert.equal(h.store.access.has('000322'),false);assert.equal((await h.request('me',{as:'external'})).status,403);
  assert.equal(h.store.db.prepare("SELECT count(*) n FROM audit WHERE action='platform-access.migrate'").get().n,1);
  assert.equal(h.store.db.prepare("SELECT status FROM platform_access WHERE employee_id='000321'").get().status,'revoked');
});

test('空静态名单也永久标记迁移，首次升级后新增环境值不成为授权旁路',async t=>{
  const path=join(mkdtempSync(join(tmpdir(),'bmt-empty-access-')),'training.sqlite');
  let h=await harness(t,{dbPath:path});await h.close();
  h=await harness(t,{dbPath:path,allowedEmployeeIds:['000321']});assert.equal(h.store.access.has('000321'),false);assert.equal((await h.request('me',{as:'external'})).status,403);
});

test('历史空姓名名单可撤销并按原标签恢复，回执幂等且新授权仍要求姓名',async t=>{
  const h=await harness(t,{allowedEmployeeIds:['000321']});
  assert.equal((await h.request('admin/access')).body.entries[0].labelName,'');
  assert.equal((await h.apply([revoke()])).status,200);
  const requestId=randomUUID(),entries=[{employeeId:'000321',labelName:'',note:'',version:2,action:'grant'}];
  const first=await h.request('admin/access/apply',{method:'POST',body:{requestId,entries}});
  assert.equal(first.status,200);assert.equal(first.body.summary.restored,1);assert.equal(first.body.entries[0].labelName,'');assert.equal(first.body.entries[0].version,3);
  const retry=await h.request('admin/access/apply',{method:'POST',body:{requestId,entries}});
  assert.equal(retry.status,200);assert.equal(retry.body.duplicate,true);assert.equal(retry.body.savedAt,first.body.savedAt);
  assert.equal((await h.request('me',{as:'external'})).status,200);
  assert.equal((await h.apply([{...grant('000322'),labelName:''}])).status,400);
  await h.apply([grant('000323')]);await h.apply([revoke('000323')]);
  assert.equal((await h.apply([{...grant('000323',2),labelName:''}])).status,400);
  assert.equal(h.store.access.has('000323'),false);
});

test('白名单不能绕过公司登录失效或上游不可用，provider隔离身份也实时检查名单',async t=>{
  const h=await harness(t);await h.apply([grant()]);assert.equal((await h.request('me',{as:null})).status,401);h.setMode('down');assert.equal((await h.request('me',{as:'external'})).status,503);
  const injected=await harness(t,{identityProvider:req=>req.headers['x-oa-token']==='test-token-admin'?{id:'026222',name:'隔离管理员',department:'品牌营销部',isAdmin:true}:{id:'000321',name:'隔离外部',department:'品牌创意部',isAdmin:false}});
  assert.equal((await injected.request('me',{as:'external'})).status,403);await injected.apply([grant()]);assert.equal((await injected.request('me',{as:'external'})).status,200);await injected.apply([revoke()]);assert.equal((await injected.request('me',{as:'external'})).status,403);
});
