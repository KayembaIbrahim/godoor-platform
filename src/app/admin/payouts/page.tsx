"use client";

import { useState, useEffect, useMemo } from "react";
import {
  DollarSign, CheckCircle2, Clock, Truck, Store, Search,
  Download, Loader2, AlertTriangle, Filter, ArrowUpRight,
} from "lucide-react";
import { fetchOrders, fetchMerchants, fetchRiders, type DBOrder, type DBMerchant, type DBRider } from "@/lib/db";
import { formatUgx } from "@/lib/utils";

type PayoutEntry = {
  id: string;
  name: string;
  email: string;
  role: "merchant" | "rider";
  totalEarned: number;
  ordersCount: number;
  status: "pending" | "paid";
  lastOrderDate: number;
};

export default function AdminPayouts() {
  const [orders, setOrders] = useState<DBOrder[]>([]);
  const [merchants, setMerchants] = useState<DBMerchant[]>([]);
  const [riders, setRiders] = useState<DBRider[]>([]);
  const [paidIds, setPaidIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<"merchant" | "rider">("merchant");

  useEffect(() => {
    Promise.all([
      fetchOrders().then(setOrders),
      fetchMerchants().then(setMerchants),
      fetchRiders().then(setRiders),
    ]).then(() => setLoading(false));
    // Load paid IDs from localStorage
    try {
      const stored = JSON.parse(localStorage.getItem("godoor-paid-payouts") || "[]");
      setPaidIds(new Set(stored));
    } catch {}
  }, []);

  const markPaid = (id: string) => {
    setPaidIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      localStorage.setItem("godoor-paid-payouts", JSON.stringify([...next]));
      return next;
    });
  };

  const payouts = useMemo(() => {
    const delivered = orders.filter((o) => ["delivered", "payment_confirmed"].includes(o.status));
    const map = new Map<string, PayoutEntry>();

    // Merchant earnings
    for (const o of delivered) {
      if (!o.merchant_id) continue;
      const merchant = merchants.find((m) => m.id === o.merchant_id);
      const merchantEarning = o.total_ugx || 0;
      const key = `m_${o.merchant_id}`;
      const existing = map.get(key);
      if (existing) {
        existing.totalEarned += merchantEarning;
        existing.ordersCount += 1;
        existing.lastOrderDate = Math.max(existing.lastOrderDate, o.created_at);
      } else {
        map.set(key, {
          id: o.merchant_id, name: merchant?.name || o.merchant_name || "Unknown",
          email: merchant?.owner_id || "", role: "merchant",
          totalEarned: merchantEarning, ordersCount: 1,
          status: paidIds.has(key) ? "paid" : "pending",
          lastOrderDate: o.created_at,
        });
      }
    }

    // Rider earnings
    for (const o of delivered) {
      if (!o.rider_id) continue;
      const rider = riders.find((r) => r.id === o.rider_id);
      const key = `r_${o.rider_id}`;
      const existing = map.get(key);
      if (existing) {
        existing.totalEarned += o.delivery_fee_ugx || 0;
        existing.ordersCount += 1;
        existing.lastOrderDate = Math.max(existing.lastOrderDate, o.created_at);
      } else {
        map.set(key, {
          id: o.rider_id, name: o.rider_name || rider?.name || "Unknown",
          email: rider?.email || "", role: "rider",
          totalEarned: o.delivery_fee_ugx || 0, ordersCount: 1,
          status: paidIds.has(key) ? "paid" : "pending",
          lastOrderDate: o.created_at,
        });
      }
    }

    return [...map.values()];
  }, [orders, merchants, riders, paidIds]);

  const filtered = payouts
    .filter((p) => p.role === tab)
    .filter((p) => !q.trim() || p.name.toLowerCase().includes(q.toLowerCase()) || p.email.toLowerCase().includes(q.toLowerCase()));

  const totalPending = filtered.filter((p) => p.status === "pending").reduce((s, p) => s + p.totalEarned, 0);
  const totalPaid = filtered.filter((p) => p.status === "paid").reduce((s, p) => s + p.totalEarned, 0);

  return (
    <div className="pb-24 md:pb-0 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold">Payouts</h1>
          <p className="mt-1 text-sm text-muted">Track and manage rider and merchant earnings.</p>
        </div>
      </div>

      {/* Tabs + Search */}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <div className="flex gap-1.5">
          <button type="button" onClick={() => setTab("merchant")}
            className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition ${tab === "merchant" ? "bg-primary/15 text-primary" : "bg-surface text-muted hover:bg-elevated"}`}>
            <Store className="h-3 w-3" /> Merchants
          </button>
          <button type="button" onClick={() => setTab("rider")}
            className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition ${tab === "rider" ? "bg-primary/15 text-primary" : "bg-surface text-muted hover:bg-elevated"}`}>
            <Truck className="h-3 w-3" /> Riders
          </button>
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-dim" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or email…"
            className="w-full rounded-xl border border-border bg-surface py-2 pl-10 pr-3 text-sm outline-none ring-go focus:ring-2 sm:w-60" />
        </div>
      </div>

      {/* Summary */}
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-2xl border border-border bg-surface p-4">
          <div className="flex items-center gap-2"><Clock className="h-4 w-4 text-warning" /><p className="text-xs text-muted">Pending</p></div>
          <p className="mt-2 text-xl font-bold text-warning">{formatUgx(totalPending)}</p>
        </div>
        <div className="rounded-2xl border border-border bg-surface p-4">
          <div className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-success" /><p className="text-xs text-muted">Paid</p></div>
          <p className="mt-2 text-xl font-bold text-success">{formatUgx(totalPaid)}</p>
        </div>
        <div className="rounded-2xl border border-border bg-surface p-4">
          <div className="flex items-center gap-2"><DollarSign className="h-4 w-4 text-go" /><p className="text-xs text-muted">Total Earned</p></div>
          <p className="mt-2 text-xl font-bold">{formatUgx(totalPending + totalPaid)}</p>
        </div>
        <div className="rounded-2xl border border-border bg-surface p-4">
          <div className="flex items-center gap-2"><Filter className="h-4 w-4 text-primary" /><p className="text-xs text-muted">Count</p></div>
          <p className="mt-2 text-xl font-bold">{filtered.length}</p>
        </div>
      </div>

      {/* Payout table */}
      <div className="mt-6 overflow-hidden rounded-2xl border border-border">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface text-xs text-dim">
              <tr>
                <th className="px-4 py-2.5 text-left">{tab === "merchant" ? "Business" : "Rider"}</th>
                <th className="px-4 py-2.5 text-left hidden md:table-cell">Email</th>
                <th className="px-4 py-2.5 text-center">Orders</th>
                <th className="px-4 py-2.5 text-right">Amount</th>
                <th className="px-4 py-2.5 text-center">Status</th>
                <th className="px-4 py-2.5 text-center">Action</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-muted">Loading…</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-muted">No {tab} payouts to show</td></tr>
              ) : filtered.sort((a, b) => b.totalEarned - a.totalEarned).map((p) => (
                <tr key={p.id} className="border-t border-border hover:bg-elevated/50 transition">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className={`grid h-8 w-8 place-items-center rounded-full ${p.role === "merchant" ? "bg-primary/10" : "bg-primary/10"}`}>
                        {p.role === "merchant" ? <Store className="h-4 w-4 text-primary" /> : <Truck className="h-4 w-4 text-primary" />}
                      </div>
                      <div>
                        <p className="text-xs font-medium">{p.name}</p>
                        <p className="text-[10px] text-dim">Last: {new Date(p.lastOrderDate).toLocaleDateString()}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted hidden md:table-cell">{p.email || "—"}</td>
                  <td className="px-4 py-3 text-center text-xs font-semibold">{p.ordersCount}</td>
                  <td className="px-4 py-3 text-right text-xs font-bold">{formatUgx(p.totalEarned)}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-semibold ${p.status === "paid" ? "bg-success/15 text-success" : "bg-warning/15 text-warning"}`}>
                      {p.status === "paid" ? <CheckCircle2 className="h-2.5 w-2.5" /> : <Clock className="h-2.5 w-2.5" />}
                      {p.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    {p.status === "pending" ? (
                      <button type="button" onClick={() => markPaid(p.id)}
                        className="inline-flex items-center gap-1 rounded-lg bg-go px-3 py-1.5 text-[10px] font-semibold text-white hover:bg-go-2 transition">
                        <CheckCircle2 className="h-3 w-3" /> Mark Paid
                      </button>
                    ) : (
                      <span className="text-[10px] text-success font-medium">Done</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
