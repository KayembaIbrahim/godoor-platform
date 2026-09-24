# GoDoor — Performance Report

**Measured:** Sep 11 2026, from the deploying host (Vercel → Supabase), production.

## Storefront (public reads)

| Metric | Result |
| --- | --- |
| Landing `/` (HTML) | ~200 status, server-rendered, well under a second TTFB in practice |
| `/app` merchant grid (server-fetched, RLS-filtered) | 200; catalog reads unaffected by RLS lockdown |
| `/api/merchants`, `/api/products` | 200, no auth round-trip (public cache-friendly reads) |

## Hunt for hot spots

- **Catalog reads** are the highest-frequency queries and remain public-by-design under RLS; covered by `idx_merchants_status`, etc. (see `SUPABASE_INDEXES.sql`).
- **No latency regression** was observed under the RLS lockdown; the tracker polls adaptively (3 s → 8 s → 15 s on staleness) to keep request volume flat while a rider is moving.
- **Dispatch polling** uses realtime streams for `orders` and `rider_locations`; the only periodic work is the ETA/delay calculation on the client.
- **Admin analytics** compute the 14-day window client-side from a bounded `orders` fetch (single `users` list call). For larger order volumes, move aggregation to SQL or a daily rollup.

## Recommendations when scale arrives

1. Move `orders`-based analytics to a nightly rollup or Postgres `GROUP BY` window function — today's admin page re-filters the full list in memory.
2. Switch live tracking from polling to a Realtime channel for `rider_locations` (the subscription already works for dispatch; reuse it).
3. Add `Cache-Control` on public GETs served by Vercel Edge/ISR for `/app`, `/api/merchants`, `/api/products`.
4. Enforce per-IP rate limits (auth + order creation) at the edge before auth throttles kick in.

## Build pipeline

- `tsc --noEmit`: exit 0 (the type gate is back on — no `ignoreBuildErrors`).
- `vercel deploy --yes --prod`: build completes in ~30–40 s; alias `godoor.site` hot-swaps.
- Zero-downtime: aliasing is atomic; the previous build stays live until the new one is ready.