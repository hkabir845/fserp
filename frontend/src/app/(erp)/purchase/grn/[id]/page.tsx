'use client'

import { useMemo } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { formatDateOnly } from '@/utils/date'

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
          <div className="text-sm text-gray-600">Loading GRN…</div>
        </div>
    )
  }

  if (isError || !grn) {
    return (
              <div className="bg-white rounded-lg shadow p-6">
          <div className="text-red-600">{(error as Error)?.message || 'GRN not found'}</div>
          <Link href="/purchase/grn" className="mt-4 inline-block text-sm font-medium text-indigo-600">
            ← Back to GRN list
          </Link>
        </div>
    )
  }

  return (
          <div className="space-y-6">
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="text-sm text-gray-500">Goods receipt</div>
              <h2 className="mt-1 text-2xl font-semibold text-gray-900 tracking-tight">{grn.grn_number}</h2>
              <p className="mt-2 text-sm text-gray-600">
                Supplier: <span className="font-semibold text-gray-900">{supplierName || `#${grn.supplier_id}`}</span>
                {' · '}
                Warehouse: <span className="font-semibold text-gray-900">{warehouseName || `#${grn.warehouse_id}`}</span>
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link
                href="/purchase/grn"
                className="inline-flex items-center justify-center rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                All GRNs
              </Link>
              {grn.ref_po_id ? (
                <Link
                  href={`/purchase/orders/${grn.ref_po_id}`}
                  className="inline-flex items-center justify-center rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 shadow-sm"
                >
                  Open PO
                </Link>
              ) : null}
            </div>
          </div>

          <div className="mt-5 grid grid-cols-1 sm:grid-cols-4 gap-3">
            <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
              <div className="text-xs font-semibold text-gray-600 uppercase">Receipt date</div>
              <div className="mt-1 text-sm font-semibold text-gray-900">
                {grn.receipt_date ? formatDateOnly(grn.receipt_date) : '—'}
              </div>
            </div>
            <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
              <div className="text-xs font-semibold text-gray-600 uppercase">Status</div>
              <div className="mt-1 text-sm font-semibold text-gray-900">{grn.status}</div>
            </div>
            <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
              <div className="text-xs font-semibold text-gray-600 uppercase">PO reference</div>
              <div className="mt-1 text-sm font-semibold text-gray-900">
                {grn.ref_po_id ? (
                  <Link className="text-indigo-600 hover:text-indigo-800" href={`/purchase/orders/${grn.ref_po_id}`}>
                    PO #{grn.ref_po_id}
                  </Link>
                ) : (
                  'Direct / no PO'
                )}
              </div>
            </div>
            <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
              <div className="text-xs font-semibold text-gray-600 uppercase">Total value</div>
              <div className="mt-1 text-sm font-semibold text-gray-900">₹{Number(grn.total_amount || 0).toFixed(2)}</div>
            </div>
          </div>

          <p className="mt-6 text-sm text-gray-600 border-t border-gray-100 pt-4">
            Inventory and accrual entries (when accounts are set up) use this total. Match the vendor invoice to this GRN when recording payables so GRNI clears to Accounts
            Payable instead of duplicating inventory capitalization.
          </p>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
          <h3 className="text-lg font-semibold text-gray-900">Lines</h3>
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Item</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600 uppercase">Qty</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600 uppercase">Unit cost</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600 uppercase">Line total</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Batch</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-100">
                {grn.lines.map((l) => {
                  const it = itemById.get(l.item_id)
                  return (
                    <tr key={l.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm text-gray-900">
                        <div className="font-semibold">{it ? `${it.sku} — ${it.name}` : `Item #${l.item_id}`}</div>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-900 text-right">{Number(l.qty || 0).toFixed(3)}</td>
                      <td className="px-4 py-3 text-sm text-gray-900 text-right">₹{Number(l.unit_cost || 0).toFixed(2)}</td>
                      <td className="px-4 py-3 text-sm text-gray-900 text-right">₹{Number(l.total || 0).toFixed(2)}</td>
                      <td className="px-4 py-3 text-sm text-gray-600">{l.batch_no || '—'}</td>
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
