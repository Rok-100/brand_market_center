import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
const require=createRequire(import.meta.url),ts=require('typescript');
const compile=path=>ts.transpileModule(readFileSync(new URL(path,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
const output=compile('../src/FlowInboxSummary.tsx'),statusOutput=compile('../src/home-status.ts');
const user={number:'SELF'},workspace={role:'manager',center:'A',is_brand_department:true,dashboard_scope:'center'},access={policy_state:'live',allowed_modules:['material-workbench','workflow-engine']};
const session={user,workspace,access,permissions:{manage_permissions:false}};
const specialist={...session,workspace:{...workspace,role:'specialist',dashboard_scope:'personal'}};
const task=(id,extra={})=>({id,title:id,workflow:'02',state:'running',nodes:[{id:'own',title:'我的环节',state:'ready',owner:{number:'SELF',name:'本人'},dueAt:null}],...extra});
const overview=(extra={})=>({access:{number:'SELF',canManage:true},blueprint:{name:'TEAM_BLUEPRINT'},executionRoutes:[{flow:'02',name:'TEAM_ROUTE',module:'material-workbench'}],tasks:[task('OTHER_COLLEAGUE_TASK')],metrics:{active:20,completed:0,overdue:0,notificationAttention:0},myReadyCount:19,totalVisibleTaskCount:20,pagination:{filter:'todo',query:'',page:1,pageSize:6,total:19,pageCount:4},hasMore:true,...extra});
const personal=(extra={})=>overview({access:{number:'SELF',canManage:false},blueprint:undefined,executionRoutes:undefined,pagination:{filter:'active',query:'',page:1,pageSize:6,total:20,pageCount:4},...extra});
const text=tree=>JSON.stringify(tree,(k,v)=>typeof v==='function'?undefined:v);
const flatten=tree=>!tree||typeof tree!=='object'?[]:Array.isArray(tree)?tree.flatMap(flatten):[tree,...flatten(tree.props?.children)];

// Exercise the component's state and effect lifecycle, including cleanup and deferred fetches.
function harness(initialSession=session){
 const slots=[],pending=[],requests=[],routes=[],timers=new Map();
 let cursor=0,dirty=false,currentSession=initialSession,tree,clock=0,timerId=0;
 const addTimer=(callback,ms,repeat=false)=>{const id=++timerId;timers.set(id,{callback,at:clock+ms,ms,repeat});return id;};
 const document={hidden:false},onRouteOrder=modules=>routes.push(Array.from(modules));
 const exports={},statusExports={};
 vm.runInNewContext(statusOutput,{exports:statusExports,Error});
 const react={
  useState:init=>{const id=cursor++;if(!slots[id])slots[id]={value:typeof init==='function'?init():init};return [slots[id].value,next=>{const value=typeof next==='function'?next(slots[id].value):next;if(!Object.is(value,slots[id].value)){slots[id].value=value;dirty=true;}}];},
  useRef:init=>{const id=cursor++;return slots[id]??(slots[id]={current:init});},
  useEffect:(run,deps)=>{const id=cursor++,previous=slots[id];if(!previous||deps.some((value,index)=>!Object.is(value,previous.deps[index])))pending.push({id,run,deps});}
 };
 const context=vm.createContext({exports,URL,URLSearchParams,AbortController,AbortSignal,Error,document,
  window:{location:{href:'https://example.com/hub/'},setTimeout:(fn,ms)=>addTimer(fn,ms),clearTimeout:id=>timers.delete(id),setInterval:(fn,ms)=>addTimer(fn,ms,true),clearInterval:id=>timers.delete(id)},
  fetch:(url,options)=>new Promise((resolve,reject)=>requests.push({url,options,resolve,reject})),
  require:name=>name==='react'?react:name==='react/jsx-runtime'?{jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})}:name.endsWith('.css')?{}:name==='./home-status'?statusExports:(()=>{throw Error(name);})()
 });
 vm.runInContext(output,context);
 function render(commit=true){
  for(let attempts=0;attempts<20;attempts++){
   dirty=false;cursor=0;pending.length=0;tree=exports.FlowInboxSummary({session:currentSession,onRouteOrder});
   if(typeof tree?.type==='function')tree=tree.type(tree.props);
   if(!commit)return tree;
   for(const effect of pending){slots[effect.id]?.cleanup?.();slots[effect.id]={deps:effect.deps,cleanup:effect.run()};}
   if(!dirty)return tree;
  }
  throw Error('Component did not settle');
 }
 async function settle(){for(let i=0;i<6;i++)await Promise.resolve();return render();}
 render();
 return {requests,routes,document,get tree(){return tree;},get timers(){return timers;},
  setSession(next,commit=true){currentSession=next;return render(commit);},
  node(predicate){const found=flatten(tree).find(predicate);assert.ok(found,'Expected UI element');return found;},
  button(label){return this.node(node=>node.type==='button'&&node.props.children===label);},
  click(label){this.button(label).props.onClick();return render();},
  search(value){this.node(node=>node.type==='input').props.onChange({target:{value}});return render();},
  async respond(data,index=requests.length-1,status=200){requests[index].resolve({ok:status>=200&&status<300,status,json:async()=>data});return settle();},
  async reject(cause,index=requests.length-1){requests[index].reject(cause);return settle();},
  async advance(ms){const end=clock+ms;for(;;){const next=[...timers].filter(([,timer])=>timer.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;const [id,timer]=next;clock=timer.at;if(timer.repeat)timer.at+=timer.ms;else timers.delete(id);timer.callback();await settle();}clock=end;return tree;},
  unmount(){for(const slot of slots)slot?.cleanup?.();}
 };
}
const params=request=>new URL(request.url,'https://example.com/hub/').searchParams;

test('同账号降级首帧不渲染旧主管任务或编排',async()=>{
 const h=harness();await h.respond(overview());const tree=h.setSession(specialist,false);
 assert.match(text(tree),/我的任务/);assert.doesNotMatch(text(tree),/OTHER_COLLEAGUE_TASK|TEAM_BLUEPRINT|TEAM_ROUTE/);h.unmount();
});
test('换中心、最高权限变化或模块撤权时旧范围快照不可显示',async()=>{
 for(const next of [{...session,workspace:{...workspace,center:'B'}},{...session,permissions:{manage_permissions:true}},{...session,access:{...access,allowed_modules:[]}}]){
  const h=harness();await h.respond(overview());assert.doesNotMatch(text(h.setSession(next,false)),/OTHER_COLLEAGUE_TASK|TEAM_BLUEPRINT|TEAM_ROUTE/);h.unmount();
 }
});
test('保留上下游环节和受限跨任务联系人，不产生越权任务链接',async()=>{
 const h=harness(specialist);await h.respond(personal({tasks:[task('MY_TASK',{nodes:[{id:'before',title:'上游环节',state:'completed',owner:{number:'A',name:'上游人员'}},{id:'own',title:'负责环节',state:'ready',owner:{number:'SELF',name:'本人'},dependencies:['before']},{id:'after',title:'下游环节',state:'pending',owner:{number:'B',name:'下游人员'},dependencies:['own']}],relations:{upstream:[{title:'上游交接',owner:{number:'A',name:'真实上游联系人'},canOpen:false}],downstream:[{title:'下游接收',owner:{number:'B',name:'真实下游联系人'},taskId:'secret',canOpen:false}]}})]}));
 const value=text(h.tree);for(const name of ['上游环节','负责环节','下游环节','真实上游联系人','真实下游联系人'])assert.match(value,new RegExp(name));assert.doesNotMatch(value,/task=secret|task=undefined|TEAM_BLUEPRINT/);h.unmount();
});
test('主管首页读取轻量接口，待办数使用全范围节点数',async()=>{
 const h=harness();assert.match(h.requests[0].url,/^api\/flows\/home-overview\?/);assert.equal(params(h.requests[0]).get('filter'),'todo');
 await h.respond(overview());assert.match(text(h.tree),/TEAM_BLUEPRINT/);assert.match(text(h.tree),/TEAM_ROUTE/);
 const counts=h.node(node=>node.props?.className==='flow-inbox-counts');assert.equal(counts.props.children[0].props.children[0].props.children,19);assert.deepEqual(h.routes.at(-1),['material-workbench']);
 assert.ok(flatten(h.tree).some(node=>node.type==='a'&&node.props.href.endsWith('?view=tasks')));h.unmount();
});
test('关闭流程引擎和开发预览均不读取或显示任务区域',()=>{
 for(const next of [{...session,access:{...access,allowed_modules:['material-workbench']}},{...session,access:{...access,policy_state:'development-preview-personal'}}]){
  const h=harness(next);assert.equal(h.tree,null);assert.equal(h.requests.length,0);h.unmount();
 }
});
test('部门外最高权限仍显示相同流程管理入口',async()=>{
 const h=harness({...session,permissions:{manage_permissions:true},workspace:{...workspace,role:'director',is_brand_department:false,dashboard_scope:'department'}});await h.respond(overview());assert.match(text(h.tree),/TEAM_BLUEPRINT/);h.unmount();
});
test('专员按服务端总页数翻页，第二页六条不会再次客户端切片',async()=>{
 const h=harness(specialist);assert.equal(params(h.requests[0]).get('filter'),'active');
 await h.respond(personal({tasks:Array.from({length:6},(_,i)=>task('PAGE_ONE_'+i))}));h.click('下一页');assert.equal(params(h.requests[1]).get('page'),'2');assert.equal(h.requests[0].options.signal.aborted,true);assert.doesNotMatch(text(h.tree),/PAGE_ONE/);
 await h.respond(personal({tasks:Array.from({length:6},(_,i)=>task('PAGE_TWO_'+i)),pagination:{filter:'active',query:'',page:2,pageSize:6,total:20,pageCount:4}}));
 assert.equal(flatten(h.tree).filter(node=>node.type==='article').length,6);assert.match(text(h.tree),/PAGE_TWO_5/);assert.equal(h.button('下一页').props.disabled,false);h.unmount();
});
test('搜索输入防抖并回到第一页，筛选和查询均传给服务端',async()=>{
 const h=harness(specialist);await h.respond(personal());h.click('下一页');await h.respond(personal({pagination:{filter:'active',query:'',page:2,pageSize:6,total:20,pageCount:4}}));
 h.search('水');await h.advance(200);h.search('水润');await h.advance(299);assert.equal(h.requests.length,2);await h.advance(1);
 assert.equal(h.requests.length,3);assert.equal(params(h.requests[2]).get('q'),'水润');assert.equal(params(h.requests[2]).get('page'),'1');
 await h.respond(personal({tasks:[task('水润任务')],pagination:{filter:'active',query:'水润',page:1,pageSize:6,total:1,pageCount:1},hasMore:false}));assert.match(text(h.tree),/水润任务/);
 h.click('已结束');assert.equal(params(h.requests[3]).get('filter'),'ended');assert.equal(params(h.requests[3]).get('q'),'水润');assert.doesNotMatch(text(h.tree),/水润任务/);
 await h.respond(personal({tasks:[task('水润已完成',{state:'completed'})],pagination:{filter:'ended',query:'水润',page:1,pageSize:6,total:1,pageCount:1},hasMore:false}));assert.match(text(h.tree),/水润已完成/);h.unmount();
});
test('新筛选取消旧请求，旧请求晚返回不能覆盖当前数据',async()=>{
 const h=harness(specialist);h.click('待我办理');assert.equal(h.requests[0].options.signal.aborted,true);assert.equal(params(h.requests[1]).get('filter'),'todo');
 await h.respond(personal({tasks:[task('CURRENT_RESULT')]}),1);await h.respond(personal({tasks:[task('STALE_RESULT')]}),0);
 assert.match(text(h.tree),/CURRENT_RESULT/);assert.doesNotMatch(text(h.tree),/STALE_RESULT/);h.unmount();assert.equal(h.requests[1].options.signal.aborted,true);assert.equal(h.timers.size,0);
});
test('30秒轮询不重叠，隐藏页面暂停，失败保留成功记录且允许手动恢复',async()=>{
 const h=harness(specialist);await h.advance(30000);assert.equal(h.requests.length,1);await h.respond(personal({tasks:[task('SAVED_TASK')]}));
 h.document.hidden=true;await h.advance(30000);assert.equal(h.requests.length,1);h.document.hidden=false;await h.advance(30000);assert.equal(h.requests.length,2);
 await h.reject(new Error('Failed to fetch'));assert.match(text(h.tree),/SAVED_TASK/);assert.match(text(h.tree),/已保留上次成功读取的记录/);
 h.click('刷新任务');await h.respond(personal({tasks:[task('RECOVERED_TASK')]}));assert.doesNotMatch(text(h.tree),/SAVED_TASK|已保留上次成功读取的记录/);assert.match(text(h.tree),/RECOVERED_TASK/);h.unmount();
});
test('401和403清理成功快照及主管编排',async()=>{
 for(const status of [401,403]){const h=harness();await h.respond(overview());h.click('刷新待办');await h.respond({},1,status);assert.doesNotMatch(text(h.tree),/OTHER_COLLEAGUE_TASK|TEAM_BLUEPRINT|TEAM_ROUTE/);assert.deepEqual(h.routes.at(-1),[]);h.unmount();}
});
test('服务端回退到有效页时分页按返回页码和hasMore展示',async()=>{
 const h=harness(specialist);await h.respond(personal());h.click('下一页');await h.respond(personal({pagination:{filter:'active',query:'',page:1,pageSize:6,total:7,pageCount:2},hasMore:false}));
 assert.equal(h.button('上一页').props.disabled,true);assert.equal(h.button('下一页').props.disabled,true);h.unmount();
});
