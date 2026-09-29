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
 */
export function useFeeConfig(): FeeConfigShape {
  const [cfg, setCfg] = useState<FeeConfigShape>(() => resolveFees(null));
  useEffect(() => {
    let live = true;
    fetch("/api/fees")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((body: { fees?: FeeConfigShape }) => {
        if (live && body?.fees) setCfg(resolveFees(body.fees));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  return cfg;
}
