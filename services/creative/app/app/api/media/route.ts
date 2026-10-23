import { streamGet, streamHead } from "./stream";

export async function HEAD(request: Request) {
  const key = new URL(request.url).searchParams.get("key") ?? "";
  if (!key) return new Response(null, { status: 400 });
  return streamHead(key);
}

export async function GET(request: Request) {
  const key = new URL(request.url).searchParams.get("key") ?? "";
  if (!key) return new Response("Missing media key", { status: 400 });
  return streamGet(request, key);
}
