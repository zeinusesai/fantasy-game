/* Year 11 Interhouse — minimal, zero-risk service worker.
 * Installs instantly and passes every request straight to the network
 * (no aggressive caching) so the app can be installed to the home screen
 * while never serving stale content. */
self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(Promise.resolve());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// Network-first passthrough: no caching, no stale HTML, no breakage.
self.addEventListener("fetch", () => {
  // Intentionally not calling respondWith — the browser handles the fetch
  // normally, while the SW's presence still satisfies installability.
});
