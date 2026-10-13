# GoDoor Platform — Cloudflare Migration Status Summary

## Repo
- Path: `/workspace/swift-lovelace`
- Framework: Next.js 16.4.0 (App Router), React 19, TypeScript
- Current HEAD: `d08367b` — "set all API routes to nodejs runtime for Cloudflare compatibility + verify imports"
- Git status: **clean** (all changes committed)

## Previously deployed to Vercel — confirmed live at godoor.site
All fixes from commit `a043976` are live and verified in production:
1. Store settings: weekday multi-select + "Mon–Wed 7am–9pm" label (`open_days` DB column added)
2. `/business/bookings` — new "Booked orders" route + business-nav wiring
3. Button bounce polish (`elastic-press` + `button-pop` on every platform button)
4. Hybrid theme: white light / true **black #0a0a0b** dark (not navy)
5. Location auto-fill persistence across welcome → signed-in /app

## Cloudflare migration work already done (in current HEAD commit tree)
- `wrangler.toml` — Pages config: `name="godoor-platform"`, `account_id`, `zone_id`, `[vars]`, `pages_build_output_dir=".vercel/output/static"`, `[upload] dir=".vercel/output/static"`
- `cloudflare-deploy.sh` — deploy script (`npm run build → npx @cloudflare/next-on-pages@1 → wrangler pages deploy`)
- `cloudflare-migration-guide.md`
- `next.config.ts` — has `output: "standalone"`
- All 85 `src/app/api/**/*.route.ts` files: `export const runtime = "nodejs"` (changed from `edge`)
- Fixed 9 broken import statements where `export const runtime` was injected inside multi-line `import { }` blocks
- Restored missing `node:fs` / `node:path` imports in `admin/push-migrate/route.ts` and `schema-sql/route.ts`
- **`.next` build is complete and valid** (generated with `NODE_OPTIONS="--max-old-space-size=2048"`)
- `@cloudflare/next-on-pages@1.13.16` installed as devDependency
- `wrangler` CLI: **not installed globally**

## Blockers / what's missing
1. Cloudflare API token `REDACTED_CLOUDFLARE_API_TOKEN` → returned **error 1000 "Invalid API Token"**
2. `wrangler` CLI not installed in this environment
3. DNS still on Vercel (`ns1.vercel-dns.com`, `ns2.vercel-dns.com`); DNS swap to Cloudflare not done
4. `@cloudflare/next-on-pages` internally ran `vercel build` and was **OOM-killed (~1GB RAM)** — BUT a manual `next build` succeeds with `NODE_OPTIONS="--max-old-space-size=2048"`

## Secrets / env vars required by the Cloudflare Pages project (from `.env.local`, gitignored)
- `NEXT_PUBLIC_SUPABASE_URL` = `https://ikbdhfjqiptsecunxzti.supabase.co`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` = anon key from .env.local
- `SUPABASE_SERVICE_ROLE_KEY` = service-role key (server-only; needed by `/api/*` routes)
- `SUPABASE_ACCESS_TOKEN` = `REDACTED_SUPABASE_ACCESS_TOKEN`
- `NEXT_PUBLIC_MAPBOX_TOKEN` / `MAPBOX_TOKEN` — check `src/lib/location.ts` and `MapboxMap.tsx`
- `VERCEL_OIDC_TOKEN` — not needed for Cloudflare

## Accounts / IDs
- Cloudflare account_id: `f98f2ada83a694712cb0487335b2ae76`
- Cloudflare zone_id: `4a437a3d3bd702ed1e638b5da30bd2f0` (godoor.site)
- Vercel project: `prj_OQ4xFOVHyGnTd5liraU62qm9JNCU`
- Supabase project: `ikbdhfjqiptsecunxzti`

## What the solution must accomplish
1. Get the app running on Cloudflare — either via `@cloudflare/next-on-pages` adapter or manual: `next build` → `wrangler pages deploy .vercel/output/static`
2. Bind the env vars/secrets above to the Pages project (dashboard or `wrangler secret put`)
3. After DNS swap: attach custom domain `godoor.site` to the Pages project
4. Verify routes in browser: `/`, `/app`, `/business/store`, `/business/bookings`, `/admin/hero-banner`
5. Confirm the admin secret link still works: unauthorized → 404, authenticated (valid token) → 200 with the admin UI
6. Build machine has only ~1GB RAM → any Next.js build must run with `NODE_OPTIONS="--max-old-space-size=2048"`

## Notes for Cloudflare AI
- Do **not** use `export const runtime = "edge"` — the app uses `node:crypto`, `node:fs`, `node:path`, `pg`, `qrcode` (server-side), so `nodejs` runtime is required.
- The `.next` directory in the repo root is a valid built output from Next 16.4.0.
- If `next-on-pages` build fails due to OOM, fall back to: build with `NODE_OPTIONS="--max-old-space-size=2048"`, then `wrangler pages deploy` the resulting Pages output.
