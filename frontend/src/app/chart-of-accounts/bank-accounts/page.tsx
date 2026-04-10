'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

/** Legacy URL: bank UI now lives on the main Chart of accounts page. */
export default function BankAccountsNestedRedirectPage() {
  const router = useRouter()
  useEffect(() => {
    router.replace('/chart-of-accounts')
  }, [router])
  return (
    <div className="flex min-h-[40vh] items-center justify-center text-gray-600 text-sm">
      Redirecting to Chart of accounts…
    </div>
  )
}
