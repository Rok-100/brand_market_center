import { streamGet, streamHead } from "../stream";

type RouteContext = { params: Promise<{ key: string[] | string }> };

async function storageKey(context: RouteContext) {
  const { key } = await context.params;
  return Array.isArray(key) ? key.join("/") : key;
}

export async function HEAD(_request: Request, context: RouteContext) {
  return streamHead(await storageKey(context));
}

export async function GET(request: Request, context: RouteContext) {
  return streamGet(request, await storageKey(context));
}
