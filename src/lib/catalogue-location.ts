"use client";

import { useEffect, useMemo, useState } from "react";
import { useGeolocation, MASAKA as MASAKA_FALLBACK, distanceKm, type LatLng } from "./location";
import { resolveEffectiveLoc, type StoredCustomerAddress } from "./customer-location-core";
import { getLastAddress } from "@/components/AddressSearchModal";

/**
 * Shared customer location for catalogue surfaces.
 *
 * Browse, categories, explore and the homepage all rank merchants around the
 * same point. Previously only CustomerHome mounted useGeolocation; the other
 * pages filtered nothing at all, so a customer in Kampala saw Masaka shops.
 */
export type CatalogueLoc = { loc: LatLng | null; isFallback: boolean };

export function useCatalogueLocation(): CatalogueLoc {
  const { coords: gpsLoc, status: locStatus } = useGeolocation();
  const [saved, setSaved] = useState<StoredCustomerAddress | null>(null);

  useEffect(() => {
    try { setSaved(getLastAddress()); } catch {}
    const onStorage = (e: StorageEvent) => {
      if (e.key === "godoor-delivery-address") {
        try { setSaved(JSON.parse(e.newValue ?? "null")); } catch {}
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  return useMemo(
    () => resolveEffectiveLoc({ saved, gpsLoc, status: locStatus }, MASAKA_FALLBACK),
    [saved, gpsLoc, locStatus],
  );
}

/**
 * Catalogue radius. 25 km matches the proximity band the homepage already
 * uses (1 - dist/25) and the delivery market in Kampala/Masaka: a shop
 * beyond 25 km cannot be ridden to in a sane time.
 */
export const CATALOGUE_RADIUS_KM = 25;

/** Non-district junk values stored in `district` by older imports. */
const JUNK_DISTRICTS = new Set(["uganda", ""]);

type MerchantLike = {
  lat?: number | null;
  lng?: number | null;
  district?: string | null;
  area?: string | null;
};

function hasCoords<T extends MerchantLike>(m: T): boolean {
  return typeof m.lat === "number" && typeof m.lng === "number" && m.lat !== 0 && m.lng !== 0;
}

/**
 * Filter merchants to those the customer can actually reach.
 *
 * Rules:
 *  - Merchants with real coordinates: always distance-checked (>25 km out).
 *  - Merchants without coordinates: kept ONLY if their district text matches
 *    the customer's district text — never shown to a customer whose district
 *    we don't know.
 *  - district "Uganda"/empty (legacy junk) never matches when we know the
 *    customer's city, and never produces a banner city.
 *  - When the customer location is unknown or the Masaka fallback: all
 *    merchants with coords are kept, no-coords merchants are dropped.
 */
export function filterMerchantsForLocation<T extends MerchantLike>(
  merchants: T[],
  loc: LatLng | null,
  placeName: string | null,
  isFallback: boolean,
  radiusKm = CATALOGUE_RADIUS_KM,
): T[] {
  const placeLower = (placeName || "").toLowerCase();
  const userDistrict = placeLower ? (placeLower.split(",").pop() ?? "").trim() : "";

  const districtMatches = (m: T) => {
    if (!userDistrict || !m.district) return false;
    const d = String(m.district).trim().toLowerCase();
    if (JUNK_DISTRICTS.has(d)) return false;
    return d === userDistrict || d.includes(userDistrict) || userDistrict.includes(d);
  };

  if (!loc || isFallback) {
    return merchants.filter((m) => {
      if (hasCoords(m)) {
        // No real location — can't verify distance, but keep the shop if it
        // claims the same city (area/district text). Masaka fallback shows
        // all coordinate-bearing shops so the catalogue isn't empty until GPS.
        return isFallback ? true : districtMatches(m);
      }
      return false;
    });
  }

  return merchants.filter((m) => {
    if (hasCoords(m)) {
      return distanceKm(loc, m as LatLng) <= radiusKm;
    }
    // No coords: only show if district text matches the customer's city.
    return districtMatches(m);
  });
}

/**
 * Human city for the "Showing businesses in {city}" banner.
 * Prefers the merchant majority district so the banner reflects what's in
 * the list, not a guessed location.
 */
export function bannerCity<T extends MerchantLike>(
  merchants: T[],
  placeName: string | null,
): string | null {
  // Prefer user's own place text if it looks like a city.
  if (placeName) {
    const parts = placeName.split(",").map((s) => s.trim()).filter(Boolean);
    const last = parts[parts.length - 1];
    if (last && !JUNK_DISTRICTS.has(last.toLowerCase())) return last;
  }
  // Fall back to majority district among visible merchants.
  const counts: Record<string, number> = {};
  for (const m of merchants) {
    const d = String(m.district || "").trim();
    if (d && !JUNK_DISTRICTS.has(d.toLowerCase())) counts[d] = (counts[d] || 0) + 1;
  }
  let best: string | null = null;
  let bestN = 0;
  for (const [d, n] of Object.entries(counts)) {
    if (n > bestN) { best = d; bestN = n; }
  }
  return best;
}
