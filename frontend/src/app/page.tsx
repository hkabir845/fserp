'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import Link from 'next/link'

export default function Home() {
  const router = useRouter()
  const [mounted, setMounted] = useState(false)
  const [slowRedirect, setSlowRedirect] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (!mounted) return

    if (typeof window === 'undefined') return

    const t = setTimeout(() => setSlowRedirect(true), 4000)

    try {
      const token = localStorage.getItem('access_token')

      if (token && token !== 'undefined' && token !== 'null' && token.trim() !== '') {
        router.replace('/apps')
      } else {
        router.replace('/login')
      }
    } catch {
      router.replace('/login')
    }

    return () => clearTimeout(t)
  }, [mounted, router])

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <div className="text-center max-w-md px-4">
        <h1 className="text-4xl font-bold mb-4 text-gray-900">Filling Station ERP</h1>
        <p className="text-gray-600">Loading...</p>
        <div className="mt-4">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
        </div>
        {slowRedirect && (
          <div className="mt-6 p-4 bg-white rounded-lg shadow border border-gray-200">
            <p className="text-sm text-gray-600 mb-3">Taking too long?</p>
            <div className="flex flex-col gap-2">
              <Link
                href="/login"
                className="text-blue-600 hover:underline font-medium"
              >
                Go to Login
              </Link>
              <Link
                href="/apps"
                className="text-blue-600 hover:underline font-medium"
              >
                Go to Apps
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
