import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {createPlaybackRecovery} from './media-playback-recovery.mjs';

const sha = data => createHash('sha256').update(data).digest('hex');
async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'wis-source-original-'));
  t.after(() => fs.rm(directory, {recursive:true, force:true}));
  const data = Buffer.from('original-media');
  const asset = {id:12, objectKey:'original.mp4', size:data.length, category:'水润', downloadUrl:'https://example.invalid/original'};
  const source = {id:'source', materialCenterAssetId:12, materialCenterObjectKey:asset.objectKey,
    size:data.length, visibility:'team', productCategory:'水润', contentSha256:sha(data)};
  const clip = {id:'clip', sourceId:source.id, startSeconds:2, endSeconds:8, visibility:'team'};
  const state = {reads:0, downloads:0, renders:0};
  const materialCenter = {configured:true,
    getAsset:async () => {state.reads++; return asset;},
    downloadAsset:async (_asset, file) => {state.downloads++; await fs.writeFile(file, data);}};
  const options = {directory, materialCenter, maxFileBytes:10000, minimumFreeBytes:0,
    hashFile:async file => sha(await fs.readFile(file)),
    inspectMedia:async file => ({duration:(await fs.readFile(file)).equals(data) ? 20 : 6}),
    runProcess:async (_bin, args) => {state.renders++; await fs.writeFile(args.at(-1), 'derived');}, ffmpegPath:'ffmpeg'};
  return {directory, source, clip, asset, data, state, options, recovery:createPlaybackRecovery(options), identity:{id:'owner'}};
}

test('source API returns verified original path and observed SHA without editing provenance', async t => {
  const f = await fixture(t), before = structuredClone(f.source);
  const result = await f.recovery.source({source:f.source, identity:f.identity});
  assert.equal(result.kind, 'verified-source-original');
  assert.equal(result.sha256, sha(f.data));
  assert.equal(result.size, f.data.length);
  assert.equal(result.sourceId, f.source.id);
  assert.equal(result.sourceBasis, 'verified-cloud-original');
  assert.equal(result.identityBasis, 'sha256');
  assert.equal(result.historicalHashAvailable, true);
  assert.deepEqual(await fs.readFile(result.path), f.data);
  assert.deepEqual(f.source, before);
  assert.equal(f.state.renders, 0);
});

test('concurrent source and clip calls share the same original download and cache', async t => {
  const f = await fixture(t), args={source:f.source, identity:f.identity};
  const [first, second, clip] = await Promise.all([
    f.recovery.source(args), f.recovery.source(args), f.recovery.clip({...args, clip:f.clip}),
  ]);
  assert.equal(first.path, second.path);
  assert.notEqual(first.path, clip.path);
  assert.equal(f.state.downloads, 1);
  assert.equal(f.state.renders, 1);
  const restarted = createPlaybackRecovery(f.options);
  assert.equal((await restarted.source(args)).path, first.path);
  assert.equal(f.state.downloads, 1);
});

test('source API reuses pre-existing verified-source-original-v1 cache unchanged', async t => {
  const f = await fixture(t);
  const identity = [f.asset.id, f.asset.objectKey, f.asset.size, f.source.contentSha256];
  const key = sha(JSON.stringify(['verified-source-original-v1',f.source.id,...identity]));
  const file = path.join(f.directory, `${key}.mp4`);
  const receipt = {key, kind:'verified-source-original', size:f.data.length, sha256:sha(f.data),
    sourceId:f.source.id, assetId:f.asset.id, originalSha256:sha(f.data),
    identityBasis:'sha256', historicalHashAvailable:true, createdAt:'2026-09-30T00:00:00.000Z'};
  await fs.writeFile(file, f.data);
  await fs.writeFile(path.join(f.directory, `${key}.json`), JSON.stringify(receipt));
  const result = await f.recovery.source({source:f.source, identity:f.identity});
  assert.equal(result.path, file);
  assert.equal(f.state.downloads, 0);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(f.directory, `${key}.json`))), receipt);
});

