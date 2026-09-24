"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { ArrowLeft, MapPin, Navigation, Bike, Phone, X, Loader2, Clock } from "lucide-react";
import { AddressSearchModal } from "@/components/AddressSearchModal";
import { useSession } from "@/lib/session-store";
import { useGeolocation, distanceKm, type LatLng } from "@/lib/location";
import { useRoadRoute } from "@/lib/routing";
import { formatUgx } from "@/lib/utils";
import { createRide, fetchMyRides, fetchRideById, rideAction, subscribeToRide, fetchRiderLocation, subscribeToRiderLocation, type DBRide } from "@/lib/db";

const LiveTrackingMap = dynamic(() => import("@/components/LiveTrackingMap").then((m) => m.LiveTrackingMap), {
  ssr: false,
  loading: () => <div className="h-64 rounded-2xl bg-surface animate-pulse" />,
});

const BODA_BASE = 2000;
const BODA_PER_KM = 1200;

function estimateFare(km: number | null): { fare: number; fee: number; total: number } {
  if (km === null || km <= 0) return { fare: 0, fee: 0, total: 0 };
  const fare = Math.max(2500, Math.round(BODA_BASE + km * BODA_PER_KM));
  const fee = Math.round((fare * 5) / 100);
  return { fare, fee, total: fare + fee };
}

type Addr = { place: string; lat: number; lng: number };

