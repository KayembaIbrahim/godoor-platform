"use client";

import { useEffect, useRef, useState } from "react";
import type { LatLng } from "./location";
import { distanceKm } from "./location";

export type RouteSource = "mapbox" | "osrm" | "straight";

export type RoadRoute = {
  coordinates: LatLng[];
  distanceKm: number;
  durationMin: number;
  source: RouteSource;
  steps: string[];
};

type CacheEntry = { at: number; route: RoadRoute };
const CACHE = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 10 * 60 * 1000;

function key(a: LatLng, b: LatLng): string {
  return `${a.lat.toFixed(5)},${a.lng.toFixed(5)}>${b.lat.toFixed(5)},${b.lng.toFixed(5)}`;
}

function valid(p: LatLng | null | undefined): p is LatLng {
  return !!p && Number.isFinite(p.lat) && Number.isFinite(p.lng) && (Math.abs(p.lat) > 1e-9 || Math.abs(p.lng) > 1e-9);
}

/** Decode a polyline (precision 5 for OSRM/Mapbox polyline, 6 for polyline6). */
function decodePolyline(str: string, precision = 5): LatLng[] {
  const factor = 10 ** precision;
  const out: LatLng[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  while (index < str.length) {
    let shift = 0;
    let result = 0;
    let b: number;
    do {
      b = str.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dLat = result & 1 ? ~(result >> 1) : result >> 1;
    lat += dLat;
    shift = 0;
    result = 0;
    do {
      b = str.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dLng = result & 1 ? ~(result >> 1) : result >> 1;
    lng += dLng;
    out.push({ lat: lat / factor, lng: lng / factor });
  }
  return out;
}

function straightLine(a: LatLng, b: LatLng): RoadRoute {
  const km = distanceKm(a, b);
  return {
    coordinates: [a, b],
    distanceKm: km,
    // 25 km/h urban motorbike baseline (matches existing tracking ETA model).
    durationMin: (km / 25) * 60,
    source: "straight",
    steps: [],
  };
}

async function viaMapbox(a: LatLng, b: LatLng, token: string, heading?: number | null, accuracy?: number | null): Promise<RoadRoute | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 12000);
  try {
    // Snap radius follows GPS quality: noisy fixes get a wider snap, clean
    // fixes stay tight to the road. Bearings keep one-ways correct.
    const radius = accuracy != null ? Math.min(50, Math.max(5, Math.round(accuracy))) : 15;
    const bearings = heading != null && Number.isFinite(heading) ? `&bearings=${Math.round(heading)},45;` : "";
    const url =
      `https://api.mapbox.com/directions/v5/mapbox/driving-traffic/${a.lng.toFixed(6)},${a.lat.toFixed(6)};${b.lng.toFixed(6)},${b.lat.toFixed(6)}` +
      `?access_token=${token}&geometries=geojson&overview=full&steps=true&language=en&annotations=duration,distance&radiuses=${radius};${radius}${bearings}`;
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      routes?: { geometry?: { coordinates?: [number, number][] } | string; distance?: number; duration?: number; legs?: { steps?: { maneuver?: { instruction?: string } }[] }[] }[];
    };
    const r = json.routes?.[0];
    if (!r || !r.geometry) return null;
    const coords = Array.isArray((r.geometry as { coordinates?: [number, number][] }).coordinates)
      ? (r.geometry as { coordinates: [number, number][] }).coordinates
          .map(([lng, lat]) => ({ lat, lng }))
          .filter(valid)
      : [];
    if (coords.length < 2) return null;
    const steps: string[] = [];
    for (const leg of r.legs || []) {
      for (const s of leg.steps || []) {
        const ins = s.maneuver?.instruction;
        if (ins) steps.push(ins);
        if (steps.length >= 12) break;
      }
      if (steps.length >= 12) break;
    }
    return {
      coordinates: coords,
      distanceKm: (r.distance || 0) / 1000,
      durationMin: (r.duration || 0) / 60,
      source: "mapbox",
      steps,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

async function viaOsrm(a: LatLng, b: LatLng): Promise<RoadRoute | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 9000);
  try {
    const url =
      `https://router.project-osrm.org/route/v1/driving/${a.lng.toFixed(6)},${a.lat.toFixed(6)};${b.lng.toFixed(6)},${b.lat.toFixed(6)}` +
      `?overview=full&geometries=polyline6&steps=true`;
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      routes?: { geometry?: string; distance?: number; duration?: number; legs?: { steps?: { maneuver?: { instruction?: string } }[] }[] }[];
    };
    const r = json.routes?.[0];
    if (!r || typeof r.geometry !== "string") return null;
    const coords = decodePolyline(r.geometry, 6).filter(valid);
    if (coords.length < 2) return null;
    return {
      coordinates: coords,
      distanceKm: (r.distance || 0) / 1000,
      durationMin: (r.duration || 0) / 60,
      source: "osrm",
      steps: [],
    };
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/**
 * Road route between two points. Tries Mapbox Directions (token from
 * NEXT_PUBLIC_MAPBOX_TOKEN), falls back to public OSRM, then straight-line
 * ETA. Never throws — always resolves with at least a straight-line route.
 */
export async function fetchRoadRoute(a: LatLng, b: LatLng, opts?: { heading?: number | null; accuracy?: number | null }): Promise<RoadRoute> {
  if (!valid(a) || !valid(b)) return straightLine({ lat: 0.3163, lng: 32.5822 }, { lat: 0.3163, lng: 32.5822 });
  const k = key(a, b);
  const hit = CACHE.get(k);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.route;

  const token = (process.env.NEXT_PUBLIC_MAPBOX_TOKEN || "").trim();
  if (token) {
    const mb = await viaMapbox(a, b, token, opts?.heading, opts?.accuracy);
    if (mb) {
      CACHE.set(k, { at: Date.now(), route: mb });
      return mb;
    }
  }
  const osrm = await viaOsrm(a, b);
  if (osrm) {
    CACHE.set(k, { at: Date.now(), route: osrm });
    return osrm;
  }
  const straight = straightLine(a, b);
  CACHE.set(k, { at: Date.now(), route: straight });
  return straight;
}

/** React hook: road route for a pickup → dropoff pair (null while invalid). */
export function useRoadRoute(pickup: LatLng | null, dropoff: LatLng | null) {
  const [route, setRoute] = useState<RoadRoute | null>(null);
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    if (!valid(pickup) || !valid(dropoff)) {
      setRoute(null);
      setLoading(false);
      return;
    }
    const id = ++seq.current;
    setLoading(true);
    fetchRoadRoute(pickup as LatLng, dropoff as LatLng)
      .then((r) => {
        if (seq.current === id) setRoute(r);
      })
      .finally(() => {
        if (seq.current === id) setLoading(false);
      });
  }, [pickup?.lat, pickup?.lng, dropoff?.lat, dropoff?.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  return { route, loading };
}
