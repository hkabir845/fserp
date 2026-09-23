'use client'

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { ensureAccessTokenFresh } from '@/lib/api'
import { hasStoredSession, isAccessTokenExpired, readStoredAccessToken } from '@/lib/authSession'
import { isPublicAuthRoute } from '@/utils/publicAuthRoutes'

/**
 * Quietly renew the access JWT before it expires so long forms / idle screens
 * do not hit a hard logout mid-operation.
 */
export function SessionKeepAlive() {
  const pathname = usePathname()

  useEffect(() => {
    if (isPublicAuthRoute(pathname)) return
    if (typeof window === 'undefined') return

    let cancelled = false

    const tick = () => {
      if (cancelled || document.visibilityState === 'hidden') return
      if (!hasStoredSession()) return
      const token = readStoredAccessToken()
      // Refresh when within ~5 minutes of expiry (or already in skew window).
      if (!token || isAccessTokenExpired(token, 5 * 60)) {
        void ensureAccessTokenFresh().catch(() => undefined)
      }
    }

    tick()
    const id = window.setInterval(tick, 60_000)
    const onVis = () => {
      if (document.visibilityState === 'visible') tick()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      cancelled = true
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [pathname])

  return null
}
