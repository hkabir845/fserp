'use client'

import { useCallback, useEffect, useState } from 'react'
import { Copy, Download, ExternalLink, Share } from 'lucide-react'
import {
  copyPageUrlForExternalBrowser,
  detectInstallUiMode,
  isInAppBrowser,
  isIosLike,
  isStandaloneDisplay,
} from '@/lib/pwaDisplay'

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

type Props = { language?: 'en' | 'bn' }

const COPY = {
  en: {
    title: 'Step 1: Install app',
    install: 'Install Company Brain',
    ios: 'iPhone/iPad: tap Share (□↑) at the bottom → Add to Home Screen → Add',
    android: 'Android: tap Install above, or Chrome menu (⋮) → Install app',
    inApp: 'WhatsApp/Facebook cannot install apps. Copy the link, open Safari or Chrome, paste it, then install.',
    copyLink: 'Copy link',
    copied: 'Link copied — paste in Safari or Chrome',
    openHint: 'Then tap Share → Add to Home Screen (iPhone) or Install app (Android)',
    installed: 'App installed — now log in below',
  },
  bn: {
    title: 'ধাপ ১: অ্যাপ ইনস্টল',
    install: 'Company Brain ইনস্টল',
    ios: 'iPhone/iPad: নিচে Share (□↑) → Add to Home Screen → Add',
    android: 'Android: উপরে Install, অথবা Chrome menu (⋮) → Install app',
    inApp: 'WhatsApp/Facebook-এ ইনস্টল হয় না। লিংক কপি করে Safari বা Chrome-এ খুলুন।',
    copyLink: 'লিংক কপি',
    copied: 'লিংক কপি হয়েছে — Safari/Chrome-এ পেস্ট করুন',
    openHint: 'তারপর Share → Add to Home Screen (iPhone) বা Install app (Android)',
    installed: 'ইনস্টল হয়েছে — নিচে লগইন করুন',
  },
} as const

export function BrainSimpleInstall({ language = 'bn' }: Props) {
  const t = COPY[language]
  const [mounted, setMounted] = useState(false)
  const [prompt, setPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [installed, setInstalled] = useState(false)
  const [mode, setMode] = useState('generic')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    setMounted(true)
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

  const handleCopyLink = useCallback(async () => {
    const ok = await copyPageUrlForExternalBrowser()
    if (ok) {
      setCopied(true)
      setTimeout(() => setCopied(false), 5000)
    }
  }, [])

  if (!mounted || isStandaloneDisplay()) return null

  const inApp = isInAppBrowser() || mode === 'in_app'
  const hint = inApp ? t.inApp : isIosLike() || mode === 'ios' ? t.ios : t.android

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
          ) : null}

          {inApp ? (
            <div className="mt-3 space-y-2">
              <button
                type="button"
                onClick={() => void handleCopyLink()}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl border-2 border-indigo-400 bg-white px-4 py-3 text-base font-semibold text-indigo-900 hover:bg-indigo-100"
              >
                {copied ? (
                  <>
                    <ExternalLink className="h-5 w-5" aria-hidden />
                    {t.copied}
                  </>
                ) : (
                  <>
                    <Copy className="h-5 w-5" aria-hidden />
                    {t.copyLink}
                  </>
                )}
              </button>
              <p className="text-xs text-indigo-800">{t.openHint}</p>
            </div>
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
