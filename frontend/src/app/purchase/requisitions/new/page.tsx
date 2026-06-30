'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useMutation, useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { PurchaseItemCombobox, type PoItemOption } from '@/components/purchase/PurchaseItemCombobox'

type Supplier = { id: number; name: string }
type Warehouse = { id: number; name: string }

type Line = { item_id: number; qty: number; est_unit_price: number }

export default function NewPurchaseRequisitionPage() {
  const router = useRouter()
  const [supplierId, setSupplierId] = useState<number | ''>('')
  const [warehouseId, setWarehouseId] = useState<number | ''>('')
  const [purpose, setPurpose] = useState('')
  const [lines, setLines] = useState<Line[]>([])
  const [draftItemId, setDraftItemId] = useState<number | null>(null)
  const [draftQty, setDraftQty] = useState('1')
  const [draftPrice, setDraftPrice] = useState('0')

  const { data: suppliers = [] } = useQuery<Supplier[]>({
    queryKey: ['suppliers'],
    queryFn: async () => (await api.get('/suppliers')).data || [],
    retry: false,
  })

  const { data: warehouses = [] } = useQuery<Warehouse[]>({
    queryKey: ['warehouses'],
    queryFn: async () => (await api.get('/warehouses')).data || [],
    retry: false,
  })

  const { data: items = [] } = useQuery<PoItemOption[]>({
    queryKey: ['items', 'pr-create'],
    queryFn: async () => (await api.get('/items?limit=5000&include_inactive=false')).data || [],
    retry: false,
  })

  const purchasableItems = useMemo(
    () => items.filter((i) => ['raw_material', 'feed', 'flour', 'fuel'].includes(i.type)),
    [items],
  )

  const addLine = () => {
    if (!draftItemId) return
    const qty = Math.max(0, Number(draftQty) || 0)
    const est = Math.max(0, Number(draftPrice) || 0)
    if (qty <= 0) return
    setLines((prev) => [...prev.filter((l) => l.item_id !== draftItemId), { item_id: draftItemId, qty, est_unit_price: est }])
    setDraftItemId(null)
    setDraftQty('1')
    setDraftPrice('0')
  }

  const createMut = useMutation({
    mutationFn: async () => {
      const payload = {
        supplier_id: supplierId === '' ? null : supplierId,
        warehouse_id: warehouseId === '' ? null : warehouseId,
        needed_by: null,
        purpose: purpose || null,
        lines: lines.map((l) => ({
          item_id: l.item_id,
          qty: l.qty,
          est_unit_price: l.est_unit_price,
        })),
      }
      const res = await api.post('/requisitions/purchase', payload)
      return res.data as { id: number }
    },
    onSuccess: (d) => router.push(`/purchase/requisitions/${d.id}`),
  })

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <div className="mb-6">
        <Link href="/purchase/requisitions" className="text-sm font-medium text-primary hover:text-primary">
          ← Purchase requisitions
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-foreground">New purchase requisition</h1>
        <p className="mt-1 text-sm text-muted-foreground">Save as draft, then submit for procurement head and executive approval.</p>
      </div>

      <div className="space-y-4 rounded-xl border border-border bg-white p-6 shadow-sm">
        <div>
          <label className="block text-sm font-medium text-foreground/85">Supplier (optional at draft)</label>
          <select
            value={supplierId}
            onChange={(e) => setSupplierId(e.target.value ? Number(e.target.value) : '')}
            className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm shadow-sm"
          >
            <option value="">— Select later —</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-foreground/85">Warehouse (optional)</label>
          <select
            value={warehouseId}
            onChange={(e) => setWarehouseId(e.target.value ? Number(e.target.value) : '')}
            className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm shadow-sm"
          >
            <option value="">—</option>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-foreground/85">Purpose / notes</label>
          <textarea
            value={purpose}
            onChange={(e) => setPurpose(e.target.value)}
            rows={2}
            className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm shadow-sm"
          />
        </div>

        <div className="border-t border-border/70 pt-4">
          <h3 className="text-sm font-semibold text-foreground">Lines</h3>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="min-w-0 flex-1">
              <PurchaseItemCombobox items={purchasableItems} value={draftItemId} onChange={setDraftItemId} />
            </div>
            <input
              type="number"
              min={0}
              step="any"
              value={draftQty}
              onChange={(e) => setDraftQty(e.target.value)}
              placeholder="Qty"
              className="w-28 rounded-md border border-border px-2 py-2 text-sm"
            />
            <input
              type="number"
              min={0}
              step="any"
              value={draftPrice}
              onChange={(e) => setDraftPrice(e.target.value)}
              placeholder="Est. price"
              className="w-32 rounded-md border border-border px-2 py-2 text-sm"
            />
            <button
              type="button"
              onClick={addLine}
              className="rounded-md bg-muted px-3 py-2 text-sm font-medium text-foreground hover:bg-muted"
            >
              Add line
            </button>
          </div>
          <ul className="mt-3 space-y-1 text-sm text-foreground/85">
            {lines.map((l) => {
              const it = purchasableItems.find((x) => x.id === l.item_id)
              return (
                <li key={l.item_id} className="flex justify-between rounded bg-muted/40 px-2 py-1">
                  <span>{it?.name || `Item #${l.item_id}`}</span>
                  <span>
                    {l.qty} × {l.est_unit_price}
                  </span>
                  <button
                    type="button"
                    className="text-destructive hover:underline"
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
          <p className="text-sm text-destructive">
            {(createMut.error as { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'Could not save'}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Link
            href="/purchase/requisitions"
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground/85 hover:bg-muted/40"
          >
            Cancel
          </Link>
          <button
            type="button"
            disabled={lines.length === 0 || createMut.isPending}
            onClick={() => createMut.mutate()}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white shadow hover:bg-accent0 disabled:opacity-50"
          >
            {createMut.isPending ? 'Saving…' : 'Create draft'}
          </button>
        </div>
      </div>
    </div>
  )
}
