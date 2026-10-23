import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {createClipRemixService} from '../clip-remix-service.mjs';

test('actual service presents neutral generated titles and keeps manual names, IDs, approval and disk bytes', async () => {
  const dataDir=await fs.mkdtemp(path.join(os.tmpdir(),'wis-text-quality-'));
  const root=path.join(dataDir,'clip-remix');await fs.mkdir(root,{recursive:true});
  const file=path.join(root,'library.json');
  const source={id:'public-source',originalName:'后座喷zy.mp4',storedName:'fixture.mp4',visibility:'team',size:8,
    productCategory:'通用切片',durationSeconds:10,speechSegments:[{id:'ocr-7',label:'nae ee I} NV WZ \\ a',
      startSeconds:9,endSeconds:10,transcriptSource:'ocr',transcriptConfidence:null,boundaryConfidence:'high',requiresReview:false}]};
  const base={sourceId:source.id,name:'nae ee I} NV WZ a',startSeconds:9,endSeconds:10,durationSeconds:1,
    tags:['24小时供应线','ocr'],approvalSource:'continuous_clip_supply',createdByIds:['tester'],reviewStatus:'approved',visibility:'team'};
  const library={version:7,sources:[source],clips:[{...base,id:'generated'},
    {...base,id:'manual',metadataUpdatedAt:'2026-10-07T00:00:00Z'},
    {...base,id:'named',name:'人工产品镜',nameOrigin:'manual'}],folders:[],frameworks:[],autoJobs:[],renders:[]};
  const original=JSON.stringify(library);await fs.writeFile(file,original);
  const service=createClipRemixService({dataDir,readOnly:true,maxFileBytes:1e6,nowIso:()=>new Date().toISOString(),
    inspectMedia:async()=>({}),runFfmpeg:async()=>{throw Error('unexpected renderer');},
    materialCenter:{configured:false},cutter:{configured:false},
    jsonResponse:(res,status,body)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(body));}});
  await service.initialize();
  const server=http.createServer((req,res)=>service.route(req,res,new URL(req.url,'http://localhost'),{sub:'tester'})
    .catch(error=>{res.writeHead(500);res.end(error.message);}));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try {
    const response=await fetch(`http://127.0.0.1:${server.address().port}/api/remix/library?view=compact`);
    assert.equal(response.status,200);
    const body=await response.json(),clips=new Map(body.clips.map(clip=>[clip.id,clip]));
    assert.equal(clips.get('generated').name,'后座喷zy · 9–10秒');
    assert.equal(clips.get('generated').storedNameTitle,base.name);
    assert.equal(clips.get('generated').namePresentationOnly,true);
    assert.equal(clips.get('generated').textQuality.status,'noise');
    assert.equal(clips.get('generated').reviewStatus,'approved');
    assert.equal(clips.get('manual').name,base.name);
    assert.equal(clips.get('named').name,'人工产品镜');
    assert.equal(await fs.readFile(file,'utf8'),original);
  } finally {
    await new Promise(resolve=>server.close(resolve));
    await fs.rm(dataDir,{recursive:true,force:true});
  }
});
