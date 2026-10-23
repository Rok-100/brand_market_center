import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DissectionService} from '../dissection-service.mjs';
import {createDissectionHandler} from '../dissection-http.mjs';
const people=[{number:'M',name:'主管',center:'中心',role:'manager',active:true},{number:'O',name:'其他同事',center:'其他中心',role:'specialist',active:true}];
const identity=number=>({user:{number,realName:number},workspace:{role:people.find(p=>p.number===number).role,center:people.find(p=>p.number===number).center,is_brand_department:true},permissions:{manage_permissions:false}});
function fixture(){const root=mkdtempSync(join(tmpdir(),'poster-access-'));const service=new DissectionService({root,people:()=>people,vault:{read:()=>null}});service.ingest({id:'r',materials:{status:'ready',items:[{id:'v',platform:'test',title:'素材',spend:30000,downloadUrl:'http://fixture/video',coverUrl:'http://pinguan-central-platform.fandow.com/api/video/thumb/v'}]}});return {service,close(){service.close();rmSync(root,{recursive:true,force:true})}};}
test('jobs expose a same-origin poster independently of the insecure source thumbnail',()=>{const f=fixture();try{const job=f.service.overview(f.service.access(identity('M'))).jobs[0];assert.equal(job.posterPath,`api/dissection-review/jobs/${job.id}/poster`);}finally{f.close()}});
test('poster requests require login and the same ownership permission as the video',async()=>{
  const f=fixture();let response,posterCalls=0;const job=f.service.overview(f.service.access(identity('M'))).jobs[0];f.service.poster=async(_req,_res,j)=>{posterCalls++;response={status:200,id:j.id};};
  const handler=(number,status=200)=>createDissectionHandler({service:f.service,currentSession:async()=>({status,payload:identity(number)}),readJson:async()=>({}),sendJson:(_res,status,payload)=>{response={status,payload}}});
  const req={method:'GET',headers:{}},res={};const url=new URL('https://local/api/dissection-review/jobs/'+job.id+'/poster');
  try{await handler('M')(req,res,url);assert.equal(response.status,200);assert.equal(posterCalls,1);await handler('O')(req,res,url);assert.equal(response.status,403);assert.equal(posterCalls,1);await handler('M',401)(req,res,url);assert.equal(response.status,401);assert.equal(posterCalls,1);}finally{f.close()}
});
