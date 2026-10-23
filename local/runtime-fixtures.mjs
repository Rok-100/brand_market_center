// Local simulation adapter. Mounted only by the local Compose configuration.
import Module from 'node:module';
import {appendFileSync} from 'node:fs';
if(process.env.LOCAL_SIMULATION!=='1') throw new Error('Local simulation flag required');
const originalFetch=globalThis.fetch;
globalThis.fetch=(input,options)=>{
  const url=new URL(typeof input==='string'||input instanceof URL?input:input.url);
  if(url.hostname==='open.feishu.cn') {
    url.protocol='http:';url.host='fixtures:3000';
    return originalFetch(url,options);
  }
  return originalFetch(input,options);
};
const load=Module._load;
Module._load=function(specifier,parent,...rest){
  const value=load.call(this,specifier,parent,...rest);
  if(specifier==='./mysql' && parent?.filename.includes('/modules/dashboard/') && !value.localQueryCapture){
    const execute=value.executeDirectSql;
    value.executeDirectSql=async(sql,...args)=>{
      appendFileSync('/app/data/local-queries.ndjson',JSON.stringify({sql})+'\n');
      return execute(sql,...args);
    };
    value.localQueryCapture=true;
  }
  return value;
};
