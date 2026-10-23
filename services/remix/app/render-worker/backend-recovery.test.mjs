import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {RECOVERY_TARGETS,RECOVERY_VERSION,inspectRecoveryTarget,buildRecoveryVariant,applyRecoveryReceipt,commitRecoveryRegistration,digest} from './reserved-output-recovery.mjs';
import {clipBytesSequence} from './output-sequence-dedup.mjs';
import {automaticEffectsAllowed} from './automation-preflight.mjs';
import {createRenderInputHashes} from './render-input-hashes.mjs';
import {createRegistrationJournal,readRegistrationJournals,registrationDigest} from './render-registration-journal.mjs';
import {audioCorrelation,measureRecoveryCandidates,hashMedia,command,reviewOriginalOutput,limitedFfmpegArgs} from './recovery-local-media.mjs';
import {createReadonlyInputResolver} from './recovery-input-resolver.mjs';
import {journalContext,inspectJournalRecovery,verifyJournalFiles,applyJournalRecovery} from './journal-output-recovery.mjs';

const hash=value=>createHash('sha256').update(String(value)).digest('hex');
function fixture(){
  const library={sources:[],clips:[],autoJobs:[],frameworks:[],renders:[],serviceNotifications:[]},roles=['hook','pain','solution','proof','cta'];
  for(const target of RECOVERY_TARGETS){let job=library.autoJobs.find(row=>row.id===target.jobId);
    if(!job){job={id:target.jobId,name:target.jobId,createdById:'owner',productCategory:'黑晶面膜',frameworkId:'hook-pain-solution-proof-cta',status:'active',nextRunAt:null,
      autoReturnAfterApproval:true,qianchuanDelivery:{enabled:true,targets:[{planId:'unchanged'}]},sequenceReservations:[],runs:[{id:target.runId,status:'awaiting_review',automaticReviewHold:{reason:'OUTPUT_SEQUENCE_PENDING'},targetCount:10,targetDurationSeconds:5,slotSelections:{},renderIds:[],generatedCount:0,stageReports:[]}]};library.autoJobs.push(job);}
    const run=job.runs[0],clips=roles.map((role,index)=>{const id=`${target.renderId}-${target.variantId}-${index}`,source={id:`s-${id}`,storedName:`s-${id}.mp4`,productCategory:'黑晶面膜'};
      const clip={id,sourceId:source.id,storedName:`${id}.mp4`,contentSha256:hash(id),role,durationSeconds:1,startSeconds:0,endSeconds:1,reviewStatus:'approved',productCategory:'黑晶面膜'};
      library.sources.push(source);library.clips.push(clip);(run.slotSelections[role]??=[]).push(id);return clip;});
    job.sequenceReservations.push({...clipBytesSequence(clips),runId:target.runId,renderId:target.renderId,variantId:target.variantId,status:'reserved',createdAt:'2026-10-07T06:10:00Z'});
  }return library;
}
function receiptFor(library){return {version:RECOVERY_VERSION,items:RECOVERY_TARGETS.map(target=>{const plan=inspectRecoveryTarget(library,target),evidence={fullDecode:true,sequenceMatches:true,audioMatches:true,sha256:hash(target.renderId+target.variantId),duration:5,width:1080,height:1920,hasAudio:true,blackSeconds:0,silenceSeconds:0,duplicate:false};
  return {target,contextDigest:plan.contextDigest,binding:plan.binding,variant:buildRecoveryVariant(plan,evidence,'2026-10-07T08:00:00Z')};})};}

