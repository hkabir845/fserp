'use client'

import { ReportingHubBreadcrumb } from '@/components/ReportingHubBreadcrumb'
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { formatDateOnly } from '@/utils/date'

type GrnRow = {
  id: number
  grn_number: string
  supplier_id: number
  warehouse_id: number
  ref_po_id: number | null
  status: string
  receipt_date: string
  total_amount: number
}

type Supplier = { id: number; name: string }
type Warehouse = { id: number; name: string }

function StatusPill({ status }: { status: string }) {
  const s = (status || '').toLowerCase()
  const cls =
    s === 'posted'
      ? 'bg-green-50 text-success ring-green-200'
      : s === 'draft'
        ? 'bg-warning/10 text-warning-foreground ring-amber-200'
        : 'bg-muted/40 text-foreground/85 ring-gray-200'

  return (
    <span className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-semibold ring-1 ${cls}`}>{status}</span>
  )
}

export default function GoodsReceiptListPage() {
  const [isMounted, setIsMounted] = useState(false)
  const [tenantDomain, setTenantDomain] = useState<string>('localhost')

  useEffect(() => {
    setIsMounted(true)
    setTenantDomain(localStorage.getItem('tenant_domain') || 'localhost')
  }, [])

  const { data: suppliers = [] } = useQuery<Supplier[]>({
    queryKey: ['suppliers'],
    queryFn: async () => (await api.get('/suppliers')).data || [],
    retry: false,
    refetchOnWindowFocus: false,
  })

  const { data: warehouses = [] } = useQuery<Warehouse[]>({
    queryKey: ['warehouses'],
    queryFn: async () => (await api.get('/warehouses')).data || [],
    retry: false,
    refetchOnWindowFocus: false,
  })

  const supplierName = useMemo(() => {
    const m = new Map<number, string>()
    for (const s of suppliers) m.set(s.id, s.name)
    return (id: number) => m.get(id) || `Supplier #${id}`
  }, [suppliers])

  const warehouseName = useMemo(() => {
    const m = new Map<number, string>()
    for (const w of warehouses) m.set(w.id, w.name)
    return (id: number) => m.get(id) || `Warehouse #${id}`
  }, [warehouses])

  const {
    data: grns = [],
    isLoading,
    isError,
    error,
    refetch,
    isFetching,
  } = useQuery<GrnRow[]>({
    queryKey: ['goods-receipts'],
    queryFn: async () => (await api.get('/purchase/grn')).data || [],
    retry: false,
    refetchOnWindowFocus: false,
  })

  return (
          <div className="space-y-6">
        <ReportingHubBreadcrumb current="Goods receipts (GRN)" />
        {isMounted && (
          <div className="rounded-lg border border-border bg-white p-4">
            <div className="text-sm text-foreground/85">
              Tenant: <span className="font-mono font-semibold">{tenantDomain}</span>
            </div>
            <p className="mt-2 text-sm text-muted-foreground max-w-3xl">
              Goods Receipt Notes (GRN) post stock into the warehouse and accrue value: <span className="font-medium">Dr Inventory / Cr Goods Received Not Invoiced</span> when the chart
              includes those accounts. Vendor bills linked to a GRN then post <span className="font-medium">Dr GRNI / Cr Accounts Payable</span>, matching standard ERP
              three-way flow (PO → receipt → invoice).
            </p>
          </div>
        )}

        <div className="bg-white rounded-xl border border-border shadow-sm">
          <div className="p-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <div className="text-sm text-muted-foreground">Purchasing</div>
                <h2 className="mt-1 text-2xl font-semibold text-foreground tracking-tight">Goods Receipt (GRN)</h2>
                <p className="mt-2 text-sm text-muted-foreground max-w-3xl">
                  Every receipt is a posted GRN. Create new receipts from a purchase order using <span className="font-semibold">Receive (GRN)</span> on the PO — including
                  partial deliveries per line.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Link
                  href="/purchase/orders"
                  className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary/90 shadow-sm"
                >
                  Go to purchase orders
                </Link>
                <button
                  type="button"
                  onClick={() => refetch()}
                  className="inline-flex items-center justify-center rounded-md border border-border bg-white px-4 py-2 text-sm font-medium text-foreground/85 hover:bg-muted/40"
                >
                  Refresh
                </button>
              </div>
            </div>

            {isError && (
              <div className="mt-4 rounded-md border border-destructive/25 bg-destructive/5 p-3 text-sm text-destructive">
                {(error as Error)?.message || 'Failed to load GRNs'}
              </div>
            )}

            <div className="mt-6 overflow-x-auto rounded-lg border border-border">
              <table className="min-w-full divide-y divide-border">
                <thead className="bg-muted/40">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">GRN #</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Date</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Supplier</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Warehouse</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">PO ref</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase">Value</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Status</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/70 bg-white">
                  {isLoading || isFetching ? (
                    <tr>
                      <td colSpan={8} className="px-4 py-8 text-center text-sm text-muted-foreground">
                        Loading GRNs…
                      </td>
                    </tr>
                  ) : grns.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-4 py-8 text-center text-sm text-muted-foreground">
                        No goods receipts yet. Receive against a{' '}
                        <Link href="/purchase/orders" className="font-medium text-primary hover:text-primary">
                          purchase order
                        </Link>
                        .
                      </td>
                    </tr>
                  ) : (
                    grns.map((g) => (
                      <tr key={g.id} className="hover:bg-muted/40">
                        <td className="px-4 py-3 text-sm font-semibold text-foreground">{g.grn_number}</td>
                        <td className="px-4 py-3 text-sm text-foreground/85">
                          {g.receipt_date ? formatDateOnly(g.receipt_date) : '—'}
                        </td>
                        <td className="px-4 py-3 text-sm text-foreground/85">{supplierName(g.supplier_id)}</td>
                        <td className="px-4 py-3 text-sm text-foreground/85">{warehouseName(g.warehouse_id)}</td>
                        <td className="px-4 py-3 text-sm text-foreground/85">
                          {g.ref_po_id ? (
                            <Link
                              href={`/purchase/orders/${g.ref_po_id}`}
                              className="font-medium text-primary hover:text-primary"
                            >
                              PO #{g.ref_po_id}
                            </Link>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="px-4 py-3 text-sm text-right text-foreground">₹{Number(g.total_amount || 0).toFixed(2)}</td>
                        <td className="px-4 py-3">
                          <StatusPill status={g.status} />
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Link
                            href={`/purchase/grn/${g.id}`}
                            className="inline-flex items-center rounded-md border border-border bg-white px-3 py-1.5 text-xs font-semibold text-foreground/85 hover:bg-muted/40"
                          >
                            View
                          </Link>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
  )
}
