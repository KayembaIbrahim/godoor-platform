# GoDoor — Production Readiness

Status: **READY TO SHIP** (Sep 2026) · Live: https://godoor.site

## What "ready" means

Every checklist item below was tested against the live deployment with curl/node probes — not just inspected in code.

## Checklist

### Security
- [x] RLS locked down (no anonymous writes; storefront reads public) — verified via anon probes + `pg_policies` dump
- [x] `exec_sql` RPC revoked from anon/authenticated (service role only) — verified live
- [x] Order pricing, merchant status, phone changes, wallet credits all server-authoritative — verified live
- [x] No hardcoded secrets in the client bundle (setup page now env-driven)
- [x] Admin panel behind HMAC cookie + secret path (`/admin` returns 404 anon)
- [x] TypeScript strict build enforced (`ignoreBuildErrors` removed)

### Reliability
- [x] Order idempotency (unique partial index; safe retries)
- [x] Server-recomputed totals on every order — client calc is display-only
- [x] Wallet failures surface as `402`, not silent fallbacks
- [x] Tracking shows an honest "live location unavailable" instead of faking GPS

### Observability
- [x] Admin analytics fully derived from live data (orders/users/payments) — no synthetic numbers
- [x] Attempted fake implementations removed (no fake MoMo beneficiary, no hardcoded stats)

## Gaps before "production scale"

| Gap | Effort | Notes |
| --- | --- | --- |
| Wallet ledger in memory | Small | Swap `src/lib/wallet-store.ts` for a Postgres table; API surface unchanged. |
| MoMo provider = `demo` | Medium | Wire `MOMO_PROVIDER=flutterwave/pesapal` + signed confirm webhook in `src/lib/momo.ts`. |
| Realtime for live tracking | Small | Tracking currently polls; move `rider_locations` to realtime presence for lower latency. |
| Rate limiting on auth/orders | Small | Add per-IP limits at the platform/edge level. |
| Multiple admins / per-admin audit | Medium | Single shared HMAC cookie today. |
| CI runs typecheck + build | Small | Repo not pushed yet — blocks the APK CI (`.github/workflows/android.yml`). |

## Rollout recommendation

1. Push the repository to GitHub → APK CI builds the Android app.
2. Deploy the Postgres wallet ledger.
3. Enable a live MoMo provider with a signed confirmation webhook.
4. Remove the `demo` provider from `src/lib/momo.ts`; smoke-test top-up + pay end-to-end with a UGX test amount.