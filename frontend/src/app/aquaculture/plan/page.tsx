'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { CalendarRange, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { AquaculturePageShell } from '@/components/aquaculture/AquaculturePageShell'
import { AQ_HERO_BTN_GHOST, AQ_HERO_BTN_PRIMARY, AQ_HERO_SELECT_BLOCK } from '@/components/aquaculture/AquacultureUi'
import { CompanyDateInput } from '@/components/CompanyDateInput'
import { useToast } from '@/components/Toast'
import { usePageMeta } from '@/hooks/usePageMeta'
import api from '@/lib/api'
import { extractErrorMessage } from '@/utils/errorHandler'
import { formatDateOnly, localDateISO } from '@/utils/date'

interface Pond {
  id: number
  name: string
  is_active?: boolean
}

interface ClearanceInfo {
  cleared: boolean
  earliest_clear_to_sell_on?: string | null
  blocking?: { clear_to_sell_on: string; expense_date: string }[]
}

interface LotRow {
  id: number
  pond_id: number
  pond_name: string
  title: string
  planned_start: string
  planned_end: string
  target_avg_weight_g: string | null
  target_weight_kg: string | null
  target_fish_count: number | null
  priority: number
  status: string
  depends_on_clearance: boolean
  notes: string
  sale_clearance?: ClearanceInfo | null
}

const STATUSES = [
  { id: 'planned', label: 'Planned' },
  { id: 'cleared', label: 'Cleared to sell' },
  { id: 'ready', label: 'Ready' },
  { id: 'partial', label: 'Partially sold' },
  { id: 'sold', label: 'Sold' },
  { id: 'deferred', label: 'Deferred' },
  { id: 'cancelled', label: 'Cancelled' },
] as const

type FormState = {
  pond_id: string
  title: string
  planned_start: string
  planned_end: string
  target_avg_weight_g: string
  target_weight_kg: string
  target_fish_count: string
  priority: string
  status: string
  depends_on_clearance: boolean
  notes: string
}

function emptyForm(pondId = ''): FormState {
  const today = localDateISO()
  return {
    pond_id: pondId,
    title: '',
    planned_start: today,
    planned_end: today,
    target_avg_weight_g: '',
    target_weight_kg: '',
    target_fish_count: '',
    priority: '100',
    status: 'planned',
    depends_on_clearance: true,
    notes: '',
  }
}

