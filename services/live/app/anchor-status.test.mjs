import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {AnchorStatusStore} from './anchor-status-store.mjs';
import {DIMENSIONS,normalizeScore,identifyRecording} from './anchor-status-policy.mjs';
import {createAnchorStatusService} from './anchor-status-service.mjs';
import {createAnchorStatusModel} from './anchor-status-model.mjs';
import {createAnchorStatusDelivery} from './anchor-status-delivery.mjs';

const now=Date.parse('2026-10-06T01:00:00Z');
const row=(messageId='om_fixture_0123456789',file='file_fixture_0123456789')=>({name:'甲',profile:{name:'甲',room:'官旗'},recording:{messageId,text:'官旗 甲 2026-10-06 08:00-10:00',createdAt:new Date(now).toISOString(),source:'WIS直播学习',resources:[{type:'file',key:file,name:'recording.mov'}]},resource:{type:'file',key:file,name:'recording.mov'}});
const raw=(scores=Array(10).fill(8))=>({status:'scored',quality:{visualUsable:true,audioUsable:true},dimensions:DIMENSIONS.map((name,i)=>({name,score:scores[i],evidence:'录屏中可以观察的实际证据',improvement:'继续保持'})),highlights:['表达流畅'],improvements:['加强镜头交流'],compliance:{status:'clear',hits:[]}});

test('65 warning and 2 severe thresholds are strict; trial pass remains independent',()=>{
  const sixtyFive=normalizeScore(raw(Array(10).fill(6.5)));assert.equal(sixtyFive.total,65);assert.equal(sixtyFive.warning,false);assert.equal(sixtyFive.trialPassed,false);
  const low=normalizeScore(raw([6.4,...Array(9).fill(6.5)]));assert.equal(low.total,64.9);assert.equal(low.warning,true);assert.equal(low.severe,false);
  assert.equal(normalizeScore(raw([2,...Array(9).fill(9)])).severe,false);
  assert.equal(normalizeScore(raw([1.9,...Array(9).fill(9)])).severe,true);
  assert.equal(normalizeScore(raw([1.99,...Array(9).fill(9)])).severe,true);
  assert.equal(normalizeScore(raw([6.49,...Array(9).fill(6.5)])).warning,true);
});
test('scores require all ten unique observable dimensions; no coercion or invented audio score',()=>{
  for(const value of [undefined,null,'8',NaN,11,-1]){const result=raw();result.dimensions[0].score=value;assert.throws(()=>normalizeScore(result));}
  const duplicate=raw();duplicate.dimensions[9].name=DIMENSIONS[0];assert.throws(()=>normalizeScore(duplicate));
  const missing=raw();missing.quality.audioUsable=false;assert.throws(()=>normalizeScore(missing),{code:'needs_review'});
  const result=raw();result.total=99;assert.equal(normalizeScore(result).total,80);
});
test('prohibited hit has evidence and creates severe rule independently of total',()=>{
  const result=raw();result.compliance={status:'hit',hits:[{term:'保证有效',context:'这个产品保证有效',timeSeconds:20}]};assert.equal(normalizeScore(result).severe,true);
  result.compliance.hits[0].context='';assert.throws(()=>normalizeScore(result));
  const uncertain=raw();uncertain.compliance.status='uncertain';assert.equal(normalizeScore(uncertain).requiresReview,true);
});

