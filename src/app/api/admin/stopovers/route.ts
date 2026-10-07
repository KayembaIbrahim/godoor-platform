import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getServiceClient } from "@/lib/supabase-server";
import { ADMIN_COOKIE, verifySession } from "@/lib/admin-auth";
import { pendingStopoverDisputes, resolveStopoverDispute } from "@/lib/stopover-server";
import { readStopover } from "@/lib/stopover-store";
import { invalidateFareRates, loadFareRates, saveFareRates } from "@/lib/fare-config-server";

/**
 * Admin control over rider-declared waiting time.
 *
 * Two jobs:
 *
 *   GET              — open disputes, plus the full stopover log for one ride so
 *                      an operator can see when each wait started, why, how long,
 *                      and whether it was capped or auto-closed by GPS.
 *   PATCH (rates)    — tune the caps and the rate without a deploy.
 *   PATCH (dispute)  — uphold or refund a contested wait.
 *
 * The refund path zeroes BOTH the charge and the accumulated minutes. Zeroing
 * only the money would let the next re-quote recompute the wait from the minutes
 * and resurrect the charge that was just refunded — the kind of bug that surfaces
 * weeks later as "you refunded me but I was still charged".
 *
 * ── Storage ──────────────────────────────────────────────────────────────────
 * Disputes and wait records live in `app_settings` (see `stopover-store`), not
 * in `ride_stopover_disputes` / `ride_stopovers`. Those tables ship with
 * FARE_SCHEMA.sql and have never been applied to production, so querying them
 * here returned an empty list forever and the refund control was dead.
 */
export async function GET(req: NextRequest) {
  const jar = await cookies();
  if (!(await verifySession(jar.get(ADMIN_COOKIE)?.value || ""))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "Not configured" }, { status: 500 });

  const rideId = req.nextUrl.searchParams.get("rideId");

  if (rideId) {
    const rec = await readStopover(sb, rideId);
    /* Only columns that exist in every deployment. */
    const { data: ride } = await sb
      .from("ride_requests")
      .select("id, customer_id, customer_name, rider_id, rider_name, status, distance_km, fare_ugx, service_fee_ugx, total_ugx")
      .eq("id", rideId)
      .maybeSingle();
    return NextResponse.json({
      events: rec.sessions,
      open: rec.open,
      dispute: rec.dispute,
      totals: { minutes: rec.totalMinutes, chargeUgx: rec.totalChargeUgx },
      ride: ride || null,
    });
  }

  const [disputes, rates] = await Promise.all([pendingStopoverDisputes(sb), loadFareRates(sb)]);

  /* Attach the ride AND the accrued wait so the operator can judge the dispute
     without opening three other screens — who was waiting, for how long, and
     what it cost. The wait figures come from the kv store, not the ride row. */
  const rideIds = disputes.map((d) => d.rideId).filter((x): x is string => typeof x === "string");
  let rides: Record<string, unknown>[] = [];
  if (rideIds.length) {
    const { data } = await sb
      .from("ride_requests")
      .select("id, pickup_address, dropoff_address, distance_km, fare_ugx, total_ugx")
      .in("id", rideIds);
    rides = (data || []) as Record<string, unknown>[];
  }

  const totals: Record<string, { minutes: number; chargeUgx: number }> = {};
  for (const id of rideIds) {
    const rec = await readStopover(sb, id);
    totals[id] = { minutes: rec.totalMinutes, chargeUgx: rec.totalChargeUgx };
  }

  return NextResponse.json({ disputes, rides, totals, rates });
}

export async function PATCH(req: NextRequest) {
  const jar = await cookies();
  if (!(await verifySession(jar.get(ADMIN_COOKIE)?.value || ""))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "Not configured" }, { status: 500 });

  const body = await req.json().catch(() => ({}));
  const kind = typeof body.kind === "string" ? body.kind : "";

  /* ── Resolve a contested wait ──────────────────────────────────────────── */
  if (kind === "dispute") {
    const id = typeof body.id === "string" ? body.id : "";
    const outcome = body.outcome === "refunded" ? "refunded" : body.outcome === "upheld" ? "upheld" : null;
    if (!id || !outcome) {
      return NextResponse.json({ error: "id and outcome (upheld|refunded) required" }, { status: 400 });
    }
    /* The admin session token carries no operator id, so the audit row records
       the acting surface rather than inventing an identity we cannot verify. */
    const res = await resolveStopoverDispute(sb, id, "admin", outcome, body.note);
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 });
    return NextResponse.json({ ok: true });
  }

  /* ── Tune the rates and caps ───────────────────────────────────────────── */
  if (kind === "rates") {
    const patch: Record<string, number> = {};
    for (const [k, v] of Object.entries(body.rates ?? {})) {
      const n = Number(v);
      if (Number.isFinite(n) && n >= 0) patch[k] = n;
    }
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "No valid rate fields supplied" }, { status: 400 });
    }
    const saved = await saveFareRates(sb, patch);
    if (!saved.ok) return NextResponse.json({ error: saved.error }, { status: 400 });
    /* Drop the 30s memo so the new rate takes effect on the very next quote
       rather than up to half a minute later. */
    invalidateFareRates();
    return NextResponse.json({ ok: true, rates: await loadFareRates(sb) });
  }

  return NextResponse.json({ error: "Unknown kind" }, { status: 400 });
}
