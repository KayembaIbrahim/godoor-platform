# GoDoor — API Documentation

Base URL: `https://godoor.site` · All JSON. Auth: `Authorization: Bearer <supabase JWT>` for user endpoints; admin endpoints use the secret-path + HMAC cookie and do not expose API keys.

## Public (no auth)

| Method / Path | Purpose |
| --- | --- |
| `GET /api/merchants` | Active merchants for the storefront. |
| `GET /api/products` | Products (optionally `?merchant_id=`). |
| `GET /api/catalogues` | Category groupings. |
| `GET /api/stories` | Non-expired merchant stories. |
| `GET /api/followers?merchant_id=` | Public follower count (no personal data). |
| `GET /api/heroes`, `GET /api/health` | Landing banners / health. |

## Customer (auth required)

| Method / Path | Purpose |
| --- | --- |
| `POST /api/orders` | Create order. Body: `{ merchant_id, line_items:[{productId, quantity, bulky?}], delivery_address, customer_lat/lng, notes, payment_method, idempotency_key? }`. **All prices/totals recomputed server-side.** Response includes `order`, and `replayed:true` if the same `idempotency_key` was seen before. |
| `PATCH /api/orders` | Transition status. Enforced by the transition machine (`canTransition`): who may move which status. |
| `GET/POST /api/pay` | Charge the caller's wallet for their own order. Insufficient funds → `402`. |
| `GET/POST /api/wallet` | Balance + ledger for the signed-in user. |
| `POST /api/topup` | Start top-up: `{ amount_ugx, phone }` (UG phone validated). Confirm endpoint returns `awaiting_provider_confirmation`; credits only via provider webhook. |
| `POST /api/phone-change-request` | Request a phone change **for your own account**. |
| `POST /api/followers` | Follow/unfollow a merchant (identity forced to session). |
| `POST /api/mutations` | Generic inserts with per-table ownership checks (chat, payments, etc.). |

## Merchant / Business (auth required, role-gated)

| Method / Path | Purpose |
| --- | --- |
| `GET/POST /api/business/me` | Read / auto-create **your** merchant row. Created `status:"pending"`. |
| `POST /api/merchants` | Create store. Business/admin only; always `pending`. `PUT` updates own store. |
| `POST /api/products` | Create/update product for an owned store (`resolveMerchantWriteAccess`). |
| `POST /api/stories` | Post story for an owned store; `DELETE` own stories only. |

## Rider (auth required, role rider)

| Method / Path | Purpose |
| --- | --- |
| `PATCH /api/orders` | Accept (`rider_assigned`) / update status on assigned orders. |
| `UPSERT /api/rider-location` | Broadcast live GPS (per-actor). |

## Admin (HMAC cookie, secret path)

| Method / Path | Purpose |
| --- | --- |
| `GET/POST /api/admin/businesses` | List businesses (incl. auth users w/o merchant rows); approve/suspend/verify: `{ id, action: "approve"\|"suspend", verified? }`. |
| `GET/PATCH /api/phone-change-request` | Review requests. PATCH applies phone from the stored row (server-authoritative). |
| `GET /api/admin/orders|payments|users|disputes|fee-config|applications|analytics` | Admin data reads. |
| `POST /api/setup`, `/api/setup/schema`, `/api/setup/tables` | Bootstrap DDL helpers — **404 unless the admin cookie is valid**. |

## Error conventions

- `401` — missing/invalid auth (use `Sign in to continue` / `Sign in to register your business`)
- `403` — authenticated but not allowed (wrong role, not the owner)
- `404` — resource hidden or admin-only endpoint hit without cookie
- `409` — duplicate (e.g., pending phone change already exists)
- `42501` (body) — RLS rejected the write (should not happen via API; signals a misconfiguration)