"use client";

import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import type { LatLng } from "@/lib/location";
import { useThemeStore } from "@/lib/theme-store";
import "mapbox-gl/dist/mapbox-gl.css";

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || "";

const KAMPALA_DEFAULT: LatLng = { lat: 0.3163, lng: 32.5822 };
const DARK_STYLE = "mapbox://styles/mapbox/dark-v11";
const LIGHT_STYLE = "mapbox://styles/mapbox/streets-v12";

type Padding = { top: number; bottom: number; left: number; right: number };

/** A (0,0) coordinate is invalid — treat as "unknown" and use Kampala default instead. */
function validCenter(c: LatLng): LatLng {
  return Math.abs(c.lat) <= 1e-9 && Math.abs(c.lng) <= 1e-9 ? KAMPALA_DEFAULT : c;
}

export type MarkerData = {
  id: string;
  position: LatLng;
  label?: string;
  color?: string;
  isRider?: boolean;
  isDestination?: boolean;
  isPickup?: boolean;
  heading?: number | null;
};

type Props = {
  center: LatLng;
  markers?: MarkerData[];
  onMapClick?: (c: LatLng) => void;
  zoom?: number;
  height?: number;
  className?: string;
  fillHeight?: boolean;
  animatedRider?: LatLng;
  route?: LatLng[];
  fitBounds?: LatLng[];
  fitPadding?: Padding;
  userLocation?: LatLng | null;
};

/* ─── Branded GoDoor pin markers ──────────────────────────────
   Each marker is a teardrop pin whose sharp tip IS the location
   point (anchor: "bottom"), so the pin sits exactly on its
   coordinate. Icons: shop = shopping bag, customer = GoDoor logo
   door, rider = motorbike silhouette + heading chevron. */

let pinUid = 0;
function nextPinId(): string { pinUid += 1; return `p${pinUid}`; }

/** The EXACT GoDoor logo door (from public/favicon.svg / Logo.tsx) — orange
    frame, lighter inner panel, dark knob with an orange dot, and the open 3D
    side panel — fitted into the pin-badge circle (scale 0.38, centred on the
    badge). Used on the customer/delivery pin and default markers so the map
    carries the real brand mark. */
function doorMark(): string {
  return `
    <rect x="7.82" y="3.66" width="5.7" height="9.88" rx="0.95" fill="#f15a22"/>
    <rect x="8.39" y="4.23" width="4.56" height="8.74" rx="0.57" fill="#ff7a3d"/>
    <circle cx="12.38" cy="8.6" r="0.61" fill="#0b0712"/>
    <circle cx="12.38" cy="8.6" r="0.3" fill="#ff7a3d" opacity="0.4"/>
    <path d="M13.52 3.66L16.18 4.61V12.59L13.52 13.54V3.66Z" fill="#c13e10"/>
    <path d="M14.09 4.23L15.61 4.99V12.21L14.09 12.97V4.23Z" fill="#d94e18"/>
    <circle cx="14.09" cy="8.6" r="0.38" fill="#ff7a3d" opacity="0.3"/>
  `;
}

function bagMark(): string {
  return `
    <path d="M7 9.4h10l-0.85 7a1.4 1.4 0 0 1-1.38 1.2H9.23a1.4 1.4 0 0 1-1.38-1.2l-0.85-7z" fill="#fff"/>
    <path d="M9.4 8.7V7.1a2.6 2.6 0 0 1 5.2 0v1.6" stroke="#fff" stroke-width="1.5" fill="none" stroke-linecap="round"/>
    <path d="M8.1 13.6l-1.2-1.5m10.2 1.5l1.2-1.5" stroke="#fff" stroke-width="1.2" stroke-linecap="round" opacity="0.7"/>
  `;
}

