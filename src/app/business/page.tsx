"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import {
  Store, Package, DollarSign, MessageCircle, Check, Clock,
  TrendingUp, Phone, LogOut, ShieldCheck, CreditCard, ChevronDown,
  ShoppingBag, Navigation, Radio, History, Stethoscope, CalendarClock, Users
} from "lucide-react";
import { useSession } from "@/lib/session-store";
import { fetchOrders, updateOrder, updateMerchant, fetchFeeConfig, getUserVerificationStatus, subscribeToMerchantOrders, updateProviderLocation, clearProviderLocation, apiAuthHeaders, type DBOrder, type FeeConfig } from "@/lib/db";
import { useNotifications, orderSummary } from "@/lib/notifications-store";
import { formatUgx } from "@/lib/utils";
import { Price } from "@/components/Price";
import dynamic from "next/dynamic";
const MapboxMap = dynamic(() => import("@/components/MapboxMap"), { ssr: false, loading: () => null });
const StoryComposer = dynamic(
  () => import("@/components/StoriesViewer").then((m) => ({ default: m.StoryComposer })),
  { ssr: false, loading: () => <div className="h-10 rounded-2xl bg-surface animate-pulse" /> }
);
import { subscribeToRiderLocation } from "@/lib/db";
import { useGeolocation, type LatLng } from "@/lib/location";


