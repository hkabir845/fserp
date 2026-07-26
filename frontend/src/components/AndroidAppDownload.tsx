'use client'

import { useCallback, useEffect, useState } from 'react'
import { Download, Smartphone } from 'lucide-react'
import {
  ADIB_ANDROID_APP_LABEL,
  ANDROID_APP_LABEL,
  fetchPublishedAndroidVersion,
  getNativeAppInfo,
  getSharedAndroidApkUrl,
  isAndroidBrowser,
  isAndroidUpdateAvailable,
  isCapacitorNativeApp,
  isStandaloneDisplay,
  resolveAndroidDownload,
  type AndroidPublishedVersion,
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
 * Inside the Capacitor shell, shows an update action when a newer APK is published.
 */
export function AndroidAppDownload({ hideForBrainFlow = false }: { hideForBrainFlow?: boolean }) {
  const [apkUrl, setApkUrl] = useState(getSharedAndroidApkUrl)
  const [adibPortal, setAdibPortal] = useState(false)
  const appLabel = adibPortal ? ADIB_ANDROID_APP_LABEL : ANDROID_APP_LABEL
  const apkFileName = adibPortal ? 'fserp-adib.apk' : 'fserp.apk'
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [installed, setInstalled] = useState(false)
  const [android, setAndroid] = useState(false)
  const [nativeApp, setNativeApp] = useState(false)
  const [published, setPublished] = useState<AndroidPublishedVersion | null>(null)
  const [installedBuild, setInstalledBuild] = useState<string | null>(null)
  const [installedVersion, setInstalledVersion] = useState<string | null>(null)

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

    void (async () => {
      const download = await resolveAndroidDownload()
      setApkUrl(download.apkUrl)
      setAdibPortal(download.adib)
      const [pub, info] = await Promise.all([
        fetchPublishedAndroidVersion(download.versionUrl),
        getNativeAppInfo(),
      ])
      setPublished(pub)
      if (info) {
        setInstalledBuild(info.build)
        setInstalledVersion(info.version)
      }
    })()

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

  if (hideForBrainFlow) return null

  const updateAvailable = nativeApp && isAndroidUpdateAvailable(installedBuild, published)

  if (nativeApp) {
    if (!updateAvailable) {
      return (
        <p className="mt-4 flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Smartphone className="h-4 w-4 shrink-0" aria-hidden />
          {ANDROID_APP_LABEL}
          {installedVersion ? ` v${installedVersion}` : ''} — up to date
        </p>
      )
    }

    return (
      <div className="mt-5 border-t border-border/80 pt-5">
        <p className="mb-3 text-center text-xs font-medium uppercase tracking-wide text-amber-700">
          App update available
        </p>
        <div className="flex flex-col gap-2.5 sm:flex-row sm:flex-wrap sm:justify-center">
          <a
            href={apkUrl}
            download={apkUrl.startsWith('/') ? apkFileName : undefined}
            className={btnPrimary}
          >
            <Download className="h-5 w-5 shrink-0 sm:h-4 sm:w-4" aria-hidden />
            Update to v{published?.versionName}
          </a>
        </div>
        <p className="mt-2.5 text-center text-xs leading-relaxed text-muted-foreground">
          You have v{installedVersion}. Download and open the file, then tap Update — no uninstall needed.
        </p>
      </div>
    )
  }

  if (installed) {
    return (
      <p className="mt-4 flex items-center justify-center gap-2 text-sm text-emerald-700">
        <Smartphone className="h-4 w-4 shrink-0" aria-hidden />
        {appLabel} is installed on this device.
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
          download={apkUrl.startsWith('/') ? apkFileName : undefined}
          className={btnPrimary}
        >
          <Download className="h-5 w-5 shrink-0 sm:h-4 sm:w-4" aria-hidden />
          Download {appLabel}
          {published?.versionName ? ` v${published.versionName}` : ''}
        </a>
        {android && installPrompt ? (
          <button type="button" onClick={() => void handlePwaInstall()} className={btnSecondary}>
            <Smartphone className="h-5 w-5 shrink-0 sm:h-4 sm:w-4" aria-hidden />
            Install without download
          </button>
        ) : null}
      </div>
      <p className="mt-2.5 text-center text-xs leading-relaxed text-muted-foreground">
        {adibPortal
          ? 'Dedicated Adib Filling Station app — Aquaculture is always available. Not on Google Play.'
          : 'Direct download — not on Google Play. Same app and login for every company, including Adib Filling Station.'}
      </p>
      {android ? (
        <p className="mt-2 text-center text-xs leading-relaxed text-muted-foreground">
          After download, open the file and tap <span className="font-medium">Install</span> or{' '}
          <span className="font-medium">Update</span>. If Android asks, allow installs from your browser for
          this step only.
          {adibPortal
            ? ' This Adib build is separate from the multi-tenant FS ERP app.'
            : ' Existing FS ERP installs update in place — no uninstall needed.'}
        </p>
      ) : null}
    </div>
  )
}