test('missing historical SHA stays missing and observed bytes do not become historical proof', async t => {
  const f = await fixture(t);
  delete f.source.contentSha256;
  const before = structuredClone(f.source);
  const result = await f.recovery.source({source:f.source, identity:f.identity});
  assert.equal(result.sha256, sha(f.data));
  assert.equal(result.historicalHashAvailable, false);
  assert.equal(result.identityBasis, 'object-key-and-size');
  assert.deepEqual(f.source, before);
  assert.equal('sha256' in f.source, false);
  assert.equal('contentSha256' in f.source, false);
});

test('legacy source.sha256 alone is enforced on cold and warm caches', async t => {
  const f = await fixture(t);
  delete f.source.contentSha256;
  f.source.sha256 = sha(f.data);
  const result = await f.recovery.source({source:f.source, identity:f.identity});
  assert.equal(result.identityBasis, 'sha256');
  f.source.sha256 = 'a'.repeat(64);
  await assert.rejects(f.recovery.source({source:f.source, identity:f.identity}), /校验失败/);
  assert.equal(f.state.downloads, 1);
  assert.equal(await f.options.hashFile(result.path), sha(f.data));
  f.source.id = 'new-source-with-bad-known-sha';
  await assert.rejects(f.recovery.source({source:f.source, identity:f.identity}), /校验失败/);
});

test('conflicting known SHA fields reject without generating or modifying source', async t => {
  const f = await fixture(t);
  f.source.sha256 = 'b'.repeat(64);
  const before = structuredClone(f.source);
  await assert.rejects(f.recovery.source({source:f.source, identity:f.identity}), /校验失败/);
  assert.deepEqual(f.source, before);
  assert.equal(f.state.renders, 0);
  assert.deepEqual(await fs.readdir(f.directory), []);
});

test('local verified original is cached and shared with clips without cloud access', async t => {
  const f = await fixture(t), sourcesDir = path.join(f.directory, 'sources');
  await fs.mkdir(sourcesDir);
  await fs.writeFile(path.join(sourcesDir, 'original.mp4'), f.data);
  Object.assign(f.source, {storedName:'original.mp4', durationSeconds:20});
  const before = structuredClone(f.source);
  const recovery = createPlaybackRecovery({...f.options, sourcesDir});
  const original = await recovery.source({source:f.source, identity:f.identity});
  await recovery.clip({clip:f.clip, source:f.source, identity:f.identity});
  assert.equal(original.sourceBasis, 'verified-local-original');
  assert.equal(original.assetId, null);
  assert.equal(f.state.reads, 0);
  assert.equal(f.state.downloads, 0);
  assert.deepEqual(f.source, before);
});

test('private original owner may use local bytes but another user may not', async t => {
  const f = await fixture(t), sourcesDir = path.join(f.directory, 'sources');
  await fs.mkdir(sourcesDir);
  await fs.writeFile(path.join(sourcesDir, 'private.mp4'), f.data);
  Object.assign(f.source, {storedName:'private.mp4', durationSeconds:20, visibility:'private', createdById:'owner'});
  const recovery = createPlaybackRecovery({...f.options, sourcesDir});
  const result = await recovery.source({source:f.source, identity:f.identity});
  assert.equal(result.sourceBasis, 'verified-local-original');
  await assert.rejects(recovery.source({source:f.source, identity:{id:'other'}}), /无权访问/);
  assert.equal(f.state.reads, 0);
  assert.equal(f.state.downloads, 0);
});

test('private sources never use shared cloud even if the original is already cached', async t => {
  const f = await fixture(t);
  await f.recovery.source({source:f.source, identity:f.identity});
  const reads = f.state.reads;
  Object.assign(f.source, {visibility:'private', createdById:'owner'});
  await assert.rejects(f.recovery.source({source:f.source, identity:f.identity}), /团队素材源/);
  await assert.rejects(f.recovery.source({source:f.source, identity:{id:'other'}}), /无权访问/);
  assert.equal(f.state.reads, reads);
  assert.equal(f.state.downloads, 1);
});

