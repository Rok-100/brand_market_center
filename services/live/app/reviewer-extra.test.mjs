import test from 'node:test';
import assert from 'node:assert/strict';
import {createReviewerDirectory} from './communication-review.mjs';
const status={is_activated:true,is_exited:false,is_resigned:false,is_frozen:false};
const person={name:'叶森莹',employee_no:'FD-223714',open_id:'ou_89eb66a94b8dc2cfaabba5364fa139c8',status};
const auth={ok:true,mode:'central',user:{number:'FD-123456',realName:'测试人'}};
function make(user,items=[]){return createReviewerDirectory({departmentId:'live',get:async path=>path.includes('find_by_department')?{items}:{user}})}
test('find named extra reviewer by partial name and resolve exact identity',async()=>{const d=make(person);const rows=await d.search('森莹',auth);assert.deepEqual(rows,[{number:'FD-223714',name:'叶森莹',department:'AI效率流程D中心'}]);assert.equal((await d.resolve('FD-223714')).openId,person.open_id)});
test('reject mismatched or inactive extra identities',async()=>{for(const user of [{...person,name:'其他人'},{...person,employee_no:'FD-999999'},{...person,status:{...status,is_resigned:true}}]){assert.deepEqual(await make(user).search('叶',auth),[]);await assert.rejects(make(user).resolve('FD-223714'),{status:422})}});
test('preserve existing people and deduplicate when extra person joins department',async()=>{const other={...person,name:'测试同事',employee_no:'FD-111111',open_id:'ou_other'};const d=make(person,[person,other]);assert.equal((await d.load()).length,2);assert.equal((await d.search('叶',auth)).length,1);assert.equal((await d.search('测试',auth)).length,1)});
