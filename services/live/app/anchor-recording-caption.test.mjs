import test from 'node:test';
import assert from 'node:assert/strict';
import {parseRecordingCaption,recordingMessageCaption} from './anchor-recording-caption.mjs';
import {readFile} from 'node:fs/promises';
import {AnchorStatusStore} from './anchor-status-store.mjs';
import {createAnchorStatusService} from './anchor-status-service.mjs';
const message=(text,seconds=0,sender='sender')=>({messageId:'message-'+seconds,text,createdAt:new Date(Date.parse('2026-10-06T10:00:00Z')+seconds*1000).toISOString(),sender:{id:sender}});

test('source message supplies anchor and room without consulting a roster or rewriting a name',()=>{
  for(const [text,name,room] of [['王鸥美肤 李彩红（声音麦克风背景音乐均无异常）','李彩红','王鸥美肤'],['品牌精选 李凯彤','李凯彤','品牌精选'],['<p>官旗李楚晴（声音麦克风无异常）</p>','李楚晴','官旗'],['优选 黄芷瞳（无异常）','黄芷瞳','优选'],['【品牌精选】主播：刘睿 15:00-19:00','刘睿','品牌精选']]){
    const actual=parseRecordingCaption(text);assert.equal(actual.name,name);assert.equal(actual.room,room);assert.equal(actual.text,text);
  }
});
test('nearby caption requires the same sender, five-minute window and one unambiguous identity',()=>{
  const video=message('');const caption=message('品牌精选 李凯彤',4);
  const result=recordingMessageCaption(video,[video,caption]);assert.equal(result.name,'李凯彤');assert.equal(result.captionMessageId,caption.messageId);
  assert.equal(recordingMessageCaption(video,[message('品牌精选 李凯彤',4,'other')]),null);
  assert.equal(recordingMessageCaption(video,[message('品牌精选 李凯彤',301)]),null);
  assert.equal(recordingMessageCaption(video,[caption,message('王鸥美肤 李彩红',8)]),null);
  assert.equal(recordingMessageCaption(message('',0,''),[caption]),null);
});
test('missing or ambiguous explicit room/name stays unresolved, without profile fallback',()=>{
  for(const value of ['刘睿','品牌精选','品牌精选 无异常','品牌精选 甲、乙','品牌精选 甲与乙','官旗 甲；优选 乙'])assert.equal(parseRecordingCaption(value),null,value);
  assert.equal(recordingMessageCaption(message('官旗 甲；优选 乙'),[message('官旗 甲')]),null);
  const own=recordingMessageCaption(message('品牌精选 刘睿'),[message('王鸥美肤 李彩红',1)]);assert.equal(own.name,'刘睿');
});

test('actual hourly collector and service discover message authors outside a stale or unavailable roster',async()=>{
  const server=await readFile(new URL('./server.js',import.meta.url),'utf8');
  const start=server.indexOf('async function collectAnchorEvidence('),end=server.indexOf('async function readOfficialAnchorDevelopment()',start);
  const video={...message(''),messageId:'om_fixture_0123456789',resources:[{type:'file',name:'recording.mov',key:'file_fixture_0123456789'}]};
  const caption=message('王鸥美肤 林羽浠（声音无异常）',4);
  const dependencies={getChatMessages:async()=>({key:'learning',name:'WIS直播学习',messages:[video,caption],fetchedAt:'now'}),
    feishuChats:{coaching:{name:'WIS直播教练'},learning:{name:'WIS直播学习'}},recordingMessageCaption,recordingCaption:()=>assert.fail('roster-based matcher cannot handle hourly collection'),
    publicEvidenceMessage:(m,text=m.text)=>({messageId:m.messageId,text,createdAt:m.createdAt,resources:m.resources||[]}),extractAnchorEvaluation:()=>null};
  const collect=new Function('deps',`const {${Object.keys(dependencies).join(',')}}=deps;${server.slice(start,end)};return collectAnchorEvidence;`)(dependencies);
  const store=new AnchorStatusStore(':memory:');try{
    const service=createAnchorStatusService({store,profiles:async()=>{throw Error('roster unavailable')},collect:names=>collect(names,'2026-10-06',{recordingsOnly:true,includeAll:true})});
    await service.scan();assert.equal(service.list({})[0].name,'林羽浠');assert.equal(service.list({})[0].room,'王鸥美肤');assert.equal(service.list({})[0].recording.attribution.captionMessageId,caption.messageId);
    const job=store.list()[0];job.source.profile={room:'优选'};assert.equal(parseRecordingCaption(job.source.recording.text).room,'王鸥美肤');
  }finally{store.close();}
});
