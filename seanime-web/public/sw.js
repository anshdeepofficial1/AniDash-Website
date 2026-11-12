// Retire the legacy offline shell on this online-only PWA.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith("anidash-watch-shell-")).map(key => caches.delete(key)));
    await self.clients.claim();
    await self.registration.unregister();
  })());
});
// No fetch handler: requests use the current network deployment.
