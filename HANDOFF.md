# GoDoor Platform — Handoff Document

## What This Is
GoDoor — a food/grocery delivery platform (like UberEats/DoorDash for East Africa).
- **Framework**: Next.js 16 (App Router) + React 19
- **Backend**: Supabase (PostgreSQL + Auth + Realtime)
- **Target**: Cloudflare Workers deployment (godoor.site, www.godoor.site)
- **Also**: Android app via Capacitor, web-app/ directory

## Current State
- **Site is partially live** at godoor.site — SSR HTML renders but **zero client-side JavaScript** (no hydration, no interactivity)
- The Worker bundle (worker.js, 1.4MB) exists and contains the full Next.js app compiled for Cloudflare Workers
- The client-side chunk files (`_next/static/chunks/*.js`) are **missing** — they don't exist anywhere on disk
- The local machine has only ~1.2GB RAM — `next build` / `vite build` both OOM (bus error)
- The project was originally built on Vercel (8GB machine) — deploy.log confirms 122 pages generated successfully

## The Core Problem
The Next.js build produces:
1. **Server bundle** — exists at `worker.js` (1.4MB, compiled for Workers via vinext)
2. **Client chunks** — `dist/client/_next/static/chunks/*.js` — **DO NOT EXIST**

The server bundle references these chunk files but they were never generated. The site renders SSR HTML but can't hydrate.

## What Someone Else Needs To Do
1. **Run the build on a machine with ≥8GB RAM** (the local machine can't do it):
   ```bash
   npm install
   npm run build   # or: npm run build:vinext
   ```
2. **Verify `dist/client/_next/static/chunks/`** has the client JS files
3. **Deploy to Cloudflare Workers** using one of:
   - `npx wrangler deploy` (with proper wrangler.jsonc config)
   - Or use the existing `cloudflare-deploy.sh` script
4. **The wrangler.jsonc** currently points to `vinext/server/fetch-handler` — this needs to match whatever the build produces

## Key Files
| File | Purpose |
|------|---------|
| `package.json` | Dependencies & scripts (build, deploy:vinext) |
| `next.config.ts` | Next.js config |
| `wrangler.jsonc` | Cloudflare Workers deployment config |
| `src/app/` | Next.js App Router source |
| `src/lib/supabase.ts` | Supabase client (needs env vars) |
| `public/` | Static assets (favicon, brand images, manifest) |
| `worker.js` | Pre-built Worker bundle (1.4MB) |
| `cloudflare-deploy.sh` | Deployment script |
| `cloudflare-migration-guide.md` | Migration docs |

## Environment Variables Needed
```
NEXT_PUBLIC_SUPABASE_URL=https://ikbdhfjqiptsecunxzti.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```
(See `.env.example` and `.env.local` for full set)

## Quick Start for Someone New
```bash
git clone <this-repo>
npm install
npm run build
npx wrangler deploy
```

## The Build Is The Bottleneck
The `next build` requires ~4GB+ RAM. The current machine has ~1.2GB available.
Options:
- Build on a bigger machine (Vercel, a cloud VM, or your dev machine)
- Use `npm run build:vinext` (vite-based build, also needs more RAM)
- The pre-built `worker.js` server bundle is already compiled — only the client chunks are missing

## Contact / Notes
- Original project was built on Vercel (deploy.log confirms successful 122-page build)
- Supabase project: `ikbdhfjqiptsecunxzti`
- Cloudflare zone ID for godoor.site: `4a437a3d3bd702ed1e638b5da30bd2f0`
- Cloudflare API token was provided (see user's environment)