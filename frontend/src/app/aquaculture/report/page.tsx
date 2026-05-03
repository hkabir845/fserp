'use client'

import Link from 'next/link'
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { useToast } from '@/components/Toast'
import api from '@/lib/api'
import { extractErrorMessage } from '@/utils/errorHandler'
import { getCurrencySymbol, formatNumber } from '@/utils/currency'
import { formatCoaOptionLabel } from '@/utils/coaOptionLabel'

interface Pond {
  id: number
  name: string
  is_active?: boolean
}
interface CycleOpt {
  id: number
  name: string
}
interface IncomeSlice {
  income_type: string
  label: string
  amount: string
}
interface PondRow {
  pond_id: number
  pond_name: string
  revenue: string
  revenue_by_income_type?: IncomeSlice[]
  direct_operating_expenses?: string
  shared_operating_expenses?: string
  fish_transfer_cost_in?: string
  fish_transfer_cost_out?: string
  operating_expenses: string
  payroll_allocated: string
  total_costs: string
  profit: string
}
interface PondCycleSegment {
  pond_id: number
  pond_name: string
  production_cycle_id: number | null
  production_cycle_name: string
  revenue: string
  direct_operating_expenses: string
  fish_transfer_cost_in?: string
  fish_transfer_cost_out?: string
  direct_operating_expenses_with_transfers?: string
  segment_margin: string
}
interface PondCategoryExpense {
  category: string
  label: string
  amount: string
}
interface PondExpenseGroup {
  pond_id: number
  pond_name: string
  categories: PondCategoryExpense[]
}
interface PlResponse {
  start_date: string
  end_date: string
  pond_scope_id?: number | null
  cycle_scope_id?: number | null
  cycle_scope_name?: string | null
  cycle_scope_note?: string | null
  shared_operating_cost_rule?: string
  inter_pond_fish_transfer_note?: string | null
  ponds: PondRow[]
  expenses_by_pond?: PondExpenseGroup[]
  expenses_by_category: { category: string; label: string; amount: string }[]
  pond_cycle_segments?: PondCycleSegment[]
  totals: {
    revenue: string
    operating_expenses: string
    payroll_allocated: string
    total_costs: string
    profit: string
  }
}

interface CoaRow {
  id: number
  account_code: string
  account_name: string
  account_type?: string
  account_sub_type?: string
  is_active?: boolean
}

interface ProfitTransferRow {
  id: number
  pond_id: number
  pond_name: string
  production_cycle_id?: number | null
  production_cycle_name?: string
  transfer_date: string
  amount: string
  debit_account_id: number
  debit_account_code: string
  debit_account_name: string
  credit_account_id: number
  credit_account_code: string
  credit_account_name: string
  memo: string
  journal_entry_id: number | null
  journal_is_posted: boolean
  journal_entry_number: string
}

type PlScopeTab = 'ponds' | 'fuel_site'

interface GlIsSection {
  accounts: { account_code: string; account_name: string; balance: string }[]
  total: string
}

/** Posted GL income statement (same payload as Reports → income-statement). */
interface FuelSiteIncomeStatement {
  report_id?: string
  period?: { start_date?: string; end_date?: string }
  filter_station_id?: number
  income?: GlIsSection
  cost_of_goods_sold?: GlIsSection
  expenses?: GlIsSection
  gross_profit?: string
  net_income?: string
  accounting_note?: string
  period_matches_cumulative_change?: boolean
  cumulative_net_income_change?: string
  cumulative_vs_period_difference?: string
}

function monthStartEnd(): { start: string; end: string } {
  const now = new Date()
  const y = now.getFullYear()
  const m = now.getMonth()
  const start = new Date(y, m, 1)
  const end = new Date(y, m + 1, 0)
  const iso = (d: Date) => d.toISOString().slice(0, 10)
  return { start: iso(start), end: iso(end) }
}

