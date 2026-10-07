/**
 * GoDoor fare engine — the single source of truth for every fare the platform
 * quotes, charges, displays or pays out.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Fares used to be computed in three unrelated places with three different
 * formulas, which is why a customer and a rider could be looking at two
 * different numbers for the same trip:
 *
 *   • POST /api/rides      base 2,000 + 1,200/km, straight-line haversine,
 *                          then serviceFeeFor() at the *live* fee_config rate.
 *   • /ride (customer UI)  base 2,000 + 1,200/km, then a HARDCODED 5% fee.
 *   • /api/orders          calcDeliveryFee() at 200/km + 100/min with
 *                          time-of-day minimums.
 *
 * On a 10 km ride the customer was shown 14,700 and the server charged 16,100 —
 * a 1,400 UGX gap that only surfaced at payment. Nothing was "wrong" in either
 * place; they were simply two different formulas.
 *
 * THE RULE
 * --------
 * Money is never computed on the client. The client renders a quote returned by
 * this module running on the SERVER, and the charge is recomputed from the same
 * module and the same stored inputs. A quote endpoint and a charge endpoint
 * calling `quoteFare` with identical arguments must return identical numbers —
 * that is the property that makes customer, rider and ledger agree.
 *
 * All amounts are integer UGX. Money math is rounded exactly once, at the end,
 * to `round_to_ugx`. Never round per component.
 */

import type { FeeConfigShape } from "@/lib/fees";

/* ─── Time-of-day tiers ──────────────────────────────────────────────────── */

/** Uganda runs on East Africa Time = UTC+3, year-round, no DST. */
export const UGANDA_UTC_OFFSET_HOURS = 3;

export type FareTier = "day" | "evening" | "late";

/**
 * Local (EAT) hour-of-day as a float, so a 19:30 boundary is expressible.
 *
 * Minutes matter here. An earlier version returned `getUTCHours()` alone, which
 * truncates to whole hours — so 19:30 EAT evaluated to 19.0, compared false
 * against `evening_start_hour = 19.5`, and every ride booked between 19:30 and
 * 19:59 stayed on the daytime rate. The evening rise silently started at 20:00
 * instead of the 19:30 the operator asked for.
 */
export function ugandaHour(at: Date = new Date()): number {
  const h = at.getUTCHours() + at.getUTCMinutes() / 60 + at.getUTCSeconds() / 3600;
  return ((h + UGANDA_UTC_OFFSET_HOURS) % 24 + 24) % 24;
}

export type FareRates = {
  /* Boda / GoRide */
  boda_base_ugx: number;
  boda_per_km_ugx: number;
  boda_per_min_ugx: number;
  boda_min_ugx: number;
  /* GoCar / larger vehicles scale the boda base; kept explicit so admin can tune */
  car_base_ugx: number;
  car_per_km_ugx: number;
  car_min_ugx: number;
  /* Delivery */
  delivery_base_ugx: number;
  delivery_per_km_ugx: number;
  delivery_per_min_ugx: number;
  delivery_min_day_ugx: number;
  delivery_min_evening_ugx: number;
  delivery_min_late_ugx: number;
  /* When the evening tier begins. 19.5 = 19:30 EAT, per the operator brief. */
  evening_start_hour: number;
  late_start_hour: number;
  /* Time-of-day uplift applied to the distance component, matching how Ugandan
     operators price a peak: the base and the per-minute stay flat, the distance
     carries the rise, so the surcharge scales with how far you actually go
     rather than penalising every ride equally.

     1.0 means "no uplift" and is the shipped default — turning this on changes
     live prices, so it is an operator decision made in the admin portal, not a
     side effect of deploying the engine. */
  evening_multiplier: number;
  late_multiplier: number;
  /* Stopover / waiting */
  wait_grace_min: number;
  wait_per_min_ugx: number;
  /* Bounds on a rider-declared stopover. These are anti-abuse caps, not
     pricing: without them a single event could bill a customer indefinitely. */
  stopover_max_session_min: number;
  stopover_max_ride_min: number;
  stopover_min_session_min: number;
  stopover_cooldown_min: number;
  /* Rounding denomination for the final fare. */
  round_to_ugx: number;
};

/**
 * Defaults chosen to preserve existing behaviour for Boda (2,000 + 1,200/km,
 * 2,500 floor) and delivery (200/km + 100/min, tiered minimums), so adopting the
 * engine does not silently re-price a single live trip. Everything here is
 * admin-editable — see `resolveFareRates` for the override path.
 */
