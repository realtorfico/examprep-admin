# examprep-admin — admin.examprep.softician.com

Vanilla JS, no framework/build step. Static on Cloudflare Pages, gated entirely by
Cloudflare Access (Zero Trust) — no app-level login.

## One-time Cloudflare setup
1. Zero Trust > Access > Applications > Add > Self-hosted, domain `examprep-admin.softician.com`,
   policy: allow your email(s). (Reuses the team/IdP already set up for loantechies-admin.)
2. Pages: create the `examprep-admin` project (git-connected), add the custom domain, add the
   Service Binding to `examprep-api` (Settings > Bindings).
3. Copy the Access app's AUD tag into `examprep-api`'s `CF_ACCESS_AUD` secret.

## Local dev
`dotnet run` serves `wwwroot/` statically (no Access gate locally — API calls to
`/api/console/*` will 401 without a real Access JWT; UI layout can still be checked).
