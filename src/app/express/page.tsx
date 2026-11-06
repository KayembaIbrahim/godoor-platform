"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import {
  ArrowLeft,
  Package,
  MapPin,
  Navigation,
  Loader2,
  CheckCircle2,
  Truck,
  Phone,
} from "lucide-react";
import { AddressSearchModal } from "@/components/AddressSearchModal";
import { useSession } from "@/lib/session-store";
import { useGeolocation, distanceKm, type LatLng } from "@/lib/location";
import { useRoadRoute } from "@/lib/routing";
import { formatUgx } from "@/lib/utils";
import { createRide, fetchMyRides, type DBRide } from "@/lib/db";
import FareBreakdown from "@/components/FareBreakdown";
import { Logo } from "@/components/Logo";

const LiveTrackingMap = dynamic(
  () => import("@/components/LiveTrackingMap").then((m) => m.LiveTrackingMap),
  {
    ssr: false,
    loading: () => <div className="h-64 rounded-2xl bg-surface animate-pulse" />,
  },
);

type Addr = { place: string; lat: number; lng: number };

type ServerQuote = {
  total_ugx: number;
  fare_ugx?: number;
  service_fee_ugx?: number;
  quote?: {
    base_ugx: number;
    distance_ugx: number;
    time_ugx?: number;
    wait_ugx?: number;
    fare_ugx: number;
    at_minimum?: boolean;
    tier_label?: string;
    distance_km: number;
    duration_min?: number;
  };
};

async function fetchServerQuote(p: Addr, d: Addr): Promise<ServerQuote | null> {
  const r = await fetch("/api/rides/quote", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      pickup_lat: p.lat,
      pickup_lng: p.lng,
      dropoff_lat: d.lat,
      dropoff_lng: d.lng,
      kind: "delivery",
    }),
  });
  if (!r.ok) return null;
  const j = (await r.json()) as {
    quote: ServerQuote["quote"];
    service_fee_ugx: number;
    total_ugx: number;
    fare_ugx?: number;
  };
  return {
    total_ugx: j.total_ugx,
    fare_ugx: j.fare_ugx ?? j.quote?.fare_ugx,
    service_fee_ugx: j.service_fee_ugx,
    quote: j.quote,
  };
}

const LIVE_RIDE_STATUSES: readonly string[] = ["requested", "accepted", "in_progress"];

