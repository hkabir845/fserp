'use client'

import { useCallback, useEffect, useState } from 'react'
import { Download, ExternalLink, Monitor, Share, Smartphone, X } from 'lucide-react'
import {
  applyBrainPwaDocumentHead,
  detectInstallUiMode,
  isStandaloneDisplay,
  type InstallUiMode,
} from '@/lib/pwaDisplay'
import { registerBrainPwaServiceWorker } from '@/lib/pwaServiceWorker'

const DISMISS_KEY = 'fs-brain-install-dismissed'

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const COPY = {
  en: {
    title: 'Install Company Brain',
    subtitle: 'Phone, tablet, or computer — install from your browser (no app store required).',
    afterLogin: 'Log in first, then tap Install here on the Brain screen.',
    install: 'Install app',
    installed: 'App installed',
    howTo: 'How to install',
    gotIt: 'Got it',
    inApp:
      'Open this link in your main browser (Safari, Chrome, Edge) — WhatsApp/Facebook in-app browsers cannot install apps.',
    ios: 'iPhone/iPad (Safari): Share (□↑) → Add to Home Screen → Add.',
    android: 'Android (Chrome/Edge): Menu (⋮) → Install app / Add to Home screen.',
    desktop:
      'Desktop (Chrome/Edge): Click Install in the address bar, or browser menu → Install Company Brain.',
    generic: 'Use your browser menu to install or add this page to your home screen / desktop.',
    firefox: 'Firefox: Menu → Install, or bookmark this page for quick access.',
  },
  bn: {
    title: 'Company Brain ইনস্টল করুন',
    subtitle: 'ফোন, ট্যাবলেট বা কম্পিউটার — ব্রাউজার থেকে ইনস্টল (App Store/Play Store লাগবে না)।',
    afterLogin: 'আগে লগইন করুন, তারপর Brain স্ক্রিনে Install বাটনে ট্যাপ করুন।',
    install: 'অ্যাপ ইনস্টল',
    installed: 'ইনস্টল হয়েছে',
    howTo: 'ইনস্টল কীভাবে',
    gotIt: 'বুঝেছি',
    inApp:
      'মূল ব্রাউজারে খুলুন (Safari, Chrome, Edge) — WhatsApp/Facebook-এর ভিতরে ইনস্টল হয় না।',
    ios: 'iPhone/iPad (Safari): Share (□↑) → Add to Home Screen → Add।',
    android: 'Android (Chrome/Edge): Menu (⋮) → Install app / Add to Home screen।',
    desktop:
      'Desktop (Chrome/Edge): Address bar-এ Install, অথবা menu → Install Company Brain।',
    generic: 'ব্রাউজার মেনু থেকে Install বা হোম স্ক্রিন/ডেস্কটoplevelে যোগ করুন।',
    firefox: 'Firefox: Menu → Install, অথবা bookmark রাখুন।',
  },
} as const

type Props = {
  language?: 'en' | 'bn'
  /** @deprecated use /brain-app/login instead */
  onLoginScreen?: boolean
  /** Show install steps immediately (Brain login landing). */
  defaultExpanded?: boolean
}

function modeSteps(mode: InstallUiMode, t: (typeof COPY)[keyof typeof COPY]): string {
  switch (mode) {
    case 'in_app':
      return t.inApp
    case 'ios':
      return t.ios
    case 'android_manual':
      return t.android
    case 'desktop_manual':
      return t.desktop
    case 'generic':
      return t.generic
    default:
      return t.generic
  }
}

