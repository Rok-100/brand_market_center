import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,copyFileSync,readFileSync} from 'node:fs';
import {join,dirname,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {runProcess} from '../dissection-ai.mjs';
import {DissectionPosterCache} from '../dissection-poster.mjs';
test('a real JPEG preview is extracted once and reused across manager tasks and restarts',{skip:!process.env.DISSECTION_MEDIA_BIN&&process.platform!=='win32'},async()=>{
  const root=mkdtempSync(join(tmpdir(),'dissection-poster-test-'));
  try{
    const original=join(root,'source.mp4');await runProcess('ffmpeg',['-y','-v','error','-f','lavfi','-i','color=c=blue:s=160x120:r=8','-t','2','-c:v','libx264',original]);
    let downloads=0;const options={root:join(root,'posters'),download:async(_job,file)=>{downloads++;copyFileSync(original,file)}};
    const cache=new DissectionPosterCache(options),a={id:'manager-a',sourceKey:'video:same'},b={id:'manager-b',sourceKey:a.sourceKey};
    const [one,two]=await Promise.all([cache.ensure(a),cache.ensure(b)]);assert.equal(one,two);assert.equal(downloads,1);
    const bytes=readFileSync(one);assert.equal(bytes[0],255);assert.equal(bytes[1],216);
    const metadata=JSON.parse(await runProcess('ffprobe',['-v','error','-show_streams','-of','json',one]));assert.equal(metadata.streams[0].codec_name,'mjpeg');assert.equal(metadata.streams[0].width,160);
    assert.equal(await new DissectionPosterCache(options).ensure(b),one);assert.equal(downloads,1);
    assert.equal(dirname(cache.file({sourceKey:'../../outside'})),resolve(options.root));
  }finally{assert.equal(dirname(root),resolve(tmpdir()));rmSync(root,{recursive:true,force:true});}
});
