// Explicitly registered JSON metadata has MySQL as its authority. Local files
// are a recoverable read cache; bytes, atomic rename and CAS versions survive.
import fs from 'node:fs';
import promises from 'node:fs/promises';
import {syncBuiltinESMExports} from 'node:module';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {createSyncRpc} from './sync_rpc.mjs';
import {isMainThread} from 'node:worker_threads';

if(isMainThread){
const original={};
for(const name of ['readFileSync','writeFileSync','renameSync','unlinkSync','mkdirSync','statSync','existsSync','readFile','writeFile','rename','unlink'])original[name]=fs[name].bind(fs);
const originalPromises=Object.fromEntries(['readFile','writeFile','rename','unlink'].map(name=>[name,promises[name].bind(promises)]));
const configuration=JSON.parse(original.readFileSync(process.env.PINYING_METADATA_CONFIG_FILE||'/run/pinying-metadata.json','utf8'));
const clients=new Map();
const rules=configuration.rules.map(rule=>{let rpc=clients.get(rule.connection.scope);if(!rpc){rpc=createSyncRpc(null,'documents',rule.connection);clients.set(rule.connection.scope,rpc);}return {...rule,root:resolve(rule.root),rpc,versions:new Map(),verified:new Map()};});
const directories=new Map();
function directory(rule){
  let cached=directories.get(rule.connection.scope);
  if(!cached||Date.now()-cached.at>2000){
    const files=rule.rpc.call('listFiles',['/']);cached={at:Date.now(),files:new Map(files.map(info=>[info.path,info]))};directories.set(rule.connection.scope,cached);
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
function missing(file){return Object.assign(new Error('Metadata does not exist: '+file),{code:'ENOENT',path:file});}
function cacheWrite(item,text,version,sha){
  original.mkdirSync(dirname(item.local),{recursive:true});
  const temp=item.local+'.pinying-cache-'+process.pid;
  original.writeFileSync(temp,text,{mode:0o600});original.renameSync(temp,item.local);
  item.rule.versions.set(item.path,version);item.rule.verified.set(item.path,{stamp:fingerprint(item.local),sha});
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
  directories.delete(item.rule.connection.scope);
  const stored=item.rule.rpc.call('writeFile',[item.path,expected,text]);
  original.writeFileSync(item.local,bytes,options);item.rule.versions.set(item.path,stored.version);item.rule.verified.set(item.path,{stamp:fingerprint(item.local),sha:stored.sha256});
}
fs.readFileSync=(file,options)=>{const item=matched(file);return item?readManaged(item,options):original.readFileSync(file,options);};
fs.writeFileSync=(file,data,options)=>{const item=matched(file);return item?saveManaged(item,data,options):original.writeFileSync(file,data,options);};
fs.renameSync=(from,to)=>{
  const target=matched(to),source=matched(from);
  if(target)directories.delete(target.rule.connection.scope);
  if(source&&target&&source.path!==target.path){
    if(source.rule.connection.scope!==target.rule.connection.scope)throw new Error('Metadata rename cannot cross business scopes');
    const fromVersion=source.rule.versions.get(source.path)??source.rule.rpc.call('statFile',[source.path]).version,toVersion=target.rule.versions.get(target.path)??target.rule.rpc.call('statFile',[target.path]).version;
    const result=source.rule.rpc.call('renameFile',[source.path,fromVersion,target.path,toVersion]);original.renameSync(from,to);source.rule.versions.set(source.path,result.source.version);source.rule.verified.delete(source.path);target.rule.versions.set(target.path,result.target.version);target.rule.verified.set(target.path,{stamp:fingerprint(target.local),sha:result.target.sha256});return;
  }
  if(target){const bytes=source?fs.readFileSync(from):original.readFileSync(from);const expected=target.rule.versions.get(target.path)??target.rule.rpc.call('statFile',[target.path]).version;const value=target.rule.rpc.call('writeFile',[target.path,expected,bytes.toString('utf8')]);original.renameSync(from,to);target.rule.versions.set(target.path,value.version);target.rule.verified.set(target.path,{stamp:fingerprint(target.local),sha:value.sha256});return;}
  return original.renameSync(from,to);
};
fs.unlinkSync=file=>{const item=matched(file);if(item){directories.delete(item.rule.connection.scope);const expected=item.rule.versions.get(item.path)??item.rule.rpc.call('statFile',[item.path]).version;const value=item.rule.rpc.call('deleteFile',[item.path,expected,null]);item.rule.versions.set(item.path,value.version);item.rule.verified.delete(item.path);}return original.unlinkSync(file);};
for(const [name,syncName] of [['readFile','readFileSync'],['writeFile','writeFileSync'],['rename','renameSync'],['unlink','unlinkSync']]){
  fs[name]=(...args)=>{const callback=args.pop();const item=matched(args[0])||(name==='rename'&&matched(args[1]));if(!item){return original[name](...args,callback);}try{const value=fs[syncName](...args);queueMicrotask(()=>callback(null,value));}catch(error){queueMicrotask(()=>callback(error));}};
  promises[name]=async(...args)=>{const item=matched(args[0])||(name==='rename'&&matched(args[1]));return item?fs[syncName](...args):originalPromises[name](...args);};
}
// Rebuild missing cache entries before the application enumerates job folders.
for(const rule of rules){
  for(const info of directory(rule).values()){
    if(!info.path.startsWith(rule.logicalRoot+'/'))continue;
    const local=rule.root+info.path.slice(rule.logicalRoot.length),item=matched(local);if(!item||item.rule!==rule)continue;
    rule.versions.set(item.path,info.version);
    if(!original.existsSync(local)){const value=rule.rpc.call('readFile',[info.path]);if(value.exists)cacheWrite(item,value.data,value.version,value.sha256);}
  }
}
syncBuiltinESMExports();
}
