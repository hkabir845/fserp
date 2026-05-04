'use client'

import { useEffect, useState } from 'react'
import { useToast } from '@/components/Toast'
import api from '@/lib/api'
import { formatCurrency } from '@/utils/currency'
import { Plus, Edit2, Trash2, X, DollarSign, FileText, Search } from 'lucide-react'
import { safeLogError } from '@/utils/connectionError'
import { formatDate, formatDateOnly } from '@/utils/date'
import { AMOUNT_SUBSCRIPTION_INPUT_CLASS } from '@/utils/amountFieldStyles'

interface SubscriptionInvoice {
  id: number
  payment_number: string
  company_id: number
  company_name: string
  subscription_id: number
  amount: number
  currency: string
  billing_plan_code?: string
  billing_cycle?: string
  status: string
  due_date: string
  paid_date: string | null
  period_start: string
  period_end: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

interface Company {
  id: number
  name: string
  currency?: string
  billing_plan_code?: string
}

interface SubscriptionLine {
  id: number
  company_id: number
  plan_id: number
  plan_code?: string
  plan_name?: string
  label?: string
}

interface BillingPlanCatalog {
  code: string
  name: string
  tagline?: string
  suggested_monthly: number
  suggested_yearly: number
  default_cycle: string
}

type SubscriptionLedgerProps = { initialCompanyId?: number }

export default function SubscriptionLedger({ initialCompanyId }: SubscriptionLedgerProps = {}) {
  const toast = useToast()
  const [invoices, setInvoices] = useState<SubscriptionInvoice[]>([])
  const [companies, setCompanies] = useState<Company[]>([])
  const [subscriptions, setSubscriptions] = useState<SubscriptionLine[]>([])
  const [billingPlans, setBillingPlans] = useState<BillingPlanCatalog[]>([])
  const [loading, setLoading] = useState(true)
  const [showInvoiceModal, setShowInvoiceModal] = useState(false)
  const [showEditModal, setShowEditModal] = useState(false)
  const [editingInvoice, setEditingInvoice] = useState<SubscriptionInvoice | null>(null)
  
  // Filters
  const [selectedCompany, setSelectedCompany] = useState<number | ''>('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('')
  const [searchTerm, setSearchTerm] = useState('')
  
  // Invoice form
  const [invoiceFormData, setInvoiceFormData] = useState({
    company_id: '',
    subscription_id: '',
    amount: '',
    currency: 'BDT',
    billing_cycle: 'monthly',
    period_start: '',
    period_end: '',
    due_date: '',
    discount_percent: '0',
    discount_amount: '0',
    discount_reason: '',
    notes: '',
    upfront_payment: false,
    billing_plan_code: ''
  })

  useEffect(() => {
    if (initialCompanyId != null && Number.isFinite(initialCompanyId)) {
      setSelectedCompany(initialCompanyId)
    }
  }, [initialCompanyId])

  useEffect(() => {
    fetchInvoices()
    fetchCompanies()
  }, [selectedCompany, startDate, endDate, statusFilter])

  useEffect(() => {
    const loadPlans = async () => {
      try {
        const { data } = await api.get('/admin/billing-plans')
        if (Array.isArray(data)) setBillingPlans(data)
      } catch (e) {
        safeLogError('billing-plans', e)
      }
    }
    loadPlans()
  }, [])

  const fetchInvoices = async () => {
    try {
      setLoading(true)
      const params: any = {}
      if (selectedCompany) params.company_id = selectedCompany
      if (startDate) params.start_date = startDate
      if (endDate) params.end_date = endDate
      if (statusFilter) params.status = statusFilter

      const response = await api.get('/subscription-ledger/invoices', { params })
      if (response.data) {
        setInvoices(Array.isArray(response.data) ? response.data : [])
      } else {
        setInvoices([])
      }
    } catch (error: any) {
      safeLogError('Error fetching invoices:', error)
      const errorMsg = error.response?.data?.detail || error.response?.data?.message || 'Failed to load subscription invoices'
      toast.error(errorMsg)
      setInvoices([])
    } finally {
      setLoading(false)
    }
  }

  const fetchCompanies = async () => {
    try {
      const response = await api.get('/admin/companies')
      if (response.data) {
        setCompanies(response.data)
      }
    } catch (error: any) {
      safeLogError('Error fetching companies:', error)
    }
  }

  const fetchSubscriptions = async (companyId: number) => {
    try {
      const response = await api.get(`/admin/companies/${companyId}/subscription`)
      const data = response.data
      if (!data) {
        setSubscriptions([])
        return
      }
      const rows: SubscriptionLine[] = Array.isArray(data.subscriptions) ? data.subscriptions : []
      if (rows.length > 0) {
        setSubscriptions(rows)
        return
      }
      if (data.subscription && data.subscription.id) {
        setSubscriptions([data.subscription as SubscriptionLine])
        return
      }
      setSubscriptions([
        {
          id: companyId,
          company_id: companyId,
          plan_id: companyId,
          plan_code: data.billing_plan_code,
          plan_name: data.billing_plan_name,
          label: `${data.company_name || 'Tenant'} — ${data.billing_plan_name || 'Subscription'}`,
        },
      ])
    } catch (error: unknown) {
      safeLogError('Error fetching subscription:', error)
      setSubscriptions([
        {
          id: companyId,
          company_id: companyId,
          plan_id: companyId,
          label: `Tenant #${companyId} (subscription context)`,
        },
      ])
    }
  }

  const handleCreateInvoice = () => {
    setInvoiceFormData({
      company_id: '',
      subscription_id: '',
      amount: '',
      currency: 'BDT',
      billing_cycle: 'monthly',
      period_start: '',
      period_end: '',
      due_date: '',
      discount_percent: '0',
      discount_amount: '0',
      discount_reason: '',
      notes: '',
      upfront_payment: false,
      billing_plan_code: ''
    })
    setShowInvoiceModal(true)
  }

  const calculateDates = (billingCycle: string, startDate: string) => {
    if (!startDate) return { period_end: '', due_date: '' }
    
    const start = new Date(startDate)
    let end = new Date(start)
    let due = new Date(start)
    
    switch (billingCycle) {
      case 'monthly':
        end.setMonth(end.getMonth() + 1)
        due.setDate(due.getDate() + 7) // Due 7 days after start
        break
      case 'quarterly':
        end.setMonth(end.getMonth() + 3)
        due.setDate(due.getDate() + 7)
        break
      case 'half_yearly':
        end.setMonth(end.getMonth() + 6)
        due.setDate(due.getDate() + 7)
        break
      case 'yearly':
        end.setFullYear(end.getFullYear() + 1)
        due.setDate(due.getDate() + 7)
        break
    }
    
    return {
      period_end: end.toISOString().split('T')[0],
      due_date: due.toISOString().split('T')[0]
    }
  }

  const handleBillingCycleChange = (cycle: string) => {
    setInvoiceFormData(prev => {
      const dates = calculateDates(cycle, prev.period_start)
      return {
        ...prev,
        billing_cycle: cycle,
        period_end: dates.period_end,
        due_date: dates.due_date
      }
    })
  }

  const handlePeriodStartChange = (date: string) => {
    setInvoiceFormData(prev => {
      const dates = calculateDates(prev.billing_cycle, date)
      return {
        ...prev,
        period_start: date,
        period_end: dates.period_end,
        due_date: dates.due_date
      }
    })
  }

  const handleCompanyChange = async (companyId: string) => {
    if (!companyId) {
      setSubscriptions([])
      setInvoiceFormData((prev) => ({
        ...prev,
        company_id: '',
        subscription_id: '',
        billing_plan_code: '',
      }))
      return
    }
    const id = parseInt(companyId, 10)
    const co = companies.find((c) => c.id === id)
    await fetchSubscriptions(id)
    setInvoiceFormData((prev) => ({
      ...prev,
      company_id: companyId,
      subscription_id: String(id),
      billing_plan_code: (co?.billing_plan_code || '').toLowerCase(),
      currency: co?.currency ? co.currency.toUpperCase().slice(0, 3) : prev.currency,
    }))
  }

  const handleBillingPlanFieldChange = (code: string) => {
    const plan = billingPlans.find((p) => p.code === code)
    setInvoiceFormData((prev) => {
      const cycle = prev.billing_cycle || plan?.default_cycle || 'monthly'
      const useYear = cycle === 'yearly'
      const suggested =
        plan && (useYear ? plan.suggested_yearly : plan.suggested_monthly) > 0
          ? String(useYear ? plan.suggested_yearly : plan.suggested_monthly)
          : prev.amount
      return {
        ...prev,
        billing_plan_code: code,
        amount: suggested,
      }
    })
  }


  const handleSubmitInvoice = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (
      !invoiceFormData.company_id ||
      !invoiceFormData.subscription_id ||
      !invoiceFormData.amount ||
      !invoiceFormData.billing_plan_code
    ) {
      toast.error('Company, tenant subscription, billing plan, and amount are required')
      return
    }

    const cid = parseInt(invoiceFormData.company_id, 10)
    const sid = parseInt(invoiceFormData.subscription_id, 10)
    if (sid !== cid) {
      toast.error('Subscription must match the selected company')
      return
    }

    try {
      const invoiceData: Record<string, unknown> = {
        company_id: cid,
        subscription_id: sid,
        amount: parseFloat(invoiceFormData.amount),
        currency: invoiceFormData.currency,
        billing_plan_code: invoiceFormData.billing_plan_code,
        billing_cycle: invoiceFormData.billing_cycle,
        period_start: invoiceFormData.period_start,
        period_end: invoiceFormData.period_end,
        due_date: invoiceFormData.due_date,
      }
      
      // Only include discount fields if they have values
      const discountPercent = parseFloat(invoiceFormData.discount_percent) || 0
      const discountAmount = parseFloat(invoiceFormData.discount_amount) || 0
      
      if (discountPercent > 0) {
        invoiceData.discount_percent = discountPercent
      }
      if (discountAmount > 0) {
        invoiceData.discount_amount = discountAmount
      }
      if (invoiceFormData.discount_reason) {
        invoiceData.discount_reason = invoiceFormData.discount_reason
      }
      if (invoiceFormData.notes) {
        invoiceData.notes = invoiceFormData.notes
      }

      await api.post('/subscription-ledger/invoices', invoiceData)
      toast.success('Subscription invoice created successfully!')
      setShowInvoiceModal(false)
      await fetchInvoices()
    } catch (error: any) {
      const errorMsg = error.response?.data?.detail || error.response?.data?.message || 'Failed to create invoice'
      toast.error(errorMsg)
      safeLogError('Invoice error:', error)
    }
  }

  const [editFormData, setEditFormData] = useState({
    amount: '',
    status: '',
    due_date: '',
    paid_date: '',
    notes: '',
    billing_plan_code: '',
    currency: 'BDT',
    period_start: '',
    period_end: '',
  })

  const handleUpdateInvoice = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingInvoice) return

