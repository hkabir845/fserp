'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { ArrowLeft, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { useToast } from '@/components/Toast'
import api from '@/lib/api'
import { extractErrorMessage } from '@/utils/errorHandler'
import { getCurrencySymbol, formatNumber } from '@/utils/currency'
import { formatDateOnly } from '@/utils/date'

interface Pond {
  id: number
  name: string
}
interface RefOpt {
  id: string
  label: string
}
interface ReferencePayload {
  entry_kind: RefOpt[]
  loss_reason: RefOpt[]
  coa_note?: string
}
interface CycleRow {
  id: number
  name: string
}
interface PositionRow {
  pond_id: number
  pond_name: string
  transfer_in_weight_kg: string
  transfer_out_weight_kg: string
  sale_weight_kg: string
  sale_fish_count: number
  ledger_weight_kg_delta: string
  ledger_fish_count_delta: number
  implied_net_weight_kg: string
  implied_net_fish_count: number
  latest_sample_date: string | null
  latest_sample_estimated_fish_count: number | null
  latest_sample_estimated_total_weight_kg: string | null
  latest_sample_fish_species_label?: string | null
}
interface LedgerRow {
  id: number
  pond_id: number
  pond_name: string
  production_cycle_id?: number | null
  production_cycle_name?: string
  entry_date: string
  entry_kind: string
  entry_kind_label: string
  loss_reason: string
  loss_reason_label?: string | null
  fish_species_label?: string
  fish_count_delta: number
  weight_kg_delta: string
  book_value: string
  post_to_books: boolean
  memo: string
  journal_entry_number?: string
}