export const FALLBACK_FARE_RATES: FareRates = {
  boda_base_ugx: 2000,
  boda_per_km_ugx: 1200,
  boda_per_min_ugx: 0,
  boda_min_ugx: 2500,
  car_base_ugx: 3500,
  car_per_km_ugx: 1800,
  car_min_ugx: 4000,
  delivery_base_ugx: 0,
  delivery_per_km_ugx: 200,
  delivery_per_min_ugx: 100,
  delivery_min_day_ugx: 1500,
  delivery_min_evening_ugx: 2000,
  delivery_min_late_ugx: 3000,
  evening_start_hour: 19.5,
  late_start_hour: 22,
  evening_multiplier: 1,
  late_multiplier: 1,
  wait_grace_min: 3,
  wait_per_min_ugx: 100,
  stopover_max_session_min: 20,
  stopover_max_ride_min: 60,
  stopover_min_session_min: 1,
  stopover_cooldown_min: 5,
  round_to_ugx: 100,
};

export const FARE_RATE_FIELDS = Object.keys(FALLBACK_FARE_RATES) as Array<keyof FareRates>;

/** Row shape: `fee_config` columns are nullable, so every field is optional. */
export type FareRateRow = Partial<Record<keyof FareRates, number | null>>;

const num = (v: unknown, fallback: number): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

/**
 * Fully-populated rates. A field absent from the row falls back to the default
 * rather than to 0 — a missing config must never make a ride free.
 */
export function resolveFareRates(row?: FareRateRow | null): FareRates {
  const f = FALLBACK_FARE_RATES;
  const r = (k: keyof FareRates) => num(row?.[k], f[k]);
  return {
    boda_base_ugx: Math.max(0, Math.trunc(r("boda_base_ugx"))),
    boda_per_km_ugx: Math.max(0, Math.trunc(r("boda_per_km_ugx"))),
    boda_per_min_ugx: Math.max(0, Math.trunc(r("boda_per_min_ugx"))),
    boda_min_ugx: Math.max(0, Math.trunc(r("boda_min_ugx"))),
    car_base_ugx: Math.max(0, Math.trunc(r("car_base_ugx"))),
    car_per_km_ugx: Math.max(0, Math.trunc(r("car_per_km_ugx"))),
    car_min_ugx: Math.max(0, Math.trunc(r("car_min_ugx"))),
    delivery_base_ugx: Math.max(0, Math.trunc(r("delivery_base_ugx"))),
    delivery_per_km_ugx: Math.max(0, Math.trunc(r("delivery_per_km_ugx"))),
    delivery_per_min_ugx: Math.max(0, Math.trunc(r("delivery_per_min_ugx"))),
    delivery_min_day_ugx: Math.max(0, Math.trunc(r("delivery_min_day_ugx"))),
    delivery_min_evening_ugx: Math.max(0, Math.trunc(r("delivery_min_evening_ugx"))),
    delivery_min_late_ugx: Math.max(0, Math.trunc(r("delivery_min_late_ugx"))),
    evening_start_hour: Math.min(23.99, Math.max(0, r("evening_start_hour"))),
    late_start_hour: Math.min(23.99, Math.max(0, r("late_start_hour"))),
    /* Clamped to a sane 1.0–3.0 band: below 1.0 would quietly discount rides,
       above 3.0 a mis-typed value could price a Kampala trip like a flight. */
    evening_multiplier: Math.min(3, Math.max(1, r("evening_multiplier"))),
    late_multiplier: Math.min(3, Math.max(1, r("late_multiplier"))),
    wait_grace_min: Math.max(0, r("wait_grace_min")),
    wait_per_min_ugx: Math.max(0, Math.trunc(r("wait_per_min_ugx"))),
    stopover_max_session_min: Math.max(1, Math.min(240, r("stopover_max_session_min"))),
    stopover_max_ride_min: Math.max(1, Math.min(600, r("stopover_max_ride_min"))),
    stopover_min_session_min: Math.max(0, Math.min(30, r("stopover_min_session_min"))),
    stopover_cooldown_min: Math.max(0, Math.min(120, r("stopover_cooldown_min"))),
    round_to_ugx: Math.max(1, Math.trunc(r("round_to_ugx"))),
  };
}

