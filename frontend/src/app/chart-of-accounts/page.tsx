'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Sidebar from '@/components/Sidebar'
import { Plus, Edit2, Trash2, X, FileText, Filter, AlertTriangle, RefreshCw, LayoutTemplate, Loader2 } from 'lucide-react'
import { useToast } from '@/components/Toast'
import api, { getBackendOrigin, isSuperAdminRole } from '@/lib/api'
import { useCompany } from '@/contexts/CompanyContext'
import { getCurrencySymbol, formatNumber } from '@/utils/currency'
import { isConnectionError, safeLogError } from '@/utils/connectionError'
import { formatDateOnly } from '@/utils/date'

interface AccountUsage {
  journal_lines: number
  sub_accounts: number
  bank_links: number
}

interface LinkedBankRegister {
  id: number
  account_name: string
  bank_name: string
  account_number: string
}

/** QuickBooks-style bank/cash details stored on the chart line (syncs payment / deposit pickers). */
interface BankRegisterSummary {
  id: number
  bank_name: string
  account_number: string
  register_type: string
  current_balance?: string
}

interface Account {
  id: number
  account_code: string
  account_name: string
  account_type: string
  account_sub_type: string  // Fixed: backend uses account_sub_type (with underscore)
  description: string
  current_balance: number | string
  opening_balance?: number | string
  opening_balance_date?: string
  is_active: boolean
  parent_account_id: number | null
  /** When false, delete is blocked (journal lines, sub-accounts, or bank links). */
  can_delete?: boolean
  usage?: AccountUsage
  /** Legacy: multiple links; prefer bank_register. */
  linked_banks?: LinkedBankRegister[]
  bank_register?: BankRegisterSummary | null
}

interface StatementTransaction {
  id: number
  type: string
  date: string
  reference: string
  description: string
  debit_amount: number
  credit_amount: number
  amount: number
  journal_entry_id: number
  journal_entry_number: string
  other_account_name: string | null
  other_account_code: string | null
}

interface AccountStatement {
  account: {
    id: number
    account_code: string
    account_name: string
    account_type: string
    account_sub_type: string
    description: string | null
    currency: string
    opening_balance?: number | string
  }
  period: {
    start_date: string
    end_date: string
  }
  opening_balance: number
  closing_balance: number
  total_debits: number
  total_credits: number
  transactions: StatementTransaction[]
  transaction_count: number
}

// Account types
const ACCOUNT_TYPES = [
  { value: 'asset', label: 'Asset' },
  { value: 'bank_account', label: 'Bank Account' },
  { value: 'liability', label: 'Liability' },
  { value: 'loan', label: 'Loan' },
  { value: 'equity', label: 'Equity' },
  { value: 'income', label: 'Income' },
  { value: 'expense', label: 'Expense' },
  { value: 'cost_of_goods_sold', label: 'Cost of Goods Sold' },
]

/** Types shown on summary dashboard cards (subset of ACCOUNT_TYPES). */
const SUMMARY_ACCOUNT_TYPE_VALUES = ['asset', 'bank_account', 'liability', 'loan', 'equity', 'income'] as const

// Common account sub-types (simplified list)
const ACCOUNT_SUBTYPES: Record<string, Array<{ value: string; label: string }>> = {
  asset: [
    { value: 'cash_on_hand', label: 'Cash on Hand' },
    { value: 'checking', label: 'Checking' },
    { value: 'savings', label: 'Savings' },
    { value: 'accounts_receivable', label: 'Accounts Receivable' },
    { value: 'inventory', label: 'Inventory' },
    { value: 'prepaid_expenses', label: 'Prepaid Expenses' },
    { value: 'fixed_asset', label: 'Fixed Asset' },
    { value: 'machinery_and_equipment', label: 'Machinery and Equipment' },
    { value: 'vehicles', label: 'Vehicles' },
    { value: 'other_current_asset', label: 'Other Current Asset' },
    { value: 'allowance_for_bad_debts', label: 'Allowance for bad debts (contra AR)' },
    { value: 'accumulated_depreciation', label: 'Accumulated depreciation (contra asset)' },
  ],
  bank_account: [
    { value: 'checking', label: 'Checking' },
    { value: 'savings', label: 'Savings' },
    { value: 'money_market', label: 'Money Market' },
    { value: 'cash_management', label: 'Cash Management' },
    { value: 'other_bank_account', label: 'Other Bank Account' },
  ],
  liability: [
    { value: 'accounts_payable', label: 'Accounts Payable' },
    { value: 'credit_card', label: 'Credit Card' },
    { value: 'sales_tax_payable', label: 'Sales Tax Payable' },
    { value: 'payroll_tax_payable', label: 'Payroll Tax Payable' },
    { value: 'loan_payable', label: 'Loan Payable' },
    { value: 'other_current_liability', label: 'Other Current Liability' },
    { value: 'long_term_liability', label: 'Long Term Liability' }
  ],
  loan: [
    { value: 'loan_receivable', label: 'Loan receivable (money you lent)' },
    { value: 'loan_payable', label: 'Loan payable (money you borrowed)' },
  ],
  equity: [
    { value: 'equity', label: 'Equity' },
    { value: 'owner_equity', label: 'Owner Equity' },
    { value: 'retained_earnings', label: 'Retained Earnings' },
    { value: 'opening_balance_equity', label: 'Opening Balance Equity' }
  ],
  income: [
    { value: 'income', label: 'Income' },
    { value: 'sales_of_product_income', label: 'Sales of Product Income' },
    { value: 'service_fee_income', label: 'Service Fee Income' },
    { value: 'other_income', label: 'Other Income' },
    { value: 'discounts_refunds_given', label: 'Discounts & refunds (contra revenue)' },
  ],
  expense: [
    { value: 'expense', label: 'Expense' },
    { value: 'utilities', label: 'Utilities' },
    { value: 'rent_or_lease_of_buildings', label: 'Rent or Lease' },
    { value: 'repair_maintenance', label: 'Repair & Maintenance' },
    { value: 'supplies_materials', label: 'Supplies & Materials' },
    { value: 'office_general_administrative_expenses', label: 'Office & Administrative' },
    { value: 'advertising_promotional', label: 'Advertising & Promotional' },
    { value: 'insurance', label: 'Insurance' },
    { value: 'payroll_expenses', label: 'Payroll Expenses' },
    { value: 'other_business_expenses', label: 'Other Business Expenses' }
  ],
  cost_of_goods_sold: [
    { value: 'cost_of_goods_sold', label: 'Cost of Goods Sold' },
    { value: 'supplies_materials_cogs', label: 'Supplies & Materials COGS' },
    { value: 'cost_of_labor_cos', label: 'Cost of Labor COS' }
  ]
}

const BANK_REGISTER_SUBTYPES = new Set([
  'checking',
  'savings',
  'cash_on_hand',
  'money_market',
  'cash_management',
  'other_bank_account',
])

/** Asset / Bank account types that hold institution + account # on the chart (QuickBooks-style). */
function isBankStyleCoa(accountType: string, accountSubType: string): boolean {
  const t = (accountType || '').toLowerCase()
  const st = (accountSubType || '').toLowerCase()
  if (t === 'bank_account') return true
  return t === 'asset' && BANK_REGISTER_SUBTYPES.has(st)
}

function deleteBlockedHint(account: Account): string {
  const u = account.usage
  if (!u) return 'This account cannot be deleted while it is referenced elsewhere.'
  const parts: string[] = []
  if (u.journal_lines) parts.push(`${u.journal_lines} journal line(s)`)
  if (u.sub_accounts) parts.push(`${u.sub_accounts} sub-account(s)`)
  if (u.bank_links) parts.push(`${u.bank_links} bank / deposit link(s)`)
  if (parts.length === 0) return 'Cannot delete'
  return `In use: ${parts.join(', ')}. Remove those links first, or use Edit → turn off Active to deactivate.`
}

