/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import { authorizeCreativeHttp } from "../lib/creative-gate";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  MEDIA: R2Bucket;
  HUB_INTEGRATED_MODE?: string;
  HUB_PUBLIC_BASE_PATH?: string;
  CENTRAL_AUTHORITY_BASE?: string;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/health" && request.method === "GET") {
      return Response.json({ status: "ok", service: "creative-workbench" }, {
        headers: { "Cache-Control": "no-store" },
      });
    }

    if (env.HUB_INTEGRATED_MODE === "1") {
      const access = await authorizeCreativeHttp(request, env.CENTRAL_AUTHORITY_BASE ?? "");
      if (access.status !== 200) {
        const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
        if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/_vinext/")) {
          return Response.json({ error: access.error }, { status: access.status, headers });
        }
        const loginUrl = env.HUB_PUBLIC_BASE_PATH === "/fd-026222/wis-marketing-hub/"
          ? env.HUB_PUBLIC_BASE_PATH
          : "/yxb/wis-marketing-hub/";
        return new Response(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>创意来源暂未载入</title><body><h2>创意来源暂未载入</h2><p>统一登录或模块权限尚未通过校验。当前中枢与其他工作区保持打开。</p><button onclick="location.reload()">重新核验</button><a href="${loginUrl}" target="_top">返回中枢</a></body></html>`, {
          status: access.status,
          headers: { ...headers, "Content-Type": "text/html; charset=utf-8" },
        });
      }
    }

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    return handler.fetch(request, env, ctx);
  },
};

export default worker;
