/**
 * Adib Filling Station dedicated Android APK detection + Aquaculture force-unlock.
 * Package id must stay in sync with mobile/capacitor.config.ts (FSERP_APP_FLAVOR=adib).
 */

import { getNativeAppInfo, isCapacitorNativeApp } from '@/lib/androidApp'

export const ADIB_ANDROID_APP_ID = 'com.mahasoft.fserp.adib'
export const ADIB_TENANT_HOST_MARKERS = ['adib.mahasoftcorporation.com', 'adib.localhost'] as const

let cachedAdibApp: boolean | null = null
let inflight: Promise<boolean> | null = null

export function isAdibAndroidAppId(id: string | null | undefined): boolean {
  return (id || '').trim() === ADIB_ANDROID_APP_ID
}

/** Host is the Adib tenant portal (subdomain). */
export function isAdibTenantHost(hostname?: string | null): boolean {
  if (typeof window === 'undefined' && !hostname) return false
  const host = (hostname || (typeof window !== 'undefined' ? window.location.hostname : '') || '')
    .trim()
    .toLowerCase()
  if (!host) return false
  return ADIB_TENANT_HOST_MARKERS.some((m) => host === m || host.endsWith(`.${m}`)) || host.startsWith('adib.')
}

/**
 * True inside the dedicated Adib Capacitor APK (not the multi-tenant FS ERP shell).
 * Sync — uses cache after first async probe; also true on Adib tenant host in native WebView.
 */
export function isAdibDedicatedAndroidAppSync(): boolean {
  if (cachedAdibApp != null) return cachedAdibApp
  if (typeof window === 'undefined') return false
  // Native WebView on Adib subdomain before App.getInfo resolves.
  if (isCapacitorNativeApp() && isAdibTenantHost()) return true
  return false
}

/** Resolve whether this client is the dedicated Adib Android app. */
export async function resolveIsAdibDedicatedAndroidApp(): Promise<boolean> {
  if (cachedAdibApp != null) return cachedAdibApp
  if (inflight) return inflight

  inflight = (async () => {
    try {
      if (!isCapacitorNativeApp()) {
        cachedAdibApp = false
        return false
      }
      const info = await getNativeAppInfo()
      if (isAdibAndroidAppId(info?.id)) {
        cachedAdibApp = true
        return true
      }
      // Fallback: Adib tenant URL inside any native shell.
      cachedAdibApp = isAdibTenantHost()
      return cachedAdibApp
    } catch {
      cachedAdibApp = isCapacitorNativeApp() && isAdibTenantHost()
      return cachedAdibApp
    } finally {
      inflight = null
    }
  })()

  return inflight
}

/** Force Aquaculture UI on: dedicated Adib APK or Adib portal host. */
export function shouldForceAquacultureUnlock(opts?: {
  nativeAppId?: string | null
  hostname?: string | null
}): boolean {
  if (isAdibAndroidAppId(opts?.nativeAppId)) return true
  if (cachedAdibApp) return true
  if (isAdibTenantHost(opts?.hostname)) return true
  return isAdibDedicatedAndroidAppSync()
}
