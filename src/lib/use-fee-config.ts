"use client";

import { useEffect, useState } from "react";
import { resolveFees, type FeeConfigShape } from "@/lib/fees";

/**
 * Live fee config for the cart/checkout quote.
 *
 * Starts from the shared 15% fallback so the first paint is already correct,
 * then replaces it with the production fee_config row. The server remains
 * authoritative — this only guarantees the displayed total matches what gets
 * charged instead of being calculated from a stale hardcoded rate.
 *
 * The USD→UGX rate inside `ugx_per_usd` goes through the same live pipeline
 * as everything else (server: /api/fees → live-rate.ts → er-api +
 * frankfurter mean). It is NOT a hardcoded 4102: the initial value is null
 * and the field fills in from the API. Callers that need the rate live
 * should use `useLiveRate()` directly; this hook is for the fee shape.
 */
export function useFeeConfig(): FeeConfigShape {
  const [cfg, setCfg] = useState<FeeConfigShape>(() => resolveFees(null));
  const [ugxPerUsd, setUgxPerUsd] = useState<number | null>(null);
  useEffect(() => {
    let live = true;
    fetch("/api/fees", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((body: { fees?: FeeConfigShape; ugxPerUsd?: number; rateSource?: "live" | "cached" | "fallback"; rateUpdatedAt?: string | null; rateStale?: boolean }) => {
        if (live && body?.fees) setCfg(resolveFees(body.fees));
        if (live && typeof body?.ugxPerUsd === "number" && Number.isFinite(body.ugxPerUsd)) setUgxPerUsd(body.ugxPerUsd);
        if (live && typeof body?.ugxPerUsd === "number" && Number.isFinite(body.ugxPerUsd)) {
          setCfg((prev) => ({ ...prev, rateSource: body.rateSource, rateUpdatedAt: body.rateUpdatedAt, rateStale: body.rateStale }));
        }
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  return { ...cfg, ugx_per_usd: ugxPerUsd } as FeeConfigShape;
}
