'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ClipboardList, Plus, RefreshCw, Trash2 } from 'lucide-react'
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

interface DayLogRow {
  id: number
  pond_id: number
  pond_name: string
  log_date: string
  do_morning_mg_l: string | null
  do_evening_mg_l: string | null
  ph: string | null
  temp_c: string | null
  ammonia_mg_l: string | null
  mortality_count: number | null
  mortality_kg: string | null
  feed_kg: string | null
  aerator_hours: string | null
  appetite: string
  weather: string
  notes: string
}

type FormState = {
  pond_id: string
  log_date: string
  do_morning_mg_l: string
  do_evening_mg_l: string
  ph: string
  temp_c: string
  ammonia_mg_l: string
  mortality_count: string
  mortality_kg: string
  feed_kg: string
  aerator_hours: string
  appetite: string
  weather: string
  notes: string
}

function emptyForm(pondId = ''): FormState {
  return {
    pond_id: pondId,
    log_date: localDateISO(),
    do_morning_mg_l: '',
    do_evening_mg_l: '',
    ph: '',
    temp_c: '',
    ammonia_mg_l: '',
    mortality_count: '',
    mortality_kg: '',
    feed_kg: '',
    aerator_hours: '',
    appetite: '',
    weather: '',
    notes: '',
  }
}

function optNum(v: string): string | undefined {
  const t = v.trim()
  return t === '' ? undefined : t
}

