'use client'

import { useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

/** Legacy URL — P&L: site & ponds now lives under Reports. */
export default function AquacultureReportRedirectPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  useEffect(() => {
    const q = new URLSearchParams({
      report: 'aquaculture-pl-management',
      category: 'aquaculture',
    })
    for (const key of ['start_date', 'end_date', 'pond_id', 'archive_label', 'archive_close_id'] as const) {
      const v = searchParams.get(key)
      if (v) q.set(key, v)
    }
    router.replace(`/reports?${q.toString()}`)
  }, [router, searchParams])
  return (
    <div className="flex min-h-[40vh] items-center justify-center px-4 text-sm text-slate-600">
      Opening report in Reports…
    </div>
  )
}
