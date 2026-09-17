'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

/**
 * Fish pond transfers are retired as a product surface.
 * Historical transfer rows remain in the database for stock/P&L history.
 * New fish moves are recorded as sales.
 */
export default function AquacultureTransfersRedirectPage() {
  const router = useRouter()
  useEffect(() => {
    router.replace('/aquaculture/sales')
  }, [router])
  return (
    <div className="flex min-h-[40vh] items-center justify-center p-6 text-sm text-muted-foreground">
      Redirecting to pond &amp; fish sales…
    </div>
  )
}
