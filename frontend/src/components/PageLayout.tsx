'use client'

import { ReactNode } from 'react'
import Sidebar from './Sidebar'
import { MasterCompanyBanner, TenantCompanyBanner } from './MasterCompanyBanner'

interface PageLayoutProps {
  children: ReactNode
  className?: string
  /** When true, the page controls its own scroll regions (header/toolbar fixed, body scrolls). */
  containScroll?: boolean
}

/**
 * PageLayout Component
 * Provides consistent layout with Sidebar and Master/Tenant company banners
 */
export default function PageLayout({ children, className = '', containScroll = false }: PageLayoutProps) {
  return (
    <div className={`page-with-sidebar flex h-dvh max-h-dvh min-h-0 w-full min-w-0 max-w-full flex-row bg-gray-100 md:h-[calc(100dvh-var(--erp-os-bottom-chrome))] md:max-h-[calc(100dvh-var(--erp-os-bottom-chrome))] ${className}`}>
      <Sidebar />
      <div className="erp-main-column flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {/* Master/Tenant Company Banner */}
        <MasterCompanyBanner />
        <TenantCompanyBanner />
        
        {/* Main Content — scrolls independently of the sidebar menubar */}
        <div
          className={
            containScroll
              ? 'min-h-0 flex-1 overflow-hidden'
              : 'min-h-0 flex-1 overflow-y-auto overscroll-contain'
          }
        >
          {children}
        </div>
      </div>
    </div>
  )
}
