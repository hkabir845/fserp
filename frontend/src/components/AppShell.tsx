'use client'

import { usePathname } from 'next/navigation'
import { Layout } from '@/components/Layout'

/**
 * Single place for ERP chrome (sidebar + header). Excludes auth and platform operator UI.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || ''

  if (pathname.startsWith('/login')) {
    return <>{children}</>
  }
  if (pathname.startsWith('/platform')) {
    return <>{children}</>
  }

  return <Layout>{children}</Layout>
}
