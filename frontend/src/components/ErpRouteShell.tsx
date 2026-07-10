'use client'

import PageLayout from '@/components/PageLayout'

interface ErpRouteShellProps {
  children: React.ReactNode
  className?: string
  containScroll?: boolean
}

/** Standard ERP page shell: off-canvas sidebar, company banners, responsive padding. */
export function ErpRouteShell({ children, className = '', containScroll = false }: ErpRouteShellProps) {
  return (
    <PageLayout className={className} containScroll={containScroll}>
      <div className="app-scroll-pad">{children}</div>
    </PageLayout>
  )
}
