;

import { formatUgx } from "@/lib/utils";
import { useFeeConfig } from "@/lib/use-fee-config";

/** Renders a UGX price with USD equivalent in small muted text */
export function Price({ amount, className = "" }: { amount: number; className?: string }) {
  const { ugx_per_usd } = useFeeConfig();
  const usd = (amount / (ugx_per_usd || 4400)).toFixed(2);
  return (
    <span className={`inline-flex items-baseline gap-1.5 ${className}`}>
      <span className="tabular-nums">{formatUgx(amount)}</span>
      <span className="text-[10px] text-dim tabular-nums">~${usd}</span>
    </span>
  );
}
