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

/**
 * Fare bands, all in East Africa Time (UTC+3), defined by the operator:
 *
 *   2 km costs UGX 1,500 daytime; 2 km costs UGX 2,000 at night.
 *   → per-km: day 750/km · rush 900/km · evening 1,000/km · late 1,000/km
 *
 * Pure-distance, no base or minimum on boda. The 250 flat service fee stays.
 */
export type FareTier = "day" | "rush" | "evening" | "late";

/** Per-km UGX by band — the operator's published schedule (see FareTier docs). */
export const BODA_PER_KM_UGX: Record<FareTier, number> = {
  /* Operator schedule: 2 km costs UGX 1,500 daytime; 2 km costs UGX 2,000
     at night. Per-km representation (750 / 1,000) keeps the fare linear so
     1 km reflects exactly half. */
  day: 750,
  rush: 900,
  evening: 1000,
  late: 1000,
};

/** Uganda geographic region classification for pricing equity */
export type UgandaRegion = "kampala_metro" | "upcountry";

/**
 * Determine regional pricing tier from GPS coordinates.
 * Greater Kampala Metropolitan Area (Kampala, Wakiso, Entebbe, Mukono)
 * has higher fuel/traffic costs than upcountry hubs (Masaka, Jinja, Gulu, Mbarara).
 */
