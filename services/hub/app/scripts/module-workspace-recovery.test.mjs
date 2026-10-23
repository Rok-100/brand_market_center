import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';

const ts=createRequire(import.meta.url)('typescript');
const source=ts.createSourceFile('ModuleWorkspaceCache.tsx',readFileSync(new URL('../src/ModuleWorkspaceCache.tsx',import.meta.url),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const declarations=['isEmptyInitialDocument','ModulePage'].map(name=>source.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text===name));
assert.ok(declarations.every(Boolean));
const compiled=ts.transpileModule(declarations.map(node=>node.getText(source)).join('\n')+'\nexports.Page=ModulePage;',{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
const origin='https://hub.example.test',moduleUrl='/yxb/wis-marketing-hub/modules/cloud-manager/';
const module={id:'cloud-manager',purpose:'WIS云管家',url:moduleUrl};
function find(node,predicate){
  if(!node||typeof node!=='object')return null;
  if(predicate(node))return node;
  const children=Array.isArray(node)?node:node.props?.children;
  for(const child of Array.isArray(children)?children:[children]){const found=find(child,predicate);if(found)return found;}
  return null;
}
function initialFrame(){
  const messages=[];
  return {isConnected:true,contentDocument:{readyState:'complete',body:{textContent:'',childElementCount:0}},
    contentWindow:{location:new URL('about:blank'),postMessage:(message,target)=>messages.push({message,target})},messages};
}
// Execute the real component with DOM references and deterministic React commit /
// timer scheduling. No navigation, production data, upload or notification occurs.
function harness(props={}){
  const slots=[],effects=[],timers=new Map(),registered=new Map(),protection=[],attached=[];
  let cursor=0,clock=0,timerId=0,tree,node=null,iframeElement=null,unmounted=false,lateWrites=0;
  const inputs={module,active:true,request:'#module=cloud-manager',register:(id,frame)=>{if(frame)registered.set(id,frame);else registered.delete(id);},onProtection:(...args)=>protection.push(args),...props};
  const exports={},effect=(fn,deps)=>{const i=cursor++,old=slots[i];if(!old||deps.some((v,n)=>v!==old.deps[n]))effects.push(()=>{old?.cleanup?.();slots[i]={deps,cleanup:fn()};});};
  const context=vm.createContext({exports,URL,Date,Math,location:{origin},release:'fixture',
    Button:'Button',ArrowClockwiseRegular:'ArrowClockwiseRegular',embeddedCloudAsset:()=>null,
    attachExperience:frame=>attached.push(frame),performance:{now:()=>clock},
    window:{location:{origin,href:origin+'/yxb/wis-marketing-hub/'},setTimeout(fn,ms){const id=++timerId;timers.set(id,{at:clock+ms,fn});return id;},clearTimeout:id=>timers.delete(id)},
    require:()=>({jsx:(type,props,key)=>({type,props,key}),jsxs:(type,props,key)=>({type,props,key})}),
    useState(initial){const i=cursor++;if(!(i in slots))slots[i]={value:typeof initial==='function'?initial():initial};return [slots[i].value,value=>{if(unmounted)lateWrites++;slots[i].value=typeof value==='function'?value(slots[i].value):value;}];},
    useRef(initial){const i=cursor++;return slots[i]??={current:initial};},
    useMemo(fn,deps){const i=cursor++,old=slots[i];if(!old||deps.some((v,n)=>v!==old.deps[n]))slots[i]={deps,value:fn()};return slots[i].value;},
    useEffect:effect,useLayoutEffect:effect,
  });
  vm.runInContext(compiled,context);
  const render=()=>{
    cursor=0;tree=exports.Page(inputs);const next=find(tree,x=>x.type==='iframe');
    if(!node||next.key!==iframeElement.key){if(node)node.isConnected=false;node=initialFrame();}
    iframeElement=next;iframeElement.props.ref.current=node;effects.splice(0).forEach(run=>run());return tree;
  };
  render();
  return {registered,protection,attached,timers,
    get node(){return node;},get iframe(){render();return iframeElement;},get lateWrites(){return lateWrites;},
    get status(){return find(render(),x=>x.props?.role==='status');},get alert(){return find(render(),x=>x.props?.role==='alert');},
    get link(){return find(render(),x=>x.type==='a');},
    get retryButton(){return find(render(),x=>x.type==='Button'&&x.props.children==='重新打开');},
    advance(ms){const target=clock+ms;for(;;){const due=[...timers].filter(([,v])=>v.at<=target).sort((a,b)=>a[1].at-b[1].at||a[0]-b[0])[0];if(!due)break;clock=due[1].at;timers.delete(due[0]);due[1].fn();render();}clock=target;render();},
    load(frame=node){iframeElement.props.onLoad({currentTarget:frame});render();},
    fail(frame=node){iframeElement.props.onError({currentTarget:frame});render();},
    retry(){find(render(),x=>x.type==='Button'&&x.props.children==='重新打开')?.props.onClick();render();},
    setDocument(url,text='',readyState='loading',children=0){node.contentWindow.location=new URL(url,origin);node.contentDocument={readyState,body:{textContent:text,childElementCount:children}};},
    active(value){inputs.active=value;return render();},
    unmount(){unmounted=true;node.isConnected=false;iframeElement.props.ref.current=null;for(const slot of slots)slot?.cleanup?.();},
  };
}

test('initial about:blank load is not ready; exactly one automatic recovery occurs at 12 seconds',()=>{
  const h=harness(),first=h.node,initial=h.iframe;h.load();assert.ok(h.status);assert.equal(h.attached.length,0);
  h.advance(11999);assert.equal(h.node,first);assert.equal(h.iframe.props.src,initial.props.src);
  h.advance(1);assert.notEqual(h.node,first);assert.equal(first.isConnected,false);assert.notEqual(h.iframe.key,initial.key);
  const recovered=new URL(h.iframe.props.src,origin);assert.ok(recovered.searchParams.get('hub_recovery_nonce'));assert.equal(recovered.pathname,moduleUrl);
  const second=h.node;h.advance(120000);assert.equal(h.node,second);assert.ok(h.status);assert.ok(h.link);assert.ok(h.retryButton);
});

test('manual blank retry remounts with a fresh nonce without resetting the automatic recovery budget',()=>{
  const h=harness();h.advance(24000);const old=h.node,previous=new URL(h.iframe.props.src,origin).searchParams.get('hub_recovery_nonce');
  h.retry();assert.notEqual(h.node,old);assert.notEqual(new URL(h.iframe.props.src,origin).searchParams.get('hub_recovery_nonce'),previous);
  const current=h.node;h.advance(90000);assert.equal(h.node,current,'manual attempts cannot restart automatic retries');
});

test('failed blank navigation permits a manual context recovery and retains one lifetime automatic attempt',()=>{
  const h=harness();h.fail();assert.ok(h.alert);assert.ok(h.link);assert.ok(h.retryButton);const first=h.node;h.retry();assert.notEqual(h.node,first);
  const manual=h.node;h.advance(12000);assert.notEqual(h.node,manual);const automatic=h.node;h.advance(90000);assert.equal(h.node,automatic);
});

for(const kind of ['application','login','blank-with-text','blank-with-element','cross-origin','missing-document'])test(`neither automatic nor manual recovery replaces ${kind}`,()=>{
  const h=harness(),original=h.node;
  if(kind==='application')h.setDocument(moduleUrl,'已有上传与草稿','loading',1);
  if(kind==='login')h.setDocument('/access-denied.html','OA 登录表单','loading',1);
  if(kind==='blank-with-text')h.setDocument('about:blank','draft text','complete');
  if(kind==='blank-with-element')h.setDocument('about:blank','','complete',1);
  if(kind==='cross-origin')Object.defineProperty(h.node.contentWindow,'location',{get(){throw Error('SecurityError');}});
  if(kind==='missing-document')h.node.contentDocument=null;
  h.advance(24000);assert.equal(h.retryButton,null);assert.ok(h.link);h.retry();assert.equal(h.node,original);assert.equal(new URL(h.iframe.props.src,origin).searchParams.has('hub_recovery_nonce'),false);
  h.fail();assert.equal(h.retryButton,null);assert.ok(h.link);h.retry();assert.equal(h.node,original,'failure UI must not reload an existing or unreadable document');
});

test('usable application becomes ready and keeps its context across time and visibility changes',()=>{
  const h=harness(),original=h.node;h.setDocument(moduleUrl,'这是已经开始运行并且包含真实上传任务和草稿的云管家工作区','interactive',1);h.advance(200);
  assert.equal(h.status,null);h.advance(60000);assert.equal(h.node,original);
  const hidden=h.active(false);assert.equal(hidden.props.hidden,true);assert.equal(h.node.messages.at(-1).message.active,false);
  h.active(true);assert.equal(h.node,original);assert.equal(h.node.messages.at(-1).message.active,true);
});

test('remount registration and visibility follow the new frame; stale frame events are ignored',()=>{
  const h=harness({active:false}),old=h.node,oldElement=h.iframe;h.advance(12000);
  assert.equal(h.registered.get('cloud-manager'),h.node);assert.notEqual(h.node,old);assert.equal(h.node.messages.at(-1).message.active,false);
  old.contentWindow.location=new URL(moduleUrl,origin);oldElement.props.onLoad({currentTarget:old});oldElement.props.onError({currentTarget:old});
  assert.ok(h.status);assert.equal(h.alert,null);assert.equal(h.protection.length,0);
});

test('unmount clears timers and registration and ignores late frame events',()=>{
  const h=harness(),old=h.node,oldElement=h.iframe;h.unmount();assert.equal(h.timers.size,0);assert.equal(h.registered.size,0);
  oldElement.props.onLoad({currentTarget:old});oldElement.props.onError({currentTarget:old});assert.equal(h.lateWrites,0);
});

test('slow and failed fallback is an ordinary noopener link to the original same-origin module URL',()=>{
  const h=harness();h.advance(24000);assert.equal(h.link.props.href,origin+moduleUrl);assert.equal(h.link.props.target,'_blank');assert.equal(h.link.props.rel,'noopener');assert.equal(h.link.props.onClick,undefined);
  h.fail();assert.equal(h.link.props.href,origin+moduleUrl);
  const external=harness({module:{...module,url:'https://external.example.test/private'}});external.fail();assert.equal(external.link,null);
});
