'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState, type ComponentType, type ReactNode } from 'react'
import {
  ArrowRight,
  BarChart3,
  CalendarRange,
  Fish,
  Gauge,
  Layers,
  MapPin,
  Package,
  Receipt,
  RefreshCw,
  Scale,
  ShoppingBag,
  Sprout,
  TrendingDown,
  TrendingUp,
  Wallet,
  ArrowRightLeft,
} from 'lucide-react'
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
} from 'recharts'
import { useToast } from '@/components/Toast'
import api from '@/lib/api'
import { extractErrorMessage } from '@/utils/errorHandler'
import { getCurrencySymbol, formatNumber } from '@/utils/currency'
import { formatDateOnly } from '@/utils/date'

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

interface PondFull {
  id: number
  name: string
  code?: string
  is_active?: boolean
  pond_size_decimal?: string | null
}

interface CycleRow {
  id: number
  name: string
  pond_id: number
  pond_name?: string
  start_date?: string
  end_date?: string | null
  is_active?: boolean
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
  inter_pond_fish_transfer_note?: string | null
  fish_stock_ledger_note?: string | null
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
  pond_id: number
  pond_name: string
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
  pond_id: number | null
  pond_name: string
  expense_date: string
  amount: string
  expense_category: string
  expense_category_label: string
  memo: string
  vendor_name: string
  feed_weight_kg?: string | null
  is_shared?: boolean
}

interface SampleRow {
  id: number
  pond_id: number
  pond_name: string
  sample_date: string
  fish_species_label?: string
  estimated_fish_count?: number | null
  estimated_total_weight_kg: string | null
  avg_weight_kg: string | null
}

interface StockPositionRow {
  pond_id: number
  pond_name: string
  implied_net_fish_count: number
  implied_net_weight_kg: string
  latest_sample_estimated_fish_count: number | null
  latest_sample_fish_species_label?: string | null
}

const PIE_COLORS = [
  '#0d9488',
  '#0f766e',
  '#14b8a6',
  '#5eead4',
  '#134e4a',
  '#115e59',
  '#0f172a',
  '#334155',
  '#64748b',
  '#94a3b8',
]

const PURCHASE_LIKE = new Set(['feed_purchase', 'medicine_purchase', 'fry_stocking', 'equipment'])

const moduleLinks = [
  { href: '/aquaculture/ponds', label: 'Ponds', icon: MapPin },
  { href: '/aquaculture/cycles', label: 'Cycles', icon: Layers },
  { href: '/aquaculture/transfers', label: 'Fish transfers', icon: ArrowRightLeft },
  { href: '/aquaculture/stock', label: 'Stock & mortality', icon: Fish },
  { href: '/aquaculture/pond-economics', label: 'Pond economics', icon: Receipt },
  { href: '/aquaculture/sampling', label: 'Sampling', icon: Gauge },
  { href: '/aquaculture/report', label: 'P&L: site & ponds', icon: BarChart3 },
] as const

