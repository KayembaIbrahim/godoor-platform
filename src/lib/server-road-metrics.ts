/**
 * Server-side road metrics.
 *
 * `src/lib/routing.ts` is a "use client" module (it exports a React hook), so an
 * API route cannot import it. The server needs real road distance and driving
 * duration for pricing — the alternative, haversine, under-reports an urban trip
 * by roughly 30% and would quote a customer a different fare than the rider
 * actually drives.
 *
 * Fetches Mapbox Directions when a token is configured, falls back to public
 * OSRM, and finally to a haversine estimate. Always resolves; never throws,
 * because a routing provider being down must degrade the fare estimate rather
 * than block a ride request.
 */

import { haversineKm, estimateDurationMin } from "@/lib/fare-engine";

export type RoadMetrics = {
  distanceKm: number;
  durationMin: number;
  source: "mapbox" | "osrm" | "straight";
};

const TIMEOUT_MS = 6000;

/* Short-lived cache. Booking screens re-quote on every map move; without this
   a single drag would fire dozens of Directions calls and hit rate limits. */
const CACHE = new Map<string, { at: number; m: RoadMetrics }>();
const CACHE_TTL_MS = 60_000;

function cacheKey(a: Lat, b: Lat): string {
  return `${a.lat.toFixed(4)},${a.lng.toFixed(4)}>${b.lat.toFixed(4)},${b.lng.toFixed(4)}`;
}

type Lat = { lat: number; lng: number };

async function withTimeout<T>(fn: (signal: AbortSignal) => Promise<T>, ms: number): Promise<T | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fn(ctrl.signal);
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

async function viaMapbox(a: Lat, b: Lat, token: string): Promise<RoadMetrics | null> {
  const url =
    `https://api.mapbox.com/directions/v5/mapbox/driving-traffic/` +
    `${a.lng.toFixed(6)},${a.lat.toFixed(6)};${b.lng.toFixed(6)},${b.lat.toFixed(6)}` +
    `?overview=false&access_token=${encodeURIComponent(token)}`;
  const res = await withTimeout((signal) => fetch(url, { signal }), TIMEOUT_MS);
  if (!res || !res.ok) return null;
  const json = (await res.json()) as { routes?: { distance?: number; duration?: number }[] };
  const r = json.routes?.[0];
  if (!r || typeof r.distance !== "number") return null;
  return { distanceKm: r.distance / 1000, durationMin: (r.duration || 0) / 60, source: "mapbox" };
}

async function viaOsrm(a: Lat, b: Lat): Promise<RoadMetrics | null> {
  const url =
    `https://router.project-osrm.org/route/v1/driving/` +
    `${a.lng.toFixed(6)},${a.lat.toFixed(6)};${b.lng.toFixed(6)},${b.lat.toFixed(6)}` +
    `?overview=false`;
  const res = await withTimeout((signal) => fetch(url, { signal }), TIMEOUT_MS);
  if (!res || !res.ok) return null;
  const json = (await res.json()) as { routes?: { distance?: number; duration?: number }[] };
  const r = json.routes?.[0];
  if (!r || typeof r.distance !== "number") return null;
  return { distanceKm: r.distance / 1000, durationMin: (r.duration || 0) / 60, source: "osrm" };
}

/**
 * Real road distance + duration between two points. Never rejects.
 *
 * The straight-line fallback is *upgraded* to use the same estimated duration
 * the fare engine would use anyway, so the caller can rely on durationMin being
 * consistent with distanceKm even when every provider is unreachable.
 */
export async function roadMetrics(a: Lat, b: Lat): Promise<RoadMetrics> {
  const fallback = (): RoadMetrics => {
    const km = haversineKm(a.lat, a.lng, b.lat, b.lng);
    return { distanceKm: km, durationMin: estimateDurationMin(km), source: "straight" };
  };

  if (!Number.isFinite(a.lat) || !Number.isFinite(a.lng)) return fallback();
  if (!Number.isFinite(b.lat) || !Number.isFinite(b.lng)) return fallback();

  const key = cacheKey(a, b);
  const hit = CACHE.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.m;

  const token = (process.env.NEXT_PUBLIC_MAPBOX_TOKEN || "").trim();
  let m: RoadMetrics | null = null;
  if (token) m = await viaMapbox(a, b, token);
  if (!m) m = await viaOsrm(a, b);

  const out = m ?? fallback();
  CACHE.set(key, { at: Date.now(), m: out });
  return out;
}