import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {WorkflowStore} from './workflow-store.mjs';
import {FlowRuntime} from './flow-runtime.mjs';
import {LiveSessionFlow,scheduleSessions,liveStages} from './live-session-flow.mjs';
import {FlowFeishu} from './flow-feishu.mjs';
import {createLiveScheduleReader} from './live-schedule-reader.mjs';
const modules=['workflow-engine','live-room-management'];
const staff=[{number:'M',name:'主管',role:'manager'},{number:'L',name:'房间主责',role:'specialist'},{number:'A',name:'主播',role:'specialist'},{number:'B',name:'助理',role:'specialist'},{number:'X',name:'无关同事',role:'specialist'}].map(p=>({...p,active:true,workflowEnabled:true,center:'直播中心',modules}));
const access=(number='M')=>({enabled:true,canManage:number==='M',department:false,user:staff.find(p=>p.number===number),modules});
const evidence=[{url:'https://example.com/approved',reference:'versioned-evidence',version:'v1'}];
function fixture(t){
 const dir=mkdtempSync(join(tmpdir(),'wis-live-session-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 let now=Date.parse('2026-09-23T08:00:00+08:00');
 const raw=()=>({date:'2026-09-23',updatedAt:new Date(now).toISOString(),writebackCapability:{enabled:true},rooms:[{code:'test',name:'测试直播间',anchors:[['09:00','12:00','主播']],assistants:[['08:30','12:00','助理']]}],sourceStatus:{test:{found:true,revision:42,sheetId:'verified'}}});
 const store=new WorkflowStore(join(dir,'workflow.json')),runtime=new FlowRuntime(store,{people:()=>staff,clock:()=>now,env:{FLOW_PUBLIC_URL:'https://example.com/hub/workflow-panorama/'}});
 const live=new LiveSessionFlow(runtime,{clock:()=>now,readSchedule:async()=>raw(),leads:{test:{number:'L',name:'房间主责'}},enabled:true});
 return {store,runtime,live,raw,clock:()=>now,setNow:v=>now=Date.parse(v),async create(key='create-live-001'){const s=(await live.preview(access(),{},'2026-09-23')).sessions[0];return live.create(access(),{}, {date:s.date,sessionKey:s.key,signature:s.signature},key);}};
}
function complete(f,task,facts={confirmed:true},key){const node=task.runtime.nodes.find(n=>n.state==='ready');return f.runtime.command(access(node.owner.number),task.id,'complete',{expectedVersion:task.version,nodeId:node.id,note:'核对真实证据后确认',evidence,liveFacts:facts},key||'done-'+node.id+'-'+node.attempt);}

test('只读备份、过期、日期错误、缺失人员和助理空档都阻止派工',t=>{
 const f=fixture(t);for(const mutate of [r=>r.recovery={readOnly:true},r=>r.updatedAt='2026-09-22T00:00:00Z',r=>r.date='2026-09-22',r=>r.rooms[0].anchors[0][2]='不存在',r=>r.rooms[0].assistants=[['09:30','12:00','助理']],r=>r.sourceStatus.test.found=false]){const raw=f.raw();mutate(raw);assert.throws(()=>scheduleSessions(raw,'2026-09-23',staff,f.clock()));}assert.equal(f.store.read().tasks.length,0);
});
test('跨日班次按原表顺序归入次日且助理覆盖完整',t=>{
 const f=fixture(t),r=f.raw();r.rooms[0].anchors=[['21:00','02:00','主播'],['02:00','05:30','主播']];r.rooms[0].assistants=[['21:00','02:00','助理'],['02:00','05:30','助理']];const rows=scheduleSessions(r,r.date,staff,f.clock());assert.equal(rows[1].startAt,'2026-09-23T18:00:00.000Z');assert.equal(rows[1].endAt,'2026-09-23T21:30:00.000Z');
});
test('五阶段、主播助理并行及房间主责只在本任务受托，不改变全局角色',async t=>{
 const f=fixture(t),task=await f.create();assert.deepEqual([...new Set(task.runtime.nodes.map(n=>n.liveStage))],liveStages);assert.equal(task.runtime.nodes[0].owner.number,'L');assert.equal(task.runtime.nodes.find(n=>n.id==='W04.S2.E2').owner.number,'L');assert.equal(staff.find(p=>p.number==='L').role,'specialist');assert.equal(task.runtime.nodes[0].dueAt,task.runtime.liveSession.startAt);assert.equal(task.notifications[0].recipient,'L');assert.ok(task.runtime.nodes.find(n=>n.id==='W04.S5.E1').dependencies.includes('W04.S4.A1'));
});
test('重复派工、重复请求和重启保留同一任务及通知',async t=>{
 const f=fixture(t),first=await f.create();assert.equal((await f.create()).id,first.id);assert.equal((await f.create('different-key')).id,first.id);assert.equal(f.store.read().tasks.length,1);assert.equal(f.store.read().flowNotifications.length,1);assert.equal(new FlowRuntime(f.store,{people:()=>staff}).get(access(),first.id).runtime.liveSession.key,first.runtime.liveSession.key);
});
test('默认关闭、未授权人员和当前源变更不能创建或推进',async t=>{
 const f=fixture(t);f.live.enabled=false;await assert.rejects(f.create(),e=>e.status===409);f.live.enabled=true;await assert.rejects(f.live.preview(access('A'),{},'2026-09-23'),e=>e.status===403);const task=await f.create();f.live.readSchedule=async()=>{const raw=f.raw();raw.rooms[0].anchors[0][2]='无关同事';return raw;};await assert.rejects(f.live.verifyCurrent(access('L'),{},task.id),e=>e.status===409);assert.equal(f.store.read().tasks[0].runtime.nodes[0].state,'ready');
});
test('其它单元格变化不阻止原场次继续办理，原派工版本仍留痕',async t=>{const f=fixture(t),task=await f.create();f.live.readSchedule=async()=>({...f.raw(),sourceStatus:{test:{found:true,revision:43,sheetId:'verified'}}});await f.live.verifyCurrent(access('L'),{},task.id);assert.equal(f.runtime.get(access(),task.id).runtime.liveSession.source.revision,42);});
test('未勾选、未放行、未结束和无行动结论不能自动完成',async t=>{
 const f=fixture(t);let task=await f.create();assert.throws(()=>complete(f,task,{}));task=complete(f,task);task=complete(f,task);task=complete(f,task);assert.equal(task.runtime.nodes.find(n=>n.state==='ready').id,'W04.S3.E2');assert.throws(()=>complete(f,task));task=complete(f,task,{confirmed:true,people:true,equipment:true,goods:true,risks:true});assert.throws(()=>complete(f,task));assert.equal(task.runtime.nodes.filter(n=>n.state==='ready').length,2);
 f.setNow('2026-09-23T12:10:00+08:00');const facts={confirmed:true,actualStart:'2026-09-23T09:01:00+08:00',actualEnd:'2026-09-23T12:00:00+08:00',platformSessionId:'real-sample'};task=complete(f,task,facts);assert.equal(task.runtime.nodes.find(n=>n.id==='W04.S5.E1').state,'pending');task=complete(f,task,facts);task=complete(f,task);assert.throws(()=>complete(f,task));task=complete(f,task,{confirmed:true,noAction:true,noActionReason:'本场复核无新增改进行动'});assert.equal(task.runtime.state,'completed');assert.equal(f.store.read().flowNotifications.filter(n=>n.kind==='ready').length,task.runtime.nodes.length);
});
test('待办仅包含本人的当前或等待节点，无关同事为空',async t=>{const f=fixture(t);await f.create();assert.ok(f.live.today(access('L')).items.length>0);assert.equal(f.live.today(access('X')).items.length,0);assert.ok(f.live.today(access('A')).items.every(i=>i.node.owner.number==='A'&&i.waitingFor.length));});
test('飞书每个到达节点有独立幂等消息回执，不真实发送',async t=>{
 const f=fixture(t);let task=await f.create(),sent=[];const n=new FlowFeishu(f.store,{people:()=>staff,clock:f.clock,env:{FLOW_NOTIFICATIONS_ENABLED:'true',FEISHU_APP_ID:'test',FEISHU_APP_SECRET:'test',FEISHU_RECIPIENT_MAP_JSON:JSON.stringify({L:'ou_l',A:'ou_a',B:'ou_b',M:'ou_m'})},fetchImpl:async(url,o)=>({ok:true,json:async()=>url.includes('/auth/')?{code:0,tenant_access_token:'test'}:(sent.push(JSON.parse(o.body)),{code:0,data:{message_id:'om_mock_'+sent.length}})})});await n.flush();task=complete(f,task);await n.flush();await n.flush();assert.equal(sent.length,2);assert.notEqual(sent[0].uuid,sent[1].uuid);assert.ok(f.store.read().flowNotifications.every(n=>n.state==='sent'));
});
test('同源班表读取不接受客户端地址、不跟随重定向',async()=>{let called;const read=createLiveScheduleReader({publicUrl:'https://example.com/hub/workflow-panorama/',fetchImpl:async(url,opts)=>{called={url:url.href,opts};return {ok:true,json:async()=>({date:'2026-09-23'})};}});await read({headers:{cookie:'test_session',authorization:'do-not-forward'}},'2026-09-23');assert.match(called.url,/^https:\/\/example.com\/hub\/modules\/dispatch-center\/api\/schedule\?/);assert.equal(called.opts.redirect,'error');assert.equal(called.opts.headers.Authorization,undefined);});
