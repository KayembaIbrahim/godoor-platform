"use client";

import { formatUgx } from "@/lib/utils";
import { formatRateAge, useLiveRate } from "@/lib/use-live-rate";

/**
 * Live USD→UGX rate badge with heartbeat.
 *
 * Data comes from `useLiveRate()` (/api/morse → live-rate.ts → er-api +
 * frankfurter mean). Nothing here is hardcoded:
 *  - rate starts null → "Connecting to live USD→UGX rate…"
 *  - source "live"/"cached" → green pulsing dot + "1 USD = X UGX" + "updated Xs ago"
 *  - source "fallback" → amber dot + "Rate unavailable — showing last known" (never pretends to be live)
 *  - stale (>120s) → amber dot + warning
 */
export function LiveRateBadge() {
  const { rate, source, stale, ageSeconds } = useLiveRate(30_000);

  const ageLabel = ageSeconds == null ? "" : formatRateAge(ageSeconds);

  if (rate == null || source === "loading") {
    return (
      <p className="flex items-center gap-2 text-[11px] text-dim tabular-nums">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-dim opacity-60" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-dim" />
        </span>
        <span>Connecting to live USD→UGX rate…</span>
      </p>
    );
  }

  const isLive = source === "live" || source === "cached";
  const showStale = stale || source === "fallback";

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <span className="relative flex h-2 w-2 shrink-0" aria-hidden>
        {isLive && !showStale ? (
          <>
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
          </>
        ) : (
          <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-500" />
        )}
      </span>
      <span className="num text-xs font-semibold text-fg tabular-nums">
        1 USD = {formatUgx(rate)} UGX
      </span>
      {isLive && !showStale && ageLabel && (
        <span className="text-[11px] text-dim tabular-nums">· updated {ageLabel}</span>
      )}
      {source === "fallback" && (
        <span className="text-[11px] font-medium text-amber-600">
          · Rate unavailable — showing last known
        </span>
      )}
      {stale && source !== "fallback" && (
        <span className="text-[11px] font-medium text-amber-600">
          · Stale — refreshing…
        </span>
      )}
    </div>
  );
}
