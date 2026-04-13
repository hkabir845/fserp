'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Sidebar from '@/components/Sidebar'
import CompanySwitcher from '@/components/CompanySwitcher'
import ContractManagement from '@/components/ContractManagement'
import SubscriptionLedger from '@/components/SubscriptionLedger'
import { CompanyProvider, useCompany } from '@/contexts/CompanyContext'
import {
  Building2,
  Users,
  BarChart3,
  Plus,
  Edit2,
  Trash2,
  X,
  Shield,
  TrendingUp,
  DollarSign,
  MapPin,
  Crown,
  Calendar,
  Clock,
  AlertTriangle,
  RefreshCw,
  Eye,
  EyeOff,
  Upload,
  FileText,
  Megaphone,
  Send,
  Ban,
  PlayCircle,
} from 'lucide-react'
import { useToast } from '@/components/Toast'
import { MasterCompanyBanner, TenantCompanyBanner } from '@/components/MasterCompanyBanner'
import { MasterCompanyConfirmDialog } from '@/components/MasterCompanyConfirmDialog'
import api from '@/lib/api'
import { formatCurrency, formatNumber } from '@/utils/currency'
import { getCurrenciesByCountry } from '@/utils/currencies'
import { safeLogError, isConnectionError } from '@/utils/connectionError'
import { formatDate, formatDateOnly } from '@/utils/date'
import { RESTORE_CONFIRM_PHRASE } from '@/utils/tenantBackup'

interface PlatformStats {
  total_companies: number
  active_companies: number
  inactive_companies: number
  total_users: number
  total_customers: number
  total_vendors: number
  total_stations: number
  total_sales: number
  total_invoices: number
  users_by_role: Record<string, number>
}

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

const TENANT_SAAS_PLAN_OPTIONS: { code: string; label: string }[] = [
  { code: '', label: '— Not set —' },
  { code: 'starter', label: 'Starter' },
  { code: 'growth', label: 'Growth' },
  { code: 'enterprise', label: 'Enterprise' },
  { code: 'platform', label: 'Platform' },
  { code: 'custom', label: 'Custom / Other' },
]

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
  // SaaS Subscription Ledger (financial transactions between SaaS provider and tenant)
  subscription_ledger_balance?: number  // Total subscription revenue received
  subscription_outstanding?: number  // Outstanding subscription payments due
  subscription_total_billed?: number  // Total amount billed to tenant
  subscription_total_paid?: number  // Total amount paid by tenant
  // Legacy financial data (kept for backward compatibility)
  ledger_balance?: number
  accounts_receivable?: number
  accounts_payable?: number
  net_due_amount?: number
  monthly_charge?: number
  yearly_charge?: number
  has_active_contract?: boolean
  // Contact & Payment Information
  contact_person?: string
  billing_plan_code?: string
  payment_type?: string
  payment_start_date?: string
  payment_end_date?: string
  payment_amount?: string
  // Capacity data
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

interface AdminUser {
  id: number
  username: string
  email: string
  full_name: string
  role: string
  company_id: number | null
  company_name: string | null
  is_active: boolean
  created_at: string
}

