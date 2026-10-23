// R2 bytes live on OSS; framework metadata is acknowledged only after MySQL.
async function checkpoint(env){
  const payload={id:crypto.randomUUID(),method:'checkpointR2Cache',args:[]};
  for(let attempt=0;attempt<2;attempt++){
    const response=await fetch(env.PINYING_SQL_GATEWAY+'/intelligence/creative_r2',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+env.PINYING_R2_TOKEN},body:JSON.stringify(payload),redirect:'manual',signal:AbortSignal.timeout(18000)});
    if(response.ok)return;
    if(response.status<500)break;
  }
  throw new Error('Media metadata could not be persisted');
}
export function mysqlMediaBucket(bucket,env){
  const multipart=value=>new Proxy(value,{get(target,name){const method=Reflect.get(target,name,target);if(typeof method!=='function')return method;return async(...args)=>{const result=await method.apply(target,args);if(['uploadPart','complete','abort'].includes(name))await checkpoint(env);return result;};}});
  return new Proxy(bucket,{get(target,name){const value=Reflect.get(target,name,target);if(typeof value!=='function')return value;return (...args)=>{if(name==='resumeMultipartUpload')return multipart(value.apply(target,args));return Promise.resolve(value.apply(target,args)).then(async result=>{if(['put','delete','createMultipartUpload'].includes(name))await checkpoint(env);return name==='createMultipartUpload'?multipart(result):result;});};}});
}
