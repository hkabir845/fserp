'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
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
  isNonFishSaleIncome,
  newLineLocalId,
  saleRowToLineDraft,
} from './aquacultureSaleShared'

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
  const wk = Number(line.weight_kg)
  if (!Number.isFinite(wk) || wk <= 0) {
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
  const [submitting, setSubmitting] = useState(false)
  const [header, setHeader] = useState<SaleHeaderDraft>({
    pond_id: '',
    sale_date: '',
    buyer_name: '',
    memo: '',
  })
  const [lines, setLines] = useState<SaleLineDraft[]>([emptyFishHarvestLine()])

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
  }, [open, resetForm])

  useEffect(() => {
    if (!open || !header.pond_id) {
      setCycles([])
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
  }, [open, header.pond_id])

  const updateLine = (localId: string, patch: Partial<SaleLineDraft>) => {
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
    setLines((prev) => [
      ...prev,
      {
        ...line,
        localId: newLineLocalId(),
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
    'w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/25'
  const labelCls = 'block text-xs font-semibold uppercase tracking-wide text-slate-500'
  const thCls =
    'px-2 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500'

  return (
    <>
      <datalist id="aq-sale-customer-suggestions">
        {customers.map((c) => (
          <option key={c.id} value={customerPickLabel(c)} />
        ))}
      </datalist>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-3 sm:p-6"
        role="dialog"
        aria-modal="true"
        aria-labelledby="aq-sale-form-title"
      >
      <div className="flex max-h-[94vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-slate-200">
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-200 bg-gradient-to-r from-teal-50 to-white px-5 py-4 sm:px-6">
          <div>
            <h2 id="aq-sale-form-title" className="text-xl font-bold tracking-tight text-slate-900">
              {isEdit ? 'Edit sale line' : 'Record pond sale'}
            </h2>
            <p className="mt-1 max-w-2xl text-sm text-slate-600">
              {isEdit
                ? 'Update this registered line. Posted lines must be changed via Invoices.'
                : 'One buyer visit can include several lines — e.g. same species from two production cycles at different sizes and prices.'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">
          <section className="rounded-xl border border-slate-200 bg-slate-50/60 p-4 sm:p-5">
            <h3 className="text-sm font-semibold text-slate-900">Sale header</h3>
            <p className="mt-0.5 text-xs text-slate-500">Shared for every line on this ticket.</p>
            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <label className="block sm:col-span-1">
                <span className={labelCls}>
                  Pond <span className="text-red-600">*</span>
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
                  Sale date <span className="text-red-600">*</span>
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

          <section className="mt-5">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">Sale lines</h3>
                <p className="mt-0.5 text-xs text-slate-500">
                  Tag each line to a <strong>production cycle</strong> when size and price differ. Duplicate species on
                  separate lines is normal.
                </p>
              </div>
              {!isEdit ? (
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setLines((prev) => [...prev, emptyFishHarvestLine()])}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-teal-300 bg-teal-50 px-3 py-2 text-sm font-medium text-teal-900 hover:bg-teal-100"
                  >
                    <Plus className="h-4 w-4" />
                    Fish harvest line
                  </button>
                  <button
                    type="button"
                    onClick={() => setLines((prev) => [...prev, emptyNonFishLine()])}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                  >
                    <Plus className="h-4 w-4" />
                    Other pond income
                  </button>
                </div>
              ) : null}
            </div>

            <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
              <table className="min-w-[880px] w-full border-collapse text-sm">
                <thead className="border-b border-slate-200 bg-slate-50">
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
                    return (
                      <tr key={line.localId} className="border-b border-slate-100 align-top hover:bg-slate-50/80">
                        <td className="px-2 py-2 text-center text-xs font-medium text-slate-400">{idx + 1}</td>
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
                            {incomeTypes.map((t) => (
                              <option key={t.id} value={t.id}>
                                {t.label}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-2 py-2">
                          {nonFish ? (
                            <span className="block py-2.5 text-xs text-slate-400">N/A</span>
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
                            </div>
                          )}
                        </td>
                        <td className="px-2 py-2">
                          <input
                            type="number"
                            min="0"
                            step="0.0001"
                            className={`${inputCls} text-right tabular-nums`}
                            placeholder={nonFish ? 'Qty' : 'kg'}
                            value={line.weight_kg}
                            onChange={(e) => updateLine(line.localId, { weight_kg: e.target.value })}
                          />
                        </td>
                        <td className="px-2 py-2">
                          {nonFish ? (
                            <span className="block py-2.5 text-center text-xs text-slate-400">—</span>
                          ) : (
                            <input
                              type="number"
                              min="0"
                              step="0.0001"
                              className={`${inputCls} text-right tabular-nums`}
                              placeholder="pcs/kg"
                              value={line.fish_per_kg}
                              onChange={(e) => updateLine(line.localId, { fish_per_kg: e.target.value })}
                            />
                          )}
                        </td>
                        <td className="px-2 py-2">
                          {nonFish ? (
                            <span className="block py-2.5 text-center text-xs text-slate-400">—</span>
                          ) : (
                            <input
                              type="text"
                              readOnly
                              tabIndex={-1}
                              className={`${inputCls} cursor-default bg-slate-50 text-right tabular-nums`}
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
                              line.sale_price_per_kg.trim() !== '' ? 'bg-slate-50' : ''
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
                                className="rounded-md p-2 text-slate-500 hover:bg-slate-100"
                              >
                                <Copy className="h-4 w-4" />
                              </button>
                              <button
                                type="button"
                                title="Remove line"
                                disabled={lines.length <= 1}
                                onClick={() => removeLine(line.localId)}
                                className="rounded-md p-2 text-red-600 hover:bg-red-50 disabled:opacity-30"
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
                <tfoot className="border-t-2 border-slate-200 bg-teal-50/50">
                  <tr>
                    <td
                      colSpan={isEdit ? 8 : 9}
                      className="px-3 py-3 text-right text-sm font-semibold text-slate-700"
                    >
                      Ticket total ({lines.length} line{lines.length === 1 ? '' : 's'})
                    </td>
                    <td className="px-3 py-3 text-right text-lg font-bold tabular-nums text-teal-900">
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

        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-4 sm:px-6">
          <button
            type="button"
            disabled={submitting}
            onClick={onClose}
            className="rounded-lg px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-200/80 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={submitting}
            onClick={() => void save()}
            className="inline-flex min-w-[8rem] items-center justify-center gap-2 rounded-lg bg-teal-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-teal-700 disabled:opacity-60"
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
