"use client";

import { useState, useEffect } from "react";
import {
  BarChart3, TrendingUp, Package, DollarSign, Clock, MapPin, Users,
  ArrowUpRight, ArrowDownRight, Calendar
} from "lucide-react";
import { fetchOrders, fetchMerchants, fetchUsers, type DBOrder, type DBMerchant } from "@/lib/db";
import { formatUgx } from "@/lib/utils";

export default function AdminAnalytics() {
  const [orders, setOrders] = useState<DBOrder[]>([]);
  const [merchants, setMerchants] = useState<DBMerchant[]>([]);
  const [users, setUsers] = useState<{ id: string; email: string; role: string; created_at: number }[]>([]);

  useEffect(() => {
    fetch("/api/admin/overview", { cache: "no-store" })
      .then((r) => r.ok ? r.json() : null)
      .then((d) => {
        if (!d?.overview) return;
        setOrders(d.overview.orders || []);
        setMerchants(d.overview.merchants || []);
        setUsers(d.overview.users || []);
      })
      .catch(() => {
        fetchOrders().then(setOrders);
        fetchMerchants().then(setMerchants);
        fetchUsers().then((u) => setUsers(u as any));
      });
  }, []);

  const now = Date.now();
  const todayMs = 86400000;
  const weekMs = 7 * todayMs;
  const monthMs = 30 * todayMs;

  const todayOrders = orders.filter((o) => now - o.created_at < todayMs);
  const weekOrders = orders.filter((o) => now - o.created_at < weekMs);
  const monthOrders = orders.filter((o) => now - o.created_at < monthMs);

  const totalRevenue = orders.filter((o) => ["payment_confirmed", "delivered"].includes(o.status))
    .reduce((s, o) => s + o.total_ugx, 0);
  const serviceRevenue = orders.filter((o) => ["payment_confirmed", "delivered"].includes(o.status))
    .reduce((s, o) => s + o.service_fee_ugx, 0);

  // Orders by category
  const categoryStats = merchants.reduce((acc, m) => {
    acc[m.category] = (acc[m.category] || 0) + orders.filter((o) => o.merchant_name === m.name).length;
    return acc;
  }, {} as Record<string, number>);

  // Orders by status
  const statusStats = orders.reduce((acc, o) => {
    acc[o.status] = (acc[o.status] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  // Revenue by merchant
  const merchantRevenue = orders.filter((o) => ["payment_confirmed", "delivered"].includes(o.status))
    .reduce((acc, o) => {
      acc[o.merchant_name] = (acc[o.merchant_name] || 0) + o.total_ugx;
      return acc;
    }, {} as Record<string, number>);

  const topMerchants = Object.entries(merchantRevenue)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5);

  // Payment method breakdown
  const paymentMethods = orders.reduce((acc, o) => {
    acc[o.payment_method] = (acc[o.payment_method] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const maxBarWidth = Math.max(...Object.values(categoryStats), 1);

  // ── 14-day trend ──
  const days: { label: string; orders: number; revenue: number }[] = [];
  for (let i = 13; i >= 0; i--) {
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    dayStart.setDate(dayStart.getDate() - i);
    const dayEnd = dayStart.getTime() + todayMs;
    const dayOrders = orders.filter((o) => o.created_at >= dayStart.getTime() && o.created_at < dayEnd);
    days.push({
      label: dayStart.toLocaleDateString([], { day: "numeric", month: "short" }),
      orders: dayOrders.length,
      revenue: dayOrders.filter((o) => ["payment_confirmed", "delivered"].includes(o.status)).reduce((s2, o) => s2 + o.total_ugx, 0),
    });
  }
  const maxDayOrders = Math.max(...days.map((d) => d.orders), 1);
  const maxDayRevenue = Math.max(...days.map((d) => d.revenue), 1);
  const totalOrders = orders.length;
  const totalUsers = users.length;

  // ── Role distribution ──
  const roleStats = users.reduce((acc, u) => {
    acc[u.role] = (acc[u.role] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  const roleOrder = ["customer", "business", "rider", "admin"];
  const roleLabels: Record<string, string> = { customer: "Customers", business: "Businesses", rider: "Riders", admin: "Admins" };
  const roleColors: Record<string, string> = { customer: "bg-go", business: "bg-primary", rider: "bg-primary", admin: "bg-danger" };
  const maxRoleCount = Math.max(...Object.values(roleStats), 1);

  return (
    <div className="pb-24 md:pb-0 animate-fade-in">
      <h1 className="font-display text-2xl font-bold">Analytics</h1>
      <p className="mt-1 text-sm text-muted">Platform performance and revenue insights.</p>

      {/* Period summary */}
      <div className="mt-6 grid grid-cols-3 gap-3">
        {[
          { label: "Today", orders: todayOrders.length, revenue: todayOrders.filter((o) => ["payment_confirmed", "delivered"].includes(o.status)).reduce((s, o) => s + o.total_ugx, 0) },
          { label: "This Week", orders: weekOrders.length, revenue: weekOrders.filter((o) => ["payment_confirmed", "delivered"].includes(o.status)).reduce((s, o) => s + o.total_ugx, 0) },
          { label: "This Month", orders: monthOrders.length, revenue: monthOrders.filter((o) => ["payment_confirmed", "delivered"].includes(o.status)).reduce((s, o) => s + o.total_ugx, 0) },
        ].map((p) => (
          <div key={p.label} className="rounded-2xl border border-border bg-surface p-4">
            <p className="text-[10px] text-dim uppercase tracking-wider font-medium">{p.label}</p>
            <p className="mt-1 text-lg font-bold">{p.orders}</p>
            <p className="text-xs text-go font-semibold">{formatUgx(p.revenue)}</p>
          </div>
        ))}
      </div>

      {/* Revenue overview */}
      <div className="mt-6 rounded-2xl border border-border bg-surface p-5">
        <div className="flex items-center gap-2.5 mb-4">
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-success/10"><DollarSign className="h-4 w-4 text-success" /></div>
          <h2 className="text-sm font-semibold">Revenue Overview</h2>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl bg-bg p-3.5">
            <p className="text-[10px] text-dim uppercase tracking-wider">Total GMV</p>
            <p className="mt-1 text-xl font-bold text-fg">{formatUgx(totalRevenue)}</p>
          </div>
          <div className="rounded-xl bg-bg p-3.5">
            <p className="text-[10px] text-dim uppercase tracking-wider">Platform Service Fees</p>
            <p className="mt-1 text-xl font-bold text-go">{formatUgx(serviceRevenue)}</p>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-3">
          <div className="rounded-xl bg-bg p-2.5 text-center">
            <p className="text-[10px] text-dim">Avg Order</p>
            <p className="text-sm font-bold">{orders.length > 0 ? formatUgx(totalRevenue / Math.max(1, orders.filter((o) => ["payment_confirmed", "delivered"].includes(o.status)).length)) : "—"}</p>
          </div>
          <div className="rounded-xl bg-bg p-2.5 text-center">
            <p className="text-[10px] text-dim">Completion</p>
            <p className="text-sm font-bold text-success">{orders.length > 0 ? Math.round(statusStats["delivered"] || 0) / orders.length * 100 : 0}%</p>
          </div>
          <div className="rounded-xl bg-bg p-2.5 text-center">
            <p className="text-[10px] text-dim">Dispute Rate</p>
            <p className="text-sm font-bold text-danger">{orders.length > 0 ? Math.round((statusStats["disputed"] || 0) / orders.length * 100) : 0}%</p>
          </div>
        </div>
      </div>

      {/* Orders by category */}
      <div className="mt-6 rounded-2xl border border-border bg-surface p-5">
        <div className="flex items-center gap-2.5 mb-4">
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-go/10"><BarChart3 className="h-4 w-4 text-go" /></div>
          <h2 className="text-sm font-semibold">Orders by Category</h2>
        </div>
        <div className="space-y-2.5">
          {Object.entries(categoryStats).sort(([, a], [, b]) => b - a).map(([cat, count]) => (
            <div key={cat} className="flex items-center gap-3">
              <span className="w-20 text-xs text-muted truncate">{cat}</span>
              <div className="flex-1 h-6 rounded-lg bg-bg overflow-hidden">
                <div className="h-full rounded-lg bg-go/60 transition-all" style={{ width: `${(count / maxBarWidth) * 100}%` }} />
              </div>
              <span className="w-8 text-right text-xs font-bold tabular-nums">{count}</span>
            </div>
          ))}
          {Object.keys(categoryStats).length === 0 && (
            <p className="py-6 text-center text-xs text-muted">No order data yet</p>
          )}
        </div>
      </div>

      {/* 14-day trend */}
      <div className="mt-6 rounded-2xl border border-border bg-surface p-5">
        <div className="flex items-center gap-2.5 mb-4">
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-go/10"><TrendingUp className="h-4 w-4 text-go" /></div>
          <div>
            <h2 className="text-sm font-semibold">Orders &amp; Revenue Trend</h2>
            <p className="text-[10px] text-dim">Last 14 days · {totalOrders} total orders</p>
          </div>
        </div>
        <div className="flex items-end justify-between gap-1 h-40">
          {days.map((d, i) => {
            const h = Math.max(6, Math.round((d.orders / maxDayOrders) * 100));
            const r = Math.max(6, Math.round((d.revenue / maxDayRevenue) * 100));
            return (
              <div key={i} className="group relative flex-1 flex flex-col items-center justify-end gap-0.5">
                <div className="w-full flex items-end justify-center gap-[2px]">
                  <div className="w-[38%] rounded-t-md bg-primary/70 transition-all group-hover:bg-primary" style={{ height: `${r}px` }} title={`UGX ${formatUgx(d.revenue)}`} />
                  <div className="w-[38%] rounded-t-md bg-go/60 transition-all group-hover:bg-go" style={{ height: `${h}px` }} title={`${d.orders} orders`} />
                </div>
                <span className="text-[8px] text-dim rotate-0 whitespace-nowrap">{d.label}</span>
                <div className="pointer-events-none absolute -top-1 left-1/2 z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-lg border border-border bg-elevated px-2 py-1 text-[10px] font-medium opacity-0 shadow-lg transition group-hover:opacity-100">
                  {d.orders} orders · {formatUgx(d.revenue)}
                </div>
              </div>
            );
          })}
        </div>
        <div className="mt-3 flex items-center gap-4 text-[10px] text-dim">
          <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-go/60" />Orders</span>
          <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-primary/70" />Revenue</span>
        </div>
      </div>

      {/* Role distribution */}
      <div className="mt-6 rounded-2xl border border-border bg-surface p-5">
        <div className="flex items-center gap-2.5 mb-4">
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-success/10"><Users className="h-4 w-4 text-success" /></div>
          <div>
            <h2 className="text-sm font-semibold">Community by Role</h2>
            <p className="text-[10px] text-dim">{totalUsers} registered users</p>
          </div>
        </div>
        <div className="space-y-2.5">
          {roleOrder.filter((r) => roleStats[r]).map((r) => (
            <div key={r} className="flex items-center gap-3">
              <span className="w-24 text-xs text-muted truncate">{roleLabels[r]}</span>
              <div className="flex-1 h-6 rounded-lg bg-bg overflow-hidden">
                <div className={`h-full rounded-lg ${roleColors[r] || "bg-go"} transition-all`} style={{ width: `${((roleStats[r] || 0) / maxRoleCount) * 100}%` }} />
              </div>
              <span className="w-8 text-right text-xs font-bold tabular-nums">{roleStats[r]}</span>
            </div>
          ))}
          {totalUsers === 0 && (
            <p className="py-6 text-center text-xs text-muted">No users yet — share GoDoor to grow the community</p>
          )}
        </div>
      </div>

      {/* Top merchants */}
      <div className="mt-6 rounded-2xl border border-border bg-surface p-5">
        <div className="flex items-center gap-2.5 mb-4">
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-primary/10"><TrendingUp className="h-4 w-4 text-primary" /></div>
          <h2 className="text-sm font-semibold">Top Merchants by Revenue</h2>
        </div>
        <div className="space-y-2">
          {topMerchants.map(([name, revenue], i) => (
            <div key={name} className="flex items-center gap-3 rounded-xl bg-bg px-3 py-2.5">
              <span className={`grid h-7 w-7 place-items-center rounded-lg text-xs font-bold ${
                i === 0 ? "bg-go/15 text-go" : i === 1 ? "bg-success/15 text-success" : "bg-elevated text-muted"
              }`}>{i + 1}</span>
              <span className="flex-1 text-xs font-medium truncate">{name}</span>
              <span className="text-xs font-bold tabular-nums text-go">{formatUgx(revenue)}</span>
            </div>
          ))}
          {topMerchants.length === 0 && (
            <p className="py-6 text-center text-xs text-muted">No revenue data yet</p>
          )}
        </div>
      </div>

      {/* Payment methods */}
      <div className="mt-6 rounded-2xl border border-border bg-surface p-5">
        <div className="flex items-center gap-2.5 mb-4">
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-warning/10"><Clock className="h-4 w-4 text-warning" /></div>
          <h2 className="text-sm font-semibold">Payment Methods</h2>
        </div>
        <div className="grid grid-cols-3 gap-3">
          {Object.entries(paymentMethods).map(([method, count]) => (
            <div key={method} className="rounded-xl bg-bg p-3 text-center">
              <p className="text-lg font-bold">{count}</p>
              <p className="text-[10px] text-muted capitalize">{method === "momo" ? "MTN MoMo" : method === "airtel" ? "Airtel" : "Cash"}</p>
            </div>
          ))}
          {Object.keys(paymentMethods).length === 0 && (
            <p className="col-span-3 py-6 text-center text-xs text-muted">No payment data yet</p>
          )}
        </div>
      </div>
    </div>
  );
}
