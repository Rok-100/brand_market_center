import {createHash} from 'node:crypto';
import {hasLegacyVersionConflict} from './legacy-source-evidence.mjs';

// Explicit exact-version evidence has priority, including a negative/revoked
// verdict. Legacy reuse is only for unbound historical sources, never a fallback
// around a bad known edition, a corrupt registry or inaccessible evidence.
export function combineSourceEvidenceResolvers(exact,legacy){
  if(typeof exact!=='function'||typeof legacy!=='function')throw Error('source_resolvers_required');
  const resolve=async args=>{
    const result=await exact(args);
    if(result?.ready || hasLegacyVersionConflict(args?.source)
      || !['source_version_catalog_missing','source_version_unbound'].includes(result?.reason))return result;
    return legacy(args);
  };
  const enumerate=async(available,context)=>{
    const [known,old]=await Promise.all([exact.candidateSourceIds(),
      available&&typeof legacy.availableCandidateSourceIds==='function'
        ?legacy.availableCandidateSourceIds(context):legacy.candidateSourceIds()]);
    return {sourceIds:[...new Set([...known.sourceIds,...old.sourceIds])],
      registrySha256:createHash('sha256').update(JSON.stringify([known.registrySha256,old.registrySha256])).digest('hex'),
      bindingKeysBySourceId:{...old.bindingKeysBySourceId,...known.bindingKeysBySourceId}};
  };
  resolve.candidateSourceIds=()=>enumerate(false);
  resolve.availableCandidateSourceIds=context=>enumerate(true,context);
  return resolve;
}
