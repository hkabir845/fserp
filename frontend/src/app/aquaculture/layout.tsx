'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import Sidebar from '@/components/Sidebar'
import { MasterCompanyBanner, TenantCompanyBanner } from '@/components/MasterCompanyBanner'
import { useCompany } from '@/contexts/CompanyContext'
import { useCompanyLocale } from '@/contexts/CompanyLocaleContext'
import api, { fetchCurrentCompany } from '@/lib/api'
import { aquacultureT } from '@/lib/aquacultureI18n'
import { isAquacultureNavUnlocked } from '@/navigation/erpAppMenu'
import { ShieldAlert } from 'lucide-react'

function readSessionRoleAndPermissions(): {
  role: string | null
  permissions: string[] | null
} {
  if (typeof window === 'undefined') return { role: null, permissions: null }
  try {
    const raw = localStorage.getItem('user')
    if (!raw || raw === 'undefined' || raw === 'null') return { role: null, permissions: null }
    const u = JSON.parse(raw) as { role?: string; permissions?: unknown }
    const role = typeof u.role === 'string' ? u.role.toLowerCase() : null
    const permissions = Array.isArray(u.permissions) ? (u.permissions as string[]) : null
    return { role, permissions }
  } catch {
    return { role: null, permissions: null }
  }
}

export default function AquacultureLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const { mode } = useCompany()
  const { language: lang } = useCompanyLocale()
  const [ready, setReady] = useState(false)
  const [enabled, setEnabled] = useState(false)
  const [navUnlocked, setNavUnlocked] = useState(false)

  const evaluateAccess = useCallback(async () => {
    const token = localStorage.getItem('access_token')
    if (!token) {
      router.replace('/login')
      return
    }
    const { role, permissions } = readSessionRoleAndPermissions()
    const isSuperAdmin = role === 'super_admin'
    try {
      const data = await fetchCurrentCompany()
      const aq = Boolean(data?.aquaculture_enabled)
      setEnabled(aq)
      setNavUnlocked(isAquacultureNavUnlocked(role, isSuperAdmin, mode, permissions, aq))
    } catch {
      setEnabled(false)
      setNavUnlocked(false)
    } finally {
      setReady(true)
    }
  }, [router, mode])

  useEffect(() => {
    void evaluateAccess()
  }, [evaluateAccess])

  useEffect(() => {
    const onSaved = () => void evaluateAccess()
    if (typeof window !== 'undefined') {
      window.addEventListener('fserp-company-settings-saved', onSaved)
    }
    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('fserp-company-settings-saved', onSaved)
      }
    }
  }, [evaluateAccess])

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted/40">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-border border-t-primary" />
      </div>
    )
  }

  if (!enabled) {
    return (
      <div className="page-with-sidebar flex min-h-screen bg-muted/40">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <MasterCompanyBanner />
          <TenantCompanyBanner />
          <main className="flex-1 p-6 sm:p-10" role="main">
            <div className="mx-auto max-w-lg rounded-xl border border-warning/30/80 bg-warning/10/90 p-6 text-warning-foreground shadow-sm">
              <h1 className="text-lg font-semibold tracking-tight text-warning-foreground">
                {aquacultureT('aqNotActiveTitle', lang)}
              </h1>
              <p className="mt-2 text-sm leading-relaxed text-warning-foreground/95">
                {aquacultureT('aqNotActiveBody', lang)}
              </p>
              <Link
                href="/company"
                className="mt-4 inline-block text-sm font-medium text-primary underline decoration-teal-600/40 underline-offset-2 hover:decoration-teal-900"
              >
                {aquacultureT('companySettings', lang)}
              </Link>
            </div>
          </main>
        </div>
      </div>
    )
  }

  if (!navUnlocked) {
    return (
      <div className="page-with-sidebar flex min-h-screen bg-muted/40">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <MasterCompanyBanner />
          <TenantCompanyBanner />
          <main className="flex-1 p-6 sm:p-10" role="main">
            <div className="mx-auto max-w-lg rounded-xl border border-border bg-white p-6 shadow-sm">
              <div className="flex items-start gap-3">
                <div className="rounded-lg bg-muted p-2 text-foreground/85" aria-hidden>
                  <ShieldAlert className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <h1 className="text-lg font-semibold tracking-tight text-foreground">
                    {aquacultureT('accessRestricted', lang)}
                  </h1>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    {aquacultureT('aqAccessRestrictedBody', lang)}
                  </p>
                  <div className="mt-4 flex flex-wrap gap-3 text-sm font-medium">
                    <Link href="/users" className="text-primary underline decoration-teal-600/40 underline-offset-2">
                      {aquacultureT('users', lang)}
                    </Link>
                    <Link href="/apps" className="text-foreground/85 underline decoration-slate-400 underline-offset-2">
                      {aquacultureT('apps', lang)}
                    </Link>
                  </div>
                </div>
              </div>
            </div>
          </main>
        </div>
      </div>
    )
  }

  return (
    <div className="page-with-sidebar flex h-dvh max-h-dvh min-h-0 w-full min-w-0 max-w-full flex-row bg-muted/40">
      <Sidebar />
      <div className="erp-main-column flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <MasterCompanyBanner />
        <TenantCompanyBanner />
        <main id="aquaculture-workspace" className="min-h-0 flex-1 overflow-y-auto overscroll-contain outline-none" role="main">
          {children}
        </main>
      </div>
    </div>
  )
}
