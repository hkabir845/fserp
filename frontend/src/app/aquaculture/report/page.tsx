'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

/** Legacy URL — P&L: site & ponds now lives under Reports. */
export default function AquacultureReportRedirectPage() {
  const router = useRouter()
  useEffect(() => {
    router.replace('/reports?report=aquaculture-pl-management&category=aquaculture')
  }, [router])
  return (
    <div className="flex min-h-[40vh] items-center justify-center px-4 text-sm text-slate-600">
      Opening report in Reports…
    </div>
  )
}
