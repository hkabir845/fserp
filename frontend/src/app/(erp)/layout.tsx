'use client'

import { ErpRouteShell } from '@/components/ErpRouteShell'

export default function ErpLayout({ children }: { children: React.ReactNode }) {
  return <ErpRouteShell>{children}</ErpRouteShell>
}