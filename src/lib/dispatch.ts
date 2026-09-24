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