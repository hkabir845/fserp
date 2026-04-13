'use client'

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import {
  LayoutDashboard,
  Users,
  Package,
  FileText,
  DollarSign,
  ShoppingCart,
  TrendingUp,
  Building2,
  Droplet,
  MapPin,
  Zap,
  Fuel,
  Gauge,
  Clock,
  BarChart3,
  Landmark,
  Settings,
  LogOut,
  BookOpen,
  Receipt,
  Crown,
  Shield,
  ChevronDown,
  Megaphone,
  Menu,
  Search,
  X,
  CreditCard,
  KeyRound,
  Database,
} from 'lucide-react'
import { useCompany } from '@/contexts/CompanyContext'
import CompanySwitcher from '@/components/CompanySwitcher'
import api from '@/lib/api'
import { isConnectionError, safeLogError } from '@/utils/connectionError'

/** Extra tokens matched by sidebar menu search (section → keywords). */
const MENU_SECTION_SEARCH_HINTS: Record<string, string> = {
  main: 'home dashboard pos cashier point of sale register',
  station: 'station pump fuel tank island dispenser nozzle meter forecourt',
  operations: 'operations shift dip variance inventory fuel ops',
    accounting:
      'accounting ledger chart coa bank accounts journal fund transfer loan borrow lend receivable payable book undeposited cash petty 1010 1020 1120',
  sales: 'sales customer vendor ar ap invoice bill payment receivable payable',
  inventory: 'inventory product item stock sku shop c-store',
  hr: 'hr human resources employee payroll staff',
  management: 'management company settings subscription user tax admin backup restore',
  reports: 'reports analytics export print',
  saas: 'saas platform admin tenant companies users contract subscription billing overview ledger backup restore export',
}

const SIDEBAR_WIDTH_STORAGE_KEY = 'sidebar_width_px'
const SIDEBAR_WIDTH_DEFAULT = 256
const SIDEBAR_WIDTH_MIN = 200
const SIDEBAR_WIDTH_MAX = 520

