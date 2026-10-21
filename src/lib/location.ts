"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchTimed, firstOf, withTimeout, GEO_TIMEOUT_MS } from "./net";
import {
  DISTRICT_NAMES,
  DISTRICT_PLACES,
  districtForPoint,
  gazetteerPlaceName,
  nearestUgandaPlace,
  searchUgandaPlaces,
} from "./uganda-places";

export type LatLng = { lat: number; lng: number };
export const KAMPALA: LatLng = { lat: 0.3163, lng: 32.5822 };

/**
 * Masaka — GoDoor's launch city, and the centre used when a position is needed
 * for sorting but none is available (permission denied, offline, first paint).
 *
 * This used to fall back to KAMPALA. On a Masaka launch that centres every
 * distance calculation roughly 130 km off, so a customer standing in Masaka was
 * measured from Kampala: shops sorted as "far away", and the header could name
 * a district they were never in. The fallback must be the city the platform
 * actually serves — Masaka at -0.3417°, 31.7344°.
 */
export const MASAKA: LatLng = { lat: -0.3417, lng: 31.7344 };

/**
 * Geolocation, native and web, behind one small interface.
 *
 * This used to `import { Geolocation } from "@capacitor/geolocation"` at the top
 * of the file. That pulled @capacitor/core's native-bridge shim into the initial
 * chunk of every page that touched location — measured live at 76,526 B
 * inflated / 27,214 KB brotli, `androidBridge` and
 * `webkit.messageHandlers` platform detection included — and it was
 * `<link rel="preload">`ed on /app.
 *
 * Every customer on godoor.site is on the web; the APK is not shipped yet. So
 * the plugin is now imported dynamically and ONLY when actually running inside
 * a Capacitor container. On the web we talk to `navigator.geolocation`
 * directly, which is exactly what the plugin's own web implementation does, so
 * behaviour is unchanged and the 27 KB only loads inside the app.
 */
type GeoApi = {
  requestPermissions(): Promise<void>;
  getCurrentPosition(
    opts: { enableHighAccuracy: boolean; timeout: number; maximumAge: number },
  ): Promise<GeolocationPosition>;
  watchPosition(
    opts: { enableHighAccuracy: boolean; timeout: number; maximumAge: number },
    cb: (pos: GeolocationPosition | null, err: GeolocationPositionError | null) => void,
  ): Promise<string>;
  clearWatch(args: { id: string }): Promise<void>;
};

/** True only inside a real native container. Cheap: one global check. */
function isNativeShell(): boolean {
  if (typeof window === "undefined") return false;
  const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  try {
    return !!cap && typeof cap.isNativePlatform === "function" && cap.isNativePlatform();
  } catch {
    return false;
  }
}

/** Wrap the browser's callback geolocation in the promise/watch shape above. */
function webGeoApi(): GeoApi {
  return {
    async requestPermissions() {
      // The browser prompts on first use; nothing to request up front.
    },
    getCurrentPosition(opts) {
      return new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
          reject(new Error("Geolocation is not available"));
          return;
        }
        navigator.geolocation.getCurrentPosition(resolve, reject, opts);
      });
    },
    async watchPosition(opts, cb) {
      if (!navigator.geolocation) {
        cb(null, null);
        throw new Error("Geolocation is not available");
      }
      const id = navigator.geolocation.watchPosition(
        (pos) => cb(pos, null),
        (err) => cb(null, err),
        opts,
      );
      return String(id);
    },
    async clearWatch({ id }) {
      navigator.geolocation.clearWatch(Number(id));
    },
  };
}

let geoApiPromise: Promise<GeoApi> | null = null;

/** Resolve once per page. The dynamic import is skipped entirely on the web. */
function getGeoApi(): Promise<GeoApi> {
  if (!geoApiPromise) {
    geoApiPromise = (async () => {
      if (!isNativeShell()) return webGeoApi();
      try {
        const mod = await import("@capacitor/geolocation");
        const G = mod.Geolocation as unknown as GeoApi;
        return G;
      } catch {
        return webGeoApi();
      }
    })();
  }
  return geoApiPromise;
}


/** Uganda's districts — businesses pick their fixed district, customers browse by district. */
/**
 * Every district of Uganda.
 *
 * This used to be a hand-maintained list of 67 names that had drifted well
 * behind the country's administrative map, and it was the sole source of
 * truth for "which district is this point in". A customer in one of the
 * districts it did not name was given a NEIGHBOURING district's name, or a
 * raw coordinate string — the "some places aren't named" complaint.
 *
 * The list now comes from `@/lib/uganda-places`, which is a full gazetteer:
 * every district, plus the cities, towns and Kampala neighbourhoods people
 * actually type, each with coordinates and spelling aliases. It is local, so
 * it works with no network, no Mapbox token and no rate limit.
 */
