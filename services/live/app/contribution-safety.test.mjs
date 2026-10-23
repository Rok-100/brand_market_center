import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createContributionService} from './anchor-contribution.mjs';

async function fixture(run){
 const dir=await mkdtemp(join(tmpdir(),'contribution-safety-'));
 const ctx={now:new Date('2026-10-09T02:00:00Z'),writes:0,reads:0,q:8,hook:()=>{},rows:[['主播名字','GMV','消耗','主播类型','完成率','目标','贡献'],[],[],['甲',500,100,'高级主播','=G4/F4','=IF(D4)','=M4+N4']]};
 const get=async path=>{
  if(path.includes('get_node'))return {node:{obj_type:'sheet',obj_token:path.includes('R4EG')?'morning':'target'}};
  if(path.includes('/sheets/query'))return {sheets:[{title:'抖店&视频号10月',sheet_id:'october',grid_properties:{row_count:4}}]};
  if(path.includes('/morning/'))return {valueRange:{values:[['10月目前主播GMV排名'],[null,'2026-10-'+(ctx.now.getUTCDate()===31?'31':'09'),'排序','主播属性','直播间','主播姓名','GMV','消耗'],[null,null,1,'高级主播','官旗','甲',1000,200]]}};
  ctx.reads++;ctx.hook(path,ctx.reads);
  return {valueRange:{values:structuredClone(path.includes('Q1')?[[ctx.q]]:ctx.rows)}};
 };
 const put=async (_path,{valueRanges})=>{ctx.writes++;for(const range of valueRanges){if(range.range.includes('Q1'))ctx.q=range.values[0][0];else ctx.rows[3].splice(0,4,...range.values[0]);}};
 const options={get,put,enabled:true,statePath:join(dir,'state.json'),clock:()=>ctx.now};
 ctx.service=createContributionService(options);ctx.restart=()=>createContributionService(options);
 try{await run(ctx);}finally{await rm(dir,{recursive:true,force:true});}
}
test('10点前手动同步不会跳过定时任务，重启仍去重',()=>fixture(async c=>{
 c.now=new Date('2026-10-09T01:00:00Z');await c.service.sync();assert.equal(c.writes,1);assert.equal(c.service.status().lastScheduledSuccessDate,'');
 c.now=new Date('2026-10-09T02:00:00Z');await c.service.tick();assert.equal(c.writes,2);assert.equal(c.service.status().lastScheduledSuccessDate,'2026-10-09');await c.restart().tick();assert.equal(c.writes,2);
}));
test('月底跨日终止写入，不把新月份日数写入旧表',()=>fixture(async c=>{
 c.now=new Date('2026-10-31T15:59:59Z');c.hook=(_p,n)=>{if(n===2)c.now=new Date('2026-10-31T16:00:01Z');};
 await assert.rejects(c.service.sync(),/跨日/);assert.equal(c.writes,0);assert.equal(c.q,8);
}));
for(const [label,mutate] of [
 ['姓名',c=>{c.rows[3][0]='乙';}],['金额',c=>{c.rows[3][1]=999;}],['公式',c=>{c.rows[3][4]='=G4/F4+1';}],['日期',c=>{c.q=7;}]
])test('提交前发现人工修改'+label+'时不覆盖',()=>fixture(async c=>{
 c.hook=(_p,n)=>{if(n===4)mutate(c);};await assert.rejects(c.service.sync(),/已被修改/);assert.equal(c.writes,0);assert.equal(c.service.status().lastSuccessDate,'');
}));
test('缺少已有主播行时提示建行，不自动占用空行',()=>fixture(async c=>{
 c.rows[3].splice(0,4,'1号',null,null,'高级主播');await assert.rejects(c.service.sync(),/先在贡献值表建立主播行/);assert.equal(c.writes,0);
}));
test('写入后跨日仍以本次计划日期校验Q1',()=>fixture(async c=>{
 c.now=new Date('2026-10-31T15:59:59Z');c.hook=(_p,n)=>{if(n===7)c.now=new Date('2026-10-31T16:00:01Z');};
 await c.service.sync();assert.equal(c.q,31);assert.equal(c.service.status().lastSuccessDate,'2026-10-31');assert.equal(c.writes,1);
}));
