'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Sidebar from '@/components/Sidebar'
import { CompanyProvider, useCompany } from '@/contexts/CompanyContext'
import Link from 'next/link'
import { Building2, Plus, Edit2, Trash2, Eye, FileText, AlertCircle, X, Grid3x3, List, RotateCw, ChevronRight, Printer } from 'lucide-react'
import { useToast } from '@/components/Toast'
import api from '@/lib/api'
import { formatCurrency } from '@/utils/currency'
import { safeLogError, isConnectionError } from '@/utils/connectionError'
import { formatDateOnly } from '@/utils/date'
import { printContractAgreement } from '@/utils/printDocument'
import { loadPrintBranding } from '@/utils/printBranding'
import { useRequireSaasDashboardMode } from '@/hooks/useRequireSaasDashboardMode'

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

interface Company {
  id: number
  name: string
  legal_name: string | null
  email: string | null
  phone: string | null
  subdomain: string | null
  custom_domain: string | null
  currency: string
  is_active: boolean
  payment_type?: string
  payment_start_date?: string
  payment_end_date?: string
  payment_amount?: string
  contact_person?: string
  contracts?: Contract[]
}

function ContractsPageContent() {
  const router = useRouter()
  const toast = useToast()
  useRequireSaasDashboardMode()
  const { mode } = useCompany()
  const [companies, setCompanies] = useState<Company[]>([])
  const [contracts, setContracts] = useState<Contract[]>([])
  const [loading, setLoading] = useState(true)
  const [viewMode, setViewMode] = useState<'card' | 'list'>(() => {
    // Load view mode from localStorage if available
    if (typeof window !== 'undefined') {
      const savedViewMode = localStorage.getItem('contracts_view_mode')
      if (savedViewMode === 'card' || savedViewMode === 'list') {
        return savedViewMode as 'card' | 'list'
      }
    }
    return 'card'
  })
  const [showContractModal, setShowContractModal] = useState(false)
  const [viewingContract, setViewingContract] = useState<Contract | null>(null)
  const [editingContract, setEditingContract] = useState<Contract | null>(null)
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

  const loadContractsPageData = useCallback(async () => {
    setLoading(true)
    try {
      const [compRes, contRes] = await Promise.all([
        api.get('/admin/companies'),
        api.get('/contracts'),
      ])
      const compList: Company[] = compRes.data || []
      const contList: Contract[] = contRes.data || []
      setContracts(contList)
      const contractsByCompany = contList.reduce<Record<number, Contract[]>>((acc, contract) => {
        if (!acc[contract.company_id]) {
          acc[contract.company_id] = []
        }
        acc[contract.company_id].push(contract)
        return acc
      }, {})
      setCompanies(
        compList.map((company) => ({
          ...company,
          contracts: contractsByCompany[company.id] || [],
        }))
      )
    } catch (error: unknown) {
      safeLogError('Error loading contracts page:', error)
      if (!isConnectionError(error)) {
        toast.error('Failed to load companies or contracts')
      }
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    const token = localStorage.getItem('access_token')
    if (!token) {
      router.push('/login')
      return
    }

    const userStr = localStorage.getItem('user')
    if (userStr && userStr !== 'undefined' && userStr !== 'null') {
      try {
        const user = JSON.parse(userStr)
        const role = user.role?.toLowerCase() || null
        if (role !== 'super_admin') {
          toast.error('Access denied. Super Admin access required.')
          router.push('/dashboard')
          return
        }
      } catch (error) {
        safeLogError('Error parsing user data:', error)
      }
    }

    if (mode === 'saas_dashboard') {
      loadContractsPageData()
    }
  }, [mode, router, toast, loadContractsPageData])

  const handleCreateContract = () => {
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
    setShowContractModal(true)
  }

  const handleCompanyChange = (companyId: string) => {
    if (!companyId) {
      // Reset form if no company selected
      setFormData({
        ...formData,
        company_id: '',
        currency: 'BDT',
        billing_period: 'monthly',
        amount_per_month: '',
        amount_per_year: '',
        total_contract_value: ''
      })
      return
    }

    // Find the selected company
    const selectedCompany = companies.find(c => c.id === parseInt(companyId))
    if (!selectedCompany) return

    // Auto-fill fields from company data
    const updatedFormData: any = {
      ...formData,
      company_id: companyId,
      currency: selectedCompany.currency || 'BDT'
    }

    // Auto-fill billing period from payment_type
    if (selectedCompany.payment_type) {
      const paymentType = selectedCompany.payment_type.toLowerCase()
      if (paymentType === 'monthly') {
        updatedFormData.billing_period = 'monthly'
      } else if (paymentType === 'quarterly') {
        updatedFormData.billing_period = 'quarterly'
      } else if (paymentType === 'half_yearly' || paymentType === 'half-yearly') {
        updatedFormData.billing_period = 'half_yearly'
      } else if (paymentType === 'yearly') {
        updatedFormData.billing_period = 'yearly'
      }
    }

    // Auto-fill contract dates from payment dates
    if (selectedCompany.payment_start_date) {
      updatedFormData.contract_date = new Date(selectedCompany.payment_start_date).toISOString().split('T')[0]
    }
    if (selectedCompany.payment_end_date) {
      updatedFormData.expiry_date = new Date(selectedCompany.payment_end_date).toISOString().split('T')[0]
    }

    // Auto-fill amount from payment_amount
    if (selectedCompany.payment_amount) {
      const amount = parseFloat(selectedCompany.payment_amount)
      if (!isNaN(amount)) {
        // Determine if it's monthly or yearly based on billing period
        if (updatedFormData.billing_period === 'monthly') {
          updatedFormData.amount_per_month = amount.toString()
          updatedFormData.total_contract_value = (amount * 12).toString() // Estimate yearly value
        } else if (updatedFormData.billing_period === 'quarterly') {
          updatedFormData.amount_per_month = (amount / 3).toString()
          updatedFormData.total_contract_value = (amount * 4).toString() // Estimate yearly value
        } else if (updatedFormData.billing_period === 'half_yearly') {
          updatedFormData.amount_per_month = (amount / 6).toString()
          updatedFormData.total_contract_value = (amount * 2).toString() // Estimate yearly value
        } else if (updatedFormData.billing_period === 'yearly') {
          updatedFormData.amount_per_year = amount.toString()
          updatedFormData.total_contract_value = amount.toString()
        }
      }
    }

    // Calculate duration from dates if both dates are available
    if (updatedFormData.contract_date && updatedFormData.expiry_date) {
      const startDate = new Date(updatedFormData.contract_date)
      const endDate = new Date(updatedFormData.expiry_date)
      const diffTime = Math.abs(endDate.getTime() - startDate.getTime())
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))
      const diffMonths = Math.floor(diffDays / 30)
      const diffYears = Math.floor(diffDays / 365)

      if (diffYears > 0) {
        updatedFormData.duration_years = diffYears.toString()
        updatedFormData.duration_months = (diffMonths % 12).toString()
      } else if (diffMonths > 0) {
        updatedFormData.duration_months = diffMonths.toString()
      }
    }

    // Auto-fill broadcast message with company name
    if (selectedCompany.name) {
      updatedFormData.broadcast_message = `New contract has been created for ${selectedCompany.name}. Please review the terms and conditions.`
    }

    // Auto-fill payment reminder message
    if (selectedCompany.name && updatedFormData.expiry_date) {
      updatedFormData.payment_reminder_message = `Dear ${selectedCompany.name}, this is a reminder that your contract will expire on ${formatDateOnly(updatedFormData.expiry_date)}. Please ensure payment is made before the expiry date.`
    }

    setFormData(updatedFormData)
  }

  const handleViewContract = (contract: Contract) => {
    setViewingContract(contract)
  }

  const handleEditContract = (contract: Contract) => {
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
    setShowContractModal(true)
  }

  const handleRenewContract = async (contract: Contract) => {
    if (!confirm(`Renew contract ${contract.contract_number}? This will create a new contract based on the current one.`)) {
      return
    }

    try {
      // Calculate new dates based on existing contract
      const today = new Date()
      const oldExpiryDate = new Date(contract.expiry_date)
      const startDate = oldExpiryDate > today ? oldExpiryDate : today
      
      // Calculate new expiry date based on duration
      let newExpiryDate = new Date(startDate)
      if (contract.duration_years && contract.duration_years > 0) {
        newExpiryDate.setFullYear(newExpiryDate.getFullYear() + contract.duration_years)
      }
      if (contract.duration_months && contract.duration_months > 0) {
        newExpiryDate.setMonth(newExpiryDate.getMonth() + contract.duration_months)
      }
      // If no duration specified, default to 1 year
      if (!contract.duration_years && !contract.duration_months) {
        newExpiryDate.setFullYear(newExpiryDate.getFullYear() + 1)
      }

      // Create new contract based on existing one
      const newContractData = {
        company_id: contract.company_id,
        contract_date: startDate.toISOString().split('T')[0],
        expiry_date: newExpiryDate.toISOString().split('T')[0],
        duration_months: contract.duration_months || null,
        duration_years: contract.duration_years || 1,
        status: 'draft', // New contract starts as draft
        license_type: contract.license_type || null,
        billing_period: contract.billing_period,
        amount_per_month: contract.amount_per_month || null,
        amount_per_year: contract.amount_per_year || null,
        currency: contract.currency,
        total_contract_value: contract.total_contract_value,
        broadcast_message: contract.broadcast_message || null,
        payment_reminder_message: contract.payment_reminder_message || null,
        terms_and_conditions: contract.terms_and_conditions || null,
        notes: `Renewed from contract ${contract.contract_number}. ${contract.notes || ''}`.trim(),
        auto_renewal: contract.auto_renewal
      }

      const createRes = await api.post('/contracts', newContractData)
      const newContractId = createRes.data?.id as number | undefined
      if (!newContractId) {
        toast.error('Renewal failed: invalid server response')
        await loadContractsPageData()
        return
      }

      try {
        await api.put(`/contracts/${contract.id}`, { status: 'renewed' })
      } catch (updateError: unknown) {
        safeLogError('Error updating old contract status:', updateError)
        try {
          await api.delete(`/contracts/${newContractId}`)
        } catch (delErr: unknown) {
          safeLogError('Rollback failed: could not delete draft renewal contract:', delErr)
          toast.error(
            'Renewal partially failed: a new draft contract was created but the previous contract could not be marked renewed, and automatic cleanup failed. Please review contracts manually.'
          )
          await loadContractsPageData()
          return
        }
        const detail =
          (updateError as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
          'Failed to update previous contract'
        toast.error(`${detail} The new draft was removed (rolled back).`)
        await loadContractsPageData()
        return
      }

      toast.success('Contract renewed successfully! New contract created.')
      await loadContractsPageData()
    } catch (error: any) {
      const errorMsg = error.response?.data?.detail || 'Failed to renew contract'
      toast.error(errorMsg)
      safeLogError('Error renewing contract:', error)
    }
  }

  const handleDeleteContract = async (contract: Contract) => {
    if (!confirm(`Are you sure you want to delete contract ${contract.contract_number}? This action cannot be undone.`)) {
      return
    }

    try {
      await api.delete(`/contracts/${contract.id}`)
      toast.success('Contract deleted successfully')
      await loadContractsPageData()
    } catch (error: any) {
      const errorMsg = error.response?.data?.detail || 'Failed to delete contract'
      toast.error(errorMsg)
      safeLogError('Error deleting contract:', error)
    }
  }

  const handlePrintContract = async (contract: Contract) => {
    try {
      await api.get(`/contracts/${contract.id}/print`)
      const baseBranding = await loadPrintBranding(api)
      const branding = {
        ...baseBranding,
        companyName: (contract.company_name || '').trim() || baseBranding.companyName,
      }
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
        formatDateOnly,
        branding
      )
      if (!ok) toast.error('Allow pop-ups in your browser to print.')
    } catch (error: unknown) {
      const err = error as { response?: { data?: { detail?: string } } }
      const errorMsg = err.response?.data?.detail || 'Failed to generate print view'
      toast.error(errorMsg)
      safeLogError('Error printing contract:', error)
    }
  }

  const handleSubmitContract = async (e: React.FormEvent) => {
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

      setShowContractModal(false)
      await loadContractsPageData()
    } catch (error: any) {
      const errorMsg = error.response?.data?.detail || 'Failed to save contract'
      toast.error(errorMsg)
      safeLogError('Error saving contract:', error)
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

  if (mode !== 'saas_dashboard') {
    return (
      <div className="flex h-screen bg-gray-100 page-with-sidebar">
        <Sidebar />
        <div className="flex-1 overflow-y-auto app-scroll-pad">
          <div className="bg-white rounded-lg shadow app-modal-pad text-center">
            <p className="text-gray-600">Please switch to SaaS Dashboard mode to manage contracts.</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-screen bg-gray-100 page-with-sidebar">
      <Sidebar />
      <div className="flex-1 overflow-y-auto">
        <div className="app-scroll-pad">
          {/* Breadcrumb */}
          <nav className="flex items-center gap-2 text-sm text-gray-500 mb-4">
            <Link href="/admin" className="hover:text-gray-700 transition-colors">Admin</Link>
            <ChevronRight className="h-4 w-4 text-gray-400" />
            <span className="text-gray-900 font-medium">Contract Management</span>
          </nav>
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-2xl font-bold text-gray-900 flex items-center space-x-2">
                <FileText className="h-6 w-6" />
                <span>Contract Management</span>
              </h2>
              <p className="text-gray-600 mt-1">Manage contracts for all companies</p>
            </div>
            <div className="flex items-center space-x-3">
              {/* View Toggle */}
              <div className="flex items-center bg-gray-100 rounded-lg p-1">
                <button
                  onClick={() => {
                    setViewMode('card')
                    localStorage.setItem('contracts_view_mode', 'card')
                  }}
                  className={`p-2 rounded transition-colors ${
                    viewMode === 'card'
                      ? 'bg-white text-blue-600 shadow-sm'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                  title="Card View"
                >
                  <Grid3x3 className="h-5 w-5" />
                </button>
                <button
                  onClick={() => {
                    setViewMode('list')
                    localStorage.setItem('contracts_view_mode', 'list')
                  }}
                  className={`p-2 rounded transition-colors ${
                    viewMode === 'list'
                      ? 'bg-white text-blue-600 shadow-sm'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                  title="List View"
                >
                  <List className="h-5 w-5" />
                </button>
              </div>
              <button
                onClick={handleCreateContract}
                className="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                <Plus className="h-5 w-5" />
                <span>New Contract</span>
              </button>
            </div>
          </div>

          {/* Companies List with Contracts */}
          {loading ? (
            <div className="bg-white rounded-lg shadow app-modal-pad text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
              <p className="text-gray-600">Loading companies...</p>
            </div>
          ) : companies.length === 0 ? (
            <div className="bg-white rounded-lg shadow app-modal-pad text-center">
              <Building2 className="h-12 w-12 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-600 text-lg mb-2">No companies found</p>
              <p className="text-gray-500 text-sm">Add companies from the Admin dashboard first.</p>
            </div>
          ) : contracts.length === 0 ? (
            <div className="bg-white rounded-xl shadow-lg border border-gray-200 p-12 text-center">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-blue-50 text-blue-600 mb-4">
                <FileText className="h-8 w-8" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">No contracts yet</h3>
              <p className="text-gray-600 max-w-sm mx-auto mb-6">
                Create your first contract to manage billing and terms for your companies.
              </p>
              <button
                onClick={handleCreateContract}
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
              >
                <Plus className="h-5 w-5" />
                New Contract
              </button>
            </div>
          ) : (
            <div className="space-y-6">
              {companies.map((company) => {
                const companyContracts = company.contracts || []
                const activeContract = companyContracts.find(c => c.status === 'active')
                
                return (
                  <div key={company.id} className="bg-white rounded-lg shadow-lg border border-gray-200">
                    <div className="p-6">
                      {/* Company Header */}
                      <div className="flex items-start justify-between mb-4">
                        <div className="flex-1">
                          <div className="flex items-center space-x-3 mb-2">
                            <Building2 className="h-5 w-5 text-gray-600" />
                            <h3 className="text-xl font-bold text-gray-900">{company.name}</h3>
                            <span className={`px-3 py-1 text-xs font-semibold rounded-full ${
                              company.is_active 
                                ? 'bg-green-100 text-green-800' 
                                : 'bg-red-100 text-red-800'
                            }`}>
                              {company.is_active ? 'Active' : 'Inactive'}
                            </span>
                            {activeContract && (
                              <span className="px-3 py-1 text-xs font-semibold bg-blue-100 text-blue-800 rounded-full">
                                Has Active Contract
                              </span>
                            )}
                          </div>
                          {company.legal_name && (
                            <p className="text-sm text-gray-600 ml-8">{company.legal_name}</p>
                          )}
                          <div className="mt-2 ml-8 flex items-center space-x-4 text-sm text-gray-600">
                            {company.email && <span>📧 {company.email}</span>}
                            {company.phone && <span>📞 {company.phone}</span>}
                          </div>
                        </div>
                      </div>

                      {/* Contracts Section */}
                      <div className="mt-4 border-t border-gray-200 pt-4">
                        <div className="flex items-center justify-between mb-3">
                          <h4 className="text-sm font-semibold text-gray-700">Contracts ({companyContracts.length})</h4>
                          {companyContracts.length > 0 && (
                            <div className="flex items-center bg-gray-100 rounded-lg p-1">
                              <button
                                onClick={() => {
                                  setViewMode('card')
                                  localStorage.setItem('contracts_view_mode', 'card')
                                }}
                                className={`p-1.5 rounded transition-colors ${
                                  viewMode === 'card'
                                    ? 'bg-white text-blue-600 shadow-sm'
                                    : 'text-gray-600 hover:text-gray-900'
                                }`}
                                title="Card View"
                              >
                                <Grid3x3 className="h-4 w-4" />
                              </button>
                              <button
                                onClick={() => {
                                  setViewMode('list')
                                  localStorage.setItem('contracts_view_mode', 'list')
                                }}
                                className={`p-1.5 rounded transition-colors ${
                                  viewMode === 'list'
                                    ? 'bg-white text-blue-600 shadow-sm'
                                    : 'text-gray-600 hover:text-gray-900'
                                }`}
                                title="List View"
                              >
                                <List className="h-4 w-4" />
                              </button>
                            </div>
                          )}
                        </div>
                        
                        {companyContracts.length === 0 ? (
                          <p className="text-sm text-gray-500 italic">No contracts for this company</p>
                        ) : viewMode === 'card' ? (
                          // Card View
                          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            {companyContracts.map((contract) => (
                              <div
                                key={contract.id}
                                className="bg-gray-50 rounded-lg p-4 border border-gray-200 hover:bg-gray-100 transition-colors"
                              >
                                <div className="flex items-start justify-between mb-3">
                                  <div className="flex-1">
                                    <div className="flex items-center space-x-2 mb-2">
                                      <span className="font-semibold text-gray-900">{contract.contract_number}</span>
                                      <span className={`px-2 py-1 text-xs font-semibold rounded-full ${getStatusBadge(contract.status)}`}>
                                        {contract.status.toUpperCase()}
                                      </span>
                                      {isExpiringSoon(contract.expiry_date) && (
                                        <span className="flex items-center text-xs text-red-600">
                                          <AlertCircle className="h-3 w-3 mr-1" />
                                          Expiring Soon
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                  <div className="flex items-center space-x-1 ml-2 flex-shrink-0">
                                    <button
                                      type="button"
                                      onClick={() => handleViewContract(contract)}
                                      className="p-1.5 text-slate-600 hover:bg-slate-50 rounded transition-colors border border-transparent hover:border-slate-200"
                                      title="View Contract"
                                      aria-label="View Contract"
                                    >
                                      <Eye className="h-4 w-4" />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handlePrintContract(contract)}
                                      className="p-1.5 text-blue-600 hover:bg-blue-50 rounded transition-colors border border-transparent hover:border-blue-200"
                                      title="Print Contract"
                                      aria-label="Print Contract"
                                    >
                                      <Printer className="h-4 w-4" />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleEditContract(contract)}
                                      className="p-1.5 text-green-600 hover:bg-green-50 rounded transition-colors border border-transparent hover:border-green-200"
                                      title="Edit Contract"
                                      aria-label="Edit Contract"
                                    >
                                      <Edit2 className="h-4 w-4" />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleRenewContract(contract)}
                                      className="p-1.5 text-purple-600 hover:bg-purple-50 rounded transition-colors border border-transparent hover:border-purple-200"
                                      title="Renew/Resign Contract"
                                      aria-label="Renew Contract"
                                    >
                                      <RotateCw className="h-4 w-4" />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleDeleteContract(contract)}
                                      className="p-1.5 text-red-600 hover:bg-red-50 rounded transition-colors border border-transparent hover:border-red-200"
                                      title="Delete Contract"
                                      aria-label="Delete Contract"
                                    >
                                      <Trash2 className="h-4 w-4" />
                                    </button>
                                  </div>
                                </div>
                                <div className="space-y-2 text-sm">
                                  <div className="flex justify-between">
                                    <span className="text-gray-500">Start:</span>
                                    <span className="text-gray-900">{formatDateOnly(contract.contract_date)}</span>
                                  </div>
                                  <div className="flex justify-between">
                                    <span className="text-gray-500">Expiry:</span>
                                    <span className={`${isExpiringSoon(contract.expiry_date) ? 'text-red-600 font-semibold' : 'text-gray-900'}`}>
                                      {formatDateOnly(contract.expiry_date)}
                                    </span>
                                  </div>
                                  <div className="flex justify-between">
                                    <span className="text-gray-500">Amount:</span>
                                    <span className="font-semibold text-gray-900">
                                      {formatCurrency(contract.total_contract_value, contract.currency)}
                                    </span>
                                  </div>
                                  <div className="flex justify-between">
                                    <span className="text-gray-500">Billing:</span>
                                    <span className="text-gray-900 capitalize">{contract.billing_period}</span>
                                  </div>
                                  {contract.license_type && (
                                    <div className="pt-2 border-t border-gray-200 text-xs text-gray-600">
                                      License: {contract.license_type}
                                    </div>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          // List View
                          <div className="overflow-x-auto">
                            <table className="min-w-full divide-y divide-gray-200">
                              <thead className="bg-gray-50">
                                <tr>
                                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Contract #</th>
                                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Start Date</th>
                                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Expiry Date</th>
                                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Amount</th>
                                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Billing</th>
                                  <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
                                </tr>
                              </thead>
                              <tbody className="bg-white divide-y divide-gray-200">
                                {companyContracts.map((contract) => (
                                  <tr key={contract.id} className="hover:bg-gray-50">
                                    <td className="px-4 py-3 whitespace-nowrap">
                                      <span className="text-sm font-semibold text-gray-900">{contract.contract_number}</span>
                                    </td>
                                    <td className="px-4 py-3 whitespace-nowrap">
                                      <div className="flex items-center space-x-2">
                                        <span className={`px-2 py-1 text-xs font-semibold rounded-full ${getStatusBadge(contract.status)}`}>
                                          {contract.status.toUpperCase()}
                                        </span>
                                        {isExpiringSoon(contract.expiry_date) && (
                                          <span title="Expiring Soon">
                                            <AlertCircle className="h-3 w-3 text-red-600" />
                                          </span>
                                        )}
                                      </div>
                                    </td>
                                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900">
                                      {formatDateOnly(contract.contract_date)}
                                    </td>
                                    <td className="px-4 py-3 whitespace-nowrap">
                                      <span className={`text-sm ${isExpiringSoon(contract.expiry_date) ? 'text-red-600 font-semibold' : 'text-gray-900'}`}>
                                        {formatDateOnly(contract.expiry_date)}
                                      </span>
                                    </td>
                                    <td className="px-4 py-3 whitespace-nowrap text-sm font-semibold text-gray-900">
                                      {formatCurrency(contract.total_contract_value, contract.currency)}
                                    </td>
                                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900 capitalize">
                                      {contract.billing_period}
                                    </td>
                                    <td className="px-4 py-3 whitespace-nowrap text-right text-sm font-medium">
                                      <div className="flex items-center justify-end space-x-1 flex-wrap gap-y-1 justify-end">
                                        <button
                                          type="button"
                                          onClick={() => handleViewContract(contract)}
                                          className="p-1.5 text-slate-600 hover:bg-slate-50 rounded transition-colors border border-transparent hover:border-slate-200"
                                          title="View Contract"
                                          aria-label="View Contract"
                                        >
                                          <Eye className="h-4 w-4" />
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => handlePrintContract(contract)}
                                          className="p-1.5 text-blue-600 hover:bg-blue-50 rounded transition-colors border border-transparent hover:border-blue-200"
                                          title="Print Contract"
                                          aria-label="Print Contract"
                                        >
                                          <Printer className="h-4 w-4" />
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => handleEditContract(contract)}
                                          className="p-1.5 text-green-600 hover:bg-green-50 rounded transition-colors border border-transparent hover:border-green-200"
                                          title="Edit Contract"
                                          aria-label="Edit Contract"
                                        >
                                          <Edit2 className="h-4 w-4" />
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => handleRenewContract(contract)}
                                          className="p-1.5 text-purple-600 hover:bg-purple-50 rounded transition-colors border border-transparent hover:border-purple-200"
                                          title="Renew/Resign Contract"
                                          aria-label="Renew Contract"
                                        >
                                          <RotateCw className="h-4 w-4" />
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => handleDeleteContract(contract)}
                                          className="p-1.5 text-red-600 hover:bg-red-50 rounded transition-colors border border-transparent hover:border-red-200"
                                          title="Delete Contract"
                                          aria-label="Delete Contract"
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
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* View Contract Modal */}
          {viewingContract && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
              <div className="bg-white rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
                <div className="p-6">
                  <div className="flex items-center justify-between mb-6">
                    <h3 className="text-xl font-bold text-gray-900">Contract Details</h3>
                    <button
                      onClick={() => setViewingContract(null)}
                      className="text-gray-400 hover:text-gray-600"
                    >
                      <X className="h-6 w-6" />
                    </button>
                  </div>
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="text-sm font-medium text-gray-500">Contract Number</label>
                        <p className="text-sm text-gray-900 font-semibold">{viewingContract.contract_number}</p>
                      </div>
                      <div>
                        <label className="text-sm font-medium text-gray-500">Status</label>
                        <p>
                          <span className={`px-2 py-1 text-xs font-semibold rounded-full ${getStatusBadge(viewingContract.status)}`}>
                            {viewingContract.status.toUpperCase()}
                          </span>
                        </p>
                      </div>
                      <div>
                        <label className="text-sm font-medium text-gray-500">Contract Date</label>
                        <p className="text-sm text-gray-900">{formatDateOnly(viewingContract.contract_date)}</p>
                      </div>
                      <div>
                        <label className="text-sm font-medium text-gray-500">Expiry Date</label>
                        <p className={`text-sm ${isExpiringSoon(viewingContract.expiry_date) ? 'text-red-600 font-semibold' : 'text-gray-900'}`}>
                          {formatDateOnly(viewingContract.expiry_date)}
                        </p>
                      </div>
                      <div>
                        <label className="text-sm font-medium text-gray-500">Total Value</label>
                        <p className="text-sm text-gray-900 font-semibold">
                          {formatCurrency(viewingContract.total_contract_value, viewingContract.currency)}
                        </p>
                      </div>
                      <div>
                        <label className="text-sm font-medium text-gray-500">Billing Period</label>
                        <p className="text-sm text-gray-900 capitalize">{viewingContract.billing_period}</p>
                      </div>
                      {viewingContract.license_type && (
                        <div>
                          <label className="text-sm font-medium text-gray-500">License Type</label>
                          <p className="text-sm text-gray-900">{viewingContract.license_type}</p>
                        </div>
                      )}
                      {viewingContract.auto_renewal === 'true' && (
                        <div>
                          <label className="text-sm font-medium text-gray-500">Auto Renewal</label>
                          <p className="text-sm text-green-600 font-semibold">Enabled</p>
                        </div>
                      )}
                    </div>
                    {viewingContract.broadcast_message && (
                      <div>
                        <label className="text-sm font-medium text-gray-500">Broadcast Message</label>
                        <p className="text-sm text-gray-900 mt-1">{viewingContract.broadcast_message}</p>
                      </div>
                    )}
                    {viewingContract.terms_and_conditions && (
                      <div>
                        <label className="text-sm font-medium text-gray-500">Terms and Conditions</label>
                        <p className="text-sm text-gray-900 mt-1 whitespace-pre-wrap">{viewingContract.terms_and_conditions}</p>
                      </div>
                    )}
                    {viewingContract.notes && (
                      <div>
                        <label className="text-sm font-medium text-gray-500">Notes</label>
                        <p className="text-sm text-gray-900 mt-1 whitespace-pre-wrap">{viewingContract.notes}</p>
                      </div>
                    )}
                  </div>
                  <div className="mt-6 flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => viewingContract && handlePrintContract(viewingContract)}
                      className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                    >
                      <Printer className="h-4 w-4" />
                      Print
                    </button>
                    <button
                      type="button"
                      onClick={() => setViewingContract(null)}
                      className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300"
                    >
                      Close
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Create/Edit Contract Modal */}
          {showContractModal && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
              <div className="bg-white rounded-lg max-w-4xl w-full max-h-[90vh] overflow-y-auto">
                <div className="p-6">
                  <div className="flex items-center justify-between mb-6">
                    <h3 className="text-xl font-bold text-gray-900">
                      {editingContract ? 'Edit Contract' : 'Create New Contract'}
                    </h3>
                    <button
                      onClick={() => setShowContractModal(false)}
                      className="text-gray-400 hover:text-gray-600"
                    >
                      <X className="h-6 w-6" />
                    </button>
                  </div>

                  <form onSubmit={handleSubmitContract} className="space-y-6">
                    <div className="grid grid-cols-2 gap-4">
                      {/* Company */}
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Company *
                        </label>
                        <select
                          value={formData.company_id}
                          onChange={(e) => handleCompanyChange(e.target.value)}
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
                        {formData.company_id && !editingContract && (
                          <p className="text-xs text-blue-600 mt-1">
                            ✓ Fields auto-filled from company information
                          </p>
                        )}
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
                          placeholder="e.g., Enterprise, Professional"
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
                          <option value="quarterly">Quarterly</option>
                          <option value="half_yearly">Half Yearly</option>
                          <option value="yearly">Yearly</option>
                        </select>
                      </div>

                      {/* Currency */}
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Currency *
                        </label>
                        <input
                          type="text"
                          value={formData.currency}
                          onChange={(e) => setFormData({ ...formData, currency: e.target.value.toUpperCase() })}
                          className="w-full border border-gray-300 rounded-md px-3 py-2"
                          required
                          maxLength={3}
                        />
                      </div>

                      {/* Total Contract Value */}
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Total Contract Value *
                        </label>
                        <input
                          type="number"
                          step="0.01"
                          value={formData.total_contract_value}
                          onChange={(e) => setFormData({ ...formData, total_contract_value: e.target.value })}
                          className="w-full border border-gray-300 rounded-md px-3 py-2"
                          required
                        />
                      </div>

                      {/* Amount Per Month */}
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Amount Per Month
                        </label>
                        <input
                          type="number"
                          step="0.01"
                          value={formData.amount_per_month}
                          onChange={(e) => setFormData({ ...formData, amount_per_month: e.target.value })}
                          className="w-full border border-gray-300 rounded-md px-3 py-2"
                        />
                      </div>

                      {/* Amount Per Year */}
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Amount Per Year
                        </label>
                        <input
                          type="number"
                          step="0.01"
                          value={formData.amount_per_year}
                          onChange={(e) => setFormData({ ...formData, amount_per_year: e.target.value })}
                          className="w-full border border-gray-300 rounded-md px-3 py-2"
                        />
                      </div>

                      {/* Duration Months */}
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Duration (Months)
                        </label>
                        <input
                          type="number"
                          value={formData.duration_months}
                          onChange={(e) => setFormData({ ...formData, duration_months: e.target.value })}
                          className="w-full border border-gray-300 rounded-md px-3 py-2"
                        />
                      </div>

                      {/* Duration Years */}
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Duration (Years)
                        </label>
                        <input
                          type="number"
                          value={formData.duration_years}
                          onChange={(e) => setFormData({ ...formData, duration_years: e.target.value })}
                          className="w-full border border-gray-300 rounded-md px-3 py-2"
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
                        placeholder="Message to broadcast to the company"
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
                        placeholder="Message to send for payment reminders"
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

                    <div className="flex justify-end space-x-3 pt-4 border-t">
                      <button
                        type="button"
                        onClick={() => setShowContractModal(false)}
                        className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                      >
                        {editingContract ? 'Save Changes' : 'Create Contract'}
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default function ContractsPage() {
  return (
    <CompanyProvider>
      <ContractsPageContent />
    </CompanyProvider>
  )
}
