/* Company Brain PWA service worker — scope /brain-app/ only. Installability only; no fetch intercept. */
self.addEventListener('install', (event) => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})
