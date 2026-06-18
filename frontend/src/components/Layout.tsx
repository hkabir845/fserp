'use client'

import { useState, useEffect } from 'react'
import Sidebar from './Sidebar'
import { useQuery } from '@tanstack/react-query'
import { getCurrentUser, logout } from '@/lib/auth'
import { BackendStatus } from './BackendStatus'
import { ERPSaaSSwitcher } from './ERPSaaSSwitcher'
import CompanySwitcher from './CompanySwitcher'

interface LayoutProps {
  children: React.ReactNode
}

const SIDEBAR_WIDTH_KEY = 'erp-sidebar-width'
const DEFAULT_SIDEBAR_WIDTH = 256 // 64 * 4 = 256px (w-64)

export function Layout({ children }: LayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH)
  const [isDesktop, setIsDesktop] = useState(false)
  const [isMasterMode, setIsMasterMode] = useState(false)
  const { data: user } = useQuery({
    queryKey: ['currentUser'],
    queryFn: getCurrentUser,
  })

  useEffect(() => {
    const checkMasterMode = () => {
      const domain = localStorage.getItem('tenant_domain')
      const legacy = localStorage.getItem('company_mode') === 'master'
      setIsMasterMode(domain === 'master' || legacy)
    }
    checkMasterMode()
    // Listen for changes
    const handleStorageChange = () => checkMasterMode()
    window.addEventListener('storage', handleStorageChange)
    return () => window.removeEventListener('storage', handleStorageChange)
  }, [])

  // Load sidebar width from localStorage on mount
  useEffect(() => {
    const savedWidth = localStorage.getItem(SIDEBAR_WIDTH_KEY)
    if (savedWidth) {
      const width = parseInt(savedWidth, 10)
      if (width >= 200 && width <= 500) {
        setSidebarWidth(width)
      }
    }
    
    // Check if desktop
    setIsDesktop(window.innerWidth >= 1024)
  }, [])

  // Save sidebar width to localStorage when it changes
  const handleWidthChange = (width: number) => {
    setSidebarWidth(width)
    localStorage.setItem(SIDEBAR_WIDTH_KEY, width.toString())
  }

  // Close sidebar on mobile when route changes and handle desktop detection
  useEffect(() => {
    const handleResize = () => {
      const desktop = window.innerWidth >= 1024
      setIsDesktop(desktop)
      if (desktop) {
        setSidebarOpen(false)
      }
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  return (
    <div className="min-h-screen bg-background flex">
      <Sidebar />

        <div 
        className="flex-1 flex flex-col print:!ml-0"
        style={{ 
          marginLeft: isDesktop ? `${sidebarWidth}px` : '0',
          transition: 'margin-left 0.2s ease-in-out'
        }}
      >
        {/* ERP/SaaS Tab Switcher - Top Left Corner */}
        <div className="sticky top-0 z-40 print:hidden">
          <ERPSaaSSwitcher />
        </div>
        
        {/* Top Navigation Bar */}
        <header className="bg-white shadow-sm border-b border-gray-200 sticky top-0 z-30 print:hidden">
          <div className="px-4 sm:px-6 lg:px-8">
            <div className="flex items-center justify-between h-16">
              {/* Mobile menu button */}
              <button
                onClick={() => setSidebarOpen(!sidebarOpen)}
                className="lg:hidden p-2 rounded-md text-gray-500 hover:text-gray-700 hover:bg-gray-100"
                aria-label="Toggle sidebar"
              >
                <svg
                  className="h-6 w-6"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 6h16M4 12h16M4 18h16"
                  />
                </svg>
              </button>

              {/* Page title - can be dynamic based on route */}
              <div className="flex-1 lg:ml-0 flex items-center gap-3">
                <h1 className="text-lg font-semibold text-gray-900">
                  Multi-Tenant ERP
                </h1>
                {isMasterMode && (
                  <div className="flex items-center gap-2 px-3 py-1 bg-gradient-to-r from-yellow-400 to-yellow-500 rounded-full shadow-md animate-pulse">
                    <svg
                      className="w-4 h-4 text-yellow-900"
                      fill="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path d="M5 16L3 5l5.5 5L12 4l3.5 6L21 5l-2 11H5zm14 3c0 1.66-1.34 3-3 3s-3-1.34-3-3 1.34-3 3-3 3 1.34 3 3z" />
                    </svg>
                    <span className="text-xs font-bold text-yellow-900">MASTER MODE</span>
                  </div>
                )}
              </div>

              {/* Company Switcher */}
              <div className="flex items-center space-x-4">
                <CompanySwitcher />
              </div>

              {/* User menu */}
              <div className="flex items-center space-x-4">
                <div className="hidden sm:block text-sm text-gray-700">
                  <span className="font-medium">{user?.full_name || 'User'}</span>
                  <span className="text-gray-500 ml-2">{user?.email}</span>
                </div>
                <button
                  onClick={logout}
                  className="px-4 py-2 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-md transition-colors shadow-sm"
                >
                  Logout
                </button>
              </div>
            </div>
          </div>
        </header>

        {/* Main Content */}
        <main className="flex-1 overflow-hidden flex flex-col print:overflow-visible">
          <div className="flex-1 overflow-y-auto print:overflow-visible">
            <div className="py-4 sm:py-6 print:py-2 sm:print:py-2">
              <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 print:px-0 print:max-w-none">
                <div className="print:hidden">
                  <BackendStatus />
                </div>
                {children}
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}

