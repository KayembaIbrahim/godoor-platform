"use client";

import Link from "next/link";
import { useState, useEffect, Suspense, Component, useCallback, useMemo, useRef, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import {
  ArrowLeft, Phone, MessageCircle, CheckCircle2, Package, Truck, Clock,
  MapPin, Navigation, Star, Bike, Car, CreditCard, Banknote,
  ExternalLink, AlertCircle, PartyPopper, X, ClipboardList,
} from "lucide-react";
import { LiveTrackingMap } from "@/components/LiveTrackingMap";
import { Logo } from "@/components/Logo";
import { ThemeToggle } from "@/components/ThemeToggle";
import { subscribeToRiderLocation, fetchRiderLocation, fetchProviderLocation, subscribeToProviderLocation, fetchOrderById, fetchOrders, type DBOrder } from "@/lib/db";
import { useSession } from "@/lib/session-store";
import { formatUgx } from "@/lib/utils";
import { useGeolocation, distanceKm, formatDistance, type LatLng } from "@/lib/location";
import { useRoadRoute } from "@/lib/routing";
import { useRatings } from "@/lib/customer-stores";

// ── Helpers ────────────────────────────────────────────────────

function formatEta(mins: number): string {
  if (mins < 1) return "Arriving now";
  if (mins < 2) return "~1 min";
  return `~${Math.round(mins)} min`;
}

function itemCount(s: string): number {
  if (!s) return 0;
  return s.split(",").filter(Boolean).length;
}

function vehicleIcon(type?: string | null) {
  const t = (type || "motorbike").toLowerCase();
  if (t.includes("car") || t.includes("suv")) return Car;
  return Bike;
}

// ── Delivery Rating ────────────────────────────────────────────

function DeliveryRating({ orderId }: { orderId: string }) {
  const { rate, getRating } = useRatings();
  const existing = getRating(orderId);
  const [stars, setStars] = useState(existing?.stars ?? 0);
  const [hover, setHover] = useState(0);
  const [text, setText] = useState(existing?.text ?? "");
  const [submitted, setSubmitted] = useState(!!existing);

  const submit = () => {
    if (stars === 0) return;
    rate(orderId, stars, text);
    setSubmitted(true);
  };

  if (submitted) {
    return (
      <div className="mx-4 mt-4 rounded-2xl border border-success/30 bg-success/5 p-4 text-center">
        <PartyPopper className="mx-auto h-6 w-6 text-go" />
        <p className="mt-2 text-sm font-semibold">Thanks for your feedback!</p>
        <div className="mt-1 flex items-center justify-center gap-0.5">
          {[1, 2, 3, 4, 5].map((s) => (
            <Star key={s} className={`h-4 w-4 ${s <= stars ? "fill-go text-go" : "text-border"}`} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-4 mt-4 rounded-2xl border border-border bg-surface p-4">
      <p className="text-sm font-semibold">Rate your delivery</p>
      <p className="mt-0.5 text-xs text-muted">How was your experience?</p>
      <div className="mt-3 flex items-center justify-center gap-1">
        {[1, 2, 3, 4, 5].map((s) => (
          <button
            key={s}
            type="button"
            onMouseEnter={() => setHover(s)}
            onMouseLeave={() => setHover(0)}
            onClick={() => setStars(s)}
            className="transition-transform hover:scale-110"
          >
            <Star className={`h-8 w-8 ${(hover || stars) >= s ? "fill-go text-go" : "text-border"}`} />
          </button>
        ))}
      </div>
      <input
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Tell us more (optional)"
        className="mt-3 w-full rounded-xl border border-border bg-elevated px-3 py-2 text-xs text-fg placeholder:text-dim focus:border-go focus:outline-none"
      />
      <button
        type="button"
        onClick={submit}
        disabled={stars === 0}
        className="mt-3 w-full rounded-xl bg-go py-2.5 text-sm font-semibold text-white transition hover:bg-go-2 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        Submit rating
      </button>
    </div>
  );
}

// ── Proximity Alert ────────────────────────────────────────────

function ProximityBanner({ distanceKmVal }: { distanceKmVal: number }) {
  const meters = Math.round(distanceKmVal * 1000);
  if (distanceKmVal > 0.5) return null;
  return (
    <div className="mx-4 mt-3 overflow-hidden rounded-2xl border border-go/40 bg-gradient-to-r from-go/10 via-go/5 to-go/10 px-4 py-3 animate-in fade-in slide-in-from-top-2 duration-500">
      <div className="flex items-center gap-3">
        <div className="relative flex h-10 w-10 shrink-0 items-center justify-center">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-go/30" />
          <span className="relative grid h-10 w-10 place-items-center rounded-full bg-go text-white">
            <Navigation className="h-5 w-5" />
          </span>
        </div>
        <div>
          <p className="text-sm font-bold text-go">Rider is almost there!</p>
          <p className="text-xs text-muted">
            {meters < 50 ? "Just around the corner" : `${meters}m away`}
          </p>
        </div>
      </div>
    </div>
  );
}

// ── Status Hero (pre-route phases) ────────────────────────────

const STATUS_HERO: Record<string, {
  title: string;
  desc: string;
  accent: string;
  pingRing: string;
  pulseRing: string;
  icon: typeof CheckCircle2;
}> = {
  pending: {
    title: "Order received",
    desc: "We're confirming your payment with the business.",
    accent: "bg-warning/15 text-warning",
    pingRing: "bg-warning/30",
    pulseRing: "bg-warning/25",
    icon: ClipboardList,
  },
  payment_submitted: {
    title: "Payment submitted",
    desc: "The business will confirm your payment shortly.",
    accent: "bg-warning/15 text-warning",
    pingRing: "bg-warning/30",
    pulseRing: "bg-warning/25",
    icon: CreditCard,
  },
  payment_confirmed: {
    title: "Payment confirmed",
    desc: "The business is getting your order ready.",
    accent: "bg-primary/15 text-primary",
    pingRing: "bg-primary/30",
    pulseRing: "bg-primary/25",
    icon: CheckCircle2,
  },
  preparing: {
    title: "Being prepared",
    desc: "The kitchen is on it — we'll match a rider as soon as it's ready.",
    accent: "bg-primary/15 text-primary",
    pingRing: "bg-primary/30",
    pulseRing: "bg-primary/25",
    icon: Package,
  },
  ready: {
    title: "Ready for pickup",
    desc: "We're finding a rider near the business right now.",
    accent: "bg-primary/15 text-primary",
    pingRing: "bg-primary/30",
    pulseRing: "bg-primary/25",
    icon: Truck,
  },
  rider_assigned: {
    title: "Rider on the way",
    desc: "A rider is heading to the business to pick up your order.",
    accent: "bg-go/15 text-go",
    pingRing: "bg-go/30",
    pulseRing: "bg-go/25",
    icon: Truck,
  },
  delivering: {
    title: "On the way to you",
    desc: "Your rider is bringing your order to your door.",
    accent: "bg-go/15 text-go",
    pingRing: "bg-go/30",
    pulseRing: "bg-go/25",
    icon: Navigation,
  },
  delivered: {
    title: "Delivered",
    desc: "Enjoy your order — thanks for choosing GoDoor!",
    accent: "bg-success/15 text-success",
    pingRing: "bg-success/30",
    pulseRing: "bg-success/25",
    icon: CheckCircle2,
  },
};

function StatusHero({ status, merchantName }: { status: string; merchantName?: string }) {
  const h = STATUS_HERO[status] || STATUS_HERO.pending;
  const Icon = h.icon;
  const isDeliveredState = status === "delivered";

  return (
    <div className="mx-0 sm:mx-4 md:mx-0 overflow-hidden rounded-none sm:rounded-2xl md:rounded-2xl border-y sm:border border-border bg-surface shadow-lg shadow-black/10 px-4 py-12 text-center md:flex md:h-full md:flex-col md:items-center md:justify-center">
      <div className="relative mx-auto grid h-28 w-28 place-items-center">
        {/* Breathing rings — Gojek-style motion so the wait feels alive */}
        <span className={`absolute inset-0 rounded-full ${h.pingRing} animate-ping`} style={{ animationDuration: "2.2s" }} />
        <span className={`absolute inset-3 rounded-full ${h.pulseRing} animate-pulse`} style={{ animationDuration: "1.6s" }} />
        <span className="relative grid h-20 w-20 place-items-center overflow-hidden rounded-full bg-elevated ring-1 ring-border">
          <Icon className={`h-9 w-9 relative z-10 ${h.accent} ${isDeliveredState ? "" : "animate-bounce"}`} style={isDeliveredState ? undefined : { animationDuration: "1.4s" }} />
        </span>
      </div>
      <h2 className="mt-5 font-display text-xl font-bold">{h.title}</h2>
      <p className="mx-auto mt-1.5 max-w-xs text-sm text-muted">
        {h.desc}
      </p>
      {merchantName && !isDeliveredState && (
        <p className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-elevated px-3 py-1 text-[11px] text-muted">
          <MapPin className="h-3 w-3 text-go" /> {merchantName}
        </p>
      )}
    </div>
  );
}

// ── Delay / Location-stale Banners ────────────────────────────

function DelayBanner() {
  return (
    <div className="mx-4 mt-3 flex items-center gap-2.5 rounded-2xl border border-warning/30 bg-warning/10 px-4 py-3">
      <Clock className="h-4.5 w-4.5 shrink-0 text-warning" />
      <div>
        <p className="text-xs font-semibold text-warning">Running a little late</p>
        <p className="text-[10px] text-muted">Your rider is taking longer than expected — thanks for your patience.</p>
      </div>
    </div>
  );
}

function StaleLocBanner() {
  return (
    <div className="mx-4 mt-3 flex items-center gap-2.5 rounded-2xl border border-warning/30 bg-warning/10 px-4 py-3">
      <AlertCircle className="h-4.5 w-4.5 shrink-0 text-warning" />
      <div>
        <p className="text-xs font-semibold text-warning">Live location unavailable</p>
        <p className="text-[10px] text-muted">We haven't heard from the rider for a moment — the ETA below is approximate.</p>
      </div>
    </div>
  );
}

function WeakGpsBanner({ accuracy }: { accuracy: number }) {
  return (
    <div className="mx-4 mt-3 flex items-center gap-2.5 rounded-2xl border border-warning/30 bg-warning/10 px-4 py-3">
      <AlertCircle className="h-4.5 w-4.5 shrink-0 text-warning" />
      <div>
        <p className="text-xs font-semibold text-warning">Weak rider GPS (±{Math.round(accuracy)}m)</p>
        <p className="text-[10px] text-muted">The rider's phone signal is unreliable — their pin may drift. Use the address for the exact spot.</p>
      </div>
    </div>
  );
}

// ── ETA Bar ────────────────────────────────────────────────────

function EtaBar({ eta, distanceKmVal }: { eta: number | null; distanceKmVal: number | null }) {
  if (eta === null || distanceKmVal === null || distanceKmVal <= 0) return null;
  return (
    <div className="mx-4 mt-3 flex items-center justify-between rounded-2xl border border-border bg-surface px-4 py-3">
      <div className="flex items-center gap-2.5">
        <div className="grid h-9 w-9 place-items-center rounded-full bg-go/10">
          <Clock className="h-4.5 w-4.5 text-go" />
        </div>
        <div>
          <p className="text-sm font-bold text-fg">{formatEta(eta)}</p>
          <p className="text-[10px] text-muted">{formatDistance(distanceKmVal)} away</p>
        </div>
      </div>
      <div className="text-right">
        <p className="text-[10px] text-dim">Estimated arrival</p>
        <p className="text-xs font-semibold text-muted tabular-nums">
          {new Date(Date.now() + eta * 60000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </p>
      </div>
    </div>
  );
}

// ── Status Timeline ────────────────────────────────────────────

function StatusTimeline({ status, statusOrder, STATUS_STEPS }: {
  status: string;
  statusOrder: string[];
  STATUS_STEPS: { key: string; label: string; icon: typeof CheckCircle2; desc: string }[];
}) {
  const currentIdx = statusOrder.indexOf(status);

  return (
    <div className="mx-4 mt-4 rounded-2xl border border-border bg-surface p-4">
      <p className="mb-4 flex items-center gap-1.5 text-xs font-medium text-muted">
        <Clock className="h-3.5 w-3.5 text-go" />
        Delivery status
      </p>
      <div className="relative">
        {/* Vertical progress line */}
        <div className="absolute left-[15px] top-4 bottom-4 w-0.5 bg-border" />
        <div
          className="absolute left-[15px] top-4 w-0.5 bg-gradient-to-b from-success to-go transition-all duration-700 ease-out"
          style={{
            height: `${Math.max(0, (currentIdx / (STATUS_STEPS.length - 1)) * 100)}%`,
            maxHeight: "calc(100% - 32px)",
          }}
        />

        <div className="space-y-0 relative">
          {STATUS_STEPS.map((s, i) => {
            const Icon = s.icon;
            const stepIdx = statusOrder.indexOf(s.key);
            const done = stepIdx <= currentIdx && stepIdx > 0;
            const active = s.key === status;
            return (
              <div key={s.key} className="flex items-start gap-3 relative">
                <div className="relative z-10 flex flex-col items-center">
                  <div className={`relative grid h-8 w-8 place-items-center rounded-full transition-all duration-300 ${
                    active
                      ? "bg-go text-white shadow-lg shadow-go/40 scale-110"
                      : done
                      ? "bg-success/20 text-success"
                      : "bg-elevated text-dim border border-border"
                  }`}>
                    {active && (
                      <span className="absolute inset-0 rounded-full animate-ping bg-go/30" />
                    )}
                    <Icon className="h-4 w-4 relative z-10" />
                  </div>
                </div>
                <div className="flex-1 pb-5 pt-0.5">
                  <p className={`text-sm font-medium ${
                    active ? "text-fg" : done ? "text-muted" : "text-dim"
                  }`}>{s.label}</p>
                  <p className={`text-[11px] ${
                    active ? "text-go" : "text-dim"
                  }`}>{s.desc}</p>
                  {active && (
                    <p className="mt-1 flex items-center gap-1.5 text-xs text-go font-semibold">
                      <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-go" />
                      In progress
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Rider Info Card ────────────────────────────────────────────

function RiderCard({ name, phone, rating, vehicleType, orderId }: {
  name: string; phone: string; rating: number; vehicleType?: string; orderId: string;
}) {
  const VIcon = vehicleIcon(vehicleType);
  return (
    <div className="mx-4 mt-4 overflow-hidden rounded-2xl border border-border bg-surface">
      <div className="flex items-center gap-4 p-4">
        {/* Avatar */}
        <div className="relative shrink-0">
          <div className="grid h-14 w-14 place-items-center rounded-full bg-gradient-to-br from-go/20 to-go/5 text-go font-display text-lg font-bold">
            {name?.charAt(0) || "R"}
          </div>
          <span className="absolute -bottom-0.5 -right-0.5 grid h-5 w-5 place-items-center rounded-full bg-success text-[8px] text-white">
            ✓
          </span>
        </div>
        {/* Info */}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold truncate">{name || "Rider"}</p>
          <div className="mt-0.5 flex items-center gap-2 text-xs text-muted">
            <VIcon className="h-3 w-3" />
            <span className="capitalize">{vehicleType || "Motorbike"}</span>
            <span className="text-border">·</span>
            <Star className="h-3 w-3 fill-go text-go" />
            <span className="font-medium tabular-nums">{rating > 0 ? rating.toFixed(1) : "—"}</span>
          </div>
        </div>
      </div>
      {/* Actions row */}
      <div className="grid grid-cols-2 border-t border-border">
        <a
          href={phone ? `tel:${phone}` : "#"}
          className={`flex items-center justify-center gap-2 border-r border-border py-3 text-sm font-medium transition ${
            phone ? "text-muted hover:bg-elevated" : "text-dim"
          }`}
        >
          <Phone className="h-4 w-4" />
          {phone ? "Call" : "No phone"}
        </a>
        <Link
          href={`/chat/${orderId}`}
          className="flex items-center justify-center gap-2 py-3 text-sm font-medium text-muted hover:bg-elevated transition"
        >
          <MessageCircle className="h-4 w-4" />
          Message
        </Link>
      </div>
    </div>
  );
}

// ── Order Summary ──────────────────────────────────────────────

function OrderSummary({ order, status }: { order: DBOrder; status: string }) {
  const items = itemCount(order.items);
  const mapLink = order.customer_lat && order.customer_lng
    ? `https://www.google.com/maps?q=${order.customer_lat},${order.customer_lng}`
    : null;

  return (
    <div className="mx-4 mt-4 rounded-2xl border border-border bg-surface p-4">
      <div className="flex items-start justify-between">
        <div className="min-w-0 flex-1">
          <p className="font-display text-base font-semibold">{order.merchant_name}</p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <span className="inline-flex items-center gap-1 rounded-full bg-elevated px-2 py-0.5 text-[10px] font-medium text-muted">
              <Package className="h-3 w-3" />
              {items} item{items !== 1 ? "s" : ""}
            </span>
            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold capitalize ${
              order.payment_method === "cash"
                ? "bg-warning/15 text-warning"
                : "bg-go/15 text-go"
            }`}>
              {order.payment_method === "cash" ? <Banknote className="h-3 w-3" /> : <CreditCard className="h-3 w-3" />}
              {order.payment_method === "momo" ? "MoMo" : order.payment_method === "airtel" ? "Airtel" : "Cash"}
            </span>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold capitalize ${
              order.payment_confirmed ? "bg-success/15 text-success" : "bg-warning/15 text-warning"
            }`}>
              {order.payment_confirmed ? "Paid" : "Pending"}
            </span>
          </div>
          <p className="mt-1.5 text-xs text-dim leading-relaxed">{order.items}</p>
        </div>
        <div className="shrink-0 text-right pl-3">
          <p className="text-sm font-bold text-go tabular-nums">{formatUgx(order.total_ugx)}</p>
          <span className="mt-1 inline-block rounded-full bg-go/15 px-2 py-0.5 text-[9px] font-bold text-go capitalize">
            {status.replace("_", " ")}
          </span>
        </div>
      </div>
      {order.delivery_address && (
        <div className="mt-3 flex items-start gap-2 rounded-xl bg-elevated/50 px-3 py-2.5">
          <MapPin className="h-3.5 w-3.5 mt-0.5 shrink-0 text-go" />
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-medium text-muted uppercase tracking-wider">Delivery address</p>
            <p className="mt-0.5 text-xs text-fg leading-relaxed">{order.delivery_address}</p>
          </div>
          {mapLink && (
            <a
              href={mapLink}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 text-go hover:text-go-2 transition"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main Order Tracker ─────────────────────────────────────────

function OrderTracker({ order }: { order: DBOrder }) {
  const [liveRiderLoc, setLiveRiderLoc] = useState<LatLng | null>(null);
  const [riderHeading, setRiderHeading] = useState<number | null>(null);
  const [riderAccuracy, setRiderAccuracy] = useState<number | null>(null);
  const [riderLocLastSeen, setRiderLocLastSeen] = useState<number | null>(null);
  const [status, setStatus] = useState(order.status);
  const [riderPhone, setRiderPhone] = useState("");
  const [riderRating, setRiderRating] = useState(0);
  const [riderVehicle, setRiderVehicle] = useState<string | null>(null);
  // Baseline ETA captured when the rider first appears — used to detect delays honestly.
  const baselineEtaRef = useRef<number | null>(null);
  const { supabaseUser, role } = useSession();
  const { coords: viewerLoc } = useGeolocation();

  useEffect(() => { setStatus(order.status); }, [order.status]);

  const [pickupLoc, setPickupLoc] = useState<LatLng | null>(null);
  const [providerLoc, setProviderLoc] = useState<LatLng | null>(null);
  const [providerSharing, setProviderSharing] = useState(false);

  useEffect(() => {
    import("@/lib/db").then(({ fetchMerchantById }) => {
      fetchMerchantById(order.merchant_id).then((m) => {
        if (!m) return;
        if (m.lat && m.lng) setPickupLoc({ lat: m.lat, lng: m.lng });
        // Traveling businesses opt in to stream their position to your door
        setProviderSharing(Boolean(m.live_location_enabled));
      });
    }).catch(() => {});
  }, [order.merchant_id]);

  // Live position of the traveling business (only while they share it)
  useEffect(() => {
    if (!providerSharing || !order.merchant_id) return;
    let cancelled = false;
    const pull = () => {
      fetchProviderLocation(order.merchant_id).then((loc) => {
        if (loc && !cancelled) setProviderLoc({ lat: loc.lat, lng: loc.lng });
      });
    };
    pull();
    // Fallback poll mirrors the rider poll — guarantees the moving-business
    // pin keeps gliding even if a realtime event is ever dropped.
    const id = setInterval(() => { if (!document.hidden) pull(); }, 15000);
    const unsub = subscribeToProviderLocation(order.merchant_id, (loc) => {
      setProviderLoc({ lat: loc.lat, lng: loc.lng });
    });
    return () => { cancelled = true; clearInterval(id); unsub(); setProviderLoc(null); };
  }, [providerSharing, order.merchant_id]);

  const orderHasCoords = Boolean(order.customer_lat && order.customer_lng);
  const dropoffLoc: LatLng | null = orderHasCoords
    ? { lat: Number(order.customer_lat), lng: Number(order.customer_lng) }
    : null;

  // Record a location heartbeat + baseline ETA (once per rider assignment)
  const recordLocation = (loc: LatLng & { heading?: number | null; accuracy?: number | null }) => {
    setLiveRiderLoc({ lat: loc.lat, lng: loc.lng });
    setRiderLocLastSeen(Date.now());
    if (loc.accuracy != null) setRiderAccuracy(loc.accuracy);
    if (loc.heading != null) setRiderHeading(loc.heading);
    if (baselineEtaRef.current === null && loc.lat !== 0 && dropoffLoc) {
      const eta = (distanceKm(loc, dropoffLoc) / 25) * 60;
      if (eta > 0 && Number.isFinite(eta)) baselineEtaRef.current = eta;
    }
  };

  // Subscribe to rider location (realtime broadcast every ~5s)
  useEffect(() => {
    baselineEtaRef.current = null;
    setRiderLocLastSeen(null);
    setRiderAccuracy(null);
    const riderId = order.rider_id;
    if (!riderId) return;
    fetchRiderLocation(riderId).then((loc) => { if (loc) recordLocation(loc); });
    import("@/lib/db").then(({ fetchRiders }) => {
      fetchRiders().then((riders) => {
        const rider = riders.find((r) => r.id === riderId);
        if (rider?.phone) setRiderPhone(rider.phone);
        if (rider?.rating) setRiderRating(rider.rating);
        if (rider?.vehicle_type) setRiderVehicle(rider.vehicle_type);
      });
    }).catch(() => {});
    const unsub = subscribeToRiderLocation(riderId, (loc) => recordLocation(loc));
    return () => { unsub(); };
  }, [order.rider_id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fallback polling — adaptive cadence (fast when the rider is close, slower when far),
  // paused while the tab is hidden.
  const etaMinutes = (() => {
    const km = liveRiderLoc && dropoffLoc ? distanceKm(liveRiderLoc, dropoffLoc) : null;
    return km !== null && km > 0 ? (km / 25) * 60 : null;
  })();
  const pollMs = etaMinutes === null ? 8000 : etaMinutes > 20 ? 15000 : etaMinutes > 8 ? 8000 : 3000;
  const isRiderOnRoute = status === "rider_assigned" || status === "delivering";

  useEffect(() => {
    const riderId = order.rider_id;
    if (!riderId || !isRiderOnRoute) return;
    const tick = () => {
      if (document.hidden) return;
      fetchRiderLocation(riderId).then((loc) => { if (loc) recordLocation(loc); });
    };
    const id = setInterval(tick, pollMs);
    return () => clearInterval(id);
  }, [order.rider_id, pollMs, isRiderOnRoute]); // eslint-disable-line react-hooks/exhaustive-deps

  // Poll order status every 10s
  useEffect(() => {
    const interval = setInterval(() => {
      fetchOrderById(order.id).then((o) => { if (o) setStatus(o.status); });
    }, 10000);
    return () => clearInterval(interval);
  }, [order.id]);

  // Honest on-time detection: delayed only once ETA exceeds baseline by >25% (and is real).
  const delayed = isRiderOnRoute && baselineEtaRef.current !== null
    && etaMinutes !== null && etaMinutes > 5
    && etaMinutes > baselineEtaRef.current * 1.25;
  const locStale = isRiderOnRoute && riderLocLastSeen !== null
    && Date.now() - riderLocLastSeen > 30000;
  const gpsWeak = isRiderOnRoute && riderAccuracy != null && riderAccuracy >= 100;

  // Only show the pickup marker once the shop's real coordinates have loaded
  const pickupReady = Boolean(pickupLoc);

  // Actual road route (Mapbox → OSRM → straight-line) for pickup → dropoff.
  const { route: roadRoute } = useRoadRoute(pickupReady ? pickupLoc : null, dropoffLoc);
  const roadCoords = roadRoute && roadRoute.coordinates.length >= 2 ? roadRoute.coordinates : null;

  const STATUS_STEPS = [
    { key: "pending", label: "Order placed", icon: CheckCircle2, desc: "Your order has been received" },
    { key: "payment_confirmed", label: "Payment confirmed", icon: CheckCircle2, desc: "Business confirmed your payment" },
    { key: "preparing", label: "Preparing", icon: Package, desc: "Your order is being prepared" },
    { key: "ready", label: "Ready for pickup", icon: Package, desc: "Matching a rider near the business" },
    { key: "rider_assigned", label: "Rider assigned", icon: Truck, desc: "A rider is heading to the merchant" },
    { key: "delivering", label: "On the way", icon: Navigation, desc: "Rider is delivering to you" },
    { key: "delivered", label: "Delivered!", icon: CheckCircle2, desc: "Your order has arrived" },
  ];

  const statusOrder = [
    "pending", "payment_submitted", "payment_confirmed",
    "preparing", "ready", "rider_assigned", "delivering", "delivered",
  ];

  const isDelivered = status === "delivered";

  const riderToDropoffKm = etaMinutes !== null ? (etaMinutes / 60) * 25 : null;

  return (
    <div className="mx-auto min-h-screen max-w-6xl bg-bg pb-8">
      {/* Header */}
      <div className="sticky top-0 z-30 flex items-center justify-between border-b border-border bg-bg/95 backdrop-blur-xl px-4 py-3">
        <Link href="/orders" className="flex items-center gap-1.5 text-sm text-muted hover:text-fg transition">
          <ArrowLeft className="h-4 w-4" /> Orders
        </Link>
        <div className="text-center">
          <h1 className="font-display text-sm font-semibold">Order #{order.id.slice(-6)}</h1>
          {isRiderOnRoute && (
            <p className="text-[10px] text-go font-medium animate-pulse">Live tracking</p>
          )}
          {isDelivered && (
            <p className="text-[10px] text-success font-medium">Delivered</p>
          )}
        </div>
        <ThemeToggle variant="header" />
      </div>

      {/* Grid: sticky live map (left) + live details (right) on desktop */}
      <div className="md:grid md:grid-cols-[minmax(0,1fr)_400px] lg:grid-cols-[minmax(0,1fr)_440px]">

        {/* Live map column — edge-to-edge hero card on mobile, sticky full-height on desktop */}
        <div className="px-0 pt-4 md:sticky md:top-16 md:px-5 md:pt-6 md:h-[calc(100dvh-6rem)]">
          <div className={isRiderOnRoute
            ? "h-[76vh] min-h-[480px] sm:h-[560px] md:h-full md:min-h-0 md:overflow-hidden md:rounded-2xl"
            : "md:overflow-hidden md:rounded-2xl"}>
              {isRiderOnRoute ? (
                <LiveTrackingMap
                  fill
                  riderLoc={liveRiderLoc}
                  riderHeading={riderHeading}
                  providerLoc={providerLoc}
                  providerName={order.merchant_name}
                  dropoffLoc={dropoffLoc}
                  pickupLoc={pickupLoc}
                  showPickup={pickupReady}
                  roadRoute={roadCoords}
                  userLocation={viewerLoc}
                  label={liveRiderLoc
                    ? `${order.rider_name || "Rider"} is on the way`
                    : providerLoc
                    ? `${order.merchant_name || "Provider"} is on the way to you`
                    : status === "delivering"
                    ? "Rider heading to you"
                    : status === "rider_assigned"
                    ? "Rider heading to pickup"
                    : "Waiting for rider..."}
                  merchantName={order.merchant_name}
                  customerName={order.customer_name || "Customer"}
                />
              ) : (
                <div className="h-full md:overflow-hidden md:rounded-2xl">
                  <StatusHero status={status} merchantName={order.merchant_name} />
                </div>
              )}
          </div>
        </div>

        {/* Details column */}
        <div className="py-4 md:py-0 md:pt-6 md:pb-10">

      {/* Proximity alert */}
      {isRiderOnRoute && riderToDropoffKm !== null && (
        <ProximityBanner distanceKmVal={riderToDropoffKm} />
      )}

      {/* Honest delivery status banners */}
      {delayed && <DelayBanner />}
      {locStale && !delayed && <StaleLocBanner />}
      {gpsWeak && !locStale && !delayed && <WeakGpsBanner accuracy={riderAccuracy as number} />}

      {/* ETA bar */}
      {isRiderOnRoute && !locStale && <EtaBar eta={etaMinutes} distanceKmVal={riderToDropoffKm} />}

      {/* Road route info (actual Mapbox/OSRM path, not straight-line) */}
      {isRiderOnRoute && roadRoute && (
        <div className="card-lift mx-4 mt-3 rounded-2xl border border-border bg-surface p-4">
          <div className="grid grid-cols-3 divide-x divide-border">
            <div className="flex flex-col items-center gap-0.5 px-2">
              <p className="text-[9px] font-semibold uppercase tracking-wider text-dim">Road distance</p>
              <p className="num text-sm font-bold">
                {roadRoute.distanceKm < 1 ? `${Math.round(roadRoute.distanceKm * 1000)} m` : `${roadRoute.distanceKm.toFixed(1)} km`}
              </p>
            </div>
            <div className="flex flex-col items-center gap-0.5 px-2">
              <p className="text-[9px] font-semibold uppercase tracking-wider text-dim">Drive time</p>
              <p className="num text-sm font-bold text-go">{Math.max(1, Math.round(roadRoute.durationMin))} min</p>
            </div>
            <div className="flex flex-col items-center gap-0.5 px-2">
              <p className="text-[9px] font-semibold uppercase tracking-wider text-dim">Route</p>
              <p className="text-sm font-bold capitalize">
                {roadRoute.source === "mapbox" ? "Live roads" : roadRoute.source === "osrm" ? "Roads" : "Direct"}
              </p>
            </div>
          </div>
          {roadRoute.steps.length > 0 && (
            <details className="mt-3 rounded-xl bg-elevated/50 px-3 py-2">
              <summary className="cursor-pointer text-xs font-medium text-muted">Turn-by-turn ({roadRoute.steps.length})</summary>
              <ol className="mt-2 space-y-1.5">
                {roadRoute.steps.map((s, i) => (
                  <li key={i} className="text-xs text-muted">{i + 1}. {s}</li>
                ))}
              </ol>
            </details>
          )}
        </div>
      )}

      {/* Rider card */}
      {isRiderOnRoute && order.rider_name && (
        <RiderCard
          name={order.rider_name}
          phone={riderPhone || order.rider_phone || ""}
          rating={riderRating}
          vehicleType={riderVehicle || undefined}
          orderId={order.id}
        />
      )}

      {/* Order summary */}
      <OrderSummary order={order} status={status} />

      {/* Status timeline */}
      <StatusTimeline
        status={status}
        statusOrder={statusOrder}
        STATUS_STEPS={STATUS_STEPS}
      />

      {/* Actions */}
      <div className="mx-4 mt-4 flex gap-3">
        <Link href={`/chat/${order.id}`} className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-go py-3.5 text-sm font-semibold text-white hover:bg-go-2 transition">
          <MessageCircle className="h-4 w-4" /> {role === "business" ? "Chat with customer" : role === "rider" ? "Chat about order" : "Chat with business"}
        </Link>
        {/* Role-aware calling: rider never calls themselves */}
        {role === "rider" && order.rider_id === supabaseUser?.id ? (
          order.customer_phone ? (
            <a href={`tel:${order.customer_phone}`} className="flex items-center justify-center gap-2 rounded-xl border border-go/30 bg-go/10 px-4 py-3.5 text-sm font-medium text-go hover:bg-go/20 transition">
              <Phone className="h-4 w-4" /> Call customer
            </a>
          ) : (
            <span className="flex items-center justify-center gap-2 rounded-xl border border-border bg-surface/50 px-4 py-3.5 text-sm font-medium text-dim">
              <Phone className="h-4 w-4" /> No customer phone
            </span>
          )
        ) : order.rider_id ? (
          <a
            href={`tel:${riderPhone || order.rider_phone || ""}`}
            className={`flex items-center justify-center gap-2 rounded-xl border border-border px-4 py-3.5 text-sm font-medium transition ${
              (riderPhone || order.rider_phone)
                ? "bg-surface text-muted hover:bg-elevated"
                : "bg-surface/50 text-dim cursor-not-allowed"
            }`}
          >
            <Phone className="h-4 w-4" />
            {(riderPhone || order.rider_phone) ? "Call rider" : "No phone"}
          </a>
        ) : null}
        {/* Business can also call customer directly */}
        {role === "business" && order.customer_phone && (
          <a href={`tel:${order.customer_phone}`} className="flex items-center justify-center gap-2 rounded-xl border border-go/30 bg-go/10 px-4 py-3.5 text-sm font-medium text-go hover:bg-go/20 transition">
            <Phone className="h-4 w-4" /> Call customer
          </a>
        )}
      </div>

      {/* Payment section */}
      <div className="mx-4 mt-4 rounded-2xl border border-border bg-surface p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {order.payment_method === "cash" ? (
              <Banknote className="h-4 w-4 text-muted" />
            ) : (
              <CreditCard className="h-4 w-4 text-muted" />
            )}
            <span className="text-xs font-medium text-muted">
              {order.payment_method === "momo" ? "MTN MoMo" : order.payment_method === "airtel" ? "Airtel Money" : "Cash on delivery"}
            </span>
          </div>
          <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold ${
            order.payment_confirmed ? "bg-success/15 text-success" : "bg-warning/15 text-warning"
          }`}>
            {order.payment_confirmed ? "Confirmed" : "Pending"}
          </span>
        </div>
        {order.service_fee_ugx > 0 && (
          <div className="mt-2 flex justify-between text-[11px] text-dim">
            <span>Subtotal</span><span className="tabular-nums">{formatUgx(order.subtotal_ugx)}</span>
          </div>
        )}
        {order.delivery_fee_ugx > 0 && (
          <div className="flex justify-between text-[11px] text-dim">
            <span>Delivery</span><span className="tabular-nums">{formatUgx(order.delivery_fee_ugx)}</span>
          </div>
        )}
        {order.service_fee_ugx > 0 && (
          <div className="flex justify-between text-[11px] text-dim">
            <span>Service fee</span><span className="tabular-nums">{formatUgx(order.service_fee_ugx)}</span>
          </div>
        )}
      </div>

      {/* Rating prompt on delivery */}
      {isDelivered && <DeliveryRating orderId={order.id} />}
        </div>
      </div>
    </div>
  );
}

// ── Role Overview ──────────────────────────────────────────────

function RoleOverview() {
  const { supabaseUser, role, profile } = useSession();
  const { coords: viewerLoc } = useGeolocation();
  const [orders, setOrders] = useState<DBOrder[]>([]);
  const [shop, setShop] = useState<{ lat: number; lng: number; name: string } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        let all = await fetchOrders();
        const uid = supabaseUser?.id || profile.email || "";
        if (role === "business") {
          const mine = all.filter((o) => ["payment_confirmed", "preparing", "rider_assigned", "delivering"].includes(o.status));
          setOrders(mine);
        } else if (role === "rider") {
          const mine = all.filter((o) => o.rider_id === uid && ["rider_assigned", "delivering"].includes(o.status));
          setOrders(mine);
        } else if (role === "customer") {
          const mine = all.filter((o) => (o.customer_id === uid || o.customer_email === profile.email) && ["preparing", "rider_assigned", "delivering"].includes(o.status));
          setOrders(mine);
        } else {
          setOrders([]);
        }
      } catch {}
      setLoading(false);
    };
    load();
  }, [role, supabaseUser?.id, profile.email]);

  const active = orders.filter((o) => ["rider_assigned", "delivering"].includes(o.status));
  const upcoming = orders.filter((o) => ["payment_confirmed", "preparing"].includes(o.status));

  // Resolve the shop coordinates for the first in-transit order so the map
  // always has a pickup pin even when the order or the viewer lacks GPS.
  useEffect(() => {
    const order = active[0];
    if (!order?.merchant_id) { setShop(null); return; }
    let cancelled = false;
    import("@/lib/db").then(({ fetchMerchantById }) => {
      if (cancelled) return;
      fetchMerchantById(order.merchant_id).then((m) => {
        if (cancelled) return;
        if (m && m.lat && m.lng) setShop({ lat: m.lat, lng: m.lng, name: m.name || order.merchant_name });
        else setShop(null);
      }).catch(() => { if (!cancelled) setShop(null); });
    }).catch(() => { if (!cancelled) setShop(null); });
    return () => { cancelled = true; };
  }, [active[0]?.id, active[0]?.merchant_id]); // eslint-disable-line

  // Prefer an active order that actually carries coords for the drop-off pin.
  const orderWithLoc = useMemo(
    () => active.find((o) => o.customer_lat && o.customer_lng) || active[0] || null,
    [active],
  );
  const dropLoc = orderWithLoc?.customer_lat && orderWithLoc?.customer_lng
    ? { lat: Number(orderWithLoc.customer_lat), lng: Number(orderWithLoc.customer_lng) }
    : null;

  // Real road route for the overview map (shop → drop-off) so the route
  // line is a true road path, not a straight line.
  const shopLoc = shop ? { lat: shop.lat, lng: shop.lng } : null;
  const { route: overviewRoadRoute } = useRoadRoute(shopLoc, dropLoc);
  const overviewRoadCoords = overviewRoadRoute && overviewRoadRoute.coordinates.length >= 2
    ? overviewRoadRoute.coordinates : null;

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-go border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="mx-auto min-h-screen max-w-lg bg-bg px-4 pb-10 pt-4 md:max-w-2xl">
      <header className="mb-4 flex items-center justify-between border-b border-border pb-3">
        <h1 className="font-display text-lg font-semibold flex items-center gap-2">
          <Navigation className="h-5 w-5 text-go" /> Live Map
        </h1>
        <ThemeToggle variant="header" />
      </header>

      <div className="mx-0 overflow-hidden border-y border-border shadow-xl shadow-black/20 sm:mx-0 sm:rounded-2xl sm:border">
        <div className="h-[78vh] min-h-[540px] w-full sm:h-[620px]">
          <LiveTrackingMap
            fill
            riderLoc={null}
            dropoffLoc={dropLoc}
            pickupLoc={shop}
            showPickup={!!shop}
            roadRoute={overviewRoadCoords}
            userLocation={viewerLoc}
            merchantName={shop?.name}
            customerName={orderWithLoc?.customer_name || "Delivery"}
            label={active.length ? `${active.length} active delivery${active.length > 1 ? "s" : ""}` : viewerLoc ? "You are here — live GPS" : "Live delivery map"}
          />
        </div>
      </div>

      <h2 className="mt-5 text-sm font-semibold">In transit</h2>
      <div className="mt-2 space-y-2">
        {active.length === 0 && (
          <div className="rounded-2xl border border-dashed border-border bg-surface/50 p-6 text-center">
            <Package className="mx-auto h-7 w-7 text-dim" />
            <p className="mt-2 text-sm font-medium">No orders in transit</p>
            <p className="text-xs text-muted">
              {role === "business" ? "Assigned deliveries will appear here for real-time rider tracking." :
               role === "rider" ? "Accept a delivery and its live route will show here." :
               "Place an order and track the rider live here."}
            </p>
          </div>
        )}
        {active.map((o) => (
          <Link key={o.id} href={`/tracking?orderId=${o.id}`}
            className="flex items-center justify-between rounded-2xl border border-go/30 bg-go/5 p-3.5 transition hover:bg-go/10">
            <div className="min-w-0">
              <p className="text-sm font-semibold">{o.merchant_name}</p>
              <p className="text-[10px] text-muted truncate">#{o.id.slice(-6)} · {o.customer_name || "Customer"}</p>
            </div>
            <span className="shrink-0 rounded-full bg-go/15 px-2 py-0.5 text-[9px] font-bold text-go capitalize">{o.status.replace("_", " ")}</span>
          </Link>
        ))}
      </div>

      {(role === "business" || role === "rider") && upcoming.length > 0 && (
        <>
          <h2 className="mt-5 text-sm font-semibold">Waiting</h2>
          <div className="mt-2 space-y-2">
            {upcoming.map((o) => (
              <Link key={o.id} href={`/tracking?orderId=${o.id}`}
                className="flex items-center justify-between rounded-2xl border border-border bg-surface p-3.5 transition hover:bg-elevated">
                <div className="min-w-0">
                  <p className="text-sm font-semibold">{o.merchant_name}</p>
                  <p className="text-[10px] text-muted truncate">#{o.id.slice(-6)} · {o.customer_name || "Customer"}</p>
                </div>
                <span className="shrink-0 rounded-full bg-warning/15 px-2 py-0.5 text-[9px] font-bold text-warning capitalize">{o.status.replace("_", " ")}</span>
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ── Tracking Content (router wrapper) ──────────────────────────

function TrackingContent() {
  const params = useSearchParams();
  const orderId = params.get("orderId");
  const { supabaseUser, role, profile } = useSession();
  const [order, setOrder] = useState<DBOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadOrder = useCallback(() => {
    if (!orderId) return Promise.resolve();
    return fetchOrderById(orderId).then((o) => {
      if (o) setOrder(o);
      else setError("Order not found");
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [orderId]);

  useEffect(() => {
    if (!orderId) { setLoading(false); return; }
    loadOrder();
  }, [orderId]);

  useEffect(() => {
    if (!orderId) return;
    const onVis = () => { if (document.visibilityState === "visible") loadOrder(); };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onVis);
    const poll = setInterval(loadOrder, 15000);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", onVis);
      clearInterval(poll);
    };
  }, [orderId, loadOrder]);

  if (!orderId) return <RoleOverview />;

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-go border-t-transparent" />
      </div>
    );
  }

  if (error || !order) {
    return (
      <div className="hero-wash flex min-h-[70vh] flex-col items-center justify-center px-4 text-center">
        <div className="mb-4 grid h-20 w-20 place-items-center rounded-full bg-go/10">
          <Truck className="h-10 w-10 text-go" />
        </div>
        <h1 className="mt-4 font-display text-2xl font-bold">Order not found</h1>
        <p className="mt-2 max-w-xs text-sm text-muted">This delivery could not be loaded.</p>
        <Link href={role === "business" ? "/business" : role === "rider" ? "/rider" : "/orders"} className="mt-6 rounded-xl bg-go px-6 py-3 text-sm font-semibold text-white hover:bg-go-2 transition">Go back</Link>
      </div>
    );
  }

  return <OrderTrackerErrorBoundary><OrderTracker order={order} /></OrderTrackerErrorBoundary>;
}

// ── Error Boundary ─────────────────────────────────────────────

class OrderTrackerErrorBoundary extends Component<{ children: ReactNode; fallback?: ReactNode }, { error: Error | null }> {
  constructor(props: { children: ReactNode; fallback?: ReactNode }) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: unknown) {
    console.error("[GoDoor] Tracking crash:", error, info);
  }
  render() {
    if (this.state.error) {
      return this.props.fallback || (
        <div className="mx-4 mt-4 rounded-2xl border border-danger/30 bg-danger/10 p-6 text-center">
          <p className="text-sm font-semibold text-danger">Tracking map failed to load</p>
          <p className="mt-1 text-xs text-muted">{this.state.error.message}</p>
          <button type="button" onClick={() => this.setState({ error: null })} className="mt-3 rounded-xl bg-go px-4 py-2 text-xs font-semibold text-white">Retry</button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ── Page Export ────────────────────────────────────────────────

export default function TrackingPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center"><div className="h-8 w-8 animate-spin rounded-full border-4 border-go border-t-transparent" /></div>}>
      <TrackingContent />
    </Suspense>
  );
}
