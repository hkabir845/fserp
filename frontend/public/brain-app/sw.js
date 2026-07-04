/* Company Brain PWA service worker — scope /brain-app/ only. */
self.addEventListener('install', (event) => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('fetch', (event) => {
  if (event.request.mode === 'navigate') {
    return
  }
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
