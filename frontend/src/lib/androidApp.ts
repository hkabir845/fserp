/**
 * Android app download / install helpers for the login screen.
 */

const DEFAULT_APK_PATH = '/downloads/fserp.apk'

export const ANDROID_APP_LABEL = 'FS ERP'

/** Public URL to the signed release APK (same for all SaaS tenants). */
export function getAndroidApkUrl(): string {
  const fromEnv = process.env.NEXT_PUBLIC_ANDROID_APK_URL?.trim()
  if (fromEnv) return fromEnv
  return DEFAULT_APK_PATH
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

/** True when running inside the Capacitor Android/iOS shell (not the mobile browser). */
export function isCapacitorNativeApp(): boolean {
  if (typeof window === 'undefined') return false
  const cap = (window as Window & { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor
  return cap?.isNativePlatform?.() === true
}
