'use client'

import { Suspense, useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import Sidebar from '@/components/Sidebar'
import { ArrowLeft, AlertCircle } from 'lucide-react'
import api from '@/lib/api'
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

interface Vendor {
  id: number
  vendor_number: string
  company_name?: string | null
  display_name?: string | null
  vendor_name?: string | null
  contact_person?: string | null
  email?: string | null
  phone?: string | null
  billing_address_line1?: string | null
  bank_account_number?: string | null
  bank_name?: string | null
  bank_branch?: string | null
  bank_routing_number?: string | null
}

/** Coerce IDs and unwrap common API shapes so the vendor select value always matches an option. */
function normalizeVendorsFromApi(data: unknown): Vendor[] {
  let rows: unknown[] = []
  if (Array.isArray(data)) {
    rows = data
  } else if (data && typeof data === 'object') {
    const o = data as Record<string, unknown>
    if (Array.isArray(o.results)) rows = o.results
    else if (Array.isArray(o.data)) rows = o.data
    else if (Array.isArray(o.vendors)) rows = o.vendors
  }

  return rows
    .filter((row): row is Record<string, unknown> => row != null && typeof row === 'object')
    .flatMap((r) => {
      const id = typeof r.id === 'number' ? r.id : Number(r.id)
      if (!Number.isFinite(id)) return []
      const v: Vendor = {
        id,
        vendor_number: String(r.vendor_number ?? ''),
        company_name: r.company_name != null ? String(r.company_name) : null,
        display_name: r.display_name != null ? String(r.display_name) : null,
        vendor_name: r.vendor_name != null ? String(r.vendor_name) : null,
        contact_person: r.contact_person != null ? String(r.contact_person) : null,
        email: r.email != null ? String(r.email) : null,
        phone: r.phone != null ? String(r.phone) : null,
        billing_address_line1:
          r.billing_address_line1 != null ? String(r.billing_address_line1) : null,
        bank_account_number:
          r.bank_account_number != null ? String(r.bank_account_number) : null,
        bank_name: r.bank_name != null ? String(r.bank_name) : null,
        bank_branch: r.bank_branch != null ? String(r.bank_branch) : null,
        bank_routing_number:
          r.bank_routing_number != null ? String(r.bank_routing_number) : null,
      }
      return [v]
    })
}

function normBankAccountString(s: string): string {
  return String(s || '').replace(/\s/g, '').toLowerCase()
}

function buildVendorPaymentMemo(v: Vendor): string {
  const name =
    (v.display_name || '').trim() ||
    (v.company_name || '').trim() ||
    (v.vendor_name || '').trim() ||
    'Vendor'
  const num = (v.vendor_number || '').trim() || `#${v.id}`
  const lines: string[] = [`Payment to ${name} (${num})`]
  if (v.contact_person?.trim()) lines.push(`Contact: ${v.contact_person.trim()}`)
  if (v.email?.trim()) lines.push(`Email: ${v.email.trim()}`)
  if (v.phone?.trim()) lines.push(`Phone: ${v.phone.trim()}`)
  if (v.billing_address_line1?.trim()) lines.push(`Address: ${v.billing_address_line1.trim()}`)
  const bankParts: string[] = []
  if (v.bank_name?.trim()) bankParts.push(v.bank_name.trim())
  if (v.bank_branch?.trim()) bankParts.push(`Branch: ${v.bank_branch.trim()}`)
  if (v.bank_account_number?.trim()) bankParts.push(`Acct: ${v.bank_account_number.trim()}`)
  if (v.bank_routing_number?.trim()) bankParts.push(`Routing: ${v.bank_routing_number.trim()}`)
  if (bankParts.length) lines.push(`Vendor bank — ${bankParts.join(' · ')}`)
  return lines.join('\n')
}

interface BankAccount {
  id: number
  account_number: string
  account_name: string
  current_balance: number | string | null
}

function normalizeBankAccountsFromApi(data: unknown): BankAccount[] {
  let rows: unknown[] = []
  if (Array.isArray(data)) {
    rows = data
  } else if (data && typeof data === 'object') {
    const o = data as Record<string, unknown>
    if (Array.isArray(o.results)) rows = o.results
    else if (Array.isArray(o.data)) rows = o.data
  }

  return rows
    .filter((row): row is Record<string, unknown> => row != null && typeof row === 'object')
    .map((r) => {
      const id = typeof r.id === 'number' ? r.id : Number(r.id)
      if (!Number.isFinite(id)) return null
      return {
        id,
        account_number: String(r.account_number ?? ''),
        account_name: String(r.account_name ?? ''),
        current_balance: r.current_balance as BankAccount['current_balance'],
      } satisfies BankAccount
    })
    .filter((a): a is BankAccount => a != null)
}

interface PaymentAllocation {
  bill_id: number
  allocated_amount: number
  discount_amount: number
}

function RecordPaymentMadeInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const prefillApplied = useRef(false)

  const formatBalance = (balance: number | string | null): string => {
    const numericValue =
      typeof balance === 'number'
        ? balance
        : balance !== null && balance !== undefined && balance !== ''
          ? Number(balance)
          : 0
    return Number.isFinite(numericValue) ? numericValue.toFixed(2) : '0.00'
  }

  const [loading, setLoading] = useState(true)
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([])
  const [selectedVendorId, setSelectedVendorId] = useState<number | null>(null)
  const [selectedBankAccountId, setSelectedBankAccountId] = useState<number | null>(null)
  const [outstandingBills, setOutstandingBills] = useState<OutstandingBill[]>([])
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().split('T')[0])
  const [paymentMethod, setPaymentMethod] = useState('check')
  const [referenceNumber, setReferenceNumber] = useState('')
  const [memo, setMemo] = useState('')
  const [totalPaymentAmount, setTotalPaymentAmount] = useState(0)
  const [allocations, setAllocations] = useState<PaymentAllocation[]>([])
  const [payFullBalanceBillIds, setPayFullBalanceBillIds] = useState<Set<number>>(() => new Set())
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [currencySymbol, setCurrencySymbol] = useState<string>('৳')

  useEffect(() => {
    const token = localStorage.getItem('access_token')
    if (!token) {
      router.push('/login')
      setLoading(false)
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
        const [vRes, bRes] = await Promise.all([
          api.get('/vendors/', { params: { skip: 0, limit: 10000 } }),
          api.get('/bank-accounts/'),
        ])
        setError('')
        setVendors(normalizeVendorsFromApi(vRes.data))
        setBankAccounts(normalizeBankAccountsFromApi(bRes.data))
      } catch (e) {
        console.error('Error loading vendors / bank accounts:', e)
        setVendors([])
        setBankAccounts([])
        setError('Could not load vendors or bank accounts. Check your connection and try again.')
      } finally {
        setLoading(false)
      }
    })()
  }, [router])

  useEffect(() => {
    if (!selectedVendorId) {
      setOutstandingBills([])
      return
    }
    ;(async () => {
      try {
        const response = await api.get(`/payments/made/outstanding`, {
          params: { vendor_id: selectedVendorId },
        })
        const data = Array.isArray(response.data)
          ? response.data.map((r: Record<string, unknown>) => normalizeOutstandingBill(r))
          : []
        setOutstandingBills(data)
        setPayFullBalanceBillIds(new Set())
        setAllocations(
          data.map((bill: OutstandingBill) => ({
            bill_id: bill.id,
            allocated_amount: 0,
            discount_amount: 0,
          }))
        )
      } catch (e) {
        console.error('Error fetching bills:', e)
        setOutstandingBills([])
      }
    })()
  }, [selectedVendorId])

  useEffect(() => {
    if (!selectedVendorId || bankAccounts.length === 0) return
    const v = vendors.find((x) => Number(x.id) === Number(selectedVendorId))
    const acct = v?.bank_account_number?.trim()
    if (!v || !acct) return
    const n = normBankAccountString(acct)
    const match = bankAccounts.find(
      (a) => normBankAccountString(String(a.account_number || '')) === n && n.length > 0
    )
    if (!match) return
    setSelectedBankAccountId((prev) => (prev == null ? match.id : prev))
  }, [bankAccounts, selectedVendorId, vendors])

  const handleVendorSelectChange = (raw: string) => {
    if (!raw) {
      setSelectedVendorId(null)
      setMemo('')
      setReferenceNumber('')
      setAllocations([])
      setPayFullBalanceBillIds(new Set())
      setTotalPaymentAmount(0)
      setSelectedBankAccountId(null)
      return
    }
    const id = Number(raw)
    if (!Number.isFinite(id)) {
      setSelectedVendorId(null)
      setMemo('')
      setReferenceNumber('')
      setAllocations([])
      setPayFullBalanceBillIds(new Set())
      setTotalPaymentAmount(0)
      setSelectedBankAccountId(null)
      return
    }
    const v = vendors.find((x) => Number(x.id) === id)
    if (!v) {
      setSelectedVendorId(null)
      setMemo('')
      setReferenceNumber('')
      setAllocations([])
      setPayFullBalanceBillIds(new Set())
      setTotalPaymentAmount(0)
      setSelectedBankAccountId(null)
      return
    }
    setSelectedVendorId(id)
    setMemo(buildVendorPaymentMemo(v))
    setReferenceNumber((v.vendor_number || '').trim())
    const acct = (v.bank_account_number || '').trim()
    if (acct) {
      const n = normBankAccountString(acct)
      const match = bankAccounts.find(
        (a) => normBankAccountString(String(a.account_number || '')) === n && n.length > 0
      )
      setSelectedBankAccountId(match ? match.id : null)
    } else {
      setSelectedBankAccountId(null)
    }
  }

  useEffect(() => {
    if (prefillApplied.current || vendors.length === 0) return
    const raw = searchParams.get('vendor_id')
    if (!raw) return
    const id = Number(raw)
    if (!Number.isFinite(id)) return
    prefillApplied.current = true
    handleVendorSelectChange(String(id))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vendors.length])

  const selectedVendor =
    selectedVendorId != null
      ? vendors.find((v) => Number(v.id) === Number(selectedVendorId)) ?? null
      : null

  const handleAllocationChange = (billId: number, amount: number) => {
    const bill = outstandingBills.find((b) => b.id === billId)
    if (!bill) return
    const maxAmount = parseNum(bill.balance_due)
    const allocatedAmount = Math.min(Math.max(0, amount), maxAmount)
    const fullBalance = maxAmount
    const isFullLine = fullBalance > 0 && Math.abs(allocatedAmount - fullBalance) < 0.005
    setPayFullBalanceBillIds((prev) => {
      const next = new Set(prev)
      if (isFullLine) next.add(billId)
      else next.delete(billId)
      return next
    })
    setAllocations((prev) => {
      const updated = prev.map((alloc) =>
        alloc.bill_id === billId ? { ...alloc, allocated_amount: allocatedAmount } : alloc
      )
      const newTotal = updated.reduce((sum, a) => sum + a.allocated_amount, 0)
      setTotalPaymentAmount(newTotal)
      return updated
    })
  }

  const handleRowPayFullToggle = (billId: number, checked: boolean) => {
    const bill = outstandingBills.find((b) => b.id === billId)
    if (!bill) return
    const balance = parseNum(bill.balance_due)
    if (balance <= 0 && checked) return
    setPayFullBalanceBillIds((prev) => {
      const next = new Set(prev)
      if (checked) next.add(billId)
      else next.delete(billId)
      return next
    })
    setAllocations((prev) => {
      const updated = prev.map((alloc) =>
        alloc.bill_id === billId
          ? { ...alloc, allocated_amount: checked ? balance : 0 }
          : alloc
      )
      const newTotal = updated.reduce((s, a) => s + a.allocated_amount, 0)
      setTotalPaymentAmount(newTotal)
      return updated
    })
  }

  const handlePaymentAmountChange = (amount: number) => {
    setPayFullBalanceBillIds(new Set())
    setTotalPaymentAmount(amount)
    if (amount > 0) {
      let remaining = amount
      const newAllocations = outstandingBills.map((bill) => {
        if (remaining <= 0) {
          return { bill_id: bill.id, allocated_amount: 0, discount_amount: 0 }
        }
        const allocatedAmount = Math.min(remaining, bill.balance_due)
        remaining -= allocatedAmount
        return { bill_id: bill.id, allocated_amount: allocatedAmount, discount_amount: 0 }
      })
      setAllocations(newAllocations)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setSubmitting(true)

    if (!selectedVendorId) {
      setError('Please select a vendor')
      setSubmitting(false)
      return
    }
    if (!selectedBankAccountId) {
      setError('Please select a bank account')
      setSubmitting(false)
      return
    }
    if (totalPaymentAmount <= 0) {
      setError('Payment amount must be greater than 0')
      setSubmitting(false)
      return
    }
    const selectedBankAccount = bankAccounts.find((b) => b.id === selectedBankAccountId)
    if (selectedBankAccount) {
      const balance = Number(selectedBankAccount.current_balance) || 0
      if (balance < totalPaymentAmount) {
        setError(`Insufficient balance. Available: ${currencySymbol}${balance.toFixed(2)}`)
        setSubmitting(false)
        return
      }
    }
    const validAllocations = allocations.filter((a) => a.allocated_amount > 0)
    if (validAllocations.length === 0) {
      setError('Please allocate payment to at least one bill')
      setSubmitting(false)
      return
    }
    const totalAllocated = validAllocations.reduce((sum, a) => sum + a.allocated_amount, 0)
    if (Math.abs(totalAllocated - totalPaymentAmount) > 0.01) {
      setError(
        `Total allocation (${totalAllocated.toFixed(2)}) must equal payment amount (${totalPaymentAmount.toFixed(2)})`
      )
      setSubmitting(false)
      return
    }

    try {
      await api.post('/payments/made', {
        vendor_id: selectedVendorId,
        payment_date: paymentDate,
        payment_method: paymentMethod,
        amount: totalPaymentAmount,
        bank_account_id: selectedBankAccountId,
        reference_number: referenceNumber || null,
        memo: memo || null,
        allocations: validAllocations,
      })
      alert('Payment recorded successfully!')
      router.push('/payments/made')
    } catch (err: unknown) {
      const any = err as { response?: { data?: { detail?: string } }; message?: string }
      setError(
        any.response?.data?.detail || any.message || 'Error recording payment. Please try again.'
      )
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600" />
      </div>
    )
  }

  return (
    <div className="flex h-screen bg-gray-100 page-with-sidebar">
      <Sidebar />
      <div className="flex-1 overflow-auto">
        <div className="p-8 max-w-5xl mx-auto">
          <div className="mb-6">
            <Link
              href="/payments/made"
              className="inline-flex items-center text-sm font-medium text-gray-600 hover:text-gray-900 mb-4"
            >
              <ArrowLeft className="h-4 w-4 mr-1" />
              Back to Payments Made
            </Link>
            <h1 className="text-3xl font-bold text-gray-900">Record vendor payment</h1>
            <p className="text-gray-600 mt-1">Pay open bills from a company bank account.</p>
          </div>

          <div className="bg-white rounded-lg shadow-md p-6">
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4 flex items-center">
                <AlertCircle className="h-5 w-5 mr-2 shrink-0" />
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4" autoComplete="off">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Vendor *</label>
                  <select
                    id="record-payment-vendor"
                    name="vendor_id"
                    value={selectedVendorId != null ? String(selectedVendorId) : ''}
                    onChange={(e) => handleVendorSelectChange(e.target.value)}
                    className="relative z-10 w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    required
                  >
                    <option value="">Select Vendor</option>
                    {vendors.map((vendor) => (
                      <option key={vendor.id} value={String(vendor.id)}>
                        {vendor.display_name ||
                          vendor.vendor_name ||
                          vendor.company_name ||
                          `Vendor ${vendor.vendor_number}`}
                      </option>
                    ))}
                  </select>
                  {!loading && vendors.length === 0 && !error && (
                    <p className="mt-1 text-sm text-gray-500">No vendors found.</p>
                  )}
                  {selectedVendor && (
                    <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700">
                      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
                        Vendor details
                      </p>
                      <div className="space-y-1">
                        <p>
                          <span className="text-gray-500">Name:</span>{' '}
                          <span className="font-medium text-gray-900">
                            {(
                              selectedVendor.display_name ||
                              selectedVendor.company_name ||
                              selectedVendor.vendor_name ||
                              '—'
                            ).trim() || '—'}
                          </span>
                        </p>
                        <p>
                          <span className="text-gray-500">Vendor #:</span>{' '}
                          <span className="font-medium text-gray-900">
                            {selectedVendor.vendor_number || '—'}
                          </span>
                        </p>
                        {selectedVendor.contact_person?.trim() ? (
                          <p>
                            <span className="text-gray-500">Contact:</span>{' '}
                            {selectedVendor.contact_person.trim()}
                          </p>
                        ) : null}
                        {selectedVendor.email?.trim() ? (
                          <p>
                            <span className="text-gray-500">Email:</span> {selectedVendor.email.trim()}
                          </p>
                        ) : null}
                        {selectedVendor.phone?.trim() ? (
                          <p>
                            <span className="text-gray-500">Phone:</span> {selectedVendor.phone.trim()}
                          </p>
                        ) : null}
                        {selectedVendor.bank_name || selectedVendor.bank_account_number ? (
                          <p>
                            <span className="text-gray-500">Bank:</span>{' '}
                            {[
                              selectedVendor.bank_name,
                              selectedVendor.bank_branch,
                              selectedVendor.bank_account_number
                                ? `Acct ${selectedVendor.bank_account_number}`
                                : '',
                              selectedVendor.bank_routing_number
                                ? `Routing ${selectedVendor.bank_routing_number}`
                                : '',
                            ]
                              .filter(Boolean)
                              .join(' · ')}
                          </p>
                        ) : null}
                      </div>
                    </div>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Bank Account *
                  </label>
                  <select
                    value={selectedBankAccountId != null ? String(selectedBankAccountId) : ''}
                    onChange={(e) => {
                      const n = Number(e.target.value)
                      setSelectedBankAccountId(Number.isFinite(n) ? n : null)
                    }}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    required
                  >
                    <option value="">Select Bank Account</option>
                    {bankAccounts.map((account) => (
                      <option key={account.id} value={String(account.id)}>
                        {account.account_name} (Balance: {currencySymbol}
                        {formatBalance(account.current_balance)})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Payment Date *
                  </label>
                  <input
                    type="date"
                    value={paymentDate}
                    onChange={(e) => setPaymentDate(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Payment Method *
                  </label>
                  <select
                    value={paymentMethod}
                    onChange={(e) => setPaymentMethod(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    required
                  >
                    <option value="check">Check</option>
                    <option value="ach">ACH</option>
                    <option value="wire_transfer">Wire Transfer</option>
                    <option value="bank_transfer">Bank Transfer</option>
                    <option value="credit_card">Credit Card</option>
                    <option value="cash">Cash</option>
                    <option value="other">Other</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Reference Number
                  </label>
                  <input
                    type="text"
                    value={referenceNumber}
                    onChange={(e) => setReferenceNumber(e.target.value)}
                    placeholder="Check #, Transaction ID, etc."
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Payment Amount *
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={totalPaymentAmount || ''}
                    onChange={(e) => handlePaymentAmountChange(Number(e.target.value))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    required
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Memo</label>
                  <textarea
                    value={memo}
                    onChange={(e) => setMemo(e.target.value)}
                    rows={4}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                    placeholder="Filled from vendor record when you select a vendor; you can edit."
                  />
                </div>
              </div>

              {selectedVendorId && outstandingBills.length > 0 && (
                <div className="mt-6">
                  <h3 className="text-lg font-semibold mb-4">Allocate Payment to Bills</h3>
                  <div className="border border-gray-200 rounded-lg overflow-hidden overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200">
                      <thead className="bg-gray-50">
                        <tr>
                          <th
                            className="px-2 py-3 text-center text-xs font-medium text-gray-500 uppercase w-14"
                            title="Fill this line with the full outstanding balance"
                          >
                            Full
                          </th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                            Bill #
                          </th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                            Date
                          </th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                            Due Date
                          </th>
                          <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                            Total
                          </th>
                          <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                            Paid
                          </th>
                          <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                            Balance
                          </th>
                          <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                            Allocate
                          </th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {outstandingBills.map((bill) => {
                          const allocation = allocations.find((a) => a.bill_id === bill.id)
                          const allocatedAmount = allocation?.allocated_amount || 0
                          const balanceDue = parseNum(bill.balance_due)
                          const payFullChecked = balanceDue > 0 && payFullBalanceBillIds.has(bill.id)
                          return (
                            <tr key={bill.id} className={allocatedAmount > 0 ? 'bg-blue-50' : ''}>
                              <td className="px-2 py-3 text-center align-middle">
                                <input
                                  type="checkbox"
                                  checked={payFullChecked}
                                  disabled={balanceDue <= 0}
                                  onChange={(e) => handleRowPayFullToggle(bill.id, e.target.checked)}
                                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                  title="Allocate full balance on this bill"
                                  aria-label={`Pay full balance for bill ${bill.bill_number}`}
                                />
                              </td>
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
                              <td className="px-4 py-3 text-sm text-right">
                                <input
                                  type="number"
                                  step="0.01"
                                  min="0"
                                  max={parseNum(bill.balance_due)}
                                  value={allocatedAmount}
                                  onChange={(e) =>
                                    handleAllocationChange(bill.id, Number(e.target.value))
                                  }
                                  className="w-24 px-2 py-1 border border-gray-300 rounded text-right focus:outline-none focus:ring-2 focus:ring-blue-500"
                                />
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                      <tfoot className="bg-gray-50">
                        <tr>
                          <td
                            colSpan={7}
                            className="px-4 py-3 text-sm font-medium text-right text-gray-900"
                          >
                            Total Allocated:
                          </td>
                          <td className="px-4 py-3 text-sm font-bold text-right text-gray-900">
                            {currencySymbol}
                            {allocations.reduce((sum, a) => sum + a.allocated_amount, 0).toFixed(2)}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-3 pt-4 border-t border-gray-100">
                <Link
                  href="/payments/made"
                  className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50 inline-flex items-center justify-center"
                >
                  Cancel
                </Link>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
                >
                  {submitting ? 'Processing…' : 'Record Payment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function NewPaymentMadePage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-gray-100">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600" />
        </div>
      }
    >
      <RecordPaymentMadeInner />
    </Suspense>
  )
}
