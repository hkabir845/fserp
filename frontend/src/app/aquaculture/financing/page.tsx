'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Landmark, RefreshCw, Trash2, Wallet } from 'lucide-react'
import { useToast } from '@/components/Toast'
import api from '@/lib/api'
import { extractErrorMessage } from '@/utils/errorHandler'
import { getCurrencySymbol, formatNumber } from '@/utils/currency'
import { formatCoaOptionLabel } from '@/utils/coaOptionLabel'

type FinancingLoan = {
  id: number
  loan_no: string
  title: string
  status: string
  counterparty_name: string
  outstanding_principal: string
  total_disbursed: string
}

type Overview = {
  loans: FinancingLoan[]
  totals: { outstanding_principal: string; loan_count: number }
  recent_disbursements: {
    id: number
    loan_id: number
    loan_no: string
    disbursement_date: string
    amount: string
  }[]
  recent_allocations: {
    id: number
    loan_id: number
    loan_no: string
    pond_id: number
    pond_name: string
    allocation_date: string
    amount: string
    allocation_kind: string
    memo: string
  }[]
  active_ponds: { id: number; name: string }[]
  repayment_methods: { id: string; label: string }[]
}

type WorksheetPond = {
  pond_id: number
  pond_name: string
  revenue: string
  profit: string
  suggested_amount: string
  selected?: boolean
}

type CoaRow = { id: number; account_code: string; account_name: string; account_type: string }

function isoToday(): string {
  return new Date().toISOString().slice(0, 10)
}

function monthStart(): string {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10)
}

