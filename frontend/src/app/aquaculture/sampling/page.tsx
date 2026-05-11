'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ExternalLink, Info, Pen, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { useToast } from '@/components/Toast'
import api from '@/lib/api'
import { extractErrorMessage } from '@/utils/errorHandler'
import { formatNumber } from '@/utils/currency'
import { formatDateOnly } from '@/utils/date'

interface Pond {
  id: number
  name: string
}
interface FishSpeciesOpt {
  id: string
  label: string
}

interface SampleRow {
  id: number
  pond_id: number
  pond_name: string
  production_cycle_id?: number | null
  production_cycle_name?: string
  sample_date: string
  fish_species?: string
  fish_species_other?: string
  fish_species_label?: string
  estimated_fish_count: number | null
  estimated_total_weight_kg: string | null
  avg_weight_kg: string | null
  stock_reference_fish_count?: number | null
  stock_reference_net_weight_kg?: string | null
  stock_reference_avg_weight_kg?: string | null
  extrapolated_biomass_kg?: string | null
  biomass_gain_kg?: string | null
  notes: string
  source_fish_sale_id?: number | null
}

interface CycleRow {
  id: number
  name: string
}

interface PositionRow {
  implied_net_fish_count: number
  implied_net_weight_kg: string
}

/** total_kg / fish_count when both are valid and count > 0 */
function computeAvgWeightKg(fishCountStr: string, totalKgStr: string): number | null {
  const countStr = fishCountStr.trim()
  const wStr = totalKgStr.trim()
  if (!countStr || !wStr) return null
  const count = parseInt(countStr, 10)
  const total = Number(wStr)
  if (!Number.isFinite(count) || count <= 0 || !Number.isFinite(total) || total < 0) return null
  return total / count
}

function pcsPerKgFromSample(r: SampleRow): number | null {
  const c = r.estimated_fish_count
  const w = r.estimated_total_weight_kg
  if (c == null || c <= 0 || w == null || w === '') return null
  const tw = Number(w)
  if (!Number.isFinite(tw) || tw <= 0) return null
  return c / tw
}

function displayAvgWeightKg(r: SampleRow): number | null {
  const c = r.estimated_fish_count
  const w = r.estimated_total_weight_kg
  if (c != null && c > 0 && w != null && w !== '') {
    const tw = Number(w)
    if (Number.isFinite(tw) && tw >= 0) return tw / c
  }
  if (r.avg_weight_kg != null && r.avg_weight_kg !== '') {
    const x = Number(r.avg_weight_kg)
    if (Number.isFinite(x)) return x
  }
  return null
}

function parseNum(s: string | null | undefined): number | null {
  if (s == null || s === '') return null
  const x = Number(String(s).replace(/,/g, ''))
  return Number.isFinite(x) ? x : null
}

/** Live preview: same logic as backend apply_aquaculture_biomass_sample_extrapolation */
function extrapolationPreview(
  sampleCount: number,
  sampleKg: number,
  stock: PositionRow | null,
): {
  refHead: number | null
  refNetKg: number | null
  refAvgKg: number | null
  sampleAvgKg: number
  biomassKg: number | null
  gainKg: number | null
} {
  const sampleAvgKg = sampleKg / sampleCount
  if (!stock) {
    return {
      refHead: null,
      refNetKg: null,
      refAvgKg: null,
      sampleAvgKg,
      biomassKg: null,
      gainKg: null,
    }
  }
  const tc = stock.implied_net_fish_count
  const tw = Number(String(stock.implied_net_weight_kg).replace(/,/g, ''))
  const refHead = tc > 0 ? tc : null
  const refNetKg = Number.isFinite(tw) ? tw : null
  let refAvgKg: number | null = null
  if (tc > 0 && tw > 0) refAvgKg = tw / tc
  if (refHead == null || refHead <= 0) {
    return { refHead, refNetKg, refAvgKg, sampleAvgKg, biomassKg: null, gainKg: null }
  }
  const biomassKg = sampleAvgKg * refHead
  const gainKg = refAvgKg != null ? (sampleAvgKg - refAvgKg) * refHead : null
  return { refHead, refNetKg, refAvgKg, sampleAvgKg, biomassKg, gainKg }
}

