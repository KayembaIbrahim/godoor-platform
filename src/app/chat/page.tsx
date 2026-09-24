"use client";

import Link from "next/link";
import { MessageSquare, ShoppingBag, ArrowLeft } from "lucide-react";
import { useSession } from "@/lib/session-store";
import { useOrders } from "@/lib/hooks";

export default function ChatIndexPage() {
  const { profile, onboarded, supabaseUser } = useSession();
  const { orders, loading } = useOrders(onboarded ? { customer_id: supabaseUser?.id || profile.email } : undefined);

  return (
    <div className="mx-auto min-h-[calc(100dvh-0px)] max-w-lg bg-bg pb-24">
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        <Link href="/app" className="text-muted hover:text-fg"><ArrowLeft className="h-5 w-5" /></Link>
        <h1 className="font-display text-lg font-semibold">Messages</h1>
      </div>

      <div className="px-4 pt-4 space-y-2">
        {loading ? (
          <p className="py-12 text-center text-sm text-muted">Loading conversations…</p>
        ) : orders.length === 0 ? (
          <div className="py-12 text-center">
            <div className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-full bg-go/10">
              <MessageSquare className="h-6 w-6 text-go" />
            </div>
            <p className="text-sm font-semibold text-fg">No conversations yet</p>
            <p className="mt-1 text-xs text-muted">Start an order to chat with a business about payment and delivery.</p>
            <Link href="/app" className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-go px-4 py-2.5 text-xs font-semibold text-white hover:bg-go-2 transition">
              <ShoppingBag className="h-3.5 w-3.5" /> Browse merchants
            </Link>
          </div>
        ) : (
          orders.sort((a, b) => b.created_at - a.created_at).map((o) => (
            <Link
              key={o.id}
              href={`/chat/${o.id}`}
              className="flex items-center gap-3 rounded-2xl border border-border bg-surface p-4 transition hover:border-primary/40"
            >
              <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-go/10">
                <MessageSquare className="h-5 w-5 text-go" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold truncate">{o.merchant_name}</p>
                <p className="text-xs text-muted truncate">{o.items}</p>
                <p className="text-[10px] text-dim">#{o.id.slice(-6)} · {new Date(o.created_at).toLocaleDateString()}</p>
              </div>
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-semibold ${
                o.status === "delivered" ? "bg-success/15 text-success" :
                o.status === "disputed" ? "bg-danger/15 text-danger" :
                "bg-go/15 text-go"
              }`}>
                {o.status.replace(/_/g, " ")}
              </span>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
