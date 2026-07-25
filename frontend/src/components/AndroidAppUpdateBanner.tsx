'use client'

import { useEffect, useState } from 'react'
import { Download, X } from 'lucide-react'
import {
  fetchPublishedAndroidVersion,
  getAndroidApkUrl,
  getNativeAppInfo,
  isAndroidUpdateAvailable,
  isCapacitorNativeApp,
  type AndroidPublishedVersion,
} from '@/lib/androidApp'

const DISMISS_KEY = 'fserp.androidUpdateDismissedBuild'

/**
 * In-app banner for Capacitor users when a newer signed APK is published.
 */
export function AndroidAppUpdateBanner() {
  const [published, setPublished] = useState<AndroidPublishedVersion | null>(null)
  const [installedVersion, setInstalledVersion] = useState<string | null>(null)
  const [show, setShow] = useState(false)

  useEffect(() => {
    if (!isCapacitorNativeApp()) return

    void (async () => {
      const [pub, info] = await Promise.all([fetchPublishedAndroidVersion(), getNativeAppInfo()])
      if (!info || !isAndroidUpdateAvailable(info.build, pub)) return
      try {
        if (sessionStorage.getItem(DISMISS_KEY) === String(pub?.versionCode)) return
      } catch {
        /* ignore */
      }
      setPublished(pub)
      setInstalledVersion(info.version)
      setShow(true)
    })()
  }, [])

  if (!show || !published) return null

  const apkUrl = getAndroidApkUrl()

  return (
    <div className="sticky top-0 z-50 border-b border-amber-200 bg-amber-50 px-3 py-2 text-amber-950">
      <div className="mx-auto flex max-w-5xl items-center gap-3">
        <p className="min-w-0 flex-1 text-sm leading-snug">
          App update available: v{published.versionName}
          {installedVersion ? ` (you have v${installedVersion})` : ''}. Install over the existing app — no
          uninstall needed.
        </p>
        <a
          href={apkUrl}
          download={apkUrl.startsWith('/') ? 'fserp.apk' : undefined}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-amber-800 px-3 py-1.5 text-xs font-semibold text-white"
        >
          <Download className="h-3.5 w-3.5" aria-hidden />
          Update
        </a>
        <button
          type="button"
          aria-label="Dismiss update notice"
          className="shrink-0 rounded p-1 text-amber-800 hover:bg-amber-100"
          onClick={() => {
            try {
              sessionStorage.setItem(DISMISS_KEY, String(published.versionCode))
            } catch {
              /* ignore */
            }
            setShow(false)
          }}
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>
    </div>
  )
}
