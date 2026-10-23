import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createMonthlyTargetStore} from './monthly-target-store.mjs';

async function fixture(t){const directory=await mkdtemp(join(tmpdir(),'wis-monthly-'));t.after(()=>rm(directory,{recursive:true,force:true}));return{directory,store:createMonthlyTargetStore({directory})};}
const input={month:'2026-09',code:'guanqi',amount:1234567.89,version:0};
test('manual targets persist across process/store recreation and separate months and rooms',async t=>{
  const{directory,store}=await fixture(t);
  assert.deepEqual((await store.get('2026-09')).items,{});
  await store.save(input,'Test actor');
  const other=createMonthlyTargetStore({directory});
  assert.equal((await other.get('2026-09')).items.guanqi.amount,input.amount);
  assert.deepEqual((await other.get('2026-10')).items,{});
  await store.save({...input,code:'preferred',amount:500},'Test actor');
  assert.equal((await store.get('2026-09')).items.guanqi.amount,input.amount);
  const record=JSON.parse(await readFile(join(directory,'monthly-targets-2026-09.json'),'utf8'));
  assert.equal(record.history.length,2);assert.equal(record.history[0].next.updatedBy,'Test actor');
});
test('stale concurrent edits cannot overwrite the winner',async t=>{
  const{store}=await fixture(t);
  const results=await Promise.allSettled([store.save(input,'A'),store.save({...input,amount:1},'B')]);
  assert.deepEqual(results.map(r=>r.status),['fulfilled','rejected']);assert.equal(results[1].reason.status,409);
  await store.save({...input,amount:10,version:1},'B');
  assert.equal((await store.get('2026-09')).items.guanqi.version,2);
});
test('invalid month, room, amount and version are rejected without writes',async t=>{
  const{store}=await fixture(t);
  for(const delta of [{month:'../../escape'},{month:'2026-13'},{code:'unknown'},{amount:0},{amount:-1},{amount:NaN},{amount:Infinity},{amount:'50'},{amount:1.234},{version:-1},{version:null}])await assert.rejects(store.save({...input,...delta},'Test'),{status:422});
  assert.deepEqual((await store.get('2026-09')).items,{});
});
test('corrupt existing data and failed writes do not become a blank successful target',async t=>{
  const{store,directory}=await fixture(t);
  await writeFile(join(directory,'monthly-targets-2026-09.json'),'invalid');
  await assert.rejects(store.get('2026-09'));await assert.rejects(store.save(input,'Test'));
  const failing=createMonthlyTargetStore({directory,write:async()=>{throw new Error('disk failed')}});
  await assert.rejects(failing.save({...input,month:'2026-10'},'Test'),/disk failed/);
});
