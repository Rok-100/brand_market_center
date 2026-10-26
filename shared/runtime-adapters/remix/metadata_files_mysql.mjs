// Explicitly registered JSON metadata has MySQL as its authority. Local files
// are a recoverable read cache; bytes, atomic rename and CAS versions survive.
import fs from 'node:fs';
import promises from 'node:fs/promises';
import {syncBuiltinESMExports} from 'node:module';
import {resolve,dirname,basename} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {createSyncRpc} from './sync_rpc.mjs';
import {textDelta,deltaTransportBytes} from './text_delta.mjs';
import {isMainThread} from 'node:worker_threads';

if(isMainThread){
const original={};
for(const name of ['readFileSync','writeFileSync','renameSync','unlinkSync','mkdirSync','statSync','existsSync','readdirSync','readFile','writeFile','rename','unlink'])original[name]=fs[name].bind(fs);
const originalPromises=Object.fromEntries(['readFile','writeFile','rename','unlink','mkdir','stat'].map(name=>[name,promises[name].bind(promises)]));
const configuration=JSON.parse(original.readFileSync(process.env.PINYING_METADATA_CONFIG_FILE||'/run/pinying-metadata.json','utf8'));
const clients=new Map();
const rules=configuration.rules.map(rule=>{let rpc=clients.get(rule.connection.scope);if(!rpc){rpc=createSyncRpc(null,'documents',rule.connection);clients.set(rule.connection.scope,rpc);}return {...rule,root:resolve(rule.root),rpc,versions:new Map(),verified:new Map()};});
const directories=new Map();
const pendingDirectories=new Map();
const directoryEpochs=new Map();
function invalidateDirectory(scope){directoryEpochs.set(scope,(directoryEpochs.get(scope)||0)+1);directories.delete(scope);}
function directory(rule){
  let cached=directories.get(rule.connection.scope);
  if(!cached||Date.now()-cached.at>2000){
    const files=rule.rpc.call('listFiles',['/']);cached={at:Date.now(),files:new Map(files.map(info=>[info.path,info]))};invalidateDirectory(rule.connection.scope);directories.set(rule.connection.scope,cached);
  }
  return cached.files;
}
const hash=data=>createHash('sha256').update(data).digest('hex');
const keyOf=file=>resolve(file instanceof URL?fileURLToPath(file):Buffer.isBuffer(file)?file.toString():file);
function matched(file){
  if(typeof file==='number')return null;
  const local=keyOf(file);
  for(const rule of rules){
    if(local!==rule.root&&!local.startsWith(rule.root+'/'))continue;
    const relative=local.slice(rule.root.length);
    if(!/\.(json|jsonl)$/u.test(local)||rule.exclude?.some(path=>relative===path||relative.startsWith(path+'/')))continue;
    return {rule,local,path:rule.logicalRoot+relative};
  }
  return null;
}
function fingerprint(file){const stat=original.statSync(file,{bigint:true});return [stat.ino,stat.size,stat.mtimeNs,stat.ctimeNs].join(':');}
async function fingerprintAsync(file){const stat=await originalPromises.stat(file,{bigint:true});return [stat.ino,stat.size,stat.mtimeNs,stat.ctimeNs].join(':');}
async function directoryAsync(rule){
  const scope=rule.connection.scope,cached=directories.get(scope);
  if(cached&&Date.now()-cached.at<=2000)return cached.files;
  let pending=pendingDirectories.get(scope);
  if(!pending){const epoch=directoryEpochs.get(scope)||0;pending=(async()=>{const files=await rule.rpc.callAsync('listFiles',['/']);
    // An authoritative stat or write completed after this list began. Never
    // overwrite its newer hints with a delayed directory response. A missing
    // hint falls through to statFile in readManagedAsync, not stale data.
    if((directoryEpochs.get(scope)||0)!==epoch)return directories.get(scope)?.files||new Map();
    const value={at:Date.now(),files:new Map(files.map(info=>[info.path,info]))};directories.set(scope,value);return value.files;})();pendingDirectories.set(scope,pending);}
  try{return await pending;}finally{if(pendingDirectories.get(scope)===pending)pendingDirectories.delete(scope);}
}
function missing(file){return Object.assign(new Error('Metadata does not exist: '+file),{code:'ENOENT',path:file});}
function persist(item,bytes,expected){
  if(bytes.length>=1024*1024){
    let before;
    try{before=original.readFileSync(item.local);}catch(error){if(error.code!=='ENOENT')throw error;}
    if(before){
      const delta=textDelta(before,bytes);
      if(deltaTransportBytes(delta)<Math.min(bytes.length/2,16*1024*1024))return item.rule.rpc.call('writeFileDelta',[item.path,expected,delta]);
    }
  }
  return item.rule.rpc.call('writeFile',[item.path,expected,bytes.toString('utf8')]);
}
function cacheWrite(item,text,version,sha){
  original.mkdirSync(dirname(item.local),{recursive:true});
  const temp=item.local+'.pinying-cache-'+process.pid+'-'+randomUUID();
  original.writeFileSync(temp,text,{mode:0o600});original.renameSync(temp,item.local);
  item.rule.versions.set(item.path,version);item.rule.verified.set(item.path,{stamp:fingerprint(item.local),sha});
}
const fileRefreshQueues=new Map();
function withFileOperation(item,execute){
  const previous=fileRefreshQueues.get(item.local)||Promise.resolve();
  const operation=previous.catch(()=>{}).then(execute);
  fileRefreshQueues.set(item.local,operation);
  return operation.finally(()=>{if(fileRefreshQueues.get(item.local)===operation)fileRefreshQueues.delete(item.local);});
}
function refreshManagedAsync(item,options={}){
  // Authority checks must run after every older hydration for this file.
  // Do not share an earlier directory-based check with a later primary check.
  return withFileOperation(item,()=>refreshManagedUnlocked(item,options));
}
async function refreshManagedUnlocked(item,{authoritative=false}={}){
  const found=authoritative?null:(await directoryAsync(item.rule)).get(item.path);
  const info=found?{exists:true,...found}:await item.rule.rpc.callAsync('statFile',[item.path]);item.rule.versions.set(item.path,info.version);
  // A direct authoritative check must replace any older directory hint for
  // this file, otherwise the following read could hydrate an older version.
  if(authoritative){const scope=item.rule.connection.scope,cached=directories.get(scope)||{at:0,files:new Map()};
    directoryEpochs.set(scope,(directoryEpochs.get(scope)||0)+1);
    if(info.exists)cached.files.set(item.path,info);else cached.files.delete(item.path);
    directories.set(scope,cached);
  }
  if(!info.exists)throw missing(item.local);
  let valid=false;
  try{const stamp=await fingerprintAsync(item.local),previous=item.rule.verified.get(item.path);
    if(previous?.stamp===stamp&&previous.sha===info.sha256)valid=true;
    else{const bytes=await originalPromises.readFile(item.local);valid=hash(bytes)===info.sha256;if(valid)item.rule.verified.set(item.path,{stamp,sha:info.sha256});}
  }catch(error){if(error.code!=='ENOENT')throw error;}
  if(!valid){const value=await item.rule.rpc.callAsync('readFile',[item.path]);if(!value.exists)throw missing(item.local);
    await originalPromises.mkdir(dirname(item.local),{recursive:true});const temp=item.local+'.pinying-cache-'+randomUUID();
    await originalPromises.writeFile(temp,value.data,{mode:0o600});await originalPromises.rename(temp,item.local);
    item.rule.versions.set(item.path,value.version);item.rule.verified.set(item.path,{stamp:await fingerprintAsync(item.local),sha:value.sha256});
    // readFile can observe a newer committed version than the preceding stat.
    // Publish that exact version to the hint and invalidate in-flight lists.
    const scope=item.rule.connection.scope,cached=directories.get(scope)||{at:0,files:new Map()};
    directoryEpochs.set(scope,(directoryEpochs.get(scope)||0)+1);
    cached.files.set(item.path,{exists:true,path:item.path,version:value.version,sha256:value.sha256});directories.set(scope,cached);
  }
  return {version:item.rule.versions.get(item.path),sha256:item.rule.verified.get(item.path)?.sha};
}
async function readManagedAsync(item,options){
  return withFileOperation(item,async()=>{
    await refreshManagedUnlocked(item);
    return originalPromises.readFile(item.local,options);
  });
}
// Bind each business mutation to the exact authoritative snapshot it read.
// Progress GETs can no longer replace a writer's compare-and-swap version.
globalThis[Symbol.for('pinying.metadata.document.v1')]={
  handles:file=>Boolean(matched(file)),
  read:file=>{
    const item=matched(file);if(!item)throw Error('Unmanaged metadata document');
    return withFileOperation(item,async()=>{
      const value=await item.rule.rpc.callAsync('readFile',[item.path]);
      if(!value.exists)throw missing(item.local);
      return {data:value.data,version:value.version,sha256:value.sha256};
    });
  },
  commit:(file,snapshot,data)=>{
    const item=matched(file);if(!item)throw Error('Unmanaged metadata document');
    return withFileOperation(item,async()=>{
      if(!Number.isSafeInteger(snapshot?.version)||snapshot.version<0||typeof data!=='string')throw Error('Invalid metadata snapshot');
      // Derive deltas from this read's bytes, never a later cache hydration.
      try{
        let method='writeFile',payload=data;
        const bytes=Buffer.from(data);
        if(bytes.length>=1024*1024&&typeof snapshot.data==='string'&&hash(snapshot.data)===snapshot.sha256){
          const delta=textDelta(Buffer.from(snapshot.data),bytes);
          if(deltaTransportBytes(delta)<Math.min(bytes.length/2,16*1024*1024)){method='writeFileDelta';payload=delta;}
        }
        const value=await item.rule.rpc.callAsync(method,[item.path,snapshot.version,payload]);
        cacheWrite(item,data,value.version,value.sha256);invalidateDirectory(item.rule.connection.scope);
        return value;
      }catch(error){
        if(/Document changed during (transaction|delta)/u.test(error.message))error.code='METADATA_CONFLICT';
        throw error;
      }
    });
  },
};
// Internal adapter capability: check MySQL authority and refresh the verified
// cache without allocating/decoding the complete document on every GET.
// Unmanaged files return false; errors deliberately propagate (no stale pass).
const pendingRefreshes=new Map();
globalThis[Symbol.for('pinying.metadata.refresh.v1')]=file=>{
  const item=matched(file);if(!item)return Promise.resolve(false);
  let pending=pendingRefreshes.get(item.local);
  if(!pending){pending=refreshManagedAsync(item,{authoritative:true}).then(()=>true).finally(()=>{if(pendingRefreshes.get(item.local)===pending)pendingRefreshes.delete(item.local);});pendingRefreshes.set(item.local,pending);}
  return pending;
};
async function persistAsync(item,bytes,expected){
  if(bytes.length>=1024*1024){let before;try{before=await originalPromises.readFile(item.local);}catch(error){if(error.code!=='ENOENT')throw error;}
    if(before){const delta=textDelta(before,bytes);if(deltaTransportBytes(delta)<Math.min(bytes.length/2,16*1024*1024))return item.rule.rpc.callAsync('writeFileDelta',[item.path,expected,delta]);}}
  return item.rule.rpc.callAsync('writeFile',[item.path,expected,bytes.toString('utf8')]);
}
async function writeManagedAsync(item,data,options){
  const encoding=typeof options==='string'?options:options?.encoding||'utf8',bytes=typeof data==='string'?Buffer.from(data,encoding):Buffer.from(data);
  if(!bytes.equals(Buffer.from(bytes.toString('utf8'))))throw new Error('Metadata must contain valid UTF-8');
  const expected=item.rule.versions.get(item.path)??(await item.rule.rpc.callAsync('statFile',[item.path])).version;invalidateDirectory(item.rule.connection.scope);
  const value=await persistAsync(item,bytes,expected);await originalPromises.writeFile(item.local,bytes,options);
  item.rule.versions.set(item.path,value.version);item.rule.verified.set(item.path,{stamp:await fingerprintAsync(item.local),sha:value.sha256});invalidateDirectory(item.rule.connection.scope);
}
async function renameManagedAsync(from,to){
  const source=matched(from),target=matched(to);if(target)invalidateDirectory(target.rule.connection.scope);
  if(source&&target&&source.path!==target.path){
    if(source.rule.connection.scope!==target.rule.connection.scope)throw new Error('Metadata rename cannot cross business scopes');
    const a=source.rule.versions.get(source.path)??(await source.rule.rpc.callAsync('statFile',[source.path])).version,b=target.rule.versions.get(target.path)??(await target.rule.rpc.callAsync('statFile',[target.path])).version;
    const value=await source.rule.rpc.callAsync('renameFile',[source.path,a,target.path,b]);await originalPromises.rename(from,to);
    source.rule.versions.set(source.path,value.source.version);source.rule.verified.delete(source.path);target.rule.versions.set(target.path,value.target.version);target.rule.verified.set(target.path,{stamp:await fingerprintAsync(target.local),sha:value.target.sha256});invalidateDirectory(target.rule.connection.scope);return;
  }
  if(target){const bytes=source?await readManagedAsync(source):await originalPromises.readFile(from),expected=target.rule.versions.get(target.path)??(await target.rule.rpc.callAsync('statFile',[target.path])).version;
    const value=await persistAsync(target,bytes,expected);await originalPromises.rename(from,to);target.rule.versions.set(target.path,value.version);target.rule.verified.set(target.path,{stamp:await fingerprintAsync(target.local),sha:value.sha256});invalidateDirectory(target.rule.connection.scope);return;}
  return originalPromises.rename(from,to);
}
async function unlinkManagedAsync(item){
  const expected=item.rule.versions.get(item.path)??(await item.rule.rpc.callAsync('statFile',[item.path])).version;invalidateDirectory(item.rule.connection.scope);
  const value=await item.rule.rpc.callAsync('deleteFile',[item.path,expected,null]);item.rule.versions.set(item.path,value.version);item.rule.verified.delete(item.path);
  await originalPromises.unlink(item.local);invalidateDirectory(item.rule.connection.scope);
}
function readManaged(item,options){
  const found=directory(item.rule).get(item.path);
  const info=found?{exists:true,...found}:item.rule.rpc.call('statFile',[item.path]);item.rule.versions.set(item.path,info.version);
  if(!info.exists)throw missing(item.local);
  let valid=false;
  try{
    const stamp=fingerprint(item.local),previous=item.rule.verified.get(item.path);
    if(previous?.stamp===stamp&&previous.sha===info.sha256)valid=true;
    else{
      const bytes=original.readFileSync(item.local);valid=hash(bytes)===info.sha256;
      if(valid)item.rule.verified.set(item.path,{stamp,sha:info.sha256});
    }
  }catch(error){if(error.code!=='ENOENT')throw error;}
  if(!valid){const value=item.rule.rpc.call('readFile',[item.path]);if(!value.exists)throw missing(item.local);cacheWrite(item,value.data,value.version,value.sha256);}
  return original.readFileSync(item.local,options);
}
function saveManaged(item,data,options){
  const encoding=typeof options==='string'?options:options?.encoding||'utf8';
  const bytes=typeof data==='string'?Buffer.from(data,encoding):Buffer.from(data);
  const text=bytes.toString('utf8');if(!bytes.equals(Buffer.from(text)))throw new Error('Metadata must contain valid UTF-8');
  const expected=item.rule.versions.get(item.path)??item.rule.rpc.call('statFile',[item.path]).version;
  invalidateDirectory(item.rule.connection.scope);
  const stored=persist(item,bytes,expected);
  original.writeFileSync(item.local,bytes,options);item.rule.versions.set(item.path,stored.version);item.rule.verified.set(item.path,{stamp:fingerprint(item.local),sha:stored.sha256});
}
fs.readFileSync=(file,options)=>{const item=matched(file);return item?readManaged(item,options):original.readFileSync(file,options);};
fs.writeFileSync=(file,data,options)=>{const item=matched(file);return item?saveManaged(item,data,options):original.writeFileSync(file,data,options);};
fs.renameSync=(from,to)=>{
  const target=matched(to),source=matched(from);
  if(target)invalidateDirectory(target.rule.connection.scope);
  if(source&&target&&source.path!==target.path){
    if(source.rule.connection.scope!==target.rule.connection.scope)throw new Error('Metadata rename cannot cross business scopes');
    const fromVersion=source.rule.versions.get(source.path)??source.rule.rpc.call('statFile',[source.path]).version,toVersion=target.rule.versions.get(target.path)??target.rule.rpc.call('statFile',[target.path]).version;
    const result=source.rule.rpc.call('renameFile',[source.path,fromVersion,target.path,toVersion]);original.renameSync(from,to);source.rule.versions.set(source.path,result.source.version);source.rule.verified.delete(source.path);target.rule.versions.set(target.path,result.target.version);target.rule.verified.set(target.path,{stamp:fingerprint(target.local),sha:result.target.sha256});return;
  }
  if(target){const bytes=source?fs.readFileSync(from):original.readFileSync(from);const expected=target.rule.versions.get(target.path)??target.rule.rpc.call('statFile',[target.path]).version;const value=persist(target,bytes,expected);original.renameSync(from,to);target.rule.versions.set(target.path,value.version);target.rule.verified.set(target.path,{stamp:fingerprint(target.local),sha:value.sha256});return;}
  return original.renameSync(from,to);
};
fs.unlinkSync=file=>{const item=matched(file);if(item){invalidateDirectory(item.rule.connection.scope);const expected=item.rule.versions.get(item.path)??item.rule.rpc.call('statFile',[item.path]).version;const value=item.rule.rpc.call('deleteFile',[item.path,expected,null]);item.rule.versions.set(item.path,value.version);item.rule.verified.delete(item.path);}return original.unlinkSync(file);};
for(const [name,syncName] of [['readFile','readFileSync'],['writeFile','writeFileSync'],['rename','renameSync'],['unlink','unlinkSync']]){
  const managed=(args,item)=>name==='readFile'?readManagedAsync(item,args[1]):name==='writeFile'?writeManagedAsync(item,args[1],args[2]):name==='rename'?renameManagedAsync(...args):unlinkManagedAsync(item);
  fs[name]=(...args)=>{const callback=args.pop();const item=matched(args[0])||(name==='rename'&&matched(args[1]));if(!item)return original[name](...args,callback);void managed(args,item).then(value=>callback(null,value),error=>callback(error));};
  promises[name]=(...args)=>{const item=matched(args[0])||(name==='rename'&&matched(args[1]));return item?managed(args,item):originalPromises[name](...args);};
}
// Rebuild missing cache entries before the application enumerates job folders.
// Listing each parent once avoids thousands of sequential OSS-FUSE existence
// lookups at boot. This only finds cache presence; authoritative SHA/version
// validation is still performed on use, including files already present.
const cacheDirectoryEntries=new Map();
function cachedFilePresent(local){
  const parent=dirname(local);let entries=cacheDirectoryEntries.get(parent);
  if(!entries){try{entries=new Set(original.readdirSync(parent));}catch(error){if(error.code!=='ENOENT')throw error;entries=new Set();}cacheDirectoryEntries.set(parent,entries);}
  return entries.has(basename(local));
}
for(const rule of rules){
  for(const info of directory(rule).values()){
    if(!info.path.startsWith(rule.logicalRoot+'/'))continue;
    const local=rule.root+info.path.slice(rule.logicalRoot.length),item=matched(local);if(!item||item.rule!==rule)continue;
    rule.versions.set(item.path,info.version);
    if(!cachedFilePresent(local)){const value=rule.rpc.call('readFile',[info.path]);if(value.exists){cacheWrite(item,value.data,value.version,value.sha256);cacheDirectoryEntries.get(dirname(local)).add(basename(local));}}
  }
}
cacheDirectoryEntries.clear();
syncBuiltinESMExports();
}
