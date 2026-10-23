import path from 'node:path';

// Configuration is supplied only by the deployment owner. Nothing from an HTTP
// body, media filename or ASR receipt can expand the trusted local model roots.
export function localAsrResolverOptions(env = process.env) {
  const read = name => {
    const raw = String(env[name] || '').trim();
    if (!raw) return [];
    let values;
    try { values = JSON.parse(raw); } catch { throw Error(`invalid_${name}`); }
    if (!Array.isArray(values) || values.length > 8 || values.some(value =>
      typeof value !== 'string' || !value || value.trim() !== value ||
      !path.isAbsolute(value) || /[\0\r\n]/u.test(value) ||
      /^[\\/]{2}/u.test(value) || value.split(/[\\/]/u).includes('..')) ||
      new Set(values.map(value => path.resolve(value))).size !== values.length)
      throw Error(`invalid_${name}`);
    return values.map(value => path.resolve(value));
  };
  const localModelDirectories = read('WIS_LOCAL_ASR_MODEL_DIRECTORIES');
  const localVadModelFiles = read('WIS_LOCAL_ASR_VAD_MODEL_FILES');
  if (Boolean(localModelDirectories.length) !== Boolean(localVadModelFiles.length))
    throw Error('incomplete_local_asr_allowlist');
  return {localModelDirectories, localVadModelFiles};
}

// Only the server constructs this configuration. sourceRoots must be the
// actual upload/playback roots whose sources the caller is authorized to read.
export function localAsrRunnerOptions(env = process.env, {dataDirectory, sourceRoots} = {}) {
  const flag = String(env.WIS_LOCAL_ASR_RUNNER_ENABLED || '').trim();
  if (['', '0', 'false'].includes(flag)) return {enabled: false};
  if (!['1', 'true'].includes(flag)) throw Error('invalid_WIS_LOCAL_ASR_RUNNER_ENABLED');
  const allowlist = localAsrResolverOptions(env);
  const select = (key, values) => {
    const value = env[key] || (values.length === 1 ? values[0] : '');
    if (typeof value !== 'string' || !value || !path.isAbsolute(value) || value.trim() !== value || /[\0\r\n]/u.test(value) ||
      /^[\\/]{2}/u.test(value) || value.split(/[\\/]/u).includes('..') || !values.includes(path.resolve(value))) throw Error(`untrusted_${key}`);
    return path.resolve(value);
  };
  const absolute = (key, fallback) => {
    const value = String(env[key] || fallback || '');
    if (!value || !path.isAbsolute(value) || value.trim() !== value || /[\0\r\n]/u.test(value) ||
      /^[\\/]{2}/u.test(value) || value.split(/[\\/]/u).includes('..')) throw Error(`invalid_${key}`);
    return path.resolve(value);
  };
  const number = (key, fallback, min, max) => {
    const value = env[key] === undefined ? fallback : Number(env[key]);
    if (!Number.isInteger(value) || value < min || value > max) throw Error(`invalid_${key}`);
    return value;
  };
  if (!dataDirectory || !path.isAbsolute(dataDirectory) || !Array.isArray(sourceRoots) || !sourceRoots.length ||
    sourceRoots.length > 8 || sourceRoots.some(root => typeof root !== 'string' || !path.isAbsolute(root))) throw Error('local_asr_server_paths_missing');
  return {enabled: true,
    rootDirectory: absolute('WIS_LOCAL_ASR_RUNTIME_DIR', path.join(dataDirectory, 'local-asr-runtime')),
    sourceRoots: sourceRoots.map(root => path.resolve(root)),
    modelDirectory: select('WIS_LOCAL_ASR_RUNNER_MODEL_DIRECTORY', allowlist.localModelDirectories),
    vadModelFile: select('WIS_LOCAL_ASR_RUNNER_VAD_MODEL_FILE', allowlist.localVadModelFiles),
    pythonPath: absolute('WIS_LOCAL_ASR_PYTHON_PATH', process.platform === 'win32' ? null : '/opt/local-asr-venv/bin/python3'),
    ffmpegPath: absolute('WIS_LOCAL_ASR_FFMPEG_PATH', process.platform === 'win32' ? null : '/usr/bin/ffmpeg'),
    ffprobePath: absolute('WIS_LOCAL_ASR_FFPROBE_PATH', process.platform === 'win32' ? null : '/usr/bin/ffprobe'),
    ...(process.platform === 'win32' ? {} : {prlimitPath: absolute('WIS_LOCAL_ASR_PRLIMIT_PATH', '/usr/bin/prlimit')}),
    cpuThreads: number('WIS_LOCAL_ASR_CPU_THREADS', 2, 1, 4),
    timeoutMs: number('WIS_LOCAL_ASR_TIMEOUT_MS', 900000, 1000, 1800000),
    maxSourceBytes: number('WIS_LOCAL_ASR_MAX_SOURCE_BYTES', 536870912, 1, 2147483648),
    memoryLimitBytes: number('WIS_LOCAL_ASR_MEMORY_LIMIT_BYTES', 8589934592, 536870912, 17179869184),
    maxPending: number('WIS_LOCAL_ASR_MAX_PENDING', 32, 1, 64)};
}
