import {useEffect, useRef, useState} from 'react';
import type {HubSession} from './types';
import './flow-inbox.css';
import {readbackError} from './home-status';

type Node = {id:string; title?:string; state:string; owner:{number:string;name:string}; dueAt:string|null;dependencies?:string[]};
type Relation = {taskId?:string;title:string;owner:{number:string;name:string};canOpen:boolean};
type InboxFilter = 'active'|'todo'|'ended';
type Overview = {
  access:{number:string;canManage:boolean};
  executionRoutes?:Array<{flow:string;name:string;module:string}>;
  blueprint?:{name:string;version:number;defaultRoute:boolean}|null;
  tasks:Array<{id:string;title:string;workflow:string;state:string;nodes:Node[];relations?:{upstream:Relation[];downstream:Relation[]}}>;
  metrics:{active:number;completed:number;overdue:number;notificationAttention:number};
  myReadyCount:number;
  totalVisibleTaskCount:number;
  pagination:{filter:InboxFilter;query:string;page:number;pageSize:number;total:number;pageCount:number};
  hasMore:boolean;
};
type Selection = {scope:string;filter:InboxFilter;search:string;query:string;page:number};
const base=new URL('workflow-panorama/',window.location.href).pathname;

export function FlowInboxSummary({session,onRouteOrder}:{session:HubSession;onRouteOrder?:(modules:string[])=>void}) {
  const scope=JSON.stringify([session.user.number||session.user.userId||session.user.id,session.workspace.role,session.workspace.center,session.workspace.is_brand_department,session.workspace.dashboard_scope,session.access.policy_state,session.access.allowed_modules,session.permissions.manage_permissions]);
  const defaultFilter:InboxFilter=['director','manager'].includes(session.workspace.role)?'todo':'active';
  const [selection,setSelection]=useState<Selection>({scope,filter:defaultFilter,search:'',query:'',page:1});
  const current=selection.scope===scope?selection:{scope,filter:defaultFilter,search:'',query:'',page:1};
  const {filter,search,query,page}=current;
  const requestKey=JSON.stringify([scope,filter,query,page]);
  const [snapshot,setSnapshot]=useState<{requestKey:string;data:Overview}|null>(null);
  const [failure,setFailure]=useState<{requestKey:string;message:string}|null>(null);
  const [loading,setLoading]=useState(false);
  const refreshRef=useRef<()=>void>(()=>{});
  const data=snapshot?.requestKey===requestKey?snapshot.data:null;
  const error=failure?.requestKey===requestKey?failure.message:'';
  const enabled=(session.workspace.is_brand_department || session.permissions.manage_permissions) && session.access.allowed_modules.includes('workflow-engine') && !session.access.policy_state?.startsWith('development-preview');

  useEffect(()=>{
    if(!enabled||search.trim()===query)return;
    const timer=window.setTimeout(()=>setSelection({scope,filter,search,query:search.trim(),page:1}),300);
    return()=>window.clearTimeout(timer);
  },[enabled,scope,filter,search,query]);

  useEffect(()=>{
    setSnapshot(null);setFailure(null);setLoading(false);onRouteOrder?.([]);if(!enabled)return;
    let alive=true,busy=false;const controller=new AbortController();
    async function refresh(){
      if(busy||document.hidden)return;
      busy=true;setLoading(true);
      try{
        const params=new URLSearchParams({filter,q:query,page:String(page)});
        const response=await fetch('api/flows/home-overview?'+params,{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(30000)]),cache:'no-store'});
        if(!response.ok){
          if(alive&&[401,403].includes(response.status)){setSnapshot(null);onRouteOrder?.([]);}
          throw Error(response.status===403?'请退出权限预览后查看真实待办。':'工作流暂未连接，稍后可从原任务继续。');
        }
        const result=await response.json() as Overview;
        if(alive){setSnapshot({requestKey,data:result});setFailure(null);onRouteOrder?.(result.access.canManage?(result.executionRoutes||[]).map(route=>route.module):[]);}
      }catch(e){if(alive)setFailure({requestKey,message:readbackError(e)});}
      finally{busy=false;if(alive)setLoading(false);}
    }
    refreshRef.current=()=>void refresh();void refresh();
    const timer=window.setInterval(()=>void refresh(),30000);
    return()=>{alive=false;refreshRef.current=()=>{};controller.abort();window.clearInterval(timer);};
  },[enabled,requestKey,filter,query,page,onRouteOrder]);

  if(!enabled)return null;
  if(!['director','manager'].includes(session.workspace.role)||data?.access.canManage===false)return <PersonalInbox
    data={data} error={error} loading={loading||search.trim()!==query} filter={filter} search={search}
    onFilter={next=>setSelection({...current,filter:next,page:1})}
    onSearch={next=>setSelection({...current,search:next})}
    onPage={next=>setSelection({...current,page:next})}
    onRefresh={()=>refreshRef.current()}
  />;
  const items=(data?.tasks||[]).filter(t=>t.state==='running').flatMap(t=>t.nodes.filter(n=>n.state==='ready'&&n.owner.number===data?.access.number).map(n=>({task:t,node:n}))).sort((a,b)=>(Date.parse(a.node.dueAt||'')||Infinity)-(Date.parse(b.node.dueAt||'')||Infinity));
  return <section className="flow-inbox" aria-label="工作流待办" aria-busy={loading}>
    <header><div><h2>工作流待办</h2><p>查看当前轮到你的工作，提交交付后自动通知下一主责。</p></div><div className="home-section-actions"><button disabled={loading} onClick={()=>refreshRef.current()}>{loading?'正在读取':'刷新待办'}</button><a className="flow-inbox-open" href={base+'?view=tasks'}>查看全部任务 →</a></div></header>
    {error&&<p role="status" className="flow-inbox-error">{error}{data?' 已保留上次成功读取的记录。':''}</p>}
    {data?<>{data.blueprint&&<details className="flow-inbox-route"><summary>查看当前流程顺序</summary><p>{data.blueprint.name} · v{data.blueprint.version} · {data.blueprint.defaultRoute?'按此顺序自动交接':'已发布模块顺序'}</p><nav aria-label="当前流程顺序">{data.executionRoutes?.map((route,i)=><a key={route.flow} href={'api/launch/'+encodeURIComponent(route.module)}><small>{i+1}</small> {route.name} {i<(data.executionRoutes?.length||0)-1?'→':''}</a>)}</nav></details>}<div className="flow-inbox-counts"><span><b>{data.myReadyCount}</b> 我待办</span><span><b>{data.metrics.active}</b> 范围内进行中</span><span><b>{data.metrics.overdue}</b> 超时节点</span><span><b>{data.metrics.notificationAttention}</b> 通知待处理</span></div>
      {items.length?<ul>{items.slice(0,4).map(({task,node})=><li key={task.id+node.id}><a href={`${base}?task=${encodeURIComponent(task.id)}`}><span><b>{task.title}</b><small>{node.title?.trim()||'节点名称待核对'} · {node.owner.name}</small></span><span className={node.dueAt&&Date.parse(node.dueAt)<Date.now()?'flow-inbox-late':''}>{node.dueAt?new Date(node.dueAt).toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}):'待核对时限'} →</span></a></li>)}</ul>:<p className="flow-inbox-empty">目前没有轮到你办理的节点。新工作到达时，飞书会同步提醒。</p>}
    </>:!error&&<p role="status">正在读取真实工作流…</p>}
  </section>;
}

