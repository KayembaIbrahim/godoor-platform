# GoDoor — Roadmap

Iteration order assumes production is live on https://godoor.site today.

## Now (0–2 weeks)

- [ ] **Publish the repository to GitHub** and let `.github/workflows/android.yml` build the Capacitor APK (blocks mobile release).
- [ ] **Persistent wallet:** replace the in-memory ledger in `src/lib/wallet-store.ts` with a Postgres `wallets`/`wallet_ledger` table (RLS owner-scoped, same API surface, zero client changes).
- [ ] **Live MoMo provider:** implement a confirming webhook for Flutterwave/Pesapal in `src/lib/momo.ts` (`MOMO_PROVIDER` env), move top-up credit to webhook-only.

## Next (2–6 weeks)

- [ ] Realtime live tracking (subscribe to `rider_locations` instead of polling).
- [ ] Rider onboarding flow (verify ID + KYC documents through the existing `verification_documents` table + admin review).
- [ ] Push notifications (web + Android) for order events.
- [ ] Per-IP rate limiting on auth/orders at the edge.

## Later

- [ ] Multi-admin identities + per-admin audit log (today: one shared admin cookie).
- [ ] Merchant payout settlement:
  - Postgres-accounted ledger (GoDoor wallet) + MoMo payout via provider API.
- [ ] OpenRouteService fallback when the routing API is unavailable (tracker already degrades to straight-line ETA).
- [ ] Marketing: promo-code lifetime/per-user limits via `promo_attempts` guard table.
- [ ] Analytics rollup tables for admin (replace in-memory 14-day aggregation at scale).
- [ ] iOS Capacitor build.

## Non-goals

- Reward/points in wallet v1 (defer).
- In-app messaging beyond order chat (defer; integrations via WhatsApp suggested).
- Multi-country rollout (Uganda-only unit economics first).