import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
const ts=createRequire(import.meta.url)('typescript');
const sources=new Map([
 ['./LiveDailyWork','../src/LiveDailyWork.tsx'],
 ['./LiveCalendarAuthorization','../src/LiveCalendarAuthorization.tsx'],
 ['./home-status','../src/home-status.ts'],
].map(([name,path])=>[name,ts.transpileModule(readFileSync(new URL(path,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText]));
function runtime(react={},globals={}){
 const modules=new Map();
 function load(name){
  if(name==='react')return react;
  if(name==='react/jsx-runtime')return {jsx:(type,props,key)=>({type,props,key}),jsxs:(type,props,key)=>({type,props,key})};
  if(name.endsWith('.css'))return {};
  if(modules.has(name))return modules.get(name);
  const output=sources.get(name);assert.ok(output,'Unsupported source dependency: '+name);
  const exports={};modules.set(name,exports);
  vm.runInNewContext(output,{exports,require:load,Error,URL,AbortSignal,...globals});
  return exports;
 }
 return load;
}
function wrapper(session){return runtime()('./LiveDailyWork').LiveDailyWork({session});}
const session={user:{number:'SELF'},workspace:{role:'specialist',center:'直播中心'},access:{allowed_modules:['workflow-engine','live-room-management'],policy_state:'live'}};
test('直播或流程模块撤权及预览身份不显示入口',()=>{for(const modules of [[],['workflow-engine'],['live-room-management']])assert.equal(wrapper({...session,access:{...session.access,allowed_modules:modules}}),null);assert.equal(wrapper({...session,access:{...session.access,policy_state:'development-preview-staff'}}),null);});
test('换用户、角色或中心后表单和快照必须重新挂载，不复用旧权限状态',()=>{const first=wrapper(session);for(const s of [{...session,user:{number:'OTHER'}},{...session,workspace:{...session.workspace,role:'manager'}},{...session,workspace:{...session.workspace,center:'OTHER'}}])assert.notEqual(wrapper(s).key,first.key);});
test('日历授权入口仅对真实权限管理员开放',()=>{assert.equal(wrapper(session).props.calendarAdmin,false);assert.equal(wrapper({...session,permissions:{manage_permissions:true}}).props.calendarAdmin,true);});

function calendarHarness(){
 const hooks=[],effects=[],requests=[];let index=0,dirty=false,tree;
 const react={
  useState:initial=>{const id=index++;if(!hooks[id])hooks[id]={value:typeof initial==='function'?initial():initial};return [hooks[id].value,next=>{const value=typeof next==='function'?next(hooks[id].value):next;if(!Object.is(value,hooks[id].value)){hooks[id].value=value;dirty=true;}}];},
  useEffect:(run,deps)=>{const id=index++,prior=hooks[id];if(!prior||deps.some((value,i)=>!Object.is(value,prior.deps[i])))effects.push({id,run,deps});}
 };
 const Calendar=runtime(react,{fetch:(url,options)=>new Promise(resolve=>requests.push({url,options,resolve})),window:{location:{assign:()=>assert.fail('Read-only status checks must not launch authorization')}}})('./LiveCalendarAuthorization').LiveCalendarAuthorization;
 function render(){
  for(let tries=0;tries<20;tries++){
   dirty=false;index=0;effects.length=0;tree=Calendar();
   for(const effect of effects){hooks[effect.id]?.cleanup?.();hooks[effect.id]={deps:effect.deps,cleanup:effect.run()};}
   if(!dirty)return tree;
  }
  throw Error('Calendar did not settle');
 }
 render();
 return {requests,get tree(){return tree;},toggle(open){tree.props.onToggle({currentTarget:{open}});return render();},
  async respond(body,status=200){requests.at(-1).resolve({ok:status>=200&&status<300,json:async()=>body});for(let i=0;i<6;i++)await Promise.resolve();return render();},
  check(){const button=tree.props.children.find(node=>node?.type==='button'&&node.props.children==='检查授权结果');assert.ok(button);button.props.onClick();return render();}
 };
}
test('正式日历授权首屏不请求，首次展开才读取且再次展开不重复请求',async()=>{
 const h=calendarHarness();assert.equal(h.requests.length,0);
 h.toggle(false);assert.equal(h.requests.length,0);
 h.toggle(true);assert.equal(h.requests.length,1);assert.equal(h.requests[0].url,'modules/live-room-management/api/lifecycle/calendar-auth/status');assert.equal(h.requests[0].options.cache,'no-store');
 await h.respond({calendar:{configured:true,authorized:true}});assert.match(JSON.stringify(h.tree),/用户授权已保存/);
 h.toggle(false);h.toggle(true);assert.equal(h.requests.length,1);
 h.check();assert.equal(h.requests.length,2);await h.respond({calendar:{configured:true,authorized:false,reason:'授权待恢复'}});assert.match(JSON.stringify(h.tree),/授权待恢复/);
});
test('日历状态读取失败后可通过检查按钮重试',async()=>{
 const h=calendarHarness();h.toggle(true);await h.respond({error:'日历来源暂不可用'},503);assert.match(JSON.stringify(h.tree),/日历来源暂不可用/);
 h.check();assert.equal(h.requests.length,2);await h.respond({calendar:{configured:true,authorized:true}});assert.doesNotMatch(JSON.stringify(h.tree),/日历来源暂不可用/);assert.match(JSON.stringify(h.tree),/用户授权已保存/);
});
