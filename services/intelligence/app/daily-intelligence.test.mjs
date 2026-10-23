import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {reportWindow,nextRunAt,materialReport,competitorReport,competitorBoardsReport,MARKET_BOARDS,unavailableCompetitors,reportMessages,deliveryMessages,canReadIntelligence,overallTransactionAmount} from './daily-intelligence.mjs';
import {IntelligenceStore} from './daily-intelligence-store.mjs';
import {IntelligenceWorker} from './daily-intelligence-worker.mjs';
import {createIntelligenceHandler} from './daily-intelligence-http.mjs';
const at=s=>Date.parse(s+'+08:00');
const window=reportWindow(at('2026-09-24T09:30:00'));
const material=()=>({code:200,data:{douyin:{top_spend_list:[{id:1,title:'恰好两万',spend:'20000',roi:'2',stream_url:'/video/1',publish_time:'2026-09-21 10:00:00'},{id:2,spend:'19999.99'},{id:3,spend:null},{id:4,spend:'30000',stream_url:'javascript:alert(1)'}],rising_list:[{id:1,spend:'20000'},{id:5,today_spend:'50000'}],sustained_list:[]},wechat_channel:{top_spend_list:[{id:1,spend:25000,net_transaction_amount:40000}],rising_list:[],net_gmv_list:[]}}});
test('overall turnover never silently substitutes net turnover or infers amount from ROI',()=>{
  assert.equal(overallTransactionAmount({raw:{pay_order_gmv:'66967.70'}}),66967.7);
  assert.equal(overallTransactionAmount({netTransactionAmount:40000,spend:20000,roi:3}),null);
  assert.equal(overallTransactionAmount({transactionAmount:50000,netTransactionAmount:40000}),50000);
  assert.equal(overallTransactionAmount({raw:{overall_transaction_amount:'60000'}}),60000);
  assert.equal(overallTransactionAmount({overallTransactionAmount:0,transactionAmount:50000}),0);
});
test('documented pay_order_gmv is normalized as overall turnover, including zero',()=>{
  const p=material();p.data.douyin.top_spend_list[0].pay_order_gmv=0;
  const r=materialReport(p,window,'http://radar.invalid');
  assert.equal(r.items.find(i=>i.platform==='douyin'&&i.id==='1').overallTransactionAmount,0);
  assert.equal(r.items.find(i=>i.platform==='wechat_channel').overallTransactionAmount,null);
  assert.equal(r.items.find(i=>i.platform==='wechat_channel').netTransactionAmount,40000);
});
function fixture(t) {
  const dir=mkdtempSync(join(tmpdir(),'wis-intelligence-'));const store=new IntelligenceStore(join(dir,'daily.sqlite'));
  t.after(()=>{store.close();rmSync(dir,{recursive:true,force:true})});return {store,dir};
}
test('Shanghai 09:30 windows are closed, cross-month and year boundaries are correct',()=>{
  assert.equal(window.start,'2026-09-23 00:00:00');assert.equal(window.end,'2026-09-23 23:59:59');assert.equal(window.dataDate,'2026-09-23');
  assert.equal(reportWindow(at('2026-09-24T09:29:59')).date,'2026-09-23');
  assert.equal(reportWindow(at('2026-01-01T09:30:00')).start,'2025-12-31 00:00:00');
  assert.equal(nextRunAt(at('2026-09-24T09:30:00')),'2026-09-25T01:30:00.000Z');
});
test('material filter includes 20000, deduplicates per platform, preserves missing values and safe links',()=>{
  const result=materialReport(material(),window,'http://radar.invalid');
  assert.equal(result.items.length,3);assert.equal(result.unique,6);
  const v=result.items.find(v=>v.id==='1'&&v.platform==='douyin');
  assert.equal(v.videoUrl,'http://radar.invalid/video/1');assert.equal(v.transactionAmount,null);assert.equal(v.uploadTime,null);
  assert.equal(v.publishTime,'2026-09-21 10:00:00');assert.equal(v.sourceBoards.length,2);
  assert.equal(result.items.find(v=>v.id==='4').videoUrl,null);
  assert.ok(!result.items.some(v=>v.id==='5'),'rising today spend must not stand in for window spend');
  assert.ok(result.warnings.some(w=>w.includes('09:30')));
});
test('invalid and missing arrays are failures, genuine empty six boards are ready',()=>{
  const d=material();delete d.data.douyin.rising_list;assert.throws(()=>materialReport(d,window,'http://x'),/缺少/);
  assert.throws(()=>materialReport({code:401},window,'http://x'),/无效/);
  const e=material();for(const p of Object.values(e.data))for(const k of Object.keys(p))p[k]=[];
  assert.equal(materialReport(e,window,'http://x').items.length,0);
});
test('competitors require comparable numeric movement, preserve data day and never count new entries',()=>{
  const row={entity_id:'x',entity_name:'品牌',entity_type:'brand',source_rank:2,comparison:{status:'up',previous_rank:7,rank_change:5},classification:'competitor',metrics:{sales_amount:{display:'100w~250w'}}};
  const d={code:200,data:{status:'ready',coverage:{complete:true},comparison:{status:'comparable',date:'2026-09-22'},batch:{data_date:'2026-09-23',period_type:'day'},records:[row,{...row,entity_id:'new',comparison:{status:'new',previous_rank:null,rank_change:20}},{...row,entity_id:'wrong',comparison:{status:'up',previous_rank:3,rank_change:10}},{...row,entity_id:'internal',classification:'fandow'}]}};
  const r=competitorReport(d,window,'http://x');assert.equal(r.items.length,1);assert.equal(r.dataDate,'2026-09-23');assert.equal(r.items[0].salesAmount,'100w~250w');
  d.data.comparison.status='missing';assert.throws(()=>competitorReport(d,window,'http://x'),/尚未完整/);
});
test('one date produces one persistent report and outbox despite repeated calls and worker restarts',async t=>{
  const {store,dir}=fixture(t),env={INTELLIGENCE_SEND_ENABLED:'true',FEISHU_CREDENTIALS_FILE:join(dir,'feishu.json'),INTELLIGENCE_RECIPIENT_FILE:join(dir,'recipient.json')};writeFileSync(env.FEISHU_CREDENTIALS_FILE,JSON.stringify({appId:'test',appSecret:'fixture'}));
  writeFileSync(env.INTELLIGENCE_RECIPIENT_FILE,JSON.stringify({id:'ou_test',type:'open_id',name:'崔经瀚',employeeNumber:'FD-227829',appId:'test'}));
  let fetches=0,sends=[];const fetchImpl=async(url,options)=>{
    if(url.includes('/auth/'))return Response.json({code:0,tenant_access_token:'fake',expire:7200});
    sends.push(JSON.parse(options.body));return Response.json({code:0,data:{message_id:'om_test'}});
  };
  const worker=new IntelligenceWorker(store,{env,fetchImpl,clock:()=>at('2026-09-24T10:00:00')});
  worker.collectMaterials=async()=>{fetches++;return materialReport(material(),window,'http://x')};
  worker.collectCompetitors=async()=>({status:'unconfigured',items:[],error:'待接入'});
  const r=await worker.run({test:true,send:true});assert.equal(r.state,'partial');assert.equal(fetches,1);
  await worker.run({test:true,send:true});await worker.flush();assert.equal(fetches,1);assert.equal(sends.length,2);
  const again=new IntelligenceWorker(store,{env,fetchImpl,clock:()=>at('2026-09-24T10:01:00')});
  await again.run({test:true,send:true});await again.flush();assert.equal(sends.length,2);
  assert.equal(sends[0].receive_id,'ou_test');assert.equal(sends[0].msg_type,'interactive');assert.equal(JSON.parse(sends[0].content).schema,'2.0');assert.ok(sends[0].content.includes('本地测试'));
  assert.equal(store.delivery(r.id)[0].messageId,'om_test');
});
test('recipient change cancels pending group deliveries, preserves delivered history and sends only to verified Cui',async t=>{
  const {store,dir}=fixture(t),target={id:'ou_testCui',type:'open_id',name:'崔经瀚',employeeNumber:'FD-227829',appId:'fixture'};
  const env={INTELLIGENCE_SEND_ENABLED:'true',FEISHU_CREDENTIALS_FILE:join(dir,'app.json'),INTELLIGENCE_RECIPIENT_FILE:join(dir,'target.json')};
  writeFileSync(env.FEISHU_CREDENTIALS_FILE,JSON.stringify({appId:'fixture',appSecret:'fixture'}));writeFileSync(env.INTELLIGENCE_RECIPIENT_FILE,JSON.stringify(target));
  const report={id:'test-group-change',test:true,window,materials:{status:'failed',items:[],error:'测试'},competitors:unavailableCompetitors('测试')};
  store.enqueue(report,'oc_oldGroup',[{uuid:'already-sent',text:'old'},{uuid:'pending-group',text:'pending'}]);
  store.db.prepare("UPDATE messages SET state='sent',message_id='om_old' WHERE uuid='already-sent'").run();
  store.enqueue(report,target,deliveryMessages(report,target));const requests=[];
  const w=new IntelligenceWorker(store,{env,clock:()=>at('2026-09-24T10:00:00'),fetchImpl:async(url,opts)=>{
    if(url.includes('/auth/'))return Response.json({code:0,tenant_access_token:'fake',expire:7200});
    requests.push({url,body:JSON.parse(opts.body)});return Response.json({code:0,data:{message_id:'om_cui'}});
  }});
  await w.flush();assert.equal(requests.length,1);assert.ok(requests[0].url.endsWith('receive_id_type=open_id'));assert.equal(requests[0].body.receive_id,'ou_testCui');
  assert.equal(store.db.prepare("SELECT state FROM messages WHERE uuid='pending-group'").get().state,'cancelled');
  assert.equal(store.db.prepare("SELECT state FROM messages WHERE uuid='already-sent'").get().state,'sent');
  assert.equal(store.delivery(report.id,target)[0].messageId,'om_cui');
  writeFileSync(env.INTELLIGENCE_RECIPIENT_FILE,JSON.stringify({...target,type:'chat_id',id:'oc_test'}));assert.throws(()=>w.recipient(),/禁止发送/);
  writeFileSync(env.INTELLIGENCE_RECIPIENT_FILE,JSON.stringify({...target,appId:'wrong'}));assert.throws(()=>w.recipient(),/禁止发送/);
});
test('schedule begins at next 09:30 and catches latest missed day on restart only once',async t=>{
  const {store}=fixture(t);let now=at('2026-09-24T10:00:00'),calls=0;
  const options={env:{INTELLIGENCE_SCHEDULE_ENABLED:'true'},clock:()=>now};
  const worker=new IntelligenceWorker(store,options);
  worker.collectMaterials=async()=>{calls++;return materialReport(material(),window,'http://x')};worker.collectCompetitors=async()=>({status:'unconfigured',items:[]});
  await worker.tick();assert.equal(calls,0);now=at('2026-09-25T09:30:00');await worker.tick();await worker.tick();assert.equal(calls,1);
  now=at('2026-09-27T11:00:00');await worker.tick();assert.equal(calls,2);assert.equal(store.overview().history.length,2);
});
test('unknown delivery reuses UUID, expired uncertain deliveries require attention',t=>{
  const {store}=fixture(t);const report={id:'sample'};store.enqueue(report,'chat',[{uuid:'fixed',text:'测试'}]);
  const m=store.messageClaim(100000);store.messageFinish(m,{state:'retry',error:'timeout'},100000);
  const retry=store.messageClaim(140000);assert.equal(retry.uuid,m.uuid);
  assert.equal(store.messageClaim(3800000),null);assert.equal(store.delivery('sample')[0].state,'attention');
});
test('both sources failing remain failed rather than an empty successful report',async t=>{
  const {store}=fixture(t);const w=new IntelligenceWorker(store,{env:{},clock:()=>at('2026-09-24T10:00:00')});
  w.collectMaterials=async()=>{throw new DOMException('timeout','TimeoutError')};w.collectCompetitors=async()=>({status:'unconfigured',items:[],error:'待接入'});
  const r=await w.run({test:true});assert.equal(r.state,'failed');assert.equal(r.materials.status,'failed');
  const text=reportMessages(r)[0].text;assert.ok(text.includes('来源接口超时'));assert.ok(!text.includes('0 条符合条件'));
});
test('API checks login, department access and manual action guard before reaching worker',async()=>{
  assert.equal(canReadIntelligence({user:{},workspace:{home:'personal'}}),false);
  assert.equal(canReadIntelligence({user:{},workspace:{home:'department'}}),true);
  let response;const env={DAILY_INTELLIGENCE_URL:'http://x',INTELLIGENCE_MANUAL_TEST_ENABLED:'true'};
  let session={status:401,payload:{detail:'未登录'}};
  const h=createIntelligenceHandler({env,sessionFor:async()=>session,sendJson:(_r,status,data)=>{response={status,data}},fetchImpl:()=>{throw Error('must not call')}});
  await h({method:'GET',headers:{}},{},new URL('http://x/api/daily-intelligence'));assert.equal(response.status,401);
  session={status:200,payload:{user:{},workspace:{home:'personal'}}};await h({method:'GET',headers:{}},{},new URL('http://x/api/daily-intelligence'));assert.equal(response.status,403);
  session.payload.workspace.home='department';await h({method:'POST',headers:{}},{},new URL('http://x/api/daily-intelligence/run'));assert.equal(response.status,403);
});