test('registers only three original outputs, preserves delivery config and holds all automatic effects',()=>{
  const library=fixture(),before=digest(library),receipt=receiptFor(library),result=applyRecoveryReceipt(library,receipt,'2026-10-07T09:00:00Z');
  assert.equal(digest(library),before);assert.equal(result.changed,3);assert.equal(result.library.renders.length,2);assert.equal(result.library.serviceNotifications.length,0);
  for(const job of result.library.autoJobs){assert.deepEqual(job.qianchuanDelivery,library.autoJobs.find(row=>row.id===job.id).qianchuanDelivery);assert.equal(job.status,'active');assert.equal(job.runs[0].automaticReviewHold.reason,'RECOVERY_REGISTRATION_ONLY');}
  for(const render of result.library.renders)assert.equal(automaticEffectsAllowed(result.library.autoJobs.find(row=>row.id===render.automation.jobId),render,true),false);
});
test('recovery preserves the prior scheduled time as explicit resumption evidence',()=>{
  const library=fixture();library.autoJobs[0].nextRunAt='2026-10-08T01:00:00Z';const result=applyRecoveryReceipt(library,receiptFor(library),'now');
  assert.equal(result.library.renders.find(r=>r.id===RECOVERY_TARGETS[0].renderId).recoveryRegistration.priorNextRunAt,'2026-10-08T01:00:00Z');
});
test('readback/restart and retry are idempotent without duplicated registrations or reservations',()=>{
  const library=fixture(),receipt=receiptFor(library),first=applyRecoveryReceipt(library,receipt,'t1').library;
  const second=applyRecoveryReceipt(JSON.parse(JSON.stringify(first)),receipt,'t2');assert.equal(second.changed,0);assert.equal(digest(second.library),digest(first));
});
test('CAS conflict makes exactly one write attempt and preserves original authority',async()=>{
  const original=fixture(),receipt=receiptFor(original),before=digest(original);let writes=0,backups=0;
  await assert.rejects(commitRecoveryRegistration({receipt,readAuthority:async()=>({data:original,version:1}),backup:async()=>backups++,writeAuthority:async()=>{writes++;throw Error('CAS conflict');}}),/CAS conflict/);
  assert.equal(writes,1);assert.equal(backups,1);assert.equal(digest(original),before);
});
test('unknown commit result is recovered by readback, without another write or notification',async()=>{
  let authority=fixture(),version=1,writes=0;const receipt=receiptFor(authority),readAuthority=async()=>({data:structuredClone(authority),version});
  const options={receipt,readAuthority,backup:async()=>{},writeAuthority:async(expected,next)=>{assert.equal(expected,version);authority=next;version++;writes++;throw Error('response lost');}};
  await assert.rejects(commitRecoveryRegistration(options),/response lost/);const retry=await commitRecoveryRegistration(options);assert.equal(retry.status,'already_registered');assert.equal(writes,1);assert.equal(authority.serviceNotifications.length,0);
});
test('failure before commit does not mutate source state or release pending reservations',()=>{
  const library=fixture(),receipt=receiptFor(library),before=digest(library);receipt.items[2].variant.contentSha256=hash('tampered');
  assert.throws(()=>applyRecoveryReceipt(library,receipt,'now'));assert.equal(digest(library),before);assert.ok(library.autoJobs.every(j=>j.sequenceReservations.every(r=>r.status==='reserved')));
});
test('concurrent owner, approval, selection, target or delivery change rejects old receipt',()=>{
  for(const mutate of [l=>l.autoJobs[0].createdById='other',l=>l.clips[0].reviewStatus='changes_requested',l=>l.autoJobs[0].runs[0].targetCount++,l=>l.autoJobs[0].qianchuanDelivery.targets.push({planId:'new'}),l=>l.clips[0].startSeconds=.5]){
    const library=fixture(),receipt=receiptFor(library);mutate(library);assert.throws(()=>applyRecoveryReceipt(library,receipt,'now'));
  }
});
test('missing, reordered, ambiguous or conflicting sequence cannot be restored',()=>{
  for(const mutate of [l=>l.autoJobs[0].sequenceReservations=[],l=>l.autoJobs[0].sequenceReservations[0].intervals.reverse(),l=>l.clips.push({...l.clips[0],id:l.clips[0].id}),l=>l.renders.push({id:RECOVERY_TARGETS[0].renderId,variants:[{id:'1',contentSha256:hash('wrong')}]})]){
    const library=fixture();mutate(library);assert.throws(()=>inspectRecoveryTarget(library,RECOVERY_TARGETS[0]));
  }
});
test('resumed/in-flight runs, revoked sources and removed recovery holds never pass manual registration',()=>{
  for(const mutate of [l=>l.autoJobs[0].runs[0].status='generating',l=>l.autoJobs[0].runs[0].resumeRequestedAt='now',l=>l.sources[0].revoked=true,l=>l.sources[0].deliveryBlocked=true,l=>l.clips[0].deletedAt='now']){
    const library=fixture(),receipt=receiptFor(library);mutate(library);assert.throws(()=>applyRecoveryReceipt(library,receipt,'now'));}
  const library=fixture(),receipt=receiptFor(library),applied=applyRecoveryReceipt(library,receipt,'now').library;
  delete applied.renders[0].recoveryRegistration;assert.throws(()=>applyRecoveryReceipt(applied,receipt,'later'));
});
test('no stat-only or forged incomplete local PASS can create an approved recovery',()=>{
  const plan=inspectRecoveryTarget(fixture(),RECOVERY_TARGETS[0]);
  assert.throws(()=>buildRecoveryVariant(plan,{fullDecode:true},'now'));
  assert.throws(()=>buildRecoveryVariant(plan,{fullDecode:true,sequenceMatches:true,audioMatches:true,duration:5,width:1080,height:1920,hasAudio:true,blackSeconds:0,silenceSeconds:0,duplicate:true,sha256:hash('x')},'now'));
});
test('newly measured cut hashes reconstruct without changing original source metadata',()=>{
  const library=fixture(),target=RECOVERY_TARGETS[0],plan=inspectRecoveryTarget(library,target),measuredHashes=plan.inputHashes;
  for(const clip of plan.clips)delete clip.contentSha256;
  assert.throws(()=>inspectRecoveryTarget(library,target));const measured=inspectRecoveryTarget(library,target,{measuredHashes});assert.equal(measured.sequence.key,plan.sequence.key);assert.ok(measured.clips.every(c=>c.contentSha256===undefined));
});

