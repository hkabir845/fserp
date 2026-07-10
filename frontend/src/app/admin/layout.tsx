'use client'

import { ErpRouteShell } from '@/components/ErpRouteShell'

/** Admin routes share the same responsive ERP shell as operational pages. */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <ErpRouteShell>{children}</ErpRouteShell>
}
