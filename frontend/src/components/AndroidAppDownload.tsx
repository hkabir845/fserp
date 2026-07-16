'use client'

import { useCallback, useEffect, useState } from 'react'
import { Download, Smartphone } from 'lucide-react'
import {
  ANDROID_APP_LABEL,
  getAndroidApkUrl,
  isAndroidBrowser,
  isCapacitorNativeApp,
  isStandaloneDisplay,
} from '@/lib/androidApp'
import { registerPwaServiceWorker } from '@/lib/pwaServiceWorker'

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const btnPrimary =
  'inline-flex w-full min-h-11 items-center justify-center gap-2 rounded-lg border border-blue-600 bg-primary px-4 py-3 text-base font-semibold text-white shadow-sm transition hover:bg-primary active:bg-blue-800 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 sm:w-auto sm:py-2.5 sm:text-sm'

const btnSecondary =
  'inline-flex w-full min-h-11 items-center justify-center gap-2 rounded-lg border border-border bg-white px-4 py-3 text-base font-semibold text-foreground shadow-sm transition hover:bg-muted/40 active:bg-muted focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 sm:w-auto sm:py-2.5 sm:text-sm'

/**
 * Login-screen Android download / install — all SaaS tenants, mobile-first touch targets.
 */
export function AndroidAppDownload({ hideForBrainFlow = false }: { hideForBrainFlow?: boolean }) {
  const apkUrl = getAndroidApkUrl()
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [installed, setInstalled] = useState(false)
  const [android, setAndroid] = useState(false)
  const [nativeApp, setNativeApp] = useState(false)

  useEffect(() => {
    setAndroid(isAndroidBrowser())
    setInstalled(isStandaloneDisplay())
    setNativeApp(isCapacitorNativeApp())
    registerPwaServiceWorker()

    const onBeforeInstall = (e: Event) => {
      e.preventDefault()
      setInstallPrompt(e as BeforeInstallPromptEvent)
    }
    const onInstalled = () => {
      setInstalled(true)
      setInstallPrompt(null)
    }

    window.addEventListener('beforeinstallprompt', onBeforeInstall)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  const handlePwaInstall = useCallback(async () => {
    if (!installPrompt) return
    await installPrompt.prompt()
    const { outcome } = await installPrompt.userChoice
    if (outcome === 'accepted') setInstalled(true)
    setInstallPrompt(null)
  }, [installPrompt])

  if (nativeApp) return null
  if (hideForBrainFlow) return null

  if (installed) {
    return (
      <p className="mt-4 flex items-center justify-center gap-2 text-sm text-emerald-700">
        <Smartphone className="h-4 w-4 shrink-0" aria-hidden />
        {ANDROID_APP_LABEL} is installed on this device.
      </p>
    )
  }

  return (
    <div className="mt-5 border-t border-border/80 pt-5">
      <p className="mb-3 text-center text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Android app
      </p>
      <div className="flex flex-col gap-2.5 sm:flex-row sm:flex-wrap sm:justify-center">
        <a
          href={apkUrl}
          download={apkUrl.startsWith('/') ? 'fserp.apk' : undefined}
          className={btnPrimary}
        >
          <Download className="h-5 w-5 shrink-0 sm:h-4 sm:w-4" aria-hidden />
          Download Android app
        </a>
        {android && installPrompt ? (
          <button type="button" onClick={() => void handlePwaInstall()} className={btnSecondary}>
            <Smartphone className="h-5 w-5 shrink-0 sm:h-4 sm:w-4" aria-hidden />
            Install without download
          </button>
        ) : null}
      </div>
      <p className="mt-2.5 text-center text-xs leading-relaxed text-muted-foreground">
        Direct download from this site — not on Google Play. Same login for every company.
      </p>
      {android ? (
        <p className="mt-2 text-center text-xs leading-relaxed text-muted-foreground">
          After download, open the file and tap <span className="font-medium">Install</span>. If Android asks, allow installs from your browser for this step only. If you already have an older FS ERP install, uninstall it first, then install this build.
        </p>
      ) : null}
    </div>
  )
}
