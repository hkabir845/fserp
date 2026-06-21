'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  CalendarRange,
  Droplets,
  Eye,
  Landmark,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  Wallet,
} from 'lucide-react'
import { AquaculturePageShell } from '@/components/aquaculture/AquaculturePageShell'
import { AQ_HERO_BTN_GHOST, AQ_HERO_BTN_PRIMARY } from '@/components/aquaculture/AquacultureUi'
import { useToast } from '@/components/Toast'
import { usePageMeta } from '@/hooks/usePageMeta'
import api from '@/lib/api'
import { extractErrorMessage } from '@/utils/errorHandler'
import { formatNumber, getCurrencySymbol } from '@/utils/currency'
import { LandlordFormModal } from './LandlordFormModal'
import { LandlordLedgerEntryModal } from './LandlordLedgerEntryModal'
import {
  parseMoney,
  statusClass,
  statusLabel,
  type PondOpt,
} from './landlordShared'

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

type PeriodMode = 'all' | 'year'

type FormModalState = null | { mode: 'create' } | { mode: 'edit'; id: number }
type PayModalState = null | { id: number; name: string }

function iconBtnClass(variant: 'default' | 'danger' = 'default') {
  const base =
    'inline-flex h-8 w-8 items-center justify-center rounded-lg border transition-colors focus:outline-none focus:ring-2 focus:ring-teal-500/40'
  if (variant === 'danger') {
    return `${base} border-transparent text-slate-500 hover:border-red-200 hover:bg-red-50 hover:text-red-800`
  }
  return `${base} border-transparent text-slate-600 hover:border-slate-200 hover:bg-slate-100 hover:text-teal-900`
}

