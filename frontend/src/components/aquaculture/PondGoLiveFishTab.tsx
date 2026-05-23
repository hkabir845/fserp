'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Edit2, Plus, Trash2 } from 'lucide-react'
import { useToast } from '@/components/Toast'
import api from '@/lib/api'
import { extractErrorMessage } from '@/utils/errorHandler'
import { formatDateOnly } from '@/utils/date'
import { formatNumber, getCurrencySymbol } from '@/utils/currency'
import type { PondOpeningSummary } from './pondOpeningShared'

type FishSpeciesOpt = { id: string; label: string }

type LedgerRow = {
  id: number
  entry_date: string
  entry_kind: string
  fish_species: string
  fish_species_other: string
  fish_species_label: string
  fish_count_delta: number
  weight_kg_delta: string
  book_value: string
  post_to_books: boolean
  journal_entry_id: number | null
  journal_is_posted: boolean
  memo: string
}

type FishDraft = {
  lineId: string
  species: string
  speciesOther: string
  fishCount: string
  weightKg: string
  bookValue: string
  postToBooks: boolean
  bookValueTouched: boolean
}

type Props = {
  ponds: PondOpeningSummary[]
  cutoverDate: string
  currency: string
  onSaved: () => void
}

const DEFAULT_SPECIES_FALLBACK: FishSpeciesOpt[] = [{ id: 'tilapia', label: 'Tilapia' }]
const GO_LIVE_MEMO = 'Go-live opening biomass'

let lineSeq = 0
function newLineId(): string {
  lineSeq += 1
  return `fish-line-${lineSeq}-${Date.now()}`
}

function emptyLine(defaultSpecies: string): FishDraft {
  return {
    lineId: newLineId(),
    species: defaultSpecies,
    speciesOther: '',
    fishCount: '',
    weightKg: '',
    bookValue: '',
    postToBooks: false,
    bookValueTouched: false,
  }
}

function parseMoney(s: string): number {
  const n = Number(String(s ?? '').replace(/,/g, ''))
  return Number.isFinite(n) ? n : 0
}

function lineIsEmpty(line: FishDraft): boolean {
  return !line.fishCount.trim() && !line.weightKg.trim() && !line.bookValue.trim()
}

function suggestBookValue(
  weightKg: string,
  costPerKg: string | null | undefined,
  salePricePerKg: number | null,
): string {
  const wk = parseMoney(weightKg)
  if (wk <= 0) return ''
  if (salePricePerKg != null && salePricePerKg > 0) {
    return (Math.round(wk * salePricePerKg * 100) / 100).toFixed(2)
  }
  const cpk = costPerKg ? parseMoney(costPerKg) : 0
  if (cpk > 0) return (Math.round(wk * cpk * 100) / 100).toFixed(2)
  return ''
}

function buildPayload(
  line: FishDraft,
  defaultSpecies: string,
): { ok: true; payload: Record<string, unknown> } | { ok: false; detail: string } {
  const fc = parseInt(line.fishCount.replace(/,/g, ''), 10)
  const wk = parseMoney(line.weightKg)
  if (!Number.isFinite(fc) || fc <= 0 || wk <= 0) {
    return { ok: false, detail: 'Each line needs a positive fish count and weight (kg).' }
  }
  if (line.species === 'other' && !line.speciesOther.trim()) {
    return { ok: false, detail: 'Enter a name for each “Other” species line.' }
  }
  const payload: Record<string, unknown> = {
    entry_kind: 'adjustment',
    fish_species: line.species || defaultSpecies,
    fish_count_delta: fc,
    weight_kg_delta: String(wk),
    memo: GO_LIVE_MEMO,
  }
  if (line.species === 'other' && line.speciesOther.trim()) {
    payload.fish_species_other = line.speciesOther.trim()
  }
  const bv = parseMoney(line.bookValue)
  if (line.postToBooks) {
    if (bv <= 0) {
      return {
        ok: false,
        detail: 'Post to books requires a book value greater than zero on each selected line.',
      }
    }
    payload.book_value = bv.toFixed(2)
    payload.post_to_books = true
    payload.opening_equity_credit = true
  } else {
    payload.book_value = bv > 0 ? bv.toFixed(2) : '0'
    payload.post_to_books = false
  }
  return { ok: true, payload }
}

