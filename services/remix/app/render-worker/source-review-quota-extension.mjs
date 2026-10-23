import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';

const JOB='a5fdb74d-a2a1-4cf0-affe-d9bbfaf30354';
const keys=['schema','authorizationId','jobId','baseAuthorizationId','basePolicySha256','priorTotalLimit','additionalLimit','totalLimit'];
const normalize=value=>Array.isArray(value)?value.map(normalize):value&&typeof value==='object'
  ?Object.fromEntries(Object.keys(value).sort().map(key=>[key,normalize(value[key])])):value;
export const sourceQuotaPolicySha256=policy=>createHash('sha256').update(JSON.stringify(normalize(policy))).digest('hex');

// A separate image-owned additive authorization. It never mutates/replaces the
// original 64 + 200 policy or lends this allowance to any other task.
export function parseSourceReviewQuotaExtension(value,basePolicy) {
  const ok=value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length
    &&keys.every(key=>Object.hasOwn(value,key))&&value.schema==='wis-source-review-quota-extension-v1'
    &&value.authorizationId==='black-20-second-additional-source-reviews-20261003'
    &&value.jobId===JOB&&basePolicy?.jobId===JOB
    &&value.baseAuthorizationId===basePolicy.authorizationId&&value.baseAuthorizationId!==value.authorizationId
    &&value.basePolicySha256===sourceQuotaPolicySha256(basePolicy)
    &&basePolicy.totalLimit===264&&value.priorTotalLimit===264&&value.additionalLimit===200&&value.totalLimit===464;
  if(!ok)throw Error('source_quota_extension_invalid');
  return Object.freeze(Object.fromEntries(keys.map(key=>[key,value[key]])));
}

export async function loadSourceReviewQuotaExtension({basePolicy,readOnly=false,readFile=fs.readFile}={}) {
  if(readOnly||!basePolicy)return null;
  try{return parseSourceReviewQuotaExtension(JSON.parse(await readFile(new URL('./source-review-quota-extension.json',import.meta.url),'utf8')),basePolicy);}
  catch{return null;}
}
