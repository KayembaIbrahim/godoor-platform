# GoDoor — Architecture

## Stack

- **Web:** Next.js 15 (App Router), TypeScript, Tailwind CSS, zustand (persisted cart)
- **Backend-as-a-service:** Supabase — Postgres (RLS-hardened), Auth, Realtime, Storage
- **Hosting:** Vercel (production, alias `godoor.site`)
- **Mobile:** Capacitor shell in `android/` (built by GitHub Actions CI)

## Source map (`src/`)

| Path | Purpose |
| --- | --- |
| `app/api/*` | Server route handlers. All writes authenticated via `src/lib/api-auth.ts`. |
| `lib/supabase-server.ts` | Service-role client (server-only). |
| `lib/api-auth.ts` | Actor resolution (`admin` cookie → Supabase JWT), ownership helpers, order transition machine. |
| `lib/dispatch.ts` | Rider dispatch: 25 km/h movement model, ETA, fare. |
| `lib/momo.ts` | Mobile-money provider abstraction (demo by default). |
| `lib/wallet-store.ts` | In-memory wallet ledger (demo; Postgres swap point). |
| `lib/utils.ts` | Fees, distance, UGX formatting. |
| `app/tracking` | Customer live tracking (Gojek-style status hero + adaptive polling). |
| `app/rider` | Rider dashboard: available deliveries, stream accept, live GPS broadcast. |
| `app/admin/*` | Admin panel (HMAC cookie + secret path). |
| `app/business/store` | Merchant storefront editor. |

## Request / data flow

```
Customer web ──> /api/orders ──> service role ──> Supabase (RLS owner-scoped)
                    ↑ server recomputes totals, resolves products, idempotency key
Rider web ────> realtime stream ── accepted ──> orders.rider_id
Rider app ────> rider_locations UPSERT (per-actor) ──> tracking map polls/realtime
```

## Security boundaries

1. **Secret boundary:** service role key exists only in `supabase-server.ts`; everything public goes through RLS or the authenticated API.
2. **Policy boundary:** RLS allows anon reads only for the storefront; all writes and sensitive reads require the API layer to prove identity.
3. **Trust boundary:** order pricing, merchant status, phone changes and wallet credits are server-authoritative (see SECURITY_AUDIT.md §4).

## Deployment

```bash
rm -rf .next && vercel deploy --yes --prod
```

Env required (see `.env.example`). The MySQL/Postgres schema is applied via `supabase-schema.sql` + `rls_hardening.sql` (DDL through the service-role `exec_sql` RPC).