export default function AquacultureDayLogPage() {
  usePageMeta('Pond day log')
  const toast = useToast()
  const [ponds, setPonds] = useState<Pond[]>([])
  const [filterPond, setFilterPond] = useState('')
  const [rows, setRows] = useState<DayLogRow[]>([])
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
      const params: Record<string, string> = {}
      if (filterPond) params.pond_id = filterPond
      const { data } = await api.get('/aquaculture/day-logs/', { params })
      setRows(Array.isArray(data) ? data : [])
    } catch (e) {
      toast.error(extractErrorMessage(e, 'Could not load day logs'))
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

  const startEdit = (r: DayLogRow) => {
    setEditingId(r.id)
    setForm({
      pond_id: String(r.pond_id),
      log_date: r.log_date.slice(0, 10),
      do_morning_mg_l: r.do_morning_mg_l ?? '',
      do_evening_mg_l: r.do_evening_mg_l ?? '',
      ph: r.ph ?? '',
      temp_c: r.temp_c ?? '',
      ammonia_mg_l: r.ammonia_mg_l ?? '',
      mortality_count: r.mortality_count != null ? String(r.mortality_count) : '',
      mortality_kg: r.mortality_kg ?? '',
      feed_kg: r.feed_kg ?? '',
      aerator_hours: r.aerator_hours ?? '',
      appetite: r.appetite || '',
      weather: r.weather || '',
      notes: r.notes || '',
    })
  }

  const resetForm = () => {
    setEditingId(null)
    setForm(emptyForm(filterPond))
  }

  const save = async () => {
    if (!form.pond_id || !form.log_date) {
      toast.error('Pond and date are required')
      return
    }
    setSaving(true)
    try {
      const body: Record<string, unknown> = {
        pond_id: Number(form.pond_id),
        log_date: form.log_date,
        appetite: form.appetite.trim(),
        weather: form.weather.trim(),
        notes: form.notes.trim(),
      }
      for (const [k, v] of Object.entries({
        do_morning_mg_l: form.do_morning_mg_l,
        do_evening_mg_l: form.do_evening_mg_l,
        ph: form.ph,
        temp_c: form.temp_c,
        ammonia_mg_l: form.ammonia_mg_l,
        mortality_kg: form.mortality_kg,
        feed_kg: form.feed_kg,
        aerator_hours: form.aerator_hours,
      })) {
        const o = optNum(v)
        body[k] = o === undefined ? null : o
      }
      body.mortality_count =
        form.mortality_count.trim() === '' ? null : Number.parseInt(form.mortality_count, 10)

      if (editingId != null) {
        await api.put(`/aquaculture/day-logs/${editingId}/`, body)
        toast.success('Day log updated')
      } else {
        await api.post('/aquaculture/day-logs/', body)
        toast.success('Day log saved')
      }
      resetForm()
      void loadRows()
    } catch (e) {
      toast.error(extractErrorMessage(e, 'Could not save day log'))
    } finally {
      setSaving(false)
    }
  }

  const remove = async (id: number) => {
    if (!window.confirm('Delete this day log?')) return
    try {
      await api.delete(`/aquaculture/day-logs/${id}/`)
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
      title="Pond day log"
      titleIcon={ClipboardList}
      description="Daily water quality, mortality, feed, and aeration — one row per pond per day."
      actions={
        <div className="flex flex-wrap gap-2">
          <button type="button" className={AQ_HERO_BTN_GHOST} onClick={() => void loadRows()}>
            <RefreshCw className="h-4 w-4" aria-hidden />
            Refresh
          </button>
          <button type="button" className={AQ_HERO_BTN_PRIMARY} onClick={resetForm}>
            <Plus className="h-4 w-4" aria-hidden />
            New entry
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

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <section className="rounded-lg border border-border bg-card p-4">
          <h2 className="text-sm font-semibold">{editingId ? 'Edit day log' : 'Record today'}</h2>
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
            <label className="text-sm">
              Date
              <CompanyDateInput
                value={form.log_date}
                onChange={(iso) => setForm((f) => ({ ...f, log_date: iso }))}
                className={inputCls}
              />
            </label>
            <label className="text-sm">
              Appetite
              <select
                className={inputCls}
                value={form.appetite}
                onChange={(e) => setForm((f) => ({ ...f, appetite: e.target.value }))}
              >
                <option value="">—</option>
                <option value="normal">Normal</option>
                <option value="low">Low</option>
                <option value="none">None</option>
                <option value="leftover">Leftover</option>
              </select>
            </label>
            <label className="text-sm">
              DO morning (mg/L)
              <input
                className={inputCls}
                value={form.do_morning_mg_l}
                onChange={(e) => setForm((f) => ({ ...f, do_morning_mg_l: e.target.value }))}
              />
            </label>
            <label className="text-sm">
              DO evening (mg/L)
              <input
                className={inputCls}
                value={form.do_evening_mg_l}
                onChange={(e) => setForm((f) => ({ ...f, do_evening_mg_l: e.target.value }))}
              />
            </label>
            <label className="text-sm">
              pH
              <input className={inputCls} value={form.ph} onChange={(e) => setForm((f) => ({ ...f, ph: e.target.value }))} />
            </label>
            <label className="text-sm">
              Temp °C
              <input
                className={inputCls}
                value={form.temp_c}
                onChange={(e) => setForm((f) => ({ ...f, temp_c: e.target.value }))}
              />
            </label>
            <label className="text-sm">
              Ammonia (mg/L)
              <input
                className={inputCls}
                value={form.ammonia_mg_l}
                onChange={(e) => setForm((f) => ({ ...f, ammonia_mg_l: e.target.value }))}
              />
            </label>
            <label className="text-sm">
              Mortality (pcs)
              <input
                className={inputCls}
                value={form.mortality_count}
                onChange={(e) => setForm((f) => ({ ...f, mortality_count: e.target.value }))}
              />
            </label>
            <label className="text-sm">
              Mortality (kg)
              <input
                className={inputCls}
                value={form.mortality_kg}
                onChange={(e) => setForm((f) => ({ ...f, mortality_kg: e.target.value }))}
              />
            </label>
            <label className="text-sm">
              Feed (kg)
              <input
                className={inputCls}
                value={form.feed_kg}
                onChange={(e) => setForm((f) => ({ ...f, feed_kg: e.target.value }))}
              />
            </label>
            <label className="text-sm">
              Aerator (hours)
              <input
                className={inputCls}
                value={form.aerator_hours}
                onChange={(e) => setForm((f) => ({ ...f, aerator_hours: e.target.value }))}
              />
            </label>
            <label className="text-sm sm:col-span-2">
              Weather
              <input
                className={inputCls}
                value={form.weather}
                onChange={(e) => setForm((f) => ({ ...f, weather: e.target.value }))}
              />
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
              {saving ? 'Saving…' : editingId ? 'Update' : 'Save'}
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
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2">Pond</th>
                <th className="px-3 py-2">DO am/pm</th>
                <th className="px-3 py-2">Mort.</th>
                <th className="px-3 py-2">Feed</th>
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
                    No day logs yet.
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.id} className="border-b border-border/60">
                    <td className="px-3 py-2 whitespace-nowrap">{formatDateOnly(r.log_date)}</td>
                    <td className="px-3 py-2">{r.pond_name}</td>
                    <td className="px-3 py-2 tabular-nums">
                      {r.do_morning_mg_l ?? '—'} / {r.do_evening_mg_l ?? '—'}
                    </td>
                    <td className="px-3 py-2 tabular-nums">
                      {r.mortality_count ?? '—'}
                      {r.mortality_kg ? ` (${r.mortality_kg} kg)` : ''}
                    </td>
                    <td className="px-3 py-2 tabular-nums">{r.feed_kg ?? '—'}</td>
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
                ))
              )}
            </tbody>
          </table>
        </section>
      </div>
    </AquaculturePageShell>
  )
}
