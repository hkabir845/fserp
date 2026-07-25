'use client'

import { usePathname } from 'next/navigation'
import { AndroidAppUpdateBanner } from '@/components/AndroidAppUpdateBanner'
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
    return (
      <>
        <AndroidAppUpdateBanner />
        {children}
      </>
    )
  }

  return (
    <>
      <AndroidAppUpdateBanner />
      <Layout>{children}</Layout>
    </>
  )
}