export default function AquacultureFinancingPage() {
  const toast = useToast()
  const currency = getCurrencySymbol()
  const [loading, setLoading] = useState(true)
  const [overview, setOverview] = useState<Overview | null>(null)
  const [coa, setCoa] = useState<CoaRow[]>([])

  const [selectedLoanId, setSelectedLoanId] = useState<number | ''>('')
  const [plStart, setPlStart] = useState(monthStart)
  const [plEnd, setPlEnd] = useState(isoToday)
  const [method, setMethod] = useState('profit_share')
  const [repayTotal, setRepayTotal] = useState('')
  const [worksheet, setWorksheet] = useState<{
    ponds: WorksheetPond[]
    sum_suggested: string
    outstanding_principal: string
  } | null>(null)
  const [worksheetLoading, setWorksheetLoading] = useState(false)
  const [applyLoading, setApplyLoading] = useState(false)
  const [transferDate, setTransferDate] = useState(isoToday)
  const [debitAccountId, setDebitAccountId] = useState<number | ''>('')
  const [creditAccountId, setCreditAccountId] = useState<number | ''>('')
  const [alsoRepayLoan, setAlsoRepayLoan] = useState(true)
  const [postTransfers, setPostTransfers] = useState(true)

  const [allocLoanId, setAllocLoanId] = useState<number | ''>('')
  const [allocDate, setAllocDate] = useState(isoToday)
  const [allocRows, setAllocRows] = useState<{ pond_id: number | ''; amount: string; memo: string }[]>([
    { pond_id: '', amount: '', memo: '' },
  ])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [ov, coaRes] = await Promise.all([
        api.get<Overview>('/aquaculture/financing/'),
        api.get<CoaRow[]>('/chart-of-accounts/'),
      ])
      setOverview(ov.data)
      setCoa(coaRes.data.filter((a) => a.account_type === 'asset' || a.account_type === 'liability'))
      const firstLoan = ov.data.loans[0]
      if (firstLoan) {
        setSelectedLoanId((prev) => (prev === '' ? firstLoan.id : prev))
        setAllocLoanId((prev) => (prev === '' ? firstLoan.id : prev))
      }
    } catch (e) {
      toast.error(extractErrorMessage(e, 'Failed to load financing'))
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    document.title = 'Aquaculture financing · FSERP'
    void load()
  }, [load])

  const selectedLoan = useMemo(
    () => overview?.loans.find((l) => l.id === selectedLoanId),
    [overview, selectedLoanId]
  )

  const buildWorksheet = async () => {
    if (!selectedLoanId || !repayTotal.trim()) {
      toast.error('Select a loan and enter repayment total')
      return
    }
    setWorksheetLoading(true)
    try {
      const { data } = await api.get('/aquaculture/financing/repayment-worksheet/', {
        params: {
          loan_id: selectedLoanId,
          start_date: plStart,
          end_date: plEnd,
          method,
          total_amount: repayTotal,
        },
      })
      setWorksheet({
        ponds: data.ponds.map((p: WorksheetPond) => ({ ...p, selected: Number(p.suggested_amount) > 0 })),
        sum_suggested: data.sum_suggested,
        outstanding_principal: data.outstanding_principal,
      })
    } catch (e) {
      toast.error(extractErrorMessage(e, 'Worksheet failed'))
    } finally {
      setWorksheetLoading(false)
    }
  }

  const applyWorksheet = async () => {
    if (!worksheet || !selectedLoanId) return
    if (!debitAccountId || !creditAccountId) {
      toast.error('Select debit and credit GL accounts for pond profit transfers')
      return
    }
    const rows = worksheet.ponds
      .filter((p) => p.selected && Number(p.suggested_amount) > 0)
      .map((p) => ({
        pond_id: p.pond_id,
        amount: p.suggested_amount,
        include: true,
      }))
    if (!rows.length) {
      toast.error('Select at least one pond with a positive amount')
      return
    }
    const sum = rows.reduce((s, r) => s + Number(r.amount), 0)
    setApplyLoading(true)
    try {
      const body: Record<string, unknown> = {
        loan_id: selectedLoanId,
        transfer_date: transferDate,
        debit_account_id: debitAccountId,
        credit_account_id: creditAccountId,
        post_transfers: postTransfers,
        ponds: rows,
      }
      if (alsoRepayLoan) {
        body.loan_repay = {
          amount: sum.toFixed(2),
          principal_amount: sum.toFixed(2),
          interest_amount: '0',
          repayment_date: transferDate,
          post_to_gl: true,
          memo: 'Aquaculture financing worksheet',
        }
      }
      await api.post('/aquaculture/financing/repayment-apply/', body)
      toast.success('Repayment worksheet applied')
      setWorksheet(null)
      await load()
    } catch (e) {
      toast.error(extractErrorMessage(e, 'Apply failed'))
    } finally {
      setApplyLoading(false)
    }
  }

  const submitAllocations = async () => {
    if (!allocLoanId) {
      toast.error('Select a loan')
      return
    }
    const rows = allocRows
      .filter((r) => r.pond_id !== '' && Number(r.amount) > 0)
      .map((r) => ({
        pond_id: Number(r.pond_id),
        amount: String(Number(r.amount).toFixed(2)),
        memo: r.memo || 'Loan use allocation',
      }))
    if (!rows.length) {
      toast.error('Add at least one pond row with amount')
      return
    }
    try {
      await api.post('/aquaculture/financing/allocations/', {
        loan_id: allocLoanId,
        allocation_date: allocDate,
        allocation_kind: 'use',
        rows,
      })
      toast.success('Pond allocations recorded')
      setAllocRows([{ pond_id: '', amount: '', memo: '' }])
      await load()
    } catch (e) {
      toast.error(extractErrorMessage(e, 'Allocation failed'))
    }
  }

  const useFullOutstanding = () => {
    if (selectedLoan) setRepayTotal(selectedLoan.outstanding_principal)
  }

  return (
    <div className="mx-auto max-w-6xl space-y-8 p-4 pb-16 sm:p-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 flex items-center gap-2">
            <Wallet className="h-7 w-7 text-teal-700" />
            Aquaculture financing
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-600">
            One working-capital loan for the whole site: tag spend on ponds via bills and expenses, track how
            disbursements are attributed, and repay from pond P&amp;L using profit transfers plus loan repayment.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          <Link
            href="/loans"
            className="inline-flex items-center gap-2 rounded-lg bg-teal-700 px-3 py-2 text-sm font-medium text-white hover:bg-teal-800"
          >
            <Landmark className="h-4 w-4" />
            Loans register
          </Link>
        </div>
      </header>

      {loading && !overview ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : overview ? (
        <>
          <section className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Outstanding (tagged loans)</p>
              <p className="mt-1 text-2xl font-semibold text-slate-900">
                {currency}
                {formatNumber(overview.totals.outstanding_principal)}
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Aquaculture loans</p>
              <p className="mt-1 text-2xl font-semibold text-slate-900">{overview.totals.loan_count}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Active ponds</p>
              <p className="mt-1 text-2xl font-semibold text-slate-900">{overview.active_ponds.length}</p>
            </div>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-900">Tagged loans</h2>
            {overview.loans.length === 0 ? (
              <p className="mt-2 text-sm text-slate-600">
                No borrowed loans marked as aquaculture working capital. On{' '}
                <Link href="/loans" className="text-teal-700 underline">
                  Loans
                </Link>
                , create or edit a <strong>borrowed</strong> loan and enable &quot;Aquaculture working capital (all
                ponds)&quot;.
              </p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-slate-500">
                      <th className="py-2 pr-4">Loan</th>
                      <th className="py-2 pr-4">Counterparty</th>
                      <th className="py-2 pr-4">Status</th>
                      <th className="py-2 pr-4 text-right">Outstanding</th>
                      <th className="py-2 text-right">Disbursed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {overview.loans.map((l) => (
                      <tr key={l.id} className="border-b border-slate-100">
                        <td className="py-2 pr-4 font-medium">
                          {l.loan_no}
                          {l.title ? ` — ${l.title}` : ''}
                        </td>
                        <td className="py-2 pr-4">{l.counterparty_name}</td>
                        <td className="py-2 pr-4 capitalize">{l.status}</td>
                        <td className="py-2 pr-4 text-right">
                          {currency}
                          {formatNumber(l.outstanding_principal)}
                        </td>
                        <td className="py-2 text-right">
                          {currency}
                          {formatNumber(l.total_disbursed)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="rounded-xl border border-teal-100 bg-teal-50/40 p-4">
            <h2 className="text-lg font-semibold text-teal-900">Record pond use of loan funds</h2>
            <p className="mt-1 text-sm text-teal-800">
              Management tracking only — does not post GL. Use after a disbursement or when attributing shared costs.
            </p>
            <div className="mt-4 flex flex-wrap gap-3">
              <label className="text-sm">
                <span className="block text-xs font-medium text-slate-600">Loan</span>
                <select
                  className="mt-1 rounded border border-slate-300 px-2 py-1.5"
                  value={allocLoanId === '' ? '' : String(allocLoanId)}
                  onChange={(e) => setAllocLoanId(e.target.value === '' ? '' : Number(e.target.value))}
                >
                  <option value="">—</option>
                  {overview.loans.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.loan_no}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                <span className="block text-xs font-medium text-slate-600">Date</span>
                <input
                  type="date"
                  className="mt-1 rounded border border-slate-300 px-2 py-1.5"
                  value={allocDate}
                  onChange={(e) => setAllocDate(e.target.value)}
                />
              </label>
            </div>
            <div className="mt-3 space-y-2">
              {allocRows.map((row, idx) => (
                <div key={idx} className="flex flex-wrap gap-2 items-end">
                  <select
                    className="rounded border border-slate-300 px-2 py-1.5 text-sm"
                    value={row.pond_id === '' ? '' : String(row.pond_id)}
                    onChange={(e) => {
                      const next = [...allocRows]
                      next[idx] = { ...next[idx], pond_id: e.target.value === '' ? '' : Number(e.target.value) }
                      setAllocRows(next)
                    }}
                  >
                    <option value="">Pond</option>
                    {overview.active_ponds.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="Amount"
                    className="w-28 rounded border border-slate-300 px-2 py-1.5 text-sm"
                    value={row.amount}
                    onChange={(e) => {
                      const next = [...allocRows]
                      next[idx] = { ...next[idx], amount: e.target.value }
                      setAllocRows(next)
                    }}
                  />
                  <input
                    type="text"
                    placeholder="Memo"
                    className="min-w-[12rem] flex-1 rounded border border-slate-300 px-2 py-1.5 text-sm"
                    value={row.memo}
                    onChange={(e) => {
                      const next = [...allocRows]
                      next[idx] = { ...next[idx], memo: e.target.value }
                      setAllocRows(next)
                    }}
                  />
                  {allocRows.length > 1 ? (
                    <button
                      type="button"
                      title="Remove row"
                      aria-label="Remove row"
                      className="rounded border border-slate-300 bg-white p-2 text-slate-600 hover:bg-slate-50 hover:text-red-700"
                      onClick={() => setAllocRows((prev) => prev.filter((_, i) => i !== idx))}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </button>
                  ) : null}
                </div>
              ))}
              <button
                type="button"
                className="text-sm text-teal-700 underline"
                onClick={() => setAllocRows((prev) => [...prev, { pond_id: '', amount: '', memo: '' }])}
              >
                + Add row
              </button>
            </div>
            <button
              type="button"
              onClick={() => void submitAllocations()}
              className="mt-4 rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800"
            >
              Save allocations
            </button>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm space-y-4">
            <h2 className="text-lg font-semibold text-slate-900">Repayment worksheet</h2>
            <p className="text-sm text-slate-600">
              Splits a repayment total across ponds by P&amp;L for the period, then posts pond profit transfers and
              optionally a loan principal repayment.
            </p>
            <div className="flex flex-wrap gap-3">
              <label className="text-sm">
                <span className="block text-xs font-medium text-slate-600">Loan</span>
                <select
                  className="mt-1 rounded border border-slate-300 px-2 py-1.5 min-w-[10rem]"
                  value={selectedLoanId === '' ? '' : String(selectedLoanId)}
                  onChange={(e) => {
                    const v = e.target.value === '' ? '' : Number(e.target.value)
                    setSelectedLoanId(v)
                    setWorksheet(null)
                  }}
                >
                  {overview.loans.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.loan_no} ({currency}
                      {formatNumber(l.outstanding_principal)} out.)
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                <span className="block text-xs font-medium text-slate-600">P&amp;L from</span>
                <input type="date" className="mt-1 rounded border px-2 py-1.5" value={plStart} onChange={(e) => setPlStart(e.target.value)} />
              </label>
              <label className="text-sm">
                <span className="block text-xs font-medium text-slate-600">P&amp;L to</span>
                <input type="date" className="mt-1 rounded border px-2 py-1.5" value={plEnd} onChange={(e) => setPlEnd(e.target.value)} />
              </label>
              <label className="text-sm">
                <span className="block text-xs font-medium text-slate-600">Split method</span>
                <select className="mt-1 rounded border px-2 py-1.5" value={method} onChange={(e) => setMethod(e.target.value)}>
                  {overview.repayment_methods.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                <span className="block text-xs font-medium text-slate-600">Repayment total</span>
                <div className="mt-1 flex gap-1">
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    className="w-32 rounded border px-2 py-1.5"
                    value={repayTotal}
                    onChange={(e) => setRepayTotal(e.target.value)}
                  />
                  <button type="button" className="text-xs text-teal-700 underline whitespace-nowrap" onClick={useFullOutstanding}>
                    Full outstanding
                  </button>
                </div>
              </label>
              <button
                type="button"
                disabled={worksheetLoading}
                onClick={() => void buildWorksheet()}
                className="self-end rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-50 disabled:opacity-50"
              >
                {worksheetLoading ? 'Calculating…' : 'Calculate split'}
              </button>
            </div>

            {worksheet ? (
              <div className="space-y-3 border-t pt-4">
                <p className="text-sm text-slate-600">
                  Suggested total: {currency}
                  {formatNumber(worksheet.sum_suggested)} (outstanding {currency}
                  {formatNumber(worksheet.outstanding_principal)})
                </p>
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-slate-500">
                      <th className="py-1 pr-2">Use</th>
                      <th className="py-1 pr-2">Pond</th>
                      <th className="py-1 pr-2 text-right">Profit</th>
                      <th className="py-1 pr-2 text-right">Revenue</th>
                      <th className="py-1 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {worksheet.ponds.map((p, i) => (
                      <tr key={p.pond_id} className="border-b border-slate-100">
                        <td className="py-1 pr-2">
                          <input
                            type="checkbox"
                            checked={!!p.selected}
                            onChange={(e) => {
                              const next = [...worksheet.ponds]
                              next[i] = { ...next[i], selected: e.target.checked }
                              setWorksheet({ ...worksheet, ponds: next })
                            }}
                          />
                        </td>
                        <td className="py-1 pr-2">{p.pond_name}</td>
                        <td className="py-1 pr-2 text-right">{formatNumber(p.profit)}</td>
                        <td className="py-1 pr-2 text-right">{formatNumber(p.revenue)}</td>
                        <td className="py-1 text-right">
                          <input
                            type="number"
                            className="w-24 rounded border px-1 py-0.5 text-right"
                            value={p.suggested_amount}
                            onChange={(e) => {
                              const next = [...worksheet.ponds]
                              next[i] = { ...next[i], suggested_amount: e.target.value }
                              setWorksheet({ ...worksheet, ponds: next })
                            }}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="flex flex-wrap gap-3 items-end">
                  <label className="text-sm">
                    <span className="block text-xs font-medium">Transfer date</span>
                    <input type="date" className="mt-1 rounded border px-2 py-1.5" value={transferDate} onChange={(e) => setTransferDate(e.target.value)} />
                  </label>
                  <label className="text-sm min-w-[14rem]">
                    <span className="block text-xs font-medium">Debit (e.g. bank)</span>
                    <select
                      className="mt-1 w-full rounded border px-2 py-1.5"
                      value={debitAccountId === '' ? '' : String(debitAccountId)}
                      onChange={(e) => setDebitAccountId(e.target.value === '' ? '' : Number(e.target.value))}
                    >
                      <option value="">—</option>
                      {coa.map((a) => (
                        <option key={a.id} value={a.id}>
                          {formatCoaOptionLabel(a)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-sm min-w-[14rem]">
                    <span className="block text-xs font-medium">Credit (clearing / equity)</span>
                    <select
                      className="mt-1 w-full rounded border px-2 py-1.5"
                      value={creditAccountId === '' ? '' : String(creditAccountId)}
                      onChange={(e) => setCreditAccountId(e.target.value === '' ? '' : Number(e.target.value))}
                    >
                      <option value="">—</option>
                      {coa.map((a) => (
                        <option key={a.id} value={a.id}>
                          {formatCoaOptionLabel(a)}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={postTransfers} onChange={(e) => setPostTransfers(e.target.checked)} />
                  Post profit-transfer journals
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={alsoRepayLoan} onChange={(e) => setAlsoRepayLoan(e.target.checked)} />
                  Also post loan repayment (principal = sum of selected pond amounts)
                </label>
                <button
                  type="button"
                  disabled={applyLoading}
                  onClick={() => void applyWorksheet()}
                  className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-50"
                >
                  {applyLoading ? 'Applying…' : 'Apply worksheet'}
                </button>
              </div>
            ) : null}
          </section>

          {(overview.recent_disbursements.length > 0 || overview.recent_allocations.length > 0) && (
            <section className="grid gap-6 lg:grid-cols-2">
              {overview.recent_disbursements.length > 0 && (
                <div className="rounded-xl border bg-white p-4">
                  <h3 className="font-semibold text-slate-900">Recent disbursements</h3>
                  <ul className="mt-2 space-y-1 text-sm">
                    {overview.recent_disbursements.slice(0, 10).map((d) => (
                      <li key={d.id}>
                        {d.disbursement_date} · {d.loan_no} · {currency}
                        {formatNumber(d.amount)}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {overview.recent_allocations.length > 0 && (
                <div className="rounded-xl border bg-white p-4">
                  <h3 className="font-semibold text-slate-900">Recent pond allocations</h3>
                  <ul className="mt-2 space-y-1 text-sm">
                    {overview.recent_allocations.slice(0, 10).map((a) => (
                      <li key={a.id}>
                        {a.allocation_date} · {a.pond_name} · {a.allocation_kind} · {currency}
                        {formatNumber(a.amount)}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>
          )}
        </>
      ) : null}
    </div>
  )
}