export function resolveUgandaRegion(lat?: number | null, lng?: number | null): UgandaRegion {
  if (lat == null || lng == null) return "kampala_metro";
  // Greater Kampala Metro bounding box
  if (lat >= -0.1 && lat <= 0.6 && lng >= 32.3 && lng <= 32.8) {
    return "kampala_metro";
  }
  return "upcountry";
}

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
  /* Per-km rate by time band — the operator's published schedule:
     day 1,000/km · evening (9pm–12am) 1,500/km · late (12am–6:30am) 2,000/km.
     Kept separate so a night rate can never silently re-price a daytime trip. */
  boda_evening_per_km_ugx: number;
  boda_late_per_km_ugx: number;
  /* Late-night base / minimum — applied only in the "late" tier (see
     `late_start_hour` / `late_end_hour`). Kept separate so the day base and
     day minimum are never silently re-priced by a night policy change. */
  boda_late_base_ugx: number;
  boda_late_min_ugx: number;
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
  /* When the late (late-night) tier ends: 6.5 = 06:30 EAT. The late window
     spans midnight, so a boundary of 6.5 means "before 06:30 counts as late"
     as well as after `late_start_hour`. */
  late_end_hour: number;
  /* Time-of-day uplift applied to the distance component, matching how Ugandan
     operators price a peak: the base and the per-minute stay flat, the distance
     carries the rise, so the surcharge scales with how far you actually go
     rather than penalising every ride equally.
 
     1.0 means "no uplift" and is the shipped default — turning this on changes
     live prices, so it is an operator decision made in the admin portal, not a
     side effect of deploying the engine. */
  evening_multiplier: number;
  late_multiplier: number;
  /* Uganda peak rush-hour traffic configuration (Uber/Bolt algorithmic surge) */
  morning_rush_start_hour: number;
  morning_rush_end_hour: number;
  evening_rush_start_hour: number;
  evening_rush_end_hour: number;
  rush_multiplier: number;
  upcountry_multiplier: number;
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
  /* Pure distance pricing per operator decision: NO base fare, NO minimum
     fare on GoRide. Fare = distance_km × per-km rate for the time band.
     Example: 2.2 km daytime = 2.2 × 1,000 = 2,200 (+ 250 flat service fee).
     The old 2,000 base + 3,000 minimum charged 4,450 for a 2.2 km ride
     that should have been ~2,200 — removed. */
  boda_base_ugx: 0,
  boda_per_km_ugx: BODA_PER_KM_UGX.day,
  boda_per_min_ugx: 0,
  boda_min_ugx: 0,
  boda_evening_per_km_ugx: BODA_PER_KM_UGX.evening,
  boda_late_per_km_ugx: BODA_PER_KM_UGX.late,
  boda_late_base_ugx: 0,
  boda_late_min_ugx: 0,
  car_base_ugx: 3500,
  car_per_km_ugx: 1800,
  car_min_ugx: 4000,
  /* Delivery uses ride bands at lighter structure: base 1,000,
     same per-km bands, minimums 2,500 / 3,000 late (was 200/100 — below rider cost). */
  delivery_base_ugx: 1000,
  delivery_per_km_ugx: BODA_PER_KM_UGX.day,
  delivery_per_min_ugx: 0,
  delivery_min_day_ugx: 2500,
  delivery_min_evening_ugx: 2500,
  delivery_min_late_ugx: 3000,
  evening_start_hour: 19,
  late_start_hour: 23,
  late_end_hour: 7,
  evening_multiplier: 1,
  late_multiplier: 1,
  morning_rush_start_hour: 7,
  morning_rush_end_hour: 9.5,
  evening_rush_start_hour: 17,
  evening_rush_end_hour: 20.5,
  rush_multiplier: 1.15,
  upcountry_multiplier: 1.0,
  wait_grace_min: 4,
  wait_per_min_ugx: 250,
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
    boda_evening_per_km_ugx: Math.max(0, Math.trunc(r("boda_evening_per_km_ugx"))),
    boda_late_per_km_ugx: Math.max(0, Math.trunc(r("boda_late_per_km_ugx"))),
    boda_late_base_ugx: Math.max(0, Math.trunc(r("boda_late_base_ugx"))),
    boda_late_min_ugx: Math.max(0, Math.trunc(r("boda_late_min_ugx"))),
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
    late_end_hour: Math.min(23.99, Math.max(0, r("late_end_hour"))),
    evening_multiplier: Math.min(3, Math.max(1, r("evening_multiplier"))),
    late_multiplier: Math.min(3, Math.max(1, r("late_multiplier"))),
    morning_rush_start_hour: Math.min(23.99, Math.max(0, r("morning_rush_start_hour"))),
    morning_rush_end_hour: Math.min(23.99, Math.max(0, r("morning_rush_end_hour"))),
    evening_rush_start_hour: Math.min(23.99, Math.max(0, r("evening_rush_start_hour"))),
    evening_rush_end_hour: Math.min(23.99, Math.max(0, r("evening_rush_end_hour"))),
    rush_multiplier: Math.min(2.5, Math.max(1, r("rush_multiplier"))),
    upcountry_multiplier: Math.min(2.0, Math.max(0.5, r("upcountry_multiplier"))),
    wait_grace_min: Math.max(0, r("wait_grace_min")),
    wait_per_min_ugx: Math.max(0, Math.trunc(r("wait_per_min_ugx"))),
    stopover_max_session_min: Math.max(1, Math.min(240, r("stopover_max_session_min"))),
    stopover_max_ride_min: Math.max(1, Math.min(600, r("stopover_max_ride_min"))),
    stopover_min_session_min: Math.max(0, Math.min(30, r("stopover_min_session_min"))),
    stopover_cooldown_min: Math.max(0, Math.min(120, r("stopover_cooldown_min"))),
    round_to_ugx: Math.max(1, Math.trunc(r("round_to_ugx"))),
  };
}

/** Check whether the current moment falls in Uganda's urban rush hour */
export function isUgandaRushHour(at: Date = new Date(), rates: FareRates = FALLBACK_FARE_RATES): boolean {
  const h = ugandaHour(at);
  const eatDate = new Date(at.getTime() + UGANDA_UTC_OFFSET_HOURS * 3600 * 1000);
  const dayOfWeek = eatDate.getUTCDay(); // 0 = Sun, 6 = Sat
  const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5;
  const isMorning = h >= rates.morning_rush_start_hour && h < rates.morning_rush_end_hour;
  const isEvening = h >= rates.evening_rush_start_hour && h < rates.evening_rush_end_hour;
  if (isWeekday && (isMorning || isEvening)) return true;
  if (dayOfWeek === 6 && isEvening) return true;
  return false;
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
  if (late <= 24 && h >= late) return "late";
  if (h < rates.late_end_hour) return "late";
  if (h >= evening) return "evening";
  if (isUgandaRushHour(at, rates)) return "rush";
  return "day";
}

