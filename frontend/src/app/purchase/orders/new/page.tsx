'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useMutation, useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { PurchaseItemCombobox, type PoItemOption } from '@/components/purchase/PurchaseItemCombobox'
import { industrialUomReference } from '@/config/industrial-uom-reference'

type Supplier = { id: number; name: string }

type TenantUomRow = {
  code: string
  name: string
  category: string
  base_unit: string | null
  conversion_factor: number
  is_active: boolean
}

type Line = { item_id: number; qty: number; unit_price: number }

function parsePositiveNum(s: string, fallback = 0): number {
  const n = Number(String(s).replace(/,/g, ''))
  if (!Number.isFinite(n) || n < 0) return fallback
  return n
}

export default function NewPurchaseOrderPage() {
  const router = useRouter()

  const { data: suppliers = [] } = useQuery<Supplier[]>({
    queryKey: ['suppliers'],
    queryFn: async () => (await api.get('/suppliers')).data || [],
    retry: false,
    refetchOnWindowFocus: false,
  })

  const { data: items = [] } = useQuery<PoItemOption[]>({
    queryKey: ['items', 'for-po-create'],
    queryFn: async () => (await api.get('/items?limit=5000&include_inactive=false')).data || [],
    retry: false,
    refetchOnWindowFocus: false,
  })

  const purchasableItems = useMemo(
    () =>
      items.filter((i) =>
        ['raw_material', 'feed', 'flour', 'fuel'].includes(i.type),
      ),
    [items]
  )

  const { data: tenantUoms = [], isFetched: uomsFetched } = useQuery<TenantUomRow[]>({
    queryKey: ['tenant-uoms', 'po-new'],
    queryFn: async () => (await api.get('/uoms')).data || [],
    retry: false,
    refetchOnWindowFocus: false,
  })

  const uomsGrouped = useMemo(() => {
    const rows = tenantUoms.filter((u) => u.is_active)
    if (rows.length === 0) return null
    const byCat = new Map<string, TenantUomRow[]>()
    for (const u of rows) {
      const k = u.category || 'general'
      if (!byCat.has(k)) byCat.set(k, [])
      byCat.get(k)!.push(u)
    }
    return Array.from(byCat.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([category, list]) => ({
        category,
        units: list.sort((x, y) => x.code.localeCompare(y.code)),
      }))
  }, [tenantUoms])

  const [form, setForm] = useState({
    supplier_id: 0,
    order_date: new Date().toISOString().slice(0, 10),
    expected_date: '',
  })

  const [lines, setLines] = useState<Line[]>([])
  const [draftItemId, setDraftItemId] = useState<number | null>(null)
  const [draftQty, setDraftQty] = useState('')
  const [draftPrice, setDraftPrice] = useState('')
  const [draftError, setDraftError] = useState<string | null>(null)

  const draftItem = useMemo(
    () => (draftItemId != null ? purchasableItems.find((x) => x.id === draftItemId) ?? null : null),
    [draftItemId, purchasableItems]
  )

  const total = useMemo(() => {
    return lines.reduce((acc, l) => acc + (Number(l.qty) || 0) * (Number(l.unit_price) || 0), 0)
  }, [lines])

  const addLine = () => {
    setDraftError(null)
    if (!draftItemId) {
      setDraftError('Choose an item from the catalog.')
      return
    }
    const qty = parsePositiveNum(draftQty)
    const price = parsePositiveNum(draftPrice)
    if (!(qty > 0)) {
      setDraftError('Enter a quantity greater than zero.')
      return
    }
    if (!(price >= 0)) {
      setDraftError('Enter a valid unit price (zero or positive).')
      return
    }

    setLines((prev) => [...prev, { item_id: draftItemId, qty, unit_price: price }])
    setDraftItemId(null)
    setDraftQty('')
    setDraftPrice('')
  }

  const updateLine = (index: number, patch: Partial<Line>) => {
    setLines((prev) =>
      prev.map((row, i) => (i === index ? { ...row, ...patch } : row))
    )
  }

  const removeLine = (index: number) => {
    setLines((prev) => prev.filter((_, i) => i !== index))
  }

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!form.supplier_id) throw new Error('Select a supplier')
      if (lines.length === 0) throw new Error('Add at least one line')
      const normalized = lines.map((l) => ({
        item_id: l.item_id,
        qty: Number(l.qty),
        unit_price: Number(l.unit_price),
      }))
      return api.post('/purchase/orders', {
        supplier_id: form.supplier_id,
        order_date: new Date(form.order_date).toISOString(),
        expected_date: form.expected_date ? new Date(form.expected_date).toISOString() : null,
        lines: normalized,
      })
    },
    onSuccess: (res) => {
      router.push(`/purchase/orders/${res.data.id}`)
    },
  })

  const errMsg =
    createMutation.isError &&
    ((createMutation.error as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
      (createMutation.error as Error)?.message ||
      'Could not create purchase order')

  return (
    <div className="min-h-[calc(100vh-4rem)] space-y-6 pb-24 lg:pb-8">
      {/* Header */}
      <div className="rounded-2xl border border-border/80 bg-gradient-to-br from-white to-slate-50/80 p-6 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <nav className="text-xs font-medium text-muted-foreground">
              <Link href="/purchase/orders" className="hover:text-primary">
                Purchase orders
              </Link>
              <span className="mx-1.5 text-muted-foreground/40">/</span>
              <span className="text-foreground/85">New</span>
            </nav>
            <h1 className="mt-2 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">Create purchase order</h1>
            <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-muted-foreground">
              Select a supplier, add material or fuel lines, then create. You can receive goods later via GRN into inventory.
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2 sm:justify-end">
            <Link
              href="/purchase/orders"
              className="inline-flex items-center justify-center rounded-lg border border-border bg-white px-4 py-2.5 text-sm font-semibold text-foreground/85 shadow-sm transition hover:bg-muted/40"
            >
              Cancel
            </Link>
            <button
              type="button"
              onClick={() => createMutation.mutate()}
              disabled={createMutation.isPending || lines.length === 0 || !form.supplier_id}
              className="inline-flex items-center justify-center rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-40"
            >
              {createMutation.isPending ? (
                <span className="flex items-center gap-2">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" aria-hidden />
                  Creating…
                </span>
              ) : (
                'Create purchase order'
              )}
            </button>
          </div>
        </div>

        {createMutation.isError && (
          <div className="mt-4 rounded-xl border border-destructive/25 bg-destructive/5 px-4 py-3 text-sm text-destructive" role="alert">
            {String(errMsg)}
          </div>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_minmax(260px,320px)] xl:gap-8">
        <div className="space-y-6">
          {/* Supplier & dates */}
          <section className="rounded-2xl border border-border bg-white p-6 shadow-sm">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Order details</h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              <div className="sm:col-span-2 xl:col-span-1">
                <label htmlFor="po-supplier" className="block text-sm font-medium text-foreground">
                  Supplier <span className="text-red-500">*</span>
                </label>
                <select
                  id="po-supplier"
                  value={form.supplier_id}
                  onChange={(e) => setForm({ ...form, supplier_id: Number(e.target.value) })}
                  className="mt-1.5 w-full rounded-lg border border-border bg-white px-3 py-2.5 text-sm shadow-sm transition focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20"
                >
                  <option value={0}>Select supplier…</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="po-order-date" className="block text-sm font-medium text-foreground">
                  Order date
                </label>
                <input
                  id="po-order-date"
                  type="date"
                  value={form.order_date}
                  onChange={(e) => setForm({ ...form, order_date: e.target.value })}
                  className="mt-1.5 w-full rounded-lg border border-border bg-white px-3 py-2.5 text-sm shadow-sm transition focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20"
                />
              </div>
              <div>
                <label htmlFor="po-expected" className="block text-sm font-medium text-foreground">
                  Expected date
                </label>
                <input
                  id="po-expected"
                  type="date"
                  value={form.expected_date}
                  onChange={(e) => setForm({ ...form, expected_date: e.target.value })}
                  className="mt-1.5 w-full rounded-lg border border-border bg-white px-3 py-2.5 text-sm shadow-sm transition focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20"
                />
              </div>
            </div>
          </section>

          {/* Add line */}
          <section className="rounded-2xl border border-border bg-white p-6 shadow-sm">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-foreground">Line items</h2>
                <p className="text-sm text-muted-foreground">
                  Quantities use each item&apos;s <strong>stocking unit</strong> (UoM from master data). Unit price is per that UoM
                  (e.g. per KG, per L, per MT).
                </p>
              </div>
              <span className="text-xs font-medium text-muted-foreground/70">{purchasableItems.length} items available</span>
            </div>

            <div className="mt-6 rounded-xl border border-dashed border-primary/25 bg-accent/30 p-4 sm:p-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-foreground/80">Add a line</p>
              <div className="mt-4 flex flex-col gap-4 xl:flex-row xl:items-end">
                <div className="min-w-0 flex-1">
                  <label className="mb-1.5 block text-sm font-medium text-foreground">Item</label>
                  <PurchaseItemCombobox
                    items={purchasableItems}
                    value={draftItemId}
                    onChange={setDraftItemId}
                    placeholder="Search SKU or product name…"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-2 xl:w-auto xl:grid-cols-2 xl:gap-3">
                  <div className="w-full min-w-[7rem] xl:w-32">
                    <label htmlFor="draft-qty" className="mb-1.5 block text-sm font-medium text-foreground">
                      Quantity
                      {draftItem?.uom?.code ? (
                        <span className="ml-1 font-normal text-emerald-700">({draftItem.uom.code})</span>
                      ) : null}
                    </label>
                    <input
                      id="draft-qty"
                      inputMode="decimal"
                      value={draftQty}
                      onChange={(e) => setDraftQty(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          addLine()
                        }
                      }}
                      placeholder="0"
                      className="w-full rounded-lg border border-border bg-white px-3 py-2.5 text-sm tabular-nums shadow-sm focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20"
                    />
                  </div>
                  <div className="w-full min-w-[7rem] xl:w-36">
                    <label htmlFor="draft-price" className="mb-1.5 block text-sm font-medium text-foreground">
                      {draftItem?.uom ? `Price / ${draftItem.uom.code}` : 'Unit price'}
                    </label>
                    <div className="relative">
                      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">₹</span>
                      <input
                        id="draft-price"
                        inputMode="decimal"
                        value={draftPrice}
                        onChange={(e) => setDraftPrice(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault()
                            addLine()
                          }
                        }}
                        placeholder="0.00"
                        className="w-full rounded-lg border border-border bg-white py-2.5 pl-8 pr-3 text-sm tabular-nums shadow-sm focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20"
                      />
                    </div>
                  </div>
                </div>
                <div className="flex w-full flex-col justify-end xl:w-40">
                  <button
                    type="button"
                    onClick={addLine}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-primary/90 active:scale-[0.99]"
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                    Add line
                  </button>
                </div>
              </div>
              {draftError && (
                <p className="mt-3 text-sm font-medium text-destructive" role="status">
                  {draftError}
                </p>
              )}
              {draftItem?.uom && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Stocking unit: <strong>{draftItem.uom.code}</strong> — {draftItem.uom.name}. Order in this unit; conversions are handled at
                  receipt/production if configured.
                </p>
              )}
            </div>

            {/* Lines table */}
            <div className="mt-8">
              <div className="overflow-hidden rounded-xl border border-border">
                <div className="hidden bg-muted/40 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground md:grid md:[grid-template-columns:minmax(0,1fr)_56px_88px_104px_104px_100px_72px] md:gap-2 md:px-4">
                  <span>Item</span>
                  <span className="text-center">UoM</span>
                  <span className="text-right">Qty</span>
                  <span className="text-right">Price / UoM</span>
                  <span className="text-right">Line total</span>
                  <span className="sr-only">Actions</span>
                </div>
                {lines.length === 0 ? (
                  <div className="bg-muted/40/50 px-6 py-16 text-center">
                    <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted/80 text-muted-foreground">
                      <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={1.5}
                          d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
                        />
                      </svg>
                    </div>
                    <p className="mt-4 text-sm font-medium text-foreground">No line items yet</p>
                    <p className="mt-1 text-sm text-muted-foreground">Select an item, enter quantity and price, then tap Add line.</p>
                  </div>
                ) : (
                  <ul className="divide-y divide-border/70 bg-white">
                    {lines.map((l, idx) => {
                      const it = purchasableItems.find((x) => x.id === l.item_id)
                      const lineTotal = (Number(l.qty) || 0) * (Number(l.unit_price) || 0)
                      return (
                        <li
                          key={`${l.item_id}-${idx}`}
                          className="px-4 py-4 md:grid md:[grid-template-columns:minmax(0,1fr)_56px_88px_104px_104px_100px_72px] md:items-center md:gap-2 md:py-3"
                        >
                          <div className="min-w-0">
                            <div className="md:hidden text-xs font-semibold uppercase text-muted-foreground/70">Item</div>
                            {it ? (
                              <div className="mt-0.5">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="font-mono text-xs font-semibold text-primary">{it.sku}</span>
                                </div>
                                <p className="mt-0.5 text-sm font-medium text-foreground">{it.name}</p>
                              </div>
                            ) : (
                              <span className="text-sm text-muted-foreground">Item #{l.item_id}</span>
                            )}
                          </div>
                          <div className="mt-2 md:mt-0 md:text-center">
                            <span className="text-xs font-semibold text-muted-foreground md:hidden">UoM</span>
                            {it?.uom?.code ? (
                              <span
                                className="inline-flex rounded-md bg-emerald-50 px-2 py-0.5 font-mono text-xs font-bold text-emerald-900 md:mx-auto"
                                title={it.uom.name}
                              >
                                {it.uom.code}
                              </span>
                            ) : (
                              <span className="text-xs text-muted-foreground/70">—</span>
                            )}
                          </div>
                          <div className="mt-3 flex items-center justify-between gap-2 md:mt-0 md:block md:text-right">
                            <span className="text-xs font-semibold text-muted-foreground md:hidden">Qty</span>
                            <input
                              aria-label={`Quantity for ${it?.sku ?? 'line'}`}
                              inputMode="decimal"
                              value={String(l.qty)}
                              onChange={(e) =>
                                updateLine(idx, { qty: parsePositiveNum(e.target.value, l.qty) })
                              }
                              className="inline-block w-full rounded-lg border border-border bg-white px-2 py-1.5 text-right text-sm tabular-nums shadow-sm focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring md:ml-auto md:max-w-[100px]"
                            />
                          </div>
                          <div className="mt-2 flex items-center justify-between gap-2 md:mt-0 md:block md:text-right">
                            <span className="text-xs font-semibold text-muted-foreground md:hidden">Price / UoM</span>
                            <div className="relative w-full md:ml-auto md:max-w-[120px]">
                              <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">₹</span>
                              <input
                                aria-label={`Unit price for ${it?.sku ?? 'line'}`}
                                inputMode="decimal"
                                value={String(l.unit_price)}
                                onChange={(e) =>
                                  updateLine(idx, { unit_price: parsePositiveNum(e.target.value, l.unit_price) })
                                }
                                className="w-full rounded-lg border border-border bg-white py-1.5 pl-6 pr-2 text-right text-sm tabular-nums shadow-sm focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
                              />
                            </div>
                          </div>
                          <div className="mt-2 flex items-center justify-between md:mt-0 md:block md:text-right">
                            <span className="text-xs font-semibold text-muted-foreground md:hidden">Line total</span>
                            <span className="text-sm font-semibold tabular-nums text-foreground">₹{lineTotal.toFixed(2)}</span>
                          </div>
                          <div className="mt-2 flex justify-end md:mt-0">
                            <button
                              type="button"
                              onClick={() => removeLine(idx)}
                              className="rounded-lg px-2 py-1.5 text-sm font-semibold text-destructive transition hover:bg-destructive/5"
                            >
                              Remove
                            </button>
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>
            </div>
          </section>
        </div>

        {/* Summary */}
        <aside className="space-y-6 lg:top-24 lg:self-start xl:sticky">
          <details
            open
            className="group rounded-2xl border border-border bg-white shadow-sm [&_summary::-webkit-details-marker]:hidden"
          >
            <summary className="cursor-pointer list-none rounded-2xl p-5 hover:bg-muted/40/80">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Units of measure (UoM)</h2>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    Codes your tenant can use on items. PO quantities and prices are always in the item&apos;s stocking UoM.
                  </p>
                </div>
                <span className="text-xs font-medium text-primary group-open:hidden">Show</span>
                <span className="hidden text-xs font-medium text-primary group-open:inline">Hide</span>
              </div>
            </summary>
            <div className="border-t border-border/70 px-5 pb-5">
              <div className="max-h-[min(420px,55vh)] space-y-4 overflow-y-auto pt-4">
                {uomsFetched && uomsGrouped && uomsGrouped.length > 0
                  ? uomsGrouped.map((g) => (
                      <div key={g.category}>
                        <h3 className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{g.category}</h3>
                        <ul className="mt-1.5 space-y-1 text-xs">
                          {g.units.map((u) => (
                            <li key={u.code} className="flex justify-between gap-2 border-b border-border/50 py-1 last:border-0">
                              <span className="font-mono font-semibold text-foreground">{u.code}</span>
                              <span className="text-muted-foreground">{u.name}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))
                  : industrialUomReference.map((g) => (
                      <div key={g.category}>
                        <h3 className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{g.category}</h3>
                        <p className="text-[10px] text-muted-foreground">{g.description}</p>
                        <ul className="mt-1.5 space-y-1 text-xs">
                          {g.units.map((u) => (
                            <li key={u.code} className="flex justify-between gap-2 border-b border-border/50 py-1 last:border-0">
                              <span className="font-mono font-semibold text-foreground">{u.code}</span>
                              <span className="text-muted-foreground">{u.name}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
              </div>
              {!uomsFetched ? (
                <p className="mt-2 text-[10px] text-muted-foreground/70">Loading tenant units…</p>
              ) : tenantUoms.length === 0 ? (
                <p className="mt-2 text-[10px] text-warning-foreground">
                  No tenant UoM API data — showing a standard industrial reference. Configure units under Settings → Units.
                </p>
              ) : null}
            </div>
          </details>

          <div className="rounded-2xl border border-border bg-white p-6 shadow-sm">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Summary</h2>
            <div className="mt-4 space-y-3 border-t border-border/70 pt-4">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Line items</span>
                <span className="font-semibold text-foreground">{lines.length}</span>
              </div>
              <div className="flex justify-between border-t border-dashed border-border pt-3">
                <span className="font-semibold text-foreground">Estimated total</span>
                <span className="text-xl font-bold tabular-nums text-foreground">₹{total.toFixed(2)}</span>
              </div>
            </div>
            <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
              After you create this order, use <strong>Receive (GRN)</strong> on the PO to post stock and accrue inventory.
            </p>
          </div>
        </aside>
      </div>

      {/* Mobile sticky bar */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-white/95 p-4 shadow-[0_-4px_20px_rgba(0,0,0,0.06)] backdrop-blur-sm lg:hidden">
        <div className="mx-auto flex max-w-lg items-center justify-between gap-3">
          <div>
            <div className="text-xs text-muted-foreground">Total</div>
            <div className="text-lg font-bold tabular-nums text-foreground">₹{total.toFixed(2)}</div>
          </div>
          <button
            type="button"
            onClick={() => createMutation.mutate()}
            disabled={createMutation.isPending || lines.length === 0 || !form.supplier_id}
            className="min-w-[160px] flex-1 rounded-xl bg-primary py-3 text-sm font-bold text-white shadow-sm disabled:opacity-40"
          >
            {createMutation.isPending ? 'Creating…' : 'Create PO'}
          </button>
        </div>
      </div>
    </div>
  )
}
