"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Package, MessageCircle, ArrowLeft, MapPin, Navigation, Star, RotateCcw, X } from "lucide-react";
import { useSession } from "@/lib/session-store";
import { fetchOrders, subscribeToOrderStatus, apiAuthHeaders, type DBOrder } from "@/lib/db";
import { useNotifications, orderSummary } from "@/lib/notifications-store";
import { useTrackingStore } from "@/lib/tracking-store";
import { formatUgx } from "@/lib/utils";
import { Price } from "@/components/Price";
import { CustomerNav } from "@/components/CustomerNav";
import { useRatings } from "@/lib/customer-stores";
import { useCart } from "@/lib/cart-store";

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-warning/15 text-warning",
  payment_submitted: "bg-warning/15 text-warning",
  payment_confirmed: "bg-success/15 text-success",
  preparing: "bg-go/15 text-go",
  rider_assigned: "bg-primary/15 text-primary",
  delivering: "bg-go/15 text-go",
  delivered: "bg-success/15 text-success",
  cancelled: "bg-elevated text-muted",
  disputed: "bg-danger/15 text-danger",
  medicines_ready: "bg-warning/15 text-warning",
};

export default function OrdersPage() {
  const { profile, onboarded, supabaseUser, role } = useSession();

  // Business/rider have their own order views — don't show customer orders + cart nav
  useEffect(() => {
    if (!onboarded) return;
    if (role === "business") window.location.href = "/business/orders";
    else if (role === "rider") window.location.href = "/rider";
    else if (role === "admin") window.location.href = "/admin/orders";
  }, [role, onboarded]);
  const [orders, setOrders] = useState<DBOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const { active: trackedDelivery } = useTrackingStore();
  const { ratings, rate } = useRatings();
  const addToCart = useCart((s) => s.add);
  const [ratingOrder, setRatingOrder] = useState<string | null>(null);
  const [ratingStars, setRatingStars] = useState(5);
  const [ratingText, setRatingText] = useState("");
  const { addNotification } = useNotifications();

  // Cancel order (only for pending/payment_submitted)
  const cancelOrder = async (orderId: string) => {
    if (!confirm("Cancel this order?")) return;
    try {
      await fetch("/api/orders", {
        method: "PATCH",
        headers: await apiAuthHeaders(true),
        body: JSON.stringify({ id: orderId, patch: { status: "cancelled" } }),
      });
      setOrders((prev) => prev.map((o) => o.id === orderId ? { ...o, status: "cancelled" } : o));
    } catch (e) {
      console.error("Cancel failed:", e);
    }
  };

  // Live order status alerts — notify the customer on every status change
  useEffect(() => {
    if (orders.length === 0) return;
    const unsubs = orders
      .filter((o) => o.customer_id === supabaseUser?.id || o.customer_email === profile.email)
      .map((o) => subscribeToOrderStatus(o.id, (status) => {
        if (status === o.status) return;
        addNotification({
          title: status,
          body: `${o.merchant_name} · Order #${o.id.slice(-6)} (${o.items || "items"}) is now ${status.replace(/_/g, " ")} · ${orderSummary(o)}`,
          orderId: o.id,
          role: "customer",
        });
      }));
    return () => unsubs.forEach((u) => u());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orders.length, supabaseUser?.id, profile.email]);

  const loadOrders = async () => {
    try {
      const userId = supabaseUser?.id || "";
      const email = profile.email || supabaseUser?.email || "";
      // Fetch ALL orders, then filter client-side by id OR email (covers edge cases)
      const all = await fetchOrders();
      const myOrders = all.filter((o) => {
        if (userId && o.customer_id === userId) return true;
        if (email && o.customer_email === email) return true;
        if (userId && o.customer_id === email) return true; // Handle email-as-id case
        return false;
      });
      setOrders(myOrders);
    } catch (e) {
      console.error("[GoDoor] orders load error:", e);
    }
    setLoading(false);
  };

  useEffect(() => { loadOrders(); }, [supabaseUser?.id, profile.email]);

  // Re-fetch when returning to this page (back from chat, tracking, etc.)
  useEffect(() => {
    const onVis = () => { if (document.visibilityState === "visible") loadOrders(); };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onVis);
    const poll = setInterval(loadOrders, 30000);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", onVis);
      clearInterval(poll);
    };
  }, [supabaseUser?.id, profile.email]);

  return (
    <div className="mx-auto min-h-[70vh] max-w-lg bg-bg pb-24">
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        <Link href="/app" className="text-muted hover:text-fg"><ArrowLeft className="h-5 w-5" /></Link>
        <h1 className="font-display text-lg font-semibold">My Orders</h1>
      </div>

      {trackedDelivery && trackedDelivery.status !== "delivered" && (
        <div className="mx-4 mt-3">
          <Link href={trackedDelivery ? `/tracking?orderId=${trackedDelivery.deliveryId}` : "/tracking"} className="flex items-center gap-3 rounded-2xl border border-go/30 bg-go/10 p-4 transition hover:bg-go/15">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-go/20">
              <Navigation className="h-5 w-5 text-go animate-pulse" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-go">Live delivery in progress</p>
              <p className="text-xs text-muted truncate">{trackedDelivery.merchantName} → {trackedDelivery.dropoffAddr}</p>
            </div>
            <Navigation className="h-4 w-4 text-go" />
          </Link>
        </div>
      )}

      <div className="px-4 pt-4 space-y-3">
        {loading ? (
          <div className="space-y-3 pt-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="skeleton h-28 w-full rounded-2xl" />
            ))}
          </div>
        ) : orders.length === 0 ? (
          <div className="py-12 text-center animate-fade-in">
            <div className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-full bg-go/10">
              <Package className="h-6 w-6 text-go" />
            </div>
            <p className="text-sm font-semibold text-fg">No orders yet</p>
            <p className="mt-1 text-xs text-muted max-w-xs mx-auto">Browse merchants and place your first order to see it here.</p>
            <Link href="/app" className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-go px-5 py-2.5 text-xs font-semibold text-white hover:bg-go-2 transition">
              Browse merchants →
            </Link>
          </div>
        ) : (
          orders.sort((a, b) => b.created_at - a.created_at).map((o) => (
            <div key={o.id} className="rounded-2xl border border-border bg-surface p-4 transition hover:border-primary/30">
              <div className="flex items-start justify-between">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">{o.merchant_name}</p>
                  <p className="mt-0.5 text-xs text-muted truncate">{o.items}</p>
                  <p className="mt-0.5 text-[10px] text-dim">#{o.id.slice(-6)} · {new Date(o.created_at).toLocaleDateString()}</p>
                </div>
                <div className="text-right shrink-0 ml-3">
                  <div><Price amount={o.total_ugx} className="text-sm font-bold text-go" /></div>
                  <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[9px] font-semibold ${STATUS_COLORS[o.status] || "bg-elevated text-muted"}`}>
                    {o.status.replace(/_/g, " ")}
                  </span>
                </div>
              </div>
              <div className="mt-3 flex gap-2">
                <Link href={`/chat/${o.id}`} className="flex items-center justify-center gap-1 rounded-xl bg-go/10 px-3 py-2 text-xs font-medium text-go hover:bg-go/20 transition">
                  <MessageCircle className="h-3 w-3" /> Chat
                </Link>
                {o.status === "pending" && (
                  <button type="button" onClick={() => cancelOrder(o.id)}
                    className="flex items-center gap-1 rounded-xl bg-danger/10 px-3 py-2 text-xs font-medium text-danger hover:bg-danger/20 transition">
                    <X className="h-3 w-3" /> Cancel
                  </button>
                )}
                {o.status === "delivered" && !ratings[o.id] && (
                  <button type="button" onClick={() => setRatingOrder(o.id)}
                    className="flex items-center gap-1 rounded-xl bg-warning/10 px-3 py-2 text-xs font-medium text-warning hover:bg-warning/20 transition">
                    <Star className="h-3 w-3" /> Rate
                  </button>
                )}
                {ratings[o.id] && (
                  <span className="flex items-center gap-0.5 rounded-xl bg-warning/10 px-2 py-2 text-[10px] text-warning">
                    {"★".repeat(ratings[o.id].stars)}{"☆".repeat(5 - ratings[o.id].stars)}
                  </span>
                )}
                {["delivering", "rider_assigned", "preparing"].includes(o.status) && (
                  <Link href={`/tracking?orderId=${o.id}`} className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-success/10 py-2.5 text-xs font-medium text-success hover:bg-success/20 transition">
                    <MapPin className="h-3 w-3" /> Track order
                  </Link>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Rating modal */}
      {ratingOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/60" onClick={() => setRatingOrder(null)} />
          <div className="relative z-10 w-full max-w-sm rounded-3xl bg-bg p-5 shadow-2xl animate-scale-in">
            <h3 className="font-display text-lg font-semibold">Rate your order</h3>
            <p className="mt-1 text-xs text-muted">How was your experience?</p>
            <div className="mt-4 flex justify-center gap-1">
              {[1, 2, 3, 4, 5].map((s) => (
                <button key={s} type="button" onClick={() => setRatingStars(s)}
                  className="text-3xl transition hover:scale-110 active:scale-95">
                  <span className={s <= ratingStars ? "text-warning" : "text-dim"}>★</span>
                </button>
              ))}
            </div>
            <textarea value={ratingText} onChange={(e) => setRatingText(e.target.value)}
              placeholder="Tell us more (optional)" rows={2}
              className="mt-4 w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm outline-none ring-go focus:ring-2 resize-none" />
            <button type="button" onClick={() => { rate(ratingOrder, ratingStars, ratingText); setRatingOrder(null); setRatingText(""); }}
              className="mt-3 w-full rounded-xl bg-go py-3 text-sm font-semibold text-white hover:bg-go-2 transition">
              Submit rating
            </button>
          </div>
        </div>
      )}

      {(role === "customer" || !onboarded) && <CustomerNav />}
    </div>
  );
}