function SuperAdminPageContent() {
  const router = useRouter()
  const toast = useToast()
  const { selectedCompany, setSelectedCompany, isSaaSDashboard, isMasterCompany, mode } = useCompany()
  const [userRole, setUserRole] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState<PlatformStats | null>(null)
  const [companies, setCompanies] = useState<Company[]>([])
  const [users, setUsers] = useState<AdminUser[]>([])
  const [activeTab, setActiveTab] = useState<'overview' | 'companies' | 'users' | 'contracts' | 'broadcasting' | 'subscription-ledger'>(() => {
    // Load active tab from localStorage if available
    if (typeof window !== 'undefined') {
      const savedTab = localStorage.getItem('admin_active_tab')
      if (savedTab && ['overview', 'companies', 'users', 'contracts', 'broadcasting', 'subscription-ledger'].includes(savedTab)) {
        return savedTab as 'overview' | 'companies' | 'users' | 'contracts' | 'broadcasting' | 'subscription-ledger'
      }
    }
    return 'overview'
  })
  
  // Use sidebar mode instead of local management mode
  const managementMode = mode === 'fsms_erp' ? 'erp' : 'saas'
  const [showCompanyModal, setShowCompanyModal] = useState(false)
  const [showUserModal, setShowUserModal] = useState(false)
  const [showSubscriptionModal, setShowSubscriptionModal] = useState(false)
  const [editingCompany, setEditingCompany] = useState<Company | null>(null)
  const [editingUser, setEditingUser] = useState<AdminUser | null>(null)
  const [selectedCompanyForSubscription, setSelectedCompanyForSubscription] = useState<Company | null>(null)
  const [extendDays, setExtendDays] = useState<number>(30)
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [showEditPassword, setShowEditPassword] = useState(false)
  const [broadcasts, setBroadcasts] = useState<any[]>([])
  const [showBroadcastModal, setShowBroadcastModal] = useState(false)
  const [showPushUpdateDialog, setShowPushUpdateDialog] = useState(false)
  const [pushUpdateOptions, setPushUpdateOptions] = useState({
    sync_chart_of_accounts: true,
    sync_items: true,
    sync_tax_codes: true,
    sync_company_settings: true
  })
  const [showCompanyViewModal, setShowCompanyViewModal] = useState(false)
  const [viewingCompany, setViewingCompany] = useState<Company | null>(null)
  const [deleteModalCompany, setDeleteModalCompany] = useState<Company | null>(null)
  const [deletePhrase, setDeletePhrase] = useState('')
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [broadcastFormData, setBroadcastFormData] = useState({
    title: '',
    message: '',
    broadcast_type: 'general',
    priority: 'medium',
    target_company_id: '',
    target_role: '',
    scheduled_at: '',
    expires_at: ''
  })
  const [companyFormData, setCompanyFormData] = useState({
    company_name: '',
    legal_name: '',
    email: '',
    phone: '',
    subdomain: '',
    custom_domain: '',
    currency: 'BDT',
    is_active: true,
    contact_person: '',
    billing_plan_code: '',
    payment_type: '',
    payment_start_date: '',
    payment_end_date: '',
    payment_amount: ''
  })
  const [userFormData, setUserFormData] = useState({
    username: '',
    email: '',
    full_name: '',
    role: 'cashier',
    password: '',
    confirmPassword: '',
    company_id: ''
  })

  useEffect(() => {
    const token = localStorage.getItem('access_token')
    if (!token) {
      router.push('/login')
      return
    }

    // Get user role
    const userStr = localStorage.getItem('user')
    if (userStr && userStr !== 'undefined' && userStr !== 'null') {
      try {
        const user = JSON.parse(userStr)
        const role = user.role?.toLowerCase() || null
        setUserRole(role)
        
        // Only allow SUPER_ADMIN to access this page
        if (role !== 'super_admin') {
          toast.error('Access denied. Super Admin access required.')
          router.push('/dashboard')
          return
        }
      } catch (error) {
        safeLogError('Error parsing user data:', error)
      }
    }

    // If in FSMS ERP mode and company is selected, redirect to company dashboard
    if (mode === 'fsms_erp') {
      if (selectedCompany) {
        router.push('/dashboard')
        return
      } else {
        // If no company selected in FSMS ERP mode, fetch companies and select default
        fetchCompanies().then(() => {
          if (companies.length > 0) {
            const masterCompany = companies.find((c: any) => c.is_master === 'true')
            const companyToSelect = masterCompany || companies[0]
            setSelectedCompany({
              id: companyToSelect.id,
              name: companyToSelect.name,
              is_master: companyToSelect.is_master || 'false'
            })
            router.push('/dashboard')
          }
        })
        return
      }
    }

    // Only fetch platform stats if in SaaS Dashboard mode
    if (mode === 'saas_dashboard') {
      fetchPlatformStats()
      fetchCompanies()
      fetchUsers()
      fetchBroadcasts()
      
      // Sync active tab from localStorage
      const savedTab = localStorage.getItem('admin_active_tab')
      if (savedTab && ['overview', 'companies', 'users', 'contracts', 'broadcasting', 'subscription-ledger'].includes(savedTab)) {
        setActiveTab(savedTab as 'overview' | 'companies' | 'users' | 'contracts' | 'broadcasting' | 'subscription-ledger')
      } else {
        // Default to overview if no tab is set
        setActiveTab('overview')
        localStorage.setItem('admin_active_tab', 'overview')
      }
    }
  }, [router, toast, mode, selectedCompany])

  // Listen for tab changes from sidebar
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const handleStorageChange = (e: StorageEvent) => {
        if (e.key === 'admin_active_tab' && e.newValue) {
          if (['overview', 'companies', 'users', 'contracts', 'broadcasting'].includes(e.newValue)) {
            setActiveTab(e.newValue as 'overview' | 'companies' | 'users' | 'contracts' | 'broadcasting')
          }
        }
      }
      window.addEventListener('storage', handleStorageChange)
      
      // Also listen for custom events (same-window updates)
      const handleTabChange = () => {
        const savedTab = localStorage.getItem('admin_active_tab')
        if (savedTab && ['overview', 'companies', 'users', 'contracts', 'broadcasting'].includes(savedTab)) {
          setActiveTab(savedTab as 'overview' | 'companies' | 'users' | 'contracts' | 'broadcasting')
        }
      }
      window.addEventListener('adminTabChanged', handleTabChange)
      
      return () => {
        window.removeEventListener('storage', handleStorageChange)
        window.removeEventListener('adminTabChanged', handleTabChange)
      }
    }
  }, [])

  const fetchPlatformStats = async () => {
    try {
      const response = await api.get('/admin/stats')
      if (response.data) {
        setStats(response.data)
      } else {
        console.warn('No stats data in response')
      }
    } catch (error: any) {
      // Silently handle connection errors - backend may not be running
      if (!isConnectionError(error)) {
        safeLogError('Error fetching platform stats:', error)
        safeLogError('Error details:', error.response?.data)
      }
      
      if (error.response?.status === 403) {
        toast.error('Access denied. Super Admin access required.')
        router.push('/dashboard')
      } else if (!isConnectionError(error)) {
        // Only show toast for non-connection errors
        toast.error('Failed to load platform statistics')
      }
    }
  }

  const fetchCompanies = async () => {
    try {
      const response = await api.get('/admin/companies')
      if (response.data) {
        // Ensure is_master is included in the data
        const companiesWithMaster = response.data.map((c: any) => ({
          ...c,
          is_master: c.is_master || 'false'
        }))
        setCompanies(companiesWithMaster)
        // Notify sidebar to update counts
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new Event('adminCountsUpdated'))
        }
      } else {
        console.warn('No companies data in response')
        setCompanies([])
      }
    } catch (error: any) {
      safeLogError('Error fetching companies:', error)
      if (!isConnectionError(error)) {
        toast.error('Failed to load companies')
      }
      setCompanies([])
    }
  }

  const fetchUsers = async () => {
    try {
      const response = await api.get('/admin/users', { params: { limit: 500 } })
      if (response.data) {
        setUsers(response.data)
        // Notify sidebar to update counts
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new Event('adminCountsUpdated'))
        }
      } else {
        console.warn('No users data in response')
        setUsers([])
      }
    } catch (error: any) {
      if (!isConnectionError(error)) {
        safeLogError('Error fetching users:', error)
        safeLogError('Error details:', error.response?.data)
        toast.error('Failed to load users')
      }
      setUsers([])
    } finally {
      setLoading(false)
    }
  }

  const fetchBroadcasts = async () => {
    try {
      const response = await api.get('/broadcasts/')
      if (response.data) {
        setBroadcasts(response.data)
      }
    } catch (error: any) {
      safeLogError('Error fetching broadcasts:', error)
    }
  }

  const handleCreateBroadcast = () => {
    setBroadcastFormData({
      title: '',
      message: '',
      broadcast_type: 'general',
      priority: 'medium',
      target_company_id: '',
      target_role: '',
      scheduled_at: '',
      expires_at: ''
    })
    setShowBroadcastModal(true)
  }

  const handleSubmitBroadcast = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!broadcastFormData.title || !broadcastFormData.message) {
      toast.error('Please fill in title and message')
      return
    }

    try {
      const broadcastData: any = {
        title: broadcastFormData.title,
        message: broadcastFormData.message,
        broadcast_type: broadcastFormData.broadcast_type,
        priority: broadcastFormData.priority,
        target_company_id: broadcastFormData.target_company_id ? parseInt(broadcastFormData.target_company_id) : null,
        target_role: broadcastFormData.target_role || null,
        scheduled_at: broadcastFormData.scheduled_at ? new Date(broadcastFormData.scheduled_at).toISOString() : null,
        expires_at: broadcastFormData.expires_at ? new Date(broadcastFormData.expires_at).toISOString() : null
      }

      await api.post('/broadcasts/', broadcastData)
      toast.success('Broadcast created successfully!')
      setShowBroadcastModal(false)
      await fetchBroadcasts()
    } catch (error: any) {
      const errorMsg = error.response?.data?.detail || error.response?.data?.message || 'Failed to create broadcast'
      toast.error(errorMsg)
      safeLogError('Broadcast error:', error)
    }
  }

  const handleDeleteBroadcast = async (broadcastId: number) => {
    if (!confirm('Are you sure you want to delete this broadcast?')) {
      return
    }

    try {
      await api.delete(`/broadcasts/${broadcastId}`)
      toast.success('Broadcast deleted successfully!')
      await fetchBroadcasts()
    } catch (error: any) {
      const errorMsg = error.response?.data?.detail || error.response?.data?.message || 'Failed to delete broadcast'
      toast.error(errorMsg)
      safeLogError('Delete broadcast error:', error)
    }
  }

  const handleCreateCompany = async () => {
    setEditingCompany(null)
    setCompanyFormData({
      company_name: '',
      legal_name: '',
      email: '',
      phone: '',
      subdomain: '',
      custom_domain: '',
      currency: 'BDT',
      is_active: true,
      contact_person: '',
      billing_plan_code: '',
      payment_type: '',
      payment_start_date: '',
      payment_end_date: '',
      payment_amount: ''
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
      is_active: company.is_active,
      contact_person: company.contact_person || '',
      billing_plan_code: (company.billing_plan_code || '').toLowerCase(),
      payment_type: company.payment_type || '',
      payment_start_date: company.payment_start_date || '',
      payment_end_date: company.payment_end_date || '',
      payment_amount: company.payment_amount?.toString() || ''
    })
    setShowCompanyModal(true)
  }

  const handleSubmitCompany = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!companyFormData.company_name) {
      toast.error('Company name is required')
      return
    }

    try {
      if (editingCompany) {
        await api.put(`/companies/${editingCompany.id}`, companyFormData)
        toast.success('Company updated successfully!')
      } else {
        await api.post('/companies/', companyFormData)
        toast.success('Company created successfully!')
      }
      setShowCompanyModal(false)
      await fetchCompanies()
      await fetchPlatformStats()
    } catch (error: any) {
      const errorMsg = error.response?.data?.detail || error.response?.data?.message || 'Failed to save company'
      toast.error(errorMsg)
      safeLogError('Company error:', error)
    }
  }

  const openDeleteCompanyModal = (company: Company) => {
    setDeleteModalCompany(company)
    setDeletePhrase('')
  }

  const runPermanentCompanyDelete = async () => {
    if (!deleteModalCompany) return
    if (deletePhrase.trim() !== RESTORE_CONFIRM_PHRASE) {
      toast.error(`Type the confirmation phrase exactly: ${RESTORE_CONFIRM_PHRASE}`)
      return
    }
    setDeleteBusy(true)
    try {
      await api.delete(`/companies/${deleteModalCompany.id}/`, {
        data: { confirm_phrase: RESTORE_CONFIRM_PHRASE },
      })
      toast.success('Company and all tenant data were permanently removed.')
      setDeleteModalCompany(null)
      setDeletePhrase('')
      await fetchCompanies()
      await fetchPlatformStats()
    } catch (error: any) {
      const errorMsg =
        error.response?.data?.detail || error.response?.data?.message || 'Failed to delete company'
      toast.error(typeof errorMsg === 'string' ? errorMsg : 'Failed to delete company')
      safeLogError('Delete company error:', error)
    } finally {
      setDeleteBusy(false)
    }
  }

  const handleDeactivateCompany = async (company: Company) => {
    if (
      !window.confirm(
        `Deactivate "${company.name}"? Tenant users cannot sign in until the company is activated again.`
      )
    ) {
      return
    }
    try {
      await api.post(`/companies/${company.id}/deactivate/`)
      toast.success('Company deactivated.')
      await fetchCompanies()
      await fetchPlatformStats()
    } catch (error: any) {
      const errorMsg =
        error.response?.data?.detail || error.response?.data?.message || 'Failed to deactivate company'
      toast.error(typeof errorMsg === 'string' ? errorMsg : 'Failed to deactivate company')
      safeLogError('Deactivate company error:', error)
    }
  }

  const handleActivateCompany = async (company: Company) => {
    try {
      await api.post(`/companies/${company.id}/activate/`)
      toast.success('Company activated.')
      await fetchCompanies()
      await fetchPlatformStats()
    } catch (error: any) {
      const errorMsg =
        error.response?.data?.detail || error.response?.data?.message || 'Failed to activate company'
      toast.error(typeof errorMsg === 'string' ? errorMsg : 'Failed to activate company')
      safeLogError('Activate company error:', error)
    }
  }

  const handleManageSubscription = (company: Company) => {
    setSelectedCompanyForSubscription(company)
    setExtendDays(30)
    setShowSubscriptionModal(true)
  }

  const handleExtendExpiration = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedCompanyForSubscription) return

    try {
      await api.post(`/admin/companies/${selectedCompanyForSubscription.id}/subscription/extend`, {
        days: extendDays
      })
      toast.success(`Subscription extended by ${extendDays} days successfully!`)
      setShowSubscriptionModal(false)
      await fetchCompanies()
    } catch (error: any) {
      const errorMsg = error.response?.data?.detail || error.response?.data?.message || 'Failed to extend subscription'
      toast.error(errorMsg)
      safeLogError('Extend subscription error:', error)
    }
  }

  const handleCreateUser = async () => {
    setEditingUser(null)
    setUserFormData({
      username: '',
      email: '',
      full_name: '',
      role: 'admin',
      password: '',
      confirmPassword: '',
      company_id: ''
    })
    setShowUserModal(true)
    fetchCompanies()
  }

  const handleEditUser = (user: AdminUser) => {
    setEditingUser(user)
    setUserFormData({
      username: user.username,
      email: user.email,
      full_name: user.full_name,
      role: user.role,
      password: '',
      confirmPassword: '',
      company_id: user.company_id?.toString() || ''
    })
    setShowUserModal(true)
  }

  const handleSubmitUser = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!userFormData.username || !userFormData.email || !userFormData.full_name) {
      toast.error('Please fill in all required fields')
      return
    }

    if (!editingUser && (!userFormData.password || userFormData.password.length < 6)) {
      toast.error('Password must be at least 6 characters long')
      return
    }

    if (
      userFormData.password &&
      userFormData.password !== userFormData.confirmPassword
    ) {
      toast.error('Passwords do not match')
      return
    }

    try {
      const userData: any = {
        username: userFormData.username,
        email: userFormData.email,
        full_name: userFormData.full_name,
        role: userFormData.role,
        company_id: userFormData.company_id ? parseInt(userFormData.company_id) : null
      }

      if (!editingUser) {
        userData.password = userFormData.password
      } else if (userFormData.password) {
        userData.password = userFormData.password
      }

      if (editingUser) {
        await api.put(`/users/${editingUser.id}`, userData)
        toast.success('User updated successfully!')
      } else {
        await api.post('/users/', userData)
        toast.success('User created successfully!')
      }
      setShowUserModal(false)
      await fetchUsers()
      await fetchPlatformStats()
    } catch (error: any) {
      const errorMsg = error.response?.data?.detail || error.response?.data?.message || 'Failed to save user'
      toast.error(errorMsg)
      safeLogError('User error:', error)
    }
  }

  const handlePushMasterUpdates = () => {
    if (!isMasterCompany) {
      toast.error('This feature is only available in Master Company')
      return
    }
    setShowPushUpdateDialog(true)
  }

  const confirmPushUpdates = async () => {
    try {
      const params = new URLSearchParams({
        sync_chart_of_accounts: String(pushUpdateOptions.sync_chart_of_accounts),
        sync_items: String(pushUpdateOptions.sync_items),
        sync_tax_codes: String(pushUpdateOptions.sync_tax_codes),
        sync_company_settings: String(pushUpdateOptions.sync_company_settings)
      })
      const response = await api.post(`/admin/master-company/push-updates?${params.toString()}`)
      setShowPushUpdateDialog(false)
      if (response.data) {
        toast.success(
          `Updates pushed successfully to ${response.data.updated_count} companies!`
        )
      }
    } catch (error: any) {
      const errorMsg = error.response?.data?.detail || error.response?.data?.message || 'Failed to push updates'
      toast.error(errorMsg)
      safeLogError('Push updates error:', error)
    }
  }

  const handleDeleteUser = async (user: AdminUser) => {
    if (!confirm(`Are you sure you want to delete user "${user.username}"?`)) {
      return
    }

    try {
      await api.delete(`/users/${user.id}`)
      toast.success('User deleted successfully!')
      await fetchUsers()
      await fetchPlatformStats()
    } catch (error: any) {
      const errorMsg = error.response?.data?.detail || error.response?.data?.message || 'Failed to delete user'
      toast.error(errorMsg)
      safeLogError('Delete user error:', error)
    }
  };

  if (userRole !== 'super_admin') {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    )
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
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {/* Master/Tenant Company Banner */}
        <MasterCompanyBanner />
        <TenantCompanyBanner />
        
        <div className="flex min-h-0 flex-1 overflow-auto">
          <div className="p-4 sm:p-6 lg:p-8">
          {/* Info Banner - Mode is controlled from Sidebar */}
          {mode === 'fsms_erp' && (
            <div className="mb-6 rounded-lg border border-blue-200 bg-blue-50 p-4">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex min-w-0 items-start gap-3">
                  <Building2 className="h-5 w-5 shrink-0 text-blue-600" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-blue-900">
                      FSMS ERP Mode Active
                    </p>
                    <p className="mt-1 text-xs text-blue-700">
                      Use the sidebar toggle to switch to SaaS Dashboard mode for platform management
                    </p>
                  </div>
                </div>
                {selectedCompany && (
                  <div className="flex w-full min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:gap-3 lg:w-auto lg:shrink-0">
                    <div className="w-full min-w-0 sm:max-w-xs lg:w-64">
                      <CompanySwitcher />
                    </div>
                    {isMasterCompany && (
                      <button
                        type="button"
                        onClick={handlePushMasterUpdates}
                        className="flex w-full items-center justify-center gap-2 rounded-lg bg-green-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 sm:w-auto"
                      >
                        <Upload className="h-4 w-4 shrink-0" />
                        <span className="text-center leading-tight">Push updates to all companies</span>
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Header */}
          <div className="mb-6 sm:mb-8">
            <div className="mb-2 flex flex-wrap items-center gap-2 sm:gap-3">
              {mode === 'saas_dashboard' ? (
                <Shield className="h-7 w-7 shrink-0 text-blue-600 sm:h-8 sm:w-8" />
              ) : (
                <Building2 className="h-7 w-7 shrink-0 text-blue-600 sm:h-8 sm:w-8" />
              )}
              <h1 className="min-w-0 text-xl font-bold leading-tight text-gray-900 sm:text-2xl lg:text-3xl">
                {mode === 'saas_dashboard' ? 'SaaS Management Dashboard' : 'FSMS ERP — Company Management'}
              </h1>
            </div>
            <p className="max-w-3xl text-sm text-gray-600 sm:text-base">
              {mode === 'saas_dashboard'
                ? 'Manage all companies, users, contracts, and platform-wide settings'
                : 'Select a company from the sidebar to manage its ERP system, stations, customers, invoices, and more'
              }
            </p>
          </div>

          {/* Tab content is now controlled by sidebar menu items */}

          {/* Show Company ERP Management content when in FSMS ERP mode */}
          {mode === 'fsms_erp' && (
            <div className="bg-white rounded-lg shadow p-8">
              {!selectedCompany ? (
                <div className="text-center py-12">
                  <Building2 className="h-16 w-16 text-gray-400 mx-auto mb-4" />
                  <h3 className="text-xl font-semibold text-gray-900 mb-2">Select a Company</h3>
                  <p className="text-gray-600 mb-6">Choose a company from the sidebar dropdown to manage its ERP system</p>
                  <div className="max-w-md mx-auto">
                    <p className="text-sm text-gray-500 mb-4">
                      Use the company switcher in the left sidebar to select Master Company for development or any other company for customization.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="text-center py-12">
                  <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
                  <p className="text-gray-600 mt-4">Redirecting to {selectedCompany.name} ERP Dashboard...</p>
                </div>
              )}
            </div>
          )}

          {/* SaaS Management Content - All tabs */}
          {mode === 'saas_dashboard' && (
            <>
              {/* Overview Tab */}
              {activeTab === 'overview' && (
                <div>
                  {stats ? (
                    <>
                      {/* Platform Statistics */}
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
                        <div className="bg-white rounded-lg shadow p-6">
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="text-sm text-gray-600">Total Companies</p>
                              <p className="text-2xl font-bold text-gray-900 mt-1">{stats.total_companies}</p>
                              <p className="text-xs text-gray-500 mt-1">
                                {stats.active_companies} active, {stats.inactive_companies} inactive
                              </p>
                            </div>
                            <div className="p-3 bg-blue-100 rounded-full">
                              <Building2 className="h-6 w-6 text-blue-600" />
                            </div>
                          </div>
                        </div>

                        <div className="bg-white rounded-lg shadow p-6">
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="text-sm text-gray-600">Total Users</p>
                              <p className="text-2xl font-bold text-gray-900 mt-1">{stats.total_users}</p>
                              <p className="text-xs text-gray-500 mt-1">Across all companies</p>
                            </div>
                            <div className="p-3 bg-green-100 rounded-full">
                              <Users className="h-6 w-6 text-green-600" />
                            </div>
                          </div>
                        </div>

                        <div className="bg-white rounded-lg shadow p-6">
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="text-sm text-gray-600">Total Stations</p>
                              <p className="text-2xl font-bold text-gray-900 mt-1">{stats.total_stations}</p>
                              <p className="text-xs text-gray-500 mt-1">Across all companies</p>
                            </div>
                            <div className="p-3 bg-purple-100 rounded-full">
                              <MapPin className="h-6 w-6 text-purple-600" />
                            </div>
                          </div>
                        </div>

                        <div className="bg-white rounded-lg shadow p-6">
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="text-sm text-gray-600">Total Sales</p>
                              <p className="text-2xl font-bold text-gray-900 mt-1">
                                {formatCurrency(stats.total_sales, 'BDT')}
                              </p>
                              <p className="text-xs text-gray-500 mt-1">All companies, all time</p>
                            </div>
                            <div className="p-3 bg-yellow-100 rounded-full">
                              <TrendingUp className="h-6 w-6 text-yellow-600" />
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Additional Stats */}
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                        <div className="bg-white rounded-lg shadow p-6">
                          <h3 className="text-lg font-semibold text-gray-900 mb-4">Users by Role</h3>
                          <div className="space-y-2">
                            {Object.entries(stats.users_by_role).map(([role, count]) => (
                              <div key={role} className="flex justify-between items-center">
                                <span className="text-sm text-gray-600 capitalize">{role.replace('_', ' ')}</span>
                                <span className="text-sm font-semibold text-gray-900">{count}</span>
                              </div>
                            ))}
                          </div>
                        </div>

                        <div className="bg-white rounded-lg shadow p-6">
                          <h3 className="text-lg font-semibold text-gray-900 mb-4">Resource Summary</h3>
                          <div className="space-y-2">
                            <div className="flex justify-between items-center">
                              <span className="text-sm text-gray-600">Customers</span>
                              <span className="text-sm font-semibold text-gray-900">{stats.total_customers}</span>
                            </div>
                            <div className="flex justify-between items-center">
                              <span className="text-sm text-gray-600">Vendors</span>
                              <span className="text-sm font-semibold text-gray-900">{stats.total_vendors}</span>
                            </div>
                            <div className="flex justify-between items-center">
                              <span className="text-sm text-gray-600">Invoices</span>
                              <span className="text-sm font-semibold text-gray-900">{stats.total_invoices}</span>
                            </div>
                          </div>
                        </div>

                        <div className="bg-white rounded-lg shadow p-6">
                          <h3 className="text-lg font-semibold text-gray-900 mb-4">Company Status</h3>
                          <div className="space-y-2">
                            <div className="flex justify-between items-center">
                              <span className="text-sm text-gray-600">Active</span>
                              <span className="text-sm font-semibold text-green-600">{stats.active_companies}</span>
                            </div>
                            <div className="flex justify-between items-center">
                              <span className="text-sm text-gray-600">Inactive</span>
                              <span className="text-sm font-semibold text-red-600">{stats.inactive_companies}</span>
                            </div>
                            <div className="flex justify-between items-center">
                              <span className="text-sm text-gray-600">With Subscription</span>
                              <span className="text-sm font-semibold text-blue-600">{stats.active_companies}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="bg-white rounded-lg shadow p-8 text-center">
                      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
                      <p className="text-gray-600">Loading platform statistics...</p>
                    </div>
                  )}
                </div>
              )}

              {/* Companies Tab */}
              {activeTab === 'companies' && (
                <div>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-bold text-gray-900">All Companies</h2>
                <button
                  onClick={handleCreateCompany}
                  className="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                >
                  <Plus className="h-5 w-5" />
                  <span>New Company</span>
                </button>
              </div>
              
              {/* Info Banner */}
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

              {/* Companies Grid - World Class Design */}
              <div className="grid grid-cols-1 gap-6">
                {companies.length === 0 ? (
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
                ) : null}
                {companies.length > 0 && companies
                  .sort((a, b) => {
                    // Sort master company first
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
                    const capacityStorage = company.capacity_usage?.storage_gb
                    
                    return (
                      <div key={company.id} className={`bg-white rounded-xl shadow-lg border-2 ${statusColor} transition-all hover:shadow-xl`}>
                        <div className="p-6">
                          {/* Header Row */}
                          <div className="flex items-start justify-between mb-6">
                            <div className="flex-1">
                              <div className="flex items-center space-x-3 mb-2">
                                {company.is_master === 'true' && (
                                  <Crown className="h-6 w-6 text-yellow-600" />
                                )}
                                <h3 className="text-xl font-bold text-gray-900">{company.name}</h3>
                                {company.is_master === 'true' && (
                                  <span className="px-3 py-1 text-xs font-semibold bg-yellow-100 text-yellow-800 rounded-full">Master</span>
                                )}
                                <span className={`px-3 py-1 text-xs font-semibold rounded-full ${
                                  company.is_active 
                                    ? 'bg-green-100 text-green-800' 
                                    : 'bg-red-100 text-red-800'
                                }`}>
                                  {company.is_active ? 'Active' : 'Inactive'}
                                </span>
                                {company.subscription_active && (
                                  <span className="px-3 py-1 text-xs font-semibold bg-blue-100 text-blue-800 rounded-full flex items-center">
                                    <Crown className="h-3 w-3 mr-1" />
                                    Subscribed
                                  </span>
                                )}
                              </div>
                              {company.legal_name && (
                                <p className="text-sm text-gray-600">{company.legal_name}</p>
                              )}
                            </div>
                            <div className="flex items-center space-x-2">
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
                                onClick={() => handleEditCompany(company)}
                                className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                                title="Edit Company"
                              >
                                <Edit2 className="h-5 w-5" />
                              </button>
                              {company.is_master !== 'true' && company.is_active && (
                                <button
                                  type="button"
                                  onClick={() => handleDeactivateCompany(company)}
                                  className="p-2 text-amber-700 hover:bg-amber-50 rounded-lg transition-colors"
                                  title="Deactivate company (suspend access, keep all data)"
                                >
                                  <Ban className="h-5 w-5" />
                                </button>
                              )}
                              {company.is_master !== 'true' && !company.is_active && (
                                <button
                                  type="button"
                                  onClick={() => handleActivateCompany(company)}
                                  className="p-2 text-emerald-700 hover:bg-emerald-50 rounded-lg transition-colors"
                                  title="Activate company"
                                >
                                  <PlayCircle className="h-5 w-5" />
                                </button>
                              )}
                              {company.is_master !== 'true' && (
                                <button
                                  type="button"
                                  onClick={() => openDeleteCompanyModal(company)}
                                  className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                  title="Permanently delete company and all data"
                                >
                                  <Trash2 className="h-5 w-5" />
                                </button>
                              )}
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
                                {/* Subscription Revenue (Total Paid) */}
                                <div className="bg-green-50 rounded-lg p-3 border border-green-200">
                                  <div className="text-xs text-gray-500 mb-1">Subscription Revenue (Total Paid)</div>
                                  <div className="text-lg font-bold text-green-700">
                                    {formatCurrency(company.subscription_total_paid || company.ledger_balance || 0, company.currency || 'BDT')}
                                  </div>
                                  <div className="text-xs text-gray-500 mt-1">Total subscription payments received from tenant</div>
                                </div>
                                
                                {/* Outstanding Subscription Payments */}
                                <div className={`rounded-lg p-3 border ${
                                  (company.subscription_outstanding || company.accounts_receivable || 0) > 0
                                    ? 'bg-red-50 border-red-200'
                                    : 'bg-gray-50 border-gray-200'
                                }`}>
                                  <div className="text-xs text-gray-500 mb-1">Outstanding Subscription Payments</div>
                                  <div className={`text-lg font-bold ${
                                    (company.subscription_outstanding || company.accounts_receivable || 0) > 0
                                      ? 'text-red-700'
                                      : 'text-gray-900'
                                  }`}>
                                    {formatCurrency(company.subscription_outstanding || company.accounts_receivable || 0, company.currency || 'BDT')}
                                  </div>
                                  <div className="text-xs text-gray-500 mt-1">Amount due from tenant for subscriptions</div>
                                </div>
                                
                                {/* Total Billed */}
                                <div className="bg-blue-50 rounded-lg p-3 border border-blue-200">
                                  <div className="text-xs text-gray-500 mb-1">Total Subscription Billed</div>
                                  <div className="text-lg font-bold text-blue-700">
                                    {formatCurrency(company.subscription_total_billed || 0, company.currency || 'BDT')}
                                  </div>
                                  <div className="text-xs text-gray-500 mt-1">Total amount billed to tenant (all time)</div>
                                </div>
                                
                                {/* Payment Status Summary */}
                                <div className="bg-gray-50 rounded-lg p-3 border border-gray-200">
                                  <div className="text-xs text-gray-500 mb-2">Payment Status Summary</div>
                                  <div className="space-y-1 text-xs">
                                    <div className="flex justify-between">
                                      <span className="text-gray-600">Total Billed:</span>
                                      <span className="font-semibold text-gray-900">
                                        {formatCurrency(company.subscription_total_billed || 0, company.currency || 'BDT')}
                                      </span>
                                    </div>
                                    <div className="flex justify-between">
                                      <span className="text-gray-600">Total Paid:</span>
                                      <span className="font-semibold text-green-700">
                                        {formatCurrency(company.subscription_total_paid || company.ledger_balance || 0, company.currency || 'BDT')}
                                      </span>
                                    </div>
                                    <div className="flex justify-between border-t pt-1 mt-1">
                                      <span className="text-gray-600">Outstanding:</span>
                                      <span className={`font-semibold ${
                                        (company.subscription_outstanding || company.accounts_receivable || 0) > 0 ? 'text-red-700' : 'text-gray-900'
                                      }`}>
                                        {formatCurrency(company.subscription_outstanding || company.accounts_receivable || 0, company.currency || 'BDT')}
                                      </span>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </div>

                            {/* Subscription & Charges */}
                            <div className="space-y-3">
                              <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Subscription & Charges</h4>
                              <div className="space-y-3">
                                {/* Subscription Status */}
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
                                
                                {/* Charges */}
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
                                  {company.has_active_contract && (company.subscription_active || company.subscription?.is_active) && (
                                    <div className="text-xs text-green-600 mt-2 flex items-center">
                                      <span className="inline-block w-1.5 h-1.5 bg-green-500 rounded-full mr-1"></span>
                                      Free maintenance & upgrades
                                    </div>
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
            </div>
          )}

              {/* Contract Management Tab */}
              {activeTab === 'contracts' && (
                <ContractManagement />
              )}

              {/* Subscription Ledger Tab */}
              {activeTab === 'subscription-ledger' && (
                <SubscriptionLedger />
              )}

              {/* Broadcasting Tab */}
              {activeTab === 'broadcasting' && (
                <div>
                  <div className="flex items-center justify-between mb-6">
                    <h2 className="text-xl font-bold text-gray-900 flex items-center space-x-2">
                      <Megaphone className="h-6 w-6 text-blue-600" />
                      <span>Broadcasting</span>
                    </h2>
                    <button
                      onClick={handleCreateBroadcast}
                      className="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                    >
                      <Plus className="h-5 w-5" />
                      <span>New Broadcast</span>
                    </button>
                  </div>

                  {/* Info Banner */}
                  <div className="mb-6 bg-blue-50 border border-blue-200 rounded-lg p-4">
                    <div className="flex items-start">
                      <div className="flex-shrink-0">
                        <Megaphone className="h-5 w-5 text-blue-600 mt-0.5" />
                      </div>
                      <div className="ml-3">
                        <h3 className="text-sm font-medium text-blue-900">Broadcast Messages to All Tenants</h3>
                        <div className="mt-2 text-sm text-blue-700">
                          <p>
                            Send important messages to all tenants about payment due, upgrade requests, service expiry dates, maintenance, and more.
                            Messages can be targeted to specific companies or roles, or sent to everyone.
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Broadcasts List */}
                  <div className="bg-white rounded-lg shadow overflow-hidden">
                    {broadcasts.length === 0 ? (
                      <div className="p-12 text-center">
                        <Megaphone className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                        <h3 className="text-lg font-semibold text-gray-900 mb-2">No Broadcasts Yet</h3>
                        <p className="text-gray-600 mb-6">Create your first broadcast message to send to all tenants</p>
                        <button
                          onClick={handleCreateBroadcast}
                          className="inline-flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                        >
                          <Plus className="h-5 w-5" />
                          <span>Create Broadcast</span>
                        </button>
                      </div>
                    ) : (
                      <div className="divide-y divide-gray-200">
                        {broadcasts.map((broadcast: any) => {
                          const priorityColors: Record<string, string> = {
                            urgent: 'bg-red-100 text-red-800 border-red-200',
                            high: 'bg-orange-100 text-orange-800 border-orange-200',
                            medium: 'bg-yellow-100 text-yellow-800 border-yellow-200',
                            low: 'bg-blue-100 text-blue-800 border-blue-200'
                          }
                          
                          const typeLabels: Record<string, string> = {
                            payment_due: 'Payment Due',
                            upgrade_request: 'Upgrade Request',
                            service_expiry: 'Service Expiry',
                            maintenance: 'Maintenance',
                            announcement: 'Announcement',
                            system_update: 'System Update',
                            general: 'General'
                          }

                          return (
                            <div key={broadcast.id} className="p-6 hover:bg-gray-50 transition-colors">
                              <div className="flex items-start justify-between">
                                <div className="flex-1">
                                  <div className="flex items-center space-x-3 mb-2">
                                    <h3 className="text-lg font-semibold text-gray-900">{broadcast.title}</h3>
                                    <span className={`px-2 py-1 text-xs font-semibold rounded border ${priorityColors[broadcast.priority] || priorityColors.medium}`}>
                                      {broadcast.priority.toUpperCase()}
                                    </span>
                                    <span className="px-2 py-1 text-xs font-medium text-gray-700 bg-gray-100 rounded">
                                      {typeLabels[broadcast.broadcast_type] || broadcast.broadcast_type}
                                    </span>
                                  </div>
                                  <p className="text-gray-700 mb-3 whitespace-pre-wrap">{broadcast.message}</p>
                                  <div className="flex items-center space-x-4 text-sm text-gray-500">
                                    <span>Created by: {broadcast.created_by_name || 'System'}</span>
                                    <span>•</span>
                                    <span>{formatDate(broadcast.created_at, true)}</span>
                                    {broadcast.target_company_name && (
                                      <>
                                        <span>•</span>
                                        <span>Target: {broadcast.target_company_name}</span>
                                      </>
                                    )}
                                    {broadcast.target_role && (
                                      <>
                                        <span>•</span>
                                        <span>Role: {broadcast.target_role}</span>
                                      </>
                                    )}
                                    {broadcast.expires_at && (
                                      <>
                                        <span>•</span>
                                        <span>Expires: {formatDate(broadcast.expires_at, true)}</span>
                                      </>
                                    )}
                                  </div>
                                </div>
                                <div className="flex items-center space-x-2 ml-4">
                                  <button
                                    onClick={() => handleDeleteBroadcast(broadcast.id)}
                                    className="p-2 text-red-600 hover:text-red-900 hover:bg-red-50 rounded transition-colors"
                                    title="Delete Broadcast"
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </button>
                                </div>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Users Tab */}
              {activeTab === 'users' && (
            <div>
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-bold text-gray-900">All Users</h2>
                <button
                  onClick={handleCreateUser}
                  className="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                >
                  <Plus className="h-5 w-5" />
                  <span>New User</span>
                </button>
              </div>

              <div className="bg-white rounded-lg shadow overflow-hidden">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">User</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Role</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Company</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Joined</th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {users.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-6 py-12 text-center">
                          <Users className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                          <p className="text-gray-600 text-lg mb-2">No users found</p>
                          <p className="text-gray-500 text-sm">Users will appear here once companies are created</p>
                        </td>
                      </tr>
                    ) : (
                      users.map((user) => (
                      <tr key={user.id} className="hover:bg-gray-50">
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div>
                            <div className="text-sm font-medium text-gray-900">{user.full_name}</div>
                            <div className="text-xs text-gray-500">{user.username}</div>
                            <div className="text-xs text-gray-500">{user.email}</div>
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${
                            user.role === 'super_admin' ? 'bg-purple-100 text-purple-800' :
                            user.role === 'admin' ? 'bg-blue-100 text-blue-800' :
                            user.role === 'accountant' ? 'bg-green-100 text-green-800' :
                            user.role === 'cashier' ? 'bg-yellow-100 text-yellow-800' :
                            'bg-gray-100 text-gray-800'
                          }`}>
                            {user.role.replace('_', ' ').toUpperCase()}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm text-gray-900">{user.company_name || 'No Company'}</div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${
                            user.is_active
                              ? 'bg-green-100 text-green-800'
                              : 'bg-red-100 text-red-800'
                          }`}>
                            {user.is_active ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {user.created_at ? formatDate(user.created_at, true) : '-'}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                          <div className="flex items-center justify-end space-x-2">
                            <button
                              onClick={() => handleEditUser(user)}
                              className="p-1.5 text-blue-600 hover:text-blue-900 hover:bg-blue-50 rounded transition-colors"
                              title="Edit User"
                            >
                              <Edit2 className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() => handleDeleteUser(user)}
                              className="p-1.5 text-red-600 hover:text-red-900 hover:bg-red-50 rounded transition-colors"
                              title="Delete User"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    )))}
                  </tbody>
                </table>
              </div>
            </div>
              )}
            </>
          )}

          {/* Broadcast Modal */}
          {showBroadcastModal && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
              <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
                <div className="bg-gradient-to-r from-blue-600 to-blue-700 px-6 py-4 sticky top-0 z-10 flex items-center justify-between rounded-t-xl">
                  <h2 className="text-2xl font-bold text-white flex items-center space-x-2">
                    <Megaphone className="h-6 w-6" />
                    <span>Create Broadcast</span>
                  </h2>
                  <button
                    onClick={() => setShowBroadcastModal(false)}
                    className="p-2 hover:bg-white/20 rounded-full transition-colors"
                  >
                    <X className="h-5 w-5 text-white" />
                  </button>
                </div>

                <form onSubmit={handleSubmitBroadcast} className="p-6">
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Title <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="text"
                        required
                        value={broadcastFormData.title}
                        onChange={(e) => setBroadcastFormData({ ...broadcastFormData, title: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        placeholder="e.g., Payment Due Reminder"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Message <span className="text-red-500">*</span>
                      </label>
                      <textarea
                        required
                        rows={6}
                        value={broadcastFormData.message}
                        onChange={(e) => setBroadcastFormData({ ...broadcastFormData, message: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        placeholder="Enter your message to all tenants..."
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Type
                        </label>
                        <select
                          value={broadcastFormData.broadcast_type}
                          onChange={(e) => setBroadcastFormData({ ...broadcastFormData, broadcast_type: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        >
                          <option value="general">General</option>
                          <option value="payment_due">Payment Due</option>
                          <option value="upgrade_request">Upgrade Request</option>
                          <option value="service_expiry">Service Expiry</option>
                          <option value="maintenance">Maintenance</option>
                          <option value="announcement">Announcement</option>
                          <option value="system_update">System Update</option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Priority
                        </label>
                        <select
                          value={broadcastFormData.priority}
                          onChange={(e) => setBroadcastFormData({ ...broadcastFormData, priority: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        >
                          <option value="low">Low</option>
                          <option value="medium">Medium</option>
                          <option value="high">High</option>
                          <option value="urgent">Urgent</option>
                        </select>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Target Company (Optional)
                        </label>
                        <select
                          value={broadcastFormData.target_company_id}
                          onChange={(e) => setBroadcastFormData({ ...broadcastFormData, target_company_id: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        >
                          <option value="">All Companies</option>
                          {companies.map((company) => (
                            <option key={company.id} value={company.id.toString()}>
                              {company.name}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Target Role (Optional)
                        </label>
                        <select
                          value={broadcastFormData.target_role}
                          onChange={(e) => setBroadcastFormData({ ...broadcastFormData, target_role: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        >
                          <option value="">All Roles</option>
                          <option value="admin">Admin</option>
                          <option value="accountant">Accountant</option>
                          <option value="cashier">Cashier</option>
                        </select>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Schedule At (Optional)
                        </label>
                        <input
                          type="datetime-local"
                          value={broadcastFormData.scheduled_at}
                          onChange={(e) => setBroadcastFormData({ ...broadcastFormData, scheduled_at: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Expires At (Optional)
                        </label>
                        <input
                          type="datetime-local"
                          value={broadcastFormData.expires_at}
                          onChange={(e) => setBroadcastFormData({ ...broadcastFormData, expires_at: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-end space-x-3 pt-6 border-t mt-6">
                    <button
                      type="button"
                      onClick={() => setShowBroadcastModal(false)}
                      className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center space-x-2"
                    >
                      <Send className="h-4 w-4" />
                      <span>Send Broadcast</span>
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {/* Company View Modal */}
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
                    {/* Basic Information */}
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
                          <label className="text-sm font-medium text-gray-500">Status</label>
                          <p className={`text-base font-semibold mt-1 ${viewingCompany.is_active ? 'text-green-600' : 'text-red-600'}`}>
                            {viewingCompany.is_active ? 'Active' : 'Inactive'}
                          </p>
                        </div>
                        {viewingCompany.is_master === 'true' && (
                          <div>
                            <label className="text-sm font-medium text-gray-500">Type</label>
                            <p className="text-base text-gray-900 mt-1 flex items-center space-x-2">
                              <Crown className="h-4 w-4 text-yellow-600" />
                              <span>Master Company</span>
                            </p>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Domain & Subdomain */}
                    <div className="space-y-4">
                      <h3 className="text-lg font-semibold text-gray-900 border-b pb-2">Domain & Access</h3>
                      <div className="space-y-3">
                        {viewingCompany.subdomain && (
                          <div>
                            <label className="text-sm font-medium text-gray-500">Subdomain</label>
                            <p className="text-base text-blue-600 mt-1">{viewingCompany.subdomain}.yourdomain.com</p>
                          </div>
                        )}
                        {viewingCompany.custom_domain && (
                          <div>
                            <label className="text-sm font-medium text-gray-500">Custom Domain</label>
                            <p className="text-base text-blue-600 mt-1">{viewingCompany.custom_domain}</p>
                          </div>
                        )}
                        <div>
                          <label className="text-sm font-medium text-gray-500">Created At</label>
                          <p className="text-base text-gray-900 mt-1">
                            {formatDate(viewingCompany.created_at, true)}
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* Statistics */}
                    <div className="space-y-4">
                      <h3 className="text-lg font-semibold text-gray-900 border-b pb-2">Statistics</h3>
                      <div className="space-y-3">
                        <div>
                          <label className="text-sm font-medium text-gray-500">Users</label>
                          <p className="text-base text-gray-900 mt-1">{viewingCompany.user_count || 0}</p>
                        </div>
                        <div>
                          <label className="text-sm font-medium text-gray-500">Stations</label>
                          <p className="text-base text-gray-900 mt-1">{viewingCompany.station_count || 0}</p>
                        </div>
                        <div>
                          <label className="text-sm font-medium text-gray-500">Customers</label>
                          <p className="text-base text-gray-900 mt-1">{viewingCompany.customer_count || 0}</p>
                        </div>
                      </div>
                    </div>

                    {/* Subscription & Financial */}
                    <div className="space-y-4">
                      <h3 className="text-lg font-semibold text-gray-900 border-b pb-2">Subscription & Financial</h3>
                      <div className="space-y-3">
                        <div>
                          <label className="text-sm font-medium text-gray-500">Has Subscription</label>
                          <p className={`text-base font-semibold mt-1 ${viewingCompany.has_subscription ? 'text-green-600' : 'text-gray-600'}`}>
                            {viewingCompany.has_subscription ? 'Yes' : 'No'}
                          </p>
                        </div>
                        {viewingCompany.subscription && (
                          <>
                            <div>
                              <label className="text-sm font-medium text-gray-500">Subscription Status</label>
                              <p className="text-base text-gray-900 mt-1 capitalize">{viewingCompany.subscription.status}</p>
                            </div>
                            <div>
                              <label className="text-sm font-medium text-gray-500">Plan</label>
                              <p className="text-base text-gray-900 mt-1">{viewingCompany.subscription.plan_name || 'N/A'}</p>
                            </div>
                            {viewingCompany.subscription.days_until_expiry !== null && (
                              <div>
                                <label className="text-sm font-medium text-gray-500">Days Until Expiry</label>
                                <p className={`text-base font-semibold mt-1 ${
                                  viewingCompany.subscription.days_until_expiry <= 7 ? 'text-red-600' : 
                                  viewingCompany.subscription.days_until_expiry <= 30 ? 'text-orange-600' : 
                                  'text-green-600'
                                }`}>
                                  {viewingCompany.subscription.days_until_expiry} days
                                </p>
                              </div>
                            )}
                          </>
                        )}
                        <div>
                          <label className="text-sm font-medium text-gray-500">Subscription Revenue</label>
                          <p className="text-base font-semibold text-green-700 mt-1">
                            {formatCurrency(viewingCompany.subscription_total_paid || 0, viewingCompany.currency || 'BDT')}
                          </p>
                        </div>
                        <div>
                          <label className="text-sm font-medium text-gray-500">Outstanding Payments</label>
                          <p className={`text-base font-semibold mt-1 ${
                            (viewingCompany.subscription_outstanding || 0) > 0 ? 'text-red-600' : 'text-gray-600'
                          }`}>
                            {formatCurrency(viewingCompany.subscription_outstanding || 0, viewingCompany.currency || 'BDT')}
                          </p>
                        </div>
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

                    {/* Capacity Usage */}
                    {(viewingCompany.capacity_usage?.stations || viewingCompany.capacity_usage?.users) && (
                      <div className="space-y-4 md:col-span-2">
                        <h3 className="text-lg font-semibold text-gray-900 border-b pb-2">Capacity Usage</h3>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                          {viewingCompany.capacity_usage.stations && (
                            <div className="bg-gray-50 rounded-lg p-4">
                              <label className="text-sm font-medium text-gray-500">Stations</label>
                              <p className="text-base font-semibold text-gray-900 mt-1">
                                {viewingCompany.capacity_usage.stations.used} / {viewingCompany.capacity_usage.stations.limit}
                              </p>
                              <div className="w-full bg-gray-200 rounded-full h-2 mt-2">
                                <div 
                                  className={`h-2 rounded-full ${
                                    viewingCompany.capacity_usage.stations.percentage >= 90 ? 'bg-red-600' :
                                    viewingCompany.capacity_usage.stations.percentage >= 70 ? 'bg-orange-600' :
                                    'bg-green-600'
                                  }`}
                                  style={{ width: `${Math.min(viewingCompany.capacity_usage.stations.percentage, 100)}%` }}
                                ></div>
                              </div>
                              <p className="text-xs text-gray-500 mt-1">{viewingCompany.capacity_usage.stations.percentage}% used</p>
                            </div>
                          )}
                          {viewingCompany.capacity_usage.users && (
                            <div className="bg-gray-50 rounded-lg p-4">
                              <label className="text-sm font-medium text-gray-500">Users</label>
                              <p className="text-base font-semibold text-gray-900 mt-1">
                                {viewingCompany.capacity_usage.users.used} / {viewingCompany.capacity_usage.users.limit}
                              </p>
                              <div className="w-full bg-gray-200 rounded-full h-2 mt-2">
                                <div 
                                  className={`h-2 rounded-full ${
                                    viewingCompany.capacity_usage.users.percentage >= 90 ? 'bg-red-600' :
                                    viewingCompany.capacity_usage.users.percentage >= 70 ? 'bg-orange-600' :
                                    'bg-green-600'
                                  }`}
                                  style={{ width: `${Math.min(viewingCompany.capacity_usage.users.percentage, 100)}%` }}
                                ></div>
                              </div>
                              <p className="text-xs text-gray-500 mt-1">{viewingCompany.capacity_usage.users.percentage}% used</p>
                            </div>
                          )}
                          {viewingCompany.capacity_usage.storage_gb && (
                            <div className="bg-gray-50 rounded-lg p-4">
                              <label className="text-sm font-medium text-gray-500">Storage</label>
                              <p className="text-base font-semibold text-gray-900 mt-1">
                                {viewingCompany.capacity_usage.storage_gb.used} GB / {viewingCompany.capacity_usage.storage_gb.limit} GB
                              </p>
                              <div className="w-full bg-gray-200 rounded-full h-2 mt-2">
                                <div 
                                  className={`h-2 rounded-full ${
                                    viewingCompany.capacity_usage.storage_gb.percentage >= 90 ? 'bg-red-600' :
                                    viewingCompany.capacity_usage.storage_gb.percentage >= 70 ? 'bg-orange-600' :
                                    'bg-green-600'
                                  }`}
                                  style={{ width: `${Math.min(viewingCompany.capacity_usage.storage_gb.percentage, 100)}%` }}
                                ></div>
                              </div>
                              <p className="text-xs text-gray-500 mt-1">{viewingCompany.capacity_usage.storage_gb.percentage}% used</p>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
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

          {deleteModalCompany && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
              <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white shadow-2xl">
                <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 sm:px-6">
                  <h2 className="text-lg font-bold text-gray-900">Permanently delete company</h2>
                  <button
                    type="button"
                    onClick={() => {
                      setDeleteModalCompany(null)
                      setDeletePhrase('')
                    }}
                    className="rounded-full p-2 text-gray-500 hover:bg-gray-100"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>
                <div className="space-y-4 p-4 sm:p-6">
                  <p className="text-sm text-gray-700">
                    Company: <strong>{deleteModalCompany.name}</strong> (ID {deleteModalCompany.id})
                  </p>
                  <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900">
                    This removes the company row, <strong>all users and passwords</strong>, and{' '}
                    <strong>all ERP data</strong> for this tenant. This cannot be undone. To suspend access without
                    deleting data, use <strong>Deactivate</strong> instead.
                  </p>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">
                      Type <code className="rounded bg-gray-100 px-1">{RESTORE_CONFIRM_PHRASE}</code>
                    </label>
                    <input
                      type="text"
                      value={deletePhrase}
                      onChange={(e) => setDeletePhrase(e.target.value)}
                      className="mt-2 w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-sm"
                      autoComplete="off"
                    />
                  </div>
                  <div className="flex justify-end gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() => {
                        setDeleteModalCompany(null)
                        setDeletePhrase('')
                      }}
                      className="rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-gray-800 hover:bg-gray-200"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      disabled={deleteBusy || deletePhrase.trim() !== RESTORE_CONFIRM_PHRASE}
                      onClick={runPermanentCompanyDelete}
                      className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {deleteBusy ? 'Deleting…' : 'Delete permanently'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Company Modal */}
          {showCompanyModal && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
              <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
                <div className="bg-gradient-to-r from-blue-600 to-blue-700 px-6 py-4 sticky top-0 z-10 flex items-center justify-between rounded-t-xl">
                  <h2 className="text-2xl font-bold text-white">
                    {editingCompany ? 'Edit Company' : 'New Company'}
                  </h2>
                  <button
                    onClick={() => setShowCompanyModal(false)}
                    className="p-2 hover:bg-white/20 rounded-full transition-colors"
                  >
                    <X className="h-5 w-5 text-white" />
                  </button>
                </div>

                <form onSubmit={handleSubmitCompany} className="p-6">
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

                    <div className="rounded-lg border border-gray-200 bg-gray-50/80 p-4 space-y-3">
                      <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Tenant URL (optional)</p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
                            Used as <span className="font-mono">{'{subdomain}'}.yourplatform.com</span> when you map DNS.
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
                          <p className="text-xs text-gray-500 mt-1">
                            Full hostname the tenant will use (CNAME to your app). Leave blank if only using subdomain.
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Email</label>
                        <input
                          type="email"
                          value={companyFormData.email}
                          onChange={(e) => setCompanyFormData({ ...companyFormData, email: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
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

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">SaaS billing plan</label>
                      <select
                        value={companyFormData.billing_plan_code}
                        onChange={(e) => setCompanyFormData({ ...companyFormData, billing_plan_code: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      >
                        {TENANT_SAAS_PLAN_OPTIONS.map((o) => (
                          <option key={o.code || 'none'} value={o.code}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                      <p className="text-xs text-gray-500 mt-1">
                        Used for subscription ledger, invoicing, and tenant analytics. You can change it anytime.
                      </p>
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
                      <p className="text-xs text-gray-500 mt-1">
                        {getCurrenciesByCountry().length} currencies available (sorted by country name A-Z)
                      </p>
                    </div>

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

          {/* User Modal */}
          {showUserModal && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
              <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
                <div className="bg-gradient-to-r from-blue-600 to-blue-700 px-6 py-4 sticky top-0 z-10 flex items-center justify-between rounded-t-xl">
                  <h2 className="text-2xl font-bold text-white">
                    {editingUser ? 'Edit User' : 'New User'}
                  </h2>
                  <button
                    onClick={() => setShowUserModal(false)}
                    className="p-2 hover:bg-white/20 rounded-full transition-colors"
                  >
                    <X className="h-5 w-5 text-white" />
                  </button>
                </div>

                <form onSubmit={handleSubmitUser} className="p-6">
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Username <span className="text-red-500">*</span>
                        </label>
                        <input
                          type="text"
                          required
                          value={userFormData.username}
                          onChange={(e) => setUserFormData({ ...userFormData, username: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Full Name <span className="text-red-500">*</span>
                        </label>
                        <input
                          type="text"
                          required
                          value={userFormData.full_name}
                          onChange={(e) => setUserFormData({ ...userFormData, full_name: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Email <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="email"
                        required
                        value={userFormData.email}
                        onChange={(e) => setUserFormData({ ...userFormData, email: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Role <span className="text-red-500">*</span>
                        </label>
                        <select
                          required
                          value={userFormData.role}
                          onChange={(e) => setUserFormData({ ...userFormData, role: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        >
                          <option value="super_admin">Super Admin</option>
                          <option value="admin">Admin</option>
                          <option value="accountant">Accountant</option>
                          <option value="cashier">Cashier</option>
                          <option value="worker">Worker</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Company (map user to)
                        </label>
                        <select
                          value={userFormData.company_id}
                          onChange={(e) => setUserFormData({ ...userFormData, company_id: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        >
                          <option value="">None (ERP superuser / platform owner)</option>
                          {companies.map((company) => (
                            <option key={company.id} value={company.id.toString()}>
                              {company.name} (ID: {company.id})
                            </option>
                          ))}
                        </select>
                        <p className="text-xs text-gray-500 mt-1">
                          Choose a company to map this user to. Leave as &quot;None&quot; only for ERP superuser.
                        </p>
                      </div>
                    </div>

                    {!editingUser && (
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">
                            Password <span className="text-red-500">*</span>
                          </label>
                          <div className="relative">
                            <input
                              type={showPassword ? "text" : "password"}
                              required={!editingUser}
                              value={userFormData.password}
                              onChange={(e) => setUserFormData({ ...userFormData, password: e.target.value })}
                              className="w-full px-3 py-2 pr-10 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                            />
                            <button
                              type="button"
                              onClick={() => setShowPassword(!showPassword)}
                              className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-500 hover:text-gray-700 focus:outline-none"
                              aria-label={showPassword ? "Hide password" : "Show password"}
                            >
                              {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                            </button>
                          </div>
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">
                            Confirm Password <span className="text-red-500">*</span>
                          </label>
                          <div className="relative">
                            <input
                              type={showConfirmPassword ? "text" : "password"}
                              required={!editingUser}
                              value={userFormData.confirmPassword}
                              onChange={(e) => setUserFormData({ ...userFormData, confirmPassword: e.target.value })}
                              className="w-full px-3 py-2 pr-10 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                            />
                            <button
                              type="button"
                              onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                              className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-500 hover:text-gray-700 focus:outline-none"
                              aria-label={showConfirmPassword ? "Hide password" : "Show password"}
                            >
                              {showConfirmPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                            </button>
                          </div>
                        </div>
                      </div>
                    )}

                    {editingUser && (
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">
                            New Password (leave blank to keep current)
                          </label>
                          <div className="relative">
                            <input
                              type={showEditPassword ? "text" : "password"}
                              value={userFormData.password}
                              onChange={(e) => setUserFormData({ ...userFormData, password: e.target.value })}
                              className="w-full px-3 py-2 pr-10 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                              placeholder="Enter new password"
                            />
                            <button
                              type="button"
                              onClick={() => setShowEditPassword(!showEditPassword)}
                              className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-500 hover:text-gray-700 focus:outline-none"
                              aria-label={showEditPassword ? "Hide password" : "Show password"}
                            >
                              {showEditPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                            </button>
                          </div>
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">
                            Confirm New Password
                            {userFormData.password ? <span className="text-red-500"> *</span> : null}
                          </label>
                          <div className="relative">
                            <input
                              type={showConfirmPassword ? "text" : "password"}
                              value={userFormData.confirmPassword}
                              onChange={(e) =>
                                setUserFormData({ ...userFormData, confirmPassword: e.target.value })
                              }
                              className="w-full px-3 py-2 pr-10 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                              placeholder="Confirm new password"
                              aria-required={!!userFormData.password}
                            />
                            <button
                              type="button"
                              onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                              className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-500 hover:text-gray-700 focus:outline-none"
                              aria-label={showConfirmPassword ? "Hide password" : "Show password"}
                            >
                              {showConfirmPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                            </button>
                          </div>
                          <p className="text-xs text-gray-500 mt-1">
                            Required when setting a new password.
                          </p>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="flex items-center justify-end space-x-3 pt-6 border-t mt-6">
                    <button
                      type="button"
                      onClick={() => setShowUserModal(false)}
                      className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                    >
                      {editingUser ? 'Update User' : 'Create User'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {/* Modals - Available in both modes */}
          {/* Subscription Extension Modal */}
          {showSubscriptionModal && selectedCompanyForSubscription && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
              <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
                <div className="p-6 border-b">
                  <div className="flex items-center justify-between">
                    <h2 className="text-xl font-bold text-gray-900 flex items-center space-x-2">
                      <RefreshCw className="h-6 w-6 text-blue-600" />
                      <span>Extend Subscription</span>
                    </h2>
                    <button
                      onClick={() => setShowSubscriptionModal(false)}
                      className="text-gray-400 hover:text-gray-600 transition-colors"
                    >
                      <X className="h-6 w-6" />
                    </button>
                  </div>
                  <p className="text-sm text-gray-600 mt-2">
                    {selectedCompanyForSubscription.name}
                  </p>
                </div>

                <form onSubmit={handleExtendExpiration} className="p-6">
                  {selectedCompanyForSubscription.subscription && (
                    <div className="mb-6 space-y-3">
                      <div className="bg-gray-50 rounded-lg p-4">
                        <div className="text-sm text-gray-600 mb-2">Current Subscription</div>
                        <div className="text-lg font-semibold text-gray-900">
                          {selectedCompanyForSubscription.subscription.plan_name || 'N/A'}
                        </div>
                        <div className="text-xs text-gray-500 mt-1">
                          Status: <span className="font-medium">{selectedCompanyForSubscription.subscription.status}</span>
                        </div>
                        {selectedCompanyForSubscription.subscription.current_period_end && (
                          <div className={`text-sm mt-2 flex items-center ${
                            selectedCompanyForSubscription.subscription.is_expired
                              ? 'text-red-600'
                              : selectedCompanyForSubscription.subscription.days_until_expiry !== null && selectedCompanyForSubscription.subscription.days_until_expiry <= 7
                              ? 'text-orange-600'
                              : 'text-gray-600'
                          }`}>
                            <Calendar className="h-4 w-4 inline mr-1" />
                            <span>
                              {selectedCompanyForSubscription.subscription.is_expired
                                ? `Expired on ${formatDateOnly(selectedCompanyForSubscription.subscription.current_period_end)}`
                                : `Expires on ${formatDateOnly(selectedCompanyForSubscription.subscription.current_period_end)} (${selectedCompanyForSubscription.subscription.days_until_expiry} days left)`
                              }
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  <div className="mb-6">
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Extend by (days)
                    </label>
                    <div className="flex space-x-2">
                      <button
                        type="button"
                        onClick={() => setExtendDays(7)}
                        className={`px-3 py-1 rounded text-sm ${extendDays === 7 ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
                      >
                        7 days
                      </button>
                      <button
                        type="button"
                        onClick={() => setExtendDays(30)}
                        className={`px-3 py-1 rounded text-sm ${extendDays === 30 ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
                      >
                        30 days
                      </button>
                      <button
                        type="button"
                        onClick={() => setExtendDays(90)}
                        className={`px-3 py-1 rounded text-sm ${extendDays === 90 ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
                      >
                        90 days
                      </button>
                      <button
                        type="button"
                        onClick={() => setExtendDays(365)}
                        className={`px-3 py-1 rounded text-sm ${extendDays === 365 ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
                      >
                        1 year
                      </button>
                    </div>
                    <input
                      type="number"
                      min="1"
                      value={extendDays}
                      onChange={(e) => setExtendDays(parseInt(e.target.value) || 30)}
                      className="w-full mt-2 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      placeholder="Or enter custom days"
                    />
                  </div>

                  <div className="flex items-center justify-end space-x-3 pt-6 border-t">
                    <button
                      type="button"
                      onClick={() => setShowSubscriptionModal(false)}
                      className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center space-x-2"
                    >
                      <RefreshCw className="h-4 w-4" />
                      <span>Extend Subscription</span>
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </div>
      </div>
      
      {/* Push Updates Confirmation Dialog */}
      <MasterCompanyConfirmDialog
        isOpen={showPushUpdateDialog}
        onClose={() => setShowPushUpdateDialog(false)}
        onConfirm={confirmPushUpdates}
        title="Push Master Company Updates"
        message="This will sync updates from Master Company to all tenant companies. Select what to sync:"
        confirmText="Push Updates"
        cancelText="Cancel"
        destructive={false}
      />
      
      {showPushUpdateDialog && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-lg w-full mx-4">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-xl font-bold text-gray-900">Push Master Company Updates</h3>
                <button
                  onClick={() => setShowPushUpdateDialog(false)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              
              {isMasterCompany && (
                <div className="mb-4 p-3 bg-orange-50 border border-orange-200 rounded-lg">
                  <div className="flex items-center space-x-2 text-orange-800">
                    <AlertTriangle className="h-4 w-4" />
                    <span className="text-sm font-semibold">Master Company Mode Active</span>
                  </div>
                  <p className="text-xs text-orange-700 mt-1">
                    This will sync updates from Master Company to all tenant companies.
                  </p>
                </div>
              )}
              
              <p className="text-gray-700 mb-4">Select what to sync:</p>
              
              <div className="space-y-3 mb-6">
                <label className="flex items-center space-x-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={pushUpdateOptions.sync_chart_of_accounts}
                    onChange={(e) => setPushUpdateOptions({...pushUpdateOptions, sync_chart_of_accounts: e.target.checked})}
                    className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-700">Chart of Accounts (new accounts only)</span>
                </label>
                
                <label className="flex items-center space-x-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={pushUpdateOptions.sync_items}
                    onChange={(e) => setPushUpdateOptions({...pushUpdateOptions, sync_items: e.target.checked})}
                    className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-700">Items/Products (new items only)</span>
                </label>
                
                <label className="flex items-center space-x-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={pushUpdateOptions.sync_tax_codes}
                    onChange={(e) => setPushUpdateOptions({...pushUpdateOptions, sync_tax_codes: e.target.checked})}
                    className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-700">Tax Codes (new codes only)</span>
                </label>
                
                <label className="flex items-center space-x-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={pushUpdateOptions.sync_company_settings}
                    onChange={(e) => setPushUpdateOptions({...pushUpdateOptions, sync_company_settings: e.target.checked})}
                    className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-700">Company Settings (currency, timezone, fiscal year)</span>
                </label>
              </div>
              
              <div className="flex space-x-3 justify-end">
                <button
                  onClick={() => setShowPushUpdateDialog(false)}
                  className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmPushUpdates}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                >
                  Push Updates
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  )
}

export default function SuperAdminPage() {
  // Redirect to overview page
  const router = useRouter()
  useEffect(() => {
    router.replace('/admin/overview')
  }, [router])
  
  return null
}

