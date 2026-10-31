// Uses the network when it can, so all the files come from one version, and
// falls back to the saved copy so the app runs without Wi-Fi.
const CACHE = "c25k-v3";
const NETWORK_WAIT_MS = 3000;
const FILES = [
  "./",
  "index.html",
  "styles.css",
  "plan.json",
  "checkinQuestions.json",
  "manifest.webmanifest",
  "js/app.js",
  "js/checkin.js",
  "js/checkin-logic.js",
  "js/cues.js",
  "js/engine.js",
  "js/heart-rate.js",
  "js/store.js",
  "icons/icon-192.png",
  "icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  const fresh = FILES.map((file) => new Request(file, { cache: "reload" }));
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(fresh)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

async function respond(event) {
  const { request } = event;
  const cache = await caches.open(CACHE);
  const cached =
    (await cache.match(request)) ?? (request.mode === "navigate" ? await cache.match("./") : undefined);
  const network = fetch(request.url, { cache: "no-cache" }).then((response) => {
    if (response.ok) cache.put(request, response.clone());
    return response;
  });
  if (!cached) return network;
  event.waitUntil(network.catch(() => {}));
  const slowNetwork = new Promise((resolve) => setTimeout(() => resolve(cached), NETWORK_WAIT_MS));
  return Promise.race([network.catch(() => cached), slowNetwork]);
}

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(respond(event));
});
