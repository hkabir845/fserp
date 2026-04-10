'use client'

import { ReactNode } from 'react'
import { ToastProvider } from './Toast'
import { CompanyProvider } from '@/contexts/CompanyContext'
import { CompanyLocaleProvider } from '@/contexts/CompanyLocaleContext'
import { FixedBanner } from './FixedBanner'
import { PwaInstallBanner } from './PwaInstallBanner'
import { AuthApiOriginGuard } from './AuthApiOriginGuard'

export function Providers({ children }: { children: ReactNode }) {
  // Simple, safe rendering - no try-catch that might hide errors
  // If there's an error, it will show in console so we can fix it
  return (
    <ToastProvider>
      <AuthApiOriginGuard>
        <CompanyProvider>
          <CompanyLocaleProvider>
            <FixedBanner />
            <PwaInstallBanner />
            {children}
          </CompanyLocaleProvider>
        </CompanyProvider>
      </AuthApiOriginGuard>
    </ToastProvider>
  )
}