export default function AquacultureReportPage() {
  const toast = useToast()
  const { start: defaultStart, end: defaultEnd } = monthStartEnd()
  const [start, setStart] = useState(defaultStart)
  const [end, setEnd] = useState(defaultEnd)
  const [pondId, setPondId] = useState('')
  const [cycleId, setCycleId] = useState('')
  const [includeCycleBreakdown, setIncludeCycleBreakdown] = useState(false)
  const [cycles, setCycles] = useState<CycleOpt[]>([])
  const [ponds, setPonds] = useState<Pond[]>([])
  const [data, setData] = useState<PlResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [currency, setCurrency] = useState('BDT')
  const [pondsMetaReady, setPondsMetaReady] = useState(false)
  const [accounts, setAccounts] = useState<CoaRow[]>([])
  const [transfers, setTransfers] = useState<ProfitTransferRow[]>([])
  const [xferLoading, setXferLoading] = useState(false)
  const [xferSubmitting, setXferSubmitting] = useState(false)
  const [xferCycles, setXferCycles] = useState<CycleOpt[]>([])
  const today = useMemo(() => new Date().toISOString().slice(0, 10), [])
  const [xferForm, setXferForm] = useState({
    pond_id: '',
    production_cycle_id: '',
    amount: '',
    transfer_date: today,
    debit_account_id: '',
    credit_account_id: '',
    memo: '',
    post: true,
  })

  const [plScope, setPlScope] = useState<PlScopeTab>('ponds')
  const [fuelStations, setFuelStations] = useState<{ id: number; station_name: string }[]>([])
  const [fuelStationId, setFuelStationId] = useState('')
  const [fuelData, setFuelData] = useState<FuelSiteIncomeStatement | null>(null)
  const [fuelLoading, setFuelLoading] = useState(false)
  const [canViewFuelGlReports, setCanViewFuelGlReports] = useState(true)

  const activePonds = useMemo(() => ponds.filter((p) => p.is_active !== false), [ponds])
  const activeCoa = useMemo(() => accounts.filter((a) => a.is_active !== false), [accounts])

  useEffect(() => {
    if (pondId && !activePonds.some((p) => String(p.id) === pondId)) {
      setPondId('')
    }
  }, [activePonds, pondId])

  useEffect(() => {
    if (!pondId) {
      setCycles([])
      setCycleId('')
      return
    }
    void (async () => {
      try {
        const { data } = await api.get<CycleOpt[]>('/aquaculture/production-cycles/', {
          params: { pond_id: pondId },
        })
        setCycles(Array.isArray(data) ? data : [])
      } catch {
        setCycles([])
      }
    })()
  }, [pondId])

  useEffect(() => {
    if (cycleId && !cycles.some((c) => String(c.id) === cycleId)) {
      setCycleId('')
    }
  }, [cycles, cycleId])

  useEffect(() => {
    if (!xferForm.pond_id) {
      setXferCycles([])
      return
    }
    void (async () => {
      try {
        const { data } = await api.get<CycleOpt[]>('/aquaculture/production-cycles/', {
          params: { pond_id: xferForm.pond_id },
        })
        setXferCycles(Array.isArray(data) ? data : [])
      } catch {
        setXferCycles([])
      }
    })()
  }, [xferForm.pond_id])

  useEffect(() => {
    void (async () => {
      try {
        const [co, pRes] = await Promise.all([
          api.get<Record<string, unknown>>('/companies/current/'),
          api.get<Pond[]>('/aquaculture/ponds/'),
        ])
        setCurrency(String(co.data?.currency || 'BDT').slice(0, 3))
        setPonds(Array.isArray(pRes.data) ? pRes.data : [])
      } catch {
        /* ignore */
      } finally {
        setPondsMetaReady(true)
      }
      const [aRes, tRes] = await Promise.allSettled([
        api.get<CoaRow[]>('/chart-of-accounts/'),
        api.get<ProfitTransferRow[]>('/aquaculture/pond-profit-transfers/'),
      ])
      if (aRes.status === 'fulfilled' && Array.isArray(aRes.value.data)) {
        setAccounts(aRes.value.data)
      }
      if (tRes.status === 'fulfilled' && Array.isArray(tRes.value.data)) {
        setTransfers(tRes.value.data)
      }
    })()
  }, [])

  const loadTransfers = useCallback(async () => {
    setXferLoading(true)
    try {
      const { data: t } = await api.get<ProfitTransferRow[]>('/aquaculture/pond-profit-transfers/')
      setTransfers(Array.isArray(t) ? t : [])
    } catch {
      /* optional module / permissions */
    } finally {
      setXferLoading(false)
    }
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params: Record<string, string> = { start_date: start, end_date: end }
      if (pondId) params.pond_id = pondId
      if (cycleId) params.cycle_id = cycleId
      if (includeCycleBreakdown && !cycleId) params.include_cycle_breakdown = 'true'
      const { data: d } = await api.get<PlResponse>('/aquaculture/pl-summary/', { params })
      setData(d)
    } catch (e) {
      toast.error(extractErrorMessage(e, 'Could not load report'))
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [toast, start, end, pondId, cycleId, includeCycleBreakdown])

  useEffect(() => {
    if (plScope !== 'ponds') return
    void load()
  }, [plScope, load])

  const loadFuelIs = useCallback(async () => {
    if (!canViewFuelGlReports) return
    setFuelLoading(true)
    try {
      const params: Record<string, string> = { start_date: start, end_date: end }
      if (fuelStationId && /^\d+$/.test(fuelStationId)) params.station_id = fuelStationId
      const { data: d } = await api.get<FuelSiteIncomeStatement>('/reports/income-statement/', { params })
      setFuelData(d)
    } catch (e) {
      toast.error(extractErrorMessage(e, 'Could not load site income statement'))
      setFuelData(null)
    } finally {
      setFuelLoading(false)
    }
  }, [toast, start, end, fuelStationId, canViewFuelGlReports])

  useEffect(() => {
    try {
      const raw = localStorage.getItem('user')
      if (!raw) {
        setCanViewFuelGlReports(false)
        return
      }
      const u = JSON.parse(raw) as { role?: string; permissions?: unknown }
      const role = String(u?.role || '')
        .toLowerCase()
        .replace(/[\s-]+/g, '_')
      if (role === 'super_admin' || role === 'superadmin') {
        setCanViewFuelGlReports(true)
        return
      }
      const perms = u?.permissions
      setCanViewFuelGlReports(
        Array.isArray(perms) && (perms.includes('*') || perms.includes('app.reports')),
      )
    } catch {
      setCanViewFuelGlReports(false)
    }
  }, [])

  useEffect(() => {
    if (plScope !== 'fuel_site') return
    void (async () => {
      try {
        const { data } = await api.get<unknown>('/stations/')
        const rows = Array.isArray(data) ? data : []
        setFuelStations(
          rows
            .filter((r): r is Record<string, unknown> => r != null && typeof r === 'object')
            .flatMap((r) => {
              const id = typeof r.id === 'number' ? r.id : Number(r.id)
              if (!Number.isFinite(id)) return []
              const nm = String(r.station_name ?? '').trim() || `Station ${id}`
              if (r.is_active === false) return []
              return [{ id, station_name: nm }]
            }),
        )
      } catch {
        setFuelStations([])
      }
    })()
  }, [plScope])

  useEffect(() => {
    if (plScope !== 'fuel_site' || !canViewFuelGlReports) return
    void loadFuelIs()
  }, [plScope, canViewFuelGlReports, loadFuelIs])

  const sym = getCurrencySymbol(currency)

  const submitProfitTransfer = async () => {
    if (!xferForm.pond_id || !xferForm.debit_account_id || !xferForm.credit_account_id || !xferForm.transfer_date) {
      toast.error('Pond, transfer date, debit account, and credit account are required')
      return
    }
    const amt = Number(xferForm.amount)
    if (!Number.isFinite(amt) || amt <= 0) {
      toast.error('Amount must be a positive number')
      return
    }
    if (xferForm.debit_account_id === xferForm.credit_account_id) {
      toast.error('Debit and credit accounts must be different')
      return
    }
    setXferSubmitting(true)
    try {
      await api.post('/aquaculture/pond-profit-transfers/', {
        pond_id: parseInt(xferForm.pond_id, 10),
        ...(xferForm.production_cycle_id
          ? { production_cycle_id: parseInt(xferForm.production_cycle_id, 10) }
          : {}),
        transfer_date: xferForm.transfer_date,
        amount: amt,
        debit_account_id: parseInt(xferForm.debit_account_id, 10),
        credit_account_id: parseInt(xferForm.credit_account_id, 10),
        memo: xferForm.memo.trim(),
        post: xferForm.post,
      })
      toast.success(xferForm.post ? 'Transfer posted to the ledger' : 'Journal created as draft (unposted)')
      setXferForm((f) => ({ ...f, amount: '', memo: '' }))
      void loadTransfers()
      void load()
    } catch (e) {
      toast.error(extractErrorMessage(e, 'Transfer failed'))
    } finally {
      setXferSubmitting(false)
    }
  }

  const expensesByPond = data?.expenses_by_pond ?? []
  const expensesByCategory = data?.expenses_by_category ?? []

  const fmtIsMoney = (s: string | undefined) => {
    const n = Number(String(s ?? '').replace(/,/g, ''))
    if (!Number.isFinite(n)) return `${sym}0.00`
    return `${sym}${formatNumber(n, 2)}`
  }

  const renderIsBlock = (title: string, block: GlIsSection | undefined) => (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-4 py-3">
        <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
        <span className="text-sm font-semibold tabular-nums text-slate-800">{fmtIsMoney(block?.total)}</span>
      </div>
      <ul className="divide-y divide-slate-100">
        {(block?.accounts ?? []).length === 0 ? (
          <li className="px-4 py-6 text-center text-sm text-slate-400">No accounts in this section for the period.</li>
        ) : (
          (block?.accounts ?? []).map((a) => (
            <li key={`${title}-${a.account_code}`} className="flex justify-between gap-3 px-4 py-2.5 text-sm">
              <span className="min-w-0">
                <span className="font-medium text-slate-900">{a.account_name}</span>
                <span className="ml-2 text-xs text-slate-500">{a.account_code}</span>
              </span>
              <span className="shrink-0 tabular-nums font-medium text-slate-900">{fmtIsMoney(a.balance)}</span>
            </li>
          ))
        )}
      </ul>
    </div>
  )

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Profit and loss scope">
        <button
          type="button"
          role="tab"
          aria-selected={plScope === 'ponds'}
          onClick={() => setPlScope('ponds')}
          className={`rounded-lg px-4 py-2 text-sm font-semibold shadow-sm transition ${
            plScope === 'ponds'
              ? 'bg-teal-700 text-white ring-2 ring-teal-600/30'
              : 'bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50'
          }`}
        >
          Ponds (management P&amp;L)
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={plScope === 'fuel_site'}
          onClick={() => setPlScope('fuel_site')}
          className={`rounded-lg px-4 py-2 text-sm font-semibold shadow-sm transition ${
            plScope === 'fuel_site'
              ? 'bg-indigo-700 text-white ring-2 ring-indigo-600/30'
              : 'bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50'
          }`}
        >
          Fuel &amp; shop (GL by site)
        </button>
      </div>

      <h1 id="aq-pl-title" className="mt-6 text-xl font-bold tracking-tight text-slate-900">
        {plScope === 'ponds' ? 'Ponds — management profit & loss' : 'Fuel station & shop — site P&amp;L (posted GL)'}
      </h1>
      <p className="mt-1.5 max-w-3xl text-sm leading-relaxed text-slate-600">
        {plScope === 'ponds' ? (
          <>
            Net per pond is revenue (typed income lines) minus direct operating costs, your share of{' '}
            <span className="font-medium text-slate-800">explicitly split</span> shared costs, and payroll allocated to
            that pond. Optional production cycles tag revenue and direct costs for segment views; shared costs and
            payroll stay full-pond unless you use cycle-only scope (then they show as zero by design).
          </>
        ) : (
          <>
            Same engine as <strong className="text-slate-800">Reports → Income statement</strong>. Amounts are{' '}
            <strong className="text-slate-800">posted</strong> journal activity only. When you pick a site, only lines
            tagged with that station are included; leave the site empty to sum every station-tagged line in range
            (company-wide site dimension, not pond economics).
          </>
        )}
      </p>

      {plScope === 'fuel_site' && !canViewFuelGlReports && (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          Your role does not include the <strong>Reports</strong> permission. Ask a company admin to grant{' '}
          <code className="rounded bg-amber-100/90 px-1.5 py-0.5 text-xs">app.reports</code>, or open{' '}
          <Link href="/reports" className="font-medium text-teal-900 underline underline-offset-2">
            Reports
          </Link>{' '}
          with an accountant or admin profile.
        </div>
      )}

      {plScope === 'fuel_site' && canViewFuelGlReports && (
        <>
          <div className="mt-6 flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <label className="text-sm text-slate-700">
              <span className="block text-xs font-medium uppercase tracking-wide text-slate-500">From</span>
              <input
                type="date"
                className="mt-1 rounded-lg border border-slate-300 px-2 py-1.5"
                value={start}
                onChange={(e) => setStart(e.target.value)}
                aria-label="Fuel P and L start date"
              />
            </label>
            <label className="text-sm text-slate-700">
              <span className="block text-xs font-medium uppercase tracking-wide text-slate-500">To</span>
              <input
                type="date"
                className="mt-1 rounded-lg border border-slate-300 px-2 py-1.5"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
                aria-label="Fuel P and L end date"
              />
            </label>
            <label className="text-sm text-slate-700">
              <span className="block text-xs font-medium uppercase tracking-wide text-slate-500">Site (station)</span>
              <select
                className="mt-1 min-w-[14rem] rounded-lg border border-slate-300 px-2 py-1.5"
                value={fuelStationId}
                onChange={(e) => setFuelStationId(e.target.value)}
                aria-label="Filter GL P and L by station"
              >
                <option value="">All sites (station-tagged lines only)</option>
                {fuelStations.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.station_name}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={() => void loadFuelIs()}
              disabled={fuelLoading}
              className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${fuelLoading ? 'animate-spin' : ''}`} />
              Run
            </button>
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Pond internal economics stay under the <strong>Ponds</strong> tab. Use{' '}
            <Link href="/aquaculture/pond-economics" className="text-teal-800 underline">
              Pond economics
            </Link>{' '}
            to record pond costs and sales.
          </p>

          {fuelData && (
            <div className="mt-8 space-y-6">
              {fuelData.period_matches_cumulative_change === false && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
                  <span className="font-semibold">Check cumulative P&amp;L: </span>
                  Period net ({fmtIsMoney(fuelData.net_income)}) differs from cumulative change (
                  {fmtIsMoney(fuelData.cumulative_net_income_change)}) by {fmtIsMoney(fuelData.cumulative_vs_period_difference)}.
                </div>
              )}
              {fuelData.accounting_note && (
                <p className="text-xs leading-relaxed text-slate-600">{fuelData.accounting_note}</p>
              )}
              <div className="grid gap-4 lg:grid-cols-3">
                <div className="lg:col-span-3 grid gap-4 sm:grid-cols-2">
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50/80 p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-emerald-800">Gross profit</p>
                    <p className="mt-1 text-2xl font-bold tabular-nums text-emerald-900">
                      {fmtIsMoney(fuelData.gross_profit)}
                    </p>
                  </div>
                  <div className="rounded-xl border border-indigo-200 bg-indigo-50/80 p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-indigo-800">Net income</p>
                    <p className="mt-1 text-2xl font-bold tabular-nums text-indigo-950">
                      {fmtIsMoney(fuelData.net_income)}
                    </p>
                  </div>
                </div>
                <div className="lg:col-span-3">{renderIsBlock('Income', fuelData.income)}</div>
                <div className="lg:col-span-3">{renderIsBlock('Cost of goods sold', fuelData.cost_of_goods_sold)}</div>
                <div className="lg:col-span-3">{renderIsBlock('Expenses', fuelData.expenses)}</div>
              </div>
            </div>
          )}
        </>
      )}

      {plScope === 'ponds' && (
        <>
      <div className="mt-6 flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <label className="text-sm text-slate-700">
          <span className="block text-xs font-medium uppercase tracking-wide text-slate-500">From</span>
          <input
            type="date"
            className="mt-1 rounded-lg border border-slate-300 px-2 py-1.5"
            value={start}
            onChange={(e) => setStart(e.target.value)}
            aria-label="Report start date"
          />
        </label>
        <label className="text-sm text-slate-700">
          <span className="block text-xs font-medium uppercase tracking-wide text-slate-500">To</span>
          <input
            type="date"
            className="mt-1 rounded-lg border border-slate-300 px-2 py-1.5"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
            aria-label="Report end date"
          />
        </label>
        <label className="text-sm text-slate-700">
          <span className="block text-xs font-medium uppercase tracking-wide text-slate-500">Pond scope</span>
          <select
            className="mt-1 min-w-[12rem] rounded-lg border border-slate-300 px-2 py-1.5"
            value={pondId}
            onChange={(e) => {
              setPondId(e.target.value)
              setCycleId('')
            }}
            aria-label="Limit report to a single active pond"
          >
            <option value="">All active ponds</option>
            {activePonds.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm text-slate-700">
          <span className="block text-xs font-medium uppercase tracking-wide text-slate-500">Production cycle</span>
          <select
            className="mt-1 min-w-[11rem] rounded-lg border border-slate-300 px-2 py-1.5 disabled:opacity-50"
            value={cycleId}
            disabled={!pondId || cycles.length === 0}
            onChange={(e) => setCycleId(e.target.value)}
            aria-label="Limit report to one production cycle for the selected pond"
          >
            <option value="">Full pond (all cycles)</option>
            {cycles.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-end gap-2 pb-0.5 text-sm text-slate-700">
          <input
            type="checkbox"
            className="rounded border-slate-300"
            checked={includeCycleBreakdown}
            disabled={Boolean(cycleId)}
            onChange={(e) => setIncludeCycleBreakdown(e.target.checked)}
          />
          <span className="max-w-[10rem] leading-snug">Include cycle segment breakdown</span>
        </label>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex items-center gap-1 rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          Run
        </button>
      </div>
      <p className="mt-2 text-xs text-slate-500">Inactive ponds are excluded from this P&amp;L view.</p>

      {pondsMetaReady && ponds.length === 0 && (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          No ponds defined yet — add ponds to see meaningful P&L rows.{' '}
          <Link href="/aquaculture/ponds" className="font-medium text-teal-800 underline">
            Ponds
          </Link>
        </div>
      )}

      {ponds.length > 0 && activeCoa.length > 0 && (
        <div className="mt-8 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900">Post pond profit to the ledger</h2>
          <p className="mt-1 max-w-3xl text-sm text-slate-600">
            Creates a balanced journal entry for this company: debit the account that should increase (often an asset
            such as bank), credit the account that balances the movement (often equity or retained earnings). The row is
            tagged with the pond for your records; you choose both GL accounts.
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="block text-sm font-medium text-slate-700">
              Pond
              <select
                className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2 text-sm"
                value={xferForm.pond_id}
                onChange={(e) =>
                  setXferForm((f) => ({ ...f, pond_id: e.target.value, production_cycle_id: '' }))
                }
              >
                <option value="">Select pond</option>
                {ponds.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.is_active === false ? ' (inactive)' : ''}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm font-medium text-slate-700">
              Production cycle (optional)
              <select
                className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2 text-sm disabled:opacity-50"
                value={xferForm.production_cycle_id}
                disabled={!xferForm.pond_id || xferCycles.length === 0}
                onChange={(e) => setXferForm((f) => ({ ...f, production_cycle_id: e.target.value }))}
              >
                <option value="">None</option>
                {xferCycles.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm font-medium text-slate-700">
              Transfer date
              <input
                type="date"
                className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2 text-sm"
                value={xferForm.transfer_date}
                onChange={(e) => setXferForm((f) => ({ ...f, transfer_date: e.target.value }))}
              />
            </label>
            <label className="block text-sm font-medium text-slate-700">
              Amount ({sym})
              <input
                type="number"
                min="0"
                step="0.01"
                className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2 text-sm tabular-nums"
                value={xferForm.amount}
                onChange={(e) => setXferForm((f) => ({ ...f, amount: e.target.value }))}
              />
            </label>
            <label className="flex items-center gap-2 pt-6 text-sm text-slate-700">
              <input
                type="checkbox"
                className="rounded border-slate-300"
                checked={xferForm.post}
                onChange={(e) => setXferForm((f) => ({ ...f, post: e.target.checked }))}
              />
              Post immediately (uncheck to leave the journal as draft)
            </label>
            <label className="block text-sm font-medium text-slate-700 sm:col-span-1">
              Debit account
              <select
                className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2 text-sm"
                value={xferForm.debit_account_id}
                onChange={(e) => setXferForm((f) => ({ ...f, debit_account_id: e.target.value }))}
              >
                <option value="">Select account</option>
                {activeCoa.map((a) => (
                  <option key={a.id} value={a.id}>
                    {formatCoaOptionLabel(a)}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm font-medium text-slate-700 sm:col-span-1">
              Credit account
              <select
                className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2 text-sm"
                value={xferForm.credit_account_id}
                onChange={(e) => setXferForm((f) => ({ ...f, credit_account_id: e.target.value }))}
              >
                <option value="">Select account</option>
                {activeCoa.map((a) => (
                  <option key={a.id} value={a.id}>
                    {formatCoaOptionLabel(a)}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm font-medium text-slate-700 sm:col-span-2">
              Memo (optional)
              <input
                className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2 text-sm"
                value={xferForm.memo}
                onChange={(e) => setXferForm((f) => ({ ...f, memo: e.target.value }))}
              />
            </label>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={xferSubmitting}
              onClick={() => void submitProfitTransfer()}
              className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-50"
            >
              {xferSubmitting ? 'Saving…' : 'Create transfer'}
            </button>
            <Link href="/journal-entries" className="text-sm font-medium text-teal-800 underline">
              Open journal entries
            </Link>
            <button
              type="button"
              onClick={() => void loadTransfers()}
              disabled={xferLoading}
              className="text-sm text-slate-600 hover:text-slate-900 disabled:opacity-50"
            >
              Refresh history
            </button>
          </div>

          {transfers.length > 0 && (
            <div className="mt-6 overflow-x-auto rounded-lg border border-slate-100">
              <table className="min-w-full text-left text-sm">
                <caption className="sr-only">Recent pond profit transfers</caption>
                <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
                  <tr>
                    <th className="px-3 py-2">Date</th>
                    <th className="px-3 py-2">Pond</th>
                    <th className="px-3 py-2">Cycle</th>
                    <th className="px-3 py-2 text-right">Amount</th>
                    <th className="px-3 py-2">Debit</th>
                    <th className="px-3 py-2">Credit</th>
                    <th className="px-3 py-2">Journal</th>
                  </tr>
                </thead>
                <tbody>
                  {transfers.map((t) => (
                    <tr key={t.id} className="border-b border-slate-100">
                      <td className="px-3 py-2 whitespace-nowrap">{t.transfer_date}</td>
                      <td className="px-3 py-2">{t.pond_name}</td>
                      <td className="px-3 py-2 text-slate-600">{t.production_cycle_name || '—'}</td>
                      <td className="px-3 py-2 text-right tabular-nums font-medium">
                        {sym}
                        {formatNumber(Number(t.amount))}
                      </td>
                      <td className="px-3 py-2 text-slate-700">
                        {(t.debit_account_code || '').trim()} — {t.debit_account_name}
                      </td>
                      <td className="px-3 py-2 text-slate-700">
                        {(t.credit_account_code || '').trim()} — {t.credit_account_name}
                      </td>
                      <td className="px-3 py-2">
                        {t.journal_entry_id ? (
                          <span className="text-slate-700">
                            {t.journal_entry_number || `#${t.journal_entry_id}`}
                            {t.journal_is_posted ? ' · posted' : ' · draft'}
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
          )}
        </div>
      )}

      {data && (
        <div className="mt-8 space-y-8">
          {data.cycle_scope_note && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
              {data.cycle_scope_note}
            </div>
          )}
          {data.shared_operating_cost_rule && (
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800">
              <span className="font-semibold text-slate-900">Shared cost rule: </span>
              {data.shared_operating_cost_rule}
            </div>
          )}
          {data.inter_pond_fish_transfer_note && (
            <div className="rounded-xl border border-teal-200 bg-teal-50/80 px-4 py-3 text-sm text-teal-950">
              <span className="font-semibold text-teal-950">Fish pond transfers: </span>
              {data.inter_pond_fish_transfer_note}
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {[
              ['Revenue', data.totals.revenue],
              ['Operating expenses', data.totals.operating_expenses],
              ['Payroll allocated', data.totals.payroll_allocated],
              ['Total costs', data.totals.total_costs],
              ['Net profit', data.totals.profit],
            ].map(([label, val]) => (
              <div key={label} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
                <p className="mt-1 text-lg font-semibold tabular-nums text-slate-900">
                  {sym}
                  {formatNumber(Number(val))}
                </p>
              </div>
            ))}
          </div>

          <div>
            <h2 className="text-lg font-semibold text-slate-900">By pond</h2>
            <p className="mt-1 text-xs text-slate-500">
              Revenue includes all income types in scope. Operating expenses are direct pond lines plus your allocated
              share of company-wide shared expenses, adjusted by inter-pond fish transfers (cost in − cost out). Expand
              income mix per pond below the figures.
            </p>
            <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
              <table className="min-w-full text-left text-sm">
                <caption className="sr-only">Profit and loss by pond for the selected period</caption>
                <thead className="border-b border-slate-200 bg-slate-50">
                  <tr>
                    <th scope="col" className="px-3 py-2">
                      Pond
                    </th>
                    <th scope="col" className="px-3 py-2 text-right">
                      Revenue
                    </th>
                    <th scope="col" className="px-3 py-2 text-right">
                      Direct opex
                    </th>
                    <th scope="col" className="px-3 py-2 text-right">
                      Shared opex
                    </th>
                    <th scope="col" className="px-3 py-2 text-right">
                      Fish xfer in
                    </th>
                    <th scope="col" className="px-3 py-2 text-right">
                      Fish xfer out
                    </th>
                    <th scope="col" className="px-3 py-2 text-right">
                      Total opex
                    </th>
                    <th scope="col" className="px-3 py-2 text-right">
                      Payroll
                    </th>
                    <th scope="col" className="px-3 py-2 text-right">
                      Net
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.ponds.map((r) => (
                    <Fragment key={r.pond_id}>
                      <tr className="border-b border-slate-100">
                        <td className="px-3 py-2 font-medium">{r.pond_name}</td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {sym}
                          {formatNumber(Number(r.revenue))}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-slate-700">
                          {sym}
                          {formatNumber(Number(r.direct_operating_expenses ?? r.operating_expenses))}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-slate-700">
                          {sym}
                          {formatNumber(Number(r.shared_operating_expenses ?? 0))}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-slate-700">
                          {sym}
                          {formatNumber(Number(r.fish_transfer_cost_in ?? 0))}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-slate-700">
                          {sym}
                          {formatNumber(Number(r.fish_transfer_cost_out ?? 0))}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {sym}
                          {formatNumber(Number(r.operating_expenses))}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {sym}
                          {formatNumber(Number(r.payroll_allocated))}
                        </td>
                        <td className="px-3 py-2 text-right font-medium tabular-nums text-teal-800">
                          {sym}
                          {formatNumber(Number(r.profit))}
                        </td>
                      </tr>
                      {(r.revenue_by_income_type?.length ?? 0) > 0 && (
                        <tr className="border-b border-slate-100 bg-slate-50/60">
                          <td colSpan={9} className="px-3 py-2 text-xs text-slate-600">
                            <span className="font-medium text-slate-700">Income mix: </span>
                            {(r.revenue_by_income_type ?? []).map((x) => (
                              <span key={x.income_type} className="mr-3 whitespace-nowrap">
                                {x.label}{' '}
                                <span className="font-mono tabular-nums text-slate-900">
                                  {sym}
                                  {formatNumber(Number(x.amount))}
                                </span>
                              </span>
                            ))}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {(data.pond_cycle_segments?.length ?? 0) > 0 && (
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Pond × production cycle (direct only)</h2>
              <p className="mt-1 text-xs text-slate-500">
                Segment margin uses direct opex plus fish transfer cost in minus cost out for that cycle (no shared cost
                or payroll).
              </p>
              <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
                <table className="min-w-full text-left text-sm">
                  <thead className="border-b border-slate-200 bg-slate-50">
                    <tr>
                      <th className="px-3 py-2">Pond</th>
                      <th className="px-3 py-2">Cycle</th>
                      <th className="px-3 py-2 text-right">Revenue</th>
                      <th className="px-3 py-2 text-right">Direct opex</th>
                      <th className="px-3 py-2 text-right">Xfer in</th>
                      <th className="px-3 py-2 text-right">Xfer out</th>
                      <th className="px-3 py-2 text-right">Dir. + xfer</th>
                      <th className="px-3 py-2 text-right">Segment margin</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.pond_cycle_segments!.map((s) => (
                      <tr key={`${s.pond_id}-${s.production_cycle_id ?? 'none'}`} className="border-b border-slate-100">
                        <td className="px-3 py-2">{s.pond_name}</td>
                        <td className="px-3 py-2">{s.production_cycle_name}</td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {sym}
                          {formatNumber(Number(s.revenue))}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {sym}
                          {formatNumber(Number(s.direct_operating_expenses))}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-slate-700">
                          {sym}
                          {formatNumber(Number(s.fish_transfer_cost_in ?? 0))}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-slate-700">
                          {sym}
                          {formatNumber(Number(s.fish_transfer_cost_out ?? 0))}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-slate-800">
                          {sym}
                          {formatNumber(Number(s.direct_operating_expenses_with_transfers ?? s.direct_operating_expenses))}
                        </td>
                        <td className="px-3 py-2 text-right font-medium tabular-nums text-teal-800">
                          {sym}
                          {formatNumber(Number(s.segment_margin))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {expensesByPond.some((g) => g.categories.length > 0) && (
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Operating expenses by pond</h2>
              <p className="mt-1 text-xs text-slate-500">
                Includes direct expenses for that pond plus the portion of shared expenses attributed to that pond, by
                category.
              </p>
              <div className="mt-3 space-y-4">
                {expensesByPond.map(
                  (g) =>
                    g.categories.length > 0 && (
                      <div key={g.pond_id} className="rounded-xl border border-slate-200 bg-white shadow-sm">
                        <h3 className="border-b border-slate-100 bg-slate-50 px-4 py-2 text-sm font-semibold text-slate-800">
                          {g.pond_name}
                        </h3>
                        <ul className="divide-y divide-slate-100">
                          {g.categories.map((c) => (
                            <li key={`${g.pond_id}-${c.category}`} className="flex justify-between px-4 py-2 text-sm">
                              <span>{c.label}</span>
                              <span className="tabular-nums font-medium">
                                {sym}
                                {formatNumber(Number(c.amount))}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ),
                )}
              </div>
            </div>
          )}

          {expensesByCategory.length > 0 && (
            <div>
              <h2 className="text-lg font-semibold text-slate-900">
                {pondId ? 'Expenses by category (selected pond)' : 'Expenses by category (combined for scope)'}
              </h2>
              <ul className="mt-3 divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white shadow-sm">
                {expensesByCategory.map((c) => (
                  <li key={c.category} className="flex justify-between px-4 py-2 text-sm">
                    <span>{c.label}</span>
                    <span className="tabular-nums font-medium">
                      {sym}
                      {formatNumber(Number(c.amount))}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
        </>
      )}
    </div>
  )
}
