"use client";

import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import type { LatLng } from "@/lib/location";
import { useThemeStore } from "@/lib/theme-store";
import { maneuverGlyph } from "@/lib/routing";
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

/** GeoJSON polygon approximating a circle of `metres` around a point. */
function accuracyCircleFeature(lat: number, lng: number, metres: number) {
  const ring: [number, number][] = [];
  const steps = 64;
  for (let i = 0; i <= steps; i++) {
    const bearing = (i / steps) * Math.PI * 2;
    const dLat = (metres * Math.cos(bearing)) / 111_320;
    const dLng = (metres * Math.sin(bearing)) / (111_320 * Math.cos((lat * Math.PI) / 180));
    ring.push([lng + dLng, lat + dLat]);
  }
  return {
    type: "FeatureCollection" as const,
    features: [{
      type: "Feature" as const,
      properties: {},
      geometry: { type: "Polygon" as const, coordinates: [ring] },
    }],
  };
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
  /** Reported GPS fix radius in metres. Only the rider marker draws a halo. */
  accuracy?: number | null;
};

/** A turn-by-turn instruction pinned to a point on the route. */
export type ManeuverMarker = {
  type: string;
  instruction: string;
  position: LatLng;
};

/** Build a navigation-badge element for one maneuver. */
function createManeuverElement(m: ManeuverMarker): HTMLDivElement {
  const el = document.createElement("div");
  const isArrive = m.type === "arrive";
  const size = isArrive ? 30 : 26;
  el.style.cssText = `
    width: ${size}px;
    height: ${size}px;
    display: grid;
    place-items: center;
    border-radius: 50%;
    background: #ffffff;
    border: 2px solid ${isArrive ? "#16a34a" : "#0f172a"};
    color: ${isArrive ? "#16a34a" : "#0f172a"};
    font-family: Inter, system-ui, sans-serif;
    font-size: ${isArrive ? 13 : 14}px;
    font-weight: 800;
    line-height: 1;
    box-shadow: 0 2px 8px rgba(0,0,0,0.3);
    cursor: pointer;
  `;
  /* A turn arrow beats a bare number at map scale — the shape tells you what
     the move is before you have read a word. The step number and full text live
     in the next-turn banner. */
  el.textContent = maneuverGlyph(m.type);
  el.title = m.instruction;
  el.setAttribute("aria-label", m.instruction);
  return el;
}

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
  /** Turn-by-turn points along `route`, drawn as numbered navigation badges. */
  maneuvers?: ManeuverMarker[];
  /** Per-segment congestion (Mapbox 0-4), length = route.length - 1. Paints the
      route line by traffic level; ignored when absent or the wrong length. */
  congestion?: number[] | null;
  fitBounds?: LatLng[];
  fitPadding?: Padding;
  userLocation?: LatLng | null;
  /** Radius (metres) of the reported GPS fix — drawn as a halo around the
      user dot so people can see how precise "you are here" really is. */
  userAccuracy?: number | null;
};

/* ─── Branded GoDoor pin markers ──────────────────────────────
   Each marker is a teardrop pin whose sharp tip IS the location
   point (anchor: "bottom"), so the pin sits exactly on its
   coordinate. Icons: shop = shopping bag, customer = GoDoor logo
   door, rider = motorbike silhouette + heading chevron. */

let pinUid = 0;
function nextPinId(): string { pinUid += 1; return `p${pinUid}`; }

/** A vector stand-in for the GoDoor door mark, fitted into the pin-badge
    circle (scale 0.38, centred on the badge). Used on the customer/delivery
    pin and default markers.

    This is a hand-built approximation, not the official artwork — Mapbox pins
    render at roughly 28px where the raster mark in `public/brand` would go
    soft, so the shapes are redrawn as vector. It follows the real brand
    palette (`--primary` orange over the `#011438` logo navy). */
function doorMark(): string {
  return `
    <rect x="7.82" y="3.66" width="5.7" height="9.88" rx="0.95" fill="var(--primary)"/>
    <rect x="8.39" y="4.23" width="4.56" height="8.74" rx="0.57" fill="var(--primary)"/>
    <circle cx="12.38" cy="8.6" r="0.61" fill="#011438"/>
    <circle cx="12.38" cy="8.6" r="0.3" fill="var(--primary)" opacity="0.4"/>
    <path d="M13.52 3.66L16.18 4.61V12.59L13.52 13.54V3.66Z" fill="#c13e10"/>
    <path d="M14.09 4.23L15.61 4.99V12.21L14.09 12.97V4.23Z" fill="#d94e18"/>
    <circle cx="14.09" cy="8.6" r="0.38" fill="var(--primary)" opacity="0.3"/>
  `;
}

