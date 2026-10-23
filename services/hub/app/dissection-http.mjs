import {ensure,clean} from './dissection-store.mjs';
import {videoModels,oaToken} from './dissection-ai.mjs';
export function createDissectionHandler({service,currentSession,readJson,sendJson}){
  return async(req,res,url)=>{
    if(!url.pathname.startsWith('/api/dissection-review'))return false;
    try{const session=await currentSession(req);if(session.status!==200){sendJson(res,session.status,session.payload);return true;}const a=service.access(session.payload);ensure(a.enabled,'当前账号未开通拉片审核权限',403);
      if(req.method==='GET'&&url.pathname==='/api/dissection-review'){const value=service.overview(a);value.configVersion=service.store.read().version;sendJson(res,200,value);}
      else if(req.method==='GET'&&url.pathname==='/api/dissection-review/models'){ensure(a.configure,'模型设置需要部门管理权限',403);sendJson(res,200,{models:await videoModels(oaToken(req.headers),service.fetch)});}
      else if(req.method==='POST'){
        ensure(req.headers['x-dissection-request']==='1'&&req.headers['sec-fetch-site']!=='cross-site','请求来源无效',403);const origin=req.headers.origin;if(origin)ensure(new URL(origin).origin===new URL(service.env.DISSECTION_PUBLIC_URL||'https://hub.fandow.com').origin,'请求来源无效',403);
        const body=await readJson(req);
        if(url.pathname==='/api/dissection-review/config'){sendJson(res,200,await service.configure(a,body,req.headers));}
        else {const match=/^\/api\/dissection-review\/jobs\/(dissect_[a-f0-9]{24})\/action$/u.exec(url.pathname);ensure(match,'拉片接口不存在',404);sendJson(res,200,service.action(a,match[1],body));}
      }else if(req.method==='GET'){
        const match=/^\/api\/dissection-review\/jobs\/(dissect_[a-f0-9]{24})\/(video|poster)$/u.exec(url.pathname);ensure(match,'拉片接口不存在',404);const j=service.store.read().jobs.find(j=>j.id===match[1]);ensure(j&&service.canSee(j,a),'没有该视频的查看权限',403);if(match[2]==='poster')await service.poster(req,res,j);else await service.video(req,res,j);
      }else sendJson(res,405,{detail:'请求方式不支持'});
    }catch(error){if(!res.headersSent&&!res.destroyed)sendJson(res,error.status||503,{detail:clean(error.message||'拉片服务暂不可用',1000)});else res.destroy();}
    return true;
  };
}
