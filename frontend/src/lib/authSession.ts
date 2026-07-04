/** Client-side JWT helpers — avoid 401 storms when access token is expired. */

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
    const t = localStorage.getItem('access_token')?.trim()
    if (!t || t === 'undefined' || t === 'null') return ''
    return t
  } catch {
    return ''
  }
}

export function hasStoredSession(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return Boolean(readStoredAccessToken() || localStorage.getItem('refresh_token')?.trim())
  } catch {
    return false
  }
}
