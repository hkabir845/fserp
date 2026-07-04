'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Brain, Copy, Download, ExternalLink, Smartphone, Check } from 'lucide-react'
import { useToast } from '@/components/Toast'
import { registerPwaServiceWorker } from '@/lib/pwaServiceWorker'

const COPY = {
  en: {
    title: 'Owner Brain App',
    subtitle:
      'Give owners a ChatGPT-style link — no full ERP menu. They log in once and ask anything about the business.',
    openApp: 'Open Brain App',
    copyLink: 'Copy link',
    copied: 'Link copied',
    downloadIcon: 'Download app icon',
    installTitle: 'Install on any device (browser)',
    installSteps:
      'Phone, tablet, or PC: log in → Brain screen → Install app. iPhone: Share → Add to Home Screen. Android/Chrome: Install button or menu.',
    urlLabel: 'Standalone URL',
  },
  bn: {
    title: 'মালিকের ব্রেইন অ্যাপ',
    subtitle:
      'মালিককে ChatGPT-স্টাইল লিংক দিন — পুরো ERP লাগবে না। একবার লগইন করে ব্যবসার যেকোনো প্রশ্ন করুন।',
    openApp: 'ব্রেইন অ্যাপ খুলুন',
    copyLink: 'লিংক কপি',
    copied: 'লিংক কপি হয়েছে',
    downloadIcon: 'অ্যাপ আইকন ডাউনলোড',
    installTitle: 'যেকোনো ডিভাইসে ইনস্টল (ব্রাউজার)',
    installSteps:
      'ফোন, ট্যাবলেট বা PC: লগইন → Brain স্ক্রিন → Install app। iPhone: Share → Add to Home Screen। Android/Chrome: Install বাটন বা menu।',
    urlLabel: 'স্ট্যান্ডঅ্যালোন URL',
  },
} as const

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export function BrainOwnerAppCard({ language = 'bn' }: { language?: 'en' | 'bn' }) {
  const toast = useToast()
  const t = COPY[language]
  const [copied, setCopied] = useState(false)
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null)

  const brainAppUrl = useMemo(() => {
    if (typeof window === 'undefined') return '/brain-app'
    return `${window.location.origin}/brain-app`
  }, [])

  useEffect(() => {
    registerPwaServiceWorker()
    const onBeforeInstall = (e: Event) => {
      e.preventDefault()
      setInstallPrompt(e as BeforeInstallPromptEvent)
    }
    window.addEventListener('beforeinstallprompt', onBeforeInstall)
    return () => window.removeEventListener('beforeinstallprompt', onBeforeInstall)
  }, [])

  const copyLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(brainAppUrl)
      setCopied(true)
      toast.success(t.copied)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error('Could not copy')
    }
  }, [brainAppUrl, t.copied, toast])

  const handlePwaInstall = useCallback(async () => {
    if (!installPrompt) return
    await installPrompt.prompt()
    setInstallPrompt(null)
  }, [installPrompt])

  return (
    <section className="rounded-xl border border-indigo-200 bg-gradient-to-br from-indigo-50 to-violet-50 p-5 shadow-sm">
      <div className="flex flex-wrap items-start gap-4">
        <img
          src="/brain-app/icon-192.png"
          alt="Company Brain"
          className="h-16 w-16 rounded-2xl shadow-md"
          width={64}
          height={64}
        />
        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-indigo-950">
            <Brain className="h-5 w-5 text-indigo-600" />
            {t.title}
          </h2>
          <p className="mt-1 text-sm text-indigo-900/80">{t.subtitle}</p>
        </div>
      </div>

      <div className="mt-4 rounded-lg border border-indigo-100 bg-white/80 px-3 py-2">
        <p className="text-xs font-medium text-muted-foreground">{t.urlLabel}</p>
        <p className="break-all font-mono text-sm text-foreground">{brainAppUrl}</p>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Link
          href="/brain-app"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          <ExternalLink className="h-4 w-4" />
          {t.openApp}
        </Link>
        <button
          type="button"
          onClick={() => void copyLink()}
          className="inline-flex items-center gap-2 rounded-lg border border-indigo-200 bg-white px-4 py-2 text-sm font-medium text-indigo-900 hover:bg-indigo-50"
        >
          {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
          {t.copyLink}
        </button>
        <a
          href="/brain-app/icon-512.png"
          download="company-brain-icon.png"
          className="inline-flex items-center gap-2 rounded-lg border border-indigo-200 bg-white px-4 py-2 text-sm font-medium text-indigo-900 hover:bg-indigo-50"
        >
          <Download className="h-4 w-4" />
          {t.downloadIcon}
        </a>
        {installPrompt ? (
          <button
            type="button"
            onClick={() => void handlePwaInstall()}
            className="inline-flex items-center gap-2 rounded-lg border border-indigo-200 bg-white px-4 py-2 text-sm font-medium text-indigo-900 hover:bg-indigo-50"
          >
            <Smartphone className="h-4 w-4" />
            Install app
          </button>
        ) : null}
      </div>

      <p className="mt-3 text-xs text-indigo-800/70">{t.installSteps}</p>
    </section>
  )
}
