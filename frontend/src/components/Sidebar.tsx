'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { Building2, Crown, Shield, Menu, Search, X, KeyRound } from 'lucide-react'
import { AppHeaderLogout } from '@/components/LogoutButton'
import { useCompany } from '@/contexts/CompanyContext'
import { useSidebarNav } from '@/contexts/SidebarNavContext'
import CompanySwitcher from '@/components/CompanySwitcher'
import api from '@/lib/api'
import { safeLogError } from '@/utils/connectionError'
import { useErpNavigationMenu } from '@/hooks/useErpNavigationMenu'
import { useCenterActiveListItem } from '@/hooks/useCenterActiveListItem'

const SIDEBAR_WIDTH_STORAGE_KEY = 'sidebar_width_px'
const SIDEBAR_WIDTH_DEFAULT = 256
const SIDEBAR_WIDTH_MIN = 200
const SIDEBAR_WIDTH_MAX = 520

const NAV_ITEM_ACTIVE_CLASS =
  'border-blue-400/80 bg-gradient-to-r from-blue-600 to-blue-700 text-white shadow-md shadow-blue-500/30'
const NAV_ITEM_IDLE_CLASS =
  'border-transparent text-gray-300 hover:border-gray-600 hover:bg-gray-800/70 hover:text-white'

