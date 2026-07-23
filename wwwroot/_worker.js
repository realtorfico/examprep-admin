/**
 * examprep-admin Worker (Cloudflare Pages "Advanced Mode" — must be named
 * _worker.js at the root of the deployed directory).
 *
 * Cloudflare Access gates this whole subdomain at the edge (see README) — this
 * worker's job is just to serve static assets and proxy /api/* to examprep-api
 * via a Service Binding, forwarding the Cf-Access-Jwt-Assertion header so the
 * backend can re-validate it (second layer of auth).
 */
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      // app.js already calls paths like /console/codes (matching the backend's real
      // routes) via API_BASE=/api, so this only strips the /api prefix — it must NOT
      // also prepend /console, or requests double up to /console/console/... (404).
      const target = new URL(request.url);
      target.pathname = url.pathname.replace(/^\/api/, '');
      const proxied = new Request(target, request);
      return env.API.fetch(proxied);
    }
    return env.ASSETS.fetch(request);
  },
};