test('same-version concurrent pre-render reads share one hash; changed file and failure never reuse it',async()=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'wis-input-hash-')),file=path.join(directory,'input.mp4');
  try{await fs.writeFile(file,'first');let reads=0;const cached=createRenderInputHashes(async f=>{reads++;return hashMedia(f);});
    const values=await Promise.all([cached(file),cached(file)]);assert.equal(values[0],values[1]);assert.equal(reads,1);
    await fs.writeFile(file,'other-length');assert.notEqual(await cached(file),values[0]);assert.equal(reads,2);
    let attempts=0;const retry=createRenderInputHashes(async f=>{if(++attempts===1)throw Error('read failed');return hashMedia(f);});await assert.rejects(retry(file));assert.equal(await retry(file),await hashMedia(file));assert.equal(attempts,2);
  }finally{await fs.rm(directory,{recursive:true,force:true});}
});
test('modification while hashing fails and a fresh post-render raw hash detects a later change',async()=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'wis-input-change-')),file=path.join(directory,'input.mp4');
  try{await fs.writeFile(file,'first');const changing=createRenderInputHashes(async f=>{const hash=await hashMedia(f);await fs.writeFile(f,'changed-during-read');return hash;});await assert.rejects(changing(file),{code:'MEDIA_CHANGED'});
    const cached=createRenderInputHashes(hashMedia),before=await cached(file);await fs.writeFile(file,'changed-after-render');assert.notEqual(await hashMedia(file),before);
  }finally{await fs.rm(directory,{recursive:true,force:true});}
});
test('registration journal survives restart and detects corrupted receipt',async()=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'wis-journal-'));
  try{const render={id:RECOVERY_TARGETS[0].renderId,automation:{jobId:RECOVERY_TARGETS[0].jobId},variants:[{id:'1'}]};await createRegistrationJournal(directory)(render);await createRegistrationJournal(directory)(render);
    const files=await fs.readdir(directory);assert.equal(files.length,1);const record=JSON.parse(await fs.readFile(path.join(directory,files[0]),'utf8'));assert.equal(record.renderSha256,registrationDigest(render));assert.equal((await readRegistrationJournals(directory,render.id)).length,1);
    record.render.variants[0].id='changed';await fs.writeFile(path.join(directory,files[0]),JSON.stringify(record));await assert.rejects(createRegistrationJournal(directory)(render));await assert.rejects(readRegistrationJournals(directory,render.id));
  }finally{await fs.rm(directory,{recursive:true,force:true});}
});
test('all FFmpeg decoders, encoders and filter graphs are constrained to one thread',()=>{
  const args=limitedFfmpegArgs(['-i','first.mp4','-i','second.mp4','-f','null','-']);
  assert.deepEqual(args.slice(0,4),['-filter_threads','1','-filter_complex_threads','1']);
  for(let i=0;i<args.length;i++)if(args[i]==='-i')assert.deepEqual(args.slice(i-2,i),['-threads','1']);assert.deepEqual(args.slice(-3),['-threads','1','-']);
});
test('audio sequence comparison accepts original samples and rejects a different track',()=>{
  const a=Buffer.alloc(8000),b=Buffer.alloc(8000);for(let i=0;i<4000;i++){a.writeInt16LE(Math.round(Math.sin(i*.21)*15000),i*2);b.writeInt16LE(Math.round(Math.sin(i*.59)*15000),i*2);}
  assert.ok(audioCorrelation(a,a)>.999);assert.ok(audioCorrelation(a,b)<.2);
});
test('bounded candidate hashing never scans outside the original selected-duration pool',async()=>{
  const library=fixture(),directory=await fs.mkdtemp(path.join(os.tmpdir(),'wis-measure-'));let calls=0;
  try{for(const clip of library.clips){delete clip.contentSha256;await fs.writeFile(path.join(directory,clip.storedName),clip.id);}library.clips.push({id:'outside',durationSeconds:1,reviewStatus:'approved',storedName:'absent.mp4'});
    const measured=await measureRecoveryCandidates(library,{clipsDir:directory,hashFile:async file=>{calls++;return hashMedia(file);}});assert.equal(calls,15);assert.equal(Object.keys(measured).length,15);assert.equal(measured.outside,undefined);
    await assert.rejects(measureRecoveryCandidates(library,{clipsDir:directory,limit:1}));
  }finally{await fs.rm(directory,{recursive:true,force:true});}
});

