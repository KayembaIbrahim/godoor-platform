"use client";

import { useEffect, useRef } from "react";
import { fetchOrders, subscribeToOrderStatus, type DBOrder } from "@/lib/db";
import { useSession } from "@/lib/session-store";
import { useNotifications } from "@/lib/notifications-store";
import { registerPushWorker } from "@/lib/web-push-client";
import { decideTransition, notificationBody } from "@/lib/notification-core";

/**
 * Order alerts for every signed-in customer, on every page.
 *
 * This used to live inside `/orders`, so the bell was only ever fed while the
 * customer happened to be sitting on the Orders tab. `/app` — where the bell is
 * rendered, and where a customer spends nearly all their time — followed the
 * live order over realtime but threw the status transitions away, so the badge
 * stayed at zero while their own order was moving.
 *
 * Mounted once from `ClientProviders`, it follows the customer across the app.
 * The decision logic lives in `notification-core` so it can be tested directly.
 */

/** Recent orders to watch. Bounded so a long history cannot open an unbounded
 *  number of realtime channels. */
const WATCH_LIMIT = 12;

/** How long a fetched order list may be reused to seed subscriptions. */
const SEED_TTL_MS = 10_000;

let seedCache: { at: number; orders: DBOrder[] } | null = null;
let seedInFlight: Promise<DBOrder[]> | null = null;

/**
 * Fetch the list used to seed subscriptions, shared across callers.
 *
 * `useActiveOrder` already pulls the same scoped list on `/app`. Without this,
 * every signed-in page would issue a second identical request purely to learn
 * which statuses it already knows about — and `/app` would pay for two. The
 * dedup that makes seeding safe is independent of freshness, so a short TTL is
 * harmless here.
 */
async function fetchSeedOrders(params: { customer_id?: string; customer_email?: string }): Promise<DBOrder[]> {
  if (seedCache && Date.now() - seedCache.at < SEED_TTL_MS) return seedCache.orders;
  if (seedInFlight) return seedInFlight;
  seedInFlight = fetchOrders(params)
    .then((orders) => {
      seedCache = { at: Date.now(), orders };
      return orders;
    })
    .finally(() => {
      seedInFlight = null;
    });
  return seedInFlight;
}

/** Drop cached state. Called on sign-out so one account's list never seeds another's. */
export function resetNotificationSeed(): void {
  seedCache = null;
  seedInFlight = null;
}

export function useOrderNotifications() {
  const { supabaseUser, profile, onboarded } = useSession();
  const addNotification = useNotifications((s) => s.addNotification);

  const userId = supabaseUser?.id || "";
  const email = profile.email || supabaseUser?.email || "";

  // orderId -> last status we knew about. Seeded with the status each order
  // already had on arrival, so mounting mid-journey does not announce a burst of
  // statuses the customer has already seen. Refs, not state: a re-render must not
  // reset the record of what was already sent.
  const lastStatus = useRef<Map<string, string>>(new Map());
  // `${orderId}:${status}` pairs already announced.
  const announced = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!onboarded || (!userId && !email)) {
      lastStatus.current.clear();
      announced.current.clear();
      resetNotificationSeed();
      return;
    }

    let cancelled = false;
    const unsubs: Array<() => void> = [];

    const isMine = (o: DBOrder) =>
      (userId && (o.customer_id === userId || o.customer_id === email)) ||
      (email && o.customer_email === email);

    const watch = async () => {
      try {
        // Scoped server-side, the same call `useActiveOrder` makes. The
        // unfiltered variant fans out into several full-table reads.
        const all = await fetchSeedOrders(
          userId ? { customer_id: userId } : email ? { customer_email: email } : {},
        );
        if (cancelled) return;

        for (const o of all.filter(isMine).slice(0, WATCH_LIMIT)) {
          lastStatus.current.set(o.id, o.status);

          const unsub = subscribeToOrderStatus(o.id, (status) => {
            if (cancelled) return;
            const { announce, label } = decideTransition(
              lastStatus.current,
              announced.current,
              o.id,
              status,
            );
            if (!announce) return;
            addNotification({
              title: status,
              body: notificationBody(o.id, o.merchant_name, label),
              orderId: o.id,
              role: "customer",
            });
          });
          unsubs.push(unsub);
        }
      } catch {
        // Offline or signed out mid-flight. The next mount retries; the bell is
        // a convenience layer and must never take a page down.
      }
    };

    void watch();

    return () => {
      cancelled = true;
      unsubs.forEach((u) => u());
    };
  }, [onboarded, userId, email, addNotification]);

  // The service worker was previously only registered from `/account`, because
  // that was the only page mounting `PushToggle`. Registering here means the
  // worker is live from the first page load, so a later opt-in has nothing to
  // install and the offline shell is available everywhere.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    void registerPushWorker();
  }, []);
}