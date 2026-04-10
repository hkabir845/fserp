'use client'

import { useState, useEffect } from 'react'
import { Plus, Edit2, Trash2, Printer, Calendar, DollarSign, AlertCircle, FileText } from 'lucide-react'
import { useToast } from '@/components/Toast'
import api from '@/lib/api'
import { safeLogError } from '@/utils/connectionError'
import { formatDateOnly } from '@/utils/date'
import { printContractAgreement } from '@/utils/printDocument'

interface Company {
  id: number
  name: string
}

interface Contract {
  id: number
  contract_number: string
  company_id: number
  company_name?: string
  contract_date: string
  expiry_date: string
  duration_months?: number
  duration_years?: number
  status: string
  license_type?: string
  billing_period: string
  amount_per_month?: number
  amount_per_year?: number
  currency: string
  total_contract_value: number
  broadcast_message?: string
  payment_reminder_message?: string
  terms_and_conditions?: string
  notes?: string
  auto_renewal: string
  created_at: string
  is_active: boolean
}

export default function ContractManagement() {
  const toast = useToast()
  const [contracts, setContracts] = useState<Contract[]>([])
  const [companies, setCompanies] = useState<Company[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editingContract, setEditingContract] = useState<Contract | null>(null)
  const [filterStatus, setFilterStatus] = useState<string>('all')
  const [formData, setFormData] = useState({
    company_id: '',
    contract_date: new Date().toISOString().split('T')[0],
    expiry_date: '',
    duration_months: '',
    duration_years: '',
    status: 'draft',
    license_type: '',
    billing_period: 'monthly',
    amount_per_month: '',
    amount_per_year: '',
    currency: 'BDT',
    total_contract_value: '',
    broadcast_message: '',
    payment_reminder_message: '',
    terms_and_conditions: '',
    notes: '',
    auto_renewal: 'false'
  })

  useEffect(() => {
    fetchContracts()
    fetchCompanies()
  }, [filterStatus])

  const fetchContracts = async () => {
    try {
      const params: any = {}
      if (filterStatus !== 'all') {
        params.status = filterStatus
      }
      const response = await api.get('/contracts', { params })
      if (response.data) {
        setContracts(response.data)
      }
    } catch (error: any) {
      console.error('Error fetching contracts:', error)
      toast.error('Failed to load contracts')
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

  const handleCreate = () => {
    setEditingContract(null)
    setFormData({
      company_id: '',
      contract_date: new Date().toISOString().split('T')[0],
      expiry_date: '',
      duration_months: '',
      duration_years: '',
      status: 'draft',
      license_type: '',
      billing_period: 'monthly',
      amount_per_month: '',
      amount_per_year: '',
      currency: 'BDT',
      total_contract_value: '',
      broadcast_message: '',
      payment_reminder_message: '',
      terms_and_conditions: '',
      notes: '',
      auto_renewal: 'false'
    })
    setShowModal(true)
  }

  const handleEdit = (contract: Contract) => {
    setEditingContract(contract)
    setFormData({
      company_id: contract.company_id.toString(),
      contract_date: contract.contract_date,
      expiry_date: contract.expiry_date,
      duration_months: contract.duration_months?.toString() || '',
      duration_years: contract.duration_years?.toString() || '',
      status: contract.status,
      license_type: contract.license_type || '',
      billing_period: contract.billing_period,
      amount_per_month: contract.amount_per_month?.toString() || '',
      amount_per_year: contract.amount_per_year?.toString() || '',
      currency: contract.currency,
      total_contract_value: contract.total_contract_value.toString(),
      broadcast_message: contract.broadcast_message || '',
      payment_reminder_message: contract.payment_reminder_message || '',
      terms_and_conditions: contract.terms_and_conditions || '',
      notes: contract.notes || '',
      auto_renewal: contract.auto_renewal
    })
    setShowModal(true)
  }

  const handleDelete = async (contract: Contract) => {
    if (!confirm(`Are you sure you want to delete contract ${contract.contract_number}?`)) {
      return
    }

    try {
      await api.delete(`/contracts/${contract.id}`)
      toast.success('Contract deleted successfully')
      fetchContracts()
    } catch (error: any) {
      const errorMsg = error.response?.data?.detail || 'Failed to delete contract'
      toast.error(errorMsg)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    try {
      const payload: any = {
        company_id: parseInt(formData.company_id),
        contract_date: formData.contract_date,
        expiry_date: formData.expiry_date,
        status: formData.status,
        license_type: formData.license_type || null,
        billing_period: formData.billing_period,
        currency: formData.currency,
        total_contract_value: parseFloat(formData.total_contract_value),
        broadcast_message: formData.broadcast_message || null,
        payment_reminder_message: formData.payment_reminder_message || null,
        terms_and_conditions: formData.terms_and_conditions || null,
        notes: formData.notes || null,
        auto_renewal: formData.auto_renewal
      }

      if (formData.duration_months) {
        payload.duration_months = parseInt(formData.duration_months)
      }
      if (formData.duration_years) {
        payload.duration_years = parseInt(formData.duration_years)
      }
      if (formData.amount_per_month) {
        payload.amount_per_month = parseFloat(formData.amount_per_month)
      }
      if (formData.amount_per_year) {
        payload.amount_per_year = parseFloat(formData.amount_per_year)
      }

      if (editingContract) {
        await api.put(`/contracts/${editingContract.id}`, payload)
        toast.success('Contract updated successfully')
      } else {
        await api.post('/contracts', payload)
        toast.success('Contract created successfully')
      }

      setShowModal(false)
      fetchContracts()
    } catch (error: any) {
      const errorMsg = error.response?.data?.detail || 'Failed to save contract'
      toast.error(errorMsg)
    }
  }

  const handlePrint = async (contract: Contract) => {
    try {
      await api.get(`/contracts/${contract.id}/print`)
      const ok = printContractAgreement(
        {
          contract_number: contract.contract_number,
          company_name: contract.company_name,
          contract_date: contract.contract_date,
          expiry_date: contract.expiry_date,
          status: contract.status,
          license_type: contract.license_type,
          billing_period: contract.billing_period,
          currency: contract.currency,
          total_contract_value: contract.total_contract_value,
          broadcast_message: contract.broadcast_message,
          payment_reminder_message: contract.payment_reminder_message,
          terms_and_conditions: contract.terms_and_conditions,
        },
        formatDateOnly
      )
      if (!ok) toast.error('Allow pop-ups in your browser to print.')
    } catch (error: any) {
      const errorMsg = error.response?.data?.detail || 'Failed to generate print view'
      toast.error(errorMsg)
    }
  }

  const getStatusBadge = (status: string) => {
    const styles: Record<string, string> = {
      draft: 'bg-gray-100 text-gray-800',
      active: 'bg-green-100 text-green-800',
      suspended: 'bg-yellow-100 text-yellow-800',
      expired: 'bg-red-100 text-red-800',
      cancelled: 'bg-gray-100 text-gray-800',
      renewed: 'bg-blue-100 text-blue-800'
    }
    return styles[status] || 'bg-gray-100 text-gray-800'
  }

  const isExpiringSoon = (expiryDate: string) => {
    const expiry = new Date(expiryDate)
    const today = new Date()
    const daysUntilExpiry = Math.ceil((expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
    return daysUntilExpiry <= 30 && daysUntilExpiry >= 0
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 flex items-center space-x-2">
            <FileText className="h-6 w-6" />
            <span>Contract Management</span>
          </h2>
          <p className="text-gray-600 mt-1">Manage contracts between platform and companies</p>
        </div>
        <button
          onClick={handleCreate}
          className="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          <Plus className="h-5 w-5" />
          <span>New Contract</span>
        </button>
      </div>

      {/* Filters */}
      <div className="bg-white p-4 rounded-lg shadow">
        <div className="flex items-center space-x-4">
          <label className="text-sm font-medium text-gray-700">Filter by Status:</label>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="border border-gray-300 rounded-md px-3 py-2"
          >
            <option value="all">All</option>
            <option value="draft">Draft</option>
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
            <option value="expired">Expired</option>
            <option value="cancelled">Cancelled</option>
            <option value="renewed">Renewed</option>
          </select>
        </div>
      </div>

      {/* Contracts Table */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Contract #</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Company</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Dates</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">License</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Amount</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {contracts.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-8 text-center text-gray-500">
                    No contracts found. Create your first contract.
                  </td>
                </tr>
              ) : (
                contracts.map((contract) => (
                  <tr key={contract.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm font-medium text-gray-900">{contract.contract_number}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-900">{contract.company_name || `Company ID: ${contract.company_id}`}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-900">
                        <div>Start: {formatDateOnly(contract.contract_date)}</div>
                        <div className={`text-xs ${isExpiringSoon(contract.expiry_date) ? 'text-red-600 font-semibold' : 'text-gray-500'}`}>
                          Expires: {formatDateOnly(contract.expiry_date)}
                          {isExpiringSoon(contract.expiry_date) && <AlertCircle className="h-3 w-3 inline ml-1" />}
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-900">{contract.license_type || 'N/A'}</div>
                      <div className="text-xs text-gray-500">{contract.billing_period}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm font-medium text-gray-900">
                        {contract.currency} {contract.total_contract_value.toLocaleString()}
                      </div>
                      {contract.amount_per_month && (
                        <div className="text-xs text-gray-500">Monthly: {contract.currency} {contract.amount_per_month}</div>
                      )}
                      {contract.amount_per_year && (
                        <div className="text-xs text-gray-500">Yearly: {contract.currency} {contract.amount_per_year}</div>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`px-2 py-1 text-xs font-semibold rounded-full ${getStatusBadge(contract.status)}`}>
                        {contract.status.toUpperCase()}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <div className="flex items-center justify-end space-x-2">
                        <button
                          onClick={() => handlePrint(contract)}
                          className="p-1.5 text-blue-600 hover:text-blue-900 hover:bg-blue-50 rounded"
                          title="Print Contract"
                        >
                          <Printer className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => handleEdit(contract)}
                          className="p-1.5 text-green-600 hover:text-green-900 hover:bg-green-50 rounded"
                          title="Edit Contract"
                        >
                          <Edit2 className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => handleDelete(contract)}
                          className="p-1.5 text-red-600 hover:text-red-900 hover:bg-red-50 rounded"
                          title="Delete Contract"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-4xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-xl font-bold text-gray-900">
                  {editingContract ? 'Edit Contract' : 'Create New Contract'}
                </h3>
                <button
                  onClick={() => setShowModal(false)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  ✕
                </button>
              </div>

              <form onSubmit={handleSubmit} className="space-y-6">
                <div className="grid grid-cols-2 gap-4">
                  {/* Company */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Company *
                    </label>
                    <select
                      value={formData.company_id}
                      onChange={(e) => setFormData({ ...formData, company_id: e.target.value })}
                      className="w-full border border-gray-300 rounded-md px-3 py-2"
                      required
                      disabled={!!editingContract}
                    >
                      <option value="">Select Company</option>
                      {companies.map((company) => (
                        <option key={company.id} value={company.id}>
                          {company.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Status */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Status *
                    </label>
                    <select
                      value={formData.status}
                      onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                      className="w-full border border-gray-300 rounded-md px-3 py-2"
                      required
                    >
                      <option value="draft">Draft</option>
                      <option value="active">Active</option>
                      <option value="suspended">Suspended</option>
                      <option value="expired">Expired</option>
                      <option value="cancelled">Cancelled</option>
                      <option value="renewed">Renewed</option>
                    </select>
                  </div>

                  {/* Contract Date */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Contract Date *
                    </label>
                    <input
                      type="date"
                      value={formData.contract_date}
                      onChange={(e) => setFormData({ ...formData, contract_date: e.target.value })}
                      className="w-full border border-gray-300 rounded-md px-3 py-2"
                      required
                    />
                  </div>

                  {/* Expiry Date */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Expiry Date *
                    </label>
                    <input
                      type="date"
                      value={formData.expiry_date}
                      onChange={(e) => setFormData({ ...formData, expiry_date: e.target.value })}
                      className="w-full border border-gray-300 rounded-md px-3 py-2"
                      required
                    />
                  </div>

                  {/* Duration */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Duration (Months)
                    </label>
                    <input
                      type="number"
                      value={formData.duration_months}
                      onChange={(e) => setFormData({ ...formData, duration_months: e.target.value })}
                      className="w-full border border-gray-300 rounded-md px-3 py-2"
                      min="0"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Duration (Years)
                    </label>
                    <input
                      type="number"
                      value={formData.duration_years}
                      onChange={(e) => setFormData({ ...formData, duration_years: e.target.value })}
                      className="w-full border border-gray-300 rounded-md px-3 py-2"
                      min="0"
                    />
                  </div>

                  {/* License Type */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      License Type
                    </label>
                    <input
                      type="text"
                      value={formData.license_type}
                      onChange={(e) => setFormData({ ...formData, license_type: e.target.value })}
                      className="w-full border border-gray-300 rounded-md px-3 py-2"
                      placeholder="e.g., Standard, Premium, Enterprise"
                    />
                  </div>

                  {/* Billing Period */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Billing Period *
                    </label>
                    <select
                      value={formData.billing_period}
                      onChange={(e) => setFormData({ ...formData, billing_period: e.target.value })}
                      className="w-full border border-gray-300 rounded-md px-3 py-2"
                      required
                    >
                      <option value="monthly">Monthly</option>
                      <option value="yearly">Yearly</option>
                    </select>
                  </div>

                  {/* Amount Per Month */}
                  {formData.billing_period === 'monthly' && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Amount Per Month *
                      </label>
                      <input
                        type="number"
                        value={formData.amount_per_month}
                        onChange={(e) => setFormData({ ...formData, amount_per_month: e.target.value })}
                        className="w-full border border-gray-300 rounded-md px-3 py-2"
                        step="0.01"
                        min="0"
                        required={formData.billing_period === 'monthly'}
                      />
                    </div>
                  )}

                  {/* Amount Per Year */}
                  {formData.billing_period === 'yearly' && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Amount Per Year *
                      </label>
                      <input
                        type="number"
                        value={formData.amount_per_year}
                        onChange={(e) => setFormData({ ...formData, amount_per_year: e.target.value })}
                        className="w-full border border-gray-300 rounded-md px-3 py-2"
                        step="0.01"
                        min="0"
                        required={formData.billing_period === 'yearly'}
                      />
                    </div>
                  )}

                  {/* Currency */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Currency *
                    </label>
                    <select
                      value={formData.currency}
                      onChange={(e) => setFormData({ ...formData, currency: e.target.value })}
                      className="w-full border border-gray-300 rounded-md px-3 py-2"
                      required
                    >
                      <option value="BDT">BDT</option>
                      <option value="USD">USD</option>
                      <option value="EUR">EUR</option>
                    </select>
                  </div>

                  {/* Total Contract Value */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Total Contract Value *
                    </label>
                    <input
                      type="number"
                      value={formData.total_contract_value}
                      onChange={(e) => setFormData({ ...formData, total_contract_value: e.target.value })}
                      className="w-full border border-gray-300 rounded-md px-3 py-2"
                      step="0.01"
                      min="0"
                      required
                    />
                  </div>

                  {/* Auto Renewal */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Auto Renewal
                    </label>
                    <select
                      value={formData.auto_renewal}
                      onChange={(e) => setFormData({ ...formData, auto_renewal: e.target.value })}
                      className="w-full border border-gray-300 rounded-md px-3 py-2"
                    >
                      <option value="false">No</option>
                      <option value="true">Yes</option>
                    </select>
                  </div>
                </div>

                {/* Broadcast Message */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Broadcast Message
                  </label>
                  <textarea
                    value={formData.broadcast_message}
                    onChange={(e) => setFormData({ ...formData, broadcast_message: e.target.value })}
                    className="w-full border border-gray-300 rounded-md px-3 py-2"
                    rows={3}
                    placeholder="System-wide announcement message"
                  />
                </div>

                {/* Payment Reminder Message */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Payment Reminder Message
                  </label>
                  <textarea
                    value={formData.payment_reminder_message}
                    onChange={(e) => setFormData({ ...formData, payment_reminder_message: e.target.value })}
                    className="w-full border border-gray-300 rounded-md px-3 py-2"
                    rows={3}
                    placeholder="Reminder message for payment due"
                  />
                </div>

                {/* Terms and Conditions */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Terms and Conditions
                  </label>
                  <textarea
                    value={formData.terms_and_conditions}
                    onChange={(e) => setFormData({ ...formData, terms_and_conditions: e.target.value })}
                    className="w-full border border-gray-300 rounded-md px-3 py-2"
                    rows={5}
                    placeholder="Contract terms and conditions"
                  />
                </div>

                {/* Notes */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Notes
                  </label>
                  <textarea
                    value={formData.notes}
                    onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                    className="w-full border border-gray-300 rounded-md px-3 py-2"
                    rows={3}
                    placeholder="Additional notes"
                  />
                </div>

                {/* Actions */}
                <div className="flex items-center justify-end space-x-4 pt-4 border-t">
                  <button
                    type="button"
                    onClick={() => setShowModal(false)}
                    className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
                  >
                    {editingContract ? 'Update Contract' : 'Create Contract'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

