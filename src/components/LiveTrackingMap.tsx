"use client";

import { useMemo } from "react";
import { Navigation, MapPin, ShoppingBag } from "lucide-react";
import { type LatLng, distanceKm } from "@/lib/location";
import { calcDeliveryFee, ugandaFareTier, formatUgx } from "@/lib/utils";
import dynamic from "next/dynamic";

const MapboxMapView = dynamic(() => import("@/components/MapboxMap"), { ssr: false,
  loading: () => (
    <div className="grid h-64 w-full place-items-center rounded-2xl border border-border bg-surface">
      <div className="flex items-center gap-2 text-muted text-sm">
        <div className="h-4 w-4 animate-spin rounded-full border-2 border-go border-t-transparent" />
        Loading map…
      </div>
    </div>
  ),
});

/**
 * Fraction of a polyline already covered, measured by projecting `pos` onto
 * each segment and taking the closest one. Distances use the same haversine
 * `distanceKm` as the rest of the app, so the ratio is consistent with the
 * distances shown to the customer. Returns null for a degenerate polyline.
 */
function progressAlongPolyline(line: LatLng[], pos: LatLng): number | null {
  if (line.length < 2) return null;

  const segLen: number[] = [];
  const cum: number[] = [0];
  for (let i = 0; i < line.length - 1; i++) {
    const d = distanceKm(line[i], line[i + 1]);
    segLen.push(d);
    cum.push(cum[i] + d);
  }
  const total = cum[cum.length - 1];
  if (!(total > 0.001)) return null;

  // Closest projection, and how far along the line that projection sits.
  let bestAlong = 0;
  let bestOff = Infinity;
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i];
    const b = line[i + 1];
    const vx = b.lng - a.lng;
    const vy = b.lat - a.lat;
    const len2 = vx * vx + vy * vy;
    let t = 0;
    if (len2 > 0) {
      t = ((pos.lng - a.lng) * vx + (pos.lat - a.lat) * vy) / len2;
      t = Math.min(1, Math.max(0, t));
    }
    const px = a.lng + t * vx;
    const py = a.lat + t * vy;
    const off = distanceKm({ lat: py, lng: px }, pos);
    if (off < bestOff) {
      bestOff = off;
      bestAlong = cum[i] + t * segLen[i];
    }
  }

  return Math.min(1, Math.max(0, bestAlong / total));
}

type Props = {
  riderLoc: LatLng | null;
  riderHeading?: number | null;
  /** Rider-reported GPS fix radius in metres — drawn as a halo round the pin. */
  riderAccuracy?: number | null;
  providerLoc?: LatLng | null;
  providerName?: string;
  dropoffLoc: LatLng | null;
  pickupLoc: LatLng | null;
  showPickup?: boolean;
  label?: string;
  compact?: boolean;
  fill?: boolean;
  userLocation?: LatLng | null;
  /** Reported GPS fix radius (metres) for the viewer — drawn as a halo. */
  userAccuracy?: number | null;
  merchantName?: string;
  customerName?: string;
  /** Actual road polyline (Mapbox/OSRM). When provided, replaces the straight-line display. */
  roadRoute?: LatLng[] | null;
  /** Turn-by-turn points, drawn as numbered navigation badges on the route. */
  maneuvers?: Array<{ type: string; instruction: string; lat: number; lng: number }> | null;
  /** Road distance/time power the fare + ETA so billing counts time, not just distance. */
  roadDistanceKm?: number | null;
  roadDurationMin?: number | null;
  /** The fee actually agreed at checkout. When present it is the only amount we show. */
  quotedFeeUgx?: number | null;
  /** True when roadDurationMin already includes live traffic, so it must not price a fare. */
  trafficAware?: boolean;
  /** Per-segment congestion (Mapbox 0-4) painted onto the route line. */
  congestion?: number[] | null;
};

