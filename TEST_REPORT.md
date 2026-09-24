# GoDoor — Test Report

**Date:** Sep 11 2026 · **Target:** live production https://godoor.site (aliased deployment after the security hardening pass)

## Method

- Static: `node_modules/.bin/tsc --noEmit` (exit 0 on every iteration).
- Dynamic: `curl` and `node` probes written to `/tmp/opencode/*.mjs` and run against production. Anonymous requests carry no auth; authenticated requests are minted via the Supabase admin Auth API with throwaway users, then cleaned up after the test.

## Regression: pages

| Path | Result |
| --- | --- |
| `/`, `/app`, `/cart`, `/checkout` | 200 |
| `/orders`, `/tracking`, `/rider`, `/partner`, `/business`, `/account` | 200 |
| `/admin` (anon) | 404 (expected) |
| `/setup` | 200 (legacy dev page) |

## Negative security regression (anon)

| Endpoint | Expected | Actual |
| --- | --- | --- |
| `POST /api/setup`, `/api/setup/schema`, `/api/setup/tables` | 404 | 404 "Not found" |
| `POST /api/phone-change-request` | 401 | 401 "Sign in to continue" |
| `GET`/`POST /api/business/me` | 401 | 401 "Sign in to continue" |
| `GET /api/wallet`, `POST /api/pay`, `POST /api/topup` | 401 | 401 "Sign in to continue" |
| `POST /api/stories`, `/api/followers`, `/api/orders`, `/api/products`, `/api/mutations` | 401 | 401 "Sign in to continue" |
| `POST /api/merchants` | 401 | 401 "Sign in to register your business" |
| `GET /api/merchants`, `/api/products`, `/api/followers` | 200 | 200 (public reads preserved) |

## Positive security test: server-authoritative pricing

Throwaway customer placed an order claiming a **client total of UGX 99,999,999**, a phone of 1, a delivery fee of 1, a service fee of 1, and a hacked item named "HACKED NAME" at unit price 987,654.

Server response (from products table + fee config):

```
subtotal  = 10,000   (2 × 5,000 DB price)
delivery  =  2,000
service   =    200   (2% of subtotal)
total     = 12,200
item name = "Rolex"  @ 5,000   (resolved from DB, ignored the client values)
```

Idempotency: re-POST with the same `idempotency_key` returned **the same order** with `replayed: true`. Test order and user removed afterwards (DB + Auth cleaned, `204/200`).

## Database-level (RLS + exec_sql)

- Anon-key REST probes before the fix: INSERTs and `SELECT` on sensitive tables leaked data / wrote rows.
- After `rls_hardening.sql`: INSERTs blocked (`42501`), sensitive SELECTs return `[]`, catalog reads public.
- `pg_policies` dump (via RAISE EXCEPTION): `DUMP:CLEAN — no anon-permissive write policies remain`.
- Anon `rpc/exec_sql` after revoke: `401 permission denied for function exec_sql`; service role: `204`.

## Test coverage that remains outstanding

- Authenticated role-based flows later in the lifecycle (merchant approves → order → rider accepts → delivers) rely on the `canTransition` machine (unit-tested in code); an end-to-end multi-actor E2E is recommended after the APK CI is enabled.
- Mobile-money provider (demo provider only; real provider flows need provider sandbox credentials).