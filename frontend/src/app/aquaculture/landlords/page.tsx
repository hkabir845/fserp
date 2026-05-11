'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { CalendarRange, Droplets, Landmark, Plus, RefreshCw } from 'lucide-react'
import { useToast } from '@/components/Toast'
import api from '@/lib/api'
import { extractErrorMessage } from '@/utils/errorHandler'
import { formatNumber, getCurrencySymbol } from '@/utils/currency'

interface PondOpt {
  id: number
  name: string
}

interface LandlordRow {
  id: number
  name: string
  code: string
  phone: string
  is_active: boolean
  pond_share_count: number
  pond_id: number | null
  pond_name: string
  balance_signed: string
  balance_status: string
  metrics_year: number | null
  metrics_as_of: string
  land_share_decimal: string
  implied_annual_lease: string
  ytd_receivable: string
  ytd_paid: string
  ytd_balance: string
  remaining_contract_payable: string
  remaining_contract_excludes_open_ended: boolean
}

function statusLabel(s: string): string {
  if (s === 'payable') return 'We owe'
  if (s === 'credit') return 'Credit / prepaid'
  return 'Clear'
}

function statusClass(s: string): string {
  if (s === 'payable') return 'bg-amber-100 text-amber-900'
  if (s === 'credit') return 'bg-sky-100 text-sky-900'
  return 'bg-emerald-100 text-emerald-800'
}

function parseMoney(s: string): number {
  const n = Number(String(s).replace(/,/g, ''))
  return Number.isFinite(n) ? n : 0
}

type PeriodMode = 'all' | 'year'

