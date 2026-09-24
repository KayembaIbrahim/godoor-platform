"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
  Package, Search, ArrowLeft, AlertTriangle, Filter,
  MessageCircle, Clock, CheckCircle2, Truck
} from "lucide-react";
import { fetchOrders, updateOrder, type DBOrder } from "@/lib/db";
import { formatUgx } from "@/lib/utils";

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

const STATUSES = ["all", "pending", "payment_submitted", "payment_confirmed", "preparing", "delivering", "delivered", "disputed", "cancelled"];

export default function AdminOrders() {
  const [orders, setOrders] = useState<DBOrder[]>([]);
  const [filter, setFilter] = useState("all");
  const [q, setQ] = useState("");

  const refresh = () => fetch("/api/admin/orders", { cache: "no-store" })
    .then((r) => r.ok ? r.json() : null)
    .then((d) => { if (d?.orders) setOrders(d.orders); else fetchOrders().then(setOrders); })
    .catch(() => fetchOrders().then(setOrders));
  useEffect(() => { refresh(); }, []);

  const filtered = orders.filter((o) => {
    if (filter !== "all" && o.status !== filter) return false;
    if (!q.trim()) return true;
    const s = q.toLowerCase();
    return o.id.toLowerCase().includes(s) || o.merchant_name.toLowerCase().includes(s) || (o.customer_name || "").toLowerCase().includes(s) || (o.customer_email || "").toLowerCase().includes(s);
  }).sort((a, b) => b.created_at - a.created_at);

  const counts = STATUSES.reduce((acc, s) => {
    acc[s] = s === "all" ? orders.length : orders.filter((o) => o.status === s).length;
    return acc;
  }, {} as Record<string, number>);

  const updateStatus = (id: string, status: string) => {
    updateOrder(id, { status }).then(refresh);
  };

  return (
    <div className="pb-24 md:pb-0 animate-fade-in">
      <h1 className="font-display text-2xl font-bold">Orders</h1>
      <p className="mt-1 text-sm text-muted">Manage all platform orders and update statuses.</p>

      {/* Filters */}
      <div className="mt-4 flex flex-wrap items-center gap-1.5">
        {STATUSES.filter((s) => counts[s] > 0 || s === "all").map((f) => (
          <button key={f} type="button" onClick={() => setFilter(f)}
            className={`rounded-full px-2.5 py-1 text-[10px] font-medium transition ${filter === f ? "bg-go text-white" : "bg-surface text-muted hover:bg-elevated"}`}>
            {f === "all" ? "All" : f.replace(/_/g, " ")} ({counts[f]})
          </button>
        ))}
      </div>

      <div className="relative mt-3">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-dim" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by order ID, merchant, customer…"
          className="w-full rounded-xl border border-border bg-surface py-2.5 pl-10 pr-3 text-sm outline-none ring-go focus:ring-2" />
      </div>

      <div className="mt-4 space-y-2">
        {filtered.map((o) => (
          <div key={o.id} className="rounded-2xl border border-border bg-surface p-4 transition hover:border-primary/30">
            <div className="flex items-start justify-between">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs font-semibold">#{o.id.slice(-8)}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[9px] font-semibold ${STATUS_COLORS[o.status] || "bg-elevated text-muted"}`}>
                    {o.status.replace(/_/g, " ")}
                  </span>
                </div>
                <p className="mt-1 text-sm font-medium">{o.merchant_name}</p>
                <p className="text-xs text-muted truncate">{o.items}</p>
                <div className="mt-1.5 flex flex-wrap items-center gap-3 text-[10px] text-dim">
                  <span>Customer: {o.customer_name || "Guest"}</span>
                  <span>·</span>
                  <span>{o.customer_email}</span>
                  <span>·</span>
                  <span>{o.payment_method}</span>
                  <span>·</span>
                  <span>{new Date(o.created_at).toLocaleString()}</span>
                </div>
              </div>
              <div className="text-right shrink-0 ml-3">
                <p className="text-sm font-bold tabular-nums text-go">{formatUgx(o.total_ugx)}</p>
                <p className="text-[10px] text-dim mt-0.5">Fee: {formatUgx(o.service_fee_ugx)}</p>
              </div>
            </div>

            {/* Status actions */}
            <div className="mt-3 flex flex-wrap gap-1.5 border-t border-border pt-3">
              {o.status === "payment_confirmed" && (
                <button type="button" onClick={() => updateStatus(o.id, "preparing")}
                  className="flex items-center gap-1 rounded-lg bg-go/15 px-2.5 py-1.5 text-[10px] font-medium text-go hover:bg-go/25 transition">
                  <Clock className="h-3 w-3" /> Mark Preparing
                </button>
              )}
              {o.status === "preparing" && (
                <button type="button" onClick={() => updateStatus(o.id, "delivering")}
                  className="flex items-center gap-1 rounded-lg bg-success/15 px-2.5 py-1.5 text-[10px] font-medium text-success hover:bg-success/25 transition">
                  <Truck className="h-3 w-3" /> Mark Delivering
                </button>
              )}
              {o.status === "delivering" && (
                <button type="button" onClick={() => updateStatus(o.id, "delivered")}
                  className="flex items-center gap-1 rounded-lg bg-success/15 px-2.5 py-1.5 text-[10px] font-medium text-success hover:bg-success/25 transition">
                  <CheckCircle2 className="h-3 w-3" /> Mark Delivered
                </button>
              )}
              {["pending", "payment_submitted", "payment_confirmed"].includes(o.status) && (
                <button type="button" onClick={() => updateStatus(o.id, "cancelled")}
                  className="flex items-center gap-1 rounded-lg bg-danger/15 px-2.5 py-1.5 text-[10px] font-medium text-danger hover:bg-danger/25 transition">
                  <AlertTriangle className="h-3 w-3" /> Cancel
                </button>
              )}
              <Link href={`/chat/${o.id}`} className="flex items-center gap-1 rounded-lg bg-surface px-2.5 py-1.5 text-[10px] font-medium text-muted border border-border hover:bg-elevated transition">
                <MessageCircle className="h-3 w-3" /> Chat
              </Link>
            </div>
          </div>
        ))}
        {filtered.length === 0 && (
          <div className="py-12 text-center">
            <Package className="mx-auto h-8 w-8 text-dim" />
            <p className="mt-2 text-sm text-muted">No orders found</p>
          </div>
        )}
      </div>
    </div>
  );
}
