import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase-server";
import { authorize, isUuid } from "@/lib/api-auth";
import { serviceFeeFor } from "@/lib/fees";
import { pushToUser } from "@/lib/web-push-server";
import { finaliseRideFare } from "@/lib/stopover-server";
import { resolveVerifiedRider } from "@/lib/rider-verification";
import { writableUpdate } from "@/lib/schema-capabilities";
import {
  priceRide, parseTrip, fareKindOf, fareColumnsReady, MAX_RIDE_KM, MIN_RIDE_KM,
} from "@/lib/pricing-server";

/**
 * Boda ride-hailing API (v1).
 * - POST: customer requests a ride (priced by the shared fare engine).
 * - GET ?mine=1: my rides (customer) · ?open=1: open requests (verified riders) · ?id=: one ride (participant only).
 * - PATCH {id, action}: accept (verified rider, atomic claim) · start · complete · cancel.
 *
 * All money math is server-authoritative and comes from `@/lib/fare-engine`, the
 * same module the customer-facing quote at POST /api/rides/quote renders. The
 * previous version priced rides inline with hardcoded constants while the
 * customer UI hardcoded a different service-fee percentage, so the amount shown
 * at booking and the amount charged were different numbers.
 */

/**
 * Resolve the signed-in user to their `riders` row.
 *
 * The rider dashboard resolves this by id FIRST and then falls back to email
 * (src/app/rider/page.tsx). The server used to match on id only, so any rider
 * whose row was created before their auth account existed — or whose row is
 * keyed differently — passed the client's "verified" check and was then
 * rejected by the API with 403, which the UI rendered as an error banner in
 * the middle of the Boda tab. The two sides must agree on identity, so this
 * uses the same id-then-email resolution.
 */
async function resolveRiderRow(
  sb: NonNullable<ReturnType<typeof getServiceClient>>,
  userId: string,
  email: string
) {
  /* Delegates to the single resolver in @/lib/rider-verification — the same one
     /api/rider/verify uses to decide whether to show the rider the Boda board.

     Reading `riders.verified` directly here meant a rider who had been approved
     on their documents (or via a verified merchant account) passed the client's
     gate, saw the board, tapped Accept, and received 403 "Verify your rider
     account first." — the reported "button does nothing". The resolver promotes
     the row from that evidence instead of blocking on it. */
  try {
    return await resolveVerifiedRider(sb, userId, email);
  } catch {
    // Fall through to null; callers turn this into a 403, never a 500.
    return null;
  }
}

/**
 * Book a ride. Prices with the same priceRide() the customer-facing
 * quote at POST /api/rides/quote uses - same rates, same road
 * route - so the amount shown is the amount charged.
 */
