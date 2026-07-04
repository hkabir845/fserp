'use client'

import { useLayoutEffect, type ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import { clearAuthIfApiOriginMismatch } from '@/lib/api'
import { BRAIN_LOGIN_PATH, isBrainAppRoute } from '@/utils/publicAuthRoutes'

export function AuthApiOriginGuard({ children }: { children: ReactNode }) {
  const pathname = usePathname()

  useLayoutEffect(() => {
    if (clearAuthIfApiOriginMismatch()) {
      const loginPath = isBrainAppRoute(pathname) ? BRAIN_LOGIN_PATH : '/login'
      window.location.replace(loginPath)
    }
  }, [pathname])

  return <>{children}</>
}
