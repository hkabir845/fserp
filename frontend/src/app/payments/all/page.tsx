'use client'

import { CompanyDateInput } from '@/components/CompanyDateInput'

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import PageLayout from '@/components/PageLayout'
import { ErpPageShell } from '@/components/aquaculture/ErpPageShell'
import { usePageMeta } from '@/hooks/usePageMeta'
import api from '@/lib/api'
import { isOffsetPagedPayload, offsetListParams } from '@/lib/pagination'
import {
  hasTransactionTextSearch,
  transactionAmountParams,
  transactionDateParams,
} from '@/lib/transactionListFilters'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { OffsetPaginationControls } from '@/components/ui/OffsetPaginationControls'
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
import { DocumentExportButtons } from '@/components/DocumentExportButtons'
import EditPaymentModal from '../EditPaymentModal'
import { confirmDeletePaymentDialog, deletePaymentRequest } from '../paymentMutations'
import { escapeHtml } from '@/utils/printDocument'
import { printListView } from '@/utils/printListView'
import { formatDate } from '@/utils/date'
import {
  buildPaymentListCsv,
  downloadCsvFile,
  downloadJsonFile,
  type PaymentExport,
} from '@/utils/businessDocumentExport'

interface AllocationRow {
  invoice_id?: number | null
  bill_id?: number | null
  allocated_amount: number | string
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
  station_id?: number | null
  station_name?: string
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
  const pageMeta = usePageMeta()
  const [payments, setPayments] = useState<PaymentRow[]>([])
  const [loading, setLoading] = useState(true)
  const [listError, setListError] = useState('')
  const [currencySymbol, setCurrencySymbol] = useState('৳')

  const [typeFilter, setTypeFilter] = useState<'all' | 'received' | 'made'>('all')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [searchQ, setSearchQ] = useState('')
  const debouncedQ = useDebouncedValue(searchQ.trim(), 320)
  const [minAmount, setMinAmount] = useState('')
  const [maxAmount, setMaxAmount] = useState('')
  const [listPage, setListPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [totalCount, setTotalCount] = useState(0)

  const [expanded, setExpanded] = useState<Set<number>>(() => new Set())
  const [editPaymentId, setEditPaymentId] = useState<number | null>(null)
  const [policyBanner, setPolicyBanner] = useState<{
    title: string
    lines: string[]
  } | null>(null)

  useEffect(() => {
    setListPage(1)
  }, [typeFilter, debouncedQ, startDate, endDate, minAmount, maxAmount, pageSize])

  const hasTextSearch = hasTransactionTextSearch({ q: debouncedQ })

  const loadPayments = useCallback(async () => {
    const params = offsetListParams({
      page: listPage,
      pageSize,
      q: debouncedQ || undefined,
      extra: {
        type: typeFilter === 'all' ? undefined : typeFilter,
        ...transactionDateParams(startDate, endDate, hasTextSearch),
        ...transactionAmountParams(minAmount, maxAmount),
      },
    })
    const res = await api.get('/payments/', { params })
    const data = res.data
    if (isOffsetPagedPayload(data)) {
      setPayments(data.results as PaymentRow[])
      setTotalCount(data.count)
    } else if (Array.isArray(data)) {
      setPayments(data)
      setTotalCount(data.length)
    } else {
      setPayments([])
      setTotalCount(0)
    }
  }, [typeFilter, startDate, endDate, debouncedQ, minAmount, maxAmount, listPage, pageSize, hasTextSearch])

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
    setMinAmount('')
    setMaxAmount('')
    setSearchQ('')
  }

  const hasActiveFilters =
    typeFilter !== 'all' ||
    Boolean(startDate) ||
    Boolean(endDate) ||
    Boolean(minAmount) ||
    Boolean(maxAmount) ||
    Boolean(searchQ.trim())

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

  const partyLabelForPayment = (p: PaymentRow) => {
    if (p.payment_type === 'received') return p.customer_name || '—'
    return p.vendor_name || '—'
  }

  const handlePrintRegister = async () => {
    if (payments.length === 0) {
      window.alert('Nothing to print for the current filter.')
      return
    }
    const sub = [
      typeFilter !== 'all' ? `Type: ${typeFilter}` : '',
      startDate && `From ${startDate}`,
      endDate && `To ${endDate}`,
      debouncedQ && `Search: ${debouncedQ}`,
      `Generated ${formatDate(new Date(), true)}`,
    ]
      .filter(Boolean)
      .join(' · ')
    const rows = payments
      .map((p) => {
        const type = p.payment_type === 'received' ? 'Receipt' : 'Disbursement'
        return `<tr>
          <td>${escapeHtml(p.payment_number)}</td>
          <td>${escapeHtml(type)}</td>
          <td>${escapeHtml(formatDateOnly(p.payment_date))}</td>
          <td>${escapeHtml(partyLabelForPayment(p))}</td>
          <td>${escapeHtml((p.payment_method || 'unspecified').replace(/_/g, ' '))}</td>
          <td class="right">${escapeHtml(formatMoney(currencySymbol, parseAmount(p.amount)))}</td>
        </tr>`
      })
      .join('')
    const ok = await printListView({
      title: 'Payment register',
      subtitle: sub,
      tableHtml: `<table><thead><tr><th>Payment #</th><th>Type</th><th>Date</th><th>Party</th><th>Method</th><th class="right">Amount</th></tr></thead><tbody>${rows}</tbody></table>`,
    })
    if (!ok) window.alert('Printing was blocked. Allow pop-ups for this site.')
  }

