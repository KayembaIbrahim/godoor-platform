/**
 * Stopover ("waiting on customer") accounting.
 *
 * THE MODEL
 * ---------
 * A stopover is a DECLARED EVENT, not an automatic consequence of a slow rider:
 *
 *   1. The rider taps "Waiting on customer" and picks a reason.
 *   2. The SERVER opens a session against its own clock and tells the customer
 *      immediately — before a single shilling is billed.
 *   3. The session runs. If the rider starts driving again, GPS closes it
 *      automatically; the rider can also close it by hand.
 *   4. On close, the minutes are added to the fare and the customer is told what
 *      it cost.
 *
 * WHY NOT BILL AUTOMATICALLY
 * --------------------------
 * The previous version inferred wait time from stationary GPS pings and added it
 * to the fare silently. It failed in both directions at once: the customer
 * discovered the charge only at payment, and a rider could farm wait time by
 * idling at every junction. Declaring it means the charge is explained before it
 * lands, every charge has an audit row with a stated reason, and the customer
 * can dispute it.
 *
 * SECURITY
 * --------
 * A button that adds money is the most abusable control in the app, so every
 * one of these is enforced server-side. The client is never trusted with a
 * timestamp, a duration or an amount:
 *
 *   • IDOR      — only the rider ASSIGNED to that ride may open a stopover.
 *   • Clock     — `started_at` is the server's. A client that sends a fake time
 *                 can only ever shorten its own session.
 *   • GPS       — a start is refused while the vehicle is moving. This is the
 *                 control that stops "tap it at every junction" from paying.
 *   • Idempotent— Postgres holds a partial unique index allowing only one OPEN
 *                 session per ride, so a double-tap cannot open two clocks.
 *   • Caps      — per session and per ride, so no single event can drain a
 *                 wallet over a long evening.
 *   • Cooldown  — stopovers cannot be re-opened instantly, closing the
 *                 tap-tap-tap loop even after a legitimate one.
 *   • Dispute   — the customer can contest, and admin can waive, so a wrong
 *                 charge is fixable by a human rather than only by deleting the
 *                 account.
 */


import type { SupabaseClient } from "@supabase/supabase-js";
import { loadFareRates } from "@/lib/fare-config-server";
import { existingColumns, writableUpdate } from "@/lib/schema-capabilities";
import { waitChargeUgx, type StopoverReason } from "@/lib/stopover-core";
import {
  claimStopoverLock,
  listDisputes,
  readStopover,
  releaseStopoverLock,
  stopoverStoreReady,
  writeDispute,
  writeStopover,
} from "@/lib/stopover-store";

/* Re-exported so server callers get the whole stopover vocabulary from one
   module, and so the pure rules have exactly one definition on disk. */
export {
  waitChargeUgx,
  isStopoverReason,
  STOPOVER_REASONS,
  STOPOVER_REASON_LABEL,
  STOPOVER_REASON_HINT,
  stopoverLiveView,
  formatDuration,
} from "@/lib/stopover-core";
export type { StopoverReason, StopoverLiveView } from "@/lib/stopover-core";

/**
 * Above this speed the vehicle is demonstrably moving and a stopover is not
 * credible. 12 km/h is deliberately well above the 3 km/h "stationary" line used
 * for passive detection: this is a fraud check, so it should be forgiving to a
 * rider genuinely stopped and unforgiving to one inflating the clock.
 */
export const START_MAX_SPEED_KMH = 12;

/** A GPS fix older than this cannot corroborate anything. */
export const GPS_FRESH_MAX_MS = 120_000;

export type StopoverStartResult =
  | { ok: true; stopoverId: string; startedAt: string; alreadyOpen: boolean }
  | { ok: false; error: string; status: number };

/**
 * Is waiting time available?
 *
 * State now lives in `app_settings`, which exists in production, so this is a
 * liveness probe rather than a schema gate. Kept as a function because the UI
 * reads it to decide whether to offer the control at all.
 */
export async function stopoverSchemaReady(sb: SupabaseClient): Promise<boolean> {
  return stopoverStoreReady(sb);
}

/** Test seam: forget the cached probe. */
export function resetStopoverProbe(): void {
  /* The store owns its own cache; nothing to reset here. */
}

/* ─── Start ─────────────────────────────────────────────────────────────────── */

/**
 * Open a stopover session on behalf of `riderId` for `rideId`.
 *
 * Returns `alreadyOpen: true` (not an error) when a session is already running,
 * so a double-tap on a flaky connection is a harmless no-op rather than a
 * second clock.
 */