function riderMark(): string {
  return `
    <circle cx="8.9" cy="6.9" r="1.85" fill="#fff"/>
    <circle cx="8.9" cy="6.9" r="0.65" fill="rgba(255,255,255,0.35)"/>
    <path d="M6.5 10.2a2.5 2.5 0 0 1 4.9 0v1H6.5z" fill="#fff"/>
    <path d="M11.6 10.8h2.2l2.3-1.6" stroke="#fff" stroke-width="1" fill="none" stroke-linecap="round"/>
    <path d="M10.2 11.1h3.8" stroke="#fff" stroke-width="0.95" stroke-linecap="round"/>
    <circle cx="6.7" cy="13.4" r="1.75" fill="rgba(255,255,255,0.4)" stroke="#fff" stroke-width="0.9"/>
    <circle cx="14.7" cy="13.4" r="1.75" fill="rgba(255,255,255,0.4)" stroke="#fff" stroke-width="0.9"/>
  `;
}

function pinSvg(opts: { size: number; light: string; dark: string; icon: string; id: string; shape?: "teardrop" | "storefront" }): string {
  const body =
    opts.shape === "storefront"
      ? `<path d="M4 2a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v18H4z" fill="url(#${opts.id})" stroke="#fff" stroke-width="1.7"/>
         <rect x="4" y="5.5" width="16" height="2.4" rx="1.2" fill="rgba(255,255,255,0.35)"/>
         <path d="M8.6 20l3.4 9 3.4-9z" fill="url(#${opts.id})" stroke="#fff" stroke-width="1.4"/>`
      : `<path d="M12 1C6.48 1 2 5.48 2 11c0 7.5 10 18 10 18s10-10.5 10-18c0-5.52-4.48-10-10-10z" fill="url(#${opts.id})" stroke="#fff" stroke-width="1.7"/>
         <ellipse cx="12" cy="8" rx="6" ry="3.4" fill="rgba(255,255,255,0.28)"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${opts.size}" height="${Math.round(opts.size * 1.28)}" viewBox="0 0 24 30" fill="none" style="display:block;filter:drop-shadow(0 4px 3px rgba(0,0,0,0.35))">
    <defs>
      <linearGradient id="${opts.id}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${opts.light}"/>
        <stop offset="100%" stop-color="${opts.dark}"/>
      </linearGradient>
    </defs>
    ${body}
    ${opts.icon}
  </svg>`;
}

/** Neutral fallback marker (a plain location dot) — so an untagged marker can
    NEVER be mistaken for the delivery-door or the shop. */
function defaultMark(): string {
  return `<circle cx="12" cy="9.5" r="4.4" fill="#fff" opacity="0.96"/>
          <circle cx="12" cy="9.5" r="2" fill="rgba(0,0,0,0.22)"/>`;
}

