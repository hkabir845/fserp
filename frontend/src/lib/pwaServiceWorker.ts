/** Bump ?v= when sw.js behavior changes so browsers pick up the new worker. */
export const SERVICE_WORKER_URL = '/sw.js?v=6'

/** Brain PWA — scoped to /brain-app/ (separate install from full ERP). */
export const BRAIN_SERVICE_WORKER_URL = '/brain-app/sw.js?v=3'

function isSecureContext(): boolean {
  if (typeof window === 'undefined') return false
  const { protocol, hostname } = window.location
  return protocol === 'https:' || hostname === 'localhost' || hostname === '127.0.0.1'
}

function isBrainAppPath(): boolean {
  if (typeof window === 'undefined') return false
  const path = window.location.pathname || ''
  return path === '/brain-app' || path.startsWith('/brain-app/')
}

async function clearDevServiceWorkers(): Promise<void> {
  try {
    const regs = await navigator.serviceWorker.getRegistrations()
    await Promise.all(regs.map((reg) => reg.unregister()))
    const keys = await caches.keys()
    await Promise.all(keys.map((k) => caches.delete(k)))
  } catch {
    /* ignore */
  }
}

async function unregisterStaleRootWorkers(): Promise<void> {
  try {
    const current = SERVICE_WORKER_URL.split('?')[1] || ''
    const regs = await navigator.serviceWorker.getRegistrations()
    await Promise.all(
      regs.map((reg) => {
        const u =
          reg.installing?.scriptURL ||
          reg.waiting?.scriptURL ||
          reg.active?.scriptURL ||
          ''
        if (!u.includes('/sw.js') || u.includes('/brain-app/')) {
          return Promise.resolve()
        }
        if (current && u.includes(current)) {
          return Promise.resolve()
        }
        return reg.unregister()
      }),
    )
  } catch {
    /* ignore */
  }
}

/** Register Brain PWA service worker (production HTTPS only). Call on all /brain-app/* routes. */
export function registerBrainPwaServiceWorker(): void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
  if (!isSecureContext()) return

  void (async () => {
    if (process.env.NODE_ENV === 'development') {
      await clearDevServiceWorkers()
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
          // Root ERP worker conflicts with scoped Brain install — remove on brain routes.
          if (u.includes('/sw.js') && !u.includes('/brain-app/')) {
            return reg.unregister()
          }
          return Promise.resolve()
        }),
      )
    } catch {
      /* ignore */
    }

    try {
      await navigator.serviceWorker.register(BRAIN_SERVICE_WORKER_URL, {
        scope: '/brain-app',
        updateViaCache: 'none',
      })
    } catch {
      /* non-fatal */
    }
  })()
}

/** Register full ERP PWA service worker — skip on Brain routes (they use registerBrainPwaServiceWorker). */
export function registerPwaServiceWorker(): void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
  if (!isSecureContext()) return
  if (isBrainAppPath()) {
    registerBrainPwaServiceWorker()
    return
  }

  void (async () => {
    if (process.env.NODE_ENV === 'development') {
      await clearDevServiceWorkers()
      return
    }

    await unregisterStaleRootWorkers()

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
