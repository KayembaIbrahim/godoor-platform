"use client";
import { RiderNav } from "@/components/RiderNav";
import { useState, useEffect } from "react";
import { Wallet, Package, TrendingUp, Clock } from "lucide-react";
import { useSession } from "@/lib/session-store";
import { fetchOrders, type DBOrder } from "@/lib/db";
import { formatUgx } from "@/lib/utils";

export default function RiderEarningsPage() {
  const { profile, supabaseUser } = useSession();
  const [orders, setOrders] = useState<DBOrder[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const uid = supabaseUser?.id || profile.email || "rider";
    fetchOrders().then((o) => {
      setOrders(o.filter((x) => x.rider_id === uid && x.status === "delivered"));
      setLoading(false);
    });
  }, [profile.email, supabaseUser?.id]);

  const total = orders.reduce((s, o) => s + (o.delivery_fee_ugx || 3000), 0);
  const riderFees = orders.reduce((s, o) => s + (o.rider_service_fee_ugx || 0), 0);
  const net = total - riderFees;

  return (<>
    <div className="mx-auto min-h-screen max-w-lg bg-bg pb-24 px-4">
      <h1 className="pt-4 font-display text-xl font-bold">Earnings</h1>

      <div className="mt-4 rounded-2xl bg-gradient-to-br from-primary to-primary p-5 text-white">
        <p className="text-xs uppercase tracking-wider text-white/60">Total earnings</p>
        <p className="mt-1 font-display text-3xl font-bold">{formatUgx(net)}</p>
        <p className="text-[10px] text-white/50 mt-1">After 5% platform fee</p>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <div className="rounded-xl bg-white/10 p-2.5"><p className="text-[10px] text-white/60">Deliveries</p><p className="text-sm font-bold">{orders.length}</p></div>
          <div className="rounded-xl bg-white/10 p-2.5"><p className="text-[10px] text-white/60">Avg per delivery</p><p className="text-sm font-bold">{orders.length > 0 ? formatUgx(net / orders.length) : "—"}</p></div>
        </div>
      </div>

      <div className="mt-4 rounded-2xl border border-border bg-surface p-4">
        <h3 className="text-sm font-semibold">Fee breakdown</h3>
        <div className="mt-2 space-y-2">
          <div className="flex justify-between rounded-xl bg-bg px-3 py-2.5">
            <span className="text-xs text-muted">Gross delivery fees</span>
            <span className="text-xs font-bold text-success">{formatUgx(total)}</span>
          </div>
          <div className="flex justify-between rounded-xl bg-bg px-3 py-2.5">
            <span className="text-xs text-muted">Platform fee (5%)</span>
            <span className="text-xs font-bold text-danger">-{formatUgx(riderFees)}</span>
          </div>
          <div className="flex justify-between rounded-xl bg-primary/10 px-3 py-2.5">
            <span className="text-xs font-semibold text-fg">Net earnings</span>
            <span className="text-xs font-bold text-primary">{formatUgx(net)}</span>
          </div>
        </div>
      </div>

      <div className="mt-4">
        <h3 className="text-sm font-semibold">Payment history</h3>
        <p className="mt-0.5 text-[10px] text-dim">Completed deliveries — linked to orders</p>
        {loading ? (
          <div className="mt-3 space-y-2">
            {[1,2,3].map((i) => <div key={i} className="h-16 animate-pulse rounded-2xl bg-surface" />)}
          </div>
        ) : orders.length === 0 ? (
          <div className="mt-4 rounded-2xl border border-dashed border-border p-6 text-center">
            <Package className="mx-auto h-8 w-8 text-dim" />
            <p className="mt-2 text-sm text-muted">No completed deliveries yet</p>
          </div>
        ) : (
          <div className="mt-2 space-y-2">
            {orders.map((o) => (
              <div key={o.id} className="rounded-2xl border border-border bg-surface p-3.5">
                <div className="flex items-center justify-between">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold truncate">{o.merchant_name || "Merchant"}</p>
                    <p className="text-[10px] text-dim">#{o.id.slice(-6)} · {o.items}</p>
                  </div>
                  <div className="ml-3 text-right">
                    <p className="text-xs font-bold text-success">{formatUgx((o.delivery_fee_ugx || 3000) - (o.rider_service_fee_ugx || 0))}</p>
                    <p className="text-[9px] text-dim">net</p>
                  </div>
                </div>
                <div className="mt-2 flex items-center justify-between border-t border-border pt-2">
                  <span className="text-[10px] text-muted">Gross: {formatUgx(o.delivery_fee_ugx || 3000)}</span>
                  <span className="text-[10px] text-danger">Fee: -{formatUgx(o.rider_service_fee_ugx || 0)}</span>
                  <span className="text-[10px] text-dim">{new Date(o.created_at).toLocaleDateString()}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
    <RiderNav />
  </>);
}
