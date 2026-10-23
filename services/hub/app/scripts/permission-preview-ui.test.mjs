import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';

const ts=createRequire(import.meta.url)('typescript');
const source=ts.createSourceFile('App.tsx',readFileSync(new URL('../src/App.tsx',import.meta.url),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const declaration=source.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='PermissionPreviewSwitcher');
assert.ok(declaration);
const compiled=ts.transpileModule(declaration.getText(source)+'\nexports.Switcher=PermissionPreviewSwitcher;',{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
const gate=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const tick=()=>new Promise(setImmediate);
const colleague={userNumber:'STAFF',realName:'测试同事',department:'品牌营销部',center:'视频中心',loginActive:true};
const realPreview={active:false,scope:'real',center:'',person:'',updatedAt:null};

function find(node,predicate){
  if(!node||typeof node!=='object')return null;
  if(predicate(node))return node;
  const children=Array.isArray(node)?node:node.props?.children;
  for(const child of Array.isArray(children)?children:[children]){const found=find(child,predicate);if(found)return found;}
  return null;
}
function harness(load,preview=realPreview){
  const slots=[],effects=[],calls=[],applied=[];let cursor=0,tree,unmounted=false,lateWrites=0;
  const exports={},context=vm.createContext({exports,Error,Array,
    api:{permissionPreviewCandidates:()=>{calls.push('candidates');return load();}},
    Button:'Button',ShieldLockRegular:'ShieldLockRegular',
    require:()=>({jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})}),
    useState(initial){const i=cursor++;if(!(i in slots))slots[i]={value:typeof initial==='function'?initial():initial};return [slots[i].value,value=>{if(unmounted)lateWrites++;slots[i].value=typeof value==='function'?value(slots[i].value):value;}];},
    useRef(initial){const i=cursor++;return slots[i]??={current:initial};},
    useEffect(fn,deps){const i=cursor++,old=slots[i];if(!old||deps.some((v,n)=>v!==old.deps[n]))effects.push(()=>{old?.cleanup?.();slots[i]={deps,cleanup:fn()};});},
  });
  vm.runInContext(compiled,context);
  const render=()=>{cursor=0;tree=exports.Switcher({preview,busy:false,onApply:(...args)=>applied.push(args)});effects.splice(0).forEach(run=>run());return tree;};
  const get=predicate=>find(render(),predicate);
  const input=()=>get(node=>node.type==='input'&&node.props['aria-label']==='预览成员姓名或工号');
  render();
  return {calls,applied,input,render,
    scope(value){get(node=>node.type==='select'&&node.props['aria-label']==='选择权限预览视角').props.onChange({target:{value}});render();},
    focus(){input().props.onFocus();},
    type(value){input().props.onChange({target:{value}});render();},
    retry(){get(node=>node.type==='Button'&&node.props.children==='成员读取失败，重试')?.props.onClick();},
    error(){return Boolean(get(node=>node.type==='Button'&&node.props.children==='成员读取失败，重试'));},
    apply(){get(node=>node.type==='Button'&&node.props.children==='应用视角').props.onClick();},
    options(){const list=get(node=>node.type==='datalist');return Array.from(list.props.children,item=>item.props.value);},
    unmount(){unmounted=true;for(const slot of slots)slot?.cleanup?.();},
    get lateWrites(){return lateWrites;},
  };
}

test('administrator home and role-only preview do not request the member list',()=>{
  const h=harness(()=>{throw Error('unexpected request');});assert.deepEqual(h.calls,[]);assert.equal(h.input(),null);
  for(const scope of ['department','center','personal','real']){h.scope(scope);assert.deepEqual(h.calls,[]);}
  const alreadyPreviewing=harness(()=>{throw Error('unexpected request');},{...realPreview,active:true,scope:'personal',person:'测试同事'});
  assert.equal(alreadyPreviewing.input().props.value,'测试同事');assert.deepEqual(alreadyPreviewing.calls,[]);
});

test('member focus loads once per in-flight request and keeps typing and applying available',async()=>{
  const pending=gate(),h=harness(()=>pending.promise);h.scope('personal');h.focus();h.focus();
  assert.equal(h.calls.length,1);assert.equal(h.input().props['aria-busy'],true);assert.notEqual(h.input().props.disabled,true);
  h.type('FD-STAFF');h.apply();assert.deepEqual(h.applied,[['personal','营销中心A','FD-STAFF']]);
  pending.resolve({items:[colleague]});await tick();assert.deepEqual(h.options(),['测试同事']);assert.equal(h.input().props['aria-busy'],false);assert.equal(h.input().props.value,'FD-STAFF');
});

test('a failed list can be retried without retrying or changing a permission write',async()=>{
  const first=gate(),second=gate();let index=0;const h=harness(()=>[first.promise,second.promise][index++]);h.scope('center');h.focus();first.reject(new Error('unavailable'));await tick();
  assert.equal(h.error(),true);assert.equal(h.input().props['aria-busy'],false);h.type('手输同事');h.apply();assert.equal(h.applied.length,1);
  h.retry();h.focus();assert.equal(h.calls.length,2);assert.equal(h.error(),false);second.resolve({items:[colleague]});await tick();
  assert.deepEqual(h.options(),['测试同事']);assert.equal(h.error(),false);assert.equal(h.applied.length,1);
});

for(const outcome of ['success','failure'])test(`unmounted toolbar ignores a late ${outcome} and does not touch a later toolbar`,async()=>{
  const pending=gate(),old=harness(()=>pending.promise);old.scope('personal');old.focus();old.unmount();
  const current=harness(()=>Promise.resolve({items:[colleague]}));current.scope('personal');current.focus();await tick();
  if(outcome==='success')pending.resolve({items:[{...colleague,realName:'旧结果'}]});else pending.reject(new Error('old failure'));
  await tick();assert.equal(old.lateWrites,0);assert.deepEqual(current.options(),['测试同事']);assert.equal(current.error(),false);
});

test('later focus consults the existing API again so invalidated permissions can refresh suggestions',async()=>{
  let items=[colleague];const h=harness(()=>Promise.resolve({items}));h.scope('personal');h.focus();await tick();
  assert.deepEqual(h.options(),['测试同事']);items=[];h.focus();await tick();assert.equal(h.calls.length,2);assert.deepEqual(h.options(),[]);
});

test('malformed successful response remains retryable instead of breaking the toolbar',async()=>{
  const h=harness(()=>Promise.resolve({}));h.scope('personal');h.focus();await tick();assert.equal(h.error(),true);assert.deepEqual(h.options(),[]);assert.equal(h.input().props['aria-busy'],false);
});
