// Local workflow fixture. No external AI provider is called.
const fs = require('node:fs/promises');
const path = require('node:path');
const {execFile} = require('node:child_process');
const {promisify} = require('node:util');
const exec = promisify(execFile);
module.exports = async function(job, {saveJob, log, outputRoot, preserveTasks=false, taskIds=[], buildKocPreview}) {
  if (process.env.LOCAL_SIMULATION !== '1') throw new Error('Local simulation is disabled');
  job.localSimulation = true;
  job.status = 'running';
  job.outputDir = preserveTasks && job.outputDir ? job.outputDir : path.join(outputRoot, 'local-simulation', job.id);
  await fs.mkdir(job.outputDir, {recursive:true});
  const count = Math.max(1, Math.min(3, Number(job.config.videoCount) || 1));
  if (!preserveTasks) job.tasks = Array.from({length:count}, (_,i)=>({index:i+1,title:`【本机模拟】测试视频 ${i+1}`,status:'queued',localSimulation:true}));
  const selected = job.tasks.filter(task => !preserveTasks || (task.selected !== false && (!taskIds.length || taskIds.includes(task.id))));
  if (!selected.length) throw new Error('No selected local simulation tasks');
  log(job, '本机模拟：使用 FFmpeg 生成测试视频，不调用真实 AI 服务。');
  await saveJob(job);
  for (const task of selected) {
    task.localSimulation = true;
    task.status = 'running';
    await saveJob(job);
    task.localPath = path.join(job.outputDir, `local-simulation-${task.index}.mp4`);
    const duration = job.workflow === 'koc' ? Number(task.duration) : 3;
    if (!(duration > 0 && duration <= 60)) throw new Error('Invalid local simulation clip duration');
    await exec('ffmpeg', ['-hide_banner','-loglevel','error','-y','-f','lavfi','-i',
      'testsrc2=size=360x640:rate=24','-f','lavfi','-i','sine=frequency=440:sample_rate=44100',
      '-t',String(duration),'-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-c:a','aac',
      '-movflags','+faststart',task.localPath], {timeout:60000,maxBuffer:1024*1024});
    task.status = 'success';
    task.url = `/api/file?path=${encodeURIComponent(task.localPath)}`;
    task.quality = {localSimulation:true, note:'测试画面，仅验证本机流程'};
    await saveJob(job);
  }
  job.status = job.workflow === 'koc' ? 'finalizing' : 'success';
  const total = job.tasks.filter(task=>task.selected!==false).length;
  const success = job.tasks.filter(task=>task.selected!==false && task.status==='success').length;
  job.summary = {success,failed:0,total,ready:success,playable:success,reviewRequired:0};
  if (job.workflow === 'koc') {
    if (!buildKocPreview) throw new Error('Original KOC merger required');
    await buildKocPreview(job);
    if (!job.finalVideoValidation?.ok) throw new Error('Original KOC media validation failed');
    job.finalDelivery = {requested:false,status:'local_only',localSimulation:true};
    job.actionRequired = '【本机模拟】完整测试视频已生成并可下载；未调用真实 AI 或自动回传。';
    job.status = 'success';
  }
  job.updatedAt = new Date().toISOString();
  log(job, '本机测试视频生成完成。');
  await saveJob(job);
};