export async function startStopover(
  sb: SupabaseClient,
  rideId: string,
  riderId: string,
  reason: StopoverReason,
): Promise<StopoverStartResult> {
  if (!(await stopoverSchemaReady(sb))) {
    return { ok: false, error: "Waiting time is not enabled yet", status: 503 };
  }

  /* Only columns that exist in every deployment. The stopover_* columns this
     used to select were never applied in production, and naming one makes
     PostgREST reject the entire SELECT. `finalised` only exists once
     FARE_SCHEMA.sql has been applied, so it is probed for rather than named. */
  const extra = await existingColumns(sb, "ride_requests", ["finalised"]);
  const { data: rideRow } = await sb
    .from("ride_requests")
    .select(extra.has("finalised") ? "id, rider_id, customer_id, status, finalised" : "id, rider_id, customer_id, status")
    .eq("id", rideId)
    .maybeSingle();
  const ride = rideRow as Record<string, unknown> | null;
  if (!ride) return { ok: false, error: "Ride not found", status: 404 };

  // IDOR: an authenticated rider must not be able to start a clock on someone
  // else's trip just because they learned a ride id.
  if (String(ride.rider_id || "") !== riderId) {
    return { ok: false, error: "This is not your ride", status: 403 };
  }
  if (String(ride.status) !== "in_progress") {
    return { ok: false, error: "Stopover only applies during an active trip", status: 409 };
  }

  const rec = await readStopover(sb, rideId);
  if (rec.finalisedAt || ride.finalised === true) {
    return { ok: false, error: "This trip's fare is already settled", status: 409 };
  }

  // Idempotent short-circuit before any spend of a round trip.
  if (rec.open) {
    return { ok: true, stopoverId: rec.open.id, startedAt: rec.open.startedAt, alreadyOpen: true };
  }

  const rates = await loadFareRates(sb);

  const rideCap = Number(rates.stopover_max_ride_min) || 60;
  if (rec.totalMinutes >= rideCap) {
    return {
      ok: false,
      error: `Wait time on this trip has reached its ${rideCap} minute limit`,
      status: 409,
    };
  }

  // Cooldown: stops the tap-tap-tap loop immediately after a legitimate stop.
  const lastClosed = [...rec.sessions]
    .filter((s) => s.closeReason && s.closeReason !== "too_short" && s.endedAt)
    .sort((a, b) => Date.parse(b.endedAt || "") - Date.parse(a.endedAt || ""))[0];
  if (lastClosed?.endedAt) {
    const sinceMin = (Date.now() - Date.parse(lastClosed.endedAt)) / 60000;
    const cooldown = Number(rates.stopover_cooldown_min) || 5;
    if (Number.isFinite(sinceMin) && sinceMin >= 0 && sinceMin < cooldown) {
      return {
        ok: false,
        error: `You can start another wait in ${Math.ceil(cooldown - sinceMin)} min`,
        status: 409,
      };
    }
  }

  // GPS corroboration — the anti-fraud check.
  const gps = await currentGps(sb, riderId);
  if (!gps.fresh) {
    return {
      ok: false,
      error: "Waiting for your GPS lock before starting a wait",
      status: 409,
    };
  }
  if (gps.speedKmh > START_MAX_SPEED_KMH) {
    return {
      ok: false,
      error: "You are still moving — stop the vehicle to start a wait",
      status: 409,
    };
  }

  const nowIso = new Date().toISOString();
  const sessionId = crypto.randomUUID();

  /* The open clock is claimed through a primary-key insert, so two taps that
     race cannot both win. The loser finds the winner below and reports it as an
     idempotent no-op rather than an error. */
  const claimed = await claimStopoverLock(sb, rideId, sessionId);
  if (!claimed) {
    const current = await readStopover(sb, rideId);
    if (current.open) {
      return { ok: true, stopoverId: current.open.id, startedAt: current.open.startedAt, alreadyOpen: true };
    }
    return { ok: false, error: "Could not start the wait", status: 409 };
  }

  rec.open = {
    id: sessionId,
    startedAt: nowIso,
    reason,
    fromLat: gps.lat,
    fromLng: gps.lng,
  };
  await writeStopover(sb, rec);

  await sb
    .from("ride_requests")
    .update({ updated_at: nowIso })
    .eq("id", rideId)
    .eq("rider_id", riderId);

  return { ok: true, stopoverId: sessionId, startedAt: nowIso, alreadyOpen: false };
}

