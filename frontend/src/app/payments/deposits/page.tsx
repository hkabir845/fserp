'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import Sidebar from '@/components/Sidebar'
import api from '@/lib/api'
import { getCurrencySymbol } from '@/utils/currency'
import { formatDateOnly } from '@/utils/date'
import {
  AlertCircle,
  ArrowLeft,
  Banknote,
  Building2,
  CheckCircle2,
  Landmark,
  Loader2,
  Plus,
  X,
} from 'lucide-react'

interface UndepositedPayment {
  id: number
  payment_number: string
  payment_date: string
  payment_method: string
  amount: number
  reference_number: string | null
  customer_id: number
  customer_name?: string
  memo: string | null
}

interface BankAccount {
  id: number
  account_number: string
  account_name: string
  current_balance: number | string | null
}

function normalizeBankAccountsFromApi(data: unknown): BankAccount[] {
  let rows: unknown[] = []
  if (Array.isArray(data)) rows = data
  else if (data && typeof data === 'object') {
    const o = data as Record<string, unknown>
    if (Array.isArray(o.results)) rows = o.results
    else if (Array.isArray(o.data)) rows = o.data
  }
  return rows
    .filter((row): row is Record<string, unknown> => row != null && typeof row === 'object')
    .map((r) => {
      const id = typeof r.id === 'number' ? r.id : Number(r.id)
      if (!Number.isFinite(id)) return null
      const bal = r.current_balance
      return {
        id,
        account_number: String(r.account_number ?? ''),
        account_name: String(r.account_name ?? ''),
        current_balance: bal as BankAccount['current_balance'],
      } satisfies BankAccount
    })
    .filter((a): a is BankAccount => a != null)
}

function parseBalance(balance: number | string | null | undefined): number {
  if (balance === null || balance === undefined || balance === '') return 0
  const n = typeof balance === 'number' ? balance : Number(balance)
  return Number.isFinite(n) ? n : 0
}

interface Deposit {
  id: number
  deposit_number: string
  deposit_date: string
  total_amount: number
  bank_account_id: number
  bank_account_name?: string
  is_reconciled: boolean
  payment_count: number
  memo?: string
}

