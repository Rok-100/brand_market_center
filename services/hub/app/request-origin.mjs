// Browser-origin checks supplement OA identity and role checks; internal clients
// without browser headers still need the normal credentials and permissions.
export function browserSourceAllowed(request) {
  const headers = request.headers || {};
  const host = typeof headers.host === 'string' ? headers.host.trim().toLowerCase() : '';
  if (typeof headers['sec-fetch-site'] === 'string' && headers['sec-fetch-site'].toLowerCase() === 'cross-site') return false;
  for (const key of ['origin', 'referer']) {
    if (headers[key] === undefined) continue;
    if (typeof headers[key] !== 'string') return false;
    try {
      const value = new URL(headers[key]);
      if (!host || !['http:', 'https:'].includes(value.protocol) || value.host.toLowerCase() !== host || value.username || value.password) return false;
    } catch { return false; }
  }
  return true;
}

export function forwardedBrowserSourceHeaders(request) {
  const headers = request.headers || {};
  const result = {};
  // Never trust a caller-supplied X-Forwarded-Host to validate their own Origin.
  if (typeof headers.host === 'string') result['X-Forwarded-Host'] = headers.host;
  for (const [source, target] of [['origin', 'Origin'], ['referer', 'Referer'], ['sec-fetch-site', 'Sec-Fetch-Site']]) {
    if (typeof headers[source] === 'string') result[target] = headers[source];
  }
  return result;
}

export function permissionWriteSourceAllowed(request, pathname) {
  return !pathname.startsWith('/api/permissions/') || !['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method) || browserSourceAllowed(request);
}
