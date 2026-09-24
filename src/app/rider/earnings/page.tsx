"use client";
import { RiderNav } from "@/components/RiderNav";
import { useState, useEffect } from "react";
import { Wallet } from "lucide-react";
import { useSession } from "@/lib/session-store";
import { fetchOrders, fetchFeeConfig, type DBOrder, type FeeConfig } from "@/lib/db";
import { formatUgx } from "@/lib/utils";

export default function RiderEarningsPage() {
  const { profile, supabaseUser } = useSession();
  const [orders, setOrders] = useState<DBOrder[]>([]);
  const [fees, setFees] = useState<FeeConfig | null>(null);
  useEffect(() => {
    const uid = supabaseUser?.id || profile.email || "rider";
    fetchOrders().then((o) => setOrders(o.filter((x) => x.rider_id === uid && x.status === "delivered")));
    fetchFeeConfig().then(setFees);
  }, [profile.email, supabaseUser?.id]);

  const total = orders.reduce((s, o) => s + (o.delivery_fee_ugx || 3000), 0);
  const commission = fees?.rider_commission_percent || 80;
  const net = Math.round(total * commission / 100);

  return (<>
    <div className="mx-auto min-h-screen max-w-lg bg-bg pb-24 px-4">
      <h1 className="pt-4 font-display text-xl font-bold">Earnings</h1>
      <div className="mt-4 rounded-2xl bg-gradient-to-br from-[#f97316] to-primary p-5 text-white">
        <p className="text-xs uppercase tracking-wider text-white/60">Total earnings</p>
        <p className="mt-1 font-display text-3xl font-bold">{formatUgx(net)}</p>
        <p className="text-[10px] text-white/50 mt-1">After {100 - commission}% platform commission</p>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <div className="rounded-xl bg-white/10 p-2.5"><p className="text-[10px] text-white/60">Deliveries</p><p className="text-sm font-bold">{orders.length}</p></div>
          <div className="rounded-xl bg-white/10 p-2.5"><p className="text-[10px] text-white/60">Avg per delivery</p><p className="text-sm font-bold">{orders.length > 0 ? formatUgx(net / orders.length) : "—"}</p></div>
        </div>
      </div>
      <div className="mt-4 rounded-2xl border border-border bg-surface p-4">
        <h3 className="text-sm font-semibold">Commission split</h3>
        <p className="mt-2 text-xs text-muted">You keep {commission}% of each delivery fee. Platform retains {100 - commission}%.</p>
      </div>
    </div>
    <RiderNav />
    </>
  );
}