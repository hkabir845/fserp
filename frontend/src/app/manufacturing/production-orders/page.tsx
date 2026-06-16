'use client'

import { ReportingHubBreadcrumb } from '@/components/ReportingHubBreadcrumb'
import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

interface ProductionOrder {
  id: number
  order_number: string
  bom_id: number
  batch_size_ton: number
  status: string
  planned_output_kg: number
  actual_output_kg?: number
  yield_pct?: number
  cost_per_kg?: number
}

function StatusPill({ status }: { status: string }) {
  const cls =
    status === 'completed'
      ? 'bg-green-50 text-green-700 ring-green-200'
      : status === 'in_progress'
        ? 'bg-blue-50 text-blue-700 ring-blue-200'
        : status === 'draft'
          ? 'bg-amber-50 text-amber-700 ring-amber-200'
          : status === 'cancelled'
            ? 'bg-gray-100 text-gray-700 ring-gray-200'
            : 'bg-gray-50 text-gray-700 ring-gray-200'

  return (
    <span className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-semibold ring-1 ${cls}`}>
      {status}
    </span>
  )
}

export default function ProductionOrdersPage() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [filters, setFilters] = useState({
    status: '',
    search: '',
  })
  const [orderView, setOrderView] = useState<'list' | 'cards'>('list')

  const { data: orders, isLoading, isError, error, refetch, isFetching } = useQuery<ProductionOrder[]>({
    queryKey: ['production-orders', filters],
    queryFn: async () => {
      const params = new URLSearchParams()
      if (filters.status) params.append('status', filters.status)
      const response = await api.get(`/feed/production-orders?${params.toString()}`)
      return response.data
    },
    retry: false,
    refetchOnWindowFocus: false,
  })

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async (orderId: number) => {
      await api.delete(`/feed/production-orders/${orderId}`)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['production-orders'] })
    },
    onError: (error: any) => {
      alert(error.response?.data?.detail || 'Failed to delete production order')
    },
  })

  // Cancel mutation
  const cancelMutation = useMutation({
    mutationFn: async (orderId: number) => {
      await api.post(`/feed/production-orders/${orderId}/cancel`)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['production-orders'] })
    },
    onError: (error: any) => {
      alert(error.response?.data?.detail || 'Failed to cancel production order')
    },
  })

  const handleDelete = (orderId: number) => {
    if (confirm('Are you sure you want to delete this production order? This action cannot be undone.')) {
      deleteMutation.mutate(orderId)
    }
  }

  const handleCancel = (orderId: number) => {
    if (confirm('Are you sure you want to cancel this production order?')) {
      cancelMutation.mutate(orderId)
    }
  }

  const canEdit = (order: ProductionOrder) => order.status === 'draft'
  const canDelete = (order: ProductionOrder) => order.status === 'draft'
  const canCancel = (order: ProductionOrder) => order.status === 'draft' || order.status === 'planned'

  const filteredOrders = useMemo(() => {
    const all = orders || []
    const s = filters.search.trim().toLowerCase()
    if (!s) return all
    return all.filter((o) => o.order_number?.toLowerCase().includes(s) || String(o.id).includes(s))
  }, [orders, filters.search])

  const stats = useMemo(() => {
    const all = orders || []
    const total = all.length
    const byStatus = all.reduce((acc, o) => {
      acc[o.status] = (acc[o.status] || 0) + 1
      return acc
    }, {} as Record<string, number>)
    const completed = all.filter((o) => o.status === 'completed')
    const avgYield =
      completed.length > 0
        ? completed.reduce((acc, o) => acc + (o.yield_pct ?? 0), 0) / completed.length
        : 0
    const avgCostPerKg =
      completed.length > 0
        ? completed.reduce((acc, o) => acc + (o.cost_per_kg ?? 0), 0) / completed.length
        : 0
    return {
      total,
      draft: byStatus['draft'] || 0,
      in_progress: byStatus['in_progress'] || 0,
      completed: byStatus['completed'] || 0,
      avgYield,
      avgCostPerKg,
    }
  }, [orders])

  return (
          <div className="space-y-6">
        <ReportingHubBreadcrumb current="Production orders" />
        {/* Header */}
        <div className="bg-white rounded-xl border border-gray-200">
          <div className="p-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <div className="text-sm text-gray-500">Manufacturing</div>
                <h2 className="mt-1 text-2xl font-semibold text-gray-900 tracking-tight">Production Orders</h2>
                <p className="mt-2 text-sm text-gray-600 max-w-3xl">
                  Plan and execute production runs from approved formulations for feed and flour lines. Posting consumes
                  materials and produces finished goods with batch-level costing and yield tracking.
                </p>
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => refetch()}
                  className="inline-flex items-center justify-center rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  {isFetching ? 'Refreshing…' : 'Refresh'}
                </button>
                <Link
                  href="/manufacturing/production-orders/new"
                  className="inline-flex items-center justify-center rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
                >
                  + New Order
                </Link>
              </div>
            </div>

            <div className="mt-5 grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
                <div className="text-xs font-semibold text-gray-600 uppercase">Total</div>
                <div className="mt-1 text-xl font-semibold text-gray-900">{stats.total}</div>
              </div>
              <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
                <div className="text-xs font-semibold text-gray-600 uppercase">Draft</div>
                <div className="mt-1 text-xl font-semibold text-gray-900">{stats.draft}</div>
              </div>
              <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
                <div className="text-xs font-semibold text-gray-600 uppercase">In progress</div>
                <div className="mt-1 text-xl font-semibold text-gray-900">{stats.in_progress}</div>
              </div>
              <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
                <div className="text-xs font-semibold text-gray-600 uppercase">Completed</div>
                <div className="mt-1 text-xl font-semibold text-gray-900">{stats.completed}</div>
              </div>
              <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
                <div className="text-xs font-semibold text-gray-600 uppercase">Avg yield</div>
                <div className="mt-1 text-xl font-semibold text-gray-900">{stats.avgYield.toFixed(2)}%</div>
              </div>
              <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
                <div className="text-xs font-semibold text-gray-600 uppercase">Avg cost/kg</div>
                <div className="mt-1 text-xl font-semibold text-gray-900">₹{stats.avgCostPerKg.toFixed(4)}</div>
              </div>
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="bg-white rounded-xl border border-gray-200">
          <div className="p-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-sm font-semibold text-gray-900">Filters</div>
                <div className="text-xs text-gray-500 mt-1">
                  {filteredOrders.length} shown{orders ? ` • ${orders.length} total` : ''}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setFilters({ status: '', search: '' })}
                className="text-sm font-medium text-gray-600 hover:text-gray-900"
              >
                Clear
              </button>
            </div>

            <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
                <select
                  value={filters.status}
                  onChange={(e) => setFilters({ ...filters, status: e.target.value })}
                  className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-indigo-500 focus:ring-indigo-500"
                >
                  <option value="">All</option>
                  <option value="draft">Draft</option>
                  <option value="in_progress">In Progress</option>
                  <option value="completed">Completed</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Search</label>
                <input
                  value={filters.search}
                  onChange={(e) => setFilters({ ...filters, search: e.target.value })}
                  placeholder="Search by order number…"
                  className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-indigo-500 focus:ring-indigo-500"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Table */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          {isLoading ? (
            <div className="p-10 text-center text-sm text-gray-600">Loading production orders…</div>
          ) : isError ? (
            <div className="p-6">
              <div className="rounded-lg border border-red-200 bg-red-50 p-4">
                <div className="text-sm font-semibold text-red-800">Couldn’t load production orders</div>
                <div className="mt-1 text-sm text-red-700">
                  {(() => {
                    const e: any = error
                    const status = e?.response?.status
                    const detail = e?.response?.data?.detail
                    if (status === 401) return 'Your session expired. Please log in again.'
                    return detail || e?.message || 'An unexpected error occurred.'
                  })()}
                </div>
                <div className="mt-3">
                  <button
                    type="button"
                    onClick={() => refetch()}
                    className="inline-flex items-center rounded-md bg-red-600 px-3 py-2 text-sm font-semibold text-white hover:bg-red-700"
                  >
                    Try again
                  </button>
                  {(error as any)?.response?.status === 401 && (
                    <Link
                      href="/login"
                      className="ml-2 inline-flex items-center rounded-md border border-red-300 bg-white px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-50"
                    >
                      Go to login
                    </Link>
                  )}
                </div>
              </div>
            </div>
          ) : filteredOrders.length === 0 ? (
            <div className="p-10 text-center">
              <h3 className="text-base font-semibold text-gray-900">No production orders found</h3>
              <p className="mt-2 text-sm text-gray-600">Create a new order to start a batch run.</p>
              <div className="mt-6">
                <Link
                  href="/manufacturing/production-orders/new"
                  className="inline-flex items-center rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
                >
                  + New Order
                </Link>
              </div>
            </div>
          ) : (
            <>
              <div className="flex flex-shrink-0 items-center justify-between gap-2 border-b border-gray-200 bg-gray-50/90 px-4 py-2">
                <span className="text-sm font-medium text-gray-800">Production orders</span>
                <div className="inline-flex rounded-md border border-gray-200 bg-white p-0.5">
                  <button
                    type="button"
                    onClick={() => setOrderView('list')}
                    className={`rounded px-3 py-1.5 text-sm font-medium ${
                      orderView === 'list' ? 'bg-indigo-600 text-white' : 'text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    List
                  </button>
                  <button
                    type="button"
                    onClick={() => setOrderView('cards')}
                    className={`rounded px-3 py-1.5 text-sm font-medium ${
                      orderView === 'cards' ? 'bg-indigo-600 text-white' : 'text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    Cards
                  </button>
                </div>
              </div>
              {orderView === 'list' ? (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Order</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Batch size</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Planned</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Actual</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Yield</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Cost/kg</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Status</th>
                    <th className="px-6 py-3 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-100">
                  {filteredOrders.map((order) => (
                    <tr key={order.id} className="hover:bg-gray-50/70">
                      <td className="px-6 py-4">
                        <div className="text-sm font-semibold text-gray-900">{order.order_number}</div>
                        <div className="mt-1 text-xs text-gray-500">BOM #{order.bom_id}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">{order.batch_size_ton} ton</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">{order.planned_output_kg?.toFixed?.(2)} kg</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">
                        {order.actual_output_kg != null ? `${order.actual_output_kg.toFixed(2)} kg` : '-'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">
                        {order.yield_pct != null ? `${order.yield_pct.toFixed(2)}%` : '-'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">
                        {order.cost_per_kg != null ? `₹${order.cost_per_kg.toFixed(4)}` : '-'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <StatusPill status={order.status} />
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                        <div className="inline-flex items-center gap-2">
                          {/* View Button */}
                          <Link
                            href={`/manufacturing/production-orders/${order.id}`}
                            className="inline-flex items-center justify-center rounded-md p-1.5 text-indigo-600 hover:bg-indigo-50 hover:text-indigo-700"
                            title="View Production Order"
                          >
                            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                            </svg>
                          </Link>
                          
                          {/* Edit Button - Only for draft orders */}
                          {canEdit(order) && (
                            <Link
                              href={`/manufacturing/production-orders/${order.id}`}
                              className="inline-flex items-center justify-center rounded-md p-1.5 text-blue-600 hover:bg-blue-50 hover:text-blue-700"
                              title="Edit Production Order"
                            >
                              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                              </svg>
                            </Link>
                          )}
                          
                          {/* Cancel Button - For draft and planned orders */}
                          {canCancel(order) && (
                            <button
                              onClick={() => handleCancel(order.id)}
                              disabled={cancelMutation.isPending}
                              className="inline-flex items-center justify-center rounded-md p-1.5 text-orange-600 hover:bg-orange-50 hover:text-orange-700 disabled:opacity-50"
                              title="Cancel Production Order"
                            >
                              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            </button>
                          )}
                          
                          {/* Delete Button - Only for draft orders */}
                          {canDelete(order) && (
                            <button
                              onClick={() => handleDelete(order.id)}
                              disabled={deleteMutation.isPending}
                              className="inline-flex items-center justify-center rounded-md p-1.5 text-red-600 hover:bg-red-50 hover:text-red-700 disabled:opacity-50"
                              title="Delete Production Order"
                            >
                              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
              ) : (
                <div className="p-4">
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {filteredOrders.map((order) => (
                      <div key={order.id} className="flex flex-col rounded-lg border border-gray-200 bg-white p-4">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="text-base font-semibold text-gray-900">{order.order_number}</div>
                            <div className="mt-1 text-xs text-gray-500">BOM #{order.bom_id}</div>
                          </div>
                          <StatusPill status={order.status} />
                        </div>
                        <dl className="mt-3 space-y-1 text-sm text-gray-600">
                          <div className="flex justify-between gap-2">
                            <dt className="text-gray-500">Batch</dt>
                            <dd className="font-medium text-gray-900">{order.batch_size_ton} ton</dd>
                          </div>
                          <div className="flex justify-between gap-2">
                            <dt className="text-gray-500">Planned</dt>
                            <dd className="font-medium text-gray-900">{order.planned_output_kg?.toFixed?.(2)} kg</dd>
                          </div>
                          <div className="flex justify-between gap-2">
                            <dt className="text-gray-500">Yield</dt>
                            <dd className="font-medium text-gray-900">
                              {order.yield_pct != null ? `${order.yield_pct.toFixed(2)}%` : '—'}
                            </dd>
                          </div>
                        </dl>
                        <div className="mt-4 flex justify-end border-t border-gray-100 pt-3">
                          <Link
                            href={`/manufacturing/production-orders/${order.id}`}
                            className="rounded-md p-2 text-indigo-600 hover:bg-indigo-50"
                            title="Open order"
                          >
                            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                            </svg>
                          </Link>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
  )
}

