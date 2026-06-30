'use client'

import { ReportingHubBreadcrumb } from '@/components/ReportingHubBreadcrumb'
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { formatDateOnly } from '@/utils/date'

type Supplier = { id: number; name: string }

type PurchaseOrder = {
  id: number
  po_number: string
  supplier_id: number
  status: string
  total_amount: number
  order_date: string
  expected_date?: string | null
}

function StatusPill({ status }: { status: string }) {
  const s = (status || '').toLowerCase()
  const cls =
    s === 'posted'
      ? 'bg-green-50 text-success ring-green-200'
      : s === 'draft'
        ? 'bg-warning/10 text-warning-foreground ring-amber-200'
        : s === 'cancelled'
          ? 'bg-muted text-foreground/85 ring-gray-200'
          : 'bg-muted/40 text-foreground/85 ring-gray-200'

  return (
    <span className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-semibold ring-1 ${cls}`}>{status}</span>
  )
}

export default function PurchaseOrdersPage() {
  const [isMounted, setIsMounted] = useState(false)
  const [tenantDomain, setTenantDomain] = useState<string>('localhost')
  const [filters, setFilters] = useState({ status: '', search: '', supplierId: '' })

  useEffect(() => {
    setIsMounted(true)
    setTenantDomain(localStorage.getItem('tenant_domain') || 'localhost')
  }, [])

  const { data: suppliers = [] } = useQuery<Supplier[]>({
    queryKey: ['suppliers'],
    queryFn: async () => {
      const res = await api.get('/suppliers')
      return res.data || []
    },
    retry: false,
    refetchOnWindowFocus: false,
  })

  const suppliersById = useMemo(() => {
    const m = new Map<number, string>()
    for (const s of suppliers) m.set(s.id, s.name)
    return m
  }, [suppliers])

  const {
    data: orders = [],
    isLoading,
    isError,
    error,
    refetch,
    isFetching,
  } = useQuery<PurchaseOrder[]>({
    queryKey: ['purchase-orders'],
    queryFn: async () => {
      const res = await api.get('/purchase/orders')
      return res.data || []
    },
    retry: false,
    refetchOnWindowFocus: false,
  })

  const filtered = useMemo(() => {
    const s = filters.search.trim().toLowerCase()
    const status = filters.status
    const supplierId = filters.supplierId ? Number(filters.supplierId) : null

    return (orders || []).filter((o) => {
      if (status && o.status !== status) return false
      if (supplierId && o.supplier_id !== supplierId) return false
      if (!s) return true
      const supplierName = suppliersById.get(o.supplier_id) || ''
      return (
        o.po_number?.toLowerCase().includes(s) ||
        String(o.id).includes(s) ||
        supplierName.toLowerCase().includes(s)
      )
    })
  }, [orders, filters, suppliersById])

  const stats = useMemo(() => {
    const all = orders || []
    const total = all.length
    const byStatus = all.reduce((acc, o) => {
      acc[o.status] = (acc[o.status] || 0) + 1
      return acc
    }, {} as Record<string, number>)
    const totalValue = all.reduce((acc, o) => acc + (Number(o.total_amount) || 0), 0)
    return {
      total,
      draft: byStatus['draft'] || 0,
      posted: byStatus['posted'] || 0,
      cancelled: byStatus['cancelled'] || 0,
      totalValue,
    }
  }, [orders])

  return (
          <div className="space-y-6">
        <ReportingHubBreadcrumb current="Purchase orders" />
        {isMounted && (
          <div className="rounded-lg border border-border bg-white p-4">
            <div className="text-sm text-foreground/85">
              Viewing tenant: <span className="font-mono font-semibold">{tenantDomain}</span>
              {tenantDomain === 'master' ? (
                <span className="ml-2 rounded bg-amber-100 px-2 py-0.5 text-xs font-semibold text-warning-foreground">MASTER</span>
              ) : null}
            </div>
            {tenantDomain === 'master' ? (
              <p className="mt-1 text-xs text-muted-foreground">
                Demo purchase data from seed scripts is attached to the Master tenant. Production tenants stay clean until you create POs.
              </p>
            ) : null}
          </div>
        )}

        <div className="bg-white rounded-xl border border-border shadow-sm">
          <div className="p-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <div className="text-sm text-muted-foreground">Purchasing</div>
                <h2 className="mt-1 text-2xl font-semibold text-foreground tracking-tight">Purchase Orders</h2>
                <p className="mt-2 text-sm text-muted-foreground max-w-3xl">
                  Create POs, receive goods into inventory (GRN), then raise vendor bills for accounting.
                </p>
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => refetch()}
                  className="inline-flex items-center justify-center rounded-md border border-border bg-white px-3 py-2 text-sm font-medium text-foreground/85 hover:bg-muted/40"
                >
                  {isFetching ? 'Refreshing…' : 'Refresh'}
                </button>
                <Link
                  href="/purchase/orders/new"
                  className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary/90 shadow-sm"
                >
                  + New PO
                </Link>
              </div>
            </div>

            <div className="mt-5 grid grid-cols-1 sm:grid-cols-4 gap-3">
              <div className="rounded-lg border border-border bg-muted/40 px-4 py-3">
                <div className="text-xs font-semibold text-muted-foreground uppercase">Total</div>
                <div className="mt-1 text-xl font-semibold text-foreground">{stats.total}</div>
              </div>
              <div className="rounded-lg border border-border bg-muted/40 px-4 py-3">
                <div className="text-xs font-semibold text-muted-foreground uppercase">Draft</div>
                <div className="mt-1 text-xl font-semibold text-foreground">{stats.draft}</div>
              </div>
              <div className="rounded-lg border border-border bg-muted/40 px-4 py-3">
                <div className="text-xs font-semibold text-muted-foreground uppercase">Posted</div>
                <div className="mt-1 text-xl font-semibold text-foreground">{stats.posted}</div>
              </div>
              <div className="rounded-lg border border-border bg-muted/40 px-4 py-3">
                <div className="text-xs font-semibold text-muted-foreground uppercase">Total value</div>
                <div className="mt-1 text-xl font-semibold text-foreground">₹{stats.totalValue.toFixed(2)}</div>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-border shadow-sm">
          <div className="p-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-sm font-semibold text-foreground">Filters</div>
                <div className="text-xs text-muted-foreground mt-1">
                  {filtered.length} shown{orders ? ` • ${orders.length} total` : ''}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setFilters({ status: '', search: '', supplierId: '' })}
                className="text-sm font-medium text-muted-foreground hover:text-foreground"
              >
                Clear
              </button>
            </div>

            <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-foreground/85 mb-1">Status</label>
                <select
                  value={filters.status}
                  onChange={(e) => setFilters({ ...filters, status: e.target.value })}
                  className="w-full rounded-md border border-border bg-white px-3 py-2 text-sm shadow-sm focus:border-ring focus:ring-ring"
                >
                  <option value="">All</option>
                  <option value="draft">Draft</option>
                  <option value="posted">Posted</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-foreground/85 mb-1">Supplier</label>
                <select
                  value={filters.supplierId}
                  onChange={(e) => setFilters({ ...filters, supplierId: e.target.value })}
                  className="w-full rounded-md border border-border bg-white px-3 py-2 text-sm shadow-sm focus:border-ring focus:ring-ring"
                >
                  <option value="">All</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={String(s.id)}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-foreground/85 mb-1">Search</label>
                <input
                  value={filters.search}
                  onChange={(e) => setFilters({ ...filters, search: e.target.value })}
                  placeholder="Search PO number / supplier…"
                  className="w-full rounded-md border border-border bg-white px-3 py-2 text-sm shadow-sm focus:border-ring focus:ring-ring"
                />
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-border shadow-sm overflow-hidden">
          {isLoading ? (
            <div className="p-10 text-center text-sm text-muted-foreground">Loading purchase orders…</div>
          ) : isError ? (
            <div className="p-6">
              <div className="rounded-lg border border-destructive/25 bg-destructive/5 p-4">
                <div className="text-sm font-semibold text-destructive">Couldn’t load purchase orders</div>
                <div className="mt-1 text-sm text-destructive">{(error as any)?.message || 'Unexpected error'}</div>
                <div className="mt-3">
                  <button
                    type="button"
                    onClick={() => refetch()}
                    className="inline-flex items-center rounded-md bg-destructive px-3 py-2 text-sm font-semibold text-white hover:bg-destructive/90"
                  >
                    Try again
                  </button>
                </div>
              </div>
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-10 text-center">
              <h3 className="text-base font-semibold text-foreground">No purchase orders found</h3>
              <p className="mt-2 text-sm text-muted-foreground">Create a PO or adjust filters.</p>
              <div className="mt-6">
                <Link
                  href="/purchase/orders/new"
                  className="inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary/90 shadow-sm"
                >
                  + New PO
                </Link>
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-border">
                <thead className="bg-muted/40">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">PO</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Supplier</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Order date</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Expected</th>
                    <th className="px-6 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider">Total</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Status</th>
                    <th className="px-6 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-border/70">
                  {filtered.map((o) => (
                    <tr key={o.id} className="hover:bg-muted/40/70">
                      <td className="px-6 py-4">
                        <div className="text-sm font-semibold text-foreground">{o.po_number}</div>
                        <div className="mt-1 text-xs text-muted-foreground">#{o.id}</div>
                      </td>
                      <td className="px-6 py-4 text-sm text-foreground font-medium">
                        {suppliersById.get(o.supplier_id) || `Supplier #${o.supplier_id}`}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-foreground/85">{formatDateOnly(o.order_date)}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-foreground/85">
                        {o.expected_date ? formatDateOnly(o.expected_date) : '-'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-foreground text-right">₹{Number(o.total_amount || 0).toFixed(2)}</td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <StatusPill status={o.status} />
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                        <div className="inline-flex items-center gap-2">
                          <Link
                            href={`/purchase/orders/${o.id}`}
                            className="inline-flex items-center gap-1 rounded-md border border-border bg-white px-3 py-2 text-xs font-semibold text-foreground/85 hover:bg-muted/40"
                            title="View PO"
                          >
                            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                            </svg>
                            View
                          </Link>
                          <Link
                            href={`/purchase/orders/${o.id}?receive=1`}
                            className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-2 text-xs font-semibold text-white hover:bg-primary/90"
                            title="Receive goods (GRN)"
                          >
                            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 13V7a2 2 0 00-2-2H6a2 2 0 00-2 2v6m16 0l-8 8m8-8h-5m-6 0H4m8 8V9" />
                            </svg>
                            Receive
                          </Link>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
  )
}
