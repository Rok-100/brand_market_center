// Offline FFmpeg verification: no LibTV calls and no cloud uploads.
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const server = require('../server.js');
(async () => {
  await server.ensureRemixMediaTools();
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'koc-media-'));
  try {
    const ffmpeg = server.resolveMediaTool('ffmpeg');
    const ffprobe = server.resolveMediaTool('ffprobe');
    for (const [index, color, duration, sampleRate] of [[1, 'red', 4, 44100], [2, 'blue', 5, 32000]]) {
      execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', `color=c=${color}:s=180x320:r=24`, '-f', 'lavfi', '-i', `sine=frequency=440:sample_rate=${sampleRate}`, '-t', String(duration), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', path.join(root, `${index}.mp4`)]);
    }
    const job = { outputDir: root, id: 'offline-media-check', taskName: 'fixture', config: { productName: 'fixture' }, tasks: [2, 1].map(index => ({ index, status: 'success', localPath: path.join(root, `${index}.mp4`) })) };
    assert.equal(await server.buildKocPreview(job), true);
    assert.equal(job.finalVideoValidation.ok, true);
    assert.ok(Math.abs(job.finalVideoDuration - 9) < 0.2);
    const probe = JSON.parse(execFileSync(ffprobe, ['-v', 'error', '-show_streams', '-of', 'json', job.finalVideoPath], { encoding: 'utf8' }));
    assert.ok(probe.streams.some(stream => stream.codec_type === 'video'));
    assert.ok(probe.streams.some(stream => stream.codec_type === 'audio'));
    // Decode across the real AAC sample-rate change, not just the first frame.
    execFileSync(ffmpeg, ['-v', 'error', '-xerror', '-i', job.finalVideoPath, '-f', 'null', '-']);
    const audio = probe.streams.find(stream => stream.codec_type === 'audio');
    const video = probe.streams.find(stream => stream.codec_type === 'video');
    assert.equal(audio.sample_rate, '48000');
    assert.ok(Math.abs(Number(audio.duration) - Number(video.duration)) < 0.2);
    // Inspect actual pixels before and after the cut to verify clip order.
    for (const [second, channel] of [[1, 0], [6, 2]]) {
      const pixels = execFileSync(ffmpeg, ['-v', 'error', '-ss', String(second), '-i', job.finalVideoPath, '-frames:v', '1', '-vf', 'scale=1:1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
      assert.ok(pixels[channel] > 180 && pixels[(channel + 1) % 3] < 40);
    }
    console.log('Offline FFmpeg integration passed: 44.1kHz + 32kHz clips decode continuously with complete 48kHz audio');
  } finally { await fsp.rm(root, { recursive: true, force: true }); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