export default function AquacultureLandlordsPage() {
  const pageMeta = usePageMeta()
  const toast = useToast()
  const router = useRouter()
  const [rows, setRows] = useState<LandlordRow[]>([])
  const [ponds, setPonds] = useState<PondOpt[]>([])
  const [loading, setLoading] = useState(true)
  const [formModal, setFormModal] = useState<FormModalState>(null)
  const [payModal, setPayModal] = useState<PayModalState>(null)
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
      if (pondId) params.set('pond_id', pondId)
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

  const deleteLandlord = async (id: number, name: string) => {
    if (
      !globalThis.confirm(
        `Delete landlord “${name}” and all ledger history? This cannot be undone.`,
      )
    ) {
      return
    }
    try {
      await api.delete(`/aquaculture/landlords/${id}/`)
      toast.success('Landlord deleted')
      void load()
    } catch (e) {
      toast.error(extractErrorMessage(e, 'Could not delete'))
    }
  }

  const handleFormSuccess = (id: number) => {
    void load()
    if (formModal?.mode === 'create') {
      router.push(`/aquaculture/landlords/${id}`)
    }
  }

  return (
    <AquaculturePageShell
      titleIcon={Landmark}
      title={pageMeta.title}
      description={pageMeta.description}
      eyebrow={pageMeta.eyebrow}
      maxWidthClass="max-w-[1400px]"
      actions={
        <>
          <label className="text-xs font-medium text-teal-100">
            <span className="inline-flex items-center gap-1">
              <Droplets className="h-3.5 w-3.5" aria-hidden />
              Pond
            </span>
            <select
              value={pondId}
              onChange={(e) => setPondId(e.target.value)}
              className="mt-1 block max-w-[200px] rounded-lg border border-white/20 bg-white/10 px-2 py-1.5 text-sm text-white"
            >
              <option value="">All ponds</option>
              {ponds.map((p) => (
                <option key={p.id} value={String(p.id)}>
                  {p.name || `Pond #${p.id}`}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-medium text-teal-100">
            <span className="inline-flex items-center gap-1">
              <CalendarRange className="h-3.5 w-3.5" aria-hidden />
              Period
            </span>
            <div className="mt-1 flex flex-wrap items-center gap-1">
              <select
                value={periodMode}
                onChange={(e) => setPeriodMode(e.target.value as PeriodMode)}
                className="rounded-lg border border-white/20 bg-white/10 px-2 py-1.5 text-sm text-white"
              >
                <option value="all">All</option>
                <option value="year">Year</option>
              </select>
              {periodMode === 'year' ? (
                <select
                  value={year}
                  onChange={(e) => setYear(Number(e.target.value))}
                  className="rounded-lg border border-white/20 bg-white/10 px-2 py-1.5 text-sm text-white"
                >
                  {yearOptions.map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </select>
              ) : null}
            </div>
          </label>
          <button type="button" onClick={() => void load()} className={AQ_HERO_BTN_GHOST}>
            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
            Refresh
          </button>
          <button type="button" onClick={() => setFormModal({ mode: 'create' })} className={AQ_HERO_BTN_PRIMARY}>
            <Plus className="h-3.5 w-3.5" aria-hidden />
            New landlord
          </button>
        </>
      }
    >
      <p className="text-xs text-slate-500">
        Period columns use ledger entry dates for <span className="font-medium text-slate-700">{periodDescription}</span>
        , matched to each row&apos;s pond when the line has a pond. Remaining contract payable is measured from{' '}
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
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Contract remainder</p>
            <p className="mt-1 text-lg font-semibold tabular-nums text-slate-900">
              {sym}
              {formatNumber(totals.rem, 2)}
            </p>
            {totals.anyOpenEndedGap ? (
              <p className="mt-0.5 text-[11px] text-amber-800">Some rows exclude open-ended leases</p>
            ) : null}
          </div>
        </div>
      ) : null}

      {rows.length > uniqueLandlordIds.size ? (
        <p className="mb-3 text-xs text-slate-500">
          The same landlord may appear on multiple rows (one per pond share). Do not sum the ledger balance column across
          rows.
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
                <th className="sticky right-0 whitespace-nowrap bg-slate-50 px-3 py-3 pr-4 text-right font-medium shadow-[-4px_0_8px_-4px_rgba(0,0,0,0.08)]">
                  Actions
                </th>
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
                    No landlords yet.{' '}
                    <button
                      type="button"
                      className="font-medium text-teal-800 underline"
                      onClick={() => setFormModal({ mode: 'create' })}
                    >
                      Create the first landlord
                    </button>
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
                    <tr key={rk} className="group border-b border-slate-100 last:border-0 hover:bg-slate-50/80">
                      <td className="px-3 py-3 pl-4 align-top text-slate-800">{pLabel}</td>
                      <td className="px-3 py-3 align-top">
                        <Link
                          href={`/aquaculture/landlords/${r.id}`}
                          className="font-medium text-slate-900 hover:text-teal-900 hover:underline"
                        >
                          {r.name}
                        </Link>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500">
                          {r.code ? <span className="font-mono">{r.code}</span> : null}
                          <span>
                            {r.pond_share_count} pond{r.pond_share_count === 1 ? '' : 's'}
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
                      <td className="px-3 py-3 text-right tabular-nums font-medium text-slate-900">
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
                      <td className="sticky right-0 bg-white px-3 py-3 pr-4 text-right align-top group-hover:bg-slate-50/80">
                        <div className="inline-flex items-center gap-0.5">
                          <Link
                            href={`/aquaculture/landlords/${r.id}`}
                            className={iconBtnClass()}
                            title="View ledger"
                            aria-label={`View ledger for ${r.name}`}
                          >
                            <Eye className="h-4 w-4" aria-hidden />
                          </Link>
                          <button
                            type="button"
                            className={iconBtnClass()}
                            title="Edit landlord"
                            aria-label={`Edit ${r.name}`}
                            onClick={() => setFormModal({ mode: 'edit', id: r.id })}
                          >
                            <Pencil className="h-4 w-4" aria-hidden />
                          </button>
                          <button
                            type="button"
                            className={iconBtnClass()}
                            title="Record payment"
                            aria-label={`Record payment for ${r.name}`}
                            onClick={() => setPayModal({ id: r.id, name: r.name })}
                          >
                            <Wallet className="h-4 w-4" aria-hidden />
                          </button>
                          <button
                            type="button"
                            className={iconBtnClass('danger')}
                            title="Delete landlord"
                            aria-label={`Delete ${r.name}`}
                            onClick={() => void deleteLandlord(r.id, r.name)}
                          >
                            <Trash2 className="h-4 w-4" aria-hidden />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <LandlordFormModal
        open={formModal != null}
        mode={formModal?.mode ?? 'create'}
        landlordId={formModal?.mode === 'edit' ? formModal.id : undefined}
        ponds={ponds}
        currency={currency}
        onClose={() => setFormModal(null)}
        onSuccess={handleFormSuccess}
      />

      {payModal ? (
        <LandlordLedgerEntryModal
          open
          landlordId={payModal.id}
          landlordName={payModal.name}
          ponds={ponds}
          currency={currency}
          defaultKind="payment"
          onClose={() => setPayModal(null)}
          onSuccess={() => void load()}
        />
      ) : null}
    </AquaculturePageShell>
  )
}
