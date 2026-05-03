'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  BarChart3,
  DollarSign,
  FileText,
  Receipt,
  RefreshCw,
  ShoppingCart,
  TrendingUp,
} from 'lucide-react'
import { useToast } from '@/components/Toast'
import api from '@/lib/api'
import { extractErrorMessage } from '@/utils/errorHandler'
import { getCurrencySymbol, formatNumber } from '@/utils/currency'

type PeriodPreset = 'this_month' | 'last_month' | 'ytd'

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
  const start = new Date(y, 0, 1)
  return { start: iso(start), end: iso(end), label: 'Year to date' }
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

interface SaleRow {
  sale_date: string
  total_amount: string
}

interface ExpenseRow {
  expense_date: string
  amount: string
}

export default function PondEconomicsHubPage() {
  const toast = useToast()
  const [preset, setPreset] = useState<PeriodPreset>('this_month')
  const { start, end, label: periodLabel } = useMemo(() => periodRange(preset), [preset])
  const [currency, setCurrency] = useState('BDT')
  const [loading, setLoading] = useState(true)
  const [sales, setSales] = useState<SaleRow[]>([])
  const [expenses, setExpenses] = useState<ExpenseRow[]>([])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [co, salRes, expRes] = await Promise.all([
        api.get<Record<string, unknown>>('/companies/current/'),
        api.get<SaleRow[]>('/aquaculture/sales/'),
        api.get<ExpenseRow[]>('/aquaculture/expenses/'),
      ])
      setCurrency(String(co.data?.currency || 'BDT').slice(0, 3))
      setSales(Array.isArray(salRes.data) ? salRes.data : [])
      setExpenses(Array.isArray(expRes.data) ? expRes.data : [])
    } catch (e) {
      toast.error(extractErrorMessage(e, 'Could not load pond economics data'))
      setSales([])
      setExpenses([])
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    void load()
  }, [load])

  const salesInPeriod = useMemo(
    () => sales.filter((s) => inRange(s.sale_date, start, end)),
    [sales, start, end],
  )
  const expensesInPeriod = useMemo(
    () => expenses.filter((e) => inRange(e.expense_date, start, end)),
    [expenses, start, end],
  )

  const salesTotal = useMemo(() => salesInPeriod.reduce((a, s) => a + parseNum(s.total_amount), 0), [salesInPeriod])
  const expensesTotal = useMemo(
    () => expensesInPeriod.reduce((a, e) => a + parseNum(e.amount), 0),
    [expensesInPeriod],
  )

  const sym = getCurrencySymbol(currency)

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 lg:px-8">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link
            href="/aquaculture"
            className="mb-2 inline-flex items-center gap-1 text-sm font-medium text-teal-800 hover:text-teal-950"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
            Dashboard
          </Link>
          <p className="text-xs font-semibold uppercase tracking-wider text-teal-700">Aquaculture</p>
          <h1 id="aq-pond-economics-title" className="mt-1 text-2xl font-bold tracking-tight text-slate-900">
            Pond economics
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-600">
            Record <strong className="text-slate-800">pond-tagged costs</strong> and{' '}
            <strong className="text-slate-800">pond &amp; fish sales</strong> so each pond&apos;s management P&amp;L stays
            accurate. Use core ERP for packaged supplier <strong className="text-slate-800">Bills</strong>,{' '}
            <strong className="text-slate-800">POS</strong>, and SKU <strong className="text-slate-800">inventory</strong>; use
            the Aquaculture links below for biological harvest revenue and pond allocations—not retail POS totals for
            packaged goods alone.
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2 sm:flex-row sm:items-center">
          <label className="text-xs font-medium text-slate-600">
            Period
            <select
              value={preset}
              onChange={(e) => setPreset(e.target.value as PeriodPreset)}
              className="ml-1 mt-0.5 block rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-800 shadow-sm"
            >
              <option value="this_month">This month</option>
              <option value="last_month">Last month</option>
              <option value="ytd">Year to date</option>
            </select>
          </label>
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden />
            Refresh
          </button>
        </div>
      </div>

      <div className="mt-6 rounded-xl border border-teal-100 bg-gradient-to-br from-teal-50/80 to-white px-4 py-4 shadow-sm">
        <p className="text-sm font-semibold text-teal-950">Shop inventory vs fish in ponds</p>
        <p className="mt-1 text-sm leading-relaxed text-slate-700">
          <span className="font-medium text-slate-800">Packaged SKUs</span>—on-hand balances and COGS follow{' '}
          <Link href="/bills" className="font-medium text-teal-800 underline decoration-teal-600/40">
            Bills
          </Link>
          ,{' '}
          <Link href="/inventory" className="font-medium text-teal-800 underline decoration-teal-600/40">
            Inventory
          </Link>
          , and{' '}
          <Link href="/cashier" className="font-medium text-teal-800 underline decoration-teal-600/40">
            Cashier (POS)
          </Link>
          . <span className="font-medium text-slate-800">Fish biomass</span> (kg, head, sampling) lives in{' '}
          <Link href="/aquaculture/stock" className="font-medium text-teal-800 underline decoration-teal-600/40">
            Fish stock
          </Link>
          ,{' '}
          <Link href="/aquaculture/sales" className="font-medium text-teal-800 underline decoration-teal-600/40">
            Pond sales
          </Link>
          , and sampling—this hub summarizes pond-tagged money flows; it does not replace perpetual inventory counts for
          sacks and bottles. Route inventoried feed and medicine through POS or shop issue so you never book the same
          physical goods twice.
        </p>
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Pond &amp; fish sales</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">
            {loading ? '—' : `${sym}${formatNumber(salesTotal, 2)}`}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {periodLabel} · {salesInPeriod.length} record{salesInPeriod.length === 1 ? '' : 's'}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Pond costs</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">
            {loading ? '—' : `${sym}${formatNumber(expensesTotal, 2)}`}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {periodLabel} · {expensesInPeriod.length} record{expensesInPeriod.length === 1 ? '' : 's'}
          </p>
        </div>
      </div>

      <ul className="mt-6 space-y-2 rounded-xl border border-slate-200 bg-slate-50/80 px-4 py-3 text-sm text-slate-700">
        <li className="flex gap-2">
          <ShoppingCart className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" aria-hidden />
          <span>
            Shop → pond (feed, medicine): use{' '}
            <strong className="text-slate-900">Pond costs</strong> with the shop issue flow so SKU inventory and pond
            P&amp;L align.
          </span>
        </li>
        <li className="flex gap-2">
          <FileText className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" aria-hidden />
          <span>
            Supplier invoices into the shop:{' '}
            <Link href="/bills" className="font-medium text-teal-800 underline decoration-teal-600/40">
              Bills
            </Link>{' '}
            (unchanged).
          </span>
        </li>
        <li className="flex gap-2">
          <TrendingUp className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" aria-hidden />
          <span>
            Counter sales:{' '}
            <Link href="/cashier" className="font-medium text-teal-800 underline decoration-teal-600/40">
              POS / Cashier
            </Link>
            .
          </span>
        </li>
      </ul>

      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <Link
          href="/aquaculture/expenses"
          className="group flex flex-col rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-teal-300 hover:shadow-md"
        >
          <div className="flex items-center gap-2 text-teal-800">
            <Receipt className="h-5 w-5" aria-hidden />
            <span className="font-semibold">Pond costs</span>
          </div>
          <p className="mt-2 flex-1 text-sm leading-relaxed text-slate-600">
            Direct and shared operating costs, feed weight, shop issues to ponds.
          </p>
          <span className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-teal-700">
            Open
            <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" aria-hidden />
          </span>
        </Link>

        <Link
          href="/aquaculture/sales"
          className="group flex flex-col rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-teal-300 hover:shadow-md"
        >
          <div className="flex items-center gap-2 text-teal-800">
            <DollarSign className="h-5 w-5" aria-hidden />
            <span className="font-semibold">Pond &amp; fish sales</span>
          </div>
          <p className="mt-2 flex-1 text-sm leading-relaxed text-slate-600">
            Harvest and other pond-tagged revenue (weight, species, income type).
          </p>
          <span className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-teal-700">
            Open
            <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" aria-hidden />
          </span>
        </Link>
      </div>

      <div className="mt-10 rounded-xl border border-indigo-200/80 bg-indigo-50/50 p-5">
        <div className="flex items-start gap-3">
          <BarChart3 className="mt-0.5 h-5 w-5 shrink-0 text-indigo-700" aria-hidden />
          <div>
            <p className="font-semibold text-indigo-950">Profit &amp; loss</p>
            <p className="mt-1 text-sm leading-relaxed text-indigo-900/90">
              Compare <strong>fuel &amp; shop (GL by site)</strong> with <strong>each pond (management P&amp;L)</strong> on
              one screen. Figures above are cash-style totals from pond sales and expense entries for the selected period;
              the report reconciles with allocations and transfers.
            </p>
            <Link
              href="/aquaculture/report"
              className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-indigo-800 underline decoration-indigo-400/50 underline-offset-2 hover:decoration-indigo-800"
            >
              Open P&amp;L — site &amp; ponds
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
