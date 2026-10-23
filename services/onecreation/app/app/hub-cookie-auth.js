"use strict";

// The new hub keeps all modules on one origin. The central authority issues
// this HttpOnly cookie after the single hub login; the workbench still validates
// its value with the authority before granting any page or API access.
function forwardedOaToken(req) {
  const header = String(req?.headers?.["x-oa-token"] || "").trim();
  if (header) return header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : header;
  const cookieHeader = String(req?.headers?.cookie || "");
  const cookies = cookieHeader.split(";").map((part) => part.trim());
  const encoded = ["wis_oa_session", "authorization", "oa-authorization"].map((name) => cookies
    .map((part) => {
      const separator = part.indexOf("=");
      return separator > 0 && part.slice(0, separator).trim() === name
        ? part.slice(separator + 1) : "";
    }).find(Boolean)).find(Boolean);
  if (!encoded || encoded.length > 8192) return "";
  try {
    const token = decodeURIComponent(encoded).trim();
    return token.toLowerCase().startsWith("bearer ") ? token.slice(7).trim() : token;
  } catch {
    return "";
  }
}

module.exports = { forwardedOaToken };