function PersonalInbox({data,error,loading,filter,search,onFilter,onSearch,onPage,onRefresh}:{
  data:Overview|null;error:string;loading:boolean;filter:InboxFilter;search:string;
  onFilter:(filter:InboxFilter)=>void;onSearch:(query:string)=>void;onPage:(page:number)=>void;onRefresh:()=>void;
}){
  const number=data?.access.number||'';
  const names=(nodes:Node[],empty:string)=>nodes.length?nodes.map(n=>(n.title?.trim()||'任务环节')+' · '+n.owner.name).join('、'):empty;
  return <section className="flow-inbox" aria-label="我的任务" aria-busy={loading}>
    <header><div><h2>我的任务</h2><p>查看自己的工作、上游交付与下一位接收人。</p></div><div className="home-section-actions"><button disabled={loading} onClick={onRefresh}>{loading?'正在读取':'刷新任务'}</button><a className="flow-inbox-open" href={base+'?view=tasks'}>查看全部任务 →</a></div></header>
    <div className="flow-personal-toolbar"><nav aria-label="我的任务状态">{([['active','进行中'],['todo','待我办理'],['ended','已结束']] as const).map(([key,label])=><button key={key} aria-pressed={filter===key} onClick={()=>onFilter(key)}>{label}</button>)}</nav><input type="search" aria-label="搜索我的任务或负责人" placeholder="搜索我的任务或负责人" maxLength={100} value={search} onChange={e=>onSearch(e.target.value)}/></div>
    {error&&<p role="status" className="flow-inbox-error">{error}{data?' 已保留上次成功读取的记录。':''}</p>}
    {!data&&!error?<p role="status">正在读取我的任务…</p>:data&&<>
      {data.tasks.map(task=>{
        const own=task.nodes.filter(n=>n.owner.number===number),ready=own.filter(n=>n.state==='ready'),pending=own.filter(n=>n.state==='pending'),focus=ready.length?ready:pending.length?pending:own.slice(-1),ids=new Set(focus.map(n=>n.id)),before=new Set(focus.flatMap(n=>n.dependencies||[])),upstream=task.nodes.filter(n=>before.has(n.id)&&!ids.has(n.id)),downstream=task.nodes.filter(n=>(n.dependencies||[]).some(id=>ids.has(id))&&!ids.has(n.id));
        return <article className="flow-personal-card" key={task.id}><header><div><h3>{task.title}</h3><p>{task.state==='completed'?'已完成':task.state==='cancelled'?'已终止':task.state==='paused'?'已暂停':ready.length?'待我办理':'等待上下游'}</p></div><a href={`${base}?task=${encodeURIComponent(task.id)}`}>{task.state==='running'&&ready.length?'办理任务':'查看任务'} →</a></header><div className="flow-personal-journey"><div><small>上游交给我</small>{names(upstream,'由任务发起人交办')}</div><span aria-hidden="true">→</span><div><small>我负责</small>{names(focus,'我参与的任务')}</div><span aria-hidden="true">→</span><div><small>我交给下游</small>{names(downstream,'本环节结束后完成任务')}</div></div>{(['upstream','downstream'] as const).map(direction=>(task.relations?.[direction]||[]).map((relation,i)=><p className="flow-personal-relation" key={direction+i}><b>{direction==='upstream'?'上游交接':'下游接收'}：</b>{relation.owner.name} · {relation.canOpen&&relation.taskId?<a href={`${base}?task=${encodeURIComponent(relation.taskId)}`}>{relation.title} →</a>:relation.title}</p>))}</article>;
      })}
      {!data.tasks.length&&<p className="flow-inbox-empty">暂无符合条件的任务。新工作到达后会在这里显示。</p>}
      {data.pagination.pageCount>1&&<nav className="flow-personal-pages" aria-label="个人任务分页"><button disabled={loading||data.pagination.page===1} onClick={()=>onPage(data.pagination.page-1)}>上一页</button><span>{data.pagination.page} / {data.pagination.pageCount} · 共 {data.pagination.total} 条</span><button disabled={loading||!data.hasMore} onClick={()=>onPage(data.pagination.page+1)}>下一页</button></nav>}
    </>}
  </section>;
}
