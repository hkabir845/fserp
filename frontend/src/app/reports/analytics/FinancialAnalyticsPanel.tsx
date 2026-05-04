'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useCompany } from '@/contexts/CompanyContext'
import api from '@/lib/api'
import { formatCurrency, formatPercentage } from '@/utils/formatting'
import { formatDate, formatDateOnly, toDateInputValue } from '@/utils/date'
import {
  BarChart3,
  Box,
  Building2,
  Clock,
  DollarSign,
  FileText,
  LayoutGrid,
  LineChart,
  Percent,
  PieChart as PieChartIcon,
  Download,
  Printer,
  RefreshCw,
  Rows3,
  ShoppingCart,
  Target,
  TrendingUp,
  Users,
  Wallet,
  MapPin,
  type LucideIcon,
} from 'lucide-react'
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  Bar,
  BarChart,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  PieChart,
  Pie,
  Cell,
  RadialBarChart,
  RadialBar,
  Area,
  AreaChart,
  LineChart as RechartsLineChart,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
} from 'recharts'

type KpiCore = {
  total_sales: number
  total_purchases: number
  pl_income: number
  pl_cogs: number
  pl_expenses: number
  gross_profit: number
  net_income: number
}

type KpiExtended = KpiCore & {
  today_sales?: number
  today_invoice_count?: number
  revenue_non_draft?: number
  lifetime_revenue_non_draft?: number
  lifetime_invoice_count?: number
  active_customers?: number
  active_vendors?: number
  bills_total_period?: number
  bills_count_period?: number
  payments_received_period?: number
  payments_made_period?: number
  invoices_period_count?: number
  invoices_all_time_count?: number
  avg_invoice_period?: number
  total_purchases_non_draft?: number
}

type ProfitMixComponent = {
  key: string
  label: string
  amount: number
  pct_of_revenue: number
}

type ProfitMix = {
  revenue_base: number
  components: ProfitMixComponent[]
}

type TsRow = {
  label: string
  start_date: string
  end_date: string
  total_sales: number
  total_purchases: number
  pl_income: number
  pl_cogs: number
  pl_expenses: number
  gross_profit: number
  net_income: number
}

const MAX_RANGE_DAYS = 366

/** Room for currency ticks + grid; avoids clipped labels in embedded /reports layout */
const Y_AXIS_CURRENCY_W = 100
/** Bottom space when Legend sits under the plot */
const M_LEGEND = { top: 12, right: 12, left: 8, bottom: 52 } as const
const M_TIGHT = { top: 12, right: 12, left: 8, bottom: 12 } as const
/** Bar chart with angled category labels */
const M_BAR_X = { top: 12, right: 12, left: 8, bottom: 64 } as const

/** Shared heights so charts fill the workspace without feeling cramped (svh handles mobile browser chrome) */
const CHART_COMPACT =
  'h-[min(26rem,55svh)] min-h-[260px] w-full sm:min-h-[280px] md:min-h-[320px] md:h-[min(30rem,58svh)]'
const CHART_STANDARD =
  'h-[min(30rem,58svh)] min-h-[280px] w-full sm:min-h-[300px] md:min-h-[360px] md:h-[min(34rem,60svh)]'
const CHART_TIMESERIES =
  'h-[min(32rem,62svh)] min-h-[300px] w-full sm:min-h-[320px] md:min-h-[380px] md:h-[min(38rem,65svh)]'

const PROFIT_MIX_COLORS = ['#3b82f6', '#8b5cf6', '#f59e0b', '#10b981']

/** Sale vs COGS vs Expense vs Purchase vs Net income — shared keys and colors for comparison charts */
const FIVE_WAY_SERIES = [
  { dataKey: 'total_sales' as const, label: 'Sale', color: '#3b82f6' },
  { dataKey: 'pl_cogs' as const, label: 'COGS', color: '#f59e0b' },
  { dataKey: 'pl_expenses' as const, label: 'Expense', color: '#f43f5e' },
  { dataKey: 'total_purchases' as const, label: 'Purchase', color: '#8b5cf6' },
  { dataKey: 'net_income' as const, label: 'Net income', color: '#10b981' },
] as const

function defaultDateRange() {
  const end = new Date()
  const start = new Date(end)
  start.setDate(start.getDate() - 29)
  return {
    start: toDateInputValue(start),
    end: toDateInputValue(end),
  }
}

function daysInclusiveIso(startYmd: string, endYmd: string): number {
  const a = new Date(`${startYmd}T12:00:00`)
  const b = new Date(`${endYmd}T12:00:00`)
  if (isNaN(a.getTime()) || isNaN(b.getTime())) return 0
  const diff = Math.round((b.getTime() - a.getTime()) / 86400000)
  return diff + 1
}

/** End = today (local), start = today − (days − 1); inclusive day count = `days`. */
function quickPeriodDatesInclusive(days: number): { start: string; end: string } {
  const end = new Date()
  const start = new Date(end)
  start.setDate(start.getDate() - (days - 1))
  return {
    start: toDateInputValue(start),
    end: toDateInputValue(end),
  }
}

const QUICK_PERIODS = [7, 15, 30, 90] as const

