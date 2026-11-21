"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import dynamic from "next/dynamic";
import {
  Navigation,
  Truck,
  Bike,
  Package,
  Phone,
  RefreshCw,
  Search,
  MapPin,
  Clock,
  CheckCircle2,
  AlertCircle,
  ChevronRight,
  User,
  ShieldCheck,
  Star,
  ExternalLink,
} from "lucide-react";
import { formatUgx } from "@/lib/utils";
import type { LatLng } from "@/lib/location";
import type { MarkerData } from "@/components/MapboxMap";

const MapboxMapView = dynamic(() => import("@/components/MapboxMap"), {
  ssr: false,
  loading: () => (
    <div className="grid h-[68vh] w-full place-items-center rounded-2xl border border-border bg-surface">
      <div className="flex items-center gap-2 text-sm text-muted">
        <div className="h-4 w-4 animate-spin rounded-full border-2 border-go border-t-transparent" />
        Loading Fleet Radar…
      </div>
    </div>
  ),
});

type LiveRider = {
  id: string;
  name: string;
  phone: string;
  email: string;
  vehicle_type: string;
  plate: string;
  status: "online" | "busy" | "offline" | "suspended";
  verified: boolean;
  total_deliveries: number;
  rating: number;
  current_lat?: number | null;
  current_lng?: number | null;
  current_heading?: number | null;
  current_accuracy?: number | null;
  current_speed?: number | null;
  last_updated?: string | null;
};

type ActiveOrder = {
  id: string;
  merchant_name: string;
  customer_name: string;
  customer_phone?: string;
  customer_lat?: number | null;
  customer_lng?: number | null;
  delivery_address: string;
  status: string;
  total_ugx: number;
  rider_id?: string | null;
  rider_name?: string | null;
  created_at: number;
};

const CITY_COORDS: Record<string, { lat: number; lng: number; zoom: number }> = {
  Kampala: { lat: 0.3163, lng: 32.5822, zoom: 13 },
  Entebbe: { lat: 0.0645, lng: 32.4469, zoom: 13.5 },
  Jinja: { lat: 0.4244, lng: 33.2042, zoom: 13.5 },
  Masaka: { lat: -0.3356, lng: 31.7341, zoom: 13.5 },
};

