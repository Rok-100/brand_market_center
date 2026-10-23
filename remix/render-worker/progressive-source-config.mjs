import fs from 'node:fs/promises';

export const PROGRESSIVE_SOURCE_POLICY_SCHEMA = 'wis-bounded-source-pilot-v1';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

// Deployment-owned policy, not a request flag or an authorization grant.
// Normal owner/source access, pause, evidence, model budget and quality gates
// remain in the service. This pilot may select ONE exact existing job only.
export function parseProgressiveSourcePolicy(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).length !== 2 ||
      value.schema !== PROGRESSIVE_SOURCE_POLICY_SCHEMA ||
      !Array.isArray(value.jobIds) || value.jobIds.length > 1 ||
      value.jobIds.some(id => typeof id !== 'string' || !UUID.test(id))) {
    throw new Error('invalid_progressive_source_policy');
  }
  return Object.freeze([...value.jobIds]);
}

export async function loadProgressiveSourcePolicy({
  readOnly = false,
  readFile = fs.readFile,
} = {}) {
  if (readOnly) return {jobIds: [], reason: 'read_only'};
  try {
    const text = await readFile(new URL('./progressive-source-policy.json', import.meta.url), 'utf8');
    const jobIds = parseProgressiveSourcePolicy(JSON.parse(text));
    return {jobIds, reason: jobIds.length ? 'configured' : 'disabled'};
  } catch {
    // A missing or malformed optional pilot cannot enable broad preparation,
    // nor make the otherwise working renderer unavailable.
    return {jobIds: [], reason: 'policy_unavailable'};
  }
}