/* ─── End ───────────────────────────────────────────────────────────────────── */

export type StopoverEndResult =
  | {
      ok: true;
      minutes: number;
      chargeUgx: number;
      totalWaitMin: number;
      totalWaitUgx: number;
      closed: boolean;
    }
  | { ok: false; error: string; status: number };

/**
 * Close the open stopover and bill it.
 *
 * Idempotent: with no open session this returns the settled totals rather than
 * an error, so a retried End after a dropped response never double-charges.
 */
export async function endStopover(
  sb: SupabaseClient,
  rideId: string,
  actorId: string,
  closeReason: "rider" | "auto_movement" | "cap" = "rider",
): Promise<StopoverEndResult> {
  if (!(await stopoverSchemaReady(sb))) {
    return { ok: false, error: "Waiting time is not enabled yet", status: 503 };
  }

  const { data: rideRow } = await sb
    .from("ride_requests")
    .select("id, rider_id, status")
    .eq("id", rideId)
    .maybeSingle();
  const ride = rideRow as Record<string, unknown> | null;
  if (!ride) return { ok: false, error: "Ride not found", status: 404 };
  if (String(ride.rider_id || "") !== actorId) {
    return { ok: false, error: "This is not your ride", status: 403 };
  }

  const rec = await readStopover(sb, rideId);
  const settled = { totalWaitMin: rec.totalMinutes, totalWaitUgx: rec.totalChargeUgx };

  if (!rec.open) {
    await releaseStopoverLock(sb, rideId);
    return { ok: true, minutes: 0, chargeUgx: 0, ...settled, closed: false };
  }

  const rates = await loadFareRates(sb);
  const startedMs = Date.parse(rec.open.startedAt);
  const rawMin = Number.isFinite(startedMs) ? (Date.now() - startedMs) / 60000 : 0;

  const sessionCap = Number(rates.stopover_max_session_min) || 20;
  const minutes = Math.max(0, Math.min(rawMin, sessionCap));
  const hitCap = rawMin > sessionCap;

  const minSession = Number(rates.stopover_min_session_min) || 1;
  const gps = await currentGps(sb, actorId);

  /* Below the floor the rider fat-fingered it. Voiding rather than charging
     avoids a "you owe me 100 UGX for 4 seconds" support ticket. */
  if (minutes < minSession) {
    rec.sessions.push({
      id: rec.open.id,
      startedAt: rec.open.startedAt,
      endedAt: new Date().toISOString(),
      minutes: 0,
      chargeUgx: 0,
      reason: rec.open.reason,
      closeReason: "too_short",
      toLat: gps.lat,
      toLng: gps.lng,
    });
    rec.open = null;
    await writeStopover(sb, rec);
    await releaseStopoverLock(sb, rideId);
    return { ok: true, minutes: 0, chargeUgx: 0, ...settled, closed: true };
  }

  // Charge the INCREMENT only, so grace is applied once across the ride and the
  // customer is told what THIS stop cost rather than the running total.
  const afterMin = Math.round((rec.totalMinutes + minutes) * 100) / 100;
  const afterUgx = waitChargeUgx(afterMin, rates);
  const increment = Math.max(0, afterUgx - rec.totalChargeUgx);

  const endedIso = new Date().toISOString();
  rec.sessions.push({
    id: rec.open.id,
    startedAt: rec.open.startedAt,
    endedAt: endedIso,
    minutes: Math.round(minutes * 100) / 100,
    chargeUgx: increment,
    reason: rec.open.reason,
    closeReason: hitCap ? "cap" : closeReason === "auto_movement" ? "auto_movement" : "rider",
    toLat: gps.lat,
    toLng: gps.lng,
  });
  rec.open = null;
  rec.totalMinutes = afterMin;
  rec.totalChargeUgx = afterUgx;
  await writeStopover(sb, rec);
  await releaseStopoverLock(sb, rideId);

  await sb
    .from("ride_requests")
    .update({ updated_at: endedIso })
    .eq("id", rideId)
    .eq("rider_id", actorId);

  return {
    ok: true,
    minutes: Math.round(minutes * 100) / 100,
    chargeUgx: increment,
    totalWaitMin: afterMin,
    totalWaitUgx: afterUgx,
    closed: true,
  };
}

/**
 * Close the open stopover if the rider has started moving again.
 *
 * Called from the location mutation on every GPS ping. Without this a rider
 * could tap "waiting", start the engine, and keep billing for the rest of the
 * trip — the exact abuse the whole feature is designed to make hard.
 */