export default function AdminFleetRadarPage() {
  const [riders, setRiders] = useState<LiveRider[]>([]);
  const [orders, setOrders] = useState<ActiveOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [statusFilter, setStatusFilter] = useState<"all" | "online" | "busy" | "trips">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedRider, setSelectedRider] = useState<LiveRider | null>(null);
  const [selectedOrder, setSelectedOrder] = useState<ActiveOrder | null>(null);
  const [reassigningOrder, setReassigningOrder] = useState<ActiveOrder | null>(null);
  const [reassignRiderId, setReassignRiderId] = useState<string>("");
  const [reassignBusy, setReassignBusy] = useState(false);
  const [reassignMsg, setReassignMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [mapCenter, setMapCenter] = useState<LatLng>({ lat: 0.3163, lng: 32.5822 });
  const [mapZoom, setMapZoom] = useState(12.5);

  const loadFleet = useCallback(async (isPoll = false) => {
    if (!isPoll) setRefreshing(true);
    try {
      const [ridersRes, ordersRes] = await Promise.all([
        fetch("/api/admin/riders?include_locations=true", { cache: "no-store" }),
        fetch("/api/admin/orders", { cache: "no-store" }),
      ]);

      if (ridersRes.ok) {
        const d = await ridersRes.json();
        if (Array.isArray(d.riders)) {
          setRiders(d.riders);
        }
      }

      if (ordersRes.ok) {
        const d = await ordersRes.json();
        if (Array.isArray(d.orders)) {
          setOrders(d.orders);
        }
      }
    } catch (e) {
      console.error("[FleetRadar] fetch error:", e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadFleet();
    const interval = setInterval(() => {
      if (!document.hidden) loadFleet(true);
    }, 10000);
    return () => clearInterval(interval);
  }, [loadFleet]);

  // Active in-transit deliveries
  const inTransitOrders = useMemo(
    () => orders.filter((o) => ["rider_assigned", "delivering", "preparing"].includes(o.status)),
    [orders]
  );

  // Online / busy riders with real GPS coordinates
  const mappedRiders = useMemo(() => {
    return riders.filter((r) => {
      const hasGps = r.current_lat != null && r.current_lng != null && Math.abs(r.current_lat) > 1e-6;
      if (!hasGps) return false;
      if (statusFilter === "online") return r.status === "online";
      if (statusFilter === "busy") return r.status === "busy";
      return true;
    });
  }, [riders, statusFilter]);

  // Markers for Mapbox GL JS
  const mapMarkers = useMemo<MarkerData[]>(() => {
    const list: MarkerData[] = [];

    // Rider Markers
    for (const r of mappedRiders) {
      if (r.current_lat == null || r.current_lng == null) continue;
      list.push({
        id: `rider-${r.id}`,
        position: { lat: Number(r.current_lat), lng: Number(r.current_lng) },
        isRider: true,
        label: `${r.name} (${r.status})`,
        heading: r.current_heading || null,
        accuracy: r.current_accuracy || null,
        vehicleType: r.vehicle_type || "motorbike",
      });
    }

    // Active Delivery Customer Markers
    for (const o of inTransitOrders) {
      if (o.customer_lat == null || o.customer_lng == null || Math.abs(o.customer_lat) <= 1e-6) continue;
      list.push({
        id: `order-dropoff-${o.id}`,
        position: { lat: Number(o.customer_lat), lng: Number(o.customer_lng) },
        isDestination: true,
        label: `Order #${o.id.slice(0, 6)} (${o.customer_name})`,
      });
    }

    return list;
  }, [mappedRiders, inTransitOrders]);

  // Fit bounds array
  const fitCoords = useMemo<LatLng[]>(() => {
    return mapMarkers.map((m) => m.position);
  }, [mapMarkers]);

  const handleReassign = async () => {
    if (!reassigningOrder || !reassignRiderId) return;
    setReassignBusy(true);
    setReassignMsg(null);
    try {
      const targetRider = riders.find((r) => r.id === reassignRiderId);
      const res = await fetch("/api/admin/orders", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: reassigningOrder.id,
          rider_id: reassignRiderId,
          rider_name: targetRider?.name || "Rider",
          status: "rider_assigned",
        }),
      });

      const d = await res.json();
      if (!res.ok || !d.ok) throw new Error(d.error || "Failed to reassign order");

      setReassignMsg({ ok: true, text: `Order successfully reassigned to ${targetRider?.name || "rider"}!` });
      await loadFleet();
      setTimeout(() => {
        setReassigningOrder(null);
        setReassignMsg(null);
      }, 1500);
    } catch (e) {
      setReassignMsg({ ok: false, text: e instanceof Error ? e.message : "Reassignment failed" });
    } finally {
      setReassignBusy(false);
    }
  };

  const jumpToCity = (cityName: keyof typeof CITY_COORDS) => {
    const target = CITY_COORDS[cityName];
    if (target) {
      setMapCenter({ lat: target.lat, lng: target.lng });
      setMapZoom(target.zoom);
    }
  };

  const activeRidersCount = riders.filter((r) => r.status === "online" || r.status === "busy").length;
  const onlineRidersCount = riders.filter((r) => r.status === "online").length;
  const busyRidersCount = riders.filter((r) => r.status === "busy").length;

  return (
    <div className="pb-24 md:pb-6 animate-fade-in">
      {/* Header & Live Pulse */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-display text-2xl font-bold">Live Fleet Radar</h1>
            <span className="flex items-center gap-1.5 rounded-full bg-success/15 px-3 py-1 text-[11px] font-bold text-success">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
              </span>
              Real-Time Fleet Telemetry
            </span>
          </div>
          <p className="mt-1 text-xs text-muted">
            Uber/Bolt-style nationwide operations console · Uganda active riders & deliveries
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => loadFleet()}
            disabled={refreshing}
            className="flex items-center gap-1.5 rounded-xl border border-border bg-surface px-3 py-2 text-xs font-semibold text-fg hover:bg-elevated transition"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin text-go" : ""}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* Metric Cards Row */}
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-2xl border border-border bg-surface p-3.5">
          <p className="text-[10px] font-bold uppercase tracking-wider text-dim">Total Fleet</p>
          <p className="mt-1 font-display text-xl font-bold">{riders.length}</p>
          <p className="text-[10px] text-muted">{riders.filter((r) => r.verified).length} verified drivers</p>
        </div>
        <div className="rounded-2xl border border-border bg-surface p-3.5">
          <p className="text-[10px] font-bold uppercase tracking-wider text-dim">Active On Road</p>
          <p className="mt-1 font-display text-xl font-bold text-go">{activeRidersCount}</p>
          <p className="text-[10px] text-muted">{onlineRidersCount} available · {busyRidersCount} on job</p>
        </div>
        <div className="rounded-2xl border border-border bg-surface p-3.5">
          <p className="text-[10px] font-bold uppercase tracking-wider text-dim">Active Deliveries</p>
          <p className="mt-1 font-display text-xl font-bold text-primary">{inTransitOrders.length}</p>
          <p className="text-[10px] text-muted">In transit or preparing</p>
        </div>
        <div className="rounded-2xl border border-border bg-surface p-3.5">
          <p className="text-[10px] font-bold uppercase tracking-wider text-dim">Mapped Fleet GPS</p>
          <p className="mt-1 font-display text-xl font-bold text-success">{mappedRiders.length}</p>
          <p className="text-[10px] text-muted">Transmitting live coords</p>
        </div>
      </div>

      {/* Main Grid: Live Map + Operations Sidebar */}
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Map Column (2 spans on desktop) */}
        <div className="lg:col-span-2">
          <div className="relative overflow-hidden rounded-2xl border border-border bg-surface shadow-xl shadow-black/15">
            {/* City Jump Pills */}
            <div className="absolute left-3 top-3 z-10 flex flex-wrap items-center gap-1.5 rounded-2xl border border-border bg-surface/90 p-1.5 shadow-lg backdrop-blur-md">
              <span className="px-2 text-[10px] font-bold uppercase tracking-wider text-dim">Jump:</span>
              {(Object.keys(CITY_COORDS) as Array<keyof typeof CITY_COORDS>).map((city) => (
                <button
                  key={city}
                  type="button"
                  onClick={() => jumpToCity(city)}
                  className="rounded-xl px-2.5 py-1 text-xs font-semibold text-fg hover:bg-elevated active:scale-95 transition"
                >
                  {city}
                </button>
              ))}
              <button
                type="button"
                onClick={() => {
                  if (typeof window !== "undefined") {
                    window.dispatchEvent(new CustomEvent("godoor:recenter"));
                  }
                }}
                className="rounded-xl bg-go/15 px-2.5 py-1 text-xs font-bold text-go hover:bg-go/25 transition"
              >
                Fit All
              </button>
            </div>

            <MapboxMapView
              center={mapCenter}
              zoom={mapZoom}
              height={560}
              fitBounds={fitCoords.length >= 2 ? fitCoords : undefined}
              markers={mapMarkers}
              fitPadding={{ top: 72, bottom: 64, left: 64, right: 64 }}
            />
          </div>

          {/* Quick Map Legend */}
          <div className="mt-2.5 flex flex-wrap items-center gap-4 text-xs text-muted">
            <span className="flex items-center gap-1.5">
              <span className="h-3 w-3 rounded-full bg-success ring-2 ring-success/30" /> Online Rider
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-3 w-3 rounded-full bg-go ring-2 ring-go/30 animate-pulse" /> Busy / Delivering
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-3 w-3 rounded-full bg-primary" /> Delivery Dropoff
            </span>
          </div>
        </div>

        {/* Operations Sidebar */}
        <div className="space-y-3">
          {/* Status Filter Tabs */}
          <div className="flex rounded-2xl border border-border bg-surface p-1">
            <button
              type="button"
              onClick={() => setStatusFilter("all")}
              className={`flex-1 rounded-xl py-2 text-xs font-bold transition ${
                statusFilter === "all" ? "bg-primary text-white" : "text-muted hover:text-fg"
              }`}
            >
              All ({riders.length})
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter("online")}
              className={`flex-1 rounded-xl py-2 text-xs font-bold transition ${
                statusFilter === "online" ? "bg-primary text-white" : "text-muted hover:text-fg"
              }`}
            >
              Online ({onlineRidersCount})
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter("busy")}
              className={`flex-1 rounded-xl py-2 text-xs font-bold transition ${
                statusFilter === "busy" ? "bg-primary text-white" : "text-muted hover:text-fg"
              }`}
            >
              Busy ({busyRidersCount})
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter("trips")}
              className={`flex-1 rounded-xl py-2 text-xs font-bold transition ${
                statusFilter === "trips" ? "bg-primary text-white" : "text-muted hover:text-fg"
              }`}
            >
              Trips ({inTransitOrders.length})
            </button>
          </div>

          {/* Search Bar */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-dim" />
            <input
              type="text"
              placeholder="Search rider, phone, or order…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-2xl border border-border bg-surface py-2.5 pl-9 pr-3 text-xs placeholder:text-dim focus:border-primary focus:outline-none"
            />
          </div>

          {/* Rider / Order List Container */}
          <div className="max-h-[460px] space-y-2 overflow-y-auto pr-1">
            {statusFilter === "trips" ? (
              inTransitOrders.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-border bg-surface/50 p-6 text-center text-xs text-muted">
                  No active orders in transit
                </div>
              ) : (
                inTransitOrders.map((o) => (
                  <div
                    key={o.id}
                    onClick={() => {
                      setSelectedOrder(o);
                      if (o.customer_lat && o.customer_lng) {
                        setMapCenter({ lat: o.customer_lat, lng: o.customer_lng });
                        setMapZoom(14.5);
                      }
                    }}
                    className={`cursor-pointer rounded-2xl border p-3.5 transition ${
                      selectedOrder?.id === o.id
                        ? "border-primary bg-primary/10 shadow-md"
                        : "border-border bg-surface hover:bg-elevated"
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="text-xs font-bold text-fg">Order #{o.id.slice(0, 8)}</p>
                        <p className="mt-0.5 text-[11px] text-muted">{o.merchant_name} → {o.customer_name}</p>
                      </div>
                      <span className="rounded-md bg-primary/15 px-2 py-0.5 text-[10px] font-bold text-primary capitalize">
                        {o.status.replace("_", " ")}
                      </span>
                    </div>
                    <p className="mt-1.5 truncate text-[10px] text-dim">{o.delivery_address}</p>
                    <div className="mt-2 flex items-center justify-between border-t border-border pt-2 text-[10px]">
                      <span className="font-semibold text-fg">Rider: {o.rider_name || "Unassigned"}</span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setReassigningOrder(o);
                        }}
                        className="rounded-lg bg-elevated px-2 py-1 font-bold text-go hover:bg-go/15 transition"
                      >
                        Reassign Driver
                      </button>
                    </div>
                  </div>
                ))
              )
            ) : (
              mappedRiders
                .filter((r) => {
                  if (!searchQuery.trim()) return true;
                  const q = searchQuery.toLowerCase();
                  return r.name.toLowerCase().includes(q) || r.phone.includes(q) || r.vehicle_type.toLowerCase().includes(q);
                })
                .map((r) => (
                  <div
                    key={r.id}
                    onClick={() => {
                      setSelectedRider(r);
                      if (r.current_lat && r.current_lng) {
                        setMapCenter({ lat: Number(r.current_lat), lng: Number(r.current_lng) });
                        setMapZoom(15);
                      }
                    }}
                    className={`cursor-pointer rounded-2xl border p-3.5 transition ${
                      selectedRider?.id === r.id
                        ? "border-primary bg-primary/10 shadow-md"
                        : "border-border bg-surface hover:bg-elevated"
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-2">
                        <span
                          className={`h-2.5 w-2.5 rounded-full ${
                            r.status === "online"
                              ? "bg-success"
                              : r.status === "busy"
                              ? "bg-go animate-pulse"
                              : "bg-muted"
                          }`}
                        />
                        <div>
                          <p className="text-xs font-bold text-fg flex items-center gap-1.5">
                            {r.name}
                            {r.verified && <ShieldCheck className="h-3 w-3 text-success" />}
                          </p>
                          <p className="text-[10px] text-muted">{r.phone} · {r.vehicle_type}</p>
                        </div>
                      </div>
                      <span
                        className={`rounded-md px-2 py-0.5 text-[10px] font-bold capitalize ${
                          r.status === "online"
                            ? "bg-success/15 text-success"
                            : r.status === "busy"
                            ? "bg-go/15 text-go"
                            : "bg-elevated text-muted"
                        }`}
                      >
                        {r.status}
                      </span>
                    </div>

                    <div className="mt-2 flex items-center justify-between border-t border-border pt-1.5 text-[10px] text-dim">
                      <span>Rating: {r.rating.toFixed(1)} ★</span>
                      <span>{r.total_deliveries} trips</span>
                      {r.phone && (
                        <a
                          href={`tel:${r.phone}`}
                          onClick={(e) => e.stopPropagation()}
                          className="flex items-center gap-1 text-primary hover:underline"
                        >
                          <Phone className="h-2.5 w-2.5" /> Call
                        </a>
                      )}
                    </div>
                  </div>
                ))
            )}
          </div>
        </div>
      </div>

      {/* Reassign Driver Modal */}
      {reassigningOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-3xl border border-border bg-bg p-5 shadow-2xl animate-scale-in">
            <h3 className="font-display text-lg font-bold">Manual Driver Reassignment</h3>
            <p className="mt-1 text-xs text-muted">
              Reassign Order #{reassigningOrder.id.slice(0, 8)} to another online verified rider.
            </p>

            <div className="mt-4 rounded-xl border border-border bg-surface p-3 text-xs">
              <p><span className="text-muted">Merchant:</span> {reassigningOrder.merchant_name}</p>
              <p className="mt-1"><span className="text-muted">Customer:</span> {reassigningOrder.customer_name}</p>
              <p className="mt-1"><span className="text-muted">Current Driver:</span> {reassigningOrder.rider_name || "None"}</p>
            </div>

            <div className="mt-4">
              <label className="block text-xs font-semibold text-fg">Select New Driver:</label>
              <select
                value={reassignRiderId}
                onChange={(e) => setReassignRiderId(e.target.value)}
                className="mt-1.5 w-full rounded-xl border border-border bg-surface p-2.5 text-xs text-fg focus:border-primary focus:outline-none"
              >
                <option value="">Choose an available rider…</option>
                {riders
                  .filter((r) => r.status === "online" || r.status === "busy")
                  .map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name} ({r.status}) — {r.vehicle_type} · {r.phone}
                    </option>
                  ))}
              </select>
            </div>

            {reassignMsg && (
              <p className={`mt-3 text-xs font-semibold ${reassignMsg.ok ? "text-success" : "text-danger"}`}>
                {reassignMsg.text}
              </p>
            )}

            <div className="mt-5 flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setReassigningOrder(null);
                  setReassignMsg(null);
                }}
                className="flex-1 rounded-xl border border-border bg-surface py-2.5 text-xs font-semibold text-muted hover:bg-elevated transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleReassign}
                disabled={reassignBusy || !reassignRiderId}
                className="flex-1 rounded-xl bg-primary py-2.5 text-xs font-bold text-white shadow-md hover:bg-primary-2 disabled:opacity-50 transition"
              >
                {reassignBusy ? "Reassigning…" : "Confirm Reassignment"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
