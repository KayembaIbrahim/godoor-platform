;

import { formatUgx } from "@/lib/utils";
import { useFeeConfig } from "@/lib/use-fee-config";

/** Renders a UGX price with USD equivalent in small muted text.
 *  The live rate comes from useFeeConfig() (/api/fees → live-rate.ts);
 *  while loading the USD suffix is omitted rather than showing a
 *  hardcoded 4102 as if it were live. */
export function Price({ amount, className = "" }: { amount: number; className?: string }) {
  const { ugx_per_usd } = useFeeConfig();
  const rate = typeof ugx_per_usd === "number" && ugx_per_usd > 0 ? ugx_per_usd : null;
  return (
    <span className={`inline-flex items-baseline gap-1.5 ${className}`}>
      <span className="tabular-nums">{formatUgx(amount)}</span>
      {rate != null && <span className="text-[10px] text-dim tabular-nums">~${(amount / rate).toFixed(2)}</span>}
    </span>
  );
}
