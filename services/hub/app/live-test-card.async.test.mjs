import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm,rmdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {setImmediate as nextTurn} from 'node:timers/promises';
import {LiveTestCard,LIVE_TEST_APP_ID,LIVE_TEST_RUN_ID,LIVE_TEST_RECIPIENT,liveTestCard} from './live-test-card.mjs';

const confirmedAt='2026-10-15T12:00:00.000Z';
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
const ledger=overrides=>({runId:LIVE_TEST_RUN_ID,entry:{...LIVE_TEST_RECIPIENT,nonce:'fixture-nonce',state:'sent',messageId:'om_fixture',...overrides}});
async function fixture(t,value){
  const dir=await mkdtemp(join(tmpdir(),'wis-live-test-card-')),path=join(dir,'ledger.json'),calls=[];
  t.after(async()=>{await rm(path,{force:true});await rmdir(dir);});
  if(value!==undefined)await writeFile(path,JSON.stringify(value));
  const card=new LiveTestCard({appId:LIVE_TEST_APP_ID,ledgerPath:path,notifier:{tenantToken:async()=>{calls.push('token');throw Error('unexpected token request');},fetch:async()=>{calls.push('fetch');throw Error('unexpected network request');}}});
  return {card,path,calls};
}

test('missing authoritative ledger resolves null and the idle flush sends nothing',async t=>{
  const h=await fixture(t);assert.equal(await h.card.readAsync(),null);assert.equal(h.card.read(),null);h.card.read=()=>{throw Error('idle flush must not read synchronously');};await h.card.flush();assert.equal(h.card.running,false);assert.deepEqual(h.calls,[]);
});

test('real asynchronous file read matches synchronous identity verification',async t=>{
  const value=ledger({confirmedAt}),h=await fixture(t,value);const pending=h.card.readAsync();assert.equal(typeof pending.then,'function');assert.deepEqual(await pending,h.card.read());
});

test('delayed async ledger read allows another event loop turn and retains flush single flight',async t=>{
  const h=await fixture(t,ledger()),gate=deferred(),nativeRead=h.card.readAsync.bind(h.card);let reads=0;
  h.card.readAsync=async()=>{reads++;await gate.promise;return nativeRead();};h.card.read=()=>{throw Error('idle flush must not read synchronously');};
  const pending=h.card.flush();await nextTurn();assert.equal(h.card.running,true);assert.equal(reads,1);await h.card.flush();assert.equal(reads,1);gate.resolve();await pending;assert.equal(h.card.running,false);assert.deepEqual(h.calls,[]);
});

test('all idle ledger states avoid API calls and preserve bytes without a synchronous read',async t=>{
  const h=await fixture(t);h.card.read=()=>{throw Error('idle flush must not read synchronously');};
  for(const entry of [{state:'prepared'},{},{confirmedAt,updateState:'done'},{confirmedAt,updateState:'attention'},{confirmedAt,updateState:'updating'},{confirmedAt,updateState:'ready',messageId:null}]){
    const bytes=JSON.stringify(ledger(entry));await writeFile(h.path,bytes);await h.card.flush();assert.equal(await readFile(h.path,'utf8'),bytes);assert.deepEqual(h.calls,[]);
  }
});

test('wrong run, recipient, name or department fail closed for both read paths and flush',async t=>{
  const h=await fixture(t);
  for(const key of ['runId','openId','name','department']){const value=ledger({confirmedAt,updateState:'ready'});if(key==='runId')value.runId='wrong';else value.entry[key]='wrong';await writeFile(h.path,JSON.stringify(value));
    await assert.rejects(h.card.readAsync(),e=>e.status===409);assert.throws(()=>h.card.read(),e=>e.status===409);await assert.rejects(h.card.flush(),e=>e.status===409);assert.equal(h.card.running,false);assert.deepEqual(h.calls,[]);
  }
});

test('malformed JSON remains an error and a corrected ledger can be read next tick',async t=>{
  const h=await fixture(t);await writeFile(h.path,'{invalid');await assert.rejects(h.card.flush(),SyntaxError);assert.equal(h.card.running,false);await writeFile(h.path,JSON.stringify(ledger()));await h.card.flush();assert.deepEqual(h.calls,[]);
});

test('non-ENOENT I/O failure is not treated as an empty ledger',async t=>{
  const h=await fixture(t);h.card.ledgerPath=join(h.path,'..');await assert.rejects(h.card.flush(),e=>e.code!=='ENOENT');assert.equal(h.card.running,false);assert.deepEqual(h.calls,[]);
});

test('a changed original message or receipt during async read cannot update an old card',async t=>{
  const h=await fixture(t,ledger({confirmedAt,updateState:'ready'})),nativeRead=h.card.readAsync.bind(h.card);
  for(const field of ['messageId','nonce','confirmedAt']){const original=ledger({confirmedAt,updateState:'ready'});await writeFile(h.path,JSON.stringify(original));h.card.readAsync=async()=>{const value=await nativeRead();const latest=structuredClone(value);latest.entry[field]+='-changed';await writeFile(h.path,JSON.stringify(latest));return value;};
    await assert.rejects(h.card.flush(),/状态已变化/);assert.equal((await nativeRead()).entry.updateState,'ready');assert.deepEqual(h.calls,[]);
  }
});

test('ready receipt still reads back the original message and only patches that card',async t=>{
  const value=ledger({confirmedAt,updateState:'ready'});value.entry.sentCard=liveTestCard({...value.entry,confirmedAt:null});const h=await fixture(t,value),api=[];
  h.card.api=async(route,options={})=>{api.push({route,method:options.method||'GET'});if(!options.method)return {items:[{message_id:'om_fixture',msg_type:'interactive'}]};assert.equal(options.method,'PATCH');return {};};
  await h.card.flush();assert.deepEqual(api,[{route:'im/v1/messages/om_fixture',method:'GET'},{route:'im/v1/messages/om_fixture',method:'PATCH'}]);assert.equal((await h.card.readAsync()).entry.updateState,'done');assert.deepEqual(h.calls,[]);
});

test('failed original-message readback prevents PATCH and never creates a new message',async t=>{
  const value=ledger({confirmedAt,updateState:'ready'});value.entry.sentCard=liveTestCard({...value.entry,confirmedAt:null});const h=await fixture(t,value),api=[];
  h.card.api=async(route,options={})=>{api.push(options.method||'GET');return {items:[{message_id:'om_other',msg_type:'interactive'}]};};await h.card.flush();assert.deepEqual(api,['GET']);assert.equal((await h.card.readAsync()).entry.updateState,'attention');assert.deepEqual(h.calls,[]);
});
