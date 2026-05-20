'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft,
  CalendarRange,
  Fish,
  Gauge,
  Landmark,
  RefreshCw,
  Scale,
  Sprout,
} from 'lucide-react'
import { useToast } from '@/components/Toast'
import api from '@/lib/api'
import { extractErrorMessage } from '@/utils/errorHandler'
import { formatDateOnly } from '@/utils/date'
import { formatNumber, getCurrencySymbol } from '@/utils/currency'

type PeriodPreset = 'this_month' | 'last_month' | 'ytd' | 'last_90' | 'custom'
type PresetButton = Exclude<PeriodPreset, 'custom'>

function iso(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function periodRange(preset: PeriodPreset): { start: string; end: string; label: string } {
  const now = new Date()
  const y = now.getFullYear()
  const m = now.getMonth()
  const d = now.getDate()
  const end = new Date(y, m, d)

  if (preset === 'this_month') {
    const start = new Date(y, m, 1)
    return { start: iso(start), end: iso(end), label: 'This month' }
  }
  if (preset === 'last_month') {
    const start = new Date(y, m - 1, 1)
    const last = new Date(y, m, 0)
    return { start: iso(start), end: iso(last), label: 'Last month' }
  }
  if (preset === 'ytd') {
    const start = new Date(y, 0, 1)
    return { start: iso(start), end: iso(end), label: 'Year to date' }
  }
  const start = new Date(y, m, d)
  start.setDate(start.getDate() - 89)
  return { start: iso(start), end: iso(end), label: 'Last 90 days' }
}

function activeDateRange(
  preset: PeriodPreset,
  customStart: string,
  customEnd: string,
): { start: string; end: string; label: string } {
  if (preset === 'custom') {
    if (!customStart || !customEnd) {
      return periodRange('this_month')
    }
    if (customStart <= customEnd) {
      return { start: customStart, end: customEnd, label: 'Custom range' }
    }
    return { start: customEnd, end: customStart, label: 'Custom range' }
  }
  return periodRange(preset)
}

function inRange(isoDate: string | null | undefined, start: string, end: string): boolean {
  if (!isoDate) return false
  const day = isoDate.split('T')[0]
  return day >= start && day <= end
}

function parseNum(s: string | null | undefined): number {
  if (s == null || s === '') return 0
  const n = Number(String(s).replace(/,/g, ''))
  return Number.isFinite(n) ? n : 0
}

function daysSpanInclusive(startDay: string, endDay: string): number {
  const a = new Date(startDay + 'T12:00:00')
  const b = new Date(endDay + 'T12:00:00')
  const ms = b.getTime() - a.getTime()
  const days = Math.round(ms / 86400000)
  return Math.max(1, days)
}

interface PondDetail {
  id: number
  name: string
  code: string
  sort_order: number
  is_active: boolean
  notes: string
  pond_role?: string
  pond_role_label?: string
  pos_customer_id?: number | null
  pos_customer_display?: string | null
  pos_customer_auto_managed?: boolean
  default_feed_item_id?: number | null
  default_feed_item_name?: string
  default_medicine_item_id?: number | null
  default_medicine_item_name?: string
  leasing_area_decimal: string | null
  water_area_decimal: string | null
  pond_depth_ft: string | null
  water_surface_sq_ft?: string | null
  water_volume_cu_ft?: string | null
  tilapia_net_fish_count?: number | null
  tilapia_net_weight_kg?: string | null
  tilapia_kg_per_decimal?: string | null
  tilapia_load_level?: string | null
  tilapia_load_level_label?: string | null
  lease_contract_start: string | null
  lease_contract_end: string | null
  lease_price_per_decimal_per_year: string | null
  lease_paid_to_landlord: string
  lease_annual_amount: string | null
  lease_contract_years: string | null
  lease_contract_total: string | null
  lease_remaining_years: number | null
  lease_remaining_months: number | null
  lease_balance_due: string | null
  landlord_pond_shares?: {
    id: number
    landlord_id: number
    landlord_name: string
    landlord_code: string
    land_area_decimal: string
    notes: string
  }[]
  lease_payment_status?: {
    contract_total: string | null
    paid_total: string
    outstanding: string | null
  }
}

interface IncomeSlice {
  income_type: string
  label: string
  amount: string
}

interface PondPlRow {
  pond_id: number
  pond_name: string
  revenue: string
  revenue_by_income_type?: IncomeSlice[]
  direct_operating_expenses?: string
  shared_operating_expenses?: string
  fish_transfer_cost_in?: string
  fish_transfer_cost_out?: string
  biological_write_offs?: string
  operating_expenses: string
  payroll_allocated: string
  total_costs: string
  profit: string
}

interface PlResponse {
  start_date: string
  end_date: string
  ponds: PondPlRow[]
  expenses_by_category: { category: string; label: string; amount: string }[]
  totals: {
    revenue: string
    operating_expenses: string
    payroll_allocated: string
    total_costs: string
    profit: string
  }
}

interface SaleRow {
  id: number
  sale_date: string
  weight_kg: string
  fish_count?: number | null
  total_amount: string
  income_type?: string
  income_type_label?: string
  fish_species_label?: string
}

interface ExpenseRow {
  id: number
  expense_date: string
  amount: string
  expense_category: string
  expense_category_label: string
  memo: string
  vendor_name: string
  feed_weight_kg?: string | null
  is_shared?: boolean
  pond_shares?: { pond_id: number; pond_name: string; amount: string }[]
}

interface SampleRow {
  id: number
  sample_date: string
  fish_species_label?: string
  estimated_fish_count?: number | null
  estimated_total_weight_kg: string | null
  avg_weight_kg: string | null
}

interface CycleRow {
  id: number
  name: string
  code?: string
  start_date?: string
  end_date?: string | null
  is_active?: boolean
}

interface WarehouseStockRow {
  item_id: number
  item_name: string
  unit: string
  quantity: string
  pos_category?: string
  reporting_category?: string
}

/** Shop → pond moves (same list as Inventory; may be filtered by user home station). */
interface PondWarehouseReceipt {
  id: number
  receipt_number: string
  created_at: string | null
  from_station_id: number
  from_station_name: string
  pond_id: number
  pond_name: string
  lines: { item_id: number; item_name: string; quantity: string }[]
}

const POS_WAREHOUSE_GROUP_LABEL: Record<string, string> = {
  feed: 'Feed',
  fish: 'Fish & fingerlings',
  medicine: 'Medicine & treatment',
  general: 'General, equipment & supplies',
  fuel: 'Fuel',
  non_pos: 'Non-POS / hatchery',
}

function pondWarehouseGroupLabel(posCategory: string | undefined): string {
  const k = (posCategory || 'general').toLowerCase()
  return POS_WAREHOUSE_GROUP_LABEL[k] || k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function groupWarehouseRows(rows: WarehouseStockRow[]): { key: string; label: string; rows: WarehouseStockRow[] }[] {
  const m = new Map<string, WarehouseStockRow[]>()
  for (const w of rows) {
    const k = (w.pos_category || 'general').toLowerCase()
    if (!m.has(k)) m.set(k, [])
    m.get(k)!.push(w)
  }
  const order = ['feed', 'medicine', 'fish', 'general', 'fuel', 'non_pos']
  const keys = [...m.keys()].sort((a, b) => {
    const ia = order.indexOf(a)
    const ib = order.indexOf(b)
    if (ia === -1 && ib === -1) return a.localeCompare(b)
    if (ia === -1) return 1
    if (ib === -1) return -1
    return ia - ib
  })
  return keys.map(key => ({ key, label: pondWarehouseGroupLabel(key), rows: m.get(key)! }))
}

interface ItemPickRow {
  id: number
  name: string
  item_type?: string
}

interface StockRow {
  implied_net_fish_count: number
  implied_net_weight_kg: string
  stock_density_kg_per_decimal?: string | null
  load_level_label?: string
}

interface TransferRow {
  id: number
  transfer_date: string
  from_pond_id: number
  from_pond_name: string
  fish_species_label?: string
  lines: { to_pond_id: number; to_pond_name?: string; weight_kg: string; fish_count?: number | null }[]
}

interface LedgerRow {
  id: number
  entry_date: string
  entry_kind_label?: string
  fish_species_label?: string
  fish_count_delta: number
  weight_kg_delta: string
  memo: string
}

function sampleMeanWeightKg(s: SampleRow): number | null {
  if (s.avg_weight_kg != null && s.avg_weight_kg !== '') {
    const n = Number(s.avg_weight_kg)
    return Number.isFinite(n) && n > 0 ? n : null
  }
  const tw = s.estimated_total_weight_kg
  const fc = s.estimated_fish_count
  if (tw != null && tw !== '' && fc != null && fc > 0) {
    const n = Number(tw) / fc
    return Number.isFinite(n) && n > 0 ? n : null
  }
  return null
}

function sampleTotalBiomassKg(s: SampleRow): number | null {
  if (s.estimated_total_weight_kg == null || s.estimated_total_weight_kg === '') return null
  const n = Number(s.estimated_total_weight_kg)
  return Number.isFinite(n) ? n : null
}

function fmtMoney(n: number | null | undefined, digits = 2): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—'
  return formatNumber(n, digits)
}

export default function PondDetailViewPage() {
  const params = useParams()
  const pondIdRaw = params?.pondId
  const pondId = typeof pondIdRaw === 'string' ? pondIdRaw : Array.isArray(pondIdRaw) ? pondIdRaw[0] : ''
  const pondIdNum = Number(pondId)
  const toast = useToast()

  const [preset, setPreset] = useState<PeriodPreset>('this_month')
  const [customStart, setCustomStart] = useState(() => periodRange('this_month').start)
  const [customEnd, setCustomEnd] = useState(() => periodRange('this_month').end)
  const { start, end, label: periodLabel } = useMemo(
    () => activeDateRange(preset, customStart, customEnd),
    [preset, customStart, customEnd],
  )

  const applyPresetButton = useCallback((p: PresetButton) => {
    const r = periodRange(p)
    setPreset(p)
    setCustomStart(r.start)
    setCustomEnd(r.end)
  }, [])

  const [currency, setCurrency] = useState('BDT')
  const [loading, setLoading] = useState(true)
  const [pond, setPond] = useState<PondDetail | null>(null)
  const [pl, setPl] = useState<PlResponse | null>(null)
  const [sales, setSales] = useState<SaleRow[]>([])
  const [expenses, setExpenses] = useState<ExpenseRow[]>([])
  const [samples, setSamples] = useState<SampleRow[]>([])
  const [cycles, setCycles] = useState<CycleRow[]>([])
  const [stock, setStock] = useState<StockRow | null>(null)
  const [transfers, setTransfers] = useState<TransferRow[]>([])
  const [ledger, setLedger] = useState<LedgerRow[]>([])
  const [warehouseRows, setWarehouseRows] = useState<WarehouseStockRow[]>([])
  const [pondWarehouseReceipts, setPondWarehouseReceipts] = useState<PondWarehouseReceipt[]>([])
  const [warehouseLoadError, setWarehouseLoadError] = useState<string | null>(null)
  const [warehouseRefreshing, setWarehouseRefreshing] = useState(false)
  const [inventoryItems, setInventoryItems] = useState<ItemPickRow[]>([])
  const [defaultFeedSel, setDefaultFeedSel] = useState('')
  const [defaultFeedSaving, setDefaultFeedSaving] = useState(false)
  const load = useCallback(async () => {
    if (!Number.isFinite(pondIdNum)) return
    setLoading(true)
    try {
      const [
        co,
        pondRes,
        plRes,
        salRes,
        expRes,
        smpRes,
        cyRes,
        stkRes,
        trOut,
        trIn,
        ledRes,
        whOutcome,
        pwrRes,
        itemsPick,
      ] = await Promise.all([
        api.get<Record<string, unknown>>('/companies/current/'),
        api.get<PondDetail>(`/aquaculture/ponds/${pondIdNum}/`),
        api.get<PlResponse>('/aquaculture/pl-summary/', {
          params: { start_date: start, end_date: end, pond_id: pondIdNum },
        }),
        api.get<SaleRow[]>('/aquaculture/sales/', { params: { pond_id: pondIdNum } }),
        api.get<ExpenseRow[]>('/aquaculture/expenses/', { params: { pond_id: pondIdNum } }),
        api.get<SampleRow[]>('/aquaculture/samples/', { params: { pond_id: pondIdNum } }),
        api.get<CycleRow[]>('/aquaculture/production-cycles/', { params: { pond_id: pondIdNum } }),
        api.get<{ rows: StockRow[] }>('/aquaculture/fish-stock-position/', { params: { pond_id: pondIdNum } }).catch(
          () => ({ data: { rows: [] } }),
        ),
        api.get<{ transfers: TransferRow[] }>('/aquaculture/fish-pond-transfers/', {
          params: { from_pond_id: pondIdNum },
        }),
        api.get<{ transfers: TransferRow[] }>('/aquaculture/fish-pond-transfers/', {
          params: { to_pond_id: pondIdNum },
        }),
        api.get<LedgerRow[]>('/aquaculture/fish-stock-ledger/', { params: { pond_id: pondIdNum } }).catch(() => ({
          data: [],
        })),
        api
          .get<{ items: WarehouseStockRow[] }>(`/aquaculture/ponds/${pondIdNum}/warehouse-stock/`)
          .then(response => ({ whOk: true as const, response }))
          .catch((err: unknown) => ({ whOk: false as const, err })),
        api.get<PondWarehouseReceipt[]>('/inventory/pond-warehouse-receipts/').catch(() => ({ data: [] })),
        api.get<ItemPickRow[]>('/items/', { params: { pos_only: 'true' } }).catch(() => ({ data: [] })),
      ])
      setCurrency(String(co.data?.currency || 'BDT').slice(0, 3))
      setPond(pondRes.data)
      setPl(plRes.data)
      setSales(Array.isArray(salRes.data) ? salRes.data : [])
      setExpenses(Array.isArray(expRes.data) ? expRes.data : [])
      setSamples(Array.isArray(smpRes.data) ? smpRes.data : [])
      setCycles(Array.isArray(cyRes.data) ? cyRes.data : [])
      const rows = stkRes.data?.rows
      setStock(Array.isArray(rows) && rows[0] ? rows[0] : null)
      const tmap = new Map<number, TransferRow>()
      for (const t of trOut.data?.transfers ?? []) tmap.set(t.id, t)
      for (const t of trIn.data?.transfers ?? []) tmap.set(t.id, t)
      setTransfers([...tmap.values()].sort((a, b) => b.transfer_date.localeCompare(a.transfer_date)))
      setLedger(Array.isArray(ledRes.data) ? ledRes.data : [])
      if (whOutcome.whOk) {
        setWarehouseRows(
          Array.isArray(whOutcome.response.data?.items) ? whOutcome.response.data.items : [],
        )
        setWarehouseLoadError(null)
      } else {
        setWarehouseRows([])
        setWarehouseLoadError(extractErrorMessage(whOutcome.err, 'Could not load pond warehouse stock'))
      }
      setPondWarehouseReceipts(Array.isArray(pwrRes.data) ? pwrRes.data : [])
      const rawItems = Array.isArray(itemsPick.data) ? itemsPick.data : []
      setInventoryItems(rawItems.filter((it) => (it.item_type || '').toLowerCase() === 'inventory'))
    } catch (e) {
      toast.error(extractErrorMessage(e, 'Could not load pond'))
      setPond(null)
    } finally {
      setLoading(false)
    }
  }, [toast, start, end, pondIdNum])

  const refreshWarehouseStock = useCallback(async () => {
    if (!Number.isFinite(pondIdNum)) return
    setWarehouseRefreshing(true)
    try {
      const wh = await api.get<{ items: WarehouseStockRow[] }>(
        `/aquaculture/ponds/${pondIdNum}/warehouse-stock/`,
      )
      setWarehouseRows(Array.isArray(wh.data?.items) ? wh.data.items : [])
      setWarehouseLoadError(null)
    } catch (e) {
      setWarehouseRows([])
      setWarehouseLoadError(extractErrorMessage(e, 'Could not load pond warehouse stock'))
    } finally {
      setWarehouseRefreshing(false)
    }
  }, [pondIdNum])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'visible' && Number.isFinite(pondIdNum)) {
        void refreshWarehouseStock()
      }
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [pondIdNum, refreshWarehouseStock])

  useEffect(() => {
    if (pond?.default_feed_item_id != null) setDefaultFeedSel(String(pond.default_feed_item_id))
    else setDefaultFeedSel('')
  }, [pond?.default_feed_item_id])

  const saveDefaultFeed = useCallback(async () => {
    if (!Number.isFinite(pondIdNum)) return
    setDefaultFeedSaving(true)
    try {
      const body =
        defaultFeedSel === ''
          ? { default_feed_item_id: null }
          : { default_feed_item_id: Number.parseInt(defaultFeedSel, 10) }
      if (defaultFeedSel !== '' && !Number.isFinite(body.default_feed_item_id as number)) {
        toast.error('Pick a valid feed product')
        setDefaultFeedSaving(false)
        return
      }
      await api.put(`/aquaculture/ponds/${pondIdNum}/`, body)
      toast.success('Default feed product saved')
      void load()
    } catch (e) {
      toast.error(extractErrorMessage(e, 'Could not save'))
    } finally {
      setDefaultFeedSaving(false)
    }
  }, [pondIdNum, defaultFeedSel, load, toast])

  const sym = getCurrencySymbol(currency)

  const warehouseByCategory = useMemo(() => groupWarehouseRows(warehouseRows), [warehouseRows])

  const receiptsForThisPond = useMemo(
    () =>
      pondWarehouseReceipts
        .filter((r) => r.pond_id === pondIdNum)
        .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || '')),
    [pondWarehouseReceipts, pondIdNum],
  )

  const recentPondWarehouseConsumption = useMemo(
    () =>
      [...expenses]
        .filter(
          (e) => e.expense_category === 'feed_consumed' || e.expense_category === 'medicine_consumed',
        )
        .sort((a, b) => b.expense_date.localeCompare(a.expense_date))
        .slice(0, 12),
    [expenses],
  )

  const salesInPeriod = useMemo(
    () => sales.filter((s) => inRange(s.sale_date, start, end)),
    [sales, start, end],
  )
  const expensesInPeriod = useMemo(
    () => expenses.filter((e) => inRange(e.expense_date, start, end)),
    [expenses, start, end],
  )
  const samplesInPeriod = useMemo(
    () => samples.filter((s) => inRange(s.sample_date, start, end)),
    [samples, start, end],
  )
  const transfersInPeriod = useMemo(
    () => transfers.filter((t) => inRange(t.transfer_date, start, end)),
    [transfers, start, end],
  )
  const ledgerInPeriod = useMemo(
    () => ledger.filter((r) => inRange(r.entry_date, start, end)),
    [ledger, start, end],
  )

  const harvestKg = useMemo(
    () =>
      salesInPeriod
        .filter((s) => !s.income_type || s.income_type === 'fish_harvest_sale')
        .reduce((a, s) => a + parseNum(s.weight_kg), 0),
    [salesInPeriod],
  )

  const feedKgRecorded = useMemo(
    () =>
      expensesInPeriod
        .filter((e) => e.expense_category === 'feed_consumed')
        .reduce((a, e) => a + parseNum(e.feed_weight_kg ?? undefined), 0),
    [expensesInPeriod],
  )

  const fcrHarvest = harvestKg > 0 ? feedKgRecorded / harvestKg : null

  const sampleMetrics = useMemo(() => {
    const usable = samplesInPeriod
      .map((s) => ({
        s,
        mean: sampleMeanWeightKg(s),
        total: sampleTotalBiomassKg(s),
        day: s.sample_date.split('T')[0],
      }))
      .filter((x) => x.mean != null || x.total != null)
      .sort((a, b) => a.day.localeCompare(b.day))

    if (usable.length < 2) {
      return {
        adgGPerFishPerDay: null as number | null,
        biomassGainKg: null as number | null,
        sampleSpanDays: null as number | null,
        firstDate: usable[0]?.day ?? null,
        lastDate: usable[usable.length - 1]?.day ?? null,
      }
    }
    const first = usable[0]
    const last = usable[usable.length - 1]
    const span = daysSpanInclusive(first.day, last.day)

    let adg: number | null = null
    if (first.mean != null && last.mean != null) {
      adg = ((last.mean - first.mean) * 1000) / span
    }

    let biomassGain: number | null = null
    if (first.total != null && last.total != null) {
      biomassGain = last.total - first.total
    }

    return {
      adgGPerFishPerDay: adg,
      biomassGainKg: biomassGain,
      sampleSpanDays: span,
      firstDate: first.day,
      lastDate: last.day,
    }
  }, [samplesInPeriod])

  const fcrBiomass =
    sampleMetrics.biomassGainKg != null && sampleMetrics.biomassGainKg > 0 && feedKgRecorded > 0
      ? feedKgRecorded / sampleMetrics.biomassGainKg
      : null

  const plRow = pl?.ponds?.[0] ?? null

  if (!Number.isFinite(pondIdNum)) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-10 text-sm text-slate-600">
        Invalid pond link.{' '}
        <Link href="/aquaculture/ponds" className="text-teal-700 underline">
          Back to ponds
        </Link>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <Link
          href="/aquaculture/ponds"
          className="inline-flex items-center gap-1 text-sm font-medium text-teal-800 hover:underline"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Ponds
        </Link>
        {pond ? (
          <h1 className="text-xl font-bold text-slate-900">
            {pond.name}
            {pond.code ? (
              <span className="ml-2 text-base font-normal text-slate-500">({pond.code})</span>
            ) : null}
          </h1>
        ) : (
          <h1 className="text-xl font-bold text-slate-900">Pond</h1>
        )}
        <button
          type="button"
          onClick={() => void load()}
          className="ml-auto inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
        >
          <RefreshCw className="h-4 w-4" />
          Refresh
        </button>
      </div>

      {Number.isFinite(pondIdNum) ? (
        <div className="mb-6 flex flex-wrap gap-x-5 gap-y-2 border-b border-slate-200 pb-4 text-sm">
          <Link
            href={`/aquaculture/sales?pond_id=${pondIdNum}`}
            className="font-medium text-teal-800 underline decoration-teal-600/40 underline-offset-2 hover:decoration-teal-900"
          >
            Pond &amp; fish sales
          </Link>
          <Link
            href={`/aquaculture/expenses?pond_id=${pondIdNum}`}
            className="font-medium text-teal-800 underline decoration-teal-600/40 underline-offset-2 hover:decoration-teal-900"
          >
            Pond costs
          </Link>
          <Link
            href="/aquaculture/stock"
            className="font-medium text-slate-700 underline decoration-slate-400/50 underline-offset-2 hover:text-slate-900"
          >
            Pond stock
          </Link>
        </div>
      ) : null}

      <div className="mb-6 flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-center gap-2 text-slate-700">
          <CalendarRange className="h-5 w-5 text-slate-400" aria-hidden />
          <span className="text-sm font-medium">Period</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {(
            [
              ['this_month', 'This month'],
              ['last_month', 'Last month'],
              ['ytd', 'YTD'],
              ['last_90', '90 days'],
            ] as const
          ).map(([k, lab]) => (
            <button
              key={k}
              type="button"
              onClick={() => applyPresetButton(k)}
              className={`rounded-lg px-3 py-1.5 text-sm ${
                preset === k ? 'bg-teal-600 font-medium text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              {lab}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setPreset('custom')}
            className={`rounded-lg px-3 py-1.5 text-sm ${
              preset === 'custom' ? 'bg-teal-600 font-medium text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            Custom
          </button>
        </div>
        {preset === 'custom' ? (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <label className="text-slate-600">
              From
              <input
                type="date"
                className="ml-1 rounded border border-slate-300 px-2 py-1"
                value={customStart}
                onChange={(e) => setCustomStart(e.target.value)}
              />
            </label>
            <label className="text-slate-600">
              To
              <input
                type="date"
                className="ml-1 rounded border border-slate-300 px-2 py-1"
                value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
              />
            </label>
          </div>
        ) : null}
        <p className="w-full text-xs text-slate-500 sm:ml-auto sm:w-auto">
          {periodLabel}: {formatDateOnly(start)} → {formatDateOnly(end)}
        </p>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="h-10 w-10 animate-spin rounded-full border-2 border-slate-200 border-t-teal-600" />
        </div>
      ) : !pond ? (
        <p className="text-sm text-slate-600">Pond not found.</p>
      ) : (
        <>
          <section className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <Sprout className="h-4 w-4" aria-hidden />
                ADG (sample-based)
              </p>
              <p className="mt-2 text-2xl font-semibold tabular-nums text-slate-900">
                {sampleMetrics.adgGPerFishPerDay != null && Number.isFinite(sampleMetrics.adgGPerFishPerDay)
                  ? `${formatNumber(sampleMetrics.adgGPerFishPerDay, 2)} g/fish/day`
                  : '—'}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                From first to last biomass sample in range (mean weight). Needs two samples with average weight (or
                total kg ÷ fish count).
                {sampleMetrics.firstDate && sampleMetrics.lastDate ? (
                  <>
                    {' '}
                    Span: {sampleMetrics.sampleSpanDays ?? '—'} days ({sampleMetrics.firstDate} →{' '}
                    {sampleMetrics.lastDate}).
                  </>
                ) : null}
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <Scale className="h-4 w-4" aria-hidden />
                FCR (feed ÷ biomass gain)
              </p>
              <p className="mt-2 text-2xl font-semibold tabular-nums text-slate-900">
                {fcrBiomass != null ? formatNumber(fcrBiomass, 2) : '—'}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Feed kg recorded on expenses ÷ (last sample total kg − first sample total kg) in this period. Positive
                gain required.
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <Fish className="h-4 w-4" aria-hidden />
                FCR (feed ÷ harvest kg)
              </p>
              <p className="mt-2 text-2xl font-semibold tabular-nums text-slate-900">
                {fcrHarvest != null ? formatNumber(fcrHarvest, 2) : '—'}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Feed kg on lines in period ÷ harvest sale kg (<code className="rounded bg-slate-100 px-1">fish_harvest_sale</code>
                ).
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Feed recorded (kg)</p>
              <p className="mt-2 text-2xl font-semibold tabular-nums text-slate-900">{formatNumber(feedKgRecorded, 2)}</p>
              <p className="mt-1 text-xs text-slate-500">Sum of feed kg fields on pond expenses in range (incl. shared splits).</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Harvest in period (kg)</p>
              <p className="mt-2 text-2xl font-semibold tabular-nums text-slate-900">{formatNumber(harvestKg, 2)}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Biomass Δ (samples, kg)</p>
              <p className="mt-2 text-2xl font-semibold tabular-nums text-slate-900">
                {sampleMetrics.biomassGainKg != null ? formatNumber(sampleMetrics.biomassGainKg, 2) : '—'}
              </p>
              <p className="mt-1 text-xs text-slate-500">Last − first estimated total weight in period (needs both).</p>
            </div>
          </section>

          <div className="mb-6 grid gap-4 lg:grid-cols-2">
            <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-sm font-semibold text-slate-900">Pond profile</h2>
              <dl className="mt-3 grid gap-2 text-sm">
                <div className="flex justify-between gap-2 border-b border-slate-50 py-1">
                  <dt className="text-slate-500">Role</dt>
                  <dd className="font-medium text-slate-800">{pond.pond_role_label || pond.pond_role || '—'}</dd>
                </div>
                <div className="flex justify-between gap-2 border-b border-slate-50 py-1">
                  <dt className="text-slate-500">Status</dt>
                  <dd className="font-medium text-slate-800">{pond.is_active ? 'Active' : 'Inactive'}</dd>
                </div>
                <div className="flex justify-between gap-2 border-b border-slate-50 py-1">
                  <dt className="text-slate-500">Sort order</dt>
                  <dd className="tabular-nums text-slate-800">{pond.sort_order}</dd>
                </div>
                <div className="flex justify-between gap-2 border-b border-slate-50 py-1">
                  <dt className="text-slate-500">Leasing / water / depth</dt>
                  <dd className="text-right text-slate-800">
                    {pond.leasing_area_decimal ? `L ${pond.leasing_area_decimal} dec` : '—'}
                    {pond.water_area_decimal ? ` · W ${pond.water_area_decimal} dec` : ''}
                    {pond.pond_depth_ft ? ` · ${pond.pond_depth_ft} ft` : ''}
                  </dd>
                </div>
                <div className="flex justify-between gap-2 border-b border-slate-50 py-1">
                  <dt className="text-slate-500">Water volume</dt>
                  <dd className="tabular-nums text-slate-800">
                    {pond.water_volume_cu_ft ? `${formatNumber(Number(pond.water_volume_cu_ft), 0)} cu ft` : '—'}
                  </dd>
                </div>
                <div className="flex justify-between gap-2 border-b border-slate-50 py-1">
                  <dt className="text-slate-500">POS customer</dt>
                  <dd className="text-right text-slate-800">
                    {pond.pos_customer_id
                      ? `${pond.pos_customer_display?.trim() || `Customer #${pond.pos_customer_id}`}${pond.pos_customer_auto_managed ? ' (auto)' : ''}`
                      : '—'}
                  </dd>
                </div>
                <div className="flex justify-between gap-2 border-b border-slate-50 py-1">
                  <dt className="text-slate-500">Lease period</dt>
                  <dd className="text-right text-slate-800">
                    {pond.lease_contract_start || pond.lease_contract_end
                      ? `${formatDateOnly(pond.lease_contract_start)} → ${formatDateOnly(pond.lease_contract_end)}`
                      : '—'}
                  </dd>
                </div>
                <div className="flex justify-between gap-2 border-b border-slate-50 py-1">
                  <dt className="text-slate-500">Annual / contract / paid / balance</dt>
                  <dd className="text-right tabular-nums text-slate-800">
                    {fmtMoney(pond.lease_annual_amount ? Number(pond.lease_annual_amount) : null)} /{' '}
                    {fmtMoney(pond.lease_contract_total ? Number(pond.lease_contract_total) : null)} /{' '}
                    {fmtMoney(Number(pond.lease_paid_to_landlord))} /{' '}
                    {fmtMoney(pond.lease_balance_due != null ? Number(pond.lease_balance_due) : null)}
                  </dd>
                </div>
                {pond.lease_payment_status ? (
                  <div className="rounded-lg border border-teal-100 bg-teal-50/60 py-2">
                    <div className="flex justify-between gap-2 px-1">
                      <dt className="text-teal-900">Lease — contract total</dt>
                      <dd className="tabular-nums font-medium text-teal-950">
                        {fmtMoney(
                          pond.lease_payment_status.contract_total != null
                            ? Number(pond.lease_payment_status.contract_total)
                            : null,
                        )}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-2 border-t border-teal-100/80 px-1 pt-1">
                      <dt className="text-teal-900">Paid to landlord</dt>
                      <dd className="tabular-nums font-medium text-teal-950">
                        {fmtMoney(Number(pond.lease_payment_status.paid_total))}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-2 border-t border-teal-100/80 px-1 pt-1">
                      <dt className="text-teal-900">Outstanding</dt>
                      <dd className="tabular-nums font-medium text-teal-950">
                        {fmtMoney(
                          pond.lease_payment_status.outstanding != null
                            ? Number(pond.lease_payment_status.outstanding)
                            : null,
                        )}
                      </dd>
                    </div>
                  </div>
                ) : null}
                {(pond.landlord_pond_shares?.length ?? 0) > 0 ? (
                  <div className="border-b border-slate-50 py-2">
                    <dt className="flex items-center gap-1 text-slate-500">
                      <Landmark className="h-3.5 w-3.5" aria-hidden />
                      Landlords on this pond
                    </dt>
                    <dd className="mt-2 space-y-1 text-right text-slate-800">
                      {pond.landlord_pond_shares!.map((s) => (
                        <div key={s.id} className="flex flex-wrap justify-between gap-2 text-sm">
                          <span className="text-left">
                            <Link
                              href={`/aquaculture/landlords/${s.landlord_id}`}
                              className="font-medium text-teal-800 underline hover:text-teal-950"
                            >
                              {s.landlord_name || `Landlord #${s.landlord_id}`}
                            </Link>
                            {s.landlord_code ? (
                              <span className="ml-1 text-xs text-slate-500">({s.landlord_code})</span>
                            ) : null}
                          </span>
                          <span className="tabular-nums">{s.land_area_decimal} dec</span>
                        </div>
                      ))}
                    </dd>
                  </div>
                ) : null}
                {pond.notes?.trim() ? (
                  <div className="pt-1">
                    <dt className="text-slate-500">Notes</dt>
                    <dd className="mt-1 text-slate-700">{pond.notes.trim()}</dd>
                  </div>
                ) : null}
              </dl>
            </section>

            <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <Gauge className="h-4 w-4 text-slate-500" aria-hidden />
                Current stock & tilapia load
              </h2>
              <dl className="mt-3 space-y-2 text-sm">
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-500">Implied net (all species)</dt>
                  <dd className="tabular-nums text-slate-800">
                    {stock
                      ? `${formatNumber(stock.implied_net_fish_count, 0)} fish · ${formatNumber(parseNum(stock.implied_net_weight_kg), 2)} kg`
                      : '—'}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-500">Tilapia net</dt>
                  <dd className="tabular-nums text-slate-800">
                    {pond.tilapia_net_fish_count != null
                      ? `${formatNumber(pond.tilapia_net_fish_count, 0)} fish · ${formatNumber(parseNum(pond.tilapia_net_weight_kg), 2)} kg`
                      : '—'}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-500">Kg per decimal (tilapia)</dt>
                  <dd className="tabular-nums text-slate-800">
                    {pond.tilapia_kg_per_decimal != null && pond.tilapia_kg_per_decimal !== ''
                      ? `${formatNumber(Number(pond.tilapia_kg_per_decimal), 3)} kg/dec`
                      : '—'}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-500">Load status</dt>
                  <dd className="font-medium text-slate-800">{pond.tilapia_load_level_label || '—'}</dd>
                </div>
              </dl>
            </section>
          </div>

          <section className="mb-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-slate-900">Pond warehouse</h2>
              <button
                type="button"
                disabled={warehouseRefreshing || !Number.isFinite(pondIdNum)}
                onClick={() => void refreshWarehouseStock()}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${warehouseRefreshing ? 'animate-spin' : ''}`} aria-hidden />
                Refresh stock
              </button>
            </div>
            <p className="mt-1 text-xs text-slate-600">
              On-hand quantities below come only from <strong className="font-medium">Inventory → Move to pond warehouse</strong>{' '}
              (shop station → this pond). Shop stock that stays at the station does not show here. Regular station-to-station
              transfer drafts do not appear here. Internal move — no COGS until feed is applied or consumed. API:{' '}
              <code className="rounded bg-slate-100 px-1">POST /api/aquaculture/pond-warehouse-transfer/</code>
              {' · '}
              <code className="rounded bg-slate-100 px-1">POST /api/aquaculture/pond-warehouse-consume/</code>
            </p>
            {recentPondWarehouseConsumption.length > 0 ? (
              <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50/90 p-3">
                <p className="text-xs font-semibold text-slate-800">Recent pond warehouse use</p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-slate-600">
                  Feed or medicine <strong className="font-medium text-slate-800">consumed</strong> at this pond
                  (including from{' '}
                  <Link href="/aquaculture/feeding" className="font-medium text-teal-800 underline">
                    feeding advice apply
                  </Link>{' '}
                  and{' '}
                  <Link
                    href={`/aquaculture/medicine?pond_id=${pondIdNum}`}
                    className="font-medium text-violet-800 underline"
                  >
                    medicine events
                  </Link>
                  ). Shown from the latest pond expenses — not filtered by the dashboard period above. Click{' '}
                  <strong className="font-medium text-slate-800">Refresh stock</strong> after applying advice on another
                  tab so quantities match the server.
                </p>
                <ul className="mt-2 max-h-44 space-y-1.5 overflow-y-auto text-xs text-slate-800">
                  {recentPondWarehouseConsumption.map((e) => (
                    <li
                      key={e.id}
                      className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 border-b border-slate-100 pb-1.5 last:border-0"
                    >
                      <span>
                        {formatDateOnly(e.expense_date)} · {e.expense_category_label}
                        {e.feed_weight_kg ? (
                          <span className="text-slate-600"> · {e.feed_weight_kg} kg</span>
                        ) : null}
                      </span>
                      <span className="tabular-nums text-slate-700">{getCurrencySymbol(currency)} {e.amount}</span>
                    </li>
                  ))}
                </ul>
                <Link
                  href={`/aquaculture/expenses?pond_id=${pondIdNum}`}
                  className="mt-2 inline-block text-xs font-medium text-teal-800 hover:underline"
                >
                  Open all pond expenses
                </Link>
              </div>
            ) : null}
            {warehouseLoadError ? (
              <div
                className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950"
                role="alert"
              >
                <span className="font-semibold">Warehouse stock could not be loaded.</span> {warehouseLoadError}
              </div>
            ) : null}
            <div className="mt-4 flex flex-wrap items-end gap-3">
              <label className="block min-w-[220px] text-xs font-medium text-slate-700">
                Default feed SKU (for feeding advice apply)
                <select
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2 py-2 text-sm"
                  value={defaultFeedSel}
                  onChange={(e) => setDefaultFeedSel(e.target.value)}
                >
                  <option value="">None</option>
                  {inventoryItems.map((it) => (
                    <option key={it.id} value={it.id}>
                      {it.name}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                disabled={defaultFeedSaving}
                onClick={() => void saveDefaultFeed()}
                className="rounded-lg bg-teal-700 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {defaultFeedSaving ? 'Saving…' : 'Save default feed'}
              </button>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-2 rounded-lg border border-violet-100 bg-violet-50/80 px-3 py-2.5">
              <p className="text-xs text-violet-950">
                Record treatments and default medicine SKU on the dedicated page.
              </p>
              <Link
                href={`/aquaculture/medicine?pond_id=${pondIdNum}`}
                className="inline-flex items-center gap-1 rounded-lg bg-violet-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-violet-800"
              >
                Medicine events →
              </Link>
            </div>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[360px] text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-xs uppercase text-slate-500">
                    <th className="py-2 pr-3">Item</th>
                    <th className="py-2 pr-3">Qty</th>
                    <th className="py-2">Unit</th>
                  </tr>
                </thead>
                {warehouseLoadError && warehouseRows.length === 0 ? (
                  <tbody>
                    <tr>
                      <td colSpan={3} className="py-3 text-xs text-slate-500">
                        After fixing the issue above, click <strong className="font-medium text-slate-700">Refresh stock</strong>.
                      </td>
                    </tr>
                  </tbody>
                ) : null}
                {warehouseRows.length === 0 && !warehouseLoadError ? (
                  <tbody>
                    <tr>
                      <td colSpan={3} className="py-4 text-slate-600">
                        <p className="text-sm font-medium text-slate-800">No on-hand stock at this pond warehouse.</p>
                        {receiptsForThisPond.length > 0 ? (
                          <div className="mt-3 max-w-xl rounded-lg border border-sky-200 bg-sky-50/80 px-3 py-2 text-xs text-sky-950">
                            <p className="font-medium text-sky-900">
                              Stock was moved here from the shop before; the balance is now zero (for example everything was
                              consumed via feeding advice or medicine use). Recent shop → pond receipts:
                            </p>
                            <ul className="mt-2 space-y-1.5">
                              {receiptsForThisPond.slice(0, 5).map((rec) => (
                                <li key={rec.id} className="border-t border-sky-100/80 pt-1.5 first:border-t-0 first:pt-0">
                                  <span className="tabular-nums text-sky-800">
                                    {rec.receipt_number || `Receipt #${rec.id}`}
                                  </span>
                                  {rec.created_at ? (
                                    <span className="text-sky-700">
                                      {' '}
                                      · {formatDateOnly(rec.created_at)}
                                    </span>
                                  ) : null}
                                  {rec.from_station_name ? (
                                    <span className="text-sky-700"> · from {rec.from_station_name}</span>
                                  ) : null}
                                  <div className="mt-0.5 text-sky-800">
                                    {rec.lines
                                      .map((ln) => `${ln.item_name || `Item #${ln.item_id}`} (${ln.quantity})`)
                                      .join(', ') || '—'}
                                  </div>
                                </li>
                              ))}
                            </ul>
                            <p className="mt-2 text-sky-800">
                              Full history:{' '}
                              <Link href="/inventory" className="font-medium text-teal-800 underline hover:text-teal-950">
                                Inventory
                              </Link>{' '}
                              → Pond warehouse receipts.
                            </p>
                          </div>
                        ) : null}
                        <ul className="mt-2 max-w-xl list-disc space-y-1.5 pl-5 text-xs leading-relaxed">
                          <li>
                            If you expected to see shop inventory here: it only appears after a{' '}
                            <strong className="font-medium">Move to pond warehouse</strong> from{' '}
                            <Link href="/inventory" className="font-medium text-teal-700 underline hover:text-teal-800">
                              Inventory
                            </Link>
                            . Choose your <strong className="font-medium">home station</strong> as the source, destination{' '}
                            <strong className="font-medium">this pond</strong>, add lines, then submit the move.
                          </li>
                          <li>
                            The SKU must be <strong className="font-medium">inventory</strong> and{' '}
                            <strong className="font-medium">tracked per station</strong> (not tank-only fuel). If the move
                            fails, the error toast explains the rule.
                          </li>
                          <li>
                            After a successful move, use <strong className="font-medium">Refresh stock</strong> above if the
                            table did not update.
                          </li>
                          {receiptsForThisPond.length === 0 ? (
                            <li className="text-slate-500">
                              Pond warehouse receipts in Inventory are filtered to your user&apos;s home station (if set). If
                              you moved stock from another site, ask an admin or use an account that can see that station.
                            </li>
                          ) : null}
                        </ul>
                      </td>
                    </tr>
                  </tbody>
                ) : null}
                {warehouseRows.length > 0
                  ? warehouseByCategory.map(group => (
                      <tbody key={group.key} className="divide-y divide-slate-100">
                        <tr className="bg-slate-50">
                          <td
                            colSpan={3}
                            className="py-2 pl-2 text-[11px] font-semibold uppercase tracking-wide text-slate-600"
                          >
                            {group.label}
                          </td>
                        </tr>
                        {group.rows.map(w => (
                          <tr key={w.item_id}>
                            <td className="py-2 pr-3">
                              <div className="font-medium text-slate-800">{w.item_name}</div>
                              {w.reporting_category && w.reporting_category !== 'General' ? (
                                <div className="text-[11px] text-slate-500">{w.reporting_category}</div>
                              ) : null}
                            </td>
                            <td className="py-2 pr-3 tabular-nums text-slate-800">{w.quantity}</td>
                            <td className="py-2 text-slate-600">{w.unit}</td>
                          </tr>
                        ))}
                      </tbody>
                    ))
                  : null}
              </table>
            </div>
          </section>

          {plRow ? (
            <section className="mb-6 overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-100 px-4 py-3">
                <h2 className="text-sm font-semibold text-slate-900">P&amp;L (selected period, this pond)</h2>
                <p className="text-xs text-slate-500">Matches Aquaculture report when filtered to this pond.</p>
              </div>
              <table className="w-full min-w-[640px] text-left text-sm">
                <tbody className="divide-y divide-slate-100">
                  <tr>
                    <th className="px-4 py-2 text-slate-500">Revenue</th>
                    <td className="px-4 py-2 text-right font-medium tabular-nums text-slate-900">
                      {sym}
                      {formatNumber(parseNum(plRow.revenue), 2)}
                    </td>
                  </tr>
                  <tr>
                    <th className="px-4 py-2 text-slate-500">Operating expenses</th>
                    <td className="px-4 py-2 text-right tabular-nums text-slate-800">
                      {sym}
                      {formatNumber(parseNum(plRow.operating_expenses), 2)}
                    </td>
                  </tr>
                  <tr>
                    <th className="px-4 py-2 text-slate-500">Payroll allocated</th>
                    <td className="px-4 py-2 text-right tabular-nums text-slate-800">
                      {sym}
                      {formatNumber(parseNum(plRow.payroll_allocated), 2)}
                    </td>
                  </tr>
                  <tr>
                    <th className="px-4 py-2 text-slate-500">Total costs</th>
                    <td className="px-4 py-2 text-right tabular-nums text-slate-800">
                      {sym}
                      {formatNumber(parseNum(plRow.total_costs), 2)}
                    </td>
                  </tr>
                  <tr className="bg-slate-50/80">
                    <th className="px-4 py-2 font-semibold text-slate-800">Profit</th>
                    <td className="px-4 py-2 text-right text-base font-semibold tabular-nums text-teal-900">
                      {sym}
                      {formatNumber(parseNum(plRow.profit), 2)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </section>
          ) : (
            <p className="mb-6 rounded-lg border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              No P&amp;L row for this pond in the selected dates. Inactive ponds are omitted from the P&amp;L engine; use
              transactions below for activity.
            </p>
          )}

          <section className="mb-6">
            <h2 className="mb-2 text-sm font-semibold text-slate-900">Production cycles</h2>
            <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
              <table className="w-full min-w-[520px] text-left text-sm">
                <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-2">Name</th>
                    <th className="px-4 py-2">Code</th>
                    <th className="px-4 py-2">Period</th>
                    <th className="px-4 py-2">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {cycles.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-4 py-6 text-center text-slate-500">
                        No cycles
                      </td>
                    </tr>
                  ) : (
                    cycles.map((c) => (
                      <tr key={c.id}>
                        <td className="px-4 py-2 font-medium text-slate-900">{c.name}</td>
                        <td className="px-4 py-2 text-slate-600">{c.code || '—'}</td>
                        <td className="px-4 py-2 text-slate-600">
                          {formatDateOnly(c.start_date)} → {formatDateOnly(c.end_date)}
                        </td>
                        <td className="px-4 py-2">{c.is_active !== false ? 'Active' : 'Inactive'}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="mb-6">
            <h2 className="mb-2 text-sm font-semibold text-slate-900">Expenses in period</h2>
            <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-2">Date</th>
                    <th className="px-4 py-2">Category</th>
                    <th className="px-4 py-2 text-right">Amount</th>
                    <th className="px-4 py-2 text-right">Feed kg</th>
                    <th className="px-4 py-2">Memo</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {expensesInPeriod.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-6 text-center text-slate-500">
                        None
                      </td>
                    </tr>
                  ) : (
                    expensesInPeriod.map((e) => (
                      <tr key={e.id}>
                        <td className="whitespace-nowrap px-4 py-2">{formatDateOnly(e.expense_date)}</td>
                        <td className="px-4 py-2">
                          {e.expense_category_label}
                          {e.is_shared ? (
                            <span className="ml-1 rounded bg-slate-100 px-1.5 text-[10px] font-semibold text-slate-600">
                              Shared
                            </span>
                          ) : null}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums">
                          {sym}
                          {formatNumber(parseNum(e.amount), 2)}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums text-slate-700">
                          {e.feed_weight_kg != null && e.feed_weight_kg !== ''
                            ? formatNumber(parseNum(e.feed_weight_kg), 2)
                            : '—'}
                        </td>
                        <td className="max-w-xs truncate px-4 py-2 text-slate-600" title={e.memo}>
                          {e.memo || '—'}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="mb-6">
            <h2 className="mb-2 text-sm font-semibold text-slate-900">Sales in period</h2>
            <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-2">Date</th>
                    <th className="px-4 py-2">Type</th>
                    <th className="px-4 py-2 text-right">Kg</th>
                    <th className="px-4 py-2 text-right">Amount</th>
                    <th className="px-4 py-2">Species</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {salesInPeriod.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-6 text-center text-slate-500">
                        None
                      </td>
                    </tr>
                  ) : (
                    salesInPeriod.map((s) => (
                      <tr key={s.id}>
                        <td className="whitespace-nowrap px-4 py-2">{formatDateOnly(s.sale_date)}</td>
                        <td className="px-4 py-2 text-slate-700">{s.income_type_label || s.income_type || '—'}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{formatNumber(parseNum(s.weight_kg), 2)}</td>
                        <td className="px-4 py-2 text-right tabular-nums">
                          {sym}
                          {formatNumber(parseNum(s.total_amount), 2)}
                        </td>
                        <td className="px-4 py-2 text-slate-600">{s.fish_species_label || '—'}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="mb-6">
            <h2 className="mb-2 text-sm font-semibold text-slate-900">Biomass samples in period</h2>
            <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-2">Date</th>
                    <th className="px-4 py-2 text-right">Est. fish</th>
                    <th className="px-4 py-2 text-right">Total kg</th>
                    <th className="px-4 py-2 text-right">Avg kg</th>
                    <th className="px-4 py-2">Species</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {samplesInPeriod.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-6 text-center text-slate-500">
                        None
                      </td>
                    </tr>
                  ) : (
                    [...samplesInPeriod]
                      .sort((a, b) => b.sample_date.localeCompare(a.sample_date))
                      .map((s) => (
                        <tr key={s.id}>
                          <td className="whitespace-nowrap px-4 py-2">{formatDateOnly(s.sample_date)}</td>
                          <td className="px-4 py-2 text-right tabular-nums">
                            {s.estimated_fish_count != null ? formatNumber(s.estimated_fish_count, 0) : '—'}
                          </td>
                          <td className="px-4 py-2 text-right tabular-nums">
                            {s.estimated_total_weight_kg != null && s.estimated_total_weight_kg !== ''
                              ? formatNumber(Number(s.estimated_total_weight_kg), 2)
                              : '—'}
                          </td>
                          <td className="px-4 py-2 text-right tabular-nums">
                            {s.avg_weight_kg != null && s.avg_weight_kg !== ''
                              ? formatNumber(Number(s.avg_weight_kg), 4)
                              : '—'}
                          </td>
                          <td className="px-4 py-2 text-slate-600">{s.fish_species_label || '—'}</td>
                        </tr>
                      ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="mb-6">
            <h2 className="mb-2 text-sm font-semibold text-slate-900">Inter-pond transfers in period</h2>
            <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-2">Date</th>
                    <th className="px-4 py-2">Direction</th>
                    <th className="px-4 py-2">Species</th>
                    <th className="px-4 py-2 text-right">Kg (lines)</th>
                    <th className="px-4 py-2 text-right">Heads</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {transfersInPeriod.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-6 text-center text-slate-500">
                        None
                      </td>
                    </tr>
                  ) : (
                    transfersInPeriod.map((t) => {
                      const out = t.from_pond_id === pondIdNum
                      const lineKg = t.lines?.reduce((a, ln) => a + parseNum(ln.weight_kg), 0) ?? 0
                      const lineHeads =
                        t.lines?.reduce((a, ln) => a + (ln.fish_count != null ? Number(ln.fish_count) : 0), 0) ?? 0
                      return (
                        <tr key={t.id}>
                          <td className="whitespace-nowrap px-4 py-2">{formatDateOnly(t.transfer_date)}</td>
                          <td className="px-4 py-2 text-slate-700">
                            {out ? (
                              <span>
                                Out →{' '}
                                {t.lines
                                  ?.map((l) => l.to_pond_name || `Pond #${l.to_pond_id}`)
                                  .filter(Boolean)
                                  .join(', ') || '—'}
                              </span>
                            ) : (
                              <span>In ← {t.from_pond_name || `Pond #${t.from_pond_id}`}</span>
                            )}
                          </td>
                          <td className="px-4 py-2 text-slate-600">{t.fish_species_label || '—'}</td>
                          <td className="px-4 py-2 text-right tabular-nums">{formatNumber(lineKg, 2)}</td>
                          <td className="px-4 py-2 text-right tabular-nums">{formatNumber(lineHeads, 0)}</td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="mb-10">
            <h2 className="mb-2 text-sm font-semibold text-slate-900">Stock ledger in period</h2>
            <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-2">Date</th>
                    <th className="px-4 py-2">Kind</th>
                    <th className="px-4 py-2 text-right">Δ fish</th>
                    <th className="px-4 py-2 text-right">Δ kg</th>
                    <th className="px-4 py-2">Species</th>
                    <th className="px-4 py-2">Memo</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {ledgerInPeriod.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-6 text-center text-slate-500">
                        None
                      </td>
                    </tr>
                  ) : (
                    ledgerInPeriod.map((r) => (
                      <tr key={r.id}>
                        <td className="whitespace-nowrap px-4 py-2">{formatDateOnly(r.entry_date)}</td>
                        <td className="px-4 py-2">{r.entry_kind_label || '—'}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{formatNumber(r.fish_count_delta, 0)}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{formatNumber(parseNum(r.weight_kg_delta), 2)}</td>
                        <td className="px-4 py-2 text-slate-600">{r.fish_species_label || '—'}</td>
                        <td className="max-w-xs truncate px-4 py-2 text-slate-600" title={r.memo}>
                          {r.memo || '—'}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  )
}