test('existing recovered input is located by exact sidecar bindings and bytes, without creating missing originals',async()=>{
  const library=fixture(),clip=library.clips[0],directory=await fs.mkdtemp(path.join(os.tmpdir(),'wis-existing-cache-'));
  try{const clipsDir=path.join(directory,'clips'),playbackDir=path.join(directory,'cache');await fs.mkdir(clipsDir);await fs.mkdir(playbackDir);
    const key=hash('cache-key'),file=path.join(playbackDir,key+'.mp4');await fs.writeFile(file,clip.id);
    const receipt={key,kind:'reconstructed-render-input',clipId:clip.id,sourceId:clip.sourceId,startSeconds:clip.startSeconds,endSeconds:clip.endSeconds,size:Buffer.byteLength(clip.id),sha256:clip.contentSha256};
    await fs.writeFile(path.join(playbackDir,key+'.json'),JSON.stringify(receipt));
    const resolve=createReadonlyInputResolver({clipsDir,playbackDir,library}),result=await resolve(clip,{expectedHashes:[clip.contentSha256]});assert.equal(result.file,file);assert.equal(await hashMedia(file),clip.contentSha256);
    await assert.rejects(resolve(clip,{expectedHashes:[hash('other')]}),{code:'ENOENT'});await assert.rejects(resolve(clip,{expectedHashes:[clip.contentSha256],cacheFile:'../escape.mp4'}));
    assert.deepEqual(await fs.readdir(clipsDir),[]);receipt.sourceId='different';await fs.writeFile(path.join(playbackDir,key+'.json'),JSON.stringify(receipt));
    await assert.rejects(createReadonlyInputResolver({clipsDir,playbackDir,library})(clip,{expectedHashes:[clip.contentSha256]}),{code:'ENOENT'});
  }finally{await fs.rm(directory,{recursive:true,force:true});}
});

function journalRecords(library){const receipt=receiptFor(library);return receipt.items.slice(1).map(item=>{
  const job=library.autoJobs.find(j=>j.id===item.target.jobId),run=job.runs[0];
  const render={id:item.target.renderId,createdById:job.createdById,productCategory:job.productCategory,templateId:job.frameworkId,visibility:'team',automation:{jobId:job.id,runId:run.id},registrationContext:journalContext(job,run),variants:[item.variant]};
  return {schemaVersion:1,kind:'render-registration-journal',renderSha256:registrationDigest(render),render};});}
