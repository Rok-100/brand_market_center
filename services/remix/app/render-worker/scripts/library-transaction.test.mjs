import test from 'node:test';
import assert from 'node:assert/strict';
import {commitLibraryChange,mergeLibraryChange,libraryConflict,libraryRebaseAllowed} from '../library-transaction.mjs';

test('concurrent reviews preserve disjoint clip changes and inserted rows',async()=>{
  const base={clips:[{id:'a',approved:false},{id:'b',approved:false}]};
  const wanted=structuredClone(base);wanted.clips[0].approved=true;
  const current=structuredClone(base);current.clips[1].approved=true;current.clips.push({id:'c',approved:false});
  let commits=0,saved;
  const result=await commitLibraryChange({base,wanted,snapshot:{version:1},delay:async()=>{},
    read:async()=>({library:current,snapshot:{version:2}}),commit:async(token,library)=>{
      commits++;if(token.version===1)throw libraryConflict();assert.equal(token.version,2);saved=library;
    }});
  assert.equal(commits,2);assert.deepEqual(result.clips,[{id:'a',approved:true},{id:'b',approved:true},{id:'c',approved:false}]);
  assert.deepEqual(saved,result);assert.equal(base.clips[0].approved,false);
});

test('same-field conflict refuses stale overwrite',async()=>{
  const base={clips:[{id:'a',review:'pending'}]},wanted={clips:[{id:'a',review:'approved'}]},current={clips:[{id:'a',review:'rejected'}]};
  let calls=0;
  await assert.rejects(commitLibraryChange({base,wanted,snapshot:{version:1},delay:async()=>{},
    read:async()=>({library:current,snapshot:{version:2}}),commit:async()=>{calls++;throw libraryConflict();}}),{code:'METADATA_CONFLICT'});
  assert.equal(calls,1);assert.equal(current.clips[0].review,'rejected');
});

test('retry count is bounded and does not recompute an effectful patch',async()=>{
  const base={value:0},wanted={value:1};let effects=0,commits=0;
  effects++; // e.g. an already finished media inspection, computed once
  await assert.rejects(commitLibraryChange({base,wanted,snapshot:{version:1},delay:async()=>{},
    read:async()=>({library:base,snapshot:{version:2}}),commit:async()=>{commits++;throw libraryConflict();}}),{code:'METADATA_CONFLICT'});
  assert.equal(commits,3);assert.equal(effects,1);
});

for(const change of ['pause','revoke','source','owner','archive'])test(`concurrent ${change} prevents stale approval publication`,async()=>{
  const base={sources:[{id:'source',hash:'old'}],autoRemixGrants:[{userId:'owner'}],autoJobs:[{id:'job',status:'active',createdById:'owner'}],clips:[{id:'clip',approved:false}]};
  const wanted=structuredClone(base);wanted.clips[0].approved=true;
  const current=structuredClone(base);
  if(change==='pause')current.autoJobs[0].status='paused';
  if(change==='revoke')current.autoRemixGrants=[];
  if(change==='source')current.sources[0].hash='new';
  if(change==='owner')current.autoJobs[0].createdById='other';
  if(change==='archive')current.autoJobs[0].archivedAt='now';
  let calls=0;
  await assert.rejects(commitLibraryChange({base,wanted,snapshot:{version:1},canRebase:libraryRebaseAllowed,delay:async()=>{},
    read:async()=>({library:current,snapshot:{version:2}}),commit:async()=>{calls++;throw libraryConflict();}}),{code:'METADATA_CONFLICT'});
  assert.equal(calls,1);assert.equal(current.clips[0].approved,false);
});

test('already committed identical patch is safe; deletes and unknown array edits remain checked',()=>{
  assert.deepEqual(mergeLibraryChange({a:0},{a:1},{a:1}),{a:1});
  assert.deepEqual(mergeLibraryChange({a:0,b:0},{b:0},{a:0,b:1}),{b:1});
  assert.throws(()=>mergeLibraryChange({items:['a']},{items:['b']},{items:['c']}),{code:'METADATA_CONFLICT'});
  assert.throws(()=>mergeLibraryChange({clips:[{id:'a',value:0}]},{clips:[]},{clips:[{id:'a',value:1}]}),{code:'METADATA_CONFLICT'});
});

test('unrelated IO failures are never retried',async()=>{
  let commits=0,reads=0;
  await assert.rejects(commitLibraryChange({base:{},wanted:{a:1},snapshot:{version:1},
    read:async()=>{reads++;},commit:async()=>{commits++;throw Error('Access denied');}}),/Access denied/);
  assert.equal(commits,1);assert.equal(reads,0);
});
