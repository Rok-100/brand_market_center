import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

// Private loopback bridge: Node uses the container's trusted CA store.
// Only these fixed company endpoints are reachable; no caller-supplied URL.
export async function companyAiProxy(request, response) {
  const paths = { '/company-ai/models': 'GET', '/company-ai/chat/completions': 'POST' };
  if (!Object.hasOwn(paths, request.url || '')) return false;
  const reply = (status, message) => response.writeHead(status, {'Content-Type':'application/json','Cache-Control':'no-store'}).end(JSON.stringify({error:{message}}));
  if (request.method !== paths[request.url]) { reply(405, 'Method not allowed'); return true; }
  const token = String(request.headers.authorization || '').replace(/^Bearer\s+/iu, '').trim();
  if (!token || request.headers.sys_name !== 'brand-market-center') { reply(401, 'OA session required'); return true; }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(),180000);
  const close = () => { if (!response.writableFinished) controller.abort(); };
  response.on('close',close);
  try {
    let body;
    if (request.method === 'POST') {
      const parts=[];let size=0;
      for await (const part of request) { size+=part.length;if(size>256000){reply(413,'Request too large');return true;}parts.push(part); }
      body=Buffer.concat(parts);
    }
    const upstream = await fetch('https://cloud.fandow.com/gpt/company-system-jump/v1'+request.url.slice('/company-ai'.length), {
      method:request.method, redirect:'manual', signal:controller.signal,
      headers:{Authorization:'Bearer '+token,sys_name:'brand-market-center','Content-Type':'application/json',Accept:'text/event-stream'}, body
    });
    response.writeHead(upstream.status,{'Content-Type':upstream.headers.get('content-type')||'application/json','Cache-Control':'no-store'});
    if (upstream.body) await pipeline(Readable.fromWeb(upstream.body),response);
    else response.end();
  } catch {
    if (!response.headersSent) reply(502,'Company AI unavailable');
    else response.destroy();
  } finally { clearTimeout(timer);response.off('close',close); }
  return true;
}
