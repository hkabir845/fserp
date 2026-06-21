'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Archive,
  Lock,
  LockOpen,
  RefreshCw,
  Calendar,
  ChevronDown,
  ChevronRight,
  Eye,
  Store,
  FileBarChart,
} from 'lucide-react'
import { AquaculturePageShell } from '@/components/aquaculture/AquaculturePageShell'
import { AQ_HERO_BTN_GHOST } from '@/components/aquaculture/AquacultureUi'
import { useToast } from '@/components/Toast'
import { usePageMeta } from '@/hooks/usePageMeta'
import { useCompany } from '@/contexts/CompanyContext'
import api from '@/lib/api'
import { extractErrorMessage } from '@/utils/errorHandler'
import { formatDateOnly } from '@/utils/date'
import { aquacultureArchivePlReportHref } from '@/lib/aquacultureDataBankArchive'

type PondClose = {
  id: number
  pond_id: number
  pond_name: string
  pond_code: string
  label: string
  period_start: string
  period_end: string
  is_data_locked: boolean
  reference_access_enabled: boolean
  closed_at: string | null
  notes: string
  reopen_reason: string
  settlement_fish_count: number | null
  settlement_weight_kg: string | null
  settlement_bioasset_value: string | null
}

type PondRow = {
  pond_id: number
  pond_name: string
  pond_code: string
  is_active: boolean
  is_currently_locked: boolean
  reference_access_enabled: boolean
  latest_close: PondClose | null
  close_history: PondClose[]
}

type DataBankPayload = {
  ponds: PondRow[]
  closes: PondClose[]
}

type PondListItem = {
  id: number
  name: string
  code: string
  sort_order: number
  is_active: boolean
}

type StationListItem = {
  id: number
  station_name: string
  is_active: boolean
}

function normalizeDataBankPayload(raw: unknown): DataBankPayload {
  if (!raw || typeof raw !== 'object') {
    return { ponds: [], closes: [] }
  }
  if (Array.isArray(raw)) {
    return { ponds: [], closes: [] }
  }
  const o = raw as DataBankPayload
  return {
    ponds: Array.isArray(o.ponds) ? o.ponds : [],
    closes: Array.isArray(o.closes) ? o.closes : [],
  }
}

