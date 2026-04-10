'use client'

import { Suspense, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Sidebar from '@/components/Sidebar'
import { CompanyProvider, useCompany } from '@/contexts/CompanyContext'
import { Building2, Plus, Edit2, Trash2, X, Shield, Crown, Calendar, RefreshCw, Eye, EyeOff, UserCog, Database, Upload } from 'lucide-react'
import { useToast } from '@/components/Toast'
import api from '@/lib/api'
import { formatCurrency } from '@/utils/currency'
import { getCurrenciesByCountry } from '@/utils/currencies'
import { safeLogError, isConnectionError } from '@/utils/connectionError'
import {
  COMPANY_DATE_FORMAT_OPTIONS,
  COMPANY_TIME_FORMAT_OPTIONS,
  DEFAULT_COMPANY_DATE_FORMAT,
  DEFAULT_COMPANY_TIME_FORMAT,
  formatCompanyDate,
  formatCompanyTime,
} from '@/utils/companyLocaleFormats'
import { formatDateOnly } from '@/utils/date'
import {
  RESTORE_CONFIRM_PHRASE,
  downloadTenantBackupForAdminCompany,
  restoreTenantBackupForAdminCompany,
} from '@/utils/tenantBackup'
import { useRequireSaasDashboardMode } from '@/hooks/useRequireSaasDashboardMode'

interface SubscriptionData {
  id: number
  status: string
  plan_name: string | null
  plan_code: string | null
  billing_cycle: string
  current_period_start: string | null
  current_period_end: string | null
  trial_end_date: string | null
  days_until_expiry: number | null
  is_expired: boolean
  price: number
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
  is_master?: string
  created_at: string
  user_count: number
  station_count: number
  customer_count: number
  has_subscription: boolean
  subscription_active: boolean
  subscription: SubscriptionData | null
  subscription_ledger_balance?: number
  subscription_outstanding?: number
  subscription_total_billed?: number
  subscription_total_paid?: number
  ledger_balance?: number
  accounts_receivable?: number
  accounts_payable?: number
  net_due_amount?: number
  monthly_charge?: number
  yearly_charge?: number
  has_active_contract?: boolean
  contact_person?: string
  payment_type?: string
  payment_start_date?: string
  payment_end_date?: string
  payment_amount?: string
  /** Display pattern for dates across the tenant (see companyLocaleFormats). */
  date_format?: string
  /** Display pattern for times (24h or 12h). */
  time_format?: string
  capacity_limits?: {
    stations?: number
    users?: number
    storage_gb?: number
  }
  capacity_usage?: {
    stations?: { used: number; limit: number; percentage: number }
    users?: { used: number; limit: number; percentage: number }
    storage_gb?: { used: number; limit: number; percentage: number }
  }
}

function CompaniesPageContent() {
  const searchParams = useSearchParams()
  const toast = useToast()
  useRequireSaasDashboardMode()
  const { mode } = useCompany()
  const [companies, setCompanies] = useState<Company[]>([])
  const [loading, setLoading] = useState(true)
  const [showCompanyModal, setShowCompanyModal] = useState(false)
  const [showCompanyViewModal, setShowCompanyViewModal] = useState(false)
  const [editingCompany, setEditingCompany] = useState<Company | null>(null)
  const [viewingCompany, setViewingCompany] = useState<Company | null>(null)
  const [showAdminPassword, setShowAdminPassword] = useState(false)
  const [showAdminConfirmPassword, setShowAdminConfirmPassword] = useState(false)
  const [companySearch, setCompanySearch] = useState('')
  const [restoreModalCompany, setRestoreModalCompany] = useState<Company | null>(null)
  const [restorePhrase, setRestorePhrase] = useState('')
  const [restoreBusy, setRestoreBusy] = useState(false)
  const restoreFileRef = useRef<HTMLInputElement>(null)
  const [backupDownloadBusyId, setBackupDownloadBusyId] = useState<number | null>(null)

  const [companyFormData, setCompanyFormData] = useState({
    company_name: '',
    legal_name: '',
    email: '',
    phone: '',
    subdomain: '',
    custom_domain: '',
    currency: 'BDT',
    date_format: DEFAULT_COMPANY_DATE_FORMAT,
    time_format: DEFAULT_COMPANY_TIME_FORMAT,
    is_active: true,
    contact_person: '',
    payment_type: '',
    payment_start_date: '',
    payment_end_date: '',
    payment_amount: '',
    admin_email: '',
    admin_full_name: '',
    admin_password: '',
    admin_confirm_password: ''
  })

  useEffect(() => {
    const q = searchParams.get('search')
    if (q != null && q !== '') {
      setCompanySearch(decodeURIComponent(q))
    }
  }, [searchParams])

  useEffect(() => {
    if (mode === 'saas_dashboard') {
      fetchCompanies()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode])

  const fetchCompanies = async () => {
    try {
      setLoading(true)
      const response = await api.get('/admin/companies/', { params: { limit: 500 } })
      if (response.data) {
        const companiesWithMaster = response.data.map((c: any) => ({
          ...c,
          is_master:
            c.is_master === true || String(c.is_master || '').toLowerCase() === 'true'
              ? 'true'
              : 'false',
        }))
        setCompanies(companiesWithMaster)
      }
    } catch (error: any) {
      safeLogError('Error fetching companies:', error)
      if (!isConnectionError(error)) {
      toast.error('Failed to load companies')
      }
    } finally {
      setLoading(false)
    }
  }

  const handleCreateCompany = () => {
    setEditingCompany(null)
    setCompanyFormData({
      company_name: '',
      legal_name: '',
      email: '',
      phone: '',
      subdomain: '',
      custom_domain: '',
      currency: 'BDT',
      date_format: DEFAULT_COMPANY_DATE_FORMAT,
      time_format: DEFAULT_COMPANY_TIME_FORMAT,
      is_active: true,
      contact_person: '',
      payment_type: '',
      payment_start_date: '',
      payment_end_date: '',
      payment_amount: '',
      admin_email: '',
      admin_full_name: '',
      admin_password: '',
      admin_confirm_password: ''
    })
    setShowCompanyModal(true)
  }

  const handleEditCompany = (company: Company) => {
    setEditingCompany(company)
    setCompanyFormData({
      company_name: company.name,
      legal_name: company.legal_name || '',
      email: company.email || '',
      phone: company.phone || '',
      subdomain: company.subdomain || '',
      custom_domain: company.custom_domain || '',
      currency: company.currency || 'BDT',
      date_format: company.date_format || DEFAULT_COMPANY_DATE_FORMAT,
      time_format: company.time_format || DEFAULT_COMPANY_TIME_FORMAT,
      is_active: company.is_active,
      contact_person: company.contact_person || '',
      payment_type: company.payment_type || '',
      payment_start_date: company.payment_start_date ? new Date(company.payment_start_date).toISOString().split('T')[0] : '',
      payment_end_date: company.payment_end_date ? new Date(company.payment_end_date).toISOString().split('T')[0] : '',
      payment_amount: company.payment_amount || '',
      admin_email: '',
      admin_full_name: '',
      admin_password: '',
      admin_confirm_password: ''
    })
    setShowCompanyModal(true)
  }

  const handleSubmitCompany = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!companyFormData.company_name) {
      toast.error('Company name is required')
      return
    }

    if (!editingCompany) {
      if (!companyFormData.admin_email?.trim()) {
        toast.error('Company administrator email is required (login username)')
        return
      }
      if (!companyFormData.admin_password || companyFormData.admin_password.length < 6) {
        toast.error('Administrator password must be at least 6 characters')
        return
      }
      if (companyFormData.admin_password !== companyFormData.admin_confirm_password) {
        toast.error('Administrator passwords do not match')
        return
      }
    }

    try {
      if (editingCompany) {
        const { admin_email, admin_full_name, admin_password, admin_confirm_password, ...rest } = companyFormData
        await api.put(`/companies/${editingCompany.id}`, rest)
        toast.success('Company updated successfully!')
      } else {
        const { admin_confirm_password, ...payload } = companyFormData
        const res = await api.post('/companies/', payload)
        const adminEmail = res.data?.company_admin?.email || companyFormData.admin_email
        toast.success(
          `Company created. Owner can log in as ${adminEmail} to add staff and manage passwords.`
        )
      }
      setShowCompanyModal(false)
      await fetchCompanies()
    } catch (error: any) {
      const errorMsg = error.response?.data?.detail || error.response?.data?.message || 'Failed to save company'
      toast.error(errorMsg)
      safeLogError('Company error:', error)
    }
  }

  const handleDeleteCompany = async (company: Company) => {
    if (!confirm(`Are you sure you want to delete company "${company.name}"? This action cannot be undone and will delete all associated data.`)) {
      return
    }

    try {
      await api.delete(`/companies/${company.id}`)
      toast.success('Company deleted successfully!')
      await fetchCompanies()
    } catch (error: any) {
      const errorMsg = error.response?.data?.detail || error.response?.data?.message || 'Failed to delete company'
      toast.error(errorMsg)
      safeLogError('Delete company error:', error)
    }
  }

  const handleManageSubscription = async (company: Company) => {
    // This would open subscription management modal
    toast.info('Subscription management feature coming soon')
  }

  const handleAdminTenantBackupDownload = async (company: Company) => {
    setBackupDownloadBusyId(company.id)
    try {
      await downloadTenantBackupForAdminCompany(api, company.id)
      toast.success(`Backup downloaded for ${company.name}`)
    } catch (error: unknown) {
      const msg =
        (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
        'Failed to download backup'
      toast.error(msg)
      safeLogError('Tenant backup download:', error)
    } finally {
      setBackupDownloadBusyId(null)
    }
  }

  const openRestoreModal = (company: Company) => {
    setRestoreModalCompany(company)
    setRestorePhrase('')
  }

  const runRestoreFilePick = () => {
    if (!restoreModalCompany) return
    if (restorePhrase.trim() !== RESTORE_CONFIRM_PHRASE) {
      toast.error(`Type the confirmation phrase exactly: ${RESTORE_CONFIRM_PHRASE}`)
      return
    }
    restoreFileRef.current?.click()
  }

  const onRestoreFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    const company = restoreModalCompany
    if (!file || !company) return
    if (
      !window.confirm(
        `Replace ALL data for "${company.name}" (ID ${company.id}) from this backup? This cannot be undone.`
      )
    ) {
      return
    }
    setRestoreBusy(true)
    try {
      const res = await restoreTenantBackupForAdminCompany(api, company.id, file, RESTORE_CONFIRM_PHRASE)
      toast.success(`Restored ${res.data?.restored_objects ?? ''} records for ${company.name}`)
      setRestoreModalCompany(null)
      setRestorePhrase('')
      await fetchCompanies()
    } catch (error: unknown) {
      const msg =
        (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'Restore failed'
      toast.error(msg)
      safeLogError('Tenant restore:', error)
    } finally {
      setRestoreBusy(false)
    }
  }

  const filteredCompanies = companies.filter((c) => {
    const q = companySearch.trim().toLowerCase()
    if (!q) return true
    return (
      (c.name && c.name.toLowerCase().includes(q)) ||
      (c.legal_name && c.legal_name.toLowerCase().includes(q)) ||
      String(c.id).includes(q)
    )
  })

  if (mode !== 'saas_dashboard') {
    return (
      <div className="flex h-screen bg-gray-100 page-with-sidebar">
        <Sidebar />
        <div className="flex min-h-0 flex-1 overflow-y-auto p-4 sm:p-8">
          <div className="bg-white rounded-lg shadow p-8 text-center">
            <p className="text-gray-600">Please switch to SaaS Dashboard mode to manage companies.</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-screen bg-gray-100 page-with-sidebar">
      <Sidebar />
      <div className="flex min-h-0 flex-1 overflow-y-auto">
        <div className="w-full min-w-0 p-4 sm:p-6 lg:p-8">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-lg font-bold text-gray-900 sm:text-xl">All Companies</h2>
            <button
              type="button"
              onClick={handleCreateCompany}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 sm:w-auto"
            >
              <Plus className="h-5 w-5 shrink-0" />
              <span>New company</span>
            </button>
          </div>

          <div className="mb-4">
            <label htmlFor="company-search" className="sr-only">
              Search companies
            </label>
            <input
              id="company-search"
              type="search"
              value={companySearch}
              onChange={(e) => setCompanySearch(e.target.value)}
              placeholder="Search by company name, legal name, or ID…"
              className="w-full max-w-md rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
            />
          </div>
          
          {/* Info Banner */}
          <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 p-4">
            <div className="flex items-start gap-3">
              <Crown className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
              <div className="text-sm text-amber-950">
                <p className="font-medium text-amber-900">Looking for Master Filling Station?</p>
                <p className="mt-1 text-amber-900/90">
                  It is the usual <strong>development / master</strong> tenant (yellow <strong>Master</strong> badge).
                  Use the search box above if the list is long. This page only loads in{' '}
                  <strong>SaaS Dashboard</strong> mode (use the sidebar tabs).
                </p>
                <p className="mt-2 text-amber-900/85">
                  If it is missing from the database, from the <code className="rounded bg-amber-100/80 px-1">backend</code>{' '}
                  folder run{' '}
                  <code className="rounded bg-amber-100/80 px-1 text-xs">
                    python manage.py seed_master_chart_of_accounts
                  </code>{' '}
                  or, if you still have an old &quot;Default Company&quot; row,{' '}
                  <code className="rounded bg-amber-100/80 px-1 text-xs">
                    python manage.py promote_default_to_master
                  </code>
                  .
                </p>
              </div>
            </div>
          </div>

          <div className="mb-6 bg-blue-50 border border-blue-200 rounded-lg p-4">
            <div className="flex items-start">
              <div className="flex-shrink-0">
                <Shield className="h-5 w-5 text-blue-600 mt-0.5" />
              </div>
              <div className="ml-3">
                <h3 className="text-sm font-medium text-blue-900">Maintenance & Upgrades</h3>
                <div className="mt-2 text-sm text-blue-700">
                  <p>
                    All subscribed companies receive <strong>free maintenance and upgrades</strong> while their subscription is active and continuing. 
                    This includes system updates, feature enhancements, security patches, and technical support.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Companies Grid */}
          {loading ? (
            <div className="bg-white rounded-lg shadow p-8 text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
              <p className="text-gray-600">Loading companies...</p>
            </div>
          ) : companies.length === 0 ? (
            <div className="bg-white rounded-lg shadow p-8 text-center">
              <Building2 className="h-12 w-12 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-600 text-lg mb-2">No companies found</p>
              <p className="text-gray-500 text-sm mb-4">Create your first company to get started</p>
              <button
                onClick={handleCreateCompany}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                Create Company
              </button>
            </div>
          ) : filteredCompanies.length === 0 ? (
            <div className="rounded-lg border border-gray-200 bg-white p-8 text-center text-gray-600">
              <p>No companies match &quot;{companySearch.trim()}&quot;.</p>
              <button
                type="button"
                className="mt-3 text-sm font-medium text-blue-600 hover:text-blue-800"
                onClick={() => setCompanySearch('')}
              >
                Clear search
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-6">
              {filteredCompanies
                .sort((a, b) => {
                  if (a.is_master === 'true' && b.is_master !== 'true') return -1
                  if (a.is_master !== 'true' && b.is_master === 'true') return 1
                  return a.name.localeCompare(b.name)
                })
                .map((company) => {
                  const statusColor = company.is_active 
                    ? (company.subscription_active ? 'bg-green-50 border-green-200' : 'bg-blue-50 border-blue-200')
                    : 'bg-red-50 border-red-200'
                  
                  const capacityStations = company.capacity_usage?.stations
                  const capacityUsers = company.capacity_usage?.users
                  
                  return (
                    <div key={company.id} className={`bg-white rounded-xl shadow-lg border-2 ${statusColor} transition-all hover:shadow-xl`}>
                      <div className="p-6">
                        {/* Header Row */}
                        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                          <div className="min-w-0 flex-1">
                            <div className="mb-2 flex flex-wrap items-center gap-2">
                              {company.is_master === 'true' && (
                                <Crown className="h-6 w-6 shrink-0 text-yellow-600" />
                              )}
                              <h3 className="min-w-0 text-lg font-bold text-gray-900 sm:text-xl">{company.name}</h3>
                              {company.is_master === 'true' && (
                                <span className="rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-semibold text-yellow-800 sm:px-3 sm:py-1">
                                  Master
                                </span>
                              )}
                              <span
                                className={`rounded-full px-2 py-0.5 text-xs font-semibold sm:px-3 sm:py-1 ${
                                  company.is_active ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                                }`}
                              >
                                {company.is_active ? 'Active' : 'Inactive'}
                              </span>
                              {company.subscription_active && (
                                <span className="flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-800 sm:px-3 sm:py-1">
                                  <Crown className="mr-1 h-3 w-3" />
                                  Subscribed
                                </span>
                              )}
                            </div>
                            {company.legal_name && (
                              <p className="text-sm text-gray-600">{company.legal_name}</p>
                            )}
                          </div>
                          <div className="flex shrink-0 flex-wrap items-center gap-1 sm:justify-end sm:gap-2">
                            {company.subscription && (
                              <button
                                onClick={() => handleManageSubscription(company)}
                                className={`p-2 rounded-lg transition-colors ${
                                  company.subscription.is_expired || (company.subscription.days_until_expiry !== null && company.subscription.days_until_expiry <= 7)
                                    ? 'text-orange-600 hover:bg-orange-50'
                                    : 'text-green-600 hover:bg-green-50'
                                }`}
                                title="Manage Subscription"
                              >
                                <RefreshCw className="h-5 w-5" />
                              </button>
                            )}
                            <button
                              onClick={() => {
                                setViewingCompany(company)
                                setShowCompanyViewModal(true)
                              }}
                              className="p-2 text-green-600 hover:bg-green-50 rounded-lg transition-colors"
                              title="View Company Details"
                            >
                              <Eye className="h-5 w-5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleAdminTenantBackupDownload(company)}
                              disabled={backupDownloadBusyId === company.id}
                              className="p-2 text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors disabled:opacity-50"
                              title="Download tenant backup (JSON)"
                            >
                              <Database className="h-5 w-5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => openRestoreModal(company)}
                              className="p-2 text-amber-700 hover:bg-amber-50 rounded-lg transition-colors"
                              title="Restore tenant from backup"
                            >
                              <Upload className="h-5 w-5" />
                            </button>
                            <button
                              onClick={() => handleEditCompany(company)}
                              className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                              title="Edit Company"
                            >
                              <Edit2 className="h-5 w-5" />
                            </button>
                            <button
                              onClick={() => handleDeleteCompany(company)}
                              className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                              title="Delete Company"
                            >
                              <Trash2 className="h-5 w-5" />
                            </button>
                          </div>
                        </div>

                        {/* Main Content Grid */}
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                          {/* Contact & Domain */}
                          <div className="space-y-3">
                            <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Contact & Domain</h4>
                            <div className="space-y-2">
                              <div className="flex items-center space-x-2">
                                <span className="text-sm text-gray-600">Email:</span>
                                <span className="text-sm font-medium text-gray-900">{company.email || '-'}</span>
                              </div>
                              <div className="flex items-center space-x-2">
                                <span className="text-sm text-gray-600">Phone:</span>
                                <span className="text-sm font-medium text-gray-900">{company.phone || '-'}</span>
                              </div>
                              {company.subdomain && (
                                <div className="flex items-center space-x-2">
                                  <span className="text-sm text-gray-600">Subdomain:</span>
                                  <span className="text-sm font-medium text-blue-600">{company.subdomain}.yourdomain.com</span>
                                </div>
                              )}
                              {company.custom_domain && (
                                <div className="flex items-center space-x-2">
                                  <span className="text-sm text-gray-600">Domain:</span>
                                  <span className="text-sm font-medium text-blue-600">{company.custom_domain}</span>
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Statistics & Capacity */}
                          <div className="space-y-3">
                            <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Statistics & Capacity</h4>
                            <div className="space-y-3">
                              {/* Users Capacity */}
                              <div>
                                <div className="flex justify-between items-center mb-1">
                                  <span className="text-sm text-gray-600">Users</span>
                                  <span className="text-sm font-semibold text-gray-900">
                                    {company.user_count}{capacityUsers ? ` / ${capacityUsers.limit}` : ''}
                                  </span>
                                </div>
                                {capacityUsers && (
                                  <div className="w-full bg-gray-200 rounded-full h-2">
                                    <div 
                                      className={`h-2 rounded-full transition-all ${
                                        capacityUsers.percentage >= 90 ? 'bg-red-500' :
                                        capacityUsers.percentage >= 70 ? 'bg-yellow-500' :
                                        'bg-green-500'
                                      }`}
                                      style={{ width: `${Math.min(100, capacityUsers.percentage)}%` }}
                                    ></div>
                                  </div>
                                )}
                              </div>
                              
                              {/* Stations Capacity */}
                              <div>
                                <div className="flex justify-between items-center mb-1">
                                  <span className="text-sm text-gray-600">Stations</span>
                                  <span className="text-sm font-semibold text-gray-900">
                                    {company.station_count}{capacityStations ? ` / ${capacityStations.limit}` : ''}
                                  </span>
                                </div>
                                {capacityStations && (
                                  <div className="w-full bg-gray-200 rounded-full h-2">
                                    <div 
                                      className={`h-2 rounded-full transition-all ${
                                        capacityStations.percentage >= 90 ? 'bg-red-500' :
                                        capacityStations.percentage >= 70 ? 'bg-yellow-500' :
                                        'bg-green-500'
                                      }`}
                                      style={{ width: `${Math.min(100, capacityStations.percentage)}%` }}
                                    ></div>
                                  </div>
                                )}
                              </div>
                              
                              {/* Customers */}
                              <div className="flex justify-between items-center">
                                <span className="text-sm text-gray-600">Customers</span>
                                <span className="text-sm font-semibold text-gray-900">{company.customer_count}</span>
                              </div>
                            </div>
                          </div>

                          {/* SaaS Subscription Ledger */}
                          <div className="space-y-3">
                            <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">SaaS Subscription Ledger</h4>
                            <div className="space-y-3">
                              <div className="bg-green-50 rounded-lg p-3 border border-green-200">
                                <div className="text-xs text-gray-500 mb-1">Subscription Revenue</div>
                                <div className="text-lg font-bold text-green-700">
                                  {formatCurrency(company.subscription_total_paid || company.ledger_balance || 0, company.currency || 'BDT')}
                                </div>
                              </div>
                              
                              <div className={`rounded-lg p-3 border ${
                                (company.subscription_outstanding || company.accounts_receivable || 0) > 0
                                  ? 'bg-red-50 border-red-200'
                                  : 'bg-gray-50 border-gray-200'
                              }`}>
                                <div className="text-xs text-gray-500 mb-1">Outstanding</div>
                                <div className={`text-lg font-bold ${
                                  (company.subscription_outstanding || company.accounts_receivable || 0) > 0
                                    ? 'text-red-700'
                                    : 'text-gray-900'
                                }`}>
                                  {formatCurrency(company.subscription_outstanding || company.accounts_receivable || 0, company.currency || 'BDT')}
                                </div>
                              </div>
                            </div>
                          </div>

                          {/* Subscription & Charges */}
                          <div className="space-y-3">
                            <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Subscription & Charges</h4>
                            <div className="space-y-3">
                              {company.subscription ? (
                                <div className="bg-blue-50 rounded-lg p-3">
                                  <div className="text-xs text-gray-500 mb-1">Plan</div>
                                  <div className="text-sm font-bold text-gray-900 mb-2">{company.subscription.plan_name || 'N/A'}</div>
                                  <div className={`text-xs font-semibold mb-2 ${
                                    company.subscription.status === 'active' ? 'text-green-600' :
                                    company.subscription.status === 'expired' ? 'text-red-600' :
                                    'text-yellow-600'
                                  }`}>
                                    {company.subscription.status.toUpperCase()}
                                  </div>
                                  {company.subscription.current_period_end && (
                                    <div className={`text-xs flex items-center ${
                                      company.subscription.is_expired 
                                        ? 'text-red-600 font-semibold' 
                                        : company.subscription.days_until_expiry !== null && company.subscription.days_until_expiry <= 7
                                        ? 'text-orange-600 font-semibold'
                                        : 'text-gray-600'
                                    }`}>
                                      <Calendar className="h-3 w-3 inline mr-1" />
                                      {company.subscription.is_expired ? (
                                        <span>Expired {formatDateOnly(company.subscription.current_period_end)}</span>
                                      ) : (
                                        <span>
                                          {company.subscription.days_until_expiry !== null && company.subscription.days_until_expiry <= 0
                                            ? 'Expires today'
                                            : company.subscription.days_until_expiry !== null
                                            ? `${company.subscription.days_until_expiry} days left`
                                            : formatDateOnly(company.subscription.current_period_end)}
                                        </span>
                                      )}
                                    </div>
                                  )}
                                </div>
                              ) : (
                                <div className="bg-gray-50 rounded-lg p-3">
                                  <div className="text-xs text-gray-400">No subscription</div>
                                </div>
                              )}
                              
                              <div className="bg-purple-50 rounded-lg p-3">
                                <div className="text-xs text-gray-500 mb-1">Monthly Charges</div>
                                {company.monthly_charge ? (
                                  <div className="text-lg font-bold text-purple-900">
                                    {formatCurrency(company.monthly_charge, company.currency || 'BDT')}/mo
                                  </div>
                                ) : company.yearly_charge ? (
                                  <>
                                    <div className="text-lg font-bold text-purple-900">
                                      {formatCurrency(company.yearly_charge, company.currency || 'BDT')}/yr
                                    </div>
                                    <div className="text-xs text-gray-600 mt-1">
                                      ({formatCurrency(company.yearly_charge / 12, company.currency || 'BDT')}/mo)
                                    </div>
                                  </>
                                ) : (
                                  <div className="text-sm text-gray-400">No charges</div>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                })}
            </div>
          )}

          {/* Company View Modal - Simplified version */}
          {showCompanyViewModal && viewingCompany && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
              <div className="bg-white rounded-xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-y-auto">
                <div className="bg-gradient-to-r from-green-600 to-green-700 px-6 py-4 sticky top-0 z-10 flex items-center justify-between rounded-t-xl">
                  <h2 className="text-2xl font-bold text-white flex items-center space-x-2">
                    <Eye className="h-6 w-6" />
                    <span>Company Details - {viewingCompany.name}</span>
                  </h2>
                  <button
                    onClick={() => {
                      setShowCompanyViewModal(false)
                      setViewingCompany(null)
                    }}
                    className="p-2 hover:bg-white/20 rounded-full transition-colors"
                  >
                    <X className="h-5 w-5 text-white" />
                  </button>
                </div>

                <div className="p-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-4">
                      <h3 className="text-lg font-semibold text-gray-900 border-b pb-2">Basic Information</h3>
                      <div className="space-y-3">
                        <div>
                          <label className="text-sm font-medium text-gray-500">Company Name</label>
                          <p className="text-base text-gray-900 mt-1">{viewingCompany.name}</p>
                        </div>
                        {viewingCompany.legal_name && (
                          <div>
                            <label className="text-sm font-medium text-gray-500">Legal Name</label>
                            <p className="text-base text-gray-900 mt-1">{viewingCompany.legal_name}</p>
                          </div>
                        )}
                        <div>
                          <label className="text-sm font-medium text-gray-500">Email</label>
                          <p className="text-base text-gray-900 mt-1">{viewingCompany.email || '-'}</p>
                        </div>
                        <div>
                          <label className="text-sm font-medium text-gray-500">Phone</label>
                          <p className="text-base text-gray-900 mt-1">{viewingCompany.phone || '-'}</p>
                        </div>
                        {viewingCompany.contact_person && (
                          <div>
                            <label className="text-sm font-medium text-gray-500">Contact Person</label>
                            <p className="text-base text-gray-900 mt-1">{viewingCompany.contact_person}</p>
                          </div>
                        )}
                        <div>
                          <label className="text-sm font-medium text-gray-500">Currency</label>
                          <p className="text-base text-gray-900 mt-1">{viewingCompany.currency || 'BDT'}</p>
                        </div>
                        <div>
                          <label className="text-sm font-medium text-gray-500">Date format</label>
                          <p className="text-base text-gray-900 mt-1">
                            {viewingCompany.date_format || DEFAULT_COMPANY_DATE_FORMAT}
                            <span className="ml-2 text-sm font-normal text-gray-500">
                              (e.g. {formatCompanyDate('2026-04-06', viewingCompany.date_format || DEFAULT_COMPANY_DATE_FORMAT)})
                            </span>
                          </p>
                        </div>
                        <div>
                          <label className="text-sm font-medium text-gray-500">Time format</label>
                          <p className="text-base text-gray-900 mt-1">
                            {viewingCompany.time_format || DEFAULT_COMPANY_TIME_FORMAT}
                            <span className="ml-2 text-sm font-normal text-gray-500">
                              (e.g.{' '}
                              {formatCompanyTime(
                                new Date(2026, 3, 6, 14, 30),
                                viewingCompany.time_format || DEFAULT_COMPANY_TIME_FORMAT
                              )}
                              )
                            </span>
                          </p>
                        </div>
                        <div>
                          <label className="text-sm font-medium text-gray-500">Status</label>
                          <p className={`text-base font-semibold mt-1 ${viewingCompany.is_active ? 'text-green-600' : 'text-red-600'}`}>
                            {viewingCompany.is_active ? 'Active' : 'Inactive'}
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-4">
                      <h3 className="text-lg font-semibold text-gray-900 border-b pb-2">Payment Information</h3>
                      <div className="space-y-3">
                        {viewingCompany.payment_type && (
                          <div>
                            <label className="text-sm font-medium text-gray-500">Billing Cycle</label>
                            <p className="text-base text-gray-900 mt-1 capitalize">{viewingCompany.payment_type.replace('_', '-')}</p>
                          </div>
                        )}
                        {viewingCompany.payment_amount && (
                          <div>
                            <label className="text-sm font-medium text-gray-500">Payment Amount</label>
                            <p className="text-base font-semibold text-gray-900 mt-1">{viewingCompany.payment_amount}</p>
                          </div>
                        )}
                        {viewingCompany.payment_start_date && (
                          <div>
                            <label className="text-sm font-medium text-gray-500">Payment Start Date</label>
                            <p className="text-base text-gray-900 mt-1">
                              {formatDateOnly(viewingCompany.payment_start_date)}
                            </p>
                          </div>
                        )}
                        {viewingCompany.payment_end_date && (
                          <div>
                            <label className="text-sm font-medium text-gray-500">Payment End Date</label>
                            <p className="text-base text-gray-900 mt-1">
                              {formatDateOnly(viewingCompany.payment_end_date)}
                            </p>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-end space-x-3 pt-6 border-t mt-6">
                    <button
                      onClick={() => {
                        setShowCompanyViewModal(false)
                        setViewingCompany(null)
                      }}
                      className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                    >
                      Close
                    </button>
                    <button
                      onClick={() => {
                        setShowCompanyViewModal(false)
                        setViewingCompany(null)
                        handleEditCompany(viewingCompany)
                      }}
                      className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center space-x-2"
                    >
                      <Edit2 className="h-4 w-4" />
                      <span>Edit Company</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {restoreModalCompany && (
            <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4">
              <div className="w-full max-w-lg rounded-t-2xl bg-white shadow-2xl sm:rounded-xl">
                <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 sm:px-6">
                  <h2 className="text-lg font-bold text-gray-900">Restore tenant backup</h2>
                  <button
                    type="button"
                    onClick={() => {
                      setRestoreModalCompany(null)
                      setRestorePhrase('')
                    }}
                    className="rounded-full p-2 text-gray-500 hover:bg-gray-100"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>
                <div className="space-y-4 p-4 sm:p-6">
                  <p className="text-sm text-gray-700">
                    Company: <strong>{restoreModalCompany.name}</strong> (ID {restoreModalCompany.id})
                  </p>
                  <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900">
                    The backup file must be for <strong>company_id = {restoreModalCompany.id}</strong>. All current ERP
                    data for this tenant will be deleted before restore.
                  </p>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">
                      Type <code className="rounded bg-gray-100 px-1">{RESTORE_CONFIRM_PHRASE}</code>
                    </label>
                    <input
                      type="text"
                      value={restorePhrase}
                      onChange={(e) => setRestorePhrase(e.target.value)}
                      className="mt-2 w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-sm"
                      autoComplete="off"
                    />
                  </div>
                  <input
                    ref={restoreFileRef}
                    type="file"
                    accept=".json,application/json"
                    className="hidden"
                    onChange={onRestoreFileChange}
                  />
                  <div className="flex justify-end gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() => {
                        setRestoreModalCompany(null)
                        setRestorePhrase('')
                      }}
                      className="rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-gray-800 hover:bg-gray-200"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      disabled={restoreBusy || restorePhrase.trim() !== RESTORE_CONFIRM_PHRASE}
                      onClick={runRestoreFilePick}
                      className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {restoreBusy ? 'Restoring…' : 'Choose file & restore'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Company Modal */}
          {showCompanyModal && (
            <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4">
              <div className="flex max-h-[95vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:max-h-[90vh] sm:rounded-xl">
                <div className="sticky top-0 z-10 flex flex-shrink-0 items-center justify-between rounded-t-2xl bg-gradient-to-r from-blue-600 to-blue-700 px-4 py-3 sm:rounded-t-xl sm:px-6 sm:py-4">
                  <h2 className="text-lg font-bold text-white sm:text-2xl">
                    {editingCompany ? 'Edit Company' : 'New Company'}
                  </h2>
                  <button
                    onClick={() => setShowCompanyModal(false)}
                    className="p-2 hover:bg-white/20 rounded-full transition-colors"
                  >
                    <X className="h-5 w-5 text-white" />
                  </button>
                </div>

                <form onSubmit={handleSubmitCompany} className="flex-1 overflow-y-auto p-4 sm:p-6">
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Company Name <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="text"
                        required
                        value={companyFormData.company_name}
                        onChange={(e) => setCompanyFormData({ ...companyFormData, company_name: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Legal Name</label>
                      <input
                        type="text"
                        value={companyFormData.legal_name}
                        onChange={(e) => setCompanyFormData({ ...companyFormData, legal_name: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                    </div>

                    <div className="rounded-lg border border-gray-200 bg-gray-50/90 p-4 space-y-3">
                      <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Tenant URL (optional)</p>
                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Subdomain</label>
                          <input
                            type="text"
                            value={companyFormData.subdomain}
                            onChange={(e) =>
                              setCompanyFormData({
                                ...companyFormData,
                                subdomain: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''),
                              })
                            }
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white"
                            placeholder="acme"
                            autoComplete="off"
                          />
                          <p className="text-xs text-gray-500 mt-1">
                            <span className="font-mono">{'{subdomain}'}.yourplatform.com</span> after DNS is configured.
                          </p>
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Custom domain</label>
                          <input
                            type="text"
                            value={companyFormData.custom_domain}
                            onChange={(e) => {
                              let v = e.target.value.trim().toLowerCase()
                              v = v.replace(/^https?:\/\//, '').split('/')[0].split(':')[0] || ''
                              v = v.replace(/[^a-z0-9.-]/g, '')
                              setCompanyFormData({ ...companyFormData, custom_domain: v.slice(0, 253) })
                            }}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white"
                            placeholder="erp.client.com"
                            autoComplete="off"
                          />
                          <p className="text-xs text-gray-500 mt-1">Hostname only (no https://). CNAME to your app when ready.</p>
                        </div>
                      </div>
                    </div>

                    {!editingCompany && (
                      <div className="rounded-lg border-2 border-blue-200 bg-blue-50/80 p-4 space-y-4">
                        <div className="flex items-center gap-2 text-blue-900 font-semibold">
                          <UserCog className="h-5 w-5" />
                          Company administrator (first login)
                        </div>
                        <p className="text-sm text-blue-800">
                          This person is the company owner: they log in with the email below (same as username), set a password now, then can add Cashiers and Accountants and change passwords from their dashboard.
                        </p>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">
                            Admin email (username) <span className="text-red-500">*</span>
                          </label>
                          <input
                            type="email"
                            required={!editingCompany}
                            value={companyFormData.admin_email}
                            onChange={(e) => setCompanyFormData({ ...companyFormData, admin_email: e.target.value })}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white"
                            placeholder="owner@theircompany.com"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Admin full name</label>
                          <input
                            type="text"
                            value={companyFormData.admin_full_name}
                            onChange={(e) => setCompanyFormData({ ...companyFormData, admin_full_name: e.target.value })}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white"
                            placeholder="Defaults to contact person or company name if empty"
                          />
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">
                              Password <span className="text-red-500">*</span>
                            </label>
                            <div className="relative">
                              <input
                                type={showAdminPassword ? 'text' : 'password'}
                                required={!editingCompany}
                                value={companyFormData.admin_password}
                                onChange={(e) => setCompanyFormData({ ...companyFormData, admin_password: e.target.value })}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent pr-10 bg-white"
                                placeholder="Min. 6 characters"
                                minLength={6}
                              />
                              <button
                                type="button"
                                onClick={() => setShowAdminPassword(!showAdminPassword)}
                                className="absolute right-2 top-2.5 text-gray-500 hover:text-gray-700"
                              >
                                {showAdminPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                              </button>
                            </div>
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">
                              Confirm password <span className="text-red-500">*</span>
                            </label>
                            <div className="relative">
                              <input
                                type={showAdminConfirmPassword ? 'text' : 'password'}
                                required={!editingCompany}
                                value={companyFormData.admin_confirm_password}
                                onChange={(e) =>
                                  setCompanyFormData({ ...companyFormData, admin_confirm_password: e.target.value })
                                }
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent pr-10 bg-white"
                              />
                              <button
                                type="button"
                                onClick={() => setShowAdminConfirmPassword(!showAdminConfirmPassword)}
                                className="absolute right-2 top-2.5 text-gray-500 hover:text-gray-700"
                              >
                                {showAdminConfirmPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Company contact email</label>
                        <input
                          type="email"
                          value={companyFormData.email}
                          onChange={(e) => setCompanyFormData({ ...companyFormData, email: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                          placeholder="Optional — general company inbox"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Phone</label>
                        <input
                          type="text"
                          value={companyFormData.phone}
                          onChange={(e) => setCompanyFormData({ ...companyFormData, phone: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Contact Person</label>
                      <input
                        type="text"
                        value={companyFormData.contact_person}
                        onChange={(e) => setCompanyFormData({ ...companyFormData, contact_person: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        placeholder="Name of contact person"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Billing Cycle</label>
                        <select
                          value={companyFormData.payment_type}
                          onChange={(e) => setCompanyFormData({ ...companyFormData, payment_type: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        >
                          <option value="">Select billing cycle</option>
                          <option value="monthly">Monthly</option>
                          <option value="quarterly">Quarterly</option>
                          <option value="half_yearly">Half-Yearly</option>
                          <option value="yearly">Yearly</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Payment Amount</label>
                        <input
                          type="text"
                          value={companyFormData.payment_amount}
                          onChange={(e) => setCompanyFormData({ ...companyFormData, payment_amount: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                          placeholder="0.00"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Payment Start Date</label>
                        <input
                          type="date"
                          value={companyFormData.payment_start_date}
                          onChange={(e) => setCompanyFormData({ ...companyFormData, payment_start_date: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Payment End Date</label>
                        <input
                          type="date"
                          value={companyFormData.payment_end_date}
                          onChange={(e) => setCompanyFormData({ ...companyFormData, payment_end_date: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Currency</label>
                      <select
                        value={companyFormData.currency}
                        onChange={(e) => setCompanyFormData({ ...companyFormData, currency: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      >
                        {getCurrenciesByCountry().map((currency, index) => (
                          <option key={`${currency.code}-${currency.country}-${index}`} value={currency.code}>
                            {currency.code} - {currency.name} ({currency.country})
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Date format</label>
                        <select
                          value={companyFormData.date_format}
                          onChange={(e) =>
                            setCompanyFormData({ ...companyFormData, date_format: e.target.value })
                          }
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white"
                        >
                          {COMPANY_DATE_FORMAT_OPTIONS.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label} — e.g. {opt.example}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Time format</label>
                        <select
                          value={companyFormData.time_format}
                          onChange={(e) =>
                            setCompanyFormData({ ...companyFormData, time_format: e.target.value })
                          }
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white"
                        >
                          {COMPANY_TIME_FORMAT_OPTIONS.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label} — e.g. {opt.example}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <p className="text-xs text-gray-500 -mt-2">
                      Saved on the company record and returned from{' '}
                      <code className="rounded bg-gray-100 px-1">GET /api/companies/current</code> as{' '}
                      <code className="rounded bg-gray-100 px-1">date_format</code> and{' '}
                      <code className="rounded bg-gray-100 px-1">time_format</code>. Preview:{' '}
                      <span className="font-medium text-gray-700">
                        {formatCompanyDate('2026-04-06', companyFormData.date_format)} ·{' '}
                        {formatCompanyTime(new Date(2026, 3, 6, 14, 30), companyFormData.time_format)}
                      </span>
                    </p>

                    <div>
                      <label className="flex items-center space-x-2">
                        <input
                          type="checkbox"
                          checked={companyFormData.is_active}
                          onChange={(e) => setCompanyFormData({ ...companyFormData, is_active: e.target.checked })}
                          className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                        />
                        <span className="text-sm text-gray-700">Active</span>
                      </label>
                    </div>
                  </div>

                  <div className="flex items-center justify-end space-x-3 pt-6 border-t mt-6">
                    <button
                      type="button"
                      onClick={() => setShowCompanyModal(false)}
                      className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                    >
                      {editingCompany ? 'Update Company' : 'Create Company'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function CompaniesPageFallback() {
  return (
    <div className="flex h-screen bg-gray-100 page-with-sidebar">
      <Sidebar />
      <div className="flex-1 flex items-center justify-center text-gray-500 text-sm">Loading…</div>
    </div>
  )
}

export default function CompaniesPage() {
  return (
    <CompanyProvider>
      <Suspense fallback={<CompaniesPageFallback />}>
        <CompaniesPageContent />
      </Suspense>
    </CompanyProvider>
  )
}

