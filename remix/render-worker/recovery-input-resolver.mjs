import fs from 'node:fs/promises';
import path from 'node:path';

// Lookup only. Never invokes playbackRecovery (which could download/re-cut).
export function createReadonlyInputResolver({clipsDir,playbackDir,library,maxSidecars=4096}){
  let sidecars;
  const cacheRecords=async()=>{
    if(sidecars)return sidecars;
    if(!playbackDir)return [];
    let names;try{names=await fs.readdir(playbackDir);}catch(error){if(error.code==='ENOENT')return [];throw error;}
    names=names.filter(name=>/^[a-f0-9]{64}\.json$/.test(name));
    if(names.length>maxSidecars)throw new Error('Playback receipt lookup exceeds bounded limit');
    sidecars=[];
    for(const name of names){const file=path.join(playbackDir,name),stat=await fs.lstat(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>65536)throw new Error('Unsafe playback receipt');
      const record=JSON.parse(await fs.readFile(file,'utf8'));if(record.kind==='reconstructed-render-input'&&record.key===name.slice(0,-5))sidecars.push(record);}
    return sidecars;
  };
  return async(clip,{expectedHashes=[],cacheFile=null}={})=>{
    if(typeof clip.storedName!=='string'||/[\\/]/.test(clip.storedName))throw new Error('Unsafe original cut path');
    const original=path.join(clipsDir,clip.storedName);
    if(!cacheFile)try{const stat=await fs.lstat(original);if(!stat.isFile()||stat.isSymbolicLink())throw new Error('Unsafe original cut');return {file:original,kind:'original-clip'};}catch(error){if(error.code!=='ENOENT')throw error;}
    if(cacheFile&&!/^[a-f0-9]{64}\.mp4$/.test(cacheFile))throw new Error('Unsafe playback cache locator');
    const source=library.sources.find(row=>row.id===clip.sourceId),expected=new Set(expectedHashes.filter(Boolean));
    const records=(await cacheRecords()).filter(row=>row.clipId===clip.id&&row.sourceId===clip.sourceId&&row.startSeconds===clip.startSeconds&&row.endSeconds===clip.endSeconds
      &&/^[a-f0-9]{64}$/.test(row.sha256||'')&&expected.has(row.sha256)&&(!cacheFile||row.key+'.mp4'===cacheFile)
      &&[source?.contentSha256,source?.sha256].filter(Boolean).every(sha=>sha===row.originalSha256));
    if(!records.length)throw Object.assign(new Error(`Original cut and matching existing cache are unavailable: ${clip.id}`),{code:'ENOENT'});
    if(new Set(records.map(row=>row.sha256)).size!==1)throw new Error('Multiple byte versions match the cut; original manifest is required');
    const record=records.sort((a,b)=>a.key.localeCompare(b.key))[0],file=path.join(playbackDir,record.key+'.mp4'),stat=await fs.lstat(file);
    if(!stat.isFile()||stat.isSymbolicLink()||stat.size!==record.size)throw new Error('Existing playback cache size/type changed');
    return {file,kind:'reconstructed-render-input',cacheFile:record.key+'.mp4',receiptSha256:record.sha256};
  };
}