/** Always show every pond from Site & lease; overlay Data Bank close status when present. */
function mergePondRows(bank: DataBankPayload, pondList: PondListItem[]): PondRow[] {
  const byId = new Map<number, PondRow>()
  for (const row of bank.ponds) {
    byId.set(row.pond_id, row)
  }
  const sorted = [...pondList].sort(
    (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.id - b.id
  )
  for (const p of sorted) {
    if (byId.has(p.id)) continue
    byId.set(p.id, {
      pond_id: p.id,
      pond_name: p.name,
      pond_code: p.code || '',
      is_active: p.is_active,
      is_currently_locked: false,
      reference_access_enabled: false,
      latest_close: null,
      close_history: [],
    })
  }
  const ordered: PondRow[] = []
  for (const p of sorted) {
    const row = byId.get(p.id)
    if (row) ordered.push(row)
  }
  for (const [id, row] of byId) {
    if (!sorted.some((p) => p.id === id)) ordered.push(row)
  }
  return ordered
}

type ClosePreview = {
  pond_id: number
  pond_name: string
  period_start: string
  period_end: string
  label: string
  settlement_fish_count?: number | null
  settlement_weight_kg?: string | null
  settlement_bioasset_value?: string | null
}

type StationClosePreview = {
  station_id: number
  station_name: string
  period_start: string
  period_end: string
  label: string
  pond_count: number
  open_pond_count: number
  ponds: ClosePreview[]
}

function isoToday(): string {
  return new Date().toISOString().slice(0, 10)
}

function readIsAdmin(): boolean {
  if (typeof window === 'undefined') return false
  try {
    const raw = localStorage.getItem('user')
    if (!raw) return false
    const u = JSON.parse(raw) as { role?: string }
    const role = (u.role || '').toLowerCase()
    return role === 'admin' || role === 'super_admin'
  } catch {
    return false
  }
}

export default function AquacultureDataBankPage() {
  const pageMeta = usePageMeta()
  const toast = useToast()
  const { selectedCompany, isClientReady } = useCompany()
  const isAdmin = useMemo(() => readIsAdmin(), [])
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<DataBankPayload | null>(null)
  const [pondList, setPondList] = useState<PondListItem[]>([])
  const [stationList, setStationList] = useState<StationListItem[]>([])
  const [expandedPondId, setExpandedPondId] = useState<number | null>(null)
  const [busyKey, setBusyKey] = useState<string | null>(null)

  const [closePondId, setClosePondId] = useState<number | ''>('')
  const [periodEnd, setPeriodEnd] = useState(isoToday())
  const [periodStart, setPeriodStart] = useState('')
  const [closeLabel, setCloseLabel] = useState('')
  const [labelIsManual, setLabelIsManual] = useState(false)
  const [closeNotes, setCloseNotes] = useState('')
  const [preview, setPreview] = useState<ClosePreview | null>(null)
  const [closing, setClosing] = useState(false)

  const [closeStationId, setCloseStationId] = useState<number | ''>('')
  const [stationPeriodEnd, setStationPeriodEnd] = useState(isoToday())
  const [stationPeriodStart, setStationPeriodStart] = useState('')
  const [stationCloseNotes, setStationCloseNotes] = useState('')
  const [stationPreview, setStationPreview] = useState<StationClosePreview | null>(null)
  const [closingStation, setClosingStation] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [bankRes, pondsRes, stationsRes] = await Promise.all([
        api.get<unknown>('/aquaculture/data-bank/'),
        api.get<PondListItem[]>('/aquaculture/ponds/'),
        api.get<StationListItem[]>('/stations/'),
      ])
      const payload = normalizeDataBankPayload(bankRes.data)
      const ponds = Array.isArray(pondsRes.data) ? pondsRes.data : []
      const stations = (Array.isArray(stationsRes.data) ? stationsRes.data : []).filter(
        (s) => s.is_active !== false
      )
      setData(payload)
      setPondList(ponds)
      setStationList(stations)
      const merged = mergePondRows(payload, ponds)
      if (merged.length > 0) {
        setClosePondId((prev) => {
          if (prev !== '' && merged.some((p) => p.pond_id === prev)) return prev
          const firstOpen = merged.find((p) => !p.is_currently_locked) ?? merged[0]
          return firstOpen.pond_id
        })
      }
      if (stations.length > 0) {
        setCloseStationId((prev) => {
          if (prev !== '' && stations.some((s) => s.id === prev)) return prev
          return stations[0].id
        })
      }
    } catch (e) {
      toast.error(extractErrorMessage(e, 'Failed to load Data Bank'))
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    document.title = 'Aquaculture Data Bank · FSERP'
  }, [])

  useEffect(() => {
    if (!isClientReady) return
    void load()
  }, [load, isClientReady, selectedCompany?.id])

  useEffect(() => {
    setLabelIsManual(false)
    setCloseLabel('')
    setPreview(null)
  }, [closePondId])

  useEffect(() => {
    if (!isAdmin || !closePondId || !periodEnd) {
      setPreview(null)
      if (!labelIsManual) setCloseLabel('')
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const params: Record<string, string> = {
          pond_id: String(closePondId),
          period_end: periodEnd,
        }
        if (periodStart.trim()) params.period_start = periodStart.trim()
        const { data: p } = await api.get<ClosePreview>(
          '/aquaculture/data-bank/preview-pond-close/',
          { params }
        )
        if (!cancelled) {
          setPreview(p)
          if (!labelIsManual) setCloseLabel(p.label)
        }
      } catch {
        if (!cancelled) {
          setPreview(null)
          if (!labelIsManual) setCloseLabel('')
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [closePondId, periodEnd, periodStart, isAdmin, labelIsManual])

  useEffect(() => {
    setStationPreview(null)
  }, [closeStationId])

  useEffect(() => {
    if (!isAdmin || !closeStationId || !stationPeriodEnd) {
      setStationPreview(null)
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const params: Record<string, string> = {
          station_id: String(closeStationId),
          period_end: stationPeriodEnd,
        }
        if (stationPeriodStart.trim()) params.period_start = stationPeriodStart.trim()
        const { data: p } = await api.get<StationClosePreview>(
          '/aquaculture/data-bank/preview-station-close/',
          { params }
        )
        if (!cancelled) setStationPreview(p)
      } catch {
        if (!cancelled) setStationPreview(null)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [closeStationId, stationPeriodEnd, stationPeriodStart, isAdmin])

  const runPondClose = async (pondId: number, pondName: string) => {
    if (!periodEnd.trim()) {
      toast.error('Choose a period end date')
      return
    }
    const msg = preview
      ? `Close ${pondName} for ${preview.label} (${preview.period_start} – ${preview.period_end})?\n\nOperational data in this window will be archived (read-only). Pond structure stays the same. New cycles and stocking should use dates after ${preview.period_end}.`
      : `Close ${pondName} through ${periodEnd}?\n\nOperational data in the closed window will be archived. Pond structure stays the same; prepare the pond for the next season with dates after the period end.`
    if (!window.confirm(msg)) return
    setClosing(true)
    try {
      const body: Record<string, unknown> = {
        pond_id: pondId,
        period_end: periodEnd,
        label: closeLabel.trim() || undefined,
        notes: closeNotes.trim() || undefined,
      }
      if (periodStart.trim()) body.period_start = periodStart.trim()
      const { data: res } = await api.post<PondClose & { message?: string }>(
        '/aquaculture/data-bank/close-pond/',
        body
      )
      toast.success(res.message || `${pondName} closed`)
      setCloseNotes('')
      setExpandedPondId(pondId)
      await load()
    } catch (e) {
      toast.error(extractErrorMessage(e, 'Year close failed'))
    } finally {
      setClosing(false)
    }
  }

  const runStationClose = async () => {
    if (!closeStationId) {
      toast.error('Choose a station')
      return
    }
    if (!stationPeriodEnd.trim()) {
      toast.error('Choose a period end date')
      return
    }
    const station = stationList.find((s) => s.id === closeStationId)
    const stationName = station?.station_name || `Station ${closeStationId}`
    const openCount = stationPreview?.open_pond_count ?? stationPreview?.pond_count
    const pondCount = stationPreview?.pond_count ?? 0
    if (pondCount === 0) {
      toast.error('No ponds are linked to this station')
      return
    }
    const msg = stationPreview
      ? `Close ${openCount ?? pondCount} pond(s) at ${stationName} for ${stationPreview.label} (${formatDateOnly(stationPreview.period_start)} – ${formatDateOnly(stationPreview.period_end)})?\n\nEach pond: structure unchanged; operational data in this window archived; new season data dated after ${formatDateOnly(stationPreview.period_end)}.`
      : `Close all ponds at ${stationName} through ${stationPeriodEnd}?\n\nEach pond: structure unchanged; closed-period data archived; farmers prepare for the next season with dates after the period end.`
    if (!window.confirm(msg)) return
    setClosingStation(true)
    try {
      const body: Record<string, unknown> = {
        station_id: closeStationId,
        period_end: stationPeriodEnd,
        notes: stationCloseNotes.trim() || undefined,
      }
      if (stationPeriodStart.trim()) body.period_start = stationPeriodStart.trim()
      const { data: res } = await api.post<{ message?: string; errors?: { pond_name: string; detail: string }[] }>(
        '/aquaculture/data-bank/close-station/',
        body
      )
      toast.success(res.message || `${stationName}: ponds closed`)
      if (res.errors?.length) {
        const skipped = res.errors
          .map((e) => `${e.pond_name || 'Pond'}: ${e.detail}`)
          .join('; ')
        toast.error(`Some ponds were skipped: ${skipped}`)
      }
      setStationCloseNotes('')
      await load()
    } catch (e) {
      toast.error(extractErrorMessage(e, 'Station close failed'))
    } finally {
      setClosingStation(false)
    }
  }

  const reopenClose = async (close: PondClose) => {
    const reason =
      window.prompt(`Reason for opening ${close.pond_name} for reference (optional):`) ?? ''
    const key = `${close.id}-reopen`
    setBusyKey(key)
    try {
      await api.post(`/aquaculture/data-bank/closes/${close.id}/reopen/`, { reason })
      toast.success(`${close.pond_name}: reference access enabled`)
      await load()
    } catch (e) {
      toast.error(extractErrorMessage(e, 'Reopen failed'))
    } finally {
      setBusyKey(null)
    }
  }

  const relockClose = async (close: PondClose) => {
    const key = `${close.id}-relock`
    setBusyKey(key)
    try {
      await api.post(`/aquaculture/data-bank/closes/${close.id}/relock/`)
      toast.success(`${close.pond_name}: locked again`)
      await load()
    } catch (e) {
      toast.error(extractErrorMessage(e, 'Re-lock failed'))
    } finally {
      setBusyKey(null)
    }
  }

  const unlockClose = async (close: PondClose) => {
    const ok = window.confirm(
      `Unlock ${close.pond_name} for operations?\n\n` +
        `Period ${formatDateOnly(close.period_start)} – ${formatDateOnly(close.period_end)} ` +
        'will stay in close history but edits and new records in that range will work again.'
    )
    if (!ok) return
    const key = `${close.id}-unlock`
    setBusyKey(key)
    try {
      await api.post(`/aquaculture/data-bank/closes/${close.id}/unlock/`)
      toast.success(`${close.pond_name}: open for operations`)
      await load()
    } catch (e) {
      toast.error(extractErrorMessage(e, 'Unlock failed'))
    } finally {
      setBusyKey(null)
    }
  }

  const ponds = useMemo(
    () => mergePondRows(data ?? { ponds: [], closes: [] }, pondList),
    [data, pondList]
  )

  const archiveReportHref = (close: PondClose) =>
    aquacultureArchivePlReportHref({
      pondId: close.pond_id,
      periodStart: close.period_start,
      periodEnd: close.period_end,
      label: close.label,
      closeId: close.id,
    })

  return (
    <AquaculturePageShell
      titleIcon={Archive}
      title={pageMeta.title}
      description={pageMeta.description}
      eyebrow={pageMeta.eyebrow}
      maxWidthClass="max-w-5xl"
      actions={
        <button type="button" onClick={() => void load()} className={AQ_HERO_BTN_GHOST}>
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden />
          Refresh
        </button>
      }
    >
      <div className="space-y-8">
      <section
        className="rounded-xl border border-slate-200 bg-slate-50/90 p-5"
        aria-labelledby="data-bank-lock-meaning"
      >
        <h2 id="data-bank-lock-meaning" className="text-sm font-semibold text-slate-900">
          When a pond or station is locked
        </h2>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-relaxed text-slate-600">
          <li>
            <strong className="font-medium text-slate-800">Pond structure unchanged</strong> — name,
            code, dimensions, and station link from Site &amp; lease remain as recorded.
          </li>
          <li>
            <strong className="font-medium text-slate-800">No internal data in the closed window</strong>{' '}
            — production cycles, stocking, feeds, and other dated entries within the close period
            are archived; they cannot be edited. Use{' '}
            <strong className="font-medium text-slate-800">View archive</strong> for read-only
            management P&amp;L.
          </li>
          <li>
            <strong className="font-medium text-slate-800">Next season</strong> — the farmer prepares
            the pond again and records new operational data dated{' '}
            <strong className="font-medium text-slate-800">after</strong> the period end (new cycle,
            stocking readiness, etc.).
          </li>
          <li>
            <strong className="font-medium text-slate-800">Station close</strong> — the same rules
            apply to every pond linked to that shop station in one step.
          </li>
        </ul>
      </section>

      {isAdmin ? (
        <>
        <section className="rounded-xl border border-amber-200 bg-amber-50/60 p-5 shadow-sm">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-900">
            <Calendar className="h-5 w-5 text-amber-700" />
            Close one pond
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Pick the pond and its period end. This archives operational data for that window and
            leaves pond structure unchanged; the farmer starts the next season with dates after the
            period end. Optional custom period start (otherwise fiscal year start from Settings).
          </p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <label className="block text-sm sm:col-span-2">
              <span className="font-medium text-slate-700">Pond</span>
              <select
                value={closePondId}
                onChange={(e) =>
                  setClosePondId(e.target.value ? Number(e.target.value) : '')
                }
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="">Select pond…</option>
                {ponds.map((p) => (
                  <option key={p.pond_id} value={p.pond_id}>
                    {p.pond_name}
                    {p.pond_code ? ` (${p.pond_code})` : ''}
                    {p.is_currently_locked ? ' — period closed' : ''}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="font-medium text-slate-700">Period end</span>
              <input
                type="date"
                value={periodEnd}
                onChange={(e) => setPeriodEnd(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </label>
            <label className="block text-sm">
              <span className="font-medium text-slate-700">Period start (optional)</span>
              <input
                type="date"
                value={periodStart}
                onChange={(e) => setPeriodStart(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </label>
            <div className="sm:col-span-2 lg:col-span-4">
              {!labelIsManual ? (
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
                  <p className="text-sm font-medium text-slate-700">Label (assigned automatically)</p>
                  <p className="mt-1 text-base font-semibold text-slate-900">
                    {closeLabel ||
                      preview?.label ||
                      (closePondId && periodEnd ? 'Loading…' : 'Select pond and period end')}
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-slate-600">
                    Built from pond name and fiscal period (company Settings). Updates when pond or dates change.
                  </p>
                  {closePondId && periodEnd ? (
                    <button
                      type="button"
                      onClick={() => {
                        setLabelIsManual(true)
                        setCloseLabel(closeLabel || preview?.label || '')
                      }}
                      className="mt-2 text-xs font-medium text-teal-800 underline hover:text-teal-950"
                    >
                      Customize label
                    </button>
                  ) : null}
                </div>
              ) : (
                <label className="block text-sm">
                  <span className="font-medium text-slate-700">Label (custom)</span>
                  <input
                    type="text"
                    value={closeLabel}
                    onChange={(e) => setCloseLabel(e.target.value)}
                    placeholder={preview?.label ?? ''}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setLabelIsManual(false)
                      if (preview?.label) setCloseLabel(preview.label)
                    }}
                    className="mt-2 text-xs font-medium text-teal-800 underline hover:text-teal-950"
                  >
                    Use automatic label
                  </button>
                </label>
              )}
            </div>
          </div>
          {preview && (
            <div className="mt-3 text-sm text-slate-700">
              <p>
                Preview: <strong>{preview.label}</strong> ({formatDateOnly(preview.period_start)} –{' '}
                {formatDateOnly(preview.period_end)})
              </p>
              {(preview.settlement_fish_count != null ||
                preview.settlement_bioasset_value != null) && (
                <p className="mt-1 text-xs text-slate-500">
                  Closing biomass to be recorded:{' '}
                  {preview.settlement_fish_count != null
                    ? `${preview.settlement_fish_count.toLocaleString()} fish`
                    : '—'}
                  {preview.settlement_weight_kg != null
                    ? ` · ${Number(preview.settlement_weight_kg).toLocaleString()} kg`
                    : ''}
                  {preview.settlement_bioasset_value != null
                    ? ` · bio-asset ${Number(preview.settlement_bioasset_value).toLocaleString()}`
                    : ''}
                </p>
              )}
            </div>
          )}
          <label className="mt-3 block text-sm">
            <span className="font-medium text-slate-700">Notes (optional)</span>
            <textarea
              value={closeNotes}
              onChange={(e) => setCloseNotes(e.target.value)}
              rows={2}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </label>
          <button
            type="button"
            disabled={closing || !closePondId}
            onClick={() => {
              const row = ponds.find((p) => p.pond_id === closePondId)
              if (row) void runPondClose(row.pond_id, row.pond_name)
            }}
            className="mt-4 inline-flex items-center gap-2 rounded-lg bg-amber-700 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-800 disabled:opacity-60"
          >
            <Lock className="h-4 w-4" />
            {closing ? 'Closing…' : 'Close selected pond'}
          </button>
        </section>

        <section className="rounded-xl border border-teal-200 bg-teal-50/50 p-5 shadow-sm">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-900">
            <Store className="h-5 w-5 text-teal-700" />
            Close selected station
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Lock every pond linked to a shop station (for example Premium Agro) in one step — same
            rules as a single-pond close: structure unchanged, closed-period data archived, each pond
            gets its own close record and label.
          </p>
          {stationList.length === 0 ? (
            <p className="mt-3 text-sm text-slate-500">No active stations. Add sites under Stations first.</p>
          ) : (
            <>
              <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <label className="block text-sm sm:col-span-2">
                  <span className="font-medium text-slate-700">Station</span>
                  <select
                    value={closeStationId}
                    onChange={(e) =>
                      setCloseStationId(e.target.value ? Number(e.target.value) : '')
                    }
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  >
                    <option value="">Select station…</option>
                    {stationList.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.station_name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-sm">
                  <span className="font-medium text-slate-700">Period end</span>
                  <input
                    type="date"
                    value={stationPeriodEnd}
                    onChange={(e) => setStationPeriodEnd(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </label>
                <label className="block text-sm">
                  <span className="font-medium text-slate-700">Period start (optional)</span>
                  <input
                    type="date"
                    value={stationPeriodStart}
                    onChange={(e) => setStationPeriodStart(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </label>
              </div>
              {stationPreview && (
                <div className="mt-3 space-y-2 text-sm text-slate-700">
                  <p>
                    Preview: <strong>{stationPreview.label}</strong> ({formatDateOnly(stationPreview.period_start)} –{' '}
                    {formatDateOnly(stationPreview.period_end)})
                  </p>
                  <p>
                    {stationPreview.pond_count} linked pond{stationPreview.pond_count === 1 ? '' : 's'},{' '}
                    {stationPreview.open_pond_count} still open for this close.
                  </p>
                  {stationPreview.ponds.length > 0 ? (
                    <ul className="list-inside list-disc text-slate-600">
                      {stationPreview.ponds.map((p) => (
                        <li key={p.pond_id}>
                          {p.pond_name} — {p.label}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              )}
              <label className="mt-3 block text-sm">
                <span className="font-medium text-slate-700">Notes (optional)</span>
                <textarea
                  value={stationCloseNotes}
                  onChange={(e) => setStationCloseNotes(e.target.value)}
                  rows={2}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </label>
              <button
                type="button"
                disabled={
                  closingStation ||
                  !closeStationId ||
                  (stationPreview != null && stationPreview.open_pond_count === 0)
                }
                onClick={() => void runStationClose()}
                className="mt-4 inline-flex items-center gap-2 rounded-lg bg-teal-800 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-900 disabled:opacity-60"
              >
                <Lock className="h-4 w-4" />
                {closingStation ? 'Closing…' : 'Close selected station'}
              </button>
            </>
          )}
        </section>
        </>
      ) : (
        <p className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
          Per-pond year close requires tenant Admin role.
        </p>
      )}

      <section className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold text-slate-900">Ponds</h2>
          {!loading && ponds.length > 0 ? (
            <p className="text-sm text-slate-500">
              {ponds.length} pond{ponds.length === 1 ? '' : 's'} (same list as Site &amp; lease)
            </p>
          ) : null}
        </div>
        {loading && ponds.length === 0 ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : ponds.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
            No ponds yet. Add ponds under Site &amp; lease, then close each one here when ready.
          </p>
        ) : (
          ponds.map((row) => {
            const open = expandedPondId === row.pond_id
            const latest = row.latest_close
            return (
              <div
                key={row.pond_id}
                className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"
              >
                <button
                  type="button"
                  onClick={() => setExpandedPondId(open ? null : row.pond_id)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50"
                >
                  {open ? (
                    <ChevronDown className="h-5 w-5 shrink-0 text-slate-400" />
                  ) : (
                    <ChevronRight className="h-5 w-5 shrink-0 text-slate-400" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/aquaculture/ponds/${row.pond_id}`}
                        onClick={(e) => e.stopPropagation()}
                        className="font-semibold text-teal-700 hover:underline"
                      >
                        {row.pond_name}
                        {row.pond_code ? ` (${row.pond_code})` : ''}
                      </Link>
                      {!row.is_active ? (
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                          Inactive
                        </span>
                      ) : null}
                      {row.is_currently_locked ? (
                        <span
                          className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900"
                          title="Closed period archived; pond structure unchanged; new operational data uses dates after the period end."
                        >
                          <Lock className="h-3 w-3" /> Period closed
                        </span>
                      ) : (
                        <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800">
                          Open for operations
                        </span>
                      )}
                      {row.reference_access_enabled ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-teal-50 px-2 py-0.5 text-xs font-medium text-teal-800">
                          <Eye className="h-3 w-3" /> Reference
                        </span>
                      ) : null}
                    </div>
                    {latest ? (
                      <div className="flex flex-wrap items-center gap-2 text-sm text-slate-500">
                        <span>
                          Latest: {latest.label} · {formatDateOnly(latest.period_start)} –{' '}
                          {formatDateOnly(latest.period_end)}
                        </span>
                        <Link
                          href={archiveReportHref(latest)}
                          onClick={(e) => e.stopPropagation()}
                          className="inline-flex items-center gap-1 font-medium text-teal-700 hover:underline"
                        >
                          <FileBarChart className="h-3.5 w-3.5" />
                          View archive
                        </Link>
                      </div>
                    ) : (
                      <div className="text-sm text-slate-500">No year close yet</div>
                    )}
                  </div>
                </button>
                {open && (
                  <div className="border-t border-slate-100 px-4 py-3">
                    {row.close_history.length === 0 ? (
                      <p className="text-sm text-slate-500">No close history for this pond.</p>
                    ) : (
                      <ul className="space-y-3">
                        {row.close_history.map((c) => {
                          const busy =
                            busyKey === `${c.id}-reopen` ||
                            busyKey === `${c.id}-relock` ||
                            busyKey === `${c.id}-unlock`
                          return (
                            <li
                              key={c.id}
                              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-100 bg-slate-50/80 px-3 py-2 text-sm"
                            >
                              <div>
                                <div className="font-medium text-slate-800">{c.label}</div>
                                <div className="text-slate-500">
                                  {formatDateOnly(c.period_start)} – {formatDateOnly(c.period_end)}
                                  {c.closed_at
                                    ? ` · closed ${formatDateOnly(c.closed_at.slice(0, 10))}`
                                    : ''}
                                </div>
                                {(c.settlement_fish_count != null ||
                                  c.settlement_bioasset_value != null) && (
                                  <div className="mt-0.5 text-xs text-slate-500">
                                    Closing biomass:{' '}
                                    {c.settlement_fish_count != null
                                      ? `${c.settlement_fish_count.toLocaleString()} fish`
                                      : '—'}
                                    {c.settlement_weight_kg != null
                                      ? ` · ${Number(c.settlement_weight_kg).toLocaleString()} kg`
                                      : ''}
                                    {c.settlement_bioasset_value != null
                                      ? ` · bio-asset ${Number(
                                          c.settlement_bioasset_value,
                                        ).toLocaleString()}`
                                      : ''}
                                  </div>
                                )}
                              </div>
                              <div className="flex flex-wrap items-center gap-2">
                                <Link
                                  href={archiveReportHref(c)}
                                  className="inline-flex items-center gap-1 rounded border border-teal-200 bg-white px-2 py-1 text-xs font-medium text-teal-800 hover:bg-teal-50"
                                >
                                  <FileBarChart className="h-3 w-3" />
                                  View archive
                                </Link>
                              {isAdmin && c.is_data_locked ? (
                                <>
                                  <button
                                    type="button"
                                    disabled={busy}
                                    onClick={() => void unlockClose(c)}
                                    className="inline-flex items-center gap-1 rounded border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-950 hover:bg-amber-100 disabled:opacity-50"
                                  >
                                    <LockOpen className="h-3 w-3" /> Unlock operations
                                  </button>
                                  {c.reference_access_enabled ? (
                                    <button
                                      type="button"
                                      disabled={busy}
                                      onClick={() => void relockClose(c)}
                                      className="inline-flex items-center gap-1 rounded border border-slate-200 px-2 py-1 text-xs font-medium hover:bg-white disabled:opacity-50"
                                    >
                                      <Lock className="h-3 w-3" /> Re-lock
                                    </button>
                                  ) : (
                                    <button
                                      type="button"
                                      disabled={busy}
                                      onClick={() => void reopenClose(c)}
                                      className="inline-flex items-center gap-1 rounded border border-teal-200 px-2 py-1 text-xs font-medium text-teal-800 hover:bg-teal-50 disabled:opacity-50"
                                    >
                                      <Eye className="h-3 w-3" /> Open reference
                                    </button>
                                  )}
                                </>
                              ) : null}
                              </div>
                            </li>
                          )
                        })}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            )
          })
        )}
      </section>
      </div>
    </AquaculturePageShell>
  )
}
