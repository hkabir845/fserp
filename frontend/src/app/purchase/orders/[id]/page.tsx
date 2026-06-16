'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams, useSearchParams } from 'next/navigation'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { formatDateOnly } from '@/utils/date'

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
            throw new Error(`Line ${row.po_line_id}: quantity cannot exceed outstanding (${row.max.toFixed(3)})`)
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
          <div className="text-sm text-gray-600">Loading purchase order…</div>
        </div>
    )
  }

  if (!order) {
    return (
              <div className="bg-white rounded-lg shadow p-6">
          <div className="text-red-600">Purchase order not found</div>
        </div>
    )
  }

  return (
          <div className="space-y-6">
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-sm text-gray-500">Purchasing</div>
              <h2 className="mt-1 text-2xl font-semibold text-gray-900 tracking-tight">{order.po_number}</h2>
              <div className="mt-2 text-sm text-gray-600">
                Supplier: <span className="font-semibold text-gray-900">{supplierName(order.supplier_id)}</span>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Link
                href="/purchase/orders"
                className="inline-flex items-center justify-center rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Back
              </Link>
              <button
                type="button"
                onClick={() => setShowReceive((v) => !v)}
                className="inline-flex items-center justify-center rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 shadow-sm"
              >
                Receive (GRN)
              </button>
            </div>
          </div>

          <div className="mt-5 grid grid-cols-1 sm:grid-cols-4 gap-3">
            <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
              <div className="text-xs font-semibold text-gray-600 uppercase">Order date</div>
              <div className="mt-1 text-sm font-semibold text-gray-900">{formatDateOnly(order.order_date)}</div>
            </div>
            <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
              <div className="text-xs font-semibold text-gray-600 uppercase">Expected</div>
              <div className="mt-1 text-sm font-semibold text-gray-900">{order.expected_date ? formatDateOnly(order.expected_date) : '-'}</div>
            </div>
            <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
              <div className="text-xs font-semibold text-gray-600 uppercase">Status</div>
              <div className="mt-1 text-sm font-semibold text-gray-900">{order.status}</div>
            </div>
            <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
              <div className="text-xs font-semibold text-gray-600 uppercase">Total</div>
              <div className="mt-1 text-sm font-semibold text-gray-900">₹{Number(order.total_amount || 0).toFixed(2)}</div>
            </div>
          </div>

          {showReceive && (
            <div className="mt-6 rounded-lg border border-indigo-200 bg-indigo-50 p-4">
              <div className="text-sm font-semibold text-indigo-900">Receive goods (GRN + stock; accrual Dr Inventory / Cr GRNI when configured)</div>
              <label className="mt-3 flex items-center gap-2 text-sm text-gray-800">
                <input
                  type="checkbox"
                  checked={partialReceive}
                  onChange={(e) => setPartialReceive(e.target.checked)}
                  className="rounded border-gray-300"
                />
                <span>Partial receipt (enter quantity per line)</span>
              </label>
              <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Warehouse *</label>
                  <select
                    value={receiveForm.warehouse_id}
                    onChange={(e) => setReceiveForm({ ...receiveForm, warehouse_id: Number(e.target.value) })}
                    className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
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
                  <label className="block text-sm font-medium text-gray-700 mb-1">Receipt date</label>
                  <input
                    type="date"
                    value={receiveForm.receipt_date}
                    onChange={(e) => setReceiveForm({ ...receiveForm, receipt_date: e.target.value })}
                    className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
                  />
                </div>
              </div>
              {partialReceive && (
                <div className="mt-4 overflow-x-auto rounded-md border border-indigo-100 bg-white">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-200 bg-gray-50 text-left text-xs font-semibold uppercase text-gray-600">
                        <th className="px-3 py-2">Item</th>
                        <th className="px-3 py-2 text-right">Ordered</th>
                        <th className="px-3 py-2 text-right">Already in</th>
                        <th className="px-3 py-2 text-right">Outstanding</th>
                        <th className="px-3 py-2 text-right">Receive now</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {lines.map((l) => {
                        const it = itemById.get(l.item_id)
                        const out = outstanding(l)
                        return (
                          <tr key={l.id}>
                            <td className="px-3 py-2 text-gray-900">{it ? `${it.sku}` : `#${l.item_id}`}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{Number(l.qty).toFixed(3)}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{Number(l.qty_received ?? 0).toFixed(3)}</td>
                            <td className="px-3 py-2 text-right tabular-nums font-medium">{out.toFixed(3)}</td>
                            <td className="px-3 py-2 text-right">
                              <input
                                id={`recv-qty-${l.id}`}
                                type="number"
                                min={0}
                                max={out}
                                step="any"
                                disabled={out <= 0}
                                defaultValue={out > 0 ? String(out) : '0'}
                                className="w-28 rounded border border-gray-300 px-2 py-1 text-right text-sm disabled:bg-gray-100"
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
                  className="inline-flex items-center rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                  {receiveMutation.isPending ? 'Receiving…' : 'Confirm Receive'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowReceive(false)}
                  className="inline-flex items-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
              </div>
              {receiveMutation.isError && (
                <div className="mt-3 text-sm text-red-700">
                  {(receiveMutation.error as any)?.response?.data?.detail || (receiveMutation.error as any)?.message || 'Failed to receive'}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
          <h3 className="text-lg font-semibold text-gray-900">Lines</h3>
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Item</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600 uppercase">Qty</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600 uppercase">Unit price</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600 uppercase">Total</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-100">
                {lines.map((l) => {
                  const it = itemById.get(l.item_id)
                  return (
                    <tr key={l.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm text-gray-900">
                        <div className="font-semibold">{it ? `${it.sku} — ${it.name}` : `Item #${l.item_id}`}</div>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-900 text-right">{Number(l.qty || 0).toFixed(3)}</td>
                      <td className="px-4 py-3 text-sm text-gray-900 text-right">₹{Number(l.unit_price || 0).toFixed(2)}</td>
                      <td className="px-4 py-3 text-sm text-gray-900 text-right">₹{Number(l.total || 0).toFixed(2)}</td>
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
