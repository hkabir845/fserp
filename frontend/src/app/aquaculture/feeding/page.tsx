'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState, type ComponentType } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Gauge,
  HelpCircle,
  List,
  MapPin,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  UtensilsCrossed,
  XCircle,
} from 'lucide-react'
import { useToast } from '@/components/Toast'
import api from '@/lib/api'
import { extractErrorMessage } from '@/utils/errorHandler'
import { formatDateOnly } from '@/utils/date'
import { getCurrencySymbol } from '@/utils/currency'

interface Pond {
  id: number
  name: string
}

interface CycleRow {
  id: number
  name: string
}

/** Commercial sack sizes for translating kg → sacks for field teams. */
const SACK_SIZE_OPTIONS_KG = [25, 20, 10] as const

type AdviceStatusFilter = 'all' | 'pending_review' | 'approved' | 'applied' | 'cancelled'

const STATUS_TABS: { id: AdviceStatusFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'pending_review', label: 'Needs review' },
  { id: 'approved', label: 'Approved' },
  { id: 'applied', label: 'Applied' },
  { id: 'cancelled', label: 'Cancelled' },
]

interface FeedingAdviceRow {
  id: number
  pond_id: number
  pond_name: string
  pond_default_feed_item_id?: number | null
  pond_default_feed_item_name?: string
  production_cycle_id: number | null
  production_cycle_name: string
  target_date: string
  status: string
  status_label: string
  pond_status_snapshot: Record<string, unknown>
  ai_advice_text: string
  edited_advice_text: string
  effective_advice_text: string
  suggested_feed_kg: string | null
  sack_size_kg?: number | null
  approved_at: string | null
  approved_by_display: string
  applied_feed_kg: string | null
  applied_at: string | null
  applied_by_display: string
  linked_expense_id: number | null
  created_by_display: string
  created_at: string
}

function isoToday(): string {
  return new Date().toISOString().slice(0, 10)
}

/** Minimal **bold** rendering for advisory text (matches backend markdown-ish style). */
function AdviceRichText({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|_[^_]+_)/g)
  return (
    <span className="block whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
      {parts.map((p, i) => {
        if (p.startsWith('**') && p.endsWith('**')) {
          return (
            <strong key={i} className="font-semibold text-slate-900">
              {p.slice(2, -2)}
            </strong>
          )
        }
        if (p.startsWith('_') && p.endsWith('_') && p.length > 2) {
          return (
            <em key={i} className="text-slate-600">
              {p.slice(1, -1)}
            </em>
          )
        }
        return <span key={i}>{p}</span>
      })}
    </span>
  )
}

function stripMarkdownBold(s: string): string {
  return s
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .trim()
}

function isAllowedSackKg(n: number | null | undefined): n is (typeof SACK_SIZE_OPTIONS_KG)[number] {
  return n != null && (SACK_SIZE_OPTIONS_KG as readonly number[]).includes(n)
}

/** Sack count from a kg cell string; whole sacks (nearest integer). */
function kgCellToSackCount(kgCell: string, sackKg: number): string {
  if (kgCell === '—') return '—'
  const n = Number.parseFloat(kgCell)
  if (!Number.isFinite(n) || n <= 0) return '—'
  return String(Math.round(n / sackKg))
}

function totalKgToSackSummary(totalKgStr: string | null, sackKg: number | null): string | null {
  if (totalKgStr == null || sackKg == null || sackKg <= 0) return null
  const n = Number.parseFloat(totalKgStr)
  if (!Number.isFinite(n) || n <= 0) return null
  const sacks = Math.round(n / sackKg)
  return `≈ ${sacks} sacks (${sackKg} kg/sack)`
}

function feedKgToSackLabel(kgStr: string | null | undefined, sackKg: number | null): string | null {
  if (kgStr == null || String(kgStr).trim() === '' || !isAllowedSackKg(sackKg)) return null
  return totalKgToSackSummary(String(kgStr).trim(), sackKg)
}

/** Stored sack size or 25 kg default for crew-facing sack counts. */
function rowSackKg(r: FeedingAdviceRow | null): (typeof SACK_SIZE_OPTIONS_KG)[number] {
  if (!r) return 25
  return isAllowedSackKg(r.sack_size_kg) ? r.sack_size_kg : 25
}

function sacksStrFromKg(kgStr: string, sackKg: number): string {
  const n = Number.parseFloat(kgStr)
  if (!Number.isFinite(n) || n < 0) return ''
  if (n === 0) return '0'
  return String(Math.round(n / sackKg))
}

function kgStrFromSacks(sacksStr: string, sackKg: number): string {
  const n = Number.parseFloat(sacksStr)
  if (!Number.isFinite(n) || n < 0) return ''
  const sacks = Math.round(n)
  return (sacks * sackKg).toFixed(2)
}

/** Match backend feed_inventory_qty_from_kg for purchase estimates on this page. */
function feedInventoryQtyFromKgForEstimate(
  appliedKg: number,
  unit: string,
  contentWeightKg: string | null | undefined,
  sackSizeKg: number,
): number | null {
  const unitL = (unit || '').trim().toLowerCase()
  if (unitL === 'kg' || unitL === 'kilogram' || unitL === 'kilograms') {
    return appliedKg
  }
  let kgPer = contentWeightKg != null ? Number.parseFloat(String(contentWeightKg)) : Number.NaN
  if (!Number.isFinite(kgPer) || kgPer <= 0) {
    kgPer = sackSizeKg > 0 ? sackSizeKg : 25
  }
  if (kgPer <= 0) return null
  return appliedKg / kgPer
}

interface PondWarehouseItemRow {
  item_id: number
  item_name: string
  unit: string
  quantity: string
  pos_category: string
  reporting_category: string
  content_weight_kg: string | null
  unit_cost: string
}

interface MealPlanRow {
  mealIndex: number
  timePlain: string
  kg: string
}

/** Build per-meal table rows from snapshot + suggested total; split evenly if only total kg is known. */
function buildMealPlanRows(
  selected: FeedingAdviceRow | null,
  schedule: Record<string, unknown> | null,
  timeLines: string[],
): { rows: MealPlanRow[]; totalKg: string | null } {
  if (!selected) return { rows: [], totalKg: null }

  let perMeal: string[] = []
  if (schedule && Array.isArray(schedule.per_meal_feed_kg_approx)) {
    perMeal = (schedule.per_meal_feed_kg_approx as unknown[])
      .map((x) => String(x).trim())
      .filter((x) => x !== '')
  }

  const freq =
    typeof schedule?.frequency_meals_per_day === 'number' && schedule.frequency_meals_per_day > 0
      ? schedule.frequency_meals_per_day
      : 0

  const totalFromApi =
    schedule?.daily_feed_amount_kg != null && String(schedule.daily_feed_amount_kg).trim() !== ''
      ? String(schedule.daily_feed_amount_kg).trim()
      : selected.suggested_feed_kg

  const totalNum = totalFromApi != null ? Number.parseFloat(String(totalFromApi)) : NaN

  let nRows = Math.max(perMeal.length, timeLines.length, freq)
  if (perMeal.length === 0 && Number.isFinite(totalNum) && totalNum > 0 && nRows === 0) {
    nRows = 2
  }
  if (nRows === 0 && totalFromApi != null && Number.isFinite(totalNum) && totalNum > 0) {
    nRows = 1
    perMeal = [totalNum.toFixed(2)]
  } else if (perMeal.length === 0 && Number.isFinite(totalNum) && totalNum > 0 && nRows > 0) {
    const each = (totalNum / nRows).toFixed(2)
    perMeal = Array.from({ length: nRows }, () => each)
  }

  nRows = Math.max(nRows, perMeal.length, timeLines.length)
  if (nRows === 0) {
    return { rows: [], totalKg: null }
  }

  const rows: MealPlanRow[] = []
  for (let i = 0; i < nRows; i++) {
    const rawT = timeLines[i]
    rows.push({
      mealIndex: i + 1,
      timePlain:
        rawT != null && String(rawT).trim() !== '' ? stripMarkdownBold(String(rawT)) : '—',
      kg: perMeal[i] != null ? perMeal[i] : '—',
    })
  }

  let totalKg: string | null = null
  if (perMeal.length > 0) {
    const sum = perMeal.reduce((acc, x) => acc + (Number.parseFloat(x) || 0), 0)
    if (sum > 0) totalKg = sum.toFixed(2)
  }
  if (totalKg == null && totalFromApi != null) {
    const t = Number.parseFloat(String(totalFromApi))
    if (Number.isFinite(t) && t > 0) totalKg = t.toFixed(2)
  }

  return { rows, totalKg }
}

function statusPill(status: string) {
  const base = 'inline-flex rounded-full px-2 py-0.5 text-xs font-medium'
  if (status === 'pending_review') return `${base} bg-amber-100 text-amber-900`
  if (status === 'approved') return `${base} bg-sky-100 text-sky-900`
  if (status === 'applied') return `${base} bg-emerald-100 text-emerald-900`
  if (status === 'cancelled') return `${base} bg-slate-200 text-slate-700`
  return `${base} bg-slate-100 text-slate-800`
}

function snapshotWorldfish(snap: Record<string, unknown> | undefined): Record<string, unknown> | null {
  if (!snap || typeof snap !== 'object') return null
  const w = snap.worldfish
  return w && typeof w === 'object' ? (w as Record<string, unknown>) : null
}

