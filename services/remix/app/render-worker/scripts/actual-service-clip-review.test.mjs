import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import {execFile} from 'node:child_process';import {promisify} from 'node:util';import {createHash} from 'node:crypto';
import {createClipRemixService} from '../clip-remix-service.mjs';
const exec=promisify(execFile),wait=ms=>new Promise(r=>setTimeout(r,ms));
test('real media + actual service: 12/48/240 batch, recovery, ACL, rejection and readback',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'wis-batch-http-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const root=path.join(dir,'clip-remix');await fs.mkdir(path.join(root,'clips'),{recursive:true});
 const file=path.join(root,'clips','test.mp4');
 await exec('ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=blue:s=160x240:d=0.5','-f','lavfi','-i','sine=frequency=400:duration=0.5','-c:v','libx264','-threads','1','-c:a','aac','-shortest',file]);
 const hash=createHash('sha256').update(await fs.readFile(file)).digest('hex');
 const source={id:'source',storedName:'source.mp4',originalName:'isolated.mp4',visibility:'team',durationSeconds:.5,productCategory:'测试品类',tags:[],speechSegments:[]};
 const clips=Array.from({length:240},(_,i)=>({id:'clip-'+i,storedName:'test.mp4',name:'隔离测试'+i,sourceId:'source',contentSha256:hash,visibility:'team',reviewStatus:'pending',reviewedAt:null,durationSeconds:.5,startSeconds:0,endSeconds:.5,tags:[]}));
 clips.push({...clips[0],id:'private',visibility:'private',createdByIds:['other']});
 await fs.writeFile(path.join(root,'library.json'),JSON.stringify({version:7,sources:[source],clips,frameworks:[],renders:[],autoJobs:[],folders:[]}));
 let checks=0;
 const service=createClipRemixService({dataDir:dir,nowIso:()=>new Date().toISOString(),inspectMedia:async file=>{checks++;const {stdout}=await exec('ffprobe',['-v','quiet','-show_streams','-show_format','-of','json',file]);const p=JSON.parse(stdout),v=p.streams.find(s=>s.codec_type==='video');return {duration:Number(p.format.duration),hasAudio:p.streams.some(s=>s.codec_type==='audio'),width:v?.width,height:v?.height};},readJsonBody:async r=>r.body||{},jsonResponse:(res,status,body)=>Object.assign(res,{status,body}),materialCenter:{configured:false},cutter:{configured:false}});
 await service.initialize();
 const request=async(method,url,body={},sub='owner')=>{const res={};await service.route({method,headers:{},body},res,new URL('http://localhost'+url),{sub,name:'Isolated QA'});return res;};
 const finish=async id=>{for(let i=0;i<2000;i++){const r=await request('GET','/api/remix/clip-reviews/'+id);if(['completed','failed'].includes(r.body.operation.status))return r.body.operation;await wait(10);}throw Error('timeout');};
 const oldStart=performance.now();for(let i=0;i<12;i++){const r=await request('POST',`/api/remix/clips/clip-${i}/review`,{reviewStatus:'approved'});assert.equal(r.status,200,JSON.stringify(r));}const serialMs=performance.now()-oldStart;
 for(const n of [12,48,240]){
  const payload={ids:Array.from({length:n},(_,i)=>'clip-'+i),reviewStatus:'approved',requestKey:'actual-review-request-'+n};
  const started=performance.now(),r=await request('POST','/api/remix/clip-reviews',payload),receiptMs=performance.now()-started;
  assert.equal(r.status,202,JSON.stringify(r));const job=await finish(r.body.operation.id);assert.equal(job.status,'completed',JSON.stringify(job));assert.equal(job.result.succeeded,n);
  const elapsedMs=performance.now()-started,prior=checks;
  const again=await request('POST','/api/remix/clip-reviews',payload);assert.equal(again.body.operation.id,job.id);assert.equal(checks,prior);
  const denied=await request('GET','/api/remix/clip-reviews/'+job.id,{},'other');assert.equal(denied.status,404);
  const disk=JSON.parse(await fs.readFile(path.join(root,'library.json')));assert.equal(disk.clips.filter(c=>payload.ids.includes(c.id)&&c.reviewStatus==='approved').length,n);
  t.diagnostic(JSON.stringify({realMedia:true,n,receiptMs:Math.round(receiptMs),elapsedMs:Math.round(elapsedMs),serial12Ms:Math.round(serialMs),note:'isolated server benchmark, not production user latency'}));
 }
 const r=await request('POST','/api/remix/clip-reviews',{ids:['clip-0','private'],reviewStatus:'changes_requested',requestKey:'actual-review-reject-001'});
 const job=await finish(r.body.operation.id);assert.equal(job.result.succeeded,1);assert.equal(job.result.results.find(r=>r.id==='private').clip,undefined);
});
