/**
 * Pure notification logic.
 *
 * Deliberately dependency-free so it can be unit tested directly. The hook in
 * `use-notifications.ts` owns the Supabase/realtime wiring; everything here is a
 * decision function with no I/O. Same split as `stopover-core.ts`.
 */

/** Readable phrasing for the statuses a customer actually sees. Anything not
 *  listed falls back to a de-underscored status so a new status is still
 *  announced rather than silently dropped. */
const STATUS_LABEL: Record<string, string> = {
  pending: "Order received",
  payment_submitted: "Payment submitted",
  payment_confirmed: "Payment confirmed",
  preparing: "Being prepared",
  medicines_ready: "Ready for pickup",
  ready: "Ready for pickup",
  rider_assigned: "Rider assigned",
  delivering: "On the way",
  out_for_delivery: "On the way",
  delivered: "Delivered",
  cancelled: "Order cancelled",
  rejected: "Order declined",
  refunded: "Refunded",
};

export function labelForStatus(status: string): string {
  return STATUS_LABEL[status] || status.replace(/_/g, " ");
}

/**
 * The dedup decision.
 *
 * Postgres emits an UPDATE for any column change, so the same status arrives
 * repeatedly; and mounting mid-journey would otherwise announce the status an
 * order already had. Seeding `lastStatus` on arrival handles the second case,
 * `announced` handles the first.
 *
 * Mutates the two collections in place — they are per-session state, never React
 * state, and a re-render must not reset the record of what was already sent.
 */
export function decideTransition(
  lastStatus: Map<string, string>,
  announced: Set<string>,
  orderId: string,
  nextStatus: string | undefined,
): { announce: boolean; label: string } {
  if (!nextStatus) return { announce: false, label: "" };
  if (nextStatus === lastStatus.get(orderId)) return { announce: false, label: "" };

  lastStatus.set(orderId, nextStatus);

  const key = `${orderId}:${nextStatus}`;
  if (announced.has(key)) return { announce: false, label: "" };
  announced.add(key);

  return { announce: true, label: labelForStatus(nextStatus) };
}

/** One-line body shown in the bell and in the OS notification. */
export function notificationBody(
  orderId: string,
  merchantName: string | null | undefined,
  label: string,
): string {
  const who = merchantName || "Your order";
  return `${who} · #${orderId.slice(-6)} — ${label.toLowerCase()}`;
}