export function LiveTrackingMap({
  riderLoc, riderHeading, riderAccuracy = null, providerLoc, providerName, dropoffLoc, pickupLoc, showPickup = false, label, compact = false, fill = false,
  userLocation, userAccuracy, merchantName, customerName, roadRoute = null, maneuvers = null, roadDistanceKm = null, roadDurationMin = null,
  quotedFeeUgx = null, trafficAware = false, congestion = null,
}: Props) {
  const UG_DEFAULT: LatLng = { lat: 0.3163, lng: 32.5822 };
  const hasCoords = (p: LatLng | null | undefined) => !!p && (Math.abs(p.lat) > 1e-9 || Math.abs(p.lng) > 1e-9);
  const validDropoff = hasCoords(dropoffLoc) ? dropoffLoc : null;
  const validPickup = hasCoords(pickupLoc) ? pickupLoc : null;

  const dist = riderLoc && validDropoff ? distanceKm(riderLoc, validDropoff) : null;
  const etaMin = dist != null ? Math.max(2, Math.round(dist * 4)) : null;

  // Fare counts road distance + trip time with day/night minimums
  // (1,500 day · 2,000 from 7pm · 3,000 midnight) — never the old flat ~$1.
  const fareKm = roadDistanceKm != null && roadDistanceKm > 0 ? roadDistanceKm : dist;
  // A price must not move with traffic. The agreed fee is fixed at checkout and
  // always wins; without one we estimate on a traffic-neutral 25 km/h so the
  // same trip never quotes two different amounts depending on the hour.
  const fareMin = trafficAware
    ? (fareKm != null ? (fareKm / 25) * 60 : etaMin)
    : roadDurationMin != null && roadDurationMin > 0 ? roadDurationMin : etaMin;
  const estFareUgx = fareKm != null && fareKm > 0 ? calcDeliveryFee(fareKm, 0, fareMin) : null;
  const hasQuote = quotedFeeUgx != null && quotedFeeUgx > 0;
  const fareUgx = hasQuote ? quotedFeeUgx : estFareUgx;
  const fareTier = ugandaFareTier();

  const center: LatLng = useMemo(() => {
    const points: LatLng[] = [];
    if (hasCoords(riderLoc)) points.push(riderLoc as LatLng);
    if (hasCoords(providerLoc)) points.push(providerLoc as LatLng);
    if (validDropoff) points.push(validDropoff);
    if (showPickup && validPickup) points.push(validPickup);
    if (points.length === 0) return UG_DEFAULT;
    return {
      lat: points.reduce((s, p) => s + p.lat, 0) / points.length,
      lng: points.reduce((s, p) => s + p.lng, 0) / points.length,
    };
  }, [riderLoc, providerLoc, validDropoff, validPickup, showPickup]);

  const route = useMemo(() => {
    // Prefer the actual road polyline when available; fall back to straight-line legs.
    if (roadRoute && roadRoute.length >= 2) return roadRoute;
    const pts: LatLng[] = [];
    if (showPickup && validPickup) pts.push(validPickup);
    if (hasCoords(riderLoc)) pts.push(riderLoc as LatLng);
    else if (hasCoords(providerLoc)) pts.push(providerLoc as LatLng);
    if (validDropoff) pts.push(validDropoff);
    return pts.length >= 2 ? pts : [];
  }, [roadRoute, riderLoc, providerLoc, validPickup, validDropoff, showPickup]);

  const fitBounds = useMemo(() => {
    const points: LatLng[] = [];
    if (validDropoff) points.push(validDropoff);
    if (validPickup) points.push(validPickup);
    if (hasCoords(riderLoc)) points.push(riderLoc as LatLng);
    if (hasCoords(providerLoc)) points.push(providerLoc as LatLng);
    return points;
  }, [riderLoc, providerLoc, validDropoff, validPickup]);

  // Trip progress (0..1).
  //
  // Prefer projecting the rider onto the real road polyline: a winding route
  // can be several times longer than its straight line, so a straight-line
  // ratio sits near 0% while the rider is visibly halfway along. Falls back to
  // the straight-line ratio when no road geometry is available.
  const progress = useMemo(() => {
    if (!riderLoc) return null;
    if (roadRoute && roadRoute.length >= 2) {
      const along = progressAlongPolyline(roadRoute, riderLoc);
      if (along != null) return along;
    }
    if (!validDropoff || !validPickup) return null;
    const total = distanceKm(validPickup, validDropoff);
    if (total <= 0.001) return null;
    const done = Math.max(0, total - (dist ?? 0));
    return Math.min(1, Math.max(0, done / total));
  }, [riderLoc, roadRoute, validDropoff, validPickup, dist]);

  const markers = useMemo(() => {
    const m: any[] = [];

    if (showPickup && validPickup) {
      m.push({ id: "pickup", position: validPickup, isPickup: true, label: merchantName || "Shop" });
    }

    if (validDropoff) {
      m.push({ id: "dropoff", position: validDropoff, isDestination: true, label: customerName || "Delivery" });
    }

    if (hasCoords(riderLoc)) {
      m.push({ id: "rider-live", position: riderLoc as LatLng, isRider: true, label: "Rider", heading: riderHeading || null, accuracy: riderAccuracy ?? null });
    } else if (hasCoords(providerLoc)) {
      m.push({ id: "provider-live", position: providerLoc as LatLng, isRider: true, label: providerName || "Provider", heading: null });
    }

    return m;
  }, [showPickup, validPickup, validDropoff, riderLoc, riderHeading, riderAccuracy, providerLoc, providerName, merchantName, customerName]);

  const kmAway = dist != null && (dist < 1 ? `${Math.round(dist * 1000)}m` : `${dist.toFixed(1)} km`);

  /* Only the first few maneuvers are worth a badge — a long list of discs turns
     the route into confetti. Twelve covers a city delivery with room to spare. */
  const maneuverMarkers = useMemo(
    () => (maneuvers || []).slice(0, 12).map((m) => ({
      type: m.type,
      instruction: m.instruction,
      position: { lat: m.lat, lng: m.lng },
    })),
    [maneuvers],
  );

  const nextTurn = maneuverMarkers[0] || null;

  if (compact) {
    return (
      <div className="space-y-2">
        <div className="relative h-[38vh] min-h-[260px] w-full overflow-hidden rounded-2xl border border-border shadow-lg shadow-black/10">
          <MapboxMapView center={center} zoom={14} userLocation={userLocation || undefined} userAccuracy={userAccuracy ?? null} height={400} route={route} maneuvers={maneuverMarkers} congestion={congestion} fitBounds={fitBounds} markers={markers} fitPadding={{ top: 56, bottom: 56, left: 48, right: 48 }} />
          <div className="absolute left-3 top-3 z-10 flex items-center gap-2 rounded-full border border-border bg-surface/85 px-3 py-1.5 shadow-lg backdrop-blur-md">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-go opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-go" />
            </span>
            <span className="text-[11px] font-semibold">{label || "Live tracking"}</span>
          </div>
        </div>
      </div>
    );
  }

  const wrapCls = fill
    ? "relative h-full w-full overflow-hidden rounded-2xl border border-border shadow-xl shadow-black/20"
    : "relative h-[70vh] min-h-[440px] w-full overflow-hidden rounded-2xl border border-border shadow-xl shadow-black/20 sm:h-[520px]";
  const fitPad = fill
    ? { top: 88, bottom: 250, left: 72, right: 72 }
    : { top: 96, bottom: 208, left: 60, right: 60 };

  return (
    <div className={fill ? "h-full" : "space-y-3"}>
      <div className={wrapCls}>
        <MapboxMapView
          center={center}
          zoom={14}
          userLocation={userLocation || undefined}
          userAccuracy={userAccuracy ?? null}
          height={600}
          fillHeight={fill}
          route={route}
          maneuvers={maneuverMarkers}
          congestion={congestion}
          fitBounds={fitBounds}
          markers={markers}
          fitPadding={fitPad}
        />

        {/* Top-left: live status chip */}
        <div className="absolute left-3 top-3 z-10 flex items-center gap-2 rounded-full border border-border bg-surface/85 px-3.5 py-2 shadow-lg backdrop-blur-md">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-go opacity-60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-go" />
          </span>
          <span className="text-xs font-semibold">{label || "Tracking delivery"}</span>
          {kmAway && <span className="text-[10px] font-medium text-muted">{kmAway} away</span>}
        </div>

        {/* Next-turn banner — the one instruction the rider needs right now.
            Sits top-centre so it never collides with the status chip or the
            metrics card, and is the first thing a glance lands on. */}
        {nextTurn && (
          <div className="absolute left-1/2 top-3 z-10 flex max-w-[min(92%,22rem)] -translate-x-1/2 items-center gap-2.5 rounded-2xl border border-border bg-surface/95 px-3.5 py-2.5 shadow-xl backdrop-blur-md">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-go/15 text-sm font-black text-go">
              {nextTurn.type === "arrive" ? "★" : "1"}
            </span>
            <div className="min-w-0">
              <p className="text-[9px] font-bold uppercase tracking-wider text-dim">Next</p>
              <p className="truncate text-[11px] font-semibold text-fg">{nextTurn.instruction}</p>
            </div>
          </div>
        )}

        {/* Bottom-left: legend */}
        <div className="absolute bottom-52 left-3 z-10 hidden items-center gap-3 rounded-xl border border-border bg-surface/85 px-3 py-2 shadow-lg backdrop-blur-md sm:flex">
          <span className="flex items-center gap-1.5 text-[10px] text-muted"><span className="grid h-3.5 w-3.5 place-items-center rounded-md bg-orange-500"><ShoppingBag className="h-2 w-2 text-white" /></span>Shop</span>
          <span className="flex items-center gap-1.5 text-[10px] text-muted"><span className="h-3.5 w-3.5 rounded-full bg-green-500 ring-2 ring-green-500/30" />Delivery</span>
          {hasCoords(riderLoc) && <span className="flex items-center gap-1.5 text-[10px] text-muted"><span className="h-3.5 w-3.5 rounded-full bg-orange-500 ring-2 ring-orange-500/30 animate-pulse" />Rider</span>}
          {!hasCoords(riderLoc) && hasCoords(providerLoc) && <span className="flex items-center gap-1.5 text-[10px] text-muted"><span className="h-3.5 w-3.5 rounded-full bg-orange-500 ring-2 ring-orange-500/30 animate-pulse" />Provider</span>}
          {hasCoords(userLocation) && <span className="flex items-center gap-1.5 text-[10px] text-muted"><span className="h-3.5 w-3.5 rounded-full bg-go ring-2 ring-go/30" />You</span>}
        </div>

        {/* Bottom: glass metrics card */}
        <div className="absolute bottom-3 left-3 right-3 z-10 rounded-2xl border border-border bg-surface/90 p-3.5 shadow-2xl backdrop-blur-xl sm:left-auto sm:right-3 sm:w-[360px]">
          {progress != null && (
            <div className="mb-3">
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-elevated">
                <div className="h-full rounded-full bg-gradient-to-r from-go to-go-2 transition-all duration-700" style={{ width: `${Math.round(progress * 100)}%` }} />
              </div>
              <p className="mt-1 text-right text-[9px] font-semibold uppercase tracking-wider text-dim">{Math.round(progress * 100)}% of the way</p>
            </div>
          )}

          <div className="grid grid-cols-3 divide-x divide-border">
            <div className="flex flex-col items-center gap-0.5 px-2">
              <p className="text-[9px] font-semibold uppercase tracking-wider text-dim">ETA</p>
              {etaMin != null ? (
                <p className="font-display text-xl font-bold leading-none text-go">{etaMin}<span className="text-xs font-semibold"> min</span></p>
              ) : (
                <p className="text-sm text-muted">—</p>
              )}
            </div>
            <div className="flex flex-col items-center gap-0.5 px-2">
              <p className="text-[9px] font-semibold uppercase tracking-wider text-dim">Distance</p>
              <p className="text-sm font-bold leading-none">{dist != null ? (dist < 1 ? `${Math.round(dist * 1000)} m` : `${dist.toFixed(1)} km`) : "—"}</p>
              <p className="flex items-center gap-1 text-[9px] text-muted"><Navigation className="h-2.5 w-2.5 text-go-2" />to delivery</p>
            </div>
            <div className="flex flex-col items-center gap-0.5 px-2">
              <p className="text-[9px] font-semibold uppercase tracking-wider text-dim">Fare</p>
              <p className="text-sm font-bold leading-none">{fareUgx != null ? formatUgx(fareUgx) : "—"}</p>
              <p className="flex items-center gap-1 text-[9px] text-muted">
                {hasQuote ? <ShoppingBag className="h-2.5 w-2.5 text-go" /> : <MapPin className="h-2.5 w-2.5 text-go" />}
                {hasQuote ? "agreed at checkout" : fareTier === "day" ? "day rate" : fareTier === "evening" ? "night rate · from 7pm" : "midnight rate"}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}