/** Map Django statement JSON to the shape the statement modal expects. */
function mapStatementApiToView(
  data: Record<string, unknown>,
  fallbackPeriod: { start: string; end: string },
  displayCurrency: string
): AccountStatement {
  const account = data.account as AccountStatement['account'] | undefined
  if (!account?.id) {
    throw new Error('Invalid statement: missing account')
  }
  const txsRaw = Array.isArray(data.transactions) ? (data.transactions as Record<string, unknown>[]) : []
  const transactions: StatementTransaction[] = txsRaw.map((t) => {
    const debit = Number(t.debit ?? t.debit_amount ?? 0)
    const credit = Number(t.credit ?? t.credit_amount ?? 0)
    const type = debit > 0 ? 'Debit' : credit > 0 ? 'Credit' : '—'
    const amount = debit > 0 ? debit : credit
    return {
      id: Number(t.id),
      type,
      date: (t.date as string) || '',
      reference: String(t.reference ?? t.entry_number ?? ''),
      description: String(t.description ?? ''),
      debit_amount: debit,
      credit_amount: credit,
      amount,
      journal_entry_id: Number(t.journal_entry_id ?? 0),
      journal_entry_number: String(t.journal_entry_number ?? t.entry_number ?? ''),
      other_account_name: (t.other_account_name as string | null) ?? null,
      other_account_code: (t.other_account_code as string | null) ?? null,
    }
  })

  let totalDebits = 0
  let totalCredits = 0
  for (const t of transactions) {
    totalDebits += t.debit_amount
    totalCredits += t.credit_amount
  }

  const closing = Number(
    data.ending_balance ?? data.closing_balance ?? account.opening_balance ?? 0
  )
  let opening = Number(account.opening_balance ?? 0)
  if (transactions.length > 0 && txsRaw[0]?.balance != null) {
    const t0 = transactions[0]
    opening = Number(txsRaw[0].balance) - (t0.debit_amount - t0.credit_amount)
  }

  const periodObj = data.period as { start_date?: string; end_date?: string } | undefined
  const start =
    periodObj?.start_date ??
    (data.start_date as string | null | undefined) ??
    fallbackPeriod.start
  const end =
    periodObj?.end_date ?? (data.end_date as string | null | undefined) ?? fallbackPeriod.end

  return {
    account: {
      ...account,
      account_sub_type: account.account_sub_type || '',
      description: account.description ?? null,
      currency: displayCurrency,
    },
    period: {
      start_date: start || fallbackPeriod.start,
      end_date: end || fallbackPeriod.end,
    },
    opening_balance: opening,
    closing_balance: closing,
    total_debits: totalDebits,
    total_credits: totalCredits,
    transactions,
    transaction_count: transactions.length,
  }
}