test('an uncertain compliance candidate is retained for review but cannot create a severe alert',()=>{
  const value=raw(Array(10).fill(9.1));value.compliance={status:'uncertain',hits:[{term:'官方正品',context:'字幕显示100%官方正品',timeSeconds:165}]};
  const result=normalizeScore(value);assert.equal(result.total,91);assert.equal(result.warning,false);assert.equal(result.severe,false);assert.equal(result.requiresReview,true);assert.equal(result.compliance.hits[0].term,'官方正品');assert.deepEqual(result.reasons,[]);
  value.dimensions[0].score=1.9;assert.equal(normalizeScore(value).severe,true,'a separately confirmed extreme score still alerts');
});
test('existing attribution requires account and verified session; uploaded hour is not a session',()=>{
  const identity=identifyRecording(row());assert.equal(identity.room,'官旗');assert.equal(identity.businessDate,'2026-10-06');
  const noSession=row();noSession.recording.text='官旗 甲';assert.throws(()=>identifyRecording(noSession),{code:'identity_review'});
  const conflict=row();conflict.recording.text='王鸥美肤 甲 08:00-10:00';assert.equal(identifyRecording(conflict).room,'王鸥美肤');
  const sessions=[{name:'甲',room:'官旗',start:'2026-10-06T08:00:00+08:00',end:'2026-10-06T10:00:00+08:00'}];assert.equal(identifyRecording({...noSession,sessions}).sessionKey,identity.sessionKey);
  assert.throws(()=>identifyRecording({...noSession,sessions:[...sessions,...sessions]}),{code:'identity_review'});
});
test('asset and session dedupe survive reopening SQLite; scoring and task creation are atomic',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'anchor-status-'));const path=join(dir,'store.sqlite');let store=new AnchorStatusStore(path,{clock:()=>now});t.after(async()=>{store.close();await rm(dir,{recursive:true,force:true});});
  assert.equal(store.ingest([row(),row()]).added,1);const first=store.claim();assert.equal(store.bindSession(first.id,identifyRecording(row())),true);
  const result=normalizeScore(raw([1,...Array(9).fill(8)]));store.complete(first.id,result,{model:'existing-omni'});
  assert.equal(store.tasks().length,1);assert.equal(store.report(first.id).state,'pending');store.close();
  store=new AnchorStatusStore(path,{clock:()=>now});assert.equal(store.claim(),null);
  store.ingest([row('om_fixture_9876543210','file_another_0123456789')]);const second=store.claim();assert.equal(store.bindSession(second.id,identifyRecording(row())),false);
  assert.equal(store.get(second.id).state,'duplicate');assert.equal(store.tasks().length,1);
});
test('startup correction preserves scores, evidence and delivery receipts and cancels only erroneous open tasks',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'anchor-policy-'));const path=join(dir,'store.sqlite');let store=new AnchorStatusStore(path,{clock:()=>now});t.after(async()=>{store.close();await rm(dir,{recursive:true,force:true});});
  const fixtures=[];
  for(let i=0;i<3;i++){
    store.ingest([row('om_policy_'+i,'file_policy_'+i)]);const job=store.claim();
    const value=raw(i===1?[1.9,...Array(9).fill(9)]:Array(10).fill(9.1));value.compliance={status:'uncertain',hits:[{term:'官方正品',context:'字幕显示100%官方正品',timeSeconds:165}]};
    const corrected=normalizeScore(value);const legacy={...corrected,warning:true,severe:true,reasons:[...corrected.reasons,{code:'prohibited',text:'官方正品'}],policyVersion:'legacy'};
    store.complete(job.id,legacy,{model:'existing-omni'});store.reportState(job.id,'verified',{messageId:'om_report_'+i});
    if(i===2)store.task(store.tasks().find(x=>x.job_id===job.id).id,'complete','已人工处理','TEST');
    fixtures.push({id:job.id,result:corrected,report:store.report(job.id),completed:store.get(job.id).completed_at});
  }
  store.close();store=new AnchorStatusStore(path,{clock:()=>now+1000});
  for(const [i,item] of fixtures.entries()){
    const current=store.get(item.id);assert.equal(current.result.total,item.result.total);assert.deepEqual(current.result.dimensions,item.result.dimensions);assert.deepEqual(current.result.compliance,item.result.compliance);assert.equal(current.result.requiresReview,true);assert.equal(current.result.severe,i===1);assert.deepEqual(current.result.reasons,item.result.reasons);assert.equal(current.completed_at,item.completed);assert.deepEqual(store.report(item.id),item.report);assert.equal(current.source.policyCorrection.externalReportUnchanged,true);
    assert.equal(store.tasks().find(x=>x.job_id===item.id).state,['cancelled','open','completed'][i]);
  }
  assert.equal(store.db.prepare("SELECT count(*) AS n FROM audit WHERE action='unconfirmed_compliance_alert_corrected'").get().n,3);
  assert.deepEqual(store.reconcileUncertainCompliance(),{corrected:0});store.close();store=new AnchorStatusStore(path,{clock:()=>now+2000});
  assert.equal(store.db.prepare("SELECT count(*) AS n FROM audit WHERE action='unconfirmed_compliance_alert_corrected'").get().n,3);
});

