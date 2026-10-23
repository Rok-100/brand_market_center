import {mkdirSync,existsSync,readFileSync,mkdtempSync,renameSync,rmSync} from 'node:fs';
import {join,resolve,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {runProcess} from './dissection-ai.mjs';
import {ensure} from './dissection-store.mjs';

export class DissectionPosterCache{
  constructor({root,download,run=runProcess}){this.root=resolve(root);mkdirSync(this.root,{recursive:true,mode:0o700});this.download=download;this.run=run;this.pending=new Map();}
  file(job){return join(this.root,createHash('sha256').update(job.sourceKey).digest('hex')+'.jpg');}
  async ensure(job,originalFile){
    const target=this.file(job);if(existsSync(target))return target;
    if(this.pending.has(job.sourceKey))return this.pending.get(job.sourceKey);
    const operation=this.generate(job,originalFile,target).finally(()=>this.pending.delete(job.sourceKey));this.pending.set(job.sourceKey,operation);return operation;
  }
  async generate(job,originalFile,target){
    const temporary=mkdtempSync(join(this.root,'work-'));
    try{
      const original=originalFile||join(temporary,'original.mp4');if(!originalFile)await this.download(job,original);
      const output=join(temporary,'preview.jpg');
      await this.run('ffmpeg',['-y','-v','error','-threads','2','-protocol_whitelist','file,pipe','-ss','0.5','-i',original,'-frames:v','1','-an','-vf',"scale='min(640,iw)':-2",'-q:v','3','-f','image2','-update','1',output],{timeout:60000});
      const bytes=readFileSync(output);ensure(bytes.length>100&&bytes.length<=2*1024*1024&&bytes[0]===255&&bytes[1]===216,'视频封面提取失败',502);
      renameSync(output,target);return target;
    }finally{ensure(dirname(temporary)===this.root,'封面临时目录不匹配',500);rmSync(temporary,{recursive:true,force:true});}
  }
}
