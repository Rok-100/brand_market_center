import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createMediaAnalyzer,runProcess} from './anchor-status-media.mjs';

test('actual ffmpeg keeps original audio while reducing the full 120-second recording for the model',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'anchor-media-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const input=join(dir,'original.mp4');await runProcess('ffmpeg',['-v','error','-f','lavfi','-i','color=c=navy:s=160x240:r=12:d=120','-f','lavfi','-i','sine=frequency=523:duration=120','-c:v','libx264','-preset','ultrafast','-c:a','aac','-shortest',input]);
  const data=await readFile(input),work=join(dir,'work');
  const analyze=createMediaAnalyzer({directory:work,download:async()=>new Response(data)});
  const result=await analyze({},{signal:AbortSignal.timeout(300000)});
  assert.equal(result.hasAudio,true);assert.ok(result.durationSeconds>=120&&result.durationSeconds<121);assert.equal(result.hash.length,64);assert.ok(result.videoBase64.length>1000);assert.deepEqual(await readdir(work),[]);
});
test('over-limit downloads and absent media executables return actionable states and clean temporary files',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'anchor-media-limit-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const analyze=createMediaAnalyzer({directory:dir,maxBytes:10,download:async()=>new Response('too many bytes',{headers:{'content-length':'99'}})});
  await assert.rejects(analyze({}),{code:'media_quality'});assert.deepEqual(await readdir(dir),[]);
  await assert.rejects(runProcess('nonexistent-anchor-executable-123',[]),{code:'media_dependency_missing'});
});