export default function GoExpressPage() {
  const { onboarded, profile } = useSession();
  const { coords } = useGeolocation();

  const [pickup, setPickup] = useState<Addr | null>(null);
  const [dropoff, setDropoff] = useState<Addr | null>(null);
  const [parcelDesc, setParcelDesc] = useState("");
  const [parcelPhone, setParcelPhone] = useState("");
  const [modal, setModal] = useState<"pickup" | "dropoff" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successId, setSuccessId] = useState<string | null>(null);

  const [quote, setQuote] = useState<ServerQuote | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);

  const [myRides, setMyRides] = useState<DBRide[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  // Auto-fill pickup with GPS on first paint — same as /ride.
  useEffect(() => {
    if (coords && !pickup) setPickup({ place: "My location", lat: coords.lat, lng: coords.lng });
  }, [coords, pickup]);

  const loadMine = async () => {
    try {
      const rides = await fetchMyRides();
      // Express parcels are stored as ride_requests with vehicle_kind=delivery.
      // Show only those here, so the boda list and parcel list never mix.
      const parcels = rides.filter(
        (r: any) => r.vehicle_kind === "delivery" || r.kind === "delivery",
      );
      setMyRides(parcels);
      const live = parcels.find((r) => LIVE_RIDE_STATUSES.includes(r.status));
      if (live) setActiveId(live.id);
      else if (activeId && !parcels.some((r) => r.id === activeId)) setActiveId(null);
    } catch {}
  };

  useEffect(() => {
    if (!onboarded) return;
    loadMine();
    const id = setInterval(() => { if (!document.hidden) loadMine(); }, 10000);
    document.addEventListener("visibilitychange", loadMine);
    window.addEventListener("focus", loadMine);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", loadMine);
      window.removeEventListener("focus", loadMine);
    };
  }, [onboarded]);

  const km = pickup && dropoff ? distanceKm(pickup, dropoff) : null;
  const route = useRoadRoute(
    pickup ? { lat: pickup.lat, lng: pickup.lng } : null,
    dropoff ? { lat: dropoff.lat, lng: dropoff.lng } : null,
  );
  const previewCoords =
    route.route && route.route.coordinates.length >= 2 ? route.route.coordinates : null;

  useEffect(() => {
    if (!pickup || !dropoff) {
      setQuote(null);
      return;
    }
    const t = setTimeout(() => {
      setQuoteLoading(true);
      fetchServerQuote(pickup, dropoff)
        .then((q) => {
          setQuote(q);
          setQuoteLoading(false);
        })
        .catch(() => setQuoteLoading(false));
    }, 300);
    return () => clearTimeout(t);
  }, [pickup?.lat, pickup?.lng, dropoff?.lat, dropoff?.lng]);

  const activeRide = myRides.find((r) => r.id === activeId) || null;

  const request = async () => {
    if (!pickup || !dropoff || busy) return;
    setBusy(true);
    setError(null);
    try {
      const ride = await createRide({
        customer_name: profile.displayName || profile.name || "Customer",
        customer_phone: parcelPhone || (profile as { phone?: string }).phone || "",
        pickup_lat: pickup.lat,
        pickup_lng: pickup.lng,
        pickup_address: pickup.place,
        dropoff_lat: dropoff.lat,
        dropoff_lng: dropoff.lng,
        dropoff_address: dropoff.place,
        kind: "delivery",
      } as any);
      setSuccessId(ride.id);
      setActiveId(ride.id);
      loadMine();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not request parcel");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto min-h-screen max-w-lg bg-bg px-4 pb-24 pt-4 md:max-w-4xl">
      <header className="sticky top-0 z-20 -mx-4 border-b border-border bg-bg/95 px-4 py-3 backdrop-blur">
        <div className="flex items-center justify-between gap-3">
          <Link href="/" aria-label="GoDoor home" className="min-h-11 shrink-0 transition-transform active:scale-95">
            <Logo size="sm" maxWidth={76} />
          </Link>
          <Link
            href="/app"
            className="inline-flex items-center gap-1 rounded-lg py-1 pr-2 text-sm font-medium text-muted transition hover:text-fg"
          >
            <ArrowLeft className="h-4 w-4" />
            Home
          </Link>
        </div>
      </header>

      <div className="flex items-center gap-3 pt-4">
        <div className="grid h-11 w-11 place-items-center rounded-2xl bg-[#8B5CF6] text-white">
          <Package className="h-6 w-6" />
        </div>
        <div>
          <h1 className="font-display text-lg font-bold">GoExpress Parcel</h1>
          <p className="text-[11px] text-muted">Send packages, keys &amp; documents — like boda, with map locations</p>
        </div>
      </div>

      {error && (
        <div className="mt-3 rounded-xl border border-danger/20 bg-danger/10 px-3 py-2.5 flex items-center gap-2">
          <span className="h-4 w-4 text-danger shrink-0">!</span>
          <p className="text-xs text-danger">{error}</p>
        </div>
      )}

      {successId && !error && (
        <div className="mt-4 rounded-2xl border border-success/30 bg-success/10 p-4 text-center">
          <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-success/20 border border-success/30 mb-2">
            <CheckCircle2 className="h-7 w-7 text-success" />
          </div>
          <h3 className="font-display text-base font-bold">Parcel requested!</h3>
          <p className="mt-1 text-xs text-muted">
            A verified GoExpress rider is arriving at your pickup location. Track it in Orders.
          </p>
          <div className="mt-3 flex gap-2">
            <Link
              href="/orders"
              className="flex-1 rounded-xl bg-[#8B5CF6] py-2.5 text-center text-xs font-bold text-white"
            >
              Track in Orders
            </Link>
            <button
              type="button"
              onClick={() => {
                setSuccessId(null);
                setPickup(null);
                setDropoff(null);
                setParcelDesc("");
              }}
              className="flex-1 rounded-xl border border-border bg-surface py-2.5 text-xs font-bold text-muted"
            >
              Send another
            </button>
          </div>
        </div>
      )}

      {!successId && (
        <>
          <div className="md:grid md:grid-cols-[1fr_1.25fr] md:items-start md:gap-4">
            <div className="mt-4 space-y-3">
              {/* Pickup / dropoff — identical to /ride */}
              <div className="rounded-2xl border border-border bg-surface p-3">
                <button
                  type="button"
                  onClick={() => setModal("pickup")}
                  className="flex w-full items-center gap-2.5 rounded-xl bg-elevated/60 px-3 py-3 text-left hover:bg-elevated transition"
                >
                  <span className="h-2.5 w-2.5 rounded-full bg-success shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[10px] uppercase tracking-wider text-dim">Pickup</span>
                    <span className="block truncate text-sm font-medium">{pickup?.place || "Choose pickup location"}</span>
                  </span>
                  <MapPin className="h-4 w-4 text-dim shrink-0" />
                </button>
                <button
                  type="button"
                  onClick={() => setModal("dropoff")}
                  className="mt-2 flex w-full items-center gap-2.5 rounded-xl bg-elevated/60 px-3 py-3 text-left hover:bg-elevated transition"
                >
                  <span className="h-2.5 w-2.5 rounded-full bg-primary shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[10px] uppercase tracking-wider text-dim">Dropoff</span>
                    <span className="block truncate text-sm font-medium">{dropoff?.place || "Where to?"}</span>
                  </span>
                  <Navigation className="h-4 w-4 text-dim shrink-0" />
                </button>
              </div>

              {/* Parcel details */}
              <div className="rounded-2xl border border-border bg-surface p-3">
                <label className="block text-[10px] uppercase tracking-wider text-dim">Package description</label>
                <input
                  type="text"
                  placeholder="e.g. Small box, keys, documents"
                  value={parcelDesc}
                  onChange={(e) => setParcelDesc(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-border bg-elevated/60 px-3 py-2.5 text-sm outline-none ring-[#8B5CF6] focus:ring-2"
                />
                <label className="mt-3 block text-[10px] uppercase tracking-wider text-dim">Recipient phone (optional)</label>
                <input
                  type="tel"
                  placeholder="07…"
                  value={parcelPhone}
                  onChange={(e) => setParcelPhone(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-border bg-elevated/60 px-3 py-2.5 text-sm outline-none ring-[#8B5CF6] focus:ring-2"
                />
              </div>
            </div>

            <div>
              {/* Route preview + fare — same as /ride */}
              {pickup && dropoff && (
                <div className="mt-3 overflow-hidden rounded-2xl border border-border bg-surface">
                  <div className="h-56 w-full">
                    <LiveTrackingMap
                      fill
                      riderLoc={null}
                      dropoffLoc={{ lat: dropoff.lat, lng: dropoff.lng }}
                      pickupLoc={{ lat: pickup.lat, lng: pickup.lng }}
                      showPickup
                      onDropoffDragEnd={(c) => setDropoff({ place: c.place, lat: c.lat, lng: c.lng })}
                      onPickupDragEnd={(c) => setPickup({ place: c.place, lat: c.lat, lng: c.lng })}
                      roadRoute={previewCoords}
                      maneuvers={route.route?.maneuvers ?? null}
                      label="Parcel route"
                      merchantName="Pickup"
                      customerName="Dropoff"
                    />
                  </div>
                  <div className="grid grid-cols-3 divide-x divide-border p-3 text-center">
                    <div>
                      <p className="text-[9px] uppercase tracking-wider text-dim">Distance</p>
                      <p className="text-sm font-bold tabular-nums">{km !== null ? `${km.toFixed(1)} km` : "—"}</p>
                    </div>
                    <div>
                      <p className="text-[9px] uppercase tracking-wider text-dim">
                        Fare{quote?.quote?.tier_label ? ` · ${quote.quote.tier_label}` : ""}
                      </p>
                      <p className="text-sm font-bold tabular-nums">
                        {quoteLoading ? "…" : formatUgx(quote?.total_ugx ?? 0)}
                      </p>
                    </div>
                    <div>
                      <p className="text-[9px] uppercase tracking-wider text-dim">Delivery</p>
                      <p className="flex items-center justify-center gap-1 text-sm font-bold">
                        <Truck className="h-3 w-3 text-[#8B5CF6]" /> ~30 min
                      </p>
                    </div>
                  </div>
                  {quote?.quote && (
                    <div className="border-t border-border px-3 py-3">
                      <FareBreakdown
                        quote={{
                          base_ugx: quote.quote.base_ugx,
                          distance_ugx: quote.quote.distance_ugx,
                          time_ugx: quote.quote.time_ugx,
                          wait_ugx: quote.quote.wait_ugx,
                          fare_ugx: quote.quote.fare_ugx,
                          service_fee_ugx: quote.service_fee_ugx ?? 0,
                          total_ugx: quote.total_ugx,
                          at_minimum: quote.quote.at_minimum,
                          tier_label: quote.quote.tier_label,
                          distance_km: quote.quote.distance_km,
                        }}
                        compact
                      />
                    </div>
                  )}
                  <div className="px-3 pb-3 text-[10px] text-dim">
                    <p>Pay in GoDoor Wallet. What you see is what you pay.</p>
                    <p>Tip: Drag the destination pin to the exact gate — the rider sees the exact spot (like Uber/Glovo).</p>
                  </div>
                </div>
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={request}
            disabled={busy || !pickup || !dropoff || !onboarded}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-[#8B5CF6] py-3.5 text-sm font-semibold text-white hover:bg-[#7c3aed] transition disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Package className="h-4 w-4" />}
            {busy ? "Requesting…" : !onboarded ? "Sign in to send parcel" : "Request Express Rider"}
          </button>

          {/* My parcels */}
          {myRides.length > 0 && (
            <div className="mt-5">
              <h3 className="text-sm font-semibold">My parcels</h3>
              <div className="mt-2 space-y-2">
                {myRides.slice(0, 5).map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => setActiveId(r.id)}
                    className="flex w-full items-center justify-between rounded-2xl border border-border bg-surface p-3.5 text-left hover:bg-elevated transition"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">
                        {r.pickup_address || "Pickup"} → {r.dropoff_address || "Dropoff"}
                      </p>
                      <p className="text-[10px] text-muted">
                        {new Date(r.created_at).toLocaleString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                          month: "short",
                          day: "numeric",
                        })}
                        {r.distance_km ? ` · ${Number(r.distance_km).toFixed(1)} km` : ""} · {formatUgx(r.total_ugx)}
                      </p>
                    </div>
                    <span className="shrink-0 rounded-full bg-elevated px-2 py-0.5 text-[9px] font-bold capitalize text-muted">
                      {r.status.replace("_", " ")}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      <AddressSearchModal
        open={modal !== null}
        onClose={() => setModal(null)}
        onSelect={(r) => {
          if (modal === "pickup") setPickup(r);
          else if (modal === "dropoff") setDropoff(r);
          setModal(null);
        }}
      />

      <div className="mt-4 flex items-center justify-center gap-3 text-[11px] text-muted">
        <a href="tel:" className="flex items-center gap-1">
          <Phone className="h-3 w-3" /> Need help? Chat support in Orders
        </a>
      </div>
    </div>
  );
}