export default function AquacultureLandlordsPage() {
  const toast = useToast()
  const router = useRouter()
  const [rows, setRows] = useState<LandlordRow[]>([])
  const [ponds, setPonds] = useState<PondOpt[]>([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(false)
  const [name, setName] = useState('')
  const [currency, setCurrency] = useState('BDT')
  const cy = new Date().getFullYear()
  const [periodMode, setPeriodMode] = useState<PeriodMode>('all')
  const [year, setYear] = useState(cy)
  const [pondId, setPondId] = useState<string>('')

  const sym = useMemo(() => getCurrencySymbol(currency), [currency])

  const loadCurrency = useCallback(async () => {
    try {
      const { data } = await api.get<Record<string, unknown>>('/companies/current/')
      setCurrency(String(data?.currency || 'BDT').slice(0, 3))
    } catch {
      /* keep default */
    }
  }, [])

  const loadPonds = useCallback(async () => {
    try {
      const { data } = await api.get<PondOpt[]>('/aquaculture/ponds/')
      setPonds(Array.isArray(data) ? data : [])
    } catch {
      setPonds([])
    }
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (periodMode === 'year') {
        params.set('year', String(year))
      } else {
        params.set('year', 'all')
      }
      if (pondId) {
        params.set('pond_id', pondId)
      }
      const { data } = await api.get<LandlordRow[]>(`/aquaculture/landlords/?${params.toString()}`)
      setRows(Array.isArray(data) ? data : [])
    } catch (e) {
      toast.error(extractErrorMessage(e, 'Could not load landlords'))
    } finally {
      setLoading(false)
    }
  }, [toast, periodMode, year, pondId])

  useEffect(() => {
    void loadCurrency()
  }, [loadCurrency])

  useEffect(() => {
    void loadPonds()
  }, [loadPonds])

  useEffect(() => {
    void load()
  }, [load])

  const metricsAsOf = rows[0]?.metrics_as_of ?? new Date().toISOString().slice(0, 10)

  const uniqueLandlordIds = useMemo(() => new Set(rows.map((r) => r.id)), [rows])

  const totals = useMemo(() => {
    let land = 0
    let annual = 0
    let rec = 0
    let paid = 0
    let bal = 0
    let rem = 0
    let anyOpenEndedGap = false
    for (const r of rows) {
      land += parseMoney(r.land_share_decimal)
      annual += parseMoney(r.implied_annual_lease)
      rec += parseMoney(r.ytd_receivable)
      paid += parseMoney(r.ytd_paid)
      bal += parseMoney(r.ytd_balance)
      rem += parseMoney(r.remaining_contract_payable)
      if (r.remaining_contract_excludes_open_ended) anyOpenEndedGap = true
    }
    return { land, annual, rec, paid, bal, rem, anyOpenEndedGap }
  }, [rows])

  const yearOptions = useMemo(() => {
    const out: number[] = []
    for (let y = cy + 1; y >= cy - 8; y--) out.push(y)
    return out
  }, [cy])

  const periodDescription = useMemo(() => {
    if (periodMode === 'all') return 'all dates (lifetime subledger activity for each pond row)'
    return `calendar year ${year}`
  }, [periodMode, year])

  const create = async () => {
    const n = name.trim()
    if (!n) {
      toast.error('Name is required')
      return
    }
    try {
      const { data } = await api.post<{ id: number }>('/aquaculture/landlords/', {
        name: n,
      })
      toast.success('Landlord created')
      setModal(false)
      setName('')
      void load()
      if (data?.id) router.push(`/aquaculture/landlords/${data.id}`)
    } catch (e) {
      toast.error(extractErrorMessage(e, 'Could not create'))
    }
  }

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-8">
      <div className="mb-8 flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-6">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight text-slate-900">
            <Landmark className="h-7 w-7 shrink-0 text-teal-700" aria-hidden />
            Landlords & lease obligations
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-600">
            Pond-level view of land shares, rent recognized and paid in the selected period, and the estimated lease
            still payable through each contract&apos;s end date (prorated on a 365-day year). Open-ended leases are
            omitted from the remainder column.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
            <Droplets className="h-4 w-4 text-slate-500" aria-hidden />
            <span className="font-medium">Pond</span>
            <select
              value={pondId}
              onChange={(e) => setPondId(e.target.value)}
              className="max-w-[200px] rounded border border-slate-300 bg-white px-2 py-1 text-sm font-medium text-slate-900"
            >
              <option value="">All ponds</option>
              {ponds.map((p) => (
                <option key={p.id} value={String(p.id)}>
                  {p.name || `Pond #${p.id}`}
                </option>
              ))}
            </select>
          </label>
          <label className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
            <CalendarRange className="h-4 w-4 text-slate-500" aria-hidden />
            <span className="font-medium">Period</span>
            <select
              value={periodMode}
              onChange={(e) => setPeriodMode(e.target.value as PeriodMode)}
              className="rounded border border-slate-300 bg-white px-2 py-1 text-sm font-medium text-slate-900"
            >
              <option value="all">All</option>
              <option value="year">Year</option>
            </select>
            {periodMode === 'year' ? (
              <select
                value={year}
                onChange={(e) => setYear(Number(e.target.value))}
                className="rounded border border-slate-300 bg-white px-2 py-1 text-sm font-medium text-slate-900"
              >
                {yearOptions.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            ) : null}
          </label>
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800 shadow-sm hover:bg-slate-50"
          >
            <RefreshCw className="h-4 w-4" aria-hidden />
            Refresh
          </button>
          <button
            type="button"
            onClick={() => {
              setName('')
              setModal(true)
            }}
            className="inline-flex items-center gap-1 rounded-lg bg-teal-700 px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-teal-800"
          >
            <Plus className="h-4 w-4" aria-hidden />
            New landlord
          </button>
        </div>
      </div>

      <p className="mb-4 text-xs text-slate-500">
        Period columns use ledger entry dates for <span className="font-medium text-slate-700">{periodDescription}</span>
        , matched to each row&apos;s pond when the line has a pond; lines without a pond appear as &quot;No pond&quot;
        (only when viewing all ponds). Remaining contract payable is measured from{' '}
        <span className="font-medium text-slate-700">{metricsAsOf}</span> through each pond&apos;s lease end (when set).
      </p>

      {!loading && rows.length > 0 ? (
        <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Land share</p>
            <p className="mt-1 text-lg font-semibold tabular-nums text-slate-900">
              {formatNumber(totals.land, 4)} <span className="text-sm font-normal text-slate-500">dec</span>
            </p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Implied annual rent</p>
            <p className="mt-1 text-lg font-semibold tabular-nums text-slate-900">
              {sym}
              {formatNumber(totals.annual, 2)}
            </p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Period receivable</p>
            <p className="mt-1 text-lg font-semibold tabular-nums text-slate-900">
              {sym}
              {formatNumber(totals.rec, 2)}
            </p>
            <p className="mt-0.5 text-[11px] text-slate-500">Charges & positive adjustments</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Period paid</p>
            <p className="mt-1 text-lg font-semibold tabular-nums text-slate-900">
              {sym}
              {formatNumber(totals.paid, 2)}
            </p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Period balance</p>
            <p className="mt-1 text-lg font-semibold tabular-nums text-slate-900">
              {sym}
              {formatNumber(totals.bal, 2)}
            </p>
            <p className="mt-0.5 text-[11px] text-slate-500">Receivable − paid (selected period)</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Remainder of contracts</p>
            <p className="mt-1 text-lg font-semibold tabular-nums text-slate-900">
              {sym}
              {formatNumber(totals.rem, 2)}
            </p>
            {totals.anyOpenEndedGap ? (
              <p className="mt-0.5 text-[11px] text-amber-800">Some rows exclude open-ended leases</p>
            ) : (
              <p className="mt-0.5 text-[11px] text-slate-500">Through lease end</p>
            )}
          </div>
        </div>
      ) : null}

      {rows.length > uniqueLandlordIds.size ? (
        <p className="mb-3 text-xs text-slate-500">
          The same landlord may appear on multiple rows (one per pond share).{' '}
          <span className="font-medium text-slate-600">Ledger balance</span> repeats the landlord&apos;s total running
          balance on each row — do not sum that column across rows.
        </p>
      ) : null}

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-[1180px] w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
              <tr>
                <th className="whitespace-nowrap px-3 py-3 pl-4 font-medium">Pond</th>
                <th className="whitespace-nowrap px-3 py-3 font-medium">Landlord</th>
                <th className="whitespace-nowrap px-3 py-3 text-right font-medium">Land share</th>
                <th className="whitespace-nowrap px-3 py-3 text-right font-medium">Implied annual</th>
                <th className="whitespace-nowrap px-3 py-3 text-right font-medium">Period rec.</th>
                <th className="whitespace-nowrap px-3 py-3 text-right font-medium">Period paid</th>
                <th className="whitespace-nowrap px-3 py-3 text-right font-medium">Period bal.</th>
                <th className="whitespace-nowrap px-3 py-3 text-right font-medium">Contract remainder</th>
                <th className="whitespace-nowrap px-3 py-3 text-right font-medium">Ledger balance</th>
                <th className="whitespace-nowrap px-3 py-3 font-medium">Status</th>
                <th className="whitespace-nowrap px-3 py-3 pr-4 text-right font-medium"> </th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={11} className="px-4 py-12 text-center text-slate-500">
                    Loading…
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={11} className="px-4 py-12 text-center text-slate-500">
                    No pond shares yet. Open a landlord to assign land decimals per pond, or widen your filters.
                  </td>
                </tr>
              ) : (
                rows.map((r) => {
                  const pLabel =
                    r.pond_id == null
                      ? r.pond_name?.trim() || 'No pond'
                      : r.pond_name?.trim() || `Pond #${r.pond_id}`
                  const rk = `${r.id}-${r.pond_id ?? 'na'}`
                  return (
                    <tr key={rk} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/80">
                      <td className="px-3 py-3 pl-4 align-top text-slate-800">{pLabel}</td>
                      <td className="px-3 py-3 align-top">
                        <div className="font-medium text-slate-900">{r.name}</div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500">
                          {r.code ? <span>{r.code}</span> : null}
                          <span>
                            {r.pond_share_count} pond{r.pond_share_count === 1 ? '' : 's'} total
                          </span>
                          {!r.is_active ? (
                            <span className="rounded bg-slate-200 px-1.5 py-0.5 text-slate-700">Inactive</span>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums text-slate-800">
                        {formatNumber(parseMoney(r.land_share_decimal), 4)}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums text-slate-800">
                        {sym}
                        {formatNumber(parseMoney(r.implied_annual_lease), 2)}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums text-slate-800">
                        {sym}
                        {formatNumber(parseMoney(r.ytd_receivable), 2)}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums text-slate-800">
                        {sym}
                        {formatNumber(parseMoney(r.ytd_paid), 2)}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums text-slate-800">
                        {sym}
                        {formatNumber(parseMoney(r.ytd_balance), 2)}
                      </td>
                      <td className="px-3 py-3 text-right align-top tabular-nums text-slate-800">
                        <div>
                          {sym}
                          {formatNumber(parseMoney(r.remaining_contract_payable), 2)}
                        </div>
                        {r.remaining_contract_excludes_open_ended ? (
                          <div className="mt-0.5 text-[11px] font-normal text-amber-800">+ open-ended</div>
                        ) : null}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums text-slate-800">
                        {sym}
                        {formatNumber(parseMoney(r.balance_signed), 2)}
                      </td>
                      <td className="px-3 py-3 align-top">
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${statusClass(r.balance_status)}`}
                        >
                          {statusLabel(r.balance_status)}
                        </span>
                      </td>
                      <td className="px-3 py-3 pr-4 text-right align-top">
                        <Link
                          href={`/aquaculture/landlords/${r.id}`}
                          className="font-medium text-teal-800 underline-offset-2 hover:text-teal-950 hover:underline"
                        >
                          Open
                        </Link>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-4 space-y-1 text-xs text-slate-500">
        <p>
          <span className="font-medium text-slate-600">Ledger balance</span> is the running obligation from all landlord
          ledger entries (all dates), not limited to the selected period. Positive means we owe the landlord; negative
          means credit or overpayment.
        </p>
        <p>
          <span className="font-medium text-slate-600">Contract remainder</span> uses each pond&apos;s lease price per
          decimal × this landlord&apos;s share on that row, prorated from the as-of date above through{' '}
          <code className="rounded bg-slate-100 px-1">lease_contract_end</code> when set.
        </p>
      </div>

      {modal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-xl">
            <h2 className="text-lg font-semibold text-slate-900">New landlord</h2>
            <label className="mt-4 block text-sm font-medium text-slate-700">
              Name *
              <input
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Md. Rahman"
              />
            </label>
            <p className="mt-3 text-xs text-slate-600">
              A reference code is assigned automatically (for example LL-0001). You can change it later on the landlord
              detail page if needed.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setModal(false)}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void create()}
                className="rounded-lg bg-teal-700 px-3 py-2 text-sm font-medium text-white hover:bg-teal-800"
              >
                Create
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
