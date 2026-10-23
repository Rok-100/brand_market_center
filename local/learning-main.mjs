// Internal service only: the single browser entry remains the 8095 gateway.
import express from '/learning-source/training/node_modules/express/index.js';
import { createApp } from '/learning-source/training/server/app.mjs';
import { hubIdentity } from '/learning-source/hub-identity.mjs';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
if (process.env.LOCAL_SIMULATION !== '1') throw new Error('Local simulation only');
const secretPath = '/data/csrf-secret';
if (!existsSync(secretPath)) writeFileSync(secretPath, randomBytes(32).toString('hex'), { mode: 0o600 });
const training = createApp({
  dbPath: '/data/learning.sqlite', basePath: '/learning/',
  publicOrigin: process.env.PUBLIC_ORIGIN || ('http://127.0.0.1:'+(process.env.HUB_PORT||8095)),
  csrfSecret: readFileSync(secretPath, 'utf8'),
  identityProvider: req => hubIdentity(req, new URL(process.env.HUB_GATEWAY_URL || 'http://gateway:8080'),
    (url, options) => fetch(url, { ...options, headers: { ...options.headers,
      'x-local-test-role': req.headers['x-local-test-role'] || 'admin' } })),
});
const app = express();
app.disable('x-powered-by');
app.enable('strict routing');
app.get('/learning', (_req, res) => res.redirect('/learning/'));
app.use('/learning', training.app);
app.use(express.static('/hub-dist', { index: 'index.html', maxAge: 0,
  setHeaders: res => res.setHeader('Cache-Control', 'no-store') }));
const server = app.listen(3000, '0.0.0.0');
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.close(() => {
  training.close(); process.exit(0);
}));
