'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Sidebar from '@/components/Sidebar'
import { CompanyProvider, useCompany } from '@/contexts/CompanyContext'
import Link from 'next/link'
import { Building2, Users, MapPin, TrendingUp, CreditCard, ChevronRight } from 'lucide-react'
import { useToast } from '@/components/Toast'
import api from '@/lib/api'
import { formatCurrency } from '@/utils/currency'
import { safeLogError, isConnectionError } from '@/utils/connectionError'

interface PlatformStats {
  total_companies: number
  active_companies: number
  inactive_companies: number
  total_users: number
  total_customers: number
  total_vendors: number
  total_stations: number
  total_sales: number
  total_invoices: number
  users_by_role: Record<string, number>
}

function OverviewPageContent() {
  const router = useRouter()
  const toast = useToast()
  const { mode } = useCompany()
  const [stats, setStats] = useState<PlatformStats | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const token = localStorage.getItem('access_token')
    if (!token) {
      router.push('/login')
      return
    }

    // Get user role
    const userStr = localStorage.getItem('user')
    if (userStr && userStr !== 'undefined' && userStr !== 'null') {
      try {
        const user = JSON.parse(userStr)
        const role = user.role?.toLowerCase() || null
        
        // Only allow SUPER_ADMIN to access this page
        if (role !== 'super_admin') {
          toast.error('Access denied. Super Admin access required.')
          router.push('/dashboard')
          return
        }
      } catch (error) {
        safeLogError('Error parsing user data:', error)
      }
    }

    // If mode is FSMS ERP, show message instead of redirecting
    // This allows user to see the page and switch mode if needed
    if (mode === 'fsms_erp') {
      setLoading(false)
      return
    }

    // Only fetch if in SaaS Dashboard mode
    if (mode === 'saas_dashboard') {
      fetchPlatformStats()
    } else {
      // If mode is not set yet, set loading to false immediately
      // This ensures the page renders even if mode hasn't initialized
      setLoading(false)
    }
  }, [mode, router]) // Only depend on mode to avoid infinite loops

  const fetchPlatformStats = async () => {
    try {
      setLoading(true)
      
      const response = await api.get('/admin/stats')
      
      if (response.data) {
        setStats(response.data)
      } else {
        if (!isConnectionError({ response: response })) {
          toast.error('No statistics data received')
        }
      }
    } catch (error: any) {
      // Silently handle connection errors - backend may not be running
      // Browser will still log network errors, but we won't add to the noise
      if (!isConnectionError(error)) {
        safeLogError('[Overview] Error fetching platform stats:', error)
      }
      
      if (error.response?.status === 403) {
        toast.error('Access denied. Super Admin access required.')
        router.push('/dashboard')
      } else if (error.response?.status === 500) {
        if (!isConnectionError(error)) {
          toast.error('Server error. Please check backend logs.')
        }
      } else if (!isConnectionError(error)) {
        // Only show toast for non-connection errors
        if (error.code === 'ECONNABORTED' || error.message?.includes('timeout')) {
          toast.error('Request timed out. The server may be slow or unresponsive.')
        } else {
          toast.error(`Failed to load platform statistics: ${error.message || 'Unknown error'}`)
        }
      }
      // Connection errors are handled silently - no toast needed
    } finally {
      setLoading(false)
    }
  }

  // Show message if not in SaaS Dashboard mode
  // Also handle case where mode might not be initialized yet
  if (!mode || mode !== 'saas_dashboard') {
    return (
      <div className="flex h-screen bg-gray-100 page-with-sidebar">
        <Sidebar />
        <div className="flex min-h-0 flex-1 overflow-y-auto p-4 sm:p-8">
          <div className="w-full rounded-lg bg-white p-6 text-center shadow sm:p-8">
            <Building2 className="h-12 w-12 text-gray-400 mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-gray-900 mb-2">Platform Overview</h2>
            <p className="text-gray-600 mb-4">Please switch to SaaS Dashboard mode to view platform overview.</p>
            <p className="text-sm text-gray-500">Use the mode switcher in the sidebar to switch to SaaS Dashboard mode.</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-screen bg-gray-100 page-with-sidebar">
      <Sidebar />
      <div className="flex min-h-0 flex-1 overflow-y-auto">
        <div className="w-full min-w-0 p-4 sm:p-6 lg:p-8">
          {loading ? (
            <div className="bg-white rounded-lg shadow app-modal-pad text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
              <p className="text-gray-600">Loading platform statistics...</p>
            </div>
          ) : stats ? (
            <>
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-6">
                <h1 className="text-2xl font-bold text-gray-900">Platform Overview</h1>
                <Link
                  href="/admin/subscription-billing"
                  className="group flex items-center gap-3 rounded-xl border border-indigo-200 bg-gradient-to-r from-indigo-50 to-violet-50 px-4 py-3 shadow-sm hover:border-indigo-300 hover:shadow transition-all max-w-md"
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-indigo-600 text-white">
                    <CreditCard className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 text-left">
                    <p className="text-sm font-semibold text-indigo-950">Subscription &amp; Billing</p>
                    <p className="text-xs text-indigo-800/90">
                      Manage tenant cycles, renewals, and SaaS ledger invoices in one place.
                    </p>
                  </div>
                  <ChevronRight className="h-5 w-5 text-indigo-400 shrink-0 group-hover:translate-x-0.5 transition-transform" />
                </Link>
              </div>
              {/* Platform Statistics */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
                <div className="bg-white rounded-lg shadow p-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-gray-600">Total Companies</p>
                      <p className="text-2xl font-bold text-gray-900 mt-1">{stats.total_companies}</p>
                      <p className="text-xs text-gray-500 mt-1">
                        {stats.active_companies} active, {stats.inactive_companies} inactive
                      </p>
                    </div>
                    <div className="p-3 bg-blue-100 rounded-full">
                      <Building2 className="h-6 w-6 text-blue-600" />
                    </div>
                  </div>
                </div>

                <div className="bg-white rounded-lg shadow p-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-gray-600">Total Users</p>
                      <p className="text-2xl font-bold text-gray-900 mt-1">{stats.total_users}</p>
                      <p className="text-xs text-gray-500 mt-1">Across all companies</p>
                    </div>
                    <div className="p-3 bg-green-100 rounded-full">
                      <Users className="h-6 w-6 text-green-600" />
                    </div>
                  </div>
                </div>

                <div className="bg-white rounded-lg shadow p-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-gray-600">Total Stations</p>
                      <p className="text-2xl font-bold text-gray-900 mt-1">{stats.total_stations}</p>
                      <p className="text-xs text-gray-500 mt-1">Across all companies</p>
                    </div>
                    <div className="p-3 bg-purple-100 rounded-full">
                      <MapPin className="h-6 w-6 text-purple-600" />
                    </div>
                  </div>
                </div>

                <div className="bg-white rounded-lg shadow p-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-gray-600">Total Sales</p>
                      <p className="text-2xl font-bold text-gray-900 mt-1">
                        {formatCurrency(stats.total_sales, 'BDT')}
                      </p>
                      <p className="text-xs text-gray-500 mt-1">All companies, all time</p>
                    </div>
                    <div className="p-3 bg-yellow-100 rounded-full">
                      <TrendingUp className="h-6 w-6 text-yellow-600" />
                    </div>
                  </div>
                </div>
              </div>

              {/* Additional Stats */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                <div className="bg-white rounded-lg shadow p-6">
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">Users by Role</h3>
                  <div className="space-y-2">
                    {Object.entries(stats.users_by_role).map(([role, count]) => (
                      <div key={role} className="flex justify-between items-center">
                        <span className="text-sm text-gray-600 capitalize">{role.replace('_', ' ')}</span>
                        <span className="text-sm font-semibold text-gray-900">{count}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="bg-white rounded-lg shadow p-6">
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">Resource Summary</h3>
                  <div className="space-y-2">
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-gray-600">Customers</span>
                      <span className="text-sm font-semibold text-gray-900">{stats.total_customers}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-gray-600">Vendors</span>
                      <span className="text-sm font-semibold text-gray-900">{stats.total_vendors}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-gray-600">Invoices</span>
                      <span className="text-sm font-semibold text-gray-900">{stats.total_invoices}</span>
                    </div>
                  </div>
                </div>

                <div className="bg-white rounded-lg shadow p-6">
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">Company Status</h3>
                  <div className="space-y-2">
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-gray-600">Active</span>
                      <span className="text-sm font-semibold text-green-600">{stats.active_companies}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-gray-600">Inactive</span>
                      <span className="text-sm font-semibold text-red-600">{stats.inactive_companies}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-gray-600">With Subscription</span>
                      <span className="text-sm font-semibold text-blue-600">{stats.active_companies}</span>
                    </div>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="bg-white rounded-lg shadow app-modal-pad text-center">
              <Building2 className="h-12 w-12 text-gray-400 mx-auto mb-4" />
              <h2 className="text-xl font-semibold text-gray-900 mb-2">Platform Overview</h2>
              <p className="text-gray-600 text-lg mb-2">No statistics available</p>
              <p className="text-gray-500 text-sm mb-4">
                Backend server is not running. Please start the backend server to view platform statistics.
              </p>
              <button
                onClick={fetchPlatformStats}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                Retry
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default function OverviewPage() {
  return (
    <CompanyProvider>
      <OverviewPageContent />
    </CompanyProvider>
  )
}

