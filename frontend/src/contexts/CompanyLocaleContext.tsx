'use client'

import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import api from '@/lib/api'
import { useCompany } from '@/contexts/CompanyContext'
import { isPublicAuthRoute } from '@/utils/publicAuthRoutes'
import {
  DEFAULT_COMPANY_DATE_FORMAT,
  DEFAULT_COMPANY_TIME_FORMAT,
} from '@/utils/companyLocaleFormats'
import { setTenantLocaleConfig, type TenantLocaleConfig } from '@/utils/tenantLocale'
import { DEFAULT_COMPANY_TIME_ZONE } from '@/utils/timeZones'

const CompanyLocaleContext = createContext<TenantLocaleConfig | undefined>(undefined)

const initialCtx: TenantLocaleConfig = {
  dateFormat: DEFAULT_COMPANY_DATE_FORMAT,
  timeFormat: DEFAULT_COMPANY_TIME_FORMAT,
  timeZone: DEFAULT_COMPANY_TIME_ZONE,
  stationMode: 'single',
}

export function CompanyLocaleProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const { selectedCompany } = useCompany()
  const [ctx, setCtx] = useState<TenantLocaleConfig>(initialCtx)

  useEffect(() => {
    let cancelled = false

    async function load() {
      if (typeof window === 'undefined') return
      if (isPublicAuthRoute(pathname)) {
        setTenantLocaleConfig(null)
        if (!cancelled) setCtx(initialCtx)
        return
      }
      const token = localStorage.getItem('access_token')?.trim()
      if (!token) {
        setTenantLocaleConfig(null)
        if (!cancelled) setCtx(initialCtx)
        return
      }
      try {
        const { data } = await api.get<{
          date_format?: string
          time_format?: string
          time_zone?: string
          station_mode?: string
        }>('/companies/current/')
        if (cancelled) return
        const sm = String(data?.station_mode ?? 'single').toLowerCase()
        const next: TenantLocaleConfig = {
          dateFormat: data?.date_format?.trim() || DEFAULT_COMPANY_DATE_FORMAT,
          timeFormat: data?.time_format?.trim() || DEFAULT_COMPANY_TIME_FORMAT,
          timeZone: (data?.time_zone || DEFAULT_COMPANY_TIME_ZONE).trim() || DEFAULT_COMPANY_TIME_ZONE,
          stationMode: sm === 'single' ? 'single' : 'multi',
        }
        setTenantLocaleConfig(next)
        setCtx(next)
      } catch {
        if (!cancelled) {
          setTenantLocaleConfig(null)
          setCtx(initialCtx)
        }
      }
    }

    load()

    const onStorage = (e: StorageEvent) => {
      if (e.key === 'superadmin_selected_company' || e.key === 'access_token') {
        load()
      }
    }
    /** Same-tab refresh after /company saves date/time/currency (no full reload). */
    const onCompanySettingsSaved = () => {
      load()
    }
    window.addEventListener('storage', onStorage)
    window.addEventListener('fserp-company-settings-saved', onCompanySettingsSaved)
    return () => {
      cancelled = true
      window.removeEventListener('storage', onStorage)
      window.removeEventListener('fserp-company-settings-saved', onCompanySettingsSaved)
    }
  }, [selectedCompany?.id, pathname])

  return (
    <CompanyLocaleContext.Provider value={ctx}>{children}</CompanyLocaleContext.Provider>
  )
}

export function useCompanyLocale(): TenantLocaleConfig {
  const c = useContext(CompanyLocaleContext)
  if (c === undefined) {
    return initialCtx
  }
  return c
}
