import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {buildBitableReview,minutesUrl,readReviewRecords} from './coach-review-bitable.mjs';
const context={module:{exports:{}},Date,URL};vm.runInNewContext(await readFile(new URL('./public/modules/anchors/assets/coach-review-ui.js',import.meta.url),'utf8'),context);
const ui=context.module.exports;
class Element{constructor(tag){this.tag=tag;this.children=[];this.style={};}appendChild(node){this.children.push(node);return node;}}
const doc={createElement:tag=>new Element(tag),createTextNode:text=>({tag:'#text',textContent:text})};
test('plain, hyperlink and rich-text fields resolve only valid Feishu HTTPS links',()=>{
 const url='https://jqx28l0j4lx.feishu.cn/minutes/example';
 for(const value of [url,{link:url,text:'纪要'},[{type:'url',text:url}],[{link:url}]])assert.equal(minutesUrl(value),url);
 for(const bad of ['javascript:alert(1)','https://feishu.cn.evil.test/','https://user:pass@feishu.cn/','http://feishu.cn/',null])assert.equal(minutesUrl(bad),null);
 assert.equal(ui.safeMinutesUrl('javascript:alert(1)'),null);
});
test('links follow deduplicated counted rows and sort newest first',async()=>{
 const row=(id,day,url)=>({record_id:id,fields:{'主播':'测试甲','所属直播间':'官旗','会议主题':'复盘','会议日期':Date.parse(day+'T00:00:00+08:00'),'纪要链接':url}});
 const a=row('1','2026-09-24','https://feishu.cn/docx/one'),b=row('2','2026-09-28',{link:'https://feishu.cn/docx/two'});
 const data=buildBitableReview([a,b,a],'2026-09-29',new Date('2026-09-29T08:00:00Z'));
 const anchor=ui.normalizeCoachReview(data).rooms['官旗'].anchors[0];
 assert.equal(anchor.count,2);assert.equal(anchor.reviews[0].url,'https://feishu.cn/docx/two');
 const rendered=ui.renderReviewAnchor(doc,anchor);assert.equal(rendered.children[0].tag,'details');assert.match(rendered.children[0].children[0].textContent,/测试甲/);
 const link=rendered.children[0].children[1].children[0].children[0];assert.equal(link.href,'https://feishu.cn/docx/two');assert.equal(link.target,'_blank');assert.equal(link.rel,'noopener noreferrer');
 await readReviewRecords(async path=>{assert.ok(JSON.parse(new URL(path,'https://example.test').searchParams.get('field_names')).includes('纪要链接'));return {items:[],has_more:false};});
});
test('single review opens directly; missing link leaves count intact without fake navigation',()=>{
 const item=ui.renderReviewAnchor(doc,{name:'甲',count:1,reviews:[{date:'2026-09-28',url:'https://feishu.cn/docx/one'}]});assert.equal(item.children[0].tag,'a');assert.equal(item.children[0].textContent,'甲');
 const absent=ui.renderReviewAnchor(doc,{name:'乙',count:1,reviews:[{date:'2026-09-28',url:null}]});assert.match(absent.textContent,/1 次（暂无纪要链接）/);
});
