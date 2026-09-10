/** Client-side JWT helpers — avoid 401 storms when access token is expired. */

import { isCapacitorNativeApp } from '@/lib/androidApp'

const ACCESS_TOKEN_KEY = 'access_token'

function storage(): Storage | null {
  if (typeof window === 'undefined') return null
  try {
    // Native shells need persistence across process death; browsers keep access in
    // sessionStorage so a closed tab does not leave a long-lived XSS-readable token.
    return isCapacitorNativeApp() ? window.localStorage : window.sessionStorage
  } catch {
    return null
  }
}

export function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const t = (token || '').trim()
  if (!t) return null
  const parts = t.split('.')
  if (parts.length < 2) return null
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
    if (typeof atob === 'undefined') return null
    const json = atob(padded)
    const parsed = JSON.parse(json) as Record<string, unknown>
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

/** True when access token is missing, malformed, or past exp (with skew). */
export function isAccessTokenExpired(token: string, skewSeconds = 45): boolean {
  const payload = decodeJwtPayload(token)
  if (!payload) return true
  if (payload.type && payload.type !== 'access') return true
  const exp = payload.exp
  if (typeof exp !== 'number' || !Number.isFinite(exp)) return false
  const now = Math.floor(Date.now() / 1000)
  return exp <= now + skewSeconds
}

export function readStoredAccessToken(): string {
  if (typeof window === 'undefined') return ''
  try {
    const primary = storage()
    let t = primary?.getItem(ACCESS_TOKEN_KEY)?.trim() || ''
    if (!t || t === 'undefined' || t === 'null') {
      // One-time migrate away from legacy localStorage browser sessions.
      t = localStorage.getItem(ACCESS_TOKEN_KEY)?.trim() || ''
      if (t && t !== 'undefined' && t !== 'null') {
        writeStoredAccessToken(t)
        if (!isCapacitorNativeApp()) {
          localStorage.removeItem(ACCESS_TOKEN_KEY)
        }
      } else {
        return ''
      }
    }
    return t
  } catch {
    return ''
  }
}

export function writeStoredAccessToken(token: string): void {
  if (typeof window === 'undefined') return
  const t = String(token || '').trim()
  try {
    const store = storage()
    if (!store) return
    if (!t) {
      store.removeItem(ACCESS_TOKEN_KEY)
      localStorage.removeItem(ACCESS_TOKEN_KEY)
      return
    }
    store.setItem(ACCESS_TOKEN_KEY, t)
    if (!isCapacitorNativeApp()) {
      localStorage.removeItem(ACCESS_TOKEN_KEY)
      localStorage.removeItem('refresh_token')
    }
  } catch {
    /* ignore quota / private mode */
  }
}

export function clearStoredAccessToken(): void {
  writeStoredAccessToken('')
}

export function hasStoredSession(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return Boolean(readStoredAccessToken() || localStorage.getItem('refresh_token')?.trim())
  } catch {
    return false
  }
}