export async function POST(req: NextRequest) {
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "Not configured" }, { status: 500 });
  const actor = await authorize(req);
  if (!actor || actor.kind !== "user") {
    return NextResponse.json({ error: "Sign in to request a ride" }, { status: 401 });
  }
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const t = parseTrip(body);
  if (!t.ok) {
    return NextResponse.json({ error: "Set a valid pickup and dropoff on the map" }, { status: 400 });
  }

  /* One pricing call. The guard rails test the SAME road distance the customer
     was quoted, so a trip that passes 0.05 km on screen also passes it here. */
  const kind = fareKindOf(body.kind);
  const priced = await priceRide(sb, {
    pickupLat: t.pickupLat as number,
    pickupLng: t.pickupLng as number,
    dropoffLat: t.dropoffLat as number,
    dropoffLng: t.dropoffLng as number,
    kind,
  });

  if (priced.distanceKm < MIN_RIDE_KM) {
    return NextResponse.json({ error: "Pickup and dropoff are the same place" }, { status: 400 });
  }
  if (priced.distanceKm > MAX_RIDE_KM) {
    return NextResponse.json(
      { error: `Rides are limited to ${MAX_RIDE_KM} km` },
      { status: 400 },
    );
  }

  /* The itemised breakdown is written only when the columns exist.
     PostgREST rejects a whole insert if ANY named column is missing, so writing
     them unconditionally would take ride booking offline on a database that has
     not had FARE_SCHEMA.sql applied. The fare itself still comes from the same
     engine either way — this only controls how finely it is recorded. */
  const haveFareColumns = await fareColumnsReady(sb);

  const { data, error } = await sb
    .from("ride_requests")
    .insert({
      customer_id: actor.id,
      customer_name: String(body.customer_name || ""),
      customer_phone: String(body.customer_phone || ""),
      /* Read from the PARSED trip (`t`), not bare identifiers. Bare
         `pickupLat` does not exist in this scope — it resolves to undefined, so
         every new ride was being inserted with NULL coordinates and the map had
         nothing to route. */
      pickup_lat: t.pickupLat,
      pickup_lng: t.pickupLng,
      pickup_address: String(body.pickup_address || ""),
      dropoff_lat: t.dropoffLat,
      dropoff_lng: t.dropoffLng,
      dropoff_address: String(body.dropoff_address || ""),
      distance_km: priced.distanceKm,
      fare_ugx: priced.quote.fare_ugx,
      service_fee_ugx: priced.serviceFee,
      total_ugx: priced.total,
      status: "requested",
      ...(haveFareColumns
        ? {
            duration_min: priced.durationMin,
            fare_tier: priced.quote.tier,
            vehicle_kind: kind,
            base_ugx: priced.quote.base_ugx,
            distance_ugx: priced.quote.distance_ugx,
            time_ugx: priced.quote.time_ugx,
            wait_ugx: priced.quote.wait_ugx,
            wait_min: priced.quote.wait_min,
            quote_snapshot: priced.quote,
          }
        : {}),
    })
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ride: data, quote: priced.quote, service_fee_ugx: priced.serviceFee, total_ugx: priced.total });
}

export async function GET(req: NextRequest) {
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "Not configured" }, { status: 500 });
  const actor = await authorize(req);
  if (!actor || actor.kind !== "user") return NextResponse.json({ error: "Sign in to continue" }, { status: 401 });
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");

  if (id) {
    if (!isUuid(id)) return NextResponse.json({ rides: [] });
    const { data } = await sb.from("ride_requests").select("*").eq("id", id).maybeSingle();
    const r = data as Record<string, unknown> | null;
    if (!r) return NextResponse.json({ rides: [] });
    if (r.customer_id !== actor.id && r.rider_id !== actor.id) {
      return NextResponse.json({ rides: [] }, { status: 404 });
    }
    return NextResponse.json({ rides: [r] });
  }

  if (searchParams.get("mine") === "1") {
    const { data } = await sb
      .from("ride_requests")
      .select("*")
      .eq("customer_id", actor.id)
      .order("created_at", { ascending: false })
      .limit(50);
    return NextResponse.json({ rides: data || [] });
  }

  if (searchParams.get("driver") === "1") {
    // Rider's own rides (active + recent) — participant-only rows.
    const { data } = await sb
      .from("ride_requests")
      .select("*")
      .eq("rider_id", actor.id)
      .order("created_at", { ascending: false })
      .limit(50);
    return NextResponse.json({ rides: data || [] });
  }

  if (searchParams.get("open") === "1") {    // Open dispatch pool — verified riders only (same bar as deliveries).
    const riderRow = await resolveRiderRow(sb, actor.id, actor.email || "");
    if (!riderRow || !riderRow.verified) {
      return NextResponse.json({ error: "Verify your rider account to see ride requests." }, { status: 403 });
    }
    /* The rider sees the SAME itemised figures the customer was quoted —
       base, distance, time, wait and service fee — not a single opaque
       total. Two views of one fare is how they drift apart.

       The itemised columns are requested only when they exist. PostgREST 400s
       the whole select otherwise, which would leave every rider staring at an
       empty dispatch board while requests were live — a far worse failure than
       a slightly plainer fare line. */
    const detailed = [
      "id", "pickup_lat", "pickup_lng", "pickup_address",
      "dropoff_lat", "dropoff_lng", "dropoff_address", "distance_km",
      "duration_min", "fare_tier", "vehicle_kind", "base_ugx",
      "distance_ugx", "time_ugx", "wait_ugx", "wait_min",
      "fare_ugx", "service_fee_ugx", "total_ugx",
      "customer_name", "status", "created_at", "quote_snapshot",
    ].join(", ");
    const basic = [
      "id", "pickup_lat", "pickup_lng", "pickup_address",
      "dropoff_lat", "dropoff_lng", "dropoff_address", "distance_km",
      "fare_ugx", "service_fee_ugx", "total_ugx",
      "customer_name", "status", "created_at",
    ].join(", ");

    const haveFareColumns = await fareColumnsReady(sb);
    const { data } = await sb
      .from("ride_requests")
      .select(haveFareColumns ? detailed : basic)
      .eq("status", "requested")
      .order("created_at", { ascending: false })
      .limit(100);
    return NextResponse.json({ rides: data || [] });
  }

  return NextResponse.json({ error: "Use ?mine=1, ?open=1 or ?id=" }, { status: 400 });
}


