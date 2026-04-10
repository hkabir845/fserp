'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Sidebar from '@/components/Sidebar'
import { Plus, Eye, DollarSign, X, Calendar, FileText, CheckCircle, Clock, XCircle, Edit2, Trash2 } from 'lucide-react'
import { useToast } from '@/components/Toast'
import { getCurrencySymbol, formatNumber } from '@/utils/currency'
import { formatDateOnly } from '@/utils/date'
import { getApiBaseUrl } from '@/lib/api'

interface PayrollRun {
  id: number
  payroll_number: string
  pay_period_start: string
  pay_period_end: string
  payment_date: string
  total_gross: number
  total_deductions: number
  total_net: number
  status: string
  notes?: string
  created_at: string
  updated_at: string
}

export default function PayrollPage() {
  const router = useRouter()
  const toast = useToast()
  const [payrolls, setPayrolls] = useState<PayrollRun[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [showDetailsModal, setShowDetailsModal] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [selectedPayroll, setSelectedPayroll] = useState<PayrollRun | null>(null)
  const [currencySymbol, setCurrencySymbol] = useState<string>('৳') // Default to BDT
  const [formData, setFormData] = useState({
    pay_period_start: '',
    pay_period_end: '',
    payment_date: '',
    notes: ''
  })

  useEffect(() => {
    const token = localStorage.getItem('access_token')
    if (!token) {
      router.push('/login')
      return
    }
    fetchCompanyCurrency()
    fetchPayrolls()
  }, [router])

  const fetchCompanyCurrency = async () => {
    try {
      const token = localStorage.getItem('access_token')
      const baseUrl = getApiBaseUrl()
      const response = await fetch(`${baseUrl}/companies/current/`, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        mode: 'cors',
        credentials: 'omit'
      })
      if (response.ok) {
        const data = await response.json()
        if (data?.currency) {
          setCurrencySymbol(getCurrencySymbol(data.currency))
        }
      }
    } catch (error) {
      console.error('Error fetching company currency:', error)
    }
  }

  const fetchPayrolls = async () => {
    try {
      const token = localStorage.getItem('access_token')
      const baseUrl = getApiBaseUrl()
      const response = await fetch(`${baseUrl}/payroll/`, {
        headers: { 
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        mode: 'cors',
        credentials: 'omit'
      })
      if (response.ok) {
        const data = await response.json()
        setPayrolls(data)
      } else if (response.status === 401) {
        localStorage.removeItem('access_token')
        router.push('/login')
        toast.error('Session expired. Please login again.')
      } else {
        toast.error('Failed to load payroll runs')
      }
    } catch (error) {
      console.error('Error fetching payroll:', error)
      toast.error('Error loading payroll runs')
    } finally {
      setLoading(false)
    }
  }

  const resetForm = () => {
    setFormData({
      pay_period_start: '',
      pay_period_end: '',
      payment_date: '',
      notes: ''
    })
    setEditingId(null)
  }

  const handleEdit = (payroll: PayrollRun) => {
    setEditingId(payroll.id)
    setFormData({
      pay_period_start: payroll.pay_period_start || '',
      pay_period_end: payroll.pay_period_end || '',
      payment_date: payroll.payment_date || '',
      notes: payroll.notes || ''
    })
    setShowModal(true)
  }

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!editingId) return
    
    if (!formData.pay_period_start || !formData.pay_period_end || !formData.payment_date) {
      toast.error('Please fill in all required fields')
      return
    }

    if (new Date(formData.pay_period_start) > new Date(formData.pay_period_end)) {
      toast.error('Period start date must be before period end date')
      return
    }

    if (new Date(formData.payment_date) < new Date(formData.pay_period_end)) {
      toast.error('Payment date should be on or after period end date')
      return
    }

    try {
      const token = localStorage.getItem('access_token')
      const baseUrl = getApiBaseUrl()
      const response = await fetch(`${baseUrl}/payroll/${editingId}/`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        mode: 'cors',
        credentials: 'omit',
        body: JSON.stringify({
          pay_period_start: formData.pay_period_start,
          pay_period_end: formData.pay_period_end,
          payment_date: formData.payment_date,
          notes: formData.notes || null
        })
      })

      if (response.ok) {
        toast.success('Payroll run updated successfully!')
        setShowModal(false)
        resetForm()
        fetchPayrolls()
      } else {
        const error = await response.json()
        toast.error(error.detail || 'Failed to update payroll run')
      }
    } catch (error) {
      console.error('Error updating payroll:', error)
      toast.error('Error connecting to server')
    }
  }

  const handleDelete = async (payroll: PayrollRun) => {
    if (!confirm(`Are you sure you want to delete payroll ${payroll.payroll_number}? This action cannot be undone.`)) {
      return
    }

    try {
      const token = localStorage.getItem('access_token')
      const baseUrl = getApiBaseUrl()
      const response = await fetch(`${baseUrl}/payroll/${payroll.id}/`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        mode: 'cors',
        credentials: 'omit'
      })

      if (response.ok) {
        toast.success('Payroll run deleted successfully!')
        fetchPayrolls()
      } else {
        const error = await response.json()
        toast.error(error.detail || 'Failed to delete payroll run')
      }
    } catch (error) {
      console.error('Error deleting payroll:', error)
      toast.error('Error connecting to server')
    }
  }

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!formData.pay_period_start || !formData.pay_period_end || !formData.payment_date) {
      toast.error('Please fill in all required fields')
      return
    }

    if (new Date(formData.pay_period_start) > new Date(formData.pay_period_end)) {
      toast.error('Period start date must be before period end date')
      return
    }

    if (new Date(formData.payment_date) < new Date(formData.pay_period_end)) {
      toast.error('Payment date should be on or after period end date')
      return
    }

    try {
      const token = localStorage.getItem('access_token')
      const baseUrl = getApiBaseUrl()
      const response = await fetch(`${baseUrl}/payroll/`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        mode: 'cors',
        credentials: 'omit',
        body: JSON.stringify({
          pay_period_start: formData.pay_period_start,
          pay_period_end: formData.pay_period_end,
          payment_date: formData.payment_date,
          notes: formData.notes || null
        })
      })

      if (response.ok) {
        toast.success('Payroll run created successfully!')
        setShowModal(false)
        resetForm()
        fetchPayrolls()
      } else {
        const error = await response.json()
        toast.error(error.detail || 'Failed to create payroll run')
      }
    } catch (error) {
      console.error('Error creating payroll:', error)
      toast.error('Error connecting to server')
    }
  }

  const handleSubmit = (e: React.FormEvent) => {
    if (editingId) {
      handleUpdate(e)
    } else {
      handleCreate(e)
    }
  }

  const handleViewDetails = async (payroll: PayrollRun) => {
    try {
      const token = localStorage.getItem('access_token')
      const baseUrl = getApiBaseUrl()
      const response = await fetch(`${baseUrl}/payroll/${payroll.id}/`, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        mode: 'cors',
        credentials: 'omit'
      })
      if (response.ok) {
        const data = await response.json()
        setSelectedPayroll(data)
        setShowDetailsModal(true)
      } else {
        toast.error('Failed to load payroll details')
      }
    } catch (error) {
      console.error('Error fetching payroll details:', error)
      toast.error('Error loading payroll details')
    }
  }

  const getStatusIcon = (status: string) => {
    switch (status.toLowerCase()) {
      case 'paid':
        return <CheckCircle className="h-4 w-4 text-green-600" />
      case 'processed':
        return <Clock className="h-4 w-4 text-yellow-600" />
      case 'draft':
        return <FileText className="h-4 w-4 text-gray-600" />
      default:
        return <XCircle className="h-4 w-4 text-red-600" />
    }
  }

  const getStatusColor = (status: string) => {
    switch (status.toLowerCase()) {
      case 'paid':
        return 'bg-green-100 text-green-800'
      case 'processed':
        return 'bg-yellow-100 text-yellow-800'
      case 'draft':
        return 'bg-gray-100 text-gray-800'
      default:
        return 'bg-red-100 text-red-800'
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    )
  }

  const totalGross = payrolls.reduce((sum, p) => sum + (Number(p.total_gross) || 0), 0)
  const totalDeductions = payrolls.reduce((sum, p) => sum + (Number(p.total_deductions) || 0), 0)
  const totalNet = payrolls.reduce((sum, p) => sum + (Number(p.total_net) || 0), 0)

  return (
    <div className="flex h-screen bg-gray-100 page-with-sidebar">
      <Sidebar />
      <div className="flex-1 overflow-auto">
        <div className="p-8">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Payroll</h1>
              <p className="text-gray-600 mt-1">Manage employee payroll</p>
            </div>
            <button 
              onClick={() => {
                resetForm()
                setShowModal(true)
              }}
              className="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              <Plus className="h-5 w-5" />
              <span>New Payroll Run</span>
            </button>
          </div>

          {/* Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
            <div className="bg-white rounded-lg shadow p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600">Total Gross Pay</p>
                  <p className="text-2xl font-bold text-gray-900 mt-1">
                    {currencySymbol}{formatNumber(totalGross)}
                  </p>
                </div>
                <div className="p-3 bg-blue-100 rounded-full">
                  <DollarSign className="h-6 w-6 text-blue-600" />
                </div>
              </div>
            </div>
            <div className="bg-white rounded-lg shadow p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600">Total Deductions</p>
                  <p className="text-2xl font-bold text-gray-900 mt-1">
                    {currencySymbol}{formatNumber(totalDeductions)}
                  </p>
                </div>
                <div className="p-3 bg-red-100 rounded-full">
                  <DollarSign className="h-6 w-6 text-red-600" />
                </div>
              </div>
            </div>
            <div className="bg-white rounded-lg shadow p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600">Total Net Pay</p>
                  <p className="text-2xl font-bold text-gray-900 mt-1">
                    {currencySymbol}{formatNumber(totalNet)}
                  </p>
                </div>
                <div className="p-3 bg-green-100 rounded-full">
                  <DollarSign className="h-6 w-6 text-green-600" />
                </div>
              </div>
            </div>
          </div>

          {/* Payroll Runs Table */}
          <div className="bg-white rounded-lg shadow overflow-hidden">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Payroll #</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Period</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Payment Date</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Gross</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Deductions</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Net</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {payrolls.map((payroll) => (
                  <tr key={payroll.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                      {payroll.payroll_number}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                      {payroll.pay_period_start && payroll.pay_period_end 
                        ? `${formatDateOnly(payroll.pay_period_start)} - ${formatDateOnly(payroll.pay_period_end)}`
                        : 'N/A'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                      {payroll.payment_date ? formatDateOnly(payroll.payment_date) : 'N/A'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-right font-medium text-gray-900">
                      {currencySymbol}{formatNumber(Number(payroll.total_gross) || 0)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-red-600">
                      {currencySymbol}{formatNumber(Number(payroll.total_deductions) || 0)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-right font-bold text-green-600">
                      {currencySymbol}{formatNumber(Number(payroll.total_net) || 0)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`px-2 py-1 text-xs rounded-full flex items-center gap-1 w-fit ${getStatusColor(payroll.status)}`}>
                        {getStatusIcon(payroll.status)}
                        {payroll.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <div className="flex items-center justify-end gap-3">
                        <button 
                          onClick={() => handleViewDetails(payroll)}
                          className="text-blue-600 hover:text-blue-900 inline-flex items-center gap-1"
                          title="View Details"
                        >
                          <Eye className="h-4 w-4" />
                          <span className="hidden sm:inline">View</span>
                        </button>
                        <button 
                          onClick={() => handleEdit(payroll)}
                          className="text-green-600 hover:text-green-900 inline-flex items-center gap-1"
                          title="Edit Payroll"
                        >
                          <Edit2 className="h-4 w-4" />
                          <span className="hidden sm:inline">Edit</span>
                        </button>
                        <button 
                          onClick={() => handleDelete(payroll)}
                          className="text-red-600 hover:text-red-900 inline-flex items-center gap-1"
                          title="Delete Payroll"
                        >
                          <Trash2 className="h-4 w-4" />
                          <span className="hidden sm:inline">Delete</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {payrolls.length === 0 && (
              <div className="text-center py-12 text-gray-500">
                No payroll runs found. Create your first payroll to get started.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* New Payroll Run Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            {/* Modal Header */}
            <div className="bg-gradient-to-r from-blue-600 to-blue-700 px-6 py-4 sticky top-0 z-10 flex items-center justify-between rounded-t-xl">
              <div className="flex items-center space-x-3">
                <Calendar className="h-6 w-6 text-white" />
                <h2 className="text-2xl font-bold text-white">
                  {editingId ? 'Edit Payroll Run' : 'New Payroll Run'}
                </h2>
              </div>
              <button
                onClick={() => {
                  setShowModal(false)
                  resetForm()
                }}
                className="p-2 hover:bg-white/20 rounded-full transition-colors"
              >
                <X className="h-5 w-5 text-white" />
              </button>
            </div>

            {/* Modal Content */}
            <form onSubmit={handleSubmit} className="p-6">
              <div className="space-y-6">
                <div className="border-b pb-6">
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">Pay Period Information</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Period Start Date <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="date"
                        required
                        value={formData.pay_period_start}
                        onChange={(e) => setFormData({ ...formData, pay_period_start: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Period End Date <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="date"
                        required
                        value={formData.pay_period_end}
                        onChange={(e) => setFormData({ ...formData, pay_period_end: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                    </div>
                    <div className="md:col-span-2">
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Payment Date <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="date"
                        required
                        value={formData.payment_date}
                        onChange={(e) => setFormData({ ...formData, payment_date: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                    </div>
                    <div className="md:col-span-2">
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Notes
                      </label>
                      <textarea
                        value={formData.notes}
                        onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                        rows={3}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        placeholder="Optional notes about this payroll run..."
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Modal Footer */}
              <div className="flex items-center justify-end space-x-3 pt-6 border-t mt-6">
                <button
                  type="button"
                  onClick={() => {
                    setShowModal(false)
                    resetForm()
                  }}
                  className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                >
                  {editingId ? 'Update Payroll Run' : 'Create Payroll Run'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Payroll Details Modal */}
      {showDetailsModal && selectedPayroll && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-3xl w-full max-h-[90vh] overflow-y-auto">
            {/* Modal Header */}
            <div className="bg-gradient-to-r from-blue-600 to-blue-700 px-6 py-4 sticky top-0 z-10 flex items-center justify-between rounded-t-xl">
              <div className="flex items-center space-x-3">
                <FileText className="h-6 w-6 text-white" />
                <h2 className="text-2xl font-bold text-white">Payroll Details - {selectedPayroll.payroll_number}</h2>
              </div>
              <button
                onClick={() => {
                  setShowDetailsModal(false)
                  setSelectedPayroll(null)
                }}
                className="p-2 hover:bg-white/20 rounded-full transition-colors"
              >
                <X className="h-5 w-5 text-white" />
              </button>
            </div>

            {/* Modal Content */}
            <div className="p-6">
              <div className="space-y-6">
                {/* Pay Period Info */}
                <div className="border-b pb-6">
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">Pay Period Information</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <p className="text-sm text-gray-600">Payroll Number</p>
                      <p className="text-lg font-semibold text-gray-900">{selectedPayroll.payroll_number}</p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-600">Status</p>
                      <span className={`px-3 py-1 text-sm rounded-full inline-flex items-center gap-1 ${getStatusColor(selectedPayroll.status)}`}>
                        {getStatusIcon(selectedPayroll.status)}
                        {selectedPayroll.status}
                      </span>
                    </div>
                    <div>
                      <p className="text-sm text-gray-600">Period Start</p>
                      <p className="text-lg font-medium text-gray-900">
                        {selectedPayroll.pay_period_start ? formatDateOnly(selectedPayroll.pay_period_start) : 'N/A'}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-600">Period End</p>
                      <p className="text-lg font-medium text-gray-900">
                        {selectedPayroll.pay_period_end ? formatDateOnly(selectedPayroll.pay_period_end) : 'N/A'}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-600">Payment Date</p>
                      <p className="text-lg font-medium text-gray-900">
                        {selectedPayroll.payment_date ? formatDateOnly(selectedPayroll.payment_date) : 'N/A'}
                      </p>
                    </div>
                    {selectedPayroll.notes && (
                      <div className="md:col-span-2">
                        <p className="text-sm text-gray-600">Notes</p>
                        <p className="text-base text-gray-900">{selectedPayroll.notes}</p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Summary */}
                <div className="border-b pb-6">
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">Summary</h3>
                  <div className="space-y-3">
                    <div className="flex justify-between items-center">
                      <span className="text-gray-600">Total Gross Pay</span>
                      <span className="text-xl font-bold text-gray-900">
                        {currencySymbol}{formatNumber(Number(selectedPayroll.total_gross) || 0)}
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-gray-600">Total Deductions</span>
                      <span className="text-xl font-bold text-red-600">
                        -{currencySymbol}{formatNumber(Number(selectedPayroll.total_deductions) || 0)}
                      </span>
                    </div>
                    <div className="flex justify-between items-center pt-3 border-t">
                      <span className="text-lg font-semibold text-gray-900">Total Net Pay</span>
                      <span className="text-2xl font-bold text-green-600">
                        {currencySymbol}{formatNumber(Number(selectedPayroll.total_net) || 0)}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Paychecks will be added here when implemented */}
                <div className="text-center py-8 text-gray-500">
                  <p>Employee paychecks will be displayed here</p>
                  <p className="text-sm mt-2">Paycheck management coming soon...</p>
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-end space-x-3 pt-6 border-t px-6 pb-6">
              <button
                onClick={() => {
                  setShowDetailsModal(false)
                  setSelectedPayroll(null)
                }}
                className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
