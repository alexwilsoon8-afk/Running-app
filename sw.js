// Serves from cache so the app runs without Wi-Fi, and refreshes the cache
// in the background whenever the network is available.
const CACHE = "c25k-v1";
const FILES = [
  "./",
  "index.html",
  "styles.css",
  "plan.json",
  "manifest.webmanifest",
  "js/app.js",
  "js/cues.js",
  "js/engine.js",
  "js/heart-rate.js",
  "js/store.js",
  "icons/icon-192.png",
  "icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(event.request, { ignoreSearch: true });
      const refreshed = fetch(event.request)
        .then((response) => {
          if (response.ok) cache.put(event.request, response.clone());
          return response;
        })
        .catch(() => cached);
      if (cached) {
        event.waitUntil(refreshed);
        return cached;
      }
      return refreshed;
    }),
  );
});
