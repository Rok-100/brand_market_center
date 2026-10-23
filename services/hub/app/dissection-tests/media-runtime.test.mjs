import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {runProcess} from '../dissection-ai.mjs';
test('packaged media tools encode, probe and validate a continuous timeline',{skip:!process.env.DISSECTION_MEDIA_BIN},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'dissection-media-'));
  try{const file=join(dir,'sample.mp4');await runProcess('ffmpeg',['-y','-v','error','-f','lavfi','-i','color=c=blue:s=160x120:r=8','-f','lavfi','-i','sine=frequency=440:sample_rate=44100','-t','2','-c:v','libx264','-c:a','aac','-movflags','+faststart',file]);
    assert.equal(readFileSync(file).subarray(4,8).toString(),'ftyp');
    const probe=JSON.parse(await runProcess('ffprobe',['-v','error','-protocol_whitelist','file,pipe','-show_format','-show_streams','-of','json',file]));
    assert.equal(probe.streams.filter(s=>s.codec_type==='video').length,1);assert.equal(probe.streams.filter(s=>s.codec_type==='audio').length,1);
    const duration=Number(probe.format.duration);assert.ok(duration>=2&&duration<=2.2);
    const result={output:[{'时间范围':'00:00.000-00:02.000','画面描述':'蓝色画面','脚本':'','场景':'纯色','镜头':{'景别':'全景'}}]};
    const validation=JSON.parse(await runProcess('python3',['/app/cutter/validate.py'],{input:JSON.stringify({result,duration})}));assert.equal(validation.results.length,1);assert.equal(validation.results[0].scene_description,'蓝色画面');
    result.output[0]['时间范围']='00:01.000-00:02.000';await assert.rejects(runProcess('python3',['/app/cutter/validate.py'],{input:JSON.stringify({result,duration})}),/校验失败/);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
