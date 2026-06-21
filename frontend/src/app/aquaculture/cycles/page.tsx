'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Edit2, LayoutGrid, List, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { useToast } from '@/components/Toast'
import api from '@/lib/api'
import { extractErrorMessage } from '@/utils/errorHandler'
import { formatDateOnly } from '@/utils/date'

import { STOCKING_BATCH_WORKFLOW, suggestContinuousBatchName, suggestNursingBatchName, usesSeasonalStockingBatches } from '@/lib/stockingBatch'
import { isNursingRole } from '@/lib/aquaculturePondSite'

interface Pond {
  id: number
  name: string
  pond_role?: string
}

interface FishSpeciesOpt {
  id: string
  label: string
}

interface CycleRow {
  id: number
  pond_id: number
  pond_name?: string
  pond_role?: string
  name: string
  code: string
  fish_species?: string
  fish_species_label?: string
  source_production_cycle_id?: number | null
  source_production_cycle_name?: string
  source_production_cycle_code?: string
  start_date: string
  end_date: string | null
  sort_order: number
  is_active: boolean
  notes: string
  created_at?: string
}

type ViewMode = 'list' | 'cards'

function cycleCodeSerial(code: string): number | null {
  const m = /^[cC](\d+)$/.exec((code || '').trim())
  if (!m) return null
  const n = parseInt(m[1], 10)
  return Number.isFinite(n) ? n : null
}

/** Next C01-style code for one pond; matches backend gap-fill. */
function suggestNextCycleCode(existingCodes: string[]): string {
  const nums = new Set<number>()
  for (const c of existingCodes) {
    const n = cycleCodeSerial(c)
    if (n !== null) nums.add(n)
  }
  let m = 1
  while (nums.has(m)) m += 1
  let width = Math.max(2, String(m).length)
  if (nums.size > 0) {
    width = Math.max(width, ...[...nums].map((x) => String(x).length))
  }
  return `C${String(m).padStart(width, '0')}`
}