export default function AquacultureSamplingPage() {
  const toast = useToast()
  const [ponds, setPonds] = useState<Pond[]>([])
  const [fishSpeciesOpts, setFishSpeciesOpts] = useState<FishSpeciesOpt[]>([])
  const [cycles, setCycles] = useState<CycleRow[]>([])
  const [rows, setRows] = useState<SampleRow[]>([])
  const [loading, setLoading] = useState(true)
  const [filterPond, setFilterPond] = useState('')
  const [modal, setModal] = useState(false)
  const [editing, setEditing] = useState<SampleRow | null>(null)
  const [form, setForm] = useState({
    pond_id: '',
    production_cycle_id: '',
    sample_date: '',
    fish_species: 'tilapia',
    fish_species_other: '',
    estimated_fish_count: '',
    estimated_total_weight_kg: '',
    notes: '',
  })
  const [stockPreview, setStockPreview] = useState<PositionRow | null>(null)
  const [stockPreviewLoading, setStockPreviewLoading] = useState(false)

  const speciesOptionsForSampling = (
    fishSpeciesOpts.length ? fishSpeciesOpts : [{ id: 'tilapia', label: 'Tilapia' }]
  ).filter((s) => s.id !== 'not_applicable')

  const loadPonds = useCallback(async () => {
    try {
      const [pRes, spRes] = await Promise.all([
        api.get<Pond[]>('/aquaculture/ponds/'),
        api.get<FishSpeciesOpt[]>('/aquaculture/fish-species/').catch(() => ({ data: [] })),
      ])
      setPonds(Array.isArray(pRes.data) ? pRes.data : [])
      setFishSpeciesOpts(Array.isArray(spRes.data) ? spRes.data : [])
    } catch (e) {
      toast.error(extractErrorMessage(e, 'Could not load ponds'))
    }
  }, [toast])

  const loadRows = useCallback(async () => {
    setLoading(true)
    try {
      const params = filterPond ? { pond_id: filterPond } : undefined
      const { data } = await api.get<SampleRow[]>('/aquaculture/samples/', { params })
      setRows(Array.isArray(data) ? data : [])
    } catch (e) {
      toast.error(extractErrorMessage(e, 'Could not load samples'))
    } finally {
      setLoading(false)
    }
  }, [toast, filterPond])

  useEffect(() => {
    void loadPonds()
  }, [loadPonds])

  useEffect(() => {
    void loadRows()
  }, [loadRows])

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

  const refreshStockPreview = useCallback(async () => {
    const pid = form.pond_id
    const species = (form.fish_species || 'tilapia').trim()
    if (!modal || !pid || !species) {
      setStockPreview(null)
      return
    }
    setStockPreviewLoading(true)
    try {
      const params: Record<string, string> = {
        pond_id: pid,
        fish_species: species,
      }
      if (form.production_cycle_id) params.production_cycle_id = form.production_cycle_id
      const { data } = await api.get<{ rows: PositionRow[] }>('/aquaculture/fish-stock-position/', { params })
      const row = Array.isArray(data?.rows) && data.rows.length ? data.rows[0] : null
      setStockPreview(row)
    } catch {
      setStockPreview(null)
    } finally {
      setStockPreviewLoading(false)
    }
  }, [modal, form.pond_id, form.production_cycle_id, form.fish_species])

  useEffect(() => {
    if (!modal) {
      setStockPreview(null)
      return
    }
    const t = window.setTimeout(() => void refreshStockPreview(), 200)
    return () => window.clearTimeout(t)
  }, [modal, refreshStockPreview])

  const computedAvgWeightKg = useMemo(
    () => computeAvgWeightKg(form.estimated_fish_count, form.estimated_total_weight_kg),
    [form.estimated_fish_count, form.estimated_total_weight_kg],
  )

  const modalExtrapolation = useMemo(() => {
    const n = parseInt(form.estimated_fish_count, 10)
    const w = Number(String(form.estimated_total_weight_kg).replace(/,/g, ''))
    if (!Number.isFinite(n) || n <= 0 || !Number.isFinite(w) || w <= 0) return null
    return extrapolationPreview(n, w, stockPreview)
  }, [form.estimated_fish_count, form.estimated_total_weight_kg, stockPreview])

  const openNew = () => {
    setEditing(null)
    const today = new Date().toISOString().slice(0, 10)
    setForm({
      pond_id: ponds[0] ? String(ponds[0].id) : '',
      production_cycle_id: '',
      sample_date: today,
      fish_species: 'tilapia',
      fish_species_other: '',
      estimated_fish_count: '',
      estimated_total_weight_kg: '',
      notes: '',
    })
    setModal(true)
  }

  const openEdit = (r: SampleRow) => {
    setEditing(r)
    setForm({
      pond_id: String(r.pond_id),
      production_cycle_id: r.production_cycle_id != null ? String(r.production_cycle_id) : '',
      sample_date: r.sample_date.slice(0, 10),
      fish_species: r.fish_species || 'tilapia',
      fish_species_other: r.fish_species_other || '',
      estimated_fish_count: r.estimated_fish_count != null ? String(r.estimated_fish_count) : '',
      estimated_total_weight_kg: r.estimated_total_weight_kg || '',
      notes: r.notes || '',
    })
    setModal(true)
  }

  const save = async () => {
    if (!form.pond_id || !form.sample_date) {
      toast.error('Pond and sample date are required')
      return
    }
    const n = parseInt(form.estimated_fish_count, 10)
    if (!Number.isFinite(n) || n <= 0) {
      toast.error('Number of fish in the net sample must be a positive integer')
      return
    }
    const x = Number(String(form.estimated_total_weight_kg).replace(/,/g, ''))
    if (!Number.isFinite(x) || x <= 0) {
      toast.error('Total weight of the net sample (kg) is required and must be greater than zero')
      return
    }
    const payload: Record<string, unknown> = {
      pond_id: parseInt(form.pond_id, 10),
      sample_date: form.sample_date,
      fish_species: form.fish_species,
      notes: form.notes.trim(),
      estimated_fish_count: n,
      estimated_total_weight_kg: x,
    }
    if (form.fish_species === 'other') {
      payload.fish_species_other = form.fish_species_other.trim()
    }
    const autoAvg = computeAvgWeightKg(form.estimated_fish_count, form.estimated_total_weight_kg)
    payload.avg_weight_kg = autoAvg !== null ? autoAvg : null
    if (editing) {
      payload.production_cycle_id = form.production_cycle_id ? parseInt(form.production_cycle_id, 10) : null
    } else if (form.production_cycle_id) {
      payload.production_cycle_id = parseInt(form.production_cycle_id, 10)
    }
    try {
      if (editing) {
        await api.put(`/aquaculture/samples/${editing.id}/`, payload)
        toast.success('Updated')
      } else {
        await api.post('/aquaculture/samples/', payload)
        toast.success('Saved')
      }
      setModal(false)
      void loadRows()
    } catch (e) {
      toast.error(extractErrorMessage(e, 'Save failed'))
    }
  }

  const remove = async (r: SampleRow) => {
    if (!window.confirm('Delete this sample?')) return
    try {
      await api.delete(`/aquaculture/samples/${r.id}/`)
      toast.success('Deleted')
      void loadRows()
    } catch (e) {
      toast.error(extractErrorMessage(e, 'Delete failed'))
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 id="aq-sampling-title" className="text-xl font-bold tracking-tight text-slate-900">
            Biomass sampling
          </h1>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-slate-600">
            Record a <strong className="font-medium text-slate-800">net sample</strong>: catch a batch, weigh them together,
            count them, and return them to the pond. The app combines your sample mean weight with{' '}
            <strong className="font-medium text-slate-800">head count from Fish stock</strong> (transfers, stocking,
            sales, adjustments) to estimate total pond biomass and growth since the last book mean.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs text-slate-600">
            Pond
            <select
              className="ml-1 block rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm"
              value={filterPond}
              onChange={(e) => setFilterPond(e.target.value)}
            >
              <option value="">All</option>
              {ponds.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <button type="button" onClick={() => void loadRows()} className="inline-flex items-center gap-1 rounded-lg border px-3 py-2 text-sm">
            <RefreshCw className="h-4 w-4" />
            Refresh
          </button>
          <button
            type="button"
            onClick={openNew}
            disabled={loading || ponds.length === 0}
            className="inline-flex items-center gap-1 rounded-lg bg-teal-600 px-3 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus className="h-4 w-4" />
            Log sample
          </button>
        </div>
      </div>

      <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50/80 p-4 text-sm leading-relaxed text-slate-700">
        <div className="flex gap-2">
          <Info className="mt-0.5 h-5 w-5 shrink-0 text-teal-700" aria-hidden />
          <div>
            <p className="font-medium text-slate-900">How the numbers work</p>
            <p className="mt-1">
              Example: 20 fish in the net, 5&nbsp;kg total → sample mean 0.25&nbsp;kg/fish. If Fish stock shows 70,000 head
              and 14,000&nbsp;kg net for that species → book mean 0.20&nbsp;kg/fish. Estimated pond biomass ≈ 0.25 ×
              70,000 = 17,500&nbsp;kg; estimated gain vs book mean ≈ (0.25 − 0.20) × 70,000 = 3,500&nbsp;kg. Rows in the
              table store a <strong className="font-medium text-slate-800">snapshot</strong> of Fish stock at save time
              (not historical replay).
            </p>
            <p className="mt-2">
              <Link
                href="/aquaculture/stock"
                className="inline-flex items-center gap-1 font-medium text-teal-800 underline decoration-teal-600/40 hover:decoration-teal-800"
              >
                Pond stock (fish biomass)
                <ExternalLink className="h-3.5 w-3.5 opacity-80" aria-hidden />
              </Link>
              {' — '}
              keep head count and biological kg aligned with your operations so extrapolation is meaningful.
            </p>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="mt-10 flex justify-center">
          <div className="h-10 w-10 animate-spin rounded-full border-2 border-slate-200 border-t-teal-600" />
        </div>
      ) : ponds.length === 0 ? (
        <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-5 text-sm text-amber-950">
          <p className="font-medium">Add at least one pond first</p>
          <p className="mt-1 text-amber-900/90">Sampling is recorded per pond.</p>
          <Link
            href="/aquaculture/ponds"
            className="mt-3 inline-block font-medium text-teal-800 underline decoration-teal-600/50 hover:decoration-teal-800"
          >
            Go to Ponds
          </Link>
        </div>
      ) : (
        <div className="mt-6 overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="min-w-[1100px] w-full text-left text-sm" aria-labelledby="aq-sampling-title">
            <caption className="sr-only">Aquaculture net samples and pond biomass extrapolation</caption>
            <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-600">
              <tr>
                <th scope="col" className="px-3 py-2.5">
                  Date
                </th>
                <th scope="col" className="px-3 py-2.5">
                  Pond
                </th>
                <th scope="col" className="px-3 py-2.5">
                  Cycle
                </th>
                <th scope="col" className="px-3 py-2.5">
                  Species
                </th>
                <th scope="col" className="px-3 py-2.5 text-right normal-case">
                  Sample fish
                </th>
                <th scope="col" className="px-3 py-2.5 text-right normal-case">
                  Sample kg
                </th>
                <th scope="col" className="px-3 py-2.5 text-right normal-case">
                  Sample mean kg
                </th>
                <th scope="col" className="px-3 py-2.5 text-right normal-case">
                  Book head
                </th>
                <th scope="col" className="px-3 py-2.5 text-right normal-case">
                  Book mean kg
                </th>
                <th scope="col" className="px-3 py-2.5 text-right normal-case">
                  Est. biomass kg
                </th>
                <th scope="col" className="px-3 py-2.5 text-right normal-case">
                  Est. Δ kg
                </th>
                <th scope="col" className="px-3 py-2.5 text-right normal-case">
                  Fish/kg
                </th>
                <th scope="col" className="px-3 py-2.5 normal-case">
                  Notes
                </th>
                <th scope="col" className="w-24 px-3 py-2.5 text-right normal-case">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="text-slate-800">
              {rows.map((r) => {
                const avgKg = displayAvgWeightKg(r)
                const pk = pcsPerKgFromSample(r)
                const bookHead = r.stock_reference_fish_count
                const bookMean = parseNum(r.stock_reference_avg_weight_kg)
                const estBio = parseNum(r.extrapolated_biomass_kg)
                const estGain = parseNum(r.biomass_gain_kg)
                return (
                  <tr key={r.id} className="border-b border-slate-100">
                    <td className="px-3 py-2 whitespace-nowrap">
                      <span>{formatDateOnly(r.sample_date)}</span>
                      {r.source_fish_sale_id != null ? (
                        <span className="ml-1.5 rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-700">
                          Sale
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2">{r.pond_name}</td>
                    <td className="px-3 py-2 text-slate-600">{r.production_cycle_name?.trim() || '—'}</td>
                    <td className="px-3 py-2">{r.fish_species_label || r.fish_species || '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.estimated_fish_count ?? '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {r.estimated_total_weight_kg != null ? formatNumber(Number(r.estimated_total_weight_kg)) : '—'}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{avgKg != null ? formatNumber(avgKg) : '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-700">
                      {bookHead != null && bookHead > 0 ? formatNumber(bookHead, 0) : '—'}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-700">
                      {bookMean != null ? formatNumber(bookMean) : '—'}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{estBio != null ? formatNumber(estBio) : '—'}</td>
                    <td
                      className={`px-3 py-2 text-right tabular-nums ${
                        estGain == null ? '' : estGain >= 0 ? 'text-emerald-800' : 'text-rose-800'
                      }`}
                    >
                      {estGain != null ? formatNumber(estGain) : '—'}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-600">{pk != null ? formatNumber(pk) : '—'}</td>
                    <td className="max-w-[140px] truncate px-3 py-2 text-slate-600">{r.notes || '—'}</td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex items-center justify-end gap-0.5">
                        <button
                          type="button"
                          onClick={() => openEdit(r)}
                          className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                          title="Edit"
                        >
                          <Pen className="h-4 w-4" aria-hidden />
                          <span className="sr-only">Edit</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => void remove(r)}
                          className="rounded p-1.5 text-slate-500 hover:bg-rose-50 hover:text-rose-700"
                          title="Delete sample"
                        >
                          <Trash2 className="h-4 w-4" aria-hidden />
                          <span className="sr-only">Delete sample</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={14} className="px-3 py-10 text-center text-slate-500">
                    No sampling records yet. Use <span className="font-medium text-slate-700">Log sample</span> after a net
                    catch.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-6 shadow-xl">
            <h2 className="text-lg font-semibold text-slate-900">{editing ? 'Edit net sample' : 'Log net sample'}</h2>
            {editing?.source_fish_sale_id != null ? (
              <p className="mt-2 rounded-lg border border-teal-200 bg-teal-50 px-3 py-2 text-xs leading-relaxed text-teal-950">
                This row was created from a pond fish harvest sale. Editing here only changes this sampling record; the
                sale screen remains the source of truth for that harvest.
              </p>
            ) : null}

            <ol className="mt-4 list-decimal space-y-1.5 pl-5 text-xs text-slate-600">
              <li>Choose pond, optional production cycle, and species.</li>
              <li>Enter how many fish were in the net and their combined weight (kg).</li>
              <li>Review live extrapolation vs current Fish stock, then save (values are snapshotted).</li>
            </ol>

            <div className="mt-4 space-y-3">
              <label className="block text-sm font-medium text-slate-700">
                Pond
                <select
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                  value={form.pond_id}
                  onChange={(e) => setForm((f) => ({ ...f, pond_id: e.target.value }))}
                >
                  {ponds.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm font-medium text-slate-700">
                Production cycle (optional)
                <select
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                  value={form.production_cycle_id}
                  onChange={(e) => setForm((f) => ({ ...f, production_cycle_id: e.target.value }))}
                >
                  <option value="">All movements for this pond</option>
                  {cycles.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm font-medium text-slate-700">
                Sample date
                <input
                  type="date"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                  value={form.sample_date}
                  onChange={(e) => setForm((f) => ({ ...f, sample_date: e.target.value }))}
                />
              </label>
              <label className="block text-sm font-medium text-slate-700">
                Fish species
                <select
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                  value={form.fish_species}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      fish_species: e.target.value,
                      fish_species_other: e.target.value === 'other' ? f.fish_species_other : '',
                    }))
                  }
                >
                  {speciesOptionsForSampling.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </label>
              {form.fish_species === 'other' ? (
                <label className="block text-sm font-medium text-slate-700">
                  Other species name
                  <input
                    type="text"
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                    value={form.fish_species_other}
                    onChange={(e) => setForm((f) => ({ ...f, fish_species_other: e.target.value }))}
                    placeholder="e.g. local strain"
                  />
                </label>
              ) : null}

              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Fish stock reference (live)</p>
                {stockPreviewLoading ? (
                  <p className="mt-2 text-sm text-slate-500">Loading position…</p>
                ) : stockPreview ? (
                  <dl className="mt-2 grid grid-cols-2 gap-2 text-sm">
                    <div>
                      <dt className="text-slate-500">Implied head</dt>
                      <dd className="font-medium tabular-nums text-slate-900">
                        {stockPreview.implied_net_fish_count > 0
                          ? formatNumber(stockPreview.implied_net_fish_count, 0)
                          : '—'}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">Implied net kg</dt>
                      <dd className="font-medium tabular-nums text-slate-900">
                        {formatNumber(Number(stockPreview.implied_net_weight_kg))}
                      </dd>
                    </div>
                  </dl>
                ) : (
                  <p className="mt-2 text-sm text-slate-500">Could not load position for this pond and species.</p>
                )}
                <p className="mt-2 text-xs leading-relaxed text-slate-500">
                  Matches the Fish stock page for this pond, optional cycle filter, and species. Saving stores these as book
                  head / mean for extrapolation.
                </p>
              </div>

              <label className="block text-sm font-medium text-slate-700">
                Fish in net sample (count) <span className="text-rose-600">*</span>
                <input
                  type="number"
                  min="1"
                  step="1"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                  value={form.estimated_fish_count}
                  onChange={(e) => setForm((f) => ({ ...f, estimated_fish_count: e.target.value }))}
                  placeholder="e.g. 20"
                />
              </label>
              <label className="block text-sm font-medium text-slate-700">
                Combined weight of net sample (kg) <span className="text-rose-600">*</span>
                <input
                  type="number"
                  min="0"
                  step="0.0001"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                  value={form.estimated_total_weight_kg}
                  onChange={(e) => setForm((f) => ({ ...f, estimated_total_weight_kg: e.target.value }))}
                  placeholder="e.g. 5"
                />
              </label>
              <div className="block text-sm font-medium text-slate-700">
                Sample mean weight (kg/fish)
                <div
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-slate-800 tabular-nums"
                  aria-live="polite"
                >
                  {computedAvgWeightKg != null ? formatNumber(computedAvgWeightKg) : '—'}
                </div>
              </div>

              {modalExtrapolation ? (
                <div className="rounded-lg border border-teal-100 bg-teal-50/60 p-3 text-sm">
                  <p className="text-xs font-semibold uppercase tracking-wide text-teal-900">Preview (before save)</p>
                  <dl className="mt-2 space-y-1.5">
                    <div className="flex justify-between gap-2">
                      <dt className="text-teal-900/80">Book mean kg/fish</dt>
                      <dd className="tabular-nums font-medium text-teal-950">
                        {modalExtrapolation.refAvgKg != null ? formatNumber(modalExtrapolation.refAvgKg) : '—'}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-teal-900/80">Est. pond biomass</dt>
                      <dd className="tabular-nums font-medium text-teal-950">
                        {modalExtrapolation.biomassKg != null ? `${formatNumber(modalExtrapolation.biomassKg)} kg` : '—'}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-teal-900/80">Est. biomass vs book mean</dt>
                      <dd
                        className={`tabular-nums font-medium ${
                          modalExtrapolation.gainKg == null
                            ? 'text-teal-950'
                            : modalExtrapolation.gainKg >= 0
                              ? 'text-emerald-800'
                              : 'text-rose-800'
                        }`}
                      >
                        {modalExtrapolation.gainKg != null ? `${formatNumber(modalExtrapolation.gainKg)} kg` : '—'}
                      </dd>
                    </div>
                  </dl>
                  {modalExtrapolation.refHead == null || modalExtrapolation.refHead <= 0 ? (
                    <p className="mt-2 text-xs text-amber-800">
                      No positive head count in Fish stock for this filter — extrapolation will be blank until stock is
                      recorded.
                    </p>
                  ) : null}
                </div>
              ) : null}

              <label className="block text-sm font-medium text-slate-700">
                Notes
                <textarea
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                  rows={2}
                  value={form.notes}
                  onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                  placeholder="Gear type, weather, crew, etc."
                />
              </label>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button type="button" onClick={() => setModal(false)} className="rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-slate-100">
                Cancel
              </button>
              <button type="button" onClick={() => void save()} className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white">
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
