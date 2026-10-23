import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {AnchorStatusStore} from './anchor-status-store.mjs';
import {createDelegatedOAAuthorization} from './anchor-status-authorization.mjs';
import {createAnchorStatusService} from './anchor-status-service.mjs';
import {DIMENSIONS} from './anchor-status-policy.mjs';

const NOW=Date.parse('2026-10-07T01:00:00Z'),OWNER='FD-FIXTURE',TOKEN='fixture-delegated-token',MODEL='qwen3.5-omni-flash';
const input=name=>({name,room:'官旗',resource:{type:'file',key:'file_'+name,name:'video.mov'},recording:{messageId:'om_'+name,text:'官旗 '+name+' 2026-10-07 08:00-10:00',createdAt:new Date(NOW).toISOString(),source:'WIS直播学习',resources:[{type:'file',key:'file_'+name,name:'video.mov'}]}});
const raw=()=>({status:'scored',quality:{visualUsable:true,audioUsable:true},dimensions:DIMENSIONS.map(name=>({name,score:8,evidence:'实际录屏证据'})),compliance:{status:'clear',hits:[]}});
async function fixture(t,{persistent=false,score,verify}={}){
  const directory=await mkdtemp(join(tmpdir(),'anchor-background-'));const path=persistent?join(directory,'state.sqlite'):':memory:';
  let store=new AnchorStatusStore(path,{clock:()=>NOW});t.after(async()=>{store.close();await rm(directory,{recursive:true,force:true});});
  const calls=[];let permission=true;
  const connect=()=>{
    const delegation=createDelegatedOAAuthorization({store,keyFile:join(directory,'oa.key'),clock:()=>NOW,verify:async(token,owner)=>{assert.equal(token,TOKEN);assert.equal(owner,OWNER);return permission;}});
    const service=createAnchorStatusService({store,delegation,clock:()=>NOW,collect:async()=>({sources:{learning:{available:true}},evidenceByAnchor:{甲:{recordings:[input('甲').recording]},乙:{recordings:[input('乙').recording]}}}),
      analyze:async source=>({videoBase64:'fixture',hasAudio:true,durationSeconds:180,hash:source.name,bytes:50}),model:{verifyCredentials:verify||(async()=>MODEL),score:async(data,options)=>{assert.equal(options.token,TOKEN);calls.push(data.name);if(score)await score(data);return {value:raw(),model:MODEL};}}});
    return {service,delegation};
  };
  let connected=connect();await connected.service.scan('slot');
  return {directory,calls,get store(){return store;},get service(){return connected.service;},get delegation(){return connected.delegation;},deny(){permission=false;},restart(){store.close();store=new AnchorStatusStore(path,{clock:()=>NOW});connected=connect();}};
}
test('server drains multiple queue jobs with no page requests; repeated ticks never score successes again',async t=>{
  const f=await fixture(t);await f.service.configureAutomation({action:'enable',token:TOKEN,actor:OWNER});await f.service.pump();
  assert.deepEqual(f.calls,['甲','乙']);assert.ok(f.store.list().every(r=>r.state==='scored'));await f.service.tick('slot');assert.equal(f.calls.length,2);
  assert.equal(f.service.status().automation.enabled,true);assert.equal(f.service.status().lastBackgroundCheck,new Date(NOW).toISOString());assert.ok(!JSON.stringify(f.store.meta('anchorStatusDelegatedOA')).includes(TOKEN));assert.ok(!JSON.stringify(f.service.status()).includes(TOKEN));
});
test('encrypted delegated OA survives restart and drives a later capture; the key is outside the database',async t=>{
  const f=await fixture(t,{persistent:true});await f.service.configureAutomation({action:'enable',token:TOKEN,actor:OWNER});await f.service.pump();
  const key=await stat(join(f.directory,'oa.key'));assert.equal(key.size,32);if(process.platform!=='win32')assert.equal(key.mode&0o077,0);
  f.restart();f.store.ingest([input('丙')]);await f.service.matchPending();await f.service.tick('slot');assert.equal(f.calls.at(-1),'丙');assert.equal(f.store.list().find(r=>r.name==='丙').state,'scored');
});
test('global pause lets the current score finish but stops the next job and removes encrypted credentials',async t=>{
  let release,entered;const started=new Promise(resolve=>entered=resolve),wait=new Promise(resolve=>release=resolve);
  const f=await fixture(t,{score:async()=>{entered();await wait;}});await f.service.configureAutomation({action:'enable',token:TOKEN,actor:OWNER});await started;
  await f.service.configureAutomation({action:'pause',actor:OWNER});release();await f.service.pump();
  assert.equal(f.calls.length,1);assert.equal(f.store.list().filter(r=>r.state==='queued').length,1);assert.equal(f.store.meta('anchorStatusDelegatedOA').ciphertext,undefined);
});
test('revoked role and rejected model auth stop before claiming a job and do not expose provider text',async t=>{
  const f=await fixture(t);await f.delegation.enable(TOKEN,OWNER,MODEL);f.deny();await f.service.tick('slot');assert.equal(f.calls.length,0);assert.ok(f.store.list().every(r=>r.attempts===0));assert.equal(f.delegation.status().state,'reauthorization_required');
  const denied=await fixture(t,{verify:async()=>{throw Object.assign(Error(TOKEN),{status:401});}});await denied.delegation.enable(TOKEN,OWNER,MODEL);await denied.service.tick('slot');assert.ok(denied.store.list().every(r=>r.attempts===0));assert.ok(!JSON.stringify(denied.service.status()).includes(TOKEN));assert.equal(denied.delegation.status().enabled,false);
});
test('expiry, ciphertext tampering and transient permission failures fail closed without losing queue jobs',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'anchor-auth-'));t.after(()=>rm(dir,{recursive:true,force:true}));const store=new AnchorStatusStore(':memory:');t.after(()=>store.close());let clock=NOW,available=true;
  const delegation=createDelegatedOAAuthorization({store,keyFile:join(dir,'oa.key'),clock:()=>clock,verify:async()=>{if(!available)throw Object.assign(Error('private upstream'),{status:503});return true;}});
  const jwt='header.'+Buffer.from(JSON.stringify({exp:(NOW+60000)/1000})).toString('base64url')+'.fixture';await delegation.enable(jwt,OWNER,MODEL);clock+=60001;delegation.expire();assert.equal(store.meta('anchorStatusDelegatedOA').ciphertext,undefined);assert.equal(await delegation.token(),'');assert.equal(delegation.status().enabled,false);
  await delegation.enable(TOKEN,OWNER,MODEL);const r=store.meta('anchorStatusDelegatedOA');r.owner='someone-else';store.meta('anchorStatusDelegatedOA',r);assert.equal(await delegation.token(),'');
  await delegation.enable(TOKEN,OWNER,MODEL);available=false;await assert.rejects(delegation.token(),{code:'delegation_check_unavailable'});assert.equal(delegation.status().enabled,true);
});

