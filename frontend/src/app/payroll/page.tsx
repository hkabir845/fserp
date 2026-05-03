'use client'

import { useCallback, useEffect, useMemo, useState, useRef } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import Sidebar from '@/components/Sidebar'
import { Plus, Eye, DollarSign, X, Calendar, FileText, CheckCircle, Clock, XCircle, Edit2, Trash2, BookOpen, RefreshCw, Landmark, ArrowRight, User } from 'lucide-react'
import { useToast } from '@/components/Toast'
import { getCurrencySymbol, formatNumber, formatAmountPlain } from '@/utils/currency'
import { formatDateOnly } from '@/utils/date'
import { getApiBaseUrl } from '@/lib/api'
import { isTenantAdminAquacultureUser } from '@/navigation/erpAppMenu'

interface PayrollRun {
  id: number
  payroll_number: string
  pay_period_start: string
  pay_period_end: string
  payment_date: string
  base_salary_total?: number
  overtime_amount?: number
  bonus_amount?: number
  other_earnings_amount?: number
  total_gross: number
  total_deductions: number
  total_net: number
  status: string
  notes?: string
  salary_journal_entry_id?: number | null
  salary_journal_entry_number?: string
  is_salary_posted?: boolean
  message?: string
  created_at: string
  updated_at: string
  pond_allocations?: { pond_id: number; pond_name?: string; amount: string }[]
}

function parseMoneyInput(s: string): number {
  const t = s.trim()
  if (t === '') return 0
  const n = Number(t)
  return Number.isFinite(n) ? n : 0
}

function sumEarningInputs(base: string, ot: string, bonus: string, other: string): number {
  return (
    parseMoneyInput(base) +
    parseMoneyInput(ot) +
    parseMoneyInput(bonus) +
    parseMoneyInput(other)
  )
}

function detailAmountsFromPayrollApi(data: PayrollRun) {
  return {
    base: data.base_salary_total != null ? String(data.base_salary_total) : '',
    ot: data.overtime_amount != null ? String(data.overtime_amount) : '',
    bonus: data.bonus_amount != null ? String(data.bonus_amount) : '',
    other: data.other_earnings_amount != null ? String(data.other_earnings_amount) : '',
    d: data.total_deductions != null ? String(data.total_deductions) : '',
    n: data.total_net != null ? String(data.total_net) : '',
  }
}

interface BankAccountRow {
  id: number
  account_name: string
  bank_name: string
  chart_account_id: number | null
  is_active?: boolean
  is_equity_register?: boolean
}

/** Bank / cash–type GL lines suitable for crediting net pay. */
interface GlPayAccountRow {
  id: number
  account_code: string
  account_name: string
  account_type: string
  is_active: boolean
}

function isGlValidForNetPayCredit(a: GlPayAccountRow) {
  if (a.is_active === false) return false
  const t = (a.account_type || '').toLowerCase()
  return t === 'asset' || t === 'bank_account'
}