export async function autoCloseIfMoving(
  sb: SupabaseClient,
  riderId: string,
  speedKmh: number,
): Promise<{ rideId: string; minutes: number; chargeUgx: number } | null> {
  if (!Number.isFinite(speedKmh) || speedKmh <= START_MAX_SPEED_KMH) return null;
  try {
    const { data } = await sb
      .from("ride_requests")
      .select("id")
      .eq("rider_id", riderId)
      .eq("status", "in_progress")
      .limit(5);
    const rows = (Array.isArray(data) ? data : []) as { id: string }[];
    /* The open-clock pointer lives in the kv record, not on the ride row, so
       this is one candidate query followed by a cheap per-ride read. */
    for (const row of rows) {
      const rec = await readStopover(sb, String(row.id));
      if (!rec.open) continue;
      const res = await endStopover(sb, String(row.id), riderId, "auto_movement");
      if (!res.ok || !res.closed) continue;
      return { rideId: String(row.id), minutes: res.minutes, chargeUgx: res.chargeUgx };
    }
    return null;
  } catch {
    return null;
  }
}

/* ─── Dispute ───────────────────────────────────────────────────────────────── */

/**
 * Record a customer's objection to a wait charge.
 *
 * The charge stays on the ride while it is contested — silently refunding on
 * open would let any customer erase a fee by tapping once — and an admin
 * resolves it from the portal.
 */
export async function disputeStopover(
  sb: SupabaseClient,
  rideId: string,
  customerId: string,
  reason: string,
  note?: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!(await stopoverSchemaReady(sb))) {
    return { ok: false, error: "Waiting time is not enabled yet" };
  }

  const { data: rideRow } = await sb
    .from("ride_requests")
    .select("id, customer_id")
    .eq("id", rideId)
    .maybeSingle();
  const ride = rideRow as Record<string, unknown> | null;
  if (!ride) return { ok: false, error: "Ride not found" };
  if (String(ride.customer_id || "") !== customerId) {
    return { ok: false, error: "This is not your ride" };
  }

  const rec = await readStopover(sb, rideId);
  if (!(rec.totalChargeUgx > 0) && !rec.open) {
    return { ok: false, error: "There is no wait charge to dispute" };
  }

  // One open dispute per ride; re-tapping is a no-op, not a second record.
  if (rec.dispute && !rec.dispute.resolved) return { ok: true };

  rec.dispute = {
    rideId,
    reason: String(reason || "incorrect_wait").slice(0, 64),
    note: note ? String(note).slice(0, 500) : undefined,
    at: new Date().toISOString(),
    resolved: false,
    waived: false,
  };
  await writeStopover(sb, rec);

  /* Mirror onto the ride row when that column exists, so any pre-existing
     reader (admin list, exports) sees the flag without a second source of
     truth. The kv record above remains authoritative. */
  const flagged = await writableUpdate(sb, "ride_requests", { stopover_disputed: true });
  if (Object.keys(flagged).length > 0) {
    await sb.from("ride_requests").update(flagged).eq("id", rideId);
  }
  return { ok: true };
}

/** Outstanding disputes for the admin portal. */
export async function pendingStopoverDisputes(sb: SupabaseClient) {
  return (await listDisputes(sb)).filter((d) => !d.resolved);
}

/**
 * Admin resolution: waive the wait charge (refund it) or uphold it.
 *
 * Waiving zeroes the charge AND the minutes so the fare re-derives without it;
 * leaving the minutes in place would let a later re-quote resurrect the charge
 * that was just refunded.
 */
export async function resolveStopoverDispute(
  sb: SupabaseClient,
  rideId: string,
  adminId: string,
  outcome: "upheld" | "refunded",
  note?: string,
): Promise<{ ok: boolean; error?: string }> {
  const rec = await readStopover(sb, rideId);
  const dispute = rec.dispute;
  if (!dispute) return { ok: false, error: "Dispute not found" };
  if (dispute.resolved) return { ok: false, error: "Already resolved" };

  if (outcome === "refunded") {
    rec.totalMinutes = 0;
    rec.totalChargeUgx = 0;
    for (const s of rec.sessions) s.chargeUgx = 0;
  }
  rec.dispute = {
    ...dispute,
    resolved: true,
    waived: outcome === "refunded",
    resolvedAt: new Date().toISOString(),
    note: note ? String(note).slice(0, 500) : dispute.note,
  };
  await writeStopover(sb, rec);
  await writeDispute(sb, rec.dispute);

  void adminId;
  return { ok: true };
}

