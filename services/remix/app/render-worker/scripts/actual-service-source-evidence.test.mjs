// The real scheduler, renderer, review cache and return route run against an
// isolated library. Media, vision HTTP and material-center effects are doubles.
// No production credentials, provider, FFmpeg process or business job is used.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createClipRemixService} from '../clip-remix-service.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const OWNER = {sub: 'FI-000001', name: 'Isolated Owner'};
const ADMIN = {sub: 'fixture-admin', name: 'Isolated Admin'};

async function readLibrarySnapshot(file) {
  // Windows replacement may briefly unlink the old pathname before rename.
  // Retry only that transient read, never parse errors or business assertions.
  for (let attempt = 0; ; attempt++) {
    try {return JSON.parse(await fs.readFile(file, 'utf8'));}
    catch (error) {
      if (error.code !== 'ENOENT' || attempt >= 19) throw error;
      await sleep(10);
    }
  }
}

async function until(predicate, description) {
  for (let attempt = 0; attempt < 400; attempt++) {
    const result = await predicate();
    if (result) return result;
    await sleep(20);
  }
  throw new Error(`Timed out waiting for ${description}`);
}

async function fixture(t, {
  count = 2,
  productCategory = '黑晶面膜',
  missing,
  unusedCandidate = false,
  autoReturn = false,
  consecutiveReviewFailures = 0,
  rejectFirst = false,
  longCutCount = 0,
  duringRender,
  duringReview,
} = {}) {
  const env = {
    WIS_REMIX_VISUAL_REVIEW_ENABLED: 'true',
    WIS_REMIX_VISION_PROVIDER: 'fandow',
    JUMP_LLM_URL: 'https://example.invalid/isolated-source-evidence',
    JUMP_LLM_TOKEN: 'isolated-fixture-only',
    JUMP_LLM_APPLICATION: 'fixture',
    JUMP_LLM_PROVIDER: 'fixture',
    JUMP_LLM_VISION_MODEL: 'fixture',
  };
  const previousEnv = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
  Object.assign(process.env, env);
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wis-source-admission-'));
  let service;
  t.after(async () => {
    try {
      if (service) {
        // Quiesce the real background revalidator before removing its files.
        // Revoked fixtures are already paused, so a denied cleanup pause is safe.
        await service.route({method: 'POST', headers: {}, body: {}}, {},
          new URL('http://localhost/api/remix/automation/jobs/original-job/pause'), OWNER);
        let quietChecks = 0;
        await until(() => {
          const state = service.runtimeState();
          const quiet = !state.activeAutoJobCount && !state.pendingOutputRevalidationCount &&
            !state.pendingClipReviewCount && !state.activeClipReplenishmentJobCount;
          quietChecks = quiet ? quietChecks + 1 : 0;
          return quietChecks >= 3;
        }, 'isolated scheduler and review work to settle before cleanup').catch(error => {
          error.message += `: ${JSON.stringify(service.runtimeState())}`;
          throw error;
        });
      }
      await fs.rm(dataDir, {recursive: true, force: true, maxRetries: 5, retryDelay: 50});
    } finally {
      for (const [key, value] of Object.entries(previousEnv)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
  const root = path.join(dataDir, 'clip-remix');
  for (const name of ['sources', 'clips', 'outputs', 'visual-reviews']) {
    await fs.mkdir(path.join(root, name), {recursive: true});
  }
  const bytes = Buffer.from('isolated approved source bytes');
  const sourceHash = sha(bytes);
  const skuVersion = 'isolated-confirmed-sku';
  const roles=longCutCount ? ['hook','hook',...Array(longCutCount-2).fill('solution'),'cta']
    : ['hook','hook','solution','cta',...(unusedCandidate?['hook']:[])];
  const clipDuration=longCutCount?90/longCutCount:15;
  const sourceSegments=longCutCount?roles.length:5;
  const targetDuration=longCutCount?90:45;
  const source = {
    id: 'source', storedName: 'source.mp4', originalName: 'isolated source',
    createdById: OWNER.sub, visibility: 'team', productCategory,
    durationSeconds: sourceSegments*clipDuration, hasAudio: true, size: bytes.length, contentSha256: sourceHash, skuVersion,
    analysisAsrEvidence: {skuVersion, sourceSha256: sourceHash},
    speechSegments: Array.from({length: sourceSegments}, (_, index) => ({
      id: `speech${index}`, startSeconds: index * clipDuration, endSeconds: (index + 1) * clipDuration,
      text: '打开包装，取出面膜，观察贴合状态。',
    })),
  };
  const clips = roles
    .map((role, index) => ({
      id: `clip${index}`, sourceId: source.id, storedName: `clip${index}.mp4`,
      name: `isolated clip ${index}`, createdByIds: [OWNER.sub], visibility: 'team',
      productCategory: source.productCategory, durationSeconds: clipDuration,
      startSeconds: index * clipDuration, endSeconds: (index + 1) * clipDuration, role,
      reviewStatus: 'approved', reviewedAt: '2026-01-01T00:00:00Z', tags: [],
      boundaryEvidence: {skuVersion, sourceSha256: sourceHash},
    }));
  if (missing === 'sku' || missing === 'all') delete source.skuVersion;
  if (missing === 'asr' || missing === 'all') delete source.analysisAsrEvidence;
  if (missing === 'boundary' || missing === 'all') {
    for (const clip of clips) delete clip.boundaryEvidence;
  }
  const run = {
    id: 'original-run', status: 'awaiting_review', dateKey: '2026-10-01',
    targetCount: count, targetDurationSeconds: targetDuration, renderIds: [],
    slotSelections: Object.fromEntries(['hook','solution','cta'].map(role=>[role,clips.filter(clip=>clip.role===role).map(clip=>clip.id)])),
    generatedCount: 0, failedCount: 0, attemptedCount: 0, startCursor: 0,
    consecutiveReviewFailures,
  };
  const job = {
    id: 'original-job', name: 'isolated original job', createdById: OWNER.sub,
    createdByName: OWNER.name, status: 'paused', scheduleEnabled: false,
    nextRunAt: null, frameworkId: 'framework', productCategory: source.productCategory,
    dailyTarget: count, targetDurationSeconds: targetDuration, sourceSelectionLimit: 1,
    includeUsageDisclaimer: true, usageDisclaimerText: '产品使用效果因人而异',
    autoApproveOutputs: true, autoReturnAfterApproval: autoReturn,
    qianchuanDelivery: {enabled: false}, runs: [run],
  };
  const libraryPath = path.join(root, 'library.json');
  await fs.writeFile(path.join(root, 'sources/source.mp4'), bytes);
  for (const clip of clips) await fs.writeFile(path.join(root, 'clips', clip.storedName), clip.id);
  await fs.writeFile(libraryPath, JSON.stringify({
    version: 7, sources: [source], clips, renders: [], autoJobs: [job], folders: [],
    frameworks: [{id: 'framework', name: 'isolated framework', visibility: 'team', tags: [],
      slots: ['hook', 'solution', 'cta'].map(id => ({id, label: id}))}],
    verifiedAutoRemixIdentities: [{userId: OWNER.sub, userName: OWNER.name,
      verifiedAt: '2026-01-01T00:00:00Z', lastSeenAt: '2026-01-01T00:00:00Z', source: 'oa'}],
    autoRemixGrants: [{userId: OWNER.sub, userName: OWNER.name, verifiedAt: '2026-01-01T00:00:00Z'}],
  }));
  const counters = {renders: 0, frames: 0, requests: 0, createReturn: 0, upload: 0, completeReturn: 0};
  const requests = [];
  const context = {
    root, libraryPath, source, clips, counters, requests,
    read: () => readLibrarySnapshot(libraryPath),
    runtimeState: () => service.runtimeState(),
    route: async (method, url, body = {}, actor = OWNER) => {
      const response = {};
      await service.route({method, headers: {}, body}, response, new URL('http://localhost' + url), actor);
      return response;
    },
  };
  // Any accidental HTTP call is intercepted and must match this fixture URL.
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(String(url), env.JUMP_LLM_URL, 'Unexpected external HTTP request');
    counters.requests++;
    const body = JSON.parse(options.body);
    const request = JSON.parse(body.requests_data.messages[1].content[0].text);
    requests.push(request);
    if (duringReview) await duringReview(context, request);
    const result = (failed = false) => ({
      decision: failed ? 'review_required' : 'pass', confidence: .99,
      summary: failed ? '隔离测试：字幕重叠' : '隔离测试：逐片通过',
      issues: failed ? [{kind: 'subtitle_overlap', at: 2, description: '隔离测试可见字幕重叠'}] : [],
    });
    const answer = request.outputs ? {
      batchKey: request.batchKey, runId: request.runId, product: request.product,
      skuVersion: request.skuVersion,
      outputs: request.outputs.map((output, index) => ({...output, ...result(rejectFirst && index === 0)})),
    } : request.reviewKey ? {
      reviewKey: request.reviewKey, sha256: request.sha256,
      contextSha256: request.contextSha256, partIndex: request.partIndex,
      partCount: request.partCount, coverage: request.coverage, ...result(rejectFirst),
    } : result(rejectFirst);
    return {ok: true, json: async () => ({choices: [{message: {content: JSON.stringify(answer)}}]})};
  });
  service = createClipRemixService({
    dataDir, nowIso: () => new Date().toISOString(), autoRemixAdminUsers: ADMIN.sub,
    inspectMedia: async () => ({duration: targetDuration, width: 1080, height: 1920, hasAudio: true, frameRate: 30}),
    makeSegment: async () => {throw new Error('Unexpected source slicing');},
    runFfmpeg: async args => {
      counters.renders++;
      if (duringRender) await duringRender(context, counters.renders);
      await fs.writeFile(args.at(-1), 'isolated rendered output ' + path.basename(args.at(-1)));
    },
    runProcess: async (_command, args) => {
      if (args.includes('blackdetect=d=1:pic_th=0.98')) return {stdout: '', stderr: ''};
      assert.ok(args.includes('-frames:v'), 'Unexpected process invocation');
      counters.frames++;
      await fs.writeFile(args.at(-1), Buffer.concat([
        Buffer.from([255, 216]), Buffer.from('sample ' + args[args.indexOf('-ss') + 1]), Buffer.from([255, 217]),
      ]));
      return {stdout: '', stderr: ''};
    },
    readJsonBody: async request => request.body || {},
    jsonResponse: (response, status, body) => Object.assign(response, {status, body}),
    cutter: {configured: false},
    materialCenter: {
      configured: autoReturn,
      listAssets: async () => ({items: [], pageSize: 100, total: 0}),
      createReturn: async body => {counters.createReturn++; return {id: body.idempotency_key};},
      uploadReturnFile: async () => {counters.upload++;},
      completeReturn: async () => {counters.completeReturn++; return {status: 'completed', assetId: 123, assetAvailable: true};},
      getReturn: async () => ({status: 'completed', assetId: 123, assetAvailable: true}),
    },
  });
  await service.initialize();
  context.start = async () => {
    const response = await context.route('POST', '/api/remix/automation/jobs/original-job/run-now');
    assert.equal(response.status, 200, JSON.stringify(response));
    await until(async () => {
      const saved = await context.read();
      const current = saved.autoJobs[0].runs[0];
      return service.runtimeState().activeAutoJobCount === 0 &&
        (saved.renders.length || current.errorMessage) && saved;
    }, 'the original run to finish its isolated rendering attempt');
    return context.read();
  };
  return context;
}

for (const count of [1, 2]) {
  for (const missing of ['sku', 'asr', 'boundary', 'all']) {
    test(`actual service: ${count} automatic output(s), missing ${missing} stops before rendering`, async t => {
      const context = await fixture(t, {count, missing});
      const saved = await context.start();
      assert.equal(context.counters.renders, 0, 'Missing source evidence must stop before FFmpeg');
      assert.equal(context.counters.frames, 0);
      assert.equal(context.counters.requests, 0, 'Missing evidence must not consume a model request');
      assert.equal(saved.renders.length, 0, 'Do not produce outputs that can only wait for unavailable source evidence');
      assert.deepEqual((await fs.readdir(path.join(context.root, 'outputs'))).filter(name => name.endsWith('.mp4')), []);
      assert.equal(saved.autoJobs[0].status, 'active');
      assert.equal(saved.autoJobs[0].nextRunAt, null);
      assert.equal(saved.autoJobs[0].runs[0].status, 'awaiting_review');
      assert.equal(saved.autoJobs[0].runs[0].automaticReviewHold.reason, 'source_evidence_missing');
      assert.equal(saved.autoJobs[0].runs[0].automaticReviewHold.kind, 'source_evidence');
      assert.doesNotMatch(JSON.stringify(saved.autoJobs[0].runs[0]), /source_binding_changed/);
      assert.equal(saved.autoJobs[0].runs[0].id, 'original-run');
    });
  }
}

for (const count of [1, 2]) {
  test(`actual service: ${count} output(s) with complete evidence pass the real review path`, async t => {
    const context = await fixture(t, {count});
    const saved = await context.start();
    assert.equal(context.counters.renders, count);
    assert.equal(context.counters.requests, 1);
    assert.equal(saved.renders.length, 1);
    assert.equal(saved.renders[0].variants.length, count);
    for (const variant of saved.renders[0].variants) {
      assert.equal(variant.reviewStatus, 'approved', JSON.stringify(variant.automaticAssessment));
      assert.equal(variant.automaticAssessment.autoApproved, true);
      assert.equal(variant.automaticAssessment.visualReview.sha256, variant.contentSha256);
    }
  });
}

test('actual service: two 90-second nine-cut outputs use two complete reviews, never a truncated twelve-frame pair',async t=>{
  const context=await fixture(t,{count:2,longCutCount:9});
  const saved=await context.start();
  assert.equal(context.counters.renders,2);
  assert.equal(context.counters.requests,2);
  assert.ok(context.requests.every(request=>!request.outputs));
  for(const variant of saved.renders[0].variants){
    assert.equal(variant.clipSequence.length,9);
    assert.equal(variant.actualDurationSeconds,90);
    assert.equal(variant.reviewStatus,'approved');
    assert.equal(variant.automaticAssessment.visualReview.sampledFrames,9);
  }
});

for (const cutCount of [13,25]) {
  test(`actual service: two 90-second ${cutCount}-cut outputs review every cut with full-context partitions`, async t=>{
    const context=await fixture(t,{count:2,longCutCount:cutCount});
    const saved=await context.start();
    assert.equal(context.counters.renders,2);
    const parts=Math.ceil(cutCount/12);
    assert.equal(context.counters.requests,parts*2);
    assert.ok(context.requests.every(request=>!request.outputs && request.reviewKey));
    const groups=Map.groupBy(context.requests,request=>request.sha256);
    assert.equal(groups.size,2);
    for(const requests of groups.values()){
      assert.equal(requests.length,parts);
      assert.deepEqual(requests.map(request=>request.partIndex),Array.from({length:parts},(_,index)=>index));
      assert.ok(requests.every(request=>request.partCount===parts && request.contextTimeline.length===cutCount));
      assert.ok(requests.every(request=>request.coverage.length<=12));
      const indices=requests.flatMap(request=>request.coverage.map(row=>row.index));
      assert.deepEqual(indices,Array.from({length:cutCount},(_,index)=>index));
    }
    for(const variant of saved.renders[0].variants){
      assert.equal(variant.clipSequence.length,cutCount);
      assert.equal(variant.actualDurationSeconds,90);
      assert.equal(variant.reviewStatus,'approved',JSON.stringify(variant.automaticAssessment));
      assert.equal(variant.automaticAssessment.visualReview.sampledFrames,cutCount);
    }
  });
}

test('actual service: an unused selected opener changing during rendering does not invalidate either output', async t => {
  const context = await fixture(t, {unusedCandidate: true, duringRender: async (fixture, number) => {
    if (number !== 1) return;
    const response = await fixture.route('PATCH', '/api/remix/clips/clip4/metadata', {tags: ['unused candidate changed']});
    assert.equal(response.status, 200, JSON.stringify(response));
  }});
  const saved = await context.start();
  const variants = saved.renders[0].variants;
  assert.equal(variants.length, 2);
  assert.ok(variants.every(variant => !variant.clipSequence.includes('clip4')));
  assert.ok(variants.every(variant => variant.reviewStatus === 'approved'), JSON.stringify(variants.map(v => v.automaticAssessment.visualReview)));
});

test('actual service: one output input changing during rendering blocks that output only and returns the intact peer', async t => {
  let releaseRevalidation;
  const revalidationGate = new Promise(resolve => {releaseRevalidation = resolve;});
  // This is the generic per-output CAS/return contract. Black-mask private
  // source authorization is covered by actual-service-version-gate/legacy-source;
  // this fixture intentionally has no private catalog/review resolver.
  const context = await fixture(t, {productCategory:'WIS隐形水润面膜',autoReturn: true, duringRender: async (fixture, number) => {
    if (number !== 1) return;
    const response = await fixture.route('PATCH', '/api/remix/clips/clip0/metadata', {tags: ['used input changed during rendering']});
    assert.equal(response.status, 200, JSON.stringify(response));
  }, duringReview: async (fixture, request) => {
    if (fixture.counters.requests <= 1) return;
    assert.equal(request.outputs, undefined, 'Recovery must independently revalidate the changed output');
    await revalidationGate;
  }});
  try {
    await context.start();
    await until(() => context.counters.requests === 2, 'the changed output to enter genuine background revalidation');
    let saved = await context.read();
    const affected = saved.renders[0].variants.find(variant => variant.clipSequence.includes('clip0'));
    const intact = saved.renders[0].variants.find(variant => !variant.clipSequence.includes('clip0'));
    assert.equal(affected.automaticAssessment.visualReview.reason, 'source_binding_changed');
    assert.equal(affected.reviewStatus, 'changes_requested');
    assert.equal(intact.reviewStatus, 'approved', JSON.stringify(intact.automaticAssessment));
    assert.equal(saved.autoJobs[0].status, 'active');
    assert.equal(saved.autoJobs[0].runs[0].status, 'awaiting_review');
    assert.ok(saved.autoJobs[0].runs[0].automaticReviewHold);
    await until(() => context.counters.completeReturn === 1, 'only the intact approved output to return');
    saved = await context.read();
    assert.equal(context.counters.createReturn, 1);
    assert.equal(context.counters.upload, 1);
    assert.equal(saved.renders[0].variants.find(v => v.id === intact.id).materialCenterReturn.status, 'completed');
    assert.equal(saved.renders[0].variants.find(v => v.id === affected.id).materialCenterReturn?.status, undefined);
  } finally {
    releaseRevalidation();
  }
});

for (const changedFile of ['source', 'output']) {
  test(`actual service: ${changedFile} bytes changing during original-output revalidation never approve or return that output`, async t => {
    let releaseRevalidation;
    const revalidationGate = new Promise(resolve => {releaseRevalidation = resolve;});
    const context = await fixture(t, {productCategory:'WIS隐形水润面膜',autoReturn: true, duringRender: async (fixture, number) => {
      if (number !== 1) return;
      const response = await fixture.route('PATCH', '/api/remix/clips/clip0/metadata', {tags: ['trigger original-output revalidation']});
      assert.equal(response.status, 200, JSON.stringify(response));
    }, duringReview: async (fixture, request) => {
      if (fixture.counters.requests <= 1) return;
      assert.equal(request.outputs, undefined, 'The pending request must revalidate the original single output');
      await revalidationGate;
    }});
    let affectedId;
    let sourceBefore;
    let clipsBefore;
    let outputHashBefore;
    try {
      await context.start();
      await until(() => context.counters.requests === 2, 'the original output to enter its second, single-output model request');
      await until(() => context.counters.completeReturn === 1, 'the unchanged peer to finish returning before the disk mutation');
      const before = await context.read();
      const affected = before.renders[0].variants.find(variant => variant.clipSequence.includes('clip0'));
      affectedId = affected.id;
      sourceBefore = before.sources[0];
      clipsBefore = before.clips;
      outputHashBefore = affected.contentSha256;
      assert.equal(affected.sourceRevalidation.status, 'processing');
      assert.equal(affected.reviewStatus, 'changes_requested');
      assert.equal(affected.materialCenterReturn?.status, undefined);
      const file = changedFile === 'source'
        ? path.join(context.root, 'sources', sourceBefore.storedName)
        : path.join(context.root, 'outputs', affected.storedName);
      const bytes = await fs.readFile(file);
      bytes[0] ^= 0xff;
      await fs.writeFile(file, bytes);
      assert.notEqual(sha(bytes), changedFile === 'source' ? sourceBefore.contentSha256 : outputHashBefore);
      const unchangedMetadata = await context.read();
      assert.deepEqual(unchangedMetadata.sources[0], sourceBefore);
      assert.deepEqual(unchangedMetadata.clips, clipsBefore);
      assert.equal(unchangedMetadata.renders[0].variants.find(variant => variant.id === affectedId).contentSha256, outputHashBefore);
    } finally {
      releaseRevalidation();
    }
    const saved = await until(async () => {
      const current = await context.read();
      const affected = current.renders[0].variants.find(variant => variant.id === affectedId);
      return affected.sourceRevalidation.status === 'blocked' &&
        context.runtimeState().pendingOutputRevalidationCount === 0 && current;
    }, 'post-model file verification to block the changed original output');
    const affected = saved.renders[0].variants.find(variant => variant.id === affectedId);
    assert.equal(affected.reviewStatus, 'changes_requested');
    assert.equal(affected.automaticAssessment.autoApproved, false);
    assert.equal(affected.sourceRevalidation.required, true);
    assert.equal(affected.materialCenterReturn?.status, undefined);
    assert.equal(affected.contentSha256, outputHashBefore);
    assert.deepEqual(saved.sources[0], sourceBefore);
    assert.deepEqual(saved.clips, clipsBefore);
    assert.equal(context.counters.renders, 2, 'Original-output revalidation must not render a replacement');
    assert.equal(context.counters.requests, 2, 'Keep the original batch and one genuine revalidation request');
    assert.equal(context.counters.createReturn, 1, 'Only the already-returned unchanged peer may have a return ticket');
    assert.equal(context.counters.upload, 1);
    assert.equal(context.counters.completeReturn, 1);
  });
}

test('actual service: a real clip approval withdrawal during visual review remains blocked', async t => {
  const context = await fixture(t, {duringReview: async fixture => {
    const response = await fixture.route('POST', '/api/remix/clips/clip2/review', {reviewStatus: 'changes_requested', reviewNote: '隔离测试撤销来源审核'});
    assert.equal(response.status, 200, JSON.stringify(response));
  }});
  const saved = await context.start();
  assert.equal(context.counters.requests, 1);
  for (const variant of saved.renders[0].variants) {
    assert.equal(variant.reviewStatus, 'changes_requested');
    assert.equal(variant.automaticAssessment.visualReview.reason, 'source_binding_changed');
  }
});

test('actual service: actual source bytes changing while the visual response is pending never approve either output', async t => {
  const context = await fixture(t, {duringReview: async fixture => {
    await fs.writeFile(path.join(fixture.root, 'sources/source.mp4'), 'changed source bytes during isolated review');
  }});
  const saved = await context.start();
  assert.equal(context.counters.requests, 1);
  assert.equal(context.counters.renders, 2);
  for (const variant of saved.renders[0].variants) {
    assert.equal(variant.reviewStatus, 'changes_requested');
    assert.equal(variant.automaticAssessment.autoApproved, false);
    assert.notEqual(variant.automaticAssessment.visualReview.status, 'passed');
  }
});

for (const action of ['pause', 'revoke']) {
  test(`actual service: ${action} during the first long-output review part prevents further paid parts`, async t=>{
    const context=await fixture(t,{count:2,longCutCount:13,autoReturn:true,duringReview:async fixture=>{
      assert.equal(fixture.counters.requests,1,'No additional partition may be submitted after the stop');
      const response=action==='pause'
        ? await fixture.route('POST','/api/remix/automation/jobs/original-job/pause')
        : await fixture.route('DELETE',`/api/remix/automation/access/grants/${OWNER.sub}`,{},ADMIN);
      assert.equal(response.status,200,JSON.stringify(response));
    }});
    const saved=await context.start();
    assert.equal(context.counters.requests,1);
    assert.equal(context.counters.renders,1);
    assert.equal(context.counters.createReturn,0);
    assert.equal(context.counters.upload,0);
    assert.equal(saved.autoJobs[0].status,'paused');
    assert.equal(saved.renders[0].variants[0].reviewStatus,'changes_requested');
    assert.equal(saved.renders[0].variants[0].automaticAssessment.autoApproved,false);
  });

  test(`actual service: ${action} while first FFmpeg is pending preserves it but starts no second render or paid review`, async t => {
    let enteredFfmpeg;
    let releaseFfmpeg;
    const ffmpegEntered = new Promise(resolve => {enteredFfmpeg = resolve;});
    const ffmpegGate = new Promise(resolve => {releaseFfmpeg = resolve;});
    const context = await fixture(t, {autoReturn: true, duringRender: async (_fixture, number) => {
      if (number !== 1) return;
      enteredFfmpeg();
      await ffmpegGate;
    }});
    const completion = context.start();
    let saved;
    try {
      await ffmpegEntered;
      assert.equal(context.counters.renders, 1);
      assert.equal(context.counters.requests, 0);
      assert.deepEqual((await fs.readdir(path.join(context.root, 'outputs'))).filter(name => name.endsWith('.mp4')), []);
      const response = action === 'pause'
        ? await context.route('POST', '/api/remix/automation/jobs/original-job/pause')
        : await context.route('DELETE', `/api/remix/automation/access/grants/${OWNER.sub}`, {}, ADMIN);
      assert.equal(response.status, 200, JSON.stringify(response));
      assert.equal((await context.read()).autoJobs[0].status, 'paused');
    } finally {
      releaseFfmpeg();
      saved = await completion;
    }
    assert.equal(context.counters.renders, 1, 'A pause or grant revocation must prevent the second FFmpeg invocation');
    assert.equal(context.counters.requests, 0, 'Do not start a paid single or batch model request after the stop');
    assert.equal(context.counters.frames, 0);
    assert.equal(context.counters.createReturn, 0);
    assert.equal(context.counters.upload, 0);
    assert.equal(context.counters.completeReturn, 0);
    assert.equal(saved.autoJobs[0].status, 'paused');
    assert.equal(saved.autoJobs[0].nextRunAt, null);
    assert.equal(saved.autoJobs[0].runs.length, 1);
    assert.equal(saved.autoJobs[0].runs[0].id, 'original-run');
    assert.equal(saved.renders.length, 1);
    assert.equal(saved.renders[0].variants.length, 1);
    const retained = saved.renders[0].variants[0];
    assert.equal(retained.reviewStatus, 'changes_requested');
    assert.equal(retained.automaticAssessment.autoApproved, false);
    assert.equal(retained.automaticAssessment.visualReview.reason, 'automation_stopped');
    assert.equal(retained.materialCenterReturn?.status, undefined);
    assert.deepEqual((await fs.readdir(path.join(context.root, 'outputs'))).filter(name => name.endsWith('.mp4')), [retained.storedName]);
    const retainedBytes = await fs.readFile(path.join(context.root, 'outputs', retained.storedName));
    assert.equal(retainedBytes.toString(), 'isolated rendered output ' + retained.storedName);
    assert.equal(sha(retainedBytes), retained.contentSha256);
    if (action === 'revoke') assert.equal(saved.autoRemixGrants.length, 0);
  });

  test(`actual service: ${action} during review still prevents automatic return`, async t => {
    const context = await fixture(t, {autoReturn: true, duringReview: async fixture => {
      const response = action === 'pause'
        ? await fixture.route('POST', '/api/remix/automation/jobs/original-job/pause')
        : await fixture.route('DELETE', `/api/remix/automation/access/grants/${OWNER.sub}`, {}, ADMIN);
      assert.equal(response.status, 200, JSON.stringify(response));
    }});
    const saved = await context.start();
    assert.equal(saved.autoJobs[0].status, 'paused');
    assert.equal(saved.autoJobs[0].nextRunAt, null);
    assert.equal(context.counters.createReturn, 0);
    assert.equal(context.counters.upload, 0);
    assert.equal(context.counters.completeReturn, 0);
    if (action === 'revoke') assert.equal(saved.autoRemixGrants.length, 0);
  });
}
