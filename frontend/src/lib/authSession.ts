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
      // Browser refresh lives in the HttpOnly cookie — never keep a JS-readable copy.
      localStorage.removeItem('refresh_token')
    }
  } catch {
    /* ignore quota / private mode */
  }
}

/** Persist rotated refresh JWT for native shells (browsers use HttpOnly cookie only). */
export function writeStoredRefreshToken(token: string | null | undefined): void {
  if (typeof window === 'undefined') return
  try {
    const t = String(token || '').trim()
    if (!isCapacitorNativeApp()) {
      localStorage.removeItem('refresh_token')
      return
    }
    if (!t) {
      localStorage.removeItem('refresh_token')
      return
    }
    localStorage.setItem('refresh_token', t)
  } catch {
    /* ignore */
  }
}

export function clearStoredAccessToken(): void {
  writeStoredAccessToken('')
}

/** True when we should attempt silent refresh (access JWT and/or cookie-backed browser session). */
export function hasStoredSession(): boolean {
  if (typeof window === 'undefined') return false
  try {
    if (readStoredAccessToken()) return true
    if (localStorage.getItem('refresh_token')?.trim()) return true
    // Browser refresh lives in an HttpOnly cookie; `user` is the durable client hint.
    const user = localStorage.getItem('user')
    return Boolean(user && user !== 'undefined' && user !== 'null')
  } catch {
    return false
  }
}

/**
 * Ensure a usable access token (silent refresh via cookie when needed).
 * Returns the token, or null after clearing storage when the session is gone.
 * Prefer this over bare `readStoredAccessToken()` for page gates.
 */
export async function requireSession(): Promise<string | null> {
  const { ensureAccessTokenFresh } = await import('@/lib/api')
  return ensureAccessTokenFresh()
}