function snapshotFeedingHeuristic(snap: Record<string, unknown> | undefined): Record<string, unknown> | null {
  if (!snap || typeof snap !== 'object') return null
  const h = snap.feeding_heuristic
  return h && typeof h === 'object' ? (h as Record<string, unknown>) : null
}

function snapshotFeedingSchedule(snap: Record<string, unknown> | undefined): Record<string, unknown> | null {
  if (!snap || typeof snap !== 'object') return null
  const fs = snap.feeding_schedule
  return fs && typeof fs === 'object' ? (fs as Record<string, unknown>) : null
}

/** Short label for “how often” in the list (avoid overflowing the table). */
function mealsPerDayShort(snap: Record<string, unknown> | undefined): string | null {
  const sched = snapshotFeedingSchedule(snap)
  const raw =
    (sched?.times_per_day as string | undefined) ||
    (snapshotWorldfish(snap)?.meals_hint as string | undefined)
  if (raw == null || String(raw).trim() === '') return null
  const s = String(raw).trim()
  return s.length > 26 ? `${s.slice(0, 24)}…` : s
}

/** Compact dose line for list rows: kg target and/or % BW/day from snapshot. */
function feedingDoseListLabel(r: FeedingAdviceRow): string {
  const snap = r.pond_status_snapshot as Record<string, unknown> | undefined
  const wf = snapshotWorldfish(snap)
  const heur = snapshotFeedingHeuristic(snap)
  const pctRaw =
    (heur?.body_weight_percent_per_day as string | undefined) ??
    (wf?.chosen_bw_pct_per_day as string | undefined)
  const pct = pctRaw != null && String(pctRaw).trim() !== '' ? String(pctRaw).trim() : null
  const meals = mealsPerDayShort(snap)

  const sackKg = rowSackKg(r)

  if (r.status === 'applied' && r.applied_feed_kg) {
    const sk = feedKgToSackLabel(r.applied_feed_kg, sackKg)
    const base = sk ? `${r.applied_feed_kg} kg applied (${sk})` : `${r.applied_feed_kg} kg applied`
    const mid = pct ? `${base} · ${pct}% BW/d` : base
    return meals ? `${mid} · ${meals}` : mid
  }
  if (r.suggested_feed_kg) {
    const sk = feedKgToSackLabel(r.suggested_feed_kg, sackKg)
    const base = sk ? `${r.suggested_feed_kg} kg (${sk})` : `${r.suggested_feed_kg} kg`
    const mid = pct ? `${base} · ${pct}% BW/d` : base
    return meals ? `${mid} · ${meals}` : mid
  }
  if (pct) {
    const mid = `${pct}% BW/d`
    return meals ? `${mid} · ${meals}` : mid
  }
  return meals ?? '—'
}

function PipelineStatCard(props: {
  title: string
  value: string | number
  sub: string
  icon: ComponentType<{ className?: string; strokeWidth?: number | string }>
  tone: 'amber' | 'sky' | 'emerald' | 'slate'
}) {
  const { title, value, sub, icon: Icon, tone } = props
  const ring =
    tone === 'amber'
      ? 'ring-amber-500/15'
      : tone === 'sky'
        ? 'ring-sky-500/15'
        : tone === 'emerald'
          ? 'ring-emerald-500/15'
          : 'ring-slate-200/80'
  const iconBg =
    tone === 'amber'
      ? 'bg-amber-50 text-amber-800'
      : tone === 'sky'
        ? 'bg-sky-50 text-sky-800'
        : tone === 'emerald'
          ? 'bg-emerald-50 text-emerald-800'
          : 'bg-slate-100 text-slate-700'
  return (
    <div className={`rounded-2xl border border-slate-200/90 bg-white p-4 shadow-sm ring-1 ${ring}`}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{title}</p>
        <div className={`rounded-lg p-1.5 ${iconBg}`}>
          <Icon className="h-4 w-4" strokeWidth={1.75} aria-hidden />
        </div>
      </div>
      <p className="mt-2 text-xl font-bold tabular-nums tracking-tight text-slate-900">{value}</p>
      <p className="mt-1 text-xs leading-relaxed text-slate-500">{sub}</p>
    </div>
  )
}

