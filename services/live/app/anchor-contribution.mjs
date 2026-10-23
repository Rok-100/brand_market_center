import {readFile,mkdir,writeFile,rename} from 'node:fs/promises';
import {dirname} from 'node:path';

export const contributionSources={morning:'R4EGwDfYviWba9k9NWycLGyFn1c',target:'Fzxnwt3uwi68OjkqB6zcJ3XSnC1',morningSheet:'j5Rd5P'};
export function businessClock(now=new Date()) {
  const local=new Date(+now+8*3600000);
  return {date:local.toISOString().slice(0,10),month:local.getUTCMonth()+1,year:local.getUTCFullYear(),day:local.getUTCDate(),minute:local.getUTCHours()*60+local.getUTCMinutes()};
}
const clean=v=>String(v??'').trim();
function number(v){const n=typeof v==='number'?v:Number(clean(v).replace(/,/g,''));if(v==null||clean(v)===''||!Number.isFinite(n))throw Error('来源 GMV 或消耗为空或不是有效数字');return n;}
export function parseMorning(rows,date){
  if(!rows[0]?.[0]?.includes(businessClock(new Date(date+'T00:00:00+08:00')).month+'月'))throw Error('早报不是当前月份');
  const headers=rows[1]||[];
  for(const [i,label] of [[3,'主播属性'],[5,'主播姓名'],[6,'GMV'],[7,'消耗']])if(clean(headers[i])!==label)throw Error('早报字段位置变化，停止同步');
  const serial=Number(headers[1]);
  const end=Number.isFinite(serial)&&serial>40000?new Date(Date.UTC(1899,11,30)+serial*86400000).toISOString().slice(0,10):clean(headers[1]).replace(/\//g,'-');
  const previous=new Date(Date.parse(date+'T00:00:00Z')-86400000).toISOString().slice(0,10);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(end)||end<previous||end>date)throw Error('早报统计截止日期过旧或无效，停止同步');
  const seen=new Set();const result=[];
  for(const row of rows.slice(2)){
    const name=clean(row[5]);if(!name)continue;
    const type=clean(row[3]);if(!['高级主播','普通主播'].includes(type))throw Error('主播属性待核验：'+name);
    if(seen.has(name))throw Error('来源存在重复主播：'+name);seen.add(name);
    result.push({name,type,gmv:number(row[6]),spend:number(row[7])});
  }
  if(!result.length)throw Error('早报没有有效主播数据');return result;
}
export function planContribution(source,rows,{allowNew=true}={}){
  const head=rows[0]||[];for(const [i,label]of [[0,'主播名字'],[1,'GMV'],[2,'消耗'],[3,'主播类型'],[4,'完成率']])if(clean(head[i])!==label)throw Error('贡献值表字段位置变化，停止同步');
  const named=new Map(),free=[];
  // Existing formulas define eligible data rows; never extend into summary areas.
  for(let i=3;i<rows.length;i++){
    const row=rows[i]||[],name=clean(row[0]);
    if(!row[4]||!row[5]||!row[6])continue;
    if(!name||/^\d+号$/.test(name)){if(row[1]==null&&row[2]==null)free.push(i+1);continue;}
    if(named.has(name))throw Error('贡献值表存在重复主播：'+name);named.set(name,i+1);
  }
  return source.map(person=>{if(!allowNew&&!named.has(person.name))throw Error('请先在贡献值表建立主播行：'+person.name);const row=named.get(person.name)||free.shift();if(!row)throw Error('贡献值表没有足够的空白公式行');return {row,values:[person.name,person.gmv,person.spend,person.type]};});
}
export function completion(value){
  const raw=clean(value);if(!raw)return null;
  const rate=raw.endsWith('%')?Number(raw.slice(0,-1))/100:Number(raw);
  if(!Number.isFinite(rate))return null;
  return {rate,label:(rate*100).toFixed(1)+'%',tone:rate<0?'red':'green'};
}
export function createContributionService({get,put,statePath,enabled=false,clock=()=>new Date()}){
  let state={lastSuccessDate:'',lastError:null},running=null,lastAttempt=0,cached=null,cacheAt=0;
  const ready=readFile(statePath,'utf8').then(raw=>{state=JSON.parse(raw);}).catch(e=>{if(e.code!=='ENOENT')throw e;});
  async function save(){await mkdir(dirname(statePath),{recursive:true});const temp=statePath+'.tmp';await writeFile(temp,JSON.stringify(state),{mode:0o600});await rename(temp,statePath);}
  async function books(time=businessClock(clock())){
    const morning=(await get('/wiki/v2/spaces/get_node?token='+contributionSources.morning)).node;
    const target=(await get('/wiki/v2/spaces/get_node?token='+contributionSources.target)).node;
    if(morning?.obj_type!=='sheet'||target?.obj_type!=='sheet')throw Error('来源文档类型不正确');
    const sheets=(await get('/sheets/v3/spreadsheets/'+target.obj_token+'/sheets/query')).sheets||[];
    const month=time.month;
    const matches=sheets.filter(s=>!s.hidden&&s.title==='抖店&视频号'+month+'月');
    if(matches.length!==1)throw Error('找不到唯一的当月贡献值工作表');
    return {morning:morning.obj_token,target:target.obj_token,sheet:matches[0]};
  }
  async function values(book,range,format='FormattedValue'){
    return (await get('/sheets/v2/spreadsheets/'+book+'/values/'+encodeURIComponent(range)+'?valueRenderOption='+format)).valueRange?.values||[];
  }
  async function prepare(){
    const time=businessClock(clock()),date=time.date,b=await books(time);
    const source=parseMorning(await values(b.morning,contributionSources.morningSheet+'!A1:H182','UnformattedValue'),date);
    const formulaRows=await values(b.target,b.sheet.sheet_id+'!A1:G'+b.sheet.grid_properties.row_count,'Formula');
    const plan=planContribution(source,formulaRows,{allowNew:false});
    const inputRows=await values(b.target,b.sheet.sheet_id+'!A1:D'+b.sheet.grid_properties.row_count,'UnformattedValue');
    const dayBefore=await values(b.target,b.sheet.sheet_id+'!Q1:Q1','UnformattedValue');
    for(const p of plan)if(clean(inputRows[p.row-1]?.[0])!==p.values[0])throw Error('目标行已变化，停止同步');
    return {b,date,time,plan,formulaRows,inputRows,dayBefore};
  }
  async function sync(scheduled=false){
    await ready;if(!enabled)throw Error('贡献值写入尚未启用');if(running)return running;
    running=(async()=>{try{
      const {b,date,time,plan,formulaRows,inputRows,dayBefore}=await prepare();
      const freshFormulas=await values(b.target,b.sheet.sheet_id+'!A1:G'+b.sheet.grid_properties.row_count,'Formula');
      const freshInputs=await values(b.target,b.sheet.sheet_id+'!A1:D'+b.sheet.grid_properties.row_count,'UnformattedValue');
      const freshDay=await values(b.target,b.sheet.sheet_id+'!Q1:Q1','UnformattedValue');
      const cells=(row,n)=>Array.from({length:n},(_,i)=>row?.[i]??null);
      for(const p of plan)if(JSON.stringify(cells(freshFormulas[p.row-1],7))!==JSON.stringify(cells(formulaRows[p.row-1],7))||JSON.stringify(cells(freshInputs[p.row-1],4))!==JSON.stringify(cells(inputRows[p.row-1],4)))throw Error('贡献值表已被修改，停止同步，请重新执行');
      if(JSON.stringify(cells(freshDay[0],1))!==JSON.stringify(cells(dayBefore[0],1)))throw Error('日期单元格已被修改，停止同步');
      if(businessClock(clock()).date!==date)throw Error('同步已跨日，停止写入，请重新执行');
      // A single batch updates only input columns and the day counter, never formulas.
      const valueRanges=plan.map(p=>({range:b.sheet.sheet_id+'!A'+p.row+':D'+p.row,values:[p.values]}));
      valueRanges.push({range:b.sheet.sheet_id+'!Q1:Q1',values:[[time.day]]});
      await put('/sheets/v2/spreadsheets/'+b.target+'/values_batch_update',{valueRanges});
      const actual=await values(b.target,b.sheet.sheet_id+'!A1:D'+b.sheet.grid_properties.row_count,'UnformattedValue');
      for(const p of plan)if(p.values.some((v,i)=>String(actual[p.row-1]?.[i]??'')!==String(v)))throw Error('写入后核对失败，等待重试');
      const day=await values(b.target,b.sheet.sheet_id+'!Q1:Q1','UnformattedValue');
      if(Number(day[0]?.[0])!==time.day)throw Error('日期写入后核对失败');
      state={...state,lastScheduledSuccessDate:scheduled?date:(state.lastScheduledSuccessDate||''),lastSuccessDate:date,lastSuccessAt:clock().toISOString(),count:plan.length,sheetTitle:b.sheet.title,lastError:null};await save();cached=null;return state;
    }catch(e){state.lastError=e.message;state.lastFailureAt=clock().toISOString();await save();throw e;}finally{running=null;}})();return running;
  }
  async function snapshot(){
    await ready;if(cached&&+clock()-cacheAt<60000)return cached;
    try{const b=await books(),rows=await values(b.target,b.sheet.sheet_id+'!A1:E'+b.sheet.grid_properties.row_count);const byName={};
      for(const row of rows.slice(3)){const name=clean(row[0]);if(!name||/^\d+号$/.test(name))continue;if(byName[name])throw Error('贡献值表姓名重复');byName[name]=completion(row[4]);}
      cached={byName,sheetTitle:b.sheet.title,checkedAt:clock().toISOString(),sync:{...state},schedule:'每天10:00（北京时间）'};cacheAt=+clock();return cached;
    }catch(e){return {byName:{},error:e.message,sync:{...state},schedule:'每天10:00（北京时间）'};}
  }
  return {snapshot,sync:()=>sync(false),preview:async()=>{await ready;const {b,date,plan}=await prepare();return {date,sheetTitle:b.sheet.title,plan};},status:()=>({...state,enabled,schedule:'10:00 Asia/Shanghai'}),
    async tick(){await ready;const now=businessClock(clock());if(!enabled||now.minute<600||state.lastScheduledSuccessDate===now.date||+clock()-lastAttempt<300000)return;lastAttempt=+clock();await sync(true);}};
}
