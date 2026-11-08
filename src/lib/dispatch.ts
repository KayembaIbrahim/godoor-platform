import { distanceKm, type LatLng } from "@/lib/location";

/**
 * Dispatch scoring (Glovo Jarvis-style, simplified).
 *
 * An order's "cost" for a rider is the shortest journey: rider → pickup →
 * drop-off. We score candidates by that total straight-line distance and
 * derive an ETA at a realistic Kampala mobility speed, matching the ETA
 * convention used across the tracking experience (25 km/h).
 */

export const DISPATCH_SPEED_KMH = 25;

/**
 * Rider visibility radius (km) — a rider only sees/claims jobs whose PICKUP
 * is within 3 km of their live GPS position. This is the Uber/Glovo dispatch
 * rule: no rider from another city (or >3 km away) can even SEE the order, so
 * the nearest rider wins it and the pickup leg is never absurd.
 *
 * Applied on all three boards: Boda rides (`ride_requests`), Deliveries
 * (`orders` → merchant pickup), GoMart (`shopping_lists` → customer pickup).
 *
 * No GPS fix = no board at all. A rider without a position cannot be placed
 * on the map and must never receive every nationwide job.
 *
 * Note: the map that shows "nearest pickup" on the Boda panel uses straight-
 * line distance ONLY to pick a label — the dealbreaker is this rider→pickup
 * proximity gate, not that label.
 */
export const RIDER_VISIBILITY_RADIUS_KM = 3;

/** True only when the rider has GPS AND the pickup is within the radius. */
export function jobVisibleToRider(
  rider: LatLng | null | undefined,
  pickup: LatLng | null | undefined,
  radiusKm: number = RIDER_VISIBILITY_RADIUS_KM,
): boolean {
  if (!rider || rider.lat == null || rider.lng == null) return false;
  if (!pickup || pickup.lat == null || pickup.lng == null) return false;
  return distanceKm(rider, pickup) <= radiusKm;
}

export type DispatchInput = {
  rider?: LatLng | null;
  pickup?: LatLng | null;
  dropoff?: LatLng | null;
};

export type DispatchScore = {
  /** rider → pickup, in km (0 when the rider's location is unknown). */
  pickupKm: number;
  /** pickup → drop-off, in km. */
  dropoffKm: number;
  /** total straight-line journey, in km. */
  totalKm: number;
  /** approximate arrival in minutes (25 km/h + pickup buffer). */
  etaMin: number;
};

export function dispatchScore(input: DispatchInput): DispatchScore {
  const { rider = null, pickup = null, dropoff = null } = input;

  const pickupKm = rider && pickup ? distanceKm(rider, pickup) : 0;
  const dropoffKm = pickup && dropoff ? distanceKm(pickup, dropoff) : 0;
  const totalKm = pickupKm + dropoffKm;

  // Real roads ≈ straight-line × 1.3; +3 min handling buffer at pickup.
  const etaMin = totalKm > 0
    ? Math.round((totalKm * 1.3) / DISPATCH_SPEED_KMH * 60) + (rider ? 3 : 0)
    : 0;

  return { pickupKm, dropoffKm, totalKm, etaMin };
}

/** Pretty "≈ X min" label used by offer cards. */
export function formatDispatchEta(min: number): string {
  if (min <= 0) return "—";
  if (min === 1) return "~1 min";
  return `~${min} min`;
}