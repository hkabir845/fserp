'use client'

import { useState, useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { isPlatformMode, platformLogout, getPlatformUser } from '@/lib/platform-auth'
import { getCurrentUser } from '@/lib/auth'

export function PlatformSwitcher() {
  const router = useRouter()
  const pathname = usePathname()
  const [isPlatform, setIsPlatform] = useState(false)
  const [showMenu, setShowMenu] = useState(false)

  useEffect(() => {
    setIsPlatform(isPlatformMode())
  }, [pathname])

  const switchToPlatform = () => {
    router.push('/platform/dashboard')
  }

  const switchToERP = () => {
    localStorage.setItem('is_platform_mode', 'false')
    setIsPlatform(false)
    router.push('/dashboard')
  }

  if (!isPlatform && pathname?.startsWith('/platform')) {
    return null // Don't show switcher on platform pages if not in platform mode
  }

  if (isPlatform) {
    return (
      <div className="relative">
        <button
          onClick={() => setShowMenu(!showMenu)}
          className="flex items-center gap-2 px-3 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700 text-sm font-medium"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
          </svg>
          <span>Platform Mode</span>
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        
        {showMenu && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setShowMenu(false)}></div>
            <div className="absolute right-0 mt-2 w-48 bg-white rounded-md shadow-lg z-50 border border-border">
              <div className="py-1">
                <button
                  onClick={switchToERP}
                  className="w-full text-left px-4 py-2 text-sm text-foreground/85 hover:bg-muted flex items-center gap-2"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  Switch to ERP
                </button>
                <div className="border-t border-border my-1"></div>
                <div className="px-4 py-2 text-xs text-muted-foreground">
                  Platform Admin
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    )
  }

  // Show ERP mode indicator with option to switch to platform
  return (
    <div className="relative">
      <button
        onClick={() => setShowMenu(!showMenu)}
        className="flex items-center gap-2 px-3 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 text-sm font-medium"
      >
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
        <span>ERP Mode</span>
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      
      {showMenu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setShowMenu(false)}></div>
          <div className="absolute right-0 mt-2 w-48 bg-white rounded-md shadow-lg z-50 border border-border">
            <div className="py-1">
              <button
                onClick={switchToPlatform}
                className="w-full text-left px-4 py-2 text-sm text-foreground/85 hover:bg-muted flex items-center gap-2"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
                Switch to Platform
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

