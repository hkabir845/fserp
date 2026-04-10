'use client'

import { useEffect } from 'react'
import { useCompany } from '@/contexts/CompanyContext'

/**
 * SaaS admin routes (/admin/companies, etc.): if the sidebar is in FSMS ERP mode,
 * switch to SaaS Dashboard so lists load instead of redirecting to /dashboard.
 */
export function useRequireSaasDashboardMode() {
  const { mode, setMode } = useCompany()
  useEffect(() => {
    if (mode === 'fsms_erp') {
      setMode('saas_dashboard')
    }
  }, [mode, setMode])
}
