import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createApp} from '../server/app.mjs';
import {verifyLearningIdentity} from '../server/learning-bridge.mjs';
const hubDirectory=process.env.LEARNING_HUB_DIR||new URL('../../../../fd-026222-hub-r65-owner-only-safeoff-20260925/app/',import.meta.url).href;
const {createLearningProxy}=await import(new URL('learning-proxy.mjs',hubDirectory));
test('真实中枢会话不含 allowed：四种视图可进入，管理员能管理学员授权，普通职级不自动获管理权',async()=>{
 const secret='integration-only-'.repeat(4);
 const {app,close}=createApp({dbPath:':memory:',csrfSecret:secret,identityProvider:req=>verifyLearningIdentity(req,secret)});
 const backend=app.listen(0,'127.0.0.1');await new Promise(r=>backend.once('listening',r));
 // Matches the actual central-auth/me contract: user, permissions, access, with hub workspace added.
 const session={status:200,payload:{user:{number:'FD-001234',realName:'权限回归',department:'品牌营销部'},permissions:{manage_permissions:true},access:{master_access:true},workspace:{role:'director'}}};
 const proxy=createLearningProxy({baseUrl:`http://127.0.0.1:${backend.address().port}`,secret,currentSession:async()=>session,sendJson:(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));}});
 const hub=createServer(async(req,res)=>{await proxy(req,res,new URL(req.url,'http://localhost'));});await new Promise(r=>hub.listen(0,'127.0.0.1',r));
 const base=`http://127.0.0.1:${hub.address().port}/learning/`;
 try{
  for(const view of ['real','director','manager','specialist']){
   const suffix='?preview_role='+view;
   assert.equal((await fetch(base+suffix)).status,200,view+' page');
   let r=await fetch(base+'api/me'+suffix);assert.equal(r.status,200);assert.equal((await r.json()).user.isAdmin,true);
   for(const path of ['api/admin/learners','api/admin/access'])assert.equal((await fetch(base+path+suffix)).status,200,view+' '+path);
  }
  session.payload.permissions.manage_permissions=false;
  for(const role of ['director','manager','specialist']){session.payload.workspace.role=role;
   let r=await fetch(base+'api/me');assert.equal(r.status,200);assert.equal((await r.json()).user.isAdmin,false);
   assert.equal((await fetch(base+'api/courses')).status,200);
   assert.equal((await fetch(base+'api/admin/access')).status,403);
  }
  session.payload.access.master_access=false;assert.equal((await fetch(base+'api/me')).status,403);
  session.payload.access.master_access=true;session.payload.allowed=false;assert.equal((await fetch(base+'api/me')).status,403);
  delete session.payload.allowed;session.status=401;assert.equal((await fetch(base+'api/me')).status,401);
 }finally{await Promise.all([new Promise(r=>hub.close(r)),new Promise(r=>backend.close(r))]);close();}
});
