'use client'

import { ReactNode, useState } from 'react'
import { usePathname } from 'next/navigation'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ToastProvider } from './Toast'
import { CompanyProvider } from '@/contexts/CompanyContext'
import { CompanyLocaleProvider } from '@/contexts/CompanyLocaleContext'
import { SidebarNavProvider } from '@/contexts/SidebarNavContext'
import { FixedBanner } from './FixedBanner'
import { PwaInstallBanner } from './PwaInstallBanner'
import { AuthApiOriginGuard } from './AuthApiOriginGuard'
import { DevEnvironmentBanner } from './DevEnvironmentBanner'
import { isBrainAppRoute, isPublicAuthRoute } from '@/utils/publicAuthRoutes'

export function Providers({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const isPublic = isPublicAuthRoute(pathname)
  const isBrainApp = isBrainAppRoute(pathname)
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60 * 1000,
          },
        },
      }),
  )

  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
      <AuthApiOriginGuard>
        <DevEnvironmentBanner />
        {isPublic || isBrainApp ? (
          children
        ) : (
          <CompanyProvider>
            <SidebarNavProvider>
              <CompanyLocaleProvider>
                {!isBrainApp && <FixedBanner />}
                {!isBrainApp && <PwaInstallBanner />}
                {children}
              </CompanyLocaleProvider>
            </SidebarNavProvider>
          </CompanyProvider>
        )}
      </AuthApiOriginGuard>
    </ToastProvider>
    </QueryClientProvider>
  )
}
