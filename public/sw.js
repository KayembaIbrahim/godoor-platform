const CACHE_NAME = "godoor-v1";
const OFFLINE_URLS = ["/", "/app", "/orders", "/account"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE_NAME).then((c) => c.addAll(OFFLINE_URLS)));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
});

/* ── Web Push ───────────────────────────────────────────────────────
   Only real browsers reach this. An Android WebView (the Capacitor APK)
   supports neither the Push API nor service-worker push, so the APK path
   needs @capacitor/push-notifications instead — see docs. */

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: "GoDoor", body: event.data ? event.data.text() : "You have an update." };
  }

  const title = payload.title || "GoDoor";
  const options = {
    body: payload.body || "",
    icon: payload.icon || "/icons/icon-192.png",
    badge: payload.badge || "/icons/badge-72.png",
    tag: payload.tag || "godoor",
    renotify: true,
    data: payload.data || {},
    actions: payload.actions || [{ action: "open", title: "View" }],
    vibrate: [80, 40, 80],
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

/* Tapping the notification focuses an existing GoDoor tab and routes it to the
   order or ride, rather than opening a second copy of the app. */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = event.notification.data && event.notification.data.url;

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ("focus" in client) {
          if (target && client.navigate) return client.navigate(target).then((c) => c.focus());
          return client.focus();
        }
      }
      return target ? self.clients.openWindow(target) : self.clients.openWindow("/app");
    }),
  );
});
