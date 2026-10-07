/**
 * Stopover (waiting-time) rules — pure, shared by server and client.
 *
 * Nothing here touches the database, the clock or the network, which is what
 * lets the customer's live counter tick on a phone using exactly the same maths
 * the server will charge with. A counter that merely approximated the server's
 * figure would be worse than no counter at all: it would disagree with the bill.
 *
 * The server remains authoritative for START, END and every write. This module
 * only computes what a given ride row is currently worth.
 */

import type { FareRates } from "@/lib/fare-engine";

/* ─── Reasons ───────────────────────────────────────────────────────────────── */

/** Why a rider is waiting. Drives the customer's alert copy. */
export const STOPOVER_REASONS = [
  "customer_not_ready",
  "customer_running_late",
  "customer_requested",
  "customer_unreachable",
  "traffic_roadblock",
  "vehicle_issue",
  "other",
] as const;
export type StopoverReason = (typeof STOPOVER_REASONS)[number];

export function isStopoverReason(v: unknown): v is StopoverReason {
  return typeof v === "string" && (STOPOVER_REASONS as readonly string[]).includes(v);
}

/** Customer-facing wording. Deliberately plain — it appears on a push. */
export const STOPOVER_REASON_LABEL: Record<StopoverReason, string> = {
  customer_not_ready: "Passenger not ready",
  customer_running_late: "Passenger running late",
  customer_requested: "Passenger asked to wait",
  customer_unreachable: "Passenger unreachable",
  traffic_roadblock: "Blocked on the road",
  vehicle_issue: "Vehicle issue",
  other: "Waiting on passenger",
};

/** One line explaining the charge before it is billed. */
export const STOPOVER_REASON_HINT: Record<StopoverReason, string> = {
  customer_not_ready: "Your rider is waiting at the pickup point.",
  customer_running_late: "Your rider arrived early and is waiting.",
  customer_requested: "Your rider is holding for you at the stop.",
  customer_unreachable: "Your rider cannot reach you and is holding the vehicle.",
  traffic_roadblock: "Your rider is held up on the road.",
  vehicle_issue: "Your rider has a vehicle issue and is holding.",
  other: "Your rider is holding for you.",
};

/* ─── Charge maths ──────────────────────────────────────────────────────────── */

/**
 * Total wait charge for an accumulated number of minutes.
 *
 * The free grace applies ONCE PER RIDE, not per stopover. Charging grace per
 * event would mean five short stops cost five graces, which reads as a trick and
 * is how wait-time pricing loses regulatory goodwill.
 */
export function waitChargeUgx(totalMin: number, rates: FareRates): number {
  const billable = Math.max(0, (Number(totalMin) || 0) - (Number(rates.wait_grace_min) || 0));
  return Math.round(billable * (Number(rates.wait_per_min_ugx) || 0));
}

/* ─── Live view ─────────────────────────────────────────────────────────────── */

export type StopoverLiveView = {
  /** A stopover session is running right now. */
  open: boolean;
  reason: StopoverReason | null;
  reason_label: string | null;
  reason_hint: string | null;
  started_at: string | null;
  /** Minutes elapsed so far, including the part inside the free grace. */
  elapsed_min: number;
  /** Minutes still free before money starts accruing. */
  grace_left_min: number;
  billable_min: number;
  /** What the rider is owed for the wait so far, to the nearest shilling. */
  accrued_ugx: number;
  total_wait_min: number;
  total_wait_ugx: number;
  rate_per_min_ugx: number;
  grace_min: number;
  /**
   * The server's clock when this view was built. A client keeps ticking locally
   * but re-anchors on every poll against this, so a phone whose clock is hours
   * wrong still shows the same figure the server will charge.
   */
  server_now: number;
  disputed: boolean;
  waived: boolean;
};

/**
 * Compute what a ride's wait is currently worth.
 *
 * Works from a `ride_requests` row plus the resolved rates. `nowMs` is injected
 * rather than read from `Date.now()` so a client can pass a server-anchored
 * time and so the maths stays testable.
 */
export function stopoverLiveView(
  ride: Record<string, unknown>,
  rates: FareRates,
  nowMs: number = Date.now(),
): StopoverLiveView {
  const rate = Number(rates.wait_per_min_ugx) || 0;
  const grace = Number(rates.wait_grace_min) || 0;
  const settledMin = Number(ride.stopover_minutes) || 0;

  const openId = (ride.stopover_open_id as string | null) ?? null;
  const openAt = (ride.stopover_open_at as string | null) ?? null;
  const openMs = openAt ? Date.parse(openAt) : NaN;
  const running = openId && Number.isFinite(openMs) ? Math.max(0, (nowMs - openMs) / 60000) : 0;

  const totalMin = settledMin + running;
  const accrued = waitChargeUgx(totalMin, rates);
  const settledCharge = Number(ride.stopover_ugx) || 0;
  const reason = isStopoverReason(ride.stopover_reason) ? ride.stopover_reason : null;

  return {
    open: !!openId,
    reason,
    reason_label: reason ? STOPOVER_REASON_LABEL[reason] : null,
    reason_hint: reason ? STOPOVER_REASON_HINT[reason] : null,
    started_at: openAt,
    elapsed_min: Math.round(totalMin * 10) / 10,
    grace_left_min: Math.round(Math.max(0, grace - totalMin) * 10) / 10,
    billable_min: Math.round(Math.max(0, totalMin - grace) * 10) / 10,
    /* Only the unsettled part counts as "accruing"; the settled part is already
       agreed and shown as the total, so the two never double up in the UI. */
    accrued_ugx: Math.max(0, accrued - settledCharge),
    total_wait_min: Math.round(totalMin * 10) / 10,
    total_wait_ugx: accrued,
    rate_per_min_ugx: rate,
    grace_min: grace,
    server_now: nowMs,
    disputed: ride.stopover_disputed === true,
    waived: ride.stopover_waived === true,
  };
}

/* ─── Ticking between polls ─────────────────────────────────────────────────── */

/**
 * Advance a snapshot to a later server-anchored moment.
 *
 * Polling once a minute would make the counter jump in steps, so the client
 * re-computes every second from the last authoritative snapshot using its own
 * rate and grace. Re-anchoring on each poll means a slow or failed request can
 * only ever delay the next correction — it cannot make the counter run away.
 */
export function tickStopover(base: StopoverLiveView, nowMs: number): StopoverLiveView {
  if (!base.open || !base.started_at) return base;

  const startedMs = Date.parse(base.started_at);
  if (!Number.isFinite(startedMs)) return base;

  const totalMin = Math.max(0, (nowMs - startedMs) / 60000);
  const accrued = waitChargeUgx(totalMin, {
    wait_grace_min: base.grace_min,
    wait_per_min_ugx: base.rate_per_min_ugx,
  } as FareRates);
  const settled = Math.max(0, base.total_wait_ugx - base.accrued_ugx);

  return {
    ...base,
    elapsed_min: Math.round(totalMin * 10) / 10,
    grace_left_min: Math.round(Math.max(0, base.grace_min - totalMin) * 10) / 10,
    billable_min: Math.round(Math.max(0, totalMin - base.grace_min) * 10) / 10,
    accrued_ugx: Math.max(0, accrued - settled),
    total_wait_min: Math.round(totalMin * 10) / 10,
    total_wait_ugx: accrued,
    server_now: nowMs,
  };
}

/* ─── Formatting ────────────────────────────────────────────────────────────── */

/** "1 min 20 s" / "45 s" — used on the ticking counter. */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(s / 60);
  if (m < 1) return `${s}s`;
  if (m < 60) return `${m} min ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}
