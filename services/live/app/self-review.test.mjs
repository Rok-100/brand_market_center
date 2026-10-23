import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCommunicationReview} from './communication-review.mjs';
test('submitter may select self, approve or reject, and receives own result notice',async t=>{
 const root=await mkdtemp(join(tmpdir(),'self-review-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const auth={ok:true,mode:'central',user:{number:'FD-123456',realName:'测试本人'}};const recipients=[];
 const store=createCommunicationReview({root,submissionNotifications:false,directory:{resolve:async number=>({number,name:'测试本人'})},resolveRecipient:async auth=>({number:auth.user.number}),send:async recipient=>{recipients.push(recipient.number);return {messageId:'test'}},publicUrl:'https://example.test',write:async(path,value)=>writeFile(path,JSON.stringify(value))});
 for(const decision of ['approved','rejected']){
  const r=await store.submit({requestId:'self-review-request-'+decision,reviewerNumber:'FD-123456',snapshot:{id:'draft-'+decision,product:'测试产品',fullScript:'测试稿'}},auth);
  assert.equal(r.canDecide,true);
  await assert.rejects(store.decide(r.id,{decision,comment:'意见'},{...auth,user:{number:'FD-999999',realName:'其他人'}}),{status:403});
  const result=await store.decide(r.id,{decision,comment:'意见'},auth);assert.equal(result.status,decision);assert.equal(result.notification.state,'sent');
 }
 assert.deepEqual(recipients,['FD-123456','FD-123456']);
});
