'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { api } from '@/lib/api'
import { PlatformLayout } from '@/components/PlatformLayout'
import { getPlatformUser } from '@/lib/platform-auth'
import { formatDateOnly } from '@/utils/date'

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

function subscriptionBadgeClass(status: string) {
  const colors: Record<string, string> = {
    active: 'bg-green-100 text-green-800',
    trial: 'bg-blue-100 text-blue-800',
    suspended: 'bg-yellow-100 text-yellow-800',
    cancelled: 'bg-red-100 text-red-800',
    expired: 'bg-gray-100 text-gray-800',
  }
  return colors[status] || 'bg-gray-100 text-gray-800'
}

export default function PlatformTenantsBrowsePage() {
  const router = useRouter()
  const [isMounted, setIsMounted] = useState(false)
  const [search, setSearch] = useState('')
  const platformUser = getPlatformUser()

  useEffect(() => {
    setIsMounted(true)
    const token = localStorage.getItem('platform_token') || localStorage.getItem('access_token')
    if (!token) {
      router.push('/login')
    }
  }, [router])

  const {
    data: tenants = [],
    isLoading,
    isError,
    error,
    refetch,
    isFetching,
  } = useQuery<Tenant[]>({
    queryKey: ['platform-tenants'],
    queryFn: async () => {
      const response = await api.get<Tenant[]>('/platform/tenants?limit=200')
      return response.data
    },
    enabled: isMounted,
    retry: 1,
  })

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return tenants
    return tenants.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        t.domain.toLowerCase().includes(q) ||
        String(t.id).includes(q)
    )
  }, [tenants, search])

  const errDetail =
    (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
    (error as Error)?.message

  function openInErp(tenant: Tenant) {
    localStorage.setItem('tenant_domain', tenant.domain)
    localStorage.setItem('company_mode', 'tenant')
    localStorage.setItem('is_platform_mode', 'false')
    router.push('/dashboard')
  }

  if (!isMounted) {
    return null
  }

  return (
    <PlatformLayout>
      <div className="py-8">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">All tenants</h1>
              <p className="mt-1 text-sm text-gray-600">
                Directory from the platform API. Use “Open in ERP” to work inside a tenant context.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => refetch()}
                disabled={isFetching}
                className="inline-flex items-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 disabled:opacity-50"
              >
                {isFetching ? 'Refreshing…' : 'Refresh'}
              </button>
              <Link
                href="/platform/tenants/new"
                className="inline-flex items-center rounded-md bg-purple-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-purple-700"
              >
                New tenant
              </Link>
            </div>
          </div>

          {platformUser && (
            <p className="mb-4 text-xs text-gray-500">
              Signed in as <span className="font-mono text-gray-700">{platformUser.email}</span>
            </p>
          )}

          <div className="mb-4">
            <label htmlFor="tenant-search" className="sr-only">
              Search tenants
            </label>
            <input
              id="tenant-search"
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, domain, or ID…"
              className="w-full max-w-md rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500"
            />
          </div>

          {isLoading && (
            <div className="rounded-lg border border-gray-200 bg-white p-12 text-center text-gray-500">Loading tenants…</div>
          )}

          {isError && !isLoading && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
              <p className="font-medium">Could not load tenants</p>
              <p className="mt-1">{errDetail || 'Request failed. Check that you are logged in with platform or superadmin access.'}</p>
              <button
                type="button"
                onClick={() => refetch()}
                className="mt-3 text-sm font-semibold text-red-900 underline hover:no-underline"
              >
                Try again
              </button>
            </div>
          )}

          {!isLoading && !isError && filtered.length === 0 && tenants.length === 0 && (
            <div className="rounded-lg border border-gray-200 bg-white p-12 text-center">
              <h3 className="text-lg font-medium text-gray-900">No tenants in database</h3>
              <p className="mt-2 text-gray-500">Create a tenant or run your seed scripts.</p>
              <Link
                href="/platform/tenants/new"
                className="mt-4 inline-flex rounded-md bg-purple-600 px-4 py-2 text-sm font-semibold text-white hover:bg-purple-700"
              >
                Create tenant
              </Link>
            </div>
          )}

          {!isLoading && !isError && filtered.length === 0 && tenants.length > 0 && (
            <div className="rounded-lg border border-gray-200 bg-white p-8 text-center text-gray-600">
              No tenants match “{search}”.
            </div>
          )}

          {!isLoading && !isError && filtered.length > 0 && (
            <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow">
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                        Tenant
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                        Domain
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                        Subscription
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                        Users
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                        Status
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 bg-white">
                    {filtered.map((tenant) => (
                      <tr key={tenant.id} className="hover:bg-gray-50">
                        <td className="whitespace-nowrap px-4 py-3">
                          <div className="text-sm font-medium text-gray-900">{tenant.name}</div>
                          <div className="text-xs text-gray-500">
                            ID {tenant.id} · {formatDateOnly(tenant.created_at)}
                          </div>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-900">
                          <span className="font-mono">{tenant.domain}</span>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3">
                          {tenant.subscription ? (
                            <div>
                              <div className="text-sm text-gray-900">{tenant.subscription.plan_name || '—'}</div>
                              <span
                                className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${subscriptionBadgeClass(
                                  tenant.subscription.status
                                )}`}
                              >
                                {tenant.subscription.status}
                              </span>
                            </div>
                          ) : (
                            <span className="text-sm text-gray-400">—</span>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-900">{tenant.user_count ?? 0}</td>
                        <td className="whitespace-nowrap px-4 py-3">
                          <span
                            className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${
                              tenant.is_active ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                            }`}
                          >
                            {tenant.is_active ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right text-sm">
                          <div className="flex flex-col items-end gap-1 sm:flex-row sm:justify-end sm:gap-3">
                            <Link
                              href={`/platform/tenants/${tenant.id}/backup`}
                              className="font-medium text-gray-700 hover:text-gray-900"
                            >
                              Backup
                            </Link>
                            <button
                              type="button"
                              onClick={() => openInErp(tenant)}
                              className="font-medium text-purple-600 hover:text-purple-900"
                            >
                              Open in ERP
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="border-t border-gray-100 bg-gray-50 px-4 py-2 text-xs text-gray-500">
                Showing {filtered.length} of {tenants.length} tenant{tenants.length === 1 ? '' : 's'}
              </div>
            </div>
          )}
        </div>
      </div>
    </PlatformLayout>
  )
}
