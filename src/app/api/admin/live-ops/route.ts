import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getServiceClient } from "@/lib/supabase-server";
import { ADMIN_COOKIE, verifySession } from "@/lib/admin-auth";

/**
 * Live-ops diagnostics for delivery tracking.
 *
 * Exists because "the customer's map shows no rider" has two very different
 * causes that look identical from the UI:
 *   1. no location is being written at all (rider app closed / permission
 *      denied / not yet shared), or
 *   2. location is flowing but the customer's client is not receiving it.
 *
 * This endpoint answers (1) from the database, so support can tell them apart
 * without a customer login. Read-only. Service-role access is required because
 * rider_locations has no client-readable policy for other users' rows.
 */

const FRESH_SECONDS = 90;

export async function GET() {
  const jar = await cookies();
  if (!(await verifySession(jar.get(ADMIN_COOKIE)?.value || ""))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "Not configured" }, { status: 500 });

  const now = Date.now();
  const age = (ts?: string | null) => {
    if (!ts) return null;
    const t = new Date(ts).getTime();
    if (!Number.isFinite(t)) return null;
    return Math.max(0, Math.round((now - t) / 1000));
  };

  // Riders considered live: anyone a customer could currently be tracking.
  const [{ data: riders }, { data: locs }, { data: orders }, { data: ridesOpen }] = await Promise.all([
    sb.from("riders").select("id, name, status, phone").limit(200),
    sb.from("rider_locations").select("rider_id, lat, lng, heading, accuracy, updated_at").limit(500),
    sb
      .from("orders")
      .select("id, status, customer_name, rider_id, rider_name, updated_at")
      .in("status", ["rider_assigned", "delivering", "ready"])
      .order("created_at", { ascending: false })
      .limit(100),
    sb
      .from("ride_requests")
      .select("id, status, customer_name, rider_id, rider_name, updated_at")
      .in("status", ["accepted", "in_progress", "requested"])
      .order("created_at", { ascending: false })
      .limit(100),
  ]);

  const locByRider = new Map<string, Record<string, unknown>>();
  for (const l of (locs ?? []) as Record<string, unknown>[]) {
    const id = String(l.rider_id);
    // Keep the newest row if duplicates exist.
    const prev = locByRider.get(id);
    if (!prev || new Date(String(l.updated_at)).getTime() > new Date(String(prev.updated_at)).getTime()) {
      locByRider.set(id, l);
    }
  }

  const riderRows = ((riders ?? []) as Record<string, unknown>[]).map((r) => {
    const id = String(r.id);
    const loc = locByRider.get(id);
    const seconds = age(loc?.updated_at as string | undefined);
    return {
      id,
      name: r.name,
      status: r.status,
      phone: r.phone ?? null,
      has_location: Boolean(loc),
      last_seen_seconds: seconds,
      fresh: seconds !== null && seconds <= FRESH_SECONDS,
      lat: loc?.lat ?? null,
      lng: loc?.lng ?? null,
      accuracy: loc?.accuracy ?? null,
    };
  });

  const onRoute = ((orders ?? []) as Record<string, unknown>[]).map((o) => {
    const rid = o.rider_id ? String(o.rider_id) : null;
    const loc = rid ? locByRider.get(rid) : null;
    const seconds = age(loc?.updated_at as string | undefined);
    return {
      id: o.id,
      kind: "delivery",
      status: o.status,
      customer_name: o.customer_name,
      rider_id: rid,
      rider_name: o.rider_name,
      rider_reporting: Boolean(loc),
      rider_last_seen_seconds: seconds,
      rider_fresh: seconds !== null && seconds <= FRESH_SECONDS,
    };
  });

  const openRides = ((ridesOpen ?? []) as Record<string, unknown>[]).map((o) => {
    const rid = o.rider_id ? String(o.rider_id) : null;
    const loc = rid ? locByRider.get(rid) : null;
    const seconds = age(loc?.updated_at as string | undefined);
    return {
      id: o.id,
      kind: "boda",
      status: o.status,
      customer_name: o.customer_name,
      rider_id: rid,
      rider_name: o.rider_name,
      rider_reporting: Boolean(loc),
      rider_last_seen_seconds: seconds,
      rider_fresh: seconds !== null && seconds <= FRESH_SECONDS,
    };
  });

  const tracked = [...onRoute, ...openRides];

  return NextResponse.json({
    fresh_threshold_seconds: FRESH_SECONDS,
    riders: riderRows,
    tracked,
    summary: {
      riders_total: riderRows.length,
      riders_with_any_location: riderRows.filter((r) => r.has_location).length,
      riders_reporting_fresh: riderRows.filter((r) => r.fresh).length,
      tracked_items: tracked.length,
      tracked_without_location: tracked.filter((t) => !t.rider_reporting).length,
      tracked_with_stale_location: tracked.filter((t) => t.rider_reporting && !t.rider_fresh).length,
    },
  });
}