test('private source with missing owner and caller identity is denied before local or cloud reads', async t => {
  const f = await fixture(t);
  Object.assign(f.source, {visibility:'private'});
  await assert.rejects(f.recovery.source({source:f.source}), /无权访问/);
  assert.equal(f.state.reads, 0);
  assert.equal(f.state.downloads, 0);
});

test('clip-specific privacy is still checked before source API lookup', async t => {
  const f = await fixture(t);
  Object.assign(f.clip, {visibility:'private', createdByIds:['other']});
  await assert.rejects(f.recovery.clip({clip:f.clip, source:f.source, identity:f.identity}), /无权访问/);
  assert.equal(f.state.reads, 0);
  assert.equal(f.state.downloads, 0);
});

for (const [name, patch, pattern] of [
  ['replaced cloud object', {objectKey:'different.mp4'}, /版本发生变化/],
  ['changed cloud size', {size:999}, /版本发生变化/],
  ['deleted cloud asset', {isDeleted:true}, /不可用/],
  ['product category conflict', {category:'黑晶面膜'}, /产品分类存在冲突/],
  ['unsafe cloud URL', {downloadUrl:'http://example.invalid/file'}, /地址不符合/],
]) test(`source API rejects ${name}, even after cache warmup`, async t => {
  const f = await fixture(t);
  const original = await f.recovery.source({source:f.source, identity:f.identity});
  Object.assign(f.asset, patch);
  await assert.rejects(f.recovery.source({source:f.source, identity:f.identity}), pattern);
  assert.equal(f.state.downloads, 1);
  assert.equal(await f.options.hashFile(original.path), sha(f.data));
});

test('renumbered asset restores only the unique exact object and retains old source id', async t => {
  const f = await fixture(t);
  f.source.originalName = 'original.mp4';
  f.options.materialCenter.getAsset = async id => {
    if (id === 12) throw Object.assign(new Error('missing'), {statusCode:404});
    return {...f.asset, id:19};
  };
  f.options.materialCenter.listAssets = async () => ({total:1, items:[{...f.asset, id:19}]});
  const before = structuredClone(f.source);
  const original = await f.recovery.source({source:f.source, identity:f.identity});
  assert.equal(original.assetId, 19);
  assert.equal(original.previousAssetId, 12);
  assert.deepEqual(f.source, before);
  f.options.materialCenter.listAssets = async () => ({total:1, items:[{...f.asset, id:19, objectKey:'same-name-other-object'}]});
  await assert.rejects(f.recovery.source({source:f.source, identity:f.identity}), /唯一且一致/);
});

test('corrupt source cache blocks without overwriting or redownloading', async t => {
  const f = await fixture(t);
  const original = await f.recovery.source({source:f.source, identity:f.identity});
  await fs.writeFile(original.path, 'corrupt');
  await assert.rejects(f.recovery.source({source:f.source, identity:f.identity}), /缓存校验失败/);
  assert.equal(f.state.downloads, 1);
  assert.equal(await fs.readFile(original.path, 'utf8'), 'corrupt');
});

test('local path traversal is blocked before cloud lookup', async t => {
  const f = await fixture(t);
  const recovery = createPlaybackRecovery({...f.options, sourcesDir:f.directory});
  f.source.storedName = '../outside.mp4';
  await assert.rejects(recovery.source({source:f.source, identity:f.identity}), /路径无效/);
  assert.equal(f.state.reads, 0);
  assert.equal(f.state.downloads, 0);
});

test('local duration mismatch is not replaced by another cloud original', async t => {
  const f = await fixture(t), sourcesDir = path.join(f.directory, 'sources');
  await fs.mkdir(sourcesDir);
  await fs.writeFile(path.join(sourcesDir, 'original.mp4'), f.data);
  Object.assign(f.source, {storedName:'original.mp4', durationSeconds:99});
  const recovery = createPlaybackRecovery({...f.options, sourcesDir});
  await assert.rejects(recovery.source({source:f.source, identity:f.identity}), /时长与来源记录不一致/);
  assert.equal(f.state.reads, 0);
});
