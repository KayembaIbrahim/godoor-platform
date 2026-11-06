"use client";

import { useEffect, useState } from "react";

/**
 * Live USD→UGX rate with heartbeat + freshness display.
 *
 * Polls /api/morse every 30s (twice per 60s server TTL) so the UI always
 * shows a fresh rate with a pulsing "live" dot and "updated Xs ago" label.
 * The rate never shows a hardcoded constant as if it were live:
 *  - state starts `null` (loading) — nothing renders until the first fetch
 *  - `fallback` source marks the rate stale (gold dot, not green)
 *  - `stale` (>120s) dims the rate and shows a warning
 */
export type LiveRateState = {
  rate: number | null; // null while loading
  source: "live" | "cached" | "fallback" | "loading";
  updatedAt: string | null; // ISO timestamp
  ageMs: number | null; // ms since fetch
  stale: boolean;
  ageSeconds: number | null; // derived for display
};

const INITIAL: LiveRateState = {
  rate: null,
  source: "loading",
  updatedAt: null,
  ageMs: null,
  stale: false,
  ageSeconds: null,
};

export function useLiveRate(pollMs = 30_000): LiveRateState {
  const [state, setState] = useState<LiveRateState>(INITIAL);

  useEffect(() => {
    let cancelled = false;

    async function fetchRate() {
      try {
        const res = await fetch("/api/morse", { cache: "no-store" });
        if (!res.ok) return;
        const body = await res.json();
        const cfg = body?.config;
        if (!cfg || typeof cfg.rateUgx !== "number" || !Number.isFinite(cfg.rateUgx)) return;
        if (cancelled) return;
        const updatedAt = typeof cfg.rateUpdatedAt === "string" ? cfg.rateUpdatedAt : null;
        const ageMs = typeof cfg.rateAgeMs === "number" ? cfg.rateAgeMs : null;
        const stale = cfg.rateStale === true;
        const source = (["live", "cached", "fallback"] as const).includes(cfg.rateSource) ? cfg.rateSource : "cached";
        setState({
          rate: cfg.rateUgx,
          source,
          updatedAt,
          ageMs,
          stale,
          ageSeconds: ageMs != null ? Math.round(ageMs / 1000) : null,
        });
      } catch {
        // Keep last good value; the age will grow and the UI will show staleness.
      }
    }

    fetchRate();
    const id = setInterval(fetchRate, pollMs);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [pollMs]);

  // Heartbeat tick: recompute age every 5s so "updated Xs ago" counts up
  // without re-fetching.
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(id);
  }, []);

  // Derived age (recomputed each tick) — does not trigger a fetch.
  let ageSeconds: number | null = state.ageSeconds;
  let stale = state.stale;
  if (state.updatedAt) {
    const fromTs = now - new Date(state.updatedAt).getTime();
    if (Number.isFinite(fromTs) && fromTs >= 0) {
      ageSeconds = Math.round(fromTs / 1000);
      stale = fromTs > 120_000; // 2x server TTL
    }
  }

  return { ...state, ageSeconds, stale };
}

/** Human-readable age, e.g. "just now", "12s ago", "3m ago". */
export function formatRateAge(ageSeconds: number | null): string {
  if (ageSeconds == null || !Number.isFinite(ageSeconds)) return "";
  if (ageSeconds < 5) return "just now";
  if (ageSeconds < 60) return `${Math.round(ageSeconds)}s ago`;
  const m = Math.round(ageSeconds / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.round(m / 60)}h ago`;
}
