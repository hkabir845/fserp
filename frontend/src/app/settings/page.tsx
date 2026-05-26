'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

/** Legacy URL — company and admin settings live on dedicated pages. */
export default function SettingsRedirectPage() {
  const router = useRouter()
  useEffect(() => {
    router.replace('/company')
  }, [router])
  return (
    <div className="flex min-h-[40vh] items-center justify-center px-4 text-sm text-slate-600">
      Opening company settings…
    </div>
  )
}
