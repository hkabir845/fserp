'use client'

import { useEffect, useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import PageLayout from '@/components/PageLayout'
import { ErpPageShell } from '@/components/aquaculture/ErpPageShell'
import { Plus, Edit2, Trash2, X, FileText, Filter, AlertTriangle, RefreshCw, LayoutTemplate, Loader2, Printer, ExternalLink, BookOpen, Search } from 'lucide-react'
import { useToast } from '@/components/Toast'
import { usePageMeta } from '@/hooks/usePageMeta'
import { useChartOfAccountsT, coaAccountTypeLabel } from '@/lib/moduleI18n/chartOfAccounts'
import { useCompanyLocale } from '@/contexts/CompanyLocaleContext'
import {
  localizeCoaAccountName,
  localizeCoaAccountDescription,
  localizeCoaAccountSubType,
  coaAccountNameMatchesFilter,
} from '@/lib/coaAccountI18n'
import api, { getBackendOrigin, isSuperAdminRole } from '@/lib/api'
import { useCompany } from '@/contexts/CompanyContext'
import { getCurrencySymbol, formatNumber } from '@/utils/currency'
import { isConnectionError, safeLogError } from '@/utils/connectionError'
import { extractErrorMessage } from '@/utils/errorHandler'
import { formatDate, formatDateOnly } from '@/utils/date'
import { printLedgerStatement, type LedgerStatementPrintInput, buildLedgerStatementCsv } from '@/utils/printDocument'
import { loadPrintBranding, type PrintBranding } from '@/utils/printBranding'
import { downloadCsvFile } from '@/utils/businessDocumentExport'
import { reportScopeQueryParams } from '@/app/reports/reportSiteScope'
import {
  confirmDeletePaymentDialog,
  deletePaymentRequest,
} from '@/app/payments/paymentMutations'
import {
  hasTransactionTextSearch,
  transactionDateParams,
} from '@/lib/transactionListFilters'

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

interface StatementAllocation {
  document_type: 'receivable' | 'payable'
  invoice_id?: number
  bill_id?: number
  document_number: string
  amount: string
  contact_id?: number
}

interface StatementTransaction {
  id: number
  type: string
  date: string
  reference: string
  description: string
  /** Full journal entry header (e.g. "Loan payable opening — Name") — source of the movement */
  journal_description?: string
  debit_amount: number
  credit_amount: number
  amount: number
  journal_entry_id: number
  journal_entry_number: string
  other_account_name: string | null
  other_account_code: string | null
  source_type?: 'payment_received' | 'payment_made' | 'receivable' | 'payable' | 'payroll'
  source_id?: number
  source_label?: string
  can_delete_payment?: boolean
  can_delete_payroll_journal?: boolean
  immutable_reason?: string | null
  contact_type?: 'customer' | 'vendor'
  contact_id?: number
  allocations?: StatementAllocation[]
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
  /** When set, statement rows are limited to GL lines tagged with this station. */
  filter_station_id?: number
}

type StatementPeriodMode = 'all' | 'range'

function formatStatementPeriodLabel(period: { start_date: string; end_date: string }): string {
  const start = period.start_date?.trim()
  const end = period.end_date?.trim()
  if (start && end) {
    return `${formatDateOnly(start)} – ${formatDateOnly(end)}`
  }
  return 'All dates'
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
    const journalDesc = String(
      t.journal_description ?? (t as { journal_entry_description?: string }).journal_entry_description ?? ''
    ).trim()
    const lineDesc = String(t.description ?? '').trim()
    return {
      id: Number(t.id),
      type,
      date: (t.date as string) || '',
      reference: String(t.reference ?? t.entry_number ?? ''),
      description: lineDesc,
      journal_description: journalDesc || undefined,
      debit_amount: debit,
      credit_amount: credit,
      amount,
      journal_entry_id: Number(t.journal_entry_id ?? 0),
      journal_entry_number: String(t.journal_entry_number ?? t.entry_number ?? ''),
      other_account_name: (t.other_account_name as string | null) ?? null,
      other_account_code: (t.other_account_code as string | null) ?? null,
      source_type: t.source_type as StatementTransaction['source_type'],
      source_id: t.source_id != null ? Number(t.source_id) : undefined,
      source_label: t.source_label != null ? String(t.source_label) : undefined,
      can_delete_payment: t.can_delete_payment === true,
      can_delete_payroll_journal: t.can_delete_payroll_journal === true,
      immutable_reason:
        t.immutable_reason != null ? String(t.immutable_reason) : undefined,
      contact_type: t.contact_type as StatementTransaction['contact_type'],
      contact_id: t.contact_id != null ? Number(t.contact_id) : undefined,
      allocations: Array.isArray(t.allocations)
        ? (t.allocations as Record<string, unknown>[]).map((a) => ({
            document_type: a.document_type as StatementAllocation['document_type'],
            invoice_id: a.invoice_id != null ? Number(a.invoice_id) : undefined,
            bill_id: a.bill_id != null ? Number(a.bill_id) : undefined,
            document_number: String(a.document_number ?? ''),
            amount: String(a.amount ?? ''),
            contact_id: a.contact_id != null ? Number(a.contact_id) : undefined,
          }))
        : undefined,
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
  const apiStart = periodObj?.start_date ?? (data.start_date as string | null | undefined)
  const apiEnd = periodObj?.end_date ?? (data.end_date as string | null | undefined)
  const start = apiStart != null && String(apiStart).trim() !== '' ? String(apiStart) : fallbackPeriod.start
  const end = apiEnd != null && String(apiEnd).trim() !== '' ? String(apiEnd) : fallbackPeriod.end

  const rawFid = data.filter_station_id
  const filterStationId =
    rawFid != null && rawFid !== '' && !Number.isNaN(Number(rawFid)) ? Number(rawFid) : undefined

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
    ...(filterStationId != null ? { filter_station_id: filterStationId } : {}),
  }
}

function accountStatementToLedgerPrintInput(
  s: AccountStatement
): LedgerStatementPrintInput {
  const isAssetOrExpense = ['asset', 'expense', 'bank_account'].includes(
    s.account.account_type.toLowerCase()
  )
  const sorted = [...s.transactions].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
  )
  const rows: LedgerStatementPrintInput['transactions'] = []
  let running = Number(s.opening_balance)
  for (const txn of sorted) {
    if (txn.type === 'Debit') {
      if (isAssetOrExpense) running += txn.amount
      else running -= txn.amount
    } else {
      if (isAssetOrExpense) running -= txn.amount
      else running += txn.amount
    }
    const extra =
      txn.other_account_name != null
        ? ` (${txn.other_account_code ?? '—'} — ${txn.other_account_name})`
        : ''
    const mainDesc = txn.journal_description || txn.description || ''
    const subLine =
      txn.journal_description &&
      txn.description &&
      txn.journal_description !== txn.description
        ? ` · ${txn.description}`
        : ''
    const description = (mainDesc + subLine + extra).trim() || '—'
    rows.push({
      date: formatDateOnly(txn.date),
      type: txn.type,
      reference: txn.reference,
      description,
      debit: txn.debit_amount > 0 ? String(txn.debit_amount) : '0',
      credit: txn.credit_amount > 0 ? String(txn.credit_amount) : '0',
      balance: String(running),
    })
  }
  return {
    display_name: `${s.account.account_code} — ${s.account.account_name}`,
    period_start_balance: String(s.opening_balance),
    closing_balance: String(s.closing_balance),
    start_date: s.period.start_date,
    end_date: s.period.end_date,
    transactions: rows,
  }
}

