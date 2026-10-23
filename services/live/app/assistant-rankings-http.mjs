export function createAssistantRankingsHttp({service,json,readOnly=false}){
 return async(req,res,url,path)=>{
  try{
   if(path==='/api/assistant-rankings'&&req.method==='GET')return json(res,200,{ok:true,data:await service.view(url.searchParams.get('month'))});
   if(path==='/api/assistant-rankings/sync'&&req.method==='POST'){
    if(readOnly)return json(res,423,{ok:false,error:'维护恢复中，仅供查看'});
    const origin=req.headers.origin;
    if(req.headers['x-requested-with']!=='XMLHttpRequest')return json(res,403,{ok:false,error:'请求标记无效'});
    if(origin){let host;try{host=new URL(origin).host;}catch{return json(res,403,{ok:false,error:'来源无效'});}if(host!==req.headers.host)return json(res,403,{ok:false,error:'来源无效'});}
    return json(res,200,{ok:true,data:await service.sync('manual')});
   }
   return json(res,405,{ok:false,error:'不支持此操作'});
  }catch(e){return json(res,e.status||503,{ok:false,error:e.status?e.message:'助理排名读取失败，请重试或检查本地存储。'});}
 };
}