export default function AquacultureOverviewPage() {
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
  const [pl, setPl] = useState<PlResponse | null>(null)
  const [ponds, setPonds] = useState<PondFull[]>([])
  const [cycles, setCycles] = useState<CycleRow[]>([])
  const [sales, setSales] = useState<SaleRow[]>([])
  const [expenses, setExpenses] = useState<ExpenseRow[]>([])
  const [samples, setSamples] = useState<SampleRow[]>([])
  const [stockPos, setStockPos] = useState<StockPositionRow[]>([])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [co, plRes, pondsRes, cyRes, salRes, expRes, smpRes, stkRes] = await Promise.all([
        api.get<Record<string, unknown>>('/companies/current/'),
        api.get<PlResponse>('/aquaculture/pl-summary/', { params: { start_date: start, end_date: end } }),
        api.get<PondFull[]>('/aquaculture/ponds/'),
        api.get<CycleRow[]>('/aquaculture/production-cycles/'),
        api.get<SaleRow[]>('/aquaculture/sales/'),
        api.get<ExpenseRow[]>('/aquaculture/expenses/'),
        api.get<SampleRow[]>('/aquaculture/samples/'),
        api.get<{ rows: StockPositionRow[] }>('/aquaculture/fish-stock-position/').catch(() => ({ data: { rows: [] } })),
      ])
      setCurrency(String(co.data?.currency || 'BDT').slice(0, 3))
      setPl(plRes.data)
      setPonds(Array.isArray(pondsRes.data) ? pondsRes.data : [])
      setCycles(Array.isArray(cyRes.data) ? cyRes.data : [])
      setSales(Array.isArray(salRes.data) ? salRes.data : [])
      setExpenses(Array.isArray(expRes.data) ? expRes.data : [])
      setSamples(Array.isArray(smpRes.data) ? smpRes.data : [])
      setStockPos(Array.isArray(stkRes.data?.rows) ? stkRes.data.rows : [])
    } catch (e) {
      toast.error(extractErrorMessage(e, 'Could not load dashboard'))
      setPl(null)
    } finally {
      setLoading(false)
    }
  }, [toast, start, end])

  useEffect(() => {
    void load()
  }, [load])

  const sym = getCurrencySymbol(currency)

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

  const totals = pl?.totals
  const revenueN = totals ? parseNum(totals.revenue) : 0
  const costsN = totals ? parseNum(totals.total_costs) : 0
  const profitN = totals ? parseNum(totals.profit) : 0
  const payrollN = totals ? parseNum(totals.payroll_allocated) : 0

  const harvestKg = useMemo(
    () =>
      salesInPeriod
        .filter((s) => !s.income_type || s.income_type === 'fish_harvest_sale')
        .reduce((a, s) => a + parseNum(s.weight_kg), 0),
    [salesInPeriod],
  )
  const totalSaleKg = useMemo(() => salesInPeriod.reduce((a, s) => a + parseNum(s.weight_kg), 0), [salesInPeriod])

  const feedKgRecorded = useMemo(
    () => expensesInPeriod.reduce((a, e) => a + parseNum(e.feed_weight_kg ?? undefined), 0),
    [expensesInPeriod],
  )

  const fcrHarvest = harvestKg > 0 ? feedKgRecorded / harvestKg : null
  const fcrAllSalesWeight = totalSaleKg > 0 ? feedKgRecorded / totalSaleKg : null

  const purchaseLikeTotal = useMemo(
    () => expensesInPeriod.filter((e) => PURCHASE_LIKE.has(e.expense_category)).reduce((a, e) => a + parseNum(e.amount), 0),
    [expensesInPeriod],
  )

  const activePonds = useMemo(() => ponds.filter((p) => p.is_active !== false).length, [ponds])
  const activeCycles = useMemo(() => cycles.filter((c) => c.is_active !== false).length, [cycles])

  const incomeMix = useMemo(() => {
    const map = new Map<string, { key: string; label: string; value: number }>()
    for (const row of pl?.ponds ?? []) {
      for (const sl of row.revenue_by_income_type ?? []) {
        const prev = map.get(sl.income_type)?.value ?? 0
        map.set(sl.income_type, {
          key: sl.income_type,
          label: sl.label || sl.income_type,
          value: prev + parseNum(sl.amount),
        })
      }
    }
    return [...map.values()].sort((a, b) => b.value - a.value)
  }, [pl])

  const pondChartData = useMemo(() => {
    return (pl?.ponds ?? []).map((p) => ({
      name: p.pond_name.length > 14 ? `${p.pond_name.slice(0, 12)}…` : p.pond_name,
      fullName: p.pond_name,
      Revenue: parseNum(p.revenue),
      Costs: parseNum(p.total_costs),
      Profit: parseNum(p.profit),
    }))
  }, [pl])

  const categoryChart = useMemo(() => {
    return (pl?.expenses_by_category ?? [])
      .map((c) => ({ name: c.label, value: parseNum(c.amount), key: c.category }))
      .filter((x) => x.value > 0)
  }, [pl])

  const timelineData = useMemo(() => {
    const byDay = new Map<string, { date: string; sales: number; expenses: number }>()
    const add = (day: string, field: 'sales' | 'expenses', v: number) => {
      const cur = byDay.get(day) ?? { date: day, sales: 0, expenses: 0 }
      cur[field] += v
      byDay.set(day, cur)
    }
    for (const s of salesInPeriod) {
      const day = s.sale_date.split('T')[0]
      add(day, 'sales', parseNum(s.total_amount))
    }
    for (const e of expensesInPeriod) {
      const day = e.expense_date.split('T')[0]
      add(day, 'expenses', parseNum(e.amount))
    }
    return [...byDay.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, v]) => ({
        ...v,
        label: v.date.slice(5),
      }))
  }, [salesInPeriod, expensesInPeriod])

  const recentSales = useMemo(() => [...salesInPeriod].sort((a, b) => b.sale_date.localeCompare(a.sale_date)).slice(0, 6), [salesInPeriod])
  const recentExpenses = useMemo(
    () => [...expensesInPeriod].sort((a, b) => b.expense_date.localeCompare(a.expense_date)).slice(0, 6),
    [expensesInPeriod],
  )
  const recentSamples = useMemo(
    () => [...samplesInPeriod].sort((a, b) => b.sample_date.localeCompare(a.sample_date)).slice(0, 5),
    [samplesInPeriod],
  )

  const fmtMoney = (n: number) => `${sym}${formatNumber(n, 2)}`

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8">
      <div className="flex flex-col gap-4 border-b border-slate-200/90 pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-teal-700">Aquaculture</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">Operations dashboard</h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-600">
            Pond-level profit and loss, biological harvest weight, recorded feed use, expense mix, and biomass sampling for
            the selected period. Packaged goods (feed sacks, medicine SKUs) follow Bills, Inventory, and Cashier; fish kg
            and head in water follow Aquaculture sales, stock, and sampling—this dashboard rolls up module data and pond
            P&amp;L allocation.
          </p>
        </div>
        <div className="flex flex-col items-stretch gap-3 sm:items-end">
          <div className="flex flex-wrap items-center gap-2">
            {(['this_month', 'last_month', 'ytd', 'last_90'] as const).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => applyPresetButton(p)}
                className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${
                  preset === p
                    ? 'bg-teal-700 text-white shadow-sm'
                    : 'bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50'
                }`}
              >
                {periodRange(p).label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setPreset('custom')}
              className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${
                preset === 'custom'
                  ? 'bg-teal-700 text-white shadow-sm'
                  : 'bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50'
              }`}
            >
              <CalendarRange className="h-3.5 w-3.5" aria-hidden />
              Custom range
            </button>
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading}
              className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200/90 bg-white px-3 py-2 shadow-sm sm:justify-end">
            <span className="mr-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Dates</span>
            <label className="flex items-center gap-2 text-xs font-medium text-slate-600">
              <span className="shrink-0 text-slate-500">From</span>
              <input
                type="date"
                value={customStart}
                onChange={(e) => {
                  setCustomStart(e.target.value)
                  setPreset('custom')
                }}
                className="rounded-lg border border-slate-200 bg-slate-50/80 px-2 py-1.5 text-xs text-slate-900 outline-none ring-teal-600/20 focus:border-teal-500 focus:ring-2"
              />
            </label>
            <label className="flex items-center gap-2 text-xs font-medium text-slate-600">
              <span className="shrink-0 text-slate-500">To</span>
              <input
                type="date"
                value={customEnd}
                onChange={(e) => {
                  setCustomEnd(e.target.value)
                  setPreset('custom')
                }}
                className="rounded-lg border border-slate-200 bg-slate-50/80 px-2 py-1.5 text-xs text-slate-900 outline-none ring-teal-600/20 focus:border-teal-500 focus:ring-2"
              />
            </label>
          </div>
        </div>
      </div>

      <p className="mt-4 text-xs text-slate-500">
        Period: <span className="font-medium text-slate-700">{periodLabel}</span> ({formatDateOnly(start)} –{' '}
        {formatDateOnly(end)})
        {pl ? (
          <>
            {' '}
            · P&amp;L matches <Link href="/aquaculture/report" className="text-teal-800 underline decoration-teal-600/30">report</Link>{' '}
            scope
          </>
        ) : null}
      </p>

      {/* KPI strip */}
      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-4">
        <KpiCard
          title="Net profit (P&L)"
          value={fmtMoney(profitN)}
          sub={totals ? `After ${fmtMoney(parseNum(totals.operating_expenses))} opex + ${fmtMoney(payrollN)} payroll` : '—'}
          icon={Wallet}
          accent={profitN >= 0 ? 'positive' : 'negative'}
        />
        <KpiCard
          title="Revenue (fish & income)"
          value={fmtMoney(revenueN)}
          sub={`${salesInPeriod.length} sale line${salesInPeriod.length === 1 ? '' : 's'} in period`}
          icon={TrendingUp}
          accent="neutral"
        />
        <KpiCard
          title="Total costs"
          value={fmtMoney(costsN)}
          sub="Direct + shared opex + payroll allocation"
          icon={TrendingDown}
          accent="neutral"
        />
        <KpiCard
          title="Active ponds / cycles"
          value={`${activePonds} / ${activeCycles}`}
          sub={`${ponds.length} pond${ponds.length === 1 ? '' : 's'} total`}
          icon={MapPin}
          accent="neutral"
        />
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          title="Harvest weight (est.)"
          value={`${formatNumber(harvestKg, 2)} kg`}
          sub={totalSaleKg !== harvestKg ? `All sale weight: ${formatNumber(totalSaleKg, 2)} kg` : 'Fish harvest sale lines'}
          icon={Fish}
          accent="neutral"
        />
        <KpiCard
          title="Feed recorded (module)"
          value={`${formatNumber(feedKgRecorded, 2)} kg`}
          sub="Sum of feed kg on expense lines"
          icon={Sprout}
          accent="neutral"
        />
        <KpiCard
          title="FCR (feed ÷ harvest kg)"
          value={fcrHarvest != null ? formatNumber(fcrHarvest, 2) : '—'}
          sub={
            fcrHarvest == null
              ? harvestKg <= 0
                ? 'Need harvest sale weight in period'
                : 'No feed kg on expenses'
              : 'Lower is better; uses harvest-line weight only'
          }
          icon={Scale}
          accent="neutral"
        />
        <KpiCard
          title="Purchase-like opex"
          value={fmtMoney(purchaseLikeTotal)}
          sub="Feed, medicine, fry, equipment categories"
          icon={ShoppingBag}
          accent="neutral"
        />
      </div>

      {/* Charts */}
      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <ChartCard title="Pond revenue, costs, and net" subtitle="From P&amp;L engine (same as report)">
          {pondChartData.length === 0 ? (
            <EmptyChart hint="Add ponds and activity in the selected range." />
          ) : (
            <div className="h-[280px] w-full min-w-0">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={pondChartData} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-slate-200" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} className="fill-slate-600" />
                  <YAxis tick={{ fontSize: 11 }} className="fill-slate-600" tickFormatter={(v) => `${sym}${v}`} />
                  <Tooltip
                    formatter={(v: number) => fmtMoney(v)}
                    labelFormatter={(_, payload) => (payload?.[0]?.payload as { fullName?: string })?.fullName ?? ''}
                    contentStyle={{ borderRadius: 8, border: '1px solid #e2e8f0' }}
                  />
                  <Legend />
                  <Bar dataKey="Revenue" fill="#14b8a6" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="Costs" fill="#94a3b8" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="Profit" fill="#0f766e" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </ChartCard>

        <ChartCard title="Operating expense mix" subtitle="Aggregated expense categories (period)">
          {categoryChart.length === 0 ? (
            <EmptyChart hint="Record pond or shared expenses for this period." />
          ) : (
            <div className="h-[280px] w-full min-w-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={categoryChart}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={52}
                    outerRadius={88}
                    paddingAngle={2}
                  >
                    {categoryChart.map((_, i) => (
                      <Cell key={categoryChart[i].key} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v: number) => fmtMoney(v)} contentStyle={{ borderRadius: 8 }} />
                  <Legend layout="horizontal" verticalAlign="bottom" />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </ChartCard>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <ChartCard title="Income composition" subtitle="By income type on pond sales">
          {incomeMix.length === 0 ? (
            <EmptyChart hint="Post pond sales with income types to see the split." />
          ) : (
            <div className="h-[260px] w-full min-w-0">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={incomeMix} layout="vertical" margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-slate-200" horizontal={false} />
                  <XAxis type="number" tickFormatter={(v) => `${sym}${v}`} tick={{ fontSize: 11 }} />
                  <YAxis type="category" dataKey="label" width={120} tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v: number) => fmtMoney(v)} contentStyle={{ borderRadius: 8 }} />
                  <Bar dataKey="value" fill="#0d9488" radius={[0, 4, 4, 0]} name="Amount" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </ChartCard>

        <ChartCard title="Daily cash rhythm" subtitle="Module fish sale amounts vs. aquaculture expenses (by day)">
          {timelineData.length === 0 ? (
            <EmptyChart hint="No sales or expenses with dates in this window." />
          ) : (
            <div className="h-[260px] w-full min-w-0">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={timelineData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-slate-200" />
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${sym}${v}`} />
                  <Tooltip formatter={(v: number) => fmtMoney(v)} contentStyle={{ borderRadius: 8 }} />
                  <Legend />
                  <Line type="monotone" dataKey="sales" name="Sales" stroke="#0d9488" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="expenses" name="Expenses" stroke="#64748b" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </ChartCard>
      </div>

      <p className="mt-4 text-xs leading-relaxed text-slate-500">
        Activity charts and “recent” lists use the latest sale and expense batches returned by the API (up to 500 lines
        each); P&amp;L figures above always cover the full selected dates. For FCR, record feed kg on{' '}
        <Link href="/aquaculture/expenses" className="font-medium text-teal-800 underline">
          Operating expenses
        </Link>{' '}
        when feed is not inventoried through POS; POS-on-account feed for pond customers posts to shop/inventory GL and
        does not count in module expense totals unless you mirror it here.
      </p>

      {fcrAllSalesWeight != null && fcrHarvest != null && Math.abs(fcrAllSalesWeight - fcrHarvest) > 0.01 ? (
        <p className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
          <span className="font-medium text-slate-800">FCR note:</span> Using all sale-line weight (including fingerlings,
          etc.) would give {formatNumber(fcrAllSalesWeight, 2)}. The headline FCR uses{' '}
          <span className="font-medium">fish harvest sale</span> weight only.
        </p>
      ) : null}

      {/* Tables */}
      <div className="mt-10 grid gap-6 lg:grid-cols-3">
        <MiniTable
          title="Recent pond sales"
          href="/aquaculture/sales"
          rows={recentSales.map((s) => ({
            primary: s.pond_name,
            secondary: `${formatDateOnly(s.sale_date)} · ${formatNumber(parseNum(s.weight_kg), 2)} kg${
              s.fish_count != null ? ` · ${formatNumber(s.fish_count, 0)} head` : ''
            }`,
            amount: fmtMoney(parseNum(s.total_amount)),
          }))}
        />
        <MiniTable
          title="Recent expenses"
          href="/aquaculture/expenses"
          rows={recentExpenses.map((e) => ({
            primary: e.expense_category_label + (e.is_shared ? ' (shared)' : ''),
            secondary: `${formatDateOnly(e.expense_date)} · ${e.pond_name}`,
            amount: fmtMoney(parseNum(e.amount)),
          }))}
        />
        <MiniTable
          title="Recent biomass samples"
          href="/aquaculture/sampling"
          rows={recentSamples.map((s) => ({
            primary: s.pond_name,
            secondary: `${formatDateOnly(s.sample_date)}${
              s.fish_species_label ? ` · ${s.fish_species_label}` : ''
            }${s.estimated_fish_count != null ? ` · ~${formatNumber(s.estimated_fish_count, 0)} fish` : ''}`,
            amount:
              s.estimated_total_weight_kg != null
                ? `${formatNumber(parseNum(s.estimated_total_weight_kg), 2)} kg est.`
                : s.avg_weight_kg != null
                  ? `Avg ${formatNumber(parseNum(s.avg_weight_kg))} kg`
                  : '—',
          }))}
        />
      </div>

      {/* Pond detail table */}
      <div className="mt-10 overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 sm:px-5">
          <div className="flex items-center gap-2">
            <Package className="h-4 w-4 text-teal-700" />
            <h2 className="text-sm font-semibold text-slate-900">Pond P&amp;L summary</h2>
          </div>
          <Link
            href="/aquaculture/report"
            className="inline-flex items-center gap-1 text-xs font-medium text-teal-800 hover:text-teal-950"
          >
            Full report
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/80 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <th className="px-4 py-2.5 sm:px-5">Pond</th>
                <th className="px-4 py-2.5 text-right sm:px-5">Revenue</th>
                <th className="px-4 py-2.5 text-right sm:px-5">Opex</th>
                <th className="px-4 py-2.5 text-right sm:px-5" title="Fish stock loss book value (period)">
                  Bio loss
                </th>
                <th className="px-4 py-2.5 text-right sm:px-5">Payroll</th>
                <th className="px-4 py-2.5 text-right sm:px-5">Net</th>
              </tr>
            </thead>
            <tbody>
              {(pl?.ponds ?? []).length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-8 text-center text-slate-500">
                    No pond rows for this period.
                  </td>
                </tr>
              ) : (
                (pl?.ponds ?? []).map((p) => (
                  <tr key={p.pond_id} className="border-b border-slate-50 last:border-0">
                    <td className="px-4 py-3 font-medium text-slate-900 sm:px-5">{p.pond_name}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-700 sm:px-5">
                      {fmtMoney(parseNum(p.revenue))}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-700 sm:px-5">
                      {fmtMoney(parseNum(p.operating_expenses))}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-600 sm:px-5">
                      {fmtMoney(parseNum(p.biological_write_offs ?? '0'))}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-700 sm:px-5">
                      {fmtMoney(parseNum(p.payroll_allocated))}
                    </td>
                    <td
                      className={`px-4 py-3 text-right tabular-nums font-medium sm:px-5 ${
                        parseNum(p.profit) >= 0 ? 'text-teal-800' : 'text-rose-700'
                      }`}
                    >
                      {fmtMoney(parseNum(p.profit))}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {stockPos.length > 0 ? (
        <div className="mt-8 overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 sm:px-5">
            <div className="flex items-center gap-2">
              <Fish className="h-4 w-4 text-teal-700" />
              <h2 className="text-sm font-semibold text-slate-900">Fish on hand (transfers − sales ± ledger)</h2>
            </div>
            <Link
              href="/aquaculture/stock"
              className="inline-flex items-center gap-1 text-xs font-medium text-teal-800 hover:text-teal-950"
            >
              Mortality &amp; adjustments
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/80 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-2.5 sm:px-5">Pond</th>
                  <th className="px-4 py-2.5 text-right sm:px-5">Net fish</th>
                  <th className="px-4 py-2.5 text-right sm:px-5">Net kg</th>
                  <th className="px-4 py-2.5 text-right sm:px-5">Latest sample</th>
                </tr>
              </thead>
              <tbody>
                {stockPos.map((r) => (
                  <tr key={r.pond_id} className="border-b border-slate-50 last:border-0">
                    <td className="px-4 py-3 font-medium text-slate-900 sm:px-5">{r.pond_name}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-700 sm:px-5">
                      {formatNumber(r.implied_net_fish_count, 0)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-700 sm:px-5">
                      {formatNumber(parseNum(r.implied_net_weight_kg), 2)}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-600 sm:px-5">
                      {r.latest_sample_estimated_fish_count != null ? (
                        <span className="tabular-nums">
                          {formatNumber(r.latest_sample_estimated_fish_count, 0)}
                          {r.latest_sample_fish_species_label ? (
                            <span className="mt-0.5 block text-xs font-normal text-slate-500">
                              {r.latest_sample_fish_species_label}
                            </span>
                          ) : null}
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {/* Quick modules */}
      <div className="mt-10">
        <h2 className="text-sm font-semibold text-slate-900">Module shortcuts</h2>
        <ul className="mt-3 grid list-none gap-3 p-0 sm:grid-cols-2 lg:grid-cols-3" aria-label="Aquaculture modules">
          {moduleLinks.map((t) => {
            const Icon = t.icon
            return (
              <li key={t.href}>
                <Link
                  href={t.href}
                  className="flex items-center gap-3 rounded-xl border border-slate-200/90 bg-white px-4 py-3 text-sm shadow-sm outline-none ring-teal-600/15 transition hover:border-teal-200 hover:shadow-md focus-visible:ring-2"
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-teal-50 text-teal-700">
                    <Icon className="h-5 w-5" strokeWidth={1.75} aria-hidden />
                  </div>
                  <span className="font-medium text-slate-900">{t.label}</span>
                  <ArrowRight className="ml-auto h-4 w-4 text-slate-400" />
                </Link>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}

function KpiCard(props: {
  title: string
  value: string
  sub: string
  icon: ComponentType<{ className?: string; strokeWidth?: number }>
  accent: 'positive' | 'negative' | 'neutral'
}) {
  const { title, value, sub, icon: Icon, accent } = props
  const ring =
    accent === 'positive'
      ? 'ring-teal-600/10'
      : accent === 'negative'
        ? 'ring-rose-600/10'
        : 'ring-slate-200/80'
  const iconBg =
    accent === 'positive' ? 'bg-teal-50 text-teal-700' : accent === 'negative' ? 'bg-rose-50 text-rose-700' : 'bg-slate-100 text-slate-700'
  return (
    <div className={`rounded-2xl border border-slate-200/90 bg-white p-4 shadow-sm ring-1 ${ring}`}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{title}</p>
        <div className={`rounded-lg p-1.5 ${iconBg}`}>
          <Icon className="h-4 w-4" strokeWidth={1.75} />
        </div>
      </div>
      <p className="mt-2 text-xl font-bold tabular-nums tracking-tight text-slate-900">{value}</p>
      <p className="mt-1 text-xs leading-relaxed text-slate-500">{sub}</p>
    </div>
  )
}

function ChartCard(props: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-200/90 bg-white p-4 shadow-sm sm:p-5">
      <h2 className="text-sm font-semibold text-slate-900">{props.title}</h2>
      <p className="mt-0.5 text-xs text-slate-500">{props.subtitle}</p>
      <div className="mt-4">{props.children}</div>
    </div>
  )
}

function EmptyChart({ hint }: { hint: string }) {
  return (
    <div className="flex h-[240px] items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50/50 text-sm text-slate-500">
      {hint}
    </div>
  )
}

function MiniTable(props: {
  title: string
  href: string
  rows: { primary: string; secondary: string; amount: string }[]
}) {
  return (
    <div className="rounded-2xl border border-slate-200/90 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
        <h3 className="text-sm font-semibold text-slate-900">{props.title}</h3>
        <Link href={props.href} className="text-xs font-medium text-teal-800 hover:underline">
          Open
        </Link>
      </div>
      <ul className="divide-y divide-slate-100 p-0">
        {props.rows.length === 0 ? (
          <li className="px-4 py-6 text-center text-xs text-slate-500">No rows in this period.</li>
        ) : (
          props.rows.map((r, i) => (
            <li key={i} className="flex gap-3 px-4 py-2.5 text-sm">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-slate-800">{r.primary}</p>
                <p className="truncate text-xs text-slate-500">{r.secondary}</p>
              </div>
              <p className="shrink-0 tabular-nums text-slate-700">{r.amount}</p>
            </li>
          ))
        )}
      </ul>
    </div>
  )
}