interface EmployeeRow {
  id: number
  employee_number: string
  first_name: string
  last_name: string
  salary: number | null
  is_active: boolean
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
    notes: '',
    base_salary_total: '',
    overtime_amount: '',
    bonus_amount: '',
    other_earnings_amount: '',
    total_deductions: '',
    total_net: '',
  })

  const formComputedGross = useMemo(
    () =>
      sumEarningInputs(
        formData.base_salary_total,
        formData.overtime_amount,
        formData.bonus_amount,
        formData.other_earnings_amount
      ),
    [
      formData.base_salary_total,
      formData.overtime_amount,
      formData.bonus_amount,
      formData.other_earnings_amount,
    ]
  )
  const [bankRegisters, setBankRegisters] = useState<BankAccountRow[]>([])
  const [glPayAccounts, setGlPayAccounts] = useState<GlPayAccountRow[]>([])
  /** Shown in details: 6400 is not user-pickable; we resolve it from the chart for display. */
  const [salaryExpenseCoa, setSalaryExpenseCoa] = useState<{
    account_code: string
    account_name: string
  } | null>(null)
  const [payFromSelect, setPayFromSelect] = useState<string>('')
  const payFromTouched = useRef(false)
  const [amountSaving, setAmountSaving] = useState(false)
  const [actionLoading, setActionLoading] = useState(false)
  const [detailAmounts, setDetailAmounts] = useState({
    base: '',
    ot: '',
    bonus: '',
    other: '',
    d: '',
    n: '',
  })

  const detailComputedGross = useMemo(
    () =>
      sumEarningInputs(detailAmounts.base, detailAmounts.ot, detailAmounts.bonus, detailAmounts.other),
    [detailAmounts.base, detailAmounts.ot, detailAmounts.bonus, detailAmounts.other]
  )
  const [employees, setEmployees] = useState<EmployeeRow[]>([])
  const [oneEmployeeId, setOneEmployeeId] = useState<string>('')
  const [aquacultureEnabled, setAquacultureEnabled] = useState(false)
  /** Matches backend: pond APIs and splits are tenant Admin (or platform super-admin) only. */
  const [aquacultureOpsUnlocked, setAquacultureOpsUnlocked] = useState(false)
  const [aquaculturePonds, setAquaculturePonds] = useState<{ id: number; name: string; is_active?: boolean }[]>([])
  const [pondAllocDraft, setPondAllocDraft] = useState<{ pond_id: string; amount: string }[]>([])

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const raw = localStorage.getItem('user')
      if (!raw || raw === 'undefined' || raw === 'null') {
        setAquacultureOpsUnlocked(false)
        return
      }
      const u = JSON.parse(raw) as { role?: string }
      const r = typeof u?.role === 'string' ? u.role.toLowerCase() : null
      setAquacultureOpsUnlocked(isTenantAdminAquacultureUser(r, r === 'super_admin'))
    } catch {
      setAquacultureOpsUnlocked(false)
    }
  }, [])

  const applyPayrollResponseToDetailState = useCallback((data: PayrollRun) => {
    setSelectedPayroll(data)
    setDetailAmounts(detailAmountsFromPayrollApi(data))
    if (Array.isArray(data.pond_allocations) && data.pond_allocations.length > 0) {
      setPondAllocDraft(
        data.pond_allocations.map((x: { pond_id: number; amount: string | number }) => ({
          pond_id: String(x.pond_id),
          amount: String(x.amount ?? ''),
        }))
      )
    } else if (aquaculturePonds.length > 0) {
      setPondAllocDraft(aquaculturePonds.map((p) => ({ pond_id: String(p.id), amount: '' })))
    } else {
      setPondAllocDraft([])
    }
  }, [aquaculturePonds])

  useEffect(() => {
    const token = localStorage.getItem('access_token')
    if (!token) {
      router.push('/login')
      return
    }
    fetchCompanyCurrency()
    fetchPayrolls()
    fetchBankAccounts()
    fetchGlPayAccounts()
  }, [router])

  useEffect(() => {
    const token = localStorage.getItem('access_token')
    if (!token) return
    const baseUrl = getApiBaseUrl()
    void (async () => {
      try {
        const r = await fetch(`${baseUrl}/companies/current/`, {
          headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
          mode: 'cors',
          credentials: 'omit',
        })
        if (!r.ok) return
        const cj = await r.json()
        const en = Boolean(cj.aquaculture_enabled)
        setAquacultureEnabled(en)
        if (!en) {
          setAquaculturePonds([])
          return
        }
        if (!aquacultureOpsUnlocked) {
          setAquaculturePonds([])
          return
        }
        const pr = await fetch(`${baseUrl}/aquaculture/ponds/`, {
          headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
          mode: 'cors',
          credentials: 'omit',
        })
        if (!pr.ok) {
          setAquaculturePonds([])
          return
        }
        const pj = await pr.json()
        setAquaculturePonds(
          Array.isArray(pj)
            ? pj.map((x: { id: number; name: string; is_active?: boolean }) => ({
                id: x.id,
                name: (x.name || `Pond ${x.id}`).trim() || `Pond ${x.id}`,
                is_active: x.is_active,
              }))
            : []
        )
      } catch {
        setAquacultureEnabled(false)
        setAquaculturePonds([])
      }
    })()
  }, [aquacultureOpsUnlocked])

  function defaultPayFromSelect(
    banks: BankAccountRow[],
    coas: GlPayAccountRow[]
  ): string {
    const linked = banks.find((b) => b.chart_account_id)
    if (linked) return `b:${linked.id}`
    const byCode = (code: string) => coas.find((c) => c.account_code === code)
    const c = byCode('1030') || byCode('1010') || byCode('1020') || coas[0]
    if (c) return `c:${c.id}`
    return ''
  }

  useEffect(() => {
    if (!showDetailsModal || !selectedPayroll) return
    if (payFromTouched.current) return
    setPayFromSelect(defaultPayFromSelect(bankRegisters, glPayAccounts))
  }, [showDetailsModal, selectedPayroll?.id, bankRegisters, glPayAccounts])

  const fetchEmployees = async () => {
    try {
      const token = localStorage.getItem('access_token')
      const baseUrl = getApiBaseUrl()
      const response = await fetch(`${baseUrl}/employees/`, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
        mode: 'cors',
        credentials: 'omit',
      })
      if (response.ok) {
        const data: EmployeeRow[] = await response.json()
        setEmployees(data || [])
      }
    } catch (e) {
      console.error(e)
    }
  }

  useEffect(() => {
    if (showDetailsModal) {
      fetchEmployees()
    }
  }, [showDetailsModal])

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

  const fetchBankAccounts = async () => {
    try {
      const token = localStorage.getItem('access_token')
      const baseUrl = getApiBaseUrl()
      const response = await fetch(`${baseUrl}/bank-accounts/`, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
        mode: 'cors',
        credentials: 'omit',
      })
      if (response.ok) {
        const data: BankAccountRow[] = await response.json()
        setBankRegisters(
          (data || []).filter((b) => b.is_active !== false && !b.is_equity_register)
        )
      }
    } catch (e) {
      console.error(e)
    }
  }

  const fetchGlPayAccounts = async () => {
    try {
      const token = localStorage.getItem('access_token')
      const baseUrl = getApiBaseUrl()
      const response = await fetch(`${baseUrl}/chart-of-accounts/`, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
        mode: 'cors',
        credentials: 'omit',
      })
      if (response.ok) {
        const raw: GlPayAccountRow[] = await response.json()
        setGlPayAccounts((raw || []).filter(isGlValidForNetPayCredit))
        const exp = (raw || []).find(
          (a) => String(a.account_code).trim() === '6400' && a.is_active !== false
        )
        setSalaryExpenseCoa(
          exp
            ? { account_code: String(exp.account_code), account_name: exp.account_name }
            : null
        )
      }
    } catch (e) {
      console.error(e)
    }
  }

  const resetForm = () => {
    setFormData({
      pay_period_start: '',
      pay_period_end: '',
      payment_date: '',
      notes: '',
      base_salary_total: '',
      overtime_amount: '',
      bonus_amount: '',
      other_earnings_amount: '',
      total_deductions: '',
      total_net: '',
    })
    setEditingId(null)
  }

  const handleEdit = (payroll: PayrollRun) => {
    setEditingId(payroll.id)
    setFormData({
      pay_period_start: payroll.pay_period_start || '',
      pay_period_end: payroll.pay_period_end || '',
      payment_date: payroll.payment_date || '',
      notes: payroll.notes || '',
      base_salary_total:
        payroll.base_salary_total != null ? String(payroll.base_salary_total) : '',
      overtime_amount: payroll.overtime_amount != null ? String(payroll.overtime_amount) : '',
      bonus_amount: payroll.bonus_amount != null ? String(payroll.bonus_amount) : '',
      other_earnings_amount:
        payroll.other_earnings_amount != null ? String(payroll.other_earnings_amount) : '',
      total_deductions: payroll.total_deductions != null ? String(payroll.total_deductions) : '',
      total_net: payroll.total_net != null ? String(payroll.total_net) : '',
    })
    setShowModal(true)
  }

  /** Earnings breakdown + deductions; server derives total gross from the four earning lines. */
  const payrollAmountsPayload = () => {
    const nField = formData.total_net.trim()
    return {
      base_salary_total: parseMoneyInput(formData.base_salary_total),
      overtime_amount: parseMoneyInput(formData.overtime_amount),
      bonus_amount: parseMoneyInput(formData.bonus_amount),
      other_earnings_amount: parseMoneyInput(formData.other_earnings_amount),
      total_deductions: parseMoneyInput(formData.total_deductions),
      ...(nField !== '' ? { total_net: parseMoneyInput(formData.total_net) } : {}),
    }
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
          notes: formData.notes || null,
          ...payrollAmountsPayload(),
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
          notes: formData.notes || null,
          ...payrollAmountsPayload(),
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
        setDetailAmounts(detailAmountsFromPayrollApi(data))

        const hdr = {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        }
        let latestPonds: { id: number; name: string; is_active?: boolean }[] = []
        try {
          const cr = await fetch(`${baseUrl}/companies/current/`, {
            headers: hdr,
            mode: 'cors',
            credentials: 'omit',
          })
          if (cr.ok) {
            const cj = await cr.json()
            const en = Boolean(cj.aquaculture_enabled)
            setAquacultureEnabled(en)
            if (en) {
              if (aquacultureOpsUnlocked) {
                const pr = await fetch(`${baseUrl}/aquaculture/ponds/`, {
                  headers: hdr,
                  mode: 'cors',
                  credentials: 'omit',
                })
                if (pr.ok) {
                  const pj = await pr.json()
                  latestPonds = Array.isArray(pj)
                    ? pj.map((x: { id: number; name: string; is_active?: boolean }) => ({
                        id: x.id,
                        name: (x.name || `Pond ${x.id}`).trim() || `Pond ${x.id}`,
                        is_active: x.is_active,
                      }))
                    : []
                }
              } else {
                latestPonds = []
              }
              setAquaculturePonds(latestPonds)
            } else {
              setAquaculturePonds([])
            }
          }
        } catch {
          latestPonds = aquaculturePonds
        }

        if (Array.isArray(data.pond_allocations) && data.pond_allocations.length > 0) {
          setPondAllocDraft(
            data.pond_allocations.map((x: { pond_id: number; amount: string | number }) => ({
              pond_id: String(x.pond_id),
              amount: String(x.amount ?? ''),
            }))
          )
        } else if (latestPonds.length > 0) {
          setPondAllocDraft(latestPonds.map((p) => ({ pond_id: String(p.id), amount: '' })))
        } else {
          setPondAllocDraft([])
        }
        payFromTouched.current = false
        setShowDetailsModal(true)
      } else {
        toast.error('Failed to load payroll details')
      }
    } catch (error) {
      console.error('Error fetching payroll details:', error)
      toast.error('Error loading payroll details')
    }
  }

  const saveDetailAmounts = async () => {
    if (!selectedPayroll || selectedPayroll.is_salary_posted) return
    setAmountSaving(true)
    try {
      const token = localStorage.getItem('access_token')
      const baseUrl = getApiBaseUrl()
      const nRaw = detailAmounts.n.trim()
      const body: Record<string, unknown> = {
        base_salary_total: parseMoneyInput(detailAmounts.base),
        overtime_amount: parseMoneyInput(detailAmounts.ot),
        bonus_amount: parseMoneyInput(detailAmounts.bonus),
        other_earnings_amount: parseMoneyInput(detailAmounts.other),
        total_deductions: parseMoneyInput(detailAmounts.d),
      }
      if (nRaw !== '') body.total_net = Number(nRaw)
      if (aquacultureEnabled && aquacultureOpsUnlocked && !selectedPayroll.is_salary_posted) {
        const net =
          nRaw !== ''
            ? Number(nRaw)
            : detailComputedGross - parseMoneyInput(detailAmounts.d)
        const alloc = pondAllocDraft
          .filter((row) => row.pond_id && String(row.amount).trim() !== '')
          .map((row) => ({
            pond_id: parseInt(row.pond_id, 10),
            amount: String(parseMoneyInput(row.amount)),
          }))
        const sumAlloc = alloc.reduce((s, x) => s + parseMoneyInput(x.amount), 0)
        if (Math.abs(sumAlloc - net) > 0.02) {
          toast.error(
            `Pond allocations must sum to total net (${formatNumber(net)}). Current sum: ${formatNumber(sumAlloc)}.`
          )
          setAmountSaving(false)
          return
        }
        body.pond_allocations = alloc
      }
      const response = await fetch(`${baseUrl}/payroll/${selectedPayroll.id}/`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        mode: 'cors',
        credentials: 'omit',
        body: JSON.stringify(body),
      })
      if (response.ok) {
        const data = (await response.json()) as PayrollRun
        applyPayrollResponseToDetailState(data)
        fetchPayrolls()
        toast.success('Amounts updated')
      } else {
        const err = await response.json()
        toast.error(err.detail || 'Failed to save')
      }
    } catch (e) {
      console.error(e)
      toast.error('Error saving amounts')
    } finally {
      setAmountSaving(false)
    }
  }

  const runFromEmployees = async () => {
    if (!selectedPayroll || selectedPayroll.is_salary_posted) return
    setActionLoading(true)
    try {
      const token = localStorage.getItem('access_token')
      const baseUrl = getApiBaseUrl()
      const response = await fetch(
        `${baseUrl}/payroll/${selectedPayroll.id}/from-employees/`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify({}),
        }
      )
      if (response.ok) {
        const data = (await response.json()) as PayrollRun
        applyPayrollResponseToDetailState(data)
        fetchPayrolls()
        toast.success('Totals set from active employee salaries (same period sum)')
      } else {
        const err = await response.json()
        toast.error(err.detail || 'Failed')
      }
    } catch (e) {
      console.error(e)
      toast.error('Request failed')
    } finally {
      setActionLoading(false)
    }
  }

  const runFromOneEmployee = async () => {
    if (!selectedPayroll || selectedPayroll.is_salary_posted) return
    if (!oneEmployeeId) {
      toast.error('Choose an employee from the list')
      return
    }
    setActionLoading(true)
    try {
      const token = localStorage.getItem('access_token')
      const baseUrl = getApiBaseUrl()
      const response = await fetch(
        `${baseUrl}/payroll/${selectedPayroll.id}/from-one-employee/`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify({ employee_id: parseInt(oneEmployeeId, 10) }),
        }
      )
      if (response.ok) {
        const data = (await response.json()) as PayrollRun
        applyPayrollResponseToDetailState(data)
        fetchPayrolls()
        toast.success('Gross and net set from that employee. Add optional notes (name, period) before posting.')
      } else {
        const err = await response.json()
        toast.error(err.detail || 'Failed')
      }
    } catch (e) {
      console.error(e)
      toast.error('Request failed')
    } finally {
      setActionLoading(false)
    }
  }

  const postToBooks = async () => {
    if (!selectedPayroll || selectedPayroll.is_salary_posted) return
    if (
      !window.confirm(
        'Post salary to the general ledger? This records the expense and bank (or default cash/bank) per your chart. Pay staff in your bank or cash first, then use this to update your books.'
      )
    ) {
      return
    }
    setActionLoading(true)
    try {
      const token = localStorage.getItem('access_token')
      const baseUrl = getApiBaseUrl()
      const payload: { bank_account_id?: number; pay_from_chart_account_id?: number } = {}
      if (payFromSelect.startsWith('b:')) {
        const id = parseInt(payFromSelect.slice(2), 10)
        if (!isNaN(id)) payload.bank_account_id = id
      } else if (payFromSelect.startsWith('c:')) {
        const id = parseInt(payFromSelect.slice(2), 10)
        if (!isNaN(id)) payload.pay_from_chart_account_id = id
      }
      const response = await fetch(
        `${baseUrl}/payroll/${selectedPayroll.id}/post-to-books/`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify(payload),
        }
      )
      if (response.ok) {
        const data = (await response.json()) as PayrollRun & { message?: string }
        applyPayrollResponseToDetailState(data)
        toast.success(data.message || 'Posted to general ledger')
        fetchPayrolls()
      } else {
        const err = await response.json()
        toast.error(typeof err.detail === 'string' ? err.detail : 'Post failed')
      }
    } catch (e) {
      console.error(e)
      toast.error('Request failed')
    } finally {
      setActionLoading(false)
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
        <div className="app-scroll-pad">
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

          <div className="mb-8 rounded-xl border border-blue-100 bg-blue-50/80 p-5 text-sm text-gray-800">
            <div className="mb-2 flex items-center gap-2 font-semibold text-blue-900">
              <BookOpen className="h-5 w-5" />
              How to pay salary (professional flow)
            </div>
            <ol className="ml-1 list-decimal space-y-1.5 pl-5">
              <li>Pay staff in real life (bank transfer, cash, MFS) from your company account or cash float.</li>
              <li>Create a payroll run and set the pay period and payment date (e.g. April 2026: 1st–30th, payment the day you paid).</li>
              <li>
                Set <strong>earnings</strong> (base salary, overtime, bonus, other — total gross is their sum),
                then <strong>deductions / net</strong>. For one person only, open <strong>View</strong> and use{' '}
                <strong>Apply one employee</strong> to pull base salary from HR; add overtime/bonus lines as
                needed. Use <strong>Sum from employees</strong> when the run covers the whole team’s regular pay.
              </li>
              <li>
                <strong>Post to general ledger</strong> to record Dr salary expense, Cr your bank (and Cr
                statutory line if you have deductions). This updates your books; it does not move money.
              </li>
            </ol>
            <p className="mt-3 text-xs text-gray-600">
              Book entry number uses your chart (e.g. 6400, 1030, 2210/2200). Link bank registers in Banking
              if you use a specific account.
            </p>
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
                          disabled={!!payroll.is_salary_posted}
                          className="inline-flex items-center gap-1 text-green-600 hover:text-green-900 disabled:cursor-not-allowed disabled:opacity-40"
                          title={payroll.is_salary_posted ? 'Posted to GL — edit is locked' : 'Edit Payroll'}
                        >
                          <Edit2 className="h-4 w-4" />
                          <span className="hidden sm:inline">Edit</span>
                        </button>
                        <button 
                          onClick={() => handleDelete(payroll)}
                          disabled={!!payroll.is_salary_posted}
                          className="inline-flex items-center gap-1 text-red-600 hover:text-red-900 disabled:cursor-not-allowed disabled:opacity-40"
                          title={payroll.is_salary_posted ? 'Unpost the journal in accounting first' : 'Delete Payroll'}
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
                        placeholder="e.g. April 2026 — Yunus Khan (EMP-00006). Optional; helps you find this run later."
                      />
                    </div>
                    <div className="md:col-span-2 rounded-lg border border-gray-200 bg-gray-50/80 p-4">
                      <p className="mb-3 text-sm font-semibold text-gray-900">Earnings (optional)</p>
                      <p className="mb-3 text-xs text-gray-600">
                        Enter regular pay plus overtime, bonus, or other earnings for this run.{' '}
                        <strong>Total gross</strong> is the sum of the four lines below (same figure posted to
                        salary expense).
                      </p>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div>
                          <label className="block text-xs font-medium text-gray-700 mb-1">
                            Base salary / regular pay
                          </label>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={formData.base_salary_total}
                            onChange={(e) =>
                              setFormData({ ...formData, base_salary_total: e.target.value })
                            }
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-700 mb-1">Overtime</label>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={formData.overtime_amount}
                            onChange={(e) =>
                              setFormData({ ...formData, overtime_amount: e.target.value })
                            }
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-700 mb-1">Bonus</label>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={formData.bonus_amount}
                            onChange={(e) =>
                              setFormData({ ...formData, bonus_amount: e.target.value })
                            }
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-700 mb-1">
                            Other earnings
                          </label>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={formData.other_earnings_amount}
                            onChange={(e) =>
                              setFormData({ ...formData, other_earnings_amount: e.target.value })
                            }
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                          />
                        </div>
                      </div>
                      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-gray-200 pt-3">
                        <span className="text-sm font-medium text-gray-800">Total gross (computed)</span>
                        <span className="text-lg font-bold tabular-nums text-gray-900">
                          {currencySymbol}
                          {formatNumber(formComputedGross)}
                        </span>
                      </div>
                    </div>
                    <div className="md:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Deductions (optional)
                        </label>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={formData.total_deductions}
                          onChange={(e) =>
                            setFormData({ ...formData, total_deductions: e.target.value })
                          }
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Net (optional)</label>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={formData.total_net}
                          onChange={(e) => setFormData({ ...formData, total_net: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                        />
                        <p className="text-xs text-gray-500 mt-1">
                          Leave net blank to use total gross minus deductions
                        </p>
                      </div>
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

                {selectedPayroll.is_salary_posted &&
                  Array.isArray(selectedPayroll.pond_allocations) &&
                  selectedPayroll.pond_allocations.length > 0 && (
                    <div className="mb-6 rounded-lg border border-teal-100 bg-teal-50/60 px-4 py-3">
                      <h3 className="text-sm font-semibold text-teal-900">Net pay — pond split (recorded)</h3>
                      <ul className="mt-2 space-y-1 text-sm text-teal-950">
                        {selectedPayroll.pond_allocations.map((row) => (
                          <li key={row.pond_id} className="flex justify-between gap-4 tabular-nums">
                            <span>{row.pond_name || `Pond #${row.pond_id}`}</span>
                            <span className="font-medium">
                              {currencySymbol}
                              {formatNumber(Number(row.amount))}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                {/* Summary */}
                <div className="border-b pb-6">
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">Summary</h3>
                  {selectedPayroll.is_salary_posted && (
                    <p className="mb-3 flex flex-wrap items-center gap-2 text-sm text-green-800">
                      <CheckCircle className="h-4 w-4" />
                      Posted to GL
                      {selectedPayroll.salary_journal_entry_number ? (
                        <span className="font-mono text-gray-800">
                          ({selectedPayroll.salary_journal_entry_number})
                        </span>
                      ) : null}
                      <a
                        href="/journal-entries"
                        className="inline-flex items-center gap-1 text-blue-600 hover:underline"
                      >
                        View journal entries
                        <ArrowRight className="h-3 w-3" />
                      </a>
                    </p>
                  )}
                  {selectedPayroll.is_salary_posted ? (
                    <div className="space-y-3">
                      <div className="space-y-1 rounded-lg border border-gray-100 bg-gray-50/90 px-3 py-2 text-sm">
                        <div className="flex justify-between text-gray-600">
                          <span>Base / regular</span>
                          <span className="tabular-nums text-gray-900">
                            {currencySymbol}
                            {formatNumber(Number(selectedPayroll.base_salary_total) || 0)}
                          </span>
                        </div>
                        <div className="flex justify-between text-gray-600">
                          <span>Overtime</span>
                          <span className="tabular-nums text-gray-900">
                            {currencySymbol}
                            {formatNumber(Number(selectedPayroll.overtime_amount) || 0)}
                          </span>
                        </div>
                        <div className="flex justify-between text-gray-600">
                          <span>Bonus</span>
                          <span className="tabular-nums text-gray-900">
                            {currencySymbol}
                            {formatNumber(Number(selectedPayroll.bonus_amount) || 0)}
                          </span>
                        </div>
                        <div className="flex justify-between text-gray-600">
                          <span>Other earnings</span>
                          <span className="tabular-nums text-gray-900">
                            {currencySymbol}
                            {formatNumber(Number(selectedPayroll.other_earnings_amount) || 0)}
                          </span>
                        </div>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-gray-600">Total Gross Pay</span>
                        <span className="text-xl font-bold text-gray-900">
                          {currencySymbol}
                          {formatNumber(Number(selectedPayroll.total_gross) || 0)}
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-gray-600">Total Deductions</span>
                        <span className="text-xl font-bold text-red-600">
                          -{currencySymbol}
                          {formatNumber(Number(selectedPayroll.total_deductions) || 0)}
                        </span>
                      </div>
                      <div className="flex justify-between items-center pt-3 border-t">
                        <span className="text-lg font-semibold text-gray-900">Total Net Pay</span>
                        <span className="text-2xl font-bold text-green-600">
                          {currencySymbol}
                          {formatNumber(Number(selectedPayroll.total_net) || 0)}
                        </span>
                      </div>
                    </div>
                  ) : (
                    <>
                      <p className="text-sm text-gray-600 mb-3">
                        Edit earnings (base, overtime, bonus, other), then deductions and net — or use{' '}
                        <strong>Sum from employees</strong> / <strong>Apply one employee</strong> to fill base
                        salary from HR. Total gross is always the sum of the four earning lines.
                      </p>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div>
                          <label className="block text-xs font-medium text-gray-600">Base / regular</label>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5"
                            value={detailAmounts.base}
                            onChange={(e) =>
                              setDetailAmounts((x) => ({ ...x, base: e.target.value }))
                            }
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-600">Overtime</label>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5"
                            value={detailAmounts.ot}
                            onChange={(e) => setDetailAmounts((x) => ({ ...x, ot: e.target.value }))}
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-600">Bonus</label>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5"
                            value={detailAmounts.bonus}
                            onChange={(e) =>
                              setDetailAmounts((x) => ({ ...x, bonus: e.target.value }))
                            }
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-600">Other earnings</label>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5"
                            value={detailAmounts.other}
                            onChange={(e) =>
                              setDetailAmounts((x) => ({ ...x, other: e.target.value }))
                            }
                          />
                        </div>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded border border-gray-100 bg-gray-50 px-3 py-2">
                        <span className="text-xs font-semibold text-gray-700">Total gross</span>
                        <span className="text-sm font-bold tabular-nums text-gray-900">
                          {currencySymbol}
                          {formatNumber(detailComputedGross)}
                        </span>
                      </div>
                      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div>
                          <label className="block text-xs font-medium text-gray-600">Deductions</label>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5"
                            value={detailAmounts.d}
                            onChange={(e) => setDetailAmounts((x) => ({ ...x, d: e.target.value }))}
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-600">Net (optional)</label>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5"
                            value={detailAmounts.n}
                            onChange={(e) => setDetailAmounts((x) => ({ ...x, n: e.target.value }))}
                          />
                        </div>
                      </div>
                      {aquacultureEnabled && aquacultureOpsUnlocked && !selectedPayroll.is_salary_posted && (
                        <div className="mt-4 rounded-lg border border-teal-200 bg-teal-50/50 p-3">
                          <p className="text-sm font-medium text-teal-900">Split net pay across ponds (Aquaculture)</p>
                          <p className="mt-1 text-xs text-teal-900/80">
                            Sum of amounts must equal total net pay (same as saved amounts). Saved together with{' '}
                            <strong>Save amounts</strong>.
                          </p>
                          {aquaculturePonds.length === 0 && (
                            <p className="mt-2 text-xs text-amber-900">
                              No ponds yet — add them under{' '}
                              <Link href="/aquaculture/ponds" className="font-medium underline">
                                Aquaculture → Ponds
                              </Link>
                              , then reopen this payroll or refresh the page.
                            </p>
                          )}
                          <div className="mt-2 space-y-2">
                            {(pondAllocDraft.length > 0 ? pondAllocDraft : [{ pond_id: '', amount: '' }]).map(
                              (row, idx) => (
                                <div key={idx} className="flex flex-wrap items-center gap-2">
                                  <select
                                    className="min-w-[8rem] rounded border border-gray-300 px-2 py-1.5 text-sm"
                                    value={row.pond_id}
                                    onChange={(e) => {
                                      const v = e.target.value
                                      setPondAllocDraft((rows) => {
                                        const base =
                                          rows.length > 0 ? rows : [{ pond_id: '', amount: '' }]
                                        return base.map((r, i) => (i === idx ? { ...r, pond_id: v } : r))
                                      })
                                    }}
                                  >
                                    <option value="">Pond…</option>
                                    {aquaculturePonds.map((p) => (
                                      <option key={p.id} value={p.id}>
                                        {p.name}
                                        {p.is_active === false ? ' (inactive)' : ''}
                                      </option>
                                    ))}
                                  </select>
                                  <input
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    className="w-32 rounded border border-gray-300 px-2 py-1.5 text-sm"
                                    placeholder="Amount"
                                    value={row.amount}
                                    onChange={(e) => {
                                      setPondAllocDraft((rows) => {
                                        const base =
                                          rows.length > 0 ? rows : [{ pond_id: '', amount: '' }]
                                        return base.map((r, i) =>
                                          i === idx ? { ...r, amount: e.target.value } : r
                                        )
                                      })
                                    }}
                                  />
                                  <button
                                    type="button"
                                    className="text-xs text-red-600 hover:underline"
                                    onClick={() =>
                                      setPondAllocDraft((rows) => rows.filter((_, i) => i !== idx))
                                    }
                                  >
                                    Remove
                                  </button>
                                </div>
                              )
                            )}
                          </div>
                          <div className="mt-2 flex flex-wrap gap-2">
                            <button
                              type="button"
                              className="text-xs font-medium text-teal-800 hover:underline"
                              onClick={() =>
                                setPondAllocDraft((rows) => [...(rows.length ? rows : []), { pond_id: '', amount: '' }])
                              }
                            >
                              + Add pond line
                            </button>
                            {aquaculturePonds.length > 0 ? (
                              <button
                                type="button"
                                className="text-xs font-medium text-teal-800 hover:underline"
                                onClick={() => {
                                  const nRaw = detailAmounts.n.trim()
                                  const net =
                                    nRaw !== ''
                                      ? Number(nRaw)
                                      : detailComputedGross - parseMoneyInput(detailAmounts.d)
                                  if (!Number.isFinite(net) || net < 0) {
                                    toast.error('Set a valid net pay first')
                                    return
                                  }
                                  const each = net / aquaculturePonds.length
                                  setPondAllocDraft(
                                    aquaculturePonds.map((p) => ({
                                      pond_id: String(p.id),
                                      amount: formatAmountPlain(each),
                                    }))
                                  )
                                }}
                              >
                                Distribute net equally
                              </button>
                            ) : null}
                          </div>
                        </div>
                      )}
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={saveDetailAmounts}
                          disabled={amountSaving}
                          className="rounded-lg bg-gray-200 px-3 py-1.5 text-sm font-medium text-gray-800 hover:bg-gray-300 disabled:opacity-50"
                        >
                          {amountSaving ? 'Saving…' : 'Save amounts'}
                        </button>
                        <button
                          type="button"
                          onClick={runFromEmployees}
                          disabled={actionLoading}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-white px-3 py-1.5 text-sm font-medium text-blue-800 hover:bg-blue-50 disabled:opacity-50"
                        >
                          <RefreshCw className="h-4 w-4" />
                          Sum from employees
                        </button>
                        <div className="flex w-full flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end">
                          <div className="min-w-0 sm:max-w-xs">
                            <label className="text-xs text-gray-600">Fill from one employee (already paid?)</label>
                            <select
                              className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                              value={oneEmployeeId}
                              onChange={(e) => setOneEmployeeId(e.target.value)}
                            >
                              <option value="">Select employee…</option>
                              {employees
                                .filter(
                                  (e) => e.is_active && e.salary != null && Number(e.salary) > 0
                                )
                                .map((e) => (
                                  <option key={e.id} value={e.id}>
                                    {e.employee_number || e.id}{' '}
                                    {(e.first_name + ' ' + (e.last_name || '')).trim()}{' '}
                                    — {formatNumber(Number(e.salary))}
                                  </option>
                                ))}
                            </select>
                          </div>
                          <button
                            type="button"
                            onClick={runFromOneEmployee}
                            disabled={actionLoading}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50/80 px-3 py-1.5 text-sm font-medium text-emerald-900 hover:bg-emerald-100 disabled:opacity-50"
                          >
                            <User className="h-4 w-4" />
                            Apply one employee
                          </button>
                        </div>
                      </div>
                      <div className="mt-4 rounded-lg border border-gray-200 p-3">
                        <div className="mb-2 flex items-center gap-2 text-sm font-medium text-gray-800">
                          <Landmark className="h-4 w-4" />
                          Post to general ledger
                        </div>
                        <p className="text-xs text-gray-600">
                          The <span className="font-medium text-gray-700">dropdown is only for cash out</span>{' '}
                          (which bank or cash account to credit for net pay). It does not list 6400 on purpose:{' '}
                          <span className="font-medium text-gray-700">6400 is an expense</span>, not a bank
                          account.
                        </p>
                        <div className="mt-2 rounded border border-amber-100 bg-amber-50/80 px-2.5 py-2 text-xs text-amber-950">
                          <span className="font-medium">Salary expense (set automatically on post):</span>{' '}
                          {salaryExpenseCoa ? (
                            <span>
                              {salaryExpenseCoa.account_code} — {salaryExpenseCoa.account_name}
                            </span>
                          ) : (
                            <span>
                              add <span className="whitespace-nowrap">6400 Salaries &amp; Wages</span> in{' '}
                              <span className="font-medium">Chart of accounts</span> (posting will fail until
                              it exists)
                            </span>
                          )}
                        </div>
                        <label className="mt-2 block text-xs text-gray-600">
                          Net pay from (bank register or GL account)
                        </label>
                        <select
                          className="mt-1 w-full max-w-lg rounded border border-gray-300 px-2 py-2 text-sm"
                          value={payFromSelect}
                          onChange={(e) => {
                            payFromTouched.current = true
                            setPayFromSelect(e.target.value)
                          }}
                        >
                          <option value="">
                            Default — operating bank / cash (GL 1030 or 1010)
                          </option>
                          {bankRegisters.some((b) => b.chart_account_id) && (
                            <optgroup label="Bank / cash registers (linked to GL)">
                              {bankRegisters
                                .filter((b) => b.chart_account_id)
                                .map((b) => (
                                  <option key={`b-${b.id}`} value={`b:${b.id}`}>
                                    {b.account_name} — {b.bank_name}
                                  </option>
                                ))}
                            </optgroup>
                          )}
                          {bankRegisters.some((b) => !b.chart_account_id) && (
                            <optgroup label="Registers not linked to GL (link in Banking / Chart)">
                              {bankRegisters
                                .filter((b) => !b.chart_account_id)
                                .map((b) => (
                                  <option key={`b-un-${b.id}`} value="" disabled>
                                    {b.account_name} — {b.bank_name} (not linked)
                                  </option>
                                ))}
                            </optgroup>
                          )}
                          {glPayAccounts.length > 0 && (
                            <optgroup label="Chart of accounts (bank &amp; cash)">
                              {glPayAccounts.map((a) => (
                                <option key={`c-${a.id}`} value={`c:${a.id}`}>
                                  {a.account_code} {a.account_name}
                                </option>
                              ))}
                            </optgroup>
                          )}
                        </select>
                        <p className="mt-1 text-xs text-gray-500">
                          If you do not choose, net pay credits default bank/cash (1030/1010) when they exist. You
                          do not select 6400 here — the journal debits 6400 for gross automatically.
                        </p>
                        <button
                          type="button"
                          onClick={postToBooks}
                          disabled={actionLoading}
                          className="mt-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                        >
                          {actionLoading ? 'Working…' : 'Post to books'}
                        </button>
                      </div>
                    </>
                  )}
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
