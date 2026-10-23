import assert from 'node:assert/strict';
import {versionedDocumentStore} from './document_store_mysql.mjs';

let state={exists:true,version:1,data:{tasks:[{id:'task',text:'中文',runtime:{sourceKey:'source:cloud:one'}}]}};
const methods=[];
const rpc={call(method,args){
  methods.push(method);
  if(method==='readFile')return {...state,data:JSON.stringify(state.data)};
  if(method==='readTextIfChanged')return state.version===args[1]?{unchanged:true,version:state.version}:{...state,data:JSON.stringify(state.data)};
  if(method==='writeFile'){
    assert.equal(args[1],state.version,'stale write rejected');
    state={exists:true,version:state.version+1,data:JSON.parse(args[2])};return {version:state.version};
  }
},close(){}};
const store=versionedDocumentStore(rpc,'/task-center.json');
store.snapshot().data.tasks[0].text='mutation';
assert.equal(store.snapshot().data.tasks[0].text,'中文');
assert.deepEqual(methods,['readFile','readTextIfChanged']);
const calls=methods.length;
for(let i=0;i<60000;i++)assert.equal(store.sourceTask('source:cloud:missing'),null);
assert.equal(methods.length,calls,'baseline discovery must not issue 60,000 document requests');
store.sourceTask('source:cloud:one').text='mutated';
assert.equal(store.sourceTask('source:cloud:one').text,'中文');
state={...state,version:2,data:{tasks:[{id:'other'}]}};
assert.equal(store.snapshot().data.tasks[0].id,'other');
assert.throws(()=>store.commit(1,{tasks:[]}));
assert.equal(store.snapshot().version,2);
store.commit(2,{tasks:[{id:'saved',runtime:{sourceKey:'source:cloud:saved'}}]});
assert.equal(store.snapshot().data.tasks[0].id,'saved');
assert.equal(store.sourceTask('source:cloud:saved').id,'saved');
assert.equal(store.sourceTask('source:cloud:one'),null);
state={exists:true,version:4,data:{tasks:[{id:'external',runtime:{sourceKey:'source:cloud:external'}}]}};
await new Promise(resolve=>setTimeout(resolve,550));
assert.equal(store.sourceTask('source:cloud:external').id,'external');
console.log('Version cache: refresh, mutation isolation, CAS conflict and committed state passed');