export const UGANDA_DISTRICTS = DISTRICT_NAMES as readonly string[];

/**
 * The administrative centre of every district, used for GPS → district
 * detection.
 *
 * This used to be a hand-written array of 67 rows that had fallen behind the
 * country's administrative map. Anything it did not name fell through to the
 * NEXT district, so a customer in an unnamed district was told they were
 * somewhere else entirely.
 *
 * It is now derived from the gazetteer, so it can never fall behind: adding a
 * district to `@/lib/uganda-places` adds it here automatically.
 */
const DISTRICT_CENTROIDS: { name: string; lat: number; lng: number }[] = DISTRICT_PLACES.map(
  (d) => ({ name: d.name, lat: d.lat, lng: d.lng }),
);

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
 * Detect which district a GPS point is in.
 *
 * Order of preference:
 *   1. Mapbox's own context (most precise when the token is present).
 *   2. Nominatim's address hierarchy.
 *   3. The LOCAL gazetteer — the nearest known Ugandan place.
 *
 * The third step used to be "nearest of 67 hand-written district centroids",
 * which meant a customer standing in any of the districts that list had
 * fallen behind was given a NEIGHBOURING district's name. The gazetteer knows
 * every district, and it cannot fail because it makes no network call.
 */
export async function detectDistrict(c: LatLng): Promise<string | null> {
  const mapboxToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || "";
  if (mapboxToken) {
    try {
      const res = await fetchTimed(
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${c.lng.toFixed(7)},${c.lat.toFixed(7)}.json?access_token=${mapboxToken}&country=UG&language=en&limit=1`,
        undefined,
        GEO_TIMEOUT_MS,
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
    const res = await fetchTimed(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${c.lat.toFixed(7)}&lon=${c.lng.toFixed(7)}&zoom=10&addressdetails=1`,
      { headers: { "Accept-Language": "en", "User-Agent": "GoDoor/1.0" } },
      GEO_TIMEOUT_MS,
    );
    const json = await res.json();
    if (json?.address) {
      const a = json.address;
      const region = a.state_district || a.county || a.municipality || a.state || a.city || a.town || a.village || "";
      const found = matchDistrictInText(`${region} ${json.display_name || ""}`);
      if (found) return found;
    }
  } catch {}

  // The gazetteer. It knows every district, so this names the district the
  // customer is actually in rather than the nearest one somebody remembered
  // to type into an array.
  const fromGazetteer = districtForPoint(c, 70);
  if (fromGazetteer) return fromGazetteer;

  // Last resort: the raw centroid list, with a wider radius than before.
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
      const res = await fetchTimed(
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${c.lng.toFixed(7)},${c.lat.toFixed(7)}.json?access_token=${mapboxToken}&types=address,neighborhood,locality,place&country=UG&language=en&limit=1`,
        undefined,
        GEO_TIMEOUT_MS,
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
    const res = await fetchTimed(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${c.lat.toFixed(7)}&lon=${c.lng.toFixed(7)}&zoom=18&addressdetails=1`,
      { headers: { "Accept-Language": "en", "User-Agent": "GoDoor/1.0" } },
      GEO_TIMEOUT_MS,
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

  // The gazetteer, before the raw coordinates.
  //
  // This is the step that turns "0.3163°, 32.5822°" into a place a human can
  // read. It used to be skipped entirely: if Mapbox and Nominatim both failed
  // — no token, no network, a timeout — the customer was shown a coordinate
  // string and the complaint was "some places aren't named".
  const gazetteer = gazetteerPlaceName(c);
  if (gazetteer) return gazetteer;

  return fallbackAddress(c);
}

function fallbackAddress(c: LatLng): string {
  /* The gazetteer knows every district and every town in the country, so the
     nearest one is almost always the right answer. If the point is genuinely
     outside anything it knows — a farm on a hill, a vehicle on a highway —
     the district is still better than nothing, and a raw coordinate is the
     honest last resort. */
  const near = nearestUgandaPlace(c, 60);
  if (near) {
    const { place } = near;
    if (place.kind === "district") return `${place.name}, Uganda`;
    if (place.district) return `${place.name}, ${place.district}, Uganda`;
    return `${place.name}, Uganda`;
  }

  // Nothing within 60 km. Name the district from the wider gazetteer anyway.
  const district = districtForPoint(c, 120);
  if (district) return `${district}, Uganda`;

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
  const watchIdRef = useRef<string | null>(null);
  const geoDoneRef = useRef(false);
  const bestAccuracyRef = useRef<number>(Infinity);
  const lastCoordsRef = useRef<LatLng | null>(null);
  const lastHeadingRef = useRef<number | null>(null);
  const addrTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const processPosition = useCallback((pos: GeolocationPosition) => {
    const c = { lat: pos.coords.latitude, lng: pos.coords.longitude };
    const acc = pos.coords.accuracy;
    /* `?? null`, not `|| null`. Heading 0 is due north and is a REAL bearing, but
       `||` threw it away — so a rider travelling north had their heading dropped
       and the map snapped back to north-up mid-journey, which is exactly the
       "markings are wrong, it's alarming" report from the rider side. */
    const newHeading =
      pos.coords.heading != null && Number.isFinite(pos.coords.heading) ? pos.coords.heading : null;
    // Update when the device physically moved (>=10m) or got a better fix,
    // or turned significantly (>25°) so the rider arrow stays truthful.
    const isFirstFix = lastCoordsRef.current === null;
    const movedMeters = lastCoordsRef.current ? (distanceKm(lastCoordsRef.current, c) * 1000) : NaN;
    const moved = !lastCoordsRef.current || movedMeters >= 10;
    /* Shortest arc, not a raw difference: a 359° → 1° turn is 2°, not 358°. With
       the naive form that turn looked like a U-turn, tripped the >90° "real
       instruction" branch in the map's bearing smoother and snapped the map the
       long way round. */
    const turned =
      newHeading != null && lastHeadingRef.current != null &&
      Math.abs(((newHeading - lastHeadingRef.current + 540) % 360) - 180) > 25;
    // Also keep the best fix (lowest accuracy value = most precise)
    if (moved || turned || acc < bestAccuracyRef.current) {
      lastCoordsRef.current = c;
      if (newHeading != null) lastHeadingRef.current = newHeading;
      if (acc < bestAccuracyRef.current) bestAccuracyRef.current = acc;
      setCoords(c);
      setAccuracy(acc);
      setHeading(newHeading);
      setSpeed(pos.coords.speed ?? null);
      setStatus("watching");
      // Debounce reverse geocoding. The FIRST fix is geocoded immediately —
      // waiting 1.5s for the first place name meant the header sat on a bare
      // coordinate for longer than it needed to, and on the cached fast path
      // below that 1.5s is most of the time the customer actually waits.
      if (addrTimerRef.current) clearTimeout(addrTimerRef.current);
      addrTimerRef.current = setTimeout(async () => {
        const addr = await reverseGeocode(c);
        setAddress(addr);
      }, isFirstFix ? 0 : 1500);
    } else if (newHeading != null && newHeading !== lastHeadingRef.current) {
      /* Heading is a direction, not a position — it must not be gated behind
         the 10 m movement test. A rider stopped at a junction (Kampala Road at
         the traffic light) turns the bike 90° without moving a metre; the old
         gate ignored that fix entirely, so the puck pointed down the road they
         had just left while they were waiting to turn. Track heading on its own
         so the heading-up map keeps the road ahead on top. */
      lastHeadingRef.current = newHeading;
      setHeading(newHeading);
    }
  }, []);

  // IP fallback — auto-gets approximate location (≈ city-level) so map and orders never stay blank
  // Users can still refine via "Use my location" or address search for street accuracy
  //
  // These two providers were previously fetched with a bare `fetch()` and no
  // timeout, in sequence. This runs *after* the 10s GPS read has already failed,
  // so a provider that never answered left the user staring at "DETECTING YOUR
  // AREA…" for 10s plus an unbounded wait. Each attempt is now bounded.
  // `ipapi.co` used to be first here, but it now sits behind a Cloudflare
  // "Just a moment..." challenge and answers 403 to every non-browser client
  // (verified: no CORS header, HTML challenge body). It could never succeed,
  // so every user who reached this fallback paid a guaranteed-failed request
  // and a CORS console error before the provider that actually works.
  // `freeipapi` 307-redirects to `free.freeipapi.com`, which serves
  // `access-control-allow-origin: *` and real Uganda coordinates.
  const ipFallback = useCallback(async () => {
    const found = await firstOf<{ lat: number; lng: number }>(
      [
        async () => {
          const r = await fetchTimed("https://freeipapi.com/api/json", undefined, GEO_TIMEOUT_MS);
          const j = await r.json();
          if (j.latitude && j.longitude) return { lat: Number(j.latitude), lng: Number(j.longitude) };
          return null;
        },
        // Backup only. Primary geocoding is Mapbox, which we already hold a
        // token for — reuse it rather than depend on a third-party IP database.
        async () => {
          const r = await fetchTimed("https://ipwho.is/", undefined, GEO_TIMEOUT_MS);
          const j = await r.json();
          if (j.latitude && j.longitude) return { lat: Number(j.latitude), lng: Number(j.longitude) };
          return null;
        },
      ],
      (c) => Number.isFinite(c.lat) && Number.isFinite(c.lng),
      GEO_TIMEOUT_MS,
      "ip geolocation",
    );
    if (!found) return false;

    /* A precise fix may have landed while this lookup was in flight. Never
       replace a real reading with a city-level IP estimate — that would move
       the customer off their actual street to save about a second. Returns
       true either way: "we have a location" is still the answer. */
    if (bestAccuracyRef.current !== Infinity) return true;

    // Uganda bounds check — if IP says outside Uganda, clamp to Kampala fallback
    const inUg = found.lat >= -1.5 && found.lat <= 4.5 && found.lng >= 28 && found.lng <= 36;
    const loc = inUg ? found : { lat: 0.3163, lng: 32.5822 };
    setCoords(loc);
    setAccuracy(5000);
    setStatus("watching");
    // Reverse geocode for display — already bounded, and display-only anyway
    try {
      const addr = await reverseGeocode(loc);
      setAddress(addr);
    } catch {}
    return true;
  }, []);

  const startWatching = useCallback(async () => {
    /* The Capacitor plugin inside the app, navigator.geolocation on the web —
       resolved by getGeoApi(), which only imports the plugin in a native
       shell. In an Android WebView the two are different code paths:
       navigator.geolocation only works if the WebView has a geolocation
       handler, which Capacitor only installs when the plugin is actually used.
       The app declared ACCESS_FINE_LOCATION in the manifest but never
       requested it at runtime, so nothing ever asked Android for the permission
       and the app reported "no location permission". */
    const Geo = await getGeoApi();
    try {
      await Geo.requestPermissions();
    } catch {
      // requestPermissions throws when the permission is already granted or the
      // platform has no such API; either way we can still try to read a fix.
    }

    setStatus("locating");
    setError(null);
    bestAccuracyRef.current = Infinity;

    /* THE IP FALLBACK STARTS HERE, IN PARALLEL — not after the GPS deadline.
       It used to run only once both GPS reads had failed, so the worst case
       was 3s (cached attempt) + 10s (accurate attempt) + the IP round trip
       before the header showed a place at all. Measured live from a real
       browser: the header sat on "Choose your location — Tap to use GPS" for
       4-19 seconds. That is precisely the reported symptom — "location hasn't
       been auto filled, I have to search manually" — when in fact detection
       was running the whole time, just with nothing to show for it.

       The IP estimate normally lands in well under a second, so starting it
       alongside GPS gives the customer a real place almost immediately and
       lets the GPS fix silently refine it a moment later. `ipFallback` refuses
       to overwrite a precise fix, and `processPosition` overwrites the
       estimate the moment a real fix lands (`lastCoordsRef` is untouched by the
       IP path), so accuracy still ends up GPS-driven. IP is now a fast first
       answer rather than a last resort. */
    const ipSettled = ipFallback().catch(() => false);

    try {
      const cached = await withTimeout(
        Geo.getCurrentPosition({
          enableHighAccuracy: false,
          timeout: 3000,
          maximumAge: 5 * 60 * 1000,
        }),
        3000,
        "cached fix",
      );
      processPosition(cached as unknown as GeolocationPosition);
    } catch {
      // No cached fix (first ever visit, or permission not yet answered).
      // Fall through to the accurate read below.
    }

    try {
      // The plugin's `timeout` option is not honoured on every platform, and a
      // permission prompt the user simply never answers makes the promise hang
      // forever. Either way the home screen showed a permanent "Detecting
      // location…". Race it against our own deadline so the UI always moves on.
      const pos = await withTimeout(
        Geo.getCurrentPosition({
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 0,
        }),
        10000,
        "gps fix",
      );
      processPosition(pos as unknown as GeolocationPosition);
    } catch {
      /* Nothing to do here: the IP fallback is already in flight, and whether
         it succeeded is decided below once it settles. */
    }

    /* Only if we ended up with NOTHING — no GPS fix and no usable IP estimate —
       do we say so. This used to only set an error string and leave `status`
       on "locating" forever, so the home screen rendered a permanent
       "Detecting location…". Denied/failed is a definite answer — say so, and
       let the UI fall back to a usable default. */
    const ipOk = await ipSettled;
    if (!ipOk && bestAccuracyRef.current === Infinity) {
      setStatus("denied");
      setError("Location access denied. Tap to retry.");
    }

    try {
      watchIdRef.current = await Geo.watchPosition(
        { enableHighAccuracy: true, timeout: 30000, maximumAge: 0 },
        (pos, err) => {
          if (pos) {
            processPosition(pos as unknown as GeolocationPosition);
            return;
          }
          if (bestAccuracyRef.current === Infinity) {
            setStatus("denied");
            setError(
              err && err.code === 1
                ? "GPS access denied. Enable location services in your browser settings."
                : "GPS error. Tap to retry.",
            );
          }
        },
      );
    } catch {
      // Watch unavailable; the single read above still gives a position.
    }
  }, [processPosition, ipFallback]);

  useEffect(() => {
    return () => {
      // Only clear a watch we actually started; the API resolves lazily, so a
      // watch id can outlive an unmount that happened before getGeoApi() settled.
      if (watchIdRef.current != null) {
        void getGeoApi().then((Geo) => Geo.clearWatch({ id: watchIdRef.current! })).catch(() => {});
        watchIdRef.current = null;
      }
      if (addrTimerRef.current) clearTimeout(addrTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (geoDoneRef.current) return;
    geoDoneRef.current = true;
    startWatching();
  }, [startWatching]);

  const refresh = useCallback(async () => {
    if (watchIdRef.current != null) {
      try { await (await getGeoApi()).clearWatch({ id: watchIdRef.current }); } catch {}
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


/**
 * Address search for the location picker.
 *
 * ── What was broken ────────────────────────────────────────────────────────
 * This called Mapbox and NOTHING else. So the suggestion list was:
 *
 *   • EMPTY whenever there was no `NEXT_PUBLIC_MAPBOX_TOKEN`;
 *   • EMPTY whenever Mapbox was slow, rate-limited or down;
 *   • EMPTY for any place Mapbox did not have — and Mapbox's Uganda coverage
 *     is good for streets and cities but thin for the smaller towns and
 *     sub-county centres where the boda riders actually pick up from.
 *
 * A rider typing "Nansana", "Kawempe" or "Buhweju" was shown an empty list,
 * and the complaint was literally "some places aren't named".
 *
 * ── What it does now ───────────────────────────────────────────────────────
 * The LOCAL gazetteer is searched first and its hits are returned first, then
 * Mapbox's street-level results are appended. So:
 *
 *   • a typed place ALWAYS matches, online or not;
 *   • a street address still wins for precision, because it is listed second
 *     and the user picks it deliberately;
 *   • the result is never empty for a place GoDoor knows about.
 */
export function fetchPlaceSuggestions(
  query: string,
): Promise<{ place: string; lat: number; lng: number }[]> {
  const trimmed = query.trim();
  if (!trimmed) return Promise.resolve([]);

  // 1. The gazetteer. Local, instant, and it cannot fail.
  const local = searchUgandaPlaces(trimmed, 6).map((p) => ({
    place: p.district && p.district !== p.name ? `${p.name}, ${p.district}` : p.name,
    lat: p.lat,
    lng: p.lng,
  }));

  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || "";
  if (!token) return Promise.resolve(local);

  // 2. Mapbox, for the street-level detail the gazetteer cannot have.
  return fetchTimed(
    `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(trimmed)}.json?access_token=${token}&country=UG&language=en&types=address,neighborhood,locality,place&limit=6`,
    undefined,
    GEO_TIMEOUT_MS,
  )
    .then((r) => r.json())
    .then((json) => {
      const remote: { place: string; lat: number; lng: number }[] = (
        json.features || []
      ).map((f: { place_name: string; center: number[] }) => ({
        place: f.place_name,
        lat: f.center[1],
        lng: f.center[0],
      }));
      // The gazetteer first, then anything Mapbox found that we do not
      // already have — a street result for "Kawempe Road" is worth keeping
      // even though "Kawempe" is already on the list.
      const seen = new Set(local.map((l) => l.place.toLowerCase()));
      const merged = [...local];
      for (const r of remote) {
        const key = r.place.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        merged.push(r);
      }
      return merged.slice(0, 10);
    })
    .catch(() => local);
}
