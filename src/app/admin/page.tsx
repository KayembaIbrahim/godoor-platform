"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Package, DollarSign, AlertTriangle, Store, TrendingUp, Clock,
  CheckCircle2, Truck, Users, ArrowUpRight, BarChart3, Shield,
  Activity, Zap, Settings
} from "lucide-react";
import { fetchOrders, fetchDisputes, fetchMerchants, fetchFeeConfig, type DBOrder, type DBDispute, type DBMerchant, type FeeConfig } from "@/lib/db";
import { formatUgx } from "@/lib/utils";

export default function AdminOverview() {
  const [orders, setOrders] = useState<DBOrder[]>([]);
  const [disputes, setDisputes] = useState<DBDispute[]>([]);
  const [merchants, setMerchants] = useState<DBMerchant[]>([]);
  const [fees, setFees] = useState<FeeConfig | null>(null);

  useEffect(() => {
    fetch("/api/admin/overview", { cache: "no-store" })
      .then((r) => r.ok ? r.json() : null)
      .then((d) => {
        if (!d?.overview) return;
        setOrders(d.overview.orders || []);
        setMerchants(d.overview.merchants || []);
        setDisputes(d.overview.disputes || []);
      })
      .catch(() => {
        fetchOrders().then(setOrders);
        fetchDisputes().then(setDisputes);
        fetchMerchants().then(setMerchants);
      });
    fetchFeeConfig().then(setFees).catch(() => {});
  }, []);

  const now = Date.now();
  const todayMs = 86400000;
  const weekMs = 7 * todayMs;

  const stats = {
    totalOrders: orders.length,
    openDisputes: disputes.filter((d) => d.status === "open").length,
    activeMerchants: merchants.filter((m) => m.status === "active").length,
    pendingMerchants: merchants.filter((m) => m.status === "pending").length,
    todayOrders: orders.filter((o) => now - o.created_at < todayMs).length,
    weekOrders: orders.filter((o) => now - o.created_at < weekMs).length,
    deliveredOrders: orders.filter((o) => o.status === "delivered").length,
    pendingPayments: orders.filter((o) => o.status === "payment_submitted").length,
    totalRevenue: orders.filter((o) => o.status === "payment_confirmed" || o.status === "delivered").reduce((s, o) => s + o.total_ugx, 0),
    serviceRevenue: orders.filter((o) => o.status === "payment_confirmed" || o.status === "delivered").reduce((s, o) => s + o.service_fee_ugx, 0),
    deliveryRevenue: orders.filter((o) => o.status === "payment_confirmed" || o.status === "delivered").reduce((s, o) => s + o.delivery_fee_ugx, 0),
  };

  const recentOrders = [...orders].sort((a, b) => b.created_at - a.created_at).slice(0, 8);

  return (
    <div className="pb-24 md:pb-0 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold">Dashboard</h1>
          <p className="mt-1 text-sm text-muted">GoDoor platform overview · Uganda</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1.5 rounded-full bg-success/15 px-3 py-1 text-[10px] font-semibold text-success">
            <Activity className="h-3 w-3" /> Live
          </span>
        </div>
      </div>

      {/* Revenue banner */}
      <div className="mt-6 rounded-2xl bg-gradient-to-br from-go to-go-2 p-5 text-white">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-wider text-white/60">Total Revenue</p>
            <p className="mt-1 font-display text-3xl font-bold">{formatUgx(stats.totalRevenue)}</p>
          </div>
          <div className="grid h-12 w-12 place-items-center rounded-2xl bg-white/15">
            <DollarSign className="h-6 w-6" />
          </div>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-3">
          <div className="rounded-xl bg-white/10 p-2.5">
            <p className="text-[10px] text-white/60">Service Fees</p>
            <p className="text-sm font-bold">{formatUgx(stats.serviceRevenue)}</p>
          </div>
          <div className="rounded-xl bg-white/10 p-2.5">
            <p className="text-[10px] text-white/60">Delivery Fees</p>
            <p className="text-sm font-bold">{formatUgx(stats.deliveryRevenue)}</p>
          </div>
          <div className="rounded-xl bg-white/10 p-2.5">
            <p className="text-[10px] text-white/60">Orders</p>
            <p className="text-sm font-bold">{stats.totalOrders}</p>
          </div>
        </div>
      </div>

      {/* Stats grid */}
      <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: "Total Orders", value: stats.totalOrders, icon: Package, color: "text-go", bg: "bg-go/10" },
          { label: "Today's Orders", value: stats.todayOrders, icon: TrendingUp, color: "text-success", bg: "bg-success/10" },
          { label: "Active Merchants", value: stats.activeMerchants, icon: Store, color: "text-primary", bg: "bg-primary/10" },
          { label: "Pending Approvals", value: stats.pendingMerchants, icon: Clock, color: "text-warning", bg: "bg-warning/10" },
          { label: "Delivered", value: stats.deliveredOrders, icon: CheckCircle2, color: "text-success", bg: "bg-success/10" },
          { label: "Pending Payments", value: stats.pendingPayments, icon: AlertTriangle, color: "text-warning", bg: "bg-warning/10" },
          { label: "Open Disputes", value: stats.openDisputes, icon: AlertTriangle, color: "text-danger", bg: "bg-danger/10" },
          { label: "Week Orders", value: stats.weekOrders, icon: BarChart3, color: "text-go", bg: "bg-go/10" },
        ].map((s) => {
          const Icon = s.icon;
          return (
            <div key={s.label} className="rounded-2xl border border-border bg-surface p-4 card-hover">
              <div className="flex items-center gap-2">
                <span className={`grid h-8 w-8 place-items-center rounded-lg ${s.bg}`}><Icon className={`h-4 w-4 ${s.color}`} /></span>
                <p className="text-xs text-muted">{s.label}</p>
              </div>
              <p className="mt-2 text-xl font-bold tabular-nums">{s.value}</p>
            </div>
          );
        })}
      </div>

      {/* Quick actions */}
      <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { href: "/admin/merchants", label: "Merchants", desc: "Approve & manage", icon: Store, color: "text-go" },
          { href: "/admin/riders", label: "Riders", desc: "Verify & dispatch", icon: Truck, color: "text-primary" },
          { href: "/admin/disputes", label: "Disputes", desc: `${stats.openDisputes} open`, icon: AlertTriangle, color: "text-danger" },
          { href: "/admin/settings", label: "Settings", desc: "Fees & config", icon: Settings, color: "text-primary" },
        ].map((a) => {
          const Icon = a.icon;
          return (
            <Link key={a.href} href={a.href} className="flex items-center gap-3 rounded-2xl border border-border bg-surface p-4 transition hover:border-primary/30 card-hover">
              <Icon className={`h-5 w-5 ${a.color}`} />
              <div>
                <p className="text-sm font-semibold">{a.label}</p>
                <p className="text-[10px] text-muted">{a.desc}</p>
              </div>
            </Link>
          );
        })}
      </div>

      {/* Recent Orders */}
      <div className="mt-8">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold">Recent Orders</h2>
          <Link href="/admin/orders" className="flex items-center gap-1 text-xs text-go hover:underline">View all <ArrowUpRight className="h-3 w-3" /></Link>
        </div>
        <div className="mt-3 overflow-hidden rounded-2xl border border-border">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface text-xs text-dim">
                <tr>
                  <th className="px-4 py-2.5 text-left">Order</th>
                  <th className="px-4 py-2.5 text-left hidden sm:table-cell">Customer</th>
                  <th className="px-4 py-2.5 text-left">Merchant</th>
                  <th className="px-4 py-2.5 text-right">Amount</th>
                  <th className="px-4 py-2.5 text-center">Status</th>
                  <th className="px-4 py-2.5 text-center hidden md:table-cell">Time</th>
                </tr>
              </thead>
              <tbody>
                {recentOrders.length === 0 ? (
                  <tr><td colSpan={6} className="px-4 py-10 text-center text-muted">No orders yet</td></tr>
                ) : recentOrders.map((o) => (
                  <tr key={o.id} className="border-t border-border hover:bg-elevated/50 transition">
                    <td className="px-4 py-3 font-mono text-xs">#{o.id.slice(-6)}</td>
                    <td className="px-4 py-3 text-xs hidden sm:table-cell">{o.customer_name || "Guest"}</td>
                    <td className="px-4 py-3 text-xs">{o.merchant_name}</td>
                    <td className="px-4 py-3 text-right text-xs tabular-nums font-medium">{formatUgx(o.total_ugx)}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-block rounded-full px-2 py-0.5 text-[9px] font-semibold ${
                        o.status === "payment_submitted" ? "bg-warning/15 text-warning" :
                        o.status === "payment_confirmed" ? "bg-success/15 text-success" :
                        o.status === "delivered" ? "bg-success/15 text-success" :
                        o.status === "disputed" ? "bg-danger/15 text-danger" :
                        o.status === "delivering" ? "bg-go/15 text-go" :
                        "bg-elevated text-muted"
                      }`}>{o.status.replace(/_/g, " ")}</span>
                    </td>
                    <td className="px-4 py-3 text-center text-[10px] text-dim hidden md:table-cell">
                      {new Date(o.created_at).toLocaleString([], { hour: "2-digit", minute: "2-digit", month: "short", day: "numeric" })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Fee config summary */}
      {fees && (
        <div className="mt-8">
          <h2 className="font-display text-lg font-semibold">Fee Configuration</h2>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-2xl border border-border bg-surface p-4">
              <p className="text-[10px] text-dim uppercase tracking-wider">Service Fee</p>
              <p className="mt-1 text-lg font-bold text-go">{fees.service_fee_percent}%</p>
              <p className="text-[10px] text-muted">{formatUgx(fees.service_fee_min_ugx)}–{formatUgx(fees.service_fee_max_ugx)}</p>
            </div>
            <div className="rounded-2xl border border-border bg-surface p-4">
              <p className="text-[10px] text-dim uppercase tracking-wider">Rider Commission</p>
              <p className="mt-1 text-lg font-bold text-success">{fees.rider_commission_percent}%</p>
            </div>
            <div className="rounded-2xl border border-border bg-surface p-4">
              <p className="text-[10px] text-dim uppercase tracking-wider">Platform Cut</p>
              <p className="mt-1 text-lg font-bold text-primary">{fees.platform_commission_percent}%</p>
            </div>
            <div className="rounded-2xl border border-border bg-surface p-4">
              <p className="text-[10px] text-dim uppercase tracking-wider">Free Delivery Over</p>
              <p className="mt-1 text-lg font-bold text-go">{formatUgx(fees.free_delivery_threshold_ugx)}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
