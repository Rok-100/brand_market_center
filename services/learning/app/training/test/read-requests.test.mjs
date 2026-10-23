import test from 'node:test';
import assert from 'node:assert/strict';
import {createReadRequests} from '../public/read-requests.js';

test('concurrent reads share one request; a failed read is retried',async()=>{
  let calls=0,finish;
  const reads=createReadRequests({getSession:()=>1,request:()=>{calls++;return new Promise(resolve=>{finish=resolve;});}});
  const first=reads.read('courses'),second=reads.read('courses');
  await Promise.resolve();assert.equal(calls,1);finish({courses:[]});
  assert.deepEqual(await first,await second);
  let attempts=0;
  const failing=createReadRequests({getSession:()=>1,request:async()=>{if(++attempts===1)throw Error('offline');return 'ok';}});
  await assert.rejects(failing.read('courses'),/offline/);
  assert.equal(await failing.read('courses'),'ok');assert.equal(attempts,2);
});

test('only catalog and announcement page data can be reused for 30 seconds',async()=>{
  let now=0,calls=0;
  const reads=createReadRequests({getSession:()=>1,clock:()=>now,request:async()=>++calls});
  assert.equal(await reads.read('courses'),1);now=29999;
  assert.equal(await reads.read('courses'),1);now=30000;
  assert.equal(await reads.read('courses'),2);
  for(const path of ['me','my-progress','admin/courses','admin/learners','courses/private-course']){
    const first=await reads.read(path);assert.equal(await reads.read(path),first+1,path);
  }
});

test('account changes cannot reuse the previous account data',async()=>{
  let session=1,calls=0;
  const reads=createReadRequests({getSession:()=>session,request:async()=>({owner:session,call:++calls})});
  assert.equal((await reads.read('courses')).owner,1);
  session=2;assert.equal((await reads.read('courses')).owner,2);assert.equal(calls,2);
});

test('invalidation prevents older requests from repopulating reusable data',async()=>{
  let finish,calls=0;
  const reads=createReadRequests({getSession:()=>1,request:()=>{calls++;if(calls===1)return new Promise(resolve=>{finish=resolve;});return {version:2};}});
  const old=reads.read('courses');await Promise.resolve();reads.clear();
  assert.deepEqual(await reads.read('courses'),{version:2});
  finish({version:1});await old;
  assert.deepEqual(await reads.read('courses'),{version:2});assert.equal(calls,2);
});

test('targeted invalidation keeps unrelated data and ignores old in-flight results',async()=>{
  const counts={};let release;
  const reads=createReadRequests({getSession:()=>1,request:async path=>{counts[path]=(counts[path]||0)+1;if(path==='courses'&&counts[path]===1)return new Promise(resolve=>{release=resolve;});return {path,version:counts[path]};}});
  await reads.read('announcements');const old=reads.read('courses');await Promise.resolve();reads.invalidate(['courses']);
  assert.equal((await reads.read('courses')).version,2);release({version:1});await old;
  assert.equal((await reads.read('courses')).version,2);await reads.read('announcements');assert.equal(counts.announcements,1);
  reads.invalidate(['announcements']);reads.prime('announcements',{version:9});
  assert.equal((await reads.read('announcements')).version,9);assert.equal(counts.announcements,1);
  reads.prime('admin/learners',{version:99});assert.equal((await reads.read('admin/learners')).version,1);
});