function createMarkerElement(m: MarkerData): HTMLDivElement {
  const el = document.createElement("div");
  const isRider = m.isRider;
  const isPickup = m.isPickup;
  const isDest = m.isDestination;

  let size = 44;
  let light = "#f97316";
  let dark = "#ea580c";
  let icon = doorMark();
  let shape: "teardrop" | "storefront" = "teardrop";

  if (isPickup) {
    size = 47;
    light = "#f97316"; dark = "#ea580c";
    icon = bagMark();
    shape = "storefront";
  } else if (isDest) {
    size = 48;
    light = "#22c55e"; dark = "#16a34a";
    icon = doorMark();
  } else if (isRider) {
    size = 52;
    light = "#f97316"; dark = "#ea580c";
    icon = riderMark();
  } else {
    size = 42;
    light = "#6b7280"; dark = "#4b5563";
    icon = defaultMark();
  }

  const height = Math.round(size * 1.28);
  const pinId = nextPinId();
  const svg = pinSvg({ size, light, dark, icon, id: pinId, shape });

  el.style.cssText = `
    width: ${size}px;
    height: ${height}px;
    display: block;
    background: transparent;
    cursor: pointer;
    position: relative;
    transform-origin: 50% 100%;
    transition: transform 0.15s cubic-bezier(0.34,1.56,0.64,1);
  `;
  el.innerHTML = svg;

  /* Soft ground shadow centred exactly on the tip (= the coordinate) */
  const shadow = document.createElement("div");
  shadow.style.cssText = `
    position: absolute;
    bottom: 0;
    left: 50%;
    transform: translate(-50%, 50%);
    width: ${Math.round(size * 0.5)}px;
    height: 8px;
    border-radius: 50%;
    background: radial-gradient(ellipse at center, rgba(0,0,0,0.45) 0%, rgba(0,0,0,0) 70%);
    pointer-events: none;
  `;
  el.appendChild(shadow);

  /* Pulsing ring: destination (always) + rider (live) */
  if (isDest || isRider) {
    const pulse = document.createElement("div");
    pulse.style.cssText = `
      position: absolute;
      left: 50%;
      top: ${Math.round(size * 0.1)}px;
      width: ${Math.round(size * 0.86)}px;
      height: ${Math.round(size * 0.86)}px;
      transform: translateX(-50%);
      border-radius: 50%;
      border: 2.5px solid ${dark};
      opacity: 0.8;
      animation: marker-ring-pulse ${isRider ? "1.8s" : "2.6s"} ease-in-out infinite;
      pointer-events: none;
    `;
    el.appendChild(pulse);
  }

  /* Heading chevron — rotates to the rider's bearing around the pin */
  if (isRider && m.heading != null && Number.isFinite(m.heading)) {
    const arrow = document.createElement("div");
    arrow.style.cssText = `
      position: absolute;
      left: 50%;
      top: -8px;
      width: 22px;
      height: 22px;
      transform: translateX(-50%) rotate(${m.heading}deg);
      filter: drop-shadow(0 2px 2px rgba(0,0,0,0.4));
      pointer-events: none;
      z-index: 1;
    `;
    arrow.innerHTML = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M12 2l7 10h-4v8h-6v-8H5z" fill="#ea580c" stroke="#ffffff" stroke-width="1.4" stroke-linejoin="round"/></svg>`;
    el.appendChild(arrow);
    (el as any).__gdrArrow = arrow;
  }

  /* Always-visible label chip under the pin */
  if (m.label && (isPickup || isDest || isRider)) {
    const chip = document.createElement("div");
    chip.textContent = m.label;
    chip.style.cssText = `
      position: absolute;
      left: 50%;
      top: ${Math.round(size * 0.66)}px;
      transform: translateX(-50%);
      background: rgba(255,255,255,0.95);
      color: #1a1128;
      border-radius: 999px;
      padding: 2px 8px;
      font-family: Inter, system-ui, sans-serif;
      font-size: 10px;
      font-weight: 600;
      letter-spacing: 0.01em;
      box-shadow: 0 2px 8px rgba(0,0,0,0.28);
      white-space: nowrap;
      max-width: 130px;
      overflow: hidden;
      text-overflow: ellipsis;
      pointer-events: none;
      z-index: 2;
    `;
    el.appendChild(chip);
  }

  el.addEventListener("mouseenter", () => { el.style.transform = "scale(1.18)"; });
  el.addEventListener("mouseleave", () => { el.style.transform = "scale(1)"; });

  return el;
}

/* Linear interpolation helpers for the animated route dot */
function lerpCoord(pts: LatLng[], d: number): LatLng {
  if (pts.length === 1) return pts[0];
  const seg = Math.max(0.00001, 1 / (pts.length - 1));
  let i = Math.min(pts.length - 2, Math.floor(d / seg));
  const t = Math.min(1, (d - i * seg) / seg);
  const a = pts[i], b = pts[i + 1];
  return { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t };
}

