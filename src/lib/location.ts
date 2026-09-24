"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type LatLng = { lat: number; lng: number };
export const KAMPALA: LatLng = { lat: 0.3163, lng: 32.5822 };

/** Uganda's districts — businesses pick their fixed district, customers browse by district. */
export const UGANDA_DISTRICTS = [
  "Kampala", "Wakiso", "Mukono", "Masaka", "Mbarara", "Jinja", "Gulu", "Lira", "Arua",
  "Mbale", "Tororo", "Soroti", "Fort Portal", "Kabale", "Hoima", "Entebbe", "Ntungamo",
  "Bushenyi", "Kasese", "Kitgum", "Adjumani", "Apac", "Oyam", "Nebbi", "Zombo", "Koboko",
  "Yumbe", "Moroto", "Kotido", "Nakapiripirit", "Kapchorwa", "Kumi", "Sironko", "Bugiri",
  "Iganga", "Mayuge", "Kamuli", "Kayunga", "Luwero", "Nakasongola", "Mityana", "Mubende",
  "Kiboga", "Kyankwanzi", "Rakai", "Kyotera", "Kalangala", "Sembabule", "Gomba",
  "Bukomansimbi", "Masindi", "Buliisa", "Kiryandongo", "Kyenjojo", "Kibaale", "Kamwenge",
  "Ibanda", "Isingiro", "Kiruhura", "Lyantonde", "Rukungiri", "Kanungu", "Kisoro",
  "Bundibugyo", "Ntoroko", "Amuria", "Katakwi", "Serere", "Bukedea", "Alebtong", "Dokolo",
  "Kaberamaido", "Amolatar", "Otuke", "Agago", "Pader", "Lamwo", "Amuru", "Nwoya", "Buvuma",
] as const;

/** Fallback centres of Uganda's major districts for GPS → district detection. */
const DISTRICT_CENTROIDS: { name: string; lat: number; lng: number }[] = [
  { name: "Kampala", lat: 0.3163, lng: 32.5822 },
  { name: "Wakiso", lat: 0.4044, lng: 32.4595 },
  { name: "Mukono", lat: 0.3533, lng: 32.7553 },
  { name: "Masaka", lat: -0.3356, lng: 31.7341 },
  { name: "Mbarara", lat: -0.6072, lng: 30.6545 },
  { name: "Jinja", lat: 0.4244, lng: 33.2042 },
  { name: "Gulu", lat: 2.7746, lng: 32.2990 },
  { name: "Lira", lat: 2.2499, lng: 32.8999 },
  { name: "Arua", lat: 3.0151, lng: 30.9111 },
  { name: "Mbale", lat: 1.0784, lng: 34.1750 },
  { name: "Tororo", lat: 0.6930, lng: 34.1809 },
  { name: "Soroti", lat: 1.7146, lng: 33.6113 },
  { name: "Fort Portal", lat: 0.6710, lng: 30.2750 },
  { name: "Kabale", lat: -1.2490, lng: 29.9899 },
  { name: "Hoima", lat: 1.4356, lng: 31.3436 },
  { name: "Entebbe", lat: 0.0645, lng: 32.4469 },
  { name: "Kasese", lat: 0.1836, lng: 30.0909 },
  { name: "Busia", lat: 0.4636, lng: 34.0972 },
  { name: "Mityana", lat: 0.4177, lng: 32.0597 },
  { name: "Mubende", lat: 0.5582, lng: 31.3949 },
  { name: "Kitgum", lat: 3.2885, lng: 32.8781 },
  { name: "Adjumani", lat: 3.3788, lng: 31.7910 },
  { name: "Nebbi", lat: 2.4790, lng: 31.0889 },
  { name: "Moroto", lat: 2.5273, lng: 34.6666 },
  { name: "Kotido", lat: 2.9808, lng: 34.1333 },
  { name: "Kapchorwa", lat: 1.4000, lng: 34.3667 },
  { name: "Iganga", lat: 0.6094, lng: 33.4687 },
  { name: "Kamuli", lat: 0.9455, lng: 33.1140 },
  { name: "Kayunga", lat: 0.7020, lng: 32.8887 },
  { name: "Luwero", lat: 0.8492, lng: 32.4733 },
  { name: "Nakasongola", lat: 1.3089, lng: 32.4565 },
  { name: "Kiboga", lat: 0.9161, lng: 31.7742 },
  { name: "Rakai", lat: -0.7190, lng: 31.4870 },
  { name: "Kyotera", lat: -0.6150, lng: 31.5180 },
  { name: "Kalangala", lat: -0.3073, lng: 32.2250 },
  { name: "Sembabule", lat: 0.0750, lng: 31.4167 },
  { name: "Masindi", lat: 1.6747, lng: 31.7150 },
  { name: "Kiryandongo", lat: 1.8764, lng: 32.0645 },
  { name: "Kyenjojo", lat: 0.6080, lng: 30.6390 },
  { name: "Ibanda", lat: -0.1336, lng: 30.4947 },
  { name: "Isingiro", lat: -0.8500, lng: 30.6167 },
  { name: "Rukungiri", lat: -0.7989, lng: 29.9250 },
  { name: "Kanungu", lat: -0.8678, lng: 29.8131 },
  { name: "Kisoro", lat: -1.2849, lng: 29.6850 },
  { name: "Bundibugyo", lat: 0.6860, lng: 30.0650 },
  { name: "Ntoroko", lat: 1.0750, lng: 30.2750 },
  { name: "Amuria", lat: 2.0030, lng: 33.6500 },
  { name: "Katakwi", lat: 1.8911, lng: 33.9660 },
  { name: "Serere", lat: 1.4930, lng: 33.5500 },
  { name: "Kumi", lat: 1.4607, lng: 33.9361 },
  { name: "Sironko", lat: 1.2300, lng: 34.2480 },
  { name: "Bugiri", lat: 0.5700, lng: 33.7410 },
  { name: "Mayuge", lat: 0.4590, lng: 33.4800 },
  { name: "Kaberamaido", lat: 1.7393, lng: 33.1590 },
  { name: "Alebtong", lat: 2.2447, lng: 33.2547 },
  { name: "Dokolo", lat: 1.9160, lng: 33.1690 },
  { name: "Amolatar", lat: 1.6285, lng: 32.8316 },
  { name: "Otuke", lat: 2.5000, lng: 33.5080 },
  { name: "Agago", lat: 2.8330, lng: 33.3330 },
  { name: "Pader", lat: 3.0500, lng: 33.2167 },
  { name: "Lamwo", lat: 3.6169, lng: 32.8022 },
  { name: "Amuru", lat: 2.8093, lng: 31.8497 },
  { name: "Nwoya", lat: 2.6350, lng: 31.6950 },
  { name: "Buvuma", lat: -0.1000, lng: 33.3500 },
  { name: "Moyo", lat: 3.6417, lng: 31.7239 },
  { name: "Yumbe", lat: 3.4653, lng: 31.2475 },
  { name: "Koboko", lat: 3.4167, lng: 30.9667 },
  { name: "Maracha", lat: 3.2667, lng: 30.9333 },
  { name: "Zombo", lat: 2.5167, lng: 30.9500 },
];

