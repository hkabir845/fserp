'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

/** Legacy route — chart of accounts lives at `/chart-of-accounts`. */
export default function AccountsRedirectPage() {
  const router = useRouter()
  useEffect(() => {
    router.replace('/chart-of-accounts')
  }, [router])
  return (
    <div className="flex min-h-[40vh] items-center justify-center text-sm text-muted-foreground">
      Redirecting to Chart of accounts…
    </div>
  )
}
