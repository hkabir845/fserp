'use client'

import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { PlatformLayout } from '@/components/PlatformLayout'
import { formatDateOnly } from '@/utils/date'
import { getPlatformUser } from '@/lib/platform-auth'

interface Tenant {
  id: number
  name: string
  domain: string
  is_active: boolean
  created_at: string
  subscription?: {
    id: number
    status: string
    plan_name: string
  }
  user_count?: number
}

interface PlatformStats {
  total_tenants: number
  active_tenants: number
  trial_tenants: number
  total_revenue: number
  monthly_revenue: number
  active_subscriptions: number
}

export default function PlatformDashboard() {
  const router = useRouter()
  const [selectedTenant, setSelectedTenant] = useState<number | null>(null)
  const [isMounted, setIsMounted] = useState(false)
  const platformUser = getPlatformUser()
  
  // For superadmin, create a mock platform user if needed
  const displayUser = platformUser || {
    id: 0,
    email: 'superadmin@fmerp.com',
    full_name: 'Super Admin',
    is_super_admin: true
  }

  const { data: stats, isLoading: statsLoading } = useQuery<PlatformStats>({
    queryKey: ['platform-stats'],
    queryFn: async () => {
      const response = await api.get('/platform/stats')
      return response.data
    },
    refetchInterval: 30000, // Refresh every 30 seconds
  })

  const { data: tenants, isLoading: tenantsLoading, refetch } = useQuery<Tenant[]>({
    queryKey: ['platform-tenants'],
    queryFn: async () => {
      const response = await api.get('/platform/tenants?limit=100')
      return response.data
    },
  })

  const handleTenantClick = (tenant: Tenant) => {
    // Switch to tenant view
    localStorage.setItem('tenant_domain', tenant.domain)
    localStorage.setItem('is_platform_mode', 'false')
    router.push('/dashboard')
  }

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: 'BDT',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount)
  }

  const getStatusBadge = (status: string) => {
    const colors: Record<string, string> = {
      active: 'bg-green-100 text-green-800',
      trial: 'bg-blue-100 text-blue-800',
      suspended: 'bg-yellow-100 text-yellow-800',
      cancelled: 'bg-red-100 text-red-800',
      expired: 'bg-gray-100 text-gray-800',
    }
    return colors[status] || 'bg-gray-100 text-gray-800'
  }

  useEffect(() => {
    setIsMounted(true)
    if (!platformUser) {
      const token = localStorage.getItem('platform_token') || localStorage.getItem('access_token')
      if (!token) {
        router.push('/login')
      }
    }
  }, [platformUser, router])

  // Avoid SSR/SSG localStorage access during build/prerender
  if (!isMounted) return null

  return (
    <PlatformLayout>
      <div className="py-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          {/* Master Company Card */}
          <div className="bg-gradient-to-r from-purple-600 to-purple-800 rounded-lg shadow-lg p-6 mb-8 text-white">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-2xl font-bold mb-2">Master Company</h2>
                <p className="text-purple-100 text-lg mb-1">FMERP Platform</p>
                <p className="text-purple-200 text-sm">Multi-Tenant SaaS Management System</p>
              </div>
              <div className="text-right">
                <div className="bg-white bg-opacity-20 rounded-lg px-4 py-2 mb-2">
                  <p className="text-xs text-purple-200 uppercase tracking-wide">Platform Status</p>
                  <p className="text-lg font-semibold">Operational</p>
                </div>
                <button
                  onClick={() => router.push('/platform/settings')}
                  className="mt-2 px-4 py-2 bg-white text-purple-600 rounded-md hover:bg-purple-50 text-sm font-medium transition-colors"
                >
                  Manage Company
                </button>
              </div>
            </div>
          </div>

          {/* Statistics Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
            <div className="bg-white rounded-lg shadow p-6 border-l-4 border-purple-500">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600">Total Tenants</p>
                  <p className="text-3xl font-bold text-gray-900 mt-2">
                    {statsLoading ? '...' : stats?.total_tenants || 0}
                  </p>
                  <p className="text-xs text-gray-500 mt-1">
                    {stats?.active_tenants || 0} active
                  </p>
                </div>
                <div className="bg-purple-100 rounded-full p-3">
                  <svg className="h-6 w-6 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                  </svg>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow p-6 border-l-4 border-green-500">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600">Active Subscriptions</p>
                  <p className="text-3xl font-bold text-gray-900 mt-2">
                    {statsLoading ? '...' : stats?.active_subscriptions || 0}
                  </p>
                  <p className="text-xs text-gray-500 mt-1">
                    {stats?.trial_tenants || 0} on trial
                  </p>
                </div>
                <div className="bg-green-100 rounded-full p-3">
                  <svg className="h-6 w-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow p-6 border-l-4 border-blue-500">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600">Monthly Revenue</p>
                  <p className="text-3xl font-bold text-gray-900 mt-2">
                    {statsLoading ? '...' : formatCurrency(stats?.monthly_revenue || 0)}
                  </p>
                  <p className="text-xs text-gray-500 mt-1">
                    Total: {formatCurrency(stats?.total_revenue || 0)}
                  </p>
                </div>
                <div className="bg-blue-100 rounded-full p-3">
                  <svg className="h-6 w-6 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
              </div>
            </div>
          </div>

          {/* Tenants Table */}
          <div className="bg-white rounded-lg shadow">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <h2 className="text-xl font-bold text-gray-900">Tenants</h2>
              <button
                onClick={() => router.push('/platform/tenants/new')}
                className="px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700 text-sm font-medium flex items-center gap-2"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                New Tenant
              </button>
            </div>

            {tenantsLoading ? (
              <div className="p-12 text-center">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600 mx-auto mb-4"></div>
                <p className="text-gray-600">Loading tenants...</p>
              </div>
            ) : tenants && tenants.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Tenant
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Domain
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Subscription
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Users
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Status
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {tenants.map((tenant) => (
                      <tr
                        key={tenant.id}
                        className={`hover:bg-gray-50 cursor-pointer ${selectedTenant === tenant.id ? 'bg-purple-50' : ''}`}
                        onClick={() => handleTenantClick(tenant)}
                      >
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm font-medium text-gray-900">{tenant.name}</div>
                          <div className="text-xs text-gray-500">
                            Created: {formatDateOnly(tenant.created_at)}
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm text-gray-900">{tenant.domain}</div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          {tenant.subscription ? (
                            <div>
                              <div className="text-sm text-gray-900">{tenant.subscription.plan_name || 'N/A'}</div>
                              <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getStatusBadge(tenant.subscription.status)}`}>
                                {tenant.subscription.status}
                              </span>
                            </div>
                          ) : (
                            <span className="text-sm text-gray-400">No subscription</span>
                          )}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {tenant.user_count || 0}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                            tenant.is_active ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                          }`}>
                            {tenant.is_active ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium" onClick={(e) => e.stopPropagation()}>
                          <button
                            onClick={() => router.push(`/platform/tenants/${tenant.id}`)}
                            className="text-purple-600 hover:text-purple-900 mr-4"
                          >
                            View
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="p-12 text-center">
                <svg className="mx-auto h-12 w-12 text-gray-400 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                </svg>
                <h3 className="text-lg font-medium text-gray-900 mb-1">No tenants found</h3>
                <p className="text-gray-500 mb-4">Get started by creating a new tenant</p>
                <button
                  onClick={() => router.push('/platform/tenants/new')}
                  className="px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700"
                >
                  Create Tenant
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </PlatformLayout>
  )
}

