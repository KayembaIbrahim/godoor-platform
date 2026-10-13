# GoDoor (godoor.site) — Cloudflare Migration Status

## Account / Zone
- Cloudflare account: `f98f2ada83a694712cb0487335b2ae76` (email: Ibrahimkapoor11@gmail.com)
- Zone: `godoor.site` (zone id `4a437a3d3bd702ed1e638b5da30bd2f0`) — DNS still on Vercel nameservers
- wrangler: v4 (logged in, token valid)

## Repo state
- Repo: `https://github.com/ibrahimkapoor/go-door` (local path `/workspace/swift-lovelace`)
- All feature fixes are committed: `/business/bookings` page, store settings weekday `open_days` selector, elastic button bounces, true-black dark theme
- Latest commit HEAD: `7467a11` (config-only). Build fixes in working tree / subsequent commit.

## Build environment
- Next.js 16.4.0, Turbopack, Node 22
- Memory is tight (~1GB usable); build must run as:
  `node --max-old-space-size=2048 $(npx -y which next) build`
- Required build output: `.next/standalone` + `.vercel/output/static`

## What worked
- `next build` completes (with the `--max-old-space-size=2048` flag)
- `@cloudflare/next-on-pages@1.13.16` installed (supports Next 14–15; Next 16.x needs a workaround)
- All 85 route handlers must run as Node, not Edge (app uses `node:crypto`, `node:fs`, `node:path`, etc.)

## What broke (fix needed)
Every `route.ts` under `src/app/api/` and `src/app/schema-sql/` needs:
  `export const runtime = "nodejs";`  (NOT "edge")
This must be the FIRST line of each file. 9 files previously had it injected INSIDE
multi-line `import { ... }` blocks — that is a syntax error and must be moved outside.
Two files (schema-sql/route.ts, api/admin/push-migrate/route.ts) are missing required
`node:fs` / `node:path` imports that my edit stripped — restore them.

## Target deployment
1. Fix all route files: `export const runtime = "nodejs";` as first line; restore stripped imports.
2. Rebuild: `node --max-old-space-size=2048 next build` (verify `.next/build-manifest.json` exists).
3. Convert: `npx @cloudflare/next-on-pages` → outputs `.vercel/output/static`.
   (If next-on-pages choke on Next 16, run the adapter from the Next 16 binary dir or
   use `vercel build --json` then deploy the output.)
4. Deploy: `wrangler pages deploy .vercel/output/static --project-name=godoor-platform`
5. Bind secrets: `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `MAPBOX_TOKEN`
   (from `.env.local` — set in Pages project settings, not committed).
6. Attach custom domain `godoor.site` to the Pages project; confirm CNAME/proxy in zone.

## Notes / gotchas
- The app is a PWA (service worker registered from `/app`); verify sw registration on CF.
- Admin portal lives under hidden `/admin*` paths with token guard — must stay 404 for public.
- No Vercel-specific APIs (Edge Config/Analytics) are used, so the port is safe.

## Ask for Cloudflare AI
- Suggest the cleanest way to get Next 16.4.0 through `@cloudflare/next-on-pages` (or an
  equivalent Pages-compatible build path) given the memory ceiling.
- Confirm `runtime = "nodejs"` + Node builtins are acceptable for the API routes on Pages.
- Validate the deployment steps above, especially the `.vercel/output/static` output format.
