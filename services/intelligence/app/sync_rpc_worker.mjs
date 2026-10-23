import {parentPort,workerData} from 'node:worker_threads';
const {configuration,route}=workerData;
const pending=new Map();

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
    const body=JSON.stringify({id:message.id,method:message.method,args:message.args});
    let failure;
    for(let attempt=0;attempt<2;attempt++) {
      try {
        const response=await fetch(configuration.url+'/'+route+'/'+configuration.scope,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+configuration.token},body,redirect:'manual',signal:AbortSignal.timeout(18000)});
        const data=await response.json();
        if(!response.ok){const error=new Error(data.error||'Private storage is unavailable');error.status=response.status;throw error;}
        publish(message,new TextEncoder().encode(JSON.stringify(data)),1);
        return;
      } catch(error) {
        failure=error;
        if(error.status&&error.status<500)break;
      }
    }
    throw failure;
  } catch(error) {
    publish(message,new TextEncoder().encode(JSON.stringify({error:error.message||'Private storage failed'})),3);
  }
});
