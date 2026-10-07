/**
 * Server-side ride pricing.
 *
 * Both the customer-facing quote (POST /api/rides/quote) and the booking charge
 * (POST /api/rides) call `priceRide` from here. That is the entire point: when
 * the customer quoted UGX 16,100 and was charged UGX 14,700, nothing was broken
 * in isolation — two different formulas were pricing the same trip. Sharing one
 * function makes that class of bug impossible rather than merely unlikely.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { serviceFeeFor } from "@/lib/fees";
import { quoteFare, type FareKind, type FareQuote } from "@/lib/fare-engine";
import { loadFareRates } from "@/lib/fare-config-server";
import { roadMetrics } from "@/lib/server-road-metrics";

export type PricedRide = {
  quote: FareQuote;
  serviceFee: number;
  total: number;
  distanceKm: number;
  durationMin: number;
  roadSource: string;
};

function validCoord(v: unknown, min: number, max: number): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
}

/** Uganda's box, so a malformed coordinate can't price a Kampala→Jinja trip. */
export const MAX_RIDE_KM = 60;
export const MIN_RIDE_KM = 0.05;

export function parseTrip(body: Record<string, unknown>) {
  const pickupLat = validCoord(body.pickup_lat, -1.5, 4.5);
  const pickupLng = validCoord(body.pickup_lng, 28, 36);
  const dropoffLat = validCoord(body.dropoff_lat, -1.5, 4.5);
  const dropoffLng = validCoord(body.dropoff_lng, 28, 36);
  const ok = pickupLat !== null && pickupLng !== null && dropoffLat !== null && dropoffLng !== null;
  return { ok, pickupLat, pickupLng, dropoffLat, dropoffLng };
}

export function fareKindOf(v: unknown): FareKind {
  return v === "car" ? "car" : "boda";
}

/** fee_config row — the service-fee percentage, which is separate from fares. */
async function feeConfigRow(sb: SupabaseClient) {
  try {
    const { data } = await sb.from("fee_config").select("*").eq("id", "default").maybeSingle();
    return (data as Record<string, unknown> | null) ?? null;
  } catch {
    return null;
  }
}

/* ─── Schema capability probe ──────────────────────────────────────────────── */

/** Columns the itemised-fare breakdown needs on `ride_requests`. */
export const FARE_COLUMNS = [
  "duration_min", "fare_tier", "vehicle_kind", "base_ugx",
  "distance_ugx", "time_ugx", "wait_ugx", "wait_min",
  "quote_snapshot", "finalised",
] as const;

/**
 * Does `ride_requests` actually have the itemised-fare columns?
 *
 * WHY THIS EXISTS
 * ---------------
 * PostgREST rejects an ENTIRE insert when any named column is missing — not just
 * that field. So if the fare engine ships before FARE_SCHEMA.sql is applied,
 * every new booking would fail with a 400 and ride-hailing would go down
 * entirely. That is a far worse outcome than storing a slightly less detailed
 * receipt, which is why the write degrades instead of failing.
 *
 * The probe is cached per process: one indexed round trip on the first booking
 * after a cold start, then free. It is also re-probed on a timer, so a database
 * that gains the schema mid-day starts using it automatically without a
 * redeploy — which is exactly what happens when an operator applies
 * FARE_SCHEMA.sql out of band.
 */
let FARE_COLUMNS_OK: { at: number; ok: boolean } | null = null;
const PROBE_TTL_MS = 60_000;

export async function fareColumnsReady(sb: SupabaseClient): Promise<boolean> {
  if (FARE_COLUMNS_OK && Date.now() - FARE_COLUMNS_OK.at < PROBE_TTL_MS) {
    return FARE_COLUMNS_OK.ok;
  }
  let ok = false;
  try {
    /* `.limit(1)` not `.single()`: we only care whether PostgREST can resolve
       the columns, not whether a row comes back. */
    const { error } = await sb
      .from("ride_requests")
      .select(FARE_COLUMNS.join(","))
      .limit(1);
    ok = !error;
  } catch {
    ok = false;
  }
  FARE_COLUMNS_OK = { at: Date.now(), ok };
  return ok;
}

/** Test seam: forget the cached probe. */
export function resetFareColumnProbe(): void {
  FARE_COLUMNS_OK = null;
}

export async function priceRide(
  sb: SupabaseClient,
  args: {
    pickupLat: number;
    pickupLng: number;
    dropoffLat: number;
    dropoffLng: number;
    kind?: FareKind;
    waitMin?: number;
    at?: Date;
  },
): Promise<PricedRide> {
  const [feeRow, rates] = await Promise.all([feeConfigRow(sb), loadFareRates(sb)]);
  const road = await roadMetrics(
    { lat: args.pickupLat, lng: args.pickupLng },
    { lat: args.dropoffLat, lng: args.dropoffLng },
  );
  const quote = quoteFare({
    kind: args.kind ?? "boda",
    distanceKm: road.distanceKm,
    durationMin: road.durationMin,
    waitMin: args.waitMin ?? 0,
    at: args.at,
    rates,
  });
  const serviceFee = serviceFeeFor(quote.fare_ugx, feeRow);
  return {
    quote,
    serviceFee,
    total: quote.fare_ugx + serviceFee,
    distanceKm: quote.distance_km,
    durationMin: quote.duration_min,
    roadSource: road.source,
  };
}