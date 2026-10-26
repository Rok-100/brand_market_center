import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

// Execute the real preload in an isolated Linux child; it patches builtin fs.
async function run(t,scenario){
  if(process.platform==='win32'){t.skip('The deployed adapter uses Linux paths; run this suite in the remix container');return;}
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'metadata-cas-'));
  try{
    for(const file of ['metadata_files_mysql.mjs','text_delta.mjs'])await fs.copyFile(new URL(file,import.meta.url),path.join(root,file));
    await fs.writeFile(path.join(root,'sync_rpc.mjs'),'export const createSyncRpc=()=>globalThis.rpc;');
    const setup=`
      import fs from 'node:fs';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
      import {pathToFileURL} from 'node:url';
      const root=process.argv[1],file=root+'/data/library.json';
      const sha=data=>createHash('sha256').update(data).digest('hex');
      let doc={data:'{"count":0}',version:1};const calls=[];let writeGate=null;
      fs.mkdirSync(root+'/data',{recursive:true});
      fs.writeFileSync(root+'/config.json',JSON.stringify({rules:[{root:root+'/data',logicalRoot:'/data',connection:{scope:'fixture'}}]}));
      process.env.PINYING_METADATA_CONFIG_FILE=root+'/config.json';
      function call(method,args){calls.push(method);
        if(method==='listFiles')return [];
        if(method==='readFile')return {...doc,exists:true,sha256:sha(doc.data)};
        if(method==='statFile')return {version:doc.version,exists:true,sha256:sha(doc.data)};
        if(method==='writeFileDelta'){
          assert.equal(args[1],doc.version);const delta=args[2];assert.equal(delta.baseSha256,sha(doc.data));
          const before=Buffer.from(doc.data),parts=[];let end=0;
          for(const h of delta.hunks||[delta]){parts.push(before.subarray(end,h.prefix),Buffer.from(h.insert,'base64'));end=h.prefix+h.remove;}
          parts.push(before.subarray(end));doc={data:Buffer.concat(parts).toString(),version:doc.version+1};
          assert.equal(sha(doc.data),delta.sha256);return {version:doc.version,sha256:sha(doc.data)};
        }
        if(method==='writeFile'){
          if(args[1]!==doc.version)throw Error('Document changed during transaction');
          doc={data:args[2],version:doc.version+1};return {version:doc.version,sha256:sha(doc.data)};
        }
        throw Error('Unexpected RPC '+method);
      }
      globalThis.rpc={call,callAsync:async(method,args)=>{if(method==='writeFile'&&writeGate)await writeGate;return call(method,args);}};
      await import(pathToFileURL(root+'/metadata_files_mysql.mjs'));
      const api=globalThis[Symbol.for('pinying.metadata.document.v1')];
    `;
    const result=spawnSync(process.execPath,['--input-type=module','-e',setup+scenario,root],{encoding:'utf8',timeout:20000,env:{...process.env,NODE_OPTIONS:''}});
    assert.equal(result.status,0,result.stdout+'\n'+result.stderr);
  }finally{await fs.rm(root,{recursive:true,force:true});}
}

test('authoritative progress refresh cannot substitute its version for an older mutation snapshot',async t=>run(t,`
  const snapshot=await api.read(file);
  doc={data:'{"count":9}',version:2};
  await globalThis[Symbol.for('pinying.metadata.refresh.v1')](file);
  await assert.rejects(api.commit(file,snapshot,'{"count":1}'),{code:'METADATA_CONFLICT'});
  assert.equal(doc.data,'{"count":9}');assert.equal(doc.version,2);
  const fresh=await api.read(file);await api.commit(file,fresh,'{"count":10}');
  assert.equal(doc.version,3);assert.equal(await fs.promises.readFile(file,'utf8'),doc.data);
`));

test('in-flight progress GET queues behind commit, then reads the committed version',async t=>run(t,`
  const snapshot=await api.read(file);let release;writeGate=new Promise(resolve=>release=resolve);
  const committing=api.commit(file,snapshot,'{"count":1}');
  await new Promise(resolve=>setTimeout(resolve,0));
  const refreshing=globalThis[Symbol.for('pinying.metadata.refresh.v1')](file);
  release();await committing;await refreshing;
  assert.equal(doc.version,2);assert.equal(await fs.promises.readFile(file,'utf8'),'{"count":1}');
  const lastWrite=calls.lastIndexOf('writeFile');assert.ok(lastWrite<calls.lastIndexOf('statFile'));
`));

test('large document deltas use snapshot bytes after cache refresh',async t=>run(t,`
  doc={data:JSON.stringify({padding:'x'.repeat(1100000),count:0}),version:1};
  const snapshot=await api.read(file),next=snapshot.data.replace('"count":0','"count":1');
  await globalThis[Symbol.for('pinying.metadata.refresh.v1')](file);
  await api.commit(file,snapshot,next);
  assert.ok(calls.includes('writeFileDelta'));assert.equal(doc.data,next);assert.equal(doc.version,2);
`));
