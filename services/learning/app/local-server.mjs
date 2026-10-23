import express from './training/node_modules/express/index.js';
import { request as httpRequest } from 'node:http';
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createApp } from './training/server/app.mjs';
import { hubIdentity } from './hub-identity.mjs';

const root = fileURLToPath(new URL('.', import.meta.url));
const upstream = new URL(process.env.LOCAL_HUB_URL || 'http://127.0.0.1:8095');
if (upstream.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(upstream.hostname)) {
  throw new Error('本地验收入口只允许连接本机中枢');
}
if (process.env.NODE_ENV === 'production') throw new Error('本地验收启动器不能用于生产部署');
const port = Number(process.env.PORT || 8096);
const data = resolve(root, '.local');
mkdirSync(data, { recursive: true });
const secretFile = resolve(data, 'csrf-secret');
if (!existsSync(secretFile)) writeFileSync(secretFile, randomBytes(32).toString('hex'), { mode: 0o600 });
const training = createApp({
  dbPath: resolve(data, 'learning.sqlite'),
  basePath: '/learning/',
  publicOrigin: `http://127.0.0.1:${port}`,
  csrfSecret: readFileSync(secretFile, 'utf8'),
  identityProvider: req => hubIdentity(req, upstream),
});
const app = express();
app.disable('x-powered-by');
app.enable('strict routing');
app.get('/learning', (_req, res) => res.redirect('/learning/'));
app.use('/learning', training.app);
app.use(express.static(resolve(root, '../../fd-026222-hub-r65-owner-only-safeoff-20260925/app/dist'), { index: 'index.html', maxAge: 0 }));
// Preserve all existing local module routes and session cookies.
app.use((req, res) => {
  const headers = { ...req.headers, host: upstream.host };
  delete headers.connection;
  const proxy = httpRequest(new URL(req.originalUrl, upstream), {
    method: req.method, headers,
  }, response => {
    const responseHeaders = { ...response.headers };
    delete responseHeaders.connection;
    res.writeHead(response.statusCode, responseHeaders);
    response.pipe(res);
  });
  proxy.setTimeout(30000, () => proxy.destroy(new Error('本地中枢请求超时')));
  proxy.on('error', () => {
    if (!res.headersSent) res.status(502).json({ error: '本地中枢暂不可用，请检查 8095 服务' });
    else res.end();
  });
  req.on('aborted', () => proxy.destroy());
  req.pipe(proxy);
});
const server = app.listen(port, '127.0.0.1', () => {
  console.log(`学习中心本地验收：http://127.0.0.1:${port}/#learning-center`);
});
const shutdown = () => server.close(() => { training.close(); process.exit(0); });
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
