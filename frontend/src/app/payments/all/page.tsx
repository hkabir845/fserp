'use client'

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import Sidebar from '@/components/Sidebar'
import api from '@/lib/api'
import { getCurrencySymbol } from '@/utils/currency'
import { formatDateOnly } from '@/utils/date'
import {
  AlertCircle,
  ArrowLeft,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CreditCard,
  Filter,
  Landmark,
  Loader2,
  Pencil,
  Receipt,
  Search,
  Trash2,
  X,
} from 'lucide-react'
import EditPaymentModal from '../EditPaymentModal'
import { confirmDeletePaymentDialog, deletePaymentRequest } from '../paymentMutations'

interface AllocationRow {
  invoice_id?: number | null
  bill_id?: number | null
  allocated_amount: number
}

interface PaymentRow {
  id: number
  payment_type: 'received' | 'made' | string
  payment_number: string
  payment_date: string
  payment_method: string
  amount: string | number
  reference_number?: string | null
  reference?: string | null
  memo?: string | null
  customer_name?: string
  vendor_name?: string
  deposit_status?: string
  bank_account_id?: number | null
  bank_account_name?: string | null
  allocations?: AllocationRow[]
  can_edit?: boolean
  can_delete?: boolean
  immutable_reason?: string | null
}

function parseAmount(v: string | number | undefined | null): number {
  if (v === null || v === undefined || v === '') return 0
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : 0
}