test('initial attempt plus three retries, setup errors do not consume attempt budget',()=>{
  let time=now;const store=new AnchorStatusStore(':memory:',{clock:()=>time});try{store.ingest([row()]);
    for(let i=0;i<4;i++){const job=store.claim();assert.ok(job);store.fail(job.id,Error('secret-provider-details'));time+=61*60000;}
    const item=store.list()[0];assert.equal(item.state,'needs_review');assert.equal(item.attempts,4);assert.ok(!item.error.includes('secret'));
    store.retry(item.id,'TEST');const job=store.claim();store.fail(job.id,Object.assign(Error('请登录'),{code:'model_not_configured',status:401}));assert.equal(store.get(job.id).attempts,0);assert.equal(store.get(job.id).state,'waiting_setup');
  }finally{store.close();}
});
test('expired in-flight leases recover after crash, queued work has a single claimant',()=>{
  let time=now;const store=new AnchorStatusStore(':memory:',{clock:()=>time});try{store.ingest([row()]);const first=store.claim();assert.equal(store.claim(),null);time+=361000;const next=store.claim();assert.equal(next.id,first.id);assert.equal(next.attempts,2);}finally{store.close();}
});
test('same original bytes posted again in a different message do not call the model twice',()=>{
  const store=new AnchorStatusStore(':memory:',{clock:()=>now});try{
    store.ingest([row(),row('om_other_0123456789','file_other_0123456789')]);const a=store.claim();store.bindSession(a.id,identifyRecording(row()));assert.equal(store.setMedia(a.id,{hash:'same-original',durationSeconds:180}),true);store.complete(a.id,normalizeScore(raw()),{model:'omni'});
    const b=store.claim();const other=row();other.recording.text='官旗 甲 2026-10-06 10:00-12:00';store.bindSession(b.id,identifyRecording(other));assert.equal(store.setMedia(b.id,{hash:'same-original',durationSeconds:180}),false);assert.equal(store.get(b.id).state,'duplicate');
  }finally{store.close();}
});
test('persisted report intent is claimed once; an uncertain receipt does not block later reports',()=>{
  const store=new AnchorStatusStore(':memory:',{clock:()=>now});try{
    for(let i=0;i<2;i++){const source=row('om_'+i+'_0123456789','file_'+i+'_0123456789');source.name='主播'+i;store.ingest([source]);const job=store.claim();store.complete(job.id,normalizeScore(raw()),{model:'omni'});}
    const first=store.claimReport();assert.ok(first);const second=store.claimReport();assert.ok(second);assert.notEqual(first.job_id,second.job_id);assert.equal(store.claimReport(),null);
    store.reportState(first.job_id,'uncertain');assert.equal(store.claimReport(),null);
  }finally{store.close();}
});
test('statistics exclude unknown, filtered and failed jobs; empty days remain null',()=>{
  const store=new AnchorStatusStore(':memory:',{clock:()=>now});try{store.ingest([row(),row('om_another_0123456789','file_another_0123456789')]);const job=store.claim();store.bindSession(job.id,identifyRecording(row()));store.complete(job.id,normalizeScore(raw()),{model:'omni'});const next=store.claim();store.fail(next.id,Object.assign(Error('人工'),{code:'identity_review'}));
    assert.equal(store.stats({date:'2026-10-06'}).average,80);assert.equal(store.stats({date:'2026-10-06'}).pending,1);assert.equal(store.trends({days:7})[0].average,null);assert.equal(store.trends({days:7}).at(-1).average,80);
  }finally{store.close();}
});
test('manual resolution closes an unscorable recording with an audit note, without inventing a score',()=>{
  const store=new AnchorStatusStore(':memory:',{clock:()=>now});try{store.ingest([row()]);const job=store.claim();store.fail(job.id,Object.assign(Error('音轨无法评分'),{code:'media_quality'}));assert.equal(store.stats({date:'2026-10-06'}).pending,1);
    store.resolve(job.id,'已人工核验，通知重新提交清晰录屏','FD-027097');assert.equal(store.get(job.id).state,'reviewed');assert.equal(store.get(job.id).result,null);assert.equal(store.stats({date:'2026-10-06'}).average,null);assert.equal(store.stats({date:'2026-10-06'}).pending,0);assert.equal(store.get(job.id).source.manualReview.actor,'FD-027097');
  }finally{store.close();}
});
function serviceFixture({score=async()=>({value:raw(),model:'existing-omni'}),deliver,verifyDelivery=async()=>true,notificationsEnabled=false}={}){
  const store=new AnchorStatusStore(':memory:',{clock:()=>now});const item=row();
  const service=createAnchorStatusService({store,clock:()=>now,profiles:async()=>[item.profile],collect:async()=>({sources:{learning:{available:true,truncated:false}},evidenceByAnchor:{甲:{recordings:[item.recording]}}}),readSessions:async()=>[],
    analyze:async()=>({videoBase64:'REAL_FIXTURE_VIDEO',hasAudio:true,durationSeconds:180,hash:'hash',bytes:100}),model:{score},deliver,verifyDelivery,notificationsEnabled});return {store,service};
}
test('complete scan → real-media adapter → scores → persisted report; success is never re-scored',async()=>{
  let count=0;const {service,store}=serviceFixture({score:async(input,options)=>{count++;assert.equal(input.media.videoBase64,'REAL_FIXTURE_VIDEO');assert.equal(options.token,'current-user');assert.ok(options.signal);return{value:raw(),model:'existing-omni'};}});
  try{await service.scan('slot');await service.work({token:'current-user'});await service.work({token:'current-user'});await service.scan('slot');assert.equal(count,1);assert.equal(service.list({})[0].result.total,80);assert.ok(!JSON.stringify(service.list({})).includes('current-user'));assert.equal(store.tasks().length,0);}finally{store.close();}
});

