export function oaTokenFromHeaders(headers: Headers): string {
  const ingressToken = headers.get("x-oa-token")?.trim() ?? "";
  if (ingressToken) return ingressToken.replace(/^Bearer\s+/i, "").trim();

  const cookie = headers.get("cookie") ?? "";
  const parts = cookie.split(";").map((part) => part.trim());
  const encoded = ["wis_oa_session", "authorization", "oa-authorization"].map((name) => parts.map((part) => {
    const separator = part.indexOf("=");
    return separator > 0 && part.slice(0, separator).trim() === name
      ? part.slice(separator + 1) : "";
  }).find(Boolean)).find(Boolean);
  if (!encoded || encoded.length > 8192) return "";
  try {
    return decodeURIComponent(encoded).replace(/^Bearer\s+/i, "").trim();
  } catch {
    return "";
  }
}
