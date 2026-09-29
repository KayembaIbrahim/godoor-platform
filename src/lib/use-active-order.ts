"use client";

import { useEffect, useRef, useState } from "react";
import { fetchOrders, subscribeToOrder, type DBOrder } from "./db";
import { useSession } from "./session-store";

/**
 * The order that is genuinely still moving, or null.
 *
 * This used to come from `useTrackingStore` — a persisted (localStorage)
 * snapshot written once when tracking started. Nothing ever cleared it, so a
 * customer whose rider tapped "Delivered" kept seeing "Live delivery in
 * progress" on their home and orders pages forever. Deriving the live order
 * from the order row itself makes that class of bug impossible: the rider's
 * PATCH is the single source of truth, and we follow it over realtime.
 */

/** Statuses that mean the order is still in motion. Anything else is terminal. */
export const LIVE_STATUSES = new Set([
  "pending",
  "payment_submitted",
  "payment_confirmed",
  "preparing",
  "medicines_ready",
  "rider_assigned",
  "delivering",
]);

export function isLiveStatus(status: string | undefined): boolean {
  return !!status && LIVE_STATUSES.has(status);
}

/** Newest still-moving order. `orders` is assumed newest-first. */
export function pickActiveOrder(orders: DBOrder[] | null | undefined): DBOrder | null {
  if (!orders) return null;
  return orders.find((o) => isLiveStatus(o.status)) || null;
}

const POLL_MS = 30000;

export function useActiveOrder(preloaded?: DBOrder[] | null) {
  const { supabaseUser, profile, onboarded } = useSession();
  const userId = supabaseUser?.id || "";
  const email = profile.email || supabaseUser?.email || "";

  const [orders, setOrders] = useState<DBOrder[] | null>(preloaded ?? null);
  const ordersRef = useRef<DBOrder[] | null>(orders);
  ordersRef.current = orders;

  // Adopt a list handed in by a page that already fetched it, so the home page
  // and the orders page do not each issue their own copy of the same request.
  useEffect(() => {
    if (preloaded) setOrders(preloaded);
  }, [preloaded]);

  const load = async () => {
    if (!onboarded || (!userId && !email)) return;
    try {
      const all = await fetchOrders();
      const mine = all.filter(
        (o) =>
          (userId && (o.customer_id === userId || o.customer_id === email)) ||
          (email && o.customer_email === email),
      );
      setOrders(mine);
    } catch {
      // Leave the last good list in place; the next poll will retry.
    }
  };

  useEffect(() => {
    if (!onboarded) return;
    setOrders(preloaded ?? null);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onboarded, userId, email]);

  // Realtime on whichever order we currently believe is live, plus a slow poll
  // and a refetch whenever the tab regains focus.
  const active = pickActiveOrder(orders);
  const activeId = active?.id || null;

  useEffect(() => {
    if (!activeId) return;
    const unsub = subscribeToOrder(activeId, (updated) => {
      setOrders((prev) => {
        if (!prev) return prev;
        return prev.map((o) => (o.id === updated.id ? { ...o, ...updated } : o));
      });
    });
    return unsub;
  }, [activeId]);

  useEffect(() => {
    if (!onboarded) return;
    const onWake = () => {
      if (document.visibilityState === "visible") load();
    };
    document.addEventListener("visibilitychange", onWake);
    window.addEventListener("focus", onWake);
    const poll = setInterval(load, POLL_MS);
    return () => {
      document.removeEventListener("visibilitychange", onWake);
      window.removeEventListener("focus", onWake);
      clearInterval(poll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onboarded, userId, email]);

  return active;
}
