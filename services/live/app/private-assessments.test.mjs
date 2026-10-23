import test from 'node:test';
import assert from 'node:assert/strict';
import {parsePrivateAssessments,applyPrivateAssessments,createPrivateAssessmentSource} from './private-assessments.mjs';
const senderNames={ou_ni:'倪梦萍',ou_liu:'刘慧迅'};
const msg=(id,text,at='2026-09-10T05:00:00Z',extra={})=>({message_id:'om_'+id,create_time:String(Date.parse(at)),msg_type:'text',sender:{id:'ou_ni'},body:{content:JSON.stringify({text})},...extra});
const parse=messages=>parsePrivateAssessments(messages,{senderNames});
test('strict threshold includes fractional grades, excludes exactly 70',()=>{
 for(const [score,passed] of [[69.9,false],[70,false],[70.01,true],[100,true]])assert.equal(parse([msg('a',`王颖慧试播分析，均分${score}，考核结束`)]).items[0].passed,passed);
});
test('minimum individual grade cannot veto average above 70',()=>{
 const result=parse([msg('a','谷子晴试播分析，总分304，均分76，有一个最低分未过分数线：评分65')]);
 assert.equal(result.items[0].average,76);assert.equal(result.items[0].passed,true);
});
test('request for confirmation is not described as an explicit approval',()=>{
 const item=parse([msg('a','主管，李楚晴的试播分析文档，均分81.25；您看一下是否正式通过考核')]).items[0];
 assert.equal(item.passed,true);assert.equal(item.sourceConclusion,'消息请求确认；按均分规则判定');
});
test('real message phrasing yields exact names and averages',()=>{
 const cases=[['林羽浠',77.75,'这是林羽浠的试播分析，4分评分，均分为77.75，已通过考核分数'],['李安妮',77.25,'李安妮考核分数通过，收集4位主播教练评分，总分为309，均分为77.25；'],['刘睿',74.75,'刘睿考核结束，总分299，平均分74.75，分数已通过及格线'],['朱海鹏',78,'朱海鹏试播分析，总分312，均分78，分数已过考核'],['李楚晴',81.25,'主管，李楚晴的试播分析文档，总分325，均分81.25；您看一下是否正式通过考核'],['彭佳梦',77.5,'彭佳梦试播分析，总分310，均分77.5，最低分71分，全员打过了及格线'],['李凯彤',75,'主管这个是李凯彤的试播分析报告，总分300，平均分75分，已过考核分数'],['谢红香',68,'谢红香的试播分析报告，总分272，均分68，未通过考核。'],['李彩红',78.5,'李彩红的试播分析报告，总分314，均分78.5，已过考核线'],['邓淑环',80.75,'邓淑环的试播分析报告，总分323，均分80.75，已过考核；']];
 for(const [name,average,text] of cases){const result=parse([msg('a',text)]);assert.equal(result.items.length,1,text);assert.equal(result.items[0].name,name);assert.equal(result.items[0].average,average)}
});
test('retest supersedes initial result without counting quoted prior score as a new test',()=>{
 const a=msg('first','王颖慧试播分析，总分253，均分63.25，未过考核');
 const b=msg('second','主管，王颖慧第二次加练后评分，总分为287，均分为71.75，卡线过了考核\n第一次评分结果：总分为253，均分为63.25','2026-09-13T13:40:46Z');
 const result=parse([b,a,b]);assert.equal(result.items.length,1);const current=result.items[0];assert.equal(current.average,71.75);assert.equal(current.passed,true);assert.deepEqual(current.history.map(x=>x.average),[63.25,71.75]);
});
test('later failed reassessment replaces previous pass',()=>{
 const result=parse([msg('a','王颖慧考核均分75'),msg('b','王颖慧考核均分68','2026-09-14T00:00:00Z')]);assert.equal(result.items[0].passed,false);
});
test('recalled scores, other senders and interview-only results do not create grades',()=>{
 assert.equal(parse([msg('a','王颖慧考核均分80',undefined,{deleted:true}),msg('b','王颖慧考核均分80',undefined,{sender:{id:'other'}}),msg('c','王颖慧面试通过')]).items.length,0);
});
test('ambiguous multi-person grade message is not assigned automatically',()=>{
 const result=parse([msg('a','王颖慧试播分析，均分71\n李彩红试播分析，均分75')]);assert.equal(result.items.length,0);assert.equal(result.unresolved.length,1);
});
test('structured source supports post content and html-wrapped links',()=>{
 const result=parse([msg('a','',undefined,{msg_type:'post',body:{content:JSON.stringify({zh_cn:{title:'王颖慧第二次加练后评分',content:[[{tag:'text',text:'总分287，均分71.75，卡线过了考核'}]]}})}})]);
 assert.equal(result.items[0].name,'王颖慧');assert.equal(result.items[0].average,71.75);
});
const candidate={name:'王颖慧',stage:'hired',status:'已入职',inSubmissionCohort:true,submissionEvidence:{sourceId:'om_submit',date:'2026-09-01'}};
test('cohort counts use newest result once; independent employment stage retained',()=>{
 const source={status:'ready',...parse([msg('a','王颖慧考核均分63.25'),msg('b','王颖慧考核均分71.75','2026-09-13T00:00:00Z')])};
 const result=applyPrivateAssessments([candidate],source);assert.equal(result.summary.passedCount,1);assert.equal(result.summary.failedCount,0);assert.equal(result.candidates[0].stage,'hired');assert.equal(result.candidates[0].assessmentHistory.length,2);
});
test('old assessment cannot attach to a new recruitment submission',()=>{
 const source={status:'ready',...parse([msg('a','王颖慧考核均分80')])};const newer={...candidate,submissionEvidence:{...candidate.submissionEvidence,date:'2026-09-20'}};
 const result=applyPrivateAssessments([newer],source);assert.equal(result.summary.passedCount,0);assert.equal(result.candidates[0].assessmentPassed,undefined);
});
test('missing authorization or incomplete source does not reset existing status',()=>{
 assert.equal(applyPrivateAssessments([candidate],{status:'unavailable'}),null);
});
test('read source caches 60 seconds then updates with new assessment evidence',async()=>{
 let now=Date.parse('2026-09-20T00:00:00Z'),calls=0;
 const reader={status:async()=>({authorized:true}),readMessages:async()=>({items:[msg('a','王颖慧考核均分'+(++calls===1?'63.25':'71.75'))]})};
 const source=createPrivateAssessmentSource({readers:[reader],senderNames,clock:()=>now});assert.equal((await source.load()).items[0].passed,false);assert.equal((await source.load()).items[0].passed,false);assert.equal(calls,1);
 now+=60001;assert.equal((await source.load()).items[0].passed,true);
});
