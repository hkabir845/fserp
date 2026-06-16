'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useMutation, useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { PurchaseItemCombobox, type PoItemOption } from '@/components/purchase/PurchaseItemCombobox'

type Customer = { id: number; name: string }

type Line = { item_id: number; qty: number; unit_price: number }

export default function NewSalesRequisitionPage() {
  const router = useRouter()
  const [customerId, setCustomerId] = useState<number | ''>('')
  const [purpose, setPurpose] = useState('')
  const [lines, setLines] = useState<Line[]>([])
  const [draftItemId, setDraftItemId] = useState<number | null>(null)
  const [draftQty, setDraftQty] = useState('1')
  const [draftPrice, setDraftPrice] = useState('0')

  const { data: customers = [] } = useQuery<Customer[]>({
    queryKey: ['customers'],
    queryFn: async () => (await api.get('/customers')).data || [],
    retry: false,
  })

  const { data: items = [] } = useQuery<PoItemOption[]>({
    queryKey: ['items', 'sr-create'],
    queryFn: async () => (await api.get('/items?limit=5000&include_inactive=false')).data || [],
    retry: false,
  })

  const saleItems = useMemo(
    () => items.filter((i) => !['service', 'fuel'].includes(i.type)),
    [items],
  )

  const addLine = () => {
    if (!draftItemId) return
    const qty = Math.max(0, Number(draftQty) || 0)
    const up = Math.max(0, Number(draftPrice) || 0)
    if (qty <= 0) return
    setLines((prev) => [...prev.filter((l) => l.item_id !== draftItemId), { item_id: draftItemId, qty, unit_price: up }])
    setDraftItemId(null)
    setDraftQty('1')
    setDraftPrice('0')
  }

  const createMut = useMutation({
    mutationFn: async () => {
      if (customerId === '') throw new Error('Customer required')
      const res = await api.post('/requisitions/sales', {
        customer_id: customerId,
        requested_delivery: null,
        purpose: purpose || null,
        lines: lines.map((l) => ({
          item_id: l.item_id,
          qty: l.qty,
          unit_price: l.unit_price,
        })),
      })
      return res.data as { id: number }
    },
    onSuccess: (d) => router.push(`/sales/requisitions/${d.id}`),
  })

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <div className="mb-6">
        <Link href="/sales/requisitions" className="text-sm font-medium text-indigo-600 hover:text-indigo-800">
          ← Sales requisitions
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-gray-900">New sales requisition</h1>
        <p className="mt-1 text-sm text-gray-600">Draft internally, then route through sales head and executive approval.</p>
      </div>

      <div className="space-y-4 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <div>
          <label className="block text-sm font-medium text-gray-700">Customer</label>
          <select
            value={customerId}
            onChange={(e) => setCustomerId(e.target.value ? Number(e.target.value) : '')}
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm"
          >
            <option value="">— Select —</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">Purpose / notes</label>
          <textarea
            value={purpose}
            onChange={(e) => setPurpose(e.target.value)}
            rows={2}
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm"
          />
        </div>

        <div className="border-t border-gray-100 pt-4">
          <h3 className="text-sm font-semibold text-gray-900">Lines</h3>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="min-w-0 flex-1">
              <PurchaseItemCombobox items={saleItems} value={draftItemId} onChange={setDraftItemId} />
            </div>
            <input
              type="number"
              min={0}
              step="any"
              value={draftQty}
              onChange={(e) => setDraftQty(e.target.value)}
              placeholder="Qty"
              className="w-28 rounded-md border border-gray-300 px-2 py-2 text-sm"
            />
            <input
              type="number"
              min={0}
              step="any"
              value={draftPrice}
              onChange={(e) => setDraftPrice(e.target.value)}
              placeholder="Price"
              className="w-32 rounded-md border border-gray-300 px-2 py-2 text-sm"
            />
            <button
              type="button"
              onClick={addLine}
              className="rounded-md bg-gray-100 px-3 py-2 text-sm font-medium text-gray-800 hover:bg-gray-200"
            >
              Add line
            </button>
          </div>
          <ul className="mt-3 space-y-1 text-sm text-gray-700">
            {lines.map((l) => {
              const it = saleItems.find((x) => x.id === l.item_id)
              return (
                <li key={l.item_id} className="flex justify-between rounded bg-gray-50 px-2 py-1">
                  <span>{it?.name || `Item #${l.item_id}`}</span>
                  <span>
                    {l.qty} × {l.unit_price}
                  </span>
                  <button
                    type="button"
                    className="text-red-600 hover:underline"
                    onClick={() => setLines((prev) => prev.filter((x) => x.item_id !== l.item_id))}
                  >
                    Remove
                  </button>
                </li>
              )
            })}
          </ul>
        </div>

        {createMut.isError && (
          <p className="text-sm text-red-600">
            {(createMut.error as { message?: string; response?: { data?: { detail?: string } } })?.response?.data
              ?.detail ||
              (createMut.error as Error)?.message ||
              'Could not save'}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Link
            href="/sales/requisitions"
            className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </Link>
          <button
            type="button"
            disabled={customerId === '' || lines.length === 0 || createMut.isPending}
            onClick={() => createMut.mutate()}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-indigo-500 disabled:opacity-50"
          >
            {createMut.isPending ? 'Saving…' : 'Create draft'}
          </button>
        </div>
      </div>
    </div>
  )
}