function ActiveRideCard({ ride: initial }: { ride: DBRide }) {
  const [ride, setRide] = useState(initial);
  const [riderLoc, setRiderLoc] = useState<LatLng | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { setRide(initial); }, [initial.id]); // eslint-disable-line

  useEffect(() => {
    const unsub = subscribeToRide(ride.id, (r) => setRide(r));
    const id = setInterval(() => {
      fetchRideById(ride.id).then((r) => { if (r) setRide(r); });
    }, 15000);
    return () => { unsub(); clearInterval(id); };
  }, [ride.id]);

  useEffect(() => {
    if (!ride.rider_id) return;
    fetchRiderLocation(ride.rider_id).then((l) => { if (l) setRiderLoc({ lat: l.lat, lng: l.lng }); });
    const unsub = subscribeToRiderLocation(ride.rider_id, (l) => setRiderLoc({ lat: l.lat, lng: l.lng }));
    return () => { unsub(); };
  }, [ride.rider_id]);

  const pickup = { lat: ride.pickup_lat, lng: ride.pickup_lng };
  const drop = { lat: ride.dropoff_lat, lng: ride.dropoff_lng };
  const { route } = useRoadRoute(pickup, drop);
  const roadCoords = route && route.coordinates.length >= 2 ? route.coordinates : null;

  const cancel = async () => {
    setBusy(true);
    try {
      const r = await rideAction(ride.id, "cancel");
      setRide(r);
    } catch {}
    setBusy(false);
  };

  const statusLabel =
    ride.status === "requested" ? "Finding your rider…" :
    ride.status === "accepted" ? "Rider on the way to you" :
    ride.status === "in_progress" ? "Trip in progress" :
    ride.status === "completed" ? "Trip completed" : "Cancelled";

  return (
    <div className="overflow-hidden rounded-2xl border border-[#f97316]/40 bg-surface">
      <div className="h-[52vh] min-h-[340px] w-full">
        <LiveTrackingMap
          fill
          riderLoc={riderLoc}
          dropoffLoc={drop}
          pickupLoc={pickup}
          showPickup
          roadRoute={roadCoords}
          label={statusLabel}
          merchantName="Pickup"
          customerName="You"
        />
      </div>
      <div className="p-4">
        <p className="text-sm font-bold">{statusLabel}</p>
        <p className="mt-1 text-xs text-muted">{ride.pickup_address || "Pickup"} → {ride.dropoff_address || "Dropoff"}</p>
        {ride.rider_name ? (
          <p className="mt-1 text-xs text-muted">Rider: <span className="font-semibold text-fg">{ride.rider_name}</span></p>
        ) : (
          <p className="mt-1 text-xs text-muted">Nearby boda riders have been notified.</p>
        )}
        <div className="mt-2 flex items-center justify-between">
          <p className="text-sm font-bold text-[#f97316] tabular-nums">{formatUgx(ride.total_ugx)} <span className="text-[10px] font-normal text-dim">incl. 5% service fee</span></p>
          {["requested", "accepted"].includes(ride.status) && (
            <button type="button" onClick={cancel} disabled={busy}
              className="rounded-xl bg-danger/10 px-3 py-2 text-xs font-semibold text-danger disabled:opacity-50">
              {busy ? "Cancelling…" : "Cancel ride"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function RidePage() {
  const { onboarded, profile } = useSession();
  const { coords } = useGeolocation();
  const [pickup, setPickup] = useState<Addr | null>(null);
  const [dropoff, setDropoff] = useState<Addr | null>(null);
  const [modal, setModal] = useState<"pickup" | "dropoff" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [myRides, setMyRides] = useState<DBRide[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    if (coords && !pickup) setPickup({ place: "My location", lat: coords.lat, lng: coords.lng });
  }, [coords]); // eslint-disable-line

  const loadMine = useCallback(() => {
    fetchMyRides().then((rs) => {
      setMyRides(rs);
      const active = rs.find((r) => ["requested", "accepted", "in_progress"].includes(r.status));
      setActiveId(active ? active.id : null);
    }).catch(() => {});
  }, []);
  useEffect(() => { if (onboarded) loadMine(); }, [onboarded, loadMine]);

  const activeRide = myRides.find((r) => r.id === activeId) || null;

  const km = pickup && dropoff ? distanceKm(pickup, dropoff) : null;
  const est = useMemo(() => estimateFare(km), [km]);
  const previewRoute = useRoadRoute(
    pickup ? { lat: pickup.lat, lng: pickup.lng } : null,
    dropoff ? { lat: dropoff.lat, lng: dropoff.lng } : null,
  );
  const previewCoords = previewRoute.route && previewRoute.route.coordinates.length >= 2
    ? previewRoute.route.coordinates : null;

  const request = async () => {
    if (!pickup || !dropoff || busy) return;
    setBusy(true);
    setError(null);
    try {
      const ride = await createRide({
        customer_name: profile.displayName || profile.name || "Customer",
        customer_phone: (profile as { phone?: string }).phone || "",
        pickup_lat: pickup.lat,
        pickup_lng: pickup.lng,
        pickup_address: pickup.place,
        dropoff_lat: dropoff.lat,
        dropoff_lng: dropoff.lng,
        dropoff_address: dropoff.place,
      });
      setActiveId(ride.id);
      loadMine();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not request ride");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto min-h-screen max-w-lg bg-bg px-4 pb-24 pt-4">
      <div className="flex items-center gap-3">
        <Link href="/app" className="grid h-9 w-9 place-items-center rounded-full bg-surface text-muted hover:bg-elevated transition">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div>
          <h1 className="font-display text-lg font-bold flex items-center gap-2">
            <Bike className="h-5 w-5 text-[#f97316]" /> Boda Ride
          </h1>
          <p className="text-[11px] text-muted">Door-to-door boda, tracked live</p>
        </div>
      </div>

      {error && (
        <div className="mt-3 rounded-xl border border-danger/20 bg-danger/10 px-3 py-2.5 flex items-center gap-2">
          <X className="h-4 w-4 text-danger shrink-0" />
          <p className="text-xs text-danger">{error}</p>
        </div>
      )}

      {/* Active ride first — tracking is the hero */}
      {activeRide ? (
        <div className="mt-4">
          <ActiveRideCard ride={activeRide} />
          <button type="button" onClick={() => setActiveId(null)}
            className="mt-3 w-full rounded-xl border border-border bg-surface py-2.5 text-xs font-semibold text-muted">
            Book another ride
          </button>
        </div>
      ) : (
        <>
          {/* Pickup / dropoff */}
          <div className="mt-4 space-y-2 rounded-2xl border border-border bg-surface p-3">
            <button type="button" onClick={() => setModal("pickup")}
              className="flex w-full items-center gap-2.5 rounded-xl bg-elevated/60 px-3 py-3 text-left hover:bg-elevated transition">
              <span className="h-2.5 w-2.5 rounded-full bg-success shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="block text-[10px] uppercase tracking-wider text-dim">Pickup</span>
                <span className="block truncate text-sm font-medium">{pickup?.place || "Choose pickup"}</span>
              </span>
              <MapPin className="h-4 w-4 text-dim shrink-0" />
            </button>
            <button type="button" onClick={() => setModal("dropoff")}
              className="flex w-full items-center gap-2.5 rounded-xl bg-elevated/60 px-3 py-3 text-left hover:bg-elevated transition">
              <span className="h-2.5 w-2.5 rounded-full bg-[#f97316] shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="block text-[10px] uppercase tracking-wider text-dim">Dropoff</span>
                <span className="block truncate text-sm font-medium">{dropoff?.place || "Where to?"}</span>
              </span>
              <Navigation className="h-4 w-4 text-dim shrink-0" />
            </button>
          </div>

          {/* Route preview + fare */}
          {pickup && dropoff && (
            <div className="mt-3 overflow-hidden rounded-2xl border border-border bg-surface">
              <div className="h-56 w-full">
                <LiveTrackingMap
                  fill
                  riderLoc={null}
                  dropoffLoc={{ lat: dropoff.lat, lng: dropoff.lng }}
                  pickupLoc={{ lat: pickup.lat, lng: pickup.lng }}
                  showPickup
                  roadRoute={previewCoords}
                  label="Your route"
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
                  <p className="text-[9px] uppercase tracking-wider text-dim">Fare</p>
                  <p className="text-sm font-bold tabular-nums">{formatUgx(est.total)}</p>
                </div>
                <div>
                  <p className="text-[9px] uppercase tracking-wider text-dim">ETA pickup</p>
                  <p className="flex items-center justify-center gap-1 text-sm font-bold"><Clock className="h-3 w-3 text-[#f97316]" /> ~10 min</p>
                </div>
              </div>
              <p className="px-3 pb-3 text-[10px] text-dim">Includes 5% GoDoor service fee. Pay the rider directly (cash / MoMo).</p>
            </div>
          )}

          <button type="button" onClick={request} disabled={busy || !pickup || !dropoff || !onboarded}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-[#f97316] py-3.5 text-sm font-semibold text-white hover:bg-[#ea580c] transition disabled:opacity-50">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bike className="h-4 w-4" />}
            {busy ? "Requesting…" : !onboarded ? "Sign in to request a ride" : "Request boda ride"}
          </button>

          {/* Past rides */}
          {myRides.length > 0 && (
            <div className="mt-5">
              <h3 className="text-sm font-semibold">My rides</h3>
              <div className="mt-2 space-y-2">
                {myRides.slice(0, 5).map((r) => (
                  <button key={r.id} type="button" onClick={() => setActiveId(r.id)}
                    className="flex w-full items-center justify-between rounded-2xl border border-border bg-surface p-3.5 text-left hover:bg-elevated transition">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{r.pickup_address || "Pickup"} → {r.dropoff_address || "Dropoff"}</p>
                      <p className="text-[10px] text-muted">{new Date(r.created_at).toLocaleString([], { hour: "2-digit", minute: "2-digit", month: "short", day: "numeric" })} · {formatUgx(r.total_ugx)}</p>
                    </div>
                    <span className="shrink-0 rounded-full bg-elevated px-2 py-0.5 text-[9px] font-bold capitalize text-muted">{r.status.replace("_", " ")}</span>
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
        <a href="tel:" className="flex items-center gap-1"><Phone className="h-3 w-3" /> Need help? Chat support in Orders</a>
      </div>
    </div>
  );
}
