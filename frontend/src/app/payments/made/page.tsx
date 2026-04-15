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
  Trash2,
  X,
} from 'lucide-react'
import api from '@/lib/api'
import EditPaymentModal from '../EditPaymentModal'
import { confirmDeletePaymentDialog, deletePaymentRequest } from '../paymentMutations'
import { getCurrencySymbol } from '@/utils/currency'
import { formatDateOnly } from '@/utils/date'

interface OutstandingBill {
  id: number
  bill_number: string
  bill_date: string
  due_date: string | null
  vendor_id: number
  vendor_name: string
  total_amount: number
  amount_paid: number
  balance_due: number
  days_overdue: number | null
}

function parseNum(v: unknown): number {
  if (v === null || v === undefined || v === '') return 0
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function normalizeOutstandingBill(row: Record<string, unknown>): OutstandingBill {
  return {
    id: parseNum(row.id),
    bill_number: String(row.bill_number ?? ''),
    bill_date: String(row.bill_date ?? ''),
    due_date: row.due_date != null && row.due_date !== '' ? String(row.due_date) : null,
    vendor_id: parseNum(row.vendor_id),
    vendor_name: String(row.vendor_name ?? '').trim(),
    total_amount: parseNum(row.total_amount ?? row.total),
    amount_paid: parseNum(row.amount_paid),
    balance_due: parseNum(row.balance_due),
    days_overdue:
      row.days_overdue === null || row.days_overdue === undefined
        ? null
        : parseNum(row.days_overdue),
  }
}

interface VendorPayment {
  id: number
  payment_number: string
  payment_date: string
  payment_method: string
  amount: number
  reference_number: string | null
  reference?: string | null
  vendor_id: number
  bank_account_id: number
  memo: string | null
  allocations: Array<{
    id: number
    bill_id: number | null
    allocated_amount: number
    discount_amount: number
  }>
  created_at: string
  updated_at: string
  can_edit?: boolean
  can_delete?: boolean
  immutable_reason?: string | null
}

interface Vendor {
  id: number
  vendor_number: string
  company_name?: string | null
  display_name?: string | null
  vendor_name?: string | null
}

type PaymentFilter = 'all' | 'made' | 'outstanding'

export default function PaymentMadePage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [allOutstandingBills, setAllOutstandingBills] = useState<OutstandingBill[]>([])
  const [paymentsMade, setPaymentsMade] = useState<VendorPayment[]>([])
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
    fetchVendors()
    fetchAllOutstandingBills()
    fetchPaymentsMade()
  }, [router])

  useEffect(() => {
    fetchPaymentsMade()
    fetchAllOutstandingBills()
  }, [startDate, endDate])

  const fetchVendors = async () => {
    try {
      try {
        const companyRes = await api.get('/companies/current')
        if (companyRes.data?.currency) {
          setCurrencySymbol(getCurrencySymbol(companyRes.data.currency))
        }
      } catch (error) {
        console.error('Error fetching company currency:', error)
      }

      const response = await api.get('/vendors/', { params: { skip: 0, limit: 10000 } })
      setVendors(response.data)
    } catch (error) {
      console.error('Error fetching vendors:', error)
    } finally {
      setLoading(false)
    }
  }

  const fetchAllOutstandingBills = async () => {
    try {
      const response = await api.get(`/payments/made/outstanding`)
      const raw = response.data
      const bills = Array.isArray(raw)
        ? raw.map((r: Record<string, unknown>) => normalizeOutstandingBill(r))
        : []
      setAllOutstandingBills(bills)
    } catch (error: unknown) {
      console.error('Error fetching all outstanding bills:', error)
      setAllOutstandingBills([])
    }
  }

  const fetchPaymentsMade = async () => {
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

      const response = await api.get('/payments/made', { params })

      let payments: VendorPayment[] = []
      if (Array.isArray(response.data)) {
        payments = response.data
      } else if (response.data && Array.isArray(response.data.payments)) {
        payments = response.data.payments
      } else if (response.data && Array.isArray(response.data.items)) {
        payments = response.data.items
      } else if (response.data && typeof response.data === 'object') {
        const foundArray = Object.values(response.data).find((val: unknown) => Array.isArray(val))
        payments = Array.isArray(foundArray) ? (foundArray as VendorPayment[]) : []
      }

      setPaymentsMade(payments)
    } catch (error: unknown) {
      console.error('Error fetching payments made:', error)
      setPaymentsMade([])
    }
  }

  const totalPayable = allOutstandingBills.reduce((sum, bill) => sum + parseNum(bill.balance_due), 0)

  const vendorDisplayForBill = (bill: OutstandingBill) => {
    const n = bill.vendor_name?.trim()
    if (n) return n
    const v = vendors.find((x) => x.id === bill.vendor_id)
    return (
      v?.display_name?.trim() ||
      v?.company_name?.trim() ||
      v?.vendor_name?.trim() ||
      (bill.vendor_id ? `Vendor #${bill.vendor_id}` : '—')
    )
  }

  const getDisplayedData = () => {
    const payments = Array.isArray(paymentsMade) ? paymentsMade : []
    const bills = Array.isArray(allOutstandingBills) ? allOutstandingBills : []

    if (filterStatus === 'made') {
      return { payments, bills: [] as OutstandingBill[] }
    }
    if (filterStatus === 'outstanding') {
      return { payments: [] as VendorPayment[], bills }
    }
    return { payments, bills }
  }

  const displayedData = getDisplayedData()

  const handleDeletePayment = async (payment: VendorPayment) => {
    const label = payment.payment_number ?? `PAY-${payment.id}`
    if (!confirmDeletePaymentDialog(label)) return
    try {
      const banner = await deletePaymentRequest(payment.id)
      setPolicyBanner(banner)
      await fetchPaymentsMade()
      await fetchAllOutstandingBills()
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
              <h1 className="text-3xl font-bold text-gray-900">Payments — Made</h1>
              <p className="text-gray-600 mt-1 max-w-3xl">
                Pay vendor bills and update accounts payable. Use{' '}
                <strong className="text-gray-700">Pencil / Trash</strong> to edit or delete; both run in a{' '}
                <strong className="text-gray-700">single transaction</strong> (reverse AUTO-PAY, update books,
                re-post). Receipts tied to a <strong className="text-gray-700">bank deposit</strong> stay locked
                until the deposit is adjusted.
              </p>
            </div>
            <Link
              href="/payments/made/new"
              className="inline-flex items-center justify-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 shrink-0"
            >
              <Plus className="h-5 w-5" />
              <span>New Payment</span>
            </Link>
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
                  <option value="made">Payment Made</option>
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
              <div className="flex items-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setStartDate('')
                    setEndDate('')
                    setFilterStatus('all')
                    setTimeout(() => {
                      fetchPaymentsMade()
                      fetchAllOutstandingBills()
                    }, 100)
                  }}
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
                >
                  Clear Filters
                </button>
                <button
                  type="button"
                  onClick={() => {
                    fetchPaymentsMade()
                    fetchAllOutstandingBills()
                  }}
                  className="flex-1 px-4 py-2 border border-blue-300 rounded-md text-blue-700 hover:bg-blue-50"
                >
                  Refresh
                </button>
              </div>
            </div>
          </div>

          <div className="bg-gradient-to-r from-blue-500 to-blue-600 rounded-lg shadow-md p-6 mb-6 text-white">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <DollarSign className="h-8 w-8" />
                <div>
                  <p className="text-blue-100 text-sm">Total Payable</p>
                  <p className="text-3xl font-bold">
                    {currencySymbol}
                    {totalPayable.toFixed(2)}
                  </p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-blue-100 text-sm">Outstanding Bills</p>
                <p className="text-2xl font-semibold">{allOutstandingBills.length}</p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-md overflow-hidden">
            {((filterStatus === 'all' || filterStatus === 'made') &&
              displayedData.payments &&
              Array.isArray(displayedData.payments) &&
              displayedData.payments.length > 0) && (
              <div className="p-6">
                <div className="mb-3">
                  <h2 className="text-xl font-semibold">Payments Made</h2>
                  <p className="text-sm text-gray-500 mt-1">
                    <strong className="text-gray-700">Pencil / Trash</strong> use the same rollback path as the
                    payment register: one transaction reverses AUTO-PAY, restores A/P, and updates bill status.
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
                          Vendor
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                          Method
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                          Reference
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
                        const vendor = vendors.find((v) => v.id === payment.vendor_id)
                        const vendorName =
                          vendor?.display_name ||
                          vendor?.vendor_name ||
                          vendor?.company_name ||
                          `Vendor ${payment.vendor_id}`
                        const canMutate = payment.can_delete === true

                        return (
                          <tr key={payment.id} className="hover:bg-gray-50">
                            <td className="px-4 py-3 text-sm font-medium text-gray-900">
                              {payment.payment_number ?? `PAY-${payment.id}`}
                            </td>
                            <td className="px-4 py-3 text-sm text-gray-600">
                              {formatDateOnly(payment.payment_date)}
                            </td>
                            <td className="px-4 py-3 text-sm text-gray-600">{vendorName}</td>
                            <td className="px-4 py-3 text-sm text-gray-600 capitalize">
                              {(payment.payment_method ?? 'unspecified').replace(/_/g, ' ')}
                            </td>
                            <td className="px-4 py-3 text-sm text-gray-600">
                              {payment.reference_number ?? payment.reference ?? '-'}
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

            {((filterStatus === 'all' || filterStatus === 'outstanding') &&
              displayedData.bills &&
              displayedData.bills.length > 0) && (
              <div
                className={`p-6 ${
                  displayedData.payments.length > 0 && filterStatus === 'all'
                    ? 'border-t border-gray-200'
                    : ''
                }`}
              >
                <div className="mb-3">
                  <h2 className="text-xl font-semibold">Payment Outstanding</h2>
                  <p className="text-sm text-gray-500 mt-1">
                    Use{' '}
                    <Link href="/payments/made/new" className="text-blue-700 font-medium underline">
                      New Payment
                    </Link>{' '}
                    to record a payment against these bills.
                  </p>
                </div>
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                          Bill #
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                          Date
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                          Due Date
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                          Vendor
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
                      {displayedData.bills.map((bill) => (
                        <tr
                          key={bill.id}
                          className={
                            bill.days_overdue && bill.days_overdue > 0
                              ? 'bg-red-50'
                              : 'hover:bg-gray-50'
                          }
                        >
                          <td className="px-4 py-3 text-sm font-medium text-gray-900">
                            {bill.bill_number}
                            {bill.days_overdue && bill.days_overdue > 0 && (
                              <span className="ml-2 text-xs text-red-600">
                                ({bill.days_overdue}d overdue)
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-600">
                            {formatDateOnly(bill.bill_date)}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-600">
                            {bill.due_date ? formatDateOnly(bill.due_date) : '-'}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-600">{vendorDisplayForBill(bill)}</td>
                          <td className="px-4 py-3 text-sm text-right text-gray-900">
                            {currencySymbol}
                            {parseNum(bill.total_amount).toFixed(2)}
                          </td>
                          <td className="px-4 py-3 text-sm text-right text-gray-600">
                            {currencySymbol}
                            {parseNum(bill.amount_paid).toFixed(2)}
                          </td>
                          <td className="px-4 py-3 text-sm text-right font-medium text-gray-900">
                            {currencySymbol}
                            {parseNum(bill.balance_due).toFixed(2)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {(!displayedData.payments || displayedData.payments.length === 0) &&
              (!displayedData.bills || displayedData.bills.length === 0) && (
                <div className="p-12 text-center">
                  <p className="text-gray-500">
                    {filterStatus === 'all'
                      ? 'No payments or outstanding bills found. Try clearing date filters to see all records.'
                      : filterStatus === 'made'
                        ? 'No payments made found. Try clearing date filters to see all payments.'
                        : 'No outstanding bills found.'}
                  </p>
                  {paymentsMade.length > 0 && (filterStatus === 'all' || filterStatus === 'made') && (
                    <p className="text-sm text-gray-400 mt-2">
                      Note: {paymentsMade.length} payment(s) exist but may be filtered by date range.
                    </p>
                  )}
                  <p className="text-sm text-gray-500 mt-4">
                    <Link href="/payments/made/new" className="text-blue-700 font-medium underline">
                      Record a new vendor payment
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
              await fetchPaymentsMade()
              await fetchAllOutstandingBills()
            }}
          />
        </div>
      </div>
    </div>
  )
}
