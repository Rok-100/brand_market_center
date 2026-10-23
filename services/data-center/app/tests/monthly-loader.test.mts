import test from 'node:test';
import assert from 'node:assert/strict';
import {loadMonthlyLastGmv} from '../app/api/_lib/feishu-dashboard-fallback.ts';

test('monthly read selects named sheets, sums last daily snapshots, isolates missing rooms, refreshes dates',async t=>{
 const priorFetch=globalThis.fetch,priorId=process.env.FEISHU_APP_ID,priorSecret=process.env.FEISHU_APP_SECRET;
 process.env.FEISHU_APP_ID='isolated-test';process.env.FEISHU_APP_SECRET='isolated-test';
 t.after(()=>{globalThis.fetch=priorFetch;if(priorId===undefined)delete process.env.FEISHU_APP_ID;else process.env.FEISHU_APP_ID=priorId;if(priorSecret===undefined)delete process.env.FEISHU_APP_SECRET;else process.env.FEISHU_APP_SECRET=priorSecret;});
 const titles=['官旗数据（2.23后）','品牌精选','优选','王鸥美肤'];
 const data:Record<string,unknown[][]>=Object.fromEntries(titles.map((_,i)=>[String(i),[
   ['日期','时间','主播','累计GMV','累计消耗','累计退款'],
   ['2025/9/1',null,null,99999],
   ['2026/8/31',null,null,77777],
   ['2026/9/1','06:00-06:30',null,10,2,500],
   [null,'06:30-07:00',null,100,10,500],
   [null,'断播重开',null,null],
   ['2026/9/2',null,null,25,5],
   [null,null,null,20,5],
   ['2026/9/3',null,null,1234,5],
 ]]));
 let failRoom=false;
 globalThis.fetch=(async (request:RequestInfo|URL)=>{
  const url=new URL(String(request));
  if(url.pathname.includes('tenant_access_token'))return Response.json({code:0,tenant_access_token:'isolated-test',expire:7200});
  assert.ok(url.pathname.includes('YB0osgtwbhvUdutIiJQcy2Elnmg'));
  if(url.pathname.endsWith('/sheets/query'))return Response.json({code:0,data:{sheets:[...titles.map((title,i)=>({title,sheet_id:String(i)})),{title:'品牌精选（副本）',sheet_id:'copy'}]}});
  const range=decodeURIComponent(url.pathname.split('/values/')[1]),[id,cells]=range.split('!');
  if(failRoom&&id==='3')return Response.json({code:99991672,msg:'no permission'},{status:403});
  const source=data[id];assert.ok(source,`unexpected sheet ${id}`);
  const values=cells==='A:A'?source.map(r=>[r[0]]):(()=>{const m=cells.match(/^A(\d+):[A-Z]+(\d+)$/)!;return source.slice(Number(m[1])-1,Number(m[2]));})();
  return Response.json({code:0,data:{valueRange:{values}}});
 }) as typeof fetch;
 const first=await loadMonthlyLastGmv('2026-09-02',true);
 for(const room of first.rooms){assert.equal(room.actual,120);assert.equal(room.daysFound,2);assert.equal(room.basis,'cumulative_gmv');assert.deepEqual(room.daily.map(d=>d.gmv),[100,20]);}
 data['0'][7][3]=40;
 assert.equal((await loadMonthlyLastGmv('2026-09-02')).rooms[0].actual,120);
 assert.equal((await loadMonthlyLastGmv('2026-09-02',true)).rooms[0].actual,140);
 failRoom=true;
 const partial=await loadMonthlyLastGmv('2026-09-02',true);
 assert.equal(partial.rooms[0].actual,140);assert.equal(partial.rooms[3].actual,null);assert.ok(partial.rooms[3].warning);
});
