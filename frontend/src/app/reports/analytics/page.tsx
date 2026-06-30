'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

/** Legacy URL — analytics is embedded in the main Reports page. */
export default function FinancialAnalyticsRedirectPage() {
  const router = useRouter()
  useEffect(() => {
    router.replace('/reports?report=analytics-kpi&category=analytical')
  }, [router])
  return (
    <div className="flex min-h-[40vh] items-center justify-center px-4 text-sm text-muted-foreground">
      Opening Analytics &amp; KPIs…
    </div>
  )
}
