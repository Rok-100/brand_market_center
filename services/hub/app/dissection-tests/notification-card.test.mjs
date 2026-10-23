import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {dissectionNotificationCard} from '../dissection-card.mjs';
import {DissectionService} from '../dissection-service.mjs';
const job={id:'dissect_1234567890abcdef12345678',reviewerNumber:'M',reviewer:{name:'主管'},dataDate:'2026-09-29',material:{title:'视频标题'},assessment:{score:82,value:'high',summary:'结构适合复刻'},assignee:{name:'处理同事'},assignment:{note:'按分镜制作'},output:{note:'测试成果已提交'}};
test('every workflow notice is a Card 2.0 with one view-task button and the precise task link',()=>{
  for(const kind of ['review','assignment','unassigned','accepted','completed','failed']){
    const delivery=dissectionNotificationCard({kind},job),card=JSON.parse(delivery.content);
    assert.equal(delivery.msg_type,'interactive');assert.equal(card.schema,'2.0');
    const buttons=card.body.elements.filter(e=>e.tag==='button');assert.equal(buttons.length,1);
    assert.equal(buttons[0].text.content,'查看任务');assert.equal(buttons[0].behaviors[0].type,'open_url');
    assert.equal(buttons[0].behaviors[0].default_url,'https://hub.fandow.com/yxb/wis-marketing-hub/#dissection-review='+job.id);
    assert.ok(card.body.elements.some(e=>e.tag==='column_set'));
    assert.ok(card.body.elements.filter(e=>e.tag==='markdown').every(e=>!e.content.includes('https://')));
  }
});
test('local cards point to the local task and treat source text as inert card content',()=>{
  const delivery=dissectionNotificationCard({kind:'review'},{...job,material:{title:'<at id=all></at> [诱导链接](https://example.test) '+ '长'.repeat(300)}},{publicUrl:'http://127.0.0.1:4338/',context:'本地本人联调'}),card=JSON.parse(delivery.content);
  assert.match(card.header.subtitle.content,/本地本人联调/);
  assert.equal(card.body.elements.find(e=>e.tag==='button').behaviors[0].default_url,'http://127.0.0.1:4338/#dissection-review='+job.id);
  assert.ok(!card.body.elements[0].content.includes('<at '));
  assert.ok(!card.body.elements[0].content.includes('[诱导链接]'));
  assert.throws(()=>dissectionNotificationCard({kind:'review'},job,{publicUrl:'javascript:alert(1)'}));
});
test('outbox sends interactive cards and freezes payload plus UUID across uncertain retries',async()=>{
  const root=mkdtempSync(join(tmpdir(),'card-outbox-')),person={number:'M',name:'主管',center:'中心',role:'manager',active:true};
  writeFileSync(join(root,'token'),'fixture');let sends=[];
  const identity={user:{number:'M',realName:'主管'},permissions:{manage_permissions:true},workspace:{role:'manager',center:'中心',is_brand_department:true}};
  const report={id:'r',materials:{status:'ready',items:[{id:'v',platform:'test',title:'初始视频标题',spend:30000,downloadUrl:'http://fixture/video'}]}};
  const s=new DissectionService({root,people:()=>[person],vault:{value:null,save(v){this.value=v},read(){return this.value}},sessionFor:async()=>({status:200,payload:identity}),env:{DAILY_INTELLIGENCE_URL:'http://fixture',INTELLIGENCE_INTERNAL_TOKEN_FILE:join(root,'token')},notifier:{recipient:()=>({id:'self',type:'open_id'}),tenantToken:async()=>'fixture'},fetchImpl:async(url,options)=>String(url).endsWith('/models')?Response.json({code:0,data:{models:[{model_name:'video',is_use_video:1}]}}):String(url).endsWith('/report')?Response.json({report}):(sends.push(JSON.parse(options.body)),sends.length===1?Response.json({code:500},{status:500}):Response.json({code:0,data:{message_id:'card-message'}})),analyzeImpl:async()=>({result:[{time_range:'00:00.000-00:01.000',scene_description:'画面'}],duration:1,assessment:{score:82,value:'high',summary:'适合复刻'}})});
  try{
    await s.configure(s.access(identity),{model:'video',enabled:true,expectedVersion:1},{'x-oa-token':'fixture'});await s.tick();await s.flush();
    assert.equal(sends[0].msg_type,'interactive');assert.equal(JSON.parse(sends[0].content).schema,'2.0');
    s.store.transaction(state=>{state.jobs.forEach(j=>{j.material.title='更新后的标题'});state.notices[0].nextAt=0;});
    await s.flush();assert.equal(sends.length,2);assert.deepEqual(sends[1],sends[0]);
    assert.equal(s.store.read().notices[0].messageId,'card-message');assert.equal(s.store.read().notices[0].state,'sent');
  }finally{s.close();rmSync(root,{recursive:true,force:true});}
});
