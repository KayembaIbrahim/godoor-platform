# GoDoor — Security Audit

**Scope:** authentication, authorization, RLS, secret exposure, tamper resistance of the live godoor.site deployment (Sep 2026).

## 1. Authentication model

- **Customers / business / riders** authenticate with Supabase Auth (JWT). The server validates the bearer token via `sb.auth.getUser()` (service role) in `src/lib/api-auth.ts`.
- **Administrators** authenticate with a separately HMAC-signed session cookie (`src/lib/admin-auth.ts`, `ADMIN_SESSION_SECRET`). The admin panel lives under a randomized path (`ADMIN_PATH_SECRET`); `/admin` returns 404 for everyone.
- Every mutating API route resolves an **actor** (`admin` or `user`). Routes that must know the account derive it from the token, never from the request body.

## 2. Row Level Security (RLS) — live

The `src/lib/rls_hardening.sql` migration replaced all pre-existing open policies (35 public ones) with `gd_*` policies:

- **Storefront reads stay public:** active merchants, products, catalogues, non-expired stories, follower counts, fee config.
- **Sensitive rows are owner/participant-scoped:** orders (customer, merchant owner, assigned rider), payments, chat, disputes, rider locations, riders, verification documents, followers.
- **No anonymous INSERT/UPDATE/DELETE anywhere:** verified by anon-key REST probes (all `401` / `42501` RLS violations) and a `pg_policies` dump (`DUMP:CLEAN — no anon-permissive write policies remain`).
- **storage.objects:** replaced with strict policies — buckets stay private, verification-document uploads are owner-only.
- Because live columns are polymorphic (`merchant_id` is UUID on some tables, text on others), all policy comparisons cast with `::text`.

## 3. `exec_sql` revocation — live

`exec_sql` was a `SECURITY DEFINER` RPC used to run DDL. Anon key could call it. Fixed with:

```sql
REVOKE EXECUTE ON FUNCTION exec_sql FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION exec_sql TO service_role;
```

Verified live: anon → `401 permission denied for function exec_sql`; service role → `204`.

## 4. Tamper resistance

| Area | Fix |
| --- | --- |
| `POST /api/orders` | Totals, item names, prices and availability all resolved server-side from the products table and fee config. Client may only send `productId`, `quantity`, `bulky`. Verified live: a request claiming UGX 99,999,999 came back as a real computed total. Idempotency enforced via a unique partial index on `orders.idempotency_key` (replay returns the same order). |
| `POST /api/merchants`, `/api/business/me`, mutations | Merchants are created `status: "pending"` only; a client can never self-activate. Business role required. `owner_id` always derived from the session. |
| `POST /api/phone-change-request` | `user_id` forced to the caller's own id. Approval (`PATCH`) is admin-only and applies the phone number read from the stored row, never the request body. |
| `POST /api/pay` | Only the order owner may pay; wallet operations are per-actor (no shared demo user). |
| `POST /api/topup` | Client `success:true` never credits. Confirmation must come from the provider (signed webhook). The API returns `awaiting_provider_confirmation`. |
| `POST /api/stories` | Merchants may only post/edit/delete their own store's stories (ownership enforced). |
| `POST /api/followers` | `customer_id` forced to the session owner. |
| `POST /api/mutations` | Per-row ownership checks for products/stories/merchants; chat sender forced; riders always created unverified. |
| `/api/setup*` | 404 unless the admin cookie is valid (defense-in-depth over RLS). |
| Checkout | The fake `0772 000 000` fallback was removed. MoMo is blocked until the store configures a number, so a customer is never pointed at a fabricated beneficiary. |

## 5. Secret exposure fixes

- Removed the hardcoded anon key + project URL from `src/app/setup/page.tsx` (now env-driven).
- No `NEXT_PUBLIC_*` secrets exist; the service role key is server-only (`src/lib/supabase-server.ts`).
- `exec_sql` revoke also means the anon key can no longer be used as a free DDL runner even if it leaks.

## 6. Residual risk (accepted)

1. **Wallet ledger is in-memory** (`globalThis`) — survives only within a serverless instance. Swapping in a Postgres ledger is a small, well-isolated change (`src/lib/wallet-store.ts`).
2. **MoMo provider is `demo`** — real money movement needs `MOMO_PROVIDER=flutterwave|pesapal|...` in `src/lib/momo.ts` plus the confirming webhook.
3. **Admin auth** is a single shared HMAC cookie, not per-admin identities.
4. **Build-gating**: `next.config.ts` no longer ignores type errors; CI is recommended.

## 7. Verification artifacts

- `src/lib/rls_hardening.sql` — applied live, policies verified via `pg_policies` dump.
- `node_modules/.bin/tsc --noEmit` — clean (exit 0).
- Negative-regression probes against https://godoor.site — anon writes `401/404`, public reads `200`, admin panel `404`, setup endpoints `404`.