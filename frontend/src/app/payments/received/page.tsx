'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import Sidebar from '@/components/Sidebar'
import {
  ArrowLeft,
  CheckCircle2,
  DollarSign,
  Filter,
  Pencil,
  Plus,
  Printer,
  Trash2,
  X,
} from 'lucide-react'
import api from '@/lib/api'
import EditPaymentModal from '../EditPaymentModal'
import { confirmDeletePaymentDialog, deletePaymentRequest } from '../paymentMutations'
import { getCurrencySymbol } from '@/utils/currency'
import { formatDate, formatDateOnly } from '@/utils/date'
import { escapeHtml } from '@/utils/printDocument'
import { printListView } from '@/utils/printListView'
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
  const [loading, setLoading] = useState(true)
  const [customers, setCustomers] = useState<Customer[]>([])
  const [allOutstandingInvoices, setAllOutstandingInvoices] = useState<OutstandingInvoice[]>([])
  const [paymentsReceived, setPaymentsReceived] = useState<CustomerPayment[]>([])
  const [currencySymbol, setCurrencySymbol] = useState<string>('৳')

  const [filterStatus, setFilterStatus] = useState<PaymentFilter>('all')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [editPaymentId, setEditPaymentId] = useState<number | null>(null)
  const [policyBanner, setPolicyBanner] = useState<{ title: string; lines: string[] } | null>(null)

  useEffect(() => {
    const token = localStorage.getItem('access_token')
    if (!token) {
      router.push('/login')
      return
    }
    fetchCustomers()
    fetchAllOutstandingInvoices()
    fetchPaymentsReceived()
  }, [router])

  useEffect(() => {
    fetchPaymentsReceived()
    fetchAllOutstandingInvoices()
  }, [startDate, endDate])

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

      const response = await api.get('/customers/', { params: { skip: 0, limit: 10000 } })
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

  const fetchPaymentsReceived = async () => {
    try {
      const params: Record<string, string | number> = {
        skip: 0,
        limit: 1000,
      }
      if (startDate && startDate.trim() !== '') {
        params.start_date = startDate
      }
      if (endDate && endDate.trim() !== '') {
        params.end_date = endDate
      }

      const response = await api.get('/payments/received', { params })
      const payments = response.data || []
      setPaymentsReceived(payments)
    } catch (error: unknown) {
      console.error('Error fetching payments received:', error)
      setPaymentsReceived([])
    }
  }

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
            <td class="right">${escapeHtml(currencySymbol)}${escapeHtml((Number(p.amount) || 0).toFixed(2))}</td>
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
            <td class="right">${escapeHtml(currencySymbol)}${escapeHtml(total.toFixed(2))}</td>
            <td class="right">${escapeHtml(currencySymbol)}${escapeHtml(paid.toFixed(2))}</td>
            <td class="right">${escapeHtml(currencySymbol)}${escapeHtml(bal.toFixed(2))}</td>
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
      <div className="flex min-h-screen items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    )
  }

  return (
    <div className="flex h-screen bg-gray-100 page-with-sidebar">
      <Sidebar />
      <div className="flex-1 overflow-auto">
        <div className="p-8">
          <Link
            href="/payments"
            className="mb-4 inline-flex items-center text-sm font-medium text-gray-600 hover:text-gray-900"
          >
            <ArrowLeft className="mr-1.5 h-4 w-4" aria-hidden />
            Back to Payments
          </Link>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between mb-8">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Payments — Received</h1>
              <p className="text-gray-600 mt-1 max-w-3xl">
                Record <strong>money received</strong> from customers and apply it to open invoices.
                <span className="block mt-1 text-sm text-gray-500">
                  <strong>Credit / on-account sales</strong> do not appear in &quot;Payments
                  Received&quot;—they are open invoices. Use the filter <strong>All</strong> or{' '}
                  <strong>Payment Outstanding</strong> to see today&apos;s credit sales until you
                  record a payment.
                </span>
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => void handlePrintList()}
                className="inline-flex items-center justify-center space-x-2 px-4 py-2 border border-gray-300 bg-white text-gray-800 rounded-lg hover:bg-gray-50"
              >
                <Printer className="h-5 w-5" />
                <span>Print list</span>
              </button>
              <Link
                href="/payments/received/new"
                className="inline-flex items-center justify-center space-x-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
              >
                <Plus className="h-5 w-5" />
                <span>New Payment</span>
              </Link>
            </div>
          </div>

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

          <div className="bg-white rounded-lg shadow-md p-6 mb-6">
            <div className="flex items-center space-x-2 mb-4">
              <Filter className="h-5 w-5 text-gray-600" />
              <h2 className="text-lg font-semibold text-gray-900">Filters</h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
                <select
                  value={filterStatus}
                  onChange={(e) => setFilterStatus(e.target.value as PaymentFilter)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="all">All</option>
                  <option value="received">Payment Received</option>
                  <option value="outstanding">Payment Outstanding</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Start Date</label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">End Date</label>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="flex items-end">
                <button
                  type="button"
                  onClick={() => {
                    setStartDate('')
                    setEndDate('')
                    setFilterStatus('all')
                    setTimeout(() => {
                      fetchPaymentsReceived()
                      fetchAllOutstandingInvoices()
                    }, 100)
                  }}
                  className="w-full px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
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
                    {totalReceivable.toFixed(2)}
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
                  <p className="text-sm text-gray-500 mt-1">
                    Rows here are only when you <strong>receive</strong> cash, transfer, card, etc.
                    — not the credit sale itself. Use{' '}
                    <strong className="text-gray-700">Pencil / Trash</strong> for edit and delete; both run
                    in a <strong className="text-gray-700">single transaction</strong> (reverse AUTO-PAY,
                    update books, re-post). Receipts on a <strong className="text-gray-700">bank deposit</strong>{' '}
                    stay locked until the deposit is adjusted.
                  </p>
                </div>
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                          Payment #
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                          Date
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                          Customer
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                          Method
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                          Reference
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                          Status
                        </th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                          Amount
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                          Memo
                        </th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {displayedData.payments.map((payment) => {
                        const customer = customers.find((c) => c.id === payment.customer_id)
                        const customerName =
                          customer?.display_name || `Customer ${payment.customer_id}`
                        const canMutate = payment.can_delete === true

                        return (
                          <tr key={payment.id} className="hover:bg-gray-50">
                            <td className="px-4 py-3 text-sm font-medium text-gray-900">
                              {payment.payment_number ?? `PAY-${payment.id}`}
                            </td>
                            <td className="px-4 py-3 text-sm text-gray-600">
                              {formatDateOnly(payment.payment_date)}
                            </td>
                            <td className="px-4 py-3 text-sm text-gray-600">{customerName}</td>
                            <td className="px-4 py-3 text-sm text-gray-600 capitalize">
                              {(payment.payment_method ?? 'unspecified').replace(/_/g, ' ')}
                            </td>
                            <td className="px-4 py-3 text-sm text-gray-600">
                              {payment.reference_number ?? payment.reference ?? '-'}
                            </td>
                            <td className="px-4 py-3 text-sm text-gray-600">
                              <span
                                className={`px-2 py-1 rounded-full text-xs font-medium ${
                                  payment.deposit_status === 'deposited'
                                    ? 'bg-green-100 text-green-800'
                                    : 'bg-yellow-100 text-yellow-800'
                                }`}
                              >
                                {payment.deposit_status === 'deposited' ? 'Deposited' : 'Undeposited'}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-sm text-right font-medium text-gray-900">
                              {currencySymbol}
                              {(Number(payment.amount) || 0).toFixed(2)}
                            </td>
                            <td className="px-4 py-3 text-sm text-gray-600 max-w-[12rem] truncate" title={payment.memo || ''}>
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
                                  className="rounded-lg p-2 text-gray-600 hover:bg-gray-100 hover:text-indigo-700 disabled:cursor-not-allowed disabled:opacity-40"
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
                                  className="rounded-lg p-2 text-gray-600 hover:bg-red-50 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-40"
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
              </div>
            )}

            {(filterStatus === 'all' || filterStatus === 'outstanding') &&
              displayedData.invoices.length > 0 && (
                <div className="p-6 border-t border-gray-200">
                  <div className="mb-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <div>
                      <h2 className="text-xl font-semibold">Payment Outstanding</h2>
                      <p className="text-sm text-gray-500 mt-1">
                        Open balances (including <strong>on-account / A/R</strong> sales from the
                        cashier). When the customer pays, use{' '}
                        <Link href="/payments/received/new" className="text-green-700 font-medium underline">
                          New Payment
                        </Link>
                        —then the invoice moves toward paid.
                      </p>
                    </div>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                            Invoice #
                          </th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                            Date
                          </th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                            Due Date
                          </th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                            Customer
                          </th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase min-w-[9rem]">
                            Contact A/R
                          </th>
                          <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                            Total
                          </th>
                          <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                            Paid
                          </th>
                          <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                            Balance Due
                          </th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {displayedData.invoices.map((invoice) => {
                          const cust = customers.find((c) => c.id === invoice.customer_id)
                          return (
                          <tr
                            key={invoice.synthetic ? `oa-${invoice.customer_id}` : invoice.id}
                            className={
                              !invoice.synthetic && invoice.days_overdue && invoice.days_overdue > 0
                                ? 'bg-red-50'
                                : 'hover:bg-gray-50'
                            }
                          >
                            <td className="px-4 py-3 text-sm font-medium text-gray-900">
                              {invoice.invoice_number}
                              {invoice.synthetic ? (
                                <span className="ml-1 text-xs font-normal text-gray-500">
                                  (A/R not on an invoice)
                                </span>
                              ) : null}
                              {!invoice.synthetic &&
                                invoice.days_overdue &&
                                invoice.days_overdue > 0 && (
                                <span className="ml-2 text-xs text-red-600">
                                  ({invoice.days_overdue}d overdue)
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-sm text-gray-600">
                              {formatDateOnly(invoice.invoice_date)}
                            </td>
                            <td className="px-4 py-3 text-sm text-gray-600">
                              {invoice.due_date
                                ? formatDateOnly(invoice.due_date)
                                : '—'}
                            </td>
                            <td className="px-4 py-3 text-sm text-gray-600">{invoice.customer_name}</td>
                            <td className="px-4 py-3 text-sm text-gray-600 align-top">
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
                            <td className="px-4 py-3 text-sm text-right text-gray-900">
                              {invoice.synthetic ? (
                                '—'
                              ) : (
                                <>
                                  {currencySymbol}
                                  {(Number(invoice.total_amount ?? invoice.total) || 0).toFixed(2)}
                                </>
                              )}
                            </td>
                            <td className="px-4 py-3 text-sm text-right text-gray-600">
                              {invoice.synthetic ? (
                                '—'
                              ) : (
                                <>
                                  {currencySymbol}
                                  {(Number(invoice.amount_paid) || 0).toFixed(2)}
                                </>
                              )}
                            </td>
                            <td className="px-4 py-3 text-sm text-right font-medium text-gray-900">
                              {currencySymbol}
                              {(Number(invoice.balance_due) || 0).toFixed(2)}
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
                <p className="text-gray-500 mb-2">Nothing to show for the current view.</p>
                {filterStatus === 'received' && allOutstandingInvoices.length > 0 ? (
                  <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 max-w-xl mx-auto">
                    You have <strong>{allOutstandingInvoices.length}</strong> open invoice(s)—often
                    including today&apos;s <strong>credit / on-account</strong> sales. They are
                    hidden while Status is <strong>Payment Received</strong>. Switch to{' '}
                    <strong>All</strong> or <strong>Payment Outstanding</strong> to see them.
                  </p>
                ) : null}
                {(startDate || endDate) && (
                  <p className="text-sm text-gray-400 mt-3">
                    Try clearing the date filters to widen the list.
                  </p>
                )}
                <p className="text-sm text-gray-500 mt-4">
                  <Link href="/payments/received/new" className="text-green-700 font-medium underline">
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
        </div>
      </div>
    </div>
  )
}