/* ─── Finalisation ──────────────────────────────────────────────────────────── */

/**
 * Settle the fare for a ride, once.
 *
 * The base fare is the figure the customer was quoted and shown at booking, so
 * it is carried through untouched rather than re-derived from a road distance we
 * would now have to estimate. The only thing added at settlement is the wait the
 * customer was told about in real time. That makes the final bill exactly
 * "what you agreed to" plus "what you were told about".
 *
 * Idempotent: an already-finalised ride returns its stored figures unchanged, so
 * a retried "complete" tap after a dropped response cannot bill twice.
 */
export async function finaliseRideFare(
  sb: SupabaseClient,
  rideId: string,
): Promise<{ fare: number; waitUgx: number; total: number; waitMin: number } | null> {
  try {
    const { data } = await sb.from("ride_requests").select("*").eq("id", rideId).maybeSingle();
    const r = data as Record<string, unknown> | null;
    if (!r) return null;

    const rec = await readStopover(sb, rideId);

    if (r.finalised === true) {
      return {
        fare: Number(r.fare_ugx) || 0,
        waitUgx: Number(r.wait_ugx) || 0,
        total: Number(r.total_ugx) || 0,
        waitMin: Number(r.wait_min) || 0,
      };
    }
    if (rec.finalisedAt) {
      return {
        fare: Number(r.fare_ugx) || 0,
        waitUgx: rec.totalChargeUgx,
        total: Number(r.fare_ugx || 0) + Number(r.service_fee_ugx || 0) + rec.totalChargeUgx,
        waitMin: rec.totalMinutes,
      };
    }

    const fare = Number(r.fare_ugx) || 0;
    const serviceFee = Number(r.service_fee_ugx) || 0;

    /* A still-running clock is closed first so a rider cannot finish the trip
       with an open, unbilled wait. */
    let waitUgx = rec.totalChargeUgx;
    if (rec.open) {
      const closed = await endStopover(sb, rideId, String(r.rider_id || ""), "rider");
      if (closed.ok) waitUgx = closed.totalWaitUgx;
    }
    const finalRec = await readStopover(sb, rideId);

    const total = fare + serviceFee + waitUgx;
    finalRec.finalisedAt = new Date().toISOString();
    await writeStopover(sb, finalRec);

    const finalPatch = await writableUpdate(sb, "ride_requests", {
      wait_ugx: waitUgx,
      wait_min: finalRec.totalMinutes,
      finalised: true,
      completed_at: new Date().toISOString(),
      total_ugx: total,
      updated_at: new Date().toISOString(),
    });
    await sb.from("ride_requests").update(finalPatch).eq("id", rideId);

    return { fare, waitUgx, waitMin: finalRec.totalMinutes, total };
  } catch {
    return null;
  }
}

/* ─── Internals ─────────────────────────────────────────────────────────────── */

/**
 * The rider's last known position and speed.
 *
 * A fix older than `GPS_FRESH_MAX_MS` is reported as not fresh, which makes the
 * start fail closed rather than let an unverifiable claim through.
 */
async function currentGps(
  sb: SupabaseClient,
  riderId: string,
): Promise<{ lat: number | null; lng: number | null; speedKmh: number; fresh: boolean }> {
  const out = { lat: null as number | null, lng: null as number | null, speedKmh: 0, fresh: false };
  try {
    const { data } = await sb
      .from("rider_locations")
      .select("lat, lng, speed, updated_at")
      .eq("rider_id", riderId)
      .maybeSingle();
    const row = data as Record<string, unknown> | null;
    if (!row) return out;

    const ts = Date.parse(String(row.updated_at ?? ""));
    out.fresh = Number.isFinite(ts) && Date.now() - ts <= GPS_FRESH_MAX_MS;
    out.lat = row.lat == null ? null : Number(row.lat);
    out.lng = row.lng == null ? null : Number(row.lng);

    /* `rider_locations.speed` is written straight from `position.coords.speed`,
       which the Geolocation API defines in METRES PER SECOND. An earlier
       version sniffed the unit ("looks small, so it must be km/h"), which
       mis-read a genuine 4 m/s crawl as 14 km/h and refused a legitimate wait
       while letting a real 4 km/h idle through. One unit, converted once. */
    out.speedKmh = (Number(row.speed) || 0) * 3.6;
    return out;
  } catch {
    return out;
  }
}
