'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Sidebar from '@/components/Sidebar'
import { DollarSign } from 'lucide-react'

export default function AccountsPage() {
  const router = useRouter()

  useEffect(() => {
    const token = localStorage.getItem('access_token')
    if (!token) {
      router.push('/login')
      return
    }
  }, [])

  return (
    <div className="page-with-sidebar flex h-screen min-h-0 bg-gray-50">
      <Sidebar />
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <main className="flex-1 min-h-0 overflow-y-auto bg-gray-50 app-scroll-pad">
        <div className="max-w-7xl mx-auto">
          <h1 className="text-3xl font-bold text-gray-900 mb-8">Chart of Accounts</h1>
          
          <div className="bg-white rounded-lg shadow p-12 text-center">
            <DollarSign className="mx-auto text-gray-400 mb-4" size={64} />
            <p className="text-gray-600 text-lg mb-2">Chart of Accounts Management</p>
            <p className="text-gray-500 text-sm">
              Configure your accounting structure (Assets, Liabilities, Equity, Income, Expenses)
            </p>
            <p className="text-gray-400 text-xs mt-4">
              API endpoint ready at: GET/POST /api/accounts
            </p>
          </div>
        </div>
      </main>
      </div>
    </div>
  )
}

















