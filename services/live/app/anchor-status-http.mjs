import {fault} from './anchor-status-policy.mjs';

const PREFIX='/api/lifecycle/status-warning';
export const canManageAnchorStatus=auth=>Boolean(auth?.ok&&!auth.degraded&&(auth.mode==='internal'||auth.permissions?.super_admin||auth.permissions?.operation_admin||auth.permissions?.manage_permissions||auth.user?.number==='FD-027097'));
export function createAnchorStatusHttp({service,contribution,readJson,json,tokenFromRequest,readOnly=false}={}) {
  return async(req,res,url,auth)=>{
    if(!auth?.ok)return json(res,401,{ok:false,error:'请先登录。'});
    const path=url.pathname.slice(PREFIX.length);
    const canManage=canManageAnchorStatus(auth);
    const actor=String(auth.user?.number||'authorized');
    try{
      if(req.method==='GET'){
        // Keep the verified directory snapshot visible while its bot refresh runs.
        // A slow contact API must not hold the recording list or detail response.
        if(path==='/evaluations')service.refreshEmployeeNumbers?.()?.catch(()=>{});
        const filters={date:url.searchParams.get('date')||'',room:url.searchParams.get('room')||'',state:url.searchParams.get('state')||'',name:url.searchParams.get('name')||'',days:Number(url.searchParams.get('days'))};
        let data;
        if(path==='/status')data={...service.status(),contribution:contribution?.status(),canManage,currentUser:{name:String(auth.user?.realName||auth.user?.name||(auth.mode==='internal'?'服务器本机验收':'')),number:String(auth.user?.number||'')}};
        else if(path==='/summary')data=service.summary(filters);
        else if(path==='/evaluations'){
          data=service.list(filters);
          if(contribution){const snapshot=await contribution.snapshot();data=data.map(row=>({...row,contribution:snapshot.byName[row.name]||null,contributionMonth:snapshot.sheetTitle,contributionError:snapshot.error||snapshot.sync?.lastError||null}));}
        }
        else if(path==='/contribution')data=await contribution.snapshot();
        else if(path==='/contribution-preview'){if(!canManage)throw fault('仅负责人可查看同步预览。','forbidden',403);data=await contribution.preview();}
        else if(path==='/trends')data=service.trends(filters);
        else if(path==='/models'){if(!canManage)throw fault('仅负责人可调用模型。','forbidden',403);data=await service.model.models(tokenFromRequest(req.headers));}
        else if(/^\/evaluations\/[^/]+$/.test(path))data=service.detail(decodeURIComponent(path.split('/')[2]));
        else throw fault('接口不存在。','not_found',404);
        return json(res,200,{ok:true,data});
      }
      if(req.method!=='POST')throw fault('不支持此请求方法。','method',405);
      if(readOnly)throw fault('当前为只读模式。','read_only',423);
      if(auth.degraded)throw fault('当前权限状态需要重新核验，请稍后重试。','degraded',403);
      if(!canManage)throw fault('仅倪梦萍或已有管理权限人员可以操作。','forbidden',403);
      let origin;try{origin=new URL(String(req.headers.origin||''));}catch{throw fault('缺少同源请求标识。','origin',403);}
      if(origin.host!==req.headers.host||req.headers['sec-fetch-site']==='cross-site'||req.headers['x-requested-with']!=='XMLHttpRequest'||!/^application\/json(?:;|$)/iu.test(req.headers['content-type']||''))throw fault('请求来源校验失败。','origin',403);
      const input=await readJson(req,12000);let data;
      if(path==='/contribution-sync')data=await contribution.sync();
      else if(path==='/scan')data=await service.scan();
      else if(path==='/automation'){
        const token=input.action==='enable'?tokenFromRequest(req.headers):'';
        if(input.action==='enable'&&!token)throw fault('当前OA登录已失效，请重新登录。','login',401);
        data=await service.configureAutomation({action:input.action,token,actor,selectedModel:input.model});
      }
      else if(path==='/process'){
        if(service.status().automation?.serverManaged){
          if(!service.status().automation.enabled)throw fault('请先启用后台自动评分。','automation_paused',409);
          service.pump().catch(()=>{});return json(res,202,{ok:true,data:{state:'server_queue'}});
        }
        const token=tokenFromRequest(req.headers);if(!token)throw fault('当前 OA 登录已失效，请重新登录。','login',401);
        // Keep the caller's credential only in this operation's memory, never in a queue or log.
        service.work({token,selectedModel:input.model,id:input.id}).catch(()=>{});
        return json(res,202,{ok:true,data:{state:'processing'}});
      }
      else if(/^\/evaluations\/[^/]+\/retry$/.test(path))data=service.retry(path.split('/')[2],actor);
      else if(/^\/evaluations\/[^/]+\/review$/.test(path))data=await service.reviewIdentity(path.split('/')[2],input,actor);
      else if(/^\/evaluations\/[^/]+\/resolve$/.test(path))data=service.resolve(path.split('/')[2],input.note,actor);
      else if(/^\/tasks\/[^/]+$/.test(path)){service.task(path.split('/')[2],input,actor);data={saved:true};}
      else throw fault('接口不存在。','not_found',404);
      return json(res,200,{ok:true,data});
    }catch(error){return json(res,error.status||500,{ok:false,error:error.status?error.message:'预警服务暂不可用，请稍后重试。',code:error.code||'status_error'});}
  };
}
