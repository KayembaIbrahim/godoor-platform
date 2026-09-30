import webpush from "web-push";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Server-side Web Push delivery.
 *
 * VAPID_PRIVATE_KEY lives only in the server environment. A 404/410 from a push
 * service means the browser dropped the subscription, so those rows are deleted
 * rather than retried forever.
 */

const VAPID_PUBLIC = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || "";
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY || "";
const SUBJECT = process.env.VAPID_SUBJECT || "mailto:support@godoor.site";

let configured = false;
function ensureConfigured(): boolean {
  if (configured) return true;
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) return false;
  webpush.setVapidDetails(SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
  configured = true;
  return true;
}

export function pushConfigured(): boolean {
  return Boolean(VAPID_PUBLIC && VAPID_PRIVATE);
}

export type PushPayload = {
  title: string;
  body: string;
  /** Where tapping the notification should navigate, e.g. /tracking?orderId=… */
  url?: string;
  tag?: string;
  icon?: string;
  badge?: string;
};

export type SendResult = { sent: number; pruned: number; failed: number };

/** Send a push to every browser registered for one user. */
export async function pushToUser(
  sb: SupabaseClient,
  userId: string,
  payload: PushPayload,
): Promise<SendResult> {
  const result: SendResult = { sent: 0, pruned: 0, failed: 0 };
  if (!ensureConfigured()) return result;

  const { data: subs, error } = await sb
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("user_id", userId);
  if (error || !subs?.length) return result;

  const body = JSON.stringify({
    title: payload.title,
    body: payload.body,
    url: payload.url,
    tag: payload.tag,
    icon: payload.icon,
    badge: payload.badge,
    data: { url: payload.url || "/app" },
  });

  const stale: string[] = [];

  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          body,
          { TTL: 60 * 60, urgency: "high" },
        );
        result.sent += 1;
      } catch (e) {
        const statusCode = (e as { statusCode?: number }).statusCode;
        if (statusCode === 404 || statusCode === 410) {
          // Browser unsubscribed or the subscription expired.
          stale.push(s.id);
        } else {
          result.failed += 1;
        }
      }
    }),
  );

  if (stale.length) {
    await sb.from("push_subscriptions").delete().in("id", stale);
    result.pruned += stale.length;
  }

  return result;
}

/** Fan a push out to several users (e.g. every rider with an open ride). */
export async function pushToUsers(
  sb: SupabaseClient,
  userIds: string[],
  payload: PushPayload,
): Promise<SendResult> {
  const totals: SendResult = { sent: 0, pruned: 0, failed: 0 };
  for (const id of userIds) {
    const r = await pushToUser(sb, id, payload);
    totals.sent += r.sent;
    totals.pruned += r.pruned;
    totals.failed += r.failed;
  }
  return totals;
}
