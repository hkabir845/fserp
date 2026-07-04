'use client'

import { useLayoutEffect, type ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import { clearAuthIfApiOriginMismatch } from '@/lib/api'
import { BRAIN_LOGIN_PATH } from '@/lib/brainAppSession'

export function AuthApiOriginGuard({ children }: { children: ReactNode }) {
  const pathname = usePathname()

  useLayoutEffect(() => {
    if (clearAuthIfApiOriginMismatch()) {
      const loginPath =
        pathname === '/brain-app' || pathname?.startsWith('/brain-app/') ? BRAIN_LOGIN_PATH : '/login'
      window.location.replace(loginPath)
    }
  }, [pathname])

  return <>{children}</>
}
