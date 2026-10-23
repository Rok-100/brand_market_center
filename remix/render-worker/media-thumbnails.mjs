import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

// Small derived JPEGs, isolated from production originals and approval state.
export function createThumbnails({ directory, runFfmpeg }) {
  const pending = new Map();
  const waiters = [];
  let active = 0;
  const pump = () => {
    while (active < 2 && waiters.length) {
      active++;
      const next = waiters.shift();
      next();
    }
  };
  return async (identity, resolveFile) => {
    const key = createHash('sha256').update(JSON.stringify(identity)).digest('hex');
    const target = path.join(directory, key + '.jpg');
    try { if ((await fs.stat(target)).size > 0) return target; } catch (e) { if (e.code !== 'ENOENT') throw e; }
    if (pending.has(key)) return pending.get(key);
    if (pending.size >= 32) throw Object.assign(new Error('封面正在排队，请稍后重试'), { statusCode: 503 });
    const operation = (async () => {
      await new Promise(resolve => { waiters.push(resolve); pump(); });
      const temporary = path.join(directory, randomUUID() + '.jpg');
      try {
        await fs.mkdir(directory, { recursive: true });
        const file = await resolveFile();
        await runFfmpeg(['-i', file, '-frames:v', '1', '-vf', 'scale=180:320:force_original_aspect_ratio=decrease',
          '-q:v', '5', '-threads', '1', temporary]);
        if (!(await fs.stat(temporary)).size) throw new Error('封面生成失败');
        await fs.rename(temporary, target);
        return target;
      } finally {
        await fs.rm(temporary, { force: true });
        active--; pump();
      }
    })();
    pending.set(key, operation);
    try { return await operation; } finally { pending.delete(key); }
  };
}
