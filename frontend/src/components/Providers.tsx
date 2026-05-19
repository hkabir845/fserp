'use client'

import { ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import { ToastProvider } from './Toast'
import { CompanyProvider } from '@/contexts/CompanyContext'
import { CompanyLocaleProvider } from '@/contexts/CompanyLocaleContext'
import { FixedBanner } from './FixedBanner'
import { PwaInstallBanner } from './PwaInstallBanner'
import { AuthApiOriginGuard } from './AuthApiOriginGuard'
import { DevEnvironmentBanner } from './DevEnvironmentBanner'
import { isPublicAuthRoute } from '@/utils/publicAuthRoutes'

export function Providers({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const isPublic = isPublicAuthRoute(pathname)

  return (
    <ToastProvider>
      <AuthApiOriginGuard>
        <DevEnvironmentBanner />
        {isPublic ? (
          children
        ) : (
          <CompanyProvider>
            <CompanyLocaleProvider>
              <FixedBanner />
              <PwaInstallBanner />
              {children}
            </CompanyLocaleProvider>
          </CompanyProvider>
        )}
      </AuthApiOriginGuard>
    </ToastProvider>
  )
}
