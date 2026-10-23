import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import {crc32} from 'node:zlib';
import {createClipRemixService} from '../clip-remix-service.mjs';

const exec = promisify(execFile);
const runProcess = (command,args) => exec(command,args,{timeout:60000,maxBuffer:8*1024**2});
const runFfmpeg = args => runProcess('ffmpeg',['-nostdin','-hide_banner','-loglevel','error','-threads','2',...args]);
const inspectMedia = async file => {
  const {stdout}=await runProcess('ffprobe',['-v','error','-show_format','-show_streams','-of','json',file]);
  const data=JSON.parse(stdout),v=data.streams.find(s=>s.codec_type==='video');
  return {duration:Number(data.format.duration),width:v?.width,height:v?.height,hasAudio:data.streams.some(s=>s.codec_type==='audio'),frameRate:30,videoCodec:v?.codec_name,pixelFormat:v?.pix_fmt,audioCodec:'aac'};
};
test('real FFmpeg: nine selected segments persist as one full output; review and bundle preserve ownership', {timeout:120000}, async t=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'wis-feedback-real-'));
  t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  const root=path.join(directory,'clip-remix');
  for(const dir of ['sources','clips','outputs'])await fs.mkdir(path.join(root,dir),{recursive:true});
  const clips=[];
  for(let i=0;i<9;i++){
    const file=path.join(root,'clips',`clip${i}.mp4`);
    await runFfmpeg(['-f','lavfi','-i',`color=c=0x${(0x204060+i*0x10101).toString(16)}:s=1080x1920:r=30:d=1`,'-f','lavfi','-i',`sine=frequency=${300+i*100}:duration=1`,'-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-c:a','aac','-shortest',file]);
    clips.push({id:'clip'+i,sourceId:'source',storedName:`clip${i}.mp4`,name:'片段'+i,role:'hook',productCategory:'黑晶面膜',visibility:'team',durationSeconds:1,startSeconds:i,endSeconds:i+1,reviewStatus:'approved',reviewedAt:new Date().toISOString(),createdById:'owner',contentSha256:createHash('sha256').update(await fs.readFile(file)).digest('hex'),tags:[]});
  }
  const slots=[1,2,3,2,1].map((takeCount,i)=>({id:'s'+i,label:'组'+i,takeCount}));
  const source={id:'source',storedName:'source.mp4',originalName:'源视频',visibility:'team',durationSeconds:9,productCategory:'黑晶面膜',speechSegments:[],createdById:'owner',tags:[]};
  const framework={id:'framework',name:'九段',visibility:'team',slots,tags:[]};
  await fs.writeFile(path.join(root,'library.json'),JSON.stringify({version:7,sources:[source],clips,frameworks:[framework],renders:[],folders:[],autoJobs:[]}));
  const service=createClipRemixService({dataDir:directory,nowIso:()=>new Date().toISOString(),maxFileBytes:128*1024**2,inspectMedia,runFfmpeg,runProcess,ffmpegPath:'ffmpeg',readJsonBody:async req=>req.body,jsonResponse:(res,status,body)=>Object.assign(res,{status,body}),materialCenter:{configured:false},cutter:{configured:false}});
  await service.initialize();
  const route=async(method,endpoint,body,sub='owner')=>{const res={setHeader(){}};await service.route({method,headers:{},body},res,new URL(endpoint,'http://localhost'),{sub,name:'Fixture'});return res;};
  let cursor=0;const slotSelections=Object.fromEntries(slots.map(s=>[s.id,Array.from({length:s.takeCount},()=>clips[cursor++].id)]));
  const payload={name:'完整九段真实媒体测试',frameworkId:'framework',slotSelections,productCategory:'黑晶面膜',maxOutputs:1,requestKey:'real-9'};
  const submission=await route('POST','/api/remix/operations',{type:'render',payload});
  assert.equal(submission.status,202,JSON.stringify(submission.body));
  const waitOperation=async id=>{for(let i=0;i<300;i++){const response=await route('GET','/api/remix/operations/'+id);const job=response.body.operation;if(['failed','completed'].includes(job.status))return job;await new Promise(r=>setTimeout(r,100));}throw Error('operation timed out');};
  const operation=await waitOperation(submission.body.operation.id);
  assert.equal(operation.status,'completed',JSON.stringify(operation));
  const saved=JSON.parse(await fs.readFile(path.join(root,'library.json'),'utf8'));
  assert.equal(saved.renders.length,1);
  const render=saved.renders[0],variant=render.variants[0];
  assert.deepEqual(variant.clipSequence,clips.map(c=>c.id));
  const media=await inspectMedia(path.join(root,'outputs',variant.storedName));
  assert.ok(Math.abs(media.duration-9)<0.3,JSON.stringify(media));
  assert.equal((await route('POST','/api/remix/operations',{type:'render',payload})).body.operation.id,operation.id);
  const endpoint=`/api/remix/renders/${render.id}/variants/${variant.id}/review`;
  assert.equal((await route('POST',endpoint,{reviewStatus:'approved',reviewNote:'测试逐段核验'},'other')).status,403);
  const reviewed=await route('POST',endpoint,{reviewStatus:'approved',reviewNote:'隔离测试确认完整九段'}); assert.equal(reviewed.status,200,JSON.stringify(reviewed.body));
  const bundle=await route('POST','/api/remix/operations',{type:'download-bundle',payload:{items:[{renderId:render.id,variantId:variant.id},{renderId:'missing',variantId:'missing'}]}});
  const complete=await waitOperation(bundle.body.operation.id);
  assert.equal(complete.status,'completed',JSON.stringify(complete));
  assert.equal(complete.result.count,1);assert.equal(complete.result.failures.length,1);
  const receipt=JSON.parse(await fs.readFile(path.join(root,'bundles',complete.result.bundleId+'.json'),'utf8'));
  assert.equal(receipt.items.length,1);assert.equal(receipt.owner,'owner');
  const zipFile=path.join(root,'bundles',complete.result.bundleId+'.zip');
  // Independently verify the ZIP directory, native zlib CRC and original bytes.
  // GNU tar does not read ZIP; Windows bsdtar does, so keep that extra check there.
  const zip=await fs.readFile(zipFile),end=zip.length-22;
  assert.equal(zip.readUInt32LE(end),0x06054b50);
  assert.equal(zip.readUInt16LE(end+10),1);
  const central=zip.readUInt32LE(end+16);
  assert.equal(zip.readUInt32LE(central),0x02014b50);
  assert.equal(zip.readUInt16LE(central+10),0);
  const size=zip.readUInt32LE(central+24),local=zip.readUInt32LE(central+42);
  assert.equal(zip.readUInt32LE(local),0x04034b50);
  const start=local+30+zip.readUInt16LE(local+26)+zip.readUInt16LE(local+28);
  const content=zip.subarray(start,start+size);
  assert.equal(crc32(content),zip.readUInt32LE(central+16));
  assert.deepEqual(content,await fs.readFile(path.join(root,'outputs',variant.storedName)));
  if(process.platform==='win32'){
    const listing=await runProcess('tar',['-tf',zipFile]);
    assert.equal(listing.stdout.trim().split(/\r?\n/).length,1);
  }
  assert.equal((await route('GET',complete.result.url,null,'other')).status,403);
});