/**
 * Which tier a moment falls in.
 *
 * Boundaries are floats on purpose: the brief sets the evening rise at 19:30
 * EAT, not 19:00, and `ugandaHour()` returns a float so 19:30 is representable
 * without rounding error at the boundary.
 */
export function fareTierFor(at: Date = new Date(), rates: FareRates = FALLBACK_FARE_RATES): FareTier {
  const h = ugandaHour(at);
  const evening = rates.evening_start_hour;
  const late = Math.max(evening, rates.late_start_hour);
  if (h >= late) return "late";
  if (h >= evening) return "evening";
  return "day";
}

export function tierLabel(tier: FareTier): string {
  return tier === "late" ? "Late night" : tier === "evening" ? "Evening" : "Daytime";
}

/* ─── Distance + duration ─────────────────────────────────────────────────── */

const EARTH_RADIUS_KM = 6371;

/** Great-circle distance. Used only as a fallback when no road route exists. */
export function haversineKm(
  aLat: number, aLng: number, bLat: number, bLng: number,
): number {
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(s));
}

/**
 * Fallback trip duration when the provider gives us nothing.
 * 25 km/h is the urban Ugandan motorbike average the codebase already assumed.
 */
export const DEFAULT_SPEED_KMH = 25;

export function estimateDurationMin(distanceKm: number, speedKmh = DEFAULT_SPEED_KMH): number {
  const km = Number.isFinite(distanceKm) && distanceKm > 0 ? distanceKm : 0;
  return (km / speedKmh) * 60;
}

/* ─── The quote ───────────────────────────────────────────────────────────── */

export type FareKind = "boda" | "car" | "delivery";

export type FareInput = {
  kind: FareKind;
  /** Road distance in km. Straight-line is computed if absent. */
  distanceKm?: number | null;
  /** Provider duration in minutes. Estimated from distance if absent. */
  durationMin?: number | null;
  /** Minutes the vehicle has been stationary with the customer aboard/on site. */
  waitMin?: number | null;
  bulkyItems?: number;
  bulkySurchargeUgx?: number;
  at?: Date;
  rates?: FareRates;
};

export type FareQuote = {
  kind: FareKind;
  tier: FareTier;
  tier_label: string;
  distance_km: number;
  duration_min: number;
  wait_min: number;
  /** Minutes of stopover actually charged (wait minus the free grace). */
  billable_wait_min: number;
  base_ugx: number;
  distance_ugx: number;
  time_ugx: number;
  /** Peak multiplier applied to distance (1 = none). Shown on the receipt. */
  tier_multiplier: number;
  wait_ugx: number;
  bulky_ugx: number;
  /** base + distance + time, floored to the tier minimum. */
  subtotal_ugx: number;
  /** The fare charged, excluding the service fee (which fees.ts owns). */
  fare_ugx: number;
  /** True when the tier minimum, not the distance+time math, set the price. */
  at_minimum: boolean;
  wait_grace_min: number;
  wait_per_min_ugx: number;
};

/** Round to the configured denomination. Half-up, applied exactly once. */
function roundTo(value: number, step: number): number {
  if (step <= 1) return Math.round(value);
  return Math.round(value / step) * step;
}

/**
 * Compute a fare. Pure and deterministic: same input + same rates = same output,
 * on the client and on the server, with no clock or randomness of its own.
 *
 * `at` is injected rather than read from `new Date()` so a quote can be
 * recomputed for a specific moment (e.g. a scheduled delivery later tonight)
 * and so tests are not time-dependent.
 */