test('capture matches and persists session before any model login or scoring request',async()=>{
  let scores=0;const {service,store}=serviceFixture({score:async()=>{scores++;return{value:raw(),model:'omni'};}});
  try{const scan=await service.scan('slot');assert.equal(scan.matching.matched,1);const job=store.list()[0];assert.ok(job.source.identity?.session);assert.equal(job.state,'queued');assert.equal(job.attempts,0);assert.equal(scores,0);assert.ok(service.detail(job.id).session);assert.equal(service.summary({date:'2026-10-06'}).ready,1);
    await service.work({token:'current-user'});assert.equal(scores,1);assert.equal(store.get(job.id).state,'scored');
  }finally{store.close();}
});

test('employee-number enrichment also reaches existing scores without changing the group name, room or report',async()=>{
  const store=new AnchorStatusStore(':memory:',{clock:()=>now});try{
    store.ingest([row()]);const job=store.claim();store.bindSession(job.id,identifyRecording(row()));store.complete(job.id,normalizeScore(raw()),{model:'omni'});store.reportState(job.id,'verified',{messageId:'om_existing'});
    const service=createAnchorStatusService({store,employeeDirectory:async names=>{assert.deepEqual(names,['甲']);return{byName:{甲:{employeeNumber:'FD-001234',status:'verified'}},fetchedAt:'fixture'};}});
    await service.refreshEmployeeNumbers();const result=service.detail(job.id);assert.equal(result.employeeNumber,'FD-001234');assert.equal(result.name,'甲');assert.equal(result.room,'官旗');assert.equal(result.result.total,80);assert.equal(result.report.state,'verified');assert.equal(result.report.message_id,'om_existing');
  }finally{store.close();}
});

test('unmatchable captures show the reason and never enter model scoring; source outages remain retryable',async()=>{
  for(const outage of [false,true]){
    const store=new AnchorStatusStore(':memory:',{clock:()=>now});let scores=0;const item=row();item.recording.text='官旗 甲';
    const service=createAnchorStatusService({store,clock:()=>now,profiles:async()=>[],collect:async()=>({sources:{learning:{available:true}},evidenceByAnchor:{甲:{recordings:[item.recording]}}}),readSessions:async()=>{if(outage)throw Error('upstream unavailable');return[];},model:{score:async()=>{scores++;}}});
    try{await service.scan();const job=store.list()[0];assert.equal(job.state,outage?'retry':'needs_review');assert.equal(job.attempts,0);assert.equal(job.source.sessionMatch.state,outage?'unavailable':'unmatched');assert.ok(job.error);assert.equal(service.summary({date:'2026-10-06'}).ready,0);await service.work({token:'current-user'});assert.equal(scores,0);}finally{store.close();}
  }
});

