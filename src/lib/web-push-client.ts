"use client";

/**
 * Web Push (browser only).
 *
 * Works in a real browser over HTTPS. It does NOT work inside the Android
 * WebView used by the Capacitor APK — that has no Push API and no
 * service-worker push — so `isPushSupported()` is false there and callers must
 * fall back rather than showing a dead "enable notifications" button.
 *
 * The VAPID public key is safe to ship in the bundle; the private key stays
 * server-side in VAPID_PRIVATE_KEY.
 */

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || "";

export function isPushSupported(): boolean {
  if (typeof window === "undefined") return false;
  if (!("serviceWorker" in navigator)) return false;
  if (!("PushManager" in window)) return false;
  if (!("Notification" in window)) return false;
  // Android WebView advertises a Notification object but has no real
  // implementation; Notification.permission throws or stays "denied".
  try {
    if (Notification.permission === "denied") return false;
  } catch {
    return false;
  }
  return true;
}

/** Convert the base64url VAPID key into the ArrayBuffer the Push API expects.
 *  Built over a plain ArrayBuffer (not a Node Buffer) so its type satisfies
 *  `BufferSource` without a cast. */
function urlBase64ToArrayBuffer(base64String: string): ArrayBuffer {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = typeof atob === "function" ? atob(base64) : Buffer.from(base64, "base64").toString("binary");
  const buffer = new ArrayBuffer(raw.length);
  const view = new Uint8Array(buffer);
  for (let i = 0; i < raw.length; i += 1) view[i] = raw.charCodeAt(i);
  return buffer;
}

/** Register the worker. Safe to call repeatedly. */
export async function registerPushWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return null;
  try {
    return await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  } catch {
    return null;
  }
}

export type SubscribeResult = { ok: true } | { ok: false; error: string };

/** Ask for permission and store the subscription against the signed-in user. */
export async function subscribeToPush(): Promise<SubscribeResult> {
  if (!isPushSupported()) {
    return { ok: false, error: "Push is not supported in this browser" };
  }
  if (!VAPID_PUBLIC_KEY) {
    return { ok: false, error: "Push is not configured on this deployment" };
  }

  let permission = Notification.permission;
  if (permission === "default") {
    permission = await Notification.requestPermission();
  }
  if (permission !== "granted") return { ok: false, error: "Notification permission was not granted" };

  const reg = await registerPushWorker();
  if (!reg) return { ok: false, error: "Could not register the push worker" };

  const existing = await reg.pushManager.getSubscription();
  const sub =
    existing ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToArrayBuffer(VAPID_PUBLIC_KEY),
    }));

  const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
    return { ok: false, error: "Browser returned an incomplete subscription" };
  }

  const res = await fetch("/api/push/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({
      endpoint: json.endpoint,
      p256dh: json.keys.p256dh,
      auth: json.keys.auth,
    }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    return { ok: false, error: (body as { error?: string }).error || "Could not save the subscription" };
  }
  return { ok: true };
}

/** Turn notifications off for this browser and drop the stored subscription. */
export async function unsubscribeFromPush(): Promise<void> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (!sub) return;
    await fetch("/api/push/subscribe", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ endpoint: sub.endpoint }),
    });
    await sub.unsubscribe();
  } catch {
    // Best effort — a failed unsubscribe must not break the settings screen.
  }
}
