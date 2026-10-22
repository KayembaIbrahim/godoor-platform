import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase-server";
import { priceOrder } from "@/lib/order-pricing-server";
import { isMerchantId, isMalformedIdError } from "@/lib/api-auth";
export const runtime = "nodejs";

/**
 * Authoritative delivery quote.
 *
 * WHY THIS EXISTS
 * ---------------
 * The customer used to price the delivery on the CLIENT — a straight-line
 * distance computed from whatever the browser knew at that moment — and the
 * server then charged a DIFFERENT number, recomputed from the merchant row
 * and the stored coordinates. Two numbers for one trip is the definition of
 * "the customer sees a different price than the rider", and it surfaced at the
 * worst possible moment: the payment sheet.
 *
 * The rider is not the cause, they are the messenger. The rider reads
 * `orders.delivery_fee_ugx`, the column this endpoint's value is written to.
 * So when the customer and the rider disagree, the customer was looking at a
 * client estimate that the server was never going to honour.
 *
 * The rule, now enforced in one place:
 *   quote = the figure the server will charge
 *   charge = the same function, the same inputs
 *   rider sees = the stored column
 *
 * The customer cannot be quoted one number and charged another, because there
 * is only one function — `priceOrder()` in `@/lib/order-pricing-server`, which
 * this route and `POST /api/orders` both call. The basket is sent as
 * `line_items` and every amount is resolved from the database, so a stale
 * cart or a tampered client cannot move the price.
 *
 * Deliberately unauthenticated, like the ride quote: a customer must be able
 * to see a price before signing in, and a quote exposes nothing that the
 * business page does not already show.
 */

export async function POST(req: NextRequest) {
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "Not configured" }, { status: 500 });

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const merchantId = typeof body.merchant_id === "string" ? body.merchant_id : "";
  /* Both id shapes are legitimate — the seeded `mch_…` slugs exist in the
     development project, uuids everywhere else — so this must not be
     `isUuid()`. See `isMerchantId` for the whole story. */
  if (!isMerchantId(merchantId)) {
    return NextResponse.json({ error: "A business is required to price delivery" }, { status: 400 });
  }

  const { data: merchant, error: merErr } = await sb
    .from("merchants")
    .select("id, name, status, delivery_fee_ugx, lat, lng")
    .eq("id", merchantId)
    .maybeSingle();
  /* A `mch_…` id against a uuid-typed column is a business that does not
     exist here, not a broken request. 400, never a 500 with a Postgres
     error in it. */
  if (merErr) {
    if (isMalformedIdError(merErr)) {
      return NextResponse.json({ error: "This business is no longer available" }, { status: 400 });
    }
    return NextResponse.json({ error: merErr.message }, { status: 500 });
  }
  if (!merchant) {
    return NextResponse.json({ error: "This business is no longer available" }, { status: 400 });
  }
  /* A suspended business cannot take orders, so quoting for one would show a
     price that the order endpoint then refuses. Same rule, same message. */
  if ((merchant as { status?: string }).status === "suspended") {
    return NextResponse.json({ error: "This business is temporarily unavailable" }, { status: 400 });
  }

  const priced = await priceOrder(sb, {
    merchant: merchant as { id: string },
    lineItems: body.line_items,
    customerLat: body.customer_lat,
    customerLng: body.customer_lng,
    promoCode: body.promo_code,
  });
  if (!priced.ok) {
    return NextResponse.json({ error: priced.error }, { status: priced.status });
  }
  const o = priced.order;

  return NextResponse.json({
    ok: true,
    delivery_fee_ugx: o.deliveryFee,
    service_fee_ugx: o.serviceFee,
    subtotal_ugx: o.subtotal,
    discount_ugx: o.discountUgx,
    total_ugx: o.totalUgx,
    distance_km: Math.round(o.distanceKm * 100) / 100,
    bulky_weight_kg: o.bulkyWeightKg,
    coords_known: o.coordsKnown,
    free_delivery: o.freeDelivery,
  });
}
