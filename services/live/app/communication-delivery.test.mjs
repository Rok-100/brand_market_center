import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createCommunicationDelivery,createCommunicationRecipient} from './communication-delivery.mjs';
const auth={ok:true,mode:'central',user:{number:'FD-000001',realName:'本人'}};
const request={requestId:'request-fixture-0001',product:'测试面膜'};
const result={product:'测试面膜',scripts:[{fullScript:'已通过检查的正文'}],fullScript:'已通过检查的正文',generatedAt:'2026-09-28T04:00:00Z'};
async function fixture(t,overrides={}){
 const root=await mkdtemp(join(tmpdir(),'communication-notify-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const actions=[],options={root,publicUrl:'https://hub.example/communication-generator.html',
  generate:async()=>{actions.push('generate');return result},save:async()=>{actions.push('save')},
  resolveRecipient:async a=>{assert.equal(a.user.number,auth.user.number);return {openId:'ou_self'}},
  send:async(recipient,text,uuid)=>{assert.equal(recipient.openId,'ou_self');assert.match(text,/沟通稿已生成/u);assert.match(text,/\?draft=communication-[a-f0-9]{32}/u);assert.equal(uuid.length,32);actions.push('send');return {messageId:'om_receipt'}},...overrides};
 return {actions,options,service:createCommunicationDelivery(options)};
}
test('successful generation saves first and sends only once across concurrent replay and restart',async t=>{
 const f=await fixture(t);const [a,b]=await Promise.all([f.service.run(request,auth,'oa'),f.service.run(request,auth,'oa')]);
 assert.equal(a.id,b.id);assert.equal(a.notification.state,'sent');assert.deepEqual(f.actions,['generate','save','send']);
 const restarted=createCommunicationDelivery(f.options);assert.equal((await restarted.run(request,auth,'oa')).notification.messageId,'om_receipt');
 assert.deepEqual(f.actions,['generate','save','send']);assert.equal((await restarted.get(a.id)).fullScript,result.fullScript);
 await assert.rejects(restarted.run({...request,product:'another'},auth,'oa'),{status:409});
});
test('model/compliance or persistence failure never sends success notification',async t=>{
 for(const step of ['generate','save']){
  let sent=0;const f=await fixture(t,{[step]:async()=>{throw Error('failed')},send:async()=>{sent++;return {messageId:'no'}}});
  await assert.rejects(f.service.run(request,auth,'oa'));assert.equal(sent,0);
 }
});
test('ambiguous send retains generated result and is never resent',async t=>{
 let calls=0;const f=await fixture(t,{send:async()=>{calls++;throw Error('timeout after POST')}});
 const a=await f.service.run(request,auth,'oa');assert.equal(a.notification.state,'uncertain');assert.equal(a.fullScript,result.fullScript);
 await createCommunicationDelivery(f.options).run(request,auth,'oa');assert.equal(calls,1);
});
test('missing recipient does not lose saved draft; no arbitrary recipient from input',async t=>{
 let calls=0;const f=await fixture(t,{resolveRecipient:async()=>{throw Error('unmapped')},send:async()=>{calls++}});
 const a=await f.service.run({...request,recipient:'ou_someone_else'},auth,'oa');assert.equal(a.notification.state,'failed');assert.equal(calls,0);assert.deepEqual(f.actions,['generate','save']);
});
test('only verified current employee can receive notification',async()=>{
 const contact={open_id:'ou_self',name:'本人',employee_no:'FD-000001',status:{is_activated:true,is_exited:false,is_frozen:false,is_resigned:false}};
 const opts={appId:'cli_aa9c744d6ffa1cc4',recipientMap:{'FD-000001':'ou_self'},readContact:async()=>contact,tenantToken:async()=>'secret-fixture'};
 assert.equal((await createCommunicationRecipient(opts)(auth)).openId,'ou_self');
 await assert.rejects(createCommunicationRecipient(opts)({...auth,user:{...auth.user,number:'FD-000002'}}));
 await assert.rejects(createCommunicationRecipient({...opts,appId:'other'})(auth));
 await assert.rejects(createCommunicationRecipient({...opts,readContact:async()=>({...contact,name:'别人'})})(auth));
 await assert.rejects(createCommunicationRecipient(opts)({...auth,degraded:true}));
});
