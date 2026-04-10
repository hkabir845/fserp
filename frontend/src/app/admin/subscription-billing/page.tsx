'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import Sidebar from '@/components/Sidebar'
import { CompanyProvider, useCompany } from '@/contexts/CompanyContext'
import { useToast } from '@/components/Toast'
import api from '@/lib/api'
import { formatCurrency } from '@/utils/currency'
import { safeLogError, isConnectionError } from '@/utils/connectionError'
import { useRequireSaasDashboardMode } from '@/hooks/useRequireSaasDashboardMode'
import {
  ArrowLeft,
  BarChart3,
  Banknote,
  Building2,
  CalendarClock,
  Check,
  ChevronRight,
  CreditCard,
  Crown,
  ExternalLink,
  FileText,
  Layers,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Shield,
  Sparkles,
  SquarePen,
  Trash2,
  TrendingUp,
  Wallet,
  X,
  Zap,
} from 'lucide-react'

interface CompanyRow {
  id: number
  name: string
  currency: string
  is_active: boolean
  user_count?: number
  payment_type?: string | null
  payment_start_date?: string | null
  payment_end_date?: string | null
  payment_amount?: string | null
  billing_plan_code?: string | null
}

interface LedgerInvoice {
  id: number
  company_id: number
  invoice_number: string
  amount: string
  invoice_date: string | null
  due_date: string | null
  status: string
  notes: string
  currency?: string
  billing_plan_code?: string
}

interface SubscriptionBundle {
  company_id: number
  company_name: string
  billing_plan_code?: string
  billing_plan_name?: string
  payment_start_date: string | null
  payment_end_date: string | null
  payment_amount: string
  invoices: LedgerInvoice[]
}

interface ErpContract {
  id: number
  contract_number: string
  company_id: number
  company_name?: string
  contract_date: string
  expiry_date: string
  status: string
  license_type?: string
  billing_period: string
  amount_per_month?: number | null
  amount_per_year?: number | null
  currency: string
  total_contract_value: number
  auto_renewal: string
  is_active: boolean
}

type TenantFilter = 'all' | 'renew_soon' | 'expired' | 'unset'

interface BillingPlan {
  id: string
  name: string
  tagline: string
  icon: typeof Zap
  accent: string
  borderAccent: string
  suggestedMonthly: number
  suggestedYearly: number
  defaultCycle: string
  features: string[]
  recommended?: boolean
}

const PAYMENT_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: '— Not set —' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'half_yearly', label: 'Half-yearly' },
  { value: 'yearly', label: 'Yearly' },
]

const INVOICE_STATUS_OPTIONS = ['draft', 'sent', 'paid', 'overdue', 'void'] as const

/** Local browser overrides for reference plan cards only (not the server catalog). */
const PLAN_OVERRIDE_STORAGE_KEY = 'fserp_subscription_billing_plan_overrides_v1'

type PlanDisplayOverride = {
  tagline?: string
  suggestedMonthly?: number
  suggestedYearly?: number
  features?: string[]
}

const BILLING_PLANS: BillingPlan[] = [
  {
    id: 'starter',
    name: 'Starter',
    tagline: 'Single site, essential ERP',
    icon: Zap,
    accent: 'from-sky-500 to-blue-600',
    borderAccent: 'border-sky-200 hover:border-sky-300',
    suggestedMonthly: 4999,
    suggestedYearly: 49990,
    defaultCycle: 'monthly',
    features: ['Up to 3 users', 'Core finance & inventory', 'Email support', 'Standard reports'],
  },
  {
    id: 'growth',
    name: 'Growth',
    tagline: 'Multi-branch operations',
    icon: BarChart3,
    accent: 'from-violet-500 to-indigo-600',
    borderAccent: 'border-violet-200 hover:border-violet-300',
    suggestedMonthly: 14999,
    suggestedYearly: 149990,
    defaultCycle: 'monthly',
    recommended: true,
    features: ['Up to 15 users', 'Advanced analytics', 'Role-based access', 'Priority support'],
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    tagline: 'Scale, compliance, SLA',
    icon: Building2,
    accent: 'from-slate-600 to-slate-900',
    borderAccent: 'border-slate-300 hover:border-slate-400',
    suggestedMonthly: 39999,
    suggestedYearly: 399990,
    defaultCycle: 'yearly',
    features: ['Unlimited users *', 'Custom workflows', 'Dedicated success manager', 'Uptime SLA'],
  },
  {
    id: 'platform',
    name: 'Platform',
    tagline: 'White-label & API',
    icon: Crown,
    accent: 'from-amber-500 to-orange-600',
    borderAccent: 'border-amber-200 hover:border-amber-300',
    suggestedMonthly: 89999,
    suggestedYearly: 899990,
    defaultCycle: 'yearly',
    features: ['API access', 'Multi-tenant tools', 'Custom contracts', 'Solution engineering'],
  },
]

function errDetail(e: unknown): string {
  const err = e as { response?: { data?: { detail?: string } } }
  return err.response?.data?.detail || 'Request failed'
}

function parseLocalDate(iso: string | null | undefined): Date | null {
  if (!iso) return null
  const d = new Date(iso.split('T')[0] + 'T12:00:00')
  return Number.isNaN(d.getTime()) ? null : d
}

function billingHealth(endIso: string | null | undefined): 'none' | 'active' | 'expiring' | 'expired' {
  const end = parseLocalDate(endIso ?? null)
  if (!end) return 'none'
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const endDay = new Date(end)
  endDay.setHours(0, 0, 0, 0)
  if (endDay < today) return 'expired'
  const ms30 = 30 * 24 * 60 * 60 * 1000
  if (endDay.getTime() - today.getTime() <= ms30) return 'expiring'
  return 'active'
}

