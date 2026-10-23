import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash, randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {LOCAL_ASR_FILES, LOCAL_MODEL_FILES, modelFingerprint} from './local-asr-evidence.mjs';
import {createAsrEvidenceResolver} from './asr-evidence-store.mjs';
import {verifyAsrBundle} from './asr-frame-boundary.mjs';

const schema = 'wis-local-asr-operation-v1';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const requireValue = (ok, reason) => {if (!ok) throw Error(reason);};
const producerPath = fileURLToPath(new URL('./local-asr-producer.py', import.meta.url));
const hashPattern = /^[a-f0-9]{64}$/;
const uuidPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const limits = {'audio.wav': 128 * 1024 * 1024, 'transcript.json': 16 * 1024 * 1024,
  'frames.json': 8 * 1024 * 1024, 'ffprobe.frames.json': 64 * 1024 * 1024,
  'ffprobe.audio.json': 64 * 1024 * 1024};
const sameStat = (a, b) => a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs;
const jsonBytes = value => Buffer.from(JSON.stringify(value, null, 2));
const absent = value => value === undefined || value === null;
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const scopeKeys = ['mode','revisionSha256','sourceId','sourceSha256'];
const validLegacyScope = value => plain(value) && Object.keys(value).sort().join('|') === scopeKeys.join('|')
  && value.mode === 'legacy_single_source' && typeof value.sourceId === 'string' && uuidPattern.test(value.sourceId)
  && typeof value.sourceSha256 === 'string' && hashPattern.test(value.sourceSha256)
  && typeof value.revisionSha256 === 'string' && hashPattern.test(value.revisionSha256);
const sameScope = (left, right) => validLegacyScope(left) && validLegacyScope(right)
  && scopeKeys.every(key => left[key] === right[key]);
const sameBinding = (saved, current) => plain(saved) && Object.keys(saved).sort().join('|') === Object.keys(current).sort().join('|')
  && Object.keys(current).every(key => key === 'sourceScope' ? sameScope(saved[key], current[key]) : saved[key] === current[key]);

function absolute(value) {
  requireValue(typeof value === 'string' && value === value.trim() && path.isAbsolute(value) &&
    !/[\0\r\n]/u.test(value) && !/^[\\/]{2}/u.test(value) && !value.split(/[\\/]/u).includes('..'), 'local_asr_absolute_path_required');
  return path.resolve(value);
}
async function unlinked(value, kind) {
  let current = absolute(value), first = true;
  while (true) {
    const info = await fs.lstat(current);
    requireValue(!info.isSymbolicLink() && (!first || (kind === 'file' ? info.isFile() : info.isDirectory())), 'local_asr_path_not_regular');
    const parent = path.dirname(current); if (parent === current) return;
    first = false; current = parent;
  }
}
async function mkdirPrivate(directory) {
  // Validate existing ancestry before recursive mkdir; never traverse a link.
  let current = absolute(directory);
  while (true) {
    try {await unlinked(current, 'directory'); break;}
    catch (error) {if (error.code !== 'ENOENT') throw error; current = path.dirname(current);}
  }
  await fs.mkdir(directory, {recursive: true, mode: 0o700}); await unlinked(directory, 'directory');
}
async function bytes(file, max = 2 * 1024 * 1024) {
  await unlinked(file, 'file'); const before = await fs.lstat(file);
  requireValue(before.size > 0 && before.size <= max, 'local_asr_file_size_invalid');
  const value = await fs.readFile(file), after = await fs.lstat(file);
  requireValue(sameStat(before, after) && !after.isSymbolicLink(), 'local_asr_file_changed'); return value;
}
async function digest(file, max = 2 * 1024 * 1024 * 1024, allowEmpty = false) {
  await unlinked(file, 'file'); const before = await fs.lstat(file);
  requireValue((before.size > 0 || allowEmpty && before.size === 0) && before.size <= max, 'local_asr_file_size_invalid');
  const hash = createHash('sha256'); for await (const chunk of createReadStream(file)) hash.update(chunk);
  const after = await fs.lstat(file); requireValue(sameStat(before, after) && !after.isSymbolicLink(), 'local_asr_file_changed');
  return {sha256: hash.digest('hex'), size: after.size};
}
async function newJson(file, value) {
  const handle = await fs.open(file, 'wx', 0o600);
  try {await handle.writeFile(jsonBytes(value)); await handle.sync();} finally {await handle.close();}
}
async function readJson(file) {return JSON.parse(await bytes(file));}
async function exists(file) {try {await fs.lstat(file); return true;} catch (error) {if (error.code === 'ENOENT') return false; throw error;}}