/** Best-effort browser push on a ride status change. Never blocks the request. */
async function notifyRide(
  sb: NonNullable<ReturnType<typeof getServiceClient>>,
  ride: Record<string, unknown>,
  next: string,
): Promise<void> {
  try {
    const customerId = ride.customer_id as string | null;
    const riderId = ride.rider_id as string | null;
    const where = ride.dropoff_address || ride.pickup_address || "your Boda ride";
    const head =
      next === "accepted" ? "Rider accepted your ride"
      : next === "in_progress" ? "Your ride is on the way"
      : next === "completed" ? "Ride completed"
      : next === "cancelled" ? "Ride cancelled"
      : "Ride update";
    const url = `/ride?rideId=${ride.id}`;
    if (customerId) {
      await pushToUser(sb, customerId, { title: head, body: `To ${where}`, url, tag: `ride-${ride.id}` });
    }
    if (riderId && next === "requested") {
      await pushToUser(sb, riderId, { title: "New ride request", body: `Pickup near ${where}`, url: "/rider", tag: `ridereq-${ride.id}` });
    }
  } catch {
    // Push is a convenience, never a dependency.
  }
}

export async function PATCH(req: NextRequest) {
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "Not configured" }, { status: 500 });
  const actor = await authorize(req);
  if (!actor || actor.kind !== "user") return NextResponse.json({ error: "Sign in to continue" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const id = typeof body.id === "string" && isUuid(body.id) ? body.id : null;
  const action = typeof body.action === "string" ? body.action : "";
  if (!id) return NextResponse.json({ error: "Ride id required" }, { status: 400 });

  const { data: ride } = await sb.from("ride_requests").select("*").eq("id", id).maybeSingle();
  const r = ride as Record<string, unknown> | null;
  if (!r) return NextResponse.json({ error: "Ride not found" }, { status: 404 });

  if (action === "accept") {
    const riderRow = await resolveRiderRow(sb, actor.id, actor.email || "");
    if (!riderRow || !riderRow.verified) {
      return NextResponse.json({ error: "Verify your rider account first." }, { status: 403 });
    }
    if (r.status !== "requested") {
      return NextResponse.json({ error: "This ride was already taken" }, { status: 409 });
    }
    // One active ride at a time.
    const { data: busy } = await sb
      .from("ride_requests")
      .select("id")
      .eq("rider_id", actor.id)
      .in("status", ["accepted", "in_progress"])
      .limit(1)
      .maybeSingle();
    if (busy) {
      return NextResponse.json({ error: "Finish your current ride first." }, { status: 409 });
    }
    /* `accepted_at` does not exist until FARE_SCHEMA.sql is applied, and
       PostgREST rejects the WHOLE update for one unknown key — which is what
       made every Accept tap report "already taken" on a ride nobody else had
       claimed. Drop the keys the table really lacks and keep the claim. */
    const acceptPatch = await writableUpdate(sb, "ride_requests", {
      status: "accepted",
      rider_id: actor.id,
      rider_name: String(body.rider_name || ""),
      accepted_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    const { data: claimed, error } = await sb
      .from("ride_requests")
      .update(acceptPatch)
      .eq("id", id)
      .eq("status", "requested")
      .select("*")
      .maybeSingle();
    /* A rejected UPDATE and a lost race are different problems and must not
       share a message: the first is ours to fix, the second is the world. */
    if (error) {
      console.error("[rides.accept] claim update failed", error);
      return NextResponse.json(
        { error: "Could not claim this ride — the update was rejected." },
        { status: 500 },
      );
    }
    if (!claimed) return NextResponse.json({ error: "This ride was already taken" }, { status: 409 });
    void notifyRide(sb, claimed as Record<string, unknown>, "accepted");
    return NextResponse.json({ ride: claimed });
  }

  if (action === "start") {
    if (r.rider_id !== actor.id) return NextResponse.json({ error: "Not your ride" }, { status: 403 });
    if (r.status !== "accepted") return NextResponse.json({ error: "Ride is not ready to start" }, { status: 409 });
    const startPatch = await writableUpdate(sb, "ride_requests", {
      status: "in_progress",
      started_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    const { data, error } = await sb
      .from("ride_requests")
      .update(startPatch)
      .eq("id", id)
      .eq("status", "accepted")
      .select("*")
      .maybeSingle();
    if (error) {
      console.error("[rides.start] update failed", error);
      return NextResponse.json({ error: "Could not start ride" }, { status: 500 });
    }
    if (!data) return NextResponse.json({ error: "Could not start ride" }, { status: 409 });
    void notifyRide(sb, data as Record<string, unknown>, "in_progress");
    return NextResponse.json({ ride: data });
  }

  if (action === "complete") {
    if (r.rider_id !== actor.id) return NextResponse.json({ error: "Not your ride" }, { status: 403 });
    // A rider who accepts and then taps Delivered without ever hitting Start
    // used to be permanently stuck: the old guard demanded in_progress, so the
    // tap 409'd forever and the customer's side never settled. Accept the ride
    // as completable, and treat an already-completed ride as a no-op success
    // so a retry after a dropped response still resolves.
    if (r.status === "completed") return NextResponse.json({ ride: r, already: true });
    if (r.status !== "in_progress" && r.status !== "accepted") {
      return NextResponse.json({ error: "Ride is not in progress" }, { status: 409 });
    }
    /* Settle the fare BEFORE flipping status, so the stored fare already
       includes any stopover the rider accrued. Idempotent: a ride already
       finalised keeps its original numbers, so a retried tap after a dropped
       response can never bill the customer twice. */
    await finaliseRideFare(sb, id);

    const completePatch = await writableUpdate(sb, "ride_requests", {
      status: "completed",
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    const { data, error } = await sb
      .from("ride_requests")
      .update(completePatch)
      .eq("id", id)
      .in("status", ["in_progress", "accepted"])
      .select("*")
      .maybeSingle();
    if (error) {
      console.error("[rides.complete] update failed", error);
      return NextResponse.json({ error: "Could not complete ride" }, { status: 500 });
    }
    if (!data) return NextResponse.json({ error: "Could not complete ride" }, { status: 409 });
    void notifyRide(sb, data as Record<string, unknown>, "completed");
    return NextResponse.json({ ride: data });
  }

  if (action === "cancel") {
    const mine = r.customer_id === actor.id;
    const driver = r.rider_id === actor.id;
    if (!mine && !driver) return NextResponse.json({ error: "Not your ride" }, { status: 403 });
    if (!["requested", "accepted"].includes(String(r.status))) {
      return NextResponse.json({ error: "Ride can no longer be cancelled" }, { status: 409 });
    }
    const { data, error } = await sb
      .from("ride_requests")
      .update({ status: "cancelled", updated_at: new Date().toISOString() })
      .eq("id", id)
      .in("status", ["requested", "accepted"])
      .select("*")
      .maybeSingle();
    if (error || !data) return NextResponse.json({ error: "Could not cancel ride" }, { status: 409 });
    return NextResponse.json({ ride: data });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
