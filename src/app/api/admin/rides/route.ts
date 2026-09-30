import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getServiceClient } from "@/lib/supabase-server";
import { ADMIN_COOKIE, verifySession } from "@/lib/admin-auth";
import { isUuid } from "@/lib/api-auth";

/**
 * Admin ride management.
 *
 * Boda rides live in their own table, so the order endpoints never showed them
 * and a ride left mid-flight stayed on the customer's account with no way for
 * an operator to see or clear it. GET lists rides (optionally filtered by
 * status), PATCH settles one.
 */

const OPEN = ["requested", "accepted", "in_progress"] as const;
const CLOSED = ["completed", "cancelled"] as const;

export async function GET(req: Request) {
  const jar = await cookies();
  if (!(await verifySession(jar.get(ADMIN_COOKIE)?.value || ""))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "Not configured" }, { status: 500 });

  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  const only = url.searchParams.get("open") === "1";

  let q = sb.from("ride_requests").select("*").order("created_at", { ascending: false }).limit(200);
  if (status) {
    const wanted = status.split(",").map((s) => s.trim()).filter(Boolean);
    if (wanted.length) q = q.in("status", wanted);
  } else if (only) {
    q = q.in("status", [...OPEN]);
  }

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rides = data ?? [];
  return NextResponse.json({
    rides,
    counts: {
      open: rides.filter((r) => (OPEN as readonly string[]).includes(String(r.status))).length,
      total: rides.length,
    },
  });
}

export async function PATCH(req: Request) {
  const jar = await cookies();
  if (!(await verifySession(jar.get(ADMIN_COOKIE)?.value || ""))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "Not configured" }, { status: 500 });

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const id = String(body.id ?? "");
  const status = String(body.status ?? "");
  if (!isUuid(id) || !([...OPEN, ...CLOSED] as string[]).includes(status)) {
    return NextResponse.json({ error: "Valid id and status required" }, { status: 400 });
  }

  // Load first so a terminal ride is never silently re-opened, and so the
  // caller gets a 404 for a ride that no longer exists.
  const { data: ride } = await sb.from("ride_requests").select("*").eq("id", id).maybeSingle();
  if (!ride) return NextResponse.json({ error: "Ride not found" }, { status: 404 });

  const current = String(ride.status);
  if ((CLOSED as readonly string[]).includes(current) && current !== status) {
    return NextResponse.json({ error: `Ride already ${current}` }, { status: 400 });
  }

  // Only columns the app already relies on. The rides table has no schema
  // file in this repo, so writing speculative columns (completed_at,
  // cancel_reason) would throw on a table that may not have them.
  const patch: Record<string, unknown> = { status, updated_at: new Date().toISOString() };

  const { data, error } = await sb.from("ride_requests").update(patch).eq("id", id).select("*").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, ride: data, previous_status: current });
}
