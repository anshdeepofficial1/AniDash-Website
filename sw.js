const CACHE_NAME = "anidash-watch-shell-v21";
const READER_LIB = "https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js";
const SHELL = ["/", "/index.html", "/styles.css", "/android-ui.css", "/preferences.css", "/app-parity.css", "/unslop.css", "/native-parity.css", "/catalog-polish.css", "/premium-desktop.css", "/seanime-ui.css", "/seanime-ui.js", "/library-storage.js", "/anilist-account.js", "/mal-account.js", "/cbz-reader.js", "/episode-arcs.js", "/app.js", "/manifest.webmanifest", "/icons/anidash-icon.png", "/icons/ui-sprite.svg"];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_NAME).then(async cache => {
    await cache.addAll(SHELL);
    // Reader dependency is optional at install, but cache it whenever reachable.
    // This enables opening a saved CBZ after the user goes offline.
    try { await cache.add(READER_LIB); } catch (_) {}
  }));
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
  if (request.method !== "GET") return;
  if (url.href === READER_LIB) {
    event.respondWith(fetch(request).then(async response => {
      if (response.ok) {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(request, response.clone());
      }
      return response;
    }).catch(async () => await caches.match(request) ||
      new Response("Offline reader library unavailable", { status: 503 })));
    return;
  }
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
  // Path-based PWA deep links need the app shell when offline. A network-first
  // navigation keeps new deployments fresh while allowing offline reopening.
  if (request.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const response = await fetch(new Request(request, { cache: "no-cache" }));
        if (response.ok) return response;
        return response;
      } catch (_) {
        const shell = await caches.match("/") || await caches.match("/index.html");
        if (shell) return shell;
        return new Response("AniDash app shell is not cached for offline access.", {
          status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" }
        });
      }
    })());
    return;
  }
  const isShellAsset =
    ["/", "/index.html", "/styles.css", "/android-ui.css", "/preferences.css", "/app-parity.css", "/unslop.css", "/native-parity.css", "/catalog-polish.css", "/premium-desktop.css", "/seanime-ui.css", "/seanime-ui.js", "/library-storage.js", "/anilist-account.js", "/mal-account.js", "/cbz-reader.js", "/episode-arcs.js", "/app.js", "/manifest.webmanifest"].includes(url.pathname) ||
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
