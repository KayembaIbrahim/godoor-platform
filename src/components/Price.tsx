"use client";

import { formatUgx } from "@/lib/utils";

/** Renders a UGX price with USD equivalent in small muted text */
export function Price({ amount, className = "" }: { amount: number; className?: string }) {
  const usd = (amount / 3750).toFixed(2);
  return (
    <span className={`inline-flex items-baseline gap-1.5 ${className}`}>
      <span className="tabular-nums">{formatUgx(amount)}</span>
      <span className="text-[10px] text-dim tabular-nums">~${usd}</span>
    </span>
  );
}