for(const completed of [1,2])test(`crash immediately after output ${completed} recovers only durable approvals and stays held across restart`,async()=>{
  const library=fixture(),records=journalRecords(library).slice(0,completed),target=RECOVERY_TARGETS[1],directory=await fs.mkdtemp(path.join(os.tmpdir(),'wis-crash-replay-'));
  try{for(const record of records)await createRegistrationJournal(directory)(record.render);
    const recovered=await readRegistrationJournals(directory,target.renderId),plan=inspectJournalRecovery(library,target.jobId,target.runId,recovered,()=>true);assert.equal(plan.items.length,completed);
    const result=applyJournalRecovery(library,target.jobId,target.runId,recovered,()=>true,'now');assert.equal(result.changed,completed);assert.equal(result.library.renders.length,1);
    const render=result.library.renders[0],job=result.library.autoJobs.find(j=>j.id===target.jobId);assert.equal(automaticEffectsAllowed(job,render,true),false);assert.equal(job.runs[0].generatedCount,completed);
    assert.equal(job.sequenceReservations.filter(r=>r.status==='recorded').length,completed);assert.equal(job.sequenceReservations.filter(r=>r.status==='reserved').length,2-completed);
    const again=applyJournalRecovery(JSON.parse(JSON.stringify(result.library)),target.jobId,target.runId,recovered,()=>true,'later');assert.equal(again.changed,0);assert.equal(registrationDigest(again.library),registrationDigest(result.library));
    assert.equal(library.renders.length,0);
  }finally{await fs.rm(directory,{recursive:true,force:true});}
});
test('journal replay rechecks authority, source approval, bindings, sequence and unchanged output bytes',async()=>{
  for(const mutate of [l=>l.autoJobs[1].status='paused',l=>l.autoJobs[1].runs[0].status='cancelled',l=>l.autoJobs[1].createdById='changed',l=>l.autoJobs[1].qianchuanDelivery.targets.push({planId:'new'}),l=>l.clips[5].disabled=true,l=>l.clips[5].endSeconds=.5,l=>l.autoJobs[1].sequenceReservations[0].key='wrong']){
    const library=fixture(),records=journalRecords(library);mutate(library);assert.throws(()=>inspectJournalRecovery(library,RECOVERY_TARGETS[1].jobId,RECOVERY_TARGETS[1].runId,records,()=>true));}
  const library=fixture(),records=journalRecords(library).slice(0,1),target=RECOVERY_TARGETS[1];assert.throws(()=>inspectJournalRecovery(library,target.jobId,target.runId,records,()=>false));
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'wis-journal-media-'));
  try{const plan=inspectJournalRecovery(library,target.jobId,target.runId,records),item=plan.items[0];await fs.writeFile(path.join(directory,item.variant.storedName),target.renderId+target.variantId);
    for(const clip of item.clips)await fs.writeFile(path.join(directory,clip.storedName),clip.id);
    const checked=await verifyJournalFiles(plan,{outputsDir:directory,clipsDir:directory,hashFile:hashMedia});await checked.assertUnchanged();
    await fs.writeFile(path.join(directory,item.variant.storedName),'changed');await assert.rejects(checked.assertUnchanged());await assert.rejects(verifyJournalFiles(plan,{outputsDir:directory,clipsDir:directory,hashFile:hashMedia}));
  }finally{await fs.rm(directory,{recursive:true,force:true});}
});

test('real FFmpeg local review decodes and compares existing media without generating a replacement',async()=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'wis-recovery-media-'));
  try{
    const source=path.join(directory,'source.mp4'),output=path.join(directory,'original.mp4');
    await command('ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','testsrc2=size=1080x1920:rate=30','-f','lavfi','-i','sine=frequency=431:sample_rate=48000','-t','1.2','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-c:a','aac','-movflags','+faststart',source]);
    await fs.copyFile(source,output);const sha=await hashMedia(source),before=await hashMedia(output);
    const plan={storedName:'original.mp4',clips:[{id:'original-cut',storedName:'source.mp4',durationSeconds:1.2}],inputHashes:{'original-cut':sha}};
    const evidence=await reviewOriginalOutput(plan,{outputsDir:directory,clipsDir:directory});
    assert.equal(evidence.fullDecode,true);assert.equal(evidence.sequenceMatches,true);assert.equal(evidence.audioMatches,true);assert.equal(evidence.sha256,before);assert.equal(evidence.width,1080);assert.equal(evidence.height,1920);assert.equal(await hashMedia(output),before);
    assert.deepEqual((await fs.readdir(directory)).sort(),['original.mp4','source.mp4']);
  }finally{await fs.rm(directory,{recursive:true,force:true});}
});
