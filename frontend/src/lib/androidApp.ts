/**
 * Android app download / install helpers for the login screen and in-app updates.
 */

const DEFAULT_APK_PATH = '/downloads/fserp.apk'
const DEFAULT_ADIB_APK_PATH = '/downloads/fserp-adib.apk'
const DEFAULT_VERSION_PATH = '/downloads/android-version.json'
const DEFAULT_ADIB_VERSION_PATH = '/downloads/android-adib-version.json'

export const ANDROID_APP_LABEL = 'FS ERP'
export const ADIB_ANDROID_APP_LABEL = 'Adib FS ERP'

export type AndroidPublishedVersion = {
  versionCode: number
  versionName: string
}

export type NativeAppInfo = {
  version: string
  build: string
  id: string
  name: string
}

function isAdibPortalHost(): boolean {
  if (typeof window === 'undefined') return false
  const host = window.location.hostname.toLowerCase()
  return host === 'adib.mahasoftcorporation.com' || host.startsWith('adib.')
}

/** Public URL to the signed release APK (Adib portal prefers the dedicated APK). */
export function getAndroidApkUrl(): string {
  if (isAdibPortalHost()) {
    const adibEnv = process.env.NEXT_PUBLIC_ANDROID_ADIB_APK_URL?.trim()
    if (adibEnv) return adibEnv
    return DEFAULT_ADIB_APK_PATH
  }
  const fromEnv = process.env.NEXT_PUBLIC_ANDROID_APK_URL?.trim()
  if (fromEnv) return fromEnv
  return DEFAULT_APK_PATH
}

/** Public URL to published APK version metadata. */
export function getAndroidVersionUrl(): string {
  if (isAdibPortalHost()) {
    const adibEnv = process.env.NEXT_PUBLIC_ANDROID_ADIB_VERSION_URL?.trim()
    if (adibEnv) return adibEnv
    const apkUrl = getAndroidApkUrl()
    if (apkUrl.startsWith('http')) {
      return apkUrl.replace(/\/[^/]*$/, '/android-adib-version.json')
    }
    return DEFAULT_ADIB_VERSION_PATH
  }
  const fromEnv = process.env.NEXT_PUBLIC_ANDROID_VERSION_URL?.trim()
  if (fromEnv) return fromEnv
  const apkUrl = getAndroidApkUrl()
  if (apkUrl.startsWith('http')) {
    return apkUrl.replace(/\/[^/]*$/, '/android-version.json')
  }
  return DEFAULT_VERSION_PATH
}

export function isAndroidBrowser(): boolean {
  if (typeof navigator === 'undefined') return false
  return /Android/i.test(navigator.userAgent)
}

export function isStandaloneDisplay(): boolean {
  if (typeof window === 'undefined') return false
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  )
}

type CapacitorBridge = {
  isNativePlatform?: () => boolean
  Plugins?: {
    App?: {
      getInfo?: () => Promise<NativeAppInfo>
    }
  }
}

function getCapacitor(): CapacitorBridge | undefined {
  if (typeof window === 'undefined') return undefined
  return (window as Window & { Capacitor?: CapacitorBridge }).Capacitor
}

/** True when running inside the Capacitor Android/iOS shell (not the mobile browser). */
export function isCapacitorNativeApp(): boolean {
  const cap = getCapacitor()
  return cap?.isNativePlatform?.() === true
}

/** Installed native app info from @capacitor/app (null in browser). */
export async function getNativeAppInfo(): Promise<NativeAppInfo | null> {
  const cap = getCapacitor()
  if (!cap?.isNativePlatform?.()) return null
  try {
    const info = await cap.Plugins?.App?.getInfo?.()
    return info ?? null
  } catch {
    return null
  }
}

export async function fetchPublishedAndroidVersion(): Promise<AndroidPublishedVersion | null> {
  try {
    const res = await fetch(getAndroidVersionUrl(), { cache: 'no-store' })
    if (!res.ok) return null
    const data = (await res.json()) as Partial<AndroidPublishedVersion>
    const versionCode = Number(data.versionCode)
    const versionName = String(data.versionName ?? '').trim()
    if (!Number.isFinite(versionCode) || versionCode < 1 || !versionName) return null
    return { versionCode, versionName }
  } catch {
    return null
  }
}

/** True when the installed build is older than the published APK. */
export function isAndroidUpdateAvailable(
  installedBuild: string | number | null | undefined,
  published: AndroidPublishedVersion | null
): boolean {
  if (!published) return false
  const installed = Number(installedBuild)
  if (!Number.isFinite(installed)) return false
  return published.versionCode > installed
}