test('all captures in the same session display matched time before scoring, then successful sessions dedupe',async()=>{
  const {service,store}=serviceFixture();try{
    const sources={learning:{available:true}},a=row(),b=row('om_another_0123456789','file_another_0123456789');
    await service.ingestEvidence([],{sources,evidenceByAnchor:{甲:{recordings:[a.recording,b.recording]}}});assert.equal(service.list({}).filter(x=>x.session).length,2);assert.equal(store.list().filter(x=>x.state==='queued').length,2);
    await service.work({token:'caller'});await service.work({token:'caller'});const duplicate=service.list({}).find(x=>x.state==='duplicate');assert.ok(duplicate.session);assert.equal(store.list().filter(x=>x.result).length,1);
  }finally{store.close();}
});

test('an invalid first clip does not suppress a usable later clip from the same matched session',async()=>{
  const store=new AnchorStatusStore(':memory:',{clock:()=>now});let analyses=0;
  const service=createAnchorStatusService({store,clock:()=>now,readSessions:async()=>[],analyze:async()=>{if(++analyses===1)throw Object.assign(Error('时长不足'),{code:'duration_filtered'});return{hash:'valid',bytes:100,durationSeconds:180,hasAudio:true};},model:{score:async()=>({value:raw(),model:'omni'})}});
  try{await service.ingestEvidence([],{sources:{learning:{available:true}},evidenceByAnchor:{甲:{recordings:[row().recording,row('om_other_0123456789','file_other_0123456789').recording]}}});
    assert.equal((await service.work({token:'caller'})).state,'ignored');assert.equal((await service.work({token:'caller'})).state,'scored');assert.equal(analyses,2);
  }finally{store.close();}
});
test('uncertain delivery and process crash before receipt never authorize a second external send',async()=>{
  let sends=0;const {store,service}=serviceFixture({notificationsEnabled:true,deliver:async()=>{sends++;throw Error('timeout after upstream accepted');}});
  try{await service.scan();await service.work({token:'caller'});assert.equal((await service.sendOne()).state,'uncertain');await service.sendOne();assert.equal(sends,1);}finally{store.close();}
});
test('receipt readback failure retries only GET, not send; severe local task can be completed',async()=>{
  let sends=0,valid=false;const {store,service}=serviceFixture({score:async()=>({value:raw([1,...Array(9).fill(8)]),model:'omni'}),notificationsEnabled:true,deliver:async()=>{sends++;return {messageId:'om_report'};},verifyDelivery:async()=>valid});
  try{await service.scan();await service.work({token:'caller'});assert.equal((await service.sendOne()).state,'sent_unverified');valid=true;assert.equal((await service.sendOne()).state,'verified');assert.equal(sends,1);const task=store.tasks()[0];service.task(task.id,{action:'complete',note:'完成复盘与训练安排'},'FD-027097');assert.equal(store.tasks()[0].state,'completed');}finally{store.close();}
});
test('company model uses native VIDEO including audio and current caller login, never text-only fallback',async()=>{
  const calls=[];const model=createAnchorStatusModel({fetchImpl:async(url,options)=>{calls.push(options);if(url.endsWith('/models'))return Response.json({code:0,data:{models:[{model_name:'deepseek-flash',is_use_image:1,is_use_video:0},{model_name:'qwen3.5-omni-flash',is_use_video:1}]}});
    const body=JSON.parse(options.body);assert.equal(body.model,'qwen3.5-omni-flash');assert.equal(body.messages[1].content[1].type,'video_url');assert.equal(body.extra_body.use_audio_in_video,true);assert.deepEqual(body.extra_body.modalities,['text']);return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(raw())}}]});}});
  const scored=await model.score({name:'甲',room:'官旗',media:{hasAudio:true,videoBase64:'actual-input'}},{token:'fixture-token',signal:AbortSignal.timeout(300000)});
  assert.equal(scored.model,'qwen3.5-omni-flash');assert.ok(calls.every(x=>x.headers.Authorization==='Bearer fixture-token'));
  await assert.rejects(model.score({media:{videoBase64:'x',hasAudio:false}},{token:'fixture-token'}),{code:'media_quality'});
});
test('a company catalog with only a vision model cannot masquerade as audio-video scoring',async()=>{
  let calls=0;const model=createAnchorStatusModel({fetchImpl:async()=>{calls++;return Response.json({code:0,data:{models:[{model_name:'deepseek-flash',is_use_image:1,is_use_video:0}]}});}});
  await assert.rejects(model.score({media:{hasAudio:true,videoBase64:'x'}},{token:'fixture'}),{code:'model_capability_missing'});assert.equal(calls,1);
});
test('every original size produces one card with stable receipt and OA-controlled links, never a separate media message',async()=>{
  const requests=[];let link='',intent=0;
  const deliver=createAnchorStatusDelivery({token:async()=> 'private-token',recipientId:'verified-ni',verifyRecipient:async(id,name,number)=>assert.equal(number,'FD-027097'),download:async()=>assert.fail('card uses the original endpoint'),originalUrl:()=> 'https://example.invalid/original',reportUrl:id=>'https://example.invalid/report/'+id,
    fetchImpl:async(url,options)=>{requests.push({url,options});assert.ok(link);return Response.json({code:0,data:{message_id:'om_card'}});}});
  for(const bytes of [20,54*1024*1024]){
    const source=row();source.identity=identifyRecording(source);source.media={bytes};
    const job={id:'evaluation',name:'甲',room:'官旗',source,result:normalizeScore(raw())};
    const result=await deliver(job,{uuid:'stable-id',onOriginalLink:url=>{link=url;},onVideoSent:()=>assert.fail(),beforeText:()=>{intent++;}});
    assert.equal(result.messageId,'om_card');const request=requests.at(-1),body=JSON.parse(request.options.body),card=JSON.parse(body.content);
    assert.equal(body.uuid,'stable-id');assert.equal(body.msg_type,'interactive');assert.equal(card.schema,'2.0');assert.ok(request.options.body.includes(link));assert.ok(!request.options.body.includes('private-token'));
    source.originalDelivery={mode:'authenticated_original_link',url:link};
    await deliver(job,{uuid:'stable-id',receipt:{file_message_id:'old-video-receipt'},onOriginalLink:()=>assert.fail('saved original reused'),beforeText:()=>{intent++;}});
  }
  assert.equal(requests.length,4);assert.equal(intent,4);assert.ok(requests.every(x=>x.url.includes('/messages?')));
});

