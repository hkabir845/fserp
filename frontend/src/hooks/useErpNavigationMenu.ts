'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import api from '@/lib/api'
import { useCompany } from '@/contexts/CompanyContext'
import { isConnectionError, safeLogError } from '@/utils/connectionError'
import { resolveActiveNavHref } from '@/utils/navPath'
import {
  MENU_SECTION_SEARCH_HINTS,
  getFsmsErpMenuItems,
  getSaasMenuItems,
  getFilteredMenuItems,
  filterAquacultureMenuWhenDisabled,
  filterTenantBackupMenuItem,
  getSectionDefinitions,
  type ErpAppMenuItem,
  type ErpAppSection,
} from '@/navigation/erpAppMenu'
import { useCompanyLocale } from '@/contexts/CompanyLocaleContext'

type UseErpNavigationMenuOptions = {
  /** Hide entries (e.g. `/apps` on the app launcher page). */
  excludeHrefs?: string[]
  /** Sidebar menu search; omit on Apps grid. */
  searchQuery?: string
}

export function useErpNavigationMenu(options: UseErpNavigationMenuOptions = {}) {
  const { excludeHrefs = [], searchQuery = '' } = options
  const pathname = usePathname()
  const { mode, selectedCompany, isClientReady } = useCompany()
  const { language } = useCompanyLocale()

  const [userRole, setUserRole] = useState<string | null>(null)
  const [userPermissions, setUserPermissions] = useState<string[] | null>(null)
  const [navSessionReady, setNavSessionReady] = useState(false)
  const [companiesCount, setCompaniesCount] = useState(0)
  const [usersCount, setUsersCount] = useState(0)
  const [aquacultureEnabled, setAquacultureEnabled] = useState(false)

  const excludeSet = useMemo(() => new Set(excludeHrefs), [excludeHrefs])

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const userStr = localStorage.getItem('user')
      if (userStr && userStr !== 'undefined' && userStr !== 'null') {
        const parsedUser = JSON.parse(userStr)
        if (parsedUser && typeof parsedUser === 'object') {
          setUserRole(parsedUser.role?.toLowerCase() || null)
          setUserPermissions(
            Array.isArray((parsedUser as { permissions?: unknown }).permissions)
              ? (parsedUser as { permissions: string[] }).permissions
              : null
          )
        }
      }
    } catch (error) {
      console.error('Error parsing user data:', error)
    } finally {
      setNavSessionReady(true)
    }
  }, [])

  const backendUnreachableRef = useRef(false)
  useEffect(() => {
    if (mode !== 'saas_dashboard' || userRole !== 'super_admin') return

    backendUnreachableRef.current = false
    const fetchCounts = async () => {
      if (backendUnreachableRef.current) return
      try {
        const opts = { timeout: 5000 }
        const [companiesResponse, usersResponse] = await Promise.all([
          api.get('/admin/companies/', opts),
          api.get('/admin/users/', { ...opts, params: { limit: 500 } }),
        ])
        if (Array.isArray(companiesResponse.data)) {
          setCompaniesCount(companiesResponse.data.length)
        }
        if (Array.isArray(usersResponse.data)) {
          setUsersCount(usersResponse.data.length)
        }
      } catch (error: unknown) {
        if (isConnectionError(error)) {
          backendUnreachableRef.current = true
        }
        safeLogError('Error fetching admin menu counts:', error)
      }
    }

    void fetchCounts()
    const interval = setInterval(fetchCounts, 30000)
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'admin_companies_updated' || e.key === 'admin_users_updated') {
        void fetchCounts()
      }
    }
    const onAdminCounts = () => void fetchCounts()
    window.addEventListener('storage', onStorage)
    window.addEventListener('adminCountsUpdated', onAdminCounts)
    return () => {
      clearInterval(interval)
      window.removeEventListener('storage', onStorage)
      window.removeEventListener('adminCountsUpdated', onAdminCounts)
    }
  }, [mode, userRole])

  useEffect(() => {
    const fetchAq = async () => {
      if (mode !== 'fsms_erp') {
        setAquacultureEnabled(false)
        return
      }
      const token = localStorage.getItem('access_token')
      if (!token) {
        setAquacultureEnabled(false)
        return
      }
      try {
        const { data } = await api.get<Record<string, unknown>>('/companies/current/')
        setAquacultureEnabled(Boolean(data?.aquaculture_enabled))
      } catch {
        setAquacultureEnabled(false)
      }
    }
    void fetchAq()
    const onSaved = () => void fetchAq()
    window.addEventListener('fserp-company-settings-saved', onSaved)
    return () => window.removeEventListener('fserp-company-settings-saved', onSaved)
  }, [mode, selectedCompany?.id, pathname])

  const isSuperAdmin = userRole === 'super_admin'
  const navReady = isClientReady && navSessionReady

  const fsmsErpMenuItems = useMemo(() => getFsmsErpMenuItems(language), [language])
  const saasMenuItems = useMemo(
    () => getSaasMenuItems(companiesCount, usersCount, language),
    [companiesCount, usersCount, language]
  )

  const filteredMenuItems = useMemo(() => {
    const items = filterAquacultureMenuWhenDisabled(
      filterTenantBackupMenuItem(
        getFilteredMenuItems(
          userRole,
          isSuperAdmin,
          mode,
          fsmsErpMenuItems,
          saasMenuItems,
          userPermissions
        ),
        userRole?.toLowerCase() || '',
        userPermissions
      ),
      aquacultureEnabled,
      userRole,
      isSuperAdmin,
      userPermissions
    )
    if (!excludeSet.size) return items
    return items.filter((item) => !excludeSet.has(item.href))
  }, [
    userRole,
    userPermissions,
    isSuperAdmin,
    mode,
    fsmsErpMenuItems,
    saasMenuItems,
    aquacultureEnabled,
    excludeSet,
  ])

  const menuItemsForNav = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return filteredMenuItems
    // Rank matches by relevance so the closest match surfaces first:
    // exact label > label prefix > word-start > label substring > href > section hint.
    const scored = filteredMenuItems
      .map((item: ErpAppMenuItem) => {
        const label = item.label.toLowerCase()
        const labelPlain = label.replace(/\s*\(\d+\)\s*/g, ' ').replace(/\s+/g, ' ').trim()
        const href = item.href.toLowerCase()
        const hints = (MENU_SECTION_SEARCH_HINTS[item.section] || '').toLowerCase()

        let score = 0
        if (labelPlain === q || label === q) score = 100
        else if (labelPlain.startsWith(q) || label.startsWith(q)) score = 80
        else if (labelPlain.split(/\s+/).some((word) => word.startsWith(q))) score = 60
        else if (label.includes(q)) score = 40
        else if (href.includes(q)) score = 20
        else if (hints.includes(q)) score = 10

        return { item, score }
      })
      .filter((entry) => entry.score > 0)

    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      // Tie-break: shorter (more specific) labels first, then alphabetical for stability.
      if (a.item.label.length !== b.item.label.length) return a.item.label.length - b.item.label.length
      return a.item.label.localeCompare(b.item.label)
    })

    return scored.map((entry) => entry.item)
  }, [filteredMenuItems, searchQuery])

  const sections = useMemo(() => {
    const visibleSections = new Set<ErpAppSection>(
      filteredMenuItems.map((item) => item.section)
    )
    return getSectionDefinitions(isSuperAdmin, mode, visibleSections, language)
  }, [filteredMenuItems, isSuperAdmin, mode, language])

  const sectionsForNav = useMemo(() => {
    const ids = new Set(menuItemsForNav.map((i) => i.section))
    return sections.filter((s) => ids.has(s.id))
  }, [sections, menuItemsForNav])

  const activeNavHref = useMemo(
    () => resolveActiveNavHref(pathname, filteredMenuItems),
    [pathname, filteredMenuItems]
  )

  return {
    navReady,
    userRole,
    isSuperAdmin,
    mode,
    filteredMenuItems,
    menuItemsForNav,
    sections,
    sectionsForNav,
    activeNavHref,
    aquacultureEnabled,
  }
}