test('manual model retry resets a failed job, prioritizes it over newer captures and never retries a success',async t=>{
  const f=await fixture(t);const old=input('丁');old.recording.text='官旗 丁 2026-10-05 08:00-10:00';old.recording.createdAt='2026-10-05T01:00:00Z';f.store.ingest([old]);await f.service.matchPending();
  const job=f.store.list().find(r=>r.name==='丁');f.store.db.prepare("UPDATE jobs SET state='needs_review',attempts=4,error='fixture model failed' WHERE id=?").run(job.id);
  await f.delegation.enable(TOKEN,OWNER,MODEL);const accepted=f.service.retry(job.id,OWNER);assert.equal(accepted.state,'queued');assert.equal(accepted.attempts,0);assert.equal(accepted.manualRetry.actor,OWNER);
  assert.throws(()=>f.service.retry(job.id,OWNER),{code:'conflict'});await f.service.pump();assert.deepEqual(f.calls,['丁','甲','乙']);assert.equal(f.store.get(job.id).result.total,80);
  const receipt=f.store.report(job.id);assert.throws(()=>f.service.retry(job.id,OWNER),{code:'conflict'});assert.deepEqual(f.store.report(job.id),receipt);
  assert.equal(f.store.db.prepare("SELECT count(*) AS n FROM audit WHERE job_id=? AND action='retry'").get(job.id).n,1);
});

test('manual retry preserves an unresolved identity or a failed job when background scoring is paused',async t=>{
  const f=await fixture(t);const failed=f.store.list()[0];f.store.db.prepare("UPDATE jobs SET state='needs_review',attempts=4 WHERE id=?").run(failed.id);
  assert.throws(()=>f.service.retry(failed.id,OWNER),{code:'automation_paused'});assert.equal(f.store.get(failed.id).attempts,4);assert.equal(f.store.get(failed.id).state,'needs_review');
  const unknown=input('未知');unknown.name='未识别主播';unknown.unidentified=true;unknown.recording.text='';f.store.ingest([unknown]);const id=f.store.list().find(r=>r.name==='未识别主播').id;
  assert.throws(()=>f.service.retry(id,OWNER),{code:'identity_review'});assert.equal(f.store.get(id).state,'needs_review');assert.equal(f.calls.length,0);
});

test('server recovers a single expired in-flight lease even when no other queue jobs can wake it',async t=>{
  const f=await fixture(t);await f.delegation.enable(TOKEN,OWNER,MODEL);
  const lost=f.store.claim({requireSession:true});f.store.db.prepare("UPDATE jobs SET state='ignored' WHERE id<>?").run(lost.id);f.store.db.prepare('UPDATE jobs SET lease_until=? WHERE id=?').run(NOW-1,lost.id);
  await f.service.tick('slot');assert.equal(f.store.get(lost.id).state,'scored');assert.deepEqual(f.calls,[lost.name]);assert.equal(f.store.get(lost.id).attempts,2);
});
