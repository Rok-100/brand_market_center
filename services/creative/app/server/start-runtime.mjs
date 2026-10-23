if (!/^https?:\/\//.test(process.env.OA_USERINFO_URL || "")) throw new Error("OA_USERINFO_URL is required");
import { companyAiProxy } from "./company-ai-proxy.mjs";
import http from "node:http";
import { spawn } from "node:child_process";

const proxy = http.createServer(async (request, response) => {
  if (await companyAiProxy(request, response)) return;
  if (request.method !== "GET" || request.url !== "/userinfo") {
    response.writeHead(404).end();
    return;
  }

  const token = String(request.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) {
    response.writeHead(401, { "content-type": "application/json" }).end(JSON.stringify({ code: 401, msg: "missing token" }));
    return;
  }

  try {
    const upstream = await fetch(process.env.OA_USERINFO_URL, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(8000),
    });
    const body = await upstream.text();
    response.writeHead(upstream.status, { "content-type": upstream.headers.get("content-type") || "application/json", "cache-control": "no-store" });
    response.end(body);
  } catch {
    response.writeHead(502, { "content-type": "application/json" }).end(JSON.stringify({ code: 502, msg: "userinfo unavailable" }));
  }
});

proxy.listen(3001, "127.0.0.1", () => console.log("OA identity proxy ready on 127.0.0.1:3001"));

const wranglerArgs = ["exec", "wrangler", "dev", "--config", "wrangler.internal.jsonc", "--ip", "0.0.0.0", "--port", "3000", "--persist-to", "/app/.wrangler"];
if (process.env.PINYING_DATA_URL) wranglerArgs.push("--var", `PINYING_DATA_URL:${process.env.PINYING_DATA_URL}`);
const authorityBase = String(process.env.CENTRAL_AUTHORITY_BASE || "").trim().replace(/\/+$/, "");
if (process.env.HUB_INTEGRATED_MODE === "1" && !/^https?:\/\/[^\s/?#]+(?:\/[^?#]*)?$/u.test(authorityBase)) {
  throw new Error("统一中枢模式要求配置 CENTRAL_AUTHORITY_BASE");
}
if (authorityBase) wranglerArgs.push("--var", `CENTRAL_AUTHORITY_BASE:${authorityBase}`);
if (process.env.HUB_INTEGRATED_MODE === "1") wranglerArgs.push("--var", "HUB_INTEGRATED_MODE:1");

const worker = spawn("pnpm", wranglerArgs, {
  stdio: "inherit",
  env: process.env,
});

const shutdown = (signal) => {
  proxy.close();
  worker.kill(signal);
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
worker.on("exit", (code) => process.exit(code ?? 1));
