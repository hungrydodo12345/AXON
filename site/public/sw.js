/* AXON service worker — caches the app shell (code only) so AXON opens offline.
 * It never touches vault data, message text, API calls or anything cross-origin.
 * Bump VERSION whenever any file below changes (a unit test checks the list is complete). */
const VERSION = "axon-shell-2026-10-08-2";

const SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./favicon.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/maskable-512.png",
  "./icons/apple-touch-icon.png",
  "./css/app.css",
  "./js/actions.js",
  "./js/agent.js",
  "./js/analyze.js",
  "./js/device.js",
  "./js/graph-data.js",
  "./js/graph-layout.js",
  "./js/guide.js",
  "./js/main.js",
  "./js/providers.js",
  "./js/pwa.js",
  "./js/sample.js",
  "./js/search.js",
  "./js/state.js",
  "./js/utils.js",
  "./js/vault.js",
  "./js/whatsapp.js",
  "./js/ui/ask.js",
  "./js/ui/common.js",
  "./js/ui/dialogs.js",
  "./js/ui/graph.js",
  "./js/ui/help.js",
  "./js/ui/inbox.js",
  "./js/ui/install.js",
  "./js/ui/people.js",
  "./js/ui/settings.js",
  "./js/ui/shell.js",
  "./js/ui/tour.js",
  "./js/ui/welcome.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    // cache:"reload" bypasses the HTTP cache so we never precache a stale file
    await cache.addAll(SHELL.map((u) => new Request(u, { cache: "reload" })));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith("axon-shell-") && key !== VERSION) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // AI providers etc. go straight to the network
  if (url.pathname.includes("/api/")) return; // the free-trial relay is never cached
  event.respondWith(respond(event, req));
});

async function respond(event, req) {
  const cache = await caches.open(VERSION);
  const hit = await cache.match(req, { ignoreSearch: true });
  // stale-while-revalidate: answer instantly from the cache, refresh quietly in the background
  const refresh = fetch(req).then((res) => {
    if (res && res.ok && res.type === "basic") cache.put(req, res.clone());
    return res;
  }).catch(() => null);
  if (hit) { event.waitUntil(refresh); return hit; }
  const res = await refresh;
  if (res) return res;
  if (req.mode === "navigate") return (await cache.match("./index.html")) || Response.error();
  return Response.error();
}
