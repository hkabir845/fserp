'use client'

import { useState, useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { isPlatformMode } from '@/lib/platform-auth'

export function ERPSaaSSwitcher() {
  const router = useRouter()
  const pathname = usePathname()
  const [isPlatform, setIsPlatform] = useState(false)

  useEffect(() => {
    setIsPlatform(isPlatformMode() || pathname?.startsWith('/platform'))
  }, [pathname])

  const switchToERP = () => {
    localStorage.setItem('is_platform_mode', 'false')
    setIsPlatform(false)
    router.push('/dashboard')
  }

  const switchToPlatform = () => {
    localStorage.setItem('is_platform_mode', 'true')
    setIsPlatform(true)
    router.push('/platform/dashboard')
  }

  // Don't show on login page
  if (pathname === '/login') {
    return null
  }

  return (
    <div className="bg-white border-b border-border shadow-sm">
      <div className="flex items-center">
        {/* ERP Operations Tab */}
        <button
          onClick={switchToERP}
          className={`px-6 py-3 text-sm font-medium transition-all duration-200 border-b-2 ${
            !isPlatform
              ? 'border-primary text-primary bg-accent font-semibold'
              : 'border-transparent text-muted-foreground hover:text-primary hover:border-primary/30 hover:bg-accent/50'
          }`}
        >
          <div className="flex items-center gap-2">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <span>ERP Operations</span>
          </div>
        </button>

        {/* SaaS Dashboard Tab */}
        <button
          onClick={switchToPlatform}
          className={`px-6 py-3 text-sm font-medium transition-all duration-200 border-b-2 ${
            isPlatform
              ? 'border-purple-600 text-purple-600 bg-purple-50 font-semibold'
              : 'border-transparent text-muted-foreground hover:text-purple-600 hover:border-purple-300 hover:bg-purple-50/50'
          }`}
        >
          <div className="flex items-center gap-2">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
            <span>SaaS Dashboard</span>
          </div>
        </button>
      </div>
    </div>
  )
}

