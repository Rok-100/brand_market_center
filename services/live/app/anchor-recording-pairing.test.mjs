import test from 'node:test';
import assert from 'node:assert/strict';
import {recordingMessageCaption} from './anchor-recording-caption.mjs';

const message=(id,at,text='',video=false,sender='operator')=>({messageId:id,createdAt:'2026-10-07T'+at+'Z',text,sender:{id:sender},resources:video?[{type:'file',name:id+'.mov'}]:[]});
const batch=()=>[message('v1','01:11:01.868','',true),message('c1','01:11:04.735','品牌精选 刘睿（声音麦克风背景音乐均无异常）'),message('v2','01:12:02.260','',true),message('c2','01:12:09.553','品牌精选 李楚晴（声音麦克风背景音乐均无异常）')];

test('consecutive operator-posted video/caption pairs retain their individual group identities',()=>{
  const items=batch();
  for(const order of [items,[...items].reverse()]){
    const first=recordingMessageCaption(items[0],order),second=recordingMessageCaption(items[2],order);
    assert.equal(first?.name,'刘睿');assert.equal(first?.room,'品牌精选');assert.equal(first?.captionMessageId,'c1');
    assert.equal(second?.name,'李楚晴');assert.equal(second?.captionMessageId,'c2');
  }
});
test('pairing cannot guess through conflicting captions, ties, distant captions or another sender',()=>{
  const items=batch();
  assert.equal(recordingMessageCaption(items[0],[...items,message('extra','01:11:05.000','官旗 甲')]),null);
  const tied=[message('a','01:11:01.000','',true),message('b','01:11:03.000','',true),message('caption','01:11:02.000','品牌精选 刘睿'),message('other','01:11:04.000','品牌精选 李楚晴')];
  assert.equal(recordingMessageCaption(tied[0],tied),null);
  items[3].createdAt='2026-10-07T01:12:30.000Z';assert.equal(recordingMessageCaption(items[0],items),null);
  const foreign=batch();foreign[1].sender.id='someone-else';assert.notEqual(recordingMessageCaption(foreign[0],foreign)?.name,'刘睿');
});
