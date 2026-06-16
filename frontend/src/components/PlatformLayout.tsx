'use client'

import { useState, useEffect } from 'react'
import { PlatformSidebar } from './PlatformSidebar'
import { ERPSaaSSwitcher } from './ERPSaaSSwitcher'
import { getPlatformUser, platformLogout } from '@/lib/platform-auth'
import { logout } from '@/lib/auth'
import { useRouter } from 'next/navigation'

interface PlatformLayoutProps {
  children: React.ReactNode
}

export function PlatformLayout({ children }: PlatformLayoutProps) {
  const router = useRouter()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [sidebarWidth, setSidebarWidth] = useState(256) // Default width: w-64 = 256px
  const [isDesktop, setIsDesktop] = useState(false)

  // Load sidebar width from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('platform-sidebar-width')
    if (saved) {
      const width = parseInt(saved, 10)
      if (width >= 200 && width <= 600) {
        setSidebarWidth(width)
      }
    }
  }, [])

  // Save sidebar width to localStorage
  useEffect(() => {
    localStorage.setItem('platform-sidebar-width', sidebarWidth.toString())
  }, [sidebarWidth])

  // Handle window resize
  useEffect(() => {
    const handleResize = () => {
      setIsDesktop(window.innerWidth >= 1024) // lg breakpoint
      if (window.innerWidth >= 1024) {
        setSidebarOpen(false) // Close mobile sidebar on desktop
      }
    }

    handleResize()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  const handleWidthChange = (width: number) => {
    setSidebarWidth(width)
  }

  const platformUser = getPlatformUser()
  const displayUser = platformUser || {
    id: 0,
    email: 'superadmin@fmerp.com',
    full_name: 'Super Admin',
    is_super_admin: true
  }

  return (
    <div className="min-h-screen bg-gray-50 flex">
      <PlatformSidebar 
        isOpen={sidebarOpen} 
        onClose={() => setSidebarOpen(false)}
        width={sidebarWidth}
        onWidthChange={handleWidthChange}
      />

      <div 
        className="flex-1 flex flex-col"
        style={{ 
          marginLeft: isDesktop ? `${sidebarWidth}px` : '0',
          transition: 'margin-left 0.2s ease-in-out'
        }}
      >
        {/* ERP/SaaS Tab Switcher - Top Left Corner */}
        <div className="sticky top-0 z-40">
          <ERPSaaSSwitcher />
        </div>
        
        {/* Top Navigation Bar */}
        <header className="bg-white shadow-sm border-b border-gray-200 sticky top-0 z-30">
          <div className="px-4 sm:px-6 lg:px-8">
            <div className="flex items-center justify-between h-16">
              {/* Mobile menu button */}
              <button
                onClick={() => setSidebarOpen(true)}
                className="lg:hidden p-2 rounded-md text-gray-500 hover:text-gray-700 hover:bg-gray-100"
              >
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </button>

              <div className="flex items-center gap-4 flex-1">
                <h1 className="text-xl font-bold text-gray-900 hidden sm:block">SaaS Management Platform</h1>
              </div>

              <div className="flex items-center gap-4">
                <div className="text-sm text-gray-700">
                  <span className="font-medium">{displayUser.full_name}</span>
                </div>
                <button
                  onClick={() => {
                    platformLogout()
                    logout()
                    router.push('/login')
                  }}
                  className="px-4 py-2 text-sm font-medium text-gray-700 hover:text-gray-900 hover:bg-gray-100 rounded-md transition-colors"
                >
                  Logout
                </button>
              </div>
            </div>
          </div>
        </header>

        {/* Main Content */}
        <main className="flex-1">
          {children}
        </main>
      </div>
    </div>
  )
}