function bagMark(): string {
  return `
    <path d="M7 9.4h10l-0.85 7a1.4 1.4 0 0 1-1.38 1.2H9.23a1.4 1.4 0 0 1-1.38-1.2l-0.85-7z" fill="#fff"/>
    <path d="M9.4 8.7V7.1a2.6 2.6 0 0 1 5.2 0v1.6" stroke="#fff" stroke-width="1.5" fill="none" stroke-linecap="round"/>
    <path d="M8.1 13.6l-1.2-1.5m10.2 1.5l1.2-1.5" stroke="#fff" stroke-width="1.2" stroke-linecap="round" opacity="0.7"/>
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

  /* The rider is a puck, not a pin. It is the one thing on this map a customer
     acts on, so it gets the treatment an app like Uber's driver puck gets: a
     solid disc that rotates to the bearing and carries a directional nose, so
     "which way are they going" is answerable at a glance. A teardrop pin for
     the rider made heading ambiguous. */
  if (isRider) {
    const size = 44;
    el.style.cssText = `
      width: ${size}px;
      height: ${size}px;
      display: block;
      background: transparent;
      cursor: pointer;
      position: relative;
      transition: transform 0.15s cubic-bezier(0.34,1.56,0.64,1);
    `;

    const pulse = document.createElement("div");
    pulse.style.cssText = `
      position: absolute;
      inset: 0;
      border-radius: 50%;
      border: 2.5px solid #EA580C;
      opacity: 0.7;
      animation: marker-ring-pulse 1.8s ease-in-out infinite;
      pointer-events: none;
    `;
    el.appendChild(pulse);

    /* Rotating body: holds the nose so the arrow always points down-road. */
    const rot = document.createElement("div");
    rot.style.cssText = `
      position: absolute;
      inset: 0;
      transform: ${m.heading != null && Number.isFinite(m.heading) ? `rotate(${m.heading}deg)` : "rotate(0deg)"};
      transition: transform 0.4s cubic-bezier(0.4,0,0.2,1);
    `;
    rot.innerHTML = `<svg width="${size}" height="${size}" viewBox="0 0 44 44" fill="none" style="display:block;filter:drop-shadow(0 3px 5px rgba(0,0,0,0.4))">
      <circle cx="22" cy="22" r="13" fill="#EA580C" stroke="#ffffff" stroke-width="3"/>
      <path d="M22 12.5 L26.4 20.2 L22 18.4 L17.6 20.2 Z" fill="#ffffff"/>
    </svg>`;
    el.appendChild(rot);
    (el as any).__gdrArrow = rot;
    (el as any).__gdrIsPuck = true;

    /* Name/ETA chip below the puck. Placed under the disc rather than over it
       so it never covers the rider's own position. */
    if (m.label) {
      const chip = document.createElement("div");
      chip.textContent = m.label;
      chip.style.cssText = `
        position: absolute;
        left: 50%;
        top: ${size + 2}px;
        transform: translateX(-50%);
        background: rgba(255,255,255,0.97);
        color: #1a1128;
        border-radius: 999px;
        padding: 2px 8px;
        font-family: Inter, system-ui, sans-serif;
        font-size: 10px;
        font-weight: 700;
        white-space: nowrap;
        max-width: 130px;
        overflow: hidden;
        text-overflow: ellipsis;
        box-shadow: 0 2px 8px rgba(0,0,0,0.28);
        pointer-events: none;
        z-index: 2;
      `;
      el.appendChild(chip);
    }

    el.addEventListener("mouseenter", () => { el.style.transform = "scale(1.12)"; });
    el.addEventListener("mouseleave", () => { el.style.transform = "scale(1)"; });
    return el;
  }

  let size = 44;
  let light = "var(--primary)";
  let dark = "var(--primary-hover)";
  let icon = doorMark();
  let shape: "teardrop" | "storefront" = "teardrop";

  if (isPickup) {
    size = 47;
    light = "#F97316"; dark = "#EA580C";
    icon = bagMark();
    shape = "storefront";
  } else if (isDest) {
    size = 48;
    light = "#22c55e"; dark = "#16a34a";
    icon = doorMark();
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

  /* Pulsing ring: drop-off pin only (the rider is a puck and owns its own).
     The centring lives on a wrapper because the keyframe animates `transform`
     outright, which would otherwise wipe out the translateX(-50%) and fling
     the ring off to the right of the pin. */
  if (isDest) {
    const wrap = document.createElement("div");
    wrap.style.cssText = `
      position: absolute;
      left: 50%;
      top: ${Math.round(size * 0.1)}px;
      width: ${Math.round(size * 0.86)}px;
      height: ${Math.round(size * 0.86)}px;
      transform: translateX(-50%);
      pointer-events: none;
    `;
    const pulse = document.createElement("div");
    pulse.style.cssText = `
      position: absolute;
      inset: 0;
      border-radius: 50%;
      border: 2.5px solid ${dark};
      opacity: 0.8;
      animation: marker-ring-pulse 2.6s ease-in-out infinite;
    `;
    wrap.appendChild(pulse);
    el.appendChild(wrap);
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
    arrow.innerHTML = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M12 2l7 10h-4v8h-6v-8H5z" fill="#EA580C" stroke="#ffffff" stroke-width="1.4" stroke-linejoin="round"/></svg>`;
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
  className, userLocation, userAccuracy, onError, fitBounds, fitPadding: outerPadding, route, maneuvers,
  congestion = null,
}: Props & { onError?: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markersRef = useRef<Map<string, any>>(new Map());
  const maneuverRef = useRef<any[]>([]);
  const userMarkerRef = useRef<any>(null);
  const accuracyRef = useRef<any>(null);
  const riderAccuracyRef = useRef<any>(null);
  const glideRef = useRef<Map<string, number>>(new Map());
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
        // Arrows get their own copy of the plain LineString: the traffic-coloured
        // line is split per segment, and spacing a symbol along 2-point features
        // would leave most of the route bare.
        map.addSource("gdr-route-arrows-src", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        map.addLayer({
          id: "gdr-route-line",
          type: "line",
          source: "gdr-route",
          layout: { "line-cap": "round", "line-join": "round" },
          paint: {
            "line-width": ["interpolate", ["linear"], ["zoom"], 11, 5, 16, 8.5],
            // Brand orange when the road is clear, warming to red as it jams.
            // 0 is "no data", so it keeps the neutral brand colour rather than
            // claiming a traffic level we do not have.
            "line-color": [
              "match", ["coalesce", ["get", "congestion"], 0],
              0, "#F97316", 1, "#F97316", 2, "#F59E0B", 3, "#EF4444", 4, "#B91C1C",
              "#F97316",
            ],
            "line-opacity": 1,
          },
        });
        map.addLayer({
          id: "gdr-route-casing",
          type: "line",
          source: "gdr-route",
          layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-width": ["interpolate", ["linear"], ["zoom"], 11, 10, 16, 16], "line-color": "#ffffff", "line-opacity": 1 },
        });
        map.addLayer({
          id: "gdr-route-glow",
          type: "line",
          source: "gdr-route",
          layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-width": ["interpolate", ["linear"], ["zoom"], 11, 14, 16, 22], "line-color": "rgba(234,88,12,0.3)", "line-opacity": 1 },
        });
        map.addLayer({
          id: "gdr-route-arrows",
          type: "symbol",
          source: "gdr-route-arrows-src",
          layout: {
            "symbol-placement": "line",
            "text-field": "▶",
            "text-size": ["interpolate", ["linear"], ["zoom"], 11, 16, 16, 24],
            "symbol-spacing": ["interpolate", ["linear"], ["zoom"], 11, 60, 16, 140],
            "text-keep-upright": false,
            "text-rotation-alignment": "map",
          },
          paint: {
            "text-color": "#ffffff",
            "text-halo-color": "#7a2305",
            "text-halo-width": 2.5,
            "text-opacity": 1,
          },
        });
      }
      if (pts.length >= 2) {
        // With congestion we emit one 2-point feature per segment so each can be
        // painted by its own traffic level; otherwise a single LineString.
        const useCongestion = !!congestion && congestion.length >= pts.length - 1;
        const features = useCongestion
          ? pts.slice(0, -1).map((p, i) => ({
              type: "Feature" as const,
              properties: { congestion: congestion[i] ?? 0 },
              geometry: { type: "LineString" as const, coordinates: [[p.lng, p.lat], [pts[i + 1].lng, pts[i + 1].lat]] },
            }))
          : [{ type: "Feature" as const, properties: {}, geometry: { type: "LineString" as const, coordinates: pts.map((p) => [p.lng, p.lat]) } }];
        map.getSource("gdr-route").setData({ type: "FeatureCollection", features });
        map.getSource("gdr-route-arrows-src").setData({
          type: "FeatureCollection",
          features: [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: pts.map((p) => [p.lng, p.lat]) } }],
        });
        try { map.moveLayer("gdr-route-glow"); } catch {}
        map.moveLayer("gdr-route-casing");
        map.moveLayer("gdr-route-line");
        try { map.moveLayer("gdr-route-arrows"); } catch {}
      } else {
        map.getSource("gdr-route").setData({ type: "FeatureCollection", features: [] });
        map.getSource("gdr-route-arrows-src").setData({ type: "FeatureCollection", features: [] });
      }
    } catch {}
  }, [ready, route, congestion]);

  /* ── Turn-by-turn navigation badges ──
     Numbered discs at each maneuver, sitting above the route line but below
     the rider/drop-off pins. This is what turns a bare polyline into
     directions a rider can actually follow without guessing. */
  const maneuverKey = useMemo(
    () => (maneuvers || [])
      .map((m) => `${m.type}:${m.position?.lat?.toFixed(5) ?? "x"}:${m.position?.lng?.toFixed(5) ?? "x"}`)
      .join("|"),
    [maneuvers],
  );

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    let cancelled = false;

    import("mapbox-gl").then((mapboxgl) => {
      if (cancelled || !mapRef.current) return;
      const m = mapRef.current;

      // Rebuild from scratch: the badge order and count change with the route,
      // and diffing DOM markers buys nothing for a list capped at a dozen.
      maneuverRef.current.forEach((mk) => { try { mk.remove(); } catch {} });
      maneuverRef.current = [];

      (maneuvers || []).forEach((mv, i) => {
        if (!mv?.position) return;
        if (Math.abs(mv.position.lat) <= 1e-9 && Math.abs(mv.position.lng) <= 1e-9) return;
        const el = createManeuverElement(mv);
        el.style.zIndex = "20";
        const mk = new mapboxgl.default.Marker({ element: el, anchor: "center" })
          .setLngLat([mv.position.lng, mv.position.lat])
          .addTo(m);
        maneuverRef.current.push(mk);
      });
    }).catch(() => {});

    return () => { cancelled = true; };
  }, [ready, maneuverKey]); // eslint-disable-line

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
        inner.style.cssText = `width:22px;height:22px;border-radius:50%;background:var(--primary-hover);border:3px solid #fff;box-shadow:0 0 0 5px rgba(249,115,22,0.25), 0 4px 10px rgba(0,0,0,0.35);`;
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

  /* Ease a marker between two fixes. Restarting mid-flight blends from
     wherever the pin currently is, so rapid updates never snap backwards. */
  const glideTo = useCallback((m: MarkerData, marker: any, from: [number, number], to: [number, number]) => {
    const running = glideRef.current.get(m.id);
    if (running) cancelAnimationFrame(running);
    const dist = Math.hypot(to[0] - from[0], to[1] - from[1]);
    if (dist < 1e-6) return;
    const duration = Math.min(6000, Math.max(900, dist * 100_000));
    const started = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - started) / duration);
      const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      try {
        marker.setLngLat([from[0] + (to[0] - from[0]) * e, from[1] + (to[1] - from[1]) * e]);
      } catch {
        glideRef.current.delete(m.id);
        return;
      }
      if (t < 1) glideRef.current.set(m.id, requestAnimationFrame(step));
      else glideRef.current.delete(m.id);
    };
    glideRef.current.set(m.id, requestAnimationFrame(step));
  }, []);

  const markerKey = useMemo(
    () => markers.map((m) => `${m.id}:${m.position?.lat?.toFixed(5) ?? "x"}:${m.position?.lng?.toFixed(5) ?? "x"}:${m.isRider}:${m.isPickup}:${m.isDestination}:${m.heading ?? "h"}:${m.accuracy ?? "a"}`).join("|"),
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
          const marker = markersRef.current.get(m.id);
          if (m.isRider) {
            // GPS fixes land every few seconds. Snapping the pin to each one
            // reads as a fake, stuttering dot, so it eases across the gap.
            const cur = marker.getLngLat();
            glideTo(m, marker, [cur.lng, cur.lat], [m.position.lng, m.position.lat]);
          } else {
            marker.setLngLat([m.position.lng, m.position.lat]);
          }
          const arrowEl = (marker.getElement() as any)?.__gdrArrow;
          if (arrowEl && m.heading != null && Number.isFinite(m.heading)) {
            // The rider puck centres itself with absolute positioning, so it
            // rotates alone; the legacy chevron also needed centring.
            const isPuck = (marker.getElement() as any).__gdrIsPuck;
            arrowEl.style.transform = isPuck
              ? `rotate(${m.heading}deg)`
              : `translateX(-50%) rotate(${m.heading}deg)`;
          }
        } else {
          const el = createMarkerElement(m);
          // Shop pins are decoration; the rider and the drop-off point are the
          // answer the user is looking for, so they always paint on top.
          el.style.zIndex = m.isRider || m.isDestination ? "30" : "10";
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
          background: var(--primary); border: 3px solid #fff;
          box-shadow: 0 0 0 6px rgba(241,90,34,0.3), 0 4px 12px rgba(0,0,0,0.35);
          animation: marker-ring-pulse 2.5s ease-in-out infinite;
          position: relative;
        `;
        const dot = document.createElement("div");
        dot.style.cssText = "width:9px;height:9px;border-radius:50%;background:#fff;position:absolute;top:50%;left:50%;transform:translate(-50%,-50%)";
        el.appendChild(dot);
        el.style.zIndex = "25";
        userMarkerRef.current = new mapboxgl.default.Marker({ element: el, anchor: "center" })
          .setLngLat([userLocation.lng, userLocation.lat])
          .addTo(map);
      }
    }).catch(() => {});
  }, [userLocation?.lat, userLocation?.lng, ready]); // eslint-disable-line

  /* ── GPS accuracy halo ──
     A circle at the reported fix radius, filled with the same orange as the
     dot. A 6 m fix looks like a point; a 200 m fix looks like a wide disc —
     which is exactly the truth the user needs before they trust the pin. */
  useEffect(() => {
    if (!mapRef.current || !ready || !userLocation) return;
    const metres = Number(userAccuracy);
    if (!Number.isFinite(metres) || metres <= 0) return;
    // Keep the halo honest: below ~8 m it is invisible at street zoom anyway,
    // and beyond 1.5 km it would blanket the whole view.
    if (metres < 8 || metres > 1500) return;

    import("mapbox-gl").then((mapboxgl) => {
      const map = mapRef.current;
      if (!map) return;
      const data = accuracyCircleFeature(userLocation.lat, userLocation.lng, metres);

      if (accuracyRef.current) {
        const src = map.getSource("gdr-accuracy") as any;
        if (src?.setData) src.setData(data);
      } else {
        if (!map.getSource("gdr-accuracy")) {
          map.addSource("gdr-accuracy", { type: "geojson", data });
        }
        if (!map.getLayer("gdr-accuracy-fill")) {
          map.addLayer({
            id: "gdr-accuracy-fill",
            type: "fill",
            source: "gdr-accuracy",
            paint: { "fill-color": "#F97316", "fill-opacity": 0.14 },
          });
        }
        if (!map.getLayer("gdr-accuracy-line")) {
          map.addLayer({
            id: "gdr-accuracy-line",
            type: "line",
            source: "gdr-accuracy",
            paint: { "line-color": "#F97316", "line-width": 1.5, "line-opacity": 0.5 },
          });
        }
        accuracyRef.current = map.getSource("gdr-accuracy");
      }
    }).catch(() => {});
  }, [userLocation?.lat, userLocation?.lng, userAccuracy, ready]); // eslint-disable-line

  /* ── Rider fix-radius halo ──
     The rider pin is the one thing on this map a customer will act on, so it
     wears its reported uncertainty. A 12 m fix draws a tight disc; a 180 m fix
     draws a wide one, which is the truth rather than a confident-looking dot. */
  useEffect(() => {
    if (!mapRef.current || !ready) return;
    const rider = markers.find((m) => m.isRider && m.position);
    const metres = Number(rider?.accuracy);
    const hasRider = !!rider && Math.abs(rider.position.lat) > 1e-9;
    if (!hasRider || !Number.isFinite(metres) || metres <= 0 || metres < 8 || metres > 1500) {
      const src = riderAccuracyRef.current;
      if (src?.setData) src.setData({ type: "FeatureCollection", features: [] });
      return;
    }

    import("mapbox-gl").then((mapboxgl) => {
      const map = mapRef.current;
      if (!map) return;
      const data = accuracyCircleFeature(rider.position.lat, rider.position.lng, metres);
      if (riderAccuracyRef.current) {
        const src = map.getSource("gdr-rider-accuracy") as any;
        if (src?.setData) src.setData(data);
      } else {
        if (!map.getSource("gdr-rider-accuracy")) {
          map.addSource("gdr-rider-accuracy", { type: "geojson", data });
        }
        if (!map.getLayer("gdr-rider-accuracy-fill")) {
          map.addLayer({
            id: "gdr-rider-accuracy-fill",
            type: "fill",
            source: "gdr-rider-accuracy",
            paint: { "fill-color": "#F97316", "fill-opacity": 0.12 },
          });
        }
        if (!map.getLayer("gdr-rider-accuracy-line")) {
          map.addLayer({
            id: "gdr-rider-accuracy-line",
            type: "line",
            source: "gdr-rider-accuracy",
            paint: { "line-color": "#F97316", "line-width": 1.5, "line-opacity": 0.45 },
          });
        }
        riderAccuracyRef.current = map.getSource("gdr-rider-accuracy");
      }
    }).catch(() => {});
  }, [markerKey, ready]); // eslint-disable-line

  /* ── Recentre on the user ──
     Panning is never punished: the map keeps the manual view, and one tap
     puts the pin back in the middle at a street-level zoom. */
  const recentre = useCallback(() => {
    const map = mapRef.current;
    if (!map || !userLocation) return;
    markUserMoved();
    map.flyTo({ center: [userLocation.lng, userLocation.lat], zoom: 16, pitch: 0, bearing: 0, duration: 700 });
  }, [userLocation?.lat, userLocation?.lng, markUserMoved]); // eslint-disable-line

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
        .dark .go-door-popup .mapboxgl-popup-content {
          background: #14101c !important;
          color: #f7f4fb !important;
          border: 1px solid rgba(255,255,255,0.08) !important;
        }
        .go-door-popup .mapboxgl-popup-tip {
          border-top-color: #ffffff !important;
          border-bottom-color: #ffffff !important;
        }
        .dark .go-door-popup .mapboxgl-popup-tip {
          border-top-color: #14101c !important;
          border-bottom-color: #14101c !important;
        }

        /* The live-tracking metrics card is an absolutely-positioned sibling
           overlay pinned to the bottom of the map (full width on mobile, 360px
           on the right from sm up). It sits at the same z-index as Mapbox's own
           bottom-right controls, so without lifting them the zoom/recentre
           buttons and - more importantly - the required attribution end up
           hidden underneath it. Raise them clear of the card. */
        .mapboxgl-ctrl-bottom-right {
          bottom: 172px !important;
        }
      `}</style>
      <div style={{ position: "relative", height: boxH, width: "100%" }}>
        <div ref={containerRef} style={{ height: boxH, width: "100%" }} className={className} />
        {ready && (
          <div style={{ position: "absolute", left: 10, bottom: 172, zIndex: 30, display: "flex", flexDirection: "column", gap: 8 }}>
            {userLocation && (
              <button type="button" onClick={recentre} aria-label="Centre on my location" title="Centre on my location"
                style={{ width: 38, height: 38, borderRadius: 12, cursor: "pointer", background: "var(--color-navy)", border: "1px solid var(--navy-hover)", boxShadow: "0 2px 10px rgba(0,0,0,0.3)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", transition: "transform 0.1s ease" }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="3.2" />
                  <circle cx="12" cy="12" r="7.5" strokeDasharray="3 3" />
                  <path d="M12 1.5v3M12 19.5v3M1.5 12h3M19.5 12h3" />
                </svg>
              </button>
            )}
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