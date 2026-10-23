import {parentPort,workerData} from 'node:worker_threads';
const {configuration,route}=workerData;
const pending=new Map();
let session=null;

function publish(message,bytes,status) {
  const header=new Int32Array(message.buffer,0,4);
  Atomics.store(header,1,bytes.length);
  if(bytes.length>message.buffer.byteLength-16) {
    pending.set(message.id,{bytes,status});
    Atomics.store(header,0,2);
  } else {
    new Uint8Array(message.buffer,16,bytes.length).set(bytes);
    pending.delete(message.id);
    Atomics.store(header,0,status);
  }
  Atomics.notify(header,0);
}

parentPort.on('message',async message=>{
  try {
    if(message.resume) {
      const saved=pending.get(message.id);
      if(!saved)throw new Error('Storage response is no longer available');
      publish(message,saved.bytes,saved.status);
      return;
    }
    let targetRoute=route,payload;
    if(route==='compat') {
      if(message.method==='begin')session ||= crypto.randomUUID();
      if(session) {
        targetRoute='session';
        payload={id:message.id,session,control:message.method};
        if(message.method==='query'){payload.sql=message.args[0];payload.params=message.args[1]||[];}
        if(message.method==='batch'){payload.queries=message.args[0];}
      } else {
        if(!['query','batch'].includes(message.method))throw new Error('No active transaction');
        targetRoute='sql';payload={id:message.id,queries:message.method==='batch'?message.args[0]:[{sql:message.args[0],params:message.args[1]||[]}]};
      }
    } else payload=route==='sql'?{id:message.id,queries:message.method}:{id:message.id,method:message.method,args:message.args};
    const body=JSON.stringify(payload);
    let failure;
    for(let attempt=0;attempt<2;attempt++) {
      try {
        const timeout=message.asynchronous&&targetRoute==='documents'?90000:18000;
        const response=await fetch(configuration.url+'/'+targetRoute+'/'+configuration.scope,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+configuration.token},body,redirect:'manual',signal:AbortSignal.timeout(timeout)});
        let data=await response.json();
        if(!response.ok){const error=new Error(data.error||'Private storage is unavailable');error.status=response.status;throw error;}
        if(route==='compat'&&targetRoute==='sql'&&message.method==='query')data=data[0];
        if(route==='compat'&&['commit','rollback'].includes(message.method))session=null;
        publish(message,new TextEncoder().encode(JSON.stringify(data)),1);
        return;
      } catch(error) {
        failure=error;
        if(error.status&&error.status<500)break;
      }
    }
    throw failure;
  } catch(error) {
    if(route==='compat'&&message.method==='rollback')session=null;
    publish(message,new TextEncoder().encode(JSON.stringify({error:error.message||'Private storage failed'})),3);
  }
});
