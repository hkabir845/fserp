'use client'

import { CompanyDateInput } from '@/components/CompanyDateInput'

import { useCallback, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import PageLayout from '@/components/PageLayout'
import { ErpPageShell } from '@/components/aquaculture/ErpPageShell'
import { usePageMeta } from '@/hooks/usePageMeta'
import {
  ArrowLeft,
  CheckCircle2,
  DollarSign,
  Filter,
  Pencil,
  Plus,
  Trash2,
  X,
} from 'lucide-react'
import { DocumentExportButtons } from '@/components/DocumentExportButtons'
import api from '@/lib/api'
import { isOffsetPagedPayload, offsetListParams, REFERENCE_FETCH_LIMIT } from '@/lib/pagination'
import {
  hasTransactionTextSearch,
  transactionAmountParams,
  transactionDateParams,
} from '@/lib/transactionListFilters'
import { OffsetPaginationControls } from '@/components/ui/OffsetPaginationControls'
import EditPaymentModal from '../EditPaymentModal'
import { confirmDeletePaymentDialog, deletePaymentRequest } from '../paymentMutations'
import { getCurrencySymbol, formatNumber } from '@/utils/currency'
import { formatDate, formatDateOnly } from '@/utils/date'
import { escapeHtml } from '@/utils/printDocument'
import { printListView } from '@/utils/printListView'
import {
  buildPaymentListCsv,
  downloadCsvFile,
  downloadJsonFile,
} from '@/utils/businessDocumentExport'
import { ContactArApBalances } from '@/components/ContactArApBalances'

interface OutstandingInvoice {
  id: number
  invoice_number: string
  invoice_date: string
  due_date: string | null
  customer_id: number
  customer_name: string
  total_amount?: number | string
  total?: number | string
  amount_paid?: number | string
  balance_due: number | string
  days_overdue: number | null
  synthetic?: boolean
  on_account?: boolean
}

interface CustomerPayment {
  id: number
  payment_number: string
  payment_date: string
  payment_method: string
  amount: number
  reference_number: string | null
  reference?: string | null
  customer_id: number
  deposit_status: string
  deposit_id: number | null
  can_edit?: boolean
  can_delete?: boolean
  immutable_reason?: string | null
  memo: string | null
  allocations: Array<{
    id: number
    invoice_id: number | null
    allocated_amount: number
    discount_amount: number
  }>
  created_at: string
  updated_at: string
}

interface Customer {
  id: number
  customer_number: string
  display_name: string
  opening_balance?: string
  opening_balance_date?: string | null
  current_balance?: string
}

type PaymentFilter = 'all' | 'received' | 'outstanding'

export default function PaymentReceivedPage() {
  const router = useRouter()
  const pageMeta = usePageMeta()
  const searchParams = useSearchParams()
  const [loading, setLoading] = useState(true)
  const [customers, setCustomers] = useState<Customer[]>([])
  const [allOutstandingInvoices, setAllOutstandingInvoices] = useState<OutstandingInvoice[]>([])
  const [paymentsReceived, setPaymentsReceived] = useState<CustomerPayment[]>([])
  const [currencySymbol, setCurrencySymbol] = useState<string>('৳')

  const [filterStatus, setFilterStatus] = useState<PaymentFilter>('all')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [searchQ, setSearchQ] = useState('')
  const [debouncedQ, setDebouncedQ] = useState('')
  const [minAmount, setMinAmount] = useState('')
  const [maxAmount, setMaxAmount] = useState('')
  const [listPage, setListPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [totalCount, setTotalCount] = useState(0)
  const [editPaymentId, setEditPaymentId] = useState<number | null>(null)
  const [policyBanner, setPolicyBanner] = useState<{ title: string; lines: string[] } | null>(null)

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(searchQ.trim()), 350)
    return () => clearTimeout(t)
  }, [searchQ])

  useEffect(() => {
    setListPage(1)
  }, [debouncedQ, startDate, endDate, minAmount, maxAmount, pageSize])

  const hasTextSearch = hasTransactionTextSearch({ q: debouncedQ })

  const fetchPaymentsReceived = useCallback(async () => {
    try {
      const params = offsetListParams({
        page: listPage,
        pageSize,
        q: debouncedQ || undefined,
        extra: {
          ...transactionDateParams(startDate, endDate, hasTextSearch),
          ...transactionAmountParams(minAmount, maxAmount),
        },
      })
      const response = await api.get('/payments/received/', { params })
      const data = response.data
      if (isOffsetPagedPayload(data)) {
        setPaymentsReceived(data.results as CustomerPayment[])
        setTotalCount(data.count)
      } else if (Array.isArray(data)) {
        setPaymentsReceived(data)
        setTotalCount(data.length)
      } else {
        setPaymentsReceived([])
        setTotalCount(0)
      }
    } catch (error: unknown) {
      console.error('Error fetching payments received:', error)
      setPaymentsReceived([])
      setTotalCount(0)
    }
  }, [listPage, pageSize, debouncedQ, startDate, endDate, minAmount, maxAmount, hasTextSearch])

  const fetchCustomers = async () => {
    try {
      try {
        const companyRes = await api.get('/companies/current')
        if (companyRes.data?.currency) {
          setCurrencySymbol(getCurrencySymbol(companyRes.data.currency))
        }
      } catch (error) {
        console.error('Error fetching company currency:', error)
      }

      const response = await api.get('/customers/', {
        params: { skip: 0, limit: REFERENCE_FETCH_LIMIT },
      })
      setCustomers(response.data)
    } catch (error) {
      console.error('Error fetching customers:', error)
    } finally {
      setLoading(false)
    }
  }

  const fetchAllOutstandingInvoices = async () => {
    try {
      const response = await api.get(`/payments/received/outstanding`)
      setAllOutstandingInvoices(response.data || [])
    } catch (error: unknown) {
      console.error('Error fetching all outstanding invoices:', error)
      setAllOutstandingInvoices([])
    }
  }

  useEffect(() => {
    const token = localStorage.getItem('access_token')
    if (!token) {
      router.push('/login')
      return
    }
    void fetchCustomers()
  }, [router])

  useEffect(() => {
    void fetchPaymentsReceived()
    void fetchAllOutstandingInvoices()
  }, [fetchPaymentsReceived])

  useEffect(() => {
    const raw = searchParams.get('edit')
    if (!raw || !/^\d+$/.test(raw)) return
    const id = parseInt(raw, 10)
    if (Number.isFinite(id) && id > 0) setEditPaymentId(id)
  }, [searchParams])

  const totalReceivable = allOutstandingInvoices.reduce(
    (sum, invoice) => sum + (Number(invoice.balance_due) || 0),
    0
  )

  const getDisplayedData = () => {
    if (filterStatus === 'received') {
      return { payments: paymentsReceived, invoices: [] as OutstandingInvoice[] }
    }
    if (filterStatus === 'outstanding') {
      return { payments: [] as CustomerPayment[], invoices: allOutstandingInvoices }
    }
    return { payments: paymentsReceived, invoices: allOutstandingInvoices }
  }

  const displayedData = getDisplayedData()

  const handlePrintList = async () => {
    const { payments, invoices } = displayedData
    const sub = [
      `View: ${filterStatus}`,
      startDate && `From ${startDate}`,
      endDate && `To ${endDate}`,
      `Generated ${formatDate(new Date(), true)}`,
    ]
      .filter(Boolean)
      .join(' · ')
    const parts: string[] = []
    if (payments.length) {
      const rows = payments
        .map((p) => {
          const cust = customers.find((c) => c.id === p.customer_id)
          const customerName = cust?.display_name || (p.customer_id ? `Customer #${p.customer_id}` : '—')
          return `<tr>
            <td>${escapeHtml(String(p.payment_number ?? `PAY-${p.id}`))}</td>
            <td>${escapeHtml(formatDateOnly(p.payment_date))}</td>
            <td>${escapeHtml(customerName)}</td>
            <td>${escapeHtml((p.payment_method ?? 'unspecified').replace(/_/g, ' '))}</td>
            <td class="right">${escapeHtml(currencySymbol)}${escapeHtml(formatNumber(Number(p.amount) || 0))}</td>
          </tr>`
        })
        .join('')
      parts.push(
        `<h2>Payments received</h2><table><thead><tr><th>Payment #</th><th>Date</th><th>Customer</th><th>Method</th><th class="right">Amount</th></tr></thead><tbody>${rows}</tbody></table>`
      )
    }
    if (invoices.length) {
      const rows = invoices
        .map((inv) => {
          const total = Number(inv.total_amount ?? inv.total ?? 0) || 0
          const paid = Number(inv.amount_paid ?? 0) || 0
          const bal = Number(inv.balance_due) || 0
          return `<tr>
            <td>${escapeHtml(inv.invoice_number)}</td>
            <td>${escapeHtml(formatDateOnly(inv.invoice_date))}</td>
            <td>${escapeHtml(inv.due_date ? formatDateOnly(inv.due_date) : '—')}</td>
            <td>${escapeHtml(inv.customer_name || '—')}</td>
            <td class="right">${escapeHtml(currencySymbol)}${escapeHtml(formatNumber(total))}</td>
            <td class="right">${escapeHtml(currencySymbol)}${escapeHtml(formatNumber(paid))}</td>
            <td class="right">${escapeHtml(currencySymbol)}${escapeHtml(formatNumber(bal))}</td>
          </tr>`
        })
        .join('')
      parts.push(
        `<h2>Outstanding invoices</h2><table><thead><tr><th>Invoice #</th><th>Date</th><th>Due</th><th>Customer</th><th class="right">Total</th><th class="right">Paid</th><th class="right">Balance</th></tr></thead><tbody>${rows}</tbody></table>`
      )
    }
    if (parts.length === 0) {
      window.alert('Nothing to print for the current filter.')
      return
    }
    const ok = await printListView({
      title: 'Payments — received (list)',
      subtitle: sub,
      tableHtml: parts.join(''),
    })
    if (!ok) window.alert('Printing was blocked. Allow pop-ups for this site.')
  }

  const handleDownloadListCsv = () => {
    const { payments } = displayedData
    if (payments.length === 0) {
      window.alert('Nothing to export for the current filter.')
      return
    }
    downloadCsvFile(
      `payments_received_${new Date().toISOString().slice(0, 10)}.csv`,
      buildPaymentListCsv(payments, {
        formatDate: formatDateOnly,
        partyLabel: (p) => customers.find((c) => c.id === p.customer_id)?.display_name || `Customer #${p.customer_id}`,
        typeLabel: 'Received',
      }),
    )
  }

  const handleDownloadListJson = () => {
    const { payments } = displayedData
    if (payments.length === 0) {
      window.alert('Nothing to export for the current filter.')
      return
    }
    downloadJsonFile(`payments_received_${new Date().toISOString().slice(0, 10)}.json`, payments)
  }

  const handleDeletePayment = async (payment: CustomerPayment) => {
    const label = payment.payment_number ?? `PAY-${payment.id}`
    if (!confirmDeletePaymentDialog(label)) return
    try {
      const banner = await deletePaymentRequest(payment.id)
      setPolicyBanner(banner)
      await fetchPaymentsReceived()
      await fetchAllOutstandingInvoices()
    } catch (err: unknown) {
      const ax = err as { response?: { data?: { detail?: string } } }
      const d = ax.response?.data?.detail
      window.alert(typeof d === 'string' ? d : 'Delete failed.')
    }
  }

  if (loading) {
    return (
      <PageLayout>
        <div className="flex min-h-[50vh] items-center justify-center">
          <div className="h-12 w-12 animate-spin rounded-full border-2 border-border border-t-blue-600" />
        </div>
      </PageLayout>
    )
  }

  return (
    <PageLayout>
      <ErpPageShell
        showBackLink={false}
        title={pageMeta.title}
        titleIcon={DollarSign}
        description={pageMeta.description}
        maxWidthClass="max-w-[1600px]"
        contentClassName="mt-4"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <DocumentExportButtons
              onPrint={() => void handlePrintList()}
              onDownloadCsv={handleDownloadListCsv}
              onDownloadJson={handleDownloadListJson}
              printLabel="Print list"
            />
            <Link
              href="/payments/received/new"
              className="erp-btn-cta"
            >
              <Plus className="h-5 w-5" />
              <span>New Payment</span>
            </Link>
          </div>
        }
      >
          {policyBanner && (
            <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-emerald-900">
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

          <div className="bg-white rounded-lg shadow-md p-6 mb-6">
            <div className="flex items-center space-x-2 mb-4">
              <Filter className="h-5 w-5 text-muted-foreground" />
              <h2 className="text-lg font-semibold text-foreground">Filters</h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div>
                <label className="block text-sm font-medium text-foreground/85 mb-1">Status</label>
                <select
                  value={filterStatus}
                  onChange={(e) => setFilterStatus(e.target.value as PaymentFilter)}
                  className="w-full px-3 py-2 border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="all">All</option>
                  <option value="received">Payment Received</option>
                  <option value="outstanding">Payment Outstanding</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground/85 mb-1">Start Date</label>
                <CompanyDateInput value={startDate} onChange={setStartDate} className="w-full px-3 py-2 border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-ring" />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground/85 mb-1">End Date</label>
                <CompanyDateInput value={endDate} onChange={setEndDate} className="w-full px-3 py-2 border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-ring" />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground/85 mb-1">Search (all dates)</label>
                <input
                  type="search"
                  value={searchQ}
                  onChange={(e) => setSearchQ(e.target.value)}
                  placeholder="Reference, memo, customer…"
                  className="w-full px-3 py-2 border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground/85 mb-1">Min amount</label>
                <input type="number" min="0" step="0.01" value={minAmount} onChange={(e) => setMinAmount(e.target.value)} className="w-full px-3 py-2 border border-border rounded-md" />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground/85 mb-1">Max amount</label>
                <input type="number" min="0" step="0.01" value={maxAmount} onChange={(e) => setMaxAmount(e.target.value)} className="w-full px-3 py-2 border border-border rounded-md" />
              </div>
              <div className="flex items-end">
                <button
                  type="button"
                  onClick={() => {
                    setStartDate('')
                    setEndDate('')
                    setSearchQ('')
                    setMinAmount('')
                    setMaxAmount('')
                    setFilterStatus('all')
                  }}
                  className="w-full px-4 py-2 border border-border rounded-md text-foreground/85 hover:bg-muted/40"
                >
                  Clear Filters
                </button>
              </div>
            </div>
          </div>

          <div className="bg-gradient-to-r from-green-500 to-green-600 rounded-lg shadow-md p-6 mb-6 text-white">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <DollarSign className="h-8 w-8" />
                <div>
                  <p className="text-green-100 text-sm">Total Receivable</p>
                  <p className="text-3xl font-bold">
                    {currencySymbol}
                    {formatNumber(totalReceivable)}
                  </p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-green-100 text-sm">Outstanding Invoices</p>
                <p className="text-2xl font-semibold">{allOutstandingInvoices.length}</p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-md overflow-hidden">
            {(filterStatus === 'all' || filterStatus === 'received') && displayedData.payments.length > 0 && (
              <div className="p-6">
                <div className="mb-3">
                  <h2 className="text-xl font-semibold">Payments Received</h2>
                  <p className="text-sm text-muted-foreground mt-1">
                    Rows here are only when you <strong>receive</strong> cash, transfer, card, etc.
                    — not the credit sale itself. Use{' '}
                    <strong className="text-foreground/85">Pencil / Trash</strong> for edit and delete; both run
                    in a <strong className="text-foreground/85">single transaction</strong> (reverse AUTO-PAY,
                    update books, re-post). Receipts on a <strong className="text-foreground/85">bank deposit</strong>{' '}
                    stay locked until the deposit is adjusted.
                  </p>
                </div>
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-border">
                    <thead className="bg-muted/40">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">
                          Payment #
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">
                          Date
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">
                          Customer
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">
                          Method
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">
                          Reference
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">
                          Status
                        </th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground uppercase">
                          Amount
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">
                          Memo
                        </th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground uppercase">
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-border">
                      {displayedData.payments.map((payment) => {
                        const customer = customers.find((c) => c.id === payment.customer_id)
                        const customerName =
                          customer?.display_name || `Customer ${payment.customer_id}`
                        const canMutate = payment.can_delete === true

                        return (
                          <tr key={payment.id} className="hover:bg-muted/40">
                            <td className="px-4 py-3 text-sm font-medium text-foreground">
                              {payment.payment_number ?? `PAY-${payment.id}`}
                            </td>
                            <td className="px-4 py-3 text-sm text-muted-foreground">
                              {formatDateOnly(payment.payment_date)}
                            </td>
                            <td className="px-4 py-3 text-sm text-muted-foreground">{customerName}</td>
                            <td className="px-4 py-3 text-sm text-muted-foreground capitalize">
                              {(payment.payment_method ?? 'unspecified').replace(/_/g, ' ')}
                            </td>
                            <td className="px-4 py-3 text-sm text-muted-foreground">
                              {payment.reference_number ?? payment.reference ?? '-'}
                            </td>
                            <td className="px-4 py-3 text-sm text-muted-foreground">
                              <span
                                className={`px-2 py-1 rounded-full text-xs font-medium ${
                                  payment.deposit_status === 'deposited'
                                    ? 'bg-success/15 text-success'
                                    : 'bg-yellow-100 text-yellow-800'
                                }`}
                              >
                                {payment.deposit_status === 'deposited' ? 'Deposited' : 'Undeposited'}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-sm text-right font-medium text-foreground">
                              {currencySymbol}
                              {formatNumber(Number(payment.amount) || 0)}
                            </td>
                            <td className="px-4 py-3 text-sm text-muted-foreground max-w-[12rem] truncate" title={payment.memo || ''}>
                              {payment.memo || '-'}
                            </td>
                            <td className="px-4 py-3 text-right">
                              <div className="flex items-center justify-end gap-1">
                                <button
                                  type="button"
                                  onClick={() => setEditPaymentId(payment.id)}
                                  disabled={!canMutate}
                                  title={
                                    canMutate
                                      ? 'Edit (reverses & reposts GL)'
                                      : payment.immutable_reason || 'Cannot edit'
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
                                      ? 'Delete with rollback'
                                      : payment.immutable_reason || 'Cannot delete'
                                  }
                                  className="rounded-lg p-2 text-muted-foreground hover:bg-destructive/5 hover:text-destructive disabled:cursor-not-allowed disabled:opacity-40"
                                  aria-label={`Delete ${payment.payment_number}`}
                                >
                                  <Trash2 className="h-4 w-4" aria-hidden />
                                </button>
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="border-t border-border/70 px-4 py-3">
                  <OffsetPaginationControls
                    page={listPage}
                    pageSize={pageSize}
                    total={totalCount}
                    onPageChange={setListPage}
                    onPageSizeChange={setPageSize}
                    disabled={loading}
                  />
                </div>
              </div>
            )}

            {(filterStatus === 'all' || filterStatus === 'outstanding') &&
              displayedData.invoices.length > 0 && (
                <div className="p-6 border-t border-border">
                  <div className="mb-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <div>
                      <h2 className="text-xl font-semibold">Payment Outstanding</h2>
                      <p className="text-sm text-muted-foreground mt-1">
                        Open balances (including <strong>on-account / A/R</strong> sales from the
                        cashier). When the customer pays, use{' '}
                        <Link href="/payments/received/new" className="text-success font-medium underline">
                          New Payment
                        </Link>
                        —then the invoice moves toward paid.
                      </p>
                    </div>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-border">
                      <thead className="bg-muted/40">
                        <tr>
                          <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">
                            Invoice #
                          </th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">
                            Date
                          </th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">
                            Due Date
                          </th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">
                            Customer
                          </th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase min-w-[9rem]">
                            Contact A/R
                          </th>
                          <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground uppercase">
                            Total
                          </th>
                          <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground uppercase">
                            Paid
                          </th>
                          <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground uppercase">
                            Balance Due
                          </th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-border">
                        {displayedData.invoices.map((invoice) => {
                          const cust = customers.find((c) => c.id === invoice.customer_id)
                          return (
                          <tr
                            key={invoice.synthetic ? `oa-${invoice.customer_id}` : invoice.id}
                            className={
                              !invoice.synthetic && invoice.days_overdue && invoice.days_overdue > 0
                                ? 'bg-destructive/5'
                                : 'hover:bg-muted/40'
                            }
                          >
                            <td className="px-4 py-3 text-sm font-medium text-foreground">
                              {invoice.invoice_number}
                              {invoice.synthetic ? (
                                <span className="ml-1 text-xs font-normal text-muted-foreground">
                                  (A/R not on an invoice)
                                </span>
                              ) : null}
                              {!invoice.synthetic &&
                                invoice.days_overdue &&
                                invoice.days_overdue > 0 && (
                                <span className="ml-2 text-xs text-destructive">
                                  ({invoice.days_overdue}d overdue)
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-sm text-muted-foreground">
                              {formatDateOnly(invoice.invoice_date)}
                            </td>
                            <td className="px-4 py-3 text-sm text-muted-foreground">
                              {invoice.due_date
                                ? formatDateOnly(invoice.due_date)
                                : '—'}
                            </td>
                            <td className="px-4 py-3 text-sm text-muted-foreground">{invoice.customer_name}</td>
                            <td className="px-4 py-3 text-sm text-muted-foreground align-top">
                              {cust ? (
                                <ContactArApBalances
                                  role="customer"
                                  compact
                                  openingBalance={cust.opening_balance}
                                  openingBalanceDate={cust.opening_balance_date}
                                  currentBalance={cust.current_balance}
                                  currencySymbol={currencySymbol}
                                />
                              ) : (
                                '—'
                              )}
                            </td>
                            <td className="px-4 py-3 text-sm text-right text-foreground">
                              {invoice.synthetic ? (
                                '—'
                              ) : (
                                <>
                                  {currencySymbol}
                                  {formatNumber(Number(invoice.total_amount ?? invoice.total) || 0)}
                                </>
                              )}
                            </td>
                            <td className="px-4 py-3 text-sm text-right text-muted-foreground">
                              {invoice.synthetic ? (
                                '—'
                              ) : (
                                <>
                                  {currencySymbol}
                                  {formatNumber(Number(invoice.amount_paid) || 0)}
                                </>
                              )}
                            </td>
                            <td className="px-4 py-3 text-sm text-right font-medium text-foreground">
                              {currencySymbol}
                              {formatNumber(Number(invoice.balance_due) || 0)}
                            </td>
                          </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

            {displayedData.payments.length === 0 && displayedData.invoices.length === 0 && (
              <div className="p-12 text-center">
                <p className="text-muted-foreground mb-2">Nothing to show for the current view.</p>
                {filterStatus === 'received' && allOutstandingInvoices.length > 0 ? (
                  <p className="text-sm text-warning-foreground bg-warning/10 border border-warning/30 rounded-lg px-4 py-3 max-w-xl mx-auto">
                    You have <strong>{allOutstandingInvoices.length}</strong> open invoice(s)—often
                    including today&apos;s <strong>credit / on-account</strong> sales. They are
                    hidden while Status is <strong>Payment Received</strong>. Switch to{' '}
                    <strong>All</strong> or <strong>Payment Outstanding</strong> to see them.
                  </p>
                ) : null}
                {(startDate || endDate) && (
                  <p className="text-sm text-muted-foreground/70 mt-3">
                    Try clearing the date filters to widen the list.
                  </p>
                )}
                <p className="text-sm text-muted-foreground mt-4">
                  <Link href="/payments/received/new" className="text-success font-medium underline">
                    Record a new payment
                  </Link>
                </p>
              </div>
            )}
          </div>

          <EditPaymentModal
            open={editPaymentId != null}
            paymentId={editPaymentId}
            onClose={() => setEditPaymentId(null)}
            onSaved={async (note) => {
              setPolicyBanner({
                title: 'Payment updated',
                lines: note ? [note] : ['General ledger reversed and reposted successfully.'],
              })
              await fetchPaymentsReceived()
              await fetchAllOutstandingInvoices()
            }}
          />
      </ErpPageShell>
    </PageLayout>
  )
}