test('invalid original URLs and unverified recipient stop before any message send',async()=>{
  for(const original of [undefined,'http://example.invalid/video','https://private-token@example.invalid/video','https://example.invalid/video?oa_token=private-token']){
    let calls=0;const source=row();source.identity=identifyRecording(source);
    const deliver=createAnchorStatusDelivery({token:async()=> 'fixture',recipientId:'ni',verifyRecipient:async()=>{},originalUrl:()=>original,reportUrl:()=> 'https://example.invalid/report',fetchImpl:async()=>{calls++;assert.fail();}});
    await assert.rejects(deliver({id:'job',name:'甲',room:'官旗',source,result:normalizeScore(raw())},{uuid:'stable',beforeText:()=>assert.fail()}),{code:'card_link_invalid'});assert.equal(calls,0);
  }
});

test('card send failure and missing receipt preserve an ambiguous result, with no text fallback',async()=>{
  for(const code of [999999,0]){
    let calls=0;const source=row();source.identity=identifyRecording(source);
    const deliver=createAnchorStatusDelivery({token:async()=> 'fixture',recipientId:'ni',verifyRecipient:async()=>{},originalUrl:()=> 'https://example.invalid/original',reportUrl:()=> 'https://example.invalid/report',fetchImpl:async()=>{calls++;return Response.json({code,data:{}},{status:code?400:200});}});
    await assert.rejects(deliver({id:'job',name:'甲',room:'官旗',source,result:normalizeScore(raw())},{uuid:'stable',beforeText:()=>{}}),{code:code?'delivery_error':'uncertain_delivery'});assert.equal(calls,1);
  }
});

