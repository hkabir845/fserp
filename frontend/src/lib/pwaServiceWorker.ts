/** Bump ?v= when sw.js behavior changes so browsers pick up the new worker. */
export const SERVICE_WORKER_URL = '/sw.js?v=3'

/** Register PWA service worker (production HTTPS only). Safe on login and in-app. */
export function registerPwaServiceWorker(): void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
  const { protocol, hostname } = window.location
  const secure = protocol === 'https:' || hostname === 'localhost' || hostname === '127.0.0.1'
  if (!secure) return

  void (async () => {
    if (process.env.NODE_ENV === 'development') {
      try {
        const regs = await navigator.serviceWorker.getRegistrations()
        await Promise.all(regs.map((reg) => reg.unregister()))
        const keys = await caches.keys()
        await Promise.all(keys.map((k) => caches.delete(k)))
      } catch {
        /* ignore */
      }
      return
    }

    try {
      const regs = await navigator.serviceWorker.getRegistrations()
      await Promise.all(
        regs.map((reg) => {
          const u =
            reg.installing?.scriptURL ||
            reg.waiting?.scriptURL ||
            reg.active?.scriptURL ||
            ''
          if (u.includes('sw.js') && !u.includes('sw.js?v=')) {
            return reg.unregister()
          }
          return Promise.resolve()
        }),
      )
    } catch {
      /* ignore */
    }

    try {
      await navigator.serviceWorker.register(SERVICE_WORKER_URL, {
        scope: '/',
        updateViaCache: 'none',
      })
    } catch {
      /* non-fatal */
    }
  })()
}