function matchDistrictInText(text: string): string | null {
  const lower = text.toLowerCase();
  // Longest district names first so "Fort Portal" wins over "Fort"
  const sorted = [...UGANDA_DISTRICTS].sort((a, b) => b.length - a.length);
  for (const d of sorted) {
    if (lower.includes(d.toLowerCase())) return d;
  }
  return null;
}

/**
 * Detect which district a GPS point is in. Uses Mapbox context, then Nominatim,
 * then falls back to the nearest known district centroid (within ~60 km).
 */
export async function detectDistrict(c: LatLng): Promise<string | null> {
  const mapboxToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || "";
  if (mapboxToken) {
    try {
      const res = await fetch(
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${c.lng.toFixed(7)},${c.lat.toFixed(7)}.json?access_token=${mapboxToken}&country=UG&language=en&limit=1`
      );
      const json = await res.json();
      const feature = json.features?.[0];
      if (feature) {
        const contextText = (feature.context || []).map((ctx: { text?: string }) => ctx.text || "").join(" ");
        const found = matchDistrictInText(`${feature.text || ""} ${contextText} ${feature.place_name || ""}`);
        if (found) return found;
      }
    } catch {}
  }

  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${c.lat.toFixed(7)}&lon=${c.lng.toFixed(7)}&zoom=10&addressdetails=1`,
      { headers: { "Accept-Language": "en", "User-Agent": "GoDoor/1.0" } },
    );
    const json = await res.json();
    if (json?.address) {
      const a = json.address;
      const region = a.state_district || a.county || a.municipality || a.state || a.city || a.town || a.village || "";
      const found = matchDistrictInText(`${region} ${json.display_name || ""}`);
      if (found) return found;
    }
  } catch {}

  // Nearest known centroid
  let best: string | null = null;
  let bestKm = Infinity;
  for (const d of DISTRICT_CENTROIDS) {
    const km = distanceKm(c, { lat: d.lat, lng: d.lng });
    if (km < bestKm) { bestKm = km; best = d.name; }
  }
  return bestKm <= 60 ? best : null;
}

export async function reverseGeocode(c: LatLng): Promise<string> {
  // Source 1: Mapbox Geocoding API (street-accurate, free 200k calls/month)
  const mapboxToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || "";
  if (mapboxToken) {
    try {
      const res = await fetch(
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${c.lng.toFixed(7)},${c.lat.toFixed(7)}.json?access_token=${mapboxToken}&types=address,neighborhood,locality,place&country=UG&language=en&limit=1`
      );
      const json = await res.json();
      if (json.features && json.features.length > 0) {
        const addr = json.features[0].place_name;
        if (addr && addr.length > 5) {
          // Shorten to "Street, Area" for display
          const parts = addr.split(",");
          if (parts.length >= 2) {
            const first = parts[0].trim();
            const second = parts[1].trim();
            return first + ", " + second;
          }
          return addr;
        }
      }
    } catch {}
  }

  // Source 2: Nominatim (free fallback)
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${c.lat.toFixed(7)}&lon=${c.lng.toFixed(7)}&zoom=18&addressdetails=1`,
      { headers: { "Accept-Language": "en", "User-Agent": "GoDoor/1.0" } },
    );
    const json = await res.json();
    if (json?.address) {
      const a = json.address;
      const parts: string[] = [];
      if (a.house_number && a.road) parts.push(a.road + " " + a.house_number);
      else if (a.road) parts.push(a.road);
      else if (a.pedestrian) parts.push(a.pedestrian);
      const area = a.neighbourhood || a.suburb || a.village || a.quarter || a.residential;
      if (area) parts.push(area);
      const city = a.city || a.town || a.county || a.municipality;
      if (city) parts.push(city);
      if (parts.length >= 2) return parts.slice(0, 3).join(", ");
      if (parts.length === 1) return parts[0] + ", Uganda";
      if (json.display_name) {
        const short = json.display_name.split(",").slice(0, 3).join(",").trim();
        if (short.length > 5) return short;
      }
    }
  } catch {}
  return fallbackAddress(c);
}

function fallbackAddress(c: LatLng): string {
  // Find the nearest known district centroid and describe the location by district
  let best = "Uganda";
  let bestKm = Infinity;
  let bestLat = c.lat;
  let bestLng = c.lng;
  for (const d of DISTRICT_CENTROIDS) {
    const km = distanceKm(c, { lat: d.lat, lng: d.lng });
    if (km < bestKm) {
      bestKm = km;
      best = d.name;
      bestLat = d.lat;
      bestLng = d.lng;
    }
  }
  if (bestKm <= 60) {
    return best + ", Uganda";
  }
  return c.lat.toFixed(4) + "°, " + c.lng.toFixed(4) + "°";
}

export type GeoStatus = "idle" | "locating" | "ok" | "denied" | "watching";

export function useGeolocation() {
  const [coords, setCoords] = useState<LatLng | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const [status, setStatus] = useState<GeoStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [heading, setHeading] = useState<number | null>(null);
  const [speed, setSpeed] = useState<number | null>(null);
  const watchIdRef = useRef<number | null>(null);
  const geoDoneRef = useRef(false);
  const bestAccuracyRef = useRef<number>(Infinity);
  const lastCoordsRef = useRef<LatLng | null>(null);
  const addrTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const processPosition = useCallback((pos: GeolocationPosition) => {
    const c = { lat: pos.coords.latitude, lng: pos.coords.longitude };
    const acc = pos.coords.accuracy;
    // Always update when the rider has physically moved (>=30m), otherwise the
    // marker sticks to the first fix and reads as "no live location" on the map.
    const movedMeters = lastCoordsRef.current ? (distanceKm(lastCoordsRef.current, c) * 1000) : NaN;
    const moved = !lastCoordsRef.current || movedMeters >= 30;
    // Also keep the best fix (lowest accuracy value = most precise)
    if (moved || acc < bestAccuracyRef.current) {
      lastCoordsRef.current = c;
      if (acc < bestAccuracyRef.current) bestAccuracyRef.current = acc;
      setCoords(c);
      setAccuracy(acc);
      setHeading(pos.coords.heading || null);
      setSpeed(pos.coords.speed || null);
      setStatus("watching");
      // Debounce reverse geocoding
      if (addrTimerRef.current) clearTimeout(addrTimerRef.current);
      addrTimerRef.current = setTimeout(async () => {
        const addr = await reverseGeocode(c);
        setAddress(addr);
      }, 1500);
    }
  }, []);

  // IP fallback — auto-gets approximate location (≈ city-level) so map and orders never stay blank
  // Users can still refine via "Use my location" or address search for street accuracy
  const ipFallback = useCallback(async () => {
    const tryIpApis: Array<() => Promise<LatLng | null>> = [
      async () => {
        const r = await fetch("https://ipapi.co/json/");
        const j = await r.json();
        if (j.latitude && j.longitude) return { lat: Number(j.latitude), lng: Number(j.longitude) };
        return null;
      },
      async () => {
        const r = await fetch("https://freeipapi.com/api/json");
        const j = await r.json();
        if (j.latitude && j.longitude) return { lat: Number(j.latitude), lng: Number(j.longitude) };
        return null;
      },
    ];
    for (const fn of tryIpApis) {
      try {
        const c = await fn();
        if (c && Number.isFinite(c.lat) && Number.isFinite(c.lng)) {
          // Uganda bounds check — if IP says outside Uganda, clamp to Kampala fallback
          const inUg = c.lat >= -1.5 && c.lat <= 4.5 && c.lng >= 28 && c.lng <= 36;
          const loc = inUg ? c : { lat: 0.3163, lng: 32.5822 };
          setCoords(loc);
          setAccuracy(5000);
          setStatus("watching");
          // Reverse geocode for display
          try {
            const addr = await reverseGeocode(loc);
            setAddress(addr);
          } catch {}
          return true;
        }
      } catch {}
    }
    return false;
  }, []);

  const startWatching = useCallback(() => {
    if (!("geolocation" in navigator)) {
      // No GPS available — user must search their address
      setStatus("denied");
      setError("GPS not available. Search your address instead.");
      return;
    }
    setStatus("locating");
    setError(null);
    bestAccuracyRef.current = Infinity;

    // Single fast read first
    navigator.geolocation.getCurrentPosition(
      processPosition,
      async () => { if (bestAccuracyRef.current === Infinity) await ipFallback() || setError("Location access denied. Tap to retry."); },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
    );

    // Continuous watch — keeps best fix, no max age
    watchIdRef.current = navigator.geolocation.watchPosition(
      processPosition,
      async (err) => {
        if (bestAccuracyRef.current === Infinity) {
          if (err.code === 1) setError("GPS access denied. Enable location services in your browser settings.");
          else setError("GPS error. Tap to retry.");
        }
      },
      { enableHighAccuracy: true, timeout: 30000, maximumAge: 0 },
    );
  }, [processPosition, ipFallback]);

  useEffect(() => {
    return () => {
      if (watchIdRef.current != null) navigator.geolocation.clearWatch(watchIdRef.current);
      if (addrTimerRef.current) clearTimeout(addrTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (geoDoneRef.current) return;
    geoDoneRef.current = true;
    startWatching();
  }, [startWatching]);

  const refresh = useCallback(() => {
    if (watchIdRef.current != null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    geoDoneRef.current = false;
    bestAccuracyRef.current = Infinity;
    startWatching();
  }, [startWatching]);

  return { coords, address, status, error, accuracy, heading, speed, refresh };
}

export function distanceKm(a: LatLng, b: LatLng): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

export function sortByDistance<T extends { lat?: number; lng?: number }>(items: T[], userLoc: LatLng | null): T[] {
  if (!userLoc) return items;
  return [...items].sort((a, b) => {
    const da = a.lat != null && a.lng != null ? distanceKm(userLoc, a as LatLng) : 999;
    const db = b.lat != null && b.lng != null ? distanceKm(userLoc, b as LatLng) : 999;
    return da - db;
  });
}

export function formatAccuracy(meters: number | null): string {
  if (meters == null) return "";
  if (meters < 10) return Math.round(meters) + "m accuracy (excellent)";
  if (meters < 50) return Math.round(meters) + "m accuracy (good)";
  if (meters < 200) return Math.round(meters) + "m accuracy (fair)";
  if (meters < 5000) return "~" + Math.round(meters) + "m accuracy — move to open area";
  return "Approximate location (via network)";
}

export function formatDistance(km: number): string {
  if (km < 0.1) return "Nearby";
  if (km < 1) return Math.round(km * 1000) + "m";
  return km.toFixed(1) + " km";
}


/** Mapbox Places autocomplete for address search (street-accurate across Uganda) */
export function fetchPlaceSuggestions(query: string): Promise<{ place: string; lat: number; lng: number }[]> {
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || "";
  if (!token || !query.trim()) return Promise.resolve([]);
  return fetch(
    `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?access_token=${token}&country=UG&language=en&types=address,neighborhood,locality,place&limit=5`
  )
    .then((r) => r.json())
    .then((json) => {
      return (json.features || []).map((f: { place_name: string; center: number[] }) => ({
        place: f.place_name,
        lat: f.center[1],
        lng: f.center[0],
      }));
    })
    .catch(() => []);
}
