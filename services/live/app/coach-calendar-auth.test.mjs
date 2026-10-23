import test from 'node:test';
import assert from 'node:assert/strict';
import {createCoachCalendarAuth} from './coach-calendar-auth.mjs';

const roster=[['官旗','曾泳淇','FD-024035'],['品牌精选','梁瑜涵','FD-023807'],['优选','李爽','FD-028493'],['王鸥美肤','鲍敏纳','FD-026339']];
function fixture(){
  const verified=[];
  const handler=createCoachCalendarAuth({
    readers:Object.fromEntries(roster.map(([room])=>[room,{status:async()=>({configured:true,authorized:false}),begin:()=>({state:'isolated-test-state',url:'https://accounts.feishu.cn/test'})}])),
    coachNames:Object.fromEntries(roster.map(([room,name])=>[room,name])),
    employeeNos:Object.fromEntries(roster.map(([room,,number])=>[room,number])),
    openIds:Object.fromEntries(roster.map(([room,,number])=>[room,'ou_'+number])),
    basePath:'/yxb/wis-marketing-hub/modules/live-room-management',enabled:true,readOnly:false,
    json:(res,status,body)=>Object.assign(res,{status,body}),
    verifyActor:async(...args)=>verified.push(args),
  });
  return {handler,verified};
}
const response=()=>({headers:{},setHeader(k,v){this.headers[k]=v}});
for(const [room,name,number] of roster){
  test(`${name}: OA realName reaches authorization status and start`,async()=>{
    const {handler,verified}=fixture();
    const auth={ok:true,mode:'central',user:{number,realName:name,status:'normal'}};
    const status=response();
    await handler.handleApi({method:'GET',headers:{}},status,'/api/lifecycle/coach-calendar-auth/status',auth);
    assert.equal(status.status,200,JSON.stringify(status.body));
    assert.equal(status.body.room,room);
    assert.equal(status.body.enabled,true);
    assert.equal(status.body.calendar.configured,true);
    assert.equal(status.body.calendar.authorized,false);
    const start=response();
    await handler.handleApi({method:'POST',headers:{host:'hub.fandow.com',origin:'https://hub.fandow.com','x-requested-with':'XMLHttpRequest','sec-fetch-site':'same-origin'}},start,'/api/lifecycle/coach-calendar-auth/start',auth);
    assert.equal(start.status,200,JSON.stringify(start.body));
    assert.match(start.body.authorizeUrl,/^https:\/\/accounts\.feishu\.cn\//);
    assert.equal(verified.length,2);
  });
}
test('non-coach, wrong identity, stale session and cross-origin requests stay blocked',async()=>{
  const {handler,verified}=fixture();
  const valid={ok:true,mode:'central',user:{number:'FD-024035',realName:'曾泳淇'}};
  for(const auth of [
    {...valid,user:{number:'FD-227829',realName:'崔经瀚'}},
    {...valid,user:{number:'FD-024035',realName:'李爽'}},
    {...valid,user:{...valid.user,open_id:'ou_wrong'}},
    {...valid,user:{number:'FD-024035'}},
    {...valid,degraded:true},{...valid,mode:'internal'},{...valid,ok:false},
  ]){
    const res=response();await handler.handleApi({method:'GET',headers:{}},res,'/api/lifecycle/coach-calendar-auth/status',auth);
    assert.equal(res.status,403);
  }
  assert.equal(verified.length,0);
  const res=response();await handler.handleApi({method:'POST',headers:{host:'hub.fandow.com',origin:'https://other.invalid','x-requested-with':'XMLHttpRequest'}},res,'/api/lifecycle/coach-calendar-auth/start',valid);
  assert.equal(res.status,403);
});
test('legacy name-only central sessions remain compatible',()=>{
  const {handler}=fixture();
  assert.equal(handler.roomFor({ok:true,mode:'central',user:{number:'FD-024035',name:'曾泳淇'}}),'官旗');
});
