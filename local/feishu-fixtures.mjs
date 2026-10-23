// Local-only Feishu Sheets simulator. No external calls, production tokens or messages.
import http from 'node:http';
import fs from 'node:fs/promises';
if(process.env.LOCAL_SIMULATION!=='1')throw new Error('Local simulation flag required');
const file='/data/local-sheets.json';
let state;
try{state=JSON.parse(await fs.readFile(file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
if(!state){
  const today=new Date();const dates=Array.from({length:183},(_,i)=>new Date(Date.UTC(today.getUTCFullYear(),today.getUTCMonth()-1,1+i)).toISOString().slice(0,10));
  const rows=[['UID','部门','工号','姓名',...dates],
    ['LOCAL-1','凡岛-品牌营销部-直播中心-本机模拟','LOCAL-0001','模拟主播甲',...dates.map(()=> '')],
    ['LOCAL-2','凡岛-品牌营销部-直播中心-本机模拟','LOCAL-0002','模拟主播乙',...dates.map(()=> '')],
    ['本机模拟班次说明','','','','L(05:30-14:30)','F(08:00-17:00)','J2(14:30-23:00)','P(16:30-次日01:00)','M(21:30-次日05:00)','休']];
  state={localSimulation:true,revision:1,rows,calls:[],messages:[]};
  await fs.writeFile(file,JSON.stringify(state));
}
if(state.localSimulation!==true)throw new Error('Unmarked sheet state');
const localRooms=[['guanqi','NYB2iu',3],['brand_selection','MVpDv0',3],['youxuan','LRAvIU',4],['wangou','PhlV42',3]];
const localName=(room,role,i)=>'模拟'+({guanqi:'官旗',brand_selection:'精选',youxuan:'优选',wangou:'王鸥'}[room])+({anchor:'主播',assistant:'助理'}[role])+'甲乙丙丁戊'[i-1];
if(state.fullScheduleFixture!==2){
  for(const [room] of localRooms)for(const role of ['anchor','assistant'])for(let i=1;i<=5;i++){
    const name=localName(room,role,i);
    state.rows.push([`LOCAL-${room}-${role}-${i}`,'凡岛-品牌营销部-直播中心-本机模拟',`LOCAL-${room}-${role}-${i}`,name,...state.rows[0].slice(4).map(()=> '')]);
  }
  state.fullScheduleFixture=2;
}
if(!state.officialSheets||state.officialFixtureVersion!==2){
  state.officialSheets={};
  const dates=state.rows[0].slice(4);
  for(const [room,sheet,column] of localRooms){
    const rows=[];
    for(const date of dates){
      const [year,month,day]=date.split('-').map(Number);
      rows.push([`${year}年${month}月${day}日`]);
      for(const role of ['anchor','assistant']){
        const times=Array(17).fill(''),names=Array(17).fill('');times[1]=role==='anchor'?'主播':'助理';
        ['05:30-14:30','14:30-23:00','23:00-次日05:30'].forEach((value,i)=>{times[column+i]=value;names[column+i]=localName(room,role,i+1);});
        rows.push(times,names);
      }
    }
    state.officialSheets[sheet]=rows;
  }
  state.officialFixtureVersion=2;
}
state.rows[3]=['班次信息: L(05:30-14:30) F(08:00-17:00) J2(14:30-23:00) P(16:30-次日01:00) M(21:30-次日05:00) AC1(07:30-16:30) WB(17:30-次日02:00) R(06:30-15:30) X(10:00-19:00) B3(13:30-22:00) A(08:30-17:30) Z(11:30-20:00) I(13:00-22:00) J(14:00-23:00) ZBB(21:00-次日06:00) Q(09:30-18:30)','','',''];
await fs.writeFile(file,JSON.stringify(state));
const col=value=>[...value].reduce((n,c)=>n*26+c.charCodeAt(0)-64,0)-1;
function rangeBounds(range){
  const [sheet,area]=range.split('!');
  const match=area?.match(/^([A-Z]+)(\d*)?(?::([A-Z]+)(\d*)?)?$/);
  if(!match)throw new Error('Invalid fixture range');
  return {sheet,c1:col(match[1]),r1:match[2]?Number(match[2])-1:0,
    c2:match[3]?col(match[3]):col(match[1]),r2:match[4]?Number(match[4])-1:state.rows.length-1};
}
let queue=Promise.resolve();
http.createServer((req,res)=>{
  const operation=async()=>{
    const url=new URL(req.url,'http://fixtures');let body='';
    for await(const part of req){body+=part;if(body.length>1024*1024)throw new Error('Body too large');}
    const payload=body?JSON.parse(body):{};
    const reply=(value,status=200)=>{res.writeHead(status,{'Content-Type':'application/json','X-Local-Simulation':'true'});res.end(JSON.stringify(value));};
    if(url.pathname==='/health')return reply({ok:true,mode:'local-simulation'});
    if(url.pathname==='/fixture/state')return reply(state);
    state.calls.push({method:req.method,path:url.pathname,at:new Date().toISOString()});state.calls=state.calls.slice(-300);
    let value;
    if(url.pathname==='/open-apis/auth/v3/tenant_access_token/internal'){
      if(payload.app_id!=='local-simulation'||payload.app_secret!=='local-simulation')return reply({code:999,msg:'Only fixture credentials accepted'},403);
      value={code:0,tenant_access_token:'local-simulation-token',expire:7200};
    } else if(req.headers.authorization!=='Bearer local-simulation-token')return reply({code:999,msg:'Fixture token required'},401);
    else if(url.pathname.includes('/wiki/v2/spaces/get_node'))value={code:0,data:{node:{obj_type:'sheet',obj_token:'Wj4zs3oDfhGUfetlTXicxblmnHe'}}};
    else if(url.pathname.endsWith('/sheets/query'))value={code:0,data:{revision:state.revision,sheets:[{sheet_id:'0jFdXf',title:'排班表',grid_properties:{row_count:state.rows.length,column_count:96}}]}};
    else if(url.pathname.endsWith('/values_batch_update')&&req.method==='POST'){
      const updates=payload.valueRanges;
      if(!Array.isArray(updates))return reply({code:1,msg:'valueRanges required'},422);
      for(const item of updates){const b=rangeBounds(item.range);if(b.sheet!=='0jFdXf')throw new Error('Unexpected local sheet');
        item.values.forEach((row,y)=>row.forEach((cell,x)=>{state.rows[b.r1+y]??=[];state.rows[b.r1+y][b.c1+x]=String(cell);}));}
      const spreadsheetToken=url.pathname.split('/spreadsheets/')[1].split('/')[0];
      state.revision++;value={code:0,data:{spreadsheetToken,revision:state.revision,
        responses:updates.map(v=>({spreadsheetToken,updatedRange:v.range,updatedRows:v.values.length,
          updatedColumns:v.values[0].length,updatedCells:v.values.reduce((n,row)=>n+row.length,0)}))}};
    } else if(url.pathname.includes('/values/')&&req.method==='GET'){
      const range=decodeURIComponent(url.pathname.split('/values/')[1]);const b=rangeBounds(range);
      const source=b.sheet==='0jFdXf'?state.rows:state.officialSheets[b.sheet];
      if(!source)return reply({code:404,msg:'Unknown synthetic sheet'},404);
      const end=/\d/.test(range.split('!')[1])?b.r2+1:source.length;
      const rows=source.slice(b.r1,end).map(row=>Array.from({length:b.c2-b.c1+1},(_,i)=>row[b.c1+i]||''));
      value={code:0,data:{revision:state.revision,valueRange:{range,revision:state.revision,values:rows}}};
    } else return reply({code:404,msg:'Unimplemented local fixture endpoint',path:url.pathname},404);
    await fs.writeFile(file,JSON.stringify(state));reply({...value,localSimulation:true});
  };
  queue=queue.then(operation).catch(error=>{if(!res.headersSent)res.writeHead(500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:error.message,localSimulation:true}));});
}).listen(3000,'0.0.0.0');
