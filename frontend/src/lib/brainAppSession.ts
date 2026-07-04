/** Company Brain PWA — login, logout, session (standalone from full ERP). */

import { invalidateCurrentCompanyCache } from '@/lib/api'
import { isAccessTokenExpired, readStoredAccessToken } from '@/lib/authSession'

export const BRAIN_LOGIN_PATH = '/brain-app/login'
export const BRAIN_HOME_PATH = '/brain-app'

export function clearBrainSession(): void {
  const keys = [
    'access_token',
    'refresh_token',
    'user',
    'superadmin_selected_company',
    'login_endpoint_cache',
  ]
  for (const key of keys) {
    try {
      localStorage.removeItem(key)
    } catch {
      /* ignore */
    }
  }
  try {
    invalidateCurrentCompanyCache()
  } catch {
    /* ignore */
  }
}

export function hasValidBrainSession(): boolean {
  const token = readStoredAccessToken()
  if (!token) return false
  return !isAccessTokenExpired(token)
}

/** Hard navigation — reliable in iOS/Android PWA standalone mode. */
export function logoutBrainApp(): void {
  clearBrainSession()
  window.location.assign(BRAIN_LOGIN_PATH)
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
