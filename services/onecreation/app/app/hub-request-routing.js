"use strict";

const allowedHubBases = new Set([
  "/yxb/wis-marketing-hub",
  "/fd-026222/wis-marketing-hub",
]);

const materialStaticPaths = new Set([
  "/remix.html", "/remix.js", "/remix.css", "/styles.css", "/knowledge-context.js",
]);
const materialApiPrefixes = [
  "/api/remix/", "/api/material-center/", "/api/team-workbench/",
  "/api/qianchuan/", "/api/v1/remix/",
];
function isMaterialPath(pathname) {
  return materialStaticPaths.has(pathname) || pathname === "/api/file" || pathname === "/api/image"
    || pathname === "/api/auth/status" || materialApiPrefixes.some((prefix) => pathname.startsWith(prefix));
}

function routeIntegratedRequest(rawUrl, integratedMode, hubBasePath = process.env.HUB_PUBLIC_BASE_PATH || "/yxb/wis-marketing-hub/") {
  if (!integratedMode) return { moduleKey: "ai-first-creation", path: rawUrl };
  const hubBase = String(hubBasePath).replace(/\/+$/u, "");
  if (!allowedHubBases.has(hubBase)) return null;
  const routes = {
    "ai-first-creation": `${hubBase}/modules/ai-first-creation`,
    "material-workbench": `${hubBase}/modules/material-workbench`,
  };
  if (rawUrl === "/api/health" || rawUrl.startsWith("/api/health?")) {
    return { moduleKey: null, path: rawUrl };
  }
  const question = rawUrl.indexOf("?");
  const pathname = question < 0 ? rawUrl : rawUrl.slice(0, question);
  const query = question < 0 ? "" : rawUrl.slice(question);
  // URL() normalizes dot segments after this check. Reject encoded and plain
  // dot segments before an allowed remix API prefix can be turned into a
  // different privileged route.
  if (/%2f|%5c|%2e|\\|(?:^|\/)\.{1,2}(?:\/|$)/iu.test(pathname)) return null;
  for (const [moduleKey, prefix] of Object.entries(routes)) {
    if (pathname === prefix || pathname === `${prefix}/`) {
      return { moduleKey, path: `${moduleKey === "material-workbench" ? "/remix.html" : "/"}${query}` };
    }
    if (pathname.startsWith(`${prefix}/`)) {
      const internalPath = pathname.slice(prefix.length);
      if (moduleKey === "material-workbench" && !isMaterialPath(internalPath)) return null;
      return { moduleKey, path: `${internalPath}${query}` };
    }
  }
  return null;
}

module.exports = { routeIntegratedRequest };
