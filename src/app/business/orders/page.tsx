"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Package, MessageCircle, Check, Clock, Search, X, Timer, CheckCircle2, RefreshCw, Phone, Truck, Navigation, Loader2, Copy } from "lucide-react";
import { MorseLogo } from "@/components/MorseLogo";
import { useSession } from "@/lib/session-store";
import { fetchOrders, updateOrder, subscribeToMerchantOrders, apiAuthHeaders, type DBOrder } from "@/lib/db";
import { formatUgx } from "@/lib/utils";
import { Price } from "@/components/Price";

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-warning/15 text-warning", payment_submitted: "bg-warning/15 text-warning",
  payment_confirmed: "bg-success/15 text-success", preparing: "bg-primary/15 text-primary",
  rider_assigned: "bg-primary/15 text-primary", delivering: "bg-primary/15 text-primary",
  delivered: "bg-success/15 text-success", cancelled: "bg-elevated text-muted",
  disputed: "bg-danger/15 text-danger",
  medicines_ready: "bg-warning/15 text-warning",
};

function OrderSkeleton() {
  return (
    <div className="rounded-2xl border border-border bg-surface p-4 animate-pulse">
      <div className="flex items-start justify-between">
        <div className="flex-1 space-y-2">
          <div className="h-4 w-32 rounded bg-elevated" />
          <div className="h-3 w-48 rounded bg-elevated" />
          <div className="h-2.5 w-20 rounded bg-elevated" />
        </div>
        <div className="h-5 w-16 rounded bg-elevated" />
      </div>
      <div className="mt-3 flex gap-2 border-t border-border pt-3">
        <div className="h-7 w-24 rounded-lg bg-elevated" />
        <div className="h-7 w-16 rounded-lg bg-elevated" />
      </div>
    </div>
  );
}

