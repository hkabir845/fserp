'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Copy, Loader2, Plus, Trash2, X } from 'lucide-react'
import { useToast } from '@/components/Toast'
import api from '@/lib/api'
import { extractErrorMessage } from '@/utils/errorHandler'
import { getCurrencySymbol, formatNumber } from '@/utils/currency'
import { roundDecimalInputString } from '@/utils/inputDecimals'
import {
  type CycleRow,
  type CustomerSuggestion,
  type FishSpeciesOpt,
  type IncomeTypeOpt,
  type Pond,
  type SaleHeaderDraft,
  type SaleLineDraft,
  type SaleRow,
  customerPickLabel,
  emptyFishHarvestLine,
  emptyNonFishLine,
  fishPerKg,
  isEmptyFeedSackSaleIncome,
  isNonFishSaleIncome,
  newLineLocalId,
  saleRowToLineDraft,
} from './aquacultureSaleShared'
import { PartialHarvestAdvicePanel } from '@/app/aquaculture/PartialHarvestAdvicePanel'
import type { StockMetricsRow } from '@/app/aquaculture/aquacultureFishMetrics'
import { ReportingCategorySelectOptions } from '@/lib/reportingCategorySelect'

type Props = {
  open: boolean
  editing: SaleRow | null
  ponds: Pond[]
  incomeTypes: IncomeTypeOpt[]
  fishSpecies: FishSpeciesOpt[]
  customers: CustomerSuggestion[]
  currency: string
  defaultPondId: string
  onClose: () => void
  onSaved: () => void
}

function lineIsNonFish(line: SaleLineDraft, incomeTypes: IncomeTypeOpt[]): boolean {
  return isNonFishSaleIncome(line.income_type, incomeTypes)
}

type StockBreakdownRow = {
  pond_id: number
  production_cycle_id: number | null
  fish_species: string
  implied_net_weight_kg: string
  implied_net_fish_count: number
}

type Availability = { weightKg: number; count: number }

type LastSampleReference = {
  fish_per_kg?: string | null
  sample_date?: string
  production_cycle_id?: number | null
  cycle_scope_fallback?: boolean
}

function sumAvailability(
  line: SaleLineDraft,
  rows: StockBreakdownRow[],
  cycleFilter: string | null,
): Availability {
  const species = line.fish_species
  let weightKg = 0
  let count = 0
  for (const r of rows) {
    if (r.fish_species !== species) continue
    if (cycleFilter != null && String(r.production_cycle_id ?? '') !== cycleFilter) continue
    weightKg += Number(r.implied_net_weight_kg) || 0
    count += r.implied_net_fish_count || 0
  }
  return { weightKg, count }
}

function availabilityForLine(line: SaleLineDraft, rows: StockBreakdownRow[]): Availability | null {
  const species = line.fish_species
  if (!species || species === 'not_applicable') return null
  const cycle = line.production_cycle_id.trim()
  if (cycle === '') return sumAvailability(line, rows, null)
  const exact = sumAvailability(line, rows, cycle)
  if (exact.weightKg <= 0 && exact.count <= 0) {
    return sumAvailability(line, rows, null)
  }
  return exact
}

function lineSampleScopeKey(header: SaleHeaderDraft, line: SaleLineDraft): string {
  const other = line.fish_species === 'other' ? line.fish_species_other.trim() : ''
  return `${header.pond_id}|${line.production_cycle_id}|${line.fish_species}|${other}`
}

function applySamplePcsToLine(line: SaleLineDraft, fishPerKg: string): SaleLineDraft {
  const fpk = fishPerKg.trim()
  if (!fpk) return line
  const next = { ...line, fish_per_kg: roundDecimalInputString(fpk, 2) }
  next.fish_count = computeHeads(next.weight_kg, next.fish_per_kg)
  return next
}

