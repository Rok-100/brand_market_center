import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {RECOVERY_TARGETS} from './reserved-output-recovery.mjs';

export async function hashMedia(file) {
  const hash=createHash('sha256');for await(const chunk of createReadStream(file))hash.update(chunk);return hash.digest('hex');
}
export function limitedFfmpegArgs(args){
  const bounded=args.flatMap(value=>value==='-i'?['-threads','1',value]:[value]);
  bounded.splice(bounded.length-1,0,'-threads','1');
  return ['-filter_threads','1','-filter_complex_threads','1',...bounded];
}
export function command(binary,args,{timeoutMs=180000,maxBytes=8*1024*1024}={}) {
  return new Promise((resolve,reject)=>{
    const actualArgs=/^ffmpeg(?:\.exe)?$/i.test(path.basename(binary))?limitedFfmpegArgs(args):args;
    const child=spawn(binary,actualArgs,{stdio:['ignore','pipe','pipe'],windowsHide:true});const stdout=[],stderr=[];let size=0,failed=false;
    const finishError=error=>{if(failed)return;failed=true;clearTimeout(timer);child.kill('SIGKILL');reject(error);};
    const timer=setTimeout(()=>finishError(new Error(`${binary} local verification timed out`)),timeoutMs);
    const collect=(chunks,chunk)=>{size+=chunk.length;if(size>maxBytes)return finishError(new Error('Local verification output exceeded limit'));chunks.push(chunk);};
    child.stdout.on('data',chunk=>collect(stdout,chunk));child.stderr.on('data',chunk=>collect(stderr,chunk));child.on('error',finishError);
    child.on('close',code=>{if(failed)return;clearTimeout(timer);const result={stdout:Buffer.concat(stdout),stderr:Buffer.concat(stderr).toString('utf8')};
      if(code!==0)return reject(Object.assign(new Error(`${binary} local verification failed (${code})`),{diagnostic:result.stderr.slice(-2000)}));resolve(result);});
  });
}
const stamp=s=>[s.dev,s.ino,s.size,s.mtimeNs,s.ctimeNs].join(':');
async function fileStamp(file){const stat=await fs.lstat(file,{bigint:true});if(!stat.isFile()||stat.isSymbolicLink())throw new Error('Recovery requires an ordinary original media file');return stamp(stat);}

// Legacy cuts may have no stored hash. Search only original selections at the
// exact reserved durations, with a hard bound; never expand to the media library.
export async function measureRecoveryCandidates(library,{clipsDir,hashFile=hashMedia,onProgress=()=>{},limit=128,resolveInput,resolvedInputs={}}){
  const candidates=new Map(),expectedByClip=new Map();
  for(const target of RECOVERY_TARGETS){const job=library.autoJobs.find(row=>row.id===target.jobId),run=job?.runs?.find(row=>row.id===target.runId);
    const reservation=job?.sequenceReservations?.find(row=>row.renderId===target.renderId&&row.variantId===target.variantId&&row.runId===target.runId);
    if(!reservation||reservation.status==='recorded')continue;const selected=new Set(Object.values(run?.slotSelections||{}).flat()),durations=new Set(reservation.intervals.map(row=>row[2]));
    for(const clip of library.clips)if(selected.has(clip.id)&&durations.has(clip.durationSeconds)&&!clip.contentSha256&&clip.reviewStatus==='approved'&&!clip.deliveryBlocked){
      if(typeof clip.storedName!=='string'||/[\\/]/.test(clip.storedName))throw new Error('Invalid candidate file name');candidates.set(clip.id,clip);
      expectedByClip.set(clip.id,[...new Set([...(expectedByClip.get(clip.id)||[]),...reservation.intervals.filter(row=>row[2]===clip.durationSeconds).map(row=>row[0])])]);}}
  if(candidates.size>limit)throw new Error(`Bounded recovery needs ${candidates.size} cut hashes, above limit ${limit}; narrow the original manifest before continuing`);
  const measured={};let count=0;
  for(const clip of candidates.values()){try{const resolved=resolveInput?await resolveInput(clip,{expectedHashes:expectedByClip.get(clip.id)}):{file:path.join(clipsDir,clip.storedName)},file=resolved.file;
      const before=await fileStamp(file),sha=await hashFile(file);if(await fileStamp(file)!==before||resolved.receiptSha256&&resolved.receiptSha256!==sha)throw new Error('Candidate changed while hashing');measured[clip.id]=sha;resolvedInputs[clip.id]=resolved;}
    catch(error){if(error.code!=='ENOENT')throw error;}
    onProgress({measured:++count,total:candidates.size});}
  return measured;
}

export function audioCorrelation(left,right,{rate=4000,maxLagSeconds=.12}={}){
  const a=new Int16Array(left.buffer.slice(left.byteOffset,left.byteOffset+left.byteLength-(left.byteLength%2)));
  const b=new Int16Array(right.buffer.slice(right.byteOffset,right.byteOffset+right.byteLength-(right.byteLength%2)));
  if(Math.min(a.length,b.length)<rate*.4)return 0;
  let best=-1,bestLag=0;const maxLag=Math.round(rate*maxLagSeconds);
  const score=lag=>{const startA=Math.max(0,lag),startB=Math.max(0,-lag),length=Math.min(a.length-startA,b.length-startB);let ab=0,aa=0,bb=0;
    for(let i=0;i<length;i+=4){const x=a[startA+i],y=b[startB+i];ab+=x*y;aa+=x*x;bb+=y*y;}
    if(aa/length<16&&bb/length<16)return 1;
    return aa>0&&bb>0?ab/Math.sqrt(aa*bb):-1;
  };
  for(let lag=-maxLag;lag<=maxLag;lag+=8){const value=score(lag);if(value>best){best=value;bestLag=lag;}}
  for(let lag=Math.max(-maxLag,bestLag-7);lag<=Math.min(maxLag,bestLag+7);lag++)best=Math.max(best,score(lag));
  return best;
}

