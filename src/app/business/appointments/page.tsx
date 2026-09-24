"use client";

import Link from "next/link";
import { useEffect, useState, useCallback } from "react";
import {
  ArrowLeft, Stethoscope, CalendarClock, Timer, Check, X, Loader2,
  MessageCircle, Pill, Hash, Plus
} from "lucide-react";
import { useSession } from "@/lib/session-store";
import {
  fetchMerchantByOwnerId, fetchOrders, fetchProducts,
  assignQueueNumber, updateQueueStatus, subscribeToClinicQueue,
  apiAuthHeaders, type DBOrder, type DBProduct,
} from "@/lib/db";
import { Price } from "@/components/Price";

type QueueEntry = {
  order_id: string;
  queue_number: number;
  status: string;
  created_at: number;
  order?: {
    id: string;
    customer_name: string;
    status: string;
    scheduled_for: string | null;
    total_ugx: number;
  };
};

const QUEUE_STYLES: Record<string, { label: string; cls: string }> = {
  waiting: { label: "Waiting", cls: "bg-warning/15 text-warning" },
  in_consultation: { label: "In consultation", cls: "bg-primary/15 text-primary" },
  done: { label: "Done", cls: "bg-success/15 text-success" },
  no_show: { label: "No-show", cls: "bg-danger/15 text-danger" },
};