export default function BusinessOrdersPage() {
  const { profile, supabaseUser } = useSession();
  const pathname = usePathname();
  const [orders, setOrders] = useState<DBOrder[]>([]);
  const [filter, setFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [prepTimeModal, setPrepTimeModal] = useState<string | null>(null);
  const [prepMinutes, setPrepMinutes] = useState("15");
  const [myMerchantId, setMyMerchantId] = useState<string | null>(null);
  const [myMerchantName, setMyMerchantName] = useState<string>("");
  const [morseTag, setMorseTag] = useState<string>("");
  const [morseModal, setMorseModal] = useState<string | null>(null);
  const [morseRequests, setMorseRequests] = useState<Record<string, any>>({});
  const [morseRate, setMorseRate] = useState(3800);
  const [morseBusy, setMorseBusy] = useState(false);
  const [morseMsg, setMorseMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [copiedMorse, setCopiedMorse] = useState(false);

  const uid = supabaseUser?.id;

  // Core refresh — fetch ALL orders then filter client-side (bypasses RLS)
  const refresh = useCallback(async () => {
    const uid = useSession.getState().supabaseUser?.id || "";
    const email = useSession.getState().profile.email || useSession.getState().supabaseUser?.email || "";
    if (!uid && !email) { setLoading(false); return; }
    try {
      // Look up this business's merchant directly
      let myMerchant: any = null;
      try {
        const res = await fetch(`/api/business/me`, { cache: "no-store", headers: await apiAuthHeaders(false) });
        const json = await res.json();
        myMerchant = json.merchant;
      } catch {}
      if (!myMerchant) {
        // Try to auto-create
        try {
          const createRes = await fetch("/api/business/me", {
            method: "POST",
            headers: await apiAuthHeaders(true),
            body: JSON.stringify({ owner_id: uid, email, name: useSession.getState().profile.businessName || "My Business" }),
          });
          const cj = await createRes.json();
          if (cj.merchant) myMerchant = cj.merchant;
        } catch {}
      }
      if (!myMerchant) {
        setMyMerchantId(null);
        setOrders([]);
        setLoading(false);
        return;
      }
      setMyMerchantId(myMerchant.id);
      setMyMerchantName(myMerchant.name || useSession.getState().profile.businessName || "");
      setMorseTag(myMerchant.morse_tag || "");
      // Fetch orders for this merchant
      const merchantOrders = await fetchOrders({ merchant_id: myMerchant.id });
      setOrders(merchantOrders);
    } catch (e) {
      console.error("[GoDoor] business orders refresh error:", e);
    }
    setLoading(false);
  }, []);

  // Main effect: reliably fetch as soon as auth lands — fixes lazy bug where business sees "No orders" because refresh ran before Supabase session hydrated
  useEffect(() => {
    let cancelled = false;
    const tryFetch = () => {
      if (cancelled) return;
      const u = useSession.getState().supabaseUser?.id;
      const email = useSession.getState().profile?.email || useSession.getState().supabaseUser?.email;
      if (u || email) {
        setLoading(true);
        refresh();
      } else {
        // Keep polling until auth hydrates (Supabase restores session async)
        setTimeout(tryFetch, 400);
      }
    };
    tryFetch();
    return () => { cancelled = true; };
  }, [uid]); // re-run when auth Hydrates

  // This fires every time the browser navigates (back/forward/links)
  useEffect(() => {
    const onRouteChange = () => { setTimeout(() => refresh(), 100); };
    window.addEventListener("popstate", onRouteChange);
    // Also use a Next.js router event workaround — poll on focus
    const onFocus = () => { if (document.visibilityState === "visible") refresh(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("popstate", onRouteChange);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, []); // eslint-disable-line

  // Polling: keep data fresh every 8s
  useEffect(() => {
    const tick = () => refresh();
    const poll = setInterval(tick, 8000);
    return () => clearInterval(poll);
  }, []); // eslint-disable-line

  // Realtime subscription
  useEffect(() => {
    if (!myMerchantId) return;
    const unsub = subscribeToMerchantOrders(myMerchantId, (updated) => {
      setOrders((prev) => {
        const exists = prev.some((o) => o.id === updated.id);
        if (!exists) return [updated, ...prev];
        return prev.map((o) => (o.id === updated.id ? updated : o));
      });
    });
    return () => { unsub(); };
  }, [myMerchantId]);

  // Morse config + this merchant's payment requests
  useEffect(() => {
    fetch("/api/morse").then((r) => r.json()).then((j) => { if (j.config) setMorseRate(j.config.rateUgx); }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!myMerchantId) return;
    let on = true;
    (async () => {
      try {
        const res = await fetch(`/api/morse/request?merchant_id=${myMerchantId}`, { cache: "no-store", headers: await apiAuthHeaders(false) });
        const j = await res.json();
        if (!on) return;
        const map: Record<string, any> = {};
        (Array.isArray(j.requests) ? j.requests : []).forEach((r: any) => { map[r.order_id] = r; });
        setMorseRequests(map);
      } catch {}
    })();
    return () => { on = false; };
  }, [myMerchantId, morseModal]);

  const createMorseRequest = async () => {
    if (!morseModal) return;
    setMorseBusy(true);
    setMorseMsg(null);
    try {
      const res = await fetch("/api/morse/request", {
        method: "POST",
        headers: await apiAuthHeaders(true),
        body: JSON.stringify({ orderId: morseModal }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setMorseMsg({ ok: false, text: j?.error?.message || j?.error || "Could not request payment." }); return; }
      setMorseMsg({ ok: true, text: "Request created. Follow the steps in the Morse app to push it to the customer." });
      setMorseRequests((prev) => ({ ...prev, [morseModal]: j.data }));
    } catch {
      setMorseMsg({ ok: false, text: "Network error. Try again." });
    }
    setMorseBusy(false);
  };

  const settleMorse = async (reqId: string, status: "paid" | "cancelled", orderId: string) => {
    setMorseBusy(true);
    setMorseMsg(null);
    try {
      const res = await fetch("/api/morse/request", {
        method: "PATCH",
        headers: await apiAuthHeaders(true),
        body: JSON.stringify({ id: reqId, status }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setMorseMsg({ ok: false, text: j?.error?.message || j?.error || "Could not update the request." }); return; }
      setMorseMsg({ ok: true, text: status === "paid" ? "Marked as received — the USD is on your Morse tag." : "Request cancelled." });
      setMorseRequests((prev) => ({ ...prev, [orderId]: j.data }));
    } catch {
      setMorseMsg({ ok: false, text: "Network error. Try again." });
    }
    setMorseBusy(false);
  };

  const copyMorseDetails = async (order: DBOrder | undefined, req: any) => {
    const ref = String(req?.reference || "").trim() || `GD-${String(order?.id || "").replace(/-/g, "").slice(0, 10)}`;
    const usdt = req?.amount_usdt ? Number(req.amount_usdt) : Math.max(1, Math.ceil((order?.total_ugx || 0) / morseRate));
    const block = [
      `Morse payment for GoDoor order ${ref}`,
      `Amount: $${usdt} USD`,
      req?.customer_morse_tag ? `Customer Morse tag: @${String(req.customer_morse_tag).replace(/^@/, "")}` : "",
      `Pay into this tag: @${String(req?.business_morse_tag || morseTag).replace(/^@/, "")}`,
      `Note to include: ${ref}`,
    ].filter(Boolean).join("\n");
    try {
      await navigator.clipboard.writeText(block);
      setCopiedMorse(true);
      setTimeout(() => setCopiedMorse(false), 2000);
    } catch {}
  };

  const filtered = orders.filter((o) => filter === "all" || o.status === filter).sort((a, b) => b.created_at - a.created_at);

  const counts: Record<string, number> = { all: orders.length };
  ["payment_submitted", "payment_confirmed", "preparing", "ready", "delivering", "delivered"].forEach((s) => {
    counts[s] = orders.filter((o) => o.status === s).length;
  });

  const [actionError, setActionError] = useState<string | null>(null);
  const confirmPrepTime = () => {
    if (!prepTimeModal) return;
    const id = prepTimeModal;
    setActionError(null);
    setOrders((prev) => prev.map((o) => o.id === id ? { ...o, status: "preparing", notes: `Prep time: ${prepMinutes} min` } : o));
    setPrepTimeModal(null);
    updateOrder(id, { status: "preparing", notes: `Prep time: ${prepMinutes} min` }).catch((e) => { setActionError(e instanceof Error ? e.message : "Failed to accept order"); refresh(); });
  };

  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const rejectOrder = (orderId: string) => {
    setActionError(null);
    setActionBusy(orderId);
    setOrders((prev) => prev.map((o) => o.id === orderId ? { ...o, status: "cancelled" } : o));
    updateOrder(orderId, { status: "cancelled" })
      .catch((e) => { setActionError(e instanceof Error ? e.message : "Failed to cancel"); refresh(); })
      .finally(() => setActionBusy((cur) => (cur === orderId ? null : cur)));
  };

  const confirmPayment = (orderId: string) => {
    setActionError(null);
    setActionBusy(orderId);
    setOrders((prev) => prev.map((o) => o.id === orderId ? { ...o, status: "payment_confirmed", payment_confirmed: true } : o));
    updateOrder(orderId, { status: "payment_confirmed", payment_confirmed: true })
      .catch((e) => { setActionError(e instanceof Error ? e.message : "Failed to confirm"); refresh(); })
      .finally(() => setActionBusy((cur) => (cur === orderId ? null : cur)));
  };

  const [readyBusy, setReadyBusy] = useState<string | null>(null);
  const markReady = (orderId: string) => {
    setActionError(null);
    setReadyBusy(orderId);
    // Server-first, only update UI on confirmed success — prevents snap-back
    updateOrder(orderId, { status: "ready" }).then(() => {
      setOrders((prev) => prev.map((o) => o.id === orderId ? { ...o, status: "ready" } : o));
      setReadyBusy(null);
    }).catch((e) => {
      const msg = e instanceof Error ? e.message : "Could not mark as ready — try again";
      // Show the real server reason when it's an auth/transition error
      setActionError(msg.includes("not allowed") || msg.includes("authorized") ? msg + " — please refresh and try again. If it persists, re-save your store location in /business/store." : msg);
      setReadyBusy(null);
      refresh();
    });
  };

  return (<>
    <div className="mx-auto min-h-screen max-w-6xl bg-bg px-4 pb-24">
      <div className="flex items-center justify-between pt-4">
        <div>
          <h1 className="font-display text-xl font-bold">Orders</h1>
          <p className="mt-1 text-xs text-muted">Manage incoming and active orders</p>
        </div>
        <button type="button" onClick={() => refresh()} className="flex items-center gap-1.5 rounded-xl bg-surface border border-border px-3 py-2 text-xs font-medium text-muted hover:bg-elevated transition">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {["all", "payment_submitted", "payment_confirmed", "preparing", "ready", "delivering", "delivered"].map((f) => (
          <button key={f} type="button" onClick={() => setFilter(f)}
            className={`rounded-full px-2.5 py-1 text-[10px] font-medium transition ${filter === f ? "bg-primary text-white" : "bg-surface text-muted"}`}>
            {f === "all" ? "All" : f.replace(/_/g, " ")} {counts[f] > 0 ? `(${counts[f]})` : ""}
          </button>
        ))}
      </div>

      <div className="mt-3 relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-dim" />
        <input value="" onChange={() => {}} placeholder="Search orders…"
          className="w-full rounded-xl border border-border bg-surface py-2.5 pl-10 pr-3 text-sm outline-none ring-primary focus:ring-2" />
      </div>
      {actionError && (
        <div className="mt-3 rounded-xl border border-danger/20 bg-danger/10 px-3 py-2.5 flex items-center gap-2">
          <X className="h-4 w-4 text-danger shrink-0" />
          <p className="text-xs text-danger">{actionError}</p>
          <button type="button" onClick={() => setActionError(null)} className="ml-auto text-[10px] text-danger underline">Dismiss</button>
        </div>
      )}

      <div className="mt-4 space-y-2 md:max-w-4xl">
        {loading ? (
          <div className="space-y-2">
            <OrderSkeleton />
            <OrderSkeleton />
            <OrderSkeleton />
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-12 text-center">
            <Package className="mx-auto h-8 w-8 text-dim" />
            <p className="mt-2 text-sm text-muted">No orders{filter !== "all" ? ` with status "${filter.replace(/_/g, " ")}"` : ""}</p>
            <p className="mt-1 text-[10px] text-dim">Orders from customers will appear here automatically</p>
          </div>
        ) : (
          filtered.map((o) => (
            <div key={o.id} className={`rounded-2xl border bg-surface p-4 transition overflow-hidden ${
              o.status === "payment_submitted" ? "border-warning/40 ring-1 ring-warning/20" : "border-border"
            }`}>
              <div className="flex items-start justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold">{myMerchantName || o.merchant_name || o.customer_name || "Order"}</p>
                    <span className={`rounded-full px-2 py-0.5 text-[9px] font-semibold ${STATUS_COLORS[o.status] || "bg-elevated text-muted"}`}>
                      {o.status.replace(/_/g, " ")}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-muted">{o.items}</p>
                  <p className="mt-0.5 text-[10px] text-dim">#{o.id.slice(-6)} · {o.customer_name ? `Customer: ${o.customer_name} · ` : ""}{new Date(o.created_at).toLocaleString([], { hour: "2-digit", minute: "2-digit", month: "short", day: "numeric" })}</p>
                </div>
                <div className="ml-3 shrink-0 text-right">
                  <div><Price amount={o.total_ugx} className="text-sm font-bold text-primary" /></div>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5 border-t border-border pt-3">
                {o.status === "payment_submitted" && (
                  <>
                    <button type="button" onClick={() => confirmPayment(o.id)} disabled={actionBusy === o.id}
                      className={`flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[10px] font-medium transition ${actionBusy === o.id ? "bg-success/50 text-white/80 cursor-wait" : "bg-success/15 text-success hover:bg-success/25"}`}>
                      {actionBusy === o.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />} {actionBusy === o.id ? "Confirming…" : "Confirm payment"}
                    </button>
                    <button type="button" onClick={() => rejectOrder(o.id)} disabled={actionBusy === o.id}
                      className={`flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[10px] font-medium transition ${actionBusy === o.id ? "bg-danger/50 text-white/80 cursor-wait" : "bg-danger/15 text-danger hover:bg-danger/25"}`}>
                      {actionBusy === o.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />} {actionBusy === o.id ? "Rejecting…" : "Reject"}
                    </button>
                    <Link href={`/chat/${o.id}`}
                      className="flex items-center gap-1 rounded-lg bg-surface border border-border px-2.5 py-1.5 text-[10px] font-medium text-muted hover:bg-elevated transition">
                      <MessageCircle className="h-3 w-3" /> Chat
                    </Link>
                  </>
                )}
                {o.status === "payment_confirmed" && (
                  <>
                    <button type="button" onClick={() => { setPrepTimeModal(o.id); }}
                      className="flex items-center gap-1 rounded-lg bg-primary/15 px-2.5 py-1.5 text-[10px] font-medium text-primary hover:bg-primary/25 transition">
                      <Timer className="h-3 w-3" /> Accept (set prep time)
                    </button>
                    <button type="button" onClick={() => rejectOrder(o.id)} disabled={actionBusy === o.id}
                      className={`flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[10px] font-medium transition ${actionBusy === o.id ? "bg-danger/50 text-white/80 cursor-wait" : "bg-danger/15 text-danger hover:bg-danger/25"}`}>
                      {actionBusy === o.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />} {actionBusy === o.id ? "Rejecting…" : "Reject"}
                    </button>
                  </>
                )}
                {(o.status === "preparing" || o.status === "payment_confirmed") && (
                  <button type="button" onClick={() => markReady(o.id)} disabled={readyBusy === o.id}
                    className={`flex items-center gap-1 rounded-xl px-3 py-2 text-xs font-bold shadow-md transition ${readyBusy === o.id ? "bg-success/50 text-white/80 cursor-wait" : "bg-success text-white hover:bg-success/90 active:scale-95 cursor-pointer"}`}>
                    {readyBusy === o.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} {readyBusy === o.id ? "Confirming…" : "Ready for pickup — tap to confirm"}
                  </button>
                )}
                {o.status === "ready" && (
                  <span className="inline-flex items-center gap-1 rounded-xl bg-success/15 border border-success/20 px-3 py-2 text-xs font-bold text-success">
                    <Timer className="h-4 w-4 animate-pulse" /> Ready — awaiting rider pickup
                  </span>
                )}
                <Link href={`/chat/${o.id}`}
                  className="flex items-center gap-1 rounded-lg bg-surface border border-border px-2.5 py-1.5 text-[10px] font-medium text-muted hover:bg-elevated transition">
                  <MessageCircle className="h-3 w-3" /> Chat
                </Link>
                {morseTag && ["payment_confirmed", "preparing", "ready", "delivering"].includes(o.status) ? (
                  <button type="button" onClick={() => { setMorseMsg(null); setMorseModal(o.id); }}
                    className={`flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[10px] font-medium transition ${morseRequests[o.id] ? "bg-go/10 text-go hover:bg-go/20" : "bg-surface border border-go/30 text-go hover:bg-go/10"}`}>
                    <MorseLogo markOnly className="h-3 w-3" />
                    {morseRequests[o.id]
                      ? (morseRequests[o.id].status === "requested" ? "Morse payment · requested" : `Morse · ${morseRequests[o.id].status}`)
                      : "Request Morse payment"}
                  </button>
                ) : null}
              </div>
            </div>
          ))
        )}
      </div>

      {prepTimeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/60" onClick={() => setPrepTimeModal(null)} />
          <div className="relative z-10 w-full max-w-sm rounded-3xl bg-bg p-5 shadow-2xl animate-scale-in">
            <h3 className="font-display text-lg font-semibold">Preparation time</h3>
            <p className="mt-1 text-xs text-muted">How long will this order take to prepare?</p>
            <div className="mt-4 grid grid-cols-4 gap-2">
              {["5", "10", "15", "20", "25", "30", "40", "60"].map((t) => (
                <button key={t} type="button" onClick={() => setPrepMinutes(t)}
                  className={`rounded-xl py-3 text-sm font-bold transition ${prepMinutes === t ? "bg-primary text-white" : "bg-surface text-muted hover:bg-elevated"}`}>
                  {t}m
                </button>
              ))}
            </div>
            <div className="mt-4 flex gap-2">
              <button type="button" onClick={() => setPrepTimeModal(null)}
                className="flex-1 rounded-xl border border-border bg-surface py-3 text-sm font-medium text-muted hover:bg-elevated transition">Cancel</button>
              <button type="button" onClick={confirmPrepTime}
                className="flex-1 rounded-xl bg-primary py-3 text-sm font-semibold text-white hover:bg-primary/90 transition">
                Accept · {prepMinutes} min
              </button>
            </div>
          </div>
        </div>
      )}

      {morseModal && (() => {
        const order = orders.find((o) => o.id === morseModal);
        const req = morseRequests[morseModal];
        const usdt = Math.max(1, Math.ceil((order?.total_ugx || 0) / morseRate));
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
            <div className="absolute inset-0 bg-black/60" onClick={() => setMorseModal(null)} />
            <div className="relative z-10 w-full max-w-sm rounded-3xl bg-bg p-5 shadow-2xl animate-scale-in max-h-[85vh] overflow-y-auto">
              <h3 className="font-display text-lg font-semibold flex items-center gap-2">
                <MorseLogo markOnly className="h-5 w-5 text-go" /> Morse payment
              </h3>
              <p className="mt-1 text-xs text-muted">
                Order <span className="font-mono">#{morseModal.slice(-6)}</span> · ${usdt} USD (≈ {formatUgx(order?.total_ugx || 0)} @ {morseRate} UGX per USD)
              </p>

              {!req ? (
                <>
                  <p className="mt-3 text-[11px] text-muted leading-relaxed">
                    This pushes a payment request to the customer&apos;s Morse tag. You approve the amount in Morse and the
                    money lands on your <span className="font-semibold text-go">fixed business tag @{morseTag.replace(/^@/, "")}</span> —
                    it never goes anywhere else, so the record is crystal clear.
                  </p>
                  <button type="button" onClick={() => void createMorseRequest()}
                    disabled={morseBusy}
                    className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-go py-3 text-sm font-semibold text-white hover:bg-go-2 transition disabled:opacity-50">
                    {morseBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <MorseLogo markOnly className="h-4 w-4" />}
                    Request payment now
                  </button>
                  <button type="button" onClick={() => void copyMorseDetails(order, undefined)}
                    className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-xl border border-border bg-surface py-2 text-xs font-medium text-muted hover:bg-elevated transition">
                    <Copy className="h-3.5 w-3.5" /> {copiedMorse ? "Copied!" : "Copy payment details"}
                  </button>
                </>
              ) : (
                <div className="mt-3 space-y-2">
                  <div className={`rounded-xl px-3 py-2 text-[11px] font-semibold ${
                    req.status === "paid" ? "bg-success/15 text-success" : req.status === "requested" ? "bg-warning/15 text-warning" : "bg-elevated text-muted"
                  }`}>
                    {req.status === "paid" ? "✓ Received — mark it done, ship the order" : req.status === "requested" ? "Awaiting customer approval in Morse" : "Cancelled"}
                  </div>
                  <div className="rounded-xl border border-border bg-surface px-3 py-2 space-y-1 text-[11px] text-muted">
                    <p>Customer Morse tag: <span className="font-mono font-semibold text-fg">@{String(req.customer_morse_tag).replace(/^@/, "")}</span></p>
                    <p>Amount: <span className="font-semibold text-fg">${req.amount_usdt} USD</span></p>
                    <p>Lands on your Morse tag: <span className="font-mono font-semibold text-go">@{String(req.business_morse_tag || morseTag).replace(/^@/, "")}</span></p>
                    <p className="text-[10px] text-dim">Note to include: <span className="font-mono text-go">{req.reference}</span></p>
                  </div>
                  {req.status === "requested" && (
                    <div className="flex gap-2 pt-1">
                      <button type="button" onClick={() => void settleMorse(req.id, "paid", morseModal)}
                        disabled={morseBusy}
                        className="flex flex-1 items-center justify-center gap-1 rounded-xl bg-success/15 py-2.5 text-xs font-semibold text-success hover:bg-success/25 transition disabled:opacity-50">
                        <Check className="h-3.5 w-3.5" /> Mark received
                      </button>
                      <button type="button" onClick={() => void settleMorse(req.id, "cancelled", morseModal)}
                        disabled={morseBusy}
                        className="flex flex-1 items-center justify-center gap-1 rounded-xl bg-danger/15 py-2.5 text-xs font-semibold text-danger hover:bg-danger/25 transition disabled:opacity-50">
                        <X className="h-3.5 w-3.5" /> Cancel request
                      </button>
                    </div>
                  )}
                  {req.note && <p className="rounded-xl bg-go/5 px-3 py-2 text-[10px] text-dim">{req.note}</p>}
                  <button type="button" onClick={() => void copyMorseDetails(order, req)}
                    className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-go/30 bg-go/5 py-2 text-xs font-semibold text-go hover:bg-go/10 transition">
                    <Copy className="h-3.5 w-3.5" /> {copiedMorse ? "Copied!" : "Copy all details"}
                  </button>
                </div>
              )}

              {morseMsg && <p className={`mt-3 text-[11px] font-medium ${morseMsg.ok ? "text-success" : "text-danger"}`}>{morseMsg.text}</p>}
              <p className="mt-3 text-[10px] text-dim border-t border-border pt-3">
                No Morse yet? Open <span className="font-semibold text-go">morsemoney.com</span> and use friend code <span className="font-mono text-go">AsAp4f</span>.
              </p>
            </div>
          </div>
        );
      })()}
    </div>
    </>
  );
}