export default function AquacultureCyclesPage() {
  const toast = useToast()
  const searchParams = useSearchParams()
  const [ponds, setPonds] = useState<Pond[]>([])
  const [fishSpecies, setFishSpecies] = useState<FishSpeciesOpt[]>([])
  const [filterPond, setFilterPond] = useState('')
  const [rows, setRows] = useState<CycleRow[]>([])
  const [loading, setLoading] = useState(true)
  const [viewMode, setViewMode] = useState<ViewMode>('list')
  const [modal, setModal] = useState(false)
  const [editing, setEditing] = useState<CycleRow | null>(null)
  const [form, setForm] = useState({
    pond_id: '',
    name: '',
    code: '',
    fish_species: 'tilapia',
    fish_species_other: '',
    start_date: '',
    end_date: '',
    sort_order: '0',
    is_active: true,
    notes: '',
  })

  const loadPonds = useCallback(async () => {
    try {
      const [pondsRes, speciesRes] = await Promise.all([
        api.get<Pond[]>('/aquaculture/ponds/'),
        api.get<FishSpeciesOpt[]>('/aquaculture/fish-species/').catch(() => ({ data: [] })),
      ])
      setPonds(Array.isArray(pondsRes.data) ? pondsRes.data : [])
      setFishSpecies(Array.isArray(speciesRes.data) ? speciesRes.data : [])
    } catch (e) {
      toast.error(extractErrorMessage(e, 'Could not load ponds'))
    }
  }, [toast])

  const loadRows = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await api.get<CycleRow[]>('/aquaculture/production-cycles/')
      setRows(Array.isArray(data) ? data : [])
    } catch (e) {
      toast.error(extractErrorMessage(e, 'Could not load cycles'))
    } finally {
      setLoading(false)
    }
  }, [toast])

  const displayRows = useMemo(
    () => (filterPond ? rows.filter((r) => String(r.pond_id) === filterPond) : rows),
    [rows, filterPond],
  )

  const codesForPond = useCallback(
    (pondIdStr: string) => rows.filter((r) => String(r.pond_id) === pondIdStr).map((r) => r.code || ''),
    [rows],
  )

  useEffect(() => {
    void loadPonds()
  }, [loadPonds])

  useEffect(() => {
    void loadRows()
  }, [loadRows])

  useEffect(() => {
    const pid = (searchParams.get('pond_id') || '').trim()
    if (pid && /^\d+$/.test(pid)) {
      setFilterPond(pid)
    }
  }, [searchParams])

  const pondName = (id: number) => ponds.find((p) => p.id === id)?.name ?? `Pond #${id}`

  const speciesLabel = (id: string) =>
    fishSpecies.find((s) => s.id === id)?.label || (id === 'tilapia' ? 'Tilapia' : id)

  const applySuggestedName = (pondId: string, code: string, startDate: string, speciesId: string) => {
    const pond = ponds.find((p) => String(p.id) === pondId)
    if (!pond || !startDate) return ''
    const sp = speciesLabel(speciesId)
    if (isNursingRole(pond)) {
      return suggestNursingBatchName(sp, pond.name, code, startDate)
    }
    if (!usesSeasonalStockingBatches(speciesId)) {
      return suggestContinuousBatchName(sp, pond.name)
    }
    return `${sp} batch ${code ? `${code} ` : ''}— ${pond.name}`.trim()
  }

  const openNew = () => {
    setEditing(null)
    const today = new Date().toISOString().slice(0, 10)
    const pid =
      filterPond && ponds.some((p) => String(p.id) === filterPond)
        ? filterPond
        : ponds[0]
          ? String(ponds[0].id)
          : ''
    const nextCode = pid ? suggestNextCycleCode(codesForPond(pid)) : ''
    const suggested = pid
      ? applySuggestedName(pid, nextCode, today, 'tilapia')
      : ''
    setForm({
      pond_id: pid,
      name: suggested,
      code: nextCode,
      fish_species: 'tilapia',
      fish_species_other: '',
      start_date: today,
      end_date: '',
      sort_order: '0',
      is_active: true,
      notes: '',
    })
    setModal(true)
  }

  const openEdit = (r: CycleRow) => {
    setEditing(r)
    setForm({
      pond_id: String(r.pond_id),
      name: r.name,
      code: r.code || '',
      fish_species: r.fish_species || 'tilapia',
      fish_species_other: '',
      start_date: r.start_date.slice(0, 10),
      end_date: r.end_date ? r.end_date.slice(0, 10) : '',
      sort_order: String(r.sort_order ?? 0),
      is_active: r.is_active !== false,
      notes: r.notes || '',
    })
    setModal(true)
  }

  const save = async () => {
    if (!form.pond_id || !form.name.trim() || !form.start_date) {
      toast.error('Pond, name, and start date are required')
      return
    }
    const payload: Record<string, unknown> = {
      pond_id: parseInt(form.pond_id, 10),
      name: form.name.trim(),
      start_date: form.start_date,
      sort_order: parseInt(form.sort_order, 10) || 0,
      is_active: form.is_active,
      notes: form.notes.trim(),
      fish_species: form.fish_species || 'tilapia',
    }
    if (form.end_date.trim()) {
      payload.end_date = form.end_date.trim()
    }
    try {
      if (editing) {
        payload.code = form.code.trim()
        await api.put(`/aquaculture/production-cycles/${editing.id}/`, payload)
        toast.success('Updated')
      } else {
        const { data } = await api.post<CycleRow>('/aquaculture/production-cycles/', payload)
        const c = data?.code?.trim()
        toast.success(c ? `Created (${c})` : 'Created')
      }
      setModal(false)
      void loadRows()
    } catch (e) {
      toast.error(extractErrorMessage(e, 'Save failed'))
    }
  }

  const remove = async (r: CycleRow) => {
    if (!window.confirm(`Delete cycle “${r.name}”? This cannot be undone if no dependencies block it.`)) return
    try {
      await api.delete(`/aquaculture/production-cycles/${r.id}/`)
      toast.success('Deleted')
      void loadRows()
    } catch (e) {
      toast.error(extractErrorMessage(e, 'Delete failed'))
    }
  }

  const periodLabel = (r: CycleRow) => {
    const start = formatDateOnly(r.start_date)
    if (r.end_date) return `${start} → ${formatDateOnly(r.end_date)}`
    return `${start} → Open`
  }

  const CycleActions = ({ r }: { r: CycleRow }) => (
    <div className="flex shrink-0 justify-end gap-1">
      <button
        type="button"
        onClick={() => openEdit(r)}
        className="rounded p-2 text-slate-600 hover:bg-slate-100"
        aria-label={`Edit ${r.name}`}
      >
        <Edit2 className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={() => void remove(r)}
        className="rounded p-2 text-red-600 hover:bg-red-50"
        aria-label={`Delete ${r.name}`}
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  )

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 id="aq-cycles-title" className="text-xl font-bold tracking-tight text-slate-900">
            Stocking batches
          </h1>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-slate-600">
            Each <strong>tilapia</strong> fry purchase is a new batch (C01, C02, C03 per season).{' '}
            <strong>Other species</strong> usually share one open batch per pond that keeps growing — FSERP
            reuses it on new bills unless you start a 2nd batch on purpose.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs text-slate-600">
            Pond
            <select
              className="ml-1 block rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm"
              value={filterPond}
              onChange={(e) => setFilterPond(e.target.value)}
            >
              <option value="">All ponds</option>
              {ponds.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <div
            className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5"
            role="group"
            aria-label="Display layout"
          >
            <button
              type="button"
              onClick={() => setViewMode('list')}
              aria-pressed={viewMode === 'list'}
              className={`inline-flex items-center gap-1 rounded-md px-2.5 py-2 text-sm ${
                viewMode === 'list' ? 'bg-teal-600 font-medium text-white shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <List className="h-4 w-4" aria-hidden />
              List
            </button>
            <button
              type="button"
              onClick={() => setViewMode('cards')}
              aria-pressed={viewMode === 'cards'}
              className={`inline-flex items-center gap-1 rounded-md px-2.5 py-2 text-sm ${
                viewMode === 'cards'
                  ? 'bg-teal-600 font-medium text-white shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <LayoutGrid className="h-4 w-4" aria-hidden />
              Cards
            </button>
          </div>
          <button
            type="button"
            onClick={() => void loadRows()}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
          >
            <RefreshCw className="h-4 w-4" />
            Refresh
          </button>
          <button
            type="button"
            onClick={openNew}
            disabled={loading || ponds.length === 0}
            className="inline-flex items-center gap-1 rounded-lg bg-teal-600 px-3 py-2 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-50"
          >
            <Plus className="h-4 w-4" />
            Add batch
          </button>
        </div>
      </div>

      <section className="mt-6 rounded-xl border border-teal-100 bg-teal-50/40 p-4 text-sm text-teal-950">
        <h2 className="font-semibold text-teal-900">{STOCKING_BATCH_WORKFLOW.title}</h2>
        <ol className="mt-3 space-y-2">
          {STOCKING_BATCH_WORKFLOW.steps.map((s) => (
            <li key={s.phase} className="flex gap-2">
              <span className="shrink-0 font-medium text-teal-800">{s.phase}:</span>
              <span className="text-teal-900/90">{s.detail}</span>
            </li>
          ))}
        </ol>
      </section>

      {ponds.length === 0 ? (
        <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-5 text-sm text-amber-950">
          <Link href="/aquaculture/ponds" className="font-medium text-teal-800 underline">
            Create a pond
          </Link>{' '}
          first, then open stocking batches for each fry purchase.
        </div>
      ) : loading ? (
        <div className="mt-10 flex justify-center">
          <div className="h-10 w-10 animate-spin rounded-full border-2 border-slate-200 border-t-teal-600" />
        </div>
      ) : displayRows.length === 0 ? (
        <div
          className="mt-6 rounded-xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500 shadow-sm"
          aria-labelledby="aq-cycles-title"
        >
          {filterPond
            ? 'No batches for this pond in this view. Add a batch or clear the pond filter.'
            : 'No stocking batches yet. Add one when you buy fry, or let FSERP create it when you post a fry bill to the nursing pond.'}
        </div>
      ) : viewMode === 'list' ? (
        <div
          className="mt-6 overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm"
          aria-labelledby="aq-cycles-title"
        >
          <table className="min-w-[800px] w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Batch</th>
                <th className="px-4 py-3">Pond</th>
                <th className="px-4 py-3">Species</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Period</th>
                <th className="px-4 py-3 text-right">Sort</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {displayRows.map((r) => (
                <tr key={r.id} className="align-top text-slate-800">
                  <td className="px-4 py-3">
                    <p className="font-medium text-slate-900">{r.name}</p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {r.code?.trim() ? `Code ${r.code.trim()} · ` : ''}Order {r.sort_order ?? 0}
                    </p>
                    {r.source_production_cycle_name || r.source_production_cycle_code ? (
                      <p className="mt-1 text-xs text-teal-800">
                        From nursing: {r.source_production_cycle_code || r.source_production_cycle_name}
                      </p>
                    ) : null}
                    <p className="mt-1 text-xs text-slate-600 md:hidden">{periodLabel(r)}</p>
                  </td>
                  <td className="px-4 py-3 text-slate-700">
                    {r.pond_name || pondName(r.pond_id)}
                    {r.pond_role === 'nursing' ? (
                      <span className="ml-1 text-xs text-violet-700">(nursing)</span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-slate-700">{r.fish_species_label || 'Tilapia'}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                        r.is_active !== false ? 'bg-emerald-50 text-emerald-800' : 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      {r.is_active !== false ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-slate-700">{periodLabel(r)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-700">{r.sort_order ?? 0}</td>
                  <td className="px-4 py-3 text-right">
                    <CycleActions r={r} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <ul
          className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3"
          aria-labelledby="aq-cycles-title"
        >
          {displayRows.map((r) => (
            <li
              key={r.id}
              className="flex flex-col rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-slate-900">{r.name}</p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {r.code?.trim() ? `Code ${r.code.trim()} · ` : ''}Sort {r.sort_order ?? 0}
                  </p>
                </div>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
                    r.is_active !== false ? 'bg-emerald-50 text-emerald-800' : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  {r.is_active !== false ? 'Active' : 'Inactive'}
                </span>
              </div>

              <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                <div className="col-span-2">
                  <dt className="text-slate-500">Pond</dt>
                  <dd className="font-medium text-slate-800">{pondName(r.pond_id)}</dd>
                </div>
                <div className="col-span-2">
                  <dt className="text-slate-500">Period</dt>
                  <dd className="font-medium text-slate-800">{periodLabel(r)}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Start</dt>
                  <dd className="font-medium tabular-nums text-slate-800">{formatDateOnly(r.start_date)}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">End</dt>
                  <dd className="font-medium tabular-nums text-slate-800">
                    {r.end_date ? formatDateOnly(r.end_date) : 'Open'}
                  </dd>
                </div>
                {r.created_at ? (
                  <div className="col-span-2">
                    <dt className="text-slate-500">Record created</dt>
                    <dd className="font-medium text-slate-800">{formatDateOnly(r.created_at)}</dd>
                  </div>
                ) : null}
              </dl>

              {r.notes?.trim() ? (
                <p className="mt-2 line-clamp-3 border-t border-slate-100 pt-2 text-xs text-slate-600">{r.notes.trim()}</p>
              ) : null}

              <div className="mt-auto flex justify-end border-t border-slate-100 pt-3">
                <CycleActions r={r} />
              </div>
            </li>
          ))}
        </ul>
      )}

      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl bg-white p-6 shadow-xl">
            <h2 className="text-lg font-semibold">{editing ? 'Edit stocking batch' : 'New stocking batch'}</h2>
            <div className="mt-4 space-y-3">
              <label className="block text-sm font-medium text-slate-700">
                Pond
                <select
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                  value={form.pond_id}
                  disabled={!!editing}
                  onChange={(e) => {
                    const pid = e.target.value
                    if (editing) {
                      setForm((f) => ({ ...f, pond_id: pid }))
                      return
                    }
                    const code = pid ? suggestNextCycleCode(codesForPond(pid)) : ''
                    setForm((f) => {
                      const next = {
                        ...f,
                        pond_id: pid,
                        code,
                      }
                      const suggested = applySuggestedName(
                        pid,
                        code,
                        f.start_date || new Date().toISOString().slice(0, 10),
                        f.fish_species || 'tilapia',
                      )
                      return suggested ? { ...next, name: suggested } : next
                    })
                  }}
                >
                  {ponds.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm font-medium text-slate-700">
                Species
                <select
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                  value={form.fish_species}
                  onChange={(e) => {
                    const v = e.target.value
                    setForm((f) => {
                      const next = { ...f, fish_species: v }
                      if (!editing && f.pond_id) {
                        const suggested = applySuggestedName(
                          f.pond_id,
                          f.code,
                          f.start_date || new Date().toISOString().slice(0, 10),
                          v,
                        )
                        if (suggested) next.name = suggested
                      }
                      return next
                    })
                  }}
                >
                  {fishSpecies.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                  {fishSpecies.length === 0 ? <option value="tilapia">Tilapia</option> : null}
                </select>
                {!usesSeasonalStockingBatches(form.fish_species) ? (
                  <span className="mt-1 block text-xs font-normal text-slate-500">
                    One continuous batch per pond is normal for this species. Only add a 2nd batch if you are
                    deliberately starting a new rare stocking.
                  </span>
                ) : (
                  <span className="mt-1 block text-xs font-normal text-slate-500">
                    Tilapia: up to three fry batches per season (C01, C02, C03) on nursing, then linked grow-out
                    batches.
                  </span>
                )}
              </label>
              <label className="block text-sm font-medium text-slate-700">
                Batch name
                <input
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                />
              </label>
              {editing ? (
                <label className="block text-sm font-medium text-slate-700">
                  Code
                  <input
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono"
                    value={form.code}
                    onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
                    placeholder="e.g. C01"
                  />
                </label>
              ) : (
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
                  <p className="text-sm font-medium text-slate-700">Cycle code (assigned automatically)</p>
                  <p className="mt-1 font-mono text-base font-semibold text-slate-900">{form.code || '—'}</p>
                  <p className="mt-1 text-xs leading-relaxed text-slate-600">
                    Per pond: C01, C02, … with the lowest free number for this pond (gaps refill after a cycle is
                    deleted).
                  </p>
                </div>
              )}
              <label className="block text-sm font-medium text-slate-700">
                Start date
                <input
                  type="date"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                  value={form.start_date}
                  onChange={(e) => setForm((f) => ({ ...f, start_date: e.target.value }))}
                />
              </label>
              <label className="block text-sm font-medium text-slate-700">
                End date (optional — leave empty if open)
                <input
                  type="date"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                  value={form.end_date}
                  onChange={(e) => setForm((f) => ({ ...f, end_date: e.target.value }))}
                />
              </label>
              <label className="block text-sm font-medium text-slate-700">
                Sort order
                <input
                  type="number"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                  value={form.sort_order}
                  onChange={(e) => setForm((f) => ({ ...f, sort_order: e.target.value }))}
                />
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  className="rounded border-slate-300"
                  checked={form.is_active}
                  onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))}
                />
                Active
              </label>
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
              <button
                type="button"
                onClick={() => setModal(false)}
                className="rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void save()}
                className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
