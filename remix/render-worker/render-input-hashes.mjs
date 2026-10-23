import fs from 'node:fs/promises';

const versionOf = stat => [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join(':');
// One render operation only. The post-render integrity gate must use the raw
// hasher, never this cache. A rejected or changed read cannot seed the cache.
export function createRenderInputHashes(hashFile, {stat = file => fs.stat(file, {bigint: true})} = {}) {
  const entries = new Map();
  return async file => {
    const before = await stat(file);
    if (!before.isFile()) throw new Error('Render input is not a regular file');
    const version = versionOf(before);
    const previous = entries.get(file);
    if (previous?.version === version) return previous.promise;
    const entry = {version};
    entry.promise = (async () => {
      const digest = await hashFile(file);
      const after = await stat(file);
      if (versionOf(after) !== version) throw Object.assign(new Error('Render input changed during verification'), {code: 'MEDIA_CHANGED'});
      return digest;
    })().catch(error => {
      if (entries.get(file) === entry) entries.delete(file);
      throw error;
    });
    entries.set(file, entry);
    return entry.promise;
  };
}
