'use client'

import { useEffect, useMemo, useState, useRef } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import Sidebar from '@/components/Sidebar'
import { MasterCompanyBanner, TenantCompanyBanner } from '@/components/MasterCompanyBanner'
import { useCompany } from '@/contexts/CompanyContext'
import api from '@/lib/api'
import { isConnectionError, safeLogError } from '@/utils/connectionError'
import {
  getFsmsErpMenuItems,
  getSaasMenuItems,
  getFilteredMenuItems,
  filterTenantBackupMenuItem,
  getSectionDefinitions,
  type ErpAppSection,
} from '@/navigation/erpAppMenu'

/**
 * Odoo-style app grid: categories with light icon tiles, no top app bar.
 * Same visibility rules as the sidebar.
 */
export default function AppsPage() {
  const router = useRouter()
  const { mode } = useCompany()
  const [userRole, setUserRole] = useState<string | null>(null)
  const [userPermissions, setUserPermissions] = useState<string[] | null>(null)
  const [companiesCount, setCompaniesCount] = useState(0)
  const [usersCount, setUsersCount] = useState(0)
  const backendUnreachableRef = useRef(false)

  const isSuperAdmin = userRole === 'super_admin'

  useEffect(() => {
    if (typeof window === 'undefined') return
    const token = localStorage.getItem('access_token')
    if (!token?.trim()) {
      router.replace('/login')
      return
    }
    const userStr = localStorage.getItem('user')
    if (userStr && userStr !== 'undefined' && userStr !== 'null') {
      try {
        const u = JSON.parse(userStr)
        if (u && typeof u === 'object') {
          setUserRole((u.role as string | undefined)?.toLowerCase() || null)
          setUserPermissions(Array.isArray((u as { permissions?: unknown }).permissions) ? (u as { permissions: string[] }).permissions : null)
        }
      } catch {
        setUserRole(null)
      }
    }
  }, [router])

  useEffect(() => {
    if (mode === 'saas_dashboard' && userRole === 'super_admin') {
      backendUnreachableRef.current = false
      const fetchCounts = async () => {
        if (backendUnreachableRef.current) return
        try {
          const opts = { timeout: 5000 }
          const [companiesResponse, usersResponse] = await Promise.all([
            api.get('/admin/companies/', opts),
            api.get('/admin/users/', { ...opts, params: { limit: 500 } }),
          ])
          if (companiesResponse.data && Array.isArray(companiesResponse.data)) {
            setCompaniesCount(companiesResponse.data.length)
          }
          if (usersResponse.data && Array.isArray(usersResponse.data)) {
            setUsersCount(usersResponse.data.length)
          }
        } catch (error: unknown) {
          if (isConnectionError(error)) {
            backendUnreachableRef.current = true
          }
          safeLogError('Error fetching counts for apps page:', error)
        }
      }
      void fetchCounts()
      const interval = setInterval(fetchCounts, 30000)
      const onStorage = (e: StorageEvent) => {
        if (e.key === 'admin_companies_updated' || e.key === 'admin_users_updated') {
          void fetchCounts()
        }
      }
      window.addEventListener('storage', onStorage)
      window.addEventListener('adminCountsUpdated', () => {
        void fetchCounts()
      })
      return () => {
        clearInterval(interval)
        window.removeEventListener('storage', onStorage)
        window.removeEventListener('adminCountsUpdated', fetchCounts)
      }
    }
  }, [mode, userRole])

  const fsmsErpMenuItems = useMemo(() => getFsmsErpMenuItems(), [])

  const saasMenuItems = useMemo(
    () => getSaasMenuItems(companiesCount, usersCount),
    [companiesCount, usersCount]
  )

  const visibleApps = useMemo(() => {
    return filterTenantBackupMenuItem(
      getFilteredMenuItems(
        userRole,
        isSuperAdmin,
        mode,
        fsmsErpMenuItems,
        saasMenuItems,
        userPermissions
      ).filter((item) => item.href !== '/apps'),
      userRole?.toLowerCase() || '',
      userPermissions
    )
  }, [userRole, userPermissions, isSuperAdmin, mode, fsmsErpMenuItems, saasMenuItems])

  const sections = useMemo(() => {
    const vis = new Set<ErpAppSection>(visibleApps.map((i) => i.section))
    return getSectionDefinitions(isSuperAdmin, mode, vis)
  }, [visibleApps, isSuperAdmin, mode])

  return (
    <div className="page-with-sidebar flex h-screen min-h-0 w-full min-w-0 max-w-full bg-gray-100">
      <Sidebar />
      <div className="min-w-0 flex min-h-0 flex-1 flex-col overflow-hidden">
        <MasterCompanyBanner />
        <TenantCompanyBanner />

        <div className="min-h-0 flex-1 overflow-y-auto bg-[#eceff2]">
          <div className="mx-auto max-w-6xl px-4 py-4 pb-10 sm:px-5 sm:py-6">
            {sections.map((section) => {
              const items = visibleApps.filter((a) => a.section === section.id)
              if (items.length === 0) return null
              return (
                <div key={section.id} className="mb-8 sm:mb-10">
                  <h2 className="mb-3 pl-0.5 text-xs font-medium uppercase tracking-wide text-gray-500">
                    {section.label}
                  </h2>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 md:grid-cols-4">
                    {items.map((item) => {
                      const Icon = item.icon
                      return (
                        <Link
                          key={`${item.href}-${item.label}`}
                          href={item.href}
                          className="group flex flex-col items-center rounded-2xl border border-gray-200/80 bg-white/90 p-4 text-center shadow-sm transition hover:border-gray-300 hover:bg-white hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-400"
                        >
                          <div
                            className={`mb-3 flex h-14 w-14 items-center justify-center rounded-2xl ${item.tileClass} transition group-hover:opacity-90 sm:h-16 sm:w-16`}
                          >
                            <Icon className="h-7 w-7 sm:h-8 sm:w-8" strokeWidth={1.75} aria-hidden />
                          </div>
                          <span className="line-clamp-2 text-sm font-medium leading-snug text-slate-700 sm:text-base">
                            {item.label}
                          </span>
                        </Link>
                      )
                    })}
                  </div>
                </div>
              )
            })}

            {visibleApps.length === 0 && (
              <p className="px-2 py-12 text-center text-sm text-gray-500">No applications available for your account.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
