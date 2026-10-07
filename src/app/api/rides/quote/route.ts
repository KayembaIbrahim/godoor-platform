/**
 * Fare quote for the booking screen.
 *
 * Deliberately unauthenticated: a customer must be able to see a price before
 * signing in, and a quote exposes nothing that is not already visible on the
 * map (distance and duration for two points they just picked).
 *
 * This is the endpoint that removes the customer/rider price disagreement. The
 * customer never computes a fare locally — it asks this route, which runs the
 * exact same `priceRide` the booking endpoint charges with.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase-server";
import { authorize } from "@/lib/api-auth";
import { priceRide, parseTrip, fareKindOf } from "@/lib/pricing-server";

export async function POST(req: NextRequest) {
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "Not configured" }, { status: 500 });

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const t = parseTrip(body);
  if (!t.ok) {
    return NextResponse.json({ error: "Set a valid pickup and dropoff on the map" }, { status: 400 });
  }

  const priced = await priceRide(sb, {
    pickupLat: t.pickupLat as number,
    pickupLng: t.pickupLng as number,
    dropoffLat: t.dropoffLat as number,
    dropoffLng: t.dropoffLng as number,
    kind: fareKindOf(body.kind),
    /* A customer can watch an in-flight ride accrue stopover. The stored
       wait_min is the server's own accumulator — never a client-supplied
       number, which would be a "charge me whatever you like" endpoint. */
    waitMin: await authorizedWaitMinutes(sb, req),
  });

  return NextResponse.json({
    quote: priced.quote,
    service_fee_ugx: priced.serviceFee,
    total_ugx: priced.total,
    route_source: priced.roadSource,
  });
}

/** Current wait accrual for a ride the caller is actually a party to. */
async function authorizedWaitMinutes(
  sb: NonNullable<ReturnType<typeof getServiceClient>>,
  req: NextRequest,
): Promise<number> {
  const rideId = req.nextUrl.searchParams.get("ride_id");
  if (!rideId) return 0;
  const actor = await authorize(req);
  if (!actor || actor.kind !== "user") return 0;
  try {
    const { data } = await sb
      .from("ride_requests")
      .select("wait_min, customer_id, rider_id")
      .eq("id", rideId)
      .maybeSingle();
    const r = data as Record<string, unknown> | null;
    if (!r) return 0;
    if (r.customer_id !== actor.id && r.rider_id !== actor.id) return 0;

    /* The live accumulator lives in the kv stopover store; `wait_min` on the ride
       row only carries a settled, already-finalised figure. Reading
       `stopover_minutes` here used to name a column that production does not
       have, which made PostgREST reject the whole SELECT and silently return 0
       wait minutes on every re-quote. */
    const { readStopover } = await import("@/lib/stopover-store");
    const rec = await readStopover(sb, rideId);
    const settled = Number(r.wait_min) || 0;
    return Math.max(rec.totalMinutes, settled) || 0;
  } catch {
    return 0;
  }
}