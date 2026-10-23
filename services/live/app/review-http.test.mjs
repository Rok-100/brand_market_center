import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {createServer} from 'node:http';

test('isolated HTTP: search, submit, reviewer authorization, rejection and notice target',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'review-http-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 let source=await readFile(new URL('./server.js',import.meta.url),'utf8');
 source=source.slice(0,source.lastIndexOf('createServer((req, res) => {'));
 source=source.replaceAll("from './",`from '${new URL('./',import.meta.url).href}`);
 source=source.replace("const dataDir = process.env.DATA_DIR || join(process.cwd(), 'data');",`const dataDir = ${JSON.stringify(dir)};`);
 source=source.replace('const auth = await authorizeCentral(req);',`const auth=req.headers['x-test-actor']==='none'?{ok:false,status:401,detail:'test unauthorized'}:{ok:true,mode:'central',user:{number:req.headers['x-test-actor']==='reviewer'?'FD-654321':'FD-123456',realName:req.headers['x-test-actor']==='reviewer'?'王审核':'测试提交人'}};`);
 source=source.replace('get:feishuGet,departmentId:liveCenterDepartmentId',`get:async()=>({items:[{name:'王审核',employee_no:'FD-654321',open_id:'ou_test',status:{is_activated:true,is_exited:false,is_resigned:false,is_frozen:false}}]}),departmentId:liveCenterDepartmentId`);
 source=source.replace('resolveRecipient:communicationReviewRecipient,send:sendCommunicationNotice',`resolveRecipient:async auth=>({number:auth.user.number}),send:async(recipient)=>{testRecipients.push(recipient.number);return {messageId:'mock'}}`);
 source+='\nexport const testRecipients=[];export {handleRequest};\n';
 const file=join(dir,'fixture.mjs');await writeFile(file,source);const fixture=await import(pathToFileURL(file));
 const server=createServer((req,res)=>fixture.handleRequest(req,res).catch(()=>{res.writeHead(500);res.end('{}')}));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const base=`http://127.0.0.1:${server.address().port}/api/script-generator`;
 async function api(path,{actor='author',body,marker=true}={}){const r=await fetch(base+path,{method:body?'POST':'GET',headers:{'x-test-actor':actor,...(marker?{'x-requested-with':'XMLHttpRequest'}:{}),'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json()}}
 assert.equal((await api('/reviews',{actor:'none'})).status,401);
 const people=await api('/reviewers?q='+encodeURIComponent('王'));assert.equal(people.data.items[0].name,'王审核');assert.ok(!people.data.items[0].openId);
 const body={requestId:'http-submit-1234567890',reviewerNumber:'FD-654321',draft:{id:'communication-test',product:'测试产品',fullScript:'测试内容',scripts:[{fullScript:'测试内容'}]}};
 assert.equal((await api('/reviews',{body,marker:false})).status,403);
 const submitted=await api('/reviews',{body});assert.equal(submitted.status,200);const id=submitted.data.review.id;
 assert.equal((await api('/reviews',{body})).data.review.id,id);
 assert.equal((await api('/reviews/'+id,{body:{decision:'approved'}})).status,403);
 assert.equal((await api('/reviews/'+id,{actor:'reviewer',body:{decision:'rejected'}})).status,400);
 const result=await api('/reviews/'+id,{actor:'reviewer',body:{decision:'rejected',comment:'请补充依据'}});assert.equal(result.status,200);assert.equal(result.data.review.notification.state,'sent');assert.deepEqual(fixture.testRecipients,['FD-654321','FD-123456']);
 assert.equal((await api('/reviews/'+id)).data.review.snapshot.fullScript,'测试内容');
 const history=await api('/history');assert.equal(history.status,200);assert.ok(history.data.drafts.some(d=>d.reviewId===id&&d.historyType==='review'));
 assert.equal((await api('/reviews/'+id+'/submission-notice',{actor:'reviewer',body:{}})).status,403);
 assert.equal((await api('/reviews/'+id+'/submission-notice',{body:{},marker:false})).status,403);
 assert.equal((await api('/reviews/'+id+'/submission-notice',{body:{}})).status,200);
 assert.equal(fixture.testRecipients.length,2);
});