function formatMoney(symbol: string, n: number): string {
  return `${symbol}${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export default function DepositsPage() {
  const router = useRouter()
  const [bootLoading, setBootLoading] = useState(true)
  const [undepositedPayments, setUndepositedPayments] = useState<UndepositedPayment[]>([])
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([])
  const [deposits, setDeposits] = useState<Deposit[]>([])
  const [totalUndeposited, setTotalUndeposited] = useState(0)
  const [showDepositForm, setShowDepositForm] = useState(false)
  const [selectedPaymentIds, setSelectedPaymentIds] = useState<number[]>([])
  const [selectedBankAccountId, setSelectedBankAccountId] = useState<number | null>(null)
  const [depositDate, setDepositDate] = useState(() => new Date().toISOString().split('T')[0])
  const [depositMemo, setDepositMemo] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [listError, setListError] = useState('')
  const [currencySymbol, setCurrencySymbol] = useState('৳')
  const [successMessage, setSuccessMessage] = useState('')

  const loadUndeposited = useCallback(async () => {
    const res = await api.get<{ payments?: UndepositedPayment[]; total_amount?: number }>(
      '/payments/undeposited-funds/'
    )
    setUndepositedPayments(res.data.payments ?? [])
    setTotalUndeposited(res.data.total_amount ?? 0)
  }, [])

  const loadDeposits = useCallback(async () => {
    const res = await api.get<Deposit[]>('/payments/deposits/')
    const rows = Array.isArray(res.data) ? res.data : []
    setDeposits(rows)
  }, [])

  const loadBanks = useCallback(async () => {
    const res = await api.get('/bank-accounts/')
    setBankAccounts(normalizeBankAccountsFromApi(res.data))
  }, [])

  useEffect(() => {
    const token = localStorage.getItem('access_token')
    if (!token) {
      router.push('/login')
      setBootLoading(false)
      return
    }
    ;(async () => {
      try {
        try {
          const companyRes = await api.get('/companies/current')
          if (companyRes.data?.currency) {
            setCurrencySymbol(getCurrencySymbol(companyRes.data.currency))
          }
        } catch {
          /* optional */
        }
        setListError('')
        await Promise.all([loadUndeposited(), loadBanks(), loadDeposits()])
      } catch (e) {
        console.error(e)
        setListError('Could not load deposit data. Check your connection and try again.')
        setUndepositedPayments([])
        setDeposits([])
        setBankAccounts([])
      } finally {
        setBootLoading(false)
      }
    })()
  }, [router, loadUndeposited, loadBanks, loadDeposits])

  const handleOpenNewDeposit = () => {
    setError('')
    setSuccessMessage('')
    setShowDepositForm(true)
    setSelectedPaymentIds([])
    setSelectedBankAccountId(null)
    setDepositDate(new Date().toISOString().split('T')[0])
    setDepositMemo('')
  }

  const handleCancelDeposit = () => {
    setShowDepositForm(false)
    setError('')
    setSelectedPaymentIds([])
    setSelectedBankAccountId(null)
    setDepositMemo('')
  }

  const handlePaymentToggle = (paymentId: number) => {
    setSelectedPaymentIds((prev) =>
      prev.includes(paymentId) ? prev.filter((id) => id !== paymentId) : [...prev, paymentId]
    )
  }

  const handleSelectAll = () => {
    if (selectedPaymentIds.length === undepositedPayments.length) {
      setSelectedPaymentIds([])
    } else {
      setSelectedPaymentIds(undepositedPayments.map((p) => p.id))
    }
  }

  const selectedTotal = useMemo(
    () =>
      selectedPaymentIds.reduce((sum, id) => {
        const payment = undepositedPayments.find((p) => p.id === id)
        return sum + (payment?.amount ?? 0)
      }, 0),
    [selectedPaymentIds, undepositedPayments]
  )

  const handleCreateDeposit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setSuccessMessage('')
    setSubmitting(true)

    if (selectedPaymentIds.length === 0) {
      setError('Select at least one receipt to include in this deposit.')
      setSubmitting(false)
      return
    }
    if (!selectedBankAccountId) {
      setError('Choose the bank account you are depositing into.')
      setSubmitting(false)
      return
    }

    try {
      const res = await api.post<Deposit>('/payments/deposits/', {
        deposit_date: depositDate,
        bank_account_id: selectedBankAccountId,
        payment_ids: selectedPaymentIds,
        memo: depositMemo.trim() || null,
      })
      setSuccessMessage(
        `Deposit ${res.data.deposit_number ?? `#${res.data.id}`} recorded for ${formatMoney(currencySymbol, res.data.total_amount)}.`
      )
      handleCancelDeposit()
      await Promise.all([loadUndeposited(), loadDeposits(), loadBanks()])
    } catch (err: unknown) {
      const ax = err as { response?: { data?: { detail?: string } } }
      const msg = ax.response?.data?.detail
      setError(typeof msg === 'string' ? msg : 'Could not create this deposit. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  if (bootLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <Loader2 className="h-10 w-10 animate-spin text-slate-400" aria-hidden />
      </div>
    )
  }

  return (
    <div className="flex h-screen bg-slate-50 page-with-sidebar">
      <Sidebar />
      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
          <div className="mb-6">
            <Link
              href="/payments"
              className="mb-4 inline-flex items-center text-sm font-medium text-slate-600 transition hover:text-slate-900"
            >
              <ArrowLeft className="mr-1.5 h-4 w-4" aria-hidden />
              Back to Payments
            </Link>

            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h1 className="text-3xl font-bold tracking-tight text-slate-900">Record deposits</h1>
                <p className="mt-1 max-w-2xl text-slate-600">
                  Move customer receipts from clearing accounts (cash on hand, undeposited funds, or
                  card clearing) into a bank register — the standard AR cash workflow used in
                  professional accounting systems.
                </p>
              </div>
              {undepositedPayments.length > 0 && !showDepositForm && (
                <button
                  type="button"
                  onClick={handleOpenNewDeposit}
                  className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
                >
                  <Plus className="h-5 w-5" aria-hidden />
                  New deposit
                </button>
              )}
            </div>
          </div>

          {successMessage && (
            <div className="mb-6 flex items-start justify-between gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-emerald-900">
              <div className="flex gap-2">
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" aria-hidden />
                <p className="text-sm font-medium">{successMessage}</p>
              </div>
              <button
                type="button"
                onClick={() => setSuccessMessage('')}
                className="rounded p-1 text-emerald-700 hover:bg-emerald-100"
                aria-label="Dismiss"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}

          {listError && (
            <div className="mb-6 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-red-800">
              <AlertCircle className="h-5 w-5 shrink-0" aria-hidden />
              <p className="text-sm">{listError}</p>
            </div>
          )}

          {/* Accounting context — matches COA 1010 / 1020 / 1120 → bank */}
          <div className="mb-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-700">
                <Landmark className="h-6 w-6" aria-hidden />
              </div>
              <div className="min-w-0 flex-1 space-y-2 text-sm text-slate-600">
                <h2 className="text-base font-semibold text-slate-900">How this fits your books</h2>
                <p>
                  When you record a <strong className="font-medium text-slate-800">payment received</strong>{' '}
                  without choosing a bank register, the system posts to your{' '}
                  <strong className="font-medium text-slate-800">clearing</strong> asset (e.g. cash on hand,
                  undeposited funds, or card clearing — per your chart of accounts). This screen creates a
                  single <strong className="font-medium text-slate-800">bank deposit</strong>: debit the
                  selected bank account, credit those clearing accounts, and mark the included receipts as
                  deposited.
                </p>
                <p className="text-xs text-slate-500">
                  Receipts recorded directly to a bank register do not appear here; they are already at the
                  bank on the books.
                </p>
              </div>
            </div>
          </div>

          <div className="mb-6 grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-50 text-amber-700">
                  <Banknote className="h-5 w-5" aria-hidden />
                </div>
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                    Undeposited receipts
                  </p>
                  <p className="text-2xl font-bold tabular-nums text-slate-900">
                    {formatMoney(currencySymbol, totalUndeposited)}
                  </p>
                  <p className="text-sm text-slate-500">
                    {undepositedPayments.length} item{undepositedPayments.length === 1 ? '' : 's'} awaiting
                    deposit
                  </p>
                </div>
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100 text-slate-700">
                  <Building2 className="h-5 w-5" aria-hidden />
                </div>
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Status</p>
                  {undepositedPayments.length > 0 ? (
                    <p className="text-sm font-medium text-amber-800">Deposit queue has open items</p>
                  ) : (
                    <p className="text-sm font-medium text-emerald-800">No undeposited receipts</p>
                  )}
                  <p className="text-sm text-slate-500">Reconcile the bank register after the real deposit clears.</p>
                </div>
              </div>
            </div>
          </div>

          {showDepositForm && (
            <div className="mb-8 rounded-xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-100 px-5 py-4 sm:px-6">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <h2 className="text-lg font-semibold text-slate-900">New bank deposit</h2>
                  <button
                    type="button"
                    onClick={handleCancelDeposit}
                    className="inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50"
                  >
                    Cancel
                  </button>
                </div>
              </div>

              <form onSubmit={handleCreateDeposit} className="space-y-6 px-5 py-5 sm:px-6" autoComplete="off">
                {error && (
                  <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                    {error}
                  </div>
                )}

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="sm:col-span-1">
                    <label htmlFor="deposit-bank" className="mb-1 block text-sm font-medium text-slate-700">
                      Deposit to (bank register) <span className="text-red-600">*</span>
                    </label>
                    <select
                      id="deposit-bank"
                      name="bank_account_id"
                      value={selectedBankAccountId != null ? String(selectedBankAccountId) : ''}
                      onChange={(e) => {
                        const n = Number(e.target.value)
                        setSelectedBankAccountId(Number.isFinite(n) ? n : null)
                      }}
                      className="relative z-10 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                      required
                    >
                      <option value="">Select bank account</option>
                      {bankAccounts.map((account) => (
                        <option key={account.id} value={String(account.id)}>
                          {account.account_name} — {formatMoney(currencySymbol, parseBalance(account.current_balance))}
                        </option>
                      ))}
                    </select>
                    <p className="mt-1 text-xs text-slate-500">
                      Must be linked to a chart account; register balance updates after posting.
                    </p>
                  </div>
                  <div>
                    <label htmlFor="deposit-date" className="mb-1 block text-sm font-medium text-slate-700">
                      Deposit date <span className="text-red-600">*</span>
                    </label>
                    <input
                      id="deposit-date"
                      name="deposit_date"
                      type="date"
                      value={depositDate}
                      onChange={(e) => setDepositDate(e.target.value)}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                      required
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label htmlFor="deposit-memo" className="mb-1 block text-sm font-medium text-slate-700">
                      Memo / bank reference
                    </label>
                    <input
                      id="deposit-memo"
                      name="memo"
                      type="text"
                      value={depositMemo}
                      onChange={(e) => setDepositMemo(e.target.value)}
                      placeholder="e.g. Daily deposit, branch / bag number"
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                    />
                  </div>
                </div>

                <div>
                  <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <h3 className="text-sm font-semibold text-slate-900">Include in this deposit</h3>
                    <button
                      type="button"
                      onClick={handleSelectAll}
                      className="text-sm font-medium text-indigo-600 hover:text-indigo-800"
                    >
                      {selectedPaymentIds.length === undepositedPayments.length && undepositedPayments.length > 0
                        ? 'Deselect all'
                        : 'Select all'}
                    </button>
                  </div>

                  <div className="overflow-hidden rounded-lg border border-slate-200">
                    <div className="overflow-x-auto">
                      <table className="min-w-full divide-y divide-slate-200 text-sm">
                        <thead className="bg-slate-50">
                          <tr>
                            <th className="w-10 px-3 py-3 text-left">
                              <input
                                type="checkbox"
                                checked={
                                  selectedPaymentIds.length === undepositedPayments.length &&
                                  undepositedPayments.length > 0
                                }
                                onChange={handleSelectAll}
                                className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                                aria-label="Select all payments"
                              />
                            </th>
                            <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                              Receipt
                            </th>
                            <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                              Customer
                            </th>
                            <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                              Date
                            </th>
                            <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                              Method
                            </th>
                            <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                              Reference
                            </th>
                            <th className="px-3 py-3 text-right text-xs font-semibold uppercase tracking-wider text-slate-500">
                              Amount
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 bg-white">
                          {undepositedPayments.map((payment) => {
                            const sel = selectedPaymentIds.includes(payment.id)
                            return (
                              <tr
                                key={payment.id}
                                className={sel ? 'bg-indigo-50/60' : 'hover:bg-slate-50/80'}
                              >
                                <td className="px-3 py-2.5">
                                  <input
                                    type="checkbox"
                                    checked={sel}
                                    onChange={() => handlePaymentToggle(payment.id)}
                                    className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                                    aria-label={`Include ${payment.payment_number}`}
                                  />
                                </td>
                                <td className="px-3 py-2.5 font-medium text-slate-900">
                                  {payment.payment_number}
                                </td>
                                <td className="max-w-[10rem] truncate px-3 py-2.5 text-slate-700" title={payment.customer_name}>
                                  {payment.customer_name || '—'}
                                </td>
                                <td className="whitespace-nowrap px-3 py-2.5 text-slate-600">
                                  {formatDateOnly(payment.payment_date)}
                                </td>
                                <td className="px-3 py-2.5 capitalize text-slate-600">
                                  {(payment.payment_method ?? 'unspecified').replace(/_/g, ' ')}
                                </td>
                                <td className="max-w-[8rem] truncate px-3 py-2.5 text-slate-600" title={payment.reference_number ?? ''}>
                                  {payment.reference_number || '—'}
                                </td>
                                <td className="px-3 py-2.5 text-right font-medium tabular-nums text-slate-900">
                                  {formatMoney(currencySymbol, payment.amount)}
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                        <tfoot className="bg-slate-50">
                          <tr>
                            <td colSpan={6} className="px-3 py-3 text-right text-sm font-semibold text-slate-700">
                              Selected total
                            </td>
                            <td className="px-3 py-3 text-right text-sm font-bold tabular-nums text-indigo-700">
                              {formatMoney(currencySymbol, selectedTotal)}
                            </td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </div>
                </div>

                <div className="flex flex-col-reverse gap-3 border-t border-slate-100 pt-5 sm:flex-row sm:justify-end">
                  <button
                    type="button"
                    onClick={handleCancelDeposit}
                    className="inline-flex justify-center rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submitting || selectedPaymentIds.length === 0}
                    className="inline-flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 disabled:pointer-events-none disabled:opacity-50"
                  >
                    {submitting ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                        Posting…
                      </>
                    ) : (
                      'Record deposit'
                    )}
                  </button>
                </div>
              </form>
            </div>
          )}

          {!showDepositForm && undepositedPayments.length > 0 && (
            <div className="mb-8 rounded-xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-100 px-5 py-4 sm:px-6">
                <h2 className="text-lg font-semibold text-slate-900">Queue — undeposited receipts</h2>
                <p className="mt-0.5 text-sm text-slate-500">
                  These payments are still in clearing until you record a deposit to a bank register.
                </p>
              </div>
              <div className="overflow-x-auto px-0 pb-4">
                <table className="min-w-full divide-y divide-slate-200 text-sm">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                        Receipt
                      </th>
                      <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                        Customer
                      </th>
                      <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                        Date
                      </th>
                      <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                        Method
                      </th>
                      <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                        Reference
                      </th>
                      <th className="px-5 py-3 text-right text-xs font-semibold uppercase tracking-wider text-slate-500">
                        Amount
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {undepositedPayments.map((payment) => (
                      <tr key={payment.id} className="hover:bg-slate-50/80">
                        <td className="whitespace-nowrap px-5 py-2.5 font-medium text-slate-900">
                          {payment.payment_number}
                        </td>
                        <td className="max-w-[12rem] truncate px-3 py-2.5 text-slate-700" title={payment.customer_name}>
                          {payment.customer_name || '—'}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-slate-600">
                          {formatDateOnly(payment.payment_date)}
                        </td>
                        <td className="px-3 py-2.5 capitalize text-slate-600">
                          {(payment.payment_method ?? 'unspecified').replace(/_/g, ' ')}
                        </td>
                        <td className="max-w-[10rem] truncate px-3 py-2.5 text-slate-600">
                          {payment.reference_number || '—'}
                        </td>
                        <td className="whitespace-nowrap px-5 py-2.5 text-right font-medium tabular-nums text-slate-900">
                          {formatMoney(currencySymbol, payment.amount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {!showDepositForm && undepositedPayments.length === 0 && !listError && (
            <div className="mb-8 rounded-xl border border-dashed border-slate-200 bg-white px-6 py-12 text-center shadow-sm">
              <Banknote className="mx-auto h-10 w-10 text-slate-300" aria-hidden />
              <p className="mt-3 font-medium text-slate-900">Nothing to deposit</p>
              <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">
                Undeposited receipts appear here when you record payments received without selecting a bank
                register. You can also use <Link href="/payments/received" className="font-medium text-indigo-600 hover:underline">Payments received</Link> to enter new receipts.
              </p>
            </div>
          )}

          <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-5 py-4 sm:px-6">
              <h2 className="text-lg font-semibold text-slate-900">Recent bank deposits</h2>
              <p className="mt-0.5 text-sm text-slate-500">
                Batch deposits posted from this screen (GL reference AUTO-DEP-…).
              </p>
            </div>
            {deposits.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200 text-sm">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                        Deposit #
                      </th>
                      <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                        Date
                      </th>
                      <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                        Bank register
                      </th>
                      <th className="px-3 py-3 text-right text-xs font-semibold uppercase tracking-wider text-slate-500">
                        Amount
                      </th>
                      <th className="px-3 py-3 text-right text-xs font-semibold uppercase tracking-wider text-slate-500">
                        Receipts
                      </th>
                      <th className="px-5 py-3 text-center text-xs font-semibold uppercase tracking-wider text-slate-500">
                        Reconciliation
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {deposits.map((deposit) => (
                      <tr key={deposit.id} className="hover:bg-slate-50/80">
                        <td className="whitespace-nowrap px-5 py-2.5 font-medium text-slate-900">
                          {deposit.deposit_number}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-slate-600">
                          {formatDateOnly(deposit.deposit_date)}
                        </td>
                        <td className="px-3 py-2.5 text-slate-700">
                          {deposit.bank_account_name || `Register #${deposit.bank_account_id}`}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-right font-medium tabular-nums text-slate-900">
                          {formatMoney(currencySymbol, deposit.total_amount)}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-slate-600">
                          {deposit.payment_count}
                        </td>
                        <td className="px-5 py-2.5 text-center">
                          {deposit.is_reconciled ? (
                            <span className="inline-flex rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-800">
                              Reconciled
                            </span>
                          ) : (
                            <span className="inline-flex rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-700">
                              Open
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="px-5 py-10 text-center text-sm text-slate-500">No deposits recorded yet.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
