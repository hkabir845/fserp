/** Company Brain PWA — login, logout, session (standalone from full ERP). */

import { clearAuthStorage, ensureAccessTokenFresh } from '@/lib/api'
import { logoutTo } from '@/lib/auth'
import { hasStoredSession, isAccessTokenExpired, readStoredAccessToken } from '@/lib/authSession'

export const BRAIN_LOGIN_PATH = '/brain-app/login'
export const BRAIN_HOME_PATH = '/brain-app'

export function clearBrainSession(): void {
  clearAuthStorage()
}

export function hasValidBrainSession(): boolean {
  const token = readStoredAccessToken()
  if (token && !isAccessTokenExpired(token)) return true
  // Cookie-backed browser session may still be valid (access is per-tab sessionStorage).
  return hasStoredSession()
}

/** Hard navigation — reliable in iOS/Android PWA standalone mode. */
export function logoutBrainApp(): void {
  void logoutTo(BRAIN_LOGIN_PATH).catch(() => undefined)
}

export function enterBrainAppAfterLogin(): void {
  window.location.assign(BRAIN_HOME_PATH)
}

export function redirectBrainLoginIfNeeded(): void {
  void (async () => {
    const token = await ensureAccessTokenFresh()
    if (!token) {
      clearBrainSession()
      window.location.replace(BRAIN_LOGIN_PATH)
    }
  })()
}
