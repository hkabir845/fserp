/** Company Brain PWA — login, logout, session (standalone from full ERP). */

import { clearAuthStorage } from '@/lib/api'
import { logoutTo } from '@/lib/auth'
import { isAccessTokenExpired, readStoredAccessToken } from '@/lib/authSession'

export const BRAIN_LOGIN_PATH = '/brain-app/login'
export const BRAIN_HOME_PATH = '/brain-app'

export function clearBrainSession(): void {
  clearAuthStorage()
}

export function hasValidBrainSession(): boolean {
  const token = readStoredAccessToken()
  if (!token) return false
  return !isAccessTokenExpired(token)
}

/** Hard navigation — reliable in iOS/Android PWA standalone mode. */
export function logoutBrainApp(): void {
  void logoutTo(BRAIN_LOGIN_PATH).catch(() => undefined)
}

export function enterBrainAppAfterLogin(): void {
  window.location.assign(BRAIN_HOME_PATH)
}

export function redirectBrainLoginIfNeeded(): void {
  if (!hasValidBrainSession()) {
    clearBrainSession()
    window.location.replace(BRAIN_LOGIN_PATH)
  }
}