import { Component, type ReactNode } from "react";
class BusinessErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: unknown) {
    console.error("[GoDoor] Business dashboard crash:", error, info);
  }
  render() {
    if (this.state.error) {
      return (
        <div className="mx-auto min-h-screen max-w-6xl bg-bg px-4 py-10">
          <div className="rounded-3xl border border-danger/30 bg-danger/10 p-6 text-center">
            <h1 className="font-display text-xl font-bold text-danger">Business dashboard hit an error</h1>
            <pre className="mt-3 overflow-auto rounded-xl bg-bg p-3 text-left text-xs text-muted">{this.state.error.message || String(this.state.error)}</pre>
            <button type="button" onClick={() => { this.setState({ error: null }); window.location.reload(); }}
              className="mt-4 inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-white hover:bg-primary/90 transition">
              Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-warning/15 text-warning",
  payment_submitted: "bg-warning/15 text-warning",
  payment_confirmed: "bg-success/15 text-success",
  preparing: "bg-primary/15 text-primary",
  rider_assigned: "bg-primary/15 text-primary",
  delivering: "bg-primary/15 text-primary",
  delivered: "bg-success/15 text-success",
  cancelled: "bg-elevated text-muted",
  disputed: "bg-danger/15 text-danger",
  medicines_ready: "bg-warning/15 text-warning",
};

type Tab = "orders" | "payments" | "products" | "settings" | "livemap" | "status";

function BusinessDashboardInner() {
  const [mounted, setMounted] = useState(false);
  const { onboarded, role, profile, supabaseUser, reset } = useSession();
  const { coords: myLocation } = useGeolocation();
  const { addNotification } = useNotifications();
  const [tab, setTab] = useState<Tab>("orders");
  const [orders, setOrders] = useState<DBOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [fees, setFees] = useState<FeeConfig | null>(null);
  const [merchantId, setMerchantId] = useState<string | null>(null);
  const [verified, setVerified] = useState<"none" | "pending" | "approved" | "rejected">("none");
  const [liveRiderLocs, setLiveRiderLocs] = useState<Record<string, LatLng & { heading?: number | null }>>({});
  const [followerCount, setFollowerCount] = useState(0);
  const [merchantRecord, setMerchantRecord] = useState<{name: string; momo_number: string; district: string; area: string; lat: number; lng: number; live_location_enabled: boolean} | null>(null);
  const [liveSharing, setLiveSharing] = useState(false);
  const [sharingBusy, setSharingBusy] = useState(false);
  const [myLiveLoc, setMyLiveLoc] = useState<LatLng | null>(null);
  const gpsWatchRef = useRef<number | null>(null);
  const streamingRef = useRef<{ merchantId: string; lastSend: number } | null>(null);

  useEffect(() => { setMounted(true); }, []);

  // Stop streaming GPS to the server when the dashboard unmounts.
  useEffect(() => {
    return () => {
      if (gpsWatchRef.current != null) navigator.geolocation.clearWatch(gpsWatchRef.current);
    };
  }, []);

  const refresh = useCallback(async () => {
    try {
      const st = useSession.getState();
      const uid = st.supabaseUser?.id || "";
      const email = st.profile.email || st.supabaseUser?.email || "";
      if (!uid && !email) { setLoading(false); return; }

      // Look up THIS business's merchant record directly (service-role, bypasses RLS)
      let myMerchant: any = null;
      try {
        const res = await fetch(`/api/business/me`, { cache: "no-store", headers: await apiAuthHeaders(false) });
        const json = await res.json();
        myMerchant = json.merchant;
      } catch {}

      if (myMerchant) {
        setMerchantId(myMerchant.id);
        // Fetch all orders then filter by this merchant
        const merchantOrders = await fetchOrders({ merchant_id: myMerchant.id });
        setOrders(merchantOrders);
      } else {
        // No merchant record yet — try to auto-create one
        try {
          const createRes = await fetch("/api/business/me", {
            method: "POST",
            headers: await apiAuthHeaders(true),
            body: JSON.stringify({ owner_id: uid, email, name: st.profile.businessName || "My Business" }),
          });
          const createJson = await createRes.json();
          if (createJson.merchant) {
            myMerchant = createJson.merchant;
            setMerchantId(myMerchant.id);
          }
        } catch {}
        if (myMerchant) {
          setMerchantId(myMerchant.id);
          const merchantOrders = await fetchOrders({ merchant_id: myMerchant.id });
          setOrders(merchantOrders);
        } else {
          setOrders([]);
        }
      }
      setLoading(false);
      fetchFeeConfig().then(setFees).catch(() => {});
      if (myMerchant) {
        setMerchantRecord({ name: myMerchant.name || "My Business", momo_number: myMerchant.momo_number || "", district: myMerchant.district || "", area: myMerchant.area || "", lat: myMerchant.lat || 0, lng: myMerchant.lng || 0, live_location_enabled: Boolean(myMerchant.live_location_enabled) });
        setLiveSharing(Boolean(myMerchant.live_location_enabled));
      }
      if (myMerchant?.id) {
        fetch(`/api/followers?merchant_id=${myMerchant.id}`).then((r) => r.json()).then(({ count }) => setFollowerCount(count || 0)).catch(() => {});
      }
      const userId = uid || st.profile.email || "";
      if (userId) getUserVerificationStatus(userId, st.profile.email || st.supabaseUser?.email || "").then(setVerified).catch(() => {});

    } catch (e) { console.error("[GoDoor] business refresh error:", e); }
  }, []);

  useEffect(() => {
    if (!mounted) return;
    // If auth not loaded yet, retry with delays
    let attempts = 0;
    const retry = () => {
      attempts++;
      const currentUid = useSession.getState().supabaseUser?.id;
      if (currentUid || attempts >= 10) {
        refresh();
      } else {
        setTimeout(retry, 300);
      }
    };
    retry();
  }, [mounted]); // eslint-disable-line

  // Poll every 8s + refresh on focus/visibility/popstate (covers back-navigation from chat/orders)
  useEffect(() => {
    if (!mounted) return;
    const tick = () => refresh().catch(() => {});
    const poll = setInterval(tick, 8000);
    const onFocus = () => { if (document.visibilityState === "visible") tick(); };
    const onPop = () => setTimeout(tick, 100);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    window.addEventListener("popstate", onPop);
    return () => {
      clearInterval(poll);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
      window.removeEventListener("popstate", onPop);
    };
  }, [mounted]); // eslint-disable-line

  // Real-time order protocol: new orders + status changes arrive instantly
  // with full details (items, customer, total) — no manual refresh needed.
  useEffect(() => {
    if (!merchantId) return;
    const seen = new Map<string, string>(); // orderId → last status we notified
    let unsub: (() => void) | undefined;
    try {
      unsub = subscribeToMerchantOrders(merchantId, (o) => {
        const before = seen.get(o.id);
        seen.set(o.id, o.status);
        if (!before) {
          // NEW ORDER — notify with customer, items and total
          addNotification({
            title: "new_order",
            body: `New order #${o.id.slice(-6)} from ${o.customer_name || "customer"}: ${orderSummary(o)}`,
            orderId: o.id,
            role: "business",
          });
          // Bring the new order into the list immediately
          setOrders((prev) => (prev.some((p) => p.id === o.id) ? prev : [o, ...prev]));
        } else if (before !== o.status) {
          // STATUS CHANGE — notify with what changed + items
          addNotification({
            title: o.status,
            body: `Order #${o.id.slice(-6)} (${o.items || "items"}) → ${o.status.replace(/_/g, " ")} · ${orderSummary(o)}`,
            orderId: o.id,
            role: "business",
          });
        }
        refresh().catch(() => {});
      });
    } catch (e) { console.error("[GoDoor] order sub error:", e); }
    return () => { if (unsub) unsub(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [merchantId]);

  useEffect(() => {
    let subs: (() => void)[] = [];
    try {
      subs = orders
        .filter((o) => ["rider_assigned", "delivering"].includes(o.status) && o.rider_id)
        .map((o) => subscribeToRiderLocation(o.rider_id!, (loc) => {
          setLiveRiderLocs((prev) => ({ ...prev, [o.rider_id!]: loc }));
        }));
    } catch (e) { console.error("[GoDoor] rider loc sub error:", e); }
    return () => subs.forEach((unsub) => unsub());
  }, [orders]);

  if (!mounted) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="text-center">
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <p className="mt-3 text-sm text-muted">Loading business dashboard…</p>
        </div>
      </div>
    );
  }

  if (!onboarded || role !== "business") {
    return (
      <div className="hero-wash flex min-h-[70vh] items-center justify-center px-4">
        <div className="text-center animate-fade-in">
          <div className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-2xl bg-primary/15 ring-1 ring-primary/30">
            <Store className="h-8 w-8 text-primary" />
          </div>
          <h1 className="font-display text-2xl font-bold">Business Dashboard</h1>
          <p className="mt-2 max-w-sm mx-auto text-sm text-muted">Register your restaurant, shop, or pharmacy to start receiving orders on GoDoor.</p>
          <Link href="/onboarding/business" className="btn btn-primary mt-6 px-6 py-3">
            Register Business →
          </Link>
        </div>
      </div>
    );
  }

  const merchantName = merchantRecord?.name || profile.businessName || "My Business";
  const momoNumber = merchantRecord?.momo_number || profile.momoNumber || "Set MoMo number";

  // Orders are already filtered by merchant_id from fetchOrders
  const allRelevant = orders;

  const pendingPayments = allRelevant.filter((o) => o.status === "payment_submitted");
  const activeOrders = allRelevant.filter((o) => ["payment_confirmed", "preparing", "ready", "rider_assigned", "delivering"].includes(o.status));
  const deliveredOrders = allRelevant.filter((o) => o.status === "delivered");
  const recentOrders = [...allRelevant].sort((a, b) => b.created_at - a.created_at).slice(0, 5);

  const todayOrders = allRelevant.filter((o) => Date.now() - o.created_at < 86400000);
  const todayRevenue = todayOrders.filter((o) => ["payment_confirmed", "delivered"].includes(o.status))
    .reduce((s, o) => s + o.total_ugx, 0);

  const confirmPayment = (orderId: string) => {
    updateOrder(orderId, { status: "payment_confirmed", payment_confirmed: true })
      .then(() => {
        setOrders((prev) => prev.map((o) => o.id === orderId ? { ...o, status: "payment_confirmed" as const, payment_confirmed: true } : o));
        setTimeout(() => refresh(), 300);
      })
      .catch(() => refresh());
  };

  const markPreparing = (orderId: string) => {
    updateOrder(orderId, { status: "preparing" })
      .then(() => {
        setOrders((prev) => prev.map((o) => o.id === orderId ? { ...o, status: "preparing" as const } : o));
        setTimeout(() => refresh(), 300);
      })
      .catch(() => refresh());
  };

  const markReady = (orderId: string) => {
    // Wait for server before updating UI — prevents phantom reset on 403
    updateOrder(orderId, { status: "ready" })
      .then(() => {
        setOrders((prev) => prev.map((o) => o.id === orderId ? { ...o, status: "ready" as const } : o));
        setTimeout(() => refresh(), 300);
      })
      .catch(() => refresh());
  };

  // ── Share live location (traveling services: makeup, salons, mobile shops) ──
  // The store pin on the map stays at the registered location; this opt-in
  // streams the owner's GPS so customers can watch the service come to them.

  const startLiveSharing = () => {
    if (!merchantId || gpsWatchRef.current != null) return;
    streamingRef.current = { merchantId, lastSend: 0 };
    if (!("geolocation" in navigator)) {
      setSharingBusy(false);
      return;
    }
    setSharingBusy(true);
    let lastSent: LatLng | null = null;
    gpsWatchRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setMyLiveLoc(loc);
        const now = Date.now();
        if (!streamingRef.current) return;
        // Accuracy gate (>80m skipped unless first fix) + 10m / 15s cadence.
        const acc = pos.coords.accuracy ?? 999;
        if (lastSent && acc > 80) return;
        if (lastSent) {
          const movedM = Math.hypot((loc.lat - lastSent.lat) * 111000, (loc.lng - lastSent.lng) * 111000 * Math.cos((loc.lat * Math.PI) / 180));
          if (movedM < 10 && now - streamingRef.current.lastSend < 15000) return;
        }
        updateProviderLocation(
          streamingRef.current.merchantId, pos.coords.latitude, pos.coords.longitude,
          pos.coords.heading || undefined, pos.coords.speed || undefined, pos.coords.accuracy || undefined,
        );
        streamingRef.current.lastSend = now;
        lastSent = loc;
      },
      () => setSharingBusy(false),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 5000 },
    );
    setTimeout(() => setSharingBusy(false), 4000);
  };

  const stopLiveSharing = () => {
    if (gpsWatchRef.current != null) {
      navigator.geolocation.clearWatch(gpsWatchRef.current);
      gpsWatchRef.current = null;
    }
    streamingRef.current = null;
    setMyLiveLoc(null);
    if (merchantId) clearProviderLocation(merchantId);
  };

  const toggleLiveSharing = async (enabled: boolean) => {
    setLiveSharing(enabled);
    if (enabled) {
      startLiveSharing();
      if (merchantId) updateMerchant(merchantId, { live_location_enabled: true }).catch(() => {});
    } else {
      stopLiveSharing();
      if (merchantId) updateMerchant(merchantId, { live_location_enabled: false }).catch(() => {});
    }
  };

  return (
    <div className="mx-auto min-h-screen max-w-6xl bg-bg px-0 pb-24 overflow-x-hidden">
      {/* Header — GoDoor orange merchant theme */}
      <div className="border-b border-primary/15 bg-gradient-to-b from-primary/8 to-transparent px-4 pt-4 pb-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="font-display text-lg font-bold">{merchantName}</h1>
              <span className="chip bg-primary/15 text-[9px] font-bold text-primary">
                <ShieldCheck className="h-2.5 w-2.5" /> Business
              </span>
              {verified === "approved" && (
                <span className="chip bg-success/15 text-[9px] font-bold text-success">
                  <ShieldCheck className="h-2.5 w-2.5" /> Verified
                </span>
              )}
              {verified === "pending" && (
                <span className="chip bg-warning/15 text-[9px] font-bold text-warning">
                  <ShieldCheck className="h-2.5 w-2.5" /> Pending
                </span>
              )}
            </div>
            <p className="mt-0.5 text-[10px] text-muted">{profile.category || "Business"} · {profile.area || "Uganda"}</p>
          </div>
          <div className="flex items-center gap-1.5">
            {verified !== "approved" && (
              <Link href="/verification" className="text-[10px] font-semibold text-primary underline underline-offset-2">Verify →</Link>
            )}
            <Link href="/business/earnings" className="grid h-9 w-9 place-items-center rounded-full bg-primary/10 text-primary" title="Earnings">
              <DollarSign className="h-4 w-4" />
            </Link>
          </div>
        </div>

        {/* Revenue card */}
        <div className="mt-3 overflow-hidden rounded-3xl bg-gradient-to-br from-primary via-primary/90 to-go-2 p-5 shadow-glow animate-spring-in">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-white/60">Today&apos;s Revenue</p>
              <div className="mt-0.5"><Price amount={todayRevenue} className="num text-2xl font-bold text-white" /></div>
            </div>
            <div className="text-right">
              <p className="text-[10px] text-white/60">Orders today</p>
              <p className="num text-2xl font-bold text-white">{todayOrders.length}</p>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2">
            <div className="rounded-xl bg-white/10 ring-1 ring-white/10 p-2 text-center">
              <p className="num text-sm font-bold text-white">{pendingPayments.length}</p>
              <p className="text-[9px] text-white/50">Pending</p>
            </div>
            <div className="rounded-xl bg-white/10 ring-1 ring-white/10 p-2 text-center">
              <p className="num text-sm font-bold text-white">{activeOrders.length}</p>
              <p className="text-[9px] text-white/50">Active</p>
            </div>
            <div className="rounded-xl bg-white/10 ring-1 ring-white/10 p-2 text-center">
              <p className="num text-sm font-bold text-white">{deliveredOrders.length}</p>
              <p className="text-[9px] text-white/50">Done</p>
            </div>
          </div>
        </div>

        {/* MoMo display */}
        <div className="tile p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-dim">Receive payments on</p>
              <p className="mt-0.5 text-lg font-bold num">{momoNumber}</p>
            </div>
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-primary/10">
              <Phone className="h-5 w-5 text-primary" />
            </div>
          </div>
          <p className="mt-2 text-[10px] text-dim">Customers pay you directly via MTN MoMo or Airtel Money</p>
        </div>

        {/* Pipeline stats — horizontal */}
        <div className="mt-3 flex items-center gap-1 overflow-x-auto pb-1">
          <div className="flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary whitespace-nowrap">
            <TrendingUp className="h-3 w-3" /> {followerCount} followers
          </div>
          <div className="flex items-center gap-1.5 rounded-full bg-success/10 px-3 py-1.5 text-xs font-semibold text-success whitespace-nowrap">
            <Check className="h-3 w-3" /> {deliveredOrders.length} delivered
          </div>
        </div>
      </div>

      <div className="space-y-4 px-4 pt-4">
        {/* Live delivery map — the dispatch center, front and centre */}
        <div>
          <div className="mb-3 flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <Navigation className="h-4 w-4 text-primary" />
              Live Delivery Map
              {Object.keys(liveRiderLocs).length > 0 && (
                <span className="chip gap-1 bg-primary/10 text-primary">
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-60" />
                    <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-primary" />
                  </span>
                  {Object.keys(liveRiderLocs).length} live
                </span>
              )}
            </h3>
            <Link href="/tracking" className="text-[10px] font-semibold text-primary hover:underline">
              {Object.keys(liveRiderLocs).length > 0 ? "Track riders →" : "Full map →"}
            </Link>
          </div>
          <div className="tile overflow-hidden">
            {/* Traveling-services opt-in: keep the store pin static, share GPS only when switched on */}
            <button type="button"
              onClick={() => toggleLiveSharing(!liveSharing)}
              className={`relative z-10 flex w-full items-center justify-between gap-2 border-b border-border px-4 py-3 text-left transition ${liveSharing ? "bg-primary/5" : "hover:bg-elevated"}`}
              aria-pressed={liveSharing}>
              <div className="flex items-center gap-2.5 min-w-0">
                <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-xl ${liveSharing ? "bg-primary/15 text-primary" : "bg-elevated text-muted"}`}>
                  <Radio className={`h-4 w-4 ${liveSharing ? "animate-pulse" : ""}`} />
                </span>
                <div className="min-w-0">
                  <p className="text-xs font-semibold">{liveSharing ? "Sharing live location" : "Travel to your customer's door?"}</p>
                  <p className="text-[10px] text-muted">For makeup, salons &amp; mobile shops — switch this on to share your live position so customers can track you arriving. Your store pin stays at its registered location.</p>
                </div>
              </div>
              <span className={`relative h-6 w-11 shrink-0 rounded-full transition ${liveSharing ? "bg-primary" : "bg-elevated"} ${sharingBusy ? "opacity-60" : ""}`}>
                <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${liveSharing ? "left-[22px]" : "left-0.5"}`} />
              </span>
            </button>
            <div className="relative h-[320px] sm:h-[440px] lg:h-[540px]">
              {/* Live status pill over the map — the dispatch headline */}
              <div className="absolute left-3 top-3 z-20 flex max-w-[calc(100%-4rem)] items-center gap-2 rounded-full border border-border bg-surface/85 px-3 py-1.5 shadow-lg backdrop-blur-md">
                <span className="relative flex h-2 w-2 shrink-0">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-60" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
                </span>
                <span className="truncate text-[11px] font-semibold text-fg">
                  {liveSharing
                    ? "Sharing live location — customers see you moving out to their door"
                    : Object.keys(liveRiderLocs).length > 0
                      ? `${Object.keys(liveRiderLocs).length} rider${Object.keys(liveRiderLocs).length > 1 ? "s" : ""} live on the map`
                      : myLocation
                        ? "Centred on your live location — riders appear as deliveries go live"
                        : "Detecting your live location…"}
                </span>
              </div>
              <MapboxMap
                center={
                  (liveSharing && myLiveLoc) ||
                  Object.values(liveRiderLocs)[0] ||
                  (merchantRecord?.lat && Math.abs(merchantRecord.lat) > 1e-9 ? { lat: merchantRecord.lat, lng: merchantRecord.lng } : { lat: 0.3163, lng: 32.5822 })
                }
                markers={[
                  // Shop location marker — always visible with business name tag (static fallback if no GPS yet)
                  {
                    id: "shop",
                    position: {
                      lat: merchantRecord?.lat && Math.abs(merchantRecord.lat) > 1e-9 ? merchantRecord.lat : 0.3163,
                      lng: merchantRecord?.lng && Math.abs(merchantRecord.lng) > 1e-9 ? merchantRecord.lng : 32.5822,
                    },
                    label: merchantRecord?.name || "My Shop",
                    isPickup: true,
                  },
                  // Active rider markers (with real heading so the arrow points true)
                  ...Object.entries(liveRiderLocs).map(([riderId, loc]) => ({
                    id: riderId,
                    position: loc,
                    label: "Rider",
                    isRider: true,
                    heading: (loc as { heading?: number | null }).heading ?? null,
                  })),
                  // Own moving marker — only while live sharing is switched on
                  ...(liveSharing && myLiveLoc ? [{
                    id: "me-live",
                    position: myLiveLoc,
                    label: merchantRecord?.name || "Provider",
                    isRider: true,
                    heading: null as number | null,
                  }] : []),
                ]}
                zoom={14}
                fillHeight
                userLocation={liveSharing ? myLiveLoc || myLocation : myLocation}
                fitBounds={[
                  { lat: merchantRecord?.lat && Math.abs(merchantRecord.lat) > 1e-9 ? merchantRecord.lat : 0.3163, lng: merchantRecord?.lng && Math.abs(merchantRecord.lng) > 1e-9 ? merchantRecord.lng : 32.5822 },
                  ...Object.values(liveRiderLocs) as Array<{ lat: number; lng: number }>,
                  ...(liveSharing && myLiveLoc ? [myLiveLoc] : []),
                  ...(myLocation ? [myLocation] : []),
                ]}
                fitPadding={{ top: 96, bottom: 72, left: 56, right: 56 }}
              />
            </div>
          </div>
        </div>

        {/* Pending payments — act first */}
        {pendingPayments.length > 0 && (
          <div className="space-y-3">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <CreditCard className="h-4 w-4 text-warning" />
              Payments waiting for confirmation ({pendingPayments.length})
            </h3>
            {pendingPayments.map((o) => (
              <div key={o.id} className="rounded-2xl border border-warning/30 bg-warning/5 p-4 shadow-xs card-hover animate-spring-in overflow-hidden">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-sm font-semibold">Payment from {o.customer_name || "Customer"}</p>
                    <p className="text-xs text-muted">{o.payment_method === "momo" ? "MTN MoMo" : o.payment_method === "airtel" ? "Airtel Money" : "Cash"} · Order #{o.id.slice(-6)}</p>
                  </div>
                  <div><Price amount={o.total_ugx} className="num text-lg font-bold text-primary" /></div>
                </div>
                <p className="mt-2 text-[10px] text-dim">Check your MoMo for the payment, then confirm below.</p>
                <div className="mt-3 flex gap-2">
                  <button type="button" onClick={() => confirmPayment(o.id)}
                    className="btn btn-primary flex-1">
                    <Check className="h-3.5 w-3.5" /> Payment received
                  </button>
                  <Link href={`/chat/${o.id}`}
                    className="btn btn-ghost">
                    <MessageCircle className="h-3 w-3" /> Chat
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Active orders */}
        <div>
          <div className="mb-3 flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <Package className="h-4 w-4 text-primary" />
              Active orders {activeOrders.length > 0 && `(${activeOrders.length})`}
            </h3>
            <Link href="/business/orders" className="text-[10px] font-semibold text-primary hover:underline">All orders →</Link>
          </div>
          {activeOrders.length === 0 ? (
            <div className="tile border-dashed bg-surface/50 p-6 text-center">
              <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-elevated ring-1 ring-border">
                <Clock className="h-6 w-6 text-dim" />
              </div>
              <p className="mt-3 text-sm font-medium">No active orders</p>
              <p className="mt-1 text-xs text-muted">New customer orders will appear here instantly</p>
            </div>
          ) : (
            <div className="space-y-3">
              {activeOrders.sort((a, b) => b.created_at - a.created_at).map((o) => (
                <div key={o.id} className="tile card-hover overflow-hidden p-4 animate-spring-in">
                  <div className="flex items-start justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold">{merchantName || o.merchant_name || o.customer_name || "Order"}</p>
                        <span className={`chip text-[9px] ${STATUS_COLORS[o.status] || "bg-elevated text-muted"}`}>
                          {o.status.replace(/_/g, " ")}
                        </span>
                      </div>
                      <p className="mt-0.5 text-xs text-muted">{o.items}</p>
                      <p className="mt-0.5 text-[10px] text-dim">#{o.id.slice(-6)} · {o.customer_name ? `Customer: ${o.customer_name} · ` : ""}{new Date(o.created_at).toLocaleString([], { hour: "2-digit", minute: "2-digit", month: "short", day: "numeric" })}</p>
                    </div>
                    <div className="ml-2 shrink-0">
                      <div><Price amount={o.total_ugx} className="num text-sm font-bold text-primary" /></div>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2 border-t border-border pt-3">
                    {o.status === "payment_confirmed" && (
                      <button type="button" onClick={() => markPreparing(o.id)}
                        className="btn btn-soft flex-1">
                        <Clock className="h-3 w-3" /> Start preparing
                      </button>
                    )}
                    {(o.status === "preparing" || o.status === "payment_confirmed") && (
                      <button type="button" onClick={() => markReady(o.id)}
                        className="btn flex-1 bg-success text-white hover:bg-success/90 shadow-md">
                        <Check className="h-3 w-3" /> Ready for pickup
                      </button>
                    )}
                    {o.status === "ready" && (
                      <p className="flex items-center justify-center gap-1 rounded-xl bg-success/10 py-2 text-[10px] font-medium text-success">
                        <Check className="h-3 w-3" /> Ready — waiting for a rider to pick up
                      </p>
                    )}
                    <Link href={`/chat/${o.id}`}
                      className="btn btn-ghost">
                      <MessageCircle className="h-3 w-3" /> Chat
                    </Link>
                    {["rider_assigned", "delivering"].includes(o.status) && (
                      <Link href={`/tracking?orderId=${o.id}`} className="btn bg-success/10 text-success hover:bg-success/20">
                        <Navigation className="h-3 w-3" /> Track rider
                      </Link>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent orders — collapsed by default so the dispatch view stays
            calm; full history lives one tap away in Orders. Nothing is lost. */}
        <details className="group rounded-2xl border border-border bg-surface">
          <summary className="flex cursor-pointer list-none items-center justify-between p-3.5 [&::-webkit-details-marker]:hidden">
            <span className="flex items-center gap-2 text-sm font-semibold">
              <History className="h-4 w-4 text-primary" />
              Recent orders
              {recentOrders.length > 0 && (
                <span className="num rounded-full bg-elevated px-2 py-0.5 text-[10px] font-bold text-muted">{recentOrders.length}</span>
              )}
            </span>
            <span className="flex items-center gap-2">
              <Link href="/business/orders" onClick={(e) => e.stopPropagation()} className="text-[10px] font-semibold text-primary hover:underline">All orders →</Link>
              <ChevronDown className="h-4 w-4 text-dim transition group-open:rotate-180" />
            </span>
          </summary>
          <div className="px-3.5 pb-3.5">
          {recentOrders.length === 0 ? (
            <div className="tile border-dashed bg-surface/50 p-6 text-center">
              <div className="mx-auto grid h-11 w-11 place-items-center rounded-xl bg-elevated ring-1 ring-border">
                <History className="h-5 w-5 text-dim" />
              </div>
              <p className="mt-2.5 text-xs font-medium text-muted">No orders yet</p>
            </div>
          ) : (
            <div className="space-y-2">
              {recentOrders.map((o) => (
                <div key={o.id} className="tile card-hover flex items-center gap-3 p-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <p className="num text-xs font-semibold">#{o.id.slice(-6)}</p>
                      <span className={`chip text-[9px] ${STATUS_COLORS[o.status] || "bg-elevated text-muted"}`}>
                        {o.status.replace(/_/g, " ")}
                      </span>
                    </div>
                    <p className="mt-0.5 truncate text-[10px] text-muted">
                      {o.customer_name ? `${o.customer_name} · ` : ""}{o.items}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <div><Price amount={o.total_ugx} className="num text-xs font-bold text-primary" /></div>
                    <Link href={`/chat/${o.id}`} className="text-[10px] font-semibold text-primary hover:underline">Chat</Link>
                  </div>
                </div>
              ))}
            </div>
          )}
          </div>
        </details>

        {/* Clinic appointments entry */}
        {(profile as any).businessType === "clinic" && (
          <Link href="/business/appointments"
            className="mt-3 flex w-full items-center gap-3 rounded-2xl border border-primary/30 bg-primary/10 p-3.5 shadow-xs card-hover transition hover:bg-primary/15">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary text-white">
              <Stethoscope className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">Appointments</p>
              <p className="text-[10px] text-muted">Manage the waiting room, consultations & prescriptions</p>
            </div>
            <CalendarClock className="h-4 w-4 shrink-0 text-primary" />
          </Link>
        )}

        {/* Quick tools */}
        <div className="grid grid-cols-2 gap-2 pb-2 md:grid-cols-4">
          <Link href="/business/products" className="tile card-hover group p-3.5 hover:bg-elevated">
            <ShoppingBag className="h-5 w-5 text-primary transition-transform duration-200 group-hover:scale-110" />
            <p className="mt-2 text-xs font-semibold">Products</p>
            <p className="text-[10px] text-dim">Manage menu</p>
          </Link>
          <Link href="/business/store" className="tile card-hover group p-3.5 hover:bg-elevated">
            <Store className="h-5 w-5 text-primary transition-transform duration-200 group-hover:scale-110" />
            <p className="mt-2 text-xs font-semibold">Store</p>
            <p className="text-[10px] text-dim">Profile & settings</p>
          </Link>
          <Link href="/business/earnings" className="tile card-hover group p-3.5 hover:bg-elevated">
            <TrendingUp className="h-5 w-5 text-success transition-transform duration-200 group-hover:scale-110" />
            <p className="mt-2 text-xs font-semibold">Earnings</p>
            <p className="text-[10px] text-dim">Payouts & fees</p>
          </Link>
          <Link href="/verification" className="tile card-hover group p-3.5 hover:bg-elevated">
            <ShieldCheck className="h-5 w-5 text-warning transition-transform duration-200 group-hover:scale-110" />
            <p className="mt-2 text-xs font-semibold">Verification</p>
            <p className="text-[10px] text-dim">{verified === "approved" ? "Approved ✓" : "Upload docs"}</p>
          </Link>
          <Link href="/business/team" className="tile card-hover group p-3.5 hover:bg-elevated">
            <Users className="h-5 w-5 text-go transition-transform duration-200 group-hover:scale-110" />
            <p className="mt-2 text-xs font-semibold">Team</p>
            <p className="text-[10px] text-dim">Your couriers</p>
          </Link>
        </div>

        {/* Stories */}
        {merchantId && (
          <div className="tile p-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold">Story Updates</h3>
                <p className="text-[10px] text-dim">Share updates — auto-delete after 12h</p>
              </div>
              <StoryComposer merchantId={merchantId} onDone={refresh} />
            </div>
          </div>
        )}

        {/* Sign out */}
        <button type="button" onClick={() => { reset(); window.location.href = "/"; }}
          className="btn btn-danger w-full">
          <LogOut className="h-4 w-4" /> Sign out
        </button>
      </div>
    </div>
  );
}


export default function BusinessDashboard() {
  return (
    <BusinessErrorBoundary>
      <BusinessDashboardInner />
    </BusinessErrorBoundary>
  );
}