export default function ChartOfAccountsPage() {
  const router = useRouter()
  const toast = useToast()
  const { selectedCompany } = useCompany()
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [retryCount, setRetryCount] = useState(0)
  const [showModal, setShowModal] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<number | null>(null)
  const [editingAccount, setEditingAccount] = useState<Account | null>(null)
  const [showStatement, setShowStatement] = useState(false)
  const [statement, setStatement] = useState<AccountStatement | null>(null)
  const [statementAccountId, setStatementAccountId] = useState<number | null>(null)
  const [statementLoading, setStatementLoading] = useState(false)
  const [statementStartDate, setStatementStartDate] = useState<string>('')
  const [statementEndDate, setStatementEndDate] = useState<string>('')
  const [currencySymbol, setCurrencySymbol] = useState<string>('৳') // Default to BDT

  /** Built-in fuel retail COA template (metadata from API). */
  const [fuelTemplateMeta, setFuelTemplateMeta] = useState<{
    name?: string
    version?: string
    summary?: string
    numbering_scheme?: string
    account_counts?: { full?: number; retail?: number }
  } | null>(null)
  const [seedBusy, setSeedBusy] = useState(false)
  const [backfillBusy, setBackfillBusy] = useState(false)
  /** Registers in DB with no chart line — they do not appear in the table until synced. */
  const [unlinkedBanks, setUnlinkedBanks] = useState<
    Array<{ id: number; account_name: string; bank_name: string; account_number: string }>
  >([])
  const [syncingBanks, setSyncingBanks] = useState(false)
  const [isSuperAdminUser, setIsSuperAdminUser] = useState(false)

  // Filters
  const [filterCode, setFilterCode] = useState('')
  const [filterAccountName, setFilterAccountName] = useState('')
  const [filterType, setFilterType] = useState('')
  
  const [formData, setFormData] = useState({
    account_code: '',
    account_name: '',
    account_type: 'asset' as string,
    account_sub_type: '',
    description: '',
    opening_balance: 0,
    opening_balance_date: new Date().toISOString().split('T')[0],
    is_active: true,
    parent_account_id: null as number | null,
    bank_name: '',
    bank_account_number: '',
    register_type: 'CHECKING',
  })

  useEffect(() => {
    const token = localStorage.getItem('access_token')
    if (!token) {
      console.warn('No access token found, redirecting to login')
      router.push('/login')
      return
    }
    fetchAccounts()
    // Refetch when selected company changes (e.g. switch to Master Filling Station)
  }, [router, selectedCompany?.id])

  useEffect(() => {
    try {
      const raw = typeof window !== 'undefined' ? localStorage.getItem('user') : null
      if (raw) {
        const user = JSON.parse(raw)
        setIsSuperAdminUser(isSuperAdminRole(user?.role))
      } else {
        setIsSuperAdminUser(false)
      }
    } catch {
      setIsSuperAdminUser(false)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    const loadMeta = async () => {
      if (typeof window === 'undefined' || !localStorage.getItem('access_token')) return
      try {
        const res = await api.get('/chart-of-accounts/templates/fuel-station/')
        if (!cancelled) setFuelTemplateMeta(res.data)
      } catch {
        /* template endpoint optional if older backend */
      }
    }
    loadMeta()
    return () => {
      cancelled = true
    }
  }, [])

  const handleSeedFuelTemplate = async (profile: 'full' | 'retail', replace: boolean) => {
    if (replace) {
      const ok = window.confirm(
        'Replace all chart of accounts for this company? Existing accounts will be deleted. ' +
          'Linked journal entries may become invalid. This cannot be undone.'
      )
      if (!ok) return
    }
    setSeedBusy(true)
    try {
      const res = await api.post('/chart-of-accounts/seed-template/', {
        template_id: 'fuel_station_v1',
        profile,
        replace
      })
      const added = res.data?.added ?? 0
      const skipped = res.data?.skipped ?? 0
      toast.success(
        replace
          ? `Chart replaced: ${added} account(s) imported.`
          : `Template applied: ${added} new account(s), ${skipped} already existed (skipped).`
      )
      await fetchAccounts(true)
    } catch (error: any) {
      const detail = error.response?.data?.detail
      toast.error(typeof detail === 'string' ? detail : 'Could not import chart template.')
    } finally {
      setSeedBusy(false)
    }
  }

  const handleBackfillDescriptions = async () => {
    setBackfillBusy(true)
    try {
      const res = await api.post('/chart-of-accounts/backfill-descriptions/', { only_blank: true })
      const u = res.data?.updated ?? 0
      toast.success(
        u > 0
          ? `Updated ${u} account description(s) from the built-in guide.`
          : 'No empty descriptions to fill (or no matching template codes).'
      )
      await fetchAccounts(true)
    } catch (error: unknown) {
      const detail = (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      toast.error(typeof detail === 'string' ? detail : 'Could not backfill descriptions.')
    } finally {
      setBackfillBusy(false)
    }
  }

  const refreshUnlinkedBanks = async () => {
    try {
      const res = await api.get('/bank-accounts/')
      if (!Array.isArray(res.data)) {
        setUnlinkedBanks([])
        return
      }
      const rows = res.data.filter(
        (b: { chart_account_id?: number | null }) =>
          b.chart_account_id == null || b.chart_account_id === 0
      )
      setUnlinkedBanks(
        rows.map((b: { id: number; account_name: string; bank_name: string; account_number: string }) => ({
          id: b.id,
          account_name: b.account_name,
          bank_name: b.bank_name,
          account_number: b.account_number,
        }))
      )
    } catch {
      setUnlinkedBanks([])
    }
  }

  const fetchAccounts = async (isRetry = false) => {
    try {
      setError(null)
      if (!isRetry) {
        setLoading(true)
      }

      // Fetch company currency
      try {
        const companyRes = await api.get('/companies/current')
        if (companyRes.data?.currency) {
          setCurrencySymbol(getCurrencySymbol(companyRes.data.currency))
        }
      } catch (error) {
        // Silently handle connection errors - backend may not be running
        if (!isConnectionError(error)) {
          console.error('Error fetching company currency:', error)
        }
        // Don't fail the whole fetch if currency fails
      }

      // Try the API call
      const response = await api.get('/chart-of-accounts/')
      
      if (Array.isArray(response.data) && response.data.length === 0) {
        console.warn('API returned empty array - no accounts found for this company')
      }

      // Handle response
      const accountsData = response.data
      
      if (response.status === 200) {
        if (Array.isArray(accountsData)) {
          if (accountsData.length === 0) {
            console.warn('⚠️ API returned empty array - no accounts found for your company')
          }
          
          // Ensure all accounts have the correct field names
          const normalizedAccounts = accountsData.map((acc: any) => ({
            ...acc,
            account_sub_type: acc.account_sub_type || acc.account_subtype || '', // Handle both formats
            current_balance: acc.current_balance || 0,
            is_active: acc.is_active !== undefined ? acc.is_active : true,
            can_delete: acc.can_delete,
            usage: acc.usage
          }))
          
          setAccounts(normalizedAccounts)
          setError(null)
          setRetryCount(0)
        } else if (accountsData && Array.isArray(accountsData.data)) {
          // Normalize wrapped format
          const normalizedAccounts = accountsData.data.map((acc: any) => ({
            ...acc,
            account_sub_type: acc.account_sub_type || acc.account_subtype || '',
            current_balance: acc.current_balance || 0,
            is_active: acc.is_active !== undefined ? acc.is_active : true,
            can_delete: acc.can_delete,
            usage: acc.usage
          }))
          setAccounts(normalizedAccounts)
          setError(null)
          setRetryCount(0)
        } else if (accountsData === null || accountsData === undefined) {
          // Empty response is valid - no accounts yet
          setAccounts([])
          setError(null)
          setRetryCount(0)
        } else {
          const errorMsg = `Invalid response format: expected array of accounts, got ${typeof accountsData}. Data: ${JSON.stringify(accountsData).substring(0, 200)}`
          console.error('Invalid response format:', {
            status: response.status,
            dataType: typeof accountsData,
            data: accountsData,
            keys: accountsData ? Object.keys(accountsData) : 'N/A'
          })
          setError(errorMsg)
          toast.error(errorMsg)
        }
      } else {
        const errorMsg = `Unexpected response status: ${response.status}`
        console.error('Failed to load accounts:', response.status, accountsData)
        setError(errorMsg)
        toast.error(errorMsg)
      }
    } catch (error: any) {
      console.error('❌ Error fetching accounts - Full error object:', {
        error,
        message: error?.message,
        name: error?.name,
        stack: error?.stack,
        response: error?.response,
        request: error?.request,
        config: error?.config,
        code: error?.code
      })
      
      let errorMessage = 'Failed to load chart of accounts'
      
      if (error?.response) {
        const status = error.response.status
        const detail = error.response.data?.detail || error.response.data?.message || 'Unknown error'
        
        console.error('API Error Response Details:', {
          status,
          statusText: error.response.statusText,
          data: error.response.data,
          headers: error.response.headers,
          url: error.config?.url,
          method: error.config?.method
        })
        
        if (status === 401) {
          errorMessage = 'Authentication required. Please log in again.'
          localStorage.removeItem('access_token')
          localStorage.removeItem('refresh_token')
          router.push('/login')
          return
        } else if (status === 403) {
          // Extract detailed permission error from backend
          const permissionDetail = error.response.data?.detail || ''
          
          // Get current user role for better error message
          let currentRole = 'Unknown'
          try {
            const userStr = localStorage.getItem('user')
            if (userStr) {
              const user = JSON.parse(userStr)
              currentRole = user.role || 'Unknown'
            }
          } catch (e) {
            console.error('Error parsing user data:', e)
          }
          
          if (permissionDetail.includes('Required roles')) {
            errorMessage = `Permission Denied: ${permissionDetail}. Your current role (${currentRole}) does not have access to chart of accounts. Required roles: Super Admin, Admin, Accountant, or Cashier. Please contact an administrator.`
          } else {
            errorMessage = `Permission Denied: ${permissionDetail || `You do not have permission to view chart of accounts. Your current role (${currentRole}) is not authorized. Required roles: Super Admin, Admin, Accountant, or Cashier.`}`
          }
        } else if (status === 404) {
          errorMessage = `Chart of accounts endpoint not found. Please check if the backend is running correctly on ${getBackendOrigin()}`
        } else if (status === 500) {
          let serverError = 'Unknown server error'
          if (typeof detail === 'string') {
            serverError = detail
          } else if (detail && typeof detail === 'object') {
            serverError = detail.message || detail.error || JSON.stringify(detail)
          }
          errorMessage = `Server error: ${serverError}`
          
          if (serverError.toLowerCase().includes('no such column') || 
              serverError.toLowerCase().includes('operationalerror') ||
              serverError.toLowerCase().includes('schema')) {
            errorMessage = `Database schema error detected. The backend may need to apply database migrations. Error: ${serverError}`
          }
        } else {
          errorMessage = `Error ${status}: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`
        }
      } else if (error?.request) {
        // Silently handle connection errors
        if (!isConnectionError(error)) {
          safeLogError('❌ No response received from server:', {
            request: error.request,
            url: error.config?.url,
            method: error.config?.method
          })
        }
        errorMessage = `Unable to connect to server. Please ensure the backend is running on ${getBackendOrigin()}.`
      } else if (error?.code === 'ERR_NETWORK' || error?.message?.includes('Network Error')) {
        // Silently handle connection errors
        if (!isConnectionError(error)) {
          safeLogError('❌ Network error:', error)
        }
        errorMessage = `Network error: Cannot connect to the backend server. Please check: 1) Backend is running on ${getBackendOrigin()}, 2) No firewall blocking the connection, 3) Backend is accessible.`
      } else {
        safeLogError('❌ Request setup error:', error?.message || error)
        errorMessage = error?.message || 'An unexpected error occurred. Please check the browser console for details.'
      }
      
      // Only log final error if it's not a connection error
      if (!isConnectionError(error)) {
        safeLogError('Final error message:', errorMessage)
      }
      setError(errorMessage)
      toast.error(errorMessage)
    } finally {
      setLoading(false)
      void refreshUnlinkedBanks()
    }
  }

  const handleRetry = () => {
    setRetryCount(prev => prev + 1)
    fetchAccounts(true)
  }

  const handleSyncBanksToChart = async () => {
    if (unlinkedBanks.length === 0) return
    setSyncingBanks(true)
    try {
      const res = await api.post('/bank-accounts/link-unlinked-to-chart/')
      const n = typeof res.data?.count === 'number' ? res.data.count : 0
      toast.success(
        n === 0 ? 'No unlinked bank registers to add.' : `Added ${n} bank account(s) to the chart.`
      )
      await fetchAccounts(true)
      await refreshUnlinkedBanks()
    } catch (error: any) {
      if (error.response?.status === 401) {
        localStorage.removeItem('access_token')
        router.push('/login')
        toast.error('Session expired. Please login again.')
        return
      }
      toast.error(error.response?.data?.detail || 'Could not sync banks to the chart')
    } finally {
      setSyncingBanks(false)
    }
  }

  /** One-time per company / session: create chart lines for registers that only exist as bank rows (no chart link). */
  useEffect(() => {
    if (unlinkedBanks.length === 0) return
    if (typeof window === 'undefined') return
    const companyKey = String(selectedCompany?.id ?? 'none')
    const k = `fsms_auto_bank_sync_${companyKey}`
    if (sessionStorage.getItem(k)) return

    let cancelled = false
    void (async () => {
      try {
        const res = await api.post('/bank-accounts/link-unlinked-to-chart/')
        if (cancelled) return
        const n = typeof res.data?.count === 'number' ? res.data.count : 0
        if (n > 0) {
          sessionStorage.setItem(k, '1')
          toast.success(
            `Added ${n} bank account(s) to the chart. Scroll the table for names such as your operating bank or Adib Filling Station.`
          )
          await fetchAccounts(true)
        }
      } catch {
        /* Manual “Sync banks to chart” in the banner still works */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [unlinkedBanks.length, selectedCompany?.id])
  
  const fetchStatement = async (accountId: number) => {
    try {
      setStatementLoading(true)
      setStatementAccountId(accountId)
      
      // Set default date range (current month)
      const today = new Date()
      const firstDay = new Date(today.getFullYear(), today.getMonth(), 1)
      const startDate = statementStartDate || firstDay.toISOString().split('T')[0]
      const endDate = statementEndDate || today.toISOString().split('T')[0]
      
      const params = new URLSearchParams()
      if (startDate) params.append('start_date', startDate)
      if (endDate) params.append('end_date', endDate)
      
      const response = await api.get(`/chart-of-accounts/${accountId}/statement?${params.toString()}`)
      setStatement(
        mapStatementApiToView(response.data, { start: startDate, end: endDate }, currencySymbol)
      )
      setShowStatement(true)
      
      // Update date states if they were empty
      if (!statementStartDate) setStatementStartDate(startDate)
      if (!statementEndDate) setStatementEndDate(endDate)
    } catch (error: any) {
      console.error('Error fetching statement:', error)
      if (error.response?.status === 401) {
        localStorage.removeItem('access_token')
        router.push('/login')
        toast.error('Session expired. Please login again.')
        return
      }
      toast.error(error.response?.data?.detail || 'Failed to load account statement')
    } finally {
      setStatementLoading(false)
    }
  }
  
  const handleStatementDateChange = async () => {
    if (statementAccountId) {
      await fetchStatement(statementAccountId)
    }
  }

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!formData.account_code || !formData.account_name || !formData.account_sub_type) {
      toast.error('Please fill in all required fields')
      return
    }

    if (isBankStyleCoa(formData.account_type, formData.account_sub_type)) {
      const bn = formData.bank_name.trim()
      const an = formData.bank_account_number.trim()
      if ((bn && !an) || (!bn && an)) {
        toast.error('Institution name and account number must both be filled, or both left empty.')
        return
      }
    }

    try {
      const payload: Record<string, unknown> = {
        account_code: formData.account_code,
        account_name: formData.account_name,
        account_type: formData.account_type,
        account_sub_type: formData.account_sub_type,
        description: formData.description || null,
        opening_balance: formData.opening_balance,
        opening_balance_date: formData.opening_balance_date || null,
        parent_account_id: formData.parent_account_id || null,
        is_active: formData.is_active,
      }
      if (isBankStyleCoa(formData.account_type, formData.account_sub_type)) {
        const bn = formData.bank_name.trim()
        const an = formData.bank_account_number.trim()
        if (bn && an) {
          payload.bank_register = {
            bank_name: bn,
            account_number: an,
            register_type: formData.register_type,
          }
        }
      }

      await api.post('/chart-of-accounts/', payload)
      
      toast.success('Account created successfully!')
      setShowModal(false)
      resetForm()
      fetchAccounts()
    } catch (error: any) {
      console.error('Error creating account:', error)
      if (error.response?.status === 401) {
        localStorage.removeItem('access_token')
        router.push('/login')
        toast.error('Session expired. Please login again.')
        return
      }
      toast.error(error.response?.data?.detail || 'Failed to create account')
    }
  }

  const handleEdit = (account: Account) => {
    setEditingAccount(account)
    const br = account.bank_register
    setFormData({
      account_code: account.account_code,
      account_name: account.account_name,
      account_type: account.account_type,
      account_sub_type: account.account_sub_type,
      description: account.description || '',
      opening_balance: Number((account as any).opening_balance || account.current_balance || 0),
      opening_balance_date: (account as any).opening_balance_date
        ? new Date((account as any).opening_balance_date).toISOString().split('T')[0]
        : new Date().toISOString().split('T')[0],
      is_active: account.is_active,
      parent_account_id: account.parent_account_id,
      bank_name: br?.bank_name ?? '',
      bank_account_number: br?.account_number ?? '',
      register_type: br?.register_type ?? 'CHECKING',
    })
    setShowModal(true)
  }

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingAccount) return

    if (isBankStyleCoa(formData.account_type, formData.account_sub_type)) {
      const bn = formData.bank_name.trim()
      const an = formData.bank_account_number.trim()
      if ((bn && !an) || (!bn && an)) {
        toast.error('Institution name and account number must both be filled, or both left empty.')
        return
      }
    }

    try {
      const payload: Record<string, unknown> = {
        account_code: formData.account_code,
        account_name: formData.account_name,
        account_type: formData.account_type,
        account_sub_type: formData.account_sub_type,
        description: formData.description || null,
        opening_balance: formData.opening_balance,
        opening_balance_date: formData.opening_balance_date || null,
        parent_account_id: formData.parent_account_id || null,
        is_active: formData.is_active,
      }
      if (isBankStyleCoa(formData.account_type, formData.account_sub_type)) {
        const bn = formData.bank_name.trim()
        const an = formData.bank_account_number.trim()
        if (bn && an) {
          payload.bank_register = {
            bank_name: bn,
            account_number: an,
            register_type: formData.register_type,
          }
        } else if (editingAccount.bank_register) {
          payload.bank_register = null
        }
      }

      await api.put(`/chart-of-accounts/${editingAccount.id}/`, payload)

      toast.success('Account updated successfully!')
      setShowModal(false)
      setEditingAccount(null)
      resetForm()
      fetchAccounts()
    } catch (error: any) {
      console.error('Error updating account:', error)
      if (error.response?.status === 401) {
        localStorage.removeItem('access_token')
        router.push('/login')
        toast.error('Session expired. Please login again.')
        return
      }
      toast.error(error.response?.data?.detail || 'Failed to update account')
    }
  }

  const handleDelete = async (accountId: number) => {
    try {
      await api.delete(`/chart-of-accounts/${accountId}/`)
      toast.success('Account deleted successfully!')
      setShowDeleteConfirm(null)
      fetchAccounts()
    } catch (error: any) {
      console.error('Error deleting account:', error)
      if (error.response?.status === 401) {
        localStorage.removeItem('access_token')
        router.push('/login')
        toast.error('Session expired. Please login again.')
        return
      }
      if (error.response?.status === 409) {
        const d = error.response?.data
        const msg = typeof d?.detail === 'string' ? d.detail : 'Cannot delete: account is in use.'
        toast.error(msg)
        setShowDeleteConfirm(null)
        fetchAccounts(true)
        return
      }
      toast.error(error.response?.data?.detail || 'Failed to delete account')
    }
  }

  const resetForm = () => {
    setFormData({
      account_code: '',
      account_name: '',
      account_type: 'asset',
      account_sub_type: '',
      description: '',
      opening_balance: 0,
      opening_balance_date: new Date().toISOString().split('T')[0],
      is_active: true,
      parent_account_id: null,
      bank_name: '',
      bank_account_number: '',
      register_type: 'CHECKING',
    })
    setEditingAccount(null)
  }

  const handleCloseModal = () => {
    setShowModal(false)
    resetForm()
  }

  const getAvailableSubTypes = () => {
    return ACCOUNT_SUBTYPES[formData.account_type] || []
  }

  if (loading) {
    return (
      <div className="flex h-screen bg-gray-100 page-with-sidebar">
        <Sidebar />
        <div className="flex-1 overflow-auto p-8">
          <div className="flex flex-col justify-center items-center h-64 bg-white rounded-lg shadow">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mb-4"></div>
            <p className="text-gray-600">Loading chart of accounts...</p>
          </div>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex h-screen bg-gray-100 page-with-sidebar">
        <Sidebar />
        <div className="flex-1 overflow-auto p-8">
          <div className="mb-6">
            <h1 className="text-3xl font-bold text-gray-900">Chart of accounts</h1>
            <p className="text-gray-600 mt-1">Manage your accounting chart of accounts</p>
          </div>
          <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-center">
            <AlertTriangle className="h-12 w-12 text-red-600 mx-auto mb-4" />
            <h3 className="text-xl font-bold text-red-800 mb-2">Error Loading Chart of Accounts</h3>
            <p className="text-red-700 mb-4">{error}</p>
            <button
              onClick={handleRetry}
              className="inline-flex items-center space-x-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
            >
              <RefreshCw className="h-5 w-5" />
              <span>Retry</span>
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-screen bg-gray-100 page-with-sidebar">
      <Sidebar />
      <div className="flex-1 overflow-auto">
        <div className="p-8">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Chart of accounts</h1>
              <p className="text-gray-600 mt-1">
                All account types in one list (QuickBooks-style). Add bank and cash accounts here with institution and
                account number — they drive deposits, payments, and fund transfers.
              </p>
              <p className="text-gray-500 text-sm mt-2">
                Bank lines use type <strong>Asset</strong> with sub-type <strong>Checking</strong> or{' '}
                <strong>Cash on hand</strong>, or type <strong>Bank account</strong>. Clear the type filter below if you
                do not see every account.
              </p>
            </div>
            <button
              onClick={() => {
                resetForm()
                setShowModal(true)
              }}
              className="flex items-center space-x-2 px-5 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-all shadow-md hover:shadow-lg font-medium"
            >
              <Plus className="h-5 w-5" />
              <span>New Account</span>
            </button>
          </div>

          <div className="mb-6 rounded-lg border border-sky-200 bg-sky-50 px-4 py-4 text-sm text-sky-950 shadow-sm">
            <p className="font-semibold text-sky-900">Where is my cashier / POS sale money?</p>
            <p className="mt-1 text-sky-900/95 leading-relaxed">
              It is <strong>not</strong> missing — it is booked as a <strong>debit</strong> on a <strong>cash asset</strong>{' '}
              in this chart (after you seed the fuel template, usually code{' '}
              <strong className="font-mono">1010</strong> Petty cash or <strong className="font-mono">1020</strong> Cash
              clearing / undeposited). <strong>Card</strong> sales use <strong className="font-mono">1120</strong> card
              clearing. There is no separate “Undeposited funds” menu: open the account here and use{' '}
              <strong>View statement</strong> to see each sale. On <strong>Reports → Trial balance</strong>, widen the date
              range to include the sale dates and scroll for codes <span className="font-mono">1010</span>,{' '}
              <span className="font-mono">1020</span>, or <span className="font-mono">1120</span>. To hit a specific bank
              line instead, use the optional <strong>Where to record this sale&apos;s cash</strong> picker on the
              Cashier screen.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium text-sky-800">Quick filter:</span>
              {[
                { code: '1010', label: '1010' },
                { code: '1020', label: '1020 Undeposited' },
                { code: '1120', label: '1120 Card' },
              ].map(x => (
                <button
                  key={x.code}
                  type="button"
                  onClick={() => {
                    setFilterCode(x.code)
                    setFilterAccountName('')
                    setFilterType('')
                  }}
                  className="rounded-md border border-sky-300 bg-white px-2.5 py-1 text-xs font-medium text-sky-900 hover:bg-sky-100"
                >
                  {x.label}
                </button>
              ))}
              <button
                type="button"
                onClick={() => {
                  setFilterCode('')
                  setFilterAccountName('undeposited')
                  setFilterType('')
                }}
                className="rounded-md border border-sky-300 bg-white px-2.5 py-1 text-xs font-medium text-sky-900 hover:bg-sky-100"
              >
                Name contains “undeposited”
              </button>
              <button
                type="button"
                onClick={() => {
                  setFilterCode('')
                  setFilterAccountName('')
                  setFilterType('')
                }}
                className="rounded-md border border-sky-200 bg-sky-100/80 px-2.5 py-1 text-xs text-sky-800 hover:bg-sky-100"
              >
                Clear filters
              </button>
            </div>
          </div>

          {unlinkedBanks.length > 0 && (
            <div className="mb-6 rounded-lg border border-amber-300 bg-amber-50 px-4 py-4 text-sm text-amber-950 shadow-sm">
              <p className="font-semibold">Bank registers are not on this list yet</p>
              <p className="mt-1 text-amber-900/95">
                Only <strong>chart</strong> accounts appear in the table below. You still have{' '}
                <strong>{unlinkedBanks.length}</strong> bank/cash register
                {unlinkedBanks.length === 1 ? '' : 's'} that were never given a chart line (for example from the old Bank
                Accounts flow). Use the button to create matching chart lines with automatic codes.
              </p>
              <ul className="mt-2 max-h-32 overflow-y-auto list-disc pl-5 text-amber-900/90">
                {unlinkedBanks.slice(0, 12).map((b) => (
                  <li key={b.id}>
                    {b.account_name} — {b.bank_name}
                    {b.account_number ? ` (${b.account_number})` : ''}
                  </li>
                ))}
                {unlinkedBanks.length > 12 && (
                  <li className="list-none pl-0 text-amber-800/90">…and {unlinkedBanks.length - 12} more</li>
                )}
              </ul>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  disabled={syncingBanks}
                  onClick={() => void handleSyncBanksToChart()}
                  className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white shadow hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {syncingBanks ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  {syncingBanks ? 'Syncing…' : 'Sync banks to chart (auto codes)'}
                </button>
                <span className="text-xs text-amber-900/80">
                  Creates one asset line per register; then they show in the table with institution and account number.
                </span>
              </div>
              {isSuperAdminUser && (
                <p className="mt-3 border-t border-amber-200/80 pt-3 text-xs text-amber-900/85">
                  <strong>Super admin:</strong> bank data is scoped to the <strong>selected company</strong>. If you see
                  no banks here, open the company selector and choose the tenant where Adib / United Commercial accounts
                  were created, then refresh this page.
                </p>
              )}
            </div>
          )}

          {/* Built-in fuel retail COA template */}
          {fuelTemplateMeta && (
            <div className="mb-6 rounded-xl border border-indigo-200 bg-gradient-to-br from-indigo-50/90 to-white p-6 shadow-sm">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="flex gap-3">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-indigo-600 text-white shadow">
                    <LayoutTemplate className="h-5 w-5" />
                  </div>
                  <div>
                    <h2 className="text-lg font-semibold text-gray-900">
                      {fuelTemplateMeta.name || 'Fuel station chart of accounts'}
                    </h2>
                    <p className="mt-1 text-sm text-gray-600 leading-relaxed max-w-3xl">
                      {fuelTemplateMeta.summary}
                    </p>
                    {fuelTemplateMeta.numbering_scheme && (
                      <p className="mt-2 text-xs text-gray-500 font-mono bg-white/60 rounded px-2 py-1 inline-block">
                        {fuelTemplateMeta.numbering_scheme}
                      </p>
                    )}
                    <p className="mt-2 text-xs text-gray-500">
                      Full ≈ {fuelTemplateMeta.account_counts?.full ?? '—'} accounts · Fuel-first ≈{' '}
                      {fuelTemplateMeta.account_counts?.retail ?? '—'} accounts
                      {fuelTemplateMeta.version ? ` · v${fuelTemplateMeta.version}` : ''}
                    </p>
                    <p className="mt-2 text-xs text-gray-600">
                      Each account includes a short explanation of what it is for and (where relevant) how FSERP uses it
                      in automatic postings.
                    </p>
                  </div>
                </div>
                <div className="flex flex-col sm:flex-row flex-wrap gap-2 lg:shrink-0">
                  <button
                    type="button"
                    disabled={seedBusy}
                    onClick={() => handleSeedFuelTemplate('full', false)}
                    className="inline-flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white shadow hover:bg-indigo-700 disabled:opacity-50"
                  >
                    {seedBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    Import full template
                  </button>
                  <button
                    type="button"
                    disabled={seedBusy}
                    onClick={() => handleSeedFuelTemplate('retail', false)}
                    className="inline-flex items-center justify-center gap-2 rounded-lg border border-indigo-300 bg-white px-4 py-2.5 text-sm font-medium text-indigo-800 hover:bg-indigo-50 disabled:opacity-50"
                  >
                    Import fuel-first (retail)
                  </button>
                  <button
                    type="button"
                    disabled={seedBusy}
                    onClick={() => handleSeedFuelTemplate('full', true)}
                    className="inline-flex items-center justify-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-medium text-red-800 hover:bg-red-100 disabled:opacity-50"
                  >
                    Replace all with full template
                  </button>
                  <button
                    type="button"
                    disabled={backfillBusy || accounts.length === 0}
                    onClick={() => void handleBackfillDescriptions()}
                    className="inline-flex items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-800 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                    title="Fill only accounts that still have an empty description"
                  >
                    {backfillBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    Fill missing descriptions
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Summary Cards */}
          {accounts.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4 mb-6">
              {SUMMARY_ACCOUNT_TYPE_VALUES.map((typeValue) => {
                const type = ACCOUNT_TYPES.find((t) => t.value === typeValue)!
                const typeAccounts = accounts.filter((acc) => acc.account_type === type.value)
                const totalBalance = typeAccounts.reduce((sum, acc) => sum + Number(acc.current_balance || 0), 0)
                const accountCount = typeAccounts.length
                
                const typeColors: Record<string, { bg: string; text: string; border: string }> = {
                  asset: { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200' },
                  bank_account: { bg: 'bg-cyan-50', text: 'text-cyan-800', border: 'border-cyan-300' },
                  liability: { bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-200' },
                  equity: { bg: 'bg-purple-50', text: 'text-purple-700', border: 'border-purple-200' },
                  income: { bg: 'bg-green-50', text: 'text-green-700', border: 'border-green-200' },
                  expense: { bg: 'bg-orange-50', text: 'text-orange-700', border: 'border-orange-200' },
                  cost_of_goods_sold: { bg: 'bg-yellow-50', text: 'text-yellow-700', border: 'border-yellow-200' }
                }
                
                const colors = typeColors[type.value] || { bg: 'bg-gray-50', text: 'text-gray-700', border: 'border-gray-200' }
                
                return (
                  <div key={type.value} className={`bg-white rounded-lg shadow-md p-5 border-l-4 ${colors.border}`}>
                    <div className="flex items-center justify-between mb-2">
                      <h3 className={`text-sm font-semibold ${colors.text} uppercase tracking-wide`}>
                        {type.label}
                      </h3>
                      <span className={`text-xs px-2 py-1 rounded-full ${colors.bg} ${colors.text} font-medium`}>
                        {accountCount}
                      </span>
                    </div>
                    <p className={`text-2xl font-bold ${colors.text}`}>
                      {currencySymbol}{formatNumber(Math.abs(totalBalance))}
                    </p>
                    <p className="text-xs text-gray-500 mt-1">
                      {accountCount} {accountCount === 1 ? 'account' : 'accounts'}
                    </p>
                  </div>
                )
              })}
            </div>
          )}

          {/* Filters */}
          <div className="bg-white rounded-lg shadow-md p-6 mb-6 border border-gray-100">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center space-x-2">
                <Filter className="h-5 w-5 text-gray-600" />
                <h2 className="text-lg font-semibold text-gray-900">Search & Filter</h2>
              </div>
              {(filterCode || filterAccountName || filterType) && (
                <button
                  onClick={() => {
                    setFilterCode('')
                    setFilterAccountName('')
                    setFilterType('')
                  }}
                  className="text-sm text-blue-600 hover:text-blue-700 font-medium"
                >
                  Clear All
                </button>
              )}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Account Code
                </label>
                <input
                  type="text"
                  value={filterCode}
                  onChange={(e) => setFilterCode(e.target.value)}
                  placeholder="Search by code..."
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all shadow-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Account Name
                </label>
                <input
                  type="text"
                  value={filterAccountName}
                  onChange={(e) => setFilterAccountName(e.target.value)}
                  placeholder="Search by name..."
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all shadow-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Account Type
                </label>
                <select
                  value={filterType}
                  onChange={(e) => setFilterType(e.target.value)}
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all shadow-sm bg-white"
                >
                  <option value="">All Types</option>
                  {ACCOUNT_TYPES.map(type => (
                    <option key={type.value} value={type.value}>
                      {type.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-lg overflow-hidden border border-gray-100">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gradient-to-r from-gray-50 to-gray-100">
                  <tr>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                      Code
                    </th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                      Account Name
                    </th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                      Type
                    </th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                      Sub-Type
                    </th>
                    <th className="px-6 py-4 text-right text-xs font-semibold text-gray-700 uppercase tracking-wider">
                      Balance
                    </th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                      Status
                    </th>
                    <th className="px-6 py-4 text-right text-xs font-semibold text-gray-700 uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {(() => {
                    const filteredAccounts = accounts.filter((account) => {
                      if (filterCode && !account.account_code.toLowerCase().includes(filterCode.toLowerCase())) {
                        return false
                      }
                      if (filterAccountName && !account.account_name.toLowerCase().includes(filterAccountName.toLowerCase())) {
                        return false
                      }
                      if (filterType && account.account_type !== filterType) {
                        return false
                      }
                      return true
                    })

                    if (filteredAccounts.length === 0) {
                      return (
                        <tr>
                          <td colSpan={7} className="px-6 py-16 text-center">
                            <div className="flex flex-col items-center">
                              <div className="bg-gray-100 rounded-full p-4 mb-4">
                                <FileText className="h-10 w-10 text-gray-400" />
                              </div>
                              <h3 className="text-lg font-semibold text-gray-900 mb-2">
                                {accounts.length === 0 ? 'No Accounts Found' : 'No Matching Accounts'}
                              </h3>
                              <p className="text-gray-600 mb-4 max-w-md text-center">
                                {accounts.length === 0
                                  ? 'Use Import full template above for the complete fuel-station chart with descriptions, or add a single custom account.'
                                  : 'No accounts match your current filters. Try adjusting your search criteria.'}
                              </p>
                              {accounts.length === 0 && (
                                <div className="flex flex-col sm:flex-row flex-wrap items-center justify-center gap-3">
                                  <button
                                    type="button"
                                    disabled={seedBusy || !fuelTemplateMeta}
                                    onClick={() => handleSeedFuelTemplate('full', false)}
                                    className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors flex items-center gap-2 disabled:opacity-50"
                                  >
                                    {seedBusy ? <Loader2 className="h-5 w-5 animate-spin" /> : <LayoutTemplate className="h-5 w-5" />}
                                    <span>Import full template</span>
                                  </button>
                                  <button
                                    onClick={() => {
                                      resetForm()
                                      setShowModal(true)
                                    }}
                                    className="px-4 py-2 border border-gray-300 bg-white text-gray-800 rounded-lg hover:bg-gray-50 transition-colors flex items-center gap-2"
                                  >
                                    <Plus className="h-5 w-5" />
                                    <span>Create one account</span>
                                  </button>
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )
                    }

                    return filteredAccounts
                      .filter((account) => account && account.id) // Filter out any null/invalid accounts
                      .map((account) => {
                      // Safety checks for account data
                      if (!account || !account.id) {
                        console.warn('Invalid account data:', account)
                        return null
                      }
                      
                      const balance = Number(account.current_balance || 0)
                      const isNegative = balance < 0
                      const accountTypeColors: Record<string, { bg: string; text: string }> = {
                        asset: { bg: 'bg-blue-100', text: 'text-blue-800' },
                        bank_account: { bg: 'bg-cyan-100', text: 'text-cyan-900' },
                        liability: { bg: 'bg-red-100', text: 'text-red-800' },
                        loan: { bg: 'bg-indigo-100', text: 'text-indigo-900' },
                        equity: { bg: 'bg-purple-100', text: 'text-purple-800' },
                        income: { bg: 'bg-green-100', text: 'text-green-800' },
                        expense: { bg: 'bg-orange-100', text: 'text-orange-800' },
                        cost_of_goods_sold: { bg: 'bg-yellow-100', text: 'text-yellow-800' }
                      }
                      const typeColors = accountTypeColors[account.account_type || ''] || { bg: 'bg-gray-100', text: 'text-gray-800' }
                      
                      return (
                        <tr key={account.id} className="hover:bg-blue-50 transition-colors border-b border-gray-100">
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span className="text-sm font-semibold text-gray-900 font-mono">
                              {account.account_code || 'N/A'}
                            </span>
                          </td>
                          <td className="px-6 py-4">
                            <div className="text-sm font-medium text-gray-900">
                              {account.account_name || 'Unnamed Account'}
                            </div>
                            {account.description && (
                              <div
                                className="text-xs text-gray-600 mt-1 max-w-xl line-clamp-4 whitespace-pre-line"
                                title={account.description}
                              >
                                {account.description}
                              </div>
                            )}
                            {account.bank_register && (
                              <div className="mt-1.5 text-xs text-cyan-900 font-medium">
                                {account.bank_register.bank_name}
                                {account.bank_register.account_number
                                  ? ` · ${account.bank_register.account_number}`
                                  : ''}
                                <span className="text-gray-500 font-normal">
                                  {' '}
                                  ({account.bank_register.register_type})
                                </span>
                              </div>
                            )}
                            {!account.bank_register &&
                              account.linked_banks &&
                              account.linked_banks.length > 0 && (
                              <div className="mt-2 flex flex-wrap gap-1">
                                {account.linked_banks.map((lb) => (
                                  <span
                                    key={lb.id}
                                    className="inline-flex items-center rounded-md border border-cyan-200 bg-cyan-50 px-2 py-0.5 text-xs font-medium text-cyan-900"
                                    title="Bank / deposit details"
                                  >
                                    {lb.bank_name}
                                    {lb.account_number ? ` · ${lb.account_number}` : ''}
                                  </span>
                                ))}
                              </div>
                            )}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span className={`px-3 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${typeColors.bg} ${typeColors.text}`}>
                              {ACCOUNT_TYPES.find(t => t.value === account.account_type)?.label || account.account_type || 'Unknown'}
                            </span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span className="text-sm text-gray-600">
                              {account.account_sub_type ? (
                                <span className="capitalize">{String(account.account_sub_type).replace(/_/g, ' ')}</span>
                              ) : (
                                <span className="text-gray-400">—</span>
                              )}
                            </span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-right">
                            <span className={`text-sm font-bold ${
                              isNegative ? 'text-red-600' : 'text-gray-900'
                            }`}>
                              {isNegative && '('}
                              {currencySymbol}{formatNumber(Math.abs(balance))}
                              {isNegative && ')'}
                            </span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span className={`px-3 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${
                              account.is_active !== false
                                ? 'bg-green-100 text-green-800' 
                                : 'bg-red-100 text-red-800'
                            }`}>
                              {account.is_active !== false ? 'Active' : 'Inactive'}
                            </span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                            <div className="flex items-center justify-end gap-2">
                              <button
                                type="button"
                                onClick={() => fetchStatement(account.id)}
                                className="p-2 text-green-600 hover:text-green-700 hover:bg-green-50 rounded-lg transition-colors"
                                title="View statement"
                                aria-label={`Statement for ${account.account_code}`}
                              >
                                <FileText className="h-4 w-4" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleEdit(account)}
                                className="p-2 text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded-lg transition-colors"
                                title="Edit / update account"
                                aria-label={`Edit account ${account.account_code}`}
                              >
                                <Edit2 className="h-4 w-4" />
                              </button>
                              <button
                                type="button"
                                onClick={() => setShowDeleteConfirm(account.id)}
                                disabled={account.can_delete === false}
                                className={`p-2 rounded-lg transition-colors ${
                                  account.can_delete === false
                                    ? 'text-gray-300 cursor-not-allowed'
                                    : 'text-red-600 hover:text-red-700 hover:bg-red-50'
                                }`}
                                title={
                                  account.can_delete === false
                                    ? deleteBlockedHint(account)
                                    : 'Delete account'
                                }
                                aria-label={`Delete account ${account.account_code}`}
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      )
                    })
                  })()}
                </tbody>
              </table>
            </div>
            {(() => {
              const filteredAccounts = accounts.filter((account) => {
                if (filterCode && !account.account_code.toLowerCase().includes(filterCode.toLowerCase())) {
                  return false
                }
                if (filterAccountName && !account.account_name.toLowerCase().includes(filterAccountName.toLowerCase())) {
                  return false
                }
                if (filterType && account.account_type !== filterType) {
                  return false
                }
                return true
              })
              
              if (filteredAccounts.length > 0) {
                return (
                  <div className="bg-gray-50 px-6 py-3 border-t border-gray-200">
                    <p className="text-sm text-gray-600">
                      Showing <span className="font-semibold">{filteredAccounts.length}</span> of <span className="font-semibold">{accounts.length}</span> account{accounts.length !== 1 ? 's' : ''}
                      {(filterCode || filterAccountName || filterType) && (
                        <span className="ml-2">
                          (filtered by {[filterCode && 'code', filterAccountName && 'name', filterType && 'type'].filter(Boolean).join(', ')})
                        </span>
                      )}
                    </p>
                  </div>
                )
              }
              return null
            })()}
          </div>
        </div>
        </div>

      {/* Statement Modal */}
      {showStatement && statement && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 overflow-y-auto">
          <div className="bg-white rounded-lg p-8 max-w-6xl w-full max-h-[90vh] overflow-y-auto my-8">
            <div className="flex justify-between items-center mb-6">
              <div>
                <h2 className="text-2xl font-bold text-gray-900">Account Statement</h2>
                <p className="text-gray-600 mt-1">
                  {statement.account.account_code} - {statement.account.account_name}
                </p>
                <p className="text-sm text-gray-500">
                  {statement.account.account_type} / {statement.account.account_sub_type}
                </p>
              </div>
              <button
                onClick={() => {
                  setShowStatement(false)
                  setStatement(null)
                  setStatementAccountId(null)
                }}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="h-6 w-6" />
              </button>
            </div>

            {/* Date Range Filter */}
            <div className="mb-6 p-4 bg-gray-50 rounded-lg">
              <div className="flex items-center space-x-4">
                <div className="flex-1">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Report Period: Date Range
                  </label>
                  <div className="flex items-center space-x-2">
                    <input
                      type="date"
                      value={statementStartDate}
                      onChange={(e) => setStatementStartDate(e.target.value)}
                      className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    />
                    <span className="text-gray-500">to</span>
                    <input
                      type="date"
                      value={statementEndDate}
                      onChange={(e) => setStatementEndDate(e.target.value)}
                      className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    />
                    <button
                      onClick={handleStatementDateChange}
                      disabled={statementLoading}
                      className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400"
                    >
                      {statementLoading ? 'Loading...' : 'Update'}
                    </button>
                  </div>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-4 gap-4 text-sm">
                <div>
                  <span className="text-gray-600">Period:</span>
                  <p className="font-semibold">
                    {formatDateOnly(statement.period.start_date)} - {formatDateOnly(statement.period.end_date)}
                  </p>
                </div>
                <div>
                  <span className="text-gray-600">Opening Balance:</span>
                  <p className="font-semibold">
                    {statement.account.currency} {formatNumber(Number(statement.opening_balance))}
                  </p>
                </div>
                <div>
                  <span className="text-gray-600">Closing Balance:</span>
                  <p className="font-semibold">
                    {statement.account.currency} {formatNumber(Number(statement.closing_balance))}
                  </p>
                </div>
                <div>
                  <span className="text-gray-600">Transactions:</span>
                  <p className="font-semibold">{statement.transaction_count}</p>
                </div>
              </div>
            </div>

            {/* Transactions Table */}
            <div className="bg-white rounded-lg shadow overflow-hidden">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Reference</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Description</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Debit</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Credit</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Balance</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {/* Opening Balance Row */}
                  <tr className="bg-gray-50">
                    <td colSpan={4} className="px-6 py-4 text-sm font-semibold text-gray-900">
                      Opening Balance
                    </td>
                    <td colSpan={3} className="px-6 py-4 text-sm text-right font-semibold text-gray-900">
                      {statement.account.currency} {formatNumber(Number(statement.opening_balance))}
                    </td>
                  </tr>

                  {/* Transactions */}
                  {statement.transactions.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-6 py-8 text-center text-gray-500">
                        No transactions found for this period
                      </td>
                    </tr>
                  ) : (
                    // Sort transactions by date ascending (oldest first) for statement display
                    [...statement.transactions].sort((a, b) => {
                      const dateA = new Date(a.date).getTime()
                      const dateB = new Date(b.date).getTime()
                      return dateA - dateB
                    }).map((transaction, index) => {
                      // Calculate running balance (from opening balance)
                      let runningBalance = statement.opening_balance
                      
                      // Sort all transactions by date for balance calculation
                      const sortedTransactions = [...statement.transactions].sort((a, b) => {
                        const dateA = new Date(a.date).getTime()
                        const dateB = new Date(b.date).getTime()
                        return dateA - dateB
                      })
                      
                      // Calculate balance up to current transaction
                      for (let i = 0; i <= index; i++) {
                        const txn = sortedTransactions[i]
                        // Determine if this is an asset/expense account or liability/equity/income account
                        const isAssetOrExpense = ['asset', 'expense', 'bank_account'].includes(
                          statement.account.account_type.toLowerCase()
                        )
                        
                        if (txn.type === 'Debit') {
                          if (isAssetOrExpense) {
                            runningBalance += txn.amount
                          } else {
                            runningBalance -= txn.amount
                          }
                        } else { // Credit
                          if (isAssetOrExpense) {
                            runningBalance -= txn.amount
                          } else {
                            runningBalance += txn.amount
                          }
                        }
                      }
                      
                      return (
                        <tr key={transaction.id} className="hover:bg-gray-50">
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                            {formatDateOnly(transaction.date)}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                            {transaction.type}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                            {transaction.reference}
                          </td>
                          <td className="px-6 py-4 text-sm text-gray-900">
                            {transaction.description}
                            {transaction.other_account_name && (
                              <span className="text-gray-500 text-xs block">
                                {transaction.other_account_code} - {transaction.other_account_name}
                              </span>
                            )}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-red-600">
                            {transaction.debit_amount > 0 
                              ? `${statement.account.currency} ${formatNumber(Number(transaction.debit_amount))}`
                              : '-'
                            }
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-green-600">
                            {transaction.credit_amount > 0 
                              ? `${statement.account.currency} ${formatNumber(Number(transaction.credit_amount))}`
                              : '-'
                            }
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-right font-semibold text-gray-900">
                            {statement.account.currency} {formatNumber(Number(runningBalance))}
                          </td>
                        </tr>
                      )
                    })
                  )}

                  {/* Closing Balance Row */}
                  <tr className="bg-gray-50 font-semibold">
                    <td colSpan={4} className="px-6 py-4 text-sm font-semibold text-gray-900">
                      Closing Balance
                    </td>
                    <td className="px-6 py-4 text-sm text-right text-red-600">
                      {statement.account.currency} {formatNumber(Number(statement.total_debits))}
                    </td>
                    <td className="px-6 py-4 text-sm text-right text-green-600">
                      {statement.account.currency} {formatNumber(Number(statement.total_credits))}
                    </td>
                    <td className="px-6 py-4 text-sm text-right font-semibold text-gray-900">
                      {statement.account.currency} {formatNumber(Number(statement.closing_balance))}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (() => {
        const accPending = accounts.find((a) => a.id === showDeleteConfirm)
        const blocked = accPending?.can_delete === false
        return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full shadow-xl">
            <h2 className="text-xl font-bold mb-2">Delete account</h2>
            {accPending && (
              <p className="text-sm text-gray-800 mb-2">
                <span className="font-mono font-semibold">{accPending.account_code}</span>
                {' — '}
                {accPending.account_name}
              </p>
            )}
            <p className="text-gray-600 mb-4 text-sm leading-relaxed">
              {blocked
                ? deleteBlockedHint(accPending!)
                : 'This permanently removes the account from the chart. If it was never used in journals, it is safe to delete.'}
            </p>
            {!blocked && (
              <p className="text-gray-500 text-xs mb-6">
                To hide an account from selection without deleting history, use <strong>Edit</strong> and turn off{' '}
                <strong>Active</strong>.
              </p>
            )}
            <div className="flex justify-end space-x-3">
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(null)}
                className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                {blocked ? 'Close' : 'Cancel'}
              </button>
              {!blocked && (
                <button
                  type="button"
                  onClick={() => handleDelete(showDeleteConfirm)}
                  className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
                >
                  Delete
                </button>
              )}
            </div>
          </div>
        </div>
        )
      })()}

      {/* Create/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 overflow-y-auto">
          <div className="bg-white rounded-lg p-8 max-w-2xl w-full max-h-[90vh] overflow-y-auto my-8">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-bold">
                {editingAccount ? 'Edit Account' : 'New Account'}
              </h2>
              <button
                onClick={handleCloseModal}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="h-6 w-6" />
              </button>
            </div>

            <form onSubmit={editingAccount ? handleUpdate : handleCreate}>
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Account Code *
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.account_code}
                    onChange={(e) => setFormData({ ...formData, account_code: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    placeholder="e.g., 1000, 2000"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Account Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.account_name}
                    onChange={(e) => setFormData({ ...formData, account_name: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    placeholder="e.g., Cash, Accounts Payable"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Account Type *
                  </label>
                  <select
                    required
                    value={formData.account_type}
                    onChange={(e) => {
                      setFormData({ ...formData, account_type: e.target.value, account_sub_type: '' })
                    }}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  >
                    {ACCOUNT_TYPES.map((type) => (
                      <option key={type.value} value={type.value}>
                        {type.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Account Sub-Type *
                  </label>
                  <select
                    required
                    value={formData.account_sub_type}
                    onChange={(e) => setFormData({ ...formData, account_sub_type: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">Select Sub-Type</option>
                    {getAvailableSubTypes().map((subtype) => (
                      <option key={subtype.value} value={subtype.value}>
                        {subtype.label}
                      </option>
                    ))}
                  </select>
                </div>
                {isBankStyleCoa(formData.account_type, formData.account_sub_type) && (
                  <div className="col-span-2 rounded-lg border border-cyan-200 bg-cyan-50/60 p-4 space-y-3">
                    <p className="text-sm font-semibold text-cyan-950">Bank / cash (QuickBooks-style)</p>
                    <p className="text-xs text-cyan-900/90">
                      Institution and account number appear on this chart line and power payments, deposits, and fund
                      transfers. Leave blank if this chart line is not used as a real bank or till.
                    </p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Institution / bank name</label>
                        <input
                          type="text"
                          value={formData.bank_name}
                          onChange={(e) => setFormData({ ...formData, bank_name: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white"
                          placeholder="e.g. City Bank PLC"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Account number</label>
                        <input
                          type="text"
                          value={formData.bank_account_number}
                          onChange={(e) => setFormData({ ...formData, bank_account_number: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white font-mono"
                          placeholder="Account #"
                        />
                      </div>
                      <div className="md:col-span-2">
                        <label className="block text-sm font-medium text-gray-700 mb-1">Register type</label>
                        <select
                          value={formData.register_type}
                          onChange={(e) => setFormData({ ...formData, register_type: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white"
                        >
                          <option value="CHECKING">Checking</option>
                          <option value="SAVINGS">Savings</option>
                          <option value="CASH">Cash / petty cash</option>
                          <option value="MONEY_MARKET">Money market</option>
                          <option value="CREDIT_CARD">Credit card</option>
                          <option value="OTHER">Other</option>
                        </select>
                      </div>
                    </div>
                  </div>
                )}
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Description
                  </label>
                  <textarea
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    rows={2}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    placeholder="What this account is for (shown in the chart list; use for staff guidance)"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Opening Balance ({currencySymbol})
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={formData.opening_balance}
                    onChange={(e) => setFormData({ ...formData, opening_balance: parseFloat(e.target.value) || 0 })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    placeholder="0.00"
                  />
                  <p className="mt-1 text-xs text-gray-500">
                    Starting balance for this account
                  </p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    As of Date *
                  </label>
                  <input
                    type="date"
                    required
                    value={formData.opening_balance_date}
                    onChange={(e) => setFormData({ ...formData, opening_balance_date: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  />
                  <p className="mt-1 text-xs text-gray-500">
                    Date of the opening balance
                  </p>
                </div>
                <div className="col-span-2">
                  <label className="flex items-center space-x-2">
                    <input
                      type="checkbox"
                      checked={formData.is_active}
                      onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
                      className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                    />
                    <span className="text-sm font-medium text-gray-700">Active</span>
                  </label>
                </div>
              </div>
              <div className="flex justify-end space-x-3 mt-6">
                <button
                  type="button"
                  onClick={handleCloseModal}
                  className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                >
                  {editingAccount ? 'Update Account' : 'Create Account'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
