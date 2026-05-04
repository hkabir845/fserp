'use client'

import { useLayoutEffect, type ReactNode } from 'react'
import { clearAuthIfApiOriginMismatch } from '@/lib/api'

/**
 * Runs before child useEffects: clears session if tokens were issued for another API host
 * (e.g. production JWT while NEXT_PUBLIC_API_BASE_URL points at local Django).
 */
export function AuthApiOriginGuard({ children }: { children: ReactNode }) {
  useLayoutEffect(() => {
    if (clearAuthIfApiOriginMismatch()) {
      window.location.replace('/login')
    }
  }, [])
  return <>{children}</>
}