export default function AquacultureStockPage() {
  const toast = useToast()
  const [ponds, setPonds] = useState<Pond[]>([])
  const [cycles, setCycles] = useState<CycleRow[]>([])
  const [posCycles, setPosCycles] = useState<CycleRow[]>([])
  const [ref, setRef] = useState<ReferencePayload | null>(null)
  const [fishSpecies, setFishSpecies] = useState<RefOpt[]>([])
  const [position, setPosition] = useState<PositionRow[]>([])
  const [rows, setRows] = useState<LedgerRow[]>([])
  const [loading, setLoading] = useState(true)
  const [positionLoading, setPositionLoading] = useState(false)
  const [currency, setCurrency] = useState('BDT')
  const [filterPond, setFilterPond] = useState('')
  const [posPond, setPosPond] = useState('')
  const [posCycle, setPosCycle] = useState('')
  const [modal, setModal] = useState(false)
  const [form, setForm] = useState({
    pond_id: '',
    production_cycle_id: '',
    entry_kind: 'loss',
    loss_reason: 'mortality',
    fish_species: 'tilapia',
    fish_species_other: '',
    entry_date: '',
    fish_removed: '',
    kg_removed: '',
    adj_fish_count: '',
    adj_weight_kg: '',
    book_value: '',
    post_to_books: false,
    memo: '',
  })

  const loadPonds = useCallback(async () => {
    try {
      const [co, pRes, rRes, spRes] = await Promise.all([
        api.get<Record<string, unknown>>('/companies/current/'),
        api.get<Pond[]>('/aquaculture/ponds/'),
        api.get<ReferencePayload>('/aquaculture/stock-ledger/reference/'),
        api.get<RefOpt[]>('/aquaculture/fish-species/').catch(() => ({ data: [] })),
      ])
      setCurrency(String(co.data?.currency || 'BDT').slice(0, 3))
      setPonds(Array.isArray(pRes.data) ? pRes.data : [])
      setRef(rRes.data && typeof rRes.data === 'object' ? rRes.data : null)
      setFishSpecies(Array.isArray(spRes.data) ? spRes.data : [])
    } catch (e) {
      toast.error(extractErrorMessage(e, 'Could not load reference data'))
    }
  }, [toast])

  const loadPosition = useCallback(async () => {
    setPositionLoading(true)
    try {
      const params: Record<string, string> = {}
      if (posPond) params.pond_id = posPond
      if (posCycle) params.production_cycle_id = posCycle
      const { data } = await api.get<{ rows: PositionRow[] }>('/aquaculture/fish-stock-position/', { params })
      setPosition(Array.isArray(data?.rows) ? data.rows : [])
    } catch (e) {
      toast.error(extractErrorMessage(e, 'Could not load stock position'))
    } finally {
      setPositionLoading(false)
    }
  }, [toast, posPond, posCycle])

  const loadRows = useCallback(async () => {
    setLoading(true)
    try {
      const params = filterPond ? { pond_id: filterPond } : undefined
      const { data } = await api.get<LedgerRow[]>('/aquaculture/fish-stock-ledger/', { params })
      setRows(Array.isArray(data) ? data : [])
    } catch (e) {
      toast.error(extractErrorMessage(e, 'Could not load ledger'))
    } finally {
      setLoading(false)
    }
  }, [toast, filterPond])

  useEffect(() => {
    void loadPonds()
  }, [loadPonds])

  useEffect(() => {
    void loadPosition()
  }, [loadPosition])

  useEffect(() => {
    void loadRows()
  }, [loadRows])

  useEffect(() => {
    if (!posPond) {
      setPosCycles([])
      setPosCycle('')
      return
    }
    void (async () => {
      try {
        const { data } = await api.get<CycleRow[]>('/aquaculture/production-cycles/', { params: { pond_id: posPond } })
        setPosCycles(Array.isArray(data) ? data : [])
      } catch {
        setPosCycles([])
      }
    })()
  }, [posPond])

  useEffect(() => {
    const pid = form.pond_id
    if (!modal || !pid) {
      setCycles([])
      return
    }
    void (async () => {
      try {
        const { data } = await api.get<CycleRow[]>('/aquaculture/production-cycles/', { params: { pond_id: pid } })
        setCycles(Array.isArray(data) ? data : [])
      } catch {
        setCycles([])
      }
    })()
  }, [modal, form.pond_id])

  const sym = getCurrencySymbol(currency)

  const openNew = () => {
    const today = new Date().toISOString().slice(0, 10)
    setForm({
      pond_id: ponds[0] ? String(ponds[0].id) : '',
      production_cycle_id: '',
      entry_kind: 'loss',
      loss_reason: 'mortality',
      fish_species: 'tilapia',
      fish_species_other: '',
      entry_date: today,
      fish_removed: '',
      kg_removed: '',
      adj_fish_count: '',
      adj_weight_kg: '',
      book_value: '',
      post_to_books: false,
      memo: '',
    })
    setModal(true)
  }

  const submit = async () => {
    try {
      const pond_id = parseInt(form.pond_id, 10)
      if (!Number.isFinite(pond_id)) {
        toast.error('Select a pond')
        return
      }
      let fish_count_delta = 0
      let weight_kg_delta = 0
      if (form.entry_kind === 'loss') {
        const hr = parseInt(form.fish_removed, 10)
        if (Number.isFinite(hr) && hr !== 0) fish_count_delta = -Math.abs(hr)
        const kg = Number(String(form.kg_removed).replace(/,/g, ''))
        if (Number.isFinite(kg) && kg !== 0) weight_kg_delta = -Math.abs(kg)
      } else {
        if (form.adj_fish_count.trim() !== '') {
          fish_count_delta = parseInt(form.adj_fish_count, 10)
          if (!Number.isFinite(fish_count_delta)) {
            toast.error('Fish count adjustment must be an integer')
            return
          }
        }
        if (form.adj_weight_kg.trim() !== '') {
          weight_kg_delta = Number(String(form.adj_weight_kg).replace(/,/g, ''))
          if (!Number.isFinite(weight_kg_delta)) {
            toast.error('Weight adjustment must be a number')
            return
          }
        }
      }
      const body: Record<string, unknown> = {
        pond_id,
        entry_date: form.entry_date,
        entry_kind: form.entry_kind,
        loss_reason: form.entry_kind === 'loss' ? form.loss_reason : '',
        fish_species: form.fish_species,
        fish_species_other: form.fish_species_other,
        fish_count_delta,
        weight_kg_delta,
        book_value: form.book_value.trim() === '' ? '0' : form.book_value,
        post_to_books: form.post_to_books,
        memo: form.memo,
      }
      if (form.production_cycle_id) body.production_cycle_id = parseInt(form.production_cycle_id, 10)
      await api.post('/aquaculture/fish-stock-ledger/', body)
      toast.success('Saved')
      setModal(false)
      void loadRows()
      void loadPosition()
    } catch (e) {
      toast.error(extractErrorMessage(e, 'Save failed'))
    }
  }

  const remove = async (id: number) => {
    if (!window.confirm('Delete this stock ledger row?')) return
    try {
      await api.delete(`/aquaculture/fish-stock-ledger/${id}/`)
      toast.success('Deleted')
      void loadRows()
      void loadPosition()
    } catch (e) {
      toast.error(extractErrorMessage(e, 'Delete failed'))
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link
            href="/aquaculture"
            className="mb-2 inline-flex items-center gap-1 text-sm font-medium text-teal-800 hover:text-teal-950"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
            Dashboard
          </Link>
          <h1 id="aq-stock-title" className="text-2xl font-bold tracking-tight text-slate-900">
            Fish stock &amp; mortality
          </h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-600">
            Biological adjustments in water—mortality, snakes, birds, theft, and manual count or weight corrections—not
            packaged inventory counts (those stay under Inventory / POS). Optional book value posts Dr expense / Cr
            biological asset (loss) or Dr asset / Cr income (positive adjustment).
          </p>
          {ref?.coa_note ? <p className="mt-2 text-xs text-slate-500">{ref.coa_note}</p> : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              void loadRows()
              void loadPosition()
            }}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50"
          >
            <RefreshCw className={`h-4 w-4 ${loading || positionLoading ? 'animate-spin' : ''}`} aria-hidden />
            Refresh
          </button>
          <button
            type="button"
            onClick={openNew}
            disabled={ponds.length === 0}
            title={ponds.length === 0 ? 'Add a pond first' : undefined}
            className="inline-flex items-center gap-2 rounded-lg bg-teal-700 px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus className="h-4 w-4" />
            Add entry
          </button>
        </div>
      </div>

      {ponds.length === 0 ? (
        <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-950">
          <p className="font-medium">Add at least one pond before recording stock or mortality.</p>
          <Link href="/aquaculture/ponds" className="mt-2 inline-block font-medium text-teal-800 underline">
            Go to Ponds
          </Link>
        </div>
      ) : null}

      <section className="mb-8 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-900">Implied stock position</h2>
        <p className="mt-1 text-xs text-slate-500">
          Net fish count and kg from transfers, sales, and ledger deltas; latest biomass sample for comparison.
        </p>
        <div className="mt-3 flex flex-wrap gap-3">
          <select
            value={posPond}
            onChange={(e) => setPosPond(e.target.value)}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
          >
            <option value="">All ponds</option>
            {ponds.map((p) => (
              <option key={p.id} value={String(p.id)}>
                {p.name}
              </option>
            ))}
          </select>
          <select
            value={posCycle}
            onChange={(e) => setPosCycle(e.target.value)}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
            disabled={!posPond}
          >
            <option value="">All cycles (pond total)</option>
            {posCycles.map((c) => (
              <option key={c.id} value={String(c.id)}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div className="mt-4 overflow-x-auto">
          {positionLoading ? (
            <p className="py-6 text-center text-sm text-slate-500">Loading positions…</p>
          ) : (
            <table className="min-w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase text-slate-500">
                  <th className="py-2 pr-4">Pond</th>
                  <th className="py-2 pr-4">Net fish (est.)</th>
                  <th className="py-2 pr-4">Net kg (est.)</th>
                  <th className="py-2 pr-4">Latest sample</th>
                  <th className="py-2">Sample vs net</th>
                </tr>
              </thead>
              <tbody>
                {position.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-slate-500">
                      No implied position for this filter yet. Positions build from transfers, pond sales, and ledger
                      entries.
                    </td>
                  </tr>
                ) : (
                  position.map((r) => {
                    const netC = r.implied_net_fish_count
                    const samp = r.latest_sample_estimated_fish_count
                    const diff = samp != null && netC != null ? samp - netC : null
                    return (
                      <tr key={r.pond_id} className="border-b border-slate-100">
                        <td className="py-2 pr-4 font-medium text-slate-800">{r.pond_name}</td>
                        <td className="py-2 pr-4 tabular-nums">{formatNumber(r.implied_net_fish_count, 0)}</td>
                        <td className="py-2 pr-4 tabular-nums">{formatNumber(Number(r.implied_net_weight_kg), 2)}</td>
                        <td className="py-2 pr-4 text-slate-600">
                          {r.latest_sample_date ? formatDateOnly(r.latest_sample_date) : '—'}
                          {r.latest_sample_estimated_fish_count != null
                            ? ` · ~${formatNumber(r.latest_sample_estimated_fish_count, 0)} fish`
                            : ''}
                          {r.latest_sample_fish_species_label
                            ? ` · ${r.latest_sample_fish_species_label}`
                            : ''}
                        </td>
                        <td className="py-2 text-slate-600">
                          {diff == null ? '—' : `${diff > 0 ? '+' : ''}${formatNumber(diff, 0)} vs ledger net`}
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <h2 className="text-sm font-semibold text-slate-900">Ledger</h2>
          <select
            value={filterPond}
            onChange={(e) => setFilterPond(e.target.value)}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
          >
            <option value="">All ponds</option>
            {ponds.map((p) => (
              <option key={p.id} value={String(p.id)}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        {loading ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase text-slate-500">
                  <th className="py-2 pr-3">Date</th>
                  <th className="py-2 pr-3">Pond</th>
                  <th className="py-2 pr-3">Kind</th>
                  <th className="py-2 pr-3">Reason</th>
                  <th className="py-2 pr-3">Species</th>
                  <th className="py-2 pr-3">Δ fish</th>
                  <th className="py-2 pr-3">Δ kg</th>
                  <th className="py-2 pr-3">Book</th>
                  <th className="py-2 pr-3">GL</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="py-8 text-center text-slate-500">
                      No ledger rows yet. Use <strong className="text-slate-700">Add entry</strong> for mortality,
                      predation, theft, or count/weight corrections.
                    </td>
                  </tr>
                ) : (
                  rows.map((r) => (
                    <tr key={r.id} className="border-b border-slate-100">
                      <td className="py-2 pr-3 whitespace-nowrap">{formatDateOnly(r.entry_date)}</td>
                      <td className="py-2 pr-3">{r.pond_name}</td>
                      <td className="py-2 pr-3">{r.entry_kind_label}</td>
                      <td className="py-2 pr-3 text-slate-600">{r.loss_reason_label || r.loss_reason || '—'}</td>
                      <td className="py-2 pr-3 text-slate-600">{r.fish_species_label?.trim() || '—'}</td>
                      <td className="py-2 pr-3 tabular-nums">{formatNumber(Number(r.fish_count_delta), 0)}</td>
                      <td className="py-2 pr-3 tabular-nums">{formatNumber(Number(r.weight_kg_delta), 2)}</td>
                      <td className="py-2 pr-3 tabular-nums">
                        {parseFloat(r.book_value) > 0 ? `${sym}${formatNumber(parseFloat(r.book_value), 2)}` : '—'}
                      </td>
                      <td className="py-2 pr-3 text-xs text-slate-600">
                        {r.post_to_books ? r.journal_entry_number || 'posted' : '—'}
                      </td>
                      <td className="py-2">
                        <button
                          type="button"
                          onClick={() => void remove(r.id)}
                          className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-700"
                          title="Delete"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {modal ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-5 shadow-xl">
            <h3 className="text-lg font-semibold text-slate-900">Stock ledger entry</h3>
            <div className="mt-4 space-y-3">
              <label className="block text-xs font-medium text-slate-600">
                Pond
                <select
                  value={form.pond_id}
                  onChange={(e) => setForm((f) => ({ ...f, pond_id: e.target.value }))}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                >
                  {ponds.map((p) => (
                    <option key={p.id} value={String(p.id)}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-xs font-medium text-slate-600">
                Production cycle (optional)
                <select
                  value={form.production_cycle_id}
                  onChange={(e) => setForm((f) => ({ ...f, production_cycle_id: e.target.value }))}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                >
                  <option value="">Not specified</option>
                  {cycles.map((c) => (
                    <option key={c.id} value={String(c.id)}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-xs font-medium text-slate-600">
                Entry kind
                <select
                  value={form.entry_kind}
                  onChange={(e) => setForm((f) => ({ ...f, entry_kind: e.target.value }))}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                >
                  {(ref?.entry_kind ?? [
                    { id: 'loss', label: 'Loss' },
                    { id: 'adjustment', label: 'Adjustment' },
                  ]).map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
              {form.entry_kind === 'loss' ? (
                <label className="block text-xs font-medium text-slate-600">
                  Loss reason
                  <select
                    value={form.loss_reason}
                    onChange={(e) => setForm((f) => ({ ...f, loss_reason: e.target.value }))}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  >
                    {(ref?.loss_reason ?? []).map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <label className="block text-xs font-medium text-slate-600">
                Species
                <select
                  value={form.fish_species}
                  onChange={(e) => setForm((f) => ({ ...f, fish_species: e.target.value }))}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                >
                  {fishSpecies.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
              {form.fish_species === 'other' ? (
                <label className="block text-xs font-medium text-slate-600">
                  Species name
                  <input
                    value={form.fish_species_other}
                    onChange={(e) => setForm((f) => ({ ...f, fish_species_other: e.target.value }))}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  />
                </label>
              ) : null}
              <label className="block text-xs font-medium text-slate-600">
                Date
                <input
                  type="date"
                  value={form.entry_date}
                  onChange={(e) => setForm((f) => ({ ...f, entry_date: e.target.value }))}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </label>
              {form.entry_kind === 'loss' ? (
                <>
                  <label className="block text-xs font-medium text-slate-600">
                    Fish removed (heads, positive number)
                    <input
                      value={form.fish_removed}
                      onChange={(e) => setForm((f) => ({ ...f, fish_removed: e.target.value }))}
                      className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                      inputMode="numeric"
                    />
                  </label>
                  <label className="block text-xs font-medium text-slate-600">
                    Weight removed (kg, positive)
                    <input
                      value={form.kg_removed}
                      onChange={(e) => setForm((f) => ({ ...f, kg_removed: e.target.value }))}
                      className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                    />
                  </label>
                </>
              ) : (
                <>
                  <label className="block text-xs font-medium text-slate-600">
                    Δ Fish count (negative = fewer, positive = more)
                    <input
                      value={form.adj_fish_count}
                      onChange={(e) => setForm((f) => ({ ...f, adj_fish_count: e.target.value }))}
                      className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                    />
                  </label>
                  <label className="block text-xs font-medium text-slate-600">
                    Δ Weight kg
                    <input
                      value={form.adj_weight_kg}
                      onChange={(e) => setForm((f) => ({ ...f, adj_weight_kg: e.target.value }))}
                      className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                    />
                  </label>
                </>
              )}
              <label className="block text-xs font-medium text-slate-600">
                Book value ({sym}) for GL (optional)
                <input
                  value={form.book_value}
                  onChange={(e) => setForm((f) => ({ ...f, book_value: e.target.value }))}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  placeholder="0"
                />
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={form.post_to_books}
                  onChange={(e) => setForm((f) => ({ ...f, post_to_books: e.target.checked }))}
                />
                Post journal (requires book value &amp; COA 1581 / 6726 / 4244)
              </label>
              <label className="block text-xs font-medium text-slate-600">
                Memo
                <textarea
                  value={form.memo}
                  onChange={(e) => setForm((f) => ({ ...f, memo: e.target.value }))}
                  rows={2}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </label>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setModal(false)}
                className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void submit()}
                className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
