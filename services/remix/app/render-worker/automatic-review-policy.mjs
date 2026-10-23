import {needsVisualAttention} from './output-quality.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash, randomUUID} from 'node:crypto';

// Content failures can be replaced; unavailable evidence/services cannot be
// repaired by spending more render capacity on different combinations.
export function automaticReviewDecision(job, run, variants, {verifiedContentFailureJobId=null}={}) {
  if (job.autoApproveOutputs !== true) return {action: 'manual'};
  const attention = variants.filter(needsVisualAttention);
  const consecutive = attention.length === variants.length && variants.length
    ? (Number(run.consecutiveReviewFailures) || 0) + 1 : 0;
  const fatal = attention.find(v => !['content_attention', 'business_fact_attention',
    'sample_scope'].includes(v.automaticAssessment.visualReview.reason));
  // Only the server's read-only private-receipt verifier supplies this value.
  // It does not approve failed output, reset failures or enlarge attempt caps.
  const boundedReplacement=Boolean(job.id&&verifiedContentFailureJobId===job.id&&attention.length===variants.length
    &&attention.length&&attention.every(v=>v.automaticAssessment.visualReview.reason==='content_attention'
      &&v.automaticAssessment.visualReview.issues?.length>0));
  if (fatal || (consecutive >= 3&&!boundedReplacement)) return {
    action: 'stop', consecutive,
    reason: fatal?.automaticAssessment.visualReview.summary || '连续三批未通过内容复核，已保留成片与原因，请调整素材后重试。',
  };
  return {action: 'continue', consecutive, pendingCount: attention.length,...(boundedReplacement?{boundedReplacement:true}:{})};
}

export async function fetchReviewWithRetry(fetchImpl, url, options, sleep = ms => new Promise(resolve => setTimeout(resolve, ms))) {
  for (let attempt = 0; attempt < 3; attempt++) {
    // A thrown timeout has an uncertain outcome: do not duplicate that request.
    const response = await fetchImpl(url, {...options, signal: AbortSignal.timeout(120000)});
    if (![429, 502, 503, 504].includes(response.status) || attempt === 2) return response;
    await response.body?.cancel();
    await sleep(1000 * 2 ** attempt);
  }
}

export function reviewRequestLimit(env) {
  const value = Number(env.WIS_REMIX_VISUAL_REVIEW_MAX_REQUESTS ?? 64);
  return Number.isInteger(value) && value > 0 ? Math.min(value, 128) : 64;
}

// This is an unsent admission receipt, not a provider receipt. Keep it bound to
// the original run/key so increasing a configured limit cannot replay an
// uncertain request or move existing consumption into a fresh run.
export function unsentReviewBudget({key,runId,limit}) {
  return {version:1,state:'not_sent',key,runId:String(runId),limit};
}

export async function claimUnsentReviewBudgetRecovery({directory,file,record,key,runId,limit,kind}) {
  const originalRun = String(runId || '');
  if (!['single','batch'].includes(kind) || !/^[a-f0-9]{64}$/.test(key) || !originalRun || !Number.isInteger(limit) || limit < 1 || limit > 128
      || record?.state !== 'blocked' || record.reason !== 'budget_exhausted' || record.key !== key) return null;
  const allowed = new Set(kind === 'batch'
    ? ['state','reason','key','at','budget','budgetRecovery']
    : ['state','reason','key','sha256','model','result','budget','budgetRecovery']);
  // A sent payload, provider response, unknown extension or malformed marker is
  // not evidence of a request that never left this process.
  if (Object.keys(record).some(field => !allowed.has(field))) return null;
  const marker = record.budget;
  if (!marker || marker.version !== 1 || marker.state !== 'not_sent'
      || marker.key !== key || marker.runId !== originalRun || !Number.isInteger(marker.limit)
      || marker.limit < 1 || marker.limit >= limit || marker.limit > 128
      || Object.keys(marker).some(field=>!['version','state','key','runId','limit'].includes(field))) return null;
  if (kind !== 'batch' && (record.result?.status !== 'review_required' || record.result?.reason !== 'budget_exhausted')) return null;

  // All processes use this same lock, not one lock per new limit. A crash leaves
  // the lock behind and fails closed; it never silently resends an unknown call.
  const lockFile = file + '.budget-resume-lock';
  const token = randomUUID();
  let handle;
  try {
    handle = await fs.open(lockFile,'wx',0o600);
    await handle.writeFile(JSON.stringify({token,key,runId:originalRun}));
    await handle.sync();
    await handle.close();
  } catch {
    if (handle) { await handle.close().catch(()=>{}); await fs.unlink(lockFile).catch(()=>{}); }
    return null;
  }
  const release = async () => {
    try { if (JSON.parse(await fs.readFile(lockFile,'utf8')).token === token) await fs.unlink(lockFile); } catch {}
  };
  try {
    if (JSON.stringify(JSON.parse(await fs.readFile(file,'utf8'))) !== JSON.stringify(record)) throw Error('cache_changed');
    const budgetKey = createHash('sha256').update(originalRun).digest('hex');
    const prefix = `budget-${budgetKey}-`;
    const indexes = [];
    for (const name of await fs.readdir(directory)) {
      if (!name.startsWith(prefix)) continue;
      const match = name.slice(prefix.length).match(/^(0|[1-9]\d*)\.json$/);
      if (!match || Number(match[1]) >= 128) throw Error('invalid_budget_ledger');
      const entry = JSON.parse(await fs.readFile(path.join(directory,name),'utf8'));
      if (!entry || typeof entry !== 'object' || Array.isArray(entry) || !/^[a-f0-9]{64}$/.test(entry.key) || entry.key === key) throw Error('reserved_or_invalid');
      indexes.push(Number(match[1]));
    }
    indexes.sort((a,b)=>a-b);
    // Preserve every slot that existed at the documented original limit.
    // Legacy records without that watermark cannot distinguish an increase
    // from historical ledger loss, so they never reach this recovery path.
    if (!indexes.length || indexes.some((value,index)=>value !== index) || indexes.length >= limit
        || indexes.length < marker.limit) throw Error('no_verified_new_capacity');
    return {release,receipt:{runId:originalRun,key,previousLimit:marker.limit,
      limit,at:new Date().toISOString()}};
  } catch {
    await release();
    return null;
  }
}
