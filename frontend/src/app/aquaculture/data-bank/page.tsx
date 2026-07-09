'use client'

import { CompanyDateInput } from '@/components/CompanyDateInput'

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
import {
  YearCloseReadinessPanel,
  type YearCloseReadinessAction,
} from '@/components/aquaculture/YearCloseReadinessPanel'

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
  is_ready?: boolean
  blockers?: string[]
  open_production_cycle_count?: number
  warehouse_stock_lines?: {
    item_id?: number
    item_name?: string
    quantity?: string
    unit?: string
    pos_category?: string
  }[]
  lease_continues_note?: string
  actions?: YearCloseReadinessAction[]
}

type ReadinessOverviewRow = {
  pond_id: number
  pond_name: string
  pond_code: string
  is_currently_locked: boolean
  is_ready: boolean | null
  blocker_count: number | null
  open_production_cycle_count?: number
  settlement_fish_count?: number
  settlement_bioasset_value?: string
  warehouse_line_count?: number
}

type ReadinessOverview = {
  as_of: string
  pond_count: number
  open_pond_count: number
  ready_pond_count: number
  not_ready_pond_count: number
  lease_continues_note?: string
  ponds: ReadinessOverviewRow[]
}

type StationClosePreview = {
  station_id: number
  station_name: string
  period_start: string
  period_end: string
  label: string
  pond_count: number
  open_pond_count: number
  ready_pond_count?: number
  not_ready_pond_count?: number
  lease_continues_note?: string
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
  const [readinessOverview, setReadinessOverview] = useState<ReadinessOverview | null>(null)
  const [expandedPreview, setExpandedPreview] = useState<ClosePreview | null>(null)
  const [expandedPreviewLoading, setExpandedPreviewLoading] = useState(false)
  const [returningWarehousePondId, setReturningWarehousePondId] = useState<number | null>(null)

  const refreshPondPreview = useCallback(
    async (pondId: number, endDate: string, startDate?: string) => {
      const params: Record<string, string> = {
        pond_id: String(pondId),
        period_end: endDate,
      }
      if (startDate?.trim()) params.period_start = startDate.trim()
      const { data: p } = await api.get<ClosePreview>(
        '/aquaculture/data-bank/preview-pond-close/',
        { params }
      )
      return p
    },
    []
  )

  const loadReadinessOverview = useCallback(
    async (endDate: string) => {
      if (!isAdmin || !endDate.trim()) {
        setReadinessOverview(null)
        return
      }
      try {
        const { data } = await api.get<ReadinessOverview>(
          '/aquaculture/data-bank/readiness-overview/',
          { params: { period_end: endDate } }
        )
        setReadinessOverview(data)
      } catch {
        setReadinessOverview(null)
      }
    },
    [isAdmin]
  )

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
    void loadReadinessOverview(periodEnd)
  }, [load, loadReadinessOverview, isClientReady, selectedCompany?.id, periodEnd])

  useEffect(() => {
    setExpandedPreview(null)
    if (!expandedPondId || !isAdmin || !periodEnd.trim()) return
    const bankRow = data?.ponds.find((p) => p.pond_id === expandedPondId)
    if (bankRow?.is_currently_locked) return
    if (expandedPondId === closePondId && preview) {
      setExpandedPreview(preview)
      return
    }
    let cancelled = false
    setExpandedPreviewLoading(true)
    void (async () => {
      try {
        const p = await refreshPondPreview(expandedPondId, periodEnd, periodStart)
        if (!cancelled) setExpandedPreview(p)
      } catch {
        if (!cancelled) setExpandedPreview(null)
      } finally {
        if (!cancelled) setExpandedPreviewLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [
    expandedPondId,
    isAdmin,
    periodEnd,
    periodStart,
    closePondId,
    preview,
    data,
    refreshPondPreview,
  ])

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

  const returnWarehouseForPond = async (pondId: number) => {
    const row = ponds.find((p) => p.pond_id === pondId)
    const name = row?.pond_name || `Pond ${pondId}`
    const lineCount =
      (pondId === closePondId ? preview?.warehouse_stock_lines?.length : undefined) ??
      expandedPreview?.warehouse_stock_lines?.length ??
      readinessOverview?.ponds.find((p) => p.pond_id === pondId)?.warehouse_line_count ??
      0
    const msg =
      `Return all feed/medicine from ${name} to the linked shop station?\n\n` +
      `${lineCount > 0 ? `${lineCount} item line(s) will move back to shop inventory.` : 'All on-hand pond warehouse stock will be returned.'}\n\n` +
      'This is not automatic on year close — you are confirming this action now.'
    if (!window.confirm(msg)) return
    setReturningWarehousePondId(pondId)
    try {
      const { data: res } = await api.post<{ message?: string }>(
        '/aquaculture/data-bank/return-warehouse/',
        { pond_id: pondId, memo: `Data Bank year-close prep — ${name}` }
      )
      toast.success(res.message || `${name}: warehouse returned to shop`)
      if (closePondId === pondId) {
        const p = await refreshPondPreview(pondId, periodEnd, periodStart)
        setPreview(p)
        if (!labelIsManual) setCloseLabel(p.label)
      }
      if (expandedPondId === pondId) {
        const p = await refreshPondPreview(pondId, periodEnd, periodStart)
        setExpandedPreview(p)
      }
      await loadReadinessOverview(periodEnd)
    } catch (e) {
      toast.error(extractErrorMessage(e, 'Warehouse return failed'))
    } finally {
      setReturningWarehousePondId(null)
    }
  }

  const runPondClose = async (pondId: number, pondName: string) => {
    if (!periodEnd.trim()) {
      toast.error('Choose a period end date')
      return
    }
    const msg = preview
      ? preview.is_ready === false
        ? `Cannot close ${pondName}: pond is not ready.\n\n${(preview.blockers || []).join('\n')}`
        : `Close ${pondName} for ${preview.label} (${preview.period_start} – ${preview.period_end})?\n\nThe pond is empty and ready for renovation. Operational data in this window will be archived (read-only). Land lease continues. New cycles and stocking should use dates after ${preview.period_end}.`
      : `Close ${pondName} through ${periodEnd}?\n\nThe pond must be empty before close. Operational data in the closed window will be archived. Land lease continues; prepare the pond for the next season with dates after the period end.`
    if (preview?.is_ready === false) {
      toast.error(msg.replace(/\n/g, ' '))
      return
    }
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
      await loadReadinessOverview(periodEnd)
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
      await loadReadinessOverview(stationPeriodEnd)
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
        className="rounded-xl border border-border bg-muted/50 p-5"
        aria-labelledby="data-bank-lock-meaning"
      >
        <h2 id="data-bank-lock-meaning" className="text-sm font-semibold text-foreground">
          When a pond or station is locked
        </h2>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-relaxed text-muted-foreground">
          <li>
            <strong className="font-medium text-foreground">Empty pond required</strong> — year
            close is allowed only when the pond has no live fish, no feed or medicine in pond
            warehouse, and no biological inventory (1581) balance. Open production cycles are
            ended automatically on close. This matches global practice: after harvest the pond
            is drained and prepared (drying, liming, predator removal) before the next stocking.
          </li>
          <li>
            <strong className="font-medium text-foreground">Land lease continues</strong> — rent
            and site costs on Site &amp; lease are not closed with the pond; lease keeps running
            through the empty renovation period until the next cycle starts.
          </li>
          <li>
            <strong className="font-medium text-foreground">Pond structure unchanged</strong> — name,
            code, dimensions, and station link from Site &amp; lease remain as recorded.
          </li>
          <li>
            <strong className="font-medium text-foreground">No internal data in the closed window</strong>{' '}
            — production cycles, stocking, feeds, and other dated entries within the close period
            are archived; they cannot be edited. Use{' '}
            <strong className="font-medium text-foreground">View archive</strong> for read-only
            management P&amp;L.
          </li>
          <li>
            <strong className="font-medium text-foreground">Next season</strong> — the farmer prepares
            the pond again and records new operational data dated{' '}
            <strong className="font-medium text-foreground">after</strong> the period end (new cycle,
            stocking readiness, etc.).
          </li>
          <li>
            <strong className="font-medium text-foreground">Station close</strong> — the same rules
            apply to every pond linked to that shop station in one step.
          </li>
        </ul>
      </section>

      {isAdmin ? (
        <>
        {readinessOverview && readinessOverview.open_pond_count > 0 ? (
          <section className="rounded-xl border border-primary/20 bg-primary/5 p-4">
            <h2 className="text-sm font-semibold text-foreground">Fleet readiness</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              As of {formatDateOnly(readinessOverview.as_of)}:{' '}
              <strong className="text-foreground">
                {readinessOverview.ready_pond_count} of {readinessOverview.open_pond_count}
              </strong>{' '}
              open pond{readinessOverview.open_pond_count === 1 ? '' : 's'} ready for year close.
              {readinessOverview.not_ready_pond_count > 0
                ? ` ${readinessOverview.not_ready_pond_count} still need preparation.`
                : ' All open ponds are empty.'}
            </p>
          </section>
        ) : null}
        <section className="rounded-xl border border-warning/30 bg-warning/10/60 p-5 shadow-sm">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-foreground">
            <Calendar className="h-5 w-5 text-warning-foreground" />
            Close one pond
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Pick the pond and its period end. The pond must be totally empty (harvested, warehouse
            cleared) and ready for renovation before close. Land lease continues on Site &amp; lease.
            Optional custom period start (otherwise fiscal year start from Settings).
          </p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <label className="block text-sm sm:col-span-2">
              <span className="font-medium text-foreground/85">Pond</span>
              <select
                value={closePondId}
                onChange={(e) =>
                  setClosePondId(e.target.value ? Number(e.target.value) : '')
                }
                className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm"
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
              <span className="font-medium text-foreground/85">Period end</span>
              <CompanyDateInput value={periodEnd} onChange={setPeriodEnd} className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm" />
            </label>
            <label className="block text-sm">
              <span className="font-medium text-foreground/85">Period start (optional)</span>
              <CompanyDateInput value={periodStart} onChange={setPeriodStart} className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm" />
            </label>
            <div className="sm:col-span-2 lg:col-span-4">
              {!labelIsManual ? (
                <div className="rounded-lg border border-border bg-muted/40 px-3 py-2.5">
                  <p className="text-sm font-medium text-foreground/85">Label (assigned automatically)</p>
                  <p className="mt-1 text-base font-semibold text-foreground">
                    {closeLabel ||
                      preview?.label ||
                      (closePondId && periodEnd ? 'Loading…' : 'Select pond and period end')}
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    Built from pond name and fiscal period (company Settings). Updates when pond or dates change.
                  </p>
                  {closePondId && periodEnd ? (
                    <button
                      type="button"
                      onClick={() => {
                        setLabelIsManual(true)
                        setCloseLabel(closeLabel || preview?.label || '')
                      }}
                      className="mt-2 text-xs font-medium text-primary underline hover:text-teal-950"
                    >
                      Customize label
                    </button>
                  ) : null}
                </div>
              ) : (
                <label className="block text-sm">
                  <span className="font-medium text-foreground/85">Label (custom)</span>
                  <input
                    type="text"
                    value={closeLabel}
                    onChange={(e) => setCloseLabel(e.target.value)}
                    placeholder={preview?.label ?? ''}
                    className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setLabelIsManual(false)
                      if (preview?.label) setCloseLabel(preview.label)
                    }}
                    className="mt-2 text-xs font-medium text-primary underline hover:text-teal-950"
                  >
                    Use automatic label
                  </button>
                </label>
              )}
            </div>
          </div>
          {preview && (
            <div className="mt-3 space-y-2">
              <p className="text-sm text-foreground/85">
                Preview: <strong>{preview.label}</strong> ({formatDateOnly(preview.period_start)} –{' '}
                {formatDateOnly(preview.period_end)})
              </p>
              <YearCloseReadinessPanel
              pondId={preview.pond_id}
              pondName={preview.pond_name}
              isReady={preview.is_ready}
              blockers={preview.blockers}
              actions={preview.actions}
              openProductionCycleCount={preview.open_production_cycle_count}
              leaseContinuesNote={preview.lease_continues_note}
              settlementFishCount={preview.settlement_fish_count}
              settlementWeightKg={preview.settlement_weight_kg}
              settlementBioassetValue={preview.settlement_bioasset_value}
              returningWarehouse={returningWarehousePondId === preview.pond_id}
              onReturnWarehouse={returnWarehouseForPond}
            />
            </div>
          )}
          <label className="mt-3 block text-sm">
            <span className="font-medium text-foreground/85">Notes (optional)</span>
            <textarea
              value={closeNotes}
              onChange={(e) => setCloseNotes(e.target.value)}
              rows={2}
              className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm"
            />
          </label>
          <button
            type="button"
            disabled={closing || !closePondId || preview?.is_ready === false}
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

        <section className="rounded-xl border border-primary/25 bg-accent/50 p-5 shadow-sm">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-foreground">
            <Store className="h-5 w-5 text-primary" />
            Close selected station
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Lock every pond linked to a shop station in one step. Each pond must be empty (same
            readiness rules as single-pond close). Land lease continues on Site &amp; lease.
          </p>
          {stationList.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">No active stations. Add sites under Stations first.</p>
          ) : (
            <>
              <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <label className="block text-sm sm:col-span-2">
                  <span className="font-medium text-foreground/85">Station</span>
                  <select
                    value={closeStationId}
                    onChange={(e) =>
                      setCloseStationId(e.target.value ? Number(e.target.value) : '')
                    }
                    className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm"
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
                  <span className="font-medium text-foreground/85">Period end</span>
                  <CompanyDateInput value={stationPeriodEnd} onChange={setStationPeriodEnd} className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm" />
                </label>
                <label className="block text-sm">
                  <span className="font-medium text-foreground/85">Period start (optional)</span>
                  <CompanyDateInput value={stationPeriodStart} onChange={setStationPeriodStart} className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm" />
                </label>
              </div>
              {stationPreview && (
                <div className="mt-3 space-y-2 text-sm text-foreground/85">
                  <p>
                    Preview: <strong>{stationPreview.label}</strong> ({formatDateOnly(stationPreview.period_start)} –{' '}
                    {formatDateOnly(stationPreview.period_end)})
                  </p>
                  <p>
                    {stationPreview.pond_count} linked pond{stationPreview.pond_count === 1 ? '' : 's'},{' '}
                    {stationPreview.open_pond_count} still open for this close
                    {stationPreview.ready_pond_count != null
                      ? ` · ${stationPreview.ready_pond_count} ready`
                      : ''}
                    {stationPreview.not_ready_pond_count != null &&
                    stationPreview.not_ready_pond_count > 0
                      ? ` · ${stationPreview.not_ready_pond_count} not ready`
                      : ''}
                    .
                  </p>
                  {stationPreview.lease_continues_note ? (
                    <p className="text-xs text-muted-foreground">{stationPreview.lease_continues_note}</p>
                  ) : null}
                  {stationPreview.ponds.length > 0 ? (
                    <ul className="list-inside list-disc text-muted-foreground">
                      {stationPreview.ponds.map((p) => (
                        <li key={p.pond_id}>
                          {p.pond_name} — {p.label}
                          {p.is_ready === false ? ' (not ready)' : p.is_ready ? ' (ready)' : ''}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              )}
              <label className="mt-3 block text-sm">
                <span className="font-medium text-foreground/85">Notes (optional)</span>
                <textarea
                  value={stationCloseNotes}
                  onChange={(e) => setStationCloseNotes(e.target.value)}
                  rows={2}
                  className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm"
                />
              </label>
              <button
                type="button"
                disabled={
                  closingStation ||
                  !closeStationId ||
                  (stationPreview != null && stationPreview.open_pond_count === 0) ||
                  (stationPreview != null &&
                    (stationPreview.not_ready_pond_count ?? 0) > 0)
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
        <p className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          Per-pond year close requires tenant Admin role.
        </p>
      )}

      <section className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold text-foreground">Ponds</h2>
          {!loading && ponds.length > 0 ? (
            <p className="text-sm text-muted-foreground">
              {ponds.length} pond{ponds.length === 1 ? '' : 's'} (same list as Site &amp; lease)
            </p>
          ) : null}
        </div>
        {loading && ponds.length === 0 ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : ponds.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border bg-muted/40 px-4 py-8 text-center text-sm text-muted-foreground">
            No ponds yet. Add ponds under Site &amp; lease, then close each one here when ready.
          </p>
        ) : (
          ponds.map((row) => {
            const open = expandedPondId === row.pond_id
            const latest = row.latest_close
            const overviewRow = readinessOverview?.ponds.find((p) => p.pond_id === row.pond_id)
            return (
              <div
                key={row.pond_id}
                className="overflow-hidden rounded-xl border border-border bg-white shadow-sm"
              >
                <button
                  type="button"
                  onClick={() => setExpandedPondId(open ? null : row.pond_id)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/40"
                >
                  {open ? (
                    <ChevronDown className="h-5 w-5 shrink-0 text-muted-foreground/70" />
                  ) : (
                    <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground/70" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/aquaculture/ponds/${row.pond_id}`}
                        onClick={(e) => e.stopPropagation()}
                        className="font-semibold text-primary hover:underline"
                      >
                        {row.pond_name}
                        {row.pond_code ? ` (${row.pond_code})` : ''}
                      </Link>
                      {!row.is_active ? (
                        <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                          Inactive
                        </span>
                      ) : null}
                      {row.is_currently_locked ? (
                        <span
                          className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-warning-foreground"
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
                        <span className="inline-flex items-center gap-1 rounded-full bg-accent px-2 py-0.5 text-xs font-medium text-primary">
                          <Eye className="h-3 w-3" /> Reference
                        </span>
                      ) : null}
                      {overviewRow && !overviewRow.is_currently_locked && overviewRow.is_ready != null ? (
                        overviewRow.is_ready ? (
                          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800">
                            Ready to close
                          </span>
                        ) : (
                          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">
                            {(overviewRow.blocker_count ?? 0) > 0
                              ? `${overviewRow.blocker_count} blocker(s)`
                              : 'Not ready'}
                          </span>
                        )
                      ) : null}
                    </div>
                    {latest ? (
                      <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                        <span>
                          Latest: {latest.label} · {formatDateOnly(latest.period_start)} –{' '}
                          {formatDateOnly(latest.period_end)}
                        </span>
                        <Link
                          href={archiveReportHref(latest)}
                          onClick={(e) => e.stopPropagation()}
                          className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
                        >
                          <FileBarChart className="h-3.5 w-3.5" />
                          View archive
                        </Link>
                      </div>
                    ) : (
                      <div className="text-sm text-muted-foreground">No year close yet</div>
                    )}
                  </div>
                </button>
                {open && (
                  <div className="border-t border-border/70 px-4 py-3 space-y-4">
                    {!row.is_currently_locked && isAdmin ? (
                      <div>
                        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          Year-close readiness
                        </h3>
                        {expandedPreviewLoading && !expandedPreview ? (
                          <p className="mt-2 text-sm text-muted-foreground">Loading readiness…</p>
                        ) : expandedPreview ? (
                          <div className="mt-2">
                            <YearCloseReadinessPanel
                              pondId={row.pond_id}
                              pondName={row.pond_name}
                              isReady={expandedPreview.is_ready}
                              blockers={expandedPreview.blockers}
                              actions={expandedPreview.actions}
                              openProductionCycleCount={expandedPreview.open_production_cycle_count}
                              leaseContinuesNote={expandedPreview.lease_continues_note}
                              settlementFishCount={expandedPreview.settlement_fish_count}
                              settlementWeightKg={expandedPreview.settlement_weight_kg}
                              settlementBioassetValue={expandedPreview.settlement_bioasset_value}
                              compact
                              returningWarehouse={returningWarehousePondId === row.pond_id}
                              onReturnWarehouse={returnWarehouseForPond}
                            />
                          </div>
                        ) : overviewRow && overviewRow.is_ready != null ? (
                          <p className="mt-2 text-sm text-muted-foreground">
                            {overviewRow.is_ready
                              ? 'Ready for year close.'
                              : `${overviewRow.blocker_count ?? 0} item(s) to clear before close.`}
                          </p>
                        ) : null}
                      </div>
                    ) : null}
                    {row.close_history.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No close history for this pond.</p>
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
                              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/70 bg-muted/50 px-3 py-2 text-sm"
                            >
                              <div>
                                <div className="font-medium text-foreground">{c.label}</div>
                                <div className="text-muted-foreground">
                                  {formatDateOnly(c.period_start)} – {formatDateOnly(c.period_end)}
                                  {c.closed_at
                                    ? ` · closed ${formatDateOnly(c.closed_at.slice(0, 10))}`
                                    : ''}
                                </div>
                                {(c.settlement_fish_count != null ||
                                  c.settlement_bioasset_value != null) && (
                                  <div className="mt-0.5 text-xs text-muted-foreground">
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
                                  className="inline-flex items-center gap-1 rounded border border-primary/25 bg-white px-2 py-1 text-xs font-medium text-primary hover:bg-accent"
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
                                    className="inline-flex items-center gap-1 rounded border border-warning/30 bg-warning/10 px-2 py-1 text-xs font-medium text-warning-foreground hover:bg-amber-100 disabled:opacity-50"
                                  >
                                    <LockOpen className="h-3 w-3" /> Unlock operations
                                  </button>
                                  {c.reference_access_enabled ? (
                                    <button
                                      type="button"
                                      disabled={busy}
                                      onClick={() => void relockClose(c)}
                                      className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-xs font-medium hover:bg-white disabled:opacity-50"
                                    >
                                      <Lock className="h-3 w-3" /> Re-lock
                                    </button>
                                  ) : (
                                    <button
                                      type="button"
                                      disabled={busy}
                                      onClick={() => void reopenClose(c)}
                                      className="inline-flex items-center gap-1 rounded border border-primary/25 px-2 py-1 text-xs font-medium text-primary hover:bg-accent disabled:opacity-50"
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
