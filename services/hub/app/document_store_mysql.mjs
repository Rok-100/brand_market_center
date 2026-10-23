import {createSyncRpc} from './sync_rpc.mjs';
import {textDelta,deltaTransportBytes} from './text_delta.mjs';

export function createDocumentStore(file) {
  const rpc=createSyncRpc(process.env.PINYING_DOCUMENT_CONFIG_FILE||'/run/secrets/pinying-documents.json','documents');
  return versionedDocumentStore(rpc,file);
}

export function versionedDocumentStore(rpc,file) {
  let cached=null,text=null,sourceIndex=null,indexVersion=null,checkedAt=0,asyncRead=null;
  function refresh(){
    const value=cached?rpc.call('readTextIfChanged',[file,cached.version]):rpc.call('readFile',[file]);
    if(!value.unchanged){text=value.data;cached={...value,data:value.exists?JSON.parse(text):null};}
    checkedAt=Date.now();
    return cached;
  }
  async function refreshAsync(){
    const value=cached?await rpc.callAsync('readTextIfChanged',[file,cached.version]):await rpc.callAsync('readFile',[file]);
    if(!value.unchanged&&(!cached||value.version>=cached.version)){text=value.data;cached={...value,data:value.exists?JSON.parse(text):null};}
    checkedAt=Date.now();return cached;
  }
  return {
    snapshot(){
      return structuredClone(refresh());
    },
    async snapshotAsync(){
      // Share only an in-flight read. Each caller still gets its own snapshot;
      // writes retain their existing version check and never use a TTL cache.
      if(!asyncRead){const pending=refreshAsync().finally(()=>{if(asyncRead===pending)asyncRead=null;});asyncRead=pending;}
      return structuredClone(await asyncRead);
    },
    sourceTask(key){
      // Each local commit invalidates this index immediately. Remote changes
      // are checked at most 500 ms apart; writes still re-read and use CAS.
      if(!cached||Date.now()-checkedAt>=500)refresh();
      if(indexVersion!==cached.version){sourceIndex=new Map((cached.data?.tasks||[]).map(task=>[task.runtime?.sourceKey,task]));indexVersion=cached.version;}
      const task=sourceIndex.get(key);
      return task?structuredClone(task):null;
    },
    commit(version,data){
      const next=JSON.stringify(data);
      const delta=text!==null&&Buffer.byteLength(next)>=1024*1024?textDelta(text,next):null;
      const stored=delta&&deltaTransportBytes(delta)<Math.min(Buffer.byteLength(next)/2,16*1024*1024)
        ?rpc.call('writeFileDelta',[file,version,delta]):rpc.call('writeFile',[file,version,next]);
      text=next;
      cached={exists:true,data:structuredClone(data),version:stored.version,sha256:stored.sha256};
      checkedAt=Date.now();
      return stored;
    },
    async commitAsync(version,data){
      const next=JSON.stringify(data),delta=text!==null&&Buffer.byteLength(next)>=1024*1024?textDelta(text,next):null;
      const stored=delta&&deltaTransportBytes(delta)<Math.min(Buffer.byteLength(next)/2,16*1024*1024)
        ?await rpc.callAsync('writeFileDelta',[file,version,delta]):await rpc.callAsync('writeFile',[file,version,next]);
      if(!cached||stored.version>=cached.version){text=next;cached={exists:true,data:structuredClone(data),version:stored.version,sha256:stored.sha256};checkedAt=Date.now();}
      return stored;
    },
    close(){rpc.close();},
  };
}
