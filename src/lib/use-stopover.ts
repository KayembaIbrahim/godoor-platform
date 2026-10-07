"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { tickStopover, type StopoverLiveView } from "@/lib/stopover-core";

/**
 * Live wait ("stopover") state for one ride, for the rider's button and the
 * customer's running-cost banner.
 *
 * Two things make this trustworthy rather than decorative:
 *
 *  1. Every poll returns the server's own clock. The hook records the offset
 *     between the handset and the server and ticks against THAT, so a phone
 *     whose clock is an hour out still shows the figure it will be charged
 *     rather than an hour of phantom waiting.
 *
 *  2. The counter only ever re-derives from an authoritative snapshot. A failed
 *     poll is ignored rather than resetting the timer to zero, because the most
 *     alarming possible bug here is a customer being shown "0 min" for a wait
 *     they have already been billed eight minutes of.
 */
export function useRideStopover(rideId: string | null | undefined, active: boolean) {
  const [view, setView] = useState<StopoverLiveView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * Whether the stopover feature is switched on server-side.
   *
   * `null` = not yet known, `false` = the schema has not been applied. Callers
   * hide the control rather than render a button that would answer 503 — a
   * rider tapping "Waiting on passenger?" and being told it is unavailable is
   * worse than not offering it at all.
   */
  const [ready, setReady] = useState<boolean | null>(null);

  /** serverNow - Date.now(), refreshed on every successful poll. */
  const offsetRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const serverNow = useCallback(() => Date.now() + offsetRef.current, []);

  const refresh = useCallback(async () => {
    if (!rideId) return;
    try {
      const res = await fetch(`/api/rides/stopover?rideId=${encodeURIComponent(rideId)}`);
      if (res.status === 503) {
        if (mountedRef.current) setReady(false);
        return;
      }
      if (!res.ok) {
        // Signed out, or a transient network failure. Neither means "off".
        return;
      }
      const json = await res.json().catch(() => ({}));
      if (!json?.stopover || !mountedRef.current) return;
      if (typeof json.stopover.server_now === "number") {
        offsetRef.current = json.stopover.server_now - Date.now();
      }
      setView(json.stopover);
      setReady(true);
      setError(null);
    } catch {
      // Leave the previous snapshot in place; a stale-but-correct counter beats
      // a counter that resets every time the network hiccups.
    }
  }, [rideId]);

  /* Anchor on mount, then re-anchor often enough that a drifting offset cannot
     accumulate. 45s also keeps this well under the data a Ugandan 4G user
     would notice on a metered connection. */
  useEffect(() => {
    if (!rideId || !active) {
      setView(null);
      return;
    }
    void refresh();
    const poll = setInterval(() => void refresh(), 45_000);
    return () => clearInterval(poll);
  }, [rideId, active, refresh]);

  /* Smooth tick. Purely presentational between anchors. */
  useEffect(() => {
    if (!view?.open) return;
    const t = setInterval(() => {
      setView((prev) => (prev ? tickStopover(prev, serverNow()) : prev));
    }, 1000);
    return () => clearInterval(t);
  }, [view?.open, serverNow]);

  /**
   * Run a stopover mutation and immediately re-anchor.
   *
   * The re-anchor matters: without it the rider would keep seeing "running"
   * for up to 45 seconds after tapping End, which reads as a failed tap and
   * invites them to tap again.
   */
  const run = useCallback(
    async (fn: () => Promise<unknown>) => {
      if (busy) return null;
      setBusy(true);
      setError(null);
      try {
        await fn();
        await refresh();
        return true;
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Something went wrong";
        setError(msg);
        // Even on failure the server may have applied the change before the
        // response was lost, so re-anchor regardless.
        await refresh();
        return false;
      } finally {
        if (mountedRef.current) setBusy(false);
      }
    },
    [busy, refresh],
  );

  return { view, ready, busy, error, run, refresh, setError };
}
