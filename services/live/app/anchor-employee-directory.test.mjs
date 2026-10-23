import test from 'node:test';
import assert from 'node:assert/strict';
import {createAnchorEmployeeDirectory} from './anchor-employee-directory.mjs';

test('employee numbers use complete scoped directory pages, dedupe multiple departments and preserve message-name aliases',async()=>{
  let calls=0;const read=createAnchorEmployeeDirectory({departmentId:'od-live',canonicalName:name=>name==='黄芷瞳'?'黄芷曈':name,get:async path=>{
    calls++;const url=new URL(path,'https://fixture.invalid');
    if(path.includes('/children'))return {items:[{open_department_id:'od-team'}]};
    if(url.searchParams.get('department_id')==='od-live'&&!url.searchParams.has('page_token'))return{items:[{name:'刘睿',open_id:'ou_liu',employee_no:'FD-023054',status:{is_exited:false}}],has_more:true,page_token:'next'};
    if(url.searchParams.get('department_id')==='od-live')return{items:[{name:'黄芷曈',open_id:'ou_huang',employee_no:'FD-026836'}]};
    return{items:[{name:'刘睿',open_id:'ou_liu',employee_no:'FD-023054'}]};
  }});
  const result=await read(['刘睿','黄芷瞳','缺失主播']);assert.equal(result.byName.刘睿.employeeNumber,'FD-023054');assert.equal(result.byName.黄芷瞳.employeeNumber,'FD-026836');assert.equal(result.byName.缺失主播.status,'missing');
  const before=calls;await read(['刘睿']);assert.equal(calls,before,'the cache does not re-read contacts on each page refresh');
});
test('same-name people, missing numbers and departed users never produce a guessed employee number',async()=>{
  const read=createAnchorEmployeeDirectory({departmentId:'od-live',get:async path=>path.includes('/children')?{items:[]}:{items:[
    {name:'同名主播',open_id:'ou_one',employee_no:'FD-001'},{name:'同名主播',open_id:'ou_two',employee_no:'FD-002'},
    {name:'无工号主播',open_id:'ou_blank',employee_no:''},{name:'已离职主播',open_id:'ou_left',employee_no:'FD-003',status:{is_exited:true}}
  ]}});
  const result=await read(['同名主播','无工号主播','已离职主播']);assert.equal(result.byName.同名主播.status,'ambiguous');assert.equal(result.byName.同名主播.employeeNumber,'');assert.equal(result.byName.无工号主播.status,'missing');assert.equal(result.byName.已离职主播.employeeNumber,'');
});
test('incomplete paging fails the lookup instead of publishing a partial employee directory',async()=>{
  const read=createAnchorEmployeeDirectory({departmentId:'od-live',get:async path=>path.includes('/children')?{items:[]}:{items:[{name:'甲',open_id:'ou_one',employee_no:'FD-001'}],has_more:true,page_token:'repeat'}});
  await assert.rejects(read(['甲']),/分页未完成/);
});
