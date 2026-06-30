'use client'

import { useMemo } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { formatDateOnly } from '@/utils/date'
import { formatQuantity } from '@/utils/quantity'

type GrnDetail = {
  id: number
  grn_number: string
  supplier_id: number
  warehouse_id: number
  ref_po_id: number | null
  status: string
  receipt_date: string
  total_amount: number
  lines: Array<{
    id: number
    grn_id: number
    item_id: number
    qty: number
    unit_cost: number
    total: number
    batch_no: string | null
  }>
}

type Supplier = { id: number; name: string }
type Warehouse = { id: number; name: string }
type Item = { id: number; sku: string; name: string }

export default function GrnDetailPage() {
  const params = useParams()
  const grnId = Number(params.id)

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

  const { data: items = [] } = useQuery<Item[]>({
    queryKey: ['items', 'grn-detail'],
    queryFn: async () => (await api.get('/items?limit=5000&include_inactive=false')).data || [],
    retry: false,
    refetchOnWindowFocus: false,
  })

  const { data: grn, isLoading, isError, error } = useQuery<GrnDetail>({
    queryKey: ['grn', grnId],
    queryFn: async () => (await api.get(`/purchase/grn/${grnId}`)).data,
    enabled: !!grnId,
    retry: false,
    refetchOnWindowFocus: false,
  })

  const itemById = useMemo(() => {
    const m = new Map<number, Item>()
    for (const it of items) m.set(it.id, it)
    return m
  }, [items])

  const supplierName = suppliers.find((s) => s.id === grn?.supplier_id)?.name
  const warehouseName = warehouses.find((w) => w.id === grn?.warehouse_id)?.name

  if (isLoading) {
    return (
              <div className="bg-white rounded-lg shadow p-6 flex items-center justify-center min-h-[300px]">
          <div className="text-sm text-muted-foreground">Loading GRN…</div>
        </div>
    )
  }

  if (isError || !grn) {
    return (
              <div className="bg-white rounded-lg shadow p-6">
          <div className="text-destructive">{(error as Error)?.message || 'GRN not found'}</div>
          <Link href="/purchase/grn" className="mt-4 inline-block text-sm font-medium text-primary">
            ← Back to GRN list
          </Link>
        </div>
    )
  }

  return (
          <div className="space-y-6">
        <div className="bg-white rounded-xl border border-border shadow-sm p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="text-sm text-muted-foreground">Goods receipt</div>
              <h2 className="mt-1 text-2xl font-semibold text-foreground tracking-tight">{grn.grn_number}</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Supplier: <span className="font-semibold text-foreground">{supplierName || `#${grn.supplier_id}`}</span>
                {' · '}
                Warehouse: <span className="font-semibold text-foreground">{warehouseName || `#${grn.warehouse_id}`}</span>
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link
                href="/purchase/grn"
                className="inline-flex items-center justify-center rounded-md border border-border bg-white px-3 py-2 text-sm font-medium text-foreground/85 hover:bg-muted/40"
              >
                All GRNs
              </Link>
              {grn.ref_po_id ? (
                <Link
                  href={`/purchase/orders/${grn.ref_po_id}`}
                  className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary/90 shadow-sm"
                >
                  Open PO
                </Link>
              ) : null}
            </div>
          </div>

          <div className="mt-5 grid grid-cols-1 sm:grid-cols-4 gap-3">
            <div className="rounded-lg border border-border bg-muted/40 px-4 py-3">
              <div className="text-xs font-semibold text-muted-foreground uppercase">Receipt date</div>
              <div className="mt-1 text-sm font-semibold text-foreground">
                {grn.receipt_date ? formatDateOnly(grn.receipt_date) : '—'}
              </div>
            </div>
            <div className="rounded-lg border border-border bg-muted/40 px-4 py-3">
              <div className="text-xs font-semibold text-muted-foreground uppercase">Status</div>
              <div className="mt-1 text-sm font-semibold text-foreground">{grn.status}</div>
            </div>
            <div className="rounded-lg border border-border bg-muted/40 px-4 py-3">
              <div className="text-xs font-semibold text-muted-foreground uppercase">PO reference</div>
              <div className="mt-1 text-sm font-semibold text-foreground">
                {grn.ref_po_id ? (
                  <Link className="text-primary hover:text-primary" href={`/purchase/orders/${grn.ref_po_id}`}>
                    PO #{grn.ref_po_id}
                  </Link>
                ) : (
                  'Direct / no PO'
                )}
              </div>
            </div>
            <div className="rounded-lg border border-border bg-muted/40 px-4 py-3">
              <div className="text-xs font-semibold text-muted-foreground uppercase">Total value</div>
              <div className="mt-1 text-sm font-semibold text-foreground">₹{Number(grn.total_amount || 0).toFixed(2)}</div>
            </div>
          </div>

          <p className="mt-6 text-sm text-muted-foreground border-t border-border/70 pt-4">
            Inventory and accrual entries (when accounts are set up) use this total. Match the vendor invoice to this GRN when recording payables so GRNI clears to Accounts
            Payable instead of duplicating inventory capitalization.
          </p>
        </div>

        <div className="bg-white rounded-xl border border-border shadow-sm p-6">
          <h3 className="text-lg font-semibold text-foreground">Lines</h3>
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full divide-y divide-border">
              <thead className="bg-muted/40">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Item</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase">Qty</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase">Unit cost</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase">Line total</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Batch</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-border/70">
                {grn.lines.map((l) => {
                  const it = itemById.get(l.item_id)
                  return (
                    <tr key={l.id} className="hover:bg-muted/40">
                      <td className="px-4 py-3 text-sm text-foreground">
                        <div className="font-semibold">{it ? `${it.sku} — ${it.name}` : `Item #${l.item_id}`}</div>
                      </td>
                      <td className="px-4 py-3 text-sm text-foreground text-right">{formatQuantity(l.qty || 0)}</td>
                      <td className="px-4 py-3 text-sm text-foreground text-right">₹{Number(l.unit_cost || 0).toFixed(2)}</td>
                      <td className="px-4 py-3 text-sm text-foreground text-right">₹{Number(l.total || 0).toFixed(2)}</td>
                      <td className="px-4 py-3 text-sm text-muted-foreground">{l.batch_no || '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
  )
}