export default function ChartOfAccountsPage() {
  const router = useRouter()
  const toast = useToast()
  const pageMeta = usePageMeta()
  const t = useChartOfAccountsT()
  const { language } = useCompanyLocale()
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
  const [statementPrintBranding, setStatementPrintBranding] = useState<PrintBranding | null>(null)
  const [statementStartDate, setStatementStartDate] = useState<string>('')
  const [statementEndDate, setStatementEndDate] = useState<string>('')
  const [statementSearch, setStatementSearch] = useState<string>('')
  const [debouncedStatementSearch, setDebouncedStatementSearch] = useState<string>('')
  const [statementPeriodMode, setStatementPeriodMode] = useState<StatementPeriodMode>('range')
  const [statementPaymentDeletingId, setStatementPaymentDeletingId] = useState<number | null>(null)
  const [statementPayrollRemovingId, setStatementPayrollRemovingId] = useState<number | null>(null)
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
      const ok = window.confirm(t('replaceConfirm'))
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
          ? t('toastChartReplaced', { added })
          : t('toastTemplateApplied', { added, skipped })
      )
      await fetchAccounts(true)
    } catch (error: any) {
      const detail = error.response?.data?.detail
      toast.error(typeof detail === 'string' ? detail : t('toastImportFailed'))
    } finally {
      setSeedBusy(false)
    }
  }

  const handleBackfillDescriptions = async () => {
    setBackfillBusy(true)
    try {
      const res = await api.post('/chart-of-accounts/backfill-descriptions/', { only_blank: true })
      const u = res.data?.updated ?? 0
      toast.success(u > 0 ? t('toastDescriptionsUpdated', { u }) : t('toastNoDescriptions'))
      await fetchAccounts(true)
    } catch (error: unknown) {
      const detail = (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      toast.error(typeof detail === 'string' ? detail : t('toastBackfillFailed'))
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
      } else {
        if (!isConnectionError(error)) {
          safeLogError('❌ Request error:', error?.message || error)
        }
        errorMessage = extractErrorMessage(
          error,
          'Could not load chart of accounts. Check your connection and try again.'
        )
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

  useEffect(() => {
    const t = setTimeout(() => setDebouncedStatementSearch(statementSearch.trim()), 350)
    return () => clearTimeout(t)
  }, [statementSearch])

  const hasStatementTextSearch = hasTransactionTextSearch({ q: debouncedStatementSearch })
  
  const fetchStatement = async (accountId: number, periodMode = statementPeriodMode) => {
    try {
      setStatementLoading(true)
      setStatementAccountId(accountId)

      let startDate = ''
      let endDate = ''
      if (periodMode === 'range') {
        const today = new Date()
        const firstDay = new Date(today.getFullYear(), today.getMonth(), 1)
        startDate = statementStartDate || firstDay.toISOString().split('T')[0]
        endDate = statementEndDate || today.toISOString().split('T')[0]
        if (!statementStartDate) setStatementStartDate(startDate)
        if (!statementEndDate) setStatementEndDate(endDate)
      }

      const params = new URLSearchParams()
      if (periodMode === 'range') {
        const dates = transactionDateParams(startDate, endDate, hasStatementTextSearch)
        if (dates.start_date) params.append('start_date', dates.start_date)
        if (dates.end_date) params.append('end_date', dates.end_date)
      }
      if (debouncedStatementSearch) params.append('q', debouncedStatementSearch)
      const reportStation =
        typeof window !== 'undefined'
          ? localStorage.getItem('fserp_report_station_id')?.trim()
          : ''
      const scopeParams = reportScopeQueryParams(reportStation || '')
      if (scopeParams.station_id) params.append('station_id', scopeParams.station_id)
      if (scopeParams.pond_id) params.append('pond_id', scopeParams.pond_id)

      const [response, branding] = await Promise.all([
        api.get(`/chart-of-accounts/${accountId}/statement?${params.toString()}`),
        loadPrintBranding(api).catch(() => null),
      ])
      if (branding) setStatementPrintBranding(branding)
      else setStatementPrintBranding(null)
      setStatement(
        mapStatementApiToView(
          response.data,
          periodMode === 'range' ? { start: startDate, end: endDate } : { start: '', end: '' },
          currencySymbol
        )
      )
      setShowStatement(true)
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

  const handleStatementDeletePayment = async (transaction: StatementTransaction) => {
    if (!transaction.source_id || !transaction.can_delete_payment) return
    const label = transaction.source_label || `PAY-${transaction.source_id}`
    if (!confirmDeletePaymentDialog(label)) return
    setStatementPaymentDeletingId(transaction.source_id)
    try {
      const banner = await deletePaymentRequest(transaction.source_id)
      toast.success(banner.title)
      if (statementAccountId) {
        await fetchStatement(statementAccountId)
        await fetchAccounts()
      }
    } catch (err: unknown) {
      const ax = err as { response?: { data?: { detail?: string } } }
      const d = ax.response?.data?.detail
      toast.error(typeof d === 'string' ? d : 'Failed to delete payment')
    } finally {
      setStatementPaymentDeletingId(null)
    }
  }

  const handleStatementRemovePayrollJournal = async (transaction: StatementTransaction) => {
    if (!transaction.journal_entry_id || !transaction.can_delete_payroll_journal) return
    const label = transaction.source_label || `PR-${transaction.source_id ?? ''}`
    if (
      !window.confirm(
        `Remove salary journal for ${label}?\n\nThis deletes the AUTO-PAYROLL entry from the general ledger and sets the payroll run back to draft.`
      )
    ) {
      return
    }
    setStatementPayrollRemovingId(transaction.source_id ?? transaction.journal_entry_id)
    try {
      await api.post(`/journal-entries/${transaction.journal_entry_id}/unpost/`, {
        remove_system_entry: true,
      })
      toast.success(`Payroll ${label} returned to draft.`)
      if (statementAccountId) {
        await fetchStatement(statementAccountId)
        await fetchAccounts()
      }
    } catch (err: unknown) {
      const ax = err as { response?: { data?: { detail?: string } } }
      const d = ax.response?.data?.detail
      toast.error(typeof d === 'string' ? d : 'Failed to remove payroll journal')
    } finally {
      setStatementPayrollRemovingId(null)
    }
  }

  const fetchStatementRef = useRef(fetchStatement)
  fetchStatementRef.current = fetchStatement
  const ledgerDeepLinkConsumed = useRef(false)

  /** Deep-link from Reports (and elsewhere): `/chart-of-accounts?ledger=<account_id>` opens the GL statement. */
  useEffect(() => {
    if (ledgerDeepLinkConsumed.current || loading || accounts.length === 0) return
    if (typeof window === 'undefined') return
    const raw = new URLSearchParams(window.location.search).get('ledger')
    if (!raw || !/^\d+$/.test(raw)) return
    const id = parseInt(raw, 10)
    if (!Number.isFinite(id) || id < 1) return
    if (!accounts.some((a) => a.id === id)) return
    ledgerDeepLinkConsumed.current = true
    void fetchStatementRef.current(id)
    window.history.replaceState({}, '', '/chart-of-accounts')
  }, [loading, accounts])

  useEffect(() => {
    if (!showStatement || !statementAccountId) return
    void fetchStatementRef.current(statementAccountId)
  }, [debouncedStatementSearch, showStatement, statementAccountId])
  
  const handleStatementDateChange = async () => {
    if (statementAccountId) {
      await fetchStatement(statementAccountId)
    }
  }

  const handleStatementPeriodModeChange = async (mode: StatementPeriodMode) => {
    setStatementPeriodMode(mode)
    if (statementAccountId) {
      await fetchStatement(statementAccountId, mode)
    }
  }

  const handlePrintAccountStatement = async () => {
    if (!statement) return
    const branding = (await loadPrintBranding(api).catch(() => null)) ?? statementPrintBranding
    if (branding) setStatementPrintBranding(branding)
    const data = accountStatementToLedgerPrintInput(statement)
    const ok = printLedgerStatement(data, {
      companyName: branding?.companyName ?? 'Company',
      companyAddress: branding?.companyAddress,
      stationName: branding?.stationName,
      currencySymbol: statement.account.currency,
      documentTitle: 'GL account statement',
      printedAt: formatDate(new Date(), true),
      branding: branding ?? undefined,
    })
    if (!ok) toast.error('Allow pop-ups in your browser to print.')
  }

  const handleDownloadAccountStatementCsv = () => {
    if (!statement) return
    const data = accountStatementToLedgerPrintInput(statement)
    const code = statement.account.account_code || 'account'
    downloadCsvFile(
      `gl_statement_${code}_${new Date().toISOString().slice(0, 10)}.csv`,
      buildLedgerStatementCsv(data),
    )
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
      <PageLayout>
        <ErpPageShell
          showBackLink={false}
          titleId="coa-title"
          eyebrow={pageMeta.eyebrow}
          eyebrowIcon={pageMeta.eyebrow ? BookOpen : undefined}
          title={pageMeta.title}
          titleIcon={BookOpen}
          description={pageMeta.description ?? undefined}
          maxWidthClass="max-w-[1600px]"
          contentClassName="mt-4"
        >
          <div className="flex flex-col justify-center items-center h-64 bg-white rounded-lg shadow">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mb-4"></div>
            <p className="text-muted-foreground">{t('loading')}</p>
          </div>
        </ErpPageShell>
      </PageLayout>
    )
  }

  if (error) {
    return (
      <PageLayout>
        <ErpPageShell
          showBackLink={false}
          titleId="coa-title"
          eyebrow={pageMeta.eyebrow}
          eyebrowIcon={pageMeta.eyebrow ? BookOpen : undefined}
          title={pageMeta.title}
          titleIcon={BookOpen}
          description={pageMeta.description ?? t('manageFallback')}
          maxWidthClass="max-w-[1600px]"
          contentClassName="mt-4"
        >
          <div className="bg-destructive/5 border border-destructive/25 rounded-lg p-6 text-center">
            <AlertTriangle className="h-12 w-12 text-destructive mx-auto mb-4" />
            <h3 className="text-xl font-bold text-destructive mb-2">{t('errorTitle')}</h3>
            <p className="text-destructive mb-4">{error}</p>
            <button
              onClick={handleRetry}
              className="inline-flex items-center space-x-2 px-4 py-2 bg-destructive text-white rounded-lg hover:bg-destructive/90 transition-colors"
            >
              <RefreshCw className="h-5 w-5" />
              <span>{t('retry')}</span>
            </button>
          </div>
        </ErpPageShell>
      </PageLayout>
    )
  }

  return (
    <PageLayout>
      <ErpPageShell
        showBackLink={false}
        titleId="coa-title"
        eyebrow={pageMeta.eyebrow}
        eyebrowIcon={pageMeta.eyebrow ? BookOpen : undefined}
        title={pageMeta.title}
        titleIcon={BookOpen}
        description={pageMeta.description ?? undefined}
        maxWidthClass="max-w-[1600px]"
        contentClassName="mt-4"
        actions={
          <button
            onClick={() => {
              resetForm()
              setShowModal(true)
            }}
            className="flex items-center space-x-2 px-5 py-2.5 bg-primary text-white rounded-lg hover:bg-accent0 transition-all shadow-md hover:shadow-lg font-medium"
          >
            <Plus className="h-5 w-5" />
            <span>{t('newAccount')}</span>
          </button>
        }
      >
          {pageMeta.descriptionNote ? (
            <p className="text-muted-foreground text-sm mb-4">{pageMeta.descriptionNote}</p>
          ) : null}

          <div className="mb-6 rounded-lg border border-sky-200 bg-sky-50 px-4 py-4 text-sm text-sky-950 shadow-sm">
            <p className="font-semibold text-sky-900">{t('posMoneyTitle')}</p>
            <p className="mt-1 text-sky-900/95 leading-relaxed">
              {t('posMoneyP1a')} <strong>{t('posMoneyNot')}</strong> {t('posMoneyP1b')}{' '}
              <strong>{t('posMoneyDebit')}</strong> {t('posMoneyP1c')} <strong>{t('posMoneyCashAsset')}</strong>{' '}
              {t('posMoneyP1d')}{' '}
              <strong className="font-mono">1010</strong> {t('posMoneyP1e')}{' '}
              <strong className="font-mono">1020</strong> {t('posMoneyP1f')}{' '}
              <strong>{t('posMoneyCard')}</strong> {t('posMoneyP2a')}{' '}
              <strong className="font-mono">1120</strong> {t('posMoneyP2b')}{' '}
              <strong>{t('posMoneyViewStatement')}</strong> {t('posMoneyP3a')}{' '}
              <strong>{t('posMoneyTrialBalance')}</strong>
              {t('posMoneyP3b')}{' '}
              <span className="font-mono">1010</span>, <span className="font-mono">1020</span>, {t('posMoneyP3c')}{' '}
              <span className="font-mono">1120</span>. {t('posMoneyP3d')}{' '}
              <strong>{t('posMoneyCashPicker')}</strong> {t('posMoneyP3e')}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium text-sky-800">{t('quickFilter')}</span>
              {[
                { code: '1010', label: '1010' },
                { code: '1020', label: t('filter1020') },
                { code: '1120', label: t('filter1120') },
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
                {t('filterNameUndeposited')}
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
                {t('clearFilters')}
              </button>
            </div>
          </div>

          {unlinkedBanks.length > 0 && (
            <div className="mb-6 rounded-lg border border-amber-300 bg-warning/10 px-4 py-4 text-sm text-warning-foreground shadow-sm">
              <p className="font-semibold">{t('unlinkedBanksTitle')}</p>
              <p className="mt-1 text-warning-foreground/95">
                {t('unlinkedBanksBody', {
                  count: unlinkedBanks.length,
                  plural: unlinkedBanks.length === 1 ? '' : language === 'bn' ? '' : 's',
                })}
              </p>
              <ul className="mt-2 max-h-32 overflow-y-auto list-disc pl-5 text-warning-foreground/90">
                {unlinkedBanks.slice(0, 12).map((b) => (
                  <li key={b.id}>
                    {b.account_name} — {b.bank_name}
                    {b.account_number ? ` (${b.account_number})` : ''}
                  </li>
                ))}
                {unlinkedBanks.length > 12 && (
                  <li className="list-none pl-0 text-warning-foreground/90">
                    {t('unlinkedBanksMore', { n: unlinkedBanks.length - 12 })}
                  </li>
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
                  {syncingBanks ? t('syncingBanks') : t('syncBanksToChart')}
                </button>
                <span className="text-xs text-warning-foreground/80">{t('syncBanksHint')}</span>
              </div>
              {isSuperAdminUser && (
                <p className="mt-3 border-t border-warning/30/80 pt-3 text-xs text-warning-foreground/85">
                  <strong>{t('superAdminLabel')}</strong>{' '}
                  {t('superAdminHint')}
                </p>
              )}
            </div>
          )}

          {/* Built-in fuel retail COA template */}
          {fuelTemplateMeta && (
            <div className="mb-6 rounded-xl border border-primary/25 bg-gradient-to-br from-accent/90 to-card p-6 shadow-sm">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="flex gap-3">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow">
                    <LayoutTemplate className="h-5 w-5" />
                  </div>
                  <div>
                    <h2 className="text-lg font-semibold text-foreground">
                      {t('fuelTemplateName')}
                    </h2>
                    <p className="mt-1 text-sm text-muted-foreground leading-relaxed max-w-3xl">
                      {t('fuelTemplateSummary')}
                    </p>
                  </div>
                </div>
                <div className="flex flex-col sm:flex-row flex-wrap gap-2 lg:shrink-0">
                  <button
                    type="button"
                    disabled={seedBusy}
                    onClick={() => handleSeedFuelTemplate('full', false)}
                    className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-white shadow hover:bg-primary/90 disabled:opacity-50"
                  >
                    {seedBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    {t('importFullTemplate')}
                  </button>
                  <button
                    type="button"
                    disabled={seedBusy}
                    onClick={() => handleSeedFuelTemplate('retail', false)}
                    className="inline-flex items-center justify-center gap-2 rounded-lg border border-primary/30 bg-white px-4 py-2.5 text-sm font-medium text-primary hover:bg-accent disabled:opacity-50"
                  >
                    {t('importFuelFirst')}
                  </button>
                  <button
                    type="button"
                    disabled={seedBusy}
                    onClick={() => handleSeedFuelTemplate('full', true)}
                    className="inline-flex items-center justify-center gap-2 rounded-lg border border-destructive/25 bg-destructive/5 px-4 py-2.5 text-sm font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50"
                  >
                    {t('replaceAllTemplate')}
                  </button>
                  <button
                    type="button"
                    disabled={backfillBusy || accounts.length === 0}
                    onClick={() => void handleBackfillDescriptions()}
                    className="inline-flex items-center justify-center gap-2 rounded-lg border border-border bg-white px-4 py-2.5 text-sm font-medium text-foreground hover:bg-muted/40 disabled:cursor-not-allowed disabled:opacity-50"
                    title={t('fillMissingDescriptionsTitle')}
                  >
                    {backfillBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    {t('fillMissingDescriptions')}
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
                  asset: { bg: 'bg-blue-50', text: 'text-primary', border: 'border-primary/25' },
                  bank_account: { bg: 'bg-cyan-50', text: 'text-cyan-800', border: 'border-cyan-300' },
                  liability: { bg: 'bg-destructive/5', text: 'text-destructive', border: 'border-destructive/25' },
                  equity: { bg: 'bg-purple-50', text: 'text-purple-700', border: 'border-purple-200' },
                  income: { bg: 'bg-green-50', text: 'text-success', border: 'border-success/25' },
                  expense: { bg: 'bg-orange-50', text: 'text-orange-700', border: 'border-orange-200' },
                  cost_of_goods_sold: { bg: 'bg-yellow-50', text: 'text-yellow-700', border: 'border-yellow-200' }
                }
                
                const colors = typeColors[type.value] || { bg: 'bg-muted/40', text: 'text-foreground/85', border: 'border-border' }
                
                return (
                  <div key={type.value} className={`bg-white rounded-lg shadow-md p-5 border-l-4 ${colors.border}`}>
                    <div className="flex items-center justify-between mb-2">
                      <h3 className={`text-sm font-semibold ${colors.text} uppercase tracking-wide`}>
                        {coaAccountTypeLabel(type.value, language)}
                      </h3>
                      <span className={`text-xs px-2 py-1 rounded-full ${colors.bg} ${colors.text} font-medium`}>
                        {accountCount}
                      </span>
                    </div>
                    <p className={`text-2xl font-bold ${colors.text}`}>
                      {currencySymbol}{formatNumber(Math.abs(totalBalance))}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {accountCount}{' '}
                      {accountCount === 1 ? t('accountSingular') : t('accountPlural')}
                    </p>
                  </div>
                )
              })}
            </div>
          )}

          {/* Filters */}
          <div className="bg-white rounded-lg shadow-md p-6 mb-6 border border-border/70">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center space-x-2">
                <Filter className="h-5 w-5 text-muted-foreground" />
                <h2 className="text-lg font-semibold text-foreground">{t('searchAndFilter')}</h2>
              </div>
              {(filterCode || filterAccountName || filterType) && (
                <button
                  onClick={() => {
                    setFilterCode('')
                    setFilterAccountName('')
                    setFilterType('')
                  }}
                  className="text-sm text-primary hover:text-primary font-medium"
                >
                  {t('clearAll')}
                </button>
              )}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="mb-2 block text-sm font-medium text-foreground">
                  {t('accountCode')}
                </label>
                <input
                  type="text"
                  value={filterCode}
                  onChange={(e) => setFilterCode(e.target.value)}
                  placeholder={t('searchByCode')}
                  className="w-full px-4 py-2.5 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ring focus:border-blue-500 transition-all shadow-sm"
                />
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-foreground">
                  {t('accountName')}
                </label>
                <input
                  type="text"
                  value={filterAccountName}
                  onChange={(e) => setFilterAccountName(e.target.value)}
                  placeholder={t('searchByName')}
                  className="w-full px-4 py-2.5 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ring focus:border-blue-500 transition-all shadow-sm"
                />
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-foreground">
                  {t('accountType')}
                </label>
                <select
                  value={filterType}
                  onChange={(e) => setFilterType(e.target.value)}
                  className="w-full px-4 py-2.5 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ring focus:border-blue-500 transition-all shadow-sm bg-white"
                >
                  <option value="">{t('allTypesOption')}</option>
                  {ACCOUNT_TYPES.map(type => (
                    <option key={type.value} value={type.value}>
                      {coaAccountTypeLabel(type.value, language)}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-lg overflow-hidden border border-border/70">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-border">
                <thead className="bg-gradient-to-r from-muted/40 to-muted">
                  <tr>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-foreground/85 uppercase tracking-wider">
                      {t('code')}
                    </th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-foreground/85 uppercase tracking-wider">
                      {t('accountName')}
                    </th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-foreground/85 uppercase tracking-wider">
                      {t('type')}
                    </th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-foreground/85 uppercase tracking-wider">
                      {t('subType')}
                    </th>
                    <th className="px-6 py-4 text-right text-xs font-semibold text-foreground/85 uppercase tracking-wider">
                      {t('balance')}
                    </th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-foreground/85 uppercase tracking-wider">
                      {t('status')}
                    </th>
                    <th className="px-6 py-4 text-right text-xs font-semibold text-foreground/85 uppercase tracking-wider">
                      {t('actions')}
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-border">
                  {(() => {
                    const filteredAccounts = accounts.filter((account) => {
                      if (filterCode && !account.account_code.toLowerCase().includes(filterCode.toLowerCase())) {
                        return false
                      }
                      if (filterAccountName && !coaAccountNameMatchesFilter(account.account_code, account.account_name, filterAccountName, language)) {
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
                              <div className="bg-muted rounded-full p-4 mb-4">
                                <FileText className="h-10 w-10 text-muted-foreground/70" />
                              </div>
                              <h3 className="text-lg font-semibold text-foreground mb-2">
                                {accounts.length === 0 ? t('noAccountsFound') : t('noMatchingAccounts')}
                              </h3>
                              <p className="text-muted-foreground mb-4 max-w-md text-center">
                                {accounts.length === 0 ? t('emptyChartHint') : t('noFilterMatch')}
                              </p>
                              {accounts.length === 0 && (
                                <div className="flex flex-col sm:flex-row flex-wrap items-center justify-center gap-3">
                                  <button
                                    type="button"
                                    disabled={seedBusy || !fuelTemplateMeta}
                                    onClick={() => handleSeedFuelTemplate('full', false)}
                                    className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors flex items-center gap-2 disabled:opacity-50"
                                  >
                                    {seedBusy ? <Loader2 className="h-5 w-5 animate-spin" /> : <LayoutTemplate className="h-5 w-5" />}
                                    <span>{t('importFullTemplate')}</span>
                                  </button>
                                  <button
                                    onClick={() => {
                                      resetForm()
                                      setShowModal(true)
                                    }}
                                    className="px-4 py-2 border border-border bg-white text-foreground rounded-lg hover:bg-muted/40 transition-colors flex items-center gap-2"
                                  >
                                    <Plus className="h-5 w-5" />
                                    <span>{t('createOneAccount')}</span>
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
                        asset: { bg: 'bg-blue-100', text: 'text-primary' },
                        bank_account: { bg: 'bg-cyan-100', text: 'text-cyan-900' },
                        liability: { bg: 'bg-destructive/10', text: 'text-destructive' },
                        loan: { bg: 'bg-accent', text: 'text-foreground/85' },
                        equity: { bg: 'bg-purple-100', text: 'text-purple-800' },
                        income: { bg: 'bg-success/15', text: 'text-success' },
                        expense: { bg: 'bg-orange-100', text: 'text-orange-800' },
                        cost_of_goods_sold: { bg: 'bg-yellow-100', text: 'text-yellow-800' }
                      }
                      const typeColors = accountTypeColors[account.account_type || ''] || { bg: 'bg-muted', text: 'text-foreground' }
                      
                      return (
                        <tr key={account.id} className="hover:bg-accent transition-colors border-b border-border/70">
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span className="text-sm font-semibold text-foreground font-mono">
                              {account.account_code || 'N/A'}
                            </span>
                          </td>
                          <td className="px-6 py-4">
                            <div className="text-sm font-medium text-foreground">
                              {localizeCoaAccountName(account.account_code, account.account_name, language) ||
                                t('unnamedAccount')}
                            </div>
                            {(() => {
                              const desc = localizeCoaAccountDescription(
                                account.account_code,
                                account.description,
                                language
                              )
                              if (!desc) return null
                              return (
                                <div
                                  className="text-xs text-muted-foreground mt-1 max-w-xl line-clamp-4 whitespace-pre-line"
                                  title={desc}
                                >
                                  {desc}
                                </div>
                              )
                            })()}
                            {account.bank_register && (
                              <div className="mt-1.5 text-xs text-cyan-900 font-medium">
                                {account.bank_register.bank_name}
                                {account.bank_register.account_number
                                  ? ` · ${account.bank_register.account_number}`
                                  : ''}
                                <span className="text-muted-foreground font-normal">
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
                                    title={t('bankDepositDetails')}
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
                              {coaAccountTypeLabel(account.account_type || '', language) || t('unknown')}
                            </span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span className="text-sm text-muted-foreground">
                              {account.account_sub_type ? (
                                <span>{localizeCoaAccountSubType(account.account_sub_type, language)}</span>
                              ) : (
                                <span className="text-muted-foreground/70">—</span>
                              )}
                            </span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-right">
                            <span className={`text-sm font-bold ${
                              isNegative ? 'text-destructive' : 'text-foreground'
                            }`}>
                              {isNegative && '('}
                              {currencySymbol}{formatNumber(Math.abs(balance))}
                              {isNegative && ')'}
                            </span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span className={`px-3 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${
                              account.is_active !== false
                                ? 'bg-success/15 text-success' 
                                : 'bg-destructive/10 text-destructive'
                            }`}>
                              {account.is_active !== false ? t('active') : t('inactive')}
                            </span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                            <div className="flex items-center justify-end gap-2">
                              <button
                                type="button"
                                onClick={() => fetchStatement(account.id)}
                                className="p-2 text-success hover:text-success hover:bg-green-50 rounded-lg transition-colors"
                                title={t('viewStatement')}
                                aria-label={`Statement for ${account.account_code}`}
                              >
                                <FileText className="h-4 w-4" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleEdit(account)}
                                className="p-2 text-primary hover:text-primary hover:bg-accent rounded-lg transition-colors"
                                title={t('editAccount')}
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
                                    ? 'text-muted-foreground/40 cursor-not-allowed'
                                    : 'text-destructive hover:text-destructive hover:bg-destructive/5'
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
                  <div className="bg-muted/40 px-6 py-3 border-t border-border">
                    <p className="text-sm text-muted-foreground">
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

      {/* Statement Modal */}
      {showStatement && statement && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 overflow-y-auto">
          <div className="bg-white rounded-lg app-modal-pad max-w-6xl w-full max-h-[90vh] overflow-y-auto my-8">
            <div className="flex justify-between items-start gap-4 mb-6">
              <div>
                {statementPrintBranding ? (
                  <div className="mb-4 border-b border-border pb-3">
                    <p className="text-base font-bold text-foreground">{statementPrintBranding.companyName}</p>
                    {statementPrintBranding.stationName ? (
                      <p className="text-xs font-semibold text-muted-foreground mt-0.5 uppercase tracking-wide">
                        Station: {statementPrintBranding.stationName}
                      </p>
                    ) : null}
                    {statementPrintBranding.companyAddress ? (
                      <p className="text-xs text-muted-foreground mt-1 whitespace-pre-line">
                        {statementPrintBranding.companyAddress}
                      </p>
                    ) : null}
                  </div>
                ) : null}
                <h2 className="text-2xl font-bold text-foreground">GL account statement</h2>
                <p className="text-muted-foreground mt-1">
                  {statement.account.account_code} -{' '}
                  {localizeCoaAccountName(
                    statement.account.account_code,
                    statement.account.account_name,
                    language
                  )}
                </p>
                <p className="text-sm text-muted-foreground">
                  {coaAccountTypeLabel(statement.account.account_type, language)} /{' '}
                  {localizeCoaAccountSubType(statement.account.account_sub_type, language)}
                </p>
                {statement.filter_station_id != null ? (
                  <p className="mt-2 text-sm text-warning-foreground bg-warning/10 border border-warning/30 rounded-md px-3 py-2">
                    Site filter active: journal lines for station #{statement.filter_station_id} only.
                    Opening balance is treated as zero for this slice (same basis as site-scoped trial
                    balance).
                  </p>
                ) : null}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={() => void handlePrintAccountStatement()}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-2 text-sm font-medium text-foreground hover:bg-muted/40"
                >
                  <Printer className="h-4 w-4" />
                  Print
                </button>
                <button
                  type="button"
                  onClick={handleDownloadAccountStatementCsv}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-white hover:bg-primary"
                >
                  CSV
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowStatement(false)
                    setStatement(null)
                    setStatementAccountId(null)
                    setStatementPrintBranding(null)
                    setStatementPeriodMode('range')
                    setStatementStartDate('')
                    setStatementEndDate('')
                    setStatementSearch('')
                    setDebouncedStatementSearch('')
                  }}
                  className="text-muted-foreground/70 hover:text-muted-foreground p-2"
                  aria-label="Close"
                >
                  <X className="h-6 w-6" />
                </button>
              </div>
            </div>

            {/* Period filter */}
            <div className="mb-6 p-4 bg-muted/40 rounded-lg">
              <p className="mb-3 text-xs text-muted-foreground">
                <strong>Delete</strong> on payment rows (<span className="font-mono">PAY-…</span>) or
                payroll salary rows (<span className="font-mono">AUTO-PAYROLL-…</span>) removes the
                journal from the GL and restores draft status on the payroll run where applicable.
              </p>
              <div className="flex flex-wrap items-end gap-4">
                <div>
                  <label className="mb-2 block text-sm font-medium text-foreground">Report period</label>
                  <select
                    value={statementPeriodMode}
                    onChange={(e) =>
                      void handleStatementPeriodModeChange(e.target.value as StatementPeriodMode)
                    }
                    disabled={statementLoading}
                    className="min-w-[10rem] px-3 py-2 border border-border rounded-lg bg-white focus:ring-2 focus:ring-ring"
                  >
                    <option value="all">All</option>
                    <option value="range">Date range</option>
                  </select>
                </div>
                {statementPeriodMode === 'range' ? (
                <div className="flex-1 min-w-[16rem]">
                  <label className="mb-2 block text-sm font-medium text-foreground">Date range</label>
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="date"
                      value={statementStartDate}
                      onChange={(e) => setStatementStartDate(e.target.value)}
                      max={statementEndDate || undefined}
                      className="flex-1 min-w-[9rem] px-3 py-2 border border-border rounded-lg focus:ring-2 focus:ring-ring"
                    />
                    <span className="text-muted-foreground">to</span>
                    <input
                      type="date"
                      value={statementEndDate}
                      onChange={(e) => setStatementEndDate(e.target.value)}
                      min={statementStartDate || undefined}
                      className="flex-1 min-w-[9rem] px-3 py-2 border border-border rounded-lg focus:ring-2 focus:ring-ring"
                    />
                    <button
                      type="button"
                      onClick={() => void handleStatementDateChange()}
                      disabled={statementLoading}
                      className="px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary disabled:opacity-50"
                    >
                      {statementLoading ? 'Loading...' : 'Update'}
                    </button>
                  </div>
                </div>
                ) : (
                  <p className="text-sm text-muted-foreground pb-2">
                    Showing all posted journal lines for this account (lifetime activity).
                  </p>
                )}
                <div className="w-full min-w-[16rem] flex-1">
                  <label className="mb-2 block text-sm font-medium text-foreground">Search</label>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/70" />
                    <input
                      type="search"
                      value={statementSearch}
                      onChange={(e) => setStatementSearch(e.target.value)}
                      placeholder="Entry #, description, source…"
                      disabled={statementLoading}
                      className="w-full rounded-lg border border-border py-2 pl-9 pr-3 focus:ring-2 focus:ring-ring"
                    />
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Search spans all dates — date range paused while searching
                  </p>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-4 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">Period:</span>
                  <p className="font-semibold">
                    {hasStatementTextSearch
                      ? `All dates (search: ${debouncedStatementSearch})`
                      : formatStatementPeriodLabel(statement.period)}
                  </p>
                </div>
                <div>
                  <span className="text-muted-foreground">Opening Balance:</span>
                  <p className="font-semibold">
                    {statement.account.currency} {formatNumber(Number(statement.opening_balance))}
                  </p>
                </div>
                <div>
                  <span className="text-muted-foreground">Closing Balance:</span>
                  <p className="font-semibold">
                    {statement.account.currency} {formatNumber(Number(statement.closing_balance))}
                  </p>
                </div>
                <div>
                  <span className="text-muted-foreground">Transactions:</span>
                  <p className="font-semibold">{statement.transaction_count}</p>
                </div>
              </div>
            </div>

            {/* Transactions Table */}
            <div className="bg-white rounded-lg shadow overflow-x-auto">
              <table className="min-w-full divide-y divide-border">
                <thead className="bg-muted/40">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase">Date</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase">Type</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase">
                      Entry / ref.
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase">Source & detail</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-muted-foreground uppercase">Debit</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-muted-foreground uppercase">Credit</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-muted-foreground uppercase">Balance</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-muted-foreground uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-border">
                  {/* Opening Balance Row */}
                  <tr className="bg-muted/40">
                    <td colSpan={4} className="px-6 py-4 text-sm font-semibold text-foreground">
                      Opening Balance
                    </td>
                    <td colSpan={4} className="px-6 py-4 text-sm text-right font-semibold text-foreground">
                      {statement.account.currency} {formatNumber(Number(statement.opening_balance))}
                    </td>
                  </tr>

                  {/* Transactions */}
                  {statement.transactions.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-6 py-8 text-center text-muted-foreground">
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
                        <tr key={transaction.id} className="hover:bg-muted/40">
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-muted-foreground">
                            {formatDateOnly(transaction.date)}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-foreground">
                            {transaction.type}
                          </td>
                          <td className="px-6 py-4 text-sm text-muted-foreground">
                            <span className="font-mono whitespace-nowrap">{transaction.reference || '—'}</span>
                            {transaction.journal_entry_id > 0 && (
                              <Link
                                href={`/journal-entries?view=${transaction.journal_entry_id}`}
                                className="text-primary hover:text-primary/80 text-xs mt-0.5 inline-flex items-center gap-0.5"
                              >
                                JE #{transaction.journal_entry_id}
                                <ExternalLink className="h-3 w-3" />
                              </Link>
                            )}
                          </td>
                          <td className="px-6 py-4 text-sm text-foreground">
                            {transaction.source_type && transaction.source_id ? (
                              <div className="mb-1">
                                {transaction.source_type === 'receivable' ? (
                                  <Link
                                    href={`/invoices?view=${transaction.source_id}`}
                                    className="font-medium text-primary hover:underline inline-flex items-center gap-1"
                                  >
                                    Receivable: {transaction.source_label || `INV-${transaction.source_id}`}
                                    <ExternalLink className="h-3 w-3" />
                                  </Link>
                                ) : transaction.source_type === 'payable' ? (
                                  <Link
                                    href={`/bills?view=${transaction.source_id}`}
                                    className="font-medium text-primary hover:underline inline-flex items-center gap-1"
                                  >
                                    Payable: {transaction.source_label || `BILL-${transaction.source_id}`}
                                    <ExternalLink className="h-3 w-3" />
                                  </Link>
                                ) : transaction.source_type === 'payroll' ? (
                                  <Link
                                    href="/payroll"
                                    className="font-medium text-primary hover:underline inline-flex items-center gap-1"
                                  >
                                    Payroll: {transaction.source_label || `PR-${transaction.source_id}`}
                                    <ExternalLink className="h-3 w-3" />
                                  </Link>
                                ) : (
                                  <>
                                    <Link
                                      href={
                                        transaction.source_type === 'payment_received'
                                          ? `/payments/received?edit=${transaction.source_id}`
                                          : `/payments/made?edit=${transaction.source_id}`
                                      }
                                      className="font-medium text-primary hover:underline inline-flex items-center gap-1"
                                    >
                                      {transaction.source_label || `PAY-${transaction.source_id}`}
                                      <ExternalLink className="h-3 w-3" />
                                    </Link>
                                    <span className="text-muted-foreground text-xs ml-1">
                                      ({transaction.source_type === 'payment_received'
                                        ? 'Receipt'
                                        : 'Payment made'})
                                    </span>
                                  </>
                                )}
                              </div>
                            ) : null}
                            {transaction.journal_description || transaction.description ? (
                              <>
                                <div className="text-foreground">
                                  {transaction.journal_description || transaction.description}
                                </div>
                                {transaction.journal_description &&
                                transaction.description &&
                                transaction.journal_description !== transaction.description && (
                                  <div className="text-muted-foreground text-xs mt-0.5">Line: {transaction.description}</div>
                                )}
                              </>
                            ) : !transaction.source_type ? (
                              '—'
                            ) : null}
                            {transaction.allocations && transaction.allocations.length > 0 && (
                              <ul className="mt-1.5 space-y-0.5 text-xs">
                                {transaction.allocations.map((alloc, allocIdx) => {
                                  const docHref =
                                    alloc.document_type === 'receivable' && alloc.invoice_id
                                      ? `/invoices?view=${alloc.invoice_id}`
                                      : alloc.document_type === 'payable' && alloc.bill_id
                                        ? `/bills?view=${alloc.bill_id}`
                                        : null
                                  const docLabel =
                                    alloc.document_type === 'receivable'
                                      ? `Receivable: ${alloc.document_number}`
                                      : `Payable: ${alloc.document_number}`
                                  return (
                                    <li key={allocIdx}>
                                      {docHref ? (
                                        <Link
                                          href={docHref}
                                          className="text-primary hover:underline inline-flex items-center gap-0.5"
                                        >
                                          {docLabel}
                                          <ExternalLink className="h-3 w-3" />
                                        </Link>
                                      ) : (
                                        <span className="text-foreground/85">{docLabel}</span>
                                      )}
                                      <span className="text-muted-foreground ml-1 tabular-nums">
                                        {statement.account.currency}
                                        {formatNumber(Number(alloc.amount) || 0)}
                                      </span>
                                    </li>
                                  )
                                })}
                              </ul>
                            )}
                            {transaction.other_account_name && (
                              <span className="text-muted-foreground text-xs block mt-0.5">
                                With {transaction.other_account_code} — {transaction.other_account_name}
                              </span>
                            )}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-destructive">
                            {transaction.debit_amount > 0 
                              ? `${statement.account.currency} ${formatNumber(Number(transaction.debit_amount))}`
                              : '-'
                            }
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-success">
                            {transaction.credit_amount > 0 
                              ? `${statement.account.currency} ${formatNumber(Number(transaction.credit_amount))}`
                              : '-'
                            }
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-right font-semibold text-foreground">
                            {statement.account.currency} {formatNumber(Number(runningBalance))}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-right text-sm">
                            {transaction.source_type === 'payment_received' ||
                            transaction.source_type === 'payment_made' ? (
                              transaction.can_delete_payment ? (
                                <button
                                  type="button"
                                  onClick={() => void handleStatementDeletePayment(transaction)}
                                  disabled={statementPaymentDeletingId === transaction.source_id}
                                  title="Delete payment (removes AUTO-PAY journal and restores AR/AP)"
                                  className="inline-flex items-center gap-1 rounded px-2 py-1 text-destructive hover:bg-destructive/5 disabled:opacity-50"
                                >
                                  <Trash2 className="h-4 w-4" />
                                  {statementPaymentDeletingId === transaction.source_id
                                    ? 'Deleting…'
                                    : 'Delete'}
                                </button>
                              ) : (
                                <span
                                  className="text-xs text-muted-foreground/70"
                                  title={transaction.immutable_reason || 'Cannot delete'}
                                >
                                  Locked
                                </span>
                              )
                            ) : transaction.source_type === 'payroll' &&
                              transaction.can_delete_payroll_journal ? (
                              <button
                                type="button"
                                onClick={() => void handleStatementRemovePayrollJournal(transaction)}
                                disabled={
                                  statementPayrollRemovingId ===
                                  (transaction.source_id ?? transaction.journal_entry_id)
                                }
                                title="Remove salary journal — payroll run returns to draft"
                                className="inline-flex items-center gap-1 rounded px-2 py-1 text-destructive hover:bg-destructive/5 disabled:opacity-50"
                              >
                                <Trash2 className="h-4 w-4" />
                                {statementPayrollRemovingId ===
                                (transaction.source_id ?? transaction.journal_entry_id)
                                  ? 'Removing…'
                                  : 'Delete'}
                              </button>
                            ) : transaction.source_type === 'receivable' && transaction.source_id ? (
                              <Link
                                href={`/invoices?view=${transaction.source_id}`}
                                className="text-xs font-medium text-primary hover:underline"
                              >
                                Open
                              </Link>
                            ) : transaction.source_type === 'payable' && transaction.source_id ? (
                              <Link
                                href={`/bills?view=${transaction.source_id}`}
                                className="text-xs font-medium text-primary hover:underline"
                              >
                                Open
                              </Link>
                            ) : (
                              <span className="text-muted-foreground/40">—</span>
                            )}
                          </td>
                        </tr>
                      )
                    })
                  )}

                  {/* Closing Balance Row */}
                  <tr className="bg-muted/40 font-semibold">
                    <td colSpan={4} className="px-6 py-4 text-sm font-semibold text-foreground">
                      Closing Balance
                    </td>
                    <td className="px-6 py-4 text-sm text-right text-destructive">
                      {statement.account.currency} {formatNumber(Number(statement.total_debits))}
                    </td>
                    <td className="px-6 py-4 text-sm text-right text-success">
                      {statement.account.currency} {formatNumber(Number(statement.total_credits))}
                    </td>
                    <td className="px-6 py-4 text-sm text-right font-semibold text-foreground">
                      {statement.account.currency} {formatNumber(Number(statement.closing_balance))}
                    </td>
                    <td />
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
        <div className="erp-modal-backdrop">
          <div className="bg-white rounded-lg p-6 max-w-md w-full shadow-xl">
            <h2 className="text-xl font-bold mb-2">Delete account</h2>
            {accPending && (
              <p className="text-sm text-foreground mb-2">
                <span className="font-mono font-semibold">{accPending.account_code}</span>
                {' — '}
                {accPending.account_name}
              </p>
            )}
            <p className="text-muted-foreground mb-4 text-sm leading-relaxed">
              {blocked
                ? deleteBlockedHint(accPending!)
                : 'This permanently removes the account from the chart. If it was never used in journals, it is safe to delete.'}
            </p>
            {!blocked && (
              <p className="text-muted-foreground text-xs mb-6">
                To hide an account from selection without deleting history, use <strong>Edit</strong> and turn off{' '}
                <strong>Active</strong>.
              </p>
            )}
            <div className="flex justify-end space-x-3">
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(null)}
                className="erp-btn-secondary"
              >
                {blocked ? 'Close' : 'Cancel'}
              </button>
              {!blocked && (
                <button
                  type="button"
                  onClick={() => handleDelete(showDeleteConfirm)}
                  className="erp-btn-danger"
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
          <div className="bg-white rounded-lg app-modal-pad max-w-2xl w-full max-h-[90vh] overflow-y-auto my-8">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-bold">
                {editingAccount ? 'Edit Account' : 'New Account'}
              </h2>
              <button
                onClick={handleCloseModal}
                className="text-muted-foreground/70 hover:text-muted-foreground"
              >
                <X className="h-6 w-6" />
              </button>
            </div>

            <form onSubmit={editingAccount ? handleUpdate : handleCreate}>
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="mb-2 block text-sm font-medium text-foreground">
                    Account Code *
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.account_code}
                    onChange={(e) => setFormData({ ...formData, account_code: e.target.value })}
                    className="erp-field"
                    placeholder="e.g., 1000, 2000"
                  />
                </div>
                <div>
                  <label className="mb-2 block text-sm font-medium text-foreground">
                    Account Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.account_name}
                    onChange={(e) => setFormData({ ...formData, account_name: e.target.value })}
                    className="erp-field"
                    placeholder="e.g., Cash, Accounts Payable"
                  />
                </div>
                <div>
                  <label className="mb-2 block text-sm font-medium text-foreground">
                    Account Type *
                  </label>
                  <select
                    required
                    value={formData.account_type}
                    onChange={(e) => {
                      const nextType = e.target.value
                      const subTypes = ACCOUNT_SUBTYPES[nextType] || []
                      const defaultSub =
                        nextType === 'cost_of_goods_sold' && subTypes.length > 0
                          ? subTypes[0].value
                          : ''
                      setFormData({
                        ...formData,
                        account_type: nextType,
                        account_sub_type: defaultSub,
                      })
                    }}
                    className="erp-field"
                  >
                    {ACCOUNT_TYPES.map((type) => (
                      <option key={type.value} value={type.value}>
                        {type.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-2 block text-sm font-medium text-foreground">
                    Account Sub-Type *
                  </label>
                  <select
                    required
                    value={formData.account_sub_type}
                    onChange={(e) => setFormData({ ...formData, account_sub_type: e.target.value })}
                    className="erp-field"
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
                        <label className="block text-sm font-medium text-foreground/85 mb-1">Institution / bank name</label>
                        <input
                          type="text"
                          value={formData.bank_name}
                          onChange={(e) => setFormData({ ...formData, bank_name: e.target.value })}
                          className="w-full px-3 py-2 border border-border rounded-lg focus:ring-2 focus:ring-ring bg-white"
                          placeholder="e.g. City Bank PLC"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-foreground/85 mb-1">Account number</label>
                        <input
                          type="text"
                          value={formData.bank_account_number}
                          onChange={(e) => setFormData({ ...formData, bank_account_number: e.target.value })}
                          className="w-full px-3 py-2 border border-border rounded-lg focus:ring-2 focus:ring-ring bg-white font-mono"
                          placeholder="Account #"
                        />
                      </div>
                      <div className="md:col-span-2">
                        <label className="block text-sm font-medium text-foreground/85 mb-1">Register type</label>
                        <select
                          value={formData.register_type}
                          onChange={(e) => setFormData({ ...formData, register_type: e.target.value })}
                          className="w-full px-3 py-2 border border-border rounded-lg focus:ring-2 focus:ring-ring bg-white"
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
                  <label className="mb-2 block text-sm font-medium text-foreground">
                    Description
                  </label>
                  <textarea
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    rows={2}
                    className="erp-field"
                    placeholder="What this account is for (shown in the chart list; use for staff guidance)"
                  />
                </div>
                <div>
                  <label className="mb-2 block text-sm font-medium text-foreground">
                    Opening Balance ({currencySymbol})
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={formData.opening_balance}
                    onChange={(e) => setFormData({ ...formData, opening_balance: parseFloat(e.target.value) || 0 })}
                    className="erp-field"
                    placeholder="0.00"
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    Starting balance for this account
                  </p>
                </div>
                <div>
                  <label className="mb-2 block text-sm font-medium text-foreground">
                    As of Date *
                  </label>
                  <input
                    type="date"
                    required
                    value={formData.opening_balance_date}
                    onChange={(e) => setFormData({ ...formData, opening_balance_date: e.target.value })}
                    className="erp-field"
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    Date of the opening balance
                  </p>
                </div>
                <div className="col-span-2">
                  <label className="flex items-center space-x-2">
                    <input
                      type="checkbox"
                      checked={formData.is_active}
                      onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
                      className="w-4 h-4 text-primary border-border rounded focus:ring-ring"
                    />
                    <span className="text-sm font-medium text-foreground/85">Active</span>
                  </label>
                </div>
              </div>
              <div className="flex justify-end space-x-3 mt-6">
                <button
                  type="button"
                  onClick={handleCloseModal}
                  className="erp-btn-secondary"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="erp-btn-primary"
                >
                  {editingAccount ? 'Update Account' : 'Create Account'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      </ErpPageShell>
    </PageLayout>
  )
}