function SubscriptionBillingContent() {
  const router = useRouter()
  const toast = useToast()
  useRequireSaasDashboardMode()
  const { mode } = useCompany()
  const [companies, setCompanies] = useState<CompanyRow[]>([])
  const [contracts, setContracts] = useState<ErpContract[]>([])
  const [allLedgerInvoices, setAllLedgerInvoices] = useState<LedgerInvoice[]>([])
  const [loading, setLoading] = useState(true)
  const [contextLoading, setContextLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [tenantFilter, setTenantFilter] = useState<TenantFilter>('all')
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [bundle, setBundle] = useState<SubscriptionBundle | null>(null)
  const [bundleLoading, setBundleLoading] = useState(false)

  const [saasPlanCatalog, setSaasPlanCatalog] = useState<{ code: string; name: string }[]>([])
  const [billingForm, setBillingForm] = useState({
    payment_type: '',
    payment_start_date: '',
    payment_end_date: '',
    payment_amount: '',
    billing_plan_code: '',
  })
  const [extendDate, setExtendDate] = useState('')
  const [savingBilling, setSavingBilling] = useState(false)
  const [extending, setExtending] = useState(false)

  const [showInvoiceForm, setShowInvoiceForm] = useState(false)
  const [invoiceForm, setInvoiceForm] = useState({
    invoice_number: '',
    amount: '',
    invoice_date: '',
    due_date: '',
    status: 'draft',
    notes: '',
    billing_plan_code: '',
    period_start: '',
    period_end: '',
  })
  const [editingInvoice, setEditingInvoice] = useState<LedgerInvoice | null>(null)

  const [planOverrides, setPlanOverrides] = useState<Record<string, PlanDisplayOverride>>({})
  const [planEditOpen, setPlanEditOpen] = useState<BillingPlan | null>(null)
  const [planEditForm, setPlanEditForm] = useState({
    tagline: '',
    suggestedMonthly: '',
    suggestedYearly: '',
    featuresText: '',
  })

  useEffect(() => {
    try {
      const raw = typeof window !== 'undefined' ? localStorage.getItem(PLAN_OVERRIDE_STORAGE_KEY) : null
      if (raw) {
        const parsed = JSON.parse(raw) as Record<string, PlanDisplayOverride>
        if (parsed && typeof parsed === 'object') setPlanOverrides(parsed)
      }
    } catch {
      /* ignore */
    }
  }, [])

  const persistPlanOverrides = useCallback((next: Record<string, PlanDisplayOverride>) => {
    setPlanOverrides(next)
    try {
      localStorage.setItem(PLAN_OVERRIDE_STORAGE_KEY, JSON.stringify(next))
    } catch {
      /* ignore */
    }
  }, [])

  const mergePlan = useCallback(
    (plan: BillingPlan): BillingPlan => {
      const o = planOverrides[plan.id]
      if (!o) return plan
      return {
        ...plan,
        tagline: o.tagline ?? plan.tagline,
        suggestedMonthly: o.suggestedMonthly ?? plan.suggestedMonthly,
        suggestedYearly: o.suggestedYearly ?? plan.suggestedYearly,
        features: o.features && o.features.length > 0 ? o.features : plan.features,
      }
    },
    [planOverrides]
  )

  const openPlanEditor = (plan: BillingPlan) => {
    const m = mergePlan(plan)
    setPlanEditOpen(plan)
    setPlanEditForm({
      tagline: m.tagline,
      suggestedMonthly: String(m.suggestedMonthly),
      suggestedYearly: String(m.suggestedYearly),
      featuresText: m.features.join('\n'),
    })
  }

  const savePlanDisplayEdit = () => {
    if (!planEditOpen) return
    const features = planEditForm.featuresText
      .split('\n')
      .map((x) => x.trim())
      .filter(Boolean)
    const sm = parseFloat(planEditForm.suggestedMonthly)
    const sy = parseFloat(planEditForm.suggestedYearly)
    persistPlanOverrides({
      ...planOverrides,
      [planEditOpen.id]: {
        tagline: planEditForm.tagline.trim() || undefined,
        suggestedMonthly: Number.isFinite(sm) ? sm : undefined,
        suggestedYearly: Number.isFinite(sy) ? sy : undefined,
        features: features.length > 0 ? features : undefined,
      },
    })
    setPlanEditOpen(null)
    toast.success('Reference plan updated for this browser. Reset with the trash icon to restore defaults.')
  }

  const resetPlanOverride = (planId: string) => {
    if (!planOverrides[planId]) {
      toast.info('This plan is already using default reference values.')
      return
    }
    const next = { ...planOverrides }
    delete next[planId]
    persistPlanOverrides(next)
    toast.success('Reference plan reset to default.')
  }

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
        if ((user.role || '').toLowerCase() !== 'super_admin') {
          toast.error('Access denied. Super Admin access required.')
          router.push('/dashboard')
        }
      } catch {
        /* ignore */
      }
    }
  }, [router, toast])

  const loadCompanies = useCallback(async () => {
    try {
      setLoading(true)
      const { data } = await api.get('/admin/companies/', { params: { limit: 500 } })
      setCompanies(Array.isArray(data) ? data : [])
    } catch (e) {
      if (!isConnectionError(e)) {
        safeLogError('[subscription-billing] companies', e)
        toast.error(errDetail(e))
      }
      setCompanies([])
    } finally {
      setLoading(false)
    }
  }, [toast])

  const loadBillingContext = useCallback(async () => {
    setContextLoading(true)
    try {
      const [cRes, invRes] = await Promise.all([
        api.get('/contracts/').catch(() => ({ data: [] })),
        api.get('/subscription-ledger/invoices/').catch(() => ({ data: [] })),
      ])
      setContracts(Array.isArray(cRes.data) ? cRes.data : [])
      setAllLedgerInvoices(Array.isArray(invRes.data) ? invRes.data : [])
    } catch (e) {
      if (!isConnectionError(e)) safeLogError('[subscription-billing] context', e)
    } finally {
      setContextLoading(false)
    }
  }, [])

  const refreshAll = useCallback(async () => {
    await Promise.all([loadCompanies(), loadBillingContext()])
  }, [loadCompanies, loadBillingContext])

  useEffect(() => {
    if (mode === 'saas_dashboard') {
      loadCompanies()
      loadBillingContext()
    }
  }, [mode, loadCompanies, loadBillingContext])

  useEffect(() => {
    if (mode !== 'saas_dashboard') return
    api
      .get('/admin/billing-plans/')
      .then((r) => {
        if (Array.isArray(r.data)) {
          setSaasPlanCatalog(r.data.map((p: { code: string; name: string }) => ({ code: p.code, name: p.name })))
        }
      })
      .catch(() => {})
  }, [mode])

  const loadBundle = useCallback(
    async (companyId: number) => {
      setBundleLoading(true)
      try {
        const { data } = await api.get(`/admin/companies/${companyId}/subscription/`)
        const b = data as SubscriptionBundle
        setBundle(b)
        setBillingForm((prev) => ({
          ...prev,
          payment_start_date: b.payment_start_date?.split('T')[0] || '',
          payment_end_date: b.payment_end_date?.split('T')[0] || '',
          payment_amount: b.payment_amount || '',
          billing_plan_code: (b.billing_plan_code || prev.billing_plan_code || '').toLowerCase(),
        }))
        setExtendDate(b.payment_end_date?.split('T')[0] || '')
      } catch (e) {
        toast.error(errDetail(e))
        setBundle(null)
      } finally {
        setBundleLoading(false)
      }
    },
    [toast]
  )

  useEffect(() => {
    if (selectedId == null) {
      setBundle(null)
      return
    }
    const row = companies.find((c) => c.id === selectedId)
    setBillingForm((prev) => ({
      ...prev,
      payment_type: row?.payment_type || '',
      payment_start_date: row?.payment_start_date?.split('T')[0] || '',
      payment_end_date: row?.payment_end_date?.split('T')[0] || '',
      payment_amount: row?.payment_amount ?? '',
      billing_plan_code: (row?.billing_plan_code || prev.billing_plan_code || '').toLowerCase(),
    }))
    loadBundle(selectedId)
  }, [selectedId, companies, loadBundle])

  const filtered = useMemo(() => {
    let list = companies
    if (tenantFilter === 'renew_soon') {
      list = list.filter((c) => billingHealth(c.payment_end_date) === 'expiring')
    } else if (tenantFilter === 'expired') {
      list = list.filter((c) => billingHealth(c.payment_end_date) === 'expired')
    } else if (tenantFilter === 'unset') {
      list = list.filter((c) => billingHealth(c.payment_end_date) === 'none')
    }
    const q = search.trim().toLowerCase()
    if (!q) return list
    return list.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        String(c.id).includes(q) ||
        (c.payment_type || '').toLowerCase().includes(q)
    )
  }, [companies, search, tenantFilter])

  const kpis = useMemo(() => {
    const active = companies.filter((c) => c.is_active).length
    let expiring = 0
    let expired = 0
    let withEnd = 0
    for (const c of companies) {
      const h = billingHealth(c.payment_end_date)
      if (h === 'expiring') expiring++
      if (h === 'expired') expired++
      if (h !== 'none') withEnd++
    }
    return { active, expiring, expired, withEnd, total: companies.length }
  }, [companies])

  const contractKpis = useMemo(() => {
    let mrr = 0
    let activeCount = 0
    let expiring = 0
    for (const c of contracts) {
      const st = (c.status || '').toLowerCase()
      if (st === 'active' && c.is_active) {
        activeCount++
        const monthly = c.amount_per_month ?? (c.amount_per_year != null ? c.amount_per_year / 12 : 0)
        mrr += Number(monthly) || 0
      }
      if (billingHealth(c.expiry_date) === 'expiring') expiring++
    }
    return {
      mrr,
      activeCount,
      expiring,
      totalContracts: contracts.length,
    }
  }, [contracts])

  const ledgerKpis = useMemo(() => {
    let paid = 0
    let open = 0
    const byStatus: Record<string, number> = {}
    for (const inv of allLedgerInvoices) {
      const amt = Number(inv.amount) || 0
      const st = (inv.status || 'draft').toLowerCase()
      byStatus[st] = (byStatus[st] || 0) + 1
      if (st === 'paid') paid += amt
      else if (st !== 'void') open += amt
    }
    return { paid, open, byStatus, count: allLedgerInvoices.length }
  }, [allLedgerInvoices])

  const selectedRow = selectedId != null ? companies.find((c) => c.id === selectedId) : null

  const companyContracts = useMemo(() => {
    if (selectedId == null) return []
    return contracts
      .filter((c) => c.company_id === selectedId)
      .sort((a, b) => (b.expiry_date || '').localeCompare(a.expiry_date || ''))
  }, [contracts, selectedId])

  const primaryActiveContract = useMemo(() => {
    return companyContracts.find((c) => (c.status || '').toLowerCase() === 'active' && c.is_active) || null
  }, [companyContracts])

  const applyPlanToForm = (plan: BillingPlan) => {
    const p = mergePlan(plan)
    const cycle = p.defaultCycle
    const amount = cycle === 'yearly' ? p.suggestedYearly : p.suggestedMonthly
    setBillingForm((f) => ({
      ...f,
      payment_type: cycle,
      billing_plan_code: plan.id,
      payment_amount: amount.toFixed(2),
    }))
    toast.success(`“${p.name}” suggested pricing applied — set period dates and save.`)
  }

  const markInvoicePaid = async (inv: LedgerInvoice) => {
    const st = (inv.status || '').toLowerCase()
    if (st === 'paid' || st === 'void') return
    try {
      await api.put(`/subscription-ledger/invoices/${inv.id}/`, {
        status: 'paid',
        paid_date: new Date().toISOString().split('T')[0],
      })
      toast.success('Invoice marked paid')
      if (selectedId != null) await loadBundle(selectedId)
      await loadBillingContext()
    } catch (e) {
      toast.error(errDetail(e))
    }
  }

  const syncBillingFromErpContract = () => {
    if (!primaryActiveContract) {
      toast.error('No active ERP contract for this tenant.')
      return
    }
    const period = (primaryActiveContract.billing_period || 'monthly').toLowerCase()
    const allowed = ['monthly', 'quarterly', 'half_yearly', 'yearly']
    const paymentType = allowed.includes(period) ? period : 'monthly'
    const amt =
      paymentType === 'yearly' && primaryActiveContract.amount_per_year != null
        ? primaryActiveContract.amount_per_year
        : primaryActiveContract.amount_per_month ?? ''
    setBillingForm((f) => ({
      ...f,
      payment_type: paymentType,
      payment_amount: amt === '' ? f.payment_amount : String(amt),
    }))
    toast.success('Billing profile prefilled from ERP contract (review and save).')
  }

  const saveBillingProfile = async () => {
    if (selectedId == null) return
    setSavingBilling(true)
    try {
      await api.put(`/companies/${selectedId}/`, {
        payment_type: billingForm.payment_type || '',
        payment_start_date: billingForm.payment_start_date || null,
        payment_end_date: billingForm.payment_end_date || null,
        payment_amount: billingForm.payment_amount || null,
        billing_plan_code: billingForm.billing_plan_code || '',
      })
      toast.success('Billing profile saved')
      await refreshAll()
      await loadBundle(selectedId)
    } catch (e) {
      toast.error(errDetail(e))
    } finally {
      setSavingBilling(false)
    }
  }

  const applyExtend = async () => {
    if (selectedId == null || !extendDate.trim()) {
      toast.error('Choose a new subscription end date')
      return
    }
    setExtending(true)
    try {
      await api.post(`/admin/companies/${selectedId}/subscription/extend/`, {
        payment_end_date: extendDate.trim(),
      })
      toast.success('Subscription end date updated')
      await refreshAll()
      await loadBundle(selectedId)
      setBillingForm((f) => ({ ...f, payment_end_date: extendDate.trim() }))
    } catch (e) {
      toast.error(errDetail(e))
    } finally {
      setExtending(false)
    }
  }

  const createInvoice = async () => {
    if (selectedId == null) return
    if (!invoiceForm.amount.trim()) {
      toast.error('Amount is required')
      return
    }
    try {
      const plan = (invoiceForm.billing_plan_code || billingForm.billing_plan_code || '').trim().toLowerCase()
      if (!plan) {
        toast.error('Select a billing plan for this invoice')
        return
      }
      await api.post('/subscription-ledger/invoices/', {
        company_id: selectedId,
        subscription_id: selectedId,
        invoice_number: invoiceForm.invoice_number.trim() || undefined,
        amount: invoiceForm.amount.trim(),
        currency: selectedRow?.currency || 'BDT',
        billing_plan_code: plan,
        billing_cycle: billingForm.payment_type || 'monthly',
        invoice_date: invoiceForm.invoice_date || undefined,
        period_start: invoiceForm.period_start || invoiceForm.invoice_date || undefined,
        period_end: invoiceForm.period_end || undefined,
        due_date: invoiceForm.due_date || undefined,
        status: invoiceForm.status === 'draft' ? 'pending' : invoiceForm.status,
        notes: invoiceForm.notes.trim(),
      })
      toast.success('Invoice created')
      setShowInvoiceForm(false)
      setInvoiceForm({
        invoice_number: '',
        amount: '',
        invoice_date: new Date().toISOString().split('T')[0],
        due_date: '',
        status: 'draft',
        notes: '',
        billing_plan_code: billingForm.billing_plan_code || '',
        period_start: billingForm.payment_start_date || '',
        period_end: billingForm.payment_end_date || '',
      })
      await loadBundle(selectedId)
      await loadBillingContext()
    } catch (e) {
      toast.error(errDetail(e))
    }
  }

  const saveInvoiceEdit = async () => {
    if (!editingInvoice) return
    try {
      await api.put(`/subscription-ledger/invoices/${editingInvoice.id}/`, {
        invoice_number: editingInvoice.invoice_number,
        amount: editingInvoice.amount,
        invoice_date: editingInvoice.invoice_date,
        due_date: editingInvoice.due_date,
        status: editingInvoice.status,
        notes: editingInvoice.notes,
        billing_plan_code: editingInvoice.billing_plan_code || undefined,
        currency: editingInvoice.currency || undefined,
      })
      toast.success('Invoice updated')
      setEditingInvoice(null)
      if (selectedId != null) {
        await loadBundle(selectedId)
        await loadBillingContext()
      }
    } catch (e) {
      toast.error(errDetail(e))
    }
  }

  const deleteInvoice = async (inv: LedgerInvoice) => {
    if (!window.confirm(`Delete invoice ${inv.invoice_number}?`)) return
    try {
      await api.delete(`/subscription-ledger/invoices/${inv.id}/`)
      toast.success('Invoice removed')
      if (selectedId != null) await loadBundle(selectedId)
      await loadBillingContext()
      setEditingInvoice(null)
    } catch (e) {
      toast.error(errDetail(e))
    }
  }

  const filterPills: { id: TenantFilter; label: string }[] = [
    { id: 'all', label: 'All tenants' },
    { id: 'renew_soon', label: 'Renew ≤30d' },
    { id: 'expired', label: 'Expired' },
    { id: 'unset', label: 'No end date' },
  ]

  if (!mode || mode !== 'saas_dashboard') {
    return (
      <div className="flex h-screen bg-slate-100 page-with-sidebar">
        <Sidebar />
        <div className="flex min-h-0 flex-1 overflow-y-auto p-4 sm:p-8">
          <div className="w-full max-w-lg mx-auto rounded-xl bg-white p-8 shadow text-center">
            <CreditCard className="h-12 w-12 text-slate-400 mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-slate-900 mb-2">Subscription &amp; Billing</h2>
            <p className="text-slate-600 mb-4">Switch to SaaS Dashboard mode in the sidebar to manage tenant billing.</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-screen bg-slate-100 page-with-sidebar">
      <Sidebar />
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <header className="shrink-0 border-b border-slate-200/80 bg-white">
          <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 px-4 py-5 sm:px-8 text-white">
            <div className="flex flex-wrap items-start justify-between gap-4 max-w-7xl mx-auto">
              <div>
                <div className="flex items-center gap-2 text-xs text-indigo-200/90 mb-1.5">
                  <Link href="/admin/overview" className="inline-flex items-center gap-1 hover:text-white transition-colors">
                    <ArrowLeft className="h-3.5 w-3.5" />
                    Platform overview
                  </Link>
                  <span className="text-indigo-400">/</span>
                  <span className="text-indigo-100">Revenue operations</span>
                </div>
                <h1 className="text-2xl sm:text-3xl font-bold tracking-tight flex items-center gap-2">
                  <Layers className="h-8 w-8 text-indigo-300 shrink-0" />
                  SaaS subscription control center
                </h1>
                <p className="text-sm text-indigo-100/85 mt-2 max-w-2xl leading-relaxed">
                  Align <strong className="font-semibold text-white">tenant billing</strong> (company record) with{' '}
                  <strong className="font-semibold text-white">ERP contracts</strong> and the{' '}
                  <strong className="font-semibold text-white">subscription ledger</strong> — your internal invoice
                  register, separate from tenant AR/AP.
                </p>
              </div>
              <div className="flex flex-col sm:items-end gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 text-white text-xs font-medium px-3 py-1 border border-white/20 backdrop-blur-sm">
                    <Shield className="h-3.5 w-3.5" />
                    Super Admin
                  </span>
                  <button
                    type="button"
                    onClick={() => refreshAll()}
                    className="inline-flex items-center gap-2 rounded-lg bg-white text-slate-900 px-3 py-2 text-sm font-medium hover:bg-indigo-50 shadow-sm"
                  >
                    <RefreshCw className={`h-4 w-4 ${loading || contextLoading ? 'animate-spin' : ''}`} />
                    Sync data
                  </button>
                </div>
                <nav className="flex flex-wrap gap-2 text-xs">
                  <Link
                    href="/admin/contracts"
                    className="inline-flex items-center gap-1 rounded-md bg-white/10 hover:bg-white/15 px-2.5 py-1.5 border border-white/15"
                  >
                    ERP contracts
                    <ExternalLink className="h-3 w-3 opacity-80" />
                  </Link>
                  <Link
                    href="/admin/subscription-ledger"
                    className="inline-flex items-center gap-1 rounded-md bg-white/10 hover:bg-white/15 px-2.5 py-1.5 border border-white/15"
                  >
                    Full ledger
                    <ChevronRight className="h-3 w-3 opacity-80" />
                  </Link>
                </nav>
              </div>
            </div>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
          <div className="max-w-7xl mx-auto space-y-8">
            <section aria-label="Platform metrics">
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
                <div className="rounded-2xl border border-slate-200/80 bg-white p-4 sm:p-5 shadow-sm ring-1 ring-slate-900/5">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Tenants</p>
                    <Building2 className="h-5 w-5 text-indigo-500 shrink-0" />
                  </div>
                  <p className="text-2xl font-bold text-slate-900 mt-2 tabular-nums">{kpis.total}</p>
                  <p className="text-xs text-slate-500 mt-1">{kpis.active} active · dated subs {kpis.withEnd}</p>
                </div>
                <div className="rounded-2xl border border-amber-200/80 bg-gradient-to-br from-amber-50 to-white p-4 sm:p-5 shadow-sm">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-amber-900/70">Renewal window</p>
                    <CalendarClock className="h-5 w-5 text-amber-600 shrink-0" />
                  </div>
                  <p className="text-2xl font-bold text-amber-800 mt-2 tabular-nums">{kpis.expiring}</p>
                  <p className="text-xs text-amber-800/70 mt-1">Subscription end within 30 days</p>
                </div>
                <div className="rounded-2xl border border-red-200/80 bg-gradient-to-br from-red-50/80 to-white p-4 sm:p-5 shadow-sm">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-red-800/70">Lapsed periods</p>
                    <TrendingUp className="h-5 w-5 text-red-500 rotate-180 shrink-0" />
                  </div>
                  <p className="text-2xl font-bold text-red-700 mt-2 tabular-nums">{kpis.expired}</p>
                  <p className="text-xs text-red-700/70 mt-1">Past payment end date</p>
                </div>
                <div className="rounded-2xl border border-emerald-200/80 bg-gradient-to-br from-emerald-50/90 to-white p-4 sm:p-5 shadow-sm">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-emerald-900/70">Contract MRR</p>
                    <Wallet className="h-5 w-5 text-emerald-600 shrink-0" />
                  </div>
                  <p className="text-xl font-bold text-emerald-900 mt-2 tabular-nums">
                    {formatCurrency(contractKpis.mrr, 'BDT')}
                  </p>
                  <p className="text-xs text-emerald-800/70 mt-1">
                    {contractKpis.activeCount} active ERP contracts · {contractKpis.expiring} expiring ≤30d
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 mt-4">
                <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 flex items-center justify-between gap-3 shadow-sm">
                  <div>
                    <p className="text-xs font-medium text-slate-500">Ledger — marked paid</p>
                    <p className="text-lg font-semibold text-slate-900 tabular-nums">
                      {formatCurrency(ledgerKpis.paid, 'BDT')}
                    </p>
                  </div>
                  <span className="text-xs text-slate-400 max-w-[10rem] text-right">
                    Numeric sum of SaaS ledger; confirm currency per tenant.
                  </span>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 flex items-center justify-between gap-3 shadow-sm">
                  <div>
                    <p className="text-xs font-medium text-slate-500">Ledger — open (excl. void)</p>
                    <p className="text-lg font-semibold text-slate-900 tabular-nums">
                      {formatCurrency(ledgerKpis.open, 'BDT')}
                    </p>
                  </div>
                  <span className="text-xs text-slate-400 max-w-[10rem] text-right">
                    Draft + sent + overdue pipeline
                  </span>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
                  <p className="text-xs font-medium text-slate-500 mb-1">Invoice status mix</p>
                  <div className="flex flex-wrap gap-2">
                    {['paid', 'sent', 'overdue', 'draft', 'void'].map((s) => (
                      <span
                        key={s}
                        className="inline-flex items-center gap-1 rounded-full bg-slate-100 text-slate-700 text-xs px-2 py-0.5 capitalize"
                      >
                        {s}
                        <strong className="tabular-nums">{ledgerKpis.byStatus[s] ?? 0}</strong>
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </section>

            <section aria-label="Reference billing plans" className="space-y-4">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
                    <Sparkles className="h-5 w-5 text-amber-500" />
                    Reference billing plans
                  </h2>
                  <p className="text-sm text-slate-600 mt-1 max-w-3xl">
                    Packaging guide for sales and ops. Selecting a plan prefills the tenant billing profile (cycle +
                    amount); you still set contract dates and save. Amounts are indicative in BDT — adjust per deal.
                    Use the pencil to tune <strong className="font-medium text-slate-800">reference amounts</strong>{' '}
                    in this browser; trash restores defaults. Canonical catalog is on the server (
                    <code className="text-xs bg-slate-100 px-1 rounded">GET /api/admin/billing-plans/</code>).
                  </p>
                </div>
                {!selectedRow && (
                  <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                    Select a tenant in the table to apply a plan to their profile.
                  </p>
                )}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                {BILLING_PLANS.map((plan) => {
                  const displayPlan = mergePlan(plan)
                  const Icon = plan.icon
                  const hasOverride = Boolean(planOverrides[plan.id])
                  return (
                    <div
                      key={plan.id}
                      className={`relative rounded-2xl border-2 bg-white p-5 shadow-sm transition-all ${plan.borderAccent} ${
                        plan.recommended ? 'ring-2 ring-indigo-500/30' : ''
                      }`}
                    >
                      <div className="absolute top-3 right-3 flex items-center gap-0.5">
                        <button
                          type="button"
                          title="Edit reference amounts & bullets (this browser)"
                          onClick={() => openPlanEditor(plan)}
                          className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-indigo-600 transition-colors"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          title={hasOverride ? 'Reset to default reference' : 'No local overrides'}
                          disabled={!hasOverride}
                          onClick={() => resetPlanOverride(plan.id)}
                          className="p-2 rounded-lg text-slate-500 hover:bg-red-50 hover:text-red-600 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                      {plan.recommended && (
                        <span className="absolute -top-2.5 left-4 rounded-full bg-indigo-600 text-white text-[10px] font-bold uppercase tracking-wider px-2 py-0.5">
                          Popular
                        </span>
                      )}
                      <div
                        className={`inline-flex p-2 rounded-xl bg-gradient-to-br ${plan.accent} text-white mb-3 shadow-md`}
                      >
                        <Icon className="h-5 w-5" />
                      </div>
                      <h3 className="text-base font-bold text-slate-900 pr-16">{plan.name}</h3>
                      <p className="text-xs text-slate-500 mt-0.5 mb-3">{displayPlan.tagline}</p>
                      <div className="space-y-1 mb-4">
                        <p className="text-sm text-slate-700">
                          <span className="font-semibold tabular-nums">
                            {formatCurrency(displayPlan.suggestedMonthly, 'BDT')}
                          </span>
                          <span className="text-slate-500"> / mo</span>
                        </p>
                        <p className="text-xs text-slate-500">
                          or{' '}
                          <span className="font-medium tabular-nums text-slate-700">
                            {formatCurrency(displayPlan.suggestedYearly, 'BDT')}
                          </span>{' '}
                          / yr (list)
                        </p>
                      </div>
                      <ul className="text-xs text-slate-600 space-y-1.5 mb-4 min-h-[5.5rem]">
                        {displayPlan.features.map((f) => (
                          <li key={f} className="flex gap-2">
                            <Check className="h-3.5 w-3.5 text-emerald-500 shrink-0 mt-0.5" />
                            <span>{f}</span>
                          </li>
                        ))}
                      </ul>
                      <button
                        type="button"
                        disabled={!selectedRow}
                        onClick={() => applyPlanToForm(plan)}
                        className="w-full rounded-xl bg-slate-900 text-white text-sm font-medium py-2.5 hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                      >
                        Apply to selected tenant
                      </button>
                    </div>
                  )
                })}
              </div>
            </section>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8 items-start">
              <div className="lg:col-span-7 space-y-3">
                <div className="rounded-2xl border border-slate-200/80 bg-white shadow-sm overflow-hidden ring-1 ring-slate-900/5">
                  <div className="p-4 sm:p-5 border-b border-slate-100 bg-slate-50/50">
                    <div className="flex flex-col gap-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <h2 className="text-lg font-semibold text-slate-900">Tenants</h2>
                        <div className="relative flex-1 min-w-[12rem] max-w-md">
                          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                          <input
                            type="search"
                            placeholder="Search name, id, or cycle…"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-slate-200 text-sm bg-white focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                          />
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {filterPills.map((p) => (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => setTenantFilter(p.id)}
                            className={`rounded-full text-xs font-medium px-3 py-1.5 border transition-colors ${
                              tenantFilter === p.id
                                ? 'bg-indigo-600 text-white border-indigo-600'
                                : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
                            }`}
                          >
                            {p.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                  {loading ? (
                    <div className="p-16 text-center text-slate-500 text-sm">Loading companies…</div>
                  ) : (
                    <div className="overflow-x-auto max-h-[min(28rem,50vh)] lg:max-h-[calc(100vh-18rem)] overflow-y-auto">
                      <table className="min-w-full text-sm">
                        <thead className="bg-slate-50 text-left sticky top-0 z-10 shadow-sm">
                          <tr>
                            <th className="px-4 py-3 font-semibold text-slate-700">Company</th>
                            <th className="px-4 py-3 font-semibold text-slate-700">Period</th>
                            <th className="px-4 py-3 font-semibold text-slate-700 text-right">Amount</th>
                            <th className="px-4 py-3 font-semibold text-slate-700">Status</th>
                            <th className="px-4 py-3 font-semibold text-slate-700 text-right w-[7rem]">Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filtered.map((c) => {
                            const h = billingHealth(c.payment_end_date)
                            const sel = selectedId === c.id
                            return (
                              <tr
                                key={c.id}
                                className={`border-t border-slate-100 cursor-pointer transition-colors ${
                                  sel ? 'bg-indigo-50/90' : 'hover:bg-slate-50/80'
                                }`}
                                onClick={() => setSelectedId(c.id)}
                              >
                                <td className="px-4 py-3">
                                  <div className="font-medium text-slate-900">{c.name}</div>
                                  <div className="text-xs text-slate-500">
                                    #{c.id} · {c.currency}
                                    {!c.is_active && (
                                      <span className="ml-2 text-red-600 font-medium">Inactive</span>
                                    )}
                                  </div>
                                </td>
                                <td className="px-4 py-3 text-slate-600">
                                  <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">
                                    {(c.payment_type || '—').replace(/_/g, ' ') || '—'}
                                  </div>
                                  {c.payment_end_date ? (
                                    <div className="tabular-nums text-slate-800">Until {c.payment_end_date.split('T')[0]}</div>
                                  ) : (
                                    <span className="text-slate-400">No end date</span>
                                  )}
                                </td>
                                <td className="px-4 py-3 text-right tabular-nums text-slate-800 font-medium">
                                  {c.payment_amount != null && c.payment_amount !== ''
                                    ? formatCurrency(Number(c.payment_amount), c.currency || 'BDT')
                                    : '—'}
                                </td>
                                <td className="px-4 py-3">
                                  {h === 'none' && (
                                    <span className="inline-flex rounded-full bg-slate-100 text-slate-600 text-xs px-2.5 py-0.5 font-medium">
                                      Not set
                                    </span>
                                  )}
                                  {h === 'active' && (
                                    <span className="inline-flex rounded-full bg-emerald-100 text-emerald-800 text-xs px-2.5 py-0.5 font-medium">
                                      Active
                                    </span>
                                  )}
                                  {h === 'expiring' && (
                                    <span className="inline-flex rounded-full bg-amber-100 text-amber-900 text-xs px-2.5 py-0.5 font-medium">
                                      Renew soon
                                    </span>
                                  )}
                                  {h === 'expired' && (
                                    <span className="inline-flex rounded-full bg-red-100 text-red-800 text-xs px-2.5 py-0.5 font-medium">
                                      Expired
                                    </span>
                                  )}
                                </td>
                                <td
                                  className="px-3 py-2 text-right"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <div className="inline-flex items-center justify-end gap-0.5">
                                    <Link
                                      href={`/admin/companies?search=${encodeURIComponent(c.name)}`}
                                      className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-indigo-600 transition-colors"
                                      title="Open company directory (search this tenant)"
                                    >
                                      <SquarePen className="h-4 w-4" />
                                    </Link>
                                    <Link
                                      href={`/admin/subscription-ledger?company_id=${c.id}`}
                                      className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-indigo-600 transition-colors"
                                      title="Subscription ledger filtered to this tenant"
                                    >
                                      <FileText className="h-4 w-4" />
                                    </Link>
                                  </div>
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                      {filtered.length === 0 && (
                        <p className="p-10 text-center text-slate-500 text-sm">No tenants match filters.</p>
                      )}
                    </div>
                  )}
                </div>
              </div>

              <div className="lg:col-span-5 space-y-4 lg:sticky lg:top-4">
                {!selectedId || !selectedRow ? (
                  <div className="rounded-2xl border border-dashed border-slate-300 bg-white/90 p-10 text-center shadow-sm">
                    <FileText className="h-10 w-10 text-slate-300 mx-auto mb-3" />
                    <p className="text-slate-700 font-semibold">Select a tenant</p>
                    <p className="text-sm text-slate-500 mt-2 leading-relaxed">
                      Manage SaaS billing fields, extend subscription dates, and maintain ledger invoices. Link ERP
                      contracts for legal and commercial terms.
                    </p>
                  </div>
                ) : bundleLoading && !bundle ? (
                  <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-slate-500 text-sm shadow-sm">
                    Loading billing data…
                  </div>
                ) : (
                  <>
                    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-5 ring-1 ring-slate-900/5">
                      <h3 className="text-base font-semibold text-slate-900 flex items-center gap-2">
                        <Building2 className="h-5 w-5 text-indigo-600 shrink-0" />
                        {bundle?.company_name || selectedRow.name}
                      </h3>
                      <p className="text-xs text-slate-500 mt-1.5">
                        Users: {selectedRow.user_count ?? '—'} · Billing display currency{' '}
                        <span className="font-medium text-slate-700">{selectedRow.currency}</span>
                      </p>
                    </div>

                    <div className="rounded-2xl border border-indigo-200/80 bg-gradient-to-b from-indigo-50/80 to-white shadow-sm p-5 space-y-4 ring-1 ring-indigo-900/5">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <h4 className="text-sm font-semibold text-indigo-950 flex items-center gap-2">
                            <FileText className="h-4 w-4 shrink-0" />
                            ERP contract (integration)
                          </h4>
                          <p className="text-xs text-indigo-900/75 mt-1 leading-relaxed">
                            Contracts are the system of record for license terms. Sync suggested SaaS billing fields from
                            the active contract, or open Contract Management to edit.
                          </p>
                        </div>
                        <Link
                          href="/admin/contracts"
                          className="shrink-0 text-xs font-medium text-indigo-700 hover:text-indigo-900 inline-flex items-center gap-0.5"
                        >
                          Open
                          <ChevronRight className="h-3.5 w-3.5" />
                        </Link>
                      </div>
                      {companyContracts.length === 0 ? (
                        <p className="text-sm text-slate-600 bg-white/80 rounded-xl border border-indigo-100 px-3 py-3">
                          No ERP contracts linked to this company. Create one in Contract Management to align billing
                          and legal terms.
                        </p>
                      ) : (
                        <ul className="space-y-2 max-h-40 overflow-y-auto">
                          {companyContracts.slice(0, 6).map((ct) => {
                            const ch = billingHealth(ct.expiry_date)
                            return (
                              <li
                                key={ct.id}
                                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-indigo-100 bg-white px-3 py-2.5 text-xs"
                              >
                                <div>
                                  <span className="font-mono font-semibold text-slate-800">{ct.contract_number}</span>
                                  <span className="text-slate-400 mx-1">·</span>
                                  <span className="capitalize text-slate-600">{ct.status}</span>
                                  {ct.expiry_date && (
                                    <span className="block text-slate-500 mt-0.5">
                                      Expires {ct.expiry_date.split('T')[0]}
                                    </span>
                                  )}
                                </div>
                                <div className="flex items-center gap-1 shrink-0">
                                  {ch === 'expiring' && (
                                    <span className="rounded-full bg-amber-100 text-amber-900 px-2 py-0.5 font-medium">
                                      Expiring
                                    </span>
                                  )}
                                  {ch === 'expired' && (
                                    <span className="rounded-full bg-red-100 text-red-800 px-2 py-0.5 font-medium">
                                      Lapsed
                                    </span>
                                  )}
                                  <Link
                                    href="/admin/contracts"
                                    className="p-1.5 rounded-lg text-indigo-600 hover:bg-indigo-50"
                                    title="Open contract management"
                                  >
                                    <ExternalLink className="h-4 w-4" />
                                  </Link>
                                </div>
                              </li>
                            )
                          })}
                        </ul>
                      )}
                      <button
                        type="button"
                        onClick={syncBillingFromErpContract}
                        disabled={!primaryActiveContract}
                        className="w-full rounded-xl border border-indigo-300 bg-white text-indigo-900 text-sm font-medium py-2.5 hover:bg-indigo-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                      >
                        Copy terms from active contract into billing profile
                      </button>
                    </div>

                    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-5 space-y-4 ring-1 ring-slate-900/5">
                      <h4 className="text-sm font-semibold text-slate-800 flex items-center gap-2">
                        <CreditCard className="h-4 w-4 shrink-0" />
                        SaaS billing profile
                      </h4>
                      <p className="text-xs text-slate-500 leading-relaxed">
                        Stored on the company record — operational mirror of recurring commercials. Does not post to
                        tenant GL; use ERP sales modules for customer invoicing.
                      </p>
                      <div className="grid gap-3">
                        <label className="block">
                          <span className="text-xs font-semibold text-slate-600">Billing plan</span>
                          <select
                            value={billingForm.billing_plan_code}
                            onChange={(e) => setBillingForm({ ...billingForm, billing_plan_code: e.target.value })}
                            className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm bg-white focus:ring-2 focus:ring-indigo-500"
                          >
                            <option value="">— Not set —</option>
                            {saasPlanCatalog.map((p) => (
                              <option key={p.code} value={p.code}>
                                {p.name}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="block">
                          <span className="text-xs font-semibold text-slate-600">Billing cycle</span>
                          <select
                            value={billingForm.payment_type}
                            onChange={(e) => setBillingForm({ ...billingForm, payment_type: e.target.value })}
                            className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm bg-white focus:ring-2 focus:ring-indigo-500"
                          >
                            {PAYMENT_TYPE_OPTIONS.map((o) => (
                              <option key={o.value || 'empty'} value={o.value}>
                                {o.label}
                              </option>
                            ))}
                          </select>
                        </label>
                        <div className="grid grid-cols-2 gap-2">
                          <label className="block">
                            <span className="text-xs font-semibold text-slate-600">Period start</span>
                            <input
                              type="date"
                              value={billingForm.payment_start_date}
                              onChange={(e) =>
                                setBillingForm({ ...billingForm, payment_start_date: e.target.value })
                              }
                              className="mt-1.5 w-full rounded-xl border border-slate-200 px-2 py-2.5 text-sm"
                            />
                          </label>
                          <label className="block">
                            <span className="text-xs font-semibold text-slate-600">Period end</span>
                            <input
                              type="date"
                              value={billingForm.payment_end_date}
                              onChange={(e) =>
                                setBillingForm({ ...billingForm, payment_end_date: e.target.value })
                              }
                              className="mt-1.5 w-full rounded-xl border border-slate-200 px-2 py-2.5 text-sm"
                            />
                          </label>
                        </div>
                        <label className="block">
                          <span className="text-xs font-semibold text-slate-600">Quoted recurring amount</span>
                          <input
                            type="text"
                            inputMode="decimal"
                            value={billingForm.payment_amount}
                            onChange={(e) => setBillingForm({ ...billingForm, payment_amount: e.target.value })}
                            placeholder="e.g. 15000.00"
                            className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm"
                          />
                        </label>
                        <button
                          type="button"
                          disabled={savingBilling}
                          onClick={saveBillingProfile}
                          className="w-full rounded-xl bg-slate-900 text-white text-sm font-semibold py-3 hover:bg-slate-800 disabled:opacity-50 transition-colors"
                        >
                          {savingBilling ? 'Saving…' : 'Save billing profile'}
                        </button>
                      </div>
                    </div>

                    <div className="rounded-2xl border border-indigo-200 bg-indigo-50/40 shadow-sm p-5 space-y-3">
                      <h4 className="text-sm font-semibold text-indigo-950 flex items-center gap-2">
                        <CalendarClock className="h-4 w-4 shrink-0" />
                        Quick extend subscription
                      </h4>
                      <p className="text-xs text-indigo-900/80 leading-relaxed">
                        Updates <strong className="font-semibold">payment end date</strong> only. If amount or cycle
                        changed, update the billing profile above.
                      </p>
                      <div className="flex flex-wrap gap-2 items-end">
                        <label className="flex-1 min-w-[10rem]">
                          <span className="text-xs font-semibold text-indigo-900">New end date</span>
                          <input
                            type="date"
                            value={extendDate}
                            onChange={(e) => setExtendDate(e.target.value)}
                            className="mt-1.5 w-full rounded-xl border border-indigo-200 bg-white px-2 py-2.5 text-sm"
                          />
                        </label>
                        <button
                          type="button"
                          disabled={extending}
                          onClick={applyExtend}
                          className="rounded-xl bg-indigo-600 text-white text-sm font-semibold px-5 py-2.5 hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                        >
                          {extending ? 'Applying…' : 'Apply'}
                        </button>
                      </div>
                    </div>

                    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-5 space-y-4 ring-1 ring-slate-900/5">
                      <div className="flex items-center justify-between gap-2">
                        <h4 className="text-sm font-semibold text-slate-800 flex items-center gap-2">
                          <FileText className="h-4 w-4 shrink-0" />
                          Subscription ledger
                        </h4>
                        <button
                          type="button"
                          onClick={() => {
                            setShowInvoiceForm((v) => !v)
                            setInvoiceForm((f) => ({
                              ...f,
                              invoice_date: new Date().toISOString().split('T')[0],
                              billing_plan_code: billingForm.billing_plan_code || f.billing_plan_code,
                              period_start: billingForm.payment_start_date || f.period_start,
                              period_end: billingForm.payment_end_date || f.period_end,
                            }))
                          }}
                          className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 text-white text-xs font-semibold px-3 py-2 hover:bg-indigo-700"
                        >
                          <Plus className="h-3.5 w-3.5" />
                          New invoice
                        </button>
                      </div>
                      <p className="text-xs text-slate-500 leading-relaxed">
                        Internal SaaS invoice register for this tenant.{' '}
                        <Link href="/admin/subscription-ledger" className="text-indigo-600 font-medium hover:underline">
                          Global ledger view
                        </Link>
                        .
                      </p>

                      {showInvoiceForm && (
                        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3 text-sm">
                          <div className="flex justify-between items-center">
                            <span className="font-semibold text-slate-800">New invoice</span>
                            <button type="button" onClick={() => setShowInvoiceForm(false)} className="text-slate-500 p-1">
                              <X className="h-4 w-4" />
                            </button>
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <select
                              title="Billing plan"
                              value={invoiceForm.billing_plan_code}
                              onChange={(e) => setInvoiceForm({ ...invoiceForm, billing_plan_code: e.target.value })}
                              className="rounded-lg border border-slate-200 px-2 py-2 text-sm col-span-2"
                            >
                              <option value="">Billing plan *</option>
                              {saasPlanCatalog.map((p) => (
                                <option key={p.code} value={p.code}>
                                  {p.name}
                                </option>
                              ))}
                            </select>
                            <input
                              placeholder="Invoice # (optional)"
                              value={invoiceForm.invoice_number}
                              onChange={(e) => setInvoiceForm({ ...invoiceForm, invoice_number: e.target.value })}
                              className="rounded-lg border border-slate-200 px-2 py-2 text-sm"
                            />
                            <input
                              placeholder="Amount *"
                              value={invoiceForm.amount}
                              onChange={(e) => setInvoiceForm({ ...invoiceForm, amount: e.target.value })}
                              className="rounded-lg border border-slate-200 px-2 py-2 text-sm"
                            />
                            <input
                              type="date"
                              title="Period start"
                              value={invoiceForm.period_start}
                              onChange={(e) => setInvoiceForm({ ...invoiceForm, period_start: e.target.value })}
                              className="rounded-lg border border-slate-200 px-2 py-2 text-sm"
                            />
                            <input
                              type="date"
                              title="Period end"
                              value={invoiceForm.period_end}
                              onChange={(e) => setInvoiceForm({ ...invoiceForm, period_end: e.target.value })}
                              className="rounded-lg border border-slate-200 px-2 py-2 text-sm"
                            />
                            <input
                              type="date"
                              title="Invoice date"
                              value={invoiceForm.invoice_date}
                              onChange={(e) => setInvoiceForm({ ...invoiceForm, invoice_date: e.target.value })}
                              className="rounded-lg border border-slate-200 px-2 py-2 text-sm"
                            />
                            <input
                              type="date"
                              title="Due date"
                              value={invoiceForm.due_date}
                              onChange={(e) => setInvoiceForm({ ...invoiceForm, due_date: e.target.value })}
                              className="rounded-lg border border-slate-200 px-2 py-2 text-sm"
                            />
                            <select
                              value={invoiceForm.status}
                              onChange={(e) => setInvoiceForm({ ...invoiceForm, status: e.target.value })}
                              className="rounded-lg border border-slate-200 px-2 py-2 text-sm col-span-2"
                            >
                              {INVOICE_STATUS_OPTIONS.map((s) => (
                                <option key={s} value={s}>
                                  {s}
                                </option>
                              ))}
                            </select>
                            <input
                              placeholder="Notes"
                              value={invoiceForm.notes}
                              onChange={(e) => setInvoiceForm({ ...invoiceForm, notes: e.target.value })}
                              className="rounded-lg border border-slate-200 px-2 py-2 text-sm col-span-2"
                            />
                          </div>
                          <button
                            type="button"
                            onClick={createInvoice}
                            className="w-full rounded-xl bg-emerald-600 text-white text-sm py-2.5 font-semibold hover:bg-emerald-700"
                          >
                            Create invoice
                          </button>
                        </div>
                      )}

                      <div className="max-h-56 overflow-y-auto border border-slate-100 rounded-xl">
                        {!bundle?.invoices?.length ? (
                          <p className="p-6 text-sm text-slate-500 text-center">No ledger invoices yet.</p>
                        ) : (
                          <table className="min-w-full text-xs">
                            <thead className="bg-slate-50 text-left sticky top-0 z-[1]">
                              <tr>
                                <th className="px-3 py-2 font-semibold text-slate-700">#</th>
                                <th className="px-3 py-2 font-semibold text-slate-700 text-right">Amount</th>
                                <th className="px-3 py-2 font-semibold text-slate-700">Status</th>
                                <th className="px-3 py-2 w-16" />
                              </tr>
                            </thead>
                            <tbody>
                              {bundle.invoices.map((inv) => (
                                <tr key={inv.id} className="border-t border-slate-100 hover:bg-slate-50/50">
                                  <td className="px-3 py-2">
                                    <div className="font-mono text-slate-800">{inv.invoice_number}</div>
                                    <div className="text-slate-400">{inv.invoice_date || '—'}</div>
                                  </td>
                                  <td className="px-3 py-2 text-right tabular-nums font-medium">
                                    {formatCurrency(Number(inv.amount), selectedRow.currency || 'BDT')}
                                  </td>
                                  <td className="px-3 py-2 capitalize">
                                    <span
                                      className={`inline-flex rounded-full px-2 py-0.5 font-medium ${
                                        inv.status === 'paid'
                                          ? 'bg-emerald-100 text-emerald-800'
                                          : inv.status === 'overdue'
                                            ? 'bg-red-100 text-red-800'
                                            : inv.status === 'sent'
                                              ? 'bg-blue-100 text-blue-800'
                                              : 'bg-slate-100 text-slate-700'
                                      }`}
                                    >
                                      {inv.status}
                                    </span>
                                  </td>
                                  <td className="px-3 py-2 text-right whitespace-nowrap">
                                    <div className="inline-flex items-center gap-0.5 justify-end">
                                      {(inv.status || '').toLowerCase() !== 'paid' &&
                                        (inv.status || '').toLowerCase() !== 'void' && (
                                          <button
                                            type="button"
                                            onClick={() => markInvoicePaid(inv)}
                                            className="text-emerald-600 hover:bg-emerald-50 p-1 rounded"
                                            title="Mark paid"
                                          >
                                            <Banknote className="h-3.5 w-3.5" />
                                          </button>
                                        )}
                                      <button
                                        type="button"
                                        onClick={() => setEditingInvoice({ ...inv })}
                                        className="text-indigo-600 hover:bg-indigo-50 p-1 rounded"
                                        title="Edit"
                                      >
                                        <Pencil className="h-3.5 w-3.5" />
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => deleteInvoice(inv)}
                                        className="text-red-600 hover:bg-red-50 p-1 rounded"
                                        title="Delete"
                                      >
                                        <Trash2 className="h-3.5 w-3.5" />
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {planEditOpen && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/40 backdrop-blur-[2px]">
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full p-6 space-y-4 ring-1 ring-slate-900/10 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-start gap-3">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">Edit reference plan</h3>
                <p className="text-xs text-slate-500 mt-1">
                  {planEditOpen.name} — changes apply to this page only (stored in your browser). Server catalog is
                  unchanged.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPlanEditOpen(null)}
                className="text-slate-400 hover:text-slate-600 p-1 shrink-0"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-3 text-sm">
              <label className="block">
                <span className="text-xs font-semibold text-slate-600">Tagline</span>
                <input
                  value={planEditForm.tagline}
                  onChange={(e) => setPlanEditForm({ ...planEditForm, tagline: e.target.value })}
                  className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2"
                />
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="text-xs font-semibold text-slate-600">Monthly (BDT)</span>
                  <input
                    type="number"
                    step="0.01"
                    value={planEditForm.suggestedMonthly}
                    onChange={(e) => setPlanEditForm({ ...planEditForm, suggestedMonthly: e.target.value })}
                    className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2"
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-semibold text-slate-600">Yearly (BDT)</span>
                  <input
                    type="number"
                    step="0.01"
                    value={planEditForm.suggestedYearly}
                    onChange={(e) => setPlanEditForm({ ...planEditForm, suggestedYearly: e.target.value })}
                    className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2"
                  />
                </label>
              </div>
              <label className="block">
                <span className="text-xs font-semibold text-slate-600">Feature bullets (one per line)</span>
                <textarea
                  rows={6}
                  value={planEditForm.featuresText}
                  onChange={(e) => setPlanEditForm({ ...planEditForm, featuresText: e.target.value })}
                  className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2 font-mono text-xs"
                />
              </label>
            </div>
            <div className="flex flex-wrap gap-2 justify-end pt-2">
              <button
                type="button"
                onClick={() => setPlanEditOpen(null)}
                className="px-4 py-2 rounded-xl border border-slate-300 text-sm font-medium hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  if (planEditOpen) resetPlanOverride(planEditOpen.id)
                  setPlanEditOpen(null)
                }}
                className="px-4 py-2 rounded-xl border border-red-200 text-red-700 text-sm font-medium hover:bg-red-50"
              >
                Reset default
              </button>
              <button
                type="button"
                onClick={savePlanDisplayEdit}
                className="px-4 py-2 rounded-xl bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {editingInvoice && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/40 backdrop-blur-[2px]">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 space-y-4 ring-1 ring-slate-900/10">
            <div className="flex justify-between items-center">
              <h3 className="text-lg font-semibold text-slate-900">Edit invoice</h3>
              <button type="button" onClick={() => setEditingInvoice(null)} className="text-slate-400 hover:text-slate-600 p-1">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-3 text-sm">
              <label className="block">
                <span className="text-xs font-semibold text-slate-600">Invoice #</span>
                <input
                  value={editingInvoice.invoice_number}
                  onChange={(e) => setEditingInvoice({ ...editingInvoice, invoice_number: e.target.value })}
                  className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2"
                />
              </label>
              <label className="block">
                <span className="text-xs font-semibold text-slate-600">Amount</span>
                <input
                  value={editingInvoice.amount}
                  onChange={(e) => setEditingInvoice({ ...editingInvoice, amount: e.target.value })}
                  className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2"
                />
              </label>
              <label className="block">
                <span className="text-xs font-semibold text-slate-600">Billing plan</span>
                <select
                  value={editingInvoice.billing_plan_code || ''}
                  onChange={(e) => setEditingInvoice({ ...editingInvoice, billing_plan_code: e.target.value })}
                  className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2"
                >
                  <option value="">—</option>
                  {saasPlanCatalog.map((p) => (
                    <option key={p.code} value={p.code}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-xs font-semibold text-slate-600">Currency</span>
                <input
                  value={editingInvoice.currency || selectedRow?.currency || 'BDT'}
                  onChange={(e) =>
                    setEditingInvoice({ ...editingInvoice, currency: e.target.value.toUpperCase().slice(0, 3) })
                  }
                  maxLength={3}
                  className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2"
                />
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="text-xs font-semibold text-slate-600">Invoice date</span>
                  <input
                    type="date"
                    value={(editingInvoice.invoice_date || '').split('T')[0]}
                    onChange={(e) => setEditingInvoice({ ...editingInvoice, invoice_date: e.target.value })}
                    className="mt-1 w-full border border-slate-200 rounded-xl px-2 py-2"
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-semibold text-slate-600">Due date</span>
                  <input
                    type="date"
                    value={(editingInvoice.due_date || '').split('T')[0]}
                    onChange={(e) => setEditingInvoice({ ...editingInvoice, due_date: e.target.value || '' })}
                    className="mt-1 w-full border border-slate-200 rounded-xl px-2 py-2"
                  />
                </label>
              </div>
              <label className="block">
                <span className="text-xs font-semibold text-slate-600">Status</span>
                <select
                  value={editingInvoice.status}
                  onChange={(e) => setEditingInvoice({ ...editingInvoice, status: e.target.value })}
                  className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2"
                >
                  {INVOICE_STATUS_OPTIONS.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-xs font-semibold text-slate-600">Notes</span>
                <textarea
                  value={editingInvoice.notes}
                  onChange={(e) => setEditingInvoice({ ...editingInvoice, notes: e.target.value })}
                  rows={2}
                  className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2"
                />
              </label>
            </div>
            <div className="flex gap-2 justify-end pt-2">
              <button
                type="button"
                onClick={() => setEditingInvoice(null)}
                className="px-4 py-2 rounded-xl border border-slate-300 text-sm font-medium hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={saveInvoiceEdit}
                className="px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default function SubscriptionBillingPage() {
  return (
    <CompanyProvider>
      <SubscriptionBillingContent />
    </CompanyProvider>
  )
}
