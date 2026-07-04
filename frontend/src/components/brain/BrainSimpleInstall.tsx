'use client'

import { useCallback, useEffect, useState } from 'react'
import { Download, Share } from 'lucide-react'
import { applyBrainPwaDocumentHead, detectInstallUiMode, isIosLike, isStandaloneDisplay } from '@/lib/pwaDisplay'
import { registerPwaServiceWorker } from '@/lib/pwaServiceWorker'

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

type Props = { language?: 'en' | 'bn' }

const COPY = {
  en: {
    title: 'Step 1: Install app',
    install: 'Install Company Brain',
    ios: 'iPhone: tap Share → Add to Home Screen → Add',
    android: 'Android: tap Install above, or Menu → Install app',
    inApp: 'Open in Safari or Chrome (not WhatsApp) to install',
    installed: 'App installed — now log in below',
  },
  bn: {
    title: 'ধাপ ১: অ্যাপ ইনস্টল',
    install: 'Company Brain ইনস্টল',
    ios: 'iPhone: Share → Add to Home Screen → Add',
    android: 'Android: উপরে Install, অথবা Menu → Install app',
    inApp: 'Safari বা Chrome-এ খুলুন (WhatsApp-এ নয়)',
    installed: 'ইনস্টল হয়েছে — নিচে লগইন করুন',
  },
} as const

export function BrainSimpleInstall({ language = 'bn' }: Props) {
  const t = COPY[language]
  const [mounted, setMounted] = useState(false)
  const [prompt, setPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [installed, setInstalled] = useState(false)
  const [mode, setMode] = useState('generic')

  useEffect(() => {
    setMounted(true)
    applyBrainPwaDocumentHead()
    registerPwaServiceWorker()
    setMode(detectInstallUiMode(false))

    const onBeforeInstall = (e: Event) => {
      e.preventDefault()
      setPrompt(e as BeforeInstallPromptEvent)
      setMode('chromium_prompt')
    }
    const onInstalled = () => setInstalled(true)

    window.addEventListener('beforeinstallprompt', onBeforeInstall)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  const handleInstall = useCallback(async () => {
    if (!prompt) return
    try {
      await prompt.prompt()
      await prompt.userChoice
      setInstalled(true)
    } catch {
      /* show manual steps */
    }
    setPrompt(null)
  }, [prompt])

  if (!mounted || isStandaloneDisplay()) return null

  const hint =
    mode === 'in_app' ? t.inApp : isIosLike() || mode === 'ios' ? t.ios : mode === 'android_manual' ? t.android : t.android

  return (
    <div className="mb-6 rounded-2xl border-2 border-indigo-300 bg-indigo-50 p-4 text-center shadow-sm">
      <p className="text-sm font-bold text-indigo-950">{t.title}</p>
      {installed ? (
        <p className="mt-2 text-sm font-medium text-emerald-700">{t.installed}</p>
      ) : (
        <>
          {prompt ? (
            <button
              type="button"
              onClick={() => void handleInstall()}
              className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-3 text-base font-semibold text-white shadow hover:bg-indigo-700"
            >
              <Download className="h-5 w-5" aria-hidden />
              {t.install}
            </button>
          ) : (
            <div className="mt-3 flex items-start justify-center gap-2 rounded-lg bg-white px-3 py-2 text-left text-sm text-indigo-900">
              <Share className="mt-0.5 h-4 w-4 shrink-0 text-indigo-600" aria-hidden />
              <span>{hint}</span>
            </div>
          )}
        </>
      )}
    </div>
  )
}
