const CACHE_NAME = "anidash-watch-shell-v8";
const SHELL = ["/", "/index.html", "/styles.css", "/app.js", "/manifest.webmanifest", "/icons/anidash-icon.png"];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(key => key.startsWith("anidash-watch-shell-") && key !== CACHE_NAME).map(key => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
  const isShellAsset =
    ["/", "/index.html", "/styles.css", "/app.js", "/manifest.webmanifest"].includes(url.pathname) ||
    url.pathname.startsWith("/icons/");
  if (!isShellAsset) return;

  // Always check the deployed version first. This prevents an old PWA cache from
  // hiding newly deployed provider integrations and UI fixes.
  event.respondWith((async () => {
    try {
      const freshRequest = new Request(request, { cache: "no-cache" });
      const response = await fetch(freshRequest);
      if (response.ok) {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(request, response.clone());
      }
      return response;
    } catch (error) {
      const cached = await caches.match(request) || await caches.match(url.pathname);
      if (cached) return cached;
      if (request.mode === "navigate") {
        const fallback = await caches.match("/index.html");
        if (fallback) return fallback;
      }
      return new Response("AniDash is offline and this resource is not cached.", {
        status: 503,
        headers: { "Content-Type": "text/plain; charset=utf-8" }
      });
    }
  })());
});
