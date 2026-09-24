"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Crosshair, MapPin, Plus, Minus, Search, Loader2 } from "lucide-react";
import { KAMPALA, type LatLng } from "@/lib/location";

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || "";

type SearchResult = { id: string; place_name: string; center: [number, number] };

export function LocationPicker({
  value,
  onChange,
  height = 200,
}: {
  value: LatLng;
  onChange: (c: LatLng) => void;
  height?: number;
}) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markerRef = useRef<any>(null);
  const [mapReady, setMapReady] = useState(false);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [showResults, setShowResults] = useState(false);

  // Initialize map
  useEffect(() => {
    if (!mapContainer.current || mapRef.current || !MAPBOX_TOKEN) return;

    import("mapbox-gl").then((mod) => {
      const mapboxgl = mod.default;
      mapboxgl.accessToken = MAPBOX_TOKEN;

      const map = new mapboxgl.Map({
        container: mapContainer.current!,
        style: "mapbox://styles/mapbox/streets-v12",
        center: [value.lng, value.lat],
        zoom: 15,
        attributionControl: false,
      });

      map.addControl(new mapboxgl.NavigationControl(), "top-right");

      const marker = new mapboxgl.Marker({ color: "#f97316", draggable: true })
        .setLngLat([value.lng, value.lat])
        .addTo(map);

      marker.on("dragend", () => {
        const pos = marker.getLngLat();
        onChange({ lat: pos.lat, lng: pos.lng });
      });

      map.on("click", (e: any) => {
        const { lat, lng } = e.lngLat;
        marker.setLngLat([lng, lat]);
        onChange({ lat, lng });
      });

      mapRef.current = map;
      markerRef.current = marker;
      setMapReady(true);
    }).catch(() => {});

    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  // Update marker + center when value changes externally
  useEffect(() => {
    if (markerRef.current) markerRef.current.setLngLat([value.lng, value.lat]);
    if (mapRef.current && mapReady) mapRef.current.setCenter([value.lng, value.lat]);
  }, [value.lat, value.lng, mapReady]);

  // Search places via Mapbox geocoding (works without GPS — user can find business anywhere)
  const runSearch = useCallback(async (query: string) => {
    if (!query.trim() || !MAPBOX_TOKEN) return;
    setSearching(true);
    try {
      const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?access_token=${MAPBOX_TOKEN}&country=UG&limit=5&types=place,locality,neighborhood,address,poi`;
      const res = await fetch(url);
      const json = await res.json();
      if (Array.isArray(json?.features)) {
        setResults(
          json.features.map((f: any) => ({
            id: f.id || String(Math.random()),
            place_name: f.place_name || f.text || "",
            center: f.center || [0, 0],
          })),
        );
        setShowResults(true);
      }
    } catch { setResults([]); }
    setSearching(false);
  }, []);

  const pickResult = useCallback((r: SearchResult) => {
    const [lng, lat] = r.center;
    onChange({ lat, lng });
    setSearch(r.place_name);
    setShowResults(false);
    if (mapRef.current) {
      mapRef.current.flyTo({ center: [lng, lat], zoom: 15, duration: 800 });
    }
  }, [onChange]);

  const recenter = useCallback(() => {
    if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => onChange({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => {},
        { enableHighAccuracy: true, timeout: 6000 },
      );
    }
  }, [onChange]);

  const zoomBy = useCallback((d: number) => {
    if (mapRef.current) mapRef.current.zoomTo((mapRef.current.getZoom() || 14) + d, { duration: 200 });
  }, []);

  return (
    <div className="space-y-3">
      {/* Search box — find a place by name, no GPS needed */}
      <div className="relative">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-dim" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onFocus={() => setShowResults(true)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); runSearch(search); } }}
            placeholder="Search town, area or street… (e.g. Masaka town)"
            className="w-full rounded-xl border border-border bg-surface py-2.5 pl-9 pr-9 text-sm outline-none ring-go focus:ring-2"
          />
          {searching && <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-go" />}
          {!searching && search && (
            <button type="button" onClick={() => runSearch(search)} className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-full bg-go px-2.5 py-1 text-[10px] font-semibold text-white hover:bg-go-2">
              Find
            </button>
          )}
        </div>
        {showResults && results.length > 0 && (
          <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-xl border border-border bg-surface shadow-xl">
            {results.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => pickResult(r)}
                className="flex w-full items-start gap-2 px-3 py-2.5 text-left text-sm hover:bg-elevated"
              >
                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-go" />
                <span className="min-w-0">{r.place_name}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Map viewport */}
      <div className="relative overflow-hidden rounded-2xl border border-border" style={{ height }}>
        <div ref={mapContainer} className="absolute inset-0" style={{ minHeight: height }} />
        {!mapReady && (
          <div className="absolute inset-0 flex items-center justify-center bg-surface">
            <div className="text-center">
              <div className="mx-auto mb-2 h-8 w-8 animate-spin rounded-full border-2 border-go border-t-transparent" />
              <p className="text-xs text-muted">Loading map…</p>
            </div>
          </div>
        )}
        {/* Marker is the draggable Mapbox pin — no extra center overlay (was confusing double-pin) */}
      </div>

      {/* Controls */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={recenter}
          className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-medium text-muted hover:bg-elevated"
        >
          <Crosshair className="h-3.5 w-3.5 text-go" />
          Use my location
        </button>
        <button
          type="button"
          onClick={() => zoomBy(1)}
          className="grid h-7 w-7 place-items-center rounded-full border border-border bg-surface text-muted hover:bg-elevated"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => zoomBy(-1)}
          className="grid h-7 w-7 place-items-center rounded-full border border-border bg-surface text-muted hover:bg-elevated"
        >
          <Minus className="h-3.5 w-3.5" />
        </button>
        <span className="flex-1 text-center text-[10px] tabular-nums text-dim">
          {value.lat.toFixed(4)}°{value.lat >= 0 ? "N" : "S"}, {value.lng.toFixed(4)}°{value.lng >= 0 ? "E" : "W"}
        </span>
      </div>

      {/* Manual coordinate entry */}
      <div className="flex gap-2">
        <input
          value={value.lat.toFixed(5)}
          onChange={(e) => {
            const lat = parseFloat(e.target.value);
            if (isFinite(lat) && lat >= -90 && lat <= 90) onChange({ ...value, lat });
          }}
          className="w-1/2 rounded-xl border border-border bg-surface px-3 py-2 text-sm tabular-nums outline-none ring-go focus:ring-2"
          placeholder="Latitude"
          aria-label="Latitude"
        />
        <input
          value={value.lng.toFixed(5)}
          onChange={(e) => {
            const lng = parseFloat(e.target.value);
            if (isFinite(lng) && lng >= -180 && lng <= 180) onChange({ ...value, lng });
          }}
          className="w-1/2 rounded-xl border border-border bg-surface px-3 py-2 text-sm tabular-nums outline-none ring-go focus:ring-2"
          placeholder="Longitude"
          aria-label="Longitude"
        />
      </div>
      {value.lat > 15 && value.lng < 10 && (
        <p className="mt-1 text-[10px] text-warning">Latitude {value.lat.toFixed(1)} and longitude {value.lng.toFixed(1)} look transposed — Uganda latitude is roughly 0–4 and longitude 28–36.</p>
      )}
    </div>
  );
}