function MapboxMapInner({
  center, markers = [], onMapClick, zoom = 14, height = 300, fillHeight = false,
  className, userLocation, onError, fitBounds, fitPadding: outerPadding, route,
}: Props & { onError?: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markersRef = useRef<Map<string, any>>(new Map());
  const userMarkerRef = useRef<any>(null);
  const dotMarkerRef = useRef<any>(null);
  const animFrameRef = useRef<number | null>(null);
  const userMovedRef = useRef(false);
  const lastCenterRef = useRef<{ lat: number; lng: number } | null>(null);
  const readyRef = useRef(false);
  const styleAppliedRef = useRef<boolean | null>(null);
  const [ready, setReady] = useState(false);
  const [userMoved, setUserMoved] = useState(false);

  const boxH: string | number = fillHeight ? "100%" : height;

  const theme = useThemeStore((s) => s.theme);
  const isDark = theme === "dark" || (theme === "system" && typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  const baseStyle = isDark ? DARK_STYLE : LIGHT_STYLE;

  const fitPadding: Padding = outerPadding || { top: 96, bottom: 88, left: 56, right: 56 };

  const markUserMoved = useCallback(() => { userMovedRef.current = true; setUserMoved(true); }, []);
  const isUserMoved = () => userMovedRef.current;

  /* ── Decorate a (fresh) style: terrain, sky, buildings, route line ── */
  const decorate = useCallback((map: any) => {
    try {
      if (!map.getSource("mapbox-dem")) {
        map.addSource("mapbox-dem", { type: "raster-dem", url: "mapbox://mapbox.mapbox-terrain-dem-v1", tileSize: 512, maxzoom: 14 });
      }
      map.setTerrain({ source: "mapbox-dem", exaggeration: 0.5 });
      if (!map.getLayer("sky")) map.addLayer({ id: "sky", type: "sky", paint: { "sky-type": "atmosphere", "sky-atmosphere-sun": [0.0, 0.0], "sky-atmosphere-sun-intensity": 15 } });
      if (!map.getLayer("3d-buildings")) {
        const layers = map.getStyle().layers;
        const labelLayerId = layers?.find((l: any) => l.type === "symbol" && l.layout?.["text-field"])?.id;
        map.addLayer({
          id: "3d-buildings",
          source: "composite",
          "source-layer": "building",
          type: "fill-extrusion",
          minzoom: 14,
          paint: {
            "fill-extrusion-color": ["interpolate", ["linear"], ["get", "height"], 0, isDark ? "#2a2136" : "#f0ebe4", 50, isDark ? "#2c2338" : "#e6dfd6", 100, isDark ? "#241b2f" : "#d9d0c4"],
            "fill-extrusion-height": ["get", "height"],
            "fill-extrusion-base": ["get", "min_height"],
            "fill-extrusion-opacity": isDark ? 0.7 : 0.5,
          },
        }, labelLayerId);
      }
    } catch {}
  }, [isDark]);

  /* ── Draw the delivery route polyline ── */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const pts = (route || []).filter((p) => p && (Math.abs(p.lat) > 1e-9 || Math.abs(p.lng) > 1e-9));
    try {
      if (!map.getSource("gdr-route")) {
        map.addSource("gdr-route", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        map.addLayer({
          id: "gdr-route-line",
          type: "line",
          source: "gdr-route",
          layout: { "line-cap": "round", "line-join": "round" },
          paint: {
            "line-width": ["interpolate", ["linear"], ["zoom"], 11, 4.5, 16, 8],
            "line-color": ["interpolate", ["linear"], ["line-progress"], 0, "#c13e10", 1, "#f15a22"],
            "line-opacity": 1,
          },
        });
        map.addLayer({
          id: "gdr-route-casing",
          type: "line",
          source: "gdr-route",
          layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-width": ["interpolate", ["linear"], ["zoom"], 11, 9, 16, 15], "line-color": "#7a2305", "line-opacity": 0.95 },
        });
        map.addLayer({
          id: "gdr-route-glow",
          type: "line",
          source: "gdr-route",
          layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-width": ["interpolate", ["linear"], ["zoom"], 11, 13, 16, 21], "line-color": "rgba(193,62,16,0.35)", "line-opacity": 1 },
        });
        map.addLayer({
          id: "gdr-route-arrows",
          type: "symbol",
          source: "gdr-route",
          layout: {
            "symbol-placement": "line",
            "text-field": "▶",
            "text-size": ["interpolate", ["linear"], ["zoom"], 11, 14, 16, 22],
            "symbol-spacing": ["interpolate", ["linear"], ["zoom"], 11, 60, 16, 140],
            "text-keep-upright": false,
            "text-rotation-alignment": "map",
          },
          paint: {
            "text-color": "#ffd9c4",
            "text-halo-color": "#7a2305",
            "text-halo-width": 2,
            "text-opacity": 0.95,
          },
        });
      }
      if (pts.length >= 2) {
        map.getSource("gdr-route").setData({ type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: pts.map((p) => [p.lng, p.lat]) } }] });
        try { map.moveLayer("gdr-route-glow"); } catch {}
        map.moveLayer("gdr-route-casing");
        map.moveLayer("gdr-route-line");
        try { map.moveLayer("gdr-route-arrows"); } catch {}
      } else {
        map.getSource("gdr-route").setData({ type: "FeatureCollection", features: [] });
      }
    } catch {}
  }, [ready, route]);

  /* ── Animated "delivery in motion" dot along the route (when no live rider pin) ── */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const hasLiveRider = markers.some((m) => m.isRider);
    const pts = (route || []).filter((p) => p && (Math.abs(p.lat) > 1e-9 || Math.abs(p.lng) > 1e-9));
    let cancelled = false;

    if (hasLiveRider || pts.length < 2) {
      if (dotMarkerRef.current) { try { dotMarkerRef.current.remove(); } catch {} dotMarkerRef.current = null; }
      return () => { cancelled = true; if (animFrameRef.current != null) cancelAnimationFrame(animFrameRef.current); };
    }

    import("mapbox-gl").then((mapboxgl) => {
      if (cancelled || !map) return;
      if (!dotMarkerRef.current) {
        const el = document.createElement("div");
        const inner = document.createElement("div");
        el.style.cssText = "width:22px;height:22px;";
        inner.style.cssText = `width:22px;height:22px;border-radius:50%;background:#ea580c;border:3px solid #fff;box-shadow:0 0 0 5px rgba(234,88,12,0.25), 0 4px 10px rgba(0,0,0,0.35);`;
        el.appendChild(inner);
        dotMarkerRef.current = new mapboxgl.default.Marker({ element: el, anchor: "center" }).setLngLat([pts[0].lng, pts[0].lat]).addTo(map);
      }
      const dur = 4000;
      const start = performance.now();
      const loop = (t: number) => {
        if (cancelled || !map || !dotMarkerRef.current) return;
        const p = ((t - start) % dur) / dur;
        const c = lerpCoord(pts, p);
        dotMarkerRef.current.setLngLat([c.lng, c.lat]);
        animFrameRef.current = requestAnimationFrame(loop);
      };
      animFrameRef.current = requestAnimationFrame(loop);
    }).catch(() => {});

    return () => { cancelled = true; if (animFrameRef.current != null) cancelAnimationFrame(animFrameRef.current); };
  }, [ready, route, markers]);

  /* ── Initialize map ── */
  useEffect(() => {
    if (!containerRef.current || !MAPBOX_TOKEN || mapRef.current) return;

    let mapInstance: any = null;

    import("mapbox-gl").then((mapboxgl) => {
      if (!containerRef.current || mapRef.current) return;
      mapboxgl.default.accessToken = MAPBOX_TOKEN;

      mapInstance = new mapboxgl.default.Map({
        container: containerRef.current,
        style: baseStyle,
        center: [validCenter(center).lng, validCenter(center).lat],
        zoom,
        pitch: 35,
        bearing: 0,
        attributionControl: false,
        interactive: true,
      });
      styleAppliedRef.current = isDark;

      const onStyleLoad = () => {
        try { decorate(mapInstance); } catch {}
      };
      mapInstance.on("style.load", onStyleLoad);
      mapInstance.on("load", () => {
        readyRef.current = true;
        setReady(true);
        decorate(mapInstance);
      });

      mapInstance.addControl(new mapboxgl.default.AttributionControl({ compact: true }), "bottom-right");
      mapInstance.addControl(new mapboxgl.default.ScaleControl({ maxWidth: 80, unit: "metric" }), "bottom-left");

      ["dragstart", "zoomstart", "pitchstart", "rotatestart"].forEach((evt) =>
        mapInstance.on(evt, markUserMoved)
      );

      if (onMapClick) {
        mapInstance.on("click", (e: any) => onMapClick({ lat: e.lngLat.lat, lng: e.lngLat.lng }));
      }
      mapInstance.on("error", () => {
        if (!readyRef.current) onError?.();
      });
      mapRef.current = mapInstance;
    }).catch(() => onError?.());

    return () => {
      if (animFrameRef.current != null) cancelAnimationFrame(animFrameRef.current);
      if (mapInstance) { try { mapInstance.remove(); } catch {} }
      mapRef.current = null;
      readyRef.current = false;
      styleAppliedRef.current = null;
      setReady(false);
      userMovedRef.current = false;
      lastCenterRef.current = null;
    };
  }, [MAPBOX_TOKEN, markUserMoved]); // eslint-disable-line

  /* ── Swap the base style when the app theme flips ── */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    if (styleAppliedRef.current === isDark) return;
    styleAppliedRef.current = isDark;
    try { map.setStyle(baseStyle); } catch {}
  }, [isDark, baseStyle, ready]);

  const fitKey = useMemo(
    () => (fitBounds || []).map((p) => p ? `${p.lat.toFixed(4)}:${p.lng.toFixed(4)}` : "x").join("|"),
    [fitBounds]
  );

  const applyFocus = useCallback(() => {
    if (!mapRef.current || !ready) return;
    try {
      const pts = (fitBounds || []).filter((p) => p && (Math.abs(p.lat) > 1e-9 || Math.abs(p.lng) > 1e-9));
      if (pts.length >= 2) {
        const lats = pts.map((p) => p.lat);
        const lngs = pts.map((p) => p.lng);
        mapRef.current.fitBounds(
          [Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)],
          { padding: fitPadding, duration: 900, maxZoom: 15.5 }
        );
      } else {
        const c = validCenter(center);
        mapRef.current.flyTo({ center: [c.lng, c.lat], zoom, pitch: 35, bearing: 0, duration: 900 });
      }
      lastCenterRef.current = { lat: center.lat, lng: center.lng };
    } catch {}
  }, [ready, fitKey, center.lat, center.lng, zoom, fitPadding]); // eslint-disable-line

  useEffect(() => {
    if (!mapRef.current || !ready) return;
    applyFocus();
  }, [ready, applyFocus]);

  /* ── Follow the delivery only while the user hasn't moved the map ── */
  useEffect(() => {
    if (!mapRef.current || !ready || isUserMoved()) return;
    const c = validCenter(center);
    const last = lastCenterRef.current;
    const movedKm = last
      ? Math.hypot((c.lat - last.lat) * 111, (c.lng - last.lng) * 111 * Math.cos((c.lat * Math.PI) / 180))
      : Infinity;
    if (movedKm < 0.5) return;
    lastCenterRef.current = c;
    try {
      mapRef.current.flyTo({ center: [c.lng, c.lat], zoom, pitch: 35, bearing: 0, duration: 1000 });
    } catch {}
  }, [center.lat, center.lng, zoom, ready]); // eslint-disable-line

  useEffect(() => {
    if (!mapRef.current || !ready || isUserMoved()) return;
    const pts = (fitBounds || []).filter((p) => p && (Math.abs(p.lat) > 1e-9 || Math.abs(p.lng) > 1e-9));
    if (pts.length < 2) return;
    try {
      const lats = pts.map((p) => p.lat);
      const lngs = pts.map((p) => p.lng);
      mapRef.current.fitBounds(
        [Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)],
        { padding: fitPadding, duration: 900, maxZoom: 15.5 }
      );
    } catch {}
  }, [fitKey, ready]); // eslint-disable-line

  const recenter = useCallback(() => {
    userMovedRef.current = false;
    setUserMoved(false);
    applyFocus();
  }, [applyFocus]);

  const zoomBy = useCallback((delta: number) => {
    const map = mapRef.current;
    if (!map) return;
    try { map.zoomTo(map.getZoom() + delta, { duration: 300 }); } catch {}
  }, []);

  const markerKey = useMemo(
    () => markers.map((m) => `${m.id}:${m.position?.lat?.toFixed(5) ?? "x"}:${m.position?.lng?.toFixed(5) ?? "x"}:${m.isRider}:${m.isPickup}:${m.isDestination}:${m.heading ?? "h"}`).join("|"),
    [markers]
  );

  useEffect(() => {
    if (!mapRef.current || !ready) return;
    let cancelled = false;

    import("mapbox-gl").then((mapboxgl) => {
      if (cancelled || !mapRef.current) return;
      const map = mapRef.current;

      const currentIds = new Set(markers.map((m) => m.id));
      markersRef.current.forEach((marker, id) => {
        if (!currentIds.has(id)) {
          marker.remove();
          markersRef.current.delete(id);
        }
      });

      markers.forEach((m) => {
        if (!m?.position || Math.abs(m.position.lat) <= 1e-9 && Math.abs(m.position.lng) <= 1e-9) return;
        if (markersRef.current.has(m.id)) {
          markersRef.current.get(m.id).setLngLat([m.position.lng, m.position.lat]);
          const arrowEl = (markersRef.current.get(m.id)?.getElement() as any)?.__gdrArrow;
          if (arrowEl && m.heading != null && Number.isFinite(m.heading)) {
            arrowEl.style.transform = `translateX(-50%) rotate(${m.heading}deg)`;
          }
        } else {
          const el = createMarkerElement(m);
          const marker = new mapboxgl.default.Marker({ element: el, anchor: "bottom" })
            .setLngLat([m.position.lng, m.position.lat])
            .addTo(map);
          if (m.label) {
            marker.setPopup(
              new mapboxgl.default.Popup({ offset: 24, closeButton: false, className: "go-door-popup" })
                .setHTML(`<div style="padding:5px 12px;border-radius:10px;font-size:11px;font-weight:600;font-family:Inter,sans-serif;white-space:nowrap">${m.label}</div>`)
            );
          }
          markersRef.current.set(m.id, marker);
        }
      });
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [markerKey, ready]); // eslint-disable-line

  /* ── User location pulsing dot ── */
  useEffect(() => {
    if (!mapRef.current || !userLocation || !ready) return;
    import("mapbox-gl").then((mapboxgl) => {
      const map = mapRef.current;
      if (!map) return;
      if (userMarkerRef.current) {
        userMarkerRef.current.setLngLat([userLocation.lng, userLocation.lat]);
      } else {
        const el = document.createElement("div");
        el.style.cssText = `
          width: 26px; height: 26px; border-radius: 50%;
          background: #f15a22; border: 3px solid #fff;
          box-shadow: 0 0 0 6px rgba(241,90,34,0.3), 0 4px 12px rgba(0,0,0,0.35);
          animation: marker-ring-pulse 2.5s ease-in-out infinite;
          position: relative;
        `;
        const dot = document.createElement("div");
        dot.style.cssText = "width:9px;height:9px;border-radius:50%;background:#fff;position:absolute;top:50%;left:50%;transform:translate(-50%,-50%)";
        el.appendChild(dot);
        userMarkerRef.current = new mapboxgl.default.Marker({ element: el, anchor: "center" })
          .setLngLat([userLocation.lng, userLocation.lat])
          .addTo(map);
      }
    }).catch(() => {});
  }, [userLocation?.lat, userLocation?.lng, ready]); // eslint-disable-line

  if (!MAPBOX_TOKEN) {
    return (
      <div style={{ height: boxH, background: "#f5f2ed", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <p style={{ color: "#6b6180", fontSize: 12 }}>Map unavailable — no API key</p>
      </div>
    );
  }

  return (
    <>
      <style>{`
        .go-door-popup .mapboxgl-popup-content {
          border-radius: 12px !important;
          padding: 0 !important;
          box-shadow: 0 8px 24px rgba(0,0,0,0.28) !important;
          background: #ffffff !important;
          color: #1a1128 !important;
          border: 1px solid rgba(0,0,0,0.06) !important;
        }
        [data-theme="dark"] .go-door-popup .mapboxgl-popup-content {
          background: #14101c !important;
          color: #f7f4fb !important;
          border: 1px solid rgba(255,255,255,0.08) !important;
        }
        .go-door-popup .mapboxgl-popup-tip {
          border-top-color: #ffffff !important;
          border-bottom-color: #ffffff !important;
        }
        [data-theme="dark"] .go-door-popup .mapboxgl-popup-tip {
          border-top-color: #14101c !important;
          border-bottom-color: #14101c !important;
        }
      `}</style>
      <div style={{ position: "relative", height: boxH, width: "100%" }}>
        <div ref={containerRef} style={{ height: boxH, width: "100%" }} className={className} />
        {ready && (
          <div style={{ position: "absolute", right: 10, bottom: 18, zIndex: 10, display: "flex", flexDirection: "column", gap: 8 }}>
            <button type="button" onClick={() => zoomBy(1)} aria-label="Zoom in" title="Zoom in"
              style={{ width: 38, height: 38, borderRadius: 12, cursor: "pointer", background: "var(--color-surface)", border: "1px solid var(--color-border)", boxShadow: "0 2px 10px rgba(0,0,0,0.25)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--color-fg)", transition: "transform 0.1s ease" }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
            </button>
            <button type="button" onClick={() => zoomBy(-1)} aria-label="Zoom out" title="Zoom out"
              style={{ width: 38, height: 38, borderRadius: 12, cursor: "pointer", background: "var(--color-surface)", border: "1px solid var(--color-border)", boxShadow: "0 2px 10px rgba(0,0,0,0.25)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--color-fg)", transition: "transform 0.1s ease" }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M5 12h14" /></svg>
            </button>
            {userMoved && (
              <button type="button" onClick={recenter} aria-label="Re-centre map" title="Re-centre on delivery"
                style={{ width: 38, height: 38, borderRadius: 12, cursor: "pointer", background: "var(--color-surface)", border: "1px solid var(--color-border)", boxShadow: "0 2px 10px rgba(0,0,0,0.25)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--color-go)" }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="7" />
                  <path d="M12 9V7M12 17v-2M9 12H7M17 12h-2M12 2v2M12 20v2" />
                </svg>
              </button>
            )}
          </div>
        )}
      </div>
    </>
  );
}

export default function MapboxMap(props: Props) {
  const [error, setError] = useState(false);
  const boxH: string | number = props.fillHeight ? "100%" : props.height || 300;
  if (error) {
    return (
      <div style={{ height: boxH, background: "var(--color-surface)", display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 16 }}>
        <p style={{ color: "var(--color-muted)", fontSize: 12, textAlign: "center", padding: "0 16px" }}>Map unavailable — check connection</p>
      </div>
    );
  }
  try {
    return (
      <div style={{ borderRadius: 16, overflow: "hidden", height: props.fillHeight ? "100%" : undefined }}>
        <MapboxMapInner {...props} onError={() => setError(true)} />
      </div>
    );
  } catch {
    return (
      <div style={{ height: boxH, background: "var(--color-surface)", display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 16 }}>
        <p style={{ color: "var(--color-muted)", fontSize: 12 }}>Map failed to render</p>
      </div>
    );
  }
}