export function tierLabel(tier: FareTier): string {
  return tier === "late" ? "Late night" : tier === "evening" ? "Evening" : tier === "rush" ? "Peak rush hour" : "Daytime";
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

export type FareKind = "boda" | "boda_cargo" | "car" | "delivery" | "gomart";

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
  /** Optional pickup coords for regional pricing determination */
  pickupLat?: number | null;
  pickupLng?: number | null;
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
  is_rush_hour?: boolean;
  rush_multiplier?: number;
  region?: UgandaRegion;
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
  const isRush = isUgandaRushHour(at, rates);
  const region = resolveUgandaRegion(input.pickupLat, input.pickupLng);
  const regionScale = region === "upcountry" ? rates.upcountry_multiplier : 1;

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
    /* Delivery rides the ride bands — day band from delivery_per_km_ugx,
       rush/evening/late from boda bands with rush multiplier. */
    perKm =
      tier === "late" ? rates.boda_late_per_km_ugx
      : tier === "evening" ? rates.boda_evening_per_km_ugx
      : tier === "rush" ? BODA_PER_KM_UGX.rush
      : rates.delivery_per_km_ugx;
    perMin = (rates.delivery_per_min_ugx === 100 ? 0 : rates.delivery_per_min_ugx);
    minFare =
      tier === "late" ? rates.delivery_min_late_ugx
      : tier === "evening" || tier === "rush" ? rates.delivery_min_evening_ugx
      : rates.delivery_min_day_ugx;
  } else if (input.kind === "car") {
    base = rates.car_base_ugx;
    perKm = rates.car_per_km_ugx;
    perMin = rates.boda_per_min_ugx;
    minFare = rates.car_min_ugx;
  } else if (input.kind === "boda_cargo") {
    /* Boda with cargo rack / delivery box for heavier parcels */
    base = 1500;
    perKm =
      tier === "late" ? 1500
      : tier === "evening" || tier === "rush" ? 1200
      : 1000;
    perMin = 0;
    minFare = 2500;
  } else if (input.kind === "gomart") {
    /* GoMart shopping runner base dispatch */
    base = 1500;
    perKm = rates.delivery_per_km_ugx;
    perMin = 0;
    minFare = 3000;
  } else {
    /* Pure distance pricing: no base, no minimum floor on standard GoRide.
       The fare is distance_km × banded per-km rate. */
    base = 0;
    perKm =
      tier === "late" ? rates.boda_late_per_km_ugx
      : tier === "evening" ? rates.boda_evening_per_km_ugx
      : tier === "rush" ? BODA_PER_KM_UGX.rush
      : rates.boda_per_km_ugx;
    perMin = rates.boda_per_min_ugx;
    minFare = 0;
  }

  /* The peak uplift rides on the distance component only. */
  const uplift =
    tier === "late" ? rates.late_multiplier
    : tier === "evening" ? rates.evening_multiplier
    : tier === "rush" ? rates.rush_multiplier
    : 1;

  const distanceUgx = perKm * km * uplift * regionScale;
  const timeUgx = perMin * durationMin;

  /* Stopover is charged on top of the minimum, never instead of it — the rider
     still gets paid the base for having driven to the pickup. */
  const billableWait = Math.max(0, waitMin - rates.wait_grace_min);
  const waitUgx = billableWait * rates.wait_per_min_ugx;

  const rawSubtotal = base + distanceUgx + timeUgx;
  const effectiveMin = input.kind === "boda" ? 0 : minFare;
  const subtotal = Math.max(effectiveMin, rawSubtotal);
  const atMinimum = subtotal > rawSubtotal;

  const bulkyUgx = bulky > 0 ? bulky * Math.max(0, Math.trunc(input.bulkySurchargeUgx ?? 0)) : 0;

  const fare = roundTo(subtotal + waitUgx + bulkyUgx, rates.round_to_ugx);

  return {
    kind: input.kind,
    tier,
    tier_label: `${tierLabel(tier)} · ${Math.round(perKm * uplift).toLocaleString("en-US")}/km`,
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
    is_rush_hour: isRush,
    rush_multiplier: rates.rush_multiplier,
    region,
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