function formatMoney(symbol: string, n: number): string {
  return `${symbol}${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export default function AllPaymentsPage() {
  const router = useRouter()
  const [payments, setPayments] = useState<PaymentRow[]>([])
  const [loading, setLoading] = useState(true)
  const [listError, setListError] = useState('')
  const [currencySymbol, setCurrencySymbol] = useState('৳')

  const [typeFilter, setTypeFilter] = useState<'all' | 'received' | 'made'>('all')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [searchQ, setSearchQ] = useState('')
  const [debouncedQ, setDebouncedQ] = useState('')

  const [expanded, setExpanded] = useState<Set<number>>(() => new Set())
  const [editPaymentId, setEditPaymentId] = useState<number | null>(null)
  const [policyBanner, setPolicyBanner] = useState<{
    title: string
    lines: string[]
  } | null>(null)

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedQ(searchQ.trim()), 320)
    return () => window.clearTimeout(t)
  }, [searchQ])

  const loadPayments = useCallback(async () => {
    const res = await api.get<PaymentRow[]>('/payments/', {
      params: {
        type: typeFilter === 'all' ? undefined : typeFilter,
        start_date: startDate || undefined,
        end_date: endDate || undefined,
        q: debouncedQ || undefined,
      },
    })
    const rows = Array.isArray(res.data) ? res.data : []
    setPayments(rows)
  }, [typeFilter, startDate, endDate, debouncedQ])

  useEffect(() => {
    const token = localStorage.getItem('access_token')
    if (!token) {
      router.push('/login')
      setLoading(false)
      return
    }
    ;(async () => {
      try {
        const companyRes = await api.get('/companies/current')
        if (companyRes.data?.currency) {
          setCurrencySymbol(getCurrencySymbol(companyRes.data.currency))
        }
      } catch {
        /* optional */
      }
    })()
  }, [router])

  useEffect(() => {
    const token = localStorage.getItem('access_token')
    if (!token) return
    let cancelled = false
    ;(async () => {
      setLoading(true)
      try {
        setListError('')
        await loadPayments()
      } catch (e) {
        console.error(e)
        if (!cancelled) {
          setListError('Could not load the payment register. Check your connection and try again.')
          setPayments([])
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [loadPayments])

  const stats = useMemo(() => {
    let arCount = 0
    let apCount = 0
    let arSum = 0
    let apSum = 0
    for (const p of payments) {
      const amt = parseAmount(p.amount)
      if (p.payment_type === 'received') {
        arCount += 1
        arSum += amt
      } else if (p.payment_type === 'made') {
        apCount += 1
        apSum += amt
      }
    }
    return { arCount, apCount, arSum, apSum, total: payments.length }
  }, [payments])

  const clearFilters = () => {
    setTypeFilter('all')
    setStartDate('')
    setEndDate('')
    setSearchQ('')
    setDebouncedQ('')
  }

  const hasActiveFilters =
    typeFilter !== 'all' || Boolean(startDate) || Boolean(endDate) || Boolean(searchQ.trim())

  const toggleExpand = (id: number) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleDeletePayment = async (payment: PaymentRow) => {
    if (!confirmDeletePaymentDialog(payment.payment_number)) return
    try {
      const banner = await deletePaymentRequest(payment.id)
      setPolicyBanner(banner)
      await loadPayments()
    } catch (err: unknown) {
      const ax = err as { response?: { data?: { detail?: string } } }
      const d = ax.response?.data?.detail
      window.alert(typeof d === 'string' ? d : 'Delete failed.')
    }
  }

  if (loading && payments.length === 0 && !listError) {
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
        <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
          <div className="mb-6">
            <Link
              href="/payments"
              className="mb-4 inline-flex items-center text-sm font-medium text-slate-600 transition hover:text-slate-900"
            >
              <ArrowLeft className="mr-1.5 h-4 w-4" aria-hidden />
              Back to Payments
            </Link>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h1 className="text-3xl font-bold tracking-tight text-slate-900">Payment register</h1>
                <p className="mt-1 max-w-2xl text-slate-600">
                  Single view of <strong className="font-medium text-slate-800">cash receipts</strong> (accounts
                  receivable) and <strong className="font-medium text-slate-800">cash disbursements</strong>{' '}
                  (accounts payable), consistent with a standard general-ledger cash book.
                </p>
              </div>
            </div>
          </div>

          {listError && (
            <div className="mb-6 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              <AlertCircle className="h-5 w-5 shrink-0" aria-hidden />
              {listError}
            </div>
          )}

          {policyBanner && (
            <div className="mb-6 flex items-start justify-between gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-emerald-900">
              <div className="flex gap-2">
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" aria-hidden />
                <div>
                  <p className="text-sm font-semibold">{policyBanner.title}</p>
                  <ul className="mt-1 list-inside list-disc text-sm text-emerald-800">
                    {policyBanner.lines.map((line, i) => (
                      <li key={i}>{line}</li>
                    ))}
                  </ul>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setPolicyBanner(null)}
                className="rounded p-1 text-emerald-700 hover:bg-emerald-100"
                aria-label="Dismiss"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}

          <div className="mb-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-700">
                <BookOpen className="h-6 w-6" aria-hidden />
              </div>
              <div className="min-w-0 flex-1 space-y-2 text-sm text-slate-600">
                <h2 className="text-base font-semibold text-slate-900">Accounting context</h2>
                <p>
                  <strong className="font-medium text-slate-800">Receipts</strong> reduce customer balances and
                  debit cash or clearing (e.g. undeposited funds until you use{' '}
                  <Link href="/payments/deposits" className="font-medium text-indigo-600 hover:underline">
                    Record deposits
                  </Link>
                  ). <strong className="font-medium text-slate-800">Payments made</strong> reduce vendor balances
                  and credit the selected bank or clearing account. Detail lines below show invoice or bill
                  applications where recorded. Use the row actions to edit or delete: both run under{' '}
                  <strong className="font-medium text-slate-800">database transactions</strong> so either the
                  rollback and re-post succeed together, or nothing changes. Receipts already moved via{' '}
                  <strong className="font-medium text-slate-800">bank deposit</strong> stay locked until the
                  deposit is adjusted.
                </p>
              </div>
            </div>
          </div>

          <div className="mb-6 grid gap-4 sm:grid-cols-3">
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-slate-500">
                <Receipt className="h-4 w-4 text-emerald-600" aria-hidden />
                AR — Received
              </div>
              <p className="mt-2 text-2xl font-bold tabular-nums text-slate-900">
                {formatMoney(currencySymbol, stats.arSum)}
              </p>
              <p className="text-sm text-slate-500">{stats.arCount} transaction{stats.arCount === 1 ? '' : 's'}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-slate-500">
                <CreditCard className="h-4 w-4 text-blue-600" aria-hidden />
                AP — Made
              </div>
              <p className="mt-2 text-2xl font-bold tabular-nums text-slate-900">
                {formatMoney(currencySymbol, stats.apSum)}
              </p>
              <p className="text-sm text-slate-500">{stats.apCount} transaction{stats.apCount === 1 ? '' : 's'}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-slate-500">
                <Landmark className="h-4 w-4 text-slate-500" aria-hidden />
                In view
              </div>
              <p className="mt-2 text-2xl font-bold tabular-nums text-slate-900">{stats.total}</p>
              <p className="text-sm text-slate-500">Rows match current filters</p>
            </div>
          </div>

          <div className="mb-6 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
            <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <Filter className="h-4 w-4 text-slate-500" aria-hidden />
                Filters
              </div>
              {hasActiveFilters && (
                <button
                  type="button"
                  onClick={clearFilters}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50"
                >
                  <X className="h-3.5 w-3.5" aria-hidden />
                  Clear filters
                </button>
              )}
            </div>

            <div className="flex flex-col gap-4 lg:flex-row lg:flex-wrap lg:items-end">
              <div className="flex flex-wrap gap-2">
                {(
                  [
                    ['all', 'All'],
                    ['received', 'AR — Received'],
                    ['made', 'AP — Made'],
                  ] as const
                ).map(([v, label]) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setTypeFilter(v)}
                    className={`rounded-lg px-3 py-2 text-sm font-medium transition ${
                      typeFilter === v
                        ? 'bg-slate-900 text-white shadow-sm'
                        : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="grid flex-1 grid-cols-1 gap-3 sm:grid-cols-2 lg:max-w-md">
                <div>
                  <label htmlFor="pay-all-start" className="mb-1 block text-xs font-medium text-slate-500">
                    From date
                  </label>
                  <input
                    id="pay-all-start"
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  />
                </div>
                <div>
                  <label htmlFor="pay-all-end" className="mb-1 block text-xs font-medium text-slate-500">
                    To date
                  </label>
                  <input
                    id="pay-all-end"
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  />
                </div>
              </div>
              <div className="min-w-[min(100%,20rem)] flex-1">
                <label htmlFor="pay-all-search" className="mb-1 block text-xs font-medium text-slate-500">
                  Search reference, memo, method
                </label>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    id="pay-all-search"
                    type="search"
                    value={searchQ}
                    onChange={(e) => setSearchQ(e.target.value)}
                    placeholder="Search…"
                    className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="w-10 px-3 py-3 text-left" aria-hidden />
                    <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                      #
                    </th>
                    <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                      Date
                    </th>
                    <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                      Type
                    </th>
                    <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                      Party
                    </th>
                    <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                      Bank / register
                    </th>
                    <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                      Method
                    </th>
                    <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                      Reference
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-slate-500">
                      Amount
                    </th>
                    <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wider text-slate-500">
                      Cash status
                    </th>
                    <th className="px-3 py-3 text-right text-xs font-semibold uppercase tracking-wider text-slate-500">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {payments.map((payment) => {
                    const isReceived = payment.payment_type === 'received'
                    const isMade = payment.payment_type === 'made'
                    const amt = parseAmount(payment.amount)
                    const open = expanded.has(payment.id)
                    const allocs = payment.allocations ?? []
                    const canMutate = payment.can_delete === true
                    return (
                      <Fragment key={payment.id}>
                        <tr className="hover:bg-slate-50/80">
                          <td className="px-3 py-2.5">
                            <button
                              type="button"
                              onClick={() => toggleExpand(payment.id)}
                              className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                              aria-expanded={open}
                              aria-label={open ? 'Collapse details' : 'Expand details'}
                            >
                              {open ? (
                                <ChevronDown className="h-4 w-4" aria-hidden />
                              ) : (
                                <ChevronRight className="h-4 w-4" aria-hidden />
                              )}
                            </button>
                          </td>
                          <td className="whitespace-nowrap px-3 py-2.5 font-medium text-slate-900">
                            {payment.payment_number}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2.5 text-slate-600">
                            {formatDateOnly(payment.payment_date)}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2.5">
                            {isReceived && (
                              <span className="inline-flex rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-900">
                                AR — Received
                              </span>
                            )}
                            {isMade && (
                              <span className="inline-flex rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-900">
                                AP — Made
                              </span>
                            )}
                            {!isReceived && !isMade && (
                              <span className="inline-flex rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-700">
                                {payment.payment_type}
                              </span>
                            )}
                          </td>
                          <td className="max-w-[10rem] truncate px-3 py-2.5 text-slate-800" title={payment.customer_name || payment.vendor_name}>
                            {isReceived && (payment.customer_name || '—')}
                            {isMade && (payment.vendor_name || '—')}
                            {!isReceived && !isMade && '—'}
                          </td>
                          <td className="max-w-[9rem] truncate px-3 py-2.5 text-slate-600" title={payment.bank_account_name ?? ''}>
                            {payment.bank_account_name || '—'}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2.5 capitalize text-slate-600">
                            {(payment.payment_method ?? 'unspecified').replace(/_/g, ' ')}
                          </td>
                          <td className="max-w-[8rem] truncate px-3 py-2.5 text-slate-600" title={payment.reference_number || payment.reference || ''}>
                            {payment.reference_number || payment.reference || '—'}
                          </td>
                          <td className="whitespace-nowrap px-4 py-2.5 text-right font-semibold tabular-nums text-slate-900">
                            {formatMoney(currencySymbol, amt)}
                          </td>
                          <td className="px-4 py-2.5 text-center">
                            {isReceived && payment.deposit_status && (
                              <span
                                className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${
                                  payment.deposit_status === 'deposited'
                                    ? 'bg-emerald-100 text-emerald-900'
                                    : 'bg-amber-100 text-amber-900'
                                }`}
                              >
                                {payment.deposit_status === 'deposited' ? 'At bank / deposited' : 'Undeposited'}
                              </span>
                            )}
                            {isMade && (
                              <span className="inline-flex rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-900">
                                Disbursed
                              </span>
                            )}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2.5 text-right">
                            <div className="flex items-center justify-end gap-1">
                              <button
                                type="button"
                                onClick={() => setEditPaymentId(payment.id)}
                                disabled={!canMutate}
                                title={
                                  canMutate
                                    ? 'Edit payment (reverses and reposts GL)'
                                    : payment.immutable_reason || 'Cannot edit this payment'
                                }
                                className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 hover:text-indigo-700 disabled:cursor-not-allowed disabled:opacity-40"
                                aria-label={`Edit ${payment.payment_number}`}
                              >
                                <Pencil className="h-4 w-4" aria-hidden />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeletePayment(payment)}
                                disabled={!canMutate}
                                title={
                                  canMutate
                                    ? 'Delete payment and roll back GL / subledgers'
                                    : payment.immutable_reason || 'Cannot delete this payment'
                                }
                                className="rounded-lg p-2 text-slate-600 hover:bg-red-50 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-40"
                                aria-label={`Delete ${payment.payment_number}`}
                              >
                                <Trash2 className="h-4 w-4" aria-hidden />
                              </button>
                            </div>
                          </td>
                        </tr>
                        {open && (
                          <tr className="bg-slate-50/90">
                            <td colSpan={11} className="px-4 py-4 text-sm text-slate-700">
                              <div className="ml-8 space-y-3">
                                {!canMutate && payment.immutable_reason ? (
                                  <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900">
                                    <span className="font-semibold">Locked: </span>
                                    {payment.immutable_reason}
                                  </p>
                                ) : null}
                                {(payment.memo || '').trim() ? (
                                  <div>
                                    <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                                      Memo
                                    </span>
                                    <p className="mt-0.5 whitespace-pre-wrap text-slate-800">{payment.memo}</p>
                                  </div>
                                ) : null}
                                <div>
                                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                                    Applications
                                  </span>
                                  {allocs.length === 0 ? (
                                    <p className="mt-0.5 text-slate-600">Unallocated or no line detail on file.</p>
                                  ) : (
                                    <ul className="mt-1 list-inside list-disc space-y-0.5 text-slate-800">
                                      {allocs.map((a, i) => (
                                        <li key={i}>
                                          {a.invoice_id != null && (
                                            <>
                                              Invoice #{a.invoice_id} —{' '}
                                              {formatMoney(currencySymbol, a.allocated_amount)}
                                            </>
                                          )}
                                          {a.bill_id != null && (
                                            <>
                                              Bill #{a.bill_id} — {formatMoney(currencySymbol, a.allocated_amount)}
                                            </>
                                          )}
                                        </li>
                                      ))}
                                    </ul>
                                  )}
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {payments.length === 0 && !loading && (
              <div className="px-6 py-14 text-center">
                <Receipt className="mx-auto h-10 w-10 text-slate-300" aria-hidden />
                <p className="mt-3 font-medium text-slate-900">No payments in this view</p>
                <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">
                  Try adjusting filters, or record activity from{' '}
                  <Link href="/payments/received" className="font-medium text-indigo-600 hover:underline">
                    Payments received
                  </Link>{' '}
                  or{' '}
                  <Link href="/payments/made" className="font-medium text-indigo-600 hover:underline">
                    Payments made
                  </Link>
                  .
                </p>
              </div>
            )}
          </div>

          {loading && payments.length > 0 && (
            <p className="mt-4 flex items-center justify-center gap-2 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              Updating…
            </p>
          )}

          <EditPaymentModal
            open={editPaymentId != null}
            paymentId={editPaymentId}
            onClose={() => setEditPaymentId(null)}
            onSaved={async (note) => {
              setPolicyBanner({
                title: 'Payment updated',
                lines: note ? [note] : ['General ledger reversed and reposted successfully.'],
              })
              await loadPayments()
            }}
          />
        </div>
      </div>
    </div>
  )
}
