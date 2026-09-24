"use client";
import { RiderNav } from "@/components/RiderNav";
import { useState, useEffect } from "react";
import { Package, MapPin, CheckCircle2 } from "lucide-react";
import { useSession } from "@/lib/session-store";
import { fetchOrders, type DBOrder } from "@/lib/db";
import { formatUgx } from "@/lib/utils";

export default function RiderHistoryPage() {
  const { profile, supabaseUser } = useSession();
  const [orders, setOrders] = useState<DBOrder[]>([]);
  useEffect(() => {
    fetchOrders().then((o) => setOrders(o.filter((x) => x.rider_id === (profile.email || "rider")).sort((a, b) => b.created_at - a.created_at)));
  }, [profile.email]);

  return (<>
    <div className="mx-auto min-h-screen max-w-lg bg-bg pb-24 px-4">
      <h1 className="pt-4 font-display text-xl font-bold">Delivery History</h1>
      <div className="mt-4 space-y-2">
        {orders.length === 0 ? (
          <div className="py-12 text-center">
            <Package className="mx-auto h-8 w-8 text-dim" />
            <p className="mt-2 text-sm text-muted">No deliveries yet</p>
          </div>
        ) : orders.map((o) => (
          <div key={o.id} className="rounded-2xl border border-border bg-surface p-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm font-semibold">{o.merchant_name}</p>
                <p className="text-xs text-muted">{o.items}</p>
                <div className="mt-1 flex items-center gap-1 text-[10px] text-dim"><MapPin className="h-3 w-3" />{o.delivery_address || "Uganda"}</div>
              </div>
              <div className="text-right">
                <p className="text-sm font-bold text-success tabular-nums">{formatUgx(o.delivery_fee_ugx || 3000)}</p>
                <span className={`mt-1 inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[9px] font-semibold ${o.status === "delivered" ? "bg-success/15 text-success" : "bg-elevated text-muted"}`}>
                  <CheckCircle2 className="h-2.5 w-2.5" /> {o.status}
                </span>
              </div>
            </div>
            <p className="mt-1 text-[10px] text-dim">{new Date(o.created_at).toLocaleString()}</p>
          </div>
        ))}
      </div>
    </div>
    <RiderNav />
    </>
  );
}