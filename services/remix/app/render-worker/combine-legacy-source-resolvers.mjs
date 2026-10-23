import {legacyEvidenceDigest} from './legacy-source-evidence.mjs';

// Fixed, passive R9 additions. No arbitrary registry path, source scope or
// background opt-in comes from request data or environment variables.
export const R9_ADDITIVE_SOURCE_IDS=Object.freeze([
  'a5d9624a-9d18-4686-beca-872db6aa4f7f',
  '9be14c0e-4d45-4125-bca7-f6b5d43d747d',
  'cdbab8a1-1d48-4f3b-8421-5c7ea2469cc7',
]);
// R11's four additional uploaded originals are preparation-only. Keeping the
// R9 list intact preserves its exact scope for audits and old registry tests.
export const R11_ADDITIVE_SOURCE_IDS=Object.freeze([...R9_ADDITIVE_SOURCE_IDS,
  '1f134283-60a6-408e-b0f1-ec2696f105ed',
  '06cc558d-0312-48fd-ac27-4800adc0503c',
  '4e034d8c-0273-40eb-b8d9-bf5845ff1906',
  '5a396461-638f-4498-a938-b125608295eb',
]);
export const R9_ADDITIVE_JOB_ID='a5fdb74d-a2a1-4cf0-affe-d9bbfaf30354';
// A pin alone grants nothing: these restored uploads still require real
// post-classification private preparation evidence and current Cloud/bytes.
export const R13_ADDITIVE_SOURCE_IDS=Object.freeze([...R11_ADDITIVE_SOURCE_IDS,
  'fc2682c8-86b6-4d73-9f8e-1931220d94ae',
  '3931aab7-e983-4d8e-ac72-3720d2d78d78',
  'ee12e2fb-0a92-4f75-b330-4800f77c330d',
]);
const requireValue=(ok,reason)=>{if(!ok)throw Error(reason);};
const validKey=v=>typeof v==='string'&&/^[a-f0-9]{64}$/u.test(v);
function checkCatalog(value){
  requireValue(value&&Array.isArray(value.sourceIds)&&new Set(value.sourceIds).size===value.sourceIds.length
    &&value.sourceIds.every(id=>typeof id==='string'&&id.length>0&&validKey(value.bindingKeysBySourceId?.[id]))
    &&(value.registrySha256===null||validKey(value.registrySha256)),'legacy_catalog_invalid');
  return value;
}
export function combineLegacySourceResolvers(old,addon){
  requireValue([old,addon].every(r=>typeof r==='function'&&typeof r.candidateSourceIds==='function'
    &&typeof r.availableCandidateSourceIds==='function'),'legacy_resolvers_required');
  const allowed=new Set(R13_ADDITIVE_SOURCE_IDS);
  const resolve=async args=>{
    const previous=await old(args);
    if(previous?.ready||!['legacy_source_unbound','legacy_source_catalog_missing'].includes(previous?.reason))return previous;
    if(!allowed.has(args?.source?.id))return previous;
    return addon(args);
  };
  const enumerate=async context=>{
    // Only the service's already-read job may supply this context. Public HTTP
    // parameters must never be forwarded here. Unscoped callers retain EXACTLY
    // the old catalog and do not even read the additive registry.
    if(context?.trustedJobId!==R9_ADDITIVE_JOB_ID)return old.availableCandidateSourceIds();
    const [previous,addition,additionActive]=await Promise.all([
      old.availableCandidateSourceIds(),addon.availableCandidateSourceIds(),addon.candidateSourceIds()]);
    for(const value of [previous,addition,additionActive])checkCatalog(value);
    requireValue(addition.registrySha256===additionActive.registrySha256,'legacy_addon_changed');
    requireValue(additionActive.sourceIds.length===0&&addition.sourceIds.length<=10
      &&addition.sourceIds.every(id=>allowed.has(id)),'legacy_addon_scope');
    const oldIds=new Set(previous.sourceIds);
    requireValue(addition.sourceIds.every(id=>!oldIds.has(id)),'legacy_addon_shadow');
    if(addition.sourceIds.length===0)return previous;
    return {sourceIds:[...previous.sourceIds,...addition.sourceIds],
      registrySha256:legacyEvidenceDigest([previous.registrySha256,addition.registrySha256]),
      bindingKeysBySourceId:{...previous.bindingKeysBySourceId,...addition.bindingKeysBySourceId}};
  };
  resolve.candidateSourceIds=()=>old.candidateSourceIds(); // Never opt additions into the background supplier.
  resolve.availableCandidateSourceIds=context=>enumerate(context);
  return resolve;
}
