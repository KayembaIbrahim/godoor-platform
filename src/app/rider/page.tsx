"use client";
import { RiderNav } from "@/components/RiderNav";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import {
  Truck, MapPin, Navigation, Phone, CheckCircle2, X, Clock,
  DollarSign, LogOut, ShieldCheck, Radio, Package, ChevronRight, ExternalLink, Store, History, Bike, User
} from "lucide-react";
import { useSession } from "@/lib/session-store";
import { useNotifications, orderSummary, requestNotificationPermission } from "@/lib/notifications-store";
import { fetchOrders, updateOrder, fetchFeeConfig, updateRiderLocation, updateRiderStatus, getUserVerificationStatus, subscribeToAllOrders, apiAuthHeaders, type DBOrder, type FeeConfig, type RiderAffiliation, fetchMerchants, fetchRiderAffiliations, respondRiderAffiliation, fetchOpenRides, fetchDriverRides, rideAction, subscribeToOpenRides, type DBRide } from "@/lib/db";
import { getSupabase } from "@/lib/supabase";
import { useGeolocation, formatAccuracy, distanceKm, type LatLng } from "@/lib/location";
import { useRoadRoute } from "@/lib/routing";
import { dispatchScore } from "@/lib/dispatch";
import { formatUgx } from "@/lib/utils";
import { Price } from "@/components/Price";
import dynamic from "next/dynamic";
import { SetPasswordGate } from "@/components/SetPasswordGate";

const LiveTrackingMap = dynamic(() => import("@/components/LiveTrackingMap").then(m => m.LiveTrackingMap), {
  ssr: false,
  loading: () => <div className="h-64 rounded-2xl bg-surface animate-pulse" />,
});

type DeliveryRequest = {
  order: DBOrder;
  distanceKm: number;
  fareUgx: number;
  etaMin: number;
  pickupMin: number;
  pickupKm: number;
  pickupName: string;
  customerPhone: string;
};

type MerchantLoc = { name: string; lat: number; lng: number };

