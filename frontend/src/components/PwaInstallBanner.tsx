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

import { registerPwaServiceWorker } from '@/lib/pwaServiceWorker'

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

    registerPwaServiceWorker()

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
      className="fixed bottom-4 left-1/2 z-[100] w-[min(100%-1.5rem,28rem)] -translate-x-1/2 rounded-2xl border border-border/70 bg-white px-4 py-3 shadow-lg shadow-gray-200/80"
      role="region"
      aria-label="Install app"
    >
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">Install Fuel Station ERP</p>
          <p className="mt-0.5 text-xs text-muted-foreground">Add to your home screen for quick access</p>
          {showIos && iosHelpOpen && (
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              Tap the Share button{' '}
              <span className="whitespace-nowrap font-medium text-foreground">Share</span>, then{' '}
              <span className="font-medium text-foreground">Add to Home Screen</span>.
            </p>
          )}
        </div>

        {showChromium && (
          <button
            type="button"
            onClick={onInstallClick}
            className="flex shrink-0 items-center gap-1.5 rounded-[10px] bg-primary px-3 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-primary focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
          >
            <Download className="h-4 w-4" aria-hidden />
            Install
          </button>
        )}

        {showIos && !showChromium && (
          <button
            type="button"
            onClick={() => setIosHelpOpen((o) => !o)}
            className="flex shrink-0 items-center gap-1.5 rounded-[10px] bg-primary px-3 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-primary focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
          >
            <Download className="h-4 w-4" aria-hidden />
            {iosHelpOpen ? 'Got it' : 'How to add'}
          </button>
        )}

        <button
          type="button"
          onClick={dismiss}
          className="shrink-0 rounded-lg p-1 text-muted-foreground/70 transition hover:bg-muted hover:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-gray-300"
          aria-label="Dismiss install suggestion"
        >
          <X className="h-5 w-5" />
        </button>
      </div>
    </div>
  )
}
