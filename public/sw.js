/**
 * sw.js — Service Worker (Phase 4 stub)
 *
 * Handles:
 *   - Offline caching
 *   - Web push notifications (Gargoyle alerts)
 *   - Background sync for message queue
 */

const CACHE_NAME = "neuro-librarian-v1";
const OFFLINE_URLS = ["/", "/index.html", "/offline.html"];

// Install: cache shell
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(OFFLINE_URLS))
  );
  self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch: network-first, fallback to cache
self.addEventListener("fetch", (event) => {
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});

// Push: Gargoyle safety alerts (highest priority)
self.addEventListener("push", (event) => {
  let data = { title: "Neuro-Librarian", body: "New notification" };

  try {
    data = event.data.json();
  } catch {
    data.body = event.data?.text() || data.body;
  }

  const options = {
    body: data.body,
    icon: "/icons/icon-192.png",
    badge: "/icons/badge-72.png",
    vibrate: [100], // minimal vibration — sensory neutral
    tag: data.tag || "nl-notification",
    requireInteraction: data.urgency === "high",
    silent: false, // can be overridden by user sensory settings
  };

  event.waitUntil(self.registration.showNotification(data.title, options));
});

// Notification click
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(clients.openWindow("/"));
});
