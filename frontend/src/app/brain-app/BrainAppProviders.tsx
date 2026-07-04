'use client'

import { ReactNode } from 'react'
import { CompanyProvider } from '@/contexts/CompanyContext'
import { CompanyLocaleProvider } from '@/contexts/CompanyLocaleContext'

/** Brain routes share one company context (login + chat). */
export function BrainAppProviders({ children }: { children: ReactNode }) {
  return (
    <CompanyProvider>
      <CompanyLocaleProvider>{children}</CompanyLocaleProvider>
    </CompanyProvider>
  )
}
