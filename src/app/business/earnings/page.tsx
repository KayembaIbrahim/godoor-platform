"use client";
import { useState, useEffect, useCallback } from "react";
import { Wallet, TrendingUp, Package, ShieldCheck } from "lucide-react";
import { useSession } from "@/lib/session-store";
import { fetchOrders, fetchFeeConfig, type DBOrder, type FeeConfig } from "@/lib/db";
import { formatUgx } from "@/lib/utils";
import { Price } from "@/components/Price";

export default function BusinessEarningsPage() {
  const { profile, supabaseUser } = useSession();
  const [orders, setOrders] = useState<DBOrder[]>([]);
  const [fees, setFees] = useState<FeeConfig | null>(null);

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
        setOrders(o);
      } catch {}
    })();
  }, []);

  useEffect(() => {
    refresh();
    const poll = setInterval(refresh, 30000);
    return () => clearInterval(poll);
  }, [refresh]);

  useEffect(() => {
    fetchFeeConfig().then(setFees).catch(() => {});
  }, []);

  const paid = orders.filter((o) => ["payment_confirmed", "delivering", "delivered"].includes(o.status));
  const totalRevenue = paid.reduce((s, o) => s + o.total_ugx, 0);
  const totalServiceFee = paid.reduce((s, o) => s + o.service_fee_ugx, 0);
  const totalDeliveryFee = paid.reduce((s, o) => s + o.delivery_fee_ugx, 0);

  const today = Date.now() - 86400000;
  const todayRevenue = paid.filter((o) => o.created_at > today).reduce((s, o) => s + o.total_ugx, 0);
  const todayOrders = paid.filter((o) => o.created_at > today).length;

  return (<>
    <div className="mx-auto min-h-screen max-w-6xl bg-bg px-4 pb-24">
      <div className="pt-4">
        <div className="flex items-center gap-2">
          <h1 className="font-display text-xl font-bold">Earnings</h1>
          <span className="inline-flex items-center gap-0.5 rounded-full bg-primary/15 px-1.5 py-0.5 text-[9px] font-bold text-primary">
            <ShieldCheck className="h-2.5 w-2.5" /> Business
          </span>
        </div>
        <p className="mt-1 text-xs text-muted">Revenue from orders with confirmed payments</p>
      </div>

      <div className="mt-4 rounded-2xl bg-gradient-to-br from-primary to-go-2 p-5 text-white">
        <p className="text-xs uppercase tracking-wider text-white/60">Total revenue</p>
        <p className="mt-1 font-display text-3xl font-bold">{formatUgx(totalRevenue)}</p>
        <div className="mt-3 grid grid-cols-3 gap-3">
          <div className="rounded-xl bg-white/10 p-2.5"><p className="text-[10px] text-white/60">Today</p><p className="text-sm font-bold">{formatUgx(todayRevenue)}</p></div>
          <div className="rounded-xl bg-white/10 p-2.5"><p className="text-[10px] text-white/60">Orders</p><p className="text-sm font-bold">{todayOrders}</p></div>
          <div className="rounded-xl bg-white/10 p-2.5"><p className="text-[10px] text-white/60">Total trips</p><p className="text-sm font-bold">{paid.length}</p></div>
        </div>
      </div>

      <div className="mt-4 rounded-2xl border border-border bg-surface p-4">
        <h3 className="text-sm font-semibold">Fee breakdown</h3>
        <p className="text-[10px] text-dim mt-0.5">2% service fee (1% on orders above UGX 100,000 / ~$30)</p>
        <div className="mt-3 space-y-2">
          <div className="flex justify-between rounded-xl bg-bg px-3 py-2.5">
            <span className="text-xs text-muted">Platform service fee</span>
            <span className="text-xs font-bold text-danger">-{formatUgx(totalServiceFee)}</span>
          </div>
          <div className="flex justify-between rounded-xl bg-bg px-3 py-2.5">
            <span className="text-xs text-muted">Delivery fees collected</span>
            <span className="text-xs font-bold text-success">{formatUgx(totalDeliveryFee)}</span>
          </div>
          <div className="flex justify-between rounded-xl bg-primary/10 px-3 py-2.5">
            <span className="text-xs font-semibold text-fg">Net earnings</span>
            <span className="text-xs font-bold text-primary">{formatUgx(totalRevenue - totalServiceFee)}</span>
          </div>
        </div>
        {fees && (
          <p className="mt-3 border-t border-border pt-3 text-[10px] text-dim">
            Commission config · Platform {fees.platform_commission_percent}% · Rider {fees.rider_commission_percent}%
          </p>
        )}
      </div>

      {paid.length > 0 && (
        <div className="mt-4">
          <h3 className="text-sm font-semibold">Recent paid orders</h3>
          <div className="mt-2 space-y-2">
            {paid.slice(0, 8).map((o) => (
              <div key={o.id} className="flex items-center justify-between rounded-2xl border border-border bg-surface p-3.5">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold truncate">{o.customer_name || "Customer"}</p>
                  <p className="text-[10px] text-dim">#{o.id.slice(-6)} · {o.items}</p>
                </div>
                <div className="ml-3 shrink-0"><Price amount={o.total_ugx} className="text-xs font-bold text-primary" /></div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
    </>
  );
}