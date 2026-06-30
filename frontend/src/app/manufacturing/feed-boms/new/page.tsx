'use client'

import { useMemo, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { api } from '@/lib/api'
import { formatQuantity } from '@/utils/quantity'

type FeedProduct = {
  id: number
  item_id: number
  category: string
  subtype?: string | null
  stage?: string | null
  pellet_size_mm?: number | null
  packaging?: string | null
}

type Ingredient = {
  id: number
  item_id: number
  ingredient_type: string
  is_premix: boolean
}

type Item = {
  id: number
  sku: string
  name: string
  type: string
  standard_cost?: number | null
}

type NewLine = {
  ingredient_id: number
  sequence: number
  inclusion_basis: 'percent' | 'kg_per_ton' | 'g_per_ton'
  inclusion_value: number
  loss_factor_pct: number
  phase?: string
  min_percent?: number
  max_percent?: number
}

export default function NewFeedBomPage() {
  const router = useRouter()

  const { data: items = [] } = useQuery<Item[]>({
    queryKey: ['items', 'for-bom-builder'],
    queryFn: async () => {
      const res = await api.get('/items?limit=5000&include_inactive=false')
      return res.data || []
    },
    retry: false,
    refetchOnWindowFocus: false,
  })

  const { data: products = [], isLoading: productsLoading } = useQuery<FeedProduct[]>({
    queryKey: ['feed-products'],
    queryFn: async () => {
      const res = await api.get('/feed/feed-products')
      return res.data || []
    },
    retry: false,
    refetchOnWindowFocus: false,
  })

  const { data: ingredients = [], isLoading: ingredientsLoading } = useQuery<Ingredient[]>({
    queryKey: ['ingredients'],
    queryFn: async () => {
      const res = await api.get('/feed/ingredients')
      return res.data || []
    },
    retry: false,
    refetchOnWindowFocus: false,
  })

  const [form, setForm] = useState({
    bom_code: '',
    product_id: 0,
    version: '1.0',
    default_batch_size_ton: 1.0,
    process_type: 'pellet',
    pellet_size_mm: '' as string,
    is_floating: false,
    notes: '',
  })

  const [ingredientSearch, setIngredientSearch] = useState('')

  const [lines, setLines] = useState<NewLine[]>([])
  const [newLine, setNewLine] = useState<NewLine>({
    ingredient_id: 0,
    sequence: 0,
    inclusion_basis: 'percent',
    inclusion_value: 0,
    loss_factor_pct: 0,
    phase: '',
  })

  const canSubmit = useMemo(() => {
    if (!form.bom_code.trim()) return false
    if (!form.product_id) return false
    if (!form.process_type.trim()) return false
    if (!form.version.trim()) return false
    if (!(form.default_batch_size_ton > 0)) return false
    return true
  }, [form])

  const itemById = useMemo(() => {
    const map = new Map<number, Item>()
    for (const it of items) map.set(it.id, it)
    return map
  }, [items])

  const ingredientDisplay = useMemo(() => {
    return ingredients.map((ing) => {
      const it = itemById.get(ing.item_id)
      const name = it ? `${it.sku} — ${it.name}` : `Item #${ing.item_id}`
      return { ...ing, display: `${name} • ${ing.ingredient_type}${ing.is_premix ? ' • premix' : ''}` }
    })
  }, [ingredients, itemById])

  const filteredIngredients = useMemo(() => {
    const s = ingredientSearch.trim().toLowerCase()
    if (!s) return ingredientDisplay
    return ingredientDisplay.filter((ing) => ing.display.toLowerCase().includes(s))
  }, [ingredientDisplay, ingredientSearch])

  const batch = useMemo(() => {
    const ton = Number(form.default_batch_size_ton) || 0
    const kg = ton * 1000
    return { ton, kg }
  }, [form.default_batch_size_ton])

  const computed = useMemo(() => {
    const rows = lines.map((l) => {
      const basis = l.inclusion_basis
      const val = Number(l.inclusion_value) || 0
      let kg = 0
      if (basis === 'percent') kg = (batch.kg * val) / 100
      if (basis === 'kg_per_ton') kg = batch.ton * val
      if (basis === 'g_per_ton') kg = (batch.ton * val) / 1000
      const pct = batch.kg > 0 ? (kg / batch.kg) * 100 : 0
      return { ...l, computedKg: kg, computedPct: pct }
    })
    const totalKg = rows.reduce((acc, r) => acc + (Number.isFinite(r.computedKg) ? r.computedKg : 0), 0)
    const totalPct = batch.kg > 0 ? (totalKg / batch.kg) * 100 : 0
    const premixGPerTon = rows
      .filter((r) => r.inclusion_basis === 'g_per_ton')
      .reduce((acc, r) => acc + (Number(r.inclusion_value) || 0), 0)
    const ok = Math.abs(totalPct - 100) <= 0.01
    return { rows, totalKg, totalPct, premixGPerTon, ok }
  }, [lines, batch.kg, batch.ton])

  const createMutation = useMutation({
    mutationFn: async () => {
      const payload: any = {
        bom_code: form.bom_code.trim(),
        product_id: form.product_id,
        version: form.version.trim(),
        default_batch_size_ton: Number(form.default_batch_size_ton),
        process_type: form.process_type.trim(),
        pellet_size_mm: form.pellet_size_mm.trim() ? Number(form.pellet_size_mm) : undefined,
        is_floating: Boolean(form.is_floating),
        notes: form.notes.trim() ? form.notes.trim() : undefined,
        lines: lines.map((l) => ({
          ingredient_id: l.ingredient_id,
          sequence: l.sequence,
          inclusion_basis: l.inclusion_basis,
          inclusion_value: Number(l.inclusion_value),
          loss_factor_pct: Number(l.loss_factor_pct ?? 0),
          phase: l.phase?.trim() ? l.phase.trim() : undefined,
          min_percent: l.min_percent,
          max_percent: l.max_percent,
        })),
      }

      const res = await api.post('/feed/feed-boms', payload)
      return res.data
    },
    onSuccess: (bom: any) => {
      router.push(`/manufacturing/feed-boms/${bom.id}`)
    },
  })

  const addLine = () => {
    if (!newLine.ingredient_id) {
      alert('Select an ingredient')
      return
    }
    if (!(newLine.inclusion_value > 0)) {
      alert('Inclusion value must be > 0')
      return
    }
    setLines((prev) => {
      const next = [...prev]
      next.push({ ...newLine })
      next.sort((a, b) => a.sequence - b.sequence)
      return next
    })
    setNewLine({
      ingredient_id: 0,
      sequence: (lines.length || 0) + 1,
      inclusion_basis: 'percent',
      inclusion_value: 0,
      loss_factor_pct: 0,
      phase: '',
    })
  }

  const removeLine = (idx: number) => {
    setLines((prev) => prev.filter((_, i) => i !== idx))
  }

  return (
          <div className="space-y-6">
        <div className="bg-white rounded-xl border border-border shadow-sm p-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="text-sm text-muted-foreground">Manufacturing</div>
              <h2 className="mt-1 text-2xl font-semibold text-foreground tracking-tight">New Feed BOM / Formulation</h2>
              <p className="mt-2 text-sm text-muted-foreground max-w-3xl">
                Create a formulation with versioning, validation, and batch-size aware totals. Approve it to run production orders.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <Link
                href="/manufacturing/feed-boms"
                className="inline-flex items-center justify-center rounded-md border border-border bg-white px-3 py-2 text-sm font-medium text-foreground/85 hover:bg-muted/40"
              >
                Back
              </Link>
              <button
                type="button"
                onClick={() => createMutation.mutate()}
                disabled={!canSubmit || createMutation.isPending}
                className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary/90 shadow-sm disabled:opacity-50"
              >
                {createMutation.isPending ? 'Creating…' : 'Create BOM'}
              </button>
            </div>
          </div>

          {createMutation.isError && (
            <div className="mt-4 rounded-lg border border-destructive/25 bg-destructive/5 p-4 text-sm text-destructive">
              {(createMutation.error as any)?.response?.data?.detail || (createMutation.error as any)?.message || 'Failed to create BOM'}
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          <div className="xl:col-span-2 space-y-6">
            <div className="bg-white rounded-xl border border-border shadow-sm p-6">
              <div className="text-sm font-semibold text-foreground">BOM details</div>
              <div className="text-xs text-muted-foreground mt-1">Define identity, product, and batch assumptions.</div>

              <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-foreground/85 mb-1">BOM code *</label>
              <input
                value={form.bom_code}
                onChange={(e) => setForm({ ...form, bom_code: e.target.value })}
                placeholder="e.g. FISH-GROWER-28P"
                className="w-full rounded-md border border-border bg-white px-3 py-2 text-sm shadow-sm focus:border-ring focus:ring-ring"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground/85 mb-1">Version *</label>
              <input
                value={form.version}
                onChange={(e) => setForm({ ...form, version: e.target.value })}
                className="w-full rounded-md border border-border bg-white px-3 py-2 text-sm shadow-sm focus:border-ring focus:ring-ring"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground/85 mb-1">Feed product *</label>
              <select
                value={form.product_id}
                onChange={(e) => setForm({ ...form, product_id: Number(e.target.value) })}
                className="w-full rounded-md border border-border bg-white px-3 py-2 text-sm shadow-sm focus:border-ring focus:ring-ring"
              >
                <option value={0} disabled>
                  {productsLoading ? 'Loading products…' : 'Select a product…'}
                </option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    #{p.id} • item #{p.item_id} • {p.category}{p.subtype ? ` / ${p.subtype}` : ''}{p.stage ? ` / ${p.stage}` : ''}
                  </option>
                ))}
              </select>
              <div className="mt-1 text-xs text-muted-foreground">
                Missing product? Create the underlying Item first in <Link className="text-primary font-semibold hover:text-foreground/85" href="/items">Items</Link>, then create Feed Product.
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground/85 mb-1">Default batch size (ton) *</label>
              <input
                type="number"
                step="0.001"
                value={form.default_batch_size_ton}
                onChange={(e) => setForm({ ...form, default_batch_size_ton: Number(e.target.value) })}
                className="w-full rounded-md border border-border bg-white px-3 py-2 text-sm shadow-sm focus:border-ring focus:ring-ring"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground/85 mb-1">Process type *</label>
              <select
                value={form.process_type}
                onChange={(e) => setForm({ ...form, process_type: e.target.value })}
                className="w-full rounded-md border border-border bg-white px-3 py-2 text-sm shadow-sm focus:border-ring focus:ring-ring"
              >
                <option value="pellet">Pellet</option>
                <option value="extrusion">Extrusion</option>
                <option value="mash">Mash</option>
                <option value="crumbles">Crumbles</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground/85 mb-1">Pellet size (mm)</label>
              <input
                value={form.pellet_size_mm}
                onChange={(e) => setForm({ ...form, pellet_size_mm: e.target.value })}
                placeholder="e.g. 2.0"
                className="w-full rounded-md border border-border bg-white px-3 py-2 text-sm shadow-sm focus:border-ring focus:ring-ring"
              />
            </div>

            <div className="md:col-span-2">
              <label className="inline-flex items-center gap-2 text-sm font-medium text-foreground/85">
                <input
                  type="checkbox"
                  checked={form.is_floating}
                  onChange={(e) => setForm({ ...form, is_floating: e.target.checked })}
                />
                Floating feed
              </label>
            </div>

            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-foreground/85 mb-1">Notes</label>
              <textarea
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                rows={3}
                className="w-full rounded-md border border-border bg-white px-3 py-2 text-sm shadow-sm focus:border-ring focus:ring-ring"
              />
            </div>
          </div>
            </div>

            <div className="bg-white rounded-xl border border-border shadow-sm p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-lg font-semibold text-foreground">Formulation lines</h3>
              <p className="text-sm text-muted-foreground mt-1">
                Build the formula with % / kg per ton / g per ton. Totals update live based on batch size.
              </p>
            </div>
            <div className="text-xs text-muted-foreground">{lines.length} line(s)</div>
          </div>

          <div className="mt-4">
            <div className="grid grid-cols-1 md:grid-cols-7 gap-3">
              <div className="md:col-span-3">
                <label className="block text-xs font-semibold text-muted-foreground uppercase mb-1">Ingredient *</label>
                <input
                  value={ingredientSearch}
                  onChange={(e) => setIngredientSearch(e.target.value)}
                  placeholder="Search ingredient by SKU/name/type…"
                  className="w-full rounded-md border border-border bg-white px-3 py-2 text-sm mb-2"
                />
                <select
                  value={newLine.ingredient_id}
                  onChange={(e) => setNewLine({ ...newLine, ingredient_id: Number(e.target.value) })}
                  className="w-full rounded-md border border-border bg-white px-3 py-2 text-sm"
                >
                  <option value={0} disabled>
                    {ingredientsLoading ? 'Loading ingredients…' : 'Select ingredient…'}
                  </option>
                  {filteredIngredients.map((i: any) => (
                    <option key={i.id} value={i.id}>
                      {i.display}
                    </option>
                  ))}
                </select>
              </div>

            <div>
              <label className="block text-xs font-semibold text-muted-foreground uppercase mb-1">Seq</label>
              <input
                type="number"
                value={newLine.sequence}
                onChange={(e) => setNewLine({ ...newLine, sequence: Number(e.target.value) })}
                className="w-full rounded-md border border-border bg-white px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-muted-foreground uppercase mb-1">Basis</label>
              <select
                value={newLine.inclusion_basis}
                onChange={(e) => setNewLine({ ...newLine, inclusion_basis: e.target.value as any })}
                className="w-full rounded-md border border-border bg-white px-3 py-2 text-sm"
              >
                <option value="percent">%</option>
                <option value="kg_per_ton">kg/ton</option>
                <option value="g_per_ton">g/ton</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-muted-foreground uppercase mb-1">Value *</label>
              <input
                type="number"
                step="0.0001"
                value={newLine.inclusion_value}
                onChange={(e) => setNewLine({ ...newLine, inclusion_value: Number(e.target.value) })}
                className="w-full rounded-md border border-border bg-white px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-muted-foreground uppercase mb-1">Loss %</label>
              <input
                type="number"
                step="0.01"
                value={newLine.loss_factor_pct}
                onChange={(e) => setNewLine({ ...newLine, loss_factor_pct: Number(e.target.value) })}
                className="w-full rounded-md border border-border bg-white px-3 py-2 text-sm"
              />
            </div>

              <div className="md:col-span-2 flex items-end gap-2">
                <button
                  type="button"
                  onClick={addLine}
                  className="inline-flex w-full items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary/90"
                >
                  Add line
                </button>
                <button
                  type="button"
                  onClick={() => setLines([])}
                  className="inline-flex w-full items-center justify-center rounded-md border border-border bg-white px-4 py-2 text-sm font-semibold text-foreground/85 hover:bg-muted/40"
                >
                  Clear
                </button>
              </div>
            </div>
          </div>

          <div className="mt-6 overflow-x-auto rounded-lg border border-border">
            <table className="min-w-full divide-y divide-border">
              <thead className="bg-muted/40">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Seq</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Ingredient</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Basis</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase">Value</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase">Loss %</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase">Computed kg</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase">Computed %</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase">Action</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-border/70">
                {lines.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-6 text-center text-sm text-muted-foreground">
                      No lines yet.
                    </td>
                  </tr>
                ) : (
                  computed.rows.map((l: any, idx: number) => (
                    <tr key={`${l.ingredient_id}-${idx}`} className="hover:bg-muted/40">
                      <td className="px-4 py-3 text-sm text-foreground">{l.sequence}</td>
                      <td className="px-4 py-3 text-sm text-foreground">
                        <div className="font-semibold">
                          {ingredientDisplay.find((x: any) => x.id === l.ingredient_id)?.display || `#${l.ingredient_id}`}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-foreground/85">{l.inclusion_basis}</td>
                      <td className="px-4 py-3 text-sm text-foreground text-right">{Number(l.inclusion_value).toFixed(4)}</td>
                      <td className="px-4 py-3 text-sm text-foreground text-right">{Number(l.loss_factor_pct || 0).toFixed(2)}</td>
                      <td className="px-4 py-3 text-sm text-foreground text-right">{formatQuantity(l.computedKg || 0)}</td>
                      <td className="px-4 py-3 text-sm text-foreground text-right">{Number(l.computedPct || 0).toFixed(4)}</td>
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => removeLine(idx)}
                          className="text-sm font-semibold text-destructive hover:text-red-900"
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
            </div>
          </div>

          <div className="space-y-6">
            <div className="bg-white rounded-xl border border-border shadow-sm p-6">
              <div className="text-sm font-semibold text-foreground">Formula summary</div>
              <div className="text-xs text-muted-foreground mt-1">Live totals for the selected batch size.</div>

              <div className="mt-4 grid grid-cols-1 gap-3">
                <div className="rounded-lg border border-border bg-muted/40 px-4 py-3">
                  <div className="text-xs font-semibold text-muted-foreground uppercase">Batch size</div>
                  <div className="mt-1 text-sm font-semibold text-foreground">
                    {formatQuantity(batch.ton)} ton ({formatQuantity(batch.kg)} kg)
                  </div>
                </div>
                <div className="rounded-lg border border-border bg-muted/40 px-4 py-3">
                  <div className="text-xs font-semibold text-muted-foreground uppercase">Total inclusion</div>
                  <div className="mt-1 text-sm font-semibold text-foreground">
                    {computed.totalPct.toFixed(4)}% • {formatQuantity(computed.totalKg)} kg
                  </div>
                  <div className={`mt-2 text-xs font-semibold ${computed.ok ? 'text-success' : 'text-warning-foreground'}`}>
                    {computed.ok ? 'OK (≈ 100%)' : 'Check: total should be 100% for a complete formula'}
                  </div>
                </div>
                <div className="rounded-lg border border-border bg-muted/40 px-4 py-3">
                  <div className="text-xs font-semibold text-muted-foreground uppercase">Premix (g/ton)</div>
                  <div className="mt-1 text-sm font-semibold text-foreground">{computed.premixGPerTon.toFixed(1)} g/ton</div>
                </div>

                <div className="rounded-lg border border-border bg-white px-4 py-3">
                  <div className="text-xs font-semibold text-muted-foreground uppercase">Operational tips</div>
                  <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                    <li>- Use <span className="font-semibold">g/ton</span> for premixes & micro-additives.</li>
                    <li>- Use <span className="font-semibold">kg/ton</span> for dosing like oil, binders, additives.</li>
                    <li>- Approve after totals are valid, then create production orders.</li>
                  </ul>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-xl border border-border shadow-sm p-6">
              <div className="text-sm font-semibold text-foreground">Master data shortcuts</div>
              <div className="text-xs text-muted-foreground mt-1">If you’re missing ingredients/products, create them first.</div>
              <div className="mt-4 flex flex-col gap-2">
                <Link
                  href="/items"
                  className="inline-flex items-center justify-center rounded-md border border-border bg-white px-4 py-2 text-sm font-semibold text-foreground/85 hover:bg-muted/40"
                >
                  Open Items (create raw materials / packaging / finished goods)
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
  )
}