function computeHeads(weightKg: string, fishPerKgStr: string): string {
  const wn = Number(weightKg)
  const fpkn = Number(fishPerKgStr.trim())
  if (!Number.isFinite(wn) || wn <= 0 || !Number.isFinite(fpkn) || fpkn <= 0) return ''
  const heads = Math.round(wn * fpkn)
  return heads > 0 ? String(heads) : ''
}

function computeLineTotal(weightKg: string, priceStr: string): string {
  const pTrim = priceStr.trim().replace(/,/g, '')
  if (pTrim === '') return ''
  const q = Number(String(weightKg).trim())
  const p = Number(pTrim)
  if (!Number.isFinite(q) || q <= 0 || !Number.isFinite(p) || p < 0) return ''
  return roundDecimalInputString(String(q * p), 2)
}

function buildPayload(
  header: SaleHeaderDraft,
  line: SaleLineDraft,
  incomeTypes: IncomeTypeOpt[]
): Record<string, unknown> {
  const nonFish = lineIsNonFish(line, incomeTypes)
  const wk = Number(line.weight_kg)
  const pTrim = line.sale_price_per_kg.trim().replace(/,/g, '')
  let ta: number
  if (pTrim !== '') {
    ta = Math.round(wk * Number(pTrim) * 100) / 100
  } else {
    ta = Number(line.total_amount)
  }
  const payload: Record<string, unknown> = {
    pond_id: parseInt(header.pond_id, 10),
    sale_date: header.sale_date,
    weight_kg: wk,
    total_amount: ta,
    income_type: line.income_type,
    fish_species: nonFish ? 'not_applicable' : line.fish_species,
    buyer_name: header.buyer_name.trim(),
    memo: header.memo.trim(),
  }
  if (!nonFish && line.fish_species === 'other') {
    payload.fish_species_other = line.fish_species_other.trim()
  }
  if (line.production_cycle_id) {
    payload.production_cycle_id = parseInt(line.production_cycle_id, 10)
  }
  if (!nonFish) {
    payload.fish_count = parseInt(line.fish_count, 10)
  } else {
    payload.fish_count = null
  }
  return payload
}

function validateLine(line: SaleLineDraft, index: number, incomeTypes: IncomeTypeOpt[]): string | null {
  const nonFish = lineIsNonFish(line, incomeTypes)
  const emptySacks = isEmptyFeedSackSaleIncome(line.income_type)
  const wk = Number(line.weight_kg)
  if (!Number.isFinite(wk) || wk <= 0) {
    if (emptySacks) return `Line ${index + 1}: sack count must be positive`
    return `Line ${index + 1}: ${nonFish ? 'quantity' : 'weight (kg)'} must be positive`
  }
  const pTrim = line.sale_price_per_kg.trim().replace(/,/g, '')
  let ta: number
  if (pTrim !== '') {
    const price = Number(pTrim)
    if (!Number.isFinite(price) || price < 0) {
      return `Line ${index + 1}: price must be zero or positive`
    }
    ta = Math.round(wk * price * 100) / 100
  } else {
    ta = Number(line.total_amount)
    if (line.total_amount.trim() === '') {
      return `Line ${index + 1}: enter price per kg or line total`
    }
  }
  if (!Number.isFinite(ta) || ta < 0) {
    return `Line ${index + 1}: invalid line total`
  }
  if (!nonFish) {
    const fpkTrim = line.fish_per_kg.trim()
    const fpkn = Number(fpkTrim)
    if (fpkTrim === '' || !Number.isFinite(fpkn) || fpkn <= 0) {
      return `Line ${index + 1}: fish per kg is required`
    }
    const n = parseInt(line.fish_count, 10)
    if (!Number.isFinite(n) || n <= 0) {
      return `Line ${index + 1}: fish count (heads) is required`
    }
  }
  return null
}

