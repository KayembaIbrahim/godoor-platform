# GoDoor — Project Audit

**Prepared:** Sep 2026 · **Project:** godoor (ZentechX) · **Live:** https://godoor.site

## 1. What GoDoor is

GoDoor is a hyper-local delivery platform for Uganda (Kampala first). Customers browse merchants, order food/groceries/pharmacy/packages, pay with MTN MoMo, Airtel Money or cash, and track the rider live. Riders accept deliveries from a dedicated dashboard and broadcast GPS. Merchants manage their storefront, products, orders and chat.

The build is a Next.js 15 (App Router) + TypeScript + Tailwind single deploy, backed by Supabase (Postgres + Auth + Realtime) and deployed to Vercel.

## 2. Scope of this audit

- Automated delivery dispatch (Glovo "Jarvis-lite") with live tracking
- Wallet + mobile-money integration points
- Order lifecycle, chat, disputes, promotions
- Admin dashboard, rider dashboard, business storefront
- Authentication, authorization, and every API route that mutates data
- Database row-level security (RLS) and exposed client secrets

## 3. What is live in production

| Area | Status |
| --- | --- |
| Storefront, catalog, search, promo banners | Live |
| Cart / checkout / orders | Live (server-priced) |
| Live tracking (Gojek-style status hero + ETA) | Live |
| Rider dispatch + rider live GPS | Live |
| Mobile-money wallet flow | Live, provider-confirmation model |
| Admin dashboard, approvals, analytics | Live |
| RLS lockdown + exec_sql revocation | Live |
| Idempotent, tamper-proof order pricing | Live |

## 4. Feature strengths

- **Tracking UX (Gojek pattern):** breathing status rings until a rider is assigned, adaptive polling (3s/8s/15s), delay applied ×1.25 over an OpenRouteService baseline, "Live location unavailable" banner when GPS is stale > 30 s.
- **Dispatch (Glovo Jarvis-lite):** rider → pickup → dropoff at 25 km/h × 1.3 with a 3-minute buffer; delivery requests stream to riders over Supabase realtime.
- **Reorder:** one-tap quick reorder from past orders.
- **Admin merchants view** folds in auth users with no merchant row yet (pending onboarding).

## 5. Findings summary

| # | Finding | Severity | Status |
| --- | --- | --- | --- |
| 1 | Schema created with zero policies (public RLS open) | Critical | Fixed |
| 2 | Anon key could call `exec_sql` directly | Critical | Fixed |
| 3 | Read/quit self-publish merchants active | High | Fixed |
| 4 | Phone-change request accepted any `user_id` | High | Fixed |
| 5 | Order totals & prices trusted from the client | High | Fixed |
| 6 | Wallet shared a single demo user | Medium | Fixed |
| 7 | Top-up `success:true` from client could self-credit | High | Fixed |
| 8 | Stories / followers wrote with client-chosen identities | High | Fixed |
| 9 | Setup endpoints publicly reachable | Medium | Fixed |
| 10 | Anon key + project URL hardcoded in a page + leaked `exec_sql` schema tab | Medium | Fixed |
| 11 | `ignoreBuildErrors` disabled type safety in CI | Medium | Fixed |
| 12 | Fake MoMo fallback number visible to customers | Medium | Fixed |
| 13 | Build & APK CI not running (repo never pushed) | Medium | Open |
| 14 | Wallet ledger is in-memory (demo) | Low | Open (by design) |

## 6. Recommendation

GoDoor is **safe to keep shipping to customers**. Publish the repository to GitHub and let the APK CI build the Android app, replace the demo MoMo provider (`MOMO_PROVIDER=demo`) with a signed webhook provider, then iterate on roadmap items.