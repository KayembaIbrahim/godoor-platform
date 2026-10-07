# ⚠️ PRODUCTION SCHEMA GAP — read before deploying the fare/stopover work

## What is missing in production (`llzqkduccdbbetevpoql`)

Verified read-only against the live PostgREST API on 2026-10-07 using the
production service-role key:

| Object | Status in production |
|---|---|
| `ride_requests` core columns (`id`, `distance_km`, `fare_ugx`, `service_fee_ugx`, `total_ugx`, `status`) | ✅ present |
| `ride_requests.duration_min`, `.fare_tier`, `.vehicle_kind`, `.base_ugx`, `.distance_ugx`, `.time_ugx`, `.wait_ugx`, `.wait_min`, `.quote_snapshot`, `.finalised` | ❌ **missing** |
| `ride_requests.stopover_*` (7 columns) | ❌ **missing** |
| `fare_rates` table | ❌ **missing** |
| `ride_stopovers` table | ❌ **missing** |
| `ride_stopover_disputes` table | ❌ **missing** |
| `rider_locations` (`rider_id`, `lat`, `lng`, `speed`, `updated_at`) | ✅ present — GPS corroboration will work |

## Why this blocks a naive deploy

`POST /api/rides` inserts the itemised fare breakdown
(`duration_min`, `fare_tier`, `base_ugx`, …). PostgREST rejects the **entire
insert** if any named column is missing, so deploying the fare engine before the
schema lands would break **ride booking on the live site** — not degrade it.

## What protects the site in the meantime

The code does not assume the schema exists:

- `loadFareRates()` falls back to `FALLBACK_FARE_RATES` per field when
  `fare_rates` is absent, so fares still compute and are still consistent between
  the customer quote and the charge.
- `POST /api/rides` probes once per process and **omits** the itemised columns
  when they are missing, so a booking still succeeds on the legacy shape.
- `startStopover` / `endStopover` return a clear, non-crashing error until
  `ride_stopovers` exists.

So the fare engine can ship safely now, and the stopover feature switches itself
on the moment the schema is applied — no second deploy required.

## How to apply the schema (BLOCKED — needs a production token)

```bash
# The workspace .env.local token can only reach ikbdhfjqiptsecunxzti, which is
# NOT the production database. One of these is needed:
#
#   1. A Supabase personal access token that has access to llzqkduccdbbetevpoql, or
#   2. Confirmation that production should point at a different project ref.
#
# Then:
SUPABASE_PROJECT_REF=llzqkduccdbbetevpoql node scripts/apply-sql.mjs FARE_SCHEMA.sql
```

Every statement in `FARE_SCHEMA.sql` is idempotent (`CREATE TABLE IF NOT EXISTS`,
`ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`), so re-running it is
safe. The partial unique index
`uniq_open_stopover_per_ride ON ride_stopovers (ride_id) WHERE status = 'open'`
is load-bearing — it is what makes a double-tapped stopover button physically
unable to open two clocks, and the in-memory guards in
`scripts/verify-stopover-guards.mts` only model it.
