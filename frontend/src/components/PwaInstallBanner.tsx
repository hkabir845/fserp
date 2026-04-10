'use client'

import { useCallback, useEffect, useState } from 'react'
import { Download, X } from 'lucide-react'

const DISMISS_KEY = 'fs-erp-pwa-install-dismissed'

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

function isStandaloneDisplay(): boolean {
  const mq = window.matchMedia('(display-mode: standalone)')
  if (mq.matches) return true
  // iOS Safari home screen
  return (window.navigator as Navigator & { standalone?: boolean }).standalone === true
}

function isIosLike(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  if (/iPad|iPhone|iPod/.test(ua)) return true
  return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1
}

/** Bump ?v= when sw.js behavior changes so browsers pick up the new worker. */
const SERVICE_WORKER_URL = '/sw.js?v=3'

function registerServiceWorker(): void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
  const { protocol, hostname } = window.location
  const secure = protocol === 'https:' || hostname === 'localhost' || hostname === '127.0.0.1'
  if (!secure) return

  void (async () => {
    // Never control the origin with a SW in dev: stale chunks and RSC fetches → 404 / wrong MIME.
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
          // Unregister legacy /sw.js (no query) so the cross-origin-safe worker is used.
          if (u.includes('sw.js') && !u.includes('sw.js?v=')) {
            return reg.unregister()
          }
          return Promise.resolve()
        })
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
      /* non-fatal: install prompt may still appear in some setups */
    }
  })()
}

/**
 * Bottom card prompting users to install the app (Chromium `beforeinstallprompt`)
 * or add to home screen (iOS Safari). Hidden when already installed or dismissed.
 */
export function PwaInstallBanner() {
  const [mounted, setMounted] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null)
  const [showIos, setShowIos] = useState(false)
  const [iosHelpOpen, setIosHelpOpen] = useState(false)

  useEffect(() => {
    setMounted(true)
    try {
      if (localStorage.getItem(DISMISS_KEY) === '1') setDismissed(true)
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    if (!mounted || dismissed) return
    if (isStandaloneDisplay()) return

    const onInstalled = () => {
      try {
        localStorage.setItem(DISMISS_KEY, '1')
      } catch {
        /* ignore */
      }
      setDismissed(true)
      setDeferred(null)
    }
    window.addEventListener('appinstalled', onInstalled)

    registerServiceWorker()

    const isIos = isIosLike()
    setShowIos(isIos)

    if (isIos) {
      return () => window.removeEventListener('appinstalled', onInstalled)
    }

    const onBeforeInstall = (e: Event) => {
      e.preventDefault()
      setDeferred(e as BeforeInstallPromptEvent)
    }
    window.addEventListener('beforeinstallprompt', onBeforeInstall)
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [mounted, dismissed])

  const dismiss = useCallback(() => {
    try {
      localStorage.setItem(DISMISS_KEY, '1')
    } catch {
      /* ignore */
    }
    setDismissed(true)
    setDeferred(null)
    setShowIos(false)
  }, [])

  const onInstallClick = useCallback(async () => {
    if (!deferred) return
    try {
      await deferred.prompt()
      await deferred.userChoice
    } catch {
      /* user dismissed native UI or prompt failed */
    }
    setDeferred(null)
  }, [deferred])

  if (!mounted || dismissed || isStandaloneDisplay()) return null

  const showChromium = deferred !== null
  const showBanner = showChromium || showIos
  if (!showBanner) return null

  return (
    <div
      className="fixed bottom-4 left-1/2 z-[100] w-[min(100%-1.5rem,28rem)] -translate-x-1/2 rounded-2xl border border-gray-100 bg-white px-4 py-3 shadow-lg shadow-gray-200/80"
      role="region"
      aria-label="Install app"
    >
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-gray-900">Install Fuel Station ERP</p>
          <p className="mt-0.5 text-xs text-gray-500">Add to your home screen for quick access</p>
          {showIos && iosHelpOpen && (
            <p className="mt-2 text-xs leading-relaxed text-gray-600">
              Tap the Share button{' '}
              <span className="whitespace-nowrap font-medium text-gray-800">Share</span>, then{' '}
              <span className="font-medium text-gray-800">Add to Home Screen</span>.
            </p>
          )}
        </div>

        {showChromium && (
          <button
            type="button"
            onClick={onInstallClick}
            className="flex shrink-0 items-center gap-1.5 rounded-[10px] bg-blue-600 px-3 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
          >
            <Download className="h-4 w-4" aria-hidden />
            Install
          </button>
        )}

        {showIos && !showChromium && (
          <button
            type="button"
            onClick={() => setIosHelpOpen((o) => !o)}
            className="flex shrink-0 items-center gap-1.5 rounded-[10px] bg-blue-600 px-3 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
          >
            <Download className="h-4 w-4" aria-hidden />
            {iosHelpOpen ? 'Got it' : 'How to add'}
          </button>
        )}

        <button
          type="button"
          onClick={dismiss}
          className="shrink-0 rounded-lg p-1 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 focus:outline-none focus:ring-2 focus:ring-gray-300"
          aria-label="Dismiss install suggestion"
        >
          <X className="h-5 w-5" />
        </button>
      </div>
    </div>
  )
}