export default function AquacultureHarvestPlanPage() {
  usePageMeta('Harvest plan')
  const toast = useToast()
  const [ponds, setPonds] = useState<Pond[]>([])
  const [filterPond, setFilterPond] = useState('')
  const [rows, setRows] = useState<LotRow[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState<FormState>(emptyForm())
  const [editingId, setEditingId] = useState<number | null>(null)

  const activePonds = useMemo(() => ponds.filter((p) => p.is_active !== false), [ponds])

  const loadPonds = useCallback(async () => {
    try {
      const { data } = await api.get('/aquaculture/ponds/')
      setPonds(Array.isArray(data) ? data : data?.results ?? [])
    } catch (e) {
      toast.error(extractErrorMessage(e, 'Could not load ponds'))
    }
  }, [toast])

  const loadRows = useCallback(async () => {
    setLoading(true)
    try {
      const params: Record<string, string> = { include_clearance: '1' }
      if (filterPond) params.pond_id = filterPond
      const { data } = await api.get('/aquaculture/harvest-lot-plans/', { params })
      setRows(Array.isArray(data) ? data : [])
    } catch (e) {
      toast.error(extractErrorMessage(e, 'Could not load harvest plan'))
    } finally {
      setLoading(false)
    }
  }, [filterPond, toast])

  useEffect(() => {
    void loadPonds()
  }, [loadPonds])

  useEffect(() => {
    void loadRows()
  }, [loadRows])

  const startEdit = (r: LotRow) => {
    setEditingId(r.id)
    setForm({
      pond_id: String(r.pond_id),
      title: r.title || '',
      planned_start: r.planned_start.slice(0, 10),
      planned_end: r.planned_end.slice(0, 10),
      target_avg_weight_g: r.target_avg_weight_g ?? '',
      target_weight_kg: r.target_weight_kg ?? '',
      target_fish_count: r.target_fish_count != null ? String(r.target_fish_count) : '',
      priority: String(r.priority ?? 100),
      status: r.status,
      depends_on_clearance: r.depends_on_clearance,
      notes: r.notes || '',
    })
  }

  const resetForm = () => {
    setEditingId(null)
    setForm(emptyForm(filterPond))
  }

  const save = async () => {
    if (!form.pond_id || !form.planned_start || !form.planned_end) {
      toast.error('Pond and date window are required')
      return
    }
    setSaving(true)
    try {
      const body: Record<string, unknown> = {
        pond_id: Number(form.pond_id),
        title: form.title.trim(),
        planned_start: form.planned_start,
        planned_end: form.planned_end,
        status: form.status,
        depends_on_clearance: form.depends_on_clearance,
        notes: form.notes.trim(),
        priority: Number.parseInt(form.priority || '100', 10) || 100,
        target_avg_weight_g: form.target_avg_weight_g.trim() || null,
        target_weight_kg: form.target_weight_kg.trim() || null,
        target_fish_count: form.target_fish_count.trim()
          ? Number.parseInt(form.target_fish_count, 10)
          : null,
      }
      if (editingId != null) {
        await api.put(`/aquaculture/harvest-lot-plans/${editingId}/`, body)
        toast.success('Lot updated')
      } else {
        await api.post('/aquaculture/harvest-lot-plans/', body)
        toast.success('Lot planned')
      }
      resetForm()
      void loadRows()
    } catch (e) {
      toast.error(extractErrorMessage(e, 'Could not save lot'))
    } finally {
      setSaving(false)
    }
  }

  const remove = async (id: number) => {
    if (!window.confirm('Delete this planned lot?')) return
    try {
      await api.delete(`/aquaculture/harvest-lot-plans/${id}/`)
      toast.success('Deleted')
      if (editingId === id) resetForm()
      void loadRows()
    } catch (e) {
      toast.error(extractErrorMessage(e, 'Could not delete'))
    }
  }

  const inputCls =
    'mt-1 w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm'

  return (
    <AquaculturePageShell
      title="Harvest & production plan"
      titleIcon={CalendarRange}
      description="Sequence pond harvest lots. Clearance follows medicine withdrawal — sales stay blocked until clear."
      actions={
        <div className="flex flex-wrap gap-2">
          <Link href="/aquaculture/sales" className={AQ_HERO_BTN_GHOST}>
            Open sales
          </Link>
          <button type="button" className={AQ_HERO_BTN_GHOST} onClick={() => void loadRows()}>
            <RefreshCw className="h-4 w-4" aria-hidden />
            Refresh
          </button>
          <button type="button" className={AQ_HERO_BTN_PRIMARY} onClick={resetForm}>
            <Plus className="h-4 w-4" aria-hidden />
            New lot
          </button>
        </div>
      }
    >
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="text-muted-foreground">Filter pond</span>
          <select
            className={`${AQ_HERO_SELECT_BLOCK} mt-1`}
            value={filterPond}
            onChange={(e) => setFilterPond(e.target.value)}
          >
            <option value="">All ponds</option>
            {activePonds.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <section className="rounded-lg border border-border bg-card p-4">
          <h2 className="text-sm font-semibold">{editingId ? 'Edit lot' : 'Plan a lot'}</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="text-sm sm:col-span-2">
              Pond
              <select
                className={inputCls}
                value={form.pond_id}
                onChange={(e) => setForm((f) => ({ ...f, pond_id: e.target.value }))}
              >
                <option value="">Select…</option>
                {activePonds.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm sm:col-span-2">
              Title
              <input
                className={inputCls}
                placeholder="e.g. Digonta full harvest"
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              />
            </label>
            <label className="text-sm">
              Start
              <CompanyDateInput
                value={form.planned_start}
                onChange={(iso) => setForm((f) => ({ ...f, planned_start: iso }))}
                className={inputCls}
              />
            </label>
            <label className="text-sm">
              End
              <CompanyDateInput
                value={form.planned_end}
                onChange={(iso) => setForm((f) => ({ ...f, planned_end: iso }))}
                className={inputCls}
              />
            </label>
            <label className="text-sm">
              Target avg (g)
              <input
                className={inputCls}
                value={form.target_avg_weight_g}
                onChange={(e) => setForm((f) => ({ ...f, target_avg_weight_g: e.target.value }))}
              />
            </label>
            <label className="text-sm">
              Target kg
              <input
                className={inputCls}
                value={form.target_weight_kg}
                onChange={(e) => setForm((f) => ({ ...f, target_weight_kg: e.target.value }))}
              />
            </label>
            <label className="text-sm">
              Target pcs
              <input
                className={inputCls}
                value={form.target_fish_count}
                onChange={(e) => setForm((f) => ({ ...f, target_fish_count: e.target.value }))}
              />
            </label>
            <label className="text-sm">
              Priority (lower = earlier)
              <input
                className={inputCls}
                value={form.priority}
                onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value }))}
              />
            </label>
            <label className="text-sm sm:col-span-2">
              Status
              <select
                className={inputCls}
                value={form.status}
                onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
              >
                {STATUSES.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <input
                type="checkbox"
                checked={form.depends_on_clearance}
                onChange={(e) => setForm((f) => ({ ...f, depends_on_clearance: e.target.checked }))}
              />
              Depends on medicine withdrawal clearance
            </label>
            <label className="text-sm sm:col-span-2">
              Notes
              <textarea
                className={`${inputCls} min-h-[72px]`}
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              />
            </label>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" className={AQ_HERO_BTN_PRIMARY} disabled={saving} onClick={() => void save()}>
              {saving ? 'Saving…' : editingId ? 'Update' : 'Save lot'}
            </button>
            {editingId != null ? (
              <button type="button" className={AQ_HERO_BTN_GHOST} onClick={resetForm}>
                Cancel edit
              </button>
            ) : null}
          </div>
        </section>

        <section className="overflow-x-auto rounded-lg border border-border bg-card">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-border bg-muted/40 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Window</th>
                <th className="px-3 py-2">Pond / lot</th>
                <th className="px-3 py-2">Target</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Clearance</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">
                    Loading…
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">
                    No lots planned yet. Add Digonta / Mynuddin / Ashari windows here.
                  </td>
                </tr>
              ) : (
                rows.map((r) => {
                  const cl = r.sale_clearance
                  const blocked = r.depends_on_clearance && cl && !cl.cleared
                  return (
                    <tr key={r.id} className="border-b border-border/60 align-top">
                      <td className="px-3 py-2 whitespace-nowrap text-xs">
                        {formatDateOnly(r.planned_start)}
                        <br />→ {formatDateOnly(r.planned_end)}
                      </td>
                      <td className="px-3 py-2">
                        <div className="font-medium">{r.pond_name}</div>
                        <div className="text-xs text-muted-foreground">{r.title || '—'}</div>
                      </td>
                      <td className="px-3 py-2 text-xs tabular-nums">
                        {r.target_avg_weight_g ? `${r.target_avg_weight_g} g` : '—'}
                        {r.target_weight_kg ? ` · ${r.target_weight_kg} kg` : ''}
                        {r.target_fish_count != null ? ` · ${r.target_fish_count} pcs` : ''}
                      </td>
                      <td className="px-3 py-2 capitalize text-xs">{r.status}</td>
                      <td className="px-3 py-2 text-xs">
                        {!r.depends_on_clearance ? (
                          <span className="text-muted-foreground">N/A</span>
                        ) : blocked ? (
                          <span className="text-destructive">
                            Blocked until {cl?.earliest_clear_to_sell_on ?? '—'}
                          </span>
                        ) : (
                          <span className="text-emerald-700 dark:text-emerald-400">Cleared</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        <button
                          type="button"
                          className="mr-2 text-primary hover:underline"
                          onClick={() => startEdit(r)}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="text-destructive hover:underline"
                          onClick={() => void remove(r.id)}
                          aria-label="Delete"
                        >
                          <Trash2 className="inline h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </section>
      </div>
    </AquaculturePageShell>
  )
}