// Decode and compare the existing output; no encoders, model calls, cloud
// writes or source downloads. SSIM compares the full decoded sequence, not a
// thumbnail. The bottom 10% is excluded solely for the original text overlay.
export async function reviewOriginalOutput(plan,{outputsDir,clipsDir,existingHashes=new Set(),ffmpeg='ffmpeg',ffprobe='ffprobe',run=command,hashFile=hashMedia,onProgress=()=>{},resolveInput}){
  const output=path.join(outputsDir,plan.storedName),before=await fileStamp(output),sha256=await hashFile(output);
  const inputs=[];
  for(const clip of plan.clips){const resolved=resolveInput?await resolveInput(clip,{expectedHashes:[plan.inputHashes[clip.id]],cacheFile:plan.resolvedInputs?.[clip.id]?.cacheFile}):{file:path.join(clipsDir,clip.storedName)},file=resolved.file;
    const version=await fileStamp(file),hash=await hashFile(file);if(hash!==plan.inputHashes[clip.id])throw new Error(`Original cut bytes changed: ${clip.id}`);inputs.push({clip,file,version,sha256:hash});}
  onProgress('检查完整媒体与音视频解码');
  const probe=await run(ffprobe,['-v','error','-show_streams','-show_format','-of','json',output]);
  const info=JSON.parse(probe.stdout.toString()),video=info.streams?.find(s=>s.codec_type==='video'),hasAudio=info.streams?.some(s=>s.codec_type==='audio');
  const duration=Number(info.format?.duration),width=video?.width,height=video?.height;
  if(!video||!hasAudio||!Number.isFinite(duration)||duration<=0)throw new Error('Original output has no complete audio/video streams');
  const decoded=await run(ffmpeg,['-hide_banner','-nostdin','-xerror','-err_detect','explode','-i',output,'-vf','blackdetect=d=1:pic_th=0.98','-af','silencedetect=noise=-45dB:d=2','-f','null','-']);
  const sum=pattern=>[...decoded.stderr.matchAll(pattern)].reduce((total,match)=>total+Number(match[1]),0);
  const blackSeconds=sum(/black_duration:([\d.]+)/g),silenceSeconds=sum(/silence_duration:\s*([\d.]+)/g);
  const segments=[];let cursor=0;
  for(let index=0;index<inputs.length;index++){
    const input=inputs[index],length=input.clip.durationSeconds;onProgress(`核对原序列 ${index+1}/${inputs.length}`);
    const comparison=await run(ffmpeg,['-hide_banner','-nostdin','-v','info','-ss',String(cursor),'-t',String(length),'-i',output,'-i',input.file,
      '-filter_complex','[0:v]setpts=PTS-STARTPTS,scale=180:320:flags=area,crop=180:288:0:0,fps=30[a];[1:v]setpts=PTS-STARTPTS,scale=180:320:flags=area,crop=180:288:0:0,fps=30[b];[a][b]ssim=shortest=1',
      '-an','-f','null','-']);
    const matches=[...comparison.stderr.matchAll(/SSIM[^\n]*All:([\d.]+)/g)],ssim=Number(matches.at(-1)?.[1]);
    const audioArgs=['-hide_banner','-nostdin','-v','error'];
    const outAudio=await run(ffmpeg,[...audioArgs,'-ss',String(cursor),'-t',String(length),'-i',output,'-vn','-ac','1','-ar','4000','-f','s16le','-']);
    const clipAudio=await run(ffmpeg,[...audioArgs,'-i',input.file,'-t',String(length),'-vn','-ac','1','-ar','4000','-f','s16le','-']);
    const correlation=audioCorrelation(outAudio.stdout,clipAudio.stdout);
    const row={clipId:input.clip.id,sha256:input.sha256,start:cursor,duration:length,ssim,audioCorrelation:correlation,
      picturePassed:Number.isFinite(ssim)&&ssim>=.96,audioPassed:Number.isFinite(correlation)&&correlation>=.94,
      rawComparisonLog:comparison.stderr,audioEvidence:{rate:4000,channels:1,outputPcmBytes:outAudio.stdout.length,inputPcmBytes:clipAudio.stdout.length,
        outputPcmSha256:createHash('sha256').update(outAudio.stdout).digest('hex'),inputPcmSha256:createHash('sha256').update(clipAudio.stdout).digest('hex')}};segments.push(row);
    // Fail closed rather than accepting a different clip/order with matching
    // duration or container metadata. No threshold is relaxed automatically.
    if(!row.picturePassed||!row.audioPassed)throw Object.assign(new Error(`Original sequence mismatch at cut ${index+1}`),{evidence:row});cursor+=length;
  }
  for(const input of inputs)if(await fileStamp(input.file)!==input.version||await hashFile(input.file)!==input.sha256)throw new Error('Original input changed during local recovery review');
  if(await fileStamp(output)!==before||await hashFile(output)!==sha256)throw new Error('Original output changed during local recovery review');
  return {policy:'local-original-sequence-recovery-v1',fullDecode:true,sequenceMatches:segments.every(row=>row.picturePassed),audioMatches:segments.every(row=>row.audioPassed),
    sha256,duration,width,height,hasAudio,blackSeconds,silenceSeconds,duplicate:existingHashes.has(sha256),segments,
    raw:{probe:info,decodeLog:decoded.stderr,comparisonPolicy:'full decoded 30fps SSIM >= 0.96; audio correlation >= 0.94 within 120ms; no rendering'}};
}