// A lock is never stolen or expired automatically: an orphaned child might still
// be recognizing. The operator must inspect recorded PID/operation before any
// explicit recovery. Only the exact lock created by this process is released.
async function acquireLock(file, operationKey) {
  const token = randomUUID();
  try {await newJson(file, {schema, token, operationKey, pid: process.pid, createdAt: new Date().toISOString()});}
  catch (error) {if (error.code === 'EEXIST') return null; throw error;}
  return async () => {
    const value = await readJson(file); requireValue(value.token === token, 'local_asr_lock_owner_changed'); await fs.unlink(file);
  };
}

// shell:false and a private process group prevent filenames/arguments from
// becoming shell commands. Linux prlimit enforces CPU/address-space/file limits;
// the deployment container must also have its documented cgroup memory cap.
export async function runLocalAsrProcess({command, args, cwd, env, timeoutMs, maxLogBytes = 65536, beforeSpawn}, {spawnProcess = spawn} = {}) {
  // A server may queue execution behind its render/OCR CPU governor. Recheck
  // the task/source only after that slot has really been granted.
  if (beforeSpawn) {try {await beforeSpawn();} catch (error) {
    return {code: null, signal: null, closed: true, spawnError: String(error.message || error), stdout: '', stderr: ''};
  }}
  return new Promise(resolve => {
    const logs = {stdout: [], stderr: []}; let size = 0, timedOut = false, outputExceeded = false, child, settled = false, timer, killTimer;
    const finish = value => {if (settled) return; settled = true; clearTimeout(timer); clearTimeout(killTimer);
      resolve({...value, timedOut, outputExceeded, stdout: Buffer.concat(logs.stdout).toString('utf8'), stderr: Buffer.concat(logs.stderr).toString('utf8')});};
    const kill = () => {
      if (!child?.pid) return;
      killTimer ??= setTimeout(() => finish({code: null, signal: null, pid: child.pid, closed: false, terminationUncertain: true}), 5000);
      if (process.platform === 'win32') {
        const taskkill = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe');
        const killer = spawnProcess(taskkill, ['/PID', String(child.pid), '/T', '/F'], {shell: false, windowsHide: true, stdio: 'ignore'});
        killer.on('error', () => {try {child.kill('SIGKILL');} catch {}});
      } else {try {process.kill(-child.pid, 'SIGKILL');} catch {try {child.kill('SIGKILL');} catch {}}}
    };
    try {child = spawnProcess(command, args, {cwd, env, shell: false, windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe']});}
    catch (error) {finish({code: null, signal: null, closed: true, spawnError: error.code || error.message}); return;}
    for (const name of ['stdout', 'stderr']) child[name]?.on('data', data => {
      const chunk = Buffer.from(data), keep = Math.max(0, maxLogBytes - size); if (keep) logs[name].push(chunk.subarray(0, keep)); size += chunk.length;
      if (size > maxLogBytes && !outputExceeded) {outputExceeded = true; kill();}
    });
    child.on('error', error => finish({code: null, signal: null, closed: !child.pid, spawnError: error.code || error.message}));
    child.on('close', (code, signal) => finish({code, signal, pid: child.pid, closed: true}));
    timer = setTimeout(() => {timedOut = true; kill();}, timeoutMs);
    // If termination cannot be confirmed, return an explicit uncertain result;
    // the runner retains the global lock, never starts another child.
  });
}

function validateConfig(input) {
  const config = {...input};
  for (const key of ['rootDirectory', 'modelDirectory', 'vadModelFile', 'pythonPath', 'ffmpegPath', 'ffprobePath']) config[key] = absolute(config[key]);
  config.sourceRoots = (config.sourceRoots || []).map(absolute);
  requireValue(config.sourceRoots.length > 0 && config.sourceRoots.length <= 8, 'local_asr_source_roots_required');
  config.cpuThreads ??= 2; config.timeoutMs ??= 15 * 60 * 1000; config.maxSourceBytes ??= 512 * 1024 * 1024;
  config.memoryLimitBytes ??= 8 * 1024 ** 3; config.maxPending ??= 32;
  requireValue(Number.isInteger(config.cpuThreads) && config.cpuThreads >= 1 && config.cpuThreads <= 4, 'local_asr_cpu_limit_invalid');
  requireValue(Number.isInteger(config.timeoutMs) && config.timeoutMs >= 1000 && config.timeoutMs <= 30 * 60 * 1000, 'local_asr_timeout_invalid');
  requireValue(Number.isInteger(config.maxSourceBytes) && config.maxSourceBytes > 0 && config.maxSourceBytes <= 2 * 1024 ** 3, 'local_asr_source_limit_invalid');
  requireValue(Number.isInteger(config.memoryLimitBytes) && config.memoryLimitBytes >= 512 * 1024 ** 2 && config.memoryLimitBytes <= 16 * 1024 ** 3, 'local_asr_memory_limit_invalid');
  requireValue(Number.isInteger(config.maxPending) && config.maxPending >= 1 && config.maxPending <= 64, 'local_asr_queue_limit_invalid');
  if (process.platform !== 'win32') config.prlimitPath = absolute(config.prlimitPath || '/usr/bin/prlimit');
  return Object.freeze(config);
}

/** Private server API, never expose config, file paths, resolver overrides, or
 * assertSourceCurrent to an HTTP caller. The callback must re-read the current
 * authorized source and either exact formal SKU binding/revision or explicit
 * legacy single-source private receipt revision. A browser request, category
 * name, missing SKU or historical approved badge is never a legacy grant. */
export function createLocalAsrRunner(input, dependencies = {}) {
  if (!input?.enabled) return {ensureSourceEvidence: async () => ({status: 'disabled', reason: 'local_asr_not_configured', requiresReview: true, autoApproved: false})};
  const config = validateConfig(input), inflight = new Map(); let tail = Promise.resolve();
  const execute = dependencies.execute || runLocalAsrProcess;
  const resolverFactory = dependencies.resolverFactory || createAsrEvidenceResolver;
  const verify = dependencies.verifyBundle || verifyAsrBundle;

  async function checkCurrent(request, binding) {
    requireValue(await request.assertSourceCurrent(Object.freeze({...binding})) === true, 'local_asr_source_binding_changed');
    requireValue((await digest(binding.sourcePath, config.maxSourceBytes)).sha256 === binding.sourceSha256, 'local_asr_source_sha_changed');
  }
  async function trustedIdentity() {
    await unlinked(config.modelDirectory, 'directory'); const files = {};
    for (const name of LOCAL_MODEL_FILES) files[name] = await digest(path.join(config.modelDirectory, name));
    const vad = await digest(config.vadModelFile), producer = await digest(producerPath);
    return {modelFingerprintSha256: modelFingerprint(files), vadSha256: vad.sha256, producerSha256: producer.sha256};
  }
  async function resolveCompleted(store, binding) {
    const evidence = await resolverFactory(store, {localModelDirectories: [config.modelDirectory], localVadModelFiles: [config.vadModelFile]})(binding);
    const scopeMatches = binding.sourceScope
      ? evidence?.source?.skuVersion === null && evidence.source.skuBindingRevision === undefined
        && sameScope(evidence.source.sourceScope, binding.sourceScope)
      : evidence?.source?.sourceScope === undefined && evidence?.source?.skuBindingRevision === binding.skuBindingRevision;
    requireValue(evidence?.source?.id === binding.sourceId && evidence.source.sha256 === binding.sourceSha256 &&
      evidence.source.skuVersion === binding.skuVersion && scopeMatches,
    'local_asr_completed_binding_mismatch');
    const sourceBytes = await bytes(binding.sourcePath, config.maxSourceBytes);
    const bundle = verify({...evidence, sourceBytes});
    return {evidence, bundle, ...(binding.sourceScope ? {sourceScope: {...binding.sourceScope}} : {})};
  }
  async function perform(request, binding) {
    await checkCurrent(request, binding);
    const identity = await trustedIdentity();
    const operationKey = sha(JSON.stringify({schema, ...binding, ...identity, cpuThreads: config.cpuThreads}));
    const operationDirectory = path.join(config.rootDirectory, 'operations', operationKey);
    const store = path.join(operationDirectory, 'evidence');
    const completed = path.join(operationDirectory, 'completed.json');
    const publicResult = value => ({operationKey, ...value, requiresReview: true, autoApproved: false});
    await mkdirPrivate(config.rootDirectory);
    const readSaved = async () => {
      if (await exists(completed)) {
        const completion = await readJson(completed);
        const savedRequest = await readJson(path.join(operationDirectory, 'request.json'));
        requireValue(completion.schema === schema && completion.operationKey === operationKey && completion.status === 'completed'
          && sameBinding(completion.binding, binding) && savedRequest.schema === schema
          && savedRequest.operationKey === operationKey && sameBinding(savedRequest.binding, binding), 'local_asr_completion_invalid');
        const result = await resolveCompleted(store, binding); await checkCurrent(request, binding);
        return publicResult({status: 'completed', reused: true, ...result});
      }
      if (await exists(operationDirectory)) {
        const failure = path.join(operationDirectory, 'failure.json');
        if (await exists(failure)) {const saved = await readJson(failure);
          requireValue(saved.schema === schema && saved.operationKey === operationKey && ['failed', 'uncertain'].includes(saved.status), 'local_asr_failure_record_invalid');
          return publicResult({status: saved.status, reason: saved.reason, retained: true, retryable: false});}
        return publicResult({status: 'uncertain', reason: 'local_asr_incomplete_operation_requires_readback', retained: true, retryable: false});
      }
      return null;
    };
    const saved = await readSaved(); if (saved) return saved;
    const release = await acquireLock(path.join(config.rootDirectory, 'active.lock'), operationKey);
    if (!release) return publicResult({status: 'busy', reason: 'local_asr_other_worker_or_recovery_lock', retryable: true});
    let started = false, childClosed = true;
    try {
      await checkCurrent(request, binding);
      // Another worker may have finished between the first readback and lock
      // acquisition. Re-read under the global lock, not a duplicate invocation.
      const raced = await readSaved(); if (raced) return raced;
      await mkdirPrivate(path.dirname(operationDirectory));
      await fs.mkdir(operationDirectory, {mode: 0o700}); started = true;
      await newJson(path.join(operationDirectory, 'request.json'), {schema, operationKey, binding, identity, createdAt: new Date().toISOString()});
      // Executables are deployment-owned configuration, not source/receipt
      // inputs. Python venvs use a standard interpreter symlink; validate its
      // actual target but invoke the venv path so Python retains its prefix.
      for (const executable of [config.pythonPath, config.ffmpegPath, config.ffprobePath, ...(config.prlimitPath ? [config.prlimitPath] : [])])
        await unlinked(await fs.realpath(executable), 'file');
      const output = path.join(operationDirectory, 'producer-output');
      const producerArgs = ['-B', producerPath, '--input', binding.sourcePath, '--model-dir', config.modelDirectory,
        '--output-dir', output, '--ffmpeg', config.ffmpegPath, '--ffprobe', config.ffprobePath, '--cpu-threads', String(config.cpuThreads)];
      const command = config.prlimitPath || config.pythonPath;
      const args = config.prlimitPath ? [`--as=${config.memoryLimitBytes}`, `--cpu=${Math.ceil(config.timeoutMs / 1000) * config.cpuThreads + 10}`,
        '--fsize=268435456', '--nofile=128', '--', config.pythonPath, ...producerArgs] : producerArgs;
      childClosed = false;
      const processEnvironment = Object.fromEntries(['PATH', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'TMPDIR', 'LANG', 'LC_ALL']
        .filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]]));
      const processResult = await execute({command, args, cwd: operationDirectory,
        beforeSpawn: () => checkCurrent(request, binding),
        env: {...processEnvironment, PYTHONDONTWRITEBYTECODE: '1', PYTHONUNBUFFERED: '1', PYTHONNOUSERSITE: '1',
          HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1', HF_DATASETS_OFFLINE: '1', HF_HUB_DISABLE_TELEMETRY: '1',
          OMP_NUM_THREADS: String(config.cpuThreads), MKL_NUM_THREADS: String(config.cpuThreads), OPENBLAS_NUM_THREADS: String(config.cpuThreads)}, timeoutMs: config.timeoutMs});
      childClosed = processResult.closed === true;
      await newJson(path.join(operationDirectory, 'process.json'), processResult);
      requireValue(childClosed && !processResult.timedOut && !processResult.outputExceeded && !processResult.spawnError && processResult.code === 0 && !processResult.signal,
        processResult.timedOut ? 'local_asr_process_timeout' : processResult.outputExceeded ? 'local_asr_process_log_limit' : 'local_asr_process_failed');
      const receipt = JSON.parse(await bytes(path.join(output, 'receipt.json')));
      requireValue(receipt.status === 'completed' && receipt.reviewRequired === true && receipt.autoApproved === false && receipt.source?.sha256 === binding.sourceSha256,
        'local_asr_producer_not_completed');
      await checkCurrent(request, binding);
      requireValue(JSON.stringify(await trustedIdentity()) === JSON.stringify(identity), 'local_asr_model_changed');
      const data = {};
      for (const name of LOCAL_ASR_FILES.filter(name => name !== 'source.json')) data[name] = await bytes(path.join(output, name), limits[name] || 2 * 1024 * 1024);
      data['source.json'] = jsonBytes({id: binding.sourceId, productCategory: binding.productCategory, skuVersion: binding.skuVersion,
        ...(binding.sourceScope ? {sourceScope: binding.sourceScope} : {skuBindingRevision: binding.skuBindingRevision}),
        provider: 'faster-whisper', asrTaskId: receipt.taskId, sha256: binding.sourceSha256,
        durationSeconds: receipt.source.durationSeconds, srtSha256: sha(data['transcript.srt'])});
      const hashes = Object.fromEntries(LOCAL_ASR_FILES.map(name => [name, sha(data[name])]));
      const bundleSha256 = sha(JSON.stringify(LOCAL_ASR_FILES.map(name => [name, hashes[name]])));
      const folder = path.join(store, binding.sourceId, bundleSha256); await mkdirPrivate(folder);
      for (const name of LOCAL_ASR_FILES) {const handle = await fs.open(path.join(folder, name), 'wx', 0o600);
        try {await handle.writeFile(data[name]); await handle.sync();} finally {await handle.close();}}
      await newJson(path.join(store, 'manifest.json'), {schema: 'wis-authorized-asr-v1', sources: [{sourceId: binding.sourceId,
        productCategory: binding.productCategory, provider: 'faster-whisper', bundleSha256, files: hashes}]});
      const result = await resolveCompleted(store, binding); await checkCurrent(request, binding);
      await newJson(completed, {schema, operationKey, status: 'completed', completedAt: new Date().toISOString(), bundleSha256, binding, identity,
        requiresReview: true, autoApproved: false});
      return publicResult({status: 'completed', reused: false, ...result});
    } catch (error) {
      if (started) {
        const reason = String(error.message || error).slice(0, 1000), status = childClosed ? 'failed' : 'uncertain';
        await newJson(path.join(operationDirectory, 'failure.json'), {schema, operationKey, status, reason, createdAt: new Date().toISOString(), requiresReview: true, autoApproved: false});
        return publicResult({status, reason, retained: true, retryable: false});
      }
      throw error;
    } finally {if (childClosed) await release();}
  }

  function bindingForRequest(request) {
    requireValue(uuidPattern.test(request?.sourceId || ''), 'local_asr_source_id_invalid');
    requireValue(typeof request.productCategory === 'string' && request.productCategory.trim().length > 0 && request.productCategory.length <= 128,
      'local_asr_product_category_required');
    let sourceScope;
    if (request.sourceScope !== undefined) {
      requireValue(validLegacyScope(request.sourceScope), 'local_asr_legacy_source_scope_invalid');
      requireValue(absent(request.skuVersion) && absent(request.skuBindingRevision), 'local_asr_legacy_sku_conflict');
      requireValue(request.sourceScope.sourceId === request.sourceId && request.sourceScope.sourceSha256 === request.sourceSha256,
        'local_asr_legacy_source_scope_mismatch');
      // Copy and freeze before queueing: a caller cannot change the receipt
      // revision while awaiting a CPU slot or mutate the scope passed to CAS.
      sourceScope = Object.freeze({mode: 'legacy_single_source', sourceId: request.sourceId,
        sourceSha256: request.sourceSha256, revisionSha256: request.sourceScope.revisionSha256});
    } else {
      requireValue(typeof request.skuVersion === 'string' && request.skuVersion.trim().length > 0 && request.skuVersion.length <= 256,
        'local_asr_formal_sku_version_required');
      requireValue(typeof request.skuBindingRevision === 'string' && request.skuBindingRevision.trim().length > 0 && request.skuBindingRevision.length <= 256,
        'local_asr_sku_binding_revision_required');
    }
    requireValue(hashPattern.test(request.sourceSha256 || ''), 'local_asr_source_sha_required');
    requireValue(typeof request.assertSourceCurrent === 'function', 'local_asr_current_source_check_required');
    const sourcePath = absolute(request.sourcePath);
    requireValue(config.sourceRoots.some(root => {const relative = path.relative(root, sourcePath); return relative !== '' && relative !== '..' &&
      !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);}), 'local_asr_source_outside_roots');
    return Object.freeze({sourceId: request.sourceId, productCategory: request.productCategory,
      skuVersion: sourceScope ? null : request.skuVersion,
      ...(sourceScope ? {sourceScope} : {skuBindingRevision: request.skuBindingRevision}),
      sourcePath, sourceSha256: request.sourceSha256});
  }

  // Read-only terminal verification, not an ASR retry or speech/content approval.
  // Old code-2 failures deliberately keep their original generic failure record.
  // Public run status/reason never substitutes for these private original bytes.
  async function verifyTerminalInsufficientRecognition(request) {
    const rejected = reason => ({verified: false, reason, requiresReview: true, autoApproved: false});
    try {
      const binding = bindingForRequest(request);
      await checkCurrent(request, binding);
      const identity = await trustedIdentity();
      const operationKey = sha(JSON.stringify({schema, ...binding, ...identity, cpuThreads: config.cpuThreads}));
      const directory = path.join(config.rootDirectory, 'operations', operationKey), output = path.join(directory, 'producer-output');
      requireValue(!await exists(path.join(config.rootDirectory, 'active.lock')), 'local_asr_active_or_uncertain_lock');
      requireValue(!await exists(path.join(directory, 'completed.json')), 'local_asr_terminal_completion_conflict');
      const original = {};
      for (const name of ['request.json', 'failure.json', 'process.json', 'producer-output/receipt.json'])
        original[name] = await bytes(path.join(directory, name));
      const saved = JSON.parse(original['request.json']), failure = JSON.parse(original['failure.json']);
      const processRecord = JSON.parse(original['process.json']), receipt = JSON.parse(original['producer-output/receipt.json']);
      requireValue(saved.schema === schema && saved.operationKey === operationKey && sameBinding(saved.binding, binding)
        && JSON.stringify(saved.identity) === JSON.stringify(identity), 'local_asr_terminal_request_mismatch');
      requireValue(failure.schema === schema && failure.operationKey === operationKey && failure.status === 'failed'
        && failure.reason === 'local_asr_process_failed' && failure.requiresReview === true && failure.autoApproved === false,
      'local_asr_terminal_failure_mismatch');
      requireValue(processRecord.closed === true && processRecord.code === 2 && processRecord.signal === null
        && processRecord.timedOut === false && processRecord.outputExceeded === false
        && !processRecord.spawnError && !processRecord.terminationUncertain, 'local_asr_terminal_process_not_definitive');
      const report = JSON.parse(processRecord.stdout);
      requireValue(receipt.schema === 'wis-local-asr-v1' && receipt.status === 'insufficient_recognition'
        && receipt.reason === 'empty_or_missing_word_timestamp_result_not_no_speech_approval'
        && receipt.reviewRequired === true && receipt.autoApproved === false && receipt.noSpeechConfirmed === false
        && receipt.networkUsed === false && uuidPattern.test(receipt.taskId || '')
        && report.schema === receipt.schema && report.taskId === receipt.taskId && report.status === receipt.status
        && report.reviewRequired === true && report.autoApproved === false, 'local_asr_terminal_receipt_mismatch');
      const times = [saved.createdAt, receipt.createdAt, receipt.completedAt, failure.createdAt].map(Date.parse);
      requireValue(times.every(Number.isFinite) && times.every((time, i) => !i || time >= times[i - 1]), 'local_asr_terminal_time_mismatch');
      const sourceFile = await digest(binding.sourcePath, config.maxSourceBytes);
      requireValue(receipt.source?.path === binding.sourcePath && receipt.source.sha256 === binding.sourceSha256
        && receipt.source.sha256After === binding.sourceSha256 && receipt.source.unchanged === true
        && sourceFile.sha256 === binding.sourceSha256 && sourceFile.size === receipt.source.size
        && Number.isFinite(receipt.source.durationSeconds) && receipt.source.durationSeconds > 0, 'local_asr_terminal_source_mismatch');
      requireValue(receipt.model?.localFilesOnly === true && receipt.model.verifiedAfterRecognition === true
        && receipt.model.directory === config.modelDirectory && modelFingerprint(receipt.model.files) === identity.modelFingerprintSha256
        && receipt.model.fingerprintSha256 === identity.modelFingerprintSha256
        && Object.keys(receipt.model.files).sort().join('|') === [...LOCAL_MODEL_FILES].sort().join('|')
        && receipt.engine?.name === 'faster-whisper' && receipt.engine.device === 'cpu'
        && ['int8', 'int8_float32'].includes(receipt.engine.computeType)
        && receipt.engine.producerSha256 === identity.producerSha256 && receipt.engine.vadModel?.path === config.vadModelFile
        && receipt.engine.vadModel.sha256 === identity.vadSha256
        && (await digest(config.vadModelFile)).size === receipt.engine.vadModel.size, 'local_asr_terminal_identity_mismatch');
      const names = LOCAL_ASR_FILES.filter(name => !['source.json', 'receipt.json'].includes(name));
      requireValue(Object.keys(receipt.files || {}).sort().join('|') === [...names].sort().join('|'), 'local_asr_terminal_file_set_mismatch');
      const checkFiles = async () => {
        for (const name of names) {
          const actual = await digest(path.join(output, name), limits[name] || 2 * 1024 * 1024, name === 'transcript.srt');
          requireValue(actual.sha256 === receipt.files[name]?.sha256 && actual.size === receipt.files[name]?.size,
            'local_asr_terminal_artifact_changed');
        }
      };
      await checkFiles();
      const transcript = await readJson(path.join(output, 'transcript.json')), settings = receipt.recognition?.settings;
      requireValue(receipt.recognition?.segmentCount === 0 && receipt.recognition.wordCount === 0
        && receipt.recognition.textRewritten === false && receipt.recognition.srtTimeBasis === 'source_native_audio_frame_piecewise_seconds'
        && settings?.language === 'zh' && settings.beam_size === 5 && settings.word_timestamps === true && settings.vad_filter === true
        && settings.condition_on_previous_text === false && settings.temperature === 0 && settings.initial_prompt === null && settings.hotwords === null
        && transcript.schema === 'wis-local-asr-transcript-v1' && transcript.taskId === receipt.taskId
        && transcript.sourceSha256 === binding.sourceSha256 && transcript.audioSha256 === receipt.files['audio.wav'].sha256
        && receipt.audio?.sha256 === transcript.audioSha256 && receipt.audio.size === receipt.files['audio.wav'].size
        && receipt.audio.file === 'audio.wav' && receipt.audio.sampleRate === 16000 && receipt.audio.channels === 1
        && transcript.modelFingerprintSha256 === identity.modelFingerprintSha256 && transcript.timeBasis === 'decoded_audio_seconds'
        && transcript.sourceTimeOffsetSeconds === receipt.audio.sourceTimeOffsetSeconds
        && transcript.sourceTimeMappingRule === receipt.audio.timelineValidation?.mappingRule
        && transcript.sourceTimeMappingSha256 === receipt.audio.timelineValidation?.mappingSha256
        && hashPattern.test(transcript.sourceTimeMappingSha256 || '') && transcript.textRewritten === false
        && Array.isArray(transcript.segments) && transcript.segments.length === 0 && receipt.files['transcript.srt'].size === 0,
      'local_asr_terminal_not_zero_recognition');
      // Recheck every retained artifact and current binding after all I/O. No
      // lock deletion, failure rewrite, evidence publication or child spawn.
      await checkFiles();
      for (const [name, data] of Object.entries(original))
        requireValue(data.equals(await bytes(path.join(directory, name))), 'local_asr_terminal_record_changed');
      requireValue(JSON.stringify(await trustedIdentity()) === JSON.stringify(identity), 'local_asr_model_changed');
      requireValue(!await exists(path.join(config.rootDirectory, 'active.lock')) && !await exists(path.join(directory, 'completed.json')),
        'local_asr_terminal_state_changed');
      await checkCurrent(request, binding);
      requireValue(await request.assertSourceCurrent(Object.freeze({...binding})) === true, 'local_asr_source_binding_changed');
      return {verified: true, status: 'technical_unusable', reason: 'insufficient_recognition', operationKey,
        receiptSha256: sha(original['producer-output/receipt.json']), sourceSha256: binding.sourceSha256,
        retained: true, retryable: false, requiresReview: true, autoApproved: false, noSpeechConfirmed: false};
    } catch (error) {return rejected(String(error.message || error).slice(0, 200));}
  }

  async function ensureSourceEvidence(request) {
    const binding = bindingForRequest(request);
    const key = sha(JSON.stringify(binding));
    // Each caller has its own final CAS, even when recognition is coalesced.
    if (!inflight.has(key)) {
      if (inflight.size >= config.maxPending) return {status: 'busy', reason: 'local_asr_queue_full', retryable: true, requiresReview: true, autoApproved: false};
      const pending = tail.then(() => perform(request, binding));
      tail = pending.catch(() => {}); inflight.set(key, pending);
      pending.finally(() => inflight.delete(key)).catch(() => {});
    }
    const result = await inflight.get(key); await checkCurrent(request, binding); return result;
  }
  return {ensureSourceEvidence, verifyTerminalInsufficientRecognition};
}