/** Short horizontal guide so new users know the page flow before scrolling. */
function PageFlowStrip() {
  const steps = [
    { n: 1, title: 'Generate', sub: 'Pick pond & date' },
    { n: 2, title: 'Review', sub: 'Edit kg / text' },
    { n: 3, title: 'Approve', sub: 'Locks the plan' },
    { n: 4, title: 'Apply', sub: 'Stock or expense' },
  ] as const
  return (
    <div
      className="rounded-2xl border border-teal-100 bg-gradient-to-r from-teal-50/80 via-white to-slate-50/90 p-4 shadow-sm ring-1 ring-teal-500/10"
      aria-label="How feeding advice works on this page"
    >
      <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-teal-900">
        <HelpCircle className="h-4 w-4 shrink-0 text-teal-700" aria-hidden />
        Workflow on this page
      </div>
      <ol className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 lg:divide-x lg:divide-teal-100">
        {steps.map((s) => (
          <li key={s.n} className="flex min-w-0 gap-3 lg:px-3 first:lg:pl-0 last:lg:pr-0">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-teal-600 text-xs font-bold text-white shadow-sm">
              {s.n}
            </span>
            <div className="min-w-0 pt-0.5">
              <p className="text-sm font-semibold text-slate-900">{s.title}</p>
              <p className="text-xs leading-snug text-slate-600">{s.sub}</p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  )
}

function WorkflowRail({ status }: { status: string }) {
  if (status === 'cancelled') {
    return (
      <div
        className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-slate-100/80 px-3 py-2.5"
        aria-label="Advice cancelled"
      >
        <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-600 px-2.5 py-1 text-xs font-semibold text-white">
          <XCircle className="h-3.5 w-3.5 shrink-0" aria-hidden />
          Cancelled (not executed)
        </span>
      </div>
    )
  }
  const order = ['pending_review', 'approved', 'applied'] as const
  const idx = order.indexOf(status as (typeof order)[number])
  const labels = ['Draft · review', 'Approved', 'Applied to pond'] as const
  return (
    <div
      className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-100 bg-slate-50/90 px-3 py-2.5"
      role="list"
      aria-label="Advice workflow"
    >
      {labels.map((label, i) => {
        const done = idx > i
        const current = idx === i
        return (
          <div key={label} className="flex items-center gap-2" role="listitem">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${
                done
                  ? 'bg-emerald-100 text-emerald-900'
                  : current
                    ? 'bg-teal-600 text-white shadow-sm'
                    : 'bg-white text-slate-500 ring-1 ring-slate-200'
              }`}
            >
              {done ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden /> : null}
              {label}
            </span>
            {i < labels.length - 1 ? <ChevronRight className="h-3.5 w-3.5 text-slate-300" aria-hidden /> : null}
          </div>
        )
      })}
    </div>
  )
}

export default function AquacultureFeedingPage() {
  const toast = useToast()
  const [ponds, setPonds] = useState<Pond[]>([])
  const [cycles, setCycles] = useState<CycleRow[]>([])
  const [rows, setRows] = useState<FeedingAdviceRow[]>([])
  const [filterPond, setFilterPond] = useState('')
  const [filterStatus, setFilterStatus] = useState<AdviceStatusFilter>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [currency, setCurrency] = useState('BDT')
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<FeedingAdviceRow | null>(null)

  const [genPond, setGenPond] = useState('')
  const [genCycle, setGenCycle] = useState('')
  const [genDate, setGenDate] = useState(isoToday)
  const [genTemp, setGenTemp] = useState('')
  const [genSackKg, setGenSackKg] = useState<(typeof SACK_SIZE_OPTIONS_KG)[number]>(25)
  const [genBusy, setGenBusy] = useState(false)

  const [editText, setEditText] = useState('')
  const [editKg, setEditKg] = useState('')
  const [editSackSize, setEditSackSize] = useState<string>('25')
  const [editSacks, setEditSacks] = useState('')
  const [saveBusy, setSaveBusy] = useState(false)
  const [sackSaveBusy, setSackSaveBusy] = useState(false)

  const [applyKg, setApplyKg] = useState('')
  const [applySacks, setApplySacks] = useState('')
  const [applyCreateExp, setApplyCreateExp] = useState(false)
  const [applyConsumePond, setApplyConsumePond] = useState(true)
  const [applyFeedItemId, setApplyFeedItemId] = useState('')
  const [applyManualPurchaseAmount, setApplyManualPurchaseAmount] = useState(false)
  const [pondWhStock, setPondWhStock] = useState<PondWarehouseItemRow[]>([])
  const [whStockLoading, setWhStockLoading] = useState(false)
  const [applyAmount, setApplyAmount] = useState('')
  const [applyVendor, setApplyVendor] = useState('')
  const [applyMemo, setApplyMemo] = useState('')
  const [applyBusy, setApplyBusy] = useState(false)
  const [deleteBusy, setDeleteBusy] = useState(false)

  const loadPonds = useCallback(async () => {
    try {
      const { data } = await api.get<Pond[]>('/aquaculture/ponds/')
      setPonds(Array.isArray(data) ? data : [])
    } catch (e) {
      toast.error(extractErrorMessage(e, 'Could not load ponds'))
    }
  }, [toast])

  const loadList = useCallback(async () => {
    setLoading(true)
    try {
      const params: Record<string, string> = {}
      if (filterPond) params.pond_id = filterPond
      if (filterStatus !== 'all') params.status = filterStatus
      const { data } = await api.get<FeedingAdviceRow[]>('/aquaculture/feeding-advice/', {
        params: Object.keys(params).length ? params : undefined,
      })
      const list = Array.isArray(data) ? data : []
      setRows(list)
      setSelected((prev) => {
        if (!prev) return null
        const found = list.find((x) => x.id === prev.id)
        return found ?? null
      })
    } catch (e) {
      toast.error(extractErrorMessage(e, 'Could not load feeding advice'))
    } finally {
      setLoading(false)
    }
  }, [toast, filterPond, filterStatus])

  const loadCurrency = useCallback(async () => {
    try {
      const { data } = await api.get<Record<string, unknown>>('/companies/current/')
      setCurrency(String(data?.currency || 'BDT').slice(0, 3))
    } catch {
      setCurrency('BDT')
    }
  }, [])

  useEffect(() => {
    void loadPonds()
    void loadCurrency()
  }, [loadPonds, loadCurrency])

  useEffect(() => {
    void loadList()
  }, [loadList])

  useEffect(() => {
    const pid = genPond
    if (!pid) {
      setCycles([])
      setGenCycle('')
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
  }, [genPond])

  useEffect(() => {
    if (!selected) {
      setEditText('')
      setEditKg('')
      setEditSackSize('25')
      setEditSacks('')
      setApplyKg('')
      setApplySacks('')
      return
    }
    setEditText(selected.edited_advice_text || '')
    setEditKg(selected.suggested_feed_kg ?? '')
    const sk = rowSackKg(selected)
    setEditSackSize(String(sk))
    setEditSacks(sacksStrFromKg(selected.suggested_feed_kg ?? '', sk))
    setApplyKg(selected.suggested_feed_kg ?? '')
    setApplySacks(sacksStrFromKg(selected.suggested_feed_kg ?? '', sk))
    setApplyFeedItemId('')
    setApplyManualPurchaseAmount(false)
  }, [selected])

  useEffect(() => {
    if (applyCreateExp) {
      setApplyConsumePond(false)
      return
    }
    if (!selected || selected.status !== 'approved') {
      return
    }
    if (selected.pond_default_feed_item_id) {
      setApplyConsumePond(true)
      return
    }
    if (whStockLoading) {
      setApplyConsumePond(false)
      return
    }
    setApplyConsumePond(pondWhStock.length > 0)
  }, [
    applyCreateExp,
    selected?.id,
    selected?.status,
    selected?.pond_default_feed_item_id,
    pondWhStock.length,
    whStockLoading,
  ])

  useEffect(() => {
    if (!selected || selected.status !== 'approved') {
      setPondWhStock([])
      setWhStockLoading(false)
      return
    }
    const pid = selected.pond_id
    let cancelled = false
    setWhStockLoading(true)
    void (async () => {
      try {
        const { data } = await api.get<{ items?: PondWarehouseItemRow[] }>(
          `/aquaculture/ponds/${pid}/warehouse-stock/`,
        )
        if (!cancelled) {
          setPondWhStock(Array.isArray(data?.items) ? data.items : [])
        }
      } catch {
        if (!cancelled) setPondWhStock([])
      } finally {
        if (!cancelled) setWhStockLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [selected?.id, selected?.status, selected?.pond_id])

  const displayRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return rows
    return rows.filter(
      (r) =>
        r.pond_name.toLowerCase().includes(q) ||
        (r.production_cycle_name || '').toLowerCase().includes(q) ||
        r.status_label.toLowerCase().includes(q) ||
        String(r.id).includes(q),
    )
  }, [rows, searchQuery])

  const pipelineStats = useMemo(() => {
    const pending = rows.filter((r) => r.status === 'pending_review').length
    const approved = rows.filter((r) => r.status === 'approved').length
    const applied = rows.filter((r) => r.status === 'applied').length
    const cancelled = rows.filter((r) => r.status === 'cancelled').length
    return { pending, approved, applied, cancelled, total: rows.length }
  }, [rows])

  const statusTabCounts = useMemo(
    (): Record<AdviceStatusFilter, number> => ({
      all: rows.length,
      pending_review: pipelineStats.pending,
      approved: pipelineStats.approved,
      applied: pipelineStats.applied,
      cancelled: pipelineStats.cancelled,
    }),
    [rows.length, pipelineStats],
  )

  const selectedHiddenBySearch = Boolean(
    selected && !displayRows.some((r) => r.id === selected.id),
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && selected) {
        setSelected(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selected])

  const sym = getCurrencySymbol(currency)

  const worldfishBlock = useMemo(() => {
    const snap = selected?.pond_status_snapshot as Record<string, unknown> | undefined
    return snapshotWorldfish(snap)
  }, [selected])

  const feedingHeuristicBlock = useMemo(() => {
    const snap = selected?.pond_status_snapshot as Record<string, unknown> | undefined
    return snapshotFeedingHeuristic(snap)
  }, [selected])

  const feedingScheduleBlock = useMemo(() => {
    const snap = selected?.pond_status_snapshot as Record<string, unknown> | undefined
    return snapshotFeedingSchedule(snap)
  }, [selected])

  const feedingScheduleBullets = useMemo((): string[] => {
    const raw = feedingScheduleBlock?.rationale_bullets
    if (!Array.isArray(raw)) return []
    return raw.filter((x): x is string => typeof x === 'string' && x.trim() !== '')
  }, [feedingScheduleBlock])

  const recommendedFeedingTimes = useMemo((): string[] => {
    const raw = feedingScheduleBlock?.recommended_feeding_times
    if (!Array.isArray(raw)) return []
    return raw.filter((x): x is string => typeof x === 'string' && x.trim() !== '')
  }, [feedingScheduleBlock])

  const mealPlan = useMemo(
    () => buildMealPlanRows(selected, feedingScheduleBlock, recommendedFeedingTimes),
    [selected, feedingScheduleBlock, recommendedFeedingTimes],
  )

  const sackKgForDisplay = useMemo((): number => {
    const n = Number.parseInt(editSackSize, 10)
    if (isAllowedSackKg(n)) return n
    return rowSackKg(selected)
  }, [editSackSize, selected])

  const purchaseAmountEstimateLabel = useMemo(() => {
    if (!applyCreateExp || applyManualPurchaseAmount) return null
    const kgStr = applyKg.trim() || selected?.suggested_feed_kg?.trim() || ''
    const kg = Number.parseFloat(kgStr)
    if (!Number.isFinite(kg) || kg <= 0) {
      return 'Set feed weight (kg) to see an estimate.'
    }
    const pickId =
      applyFeedItemId.trim() !== ''
        ? Number.parseInt(applyFeedItemId, 10)
        : selected?.pond_default_feed_item_id ?? null
    if (pickId == null || !Number.isFinite(pickId)) {
      return 'Pick a feed product or set the pond default feed for costing.'
    }
    const row = pondWhStock.find((r) => r.item_id === pickId)
    if (!row) {
      return 'Amount is computed on apply from the item’s inventory cost (or unit price) × quantity for this kg.'
    }
    const uc = Number.parseFloat(row.unit_cost)
    const qty = feedInventoryQtyFromKgForEstimate(kg, row.unit, row.content_weight_kg, sackKgForDisplay)
    if (qty != null && Number.isFinite(uc) && uc > 0) {
      return `${sym}${(qty * uc).toFixed(2)} (inventory unit cost × qty — same rule as the server)`
    }
    return 'Check the item’s unit, content weight, and cost — the server will still try to compute on apply.'
  }, [
    applyCreateExp,
    applyFeedItemId,
    applyKg,
    applyManualPurchaseAmount,
    pondWhStock,
    sackKgForDisplay,
    selected?.pond_default_feed_item_id,
    selected?.suggested_feed_kg,
    sym,
  ])

  const applyPlanBlockedByWarehouseLoad = Boolean(
    selected?.status === 'approved' &&
      !applyCreateExp &&
      applyConsumePond &&
      !selected?.pond_default_feed_item_id &&
      whStockLoading,
  )

  const onSackSizeSelectChange = (v: string) => {
    setEditSackSize(v)
    const sk = Number.parseInt(v, 10)
    if (!isAllowedSackKg(sk)) return
    setEditSacks(sacksStrFromKg(editKg, sk))
    if (selected?.status === 'approved') setApplySacks(sacksStrFromKg(applyKg, sk))
  }

  const onEditKgChange = (v: string) => {
    setEditKg(v)
    setEditSacks(sacksStrFromKg(v, sackKgForDisplay))
  }

  const onEditSacksChange = (v: string) => {
    const t = v.trim()
    if (t === '') {
      setEditSacks('')
      setEditKg('')
      return
    }
    const n = Number.parseFloat(t)
    if (!Number.isFinite(n) || n < 0) {
      setEditSacks(v)
      return
    }
    const sacks = Math.round(n)
    setEditSacks(String(sacks))
    setEditKg(kgStrFromSacks(String(sacks), sackKgForDisplay))
  }

  const onApplyKgChange = (v: string) => {
    setApplyKg(v)
    setApplySacks(sacksStrFromKg(v, sackKgForDisplay))
  }

  const onApplySacksChange = (v: string) => {
    const t = v.trim()
    if (t === '') {
      setApplySacks('')
      setApplyKg('')
      return
    }
    const n = Number.parseFloat(t)
    if (!Number.isFinite(n) || n < 0) {
      setApplySacks(v)
      return
    }
    const sacks = Math.round(n)
    setApplySacks(String(sacks))
    setApplyKg(kgStrFromSacks(String(sacks), sackKgForDisplay))
  }

  const sackSelect = (
    <label className="block text-xs font-medium text-slate-700">
      Sack size (kg per sack)
      <select
        className="mt-1 w-full max-w-xs rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
        value={editSackSize}
        onChange={(e) => onSackSizeSelectChange(e.target.value)}
      >
        {SACK_SIZE_OPTIONS_KG.map((kg) => (
          <option key={kg} value={String(kg)}>
            {kg} kg / sack
          </option>
        ))}
      </select>
      <span className="mt-1 block text-[11px] font-normal text-slate-500">
        Workers apply feed by sack count; kg stays the system of record.
      </span>
    </label>
  )

  const generate = async () => {
    if (!genPond) {
      toast.error('Select a pond')
      return
    }
    setGenBusy(true)
    try {
      const body: Record<string, unknown> = {
        pond_id: parseInt(genPond, 10),
        target_date: genDate,
        sack_size_kg: genSackKg,
      }
      if (genCycle) body.production_cycle_id = parseInt(genCycle, 10)
      if (genTemp.trim() !== '') {
        const t = Number(genTemp)
        if (!Number.isFinite(t)) {
          toast.error('Water temperature must be a number (°C)')
          setGenBusy(false)
          return
        }
        body.water_temp_c = t
      }
      const { data } = await api.post<FeedingAdviceRow>('/aquaculture/feeding-advice/generate/', body)
      toast.success('Advice generated — review and edit if needed')
      await loadList()
      setSelected(data)
    } catch (e) {
      toast.error(extractErrorMessage(e, 'Generate failed'))
    } finally {
      setGenBusy(false)
    }
  }

  const saveEdits = async () => {
    if (!selected || selected.status !== 'pending_review') return
    setSaveBusy(true)
    try {
      const { data } = await api.put<FeedingAdviceRow>(`/aquaculture/feeding-advice/${selected.id}/`, {
        edited_advice_text: editText,
        suggested_feed_kg: editKg.trim() === '' ? null : editKg.trim(),
        sack_size_kg: Number.parseInt(editSackSize, 10),
      })
      toast.success('Saved')
      setSelected(data)
      void loadList()
    } catch (e) {
      toast.error(extractErrorMessage(e, 'Save failed'))
    } finally {
      setSaveBusy(false)
    }
  }

  const saveSackSizeOnly = async () => {
    if (!selected || (selected.status !== 'approved' && selected.status !== 'applied')) return
    setSackSaveBusy(true)
    try {
      const { data } = await api.put<FeedingAdviceRow>(`/aquaculture/feeding-advice/${selected.id}/`, {
        sack_size_kg: Number.parseInt(editSackSize, 10),
      })
      toast.success('Sack size saved')
      setSelected(data)
      void loadList()
    } catch (e) {
      toast.error(extractErrorMessage(e, 'Could not save sack size'))
    } finally {
      setSackSaveBusy(false)
    }
  }

  const approve = async () => {
    if (!selected || selected.status !== 'pending_review') return
    try {
      const { data } = await api.post<FeedingAdviceRow>(`/aquaculture/feeding-advice/${selected.id}/approve/`, {})
      toast.success('Approved')
      setSelected(data)
      void loadList()
    } catch (e) {
      toast.error(extractErrorMessage(e, 'Approve failed'))
    }
  }

  const cancelAdvice = async () => {
    if (!selected || selected.status !== 'pending_review') return
    if (!window.confirm('Cancel this draft advice?')) return
    try {
      const { data } = await api.post<FeedingAdviceRow>(`/aquaculture/feeding-advice/${selected.id}/cancel/`, {})
      toast.success('Cancelled — you can delete the record below if you do not need it for audit.')
      setSelected(data)
      void loadList()
    } catch (e) {
      toast.error(extractErrorMessage(e, 'Cancel failed'))
    }
  }

  const deleteCancelled = async () => {
    if (!selected || selected.status !== 'cancelled') return
    if (!window.confirm('Permanently delete this cancelled feeding advice? This cannot be undone.')) return
    setDeleteBusy(true)
    try {
      await api.delete(`/aquaculture/feeding-advice/${selected.id}/`)
      toast.success('Record deleted')
      setSelected(null)
      void loadList()
    } catch (e) {
      toast.error(extractErrorMessage(e, 'Delete failed'))
    } finally {
      setDeleteBusy(false)
    }
  }

  const apply = async () => {
    if (!selected || selected.status !== 'approved') return
    if (!applyCreateExp && applyConsumePond) {
      if (!selected.pond_default_feed_item_id && !applyFeedItemId.trim()) {
        toast.error('Select a feed product from the pond warehouse, or set the pond default feed on the pond page.')
        return
      }
    }
    if (applyCreateExp && !applyManualPurchaseAmount) {
      if (!selected.pond_default_feed_item_id && !applyFeedItemId.trim()) {
        toast.error(
          'Choose a feed product for automatic costing, set the pond default feed, or enable “Override purchase amount”.',
        )
        return
      }
    }
    setApplyBusy(true)
    try {
      const body: Record<string, unknown> = {}
      if (applyKg.trim() !== '') body.feed_weight_kg = applyKg.trim()
      if (applyCreateExp) {
        body.create_expense = true
        if (applyManualPurchaseAmount) {
          const amt = Number(applyAmount)
          if (!Number.isFinite(amt) || amt <= 0) {
            toast.error('Enter a valid expense amount')
            setApplyBusy(false)
            return
          }
          body.amount = amt
        }
        if (applyFeedItemId.trim() !== '') {
          body.feed_item_id = Number.parseInt(applyFeedItemId, 10)
        }
        body.vendor_name = applyVendor.trim() || 'Feed supplier'
        body.memo = applyMemo.trim() || `Feed applied (advice #${selected.id})`
        body.expense_date = selected.target_date
        body.expense_category = 'feed_purchase'
      } else {
        body.consume_pond_stock = applyConsumePond
        if (applyConsumePond && applyFeedItemId.trim() !== '') {
          body.feed_item_id = Number.parseInt(applyFeedItemId, 10)
        }
      }
      const pondIdToRefresh = selected.pond_id
      const { data } = await api.post<FeedingAdviceRow & { created_expense?: unknown }>(
        `/aquaculture/feeding-advice/${selected.id}/apply/`,
        body,
      )
      const consumedWh =
        !applyCreateExp &&
        applyConsumePond &&
        (!!selected.pond_default_feed_item_id || applyFeedItemId.trim() !== '')
      toast.success(
        applyCreateExp
          ? 'Applied and expense recorded'
          : consumedWh
            ? 'Applied — pond warehouse stock updated'
            : 'Marked as applied',
      )
      setSelected(data)
      void loadList()
      if (!applyCreateExp && applyConsumePond) {
        void (async () => {
          try {
            const { data: wh } = await api.get<{ items?: PondWarehouseItemRow[] }>(
              `/aquaculture/ponds/${pondIdToRefresh}/warehouse-stock/`,
            )
            setPondWhStock(Array.isArray(wh?.items) ? wh.items : [])
          } catch {
            /* ignore */
          }
        })()
      }
    } catch (e) {
      toast.error(extractErrorMessage(e, 'Apply failed'))
    } finally {
      setApplyBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8">
      <div className="mb-5">
        <Link
          href="/aquaculture"
          className="inline-flex items-center gap-1 text-sm font-medium text-teal-800 hover:text-teal-950"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Aquaculture overview
        </Link>
      </div>

      <div className="flex flex-col gap-4 border-b border-slate-200/90 pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-teal-700">Aquaculture · Operations</p>
          <h1 className="mt-1 flex flex-wrap items-center gap-2 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-teal-50 text-teal-700">
              <UtensilsCrossed className="h-5 w-5" strokeWidth={1.75} aria-hidden />
            </span>
            Feeding advice
            <span className="text-base font-semibold text-slate-500 sm:text-lg">Nile tilapia</span>
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-600">
            Daily feed targets from pond biomass and stocking. Use the steps below: create a plan, adjust kg or sacks if
            needed, approve, then apply so warehouse stock or a purchase expense stays accurate.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
          <Link
            href="/aquaculture/sampling"
            className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
          >
            <Gauge className="h-3.5 w-3.5 text-teal-700" aria-hidden />
            Sampling
          </Link>
          <Link
            href="/aquaculture/ponds"
            className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
          >
            <MapPin className="h-3.5 w-3.5 text-teal-700" aria-hidden />
            Ponds
          </Link>
          <button
            type="button"
            onClick={() => void loadList()}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden />
            Refresh
          </button>
        </div>
      </div>

      <div className="mt-6">
        <PageFlowStrip />
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <PipelineStatCard
          title="Needs review"
          value={pipelineStats.pending}
          sub="Draft plans awaiting approval"
          icon={ClipboardList}
          tone="amber"
        />
        <PipelineStatCard
          title="Approved"
          value={pipelineStats.approved}
          sub="Ready to apply in the field"
          icon={Sparkles}
          tone="sky"
        />
        <PipelineStatCard
          title="Applied"
          value={pipelineStats.applied}
          sub="Executed plans (this list view)"
          icon={CheckCircle2}
          tone="emerald"
        />
        <PipelineStatCard
          title="In view"
          value={pipelineStats.total}
          sub={
            filterStatus === 'all' && !filterPond
              ? 'Up to 200 most recent records'
              : 'Matching current filters'
          }
          icon={List}
          tone="slate"
        />
      </div>

      <div className="mt-6 flex flex-col gap-4 rounded-2xl border border-slate-200/90 bg-white p-4 shadow-sm lg:flex-row lg:flex-wrap lg:items-end lg:justify-between">
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Filter by status">
          {STATUS_TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={filterStatus === t.id}
              onClick={() => setFilterStatus(t.id)}
              className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition outline-none ring-teal-600/20 focus-visible:ring-2 ${
                filterStatus === t.id
                  ? 'bg-teal-700 text-white shadow-sm'
                  : 'bg-slate-50 text-slate-700 ring-1 ring-slate-200 hover:bg-slate-100'
              }`}
            >
              <span className="tabular-nums">{t.label}</span>
              <span
                className={`ml-1.5 tabular-nums opacity-90 ${
                  filterStatus === t.id ? 'text-white/90' : 'text-slate-500'
                }`}
              >
                ({statusTabCounts[t.id]})
              </span>
            </button>
          ))}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-3 sm:flex-row sm:items-end sm:justify-end">
          <label className="block text-xs font-medium text-slate-600 sm:min-w-[10rem]">
            Pond
            <select
              className="mt-1 block w-full rounded-lg border border-slate-200 bg-slate-50/80 px-2 py-2 text-sm text-slate-900 outline-none ring-teal-600/15 focus:border-teal-500 focus:ring-2"
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
          <label className="block min-w-0 flex-1 text-xs font-medium text-slate-600 sm:max-w-xs">
            <span className="flex items-center gap-1">
              <Search className="h-3 w-3 text-slate-400" aria-hidden />
              Search this page
            </span>
            <input
              type="search"
              placeholder="Pond, cycle, status…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50/80 px-3 py-2 text-sm text-slate-900 outline-none ring-teal-600/15 placeholder:text-slate-400 focus:border-teal-500 focus:ring-2"
              autoComplete="off"
            />
          </label>
        </div>
      </div>

      <p className="mt-3 text-xs text-slate-500">
        Press <kbd className="rounded border border-slate-200 bg-slate-100 px-1 font-mono text-[10px]">Esc</kbd> to clear
        the selected plan. Cancelled rows can be deleted for a clean list.
      </p>

      <div className="mt-6 grid gap-4 lg:grid-cols-5 lg:items-start">
        <section className="rounded-2xl border border-teal-200/60 bg-white p-5 shadow-sm ring-1 ring-teal-500/10 lg:col-span-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-teal-50 text-teal-700">
                <Sparkles className="h-5 w-5" strokeWidth={1.75} aria-hidden />
              </div>
              <div className="min-w-0">
                <h2 className="text-base font-semibold text-slate-900">Start here: generate a daily plan</h2>
                <p className="mt-1 text-xs leading-relaxed text-slate-600">
                  Chooses ration from tilapia stock in the pond (and optional cycle). After it appears in the table,
                  select the row to review, approve, and apply.
                </p>
              </div>
            </div>
            <Link
              href="/aquaculture/sampling"
              className="shrink-0 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
            >
              Biomass sampling
            </Link>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="block text-xs font-medium text-slate-600">
              Pond
              <select
                className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50/80 px-2 py-2 text-sm outline-none ring-teal-600/15 focus:border-teal-500 focus:ring-2"
                value={genPond}
                onChange={(e) => setGenPond(e.target.value)}
              >
                <option value="">Select pond…</option>
                {ponds.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-xs font-medium text-slate-600">
              Production cycle (optional)
              <select
                className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50/80 px-2 py-2 text-sm outline-none ring-teal-600/15 focus:border-teal-500 focus:ring-2 disabled:opacity-50"
                value={genCycle}
                onChange={(e) => setGenCycle(e.target.value)}
                disabled={!genPond}
              >
                <option value="">All movements (no cycle filter)</option>
                {cycles.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-xs font-medium text-slate-600">
              Target date
              <input
                type="date"
                className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50/80 px-2 py-2 text-sm outline-none ring-teal-600/15 focus:border-teal-500 focus:ring-2"
                value={genDate}
                onChange={(e) => setGenDate(e.target.value)}
              />
            </label>
            <label className="block text-xs font-medium text-slate-600">
              Water temperature °C (optional)
              <input
                type="text"
                inputMode="decimal"
                placeholder="e.g. 28 — meal timing"
                className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50/80 px-2 py-2 text-sm outline-none ring-teal-600/15 placeholder:text-slate-400 focus:border-teal-500 focus:ring-2"
                value={genTemp}
                onChange={(e) => setGenTemp(e.target.value)}
              />
            </label>
            <label className="block text-xs font-medium text-slate-600 sm:col-span-2">
              Sack size for crew instructions (10 / 20 / 25 kg)
              <select
                className="mt-1 w-full max-w-xs rounded-lg border border-slate-200 bg-slate-50/80 px-2 py-2 text-sm outline-none ring-teal-600/15 focus:border-teal-500 focus:ring-2"
                value={genSackKg}
                onChange={(e) => {
                  const v = Number.parseInt(e.target.value, 10)
                  if (isAllowedSackKg(v)) setGenSackKg(v)
                }}
              >
                {SACK_SIZE_OPTIONS_KG.map((kg) => (
                  <option key={kg} value={kg}>
                    {kg} kg per sack
                  </option>
                ))}
              </select>
            </label>
          </div>
          <button
            type="button"
            disabled={genBusy || !genPond}
            onClick={() => void generate()}
            className="mt-5 inline-flex items-center gap-2 rounded-xl bg-teal-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Sparkles className="h-4 w-4" aria-hidden />
            {genBusy ? 'Generating…' : 'Generate advice'}
          </button>
        </section>

        <aside className="rounded-2xl border border-slate-200/90 bg-slate-50/80 p-4 text-sm text-slate-700 lg:col-span-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Tips</h3>
          <ul className="mt-2 list-disc space-y-1.5 pl-4 text-xs leading-relaxed text-slate-600">
            <li>
              Recent{' '}
              <Link href="/aquaculture/sampling" className="font-medium text-teal-800 underline">
                sampling
              </Link>{' '}
              improves kg/day and mean weight in the snapshot.
            </li>
            <li>Optional °C aligns meal frequency and times with hot or cold water.</li>
            <li>Sack counts are for the pond crew; kilograms remain the stored amount.</li>
          </ul>
          <details className="mt-4 rounded-lg border border-slate-200 bg-white/90 p-3 text-xs">
            <summary className="cursor-pointer font-semibold text-slate-800 outline-none ring-teal-600/20 focus-visible:ring-2">
              WorldFish tables &amp; archive
            </summary>
            <p className="mt-2 leading-relaxed text-slate-600">
              Ration (% body weight) and meals follow published Nile tilapia grow-out guidance (often referenced near
              ~28&nbsp;°C). See the{' '}
              <a
                href="https://digitalarchive.worldfishcenter.org/"
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-teal-800 underline decoration-teal-500/40 hover:decoration-teal-800"
              >
                WorldFish digital archive
              </a>
              . Each plan stores the parameters used under{' '}
              <code className="rounded bg-slate-100 px-1 ring-1 ring-slate-200">worldfish</code> in the row snapshot.
            </p>
          </details>
        </aside>
      </div>

      {loading ? (
        <div className="mt-10 flex justify-center">
          <div className="h-10 w-10 animate-spin rounded-full border-2 border-slate-200 border-t-teal-600" />
        </div>
      ) : (
        <>
        <div className="mt-4 grid gap-6 lg:grid-cols-5">
          <div className="lg:col-span-2">
            <div className="overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-sm">
              <table className="min-w-full text-left text-sm">
                <caption className="border-b border-slate-100 bg-slate-50/80 px-3 py-2.5 text-left text-xs font-medium text-slate-600">
                  <span className="block">Daily plans · newest first (server limit 200)</span>
                  {rows.length > 0 ? (
                    <span className="mt-1 block font-normal text-slate-500">
                      Showing {displayRows.length} of {rows.length}
                      {searchQuery.trim() || filterPond || filterStatus !== 'all'
                        ? ' · filters or search active'
                        : ''}
                    </span>
                  ) : null}
                </caption>
                <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-3 py-2.5 sm:px-4">Date</th>
                    <th className="px-3 py-2.5 sm:px-4">Pond</th>
                    <th className="hidden px-3 py-2.5 sm:table-cell sm:px-4">Cycle</th>
                    <th className="px-3 py-2.5 sm:px-4">Dose</th>
                    <th className="px-3 py-2.5 sm:px-4">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-10 text-center text-slate-500">
                        <p className="font-medium text-slate-700">No feeding advice yet</p>
                        <p className="mt-1 text-xs text-slate-500">
                          Use <strong className="font-medium text-slate-700">Generate</strong> above after choosing a pond.
                          Accurate kg/day needs recent{' '}
                          <Link href="/aquaculture/sampling" className="text-teal-800 underline">
                            biomass sampling
                          </Link>
                          .
                        </p>
                      </td>
                    </tr>
                  ) : displayRows.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-10 text-center text-slate-500">
                        No rows match your search.{' '}
                        <button
                          type="button"
                          className="font-medium text-teal-800 underline"
                          onClick={() => setSearchQuery('')}
                        >
                          Clear search
                        </button>
                      </td>
                    </tr>
                  ) : (
                    displayRows.map((r) => (
                      <tr
                        key={r.id}
                        tabIndex={0}
                        aria-selected={selected?.id === r.id}
                        className={`cursor-pointer border-b border-slate-100 outline-none transition hover:bg-slate-50 focus-visible:bg-teal-50/80 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-teal-500/30 ${
                          selected?.id === r.id ? 'bg-teal-50/60' : ''
                        }`}
                        onClick={() => setSelected(r)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            setSelected(r)
                          }
                        }}
                      >
                        <td className="px-3 py-2.5 whitespace-nowrap tabular-nums text-slate-800 sm:px-4">
                          {formatDateOnly(r.target_date)}
                        </td>
                        <td className="px-3 py-2.5 sm:px-4">
                          <span className="font-medium text-slate-900">{r.pond_name}</span>
                          <ChevronRight className="ml-1 inline h-3 w-3 text-slate-400 lg:hidden" aria-hidden />
                        </td>
                        <td className="hidden max-w-[8rem] truncate px-3 py-2.5 text-xs text-slate-600 sm:table-cell sm:px-4">
                          {r.production_cycle_name?.trim() ? r.production_cycle_name : '—'}
                        </td>
                        <td className="max-w-[9rem] px-3 py-2 text-xs leading-snug text-slate-700 sm:max-w-none sm:px-4 sm:text-sm">
                          {feedingDoseListLabel(r)}
                        </td>
                        <td className="px-3 py-2.5 sm:px-4">
                          <span className={statusPill(r.status)}>{r.status_label}</span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="lg:col-span-3">
            {!selected ? (
              <div className="rounded-2xl border border-dashed border-slate-300/90 bg-white px-4 py-14 text-center">
                <p className="text-sm font-medium text-slate-700">No plan selected</p>
                <p className="mt-1 text-xs leading-relaxed text-slate-500">
                  Click a row in the table on the left, or use <strong className="font-medium text-slate-700">Generate</strong>{' '}
                  above to create a new daily plan.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-900">
                      <Link
                        href={`/aquaculture/ponds/${selected.pond_id}`}
                        className="text-teal-900 hover:underline"
                      >
                        {selected.pond_name}
                      </Link>
                      <span className="font-normal text-slate-500"> · </span>
                      {formatDateOnly(selected.target_date)}
                    </p>
                    <p className="text-xs text-slate-500">
                      {selected.production_cycle_name ? `Cycle: ${selected.production_cycle_name} · ` : ''}
                      Created {selected.created_by_display ? `by ${selected.created_by_display} · ` : ''}
                      {formatDateOnly(selected.created_at)}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/aquaculture/ponds/${selected.pond_id}`}
                      className="hidden items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 sm:inline-flex"
                    >
                      Pond setup
                      <ArrowRight className="h-3 w-3" aria-hidden />
                    </Link>
                    {selected.status === 'cancelled' && (
                      <button
                        type="button"
                        disabled={deleteBusy}
                        onClick={() => void deleteCancelled()}
                        className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-900 hover:bg-red-100 disabled:opacity-50"
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden />
                        {deleteBusy ? 'Deleting…' : 'Delete record'}
                      </button>
                    )}
                    <span className={statusPill(selected.status)}>{selected.status_label}</span>
                  </div>
                </div>

                <WorkflowRail status={selected.status} />
                {selectedHiddenBySearch ? (
                  <div
                    className="rounded-xl border border-amber-200/90 bg-amber-50/90 px-3 py-2.5 text-xs text-amber-950"
                    role="status"
                  >
                    This plan is not visible in the table because it does not match your search — clear search to
                    highlight the row.
                  </div>
                ) : null}

                {(selected.suggested_feed_kg ||
                  selected.applied_feed_kg ||
                  feedingHeuristicBlock ||
                  worldfishBlock ||
                  feedingScheduleBlock) && (
                  <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                    <h3 className="text-sm font-semibold text-slate-900">Feeding dose</h3>
                    <ul className="mt-2 list-disc space-y-1 pl-4 text-xs leading-relaxed text-slate-600">
                      <li>
                        <span className="font-medium text-slate-800">Kg/day</span>, meal count, and suggested times use
                        pond load, fish stage, and optional <span className="font-medium text-slate-800">water °C</span>{' '}
                        as the weather signal.
                      </li>
                      <li>Re-run <strong className="font-medium text-slate-800">Generate</strong> after major sampling or weather changes.</li>
                      <li>
                        <span className="font-medium text-slate-800">Sack size</span> only converts kg for crews; kg stays
                        the system of record.
                      </li>
                    </ul>

                    {(feedingScheduleBlock?.times_per_day != null &&
                      String(feedingScheduleBlock.times_per_day).trim() !== '') ||
                    (worldfishBlock?.meals_hint != null && String(worldfishBlock.meals_hint).trim() !== '') ? (
                      <div className="mt-4 space-y-4 rounded-lg border border-teal-100 bg-teal-50/60 p-3">
                        {feedingScheduleBlock?.weather_condition_label != null &&
                          String(feedingScheduleBlock.weather_condition_label).trim() !== '' && (
                            <div>
                              <p className="text-xs font-semibold uppercase tracking-wide text-teal-900">
                                Weather (water)
                              </p>
                              <p className="mt-1 text-sm text-slate-800">
                                {String(feedingScheduleBlock.weather_condition_label)}
                              </p>
                            </div>
                          )}

                        {mealPlan.rows.length > 0 && (
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-wide text-teal-900">
                              Daily feed plan
                            </p>
                            <p className="mt-1 text-xs text-slate-600">
                              Per-meal kg (equal split when only a daily total is known) and suggested clock windows.
                              <>
                                {' '}
                                Sack counts use{' '}
                                <strong className="font-medium text-slate-800">{sackKgForDisplay} kg</strong> per sack.
                              </>
                            </p>
                            <div className="mt-2 overflow-x-auto rounded-lg border border-teal-200/80 bg-white">
                              <table className="min-w-full text-left text-sm">
                                <thead className="border-b border-slate-200 bg-slate-50 text-xs text-slate-600">
                                  <tr>
                                    <th className="px-3 py-2">Meal</th>
                                    <th className="px-3 py-2">Suggested time</th>
                                    <th className="px-3 py-2 text-right">Feed (kg)</th>
                                    <th className="px-3 py-2 text-right">Sacks</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {mealPlan.rows.map((r) => (
                                    <tr key={r.mealIndex} className="border-b border-slate-100">
                                      <td className="px-3 py-2 font-medium text-slate-900">{r.mealIndex}</td>
                                      <td className="max-w-[14rem] px-3 py-2 text-xs text-slate-700 sm:max-w-none sm:text-sm">
                                        {r.timePlain}
                                      </td>
                                      <td className="px-3 py-2 text-right font-medium tabular-nums text-slate-900">
                                        {r.kg}
                                      </td>
                                      <td className="px-3 py-2 text-right tabular-nums text-slate-800">
                                        {kgCellToSackCount(r.kg, sackKgForDisplay)}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                                <tfoot className="border-t border-slate-200 bg-teal-50/50">
                                  <tr>
                                    <td colSpan={2} className="px-3 py-2 text-right text-xs font-semibold text-slate-700">
                                      Total feed (plan)
                                    </td>
                                    <td className="px-3 py-2 text-right text-sm font-bold tabular-nums text-teal-950">
                                      {mealPlan.totalKg != null ? `${mealPlan.totalKg} kg` : '—'}
                                    </td>
                                    <td className="px-3 py-2 text-right text-sm font-bold tabular-nums text-teal-950">
                                      {mealPlan.totalKg != null
                                        ? kgCellToSackCount(mealPlan.totalKg, sackKgForDisplay)
                                        : '—'}
                                    </td>
                                  </tr>
                                  {selected.status === 'applied' && selected.applied_feed_kg && (
                                    <tr>
                                      <td colSpan={2} className="px-3 py-2 text-right text-xs font-medium text-slate-600">
                                        Applied (actual)
                                      </td>
                                      <td className="px-3 py-2 text-right text-sm font-semibold tabular-nums text-emerald-800">
                                        {selected.applied_feed_kg} kg
                                      </td>
                                      <td className="px-3 py-2 text-right text-sm font-semibold tabular-nums text-emerald-800">
                                        {kgCellToSackCount(String(selected.applied_feed_kg), sackKgForDisplay)}
                                      </td>
                                    </tr>
                                  )}
                                </tfoot>
                              </table>
                            </div>
                            {feedingScheduleBlock?.per_meal_amount_summary != null &&
                              String(feedingScheduleBlock.per_meal_amount_summary).trim() !== '' && (
                                <p className="mt-2 text-xs text-slate-600">
                                  <AdviceRichText
                                    text={String(feedingScheduleBlock.per_meal_amount_summary)}
                                  />
                                </p>
                              )}
                          </div>
                        )}

                        <div>
                          <p className="text-xs font-semibold uppercase tracking-wide text-teal-900">
                            Frequency (meals / day)
                          </p>
                          <p className="mt-1 text-sm font-semibold text-slate-900">
                            {String(
                              feedingScheduleBlock?.times_per_day ??
                                worldfishBlock?.meals_hint ??
                                '—',
                            )}
                          </p>
                          {feedingScheduleBlock?.frequency_meals_per_day != null &&
                            typeof feedingScheduleBlock.frequency_meals_per_day === 'number' && (
                              <p className="mt-0.5 text-xs text-slate-600">
                                Planned split: <strong>{feedingScheduleBlock.frequency_meals_per_day}</strong> feeds
                                (for kg and clock windows below).
                              </p>
                            )}
                          {feedingScheduleBlock?.extension_table_meals_hint != null &&
                            String(feedingScheduleBlock.extension_table_meals_hint).trim() !== '' &&
                            String(feedingScheduleBlock.extension_table_meals_hint) !==
                              String(feedingScheduleBlock.times_per_day) && (
                              <p className="mt-1 text-xs text-slate-600">
                                Extension table baseline:{' '}
                                <span className="font-medium text-slate-800">
                                  {String(feedingScheduleBlock.extension_table_meals_hint)}
                                </span>
                              </p>
                            )}
                        </div>

                        {recommendedFeedingTimes.length > 0 && mealPlan.rows.length === 0 && (
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-wide text-teal-900">
                              Feeding times (by weather)
                            </p>
                            <p className="mt-1 text-xs text-slate-600">
                              Illustrative clock windows — adjust to your sunrise, cloud cover, and farm routine.
                            </p>
                            <ul className="mt-2 list-disc space-y-2 pl-4 text-xs leading-relaxed text-slate-800">
                              {recommendedFeedingTimes.map((line, i) => (
                                <li key={i}>
                                  <AdviceRichText text={line} />
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {feedingScheduleBullets.length > 0 && (
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-wide text-slate-700">
                              Pond &amp; fish notes
                            </p>
                            <ul className="mt-2 list-disc space-y-2 pl-4 text-xs leading-relaxed text-slate-700">
                              {feedingScheduleBullets.map((b, i) => (
                                <li key={i}>
                                  <AdviceRichText text={b} />
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {!feedingScheduleBlock && Boolean(worldfishBlock?.meals_hint) && (
                          <p className="text-xs text-slate-600">
                            Re-generate this advice to capture weather-based **amount**, **frequency**, and **feeding
                            times**.
                          </p>
                        )}
                      </div>
                    ) : null}

                    <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
                      {selected.status === 'applied' && selected.applied_feed_kg ? (
                        <>
                          <dt className="text-slate-500">Applied feed</dt>
                          <dd className="font-medium text-slate-900">
                            {selected.applied_feed_kg} kg
                            {feedKgToSackLabel(selected.applied_feed_kg, sackKgForDisplay) && (
                              <span className="mt-0.5 block text-xs font-normal text-slate-600">
                                {feedKgToSackLabel(selected.applied_feed_kg, sackKgForDisplay)}
                              </span>
                            )}
                          </dd>
                        </>
                      ) : null}
                      {selected.suggested_feed_kg ? (
                        <>
                          <dt className="text-slate-500">
                            {selected.status === 'applied' ? 'Planned dose (suggested)' : 'Suggested daily feed'}
                          </dt>
                          <dd className="font-medium text-slate-900">
                            {selected.suggested_feed_kg} kg
                            {feedKgToSackLabel(selected.suggested_feed_kg, sackKgForDisplay) && (
                              <span className="mt-0.5 block text-xs font-normal text-slate-600">
                                {feedKgToSackLabel(selected.suggested_feed_kg, sackKgForDisplay)}
                              </span>
                            )}
                          </dd>
                        </>
                      ) : selected.status !== 'applied' ? (
                        <>
                          <dt className="text-slate-500">Suggested daily feed</dt>
                          <dd className="text-slate-600">— (add sampling or biomass to estimate kg)</dd>
                        </>
                      ) : null}
                      {(feedingHeuristicBlock?.body_weight_percent_per_day != null ||
                        worldfishBlock?.chosen_bw_pct_per_day != null) && (
                        <>
                          <dt className="text-slate-500">Feeding rate</dt>
                          <dd className="font-medium text-slate-900">
                            {String(
                              feedingHeuristicBlock?.body_weight_percent_per_day ??
                                worldfishBlock?.chosen_bw_pct_per_day,
                            )}
                            % of body weight / day
                          </dd>
                        </>
                      )}
                      {feedingScheduleBlock?.factors != null &&
                        typeof feedingScheduleBlock.factors === 'object' &&
                        feedingScheduleBlock.factors !== null && (
                          <>
                            <dt className="text-slate-500">Snapshot factors</dt>
                            <dd className="text-xs text-slate-700">
                              {(() => {
                                const f = feedingScheduleBlock.factors as Record<string, unknown>
                                const bits: string[] = []
                                if (f.water_temp_c != null) bits.push(`water ${f.water_temp_c}°C`)
                                if (f.pond_load_label) bits.push(`pond: ${String(f.pond_load_label)}`)
                                else if (f.pond_load_level) bits.push(`load: ${String(f.pond_load_level)}`)
                                if (f.fish_stage) bits.push(`stage: ${String(f.fish_stage)}`)
                                return bits.length > 0 ? bits.join(' · ') : '—'
                              })()}
                            </dd>
                          </>
                        )}
                      {worldfishBlock?.meals_hint != null &&
                        String(worldfishBlock.meals_hint).trim() !== '' &&
                        feedingScheduleBlock == null && (
                          <>
                            <dt className="text-slate-500">Meals (extension table)</dt>
                            <dd className="text-slate-800">{String(worldfishBlock.meals_hint)}</dd>
                          </>
                        )}
                      {worldfishBlock?.feed_form_hint != null &&
                        String(worldfishBlock.feed_form_hint).trim() !== '' && (
                          <>
                            <dt className="text-slate-500">Pellet / form</dt>
                            <dd className="text-slate-800">{String(worldfishBlock.feed_form_hint)}</dd>
                          </>
                        )}
                    </dl>

                    {(selected.status === 'approved' || selected.status === 'applied') && (
                      <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50/90 p-3">
                        <p className="text-xs font-semibold text-slate-800">Sack size for field teams</p>
                        <p className="mt-0.5 text-[11px] text-slate-600">
                          Saved on this advice record. Workers see sack counts in the table above when set.
                        </p>
                        <div className="mt-2 flex flex-wrap items-end gap-3">
                          <div className="min-w-[12rem] flex-1">{sackSelect}</div>
                          <button
                            type="button"
                            disabled={sackSaveBusy}
                            onClick={() => void saveSackSizeOnly()}
                            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50"
                          >
                            {sackSaveBusy ? 'Saving…' : 'Save sack size'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {worldfishBlock && (
                  <details className="rounded-xl border border-teal-100 bg-teal-50/50 p-4 text-xs text-slate-700">
                    <summary className="cursor-pointer list-none font-semibold text-teal-950 outline-none ring-teal-600/25 focus-visible:ring-2 [&::-webkit-details-marker]:hidden">
                      <span className="inline-flex items-center gap-1">
                        WorldFish parameters (snapshot)
                        <span className="text-[11px] font-normal text-slate-500">— tap to expand</span>
                      </span>
                    </summary>
                    <dl className="mt-3 grid gap-1 sm:grid-cols-2">
                      {worldfishBlock.worldfish_stage != null && (
                        <>
                          <dt className="text-slate-500">Stage</dt>
                          <dd className="font-medium">{String(worldfishBlock.worldfish_stage)}</dd>
                        </>
                      )}
                      {worldfishBlock.mean_fish_weight_g != null && (
                        <>
                          <dt className="text-slate-500">Mean weight</dt>
                          <dd className="font-medium">{String(worldfishBlock.mean_fish_weight_g)} g</dd>
                        </>
                      )}
                      <dt className="text-slate-500">% BW / day (chosen)</dt>
                      <dd className="font-medium">{String(worldfishBlock.chosen_bw_pct_per_day)}%</dd>
                      <dt className="text-slate-500">Temperature note</dt>
                      <dd>{String(worldfishBlock.temperature_note || '—')}</dd>
                    </dl>
                  </details>
                )}

                <details className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                  <summary className="cursor-pointer list-none text-xs font-medium uppercase tracking-wide text-slate-500 outline-none ring-teal-600/20 focus-visible:ring-2 [&::-webkit-details-marker]:hidden">
                    <span className="inline-flex items-center gap-1">
                      Original (AI-style) wording
                      <span className="text-[11px] font-normal normal-case text-slate-500">— optional detail</span>
                    </span>
                  </summary>
                  <div className="mt-2 max-h-48 overflow-y-auto rounded-lg bg-slate-50 p-3">
                    <AdviceRichText text={selected.ai_advice_text} />
                  </div>
                </details>

                {selected.status === 'pending_review' && (
                  <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                    <label className="text-xs font-medium text-slate-700">Editable advice (optional override)</label>
                    <textarea
                      className="mt-2 min-h-[160px] w-full rounded-lg border border-slate-300 p-3 text-sm"
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      placeholder="Leave blank to use the original text. Or paste your manager notes here."
                    />
                    <div className="mt-3">{sackSelect}</div>
                    <div className="mt-3 grid max-w-xl gap-3 sm:grid-cols-2">
                      <label className="block text-xs font-medium text-slate-700">
                        Daily feed (kg)
                        <input
                          type="text"
                          inputMode="decimal"
                          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                          value={editKg}
                          onChange={(e) => onEditKgChange(e.target.value)}
                        />
                      </label>
                      <label className="block text-xs font-medium text-slate-700">
                        Daily feed (sacks)
                        <input
                          type="text"
                          inputMode="numeric"
                          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                          value={editSacks}
                          onChange={(e) => onEditSacksChange(e.target.value)}
                          placeholder="e.g. 4"
                        />
                      </label>
                    </div>
                    <p className="mt-1 text-[11px] text-slate-500">
                      Kg and sacks stay in sync using the sack size above; both are saved with the draft.
                    </p>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={saveBusy}
                        onClick={() => void saveEdits()}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                      >
                        Save draft
                      </button>
                      <button
                        type="button"
                        onClick={() => void approve()}
                        className="inline-flex items-center gap-1 rounded-lg bg-sky-600 px-3 py-2 text-sm font-medium text-white"
                      >
                        <Check className="h-4 w-4" />
                        Approve
                      </button>
                      <button
                        type="button"
                        onClick={() => void cancelAdvice()}
                        className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900"
                      >
                        <XCircle className="h-4 w-4" />
                        Cancel draft
                      </button>
                    </div>
                  </div>
                )}

                {selected.status !== 'pending_review' && (
                  <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Effective advice</p>
                    <div className="mt-2">
                      <AdviceRichText text={selected.effective_advice_text} />
                    </div>
                    {selected.suggested_feed_kg && (
                      <p className="mt-3 text-sm text-slate-600">
                        Feeding dose: <strong>{selected.suggested_feed_kg} kg</strong> / day
                        {feedKgToSackLabel(selected.suggested_feed_kg, sackKgForDisplay) && (
                          <>
                            {' '}
                            <span className="text-slate-700">
                              ({feedKgToSackLabel(selected.suggested_feed_kg, sackKgForDisplay)})
                            </span>
                          </>
                        )}
                      </p>
                    )}
                    {selected.status === 'approved' && (
                      <p className="mt-1 text-xs text-slate-500">
                        Approved
                        {selected.approved_by_display ? ` by ${selected.approved_by_display}` : ''}
                        {selected.approved_at ? ` · ${formatDateOnly(selected.approved_at)}` : ''}
                      </p>
                    )}
                  </div>
                )}

                {selected.status === 'approved' && (
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-4 shadow-sm">
                    <h3 className="text-sm font-semibold text-emerald-950">Apply</h3>
                    <p className="mt-1 text-xs text-emerald-900/90">
                      Marks the plan as executed. Draw feed from the <strong>pond warehouse</strong> (pick the SKU below
                      or use the pond default) so COGS / inventory posts at average cost. Or record a{' '}
                      <strong>feed purchase</strong> expense (cash / off-system buy)—not both.
                    </p>
                    <p className="mt-2 rounded-lg border border-emerald-200/90 bg-white/70 px-3 py-2 text-[11px] leading-relaxed text-emerald-950">
                      <strong className="font-semibold">Important:</strong> consuming here updates stock on{' '}
                      <strong>this pond’s warehouse</strong> (see Aquaculture → pond, or Inventory → Stock by station →
                      pond warehouse table). It does <strong>not</strong> reduce the quantity shown for a{' '}
                      <strong>shop site</strong> such as Mynuddin — move feed to the pond first, then apply.
                    </p>
                    <div className="mt-3 grid max-w-xl gap-3 sm:grid-cols-2">
                      <label className="block text-xs font-medium text-slate-700">
                        Feed weight (kg)
                        <input
                          type="text"
                          inputMode="decimal"
                          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                          value={applyKg}
                          onChange={(e) => onApplyKgChange(e.target.value)}
                        />
                      </label>
                      <label className="block text-xs font-medium text-slate-700">
                        Feed (sacks)
                        <input
                          type="text"
                          inputMode="numeric"
                          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                          value={applySacks}
                          onChange={(e) => onApplySacksChange(e.target.value)}
                        />
                      </label>
                    </div>
                    <div className="mt-3 space-y-2">
                      <label className="block text-xs font-medium text-slate-700">
                        Feed product (pond warehouse)
                        {whStockLoading ? (
                          <span className="ml-2 font-normal text-slate-500">Loading stock…</span>
                        ) : null}
                        <select
                          className="mt-1 w-full max-w-md rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                          value={applyFeedItemId}
                          onChange={(e) => setApplyFeedItemId(e.target.value)}
                        >
                          <option value="">
                            {selected.pond_default_feed_item_id
                              ? `Pond default — ${selected.pond_default_feed_item_name?.trim() || `Item #${selected.pond_default_feed_item_id}`}`
                              : 'Choose a product in stock…'}
                          </option>
                          {pondWhStock.map((row) => (
                            <option key={row.item_id} value={String(row.item_id)}>
                              {row.item_name} ({row.quantity} {row.unit})
                            </option>
                          ))}
                        </select>
                        <span className="mt-1 block text-[11px] font-normal text-slate-500">
                          On-hand lines come from this pond’s warehouse. Empty selection uses the pond default when set.
                        </span>
                      </label>
                    </div>
                    <label
                      className={`mt-3 flex items-center gap-2 text-sm text-slate-800 ${applyCreateExp ? 'opacity-50' : ''}`}
                    >
                      <input
                        type="checkbox"
                        checked={applyConsumePond && !applyCreateExp}
                        disabled={
                          applyCreateExp ||
                          (!selected.pond_default_feed_item_id && pondWhStock.length === 0)
                        }
                        onChange={(e) => setApplyConsumePond(e.target.checked)}
                      />
                      Consume from pond warehouse
                      {!selected.pond_default_feed_item_id && pondWhStock.length === 0 ? (
                        <span className="text-xs font-normal text-amber-700">
                          — transfer stock to this pond or set a default feed
                        </span>
                      ) : null}
                    </label>
                    <label className="mt-2 flex items-center gap-2 text-sm text-slate-800">
                      <input
                        type="checkbox"
                        checked={applyCreateExp}
                        onChange={(e) => setApplyCreateExp(e.target.checked)}
                      />
                      Create aquaculture expense (feed purchase)
                    </label>
                    {applyCreateExp && (
                      <div className="mt-3 space-y-3">
                        <label className="flex items-center gap-2 text-sm text-slate-800">
                          <input
                            type="checkbox"
                            checked={applyManualPurchaseAmount}
                            onChange={(e) => setApplyManualPurchaseAmount(e.target.checked)}
                          />
                          Override purchase amount
                        </label>
                        {purchaseAmountEstimateLabel != null && !applyManualPurchaseAmount ? (
                          <p className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs leading-relaxed text-slate-700">
                            <span className="font-semibold text-slate-800">System amount: </span>
                            {purchaseAmountEstimateLabel}
                          </p>
                        ) : null}
                        <div className="grid gap-3 sm:grid-cols-2">
                          {applyManualPurchaseAmount ? (
                            <label className="block text-xs text-slate-600">
                              Amount ({sym})
                              <input
                                type="text"
                                inputMode="decimal"
                                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                                value={applyAmount}
                                onChange={(e) => setApplyAmount(e.target.value)}
                              />
                            </label>
                          ) : null}
                          <label
                            className={`block text-xs text-slate-600 ${applyManualPurchaseAmount ? '' : 'sm:col-span-2'}`}
                          >
                            Vendor
                            <input
                              type="text"
                              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                              value={applyVendor}
                              onChange={(e) => setApplyVendor(e.target.value)}
                            />
                          </label>
                          <label className="col-span-full block text-xs text-slate-600">
                            Memo
                            <input
                              type="text"
                              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                              value={applyMemo}
                              onChange={(e) => setApplyMemo(e.target.value)}
                            />
                          </label>
                        </div>
                      </div>
                    )}
                    <button
                      type="button"
                      disabled={applyBusy || applyPlanBlockedByWarehouseLoad}
                      title={
                        applyPlanBlockedByWarehouseLoad
                          ? 'Wait for pond warehouse stock to finish loading, or set a default feed on the pond.'
                          : undefined
                      }
                      onClick={() => void apply()}
                      className="mt-4 inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                    >
                      {applyBusy ? 'Applying…' : applyPlanBlockedByWarehouseLoad ? 'Loading pond stock…' : 'Apply plan'}
                    </button>
                  </div>
                )}

                {selected.status === 'applied' && (
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                    Applied{' '}
                    {selected.applied_feed_kg ? (
                      <strong>
                        {selected.applied_feed_kg} kg
                        {feedKgToSackLabel(selected.applied_feed_kg, sackKgForDisplay) && (
                          <span className="ml-1 font-normal text-slate-600">
                            ({feedKgToSackLabel(selected.applied_feed_kg, sackKgForDisplay)})
                          </span>
                        )}
                      </strong>
                    ) : (
                      <span className="text-slate-500">—</span>
                    )}
                    {selected.applied_by_display ? ` · ${selected.applied_by_display}` : ''}
                    {selected.applied_at ? ` · ${formatDateOnly(selected.applied_at)}` : ''}
                    {selected.linked_expense_id ? (
                      <span className="ml-2">
                        · Expense #{selected.linked_expense_id}
                      </span>
                    ) : null}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
        </>
      )}
    </div>
  )
}
