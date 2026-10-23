import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {assertFeishuCardRequest} from './feishu-message-policy.mjs';
import {anchorStatusCard} from './anchor-status-card.mjs';
import {DIMENSIONS,normalizeScore} from './anchor-status-policy.mjs';

const result=()=>normalizeScore({status:'scored',quality:{visualUsable:true,audioUsable:true},dimensions:DIMENSIONS.map(name=>({name,score:8,evidence:'实际证据',improvement:'继续保持'})),highlights:['表达流畅'],improvements:['加强镜头交流'],compliance:{status:'clear',hits:[]}});
const job=()=>({name:'甲',room:'官旗',result:result(),source:{identity:{session:{start:'2026-10-07T00:00:00Z',end:'2026-10-07T02:00:00Z'}}}});
const links={reportUrl:'https://example.invalid/report',originalUrl:'https://example.invalid/original'};
test('cards represent normal, confirmed severe and uncertain review without inventing a violation',()=>{
  for(const state of ['normal','severe','review']){
    const row=job();if(state==='severe')row.result={...row.result,warning:true,severe:true};if(state==='review')row.result={...row.result,requiresReview:true,compliance:{status:'uncertain',hits:[]}};
    const card=anchorStatusCard(row,links);assert.equal(card.header.template,{normal:'green',severe:'red',review:'orange'}[state]);
    assert.equal(card.body.elements.length,5);assert.equal(card.body.elements[0].columns[0].elements[0].text_size,'heading-1');
    const actions=card.body.elements[3].columns.map(x=>x.elements[0]);assert.deepEqual(actions.map(x=>x.behaviors[0].default_url),Object.values(links));assert.equal(actions[0].type,'primary_filled');assert.equal(actions[1].type,'default');
    if(state==='review'){assert.ok(JSON.stringify(card).includes('尚未确认违规'));assert.ok(!JSON.stringify(card).includes('严重预警'));}
  }
});
test('group/model content cannot inject mentions or markdown actions into a card',()=>{
  const row=job();row.name='<at id=all></at>';row.result.highlights=['<at id=all></at> [钓鱼](https://evil.invalid)'];
  const body=JSON.stringify(anchorStatusCard(row,links).body);assert.ok(!body.includes('<at '));assert.ok(!body.includes('[钓鱼]'));assert.ok(body.includes('&#60;'));
  delete row.result;assert.throws(()=>anchorStatusCard(row,links),{code:'card_source_invalid'});
});
test('message creation and reply require cards; reactions and unrelated API calls remain allowed',()=>{
  const content=JSON.stringify(anchorStatusCard(job(),links));
  for(const path of ['/im/v1/messages?receive_id_type=open_id','/im/v1/messages/om_test/reply']){
    assertFeishuCardRequest(path,{msg_type:'interactive',content});
    for(const msg_type of ['text','post','media','file'])assert.throws(()=>assertFeishuCardRequest(path,{msg_type,content}),{code:'card_required'});
    assert.throws(()=>assertFeishuCardRequest(path,{msg_type:'interactive',content:'{}'}),{code:'card_required'});
  }
  assertFeishuCardRequest('/im/v1/messages/reactions/batch_query?user_id_type=open_id',{});
  assertFeishuCardRequest('/im/v1/files',{});
});
test('production send adapters retain the card-only guard',async()=>{
  const server=await readFile(new URL('./server.js',import.meta.url),'utf8'),delivery=await readFile(new URL('./anchor-status-delivery.mjs',import.meta.url),'utf8');
  for(const source of [server,delivery])assert.ok(!/msg_type\s*:\s*['"](?:text|post|media|file)['"]/u.test(source));
  assert.ok(server.includes('assertFeishuCardRequest(path,body)'));assert.ok(delivery.includes('assertFeishuCardRequest(path,body)'));
});