    try {
      const updateData: any = {}
      if (editFormData.amount) updateData.amount = parseFloat(editFormData.amount)
      if (editFormData.status) updateData.status = editFormData.status
      if (editFormData.due_date) updateData.due_date = editFormData.due_date
      if (editFormData.paid_date) updateData.paid_date = editFormData.paid_date
      if (editFormData.notes !== undefined) updateData.notes = editFormData.notes
      if (editFormData.billing_plan_code) updateData.billing_plan_code = editFormData.billing_plan_code
      if (editFormData.currency) updateData.currency = editFormData.currency
      if (editFormData.period_start) updateData.period_start = editFormData.period_start
      if (editFormData.period_end) updateData.period_end = editFormData.period_end

      await api.put(`/subscription-ledger/invoices/${editingInvoice.id}`, updateData)
      toast.success('Invoice updated successfully!')
      setShowEditModal(false)
      setEditingInvoice(null)
      await fetchInvoices()
    } catch (error: any) {
      const errorMsg = error.response?.data?.detail || error.response?.data?.message || 'Failed to update invoice'
      toast.error(errorMsg)
    }
  }

  const handleEditClick = (invoice: SubscriptionInvoice) => {
    setEditingInvoice(invoice)
    setEditFormData({
      amount: invoice.amount.toString(),
      status: invoice.status,
      due_date: invoice.due_date,
      paid_date: invoice.paid_date || '',
      notes: invoice.notes || '',
      billing_plan_code: (invoice.billing_plan_code || '').toLowerCase(),
      currency: invoice.currency || 'BDT',
      period_start: invoice.period_start ? invoice.period_start.split('T')[0] : '',
      period_end: invoice.period_end ? invoice.period_end.split('T')[0] : '',
    })
    setShowEditModal(true)
  }

  const handleDeleteInvoice = async (invoiceId: number) => {
    if (!confirm('Are you sure you want to delete this invoice?')) {
      return
    }

    try {
      await api.delete(`/subscription-ledger/invoices/${invoiceId}`)
      toast.success('Invoice deleted successfully!')
      await fetchInvoices()
    } catch (error: any) {
      const errorMsg = error.response?.data?.detail || error.response?.data?.message || 'Failed to delete invoice'
      toast.error(errorMsg)
    }
  }

  const handleMarkAsPaid = async (invoiceId: number) => {
    try {
      await api.put(`/subscription-ledger/invoices/${invoiceId}`, {
        status: 'paid',
        paid_date: new Date().toISOString().split('T')[0]
      })
      toast.success('Invoice marked as paid!')
      await fetchInvoices()
    } catch (error: any) {
      const errorMsg = error.response?.data?.detail || error.response?.data?.message || 'Failed to update invoice'
      toast.error(errorMsg)
    }
  }

  // Filter invoices by search term
  const filteredInvoices = invoices.filter(invoice => {
    if (!searchTerm) return true
    const search = searchTerm.toLowerCase()
    return (
      invoice.payment_number.toLowerCase().includes(search) ||
      invoice.company_name.toLowerCase().includes(search) ||
      invoice.amount.toString().includes(search) ||
      (invoice.billing_plan_code || '').toLowerCase().includes(search)
    )
  })

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'paid':
        return 'bg-green-100 text-green-800'
      case 'pending':
        return 'bg-yellow-100 text-yellow-800'
      case 'failed':
      case 'overdue':
        return 'bg-red-100 text-red-800'
      case 'void':
        return 'bg-slate-200 text-slate-700'
      default:
        return 'bg-gray-100 text-gray-800'
    }
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold text-gray-900 flex items-center space-x-2">
            <FileText className="h-6 w-6 text-blue-600" />
            <span>Subscription Ledger</span>
          </h2>
          <p className="text-sm text-gray-600 mt-1">Manage subscription invoices and payments for all tenants</p>
        </div>
        <button
          onClick={handleCreateInvoice}
          className="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          <Plus className="h-5 w-5" />
          <span>Create Invoice</span>
        </button>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-lg shadow p-4 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Company</label>
            <select
              value={selectedCompany}
              onChange={(e) => setSelectedCompany(e.target.value ? parseInt(e.target.value) : '')}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="">All Companies</option>
              {companies.map((company) => (
                <option key={company.id} value={company.id}>
                  {company.name}
                </option>
              ))}
            </select>
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Start Date</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">End Date</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="">All Status</option>
              <option value="pending">Pending</option>
              <option value="paid">Paid</option>
              <option value="failed">Failed</option>
            </select>
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Search</label>
            <div className="relative">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search invoices..."
                className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Invoices Table */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        {loading ? (
          <div className="text-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
            <p className="text-gray-600 mt-4">Loading invoices...</p>
          </div>
        ) : filteredInvoices.length === 0 ? (
          <div className="text-center py-12">
            <FileText className="h-12 w-12 text-gray-400 mx-auto mb-4" />
            <p className="text-gray-600">No invoices found. Create your first subscription invoice.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Invoice #</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Company</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Plan</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Amount</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Due Date</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Period</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Created</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {filteredInvoices.map((invoice) => (
                  <tr key={invoice.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm font-medium text-gray-900">{invoice.payment_number}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-900">{invoice.company_name}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-900 capitalize">
                        {(invoice.billing_plan_code || '—').replace(/_/g, ' ')}
                      </div>
                      {invoice.billing_cycle && (
                        <div className="text-xs text-gray-500 capitalize">{invoice.billing_cycle.replace(/_/g, ' ')}</div>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm font-semibold text-gray-900">
                        {formatCurrency(invoice.amount, invoice.currency || 'BDT')}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${getStatusColor(invoice.status)}`}>
                        {invoice.status.toUpperCase()}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {formatDateOnly(invoice.due_date)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {formatDateOnly(invoice.period_start)}
                      {invoice.period_end ? ` – ${formatDateOnly(invoice.period_end)}` : ''}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {formatDate(invoice.created_at, true)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <div className="flex items-center justify-end space-x-2">
                        {invoice.status === 'pending' && (
                          <button
                            onClick={() => handleMarkAsPaid(invoice.id)}
                            className="p-1.5 text-green-600 hover:text-green-900 hover:bg-green-50 rounded transition-colors"
                            title="Mark as Paid"
                          >
                            <DollarSign className="h-4 w-4" />
                          </button>
                        )}
                        <button
                          onClick={() => handleEditClick(invoice)}
                          className="p-1.5 text-blue-600 hover:text-blue-900 hover:bg-blue-50 rounded transition-colors"
                          title="Edit Invoice"
                        >
                          <Edit2 className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => handleDeleteInvoice(invoice.id)}
                          className="p-1.5 text-red-600 hover:text-red-900 hover:bg-red-50 rounded transition-colors"
                          title="Delete Invoice"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Create Invoice Modal */}
      {showInvoiceModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-3xl w-full max-h-[90vh] overflow-y-auto">
            <div className="bg-gradient-to-r from-blue-600 to-blue-700 px-6 py-4 sticky top-0 z-10 flex items-center justify-between rounded-t-xl">
              <h2 className="text-2xl font-bold text-white flex items-center space-x-2">
                <FileText className="h-6 w-6" />
                <span>Create Subscription Invoice</span>
              </h2>
              <button
                onClick={() => setShowInvoiceModal(false)}
                className="p-2 hover:bg-white/20 rounded-full transition-colors"
              >
                <X className="h-5 w-5 text-white" />
              </button>
            </div>

            <form onSubmit={handleSubmitInvoice} className="p-6">
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Company <span className="text-red-500">*</span>
                    </label>
                    <select
                      required
                      value={invoiceFormData.company_id}
                      onChange={(e) => handleCompanyChange(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    >
                      <option value="">Select Company</option>
                      {companies.map((company) => (
                        <option key={company.id} value={company.id}>
                          {company.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Tenant subscription <span className="text-red-500">*</span>
                    </label>
                    <select
                      required
                      value={invoiceFormData.subscription_id}
                      onChange={(e) => setInvoiceFormData({ ...invoiceFormData, subscription_id: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      disabled={!invoiceFormData.company_id}
                    >
                      <option value="">Select tenant subscription</option>
                      {subscriptions.map((sub) => (
                        <option key={sub.id} value={sub.id}>
                          {sub.label || sub.plan_name || `Tenant subscription #${sub.id}`}
                        </option>
                      ))}
                    </select>
                    <p className="text-xs text-gray-500 mt-1">
                      One subscription line per tenant; this links the invoice to that company&apos;s SaaS billing context.
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Billing plan <span className="text-red-500">*</span>
                    </label>
                    <select
                      required
                      value={invoiceFormData.billing_plan_code}
                      onChange={(e) => handleBillingPlanFieldChange(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    >
                      <option value="">Select billing plan</option>
                      {billingPlans.map((p) => (
                        <option key={p.code} value={p.code}>
                          {p.name}
                          {p.suggested_monthly > 0
                            ? ` — from ${p.suggested_monthly}/${p.default_cycle === 'yearly' ? 'yr' : 'mo'}`
                            : ''}
                        </option>
                      ))}
                    </select>
                    <p className="text-xs text-gray-500 mt-1">
                      Plans are managed platform-wide. Amount below updates from the catalog when you pick a plan (you can override).
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Amount <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="number"
                      required
                      step="0.01"
                      value={invoiceFormData.amount}
                      onChange={(e) => setInvoiceFormData({ ...invoiceFormData, amount: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      placeholder="0.00"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Currency
                    </label>
                    <select
                      value={invoiceFormData.currency}
                      onChange={(e) => setInvoiceFormData({ ...invoiceFormData, currency: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    >
                      <option value="USD">USD</option>
                      <option value="BDT">BDT</option>
                      <option value="EUR">EUR</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Billing Cycle <span className="text-red-500">*</span>
                    </label>
                    <select
                      required
                      value={invoiceFormData.billing_cycle}
                      onChange={(e) => handleBillingCycleChange(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    >
                      <option value="monthly">Monthly</option>
                      <option value="quarterly">Quarterly</option>
                      <option value="half_yearly">Half Yearly (6 months)</option>
                      <option value="yearly">Yearly</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Period Start <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="date"
                      required
                      value={invoiceFormData.period_start}
                      onChange={(e) => handlePeriodStartChange(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Period End
                    </label>
                    <input
                      type="date"
                      value={invoiceFormData.period_end}
                      onChange={(e) => setInvoiceFormData({ ...invoiceFormData, period_end: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Due Date
                    </label>
                    <input
                      type="date"
                      value={invoiceFormData.due_date}
                      onChange={(e) => setInvoiceFormData({ ...invoiceFormData, due_date: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Discount (%)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      value={invoiceFormData.discount_percent}
                      onChange={(e) => setInvoiceFormData({ ...invoiceFormData, discount_percent: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      placeholder="0.00"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Discount Amount
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      value={invoiceFormData.discount_amount}
                      onChange={(e) => setInvoiceFormData({ ...invoiceFormData, discount_amount: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      placeholder="0.00"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Discount Reason
                    </label>
                    <input
                      type="text"
                      value={invoiceFormData.discount_reason}
                      onChange={(e) => setInvoiceFormData({ ...invoiceFormData, discount_reason: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      placeholder="e.g., Annual upfront payment"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Notes
                  </label>
                  <textarea
                    rows={3}
                    value={invoiceFormData.notes}
                    onChange={(e) => setInvoiceFormData({ ...invoiceFormData, notes: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="Additional notes..."
                  />
                </div>

                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                  <p className="text-sm text-blue-800">
                    <strong>Discount Rules:</strong> Annual upfront (15%), Half-yearly upfront (10%), Quarterly upfront (5%), Monthly (0%)
                  </p>
                </div>
              </div>

              <div className="flex items-center justify-end space-x-3 pt-6 border-t mt-6">
                <button
                  type="button"
                  onClick={() => setShowInvoiceModal(false)}
                  className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center space-x-2"
                >
                  <Plus className="h-4 w-4" />
                  <span>Create Invoice</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showEditModal && editingInvoice && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b">
              <h2 className="text-lg font-semibold text-gray-900">Edit invoice {editingInvoice.payment_number}</h2>
              <button
                type="button"
                onClick={() => {
                  setShowEditModal(false)
                  setEditingInvoice(null)
                }}
                className="p-2 rounded-full hover:bg-gray-100"
              >
                <X className="h-5 w-5 text-gray-600" />
              </button>
            </div>
            <form onSubmit={handleUpdateInvoice} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Billing plan</label>
                <select
                  value={editFormData.billing_plan_code}
                  onChange={(e) => setEditFormData({ ...editFormData, billing_plan_code: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                >
                  <option value="">— Unchanged / clear —</option>
                  {billingPlans.map((p) => (
                    <option key={p.code} value={p.code}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Amount</label>
                  <input
                    type="number"
                    step="0.01"
                    value={editFormData.amount}
                    onChange={(e) => setEditFormData({ ...editFormData, amount: e.target.value })}
                    className={AMOUNT_SUBSCRIPTION_INPUT_CLASS}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Currency</label>
                  <input
                    type="text"
                    maxLength={3}
                    value={editFormData.currency}
                    onChange={(e) => setEditFormData({ ...editFormData, currency: e.target.value.toUpperCase() })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
                <select
                  value={editFormData.status}
                  onChange={(e) => setEditFormData({ ...editFormData, status: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                >
                  <option value="pending">Pending</option>
                  <option value="paid">Paid</option>
                  <option value="overdue">Overdue</option>
                  <option value="void">Void</option>
                  <option value="failed">Failed</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Due date</label>
                  <input
                    type="date"
                    value={editFormData.due_date ? editFormData.due_date.split('T')[0] : ''}
                    onChange={(e) => setEditFormData({ ...editFormData, due_date: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Paid date</label>
                  <input
                    type="date"
                    value={editFormData.paid_date ? editFormData.paid_date.split('T')[0] : ''}
                    onChange={(e) => setEditFormData({ ...editFormData, paid_date: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Period start</label>
                  <input
                    type="date"
                    value={editFormData.period_start}
                    onChange={(e) => setEditFormData({ ...editFormData, period_start: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Period end</label>
                  <input
                    type="date"
                    value={editFormData.period_end}
                    onChange={(e) => setEditFormData({ ...editFormData, period_end: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                <textarea
                  rows={3}
                  value={editFormData.notes}
                  onChange={(e) => setEditFormData({ ...editFormData, notes: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowEditModal(false)
                    setEditingInvoice(null)
                  }}
                  className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200"
                >
                  Cancel
                </button>
                <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
                  Save changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

