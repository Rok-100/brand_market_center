import {mkdir,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {writeDurableJsonAtomic} from './durable-journal.mjs';

export const targetRooms = Object.freeze(['guanqi','brand-selection','preferred','wangou']);
function invalid(message,status=422){return Object.assign(new Error(message),{status});}
export function validTargetMonth(month){
  if(typeof month!=='string'||!/^20\d{2}-(0[1-9]|1[0-2])$/.test(month))throw invalid('请选择有效月份。');
  return month;
}
export function createMonthlyTargetStore({directory,write=writeDurableJsonAtomic}){
  let queue=Promise.resolve();
  const pathFor=month=>join(directory,`monthly-targets-${validTargetMonth(month)}.json`);
  async function read(month){
    try {
      const store=JSON.parse(await readFile(pathFor(month),'utf8'));
      if(store.schemaVersion!==1||store.month!==month||!Array.isArray(store.history)||!store.items)throw invalid('月目标存储格式异常，请联系管理员。',503);
      return store;
    }catch(error){if(error.code==='ENOENT')return{schemaVersion:1,month,items:{},history:[]};throw error;}
  }
  async function get(month){const store=await read(month);return{month,items:store.items};}
  function save(input,actor){
    const task=queue.then(async()=>{
      const month=validTargetMonth(input?.month),code=input?.code,amount=input?.amount,version=input?.version;
      if(!targetRooms.includes(code))throw invalid('请选择有效直播间。');
      if(typeof amount!=='number'||!Number.isFinite(amount)||amount<=0||amount>1e12||Math.abs(amount*100-Math.round(amount*100))>0.001)throw invalid('目标需为大于 0 的金额（元），最多两位小数。');
      if(!Number.isSafeInteger(version)||version<0)throw invalid('缺少目标版本，请刷新后重试。');
      const store=await read(month),previous=store.items[code]||null;
      if((previous?.version||0)!==version)throw invalid('该目标已被其他人修改，请刷新后重新编辑。',409);
      const item={amount,version:version+1,updatedAt:new Date().toISOString(),updatedBy:String(actor||'已授权成员').slice(0,120)};
      store.items[code]=item;
      store.history.push({code,previous,next:item});
      await mkdir(directory,{recursive:true});
      await write(pathFor(month),store);
      return{month,code,item};
    });
    queue=task.catch(()=>{});
    return task;
  }
  return{get,save};
}
