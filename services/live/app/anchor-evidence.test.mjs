import test from 'node:test';
import assert from 'node:assert/strict';
import {recordingCaption,createAnchorEvidenceReader} from './anchor-evidence.mjs';
import {verifiedAnchorEvidence,extractAnchorEvaluation} from './lifecycle-engine.mjs';
const date='2026-09-30T06:00:00Z',names=new Set(['甲主播','乙主播']);
const message=(text,offset=0,id='sender')=>({text,sender:{id},createdAt:new Date(Date.parse(date)+offset).toISOString()});
test('media own caption takes priority over nearby other-anchor captions',()=>assert.deepEqual(recordingCaption(message('甲主播录屏'),[message('乙主播录屏')],names),{name:'甲主播',text:'甲主播录屏'}));
test('ambiguous nearby captions or unknown sender are not attributed',()=>{
  assert.equal(recordingCaption(message(''),[message('甲主播'),message('乙主播')],names),null);
  assert.equal(recordingCaption(message('',0,''),[message('甲主播',0,'')],names),null);
  assert.equal(recordingCaption(message('甲主播与乙主播'),[],names),null);
});
test('unique caption requires same sender and five-minute boundary',()=>{
  assert.deepEqual(recordingCaption(message(''),[message('甲主播',300000)],names),{name:'甲主播',text:'甲主播'});
  assert.equal(recordingCaption(message(''),[message('甲主播',300001),message('甲主播',0,'other')],names),null);
});
test('rolling windows reject expired media and group rankings are not individual reviews',()=>{
  assert.equal(extractAnchorEvaluation('甲主播＞乙主播\n整体话术需要改进','甲主播',[...names]),'');
  assert.match(extractAnchorEvaluation('甲主播\n话术需要改进','甲主播',[...names]),/话术/);
  const row={text:'甲主播',source:'WIS直播学习',resources:[{type:'file',name:'recording.mov'}]};
  const data=verifiedAnchorEvidence({evidenceByAnchor:{甲主播:{recordings:[{...row,createdAt:date},{...row,createdAt:'2026-09-26T06:00:00Z'}]}}},Date.parse(date));
  assert.equal(data.evidenceByAnchor.甲主播.recordings.length,1);
});
test('fresh reader coalesces concurrent cards, expires, and preserves source grades',async()=>{
  let count=0,clock=0;
  const read=createAnchorEvidenceReader({now:()=>clock,ttl:60,loadProfiles:async()=>[{name:'甲主播',abilities:{节奏:'S'}}],loadNames:async()=>[...names],loadEvidence:async ns=>{count++;return{evidenceByAnchor:Object.fromEntries([...ns].map(n=>[n,{recordings:[],evaluations:[]}])),sources:{learning:{available:true}},fetchedAt:date}}});
  const [a,b]=await Promise.all([read('甲主播'),read('乙主播')]);
  assert.equal(count,1);assert.equal(a.profile.abilities.节奏,'S');assert.equal(b.profile,null);
  clock=61;await read('甲主播');assert.equal(count,2);
  await assert.rejects(read('陌生人'),{status:404});
});
test('failed official source remains failed, even when fallback names allow evidence',async()=>{
  const read=createAnchorEvidenceReader({loadProfiles:async()=>{throw Error('upstream secret')},loadNames:async()=>['甲主播'],loadEvidence:async()=>({evidenceByAnchor:{甲主播:{recordings:[],evaluations:[]}},sources:{learning:{available:false}}})});
  const value=await read('甲主播');assert.equal(value.profileSource.available,false);assert.equal(value.profile,null);assert.ok(!JSON.stringify(value).includes('secret'));
});
test('failed first read is retryable; it cannot poison pending promise',async()=>{
  let count=0;
  const read=createAnchorEvidenceReader({loadProfiles:async()=>[{name:'甲主播'}],loadNames:async()=>[],loadEvidence:async()=>{if(!count++)throw Error('unavailable');return{evidenceByAnchor:{甲主播:{}}}}});
  await assert.rejects(read('甲主播'));assert.equal((await read('甲主播')).name,'甲主播');
});
