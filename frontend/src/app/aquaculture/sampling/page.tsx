'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Plus, RefreshCw, Trash2 } from 'lucide-react'
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
  notes: string
  /** Set when this row was auto-created from a fish harvest sale (Pond sales). */
  source_fish_sale_id?: number | null
}

interface CycleRow {
  id: number
  name: string
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

/** fish per kg (pcs/kg) when count and total kg are known */
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

  const computedAvgWeightKg = useMemo(
    () => computeAvgWeightKg(form.estimated_fish_count, form.estimated_total_weight_kg),
    [form.estimated_fish_count, form.estimated_total_weight_kg],
  )

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
    const payload: Record<string, unknown> = {
      pond_id: parseInt(form.pond_id, 10),
      sample_date: form.sample_date,
      fish_species: form.fish_species,
      notes: form.notes.trim(),
    }
    if (form.fish_species === 'other') {
      payload.fish_species_other = form.fish_species_other.trim()
    }
    if (form.estimated_fish_count.trim() !== '') {
      const n = parseInt(form.estimated_fish_count, 10)
      if (!Number.isFinite(n)) {
        toast.error('Fish count must be an integer')
        return
      }
      payload.estimated_fish_count = n
    }
    if (form.estimated_total_weight_kg.trim() !== '') {
      const x = Number(form.estimated_total_weight_kg)
      if (!Number.isFinite(x) || x < 0) {
        toast.error('Invalid total weight')
        return
      }
      payload.estimated_total_weight_kg = x
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
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 id="aq-sampling-title" className="text-xl font-bold tracking-tight text-slate-900">
            Biomass sampling
          </h1>
          <p className="mt-1 max-w-xl text-sm leading-relaxed text-slate-600">
            Optional production metrics per pond, species, and date — use one row per species in polyculture. These records
            are informational and do not post to the general ledger.
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
            Add sample
          </button>
        </div>
      </div>

      {loading ? (
        <div className="mt-10 flex justify-center">
          <div className="h-10 w-10 animate-spin rounded-full border-2 border-slate-200 border-t-teal-600" />
        </div>
      ) : ponds.length === 0 ? (
        <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-5 text-sm text-amber-950">
          <p className="font-medium">Add at least one pond first</p>
          <p className="mt-1 text-amber-900/90">Sampling records are per pond. Create ponds, then log biomass estimates.</p>
          <Link
            href="/aquaculture/ponds"
            className="mt-3 inline-block font-medium text-teal-800 underline decoration-teal-600/50 hover:decoration-teal-800"
          >
            Go to Ponds
          </Link>
        </div>
      ) : (
        <div className="mt-6 overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full text-left text-sm" aria-labelledby="aq-sampling-title">
            <caption className="sr-only">Aquaculture biomass sampling records</caption>
            <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
              <tr>
                <th scope="col" className="px-3 py-2">
                  Date
                </th>
                <th scope="col" className="px-3 py-2">
                  Pond
                </th>
                <th scope="col" className="px-3 py-2">
                  Cycle
                </th>
                <th scope="col" className="px-3 py-2">
                  Species
                </th>
                <th scope="col" className="px-3 py-2 text-right">
                  Est. fish
                </th>
                <th scope="col" className="px-3 py-2 text-right">
                  Est. weight (kg)
                </th>
                <th scope="col" className="px-3 py-2 text-right">
                  Avg. weight (kg)
                </th>
                <th scope="col" className="px-3 py-2 text-right">
                  Fish/kg
                </th>
                <th scope="col" className="px-3 py-2">
                  Notes
                </th>
                <th scope="col" className="w-24 px-3 py-2">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const avgKg = displayAvgWeightKg(r)
                const pk = pcsPerKgFromSample(r)
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
                  <td className="px-3 py-2 text-right tabular-nums">
                    {avgKg != null ? formatNumber(avgKg) : '—'}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-700">
                    {pk != null ? formatNumber(pk) : '—'}
                  </td>
                  <td className="max-w-[160px] truncate px-3 py-2 text-slate-600">{r.notes || '—'}</td>
                  <td className="px-3 py-2">
                    <button type="button" className="text-blue-600 hover:underline mr-2" onClick={() => openEdit(r)}>
                      Edit
                    </button>
                    <button type="button" className="text-red-600" onClick={() => void remove(r)}>
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              )})}
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-3 py-8 text-center text-slate-500">
                    No sampling records.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl bg-white p-6 shadow-xl">
            <h2 className="text-lg font-semibold">{editing ? 'Edit sample' : 'New sample'}</h2>
            {editing?.source_fish_sale_id != null ? (
              <p className="mt-2 rounded-lg border border-teal-200 bg-teal-50 px-3 py-2 text-xs leading-relaxed text-teal-950">
                This row was created from a pond fish harvest sale (head count + kg). Editing here changes only this
                sampling record; the sale screen is the source of truth and will overwrite this row if you save the
                sale again.
              </p>
            ) : null}
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
                  <option value="">Not specified</option>
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
              <label className="block text-sm font-medium text-slate-700">
                Estimated fish count
                <input
                  type="number"
                  min="0"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                  value={form.estimated_fish_count}
                  onChange={(e) => setForm((f) => ({ ...f, estimated_fish_count: e.target.value }))}
                />
              </label>
              <label className="block text-sm font-medium text-slate-700">
                Estimated total weight (kg)
                <input
                  type="number"
                  min="0"
                  step="0.0001"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                  value={form.estimated_total_weight_kg}
                  onChange={(e) => setForm((f) => ({ ...f, estimated_total_weight_kg: e.target.value }))}
                />
              </label>
              <div className="block text-sm font-medium text-slate-700">
                Average weight (kg)
                <div
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-slate-800 tabular-nums"
                  aria-live="polite"
                >
                  {computedAvgWeightKg != null ? formatNumber(computedAvgWeightKg) : '—'}
                  {computedAvgWeightKg == null ? (
                    <span className="mt-1 block text-xs font-normal text-slate-500">
                      Enter estimated fish count and total weight (count must be greater than zero).
                    </span>
                  ) : null}
                </div>
              </div>
              <label className="block text-sm font-medium text-slate-700">
                Notes
                <textarea
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                  rows={2}
                  value={form.notes}
                  onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
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
