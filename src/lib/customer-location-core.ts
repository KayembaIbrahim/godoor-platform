/**
 * Pure customer-home location resolution.
 *
 * Dependency-free so it can be unit tested directly. `CustomerHome.tsx` owns the
 * hooks and the markup; everything here is a decision function with no I/O.
 * Same split as `notification-core.ts` and `sheet-history-core.ts`.
 *
 * ── The defect this exists to prevent ────────────────────────────────────
 * The home screen read:
 *
 *     return locStatus === "denied" || locStatus === "idle" ? FALLBACK : null;
 *
 * `locStatus` is `"idle"` on the FIRST render — before detection has even been
 * requested — so every page load substituted a hard-coded city coordinate
 * within a frame or two. `detectDistrict` then reverse-geocoded *that* guess and
 * the header displayed "Near <that city>": a place the customer was never in.
 *
 * Two things made it look like nothing was detecting, which is the report:
 *   1. the real fix arrived later and silently overwrote it, so the address
 *      flickered from a wrong district to the truth;
 *   2. when reverse-geocoding failed it never corrected, and the wrong district
 *      stayed for the rest of the session, because the effect that set it only
 *      ever assigned and never cleared.
 *
 * The welcome page has no such branch, which is exactly why it felt like
 * detection worked there and not on the home screen. These two functions keep
 * the home screen's behaviour pinned to the welcome page's.
 *
 * ── The defect after that ─────────────────────────────────────────────────
 * Fixing the above was not enough, and the remaining gap was not a timing one.
 * Both surfaces persist into a single localStorage key, and the home screen
 * ranked that stored value ABOVE the live reading in both functions here. So
 * whichever address landed in the key first — an IP-level city estimate, or a
 * place picked on last week's WiFi — outranked the GPS fix forever. The header
 * showed a stale place while the real one sat unused in the hook, and the only
 * way forward was re-picking it by hand. The welcome page never saw this because
 * it displays the live reading directly and never reads storage.
 *
 * Hence `source`: a deliberate choice wins outright, a detected one is a cache
 * hint that any live reading may replace. See `isDeliberate` for why a record
 * with no `source` is treated as deliberate.
 */

import type { LatLng } from "./location";

export type GeoStatusLike = "idle" | "locating" | "ok" | "denied" | "watching";

export type CustomerAddress = { place: string; lat: number; lng: number };

/**
 * Where a stored address came from. See `AddressSearchModal` for the long form.
 *
 * Absent means written before this distinction existed — see `isDeliberate`.
 */
export type AddressSource = "manual" | "auto";

export type StoredCustomerAddress = CustomerAddress & { source?: AddressSource };

/**
 * Is this stored address a choice the customer actually made?
 *
 * A record with no `source` predates the distinction. It is treated as
 * `manual`, NOT `auto`, and that is the safe direction: an unrecognised value
 * is assumed to be the customer's own pick rather than silently replacing the
 * place they chose. The cost is that a pre-existing stale entry keeps winning
 * until they re-pick once — but from then on it is stamped, so it self-heals
 * and the account is stable. Preferring `auto` instead would silently move a
 * customer to a different address, which is the one outcome that could deliver
 * food somewhere they did not ask for.
 */
export function isDeliberate(addr: { source?: AddressSource } | null | undefined): boolean {
  return !!addr && addr.source !== "auto";
}

export type ResolveLocInput = {
  /** An address already stored for this customer. */
  saved: StoredCustomerAddress | null;
  /** A position actually measured by GPS or the IP estimate. */
  gpsLoc: LatLng | null;
  status: GeoStatusLike;
};

/** True while detection is still running and has produced nothing yet. */
export function isDetecting(status: GeoStatusLike): boolean {
  return status === "idle" || status === "locating";
}

/**
 * The position the catalogue should be sorted around.
 *
 * `fallback` is used ONLY when detection has concluded and failed. `"idle"` is
 * deliberately excluded: it is the pre-detection state, not a failure, and
 * treating it as one is what produced the phantom district.
 *
 * A deliberately chosen address wins outright. One the app merely detected is a
 * cache hint and yields to a live reading — that is what lets the home screen
 * show where the customer actually is now, rather than wherever the app guessed
 * the first time it ever ran.
 */
export function resolveEffectiveLoc(
  { saved, gpsLoc, status }: ResolveLocInput,
  fallback: LatLng,
): { loc: LatLng | null; isFallback: boolean } {
  if (isDeliberate(saved)) return { loc: { lat: saved!.lat, lng: saved!.lng }, isFallback: false };
  if (gpsLoc) return { loc: gpsLoc, isFallback: false };
  if (saved) return { loc: { lat: saved.lat, lng: saved.lng }, isFallback: false };
  if (status === "denied") return { loc: fallback, isFallback: true };
  return { loc: null, isFallback: false };
}

export type DisplayInput = {
  saved: StoredCustomerAddress | null;
  /** Reverse-geocoded place from a real fix. */
  gpsPlace: string | null;
  gpsLoc: LatLng | null;
  /** District reverse-geocoded from a REAL position — never from the fallback. */
  detectedDistrict: string | null;
  status: GeoStatusLike;
};

/**
 * The one line the customer reads as "where is GoDoor delivering to".
 *
 * Order mirrors the welcome page, which shows the live reading and never
 * consults storage at all: a real place name, then an honest statement that we
 * have the position but no street name, then a detecting state that says so,
 * and only then the manual prompt.
 *
 * A detected-but-cached address sits BELOW the live reading — the defect this
 * replaces ranked it first, so a stale city estimate permanently outranked the
 * real fix and the customer had to re-pick by hand.
 */
export function resolveDisplayAddress({
  saved,
  gpsPlace,
  gpsLoc,
  detectedDistrict,
  status,
}: DisplayInput): string {
  if (isDeliberate(saved) && saved?.place) return saved.place;
  if (gpsPlace) return gpsPlace;
  if (gpsLoc) return detectedDistrict ? `Near ${detectedDistrict}` : "Using your current location";
  if (saved?.place) return saved.place;
  if (isDetecting(status)) return "Detecting your location…";
  return "Set delivery address";
}