function escapeCsvCell(value: unknown): string {
  if (value === null || value === undefined) return ''
  const str = String(value).replace(/"/g, '""')
  return `"${str}"`
}

type ChartView = 'indicators' | 'bar' | 'horizontal' | 'pie' | 'radial'

function AnalyticsKpiCard({
  title,
  value,
  subtitle,
  icon: Icon,
  iconClass,
}: {
  title: string
  value: string
  subtitle?: string
  icon: LucideIcon
  iconClass: string
}) {
  return (
    <div className="rounded-xl border border-slate-200/90 bg-gradient-to-br from-white to-slate-50/80 p-4 shadow-sm ring-1 ring-slate-200/40">
      <div className="flex gap-3">
        <div
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${iconClass}`}
        >
          <Icon className="h-5 w-5 text-white" strokeWidth={2} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">{title}</p>
          <p className="mt-1 text-xl font-semibold tabular-nums tracking-tight text-neutral-900">{value}</p>
          {subtitle ? <p className="mt-1 text-xs leading-snug text-neutral-500">{subtitle}</p> : null}
        </div>
      </div>
    </div>
  )
}

type FinancialAnalyticsPanelProps = {
  /** When true, strip extra outer chrome (used inside main Reports split view) */
  embedInReports?: boolean
  /**
   * When embedded, parent passes the site filter value so analytics reloads when the user changes site.
   * Standalone page can omit (each request still sends `X-Selected-Station-Id` from saved browser preference).
   */
  reportStationKey?: string
}

/** Shared analytics body (KPIs + charts). Used on `/reports/analytics` and embedded in the main Reports page. */
export function FinancialAnalyticsPanel({
  embedInReports = false,
  reportStationKey = '',
}: FinancialAnalyticsPanelProps) {
  const router = useRouter()
  const { selectedCompany } = useCompany()
  const dr = defaultDateRange()
  const [startDate, setStartDate] = useState(dr.start)
  const [endDate, setEndDate] = useState(dr.end)
  const [rangeError, setRangeError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [kpi, setKpi] = useState<KpiExtended | null>(null)
  const [profitMix, setProfitMix] = useState<ProfitMix | null>(null)
  const [timeseries, setTimeseries] = useState<TsRow[]>([])
  const [note, setNote] = useState<string | null>(null)
  const [filterGlStationId, setFilterGlStationId] = useState<number | null>(null)
  const [stationList, setStationList] = useState<{ id: number; station_name: string }[]>([])
  const [profitChartView, setProfitChartView] = useState<ChartView>('bar')

  useEffect(() => {
    const token = localStorage.getItem('access_token')
    if (!token) {
      router.push('/login')
      return
    }
    const raw = localStorage.getItem('user')
    if (raw) {
      try {
        const u = JSON.parse(raw) as { role?: string }
        if ((u.role || '').toLowerCase().replace(/[\s-]+/g, '_') === 'cashier') {
          router.replace('/reports')
        }
        if ((u.role || '').toLowerCase() === 'operator') {
          router.replace('/cashier')
        }
      } catch {
        /* ignore */
      }
    }
  }, [router])

  useEffect(() => {
    let c = true
    api
      .get<{ id: number; station_name: string }[]>('/stations/')
      .then((r) => {
        if (!c || !Array.isArray(r.data)) return
        setStationList(
          r.data.map((s) => ({
            id: s.id,
            station_name: (s.station_name || `Station ${s.id}`).trim(),
          }))
        )
      })
      .catch(() => {
        if (c) setStationList([])
      })
    return () => {
      c = false
    }
  }, [selectedCompany?.id])

  const glSiteBanner = useMemo(() => {
    if (filterGlStationId != null && filterGlStationId > 0) {
      const name =
        stationList.find((s) => s.id === filterGlStationId)?.station_name?.trim() ||
        `Site #${filterGlStationId}`
      return {
        headline: `P&L from general ledger: ${name}`,
        detail:
          'Income, COGS, and expense figures in KPIs and charts use posted journal lines for this site only. Invoice, bill, and payment totals in KPIs remain company-wide.',
      }
    }
    return {
      headline: 'P&L from general ledger: All sites',
      detail:
        'Posted activity includes every site. Choose a site under Reports → Site scope (top of the report list) to focus one location, or ask your admin if your login is tied to a single site.',
    }
  }, [filterGlStationId, stationList])

  const load = useCallback(async () => {
    const span = daysInclusiveIso(startDate, endDate)
    if (span > MAX_RANGE_DAYS) {
      setRangeError(`Select at most ${MAX_RANGE_DAYS} days.`)
      return
    }
    setRangeError(null)
    setLoading(true)
    setError(null)
    try {
      const res = await api.get('/reports/financial-analytics/', {
        params: { start_date: startDate, end_date: endDate },
      })
      if (res.data?.kpis) {
        setKpi(res.data.kpis as KpiExtended)
      } else {
        setKpi(null)
      }
      const rawFid = (res.data as { filter_station_id?: unknown })?.filter_station_id
      const fid =
        typeof rawFid === 'number' && Number.isFinite(rawFid) && rawFid > 0 ? Math.floor(rawFid) : null
      setFilterGlStationId(fid)
      if (res.data?.profit_mix?.components) {
        setProfitMix(res.data.profit_mix as ProfitMix)
      } else {
        setProfitMix(null)
      }
      setTimeseries(Array.isArray(res.data?.timeseries) ? res.data.timeseries : [])
      setNote(typeof res.data?.accounting_note === 'string' ? res.data.accounting_note : null)
    } catch {
      setError('Could not load analytics. Check permissions and try again.')
      setKpi(null)
      setProfitMix(null)
      setTimeseries([])
      setFilterGlStationId(null)
    } finally {
      setLoading(false)
    }
  }, [startDate, endDate, selectedCompany?.id, reportStationKey])

  useEffect(() => {
    void load()
  }, [load, selectedCompany?.id])

  const daysSelected = useMemo(() => daysInclusiveIso(startDate, endDate), [startDate, endDate])

  const matchingQuickPeriod = useMemo(() => {
    for (const d of QUICK_PERIODS) {
      const q = quickPeriodDatesInclusive(d)
      if (startDate === q.start && endDate === q.end) return d
    }
    return null
  }, [startDate, endDate])

  const applyQuickPeriod = useCallback((days: number) => {
    if (days > MAX_RANGE_DAYS) {
      setRangeError(`Select at most ${MAX_RANGE_DAYS} days.`)
      return
    }
    setRangeError(null)
    const q = quickPeriodDatesInclusive(days)
    setStartDate(q.start)
    setEndDate(q.end)
  }, [])

  const mixChartData = useMemo(() => {
    const rows = profitMix?.components
    if (!rows?.length) return []
    return rows.map((c, i) => ({
      ...c,
      name: c.label,
      fill: PROFIT_MIX_COLORS[i % PROFIT_MIX_COLORS.length],
    }))
  }, [profitMix])

  const fiveWayPeriodBars = useMemo(() => {
    if (!kpi) return []
    return FIVE_WAY_SERIES.map((s) => ({
      name: s.label,
      value: kpi[s.dataKey],
      fill: s.color,
    }))
  }, [kpi])

  const fiveWayPieSlices = useMemo(() => {
    if (!kpi) return []
    return FIVE_WAY_SERIES.map((s) => ({
      name: s.label,
      value: Math.abs(kpi[s.dataKey]),
      signed: kpi[s.dataKey],
      fill: s.color,
    }))
  }, [kpi])

  const fiveWayRadarRows = useMemo(() => {
    if (!kpi) return []
    const vals = FIVE_WAY_SERIES.map((s) => Math.abs(kpi[s.dataKey]))
    const maxAbs = Math.max(...vals, 1)
    return FIVE_WAY_SERIES.map((s) => ({
      subject: s.label,
      value: (Math.abs(kpi[s.dataKey]) / maxAbs) * 100,
      fullMark: 100,
      actual: kpi[s.dataKey],
    }))
  }, [kpi])

  const fiveWayRadialRows = useMemo(() => {
    if (!kpi) return []
    const vals = FIVE_WAY_SERIES.map((s) => Math.abs(kpi[s.dataKey]))
    const maxAbs = Math.max(...vals, 1)
    return FIVE_WAY_SERIES.map((s) => ({
      name: s.label,
      value: (Math.abs(kpi[s.dataKey]) / maxAbs) * 100,
      fill: s.color,
      signed: kpi[s.dataKey],
    }))
  }, [kpi])

  const onStartChange = (v: string) => {
    setStartDate(v)
    if (daysInclusiveIso(v, endDate) > MAX_RANGE_DAYS) {
      const end = new Date(`${endDate}T12:00:00`)
      const ns = new Date(`${v}T12:00:00`)
      const adj = new Date(ns)
      adj.setDate(adj.getDate() + (MAX_RANGE_DAYS - 1))
      if (adj < end) {
        setEndDate(toDateInputValue(adj))
      }
    }
  }

  const onEndChange = (v: string) => {
    setEndDate(v)
    if (daysInclusiveIso(startDate, v) > MAX_RANGE_DAYS) {
      const end = new Date(`${v}T12:00:00`)
      const adj = new Date(end)
      adj.setDate(adj.getDate() - (MAX_RANGE_DAYS - 1))
      setStartDate(toDateInputValue(adj))
    }
  }

  const fmt = (n: number) => formatCurrency(n)
  const k = kpi
  /** Angled month labels when many points so ticks stay readable */
  const slantMonthLabels = timeseries.length > 5

  const downloadAnalyticsJson = useCallback(() => {
    const payload = {
      period: { start_date: startDate, end_date: endDate },
      filter_station_id: filterGlStationId,
      kpis: kpi,
      profit_mix: profitMix,
      timeseries,
      accounting_note: note,
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `financial-analytics-${startDate}_${endDate}.json`
    a.click()
    URL.revokeObjectURL(url)
  }, [startDate, endDate, kpi, profitMix, timeseries, note, filterGlStationId])

  const downloadAnalyticsCsv = useCallback(() => {
    const lines: string[] = []
    lines.push('Financial Analytics')
    lines.push(`Period start,${escapeCsvCell(startDate)}`)
    lines.push(`Period end,${escapeCsvCell(endDate)}`)
    lines.push(`GL site scope,${escapeCsvCell(glSiteBanner.headline)}`)
    lines.push(`GL site scope detail,${escapeCsvCell(glSiteBanner.detail)}`)
    if (filterGlStationId != null && filterGlStationId > 0) {
      lines.push(`filter_station_id,${filterGlStationId}`)
    }
    lines.push('')
    lines.push('KPIs')
    lines.push('Metric,Value')
    if (kpi) {
      for (const [key, val] of Object.entries(kpi)) {
        const label = key.replace(/_/g, ' ')
        const cell =
          typeof val === 'number' && Number.isFinite(val)
            ? String(val)
            : escapeCsvCell(val)
        lines.push(`${escapeCsvCell(label)},${cell}`)
      }
    }
    lines.push('')
    lines.push('Profit mix')
    if (profitMix) {
      lines.push(`Revenue base,${profitMix.revenue_base}`)
      lines.push('Component key,Label,Amount,Pct of revenue')
      for (const c of profitMix.components ?? []) {
        lines.push(
          `${escapeCsvCell(c.key)},${escapeCsvCell(c.label)},${c.amount},${c.pct_of_revenue}`
        )
      }
    } else {
      lines.push('(no profit mix data)')
    }
    lines.push('')
    lines.push('Time series')
    lines.push(
      'Label,Start date,End date,Total sales,Total purchases,P&L income,COGS,P&L expenses,Gross profit,Net income'
    )
    for (const row of timeseries) {
      lines.push(
        [
          escapeCsvCell(row.label),
          escapeCsvCell(row.start_date),
          escapeCsvCell(row.end_date),
          row.total_sales,
          row.total_purchases,
          row.pl_income,
          row.pl_cogs,
          row.pl_expenses,
          row.gross_profit,
          row.net_income,
        ].join(',')
      )
    }
    if (note) {
      lines.push('')
      lines.push('Accounting note')
      lines.push(escapeCsvCell(note))
    }
    const csvContent = lines.join('\n')
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `financial-analytics-${startDate}_${endDate}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }, [startDate, endDate, kpi, profitMix, timeseries, note, glSiteBanner, filterGlStationId])

  return (
    <div
      className={
        embedInReports
          ? 'w-full min-w-0 min-h-0'
          : 'w-full min-w-0 min-h-[600px] rounded-lg border border-gray-200 bg-white'
      }
    >
            {loading ? (
              <div
                className={
                  embedInReports
                    ? 'flex min-h-[40svh] items-center justify-center py-16'
                    : 'flex h-[600px] items-center justify-center'
                }
              >
                <div className="text-center">
                  <RefreshCw className="mx-auto mb-4 h-12 w-12 animate-spin text-blue-500" />
                  <p className="text-gray-600">Loading report…</p>
                </div>
              </div>
            ) : (
              <div
                className={
                  embedInReports
                    ? 'w-full min-w-0 space-y-8 p-4 sm:p-6 lg:p-8'
                    : 'w-full min-w-0 space-y-8 p-6 sm:p-7 lg:p-8'
                }
              >
                <div className="mb-6 flex flex-col gap-4 border-b pb-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h2 className="text-2xl font-bold text-gray-900">Analytics &amp; KPIs</h2>
                    <p className="mt-1 text-sm text-gray-500">Generated on {formatDate(new Date())}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => window.print()}
                      className="flex items-center space-x-2 rounded-lg bg-green-600 px-4 py-2 text-white transition-colors hover:bg-green-700"
                      title="Print"
                    >
                      <Printer className="h-4 w-4" />
                      <span>Print</span>
                    </button>
                    <button
                      type="button"
                      onClick={downloadAnalyticsCsv}
                      className="flex items-center space-x-2 rounded-lg bg-blue-600 px-4 py-2 text-white transition-colors hover:bg-blue-700"
                      title="Export as CSV"
                    >
                      <Download className="h-4 w-4" />
                      <span>CSV</span>
                    </button>
                    <button
                      type="button"
                      onClick={downloadAnalyticsJson}
                      className="flex items-center space-x-2 rounded-lg bg-gray-600 px-4 py-2 text-white transition-colors hover:bg-gray-700"
                      title="Export as JSON"
                    >
                      <Download className="h-4 w-4" />
                      <span>JSON</span>
                    </button>
                  </div>
                </div>

                <div className="mb-6 flex gap-3 rounded-lg border border-amber-200/90 bg-amber-50/95 px-4 py-3 text-sm text-amber-950 shadow-sm">
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" aria-hidden />
                  <div>
                    <p className="font-semibold text-amber-950">{glSiteBanner.headline}</p>
                    <p className="mt-0.5 text-amber-900/90">{glSiteBanner.detail}</p>
                  </div>
                </div>

                <div className="mb-6 bg-blue-50 rounded-lg border border-blue-200 p-4">
                  <div className="flex flex-col gap-4">
                    <div className="flex flex-wrap items-end justify-between gap-4">
                      <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                        <label className="whitespace-nowrap text-sm font-medium text-blue-800">
                          Report Period:
                        </label>
                        <input
                          type="date"
                          value={startDate}
                          max={endDate}
                          onChange={(e) => onStartChange(e.target.value)}
                          className="rounded-md border border-blue-300 bg-white px-3 py-1.5 text-sm text-gray-700 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                        <span className="text-sm font-medium text-blue-600">to</span>
                        <input
                          type="date"
                          value={endDate}
                          max={toDateInputValue(new Date())}
                          onChange={(e) => onEndChange(e.target.value)}
                          className="rounded-md border border-blue-300 bg-white px-3 py-1.5 text-sm text-gray-700 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                        <button
                          type="button"
                          onClick={() => void load()}
                          disabled={loading}
                          className="inline-flex items-center gap-2 rounded-lg border border-blue-300 bg-white px-3 py-1.5 text-sm font-medium text-blue-900 shadow-sm hover:bg-blue-100 disabled:opacity-50"
                        >
                          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                          Refresh
                        </button>
                      </div>
                      <p className="max-w-xl text-xs text-blue-600">
                        Revenue uses non-draft invoices; P&amp;L lines follow posted journals (same basis as
                        the Income Statement). Profit mix shows total sales, COGS, expenses, and net income as
                        % of period revenue.
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-medium text-blue-800">Quick period:</span>
                      {QUICK_PERIODS.map((d) => (
                        <button
                          key={d}
                          type="button"
                          onClick={() => applyQuickPeriod(d)}
                          className={`rounded-md px-3 py-1.5 text-xs font-semibold tabular-nums transition-colors ${
                            matchingQuickPeriod === d
                              ? 'bg-white text-blue-600 shadow-sm'
                              : 'bg-blue-100/80 text-blue-800 hover:bg-blue-100'
                          }`}
                        >
                          {d}d
                        </button>
                      ))}
                    </div>
                    <p className="text-xs text-blue-600">
                      {daysSelected} day{daysSelected === 1 ? '' : 's'} selected · max {MAX_RANGE_DAYS} days
                      {' · '}
                      {formatDateOnly(startDate)} → {formatDateOnly(endDate)}
                    </p>
                    {rangeError ? <p className="text-xs text-amber-800">{rangeError}</p> : null}
                  </div>
                </div>

                {error ? (
                  <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
                    {error}
                  </div>
                ) : null}

                {!error && k ? (
            <>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                <AnalyticsKpiCard
                  title="Today's sales"
                  value={fmt(k.today_sales ?? 0)}
                  subtitle={`${k.today_invoice_count ?? 0} invoice(s) dated today`}
                  icon={LineChart}
                  iconClass="bg-sky-500"
                />
                <AnalyticsKpiCard
                  title={`Revenue (${daysSelected}d)`}
                  value={fmt(k.revenue_non_draft ?? k.total_sales)}
                  subtitle="Non-draft invoices in period"
                  icon={BarChart3}
                  iconClass="bg-emerald-500"
                />
                <AnalyticsKpiCard
                  title="Lifetime revenue"
                  value={fmt(k.lifetime_revenue_non_draft ?? k.total_sales)}
                  subtitle={`${k.lifetime_invoice_count ?? 0} invoice(s) total`}
                  icon={DollarSign}
                  iconClass="bg-violet-600"
                />
                <AnalyticsKpiCard
                  title="Customers & vendors"
                  value={`${k.active_customers ?? '—'} / ${k.active_vendors ?? '—'}`}
                  subtitle="Active records in company"
                  icon={Users}
                  iconClass="bg-amber-400"
                />
                <AnalyticsKpiCard
                  title="Bills (AP)"
                  value={fmt(k.bills_total_period ?? k.total_purchases_non_draft ?? k.total_purchases)}
                  subtitle={`${k.bills_count_period ?? 0} bill document(s)`}
                  icon={FileText}
                  iconClass="bg-sky-600"
                />
                <AnalyticsKpiCard
                  title={`Payments in (${daysSelected}d)`}
                  value={fmt(k.payments_received_period ?? 0)}
                  subtitle={`Received · ${fmt(k.payments_made_period ?? 0)} paid to vendors`}
                  icon={Wallet}
                  iconClass="bg-cyan-500"
                />
                <AnalyticsKpiCard
                  title={`Invoices (${daysSelected}d)`}
                  value={String(k.invoices_period_count ?? 0)}
                  subtitle={`${k.invoices_all_time_count ?? 0} invoice(s) all-time`}
                  icon={FileText}
                  iconClass="bg-violet-500"
                />
                <AnalyticsKpiCard
                  title={`Avg invoice (${daysSelected}d)`}
                  value={fmt(k.avg_invoice_period ?? 0)}
                  subtitle="Mean revenue per invoice in period"
                  icon={Clock}
                  iconClass="bg-violet-500"
                />
                <AnalyticsKpiCard
                  title={`Total purchases (${daysSelected}d)`}
                  value={fmt(k.total_purchases_non_draft ?? k.total_purchases)}
                  subtitle="Vendor bills dated in period (excl. draft)"
                  icon={ShoppingCart}
                  iconClass="bg-violet-600"
                />
                <AnalyticsKpiCard
                  title={`Total expenses (${daysSelected}d)`}
                  value={fmt(k.pl_expenses)}
                  subtitle="Posted expense accounts (journal dates in period)"
                  icon={Building2}
                  iconClass="bg-amber-400"
                />
                <AnalyticsKpiCard
                  title={`COGS (${daysSelected}d)`}
                  value={fmt(k.pl_cogs)}
                  subtitle="Posted cost of goods sold (journal dates in period)"
                  icon={Box}
                  iconClass="bg-emerald-600"
                />
                <AnalyticsKpiCard
                  title={`Net income (${daysSelected}d)`}
                  value={fmt(k.net_income)}
                  subtitle="Income statement net for period (posted journals)"
                  icon={Percent}
                  iconClass="bg-violet-600"
                />
              </div>

              <div className="overflow-hidden rounded-xl border border-slate-200/90 bg-white p-4 shadow-sm ring-1 ring-slate-200/50 md:p-6">
                <div className="mb-4 flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                  <div>
                    <h2 className="text-lg font-semibold tracking-tight text-neutral-900">
                      Profit mix (% of period revenue)
                    </h2>
                    <p className="mt-1 max-w-xl text-sm text-neutral-600">
                      Total sales (non-draft invoices in the window), then COGS, operating expenses, and net
                      income — P&amp;L lines from posted journals. Percentages are vs. period revenue (
                      {fmt(profitMix?.revenue_base ?? k.revenue_non_draft ?? 0)}).
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-1 md:justify-end">
                    {(
                      [
                        ['indicators', LayoutGrid, 'Indicators'],
                        ['bar', BarChart3, 'Bar'],
                        ['horizontal', Rows3, 'Horizontal'],
                        ['pie', PieChartIcon, 'Pie'],
                        ['radial', Target, 'Radial'],
                      ] as const
                    ).map(([id, Ico, label]) => (
                      <button
                        key={id}
                        type="button"
                        onClick={() => setProfitChartView(id)}
                        className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                          profitChartView === id
                            ? 'border-sky-300 bg-sky-50 text-sky-900'
                            : 'border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50'
                        }`}
                      >
                        <Ico className="h-3.5 w-3.5" />
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                {mixChartData.length === 0 ? (
                  <p className="py-8 text-center text-sm text-neutral-500">No profit mix data for this range.</p>
                ) : profitChartView === 'indicators' ? (
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    {mixChartData.map((row, i) => (
                      <div
                        key={row.key}
                        className="rounded-lg border border-neutral-100 bg-neutral-50/80 p-4 text-center"
                      >
                        <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">
                          {row.label}
                        </p>
                        <p className="mt-2 text-xl font-semibold tabular-nums text-neutral-900">
                          {fmt(row.amount)}
                        </p>
                        <p className="mt-1 text-sm text-neutral-600">
                          {formatPercentage(row.pct_of_revenue, 1)} of revenue
                        </p>
                        <div
                          className="mx-auto mt-3 h-1.5 max-w-[120px] rounded-full bg-neutral-200"
                          aria-hidden
                        >
                          <div
                            className="h-1.5 rounded-full"
                            style={{
                              width: `${Math.min(100, Math.max(0, row.pct_of_revenue))}%`,
                              backgroundColor: PROFIT_MIX_COLORS[i % PROFIT_MIX_COLORS.length],
                            }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className={CHART_STANDARD}>
                    <ResponsiveContainer width="100%" height="100%" debounce={50}>
                      {profitChartView === 'bar' ? (
                        <BarChart data={mixChartData} margin={M_TIGHT}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                          <XAxis
                            dataKey="label"
                            tick={{ fontSize: 11, fill: '#64748b' }}
                            interval={0}
                            angle={mixChartData.length > 3 ? -28 : 0}
                            textAnchor={mixChartData.length > 3 ? 'end' : 'middle'}
                            height={mixChartData.length > 3 ? 52 : 28}
                          />
                          <YAxis
                            tick={{ fontSize: 11, fill: '#64748b' }}
                            tickFormatter={(v) => fmt(Number(v))}
                            width={Y_AXIS_CURRENCY_W}
                          />
                          <Tooltip
                            formatter={(v: number) => fmt(v)}
                            contentStyle={{ maxWidth: 320 }}
                            wrapperStyle={{ zIndex: 1 }}
                          />
                          <Bar dataKey="amount" radius={[6, 6, 0, 0]}>
                            {mixChartData.map((_, i) => (
                              <Cell key={i} fill={PROFIT_MIX_COLORS[i % PROFIT_MIX_COLORS.length]} />
                            ))}
                          </Bar>
                        </BarChart>
                      ) : profitChartView === 'horizontal' ? (
                        <BarChart
                          layout="vertical"
                          data={mixChartData}
                          margin={{ top: 12, right: 20, left: 8, bottom: 12 }}
                        >
                          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                          <XAxis type="number" tick={{ fontSize: 11, fill: '#64748b' }} tickFormatter={(v) => fmt(Number(v))} />
                          <YAxis type="category" dataKey="label" width={148} tick={{ fontSize: 11, fill: '#64748b' }} />
                          <Tooltip formatter={(v: number) => fmt(v)} contentStyle={{ maxWidth: 300 }} />
                          <Bar dataKey="amount" radius={[0, 6, 6, 0]}>
                            {mixChartData.map((_, i) => (
                              <Cell key={i} fill={PROFIT_MIX_COLORS[i % PROFIT_MIX_COLORS.length]} />
                            ))}
                          </Bar>
                        </BarChart>
                      ) : profitChartView === 'pie' ? (
                        <PieChart margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
                          <Pie
                            data={mixChartData}
                            dataKey="amount"
                            nameKey="label"
                            cx="50%"
                            cy="45%"
                            innerRadius="0%"
                            outerRadius="72%"
                            paddingAngle={2}
                            labelLine={mixChartData.length <= 4}
                            label={({ name, percent }) =>
                              `${String(name).slice(0, 14)}${String(name).length > 14 ? '…' : ''}: ${((percent ?? 0) * 100).toFixed(2)}%`
                            }
                          >
                            {mixChartData.map((_, i) => (
                              <Cell key={i} fill={PROFIT_MIX_COLORS[i % PROFIT_MIX_COLORS.length]} />
                            ))}
                          </Pie>
                          <Tooltip formatter={(v: number) => fmt(v)} />
                          <Legend layout="horizontal" verticalAlign="bottom" align="center" wrapperStyle={{ fontSize: 12 }} />
                        </PieChart>
                      ) : (
                        <RadialBarChart
                          cx="50%"
                          cy="50%"
                          innerRadius="20%"
                          outerRadius="90%"
                          data={mixChartData.map((d, i) => ({
                            ...d,
                            fill: PROFIT_MIX_COLORS[i % PROFIT_MIX_COLORS.length],
                          }))}
                          startAngle={90}
                          endAngle={-270}
                        >
                          <RadialBar dataKey="pct_of_revenue" cornerRadius={6} />
                          <Tooltip formatter={(v: number) => `${Number(v).toFixed(2)}%`} />
                          <Legend
                            layout="horizontal"
                            verticalAlign="bottom"
                            align="center"
                            wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
                          />
                        </RadialBarChart>
                      )}
                    </ResponsiveContainer>
                  </div>
                )}
              </div>

              <div className="overflow-hidden rounded-xl border border-slate-200/90 bg-white p-4 shadow-sm ring-1 ring-slate-200/50 md:p-6">
                <div className="mb-4">
                  <h2 className="text-lg font-semibold tracking-tight text-neutral-900">
                    Sale vs COGS vs Expense vs Purchase vs Net income — chart comparison
                  </h2>
                  <p className="mt-1 max-w-3xl text-sm text-neutral-600">
                    Same five metrics across chart types. Period bars and pie/radar/radar use totals for the
                    reporting window; line, area, and composed charts use monthly buckets when available. Pie and
                    radial slice length use absolute amounts; tooltips show signed values (e.g. net loss).
                  </p>
                </div>

                {fiveWayPeriodBars.length === 0 ? (
                  <p className="py-6 text-center text-sm text-neutral-500">No data for this range.</p>
                ) : (
                  <div className="grid gap-6 lg:grid-cols-2">
                    <div className="min-w-0 rounded-lg border border-neutral-100 bg-neutral-50/50 p-3">
                      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
                        Vertical bar (period totals)
                      </p>
                      <div className={CHART_COMPACT}>
                        <ResponsiveContainer width="100%" height="100%" debounce={50}>
                          <BarChart data={fiveWayPeriodBars} margin={M_BAR_X}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                            <XAxis
                              dataKey="name"
                              tick={{ fontSize: 10, fill: '#64748b' }}
                              angle={-32}
                              textAnchor="end"
                              height={58}
                              interval={0}
                            />
                            <YAxis
                              tick={{ fontSize: 11, fill: '#64748b' }}
                              tickFormatter={(v) => fmt(Number(v))}
                              width={Y_AXIS_CURRENCY_W}
                            />
                            <Tooltip formatter={(v: number) => fmt(v)} contentStyle={{ maxWidth: 280 }} />
                            <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                              {fiveWayPeriodBars.map((row, i) => (
                                <Cell key={row.name} fill={row.fill} />
                              ))}
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </div>

                    <div className="min-w-0 rounded-lg border border-neutral-100 bg-neutral-50/50 p-3">
                      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
                        Horizontal bar (period totals)
                      </p>
                      <div className={CHART_COMPACT}>
                        <ResponsiveContainer width="100%" height="100%" debounce={50}>
                          <BarChart
                            layout="vertical"
                            data={fiveWayPeriodBars}
                            margin={{ top: 12, right: 20, left: 8, bottom: 12 }}
                          >
                            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                            <XAxis type="number" tick={{ fontSize: 11, fill: '#64748b' }} tickFormatter={(v) => fmt(Number(v))} />
                            <YAxis type="category" dataKey="name" width={112} tick={{ fontSize: 10, fill: '#64748b' }} />
                            <Tooltip formatter={(v: number) => fmt(v)} contentStyle={{ maxWidth: 280 }} />
                            <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                              {fiveWayPeriodBars.map((row) => (
                                <Cell key={row.name} fill={row.fill} />
                              ))}
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </div>

                    <div className="min-w-0 rounded-lg border border-neutral-100 bg-neutral-50/50 p-3 lg:col-span-2">
                      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
                        Line (monthly — all five series)
                      </p>
                      {timeseries.length === 0 ? (
                        <p className="py-12 text-center text-sm text-neutral-500">No monthly buckets for this range.</p>
                      ) : (
                        <div className={CHART_TIMESERIES}>
                          <ResponsiveContainer width="100%" height="100%" debounce={50}>
                            <RechartsLineChart data={timeseries} margin={M_LEGEND}>
                              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                              <XAxis
                                dataKey="label"
                                tick={{ fontSize: 11, fill: '#64748b' }}
                                interval="preserveStartEnd"
                                minTickGap={10}
                                angle={slantMonthLabels ? -32 : 0}
                                textAnchor={slantMonthLabels ? 'end' : 'middle'}
                                height={slantMonthLabels ? 50 : 28}
                              />
                              <YAxis tick={{ fontSize: 11, fill: '#64748b' }} tickFormatter={(v) => fmt(v)} width={Y_AXIS_CURRENCY_W} />
                              <Tooltip
                                formatter={(v: number) => fmt(v)}
                                contentStyle={{ maxWidth: 300 }}
                                wrapperStyle={{ zIndex: 1 }}
                              />
                              <Legend
                                verticalAlign="bottom"
                                align="center"
                                layout="horizontal"
                                wrapperStyle={{ fontSize: 11, lineHeight: '1.2rem' }}
                                iconType="line"
                              />
                              {FIVE_WAY_SERIES.map((s) => (
                                <Line
                                  key={s.dataKey}
                                  type="monotone"
                                  name={s.label}
                                  dataKey={s.dataKey}
                                  stroke={s.color}
                                  strokeWidth={2}
                                  dot={false}
                                />
                              ))}
                            </RechartsLineChart>
                          </ResponsiveContainer>
                        </div>
                      )}
                    </div>

                    <div className="min-w-0 rounded-lg border border-neutral-100 bg-neutral-50/50 p-3 lg:col-span-2">
                      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
                        Area — overlapping (monthly)
                      </p>
                      {timeseries.length === 0 ? (
                        <p className="py-12 text-center text-sm text-neutral-500">No monthly buckets for this range.</p>
                      ) : (
                        <div className={CHART_TIMESERIES}>
                          <ResponsiveContainer width="100%" height="100%" debounce={50}>
                            <AreaChart data={timeseries} margin={M_LEGEND}>
                              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                              <XAxis
                                dataKey="label"
                                tick={{ fontSize: 11, fill: '#64748b' }}
                                interval="preserveStartEnd"
                                minTickGap={10}
                                angle={slantMonthLabels ? -32 : 0}
                                textAnchor={slantMonthLabels ? 'end' : 'middle'}
                                height={slantMonthLabels ? 50 : 28}
                              />
                              <YAxis tick={{ fontSize: 11, fill: '#64748b' }} tickFormatter={(v) => fmt(v)} width={Y_AXIS_CURRENCY_W} />
                              <Tooltip formatter={(v: number) => fmt(v)} contentStyle={{ maxWidth: 300 }} />
                              <Legend
                                verticalAlign="bottom"
                                align="center"
                                layout="horizontal"
                                wrapperStyle={{ fontSize: 11, lineHeight: '1.2rem' }}
                              />
                              {FIVE_WAY_SERIES.map((s) => (
                                <Area
                                  key={s.dataKey}
                                  type="monotone"
                                  name={s.label}
                                  dataKey={s.dataKey}
                                  stroke={s.color}
                                  fill={s.color}
                                  fillOpacity={0.22}
                                  strokeWidth={1.5}
                                />
                              ))}
                            </AreaChart>
                          </ResponsiveContainer>
                        </div>
                      )}
                    </div>

                    <div className="min-w-0 rounded-lg border border-neutral-100 bg-neutral-50/50 p-3 lg:col-span-2">
                      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
                        Composed — bars (Sale, Purchase) + lines (COGS, Expense, Net income)
                      </p>
                      {timeseries.length === 0 ? (
                        <p className="py-12 text-center text-sm text-neutral-500">No monthly buckets for this range.</p>
                      ) : (
                        <div className={CHART_TIMESERIES}>
                          <ResponsiveContainer width="100%" height="100%" debounce={50}>
                            <ComposedChart data={timeseries} margin={M_LEGEND}>
                              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                              <XAxis
                                dataKey="label"
                                tick={{ fontSize: 11, fill: '#64748b' }}
                                interval="preserveStartEnd"
                                minTickGap={10}
                                angle={slantMonthLabels ? -32 : 0}
                                textAnchor={slantMonthLabels ? 'end' : 'middle'}
                                height={slantMonthLabels ? 50 : 28}
                              />
                              <YAxis tick={{ fontSize: 11, fill: '#64748b' }} tickFormatter={(v) => fmt(v)} width={Y_AXIS_CURRENCY_W} />
                              <Tooltip formatter={(v: number) => fmt(v)} contentStyle={{ maxWidth: 300 }} />
                              <Legend
                                verticalAlign="bottom"
                                align="center"
                                layout="horizontal"
                                wrapperStyle={{ fontSize: 11, lineHeight: '1.2rem' }}
                              />
                              <Bar dataKey="total_sales" name="Sale" fill="#3b82f6" radius={[3, 3, 0, 0]} />
                              <Bar dataKey="total_purchases" name="Purchase" fill="#8b5cf6" radius={[3, 3, 0, 0]} />
                              <Line type="monotone" dataKey="pl_cogs" name="COGS" stroke="#f59e0b" strokeWidth={2} dot={false} />
                              <Line
                                type="monotone"
                                dataKey="pl_expenses"
                                name="Expense"
                                stroke="#f43f5e"
                                strokeWidth={2}
                                dot={false}
                              />
                              <Line
                                type="monotone"
                                dataKey="net_income"
                                name="Net income"
                                stroke="#10b981"
                                strokeWidth={2}
                                dot={false}
                              />
                            </ComposedChart>
                          </ResponsiveContainer>
                        </div>
                      )}
                    </div>

                    <div className="min-w-0 rounded-lg border border-neutral-100 bg-neutral-50/50 p-3">
                      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
                        Pie (slice size = absolute amount)
                      </p>
                      <div className={CHART_COMPACT}>
                        <ResponsiveContainer width="100%" height="100%" debounce={50}>
                          {/*
                            Room for outside labels: wide left/right so slice labels are not clipped; bottom
                            margin for a horizontal legend (avoids "Net income" and other right-side labels
                            overlapping a vertical legend).
                          */}
                          <PieChart
                            margin={{ top: 16, right: 20, left: 24, bottom: 64 }}
                            style={{ overflow: 'visible' }}
                          >
                            <Pie
                              data={fiveWayPieSlices}
                              dataKey="value"
                              nameKey="name"
                              cx="50%"
                              cy="48%"
                              innerRadius="0%"
                              outerRadius="68%"
                              paddingAngle={1}
                              labelLine
                              label={({ name, percent }) => {
                                const n = String(name)
                                const short = n.length > 12 ? `${n.slice(0, 11)}…` : n
                                return `${short} ${((percent ?? 0) * 100).toFixed(2)}%`
                              }}
                            >
                              {fiveWayPieSlices.map((row) => (
                                <Cell key={row.name} fill={row.fill} />
                              ))}
                            </Pie>
                            <Tooltip
                              formatter={(val: number, _n, props) => {
                                const p = props?.payload as { signed?: number } | undefined
                                const signed = p?.signed
                                return signed !== undefined ? fmt(signed) : fmt(val)
                              }}
                            />
                            <Legend
                              layout="horizontal"
                              verticalAlign="bottom"
                              align="center"
                              iconType="circle"
                              wrapperStyle={{
                                fontSize: 11,
                                lineHeight: '1.25',
                                width: '100%',
                                paddingTop: 4,
                                paddingLeft: 4,
                                paddingRight: 4,
                              }}
                            />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                    </div>

                    <div className="min-w-0 rounded-lg border border-neutral-100 bg-neutral-50/50 p-3">
                      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
                        Radial bar (normalized to largest |amount|)
                      </p>
                      <div className={CHART_COMPACT}>
                        <ResponsiveContainer width="100%" height="100%" debounce={50}>
                          <RadialBarChart
                            cx="42%"
                            cy="50%"
                            innerRadius="18%"
                            outerRadius="82%"
                            data={fiveWayRadialRows}
                            startAngle={90}
                            endAngle={-270}
                          >
                            <RadialBar dataKey="value" cornerRadius={5} />
                            <Tooltip
                              formatter={(val: number, _n, props) => {
                                const p = props?.payload as { signed?: number } | undefined
                                return p?.signed !== undefined ? fmt(p.signed) : `${Number(val).toFixed(2)}% scale`
                              }}
                            />
                            <Legend
                              layout="vertical"
                              align="right"
                              verticalAlign="middle"
                              wrapperStyle={{ fontSize: 11, paddingLeft: 4 }}
                            />
                          </RadialBarChart>
                        </ResponsiveContainer>
                      </div>
                    </div>

                    <div className="min-w-0 rounded-lg border border-neutral-100 bg-neutral-50/50 p-3 lg:col-span-2">
                      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
                        Radar (spoke length = share of largest |amount|)
                      </p>
                      <div className={CHART_STANDARD}>
                        <ResponsiveContainer width="100%" height="100%" debounce={50}>
                          <RadarChart cx="50%" cy="52%" outerRadius="75%" data={fiveWayRadarRows} margin={M_TIGHT}>
                            <PolarGrid stroke="#e5e7eb" />
                            <PolarAngleAxis dataKey="subject" tick={{ fontSize: 10, fill: '#64748b' }} />
                            <PolarRadiusAxis angle={90} domain={[0, 100]} tick={false} />
                            <Radar
                              name="Period (scaled)"
                              dataKey="value"
                              stroke="#6366f1"
                              fill="#6366f1"
                              fillOpacity={0.35}
                            />
                            <Tooltip
                              formatter={(val: number, _n, props) => {
                                const p = props?.payload as { actual?: number } | undefined
                                return p?.actual !== undefined ? fmt(p.actual) : `${Number(val).toFixed(2)}%`
                              }}
                            />
                            <Legend
                              verticalAlign="bottom"
                              align="center"
                              wrapperStyle={{ fontSize: 11, paddingTop: 4 }}
                            />
                          </RadarChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {timeseries.length > 0 && (
                <>
                  <div className="min-w-0 overflow-hidden rounded-xl border border-slate-200/90 bg-white p-4 shadow-sm ring-1 ring-slate-200/50 md:p-6">
                    <h3 className="mb-4 flex items-center gap-2 text-base font-semibold tracking-tight text-neutral-900">
                      <BarChart3 className="h-5 w-5 shrink-0 text-neutral-600" />
                      Sales vs purchases (monthly)
                    </h3>
                    <div className={CHART_TIMESERIES}>
                      <ResponsiveContainer width="100%" height="100%" debounce={50}>
                        <ComposedChart data={timeseries} margin={M_LEGEND}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                          <XAxis
                            dataKey="label"
                            tick={{ fontSize: 12, fill: '#64748b' }}
                            interval="preserveStartEnd"
                            minTickGap={8}
                            angle={slantMonthLabels ? -32 : 0}
                            textAnchor={slantMonthLabels ? 'end' : 'middle'}
                            height={slantMonthLabels ? 50 : 30}
                          />
                          <YAxis tick={{ fontSize: 11, fill: '#64748b' }} tickFormatter={(v) => fmt(v)} width={Y_AXIS_CURRENCY_W} />
                          <Tooltip
                            formatter={(v: number) => fmt(v)}
                            labelStyle={{ color: '#334155' }}
                            contentStyle={{ maxWidth: 300 }}
                          />
                          <Legend
                            verticalAlign="bottom"
                            align="center"
                            wrapperStyle={{ fontSize: 12, paddingTop: 4 }}
                          />
                          <Bar name="Total sales" dataKey="total_sales" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                          <Bar
                            name="Total purchases"
                            dataKey="total_purchases"
                            fill="#8b5cf6"
                            radius={[4, 4, 0, 0]}
                          />
                        </ComposedChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  <div className="min-w-0 overflow-hidden rounded-xl border border-slate-200/90 bg-white p-4 shadow-sm ring-1 ring-slate-200/50 md:p-6">
                    <h3 className="mb-4 flex items-center gap-2 text-base font-semibold tracking-tight text-neutral-900">
                      <TrendingUp className="h-5 w-5 shrink-0 text-neutral-600" />
                      Profitability (gross &amp; net)
                    </h3>
                    <div className={CHART_TIMESERIES}>
                      <ResponsiveContainer width="100%" height="100%" debounce={50}>
                        <ComposedChart data={timeseries} margin={M_LEGEND}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                          <XAxis
                            dataKey="label"
                            tick={{ fontSize: 12, fill: '#64748b' }}
                            interval="preserveStartEnd"
                            minTickGap={8}
                            angle={slantMonthLabels ? -32 : 0}
                            textAnchor={slantMonthLabels ? 'end' : 'middle'}
                            height={slantMonthLabels ? 50 : 30}
                          />
                          <YAxis tick={{ fontSize: 11, fill: '#64748b' }} tickFormatter={(v) => fmt(v)} width={Y_AXIS_CURRENCY_W} />
                          <Tooltip formatter={(v: number) => fmt(v)} contentStyle={{ maxWidth: 300 }} />
                          <Legend
                            verticalAlign="bottom"
                            align="center"
                            wrapperStyle={{ fontSize: 12, paddingTop: 4 }}
                          />
                          <Line
                            type="monotone"
                            name="Gross profit"
                            dataKey="gross_profit"
                            stroke="#06b6d4"
                            strokeWidth={2}
                            dot={false}
                          />
                          <Line
                            type="monotone"
                            name="Net income"
                            dataKey="net_income"
                            stroke="#10b981"
                            strokeWidth={2}
                            dot={false}
                          />
                        </ComposedChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  <div className="min-w-0 overflow-hidden rounded-xl border border-slate-200/90 bg-white p-4 shadow-sm ring-1 ring-slate-200/50 md:p-6">
                    <h3 className="mb-4 flex items-center gap-2 text-base font-semibold tracking-tight text-neutral-900">
                      <LineChart className="h-5 w-5 shrink-0 text-neutral-600" />
                      P&amp;L from journals (income, COGS, expenses)
                    </h3>
                    <div className={CHART_TIMESERIES}>
                      <ResponsiveContainer width="100%" height="100%" debounce={50}>
                        <ComposedChart data={timeseries} margin={M_LEGEND}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                          <XAxis
                            dataKey="label"
                            tick={{ fontSize: 12, fill: '#64748b' }}
                            interval="preserveStartEnd"
                            minTickGap={8}
                            angle={slantMonthLabels ? -32 : 0}
                            textAnchor={slantMonthLabels ? 'end' : 'middle'}
                            height={slantMonthLabels ? 50 : 30}
                          />
                          <YAxis tick={{ fontSize: 11, fill: '#64748b' }} tickFormatter={(v) => fmt(v)} width={Y_AXIS_CURRENCY_W} />
                          <Tooltip formatter={(v: number) => fmt(v)} contentStyle={{ maxWidth: 300 }} />
                          <Legend
                            verticalAlign="bottom"
                            align="center"
                            wrapperStyle={{ fontSize: 12, paddingTop: 4, lineHeight: '1.25rem' }}
                          />
                          <Line
                            type="monotone"
                            name="P&amp;L income"
                            dataKey="pl_income"
                            stroke="#22c55e"
                            strokeWidth={2}
                            dot={false}
                          />
                          <Line
                            type="monotone"
                            name="COGS"
                            dataKey="pl_cogs"
                            stroke="#f59e0b"
                            strokeWidth={2}
                            dot={false}
                          />
                          <Line
                            type="monotone"
                            name="Operating expenses"
                            dataKey="pl_expenses"
                            stroke="#f43f5e"
                            strokeWidth={2}
                            dot={false}
                          />
                        </ComposedChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                </>
              )}
            </>
          ) : !error ? (
            <p className="text-sm text-gray-600">No KPI data returned for this range.</p>
          ) : null}

              {note ? (
                <p className="max-w-4xl border-t border-gray-200 pt-4 text-xs leading-relaxed text-gray-500">
                  {note}
                </p>
              ) : null}
              </div>
            )}
    </div>
  )
}
