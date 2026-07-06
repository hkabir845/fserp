/* FSERP service worker — PWA installability only (manifest + registered worker).
   No fetch handler: intercepting Next.js RSC/data requests caused Failed to fetch
   on app routes (e.g. employee ledger) when the passthrough network call failed. */
self.addEventListener('install', (event) => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})
