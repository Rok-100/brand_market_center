import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
process.env.LOCAL_PREVIEW='true';
process.env.DB_PATH ||= fileURLToPath(new URL('../var/preview.sqlite',import.meta.url));
process.env.CSRF_SECRET=randomBytes(32).toString('hex');
await import('../server/index.mjs');
