import {spawn} from 'node:child_process';
import {mkdir,mkdtemp,writeFile,readFile,stat,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {fault} from './anchor-status-policy.mjs';

export function runProcess(command,args,{signal,maxOutput=12*1024*1024}={}) {
  return new Promise((resolve,reject)=>{
    const child=spawn(command,args,{stdio:['ignore','pipe','pipe'],signal,windowsHide:true});let output=[],bytes=0,settled=false;
    const fail=error=>{if(settled)return;settled=true;child.kill('SIGKILL');reject(error);};
    child.on('error',error=>fail(error.code==='ENOENT'?fault('媒体处理依赖尚未安装。','media_dependency_missing',503):error));
    child.stdout.on('data',chunk=>{bytes+=chunk.length;if(bytes>maxOutput)return fail(fault('媒体分析输出超限。','media_quality',422));output.push(chunk);});
    // Never log raw stderr: paths and provider messages may contain private metadata.
    child.stderr.resume();child.on('close',code=>{if(settled)return;settled=true;if(code!==0)return reject(fault('录屏媒体处理失败。','media_error',502));resolve(Buffer.concat(output).toString('utf8'));});
  });
}

export function createMediaAnalyzer({directory,download,maxBytes=160*1024*1024}={}) {
  return async(source,{signal}={})=>{
    await mkdir(directory,{recursive:true,mode:0o700});const work=await mkdtemp(join(directory,'analysis-'));
    try{
      const response=await download(source,signal);if(!response.ok||!response.body)throw fault('录屏下载失败，将重试。','download_error',502);
      const length=Number(response.headers.get('content-length')||0);if(length>maxBytes){await response.body.cancel();throw fault('录屏超过160MB处理上限，转人工。','media_quality',422);}
      const reader=response.body.getReader(),chunks=[];let bytes=0;const hash=createHash('sha256');
      try{while(true){signal?.throwIfAborted();const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>maxBytes)throw fault('录屏超过160MB处理上限，转人工。','media_quality',422);hash.update(value);chunks.push(Buffer.from(value));}}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
      const file=join(work,'recording.bin');await writeFile(file,Buffer.concat(chunks),{mode:0o600});
      const metadata=JSON.parse(await runProcess(process.env.ANCHOR_STATUS_FFPROBE||'ffprobe',['-v','error','-protocol_whitelist','file,pipe','-show_format','-show_streams','-of','json',file],{signal,maxOutput:100000}));
      const duration=Number(metadata.format?.duration);
      if(!Number.isFinite(duration)||!metadata.streams?.some(x=>x.codec_type==='video'))throw fault('录屏文件损坏或没有视频轨。','media_quality',422);
      if(duration<120||duration>240)throw fault(`录屏时长 ${duration.toFixed(1)} 秒，不在2–4分钟范围，已跳过。`,'duration_filtered',422);
      if(!metadata.streams.some(x=>x.codec_type==='audio'))throw fault('录屏没有音轨，不能完成声音维度评分。','media_quality',422);
      const target=join(work,'model-input.mp4');
      await runProcess(process.env.ANCHOR_STATUS_FFMPEG||'ffmpeg',['-nostdin','-v','error','-protocol_whitelist','file,pipe','-i',file,'-map','0:v:0','-map','0:a:0','-vf','scale=480:-2,fps=12','-c:v','libx264','-preset','veryfast','-crf','28','-maxrate','250k','-bufsize','500k','-c:a','aac','-b:a','48k','-ac','1','-movflags','+faststart',target],{signal});
      if((await stat(target)).size>10*1024*1024)throw fault('录屏压缩后仍超过模型输入上限，转人工复核。','media_quality',422);
      return {videoBase64:(await readFile(target)).toString('base64'),hasAudio:true,durationSeconds:duration,hash:hash.digest('hex'),bytes};
    }finally{await rm(work,{recursive:true,force:true});}
  };
}