test('unidentified recordings immediately enter human review, then only explicit attribution unlocks scoring',()=>{
  const store=new AnchorStatusStore(':memory:',{clock:()=>now});try{
    const source={...row(),name:'未识别主播',unidentified:true};source.recording.text='';store.ingest([source]);const job=store.list()[0];assert.equal(job.state,'needs_review');assert.equal(store.claim(),null);assert.equal(store.stats({date:'2026-10-06'}).pending,1);
    store.resolveIdentity(job.id,{name:'甲',room:'官旗',start:'2026-10-06T08:00:00+08:00',end:'2026-10-06T10:00:00+08:00'},'FD-027097');
    store.ingest([source]);assert.equal(store.get(job.id).state,'queued');assert.equal(store.claim().name,'甲');assert.equal(store.get(job.id).source.unidentified,false);
  }finally{store.close();}
});

test('rescan repairs unknown and stale profile room in the existing asset, preserving scores and audit history',()=>{
  const store=new AnchorStatusStore(':memory:',{clock:()=>now});try{
    const source={...row(),name:'未识别主播',unidentified:true};source.recording.text='';store.ingest([source]);const unknown=store.list()[0];
    const known=row();known.name='李凯彤';known.room='品牌精选';known.unidentified=false;known.profile={name:'李凯彤',room:'王鸥美肤'};known.recording.text='品牌精选 李凯彤（声音无异常）';
    assert.equal(store.ingest([known]).added,0);const fixed=store.get(unknown.id);assert.equal(fixed.name,'李凯彤');assert.equal(fixed.room,'品牌精选');assert.equal(fixed.state,'queued');assert.equal(fixed.source.unidentified,false);assert.equal(store.list().length,1);
    const job=store.claim();store.complete(job.id,normalizeScore(raw()),{model:'omni'});store.reportState(job.id,'verified',{messageId:'om_existing_report'});
    store.ingest([{...known,name:'另一主播',room:'官旗',recording:{...known.recording,text:'官旗 另一主播'}}]);
    assert.equal(store.get(job.id).name,'李凯彤');assert.equal(store.get(job.id).result.total,80);assert.equal(store.report(job.id).message_id,'om_existing_report');assert.equal(store.report(job.id).state,'verified');
  }finally{store.close();}
});

test('group-caption name and room override stale profile, while schedule aliases do not rewrite the displayed name',()=>{
  const input=row();input.name='旧档案姓名';input.profile.room='优选';input.recording.text='王鸥美肤 林羽浠 07:00-09:00';
  const identity=identifyRecording(input);assert.equal(identity.name,'林羽浠');assert.equal(identity.room,'王鸥美肤');
  input.recording.text='优选 黄芷瞳';input.sessions=[{name:'黄芷曈',room:'优选',start:'2026-10-06T08:00:00+08:00',end:'2026-10-06T10:00:00+08:00'}];assert.equal(identifyRecording(input).name,'黄芷瞳');
  input.recording.text='只有视频文件';assert.throws(()=>identifyRecording(input),{code:'identity_review'});
});

test('original link receipt persists across restart and remains unsendable after an ambiguous text result',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'anchor-link-')),path=join(dir,'state.sqlite');let store=new AnchorStatusStore(path,{clock:()=>now});t.after(async()=>{store.close();await rm(dir,{recursive:true,force:true});});
  store.ingest([row()]);const job=store.claim();store.complete(job.id,normalizeScore(raw()),{model:'omni'});store.claimReport();store.recordOriginalLink(job.id,'https://example.invalid/original');store.close();
  store=new AnchorStatusStore(path,{clock:()=>now});assert.equal(store.get(job.id).source.originalDelivery.mode,'authenticated_original_link');assert.equal(store.claimReport().state,'file_link_ready');store.reportState(job.id,'uncertain');assert.equal(store.claimReport(),null);
});