function fiveBoards() {
  return {code:200,data:{source:'chanmama',boards:Object.fromEntries(Object.keys(MARKET_BOARDS).map((key,i)=>[key,{
    status:'ready',batch:{data_date:i===2?'2026-09-24':'2026-09-23',snapshot_hour:i===2?9:null,period_type:i===2?'intraday':'day'},
    coverage:{complete:true},comparison:{status:'comparable',date:i===2?'2026-09-23':'2026-09-22'},records:[
      {entity_id:'same-brand',entity_name:'品牌示例',entity_type:'brand',source_rank:2,classification:'competitor',comparison:{status:'up',previous_rank:7,rank_change:5},metrics:{sales_amount:{display:'100w~250w'}}},
      {entity_id:'below',entity_name:'未达门槛',entity_type:'brand',source_rank:2,comparison:{status:'up',previous_rank:6,rank_change:4}},
      {entity_id:'new',entity_name:'新上榜未进前25',entity_type:'brand',source_rank:26,comparison:{status:'new',previous_rank:null,rank_change:null}},
    ]}]))}};
}
test('all five boards are collected, cross-board brand ranks stay separate and snapshot dates remain distinct',()=>{
  const r=competitorBoardsReport(fiveBoards(),window,'https://radar.invalid');
  assert.equal(r.status,'ready');assert.equal(r.readyBoards,5);assert.equal(r.items.length,5);
  assert.deepEqual(r.boards.map(b=>b.key),Object.keys(MARKET_BOARDS));
  assert.equal(r.boards[2].snapshotHour,9);assert.equal(r.boards[2].dataDate,'2026-09-24');
  assert.equal(r.boards[0].records.length,3,'unfiltered source records retained for full export');
  assert.equal(new Set(r.items.map(r=>r.board+':'+r.id)).size,5);
});
test('explicit new entries in positions 1 through 25 qualify without fabricated movement; unknown and 26 do not',()=>{
  const p=fiveBoards(),b=p.data.boards.hot_brands;
  b.records=[1,25,26,0,-1,1.5].map(rank=>({entity_id:'new-'+rank,entity_name:'新上榜'+rank,source_rank:rank,comparison:{status:'new',previous_rank:null,rank_change:null}}));
  b.records.push({entity_id:'unknown',source_rank:2,comparison:{status:'missing',previous_rank:null,rank_change:null}});
  b.records.push({...b.records[0],entity_id:'internal',classification:'internal'});
  const r=competitorBoardsReport(p,window,'http://radar.invalid'),items=r.boards[0].items;
  assert.deepEqual(items.map(i=>i.rank),[1,25]);assert.ok(items.every(i=>i.isNewEntry&&i.previousRank===null&&i.rankChange===null&&i.qualification==='new_top25'));
  const content=reportMessages({id:'new-test',window,competitors:r,materials:{status:'ready',items:[]}}).map(m=>m.text).join('');
  assert.ok(content.includes('新上榜 · 第 25 名'));assert.ok(!content.includes('null →'));assert.ok(!content.includes('上升 null'));
  b.comparison.status='missing';assert.equal(competitorBoardsReport(p,window,'http://radar.invalid').boards[0].items.length,0);
});
test('pending/missing/incomparable boards do not hide successful boards or become successful empty lists',()=>{
  const p=fiveBoards();p.data.boards.today_sales={status:'pending',batch:null,records:[],coverage:null};
  delete p.data.boards.goods_sales;p.data.boards.live_creators.comparison.status='missing';
  const r=competitorBoardsReport(p,window,'https://radar.invalid');assert.equal(r.status,'partial');assert.equal(r.items.length,2);
  assert.equal(r.boards[2].status,'pending');assert.equal(r.boards[3].status,'failed');assert.equal(r.boards[4].status,'incomparable');
  const text=reportMessages({id:'five-test',test:true,window,competitors:r,materials:{status:'failed',error:'素材超时',items:[]}}).map(m=>m.text).join('\n');
  for(const title of Object.values(MARKET_BOARDS))assert.ok(text.includes(title));
  assert.ok(text.includes('2/5'));assert.ok(text.includes('品牌示例'));
  assert.equal(unavailableCompetitors('404').boards.length,5);
});
test('product and creator rankings are not dropped, explicit brand links are preserved without invented identities',()=>{
  const p=fiveBoards();Object.assign(p.data.boards.goods_sales.records[0],{entity_type:'goods',entity_name:'商品示例'});
  Object.assign(p.data.boards.live_creators.records[0],{entity_type:'creator',entity_name:'达人示例',brand_name:'关联品牌'});
  const r=competitorBoardsReport(p,window,'https://radar.invalid');
  assert.equal(r.boards[3].items[0].brandName,null);assert.equal(r.boards[3].items[0].entityName,'商品示例');
  assert.equal(r.boards[4].items[0].brandName,'关联品牌');assert.equal(r.items.length,5);
});
test('today-sales creator and live-creator average price are obtained from source fields',()=>{
  const p=fiveBoards();Object.assign(p.data.boards.today_sales.records[0],{creator_name:'三资堂彩妆',creator_id:'creator-1',creator_detail_url:'/creator/1'});
  p.data.boards.live_creators.records[0].metrics.average_price={display:'100~250'};
  const r=competitorBoardsReport(p,window,'https://radar.invalid');
  assert.equal(r.boards[2].items[0].creatorName,'三资堂彩妆');assert.equal(r.boards[2].items[0].creatorId,'creator-1');assert.equal(r.boards[2].items[0].creatorUrl,'https://radar.invalid/creator/1');
  assert.equal(r.boards[4].items[0].averagePrice,'100~250');
});
test('five boards explicitly request yesterday with the documented shared key',async t=>{
  const {store,dir}=fixture(t),file=join(dir,'radar.json');writeFileSync(file,JSON.stringify({baseUrl:'http://radar.invalid',apiKey:'unit-test-key'}));
  const seen=[];const worker=new IntelligenceWorker(store,{env:{RADAR_CREDENTIALS_FILE:file},fetchImpl:async(url,opts)=>{seen.push({url:new URL(url),opts});return Response.json(fiveBoards())}});
  const r=await worker.collectCompetitors(window);assert.equal(r.boards.length,5);
  assert.equal(seen[0].url.pathname,'/api/external/market-rankings');assert.equal(seen[0].url.searchParams.get('date'),'2026-09-23');
  assert.equal(seen[0].opts.headers['X-API-Key'],'unit-test-key');
});
test('approved group receives future messages while pending private messages are cancelled',async t=>{
  const {store,dir}=fixture(t),group={id:'oc_7ea9b8b248ba6ad71dd56f26cabcd259',type:'chat_id',name:'创意突破分享群',appId:'fixture'};
  const env={INTELLIGENCE_SEND_ENABLED:'true',FEISHU_CREDENTIALS_FILE:join(dir,'group-app.json'),INTELLIGENCE_RECIPIENT_FILE:join(dir,'group-target.json')};
  writeFileSync(env.FEISHU_CREDENTIALS_FILE,JSON.stringify({appId:'fixture',appSecret:'test'}));writeFileSync(env.INTELLIGENCE_RECIPIENT_FILE,JSON.stringify(group));
  const report={id:'group-routing'};store.enqueue(report,{id:'ou_previous',type:'open_id',name:'崔经瀚'},[{uuid:'old-private',text:'old'}]);store.enqueue(report,group,[{uuid:'group-message',text:'group'}]);
  const sent=[],w=new IntelligenceWorker(store,{env,fetchImpl:async(url,opts)=>{if(url.includes('/auth/'))return Response.json({code:0,tenant_access_token:'fixture',expire:7200});sent.push({url,body:JSON.parse(opts.body)});return Response.json({code:0,data:{message_id:'om_group'}})}});
  await w.flush();await w.flush();assert.equal(sent.length,1);assert.ok(sent[0].url.endsWith('receive_id_type=chat_id'));assert.equal(sent[0].body.receive_id,group.id);
  assert.equal(store.db.prepare("SELECT state FROM messages WHERE uuid='old-private'").get().state,'cancelled');assert.equal(store.delivery(report.id,group)[0].state,'sent');
  writeFileSync(env.INTELLIGENCE_RECIPIENT_FILE,JSON.stringify({...group,id:'oc_other'}));assert.throws(()=>w.recipient(),/禁止发送/);
  writeFileSync(env.INTELLIGENCE_RECIPIENT_FILE,JSON.stringify({...group,appId:'another-app'}));assert.throws(()=>w.recipient(),/禁止发送/);
});
test('material query uses the same yesterday natural day, never a 09:30 rolling range',async t=>{
  const {store,dir}=fixture(t),file=join(dir,'radar-yesterday.json');writeFileSync(file,JSON.stringify({baseUrl:'http://radar.invalid',apiKey:'unit-key'}));
  let requested;const worker=new IntelligenceWorker(store,{env:{RADAR_CREDENTIALS_FILE:file},fetchImpl:async url=>{requested=new URL(url);return Response.json(material())}});
  await worker.collectMaterials(window);
  assert.equal(requested.search,'?date=2026-09-23');assert.equal(requested.searchParams.has('startTime'),false);
  const leap=reportWindow(at('2024-03-01T09:30:00'));assert.equal(leap.dataDate,'2024-02-29');assert.equal(leap.end,'2024-02-29 23:59:59');
});
test('202 honors Retry-After, retries same request with no body, and does not turn pending into empty success',async t=>{
  const {store}=fixture(t);let calls=0;const delays=[];
  const worker=new IntelligenceWorker(store,{env:{},sleep:async(ms)=>delays.push(ms),fetchImpl:async()=>++calls===1?Response.json({code:202},{status:202,headers:{'retry-after':'7'}}):Response.json(material())});
  assert.equal((await worker.readApi(new URL('http://radar.invalid/api/external/material-top8'),{})).code,200);
  assert.deepEqual(delays,[7000]);assert.equal(calls,2);
  worker.fetch=async()=>Response.json({code:202},{status:202,headers:{'retry-after':'5'}});
  await assert.rejects(worker.readApi('http://radar.invalid',{}),/仍在生成/);
});
test('expired 200 snapshots remain explicitly stale, preserve metadata, and are not pushed as new material findings',()=>{
  const p=material();p.data.cache={generated_at:'2026-09-24T01:00:00Z',age_seconds:1800,stale:true,refreshing:true,refresh_failed_at:'2026-09-24T01:20:00Z'};
  const r=materialReport(p,window,'http://radar.invalid');assert.equal(r.status,'stale');assert.equal(r.cache.age_seconds,1800);assert.equal(r.items.length,3);
  const text=reportMessages({id:'stale',test:true,window,materials:r,competitors:unavailableCompetitors('404')}).map(x=>x.text).join('\n');
  assert.ok(text.includes('快照已过期'));assert.ok(!text.includes('恰好两万'));
});
test('explicit retry refreshes only unsent incomplete test reports and retains attempt evidence',async t=>{
  const {store}=fixture(t);let calls=0;
  const worker=new IntelligenceWorker(store,{env:{},clock:()=>at('2026-09-24T10:00:00')});
  worker.collectMaterials=async()=>{calls++;throw Error('来源接口 HTTP 503')};
  worker.collectCompetitors=async()=>competitorBoardsReport(fiveBoards(),window,'http://x');
  const first=await worker.run({test:true});assert.equal(first.state,'partial');
  const second=await worker.run({test:true,retryIncomplete:true});assert.equal(calls,2);assert.equal(second.previousAttempts.length,1);assert.equal(second.id,first.id);
  store.enqueue(second,'chat',reportMessages(second));
  const frozen=await worker.run({test:true,retryIncomplete:true});assert.equal(calls,2);assert.equal(frozen.reused,true);
  assert.equal(store.overview().history.length,1);
});
