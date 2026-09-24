"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { Navigation, Route as RouteIcon, Clock, ChevronDown } from "lucide-react";
import type { LatLng } from "@/lib/location";
import { useRoadRoute, type RoadRoute } from "@/lib/routing";

const MapboxMapView = dynamic(() => import("@/components/MapboxMap"), {
  ssr: false,
  loading: () => <RoadRouteSkeleton />,
});

export function RoadRouteSkeleton() {
  return (
    <div className="skeleton relative grid h-64 w-full place-items-center overflow-hidden rounded-2xl border border-border bg-surface" aria-label="Loading route map">
      <div className="flex items-center gap-2 text-sm text-muted">
        <div className="h-4 w-4 animate-spin rounded-full border-2 border-go border-t-transparent" />
        Loading road route…
      </div>
    </div>
  );
}

type Props = {
  pickup: LatLng | null;
  dropoff: LatLng | null;
  riderLoc?: LatLng | null;
  riderHeading?: number | null;
  pickupLabel?: string;
  dropoffLabel?: string;
  showRouteInfo?: boolean;
  onRoute?: (route: RoadRoute | null) => void;
  className?: string;
};

/**
 * Reusable Mapbox GL JS map rendering the ACTUAL road polyline between
 * pickup and dropoff (Mapbox Directions → OSRM → straight-line fallback),
 * with a live rider marker. Dark theme follows the GoDoor brand.
 */
export function RoadRouteMap({
  pickup,
  dropoff,
  riderLoc = null,
  riderHeading = null,
  pickupLabel = "Pickup",
  dropoffLabel = "Delivery",
  showRouteInfo = true,
  onRoute,
  className,
}: Props) {
  const { route, loading } = useRoadRoute(pickup, dropoff);
  const [stepsOpen, setStepsOpen] = useState(false);

  if (loading && !route) return <RoadRouteSkeleton />;

  const coords = route?.coordinates || [];
  const markers = [
    ...(pickup ? [{ id: "pickup", position: pickup, isPickup: true, label: pickupLabel }] : []),
    ...(dropoff ? [{ id: "dropoff", position: dropoff, isDestination: true, label: dropoffLabel }] : []),
    ...(riderLoc ? [{ id: "rider-live", position: riderLoc, isRider: true, label: "Rider", heading: riderHeading }] : []),
  ];
  const fit = [pickup, dropoff, riderLoc].filter(Boolean) as LatLng[];
  const center = fit.length
    ? { lat: fit.reduce((s, p) => s + p.lat, 0) / fit.length, lng: fit.reduce((s, p) => s + p.lng, 0) / fit.length }
    : { lat: 0.3163, lng: 32.5822 };

  if (route && onRoute) {
    // Report once per resolved route (parent may cache meta for ETA panels).
    queueMicrotask(() => onRoute(route));
  }

  return (
    <div className={className}>
      <div className="relative overflow-hidden rounded-2xl border border-border shadow-xl shadow-black/20">
        <MapboxMapView
          center={center}
          zoom={14}
          height={420}
          route={coords.length >= 2 ? coords : []}
          fitBounds={fit}
          markers={markers}
          fitPadding={{ top: 64, bottom: 64, left: 56, right: 56 }}
        />
        <div className="absolute left-3 top-3 z-10 flex items-center gap-2 rounded-full border border-border bg-surface/85 px-3 py-1.5 shadow-lg backdrop-blur-md">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-go opacity-60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-go" />
          </span>
          <span className="text-[11px] font-semibold">
            {route?.source === "mapbox" ? "Road route" : route?.source === "osrm" ? "Road route (fallback)" : "Direct route"}
          </span>
        </div>
      </div>

      {showRouteInfo && route && (
        <div className="card-lift mt-3 rounded-2xl border border-border bg-surface p-4">
          <div className="grid grid-cols-3 divide-x divide-border">
            <div className="flex flex-col items-center gap-0.5 px-2">
              <p className="text-[9px] font-semibold uppercase tracking-wider text-dim">Distance</p>
              <p className="text-sm font-bold tabular-nums">
                {route.distanceKm < 1 ? `${Math.round(route.distanceKm * 1000)} m` : `${route.distanceKm.toFixed(1)} km`}
              </p>
              <p className="flex items-center gap-1 text-[9px] text-muted"><RouteIcon className="h-2.5 w-2.5 text-go" />by road</p>
            </div>
            <div className="flex flex-col items-center gap-0.5 px-2">
              <p className="text-[9px] font-semibold uppercase tracking-wider text-dim">Duration</p>
              <p className="font-display text-xl font-bold leading-none text-go tabular-nums">
                {Math.max(1, Math.round(route.durationMin))}<span className="text-xs font-semibold"> min</span>
              </p>
              <p className="flex items-center gap-1 text-[9px] text-muted"><Clock className="h-2.5 w-2.5 text-go-2" />drive time</p>
            </div>
            <div className="flex flex-col items-center gap-0.5 px-2">
              <p className="text-[9px] font-semibold uppercase tracking-wider text-dim">Rider</p>
              <p className="text-sm font-bold">{riderLoc ? "Live" : "En route"}</p>
              <p className="flex items-center gap-1 text-[9px] text-muted"><Navigation className="h-2.5 w-2.5 text-go" />GPS</p>
            </div>
          </div>
          {route.steps.length > 0 && (
            <button
              type="button"
              onClick={() => setStepsOpen((v) => !v)}
              className="btn-lift mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl border border-border bg-elevated px-3 py-2.5 text-xs font-medium text-muted"
              aria-expanded={stepsOpen}
            >
              Turn-by-turn ({route.steps.length})
              <ChevronDown className={`h-3.5 w-3.5 transition-transform ${stepsOpen ? "rotate-180" : ""}`} />
            </button>
          )}
          {stepsOpen && route.steps.length > 0 && (
            <ol className="mt-2 space-y-1.5 rounded-xl bg-elevated/50 p-3">
              {route.steps.map((s, i) => (
                <li key={i} className="flex items-start gap-2 text-xs text-muted">
                  <span className="num mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full bg-go/15 text-[9px] font-bold text-go">{i + 1}</span>
                  <span className="leading-relaxed">{s}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}

export default RoadRouteMap;
