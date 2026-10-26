import {isDeepStrictEqual as equal} from 'node:util';

export const isLibraryConflict = error => error?.code==='METADATA_CONFLICT'||
  /Document changed during (?:transaction|delta)|Metadata changed during rename|存储更新冲突/u.test(String(error?.message||error||''));
export const libraryConflict = () => Object.assign(new Error('存储更新冲突，已保留最新数据与原批次进度，等待自动重试。'),
  {code:'METADATA_CONFLICT',statusCode:409});
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const keyed=items=>Array.isArray(items)&&items.length>0&&items.every(row=>object(row)&&typeof row.id==='string')&&
  new Set(items.map(row=>row.id)).size===items.length;
const absent=Symbol('absent');

// Apply an already computed patch, never invoke an effectful updater twice.
// Only disjoint edits (or an identical committed value) may be rebased.
export function mergeLibraryChange(base,wanted,current){
  if(equal(base,wanted))return structuredClone(current);
  if(equal(base,current)||equal(wanted,current))return structuredClone(wanted);
  if(object(base)&&object(wanted)&&object(current)){
    const result={};
    for(const key of new Set([...Object.keys(base),...Object.keys(wanted),...Object.keys(current)])){
      const b=Object.hasOwn(base,key)?base[key]:absent,w=Object.hasOwn(wanted,key)?wanted[key]:absent,c=Object.hasOwn(current,key)?current[key]:absent;
      const value=b===absent||w===absent||c===absent
        ?equal(b,w)?c:equal(b,c)||equal(w,c)?w:(()=>{throw libraryConflict();})()
        :mergeLibraryChange(b,w,c);
      if(value!==absent)result[key]=structuredClone(value);
    }
    return result;
  }
  if(Array.isArray(base)&&Array.isArray(wanted)&&Array.isArray(current)&&
      [base,wanted,current].every(items=>!items.length||keyed(items))){
    const map=items=>Object.fromEntries(items.map(row=>[row.id,row]));
    const merged=mergeLibraryChange(map(base),map(wanted),map(current));
    // Preserve the latest ordering and append only genuinely new local rows.
    return [...new Set([...current,...wanted].map(row=>row.id))].filter(id=>Object.hasOwn(merged,id)).map(id=>merged[id]);
  }
  throw libraryConflict();
}

export async function commitLibraryChange({base,wanted,snapshot,read,commit,canRebase=()=>true,maxAttempts=3,delay=ms=>new Promise(resolve=>setTimeout(resolve,ms))}){
  let next=wanted,token=snapshot;
  for(let attempt=0;attempt<maxAttempts;attempt++){
    try{await commit(token,next);return next;}
    catch(error){
      if(!isLibraryConflict(error))throw error;
      if(attempt+1>=maxAttempts)throw libraryConflict();
      await delay(10*2**attempt);
      const latest=await read();
      if(!canRebase(base,latest.library))throw libraryConflict();
      next=mergeLibraryChange(base,wanted,latest.library);token=latest.snapshot;
    }
  }
}

export function libraryRebaseAllowed(base,current){
  // Approvals prepared against different source/permission/control evidence
  // must return to the workflow for revalidation, rather than being merged.
  if(!equal(base.sources,current.sources)||!equal(base.autoRemixGrants,current.autoRemixGrants)||
      !equal(base.verifiedAutoRemixIdentities,current.verifiedAutoRemixIdentities))return false;
  for(const job of base.autoJobs||[]){
    const fresh=current.autoJobs?.find(row=>row.id===job.id);
    if(!fresh||!equal([job.status,job.archivedAt,job.createdById,job.productCategory,job.frameworkId],
      [fresh.status,fresh.archivedAt,fresh.createdById,fresh.productCategory,fresh.frameworkId]))return false;
  }
  return true;
}
