import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {signLearningIdentity,verifyLearningIdentity} from './learning-bridge.mjs';
import {createLearningProxy} from './learning-proxy.mjs';
const secret='a'.repeat(64),user={id:'12345',name:'测试人员',department:'品牌营销部',isAdmin:false};
function request(signed,method='GET',url='/api/me'){return {headers:{'x-learning-identity':signed.identity,'x-learning-signature':signed.signature},method,url};}
test('签名绑定身份、方法、路径与有效期，拒绝伪造和畸形签名',()=>{
 const s=signLearningIdentity(user,'GET','/api/me',secret,100000);
 assert.deepEqual(verifyLearningIdentity(request(s),secret,100001),user);
 for(const req of [request(s,'POST'),request(s,'GET','/api/admin'),request({...s,signature:'中'.repeat(43)}),request({...s,identity:s.identity+'a'})])assert.throws(()=>verifyLearningIdentity(req,secret,100001));
 assert.throws(()=>verifyLearningIdentity(request(s),secret,116000));
});
test('业务代理实时鉴权，覆盖客户端签名，保留请求与权限并正确转发写入',async()=>{
 const backend=createServer((req,res)=>{try{const u=verifyLearningIdentity(req,secret);let body='';req.on('data',c=>body+=c);req.on('end',()=>res.end(JSON.stringify({user:u,path:req.url,body})));}catch{res.writeHead(401).end();}});
 await new Promise(r=>backend.listen(0,'127.0.0.1',r));
 let allowed=true,admin=false,calls=0;
 const proxy=createLearningProxy({baseUrl:`http://127.0.0.1:${backend.address().port}`,secret,currentSession:async()=>{calls++;return allowed?{status:200,payload:{access:{master_access:true},user:{number:'FD12345',realName:user.name,department:user.department},permissions:{manage_permissions:admin}}}:{status:401,payload:{error:'login'}}},sendJson:(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));}});
 const hub=createServer(async(req,res)=>{await proxy(req,res,new URL(req.url,'http://localhost'));});await new Promise(r=>hub.listen(0,'127.0.0.1',r));
 try{const base=`http://127.0.0.1:${hub.address().port}`;
 let r=await fetch(base+'/learning/api/test?a=1',{method:'POST',body:'{"x":1}',headers:{'x-learning-signature':'fake','x-learning-identity':'fake'}});assert.equal(r.status,200);let j=await r.json();assert.deepEqual(j.user,user);assert.equal(j.path,'/api/test?a=1');assert.equal(j.body,'{"x":1}');
 admin=true;r=await fetch(base+'/learning/api/me');assert.equal((await r.json()).user.isAdmin,true);
 allowed=false;r=await fetch(base+'/learning/api/me');assert.equal(r.status,401);assert.equal(calls,3);
 }finally{await Promise.all([new Promise(r=>hub.close(r)),new Promise(r=>backend.close(r))]);}
});
