import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {reportWindow,unavailableCompetitors,deliveryMessages} from './daily-intelligence.mjs';
import {intelligenceCardMessages} from './daily-intelligence-card.mjs';
import {IntelligenceStore} from './daily-intelligence-store.mjs';

const target={id:'ou_test',type:'open_id',name:'崔经瀚'};
const fixture=()=>({id:'card-test',test:true,state:'failed',window:reportWindow(Date.parse('2026-09-24T10:00:00+08:00')),finishedAt:'2026-09-24T02:00:00Z',materials:{status:'failed',items:[],error:'素材 HTTP 503'},competitors:unavailableCompetitors('竞品 HTTP 404')});
test('separate blue cards have date/category titles without the four metadata fields',()=>{
  const report=fixture(),messages=intelligenceCardMessages(report,target);assert.equal(messages.length,6);
  const cards=messages.map(m=>JSON.parse(m.payload.content)),card=cards[0];
  assert.equal(card.schema,'2.0');assert.equal(card.header.template,'blue');assert.equal(card.config.width_mode,'default');
  assert.equal(card.header.title.content,'2026-09-23 · 凡岛素材');assert.ok(cards[1].header.title.content.endsWith('热门品牌榜'));
  const content=messages.map(m=>m.payload.content).join('');
  for(const field of ['接收人','实际采集','采集窗口（北京时间）','筛选条件'])assert.ok(!content.includes(field));
  assert.ok(content.includes('503'));assert.ok(content.includes('404'));assert.ok(!content.includes('callback'));
  assert.equal(card.body.elements.at(-1).behaviors[0].default_url,'https://hub.fandow.com/yxb/wis-marketing-hub/');
  assert.notEqual(messages[0].uuid,deliveryMessages(report,target)[0].uuid);
});
test('source markup is escaped, video links stay clickable and title text cannot change business grouping',()=>{
  const report=fixture();report.state='partial';report.materials={status:'ready',warnings:[],items:[{id:'1',title:'<at id=all>竞品五榜：</at> **伪标题**',brand:'品牌',platformLabel:'抖音',spend:25000,transactionAmount:50000,roi:2,videoUrl:'https://example.com/video?q=(demo)',publishTime:'2026-09-23 12:00:00',uploadTime:null}]};
  const card=JSON.parse(intelligenceCardMessages(report,target)[0].payload.content),body=card.body.elements.map(e=>e.content||'').join('\n');
  assert.ok(!body.includes('<at'));assert.ok(body.includes('&#60;at'));assert.ok(body.includes('[查看视频](https://example.com/video?q=%28demo%29)'));assert.ok(body.includes('伪标题'));assert.ok(body.includes('25,000'));
});
test('material display uses overall turnover, account line break and two-decimal ROI without notes or upload time',()=>{
  const r=fixture();r.materials={status:'ready',warnings:['来源为六榜聚合接口，每榜最多8条'],items:[{id:'1',platform:'douyin',title:'素材',brand:'品牌',platformLabel:'抖音',accountName:'账号示例',spend:25000,transactionAmount:50000,netTransactionAmount:40000,roi:1.9182730881705483,uploadTime:'2026-09-22',publishTime:'2026-09-23',videoUrl:'https://example.com/video'}]};
  r.competitors.warnings=['一次采集全部五榜，不按原始位次补位'];
  const message=intelligenceCardMessages(r,target,{imageKeys:{'douyin:1':'img_test'}})[0],card=JSON.parse(message.payload.content);
  const content=JSON.stringify(card);
  for(const field of ['素材 ID：1','消耗：¥25,000.00','ROI：1.92'])assert.ok(content.includes('<br>'+field));assert.ok(content.includes('<br>整体成交：¥50,000.00'));assert.ok(content.includes('ROI：1.92'));assert.ok(content.includes('<br>账号：账号示例'));
  assert.ok(content.includes('<br>发布时间：2026-09-23'));assert.ok(!content.includes('查看视频'));assert.ok(!content.includes('1. 素材'));
  assert.ok(!content.includes('净成交'));assert.ok(!content.includes('上传时间'));assert.ok(!content.includes('来源为六榜聚合'));assert.ok(!content.includes('一次采集全部五榜'));
  const item=card.body.elements.find(e=>e.tag==='column_set');assert.ok(item);const preview=item.columns[0].elements[0];
  assert.equal(preview.behaviors[0].default_url,'https://example.com/video');assert.equal(preview.elements[0].img_key,'img_test');assert.equal(preview.elements[0].preview,false);
});
test('wechat displays net turnover on its own line without substituting overall turnover',()=>{
  const r=fixture();
  const item={id:'wechat-1',platform:'wechat_channel',platformLabel:'视频号',title:'视频号素材',brand:'品牌',accountName:'视频号账号',spend:25000,transactionAmount:60000,netTransactionAmount:40000,roi:1.6};
  r.materials={status:'ready',items:[item]};
  let content=intelligenceCardMessages(r,target)[0].payload.content;
  assert.ok(content.includes('消耗：¥25,000.00<br>净成交：¥40,000.00<br>ROI：1.60'));assert.ok(!content.includes('整体成交'));assert.ok(!content.includes('60,000'));
  item.netTransactionAmount=null;item.raw={net_transaction_amount:'35000'};
  content=intelligenceCardMessages(r,target)[0].payload.content;assert.ok(content.includes('<br>净成交：¥35,000.00'));
  item.raw={};content=intelligenceCardMessages(r,target)[0].payload.content;assert.ok(content.includes('<br>净成交：源接口未提供'));assert.ok(!content.includes('60,000'));
});
test('ranking layouts keep source names and creator metrics with compatible stored-report fallbacks',()=>{
  const r=fixture();r.competitors={status:'ready',readyBoards:5,items:Array(5).fill({}),boards:['hot_brands','brand_live','today_sales','goods_sales','live_creators'].map(key=>({key,label:key,status:'ready',dataDate:'2026-09-23',items:[{name:'关联品牌',entityName:key+'主体',rank:3,previousRank:16,rankChange:13,salesAmount:'500w~1000w',salesCount:'1w~2.5w',detailUrl:'https://example.com/detail',raw:{creator_name:'三资堂彩妆',metrics:{average_price:{display:'100~250'},followers:{display:'99w'},live_sessions:30}}}]}))};
  const content=intelligenceCardMessages(r,target).map(m=>m.payload.content).join('');
  assert.ok(content.includes('三资堂彩妆'));assert.ok(content.includes('500w~1000w'));
  assert.ok(content.includes('直播销售额'));assert.ok(content.includes('直播销量'));assert.ok(content.includes('100~250'));assert.ok(content.includes('销售客单价'));
  assert.ok(content.includes('[hot&#95;brands主体](https://example.com/detail)'));assert.ok(content.includes('goods_sales主体'));
  for(const removed of ['原榜单主体','品牌归属','关联品牌','99w','直播场次'])assert.ok(!content.includes(removed));
});
test('long report paginates to bounded cards without dropping the last item and keeps stable unique IDs',()=>{
  const report=fixture();report.materials={status:'ready',warnings:[],items:Array.from({length:48},(_,i)=>({id:String(i),title:`素材-${i} `+'内容'.repeat(160),brand:'测试',platformLabel:'抖音',spend:20000,roi:1,videoUrl:'https://example.com/'+i}))};
  const messages=intelligenceCardMessages(report,target);assert.ok(messages.length>1);assert.equal(new Set(messages.map(m=>m.uuid)).size,messages.length);
  assert.ok(messages.every(m=>Buffer.byteLength(m.payload.content)<28000));assert.ok(messages.map(m=>m.payload.content).join('').includes('素材-47'));
  assert.deepEqual(messages.map(m=>m.uuid),intelligenceCardMessages(report,target).map(m=>m.uuid));
});
test('native charts use rank on Y and rise on X, keep 25 rows together and expose clickable table names',()=>{
  const r=fixture(),items=Array.from({length:25},(_,i)=>({id:String(i),entityName:'新入选品牌-'+i,name:'新入选品牌-'+i,rank:i+1,previousRank:null,rankChange:null,isNewEntry:true,salesAmount:'100w+',salesCount:'1w+',detailUrl:'https://example.com/'+i}));
  r.competitors={status:'ready',readyBoards:1,items,boards:[{key:'hot_brands',label:'热门品牌榜',status:'ready',dataDate:'2026-09-23',items}]};
  const messages=intelligenceCardMessages(r,target),cards=messages.map(m=>JSON.parse(m.payload.content));
  const charts=cards.flatMap(c=>c.body.elements.filter(e=>e.tag==='chart'));
  assert.equal(charts.length,1);assert.equal(charts[0].chart_spec.data.values.length,25);
  assert.equal(charts[0].chart_spec.xField,'排名上升数');assert.equal(charts[0].chart_spec.yField,'排名与名称');
  assert.equal(typeof charts[0].chart_spec.label.formatter,'string','Feishu schema rejects array formatters');
  assert.equal(charts[0].chart_spec.tooltip.trigger,'hover','Feishu schema only accepts a string trigger');
  assert.equal(charts[0].chart_spec.data.values[0]['排名上升数'],29);assert.equal(charts[0].chart_spec.data.values.at(-1)['排名上升数'],5);
  assert.equal(charts[0].chart_spec.data.values.at(-1)['排名'],'25');
  const table=cards[1].body.elements.find(e=>e.tag==='table');assert.equal(table.rows.length,25);assert.equal(table.columns[1].data_type,'lark_md');assert.ok(table.rows[0].name.includes('](https://example.com/0)'));
  assert.equal(table.columns[1].display_name,'品牌/达人');assert.equal(table.rows[0].sales,'100w+');assert.equal(table.rows[0].count,'1w+');
  assert.ok(messages.every(m=>Buffer.byteLength(m.payload.content)<28000));
  const content=messages.map(m=>m.payload.content).join('');assert.ok(!content.includes('上升 null'));assert.ok(content.includes('100w+'));assert.equal(charts[0].chart_spec.label.formatter,'+{排名上升数}');assert.equal(charts[0].chart_spec.label.position,'outside');
  assert.equal(cards[1].body.elements.filter(e=>e.tag==='chart').length,1);assert.ok(!JSON.stringify(cards[1]).includes('凡岛素材'));assert.equal(cards[0].body.elements.filter(e=>e.tag==='chart').length,0);
});
test('outbox freezes payload before first attempt; retries and legacy text payloads never change format',t=>{
  const dir=mkdtempSync(join(tmpdir(),'wis-card-')),store=new IntelligenceStore(join(dir,'outbox.sqlite'));t.after(()=>{store.close();rmSync(dir,{recursive:true,force:true})});
  const report=fixture(),messages=intelligenceCardMessages(report,target);store.enqueue(report,target,messages);
  const leased=store.messageClaim(10000),saved=leased.payload;assert.equal(JSON.parse(saved).msg_type,'interactive');
  store.messageFinish(leased,{state:'retry',error:'timeout'},10000);
  store.enqueue(report,target,messages.map(m=>({...m,payload:{msg_type:'text',content:'CHANGED'}})));
  assert.equal(store.messageClaim(50000).payload,saved);
  store.enqueue({id:'legacy'},target,[{uuid:'legacy',text:'旧文本'}]);assert.equal(JSON.parse(store.db.prepare("SELECT payload FROM messages WHERE uuid='legacy'").get().payload).msg_type,'text');
});
