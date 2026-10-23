import {readFileSync} from 'node:fs';
import {Worker} from 'node:worker_threads';
import {randomUUID} from 'node:crypto';

export function createSyncRpc(file, route='intelligence',override) {
  const configuration=override||JSON.parse(readFileSync(file,'utf8'));
  const endpoints=new Set(['http://brand-marketing-fd-026222-data-gateway:8080','http://brand-marketing-fd-026222-hub-storage-gateway:8080','http://brand-marketing-fd-026222-remix-storage-gateway:8080']);
  if(!endpoints.has(configuration.url) || !/^[a-z0-9_]+$/u.test(configuration.scope) || !configuration.token)throw new Error('Private storage configuration is invalid');
  // Worker threads inherit NODE_OPTIONS preloads independently of execArgv.
  // Storage workers must not recursively initialize the application's adapter.
  const worker=new Worker(new URL('./sync_rpc_worker.mjs',import.meta.url),{workerData:{configuration,route},execArgv:[],env:{...process.env,NODE_OPTIONS:''}});
  worker.unref();
  let closed=false;
  let asyncCalls=0;
  function call(method,args=[]) {
    if(closed)throw new Error('Storage is closed');
    const id=randomUUID();
    let buffer=new SharedArrayBuffer(16+512*1024);
    for(let attempt=0;attempt<3;attempt++) {
      const header=new Int32Array(buffer,0,4);
      worker.postMessage({id,method,args,buffer,resume:attempt>0});
      const waiting=Atomics.wait(header,0,0,45000);
      if(waiting==='timed-out')throw new Error('Private storage timed out');
      const status=Atomics.load(header,0),length=Atomics.load(header,1);
      if(status===2) {
        if(length>80*1024*1024)throw new Error('Storage response exceeds the processing limit');
        buffer=new SharedArrayBuffer(16+length);
        continue;
      }
      const body=JSON.parse(new TextDecoder().decode(new Uint8Array(buffer,16,length)));
      if(status!==1)throw new Error(body.error||'Private storage failed');
      return body;
    }
    throw new Error('Storage response could not be received');
  }
  async function callAsync(method,args=[]) {
    if(closed)throw new Error('Storage is closed');
    if(route==='compat')throw new Error('Compatibility transactions require ordered synchronous calls');
    asyncCalls++;worker.ref();
    const id=randomUUID();let buffer=new SharedArrayBuffer(16+512*1024);
    try{
      for(let attempt=0;attempt<3;attempt++){
        const header=new Int32Array(buffer,0,4);worker.postMessage({id,method,args,buffer,resume:attempt>0,asynchronous:true});
        const waiting=await Atomics.waitAsync(header,0,0,185000).value;
        if(waiting==='timed-out')throw new Error('Private storage timed out');
        const status=Atomics.load(header,0),length=Atomics.load(header,1);
        if(status===2){if(length>80*1024*1024)throw new Error('Storage response exceeds the processing limit');buffer=new SharedArrayBuffer(16+length);continue;}
        const body=JSON.parse(new TextDecoder().decode(new Uint8Array(buffer,16,length)));
        if(status!==1)throw new Error(body.error||'Private storage failed');return body;
      }
      throw new Error('Storage response could not be received');
    }finally{if(--asyncCalls===0)worker.unref();}
  }
  return {call,callAsync,close(){if(!closed){closed=true;worker.terminate();}}};
}
