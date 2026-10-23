import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {businessClock,completion,parseMorning,planContribution,createContributionService} from './anchor-contribution.mjs';
const headers=['主播名字','GMV','消耗','主播类型','完成率','主播贡献值目标','主播贡献值'];
const morning=[['10月目前主播GMV排名'],[46295,46303,'排序','主播属性','目前所属直播间','主播姓名','GMV','消耗'],[null,null,1,'高级主播','官旗','甲',1000,200]];
const target=[headers,[],[],['1号',null,null,'高级主播','G4/F4','IF(D4)', 'M4+N4']];
test('北京时间10:00，不依赖主机时区',()=>{assert.equal(businessClock(new Date('2026-10-09T01:59:59Z')).minute,599);assert.equal(businessClock(new Date('2026-10-09T02:00:00Z')).minute,600);assert.equal(businessClock(new Date('2026-12-31T16:00:00Z')).month,1);});
test('完成率边界：非负值均绿色，空白不当作0',()=>{assert.equal(completion('-0.1%').tone,'red');assert.equal(completion('100.1%').tone,'green');for(const v of ['0%','75%','100%'])assert.equal(completion(v).tone,'green');assert.equal(completion(null),null);assert.equal(completion('#DIV/0!'),null);});
test('过期来源、重复姓名和空金额阻止写入',()=>{assert.equal(parseMorning(morning,'2026-10-09').length,1);assert.throws(()=>parseMorning(morning,'2026-10-10'));assert.throws(()=>parseMorning([...morning,morning[2]],'2026-10-09'));assert.throws(()=>parseMorning([...morning.slice(0,2),[null,null,1,'高级主播','官旗','甲',null,200]],'2026-10-09'));});
test('已有姓名按原行匹配，只使用有公式的空白行',()=>{const source=parseMorning(morning,'2026-10-09');assert.deepEqual(planContribution(source,target)[0],{row:4,values:['甲',1000,200,'高级主播']});assert.throws(()=>planContribution([...source,{...source[0],name:'乙'}],target));const occupied=[...target.slice(0,3),['甲',500,100,'高级主播','G4/F4','F','G']];assert.equal(planContribution(source,occupied)[0].row,4);});
test('每日调度持久化去重、失败重试且批量不覆盖公式',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'contribution-test-'));let now=new Date('2026-10-09T01:59:00Z'),writes=0,fail=true,actual=target.map(r=>[...r]),q=8;actual[3][0]='甲';
 const get=async path=>{
  if(path.includes('get_node'))return {node:{obj_type:'sheet',obj_token:path.includes('R4EG')?'morning':'target'}};
  if(path.includes('/sheets/query'))return {sheets:[{title:'抖店&视频号10月',sheet_id:'month',grid_properties:{row_count:4}}]};
  if(path.includes('/morning/'))return {valueRange:{values:morning}};
  if(path.includes('Q1'))return {valueRange:{values:[[q]]}};
  return {valueRange:{values:actual}};
 };
 const put=async(path,body)=>{writes++;if(fail)throw Error('permission denied');assert.match(path,/values_batch_update$/);for(const r of body.valueRanges){if(r.range.includes('Q1'))q=r.values[0][0];else{assert.equal(r.range,'month!A4:D4');actual[3].splice(0,4,...r.values[0]);}}};
 const options={get,put,statePath:join(dir,'state.json'),enabled:true,clock:()=>now};const service=createContributionService(options);
 try{await service.tick();assert.equal(writes,0);now=new Date('2026-10-09T02:00:00Z');await assert.rejects(service.tick());assert.equal(writes,1);now=new Date('2026-10-09T02:01:00Z');await service.tick();assert.equal(writes,1);fail=false;now=new Date('2026-10-09T02:05:00Z');await service.tick();assert.equal(q,9);assert.equal(actual[3][4],'G4/F4');assert.equal(service.status().lastSuccessDate,'2026-10-09');await createContributionService(options).tick();assert.equal(writes,2);}finally{await rm(dir,{recursive:true,force:true});}
});
test('关闭写入开关时预览可用、同步拒绝',async()=>{const dir=await mkdtemp(join(tmpdir(),'contribution-disabled-'));try{const service=createContributionService({statePath:join(dir,'state.json'),get:()=>{throw Error('should not fetch')},put:()=>assert.fail('must not write')});await service.tick();await assert.rejects(service.sync(),/尚未启用/);}finally{await rm(dir,{recursive:true,force:true});}});