export default function AppointmentsPage() {
  const { supabaseUser } = useSession();
  const [merchantId, setMerchantId] = useState<string | null>(null);
  const [orders, setOrders] = useState<DBOrder[]>([]);
  const [queue, setQueue] = useState<QueueEntry[]>([]);
  const [products, setProducts] = useState<DBProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const [prescribing, setPrescribing] = useState<DBOrder | null>(null);
  const [rx, setRx] = useState<Record<string, number>>({});
  const [rxBusy, setRxBusy] = useState(false);
  const [rxMsg, setRxMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    if (!supabaseUser?.id) return;
    const m = await fetchMerchantByOwnerId(supabaseUser.id);
    if (!m) { setLoading(false); return; }
    setMerchantId(m.id);
    const os = await fetchOrders({ merchant_id: m.id });
    setOrders(os);
    try {
      const res = await fetch(`/api/clinic/queue?merchant_id=${encodeURIComponent(m.id)}`, { headers: await apiAuthHeaders(false) });
      const json = await res.json().catch(() => ({}));
      setQueue((json.queue || []).map((q: any) => ({
        order_id: String(q.order_id || ""),
        queue_number: Number(q.queue_number || 0),
        status: String(q.status || "waiting"),
        created_at: q.created_at ? new Date(q.created_at).getTime() : Date.now(),
        order: q.orders || undefined,
      })));
    } catch { setQueue([]); }
    setProducts(await fetchProducts(m.id));
    setLoading(false);
  }, [supabaseUser?.id]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!merchantId) return;
    const unsub = subscribeToClinicQueue(merchantId, (entry) => {
      setQueue((prev) => {
        const exists = prev.some((q) => q.order_id === entry.order_id);
        if (exists) return prev.map((q) => q.order_id === entry.order_id ? { ...q, queue_number: entry.queue_number, status: entry.status } : q);
        return [...prev, { order_id: entry.order_id, queue_number: entry.queue_number, status: entry.status, created_at: entry.created_at }];
      });
    });
    return () => unsub();
  }, [merchantId]);

  const appointments = orders
    .filter((o) => ["payment_submitted", "payment_confirmed", "preparing", "rider_assigned", "delivering", "medicines_ready", "delivered"].includes(o.status))
    .sort((a, b) => b.created_at - a.created_at);

  const queueByOrder = new Map(queue.map((q) => [q.order_id, q]));

  const doAssign = async (order: DBOrder) => {
    setBusy(order.id);
    const entry = await assignQueueNumber(order.id);
    if (entry) {
      setQueue((prev) => [...prev.filter((q) => q.order_id !== order.id), {
        order_id: entry.order_id, queue_number: entry.queue_number, status: entry.status, created_at: entry.created_at,
      }]);
    }
    setBusy(null);
  };

  const doQueueStatus = async (orderId: string, status: "waiting" | "in_consultation" | "done" | "no_show") => {
    setBusy(orderId);
    const entry = await updateQueueStatus(orderId, status);
    if (entry) setQueue((prev) => prev.map((q) => q.order_id === orderId ? { ...q, status: entry.status } : q));
    setBusy(null);
  };

  const confirmMedicine = async (orderId: string) => {
    setBusy(orderId);
    await fetch("/api/orders", {
      method: "PATCH",
      headers: await apiAuthHeaders(true),
      body: JSON.stringify({ id: orderId, patch: { status: "medicines_ready" } }),
    }).catch(() => {});
    await load();
    setBusy(null);
  };

  const confirmMedicinePaid = async (orderId: string) => {
    setBusy(orderId);
    await fetch("/api/orders", {
      method: "PATCH",
      headers: await apiAuthHeaders(true),
      body: JSON.stringify({ id: orderId, patch: { medicine_paid: true } }),
    }).catch(() => {});
    await load();
    setBusy(null);
  };

  const submitRx = async () => {
    if (!prescribing) return;
    const items = Object.entries(rx).map(([productId, quantity]) => ({ productId, quantity })).filter((li) => li.quantity > 0);
    if (items.length === 0) { setRxMsg({ ok: false, text: "Pick at least one medicine." }); return; }
    setRxBusy(true);
    setRxMsg(null);
    try {
      const res = await fetch("/api/orders/items", {
        method: "PATCH",
        headers: await apiAuthHeaders(true),
        body: JSON.stringify({ order_id: prescribing.id, items }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.order) {
        setRxMsg({ ok: false, text: typeof j?.error === "string" ? j.error : "Could not add the prescription." });
        setRxBusy(false);
        return;
      }
      setRxMsg({ ok: true, text: "Prescription added to the patient's bill." });
      setPrescribing(null);
      setRx({});
      await load();
    } catch {
      setRxMsg({ ok: false, text: "Network error. Try again." });
    }
    setRxBusy(false);
  };

  if (loading) {
    return (
      <div className="flex h-[calc(100dvh-3.5rem)] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-go border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="mx-auto min-h-screen max-w-lg bg-bg pb-16">
      <div className="border-b border-border bg-surface/50 px-4 py-3">
        <div className="flex items-center gap-3">
          <Link href="/business" className="text-muted hover:text-fg transition"><ArrowLeft className="h-5 w-5" /></Link>
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-primary/10"><Stethoscope className="h-4 w-4 text-primary" /></span>
          <div>
            <h1 className="font-display text-base font-semibold">Appointments</h1>
            <p className="text-[10px] text-muted">Waiting room, consultations & prescriptions</p>
          </div>
        </div>
      </div>

      {/* Waiting room */}
      <div className="px-4 pt-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold"><Hash className="h-4 w-4 text-primary" /> Waiting room {queue.length > 0 && `(${queue.length})`}</h2>
        {queue.length === 0 ? (
          <div className="mt-3 rounded-2xl border border-dashed border-border bg-surface/50 p-6 text-center">
            <CalendarClock className="mx-auto h-7 w-7 text-dim" />
            <p className="mt-2 text-sm font-medium">No patients in line</p>
            <p className="text-xs text-muted">Assign a queue number to a booking below and it appears here.</p>
          </div>
        ) : (
          <div className="mt-3 space-y-2">
            {[...queue].sort((a, b) => a.queue_number - b.queue_number).map((q) => {
              const style = QUEUE_STYLES[q.status] || QUEUE_STYLES.waiting;
              return (
                <div key={q.order_id} className="rounded-2xl border border-border bg-surface p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <span className="grid h-9 w-9 place-items-center rounded-xl bg-primary/10 font-mono text-sm font-bold text-primary">{q.queue_number}</span>
                      <div>
                        <p className="text-sm font-semibold">{q.order?.customer_name || "Patient"}</p>
                        <p className="text-[10px] text-muted">Order #{q.order_id.slice(-6)}</p>
                      </div>
                    </div>
                    <span className={`rounded-full px-2 py-0.5 text-[9px] font-semibold ${style.cls}`}>{style.label}</span>
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-1.5">
                    {q.status === "waiting" ? (
                      [
                        { s: "in_consultation" as const, label: "Start visit", style: "bg-primary/15 text-primary" },
                        { s: "no_show" as const, label: "No-show", style: "bg-danger/15 text-danger" },
                      ].map((b) => (
                        <button key={b.s} type="button" onClick={() => doQueueStatus(q.order_id, b.s)} disabled={busy === q.order_id}
                          className={`rounded-xl py-2 text-[10px] font-semibold ${b.style} disabled:opacity-50`}>{busy === q.order_id ? "…" : b.label}</button>
                      ))
                    ) : (
                      <button type="button" onClick={() => doQueueStatus(q.order_id, "done")} disabled={busy === q.order_id}
                        className={`rounded-xl py-2 text-[10px] font-semibold bg-success/15 text-success disabled:opacity-50`}>{q.status === "done" ? "Done ✓" : busy === q.order_id ? "…" : "Mark done"}</button>
                    )}
                    <Link href={`/chat/${q.order_id}`} className="flex items-center justify-center gap-1 rounded-xl border border-border bg-elevated py-2 text-[10px] font-semibold text-muted hover:bg-panel transition">
                      <MessageCircle className="h-3 w-3" /> Chat
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Bookings */}
      <div className="px-4 pt-6">
        <h2 className="flex items-center gap-2 text-sm font-semibold"><CalendarClock className="h-4 w-4 text-primary" /> Bookings</h2>
        {appointments.length === 0 ? (
          <div className="mt-3 rounded-2xl border border-dashed border-border bg-surface/50 p-6 text-center">
            <Stethoscope className="mx-auto h-7 w-7 text-dim" />
            <p className="mt-2 text-sm font-medium">No appointments yet</p>
            <p className="text-xs text-muted">Online bookings from your clinic page will appear here.</p>
          </div>
        ) : (
          <div className="mt-3 space-y-2.5">
            {appointments.map((o) => {
              const q = queueByOrder.get(o.id);
              return (
                <div key={o.id} className="rounded-2xl border border-border bg-surface p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold">{o.customer_name || "Patient"}</p>
                        {q && <span className={`rounded-full px-2 py-0.5 text-[9px] font-semibold ${(QUEUE_STYLES[q.status] || QUEUE_STYLES.waiting).cls}`}>{QUEUE_STYLES[q.status]?.label || q.status}</span>}
                      </div>
                      <p className="mt-0.5 text-[10px] text-muted">#{o.id.slice(-6)} · {o.items || o.notes || "Consultation"}</p>
                      {o.scheduled_for ? (
                        <p className="mt-0.5 text-[10px] text-dim">Booked for {new Date(o.scheduled_for).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit", month: "short", day: "numeric" })}</p>
                      ) : (
                        <p className="mt-0.5 text-[10px] text-dim">Walk-in / ASAP</p>
                      )}
                      {o.medicine_subtotal_ugx ? (
                        <p className="mt-1 text-[10px] font-semibold text-primary">Prescription: <Price amount={o.medicine_subtotal_ugx} className="inline" />{o.medicine_paid ? <span className="text-success"> · Paid</span> : <span className="text-warning"> · unpaid</span>}</p>
                      ) : null}
                    </div>
                    <div className="shrink-0 text-right">
                      <Price amount={o.total_ugx} className="text-sm font-bold text-primary" />
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1.5 border-t border-border pt-3">
                    {!q && (
                      <button type="button" onClick={() => doAssign(o)} disabled={busy === o.id}
                        className="flex flex-1 items-center justify-center gap-1 rounded-xl bg-primary/15 py-2 text-[10px] font-semibold text-primary hover:bg-primary/25 transition disabled:opacity-50">
                        {busy === o.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Hash className="h-3 w-3" />} Assign queue
                      </button>
                    )}
                    <button type="button" onClick={() => { setPrescribing(o); setRx({}); setRxMsg(null); }}
                      className="flex flex-1 items-center justify-center gap-1 rounded-xl bg-go/15 py-2 text-[10px] font-semibold text-go hover:bg-go/25 transition">
                      <Plus className="h-3 w-3" /> Prescription
                    </button>
                    {!o.medicine_paid && o.medicine_subtotal_ugx ? (
                      <button type="button" onClick={() => confirmMedicinePaid(o.id)} disabled={busy === o.id}
                        className="flex flex-1 items-center justify-center gap-1 rounded-xl bg-success/15 py-2 text-[10px] font-semibold text-success hover:bg-success/25 transition disabled:opacity-50">
                        <Check className="h-3 w-3" /> Meds paid
                      </button>
                    ) : null}
                    {o.medicine_subtotal_ugx ? (
                      o.status === "medicines_ready" ? (
                        <span className="flex flex-1 items-center justify-center gap-1 rounded-xl bg-elevated py-2 text-[10px] font-semibold text-dim"><Timer className="h-3 w-3" /> Medicines ready</span>
                      ) : (
                        <button type="button" onClick={() => confirmMedicine(o.id)} disabled={busy === o.id}
                          className="flex flex-1 items-center justify-center gap-1 rounded-xl bg-warning/15 py-2 text-[10px] font-semibold text-warning hover:bg-warning/25 transition disabled:opacity-50">
                          <Pill className="h-3 w-3" /> Medicines ready
                        </button>
                      )
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Prescription sheet */}
      {prescribing && (
        <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/60 backdrop-blur-sm" onClick={() => setPrescribing(null)}>
          <div className="w-full max-w-lg rounded-t-3xl bg-surface p-5 pb-8 animate-slide-up max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-border" />
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-display text-base font-semibold">Prescription — {prescribing.customer_name || "Patient"}</p>
                <p className="text-xs text-muted mt-0.5">Order #{prescribing.id.slice(-6)} · prices are added to the patient&apos;s bill</p>
              </div>
              <button type="button" onClick={() => setPrescribing(null)} className="grid h-8 w-8 place-items-center rounded-full bg-elevated text-muted hover:text-fg transition"><X className="h-4 w-4" /></button>
            </div>

            {products.filter((p) => !p.is_service).length === 0 ? (
              <p className="mt-6 rounded-xl bg-amber-500/10 px-3 py-2.5 text-[11px] text-amber-700">
                No medicines in your catalog yet. Add medicine as products — leave “Bookable service” off.
              </p>
            ) : (
              <div className="mt-4 space-y-2">
                {products.filter((p) => !p.is_service).map((p) => {
                  const qty = rx[p.id] || 0;
                  return (
                    <div key={p.id} className="flex items-center gap-3 rounded-xl border border-border bg-bg px-3 py-2.5">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{p.name}</p>
                        <p className="text-[10px] text-muted"><Price amount={p.price} className="inline" /></p>
                      </div>
                      {qty === 0 ? (
                        <button type="button" onClick={() => setRx((prev) => ({ ...prev, [p.id]: 1 }))}
                          className="grid h-8 w-8 place-items-center rounded-xl bg-go text-white hover:bg-go-2 transition active:scale-90"><Plus className="h-3.5 w-3.5" /></button>
                      ) : (
                        <div className="flex items-center gap-2">
                          <button type="button" onClick={() => setRx((prev) => ({ ...prev, [p.id]: Math.max(0, qty - 1) }))}
                            className="grid h-7 w-7 place-items-center rounded-lg bg-elevated text-muted hover:bg-panel transition"><span className="text-sm">−</span></button>
                          <span className="min-w-[1.25rem] text-center text-sm font-bold text-go tabular-nums">{qty}</span>
                          <button type="button" onClick={() => setRx((prev) => ({ ...prev, [p.id]: qty + 1 }))}
                            className="grid h-7 w-7 place-items-center rounded-lg bg-go text-white hover:bg-go-2 transition"><span className="text-sm">+</span></button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {rxMsg && <p className={`mt-3 text-xs ${rxMsg.ok ? "text-success" : "text-danger"}`}>{rxMsg.text}</p>}
            <button type="button" onClick={submitRx} disabled={rxBusy}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-go px-5 py-3.5 text-sm font-semibold text-white shadow-lg shadow-go/30 transition hover:bg-go-2 active:scale-[0.98] disabled:opacity-60">
              {rxBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Pill className="h-4 w-4" />} Add to bill
            </button>
          </div>
        </div>
      )}
    </div>
  );
}