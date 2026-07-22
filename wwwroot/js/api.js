// Same-origin only — Cloudflare Access protects this whole subdomain, so the browser's
// Access session cookie rides along automatically. No app-level auth here at all.
var API_BASE = '/api';

async function apiFetch(path, opts) {
  opts = opts || {};
  var res = await fetch(API_BASE + path, {
    method: opts.method || 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  var data = await res.json().catch(function () { return {}; });
  if (!res.ok) throw Object.assign(new Error(data.error || 'request_failed'), { status: res.status, data: data });
  return data;
}