function ledgerFromRow(r: LedgerRow, defaultSpecies: string): FishDraft {
  return {
    lineId: newLineId(),
    species: r.fish_species || defaultSpecies,
    speciesOther: r.fish_species_other || '',
    fishCount: String(Math.abs(r.fish_count_delta)),
    weightKg: String(Math.abs(parseMoney(r.weight_kg_delta))),
    bookValue: r.book_value && parseMoney(r.book_value) > 0 ? r.book_value : '',
    postToBooks: r.post_to_books,
    bookValueTouched: true,
  }
}

export function PondGoLiveFishTab({ ponds, cutoverDate, currency, onSaved }: Props) {
  const toast = useToast()
  const sym = useMemo(() => getCurrencySymbol(currency), [currency])
  const [fishSpeciesOpts, setFishSpeciesOpts] = useState<FishSpeciesOpt[]>([])
  const [speciesLoading, setSpeciesLoading] = useState(true)
  const [pondLines, setPondLines] = useState<Record<number, FishDraft[]>>({})
  const [ledgerByPond, setLedgerByPond] = useState<Record<number, LedgerRow[]>>({})
  const [ledgerLoading, setLedgerLoading] = useState(false)
  const [saving, setSaving] = useState<number | null>(null)
  const [editingLedger, setEditingLedger] = useState<{ pondId: number; row: LedgerRow } | null>(null)
  const [deletingId, setDeletingId] = useState<number | null>(null)

  const loadSpecies = useCallback(async () => {
    setSpeciesLoading(true)
    try {
      const { data } = await api.get<FishSpeciesOpt[]>('/aquaculture/fish-species/')
      setFishSpeciesOpts(Array.isArray(data) ? data : [])
    } catch {
      setFishSpeciesOpts([])
    } finally {
      setSpeciesLoading(false)
    }
  }, [])

  const loadLedgerForPonds = useCallback(async (pondList: PondOpeningSummary[]) => {
    if (!pondList.length) {
      setLedgerByPond({})
      return
    }
    setLedgerLoading(true)
    try {
      const entries = await Promise.all(
        pondList.map(async (p) => {
          try {
            const { data } = await api.get<LedgerRow[]>('/aquaculture/fish-stock-ledger/', {
              params: { pond_id: p.pond_id, limit: 200 },
            })
            const rows = Array.isArray(data) ? data : []
            return [
              p.pond_id,
              rows.filter(
                (r) =>
                  r.entry_kind === 'adjustment' &&
                  (r.memo?.includes('Go-live') ||
                    r.entry_date?.slice(0, 10) === cutoverDate ||
                    (r.fish_count_delta > 0 && parseMoney(r.weight_kg_delta) > 0)),
              ),
            ] as const
          } catch {
            return [p.pond_id, []] as const
          }
        }),
      )
      setLedgerByPond(Object.fromEntries(entries))
    } finally {
      setLedgerLoading(false)
    }
  }, [cutoverDate])

  useEffect(() => {
    void loadSpecies()
  }, [loadSpecies])

  useEffect(() => {
    void loadLedgerForPonds(ponds)
  }, [ponds, loadLedgerForPonds])

  const speciesOptions = useMemo(
    () =>
      (fishSpeciesOpts.length ? fishSpeciesOpts : DEFAULT_SPECIES_FALLBACK).filter(
        (s) => s.id !== 'not_applicable',
      ),
    [fishSpeciesOpts],
  )

  const defaultSpecies = useMemo(() => {
    if (speciesOptions.some((s) => s.id === 'tilapia')) return 'tilapia'
    return speciesOptions[0]?.id ?? 'tilapia'
  }, [speciesOptions])

  useEffect(() => {
    setPondLines((prev) => {
      const next = { ...prev }
      for (const p of ponds) {
        if (!next[p.pond_id]?.length) {
          next[p.pond_id] = [emptyLine(defaultSpecies)]
        }
      }
      return next
    })
  }, [ponds, defaultSpecies])

  const pondLinesOrDefault = (prev: Record<number, FishDraft[]>, pondId: number): FishDraft[] =>
    prev[pondId]?.length ? prev[pondId] : [emptyLine(defaultSpecies)]

  const linesForPond = (pondId: number): FishDraft[] =>
    pondLines[pondId]?.length ? pondLines[pondId] : [emptyLine(defaultSpecies)]

  const updateLine = (pondId: number, lineId: string, patch: Partial<Omit<FishDraft, 'lineId'>>) => {
    setPondLines((prev) => ({
      ...prev,
      [pondId]: pondLinesOrDefault(prev, pondId).map((ln) =>
        ln.lineId === lineId ? { ...ln, ...patch } : ln,
      ),
    }))
  }

  const addLine = (pondId: number) => {
    setPondLines((prev) => ({
      ...prev,
      [pondId]: [...pondLinesOrDefault(prev, pondId), emptyLine(defaultSpecies)],
    }))
  }

  const removeLine = (pondId: number, lineId: string) => {
    setPondLines((prev) => {
      const cur = pondLinesOrDefault(prev, pondId)
      if (cur.length <= 1) return prev
      return { ...prev, [pondId]: cur.filter((ln) => ln.lineId !== lineId) }
    })
  }

  const refreshAll = useCallback(async () => {
    await loadLedgerForPonds(ponds)
    onSaved()
  }, [loadLedgerForPonds, onSaved, ponds])

  const deleteLedgerRow = async (row: LedgerRow) => {
    if (row.journal_entry_id && row.journal_is_posted) {
      toast.error('This row is posted to the books — void the journal on Stock or GL first.')
      return
    }
    if (!window.confirm(`Remove ${row.fish_species_label} opening (${row.fish_count_delta} fish, ${row.weight_kg_delta} kg)?`)) {
      return
    }
    setDeletingId(row.id)
    try {
      await api.delete(`/aquaculture/fish-stock-ledger/${row.id}/`)
      toast.success('Opening entry removed')
      if (editingLedger?.row.id === row.id) setEditingLedger(null)
      await refreshAll()
    } catch (e) {
      toast.error(extractErrorMessage(e, 'Could not remove entry'))
    } finally {
      setDeletingId(null)
    }
  }

  const startEdit = (pondId: number, row: LedgerRow) => {
    setEditingLedger({ pondId, row })
    setPondLines((prev) => ({ ...prev, [pondId]: [ledgerFromRow(row, defaultSpecies)] }))
  }

  const cancelEdit = (pondId: number) => {
    setEditingLedger(null)
    setPondLines((prev) => ({ ...prev, [pondId]: [emptyLine(defaultSpecies)] }))
  }

  const saveOpenings = async (pondId: number) => {
    const lines = linesForPond(pondId).filter((ln) => !lineIsEmpty(ln))
    if (!lines.length) {
      toast.error('Add at least one species line with fish count and weight')
      return
    }

    const payloads: Record<string, unknown>[] = []
    for (const ln of lines) {
      const parsed = buildPayload(ln, defaultSpecies)
      if (!parsed.ok) {
        toast.error(parsed.detail)
        return
      }
      payloads.push({
        pond_id: pondId,
        entry_date: cutoverDate,
        ...parsed.payload,
      })
    }

    setSaving(pondId)
    const editing = editingLedger?.pondId === pondId ? editingLedger.row : null
    try {
      if (editing) {
        if (editing.journal_entry_id) {
          if (payloads.length !== 1) {
            toast.error('Posted entries: edit one row at a time (memo only).')
            return
          }
          const memo = String(payloads[0].memo || GO_LIVE_MEMO)
          await api.put(`/aquaculture/fish-stock-ledger/${editing.id}/`, { memo })
          toast.success('Memo updated (amounts locked after GL posting)')
        } else {
          await api.put(`/aquaculture/fish-stock-ledger/${editing.id}/`, {
            ...payloads[0],
            entry_date: cutoverDate,
          })
          toast.success('Opening entry updated')
        }
      } else {
        let saved = 0
        for (const payload of payloads) {
          await api.post('/aquaculture/fish-stock-ledger/', payload)
          saved += 1
        }
        toast.success(saved === 1 ? 'Fish opening recorded' : `${saved} species openings recorded`)
      }
      setEditingLedger(null)
      setPondLines((prev) => ({ ...prev, [pondId]: [emptyLine(defaultSpecies)] }))
      await refreshAll()
    } catch (e) {
      toast.error(extractErrorMessage(e, editing ? 'Could not update entry' : 'Could not save fish openings'))
    } finally {
      setSaving(null)
    }
  }

  const applySuggestedBookValue = async (pondId: number, line: FishDraft, costPerKg: string | null) => {
    if (line.bookValueTouched) return
    let salePpk: number | null = null
    try {
      const params: Record<string, string> = {
        pond_id: String(pondId),
        fish_species: line.species,
      }
      if (line.species === 'other' && line.speciesOther.trim()) {
        params.fish_species_other = line.speciesOther.trim()
      }
      const { data } = await api.get<{ found?: boolean; price_per_kg?: string }>(
        '/aquaculture/fish-sales/last-reference/',
        { params },
      )
      if (data?.found && data.price_per_kg) {
        salePpk = parseMoney(data.price_per_kg)
      }
    } catch {
      /* optional hint */
    }
    const suggested = suggestBookValue(line.weightKg, costPerKg, salePpk)
    if (suggested && !line.bookValueTouched) {
      updateLine(pondId, line.lineId, { bookValue: suggested })
    }
  }

  return (
    <>
      <div className="mb-4 rounded-lg border border-violet-200 bg-violet-50/80 px-3 py-2.5 text-xs leading-relaxed text-violet-950">
        <p className="font-semibold">Biological stock vs accounting</p>
        <ul className="mt-1.5 list-disc space-y-1 pl-4">
          <li>
            <strong>Fish count and kg</strong> always update biological stock (what is in the pond at cutover).
          </li>
          <li>
            <strong>Book value</strong> is the asset amount for GL (biological inventory account 1581). Suggested from{' '}
            last sale price/kg or prior cost/kg from the Expense tab bioasset estimate.
          </li>
          <li>
            <strong>Post to books</strong> (optional) creates a journal: Dr biological inventory / Cr opening equity. Leave
            unchecked if you only want production tracking without a GL opening.
          </li>
          <li>
            Market price is not required for biology-only entries; use it when you want the opening on the balance sheet.
          </li>
        </ul>
      </div>

      <p className="mb-3 text-sm text-slate-700">
        Record <strong>fish on hand at cutover</strong> by species. Edit or remove rows below, or add lines for
        polyculture. Full ledger tools:{' '}
        <Link href="/aquaculture/stock" className="font-medium text-teal-800 underline">
          Aquaculture → Stock
        </Link>
        .
      </p>

      <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50/90 px-3 py-2.5">
        <p className="text-xs font-semibold text-slate-800">Species available in this system</p>
        {speciesLoading ? (
          <p className="mt-2 text-xs text-slate-500">Loading species…</p>
        ) : (
          <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Fish species catalog">
            {speciesOptions.map((s) => (
              <li
                key={s.id}
                className="rounded-full bg-white px-2.5 py-0.5 text-xs font-medium text-slate-700 ring-1 ring-slate-200"
              >
                {s.label}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="space-y-4">
        {ponds.map((p) => {
          const bio = p.go_live?.biology
          const bioasset = p.go_live?.bioasset
          const costPerKg = bioasset?.cost_per_kg ?? null
          const lines = linesForPond(p.pond_id)
          const ledgerRows = ledgerByPond[p.pond_id] ?? []
          const isEditing = editingLedger?.pondId === p.pond_id
          const glLocked = isEditing && Boolean(editingLedger?.row.journal_entry_id)

          return (
            <section key={p.pond_id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <h3 className="font-semibold text-slate-900">{p.pond_name}</h3>

              {bio?.has_biomass ? (
                <p className="mt-1 text-xs text-slate-600">
                  On hand: {bio.total_fish_count.toLocaleString()} fish · {bio.total_weight_kg} kg
                  {bioasset && parseMoney(bioasset.estimated_value) > 0 ? (
                    <>
                      {' '}
                      · Bioasset est. {sym}
                      {formatNumber(parseMoney(bioasset.estimated_value), 2)}
                      {costPerKg ? ` (${sym}${costPerKg}/kg from prior expense)` : ''}
                    </>
                  ) : null}
                </p>
              ) : (
                <p className="mt-1 text-xs text-amber-800">No biomass recorded yet.</p>
              )}

              <div className="mt-4">
                <p className="text-xs font-semibold text-slate-700">Recorded opening / adjustment rows</p>
                {ledgerLoading ? (
                  <p className="mt-2 text-xs text-slate-500">Loading ledger…</p>
                ) : ledgerRows.length === 0 ? (
                  <p className="mt-2 text-xs text-slate-500">No go-live or positive adjustment rows yet.</p>
                ) : (
                  <div className="mt-2 overflow-x-auto rounded-lg border border-slate-200">
                    <table className="w-full min-w-[640px] text-left text-xs">
                      <thead className="border-b border-slate-200 bg-slate-50 text-[10px] font-semibold uppercase text-slate-500">
                        <tr>
                          <th className="px-2 py-2">Date</th>
                          <th className="px-2 py-2">Species</th>
                          <th className="px-2 py-2 text-right">Fish</th>
                          <th className="px-2 py-2 text-right">Kg</th>
                          <th className="px-2 py-2 text-right">Book ({sym})</th>
                          <th className="px-2 py-2">GL</th>
                          <th className="px-2 py-2 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {ledgerRows.map((r) => (
                          <tr key={r.id} className={isEditing && editingLedger?.row.id === r.id ? 'bg-teal-50/60' : ''}>
                            <td className="px-2 py-2 tabular-nums text-slate-600">
                              {formatDateOnly(r.entry_date)}
                            </td>
                            <td className="px-2 py-2 font-medium text-slate-800">{r.fish_species_label}</td>
                            <td className="px-2 py-2 text-right tabular-nums">{r.fish_count_delta.toLocaleString()}</td>
                            <td className="px-2 py-2 text-right tabular-nums">{r.weight_kg_delta}</td>
                            <td className="px-2 py-2 text-right tabular-nums">
                              {parseMoney(r.book_value) > 0 ? formatNumber(parseMoney(r.book_value), 2) : '—'}
                            </td>
                            <td className="px-2 py-2">
                              {r.post_to_books ? (
                                <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-900">
                                  Posted
                                </span>
                              ) : (
                                <span className="text-slate-400">Biology only</span>
                              )}
                            </td>
                            <td className="px-2 py-2 text-right">
                              <div className="inline-flex gap-1">
                                <button
                                  type="button"
                                  title={r.journal_entry_id ? 'Edit memo only' : 'Edit entry'}
                                  onClick={() => startEdit(p.pond_id, r)}
                                  className="rounded border border-slate-200 p-1 text-slate-600 hover:bg-slate-50"
                                >
                                  <Edit2 className="h-3.5 w-3.5" aria-hidden />
                                </button>
                                <button
                                  type="button"
                                  title="Remove entry"
                                  disabled={deletingId === r.id}
                                  onClick={() => void deleteLedgerRow(r)}
                                  className="rounded border border-rose-200 p-1 text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                                >
                                  <Trash2 className="h-3.5 w-3.5" aria-hidden />
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div className="mt-4 rounded-lg border border-dashed border-slate-200 bg-slate-50/80 p-3" data-go-live-fish-opening>
                <p className="text-xs font-semibold text-slate-700">
                  {isEditing ? `Edit entry #${editingLedger?.row.id}` : 'Add opening stock'} (as of {cutoverDate})
                </p>
                {glLocked ? (
                  <p className="mt-1 text-[11px] text-amber-900">
                    This row is posted to the books — only memo can change here. To reverse amounts, delete from Stock
                    (rolls back auto journal) or adjust on GL.
                  </p>
                ) : null}

                <div className="mt-3 space-y-2">
                  {lines.map((ln) => (
                    <div
                      key={ln.lineId}
                      className="grid gap-2 rounded-lg border border-slate-200/80 bg-white p-2.5 sm:grid-cols-12 sm:items-end"
                    >
                      <label className="block text-xs sm:col-span-2">
                        <span className="font-medium text-slate-600">Species</span>
                        <select
                          className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm disabled:bg-slate-100"
                          value={ln.species}
                          disabled={speciesLoading || glLocked}
                          onChange={(e) =>
                            updateLine(p.pond_id, ln.lineId, {
                              species: e.target.value,
                              speciesOther: e.target.value === 'other' ? ln.speciesOther : '',
                            })
                          }
                        >
                          {speciesOptions.map((o) => (
                            <option key={o.id} value={o.id}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      {ln.species === 'other' ? (
                        <label className="block text-xs sm:col-span-2">
                          <span className="font-medium text-slate-600">Other name</span>
                          <input
                            type="text"
                            disabled={glLocked}
                            className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm disabled:bg-slate-100"
                            value={ln.speciesOther}
                            onChange={(e) => updateLine(p.pond_id, ln.lineId, { speciesOther: e.target.value })}
                          />
                        </label>
                      ) : (
                        <div className="hidden sm:col-span-2 sm:block" aria-hidden />
                      )}
                      <label className="block text-xs sm:col-span-2">
                        <span className="font-medium text-slate-600">Fish count</span>
                        <input
                          type="text"
                          inputMode="numeric"
                          disabled={glLocked}
                          className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm tabular-nums disabled:bg-slate-100"
                          value={ln.fishCount}
                          onChange={(e) => updateLine(p.pond_id, ln.lineId, { fishCount: e.target.value })}
                          onBlur={() => void applySuggestedBookValue(p.pond_id, ln, costPerKg)}
                        />
                      </label>
                      <label className="block text-xs sm:col-span-2">
                        <span className="font-medium text-slate-600">Total kg</span>
                        <input
                          type="text"
                          inputMode="decimal"
                          disabled={glLocked}
                          className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm tabular-nums disabled:bg-slate-100"
                          value={ln.weightKg}
                          onChange={(e) => updateLine(p.pond_id, ln.lineId, { weightKg: e.target.value })}
                          onBlur={() => void applySuggestedBookValue(p.pond_id, ln, costPerKg)}
                        />
                      </label>
                      <label className="block text-xs sm:col-span-2">
                        <span className="font-medium text-slate-600">Book value ({sym})</span>
                        <input
                          type="text"
                          inputMode="decimal"
                          disabled={glLocked}
                          placeholder={costPerKg ? `~${costPerKg}/kg` : '0'}
                          className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm tabular-nums disabled:bg-slate-100"
                          value={ln.bookValue}
                          onChange={(e) =>
                            updateLine(p.pond_id, ln.lineId, {
                              bookValue: e.target.value,
                              bookValueTouched: true,
                            })
                          }
                        />
                      </label>
                      <label className="flex items-end sm:col-span-1">
                        <span className="flex cursor-pointer items-center gap-1.5 rounded-md border border-slate-200 px-2 py-1.5 text-[11px]">
                          <input
                            type="checkbox"
                            disabled={glLocked}
                            checked={ln.postToBooks}
                            onChange={(e) => updateLine(p.pond_id, ln.lineId, { postToBooks: e.target.checked })}
                          />
                          Post GL
                        </span>
                      </label>
                      {!isEditing && lines.length > 1 ? (
                        <div className="flex items-end justify-end sm:col-span-1">
                          <button
                            type="button"
                            onClick={() => removeLine(p.pond_id, ln.lineId)}
                            className="rounded-md border border-slate-200 p-2 text-slate-500 hover:bg-slate-50"
                            aria-label="Remove line"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      ) : (
                        <div className="hidden sm:col-span-1 sm:block" aria-hidden />
                      )}
                    </div>
                  ))}
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {!isEditing ? (
                    <button
                      type="button"
                      disabled={speciesLoading}
                      onClick={() => addLine(p.pond_id)}
                      className="inline-flex items-center gap-1 rounded-lg border border-teal-200 bg-teal-50 px-3 py-1.5 text-sm font-medium text-teal-900 hover:bg-teal-100"
                    >
                      <Plus className="h-4 w-4" aria-hidden />
                      Add line
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => cancelEdit(p.pond_id)}
                      className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
                    >
                      Cancel edit
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={saving === p.pond_id || speciesLoading}
                    onClick={() => void saveOpenings(p.pond_id)}
                    className="inline-flex items-center gap-1 rounded-lg bg-teal-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-50"
                  >
                    {saving === p.pond_id ? 'Saving…' : isEditing ? 'Save changes' : 'Save openings'}
                  </button>
                </div>
              </div>
            </section>
          )
        })}
      </div>
    </>
  )
}
