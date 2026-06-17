'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { Building2, Crown, Shield, Menu, Search, X, KeyRound, LogOut } from 'lucide-react'
import { performLogout } from '@/components/LogoutButton'
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
  'border-blue-500/50 bg-blue-600/90 text-white'
const NAV_ITEM_IDLE_CLASS =
  'border-transparent text-gray-400 hover:bg-gray-800/80 hover:text-gray-200'
const SAAS_NAV_ITEM_ACTIVE_CLASS =
  'border-violet-500/50 bg-violet-600/90 text-white'

type SidebarMode = 'fsms_erp' | 'saas_dashboard'

function SidebarModeTabs({
  mode,
  onModeChange,
}: {
  mode: SidebarMode
  onModeChange: (mode: SidebarMode) => void
}) {
  const tabs: { id: SidebarMode; label: string; icon: typeof Building2 }[] = [
    { id: 'fsms_erp', label: 'FSMS ERP', icon: Building2 },
    { id: 'saas_dashboard', label: 'SaaS', icon: Shield },
  ]

  return (
    <div
      role="tablist"
      aria-label="Application mode"
      className="flex rounded-md bg-gray-950/80 p-0.5 ring-1 ring-gray-800"
    >
      {tabs.map(({ id, label, icon: Icon }) => {
        const active = mode === id
        return (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onModeChange(id)}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded px-2 py-1.5 text-[11px] font-medium transition-colors ${
              active
                ? id === 'fsms_erp'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'bg-violet-600 text-white shadow-sm'
                : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
            <span className="truncate">{label}</span>
          </button>
        )
      })}
    </div>
  )
}

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

  useCenterActiveListItem(
    navScrollRef,
    '[data-nav-active="true"]',
    Boolean(pathname && navReady),
    [pathname, menuItemsForNav, navReady, mobileNavOpen, isDesktopLayout, activeNavHref]
  )

  const isSearchingMenu = navSearchQuery.trim().length > 0

  const renderNavItem = (item: (typeof menuItemsForNav)[number]) => {
    const Icon = item.icon
    const isActive = activeNavHref !== null && item.href === activeNavHref
    const activeClass = mode === 'saas_dashboard' ? SAAS_NAV_ITEM_ACTIVE_CLASS : NAV_ITEM_ACTIVE_CLASS
    return (
      <Link
        key={item.href}
        href={item.href}
        data-nav-active={isActive ? 'true' : undefined}
        className={`flex items-center gap-2 rounded-md border px-2 py-1.5 transition-colors group ${
          isActive ? activeClass : NAV_ITEM_IDLE_CLASS
        }`}
      >
        <Icon className={`h-4 w-4 shrink-0 ${isActive ? 'text-white' : 'text-gray-500 group-hover:text-gray-300'}`} />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{item.label}</span>
      </Link>
    )
  }

  return (
    <>
    <div
      className={`sidebar-viewport-height relative flex min-h-0 shrink-0 flex-col self-start overflow-hidden ${isDesktopLayout ? '' : 'w-0'}`}
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
          fixed top-0 left-0 bottom-[var(--erp-os-bottom-chrome,0px)] z-[50] flex min-h-0 w-[min(100vw-3rem,20rem)] max-w-[20rem] flex-col overflow-hidden bg-gray-900 text-white shadow-xl transition-transform duration-200 ease-out
          md:static md:bottom-auto md:z-auto md:h-full md:max-h-full md:min-h-0 md:min-w-0 md:w-full md:max-w-none md:translate-x-0
          ${mobileNavOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
        `}
      >
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b border-gray-800 px-3 py-2.5">
        <div className="min-w-0">
          <h1 className="text-base font-bold leading-none text-blue-400">FSMS</h1>
          <p className="mt-0.5 truncate text-[10px] text-gray-500">
            {mode === 'saas_dashboard' ? 'Platform admin' : 'Filling Station ERP'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setMobileNavOpen(false)}
          className="rounded-md p-1.5 text-gray-400 hover:bg-gray-800 hover:text-white md:hidden"
          aria-label="Close navigation"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Mode tabs — super admin only */}
      {navReady && isSuperAdmin && (
        <div className="shrink-0 border-b border-gray-800 px-2 py-2">
          <SidebarModeTabs
            mode={mode}
            onModeChange={(newMode) => {
              handleModeChange(newMode).catch((error) => {
                safeLogError('Error in handleModeChange:', error)
              })
            }}
          />
        </div>
      )}

      {showingErpNav && (
        <div className="shrink-0 border-b border-gray-800 px-2 py-1.5">
          {isSuperAdmin && mode === 'fsms_erp' ? (
            <CompanySwitcher compact />
          ) : scopeCompanyLabel ? (
            <div className="flex min-w-0 items-center gap-1.5 px-0.5">
              {scopeCompanyLabel.isMaster ? (
                <Crown className="h-3.5 w-3.5 shrink-0 text-yellow-400" aria-hidden />
              ) : (
                <Building2 className="h-3.5 w-3.5 shrink-0 text-gray-400" aria-hidden />
              )}
              <span className="min-w-0 flex-1 truncate text-xs font-medium text-white" title={scopeCompanyLabel.name}>
                {scopeCompanyLabel.name}
              </span>
              {scopeCompanyLabel.isMaster ? (
                <span className="shrink-0 rounded bg-yellow-900/80 px-1 py-px text-[9px] font-medium text-yellow-200">
                  Master
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
      )}

      {/* Navigation + menu search */}
      <nav className="flex min-h-0 flex-1 flex-col">
        <div className="shrink-0 px-2 pb-1.5 pt-2">
          <label htmlFor="sidebar-menu-search" className="sr-only">
            Search menu
          </label>
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-500"
              aria-hidden
            />
            <input
              id="sidebar-menu-search"
              type="search"
              autoComplete="off"
              value={navSearchQuery}
              onChange={(e) => setNavSearchQuery(e.target.value)}
              placeholder="Search…"
              className="w-full rounded-md border border-gray-700/80 bg-gray-800/80 py-1.5 pl-8 pr-7 text-xs text-white placeholder:text-gray-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500/40"
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
          className="min-h-0 flex-1 overflow-y-auto px-2 pb-3 pt-0.5 scrollbar-thin scrollbar-thumb-gray-700 scrollbar-track-gray-900"
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
        ) : isSearchingMenu ? (
          <div className="space-y-px">{menuItemsForNav.map(renderNavItem)}</div>
        ) : (
          sectionsForNav.map((section) => {
            const sectionItems = menuItemsForNav.filter((item) => item.section === section.id)
            if (sectionItems.length === 0) return null

            // Aquaculture is rendered with sub-group headings (Overview / Site & lease / …);
            // all other sections keep the flat list.
            const hasSubGroups =
              section.id === 'aquaculture' && sectionItems.some((i) => i.subGroupId)

            return (
              <div key={section.id} className="mb-3">
                <h3 className="mb-1 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                  {section.label}
                </h3>
                {hasSubGroups ? (
                  <div className="space-y-2">
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
                            <p className="mb-0.5 px-1.5 text-[9px] font-medium uppercase tracking-wide text-gray-600">
                              {g.label}
                            </p>
                          ) : null}
                          <div className="space-y-px">{g.items.map(renderNavItem)}</div>
                        </div>
                      ))
                    })()}
                  </div>
                ) : (
                  <div className="space-y-px">{sectionItems.map(renderNavItem)}</div>
                )}
              </div>
            )
          })
        )}
        </div>
      </nav>

      {/* Footer */}
      <div className="sidebar-footer-pad mt-auto shrink-0 border-t border-gray-800 bg-gray-900/95 p-2">
        <Link
          href="/account/password"
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-gray-400 transition-colors hover:bg-gray-800 hover:text-white"
        >
          <KeyRound className="h-3.5 w-3.5 shrink-0" />
          <span className="text-xs font-medium">Password</span>
        </Link>
        <button
          type="button"
          onClick={performLogout}
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-red-400/90 transition-colors hover:bg-red-950/40 hover:text-red-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/60"
          aria-label="Log out"
        >
          <LogOut className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <span className="text-xs font-medium">Logout</span>
        </button>
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