export default function Sidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [userRole, setUserRole] = useState<string | null>(null)
  const { selectedCompany, setSelectedCompany, isSaaSDashboard, isMasterCompany, mode, setMode } = useCompany()
  const [companiesCount, setCompaniesCount] = useState<number>(0)
  const [usersCount, setUsersCount] = useState<number>(0)

  const [sidebarWidthPx, setSidebarWidthPx] = useState(SIDEBAR_WIDTH_DEFAULT)
  const [isDesktopLayout, setIsDesktopLayout] = useState(false)
  const [isResizingSidebar, setIsResizingSidebar] = useState(false)
  const [navSearchQuery, setNavSearchQuery] = useState('')
  const resizeDragRef = useRef<{
    startX: number
    startWidth: number
  } | null>(null)

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

  useEffect(() => {
    if (typeof window === 'undefined') return
    const mq = window.matchMedia('(min-width: 1024px)')
    const sync = () => setIsDesktopLayout(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
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
  
  // Get user role from localStorage
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const userStr = localStorage.getItem('user')
      if (userStr && userStr !== 'undefined' && userStr !== 'null') {
        try {
          const parsedUser = JSON.parse(userStr)
          if (parsedUser && typeof parsedUser === 'object') {
            setUserRole(parsedUser.role?.toLowerCase() || null)
          }
        } catch (error) {
          console.error('Error parsing user data:', error)
        }
      }
    }
  }, [])
  
  // Fetch counts for SaaS dashboard menu items (stop polling if backend is unreachable)
  const backendUnreachableRef = useRef(false)
  useEffect(() => {
    if (mode === 'saas_dashboard' && userRole === 'super_admin') {
      backendUnreachableRef.current = false
      const fetchCounts = async () => {
        if (backendUnreachableRef.current) return
        try {
          // Short timeout for optional counts so we don't hang when backend is down
          const opts = { timeout: 5000 }
          const [companiesResponse, usersResponse] = await Promise.all([
            api.get('/admin/companies/', opts),
            api.get('/admin/users/', { ...opts, params: { limit: 500 } })
          ])
          if (companiesResponse.data && Array.isArray(companiesResponse.data)) {
            setCompaniesCount(companiesResponse.data.length)
          }
          if (usersResponse.data && Array.isArray(usersResponse.data)) {
            setUsersCount(usersResponse.data.length)
          }
        } catch (error: any) {
          if (isConnectionError(error)) {
            backendUnreachableRef.current = true
          }
          safeLogError('Error fetching counts for sidebar:', error)
        }
      }
      
      fetchCounts()
      // Refresh counts every 30 seconds only while backend is reachable
      const interval = setInterval(fetchCounts, 30000)
      
      // Listen for storage events to update counts when admin page updates them
      const handleStorageChange = (e: StorageEvent) => {
        if (e.key === 'admin_companies_updated' || e.key === 'admin_users_updated') {
          fetchCounts()
        }
      }
      window.addEventListener('storage', handleStorageChange)
      
      // Listen for custom events from admin page
      const handleCustomEvent = () => {
        fetchCounts()
      }
      window.addEventListener('adminCountsUpdated', handleCustomEvent)
      
      return () => {
        clearInterval(interval)
        window.removeEventListener('storage', handleStorageChange)
        window.removeEventListener('adminCountsUpdated', handleCustomEvent)
      }
    }
  }, [mode, userRole])

  useEffect(() => {
    setMobileNavOpen(false)
  }, [pathname])

  useEffect(() => {
    if (typeof document === 'undefined') return
    if (mobileNavOpen) {
      const prev = document.body.style.overflow
      document.body.style.overflow = 'hidden'
      return () => {
        document.body.style.overflow = prev
      }
    }
  }, [mobileNavOpen])
  
  const isSuperAdmin = userRole === 'super_admin'

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
        // Navigate to dashboard - use window.location for more reliable navigation
        router.push('/dashboard')
        // Also use window.location as fallback to ensure navigation happens
        setTimeout(() => {
          if (window.location.pathname !== '/dashboard') {
            window.location.href = '/dashboard'
          }
        }, 500)
      } else {
        // If no company selected, select master company or first available FIRST
        try {
          await fetchAndSelectDefaultCompany()
        } catch (error) {
          safeLogError('Error fetching default company:', error)
          // If fetching fails, still try to navigate - user can select company later
          router.push('/dashboard')
          setTimeout(() => {
            if (window.location.pathname !== '/dashboard') {
              window.location.href = '/dashboard'
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
        
        // Now navigate to dashboard
        router.push('/dashboard')
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

  // FSMS ERP Menu Items
  const fsmsErpMenuItems = [
    { href: '/dashboard', icon: LayoutDashboard, label: 'Dashboard', section: 'main' },
    { href: '/cashier', icon: ShoppingCart, label: 'POS / Cashier', section: 'main' },
    
    // Station Management
    { href: '/stations', icon: Building2, label: 'Stations', section: 'station' },
    { href: '/tanks', icon: Droplet, label: 'Tanks', section: 'station' },
    { href: '/islands', icon: MapPin, label: 'Islands', section: 'station' },
    { href: '/dispensers', icon: Zap, label: 'Dispensers', section: 'station' },
    { href: '/nozzles', icon: Fuel, label: 'Nozzles', section: 'station' },
    { href: '/meters', icon: Gauge, label: 'Meters', section: 'station' },
    
    // Operations
    { href: '/shift-management', icon: Clock, label: 'Shift Management', section: 'operations' },
    { href: '/tank-dips', icon: Droplet, label: 'Tank Dips', section: 'operations' },
    
    // Accounting
    { href: '/chart-of-accounts', icon: BookOpen, label: 'Chart of Accounts', section: 'accounting' },
    { href: '/journal-entries', icon: Receipt, label: 'Journal Entries', section: 'accounting' },
    { href: '/fund-transfers', icon: TrendingUp, label: 'Fund Transfer', section: 'accounting' },
    { href: '/loans', icon: Landmark, label: 'Loans', section: 'accounting' },
    
    // Customers & Sales
    { href: '/customers', icon: Users, label: 'Customers', section: 'sales' },
    { href: '/vendors', icon: Users, label: 'Vendors', section: 'sales' },
    { href: '/invoices', icon: FileText, label: 'Invoices', section: 'sales' },
    { href: '/bills', icon: Receipt, label: 'Bills', section: 'sales' },
    { href: '/payments', icon: DollarSign, label: 'Payments', section: 'sales' },
    
    // Products & services (single /items screen)
    { href: '/items', icon: Package, label: 'Products & services', section: 'inventory' },
    
    // HR & Payroll
    { href: '/employees', icon: Users, label: 'Employees', section: 'hr' },
    { href: '/payroll', icon: DollarSign, label: 'Payroll', section: 'hr' },
    
    // Management
    { href: '/company', icon: Building2, label: 'Company', section: 'management' },
    { href: '/subscriptions', icon: Crown, label: 'Subscriptions', section: 'management' },
    { href: '/users', icon: Users, label: 'Users', section: 'management' },
    { href: '/tax', icon: Receipt, label: 'Tax', section: 'management' },
    { href: '/backup', icon: Database, label: 'Backup & Restore', section: 'management' },
    
    // Reports
    { href: '/reports', icon: BarChart3, label: 'Reports', section: 'reports' },
  ]

  // SaaS Dashboard Menu Items - with dynamic counts
  const saasMenuItems = [
    { href: '/admin/overview', icon: BarChart3, label: 'Platform Overview', section: 'saas' },
    { href: '/admin/subscription-billing', icon: CreditCard, label: 'Subscription & Billing', section: 'saas' },
    { href: '/admin/companies', icon: Building2, label: `Companies (${companiesCount})`, section: 'saas', count: companiesCount },
    { href: '/admin/users', icon: Users, label: `All Users (${usersCount})`, section: 'saas', count: usersCount },
    { href: '/admin/contracts', icon: FileText, label: 'Contract Management', section: 'saas' },
    { href: '/admin/subscription-ledger', icon: Receipt, label: 'Subscription Ledger', section: 'saas' },
    { href: '/admin/broadcasting', icon: Megaphone, label: 'Broadcasting', section: 'saas' },
    { href: '/admin/backup', icon: Database, label: 'Backup & Restore', section: 'saas' },
  ]

  // Select menu items based on mode - CRITICAL: Always show FSMS ERP menu when in FSMS ERP mode
  const menuItems = (isSuperAdmin && mode === 'saas_dashboard') ? saasMenuItems : fsmsErpMenuItems

  // Filter menu items based on user role
  const getFilteredMenuItems = () => {
    const role = userRole?.toLowerCase() || ''
    
    // For Super Admin in FSMS ERP mode, show ALL ERP menu items (full access)
    if (isSuperAdmin && mode === 'fsms_erp') {
      return fsmsErpMenuItems // Always return full ERP menu for super admin in FSMS ERP mode
    }
    
    // Cashier: Limited access
    if (role === 'cashier') {
      return menuItems.filter(item => 
        item.href === '/dashboard' ||
        item.href === '/cashier' || 
        item.href === '/customers' ||
        item.href === '/reports'
      )
    }
    
    // Accountant: No station management, no user management
    if (role === 'accountant') {
      return menuItems.filter(item => {
        // Exclude station management items
        const stationItems = ['/stations', '/tanks', '/islands', '/dispensers', '/nozzles', '/meters']
        if (stationItems.includes(item.href)) return false
        
        // Exclude user management
        if (item.href === '/users') return false
        if (item.href === '/backup') return false

        return true
      })
    }
    
    // Admin: Full access
    if (role === 'admin') {
      return menuItems
    }
    
    // Super Admin: Full access (SaaS Dashboard is accessed via tabs, not menu)
    if (role === 'super_admin') {
      return menuItems
    }

    // Default: Show all menu items
    return menuItems
  }

  /** Company-owner backup lives under ERP Management (/backup). Super admins use SaaS → /admin/backup only. */
  const filterTenantBackupMenuItem = (items: typeof fsmsErpMenuItems, role: string) => {
    const r = role.toLowerCase()
    return items.filter((item) => {
      if (item.href !== '/backup') return true
      return r === 'admin'
    })
  }

  const filteredMenuItems = filterTenantBackupMenuItem(
    getFilteredMenuItems(),
    userRole?.toLowerCase() || ''
  )

  const menuItemsForNav = useMemo(() => {
    const q = navSearchQuery.trim().toLowerCase()
    if (!q) return filteredMenuItems
    return filteredMenuItems.filter((item) => {
      const label = item.label.toLowerCase()
      const labelPlain = label.replace(/\s*\(\d+\)\s*/g, ' ').replace(/\s+/g, ' ').trim()
      const href = item.href.toLowerCase()
      const hints = (MENU_SECTION_SEARCH_HINTS[item.section] || '').toLowerCase()
      return (
        label.includes(q) ||
        labelPlain.includes(q) ||
        href.includes(q) ||
        hints.includes(q)
      )
    })
  }, [filteredMenuItems, navSearchQuery])

  // Filter sections based on visible menu items
  const getFilteredSections = () => {
    const visibleSections = new Set(filteredMenuItems.map((item) => item.section))
    
    // SaaS Dashboard sections
    if (isSuperAdmin && mode === 'saas_dashboard') {
      return [
        { id: 'saas', label: 'SaaS Management' },
      ]
    }
    
    // FSMS ERP sections - Show ALL sections when in FSMS ERP mode for Super Admin
    if (isSuperAdmin && mode === 'fsms_erp') {
      return [
        { id: 'main', label: 'Main' },
        { id: 'station', label: 'Station Management' },
        { id: 'operations', label: 'Operations' },
        { id: 'accounting', label: 'Accounting' },
        { id: 'sales', label: 'Sales & Customers' },
        { id: 'inventory', label: 'Products & services' },
        { id: 'hr', label: 'HR & Payroll' },
        { id: 'management', label: 'Management' },
        { id: 'reports', label: 'Reports & Analytics' },
      ]
    }
    
    // FSMS ERP sections for other users
    const allSections = [
      { id: 'main', label: 'Main' },
      { id: 'station', label: 'Station Management' },
      { id: 'operations', label: 'Operations' },
      { id: 'accounting', label: 'Accounting' },
      { id: 'sales', label: 'Sales & Customers' },
      { id: 'inventory', label: 'Products & services' },
      { id: 'hr', label: 'HR & Payroll' },
      { id: 'management', label: 'Management' },
      { id: 'reports', label: 'Reports & Analytics' },
    ]
    
    // Return only sections that have visible items
    return allSections.filter(section => visibleSections.has(section.id))
  }

  const sections = getFilteredSections()

  const sectionsForNav = useMemo(() => {
    const ids = new Set(menuItemsForNav.map((i) => i.section))
    return sections.filter((s) => ids.has(s.id))
  }, [sections, menuItemsForNav])

  const handleLogout = () => {
    localStorage.removeItem('access_token')
    localStorage.removeItem('refresh_token')
    localStorage.removeItem('user')
    window.location.href = '/login'
  }
  
  return (
    <div
      className={`relative flex h-full min-h-0 max-h-full shrink-0 flex-col overflow-hidden ${isDesktopLayout ? '' : 'w-0'}`}
      style={isDesktopLayout ? { width: sidebarWidthPx } : undefined}
    >
      {/* Mobile menu toggle — sits above main content; sidebar is off-canvas until opened */}
      <button
        type="button"
        onClick={() => setMobileNavOpen(true)}
        className="fixed top-3 left-3 z-[60] flex h-11 w-11 items-center justify-center rounded-lg bg-gray-900 text-white shadow-lg ring-1 ring-white/10 lg:hidden"
        aria-label="Open navigation menu"
      >
        <Menu className="h-6 w-6" />
      </button>
      {mobileNavOpen && (
        <button
          type="button"
          className="fixed inset-0 z-[45] bg-black/50 backdrop-blur-[1px] lg:hidden"
          aria-label="Close menu"
          onClick={() => setMobileNavOpen(false)}
        />
      )}
      <aside
        key={`sidebar-${mode}`}
        className={`
          fixed inset-y-0 left-0 z-[50] flex h-full min-h-0 w-[min(100vw-3rem,20rem)] max-w-[20rem] flex-col overflow-hidden bg-gray-900 text-white shadow-xl transition-transform duration-200 ease-out
          lg:static lg:z-auto lg:h-full lg:min-h-0 lg:min-w-0 lg:w-full lg:max-w-none lg:translate-x-0
          ${mobileNavOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
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
          className="rounded-lg p-2 text-gray-400 hover:bg-gray-800 hover:text-white lg:hidden"
          aria-label="Close navigation"
        >
          <X className="h-6 w-6" />
        </button>
      </div>

      {/* Tab System - Only for Super Admin */}
      {isSuperAdmin && (
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

        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4 pt-1 scrollbar-thin scrollbar-thumb-gray-700 scrollbar-track-gray-900 sm:px-4">
        {sectionsForNav.length === 0 ? (
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
              <>
                <p className="text-sm">No menu items available</p>
                {isSuperAdmin && (
                  <p className="mt-2 text-xs text-gray-500">
                    Debug: Mode={mode}, MenuItems={menuItems.length}, Filtered={filteredMenuItems.length},
                    Sections={sections.length}
                  </p>
                )}
              </>
            )}
          </div>
        ) : (
          sectionsForNav.map((section) => {
            const sectionItems = menuItemsForNav.filter((item) => item.section === section.id)
            if (sectionItems.length === 0) return null

            return (
              <div key={section.id} className="mb-5">
                <h3 className="mb-2.5 rounded-md bg-gray-800/50 px-2 py-1.5 text-xs font-bold uppercase tracking-wider text-gray-300">
                  {section.label}
                </h3>
                <div className="space-y-0.5 pl-1">
                  {sectionItems.map((item) => {
                    const Icon = item.icon
                    // Check if the current pathname matches the item href
                    const isActive = pathname === item.href || pathname.startsWith(item.href + '/')

                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        onClick={() => setMobileNavOpen(false)}
                        className={`flex items-center space-x-3 px-3 py-2.5 rounded-md transition-all duration-200 group ${
                          isActive
                            ? 'bg-gradient-to-r from-blue-600 to-blue-700 text-white shadow-md shadow-blue-500/30'
                            : 'text-gray-300 hover:bg-gray-800/70 hover:text-white'
                        }`}
                      >
                        <Icon className={`h-4.5 w-4.5 flex-shrink-0 ${isActive ? 'text-white' : 'text-gray-400 group-hover:text-white'} transition-colors`} />
                        <span className="text-sm font-medium flex-1 truncate">{item.label}</span>
                        {isActive && (
                          <div className="ml-auto h-2 w-2 rounded-full bg-white shadow-sm"></div>
                        )}
                      </Link>
                    )
                  })}
                </div>
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
          onClick={() => setMobileNavOpen(false)}
          className="flex items-center space-x-3 px-3 py-2 rounded-lg text-gray-300 hover:bg-gray-800 hover:text-white transition-colors w-full"
        >
          <KeyRound className="h-5 w-5" />
          <span className="text-sm font-medium">Change password</span>
        </Link>
        <button
          type="button"
          onClick={handleLogout}
          className="flex items-center space-x-3 px-3 py-2 rounded-lg text-gray-300 hover:bg-gray-800 hover:text-white transition-colors w-full"
        >
          <LogOut className="h-5 w-5" />
          <span className="text-sm font-medium">Logout</span>
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
        className={`pointer-events-none absolute top-0 z-[52] hidden h-full w-3 -translate-x-1/2 cursor-col-resize select-none lg:pointer-events-auto lg:block ${
          isResizingSidebar ? 'bg-blue-500/25' : 'hover:bg-white/10'
        }`}
        style={{ right: 0 }}
        onMouseDown={onSidebarResizePointerDown}
      />

    </div>
  )
}
