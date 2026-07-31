// Offline support for the installed app.
//
// Network-first, cache-fallback — deliberately not cache-first. The unversioned
// filenames here already caused one stale-script bug (a cached app.js paired with
// fresh HTML), and a service worker is a far stickier cache than the browser's.
// So the network always wins when it is reachable; the cache exists for tunnels,
// dead spots and rural stretches, which a driving app hits constantly.
//
// Bump CACHE whenever the shell changes so old entries are evicted.

const CACHE = "autobahn-strava-v1";

const SHELL = [
  "./index.html",
  "./css/app.css",
  "./js/segments.js",
  "./js/places.js",
  "./js/geo.js",
  "./js/score.js",
  "./js/store.js",
  "./js/cloud.js",
  "./js/replay.js",
  "./js/app.js",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  // Leaderboard and auth traffic must never be served from a cache — a stale
  // ranking is worse than no ranking, and a cached token is useless.
  if (url.origin !== self.location.origin) return;

  e.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      })
      .catch(() =>
        caches.match(req).then((hit) => hit || caches.match("./index.html"))
      )
  );
});
