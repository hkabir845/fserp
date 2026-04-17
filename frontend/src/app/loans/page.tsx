'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import Sidebar from '@/components/Sidebar'
import { useToast } from '@/components/Toast'
import api from '@/lib/api'
import {
  Plus,
  X,
  Landmark,
  RefreshCw,
  Pencil,
  Trash2,
  FileText,
  Calculator,
  Printer,
  Download,
  Search,
  Scale,
  Shield,
  TrendingDown,
  TrendingUp,
  BookOpen,
  Users,
  Filter,
} from 'lucide-react'
import { getCurrencySymbol } from '@/utils/currency'
import { printCurrentWindow, printDocument, escapeHtml } from '@/utils/printDocument'
import { formatCoaOptionLabel } from '@/utils/coaOptionLabel'
import {
  MAX_ANNUAL_APR,
  annualAprFromInterestFormInput,
  convertInterestFieldOnCounterpartyChange,
  formatInterestInputFromStoredAnnual,
  isBankOrFinanceCompanyRole,
} from './loanInterestForm'

interface Counterparty {
  id: number
  code: string
  name: string
  role_type: string
  is_active: boolean
}

type LoanProductType =
  | 'general'
  | 'term_loan'
  | 'business_line'
  | 'islamic_facility'
  | 'islamic_deal'

interface LoanRow {
  id: number
  loan_no: string
  direction: string
  status: string
  counterparty_id: number
  title: string
  principal_account_id: number
  settlement_account_id: number
  interest_account_id: number | null
  interest_accrual_account_id?: number | null
  sanction_amount: string
  outstanding_principal: string
  total_disbursed: string
  total_repaid_principal?: string
  banking_model?: string
  product_type?: LoanProductType | string
  parent_loan_id?: number | null
  parent_loan_no?: string
  deal_reference?: string
  facility_outstanding_on_deals?: string
  facility_committed_by_deals?: string
  facility_available_limit?: string
  facility_deal_count?: number
  islamic_contract_variant?: string
  /** bank, finance_company, etc. — drives interest day-count rules */
  counterparty_role_type?: string
  annual_interest_rate?: string
  /** annual_act_365 | monthly_30_360 | zero */
  interest_basis?: string
  interest_basis_label?: string
  /** From API: use profit/return wording when true */
  is_islamic_financing?: boolean
}

function loanUsesIslamicTerminology(
  row: Partial<Pick<LoanRow, 'banking_model' | 'product_type' | 'is_islamic_financing'>> | null | undefined
): boolean {
  if (!row) return false
  if (row.is_islamic_financing === true) return true
  if (row.banking_model === 'islamic') return true
  const pt = row.product_type
  return pt === 'islamic_facility' || pt === 'islamic_deal'
}

type LoanFormState = {
  loan_no: string
  direction: 'borrowed' | 'lent'
  banking_model: 'conventional' | 'islamic'
  product_type: LoanProductType
  parent_loan_id: number
  deal_reference: string
  counterparty_id: number
  title: string
  sanction_amount: string
  principal_account_id: number
  settlement_account_id: number
  interest_account_id: number
  interest_accrual_account_id: number
  islamic_contract_variant: string
  notes: string
  maturity_date: string
  status: string
  agreement_no: string
  start_date: string
  annual_interest_rate: string
  term_months: string
}

function emptyLoanForm(): LoanFormState {
  return {
    loan_no: '',
    direction: 'borrowed',
    banking_model: 'conventional',
    product_type: 'general',
    parent_loan_id: 0,
    deal_reference: '',
    counterparty_id: 0,
    title: '',
    sanction_amount: '',
    principal_account_id: 0,
    settlement_account_id: 0,
    interest_account_id: 0,
    interest_accrual_account_id: 0,
    islamic_contract_variant: '',
    notes: '',
    maturity_date: '',
    status: 'draft',
    agreement_no: '',
    start_date: '',
    annual_interest_rate: '0',
    term_months: '',
  }
}

interface CoaLine {
  id: number
  account_code: string
  account_name: string
  account_type: string
  account_sub_type?: string
}

const CP_ROLE_OPTIONS: { value: string; label: string }[] = [
  { value: 'bank', label: 'Bank' },
  { value: 'individual', label: 'Individual' },
  { value: 'finance_company', label: 'Finance company' },
  { value: 'employee', label: 'Employee' },
  { value: 'vendor', label: 'Vendor' },
  { value: 'customer', label: 'Customer' },
  { value: 'sister_concern', label: 'Sister concern' },
  { value: 'other', label: 'Other' },
]

function formatRoleType(role: string) {
  const o = CP_ROLE_OPTIONS.find((x) => x.value === role)
  return o?.label || role
}

/** Table subtitle + tooltip; uses API fields when present, else derives from role + rate. */
function loanInterestBasisLine(row: LoanRow): { short: string; title: string } {
  const isl = loanUsesIslamicTerminology(row)
  if (row.interest_basis && row.interest_basis_label) {
    const ib = row.interest_basis
    const short =
      ib === 'zero'
        ? isl
          ? 'Zero profit (0% rate)'
          : 'Zero interest'
        : ib === 'annual_act_365'
          ? isl
            ? 'Return: annual /365'
            : 'Interest: annual /365'
          : isl
            ? 'Return: monthly /360'
            : 'Interest: monthly /360'
    return { short, title: row.interest_basis_label }
  }
  const rate = Number(row.annual_interest_rate ?? 0)
  if (rate <= 0) {
    return isl
      ? { short: 'Zero profit (0% rate)', title: 'Zero profit (0% quoted rate)' }
      : { short: 'Zero interest', title: 'Zero interest (0% annual rate)' }
  }
  const annual = isBankOrFinanceCompanyRole(row.counterparty_role_type || 'other')
  return annual
    ? isl
      ? { short: 'Return: annual /365', title: 'Annual (bank/finance): actual/365 day count' }
      : { short: 'Interest: annual /365', title: 'Annual (bank/finance): actual/365 day count' }
    : isl
      ? { short: 'Return: monthly /360', title: 'Monthly (other parties): 30/360 day count' }
      : { short: 'Interest: monthly /360', title: 'Monthly (other parties): 30/360 day count' }
}

const ISLAMIC_CONTRACT_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: '— Not specified —' },
  { value: 'murabaha', label: 'Murabaha' },
  { value: 'ijara', label: 'Ijara' },
  { value: 'mudarabah', label: 'Mudarabah' },
  { value: 'musharakah', label: 'Musharakah' },
  { value: 'istisna', label: 'Istisna' },
  { value: 'salam', label: 'Salam' },
  { value: 'other', label: 'Other (notes)' },
]

const PRODUCT_OPTIONS: { value: LoanProductType; label: string }[] = [
  { value: 'general', label: 'General (legacy)' },
  { value: 'term_loan', label: 'Term loan — fixed tenor, principal + interest instalments' },
  { value: 'business_line', label: 'Business line — limit; interest on utilised balance' },
  { value: 'islamic_facility', label: 'Islamic facility — overall Shariah limit (no postings here)' },
  { value: 'islamic_deal', label: 'Islamic deal — purpose tranche under a facility' },
]

function productTypeLabel(pt: string | undefined): string {
  return PRODUCT_OPTIONS.find((x) => x.value === pt)?.label.split(' —')[0] || pt || 'General'
}

function formatMoneyAmount(s: string | undefined, sym: string): string {
  const n = Number(s ?? 0)
  return `${sym}${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function outstandingDisplayed(row: LoanRow): string {
  if (row.product_type === 'islamic_facility' && row.facility_outstanding_on_deals != null) {
    return row.facility_outstanding_on_deals
  }
  return row.outstanding_principal ?? '0'
}

function utilisationPercent(row: LoanRow): string | null {
  const lim = Number(row.sanction_amount ?? 0)
  if (lim <= 0) return null
  const used = Number(row.total_disbursed ?? 0)
  return `${Math.min(100, Math.round((used / lim) * 1000) / 10)}%`
}

function isIslamicFacilityHeader(row: LoanRow): boolean {
  return row.product_type === 'islamic_facility'
}

function loanHasMoneyMovement(row: LoanRow): boolean {
  return Number(row.total_disbursed ?? 0) > 0 || Number(row.total_repaid_principal ?? 0) > 0
}

function errDetail(e: unknown): string {
  const err = e as { response?: { data?: { detail?: string } } }
  return err.response?.data?.detail || 'Request failed'
}

function findCoaById(list: CoaLine[], id: number | null | undefined): CoaLine | undefined {
  if (id == null || id === 0) return undefined
  return list.find((a) => a.id === id)
}

function formatCoaDisplay(a: CoaLine | undefined): string {
  if (!a) return ''
  const code = (a.account_code || '').trim()
  const name = (a.account_name || '').trim()
  if (code && name) return `${code} — ${name}`
  return code || name || ''
}

interface ScheduleRemainingResponse {
  schedule?: {
    period: number
    period_label?: string
    period_start?: string
    period_end?: string
    days_in_period?: number
    payment: string
    principal: string
    interest: string
    closing_balance: string
  }[]
  suggested_next?: { period: number; payment: string; principal: string; interest: string } | null
  method_note?: string
  schedule_model?: 'reducing_balance_emi' | 'principal_only' | 'business_line_quarterly_interest'
  interest_payment_frequency?: 'monthly' | 'quarterly'
  remaining_periods?: number
  remaining_period_unit?: 'months' | 'quarters'
  outstanding_principal?: string
  interest_basis?: string
  interest_basis_label?: string
  financing_terminology?: 'islamic' | 'conventional'
  /** API: payable = you pay (borrowed), receivable = you collect (lent). */
  schedule_sheet?: { direction: string; role: 'payable' | 'receivable' }
}

interface LoanStatementResponse {
  financing_terminology?: 'islamic' | 'conventional'
  statement_note?: string
  loan: {
    loan_no: string
    direction: string
    status: string
    product_type?: string
    banking_model?: string
    is_islamic_financing?: boolean
    islamic_contract_variant?: string
    counterparty_name?: string
    sanction_amount?: string
    outstanding_principal?: string
    interest_basis_label?: string
  }
  lines: {
    date: string
    kind: string
    kind_label?: string
    reference: string
    disbursement: string
    repayment_total: string
    principal: string
    interest: string
    outstanding_principal_after: string
  }[]
  as_of?: string
}

function sanctionFieldLabel(pt: LoanProductType): string {
  if (pt === 'islamic_facility') return 'Facility limit (Shariah ceiling)'
  if (pt === 'islamic_deal') return 'Deal amount (commitment for this purpose)'
  if (pt === 'business_line') return 'Credit limit / line size'
  if (pt === 'term_loan') return 'Principal / sanctioned amount'
  return 'Sanction limit (optional)'
}

/** Matches backend `coa_eligible_for_bank_register` — bank / cash settlement lines for loans. */
const BANK_REGISTER_SUBTYPES = new Set([
  'checking',
  'savings',
  'cash_on_hand',
  'money_market',
  'cash_management',
  'other_bank_account',
])

function isLoanSettlementCoa(a: CoaLine): boolean {
  const t = (a.account_type || '').toLowerCase()
  const st = (a.account_sub_type || '').toLowerCase()
  if (t === 'bank_account') return true
  return t === 'asset' && BANK_REGISTER_SUBTYPES.has(st)
}

function isPrincipalCoaForDirection(a: CoaLine, direction: 'borrowed' | 'lent'): boolean {
  const t = (a.account_type || '').toLowerCase()
  const st = (a.account_sub_type || '').toLowerCase()
  if (direction === 'borrowed') {
    return (t === 'loan' && st === 'loan_payable') || (t === 'liability' && st === 'loan_payable')
  }
  // Lent (money we advanced): template uses type `loan` + loan_receivable; imports may use `asset`.
  return (
    (t === 'loan' && st === 'loan_receivable') || (t === 'asset' && st === 'loan_receivable')
  )
}

function isInterestCoaForDirection(a: CoaLine, direction: 'borrowed' | 'lent'): boolean {
  const t = (a.account_type || '').toLowerCase()
  if (direction === 'borrowed') return t === 'expense'
  return t === 'income'
}

/** Accrued interest payable (borrowed) or receivable (lent) — balance sheet. */
function isAccrualCoaForDirection(a: CoaLine, direction: 'borrowed' | 'lent'): boolean {
  const t = (a.account_type || '').toLowerCase()
  if (direction === 'borrowed') return t === 'liability'
  return t === 'asset'
}

function statementKindLabel(kind: string, islamic = false): string {
  if (islamic) {
    if (kind === 'disbursement') return 'Financing disbursement'
    if (kind === 'repayment') return 'Payment (principal & profit)'
    if (kind === 'repayment_reversal') return 'Payment reversal'
    if (kind === 'interest_accrual') return 'Profit accrual'
    if (kind === 'interest_accrual_reversal') return 'Profit accrual reversal'
    return kind.replace(/_/g, ' ')
  }
  if (kind === 'disbursement') return 'Disbursement'
  if (kind === 'repayment') return 'Repayment'
  if (kind === 'repayment_reversal') return 'Repayment reversal'
  if (kind === 'interest_accrual') return 'Interest accrual'
  if (kind === 'interest_accrual_reversal') return 'Accrual reversal'
  return kind.replace(/_/g, ' ')
}

/** Two-decimal string for repayment math (matches GL tolerance in doRepay). */
function roundMoney2(n: number): string {
  return (Math.round(n * 100) / 100).toFixed(2)
}

function csvEscapeCell(v: string): string {
  const s = String(v ?? '')
  if (s.includes(',') || s.includes('"') || s.includes('\n')) return `"${s.replace(/"/g, '""')}"`
  return s
}

function computeAutoRepayFields(
  outstanding: number,
  sched: ScheduleRemainingResponse | null,
  hint: { simple_interest_estimate?: string } | null
): { payment: string; principal: string; interest: string } {
  if (outstanding <= 0.0005) return { payment: '', principal: '', interest: '' }
  if (sched?.suggested_next) {
    const sn = sched.suggested_next
    return { payment: sn.payment, principal: sn.principal, interest: sn.interest }
  }
  if (hint?.simple_interest_estimate != null) {
    const i = Number(hint.simple_interest_estimate)
    const p = outstanding
    if (Number.isFinite(i)) {
      return {
        principal: roundMoney2(p),
        interest: roundMoney2(i),
        payment: roundMoney2(p + i),
      }
    }
  }
  return {
    principal: roundMoney2(outstanding),
    interest: '0.00',
    payment: roundMoney2(outstanding),
  }
}

