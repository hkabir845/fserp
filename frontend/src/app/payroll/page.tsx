'use client'

import { useEffect, useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Sidebar from '@/components/Sidebar'
import { Plus, Eye, DollarSign, X, Calendar, FileText, CheckCircle, Clock, XCircle, Edit2, Trash2, BookOpen, RefreshCw, Landmark, ArrowRight, User } from 'lucide-react'
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
  salary_journal_entry_id?: number | null
  salary_journal_entry_number?: string
  is_salary_posted?: boolean
  message?: string
  created_at: string
  updated_at: string
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
    total_gross: '',
    total_deductions: '',
    total_net: '',
  })
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
  const [detailAmounts, setDetailAmounts] = useState({ g: '', d: '', n: '' })
  const [employees, setEmployees] = useState<EmployeeRow[]>([])
  const [oneEmployeeId, setOneEmployeeId] = useState<string>('')

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
      total_gross: '',
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
      total_gross: payroll.total_gross != null ? String(payroll.total_gross) : '',
      total_deductions: payroll.total_deductions != null ? String(payroll.total_deductions) : '',
      total_net: payroll.total_net != null ? String(payroll.total_net) : '',
    })
    setShowModal(true)
  }

  const amountFieldsToPayload = () => {
    const g = formData.total_gross.trim()
    const d = formData.total_deductions.trim()
    const n = formData.total_net.trim()
    if (g === '' && d === '' && n === '') return {}
    const parseN = (s: string) => (s === '' ? 0 : Number(s))
    return {
      total_gross: parseN(g),
      total_deductions: parseN(d),
      ...(n !== '' ? { total_net: parseN(n) } : {}),
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
          ...amountFieldsToPayload(),
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
          ...amountFieldsToPayload(),
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
        setDetailAmounts({
          g: data.total_gross != null ? String(data.total_gross) : '',
          d: data.total_deductions != null ? String(data.total_deductions) : '',
          n: data.total_net != null ? String(data.total_net) : '',
        })
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
      const g = detailAmounts.g.trim() === '' ? 0 : Number(detailAmounts.g)
      const d = detailAmounts.d.trim() === '' ? 0 : Number(detailAmounts.d)
      const nRaw = detailAmounts.n.trim()
      const body: Record<string, number> = { total_gross: g, total_deductions: d }
      if (nRaw !== '') body.total_net = Number(nRaw)
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
        const data = await response.json()
        setSelectedPayroll(data)
        setDetailAmounts({
          g: data.total_gross != null ? String(data.total_gross) : '',
          d: data.total_deductions != null ? String(data.total_deductions) : '',
          n: data.total_net != null ? String(data.total_net) : '',
        })
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
        const data = await response.json()
        setSelectedPayroll(data)
        setDetailAmounts({
          g: String(data.total_gross ?? ''),
          d: String(data.total_deductions ?? ''),
          n: String(data.total_net ?? ''),
        })
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
        const data = await response.json()
        setSelectedPayroll(data)
        setDetailAmounts({
          g: String(data.total_gross ?? ''),
          d: String(data.total_deductions ?? ''),
          n: String(data.total_net ?? ''),
        })
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
        const data = await response.json()
        setSelectedPayroll(data)
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
                Set <strong>gross / deductions / net</strong>. For <strong>one person only</strong> (e.g. Yunus
                Khan, EMP-00006), open <strong>View</strong> and use <strong>Fill from one employee</strong> so
                amounts match HR, or type the paid amounts by hand. Use <strong>Sum from employees</strong> only
                when the run is for the whole team’s combined salaries.
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
                    <div className="md:col-span-2 grid grid-cols-1 sm:grid-cols-3 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Gross (optional)</label>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={formData.total_gross}
                          onChange={(e) => setFormData({ ...formData, total_gross: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Deductions (optional)</label>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={formData.total_deductions}
                          onChange={(e) => setFormData({ ...formData, total_deductions: e.target.value })}
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
                        <p className="text-xs text-gray-500 mt-1">Leave net blank to use gross minus deductions</p>
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
                        Edit amounts below, or sum salaries from the employee list. When ready, post to
                        the ledger after you have actually paid.
                      </p>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div>
                          <label className="block text-xs font-medium text-gray-600">Gross</label>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5"
                            value={detailAmounts.g}
                            onChange={(e) => setDetailAmounts((x) => ({ ...x, g: e.target.value }))}
                          />
                        </div>
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
