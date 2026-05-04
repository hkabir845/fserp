/* FSERP service worker v3 — PWA installability; does not intercept cross-origin (API) fetches. */
self.addEventListener('install', (event) => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('fetch', (event) => {
  // Do not intercept document navigations — a bare fetch() passthrough can reject
  // (e.g. dev / RSC) and break the page.
  if (event.request.mode === 'navigate') {
    return
  }
  // Do not intercept cross-origin requests (e.g. API on another subdomain). Passing them
  // through the SW can surface CORS failures as net::ERR_FAILED in the console.
  try {
    const url = new URL(event.request.url)
    if (url.origin !== self.location.origin) {
      return
    }
  } catch {
    return
  }
  event.respondWith(fetch(event.request))
})