export function BrainAppInstallPrompt({
  language = 'bn',
  onLoginScreen = false,
  defaultExpanded = false,
}: Props) {
  const t = COPY[language]
  const [mounted, setMounted] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const [expanded, setExpanded] = useState(defaultExpanded)
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [mode, setMode] = useState<InstallUiMode>('generic')
  const [justInstalled, setJustInstalled] = useState(false)

  useEffect(() => {
    setMounted(true)
    try {
      if (localStorage.getItem(DISMISS_KEY) === '1') setDismissed(true)
    } catch {
      /* ignore */
    }

    applyBrainPwaDocumentHead()
    registerBrainPwaServiceWorker()

    const onBeforeInstall = (e: Event) => {
      e.preventDefault()
      setInstallPrompt(e as BeforeInstallPromptEvent)
      setMode('chromium_prompt')
    }
    const onInstalled = () => {
      setJustInstalled(true)
      setInstallPrompt(null)
      try {
        localStorage.setItem(DISMISS_KEY, '1')
      } catch {
        /* ignore */
      }
    }

    window.addEventListener('beforeinstallprompt', onBeforeInstall)
    window.addEventListener('appinstalled', onInstalled)
    setMode(detectInstallUiMode(false))

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  useEffect(() => {
    if (installPrompt) {
      setMode('chromium_prompt')
    } else if (mounted) {
      setMode((m) => (m === 'chromium_prompt' ? detectInstallUiMode(false) : m))
    }
  }, [installPrompt, mounted])

  const dismiss = useCallback(() => {
    try {
      localStorage.setItem(DISMISS_KEY, '1')
    } catch {
      /* ignore */
    }
    setDismissed(true)
  }, [])

  const handleInstall = useCallback(async () => {
    if (!installPrompt) {
      setExpanded(true)
      return
    }
    try {
      await installPrompt.prompt()
      const { outcome } = await installPrompt.userChoice
      if (outcome === 'accepted') setJustInstalled(true)
    } catch {
      setExpanded(true)
    }
    setInstallPrompt(null)
  }, [installPrompt])

  if (!mounted || dismissed || isStandaloneDisplay()) return null

  const canOneClickInstall = mode === 'chromium_prompt' && installPrompt !== null
  const steps = modeSteps(mode, t)
  const isDesktop = mode === 'desktop_manual'
  const showSteps = expanded || defaultExpanded || !canOneClickInstall

  return (
    <div
      className="mt-4 rounded-xl border border-indigo-200 bg-gradient-to-br from-indigo-50 to-violet-50 px-4 py-3 shadow-sm"
      role="region"
      aria-label={t.title}
    >
      <div className="flex items-start gap-3">
        <img
          src="/brain-app/icon-192.png"
          alt=""
          className="h-12 w-12 shrink-0 rounded-xl shadow"
          width={48}
          height={48}
        />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-indigo-950">
            {isDesktop ? (
              <Monitor className="h-4 w-4 text-indigo-600" aria-hidden />
            ) : (
              <Smartphone className="h-4 w-4 text-indigo-600" aria-hidden />
            )}
            {t.title}
          </p>
          <p className="mt-0.5 text-xs text-indigo-900/80">{t.subtitle}</p>
          {onLoginScreen ? (
            <p className="mt-1.5 text-xs text-indigo-800/90">{t.afterLogin}</p>
          ) : null}
          {showSteps && (
            <div className="mt-2 space-y-1.5 text-xs leading-relaxed text-indigo-900/90">
              {mode === 'in_app' ? (
                <p className="rounded-md bg-amber-50 px-2 py-1.5 text-amber-950">{t.inApp}</p>
              ) : null}
              <p className="flex items-start gap-1.5">
                {mode === 'ios' ? (
                  <Share className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                ) : (
                  <ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                )}
                {steps}
              </p>
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={dismiss}
          className="shrink-0 rounded-lg p-1 text-indigo-400 hover:bg-indigo-100 hover:text-indigo-700"
          aria-label="Dismiss"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {justInstalled ? (
          <p className="text-xs font-medium text-emerald-700">{t.installed}</p>
        ) : canOneClickInstall ? (
          <button
            type="button"
            onClick={() => void handleInstall()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white hover:bg-indigo-700"
          >
            <Download className="h-3.5 w-3.5" aria-hidden />
            {t.install}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => (canOneClickInstall ? void handleInstall() : setExpanded((o) => !o))}
            className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white hover:bg-indigo-700"
          >
            <Download className="h-3.5 w-3.5" aria-hidden />
            {expanded ? t.gotIt : t.howTo}
          </button>
        )}
      </div>
    </div>
  )
}
