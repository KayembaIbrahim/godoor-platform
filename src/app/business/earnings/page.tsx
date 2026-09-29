"use client";
import { useState, useEffect, useCallback } from "react";
import { Wallet, TrendingUp, Package, ShieldCheck } from "lucide-react";
import { useSession } from "@/lib/session-store";
import { fetchOrders, type DBOrder } from "@/lib/db";
import { formatUgx } from "@/lib/utils";
import { orderFees } from "@/lib/fees";
import { Price } from "@/components/Price";

export default function BusinessEarningsPage() {
  const { profile, supabaseUser } = useSession();
  const [orders, setOrders] = useState<DBOrder[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(() => {
    const uid = useSession.getState().supabaseUser?.id || "";
    const email = useSession.getState().profile.email || useSession.getState().supabaseUser?.email || "";
    (async () => {
      try {
        let myMerchant: any = null;
        try {
          const res = await fetch(`/api/business/me?owner_id=${encodeURIComponent(uid)}&email=${encodeURIComponent(email)}`, { cache: "no-store" });
          const json = await res.json();
          myMerchant = json.merchant;
        } catch {}
        const o = await fetchOrders(myMerchant ? { merchant_id: myMerchant.id } : undefined);
        setOrders(o.filter((x) => x.status === "delivered"));
        setLoading(false);
      } catch { setLoading(false); }
    })();
  }, []);

  useEffect(() => {
    refresh();
    const poll = setInterval(refresh, 30000);
    return () => clearInterval(poll);
  }, [refresh]);

  const totalRevenue = orders.reduce((s, o) => s + o.subtotal_ugx, 0);
  const totalBusinessFees = orders.reduce((s, o) => s + orderFees(o).businessFee, 0);
  const netEarnings = totalRevenue - totalBusinessFees;

  const today = Date.now() - 86400000;
  const todayOrders = orders.filter((o) => o.created_at > today);
  const todayRevenue = todayOrders.reduce((s, o) => s + o.subtotal_ugx, 0);

  return (<>
    <div className="mx-auto min-h-screen max-w-6xl bg-bg px-4 pb-24">
      <div className="pt-4">
        <div className="flex items-center gap-2">
          <h1 className="font-display text-xl font-bold">Earnings</h1>
          <span className="inline-flex items-center gap-0.5 rounded-full bg-primary/15 px-1.5 py-0.5 text-[9px] font-bold text-primary">
            <ShieldCheck className="h-2.5 w-2.5" /> Business
          </span>
        </div>
        <p className="mt-1 text-xs text-muted">Revenue from completed orders</p>
      </div>

      <div className="mt-4 rounded-2xl bg-gradient-to-br from-primary to-go-2 p-5 text-white">
        <p className="text-xs uppercase tracking-wider text-white/60">Total earnings</p>
        <p className="mt-1 font-display text-3xl font-bold">{formatUgx(netEarnings)}</p>
        <div className="mt-3 grid grid-cols-3 gap-3">
          <div className="rounded-xl bg-white/10 p-2.5"><p className="text-[10px] text-white/60">Today</p><p className="text-sm font-bold">{formatUgx(todayRevenue)}</p></div>
          <div className="rounded-xl bg-white/10 p-2.5"><p className="text-[10px] text-white/60">Orders</p><p className="text-sm font-bold">{todayOrders.length}</p></div>
          <div className="rounded-xl bg-white/10 p-2.5"><p className="text-[10px] text-white/60">Total trips</p><p className="text-sm font-bold">{orders.length}</p></div>
        </div>
      </div>

      <div className="mt-4 rounded-2xl border border-border bg-surface p-4">
        <h3 className="text-sm font-semibold">Fee breakdown</h3>
        <p className="text-[10px] text-dim mt-0.5">10% service fee per order</p>
        <div className="mt-3 space-y-2">
          <div className="flex justify-between rounded-xl bg-bg px-3 py-2.5">
            <span className="text-xs text-muted">Gross sales</span>
            <span className="text-xs font-bold text-success">{formatUgx(totalRevenue)}</span>
          </div>
          <div className="flex justify-between rounded-xl bg-bg px-3 py-2.5">
            <span className="text-xs text-muted">Platform fee (10%)</span>
            <span className="text-xs font-bold text-danger">-{formatUgx(totalBusinessFees)}</span>
          </div>
          <div className="flex justify-between rounded-xl bg-primary/10 px-3 py-2.5">
            <span className="text-xs font-semibold text-fg">Net earnings</span>
            <span className="text-xs font-bold text-primary">{formatUgx(netEarnings)}</span>
          </div>
        </div>
      </div>

      <div className="mt-4">
        <h3 className="text-sm font-semibold">Payment history</h3>
        <p className="mt-0.5 text-[10px] text-dim">Completed orders — linked to payments</p>
        {loading ? (
          <div className="mt-3 space-y-2">
            {[1,2,3].map((i) => <div key={i} className="h-16 animate-pulse rounded-2xl bg-surface" />)}
          </div>
        ) : orders.length === 0 ? (
          <div className="mt-4 rounded-2xl border border-dashed border-border p-6 text-center">
            <Package className="mx-auto h-8 w-8 text-dim" />
            <p className="mt-2 text-sm text-muted">No completed orders yet</p>
          </div>
        ) : (
          <div className="mt-2 space-y-2">
            {orders.map((o) => (
              <div key={o.id} className="rounded-2xl border border-border bg-surface p-3.5">
                <div className="flex items-center justify-between">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold truncate">{o.customer_name || "Customer"}</p>
                    <p className="text-[10px] text-dim">#{o.id.slice(-6)} · {o.items}</p>
                  </div>
                  <div className="ml-3 text-right">
                    <p className="text-xs font-bold text-success">{formatUgx(orderFees(o).merchantPayout || Math.max(o.subtotal_ugx - orderFees(o).businessFee, 0))}</p>
                    <p className="text-[9px] text-dim">net</p>
                  </div>
                </div>
                <div className="mt-2 flex items-center justify-between border-t border-border pt-2">
                  <span className="text-[10px] text-muted">Gross: {formatUgx(o.subtotal_ugx)}</span>
                  <span className="text-[10px] text-danger">Fee: -{formatUgx(orderFees(o).businessFee)}</span>
                  <span className="text-[10px] text-dim">{new Date(o.created_at).toLocaleDateString()}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  </>);
}
