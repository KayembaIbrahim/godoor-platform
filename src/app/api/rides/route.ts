import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase-server";
import { authorize, isUuid } from "@/lib/api-auth";

/**
 * Boda ride-hailing API (v1).
 * - POST: customer requests a ride (server prices it: base + per-km + 5% service fee).
 * - GET ?mine=1: my rides (customer) · ?open=1: open requests (verified riders) · ?id=: one ride (participant only).
 * - PATCH {id, action}: accept (verified rider, atomic claim) · start · complete · cancel.
 * All money math is server-authoritative; fee caps reuse fee_config.
 */

const BODA_BASE_UGX = 2000;
const BODA_PER_KM_UGX = 1200;
const BODA_MIN_FARE_UGX = 2500;

function validCoord(v: unknown, min: number, max: number): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
}

function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const r = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(s));
}

async function feeCaps(sb: NonNullable<ReturnType<typeof getServiceClient>>) {
  let min = 0;
  let max = 10000;
  try {
    const { data: f } = await sb.from("fee_config").select("service_fee_min_ugx, service_fee_max_ugx").eq("id", "default").single();
    if (f) {
      min = Number((f as { service_fee_min_ugx: number }).service_fee_min_ugx ?? 0);
      max = Number((f as { service_fee_max_ugx: number }).service_fee_max_ugx ?? 10000);
    }
  } catch {}
  return { min, max };
}

export async function POST(req: NextRequest) {
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "Not configured" }, { status: 500 });
  const actor = await authorize(req);
  if (!actor || actor.kind !== "user") {
    return NextResponse.json({ error: "Sign in to request a ride" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const pickupLat = validCoord(body.pickup_lat, -1.5, 4.5);
  const pickupLng = validCoord(body.pickup_lng, 28, 36);
  const dropoffLat = validCoord(body.dropoff_lat, -1.5, 4.5);
  const dropoffLng = validCoord(body.dropoff_lng, 28, 36);
  if (pickupLat === null || pickupLng === null || dropoffLat === null || dropoffLng === null) {
    return NextResponse.json({ error: "Set a valid pickup and dropoff on the map" }, { status: 400 });
  }
  const km = haversineKm(pickupLat, pickupLng, dropoffLat, dropoffLng);
  if (km < 0.05) {
    return NextResponse.json({ error: "Pickup and dropoff are the same place" }, { status: 400 });
  }
  if (km > 60) {
    return NextResponse.json({ error: "Boda rides are limited to 60 km" }, { status: 400 });
  }
  const fare = Math.max(BODA_MIN_FARE_UGX, Math.round(BODA_BASE_UGX + km * BODA_PER_KM_UGX));
  const { min, max } = await feeCaps(sb);
  const serviceFee = Math.min(max, Math.max(min, Math.round((fare * 5) / 100)));
  const total = fare + serviceFee;

  const { data, error } = await sb
    .from("ride_requests")
    .insert({
      customer_id: actor.id,
      customer_name: String(body.customer_name || ""),
      customer_phone: String(body.customer_phone || ""),
      pickup_lat: pickupLat,
      pickup_lng: pickupLng,
      pickup_address: String(body.pickup_address || ""),
      dropoff_lat: dropoffLat,
      dropoff_lng: dropoffLng,
      dropoff_address: String(body.dropoff_address || ""),
      distance_km: Math.round(km * 100) / 100,
      fare_ugx: fare,
      service_fee_ugx: serviceFee,
      total_ugx: total,
      status: "requested",
    })
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ride: data });
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
    const { data: riderRow } = await sb.from("riders").select("verified").eq("id", actor.id).maybeSingle();
    if (!riderRow || !(riderRow as { verified: boolean }).verified) {
      return NextResponse.json({ error: "Verify your rider account to see ride requests." }, { status: 403 });
    }
    const { data } = await sb
      .from("ride_requests")
      .select("id, pickup_lat, pickup_lng, pickup_address, dropoff_lat, dropoff_lng, dropoff_address, distance_km, fare_ugx, service_fee_ugx, total_ugx, customer_name, status, created_at")
      .eq("status", "requested")
      .order("created_at", { ascending: false })
      .limit(100);
    return NextResponse.json({ rides: data || [] });
  }

  return NextResponse.json({ error: "Use ?mine=1, ?open=1 or ?id=" }, { status: 400 });
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
    const { data: riderRow } = await sb.from("riders").select("verified").eq("id", actor.id).maybeSingle();
    if (!riderRow || !(riderRow as { verified: boolean }).verified) {
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
    const { data: claimed, error } = await sb
      .from("ride_requests")
      .update({
        status: "accepted",
        rider_id: actor.id,
        rider_name: String(body.rider_name || ""),
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("status", "requested")
      .select("*")
      .maybeSingle();
    if (error || !claimed) return NextResponse.json({ error: "This ride was already taken" }, { status: 409 });
    return NextResponse.json({ ride: claimed });
  }

  if (action === "start") {
    if (r.rider_id !== actor.id) return NextResponse.json({ error: "Not your ride" }, { status: 403 });
    if (r.status !== "accepted") return NextResponse.json({ error: "Ride is not ready to start" }, { status: 409 });
    const { data, error } = await sb
      .from("ride_requests")
      .update({ status: "in_progress", updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("status", "accepted")
      .select("*")
      .maybeSingle();
    if (error || !data) return NextResponse.json({ error: "Could not start ride" }, { status: 409 });
    return NextResponse.json({ ride: data });
  }

  if (action === "complete") {
    if (r.rider_id !== actor.id) return NextResponse.json({ error: "Not your ride" }, { status: 403 });
    if (r.status !== "in_progress") return NextResponse.json({ error: "Ride is not in progress" }, { status: 409 });
    const { data, error } = await sb
      .from("ride_requests")
      .update({ status: "completed", updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("status", "in_progress")
      .select("*")
      .maybeSingle();
    if (error || !data) return NextResponse.json({ error: "Could not complete ride" }, { status: 409 });
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