export function AquacultureSaleFormModal({
  open,
  editing,
  ponds,
  incomeTypes,
  fishSpecies,
  customers,
  currency,
  defaultPondId,
  onClose,
  onSaved,
}: Props) {
  const toast = useToast()
  const sym = getCurrencySymbol(currency)
  const isEdit = editing != null
  const [cycles, setCycles] = useState<CycleRow[]>([])
  const [stockRows, setStockRows] = useState<StockBreakdownRow[]>([])
  const [pondStockRow, setPondStockRow] = useState<StockMetricsRow | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [header, setHeader] = useState<SaleHeaderDraft>({
    pond_id: '',
    sale_date: '',
    buyer_name: '',
    memo: '',
  })
  const [lines, setLines] = useState<SaleLineDraft[]>([emptyFishHarvestLine()])
  const [sampleByScope, setSampleByScope] = useState<Record<string, LastSampleReference>>({})
  const skipAutoPcsLine = useRef<Set<string>>(new Set())
  const autoCycleFromSampleDone = useRef<Set<string>>(new Set())

  const speciesOptionsForFish = useMemo(
    () =>
      (fishSpecies.length ? fishSpecies : [{ id: 'tilapia', label: 'Tilapia' }]).filter(
        (s) => s.id !== 'not_applicable'
      ),
    [fishSpecies]
  )

  const grandTotal = useMemo(() => {
    let sum = 0
    for (const line of lines) {
      const pTrim = line.sale_price_per_kg.trim()
      const wk = Number(line.weight_kg)
      if (pTrim !== '' && Number.isFinite(wk) && wk > 0) {
        sum += wk * Number(pTrim.replace(/,/g, ''))
      } else {
        const t = Number(line.total_amount)
        if (Number.isFinite(t)) sum += t
      }
    }
    return Math.round(sum * 100) / 100
  }, [lines])

  const resetForm = useCallback(() => {
    const today = new Date().toISOString().slice(0, 10)
    const pond =
      defaultPondId && ponds.some((p) => String(p.id) === defaultPondId)
        ? defaultPondId
        : ponds[0]
          ? String(ponds[0].id)
          : ''
    if (editing) {
      setHeader({
        pond_id: String(editing.pond_id),
        sale_date: editing.sale_date.slice(0, 10),
        buyer_name: editing.buyer_name || '',
        memo: editing.memo || '',
      })
      setLines([saleRowToLineDraft(editing)])
    } else {
      setHeader({
        pond_id: pond,
        sale_date: today,
        buyer_name: '',
        memo: '',
      })
      setLines([emptyFishHarvestLine()])
    }
  }, [defaultPondId, ponds, editing])

  useEffect(() => {
    if (!open) return
    resetForm()
    skipAutoPcsLine.current = new Set()
    autoCycleFromSampleDone.current = new Set()
    setSampleByScope({})
  }, [open, resetForm])

  const fishLineScopes = useMemo(() => {
    if (!open || !header.pond_id) return [] as string[]
    const keys = new Set<string>()
    for (const line of lines) {
      if (lineIsNonFish(line, incomeTypes)) continue
      if (!line.fish_species || line.fish_species === 'not_applicable') continue
      keys.add(lineSampleScopeKey(header, line))
    }
    return [...keys]
  }, [open, header.pond_id, lines, incomeTypes])

  const fishLineScopesKey = fishLineScopes.join('\u0000')

  useEffect(() => {
    if (!open || isEdit || !header.pond_id || fishLineScopes.length === 0) {
      if (!open) setSampleByScope({})
      return
    }
    const ac = new AbortController()
    void (async () => {
      const next: Record<string, LastSampleReference> = {}
      await Promise.all(
        fishLineScopes.map(async (scopeKey) => {
          const [pondId, cycleId, species, speciesOther] = scopeKey.split('|')
          if (!pondId || !species) return
          try {
            const params: Record<string, string> = {
              pond_id: pondId,
              fish_species: species,
            }
            if (cycleId) params.production_cycle_id = cycleId
            if (species === 'other' && speciesOther) params.fish_species_other = speciesOther
            const { data } = await api.get<{ found: boolean } & Partial<LastSampleReference>>(
              '/aquaculture/biomass-samples/last-reference/',
              { params, signal: ac.signal },
            )
            if (data?.found && data.fish_per_kg) {
              next[scopeKey] = data as LastSampleReference
            }
          } catch {
            /* optional hint */
          }
        }),
      )
      if (!ac.signal.aborted) {
        setSampleByScope((prev) => ({ ...prev, ...next }))
      }
    })()
    return () => ac.abort()
  }, [open, isEdit, header.pond_id, fishLineScopesKey])

  const effectivePcsForLine = useCallback(
    (line: SaleLineDraft): string => {
      const scopeKey = lineSampleScopeKey(header, line)
      const ref = sampleByScope[scopeKey]
      const raw = ref?.fish_per_kg?.trim() ?? pondStockRow?.current_fish_per_kg?.trim() ?? ''
      if (!raw) return ''
      const n = Number(raw.replace(/,/g, ''))
      return Number.isFinite(n) && n > 0 ? raw : ''
    },
    [header.pond_id, sampleByScope, pondStockRow],
  )

  useEffect(() => {
    if (!open || isEdit) return
    setLines((prev) =>
      prev.map((line) => {
        if (lineIsNonFish(line, incomeTypes)) return line
        if (skipAutoPcsLine.current.has(line.localId)) return line
        const pcs = effectivePcsForLine(line)
        if (!pcs) return line
        let next = applySamplePcsToLine(line, pcs)
        const scopeKey = lineSampleScopeKey(header, line)
        const ref = sampleByScope[scopeKey]
        if (
          !line.production_cycle_id.trim() &&
          ref?.production_cycle_id != null &&
          !autoCycleFromSampleDone.current.has(line.localId)
        ) {
          autoCycleFromSampleDone.current.add(line.localId)
          next = { ...next, production_cycle_id: String(ref.production_cycle_id) }
        }
        if (next.fish_per_kg === line.fish_per_kg && next.fish_count === line.fish_count) {
          if (next.production_cycle_id === line.production_cycle_id) return line
        }
        return next
      }),
    )
  }, [open, isEdit, header.pond_id, sampleByScope, pondStockRow, effectivePcsForLine, incomeTypes])

  useEffect(() => {
    if (!open || !header.pond_id) {
      setCycles([])
      setStockRows([])
      setPondStockRow(null)
      return
    }
    void (async () => {
      try {
        const { data } = await api.get<CycleRow[]>('/aquaculture/production-cycles/', {
          params: { pond_id: header.pond_id },
        })
        setCycles(Array.isArray(data) ? data : [])
      } catch {
        setCycles([])
      }
    })()
    void (async () => {
      try {
        const { data } = await api.get<{ breakdown_rows?: StockBreakdownRow[]; rows?: StockMetricsRow[] }>(
          '/aquaculture/fish-stock-position/',
          { params: { pond_id: header.pond_id, breakdown: 'cycle_species' } }
        )
        setStockRows(Array.isArray(data?.breakdown_rows) ? data.breakdown_rows : [])
        setPondStockRow(Array.isArray(data?.rows) && data.rows[0] ? data.rows[0] : null)
      } catch {
        setStockRows([])
        setPondStockRow(null)
      }
    })()
  }, [open, header.pond_id])

  const updateLine = (localId: string, patch: Partial<SaleLineDraft>) => {
    if ('fish_per_kg' in patch) skipAutoPcsLine.current.add(localId)
    setLines((prev) =>
      prev.map((ln) => {
        if (ln.localId !== localId) return ln
        const next = { ...ln, ...patch }
        const nonFish = lineIsNonFish(next, incomeTypes)
        if (!nonFish && ('weight_kg' in patch || 'fish_per_kg' in patch)) {
          next.fish_count = computeHeads(next.weight_kg, next.fish_per_kg)
        }
        if ('weight_kg' in patch || 'sale_price_per_kg' in patch) {
          const auto = computeLineTotal(next.weight_kg, next.sale_price_per_kg)
          if (next.sale_price_per_kg.trim() !== '') next.total_amount = auto
        }
        if ('income_type' in patch) {
          if (nonFish) {
            next.fish_species = 'not_applicable'
            next.fish_species_other = ''
            next.fish_per_kg = ''
            next.fish_count = ''
          } else if (next.fish_species === 'not_applicable') {
            next.fish_species = 'tilapia'
          }
        }
        return next
      })
    )
  }

  const removeLine = (localId: string) => {
    setLines((prev) => {
      if (prev.length <= 1) return prev
      return prev.filter((l) => l.localId !== localId)
    })
  }

  const duplicateLine = (line: SaleLineDraft) => {
    const localId = newLineLocalId()
    setLines((prev) => [
      ...prev,
      {
        ...line,
        localId,
        weight_kg: '',
        fish_per_kg: '',
        fish_count: '',
        sale_price_per_kg: '',
        total_amount: '',
      },
    ])
  }

  const save = async () => {
    if (!header.pond_id || !header.sale_date) {
      toast.error('Pond and sale date are required')
      return
    }
    for (let i = 0; i < lines.length; i++) {
      const err = validateLine(lines[i], i, incomeTypes)
      if (err) {
        toast.error(err)
        return
      }
    }
    setSubmitting(true)
    try {
      if (isEdit && editing) {
        await api.put(`/aquaculture/sales/${editing.id}/`, buildPayload(header, lines[0], incomeTypes))
        toast.success('Sale updated')
      } else {
        const results = await Promise.allSettled(
          lines.map((line) => api.post('/aquaculture/sales/', buildPayload(header, line, incomeTypes)))
        )
        const ok = results.filter((r) => r.status === 'fulfilled').length
        const fail = results.length - ok
        if (fail === 0) {
          toast.success(ok === 1 ? 'Sale saved' : `${ok} sale lines saved`)
        } else if (ok > 0) {
          toast.error(`${ok} line(s) saved, ${fail} failed — refresh and complete missing lines`)
        } else {
          const first = results.find((r) => r.status === 'rejected') as PromiseRejectedResult | undefined
          throw first?.reason
        }
      }
      onSaved()
      onClose()
    } catch (e) {
      toast.error(extractErrorMessage(e, 'Save failed'))
    } finally {
      setSubmitting(false)
    }
  }

  if (!open) return null

  const inputCls =
    'erp-field py-2.5 shadow-sm focus:border-teal-500 focus:ring-primary/20'
  const labelCls = 'block text-xs font-semibold uppercase tracking-wide text-muted-foreground'
  const thCls =
    'px-2 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground'

  return (
    <>
      <datalist id="aq-sale-customer-suggestions">
        {customers.map((c) => (
          <option key={c.id} value={customerPickLabel(c)} />
        ))}
      </datalist>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/50 p-3 sm:p-6"
        role="dialog"
        aria-modal="true"
        aria-labelledby="aq-sale-form-title"
      >
      <div className="flex max-h-[96vh] w-full max-w-[1440px] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-border">
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-border bg-gradient-to-r from-teal-50 to-card px-5 py-4 sm:px-6">
          <div>
            <h2 id="aq-sale-form-title" className="text-xl font-bold tracking-tight text-foreground">
              {isEdit ? 'Edit sale line' : 'Record pond sale'}
            </h2>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              {isEdit
                ? 'Update this registered line. Posted lines must be changed via Invoices.'
                : 'One buyer visit can include several lines — e.g. same species from two production cycles at different sizes and prices.'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-muted-foreground hover:bg-muted"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">
          <section className="rounded-xl border border-border bg-muted/40/60 p-4 sm:p-5">
            <h3 className="text-sm font-semibold text-foreground">Sale header</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">Shared for every line on this ticket.</p>
            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <label className="block sm:col-span-1">
                <span className={labelCls}>
                  Pond <span className="text-destructive">*</span>
                </span>
                <select
                  className={`${inputCls} mt-1.5`}
                  value={header.pond_id}
                  disabled={isEdit}
                  onChange={(e) => setHeader((h) => ({ ...h, pond_id: e.target.value }))}
                >
                  {ponds.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block sm:col-span-1">
                <span className={labelCls}>
                  Sale date <span className="text-destructive">*</span>
                </span>
                <input
                  type="date"
                  className={`${inputCls} mt-1.5`}
                  value={header.sale_date}
                  onChange={(e) => setHeader((h) => ({ ...h, sale_date: e.target.value }))}
                />
              </label>
              <label className="block sm:col-span-2 lg:col-span-2">
                <span className={labelCls}>Buyer / customer</span>
                <input
                  className={`${inputCls} mt-1.5`}
                  list="aq-sale-customer-suggestions"
                  autoComplete="off"
                  placeholder="Wholesaler, market, or walk-in"
                  value={header.buyer_name}
                  onChange={(e) => setHeader((h) => ({ ...h, buyer_name: e.target.value }))}
                />
              </label>
              <label className="block sm:col-span-2 lg:col-span-4">
                <span className={labelCls}>Memo / delivery notes</span>
                <textarea
                  className={`${inputCls} mt-1.5`}
                  rows={2}
                  placeholder="Vehicle, gate pass, payment terms…"
                  value={header.memo}
                  onChange={(e) => setHeader((h) => ({ ...h, memo: e.target.value }))}
                />
              </label>
            </div>
          </section>

          {pondStockRow ? (
            <section className="mt-5">
              <PartialHarvestAdvicePanel row={pondStockRow} />
            </section>
          ) : null}

          <section className="mt-5">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-foreground">Sale lines</h3>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Tag each line to a <strong>production cycle</strong> when size and price differ. Duplicate species on
                  separate lines is normal.
                </p>
              </div>
              {!isEdit ? (
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setLines((prev) => [...prev, emptyFishHarvestLine()])}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-primary/35 bg-accent px-3 py-2 text-sm font-medium text-primary hover:bg-teal-100"
                  >
                    <Plus className="h-4 w-4" />
                    Fish harvest line
                  </button>
                  <button
                    type="button"
                    onClick={() => setLines((prev) => [...prev, emptyNonFishLine()])}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-2 text-sm font-medium text-foreground/85 hover:bg-muted/40"
                  >
                    <Plus className="h-4 w-4" />
                    Other pond income
                  </button>
                </div>
              ) : null}
            </div>

            <div className="mt-3 overflow-x-auto rounded-xl border border-border bg-white shadow-sm">
              <table className="min-w-[880px] w-full border-collapse text-sm">
                <thead className="border-b border-border bg-muted/40">
                  <tr>
                    <th className={`${thCls} w-8`}>#</th>
                    <th className={`${thCls} min-w-[9rem]`}>Production cycle</th>
                    <th className={`${thCls} min-w-[8rem]`}>Income type</th>
                    <th className={`${thCls} min-w-[7rem]`}>Species</th>
                    <th className={`${thCls} min-w-[5.5rem] text-right`}>Weight kg</th>
                    <th className={`${thCls} min-w-[5rem] text-right`}>Fish/kg</th>
                    <th className={`${thCls} min-w-[4.5rem] text-right`}>Heads</th>
                    <th className={`${thCls} min-w-[5.5rem] text-right`}>Price/kg</th>
                    <th className={`${thCls} min-w-[6rem] text-right`}>Line {sym}</th>
                    {!isEdit ? <th className={`${thCls} w-20`}><span className="sr-only">Actions</span></th> : null}
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line, idx) => {
                    const nonFish = lineIsNonFish(line, incomeTypes)
                    const emptySacks = isEmptyFeedSackSaleIncome(line.income_type)
                    const avail = nonFish ? null : availabilityForLine(line, stockRows)
                    const sampleRef = nonFish ? null : sampleByScope[lineSampleScopeKey(header, line)] ?? null
                    const reqWeight = Number(line.weight_kg)
                    const reqHeads = Number(line.fish_count)
                    const overWeight =
                      avail != null && Number.isFinite(reqWeight) && reqWeight > avail.weightKg + 1e-6
                    const overHeads =
                      avail != null && Number.isFinite(reqHeads) && reqHeads > avail.count
                    const noStock = avail != null && avail.weightKg <= 0 && avail.count <= 0
                    return (
                      <tr key={line.localId} className="border-b border-border/70 align-top hover:bg-muted/50">
                        <td className="px-2 py-2 text-center text-xs font-medium text-muted-foreground/70">{idx + 1}</td>
                        <td className="px-2 py-2">
                          <select
                            className={inputCls}
                            value={line.production_cycle_id}
                            onChange={(e) => updateLine(line.localId, { production_cycle_id: e.target.value })}
                            title="Cycle determines cohort size and typical price"
                          >
                            <option value="">— Pond total —</option>
                            {cycles.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.name}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-2 py-2">
                          <select
                            className={inputCls}
                            value={line.income_type}
                            onChange={(e) => updateLine(line.localId, { income_type: e.target.value })}
                          >
                            <option value="">Select income type…</option>
                            <ReportingCategorySelectOptions categories={incomeTypes} />
                          </select>
                        </td>
                        <td className="px-2 py-2">
                          {nonFish ? (
                            <span className="block py-2.5 text-xs text-muted-foreground/70">N/A</span>
                          ) : (
                            <div className="space-y-1">
                              <select
                                className={inputCls}
                                value={line.fish_species}
                                onChange={(e) =>
                                  updateLine(line.localId, {
                                    fish_species: e.target.value,
                                    fish_species_other: e.target.value === 'other' ? line.fish_species_other : '',
                                  })
                                }
                              >
                                {speciesOptionsForFish.map((s) => (
                                  <option key={s.id} value={s.id}>
                                    {s.label}
                                  </option>
                                ))}
                              </select>
                              {line.fish_species === 'other' ? (
                                <input
                                  className={inputCls}
                                  placeholder="Species name"
                                  value={line.fish_species_other}
                                  onChange={(e) =>
                                    updateLine(line.localId, { fish_species_other: e.target.value })
                                  }
                                />
                              ) : null}
                              {avail != null ? (
                                <p
                                  className={`text-[11px] font-medium leading-tight ${
                                    noStock || overWeight || overHeads ? 'text-destructive' : 'text-emerald-700'
                                  }`}
                                  title={
                                    noStock
                                      ? 'No live biomass on record for this species/cycle — harvest may not be possible'
                                      : overWeight || overHeads
                                        ? 'Requested quantity exceeds available biomass'
                                        : 'Available live biomass for this species/cycle'
                                  }
                                >
                                  {noStock
                                    ? 'No stock available'
                                    : `Avail: ${formatNumber(avail.weightKg)} kg • ${formatNumber(avail.count)} pcs`}
                                </p>
                              ) : null}
                            </div>
                          )}
                        </td>
                        <td className="px-2 py-2">
                          <input
                            type="number"
                            min="0"
                            step="0.0001"
                            className={`${inputCls} text-right tabular-nums`}
                            placeholder={emptySacks ? 'Sacks' : nonFish ? 'Qty' : 'kg'}
                            title={
                              emptySacks
                                ? 'Number of empty feed sacks sold (auto-created when feed is consumed at this pond)'
                                : undefined
                            }
                            value={line.weight_kg}
                            onChange={(e) => updateLine(line.localId, { weight_kg: e.target.value })}
                          />
                        </td>
                        <td className="px-2 py-2">
                          {nonFish ? (
                            <span className="block py-2.5 text-center text-xs text-muted-foreground/70">—</span>
                          ) : (
                            <div className="space-y-1">
                              <input
                                type="number"
                                min="0"
                                step="0.0001"
                                className={`${inputCls} text-right tabular-nums`}
                                placeholder="pcs/kg"
                                value={line.fish_per_kg}
                                onChange={(e) => updateLine(line.localId, { fish_per_kg: e.target.value })}
                              />
                              {sampleRef?.fish_per_kg && line.fish_per_kg.trim() !== '' ? (
                                <p className="text-[11px] leading-tight text-emerald-700">
                                  From sample
                                  {sampleRef.sample_date ? ` · ${sampleRef.sample_date.slice(0, 10)}` : ''}
                                </p>
                              ) : pondStockRow?.current_fish_per_kg &&
                                line.fish_per_kg.trim() !== '' &&
                                !sampleRef?.fish_per_kg ? (
                                <p className="text-[11px] leading-tight text-muted-foreground">
                                  From pond stock estimate
                                </p>
                              ) : null}
                            </div>
                          )}
                        </td>
                        <td className="px-2 py-2">
                          {nonFish ? (
                            <span className="block py-2.5 text-center text-xs text-muted-foreground/70">—</span>
                          ) : (
                            <input
                              type="text"
                              readOnly
                              tabIndex={-1}
                              className={`${inputCls} cursor-default bg-muted/40 text-right tabular-nums`}
                              value={line.fish_count || '—'}
                            />
                          )}
                        </td>
                        <td className="px-2 py-2">
                          <input
                            type="number"
                            min="0"
                            step="0.0001"
                            className={`${inputCls} text-right tabular-nums`}
                            placeholder="Rate"
                            value={line.sale_price_per_kg}
                            onChange={(e) => updateLine(line.localId, { sale_price_per_kg: e.target.value })}
                          />
                        </td>
                        <td className="px-2 py-2">
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            readOnly={line.sale_price_per_kg.trim() !== ''}
                            className={`${inputCls} text-right tabular-nums ${
                              line.sale_price_per_kg.trim() !== '' ? 'bg-muted/40' : ''
                            }`}
                            value={line.total_amount}
                            onChange={(e) => updateLine(line.localId, { total_amount: e.target.value })}
                          />
                        </td>
                        {!isEdit ? (
                          <td className="px-2 py-2">
                            <div className="flex gap-1">
                              <button
                                type="button"
                                title="Duplicate line (clears quantities)"
                                onClick={() => duplicateLine(line)}
                                className="rounded-md p-2 text-muted-foreground hover:bg-muted"
                              >
                                <Copy className="h-4 w-4" />
                              </button>
                              <button
                                type="button"
                                title="Remove line"
                                disabled={lines.length <= 1}
                                onClick={() => removeLine(line.localId)}
                                className="rounded-md p-2 text-destructive hover:bg-destructive/5 disabled:opacity-30"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </div>
                          </td>
                        ) : null}
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot className="border-t-2 border-border bg-accent/50">
                  <tr>
                    <td
                      colSpan={isEdit ? 8 : 9}
                      className="px-3 py-3 text-right text-sm font-semibold text-foreground/85"
                    >
                      Ticket total ({lines.length} line{lines.length === 1 ? '' : 's'})
                    </td>
                    <td className="px-3 py-3 text-right text-lg font-bold tabular-nums text-primary">
                      {sym}
                      {formatNumber(grandTotal)}
                    </td>
                    {!isEdit ? <td /> : null}
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-border bg-muted/40 px-5 py-4 sm:px-6">
          <button
            type="button"
            disabled={submitting}
            onClick={onClose}
            className="rounded-lg px-4 py-2.5 text-sm font-medium text-muted-foreground hover:bg-muted/80 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={submitting}
            onClick={() => void save()}
            className="inline-flex min-w-[8rem] items-center justify-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-primary disabled:opacity-60"
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
            {isEdit ? 'Update line' : lines.length > 1 ? `Save ${lines.length} lines` : 'Save sale'}
          </button>
        </div>
      </div>
    </div>
    </>
  )
}