export default function LoansPage() {
  const router = useRouter()
  const toast = useToast()
  const [loans, setLoans] = useState<LoanRow[]>([])
  const [counterpartiesAll, setCounterpartiesAll] = useState<Counterparty[]>([])
  const [coa, setCoa] = useState<CoaLine[]>([])
  const [loading, setLoading] = useState(true)
  const [currencySymbol, setCurrencySymbol] = useState('৳')
  const [showCp, setShowCp] = useState(false)
  const [cpEditId, setCpEditId] = useState<number | null>(null)
  const [loanModalOpen, setLoanModalOpen] = useState(false)
  const [loanModalMode, setLoanModalMode] = useState<'new' | 'edit'>('new')
  const [loanModalLoanId, setLoanModalLoanId] = useState<number | null>(null)
  const [loanModalLoading, setLoanModalLoading] = useState(false)
  const [loanModalHasActivity, setLoanModalHasActivity] = useState(false)
  /** True when edit session started on a closed loan — save uses minimal payload until reopened. */
  const [loanEditInitiallyClosed, setLoanEditInitiallyClosed] = useState(false)
  const [loanForm, setLoanForm] = useState<LoanFormState>(() => emptyLoanForm())
  const [cpForm, setCpForm] = useState({ name: '', role_type: 'other' })
  const [cpEditForm, setCpEditForm] = useState({
    code: '',
    name: '',
    role_type: 'other',
    is_active: true,
  })
  const [actionLoan, setActionLoan] = useState<LoanRow | null>(null)
  const [disbAmt, setDisbAmt] = useState('')
  const [repayAmt, setRepayAmt] = useState('')
  const [repayPrin, setRepayPrin] = useState('')
  const [repayInt, setRepayInt] = useState('')
  const [scheduleData, setScheduleData] = useState<ScheduleRemainingResponse | null>(null)
  const [scheduleErr, setScheduleErr] = useState('')
  const [scheduleLoading, setScheduleLoading] = useState(false)
  const [scheduleRemainApplied, setScheduleRemainApplied] = useState<number | null>(null)
  const [scheduleRemainInput, setScheduleRemainInput] = useState('')
  const [scheduleQuartersApplied, setScheduleQuartersApplied] = useState<number | null>(null)
  const [scheduleQuartersInput, setScheduleQuartersInput] = useState('')
  const [interestHint, setInterestHint] = useState<{
    simple_interest_estimate?: string
    days?: number
    note?: string
    interest_basis?: string
    interest_basis_label?: string
    financing_terminology?: 'islamic' | 'conventional'
  } | null>(null)
  const [interestHintDays, setInterestHintDays] = useState(30)
  const [statementLoan, setStatementLoan] = useState<LoanRow | null>(null)
  const [statementPayload, setStatementPayload] = useState<LoanStatementResponse | null>(null)
  const [statementLoading, setStatementLoading] = useState(false)
  const [loanAccruals, setLoanAccruals] = useState<
    {
      id: number
      accrual_date: string
      amount: string
      days_basis: number | null
      journal_entry_id: number | null
      reversed_at: string | null
      reversal_journal_entry_id: number | null
    }[]
  >([])
  const [loanRepayments, setLoanRepayments] = useState<
    {
      id: number
      repayment_date: string
      amount: string
      principal_amount: string
      interest_amount: string
      journal_entry_id: number | null
      reversed_at: string | null
      reversal_journal_entry_id: number | null
    }[]
  >([])
  const [accrualAmount, setAccrualAmount] = useState('')
  const [accrualDays, setAccrualDays] = useState('30')
  const [accrualMemo, setAccrualMemo] = useState('')
  const [accrualDate, setAccrualDate] = useState('')
  const [loanRegisterQuery, setLoanRegisterQuery] = useState('')
  const [loanFilterDirection, setLoanFilterDirection] = useState<'all' | 'borrowed' | 'lent'>('all')
  const [loanFilterStatus, setLoanFilterStatus] = useState<'all' | 'draft' | 'active' | 'closed'>('all')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [lr, cr, coaRes, comp] = await Promise.all([
        api.get('/loans/'),
        api.get('/loans/counterparties/'),
        api.get('/chart-of-accounts/'),
        api.get('/companies/current').catch(() => null),
      ])
      setLoans(Array.isArray(lr.data) ? lr.data : [])
      setCounterpartiesAll(Array.isArray(cr.data) ? cr.data : [])
      setCoa(Array.isArray(coaRes.data) ? coaRes.data.filter((a: CoaLine) => a.id) : [])
      if (comp?.data?.currency) setCurrencySymbol(getCurrencySymbol(comp.data.currency))
    } catch (e: unknown) {
      const err = e as { response?: { status?: number; data?: { detail?: string } } }
      if (err.response?.status === 401) router.push('/login')
      else toast.error(err.response?.data?.detail || 'Failed to load loans')
    } finally {
      setLoading(false)
    }
  }, [router, toast])

  useEffect(() => {
    const t = localStorage.getItem('access_token')
    if (!t) {
      router.push('/login')
      return
    }
    load()
  }, [router, load])

  const activeCounterparties = counterpartiesAll.filter((c) => c.is_active)

  const loanFormInterestBankFinance = useMemo(
    () =>
      isBankOrFinanceCompanyRole(
        counterpartiesAll.find((c) => c.id === loanForm.counterparty_id)?.role_type ?? ''
      ),
    [counterpartiesAll, loanForm.counterparty_id]
  )

  const coaFilteredForLoan = useMemo(() => {
    const principal = coa.filter((a) => isPrincipalCoaForDirection(a, loanForm.direction))
    const settlement = coa.filter(isLoanSettlementCoa)
    const interest = coa.filter((a) => isInterestCoaForDirection(a, loanForm.direction))
    const accrual = coa.filter((a) => isAccrualCoaForDirection(a, loanForm.direction))
    return { principal, settlement, interest, accrual }
  }, [coa, loanForm.direction])

  const islamicFacilitiesForParent = useMemo(() => {
    return loans.filter(
      (l) =>
        l.product_type === 'islamic_facility' &&
        l.direction === loanForm.direction &&
        l.id !== loanModalLoanId
    )
  }, [loans, loanForm.direction, loanModalLoanId])

  const actionLoanSettlementCoa = useMemo(
    () => findCoaById(coa, actionLoan?.settlement_account_id),
    [coa, actionLoan]
  )

  const disburseRepayUsesIslamicTerms = useMemo(() => {
    if (!actionLoan) return false
    return (
      loanUsesIslamicTerminology(actionLoan) ||
      interestHint?.financing_terminology === 'islamic' ||
      scheduleData?.financing_terminology === 'islamic'
    )
  }, [actionLoan, interestHint, scheduleData])

  const statementUsesIslamicTerms = useMemo(() => {
    if (!statementLoan) return false
    if (statementPayload) {
      return (
        statementPayload.financing_terminology === 'islamic' ||
        loanUsesIslamicTerminology(statementPayload.loan)
      )
    }
    return loanUsesIslamicTerminology(statementLoan)
  }, [statementLoan, statementPayload])

  const openEditCounterparty = (c: Counterparty) => {
    setCpEditId(c.id)
    setCpEditForm({
      code: c.code,
      name: c.name,
      role_type: c.role_type,
      is_active: c.is_active,
    })
  }

  const closeEditCounterparty = () => {
    setCpEditId(null)
  }

  const submitEditCounterparty = async (e: React.FormEvent) => {
    e.preventDefault()
    if (cpEditId == null) return
    try {
      await api.put(`/loans/counterparties/${cpEditId}/`, {
        name: cpEditForm.name.trim(),
        role_type: cpEditForm.role_type,
        is_active: cpEditForm.is_active,
      })
      toast.success('Counterparty updated')
      closeEditCounterparty()
      load()
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } }
      toast.error(err.response?.data?.detail || 'Update failed')
    }
  }

  const deleteCounterparty = async (c: Counterparty) => {
    const ok = window.confirm(
      `Delete counterparty ${c.code} — ${c.name}? This cannot be undone. You can only delete if no loans use this party.`
    )
    if (!ok) return
    try {
      await api.delete(`/loans/counterparties/${c.id}/`)
      toast.success('Counterparty deleted')
      if (cpEditId === c.id) closeEditCounterparty()
      load()
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } }
      toast.error(err.response?.data?.detail || 'Delete failed')
    }
  }

  const submitCounterparty = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      await api.post('/loans/counterparties/', {
        name: cpForm.name.trim(),
        role_type: cpForm.role_type,
      })
      toast.success('Counterparty saved')
      setShowCp(false)
      setCpForm({ name: '', role_type: 'other' })
      load()
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } }
      toast.error(err.response?.data?.detail || 'Save failed')
    }
  }

  const closeLoanModal = () => {
    setLoanModalOpen(false)
    setLoanModalMode('new')
    setLoanModalLoanId(null)
    setLoanModalLoading(false)
    setLoanModalHasActivity(false)
    setLoanEditInitiallyClosed(false)
    setLoanForm(emptyLoanForm())
  }

  const openNewLoanModal = () => {
    setLoanModalMode('new')
    setLoanModalLoanId(null)
    setLoanModalHasActivity(false)
    setLoanEditInitiallyClosed(false)
    setLoanModalLoading(false)
    setLoanForm(emptyLoanForm())
    setLoanModalOpen(true)
  }

  const openEditLoan = async (row: LoanRow) => {
    setLoanModalMode('edit')
    setLoanModalLoanId(row.id)
    setLoanModalOpen(true)
    setLoanModalLoading(true)
    setLoanModalHasActivity(false)
    try {
      const { data } = await api.get(`/loans/${row.id}/`)
      const d = data as {
        loan_no: string
        direction: string
        counterparty_id: number
        title?: string
        sanction_amount?: string
        principal_account_id: number
        settlement_account_id: number
        interest_account_id: number | null
        notes?: string
        maturity_date?: string | null
        status: string
        agreement_no?: string
        start_date?: string | null
        annual_interest_rate?: string | null
        term_months?: number | null
        banking_model?: string
        product_type?: string
        parent_loan_id?: number | null
        deal_reference?: string
        interest_accrual_account_id?: number | null
        islamic_contract_variant?: string
        disbursements?: unknown[]
        repayments?: unknown[]
        interest_accruals?: { journal_entry_id?: number | null }[]
        counterparty_role_type?: string
      }
      const hasActivity =
        (Array.isArray(d.disbursements) && d.disbursements.length > 0) ||
        (Array.isArray(d.repayments) && d.repayments.length > 0) ||
        (Array.isArray(d.interest_accruals) &&
          d.interest_accruals.some((a) => a.journal_entry_id != null && a.journal_entry_id !== 0))
      setLoanModalHasActivity(hasActivity)
      setLoanEditInitiallyClosed(d.status === 'closed')
      const pt = (d.product_type || 'general') as LoanProductType
      const bm = d.banking_model === 'islamic' ? 'islamic' : 'conventional'
      const role =
        d.counterparty_role_type ??
        counterpartiesAll.find((c) => c.id === d.counterparty_id)?.role_type ??
        ''
      const apiAnnual = Number(d.annual_interest_rate ?? 0)
      setLoanForm({
        loan_no: d.loan_no,
        direction: d.direction === 'lent' ? 'lent' : 'borrowed',
        banking_model: bm,
        product_type: PRODUCT_OPTIONS.some((x) => x.value === pt) ? pt : 'general',
        parent_loan_id: d.parent_loan_id || 0,
        deal_reference: d.deal_reference || '',
        counterparty_id: d.counterparty_id,
        title: d.title || '',
        sanction_amount: d.sanction_amount != null ? String(d.sanction_amount) : '',
        principal_account_id: d.principal_account_id,
        settlement_account_id: d.settlement_account_id,
        interest_account_id: d.interest_account_id || 0,
        interest_accrual_account_id: d.interest_accrual_account_id || 0,
        islamic_contract_variant: d.islamic_contract_variant || '',
        notes: d.notes || '',
        maturity_date: d.maturity_date || '',
        status: d.status || 'draft',
        agreement_no: d.agreement_no || '',
        start_date: d.start_date || '',
        annual_interest_rate: formatInterestInputFromStoredAnnual(
          apiAnnual,
          !isBankOrFinanceCompanyRole(role)
        ),
        term_months: d.term_months != null ? String(d.term_months) : '',
      })
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } }
      toast.error(err.response?.data?.detail || 'Failed to load loan')
      closeLoanModal()
    } finally {
      setLoanModalLoading(false)
    }
  }

  const submitLoanModal = async (e: React.FormEvent) => {
    e.preventDefault()
    const isEdit = loanModalMode === 'edit'
    const termParsed =
      loanForm.term_months.trim() === ''
        ? null
        : (() => {
            const n = parseInt(loanForm.term_months, 10)
            return Number.isNaN(n) ? null : n
          })()

    if (isEdit) {
      if (loanModalLoanId == null) return
      const restrictedEdit = loanModalHasActivity || loanEditInitiallyClosed
      let unrestrictedAnnualForApi: string | undefined
      if (!restrictedEdit) {
        if (
          !loanForm.counterparty_id ||
          !loanForm.principal_account_id ||
          !loanForm.settlement_account_id
        ) {
          toast.error('Select counterparty, principal GL, and settlement GL')
          return
        }
        if (loanForm.product_type === 'islamic_deal' && !loanForm.parent_loan_id) {
          toast.error('Islamic deal requires a parent facility')
          return
        }
        const rateTrim = loanForm.annual_interest_rate.trim()
        if (rateTrim === '') {
          toast.error(
            loanFormInterestBankFinance
              ? 'Enter annual interest % (use 0 for zero-interest)'
              : 'Enter monthly interest % (use 0 for zero-interest)'
          )
          return
        }
        const displayNum = Number(rateTrim)
        if (!Number.isFinite(displayNum) || displayNum < 0) {
          toast.error(
            loanFormInterestBankFinance
              ? 'Annual interest % must be a number ≥ 0'
              : 'Monthly interest % must be a number ≥ 0'
          )
          return
        }
        const uncappedAnnual = loanFormInterestBankFinance ? displayNum : displayNum * 12
        if (uncappedAnnual > MAX_ANNUAL_APR) {
          toast.error(
            loanFormInterestBankFinance
              ? `Annual interest % cannot exceed ${MAX_ANNUAL_APR}%`
              : `Monthly interest % is too high (×12 annual would exceed ${MAX_ANNUAL_APR}%)`
          )
          return
        }
        const storedAnnualStr = annualAprFromInterestFormInput(rateTrim, loanFormInterestBankFinance)
        if (storedAnnualStr == null) {
          toast.error(
            loanFormInterestBankFinance
              ? 'Annual interest % could not be saved — check the value'
              : 'Monthly interest % could not be saved — check the value'
          )
          return
        }
        unrestrictedAnnualForApi = storedAnnualStr
      }
      try {
        const base = {
          title: loanForm.title,
          notes: loanForm.notes,
          status: loanForm.status,
          maturity_date: loanForm.maturity_date.trim() || null,
        }
        const payload = restrictedEdit
          ? base
          : {
              ...base,
              direction: loanForm.direction,
              banking_model: loanForm.banking_model,
              product_type: loanForm.product_type,
              parent_loan_id:
                loanForm.product_type === 'islamic_deal' ? loanForm.parent_loan_id : null,
              deal_reference: loanForm.deal_reference.trim() || '',
              counterparty_id: loanForm.counterparty_id,
              sanction_amount: loanForm.sanction_amount || '0',
              principal_account_id: loanForm.principal_account_id,
              settlement_account_id: loanForm.settlement_account_id,
              interest_account_id: loanForm.interest_account_id || null,
              agreement_no: loanForm.agreement_no.trim() || '',
              start_date: loanForm.start_date.trim() || null,
              annual_interest_rate: unrestrictedAnnualForApi as string,
              term_months: termParsed,
            }
        await api.put(`/loans/${loanModalLoanId}/`, payload)
        toast.success('Loan updated')
        closeLoanModal()
        load()
      } catch (e: unknown) {
        const err = e as { response?: { data?: { detail?: string } } }
        toast.error(err.response?.data?.detail || 'Update failed')
      }
      return
    }

    if (!loanForm.counterparty_id || !loanForm.principal_account_id || !loanForm.settlement_account_id) {
      toast.error('Select counterparty, principal GL, and settlement (bank/cash) GL')
      return
    }
    if (loanForm.product_type === 'islamic_deal' && !loanForm.parent_loan_id) {
      toast.error('Islamic deal requires a parent facility')
      return
    }
    const newRateTrim = loanForm.annual_interest_rate.trim()
    if (newRateTrim === '') {
      toast.error(
        loanFormInterestBankFinance
          ? 'Enter annual interest % (use 0 for zero-interest)'
          : 'Enter monthly interest % (use 0 for zero-interest)'
      )
      return
    }
    const newDisplayNum = Number(newRateTrim)
    if (!Number.isFinite(newDisplayNum) || newDisplayNum < 0) {
      toast.error(
        loanFormInterestBankFinance
          ? 'Annual interest % must be a number ≥ 0'
          : 'Monthly interest % must be a number ≥ 0'
      )
      return
    }
    const uncappedCreate = loanFormInterestBankFinance ? newDisplayNum : newDisplayNum * 12
    if (uncappedCreate > MAX_ANNUAL_APR) {
      toast.error(
        loanFormInterestBankFinance
          ? `Annual interest % cannot exceed ${MAX_ANNUAL_APR}%`
          : `Monthly interest % is too high (×12 annual would exceed ${MAX_ANNUAL_APR}%)`
      )
      return
    }
    const createStoredAnnual = annualAprFromInterestFormInput(newRateTrim, loanFormInterestBankFinance)
    if (createStoredAnnual == null) {
      toast.error(
        loanFormInterestBankFinance
          ? 'Annual interest % could not be saved — check the value'
          : 'Monthly interest % could not be saved — check the value'
      )
      return
    }
    try {
      await api.post('/loans/', {
        direction: loanForm.direction,
        banking_model: loanForm.banking_model,
        product_type: loanForm.product_type,
        parent_loan_id:
          loanForm.product_type === 'islamic_deal' ? loanForm.parent_loan_id : undefined,
        deal_reference: loanForm.deal_reference.trim() || undefined,
        counterparty_id: loanForm.counterparty_id,
        title: loanForm.title,
        sanction_amount: loanForm.sanction_amount || '0',
        principal_account_id: loanForm.principal_account_id,
        settlement_account_id: loanForm.settlement_account_id,
        interest_account_id: loanForm.interest_account_id || null,
        interest_accrual_account_id: loanForm.interest_accrual_account_id || null,
        islamic_contract_variant: loanForm.islamic_contract_variant || '',
        status: 'draft',
        notes: loanForm.notes,
        agreement_no: loanForm.agreement_no.trim() || '',
        start_date: loanForm.start_date.trim() || null,
        maturity_date: loanForm.maturity_date.trim() || null,
        annual_interest_rate: createStoredAnnual,
        term_months: termParsed,
      })
      toast.success('Loan created')
      closeLoanModal()
      load()
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } }
      toast.error(err.response?.data?.detail || 'Create failed')
    }
  }

  const deleteLoan = async (row: LoanRow) => {
    const ok = window.confirm(
      `Delete loan ${row.loan_no}? Allowed only if there are no disbursements or repayments, no posted interest accruals, and (for an Islamic facility) no deal rows. Journal history is not removed by this screen.`
    )
    if (!ok) return
    try {
      await api.delete(`/loans/${row.id}/`)
      toast.success('Loan deleted')
      if (actionLoan?.id === row.id) setActionLoan(null)
      if (loanModalOpen && loanModalLoanId === row.id) closeLoanModal()
      load()
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } }
      toast.error(err.response?.data?.detail || 'Delete failed')
    }
  }

  const doDisburse = async () => {
    if (!actionLoan || !disbAmt) return
    try {
      await api.post(`/loans/${actionLoan.id}/disburse/`, {
        amount: disbAmt,
        post_to_gl: true,
      })
      toast.success(
        loanUsesIslamicTerminology(actionLoan)
          ? 'Financing disbursement posted to GL'
          : 'Disbursement posted to GL'
      )
      setActionLoan(null)
      setDisbAmt('')
      load()
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } }
      toast.error(err.response?.data?.detail || 'Disburse failed')
    }
  }

  const doRepay = async () => {
    if (!actionLoan || !repayAmt) return
    const p = parseFloat(repayPrin || '0')
    const i = parseFloat(repayInt || '0')
    const t = parseFloat(repayAmt)
    if (Math.abs(p + i - t) > 0.02) {
      toast.error(
        loanUsesIslamicTerminology(actionLoan)
          ? 'Principal + profit/return must equal total amount'
          : 'Principal + interest must equal total amount'
      )
      return
    }
    try {
      await api.post(`/loans/${actionLoan.id}/repay/`, {
        amount: repayAmt,
        principal_amount: repayPrin || '0',
        interest_amount: repayInt || '0',
        post_to_gl: true,
      })
      toast.success(
        actionLoan.direction === 'lent'
          ? 'Collection posted'
          : loanUsesIslamicTerminology(actionLoan)
            ? 'Payment posted'
            : 'Repayment posted'
      )
      setActionLoan(null)
      setRepayAmt('')
      setRepayPrin('')
      setRepayInt('')
      load()
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } }
      toast.error(err.response?.data?.detail || 'Repayment failed')
    }
  }

  useEffect(() => {
    if (!actionLoan || isIslamicFacilityHeader(actionLoan)) {
      setScheduleData(null)
      setScheduleErr('')
      setScheduleLoading(false)
      setInterestHint(null)
      setRepayAmt('')
      setRepayPrin('')
      setRepayInt('')
      return
    }
    if (Number(actionLoan.outstanding_principal) <= 0) {
      setScheduleData(null)
      setScheduleErr('')
      setScheduleLoading(false)
      setInterestHint(null)
      setRepayAmt('')
      setRepayPrin('')
      setRepayInt('')
      return
    }
    const loan = actionLoan
    const loanId = loan.id
    const outstanding = Number(loan.outstanding_principal ?? 0)
    let cancelled = false
    ;(async () => {
      setScheduleLoading(true)
      setScheduleErr('')
      setScheduleData(null)
      setInterestHint(null)
      setRepayAmt('')
      setRepayPrin('')
      setRepayInt('')

      let nextSchedule: ScheduleRemainingResponse | null = null
      let errMsg = ''
      try {
        const scheduleParams =
          loan.product_type === 'business_line'
            ? scheduleQuartersApplied != null
              ? { remaining_quarters: scheduleQuartersApplied }
              : undefined
            : scheduleRemainApplied != null
              ? { remaining_months: scheduleRemainApplied }
              : undefined
        const { data } = await api.get(`/loans/${loanId}/schedule-remaining/`, {
          params: scheduleParams,
        })
        nextSchedule = data as ScheduleRemainingResponse
      } catch (e) {
        errMsg = errDetail(e)
      }

      let nextHint: {
        simple_interest_estimate?: string
        days?: number
        note?: string
        interest_basis?: string
        interest_basis_label?: string
        financing_terminology?: 'islamic' | 'conventional'
      } | null = null
      try {
        const { data } = await api.get(`/loans/${loanId}/interest-hint/`, {
          params: { days: interestHintDays },
        })
        nextHint = data as typeof nextHint
      } catch {
        nextHint = null
      }

      if (cancelled) return

      setScheduleErr(errMsg)
      setScheduleData(nextSchedule)
      setInterestHint(nextHint)
      setScheduleLoading(false)

      const fill = computeAutoRepayFields(outstanding, nextSchedule, nextHint)
      setRepayAmt(fill.payment)
      setRepayPrin(fill.principal)
      setRepayInt(fill.interest)
    })()
    return () => {
      cancelled = true
    }
  }, [actionLoan, scheduleRemainApplied, scheduleQuartersApplied, interestHintDays])

  /** Undrawn sanction/limit — default disburse amount when opening the modal. */
  useEffect(() => {
    if (!actionLoan || isIslamicFacilityHeader(actionLoan)) {
      setDisbAmt('')
      setRepayAmt('')
      setRepayPrin('')
      setRepayInt('')
      return
    }
    const sanction = Number(actionLoan.sanction_amount ?? 0)
    const out = Number(actionLoan.outstanding_principal ?? 0)
    const undrawn = Math.max(0, sanction - out)
    setDisbAmt(undrawn > 0.0005 ? roundMoney2(undrawn) : '')
  }, [actionLoan])

  useEffect(() => {
    if (!actionLoan || isIslamicFacilityHeader(actionLoan)) {
      setLoanAccruals([])
      setLoanRepayments([])
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const { data } = await api.get(`/loans/${actionLoan.id}/`)
        if (!cancelled && data && typeof data === 'object') {
          if (Array.isArray((data as { interest_accruals?: unknown }).interest_accruals)) {
            setLoanAccruals(
              (data as { interest_accruals: typeof loanAccruals }).interest_accruals
            )
          } else setLoanAccruals([])
          if (Array.isArray((data as { repayments?: unknown }).repayments)) {
            setLoanRepayments(
              (data as { repayments: typeof loanRepayments }).repayments
            )
          } else setLoanRepayments([])
        }
      } catch {
        if (!cancelled) {
          setLoanAccruals([])
          setLoanRepayments([])
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [actionLoan])

  const mergeLoanDetailIntoActionRow = useCallback(
    (detail: Record<string, unknown>) => {
      setActionLoan((prev) => {
        if (!prev || Number(detail.id) !== prev.id) return prev
        return {
          ...prev,
          outstanding_principal: String(detail.outstanding_principal ?? prev.outstanding_principal),
          total_disbursed: String(detail.total_disbursed ?? prev.total_disbursed),
          total_repaid_principal: String(
            detail.total_repaid_principal ?? prev.total_repaid_principal ?? ''
          ),
          status: String(detail.status ?? prev.status),
        }
      })
    },
    []
  )

  const refreshLoanAccrualsAndRepayments = useCallback(async (loanId: number) => {
    try {
      const { data } = await api.get(`/loans/${loanId}/`)
      if (data && typeof data === 'object') {
        if (Array.isArray((data as { interest_accruals?: unknown }).interest_accruals)) {
          setLoanAccruals((data as { interest_accruals: typeof loanAccruals }).interest_accruals)
        }
        if (Array.isArray((data as { repayments?: unknown }).repayments)) {
          setLoanRepayments((data as { repayments: typeof loanRepayments }).repayments)
        }
      }
    } catch {
      setLoanAccruals([])
      setLoanRepayments([])
    }
  }, [])

  const applyScheduleRow = (row: { payment: string; principal: string; interest: string }) => {
    setRepayAmt(row.payment)
    setRepayPrin(row.principal)
    setRepayInt(row.interest)
  }

  const applyQuickRepayment = useCallback(
    (
      kind: 'interest_only' | 'principal_only' | 'full_payoff' | 'next_schedule'
    ) => {
      if (!actionLoan) return
      const out = Number(actionLoan.outstanding_principal ?? 0)
      if (kind === 'next_schedule') {
        const sn = scheduleData?.suggested_next
        if (sn) {
          setRepayAmt(sn.payment)
          setRepayPrin(sn.principal)
          setRepayInt(sn.interest)
          return
        }
        toast.error('No schedule line — set term/remaining periods or fix schedule errors above.')
        return
      }
      if (kind === 'interest_only') {
        if (scheduleData?.suggested_next) {
          const sn = scheduleData.suggested_next
          const intAmt = parseFloat(sn.interest)
          if (Number.isFinite(intAmt) && intAmt > 0) {
            setRepayPrin('0.00')
            setRepayInt(roundMoney2(intAmt))
            setRepayAmt(roundMoney2(intAmt))
            return
          }
        }
        const est = interestHint?.simple_interest_estimate
        if (est == null || est === '') {
          toast.error(
            'Set Days (above) so interest can be estimated, or load a schedule with a next period.'
          )
          return
        }
        const i = Number(est)
        if (!Number.isFinite(i) || i <= 0) {
          toast.error(
            loanUsesIslamicTerminology(actionLoan)
              ? 'Profit/return for this period is zero — check rate or days.'
              : 'Interest for this period is zero — check rate or days.'
          )
          return
        }
        setRepayPrin('0.00')
        setRepayInt(roundMoney2(i))
        setRepayAmt(roundMoney2(i))
        return
      }
      if (kind === 'principal_only') {
        if (out <= 0) return
        setRepayPrin(roundMoney2(out))
        setRepayInt('0.00')
        setRepayAmt(roundMoney2(out))
        return
      }
      if (kind === 'full_payoff') {
        if (out <= 0) return
        const intEst =
          interestHint?.simple_interest_estimate != null
            ? Number(interestHint.simple_interest_estimate)
            : 0
        const i = Number.isFinite(intEst) && intEst > 0 ? intEst : 0
        setRepayPrin(roundMoney2(out))
        setRepayInt(roundMoney2(i))
        setRepayAmt(roundMoney2(out + i))
      }
    },
    [actionLoan, scheduleData, interestHint, toast]
  )

  const downloadPaymentScheduleCsv = () => {
    if (!actionLoan || !scheduleData?.schedule?.length) return
    const isl = loanUsesIslamicTerminology(actionLoan)
    const role =
      scheduleData.schedule_sheet?.role ?? (actionLoan.direction === 'lent' ? 'receivable' : 'payable')
    const totalHdr = role === 'receivable' ? 'total_collect' : 'total_pay'
    const piHdr = isl ? 'profit_return' : 'interest'
    const esc = csvEscapeCell
    const lines = scheduleData.schedule.map((row) =>
      [
        String(row.period_label ?? row.period),
        row.payment,
        row.principal,
        row.interest,
        row.closing_balance ?? '',
      ]
        .map((v) => esc(String(v ?? '')))
        .join(',')
    )
    const header = ['period', totalHdr, 'principal', piHdr, 'principal_balance_after'].join(',')
    const meta = [
      `# loan_no=${esc(actionLoan.loan_no)}`,
      `# direction=${esc(actionLoan.direction)}`,
      `# schedule_role=${role}`,
      `# currency_symbol=${esc(currencySymbol)}`,
    ].join('\n')
    const csv = [meta, header, ...lines].join('\n')
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `loan-payment-schedule-${actionLoan.loan_no.replace(/[^\w.-]+/g, '_')}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const printPaymentScheduleSheet = () => {
    if (!actionLoan || !scheduleData?.schedule?.length) return
    const isl = loanUsesIslamicTerminology(actionLoan)
    const role =
      scheduleData.schedule_sheet?.role ?? (actionLoan.direction === 'lent' ? 'receivable' : 'payable')
    const intCol = isl ? 'Profit / return' : 'Interest'
    const totalCol = role === 'receivable' ? 'Total you collect' : 'Total you pay'
    const title =
      role === 'receivable'
        ? `Payment schedule (receivable) — ${actionLoan.loan_no}`
        : `Payment schedule (payable) — ${actionLoan.loan_no}`
    const sub =
      role === 'receivable'
        ? 'Cash you receive when the borrower pays (money you lent).'
        : 'Cash you pay toward this loan (money you borrowed).'
    const rowsHtml = scheduleData.schedule
      .map(
        (row) =>
          `<tr>
            <td>${escapeHtml(String(row.period_label ?? row.period))}${
              row.days_in_period != null ? ` <span class="muted">(${row.days_in_period}d)</span>` : ''
            }</td>
            <td class="right">${escapeHtml(row.payment)}</td>
            <td class="right">${escapeHtml(row.principal)}</td>
            <td class="right">${escapeHtml(row.interest)}</td>
            <td class="right">${escapeHtml(row.closing_balance ?? '')}</td>
          </tr>`
      )
      .join('')
    printDocument({
      title,
      bodyHtml: `
        <div class="period">${escapeHtml(sub)}</div>
        <p class="co"><span class="label">Outstanding principal (now):</span> ${escapeHtml(
          String(scheduleData.outstanding_principal ?? actionLoan.outstanding_principal)
        )} &nbsp;|&nbsp; <span class="label">Basis:</span> ${escapeHtml(
          scheduleData.interest_basis_label || ''
        )}</p>
        <table>
          <thead>
            <tr>
              <th>Period</th>
              <th class="right">${escapeHtml(totalCol)}</th>
              <th class="right">Principal</th>
              <th class="right">${escapeHtml(intCol)}</th>
              <th class="right">Balance after</th>
            </tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
        </table>
        ${scheduleData.method_note ? `<p class="muted">${escapeHtml(scheduleData.method_note)}</p>` : ''}
      `,
    })
  }

  const openLoanStatement = async (row: LoanRow) => {
    setStatementLoan(row)
    setStatementPayload(null)
    setStatementLoading(true)
    try {
      const { data } = await api.get(`/loans/${row.id}/statement/`)
      setStatementPayload(data as LoanStatementResponse)
    } catch (e) {
      toast.error(errDetail(e))
      setStatementLoan(null)
    } finally {
      setStatementLoading(false)
    }
  }

  const postLoanAccrual = async () => {
    if (!actionLoan) return
    const body: Record<string, string | number | boolean | null> = {
      post_to_gl: true,
      memo: accrualMemo.trim() || '',
    }
    if (accrualDate.trim()) body.accrual_date = accrualDate.trim()
    if (accrualAmount.trim()) {
      body.amount = accrualAmount.trim()
    } else {
      const d = parseInt(accrualDays, 10)
      body.days = Number.isFinite(d) ? Math.max(1, Math.min(3660, d)) : 30
    }
    try {
      await api.post(`/loans/${actionLoan.id}/accrue-interest/`, body)
      toast.success(
        loanUsesIslamicTerminology(actionLoan) ? 'Profit accrual posted' : 'Interest accrual posted'
      )
      setAccrualAmount('')
      await refreshLoanAccrualsAndRepayments(actionLoan.id)
      load()
    } catch (e) {
      toast.error(errDetail(e))
    }
  }

  const reverseLoanRepayment = async (repaymentId: number) => {
    if (!actionLoan) return
    const ok = window.confirm(
      'Post a reversing journal entry and restore principal on this loan? This undoes the repayment in the general ledger and on the loan balance.'
    )
    if (!ok) return
    try {
      const { data } = await api.post(`/loans/${actionLoan.id}/repayments/${repaymentId}/reverse/`, {})
      toast.success('Repayment reversed')
      const payload = data as { loan?: Record<string, unknown> }
      if (payload.loan) mergeLoanDetailIntoActionRow(payload.loan)
      await refreshLoanAccrualsAndRepayments(actionLoan.id)
      load()
    } catch (e) {
      toast.error(errDetail(e))
    }
  }

  const reverseLoanAccrual = async (accrualId: number) => {
    if (!actionLoan) return
    const ok = window.confirm('Post reversing journal entry for this accrual?')
    if (!ok) return
    try {
      await api.post(`/loans/${actionLoan.id}/accruals/${accrualId}/reverse/`, { post_to_gl: true })
      toast.success('Accrual reversed')
      await refreshLoanAccrualsAndRepayments(actionLoan.id)
      load()
    } catch (e) {
      toast.error(errDetail(e))
    }
  }

  const downloadLoanStatementCsv = () => {
    if (!statementPayload) return
    const isl =
      statementPayload.financing_terminology === 'islamic' ||
      loanUsesIslamicTerminology(statementPayload.loan)
    const headerLabels = [
      'date',
      'type',
      'reference',
      'disbursement',
      'repayment_total',
      'principal',
      isl ? 'profit_or_return' : 'interest',
      'outstanding_principal_after',
    ]
    const esc = (v: string) => {
      const s = String(v ?? '')
      if (s.includes(',') || s.includes('"') || s.includes('\n')) return `"${s.replace(/"/g, '""')}"`
      return s
    }
    const rows = statementPayload.lines.map((line) =>
      [
        line.date,
        line.kind_label ?? statementKindLabel(line.kind, isl),
        line.reference,
        line.disbursement,
        line.repayment_total,
        line.principal,
        line.interest,
        line.outstanding_principal_after,
      ]
        .map((v) => esc(String(v ?? '')))
        .join(',')
    )
    const csv = [headerLabels.join(','), ...rows].join('\n')
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `loan-statement-${statementPayload.loan.loan_no}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const loanPortfolioSummary = useMemo(() => {
    let borrowedOutstanding = 0
    let lentOutstanding = 0
    let activeCount = 0
    let draftCount = 0
    let closedCount = 0
    for (const l of loans) {
      const o = Number(outstandingDisplayed(l))
      if (l.direction === 'borrowed') borrowedOutstanding += o
      else if (l.direction === 'lent') lentOutstanding += o
      if (l.status === 'active') activeCount += 1
      else if (l.status === 'draft') draftCount += 1
      else if (l.status === 'closed') closedCount += 1
    }
    return {
      borrowedOutstanding,
      lentOutstanding,
      activeCount,
      draftCount,
      closedCount,
      registerCount: loans.length,
    }
  }, [loans])

  const filteredLoans = useMemo(() => {
    const q = loanRegisterQuery.trim().toLowerCase()
    return loans.filter((row) => {
      if (loanFilterDirection !== 'all' && row.direction !== loanFilterDirection) return false
      if (loanFilterStatus !== 'all' && row.status !== loanFilterStatus) return false
      if (!q) return true
      const party =
        counterpartiesAll.find((c) => c.id === row.counterparty_id)?.name?.toLowerCase() ?? ''
      const blob = [
        row.loan_no,
        row.title || '',
        row.deal_reference || '',
        row.parent_loan_no || '',
        party,
        productTypeLabel(row.product_type),
        row.status,
      ]
        .join(' ')
        .toLowerCase()
      return blob.includes(q)
    })
  }, [loans, loanRegisterQuery, loanFilterDirection, loanFilterStatus, counterpartiesAll])

  const cpName = (id: number) => counterpartiesAll.find((c) => c.id === id)?.name || `#${id}`

  return (
    <div className="flex min-h-screen bg-[#f0f2f6]">
      <Sidebar />
      <main className="flex-1 p-5 sm:p-7 lg:p-8 overflow-auto">
        <div className="max-w-7xl mx-auto space-y-6">
          {/* Hero + actions */}
          <div className="rounded-2xl border border-slate-200/90 bg-white shadow-sm overflow-hidden">
            <div className="bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 px-5 sm:px-8 py-7 text-white">
              <div className="flex flex-col xl:flex-row xl:items-start xl:justify-between gap-6">
                <div className="flex gap-4 min-w-0">
                  <div
                    className="shrink-0 h-14 w-14 rounded-2xl bg-white/10 flex items-center justify-center ring-1 ring-white/15"
                    aria-hidden
                  >
                    <Landmark className="h-7 w-7 text-amber-300" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400 mb-1.5">
                      General ledger · Borrowings &amp; advances
                    </p>
                    <h1 className="text-2xl sm:text-[1.75rem] font-semibold tracking-tight leading-tight">
                      Loans &amp; financing register
                    </h1>
                    <p className="mt-3 text-sm text-slate-300 max-w-3xl leading-relaxed">
                      Record bank and non-bank facilities with full double-entry: principal, settlement (bank/cash),
                      interest or Islamic profit recognition, optional accruals, and auditable statements (print / CSV).
                      Conventional and Shariah-labelled products share the same GL discipline; always reconcile to your
                      facility letter and regulator reporting (e.g. Bangladesh Bank returns where applicable).
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => load()}
                    className="inline-flex items-center gap-2 px-3.5 py-2.5 rounded-xl border border-white/20 bg-white/5 text-sm font-medium text-white hover:bg-white/10 transition-colors"
                  >
                    <RefreshCw className="h-4 w-4" />
                    Refresh
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowCp(true)}
                    className="inline-flex items-center gap-2 px-3.5 py-2.5 rounded-xl border border-white/20 bg-white/5 text-sm font-medium text-white hover:bg-white/10 transition-colors"
                  >
                    <Users className="h-4 w-4" />
                    Counterparty
                  </button>
                  <button
                    type="button"
                    onClick={openNewLoanModal}
                    className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-amber-400 text-slate-900 text-sm font-semibold hover:bg-amber-300 shadow-md transition-colors"
                  >
                    <Plus className="h-4 w-4" />
                    New loan
                  </button>
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-4 divide-y lg:divide-y-0 lg:divide-x divide-slate-100 bg-white">
              <div className="p-4 sm:p-5">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Register</p>
                <p className="mt-1.5 text-2xl font-semibold tabular-nums text-slate-900">
                  {loanPortfolioSummary.registerCount}
                </p>
                <p className="text-xs text-slate-500 mt-1">
                  {loanPortfolioSummary.activeCount} active · {loanPortfolioSummary.draftCount} draft ·{' '}
                  {loanPortfolioSummary.closedCount} closed
                </p>
              </div>
              <div className="p-4 sm:p-5">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 flex items-center gap-1.5">
                  <TrendingDown className="h-3.5 w-3.5 text-rose-600" aria-hidden />
                  Borrowed O/S
                </p>
                <p className="mt-1.5 text-xl sm:text-2xl font-semibold tabular-nums text-slate-900 leading-tight">
                  {formatMoneyAmount(String(loanPortfolioSummary.borrowedOutstanding), currencySymbol)}
                </p>
                <p className="text-xs text-slate-500 mt-1">Loans payable — principal</p>
              </div>
              <div className="p-4 sm:p-5">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 flex items-center gap-1.5">
                  <TrendingUp className="h-3.5 w-3.5 text-emerald-700" aria-hidden />
                  Lent O/S
                </p>
                <p className="mt-1.5 text-xl sm:text-2xl font-semibold tabular-nums text-slate-900 leading-tight">
                  {formatMoneyAmount(String(loanPortfolioSummary.lentOutstanding), currencySymbol)}
                </p>
                <p className="text-xs text-slate-500 mt-1">Loans receivable — principal</p>
              </div>
              <div className="p-4 sm:p-5 col-span-2 lg:col-span-1">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 flex items-center gap-1.5">
                  <BookOpen className="h-3.5 w-3.5 text-slate-600" aria-hidden />
                  Workflow
                </p>
                <p className="mt-2 text-sm text-slate-600 leading-snug">
                  <span className="font-medium text-slate-800">Statement</span> — activity &amp; balance.{' '}
                  <span className="font-medium text-slate-800">Disburse / Repay</span> — cash, EMI schedule, estimates.
                </p>
              </div>
            </div>
          </div>

          <details className="group rounded-xl border border-amber-200/90 bg-amber-50/40 text-sm text-amber-950 shadow-sm open:ring-1 open:ring-amber-200/50">
            <summary className="cursor-pointer list-none px-4 py-3.5 font-medium flex items-center justify-between gap-2 hover:bg-amber-50/80 rounded-xl [&::-webkit-details-marker]:hidden">
              <span className="flex items-center gap-2">
                <Scale className="h-4 w-4 shrink-0 opacity-85" aria-hidden />
                Chart of accounts — template GL codes
              </span>
              <span className="text-xs font-normal text-amber-800/90">Expand</span>
            </summary>
            <div className="px-4 pb-4 pt-0 border-t border-amber-100/90">
              <p className="pt-3 leading-relaxed">
                The fuel-station template includes <strong>2410</strong> Loans Payable (borrowed principal),{' '}
                <strong>1160</strong> Loans Receivable (lent principal), <strong>1030</strong> Bank — Operating
                (settlement), <strong>6620</strong> interest expense (borrowed), and <strong>4410</strong> interest
                income (lent). Run{' '}
                <code className="text-xs bg-amber-100/90 px-1.5 py-0.5 rounded font-mono">python manage.py migrate</code>{' '}
                if those codes are missing. Other valid mapped accounts may be used.
              </p>
            </div>
          </details>

          <details className="group rounded-xl border border-slate-200 bg-white text-sm text-slate-800 shadow-sm">
            <summary className="cursor-pointer list-none px-4 py-3.5 font-medium flex items-center justify-between gap-2 hover:bg-slate-50 rounded-xl [&::-webkit-details-marker]:hidden">
              <span className="flex items-center gap-2">
                <Shield className="h-4 w-4 shrink-0 text-slate-500" aria-hidden />
                Products, EMI &amp; day-count (accounting methodology)
              </span>
              <span className="text-xs font-normal text-slate-500">Expand</span>
            </summary>
            <div className="px-4 pb-4 pt-0 border-t border-slate-100 space-y-3 leading-relaxed">
              <p className="pt-3">
                <strong>Term loan</strong> — set <strong>term (months)</strong> and rate. Bank / finance counterparties:
                <strong> annual %</strong>; other parties: <strong>monthly %</strong> (stored as ×12). Schedules use{' '}
                <strong>reducing-balance EMI</strong> (industry-standard amortization).
              </p>
              <p>
                <strong>Business line</strong> — revolving limit; schedule shows <strong>quarterly interest</strong> on
                drawn balance (bank/finance actual/365; others 30/360).
              </p>
              <p>
                <strong>Islamic facility / deal</strong> — facility is the limit; deals carry cash movement. Profit/return
                posts parallel to interest for GL clarity.
              </p>
              <p>
                <strong>Zero rate</strong> — enter <strong>0</strong> for principal-only movement. Set counterparty{' '}
                <strong>Type</strong> correctly for day-count rules.
              </p>
            </div>
          </details>

          {!loading && (
            <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
              <div className="px-4 sm:px-5 py-4 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 bg-slate-50/60">
                <div className="flex items-start gap-3">
                  <Users className="h-5 w-5 text-slate-600 shrink-0 mt-0.5" aria-hidden />
                  <div>
                    <h2 className="text-base font-semibold text-slate-900">Counterparties</h2>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Master data for lenders, borrowers, and other parties. Names unique; deletion blocked if used on a
                      loan.
                    </p>
                  </div>
                </div>
                <span className="text-xs font-medium text-slate-500 tabular-nums self-start sm:self-center">
                  {counterpartiesAll.length} record{counterpartiesAll.length === 1 ? '' : 's'}
                </span>
              </div>
              {counterpartiesAll.length === 0 ? (
                <div className="p-8 text-center">
                  <p className="text-sm text-slate-600">No counterparties yet.</p>
                  <button
                    type="button"
                    onClick={() => setShowCp(true)}
                    className="mt-3 inline-flex items-center gap-2 text-sm font-medium text-indigo-600 hover:text-indigo-800"
                  >
                    <Plus className="h-4 w-4" />
                    Add counterparty
                  </button>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead className="bg-slate-50 text-left text-slate-700">
                      <tr>
                        <th className="px-4 py-3 font-semibold">Code</th>
                        <th className="px-4 py-3 font-semibold">Name</th>
                        <th className="px-4 py-3 font-semibold">Type</th>
                        <th className="px-4 py-3 font-semibold">Status</th>
                        <th className="px-4 py-3 font-semibold text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {counterpartiesAll.map((c) => (
                        <tr key={c.id} className="hover:bg-slate-50/80 transition-colors">
                          <td className="px-4 py-2.5 font-mono text-slate-800">{c.code}</td>
                          <td className="px-4 py-2.5 text-slate-900 font-medium">{c.name}</td>
                          <td className="px-4 py-2.5 text-slate-700">{formatRoleType(c.role_type)}</td>
                          <td className="px-4 py-2.5">
                            <span
                              className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                                c.is_active
                                  ? 'bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200/80'
                                  : 'bg-slate-100 text-slate-600'
                              }`}
                            >
                              {c.is_active ? 'Active' : 'Inactive'}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-right whitespace-nowrap space-x-3">
                            <button
                              type="button"
                              onClick={() => openEditCounterparty(c)}
                              className="inline-flex items-center gap-1 text-sm font-medium text-indigo-600 hover:text-indigo-800"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => deleteCounterparty(c)}
                              className="inline-flex items-center gap-1 text-sm font-medium text-red-600 hover:text-red-800"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                              Delete
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {loading ? (
            <div className="rounded-xl border border-slate-200 bg-white p-12 text-center shadow-sm">
              <RefreshCw className="h-8 w-8 text-slate-300 mx-auto mb-3 animate-spin" aria-hidden />
              <p className="text-sm text-slate-600">Loading loan register…</p>
            </div>
          ) : loans.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center shadow-sm">
              <Landmark className="h-10 w-10 text-slate-300 mx-auto mb-3" aria-hidden />
              <p className="text-slate-800 font-medium">No facilities in the register</p>
              <p className="text-sm text-slate-500 mt-2 max-w-md mx-auto">
                Add a counterparty, create a loan (draft), then post disbursements when funds move. Statements and
                amortization tools unlock after activity.
              </p>
              <div className="mt-6 flex flex-wrap justify-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowCp(true)}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-slate-300 text-sm font-medium text-slate-800 hover:bg-slate-50"
                >
                  <Users className="h-4 w-4" />
                  Add counterparty
                </button>
                <button
                  type="button"
                  onClick={openNewLoanModal}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700"
                >
                  <Plus className="h-4 w-4" />
                  New loan
                </button>
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
              <div className="px-4 sm:px-5 py-4 border-b border-slate-100 flex flex-col gap-4 bg-slate-50/60">
                <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
                  <div>
                    <h2 className="text-base font-semibold text-slate-900">Loan register</h2>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Filter and search; amounts in {currencySymbol} (company currency).
                    </p>
                  </div>
                  <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
                    <div className="relative flex-1 min-w-[12rem]">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" aria-hidden />
                      <input
                        type="search"
                        placeholder="Search loan #, party, product…"
                        className="w-full pl-9 pr-3 py-2 rounded-xl border border-slate-200 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-400"
                        value={loanRegisterQuery}
                        onChange={(e) => setLoanRegisterQuery(e.target.value)}
                        aria-label="Search loans"
                      />
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-500">
                        <Filter className="h-3.5 w-3.5" aria-hidden />
                        Direction
                      </span>
                      {(['all', 'borrowed', 'lent'] as const).map((d) => (
                        <button
                          key={d}
                          type="button"
                          onClick={() => setLoanFilterDirection(d)}
                          className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                            loanFilterDirection === d
                              ? 'bg-slate-900 text-white'
                              : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'
                          }`}
                        >
                          {d === 'all' ? 'All' : d === 'borrowed' ? 'Borrowed' : 'Lent'}
                        </button>
                      ))}
                      <select
                        className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                        value={loanFilterStatus}
                        onChange={(e) => setLoanFilterStatus(e.target.value as typeof loanFilterStatus)}
                        aria-label="Filter by status"
                      >
                        <option value="all">All statuses</option>
                        <option value="draft">Draft</option>
                        <option value="active">Active</option>
                        <option value="closed">Closed</option>
                      </select>
                    </div>
                  </div>
                </div>
                {filteredLoans.length !== loans.length && (
                  <p className="text-xs text-slate-500">
                    Showing <strong className="text-slate-700">{filteredLoans.length}</strong> of {loans.length} facilities
                  </p>
                )}
              </div>
              {filteredLoans.length === 0 ? (
                <div className="p-10 text-center text-sm text-slate-600">
                  No loans match your search or filters.{' '}
                  <button
                    type="button"
                    className="font-medium text-indigo-600 hover:underline"
                    onClick={() => {
                      setLoanRegisterQuery('')
                      setLoanFilterDirection('all')
                      setLoanFilterStatus('all')
                    }}
                  >
                    Clear filters
                  </button>
                </div>
              ) : (
                <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-100 text-left text-slate-800 sticky top-0 z-[1] shadow-[0_1px_0_0_rgb(226_232_240)]">
                  <tr>
                    <th className="px-3 py-3 font-semibold whitespace-nowrap">Loan #</th>
                    <th className="px-3 py-3 font-semibold whitespace-nowrap">Product</th>
                    <th className="px-3 py-3 font-semibold whitespace-nowrap">Direction</th>
                    <th className="px-3 py-3 font-semibold">Party</th>
                    <th className="px-3 py-3 font-semibold text-right whitespace-nowrap">Limit / sanction</th>
                    <th className="px-3 py-3 font-semibold text-right whitespace-nowrap">Outstanding</th>
                    <th className="px-3 py-3 font-semibold text-right whitespace-nowrap">Disbursed</th>
                    <th className="px-3 py-3 font-semibold text-right whitespace-nowrap">Repaid princ.</th>
                    <th className="px-3 py-3 font-semibold whitespace-nowrap">Link</th>
                    <th className="px-3 py-3 font-semibold whitespace-nowrap">Status</th>
                    <th className="px-3 py-3 font-semibold text-right whitespace-nowrap">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredLoans.map((row) => {
                    const outS = outstandingDisplayed(row)
                    const util = utilisationPercent(row)
                    const facDeals = row.facility_deal_count ?? 0
                    const deleteBlocked =
                      loanHasMoneyMovement(row) ||
                      (isIslamicFacilityHeader(row) && facDeals > 0)
                    return (
                      <tr key={row.id} className="hover:bg-slate-50/90 align-top transition-colors">
                        <td className="px-3 py-3 font-mono font-medium whitespace-nowrap">{row.loan_no}</td>
                        <td className="px-3 py-3">
                          <div className="flex flex-col gap-0.5">
                            <span
                              className="inline-flex w-fit rounded px-1.5 py-0.5 text-xs font-medium bg-indigo-50 text-indigo-900 border border-indigo-100"
                              title={productTypeLabel(row.product_type)}
                            >
                              {productTypeLabel(row.product_type)}
                            </span>
                            {row.banking_model === 'islamic' && (
                              <span className="text-xs text-emerald-800">Islamic banking</span>
                            )}
                            {row.islamic_contract_variant ? (
                              <span className="text-xs text-gray-600 capitalize">
                                {row.islamic_contract_variant.replace(/_/g, ' ')}
                              </span>
                            ) : null}
                            {util != null && (row.product_type === 'business_line' || row.product_type === 'general') && (
                              <span className="text-xs text-gray-500">Util {util}</span>
                            )}
                            {isIslamicFacilityHeader(row) && facDeals > 0 && (
                              <span className="text-xs text-gray-500">{facDeals} deal(s)</span>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-3 capitalize whitespace-nowrap">{row.direction}</td>
                        <td className="px-3 py-3 max-w-[12rem] break-words">
                          <span className="text-gray-900">{cpName(row.counterparty_id)}</span>
                          {(() => {
                            const line = loanInterestBasisLine(row)
                            return (
                              <p className="text-xs text-gray-500 mt-0.5 normal-case" title={line.title}>
                                {line.short}
                              </p>
                            )
                          })()}
                        </td>
                        <td className="px-3 py-3 text-right whitespace-nowrap tabular-nums">
                          {formatMoneyAmount(row.sanction_amount, currencySymbol)}
                          {isIslamicFacilityHeader(row) && row.facility_available_limit != null && (
                            <div className="text-xs text-gray-500 font-normal">
                              Avail {formatMoneyAmount(row.facility_available_limit, currencySymbol)}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-3 text-right whitespace-nowrap tabular-nums font-medium">
                          {formatMoneyAmount(outS, currencySymbol)}
                        </td>
                        <td className="px-3 py-3 text-right whitespace-nowrap tabular-nums">
                          {formatMoneyAmount(row.total_disbursed, currencySymbol)}
                        </td>
                        <td className="px-3 py-3 text-right whitespace-nowrap tabular-nums">
                          {formatMoneyAmount(row.total_repaid_principal, currencySymbol)}
                        </td>
                        <td className="px-3 py-3 text-xs text-gray-700 max-w-[9rem] break-words">
                          {(row.product_type === 'islamic_deal' && row.parent_loan_no) || row.deal_reference ? (
                            <>
                              {row.product_type === 'islamic_deal' && row.parent_loan_no ? (
                                <div title="Parent facility">↳ {row.parent_loan_no}</div>
                              ) : null}
                              {row.deal_reference ? (
                                <div className="text-gray-500">{row.deal_reference}</div>
                              ) : null}
                            </>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="px-3 py-3 capitalize whitespace-nowrap">{row.status}</td>
                        <td className="px-3 py-3 text-right">
                          <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1">
                            <button
                              type="button"
                              className="text-indigo-600 hover:underline text-sm disabled:opacity-40 disabled:pointer-events-none"
                              disabled={isIslamicFacilityHeader(row) || row.status === 'closed'}
                              title={
                                isIslamicFacilityHeader(row)
                                  ? 'Use Islamic deal rows for disbursement and repayment'
                                  : row.status === 'closed'
                                    ? 'Reopen the loan (Edit → Active) before disburse / repay'
                                    : 'Disburse or repay'
                              }
                              onClick={() => {
                                setActionLoan(row)
                                setDisbAmt('')
                                setRepayAmt('')
                                setRepayPrin('')
                                setRepayInt('')
                                setScheduleRemainApplied(null)
                                setScheduleRemainInput('')
                                setScheduleQuartersApplied(null)
                                setScheduleQuartersInput('')
                                setInterestHintDays(row.product_type === 'business_line' ? 91 : 30)
                              }}
                            >
                              Disburse / Repay
                            </button>
                            <button
                              type="button"
                              onClick={() => openLoanStatement(row)}
                              className="inline-flex items-center gap-1 text-gray-700 hover:text-indigo-600 text-sm"
                              title="Loan activity & running balance"
                            >
                              <FileText className="h-3.5 w-3.5" />
                              Statement
                            </button>
                            <button
                              type="button"
                              onClick={() => openEditLoan(row)}
                              className="inline-flex items-center gap-1 text-gray-700 hover:text-indigo-600 text-sm"
                              title={
                                row.status === 'closed'
                                  ? 'Edit — set status to Active to reopen (closing does not post GL)'
                                  : 'Edit loan'
                              }
                            >
                              <Pencil className="h-3.5 w-3.5" />
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => deleteLoan(row)}
                              disabled={deleteBlocked}
                              className="inline-flex items-center gap-1 text-red-600 hover:underline text-sm disabled:opacity-40 disabled:pointer-events-none"
                              title={
                                deleteBlocked
                                  ? 'Delete only when there are no deals (facilities), disbursements, or repayments'
                                  : 'Delete loan'
                              }
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
                </div>
              )}
            </div>
          )}
        </div>

        {showCp && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-lg font-semibold">New counterparty</h2>
                <button type="button" onClick={() => setShowCp(false)} className="text-gray-400 hover:text-gray-600">
                  <X className="h-5 w-5" />
                </button>
              </div>
              <form onSubmit={submitCounterparty} className="space-y-3">
                <p className="text-sm text-gray-500">
                  A short code (e.g. CP-00001) is assigned automatically when you save.
                </p>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
                  <input
                    className="w-full border rounded-lg px-3 py-2"
                    value={cpForm.name}
                    onChange={(e) => setCpForm({ ...cpForm, name: e.target.value })}
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
                  <p className="text-xs text-gray-500 mb-1">
                    Only <strong>Bank</strong> and <strong>Finance company</strong> use annual (actual/365) interest
                    estimates; all other types use monthly-style (30/360). Pick the party that matches the lender /
                    borrower.
                  </p>
                  <select
                    className="w-full border rounded-lg px-3 py-2"
                    value={cpForm.role_type}
                    onChange={(e) => setCpForm({ ...cpForm, role_type: e.target.value })}
                  >
                    {CP_ROLE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
                <button type="submit" className="w-full py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700">
                  Save
                </button>
              </form>
            </div>
          </div>
        )}

        {cpEditId != null && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-lg font-semibold">Edit counterparty</h2>
                <button type="button" onClick={closeEditCounterparty} className="text-gray-400 hover:text-gray-600">
                  <X className="h-5 w-5" />
                </button>
              </div>
              <form onSubmit={submitEditCounterparty} className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Code</label>
                  <input
                    className="w-full border rounded-lg px-3 py-2 bg-gray-50 text-gray-600"
                    value={cpEditForm.code}
                    readOnly
                    disabled
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
                  <input
                    className="w-full border rounded-lg px-3 py-2"
                    value={cpEditForm.name}
                    onChange={(e) => setCpEditForm({ ...cpEditForm, name: e.target.value })}
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
                  <p className="text-xs text-gray-500 mb-1">
                    Bank / Finance company → annual (/365) interest hints; other types → monthly (/360).
                  </p>
                  <select
                    className="w-full border rounded-lg px-3 py-2"
                    value={cpEditForm.role_type}
                    onChange={(e) => setCpEditForm({ ...cpEditForm, role_type: e.target.value })}
                  >
                    {CP_ROLE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={cpEditForm.is_active}
                    onChange={(e) => setCpEditForm({ ...cpEditForm, is_active: e.target.checked })}
                  />
                  Active (inactive parties are hidden from the new-loan dropdown)
                </label>
                <button type="submit" className="w-full py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700">
                  Save changes
                </button>
              </form>
            </div>
          </div>
        )}

        {loanModalOpen && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4 overflow-y-auto">
            <div className="bg-white rounded-lg shadow-xl max-w-lg w-full p-6 my-8">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-lg font-semibold">
                  {loanModalMode === 'new' ? 'New loan' : 'Edit loan'}
                </h2>
                <button
                  type="button"
                  onClick={closeLoanModal}
                  className="text-gray-400 hover:text-gray-600 rounded p-1"
                  aria-label="Close"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              {loanModalLoading ? (
                <p className="text-gray-500 py-8 text-center">Loading…</p>
              ) : (
                <form onSubmit={submitLoanModal} className="space-y-3">
                  {loanModalMode === 'edit' && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Loan #</label>
                      <input
                        className="w-full border rounded-lg px-3 py-2 bg-gray-50 text-gray-600"
                        value={loanForm.loan_no}
                        readOnly
                        disabled
                      />
                    </div>
                  )}
                  {loanModalMode === 'edit' && loanModalHasActivity && (
                    <div className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3">
                      This loan has disbursements, repayments, or posted interest accruals. You can only update{' '}
                      <strong>title</strong>, <strong>notes</strong>, <strong>maturity date</strong>, and{' '}
                      <strong>status</strong> — not direction, product type, banking model, counterparty, or GL
                      accounts (those would conflict with posted journals).
                    </div>
                  )}
                  {loanModalMode === 'edit' && loanEditInitiallyClosed && (
                    <div className="text-sm text-sky-900 bg-sky-50 border border-sky-200 rounded-lg p-3">
                      This loan is marked <strong>closed</strong>. Setting status to <strong>Active</strong> (or{' '}
                      <strong>Draft</strong>) reopens it in the list only — no bank or GL entries are created or reversed
                      by that change. If you had posted real repayments, use <strong>Statement</strong> and your GL /
                      journals to review; mistaken <strong>closed</strong> status alone does not settle cash.
                    </div>
                  )}
                  {(loanModalMode === 'new' || (!loanModalHasActivity && !loanEditInitiallyClosed)) && (
                    <>
                      <div>
                        <span className="block text-sm font-medium text-gray-700 mb-2">
                          Direction — who is the borrower?
                        </span>
                        <div
                          className="grid grid-cols-1 sm:grid-cols-2 gap-2"
                          role="group"
                          aria-label="Loan direction"
                        >
                          <button
                            type="button"
                            onClick={() =>
                              setLoanForm((prev) => ({
                                ...prev,
                                direction: 'borrowed',
                                principal_account_id: 0,
                                interest_account_id: 0,
                                interest_accrual_account_id: 0,
                                parent_loan_id: 0,
                              }))
                            }
                            className={`rounded-lg border px-3 py-3 text-left text-sm transition-colors ${
                              loanForm.direction === 'borrowed'
                                ? 'border-indigo-600 bg-indigo-50 ring-2 ring-indigo-500/30'
                                : 'border-gray-200 bg-white hover:bg-gray-50'
                            }`}
                          >
                            <span className="font-medium text-gray-900">We borrowed</span>
                            <span className="block text-gray-600 mt-0.5">
                              Funds from a bank or lender — we owe principal (loans payable).
                            </span>
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setLoanForm((prev) => ({
                                ...prev,
                                direction: 'lent',
                                principal_account_id: 0,
                                interest_account_id: 0,
                                interest_accrual_account_id: 0,
                                parent_loan_id: 0,
                              }))
                            }
                            className={`rounded-lg border px-3 py-3 text-left text-sm transition-colors ${
                              loanForm.direction === 'lent'
                                ? 'border-indigo-600 bg-indigo-50 ring-2 ring-indigo-500/30'
                                : 'border-gray-200 bg-white hover:bg-gray-50'
                            }`}
                          >
                            <span className="font-medium text-gray-900">We lent / gave a loan</span>
                            <span className="block text-gray-600 mt-0.5">
                              We advanced money — counterparty owes us (loans receivable).
                            </span>
                          </button>
                        </div>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Banking model</label>
                        <select
                          className="w-full border rounded-lg px-3 py-2"
                          value={loanForm.banking_model}
                          onChange={(e) =>
                            setLoanForm({
                              ...loanForm,
                              banking_model: e.target.value as 'conventional' | 'islamic',
                              islamic_contract_variant:
                                e.target.value === 'islamic' ? loanForm.islamic_contract_variant : '',
                            })
                          }
                        >
                          <option value="conventional">Conventional</option>
                          <option value="islamic">Islamic</option>
                        </select>
                      </div>
                      {loanForm.banking_model === 'islamic' && (
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            Islamic structure (label only)
                          </label>
                          <select
                            className="w-full border rounded-lg px-3 py-2"
                            value={loanForm.islamic_contract_variant}
                            onChange={(e) =>
                              setLoanForm({ ...loanForm, islamic_contract_variant: e.target.value })
                            }
                          >
                            {ISLAMIC_CONTRACT_OPTIONS.map((o) => (
                              <option key={o.value || 'none'} value={o.value}>
                                {o.label}
                              </option>
                            ))}
                          </select>
                          <p className="mt-1 text-xs text-gray-500">
                            Same GL mechanics as conventional loans; this is for reporting and clarity only.
                          </p>
                        </div>
                      )}
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Product type</label>
                        <select
                          className="w-full border rounded-lg px-3 py-2"
                          value={loanForm.product_type}
                          onChange={(e) => {
                            const v = e.target.value as LoanProductType
                            setLoanForm((f) => ({
                              ...f,
                              product_type: v,
                              banking_model:
                                v === 'islamic_facility' || v === 'islamic_deal' ? 'islamic' : f.banking_model,
                              parent_loan_id: v === 'islamic_deal' ? f.parent_loan_id : 0,
                            }))
                          }}
                        >
                          {PRODUCT_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      {loanForm.product_type === 'islamic_facility' && (
                        <div className="text-sm text-sky-900 bg-sky-50 border border-sky-200 rounded-lg p-3">
                          This row is the <strong>limit only</strong>. After saving, add <strong>Islamic deal</strong>{' '}
                          loans and post disbursements and repayments on those deal rows — not here.
                        </div>
                      )}
                      {loanForm.product_type === 'islamic_deal' && (
                        <>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                              Parent Islamic facility
                            </label>
                            <select
                              className="w-full border rounded-lg px-3 py-2"
                              value={loanForm.parent_loan_id || ''}
                              onChange={(e) =>
                                setLoanForm({
                                  ...loanForm,
                                  parent_loan_id: parseInt(e.target.value, 10) || 0,
                                })
                              }
                              required
                            >
                              <option value="">Select facility…</option>
                              {islamicFacilitiesForParent.map((l) => (
                                <option key={l.id} value={l.id}>
                                  {l.loan_no} — {formatMoneyAmount(l.sanction_amount, currencySymbol)} limit
                                </option>
                              ))}
                            </select>
                            {islamicFacilitiesForParent.length === 0 && (
                              <p className="mt-1 text-xs text-amber-700">
                                Create an <strong>Islamic facility</strong> first (same direction), then add this deal.
                              </p>
                            )}
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                              Deal reference (optional)
                            </label>
                            <input
                              className="w-full border rounded-lg px-3 py-2"
                              value={loanForm.deal_reference}
                              onChange={(e) => setLoanForm({ ...loanForm, deal_reference: e.target.value })}
                              placeholder="e.g. internal purpose code; auto-filled if empty"
                            />
                          </div>
                        </>
                      )}
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Counterparty</label>
                        <select
                          className="w-full border rounded-lg px-3 py-2"
                          value={loanForm.counterparty_id || ''}
                          onChange={(e) => {
                            const newId = parseInt(e.target.value, 10) || 0
                            const oldCp = counterpartiesAll.find((c) => c.id === loanForm.counterparty_id)
                            const newCp = counterpartiesAll.find((c) => c.id === newId)
                            const fromBf = isBankOrFinanceCompanyRole(oldCp?.role_type ?? '')
                            const toBf = isBankOrFinanceCompanyRole(newCp?.role_type ?? '')
                            const nextRate = convertInterestFieldOnCounterpartyChange(
                              loanForm.annual_interest_rate,
                              fromBf,
                              toBf
                            )
                            setLoanForm({ ...loanForm, counterparty_id: newId, annual_interest_rate: nextRate })
                          }}
                          required={loanModalMode === 'new' || !loanModalHasActivity}
                        >
                          <option value="">Select…</option>
                          {activeCounterparties.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.code} — {c.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          {sanctionFieldLabel(loanForm.product_type)}
                        </label>
                        <input
                          className="w-full border rounded-lg px-3 py-2"
                          type="number"
                          step="0.01"
                          value={loanForm.sanction_amount}
                          onChange={(e) => setLoanForm({ ...loanForm, sanction_amount: e.target.value })}
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Principal GL
                          {loanForm.direction === 'borrowed'
                            ? ' (loan payable — money you owe)'
                            : ' (loan receivable — money they owe you)'}
                        </label>
                        <select
                          className="w-full border rounded-lg px-3 py-2"
                          value={loanForm.principal_account_id || ''}
                          onChange={(e) =>
                            setLoanForm({ ...loanForm, principal_account_id: parseInt(e.target.value, 10) || 0 })
                          }
                          required={loanModalMode === 'new' || !loanModalHasActivity}
                        >
                          <option value="">Select…</option>
                          {coaFilteredForLoan.principal.map((a) => (
                            <option key={a.id} value={a.id}>
                              {formatCoaOptionLabel(a)}
                            </option>
                          ))}
                        </select>
                        {coaFilteredForLoan.principal.length === 0 && (
                          <p className="mt-1 text-xs text-amber-700">
                            No matching accounts. Under Chart of accounts add type <strong>Loan</strong> with subtype{' '}
                            {loanForm.direction === 'borrowed' ? (
                              <strong>loan payable</strong>
                            ) : (
                              <strong>loan receivable</strong>
                            )}
                            {loanForm.direction === 'borrowed' ? (
                              <>
                                , or a <strong>Liability</strong> with subtype <strong>loan payable</strong> (e.g.
                                short-term bank loans).
                              </>
                            ) : (
                              <>.</>
                            )}
                          </p>
                        )}
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Settlement GL (bank / cash only)
                        </label>
                        <select
                          className="w-full border rounded-lg px-3 py-2"
                          value={loanForm.settlement_account_id || ''}
                          onChange={(e) =>
                            setLoanForm({ ...loanForm, settlement_account_id: parseInt(e.target.value, 10) || 0 })
                          }
                          required={loanModalMode === 'new' || !loanModalHasActivity}
                        >
                          <option value="">Select…</option>
                          {coaFilteredForLoan.settlement.map((a) => (
                            <option key={`s-${a.id}`} value={a.id}>
                              {formatCoaOptionLabel(a)}
                            </option>
                          ))}
                        </select>
                        {coaFilteredForLoan.settlement.length === 0 && (
                          <p className="mt-1 text-xs text-amber-700">
                            No bank or cash lines found. Add an <strong>Asset</strong> with subtype checking / cash on
                            hand, or type <strong>Bank account</strong>, under Chart of accounts.
                          </p>
                        )}
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          {loanForm.banking_model === 'islamic'
                            ? 'Profit / return GL (optional — same account types as interest)'
                            : 'Interest GL (optional —'}{' '}
                          {loanForm.banking_model !== 'islamic' &&
                            (loanForm.direction === 'borrowed'
                              ? 'expense accounts only'
                              : 'income accounts only')}
                          {loanForm.banking_model === 'islamic' ? '' : ')'}
                        </label>
                        <select
                          className="w-full border rounded-lg px-3 py-2"
                          value={loanForm.interest_account_id || ''}
                          onChange={(e) =>
                            setLoanForm({
                              ...loanForm,
                              interest_account_id: parseInt(e.target.value, 10) || 0,
                            })
                          }
                        >
                          <option value="">None</option>
                          {coaFilteredForLoan.interest.map((a) => (
                            <option key={`i-${a.id}`} value={a.id}>
                              {formatCoaOptionLabel(a)}
                            </option>
                          ))}
                        </select>
                        {coaFilteredForLoan.interest.length === 0 && (
                          <p className="mt-1 text-xs text-gray-500">
                            Optional. Add an <strong>Expense</strong> (borrowed) or <strong>Income</strong> (lent) line
                            for {loanForm.banking_model === 'islamic' ? 'profit/return' : 'interest'} in repayments.
                          </p>
                        )}
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          {loanForm.banking_model === 'islamic'
                            ? 'Accrued profit GL (optional — balance sheet accruals)'
                            : 'Accrued interest GL (optional — for explicit accrual journals)'}
                        </label>
                        <select
                          className="w-full border rounded-lg px-3 py-2"
                          value={loanForm.interest_accrual_account_id || ''}
                          onChange={(e) =>
                            setLoanForm({
                              ...loanForm,
                              interest_accrual_account_id: parseInt(e.target.value, 10) || 0,
                            })
                          }
                        >
                          <option value="">None</option>
                          {coaFilteredForLoan.accrual.map((a) => (
                            <option key={`a-${a.id}`} value={a.id}>
                              {formatCoaOptionLabel(a)}
                            </option>
                          ))}
                        </select>
                        <p className="mt-1 text-xs text-gray-500">
                          Borrowed: use a <strong>liability</strong> (
                          {loanForm.banking_model === 'islamic'
                            ? 'accrued profit payable'
                            : 'accrued interest payable'}
                          ). Lent: use an <strong>asset</strong> (
                          {loanForm.banking_model === 'islamic'
                            ? 'accrued profit receivable'
                            : 'accrued interest receivable'}
                          ). Works with the {loanForm.banking_model === 'islamic' ? 'profit/return' : 'Interest'} GL
                          above.
                        </p>
                        {coaFilteredForLoan.accrual.length === 0 && (
                          <p className="mt-1 text-xs text-amber-700">
                            Add a balance-sheet line under Chart of accounts if you want to post accruals from the loan
                            screen.
                          </p>
                        )}
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Agreement # (optional)</label>
                        <input
                          className="w-full border rounded-lg px-3 py-2"
                          value={loanForm.agreement_no}
                          onChange={(e) => setLoanForm({ ...loanForm, agreement_no: e.target.value })}
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Start date (optional)</label>
                        <input
                          className="w-full border rounded-lg px-3 py-2"
                          type="date"
                          value={loanForm.start_date}
                          onChange={(e) => setLoanForm({ ...loanForm, start_date: e.target.value })}
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          {loanFormInterestBankFinance ? (
                            <>
                              Annual interest % <span className="text-red-600">*</span>
                            </>
                          ) : (
                            <>
                              Monthly interest % <span className="text-red-600">*</span>
                            </>
                          )}
                        </label>
                        <p className="text-xs text-gray-500 mb-1">
                          {loanFormInterestBankFinance ? (
                            <>
                              Enter the quoted <strong>annual</strong> percentage rate. Use <strong>0</strong> for
                              zero-interest. EMI and schedules use this value directly.
                            </>
                          ) : (
                            <>
                              Enter the nominal <strong>monthly</strong> percentage. The system stores{' '}
                              <strong>12×</strong> as the annual rate for EMI and schedules. Use <strong>0</strong> for
                              zero-interest.
                            </>
                          )}
                        </p>
                        <input
                          className="w-full border rounded-lg px-3 py-2"
                          type="number"
                          step="0.0001"
                          min={0}
                          required
                          value={loanForm.annual_interest_rate}
                          onChange={(e) => setLoanForm({ ...loanForm, annual_interest_rate: e.target.value })}
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Term (months, optional)</label>
                        <input
                          className="w-full border rounded-lg px-3 py-2"
                          type="number"
                          min={0}
                          max={600}
                          value={loanForm.term_months}
                          onChange={(e) => setLoanForm({ ...loanForm, term_months: e.target.value })}
                        />
                      </div>
                    </>
                  )}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Title (optional)</label>
                    <input
                      className="w-full border rounded-lg px-3 py-2"
                      value={loanForm.title}
                      onChange={(e) => setLoanForm({ ...loanForm, title: e.target.value })}
                    />
                  </div>
                  {loanModalMode === 'edit' && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
                      <select
                        className="w-full border rounded-lg px-3 py-2"
                        value={loanForm.status}
                        onChange={(e) => setLoanForm({ ...loanForm, status: e.target.value })}
                      >
                        <option value="draft">Draft</option>
                        <option value="active">Active</option>
                        <option value="closed">Closed</option>
                      </select>
                    </div>
                  )}
                  {loanModalMode === 'new' && (
                    <p className="text-xs text-gray-500">New loans are saved as <strong>draft</strong> until you disburse.</p>
                  )}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Maturity date (optional)</label>
                    <input
                      className="w-full border rounded-lg px-3 py-2"
                      type="date"
                      value={loanForm.maturity_date}
                      onChange={(e) => setLoanForm({ ...loanForm, maturity_date: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                    <textarea
                      className="w-full border rounded-lg px-3 py-2 min-h-[80px]"
                      value={loanForm.notes}
                      onChange={(e) => setLoanForm({ ...loanForm, notes: e.target.value })}
                    />
                  </div>
                  <div className="flex flex-col-reverse sm:flex-row gap-2 pt-2">
                    <button
                      type="button"
                      onClick={closeLoanModal}
                      className="w-full sm:flex-1 py-2 border border-gray-300 rounded-lg text-gray-800 hover:bg-gray-50"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="w-full sm:flex-1 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
                    >
                      {loanModalMode === 'new' ? 'Create draft loan' : 'Save changes'}
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>
        )}

        {actionLoan && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg shadow-xl max-w-3xl w-full p-6 max-h-[92vh] overflow-y-auto">
              <div className="flex justify-between items-center mb-4">
                <div>
                  <h2 className="text-lg font-semibold">{actionLoan.loan_no}</h2>
                  <p className="text-xs text-gray-500">
                    {productTypeLabel(actionLoan.product_type)} · {actionLoan.direction}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setActionLoan(null)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              <div className="space-y-4">
                {isIslamicFacilityHeader(actionLoan) ? (
                  <p className="text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-lg p-4">
                    This row is an <strong>Islamic facility</strong> (limit header only). Open an{' '}
                    <strong>Islamic deal</strong> under this facility in the list and use <strong>Disburse / Repay</strong>{' '}
                    there.
                  </p>
                ) : (
                  <>
                    <div className="rounded-lg border border-emerald-200 bg-emerald-50/90 p-3 text-sm space-y-1">
                      <p className="text-xs font-semibold text-emerald-900 uppercase tracking-wide">
                        Bank / cash (settlement) — payment account
                      </p>
                      {actionLoanSettlementCoa ? (
                        <p className="font-mono text-emerald-950 font-medium">
                          {formatCoaDisplay(actionLoanSettlementCoa)}
                        </p>
                      ) : (
                        <p className="text-xs text-amber-800">
                          No matching chart line in the list (id {actionLoan.settlement_account_id}). Check Chart of
                          accounts or <strong>Edit loan</strong> → Settlement GL.
                        </p>
                      )}
                      <p className="text-xs text-emerald-800">
                        All disbursements and repayments on this loan post through this GL. The journal entry
                        description and bank line memo include this code and name. To use a different account, change{' '}
                        <strong>Settlement (bank/cash)</strong> on the loan, then post.
                      </p>
                    </div>

                    <div>
                      <h3 className="font-medium text-gray-800 mb-2">
                        {disburseRepayUsesIslamicTerms ? 'Financing disbursement' : 'Disburse'}
                      </h3>
                      <p className="text-xs text-gray-500 mb-2">
                        {actionLoan.direction === 'borrowed'
                          ? disburseRepayUsesIslamicTerms
                            ? 'Dr Bank, Cr financing payable (principal)'
                            : 'Dr Bank, Cr Loan payable'
                          : disburseRepayUsesIslamicTerms
                            ? 'Dr financing receivable (principal), Cr Bank'
                            : 'Dr Loan receivable, Cr Bank'}
                        .{' '}
                        <span className="text-indigo-700">
                          Amount defaults to remaining limit (sanction minus outstanding); change if you draw less.
                        </span>
                      </p>
                      <input
                        type="number"
                        step="0.01"
                        className="w-full border rounded-lg px-3 py-2 mb-2"
                        placeholder="Amount"
                        value={disbAmt}
                        onChange={(e) => setDisbAmt(e.target.value)}
                      />
                      <button
                        type="button"
                        onClick={doDisburse}
                        className="w-full py-2 bg-gray-800 text-white rounded-lg hover:bg-gray-900"
                      >
                        {disburseRepayUsesIslamicTerms ? 'Post financing disbursement' : 'Post disbursement'}
                      </button>
                    </div>

                    {Number(actionLoan.outstanding_principal) > 0 && (
                      <div className="rounded-xl border border-gray-200 bg-gray-50/80 p-4 space-y-4">
                        <h3 className="font-medium text-gray-900 flex items-center gap-2">
                          <Calculator className="h-4 w-4 text-indigo-600" />
                          Payment helpers
                        </h3>

                        <div className="rounded-lg border border-white bg-white p-3 shadow-sm">
                          <p className="text-xs font-semibold text-gray-700 mb-2">
                            {disburseRepayUsesIslamicTerms
                              ? 'Simple profit / return estimate'
                              : 'Simple interest estimate'}
                          </p>
                          <p className="text-xs text-gray-500 mb-2">
                            On <strong>current outstanding</strong> (not an accrual journal). Adjust days to match your
                            bank or institution statement period.
                            {interestHint?.interest_basis_label ? (
                              <>
                                {' '}
                                <span className="text-gray-700 font-medium">{interestHint.interest_basis_label}</span>
                              </>
                            ) : null}
                          </p>
                          <div className="flex flex-wrap items-end gap-2">
                            <div>
                              <label className="block text-xs text-gray-600 mb-1">Days</label>
                              <input
                                type="number"
                                min={1}
                                max={3660}
                                className="w-24 border rounded-lg px-2 py-1.5 text-sm"
                                value={interestHintDays}
                                onChange={(e) =>
                                  setInterestHintDays(
                                    Math.max(1, Math.min(3660, parseInt(e.target.value, 10) || 30))
                                  )
                                }
                              />
                            </div>
                          </div>
                          {interestHint?.simple_interest_estimate != null && (
                            <p className="mt-2 text-sm font-medium text-gray-900">
                              ≈ {currencySymbol}
                              {Number(interestHint.simple_interest_estimate).toLocaleString(undefined, {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })}{' '}
                              <span className="text-xs font-normal text-gray-500">
                                over {interestHint.days} day(s)
                              </span>
                            </p>
                          )}
                          {interestHint?.note && (
                            <p className="mt-1 text-xs text-gray-500">{interestHint.note}</p>
                          )}
                        </div>

                        <div className="rounded-lg border border-white bg-white p-3 shadow-sm">
                          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 mb-2">
                            <div>
                              <p className="text-xs font-semibold text-gray-700">
                                {actionLoan.product_type === 'business_line'
                                  ? disburseRepayUsesIslamicTerms
                                    ? 'Quarterly profit / return schedule'
                                    : 'Quarterly interest schedule'
                                  : 'Payment schedule (remaining)'}
                              </p>
                              <p className="text-xs text-gray-500 mt-0.5">
                                {scheduleData?.schedule_sheet?.role === 'receivable' ||
                                actionLoan.direction === 'lent'
                                  ? 'Receivable: amounts you collect from the borrower.'
                                  : 'Payable: amounts you pay to the lender.'}
                              </p>
                            </div>
                            {scheduleData?.schedule &&
                              scheduleData.schedule.length > 0 &&
                              !scheduleLoading && (
                                <div className="flex flex-wrap gap-2 shrink-0">
                                  <button
                                    type="button"
                                    className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs rounded-lg border border-gray-300 bg-white text-gray-800 hover:bg-gray-50"
                                    onClick={downloadPaymentScheduleCsv}
                                  >
                                    <Download className="h-3.5 w-3.5" />
                                    Download CSV
                                  </button>
                                  <button
                                    type="button"
                                    className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs rounded-lg border border-gray-300 bg-white text-gray-800 hover:bg-gray-50"
                                    onClick={printPaymentScheduleSheet}
                                  >
                                    <Printer className="h-3.5 w-3.5" />
                                    Print sheet
                                  </button>
                                </div>
                              )}
                          </div>
                          {actionLoan.product_type === 'business_line' ? (
                            <>
                              <p className="text-xs text-gray-500 mb-2">
                                {disburseRepayUsesIslamicTerms ? 'Profit-only' : 'Interest-only'} rows on{' '}
                                <strong>today&apos;s drawn balance</strong> for each <strong>calendar quarter</strong>{' '}
                                (actual days in the quarter). Principal repayments are separate. Override how many quarters
                                to show (1–40).
                              </p>
                              <div className="flex flex-wrap gap-2 mb-2">
                                <input
                                  type="number"
                                  min={1}
                                  max={40}
                                  placeholder="Quarters to show"
                                  className="flex-1 min-w-[8rem] border rounded-lg px-2 py-1.5 text-sm"
                                  value={scheduleQuartersInput}
                                  onChange={(e) => setScheduleQuartersInput(e.target.value)}
                                />
                                <button
                                  type="button"
                                  className="px-3 py-1.5 text-sm rounded-lg bg-indigo-600 text-white hover:bg-indigo-700"
                                  onClick={() => {
                                    const n = parseInt(scheduleQuartersInput, 10)
                                    if (!Number.isFinite(n) || n < 1) {
                                      toast.error('Enter quarters (1–40)')
                                      return
                                    }
                                    setScheduleQuartersApplied(Math.min(40, n))
                                  }}
                                >
                                  Apply quarters
                                </button>
                                <button
                                  type="button"
                                  className="px-3 py-1.5 text-sm rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50"
                                  onClick={() => {
                                    setScheduleQuartersApplied(null)
                                    setScheduleQuartersInput('')
                                  }}
                                >
                                  Reset
                                </button>
                              </div>
                            </>
                          ) : (
                            <>
                              <p className="text-xs text-gray-500 mb-2">
                                Equal payments on <strong>today&apos;s balance</strong>. If you prepaid extra principal,
                                set remaining months below and click Apply.
                              </p>
                              <div className="flex flex-wrap gap-2 mb-2">
                                <input
                                  type="number"
                                  min={1}
                                  max={600}
                                  placeholder="Remaining months override"
                                  className="flex-1 min-w-[8rem] border rounded-lg px-2 py-1.5 text-sm"
                                  value={scheduleRemainInput}
                                  onChange={(e) => setScheduleRemainInput(e.target.value)}
                                />
                                <button
                                  type="button"
                                  className="px-3 py-1.5 text-sm rounded-lg bg-indigo-600 text-white hover:bg-indigo-700"
                                  onClick={() => {
                                    const n = parseInt(scheduleRemainInput, 10)
                                    if (!Number.isFinite(n) || n < 1) {
                                      toast.error('Enter remaining months (1–600)')
                                      return
                                    }
                                    setScheduleRemainApplied(Math.min(600, n))
                                  }}
                                >
                                  Apply months
                                </button>
                                <button
                                  type="button"
                                  className="px-3 py-1.5 text-sm rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50"
                                  onClick={() => {
                                    setScheduleRemainApplied(null)
                                    setScheduleRemainInput('')
                                  }}
                                >
                                  Reset
                                </button>
                              </div>
                            </>
                          )}
                          {scheduleLoading && (
                            <p className="text-xs text-gray-500 py-2">Loading schedule…</p>
                          )}
                          {scheduleErr && (
                            <p className="text-xs text-amber-800 bg-amber-50 border border-amber-100 rounded p-2">
                              {scheduleErr}
                            </p>
                          )}
                          {scheduleData?.suggested_next && (
                            <div className="flex flex-wrap items-center gap-2 mb-2">
                              <span className="text-xs text-gray-600">Suggested next period:</span>
                              <button
                                type="button"
                                className="text-sm px-3 py-1 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700"
                                onClick={() => applyScheduleRow(scheduleData.suggested_next!)}
                              >
                                {scheduleData.interest_payment_frequency === 'quarterly'
                                  ? disburseRepayUsesIslamicTerms
                                    ? 'Apply next quarter profit'
                                    : 'Apply next quarter interest'
                                  : 'Apply next instalment'}
                              </button>
                            </div>
                          )}
                          {scheduleData?.method_note && (
                            <p className="text-xs text-gray-500 mb-2">{scheduleData.method_note}</p>
                          )}
                          {scheduleData?.schedule && scheduleData.schedule.length > 0 && (
                            <div className="overflow-x-auto max-h-72 border rounded-lg">
                              <table className="min-w-full text-xs">
                                <thead className="bg-gray-100 text-left sticky top-0">
                                  <tr>
                                    <th className="px-2 py-1.5 font-semibold">Period</th>
                                    <th className="px-2 py-1.5 font-semibold text-right">
                                      {actionLoan.direction === 'lent' ? 'Collection' : 'Payment'}
                                    </th>
                                    <th className="px-2 py-1.5 font-semibold text-right">Principal</th>
                                    <th className="px-2 py-1.5 font-semibold text-right">
                                      {disburseRepayUsesIslamicTerms ? 'Profit / return' : 'Interest'}
                                    </th>
                                    <th className="px-2 py-1.5 font-semibold text-right">Balance</th>
                                    <th className="px-2 py-1.5 font-semibold text-right"> </th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {scheduleData.schedule.map((row) => (
                                    <tr key={row.period} className="border-t border-gray-100 hover:bg-gray-50">
                                      <td className="px-2 py-1">
                                        {row.period_label ?? row.period}
                                        {row.days_in_period != null && (
                                          <span className="text-gray-500"> ({row.days_in_period}d)</span>
                                        )}
                                      </td>
                                      <td className="px-2 py-1 text-right tabular-nums">{row.payment}</td>
                                      <td className="px-2 py-1 text-right tabular-nums">{row.principal}</td>
                                      <td className="px-2 py-1 text-right tabular-nums">{row.interest}</td>
                                      <td className="px-2 py-1 text-right tabular-nums">{row.closing_balance}</td>
                                      <td className="px-2 py-1 text-right">
                                        <button
                                          type="button"
                                          className="text-indigo-600 hover:underline"
                                          onClick={() => applyScheduleRow(row)}
                                        >
                                          Use
                                        </button>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {actionLoan.status === 'active' && !isIslamicFacilityHeader(actionLoan) && (
                      <div className="rounded-xl border border-indigo-100 bg-indigo-50/50 p-4 space-y-3">
                        <h3 className="font-medium text-gray-900">
                          {disburseRepayUsesIslamicTerms
                            ? 'Profit accrual (period-end)'
                            : 'Interest accrual (period-end)'}
                        </h3>
                        <p className="text-xs text-gray-600">
                          {disburseRepayUsesIslamicTerms ? (
                            <>
                              Posts <strong>Dr profit/return expense, Cr accrued liability</strong> (borrowed) or the
                              mirror for lent — same GL mechanics as interest accrual; no bank movement. Use{' '}
                              <strong>Reverse</strong> to post an offsetting entry if you mis-posted.
                            </>
                          ) : (
                            <>
                              Posts <strong>Dr interest expense, Cr accrued liability</strong> (borrowed) or the mirror for
                              lent — no bank movement. Use <strong>Reverse</strong> to post an offsetting entry if you
                              mis-posted.
                            </>
                          )}
                        </p>
                        {!actionLoan.interest_account_id || !actionLoan.interest_accrual_account_id ? (
                          <p className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-lg p-2">
                            Set{' '}
                            <strong>
                              {disburseRepayUsesIslamicTerms ? 'Profit / return GL' : 'Interest GL'}
                            </strong>{' '}
                            and{' '}
                            <strong>
                              {disburseRepayUsesIslamicTerms ? 'Accrued profit GL' : 'Accrued interest GL'}
                            </strong>{' '}
                            on the loan (Edit) before posting accruals.
                          </p>
                        ) : null}
                        {loanAccruals.length > 0 && (
                          <ul className="text-xs space-y-1.5 max-h-28 overflow-y-auto border rounded-lg bg-white p-2">
                            {loanAccruals.map((a) => (
                              <li
                                key={a.id}
                                className="flex flex-wrap justify-between gap-2 items-center border-b border-gray-50 pb-1 last:border-0"
                              >
                                <span>
                                  {a.accrual_date} · {currencySymbol}
                                  {Number(a.amount).toLocaleString(undefined, {
                                    minimumFractionDigits: 2,
                                    maximumFractionDigits: 2,
                                  })}
                                  {a.days_basis != null ? ` · ${a.days_basis}d` : ''}
                                </span>
                                <span className="flex items-center gap-2">
                                  {a.reversed_at ? (
                                    <span className="text-gray-400">Reversed</span>
                                  ) : a.journal_entry_id ? (
                                    <button
                                      type="button"
                                      className="text-red-600 hover:underline"
                                      onClick={() => reverseLoanAccrual(a.id)}
                                    >
                                      Reverse
                                    </button>
                                  ) : (
                                    <span className="text-gray-400">Draft</span>
                                  )}
                                </span>
                              </li>
                            ))}
                          </ul>
                        )}
                        {Number(actionLoan.outstanding_principal) > 0 &&
                          actionLoan.interest_account_id &&
                          actionLoan.interest_accrual_account_id && (
                            <div className="space-y-2 border-t border-indigo-100 pt-3">
                              <label className="block text-xs font-medium text-gray-700">Accrual date</label>
                              <input
                                type="date"
                                className="w-full border rounded-lg px-2 py-1.5 text-sm"
                                value={accrualDate}
                                onChange={(e) => setAccrualDate(e.target.value)}
                              />
                              <input
                                type="number"
                                step="0.01"
                                className="w-full border rounded-lg px-2 py-1.5 text-sm"
                                placeholder={
                                  disburseRepayUsesIslamicTerms
                                    ? 'Amount (optional — leave blank to use days × rate on outstanding principal)'
                                    : 'Amount (optional — leave blank to use days × rate on outstanding)'
                                }
                                value={accrualAmount}
                                onChange={(e) => setAccrualAmount(e.target.value)}
                              />
                              <input
                                type="number"
                                min={1}
                                max={3660}
                                className="w-full border rounded-lg px-2 py-1.5 text-sm"
                                placeholder="Days (if amount blank)"
                                value={accrualDays}
                                onChange={(e) => setAccrualDays(e.target.value)}
                              />
                              <input
                                className="w-full border rounded-lg px-2 py-1.5 text-sm"
                                placeholder="Memo (optional)"
                                value={accrualMemo}
                                onChange={(e) => setAccrualMemo(e.target.value)}
                              />
                              <button
                                type="button"
                                onClick={postLoanAccrual}
                                className="w-full py-2 bg-indigo-700 text-white rounded-lg hover:bg-indigo-800 text-sm"
                              >
                                {disburseRepayUsesIslamicTerms
                                  ? 'Post profit accrual to GL'
                                  : 'Post interest accrual to GL'}
                              </button>
                            </div>
                          )}
                      </div>
                    )}

                    <hr />
                    <div>
                      <h3 className="font-medium text-gray-800 mb-2">
                        {actionLoan.direction === 'lent'
                          ? disburseRepayUsesIslamicTerms
                            ? 'Receive payment (principal & profit)'
                            : 'Receive payment (principal & interest)'
                          : disburseRepayUsesIslamicTerms
                            ? 'Pay lender (principal & profit)'
                            : 'Pay lender (principal & interest)'}
                      </h3>
                      <p className="text-xs text-gray-500 mb-2">
                        {actionLoan.direction === 'borrowed'
                          ? disburseRepayUsesIslamicTerms
                            ? 'Dr financing payable + profit/return exp, Cr Bank'
                            : 'Dr Loan payable + interest exp, Cr Bank'
                          : disburseRepayUsesIslamicTerms
                            ? 'Dr Bank, Cr financing receivable + profit/return income'
                            : 'Dr Bank, Cr Loan receivable + interest income'}
                        .{' '}
                        <strong className="text-gray-700">
                          Cash side: {formatCoaDisplay(actionLoanSettlementCoa) || `GL #${actionLoan.settlement_account_id}`}
                        </strong>
                        .{' '}
                        <span className="text-indigo-700">
                          Fields pre-fill: next amortized instalment when a schedule is available; otherwise full
                          principal plus simple {disburseRepayUsesIslamicTerms ? 'profit/return' : 'interest'} for the
                          &quot;Days&quot; above (or principal-only at 0% rate).
                          Edit before posting if your bank amount differs.
                        </span>
                      </p>
                      <div className="rounded-xl border border-violet-200 bg-violet-50/90 p-3 mb-3 space-y-2">
                        <p className="text-xs font-semibold text-violet-950">Quick fill (then edit if needed)</p>
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            className="px-3 py-1.5 text-xs rounded-lg bg-white border border-violet-300 text-violet-950 hover:bg-violet-100/80"
                            onClick={() => applyQuickRepayment('next_schedule')}
                          >
                            Next schedule line
                          </button>
                          <button
                            type="button"
                            className="px-3 py-1.5 text-xs rounded-lg bg-white border border-violet-300 text-violet-950 hover:bg-violet-100/80"
                            onClick={() => applyQuickRepayment('interest_only')}
                          >
                            {disburseRepayUsesIslamicTerms ? 'Profit / return only' : 'Interest only'}
                          </button>
                          <button
                            type="button"
                            className="px-3 py-1.5 text-xs rounded-lg bg-white border border-violet-300 text-violet-950 hover:bg-violet-100/80"
                            onClick={() => applyQuickRepayment('principal_only')}
                          >
                            {actionLoan.direction === 'lent'
                              ? 'Principal only (full outstanding)'
                              : 'Principal only (full outstanding)'}
                          </button>
                          <button
                            type="button"
                            className="px-3 py-1.5 text-xs rounded-lg bg-white border border-violet-300 text-violet-950 hover:bg-violet-100/80"
                            onClick={() => applyQuickRepayment('full_payoff')}
                          >
                            {actionLoan.direction === 'lent'
                              ? 'Full payoff (principal + interest for Days)'
                              : 'Full payoff (principal + interest for Days)'}
                          </button>
                        </div>
                        <p className="text-[11px] text-violet-900/90">
                          <strong>Interest only</strong> uses the next schedule row if loaded; otherwise the simple
                          estimate from <strong>Days</strong> above. <strong>Full payoff</strong> repays all principal
                          plus that same interest estimate (add separate accruals in GL if your bank uses different
                          interest).
                        </p>
                      </div>
                      <input
                        type="number"
                        step="0.01"
                        className="w-full border rounded-lg px-3 py-2 mb-1"
                        placeholder="Total amount"
                        value={repayAmt}
                        onChange={(e) => setRepayAmt(e.target.value)}
                      />
                      <input
                        type="number"
                        step="0.01"
                        className="w-full border rounded-lg px-3 py-2 mb-1"
                        placeholder="Principal portion (utilised amount on Islamic deals)"
                        value={repayPrin}
                        onChange={(e) => setRepayPrin(e.target.value)}
                      />
                      <input
                        type="number"
                        step="0.01"
                        className="w-full border rounded-lg px-3 py-2 mb-2"
                        placeholder={
                          disburseRepayUsesIslamicTerms
                            ? 'Profit / return portion (needs profit/return GL on loan)'
                            : 'Interest portion (needs interest GL on loan)'
                        }
                        value={repayInt}
                        onChange={(e) => setRepayInt(e.target.value)}
                      />
                      <button
                        type="button"
                        onClick={doRepay}
                        className="w-full py-2 border border-indigo-600 text-indigo-700 rounded-lg hover:bg-indigo-50"
                      >
                        {actionLoan.direction === 'lent' ? 'Post collection to GL' : 'Post payment to GL'}
                      </button>
                    </div>

                    {loanRepayments.length > 0 && (
                      <div className="rounded-xl border border-amber-100 bg-amber-50/50 p-4 space-y-2">
                        <h3 className="font-medium text-gray-900">Posted repayments</h3>
                        <p className="text-xs text-gray-600">
                          <strong>Reverse</strong> creates an opposite GL entry (e.g. credit loan payable, debit bank for
                          a mistaken borrowed repayment) and puts principal back on the loan. The original repayment
                          stays on the statement with a matching reversal line.
                        </p>
                        <ul className="text-xs space-y-1.5 max-h-36 overflow-y-auto border rounded-lg bg-white p-2">
                          {loanRepayments.map((r) => (
                            <li
                              key={r.id}
                              className="flex flex-wrap justify-between gap-2 items-center border-b border-gray-50 pb-1 last:border-0"
                            >
                              <span>
                                {r.repayment_date} · total {currencySymbol}
                                {Number(r.amount).toLocaleString(undefined, {
                                  minimumFractionDigits: 2,
                                  maximumFractionDigits: 2,
                                })}{' '}
                                (P {currencySymbol}
                                {Number(r.principal_amount).toLocaleString(undefined, {
                                  minimumFractionDigits: 2,
                                  maximumFractionDigits: 2,
                                })}{' '}
                                / {disburseRepayUsesIslamicTerms ? 'R' : 'I'} {currencySymbol}
                                {Number(r.interest_amount).toLocaleString(undefined, {
                                  minimumFractionDigits: 2,
                                  maximumFractionDigits: 2,
                                })}
                                )
                              </span>
                              <span>
                                {r.reversed_at ? (
                                  <span className="text-gray-400">Reversed</span>
                                ) : r.journal_entry_id ? (
                                  <button
                                    type="button"
                                    className="text-red-600 hover:underline"
                                    onClick={() => reverseLoanRepayment(r.id)}
                                  >
                                    Reverse
                                  </button>
                                ) : (
                                  <span className="text-gray-400">No GL</span>
                                )}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        {statementLoan && (
          <div className="loan-statement-modal-backdrop fixed inset-0 bg-black/40 flex items-center justify-center z-[60] p-4 print:p-6 print:bg-white print:items-start print:justify-start">
            <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] flex flex-col print:shadow-none print:max-h-none print:max-w-none print:w-full">
              <div className="flex justify-between items-start gap-4 p-4 border-b border-gray-100 print:hidden">
                <div>
                  <h2 className="text-lg font-semibold flex items-center gap-2">
                    <FileText className="h-5 w-5 text-indigo-600" />
                    {statementUsesIslamicTerms ? 'Financing statement' : 'Loan statement'}
                  </h2>
                  <p className="text-sm text-gray-600 font-mono">{statementLoan.loan_no}</p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={!statementPayload}
                    onClick={() => printCurrentWindow()}
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg border border-gray-300 text-gray-800 hover:bg-gray-50 disabled:opacity-40"
                  >
                    <Printer className="h-4 w-4" />
                    Print / PDF
                  </button>
                  <button
                    type="button"
                    disabled={!statementPayload}
                    onClick={downloadLoanStatementCsv}
                    className="px-3 py-2 text-sm rounded-lg border border-gray-300 text-gray-800 hover:bg-gray-50 disabled:opacity-40"
                  >
                    Download CSV
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setStatementLoan(null)
                      setStatementPayload(null)
                    }}
                    className="text-gray-400 hover:text-gray-600 p-1"
                    aria-label="Close"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>
              </div>
              <div id="loan-statement-print-root" className="p-4 overflow-y-auto flex-1">
                {statementLoading && <p className="text-gray-500">Loading…</p>}
                {!statementLoading && statementPayload && (
                  <>
                    <div className="hidden print:block text-center mb-4">
                      <h1 className="text-xl font-bold">
                        {statementUsesIslamicTerms ? 'Financing statement' : 'Loan statement'}
                      </h1>
                      <p className="font-mono text-sm">{statementPayload.loan.loan_no}</p>
                      <p className="text-xs text-gray-600">As of {statementPayload.as_of || '—'}</p>
                    </div>
                    {statementPayload.statement_note ? (
                      <p className="text-xs text-gray-600 border border-slate-200 bg-slate-50 rounded-lg px-3 py-2 mb-3">
                        {statementPayload.statement_note}
                      </p>
                    ) : null}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm mb-4">
                      <div>
                        <p className="text-xs text-gray-500">Party</p>
                        <p className="font-medium">{statementPayload.loan.counterparty_name || '—'}</p>
                        {statementPayload.loan.interest_basis_label ? (
                          <p className="text-xs text-gray-500 mt-1 normal-case" title={statementPayload.loan.interest_basis_label}>
                            {statementPayload.loan.interest_basis_label}
                          </p>
                        ) : null}
                      </div>
                      <div>
                        <p className="text-xs text-gray-500">Direction</p>
                        <p className="font-medium capitalize">{statementPayload.loan.direction}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500">Outstanding</p>
                        <p className="font-medium tabular-nums">
                          {formatMoneyAmount(statementPayload.loan.outstanding_principal, currencySymbol)}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500">As of</p>
                        <p className="font-medium">{statementPayload.as_of || '—'}</p>
                      </div>
                    </div>
                    <div className="overflow-x-auto border rounded-lg">
                      <table className="min-w-full text-sm">
                        <thead className="bg-gray-50 text-left">
                          <tr>
                            <th className="px-3 py-2 font-semibold">Date</th>
                            <th className="px-3 py-2 font-semibold">Type</th>
                            <th className="px-3 py-2 font-semibold text-right">Disbursement</th>
                            <th className="px-3 py-2 font-semibold text-right">Payment</th>
                            <th className="px-3 py-2 font-semibold text-right">Principal</th>
                            <th className="px-3 py-2 font-semibold text-right">
                              {statementUsesIslamicTerms ? 'Profit / return' : 'Interest'}
                            </th>
                            <th className="px-3 py-2 font-semibold text-right">Balance</th>
                          </tr>
                        </thead>
                        <tbody>
                          {statementPayload.lines.length === 0 ? (
                            <tr>
                              <td colSpan={7} className="px-3 py-6 text-center text-gray-500">
                                {statementUsesIslamicTerms
                                  ? 'No financing disbursements or payments yet.'
                                  : 'No disbursements or repayments yet.'}
                              </td>
                            </tr>
                          ) : (
                            statementPayload.lines.map((line, idx) => (
                              <tr key={`${line.date}-${line.kind}-${idx}`} className="border-t border-gray-100">
                                <td className="px-3 py-2 whitespace-nowrap">{line.date}</td>
                                <td className="px-3 py-2">
                                  {line.kind_label ??
                                    statementKindLabel(line.kind, statementUsesIslamicTerms)}
                                </td>
                                <td className="px-3 py-2 text-right tabular-nums text-emerald-800">
                                  {line.disbursement || '—'}
                                </td>
                                <td className="px-3 py-2 text-right tabular-nums">
                                  {line.repayment_total || '—'}
                                </td>
                                <td className="px-3 py-2 text-right tabular-nums">{line.principal || '—'}</td>
                                <td className="px-3 py-2 text-right tabular-nums">{line.interest || '—'}</td>
                                <td className="px-3 py-2 text-right tabular-nums font-medium">
                                  {line.outstanding_principal_after}
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
