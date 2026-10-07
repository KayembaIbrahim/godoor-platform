"use client";

import Link from "next/link";
import { Truck, Navigation } from "lucide-react";

/**
 * Compact five-dot progress for the home screen's active-delivery card.
 *
 * Deliberately reuses the same fold as the tracking timeline
 * (src/app/tracking/page.tsx STEP_FOR_STATUS) rather than declaring another
 * list: the eleven server statuses collapse to five customer-facing steps, and
 * `payment_submitted` / `medicines_ready` must map to a real step or the dots
 * read "nothing has happened" to a customer who has already paid.
 */
const STEPS = [
  { key: "placed", label: "Placed", statuses: ["pending", "payment_submitted", "payment_confirmed"] },
  { key: "preparing", label: "Preparing", statuses: ["preparing"] },
  { key: "ready", label: "Ready", statuses: ["ready", "medicines_ready"] },
  { key: "transit", label: "On the way", statuses: ["rider_assigned", "delivering"] },
  { key: "delivered", label: "Delivered", statuses: ["delivered"] },
] as const;

const HEADLINE: Record<string, string> = {
  pending: "Waiting for payment",
  payment_submitted: "Payment submitted",
  payment_confirmed: "Payment confirmed",
  preparing: "Shop is preparing your order",
  medicines_ready: "Medicines ready",
  rider_assigned: "Rider assigned",
  delivering: "Live delivery in progress",
};

export default function ActiveDeliveryCard({
  order,
  className = "",
}: {
  order: {
    id: string;
    status: string;
    merchant_name?: string | null;
    rider_name?: string | null;
  };
  className?: string;
}) {
  const status = String(order.status ?? "");
  const idx = STEPS.findIndex((s) => (s.statuses as readonly string[]).includes(status));
  // Unknown status: show the first dot rather than an empty rail.
  const active = idx === -1 ? 0 : idx;
  const inTransit = active === 3;

  return (
    <Link
      href={`/tracking?orderId=${order.id}`}
      className={`group block rounded-2xl border border-white/10 bg-[#131F38] p-3.5 shadow-sm transition hover:border-go/40 active:scale-[0.99] ${className}`}
    >
      <div className="flex items-center gap-2.5">
        <Truck className={`h-4.5 w-4.5 shrink-0 text-go ${inTransit ? "animate-pulse" : ""}`} />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold text-go">{HEADLINE[status] || "Order in progress"}</p>
          <p className="truncate text-[11px] text-slate-400">
            {order.merchant_name || "Your order"}
            {order.rider_name ? ` · ${order.rider_name}` : ""}
          </p>
        </div>
        <span className="flex shrink-0 items-center gap-1 text-xs font-semibold text-go transition group-hover:translate-x-0.5">
          Track
          <Navigation className="h-3 w-3" />
        </span>
      </div>

      <div className="mt-3 flex items-start">
        {STEPS.map((s, i) => {
          const reached = i <= active;
          const isCurrent = i === active;
          const last = i === STEPS.length - 1;
          return (
            <div key={s.key} className="flex min-w-0 flex-1 flex-col items-center">
              <div className="flex w-full items-center">
                <div className={`h-0.5 flex-1 ${i === 0 ? "opacity-0" : reached ? "bg-go" : "bg-slate-700/60"}`} />
                <span
                  className={`shrink-0 rounded-full transition-all ${
                    isCurrent
                      ? "h-3 w-3 bg-go ring-4 ring-go/25"
                      : reached
                        ? "h-2.5 w-2.5 bg-go"
                        : "h-2 w-2 border border-slate-600 bg-slate-800"
                  }`}
                />
                <div className={`h-0.5 flex-1 ${last ? "opacity-0" : i < active ? "bg-go" : "bg-slate-700/60"}`} />
              </div>
              <p
                className={`mt-1.5 text-center text-[8px] font-bold uppercase tracking-wider transition-colors ${
                  isCurrent ? "text-go" : reached ? "text-slate-200" : "text-slate-500"
                }`}
              >
                {s.label}
              </p>
            </div>
          );
        })}
      </div>
    </Link>
  );
}