export function quoteFare(input: FareInput): FareQuote {
  const rates = input.rates ?? FALLBACK_FARE_RATES;
  const at = input.at ?? new Date();
  const tier = fareTierFor(at, rates);

  const km = Number.isFinite(input.distanceKm as number) && (input.distanceKm as number) > 0
    ? (input.distanceKm as number)
    : 0;

  const durationMin = Number.isFinite(input.durationMin as number) && (input.durationMin as number) > 0
    ? (input.durationMin as number)
    : estimateDurationMin(km);

  const waitMin = Number.isFinite(input.waitMin as number) && (input.waitMin as number) > 0
    ? (input.waitMin as number)
    : 0;

  const bulky = Math.max(0, Math.trunc(input.bulkyItems ?? 0));

  let base: number, perKm: number, perMin: number, minFare: number;
  if (input.kind === "delivery") {
    base = rates.delivery_base_ugx;
    perKm = rates.delivery_per_km_ugx;
    perMin = rates.delivery_per_min_ugx;
    minFare =
      tier === "late" ? rates.delivery_min_late_ugx
      : tier === "evening" ? rates.delivery_min_evening_ugx
      : rates.delivery_min_day_ugx;
  } else if (input.kind === "car") {
    base = rates.car_base_ugx;
    perKm = rates.car_per_km_ugx;
    perMin = rates.boda_per_min_ugx;
    minFare = rates.car_min_ugx;
  } else {
    base = rates.boda_base_ugx;
    perKm = rates.boda_per_km_ugx;
    perMin = rates.boda_per_min_ugx;
    minFare = rates.boda_min_ugx;
  }

  /* The peak uplift rides on the distance component only. Putting it on the base
     would charge a 500 m ride the same premium as a 20 km one; putting it on the
     time component would penalise traffic, which the rider cannot control. */
  const uplift =
    tier === "late" ? rates.late_multiplier
    : tier === "evening" ? rates.evening_multiplier
    : 1;

  const distanceUgx = perKm * km * uplift;
  const timeUgx = perMin * durationMin;

  /* Stopover is charged on top of the minimum, never instead of it — the rider
     still gets paid the base for having driven to the pickup. */
  const billableWait = Math.max(0, waitMin - rates.wait_grace_min);
  const waitUgx = billableWait * rates.wait_per_min_ugx;

  const rawSubtotal = base + distanceUgx + timeUgx;
  const subtotal = Math.max(minFare, rawSubtotal);
  const atMinimum = subtotal > rawSubtotal;

  const bulkyUgx = bulky > 0 ? bulky * Math.max(0, Math.trunc(input.bulkySurchargeUgx ?? 0)) : 0;

  const fare = roundTo(subtotal + waitUgx + bulkyUgx, rates.round_to_ugx);

  return {
    kind: input.kind,
    tier,
    tier_label: tierLabel(tier),
    distance_km: Math.round(km * 100) / 100,
    duration_min: Math.round(durationMin * 10) / 10,
    wait_min: Math.round(waitMin),
    billable_wait_min: Math.round(billableWait * 10) / 10,
    base_ugx: base,
    distance_ugx: Math.round(distanceUgx),
    time_ugx: Math.round(timeUgx),
    tier_multiplier: uplift,
    wait_ugx: Math.round(waitUgx),
    bulky_ugx: bulkyUgx,
    subtotal_ugx: Math.round(subtotal),
    fare_ugx: fare,
    at_minimum: atMinimum,
    wait_grace_min: rates.wait_grace_min,
    wait_per_min_ugx: rates.wait_per_min_ugx,
  };
}

/* ─── Stopover estimation ─────────────────────────────────────────────────── */

/**
 * Stopover minutes between two GPS observations.
 *
 * A rider in traffic is stationary too, so raw displacement alone would bill a
 * customer for a jam at the lights. `speedThresholdKmh` is the cut-off below
 * which the vehicle counts as deliberately stopped; anything above is treated as
 * movement and contributes nothing to the wait clock.
 */
export function stopoverMinutes(
  a: { lat: number; lng: number; at: number },
  b: { lat: number; lng: number; at: number },
  speedThresholdKmh = 3,
): number {
  const elapsedMin = (b.at - a.at) / 60000;
  if (!Number.isFinite(elapsedMin) || elapsedMin <= 0) return 0;
  /* A gap longer than 15 minutes is a lost connection, not a customer holding
     the vehicle — never bill it. */
  if (elapsedMin > 15) return 0;
  const km = haversineKm(a.lat, a.lng, b.lat, b.lng);
  if (km / (elapsedMin / 60) > speedThresholdKmh) return 0;
  return elapsedMin;
}

/** Formats a wait estimate for the customer-facing warning. */
export function describeWaitCost(waitMin: number, rates: FareRates = FALLBACK_FARE_RATES): string {
  const billable = Math.max(0, waitMin - rates.wait_grace_min);
  if (billable <= 0) return "No charge yet";
  return `UGX ${Math.round(billable * rates.wait_per_min_ugx).toLocaleString("en-US")}`;
}

/* ─── Config plumbing ─────────────────────────────────────────────────────── */

/** fee_config row → rates. Used by every server-side pricing path. */
export function ratesFromFeeConfig(row?: FeeConfigShape & FareRateRow | null): FareRates {
  return resolveFareRates(row ?? null);
}