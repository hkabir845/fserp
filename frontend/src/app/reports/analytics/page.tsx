'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import Sidebar from '@/components/Sidebar'
import { useCompany } from '@/contexts/CompanyContext'
import api from '@/lib/api'
import { getCurrencySymbol } from '@/utils/currency'
import { formatCurrency } from '@/utils/formatting'
import { toDateInputValue } from '@/utils/date'
import { ArrowLeft, TrendingUp, BarChart3, LineChart, Activity } from 'lucide-react'
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts'

type Kpi = {
  total_sales: number
  total_purchases: number
  pl_income: number
  pl_cogs: number
  pl_expenses: number
  gross_profit: number
  net_income: number
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

function defaultDateRange() {
  const end = new Date()
  const start = new Date(end)
  start.setMonth(start.getMonth() - 5)
  start.setDate(1)
  return {
    start: toDateInputValue(start),
    end: toDateInputValue(end),
  }
}

function KpiCard({
  title,
  value,
  subtitle,
  accent,
}: {
  title: string
  value: string
  subtitle?: string
  accent: 'slate' | 'emerald' | 'blue' | 'violet' | 'amber' | 'rose' | 'cyan'
}) {
  const ring: Record<typeof accent, string> = {
    slate: 'ring-slate-200',
    emerald: 'ring-emerald-200/80',
    blue: 'ring-blue-200/80',
    violet: 'ring-violet-200/80',
    amber: 'ring-amber-200/80',
    rose: 'ring-rose-200/80',
    cyan: 'ring-cyan-200/80',
  }
  return (
    <div
      className={`rounded-xl border border-slate-200 bg-white p-4 shadow-sm ring-1 ${ring[accent]} `}
    >
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{title}</p>
      <p className="mt-1.5 text-xl font-semibold tabular-nums text-slate-900">{value}</p>
      {subtitle ? <p className="mt-1 text-xs text-slate-500">{subtitle}</p> : null}
    </div>
  )
}

export default function FinancialAnalyticsPage() {
  const router = useRouter()
  const { selectedCompany } = useCompany()
  const dr = defaultDateRange()
  const [startDate, setStartDate] = useState(dr.start)
  const [endDate, setEndDate] = useState(dr.end)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [kpi, setKpi] = useState<Kpi | null>(null)
  const [timeseries, setTimeseries] = useState<TsRow[]>([])
  const [note, setNote] = useState<string | null>(null)
  const [currency, setCurrency] = useState('৳')

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
    api
      .get('/companies/current/')
      .then((r) => {
        if (r.data?.currency) setCurrency(getCurrencySymbol(r.data.currency))
      })
      .catch(() => {})
  }, [router])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await api.get('/reports/financial-analytics/', {
        params: { start_date: startDate, end_date: endDate },
      })
      if (res.data?.kpis) {
        setKpi(res.data.kpis as Kpi)
      } else {
        setKpi(null)
      }
      setTimeseries(Array.isArray(res.data?.timeseries) ? res.data.timeseries : [])
      setNote(
        typeof res.data?.accounting_note === 'string' ? res.data.accounting_note : null
      )
    } catch (e: unknown) {
      setError('Could not load analytics. Check permissions and try again.')
      setKpi(null)
      setTimeseries([])
    } finally {
      setLoading(false)
    }
  }, [startDate, endDate])

  useEffect(() => {
    void load()
  }, [load, selectedCompany?.id])

  return (
    <div className="flex h-screen bg-slate-100 page-with-sidebar">
      <Sidebar />
      <div className="app-scroll-pad min-h-0 flex-1 overflow-y-auto p-4 md:p-6">
        <div className="mx-auto max-w-7xl space-y-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="mb-1 flex items-center gap-2 text-sm text-slate-600">
                <Link
                  href="/reports"
                  className="inline-flex items-center gap-1 font-medium text-violet-700 hover:text-violet-900"
                >
                  <ArrowLeft className="h-4 w-4" />
                  Reports
                </Link>
              </div>
              <h1 className="text-2xl font-bold text-slate-900 md:text-3xl">Financial analytics</h1>
              <p className="mt-1 text-slate-600">
                Sales &amp; purchases (documents) vs P&amp;L from posted journals — KPIs and monthly
                trends.
              </p>
            </div>
            <div className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
              <div>
                <label className="block text-xs font-medium text-slate-500">From</label>
                <input
                  type="date"
                  className="mt-0.5 rounded border border-slate-300 px-2 py-1.5 text-sm"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500">To</label>
                <input
                  type="date"
                  className="mt-0.5 rounded border border-slate-300 px-2 py-1.5 text-sm"
                  value={endDate}
                  max={toDateInputValue(new Date())}
                  onChange={(e) => setEndDate(e.target.value)}
                />
              </div>
              <button
                type="button"
                onClick={() => void load()}
                disabled={loading}
                className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
              >
                {loading ? 'Loading…' : 'Refresh'}
              </button>
            </div>
          </div>

          {error ? (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
              {error}
            </div>
          ) : null}

          {kpi && !loading && (
            <div>
              <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold text-slate-900">
                <Activity className="h-5 w-5 text-violet-600" />
                Key performance indicators
                <span className="text-sm font-normal text-slate-500">({currency} — selected range)</span>
              </h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
                <KpiCard
                  title="Total sales (invoices)"
                  value={formatCurrency(kpi.total_sales)}
                  subtitle="Sum of invoice totals by date"
                  accent="blue"
                />
                <KpiCard
                  title="Total purchases (bills)"
                  value={formatCurrency(kpi.total_purchases)}
                  subtitle="Sum of bill totals by date"
                  accent="violet"
                />
                <KpiCard
                  title="P&amp;L income (GL)"
                  value={formatCurrency(kpi.pl_income)}
                  accent="emerald"
                />
                <KpiCard
                  title="COGS (GL)"
                  value={formatCurrency(kpi.pl_cogs)}
                  accent="amber"
                />
                <KpiCard
                  title="Expenses (GL)"
                  value={formatCurrency(kpi.pl_expenses)}
                  accent="rose"
                />
                <KpiCard
                  title="Gross profit"
                  value={formatCurrency(kpi.gross_profit)}
                  accent="cyan"
                />
                <KpiCard
                  title="Net profit"
                  value={formatCurrency(kpi.net_income)}
                  subtitle="Income − COGS − operating expenses"
                  accent="emerald"
                />
              </div>
            </div>
          )}

          {loading ? (
            <div className="flex justify-center py-20 text-slate-500">Loading analytics…</div>
          ) : !error && timeseries.length === 0 && kpi ? (
            <p className="text-sm text-slate-600">
              No monthly trend buckets for this range. Try a range that includes at least part of a month.
            </p>
          ) : null}

          {!loading && timeseries.length > 0 && (
            <>
              <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <h3 className="mb-4 flex items-center gap-2 text-base font-semibold text-slate-900">
                  <BarChart3 className="h-5 w-5 text-slate-600" />
                  Sales vs purchases (monthly)
                </h3>
                <div className="h-80 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={timeseries} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                      <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => formatCurrency(v)} width={78} />
                      <Tooltip
                        formatter={(v: number) => formatCurrency(v)}
                        labelStyle={{ color: '#334155' }}
                      />
                      <Legend />
                      <Bar name="Total sales" dataKey="total_sales" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                      <Bar name="Total purchases" dataKey="total_purchases" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <h3 className="mb-4 flex items-center gap-2 text-base font-semibold text-slate-900">
                  <TrendingUp className="h-5 w-5 text-slate-600" />
                  Profitability (Gross &amp; net)
                </h3>
                <div className="h-80 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={timeseries} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                      <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => formatCurrency(v)} width={78} />
                      <Tooltip formatter={(v: number) => formatCurrency(v)} />
                      <Legend />
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

              <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <h3 className="mb-4 flex items-center gap-2 text-base font-semibold text-slate-900">
                  <LineChart className="h-5 w-5 text-slate-600" />
                  P&amp;L from journals (income, COGS, expenses)
                </h3>
                <div className="h-80 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={timeseries} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                      <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => formatCurrency(v)} width={78} />
                      <Tooltip formatter={(v: number) => formatCurrency(v)} />
                      <Legend />
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

          {note && (
            <p className="max-w-4xl text-xs leading-relaxed text-slate-500 border-t border-slate-200 pt-4">
              {note}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
