'use client'

import { Suspense, useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import Sidebar from '@/components/Sidebar'
import { ArrowLeft, AlertCircle, UserPlus } from 'lucide-react'
import api from '@/lib/api'
import { getCurrencySymbol, formatNumber } from '@/utils/currency'
import { formatDateOnly } from '@/utils/date'
import { AMOUNT_ALLOCATE_GREEN_CLASS, AMOUNT_EDITABLE_FULL_GREEN_CLASS } from '@/utils/amountFieldStyles'
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

function allocInvoiceId(inv: OutstandingInvoice) {
  return inv.synthetic ? 0 : inv.id
}

/** Ensure one on-account / advance line (invoice_id 0) so prepayment is always available in the grid. */
function mergeOutstandingForCustomer(
  apiRows: OutstandingInvoice[] | null | undefined,
  customerId: number
): OutstandingInvoice[] {
  const rows = Array.isArray(apiRows) ? [...apiRows] : []
  const hasOa = rows.some((r) => r.synthetic && r.on_account)
  if (!hasOa) {
    rows.push({
      id: 0,
      synthetic: true,
      on_account: true,
      invoice_number: 'On-account & customer advance (prepayment)',
      invoice_date: new Date().toISOString().split('T')[0],
      due_date: null,
      customer_id: customerId,
      customer_name: '',
      balance_due: 0,
      days_overdue: null,
    })
  }
  return rows
}

function isOaOrAdvanceRow(inv: OutstandingInvoice) {
  return Boolean(inv.synthetic && inv.on_account)
}

/** Open balance to pre-fill when a line is checked (user can still reduce for partial payment). */
function defaultAllocWhenSelected(inv: OutstandingInvoice) {
  return Math.max(0, Number(inv.balance_due) || 0)
}

/** Stable key for selection state (synthetic on-account is always `oa`) */
function rowKey(inv: OutstandingInvoice) {
  if (inv.synthetic && inv.on_account) return 'oa'
  return `inv-${inv.id}`
}

interface Customer {
  id: number
  customer_number: string
  display_name: string
  company_name?: string
  first_name?: string
  email?: string
  phone?: string
  billing_address_line1?: string
  bank_account_number?: string
  bank_name?: string
  bank_branch?: string
  bank_routing_number?: string
  opening_balance?: string
  opening_balance_date?: string | null
  current_balance?: string
}

/** Coerce IDs and unwrap common API shapes so the customer select value always matches an option. */
function normalizeCustomersFromApi(data: unknown): Customer[] {
  let rows: unknown[] = []
  if (Array.isArray(data)) {
    rows = data
  } else if (data && typeof data === 'object') {
    const o = data as Record<string, unknown>
    if (Array.isArray(o.results)) rows = o.results
    else if (Array.isArray(o.data)) rows = o.data
    else if (Array.isArray(o.customers)) rows = o.customers
  }

  return rows
    .filter((row): row is Record<string, unknown> => row != null && typeof row === 'object')
    .flatMap((r) => {
      const id = typeof r.id === 'number' ? r.id : Number(r.id)
      if (!Number.isFinite(id)) return []
      const c: Customer = {
        id,
        customer_number: String(r.customer_number ?? ''),
        display_name: String(r.display_name ?? ''),
        company_name: r.company_name != null ? String(r.company_name) : undefined,
        first_name: r.first_name != null ? String(r.first_name) : undefined,
        email: r.email != null ? String(r.email) : undefined,
        phone: r.phone != null ? String(r.phone) : undefined,
        billing_address_line1:
          r.billing_address_line1 != null ? String(r.billing_address_line1) : undefined,
        bank_account_number:
          r.bank_account_number != null ? String(r.bank_account_number) : undefined,
        bank_name: r.bank_name != null ? String(r.bank_name) : undefined,
        bank_branch: r.bank_branch != null ? String(r.bank_branch) : undefined,
        bank_routing_number:
          r.bank_routing_number != null ? String(r.bank_routing_number) : undefined,
        opening_balance: r.opening_balance != null ? String(r.opening_balance) : undefined,
        opening_balance_date:
          r.opening_balance_date != null && r.opening_balance_date !== ''
            ? String(r.opening_balance_date)
            : null,
        current_balance: r.current_balance != null ? String(r.current_balance) : undefined,
      }
      return [c]
    })
}

function buildCustomerPaymentMemo(c: Customer): string {
  const name =
    (c.display_name || '').trim() ||
    (c.company_name || '').trim() ||
    (c.first_name || '').trim() ||
    'Customer'
  const num = (c.customer_number || '').trim() || `#${c.id}`
  const lines: string[] = [`Payment received from ${name} (${num})`]
  if (c.email?.trim()) lines.push(`Email: ${c.email.trim()}`)
  if (c.phone?.trim()) lines.push(`Phone: ${c.phone.trim()}`)
  if (c.billing_address_line1?.trim()) lines.push(`Address: ${c.billing_address_line1.trim()}`)
  const bankParts: string[] = []
  if (c.bank_name?.trim()) bankParts.push(c.bank_name.trim())
  if (c.bank_branch?.trim()) bankParts.push(`Branch: ${c.bank_branch.trim()}`)
  if (c.bank_account_number?.trim()) bankParts.push(`Acct: ${c.bank_account_number.trim()}`)
  if (c.bank_routing_number?.trim()) bankParts.push(`Routing: ${c.bank_routing_number.trim()}`)
  if (bankParts.length) lines.push(`Customer bank — ${bankParts.join(' · ')}`)
  return lines.join('\n')
}

interface PaymentAllocation {
  invoice_id: number
  allocated_amount: number
  discount_amount: number
}

function RecordPaymentReceivedInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const prefillApplied = useRef(false)

  const [loading, setLoading] = useState(true)
  const [customers, setCustomers] = useState<Customer[]>([])
  const [selectedCustomerId, setSelectedCustomerId] = useState<number | null>(null)
  const [outstandingInvoices, setOutstandingInvoices] = useState<OutstandingInvoice[]>([])
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().split('T')[0])
  const [paymentMethod, setPaymentMethod] = useState('cash')
  const [referenceNumber, setReferenceNumber] = useState('')
  const [memo, setMemo] = useState('')
  const [totalPaymentAmount, setTotalPaymentAmount] = useState(0)
  const [allocations, setAllocations] = useState<PaymentAllocation[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [currencySymbol, setCurrencySymbol] = useState<string>('৳')
  const [showNewCustomer, setShowNewCustomer] = useState(false)
  const [newDisplayName, setNewDisplayName] = useState('')
  const [newPhone, setNewPhone] = useState('')
  const [newEmail, setNewEmail] = useState('')
  const [creatingCustomer, setCreatingCustomer] = useState(false)
  /** false = deselected (exclude from allocation); true = include */
  const [lineSelected, setLineSelected] = useState<Record<string, boolean>>({})

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
        const response = await api.get('/customers/', { params: { skip: 0, limit: 10000 } })
        setError('')
        setCustomers(normalizeCustomersFromApi(response.data))
      } catch (e) {
        console.error('Error loading customers:', e)
        setCustomers([])
        setError('Could not load customers. Check your connection and try again.')
      } finally {
        setLoading(false)
      }
    })()
  }, [router])

  useEffect(() => {
    if (!selectedCustomerId) {
      setOutstandingInvoices([])
      return
    }
    ;(async () => {
      try {
        const response = await api.get(`/payments/received/outstanding`, {
          params: { customer_id: selectedCustomerId },
        })
        if (response.data) {
          const merged = mergeOutstandingForCustomer(
            response.data,
            selectedCustomerId
          )
          setOutstandingInvoices(merged)
          setAllocations(
            merged.map((inv: OutstandingInvoice) => ({
              invoice_id: allocInvoiceId(inv),
              allocated_amount: 0,
              discount_amount: 0,
            }))
          )
        }
      } catch (e) {
        console.error('Error fetching invoices:', e)
        if (selectedCustomerId != null) {
          const merged = mergeOutstandingForCustomer([], selectedCustomerId)
          setOutstandingInvoices(merged)
          setAllocations(
            merged.map((inv: OutstandingInvoice) => ({
              invoice_id: allocInvoiceId(inv),
              allocated_amount: 0,
              discount_amount: 0,
            }))
          )
        }
      }
    })()
  }, [selectedCustomerId])

  useEffect(() => {
    setLineSelected((prev) => {
      const next: Record<string, boolean> = {}
      for (const inv of outstandingInvoices) {
        const k = rowKey(inv)
        next[k] = k in prev ? (prev[k] as boolean) : true
      }
      return next
    })
  }, [outstandingInvoices])

  const isRowSelected = (inv: OutstandingInvoice) => lineSelected[rowKey(inv)] !== false
  const isRealInvoice = (inv: OutstandingInvoice) => !inv.synthetic
  const realInvoices = outstandingInvoices.filter(isRealInvoice)
  /** Invoices and other open lines, excluding the synthetic on-account / advance line (rendered below with a gap). */
  const allocateRowsExcludingOa = outstandingInvoices.filter((i) => !isOaOrAdvanceRow(i))
  const onAccountAdvanceRow = outstandingInvoices.find((i) => isOaOrAdvanceRow(i)) ?? null
  const allInvoicesTicked =
    realInvoices.length > 0 && realInvoices.every((i) => isRowSelected(i))
  const someInvoicesTicked = realInvoices.some((i) => isRowSelected(i)) && !allInvoicesTicked
  const selectAllInvoicesRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (selectAllInvoicesRef.current) {
      selectAllInvoicesRef.current.indeterminate = someInvoicesTicked
    }
  }, [someInvoicesTicked, allInvoicesTicked, realInvoices.length])

  const handleCustomerSelectChange = (raw: string) => {
    if (!raw) {
      setSelectedCustomerId(null)
      setMemo('')
      setReferenceNumber('')
      setAllocations([])
      setTotalPaymentAmount(0)
      setLineSelected({})
      return
    }
    const id = Number(raw)
    if (!Number.isFinite(id)) {
      setSelectedCustomerId(null)
      setMemo('')
      setReferenceNumber('')
      setAllocations([])
      setTotalPaymentAmount(0)
      setLineSelected({})
      return
    }
    const c = customers.find((x) => Number(x.id) === id)
    if (!c) {
      setSelectedCustomerId(null)
      setMemo('')
      setReferenceNumber('')
      setAllocations([])
      setTotalPaymentAmount(0)
      setLineSelected({})
      return
    }
    setSelectedCustomerId(id)
    setMemo(buildCustomerPaymentMemo(c))
    setReferenceNumber((c.customer_number || '').trim())
  }

  useEffect(() => {
    if (prefillApplied.current || customers.length === 0) return
    const raw = searchParams.get('customer_id')
    if (!raw) return
    const id = Number(raw)
    if (!Number.isFinite(id)) return
    prefillApplied.current = true
    handleCustomerSelectChange(String(id))
  }, [customers.length])

  const selectedCustomer =
    selectedCustomerId != null
      ? customers.find((c) => Number(c.id) === Number(selectedCustomerId)) ?? null
      : null

  const toggleLine = (inv: OutstandingInvoice) => {
    const k = rowKey(inv)
    setLineSelected((prev) => {
      const was = prev[k] !== false
      const aid = allocInvoiceId(inv)
      if (was) {
        setAllocations((a) => {
          const n = a.map((x) =>
            x.invoice_id === aid ? { ...x, allocated_amount: 0 } : x
          )
          setTotalPaymentAmount(n.reduce((s, x) => s + x.allocated_amount, 0))
          return n
        })
      } else {
        const full = defaultAllocWhenSelected(inv)
        setAllocations((a) => {
          const n = a.map((x) =>
            x.invoice_id === aid ? { ...x, allocated_amount: full } : x
          )
          setTotalPaymentAmount(n.reduce((s, x) => s + x.allocated_amount, 0))
          return n
        })
      }
      return { ...prev, [k]: !was }
    })
  }

  const toggleSelectAllInvoices = () => {
    if (realInvoices.length === 0) return
    if (allInvoicesTicked) {
      setLineSelected((prev) => {
        const n = { ...prev }
        for (const i of realInvoices) n[rowKey(i)] = false
        return n
      })
      setAllocations((a) => {
        const n = a.map((x) => {
          const oa = outstandingInvoices.find(
            (inv) => allocInvoiceId(inv) === x.invoice_id
          )
          if (!oa || oa.synthetic) return x
          return { ...x, allocated_amount: 0 }
        })
        setTotalPaymentAmount(n.reduce((s, el) => s + el.allocated_amount, 0))
        return n
      })
    } else {
      setLineSelected((prev) => {
        const n = { ...prev }
        for (const i of realInvoices) n[rowKey(i)] = true
        return n
      })
      setAllocations((a) => {
        const n = a.map((x) => {
          const oa = outstandingInvoices.find(
            (inv) => allocInvoiceId(inv) === x.invoice_id
          )
          if (!oa || oa.synthetic) return x
          return { ...x, allocated_amount: defaultAllocWhenSelected(oa) }
        })
        setTotalPaymentAmount(
          n.reduce((s, el) => s + el.allocated_amount, 0)
        )
        return n
      })
    }
  }

  const handleAllocationChange = (invoiceId: number, amount: number) => {
    const invoice = outstandingInvoices.find(
      (inv) => (inv.synthetic && invoiceId === 0) || (!inv.synthetic && inv.id === invoiceId)
    )
    if (!invoice || !isRowSelected(invoice)) return
    const openInv = Number(invoice.balance_due) || 0
    const maxAmount = isOaOrAdvanceRow(invoice)
      ? 1e12
      : openInv
    const allocatedAmount = Math.min(Math.max(0, amount), maxAmount)
    setAllocations((prev) => {
      const updated = prev.map((alloc) =>
        alloc.invoice_id === invoiceId ? { ...alloc, allocated_amount: allocatedAmount } : alloc
      )
      const newTotal = updated.reduce((sum, a) => sum + a.allocated_amount, 0)
      setTotalPaymentAmount(newTotal)
      return updated
    })
  }

  const handleAutoAllocate = () => {
    let remaining = totalPaymentAmount
    const order = [...outstandingInvoices]
      .filter((inv) => isRowSelected(inv))
      .sort((a, b) => {
        if (a.synthetic && !b.synthetic) return 1
        if (!a.synthetic && b.synthetic) return -1
        return new Date(a.invoice_date).getTime() - new Date(b.invoice_date).getTime()
      })
    const byAid = new Map(
      order.map((inv) => {
        const aid = allocInvoiceId(inv)
        if (remaining <= 0) {
          return [aid, 0] as const
        }
        const balanceDue = Number(inv.balance_due) || 0
        const cap = isOaOrAdvanceRow(inv) ? remaining : Math.min(remaining, balanceDue)
        const amt = cap
        remaining -= amt
        return [aid, amt] as const
      })
    )
    setAllocations(
      outstandingInvoices.map((inv) => {
        const aid = allocInvoiceId(inv)
        if (!isRowSelected(inv)) {
          return { invoice_id: aid, discount_amount: 0, allocated_amount: 0 }
        }
        return {
          invoice_id: aid,
          discount_amount: 0,
          allocated_amount: byAid.get(aid) ?? 0,
        }
      })
    )
  }

  const handlePaymentAmountChange = (amount: number) => {
    setTotalPaymentAmount(amount)
    if (amount > 0) {
      let remaining = amount
      const order = [...outstandingInvoices]
        .filter((inv) => isRowSelected(inv))
        .sort((a, b) => {
          if (a.synthetic && !b.synthetic) return 1
          if (!a.synthetic && b.synthetic) return -1
          return new Date(a.invoice_date).getTime() - new Date(b.invoice_date).getTime()
        })
      const byAid = new Map(
        order.map((invoice) => {
          if (remaining <= 0) {
            return [allocInvoiceId(invoice), 0] as const
          }
          const balanceDue = Number(invoice.balance_due) || 0
          const take = isOaOrAdvanceRow(invoice) ? remaining : Math.min(remaining, balanceDue)
          const allocatedAmount = take
          remaining -= allocatedAmount
          return [allocInvoiceId(invoice), allocatedAmount] as const
        })
      )
      setAllocations(
        outstandingInvoices.map((inv) => {
          const aid = allocInvoiceId(inv)
          if (!isRowSelected(inv)) {
            return { invoice_id: aid, discount_amount: 0, allocated_amount: 0 }
          }
          return {
            invoice_id: aid,
            discount_amount: 0,
            allocated_amount: byAid.get(aid) ?? 0,
          }
        })
      )
    }
  }

  const handleCreateCustomer = async (e: React.FormEvent) => {
    e.preventDefault()
    const name = newDisplayName.trim()
    if (!name) {
      setError('Enter a name for the new customer.')
      return
    }
    setCreatingCustomer(true)
    setError('')
    try {
      const res = await api.post('/customers/', {
        display_name: name,
        phone: newPhone.trim() || null,
        email: newEmail.trim() || null,
        is_active: true,
      })
      const created = normalizeCustomersFromApi([res.data])[0]
      if (!created) {
        setError('Could not read new customer from server response.')
        return
      }
      setCustomers((prev) => (prev.some((c) => c.id === created.id) ? prev : [created, ...prev]))
      setSelectedCustomerId(created.id)
      setMemo(buildCustomerPaymentMemo(created))
      setReferenceNumber((created.customer_number || '').trim())
      setNewDisplayName('')
      setNewPhone('')
      setNewEmail('')
      setShowNewCustomer(false)
    } catch (err: unknown) {
      const d = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setError(typeof d === 'string' ? d : 'Could not create customer. Try again.')
    } finally {
      setCreatingCustomer(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setSubmitting(true)

    if (!selectedCustomerId) {
      setError('Please select a customer')
      setSubmitting(false)
      return
    }
    if (totalPaymentAmount <= 0) {
      setError('Payment amount must be greater than 0')
      setSubmitting(false)
      return
    }
    const validAllocations = allocations.filter((a) => a.allocated_amount > 0)
    if (validAllocations.length === 0) {
      setError('Allocate the payment to at least one line (invoice or on-account / advance).')
      setSubmitting(false)
      return
    }
    const totalAllocated = validAllocations.reduce((sum, a) => sum + a.allocated_amount, 0)
    if (Math.abs(totalAllocated - totalPaymentAmount) > 0.01) {
      setError(
        `Total allocation (${formatNumber(totalAllocated)}) must equal payment amount (${formatNumber(totalPaymentAmount)})`
      )
      setSubmitting(false)
      return
    }

    try {
      const response = await api.post('/payments/received', {
        customer_id: selectedCustomerId,
        payment_date: paymentDate,
        payment_method: paymentMethod,
        amount: totalPaymentAmount,
        reference_number: referenceNumber || null,
        memo: memo || null,
        allocations: validAllocations,
      })
      if (response.status === 201 || response.status === 200) {
        alert('Payment recorded successfully!')
        router.push('/payments/received')
      }
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
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-600" />
      </div>
    )
  }

  return (
    <div className="flex h-screen bg-gray-100 page-with-sidebar">
      <Sidebar />
      <div className="flex-1 overflow-auto">
        <div className="app-scroll-pad max-w-5xl mx-auto">
          <div className="mb-6">
            <Link
              href="/payments/received"
              className="inline-flex items-center text-sm font-medium text-gray-600 hover:text-gray-900 mb-4"
            >
              <ArrowLeft className="h-4 w-4 mr-1" />
              Back to Payments Received
            </Link>
            <h1 className="text-3xl font-bold text-gray-900">Record payment received</h1>
            <p className="text-gray-600 mt-1 max-w-3xl">
              Apply cash or transfer to <strong>open invoices</strong>, to{' '}
              <strong>on-account A/R</strong> (e.g. opening / not on an invoice), or record a{' '}
              <strong>customer advance (prepayment)</strong> that appears as a credit on the
              customer balance until invoiced.
            </p>
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
                  <label className="block text-sm font-medium text-gray-700 mb-1">Customer *</label>
                  <select
                    id="payment-received-customer"
                    name="customer_id"
                    value={selectedCustomerId != null ? String(selectedCustomerId) : ''}
                    onChange={(e) => handleCustomerSelectChange(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-green-500 bg-white relative z-10"
                    required
                  >
                    <option value="">Select Customer</option>
                    {customers.map((customer) => (
                      <option key={customer.id} value={String(customer.id)}>
                        {customer.display_name ||
                          customer.company_name ||
                          customer.first_name ||
                          `Customer ${customer.customer_number || customer.id}`}
                      </option>
                    ))}
                  </select>
                  {!loading && customers.length === 0 ? (
                    <p className="mt-2 text-sm text-amber-700">
                      No customers returned from the server. Add customers under Customers or check API access.
                    </p>
                  ) : null}
                  <div className="mt-3 rounded-lg border border-dashed border-gray-300 bg-gray-50/80 p-3">
                    <button
                      type="button"
                      onClick={() => setShowNewCustomer((s) => !s)}
                      className="inline-flex items-center gap-1.5 text-sm font-medium text-green-800 hover:text-green-950"
                    >
                      <UserPlus className="h-4 w-4" />
                      {showNewCustomer ? 'Hide' : 'Add'} new customer and pay
                    </button>
                    {showNewCustomer && (
                      <form
                        onSubmit={handleCreateCustomer}
                        className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 border-t border-gray-200 pt-3"
                        autoComplete="off"
                      >
                        <div className="sm:col-span-2">
                          <label className="block text-xs font-medium text-gray-700 mb-0.5">
                            Display / business name <span className="text-red-500">*</span>
                          </label>
                          <input
                            value={newDisplayName}
                            onChange={(e) => setNewDisplayName(e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                            placeholder="e.g. ABC Ltd"
                            maxLength={200}
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-700 mb-0.5">Phone</label>
                          <input
                            value={newPhone}
                            onChange={(e) => setNewPhone(e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                            placeholder="Optional"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-700 mb-0.5">Email</label>
                          <input
                            type="email"
                            value={newEmail}
                            onChange={(e) => setNewEmail(e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                            placeholder="Optional"
                          />
                        </div>
                        <div className="sm:col-span-2">
                          <button
                            type="submit"
                            disabled={creatingCustomer}
                            className="px-3 py-1.5 text-sm font-medium bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50"
                          >
                            {creatingCustomer ? 'Creating…' : 'Create customer & select'}
                          </button>
                        </div>
                        <p className="text-xs text-gray-500 sm:col-span-2">
                          A customer account is always required to record a receipt. This creates a normal
                          customer, then you can post payment including advances on the line below.
                        </p>
                      </form>
                    )}
                  </div>
                  {selectedCustomer && (
                    <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700">
                      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
                        Customer details
                      </p>
                      <div className="space-y-1">
                        <p>
                          <span className="text-gray-500">Name:</span>{' '}
                          <span className="font-medium text-gray-900">
                            {(
                              selectedCustomer.display_name ||
                              selectedCustomer.company_name ||
                              selectedCustomer.first_name ||
                              '—'
                            ).trim() || '—'}
                          </span>
                        </p>
                        <p>
                          <span className="text-gray-500">Customer #:</span>{' '}
                          <span className="font-medium text-gray-900">
                            {selectedCustomer.customer_number || '—'}
                          </span>
                        </p>
                        {selectedCustomer.email?.trim() ? (
                          <p>
                            <span className="text-gray-500">Email:</span> {selectedCustomer.email.trim()}
                          </p>
                        ) : null}
                        {selectedCustomer.phone?.trim() ? (
                          <p>
                            <span className="text-gray-500">Phone:</span> {selectedCustomer.phone.trim()}
                          </p>
                        ) : null}
                        {selectedCustomer.bank_name || selectedCustomer.bank_account_number ? (
                          <p>
                            <span className="text-gray-500">Bank:</span>{' '}
                            {[
                              selectedCustomer.bank_name,
                              selectedCustomer.bank_branch,
                              selectedCustomer.bank_account_number
                                ? `Acct ${selectedCustomer.bank_account_number}`
                                : '',
                              selectedCustomer.bank_routing_number
                                ? `Routing ${selectedCustomer.bank_routing_number}`
                                : '',
                            ]
                              .filter(Boolean)
                              .join(' · ')}
                          </p>
                        ) : null}
                        <ContactArApBalances
                          role="customer"
                          openingBalance={selectedCustomer.opening_balance}
                          openingBalanceDate={selectedCustomer.opening_balance_date}
                          currentBalance={selectedCustomer.current_balance}
                          currencySymbol={currencySymbol}
                        />
                      </div>
                    </div>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Payment Date *
                  </label>
                  <input
                    type="date"
                    value={paymentDate}
                    onChange={(e) => setPaymentDate(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-green-500"
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
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-green-500"
                    required
                  >
                    <option value="cash">Cash</option>
                    <option value="check">Check</option>
                    <option value="credit_card">Credit Card</option>
                    <option value="debit_card">Debit Card</option>
                    <option value="bank_transfer">Bank Transfer</option>
                    <option value="ach">ACH</option>
                    <option value="wire_transfer">Wire Transfer</option>
                    <option value="mobile_payment">Mobile Payment</option>
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
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-green-500"
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
                    className={AMOUNT_EDITABLE_FULL_GREEN_CLASS}
                    required
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Memo</label>
                  <textarea
                    value={memo}
                    onChange={(e) => setMemo(e.target.value)}
                    rows={4}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-green-500 text-sm"
                    placeholder="Filled from customer record when you select a customer; you can edit."
                  />
                </div>
              </div>

              {selectedCustomerId && outstandingInvoices.length > 0 && (
                <div className="mt-6">
                  <div className="grid grid-cols-1 items-stretch gap-6 lg:grid-cols-[20rem_minmax(0,1fr)]">
                    <aside
                      className="flex min-h-0 w-full min-w-0 flex-col rounded-lg border border-gray-200 bg-gray-50/80 p-3 sm:p-4"
                      aria-label="Include lines in this payment"
                    >
                      <div className="flex shrink-0 items-start justify-between gap-2 border-b border-gray-200 pb-2.5">
                        <h3 className="text-sm font-semibold text-gray-900 pr-1">
                          Include in payment
                        </h3>
                        {realInvoices.length > 0 ? (
                          <label
                            className="flex cursor-pointer items-center gap-1.5 shrink-0 text-xs font-medium text-gray-800"
                            title="Toggles every invoice (not the on-account row)"
                          >
                            <input
                              ref={selectAllInvoicesRef}
                              type="checkbox"
                              checked={allInvoicesTicked}
                              onChange={toggleSelectAllInvoices}
                              className="h-4 w-4 rounded border-2 border-gray-400 text-green-600 focus:ring-green-500/80"
                            />
                            <span className="whitespace-nowrap leading-tight sm:text-sm">
                              Select all invoices
                            </span>
                          </label>
                        ) : null}
                      </div>
                      <p className="mt-2 mb-2.5 shrink-0 text-xs text-gray-500">
                        When you tick a line, its open balance is filled in; you can lower the
                        amount for a partial payment. Use <strong>Allocate</strong> in the table
                        to enter amounts. On-account / prepayment is listed <strong>under</strong>{' '}
                        the invoice numbers.
                      </p>
                      <ul
                        className="min-h-0 flex-1 list-none space-y-0 overflow-y-auto rounded border border-gray-200 bg-white divide-y divide-gray-200"
                        role="list"
                      >
                        {allocateRowsExcludingOa.map((inv) => {
                          const k = rowKey(inv)
                          const sel = isRowSelected(inv)
                          const isInv = isRealInvoice(inv)
                          return (
                            <li key={k} role="listitem" className="w-full">
                              <label
                                className={[
                                  'grid w-full cursor-pointer grid-cols-[1.25rem_1fr_auto] items-center gap-2.5 px-2.5 py-3 sm:px-3 text-sm',
                                  sel ? 'bg-white' : 'bg-gray-50/50 opacity-80',
                                ].join(' ')}
                              >
                                <div className="flex items-center justify-center self-center">
                                  <input
                                    type="checkbox"
                                    checked={sel}
                                    onChange={() => {
                                      toggleLine(inv)
                                    }}
                                    className="h-4 w-4 rounded border-2 border-gray-400 text-green-600 focus:ring-green-500/80"
                                    aria-label={
                                      isInv
                                        ? `Include invoice ${inv.invoice_number}`
                                        : 'Include line'
                                    }
                                  />
                                </div>
                                <p className="min-w-0 text-left text-sm font-medium text-gray-900">
                                  {isInv ? inv.invoice_number : 'Open item'}
                                </p>
                                <p className="shrink-0 text-right text-xs text-gray-600 tabular-nums sm:text-sm">
                                  {currencySymbol}
                                  {formatNumber(Number(inv.balance_due) || 0)}
                                </p>
                              </label>
                            </li>
                          )
                        })}
                      </ul>
                      {onAccountAdvanceRow ? (
                        <div
                          key="oa-aside"
                          className="mt-0 shrink-0 border-t-2 border-amber-200/90 bg-amber-50/40"
                        >
                          <label
                            className={[
                              'grid w-full cursor-pointer grid-cols-[1.25rem_1fr_auto] items-center gap-2.5 px-2.5 py-3 sm:px-3 text-sm',
                              isRowSelected(onAccountAdvanceRow)
                                ? 'bg-white/90'
                                : 'bg-amber-50/60 opacity-90',
                            ].join(' ')}
                          >
                            <div className="flex items-center justify-center self-center">
                              <input
                                type="checkbox"
                                checked={isRowSelected(onAccountAdvanceRow)}
                                onChange={() => {
                                  toggleLine(onAccountAdvanceRow)
                                }}
                                className="h-4 w-4 rounded border-2 border-amber-500 text-green-600 focus:ring-amber-500/50"
                                aria-label="Include on-account and customer advance in this payment"
                              />
                            </div>
                            <p className="min-w-0 text-left text-sm font-semibold text-amber-950">
                              On-account / advance
                            </p>
                            <p className="shrink-0 text-right text-sm font-medium text-amber-900/90 tabular-nums">
                              {currencySymbol}
                              {formatNumber(Number(onAccountAdvanceRow.balance_due) || 0)}
                            </p>
                          </label>
                        </div>
                      ) : null}
                    </aside>
                    <div className="min-h-0 min-w-0">
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-lg font-semibold">Allocate payment</h3>
                    <button
                      type="button"
                      onClick={handleAutoAllocate}
                      className="text-sm text-blue-600 hover:text-blue-800"
                    >
                      Auto-allocate (FIFO)
                    </button>
                  </div>
                  <div className="overflow-x-auto overflow-hidden rounded-lg border border-gray-200">
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
                        {allocateRowsExcludingOa.map((invoice) => {
                          const aid = allocInvoiceId(invoice)
                          const allocation = allocations.find((a) => a.invoice_id === aid)
                          const allocatedAmount = allocation?.allocated_amount || 0
                          const canEdit = isRowSelected(invoice)
                          return (
                            <tr
                              key={invoice.synthetic ? `syn-${invoice.customer_id}` : invoice.id}
                              className={[
                                'align-middle',
                                allocatedAmount > 0 && canEdit ? 'bg-green-50' : '',
                                !canEdit ? 'bg-gray-50/80 opacity-60' : '',
                              ]
                                .filter(Boolean)
                                .join(' ')}
                            >
                              <td className="px-4 py-3 text-sm font-medium text-gray-900 max-w-[16rem]">
                                {invoice.invoice_number}
                                {invoice.synthetic && !isOaOrAdvanceRow(invoice) ? (
                                  <span className="ml-1 text-xs font-normal text-gray-500">
                                    (A/R not on an invoice)
                                  </span>
                                ) : null}
                                {!invoice.synthetic &&
                                invoice.days_overdue &&
                                invoice.days_overdue > 0 ? (
                                  <span className="ml-2 text-xs text-red-600">
                                    ({invoice.days_overdue}d overdue)
                                  </span>
                                ) : null}
                              </td>
                              <td className="px-4 py-3 text-sm text-gray-600">
                                {formatDateOnly(invoice.invoice_date)}
                              </td>
                              <td className="px-4 py-3 text-sm text-gray-600">
                                {invoice.due_date
                                  ? formatDateOnly(invoice.due_date)
                                  : '—'}
                              </td>
                              <td className="px-4 py-3 text-sm text-right text-gray-900">
                                {invoice.synthetic ? (
                                  '—'
                                ) : (
                                  <>
                                    {currencySymbol}
                                    {formatNumber(Number(invoice.total_amount ?? invoice.total) || 0)}
                                  </>
                                )}
                              </td>
                              <td className="px-4 py-3 text-sm text-right text-gray-600">
                                {invoice.synthetic ? (
                                  '—'
                                ) : (
                                  <>
                                    {currencySymbol}
                                    {formatNumber(Number(invoice.amount_paid) || 0)}
                                  </>
                                )}
                              </td>
                              <td className="px-4 py-3 text-sm text-right font-medium text-gray-900">
                                {currencySymbol}
                                {formatNumber(Number(invoice.balance_due) || 0)}
                              </td>
                              <td className="px-4 py-3 text-sm text-right">
                                <input
                                  type="number"
                                  step="0.01"
                                  min="0"
                                  max={Number(invoice.balance_due) || 0}
                                  value={canEdit ? allocatedAmount : 0}
                                  disabled={!canEdit}
                                  onChange={(e) =>
                                    handleAllocationChange(aid, Number(e.target.value))
                                  }
                                  className={AMOUNT_ALLOCATE_GREEN_CLASS + (!canEdit ? ' cursor-not-allowed' : '')}
                                />
                              </td>
                            </tr>
                          )
                        })}
                        {onAccountAdvanceRow
                          ? (() => {
                              const invoice = onAccountAdvanceRow
                              const aid = allocInvoiceId(invoice)
                              const allocation = allocations.find((a) => a.invoice_id === aid)
                              const allocatedAmount = allocation?.allocated_amount || 0
                              const canEdit = isRowSelected(invoice)
                              return (
                                <tr
                                  key="on-account-advance"
                                  className={[
                                    'align-middle border-t-2 border-amber-300/80',
                                    !canEdit
                                      ? 'bg-amber-50/50 opacity-60'
                                      : allocatedAmount > 0
                                        ? 'bg-green-50'
                                        : 'bg-amber-50/30',
                                  ].join(' ')}
                                >
                                  <td
                                    className="px-4 py-3 text-sm text-gray-400 max-w-[16rem]"
                                    title="Same line as On-account / advance in the list on the left (not an invoice number)."
                                    aria-label="On-account or prepayment (see left panel)"
                                  >
                                    —
                                  </td>
                                  <td className="px-4 py-3 text-sm text-gray-600">
                                    {formatDateOnly(invoice.invoice_date)}
                                  </td>
                                  <td className="px-4 py-3 text-sm text-gray-500">—</td>
                                  <td className="px-4 py-3 text-right text-sm text-gray-500">—</td>
                                  <td className="px-4 py-3 text-right text-sm text-gray-500">—</td>
                                  <td className="px-4 py-3 text-right text-sm font-medium text-amber-950">
                                    {currencySymbol}
                                    {formatNumber(Number(invoice.balance_due) || 0)}
                                  </td>
                                  <td className="px-4 py-3 text-sm text-right">
                                    <input
                                      type="number"
                                      step="0.01"
                                      min="0"
                                      value={canEdit ? allocatedAmount : 0}
                                      disabled={!canEdit}
                                      onChange={(e) =>
                                        handleAllocationChange(aid, Number(e.target.value))
                                      }
                                      className={
                                        AMOUNT_ALLOCATE_GREEN_CLASS +
                                        (!canEdit ? ' cursor-not-allowed' : '')
                                      }
                                    />
                                  </td>
                                </tr>
                              )
                            })()
                          : null}
                      </tbody>
                    </table>
                  </div>
                    </div>
                  <div className="col-span-full flex flex-col gap-0 rounded-b-lg border border-gray-200 bg-gray-50 sm:flex-row sm:items-center sm:justify-end sm:gap-4 sm:pl-4 sm:pr-4">
                    <span className="px-4 py-3 text-sm font-medium text-gray-900 sm:py-2.5 sm:pr-0 sm:pl-0 sm:text-right">
                      Total allocated:
                    </span>
                    <span className="px-4 pb-3 text-sm font-bold text-gray-900 sm:py-2.5 sm:pl-0 sm:pr-0 sm:text-right tabular-nums">
                      {currencySymbol}
                      {formatNumber(allocations.reduce((sum, a) => sum + a.allocated_amount, 0))}
                    </span>
                  </div>
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-3 pt-4 border-t border-gray-100">
                <Link
                  href="/payments/received"
                  className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50 inline-flex items-center justify-center"
                >
                  Cancel
                </Link>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50"
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

export default function NewPaymentReceivedPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-gray-100">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-600" />
        </div>
      }
    >
      <RecordPaymentReceivedInner />
    </Suspense>
  )
}