  const handleDownloadRegisterCsv = () => {
    if (payments.length === 0) {
      window.alert('Nothing to export for the current filter.')
      return
    }
    let out = buildPaymentListCsv(payments as PaymentExport[], {
      formatDate: formatDateOnly,
      partyLabel: (p) => partyLabelForPayment(p as PaymentRow),
      typeLabel: 'Register',
    })
    out = `Type filter,${typeFilter}\n${out}`
    downloadCsvFile(`payment_register_${new Date().toISOString().slice(0, 10)}.csv`, out)
  }

  const handleDownloadRegisterJson = () => {
    if (payments.length === 0) {
      window.alert('Nothing to export for the current filter.')
      return
    }
    downloadJsonFile(`payment_register_${new Date().toISOString().slice(0, 10)}.json`, payments)
  }

  if (loading && payments.length === 0 && !listError) {
    return (
      <PageLayout>
        <div className="flex min-h-[50vh] items-center justify-center">
          <Loader2 className="h-10 w-10 animate-spin text-muted-foreground/70" aria-hidden />
        </div>
      </PageLayout>
    )
  }

  return (
    <PageLayout>
      <ErpPageShell
        showBackLink={false}
        title={pageMeta.title}
        titleIcon={Receipt}
        description={pageMeta.description}
        maxWidthClass="max-w-[1600px]"
        contentClassName="mt-4"
        actions={
          <DocumentExportButtons
            onPrint={() => void handlePrintRegister()}
            onDownloadCsv={handleDownloadRegisterCsv}
            onDownloadJson={handleDownloadRegisterJson}
            printLabel="Print register"
          />
        }
      >
          {listError && (
            <div className="mb-6 flex items-center gap-2 rounded-lg border border-destructive/25 bg-destructive/5 px-4 py-3 text-sm text-destructive">
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

          <div className="mb-6 rounded-xl border border-border bg-white p-5 shadow-sm">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground/85">
                <BookOpen className="h-6 w-6" aria-hidden />
              </div>
              <div className="min-w-0 flex-1 space-y-2 text-sm text-muted-foreground">
                <h2 className="text-base font-semibold text-foreground">Accounting context</h2>
                <p>
                  <strong className="font-medium text-foreground">Receipts</strong> reduce customer balances and
                  debit cash or clearing (e.g. undeposited funds until you use{' '}
                  <Link href="/payments/deposits" className="font-medium text-primary hover:underline">
                    Record deposits
                  </Link>
                  ). <strong className="font-medium text-foreground">Payments made</strong> reduce vendor balances
                  and credit the selected bank or clearing account. Detail lines below show invoice or bill
                  applications where recorded. Use the row actions to edit or delete: both run under{' '}
                  <strong className="font-medium text-foreground">database transactions</strong> so either the
                  rollback and re-post succeed together, or nothing changes. Receipts already moved via{' '}
                  <strong className="font-medium text-foreground">bank deposit</strong> stay locked until the
                  deposit is adjusted.
                </p>
              </div>
            </div>
          </div>

          <div className="mb-6 grid gap-4 sm:grid-cols-3">
            <div className="rounded-xl border border-border bg-white p-4 shadow-sm">
              <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <Receipt className="h-4 w-4 text-emerald-600" aria-hidden />
                AR — Received
              </div>
              <p className="mt-2 text-2xl font-bold tabular-nums text-foreground">
                {formatMoney(currencySymbol, stats.arSum)}
              </p>
              <p className="text-sm text-muted-foreground">{stats.arCount} transaction{stats.arCount === 1 ? '' : 's'}</p>
            </div>
            <div className="rounded-xl border border-border bg-white p-4 shadow-sm">
              <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <CreditCard className="h-4 w-4 text-primary" aria-hidden />
                AP — Made
              </div>
              <p className="mt-2 text-2xl font-bold tabular-nums text-foreground">
                {formatMoney(currencySymbol, stats.apSum)}
              </p>
              <p className="text-sm text-muted-foreground">{stats.apCount} transaction{stats.apCount === 1 ? '' : 's'}</p>
            </div>
            <div className="rounded-xl border border-border bg-white p-4 shadow-sm">
              <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <Landmark className="h-4 w-4 text-muted-foreground" aria-hidden />
                In view
              </div>
              <p className="mt-2 text-2xl font-bold tabular-nums text-foreground">{stats.total}</p>
              <p className="text-sm text-muted-foreground">Rows match current filters</p>
            </div>
          </div>

          <div className="mb-6 rounded-xl border border-border bg-white p-4 shadow-sm sm:p-5">
            <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <Filter className="h-4 w-4 text-muted-foreground" aria-hidden />
                Filters
              </div>
              {hasActiveFilters && (
                <button
                  type="button"
                  onClick={clearFilters}
                  className="inline-flex items-center gap-1 rounded-lg border border-border bg-white px-3 py-1.5 text-sm font-medium text-foreground/85 shadow-sm hover:bg-muted/40"
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
                        ? 'bg-foreground text-white shadow-sm'
                        : 'bg-muted text-foreground/85 hover:bg-muted'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="grid flex-1 grid-cols-1 gap-3 sm:grid-cols-2 lg:max-w-md">
                <div>
                  <label htmlFor="pay-all-start" className="mb-1 block text-xs font-medium text-muted-foreground">
                    From date
                  </label>
                  <CompanyDateInput value={startDate} onChange={setStartDate} className="w-full rounded-lg border border-border px-3 py-2 text-sm shadow-sm focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20" id="pay-all-start" />
                </div>
                <div>
                  <label htmlFor="pay-all-end" className="mb-1 block text-xs font-medium text-muted-foreground">
                    To date
                  </label>
                  <CompanyDateInput value={endDate} onChange={setEndDate} className="w-full rounded-lg border border-border px-3 py-2 text-sm shadow-sm focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20" id="pay-all-end" />
                </div>
                <div>
                  <label htmlFor="pay-all-min" className="mb-1 block text-xs font-medium text-muted-foreground">
                    Min amount
                  </label>
                  <input
                    id="pay-all-min"
                    type="number"
                    min="0"
                    step="0.01"
                    value={minAmount}
                    onChange={(e) => setMinAmount(e.target.value)}
                    className="w-full rounded-lg border border-border px-3 py-2 text-sm shadow-sm focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20"
                  />
                </div>
                <div>
                  <label htmlFor="pay-all-max" className="mb-1 block text-xs font-medium text-muted-foreground">
                    Max amount
                  </label>
                  <input
                    id="pay-all-max"
                    type="number"
                    min="0"
                    step="0.01"
                    value={maxAmount}
                    onChange={(e) => setMaxAmount(e.target.value)}
                    className="w-full rounded-lg border border-border px-3 py-2 text-sm shadow-sm focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20"
                  />
                </div>
              </div>
              <div className="min-w-[min(100%,20rem)] flex-1">
                <label htmlFor="pay-all-search" className="mb-1 block text-xs font-medium text-muted-foreground">
                  Search (all dates)
                </label>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/70" />
                  <input
                    id="pay-all-search"
                    type="search"
                    value={searchQ}
                    onChange={(e) => setSearchQ(e.target.value)}
                    placeholder="Reference, memo, party…"
                    className="w-full rounded-lg border border-border py-2 pl-9 pr-3 text-sm shadow-sm focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20"
                  />
                </div>
                {hasTextSearch && (startDate || endDate) ? (
                  <p className="mt-1 text-xs text-muted-foreground">Date range paused while searching.</p>
                ) : null}
              </div>
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border border-border bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-border text-sm">
                <thead className="bg-muted/40">
                  <tr>
                    <th className="w-10 px-3 py-3 text-left" aria-hidden />
                    <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      #
                    </th>
                    <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Date
                    </th>
                    <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Type
                    </th>
                    <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Party
                    </th>
                    <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Site
                    </th>
                    <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Bank / register
                    </th>
                    <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Method
                    </th>
                    <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Reference
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Amount
                    </th>
                    <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Cash status
                    </th>
                    <th className="px-3 py-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/70 bg-white">
                  {payments.map((payment) => {
                    const isReceived = payment.payment_type === 'received'
                    const isMade = payment.payment_type === 'made'
                    const amt = parseAmount(payment.amount)
                    const open = expanded.has(payment.id)
                    const allocs = payment.allocations ?? []
                    const canMutate = payment.can_delete === true
                    return (
                      <Fragment key={payment.id}>
                        <tr className="hover:bg-muted/50">
                          <td className="px-3 py-2.5">
                            <button
                              type="button"
                              onClick={() => toggleExpand(payment.id)}
                              className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
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
                          <td className="whitespace-nowrap px-3 py-2.5 font-medium text-foreground">
                            {payment.payment_number}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2.5 text-muted-foreground">
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
                              <span className="inline-flex rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-foreground/85">
                                {payment.payment_type}
                              </span>
                            )}
                          </td>
                          <td className="max-w-[10rem] truncate px-3 py-2.5 text-foreground" title={payment.customer_name || payment.vendor_name}>
                            {isReceived && (payment.customer_name || '—')}
                            {isMade && (payment.vendor_name || '—')}
                            {!isReceived && !isMade && '—'}
                          </td>
                          <td className="max-w-[8rem] truncate px-3 py-2.5 text-muted-foreground" title={payment.station_name || ''}>
                            {payment.station_name?.trim() || (isReceived || isMade ? '—' : '')}
                          </td>
                          <td className="max-w-[9rem] truncate px-3 py-2.5 text-muted-foreground" title={payment.bank_account_name ?? ''}>
                            {payment.bank_account_name || '—'}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2.5 capitalize text-muted-foreground">
                            {(payment.payment_method ?? 'unspecified').replace(/_/g, ' ')}
                          </td>
                          <td className="max-w-[8rem] truncate px-3 py-2.5 text-muted-foreground" title={payment.reference_number || payment.reference || ''}>
                            {payment.reference_number || payment.reference || '—'}
                          </td>
                          <td className="whitespace-nowrap px-4 py-2.5 text-right font-semibold tabular-nums text-foreground">
                            {formatMoney(currencySymbol, amt)}
                          </td>
                          <td className="px-4 py-2.5 text-center">
                            {isReceived && payment.deposit_status && (
                              <span
                                className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${
                                  payment.deposit_status === 'deposited'
                                    ? 'bg-emerald-100 text-emerald-900'
                                    : 'bg-amber-100 text-warning-foreground'
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
                                className="rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
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
                                className="rounded-lg p-2 text-muted-foreground hover:bg-destructive/5 hover:text-destructive disabled:cursor-not-allowed disabled:opacity-40"
                                aria-label={`Delete ${payment.payment_number}`}
                              >
                                <Trash2 className="h-4 w-4" aria-hidden />
                              </button>
                            </div>
                          </td>
                        </tr>
                        {open && (
                          <tr className="bg-muted/50">
                            <td colSpan={11} className="px-4 py-4 text-sm text-foreground/85">
                              <div className="ml-8 space-y-3">
                                {!canMutate && payment.immutable_reason ? (
                                  <p className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-warning-foreground">
                                    <span className="font-semibold">Locked: </span>
                                    {payment.immutable_reason}
                                  </p>
                                ) : null}
                                {(payment.memo || '').trim() ? (
                                  <div>
                                    <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                      Memo
                                    </span>
                                    <p className="mt-0.5 whitespace-pre-wrap text-foreground">{payment.memo}</p>
                                  </div>
                                ) : null}
                                <div>
                                  <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                    Applications
                                  </span>
                                  {allocs.length === 0 ? (
                                    <p className="mt-0.5 text-muted-foreground">Unallocated or no line detail on file.</p>
                                  ) : (
                                    <ul className="mt-1 list-inside list-disc space-y-0.5 text-foreground">
                                      {allocs.map((a, i) => (
                                        <li key={i}>
                                          {a.invoice_id != null && (
                                            <>
                                              Invoice #{a.invoice_id} —{' '}
                                              {formatMoney(currencySymbol, parseAmount(a.allocated_amount))}
                                            </>
                                          )}
                                          {a.bill_id != null && (
                                            <>
                                              Bill #{a.bill_id} —{' '}
                                              {formatMoney(currencySymbol, parseAmount(a.allocated_amount))}
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
                <Receipt className="mx-auto h-10 w-10 text-muted-foreground/40" aria-hidden />
                <p className="mt-3 font-medium text-foreground">No payments in this view</p>
                <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
                  Try adjusting filters, or record activity from{' '}
                  <Link href="/payments/received" className="font-medium text-primary hover:underline">
                    Payments received
                  </Link>{' '}
                  or{' '}
                  <Link href="/payments/made" className="font-medium text-primary hover:underline">
                    Payments made
                  </Link>
                  .
                </p>
              </div>
            )}
          </div>

          <div className="mt-4 rounded-lg border border-border bg-white px-4 py-3 shadow-sm">
            <OffsetPaginationControls
              page={listPage}
              pageSize={pageSize}
              total={totalCount}
              onPageChange={setListPage}
              onPageSizeChange={setPageSize}
              disabled={loading}
            />
          </div>

          {loading && payments.length > 0 && (
            <p className="mt-4 flex items-center justify-center gap-2 text-sm text-muted-foreground">
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
      </ErpPageShell>
    </PageLayout>
  )
}
