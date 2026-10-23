import { env } from "cloudflare:workers";

const MAX_RANGE_BYTES = 4 * 1024 * 1024;

function mediaHeaders(object: R2Object) {
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("accept-ranges", "bytes");
  headers.set("cache-control", "private, max-age=3600");
  if (!headers.has("content-type")) headers.set("content-type", "application/octet-stream");
  return headers;
}

function parseRange(value: string, size: number) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (!match || (!match[1] && !match[2])) return null;
  let start: number;
  let end: number;
  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) return null;
    start = Math.max(size - suffixLength, 0);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : size - 1;
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start >= size || end < start) return null;
  end = Math.min(end, size - 1, start + MAX_RANGE_BYTES - 1);
  return { start, end, length: end - start + 1 };
}

export async function streamHead(key: string) {
  const object = await env.MEDIA.head(key);
  if (!object) return new Response(null, { status: 404 });
  const headers = mediaHeaders(object);
  headers.set("content-length", String(object.size));
  return new Response(null, { headers });
}

export async function streamGet(request: Request, key: string) {
  const metadata = await env.MEDIA.head(key);
  if (!metadata) return new Response("Not found", { status: 404 });
  const rangeHeader = request.headers.get("range");
  if (rangeHeader) {
    const range = parseRange(rangeHeader, metadata.size);
    if (!range) return new Response("Requested range not satisfiable", { status: 416, headers: { "accept-ranges": "bytes", "content-range": `bytes */${metadata.size}` } });
    const object = await env.MEDIA.get(key, { range: { offset: range.start, length: range.length } });
    if (!object) return new Response("Not found", { status: 404 });
    const headers = mediaHeaders(metadata);
    headers.set("content-length", String(range.length));
    headers.set("content-range", `bytes ${range.start}-${range.end}/${metadata.size}`);
    return new Response(object.body, { status: 206, headers });
  }
  const object = await env.MEDIA.get(key);
  if (!object) return new Response("Not found", { status: 404 });
  const headers = mediaHeaders(metadata);
  headers.set("content-length", String(metadata.size));
  return new Response(object.body, { headers });
}
