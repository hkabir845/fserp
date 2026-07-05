'use client'

import Link from 'next/link'
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Archive, Download, Printer, RefreshCw } from 'lucide-react'
import { useToast } from '@/components/Toast'
import api from '@/lib/api'
import { parseArchivePlSearchParams } from '@/lib/aquacultureDataBankArchive'
import { extractErrorMessage } from '@/utils/errorHandler'
import { formatDate, formatDateOnly } from '@/utils/date'
import { getCurrencySymbol, formatNumber } from '@/utils/currency'
import { formatCoaOptionLabel } from '@/utils/coaOptionLabel'
import { escapeHtml, printDocument } from '@/utils/printDocument'
import {
  buildAquaculturePlManagementCsv,
  buildAquaculturePlManagementPrintHtml,
} from '@/utils/reportExportHelpers'
import {
  AquaculturePlCategoryMatrices,
  AquaculturePlNetSummary,
  PlActiveExpenseCategoriesList,
  PlConsumptionCostsExpenses,
  PlPondByPondExpenseTable,
} from '@/components/reports/AquaculturePlCategoryMatrices'
import {
  COA_AQ_PROFIT_CLEARING,
  COA_BANK_OP,
  COA_CASH,
  suggestedAquacultureProfitTransferAccountIds,
  templateCoaOptionLabel,
} from '@/lib/coaDefaults'
import { parseReportSiteScopeKey } from '../reportSiteScope'

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
  revenue_fish_sales?: string
  revenue_empty_sack_sales?: string
  revenue_other_income?: string
  revenue_by_income_type?: IncomeSlice[]
  direct_operating_expenses?: string
  shared_operating_expenses?: string
  feed_consumption_cost?: string
  medicine_consumption_cost?: string
  fry_fingerling_cost?: string
  lease_cost?: string
  salaries_and_payroll_cost?: string
  pond_care_products_cost?: string
  equipment_cost?: string
  other_operating_expenses?: string
  fish_transfer_cost_in?: string
  fish_transfer_cost_out?: string
  operating_expenses: string
  payroll_allocated: string
  income_total?: string
  expense_total?: string
  net_profit?: string
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
  income_by_pond?: PondExpenseGroup[]
  income_by_category?: { category: string; label: string; amount: string }[]
  pl_show_full_catalog?: boolean
  pl_income_columns?: { code: string; label: string }[]
  pl_expense_columns?: { code: string; label: string }[]
  pl_formula_note?: string
  pl_grand_totals?: {
    total_income: string
    total_costs_and_expenses: string
    net_profit: string
  }
  pond_cycle_segments?: PondCycleSegment[]
  totals: {
    revenue: string
    revenue_fish_sales?: string
    revenue_empty_sack_sales?: string
    revenue_other_income?: string
    operating_expenses: string
    direct_operating_expenses?: string
    shared_operating_expenses?: string
    feed_consumption_cost?: string
    medicine_consumption_cost?: string
    fry_fingerling_cost?: string
    lease_cost?: string
    salaries_and_payroll_cost?: string
    pond_care_products_cost?: string
    equipment_cost?: string
    other_operating_expenses?: string
    payroll_allocated: string
    total_costs: string
    total_costs_and_expenses?: string
    total_income?: string
    profit: string
    net_profit?: string
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

type AquaculturePlManagementPanelProps = {
  /** When true, rendered inside Reports (no outer max-width page shell). */
  embedInReports?: boolean
  /** Global Site scope from Reports page (`station id` or `p:{pondId}`). */
  reportStationKey?: string
}

export function AquaculturePlManagementPanel({
  embedInReports = false,
  reportStationKey = '',
}: AquaculturePlManagementPanelProps) {
  const toast = useToast()
  const searchParams = useSearchParams()
  const archiveFromUrl = useMemo(
    () => (embedInReports ? parseArchivePlSearchParams(searchParams) : null),
    [embedInReports, searchParams]
  )
  const { start: defaultStart, end: defaultEnd } = monthStartEnd()
  const [start, setStart] = useState(archiveFromUrl?.start ?? defaultStart)
  const [end, setEnd] = useState(archiveFromUrl?.end ?? defaultEnd)
  const [pondId, setPondId] = useState(archiveFromUrl?.pondId ?? '')
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
  const xferGlTouchedRef = useRef(new Set<string>())

  const [plScope, setPlScope] = useState<PlScopeTab>('ponds')
  const [fuelData, setFuelData] = useState<FuelSiteIncomeStatement | null>(null)
  const [fuelLoading, setFuelLoading] = useState(false)
  const [canViewFuelGlReports, setCanViewFuelGlReports] = useState(true)

  const fuelStationId = useMemo(() => {
    const scope = parseReportSiteScopeKey(reportStationKey)
    return scope.kind === 'station' ? String(scope.id) : ''
  }, [reportStationKey])

  useEffect(() => {
    if (!archiveFromUrl) return
    setPlScope('ponds')
    setStart(archiveFromUrl.start)
    setEnd(archiveFromUrl.end)
    if (archiveFromUrl.pondId) setPondId(archiveFromUrl.pondId)
  }, [archiveFromUrl])

  const activePonds = useMemo(() => ponds.filter((p) => p.is_active !== false), [ponds])
  const pondsForScope = useMemo(() => {
    if (!archiveFromUrl?.pondId) return activePonds
    const archived = ponds.find((p) => String(p.id) === archiveFromUrl.pondId)
    if (!archived) return activePonds
    if (activePonds.some((p) => String(p.id) === archiveFromUrl.pondId)) return activePonds
    return [...activePonds, archived]
  }, [activePonds, archiveFromUrl, ponds])
  const activeCoa = useMemo(() => accounts.filter((a) => a.is_active !== false), [accounts])

  const xferDebitRecommend = useMemo(
    () => templateCoaOptionLabel(COA_BANK_OP, activeCoa) + ` (or ${COA_CASH})`,
    [activeCoa]
  )
  const xferCreditRecommend = useMemo(
    () => templateCoaOptionLabel(COA_AQ_PROFIT_CLEARING, activeCoa),
    [activeCoa]
  )

  /** Active suggest: pre-fill transfer journal accounts when COA loads. */
  useEffect(() => {
    if (activeCoa.length === 0) return
    const touched = xferGlTouchedRef.current
    const defaults = suggestedAquacultureProfitTransferAccountIds(activeCoa)
    setXferForm((f) => ({
      ...f,
      debit_account_id:
        touched.has('debit_account_id') || f.debit_account_id
          ? f.debit_account_id
          : defaults.debit_account_id,
      credit_account_id:
        touched.has('credit_account_id') || f.credit_account_id
          ? f.credit_account_id
          : defaults.credit_account_id,
    }))
  }, [activeCoa])

  useEffect(() => {
    if (pondId && !pondsForScope.some((p) => String(p.id) === pondId)) {
      setPondId('')
    }
  }, [pondsForScope, pondId])

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
    if (plScope !== 'fuel_site' || !canViewFuelGlReports) return
    void loadFuelIs()
  }, [plScope, canViewFuelGlReports, loadFuelIs, fuelStationId])

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
  const incomeByPond = data?.income_by_pond ?? []
  const incomeByCategory = data?.income_by_category ?? []

  const exportPayload = useMemo(
    () => ({
      plScope: plScope === 'ponds' ? 'Ponds (management P&L)' : 'Fuel & shop (GL by site)',
      start: plScope === 'ponds' ? start : fuelData?.period?.start_date ?? start,
      end: plScope === 'ponds' ? end : fuelData?.period?.end_date ?? end,
      ponds: data?.ponds as unknown as Record<string, unknown>[] | undefined,
      totals: data?.totals as unknown as Record<string, unknown> | undefined,
      incomeByPond: incomeByPond as unknown as Record<string, unknown>[],
      incomeByCategory: incomeByCategory as unknown as Record<string, unknown>[],
      expensesByPond: expensesByPond as unknown as Record<string, unknown>[],
      expensesByCategory: expensesByCategory as unknown as Record<string, unknown>[],
      incomeColumns: data?.pl_income_columns,
      expenseColumns: data?.pl_expense_columns,
      fuelIncomeStatement: plScope === 'fuel_site' ? (fuelData as unknown as Record<string, unknown>) : null,
    }),
    [plScope, start, end, data, incomeByPond, incomeByCategory, expensesByPond, expensesByCategory, fuelData],
  )

  const downloadPlManagement = useCallback(
    (format: 'json' | 'csv') => {
      const fileName = `Aquaculture_PL_Management_${exportPayload.end}`
      if (format === 'json') {
        const blob = new Blob(
          [
            JSON.stringify(
              {
                scope: exportPayload.plScope,
                period: { start: exportPayload.start, end: exportPayload.end },
                ponds: data,
                fuel_site_income_statement: fuelData,
                profit_transfers: transfers,
              },
              null,
              2,
            ),
          ],
          { type: 'application/json' },
        )
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `${fileName}.json`
        a.click()
        URL.revokeObjectURL(url)
        return
      }
      const csv = buildAquaculturePlManagementCsv(exportPayload)
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${fileName}.csv`
      a.click()
      URL.revokeObjectURL(url)
    },
    [data, exportPayload, fuelData, transfers],
  )

  const printPlManagement = useCallback(() => {
    const bodyHtml = buildAquaculturePlManagementPrintHtml(exportPayload)
    const ok = printDocument({
      title: 'Aquaculture P&L management',
      branding: { companyName: '', companyAddress: undefined, stationName: '' },
      bodyHtml: `
        <h1>Aquaculture P&amp;L management</h1>
        <div class="period">
          <strong>Generated:</strong> ${escapeHtml(formatDate(new Date(), true))}
        </div>
        ${bodyHtml || '<p>No data loaded — run the report first.</p>'}
      `,
    })
    if (!ok) toast.error('Printing was blocked. Allow pop-ups for this site and try again.')
  }, [exportPayload, toast])

  const fmtIsMoney = (s: string | undefined) => {
    const n = Number(String(s ?? '').replace(/,/g, ''))
    if (!Number.isFinite(n)) return `${sym}0.00`
    return `${sym}${formatNumber(n, 2)}`
  }

  const renderIsBlock = (title: string, block: GlIsSection | undefined) => (
    <div className="rounded-xl border border-border bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-border/70 bg-muted/40 px-4 py-3">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        <span className="text-sm font-semibold tabular-nums text-foreground">{fmtIsMoney(block?.total)}</span>
      </div>
      <ul className="divide-y divide-border/70">
        {(block?.accounts ?? []).length === 0 ? (
          <li className="px-4 py-6 text-center text-sm text-muted-foreground/70">No accounts in this section for the period.</li>
        ) : (
          (block?.accounts ?? []).map((a) => (
            <li key={`${title}-${a.account_code}`} className="flex justify-between gap-3 px-4 py-2.5 text-sm">
              <span className="min-w-0">
                <span className="font-medium text-foreground">{a.account_name}</span>
                <span className="ml-2 text-xs text-muted-foreground">{a.account_code}</span>
              </span>
              <span className="shrink-0 tabular-nums font-medium text-foreground">{fmtIsMoney(a.balance)}</span>
            </li>
          ))
        )}
      </ul>
    </div>
  )

  return (
    <div
      className={
        embedInReports
          ? 'w-full min-w-0 space-y-6'
          : 'mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6'
      }
    >
      {archiveFromUrl ? (
        <div className="rounded-xl border border-warning/30 bg-warning/10/90 px-4 py-3 text-sm text-warning-foreground">
          <div className="flex flex-wrap items-start gap-2">
            <Archive className="mt-0.5 h-4 w-4 shrink-0 text-warning-foreground" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-warning-foreground">
                Data Bank archive
                {archiveFromUrl.label ? `: ${archiveFromUrl.label}` : ''}
              </p>
              <p className="mt-1 text-warning-foreground/90">
                Read-only view for {formatDateOnly(archiveFromUrl.start)} –{' '}
                {formatDateOnly(archiveFromUrl.end)}
                {archiveFromUrl.pondId ? ' · one pond selected' : ' · all ponds in range'}.
                Operational data for this period is locked; adjust dates only to compare other periods.
              </p>
            </div>
            <Link
              href="/aquaculture/data-bank"
              className="shrink-0 rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold text-primary hover:bg-warning/10"
            >
              Back to Data Bank
            </Link>
          </div>
        </div>
      ) : null}

      {embedInReports ? (
        <div className="mb-2 flex flex-col gap-4 border-b border-border pb-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-2xl font-bold text-foreground">Aquaculture P&amp;L management</h2>
            <p className="mt-1 text-sm text-muted-foreground">Generated on {formatDate(new Date())}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={printPlManagement}
              className="inline-flex items-center gap-2 rounded-lg bg-success px-4 py-2 text-sm font-medium text-white hover:bg-success/90"
              title="Print report"
            >
              <Printer className="h-4 w-4" />
              Print
            </button>
            <button
              type="button"
              onClick={() => downloadPlManagement('csv')}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary"
              title="Export as CSV"
            >
              <Download className="h-4 w-4" />
              CSV
            </button>
            <button
              type="button"
              onClick={() => downloadPlManagement('json')}
              className="inline-flex items-center gap-2 rounded-lg bg-muted-foreground px-4 py-2 text-sm font-medium text-white hover:bg-foreground/90"
              title="Export as JSON"
            >
              <Download className="h-4 w-4" />
              JSON
            </button>
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Profit and loss scope">
        <button
          type="button"
          role="tab"
          aria-selected={plScope === 'ponds'}
          onClick={() => setPlScope('ponds')}
          className={`rounded-lg px-4 py-2 text-sm font-semibold shadow-sm transition ${
            plScope === 'ponds'
              ? 'bg-primary text-white ring-2 ring-teal-600/30'
              : 'bg-white text-foreground/85 ring-1 ring-border hover:bg-muted/40'
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
              ? 'bg-primary text-white ring-2 ring-primary/30'
              : 'bg-white text-foreground/85 ring-1 ring-border hover:bg-muted/40'
          }`}
        >
          Fuel &amp; shop (GL by site)
        </button>
      </div>

      <h1 id="aq-pl-title" className="mt-6 text-xl font-bold tracking-tight text-foreground">
        {plScope === 'ponds' ? 'Ponds — management profit & loss' : 'Fuel station & shop — site P&amp;L (posted GL)'}
      </h1>
      <p className="mt-1.5 max-w-3xl text-sm leading-relaxed text-muted-foreground">
        {plScope === 'ponds' ? (
          <>
            Net per pond is revenue (typed income lines) minus direct operating costs, your share of{' '}
            <span className="font-medium text-foreground">explicitly split</span> shared costs, and payroll allocated to
            that pond. Optional production cycles tag revenue and direct costs for segment views; shared costs and
            payroll stay full-pond unless you use cycle-only scope (then they show as zero by design).
          </>
        ) : (
          <>
            Posted GL income statement (same as Reports → P&amp;L). Use <strong>Site scope</strong> at the top to filter
            by station, or leave <strong>All</strong> for every station-tagged line in range.
          </>
        )}
      </p>

      {plScope === 'fuel_site' && !canViewFuelGlReports && (
        <div className="mt-4 rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning-foreground">
          Your role does not include the <strong>Reports</strong> permission. Ask a company admin to grant{' '}
          <code className="rounded bg-amber-100/90 px-1.5 py-0.5 text-xs">app.reports</code>, or open{' '}
          <Link href="/reports" className="font-medium text-primary underline underline-offset-2">
            Reports
          </Link>{' '}
          with an accountant or admin profile.
        </div>
      )}

      {plScope === 'fuel_site' && canViewFuelGlReports && (
        <>
          <div className="mt-6 flex flex-wrap items-end gap-3 rounded-xl border border-border bg-white p-4 shadow-sm">
            <label className="text-sm text-foreground/85">
              <span className="block text-xs font-medium uppercase tracking-wide text-muted-foreground">From</span>
              <input
                type="date"
                className="mt-1 rounded-lg border border-border px-2 py-1.5"
                value={start}
                onChange={(e) => setStart(e.target.value)}
                aria-label="Fuel P and L start date"
              />
            </label>
            <label className="text-sm text-foreground/85">
              <span className="block text-xs font-medium uppercase tracking-wide text-muted-foreground">To</span>
              <input
                type="date"
                className="mt-1 rounded-lg border border-border px-2 py-1.5"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
                aria-label="Fuel P and L end date"
              />
            </label>
            <button
              type="button"
              onClick={() => void loadFuelIs()}
              disabled={fuelLoading}
              className="inline-flex items-center gap-1 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${fuelLoading ? 'animate-spin' : ''}`} />
              Run
            </button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Site filter uses <strong>Site scope</strong> at the top of Reports.
            {fuelStationId ? ` Station #${fuelStationId} selected.` : ' All station-tagged lines in range.'}
          </p>

          {fuelData && (
            <div className="mt-8 space-y-6">
              {fuelData.period_matches_cumulative_change === false && (
                <div className="rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning-foreground">
                  <span className="font-semibold">Check cumulative P&amp;L: </span>
                  Period net ({fmtIsMoney(fuelData.net_income)}) differs from cumulative change (
                  {fmtIsMoney(fuelData.cumulative_net_income_change)}) by {fmtIsMoney(fuelData.cumulative_vs_period_difference)}.
                </div>
              )}
              {fuelData.accounting_note && (
                <p className="text-xs leading-relaxed text-muted-foreground">{fuelData.accounting_note}</p>
              )}
              <div className="grid gap-4 lg:grid-cols-3">
                <div className="lg:col-span-3 grid gap-4 sm:grid-cols-2">
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50/80 p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-emerald-800">Gross profit</p>
                    <p className="mt-1 text-2xl font-bold tabular-nums text-emerald-900">
                      {fmtIsMoney(fuelData.gross_profit)}
                    </p>
                  </div>
                  <div className="rounded-xl border border-primary/25 bg-accent/80 p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-primary">Net income</p>
                    <p className="mt-1 text-2xl font-bold tabular-nums text-foreground">
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
      <div className="mt-6 flex flex-wrap items-end gap-3 rounded-xl border border-border bg-white p-4 shadow-sm">
        <label className="text-sm text-foreground/85">
          <span className="block text-xs font-medium uppercase tracking-wide text-muted-foreground">From</span>
          <input
            type="date"
            className="mt-1 rounded-lg border border-border px-2 py-1.5"
            value={start}
            onChange={(e) => setStart(e.target.value)}
            aria-label="Report start date"
          />
        </label>
        <label className="text-sm text-foreground/85">
          <span className="block text-xs font-medium uppercase tracking-wide text-muted-foreground">To</span>
          <input
            type="date"
            className="mt-1 rounded-lg border border-border px-2 py-1.5"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
            aria-label="Report end date"
          />
        </label>
        <label className="text-sm text-foreground/85">
          <span className="block text-xs font-medium uppercase tracking-wide text-muted-foreground">Pond scope</span>
          <select
            className="mt-1 min-w-[12rem] rounded-lg border border-border px-2 py-1.5"
            value={pondId}
            onChange={(e) => {
              setPondId(e.target.value)
              setCycleId('')
            }}
            aria-label="Limit report to a single active pond"
          >
            <option value="">{archiveFromUrl ? 'All ponds in archive range' : 'All active ponds'}</option>
            {pondsForScope.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.is_active === false ? ' (inactive)' : ''}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm text-foreground/85">
          <span className="block text-xs font-medium uppercase tracking-wide text-muted-foreground">Production cycle</span>
          <select
            className="mt-1 min-w-[11rem] rounded-lg border border-border px-2 py-1.5 disabled:opacity-50"
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
        <label className="flex items-end gap-2 pb-0.5 text-sm text-foreground/85">
          <input
            type="checkbox"
            className="rounded border-border"
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
          className="inline-flex items-center gap-1 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          Run
        </button>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">Inactive ponds are excluded from this P&amp;L view.</p>

      {pondsMetaReady && ponds.length === 0 && (
        <div className="mt-4 rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning-foreground">
          No ponds defined yet — add ponds to see meaningful P&L rows.{' '}
          <Link href="/aquaculture/ponds" className="font-medium text-primary underline">
            Ponds
          </Link>
        </div>
      )}

      {ponds.length > 0 && activeCoa.length > 0 && (
        <div className="mt-8 rounded-xl border border-border bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-foreground">Post pond profit to the ledger</h2>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Creates a balanced journal entry for this company: debit the account that should increase (often an asset
            such as bank), credit the account that balances the movement (often equity or retained earnings). The row is
            tagged with the pond for your records; you choose both GL accounts.
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="block text-sm font-medium text-foreground/85">
              Pond
              <select
                className="mt-1 w-full rounded-lg border border-border px-2 py-2 text-sm"
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
            <label className="block text-sm font-medium text-foreground/85">
              Production cycle (optional)
              <select
                className="mt-1 w-full rounded-lg border border-border px-2 py-2 text-sm disabled:opacity-50"
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
            <label className="block text-sm font-medium text-foreground/85">
              Transfer date
              <input
                type="date"
                className="mt-1 w-full rounded-lg border border-border px-2 py-2 text-sm"
                value={xferForm.transfer_date}
                onChange={(e) => setXferForm((f) => ({ ...f, transfer_date: e.target.value }))}
              />
            </label>
            <label className="block text-sm font-medium text-foreground/85">
              Amount ({sym})
              <input
                type="number"
                min="0"
                step="0.01"
                className="mt-1 w-full rounded-lg border border-border px-2 py-2 text-sm tabular-nums"
                value={xferForm.amount}
                onChange={(e) => setXferForm((f) => ({ ...f, amount: e.target.value }))}
              />
            </label>
            <label className="flex items-center gap-2 pt-6 text-sm text-foreground/85">
              <input
                type="checkbox"
                className="rounded border-border"
                checked={xferForm.post}
                onChange={(e) => setXferForm((f) => ({ ...f, post: e.target.checked }))}
              />
              Post immediately (uncheck to leave the journal as draft)
            </label>
            <label className="block text-sm font-medium text-foreground/85 sm:col-span-1">
              Debit account
              <select
                className="mt-1 w-full rounded-lg border border-border px-2 py-2 text-sm"
                value={xferForm.debit_account_id}
                onChange={(e) => {
                  const v = e.target.value
                  if (v) xferGlTouchedRef.current.add('debit_account_id')
                  else xferGlTouchedRef.current.delete('debit_account_id')
                  setXferForm((f) => ({ ...f, debit_account_id: v }))
                }}
              >
                <option value="">{xferDebitRecommend}</option>
                {activeCoa.map((a) => (
                  <option key={a.id} value={a.id}>
                    {formatCoaOptionLabel(a)}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm font-medium text-foreground/85 sm:col-span-1">
              Credit account
              <select
                className="mt-1 w-full rounded-lg border border-border px-2 py-2 text-sm"
                value={xferForm.credit_account_id}
                onChange={(e) => {
                  const v = e.target.value
                  if (v) xferGlTouchedRef.current.add('credit_account_id')
                  else xferGlTouchedRef.current.delete('credit_account_id')
                  setXferForm((f) => ({ ...f, credit_account_id: v }))
                }}
              >
                <option value="">{xferCreditRecommend}</option>
                {activeCoa.map((a) => (
                  <option key={a.id} value={a.id}>
                    {formatCoaOptionLabel(a)}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm font-medium text-foreground/85 sm:col-span-2">
              Memo (optional)
              <input
                className="mt-1 w-full rounded-lg border border-border px-2 py-2 text-sm"
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
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary disabled:opacity-50"
            >
              {xferSubmitting ? 'Saving…' : 'Create transfer'}
            </button>
            <Link href="/journal-entries" className="text-sm font-medium text-primary underline">
              Open journal entries
            </Link>
            <button
              type="button"
              onClick={() => void loadTransfers()}
              disabled={xferLoading}
              className="text-sm text-muted-foreground hover:text-foreground disabled:opacity-50"
            >
              Refresh history
            </button>
          </div>

          {transfers.length > 0 && (
            <div className="mt-6 overflow-x-auto rounded-lg border border-border/70">
              <table className="min-w-full text-left text-sm">
                <caption className="sr-only">Recent pond profit transfers</caption>
                <thead className="border-b border-border bg-muted/40 text-muted-foreground">
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
                    <tr key={t.id} className="border-b border-border/70">
                      <td className="px-3 py-2 whitespace-nowrap">{t.transfer_date}</td>
                      <td className="px-3 py-2">{t.pond_name}</td>
                      <td className="px-3 py-2 text-muted-foreground">{t.production_cycle_name || '—'}</td>
                      <td className="px-3 py-2 text-right tabular-nums font-medium">
                        {sym}
                        {formatNumber(Number(t.amount))}
                      </td>
                      <td className="px-3 py-2 text-foreground/85">
                        {(t.debit_account_code || '').trim()} — {t.debit_account_name}
                      </td>
                      <td className="px-3 py-2 text-foreground/85">
                        {(t.credit_account_code || '').trim()} — {t.credit_account_name}
                      </td>
                      <td className="px-3 py-2">
                        {t.journal_entry_id ? (
                          <span className="text-foreground/85">
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
            <div className="rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning-foreground">
              {data.cycle_scope_note}
            </div>
          )}
          {data.shared_operating_cost_rule && (
            <div className="rounded-xl border border-border bg-muted/40 px-4 py-3 text-sm text-foreground">
              <span className="font-semibold text-foreground">Shared cost rule: </span>
              {data.shared_operating_cost_rule}
            </div>
          )}
          {data.inter_pond_fish_transfer_note && (
            <div className="rounded-xl border border-primary/25 bg-accent/80 px-4 py-3 text-sm text-teal-950">
              <span className="font-semibold text-teal-950">Fish pond transfers: </span>
              {data.inter_pond_fish_transfer_note}
            </div>
          )}
          <AquaculturePlNetSummary
            totals={data.totals}
            entityName={
              pondId
                ? data.ponds.find((p) => String(p.pond_id) === pondId)?.pond_name ?? `Pond #${pondId}`
                : data.ponds.length === 1
                  ? data.ponds[0]?.pond_name
                  : null
            }
          />

          <PlConsumptionCostsExpenses totals={data.totals} />
          {data.ponds.length !== 1 ? (
            <PlPondByPondExpenseTable ponds={data.ponds} totals={data.totals} />
          ) : null}
          <PlActiveExpenseCategoriesList categories={expensesByCategory} />

          <div>
            <h2 className="text-lg font-semibold text-foreground">P&amp;L — every income &amp; expense</h2>
            <div className="mt-3">
              <AquaculturePlCategoryMatrices
                incomeByPond={incomeByPond}
                incomeByCategory={incomeByCategory}
                expensesByPond={expensesByPond}
                expensesByCategory={expensesByCategory}
                incomeColumns={data.pl_income_columns}
                expenseColumns={data.pl_expense_columns}
                showFullCatalog
                combinedMode
                rowTotalsByPond={data.ponds.map((p) => ({
                  pond_id: p.pond_id,
                  income_total: p.income_total ?? p.revenue,
                  expense_total: p.expense_total ?? p.total_costs,
                  net_profit: p.net_profit ?? p.profit,
                }))}
                grandTotals={
                  data.pl_grand_totals ?? {
                    total_income: data.totals.revenue,
                    total_costs_and_expenses:
                      data.totals.total_costs_and_expenses ?? data.totals.total_costs,
                    net_profit: data.totals.net_profit ?? data.totals.profit,
                  }
                }
                formulaNote={data.pl_formula_note}
                pondScopeLabel={
                  pondId
                    ? data.ponds.find((p) => String(p.pond_id) === pondId)?.pond_name ?? `Pond #${pondId}`
                    : 'All ponds'
                }
              />
            </div>
          </div>

          {(data.pond_cycle_segments?.length ?? 0) > 0 && (
            <div>
              <h2 className="text-lg font-semibold text-foreground">Pond × production cycle (direct only)</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Segment margin uses direct opex plus fish transfer cost in minus cost out for that cycle (no shared cost
                or payroll).
              </p>
              <div className="mt-3 overflow-x-auto rounded-xl border border-border bg-white shadow-sm">
                <table className="min-w-full text-left text-sm">
                  <thead className="border-b border-border bg-muted/40">
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
                      <tr key={`${s.pond_id}-${s.production_cycle_id ?? 'none'}`} className="border-b border-border/70">
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
                        <td className="px-3 py-2 text-right tabular-nums text-foreground/85">
                          {sym}
                          {formatNumber(Number(s.fish_transfer_cost_in ?? 0))}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-foreground/85">
                          {sym}
                          {formatNumber(Number(s.fish_transfer_cost_out ?? 0))}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-foreground">
                          {sym}
                          {formatNumber(Number(s.direct_operating_expenses_with_transfers ?? s.direct_operating_expenses))}
                        </td>
                        <td className="px-3 py-2 text-right font-medium tabular-nums text-primary">
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

        </div>
      )}
        </>
      )}
    </div>
  )
}
