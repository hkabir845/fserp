'use client'

import { ReactNode } from 'react'
import Sidebar from './Sidebar'
import { MasterCompanyBanner, TenantCompanyBanner } from './MasterCompanyBanner'

interface PageLayoutProps {
  children: ReactNode
  className?: string
}

/**
 * PageLayout Component
 * Provides consistent layout with Sidebar and Master/Tenant company banners
 */
export default function PageLayout({ children, className = '' }: PageLayoutProps) {
  return (
    <div className={`page-with-sidebar flex h-screen bg-gray-100 ${className}`}>
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Master/Tenant Company Banner */}
        <MasterCompanyBanner />
        <TenantCompanyBanner />
        
        {/* Main Content */}
        <div className="flex-1 overflow-y-auto">
          {children}
        </div>
      </div>
    </div>
  )
}
