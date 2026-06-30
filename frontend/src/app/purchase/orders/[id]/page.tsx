'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams, useSearchParams } from 'next/navigation'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { formatDateOnly } from '@/utils/date'
import { formatQuantity, formatQuantityPlain } from '@/utils/quantity'

type Supplier = { id: number; name: string }

type Warehouse = { id: number; name: string }

type PurchaseOrder = {
  id: number
  po_number: string
  supplier_id: number
  status: string
  total_amount: number
  order_date: string
  expected_date?: string | null
}

type POLine = {
  id: number
  po_id: number
  item_id: number
  qty: number
  qty_received: number
  unit_price: number
  total: number
}

type Item = { id: number; sku: string; name: string }

export default function PurchaseOrderDetailPage() {
  const params = useParams()
  const searchParams = useSearchParams()
  const poId = Number(params.id)
  const queryClient = useQueryClient()

  const { data: suppliers = [] } = useQuery<Supplier[]>({
    queryKey: ['suppliers'],
    queryFn: async () => (await api.get('/suppliers')).data || [],
    retry: false,
    refetchOnWindowFocus: false,
  })

  const supplierName = (id: number) => suppliers.find((s) => s.id === id)?.name || `Supplier #${id}`

  const { data: order, isLoading: orderLoading } = useQuery<PurchaseOrder>({
    queryKey: ['purchase-order', poId],
    queryFn: async () => (await api.get(`/purchase/orders/${poId}`)).data,
    enabled: !!poId,
    retry: false,
    refetchOnWindowFocus: false,
  })

  const { data: lines = [] } = useQuery<POLine[]>({
    queryKey: ['purchase-order-lines', poId],
    queryFn: async () => (await api.get(`/purchase/orders/${poId}/lines`)).data || [],
    enabled: !!poId,
    retry: false,
    refetchOnWindowFocus: false,
  })

  const { data: items = [] } = useQuery<Item[]>({
    queryKey: ['items', 'for-po'],
    queryFn: async () => (await api.get('/items?limit=5000&include_inactive=false')).data || [],
    retry: false,
    refetchOnWindowFocus: false,
  })

  const itemById = useMemo(() => {
    const m = new Map<number, Item>()
    for (const it of items) m.set(it.id, it)
    return m
  }, [items])

  const { data: warehouses = [] } = useQuery<Warehouse[]>({
    queryKey: ['warehouses'],
    queryFn: async () => (await api.get('/warehouses')).data || [],
    retry: false,
    refetchOnWindowFocus: false,
  })

  const [showReceive, setShowReceive] = useState(() => searchParams.get('receive') === '1')
  const [receiveForm, setReceiveForm] = useState({ warehouse_id: 0, receipt_date: new Date().toISOString().slice(0, 10) })
  const [partialReceive, setPartialReceive] = useState(false)

  const outstanding = (l: POLine) => Math.max(0, Number(l.qty || 0) - Number(l.qty_received ?? 0))

  const receiveMutation = useMutation({
    mutationFn: async () => {
      const body: {
        warehouse_id: number
        receipt_date: string
        lines?: Array<{ po_line_id: number; qty: number; batch_no?: string | null }>
      } = {
        warehouse_id: receiveForm.warehouse_id,
        receipt_date: new Date(receiveForm.receipt_date).toISOString(),
      }
      if (partialReceive) {
        const linePayload = lines
          .map((l) => {
            const out = outstanding(l)
            const raw = (document.getElementById(`recv-qty-${l.id}`) as HTMLInputElement | null)?.value
            const q = raw !== undefined && raw !== '' ? Number(raw) : out
            return { po_line_id: l.id, qty: q, max: out }
          })
          .filter((x) => x.qty > 0)
        for (const row of linePayload) {
          if (row.qty > row.max + 1e-9) {
            throw new Error(`Line ${row.po_line_id}: quantity cannot exceed outstanding (${formatQuantityPlain(row.max)})`)
          }
        }
        if (linePayload.length === 0) {
          throw new Error('Enter at least one line quantity to receive')
        }
        body.lines = linePayload.map(({ po_line_id, qty }) => ({ po_line_id, qty }))
      }
      return api.post(`/purchase/orders/${poId}/receive`, body)
    },
    onSuccess: () => {
      setShowReceive(false)
      queryClient.invalidateQueries({ queryKey: ['inventory-stock'] })
      queryClient.invalidateQueries({ queryKey: ['purchase-order-lines', poId] })
      queryClient.invalidateQueries({ queryKey: ['goods-receipts'] })
    },
  })

  if (orderLoading) {
    return (
              <div className="bg-white rounded-lg shadow p-6 flex items-center justify-center min-h-[300px]">
          <div className="text-sm text-muted-foreground">Loading purchase order…</div>
        </div>
    )
  }

  if (!order) {
    return (
              <div className="bg-white rounded-lg shadow p-6">
          <div className="text-destructive">Purchase order not found</div>
        </div>
    )
  }

  return (
          <div className="space-y-6">
        <div className="bg-white rounded-xl border border-border shadow-sm p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-sm text-muted-foreground">Purchasing</div>
              <h2 className="mt-1 text-2xl font-semibold text-foreground tracking-tight">{order.po_number}</h2>
              <div className="mt-2 text-sm text-muted-foreground">
                Supplier: <span className="font-semibold text-foreground">{supplierName(order.supplier_id)}</span>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Link
                href="/purchase/orders"
                className="inline-flex items-center justify-center rounded-md border border-border bg-white px-3 py-2 text-sm font-medium text-foreground/85 hover:bg-muted/40"
              >
                Back
              </Link>
              <button
                type="button"
                onClick={() => setShowReceive((v) => !v)}
                className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary/90 shadow-sm"
              >
                Receive (GRN)
              </button>
            </div>
          </div>

          <div className="mt-5 grid grid-cols-1 sm:grid-cols-4 gap-3">
            <div className="rounded-lg border border-border bg-muted/40 px-4 py-3">
              <div className="text-xs font-semibold text-muted-foreground uppercase">Order date</div>
              <div className="mt-1 text-sm font-semibold text-foreground">{formatDateOnly(order.order_date)}</div>
            </div>
            <div className="rounded-lg border border-border bg-muted/40 px-4 py-3">
              <div className="text-xs font-semibold text-muted-foreground uppercase">Expected</div>
              <div className="mt-1 text-sm font-semibold text-foreground">{order.expected_date ? formatDateOnly(order.expected_date) : '-'}</div>
            </div>
            <div className="rounded-lg border border-border bg-muted/40 px-4 py-3">
              <div className="text-xs font-semibold text-muted-foreground uppercase">Status</div>
              <div className="mt-1 text-sm font-semibold text-foreground">{order.status}</div>
            </div>
            <div className="rounded-lg border border-border bg-muted/40 px-4 py-3">
              <div className="text-xs font-semibold text-muted-foreground uppercase">Total</div>
              <div className="mt-1 text-sm font-semibold text-foreground">₹{Number(order.total_amount || 0).toFixed(2)}</div>
            </div>
          </div>

          {showReceive && (
            <div className="mt-6 rounded-lg border border-primary/25 bg-accent p-4">
              <div className="text-sm font-semibold text-foreground/85">Receive goods (GRN + stock; accrual Dr Inventory / Cr GRNI when configured)</div>
              <label className="mt-3 flex items-center gap-2 text-sm text-foreground">
                <input
                  type="checkbox"
                  checked={partialReceive}
                  onChange={(e) => setPartialReceive(e.target.checked)}
                  className="rounded border-border"
                />
                <span>Partial receipt (enter quantity per line)</span>
              </label>
              <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-foreground/85 mb-1">Warehouse *</label>
                  <select
                    value={receiveForm.warehouse_id}
                    onChange={(e) => setReceiveForm({ ...receiveForm, warehouse_id: Number(e.target.value) })}
                    className="w-full rounded-md border border-border bg-white px-3 py-2 text-sm"
                  >
                    <option value={0}>Select warehouse…</option>
                    {warehouses.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground/85 mb-1">Receipt date</label>
                  <input
                    type="date"
                    value={receiveForm.receipt_date}
                    onChange={(e) => setReceiveForm({ ...receiveForm, receipt_date: e.target.value })}
                    className="w-full rounded-md border border-border bg-white px-3 py-2 text-sm"
                  />
                </div>
              </div>
              {partialReceive && (
                <div className="mt-4 overflow-x-auto rounded-md border border-primary/15 bg-white">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/40 text-left text-xs font-semibold uppercase text-muted-foreground">
                        <th className="px-3 py-2">Item</th>
                        <th className="px-3 py-2 text-right">Ordered</th>
                        <th className="px-3 py-2 text-right">Already in</th>
                        <th className="px-3 py-2 text-right">Outstanding</th>
                        <th className="px-3 py-2 text-right">Receive now</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/70">
                      {lines.map((l) => {
                        const it = itemById.get(l.item_id)
                        const out = outstanding(l)
                        return (
                          <tr key={l.id}>
                            <td className="px-3 py-2 text-foreground">{it ? `${it.sku}` : `#${l.item_id}`}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{formatQuantity(l.qty)}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{formatQuantity(l.qty_received ?? 0)}</td>
                            <td className="px-3 py-2 text-right tabular-nums font-medium">{formatQuantity(out)}</td>
                            <td className="px-3 py-2 text-right">
                              <input
                                id={`recv-qty-${l.id}`}
                                type="number"
                                min={0}
                                max={out}
                                step="any"
                                disabled={out <= 0}
                                defaultValue={out > 0 ? String(out) : '0'}
                                className="w-28 rounded border border-border px-2 py-1 text-right text-sm disabled:bg-muted"
                              />
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="mt-4 flex gap-2">
                <button
                  type="button"
                  disabled={receiveMutation.isPending || receiveForm.warehouse_id === 0}
                  onClick={() => receiveMutation.mutate()}
                  className="inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary/90 disabled:opacity-50"
                >
                  {receiveMutation.isPending ? 'Receiving…' : 'Confirm Receive'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowReceive(false)}
                  className="inline-flex items-center rounded-md border border-border bg-white px-4 py-2 text-sm font-semibold text-foreground/85 hover:bg-muted/40"
                >
                  Cancel
                </button>
              </div>
              {receiveMutation.isError && (
                <div className="mt-3 text-sm text-destructive">
                  {(receiveMutation.error as any)?.response?.data?.detail || (receiveMutation.error as any)?.message || 'Failed to receive'}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="bg-white rounded-xl border border-border shadow-sm p-6">
          <h3 className="text-lg font-semibold text-foreground">Lines</h3>
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full divide-y divide-border">
              <thead className="bg-muted/40">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Item</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase">Qty</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase">Unit price</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase">Total</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-border/70">
                {lines.map((l) => {
                  const it = itemById.get(l.item_id)
                  return (
                    <tr key={l.id} className="hover:bg-muted/40">
                      <td className="px-4 py-3 text-sm text-foreground">
                        <div className="font-semibold">{it ? `${it.sku} — ${it.name}` : `Item #${l.item_id}`}</div>
                      </td>
                      <td className="px-4 py-3 text-sm text-foreground text-right">{formatQuantity(l.qty || 0)}</td>
                      <td className="px-4 py-3 text-sm text-foreground text-right">₹{Number(l.unit_price || 0).toFixed(2)}</td>
                      <td className="px-4 py-3 text-sm text-foreground text-right">₹{Number(l.total || 0).toFixed(2)}</td>
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