// ── Boda mode: riders carry passengers ─────────────────────────
// Transport vertical (Grab/Gojek pattern): a rider flips to Boda mode
// and sees live passenger requests — pickup → dropoff, fare, one-tap accept.
function BodaPanel({ riderName, verifiedOk, isOnline, coords }: {
  riderName: string;
  verifiedOk: boolean;
  isOnline: boolean;
  coords: { lat: number; lng: number } | null;
}) {
  const [rides, setRides] = useState<DBRide[]>([]);
  const [activeRide, setActiveRide] = useState<DBRide | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    fetchOpenRides()
      .then(setRides)
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load ride requests"))
      .finally(() => setLoading(false));
    fetchDriverRides()
      .then((mine) => {
        const active = mine.find((r) => r.status === "accepted" || r.status === "in_progress") || null;
        setActiveRide(active);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    load();
    const unsub = subscribeToOpenRides(() => load());
    const id = setInterval(() => { if (!document.hidden) load(); }, 15000);
    return () => { unsub(); clearInterval(id); };
  }, [load]);

  const act = async (ride: DBRide, action: "accept" | "start" | "complete" | "cancel") => {
    if (busyId) return;
    setBusyId(ride.id);
    setError(null);
    try {
      const updated = await rideAction(ride.id, action, { rider_name: riderName });
      if (action === "cancel" && updated.status === "cancelled") setActiveRide(null);
      else if (updated.status === "accepted" || updated.status === "in_progress") setActiveRide(updated);
      else if (updated.status === "completed") setActiveRide(null);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusyId((cur) => (cur === ride.id ? null : cur));
    }
  };

  const navUrl = (r: DBRide) =>
    `https://www.google.com/maps/dir/?api=1&origin=${r.pickup_lat},${r.pickup_lng}&destination=${r.dropoff_lat},${r.dropoff_lng}&travelmode=driving`;

  if (!verifiedOk) {
    return (
      <div className="rounded-2xl border border-warning/30 bg-warning/5 p-4 mx-4 mt-4">
        <div className="flex items-start gap-2">
          <ShieldCheck className="h-5 w-5 text-warning shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-fg">Verification required for Boda</p>
            <p className="text-xs text-muted mt-0.5">Upload your National ID and vehicle documents to carry passengers.</p>
            <Link href="/verification" className="mt-3 inline-flex items-center gap-1.5 rounded-xl bg-warning/15 px-4 py-2 text-xs font-semibold text-warning hover:bg-warning/25 transition">
              <ShieldCheck className="h-3.5 w-3.5" /> Verify now
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 pt-4 space-y-3 pb-6">
      {!isOnline && (
        <div className="rounded-2xl bg-warning/10 p-4 text-center">
          <p className="text-xs font-medium text-warning">You&apos;re offline</p>
          <p className="text-[10px] text-muted mt-1">Go online to see passenger requests</p>
        </div>
      )}
      {error && (
        <div className="rounded-xl bg-danger/10 border border-danger/30 p-3 flex items-start gap-2">
          <X className="h-4 w-4 text-danger shrink-0 mt-0.5" />
          <p className="text-xs text-danger">{error}</p>
        </div>
      )}

      {/* Active ride */}
      {activeRide && (
        <div className="rounded-2xl border border-primary/40 bg-primary/5 p-4">
          <p className="text-[10px] font-bold uppercase tracking-wider text-primary">
            {activeRide.status === "accepted" ? "Heading to passenger" : "Trip in progress"}
          </p>
          <p className="mt-1.5 text-sm font-semibold flex items-center gap-1.5">
            <User className="h-3.5 w-3.5 text-muted" /> {activeRide.customer_name || "Passenger"}
          </p>
          <p className="mt-1 text-xs text-muted">{activeRide.pickup_address || "Pickup"} → {activeRide.dropoff_address || "Dropoff"}</p>
          <p className="mt-1 text-xs font-semibold text-fg tabular-nums">
            {formatUgx(activeRide.total_ugx)} total <span className="font-normal text-muted">({activeRide.distance_km} km)</span>
          </p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <a href={navUrl(activeRide)} target="_blank" rel="noopener noreferrer"
              className="btn flex-1 bg-primary/15 text-primary !border-primary/30 hover:bg-primary/25">
              <Navigation className="h-3 w-3 shrink-0" /> Navigate
            </a>
            {activeRide.status === "accepted" ? (
              <button type="button" onClick={() => act(activeRide, "start")} disabled={busyId === activeRide.id}
                className="btn flex-1 bg-primary text-white hover:bg-primary-2 disabled:opacity-60">
                {busyId === activeRide.id ? "Confirming…" : "Start trip"}
              </button>
            ) : (
              <button type="button" onClick={() => act(activeRide, "complete")} disabled={busyId === activeRide.id}
                className="btn flex-1 bg-success text-white hover:bg-success/90 disabled:opacity-60">
                {busyId === activeRide.id ? "Confirming…" : "Complete trip"}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Open requests */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Passenger requests {rides.length > 0 && <span className="text-muted">({rides.length})</span>}</h3>
        <span className="flex items-center gap-1 text-[10px] text-muted"><span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse" /> Live</span>
      </div>
      {loading ? (
        <div className="h-24 rounded-2xl bg-surface animate-pulse" />
      ) : rides.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-surface/50 p-6 text-center">
          <Bike className="mx-auto h-7 w-7 text-dim" />
          <p className="mt-2 text-sm font-medium">No passengers waiting</p>
          <p className="text-xs text-muted">New ride requests appear here instantly.</p>
        </div>
      ) : (
        rides.map((r) => (
          <div key={r.id} className="rounded-2xl border border-border bg-surface p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold flex items-center gap-1.5">
                  <User className="h-3.5 w-3.5 text-muted shrink-0" /> {r.customer_name || "Passenger"}
                </p>
                <p className="mt-1 text-xs text-muted truncate">📍 {r.pickup_address || "Pickup point"}</p>
                <p className="text-xs text-muted truncate">🏁 {r.dropoff_address || "Destination"}</p>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-sm font-bold text-primary tabular-nums">{formatUgx(r.total_ugx)}</p>
                <p className="text-[10px] text-dim tabular-nums">{r.distance_km} km</p>
              </div>
            </div>
            <button type="button" onClick={() => act(r, "accept")} disabled={busyId === r.id || !!activeRide}
              className="btn mt-3 w-full bg-primary text-white hover:bg-primary-2 disabled:opacity-60">
              {busyId === r.id ? "Accepting…" : activeRide ? "Finish current trip first" : "Accept ride"}
            </button>
          </div>
        ))
      )}
      {coords && (
        <p className="text-center text-[10px] text-dim">Your GPS is on — passengers see you live once you accept.</p>
      )}
    </div>
  );
}

export default function RiderDashboard() {
  const { onboarded, role, profile, supabaseUser, reset } = useSession();
  const { coords, address, status: locStatus, accuracy, heading, speed, refresh: refreshLoc } = useGeolocation();
  const [tab, setTab] = useState<"available" | "active" | "history" | "earnings" | "profile" | "stores">("available");
  const [mode, setMode] = useState<"deliveries" | "boda">("deliveries");
  const [available, setAvailable] = useState<DeliveryRequest[]>([]);
  const [activeDelivery, setActiveDelivery] = useState<DBOrder | null>(null);
  const [allDeliveries, setAllDeliveries] = useState<DBOrder[]>([]);
  const [myOrders, setMyOrders] = useState<DBOrder[]>([]);
  const [affiliations, setAffiliations] = useState<{ memberships: RiderAffiliation[]; active: RiderAffiliation | null; invites: RiderAffiliation[] }>({ memberships: [], active: null, invites: [] });
  const [fees, setFees] = useState<FeeConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [isOnline, _setIsOnline] = useState(true);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [deliveryBusy, setDeliveryBusy] = useState<string | null>(null);
  const [acceptError, setAcceptError] = useState<string | null>(null);
  const [merchantLoc, setMerchantLoc] = useState<LatLng | null>(null);
  const [merchantsById, setMerchantsById] = useState<Record<string, MerchantLoc>>({});
  const { addNotification } = useNotifications();
  const [riderRecord, setRiderRecord] = useState<{name: string; phone: string; vehicle_type: string; service_area: string; status: string; verified: boolean} | null>(null);
  const [editPhone, setEditPhone] = useState(false);
  const [phoneValue, setPhoneValue] = useState("");

  const setIsOnline = (val: boolean) => {
    _setIsOnline(val);
    // Persist to DB so admin sees the correct online/offline state
    const uid = supabaseUser?.id || "";
    if (uid) updateRiderStatus(uid, val ? "online" : "offline");
  };
  const [verified, setVerified] = useState<"none" | "pending" | "approved" | "rejected">("none");
  // Effective verification: use whichever says "approved" — riderRecord from DB or the async check
  const effectiveVerified = (verified === "approved" || riderRecord?.verified) ? "approved" as const : verified;

  const refresh = useCallback(() => {
    const uid = supabaseUser?.id || profile.email || "rider";
    fetchOrders().then((orders) => {
      const deliverable = orders.filter((o) =>
        ["payment_confirmed", "preparing", "ready"].includes(o.status) && !o.rider_id
      );
      const myActive = orders.find((o) =>
        o.rider_id === uid && ["rider_assigned", "delivering"].includes(o.status)
      );
      const myHistory = orders.filter((o) =>
        o.rider_id === uid && o.status === "delivered"
      );

      setAvailable(deliverable.map((o) => {
        const m = merchantsById[o.merchant_id];
        const pickup = m ? { lat: m.lat, lng: m.lng } : null;
        const dropoff = o.customer_lat && o.customer_lng
          ? { lat: o.customer_lat, lng: o.customer_lng }
          : coords || null;
        const score = dispatchScore({ rider: coords ?? null, pickup, dropoff });
        return {
          order: o,
          distanceKm: score.totalKm,
          fareUgx: o.delivery_fee_ugx || 3000,
          etaMin: score.etaMin,
          pickupMin: coords && score.pickupKm > 0 ? Math.round((score.pickupKm / 25) * 60) : 0,
          pickupKm: score.pickupKm,
          pickupName: m?.name || o.merchant_name || "Pickup",
          customerPhone: o.customer_phone || "",
        };
      }).sort((a, b) => a.distanceKm - b.distanceKm)
        .filter((d) => !coords || d.pickupMin <= 15));
      setActiveDelivery(myActive || null);
      setAllDeliveries(myHistory);
      setMyOrders(orders.filter((o) => o.rider_id === uid && o.status !== 'delivered'));
      setLoading(false);
    });
    fetchFeeConfig().then(setFees);
  }, [coords, merchantsById, supabaseUser?.id, profile.email]);

  // Cache merchant locations once so pickup legs can be scored per order
  useEffect(() => {
    let cancelled = false;
    fetchMerchants().then((ms) => {
      if (cancelled) return;
      const map: Record<string, MerchantLoc> = {};
      for (const m of ms) {
        if (m.lat && m.lng) map[m.id] = { name: m.name || "Pickup", lat: m.lat, lng: m.lng };
      }
      setMerchantsById(map);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    // If auth not loaded yet, retry with delays
    if (!supabaseUser?.id) {
      let attempts = 0;
      const retry = () => {
        attempts++;
        if (useSession.getState().supabaseUser?.id || attempts >= 10) {
          refresh();
        } else {
          setTimeout(retry, 300);
        }
      };
      retry();
      return;
    }
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refresh, supabaseUser?.id]);

  // Live order stream — new deliveries and status changes appear instantly,
  // with notifications so the rider never misses an available order.
  useEffect(() => {
    const known = new Set<string>();
    const unsub = subscribeToAllOrders((updated) => {
      const isAvailable = ["payment_confirmed", "preparing", "ready"].includes(updated.status) && !updated.rider_id;
      const uid = supabaseUser?.id || profile.email || "";
      if (isAvailable) {
        // Only buzz for orders reasonably close to the rider's GPS position
        const dist = coords && updated.customer_lat != null && updated.customer_lng != null ? distanceKm(coords, { lat: updated.customer_lat, lng: updated.customer_lng }) : null;
        if (dist === null || dist <= 30) {
          if (!known.has(updated.id)) {
            known.add(updated.id);
            addNotification({
              title: "new_delivery",
              body: `${updated.merchant_name || "Pickup"} → ${updated.delivery_address || "customer"} · ${updated.items || "items"} · ${formatUgx(updated.delivery_fee_ugx || 3000)} fare${dist != null ? ` · ${dist.toFixed(1)} km away` : ""}`,
              orderId: updated.id,
              role: "rider",
            });
          }
        }
      } else if (updated.rider_id === uid && ["rider_assigned", "delivering"].includes(updated.status)) {
        addNotification({
          title: updated.status,
          body: `Order #${updated.id.slice(-6)} assigned to you: ${orderSummary(updated)}`,
          orderId: updated.id,
          role: "rider",
        });
      }
      refresh();
    });
    const poll = setInterval(refresh, 20000);
    return () => { unsub(); clearInterval(poll); };
  }, [refresh, coords, supabaseUser?.id, profile.email, addNotification]);

  // Re-fetch when returning to the page (back from track, chat, etc.)
  useEffect(() => {
    const onVis = () => { if (document.visibilityState === "visible") refresh(); };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", onVis);
    };
  }, [refresh]);

  // Read rider data from DB on mount — determines name, vehicle, online status, AND verification
  useEffect(() => {
    let cancelled = false;
    let attempts = 0;

    const load = async () => {
      attempts++;
      const uid = useSession.getState().supabaseUser?.id || "";
      const email = useSession.getState().profile.email || useSession.getState().supabaseUser?.email || "";
      if (!uid && !email && attempts <= 30) return;
      if (!uid && !email) return;

      // 1) Server API check FIRST (most reliable — uses service-role, bypasses RLS)
      try {
        const status = await getUserVerificationStatus(uid || "no-id", email);
        if (!cancelled && status === "approved") {
          setVerified("approved");
        } else if (!cancelled && status !== "none") {
          setVerified(status);
        }
      } catch {}

      // 2) Read rider profile data from Supabase client
      try {
        const sb = getSupabase();
        if (sb && !cancelled) {
          let data: any = null;
          if (uid) {
            const { data: byId } = await sb.from("riders").select("name,vehicle_type,service_area,status,verified").eq("id", uid).maybeSingle();
            data = byId;
          }
          if (!data && email) {
            const { data: byEmail } = await sb.from("riders").select("name,vehicle_type,service_area,status,verified").eq("email", email.toLowerCase()).maybeSingle();
            data = byEmail;
          }
          if (data && !cancelled) {
            _setIsOnline(data.status === "online");
            setRiderRecord({ name: data.name || "", phone: data.phone || "", vehicle_type: data.vehicle_type || "motorbike", service_area: data.service_area || "Your area", status: data.status || "offline", verified: !!data.verified });
            if (data.verified && !cancelled) setVerified("approved");
          } else if (!cancelled && uid) {
            // Auto-create rider record so accept-order API works
            const st = useSession.getState();
            const riderName = st.profile.name || email.split("@")[0] || "Rider";
            try {
              await fetch("/api/riders", {
                method: "POST",
                headers: await apiAuthHeaders(true),
                body: JSON.stringify({
                  id: uid,
                  name: riderName,
                  email: email,
                  phone: "",
                  vehicle_type: "motorbike",
                  plate: "",
                  service_area: "Uganda",
                  status: "online",
                }),
              });
              setRiderRecord({ name: riderName, phone: "", vehicle_type: "motorbike", service_area: "Uganda", status: "online", verified: false });
              setIsOnline(true);
            } catch {}
          }
        }
      } catch {}
    };

    load();
    const interval = setInterval(load, 8000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  // Store affiliations — fleets you belong to, plus pending invites
  const [affreplying, setAffreplying] = useState<string | null>(null);
  const [affError, setAffError] = useState<string | null>(null);

  const refreshAffiliations = useCallback(async () => {
    const a = await fetchRiderAffiliations();
    setAffiliations(a);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const a = await fetchRiderAffiliations();
      if (!cancelled) setAffiliations(a);
    };
    load();
    const interval = setInterval(load, 20000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  const replyAffiliation = async (merchant_id: string, action: "accept" | "decline", name: string) => {
    setAffreplying(merchant_id);
    setAffError(null);
    const ok = await respondRiderAffiliation(merchant_id, action);
    if (!ok) {
      setAffError(action === "accept"
        ? `Could not join ${name}. You may already be active with another store.`
        : `Could not decline the invite from ${name}. Try again.`);
      setAffreplying(null);
      return;
    }
    await refreshAffiliations();
    setAffreplying(null);
  };

  // GPS broadcasting — pushes the live position (from the SAME watcher that
  // feeds the rider's map, no second watchPosition) to Supabase while a
  // delivery is active, so the customer's tracking page sees a moving marker.
  // Instead of silently going dark on failure, the rider page shows the state.
  const [broadcastState, setBroadcastState] = useState<"idle" | "on" | "error">("idle");
  const lastSentRef = useRef<{ lat: number; lng: number; at: number } | null>(null);
  useEffect(() => {
    if (!activeDelivery || !supabaseUser?.id) { setBroadcastState("idle"); return; }
    if (!coords) return; // "Location is off" banner explains what to do
    let stopped = false;
    const push = async (force = false) => {
      // Accuracy gate: never broadcast a wild fix (>120m) unless we have
      // nothing better yet; displacement gate: resend if moved ≥10m or 15s old.
      const last = lastSentRef.current;
      if (!force && last && accuracy != null && accuracy > 120) return;
      if (!force && last) {
        const movedM = distanceKm(last, coords) * 1000;
        const ageMs = Date.now() - last.at;
        if (movedM < 10 && ageMs < 15000) return;
      }
      const ok = await updateRiderLocation(supabaseUser.id, coords.lat, coords.lng, heading || undefined, speed || undefined, accuracy || undefined);
      if (!stopped) {
        setBroadcastState(ok ? "on" : "error");
        if (ok) lastSentRef.current = { lat: coords.lat, lng: coords.lng, at: Date.now() };
      }
    };
    push(true);
    // Interval covers periods when the browser throttles watchPosition callbacks.
    const t = setInterval(() => push(false), 5000);
    return () => { stopped = true; clearInterval(t); };
  }, [activeDelivery?.id, coords, supabaseUser?.id, heading, speed, accuracy]);

  // Fetch merchant location for active delivery pickup marker
  useEffect(() => {
    if (!activeDelivery?.merchant_id) return;
    import("@/lib/db").then(({ fetchMerchantById }) => {
      fetchMerchantById(activeDelivery.merchant_id).then((m) => {
        if (m && m.lat && m.lng) setMerchantLoc({ lat: m.lat, lng: m.lng });
      });
    }).catch(() => {});
  }, [activeDelivery?.merchant_id]);

  // Road route for rider navigation: pickup → dropoff (Mapbox → OSRM → straight).
  const activeDropoff: LatLng | null =
    activeDelivery?.customer_lat && activeDelivery?.customer_lng
      ? { lat: Number(activeDelivery.customer_lat), lng: Number(activeDelivery.customer_lng) }
      : null;
  const { route: riderRoadRoute } = useRoadRoute(merchantLoc, activeDropoff);

  if (!onboarded || role !== "rider") {
    return (
      <div className="hero-wash flex min-h-[70vh] items-center justify-center px-4">
        <div className="text-center animate-fade-in">
          <div className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-2xl bg-primary/15 ring-1 ring-primary/30">
            <Truck className="h-8 w-8 text-primary" />
          </div>
          <h1 className="font-display text-2xl font-bold">Rider Dashboard</h1>
          <p className="mt-2 max-w-sm mx-auto text-sm text-muted">Register as a rider to start earning by delivering orders across Uganda.</p>
          <Link href="/onboarding/rider" className="mt-6 inline-flex items-center gap-2 rounded-xl bg-go px-6 py-3 text-sm font-semibold text-white hover:bg-go-2 transition">
            Start Riding →
          </Link>
        </div>
      </div>
    );
  }

  const riderName = riderRecord?.name || profile.name || "Rider";
  const vehicleType = riderRecord?.vehicle_type || profile.vehicleType || "Motorbike";
  const serviceArea = riderRecord?.service_area || profile.serviceArea || "Your area";

  const acceptDelivery = async (order: DBOrder) => {
    const riderId = supabaseUser?.id || profile.email || "rider";
    if (!riderId) return;
    setAcceptingId(order.id);
    setAcceptError(null);
    try {
      const res = await fetch("/api/rider/accept-order", {
        method: "POST",
        headers: await apiAuthHeaders(true),
        body: JSON.stringify({ orderId: order.id, riderId, riderName, riderPhone: riderRecord?.phone || (profile as any).phone || profile.email || "" }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setAcceptError(json.error || "Failed to accept order");
        setAcceptingId(null);
        return;
      }
      setVerified("approved");
      setActiveDelivery({ ...order, status: "rider_assigned" as const, rider_id: riderId, rider_name: riderName });
      setTab("active");
      refresh();
    } catch (e: any) {
      setAcceptError(e?.message || "Network error. Try again.");
    } finally {
      setAcceptingId(null);
    }
  };

  const pickupDelivery = () => {
    if (!activeDelivery || deliveryBusy) return;
    const id = activeDelivery.id;
    setDeliveryBusy(id);
    setActiveDelivery({ ...activeDelivery, status: "delivering" } as any);
    updateOrder(id, { status: "delivering" })
      .then(() => refresh())
      .finally(() => setDeliveryBusy((cur) => (cur === id ? null : cur)));
  };

  const completeDelivery = () => {
    if (!activeDelivery || deliveryBusy) return;
    const id = activeDelivery.id;
    setDeliveryBusy(id);
    setActiveDelivery(null);
    updateOrder(id, { status: "delivered" }).then(() => {
      setTab("available");
      refresh();
    }).finally(() => setDeliveryBusy((cur) => (cur === id ? null : cur)));
  };

  // Stats
  const todayDeliveries = allDeliveries.filter((o) => Date.now() - o.updated_at < 86400000);
  const todayEarnings = todayDeliveries.reduce((s, o) => s + (o.delivery_fee_ugx || 3000), 0);
  const totalEarnings = allDeliveries.reduce((s, o) => s + (o.delivery_fee_ugx || 3000), 0);

  // Riders issued a one-time password must set their own before using the app.
  if (profile.mustChangePassword) {
    return <SetPasswordGate />;
  }

  return (
    <div className="mx-auto min-h-screen max-w-lg bg-bg pb-24 md:max-w-2xl">
      {/* Header — teal rider theme with earnings-forward */}
      <div className="border-b border-primary/15 bg-gradient-to-b from-primary/8 to-transparent px-4 pt-4 pb-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-display text-lg font-bold">{riderName}</h1>
              <span className="chip bg-primary/15 text-primary">
                <Truck className="h-2.5 w-2.5" /> Rider
              </span>
            </div>
            <p className="text-[10px] text-muted">{vehicleType} · {serviceArea}</p>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setIsOnline(!isOnline)}
              className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition ${isOnline ? "bg-success/15 text-success" : "bg-elevated text-muted"}`}>
              <Radio className={`h-3 w-3 ${isOnline ? "animate-pulse" : ""}`} />
              {isOnline ? "Online" : "Offline"}
            </button>
          </div>
        </div>

        {/* Earnings card — teal gradient */}
        <div className="mt-3 rounded-2xl bg-gradient-to-br from-primary via-primary-2 to-[#c2410c] p-4 shadow-glow">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-white/60">Today&apos;s Earnings</p>
              <p className="num mt-0.5 font-display text-2xl font-bold text-white">{formatUgx(todayEarnings)}</p>
            </div>
            <div className="text-right">
              <p className="text-[10px] text-white/60">Deliveries</p>
              <p className="num text-2xl font-bold text-white">{todayDeliveries.length}</p>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <div className="rounded-xl bg-white/10 px-3 py-2.5 text-center">
              <p className="num text-sm font-bold text-white">{formatUgx(totalEarnings)}</p>
              <p className="text-[9px] text-white/50">All time</p>
            </div>
            <div className="rounded-xl bg-white/10 px-3 py-2.5 text-center">
              <p className="num text-sm font-bold text-white">{allDeliveries.length}</p>
              <p className="text-[9px] text-white/50">Total trips</p>
            </div>
          </div>
        </div>

        {/* Location status */}
        <button type="button" onClick={refreshLoc}
          className="mt-3 flex items-center gap-2 rounded-xl bg-surface border border-border px-3.5 py-2.5 w-full text-left shadow-xs">
          <MapPin className="h-4 w-4 text-primary shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-xs text-muted truncate">{address || "Detecting location…"}</p>
            {locStatus === "watching" && accuracy != null && (
              <p className="text-[10px] text-success flex items-center gap-1"><Radio className="h-2 w-2 animate-pulse" />{formatAccuracy(accuracy)}</p>
            )}
            {activeDelivery && (
              broadcastState === "on" ? (
                <p className="text-[10px] text-success flex items-center gap-1"><Radio className="h-2 w-2 animate-pulse" />Live tracking on — customer can see you</p>
              ) : broadcastState === "error" ? (
                <p className="text-[10px] text-danger flex items-center gap-1"><X className="h-2 w-2" />Live tracking failed — retrying…</p>
              ) : (
                <p className="text-[10px] text-muted flex items-center gap-1"><Clock className="h-2 w-2" />Waiting for GPS to start live tracking…</p>
              )
            )}
          </div>
          <Navigation className="h-3.5 w-3.5 text-primary shrink-0" />
        </button>

        {/* Mode switch — Deliveries vs Boda transport vertical */}
        <div className="mt-3 grid grid-cols-2 gap-1 rounded-2xl bg-bg p-1">
          <button type="button" onClick={() => setMode("deliveries")}
            className={`flex items-center justify-center gap-1.5 rounded-xl py-2.5 text-xs font-semibold transition ${mode === "deliveries" ? "bg-surface text-primary shadow-xs" : "text-muted"}`}>
            <Package className="h-3.5 w-3.5" /> Deliveries
          </button>
          <button type="button" onClick={() => setMode("boda")}
            className={`flex items-center justify-center gap-1.5 rounded-xl py-2.5 text-xs font-semibold transition ${mode === "boda" ? "bg-surface text-primary shadow-xs" : "text-muted"}`}>
            <Bike className="h-3.5 w-3.5" /> Boda
          </button>
        </div>
        </div>

        {mode === "boda" ? (
          <BodaPanel
            riderName={riderRecord?.name || profile.displayName || profile.name || "Rider"}
            verifiedOk={effectiveVerified === "approved"}
            isOnline={isOnline}
            coords={coords}
          />
        ) : (<>
        <div className="px-4 pt-3">
        {/* Tabs — teal accent */}
        <div className="flex gap-1 rounded-xl bg-bg p-1">
          {([
            { id: "available" as const, label: "Available", count: available.length },
            { id: "active" as const, label: "Active", count: activeDelivery ? 1 : 0 },
            { id: "history" as const, label: "History", count: myOrders.length },
            { id: "earnings" as const, label: "Earnings", count: 0 },
            { id: "stores" as const, label: "Stores", count: affiliations.invites.length },
            { id: "profile" as const, label: "Profile", count: 0 },
          ]).map((t) => (
            <button key={t.id} type="button" onClick={() => setTab(t.id)}
              className={`flex flex-1 items-center justify-center gap-1 rounded-lg py-2 text-xs font-medium transition ${tab === t.id ? "bg-surface text-primary shadow-xs" : "text-muted"}`}>
              {t.label}
              {t.count > 0 && <span className="num ml-0.5 h-4 min-w-4 rounded-full bg-primary px-1 text-[9px] font-bold text-white text-center">{t.count}</span>}
            </button>
          ))}
        </div>
        </div>

      {/* Available deliveries */}
      {tab === "available" && (<div className="space-y-0">
        {effectiveVerified !== "approved" && (
          <div className="rounded-2xl border border-warning/30 bg-warning/5 p-4 mx-4 mt-4 animate-spring-in">
            <div className="flex items-start gap-2">
              <ShieldCheck className="h-5 w-5 text-warning shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm font-semibold text-fg">Verification required</p>
                <p className="text-xs text-muted mt-0.5">
                  {effectiveVerified === "pending"
                    ? "Your documents are under review. You can browse orders, but you can accept them once approved."
                    : effectiveVerified === "rejected"
                      ? "Your documents were rejected. Upload new ones to get verified."
                      : "You must be verified to accept orders. Upload your National ID and vehicle documents to start earning."}
                </p>
                <Link
                  href="/verification"
                  className="mt-3 inline-flex items-center gap-1.5 rounded-xl bg-warning/15 px-4 py-2 text-xs font-semibold text-warning hover:bg-warning/25 transition"
                >
                  <ShieldCheck className="h-3.5 w-3.5" />
                  {effectiveVerified === "pending" ? "Check verification status" : "Verify now"}
                </Link>
              </div>
            </div>
          </div>
        )}
        {acceptError && (
          <div className="mx-4 mt-4 rounded-xl bg-danger/10 border border-danger/30 p-3 flex items-start gap-2 animate-slide-down">
            <X className="h-4 w-4 text-danger shrink-0 mt-0.5" />
            <p className="text-xs text-danger">{acceptError}</p>
          </div>
        )}
        <div className="px-4 pt-4 space-y-3">
          {!isOnline && (
            <div className="rounded-2xl bg-warning/10 p-4 text-center animate-spring-in">
              <p className="text-xs font-medium text-warning">You&apos;re offline</p>
              <p className="text-[10px] text-muted mt-1">Go online to see available deliveries</p>
            </div>
          )}
          {loading ? (
            <div className="space-y-3">{[1, 2].map((i) => <div key={i} className="skeleton h-32 w-full rounded-2xl" />)}</div>
          ) : available.length === 0 ? (
            <div className="py-12 text-center animate-fade-in">
              <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-elevated ring-1 ring-border/60">
                <Package className="h-6 w-6 text-dim" />
              </div>
              <p className="text-sm font-medium text-fg">No deliveries available</p>
              <p className="mt-1 text-xs text-muted">{coords ? "New orders within 15 min of your location will appear here" : "New orders will appear here automatically"}</p>
            </div>
          ) : (
            available.map((d) => (
              <div key={d.order.id} className="tile shadow-xs card-hover p-4 hover:!border-primary/30 animate-spring-in">
                <div className="flex items-start justify-between">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold">{d.order.merchant_name}</p>
                    <p className="text-xs text-muted truncate">{d.order.items}</p>
                  </div>
                  <div className="text-right shrink-0 ml-3">
                    <div><Price amount={d.fareUgx} className="num text-lg font-bold text-primary" /></div>
                    <p className="num text-[10px] text-dim">{d.distanceKm.toFixed(1)} km trip · ~{d.etaMin} min</p>
                  </div>
                </div>
                <div className="mt-3 rounded-xl bg-bg ring-1 ring-border/50 px-3 py-2.5 text-[11px] space-y-2">
                  <div className="flex items-center gap-2 text-dim"><span className="grid h-5 w-5 shrink-0 place-items-center rounded bg-go/15"><span className="h-1.5 w-1.5 rounded-full bg-go" /></span>
                    <span className="min-w-0 flex-1 truncate">Pickup: {d.pickupName}</span>
                    {d.pickupMin > 0 && <span className="num shrink-0 text-primary font-medium">~{d.pickupMin} min away · {d.pickupKm.toFixed(1)} km</span>}
                  </div>
                  <div className="flex items-center gap-2 text-dim"><span className="grid h-5 w-5 shrink-0 place-items-center rounded bg-success/15"><span className="h-1.5 w-1.5 rounded-full bg-success" /></span>Drop-off: {d.order.delivery_address || "Uganda"}</div>
                  {d.customerPhone && (
                    <div className="flex items-center gap-2 text-dim"><Phone className="h-3.5 w-3.5 shrink-0 text-primary" />
                      <span className="min-w-0 flex-1 truncate">Customer: {d.order.customer_name || "Customer"} · {d.customerPhone}</span>
                      <a href={`tel:${d.customerPhone.replace(/[^0-9]/g, "")}`} className="chip shrink-0 bg-primary/15 text-primary">Call</a>
                    </div>
                  )}
                </div>
                <button type="button" onClick={() => acceptDelivery(d.order)}
                  disabled={acceptingId === d.order.id}
                  className="mt-3 w-full btn bg-primary text-white hover:bg-primary-2 shadow-glow active:scale-[0.97]">
                  {acceptingId === d.order.id ? (
                    <><span className="h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" /> Verifying…</>
                  ) : (
                    <>Accept delivery <ChevronRight className="h-3.5 w-3.5" /></>
                  )}
                </button>
              </div>
            ))
          )}
        </div>
      </div>
      )}

      {/* Active delivery */}
      {tab === "active" && (
        <div className="px-4 pt-4">
          {activeDelivery ? (
            <div className="space-y-3">
              <div className="rounded-2xl border border-go/30 bg-go/5 p-4 animate-spring-in">
                <div className="flex items-center gap-2 mb-2">
                  <Truck className="h-4 w-4 text-go animate-pulse" />
                  <p className="text-sm font-semibold text-go">Active delivery</p>
                </div>
                <p className="text-sm font-medium">{activeDelivery.merchant_name}</p>
                <p className="text-xs text-muted">{activeDelivery.items}</p>
                <div className="mt-2 space-y-2">
                  <div className="flex items-center gap-2 text-xs text-dim"><MapPin className="h-3 w-3 text-warning" />Pickup: {activeDelivery.merchant_name}</div>
                  <div className="flex items-center gap-2 text-xs text-dim"><Navigation className="h-3 w-3 text-success" />Drop-off: {activeDelivery.delivery_address || "Uganda"}</div>
                  <div className="flex items-center gap-2 text-xs text-dim"><Phone className="h-3 w-3" />Customer: {activeDelivery.customer_name}{activeDelivery.customer_phone ? ` · ${activeDelivery.customer_phone}` : ""}</div>
                </div>
                <div className="mt-3 flex gap-2">
                  <a href={`tel:${activeDelivery.customer_phone || activeDelivery.customer_email || ""}`} className="btn flex-1 bg-surface text-muted !border-border min-w-0 truncate">
                    <Phone className="h-3 w-3 shrink-0" /> Call {activeDelivery.customer_phone ? "" : "(no phone)"}
                  </a>
                  {activeDelivery.customer_phone && (
                    <a href={`https://wa.me/${activeDelivery.customer_phone.replace(/[^0-9]/g, "")}`} target="_blank" rel="noopener noreferrer" className="btn flex-1 bg-success/10 text-success !border-success/20 min-w-0 truncate">
                      WhatsApp
                    </a>
                  )}
                  {(activeDelivery.customer_lat && activeDelivery.customer_lng) ? (
                    <a href={`https://www.google.com/maps/dir/?api=1&destination=${activeDelivery.customer_lat},${activeDelivery.customer_lng}`}
                      target="_blank" rel="noopener noreferrer"
                      className="btn flex-1 bg-primary/15 text-primary !border-primary/30 hover:bg-primary/25">
                      <Navigation className="h-3 w-3 shrink-0" /> Navigate
                    </a>
                  ) : (
                    <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(activeDelivery.delivery_address || "Uganda")}`}
                      target="_blank" rel="noopener noreferrer"
                      className="btn flex-1 bg-primary/15 text-primary !border-primary/30 hover:bg-primary/25">
                      <Navigation className="h-3 w-3 shrink-0" /> Navigate
                    </a>
                  )}
                  {activeDelivery?.status === "rider_assigned" ? (
                    <button type="button" onClick={pickupDelivery} disabled={deliveryBusy === activeDelivery?.id}
                      className="btn flex-1 bg-primary text-white hover:bg-primary-2 shadow-glow disabled:opacity-60">
                      {deliveryBusy === activeDelivery?.id
                        ? <><span className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-white border-t-transparent" /> Confirming…</>
                        : <><Package className="h-3.5 w-3.5 shrink-0" /> Picked up</>}
                    </button>
                  ) : (
                    <button type="button" onClick={completeDelivery} disabled={deliveryBusy === activeDelivery?.id}
                      className="btn flex-1 bg-success text-white hover:bg-success/90 disabled:opacity-60">
                      {deliveryBusy === activeDelivery?.id
                        ? <><span className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-white border-t-transparent" /> Confirming…</>
                        : <><CheckCircle2 className="h-3.5 w-3.5 shrink-0" /> Delivered</>}
                    </button>
                  )}
                </div>

                {/* GPS quality chip */}
                {coords && accuracy != null && (
                  <div className={`mt-3 flex items-center gap-2 rounded-xl border px-3 py-2 ${accuracy >= 100 ? "border-warning/30 bg-warning/10" : "border-success/30 bg-success/10"}`}>
                    <span className={`h-2 w-2 rounded-full ${accuracy >= 100 ? "bg-warning" : "bg-success"} animate-pulse`} />
                    <span className={`num text-[11px] font-semibold ${accuracy >= 100 ? "text-warning" : "text-success"}`}>
                      GPS ±{Math.round(accuracy)}m
                    </span>
                    {accuracy >= 100 && (
                      <span className="text-[10px] text-muted">— weak signal, move to open sky</span>
                    )}
                  </div>
                )}
                {/* Live navigation map */}
                {!coords && (
                  <div className="mt-3 flex items-center gap-2 rounded-xl border border-warning/30 bg-warning/10 px-3 py-2.5">
                    <MapPin className="h-4 w-4 text-warning shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] font-semibold text-warning">Location is off — customers can't see you</p>
                      <p className="text-[10px] text-muted">
                        {locStatus === "denied"
                          ? "Location access is blocked. Allow location for this site in your browser settings, then tap Retry."
                          : "Enable location access in your browser, then tap Retry. Keep this screen open while delivering."}
                      </p>
                    </div>
                    <button type="button" onClick={refreshLoc}
                      className="btn shrink-0 bg-warning/15 text-warning hover:bg-warning/25">
                      Retry
                    </button>
                  </div>
                )}
                <div className="rounded-2xl border border-border bg-surface overflow-hidden mt-3 shadow-card">
                  <LiveTrackingMap
                    riderLoc={coords ? { lat: coords.lat, lng: coords.lng } : null}
                    riderHeading={heading}
                    dropoffLoc={activeDelivery.customer_lat && activeDelivery.customer_lng
                      ? { lat: activeDelivery.customer_lat, lng: activeDelivery.customer_lng }
                      : null}
                    pickupLoc={merchantLoc}
                    showPickup={!!merchantLoc}
                    roadRoute={riderRoadRoute && riderRoadRoute.coordinates.length >= 2 ? riderRoadRoute.coordinates : null}
                    userLocation={coords}
                    label={activeDelivery.merchant_name || "Pickup"}
                    merchantName={activeDelivery.merchant_name || "Pickup"}
                    customerName={activeDelivery.customer_name || "Customer"}
                  />
                  {riderRoadRoute && (
                    <div className="flex items-center justify-between border-t border-border px-4 py-2.5 text-xs text-muted">
                      <span className="num font-semibold text-fg">
                        {riderRoadRoute.distanceKm < 1
                          ? `${Math.round(riderRoadRoute.distanceKm * 1000)} m`
                          : `${riderRoadRoute.distanceKm.toFixed(1)} km`} by road
                      </span>
                      <span className="num">~{Math.max(1, Math.round(riderRoadRoute.durationMin))} min drive</span>
                      <span className="capitalize text-dim">
                        {riderRoadRoute.source === "mapbox" ? "live route" : riderRoadRoute.source === "osrm" ? "road route" : "direct"}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="py-12 text-center animate-fade-in">
              <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-elevated ring-1 ring-border/60">
                <Clock className="h-6 w-6 text-dim" />
              </div>
              <p className="text-sm font-medium text-fg">No active delivery</p>
              <p className="mt-1 text-xs text-muted">Accept a delivery from the Available tab</p>
            </div>
          )}
        </div>
      )}


      {/* History */}
      {tab === "history" && (
        <div className="px-4 pt-4 space-y-3">
          <h3 className="text-sm font-semibold">Your Orders ({myOrders.length})</h3>
          {myOrders.length === 0 ? (
            <div className="py-12 text-center animate-fade-in">
              <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-elevated ring-1 ring-border/60">
                <Package className="h-6 w-6 text-dim" />
              </div>
              <p className="text-sm font-medium text-fg">No orders yet</p>
              <p className="mt-1 text-xs text-muted">Orders you accept will appear here</p>
            </div>
          ) : (
            myOrders.map((o) => (
              <div key={o.id} className="tile shadow-xs animate-spring-in p-4">
                <div className="flex items-start justify-between">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold">{o.merchant_name}</p>
                    <p className="text-xs text-muted truncate">{o.items}</p>
                    <p className="num text-[10px] text-dim">#{o.id.slice(-6)} · {o.customer_name || "Customer"}</p>
                  </div>
                  <div className="text-right shrink-0 ml-3">
                    <div><Price amount={o.delivery_fee_ugx || 3000} className="num text-sm font-bold text-primary" /></div>
                    <span className={`chip mt-1.5 ${
                      o.status === "rider_assigned" ? "bg-primary/15 text-primary" :
                      o.status === "delivering" ? "bg-go/15 text-go" :
                      o.status === "delivered" ? "bg-success/15 text-success" :
                      "bg-elevated text-muted"
                    }`}>
                      {o.status === "rider_assigned" ? "Assigned" : o.status === "delivering" ? "Delivering" : o.status.replace(/_/g, " ")}
                    </span>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Stores */}
      {tab === "stores" && (
        <div className="px-4 pt-4 space-y-3">
          {affError && (
            <div className="rounded-2xl border border-danger/30 bg-danger/10 p-4 flex items-start gap-2">
              <X className="h-4 w-4 text-danger shrink-0 mt-0.5" />
              <p className="text-xs text-danger">{affError}</p>
            </div>
          )}

          {affiliations.active && (
            <div className="rounded-2xl border border-go/30 bg-go/5 p-4 animate-spring-in">
              <div className="flex items-center gap-2">
                <Store className="h-4 w-4 text-go" />
                <p className="text-sm font-semibold">You deliver for {affiliations.active.merchant_name}</p>
              </div>
              <p className="mt-1 text-xs text-muted">
                Only {affiliations.active.merchant_name}&apos;s orders show on your dispatch board.
                You can leave this team to deliver for another store.
              </p>
              <p className="mt-2 text-[10px] text-dim">
                {affiliations.active.rate_ugx > 0
                  ? `Drop pay: UGX ${affiliations.active.rate_ugx.toLocaleString()} per order.`
                  : "Standard GoDoor fares apply."}
              </p>
              <button type="button" disabled={affreplying === affiliations.active.merchant_id}
                onClick={() => { if (confirm(`Leave ${affiliations.active?.merchant_name}? You'll start seeing all platform orders again.`)) replyAffiliation(affiliations.active!.merchant_id, "decline", affiliations.active!.merchant_name); }}
                className="btn btn-danger mt-3">
                <X className="h-3.5 w-3.5" /> Leave team
              </button>
            </div>
          )}

          {affiliations.invites.length > 0 ? (
            <div>
              <h3 className="flex items-center gap-2 text-sm font-semibold">
                <Store className="h-4 w-4 text-primary" />
                Store invites ({affiliations.invites.length})
              </h3>
              <div className="mt-2 space-y-3">
                {affiliations.invites.map((inv) => (
                  <div key={inv.merchant_id} className="rounded-2xl border border-primary/30 bg-primary/5 p-4 shadow-xs animate-spring-in">
                    <p className="text-sm font-semibold">{inv.merchant_name}</p>
                    <p className="text-[11px] text-muted">{inv.category || "Store"} wants you to join their delivery team.</p>
                    <p className="mt-1 text-[10px] text-dim">
                      {inv.rate_ugx > 0 ? `They're offering UGX ${inv.rate_ugx.toLocaleString()} per drop. ` : "Standard GoDoor fares. "}
                      You'll only see their orders while active.
                    </p>
                    <div className="mt-3 flex gap-2">
                      <button type="button" disabled={affreplying === inv.merchant_id}
                        onClick={() => replyAffiliation(inv.merchant_id, "accept", inv.merchant_name)}
                        className="btn flex-1 bg-primary text-white hover:bg-primary-2 shadow-glow">
                        {affreplying === inv.merchant_id ? (<><span className="h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" /> Joining…</>) : (<><CheckCircle2 className="h-3.5 w-3.5" /> Accept</>)}
                      </button>
                      <button type="button" disabled={affreplying === inv.merchant_id}
                        onClick={() => replyAffiliation(inv.merchant_id, "decline", inv.merchant_name)}
                        className="btn btn-ghost flex-1">
                        Decline
                      </button>
                    </div>
                    {affiliations.active && (
                      <p className="mt-2 text-[10px] text-warning">
                        This "Accept" only binds after you leave {affiliations.active.merchant_name}.
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {affiliations.memberships.length === 0 && !affiliations.active && (
            <div className="py-10 text-center animate-fade-in">
              <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-elevated ring-1 ring-border/60">
                <Store className="h-6 w-6 text-dim" />
              </div>
              <p className="text-sm font-medium text-fg">Not part of any store team yet</p>
              <p className="mt-1 text-xs text-muted">
                Stores can invite you by your phone or email. Accepting means you deliver for them first.
              </p>
            </div>
          )}

          {!affiliations.active && affiliations.memberships.length > 0 && (
            <div>
              <h3 className="flex items-center gap-2 text-sm font-semibold">
                <History className="h-4 w-4 text-dim" />
                Past teams
              </h3>
              <div className="mt-2 space-y-2">
                {affiliations.memberships.filter((m) => !m.merchant_id || m.status !== "active").map((m) => (
                  <div key={m.merchant_id} className="tile shadow-xs flex items-center justify-between p-3">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold">{m.merchant_name}</p>
                      <p className="num text-[10px] text-dim capitalize">{m.status.replace(/_/g, " ")}{m.rate_ugx > 0 ? ` · UGX ${m.rate_ugx.toLocaleString()}/drop` : ""}</p>
                    </div>
                    {m.status === "removed" || m.status === "declined" ? (
                      <span className="chip bg-elevated text-muted capitalize">{m.status}</span>
                    ) : (
                      <span className="chip bg-success/15 text-success">Active with this store</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Earnings */}
      {tab === "earnings" && (
        <div className="px-4 pt-4 space-y-4">
          <div className="rounded-2xl bg-gradient-to-br from-primary to-primary-2 p-5 text-white shadow-glow animate-spring-in">
            <p className="text-xs uppercase tracking-wider text-white/60">Total earnings</p>
            <p className="num mt-1 font-display text-3xl font-bold">{formatUgx(totalEarnings)}</p>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-white/10 px-3 py-2.5"><p className="text-[10px] text-white/60">Today</p><p className="num text-sm font-bold">{formatUgx(todayEarnings)}</p></div>
              <div className="rounded-xl bg-white/10 px-3 py-2.5"><p className="text-[10px] text-white/60">Deliveries</p><p className="num text-sm font-bold">{allDeliveries.length}</p></div>
            </div>
          </div>
          {fees && (
            <div className="tile shadow-xs p-4">
              <h3 className="text-sm font-semibold">Commission</h3>
              <p className="mt-2 text-xs text-muted">You keep <span className="num">{fees.rider_commission_percent}%</span> of delivery fees. Platform takes <span className="num">{fees.platform_commission_percent}%</span>.</p>
            </div>
          )}
          <div className="tile shadow-xs p-4 animate-spring-in">
            <h3 className="text-sm font-semibold">Recent deliveries</h3>
            {allDeliveries.length === 0 ? (
              <p className="mt-2 text-xs text-muted">No completed deliveries yet</p>
            ) : (
              <div className="mt-2 space-y-2">
                {allDeliveries.slice(0, 5).map((o) => (
                  <div key={o.id} className="flex items-center justify-between rounded-xl bg-bg px-3 py-2.5">
                    <div><p className="text-xs font-medium">{o.merchant_name}</p><p className="num text-[10px] text-dim">#{o.id.slice(-6)}</p></div>
                    <p className="num text-xs font-bold text-success">{formatUgx(o.delivery_fee_ugx || 3000)}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Profile */}
      {tab === "profile" && (
        <div className="px-4 pt-4 space-y-3">
          <div className="tile shadow-xs p-4 animate-spring-in">
            <div className="flex items-center gap-3">
              <div className="grid h-12 w-12 place-items-center rounded-full bg-primary/15 ring-1 ring-primary/30">
                <span className="text-lg font-bold text-primary">{riderName.charAt(0)}</span>
              </div>
              <div>
                <p className="font-semibold">{riderName}</p>
                <p className="text-xs text-muted">{profile.email}</p>
                <span className="chip mt-1 bg-primary/15 text-primary">
                  <Truck className="h-2.5 w-2.5" /> {vehicleType}
                </span>
                {effectiveVerified === "approved" && (
                  <span className="chip mt-1 bg-success/15 text-success">
                    <ShieldCheck className="h-2.5 w-2.5" /> Verified
                  </span>
                )}
                {effectiveVerified === "pending" && (
                  <span className="chip mt-1 bg-warning/15 text-warning">
                    <ShieldCheck className="h-2.5 w-2.5" /> Pending
                  </span>
                )}
                {effectiveVerified === "rejected" && (
                  <span className="chip mt-1 bg-danger/15 text-danger">
                    <ShieldCheck className="h-2.5 w-2.5" /> Rejected
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="tile shadow-xs p-4 space-y-2">
            <div className="flex justify-between rounded-xl bg-bg px-3 py-2.5"><span className="text-xs text-muted">Vehicle</span><span className="text-xs font-semibold">{vehicleType}</span></div>
            <div className="flex justify-between rounded-xl bg-bg px-3 py-2.5"><span className="text-xs text-muted">Plate</span><span className="text-xs font-semibold">{profile.plate || "—"}</span></div>
            <div className="flex justify-between rounded-xl bg-bg px-3 py-2.5"><span className="text-xs text-muted">Service area</span><span className="text-xs font-semibold">{serviceArea}</span></div>
          </div>
          <button type="button" onClick={() => { reset(); window.location.href = "/"; }}
            className="btn btn-danger w-full">
            <LogOut className="h-4 w-4" /> Sign out
          </button>
        </div>
      )}
      </>)}
      <RiderNav />
    </div>
  );
}
