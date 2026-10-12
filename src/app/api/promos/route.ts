import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase-server";
import { readPromoList } from "@/lib/promo-server";
import { featuredPromo, mergePromoTable, toPromoTable } from "@/lib/promo";
import { FIRST_ORDER_OFFER } from "@/lib/first-order-offer";
export const runtime = "nodejs";

/**
 * GET /api/promos — the live promo table, for display only.
 *
 * Public by design: a customer has to be able to see which codes exist and what
 * the banner is promising. Nothing here is authoritative — `/api/orders`
 * re-resolves the code against the same store and decides what is charged — so
 * exposing the table cannot move a price.
 *
 * Inactive and exhausted codes are filtered out, so the client never renders a
 * "15% off" pill the checkout would then refuse.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const sb = getServiceClient();
  const list = await readPromoList(sb);
  const table = mergePromoTable(list);

  const now = Date.now();
  const usable: Record<string, unknown> = {};
  for (const [code, p] of Object.entries(table)) {
    if (!p.active) continue;
    if (p.maxUses && (p.uses ?? 0) >= p.maxUses) continue;
    if (p.expiresAt) {
      const expiry = Date.parse(`${p.expiresAt}T23:59:59Z`);
      if (Number.isFinite(expiry) && now > expiry) continue;
    }
    usable[code] = {
      label: p.label,
      discount: p.discount,
      type: p.type,
      minSubtotalUgx: p.minSubtotalUgx,
      featured: p.featured === true,
    };
  }

  /* The banner's headline comes from whichever code is marked featured, so the
     advertised percentage is by construction the percentage honoured. Falling
     back to the shipped constant keeps the promise if the store is unreadable. */
  const f = list ? featuredPromo(toPromoTable(list)) : null;
  const featuredCode = f && f.promo.active ? f.code : FIRST_ORDER_OFFER.code;
  const featuredPct = f && f.promo.active && f.promo.type === "percent" ? f.promo.discount : null;

  return NextResponse.json(
    {
      table: usable,
      offer: {
        code: featuredCode,
        percent: featuredPct ?? FIRST_ORDER_OFFER.percent,
        note: FIRST_ORDER_OFFER.note,
        headline: FIRST_ORDER_OFFER.headline,
      },
      /* Whether an admin has customised the table, so a stale client can tell
         "these are the defaults" from "this is what the owner chose". */
      customised: list !== null,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}