test('real manual cuts accept 0.4, 21 and 61 seconds while rejecting invalid bounds', {timeout:120000}, async t=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'wis-feedback-duration-'));
 t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 const root=path.join(directory,'clip-remix');
 await fs.mkdir(path.join(root,'sources'),{recursive:true});
 const file=path.join(root,'sources','source.mp4');
 await runFfmpeg(['-f','lavfi','-i','color=c=blue:s=180x320:r=30:d=62','-f','lavfi','-i','sine=frequency=400:duration=62','-c:v','libx264','-preset','ultrafast','-c:a','aac','-shortest',file]);
 const source={id:'s',storedName:'source.mp4',originalName:'长视频',durationSeconds:62,hasAudio:true,visibility:'team',productCategory:'黑晶面膜',speechSegments:[],tags:[]};
 await fs.writeFile(path.join(root,'library.json'),JSON.stringify({version:7,sources:[source],clips:[],frameworks:[],renders:[],folders:[],autoJobs:[]}));
 const service=createClipRemixService({dataDir:directory,nowIso:()=>new Date().toISOString(),inspectMedia,runFfmpeg,runProcess,ffmpegPath:'ffmpeg',maxFileBytes:128*1024**2,makeSegment:({inputPath,outputPath,startSeconds,durationSeconds})=>runFfmpeg(['-ss',String(startSeconds),'-i',inputPath,'-t',String(durationSeconds),'-c:v','libx264','-preset','ultrafast','-c:a','aac',outputPath]),readJsonBody:async r=>r.body,jsonResponse:(res,status,body)=>Object.assign(res,{status,body}),materialCenter:{configured:false},cutter:{configured:false}});
 await service.initialize();
 for(const endSeconds of [.4,21,61,0,65]){
  const res={};await service.route({method:'POST',headers:{},body:{sourceId:'s',startSeconds:0,endSeconds,role:'hook',name:'测试'+endSeconds,productCategory:'黑晶面膜'}},res,new URL('http://localhost/api/remix/clips'),{sub:'owner',name:'Fixture'});
  if(endSeconds>0&&endSeconds<62){assert.equal(res.status,201,JSON.stringify(res));assert.equal(res.body.clip.durationSeconds,endSeconds);const data=JSON.parse(await fs.readFile(path.join(root,'library.json'),'utf8'));const saved=data.clips.find(c=>c.id===res.body.clip.id);assert.ok(Math.abs((await inspectMedia(path.join(root,'clips',saved.storedName))).duration-endSeconds)<.15);}
  else assert.equal(res.status,400,JSON.stringify(res));
 }
});