export default function Sidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const { navOpen: mobileNavOpen, setNavOpen: setMobileNavOpen, isDesktopLayout } = useSidebarNav()
  const { selectedCompany, setSelectedCompany, isSaaSDashboard, isMasterCompany, mode, setMode, isClientReady } =
    useCompany()
  const [navSearchQuery, setNavSearchQuery] = useState('')
  const {
    navReady,
    userRole,
    isSuperAdmin,
    filteredMenuItems,
    menuItemsForNav,
    sectionsForNav,
    activeNavHref,
  } = useErpNavigationMenu({ searchQuery: navSearchQuery })

  const [sidebarWidthPx, setSidebarWidthPx] = useState(SIDEBAR_WIDTH_DEFAULT)
  const [isResizingSidebar, setIsResizingSidebar] = useState(false)
  const resizeDragRef = useRef<{
    startX: number
    startWidth: number
  } | null>(null)
  const navScrollRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const raw = localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY)
      if (raw) {
        const n = parseInt(raw, 10)
        if (!Number.isNaN(n)) {
          setSidebarWidthPx(Math.min(SIDEBAR_WIDTH_MAX, Math.max(SIDEBAR_WIDTH_MIN, n)))
        }
      }
    } catch {
      /* ignore */
    }
  }, [])

  const endSidebarResize = useCallback(() => {
    resizeDragRef.current = null
    setIsResizingSidebar(false)
    try {
      document.body.style.removeProperty('cursor')
      document.body.style.removeProperty('user-select')
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    if (!isResizingSidebar) return

    const onMove = (e: MouseEvent) => {
      const drag = resizeDragRef.current
      if (!drag) return
      const delta = e.clientX - drag.startX
      const next = Math.min(
        SIDEBAR_WIDTH_MAX,
        Math.max(SIDEBAR_WIDTH_MIN, drag.startWidth + delta)
      )
      setSidebarWidthPx(next)
    }

    const onUp = () => {
      if (!resizeDragRef.current) return
      setSidebarWidthPx((w) => {
        try {
          localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(w))
        } catch {
          /* ignore */
        }
        return w
      })
      endSidebarResize()
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    window.addEventListener('blur', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      window.removeEventListener('blur', onUp)
    }
  }, [isResizingSidebar, endSidebarResize])

  const onSidebarResizePointerDown = (e: React.MouseEvent) => {
    if (!isDesktopLayout) return
    e.preventDefault()
    e.stopPropagation()
    resizeDragRef.current = {
      startX: e.clientX,
      startWidth: sidebarWidthPx,
    }
    setIsResizingSidebar(true)
    try {
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
    } catch {
      /* ignore */
    }
  }
  
  useEffect(() => {
    if (typeof document === 'undefined') return
    if (mobileNavOpen && !isDesktopLayout) {
      const prev = document.body.style.overflow
      document.body.style.overflow = 'hidden'
      return () => {
        document.body.style.overflow = prev
      }
    }
  }, [mobileNavOpen, isDesktopLayout])

  /** ERP nav is shown whenever not (superadmin in SaaS-only tab). */
  const showingErpNav = !isSuperAdmin || mode === 'fsms_erp'

  /** Resolved company for “all ERP data is scoped to …” (matches API X-Selected-Company-Id / tenant). */
  const [scopeCompanyLabel, setScopeCompanyLabel] = useState<{
    name: string
    isMaster: boolean
    id: number | null
  } | null>(null)

  useEffect(() => {
    if (!showingErpNav) {
      setScopeCompanyLabel(null)
      return
    }
    if (isSuperAdmin) {
      if (selectedCompany?.id) {
        setScopeCompanyLabel({
          name: selectedCompany.name,
          isMaster: isMasterCompany,
          id: selectedCompany.id,
        })
        return
      }
      setScopeCompanyLabel(null)
      return
    }
    if (typeof window !== 'undefined' && !localStorage.getItem('access_token')?.trim()) {
      setScopeCompanyLabel(null)
      return
    }
    let cancelled = false
    api
      .get('/companies/current/')
      .then((res) => {
        if (cancelled || !res.data?.name) return
        setScopeCompanyLabel({
          name: res.data.name,
          isMaster: res.data.is_master === 'true',
          id: typeof res.data.id === 'number' ? res.data.id : null,
        })
      })
      .catch(() => {
        if (!cancelled) setScopeCompanyLabel(null)
      })
    return () => {
      cancelled = true
    }
  }, [
    showingErpNav,
    isSuperAdmin,
    selectedCompany?.id,
    selectedCompany?.name,
    isMasterCompany,
    mode,
  ])
  
  // Handle mode change (tab click)
  const handleModeChange = async (newMode: 'fsms_erp' | 'saas_dashboard') => {
    if (newMode === 'fsms_erp') {
      // Always set mode first
      setMode(newMode)
      
      // Wait a bit for mode to be saved
      await new Promise(resolve => setTimeout(resolve, 100))
      
      // Switch to FSMS ERP mode - ensure company is selected BEFORE navigating
      if (selectedCompany) {
        // Company already selected, ensure it's saved and navigate
        if (typeof window !== 'undefined') {
          try {
            localStorage.setItem('superadmin_selected_company', JSON.stringify(selectedCompany))
            localStorage.setItem('sidebar_mode', 'fsms_erp')
          } catch (e) {
            console.error('Error saving to localStorage:', e)
          }
        }
        router.push('/apps')
        setTimeout(() => {
          if (window.location.pathname !== '/apps') {
            window.location.href = '/apps'
          }
        }, 500)
      } else {
        // If no company selected, select master company or first available FIRST
        try {
          await fetchAndSelectDefaultCompany()
        } catch (error) {
          safeLogError('Error fetching default company:', error)
          // If fetching fails, still try to navigate - user can select company later
          router.push('/apps')
          setTimeout(() => {
            if (window.location.pathname !== '/apps') {
              window.location.href = '/apps'
            }
          }, 500)
        }
      }
    } else {
      // Switch to SaaS Dashboard mode
      setMode(newMode)
      
      // Save mode to localStorage
      if (typeof window !== 'undefined') {
        try {
          localStorage.setItem('sidebar_mode', 'saas_dashboard')
        } catch (e) {
          console.error('Error saving mode to localStorage:', e)
        }
      }
      
      // Wait for state to update
      await new Promise(resolve => setTimeout(resolve, 100))
      
      // Navigate to admin overview page
      if (pathname?.startsWith('/admin')) {
        // Already on admin page, just refresh
        router.refresh()
      } else {
        router.push('/admin/overview')
      }
    }
  }
  
  // REMOVED auto-switching useEffect - it was interfering with manual mode changes
  // Mode switching is now handled entirely by handleModeChange when user clicks tabs
  
  const fetchAndSelectDefaultCompany = async () => {
    try {
      const response = await api.get('/admin/companies')
      if (response.data && response.data.length > 0) {
        // Prefer master company, otherwise first company
        const masterCompany = response.data.find((c: any) => c.is_master === 'true')
        const companyToSelect = masterCompany || response.data[0]
        
        const companyData = {
          id: companyToSelect.id,
          name: companyToSelect.name,
          is_master: companyToSelect.is_master || 'false'
        }
        
        // Set mode first
        setMode('fsms_erp')
        
        // Set company in state
        setSelectedCompany(companyData)
        
        // Save to localStorage immediately
        if (typeof window !== 'undefined') {
          try {
            localStorage.setItem('superadmin_selected_company', JSON.stringify(companyData))
            localStorage.setItem('sidebar_mode', 'fsms_erp')
          } catch (e) {
            console.error('Error saving to localStorage:', e)
          }
        }
        
        // Wait for state and localStorage to be fully updated
        await new Promise(resolve => setTimeout(resolve, 300))
        
        router.push('/apps')
      } else {
        // Stay on current page if no companies available
      }
    } catch (error: any) {
      // Silently handle connection errors
      safeLogError('Error fetching companies:', error)
      
      // If it's an auth error, don't navigate - let the error handler deal with it
      if (error.response?.status === 401 || error.response?.status === 403) {
        return
      }
    }
  }

  /** If menu search hides the current page, clear search so the selection stays visible (Reports-style). */
  useEffect(() => {
    if (!pathname || !navSearchQuery.trim() || !navReady || !activeNavHref) return
    const visible = menuItemsForNav.some((item) => item.href === activeNavHref)
    if (!visible) setNavSearchQuery('')
  }, [pathname, navSearchQuery, navReady, activeNavHref, menuItemsForNav])

  useCenterActiveListItem(
    navScrollRef,
    '[data-nav-active="true"]',
    Boolean(pathname && navReady),
    [pathname, menuItemsForNav, navReady, mobileNavOpen, isDesktopLayout, activeNavHref]
  )

  return (
    <>
    <AppHeaderLogout />
    <div
      className={`relative flex h-full min-h-0 max-h-full shrink-0 flex-col overflow-hidden ${isDesktopLayout ? '' : 'w-0'}`}
      style={isDesktopLayout ? { width: sidebarWidthPx } : undefined}
    >
      {/* Mobile menu toggle — sits above main content; sidebar is off-canvas until opened */}
      <button
        type="button"
        onClick={() => setMobileNavOpen(true)}
        className="fixed left-[max(0.75rem,env(safe-area-inset-left,0px))] top-[max(0.75rem,env(safe-area-inset-top,0px))] z-[60] flex h-11 w-11 items-center justify-center rounded-lg bg-gray-900 text-white shadow-lg ring-1 ring-white/10 md:hidden"
        aria-label="Open navigation menu"
      >
        <Menu className="h-6 w-6" />
      </button>
      {mobileNavOpen && (
        <button
          type="button"
          className="fixed inset-0 z-[45] bg-black/50 backdrop-blur-[1px] md:hidden"
          aria-label="Close menu"
          onClick={() => setMobileNavOpen(false)}
        />
      )}
      <aside
        key={`sidebar-${mode}`}
        className={`
          fixed inset-y-0 left-0 z-[50] flex h-full min-h-0 w-[min(100vw-3rem,20rem)] max-w-[20rem] flex-col overflow-hidden bg-gray-900 text-white shadow-xl transition-transform duration-200 ease-out
          md:static md:z-auto md:h-full md:min-h-0 md:min-w-0 md:w-full md:max-w-none md:translate-x-0
          ${mobileNavOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
        `}
      >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-800 p-4 sm:p-6">
        <div>
          <h1 className="text-xl font-bold text-blue-400 sm:text-2xl">FSMS</h1>
          <p className="mt-1 text-xs text-gray-400">Filling Station ERP</p>
        </div>
        <button
          type="button"
          onClick={() => setMobileNavOpen(false)}
          className="rounded-lg p-2 text-gray-400 hover:bg-gray-800 hover:text-white md:hidden"
          aria-label="Close navigation"
        >
          <X className="h-6 w-6" />
        </button>
      </div>

      {/* Tab System - Only for Super Admin */}
      {navReady && isSuperAdmin && (
        <div className="border-b border-gray-800 bg-gradient-to-b from-gray-850 to-gray-900">
          {/* Tabs — stack labels on very narrow screens */}
          <div className="flex flex-col gap-1 bg-gray-800/30 p-1 sm:flex-row sm:rounded-t-lg">
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                handleModeChange('fsms_erp').catch(error => {
                  safeLogError('Error in handleModeChange:', error)
                })
              }}
              className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-xs font-semibold transition-all sm:px-4 sm:py-3 sm:text-sm ${
                mode === 'fsms_erp'
                  ? 'bg-gradient-to-r from-blue-600 to-blue-700 text-white shadow-lg shadow-blue-500/30 border border-blue-400/50'
                  : 'text-gray-400 hover:text-white hover:bg-gray-700/50'
              }`}
            >
              <Building2 className={`h-4 w-4 ${mode === 'fsms_erp' ? 'text-white' : ''}`} />
              <span>FSMS ERP</span>
              {mode === 'fsms_erp' && (
                <span className="ml-1 text-xs">✓</span>
              )}
            </button>
            <button
              type="button"
              onClick={() => handleModeChange('saas_dashboard')}
              className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-xs font-semibold transition-all sm:px-4 sm:py-3 sm:text-sm ${
                mode === 'saas_dashboard'
                  ? 'bg-gradient-to-r from-blue-600 to-blue-700 text-white shadow-lg shadow-blue-500/30 border border-blue-400/50'
                  : 'text-gray-400 hover:text-white hover:bg-gray-700/50'
              }`}
            >
              <Shield className={`h-4 w-4 ${mode === 'saas_dashboard' ? 'text-white' : ''}`} />
              <span>SaaS Dashboard</span>
            </button>
          </div>
          {/* SaaS mode context — in-sidebar so it never covers main content actions (e.g. New company). */}
          {mode === 'saas_dashboard' && (
            <div className="border-t border-gray-800/80 px-2 pb-2 pt-2">
              <div className="rounded-lg border border-blue-800/60 bg-blue-950/45 px-3 py-2 shadow-inner">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-blue-300/90">Mode</p>
                <div className="mt-0.5 flex items-center gap-1.5">
                  <Shield className="h-3.5 w-3.5 shrink-0 text-blue-400" aria-hidden />
                  <span className="text-sm font-semibold text-white">SaaS platform</span>
                </div>
                <p className="mt-0.5 text-[10px] text-gray-400">Not scoped to one tenant</p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ERP tenant scope: all list/detail APIs use this company (superadmin: header X-Selected-Company-Id). */}
      {showingErpNav && (
        <div className="border-b border-gray-800 bg-gray-800/40 px-3 py-2.5">
          {isSuperAdmin && mode === 'fsms_erp' && !selectedCompany?.id ? (
            <p className="text-xs leading-snug text-amber-300">
              Choose a <span className="font-semibold">company</span> below (e.g. Master Filling Station). All ERP pages
              use that company until you switch.
            </p>
          ) : scopeCompanyLabel ? (
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-1.5">
                {scopeCompanyLabel.isMaster ? (
                  <Crown className="h-3.5 w-3.5 shrink-0 text-yellow-400" aria-hidden />
                ) : (
                  <Building2 className="h-3.5 w-3.5 shrink-0 text-gray-400" aria-hidden />
                )}
                <span className="text-xs font-semibold text-white truncate" title={scopeCompanyLabel.name}>
                  {scopeCompanyLabel.name}
                </span>
                {scopeCompanyLabel.isMaster ? (
                  <span className="rounded bg-yellow-900/80 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-yellow-200">
                    Master · dev baseline
                  </span>
                ) : (
                  <span className="rounded bg-slate-700 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-200">
                    Tenant
                  </span>
                )}
              </div>
              <p className="text-[11px] leading-snug text-gray-400">
                Data is isolated by company ID (not by station name). Develop and test on Master here; when ready, roll
                the same changes to tenants such as Adib using your upgrade process.
              </p>
            </div>
          ) : (
            <p className="text-xs text-gray-500">Loading company context…</p>
          )}
          {isSuperAdmin && mode === 'fsms_erp' && (
            <div className="mt-3 border-t border-gray-700/80 pt-3">
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-500">Switch Company</p>
              <p className="mb-2 text-[10px] leading-snug text-gray-500">
                Master appears at the top; other tenants (e.g. Adib Filling Station) are under{' '}
                <span className="text-gray-400">Companies</span> — scroll if the list is long.
              </p>
              <CompanySwitcher />
            </div>
          )}
        </div>
      )}

      {/* Navigation + menu search */}
      <nav className="flex min-h-0 flex-1 flex-col border-t border-gray-800/80">
        <div className="shrink-0 px-3 pb-2 pt-3 sm:px-4">
          <label htmlFor="sidebar-menu-search" className="sr-only">
            Search menu
          </label>
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500"
              aria-hidden
            />
            <input
              id="sidebar-menu-search"
              type="search"
              autoComplete="off"
              value={navSearchQuery}
              onChange={(e) => setNavSearchQuery(e.target.value)}
              placeholder="Search menu…"
              className="w-full rounded-lg border border-gray-700 bg-gray-800/90 py-2 pl-9 pr-8 text-sm text-white placeholder:text-gray-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500/50"
            />
            {navSearchQuery ? (
              <button
                type="button"
                onClick={() => setNavSearchQuery('')}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-gray-500 hover:bg-gray-700 hover:text-white"
                aria-label="Clear menu search"
              >
                <X className="h-4 w-4" />
              </button>
            ) : null}
          </div>
        </div>

        <div
          ref={navScrollRef}
          className="min-h-0 flex-1 overflow-y-auto px-3 pb-4 pt-1 scrollbar-thin scrollbar-thumb-gray-700 scrollbar-track-gray-900 sm:px-4"
        >
        {!navReady ? (
          <div className="py-8 text-center text-sm text-gray-500" aria-busy="true">
            Loading menu…
          </div>
        ) : sectionsForNav.length === 0 ? (
          <div className="py-8 text-center text-gray-400">
            {navSearchQuery.trim() ? (
              <>
                <p className="text-sm">No menu items match &quot;{navSearchQuery.trim()}&quot;</p>
                <button
                  type="button"
                  onClick={() => setNavSearchQuery('')}
                  className="mt-2 text-xs font-medium text-blue-400 hover:text-blue-300"
                >
                  Clear search
                </button>
              </>
            ) : (
              <p className="text-sm">No menu items available</p>
            )}
          </div>
        ) : (
          sectionsForNav.map((section) => {
            const sectionItems = menuItemsForNav.filter((item) => item.section === section.id)
            if (sectionItems.length === 0) return null

            const renderItem = (item: typeof sectionItems[number]) => {
              const Icon = item.icon
              const isActive = activeNavHref !== null && item.href === activeNavHref
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  data-nav-active={isActive ? 'true' : undefined}
                  className={`flex items-center space-x-3 rounded-lg border-2 px-3 py-2.5 transition-all duration-200 group ${
                    isActive ? NAV_ITEM_ACTIVE_CLASS : NAV_ITEM_IDLE_CLASS
                  }`}
                >
                  <Icon className={`h-4.5 w-4.5 flex-shrink-0 ${isActive ? 'text-white' : 'text-gray-400 group-hover:text-white'} transition-colors`} />
                  <span className="text-sm font-medium flex-1 truncate">{item.label}</span>
                  {isActive && (
                    <div className="ml-auto h-2 w-2 rounded-full bg-white shadow-sm"></div>
                  )}
                </Link>
              )
            }

            // Aquaculture is rendered with sub-group headings (Overview / Site & lease / …);
            // all other sections keep the flat list.
            const hasSubGroups =
              section.id === 'aquaculture' && sectionItems.some((i) => i.subGroupId)

            return (
              <div key={section.id} className="mb-5">
                <h3 className="mb-2.5 rounded-md bg-gray-800/50 px-2 py-1.5 text-xs font-bold uppercase tracking-wider text-gray-300">
                  {section.label}
                </h3>
                {hasSubGroups ? (
                  <div className="space-y-3 pl-1">
                    {(() => {
                      const groups: { id: string; label: string; items: typeof sectionItems }[] = []
                      for (const item of sectionItems) {
                        const gid = item.subGroupId ?? '_other'
                        const glabel = item.subGroupLabel ?? ''
                        let g = groups.find((x) => x.id === gid)
                        if (!g) {
                          g = { id: gid, label: glabel, items: [] }
                          groups.push(g)
                        }
                        g.items.push(item)
                      }
                      return groups.map((g) => (
                        <div key={g.id}>
                          {g.label ? (
                            <p className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                              {g.label}
                            </p>
                          ) : null}
                          <div className="space-y-0.5">{g.items.map(renderItem)}</div>
                        </div>
                      ))
                    })()}
                  </div>
                ) : (
                  <div className="space-y-0.5 pl-1">{sectionItems.map(renderItem)}</div>
                )}
              </div>
            )
          })
        )}
        </div>
      </nav>

      {/* Footer */}
      <div className="p-4 border-t border-gray-800 space-y-1">
        <Link
          href="/account/password"
          className="flex items-center space-x-3 px-3 py-2 rounded-lg text-gray-300 hover:bg-gray-800 hover:text-white transition-colors w-full"
        >
          <KeyRound className="h-5 w-5" />
          <span className="text-sm font-medium">Change password</span>
        </Link>
      </div>
    </aside>

      {/* Desktop: drag left/right to widen/narrow the menubar */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize navigation sidebar"
        aria-valuemin={SIDEBAR_WIDTH_MIN}
        aria-valuemax={SIDEBAR_WIDTH_MAX}
        aria-valuenow={Math.round(sidebarWidthPx)}
        className={`pointer-events-none absolute top-0 z-[52] hidden h-full w-3 -translate-x-1/2 cursor-col-resize select-none md:pointer-events-auto md:block ${
          isResizingSidebar ? 'bg-blue-500/25' : 'hover:bg-white/10'
        }`}
        style={{ right: 0 }}
        onMouseDown={onSidebarResizePointerDown}
      />

    </div>
    </>
  )
}
